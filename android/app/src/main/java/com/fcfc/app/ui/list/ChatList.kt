package com.fcfc.app.ui.list

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fcfc.app.core.t
import com.fcfc.app.model.Chat
import com.fcfc.app.model.ChatKind
import com.fcfc.app.stores.AuthStore
import com.fcfc.app.stores.ChatsStore
import com.fcfc.app.stores.UiStore
import com.fcfc.app.ui.common.Avatar
import com.fcfc.app.ui.common.Spinner
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Chat list sidebar — port of components/chat/ChatList.tsx.
 * Glass burger menu, search with inline user hits, requests banner,
 * pinned-first sorted list, active row highlight.
 */
@Composable
fun ChatList(onOpenChat: (String) -> Unit) {
    val chats by ChatsStore.chats.collectAsState()
    val requests by ChatsStore.requests.collectAsState()
    val activeChatId by ChatsStore.activeChatId.collectAsState()
    val presence by ChatsStore.presence.collectAsState()
    val me by AuthStore.user.collectAsState()
    val scope = rememberCoroutineScope()

    var q by remember { mutableStateOf("") }
    var menuOpen by remember { mutableStateOf(false) }
    var moreOpen by remember { mutableStateOf(false) }
    var userHits by remember { mutableStateOf<List<com.fcfc.app.model.User>>(emptyList()) }
    var searchBusy by remember { mutableStateOf(false) }

    // user search debounce (web: 250ms)
    LaunchedEffect(q) {
        val needle = q.trim()
        if (needle.length < 2) { userHits = emptyList(); return@LaunchedEffect }
        searchBusy = true
        delay(250)
        userHits = runCatching { ChatsStore.searchUsers(needle) }.getOrDefault(emptyList())
        searchBusy = false
    }

    val sorted = remember(chats, q) {
        val needle = q.lowercase()
        chats.values
            .filter { it.archived != true }
            .filter {
                needle.isEmpty() ||
                    (it.title ?: "").lowercase().contains(needle) ||
                    (it.peer?.username ?: "").lowercase().contains(needle) ||
                    (it.peer?.name ?: "").lowercase().contains(needle)
            }
            .sortedWith(compareByDescending<Chat> { it.pinned == true }.thenByDescending { it.lastTs ?: 0 })
    }

    Box(Modifier.fillMaxSize().background(Color(0x00FFFFFF))) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            // header: burger + search + new chat
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                BurgerButton(open = menuOpen, onClick = { menuOpen = true })
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .height(46.dp)
                        .clip(RoundedCornerShape(23.dp))
                        .background(Color(0x14FFFFFF))
                        .border(1.dp, Color(0x1FFFFFFF), RoundedCornerShape(23.dp))
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("🔍", fontSize = 15.sp, color = Color(0xFF94A3B8))
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.weight(1f)) {
                        if (q.isEmpty()) {
                            Text(t("searchPh"), fontSize = 15.sp, color = Color(0x9994A3B8))
                        }
                        androidx.compose.foundation.text.BasicTextField(
                            value = q,
                            onValueChange = { q = it },
                            singleLine = true,
                            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 16.sp, color = Color(0xFF0F172A)),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (searchBusy) Spinner(14)
                }
                // new chat button
                Box(
                    modifier = Modifier
                        .size(46.dp)
                        .clip(RoundedCornerShape(23.dp))
                        .background(Color(0x14FFFFFF))
                        .border(1.dp, Color(0x1FFFFFFF), RoundedCornerShape(23.dp))
                        .clickable { UiStore.openModal("new-chat") },
                    contentAlignment = Alignment.Center,
                ) { Text("✏️", fontSize = 17.sp) }
            }

            // inline user hits
            AnimatedVisibility(visible = userHits.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color(0xFAFFFFFF))
                        .border(1.dp, Color(0x14000000), RoundedCornerShape(16.dp)),
                ) {
                    Text(
                        t("usersLabel").uppercase(),
                        fontSize = 10.5.sp, fontWeight = FontWeight.Bold, color = Color(0xFF94A3B8),
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                    userHits.take(6).forEach { u ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    q = ""; userHits = emptyList()
                                    scope.launch {
                                        val chatId = ChatsStore.createDm(u.id)
                                        if (chatId != null) onOpenChat(chatId)
                                        else UiStore.toast(t("reqSentShort"))
                                    }
                                }
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(name = u.name ?: u.username, sizeDp = 36, avatarKey = u.avatarKey)
                            Spacer(Modifier.width(10.dp))
                            Column {
                                Text(u.name ?: u.username, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF0F172A))
                                Text("@${u.username}", fontSize = 12.sp, color = Color(0xFF94A3B8))
                            }
                        }
                    }
                }
            }

            // list
            LazyColumn(Modifier.weight(1f)) {
                // message requests banner
                if (requests.isNotEmpty()) {
                    item {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 4.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0x143D6EF3))
                                .clickable { UiStore.openModal("requests") }
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("🕐", fontSize = 15.sp)
                            Spacer(Modifier.width(10.dp))
                            Text(t("msgRequests"), fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF274DE8))
                            Spacer(Modifier.weight(1f))
                            Text("${requests.size}", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFF274DE8))
                        }
                    }
                }
                if (sorted.isEmpty()) {
                    item {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(top = 60.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text("💬", fontSize = 36.sp)
                            Spacer(Modifier.height(8.dp))
                            Text(t("noChatsYet"), fontSize = 13.sp, color = Color(0xFF94A3B8), modifier = Modifier.padding(horizontal = 32.dp))
                        }
                    }
                }
                items(sorted, key = { it.id }) { chat ->
                    ChatItem(
                        chat = chat,
                        active = chat.id == activeChatId,
                        online = chat.kind == ChatKind.DM && chat.peer != null && (presence[chat.peer!!.id] ?: false),
                        onClick = { onOpenChat(chat.id) },
                        onLongClick = { UiStore.openMenu(40f, 200f, chatMenuItems(chat)) },
                    )
                }
                item { Spacer(Modifier.height(80.dp)) }
            }
        }

        // burger menu overlay
        AnimatedVisibility(visible = menuOpen, enter = fadeIn(), exit = fadeOut()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color(0x66000000))
                    .clickable { menuOpen = false; moreOpen = false },
            ) {
                BurgerMenu(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(start = 12.dp, top = 66.dp),
                    me = me,
                    moreOpen = moreOpen,
                    onToggleMore = { moreOpen = it },
                    onClose = { menuOpen = false },
                )
            }
        }
    }
}

private fun chatMenuItems(chat: Chat): List<UiStore.MenuItem> {
    val items = mutableListOf<UiStore.MenuItem>()
    items.add(UiStore.MenuItem(t("pinChat")) { scopeLaunch { ChatsStore.patchChatState(chat.id, mapOf("pinned" to kotlinx.serialization.json.JsonPrimitive(!(chat.pinned ?: false)))) } })
    items.add(UiStore.MenuItem(t("mute8")) { scopeLaunch { ChatsStore.patchChatState(chat.id, mapOf("mutedUntil" to kotlinx.serialization.json.JsonPrimitive(System.currentTimeMillis() + 8 * 3600_000))) } })
    items.add(UiStore.MenuItem(t("muteForever")) { scopeLaunch { ChatsStore.patchChatState(chat.id, mapOf("mutedUntil" to kotlinx.serialization.json.JsonPrimitive(1900000000000L))) } })
    if ((chat.mutedUntil ?: 0) > System.currentTimeMillis()) {
        items.add(UiStore.MenuItem(t("unmute")) { scopeLaunch { ChatsStore.patchChatState(chat.id, mapOf("mutedUntil" to kotlinx.serialization.json.JsonPrimitive(0L))) } })
    }
    items.add(UiStore.MenuItem(t("archive")) { scopeLaunch { ChatsStore.patchChatState(chat.id, mapOf("archived" to kotlinx.serialization.json.JsonPrimitive(true))) } })
    items.add(UiStore.MenuItem(t("deleteChatMe"), danger = true) {
        scopeLaunch {
            ChatsStore.patchChatState(chat.id, mapOf(
                "deleteForMe" to kotlinx.serialization.json.JsonPrimitive(true),
                "unread" to kotlinx.serialization.json.JsonPrimitive(0),
            ))
            UiStore.toast(t("chatDeleted"))
        }
    })
    return items
}

private fun scopeLaunch(block: suspend () -> Unit) {
    kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch { runCatching { block() } }
}

@Composable
private fun BurgerButton(open: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(46.dp)
            .clip(RoundedCornerShape(23.dp))
            .background(Color(0x14FFFFFF))
            .border(1.dp, Color(0x1FFFFFFF), RoundedCornerShape(23.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(4.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            for (i in 0 until 3) {
                Box(
                    Modifier
                        .width(18.dp)
                        .height(2.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF334155)),
                )
            }
        }
    }
}

@Composable
private fun BurgerMenu(
    modifier: Modifier,
    me: com.fcfc.app.model.User?,
    moreOpen: Boolean,
    onToggleMore: (Boolean) -> Unit,
    onClose: () -> Unit,
) {
    val theme = UiStore.theme.value
    val scope = rememberCoroutineScope()
    val dark = theme == "dark"
    Column(
        modifier = modifier
            .width(224.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(if (dark) Color(0xEE181A1E) else Color(0xFAFFFFFF))
            .border(1.dp, if (dark) Color(0x1FFFFFFF) else Color(0x14000000), RoundedCornerShape(24.dp))
            .padding(6.dp),
    ) {
        // account header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .clickable { onClose(); UiStore.setPanel(UiStore.Panel.SETTINGS) }
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(name = me?.name ?: me?.username ?: "?", sizeDp = 30, avatarKey = me?.avatarKey)
            Spacer(Modifier.width(10.dp))
            Text(me?.name ?: me?.username ?: "", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (dark) Color(0xFFF1F5F9) else Color(0xFF0F172A))
        }
        Spacer(Modifier.height(2.dp))
        MenuRow("👤", t("menuMyProfile")) { onClose(); UiStore.setPanel(UiStore.Panel.SETTINGS) }
        MenuRow("🔖", t("menuSaved")) {
            onClose()
            scope.launch { val id = ChatsStore.openSaved(); if (id.isNotEmpty()) UiStore.setMobileView("chat"); ChatsStore.openChat(id) }
        }
        MenuRow("👥", t("menuContacts")) { onClose(); UiStore.openModal("contacts") }
        MenuRow("⚙️", t("settings")) { onClose(); UiStore.setPanel(UiStore.Panel.SETTINGS) }
        MenuRow(if (moreOpen) "▾" else "▸", t("menuMore"), chev = true) { onToggleMore(!moreOpen) }
        AnimatedVisibility(visible = moreOpen) {
            Column {
                // night mode row with switch
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(18.dp))
                        .clickable { UiStore.toggleTheme() }
                        .padding(horizontal = 12.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(if (dark) "☀" else "🌙", fontSize = 15.sp)
                    Spacer(Modifier.width(10.dp))
                    Text(t("menuNightMode"), fontSize = 13.5.sp, color = if (dark) Color(0xFFE2E8F0) else Color(0xFF334155), modifier = Modifier.weight(1f))
                    Box(
                        modifier = Modifier
                            .width(36.dp)
                            .height(20.dp)
                            .clip(CircleShape)
                            .background(if (dark) Color(0xFF274DE8) else Color(0xFFCBD5E1))
                            .padding(2.dp),
                        contentAlignment = if (dark) Alignment.CenterEnd else Alignment.CenterStart,
                    ) {
                        Box(Modifier.size(16.dp).clip(CircleShape).background(Color.White))
                    }
                }
                MenuRow("🗄", t("archivedChats")) { onClose(); UiStore.setPanel(UiStore.Panel.ARCHIVED) }
                MenuRow("🚪", t("logoutRow"), danger = true) {
                    onClose()
                    scope.launch { AuthStore.logout() }
                }
            }
        }
    }
}

@Composable
private fun MenuRow(icon: String, label: String, danger: Boolean = false, chev: Boolean = false, onClick: () -> Unit) {
    val dark = UiStore.theme.value == "dark"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(icon, fontSize = 15.sp)
        Spacer(Modifier.width(10.dp))
        Text(
            label, fontSize = 13.5.sp,
            color = when {
                danger -> Color(0xFFE5484D)
                dark -> Color(0xFFE2E8F0)
                else -> Color(0xFF334155)
            },
        )
    }
}

fun chatTitleOf(chat: Chat): String = when {
    chat.saved == true -> t("savedChatTitle")
    chat.kind == ChatKind.GROUP -> chat.title ?: t("groupFallback")
    else -> chat.peer?.name?.takeIf { it.isNotBlank() } ?: chat.peer?.username ?: t("chatFallback")
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChatItem(
    chat: Chat,
    active: Boolean,
    online: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val typing = (chat.typing ?: emptyList()).isNotEmpty()
    val muted = (chat.mutedUntil ?: 0) > System.currentTimeMillis()
    val title = chatTitleOf(chat)
    val last = chat.lastPreview ?: ""

    val time = chat.lastTs?.let {
        if (System.currentTimeMillis() - it < 86400000L) SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(it))
        else SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(it))
    } ?: ""

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 1.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (active) Color(0xFF274DE8) else Color(0x00FFFFFF))
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(
            name = title, sizeDp = 54,
            online = !active && online,
            avatarKey = if (chat.kind == ChatKind.GROUP) chat.photoKey else chat.peer?.avatarKey,
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                    color = if (active) Color.White else Color(0xFF0F172A),
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                )
                if (chat.pinned == true) Text("📌", fontSize = 10.sp, modifier = Modifier.padding(start = 4.dp))
                if (muted) Text("🔕", fontSize = 10.sp, modifier = Modifier.padding(start = 2.dp))
                Spacer(Modifier.weight(1f))
                Text(time, fontSize = 11.5.sp, color = if (active) Color(0xCCFFFFFF) else Color(0xFF94A3B8))
            }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
                Text(
                    if (typing) t("typing") else last,
                    fontSize = 13.5.sp,
                    color = when {
                        typing && active -> Color.White
                        typing -> Color(0xFF3D6EF3)
                        active -> Color(0xD9FFFFFF)
                        else -> Color(0xFF94A3B8)
                    },
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (chat.unread > 0) {
                    Spacer(Modifier.weight(1f))
                    Box(
                        modifier = Modifier
                            .padding(start = 8.dp)
                            .height(21.dp)
                            .clip(CircleShape)
                            .background(
                                when {
                                    muted -> Color(0xFF94A3B8)
                                    active -> Color.White
                                    else -> Color(0xFF274DE8)
                                }
                            )
                            .padding(horizontal = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (chat.unread > 99) "99+" else chat.unread.toString(),
                            fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            color = if (active) Color(0xFF274DE8) else Color.White,
                        )
                    }
                }
            }
        }
    }
}

