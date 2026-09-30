package com.fcfc.app.ui.modals

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fcfc.app.core.t
import com.fcfc.app.model.Message
import com.fcfc.app.model.MsgType
import com.fcfc.app.model.SendDraft
import com.fcfc.app.stores.AuthStore
import com.fcfc.app.stores.ChatsStore
import com.fcfc.app.stores.UiStore
import com.fcfc.app.theme.fcfcColors
import com.fcfc.app.ui.common.Avatar
import com.fcfc.app.ui.common.LgPrimaryButton
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonPrimitive

/**
 * Modal host — port of components/modals/Modals.tsx.
 * new-chat (dm + group), requests, contacts, device-approval, forward,
 * edit message, in-chat search, seen-by.
 */
@Composable
fun Modals() {
    val modal by UiStore.modal
    val m = modal ?: return
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0x88000000))
            .clickable { UiStore.closeModal() },
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .fillMaxWidth()
                .padding(20.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(colors.appShell)
                .border(1.dp, colors.glassBorder, RoundedCornerShape(24.dp))
                .heightIn(max = 560.dp)
                .clickable(enabled = false) { }
                .padding(20.dp),
        ) {
            when (m.type) {
                "new-chat" -> NewChatModal()
                "requests" -> RequestsModal()
                "contacts" -> ContactsModal()
                "device-approval" -> DeviceApprovalModal(m.props)
                "forward" -> ForwardModal(m.props)
                "edit" -> EditModal(m.props)
                "search" -> SearchModal(m.props)
                "seen-by" -> SeenByModal(m.props)
                else -> Text(m.type, color = colors.textPrimary)
            }
        }
    }
}

@Composable
private fun ModalTitle(text: String, onClose: () -> Unit = { UiStore.closeModal() }) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        Text(text, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = colors.textPrimary, modifier = Modifier.weight(1f))
        Text("✕", fontSize = 15.sp, color = colors.textMuted, modifier = Modifier
            .clip(CircleShape)
            .clickable(onClick = onClose)
            .padding(6.dp))
    }
}

@Composable
private fun UserSearchField(q: String, onQ: (String) -> Unit, placeholder: String) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0x0F0F172A))
            .padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("🔍", fontSize = 14.sp)
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f)) {
            if (q.isEmpty()) Text(placeholder, fontSize = 13.5.sp, color = colors.textMuted)
            BasicTextField(
                value = q, onValueChange = onQ, singleLine = true,
                textStyle = TextStyle(fontSize = 13.5.sp, color = colors.textPrimary),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun NewChatModal() {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf("dm") }    // dm | group | join
    var q by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<com.fcfc.app.model.User>>(emptyList()) }
    var groupName by remember { mutableStateOf("") }
    var groupDesc by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<List<String>>(emptyList()) }
    var joinCode by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(q) {
        if (q.trim().length < 2) { hits = emptyList(); return@LaunchedEffect }
        delay(250)
        hits = runCatching { ChatsStore.searchUsers(q.trim()) }.getOrDefault(emptyList())
    }

    Column {
        ModalTitle(t("newChatT"))
        // tabs
        Row(modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("dm" to t("dmChat"), "group" to t("newGroup"), "join" to t("orInvite")).forEach { (id, label) ->
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (tab == id) Color(0x1A3D6EF3) else Color(0x0F0F172A))
                        .clickable { tab = id }
                        .padding(vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(label, fontSize = 12.sp, fontWeight = if (tab == id) FontWeight.Bold else FontWeight.Normal, color = if (tab == id) colors.brand500 else colors.textSecondary) }
            }
        }
        when (tab) {
            "dm" -> {
                UserSearchField(q, { q = it }, t("searchUserPh"))
                LazyColumn(Modifier.heightIn(max = 300.dp).padding(top = 10.dp)) {
                    items(hits) { u ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .clickable {
                                    busy = true
                                    scope.launch {
                                        val chatId = ChatsStore.createDm(u.id)
                                        busy = false
                                        UiStore.closeModal()
                                        if (chatId != null) UiStore.setMobileView("chat") else UiStore.toast(t("reqSentShort"))
                                    }
                                }
                                .padding(horizontal = 8.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(name = u.name ?: u.username, sizeDp = 40, avatarKey = u.avatarKey)
                            Spacer(Modifier.width(10.dp))
                            Column {
                                Text(u.name ?: u.username, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = colors.textPrimary)
                                Text("@${u.username}", fontSize = 11.5.sp, color = colors.textMuted)
                            }
                        }
                    }
                }
            }
            "group" -> {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    FieldLabel(t("groupNamePh"))
                    LgInputLocal(groupName, { groupName = it })
                    FieldLabel(t("descOptional"))
                    LgInputLocal(groupDesc, { groupDesc = it })
                    UserSearchField(q, { q = it }, t("addMembersPh"))
                    hits.forEach { u ->
                        val picked = selected.contains(u.id)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (picked) Color(0x143D6EF3) else Color(0x00FFFFFF))
                                .clickable { selected = if (picked) selected - u.id else selected + u.id }
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(name = u.name ?: u.username, sizeDp = 34, avatarKey = u.avatarKey)
                            Spacer(Modifier.width(10.dp))
                            Text(u.name ?: u.username, fontSize = 13.5.sp, color = colors.textPrimary, modifier = Modifier.weight(1f))
                            Text(if (picked) "✓" else "", color = colors.brand500, fontWeight = FontWeight.Bold)
                        }
                    }
                    LgPrimaryButton(
                        text = "",
                        enabled = groupName.isNotBlank() && !busy,
                        onClick = {
                            busy = true
                            scope.launch {
                                val chatId = ChatsStore.createGroup(groupName.trim(), groupDesc.ifBlank { null }, selected)
                                busy = false
                                UiStore.closeModal()
                                if (chatId != null) { UiStore.setMobileView("chat") } else UiStore.toast(t("groupExistsToast"))
                            }
                        },
                    ) { Text("${t("createGroup")} (${selected.size})", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp) }
                }
            }
            "join" -> {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    FieldLabel(t("linkCodePh"))
                    LgInputLocal(joinCode, { joinCode = it })
                    LgPrimaryButton(
                        text = t("joinBtn"),
                        enabled = joinCode.isNotBlank() && !busy,
                        onClick = {
                            busy = true
                            scope.launch {
                                val chatId = ChatsStore.joinInvite(joinCode.trim())
                                busy = false
                                UiStore.closeModal()
                                if (chatId != null) UiStore.setMobileView("chat") else UiStore.toast(t("joinInvalid"))
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    Text(text, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = colors.textMuted)
}

@Composable
private fun LgInputLocal(value: String, onValue: (String) -> Unit) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0x0F0F172A))
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        BasicTextField(
            value = value, onValueChange = onValue, singleLine = true,
            textStyle = TextStyle(fontSize = 14.sp, color = colors.textPrimary),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun RequestsModal() {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val requests by ChatsStore.requests.collectAsState()
    val scope = rememberCoroutineScope()
    Column {
        ModalTitle(t("requestsT"))
        if (requests.isEmpty()) {
            Text(t("noRequests"), fontSize = 13.sp, color = colors.textMuted, modifier = Modifier.padding(vertical = 30.dp))
        }
        LazyColumn(Modifier.heightIn(max = 380.dp)) {
            items(requests) { r ->
                val from = r["from_user"]?.jsonPrimitive?.content ?: r["from"]?.jsonPrimitive?.content ?: ""
                val fromName = r["from_name"]?.jsonPrimitive?.content ?: from
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(name = fromName, sizeDp = 40)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(fromName, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = colors.textPrimary)
                        Text("message request", fontSize = 11.5.sp, color = colors.textMuted)
                    }
                    Text(
                        t("acceptBtn"), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.White,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFF10B981))
                            .clickable {
                                scope.launch {
                                    ChatsStore.respondRequest(r["id"]?.jsonPrimitive?.content ?: "", true)
                                    UiStore.closeModal()
                                }
                            }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        t("declineBtn"), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color(0xFFE5484D),
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0x1AE5484D))
                            .clickable {
                                scope.launch {
                                    ChatsStore.respondRequest(r["id"]?.jsonPrimitive?.content ?: "", false)
                                }
                            }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ContactsModal() {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    var q by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<com.fcfc.app.model.User>>(emptyList()) }
    LaunchedEffect(q) {
        if (q.trim().length < 2) { hits = emptyList(); return@LaunchedEffect }
        delay(250)
        hits = runCatching { ChatsStore.searchUsers(q.trim()) }.getOrDefault(emptyList())
    }
    Column {
        ModalTitle(t("contactsT"))
        UserSearchField(q, { q = it }, t("searchPh2"))
        if (q.length >= 2 && hits.isEmpty()) {
            Text(t("noContacts"), fontSize = 13.sp, color = colors.textMuted, modifier = Modifier.padding(vertical = 20.dp))
        }
        LazyColumn(Modifier.heightIn(max = 380.dp).padding(top = 10.dp)) {
            items(hits) { u ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable {
                            scope.launch {
                                val chatId = ChatsStore.createDm(u.id)
                                UiStore.closeModal()
                                if (chatId != null) UiStore.setMobileView("chat") else UiStore.toast(t("reqSentShort"))
                            }
                        }
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(name = u.name ?: u.username, sizeDp = 40, avatarKey = u.avatarKey)
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(u.name ?: u.username, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = colors.textPrimary)
                        Text("@${u.username}", fontSize = 11.5.sp, color = colors.textMuted)
                    }
                }
            }
        }
    }
}

@Composable
private fun DeviceApprovalModal(props: String?) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    val obj = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(props ?: "{}") as? kotlinx.serialization.json.JsonObject }.getOrNull()
    val deviceId = obj?.get("deviceId")?.jsonPrimitive?.content ?: ""
    val deviceName = obj?.get("deviceName")?.jsonPrimitive?.content ?: ""
    Column {
        ModalTitle(t("deviceApprovalT"))
        Text(t("deviceApprovalBody", "name" to deviceName), fontSize = 13.5.sp, color = colors.textPrimary, lineHeight = 19.sp)
        Text(t("deviceApprovalHint"), fontSize = 11.5.sp, color = colors.textMuted, lineHeight = 16.sp, modifier = Modifier.padding(top = 8.dp))
        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0x1A10B981))
                    .clickable {
                        UiStore.closeModal()
                        scope.launch { AuthStore.decideDevice(deviceId, true) }
                    }
                    .padding(vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) { Text(t("itWasMe"), fontSize = 13.5.sp, fontWeight = FontWeight.Bold, color = Color(0xFF059669)) }
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0x1AE5484D))
                    .clickable {
                        UiStore.closeModal()
                        scope.launch { AuthStore.decideDevice(deviceId, false) }
                    }
                    .padding(vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) { Text(t("declineLogout"), fontSize = 13.5.sp, fontWeight = FontWeight.Bold, color = Color(0xFFE5484D)) }
        }
    }
}

@Composable
private fun ForwardModal(props: String?) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    val chats by ChatsStore.chats.collectAsState()
    val msg = remember(props) {
        runCatching { Json.decodeFromString(Message.serializer(), props ?: "") }.getOrNull()
    }
    Column {
        ModalTitle(t("forwardT"))
        LazyColumn(Modifier.heightIn(max = 380.dp)) {
            items(chats.values.sortedByDescending { it.lastTs ?: 0 }.toList()) { c ->
                val title = when {
                    c.saved == true -> t("savedChatTitle")
                    c.kind == com.fcfc.app.model.ChatKind.GROUP -> c.title ?: ""
                    else -> c.peer?.name ?: c.peer?.username ?: ""
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable {
                            val m = msg ?: return@clickable
                            scope.launch {
                                ChatsStore.sendDraft(c.id, SendDraft(
                                    type = m.type, body = m.body, media = m.media,
                                    fwdFrom = m.senderId.take(20), ttl = null,
                                ))
                                UiStore.closeModal()
                                UiStore.toast(t("forwardedToast"))
                            }
                        }
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(name = title, sizeDp = 40, avatarKey = if (c.kind == com.fcfc.app.model.ChatKind.GROUP) c.photoKey else c.peer?.avatarKey)
                    Spacer(Modifier.width(10.dp))
                    Text(title, fontSize = 14.sp, color = colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun EditModal(props: String?) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    val msg = remember(props) { runCatching { Json.decodeFromString(Message.serializer(), props ?: "") }.getOrNull() }
    var text by remember(msg) { mutableStateOf(msg?.body ?: "") }
    Column {
        ModalTitle(t("editMsgT"))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(Color(0x0F0F172A))
                .padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            BasicTextField(
                value = text, onValueChange = { text = it },
                textStyle = TextStyle(fontSize = 14.5.sp, color = colors.textPrimary),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            com.fcfc.app.ui.common.LgGhostButton(text = t("cancel"), onClick = { UiStore.closeModal() }, modifier = Modifier.weight(1f))
            LgPrimaryButton(
                text = "",
                enabled = text.isNotBlank() && msg != null,
                onClick = {
                    val m = msg
                    if (m != null) scope.launch {
                        ChatsStore.editMessage(m.chatId, m.id, text.trim())
                        UiStore.closeModal()
                    }
                },
                modifier = Modifier.weight(1f),
            ) { Text(t("saveBtn"), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp) }
        }
    }
}

@Composable
private fun SearchModal(props: String?) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    var q by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Message>>(emptyList()) }
    val chatId = props
    LaunchedEffect(q) {
        if (q.trim().length < 2) { results = emptyList(); return@LaunchedEffect }
        delay(300)
        results = if (chatId != null) ChatsStore.localSearch(chatId, q.trim()) else ChatsStore.localSearch("", q.trim())
    }
    Column {
        ModalTitle(t("searchPh2"))
        UserSearchField(q, { q = it }, t("searchPh2"))
        LazyColumn(Modifier.heightIn(max = 380.dp).padding(top = 10.dp)) {
            items(results, key = { it.id }) { m ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable {
                            UiStore.closeModal()
                            scope.launch { ChatsStore.jumpToMessage(m.chatId, m.id) }
                        }
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                ) {
                    Text(m.body ?: "", fontSize = 13.5.sp, color = colors.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(m.chatId, fontSize = 10.5.sp, color = colors.textMuted)
                }
            }
        }
    }
}

@Composable
private fun SeenByModal(props: String?) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val seenBy by ChatsStore.seenBy.collectAsState()
    val chats by ChatsStore.chats.collectAsState()
    val msgId = remember(props) {
        runCatching { (kotlinx.serialization.json.Json.parseToJsonElement(props ?: "") as? kotlinx.serialization.json.JsonObject)?.get("msgId")?.jsonPrimitive?.content }.getOrNull()
    }
    val chatId = remember(props) {
        runCatching { (kotlinx.serialization.json.Json.parseToJsonElement(props ?: "") as? kotlinx.serialization.json.JsonObject)?.get("chatId")?.jsonPrimitive?.content }.getOrNull()
    }
    val chat = chatId?.let { chats[it] }
    val seen = msgId?.let { seenBy[it]?.get(chatId ?: "") } ?: emptyList()
    Column {
        ModalTitle(t("seenByT"))
        if (seen.isEmpty()) {
            Text(t("nobodySeen"), fontSize = 13.sp, color = colors.textMuted, modifier = Modifier.padding(vertical = 20.dp))
        }
        LazyColumn(Modifier.heightIn(max = 300.dp)) {
            items(seen) { uid ->
                val member = chat?.members?.firstOrNull { it.id == uid }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(name = member?.name ?: member?.username ?: uid, sizeDp = 34, avatarKey = member?.avatarKey)
                    Spacer(Modifier.width(10.dp))
                    Text(member?.name ?: member?.username ?: uid, fontSize = 13.5.sp, color = colors.textPrimary)
                }
            }
        }
    }
}
