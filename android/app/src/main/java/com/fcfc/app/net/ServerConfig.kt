package com.fcfc.app.net

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Server URL configuration — the web app uses VITE_API_BASE (build-time env).
 * Android builds cannot embed a per-deployment domain, so the base URL is
 * user-configurable (stored in prefs) and normalized like the web client
 * (trailing slashes stripped).
 */
object ServerConfig {
    private const val PREFS = "fcfc.net"
    private const val KEY = "baseUrl"

    val baseUrl = MutableStateFlow("")

    fun init(ctx: Context) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        baseUrl.value = normalize(prefs.getString(KEY, null) ?: "")
    }

    fun normalize(url: String): String = url.trim().replace(Regex("/+$"), "")

    fun set(ctx: Context, url: String) {
        val n = normalize(url)
        baseUrl.value = n
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, n).apply()
    }

    fun wsUrl(): String = baseUrl.value.replaceFirst(Regex("^http"), "ws")
}
