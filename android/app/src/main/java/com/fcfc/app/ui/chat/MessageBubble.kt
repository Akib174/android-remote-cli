package com.fcfc.app.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fcfc.app.core.t
import com.fcfc.app.emoji.EmojiImage
import com.fcfc.app.emoji.EmojiText
import com.fcfc.app.model.ChatKind
import com.fcfc.app.model.Message
import com.fcfc.app.model.MsgType
import com.fcfc.app.stores.AuthStore
import com.fcfc.app.stores.ChatsStore
import com.fcfc.app.stores.UiStore
import com.fcfc.app.theme.fcfcColors
import com.fcfc.app.theme.senderColorFor
import com.fcfc.app.ui.common.Avatar
import com.fcfc.app.ui.list.chatTitleOf
import kotlinx.coroutines.launch

private val REACTIONS = listOf("👍", "❤️", "😂", "😮", "😢", "🔥")

/**
 * Message bubble — port of components/chat/MessageBubble.tsx.
 * Mine/theirs with tail, group sender color, reply quote, media/voice/file
 * bodies, reactions, ticks, solo-emoji 5x, long-press context menu with
 * reaction row, vanish support.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubble(
    msg: Message,
    prev: Message?,
    chatId: String,
    kind: ChatKind,
    members: List<com.fcfc.app.model.ChatMember>,
) {
    val me = AuthStore.userId
    val mine = msg.senderId == me
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    val vanish by ChatsStore.vanish.collectAsState()
    val starredIds by ChatsStore.starredIds.collectAsState()
    val vanishing = vanish.contains(msg.id)
    val starred = starredIds.contains(msg.id)

    val vanishingAlpha by animateFloatAsState(
        targetValue = if (vanishing) 0f else 1f,
        animationSpec = tween(260),
        label = "vanish",
    )
    if (vanishing) {
        androidx.compose.runtime.LaunchedEffect(msg.id) {
            kotlinx.coroutines.delay(280)
            ChatsStore.finishVanish(msg.id)
        }
    }

    // call history row — centered service pill
    if (msg.type == MsgType.CALL) {
        CallPill(msg, mine)
        return
    }

    val sender = members.firstOrNull { it.id == msg.senderId }
    val sameSender = prev != null && prev.senderId == msg.senderId && msg.ts - prev.ts < 4 * 60_000 && prev.type != MsgType.SYSTEM
    val isGroup = kind == ChatKind.GROUP
    val soloEmoji = if (msg.type == MsgType.TEXT) isSingleEmoji(msg.body ?: "") else null
    val isMedia = msg.type == MsgType.IMAGE || msg.type == MsgType.GIF

    fun openBubbleMenu() {
        val items = mutableListOf<UiStore.MenuItem>()
        items.add(UiStore.MenuItem(t("reactBtn")) { UiStore.openMenu(40f, 320f, emptyList(), UiStore.MenuReactions(
            emojis = REACTIONS, more = EmojiAll.reactionSet(), onPick = { em ->
                scope.launch { ChatsStore.toggleReaction(chatId, msg.id, em) }
            })) })
        items.add(UiStore.MenuItem(t("replyLabel")) { ChatsStore.setReplying(msg) })
        items.add(UiStore.MenuItem(t("copyText")) {
            com.fcfc.app.core.Clipboard.copy(msg.body ?: "")
            UiStore.toast(t("copied"))
        })
        items.add(UiStore.MenuItem(t("forward")) { UiStore.openModal("forward", msg.toJsonString()) })
        if (mine && msg.type == MsgType.TEXT) {
            items.add(UiStore.MenuItem(t("edit")) { UiStore.openModal("edit", msg.toJsonString()) })
        }
        items.add(UiStore.MenuItem(if (starred) t("unstar") else t("star")) {
            scope.launch { ChatsStore.toggleStar(chatId, msg.id) }
        })
        items.add(UiStore.MenuItem(t("deleteMe"), danger = true) {
            scope.launch { ChatsStore.deleteForMe(chatId, msg.id) }
        })
        if (mine) {
            items.add(UiStore.MenuItem(t("deleteAll"), danger = true) {
                ChatsStore.deleteForEveryone(chatId, msg.id)
            })
        }
        UiStore.openMenu(60f, 260f, items, UiStore.MenuReactions(
            emojis = REACTIONS,
            onPick = { em -> scope.launch { ChatsStore.toggleReaction(chatId, msg.id, em) } },
        ))
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp)
            .alpha(vanishingAlpha)
            .graphicsLayer {
                val s = if (vanishing) 0.86f else 1f
                scaleX = s; scaleY = s
            }
            .padding(top = if (sameSender) 1.dp else 8.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom,
    ) {
        // group: peer avatar
        if (!mine && isGroup) {
            Box(Modifier.width(36.dp)) {
                if (!sameSender && sender != null) {
                    Avatar(name = sender.name ?: sender.username, sizeDp = 32, avatarKey = sender.avatarKey)
                }
            }
            Spacer(Modifier.width(6.dp))
        }

        // bubble
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            // sender name (group, first of run)
            if (!mine && isGroup && !sameSender && sender != null) {
                Text(
                    sender.name ?: sender.username,
                    fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                    color = senderColorFor(msg.senderId, colors),
                    modifier = Modifier.padding(start = 12.dp, bottom = 2.dp),
                )
            }
            BubbleBox(
                mine = mine, isMedia = isMedia, soloEmoji = soloEmoji, msg = msg,
                onLongPress = { openBubbleMenu() },
                onDoubleTap = { ChatsStore.setReplying(msg) },
                onSoloEmojiTap = { scope.launch { ChatsStore.replaySoloEmoji(chatId, msg.id) } },
            )
            // reactions
            if (msg.reactions.isNotEmpty()) {
                Row(
                    modifier = Modifier.padding(start = 8.dp, top = 3.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    msg.reactions.forEach { (emoji, users) ->
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .background(colors.reactionPillBg)
                                .border(1.dp, Color(0x140F172A), RoundedCornerShape(999.dp))
                                .padding(horizontal = 8.dp, vertical = 3.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            EmojiImage(emoji, 14.dp)
                            Text(
                                users.size.toString(),
                                fontSize = 11.sp, color = colors.reactionPillText,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun BubbleBox(
    mine: Boolean,
    isMedia: Boolean,
    soloEmoji: String?,
    msg: Message,
    onLongPress: () -> Unit,
    onDoubleTap: () -> Unit,
    onSoloEmojiTap: () -> Unit,
) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val shape = BubbleShape(mine, soloEmoji != null || isMedia || msg.type == MsgType.STICKER)
    val pad = if (isMedia || soloEmoji != null || msg.type == MsgType.STICKER) 4.dp else 10.dp

    Box(
        modifier = Modifier
            .widthIn(0.dp, if (soloEmoji != null) 200.dp else 280.dp)
            .clip(shape)
            .background(if (soloEmoji != null) Color(0x00FFFFFF) else if (mine) colors.bubbleOut else colors.bubbleIn)
            .border(
                if (soloEmoji != null) 0.dp else 1.dp,
                if (mine) colors.bubbleOutBorder else colors.bubbleInBorder,
                shape,
            )
            .combinedClickable(
                onClick = {
                    if (soloEmoji != null) onSoloEmojiTap()
                },
                onDoubleClick = onDoubleTap,
                onLongClick = onLongPress,
            )
            .padding(pad),
    ) {
        Column {
            // reply quote
            msg.replyTo?.let { r ->
                Row(
                    modifier = Modifier
                        .padding(bottom = 4.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (mine) Color(0x14FFFFFF) else Color(0x0F3D6EF3))
                        .padding(horizontal = 8.dp, vertical = 5.dp),
                ) {
                    Box(Modifier.width(3.dp).height(28.dp).clip(RoundedCornerShape(2.dp)).background(if (mine) Color(0x80FFFFFF) else colors.brand500))
                    Spacer(Modifier.width(6.dp))
                    Column {
                        Text(r.senderId, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = if (mine) colors.bubbleOutText else colors.brand500)
                        Text(r.body, fontSize = 12.sp, color = if (mine) colors.bubbleOutText.copy(alpha = 0.7f) else colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            // forwarded tag
            if (msg.fwdFrom != null) {
                Text("${t("forwardedTag")} · ${msg.fwdFrom}", fontSize = 10.5.sp, color = colors.textMuted, fontStyle = FontStyle.Italic)
            }
            // body
            when (msg.type) {
                MsgType.TEXT -> {
                    if (soloEmoji != null) {
                        EmojiImage(soloEmoji, 78.dp, modifier = Modifier.padding(4.dp))
                    } else {
                        EmojiText(
                            text = msg.body ?: "",
                            style = androidx.compose.ui.text.TextStyle(
                                fontSize = 14.5.sp, lineHeight = 23.sp,
                                color = if (mine) colors.bubbleOutText else colors.bubbleInText,
                            ),
                        )
                    }
                }
                MsgType.IMAGE, MsgType.GIF, MsgType.VIDEO -> MediaBody(msg, mine)
                MsgType.VOICE -> VoiceBody(msg, mine)
                MsgType.FILE -> FileBody(msg, mine)
                MsgType.STICKER -> EmojiImage(msg.body ?: "🌟", 96.dp)
                MsgType.SYSTEM -> Text(msg.body ?: "", fontSize = 12.sp, color = colors.textSecondary)
                else -> Text(msg.body ?: "", fontSize = 14.5.sp, color = if (mine) colors.bubbleOutText else colors.bubbleInText)
            }
            // meta: time + ticks + edited
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(3.dp),
                modifier = Modifier
                    .align(Alignment.End)
                    .padding(top = 2.dp),
            ) {
                if (msg.editedAt != null) Text(t("editedTag"), fontSize = 9.5.sp, color = if (mine) colors.bubbleOutText.copy(alpha = 0.55f) else colors.textMuted)
                Text(
                    java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date(msg.ts)),
                    fontSize = 10.5.sp,
                    color = if (mine) colors.bubbleOutText.copy(alpha = 0.55f) else colors.textMuted,
                )
                if (mine) Ticks(msg)
            }
        }
    }
}

@Composable
private fun Ticks(msg: Message) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val tickColor = when {
        msg.read == true -> colors.tickRead
        msg.delivered == true -> if (UiStore.theme.value == "dark") Color(0xFF93B4FF) else Color(0xFF7A96F3)
        msg.failed == true -> Color(0xFFE5484D)
        msg.pending == true -> Color(0x8894A3B8)
        else -> Color(0x8894A3B8)
    }
    if (msg.pending == true) {
        Text("🕓", fontSize = 10.sp)
    } else if (msg.failed == true) {
        Text("!", fontSize = 11.sp, color = Color(0xFFE5484D), fontWeight = FontWeight.Black)
    } else if (msg.read == true || msg.delivered == true) {
        // double tick
        Row {
            Text("✓", fontSize = 11.sp, color = tickColor, fontWeight = FontWeight.Bold)
            Text("✓", fontSize = 11.sp, color = tickColor, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = (-4).dp))
        }
    } else {
        Text("✓", fontSize = 11.sp, color = tickColor, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun CallPill(msg: Message, mine: Boolean) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val call = msg.call
    val mode = (call as? kotlinx.serialization.json.JsonObject)?.get("mode")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } ?: "audio"
    val duration = (call as? kotlinx.serialization.json.JsonObject)?.get("dur")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() } ?: 0
    val title = if (mine) t("callOutgoing") else t("callIncoming")
    val mins = duration / 60
    val secs = duration % 60
    val durText = if (duration > 0) " · " + t(if (mins == 1) "durMin1" else "durMinN", "n" to mins.toString()) + " " + t(if (secs == 1) "durSec1" else "durSecN", "n" to secs.toString()) else ""
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.Center,
    ) {
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(colors.servicePillBg)
                .padding(horizontal = 12.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(if (mode == "video") "📹" else "📞", fontSize = 12.sp)
            Text(
                "$title$durText",
                fontSize = 11.5.sp,
                color = colors.servicePillText,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun MediaBody(msg: Message, mine: Boolean) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val media = msg.media
    val url by androidx.compose.runtime.produceState<String?>(initialValue = null, key1 = media?.key) {
        value = runCatching { com.fcfc.app.media.Media.decryptedMediaUrl(media) }.getOrNull()
    }
    Box(
        modifier = Modifier
            .size(width = 230.dp, height = 160.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0x140F172A)),
        contentAlignment = Alignment.Center,
    ) {
        if (url != null) {
            coil.compose.AsyncImage(
                model = url,
                contentDescription = media?.name,
                modifier = Modifier.size(230.dp, 160.dp).clip(RoundedCornerShape(14.dp)),
            )
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (msg.type == MsgType.VIDEO) "🎬" else "🖼", fontSize = 22.sp)
                Text(t("mediaLoadFail"), fontSize = 10.5.sp, color = colors.textMuted)
            }
        }
        if (msg.type == MsgType.VIDEO) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(Color(0x99000000)),
                contentAlignment = Alignment.Center,
            ) { Text("▶", color = Color.White, fontSize = 16.sp) }
        }
    }
}

@Composable
private fun VoiceBody(msg: Message, mine: Boolean) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val dur = ((msg.media?.dur ?: 0.0) / 1000.0).toInt()
    val red = msg.ap == true
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.padding(vertical = 2.dp, horizontal = 4.dp),
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(if (red) Color(0x1AE5484D) else Color(0x143D6EF3)),
            contentAlignment = Alignment.Center,
        ) {
            Text("🎤", fontSize = 15.sp)
        }
        Column {
            // waveform bars
            Row(
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.height(22.dp),
            ) {
                val seed = msg.id.hashCode()
                for (i in 0 until 22) {
                    val h = ((seed ushr i) % 15 + 6).dp
                    Box(
                        Modifier
                            .width(2.5.dp)
                            .height(h)
                            .clip(CircleShape)
                            .background(if (mine) colors.bubbleOutText.copy(alpha = 0.5f) else colors.brand500.copy(alpha = 0.6f)),
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "${dur / 60}:${"%02d".format(dur % 60)}",
                    fontSize = 10.5.sp, color = if (mine) colors.bubbleOutText.copy(alpha = 0.55f) else colors.textMuted,
                )
                if (red) Text(
                    t("autoPlayTag"),
                    fontSize = 9.sp, color = Color(0xFFE5484D), fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color(0x1AE5484D))
                        .padding(horizontal = 4.dp, vertical = 1.dp),
                )
            }
        }
    }
}

@Composable
private fun FileBody(msg: Message, mine: Boolean) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.padding(4.dp),
    ) {
        Box(
            modifier = Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0x143D6EF3)),
            contentAlignment = Alignment.Center,
        ) { Text("📄", fontSize = 17.sp) }
        Column {
            Text(msg.media?.name ?: t("fileLabel"), fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = if (mine) colors.bubbleOutText else colors.bubbleInText, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${(msg.media?.size ?: 0) / 1024} KB · ${t("download")}",
                fontSize = 11.sp, color = if (mine) colors.bubbleOutText.copy(alpha = 0.55f) else colors.textMuted,
            )
        }
    }
}

private fun BubbleShape(mine: Boolean, round: Boolean): androidx.compose.ui.graphics.Shape {
    val r = if (round) 16.dp else if (mine) 16.dp else 16.dp
    val tail = 5.dp
    return androidx.compose.foundation.shape.RoundedCornerShape(
        topStart = if (mine) r else (r - tail),
        topEnd = if (mine) (r - tail) else r,
        bottomStart = if (mine) r else (r - tail),
        bottomEnd = if (mine) (r - tail) else r,
    )
}

/** single-emoji message detection — Telegram-style (EmojiData.soloEmoji). */
private fun isSingleEmoji(text: String): String? {
    val e = com.fcfc.app.emoji.EmojiData.isSingleEmoji(text)
    return e
}

private object EmojiAll {
    private val all by lazy { com.fcfc.app.emoji.EmojiData.allEmojis().take(96) }
    fun reactionSet(): List<String> = all
}

private fun Message.toJsonString(): String = kotlinx.serialization.json.Json.encodeToString(
    com.fcfc.app.model.Message.serializer(), this)
