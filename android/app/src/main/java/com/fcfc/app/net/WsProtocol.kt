package com.fcfc.app.net

import kotlinx.serialization.json.JsonElement

/**
 * WebSocket protocol models — port of the ChatRoom/UserHub event contract.
 * See /home/z/my-project/analysis/reports/2-c-backend-api.md (authoritative endpoint/event map).
 *
 * Wire shape (ChatRoom):  { "t": "<event>", ...fields }
 * Wire shape (UserHub):   { "t": "hub", "event": { "t": "<event>", ...fields } }
 */

/** All client→server ChatRoom event names (t field). */
object WsSend {
    const val MSG = "msg"
    const val TYPING = "typing"
    const val READ = "read"
    const val DELIVERED = "delivered"
    const val EDIT = "edit"
    const val DEL_ALL = "delAll"
    const val REACT = "react"
    const val EMOJI_REPLAY = "emoji-replay"
    const val PIN = "pin"
    const val RENEGO = "renego"
    const val SK_REQUEST = "skrequest"
    const val CALL = "call"
    const val CALL_STATE = "call-state"
    const val SEEN_REQ = "seen-req"
    const val PING = "ping"
}

/** All server→client event names (both socket kinds). */
object WsRecv {
    const val HELLO = "hello"
    const val PRESENCE = "presence"
    const val PONG = "pong"
    const val MSG = "msg"
    const val MSG_REJECTED = "msg-rejected"
    const val DELIVERED = "delivered"
    const val READ = "read"
    const val TYPING = "typing"
    const val RENEGO = "renego"
    const val SK_REQUEST = "skrequest"
    const val EDIT = "edit"
    const val DEL_ALL = "delAll"
    const val REACT = "react"
    const val EMOJI_REPLAY = "emoji-replay"
    const val PINS = "pins"
    const val CALL = "call"
    const val SEEN_ACK = "seen-ack"
    const val HUB = "hub"
    const val HB_ACK = "hb-ack"
}

/** Parsed incoming event after unwrapping. */
data class WsEvent(
    val name: String,
    val data: JsonElement,
    /** raw object for typed access */
    val obj: kotlinx.serialization.json.JsonObject,
)

/** Parsed message wire object: {t:'msg', chatId, m:{id,ts,type,payload,self?}} */
@kotlinx.serialization.Serializable
data class WireMessage(
    val id: String = "",
    @kotlinx.serialization.SerialName("chatId") val chatId: String = "",
    @kotlinx.serialization.SerialName("senderId") val senderId: String = "",
    val ts: Long = 0,
    val type: String = "text",
    val payload: JsonElement? = null,
    val media: com.fcfc.app.model.MediaMeta? = null,
    @kotlinx.serialization.SerialName("replyTo") val replyTo: JsonElement? = null,
    @kotlinx.serialization.SerialName("fwdFrom") val fwdFrom: String? = null,
    val reactions: Map<String, List<String>> = emptyMap(),
    val pins: List<String>? = null,
    val self: JsonElement? = null,
    /** only on server echo of sender's own msg */
    val mid: String? = null,
)
