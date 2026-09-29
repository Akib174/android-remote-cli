package com.fcfc.app.stores

import com.fcfc.app.model.User

/**
 * Auth store — port of frontend/src/stores/auth.ts (Zustand).
 * STATE + ACTION SIGNATURES are the contract; bodies implemented by the net/data layer agent.
 * (Do not change signatures without updating all callers.)
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
    val settings = kotlinx.coroutines.flow.MutableStateFlow<kotlinx.serialization.json.JsonObject?>(null)
    /** session-memory only (for key-backup sync); never persisted */
    val password = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    val passcode = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)

    val isReady: Boolean get() = status.value == STATUS_READY
    val userId: String get() = user.value?.id ?: ""

    // ── actions (implemented in net/data layer; DO NOT change signatures) ──
    suspend fun boot() { TODO("net/data agent") }
    suspend fun signup(f: SignupFields): String? { TODO("net/data agent") }
    suspend fun login(username: String, password: String): String? { TODO("net/data agent") }
    suspend fun loginPin(uidCode: String, passcode: String): String? { TODO("net/data agent") }
    suspend fun setupPasscode(password: String, userIdCode: String, passcode: String): String? { TODO("net/data agent") }
    suspend fun decideDevice(deviceId: String, accept: Boolean) { TODO("net/data agent") }
    suspend fun updateProfile(patch: Map<String, String>) { TODO("net/data agent") }
    suspend fun updateSettings(patch: kotlinx.serialization.json.JsonObject) { TODO("net/data agent") }
    suspend fun deleteAccount(password: String): String? { TODO("net/data agent") }
    suspend fun logout(remote: Boolean = false) { TODO("net/data agent") }
    fun forceLogout() { TODO("net/data agent") }

    /** Device display name like web's UA parse: "fcfc · Android" */
    fun deviceName(): String = "fcfc · Android"
}
