package com.fcfc.app.ui.calls

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fcfc.app.core.t
import com.fcfc.app.model.CallUi
import com.fcfc.app.stores.ChatsStore
import com.fcfc.app.stores.UiStore
import com.fcfc.app.ui.list.chatTitleOf
import kotlinx.coroutines.launch

/**
 * Call overlay — port of components/calls/CallOverlay.tsx (core flows).
 * Cloudflare Calls SFU reached strictly through the Worker calls endpoints
 * proxy — the Android app never sees the Calls app credentials; the
 * Worker holds CALLS_APP_ID / CALLS_API_TOKEN server-side.
 *
 * States: ringing (incoming) → connecting → connected / ended.
 * Media: WebRTC audio (+video) via stream-webrtc-android, tracks
 * negotiated through /calls/session + /calls/negotiate + /calls/renegotiate.
 */
@Composable
fun CallOverlay(call: CallUi) {
    val chats by ChatsStore.chats.collectAsState()
    val chat = chats[call.chatId]
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf(if (call.incoming == true) "ringing" else "connecting") }
    var elapsed by remember { mutableStateOf(0L) }

    // session lifecycle via the Worker-proxied SFU
    val engine = remember { CallEngine() }
    LaunchedEffect(call.chatId, call.incoming, call.auto) {
        if (call.incoming == true) {
            // wait for user accept; ringing UI handles it
        } else {
            state = "connecting"
            val ok = runCatching { engine.start(call.chatId, call.mode) }.getOrDefault(false)
            state = if (ok) "connected" else "ended"
            if (!ok) UiStore.toast(t("callNotStarted"))
        }
    }
    LaunchedEffect(state) {
        while (state == "connected") {
            kotlinx.coroutines.delay(1000)
            elapsed += 1
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xF20B0F1A)),
    ) {
        // pulsing ring
        val transition = rememberInfiniteTransition(label = "pulse")
        val pulse by transition.animateFloat(
            initialValue = 0.85f, targetValue = 1.08f,
            animationSpec = infiniteRepeatable(tween(1200), RepeatMode.Reverse),
            label = "p",
        )

        Column(
            Modifier
                .align(Alignment.Center)
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .size(96.dp)
                    .alpha(pulse)
                    .clip(CircleShape)
                    .background(Color(0x263D6EF3))
                    .border(2.dp, Color(0x403D6EF3), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (chat != null) {
                    com.fcfc.app.ui.common.Avatar(
                        name = chatTitleOf(chat), sizeDp = 96,
                        avatarKey = if (chat.kind == com.fcfc.app.model.ChatKind.GROUP) chat.photoKey else chat.peer?.avatarKey,
                    )
                } else {
                    Text("📞", fontSize = 38.sp)
                }
            }
            Spacer(Modifier.height(16.dp))
            Text(
                chat?.let { chatTitleOf(it) } ?: "",
                fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color.White,
            )
            Spacer(Modifier.height(6.dp))
            val subtitle = when {
                state == "ringing" -> if (call.mode == "video") t("incomingVideoCall") else t("incomingCall")
                state == "connecting" -> t("callConnecting")
                state == "connected" -> formatElapsed(elapsed)
                else -> t("callEndedToast")
            }
            Text(subtitle, fontSize = 13.5.sp, color = Color(0xFF94A3B8))
            if (state == "connected" && call.mode == "video") {
                Spacer(Modifier.height(20.dp))
                Text("🎥 ${t("voiceCallTag")}", fontSize = 11.sp, color = Color(0x99FFFFFF), modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color(0x1AFFFFFF))
                    .padding(horizontal = 10.dp, vertical = 4.dp))
            }
        }

        // action buttons
        Row(
            Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 64.dp),
            horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            if (state == "ringing") {
                // decline
                CallActionBtn("✕", Color(0xFFE5484D)) {
                    scope.launch { engine.decline(call.chatId) }
                    UiStore.setCall(null)
                }
                // accept
                CallActionBtn("✓", Color(0xFF10B981)) {
                    scope.launch {
                        state = "connecting"
                        val ok = runCatching { engine.start(call.chatId, call.mode) }.getOrDefault(false)
                        state = if (ok) "connected" else "ended"
                    }
                }
            } else {
                CallActionBtn("🎤", Color(0x33FFFFFF)) {
                    scope.launch { engine.toggleMute() }
                }
                CallActionBtn("✕", Color(0xFFE5484D)) {
                    scope.launch { engine.end(call.chatId) }
                    UiStore.setCall(null)
                }
            }
        }
    }
}

private fun formatElapsed(s: Long): String = "%d:%02d".format(s / 60, s % 60)

@Composable
private fun CallActionBtn(icon: String, bg: Color, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(64.dp)
            .clip(CircleShape)
            .background(bg)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(icon, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold) }
}
