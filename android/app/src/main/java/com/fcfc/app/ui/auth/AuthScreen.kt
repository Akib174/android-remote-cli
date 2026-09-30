package com.fcfc.app.ui.auth

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fcfc.app.core.I18n
import com.fcfc.app.core.t
import com.fcfc.app.net.ApiClient
import com.fcfc.app.stores.AuthStore
import com.fcfc.app.stores.UiStore
import com.fcfc.app.theme.Radii
import com.fcfc.app.ui.common.LgCard
import com.fcfc.app.ui.common.LgInput
import com.fcfc.app.ui.common.LgPrimaryButton
import com.fcfc.app.ui.common.LgGhostButton
import com.fcfc.app.ui.common.Spinner
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Auth screen — port of components/auth/AuthScreen.tsx.
 * Welcome → login (password | user-ID+passcode) / 10-step signup wizard.
 * Liquid-glass card, animated blur orbs, slide-step transitions.
 */
@Composable
fun AuthScreen() {
    var screen by remember { mutableStateOf("welcome") }   // welcome | login | signup
    val theme = UiStore.theme.value
    val scope = rememberCoroutineScope()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(if (theme == "dark") Color(0xFF0B0F1A) else Color(0xFFF1F5F9)),
    ) {
        // animated blur orbs (brand / violet / sky)
        AuthOrbs()

        // theme toggle — top right
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(16.dp)
                .size(44.dp)
                .clip(CircleShape)
                .background(Color(0x33FFFFFF))
                .border(1.dp, Color(0x40FFFFFF), CircleShape)
                .clickable { UiStore.toggleTheme() },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (theme == "dark") "☀" else "🌙",
                fontSize = 18.sp,
                color = if (theme == "dark") Color(0xFFE2E8F0) else Color(0xFF475569),
            )
        }

        // scrollable content
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            LgCard(Modifier.fillMaxWidth()) {
                BrandHeader()
                AnimatedContent(
                    targetState = screen,
                    transitionSpec = {
                        (fadeIn(tween(220)) + slideInHorizontally(tween(260)) { it / 3 })
                            .togetherWith(fadeOut(tween(180)) + slideOutHorizontally(tween(220)) { -it / 3 })
                    },
                    label = "authScreen",
                ) { s ->
                    when (s) {
                        "welcome" -> Welcome(
                            onLogin = { screen = "login" },
                            onSignup = { screen = "signup" },
                        )
                        "login" -> LoginView(onBack = { screen = "welcome" })
                        "signup" -> SignupWizard(onBack = { screen = "welcome" })
                    }
                }
            }
        }
    }
}

@Composable
private fun AuthOrbs() {
    val transition = rememberInfiniteTransition(label = "orbs")
    val x1 by transition.animateFloat(
        initialValue = -120f, targetValue = 80f,
        animationSpec = infiniteRepeatable(tween(18000), RepeatMode.Reverse), label = "x1")
    val y1 by transition.animateFloat(
        initialValue = -60f, targetValue = 100f,
        animationSpec = infiniteRepeatable(tween(18000), RepeatMode.Reverse), label = "y1")
    val x2 by transition.animateFloat(
        initialValue = 100f, targetValue = -90f,
        animationSpec = infiniteRepeatable(tween(22000), RepeatMode.Reverse), label = "x2")
    val y2 by transition.animateFloat(
        initialValue = 80f, targetValue = -80f,
        animationSpec = infiniteRepeatable(tween(22000), RepeatMode.Reverse), label = "y2")
    val x3 by transition.animateFloat(
        initialValue = -60f, targetValue = 120f,
        animationSpec = infiniteRepeatable(tween(26000), RepeatMode.Reverse), label = "x3")

    Box(Modifier.fillMaxSize()) {
        Box(Modifier
            .offset { IntOffset(x1.roundToInt(), y1.roundToInt()) }
            .size(340.dp)
            .clip(CircleShape)
            .background(Brush.radialGradient(listOf(Color(0x403D6EF3), Color(0x003D6EF3)))))
        Box(Modifier
            .offset { IntOffset((x2 + 40).roundToInt(), y2.roundToInt()) }
            .size(260.dp)
            .clip(CircleShape)
            .background(Brush.radialGradient(listOf(Color(0x337C3AED), Color(0x007C3AED)))))
        Box(Modifier
            .offset { IntOffset(x3.roundToInt(), (y2 / 2 + 140).roundToInt()) }
            .size(200.dp)
            .clip(CircleShape)
            .background(Brush.radialGradient(listOf(Color(0x2638BDF8), Color(0x0038BDF8)))))
    }
}

@Composable
private fun BrandHeader() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(bottom = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(64.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(Brush.linearGradient(listOf(Color(0xFF3D6EF3), Color(0xFF7C3AED))))
                .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(22.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text("fc", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.height(10.dp))
        Text(
            "fcfc",
            fontSize = 26.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = (-0.5).sp,
            color = Color(0xFF1E293B),
        )
        Spacer(Modifier.height(2.dp))
        Text(
            "🔒 ${t("e2eBadge")}",
            fontSize = 12.5.sp,
            color = Color(0xFF94A3B8),
        )
    }
}

@Composable
private fun Welcome(onLogin: () -> Unit, onSignup: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        LgPrimaryButton(text = t("loginBtn"), onClick = onLogin)
        LgGhostButton(text = "👤 ${t("signupBtn")}", onClick = onSignup)
        Spacer(Modifier.height(4.dp))
        Text(
            t("signupNote"),
            fontSize = 11.5.sp,
            color = Color(0xFF94A3B8),
            lineHeight = 16.sp,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun LoginView(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var method by remember { mutableStateOf("pass") }     // pass | pin
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPass by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var pinStage by remember { mutableStateOf("uid") }    // uid | passcode
    var uid by remember { mutableStateOf("") }
    var passcode by remember { mutableStateOf("") }

    Column {
        // back row
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 16.dp)) {
            Box(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(Color(0x14FFFFFF))
                    .clickable { onBack() }
                    .padding(10.dp),
            ) { Text("←", fontSize = 18.sp, color = Color(0xFF64748B)) }
            Spacer(Modifier.width(10.dp))
            Text(t("loginBtn"), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color(0xFF334155))
        }

        // method switch — gliding pill
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radii.lgNav))
                .background(Color(0x14000000))
                .padding(5.dp),
        ) {
            listOf("pass" to t("loginWithPass"), "pin" to t("loginWithPin")).forEach { (m, label) ->
                val on = method == m
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(Radii.lgNav - 2.dp))
                        .background(if (on) Color(0xFFFFFFFF) else Color(0x00FFFFFF))
                        .clickable { method = m; error = ""; pinStage = "uid" }
                        .padding(vertical = 9.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label,
                        fontSize = 12.5.sp,
                        fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                        color = if (on) Color(0xFF274DE8) else Color(0xFF64748B),
                    )
                }
            }
        }
        Spacer(Modifier.height(18.dp))

        AnimatedVisibility(visible = error.isNotEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0x1AF43F5E))
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            ) { Text(error, fontSize = 13.sp, color = Color(0xFFE5484D)) }
        }

        AnimatedContent(targetState = method, label = "loginMethod") { m ->
            if (m == "pass") {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Column {
                        Text(t("username").uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFF94A3B8), letterSpacing = 1.sp)
                        Spacer(Modifier.height(6.dp))
                        LgInput(
                            value = username,
                            onValueChange = { v -> username = v.filter { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '_' }.lowercase() },
                            placeholder = t("usernamePh"),
                        )
                    }
                    Column {
                        Text(t("password").uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFF94A3B8), letterSpacing = 1.sp)
                        Spacer(Modifier.height(6.dp))
                        LgInput(
                            value = password,
                            onValueChange = { password = it },
                            placeholder = t("passwordPh"),
                            visualTransformation = if (showPass) VisualTransformation.None else PasswordVisualTransformation(),
                            trailing = {
                                Text(
                                    if (showPass) "🙈" else "👁",
                                    modifier = Modifier
                                        .clickable { showPass = !showPass }
                                        .padding(6.dp),
                                    fontSize = 16.sp,
                                )
                            },
                        )
                    }
                    Spacer(Modifier.height(2.dp))
                    LgPrimaryButton(
                        text = "",
                        enabled = !busy && username.isNotEmpty() && password.isNotEmpty(),
                        onClick = {
                            busy = true; error = ""
                            scope.launch {
                                val err = AuthStore.login(username, password)
                                busy = false
                                if (err != null) error = err
                            }
                        },
                    ) {
                        if (busy) Spinner(18) else Text(t("loginBtn"), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.5.sp)
                    }
                }
            } else {
                Column {
                    AnimatedContent(targetState = pinStage, label = "pinStage") { stage ->
                        if (stage == "uid") {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(t("enterUserId"), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color(0xFF334155))
                                Text(t("userIdHint"), fontSize = 12.sp, color = Color(0xFF94A3B8), modifier = Modifier.padding(top = 2.dp, bottom = 8.dp))
                                PinPad(value = uid, onChange = { uid = it }, max = 12, minLength = 4, secure = false)
                                Spacer(Modifier.height(8.dp))
                                LgGhostButton(
                                    text = "${t("nextBtn")} →",
                                    enabled = uid.length >= 4,
                                    onClick = { pinStage = "passcode" },
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        } else {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(t("enterPasscode"), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color(0xFF334155))
                                Text(t("passcodeHintLogin"), fontSize = 12.sp, color = Color(0xFF94A3B8), modifier = Modifier.padding(top = 2.dp, bottom = 8.dp))
                                PinPad(
                                    value = passcode,
                                    onChange = { v ->
                                        passcode = v
                                        if (v.length == 8) {
                                            busy = true; error = ""
                                            scope.launch {
                                                val err = AuthStore.loginPin(uid, passcode)
                                                busy = false
                                                if (err != null) { error = err; passcode = "" }
                                            }
                                        }
                                    },
                                    max = 8, minLength = 6,
                                )
                                Spacer(Modifier.height(8.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                                    LgGhostButton(
                                        text = "← ${t("backBtn")}",
                                        onClick = { pinStage = "uid" },
                                        modifier = Modifier.weight(1f),
                                    )
                                    LgPrimaryButton(
                                        text = "",
                                        enabled = !busy && passcode.length >= 6,
                                        onClick = {
                                            busy = true; error = ""
                                            scope.launch {
                                                val err = AuthStore.loginPin(uid, passcode)
                                                busy = false
                                                if (err != null) { error = err; passcode = "" }
                                            }
                                        },
                                        modifier = Modifier.weight(1f),
                                    ) {
                                        if (busy) Spinner(18) else Text(t("loginBtn"), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.5.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
