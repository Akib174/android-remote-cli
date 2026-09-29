// TWallpaper — টেলিগ্রাম-স্টাইল অ্যানিমেটেড ওয়ালপেপার (abc.html-এর কনফিগ)।
// CDN (jsDelivr) থেকে CSS+UMD লোড করে একটাই ইনস্ট্যান্স চালায়; থিম বদলালে
// রঙ-সেট আপডেট হয়। লোড ফেল করলে নীরবে বসে থাকে — তখন অ্যাপের নিজের
// গ্রেডিয়েন্ট ব্যাকগ্রাউন্ডই দেখা যায় (গ্রেসফুল ডিগ্রেডেশন)।
import { useEffect } from 'react'

const CSS_URL = 'https://cdn.jsdelivr.net/npm/twallpaper@2.1.2/dist/style.css'
const JS_URL = 'https://cdn.jsdelivr.net/npm/twallpaper@2.1.2/dist/index.umd.js'

// abc.html-এর হুবহু কনফিগ — লাইট/ডার্ক দুই মোডেই
const LIGHT = {
  fps: 40,
  tails: 90,
  animate: true,
  scrollAnimate: true,
  colors: ['#DBDDBB', '#6BA587', '#D5D88D', '#88B884'],
  pattern: {
    image: 'https://twallpaper.js.org/patterns/beach.svg',
    background: '#000000',
    blur: 0,
    size: '360px',
    opacity: 0.6,
    mask: false,
  },
  screenOverlayOpacity: 0,
}
const DARK = {
  fps: 40,
  tails: 90,
  animate: true,
  scrollAnimate: true,
  colors: ['#5A565D', '#4F5363', '#2A3337', '#29130F'],
  pattern: {
    image: 'https://twallpaper.js.org/patterns/beach.svg',
    background: '#06070b',
    blur: 0,
    size: '360px',
    opacity: 0.6,
    mask: false,
  },
  screenOverlayOpacity: 0,
}

let loading: Promise<any> | null = null

function loadScript(src: string, timeoutMs = 15000): Promise<void> {
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!ok) { try { s.remove() } catch {} }
      ok ? res() : rej(new Error('script load failed'))
    }
    // CDN ধীরে সাড়া দিলে অনন্ত-পেন্ডিং এড়াতে টাইমআউট
    const timer = setTimeout(() => done(false), timeoutMs)
    s.src = src
    s.onload = () => done(true)
    s.onerror = () => done(false)
    document.head.appendChild(s)
  })
}

function ensureLib(): Promise<any> {
  if ((window as any).TWallpaper?.TWallpaper) return Promise.resolve((window as any).TWallpaper)
  if (loading) return loading
  loading = (async () => {
    if (!document.querySelector(`link[href="${CSS_URL}"]`)) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = CSS_URL
      document.head.appendChild(l)
    }
    // দুবার চেষ্টা — CDN-গ্লিচ একবার ফেল করলেই চিরকাল ওয়ালপেপারহীন হয় না
    try {
      await loadScript(JS_URL)
    } catch {
      await new Promise((r) => setTimeout(r, 1500))
      await loadScript(JS_URL)
    }
    return (window as any).TWallpaper
  })().catch((e) => {
    // সম্পূর্ণ ফেল — পরের ডাকে আবার চেষ্টা করার সুযোগ রাখি
    loading = null
    throw e
  })
  return loading
}

let instance: any = null
let instanceEl: HTMLElement | null = null

export async function initWallpaper(el: HTMLElement, dark: boolean) {
  const TW = await ensureLib()
  if (!TW?.TWallpaper) return
  if (instance && instanceEl === el) {
    applyTheme(dark)
    return
  }
  if (instance) { try { instance.dispose() } catch {} instance = null }
  instanceEl = el
  const cfg = dark ? DARK : LIGHT
  instance = new TW.TWallpaper(el, {
    fps: cfg.fps, tails: cfg.tails, animate: cfg.animate,
    scrollAnimate: cfg.scrollAnimate, colors: cfg.colors, pattern: cfg.pattern,
  })
  instance.init()
}

export async function applyTheme(dark: boolean) {
  if (!instance) return
  const cfg = dark ? DARK : LIGHT
  try {
    instance.updateColors(cfg.colors)
    instance.updateFrametime(cfg.fps)
    instance.updateTails(cfg.tails)
    instance.animate(cfg.animate)
    instance.scrollAnimate(cfg.scrollAnimate)
    instance.updatePattern(cfg.pattern)
  } catch {}
}

// রিঅ্যাক্ট-হুক — অ্যাপ-রুটে বসানো; থিম বদলালে কনফিগ রি-অ্যাপ্লাই।
export function useTWallpaper(ref: React.RefObject<HTMLElement | null>, theme: 'light' | 'dark') {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let dead = false
    initWallpaper(el, theme === 'dark').catch(() => {})
    const onTheme = (e: Event) => {
      if (dead) return
      const dark = (e as CustomEvent).detail === 'dark'
      applyTheme(dark).catch(() => {})
    }
    window.addEventListener('fcfc:theme', onTheme)
    return () => { dead = true; window.removeEventListener('fcfc:theme', onTheme) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (ref.current) applyTheme(theme === 'dark').catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])
}
