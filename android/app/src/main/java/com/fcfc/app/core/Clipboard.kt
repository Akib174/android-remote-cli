package com.fcfc.app.core

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context

/** Clipboard helper (web navigator.clipboard.writeText). */
object Clipboard {
    lateinit var ctx: Context
    fun copy(text: String) {
        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("fcfc", text))
    }
}
