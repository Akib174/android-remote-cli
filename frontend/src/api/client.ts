// HTTP API ক্লায়েন্ট — টোকেন ম্যানেজমেন্ট, অটো-রিফ্রেশ।
// ডোমেইন কোথাও হার্ডকোড নেই; `VITE_API_BASE` এনভ থেকে আসে।
export const API_BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
export const WS_BASE = API_BASE.replace(/^http/, 'ws')

type Toks = { access: string; refresh: string }

export function getTokens(): Toks | null {
  try {
    const raw = localStorage.getItem('fcfc.toks')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
export function setTokens(t: Toks | null) {
  if (!t) localStorage.removeItem('fcfc.toks')
  else localStorage.setItem('fcfc.toks', JSON.stringify(t))
}
export function accessToken() { return getTokens()?.access || '' }

// আমার ডিভাইস-আইডি — অ্যাক্সেস টোকেনের `did` ক্লেইম থেকে পাওয়া
// (রিফ্রেশের পরেও সবসময় সঠিক থাকে)। Telegram-style Decline-এ "আমার
// সেশনই কি রিভোক হলো" — সেটা যাচাই করতে লাগে।
export function deviceId(): string {
  try {
    const t = accessToken()
    if (!t) return ''
    const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.did || ''
  } catch { return '' }
}

let refreshing: Promise<boolean> | null = null
async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const t = getTokens()
    if (!t?.refresh) return false
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh: t.refresh }),
      })
      if (!res.ok) return false
      const j = await res.json()
      setTokens({ access: j.access, refresh: t.refresh })
      return true
    } catch { return false }
    finally { refreshing = null }
  })()
  return refreshing
}

// WebSocket-কানেকশনের আগে অ্যাক্সেস-টোকেন প্রায়-মেয়াদোত্তীর্ণ কি না দেখে
// রিফ্রেশ। REST api() 401-পেলে নিজেই রিফ্রেশ করে, কিন্তু WS-URL বানানোর
// সময় কেউ রিফ্রেশ করত না — ৫-মিনিটের অ্যাক্সেস-টোকেন নিয়ে রিকানেক্ট
// চালালে সার্ভার 401 দিত, আর ক্লায়েন্ট ব্যাক-অফে বারবার একই মৃত টোকেন
// দিয়ে চেষ্টা করত (401-লুপ) — লাইভ মেসেজ/নোটিফিকেশন চিরকাল বন্ধ।
let lastFreshTry = 0
export async function ensureFreshToken(): Promise<void> {
  const toks = getTokens()
  if (!toks?.access) return
  let exp = 0
  try {
    const payload = JSON.parse(atob(toks.access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    exp = (payload.exp || 0) * 1000
  } catch { return }
  if (exp - Date.now() > 30_000) return // এখনো ৩০ সেকেন্ড+ বাকি — ঠিক আছে
  if (Date.now() - lastFreshTry < 5000) return // থ্রটল
  lastFreshTry = Date.now()
  await tryRefresh()
}

export interface ApiOpts {
  method?: string
  body?: any
  raw?: boolean
  noAuth?: boolean
  headers?: Record<string, string>
  signal?: AbortSignal
}

export async function api<T = any>(path: string, opts: ApiOpts = {}): Promise<T> {
  // অ্যাক্সেস-টোকেন প্রায়-মেয়াদোত্তীর্ণ হলে আগেই রিফ্রেশ — নইলে ৫ মিনিট
  // পার হলে প্রথম রিকোয়েস্টটা ৪০১ খেয়ে তারপর রিট্রাই হতো (নেটওয়ার্ক-লগে
  // ৪০১→২০০ প্যাটার্ন, মিডিয়া-আপলোডেও একই)।
  if (!opts.noAuth) await ensureFreshToken().catch(() => {})
  const doFetch = async () => {
    const headers: Record<string, string> = { ...(opts.headers || {}) }
    if (opts.body !== undefined && !(opts.body instanceof Blob) && !(opts.body instanceof ArrayBuffer)) {
      headers['content-type'] = 'application/json'
    }
    if (!opts.noAuth) {
      const t = accessToken()
      if (t) headers['authorization'] = `Bearer ${t}`
    }
    return fetch(`${API_BASE}${path}`, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      signal: opts.signal,
      body: opts.body !== undefined
        ? (opts.body instanceof Blob || opts.body instanceof ArrayBuffer ? opts.body : JSON.stringify(opts.body))
        : undefined,
    })
  }

  let res = await doFetch()
  if (res.status === 401 && !opts.noAuth) {
    if (await tryRefresh()) res = await doFetch()
    else { window.dispatchEvent(new Event('fcfc:force-logout')); throw new Error('unauthorized') }
  }
  if (opts.raw) return res as unknown as T
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(e.error || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// মিডিয়া কী-তে `/` থাকে (files/<uid>/xxx) — পুরো কী একসাথে encodeURIComponent
// করলে স্ল্যাশ `%2F` হয়ে যায় আর সার্ভারের রুট ম্যাচ করে না (404)।
// তাই প্রতিটি সেগমেন্ট আলাদা করে এনকোড করি, স্ল্যাশ যথাস্থানে থাকে।
export const mediaPath = (key: string) => key.split('/').map(encodeURIComponent).join('/')

export const mediaUrl = (key?: string) =>
  key ? `${API_BASE}/media/${mediaPath(key)}?token=${encodeURIComponent(accessToken())}` : ''

export const wsUrl = (path: string) => `${WS_BASE}${path}?token=${encodeURIComponent(accessToken())}`
