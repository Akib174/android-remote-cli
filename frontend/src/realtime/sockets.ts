// WebSocket ম্যানেজার — প্রতি চ্যাটে আলাদা সকেট (Durable Object) + একটি ইউজার-হাব সকেট।
// অটো-রিকানেক্ট (এক্সপোনেনশিয়াল ব্যাকঅফ) ও সেন্ড-কিউয়িং অন্তর্ভুক্ত।
// প্রতিটি (রি)কানেক্টের আগে ensureFreshToken() — ৫-মিনিটের অ্যাক্সেস-
// টোকেন মৃত হয়ে থাকলে WS 401-লুপে আটকে যেত।
//
// 🩺 ওয়াচডগ (নতুন): লোকাল-ডেভ/প্রক্সি/DO-ইভিকশনে সকেট কখনো **নীরবে** মারা
// যায় — ব্রাউজারের কাছে readyState=OPEN থেকে যায়, onclose আসে না, তাই
// রিকানেক্টও হয় না (হাব-ইভেন্ট চিরকাল আটকে যেত)। এখন:
//  • হাব: প্রতি ৪৫ সেকেন্ডে hb → সার্ভার hb-ack পাঠায়; ৭৫+ সেকেন্ড কিছুই
//    না এলে সকেট মৃত ধরে জোর করে বন্ধ + রিকানেক্ট
//  • চ্যাট-রুম: প্রতি ৪৫ সেকেন্ডে ping → pong; একই নিয়মে ফোর্স-রিকানেক্ট
//    (চ্যাটে অন্য ট্রাফিক এলে সেটাই লাইভনেস প্রমাণ)
import { wsUrl, ensureFreshToken } from '../api/client'

export const handlers = {
  onChat: (_chatId: string, _ev: any) => {},
  onHub: (_ev: any) => {},
  onChatOpen: (_chatId: string) => {},
  onHubOpen: () => {},
}

interface Managed { ws: WebSocket | null; retries: number; want: boolean; outbox: string[]; timer?: any; opening?: boolean; lastRx: number; hb?: any }

const chats = new Map<string, Managed>()
let hub: Managed = { ws: null, retries: 0, want: false, outbox: [], lastRx: 0 }

// লাইভনেস সীমা — এর বেশি সময় কোনো বার্তা না এলে সকেট মৃত বলে বিবেচিত
const STALE_MS = 75_000
const HB_EVERY = 45_000

function backoff(retries: number) {
  return Math.min(15000, 500 * 2 ** Math.min(retries, 5)) + Math.random() * 300
}

export function connectChat(chatId: string) {
  let m = chats.get(chatId)
  if (!m) { m = { ws: null, retries: 0, want: true, outbox: [], lastRx: 0 }; chats.set(chatId, m) }
  m.want = true
  openChatSocket(chatId, m)
}

async function openChatSocket(chatId: string, m: Managed) {
  if (m.ws && (m.ws.readyState === WebSocket.OPEN || m.ws.readyState === WebSocket.CONNECTING)) return
  if (m.opening) return
  m.opening = true
  await ensureFreshToken().catch(() => {})
  try {
    const ws = new WebSocket(wsUrl(`/ws/chat/${chatId}`))
    m.ws = ws
    ws.onopen = () => {
      m!.retries = 0
      m!.lastRx = Date.now()
      handlers.onChatOpen(chatId)
      const queue = m!.outbox.splice(0)
      for (const raw of queue) ws.send(raw)
      // 🩺 লাইভনেস-পিং — সার্ভার pong দেয়; নীরব-মৃত সকেট ধরার জন্য
      clearInterval(m!.hb)
      m!.hb = setInterval(() => {
        if (m!.ws !== ws) { clearInterval(m!.hb); return }
        if (m!.ws.readyState === WebSocket.OPEN) { try { m!.ws.send(JSON.stringify({ t: 'ping' })) } catch {} }
      }, HB_EVERY)
    }
    ws.onmessage = (e) => {
      m!.lastRx = Date.now()
      try { handlers.onChat(chatId, JSON.parse(e.data)) } catch {}
    }
    ws.onclose = (e) => {
      clearInterval(m!.hb)
      m!.ws = null
      // 4003 = রুম থেকে বাদ/সেশন-রিভোক (সার্ভার-সাইড কিক) — আর রিকানেক্ট নয়
      if ((e as CloseEvent).code === 4003) { chats.delete(chatId); return }
      if (m!.want) {
        m!.retries++
        m!.timer = setTimeout(() => openChatSocket(chatId, m!), backoff(m!.retries))
      }
    }
    ws.onerror = () => { try { ws.close() } catch {} }
  } catch {
    m.ws = null
    if (m.want) m.timer = setTimeout(() => openChatSocket(chatId, m), backoff(++m.retries))
  } finally {
    m.opening = false
  }
}

export function disconnectChat(chatId: string) {
  const m = chats.get(chatId)
  if (!m) return
  m.want = false
  clearTimeout(m.timer)
  clearInterval(m.hb)
  try { m.ws?.close() } catch {}
  m.ws = null
  // ⚠️ নীরব মেসেজ-লস ফিক্স: আউটবক্সে কিউ-করা মেসেজ থাকলে এন্ট্রি রেখে দিই —
  // want=false তাই ওয়াচডগ রিকানেক্ট করবে না, কিন্তু পরে একই চ্যাট আবার
  // খুললে (connectChat) onopen-এ কিউ ফ্লাশ হয়ে যাবে। আগে এখানেই ম্যাপ-
  // এন্ট্রি মুছে দিত — বন্ধ-সকেটে পাঠানো মেসেজ চিরকালের জন্য হারিয়ে যেত।
  if (!m.outbox.length) chats.delete(chatId)
}

// ইউজার বদলালে (লগআউট → অন্য অ্যাকাউন্টে লগইন) সব সকেট সাথে সাথে বন্ধ +
// ম্যাপ পরিষ্কার। আগে পুরনো ইউজারের হাব-সকেট খোলা থেকে যেত — নতুন
// ইউজারের সেশনে পুরনো ইউজারের হাব-ইভেন্ট ঢুকে পড়ত (ডেটা-লিক)।
export function resetSockets() {
  disconnectHub()
  for (const id of [...chats.keys()]) disconnectChat(id)
  chats.clear()
  hub = { ws: null, retries: 0, want: false, outbox: [], lastRx: 0 }
}

export function sendChat(chatId: string, obj: any): void {
  const m = chats.get(chatId)
  const raw = JSON.stringify(obj)
  if (m?.ws?.readyState === WebSocket.OPEN) m.ws.send(raw)
  else if (m) m.outbox.push(raw)
}

export function isChatOpen(chatId: string) {
  return chats.get(chatId)?.ws?.readyState === WebSocket.OPEN
}

// ── ইউজার হাব ──
export function connectHub() {
  hub.want = true
  openHub()
}

async function openHub() {
  if (hub.ws && (hub.ws.readyState === WebSocket.OPEN || hub.ws.readyState === WebSocket.CONNECTING)) return
  if (hub.opening) return
  hub.opening = true
  await ensureFreshToken().catch(() => {})
  try {
    const ws = new WebSocket(wsUrl('/ws/user'))
    hub.ws = ws
    ws.onopen = () => {
      hub.retries = 0
      hub.lastRx = Date.now()
      handlers.onHubOpen()
      const queue = hub.outbox.splice(0)
      for (const raw of queue) ws.send(raw)
      // হার্টবিট — প্রেজেন্স ধরে রাখে + সার্ভারের hb-ack লাইভনেস প্রমাণ দেয়
      clearInterval(hub.hb)
      hub.hb = setInterval(() => {
        if (hub.ws !== ws) { clearInterval(hub.hb); return }
        if (hub.ws.readyState === WebSocket.OPEN) { try { hub.ws.send(JSON.stringify({ t: 'hb' })) } catch {} }
      }, HB_EVERY)
    }
    ws.onmessage = (e) => {
      hub.lastRx = Date.now()
      try {
        const msg = JSON.parse(e.data)
        if (msg.t === 'hub') handlers.onHub(msg.event)
      } catch {}
    }
    ws.onclose = (e) => {
      clearInterval(hub.hb)
      hub.ws = null
      // 4001 = ডিভাইস রিভোকড (Telegram-style Decline) — সাথে সাথে লগআউট,
      // রিকানেক্ট-লুপে ভুলে যাওয়ার সুযোগ নেই।
      if ((e as CloseEvent).code === 4001) {
        window.dispatchEvent(new Event('fcfc:force-logout'))
        return
      }
      if (hub.want) { hub.retries++; hub.timer = setTimeout(openHub, backoff(hub.retries)) }
    }
    ws.onerror = () => { try { ws.close() } catch {} }
  } catch {
    if (hub.want) hub.timer = setTimeout(openHub, backoff(++hub.retries))
  } finally {
    hub.opening = false
  }
}

export function disconnectHub() {
  hub.want = false
  clearTimeout(hub.timer)
  clearInterval(hub.hb)
  try { hub.ws?.close() } catch {}
}

export function sendHub(obj: any) {
  const raw = JSON.stringify(obj)
  if (hub.ws?.readyState === WebSocket.OPEN) hub.ws.send(raw)
  else hub.outbox.push(raw)
}

// ── 🩺 ওয়াচডগ — নীরব-মৃত সকেট ধরে ফেলে জোর করে রিকানেক্ট করায় ──
// প্রতি ২০ সেকেন্ডে চেক: চাওয়া-হয়ে-থাকা সকেট কি STALE_MS-এর বেশি সময়
// ধরে কোনো বার্তা দেয়নি (hb-ack/pong/অন্য কিছু)? হ্যাঁ হলে মৃত — বন্ধ করে
// আবার খুলে দিই। ব্যাকগ্রাউন্ড ট্যাবে ব্রাউজার থ্রটলিংয়েও সর্বোচ্চ ~২ মিনিটে
// নিজে থেকেই সেরে যায়।
setInterval(() => {
  const now = Date.now()
  // হাব
  if (hub.want && hub.ws && hub.ws.readyState === WebSocket.OPEN && now - hub.lastRx > STALE_MS) {
    console.warn('[fcfc] hub socket stale — force reconnecting')
    try { hub.ws.onclose = null; hub.ws.close() } catch {}
    hub.ws = null
    openHub()
  } else if (hub.want && !hub.ws && !hub.opening && !hub.timer) {
    openHub() // কোনো কারণে সকেট-ই নেই আর টাইমারও নেই — এখনই খুলি
  }
  // চ্যাট-রুমগুলো
  for (const [chatId, m] of chats) {
    if (!m.want) continue
    if (m.ws && m.ws.readyState === WebSocket.OPEN && now - m.lastRx > STALE_MS) {
      console.warn('[fcfc] chat socket stale — force reconnecting', chatId)
      try { m.ws.onclose = null; m.ws.close() } catch {}
      m.ws = null
      openChatSocket(chatId, m)
    } else if (!m.ws && !m.opening && !m.timer) {
      openChatSocket(chatId, m)
    }
  }
}, 20_000)

// ফোর্স-লগআউট (রিভোকড ডিভাইস/৪০১) — সব সকেট সাথে সাথে বন্ধ।
// নইলে রিভোক করা ডিভাইস চুপচাপ লাইভ ইভেন্ট শুনতে থাকত।
window.addEventListener('fcfc:force-logout', () => {
  resetSockets()
})
