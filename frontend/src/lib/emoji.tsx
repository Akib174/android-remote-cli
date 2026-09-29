// টেলিগ্রাম/অ্যাপল-স্টাইল ইমোজি artwork সিস্টেম।
// মেসেজ/রিয়্যাকশন/স্টিকার/পিকারে সিস্টেমের ইউনিকোড ইমোজির বদলে
// Apple Color Emoji artwork (emoji-datasource-apple, jsDelivr CDN) দেখায় —
// নেটিভ ইউনিকোড রেন্ডারিং প্ল্যাটফর্মভেদে ভাঙা/সাদাকালো দেখায়।
//
// 🆕 টেলিগ্রাম-অ্যানিমেটেড ইমোজি (একদম Telegram-এর মতো):
// Tarikul-Islam-Anik/Telegram-Animated-Emojis রিপোর ৬৩১টা অ্যানিমেটেড webp
// (Telegram-এর নিজস্ব Lottie ইমোজির webp রূপান্তর) jsDelivr CDN থেকে দেখানো হয়।
// animated মোডে: ইমোজির অ্যানিমেটেড সংস্করণ থাকলে সেটাই দেখায় (লুপ করে —
// Telegram-এর মতোই), না থাকলে স্ট্যাটিক Apple artwork-এ ফলব্যাক।
//
// নাম-রেজলিউশন: ইমোজি ক্যারেক্টার → কোডপয়েন্ট hex জোড়া ("-"): যেমন
// "😀"→1f600, "❤️"→2764-fe0f, ZWJ চেইন → 1f469-200d-1f4bb। CDN-এ কিছু ফাইল
// fe0f-সহ, কিছুটা ছাড়া — তাই ক্যান্ডিডেট-চেইন (exact → fe0f-যোগ → fe0f-বাদ)
// onError ধরে ধরে চেষ্টা করে; সব ফেল করলে নেটিভ ক্যারেক্টারে ফলব্যাক।
import React, { useEffect, useMemo, useReducer, useState } from 'react'
import { cls } from './utils'

const CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.1/img/apple'

// নেটিভ ইউনিকোডে যে ইমোজিগুলো পাওয়া যায় না / ফাইল-নেই — নেগেটিভ ক্যাশ
const deadUrls = new Set<string>()

// ── 🎬 টেলিগ্রাম-অ্যানিমেটেড ইমোজি ম্যাপ (অ্যাসিনক্রোনাস লোড) ──
// animEmojiData.ts (105KB) আলাদা চাঙ্ক — মেইন বান্ডল হালকা রাখতে dynamic
// import-এ নেওয়া হয়। ম্যাপ আসা মাত্র মাউন্ট-করা Emoji কম্পোনেন্টগুলো নিজে
// নিজেই রি-রেন্ডার হয়ে অ্যানিমেটেড webp-তে চলে যায়।
let animMap: Record<string, string> | null = null
const animWaiters = new Set<() => void>()
import('./animEmojiData').then((m) => {
  animMap = m.ANIM_EMOJI_URL
  for (const w of animWaiters) w()
  animWaiters.clear()
}).catch(() => {})

// এই কম্পোনেন্ট মাউন্ট থাকা অবস্থায় ম্যাপ লোড হলে একবার রি-রেন্ডার হয়
function useAnimMapReady(): boolean {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (animMap) return
    animWaiters.add(bump)
    return () => { animWaiters.delete(bump) }
  }, [])
  return !!animMap
}

// ইমোজির অ্যানিমেটেড webp URL — না থাকলে null (fe0f-সহ/বিহীন দুই রূপেই খোঁজা)
export function animEmojiUrl(char: string): string | null {
  if (!animMap) return null
  return animMap[char] || animMap[char.replace(/\uFE0F/g, '')] || null
}

// ── ইমোজি শনাক্তকরণ ──
// keycap (1️⃣), পতাকা (RI জোড়), এবং Extended_Pictographic চেইন (ZWJ + স্কিনটোন সহ)।
const EMOJI_RE = new RegExp(
  '[#*0-9]\\uFE0F?\\u20E3' +
  '|[\\u{1F1E6}-\\u{1F1FF}]{2}' +
  '|\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])*)*',
  'gu',
)

const EXT_PICT_RE = /\p{Extended_Pictographic}/u
const isExtPict = (cp: number) => EXT_PICT_RE.test(String.fromCodePoint(cp))
const hex = (n: number) => n.toString(16)

// একটা ইমোজি সিকোয়েন্সের সম্ভাব্য ফাইল-নামগুলো (ক্যান্ডিডেট)
function candidates(char: string): string[] {
  const cps = Array.from(char).map((c) => c.codePointAt(0)!)
  const exact = cps.map(hex).join('-')
  const out = [exact]
  // fe0f-বিহীন টেক্সট-ডিফল্ট ইমোজি (❤ ☺ ✌ …) — emoji-datasource fe0f-সহ নামে রাখে
  const padded = cps
    .map((cp, i) => {
      const next = cps[i + 1]
      const needs = isExtPict(cp) && cp < 0x1f000
        && next !== undefined && next !== 0xfe0f && next !== 0x20e3 && next !== 0x200d
        && !(next >= 0x1f3fb && next <= 0x1f3ff)
      return needs ? [hex(cp), 'fe0f'] : [hex(cp)]
    })
    .flat()
    .join('-')
  if (padded !== exact) out.push(padded)
  const stripped = cps.filter((c) => c !== 0xfe0f).map(hex).join('-')
  if (stripped !== exact && stripped !== padded) out.push(stripped)
  return out
}

export function emojiUrl(char: string, px = 64): string {
  const name = candidates(char)[0]
  // ⚠️ CDN-এ শুধু 64px আছে — বড় সাইজেও 64px-ই (ব্রাউজার আপস্কেল করে)
  return `${CDN}/64/${name}.png`
}

// টেক্সট → টুকরো (ইমোজি বনাম সাধারণ টেক্সট)
export function splitEmoji(text: string): { em?: string; tx?: string }[] {
  const out: { em?: string; tx?: string }[] = []
  let last = 0
  for (const m of text.matchAll(EMOJI_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push({ tx: text.slice(last, i) })
    out.push({ em: m[0] })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ tx: text.slice(last) })
  return out
}

// একটা ইমোজি — ছবি হিসেবে; সব ক্যান্ডিডেট ফেল করলে নেটিভ গ্লিফ।
// animated=true হলে টেলিগ্রাম-অ্যানিমেটেড webp (লুপ করে, ঠিক Telegram-এর মতো);
// অ্যানিমেটেড সংস্করণ না থাকলে/লোড-ফেল হলে স্ট্যাটিক Apple artwork।
// lazy=true পিকার-গ্রিডের জন্য — ভিউপোর্টে না এলে অ্যানিমেটেড webp-ই লোড হয় না।
export function Emoji({ char, size = 20, className, style, animated = false, lazy = false }: {
  char: string; size?: number; className?: string; style?: React.CSSProperties
  animated?: boolean; lazy?: boolean
}) {
  const list = useMemo(() => candidates(char), [char])
  const [idx, setIdx] = useState(0)
  const [dead, setDead] = useState(false)
  const [animDead, setAnimDead] = useState(false)
  useAnimMapReady()
  const animUrl = animated && !animDead ? animEmojiUrl(char) : null

  // 🎬 টেলিগ্রাম-অ্যানিমেটেড webp — অগ্রাধিকার পায়
  if (animUrl) {
    return (
      <img
        src={animUrl}
        alt={char}
        draggable={false}
        loading={lazy ? 'lazy' : undefined}
        decoding={lazy ? 'async' : undefined}
        className={cls('inline-block object-contain select-none', className)}
        style={{ width: size, height: size, verticalAlign: '-0.16em', ...style }}
        onError={() => { deadUrls.add(animUrl); setAnimDead(true) }}
      />
    )
  }

  if (dead) {
    return <span className={cls('inline-block', className)} style={{ fontSize: size * 0.85, lineHeight: 1, ...style }}>{char}</span>
  }
  const px = 64 // ⚠️ emoji-datasource-apple@15 শুধু 64px ফোল্ডার রাখে — 128/32 ফোল্ডার 404!
  const url = `${CDN}/${px}/${list[idx]}.png`
  return (
    <img
      src={url}
      alt={char}
      draggable={false}
      loading={lazy ? 'lazy' : undefined}
      className={cls('inline-block object-contain select-none', className)}
      style={{ width: size, height: size, verticalAlign: '-0.16em', ...style }}
      onError={() => {
        deadUrls.add(url)
        if (idx + 1 < list.length) setIdx(idx + 1)
        else setDead(true)
      }}
    />
  )
}

// টেক্সটের ভেতরের প্রতিটি ইমোজি Apple artwork হিসেবে।
export function EmojiText({ text, size = 20, className, style }: {
  text?: string; size?: number; className?: string; style?: React.CSSProperties
}) {
  const parts = useMemo(() => (text ? splitEmoji(text) : []), [text])
  if (!text) return null
  return (
    <span className={className} style={style}>
      {parts.map((p, i) =>
        p.em ? <Emoji key={i} char={p.em} size={size} /> : <span key={i}>{p.tx}</span>,
      )}
    </span>
  )
}

// ── একক-ইমোজি মেসেজ শনাক্তকরণ (টেলিগ্রামের মতো) ──
// পুরো বডি = ঠিক একটা ইমোজি + সাদা-স্পেস হলেই সত্য। "hello ❤️" বা "❤️❤️" হলে মিথ্যা।
export function isSingleEmoji(text?: string): string | null {
  if (!text) return null
  const trimmed = text.replace(/[\s\u200d]*$/g, '').replace(/^[\s]*/g, '')
  if (!trimmed) return null
  const parts = splitEmoji(trimmed)
  // splitEmoji খালি টেক্সট-অংশগুলো বাদই দেয় না — খালি tx ফিল্টার করি
  const sig = parts.filter((p) => (p.tx || '').trim().length > 0)
  if (sig.length > 0) return null
  const emojis = parts.map((p) => p.em).filter(Boolean)
  return emojis.length === 1 ? emojis[0]! : null
}

// ── একক-ইমোজি মেসেজ — টেলিগ্রাম-অ্যানিমেটেড (একদম Telegram-এর মতো) ──
//  • ইমোজির টেলিগ্রাম-অ্যানিমেটেড webp থাকলে সেটাই বড় করে দেখায় আর লুপ
//    করে চলতেই থাকে — Telegram নিজেও এভাবেই একক-ইমোজি মেসেজ চালায়।
//    পিকার/লাইক-বাটনও একই অ্যানিমেটেড artwork দেখায় — তাই ক্লিক করা
//    ইমোজি আর বাবলের ইমোজির মধ্যে কোনো "চেহারা বদল" থাকে না।
//  • ইমোজিতে ক্লিক করলে অ্যানিমেশন শুরু থেকে আবার প্লে হয় (key-রিমাউন্ট) —
//    onReplay কলব্যাকের মাধ্যমে রিয়েল-টাইম ইভেন্ট ওপাশেও যায়, ও-পাশেও
//    রিস্টার্ট হয় (উভয় পাশে)।
//  • অ্যানিমেটেড সংস্করণ না থাকা ইমোজির জন্য আগের আচরণ: একই Apple
//    artwork + মাউন্টে ঠিক একবার bounce, ক্লিকে আবার ১-বার।
export function AnimatedEmoji({ char, size = 90, className, style, clickable = true, playSeq = 0, onReplay }: {
  char: string; size?: number; className?: string; style?: React.CSSProperties; clickable?: boolean
  playSeq?: number; onReplay?: () => void
}) {
  useAnimMapReady()
  const animUrl = animEmojiUrl(char)
  // 🎬 অ্যানিমেটেড webp — playSeq বদলালে key বদলায় → <img> রি-মাউন্ট →
  // অ্যানিমেশন ফ্রেম-০ থেকে আবার শুরু (দুই পাশেই)
  const img = animUrl ? (
    <img
      key={playSeq}
      src={animUrl}
      alt={char}
      draggable={false}
      className={cls('inline-block object-contain select-none', className)}
      style={{ width: size, height: size, ...style }}
    />
  ) : (
    <span key={playSeq} className="solo-emoji-play inline-flex">
      <Emoji char={char} size={size} className={className} style={style} />
    </span>
  )
  if (!clickable) return img
  return (
    <span
      onClick={(e) => { e.stopPropagation(); onReplay?.() }}
      className="cursor-pointer inline-flex select-none"
      title="Click to play"
    >
      {img}
    </span>
  )
}

// টেলিগ্রামের ডিফল্ট রিয়্যাকশন-সেট (কুইক-বার ও মেনু-স্ট্রিপে)
export const REACTIONS = ['👍', '👎', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '😅', '🥳']

// কম্পোজার পিকার — ক্যাটাগরিভিত্তিক তালিকা
export const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: 'Smileys & People',
    emojis: '😀 😁 😂 🤣 😊 😍 🥰 😘 😎 🤩 🥳 😅 😉 🙃 😇 🙂 😌 😋 🤤 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 😐 😑 😶 🙄 😏 😣 😥 😮 🤐 😯 😪 😫 🥱 😴 😛 😒 😓 😔 😕 🙁 😞 😤 😢 😭 😦 😧 😨 😩 🤯 😬 😰 😱 🥵 🥶 😳 😵 🥴 😠 😡 🤬 🤒 🤕 🤢 🤮 🥺 😷 🤧 💀 👻 👽 🤖 💩 😺 🙈 🙉 🙊 💋 💌 💘 💝 💖 💗 💓 💞 💕 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💯 💢 💥 💫 💦 💨 👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🦾 💄 🔥 ⭐ ✨ 🌈 ☀️ 🌙 ⚡ ❄️ 🎉 🎊 🎁 🎂 🍰 🍕 🍔 🍟 🌮 ☕ 🍵 🥤 ⚽ 🏀 🏆 🎮 🎵 🎶 🎤 🎧 📸 📱 💻 ⌚ 🔒 🔑 💡 📌 📎 ✅ ❌ ⚠️ ❓ ❗'.split(' '),
  },
  {
    label: 'Animals & Nature',
    emojis: '🐶 🐺 🐱 🦁 🐯 🦊 🐻 🐼 🐨 🐹 🐰 🦄 🐝 🦋 🐢 🐬 🐳 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦏 🐪 🦒 🐁 🐂 🐄 🐎 🐖 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🐓 🦃 🦚 🦜 🦢 🕊️ 🐇 🦝 🦨 🦡 🦦 🦥 🐁 🐀 🦔 🌸 🌺 🌻 🌵 🌲 🍀 🍁 🍄 🌴 🌱 🌿 ☘️ 🌾 💐 🌷 🌼 🪴 🌞 🌝 🌚 🌙 ⭐ 🌟 ✨ ⚡ ☄️ 💫 🌈 ☁️ ⛅ 🌊 💧'.split(' '),
  },
  {
    label: 'Food & Drink',
    emojis: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🥘 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🍵 🧃 🥤 🧋 🍺 🍻 🥂 🍷 🥃 🍸 🍹'.split(' '),
  },
  {
    label: 'Activity & Travel',
    emojis: '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🥅 🏒 🏑 🥍 🏏 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏋️ 🤼 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚵 🚴 🏆 🥇 🥈 🥉 🏅 🎖️ 🏵️ 🎗️ 🎫 🎟️ 🎪 🤹 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩 🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🛴 🚲 🛵 🏍️ 🛺 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🪝 ⛽ 🚧 🚦 🚥 🗺️ 🗿 🗽 🗼 🏰 🏯 🎠 🎡 🎢'.split(' '),
  },
  {
    label: 'Objects & Symbols',
    emojis: '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💽 💾 💿 📀 🧮 🎥 📷 📸 📹 📼 🔍 🔎 🕯️ 💡 🔦 🏮 📔 📕 📖 📗 📘 📙 📚 📖 📓 📒 📃 📜 📄 📰 🗞️ 📑 🔖 🏷️ 💰 🪙 💴 💵 💶 💷 💸 💳 🧾 ✉️ 📧 📨 📩 📤 📥 📦 📫 📪 📬 📭 📮 🗳️ ✏️ ✒️ 🖋️ 🖊️ 🖌️ 🖍️ 📝 💼 📁 📂 🗂️ 📅 📆 🗒️ 🗓️ 📇 📈 📉 📊 📋 📌 📍 📎 🖇️ 📏 📐 ✂️ 🗃️ 🗄️ 🗑️ 🔒 🔓 🔏 🔐 🔑 🗝️ 🔨 🪓 ⛏️ ⚒️ 🛠️ 🗡️ ⚔️ 🔫 🏹 🛡️ 🔧 🔩 ⚙️ 🗜️ ⚖️ 🦯 🔗 ⛓️ 🪤 🧰 🧲 🪜 ⚗️ 🧪 🧫 🧬 🔬 🔭 📡 💉 💊 🩸 🩹 🩺 🩻 🚪 🛏️ 🛋️ 🪑 🚽 🪠 🚰 🚿 🛁 🪥 🪒 🧴 🧹 🧺 🧻 🧼 🧽 🧯 🛒 🚬 ⚰️ 🗿 🪦 🏺 🔮 📿 🧿 💈 ⚗️ 🔭 🎎 🎏 🎐 🎎 🧸 🪆 🎁 🎈 🎉 🎊 🎗️ 🎀 🎗️ ✅ ❌ ❗ ❓ 💯 🔥 ✨ 🌟 💫 ⚡ ☄️ 💥 💢 🌈'.split(' '),
  },
]

// পিকারের সব ইমোজির ফ্ল্যাট তালিকা (পুরনো EMOJIS API-এর মতোই)
export const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis)

// ── সাম্প্রতিক/প্রায়ই ব্যবহৃত ইমোজি (টেলিগ্রামের "Recent") ──
// পাঠানো মেসেজ/স্টিকার/পিকার-পিক থেকে গণনা জমে (localStorage), পিকার
// খুললে সবার উপরে "Recent" সেকশনে সাজানো-ক্রমে দেখায়।
const RECENT_KEY = 'fcfc.emojiRecent'
const RECENT_MAX = 24

function loadCounts(): Record<string, number> {
  try {
    const o = JSON.parse(localStorage.getItem(RECENT_KEY) || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch { return {} }
}

export function getRecentEmojis(): string[] {
  const counts = loadCounts()
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e)
    .filter((e) => ALL_EMOJIS.includes(e))
    .slice(0, RECENT_MAX)
}

// টেক্সটে যত ইমোজি আছে সবার কাউন্ট বাড়াই (স্টিকার/একক পিকেও কাজ করে)
export function bumpEmojis(text: string) {
  if (!text) return
  const known = new Set(ALL_EMOJIS)
  const found = splitEmoji(text).map((p) => p.em).filter((e): e is string => !!e && known.has(e))
  if (!found.length) return
  const counts = loadCounts()
  for (const f of found) counts[f] = (counts[f] || 0) + 1
  // ক্যাপ — অচল এন্ট্রি জমে না
  const keys = Object.keys(counts)
  if (keys.length > 200) {
    for (const k of keys.sort((a, b) => counts[a] - counts[b]).slice(0, keys.length - 200)) delete counts[k]
  }
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(counts)) } catch {}
}

// স্টিকার-সেট (বড় ইমোজি artwork হিসেবে পাঠানো যায়)
export const STICKER_SET = '🐱 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🦁 🐯 🐶 🐺 🦊 🐻 🐼 🐨 🐹 🐰 🦄 🐝 🦋 🐢 🐬 🐳 🦖 🌸 🌺 🌻 🌵 🌲 🍀 🍁 🍄 🌙 ⭐ 💫 ✨ 🎈 🎉 🎊 🎂 🍭 🍩 🍪 🧁 🍫 ☕ 🧋 🥤 🍜 🍣 🍕 🍔 🍟 🌶️ 🥑 ⚡ 🌈 🔥 💧 ❄️ 🎮 🎲 🎯 🎸 🥁 🎻 🚀 ✈️ 🚗 ⚽ 🏀 🏆 💪 👑 💎 🧿 🎁 💌'.split(' ')
