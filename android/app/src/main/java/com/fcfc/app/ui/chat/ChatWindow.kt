package com.fcfc.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fcfc.app.core.t
import com.fcfc.app.model.ChatKind
import com.fcfc.app.stores.ChatsStore
import com.fcfc.app.stores.UiStore
import com.fcfc.app.theme.fcfcColors
import com.fcfc.app.ui.common.Avatar
import com.fcfc.app.ui.list.chatTitleOf
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Chat window — port of components/chat/ChatWindow.tsx.
 * Header with tap-to-profile, pinned banner, date-separated message list,
 * e2e first-open notice, blocked bar, composer.
 */
@Composable
fun ChatWindow(chatId: String, onBack: () -> Unit) {
    val chats by ChatsStore.chats.collectAsState()
    val messages by ChatsStore.messages.collectAsState()
    val presence by ChatsStore.presence.collectAsState()
    val blockedIds by ChatsStore.blockedIds.collectAsState()
    val jumpTarget by ChatsStore.jumpTarget.collectAsState()
    val chat = chats[chatId] ?: run { onBack(); return }
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val list = messages[chatId] ?: emptyList()

    // open chat on composition
    LaunchedEffect(chatId) {
        ChatsStore.openChat(chatId)
    }

    // autoscroll to latest
    LaunchedEffect(list.size) {
        if (list.isNotEmpty()) listState.animateScrollToItem(0)
    }
    // reply jump
    LaunchedEffect(jumpTarget) {
        val (cid, mid) = jumpTarget ?: return@LaunchedEffect
        if (cid != chatId) return@LaunchedEffect
        val idx = list.indexOfFirst { it.id == mid }
        if (idx >= 0) {
            listState.animateScrollToItem(idx)
            ChatsStore.jumpTarget.value = null
        }
    }

    val online = chat.kind == ChatKind.DM && chat.peer != null && (presence[chat.peer!!.id] ?: false)
    val typing = chat.typing ?: emptyList()
    val title = chatTitleOf(chat)
    val subtitle = when {
        chat.saved == true -> t("savedSub")
        typing.isNotEmpty() -> t("typingMulti", "names" to typing.joinToString(", "))
        chat.kind == ChatKind.GROUP -> t("membersCount", "n" to chat.members.size.toString())
        online -> t("online")
        chat.peer?.deleted == true -> t("accountDeleted")
        chat.peer?.lastSeenPriv == "nobody" -> t("lastSeenHidden")
        else -> t("lastSeenAt", "when" to fmtLastSeen(chat.peer?.lastSeenAt))
    }
    val iBlocked = chat.kind == ChatKind.DM && chat.peer != null && blockedIds.contains(chat.peer!!.id)

    Column(Modifier.fillMaxSize().background(colors.body)) {
        // header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 8.dp, vertical = 6.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(colors.glassBar)
                .border(1.dp, colors.glassBorder, RoundedCornerShape(16.dp))
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .clickable { onBack(); ChatsStore.closeChat(); UiStore.setMobileView("list") },
                contentAlignment = Alignment.Center,
            ) { Text("←", fontSize = 18.sp, color = colors.textPrimary) }
            Spacer(Modifier.width(6.dp))
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(12.dp))
                    .clickable { UiStore.openRightPanel(chatId) }
                    .padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(
                    name = title, sizeDp = 42, online = online,
                    avatarKey = if (chat.kind == ChatKind.GROUP) chat.photoKey else chat.peer?.avatarKey,
                )
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        subtitle, fontSize = 12.sp,
                        color = if (typing.isNotEmpty()) colors.brand500 else colors.textSecondary,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            // active call banner
            if (chat.activeCall != null) {
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(Color(0x2610B981))
                        .clickable { UiStore.setCall(com.fcfc.app.model.CallUi(chatId = chatId, mode = "video")) }
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(Color(0xFF10B981)))
                    Spacer(Modifier.width(5.dp))
                    Text(t("callOngoing"), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF059669))
                }
                Spacer(Modifier.width(4.dp))
            }
            // call buttons
            if (chat.kind == ChatKind.DM || chat.kind == ChatKind.GROUP) {
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .clickable { UiStore.setCall(com.fcfc.app.model.CallUi(chatId = chatId, mode = "audio", incoming = false)) },
                    contentAlignment = Alignment.Center,
                ) { Text("📞", fontSize = 16.sp) }
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .clickable { UiStore.setCall(com.fcfc.app.model.CallUi(chatId = chatId, mode = "video", incoming = false)) },
                    contentAlignment = Alignment.Center,
                ) { Text("🎥", fontSize = 16.sp) }
            }
            // more menu
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .clickable { headerMenu(chatId, chat) },
                contentAlignment = Alignment.Center,
            ) { Text("⋮", fontSize = 18.sp, color = colors.textSecondary) }
        }

        // pinned banner
        val pins = (chat.pins ?: emptyList()).mapNotNull { id -> list.firstOrNull { it.id == id } }
        if (pins.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 2.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(colors.glass)
                    .border(1.dp, colors.glassBorder, RoundedCornerShape(10.dp))
                    .clickable {
                        val target = pins.first().id
                        scope.launch { ChatsStore.jumpToMessage(chatId, target) }
                    }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("📌", fontSize = 13.sp)
                Spacer(Modifier.width(8.dp))
                Text(
                    "${pins.lastOrNull()?.body ?: ""}",
                    fontSize = 12.5.sp, color = colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text("${t("nPinnedMsgs", "n" to pins.size.toString())}", fontSize = 11.sp, color = colors.textMuted)
            }
        }

        // blocked bar
        if (iBlocked) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0x1AE5484D))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    t("blockedBar", "name" to (chat.peer?.username ?: "")),
                    fontSize = 12.5.sp, color = Color(0xFFE5484D), modifier = Modifier.weight(1f),
                )
                Text(
                    t("unblock"), fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = Color(0xFFE5484D),
                    modifier = Modifier.clickable {
                        scope.launch { ChatsStore.unblock(chat.peer!!.id) }
                    },
                )
            }
        }

        // message list (newest first → reverseLayout)
        Box(Modifier.weight(1f)) {
            LazyColumn(
                state = listState,
                reverseLayout = true,
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 8.dp),
            ) {
                // e2e notice when empty
                if (list.isEmpty()) {
                    item {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(top = 80.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text("🔒 ${t("e2eTagline")}", fontSize = 12.5.sp, color = colors.textMuted, modifier = Modifier.padding(horizontal = 40.dp))
                        }
                    }
                }
                itemsIndexed(list.asReversed(), key = { _, m -> m.id }) { i, m ->
                    val idxFromEnd = list.size - 1 - i
                    val prev = if (idxFromEnd + 1 < list.size) list[idxFromEnd + 1] else null
                    // date separator
                    val showDate = prev == null || dayOf(prev.ts) != dayOf(m.ts)
                    Column {
                        if (showDate) {
                            Box(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    dateLabel(m.ts),
                                    fontSize = 10.5.sp, color = colors.textMuted,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(999.dp))
                                        .background(colors.glass)
                                        .padding(horizontal = 10.dp, vertical = 3.dp),
                                )
                            }
                        }
                        MessageBubble(msg = m, prev = prev, chatId = chatId, kind = chat.kind, members = chat.members)
                    }
                }
            }
        }

        // composer
        Composer(chat)
    }
}

private fun dayOf(ts: Long): String = SimpleDateFormat("yyyyMMdd", Locale.getDefault()).format(Date(ts))
private fun dateLabel(ts: Long): String = SimpleDateFormat("d MMMM", Locale.getDefault()).format(Date(ts))

private fun fmtLastSeen(ts: Long?): String {
    if (ts == null || ts == 0L) return t("longAgo")
    val diff = System.currentTimeMillis() - ts
    return when {
        diff < 60_000 -> t("justNow")
        diff < 3600_000 -> t("minAgo", "n" to (diff / 60_000).toString())
        diff < 86400_000 -> t("hourAgo", "n" to (diff / 3600_000).toString())
        else -> SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(ts))
    }
}

private fun headerMenu(chatId: String, chat: com.fcfc.app.model.Chat) {
    val muted = (chat.mutedUntil ?: 0) > System.currentTimeMillis()
    val items = mutableListOf(
        UiStore.MenuItem(t("searchInChat")) { UiStore.openModal("search", chatId) },
        UiStore.MenuItem(if (muted) t("unmute") else t("mute8h")) {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
                ChatsStore.patchChatState(chatId, mapOf("mutedUntil" to kotlinx.serialization.json.JsonPrimitive(
                    if (muted) 0L else System.currentTimeMillis() + 8 * 3600_000)))
            }
        },
        UiStore.MenuItem(if ((chat.ttl ?: 0) > 0) t("disappOff") else t("disapp24")) {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
                ChatsStore.patchChatState(chatId, mapOf("ttl" to kotlinx.serialization.json.JsonPrimitive(if ((chat.ttl ?: 0) > 0) 0L else 86400L)))
            }
        },
        UiStore.MenuItem(t("exportChat")) {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
                val text = ChatsStore.exportChat(chatId)
                com.fcfc.app.core.Clipboard.copy(text)
                UiStore.toast(t("copied"))
            }
        },
        UiStore.MenuItem(if (chat.kind == ChatKind.GROUP) t("groupInfo") else t("viewProfile")) {
            UiStore.openRightPanel(chatId)
        },
    )
    if (chat.kind == ChatKind.DM) {
        items.add(UiStore.MenuItem(t("deleteChatMe"), danger = true) {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
                ChatsStore.patchChatState(chatId, mapOf(
                    "deleteForMe" to kotlinx.serialization.json.JsonPrimitive(true),
                    "unread" to kotlinx.serialization.json.JsonPrimitive(0),
                ))
                ChatsStore.closeChat()
                UiStore.toast(t("chatDeletedToast"))
                UiStore.setMobileView("list")
            }
        })
    }
    UiStore.openMenu(300f, 120f, items)
}
