package com.fcfc.app.core

import java.security.MessageDigest
import java.util.Base64

/** Base64url (no padding) helpers — matches the web app's b64u(). */
object Codec {
    private val b64e: Base64.Encoder = Base64.getUrlEncoder().withoutPadding()
    private val b64d: Base64.Decoder = Base64.getUrlDecoder()
    private val stdE: Base64.Encoder = Base64.getEncoder()
    private val stdD: Base64.Decoder = Base64.getDecoder()

    fun b64u(bytes: ByteArray): String = b64e.encodeToString(bytes)
    fun b64uBytes(s: String): ByteArray = b64d.decode(s)
    fun b64(bytes: ByteArray): String = stdE.encodeToString(bytes)
    fun b64Bytes(s: String): ByteArray = stdD.decode(s)

    private val HEX = "0123456789abcdef".toCharArray()
    fun hex(bytes: ByteArray): String {
        val out = CharArray(bytes.size * 2)
        for (i in bytes.indices) {
            val v = bytes[i].toInt() and 0xff
            out[i * 2] = HEX[v ushr 4]
            out[i * 2 + 1] = HEX[v and 0xf]
        }
        return String(out)
    }
    fun hexBytes(hex: String): ByteArray {
        val h = hex.lowercase()
        return ByteArray(h.length / 2) { i ->
            ((Character.digit(h[i * 2], 16) shl 4) + Character.digit(h[i * 2 + 1], 16)).toByte()
        }
    }

    fun sha256(bytes: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(bytes)

    fun utf8(s: String): ByteArray = s.toByteArray(Charsets.UTF_8)
    fun fromUtf8(b: ByteArray): String = String(b, Charsets.UTF_8)
}

/** Monotonic-ish timestamp in ms (matches web's ts logic: max(now, last+1)). */
object Ts {
    fun now(): Long = System.currentTimeMillis()
    fun monotonicAfter(last: Long): Long = maxOf(System.currentTimeMillis(), last + 1)
}

/** ID generation matching the web's crypto.randomUUID-style ids. */
fun newId(): String =
    java.util.UUID.randomUUID().toString()
