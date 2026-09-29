package com.fcfc.app.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** Mirrors frontend/src/types.ts — the canonical data contract shared by UI, net and crypto. */

@Serializable
data class User(
    val id: String = "",
    val username: String = "",
    val name: String? = null,
    @SerialName("userIdCode") val userIdCode: String? = null,
    val about: String? = null,
    val avatarKey: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val lastSeenAt: Long? = null,
    @SerialName("lastSeenPriv") val lastSeenPriv: String? = null,
    @SerialName("privacyDm") val privacyDm: String? = null,
    val deleted: Boolean? = null,
)

@Serializable
enum class MsgType {
    @SerialName("text") TEXT,
    @SerialName("image") IMAGE,
    @SerialName("video") VIDEO,
    @SerialName("voice") VOICE,
    @SerialName("file") FILE,
    @SerialName("sticker") STICKER,
    @SerialName("gif") GIF,
    @SerialName("system") SYSTEM,
    @SerialName("sender-key") SENDER_KEY,
    @SerialName("call") CALL;

    val wire: String get() = when (this) {
        TEXT -> "text"; IMAGE -> "image"; VIDEO -> "video"; VOICE -> "voice"; FILE -> "file"
        STICKER -> "sticker"; GIF -> "gif"; SYSTEM -> "system"; SENDER_KEY -> "sender-key"; CALL -> "call"
    }
    companion object {
        fun fromWire(s: String?): MsgType = when (s) {
            "image" -> IMAGE; "video" -> VIDEO; "voice" -> VOICE; "file" -> FILE
            "sticker" -> STICKER; "gif" -> GIF; "system" -> SYSTEM; "sender-key" -> SENDER_KEY; "call" -> CALL
            else -> TEXT
        }
    }
}

@Serializable
data class MediaMeta(
    val key: String = "",
    val name: String? = null,
    val size: Long? = null,
    val mime: String? = null,
    val iv: String? = null,
    @SerialName("fileKey") val fileKey: String? = null,
    val w: Long? = null,
    val h: Long? = null,
    val dur: Double? = null,
)

@Serializable
data class ReplyRef(val id: String = "", val body: String = "", val senderId: String = "")

/** reactions: emoji -> list of user ids. Serialized as a plain map. */
typealias ReactionMap = Map<String, List<String>>

@Serializable
data class Message(
    val id: String = "",
    val chatId: String = "",
    val senderId: String = "",
    val ts: Long = 0,
    val type: MsgType = MsgType.TEXT,
    val body: String? = null,
    /** Raw encrypted payload as received from the server (wire JSON). */
    val payload: JsonElement? = null,
    val media: MediaMeta? = null,
    val replyTo: ReplyRef? = null,
    val fwdFrom: String? = null,
    val editedAt: Long? = null,
    val expiresAt: Long? = null,
    val reactions: ReactionMap = emptyMap(),
    val pending: Boolean? = null,
    val failed: Boolean? = null,
    val starred: Boolean? = null,
    val read: Boolean? = null,
    val delivered: Boolean? = null,
    /** voice auto-play flag (red mic mode) */
    val ap: Boolean? = null,
    /** call-history row metadata (type == call) */
    val call: JsonElement? = null,
)

@Serializable
data class ChatMember(
    val id: String = "",
    val username: String = "",
    val name: String? = null,
    @SerialName("userIdCode") val userIdCode: String? = null,
    val about: String? = null,
    val avatarKey: String? = null,
    val role: String = "member",
    val deleted: Boolean? = null,
)

@Serializable
enum class ChatKind { @SerialName("dm") DM, @SerialName("group") GROUP }

@Serializable
data class ActiveCall(
    val sessionId: String? = null,
    val mode: String? = null,
    val auto: Boolean? = null,
    val startedBy: String? = null,
    val startedAt: Long? = null,
    val acceptedAt: Long? = null,
    val declinedBy: List<String>? = null,
    val sharing: String? = null,
    val sessions: Map<String, String>? = null,
)

@Serializable
data class Chat(
    val id: String = "",
    val kind: ChatKind = ChatKind.DM,
    val title: String? = null,
    val photoKey: String? = null,
    val description: String? = null,
    val memberLimit: Long? = null,
    val members: List<ChatMember> = emptyList(),
    val pinned: Boolean? = null,
    val archived: Boolean? = null,
    val mutedUntil: Long? = null,
    val wallpaper: String? = null,
    val ttl: Long? = null,
    val unread: Long = 0,
    val lastTs: Long? = null,
    val lastPreview: String? = null,
    val typing: List<String>? = null,
    val pins: List<String>? = null,
    val activeCall: ActiveCall? = null,
    val likeEmoji: String? = null,
    val saved: Boolean? = null,
    /** for DMs: resolved peer user (client-side) */
    @Transient val peer: User? = null,
)

@Serializable
data class DeviceInfo(
    val id: String = "",
    val name: String = "",
    val approved: Long = 0,
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("last_active") val lastActive: Long = 0,
)

@Serializable
data class SendDraft(
    val type: MsgType = MsgType.TEXT,
    val body: String? = null,
    val media: MediaMeta? = null,
    val replyTo: ReplyRef? = null,
    val ttl: Long? = null,
    val fwdFrom: String? = null,
    val autoPlay: Boolean? = null,
)

@Serializable
enum class ThemeMode { @SerialName("light") LIGHT, @SerialName("dark") DARK }

// ── Call UI state (client-side) ─────────────────────────────────────────────
@Serializable
data class CallUi(
    val chatId: String = "",
    val mode: String = "audio",           // audio | video
    val incoming: Boolean? = null,
    val auto: Boolean? = null,
    val acceptedNow: Boolean? = null,
)

// ── API payload wrapper: server stores opaque payload json ────────────────
@Serializable
data class Envelope(
    val v: Int = 1,
    val ct: String = "",
    val iv: String = "",
    val hdr: EnvelopeHeader? = null,
    val hs: JsonElement? = null,
    val g: Int? = null,
    val sid: String? = null,
    val n: Long? = null,
)

@Serializable
data class EnvelopeHeader(
    val pk: JsonElement? = null,   // full public JWK object
    val pn: Long? = null,
    val n: Long? = null,
)
