package com.fcfc.app.media

import android.content.Context
import com.fcfc.app.core.Codec
import com.fcfc.app.crypto.CryptoGroup
import com.fcfc.app.model.MediaMeta
import com.fcfc.app.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File

/**
 * Media pipeline — port of frontend/src/lib/media.ts.
 * R2 fetch → client-side decrypt → cached local file for Coil.
 * Upload: encrypt → small (≤20MB) or multipart path via the Worker.
 */
object Media {
    private lateinit var cacheDir: File
    private val cache = HashMap<String, String>()
    private val mutexes = HashMap<String, Mutex>()
    private val global = Any()

    fun init(ctx: Context) {
        cacheDir = File(ctx.cacheDir, "media").apply { mkdirs() }
    }

    private fun lockFor(key: String): Mutex = synchronized(global) {
        mutexes.getOrPut(key) { Mutex() }
    }

    /**
     * Fetch + decrypt (when fileKey/iv present) + cache. Returns a file path
     * Coil can load, or null on failure. Suspend — call from a coroutine.
     */
    suspend fun decryptedMediaUrl(key: String?, fileKey: String?, iv: String?): String? {
        if (key.isNullOrEmpty()) return null
        cache[key]?.let { return it }
        return lockFor(key).withLock {
            cache[key]?.let { return it }
            try {
                val dl = ApiClient.download(key)
                val bytes = if (!fileKey.isNullOrEmpty() && !iv.isNullOrEmpty()) {
                    CryptoGroup.decryptFile(dl.bytes, fileKey, iv)
                } else dl.bytes
                val f = File(cacheDir, key.replace("/", "_"))
                withContext(Dispatchers.IO) { f.writeBytes(bytes) }
                val path = f.absolutePath
                cache[key] = path
                path
            } catch (_: Exception) { null }
        }
    }

    suspend fun decryptedMediaUrl(media: MediaMeta?): String? =
        decryptedMediaUrl(media?.key, media?.fileKey, media?.iv)

    /** encrypt + upload — returns the wire MediaMeta for the message payload. */
    suspend fun uploadEncrypted(bytes: ByteArray, name: String, mime: String): MediaMeta {
        val enc = CryptoGroup.encryptFile(bytes)
        val key: String
        if (enc.bytes.size <= 20 * 1024 * 1024) {
            key = ApiClient.uploadSmall(enc.bytes, "application/octet-stream")
        } else {
            key = ApiClient.uploadLarge(enc.bytes, mime, name, enc.ivB64u)
        }
        return MediaMeta(key = key, name = name, size = bytes.size.toLong(), mime = mime, iv = enc.ivB64u, fileKey = enc.keyB64u)
    }

    /** avatar small-variant key convention (web parity). */
    fun smallAvatarKey(key: String): String = key.replace(Regex("\\.bin$"), "_small.bin")

    fun jsonOf(m: MediaMeta): kotlinx.serialization.json.JsonObject = buildJsonObject {
        put("key", m.key)
        m.name?.let { put("name", it) }
        m.size?.let { put("size", it) }
        m.mime?.let { put("mime", it) }
        m.iv?.let { put("iv", it) }
        m.fileKey?.let { put("fileKey", it) }
        m.w?.let { put("w", it) }
        m.h?.let { put("h", it) }
        m.dur?.let { put("dur", it) }
    }
}
