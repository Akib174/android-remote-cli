package com.fcfc.app.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.random.Random

/**
 * WebSocket manager — port of frontend/src/realtime/sockets.ts.
 * One socket per chat (Durable Object ChatRoom) + a single user-hub socket.
 *
 * Features carried over:
 *  - auto-reconnect with exponential backoff (500ms·2^n, cap 15s, jitter)
 *  - send-queueing while down (outbox preserved across disconnectChat)
 *  - heartbeat every 45s (chat: `ping`/pong — hub: `hb`/hb-ack)
 *  - stale-socket watchdog (75s silent → force reconnect, checks every 20s)
 *  - close-code 4003 (kicked from room) → drop, no reconnect
 *  - close-code 4001 (device revoked) → force logout
 *  - token pre-flight refresh before every (re)connect
 */
object SocketManager {
    private val JSON = Json { ignoreUnknownKeys = true; isLenient = true }

    private const val STALE_MS = 75_000L
    private const val HB_EVERY = 45_000L

    /** Event handlers — set by ChatsStore (mirrors web `handlers`). */
    var onChat: (chatId: String, ev: JsonObject) -> Unit = { _, _ -> }
    var onHub: (ev: JsonObject) -> Unit = { }
    var onChatOpen: (chatId: String) -> Unit = { }
    var onHubOpen: () -> Unit = { }
    var onForceLogout: () -> Unit = { }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val http = OkHttpClient.Builder()
        .pingInterval(0, TimeUnit.SECONDS)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private class Managed {
        var ws: WebSocket? = null
        var retries = 0
        var want = false
        val outbox = ArrayDeque<String>()
        var lastRx = 0L
        var opening = AtomicBoolean(false)
        var job: kotlinx.coroutines.Job? = null   // reconnect timer
        var hbJob: kotlinx.coroutines.Job? = null // heartbeat
    }

    private val chats = ConcurrentHashMap<String, Managed>()
    private val hub = Managed()

    private fun backoff(retries: Int): Long =
        (minOf(15_000L, 500L shl minOf(retries, 5)) + Random.nextLong(300)).coerceAtMost(15_300L)

    // ── chat room sockets ─────────────────────────────────────────────────
    fun connectChat(chatId: String) {
        val m = chats.getOrPut(chatId) { Managed() }
        m.want = true
        openChatSocket(chatId, m)
    }

    private fun openChatSocket(chatId: String, m: Managed) {
        val live = m.ws
        if (live != null && m.opening.get()) return
        if (!m.opening.compareAndSet(false, true)) return
        scope.launch {
            runCatching { ApiClient.ensureFreshToken() }
            val url = ApiClient.wsUrl("/ws/chat/$chatId")
            val ws = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    m.retries = 0
                    m.lastRx = System.currentTimeMillis()
                    onChatOpen(chatId)
                    while (m.outbox.isNotEmpty()) {
                        val raw = m.outbox.removeFirst()
                        runCatching { webSocket.send(raw) }
                    }
                    m.hbJob?.cancel()
                    m.hbJob = scope.launch {
                        while (true) {
                            delay(HB_EVERY)
                            if (m.ws !== webSocket) return@launch
                            runCatching { webSocket.send("""{"t":"ping"}""") }
                        }
                    }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    m.lastRx = System.currentTimeMillis()
                    runCatching { onChat(chatId, JSON.parseToJsonElement(text).jsonObject) }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    handleChatClose(chatId, m, code)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    handleChatClose(chatId, m, -1)
                }
            })
            if (m.ws == null || m.opening.get()) m.ws = ws
            m.opening.set(false)
        }
    }

    private fun handleChatClose(chatId: String, m: Managed, code: Int) {
        m.hbJob?.cancel()
        if (m.ws != null) { runCatching { m.ws?.close(1000, null) }; }
        m.ws = null
        // 4003 = server-side kick (removed from room / session revoked) — drop for good
        if (code == 4003) { chats.remove(chatId); return }
        if (m.want) {
            m.retries++
            val wait = backoff(m.retries)
            m.job = scope.launch { delay(wait); openChatSocket(chatId, m) }
        }
    }

    fun disconnectChat(chatId: String) {
        val m = chats[chatId] ?: return
        m.want = false
        m.job?.cancel()
        m.hbJob?.cancel()
        runCatching { m.ws?.close(1000, null) }
        m.ws = null
        // keep the map entry when outbox is non-empty — flushed on next connectChat
        if (m.outbox.isEmpty()) chats.remove(chatId)
    }

    fun sendChat(chatId: String, obj: JsonObject) {
        val m = chats[chatId] ?: return
        val raw = obj.toString()
        val ws = m.ws
        if (ws != null) ws.send(raw) else m.outbox.addLast(raw)
    }

    fun isChatOpen(chatId: String): Boolean = chats[chatId]?.ws != null

    // ── user hub socket ───────────────────────────────────────────────────
    fun connectHub() {
        hub.want = true
        openHub()
    }

    private fun openHub() {
        if (hub.ws != null && hub.opening.get()) return
        if (!hub.opening.compareAndSet(false, true)) return
        scope.launch {
            runCatching { ApiClient.ensureFreshToken() }
            val url = ApiClient.wsUrl("/ws/user")
            val ws = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    hub.retries = 0
                    hub.lastRx = System.currentTimeMillis()
                    onHubOpen()
                    while (hub.outbox.isNotEmpty()) {
                        val raw = hub.outbox.removeFirst()
                        runCatching { webSocket.send(raw) }
                    }
                    hub.hbJob?.cancel()
                    hub.hbJob = scope.launch {
                        while (true) {
                            delay(HB_EVERY)
                            if (hub.ws !== webSocket) return@launch
                            runCatching { webSocket.send("""{"t":"hb"}""") }
                        }
                    }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    hub.lastRx = System.currentTimeMillis()
                    runCatching {
                        val msg = JSON.parseToJsonElement(text).jsonObject
                        if (msg["t"]?.jsonPrimitive?.content == "hub") {
                            (msg["event"] as? JsonObject)?.let { onHub(it) }
                        }
                    }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    handleHubClose(code)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    handleHubClose(-1)
                }
            })
            hub.ws = ws
            hub.opening.set(false)
        }
    }

    private fun handleHubClose(code: Int) {
        hub.hbJob?.cancel()
        runCatching { hub.ws?.close(1000, null) }
        hub.ws = null
        // 4001 = device revoked (Telegram-style Decline) → immediate force-logout
        if (code == 4001) { onForceLogout(); return }
        if (hub.want) {
            hub.retries++
            val wait = backoff(hub.retries)
            hub.job = scope.launch { delay(wait); openHub() }
        }
    }

    fun disconnectHub() {
        hub.want = false
        hub.job?.cancel()
        hub.hbJob?.cancel()
        runCatching { hub.ws?.close(1000, null) }
        hub.ws = null
    }

    fun sendHub(obj: JsonObject) {
        val raw = obj.toString()
        val ws = hub.ws
        if (ws != null) ws.send(raw) else hub.outbox.addLast(raw)
    }

    // ── lifecycle ─────────────────────────────────────────────────────────
    /** User switched (logout → other account login): close everything. */
    fun resetSockets() {
        disconnectHub()
        for (id in chats.keys.toList()) disconnectChat(id)
        chats.clear()
    }

    fun shutdown() {
        resetSockets()
        scope.cancel()
    }

    init {
        // 🩺 watchdog — silent-dead socket detection, every 20s
        val watchdog = Thread {
            while (true) {
                runCatching {
                    val now = System.currentTimeMillis()
                    // hub
                    if (hub.want && hub.ws != null && now - hub.lastRx > STALE_MS) {
                        runCatching { hub.ws?.cancel() }
                        hub.ws = null
                        openHub()
                    } else if (hub.want && hub.ws == null && !hub.opening.get() && hub.job == null) {
                        openHub()
                    }
                    // chat rooms
                    for ((chatId, m) in chats) {
                        if (!m.want) continue
                        if (m.ws != null && now - m.lastRx > STALE_MS) {
                            runCatching { m.ws?.cancel() }
                            m.ws = null
                            m.hbJob?.cancel()
                            openChatSocket(chatId, m)
                        } else if (m.ws == null && !m.opening.get() && m.job == null) {
                            openChatSocket(chatId, m)
                        }
                    }
                }
                Thread.sleep(20_000)
            }
        }
        watchdog.isDaemon = true
        watchdog.name = "fcfc-socket-watchdog"
        watchdog.start()
    }
}
