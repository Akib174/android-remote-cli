package com.fcfc.app.net

import com.fcfc.app.model.Chat
import com.fcfc.app.model.DeviceInfo
import com.fcfc.app.model.User
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * REST API surface — port of worker routes + frontend/src/api/client.ts.
 * Contract for the net agent's OkHttp implementation.
 * All methods throw [ApiException] on non-2xx; response error body {"error": "..."} → message.
 */
class ApiException(val code: Int, message: String) : Exception(message)

interface Api {
    // ── configuration ──
    var baseUrl: String
    fun accessToken(): String?
    fun refreshToken(): String?

    // ── auth ──
    suspend fun signup(body: JsonObject): SignupResult
    suspend fun login(username: String, passHash: String, deviceName: String, keys: JsonObject?): LoginResult
    suspend fun loginPin(uidCode: String, passcodeHash: String, deviceName: String): LoginResult
    suspend fun refresh(refreshToken: String): String   // returns new access token
    suspend fun logout(device: Boolean)
    suspend fun me(): User
    suspend fun myDevices(): List<DeviceInfo>
    suspend fun decideDevice(deviceId: String, accept: Boolean)
    suspend fun setPasscode(passwordHash: String, userIdCode: String?, passcodeHash: String?)
    suspend fun deleteAccount(passwordHash: String)

    // ── users ──
    suspend fun searchUsers(query: String): List<User>
    suspend fun userById(id: String): User
    suspend fun updateMe(patch: JsonObject): User
    suspend fun presence(ids: List<String>): Map<String, Boolean>
    suspend fun blocked(): List<String>
    suspend fun blockUser(id: String, on: Boolean)

    // ── keys ──
    suspend fun uploadKeyBundle(bundle: JsonObject)
    suspend fun fetchPrekeyBundle(userId: String): JsonObject
    suspend fun putBackup(blob: String, salt: String, pinBlob: String?, pinSalt: String?)
    suspend fun getBackup(): JsonObject?

    // ── chats ──
    suspend fun chats(): List<Chat>
    suspend fun chatById(id: String): Chat
    suspend fun createDm(userId: String): Chat
    suspend fun createGroup(title: String, description: String?, memberIds: List<String>, memberLimit: Int): Chat
    suspend fun joinByInvite(code: String): Chat
    suspend fun inviteLinks(chatId: String): List<JsonObject>
    suspend fun createInviteLink(chatId: String): JsonObject
    suspend fun chatMembers(id: String): List<com.fcfc.app.model.ChatMember>
    suspend fun setMemberRole(chatId: String, userId: String, admin: Boolean)
    suspend fun removeMember(chatId: String, userId: String)
    suspend fun leaveChat(chatId: String)
    suspend fun deleteChat(chatId: String)
    suspend fun patchChatState(chatId: String, patch: JsonObject): JsonObject
    suspend fun messages(chatId: String, before: Long?, limit: Int): MessagesPage
    suspend fun requests(): List<JsonObject>
    suspend fun respondRequest(fromId: String, accept: Boolean)

    // ── media ──
    /** small upload (≤20MB): returns {key} */
    suspend fun uploadSmall(bytes: ByteArray, mime: String, name: String?): String
    /** multipart upload: init → part* → complete. returns {key} */
    suspend fun uploadLarge(bytes: ByteArray, mime: String, name: String?): String
    /** download with Range support; headers: x-file-iv, x-file-name */
    suspend fun download(key: String): DownloadedFile
    suspend fun uploadAvatar(bytes: ByteArray, mime: String): String
    suspend fun downloadFile(key: String): DownloadedFile

    // ── calls (Cloudflare Realtime SFU proxied) ──
    suspend fun callSession(): JsonObject
    suspend fun callNegotiate(sessionId: String, sdp: String, tracks: JsonElement): JsonObject
    suspend fun callRenegotiate(sessionId: String, sdp: String, tracks: JsonElement?): JsonObject
    suspend fun callCloseTracks(sessionId: String, tracks: JsonElement)
    suspend fun callCloseSession(sessionId: String)

    // ── misc ──
    suspend fun health(): JsonObject
}

data class SignupResult(val user: User, val accessToken: String, val refreshToken: String)
data class LoginResult(val user: User, val accessToken: String, val refreshToken: String)
data class MessagesPage(val messages: List<com.fcfc.app.model.Message>, val hasMore: Boolean)
data class DownloadedFile(val bytes: ByteArray, val iv: String?, val name: String?, val mime: String?)
