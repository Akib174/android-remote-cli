package com.fcfc.app.ui.settings

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
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fcfc.app.core.I18n
import com.fcfc.app.core.t
import com.fcfc.app.stores.AuthStore
import com.fcfc.app.stores.ChatsStore
import com.fcfc.app.stores.UiStore
import com.fcfc.app.theme.fcfcColors
import com.fcfc.app.ui.common.Avatar
import com.fcfc.app.ui.common.LgInput
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Settings — port of components/settings/SettingsPanel.tsx (compact port):
 * profile, theme, language, privacy (DM permission / last seen), devices,
 * blocked users, starred, archived, account delete, logout.
 */
@Composable
fun SettingsRoot() {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val user by AuthStore.user.collectAsState()
    val settings by AuthStore.settings.collectAsState()
    val chats by ChatsStore.chats.collectAsState()
    val blockedIds by ChatsStore.blockedIds.collectAsState()
    val panel by UiStore.panel
    val scope = rememberCoroutineScope()

    var subPage by remember { mutableStateOf("main") }
    var about by remember(user) { mutableStateOf(user?.about ?: "") }
    var name by remember(user) { mutableStateOf(user?.name ?: "") }

    Column(
        Modifier
            .fillMaxSize()
            .background(colors.body)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        // header
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 16.dp)) {
            if (subPage != "main") {
                Text("←", fontSize = 20.sp, color = colors.textPrimary, modifier = Modifier
                    .clip(CircleShape)
                    .clickable { subPage = "main" }
                    .padding(6.dp))
                Spacer(Modifier.width(10.dp))
            }
            Text(if (subPage == "main") t("settings") else subPageTitle(subPage), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = colors.textPrimary)
        }

        if (subPage == "main") {
            // profile card
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(colors.appShell)
                    .padding(16.dp),
            ) {
                Avatar(name = user?.name ?: user?.username ?: "?", sizeDp = 64, avatarKey = user?.avatarKey)
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(user?.name ?: user?.username ?: "", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = colors.textPrimary)
                    Text("@${user?.username ?: ""}", fontSize = 12.5.sp, color = colors.textMuted)
                    if (!user?.userIdCode.isNullOrBlank()) Text("ID ${user?.userIdCode}", fontSize = 11.5.sp, color = colors.textMuted)
                }
            }

            // about editor
            SettingsSectionLabel(t("aboutBio"))
            LgInput(
                value = about,
                onValueChange = { about = it },
                placeholder = t("addAbout"),
                modifier = Modifier.padding(bottom = 16.dp),
                singleLine = false,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(bottom = 20.dp)) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(44.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors.brand600)
                        .clickable {
                            scope.launch { AuthStore.updateProfile(mapOf("about" to about)) }
                            UiStore.toast(t("savedToast"))
                        },
                    contentAlignment = Alignment.Center,
                ) { Text(t("saveBtn"), color = Color.White, fontWeight = FontWeight.Bold) }
            }

            // rows
            SettingsRow("👤", t("profileT")) { subPage = "profile" }
            SettingsRow("🔐", t("privacyT")) { subPage = "privacy" }
            SettingsRow("🔔", t("notificationsT")) { subPage = "notifications" }
            SettingsRow("💻", t("devicesT")) { subPage = "devices" }
            SettingsRow("🚫", t("blockedPanelT")) { subPage = "blocked" }
            SettingsRow("⭐", t("starredT")) { subPage = "starred" }
            SettingsRow("🎨", t("themePanelT")) { subPage = "theme" }
            SettingsRow("🌐", t("languageRow")) { subPage = "language" }
            SettingsRow("🗄", t("archivedT")) { subPage = "archived" }
            SettingsRow("🚪", t("logoutRow"), danger = true) {
                scope.launch { AuthStore.logout() }
            }
            SettingsRow("⚠️", t("deleteAccountRow"), danger = true) { subPage = "delete" }
            Text(
                t("e2eNote"),
                fontSize = 11.5.sp, color = colors.textMuted, lineHeight = 16.sp,
                modifier = Modifier.padding(16.dp),
            )
        } else {
            when (subPage) {
                "profile" -> ProfilePage(name, about, { name = it }, { about = it })
                "privacy" -> PrivacyPage(settings)
                "notifications" -> NotificationsPage(settings)
                "devices" -> DevicesPage()
                "blocked" -> BlockedPage(blockedIds, chats)
                "starred" -> StarredPage()
                "theme" -> ThemePage()
                "language" -> LanguagePage()
                "archived" -> ArchivedPage()
                "delete" -> DeletePage()
            }
        }
    }
}

private fun subPageTitle(page: String): String = when (page) {
    "profile" -> t("profileT"); "privacy" -> t("privacyT"); "notifications" -> t("notificationsT")
    "devices" -> t("devicesT"); "blocked" -> t("blockedPanelT"); "starred" -> t("starredT")
    "theme" -> t("themePanelT"); "language" -> t("languageRow"); "archived" -> t("archivedT")
    "delete" -> t("deleteAccountRow"); else -> page
}

@Composable
private fun SettingsSectionLabel(text: String) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = colors.textSecondary, modifier = Modifier.padding(bottom = 6.dp))
}

@Composable
private fun SettingsRow(icon: String, label: String, danger: Boolean = false, onClick: () -> Unit) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(colors.appShell)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(icon, fontSize = 16.sp)
        Spacer(Modifier.width(12.dp))
        Text(label, fontSize = 14.5.sp, fontWeight = FontWeight.Medium, color = if (danger) Color(0xFFE5484D) else colors.textPrimary, modifier = Modifier.weight(1f))
        Text("›", fontSize = 18.sp, color = colors.textMuted)
    }
}

@Composable
private fun ProfilePage(name: String, about: String, onName: (String) -> Unit, onAbout: (String) -> Unit) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SettingsSectionLabel(t("nameLabel"))
        LgInput(value = name, onValueChange = onName, placeholder = t("suNamePh"))
        Text(t("nameSub"), fontSize = 11.5.sp, color = colors.textMuted)
        SettingsSectionLabel(t("aboutBio"))
        LgInput(value = about, onValueChange = onAbout, placeholder = t("addAbout"), singleLine = false)
        Text(t("usernameFixed") + " — @${AuthStore.user.value?.username}", fontSize = 11.5.sp, color = colors.textMuted)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(44.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(colors.brand600)
                .clickable {
                    scope.launch { AuthStore.updateProfile(mapOf("name" to name, "about" to about)) }
                    UiStore.toast(t("savedToast"))
                },
            contentAlignment = Alignment.Center,
        ) { Text(t("saveBtn"), color = Color.White, fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun PrivacyPage(settings: kotlinx.serialization.json.JsonObject?) {
    val scope = rememberCoroutineScope()
    val privacyDm = settings?.get("privacyDm")?.jsonPrimitive?.content ?: "everyone"
    val lastSeenPriv = settings?.get("lastSeenPriv")?.jsonPrimitive?.content ?: "everyone"
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column {
            SettingsSectionLabel(t("whoCanDm"))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("everyone" to t("everyone"), "request" to t("requestOnly")).forEach { (id, label) ->
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (privacyDm == id) Color(0x1A3D6EF3) else Color(0x0F0F172A))
                            .clickable {
                                scope.launch { AuthStore.updateSettings(kotlinx.serialization.json.buildJsonObject { put("privacyDm", id) }) }
                            }
                            .padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(label, fontSize = 12.5.sp, fontWeight = if (privacyDm == id) FontWeight.Bold else FontWeight.Normal, color = if (privacyDm == id) com.fcfc.app.theme.fcfcColors(false).brand500 else Color(0xFF64748B)) }
                }
            }
            Text(t("whoCanDmHint"), fontSize = 11.5.sp, color = Color(0xFF94A3B8), modifier = Modifier.padding(top = 6.dp))
        }
        Column {
            SettingsSectionLabel(t("lastSeenWho"))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("everyone" to t("everyone"), "nobody" to t("nobody")).forEach { (id, label) ->
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (lastSeenPriv == id) Color(0x1A3D6EF3) else Color(0x0F0F172A))
                            .clickable {
                                scope.launch { AuthStore.updateSettings(kotlinx.serialization.json.buildJsonObject { put("lastSeenPriv", id) }) }
                            }
                            .padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(label, fontSize = 12.5.sp, fontWeight = if (lastSeenPriv == id) FontWeight.Bold else FontWeight.Normal, color = if (lastSeenPriv == id) com.fcfc.app.theme.fcfcColors(false).brand500 else Color(0xFF64748B)) }
                }
            }
        }
    }
}

@Composable
private fun NotificationsPage(settings: kotlinx.serialization.json.JsonObject?) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    val sound = settings?.get("sound")?.jsonPrimitive?.content != "false"
    Column {
        SettingsSectionLabel(t("soundRow"))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(colors.appShell)
                .clickable { scope.launch { AuthStore.updateSettings(kotlinx.serialization.json.buildJsonObject { put("sound", !sound) }) } }
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(t("soundRow"), fontSize = 14.5.sp, color = colors.textPrimary, modifier = Modifier.weight(1f))
            Box(
                Modifier
                    .width(36.dp)
                    .height(20.dp)
                    .clip(CircleShape)
                    .background(if (sound) colors.brand600 else Color(0xFFCBD5E1))
                    .padding(2.dp),
                contentAlignment = if (sound) Alignment.CenterEnd else Alignment.CenterStart,
            ) { Box(Modifier.size(16.dp).clip(CircleShape).background(Color.White)) }
        }
        Text(t("soundRowSub"), fontSize = 11.5.sp, color = colors.textMuted, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun DevicesPage() {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    var devices by remember { mutableStateOf<List<com.fcfc.app.model.DeviceInfo>>(emptyList()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        devices = runCatching { com.fcfc.app.net.ApiClient.myDevices() }.getOrDefault(emptyList())
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        devices.forEach { d ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.appShell)
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("💻", fontSize = 16.sp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(d.name, fontSize = 13.5.sp, fontWeight = FontWeight.Medium, color = colors.textPrimary)
                    Text(
                        if (d.approved > 0) t("lastActive") + " " + java.text.SimpleDateFormat("d MMM HH:mm", java.util.Locale.getDefault()).format(java.util.Date(d.lastActive))
                        else t("awaitingTag"),
                        fontSize = 11.5.sp, color = colors.textMuted,
                    )
                }
                if (d.approved > 0) {
                    Text("✕", color = Color(0xFFE5484D), modifier = Modifier
                        .clip(CircleShape)
                        .clickable {
                            scope.launch { runCatching { com.fcfc.app.net.ApiClient.api("/me/devices/${d.id}", "DELETE") } }
                            devices = devices.filter { it.id != d.id }
                        }
                        .padding(6.dp))
                }
            }
        }
    }
}

@Composable
private fun BlockedPage(blockedIds: Set<String>, chats: Map<String, com.fcfc.app.model.Chat>) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    if (blockedIds.isEmpty()) {
        Text(t("noBlocked"), fontSize = 13.sp, color = colors.textMuted)
        return
    }
    val blockedChats = chats.values.filter { it.peer != null && blockedIds.contains(it.peer!!.id) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        blockedChats.forEach { c ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.appShell)
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(name = c.peer?.name ?: c.peer?.username ?: "", sizeDp = 38, avatarKey = c.peer?.avatarKey)
                Spacer(Modifier.width(10.dp))
                Text(c.peer?.username ?: "", fontSize = 14.sp, color = colors.textPrimary, modifier = Modifier.weight(1f))
                Text(t("unblock"), fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = colors.brand500, modifier = Modifier
                    .clickable { scope.launch { ChatsStore.unblock(c.peer!!.id) } }
                    .padding(6.dp))
            }
        }
    }
}

@Composable
private fun StarredPage() {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    var starred by remember { mutableStateOf<List<Pair<com.fcfc.app.model.Chat, com.fcfc.app.model.Message>>>(emptyList()) }
    LaunchedEffect(Unit) { starred = runCatching { ChatsStore.starredList() }.getOrDefault(emptyList()) }
    if (starred.isEmpty()) {
        Column(Modifier.padding(vertical = 30.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("⭐", fontSize = 30.sp)
            Text(t("noStarred"), fontSize = 13.sp, color = colors.textMuted)
        }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        starred.forEach { (c, m) ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.appShell)
                    .padding(14.dp),
            ) {
                Text(com.fcfc.app.ui.list.chatTitleOf(c), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = colors.brand500)
                Text(m.body ?: "(${m.type.wire})", fontSize = 13.5.sp, color = colors.textPrimary)
            }
        }
    }
}

@Composable
private fun ThemePage() {
    val theme = UiStore.theme.value
    val colors = fcfcColors(theme == "dark")
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        listOf("light" to t("lightTheme"), "dark" to t("darkTheme")).forEach { (id, label) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (theme == id) Color(0x1A3D6EF3) else colors.appShell)
                    .clickable { UiStore.setTheme(id) }
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (id == "dark") "🌙" else "☀", fontSize = 16.sp)
                Spacer(Modifier.width(12.dp))
                Text(label, fontSize = 14.5.sp, color = colors.textPrimary, modifier = Modifier.weight(1f))
                if (theme == id) Text("✓", color = colors.brand500, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun LanguagePage() {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val lang = I18n.lang.collectAsState().value
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        listOf("en" to t("english"), "bn" to t("bangla")).forEach { (id, label) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (lang == id) Color(0x1A3D6EF3) else colors.appShell)
                    .clickable { I18n.setLang(id, ctx) }
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (id == "en") "🇬🇧" else "🇧🇩", fontSize = 16.sp)
                Spacer(Modifier.width(12.dp))
                Text(label, fontSize = 14.5.sp, color = colors.textPrimary, modifier = Modifier.weight(1f))
                if (lang == id) Text("✓", color = colors.brand500, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun ArchivedPage() {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val chats by ChatsStore.chats.collectAsState()
    val scope = rememberCoroutineScope()
    val archived = chats.values.filter { it.archived == true }
    if (archived.isEmpty()) {
        Text(t("noArchived"), fontSize = 13.sp, color = colors.textMuted)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        archived.forEach { c ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.appShell)
                    .clickable { scope.launch { ChatsStore.patchChatState(c.id, mapOf("archived" to kotlinx.serialization.json.JsonPrimitive(false))) } }
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(name = com.fcfc.app.ui.list.chatTitleOf(c), sizeDp = 38, avatarKey = if (c.kind == com.fcfc.app.model.ChatKind.GROUP) c.photoKey else c.peer?.avatarKey)
                Spacer(Modifier.width(10.dp))
                Text(com.fcfc.app.ui.list.chatTitleOf(c), fontSize = 14.sp, color = colors.textPrimary, modifier = Modifier.weight(1f))
                Text(t("unarchive"), fontSize = 12.sp, color = colors.brand500)
            }
        }
    }
}

@Composable
private fun DeletePage() {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    var pass by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(t("deleteWarn"), fontSize = 12.5.sp, lineHeight = 17.sp, color = Color(0xFFB45309))
        LgInput(
            value = pass, onValueChange = { pass = it },
            placeholder = t("confirmPassPh"),
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
        )
        if (error != null) Text(error!!, fontSize = 12.5.sp, color = Color(0xFFE5484D))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(46.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Color(0xFFE5484D))
                .clickable {
                    if (pass.isEmpty()) { error = t("confirmPassPh"); return@clickable }
                    scope.launch {
                        val err = AuthStore.deleteAccount(pass)
                        if (err != null) error = err
                        else { UiStore.setPanel(null); UiStore.setMobileView("list") }
                    }
                },
            contentAlignment = Alignment.Center,
        ) { Text(t("permDelete"), color = Color.White, fontWeight = FontWeight.Bold) }
    }
}
