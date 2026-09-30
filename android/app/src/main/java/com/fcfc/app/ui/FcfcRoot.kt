package com.fcfc.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fcfc.app.core.t
import com.fcfc.app.stores.ChatsStore
import com.fcfc.app.stores.UiStore
import com.fcfc.app.theme.fcfcColors
import com.fcfc.app.ui.chat.ChatWindow
import com.fcfc.app.ui.list.ChatList
import com.fcfc.app.ui.modals.Modals
import androidx.compose.foundation.layout.width
import com.fcfc.app.ui.settings.SettingsRoot
import kotlinx.coroutines.launch

/**
 * App shell root — port of App.tsx ready branch.
 * Mobile: list ⇄ chat two-view navigation. Tablet: sidebar + chat side by
 * side. Overlays: modals, context menu, toasts, call overlay, profile panel.
 */
@Composable
fun FcfcRoot() {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val activeChatId by ChatsStore.activeChatId.collectAsState()
    val mobileView by UiStore.mobileView
    val modal by UiStore.modal
    val menu by UiStore.menu
    val panel by UiStore.panel
    val toasts by UiStore.toasts
    val call by UiStore.call
    val scope = rememberCoroutineScope()
    val wide = LocalConfiguration.current.screenWidthDp >= 720

    // boot chats store once ready
    LaunchedEffect(Unit) {
        ChatsStore.boot()
    }

    Box(Modifier.fillMaxSize().background(colors.body)) {
        if (wide) {
            Row(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxHeight().width(380.dp)) {
                    if (panel != null) SettingsRoot() else ChatList(onOpenChat = { cid -> scope.launch { ChatsStore.openChat(cid) }; UiStore.setMobileView("chat") })
                }
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    if (activeChatId != null) ChatWindow(chatId = activeChatId!!, onBack = { ChatsStore.closeChat() })
                    else EmptyPane()
                }
            }
        } else {
            AnimatedContent(
                targetState = mobileView,
                transitionSpec = {
                    (fadeIn(tween(200)) + slideInHorizontally(tween(260)) { if (targetState == "chat") it / 3 else -it / 3 })
                        .togetherWith(fadeOut(tween(180)) + slideOutHorizontally(tween(220)) { if (initialState == "chat") it / 3 else -it / 3 })
                },
                label = "mobileNav",
            ) { view ->
                when (view) {
                    "chat" -> {
                        if (activeChatId != null) ChatWindow(chatId = activeChatId!!, onBack = { ChatsStore.closeChat() })
                        else ChatList(onOpenChat = { cid -> scope.launch { ChatsStore.openChat(cid) }; UiStore.setMobileView("chat") })
                    }
                    else -> {
                        if (panel != null) SettingsRoot() else ChatList(onOpenChat = { cid -> scope.launch { ChatsStore.openChat(cid) }; UiStore.setMobileView("chat") })
                    }
                }
            }
        }

        // toasts
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 90.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            toasts.take(3).forEach { toast ->
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xE60B0F1A))
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                ) { Text(toast.text, color = Color.White, fontSize = 13.sp) }
            }
        }

        // context menu overlay
        val menuState = menu
        if (menuState != null) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color(0x55000000))
                    .clickable { UiStore.closeMenu() },
            ) {
                ContextMenuCard(menuState, Modifier.align(Alignment.TopStart).padding(start = 24.dp, top = 140.dp))
            }
        }

        // modals
        Modals()

        // call overlay
        if (call != null) {
            com.fcfc.app.ui.calls.CallOverlay(call!!)
        }
    }
}

@Composable
private fun EmptyPane() {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(com.fcfc.app.theme.BrandGradient),
                contentAlignment = Alignment.Center,
            ) { Text("fc", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Black) }
            Spacer(Modifier.padding(8.dp))
            Text("🔒 ${t("e2eTagline")}", fontSize = 13.sp, color = colors.textMuted)
        }
    }
}

@Composable
private fun ContextMenuCard(menu: UiStore.MenuState, modifier: Modifier) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(if (UiStore.theme.value == "dark") Color(0xF5181A1E) else Color(0xFAFFFFFF))
            .padding(6.dp),
    ) {
        // reaction row
        menu.reactions?.let { re ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
            ) {
                re.emojis.forEach { em ->
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { re.onPick?.invoke(em); UiStore.closeMenu() },
                        contentAlignment = Alignment.Center,
                    ) { com.fcfc.app.emoji.EmojiImage(em, 24.dp) }
                }
            }
        }
        menu.items.forEach { item ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { UiStore.closeMenu(); item.onClick?.invoke() }
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    item.label,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (item.danger) Color(0xFFE5484D) else colors.textPrimary,
                )
            }
        }
    }
}

