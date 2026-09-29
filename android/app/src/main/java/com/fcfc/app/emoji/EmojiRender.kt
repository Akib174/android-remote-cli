package com.fcfc.app.emoji

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ErrorResult
import coil.request.ImageRequest
import androidx.compose.material3.Text

/**
 * Emoji rendering — port of Emoji/EmojiText/AnimatedEmoji components from
 * frontend/src/lib/emoji.tsx. Renders the SAME Apple artwork as the web app
 * (jsDelivr emoji-datasource-apple CDN images) with candidate fallback chain
 * and Telegram-animated webp overlay.
 */

/** One emoji as an image; on chain exhaustion falls back to native glyph at 85%. */
@Composable
fun Emoji(char: String, size: TextUnit, modifier: Modifier = Modifier, animated: Boolean = false) {
    val ctx = LocalContext.current
    val candidates = remember(char) { EmojiData.candidates(char) }
    var idx by remember(char) { mutableIntStateOf(0) }
    var useNative by remember(char) { androidx.compose.runtime.mutableStateOf(false) }
    val animUrl = if (animated) remember(char) { EmojiData.animEmojiUrl(char) } else null
    val sizePx = with(LocalDensity.current) { size.toPx().toInt() }

    if (animUrl != null) {
        AsyncImage(
            model = ImageRequest.Builder(ctx).data(animUrl).build(),
            contentDescription = char,
            contentScale = ContentScale.Fit,
            modifier = modifier.size(sizePx.dp),
        )
        return
    }
    if (useNative) {
        Text(text = char, fontSize = size * 0.85f, modifier = modifier)
        return
    }
    val url = "${EmojiData.CDN}/${EmojiData.APPLE_PX}/${candidates[idx]}.png"
    AsyncImage(
        model = ImageRequest.Builder(ctx).data(url).crossfade(false)
            .listener(object : coil.request.ImageRequest.Listener {
                override fun onError(request: ImageRequest, result: ErrorResult) {
                    if (idx + 1 < candidates.size) idx += 1 else useNative = true
                }
            })
            .build(),
        contentDescription = char,
        contentScale = ContentScale.Fit,
        modifier = modifier.size(sizePx.dp),
    )
}

/**
 * Text with every emoji rendered as Apple artwork — port of EmojiText.
 * Placeholder width/height = font size (web: inline-block, w/h = size).
 */
@Composable
fun EmojiText(
    text: String?,
    style: TextStyle,
    modifier: Modifier = Modifier,
    color: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
) {
    if (text == null) return
    val parts = remember(text) { EmojiData.splitEmoji(text) }
    val fontSize = style.fontSize.takeIf { it != androidx.compose.ui.unit.TextUnit.Unspecified } ?: 14.sp
    val inlineMap = HashMap<String, InlineTextContent>()
    var counter = 0
    val annotated: AnnotatedString = buildAnnotatedString {
        for (p in parts) {
            if (p.emoji != null) {
                val id = "e${counter++}"
                inlineMap[id] = InlineTextContent(
                    Placeholder(fontSize, fontSize, PlaceholderVerticalAlign.Center),
                ) {
                    Emoji(char = p.emoji!!, size = fontSize)
                }
                appendInlineContent(id, p.emoji)
            } else {
                append(p.text ?: "")
            }
        }
    }
    Text(
        text = annotated,
        modifier = modifier,
        style = style,
        color = color,
        maxLines = maxLines,
        overflow = overflow,
        inlineContent = inlineMap,
    )
}

/**
 * Single-emoji message — port of AnimatedEmoji:
 *  - animated webp available → loops (Telegram-style), remount on playSeq
 *  - else Apple artwork with the 580ms bounce once (scale 1.22→.92→1.07→1, rot -28→7)
 */
@Composable
fun AnimatedEmoji(
    char: String,
    sizeDp: Dp,
    modifier: Modifier = Modifier,
    clickable: Boolean = true,
    playSeq: Int = 0,
    onReplay: (() -> Unit)? = null,
) {
    val animUrl = remember(char) { EmojiData.animEmojiUrl(char) }
    val scale = remember(char) { Animatable(1f) }
    val rotation = remember(char) { Animatable(0f) }

    key(playSeq, char) {
        if (animUrl == null) {
            LaunchedEffect(char, playSeq) {
                scale.snapTo(0f)
                rotation.snapTo(-28f)
                scale.animateTo(1.22f, tween(200))
                scale.animateTo(0.92f, tween(130))
                scale.animateTo(1.07f, tween(120))
                scale.animateTo(1f, tween(130))
                rotation.animateTo(7f, tween(200))
                rotation.animateTo(0f, tween(380))
            }
        }
        val mod = if (clickable && onReplay != null) {
            modifier.clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { onReplay() }
        } else modifier

        Box(
            modifier = mod
                .graphicsLayer {
                    scaleX = scale.value; scaleY = scale.value
                    rotationZ = rotation.value
                }
                .size(sizeDp),
        ) {
            val sizeSp = with(LocalDensity.current) { sizeDp.toSp() }
            Emoji(char = char, size = sizeSp, animated = animUrl != null)
        }
    }
}

/** Plain emoji image at explicit dp size (pickers, reactions, menus). */
@Composable
fun EmojiImage(
    char: String,
    sizeDp: Dp,
    modifier: Modifier = Modifier,
    animated: Boolean = false,
) {
    val sizeSp = with(LocalDensity.current) { sizeDp.toSp() }
    Box(modifier) { Emoji(char = char, size = sizeSp, animated = animated) }
}
