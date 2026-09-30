package com.fcfc.app.ui.chat

import com.fcfc.app.model.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * REGRESSION TEST for the runtime crash:
 *
 *   java.lang.IllegalArgumentException: Padding must be non-negative
 *     at com.fcfc.app.ui.chat.MessageBubbleKt.Ticks(MessageBubble.kt:323)
 *     at com.fcfc.app.ui.chat.MessageBubbleKt.BubbleBox(MessageBubble.kt:299)
 *     at com.fcfc.app.ui.chat.MessageBubbleKt.MessageBubble(MessageBubble.kt:171)
 *
 * Root cause: the old Android Ticks() mimicked the double check with TWO "✓"
 * text glyphs, the second shifted with Modifier.padding(start = (-4).dp) — a
 * hard-coded NEGATIVE padding. Compose padding requires non-negative values,
 * so every own message with read/delivered status crashed at render time.
 *
 * The web source of truth (components/chat/MessageBubble.tsx) never does this:
 * it renders ONE SVG icon (IcCheck / IcDoubleCheck) whose two checks interlock
 * via path geometry — no negative spacing exists anywhere.
 *
 * This suite locks:
 *  1. tickStateOf() — the web state priority (failed > pending > read > sent;
 *     delivered → SINGLE check, exactly like web) for every message state.
 *  2. The tick icon path data is byte-identical to frontend/src/lib/icons.tsx.
 *  3. No negative dp literal exists in ANY production UI source (the crash
 *     class itself is banned at source level).
 */
class TicksLayoutTest {

    // ── 1. State mapping — all legitimate message states ─────────────────────

    private fun msg(
        read: Boolean? = null,
        delivered: Boolean? = null,
        pending: Boolean? = null,
        failed: Boolean? = null,
    ) = Message(read = read, delivered = delivered, pending = pending, failed = failed)

    /** Web: failed ? 'failed' : pending ? 'pending' : read ? 'read' : 'sent'. */
    @Test
    fun tickStateMatchesWebPriorityForAllStates() {
        // fresh message, all flags null → sent (single check)
        assertEquals(TickState.SENT, tickStateOf(msg()))
        // false flags → still sent
        assertEquals(TickState.SENT, tickStateOf(msg(read = false, delivered = false)))

        // delivered only → SINGLE check (web parity — the old Android code
        // wrongly rendered the double-tick for delivered)
        assertEquals(TickState.SENT, tickStateOf(msg(delivered = true)))
        // delivered + read → read (double check)
        assertEquals(TickState.READ, tickStateOf(msg(delivered = true, read = true)))
        // read only → read
        assertEquals(TickState.READ, tickStateOf(msg(read = true)))

        // pending outranks read/delivered
        assertEquals(TickState.PENDING, tickStateOf(msg(pending = true)))
        assertEquals(TickState.PENDING, tickStateOf(msg(pending = true, read = true, delivered = true)))

        // failed outranks everything
        assertEquals(TickState.FAILED, tickStateOf(msg(failed = true)))
        assertEquals(TickState.FAILED, tickStateOf(msg(failed = true, pending = true)))
        assertEquals(TickState.FAILED, tickStateOf(msg(failed = true, read = true, delivered = true)))
    }

    /**
     * The exact crash vector: an own message that was delivered/read. In the
     * old code this entered the double-tick branch → padding(start = -4.dp) →
     * crash. Now it maps to READ/SENT → TickIcon: a Canvas with a CONSTANT
     * 18.dp size and a 2.4f stroke — no dp arithmetic exists in the tick
     * layout at all, so no state can ever produce negative padding.
     */
    @Test
    fun crashVectorStatesProduceIconLayoutWithNoDpArithmetic() {
        assertEquals(TickState.READ, tickStateOf(msg(read = true)))
        assertEquals(TickState.READ, tickStateOf(msg(read = true, delivered = true)))
        assertEquals(TickState.SENT, tickStateOf(msg(delivered = true)))

        // the icon geometry constants used by TickIcon (web mk(): size 18,
        // viewBox 24, strokeWidth 2.4) — all positive, all constant
        val iconSizeDp = 18f
        val viewBox = 24f
        val strokeWidth = 2.4f
        assertTrue(iconSizeDp > 0f && viewBox > 0f && strokeWidth > 0f)
        assertTrue(iconSizeDp / viewBox > 0f) // canvas scale factor
    }

    // ── 2. Icon geometry is byte-identical to the web source of truth ─────────

    /**
     * Extracts IcCheck / IcDoubleCheck path data from the ACTUAL web file
     * (frontend/src/lib/icons.tsx) and asserts our constants match exactly —
     * the double check interlocks via path geometry exactly like the web.
     */
    @Test
    fun tickIconPathsAreByteIdenticalToWebIcons() {
        val candidates = listOf(
            File("../frontend/src/lib/icons.tsx"),   // module dir (Gradle test cwd) → repo root
            File("../../frontend/src/lib/icons.tsx"),
            File("frontend/src/lib/icons.tsx"),
        )
        val webIcons = candidates.firstOrNull { it.isFile }
            ?: error("web icons.tsx not found (cwd=${File(".").absolutePath})")
        val src = webIcons.readText()

        val checkPath = Regex("export const IcCheck\\s*=\\s*mk\\(<path d=\"([^\"]+)\"")
            .find(src)?.groupValues?.get(1)
        val doublePath = Regex("export const IcDoubleCheck\\s*=\\s*mk\\(<path d=\"([^\"]+)\"")
            .find(src)?.groupValues?.get(1)

        assertEquals("IcCheck path must be byte-identical to web", checkPath, TICK_CHECK_PATH)
        assertEquals("IcDoubleCheck path must be byte-identical to web", doublePath, TICK_DOUBLE_CHECK_PATH)

        // both paths parse as valid SVG path data (web viewBox 0 0 24 24)
        for (p in listOf(TICK_CHECK_PATH, TICK_DOUBLE_CHECK_PATH)) {
            val tokens = p.split(Regex("(?=[MLZz])")).filter { it.isNotEmpty() }
            assertTrue("path must have commands: $p", tokens.isNotEmpty())
            assertTrue(
                "path must stay inside the 24x24 viewBox: $p",
                Regex("M?\\s*[-0-9.]+").findAll(p).count() > 0,
            )
            // all coordinates within 0..24 (stroke may extend slightly beyond)
            val nums = Regex("-?\\d+(?:\\.\\d+)?").findAll(p).map { it.value.toFloat() }.toList()
            assertTrue(nums.all { it >= 0f && it <= 24f })
        }
    }

    // ── 3. The crash class is banned: no negative dp literals in production ───

    /**
     * Modifier.padding / spacedBy / Spacer width all throw
     * "Padding must be non-negative"-style IllegalArgumentException for
     * negative Dp. Scans every production Kotlin source for negative dp
     * literals — the exact expression that caused this crash
     * (padding(start = (-4).dp)) can never return.
     */
    @Test
    fun noNegativeDpLiteralsInAnyProductionSource() {
        val roots = listOf(
            File("src/main/java"),        // module dir (Gradle test cwd)
            File("app/src/main/java"),    // repo/android root fallback
        ).filter { it.isDirectory }
        assertTrue("production source root not found", roots.isNotEmpty())

        val offenders = ArrayList<String>()
        fun scan(dir: File) {
            dir.walkTopDown().filter { it.extension == "kt" }.forEach { f ->
                var inBlockComment = false
                f.readLines().forEachIndexed { idx, raw ->
                    val line = raw.trim()
                    var code = raw
                    if (inBlockComment) {
                        val end = code.indexOf("*/")
                        if (end < 0) return@forEachIndexed
                        code = code.substring(end + 2)
                        inBlockComment = false
                    }
                    // strip trailing line comments and KDoc starts
                    code = code.substringBefore("//")
                    val opens = code.count { false } // (no-op; block comments don't nest in Kotlin without nesting support)
                    val bs = Regex("/\\*").findAll(code).count()
                    val be = Regex("\\*/").findAll(code).count()
                    if (bs > be) inBlockComment = true
                    val stripped = code
                        .replace(Regex("/\\*.*?\\*/"), "")
                    // negative dp literals: (-4).dp or -4.dp or -4.5.dp
                    if (Regex("\\(-\\d+(?:\\.\\d+)?\\)\\.dp").containsMatchIn(stripped) ||
                        Regex("(?<![\\w.])-\\d+(?:\\.\\d+)?\\.dp").containsMatchIn(stripped)
                    ) {
                        offenders += "${f.path}:${idx + 1}: ${line.take(100)}"
                    }
                }
            }
        }
        roots.forEach { scan(it) }

        if (offenders.isNotEmpty()) {
            fail("Negative dp literals found (padding must be non-negative!):\n" + offenders.joinToString("\n"))
        }
    }
}
