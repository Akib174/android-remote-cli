package com.fcfc.app.db

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.io.File

/**
 * Local KV store — port of frontend/src/lib/db.ts (IndexedDB wrapper).
 * Stores: keys, sessions, senderKeys, messages, starred, meta.
 * Layout: <filesDir>/fcfc/<store>/<urlsafe-key>.json — one file per entry,
 * in-memory cache for reads, per-store mutex for writes. Private plaintext
 * keys live here exactly like the web app's idb; they never leave the device
 * except inside the encrypted key-backup blob.
 */
object FcDb {
    private lateinit var root: File
    private val JSON = Json { ignoreUnknownKeys = true; isLenient = true }
    private val caches = HashMap<String, HashMap<String, JsonElement>>()
    private val mutexes = HashMap<String, Mutex>()
    private val global = Any()

    fun init(ctx: Context) {
        root = File(ctx.filesDir, "fcfc")
        if (!root.exists()) root.mkdirs()
        listOf("keys", "sessions", "senderKeys", "messages", "starred", "meta").forEach { dir(it) }
    }

    private fun dir(store: String): File {
        val f = File(root, store)
        if (!f.exists()) f.mkdirs()
        synchronized(global) { caches.getOrPut(store) { HashMap() } }
        synchronized(global) { mutexes.getOrPut(store) { Mutex() } }
        return f
    }

    private fun cache(store: String): HashMap<String, JsonElement> {
        synchronized(global) { return caches.getOrPut(store) { HashMap() } }
    }

    private fun mutex(store: String): Mutex {
        synchronized(global) { return mutexes.getOrPut(store) { Mutex() } }
    }

    private fun fileFor(store: String, key: String): File =
        File(dir(store), java.net.URLEncoder.encode(key, "UTF-8") + ".json")

    suspend fun get(store: String, key: String): JsonElement? {
        mutex(store).withLock {
            val c = cache(store)
            if (c.containsKey(key)) return c[key]
            val f = fileFor(store, key)
            if (!f.exists()) return null
            return try { JSON.parseToJsonElement(f.readText()).also { c[key] = it } } catch (_: Exception) { null }
        }
    }

    suspend fun put(store: String, key: String, value: JsonElement) {
        mutex(store).withLock {
            cache(store)[key] = value
            withContext(Dispatchers.IO) {
                runCatching { fileFor(store, key).writeText(value.toString()) }
            }
        }
    }

    suspend fun del(store: String, key: String) {
        mutex(store).withLock {
            cache(store).remove(key)
            withContext(Dispatchers.IO) { runCatching { fileFor(store, key).delete() } }
        }
    }

    suspend fun allKeys(store: String): List<String> {
        mutex(store).withLock {
            val files = dir(store).listFiles() ?: return emptyList()
            return files.map { java.net.URLDecoder.decode(it.nameWithoutExtension, "UTF-8") }
        }
    }

    suspend fun all(store: String): List<JsonElement> {
        mutex(store).withLock {
            val c = cache(store)
            val files = dir(store).listFiles() ?: return emptyList()
            val out = mutableListOf<JsonElement>()
            for (f in files) {
                val k = java.net.URLDecoder.decode(f.nameWithoutExtension, "UTF-8")
                val v = c.getOrPut(k) {
                    try { JSON.parseToJsonElement(f.readText()) } catch (_: Exception) { kotlinx.serialization.json.JsonNull }
                }
                if (v != kotlinx.serialization.json.JsonNull) out.add(v)
            }
            return out
        }
    }

    suspend fun clear(store: String) {
        mutex(store).withLock {
            cache(store).clear()
            withContext(Dispatchers.IO) {
                dir(store).listFiles()?.forEach { runCatching { it.delete() } }
            }
        }
    }

    suspend fun wipeAll() {
        for (s in listOf("keys", "sessions", "senderKeys", "messages", "starred", "meta")) clear(s)
    }
}
