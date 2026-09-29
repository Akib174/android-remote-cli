package com.fcfc.app.emoji

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Emoji data core — port of frontend/src/lib/emoji.tsx (data parts).
 * Apple artwork via jsDelivr emoji-datasource-apple CDN (same URLs as web —
 * preserves identical artwork), Telegram animated webp overlay map.
 */
object EmojiData {
    const val CDN = "https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.1/img/apple"
    const val APPLE_PX = 64   // only 64px folder exists on the CDN

    lateinit var categories: List<Pair<String, List<String>>>
    private lateinit var animMap: Map<String, String>
    private val deadUrls = HashSet<String>()

    private val json = Json { ignoreUnknownKeys = true }

    fun init(ctx: Context) {
        val catText = ctx.assets.open("emoji_categories.json").bufferedReader().use { it.readText() }
        val cats = json.parseToJsonElement(catText).jsonObject
        // file shape: {"Smileys & People":[...]} after our extraction? verify: it was [{label, emojis}]
        categories = run {
            val el = json.parseToJsonElement(catText)
            if (el is kotlinx.serialization.json.JsonArray) {
                el.map { o ->
                    val obj = o.jsonObject
                    (obj["label"]?.jsonPrimitive?.contentOrNull ?: "") to
                        (obj["emojis"]?.let { e -> (e as kotlinx.serialization.json.JsonArray).map { it.jsonPrimitive.content } } ?: emptyList())
                }
            } else {
                cats.keys.map { k -> k to emptyList() }
            }
        }
        val animText = ctx.assets.open("anim_emoji.json").bufferedReader().use { it.readText() }
        animMap = json.parseToJsonElement(animText).jsonObject.entries.associate { (k, v) -> k to v.jsonPrimitive.content }
    }

    fun allEmojis(): List<String> = categories.flatMap { it.second }

    /** Telegram default quick reaction set (REACTIONS in source). */
    val REACTIONS = listOf("👍", "👎", "❤️", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "😅", "🥳")

    fun animEmojiUrl(char: String): String? =
        animMap[char] ?: animMap[char.replace("\uFE0F", "")]

    fun markDead(url: String) { deadUrls.add(url) }
    fun isDead(url: String) = url in deadUrls

    // ── emoji detection (port of EMOJI_RE) ─────────────────────────────────
    private val PICT_RANGES = arrayOf(
        intArrayOf(0x00A9, 0x00A9), intArrayOf(0x00AE, 0x00AE), intArrayOf(0x203C, 0x203C),
        intArrayOf(0x2049, 0x2049), intArrayOf(0x2122, 0x2122), intArrayOf(0x2139, 0x2139),
        intArrayOf(0x2194, 0x2199), intArrayOf(0x21A9, 0x21AA), intArrayOf(0x231A, 0x231B),
        intArrayOf(0x2328, 0x2328), intArrayOf(0x23CF, 0x23CF), intArrayOf(0x23E9, 0x23F3),
        intArrayOf(0x23F8, 0x23FA), intArrayOf(0x24C2, 0x24C2), intArrayOf(0x25AA, 0x25AB),
        intArrayOf(0x25B6, 0x25B6), intArrayOf(0x25C0, 0x25C0), intArrayOf(0x25FB, 0x25FE),
        intArrayOf(0x2600, 0x2604), intArrayOf(0x260E, 0x260E), intArrayOf(0x2611, 0x2611),
        intArrayOf(0x2614, 0x2615), intArrayOf(0x2618, 0x2618), intArrayOf(0x261D, 0x261D),
        intArrayOf(0x2620, 0x2620), intArrayOf(0x2622, 0x2623), intArrayOf(0x2626, 0x2626),
        intArrayOf(0x262A, 0x262A), intArrayOf(0x262E, 0x262F), intArrayOf(0x2638, 0x263A),
        intArrayOf(0x2640, 0x2640), intArrayOf(0x2642, 0x2642), intArrayOf(0x2648, 0x2653),
        intArrayOf(0x265F, 0x2660), intArrayOf(0x2663, 0x2663), intArrayOf(0x2665, 0x2668),
        intArrayOf(0x267B, 0x267B), intArrayOf(0x267E, 0x267F), intArrayOf(0x2692, 0x2697),
        intArrayOf(0x2699, 0x2699), intArrayOf(0x269B, 0x269C), intArrayOf(0x26A0, 0x26A1),
        intArrayOf(0x26A7, 0x26A7), intArrayOf(0x26AA, 0x26AB), intArrayOf(0x26B0, 0x26B1),
        intArrayOf(0x26BD, 0x26BE), intArrayOf(0x26C4, 0x26C5), intArrayOf(0x26C8, 0x26C8),
        intArrayOf(0x26CE, 0x26CF), intArrayOf(0x26D1, 0x26D1), intArrayOf(0x26D3, 0x26D4),
        intArrayOf(0x26E9, 0x26EA), intArrayOf(0x26F0, 0x26F5), intArrayOf(0x26F7, 0x26FA),
        intArrayOf(0x26FD, 0x26FD), intArrayOf(0x2702, 0x2702), intArrayOf(0x2705, 0x2705),
        intArrayOf(0x2708, 0x270D), intArrayOf(0x270F, 0x270F), intArrayOf(0x2712, 0x2712),
        intArrayOf(0x2714, 0x2714), intArrayOf(0x2716, 0x2716), intArrayOf(0x271D, 0x271D),
        intArrayOf(0x2721, 0x2721), intArrayOf(0x2728, 0x2728), intArrayOf(0x2733, 0x2734),
        intArrayOf(0x2744, 0x2744), intArrayOf(0x2747, 0x2747), intArrayOf(0x274C, 0x274C),
        intArrayOf(0x274E, 0x274E), intArrayOf(0x2753, 0x2755), intArrayOf(0x2757, 0x2757),
        intArrayOf(0x2763, 0x2764), intArrayOf(0x2795, 0x2797), intArrayOf(0x27A1, 0x27A1),
        intArrayOf(0x27B0, 0x27B0), intArrayOf(0x27BF, 0x27BF), intArrayOf(0x2934, 0x2935),
        intArrayOf(0x2B05, 0x2B07), intArrayOf(0x2B1B, 0x2B1C), intArrayOf(0x2B50, 0x2B50),
        intArrayOf(0x2B55, 0x2B55), intArrayOf(0x3030, 0x3030), intArrayOf(0x303D, 0x303D),
        intArrayOf(0x3297, 0x3297), intArrayOf(0x3299, 0x3299), intArrayOf(0x1F004, 0x1F004),
        intArrayOf(0x1F0CF, 0x1F0CF), intArrayOf(0x1F170, 0x1F171), intArrayOf(0x1F17E, 0x1F17F),
        intArrayOf(0x1F18E, 0x1F18E), intArrayOf(0x1F191, 0x1F19A), intArrayOf(0x1F200, 0x1F2FF),
        intArrayOf(0x1F300, 0x1F321), intArrayOf(0x1F324, 0x1F393), intArrayOf(0x1F396, 0x1F397),
        intArrayOf(0x1F399, 0x1F39B), intArrayOf(0x1F39E, 0x1F3F0), intArrayOf(0x1F3F3, 0x1F3F5),
        intArrayOf(0x1F3F7, 0x1F4FD), intArrayOf(0x1F4FF, 0x1F53D), intArrayOf(0x1F549, 0x1F54E),
        intArrayOf(0x1F550, 0x1F567), intArrayOf(0x1F56F, 0x1F570), intArrayOf(0x1F573, 0x1F57A),
        intArrayOf(0x1F587, 0x1F587), intArrayOf(0x1F58A, 0x1F58D), intArrayOf(0x1F590, 0x1F590),
        intArrayOf(0x1F595, 0x1F596), intArrayOf(0x1F5A4, 0x1F5A5), intArrayOf(0x1F5A8, 0x1F5A8),
        intArrayOf(0x1F5B1, 0x1F5B2), intArrayOf(0x1F5BC, 0x1F5BC), intArrayOf(0x1F5C2, 0x1F5C4),
        intArrayOf(0x1F5D1, 0x1F5D3), intArrayOf(0x1F5DC, 0x1F5DE), intArrayOf(0x1F5E1, 0x1F5E1),
        intArrayOf(0x1F5E3, 0x1F5E3), intArrayOf(0x1F5E8, 0x1F5E8), intArrayOf(0x1F5EF, 0x1F5EF),
        intArrayOf(0x1F5F3, 0x1F5F3), intArrayOf(0x1F5FA, 0x1F64F), intArrayOf(0x1F680, 0x1F6C5),
        intArrayOf(0x1F6CB, 0x1F6D2), intArrayOf(0x1F6D5, 0x1F6D7), intArrayOf(0x1F6DC, 0x1F6E5),
        intArrayOf(0x1F6E9, 0x1F6E9), intArrayOf(0x1F6EB, 0x1F6EC), intArrayOf(0x1F6F0, 0x1F6F0),
        intArrayOf(0x1F6F3, 0x1F6FC), intArrayOf(0x1F7E0, 0x1F7EB), intArrayOf(0x1F7F0, 0x1F7F0),
        intArrayOf(0x1F90C, 0x1F93A), intArrayOf(0x1F93C, 0x1F945), intArrayOf(0x1F947, 0x1F9FF),
        intArrayOf(0x1FA70, 0x1FA7C), intArrayOf(0x1FA80, 0x1FA89), intArrayOf(0x1FA8F, 0x1FAC6),
        intArrayOf(0x1FACE, 0x1FADC), intArrayOf(0x1FADF, 0x1FAE9), intArrayOf(0x1FAF0, 0x1FAF8),
    )

    fun isExtPict(cp: Int): Boolean {
        var lo = 0; var hi = PICT_RANGES.size - 1
        while (lo <= hi) {
            val mid = (lo + hi) / 2
            val r = PICT_RANGES[mid]
            when {
                cp < r[0] -> hi = mid - 1
                cp > r[1] -> lo = mid + 1
                else -> return true
            }
        }
        return false
    }

    private fun isKeycapStart(c: Char): Boolean = c == '#' || c == '*' || c.isDigit()
    private fun isFlag(cp: Int): Boolean = cp in 0x1F1E6..0x1F1FF
    private fun isSkin(cp: Int): Boolean = cp in 0x1F3FB..0x1F3FF
    private fun isVS(cp: Int): Boolean = cp == 0xFE0F
    private fun isKeycapEnd(cp: Int): Boolean = cp == 0x20E3
    private fun isZWJ(cp: Int): Boolean = cp == 0x200D

    /** Matches EMOJI_RE: returns the length (in code units) of an emoji sequence at [i], or -1. */
    fun matchAt(text: String, i: Int): Int {
        if (i >= text.length) return -1
        val firstCp = text.codePointAt(i)
        val firstLen = Character.charCount(firstCp)
        // keycap: [#*0-9] FE0F? 20E3
        if (firstCp < 0x80 && isKeycapStart(text[i])) {
            var j = i + 1
            if (j < text.length && text[j] == '\uFE0F') j++
            if (j < text.length && text.codePointAt(j) == 0x20E3) return j + 1 - i
        }
        // regional indicator pair
        if (isFlag(firstCp) && i + firstLen + 1 < text.length + 1) {
            val next = i + firstLen
            if (next + 1 < text.length || (next + 1 == text.length)) {
                if (next < text.length) {
                    val cp2 = text.codePointAt(next)
                    if (isFlag(cp2)) return firstLen + Character.charCount(cp2)
                }
            }
        }
        // Extended_Pictographic chain
        if (isExtPict(firstCp)) {
            var j = i + firstLen
            var cp: Int
            while (j < text.length) {
                cp = text.codePointAt(j)
                if (isVS(cp) || isSkin(cp)) { j += Character.charCount(cp); continue }
                if (isZWJ(cp)) {
                    j += 1
                    if (j >= text.length) break
                    val nxt = text.codePointAt(j)
                    if (!isExtPict(nxt)) break
                    j += Character.charCount(nxt)
                    continue
                }
                break
            }
            return j - i
        }
        return -1
    }

    data class Part(val emoji: String?, val text: String?)

    fun splitEmoji(text: String): List<Part> {
        val out = ArrayList<Part>()
        var last = 0
        var i = 0
        while (i < text.length) {
            val len = matchAt(text, i)
            if (len > 0) {
                if (i > last) out.add(Part(null, text.substring(last, i)))
                out.add(Part(text.substring(i, i + len), null))
                last = i + len
                i = last
            } else i++
        }
        if (last < text.length) out.add(Part(null, text.substring(last)))
        return out
    }

    private fun hex(cp: Int) = cp.toString(16)

    /** Candidate file names on the CDN (exact → fe0f-padded → fe0f-stripped). */
    fun candidates(char: String): List<String> {
        val cps = ArrayList<Int>(char.length)
        var i = 0
        while (i < char.length) {
            val cp = char.codePointAt(i)
            cps.add(cp)
            i += Character.charCount(cp)
        }
        val exact = cps.joinToString("-") { hex(it) }
        val out = ArrayList<String>(3)
        out.add(exact)
        val padded = StringBuilder()
        var idx = 0
        for ((ci, cp) in cps.withIndex()) {
            if (ci > 0) padded.append('-')
            padded.append(hex(cp))
            val next = cps.getOrNull(ci + 1)
            val needs = isExtPict(cp) && cp < 0x1F000 &&
                next != null && next != 0xFE0F && next != 0x20E3 && next != 0x200D && !isSkin(next)
            if (needs) padded.append("-fe0f")
            idx++
        }
        if (padded.toString() != exact) out.add(padded.toString())
        val stripped = cps.filter { it != 0xFE0F }.joinToString("-") { hex(it) }
        if (stripped != exact && stripped != padded.toString()) out.add(stripped)
        return out
    }

    /** Apple artwork PNG URL (only 64px folder exists; upscaled by UI). */
    fun emojiUrl(char: String): String {
        val name = candidates(char).firstOrNull() ?: return ""
        return "$CDN/$APPLE_PX/$name.png"
    }

    /** Single-emoji message detection (Telegram-style). Returns the emoji or null. */
    fun isSingleEmoji(text: String?): String? {
        if (text == null) return null
        val trimmed = text.trim() + ""
        if (trimmed.isEmpty()) return null
        val parts = splitEmoji(trimmed)
        if (parts.any { (it.text ?: "").trim().isNotEmpty() }) return null
        val emojis = parts.mapNotNull { it.emoji }
        return if (emojis.size == 1) emojis[0] else null
    }
}
