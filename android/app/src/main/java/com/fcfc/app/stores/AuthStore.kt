package com.fcfc.app.stores

import com.fcfc.app.crypto.CryptoGroup
import com.fcfc.app.crypto.CryptoSessions
import com.fcfc.app.crypto.Primitives
import com.fcfc.app.db.FcDb
import com.fcfc.app.model.User
import com.fcfc.app.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Auth store — port of frontend/src/stores/auth.ts.
 * Signup wizard → key generation → backup sync; login (password / user-ID+passcode)
 * with Telegram-style device approval and key-restore/merge on new devices.
 */
object AuthStore {
    const val STATUS_BOOT = "boot"
    const val STATUS_AUTH = "auth"
    const val STATUS_READY = "ready"

    @kotlinx.serialization.Serializable
    data class SignupFields(
        val username: String,
        val password: String,
        val understood: Boolean,
        val name: String? = null,
        val phone: String? = null,
        val email: String? = null,
        val userIdCode: String,
        val passcode: String,
    )

    // ── state ──
    val status = kotlinx.coroutines.flow.MutableStateFlow(STATUS_BOOT)
    val user = kotlinx.coroutines.flow.MutableStateFlow<User?>(null)
    val settings = kotlinx.coroutines.flow.MutableStateFlow<JsonObject?>(null)
    /** session-memory only (for key-backup sync); never persisted */
    val password = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    val passcode = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)

    val isReady: Boolean get() = status.value == STATUS_READY
    val userId: String get() = user.value?.id ?: ""

    /** fired after a successful key restore — ChatsStore reloads histories. */
    var onKeysRestored: (() -> Unit)? = null

    // ── local-owner guard (auth.ts ensureLocalOwner / wipeIfOtherAccount) ──
    private suspend fun ensureLocalOwner(userId: String) {
        try {
            val owner = (FcDb.get("meta", "owner") as? kotlinx.serialization.json.JsonPrimitive)?.content
            if (owner != null && owner != userId) wipeLocalCrypto()
            FcDb.put("meta", "owner", kotlinx.serialization.json.JsonPrimitive(userId))
        } catch (_: Exception) { }
    }

    private suspend fun wipeLocalCrypto() {
        for (s in listOf("keys", "sessions", "senderKeys", "messages", "starred", "meta")) FcDb.clear(s)
    }

    private suspend fun wipeIfOtherAccount() {
        try {
            val owner = (FcDb.get("meta", "owner") as? kotlinx.serialization.json.JsonPrimitive)?.content
            if (owner != null) wipeLocalCrypto()
        } catch (_: Exception) { }
    }

    suspend fun boot() {
        if (!ApiClient.hasTokens()) { status.value = STATUS_AUTH; return }
        try {
            val (u, s) = withContext(Dispatchers.IO) { ApiClient.meFull() }
            user.value = u
            settings.value = s
            status.value = STATUS_READY
        } catch (_: Exception) {
            status.value = STATUS_AUTH
        }
    }

    suspend fun signup(f: SignupFields): String? = try {
        Primitives.cryptoSelfTest()
        wipeIfOtherAccount()
        val bundle = CryptoSessions.createIdentityBundle()
        val keys = CryptoSessions.publicBundleForUpload(bundle)
        val username = f.username.lowercase()
        val passHash = CryptoGroup.clientPassHash(username, f.password)
        val passcodeHash = CryptoGroup.clientPasscodeHash(f.userIdCode, f.passcode)
        val res = ApiClient.signup(buildJsonObject {
            put("username", username); put("password", passHash)
            put("understood", f.understood)
            put("deviceName", deviceName())
            put("keys", keys)
            put("name", f.name ?: ""); put("phone", f.phone ?: ""); put("email", f.email ?: "")
            put("userIdCode", f.userIdCode); put("passcode", passcodeHash)
        })
        password.value = f.password
        passcode.value = f.passcode
        ensureLocalOwner(res.user.id)
        CryptoGroup.storePasscodeLocally(f.passcode)
        val (u, s) = ApiClient.meFull()
        user.value = u; settings.value = s
        status.value = STATUS_READY
        runCatching { CryptoGroup.syncBackup(f.password, f.passcode) }
        null
    } catch (e: Exception) {
        e.message ?: "signup failed"
    }

    suspend fun login(username: String, password: String): String? = try {
        // device crypto sanity (microseconds) — a broken PBKDF2/HMAC provider
        // must surface HERE with a clear message, never as a misleading
        // server-side "invalid credentials"
        Primitives.cryptoSelfTest()
        val passHash = CryptoGroup.clientPassHash(username, password)
        val res = ApiClient.login(username, passHash, deviceName())
        finishLogin(res.access, res.refresh, password)
        null
    } catch (e: Exception) {
        e.message ?: "login failed"
    }

    suspend fun loginPin(uidCode: String, passcode: String): String? = try {
        Primitives.cryptoSelfTest()
        val passcodeHash = CryptoGroup.clientPasscodeHash(uidCode, passcode)
        val res = ApiClient.loginPin(uidCode, passcodeHash, deviceName())
        finishPinLogin(res.access, res.refresh, passcode)
        null
    } catch (e: Exception) {
        e.message ?: "login failed"
    }

    private suspend fun finishLogin(access: String, refresh: String, password: String) {
        // tokens already persisted by ApiClient.login
        this.password.value = password
        val (u, s) = ApiClient.meFull()
        ensureLocalOwner(u.id)
        var restored = false
        val hasLocal = FcDb.get("keys", "identity") != null
        if (!hasLocal) {
            val backup = runCatching { ApiClient.getBackup() }.getOrNull()
            if (backup?.get("blob")?.jsonPrimitive?.content != null) {
                restored = CryptoGroup.restoreBackup(password, backup["blob"]!!.jsonPrimitive.content, backup["salt"]!!.jsonPrimitive.content)
            }
            if (!restored && backup?.get("pinBlob")?.jsonPrimitive?.content != null) {
                val pin = CryptoGroup.getStoredPasscode()
                if (pin != null) {
                    restored = CryptoGroup.restorePinBackup(pin, backup["pinBlob"]!!.jsonPrimitive.content, backup["pinSalt"]!!.jsonPrimitive.content)
                }
            }
            if (!restored) {
                // new device, no backup → fresh identity + new backup
                val bundle = CryptoSessions.createIdentityBundle()
                ApiClient.uploadKeyBundle(CryptoSessions.publicBundleForUpload(bundle))
                val b = CryptoGroup.createBackup(password)
                ApiClient.putBackup(b.blob, b.salt)
            }
        } else {
            // smart-merge: remote fresher → seat it locally, then upload
            val pin = CryptoGroup.getStoredPasscode()
            restored = CryptoGroup.mergeRemoteIfFresher(password, pin)
            runCatching { CryptoGroup.syncBackup(password) }
        }
        user.value = u; settings.value = s
        status.value = STATUS_READY
        CryptoGroup.sessionPassword = { this.password.value }
        CryptoGroup.startBackupSync()
        if (restored) onKeysRestored?.invoke()
    }

    private suspend fun finishPinLogin(access: String, refresh: String, passcode: String) {
        this.passcode.value = passcode
        val (u, s) = ApiClient.meFull()
        ensureLocalOwner(u.id)
        val hasLocal = FcDb.get("keys", "identity") != null
        var restored = false
        if (!hasLocal) {
            val backup = runCatching { ApiClient.getBackup() }.getOrNull()
            if (backup?.get("pinBlob")?.jsonPrimitive?.content != null) {
                restored = CryptoGroup.restorePinBackup(passcode, backup["pinBlob"]!!.jsonPrimitive.content, backup["pinSalt"]!!.jsonPrimitive.content)
            }
            if (!restored) {
                val bundle = CryptoSessions.createIdentityBundle()
                ApiClient.uploadKeyBundle(CryptoSessions.publicBundleForUpload(bundle))
                runCatching { CryptoGroup.syncPinBackup(passcode) }
            }
        } else {
            restored = CryptoGroup.mergeRemoteIfFresher(null, passcode)
        }
        CryptoGroup.storePasscodeLocally(passcode)
        user.value = u; settings.value = s
        status.value = STATUS_READY
        CryptoGroup.sessionPassword = { password.value }
        CryptoGroup.startBackupSync()
        if (restored) onKeysRestored?.invoke()
    }

    suspend fun setupPasscode(password: String, userIdCode: String, passcode: String): String? = try {
        Primitives.cryptoSelfTest()
        val me = user.value
        val code = userIdCode.ifEmpty { me?.userIdCode ?: "" }
        val passHash = CryptoGroup.clientPassHash(me?.username ?: "", password)
        val passcodeHash = CryptoGroup.clientPasscodeHash(code, passcode)
        ApiClient.setPasscode(passHash, userIdCode, passcodeHash)
        CryptoGroup.storePasscodeLocally(passcode)
        this.passcode.value = passcode
        if (me != null) user.value = me.copy(userIdCode = code)
        runCatching { CryptoGroup.syncBackup(password, passcode) }
        null
    } catch (e: Exception) {
        e.message ?: "failed — try again"
    }

    suspend fun decideDevice(deviceId: String, accept: Boolean) {
        runCatching { ApiClient.decideDevice(deviceId, accept) }
    }

    suspend fun updateProfile(patch: Map<String, String>) {
        val obj = buildJsonObject { patch.forEach { (k, v) -> put(k, v) } }
        runCatching { user.value = ApiClient.updateMe(obj) }
    }

    suspend fun updateSettings(patch: JsonObject) {
        val merged = (settings.value ?: buildJsonObject { }).toMutableMap().apply { patch.forEach { (k, v) -> put(k, v) } }
        val mergedObj = buildJsonObject { merged.forEach { (k, v) -> put(k, v) } }
        runCatching {
            ApiClient.updateSettings(mergedObj)
            settings.value = mergedObj
        }
    }

    suspend fun deleteAccount(password: String): String? = try {
        Primitives.cryptoSelfTest()
        val me = user.value
        val passHash = CryptoGroup.clientPassHash(me?.username ?: "", password)
        ApiClient.deleteAccount(passHash)
        CryptoGroup.stopBackupSync()
        user.value = null; this.password.value = null; passcode.value = null
        status.value = STATUS_AUTH
        null
    } catch (e: Exception) {
        e.message ?: "failed — try again"
    }

    suspend fun logout(remote: Boolean = false) {
        val pass = password.value
        // fresh key-backup before leaving (last messages make it into the blob)
        runCatching {
            if (pass != null && FcDb.get("keys", "identity") != null) CryptoGroup.syncBackup(pass)
        }
        runCatching { ApiClient.logout(remote) }
        CryptoGroup.stopBackupSync()
        user.value = null; password.value = null; passcode.value = null
        status.value = STATUS_AUTH
    }

    fun forceLogout() {
        CryptoGroup.stopBackupSync()
        user.value = null; password.value = null; passcode.value = null
        status.value = STATUS_AUTH
    }

    fun deviceName(): String = "fcfc · Android"
}
