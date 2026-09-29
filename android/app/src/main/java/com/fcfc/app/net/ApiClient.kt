package com.fcfc.app.net

import android.content.Context
import com.fcfc.app.model.DeviceInfo
import com.fcfc.app.model.Message
import com.fcfc.app.model.User
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.util.concurrent.TimeUnit

/**
 * OkHttp implementation — port of frontend/src/api/client.ts:
 *  - Bearer auth + single-flight auto-refresh on 401 (retry once)
 *  - ensureFreshToken() before WS connects (30s threshold, 5s throttle)
 *  - error body {"error": "..."} surfaced as [ApiException]
 *  - 204 → null
 * Server wire rows are mapped through [Wire].
 */
object ApiClient {
    val JSON = Json { ignoreUnknownKeys = true; isLenient = true }
    private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
    private val OCTET = "application/octet-stream".toMediaType()

    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .pingInterval(45, TimeUnit.SECONDS)   // WS keepalive at the HTTP layer
        .build()

    /** Fired when a refresh fails after a 401 → app must force-logout. */
    var onForceLogout: (() -> Unit)? = null

    // ── token persistence (fcfc.net prefs — mirrors localStorage 'fcfc.toks') ──
    private var appCtx: Context? = null
    private val toksMutex = Mutex()
    @Volatile private var access: String = ""
    @Volatile private var refreshTok: String = ""
    @Volatile private var lastFreshTry = 0L

    fun init(ctx: Context) {
        appCtx = ctx.applicationContext
        val p = ctx.getSharedPreferences("fcfc.net", Context.MODE_PRIVATE)
        access = p.getString("access", null) ?: ""
        refreshTok = p.getString("refresh", null) ?: ""
    }

    private fun saveTokens(a: String, r: String) {
        access = a; refreshTok = r
        appCtx?.getSharedPreferences("fcfc.net", Context.MODE_PRIVATE)?.edit()
            ?.putString("access", a)?.putString("refresh", r)?.apply()
    }

    private fun clearTokens() {
        access = ""; refreshTok = ""
        appCtx?.getSharedPreferences("fcfc.net", Context.MODE_PRIVATE)?.edit()?.clear()?.apply()
    }

    fun hasTokens(): Boolean = access.isNotEmpty()
    fun accessToken(): String = access

    // ── JWT helpers (decode only, like web atob) ──
    fun jwtPayload(token: String): JsonObject? = try {
        val part = token.split(".")[1]
        val b = java.util.Base64.getUrlDecoder().decode(part)
        JSON.parseToJsonElement(String(b)).jsonObject
    } catch (_: Exception) { null }

    fun deviceId(): String = jwtPayload(access)?.get("did")?.jsonPrimitive?.content ?: ""

    private fun accessExpiryMs(): Long =
        (jwtPayload(access)?.get("exp")?.jsonPrimitive?.longOrNull ?: 0L) * 1000L

    /** Single-flight refresh — port of tryRefresh(). */
    suspend fun tryRefresh(): Boolean = toksMutex.withLock {
        if (refreshTok.isEmpty()) return false
        try {
            val body = buildJsonObject { put("refresh", refreshTok) }
            val req = Request.Builder().url("${ServerConfig.baseUrl.value}/auth/refresh")
                .post(body.toString().toRequestBody(JSON_TYPE))
                .header("content-type", "application/json").build()
            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return false
                val j = JSON.parseToJsonElement(res.body!!.string()).jsonObject
                val newAccess = j["access"]?.jsonPrimitive?.content ?: return false
                saveTokens(newAccess, refreshTok)
                true
            }
        } catch (_: Exception) { false }
    }

    /** Pre-flight refresh before WS URLs / requests — port of ensureFreshToken(). */
    suspend fun ensureFreshToken() {
        if (access.isEmpty()) return
        if (accessExpiryMs() - System.currentTimeMillis() > 30_000L) return
        val now = System.currentTimeMillis()
        if (now - lastFreshTry < 5_000L) return
        lastFreshTry = now
        tryRefresh()
    }

    // ── core JSON request path (port of api()) ────────────────────────────
    suspend fun api(path: String, method: String? = null, body: JsonElement? = null,
                    noAuth: Boolean = false, headers: Map<String, String> = emptyMap()): JsonObject? {
        if (!noAuth) ensureFreshToken()
        val m = method ?: (if (body != null) "POST" else "GET")

        suspend fun doCall(): Response {
            val req = Request.Builder().url(ServerConfig.baseUrl.value + path).method(m,
                if (body != null) body.toString().toRequestBody(JSON_TYPE) else null
            ).apply {
                headers.forEach { (k, v) -> header(k, v) }
                if (body != null) header("content-type", "application/json")
                if (!noAuth && access.isNotEmpty()) header("authorization", "Bearer $access")
            }.build()
            return withContext(Dispatchers.IO) { http.newCall(req).execute() }
        }

        var res = doCall()
        if (res.code == 401 && !noAuth) {
            res.close()
            if (tryRefresh()) res = doCall()
            else { onForceLogout?.invoke(); throw ApiException(401, "unauthorized") }
        }
        return parse(res)
    }

    private fun parse(res: Response): JsonObject? {
        res.use {
            if (it.code == 204) return null
            val text = it.body?.string() ?: ""
            if (!it.isSuccessful) {
                val msg = try {
                    JSON.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content
                } catch (_: Exception) { null } ?: "HTTP ${it.code}"
                throw ApiException(it.code, msg)
            }
            if (text.isBlank()) return null
            return try { JSON.parseToJsonElement(text).jsonObject } catch (_: Exception) { null }
        }
    }

    private fun JsonObject?.orThrow(what: String): JsonObject =
        this ?: throw ApiException(500, "bad response: $what")

    private fun JsonObject.arr(key: String): JsonArray =
        (this[key] as? JsonArray) ?: JsonArray(emptyList())

    private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

    // ── URL helpers (port of mediaPath / mediaUrl) ─────────────────────────
    fun mediaPath(key: String): String =
        key.split("/").joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8") }

    fun mediaUrl(key: String?): String =
        if (key.isNullOrEmpty()) ""
        else "${ServerConfig.baseUrl.value}/media/${mediaPath(key)}?token=${java.net.URLEncoder.encode(access, "UTF-8")}"

    fun wsUrl(path: String): String =
        "${ServerConfig.wsUrl()}$path?token=${java.net.URLEncoder.encode(access, "UTF-8")}"

    // ── binary calls ───────────────────────────────────────────────────────
    private suspend fun exec(req: Request): okhttp3.ResponseBody = withContext(Dispatchers.IO) {
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw ApiException(res.code, "HTTP ${res.code}")
            res.body ?: throw ApiException(res.code, "empty body")
        }
    }

    suspend fun getBinary(url: String): ByteArray = exec(Request.Builder().url(url).get().build()).bytes()

    // ─────────────────────────────────────────────────────────────────────
    // Endpoint surface (shapes verified against worker/src/routes/*)
    // ─────────────────────────────────────────────────────────────────────

    suspend fun health(): JsonObject? = api("/")

    // ── auth ──
    class AuthResult(val user: User, val settings: JsonObject, val access: String, val refresh: String)

    suspend fun signup(body: JsonObject): AuthResult {
        val j = api("/auth/signup", "POST", body, noAuth = true).orThrow("signup")
        val a = j["access"]!!.jsonPrimitive.content
        val r = j["refresh"]!!.jsonPrimitive.content
        saveTokens(a, r)
        return AuthResult(Wire.user(j.obj("user") ?: j), buildJsonObject { }, a, r)
    }

    suspend fun login(username: String, passHash: String, deviceName: String, keys: JsonObject? = null): AuthResult {
        val body = buildJsonObject {
            put("username", username); put("password", passHash); put("deviceName", deviceName)
            keys?.let { put("keys", it) }
        }
        val j = api("/auth/login", "POST", body, noAuth = true).orThrow("login")
        val a = j["access"]!!.jsonPrimitive.content
        val r = j["refresh"]!!.jsonPrimitive.content
        saveTokens(a, r)
        return AuthResult(Wire.user(j.obj("user") ?: j), buildJsonObject { }, a, r)
    }

    suspend fun loginPin(uidCode: String, passcodeHash: String, deviceName: String): AuthResult {
        val body = buildJsonObject { put("uidcode", uidCode); put("passcode", passcodeHash); put("deviceName", deviceName) }
        val j = api("/auth/login-pin", "POST", body, noAuth = true).orThrow("login-pin")
        val a = j["access"]!!.jsonPrimitive.content
        val r = j["refresh"]!!.jsonPrimitive.content
        saveTokens(a, r)
        return AuthResult(Wire.user(j.obj("user") ?: j), buildJsonObject { }, a, r)
    }

    /** GET /me → {user, settings} — used by boot + after login. */
    suspend fun meFull(): Pair<User, JsonObject> {
        val j = api("/me").orThrow("me")
        return Wire.user(j.obj("user") ?: j) to (j.obj("settings") ?: buildJsonObject { })
    }

    suspend fun me(): User = meFull().first

    suspend fun logout(device: Boolean) {
        try { api("/auth/logout", "POST", buildJsonObject { put("device", device) }) }
        finally { clearTokens() }
    }

    suspend fun myDevices(): List<DeviceInfo> {
        val j = api("/me/devices").orThrow("devices")
        return j.arr("devices").mapNotNull { d ->
            runCatching {
                val o = d.jsonObject
                DeviceInfo(
                    id = o["id"]?.jsonPrimitive?.content ?: "",
                    name = o["name"]?.jsonPrimitive?.content ?: "",
                    approved = o["approved"]?.jsonPrimitive?.longOrNull ?: 0,
                    createdAt = o["created_at"]?.jsonPrimitive?.longOrNull ?: 0,
                    lastActive = o["last_active"]?.jsonPrimitive?.longOrNull ?: 0,
                )
            }.getOrNull()
        }
    }

    suspend fun decideDevice(deviceId: String, accept: Boolean) {
        api("/auth/devices/$deviceId/decision", "POST", buildJsonObject { put("accept", accept) })
    }

    suspend fun setPasscode(passwordHash: String, userIdCode: String?, passcodeHash: String?) {
        api("/me/passcode", "POST", buildJsonObject {
            put("password", passwordHash)
            userIdCode?.let { put("userIdCode", it) }
            passcodeHash?.let { put("passcode", it) }
        })
    }

    suspend fun deleteAccount(passwordHash: String) {
        try { api("/me/account", "DELETE", buildJsonObject { put("password", passwordHash) }) }
        finally { clearTokens() }
    }

    /** signup-time username/uidcode availability check. */
    suspend fun authCheck(map: Map<String, String>): JsonObject? {
        val q = map.entries.joinToString("&") { "${it.key}=${java.net.URLEncoder.encode(it.value, "UTF-8")}" }
        return api("/auth/check?$q", noAuth = true)
    }

    // ── users ──
    suspend fun searchUsers(q: String): List<User> {
        val j = api("/users/search?q=${java.net.URLEncoder.encode(q, "UTF-8")}").orThrow("search")
        return j.arr("results").map { Wire.user(it.jsonObject) }
    }

    suspend fun userById(id: String): User {
        val j = api("/users/$id").orThrow("user")
        return Wire.user(j.obj("user") ?: j)
    }

    suspend fun updateMe(patch: JsonObject): User {
        api("/me", "PATCH", patch)
        return me()
    }

    suspend fun updateSettings(settings: JsonObject) {
        api("/me", "PATCH", buildJsonObject { put("settings", settings) })
    }

    suspend fun presence(ids: List<String>): Map<String, Boolean> {
        if (ids.isEmpty()) return emptyMap()
        val j = api("/users/presence?ids=${java.net.URLEncoder.encode(ids.joinToString(","), "UTF-8")}").orThrow("presence")
        val out = mutableMapOf<String, Boolean>()
        j.forEach { (k, v) -> out[k] = (v as? kotlinx.serialization.json.JsonPrimitive)?.boolean ?: false }
        return out
    }

    suspend fun blocked(): List<User> {
        val j = api("/me/blocked").orThrow("blocked")
        return j.arr("results").map { Wire.user(it.jsonObject) }
    }

    suspend fun blockUser(id: String, on: Boolean) {
        if (on) api("/me/blocked/$id", "PUT", buildJsonObject { })
        else api("/me/blocked/$id", "DELETE")
    }

    // ── keys / backup ──
    suspend fun uploadKeyBundle(bundle: JsonObject) { api("/me/keys", "POST", bundle) }
    suspend fun fetchPrekeyBundle(userId: String): JsonObject? = api("/users/$userId/prekeys")
    suspend fun putBackup(blob: String, salt: String, pinBlob: String? = null, pinSalt: String? = null) {
        api("/me/backup", "PUT", buildJsonObject {
            put("blob", blob); put("salt", salt)
            pinBlob?.let { put("pinBlob", it) }
            pinSalt?.let { put("pinSalt", it) }
        })
    }

    suspend fun getBackup(): JsonObject? = api("/me/backup")

    /** pin-only upload — server keeps the main password blob intact. */
    suspend fun putBackupOnlyPin(pinBlob: String, pinSalt: String) {
        api("/me/backup", "PUT", buildJsonObject { put("pinBlob", pinBlob); put("pinSalt", pinSalt) })
    }

    // ── chats ──
    suspend fun chatsRaw(): List<JsonObject> {
        val j = api("/chats").orThrow("chats")
        return j.arr("chats").map { it.jsonObject }
    }

    /** GET /chats/:id → {chat, members}. */
    suspend fun chatDetail(id: String): Pair<JsonObject, List<com.fcfc.app.model.ChatMember>> {
        val j = api("/chats/$id").orThrow("chat")
        val members = j.arr("members").map { Wire.memberFromRow(it.jsonObject) }
        return (j.obj("chat") ?: j) to members
    }

    /** POST /chats {kind:'dm',with} → {chatId} | {request:true, requestId, chatId}. */
    suspend fun createDm(withUserId: String): JsonObject {
        return api("/chats", "POST", buildJsonObject { put("kind", "dm"); put("with", withUserId) }).orThrow("createDm")
    }

    /** POST /chats {kind:'group',...} → {chatId}. */
    suspend fun createGroup(title: String, description: String?, memberIds: List<String>, memberLimit: Int): JsonObject {
        return api("/chats", "POST", buildJsonObject {
            put("kind", "group"); put("title", title)
            description?.let { put("description", it) }
            put("memberIds", JsonArray(memberIds.map { kotlinx.serialization.json.JsonPrimitive(it) }))
            put("memberLimit", memberLimit)
        }).orThrow("createGroup")
    }

    suspend fun patchChat(chatId: String, patch: JsonObject) {
        api("/chats/$chatId", "PATCH", patch)
    }

    suspend fun joinByInvite(code: String): JsonObject {
        return api("/invites/$code/join", "POST", buildJsonObject { }).orThrow("join")
    }

    suspend fun inviteLinks(chatId: String): List<JsonObject> {
        val j = api("/chats/$chatId/invites").orThrow("invites")
        return j.arr("invites").map { it.jsonObject }
    }

    suspend fun createInviteLink(chatId: String): JsonObject {
        return api("/chats/$chatId/invites", "POST", buildJsonObject { }).orThrow("createInvite")
    }

    suspend fun addMembers(chatId: String, ids: List<String>) {
        api("/chats/$chatId/members", "POST", buildJsonObject {
            put("members", JsonArray(ids.map { kotlinx.serialization.json.JsonPrimitive(it) }))
        })
    }

    suspend fun setMemberRole(chatId: String, userId: String, admin: Boolean) {
        api("/chats/$chatId/admin", "POST", buildJsonObject { put("userId", userId); put("admin", admin) })
    }

    suspend fun removeMember(chatId: String, userId: String) {
        api("/chats/$chatId/members/$userId", "DELETE")
    }

    suspend fun leaveChat(chatId: String, myUserId: String) {
        removeMember(chatId, myUserId)
    }

    suspend fun deleteChat(chatId: String) { api("/chats/$chatId", "DELETE") }

    suspend fun patchChatState(chatId: String, patch: JsonObject): JsonObject? {
        return api("/me/chats/$chatId/state", "PATCH", patch)
    }

    /** GET /chats/:id/messages?before=&limit=80 → raw rows (snake_case). */
    suspend fun messagesRaw(chatId: String, before: Long?, limit: Int = 80): List<JsonObject> {
        val path = "/chats/$chatId/messages?limit=$limit" + (before?.let { "&before=$it" } ?: "")
        val j = api(path).orThrow("messages")
        return j.arr("messages").map { it.jsonObject }
    }

    class MessagesPage(val messages: List<Message>, val rowCount: Int)

    suspend fun messages(chatId: String, before: Long?, limit: Int = 80): MessagesPage {
        val rows = messagesRaw(chatId, before, limit)
        return MessagesPage(rows.map { Wire.messageFromRow(chatId, it) }, rows.size)
    }

    suspend fun requests(): List<JsonObject> {
        val j = api("/me/requests").orThrow("requests")
        return j.arr("requests").map { it.jsonObject }
    }

    /** returns chatId on accept. */
    suspend fun respondRequest(requestId: String, accept: Boolean): JsonObject? {
        return api("/requests/$requestId/${if (accept) "accept" else "decline"}", "POST", buildJsonObject { })
    }

    // ── media ──
    suspend fun uploadSmall(bytes: ByteArray, mime: String): String {
        ensureFreshToken()
        val req = Request.Builder().url("${ServerConfig.baseUrl.value}/media/upload/small")
            .post(bytes.toRequestBody(OCTET))
            .header("x-content-type", mime)
            .header("authorization", "Bearer $access")
            .build()
        val j = parse(withContext(Dispatchers.IO) { http.newCall(req).execute() }).orThrow("uploadSmall")
        return j["key"]?.jsonPrimitive?.content ?: ""
    }

    suspend fun uploadLarge(bytes: ByteArray, mime: String, name: String?, iv: String): String {
        val init = api("/media/upload/init", "POST", buildJsonObject {
            put("size", bytes.size.toLong()); put("mime", mime)
            name?.let { put("name", it) }; put("iv", iv)
        }).orThrow("uploadInit")
        val key = init["key"]!!.jsonPrimitive.content
        val uploadId = init["uploadId"]!!.jsonPrimitive.content
        val partSize = 8 * 1024 * 1024
        val parts = mutableListOf<JsonObject>()
        var pn = 1
        var off = 0
        while (off < bytes.size) {
            val end = minOf(off + partSize, bytes.size)
            val req = Request.Builder().url("${ServerConfig.baseUrl.value}/media/upload/part")
                .put(bytes.copyOfRange(off, end).toRequestBody(OCTET))
                .header("x-key", key).header("x-upload-id", uploadId).header("x-part-number", pn.toString())
                .header("authorization", "Bearer $access")
                .build()
            val pj = parse(withContext(Dispatchers.IO) { http.newCall(req).execute() }).orThrow("uploadPart")
            val etag = pj["part"]!!.jsonObject["etag"]!!.jsonPrimitive.content
            parts.add(buildJsonObject { put("partNumber", pn); put("etag", etag) })
            off = end; pn++
        }
        api("/media/upload/complete", "POST", buildJsonObject {
            put("key", key); put("uploadId", uploadId)
            put("parts", JsonArray(parts))
        })
        return key
    }

    class DownloadedFile(val bytes: ByteArray, val iv: String?, val name: String?, val mime: String?)

    suspend fun download(key: String): DownloadedFile {
        val res = withContext(Dispatchers.IO) {
            http.newCall(Request.Builder().url(mediaUrl(key)).get().build()).execute()
        }
        res.use {
            if (!it.isSuccessful) throw ApiException(it.code, "HTTP ${it.code}")
            val name = it.header("x-file-name")?.let { n -> runCatching { java.net.URLDecoder.decode(n, "UTF-8") }.getOrDefault(n) }
            return DownloadedFile(it.body?.bytes() ?: ByteArray(0), it.header("x-file-iv"), name, it.header("content-type"))
        }
    }

    suspend fun uploadAvatar(bytes: ByteArray, mime: String): String {
        ensureFreshToken()
        val req = Request.Builder().url("${ServerConfig.baseUrl.value}/media/me/avatar")
            .post(bytes.toRequestBody(mime.toMediaType()))
            .header("content-type", mime)
            .header("authorization", "Bearer $access")
            .build()
        val j = parse(withContext(Dispatchers.IO) { http.newCall(req).execute() }).orThrow("uploadAvatar")
        return j["key"]?.jsonPrimitive?.content ?: ""
    }

    // ── calls (Worker-proxied Cloudflare Calls SFU; credentials stay server-side) ──
    suspend fun callSession(chatId: String): JsonObject {
        return api("/calls/session", "POST", buildJsonObject { put("chatId", chatId) }).orThrow("callSession")
    }

    /** publish local tracks: {sessionId, body:{sessionDescription,tracks}}. */
    suspend fun callNegotiate(sessionId: String, sdp: String, tracks: JsonElement): JsonObject {
        return api("/calls/negotiate", "POST", buildJsonObject {
            put("sessionId", sessionId)
            put("body", buildJsonObject {
                put("sessionDescription", buildJsonObject { put("type", "offer"); put("sdp", sdp) })
                put("tracks", tracks)
            })
        }).orThrow("callNegotiate")
    }

    /** subscribe remote tracks: {sessionId, body:{tracks:[{location:'remote',...}]}}. */
    suspend fun callSubscribe(sessionId: String, tracks: JsonElement): JsonObject {
        return api("/calls/negotiate", "POST", buildJsonObject {
            put("sessionId", sessionId)
            put("body", buildJsonObject { put("tracks", tracks) })
        }).orThrow("callSubscribe")
    }

    /** answer the SFU's subscribe offer: {sessionId, body:{sessionDescription:{type:'answer',sdp}}}. */
    suspend fun callRenegotiate(sessionId: String, sdp: String): JsonObject {
        return api("/calls/renegotiate", "PUT", buildJsonObject {
            put("sessionId", sessionId)
            put("body", buildJsonObject { put("sessionDescription", buildJsonObject { put("type", "answer"); put("sdp", sdp) }) })
        }).orThrow("callRenegotiate")
    }

    suspend fun callCloseTracks(sessionId: String, mids: List<String>) {
        api("/calls/tracks/close", "PUT", buildJsonObject {
            put("sessionId", sessionId)
            put("mids", JsonArray(mids.map { kotlinx.serialization.json.JsonPrimitive(it) }))
        })
    }

    suspend fun callCloseSession(sessionId: String) {
        api("/calls/session/close", "POST", buildJsonObject { put("sessionId", sessionId) })
    }
}
