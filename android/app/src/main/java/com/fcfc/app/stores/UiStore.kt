package com.fcfc.app.stores

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/**
 * UI store — port of frontend/src/stores/ui.ts (Zustand).
 * Kept as global mutable state + Compose-observable via [state] snapshot flow pattern.
 */
object UiStore {
    @Serializable
    enum class Panel { SETTINGS, ARCHIVED, STARRED }

    @Serializable
    data class ModalState(val type: String, val props: String? = null)

    @Serializable
    data class ViewerState(val urls: List<String>, val index: Int = 0, val name: String? = null)

    @Serializable
    data class AvatarView(val name: String, val id: String, val avatarKey: String? = null)

    @Serializable
    data class MenuReactions(
        val emojis: List<String> = emptyList(),
        val more: List<String> = emptyList(),
    ) {
        @Transient var onPick: ((String) -> Unit)? = null
        @Transient var onMore: (() -> Unit)? = null
    }

    @Serializable
    data class MenuItem(val label: String, val danger: Boolean = false, val icon: String? = null) {
        @Transient var onClick: (() -> Unit)? = null
    }

    @Serializable
    data class MenuState(val x: Float, val y: Float, val items: List<MenuItem>, val reactions: MenuReactions? = null)

    @Serializable
    data class Toast(val id: Long, val text: String)

    // ── state fields (mirror ui.ts exactly) ──
    val theme = mutableStateOf("light")                 // 'light' | 'dark'
    val panel = mutableStateOf<Panel?>(null)
    val rightPanel = mutableStateOf<String?>(null)      // chatId
    val modal = mutableStateOf<ModalState?>(null)
    val viewer = mutableStateOf<ViewerState?>(null)
    val avatarView = mutableStateOf<AvatarView?>(null)
    val call = mutableStateOf<com.fcfc.app.model.CallUi?>(null)
    val menu = mutableStateOf<MenuState?>(null)
    val toasts = mutableStateOf<List<Toast>>(emptyList())
    val mobileView = mutableStateOf("list")             // 'list' | 'chat'
    val sidebarW = mutableStateOf(380f)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var toastId = 0L
    private var appContext: Context? = null
    private val prefs by lazy { appContext!!.getSharedPreferences("fcfc.ui", Context.MODE_PRIVATE) }

    fun init(ctx: Context) {
        appContext = ctx.applicationContext
        theme.value = prefs.getString("theme", null) ?: "light"
        val w = prefs.getFloat("sidebarW", 380f)
        sidebarW.value = if (w in 68f..520f) w else 380f
    }

    fun toggleTheme() {
        theme.value = if (theme.value == "light") "dark" else "light"
        prefs.edit().putString("theme", theme.value).apply()
    }

    fun setTheme(t: String) {
        theme.value = if (t == "dark") "dark" else "light"
        prefs.edit().putString("theme", theme.value).apply()
    }

    fun setPanel(p: Panel?) { panel.value = p }
    fun openRightPanel(chatId: String) { rightPanel.value = chatId }
    fun closeRightPanel() { rightPanel.value = null }
    fun openModal(type: String, props: String? = null) { modal.value = ModalState(type, props) }
    fun closeModal() { modal.value = null }
    fun openViewer(urls: List<String>, index: Int = 0, name: String? = null) {
        viewer.value = ViewerState(urls, index, name)
    }
    fun closeViewer() { viewer.value = null }
    fun openAvatarView(name: String, id: String, avatarKey: String? = null) {
        avatarView.value = AvatarView(name, id, avatarKey)
    }
    fun closeAvatarView() { avatarView.value = null }
    fun setCall(c: com.fcfc.app.model.CallUi?) { call.value = c }
    fun openMenu(x: Float, y: Float, items: List<MenuItem>, reactions: MenuReactions? = null) {
        menu.value = MenuState(x, y, items, reactions)
    }
    fun closeMenu() { menu.value = null }

    fun toast(text: String) {
        val t = Toast(++toastId, text)
        toasts.value = toasts.value + t
        scope.launch {
            delay(3200)
            toasts.value = toasts.value.filterNot { it.id == t.id }
        }
    }

    fun setMobileView(v: String) { mobileView.value = v }
    fun setSidebarW(w: Float) {
        val clamped = w.coerceIn(68f, 520f)
        sidebarW.value = clamped
        prefs.edit().putFloat("sidebarW", clamped).apply()
    }
}
