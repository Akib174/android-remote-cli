package com.fcfc.app

import android.app.Application
import com.fcfc.app.core.I18n
import com.fcfc.app.core.Notify
import com.fcfc.app.crypto.CryptoGroup
import com.fcfc.app.crypto.CryptoSessions
import com.fcfc.app.db.FcDb
import com.fcfc.app.emoji.EmojiData
import com.fcfc.app.net.ApiClient
import com.fcfc.app.net.ServerConfig
import com.fcfc.app.stores.AuthStore
import com.fcfc.app.stores.ChatsStore
import com.fcfc.app.stores.UiStore

class FcfcApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        I18n.init(this)
        EmojiData.init(this)
        UiStore.init(this)
        ServerConfig.init()
        FcDb.init(this)
        ApiClient.init(this)
        Notify.init(this)
        AuthStore.onKeysRestored = { ChatsStore.onKeysRestored() }
        CryptoGroup.sessionPassword = { AuthStore.password.value }
    }
}
