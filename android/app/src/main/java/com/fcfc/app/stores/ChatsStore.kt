package com.fcfc.app.stores

import com.fcfc.app.model.Chat
import com.fcfc.app.model.Message
import com.fcfc.app.model.SendDraft

/**
 * Chats store — port of frontend/src/stores/chats.ts (Zustand, 1637 lines).
 * STATE + ACTION SIGNATURES are the contract; bodies implemented by the net/data agent.
 *
 * State is exposed as MutableStateFlow so Compose can collectAsState directly,
 * mirroring the web's useChats((s) => s.x) selectors.
 */
object ChatsStore {
    // ── state (mirror chats.ts ChatsState) ──
    val chats = kotlinx.coroutines.flow.MutableStateFlow<Map<String, Chat>>(emptyMap())
    val messages = kotlinx.coroutines.flow.MutableStateFlow<Map<String, List<Message>>>(emptyMap())
    val loadedAll = kotlinx.coroutines.flow.MutableStateFlow<Set<String>>(emptySet())
    val activeChatId = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    /** userId -> online boolean (presence) */
    val presence = kotlinx.coroutines.flow.MutableStateFlow<Map<String, Boolean>>(emptyMap())
    /** incoming message requests */
    val requests = kotlinx.coroutines.flow.MutableStateFlow<List<Map<String, kotlinx.serialization.json.JsonElement>>>(emptyList())
    /** msgId -> true while vanish particle animation runs */
    val vanish = kotlinx.coroutines.flow.MutableStateFlow<Set<String>>(emptySet())
    val starredIds = kotlinx.coroutines.flow.MutableStateFlow<Set<String>>(emptySet())
    /** chatId -> map msgId -> (list of seenBy user ids) */
    val seenBy = kotlinx.coroutines.flow.MutableStateFlow<Map<String, Map<String, List<String>>>>(emptyMap())
    /** reply preview for active chat */
    val replyingTo = kotlinx.coroutines.flow.MutableStateFlow<Message?>(null)
    val blockedIds = kotlinx.coroutines.flow.MutableStateFlow<Set<String>>(emptySet())
    /** msgId -> play counter (solo emoji replay) */
    val emojiPlays = kotlinx.coroutines.flow.MutableStateFlow<Map<String, Int>>(emptyMap())
    val booted = kotlinx.coroutines.flow.MutableStateFlow(false)
    val loadingHistory = kotlinx.coroutines.flow.MutableStateFlow<Set<String>>(emptySet())

    // ── actions (bodies by net/data agent; DO NOT change signatures) ──
    suspend fun boot() { TODO("net/data agent") }
    fun reset() { TODO("net/data agent") }
    suspend fun loadChats() { TODO("net/data agent") }
    suspend fun loadRequests() { TODO("net/data agent") }
    suspend fun loadBlocked() { TODO("net/data agent") }
    suspend fun openChat(chatId: String) { TODO("net/data agent") }
    fun closeChat() { TODO("net/data agent") }
    suspend fun loadHistory(chatId: String, before: Long? = null) { TODO("net/data agent") }
    suspend fun sendDraft(chatId: String, draft: SendDraft) { TODO("net/data agent") }
    fun setTyping(on: Boolean) { TODO("net/data agent") }
    suspend fun editMessage(chatId: String, id: String, body: String) { TODO("net/data agent") }
    suspend fun deleteForEveryone(chatId: String, id: String) { TODO("net/data agent") }
    suspend fun deleteForMe(chatId: String, id: String) { TODO("net/data agent") }
    fun finishVanish(id: String) { TODO("net/data agent") }
    suspend fun toggleReaction(chatId: String, id: String, emoji: String) { TODO("net/data agent") }
    suspend fun toggleStar(chatId: String, id: String) { TODO("net/data agent") }
    suspend fun togglePinMessage(chatId: String, id: String) { TODO("net/data agent") }
    suspend fun patchChatState(chatId: String, patch: Map<String, kotlinx.serialization.json.JsonElement>) { TODO("net/data agent") }
    suspend fun markRead(chatId: String) { TODO("net/data agent") }
    fun setReplying(m: Message?) { TODO("net/data agent") }
    suspend fun jumpToMessage(chatId: String, id: String) { TODO("net/data agent") }
    suspend fun localSearch(chatId: String, query: String): List<Message> { TODO("net/data agent") }
    suspend fun starredList(): List<Pair<Chat, Message>> { TODO("net/data agent") }
    suspend fun exportChat(chatId: String): String { TODO("net/data agent") }
    suspend fun createDm(userId: String): String? { TODO("net/data agent") }
    suspend fun openSaved(): String { TODO("net/data agent") }
    suspend fun createGroup(title: String, description: String?, memberIds: List<String>, limit: Int = 200): String? { TODO("net/data agent") }
    suspend fun joinInvite(code: String): String? { TODO("net/data agent") }
    suspend fun respondRequest(fromId: String, accept: Boolean) { TODO("net/data agent") }
    suspend fun replaySoloEmoji(chatId: String, id: String) { TODO("net/data agent") }
    suspend fun searchUsers(query: String): List<com.fcfc.app.model.User> { TODO("net/data agent") }
}
