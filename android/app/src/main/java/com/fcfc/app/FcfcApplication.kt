package com.fcfc.app

import android.app.Application
import com.fcfc.app.core.I18n
import com.fcfc.app.emoji.EmojiData
import com.fcfc.app.net.ServerConfig
import com.fcfc.app.stores.UiStore

class FcfcApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        I18n.init(this)
        EmojiData.init(this)
        UiStore.init(this)
        ServerConfig.init()
    }
}
