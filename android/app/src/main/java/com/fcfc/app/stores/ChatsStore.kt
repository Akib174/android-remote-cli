package com.fcfc.app.stores

import com.fcfc.app.core.Notify
import com.fcfc.app.core.newId
import com.fcfc.app.crypto.CryptoGroup
import com.fcfc.app.crypto.CryptoSessions
import com.fcfc.app.db.FcDb
import com.fcfc.app.model.Chat
import com.fcfc.app.model.ChatKind
import com.fcfc.app.model.Message
import com.fcfc.app.model.MsgType
import com.fcfc.app.model.SendDraft
import com.fcfc.app.model.User
import com.fcfc.app.net.ApiClient
import com.fcfc.app.net.SocketManager
import com.fcfc.app.net.Wire
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * Chats store — port of frontend/src/stores/chats.ts.
 * Realtime messages, encrypt/decrypt, receipts, vanish, reactions, pins,
 * star, typing, presence, search, sender-key distribution, call events.
 */
object ChatsStore {
    private val JSON = Json { ignoreUnknownKeys = true; isLenient = true }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // ── state (mirror chats.ts ChatsState) ──
    val chats = kotlinx.coroutines.flow.MutableStateFlow<Map<String, Chat>>(emptyMap())
    val messages = kotlinx.coroutines.flow.MutableStateFlow<Map<String, List<Message>>>(emptyMap())
    val loadedAll = kotlinx.coroutines.flow.MutableStateFlow<Set<String>>(emptySet())
    val activeChatId = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    val presence = kotlinx.coroutines.flow.MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val requests = kotlinx.coroutines.flow.MutableStateFlow<List<JsonObject>>(emptyList())
    val vanish = kotlinx.coroutines.flow.MutableStateFlow<Set<String>>(emptySet())
    val starredIds = kotlinx.coroutines.flow.MutableStateFlow<Set<String>>(emptySet())
    val seenBy = kotlinx.coroutines.flow.MutableStateFlow<Map<String, Map<String, List<String>>>>(emptyMap())
    val replyingTo = kotlinx.coroutines.flow.MutableStateFlow<Message?>(null)
    val blockedIds = kotlinx.coroutines.flow.MutableStateFlow<Set<String>>(emptySet())
    val emojiPlays = kotlinx.coroutines.flow.MutableStateFlow<Map<String, Int>>(emptyMap())
    val booted = kotlinx.coroutines.flow.MutableStateFlow(false)
    val loadingHistory = kotlinx.coroutines.flow.MutableStateFlow<Set<String>>(emptySet())
    /** (chatId, msgId) — ChatWindow scrolls + blinks the target then clears. */
    val jumpTarget = kotlinx.coroutines.flow.MutableStateFlow<Pair<String, String>?>(null)

    // module-level guards (reset() clears)
    private val failedDecryptIds = HashMap<String, String>()   // mid → chatId
    private val skDoneIds = HashSet<String>()
    private val historyInflight = HashMap<String, Job>()
    private var allHistoriesLoaded = false
    private val lastRenego = HashMap<String, Long>()
    private val lastSkReq = HashMap<String, Long>()
    private val expiryJobs = HashMap<String, Job>()
    private val hubReloadAt = HashMap<String, Long>()
    private val historyMutex = Mutex()

    // ── boot ───────────────────────────────────────────────────────────────
    suspend fun boot() {
        if (booted.value) return
        wireSockets()
        SocketManager.connectHub()
        booted.value = true
        loadChats()
        runCatching { loadRequests() }
        runCatching { loadBlocked() }
        val stars: List<String> = runCatching { FcDb.allKeys("starred") }.getOrDefault(emptyList())
        starredIds.value = stars.toSet()
        startPresencePoll()
        loadAllHistories()
    }

    private fun wireSockets() {
        CryptoSessions.fetchPrekeyBundle = { peerId -> runCatching { ApiClient.fetchPrekeyBundle(peerId) }.getOrNull() }
        CryptoSessions.onSessionSaved = { CryptoGroup.markBackupDirty() }
        CryptoGroup.onStateSaved = { CryptoGroup.markBackupDirty() }
        SocketManager.onChat = { chatId, ev -> scope.launch { runCatching { event(chatId, ev) } } }
        SocketManager.onHub = { ev -> scope.launch { runCatching { hub(ev) } } }
        SocketManager.onChatOpen = { chatId -> scope.launch { runCatching { loadHistory(chatId) } } }
        SocketManager.onHubOpen = {
            scope.launch {
                runCatching { loadChats() }
                runCatching { loadRequests() }
                runCatching { loadBlocked() }
                runCatching { presenceTick() }
            }
        }
        SocketManager.onForceLogout = {
            AuthStore.forceLogout()
            reset()
        }
        ApiClient.onForceLogout = {
            AuthStore.forceLogout()
            reset()
        }
    }

    fun reset() {
        stopPresencePoll()
        SocketManager.resetSockets()
        synchronized(failedDecryptIds) { failedDecryptIds.clear() }
        synchronized(skDoneIds) { skDoneIds.clear() }
        synchronized(expiryJobs) { expiryJobs.clear() }
        allHistoriesLoaded = false
        booted.value = false
        chats.value = emptyMap(); messages.value = emptyMap(); loadedAll.value = emptySet()
        activeChatId.value = null; presence.value = emptyMap(); requests.value = emptyList()
        vanish.value = emptySet(); starredIds.value = emptySet(); seenBy.value = emptyMap()
        replyingTo.value = null; blockedIds.value = emptySet(); emojiPlays.value = emptyMap()
    }

    // ── chat list ──────────────────────────────────────────────────────────
    suspend fun loadChats() {
        val me = AuthStore.userId
        val rows = ApiClient.chatsRaw()
        val map = LinkedHashMap<String, Chat>()
        for (r in rows) {
            val delBefore = r["deleted_before"]?.jsonPrimitive?.longOrNull ?: 0L
            val lastTs = r["last_ts"]?.jsonPrimitive?.longOrNull ?: 0L
            if (delBefore > 0 && lastTs > 0 && delBefore >= lastTs) continue
            map[r["id"]!!.jsonPrimitive.content] = Wire.chatFromRow(r)
        }
        // DM peer info + group members (one detail call per chat, like the web)
        for (r in rows) {
            val id = r["id"]!!.jsonPrimitive.content
            try {
                val (chatRow, members) = ApiClient.chatDetail(id)
                val base = map[id] ?: continue
                val peer = members.firstOrNull { it.id != me }
                val updated = if (peer != null) {
                    base.copy(members = members, peer = Wire.memberToUser(peer))
                } else {
                    base.copy(members = members, saved = true)
                }
                map[id] = updated
            } catch (_: Exception) { }
        }
        chats.value = map
        // immediate presence for DM peers
        val ids = map.values.filter { it.kind == ChatKind.DM && it.peer != null && it.peer.id != me && it.peer.deleted != true }
            .map { it.peer!!.id }
        if (ids.isNotEmpty()) {
            runCatching {
                val out = ApiClient.presence(ids)
                val p = presence.value.toMutableMap()
                out.forEach { (k, v) -> p[k] = v }
                presence.value = p
            }
        }
    }

    suspend fun loadRequests() {
        runCatching { requests.value = ApiClient.requests() }
    }

    suspend fun loadBlocked() {
        runCatching {
            val results = ApiClient.blocked()
            blockedIds.value = results.map { it.id }.toSet()
        }
    }

    suspend fun unblock(userId: String) {
        runCatching { ApiClient.blockUser(userId, false) }
        blockedIds.value = blockedIds.value - userId
    }

    // ── open/close chat ────────────────────────────────────────────────────
    suspend fun openChat(chatId: String) {
        activeChatId.value = chatId
        val c = chats.value[chatId] ?: return
        if (c.kind == ChatKind.GROUP) {
            // new members → redistribute sender keys
            runCatching { CryptoGroup.markNeedsRedistribution(chatId, c.members.filter { !distributedSet(chatId).contains(it.id) && it.id != AuthStore.userId }.map { it.id }) }
        }
        SocketManager.connectChat(chatId)
        runCatching { loadHistory(chatId) }
        markRead(chatId)
    }

    fun closeChat() {
        activeChatId.value?.let { SocketManager.disconnectChat(it) }
        activeChatId.value = null
        replyingTo.value = null
    }

    // ── history ────────────────────────────────────────────────────────────
    suspend fun loadHistory(chatId: String, before: Long? = null) {
        val key = "$chatId:${before ?: ""}"
        historyMutex.withLock {
            if (historyInflight[key]?.isActive == true) return
            val job = scope.launch {
                runCatching { loadHistoryInner(chatId, before) }
                historyMutex.withLock { historyInflight.remove(key) }
            }
            historyInflight[key] = job
            job.join()
        }
    }

    private suspend fun loadHistoryInner(chatId: String, before: Long?) {
        loadingHistory.value = loadingHistory.value + chatId
        try {
            val rows = ApiClient.messagesRaw(chatId, before, 80)
            val known = (messages.value[chatId] ?: emptyList()).map { it.id }.toHashSet()
            val tomb = ((FcDb.get("meta", "del:$chatId") as? JsonArray)
                ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()).toHashSet()
            val me = AuthStore.userId

            // self-copy envelope map (ref-mid → env)
            val selfCopies = HashMap<String, JsonObject>()
            for (r in rows) {
                val type = r["type"]?.jsonPrimitive?.contentOrNull ?: continue
                if (type != "self-copy" || r["sender_id"]?.jsonPrimitive?.contentOrNull != me) continue
                val payload = parsePayload(r["payload"]) ?: continue
                val ref = payload["ref"]?.jsonPrimitive?.contentOrNull ?: continue
                (payload["env"] as? JsonObject)?.let { selfCopies[ref] = it }
            }

            // pass 1: sender-key rows first (ASC order — keys before messages)
            for (r in rows) {
                val type = r["type"]?.jsonPrimitive?.contentOrNull ?: continue
                val mid = r["mid"]?.jsonPrimitive?.contentOrNull ?: continue
                if (type != "sender-key") continue
                if (known.contains(mid) || skDoneIds.contains(mid) || tomb.contains(mid)) continue
                val sender = r["sender_id"]?.jsonPrimitive?.contentOrNull ?: continue
                if (sender == me) { skDoneIds.add(mid); continue }
                try {
                    if (CryptoGroup.hasSenderKey(chatId, sender)) { skDoneIds.add(mid); continue }
                    val payload = parsePayload(r["payload"]) ?: continue
                    val plain = CryptoSessions.decryptFrom(sender, payload) as? JsonObject
                    val sk = plain?.get("sk") as? JsonObject
                    if (sk != null) CryptoGroup.ingestSenderKey(plain["chatId"]?.jsonPrimitive?.contentOrNull ?: chatId, sender, sk)
                    skDoneIds.add(mid)
                } catch (_: Exception) { }
            }

            // pass 2: message rows
            val msgs = mutableListOf<Message>()
            var decryptFailed = false
            for (r in rows) {
                val type = r["type"]?.jsonPrimitive?.contentOrNull ?: continue
                if (type == "sender-key" || type == "self-copy") continue
                val mid = r["mid"]?.jsonPrimitive?.contentOrNull ?: continue
                if (tomb.contains(mid) || known.contains(mid)) continue
                if (failedDecryptContains(mid)) { decryptFailed = true; continue }
                val m = rowToMessage(chatId, r, selfCopies[mid])
                if (m != null) msgs.add(m) else {
                    if (failedDecryptContains(mid)) decryptFailed = true
                    val sender = r["sender_id"]?.jsonPrimitive?.contentOrNull
                    val c = chats.value[chatId]
                    if (m == null && sender != null && sender != me && c?.kind == ChatKind.GROUP) {
                        scope.launch {
                            if (!CryptoGroup.hasSenderKey(chatId, sender)) requestSenderKey(chatId)
                        }
                    }
                }
            }

            // merge + sort
            val existing = messages.value[chatId] ?: emptyList()
            val ids = msgs.map { it.id }.toHashSet()
            val merged = (msgs + existing.filter { !ids.contains(it.id) }).sortedBy { it.ts }
            messages.value = messages.value + (chatId to merged)
            if (rows.size < 80) loadedAll.value = loadedAll.value + chatId

            // list preview refresh
            val list = messages.value[chatId] ?: emptyList()
            val lastMsg = list.lastOrNull()
            if (lastMsg != null) {
                val c = chats.value[chatId]
                if (c != null) {
                    val newTs = maxOf(c.lastTs ?: 0, lastMsg.ts)
                    val needPreview = c.lastPreview.isNullOrEmpty() || lastMsg.ts >= (c.lastTs ?: 0)
                    val newPreview = if (needPreview) previewOf(lastMsg) else c.lastPreview
                    if (newPreview != c.lastPreview || newTs != c.lastTs) {
                        chats.value = chats.value + (chatId to c.copy(lastPreview = newPreview, lastTs = newTs))
                    }
                }
            }

            // reconcile pending/failed flags with server rows
            val rowIds = rows.mapNotNull { it["mid"]?.jsonPrimitive?.contentOrNull }.toHashSet()
            if (rowIds.isNotEmpty()) {
                val list2 = messages.value[chatId] ?: emptyList()
                var changed = false
                val next = list2.map { m ->
                    if (rowIds.contains(m.id) && (m.pending == true || m.failed == true)) {
                        changed = true; m.copy(pending = false, failed = false)
                    } else m
                }
                if (changed) messages.value = messages.value + (chatId to next)
            }

            // disappearing message timers
            for (m in msgs) {
                val exp = m.expiresAt ?: continue
                if (exp <= System.currentTimeMillis()) deleteForMe(chatId, listOf(m.id))
                else scheduleExpiry(chatId, m.id, exp)
            }

            // decrypt-failed → renego (1:1 only, throttled 10s)
            if (decryptFailed && System.currentTimeMillis() - (lastRenego[chatId] ?: 0) > 10_000) {
                val peer = chats.value[chatId]?.peer
                if (me.isNotEmpty() && peer != null && peer.id != me) {
                    lastRenego[chatId] = System.currentTimeMillis()
                    sendRaw(chatId, buildJsonObject { put("t", "renego"); put("chatId", chatId); put("from", me) })
                }
            }
        } finally {
            loadingHistory.value = loadingHistory.value - chatId
        }
    }

    private fun failedDecryptContains(mid: String): Boolean = synchronized(failedDecryptIds) { failedDecryptIds.containsKey(mid) }
    private fun healFailedChat(chatId: String): Boolean = synchronized(failedDecryptIds) {
        var healed = false
        val it = failedDecryptIds.entries.iterator()
        while (it.hasNext()) {
            val e = it.next()
            if (e.value == chatId) { it.remove(); healed = true }
        }
        healed
    }

    private fun parsePayload(el: JsonElement?): JsonObject? = when (el) {
        null -> null
        is JsonObject -> el
        is JsonPrimitive -> runCatching { JSON.parseToJsonElement(el.content).jsonObject }.getOrNull()
        else -> null
    }

    /** port of rowToMessage — returns null for sender-key/self-copy/undecryptable. */
    private suspend fun rowToMessage(chatId: String, row: JsonObject, selfEnv: JsonObject? = null): Message? {
        return try {
        val me = AuthStore.userId
        val mid = row["mid"]?.jsonPrimitive?.contentOrNull ?: row["id"]?.jsonPrimitive?.contentOrNull ?: return null
        val senderId = row["sender_id"]?.jsonPrimitive?.contentOrNull ?: row["senderId"]?.jsonPrimitive?.contentOrNull ?: ""
        val ts = row["ts"]?.jsonPrimitive?.longOrNull ?: 0
        val typeStr = row["type"]?.jsonPrimitive?.contentOrNull ?: "text"
        val payload = parsePayload(row["payload"])

        if (typeStr == "sender-key") {
            if (senderId != me) {
                val plain = payload?.let { CryptoSessions.decryptFrom(senderId, it) } as? JsonObject
                val sk = plain?.get("sk") as? JsonObject
                if (sk != null) CryptoGroup.ingestSenderKey(plain["chatId"]?.jsonPrimitive?.contentOrNull ?: chatId, senderId, sk)
            }
            return null
        }
        if (typeStr == "self-copy") return null
        if (typeStr == "call") {
            val c = payload
            return Message(id = mid, chatId = chatId, senderId = senderId, ts = ts, type = MsgType.CALL, call = c)
        }

        // cache-first for all
        val cached = FcDb.get("messages", mid) as? JsonObject
        if (cached != null) {
            return messageFromJson(cached).copy(
                reactions = (payload?.get("reactions") as? JsonObject)?.let { reactionsFromJson(it) } ?: emptyMap(),
                pending = false, failed = false,
            )
        }

        val envelope = payload ?: return null
        val isGroup = (envelope["g"] as? JsonPrimitive)?.intOrNull == 1

        if (senderId == me) {
            if (isGroup) {
                val plain = CryptoGroup.groupDecryptOwn(chatId, envelope) as? JsonObject
                val own = Message(
                    id = mid, chatId = chatId, senderId = senderId, ts = ts,
                    type = MsgType.fromWire(typeStr),
                    body = plain?.get("body")?.jsonPrimitive?.contentOrNull,
                    media = (plain?.get("media") as? JsonObject)?.let { Wire.mediaFromJson(it) },
                    replyTo = (plain?.get("replyTo") as? JsonObject)?.let { com.fcfc.app.model.ReplyRef(it["id"]?.jsonPrimitive?.contentOrNull ?: "", it["body"]?.jsonPrimitive?.contentOrNull ?: "", it["senderId"]?.jsonPrimitive?.contentOrNull ?: "") },
                    fwdFrom = plain?.get("fwdFrom")?.jsonPrimitive?.contentOrNull,
                    editedAt = if (plain?.get("edited")?.jsonPrimitive?.booleanOrNull == true) ts else null,
                    expiresAt = plain?.get("expiresAt")?.jsonPrimitive?.longOrNull,
                    ap = plain?.get("ap")?.jsonPrimitive?.booleanOrNull,
                    reactions = (envelope["reactions"] as? JsonObject)?.let { reactionsFromJson(it) } ?: emptyMap(),
                )
                if (own.body != null || own.media != null) FcDb.put("messages", mid, messageToJson(own))
                return own
            }
            if (selfEnv != null) {
                val plain = CryptoSessions.decryptFrom(me, selfEnv) as? JsonObject
                val own = Message(
                    id = mid, chatId = chatId, senderId = senderId, ts = ts,
                    type = MsgType.fromWire(typeStr),
                    body = plain?.get("body")?.jsonPrimitive?.contentOrNull,
                    media = (plain?.get("media") as? JsonObject)?.let { Wire.mediaFromJson(it) },
                    replyTo = (plain?.get("replyTo") as? JsonObject)?.let { com.fcfc.app.model.ReplyRef(it["id"]?.jsonPrimitive?.contentOrNull ?: "", it["body"]?.jsonPrimitive?.contentOrNull ?: "", it["senderId"]?.jsonPrimitive?.contentOrNull ?: "") },
                    fwdFrom = plain?.get("fwdFrom")?.jsonPrimitive?.contentOrNull,
                    editedAt = if (plain?.get("edited")?.jsonPrimitive?.booleanOrNull == true) ts else null,
                    expiresAt = plain?.get("expiresAt")?.jsonPrimitive?.longOrNull,
                    ap = plain?.get("ap")?.jsonPrimitive?.booleanOrNull,
                    reactions = (envelope["reactions"] as? JsonObject)?.let { reactionsFromJson(it) } ?: emptyMap(),
                )
                if (own.body != null || own.media != null) { CryptoGroup.markBackupDirty(); FcDb.put("messages", mid, messageToJson(own)) }
                return own
            }
            return null
        }

        // peer message
        val plain: JsonObject? = if (isGroup) {
            CryptoGroup.groupDecrypt(chatId, senderId, envelope) as? JsonObject
        } else {
            CryptoSessions.decryptFrom(senderId, envelope) as? JsonObject
        }
        val msgOut = Message(
            id = mid, chatId = chatId, senderId = senderId, ts = ts,
            type = MsgType.fromWire(typeStr),
            body = plain?.get("body")?.jsonPrimitive?.contentOrNull,
            media = (plain?.get("media") as? JsonObject)?.let { Wire.mediaFromJson(it) },
            replyTo = (plain?.get("replyTo") as? JsonObject)?.let { com.fcfc.app.model.ReplyRef(it["id"]?.jsonPrimitive?.contentOrNull ?: "", it["body"]?.jsonPrimitive?.contentOrNull ?: "", it["senderId"]?.jsonPrimitive?.contentOrNull ?: "") },
            fwdFrom = plain?.get("fwdFrom")?.jsonPrimitive?.contentOrNull,
            editedAt = if (plain?.get("edited")?.jsonPrimitive?.booleanOrNull == true) ts else null,
            expiresAt = plain?.get("expiresAt")?.jsonPrimitive?.longOrNull,
            ap = plain?.get("ap")?.jsonPrimitive?.booleanOrNull,
            reactions = (envelope["reactions"] as? JsonObject)?.let { reactionsFromJson(it) } ?: emptyMap(),
        )
        if (msgOut.body != null || msgOut.media != null) { CryptoGroup.markBackupDirty(); FcDb.put("messages", mid, messageToJson(msgOut)) }
        msgOut
    } catch (e: Exception) {
        val msg = e.message ?: ""
        val typeStr = row["type"]?.jsonPrimitive?.contentOrNull
        val transient = typeStr == "sender-key" || typeStr == "call" || typeStr == "self-copy" ||
            msg.contains("no session and no handshake") || msg.contains("sender key missing") ||
            msg.contains("identity") || msg.contains("OperationError") || msg.contains("keys")
        val failedMid = row["mid"]?.jsonPrimitive?.contentOrNull
        if (!transient && failedMid != null) synchronized(failedDecryptIds) {
            failedDecryptIds[failedMid] = chatId
        }
        null
        } ?: null
    }

    private fun reactionsFromJson(o: JsonObject): Map<String, List<String>> =
        o.entries.associate { (k, v) ->
            k to ((v as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList())
        }

    private fun messageToJson(m: Message): JsonObject = buildJsonObject {
        put("id", m.id); put("chatId", m.chatId); put("senderId", m.senderId); put("ts", m.ts)
        put("type", m.type.wire)
        m.body?.let { put("body", it) }
        m.media?.let { put("media", JSON.encodeToJsonElement(com.fcfc.app.model.MediaMeta.serializer(), it)) }
        m.replyTo?.let { put("replyTo", JSON.encodeToJsonElement(com.fcfc.app.model.ReplyRef.serializer(), it)) }
        m.fwdFrom?.let { put("fwdFrom", it) }
        m.editedAt?.let { put("editedAt", it) }
        m.expiresAt?.let { put("expiresAt", it) }
        put("reactions", buildJsonObject { m.reactions.forEach { (k, v) -> put(k, JsonArray(v.map { JsonPrimitive(it) })) } })
        m.ap?.let { put("ap", it) }
        m.starred?.let { put("starred", it) }
    }

    private fun messageFromJson(j: JsonObject): Message = Message(
        id = j["id"]?.jsonPrimitive?.contentOrNull ?: "",
        chatId = j["chatId"]?.jsonPrimitive?.contentOrNull ?: "",
        senderId = j["senderId"]?.jsonPrimitive?.contentOrNull ?: "",
        ts = j["ts"]?.jsonPrimitive?.longOrNull ?: 0,
        type = MsgType.fromWire(j["type"]?.jsonPrimitive?.contentOrNull),
        body = j["body"]?.jsonPrimitive?.contentOrNull,
        media = (j["media"] as? JsonObject)?.let { Wire.mediaFromJson(it) },
        replyTo = (j["replyTo"] as? JsonObject)?.let { com.fcfc.app.model.ReplyRef(it["id"]?.jsonPrimitive?.contentOrNull ?: "", it["body"]?.jsonPrimitive?.contentOrNull ?: "", it["senderId"]?.jsonPrimitive?.contentOrNull ?: "") },
        fwdFrom = j["fwdFrom"]?.jsonPrimitive?.contentOrNull,
        editedAt = j["editedAt"]?.jsonPrimitive?.longOrNull,
        expiresAt = j["expiresAt"]?.jsonPrimitive?.longOrNull,
        reactions = (j["reactions"] as? JsonObject)?.let { reactionsFromJson(it) } ?: emptyMap(),
        ap = j["ap"]?.jsonPrimitive?.booleanOrNull,
        starred = j["starred"]?.jsonPrimitive?.booleanOrNull,
    )

    // ── send ───────────────────────────────────────────────────────────────
    suspend fun sendDraft(chatId: String, draft: SendDraft) {
        val me = AuthStore.user.value ?: return
        val chat = chats.value[chatId] ?: return
        val id = "m_" + newId().replace("-", "").substring(0, 20)
        val list = messages.value[chatId] ?: emptyList()
        val ts = maxOf(System.currentTimeMillis(), (list.lastOrNull()?.ts ?: 0L) + 1)
        val expiresAt = draft.ttl?.let { ts + it * 1000 }
        val local = Message(
            id = id, chatId = chatId, senderId = me.id, ts = ts, type = draft.type,
            body = draft.body, media = draft.media, replyTo = draft.replyTo, fwdFrom = draft.fwdFrom,
            reactions = emptyMap(), pending = true, expiresAt = expiresAt,
            ap = if (draft.type == MsgType.VOICE) draft.autoPlay else null,
        )
        appendMessage(chatId, local)
        setReplyingPreview(chatId, local)
        try {
            val plain = buildJsonObject {
                draft.body?.let { put("body", it) }
                draft.media?.let { put("media", JSON.encodeToJsonElement(com.fcfc.app.model.MediaMeta.serializer(), it)) }
                draft.replyTo?.let { put("replyTo", JSON.encodeToJsonElement(com.fcfc.app.model.ReplyRef.serializer(), it)) }
                draft.fwdFrom?.let { put("fwdFrom", it) }
                expiresAt?.let { put("expiresAt", it) }
                if (draft.autoPlay == true) put("ap", true)
            }
            var payload: JsonObject
            var selfEnv: JsonObject? = null
            if (chat.kind == ChatKind.GROUP) {
                distributeSenderKeys(chatId, chat, ts)
                payload = CryptoGroup.groupEncrypt(chatId, me.id, plain)
            } else {
                val targetId = chat.peer?.id ?: me.id
                payload = CryptoSessions.encryptFor(targetId, plain)
                runCatching { selfEnv = CryptoSessions.encryptFor(me.id, plain) }
            }
            sendRaw(chatId, buildJsonObject {
                put("t", "msg"); put("chatId", chatId)
                put("m", buildJsonObject {
                    put("id", id); put("ts", ts); put("type", draft.type.wire)
                    put("payload", payload)
                    selfEnv?.let { put("self", it) }
                })
            })
        } catch (e: Exception) {
            val l = messages.value[chatId] ?: emptyList()
            messages.value = messages.value + (chatId to l.map { if (it.id == id) it.copy(pending = false, failed = true) else it })
        }
        if (replyingTo.value != null) replyingTo.value = null
    }

    fun setTyping(on: Boolean) {
        val chatId = activeChatId.value ?: return
        sendRaw(chatId, buildJsonObject { put("t", "typing"); put("chatId", chatId); put("on", on) })
    }

    private fun sendRaw(chatId: String, obj: JsonObject) = SocketManager.sendChat(chatId, obj)

    suspend fun editMessage(chatId: String, id: String, body: String) {
        val chat = chats.value[chatId] ?: return
        val me = AuthStore.userId
        val plain = buildJsonObject { put("body", body); put("edited", true) }
        try {
            val payload = if (chat.kind == ChatKind.GROUP) CryptoGroup.groupEncrypt(chatId, me, plain)
            else CryptoSessions.encryptFor(chat.peer?.id ?: me, plain)
            sendRaw(chatId, buildJsonObject { put("t", "edit"); put("chatId", chatId); put("id", id); put("payload", payload) })
            applyEdit(chatId, id, body)
        } catch (_: Exception) { }
    }

    fun deleteForEveryone(chatId: String, id: String) = deleteForEveryone(chatId, listOf(id))

    fun deleteForEveryone(chatId: String, ids: List<String>) {
        val chatIdSafe = chatId
        sendRaw(chatIdSafe, buildJsonObject { put("t", "delAll"); put("chatId", chatIdSafe); put("ids", JsonArray(ids.map { JsonPrimitive(it) })) })
        vanish.value = vanish.value + ids.toSet()
    }

    suspend fun deleteForMe(chatId: String, id: String) = deleteForMe(chatId, listOf(id))

    suspend fun deleteForMe(chatId: String, ids: List<String>) {
        val l = messages.value[chatId] ?: emptyList()
        messages.value = messages.value + (chatId to l.filter { !ids.contains(it.id) })
        ids.forEach { runCatching { FcDb.del("messages", it) } }
        try {
            val key = "del:$chatId"
            val t = ((FcDb.get("meta", key) as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()).toMutableList()
            t.addAll(ids)
            FcDb.put("meta", key, JsonArray(t.distinct().map { JsonPrimitive(it) }))
        } catch (_: Exception) { }
    }

    fun finishVanish(id: String) {
        val chatIds = messages.value.keys
        vanish.value = vanish.value - id
        for (chatId in chatIds) {
            val l = messages.value[chatId] ?: continue
            if (l.any { it.id == id }) {
                messages.value = messages.value + (chatId to l.filter { it.id != id })
                scope.launch { runCatching { FcDb.del("messages", id) } }
            }
        }
    }

    suspend fun toggleReaction(chatId: String, id: String, emoji: String) {
        val me = AuthStore.userId
        val msg = (messages.value[chatId] ?: emptyList()).firstOrNull { it.id == id }
        val on = !(msg?.reactions?.get(emoji) ?: emptyList()).contains(me)
        sendRaw(chatId, buildJsonObject { put("t", "react"); put("chatId", chatId); put("id", id); put("emoji", emoji); put("on", on) })
        applyReaction(chatId, id, emoji, me, on)
    }

    suspend fun toggleStar(chatId: String, id: String) {
        val msg = (messages.value[chatId] ?: emptyList()).firstOrNull { it.id == id } ?: return
        val on = !starredIds.value.contains(msg.id)
        starredIds.value = starredIds.value + msg.id
        if (!on) starredIds.value = starredIds.value - msg.id
        if (on) FcDb.put("starred", msg.id, messageToJson(msg.copy(starred = true)))
        else FcDb.del("starred", msg.id)
    }

    fun togglePinMessage(chatId: String, id: String) {
        sendRaw(chatId, buildJsonObject { put("t", "pin"); put("chatId", chatId); put("mid", id) })
    }

    suspend fun patchChatState(chatId: String, patch: Map<String, JsonElement>) {
        val obj = buildJsonObject { patch.forEach { (k, v) -> put(k, v) } }
        patchChatState(chatId, obj)
    }

    suspend fun patchChatState(chatId: String, patch: JsonObject) {
        runCatching { ApiClient.patchChatState(chatId, patch) }
        if (patch["deleteForMe"]?.jsonPrimitive?.booleanOrNull == true) {
            // chat deleted locally — drop everything
            runCatching {
                for (m in FcDb.all("messages")) {
                    val j = m as? JsonObject ?: continue
                    if (j["chatId"]?.jsonPrimitive?.contentOrNull == chatId) {
                        FcDb.del("messages", j["id"]?.jsonPrimitive?.contentOrNull ?: continue)
                    }
                }
            }
            if (activeChatId.value == chatId) {
                SocketManager.disconnectChat(chatId)
                UiStore.closeRightPanel()
            }
            val chatsM = chats.value.toMutableMap(); chatsM.remove(chatId)
            val msgsM = messages.value.toMutableMap(); msgsM.remove(chatId)
            chats.value = chatsM
            messages.value = msgsM
            if (activeChatId.value == chatId) { activeChatId.value = null; replyingTo.value = null }
            return
        }
        val c = chats.value[chatId] ?: return
        var updated = c
        patch["pinned"]?.jsonPrimitive?.booleanOrNull?.let { updated = updated.copy(pinned = it) }
        patch["archived"]?.jsonPrimitive?.booleanOrNull?.let { updated = updated.copy(archived = it) }
        patch["mutedUntil"]?.jsonPrimitive?.longOrNull?.let { updated = updated.copy(mutedUntil = it) }
        patch["wallpaper"]?.jsonPrimitive?.contentOrNull?.let { updated = updated.copy(wallpaper = it) }
        patch["ttl"]?.jsonPrimitive?.longOrNull?.let { updated = updated.copy(ttl = it) }
        chats.value = chats.value + (chatId to updated)
    }

    fun markRead(chatId: String) {
        val msgs = messages.value[chatId] ?: emptyList()
        val me = AuthStore.userId
        val unreadIds = msgs.filter { it.senderId != me && it.read != true && it.delivered != true }.map { it.id }
        if (unreadIds.isNotEmpty()) {
            sendRaw(chatId, buildJsonObject { put("t", "read"); put("chatId", chatId); put("ids", JsonArray(unreadIds.map { JsonPrimitive(it) })) })
        }
        val c = chats.value[chatId] ?: return
        if (c.unread != 0L) chats.value = chats.value + (chatId to c.copy(unread = 0))
        scope.launch {
            runCatching {
                ApiClient.patchChatState(chatId, buildJsonObject { put("unread", 0); put("lastReadTs", System.currentTimeMillis()) })
            }
        }
    }

    fun setReplying(m: Message?) { replyingTo.value = m }

    suspend fun jumpToMessage(chatId: String, id: String): Boolean {
        for (i in 0 until 10) {
            val list = messages.value[chatId] ?: emptyList()
            if (list.any { it.id == id }) {
                jumpTarget.value = chatId to id
                return true
            }
            if (loadedAll.value.contains(chatId) || list.isEmpty()) return false
            runCatching { loadHistory(chatId, list.first().ts) }
            kotlinx.coroutines.delay(160)
        }
        return false
    }

    suspend fun localSearch(chatId: String, query: String): List<Message> {
        val needle = query.lowercase()
        return FcDb.all("messages")
            .mapNotNull { it as? JsonObject }
            .map { messageFromJson(it) }
            .filter { (it.body ?: "").lowercase().contains(needle) }
            .sortedByDescending { it.ts }
            .take(100)
    }

    suspend fun starredList(): List<Pair<Chat, Message>> {
        return FcDb.all("starred")
            .mapNotNull { it as? JsonObject }
            .map { messageFromJson(it) }
            .sortedByDescending { it.ts }
            .mapNotNull { m -> chats.value[m.chatId]?.let { it to m } }
    }

    suspend fun exportChat(chatId: String): String {
        val msgs = messages.value[chatId] ?: emptyList()
        val chat = chats.value[chatId]
        val name = { id: String -> chat?.members?.firstOrNull { it.id == id }?.username ?: id }
        val lines = msgs.map { m ->
            "[${java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(java.util.Date(m.ts))}] ${name(m.senderId)}: ${m.body ?: "(${m.type.wire})"}"
        }
        val title = chat?.title ?: chat?.peer?.username ?: ""
        return "fcfc chat export — $title\n\n${lines.joinToString("\n")}"
    }

    class DmResult(val chatId: String?, val request: Boolean)

    suspend fun createDm(userId: String): String? {
        val res = ApiClient.createDm(userId)
        if (res["request"]?.jsonPrimitive?.booleanOrNull == true) return null
        val chatId = res["chatId"]?.jsonPrimitive?.contentOrNull ?: return null
        loadChats()
        return chatId
    }

    suspend fun openSaved(): String {
        val me = AuthStore.userId
        val existing = chats.value.values.firstOrNull { it.kind == ChatKind.DM && it.peer == null && it.saved == true }
        if (existing != null) return existing.id
        // find in server rows (saved = self-chat)
        val res = ApiClient.createDm(me)
        val chatId = res["chatId"]?.jsonPrimitive?.contentOrNull ?: ""
        loadChats()
        return chatId
    }

    suspend fun createGroup(title: String, description: String?, memberIds: List<String>, limit: Int = 200): String? {
        val res = ApiClient.createGroup(title, description, memberIds, limit)
        val chatId = res["chatId"]?.jsonPrimitive?.contentOrNull ?: return null
        loadChats()
        return chatId
    }

    suspend fun joinInvite(code: String): String? {
        val res = runCatching { ApiClient.joinByInvite(code) }.getOrNull() ?: return null
        val chatId = res["chatId"]?.jsonPrimitive?.contentOrNull ?: return null
        loadChats()
        return chatId
    }

    suspend fun respondRequest(fromId: String, accept: Boolean) {
        runCatching { ApiClient.respondRequest(fromId, accept) }
        loadRequests()
    }

    fun bumpEmojiPlay(chatId: String, id: String) {
        emojiPlays.value = emojiPlays.value + (id to (emojiPlays.value[id] ?: 0) + 1)
    }

    fun replaySoloEmoji(chatId: String, id: String) {
        bumpEmojiPlay(chatId, id)
        sendRaw(chatId, buildJsonObject { put("t", "emoji-replay"); put("chatId", chatId); put("id", id) })
    }

    suspend fun searchUsers(query: String): List<User> = runCatching { ApiClient.searchUsers(query) }.getOrDefault(emptyList())

    // ── realtime event handling (ChatRoom socket) ─────────────────────────
    private suspend fun event(chatId: String, ev: JsonObject) {
        val me = AuthStore.userId
        when (ev["t"]?.jsonPrimitive?.contentOrNull) {
            "hello" -> {
                // room snapshot: pins / typing / active call state
                (ev["pins"] as? JsonArray)?.let { pins ->
                    val c = chats.value[chatId]
                    if (c != null) chats.value = chats.value + (chatId to c.copy(pins = pins.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }))
                }
            }
            "msg" -> {
                val m = ev["m"] as? JsonObject ?: return
                val senderId = m["senderId"]?.jsonPrimitive?.contentOrNull ?: ""
                val mid = m["id"]?.jsonPrimitive?.contentOrNull ?: ""
                if (senderId == me) {
                    // server echo = saved + broadcast → clear pending clock
                    val l = messages.value[chatId] ?: emptyList()
                    if (l.any { it.id == mid }) {
                        var changed = false
                        val next = l.map { x ->
                            if (x.id == mid && (x.pending == true || x.failed == true)) { changed = true; x.copy(pending = false, failed = false) } else x
                        }
                        if (changed) messages.value = messages.value + (chatId to next)
                        if (messages.value[chatId]?.any { it.id == mid } == true) return
                    }
                }
                val row = buildJsonObject {
                    put("mid", mid); put("sender_id", senderId)
                    put("ts", m["ts"]?.jsonPrimitive?.longOrNull ?: System.currentTimeMillis())
                    put("type", m["type"]?.jsonPrimitive?.contentOrNull ?: "text")
                    m["payload"]?.let { put("payload", it) }
                }
                val msg = rowToMessage(chatId, row, m["self"] as? JsonObject)
                if (msg == null) {
                    val typeStr = m["type"]?.jsonPrimitive?.contentOrNull
                    if (senderId != me && typeStr != "sender-key" && typeStr != "call" && chats.value[chatId]?.kind != ChatKind.GROUP
                        && System.currentTimeMillis() - (lastRenego[chatId] ?: 0) > 10_000) {
                        lastRenego[chatId] = System.currentTimeMillis()
                        sendRaw(chatId, buildJsonObject { put("t", "renego"); put("chatId", chatId); put("from", me) })
                    }
                    if (senderId != me && chats.value[chatId]?.kind == ChatKind.GROUP && typeStr != "sender-key" && typeStr != "call") {
                        runCatching {
                            if (!CryptoGroup.hasSenderKey(chatId, senderId)) requestSenderKey(chatId)
                        }
                    }
                    return
                }
                if (healFailedChat(chatId)) runCatching { loadHistory(chatId) }
                appendMessage(chatId, msg)
                setReplyingPreview(chatId, msg)
                if (senderId != me) {
                    sendRaw(chatId, buildJsonObject { put("t", "delivered"); put("chatId", chatId); put("ids", JsonArray(listOf(JsonPrimitive(mid)))) })
                    val active = activeChatId.value == chatId
                    if (active) {
                        markRead(chatId)
                    } else {
                        val c = chats.value[chatId]
                        if (c != null) chats.value = chats.value + (chatId to c.copy(unread = (c.unread) + 1))
                        val c2 = chats.value[chatId]
                        if (c2 != null && !(c2.mutedUntil != null && c2.mutedUntil!! > System.currentTimeMillis())) {
                            Notify.message(c2, msg)
                        }
                    }
                }
                msg.expiresAt?.let { scheduleExpiry(chatId, msg.id, it) }
            }
            "msg-rejected" -> {
                val id = ev["id"]?.jsonPrimitive?.contentOrNull ?: return
                val l = messages.value[chatId] ?: emptyList()
                messages.value = messages.value + (chatId to l.map { if (it.id == id) it.copy(pending = false, failed = true) else it })
                UiStore.toast(com.fcfc.app.core.I18n.t("msgRejected"))
            }
            "delivered", "read" -> {
                val from = ev["from"]?.jsonPrimitive?.contentOrNull ?: return
                if (from == me) return
                val ids = (ev["ids"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: return
                val isRead = ev["t"]?.jsonPrimitive?.contentOrNull == "read"
                if (isRead) {
                    val sb = seenBy.value.toMutableMap()
                    for (id in ids) {
                        val cur: Map<String, List<String>> = sb[id] ?: emptyMap()
                        val curList: List<String> = cur[chatId] ?: emptyList()
                        sb[id] = cur + (chatId to (curList + from).distinct())
                    }
                    seenBy.value = sb
                }
                val l = messages.value[chatId] ?: emptyList()
                messages.value = messages.value + (chatId to l.map { m ->
                    if (ids.contains(m.id) && m.senderId == me) {
                        if (isRead) m.copy(read = true) else m.copy(delivered = true)
                    } else m
                })
            }
            "typing" -> {
                val from = ev["from"]?.jsonPrimitive?.contentOrNull ?: return
                if (from == me) return
                val c = chats.value[chatId] ?: return
                val on = ev["on"]?.jsonPrimitive?.booleanOrNull ?: false
                val typing = (c.typing ?: emptyList()).toMutableList()
                if (on && !typing.contains(from)) typing.add(from)
                if (!on) typing.remove(from)
                chats.value = chats.value + (chatId to c.copy(typing = typing))
                if (on) {
                    scope.launch {
                        delay(6000)
                        val c2 = chats.value[chatId] ?: return@launch
                        chats.value = chats.value + (chatId to c2.copy(typing = (c2.typing ?: emptyList()) - from))
                    }
                }
            }
            "presence" -> {
                val userId = ev["userId"]?.jsonPrimitive?.contentOrNull ?: return
                val online = ev["online"]?.jsonPrimitive?.booleanOrNull ?: false
                presence.value = presence.value + (userId to online)
                if (!online) {
                    val updated = chats.value.mapValues { (_, c) ->
                        if (c.kind == ChatKind.DM && c.peer?.id == userId) c.copy(peer = c.peer?.copy(lastSeenAt = System.currentTimeMillis())) else c
                    }
                    chats.value = updated
                }
            }
            "renego" -> {
                val from = ev["from"]?.jsonPrimitive?.contentOrNull ?: return
                if (from.isNotEmpty() && from != me && chats.value[chatId]?.kind != ChatKind.GROUP) {
                    CryptoSessions.deleteSession(from)
                }
            }
            "skrequest" -> {
                val from = ev["from"]?.jsonPrimitive?.contentOrNull ?: return
                val evChatId = ev["chatId"]?.jsonPrimitive?.contentOrNull ?: chatId
                if (from.isNotEmpty() && from != me) {
                    runCatching { CryptoGroup.markNeedsRedistribution(evChatId, listOf(from)) }
                    val chat = chats.value[evChatId]
                    if (chat?.kind == ChatKind.GROUP) distributeSenderKeys(evChatId, chat)
                }
            }
            "edit" -> {
                try {
                    val c = chats.value[chatId] ?: return
                    val from = ev["from"]?.jsonPrimitive?.contentOrNull ?: return
                    val payload = ev["payload"] as? JsonObject ?: return
                    val id = ev["id"]?.jsonPrimitive?.contentOrNull ?: return
                    val plain = if (c.kind == ChatKind.GROUP) {
                        CryptoGroup.groupDecrypt(chatId, from, payload) as? JsonObject
                    } else {
                        CryptoSessions.decryptFrom(from, payload) as? JsonObject
                    }
                    applyEdit(chatId, id, plain?.get("body")?.jsonPrimitive?.contentOrNull ?: return)
                } catch (_: Exception) { }
            }
            "delAll" -> {
                val ids = (ev["ids"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: return
                vanish.value = vanish.value + ids.toSet()
            }
            "react" -> {
                val id = ev["id"]?.jsonPrimitive?.contentOrNull ?: return
                val emoji = ev["emoji"]?.jsonPrimitive?.contentOrNull ?: return
                val from = ev["from"]?.jsonPrimitive?.contentOrNull ?: return
                val on = ev["on"]?.jsonPrimitive?.booleanOrNull ?: false
                applyReaction(chatId, id, emoji, from, on)
            }
            "emoji-replay" -> {
                val from = ev["from"]?.jsonPrimitive?.contentOrNull ?: return
                val id = ev["id"]?.jsonPrimitive?.contentOrNull ?: return
                if (from != me) bumpEmojiPlay(chatId, id)
            }
            "pins" -> {
                val c = chats.value[chatId] ?: return
                val pins = (ev["pins"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                chats.value = chats.value + (chatId to c.copy(pins = pins))
            }
            "call" -> handleCallEvent(chatId, ev)
        }
    }

    // ── UserHub events ────────────────────────────────────────────────────
    private suspend fun hub(ev: JsonObject) {
        val me = AuthStore.userId
        when (ev["t"]?.jsonPrimitive?.contentOrNull) {
            "device-approval" -> UiStore.openModal("device-approval", buildJsonObject {
                put("deviceId", ev["deviceId"]?.jsonPrimitive?.contentOrNull ?: "")
                put("deviceName", ev["deviceName"]?.jsonPrimitive?.contentOrNull ?: "")
            }.toString())
            "device-revoked" -> {
                val deviceId = ev["deviceId"]?.jsonPrimitive?.contentOrNull ?: ""
                if (deviceId == ApiClient.deviceId()) {
                    AuthStore.forceLogout()
                    reset()
                }
            }
            "request-declined" -> {
                val chatId = ev["chatId"]?.jsonPrimitive?.contentOrNull ?: return
                if (chats.value.containsKey(chatId)) {
                    val m = chats.value.toMutableMap(); m.remove(chatId)
                    chats.value = m
                    if (activeChatId.value == chatId) activeChatId.value = null
                }
            }
            "message-request" -> {
                loadRequests()
                UiStore.toast(com.fcfc.app.core.I18n.t("newReqToast"))
            }
            "request-accepted" -> {
                loadChats()
                UiStore.toast(com.fcfc.app.core.I18n.t("reqAcceptedToast"))
            }
            "chat-new", "chat-updated" -> loadChats()
            "call" -> {
                val chatId = ev["chatId"]?.jsonPrimitive?.contentOrNull ?: return
                handleCallEvent(chatId, ev)
            }
            "members-changed" -> {
                val added = (ev["added"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()
                if (added.isNotEmpty() && !added.contains(me)) {
                    runCatching { CryptoGroup.markNeedsRedistribution(ev["chatId"]?.jsonPrimitive?.contentOrNull ?: return, added) }
                }
                loadChats()
            }
            "removed-from-chat" -> {
                val chatId = ev["chatId"]?.jsonPrimitive?.contentOrNull ?: return
                val m = chats.value.toMutableMap(); m.remove(chatId)
                chats.value = m
                if (activeChatId.value == chatId) activeChatId.value = null
            }
            "msg" -> {
                val chatId = ev["chatId"]?.jsonPrimitive?.contentOrNull ?: return
                val c = chats.value[chatId] ?: return
                val from = ev["from"]?.jsonPrimitive?.contentOrNull ?: ""
                val mid = ev["mid"]?.jsonPrimitive?.contentOrNull
                val own = from == me
                val alreadyHave = mid != null && (messages.value[chatId] ?: emptyList()).any { it.id == mid }
                val openHere = activeChatId.value == chatId
                if (!own && !alreadyHave && !openHere) {
                    chats.value = chats.value + (chatId to c.copy(unread = c.unread + 1))
                }
                if (!own && !alreadyHave && !openHere && !(c.mutedUntil != null && c.mutedUntil!! > System.currentTimeMillis())) {
                    Notify.message(c, Message(id = mid ?: "", chatId = chatId, senderId = from, ts = System.currentTimeMillis(), body = com.fcfc.app.core.I18n.t("newEncryptedMsg")))
                }
                if (mid != null) reloadChatSoon(chatId)
            }
            "presence" -> {
                val userId = ev["userId"]?.jsonPrimitive?.contentOrNull ?: return
                if (userId.isEmpty() || userId == me) return
                val online = ev["online"]?.jsonPrimitive?.booleanOrNull ?: false
                if (presence.value[userId] != online) {
                    presence.value = presence.value + (userId to online)
                }
                if (!online) {
                    val updated = chats.value.mapValues { (_, c) ->
                        if (c.kind == ChatKind.DM && c.peer?.id == userId) c.copy(peer = c.peer?.copy(lastSeenAt = System.currentTimeMillis())) else c
                    }
                    chats.value = updated
                }
            }
        }
    }

    // ── call events ────────────────────────────────────────────────────────
    private fun handleCallEvent(chatId: String, ev: JsonObject) {
        val me = AuthStore.userId
        val call = ev["call"] as? JsonObject
        val c = chats.value[chatId]
        if (c != null) {
            val activeCall = call?.let { JSON.decodeFromJsonElement(com.fcfc.app.model.ActiveCall.serializer(), it) }
            chats.value = chats.value + (chatId to c.copy(activeCall = activeCall))
        }
        if (me.isEmpty() || ev["from"]?.jsonPrimitive?.contentOrNull == me) return
        val action = ev["action"]?.jsonPrimitive?.contentOrNull
        val current = UiStore.call.value
        when {
            action == "start" && call != null && current == null -> {
                val auto = call["auto"]?.jsonPrimitive?.booleanOrNull == true
                if (auto) {
                    UiStore.setCall(com.fcfc.app.model.CallUi(chatId = chatId, mode = if (call["mode"]?.jsonPrimitive?.contentOrNull == "video") "video" else "audio", incoming = false, auto = true))
                    UiStore.toast(com.fcfc.app.core.I18n.t("callAutoAnswered"))
                } else {
                    UiStore.setCall(com.fcfc.app.model.CallUi(chatId = chatId, mode = if (call["mode"]?.jsonPrimitive?.contentOrNull == "video") "video" else "audio", incoming = true))
                }
            }
            action == "decline" && current != null && current.incoming != true && current.chatId == chatId -> {
                UiStore.setCall(null)
                UiStore.toast(com.fcfc.app.core.I18n.t("callDeclinedToast"))
            }
            action == "end" -> {
                val isDm = chats.value[chatId]?.kind == ChatKind.DM
                if (current != null && current.chatId == chatId && (current.incoming == true || isDm || call == null)) {
                    val wasIncoming = current.incoming == true
                    UiStore.setCall(null)
                    UiStore.toast(if (wasIncoming) com.fcfc.app.core.I18n.t("callMissedToast") else com.fcfc.app.core.I18n.t("callEndedToast"))
                }
            }
        }
    }

    // ── helpers ────────────────────────────────────────────────────────────
    fun previewOf(m: Message): String = when (m.type) {
        MsgType.TEXT -> m.body ?: ""
        MsgType.IMAGE -> com.fcfc.app.core.I18n.t("pImage")
        MsgType.VIDEO -> com.fcfc.app.core.I18n.t("pVideo")
        MsgType.VOICE -> com.fcfc.app.core.I18n.t("pVoice")
        MsgType.FILE -> "📎 ${m.media?.name ?: com.fcfc.app.core.I18n.t("fileLabel")}"
        MsgType.STICKER -> com.fcfc.app.core.I18n.t("pSticker")
        MsgType.GIF -> com.fcfc.app.core.I18n.t("pGif")
        MsgType.CALL -> com.fcfc.app.core.I18n.t("pCall")
        else -> ""
    }

    fun appendMessage(chatId: String, msg: Message) {
        val list = messages.value[chatId] ?: emptyList()
        if (list.any { it.id == msg.id }) return
        val lastTs = list.lastOrNull()?.ts ?: 0L
        val m2 = if (msg.ts <= lastTs) msg.copy(ts = lastTs + 1) else msg
        messages.value = messages.value + (chatId to (list + m2).sortedBy { it.ts })
        if ((m2.body != null || m2.media != null) && m2.type != MsgType.SENDER_KEY) {
            CryptoGroup.markBackupDirty()
            scope.launch { runCatching { FcDb.put("messages", m2.id, messageToJson(m2)) } }
        }
    }

    private fun setReplyingPreview(chatId: String, msg: Message) {
        val c = chats.value[chatId] ?: return
        chats.value = chats.value + (chatId to c.copy(lastPreview = previewOf(msg), lastTs = msg.ts))
    }

    private fun applyEdit(chatId: String, id: String, text: String) {
        val l = messages.value[chatId] ?: emptyList()
        messages.value = messages.value + (chatId to l.map { if (it.id == id) it.copy(body = text, editedAt = System.currentTimeMillis()) else it })
        scope.launch {
            val m = FcDb.get("messages", id) as? JsonObject
            if (m != null) {
                FcDb.put("messages", id, buildJsonObject {
                    m.forEach { (k, v) ->
                        if (k == "body") put("body", text) else put(k, v)
                    }
                    put("editedAt", System.currentTimeMillis())
                })
                CryptoGroup.markBackupDirty()
            }
        }
    }

    private fun applyReaction(chatId: String, id: String, emoji: String, userId: String, on: Boolean) {
        val l = messages.value[chatId] ?: emptyList()
        messages.value = messages.value + (chatId to l.map { m ->
            if (m.id != id) m else {
                val reactions = m.reactions.toMutableMap()
                val list = (reactions[emoji] ?: emptyList()).toMutableList()
                if (on) { if (!list.contains(userId)) list.add(userId) } else list.remove(userId)
                if (list.isEmpty()) reactions.remove(emoji) else reactions[emoji] = list
                m.copy(reactions = reactions)
            }
        })
    }

    private suspend fun distributeSenderKeys(chatId: String, chat: Chat, beforeTs: Long? = null) {
        val me = AuthStore.userId
        val distributed = distributedSet(chatId)
        val targets = chat.members.filter { it.id != me && it.deleted != true && !distributed.contains(it.id) }
        if (targets.isEmpty()) return
        val pkg = CryptoGroup.distributionPackage(chatId)
        for (t in targets) {
            try {
                val env = CryptoSessions.encryptFor(t.id, buildJsonObject { put("sk", pkg); put("chatId", chatId) })
                sendRaw(chatId, buildJsonObject {
                    put("t", "msg"); put("chatId", chatId)
                    put("m", buildJsonObject {
                        put("id", "sk_" + newId().replace("-", "").substring(0, 20))
                        put("ts", beforeTs?.let { it - 1 } ?: System.currentTimeMillis())
                        put("type", "sender-key")
                        put("payload", env)
                    })
                })
                CryptoGroup.markDistributed(chatId, t.id)
            } catch (_: Exception) { }
        }
    }

    private suspend fun distributedSet(chatId: String): Set<String> = CryptoGroup.distributedSet(chatId)

    private fun requestSenderKey(chatId: String) {
        if (System.currentTimeMillis() - (lastSkReq[chatId] ?: 0) < 10_000) return
        lastSkReq[chatId] = System.currentTimeMillis()
        sendRaw(chatId, buildJsonObject { put("t", "skrequest"); put("chatId", chatId) })
    }

    private fun scheduleExpiry(chatId: String, msgId: String, expiresAt: Long) {
        synchronized(expiryJobs) {
            if (expiryJobs.containsKey(msgId)) return
            val job = scope.launch {
                delay(maxOf(0, expiresAt - System.currentTimeMillis()))
                synchronized(expiryJobs) { expiryJobs.remove(msgId) }
                deleteForEveryone(chatId, listOf(msgId))
            }
            expiryJobs[msgId] = job
        }
    }

    // ── presence poll (60s safety net) ────────────────────────────────────
    private var presenceJob: Job? = null

    private suspend fun presenceTick() {
        try {
            val me = AuthStore.userId
            val peerIds = chats.value.values
                .filter { it.kind == ChatKind.DM && it.peer != null && it.peer.id != me && it.peer.deleted != true }
                .map { it.peer!!.id }
            if (peerIds.isNotEmpty()) {
                val out = runCatching { ApiClient.presence(peerIds) }.getOrDefault(emptyMap())
                var changed = false
                val p = presence.value.toMutableMap()
                for ((k, v) in out) {
                    if (p[k] != v) { p[k] = v; changed = true }
                }
                if (changed) presence.value = p
            }
            // active DM peer last-seen refresh
            val active = chats.value[activeChatId.value ?: ""]
            if (active?.kind == ChatKind.DM && active.peer != null) {
                runCatching {
                    val u = ApiClient.userById(active.peer!!.id)
                    val c = chats.value[active.id]
                    if (c != null && c.peer?.id == u.id) {
                        chats.value = chats.value + (c.id to c.copy(peer = c.peer?.copy(lastSeenAt = u.lastSeenAt ?: 0)))
                    }
                }
            }
            // new-chat safety net
            runCatching {
                val rows = ApiClient.chatsRaw()
                val known = chats.value
                val hasNew = rows.any { r ->
                    val id = r["id"]?.jsonPrimitive?.contentOrNull ?: ""
                    val delBefore = r["deleted_before"]?.jsonPrimitive?.longOrNull ?: 0
                    val lastTs = r["last_ts"]?.jsonPrimitive?.longOrNull ?: 0
                    !known.containsKey(id) && !(delBefore > 0 && lastTs > 0 && delBefore >= lastTs)
                }
                if (hasNew) loadChats()
            }
        } catch (_: Exception) { }
    }

    private fun startPresencePoll() {
        stopPresencePoll()
        scope.launch { presenceTick() }
        presenceJob = scope.launch {
            while (true) {
                delay(60_000)
                presenceTick()
            }
        }
    }

    private fun stopPresencePoll() {
        presenceJob?.cancel(); presenceJob = null
    }

    // ── cross-device sync (login auto-load + hub debounced reload) ────────
    private fun loadAllHistories() {
        if (allHistoriesLoaded) return
        allHistoriesLoaded = true
        scope.launch {
            val seen = HashSet<String>()
            for (round in 0 until 2) {
                val ids = chats.value.keys.toList()
                for (chatId in ids) {
                    if (!booted.value) return@launch
                    if (seen.contains(chatId)) continue
                    seen.add(chatId)
                    runCatching { loadHistory(chatId) }
                }
                if (round == 0) delay(1200)
            }
        }
    }

    private fun reloadChatSoon(chatId: String) {
        val now = System.currentTimeMillis()
        if (hubReloadAt[chatId] != null && now - (hubReloadAt[chatId] ?: 0) < 2500) return
        hubReloadAt[chatId] = now
        scope.launch {
            delay(400)
            if (!booted.value || !chats.value.containsKey(chatId)) return@launch
            runCatching { loadHistory(chatId) }
        }
    }

    /** keys-restored hook (login) — reload all loaded histories. */
    fun onKeysRestored() {
        if (!booted.value) return
        synchronized(failedDecryptIds) { failedDecryptIds.clear() }
        val ids = messages.value.keys.toList()
        scope.launch {
            for (chatId in ids) {
                runCatching { loadHistory(chatId) }
                if (!booted.value) return@launch
            }
        }
    }
}
