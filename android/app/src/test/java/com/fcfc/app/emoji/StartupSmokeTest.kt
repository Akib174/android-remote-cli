package com.fcfc.app.emoji

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * STARTUP SMOKE TEST — guards the exact crash path:
 *
 *   FcfcApplication.onCreate()  (line 22)
 *     → EmojiData.init(ctx)     (EmojiData.kt line 26 — crashed here)
 *       → app startup          (process died before Login/Signup rendered)
 *
 * FcfcApplication.onCreate cannot run on the plain JVM (it needs the Android
 * runtime: Context, assets, SharedPreferences, notification channels) — the
 * final acceptance check is the real-device launch. What CAN be verified
 * deterministically here, and what this test locks down:
 *
 *  1. Every asset parsed during onCreate parses cleanly with the production
 *     parser and the production data (i18n.json first, then the emoji pair —
 *     the same order FcfcApplication executes).
 *  2. EmojiData.init succeeds and leaves fully-initialized state (the exact
 *     call the Application makes, fed the exact bytes the APK bundles).
 *  3. The wiring is pinned: FcfcApplication.onCreate MUST still call
 *     EmojiData.init — if the call is removed or moved out of onCreate,
 *     this test fails, so the smoke coverage can't silently rot.
 *
 * Nothing is swallowed: any exception thrown during these steps fails the
 * test with the original stack trace.
 */
class StartupSmokeTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun productionAsset(name: String): String {
        val candidates = listOf(
            File("src/main/assets/$name"),        // module dir (Gradle test working dir)
            File("app/src/main/assets/$name"),    // repo/android root fallback
        )
        val f = candidates.firstOrNull { it.isFile }
            ?: error("production asset not found: $name (cwd=${File(".").absolutePath})")
        return f.readText()
    }

    private fun productionSource(rel: String): File {
        val candidates = listOf(
            File("src/main/java/$rel"),           // module dir
            File("app/src/main/java/$rel"),       // repo/android root fallback
        )
        return candidates.firstOrNull { it.isFile }
            ?: error("production source not found: $rel (cwd=${File(".").absolutePath})")
    }

    /**
     * Step 1 of onCreate (runs BEFORE EmojiData, same startup path):
     * I18n.init(this) loads assets/i18n.json and casts the root to a
     * JsonObject — verify the production asset actually has that shape.
     */
    @Test
    fun onCreateStep1I18nAssetParsesAsWebShapedObject() {
        val root = json.parseToJsonElement(productionAsset("i18n.json"))
        assertTrue(
            "i18n.json root must be a JsonObject {en,bn} — got ${root::class.simpleName}",
            root is JsonObject,
        )
        val obj = root as JsonObject
        assertTrue("i18n.json must have 'en' dictionary", obj["en"] is JsonObject)
        assertTrue("i18n.json must have 'bn' dictionary", obj["bn"] is JsonObject)
        assertEquals("en dictionary key count", 364, (obj["en"] as JsonObject).size)
        assertEquals("bn dictionary key count", 364, (obj["bn"] as JsonObject).size)
        // spot-check a real entry the UI renders on the login screen path
        val en = obj["en"] as JsonObject
        val tagline = en["e2eTagline"]
        assertTrue("en.e2eTagline must be a string primitive", tagline is JsonPrimitive && tagline.isString)
    }

    /**
     * Step 2 of onCreate — the crash site: EmojiData.init with the exact
     * production asset contents. Must not throw, must fully initialize.
     */
    @Test
    fun onCreateStep2EmojiDataInitWithProductionDataDoesNotCrash() {
        val catText = productionAsset("emoji_categories.json")
        val animText = productionAsset("anim_emoji.json")

        // The exact call FcfcApplication.onCreate() makes (via ctx.assets).
        EmojiData.init(catText, animText)

        // Fully-initialized state — the picker/renderer depends on all of these.
        assertTrue("categories must be initialized", EmojiData.categories.isNotEmpty())
        assertEquals(5, EmojiData.categories.size)
        assertEquals(712, EmojiData.allEmojis().size)
        assertNotNull("animated map must resolve ❤️", EmojiData.animEmojiUrl("❤️"))
        assertEquals("😀", EmojiData.categories.first().second.first())
    }

    /**
     * Wiring contract: FcfcApplication.onCreate must call EmojiData.init.
     * If this is removed (or moved after UI rendering), startup coverage
     * diverges from the real app and this test fails.
     */
    @Test
    fun fcfcApplicationOnCreateStillCallsEmojiDataInit() {
        val src = productionSource("com/fcfc/app/FcfcApplication.kt").readText()
        val onCreateBody = Regex("override fun onCreate\\(\\)\\s*\\{([\\s\\S]*?)\\n    \\}")
            .find(src)?.groupValues?.get(1)
            assertTrue("FcfcApplication must override onCreate", onCreateBody != null)
        assertTrue(
            "FcfcApplication.onCreate must call EmojiData.init(this) — " +
                "the emoji system (web-parity Apple artwork) is initialized at startup",
            onCreateBody!!.contains("EmojiData.init(this)"),
        )
        // I18n must also be wired before it (startup order parity with the web bundle load)
        val i18nIdx = onCreateBody.indexOf("I18n.init(this)")
        val emojiIdx = onCreateBody.indexOf("EmojiData.init(this)")
        assertTrue("I18n.init must be called in onCreate", i18nIdx >= 0)
        assertTrue("EmojiData.init must come after I18n.init (parity with previous startup order)", emojiIdx > i18nIdx)
    }
}
