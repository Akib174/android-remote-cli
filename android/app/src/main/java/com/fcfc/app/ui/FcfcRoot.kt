package com.fcfc.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * App shell root — port of App.tsx ready branch.
 * Filled in by the integration phase: sidebar + chat window + profile panel +
 * overlays (modals, context menu, toasts, call overlay).
 * The auth-gate and boot states live in MainActivity.FcfcApp.
 */
@Composable
fun FcfcRoot() {
    // Integration placeholder — replaced when ui.list/ui.chat/ui.modals land.
    Box(modifier = Modifier.fillMaxSize())
}
