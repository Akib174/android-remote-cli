import React from 'react'
import { t, useI18n } from './i18n'

export const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

export const uid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 20)

export const initials = (name = '?') =>
  name.replace(/[^a-zA-Z0-9\u0980-\u09FF]/g, '').slice(0, 2).toUpperCase() || '?'

// সুন্দর, আধুনিক দুই-স্টপ গ্রেডিয়েন্ট — প্রতি ইউজার/গ্রুপে স্থিতিশীলভাবে একটা
// রঙ পড়ে; ইনিশিয়াল-অ্যাভাটারগুলো এখন টেলিগ্রাম/হোয়াটসঅ্যাপ-মার্কা লাগে।
const AV_GRADIENTS: [string, string][] = [
  ['#6366f1', '#a855f7'], // indigo → violet
  ['#f43f5e', '#fb923c'], // rose → orange
  ['#10b981', '#0ea5e9'], // emerald → sky
  ['#3b82f6', '#06b6d4'], // blue → cyan
  ['#f59e0b', '#ef4444'], // amber → red
  ['#8b5cf6', '#ec4899'], // violet → pink
  ['#14b8a6', '#84cc16'], // teal → lime
  ['#0ea5e9', '#8b5cf6'], // sky → violet
  ['#d946ef', '#8b5cf6'], // fuchsia → violet
  ['#22c55e', '#0ea5e9'], // green → sky
]
export function avatarGradient(id: string): [string, string] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AV_GRADIENTS[h % AV_GRADIENTS.length]
}
// পুরনো API রেখে দিলাম (অন্য কোথাও যদি লাগে) — গ্রেডিয়েন্টের প্রথম স্টপ
export function avatarColor(id: string) { return avatarGradient(id)[0] }

function loc(): string { return useI18n.getState().lang === 'bn' ? 'bn-BD' : 'en-US' }

export function fmtTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })
}

export function fmtDay(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return t('today')
  const y = new Date(today.getTime() - 864e5)
  if (d.toDateString() === y.toDateString()) return t('yesterday')
  return d.toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}

export function fmtLastSeen(ts?: number) {
  if (!ts) return t('longAgo')
  const diff = Date.now() - ts
  if (diff < 60_000) return t('justNow')
  if (diff < 3600_000) return t('minAgo', { n: Math.floor(diff / 60_000) })
  if (diff < 864e5) return t('hourAgo', { n: Math.floor(diff / 3600_000) })
  return new Date(ts).toLocaleDateString(loc())
}

export function fmtSize(n = 0) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: any
  return (...args: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}

export const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi

export function extractUrl(text: string): string | null {
  const m = text.match(URL_RE)
  return m ? m[0] : null
}

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

export const MUTE_OPTIONS = [
  { label: '8h', bn: '৮ ঘণ্টা', ms: 8 * 3600_000 },
  { label: '1 day', bn: '১ দিন', ms: 24 * 3600_000 },
  { label: 'Always', bn: 'সবসময়', ms: 3650 * 24 * 3600_000 },
]

// ── রেসপনসিভ ব্রেকপয়েন্ট-হুক (SSR-নিরাপদ) ──
// md (768px) ঊর্ধ্বে ডেস্কটপ-লেআউট — প্রোফাইল-প্যানেলের অ্যানিমেশন-ধরন
// (মোবাইল = ফুল-স্ক্রিন স্লাইড, ডেস্কটপ = Telegram-ওয়েবের মতো width-reveal)
// বেছে নিতে ব্যবহার হয়। রিয়েল-টাইম আপডেট হয় (রিসাইজে)।
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = React.useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false)
  React.useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}
