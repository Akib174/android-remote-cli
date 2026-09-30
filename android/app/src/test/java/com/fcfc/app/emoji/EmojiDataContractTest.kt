package com.fcfc.app.emoji

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * REGRESSION TEST for the startup crash:
 *
 *   IllegalArgumentException: Element class kotlinx.serialization.json.JsonArray
 *   (Kotlin reflection is not available) is not a JsonObject
 *     at com.fcfc.app.emoji.EmojiData.init(EmojiData.kt:26)
 *     at com.fcfc.app.FcfcApplication.onCreate(FcfcApplication.kt:22)
 *
 * Root cause: the old parser unconditionally cast the emoji_categories.json
 * root to a JsonObject, but the bundled (and web-contract) root is a JsonArray.
 *
 * This test loads the EXACT production asset files (src/main/assets/…) and
 * locks the data contract to the web source of truth:
 *   - frontend/src/lib/emoji.tsx         EMOJI_CATEGORIES: array of {label, emojis}
 *   - frontend/src/lib/animEmojiData.ts  ANIM_EMOJI_URL: Record<char, url>
 *
 * All expected values below were extracted from those web source files
 * (verified byte-identical at fix time: 5 categories / 712 emojis /
 * 848 animated entries).
 */
class EmojiDataContractTest {

    // ── web truth constants (frontend/src/lib/emoji.tsx) ──────────────────────
    private val webLabels = listOf(
        "Smileys & People", "Animals & Nature", "Food & Drink",
        "Activity & Travel", "Objects & Symbols",
    )
    private val webCounts = listOf(183, 87, 100, 151, 191)
    private val webTotalEmojis = 712

    // ── web truth constants (frontend/src/lib/animEmojiData.ts) ───────────────
    private val WEB_ANIM_COUNT = 848
    private val webAnimHeart =
        "https://cdn.jsdelivr.net/gh/Tarikul-Islam-Anik/Telegram-Animated-Emojis@main/Symbols/Red%20Heart.webp"
    private val webAnimFire =
        "https://cdn.jsdelivr.net/gh/Tarikul-Islam-Anik/Telegram-Animated-Emojis@main/Animals%20and%20Nature/Fire.webp"
    private val webAnimBang =
        "https://cdn.jsdelivr.net/gh/Tarikul-Islam-Anik/Telegram-Animated-Emojis@main/Symbols/Double%20Exclamation%20Mark.webp"
    private val webAnimHourglass =
        "https://cdn.jsdelivr.net/gh/Tarikul-Islam-Anik/Telegram-Animated-Emojis@main/Objects/Hourglass%20Done.webp"

    private val json = Json { ignoreUnknownKeys = true }

    /** Loads the exact production asset shipped inside the APK. */
    private fun productionAsset(name: String): String {
        val candidates = listOf(
            File("src/main/assets/$name"),        // module dir (Gradle test working dir)
            File("app/src/main/assets/$name"),    // repo/android root fallback
        )
        val f = candidates.firstOrNull { it.isFile }
            ?: error("production asset not found: $name (cwd=${File(".").absolutePath})")
        return f.readText()
    }

    private fun categoriesText(): String = productionAsset("emoji_categories.json")
    private fun animText(): String = productionAsset("anim_emoji.json")

    // ── 1. The regression: the production root IS a JsonArray ─────────────────

    /**
     * The exact shape the OLD line-26 parser got wrong. The production asset's
     * real root type is asserted here so any change is caught deliberately.
     */
    @Test
    fun productionCategoriesAssetIsWebShapedJsonArray() {
        val root = json.parseToJsonElement(categoriesText())
        assertTrue(
            "emoji_categories.json root must be a JsonArray (web EMOJI_CATEGORIES contract), " +
                "got ${root::class.simpleName} — this is the exact regression of the startup crash",
            root is JsonArray,
        )
        val arr = root as JsonArray
        assertEquals("category count (web has 5)", webLabels.size, arr.size)
        arr.forEachIndexed { i, el ->
            assertTrue("category[$i] must be a JsonObject, got ${el::class.simpleName}", el is JsonObject)
            val obj = el as JsonObject
            val label = obj["label"]
            assertTrue(
                "category[$i].label must be a string primitive",
                label is JsonPrimitive && label.isString,
            )
            val emojis = obj["emojis"]
            assertTrue("category[$i].emojis must be a JsonArray", emojis is JsonArray)
            (emojis as JsonArray).forEachIndexed { j, e ->
                val p = e as? JsonPrimitive
                assertTrue("category[$i].emojis[$j] must be a string primitive", p != null && p.isString)
                assertTrue("category[$i].emojis[$j] must not be blank", p!!.content.isNotBlank())
            }
        }
    }

    @Test
    fun productionCategoriesMatchWebCountsAndOrder() {
        val root = json.parseToJsonElement(categoriesText()) as JsonArray
        val labels = root.map { (((it as JsonObject)["label"]) as JsonPrimitive).content }
        assertEquals(webLabels, labels)
        val counts = root.map { ((it as JsonObject)["emojis"] as JsonArray).size }
        assertEquals(webCounts, counts)
        assertEquals("total emoji count (web EMOJI_CATEGORIES)", webTotalEmojis, counts.sum())
    }

    @Test
    fun productionAnimAssetIsWebShapedJsonObject() {
        val root = json.parseToJsonElement(animText())
        assertTrue(
            "anim_emoji.json root must be a JsonObject (web ANIM_EMOJI_URL contract), got ${root::class.simpleName}",
            root is JsonObject,
        )
        val obj = root as JsonObject
        assertEquals("animated emoji entry count (web ANIM_EMOJI_URL)", WEB_ANIM_COUNT, obj.entries.size)
        for ((k, v) in obj.entries) {
            val p = v as? JsonPrimitive
            assertTrue("anim[$k] must be a string primitive", p != null && p.isString)
            assertTrue("anim[$k] must be a jsDelivr https URL", p!!.content.startsWith("https://cdn.jsdelivr.net/"))
        }
    }

    // ── 2. EmojiData.init over the exact production data does not throw ───────

    /**
     * The startup crash path itself: this is what FcfcApplication.onCreate()
     * executes (via ctx.assets) — here fed the exact production file contents.
     * Any parse failure fails the test (nothing is swallowed).
     */
    @Test
    fun emojiDataInitWithExactProductionDataDoesNotThrow() {
        EmojiData.init(categoriesText(), animText())

        assertEquals(webLabels, EmojiData.categories.map { it.first })
        assertEquals(webCounts, EmojiData.categories.map { it.second.size })
        assertEquals(webTotalEmojis, EmojiData.allEmojis().size)

        // spot-check web-exact emoji positions
        assertEquals("😀", EmojiData.categories[0].second.first())
        assertEquals("😁", EmojiData.categories[0].second[1])
        assertEquals("🌈", EmojiData.categories[4].second.last())

        // web REACTIONS quick set (order + content)
        assertEquals(
            listOf("👍", "👎", "❤️", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "😅", "🥳"),
            EmojiData.REACTIONS,
        )
    }

    @Test
    fun animatedEmojiLookupMatchesWebUrls() {
        EmojiData.init(categoriesText(), animText())

        // exact-char lookups (keys carry FE0F in the web map)
        assertEquals(webAnimHeart, EmojiData.animEmojiUrl("❤️"))
        assertEquals(webAnimFire, EmojiData.animEmojiUrl("🔥"))
        assertEquals(webAnimBang, EmojiData.animEmojiUrl("‼️"))

        // FE0F-strip fallback path (web: animMap[char] || animMap[char.replace(FE0F)])
        assertEquals(webAnimHourglass, EmojiData.animEmojiUrl("⌛\uFE0F"))

        // unknown char → null (web behavior)
        assertNull(EmojiData.animEmojiUrl("␀-not-an-emoji"))
    }

    @Test
    fun singleEmojiDetectionMatchesWebBehavior() {
        EmojiData.init(categoriesText(), animText())
        assertEquals("❤️", EmojiData.isSingleEmoji("❤️"))
        assertEquals("❤️", EmojiData.isSingleEmoji("  ❤️  "))
        assertNull(EmojiData.isSingleEmoji("hello ❤️"))
        assertNull(EmojiData.isSingleEmoji("❤️❤️"))
        assertNull(EmojiData.isSingleEmoji(""))
        assertNull(EmojiData.isSingleEmoji(null))
    }

    // ── 3. Wrong shapes fail LOUDLY (no silent empty-data fallback) ───────────

    /**
     * Guards against reintroducing a silent fallback: a malformed or
     * wrong-shaped asset must throw a descriptive IllegalStateException,
     * never initialize with empty/partial emoji data.
     */
    @Test
    fun wrongRootShapesFailLoudlyNotSilently() {
        val cat = categoriesText()
        val anim = animText()

        // categories root as object (the OLD wrong assumption) → must throw
        assertInitThrows("{\"Smileys & People\":[]}", anim)

        // empty categories array → must throw
        assertInitThrows("[]", anim)

        // missing emojis field → must throw
        assertInitThrows("[{\"label\":\"x\"}]", anim)

        // non-string emoji entry → must throw
        assertInitThrows("[{\"label\":\"x\",\"emojis\":[42]}]", anim)

        // anim root as array → must throw
        assertInitThrows(cat, "[]")

        // empty anim map → must throw
        assertInitThrows(cat, "{}")
    }

    /**
     * Expects IllegalStateException with a non-blank, self-describing message.
     * Any OTHER throwable (e.g. IllegalArgumentException) propagates and fails
     * the test with the original error — nothing is masked.
     */
    private fun assertInitThrows(categoriesJson: String, animJson: String) {
        try {
            EmojiData.init(categoriesJson, animJson)
            fail("EmojiData.init must throw for wrong-shaped data (categories=${categoriesJson.take(48)}…, anim=${animJson.take(24)}…) — it returned silently")
        } catch (t: IllegalStateException) {
            assertTrue("error message must be descriptive", !t.message.isNullOrBlank())
        }
    }
}
