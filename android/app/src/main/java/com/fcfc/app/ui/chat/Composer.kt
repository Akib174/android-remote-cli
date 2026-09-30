package com.fcfc.app.ui.chat

import android.media.MediaRecorder
import android.os.Build
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fcfc.app.core.t
import com.fcfc.app.emoji.EmojiData
import com.fcfc.app.emoji.EmojiImage
import com.fcfc.app.media.Media
import com.fcfc.app.model.Chat
import com.fcfc.app.model.MediaMeta
import com.fcfc.app.model.MsgType
import com.fcfc.app.model.SendDraft
import com.fcfc.app.stores.AuthStore
import com.fcfc.app.stores.ChatsStore
import com.fcfc.app.stores.UiStore
import com.fcfc.app.theme.fcfcColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

/**
 * Composer — port of components/chat/Composer.tsx.
 * Reply bar, attach menu (photo/video/file), emoji picker (recent +
 * categories), like button (long-press picker), send, voice recording with
 * red (auto-play) / blue (normal) modes, throttled typing events.
 */
@Composable
fun Composer(chat: Chat) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val replyingTo by ChatsStore.replyingTo.collectAsState()
    val me by AuthStore.user.collectAsState()

    var text by remember { mutableStateOf("") }
    var pop by remember { mutableStateOf<String?>(null) }          // emoji|sticker|attach|null
    var uploading by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    var voiceMode by remember { mutableStateOf("red") }            // red | blue
    var likePicker by remember { mutableStateOf(false) }
    val likeEmoji = chat.likeEmoji ?: "👍"

    // typing events (throttled like web: on=150ms debounce, off=2.2s)
    var typingJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    fun typingPing() {
        typingJob?.cancel()
        typingJob = scope.launch {
            delay(150); ChatsStore.setTyping(true)
            delay(2200); ChatsStore.setTyping(false)
        }
    }
    DisposableEffect(Unit) {
        onDispose { ChatsStore.setTyping(false) }
    }

    fun send() {
        val body = text.trim()
        if (body.isEmpty()) return
        text = ""
        typingJob?.cancel()
        scope.launch {
            ChatsStore.setTyping(false)
            ChatsStore.sendDraft(chat.id, SendDraft(
                type = MsgType.TEXT, body = body,
                replyTo = replyingTo?.let {
                    com.fcfc.app.model.ReplyRef(it.id, (it.body ?: "(${it.type.wire})").take(120), it.senderId)
                },
                ttl = chat.ttl,
            ))
        }
    }

    fun sendLike() {
        scope.launch {
            ChatsStore.sendDraft(chat.id, SendDraft(type = MsgType.TEXT, body = likeEmoji, ttl = chat.ttl))
        }
    }

    val pickMedia = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri != null) {
            uploading = true
            scope.launch {
                try {
                    val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw IllegalStateException("unreadable")
                    val name = uri.lastPathSegment ?: "file"
                    val mime = ctx.contentResolver.getType(uri) ?: "application/octet-stream"
                    val type = when {
                        mime.startsWith("image/gif") -> MsgType.GIF
                        mime.startsWith("image/") -> MsgType.IMAGE
                        mime.startsWith("video/") -> MsgType.VIDEO
                        else -> MsgType.FILE
                    }
                    val meta = Media.uploadEncrypted(bytes, name, mime)
                    ChatsStore.sendDraft(chat.id, SendDraft(type = type, media = meta, ttl = chat.ttl))
                } catch (e: Exception) {
                    UiStore.toast(t("uploadFailed", "msg" to (e.message ?: "")))
                } finally { uploading = false }
            }
        }
    }

    // voice recorder
    var recorder by remember { mutableStateOf<MediaRecorder?>(null) }
    var recordFile by remember { mutableStateOf<File?>(null) }
    var recordStart by remember { mutableStateOf(0L) }

    fun startRecording(mode: String) {
        try {
            voiceMode = mode
            val f = File(ctx.cacheDir, "voice_${System.currentTimeMillis()}.m4a")
            val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioEncodingBitRate(64_000)
            r.setAudioSamplingRate(44_100)
            r.setOutputFile(f.absolutePath)
            r.prepare()
            r.start()
            recorder = r
            recordFile = f
            recordStart = System.currentTimeMillis()
            recording = true
        } catch (_: Exception) {
            UiStore.toast(t("micDenied"))
        }
    }

    fun finishRecording(keep: Boolean) {
        val r = recorder ?: return
        val dur = System.currentTimeMillis() - recordStart
        try { r.stop() } catch (_: Exception) { }
        try { r.release() } catch (_: Exception) { }
        recorder = null
        recording = false
        val f = recordFile
        recordFile = null
        if (keep && f != null && dur > 400) {
            uploading = true
            scope.launch {
                try {
                    val bytes = f.readBytes()
                    val meta = Media.uploadEncrypted(bytes, "voice.m4a", "audio/mp4")
                    val withMeta = meta.copy(dur = (dur / 1000.0))
                    ChatsStore.sendDraft(chat.id, SendDraft(
                        type = MsgType.VOICE, media = withMeta, ttl = chat.ttl,
                        autoPlay = voiceMode == "red",
                    ))
                } catch (e: Exception) {
                    UiStore.toast(t("uploadFailed", "msg" to (e.message ?: "")))
                } finally {
                    uploading = false
                    f.delete()
                }
            }
        } else f?.delete()
    }

    Column(
        Modifier
            .fillMaxWidth()
            .imePadding()
            .navigationBarsPadding(),
    ) {
        // reply preview bar
        AnimatedVisibility(visible = replyingTo != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 2.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(colors.glass)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.width(3.dp).height(26.dp).clip(RoundedCornerShape(2.dp)).background(colors.brand500))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(replyingTo?.senderId ?: "", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = colors.brand500)
                    Text(replyingTo?.body ?: "", fontSize = 12.sp, color = colors.textSecondary, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
                Text("✕", fontSize = 14.sp, color = colors.textMuted, modifier = Modifier
                    .clickable { ChatsStore.setReplying(null) }
                    .padding(6.dp))
            }
        }

        // emoji picker sheet
        AnimatedVisibility(visible = pop == "emoji" || pop == "sticker") {
            EmojiPickerSheet(sticker = pop == "sticker") { em ->
                if (pop == "sticker") {
                    scope.launch { ChatsStore.sendDraft(chat.id, SendDraft(type = MsgType.STICKER, body = em, ttl = chat.ttl)) }
                    pop = null
                } else {
                    text += em
                    typingPing()
                }
            }
        }

        // like emoji picker
        AnimatedVisibility(visible = likePicker) {
            LikePickerSheet { em ->
                likePicker = false
                scope.launch {
                    ChatsStore.patchChatState(chat.id, mapOf("likeEmoji" to kotlinx.serialization.json.JsonPrimitive(em)))
                    UiStore.toast(t("likeUpdatedToast"))
                }
            }
        }

        // recording UI replaces input row
        if (recording) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp)
                    .height(52.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(if (voiceMode == "red") Color(0x26E5484D) else Color(0x143D6EF3))
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("🔴", fontSize = 12.sp)
                Spacer(Modifier.width(8.dp))
                Text(
                    if (voiceMode == "red") t("recordingAuto") else t("recording"),
                    fontSize = 13.sp, color = colors.textPrimary, modifier = Modifier.weight(1f),
                )
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF274DE8))
                        .clickable { finishRecording(true) }
                        .padding(horizontal = 16.dp, vertical = 7.dp),
                ) { Text(t("sendBtn"), fontSize = 13.sp, color = Color.White, fontWeight = FontWeight.Medium) }
                Spacer(Modifier.width(8.dp))
                Text("✕", color = colors.textMuted, modifier = Modifier
                    .clickable { finishRecording(false) }
                    .padding(6.dp))
            }
        } else {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                // attach + emoji toggle
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(if (pop == "attach") Color(0x1A3D6EF3) else colors.glass)
                                .clickable { pop = if (pop == "attach") null else "attach" },
                            contentAlignment = Alignment.Center,
                        ) { Text("📎", fontSize = 17.sp) }
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(if (pop == "emoji") Color(0x1A3D6EF3) else colors.glass)
                                .clickable { pop = if (pop == "emoji") null else "emoji" },
                            contentAlignment = Alignment.Center,
                        ) { Text("😊", fontSize = 17.sp) }
                    }
                    // attach menu
                    AnimatedVisibility(visible = pop == "attach") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                            AttachChip(t("photo")) { pickMedia.launch("image/*"); pop = null }
                            AttachChip(t("video")) { pickMedia.launch("video/*"); pop = null }
                            AttachChip(t("file2gb")) { pickMedia.launch("*/*"); pop = null }
                            AttachChip(t("stickers")) { pop = "sticker" }
                        }
                    }
                }

                // text input
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 42.dp, max = 120.dp)
                        .clip(RoundedCornerShape(22.dp))
                        .background(colors.glass)
                        .border(1.dp, colors.glassBorder, RoundedCornerShape(22.dp))
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    Column {
                        if (uploading) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                com.fcfc.app.ui.common.Spinner(14)
                                Text("…", fontSize = 14.sp, color = colors.textMuted)
                            }
                        } else if (text.isEmpty()) {
                            Text(t("writeMessage"), fontSize = 14.5.sp, color = colors.textMuted)
                        }
                        androidx.compose.foundation.text.BasicTextField(
                            value = text,
                            onValueChange = { text = it; typingPing() },
                            textStyle = TextStyle(fontSize = 14.5.sp, color = colors.textPrimary),
                            cursorBrush = SolidColor(colors.brand500),
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 20.dp, max = 96.dp)
                                .verticalScroll(rememberScrollState()),
                        )
                    }
                }

                // send / like / mic
                if (text.isNotEmpty()) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(colors.brand600)
                            .clickable { send() },
                        contentAlignment = Alignment.Center,
                    ) { Text("➤", color = Color.White, fontSize = 16.sp) }
                } else {
                    // like button — long-press to change emoji
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(colors.glass)
                            .combinedClickableLike(
                                onClick = { sendLike() },
                                onLongClick = { likePicker = true },
                            ),
                        contentAlignment = Alignment.Center,
                    ) { EmojiImage(likeEmoji, 22.dp) }
                    // mic — long-press for red mode
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(colors.glass)
                            .combinedClickableLike(
                                onClick = { startRecording("blue") },
                                onLongClick = { startRecording("red") },
                            ),
                        contentAlignment = Alignment.Center,
                    ) { Text("🎤", fontSize = 17.sp) }
                }
            }
        }
    }
}

private fun Brush_send(colors: com.fcfc.app.theme.FcColors): Color = colors.brand600

@Composable
private fun AttachChip(label: String, onClick: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(com.fcfc.app.theme.fcfcColors(UiStore.theme.value == "dark").glass)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(label, fontSize = 10.5.sp, color = com.fcfc.app.theme.fcfcColors(UiStore.theme.value == "dark").textPrimary, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun EmojiPickerSheet(sticker: Boolean, onPick: (String) -> Unit) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    var category by remember { mutableStateOf(0) }
    val cats = EmojiData.categories
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .height(240.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(colors.appShell)
            .border(1.dp, colors.glassBorder, RoundedCornerShape(16.dp))
            .padding(8.dp),
    ) {
        // category tabs
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
        ) {
            cats.forEachIndexed { i, (label, _) ->
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (i == category) Color(0x1A3D6EF3) else Color(0x00FFFFFF))
                        .clickable { category = i }
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                ) { Text(label, fontSize = 11.sp, fontWeight = if (i == category) FontWeight.Bold else FontWeight.Normal, color = colors.textSecondary) }
            }
        }
        val emojiList = if (sticker) EmojiData.allEmojis().take(120) else cats.getOrNull(category)?.second ?: emptyList()
        LazyVerticalGrid(
            columns = GridCells.Fixed(8),
            modifier = Modifier.weight(1f),
        ) {
            items(emojiList) { em ->
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clickable { onPick(em) },
                    contentAlignment = Alignment.Center,
                ) { EmojiImage(em, 26.dp) }
            }
        }
    }
}

@Composable
private fun LikePickerSheet(onPick: (String) -> Unit) {
    val colors = fcfcColors(UiStore.theme.value == "dark")
    val options = listOf("👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "🥰", "👏", "💯", "🤩", "😎")
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(colors.appShell)
            .border(1.dp, colors.glassBorder, RoundedCornerShape(16.dp))
            .padding(12.dp),
    ) {
        Text(t("likePickTitle"), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = colors.textSecondary)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            options.take(6).forEach { em ->
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(Color(0x0F0F172A))
                        .clickable { onPick(em) },
                    contentAlignment = Alignment.Center,
                ) { EmojiImage(em, 24.dp) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            options.drop(6).forEach { em ->
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(Color(0x0F0F172A))
                        .clickable { onPick(em) },
                    contentAlignment = Alignment.Center,
                ) { EmojiImage(em, 24.dp) }
            }
        }
    }
}

// long-press-capable clickable wrapper
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableLike(onClick: () -> Unit, onLongClick: () -> Unit): Modifier =
    this.combinedClickable(onClick = onClick, onLongClick = onLongClick)
