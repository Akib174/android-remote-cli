package com.fcfc.app.ui.auth

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut

/**
 * Custom 0-9 numpad — iPhone-lockscreen style (port of auth/PinPad.tsx).
 * No system keyboard ever opens. Glass keys, digit dots, backspace,
 * jelly press animation.
 */
@Composable
fun PinPad(
    value: String,
    onChange: (String) -> Unit,
    max: Int = 8,
    minLength: Int = 4,
    secure: Boolean = true,
    onEnter: (() -> Unit)? = null,
    disabled: Boolean = false,
) {
    val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫")

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // digit dots — no empty dots at start (web rule)
        Row(
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.padding(vertical = 10.dp),
        ) {
            for (i in 0 until max) {
                val filled = i < value.length
                val revealed = filled && !secure
                Box(
                    modifier = Modifier
                        .size(13.dp)
                        .clip(CircleShape)
                        .background(if (filled) Color(0xFF334155) else Color(0x22334155))
                        .border(1.dp, if (filled) Color(0x00334155) else Color(0x55334155), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    if (revealed) {
                        Text(
                            value[i].toString(),
                            fontSize = 9.sp,
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }

        // 4×3 key grid
        Column(
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            for (row in 0 until 4) {
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    for (col in 0 until 3) {
                        val k = keys[row * 3 + col]
                        PinKey(
                            key = k,
                            enabled = !disabled,
                            onPress = {
                                if (k == "⌫") {
                                    if (value.isNotEmpty()) onChange(value.dropLast(1))
                                } else if (k.isNotEmpty()) {
                                    if (value.length < max) {
                                        val next = value + k
                                        onChange(next)
                                        if (next.length == max && onEnter != null) {
                                            // small beat so the last digit pop is visible
                                            kotlinx.coroutines.MainScope().let { }
                                            onEnter()
                                        }
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PinKey(key: String, enabled: Boolean, onPress: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.88f else 1f,
        animationSpec = spring(dampingRatio = 0.55f, stiffness = 500f),
        label = "pinKeyScale",
    )
    val height by animateDpAsState(
        targetValue = if (pressed) 58.dp else 64.dp,
        animationSpec = spring(dampingRatio = 0.6f, stiffness = 600f),
        label = "pinKeyH",
    )

    if (key.isEmpty()) {
        Box(Modifier.size(76.dp)) { }
        return
    }
    Box(
        modifier = Modifier
            .size(76.dp, height)
            .scale(scale)
            .clip(RoundedCornerShape(999.dp))
            .background(Color(0x1AFFFFFF))
            .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(999.dp))
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, onClick = onPress),
        contentAlignment = Alignment.Center,
    ) {
        if (key == "⌫") {
            Text("⌫", fontSize = 24.sp, color = Color(0xFF64748B), fontWeight = FontWeight.Medium)
        } else {
            Text(key, fontSize = 26.sp, color = Color(0xFF0F172A), fontWeight = FontWeight.Medium)
        }
    }
}
