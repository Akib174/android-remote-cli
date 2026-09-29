package com.fcfc.app.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * fcfc design tokens — ported 1:1 from frontend/src/index.css + tailwind.config.js.
 * See /home/z/my-project/analysis/reports/2-a-ui-forensics.md (authoritative).
 */

data class FcColors(
    // shell
    val body: Color,           // #f1f5f9 / #0b0f1a
    val appShell: Color,       // #ffffff / #0e1220
    val textPrimary: Color,    // #0f172a / #f1f5f9
    val textSecondary: Color,  // slate-500-ish
    val textMuted: Color,      // slate-400
    val divider: Color,
    // brand
    val brand500: Color,       // #3d6ef3
    val brand600: Color,       // #274de8
    val brand300: Color,       // #94b8fc
    // bubbles
    val bubbleOut: Color,      // #e3efff / #2b3a67
    val bubbleIn: Color,       // #ffffff / #1c2333
    val bubbleOutText: Color,
    val bubbleInText: Color,
    val bubbleOutBorder: Color,
    val bubbleInBorder: Color,
    // ticks / status
    val tickRead: Color,       // #0ea5e9 / #38bdf8
    val online: Color,
    // glass
    val glass: Color,          // rgba(255,255,255,.72) / rgba(24,25,30,.74)
    val glassBar: Color,       // rgba(255,255,255,.64) / rgba(23,24,26,.74)
    val glassBorder: Color,
    // misc
    val danger: Color,         // red-500 #ef4444
    val dangerDark: Color,
    val reactionPillBg: Color,
    val reactionPillText: Color,
    val servicePillBg: Color,
    val servicePillText: Color,
    val senderColors: List<Color>,
)

val LightColors = FcColors(
    body = Color(0xFFF1F5F9),
    appShell = Color(0xFFFFFFFF),
    textPrimary = Color(0xFF0F172A),
    textSecondary = Color(0xFF64748B),
    textMuted = Color(0xFF94A3B8),
    divider = Color(0x1A0F172A),
    brand500 = Color(0xFF3D6EF3),
    brand600 = Color(0xFF274DE8),
    brand300 = Color(0xFF94B8FC),
    bubbleOut = Color(0xFFE3EFFF),
    bubbleIn = Color(0xFFFFFFFF),
    bubbleOutText = Color(0xFF0F172A),
    bubbleInText = Color(0xFF0F172A),
    bubbleOutBorder = Color(0x80E2E8F0),
    bubbleInBorder = Color(0x66334155),
    tickRead = Color(0xFF0EA5E9),
    online = Color(0xFF30A46C),
    glass = Color(0xB8FFFFFF),
    glassBar = Color(0xA3FFFFFF),
    glassBorder = Color(0x66FFFFFF),
    danger = Color(0xFFE5484D),
    dangerDark = Color(0xFFE5484D),
    reactionPillBg = Color(0xFFFFFFFF),
    reactionPillText = Color(0xFF334155),
    servicePillBg = Color(0x33818184),
    servicePillText = Color(0xFF334155),
    senderColors = listOf(
        Color(0xFFE5484D), Color(0xFFF76808), Color(0xFF00A2C7), Color(0xFF30A46C),
        Color(0xFF6E56CF), Color(0xFFD6409F), Color(0xFFE93D82), Color(0xFF12A594),
    ),
)

val DarkColors = FcColors(
    body = Color(0xFF0B0F1A),
    appShell = Color(0xFF0E1220),
    textPrimary = Color(0xFFF1F5F9),
    textSecondary = Color(0xFF94A3B8),
    textMuted = Color(0xFF64748B),
    divider = Color(0x1AF1F5F9),
    brand500 = Color(0xFF3D6EF3),
    brand600 = Color(0xFF274DE8),
    brand300 = Color(0xFF94B8FC),
    bubbleOut = Color(0xFF2B3A67),
    bubbleIn = Color(0xFF1C2333),
    bubbleOutText = Color(0xFFF1F5F9),
    bubbleInText = Color(0xFFE2E8F0),
    bubbleOutBorder = Color(0x66334155),
    bubbleInBorder = Color(0x66334155),
    tickRead = Color(0xFF38BDF8),
    online = Color(0xFF30A46C),
    glass = Color(0xBD181A1E),
    glassBar = Color(0xBD17181A),
    glassBorder = Color(0x33FFFFFF),
    danger = Color(0xFFE5484D),
    dangerDark = Color(0xFFFF6369),
    reactionPillBg = Color(0xFF1C2333),
    reactionPillText = Color(0xFFE2E8F0),
    servicePillBg = Color(0x33A1A1AA),
    servicePillText = Color(0xFFA1A1AA),
    senderColors = listOf(
        Color(0xFFE5484D), Color(0xFFF76808), Color(0xFF00A2C7), Color(0xFF30A46C),
        Color(0xFF6E56CF), Color(0xFFD6409F), Color(0xFFE93D82), Color(0xFF12A594),
    ),
)

fun senderColorFor(userId: String, colors: FcColors): Color {
    if (userId.isEmpty()) return colors.senderColors[0]
    var h = 0
    for (c in userId) h = (h * 31 + c.code) and 0x7fffffff
    return colors.senderColors[h % colors.senderColors.size]
}

// Gradients
val BrandGradient = Brush.linearGradient(listOf(Color(0xFF3D6EF3), Color(0xFF7C3AED)))
val LgBtnGradient = Brush.linearGradient(listOf(Color(0xFF7C5CFF), Color(0xFF6366F1), Color(0xFF8B5CF6)))

// Chat background fallbacks (behind wallpaper)
val ChatBgFallbackLight = Brush.verticalGradient(listOf(Color(0xFFE9EEF6), Color(0xFFE9EEF6)))
val ChatBgFallbackDark = Brush.verticalGradient(listOf(Color(0xFF0E1220), Color(0xFF0E1220)))

// ── Radii (px — from tailwind defaults used in source) ─────────────────────
object Radii {
    val xs = 4.dp; val sm = 6.dp; val md = 8.dp; val lg = 12.dp; val xl = 16.dp
    val x2 = 16.dp       // rounded-2xl
    val bubbleTail = 6.dp
    val x3 = 24.dp       // rounded-3xl
    val pill = 999.dp
    val composer = 22.dp
    val authCard = 30.dp
    val lgBtn = 17.dp
    val lgInput = 16.dp
    val lgNav = 18.dp
    val modalCard = 24.dp
}

// ── Key dimensions ─────────────────────────────────────────────────────────
object Dims {
    val sidebarDefault = 380.dp
    val sidebarMin = 68.dp
    val sidebarMax = 520.dp
    val compactThreshold = 116.dp
    val chatRowHeight = 72.dp
    val avatarChatList = 54.dp
    val avatarCompact = 52.dp
    val avatarHeader = 42.dp
    val avatarProfile = 96.dp
    val fab = 56.dp
    val chip = 46.dp
    val bubbleMaxWidthFraction = 0.78f   // mobile; 0.62 desktop
    val emojiSolo = 95.dp
    val sticker = 96.dp
    val pinPadKey = 72.dp
    val sendBtn = 40.dp
    val composerMinH = 42.dp
    val composerMaxH = 120.dp
}

// ── Typography (Inter → system sans; msg 14.5px/1.625) ─────────────────────
object FcType {
    val msgText = TextStyle(fontSize = 14.5.sp, lineHeight = 23.6.sp, fontWeight = FontWeight.Normal)
    val msgMeta = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Normal)
    val listTitle = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    val listPreview = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Normal)
    val listMeta = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium)
    val header = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    val headerSub = TextStyle(fontSize = 12.5.sp, fontWeight = FontWeight.Normal)
    val authH1 = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.Black)
    val authSub = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Normal)
    val lgBtn = TextStyle(fontSize = 15.5.sp, fontWeight = FontWeight.Bold)
    val settingsLabel = TextStyle(fontSize = 14.5.sp, fontWeight = FontWeight.Medium)
    val settingsSub = TextStyle(fontSize = 12.5.sp, fontWeight = FontWeight.Normal)
    val sectionHeader = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
}

private val AppTypography = Typography()

@Composable
fun fcfcTypography(): Typography = AppTypography

/**
 * The fcfc theme: dark follows system unless explicitly set (web default = light
 * for new users, TWallpaper is theme-agnostic).
 */
@Composable
fun fcfcColors(dark: Boolean): FcColors = if (dark) DarkColors else LightColors
