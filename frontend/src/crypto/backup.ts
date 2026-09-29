// পাসওয়ার্ড-ডিরাইভড কী-ব্যাকআপ (মাল্টি-ডিভাইস রিস্টোর)।
// পাসওয়ার্ড থেকে PBKDF2 (600k) দিয়ে কী ডেরাইভ → প্রাইভেট কী বান্ডিল
// ক্লায়েন্ট-সাইডে এনক্রিপ্ট → এনক্রিপ্টেড ব্লব সার্ভারে। সার্ভার কখনো
// ডিক্রিপ্ট করতে পারে না; পাসওয়ার্ড হারালে ব্লব উদ্ধার অসম্ভব।
//
// ⚠️ আগের ভার্সনের মূল সমস্যা: ব্যাকআপ হতো শুধু সাইনআপ/লগইনের মুহূর্তে —
// তার পরে তৈরি হওয়া র‍্যামচেট-সেশন বা ডিক্রিপ্ট করা মেসেজ-ক্যাশ কখনোই
// ব্যাকআপে ঢুকত না। নতুন ফোনে লগইন করলে সেশন-একেবারে-শূন্য অবস্থায়
// রিস্টোর হতো → পুরো চ্যাট-ইতিহাস "no session and no handshake" এররে
// উধাও — ব্যবহারকারী দেখত খালি চ্যাট। এখন:
//   • ব্যাকআপে messages/starred/meta-ও থাকে (ডিক্রিপ্ট করা ক্যাশ —
//     নতুন ডিভাইসে ইতিহাস ক্যাশ-থেকেই রেন্ডার হয়, রি-ডিক্রিপ্ট লাগে না)
//   • সেশন/মেসেজ বদলালে "dirty" ফ্ল্যাগ উঠে ৬ সেকেন্ডের মধ্যেই
//     ডিবাউন্সড কুইক-সিঙ্ক (আগে ৪৫ সেকেন্ড — নতুন ফোনে লগইন করলে
//     শেষ কয়েকটা মেসেজ ব্যাকআপে না-ঢুকে থাকত) + ৪৫-সেকেন্ড ফলব্যাক
//   • 🆕 দুটো কপি: পাসওয়ার্ড-ব্লব + পাসকোড-ব্লব — user-ID+পাসকোড
//     লগইনেও নতুন ডিভাইসে রিস্টোর হয় (পাসওয়ার্ড ছাড়াই)
//   • 🆕 স্মার্ট-মার্জ: লোকাল ডেটা পুরনো কিন্তু রিমোট ব্যাকআপ তাজা হলে
//     (অন্য ডিভাইস থেকে সিঙ্ক হয়েছে) রিমোট-টাই লোকালে বসে যায় — আগে
//     লগইন করলেই লোকালের পুরনো স্ন্যাপশট **রিমোটকে মুছে দিত** (ফোনে
//     পিয়ারের মেসেজ উধাও হওয়ার আসল কারণ)
import { idb } from '../lib/db'
import { api } from '../api/client'
import { b64u, b64uToBytes } from '../lib/utils'

const ITER = 600_000
// ব্যাকআপে সর্বশেষ কতগুলো মেসেজ-ক্যাশ রাখা হবে — ব্লব-সাইজ সীমিত রাখতে
const MAX_BACKUP_MESSAGES = 3000

async function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITER },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function collectBundle(): Promise<string> {
  const stores = ['keys', 'sessions', 'senderKeys', 'starred', 'meta']
  const dump: Record<string, any> = {}
  for (const s of stores) {
    const entries: Record<string, any> = {}
    for (const k of await idb.allKeys(s)) entries[String(k)] = await idb.get(s, k)
    dump[s] = entries
  }
  // মেসেজ-ক্যাশ: পুরোটা নয় — সর্বশেষ MAX_BACKUP_MESSAGES-টা (ts-অনুসারে)
  {
    const all = await idb.all<any>('messages')
    const recent = (all || []).filter((m) => m && typeof m.ts === 'number').sort((a, b) => b.ts - a.ts).slice(0, MAX_BACKUP_MESSAGES)
    const entries: Record<string, any> = {}
    for (const m of recent) entries[String(m.id)] = m
    dump.messages = entries
  }
  return JSON.stringify(dump)
}

async function encryptBundle(secret: string, bundle: string): Promise<{ blob: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(secret, salt)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource }, key,
    new TextEncoder().encode(bundle) as BufferSource,
  )
  // layout: iv(12) || ciphertext
  const combined = new Uint8Array(12 + ct.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ct), 12)
  return { blob: b64u(combined), salt: b64u(salt) }
}

async function decryptBundle(secret: string, blob: string, saltB64: string): Promise<any | null> {
  try {
    const key = await deriveKey(secret, b64uToBytes(saltB64))
    const data = b64uToBytes(blob)
    const iv = data.slice(0, 12)
    const ct = data.slice(12)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource)
    return JSON.parse(new TextDecoder().decode(plain))
  } catch {
    return null
  }
}

export async function createBackup(password: string): Promise<{ blob: string; salt: string }> {
  return encryptBundle(password, await collectBundle())
}

// 🆕 পাসকোড-ব্লব — একই বান্ডল, পাসকোড-ডিরাইভড কী দিয়ে এনক্রিপ্টেড
export async function createPinBackup(passcode: string): Promise<{ blob: string; salt: string }> {
  return encryptBundle('fcfc-pin:' + passcode, await collectBundle())
}

export async function restoreBackup(password: string, blob: string, saltB64: string): Promise<boolean> {
  const dump = await decryptBundle(password, blob, saltB64)
  if (!dump) return false
  await writeDump(dump)
  return true
}

// 🆕 পাসকোড-ব্লব থেকে রিস্টোর
export async function restorePinBackup(passcode: string, blob: string, saltB64: string): Promise<boolean> {
  const dump = await decryptBundle('fcfc-pin:' + passcode, blob, saltB64)
  if (!dump) return false
  await writeDump(dump)
  return true
}

// 🆕 ডাম্প (ব্যাকআপের ভেতরের স্টোর-ম্যাপ) idb-তে লেখে
export async function writeDump(dump: Record<string, any>): Promise<void> {
  for (const [store, entries] of Object.entries<any>(dump)) {
    for (const [k, v] of Object.entries(entries)) {
      await idb.put(store, k, v)
    }
  }
}

// 🆕 ডাম্পের তাজাত্বার মাপকাঠি — সর্বশেষ মেসেজের ts (বান্ডল-টাইমস্ট্যাম্প নয়,
// কারণ ব্যাকআপ বানানোর সময় আর মেসেজ-অর্ডার আলাদা হতে পারে)
export function dumpFreshness(dump: any): number {
  try {
    let max = 0
    for (const m of Object.values<any>(dump?.messages || {})) {
      if (m && typeof m.ts === 'number' && m.ts > max) max = m.ts
    }
    return max
  } catch { return 0 }
}

async function localFreshness(): Promise<number> {
  try {
    const all = await idb.all<any>('messages')
    let max = 0
    for (const m of all || []) if (m && typeof m.ts === 'number' && m.ts > max) max = m.ts
    return max
  } catch { return 0 }
}

// 🆕 স্মার্ট-মার্জ: রিমোট ব্যাকআপ (পাসওয়ার্ড/পাসকোড যেটা দিয়ে খোলা যায়)
// লোকালের চেয়ে তাজা হলে লোকালে বসিয়ে দেয়। ফেরত: কিছু বসেছে কিনা।
// (লোকাল তাজা হলে কিছু হয় না — সার্ভারে পরের সিঙ্কেই লোকাল উঠে যায়।)
// 🆕 দুটো ব্লবের মধ্যে **তাজাটা** বেছে নেয় — এক ডিভাইস পাসওয়ার্ড-সিঙ্ক,
// আরেকটা (রিলোড-করা/পিন-লগইন) পিন-সিঙ্ক করলে দুটোর তাজাত্ব আলাদা হয়।
export async function mergeRemoteIfFresher(password: string | null, passcode: string | null): Promise<boolean> {
  try {
    const remote = await api('/me/backup').catch(() => null)
    if (!remote) return false
    let best: any = null
    let bestTs = -1
    if (remote.blob && password) {
      const d = await decryptBundle(password, remote.blob, remote.salt)
      if (d) { const ts = dumpFreshness(d); if (ts > bestTs) { bestTs = ts; best = d } }
    }
    if (remote.pinBlob && passcode) {
      const d = await decryptBundle('fcfc-pin:' + passcode, remote.pinBlob, remote.pinSalt)
      if (d) { const ts = dumpFreshness(d); if (ts > bestTs) { bestTs = ts; best = d } }
    }
    if (!best) return false
    const localTs = await localFreshness()
    if (bestTs <= localTs) return false
    await writeDump(best)
    return true
  } catch {
    return false
  }
}

// সাইনআপ/লগইনের পর কল করা হয়: লোকাল কী থাকলে আপলোড, না থাকলে রিস্টোরের চেষ্টা
export async function syncBackup(password: string, passcode?: string) {
  const remote = await api('/me/backup')
  const hasLocal = !!(await idb.get('keys', 'identity'))
  if (hasLocal) {
    const bundle = await collectBundle()
    const { blob, salt } = await encryptBundle(password, bundle)
    // 🆕 পাসকোড: আর্গুমেন্টে দেওয়া হলে সেটাই, নইলে লোকাল-সেভ-করাটা
    let pin: string | null = passcode || null
    if (!pin) pin = await getStoredPasscode()
    let pinBlob: string | undefined
    let pinSalt: string | undefined
    if (pin) {
      const pb = await encryptBundle('fcfc-pin:' + pin, bundle)
      pinBlob = pb.blob
      pinSalt = pb.salt
    }
    await api('/me/backup', { method: 'PUT', body: { blob, salt, pinBlob, pinSalt } })
    return 'uploaded'
  }
  if (remote?.blob) {
    const ok = await restoreBackup(password, remote.blob, remote.salt)
    return ok ? 'restored' : 'failed'
  }
  return 'none'
}

// 🆕 শুধু-পিন আপলোড (পিন-লগইনের পর) — সার্ভার মূল পাসওয়ার্ড-ব্লব
// অক্ষত রেখে শুধু pin_blob/pin_salt ফিল্ড আপডেট করে
export async function syncPinBackup(passcode: string) {
  const hasLocal = !!(await idb.get('keys', 'identity'))
  if (!hasLocal) return 'none'
  const { blob, salt } = await createPinBackup(passcode)
  await api('/me/backup', { method: 'PUT', body: { pinBlob: blob, pinSalt: salt } })
  return 'uploaded'
}

// ── 🆕 পাসকোড লোকালি (idb meta) — পিন-ব্যাকআপ তাজা রাখতে ──
// ⚠️ ডিভাইসে প্রাইভেট-কী-ই প্লেইনটেক্সট idb-তে থাকে — পাসকোড পাশে রাখা
// নিরাপত্তাহানিকারক নয় (যে ডিভাইস কী পড়তে পারে, সে পাসকোডও পড়তে পারবে —
// আর কী-ব্যাকআপ সিঙ্ক করার দায়িত্ব কেবল কী-ওয়ালা ডিভাইসেরই)।
export async function storePasscodeLocally(passcode: string) {
  try { await idb.put('meta', 'pin', passcode) } catch {}
}
export async function getStoredPasscode(): Promise<string | null> {
  try { return (await idb.get('meta', 'pin')) || null } catch { return null }
}
export async function clearStoredPasscode() {
  try { await idb.del('meta', 'pin') } catch {}
}

// ── থ্রটলড পর্যায়ক্রমিক সিঙ্ক + কুইক-ডিবাউন্স ──
// সেশন/সেন্ডার-কী/মেসেজ-ক্যাশ বদলালে markBackupDirty() ডাকা হয়। আগে নতুন
// মেসেজ এলেও ৪৫ সেকেন্ড অপেক্ষা করতে হতো — সেই ফাঁকে অন্য ফোনে লগইন
// করলে শেষ মেসেজগুলো ব্যাকআপে না-ঢুকে উধাও থাকত। এখন ডার্টি হলেই
// ৬ সেকেন্ড পরে একবার কুইক-সিঙ্ক (PBKDF2 600k ভারী বলে প্রতি-মেসেজে নয়,
// ব্যাচে) + ৪৫-সেকেন্ড টাইমার ফলব্যাক হিসেবেই থাকে।
let dirty = false
let syncTimer: any = null
let quickTimer: any = null
let syncing = false

export function markBackupDirty() {
  dirty = true
  scheduleQuickSync()
}

function scheduleQuickSync() {
  if (quickTimer) return
  quickTimer = setTimeout(async () => {
    quickTimer = null
    if (!dirty || syncing) return
    const password = await sessionPassword()
    if (!password) {
      // 🆕 রিলোড-করা/পিন-লগইন ডিভাইস — পাসওয়ার্ড মেমরিতে নেই। লোকাল-সেভ
      // করা পাসকোড দিয়ে অন্তত পিন-ব্লবটা তো তাজা রাখি (গ্যাপ-হিল/পিন-
      // রিস্টোর তাতেই কাজ করে); পাসওয়ার্ড-ব্লব পরের পাসওয়ার্ড-লগইনে তাজা হবে।
      const pin = await getStoredPasscode()
      if (pin) {
        syncing = true
        try { await syncPinBackup(pin); dirty = false } catch {}
        finally { syncing = false }
      }
      return
    }
    syncing = true
    try {
      await syncBackup(password)
      dirty = false
    } catch { /* নেটওয়ার্ক পড়লে পরের টিকে আবার */ }
    finally { syncing = false }
  }, 6_000)
}

// auth স্টোর থেকে সেশন-মেমোরি পাসওয়ার্ড (ডাইনামিক ইমপোর্ট — auth.ts নিজেই
// backup.ts ইমপোর্ট করে, স্ট্যাটিক সার্কুলার হয়ে যেত)
async function sessionPassword(): Promise<string | null> {
  try { return (await import('../stores/auth')).useAuth.getState().password || null } catch { return null }
}

export function startBackupSync() {
  stopBackupSync()
  syncTimer = setInterval(async () => {
    if (!dirty || syncing) return
    const password = await sessionPassword()
    if (!password) {
      // 🆕 পাসওয়ার্ড মেমরিতে নেই (রিলোড/পিন-লগইন) — পিন-ব্লব অন্তত তাজা রাখি
      const pin = await getStoredPasscode()
      if (pin) {
        syncing = true
        try { await syncPinBackup(pin); dirty = false } catch {}
        finally { syncing = false }
      }
      return
    }
    syncing = true
    try {
      await syncBackup(password)
      dirty = false
    } catch { /* নেটওয়ার্ক পড়লে পরের টিকে আবার */ }
    finally { syncing = false }
  }, 45_000)
  // ট্যাব লুকালে সঙ্গে সঙ্গে একবার — সর্বশেষ অবস্থা যেন জমা থাকে
  document.addEventListener('visibilitychange', onHidden)
}

async function onHidden() {
  if (document.visibilityState !== 'hidden' || !dirty || syncing) return
  const password = await sessionPassword()
  if (!password) return
  dirty = false
  try { await syncBackup(password) } catch { dirty = true }
}

export function stopBackupSync() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null }
  if (quickTimer) { clearTimeout(quickTimer); quickTimer = null }
  document.removeEventListener('visibilitychange', onHidden)
}
