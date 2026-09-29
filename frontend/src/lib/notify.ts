// লোকাল/পুশ নোটিফিকেশন হেল্পার + নোটিফিকেশন সাউন্ড (সিন্থেসাইজড পিং)।
import type { Chat, Message } from '../types'
import { useChats } from '../stores/chats'
import { t } from '../lib/i18n'

export function chatTitle(c: Chat): string {
  // 📌 Saved Messages — নিজের সাথে self-chat (Telegram-স্টাইল)
  if (c.saved) return t('savedChatTitle')
  if (c.kind === 'group') return c.title || t('groupFallback')
  // 🆕 ডিসপ্লে-নেম থাকলে সেটাই (না থাকলে username) — চ্যাটে নাম হিসেবে দেখায়
  return c.peer?.deleted ? t('deletedAccount') : c.peer?.name || c.peer?.username || t('chatFallback')
}

export function notifyMessage(chat: Chat, msg: Message) {
  try {
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    // অ্যাপ ফোকাসে ও একই চ্যাট খোলা থাকলে ট্রে-তে দেখানোর দরকার নেই।
    // (অ্যাপটি হ্যাশ-ভিত্তিক — আগে location.search দেখা হতো, যা কখনোই ম্যাচ করত না)
    if (document.hasFocus() && useChats.getState().activeChatId === msg.chatId) return
    const title = chatTitle(chat)
    const body = msg.body || t('encryptedMsgBody')
    new Notification(title, {
      body: body.slice(0, 120),
      tag: `msg-${msg.id}`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { chatId: msg.chatId },
    })
  } catch {}
}

export async function requestNotifyPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'default') await Notification.requestPermission()
  return Notification.permission === 'granted'
}

let audioCtx: AudioContext | null = null
// অটোপ্লে-পলিসি: AudioContext প্রথম ইনকামিং মেসেজে (ইউজার-জেসচার ছাড়া)
// তৈরি হলে "suspended" থেকে যায় — পিং নীরব থাকত। প্রথম ইন্টারঅ্যাকশনে আনলক।
try {
  const unlock = () => {
    try {
      audioCtx = audioCtx || new AudioContext()
      void audioCtx.resume()
    } catch {}
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
} catch {}

export function playPing() {
  try {
    audioCtx = audioCtx || new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const t = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t)
    osc.frequency.exponentialRampToValueAtTime(1318, t + 0.08)
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    osc.connect(gain).connect(audioCtx.destination)
    osc.start(t)
    osc.stop(t + 0.4)
  } catch {}
}

// ── 🔴 লাল-ভয়েস অটো-প্লে (Web-Audio পাথ) ─────────────────────────
// পিং/রিংটোনের মতোই আনলকড AudioContext দিয়ে বাজানো হয়। নতুন
// new Audio(url).play() ব্রাউজারের অটোপ্লে-পলিসিতে ব্লক হয়
// (NotAllowedError) — ব্যাকগ্রাউন্ড ট্যাব/লকড ফোন/নতুন লোডে
// পিয়ারের কোনো রিসেন্ট-জেসচার না থাকলে সাউন্ডই আসত না। আনলকড
// AudioContext দিয়ে decodeAudioData + BufferSource চালালে জেসচার
// ছাড়াই বাজে (প্রথম টাচে উপরের unlock-লিসেনার ctx চালু করে রাখে)।
export function getAudioCtx(): AudioContext | null {
  try {
    audioCtx = audioCtx || new AudioContext()
    return audioCtx
  } catch { return null }
}

let curVoiceSrc: AudioBufferSourceNode | null = null

// চলমান অটো-ভয়েস থামানো (নতুন লাল-ভয়েস এলে আগেরটা বন্ধ — ওভারল্যাপ এড়াতে)
export function stopVoicePlayback() {
  try { curVoiceSrc?.stop() } catch {}
  curVoiceSrc = null
}

// url (blob:) কে আনলকড AudioContext দিয়ে বাজায়। সফল হলে true।
// ctx না খোলা/suspended হলে false — কলার তখন <audio> ফলব্যাকে যাবে।
export async function playVoiceThroughCtx(url: string): Promise<boolean> {
  try {
    const ctx = getAudioCtx()
    if (!ctx || ctx.state !== 'running') return false
    const buf = await (await fetch(url)).arrayBuffer()
    // নতুন প্রমিজ-ভার্সন + পুরনো Safari-র কলব্যাক-ভার্সন দুটোই ধরা হলো
    const decoded: AudioBuffer = await new Promise((res, rej) => {
      try {
        const p: any = (ctx as any).decodeAudioData(buf, res, rej)
        if (p && typeof p.then === 'function') p.then(res, rej)
      } catch (e) { rej(e) }
    })
    stopVoicePlayback()
    const src = ctx.createBufferSource()
    const gain = ctx.createGain()
    gain.gain.value = 1
    src.buffer = decoded
    src.connect(gain).connect(ctx.destination)
    src.start()
    curVoiceSrc = src
    src.onended = () => { if (curVoiceSrc === src) curVoiceSrc = null }
    return true
  } catch { return false }
}

// ── ইনকামিং-কল রিংটোন (ক্লাসিক ফোন-রিং, সিন্থেসাইজড) ──
// দুই-বার্স্ট ডুয়াল-টোন → বিরতি → লুপ। stop() না ডাকলে চলতেই থাকে।
function ringBurst(ctx: AudioContext, at: number) {
  const gain = ctx.createGain()
  gain.connect(ctx.destination)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(0.22, at + 0.04)
  gain.gain.setValueAtTime(0.22, at + 0.34)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42)
  for (const f of [697, 941]) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = f
    osc.connect(gain)
    osc.start(at)
    osc.stop(at + 0.45)
  }
}

export function startRingtone(): () => void {
  let stopped = false
  let vibrateTimer: any = null
  try {
    audioCtx = audioCtx || new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const ctx = audioCtx
    const loop = () => {
      if (stopped) return
      const t = ctx.currentTime + 0.05
      ringBurst(ctx, t)
      ringBurst(ctx, t + 0.9)
    }
    loop()
    const timer = setInterval(loop, 2600)
    // মোবাইলে ভাইব্রেশন-ও (যেখানে সাপোর্টেড)
    try {
      if (navigator.vibrate) {
        navigator.vibrate([500, 200, 500, 1400])
        vibrateTimer = setInterval(() => { if (!stopped) navigator.vibrate([500, 200, 500, 1400]) }, 2600)
      }
    } catch {}
    return () => {
      stopped = true
      clearInterval(timer)
      if (vibrateTimer) clearInterval(vibrateTimer)
      try { navigator.vibrate(0) } catch {}
    }
  } catch {
    return () => {}
  }
}
