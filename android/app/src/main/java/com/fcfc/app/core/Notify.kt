package com.fcfc.app.core

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.SoundPool
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.fcfc.app.model.Chat
import com.fcfc.app.model.Message
import com.fcfc.app.R

/**
 * Notifications + ping sound — port of frontend/src/lib/notify.ts.
 * Channel "messages"; per-chat notification id (hash); tone via SoundPool.
 */
object Notify {
    private const val CHANNEL = "fcfc_messages"
    private var ctx: Context? = null
    private var soundPool: SoundPool? = null
    private var pingId = 0

    fun init(context: Context) {
        ctx = context.applicationContext
        val m = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        m.createNotificationChannel(
            NotificationChannel(CHANNEL, I18n.t("notificationsT"), NotificationManager.IMPORTANCE_HIGH).apply {
                enableVibration(true)
            }
        )
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        soundPool = SoundPool.Builder().setMaxStreams(2).setAudioAttributes(attrs).build()
        pingId = soundPool!!.load(context, R.raw.ping, 1)
    }

    /** two-tone ping (notify.ts playPing) */
    fun playPing() {
        val sp = soundPool ?: return
        val settings = AuthSettings.sound
        if (!settings) return
        sp.play(pingId, 0.9f, 0.9f, 1, 0, 1f)
    }

    /** notification sound enabled setting (auth.settings.sound, default true). */
    object AuthSettings {
        var sound: Boolean = true
    }

    fun message(chat: Chat, msg: Message) {
        val c = ctx ?: return
        if (Build.VERSION.SDK_INT >= 33 &&
            androidx.core.content.ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val title = chatTitle(chat)
        val body = msg.body ?: ""
        val notif = NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_fc)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        val id = (chat.id.hashCode() and 0x7fffffff)
        runCatching { NotificationManagerCompat.from(c).notify(id, notif) }
        playPing()
    }

    fun chatTitle(chat: Chat): String = when {
        chat.saved == true -> I18n.t("savedChatTitle")
        chat.kind == com.fcfc.app.model.ChatKind.GROUP -> chat.title ?: I18n.t("groupFallback")
        else -> chat.peer?.name?.takeIf { it.isNotBlank() } ?: chat.peer?.username ?: ""
    }
}
