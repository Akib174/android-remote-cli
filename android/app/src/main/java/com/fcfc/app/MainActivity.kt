package com.fcfc.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.fcfc.app.stores.AuthStore
import com.fcfc.app.stores.ChatsStore
import com.fcfc.app.stores.UiStore
import com.fcfc.app.theme.fcfcColors
import com.fcfc.app.ui.FcfcRoot
import com.fcfc.app.ui.auth.AuthScreen
import com.fcfc.app.ui.boot.BootScreen
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            FcfcApp()
        }
    }
}

@Composable
fun FcfcApp() {
    val status by AuthStore.status.collectAsState()
    val theme by UiStore.theme
    val colors = fcfcColors(theme == "dark")

    // boot: restore session from persisted tokens
    LaunchedEffect(Unit) {
        AuthStore.boot()
    }

    androidx.compose.material3.MaterialTheme {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.body),
        ) {
            when (status) {
                AuthStore.STATUS_BOOT -> BootScreen()
                AuthStore.STATUS_AUTH -> AuthScreen()
                else -> FcfcRoot()
            }
        }
    }
}
