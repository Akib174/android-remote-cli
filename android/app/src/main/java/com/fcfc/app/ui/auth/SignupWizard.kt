package com.fcfc.app.ui.auth

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fcfc.app.core.t
import com.fcfc.app.stores.AuthStore
import com.fcfc.app.ui.common.LgGhostButton
import com.fcfc.app.ui.common.LgInput
import com.fcfc.app.ui.common.LgPrimaryButton
import com.fcfc.app.ui.common.Spinner
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Signup wizard — 10 steps (name → username → phone → email → password →
 * confirm → user-ID → passcode → passcode-confirm → finish), port of the
 * AuthScreen.tsx SignupWizard with availability checks + progress dots.
 */
@Composable
fun SignupWizard(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf(0) }
    var dir by remember { mutableStateOf(1) }

    var name by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var password2 by remember { mutableStateOf("") }
    var showPass by remember { mutableStateOf(false) }
    var uidCode by remember { mutableStateOf("") }
    var passcode by remember { mutableStateOf("") }
    var passcode2 by remember { mutableStateOf("") }
    var understood by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    var nameStatus by remember { mutableStateOf("idle") }    // idle|checking|ok|taken|invalid
    var uidStatus by remember { mutableStateOf("idle") }     // idle|checking|ok|taken

    // username availability (450ms debounce — web parity)
    LaunchedEffect(username) {
        val u = username.lowercase()
        if (!Regex("^[a-z0-9_]{3,24}$").matches(u)) {
            nameStatus = if (u.isNotEmpty()) "invalid" else "idle"
            return@LaunchedEffect
        }
        nameStatus = "checking"
        delay(450)
        val res = com.fcfc.app.net.ApiClient.api("/auth/check?username=$u", noAuth = true)
        nameStatus = if (res?.get("ok")?.toString() == "true") "ok" else "taken"
    }

    // uid availability (only on uid step)
    LaunchedEffect(uidCode, step) {
        if (step != 6) return@LaunchedEffect
        if (uidCode.length < 4) { uidStatus = "idle"; return@LaunchedEffect }
        uidStatus = "checking"
        delay(400)
        val res = com.fcfc.app.net.ApiClient.api("/auth/check?uidcode=$uidCode", noAuth = true)
        uidStatus = if (res?.get("ok")?.toString() == "true") "ok" else "taken"
    }

    val phoneValid = phone.isEmpty() || Regex("^\\+?[0-9][0-9\\s-]{5,19}$").matches(phone)
    val emailValid = email.isEmpty() || Regex("^[^\\s@]{1,64}@[^\\s@]{1,190}\\.[a-zA-Z]{2,24}$").matches(email)
    val mismatch = step == 5 && password2.isNotEmpty() && password != password2
    val passcodeMismatch = step == 8 && passcode2.isNotEmpty() && passcode != passcode2

    fun stepValid(): Boolean = when (step) {
        0 -> name.trim().isNotEmpty()
        1 -> Regex("^[a-z0-9_]{3,24}$").matches(username) && nameStatus != "taken" && nameStatus != "invalid"
        2 -> phoneValid
        3 -> emailValid
        4 -> password.length >= 8
        5 -> password == password2 && password2.isNotEmpty()
        6 -> uidCode.length >= 4 && uidStatus != "taken"
        7 -> passcode.length in 6..8
        8 -> passcode == passcode2
        9 -> understood
        else -> false
    }

    fun go(next: Int) {
        error = ""
        dir = if (next > step) 1 else -1
        if (next == 5) password2 = ""
        if (next == 8) passcode2 = ""
        step = next
    }

    fun finish() {
        if (busy || !stepValid()) return
        busy = true; error = ""
        scope.launch {
            val err = AuthStore.signup(
                AuthStore.SignupFields(
                    username = username, password = password, understood = understood,
                    name = name.trim().ifEmpty { null }, phone = phone.trim().ifEmpty { null },
                    email = email.trim().ifEmpty { null },
                    userIdCode = uidCode, passcode = passcode,
                )
            )
            busy = false
            if (err != null) error = err
        }
    }

    val total = 10
    val hasNext = step < total - 1
    val isOptional = step == 2 || step == 3

    Column {
        // back + progress dots + counter
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 16.dp)) {
            Box(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(Color(0x14FFFFFF))
                    .clickable { if (step == 0) onBack() else go(step - 1) }
                    .padding(10.dp),
            ) { Text("←", fontSize = 18.sp, color = Color(0xFF64748B)) }
            Spacer(Modifier.width(12.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                modifier = Modifier.weight(1f),
            ) {
                for (i in 0 until total) {
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(if (i <= step) Color(0xFF6366F1) else Color(0x266366F1)),
                    )
                }
            }
            Text("${step + 1}/$total", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color(0xFF94A3B8))
        }

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

        AnimatedContent(
            targetState = step,
            transitionSpec = {
                val enter = fadeIn(tween(220)) + slideInHorizontally(tween(280)) { dir * 46 }
                val exit = fadeOut(tween(180)) + slideOutHorizontally(tween(240)) { -dir * 46 }
                enter.togetherWith(exit)
            },
            label = "signupStep",
        ) { s ->
            Column(verticalArrangement = Arrangement.spacedBy(if (s in 6..8) 8.dp else 16.dp)) {
                when (s) {
                    0 -> {
                        StepHead(t("suNameTitle"), t("suNameSub"))
                        LgInput(value = name, onValueChange = { if (it.length <= 60) name = it }, placeholder = t("suNamePh"), fontSize = 17)
                    }
                    1 -> {
                        StepHead(t("suUserTitle"), t("suUserSub"))
                        LgInput(
                            value = username,
                            onValueChange = { v -> username = v.filter { it.isLetterOrDigit() || it == '_' }.lowercase() },
                            placeholder = t("usernamePh"), fontSize = 17,
                            leading = { Text("@", color = Color(0xFF94A3B8)) },
                            trailing = {
                                when (nameStatus) {
                                    "checking" -> Spinner(15, Color(0xFF94A3B8))
                                    "ok" -> Text("✓", color = Color(0xFF10B981), fontWeight = FontWeight.Bold, fontSize = 17.sp)
                                    "taken" -> Text(t("nameTaken"), color = Color(0xFFF43F5E), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                    "invalid" -> if (username.isNotEmpty()) Text(t("nameInvalid"), color = Color(0xFFF59E0B), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                }
                            },
                        )
                    }
                    2 -> {
                        StepHead(t("phoneLabel"), t("suPhoneSub"))
                        LgInput(
                            value = phone,
                            onValueChange = { v -> phone = v.filter { it.isDigit() || it == '+' || it == ' ' || it == '-' }.take(22) },
                            placeholder = t("phonePh"), fontSize = 17,
                        )
                    }
                    3 -> {
                        StepHead(t("emailLabel"), t("suEmailSub"))
                        LgInput(value = email, onValueChange = { v -> email = v.trim().take(190) }, placeholder = t("emailPh"), fontSize = 17)
                    }
                    4 -> {
                        StepHead(t("suPassTitle"), t("suPassSub"))
                        LgInput(
                            value = password, onValueChange = { password = it },
                            placeholder = t("passwordPh"), fontSize = 17,
                            visualTransformation = if (showPass) VisualTransformation.None else PasswordVisualTransformation(),
                            trailing = { Text(if (showPass) "🙈" else "👁", modifier = Modifier.clickable { showPass = !showPass }.padding(6.dp), fontSize = 16.sp) },
                        )
                        if (password.isNotEmpty() && password.length < 8) {
                            Text(t("passShort"), fontSize = 12.sp, color = Color(0xFFF59E0B), fontWeight = FontWeight.Medium)
                        }
                    }
                    5 -> {
                        StepHead(t("confirmPass"), t("suConfirmSub"))
                        LgInput(
                            value = password2, onValueChange = { password2 = it },
                            placeholder = t("passwordPh"), fontSize = 17,
                            visualTransformation = if (showPass) VisualTransformation.None else PasswordVisualTransformation(),
                            trailing = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (!mismatch && password2.isNotEmpty()) Text("✓", color = Color(0xFF10B981), fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                    Spacer(Modifier.width(8.dp))
                                    Text(if (showPass) "🙈" else "👁", modifier = Modifier.clickable { showPass = !showPass }.padding(4.dp), fontSize = 16.sp)
                                }
                            },
                        )
                        if (mismatch) Text(t("passMismatch"), fontSize = 12.sp, color = Color(0xFFF43F5E), fontWeight = FontWeight.Medium)
                    }
                    6 -> {
                        StepHead(t("suUidTitle"), t("suUidSub"), center = true)
                        PinPad(value = uidCode, onChange = { uidCode = it }, max = 12, minLength = 4, secure = false)
                        Box(Modifier.height(22.dp), contentAlignment = Alignment.Center) {
                            when (uidStatus) {
                                "checking" -> Spinner(14, Color(0xFF94A3B8))
                                "ok" -> Text("✓ ${t("uidAvailable")}", fontSize = 12.sp, color = Color(0xFF10B981), fontWeight = FontWeight.SemiBold)
                                "taken" -> Text(t("uidTaken"), fontSize = 12.sp, color = Color(0xFFF43F5E), fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                    7 -> {
                        StepHead(t("suPinTitle"), t("suPinSub"), center = true)
                        PinPad(value = passcode, onChange = { passcode = it }, max = 8, minLength = 6)
                    }
                    8 -> {
                        StepHead(t("suPin2Title"), t("suPin2Sub"), center = true)
                        PinPad(value = passcode2, onChange = { passcode2 = it }, max = 8, minLength = 6)
                        if (passcodeMismatch) {
                            Text(t("passMismatch"), fontSize = 12.sp, color = Color(0xFFF43F5E), fontWeight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth())
                        } else if (passcode2.length >= 6 && passcode == passcode2) {
                            Text("✓ ${t("pinMatched")}", fontSize = 12.sp, color = Color(0xFF10B981), fontWeight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth())
                        }
                    }
                    9 -> {
                        StepHead(t("suFinishTitle"), "${t("suFinishSub")} @$username · ID $uidCode", center = true)
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(16.dp))
                                .background(Color(0x1AF59E0B))
                                .border(1.dp, Color(0x40F59E0B), RoundedCornerShape(16.dp))
                                .clickable { understood = !understood }
                                .padding(16.dp),
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                Box(
                                    modifier = Modifier
                                        .size(22.dp)
                                        .clip(RoundedCornerShape(7.dp))
                                        .background(if (understood) Color(0xFFF59E0B) else Color(0x00F59E0B))
                                        .border(1.5.dp, if (understood) Color(0xFFF59E0B) else Color(0x66F59E0B), RoundedCornerShape(7.dp)),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    if (understood) Text("✓", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Black)
                                }
                                Text(
                                    t("noRecovery"),
                                    fontSize = 13.sp, lineHeight = 18.sp,
                                    color = Color(0xFFB45309),
                                    modifier = Modifier.weight(1f),
                                )
                            }
                        }
                    }
                }
            }
        }

        // nav buttons
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 24.dp)) {
            if (hasNext) {
                if (isOptional) {
                    LgGhostButton(text = t("skipBtn"), onClick = { go(step + 1) }, modifier = Modifier.weight(1f))
                }
                LgPrimaryButton(
                    text = "${t("nextBtn")} →",
                    enabled = stepValid(),
                    onClick = { go(step + 1) },
                    modifier = Modifier.weight(1f),
                )
            } else {
                LgPrimaryButton(
                    text = "",
                    enabled = !busy && stepValid(),
                    onClick = { finish() },
                ) {
                    if (busy) Spinner(18) else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("✓", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Black)
                        Text(t("signupBtn"), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.5.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun StepHead(title: String, sub: String?, center: Boolean = false) {
    Column(
        modifier = if (center) Modifier.fillMaxWidth() else Modifier,
        horizontalAlignment = if (center) Alignment.CenterHorizontally else Alignment.Start,
    ) {
        Text(title, fontSize = 16.5.sp, fontWeight = FontWeight.Bold, color = Color(0xFF1E293B))
        if (sub != null) {
            Text(sub, fontSize = 12.5.sp, color = Color(0xFF94A3B8), lineHeight = 17.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
}
