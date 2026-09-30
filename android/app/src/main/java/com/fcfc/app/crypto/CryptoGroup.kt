package com.fcfc.app.crypto

import com.fcfc.app.core.Codec
import com.fcfc.app.db.FcDb
import com.fcfc.app.net.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * Group sender keys + file encryption + password-derived backups.
 * Ports of frontend/src/crypto/{sender,files,backup}.ts.
 */
object CryptoGroup {
    private val JSON = Json { ignoreUnknownKeys = true; isLenient = true }
    private const val ITER = 600_000
    private const val MAX_BACKUP_MESSAGES = 3000

    // ══════════════════════════════════════════════════════════════════════
    // Sender keys (sender.ts)
    // ══════════════════════════════════════════════════════════════════════
    class SkState(var chainKey: String, var idx: Long, val skipped: MutableMap<Long, String> = mutableMapOf()) {
        fun toJson(): JsonObject = buildJsonObject {
            put("chainKey", chainKey); put("idx", idx)
            put("skipped", buildJsonObject { skipped.forEach { (k, v) -> put(k.toString(), v) } })
        }

        companion object {
            fun fromJson(j: JsonObject): SkState = SkState(
                chainKey = j["chainKey"]!!.jsonPrimitive.content,
                idx = j["idx"]?.jsonPrimitive?.longOrNull ?: 0,
                skipped = (j["skipped"] as? JsonObject)?.entries?.mapNotNull { (k, v) ->
                    k.toLongOrNull()?.let { it to v.jsonPrimitive.content }
                }?.toMap()?.toMutableMap() ?: mutableMapOf(),
            )
        }
    }

    var onStateSaved: (() -> Unit)? = null   // → backup dirty flag

    suspend fun ownSenderKey(chatId: String): SkState {
        FcDb.get("senderKeys", "own:$chatId")?.jsonObject?.let { return SkState.fromJson(it) }
        val raw = Primitives.randomBytes(32)
        val st = SkState(Codec.b64u(raw), 0)
        onStateSaved?.invoke()
        FcDb.put("senderKeys", "own:$chatId", st.toJson())
        FcDb.put("senderKeys", "gen:$chatId", JsonPrimitive(st.chainKey))
        return st
    }

    suspend fun ingestSenderKey(chatId: String, senderId: String, sk: JsonObject) {
        val state = SkState(
            chainKey = sk["chainKey"]?.jsonPrimitive?.content ?: return,
            idx = sk["idx"]?.jsonPrimitive?.longOrNull ?: 0,
        )
        val existing = FcDb.get("senderKeys", "$chatId:$senderId")?.jsonObject
        (existing?.get("skipped") as? JsonObject)?.let { kept ->
            state.skipped.putAll(kept.entries.mapNotNull { (k, v) -> k.toLongOrNull()?.let { it to v.jsonPrimitive.content } })
        }
        onStateSaved?.invoke()
        FcDb.put("senderKeys", "$chatId:$senderId", state.toJson())
        FcDb.put("senderKeys", "gen:$chatId:$senderId", JsonPrimitive(state.chainKey))
    }

    suspend fun hasSenderKey(chatId: String, senderId: String): Boolean =
        FcDb.get("senderKeys", "$chatId:$senderId") != null

    /** distribution packet = genesis state (idx 0). */
    suspend fun distributionPackage(chatId: String): JsonObject {
        val current = ownSenderKey(chatId)
        val genesis = (FcDb.get("senderKeys", "gen:$chatId") as? JsonPrimitive)?.contentOrNull ?: current.chainKey
        return buildJsonObject { put("chainKey", genesis); put("idx", 0) }
    }

    suspend fun markDistributed(chatId: String, userId: String) {
        val key = "skdist:$chatId"
        val m = (FcDb.get("meta", key) as? JsonObject)?.toMutableMap() ?: mutableMapOf()
        m[userId] = JsonPrimitive(System.currentTimeMillis())
        FcDb.put("meta", key, buildJsonObject { m.forEach { (k, v) -> put(k, v) } })
    }

    suspend fun distributedSet(chatId: String): Set<String> =
        (FcDb.get("meta", "skdist:$chatId") as? JsonObject)?.keys?.toSet() ?: emptySet()

    suspend fun markNeedsRedistribution(chatId: String, newMemberIds: List<String>) {
        val key = "skdist:$chatId"
        val m = (FcDb.get("meta", key) as? JsonObject)?.toMutableMap() ?: mutableMapOf()
        newMemberIds.forEach { m.remove(it) }
        FcDb.put("meta", key, buildJsonObject { m.forEach { (k, v) -> put(k, v) } })
    }

    // per-chat encrypt lock (sender.ts withChatLock)
    private val chatLocks = HashMap<String, Mutex>()
    private fun chatLock(chatId: String): Mutex = synchronized(chatLocks) { chatLocks.getOrPut(chatId) { Mutex() } }

    suspend fun <T> withChatLock(chatId: String, block: suspend () -> T): T = chatLock(chatId).withLock { block() }

    /** group envelope — web field order {v, g, sid, n, ct, iv}. */
    suspend fun groupEncrypt(chatId: String, myUserId: String, obj: JsonElement): JsonObject = withChatLock(chatId) {
        val sk = ownSenderKey(chatId)
        val chainKey = Codec.b64uBytes(sk.chainKey)
        val n = sk.idx
        val (mk, next) = CryptoSessions.kdfChain(chainKey)
        sk.idx += 1
        sk.chainKey = Codec.b64u(next)
        onStateSaved?.invoke()
        FcDb.put("senderKeys", "own:$chatId", sk.toJson())
        val aead = Primitives.aesGcmEncrypt(mk, Codec.utf8(obj.toString()))
        buildJsonObject {
            put("v", 1); put("g", 1); put("sid", myUserId); put("n", n)
            put("ct", Codec.b64u(aead.ct)); put("iv", Codec.b64u(aead.iv))
        }
    }

    /** own old group messages — derive nth key from genesis. */
    suspend fun groupDecryptOwn(chatId: String, env: JsonObject): JsonElement? {
        val n = env["n"]?.jsonPrimitive?.longOrNull ?: return null
        if (n < 0 || n > 100_000) return null
        val genesis = (FcDb.get("senderKeys", "gen:$chatId") as? JsonPrimitive)?.contentOrNull ?: return null
        var chainKey = Codec.b64uBytes(genesis)
        var msgKey: ByteArray? = null
        for (i in 0..n) {
            val (mk, next) = CryptoSessions.kdfChain(chainKey)
            msgKey = mk
            chainKey = next
        }
        return decryptWith(msgKey!!, env)
    }

    suspend fun groupDecrypt(chatId: String, senderId: String, env: JsonObject): JsonElement? {
        val skJ = FcDb.get("senderKeys", "$chatId:$senderId")?.jsonObject ?: throw IllegalStateException("sender key missing")
        val sk = SkState.fromJson(skJ)
        val n = env["n"]?.jsonPrimitive?.longOrNull ?: return null
        val skipped = sk.skipped.toMutableMap()
        var msgKey: ByteArray? = null

        if (n < sk.idx) {
            // old message — skip list or re-derive from genesis
            val mk = skipped.remove(n)
            if (mk != null) {
                msgKey = Codec.b64uBytes(mk)
                onStateSaved?.invoke()
                FcDb.put("senderKeys", "$chatId:$senderId", sk.toJson().let { buildJsonObject {
                    put("chainKey", sk.chainKey); put("idx", sk.idx)
                    put("skipped", buildJsonObject { skipped.forEach { (k, v) -> put(k.toString(), v) } })
                } })
            } else {
                val genesis = (FcDb.get("senderKeys", "gen:$chatId:$senderId") as? JsonPrimitive)?.contentOrNull
                    ?: throw IllegalStateException("sender key missing")
                if (n < 0 || n > 5000) throw IllegalStateException("sender key missing")
                var chainKey = Codec.b64uBytes(genesis)
                var mk2: ByteArray? = null
                for (i in 0..n) {
                    val (mk, next) = CryptoSessions.kdfChain(chainKey)
                    mk2 = mk
                    chainKey = next
                }
                msgKey = mk2!!
            }
        } else {
            // gap → advance chain, store intermediate keys
            var chainKey = Codec.b64uBytes(sk.chainKey)
            for (i in sk.idx..n) {
                val (mk, next) = CryptoSessions.kdfChain(chainKey)
                if (i == n) msgKey = mk else skipped[i] = Codec.b64u(mk)
                chainKey = next
            }
            if (skipped.size > 2000) {
                val keep = skipped.entries.sortedByDescending { it.key }.take(2000).associate { it.key to it.value }
                skipped.clear(); skipped.putAll(keep)
            }
            onStateSaved?.invoke()
            FcDb.put("senderKeys", "$chatId:$senderId", buildJsonObject {
                put("chainKey", Codec.b64u(chainKey)); put("idx", n + 1)
                put("skipped", buildJsonObject { skipped.forEach { (k, v) -> put(k.toString(), v) } })
            })
        }
        return decryptWith(msgKey ?: return null, env)
    }

    private fun decryptWith(msgKey: ByteArray, env: JsonObject): JsonElement? = try {
        val plain = Primitives.aesGcmDecrypt(
            msgKey,
            Codec.b64uBytes(env["ct"]!!.jsonPrimitive.content),
            Codec.b64uBytes(env["iv"]!!.jsonPrimitive.content),
        )
        JSON.parseToJsonElement(Codec.fromUtf8(plain))
    } catch (_: Exception) { null }

    // ══════════════════════════════════════════════════════════════════════
    // File encryption (files.ts) — 1MiB chunks, counter nonce at [8..12)
    // ══════════════════════════════════════════════════════════════════════
    private const val CHUNK = 1024 * 1024

    class EncryptedFile(val bytes: ByteArray, val keyB64u: String, val ivB64u: String, val size: Long)

    private fun nonceFor(base: ByteArray, i: Int): ByteArray {
        val iv = base.copyOf()
        val cur = ((iv[8].toInt() and 0xff) shl 24) or ((iv[9].toInt() and 0xff) shl 16) or
            ((iv[10].toInt() and 0xff) shl 8) or (iv[11].toInt() and 0xff)
        val v = cur + i
        iv[8] = ((v ushr 24) and 0xff).toByte()
        iv[9] = ((v ushr 16) and 0xff).toByte()
        iv[10] = ((v ushr 8) and 0xff).toByte()
        iv[11] = (v and 0xff).toByte()
        return iv
    }

    fun encryptFile(input: ByteArray): EncryptedFile {
        val rawKey = Primitives.randomBytes(32)
        val baseIv = Primitives.randomBytes(12)
        val parts = mutableListOf<ByteArray>()
        var i = 0
        var off = 0
        while (off < input.size) {
            val end = minOf(off + CHUNK, input.size)
            val ct = Primitives.aesGcmEncrypt(rawKey, input.copyOfRange(off, end), nonceFor(baseIv, i)).ct
            parts.add(ct)
            off = end
            i++
        }
        return EncryptedFile(parts.reduce { a, b -> a + b }, Codec.b64u(rawKey), Codec.b64u(baseIv), input.size.toLong())
    }

    fun decryptFile(data: ByteArray, keyB64u: String, ivB64u: String): ByteArray {
        val key = Codec.b64uBytes(keyB64u)
        val baseIv = Codec.b64uBytes(ivB64u)
        val parts = mutableListOf<ByteArray>()
        var i = 0
        var off = 0
        val step = CHUNK + 16
        while (off < data.size) {
            val end = minOf(off + step, data.size)
            val plain = Primitives.aesGcmDecrypt(key, data.copyOfRange(off, end), nonceFor(baseIv, i))
            parts.add(plain)
            off = end
            i++
        }
        return parts.reduce { a, b -> a + b }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Backup (backup.ts) — PBKDF2(600k) + AES-GCM, blob = iv(12)||ct
    // ══════════════════════════════════════════════════════════════════════
    private fun deriveKeyBytes(secret: String, salt: ByteArray): ByteArray =
        Primitives.pbkdf2(secret, salt, ITER, 256)

    class BackupBlob(val blob: String, val salt: String)

    private suspend fun collectBundle(): String {
        val stores = listOf("keys", "sessions", "senderKeys", "starred", "meta")
        val dump = buildJsonObject {
            for (s in stores) {
                val entries = buildJsonObject {
                    for (k in FcDb.allKeys(s)) {
                        FcDb.get(s, k)?.let { put(k, it) }
                    }
                }
                put(s, entries)
            }
            // messages: latest MAX_BACKUP_MESSAGES by ts
            val all = FcDb.all("messages").mapNotNull { it as? JsonObject }
            val recent = all.filter { it["ts"]?.jsonPrimitive?.longOrNull != null }
                .sortedByDescending { it["ts"]!!.jsonPrimitive.longOrNull!! }
                .take(MAX_BACKUP_MESSAGES)
            put("messages", buildJsonObject {
                recent.forEach { m ->
                    val mid = m["id"]?.jsonPrimitive?.contentOrNull
                    if (mid != null) put(mid, m)
                }
            })
        }
        return dump.toString()
    }

    private fun encryptBundle(secret: String, bundle: String): BackupBlob {
        val salt = Primitives.randomBytes(16)
        val key = deriveKeyBytes(secret, salt)
        val iv = Primitives.randomBytes(12)
        val ct = Primitives.aesGcmEncrypt(key, Codec.utf8(bundle), iv).ct
        return BackupBlob(Codec.b64u(iv + ct), Codec.b64u(salt))
    }

    private fun decryptBundle(secret: String, blob: String, saltB64: String): JsonElement? = try {
        val key = deriveKeyBytes(secret, Codec.b64uBytes(saltB64))
        val data = Codec.b64uBytes(blob)
        val iv = data.copyOfRange(0, 12)
        val ct = data.copyOfRange(12, data.size)
        val plain = Primitives.aesGcmDecrypt(key, ct, iv)
        JSON.parseToJsonElement(Codec.fromUtf8(plain))
    } catch (_: Exception) { null }

    suspend fun createBackup(password: String): BackupBlob = encryptBundle(password, collectBundle())
    suspend fun createPinBackup(passcode: String): BackupBlob = encryptBundle("fcfc-pin:$passcode", collectBundle())

    /** write dump stores back into FcDb (writeDump). */
    suspend fun writeDump(dump: JsonObject) {
        for ((store, entries) in dump) {
            val map = entries as? JsonObject ?: continue
            for ((k, v) in map) FcDb.put(store, k, v)
        }
    }

    fun dumpFreshness(dump: JsonElement?): Long {
        val msgs = (dump as? JsonObject)?.get("messages") as? JsonObject ?: return 0
        var max = 0L
        for (v in msgs.values) {
            val ts = (v as? JsonObject)?.get("ts")?.jsonPrimitive?.longOrNull ?: continue
            if (ts > max) max = ts
        }
        return max
    }

    private suspend fun localFreshness(): Long {
        var max = 0L
        for (m in FcDb.all("messages")) {
            val ts = (m as? JsonObject)?.get("ts")?.jsonPrimitive?.longOrNull ?: continue
            if (ts > max) max = ts
        }
        return max
    }

    suspend fun restoreBackup(password: String, blob: String, saltB64: String): Boolean {
        val dump = decryptBundle(password, blob, saltB64) ?: return false
        writeDump(dump.jsonObject)
        return true
    }

    suspend fun restorePinBackup(passcode: String, blob: String, saltB64: String): Boolean {
        val dump = decryptBundle("fcfc-pin:$passcode", blob, saltB64) ?: return false
        writeDump(dump.jsonObject)
        return true
    }

    /** smart-merge: freshest of remote password/pin blobs vs local (mergeRemoteIfFresher). */
    suspend fun mergeRemoteIfFresher(password: String?, passcode: String?): Boolean {
        return try {
        val remote = ApiClient.getBackup() ?: return false
        var best: JsonElement? = null
        var bestTs = -1L
        if (remote["blob"]?.jsonPrimitive?.contentOrNull != null && password != null) {
            val d = decryptBundle(password, remote["blob"]!!.jsonPrimitive.content, remote["salt"]!!.jsonPrimitive.content)
            if (d != null) {
                val ts = dumpFreshness(d)
                if (ts > bestTs) { bestTs = ts; best = d }
            }
        }
        if (remote["pinBlob"]?.jsonPrimitive?.contentOrNull != null && passcode != null) {
            val d = decryptBundle("fcfc-pin:$passcode", remote["pinBlob"]!!.jsonPrimitive.content, remote["pinSalt"]!!.jsonPrimitive.content)
            if (d != null) {
                val ts = dumpFreshness(d)
                if (ts > bestTs) { bestTs = ts; best = d }
            }
        }
        if (best == null) return false
        val localTs = localFreshness()
        if (bestTs <= localTs) return false
        writeDump(best!!.jsonObject)
        true
        } catch (_: Exception) { false }
    }

    /** post-login sync: upload local keys, else restore from remote (syncBackup). */
    suspend fun syncBackup(password: String, passcode: String? = null): String {
        val remote = ApiClient.getBackup()
        val hasLocal = FcDb.get("keys", "identity") != null
        if (hasLocal) {
            val bundle = collectBundle()
            val b = encryptBundle(password, bundle)
            var pin = passcode ?: getStoredPasscode()
            var pinBlob: String? = null
            var pinSalt: String? = null
            if (pin != null) {
                val pb = encryptBundle("fcfc-pin:$pin", bundle)
                pinBlob = pb.blob
                pinSalt = pb.salt
            }
            ApiClient.putBackup(b.blob, b.salt, pinBlob, pinSalt)
            return "uploaded"
        }
        if (remote?.get("blob")?.jsonPrimitive?.contentOrNull != null) {
            val ok = restoreBackup(password, remote["blob"]!!.jsonPrimitive.content, remote["salt"]!!.jsonPrimitive.content)
            return if (ok) "restored" else "failed"
        }
        return "none"
    }

    suspend fun syncPinBackup(passcode: String): String {
        if (FcDb.get("keys", "identity") == null) return "none"
        val pb = createPinBackup(passcode)
        ApiClient.putBackupOnlyPin(pb.blob, pb.salt)
        return "uploaded"
    }

    // ── passcode local storage (meta.pin) ──
    suspend fun storePasscodeLocally(passcode: String) { FcDb.put("meta", "pin", JsonPrimitive(passcode)) }
    suspend fun getStoredPasscode(): String? =
        (FcDb.get("meta", "pin") as? JsonPrimitive)?.contentOrNull
    suspend fun clearStoredPasscode() { FcDb.del("meta", "pin") }

    // ── throttled periodic + quick-debounced dirty sync ──
    @Volatile private var dirty = false
    @Volatile private var syncing = false
    private val scope = CoroutineScope(Dispatchers.IO + kotlinx.coroutines.SupervisorJob())
    private var quickJob: kotlinx.coroutines.Job? = null
    private var timerJob: kotlinx.coroutines.Job? = null

    /** session-memory password provider — set by AuthStore at login. */
    var sessionPassword: (() -> String?)? = null

    fun markBackupDirty() {
        dirty = true
        scheduleQuickSync()
    }

    private fun scheduleQuickSync() {
        if (quickJob?.isActive == true) return
        quickJob = scope.launch {
            delay(6_000)
            if (!dirty || syncing) return@launch
            val password = sessionPassword?.invoke()
            if (password == null) {
                val pin = getStoredPasscode()
                if (pin != null) {
                    syncing = true
                    try { syncPinBackup(pin); dirty = false } catch (_: Exception) { } finally { syncing = false }
                }
                return@launch
            }
            syncing = true
            try { syncBackup(password); dirty = false } catch (_: Exception) { } finally { syncing = false }
        }
    }

    fun startBackupSync() {
        stopBackupSync()
        timerJob = scope.launch {
            while (true) {
                delay(45_000)
                if (!dirty || syncing) continue
                val password = sessionPassword?.invoke()
                if (password == null) {
                    val pin = getStoredPasscode()
                    if (pin != null) {
                        syncing = true
                        try { syncPinBackup(pin); dirty = false } catch (_: Exception) { } finally { syncing = false }
                    }
                    continue
                }
                syncing = true
                try { syncBackup(password); dirty = false } catch (_: Exception) { } finally { syncing = false }
            }
        }
    }

    fun stopBackupSync() {
        timerJob?.cancel(); timerJob = null
        quickJob?.cancel(); quickJob = null
    }

    // ── client-side password/passcode hashing (auth.ts) ──
    // PBKDF2(600k) is heavy — the web app derives it asynchronously in the
    // browser. Same here: run on Dispatchers.Default so the login button
    // never blocks Compose's main thread (jank/ANR risk on slow devices).
    // Salt contract: UTF-8("fcfc-v1:" + username.toLowerCase()) — identical
    // to the web; verified byte-for-byte in AuthContractTest.
    suspend fun clientPassHash(username: String, password: String): String {
        val salt = Codec.utf8("fcfc-v1:" + username.lowercase())
        return withContext(Dispatchers.Default) { Codec.b64u(Primitives.pbkdf2(password, salt, ITER, 256)) }
    }

    suspend fun clientPasscodeHash(uidcode: String, passcode: String): String {
        val salt = Codec.utf8("fcfc-v1:pin:$uidcode")
        return withContext(Dispatchers.Default) { Codec.b64u(Primitives.pbkdf2(passcode, salt, ITER, 256)) }
    }
}
