package com.fcfc.app.net

import com.fcfc.app.model.Chat
import com.fcfc.app.model.ChatMember
import com.fcfc.app.model.ChatKind
import com.fcfc.app.model.MediaMeta
import com.fcfc.app.model.Message
import com.fcfc.app.model.MsgType
import com.fcfc.app.model.User
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Server wire-row → model mapping. The Worker returns raw D1 rows
 * (snake_case) for chats / members / messages; users pass through
 * `publicUser()` (camelCase) already. Mirrors the mapping embedded in
 * frontend/src/stores/chats.ts (loadChats / rowToMessage).
 */
object Wire {

    private fun JsonObject.s(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
    private fun JsonObject.n(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull
    private fun JsonObject.b(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

    /** publicUser JSON → User (camelCase already). */
    fun user(j: JsonObject): User = User(
        id = j.s("id") ?: "",
        username = j.s("username") ?: "",
        name = j.s("name"),
        userIdCode = j.s("userIdCode"),
        about = j.s("about"),
        avatarKey = j.s("avatarKey"),
        phone = j.s("phone"),
        email = j.s("email"),
        lastSeenAt = j.n("lastSeenAt"),
        lastSeenPriv = j.s("lastSeenPriv"),
        privacyDm = j.s("privacyDm"),
        deleted = j.b("deleted"),
    )

    /** /chats row → Chat shell (members filled by caller from /chats/:id). */
    fun chatFromRow(r: JsonObject): Chat = Chat(
        id = r.s("id") ?: "",
        kind = if (r.s("kind") == "group") ChatKind.GROUP else ChatKind.DM,
        title = r.s("title") ?: "",
        photoKey = r.s("photo_key") ?: "",
        description = r.s("description") ?: "",
        memberLimit = r.n("member_limit"),
        members = emptyList(),
        pinned = r.b("pinned") ?: false,
        archived = r.b("archived") ?: false,
        mutedUntil = r.n("muted_until") ?: 0L,
        wallpaper = r.s("wallpaper") ?: "",
        ttl = r.n("ttl") ?: 0L,
        likeEmoji = r.s("like_emoji") ?: "",
        unread = r.n("unread") ?: 0L,
        lastTs = r.n("last_ts") ?: 0L,
    )

    /** /chats/:id member row (snake_case) → ChatMember. */
    fun memberFromRow(m: JsonObject): ChatMember = ChatMember(
        id = m.s("id") ?: "",
        username = m.s("username") ?: "",
        name = m.s("name"),
        userIdCode = m.s("user_id_code"),
        about = m.s("about"),
        avatarKey = m.s("avatar_key"),
        role = m.s("role") ?: "member",
        deleted = m.b("deleted"),
    )

    fun memberToUser(m: ChatMember): User = User(
        id = m.id, username = m.username, name = m.name, userIdCode = m.userIdCode,
        about = m.about, avatarKey = m.avatarKey, deleted = m.deleted,
    )

    /** messages row {mid, sender_id, ts, type, payload} → Message (undecrypted). */
    fun messageFromRow(chatId: String, r: JsonObject): Message = Message(
        id = r.s("mid") ?: (r.s("id") ?: ""),
        chatId = chatId,
        senderId = r.s("sender_id") ?: (r.s("senderId") ?: ""),
        ts = r.n("ts") ?: 0L,
        type = MsgType.fromWire(r.s("type")),
        payload = r["payload"],
        // live events carry camelCase extras:
        reactions = (r["reactions"] as? JsonObject)?.mapValues { (_, v) ->
            v.jsonArray.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        } ?: emptyMap(),
        media = (r["media"] as? JsonObject)?.let { mediaFromJson(it) },
        replyTo = (r["replyTo"] as? JsonObject)?.let {
            com.fcfc.app.model.ReplyRef(it.s("id") ?: "", it.s("body") ?: "", it.s("senderId") ?: "")
        },
        fwdFrom = r.s("fwdFrom"),
        editedAt = r.n("editedAt") ?: r.n("edited_at"),
        expiresAt = r.n("expiresAt") ?: r.n("expires_at"),
    )

    fun mediaFromJson(m: JsonObject): MediaMeta = MediaMeta(
        key = m.s("key") ?: "",
        name = m.s("name"),
        size = m.n("size"),
        mime = m.s("mime"),
        iv = m.s("iv"),
        fileKey = m.s("fileKey"),
        w = m.n("w"),
        h = m.n("h"),
        dur = (m["dur"] as? JsonPrimitive)?.doubleOrNull,
    )
}
