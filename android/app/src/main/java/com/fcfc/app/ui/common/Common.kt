package com.fcfc.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate

/** Liquid-glass card (lg-card): frosted body + soft border. */
@Composable
fun LgCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val theme = com.fcfc.app.stores.UiStore.theme.value
    val dark = theme == "dark"
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(30.dp))
            .background(
                Brush.verticalGradient(
                    if (dark) listOf(Color(0xF0101424), Color(0xD90E1220))
                    else listOf(Color(0xFAFFFFFF), Color(0xF2FFFFFF))
                )
            )
            .border(
                1.dp,
                Brush.linearGradient(
                    if (dark) listOf(Color(0x26FFFFFF), Color(0x0DFFFFFF), Color(0x1A7C5CFF))
                    else listOf(Color(0x66FFFFFF), Color(0x33FFFFFF), Color(0x407C5CFF))
                ),
                RoundedCornerShape(30.dp),
            )
            .padding(horizontal = 26.dp, vertical = 30.dp),
    ) { content() }
}

/** Liquid-glass input (lg-input). */
@Composable
fun LgInput(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "",
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailing: (@Composable () -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    fontSize: Int = 15,
) {
    val theme = com.fcfc.app.stores.UiStore.theme.value
    val dark = theme == "dark"
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (dark) Color(0x14FFFFFF) else Color(0x0F0F172A))
            .border(1.dp, if (dark) Color(0x1FFFFFFF) else Color(0x140F172A), RoundedCornerShape(16.dp))
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) { leading(); Spacer(Modifier.width(8.dp)) }
        Box(Modifier.weight(1f)) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = singleLine,
                visualTransformation = visualTransformation,
                textStyle = TextStyle(
                    fontSize = fontSize.sp,
                    color = if (dark) Color(0xFFF1F5F9) else Color(0xFF0F172A),
                ),
                cursorBrush = SolidColor(Color(0xFF3D6EF3)),
                decorationBox = { inner ->
                    if (value.isEmpty()) {
                        Box {
                            Text(placeholder, fontSize = fontSize.sp, color = Color(0x9994A3B8))
                            inner()
                        }
                    } else inner()
                },
            )
        }
        if (trailing != null) { Spacer(Modifier.width(8.dp)); trailing() }
    }
}

/** Primary gradient button (lg-btn). */
@Composable
fun LgPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: (@Composable () -> Unit)? = null,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(17.dp))
            .background(
                if (enabled) Brush.linearGradient(listOf(Color(0xFF7C5CFF), Color(0xFF6366F1), Color(0xFF8B5CF6)))
                else Brush.linearGradient(listOf(Color(0x337C5CFF), Color(0x336366F1)))
            )
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (content != null) content() else Text(text, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.5.sp)
    }
}

/** Ghost button (lg-btn-ghost). */
@Composable
fun LgGhostButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val theme = com.fcfc.app.stores.UiStore.theme.value
    val dark = theme == "dark"
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(17.dp))
            .background(if (dark) Color(0x14FFFFFF) else Color(0x0F0F172A))
            .border(1.dp, if (dark) Color(0x1FFFFFFF) else Color(0x140F172A), RoundedCornerShape(17.dp))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = if (enabled) (if (dark) Color(0xFFE2E8F0) else Color(0xFF334155)) else Color(0x6694A3B8),
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
        )
    }
}

/** Small spinner (web Spinner — rotating arc). */
@Composable
fun Spinner(sizeDp: Int = 28, color: Color = Color(0xFF3D6EF3)) {
    val transition = rememberInfiniteTransition(label = "spin")
    val angle by transition.animateFloat(
        initialValue = 0f, targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(700, easing = LinearEasing), RepeatMode.Restart),
        label = "angle",
    )
    Box(
        modifier = Modifier
            .size(sizeDp.dp)
            .drawBehind {
                rotate(angle) {
                    drawArc(
                        color = color,
                        startAngle = -90f, sweepAngle = 300f, useCenter = false,
                        style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round),
                    )
                }
            },
    )
}

/** Avatar with initials + online dot. key: avatar media key (resolved by caller). */
@Composable
fun Avatar(
    name: String,
    modifier: Modifier = Modifier,
    sizeDp: Int = 54,
    online: Boolean = false,
    avatarKey: String? = null,
    onClick: (() -> Unit)? = null,
) {
    val initials = name.trim().split(" ").take(2).mapNotNull { it.firstOrNull()?.uppercase() }
        .joinToString("").ifEmpty { "?" }
    val hue = (name.hashCode().mod(360))
    val bg = Color(0xFF3D6EF3) // brand fallback; per-name tint below
    val tint = Color(android.graphics.Color.HSVToColor(floatArrayOf(hue.toFloat(), 0.5f, 0.62f)))
    Box(
        modifier = modifier
            .size(sizeDp.dp)
            .clip(CircleShape)
            .background(if (avatarKey == null) tint else Color(0x22000000))
            .clickable(enabled = onClick != null, onClick = onClick ?: {}),
    ) {
        if (avatarKey != null) {
            com.fcfc.app.ui.common.MediaImage(
                url = com.fcfc.app.net.ApiClient.mediaUrl(avatarKey),
                modifier = Modifier.size(sizeDp.dp),
            )
        } else {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text(
                    initials,
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = (sizeDp * 0.36f).sp,
                )
            }
        }
        if (online) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .size((sizeDp * 0.24f).dp)
                    .clip(CircleShape)
                    .background(Color(0xFF30A46C))
                    .border(2.dp, Color(0xFFFFFFFF), CircleShape),
            )
        }
    }
}

/** Coil image with circle clip + fallback — placeholder until media layer lands. */
@Composable
fun MediaImage(url: String, modifier: Modifier = Modifier, contentDescription: String? = null) {
    if (url.isEmpty()) return
    coil.compose.AsyncImage(
        model = url,
        contentDescription = contentDescription,
        modifier = modifier.clip(CircleShape),
    )
}
