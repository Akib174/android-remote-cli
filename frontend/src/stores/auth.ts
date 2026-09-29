// অথেনটিকেশন স্টেট — সাইনআপ (নাম→ইউজারনেম→ফোন→ইমেইল→পাসওয়ার্ড→
// ইউজার-আইডি→পাসকোড), লগইন (username+password / userid+passcode),
// কী রিস্টোর/আপলোড + স্মার্ট-মার্জ।
import { create } from 'zustand'
import { api, setTokens, getTokens } from '../api/client'
import { createIdentityBundle, publicBundleForUpload } from '../crypto/keys'
import { syncBackup, createBackup, restoreBackup, restorePinBackup, mergeRemoteIfFresher, storePasscodeLocally } from '../crypto/backup'
import { idb } from '../lib/db'
import { b64u } from '../lib/utils'
import { t } from '../lib/i18n'
import type { User } from '../types'

// ভারী পাসওয়ার্ড-হ্যাশিং ব্রাউজারেই হয় (Workers ফ্রি প্ল্যানের ১০ms CPU-লিমিটের কারণে)।
// সার্ভারে পাঠানো হয় PBKDF2-ডিরাইভড হ্যাশ, আসল পাসওয়ার্ড নয়।
async function clientPassHash(username: string, password: string): Promise<string> {
  const salt = new TextEncoder().encode('fcfc-v1:' + username.toLowerCase())
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 600_000 },
    base, 256,
  )
  return b64u(new Uint8Array(bits))
}

// 🆕 পাসকোড-হ্যাশ — আলাদা ডোমেইন-সেপারেটর, সল্টে ইউজার-আইডি (uidcode) ব্যবহার
// হয় — লগইনের সময় ইউজারনেম না জেনেই ডেরাইভ করা যায়। একই PBKDF2 শক্তি;
// সার্ভার আবার নিজে সল্ট করে জমা রাখে।
async function clientPasscodeHash(uidcode: string, passcode: string): Promise<string> {
  const salt = new TextEncoder().encode('fcfc-v1:pin:' + uidcode)
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 600_000 },
    base, 256,
  )
  return b64u(new Uint8Array(bits))
}

export type BootStatus = 'boot' | 'auth' | 'ready'

export interface SignupFields {
  username: string
  password: string
  understood: boolean
  name?: string
  phone?: string
  email?: string
  userIdCode: string
  passcode: string
}

interface AuthState {
  status: BootStatus
  user: User | null
  settings: any
  password: string | null // শুধু ব্যাকআপ সিঙ্কের জন্য সেশন-মেমোরিতে
  passcode: string | null // 🆕 পিন-ব্যাকআপ সিঙ্কের জন্য সেশন-মেমোরিতে

  boot(): Promise<void>
  signup(fields: SignupFields): Promise<string | null>
  login(username: string, password: string): Promise<string | null>
  loginPin(uidcode: string, passcode: string): Promise<string | null>
  setupPasscode(password: string, userIdCode: string, passcode: string): Promise<string | null>
  decideDevice(deviceId: string, accept: boolean): Promise<void>
  updateProfile(patch: Record<string, any>): Promise<void>
  updateSettings(patch: Record<string, any>): Promise<void>
  deleteAccount(password: string): Promise<string | null>
  logout(remote?: boolean): Promise<void>
  forceLogout(): void
}

const deviceName = () => {
  const ua = navigator.userAgent
  const browser = ua.includes('Firefox') ? 'Firefox' : ua.includes('Edg') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' : 'Safari'
  const os = ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : ua.includes('Android') ? 'Android' : ua.includes('Linux') ? 'Linux' : ua.includes('iPhone') ? 'iOS' : 'Device'
  return `${browser} · ${os}`
}

// একই ব্রাউজারে অন্য অ্যাকাউন্টে লগইন করলে পুরনো অ্যাকাউন্টের কী/সেশন/
// মেসেজ-ক্যাশ রয়ে গিয়ে নতুন অ্যাকাউন্টের কী-বান্ডল দূষিত করত — ডেটা আগে
// মুছে নতুন শুরু। (নিজের একই অ্যাকাউন্টে লগআউট→লগইনে ডেটা অক্ষত থাকে।)
async function ensureLocalOwner(userId: string) {
  try {
    const owner = await idb.get<string>('meta', 'owner')
    if (owner && owner !== userId) {
      await wipeLocalCrypto()
    }
    await idb.put('meta', 'owner', userId)
  } catch {}
}

async function wipeLocalCrypto() {
  await Promise.all(['keys', 'sessions', 'senderKeys', 'messages', 'starred', 'meta'].map((s) => idb.clear(s)))
}

// ⚠️ সাইনআপের ক্রম-বাগ: আগে createIdentityBundle() চলত, তারপর
// ensureLocalOwner() — ব্রাউজারে আগে অন্য অ্যাকাউন্টের ডেটা থাকলে এই মুছে-
// যাওয়া ধাপটাই **সদ্য-তৈরি নতুন কীগুলোও** মুছে দিত → প্রতিটি মেসেজ পাঠানো
// "identity not ready" এররে ব্যর্থ ("message adan-prodan problem")।
// সাইনআপ মানেই নতুন অ্যাকাউন্ট — আগের যে-কোনো লোকাল ডেটা অন্য অ্যাকাউন্টের,
// তাই কী বানানোর **আগেই** পরিষ্কার করে নিই।
async function wipeIfOtherAccount() {
  try {
    const owner = await idb.get<string>('meta', 'owner')
    if (owner) await wipeLocalCrypto()
  } catch {}
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'boot',
  user: null,
  settings: {},
  password: null,
  passcode: null,

  async boot() {
    const toks = getTokens()
    if (!toks) return set({ status: 'auth' })
    try {
      const { user, settings } = await api('/me')
      set({ user, settings: settings || {}, status: 'ready' })
    } catch {
      setTokens(null)
      set({ status: 'auth' })
    }
  },

  async signup(f: SignupFields) {
    try {
      // অন্য অ্যাকাউন্টের পুরনো ডেটা আগেই মুছি — নইলে নিচের কী বানানোর
      // পরে ensureLocalOwner সেগুলো আবার মুছে দিত (ক্রম-বাগ)
      await wipeIfOtherAccount()
      // কী-পেয়ার আগেই তৈরি হয়, তারপর অ্যাকাউন্ট
      const bundle = await createIdentityBundle()
      const keys = await publicBundleForUpload(bundle)
      const username = f.username.toLowerCase()
      const passHash = await clientPassHash(username, f.password)
      const passcodeHash = await clientPasscodeHash(f.userIdCode, f.passcode)
      const res = await api('/auth/signup', {
        noAuth: true,
        body: {
          username, password: passHash, understood: f.understood, deviceName: deviceName(),
          keys, name: f.name || '', phone: f.phone || '', email: f.email || '',
          userIdCode: f.userIdCode, passcode: passcodeHash,
        },
      })
      setTokens({ access: res.access, refresh: res.refresh })
      set({ password: f.password, passcode: f.passcode })
      await ensureLocalOwner(res.user.id)
      // 🆕 পাসকোড লোকালি রাখি — পরের থ্রটলড সিঙ্কগুলোতে পিন-ব্লবও
      // তাজা হবে (userid+passcode লগইনে নতুন ডিভাইস রিস্টোর পাবে)
      await storePasscodeLocally(f.passcode)
      const { user, settings } = await api('/me')
      set({ user, settings: settings || {}, status: 'ready' })
      // সাইনআপ-মুহূর্তেই **দুই** ব্লব (পাসওয়ার্ড + পাসকোড) আপলোড
      await syncBackup(f.password, f.passcode).catch(() => {})
      return null
    } catch (e: any) {
      return e.message || t('signupFailed')
    }
  },

  // Telegram-স্টাইল লগইন: পাসওয়ার্ড মিললেই টোকেন পাওয়া যায় — কোনো
  // পোলিং/অপেক্ষা নেই। পুরনো ডিভাইসগুলোতে নোটিফিকেশন যায়; সেখান থেকে
  // Decline করলে সার্ভার এই ডিভাইসের সেশন রিভোক করে দেয়।
  async login(username, password) {
    try {
      const passHash = await clientPassHash(username, password)
      const res = await api('/auth/login', { noAuth: true, body: { username, password: passHash, deviceName: deviceName() } })
      return finishLogin(set, get, res.access, res.refresh, password)
    } catch (e: any) {
      return e.message || t('loginFailed')
    }
  },

  // 🆕 লগইন-উইথ user-ID + পাসকোড — পাসওয়ার্ড ছাড়াই পুরো লগইন।
  // কী-রিস্টোর পাসকোড-ব্লব (pin_blob) থেকে হয় — মূল পাসওয়ার্ড-ব্লব
  // অক্ষত থাকে, পরে পাসওয়ার্ড-লগইনেও সব ঠিক থাকে।
  async loginPin(uidcode, passcode) {
    try {
      const passcodeHash = await clientPasscodeHash(uidcode, passcode)
      const res = await api('/auth/login-pin', { noAuth: true, body: { uidcode, passcode: passcodeHash, deviceName: deviceName() } })
      return finishPinLogin(set, get, res.access, res.refresh, passcode)
    } catch (e: any) {
      return e.message || t('loginFailed')
    }
  },

  // 🆕 সেটিংস → ইউজার-আইডি ও পাসকোড ম্যানেজমেন্ট — পাসওয়ার্ড যাচাই
  // বাধ্যতামূলক। প্রথমবার: আইডি+পাসকোড সেট; পরে: শুধু পাসকোড বদল।
  async setupPasscode(password, userIdCode, passcode) {
    try {
      const me = get().user
      // সল্ট-ডোমেন: নতুন আইডি (সেট-আপ) নয়তো আসল আইডি (বদল) — খালি
      // ইউজার-আইডি দিয়ে হ্যাশ ডেরাইভ করা যায় না
      const code = userIdCode || me?.userIdCode || ''
      const passHash = await clientPassHash(me?.username || '', password)
      const passcodeHash = await clientPasscodeHash(code, passcode)
      const res = await api('/me/passcode', { body: { password: passHash, userIdCode, passcode: passcodeHash } })
      // পাসকোড লোকালি রাখি + দুই ব্লবই এখনই তাজা করি
      await storePasscodeLocally(passcode)
      set({ passcode, user: { ...me!, userIdCode: res.userIdCode || userIdCode } as User })
      await syncBackup(password, passcode).catch(() => {})
      return null
    } catch (e: any) {
      return e.message || t('failedRetry')
    }
  },

  async decideDevice(deviceId, accept) {
    await api(`/auth/devices/${deviceId}/decision`, { body: { accept } })
  },

  async updateProfile(patch) {
    await api('/me', { method: 'PATCH', body: patch })
    const { user } = await api('/me')
    set({ user })
  },

  async updateSettings(patch) {
    const merged = { ...get().settings, ...patch }
    await api('/me', { method: 'PATCH', body: { settings: merged } })
    set({ settings: merged })
  },

  async deleteAccount(password) {
    try {
      const me = get().user
      const passHash = await clientPassHash(me?.username || '', password)
      await api('/me/account', { method: 'DELETE', body: { password: passHash } })
      setTokens(null)
      set({ user: null, status: 'auth', password: null, passcode: null })
      return null
    } catch (e: any) {
      return e.message || t('failedRetry')
    }
  },

  async logout(remote = false) {
    // লগআউটের মুহূর্তে পাসওয়ার্ড এখনো মেমরিতে আছে — এখনই একবার তাজা
    // কী-ব্যাকআপ আপলোড করে যাই। নইলে ৪৫-সেকেন্ডের থ্রটলড সিঙ্কের ফাঁকে
    // শেষ কয়েকটা মেসেজ-ক্যাশ ব্যাকআপে না-ঢুকেই লগআউট হতো; পরের লগইনে
    // (লোকাল ডেটা মোছা পড়লে) রিস্টোর করা ব্যাকআপ পুরনো থাকত।
    const pass = get().password
    try {
      if (pass && (await idb.get('keys', 'identity'))) {
        await syncBackup(pass).catch(() => {})
      }
    } catch {}
    try { await api('/auth/logout', { body: { device: remote } }) } catch {}
    setTokens(null)
    set({ user: null, status: 'auth', password: null, passcode: null })
  },

  forceLogout() {
    setTokens(null)
    set({ user: null, status: 'auth', password: null, passcode: null })
  },
}))

window.addEventListener('fcfc:force-logout', () => useAuth.getState().forceLogout())

async function finishLogin(set: any, get: any, access: string, refresh: string, password: string) {
  setTokens({ access, refresh })
  set({ password })
  const { user, settings } = await api('/me')
  await ensureLocalOwner(user.id)

  // ⚠️ কী-রেস্টোরেশন অবশ্যই `status: 'ready'`-এর **আগে** শেষ হতে হবে।
  // আগে ready আগে সেট হতো, তারপর রিস্টোর চলত — App-এফেক্ট তখনই boot()
  // ডেকে হিস্ট্রি-লোড শুরু করত, আর কী/সেশন-ক্যাশ না-থাকা অবস্থায় প্রতিটি
  // মেসেজ-রো ডিক্রিপ্ট-ব্যর্থ হয়ে ব্ল্যাকলিস্টে চলে যেত (failedDecryptIds)।
  // রিস্টোর শেষ হলেও সেগুলো আর ফিরে আসত না — লগআউট→লগইনে চ্যাট প্রায়
  // খালি (শুধু লাইভে আসা ১-২টা মেসেজ) দেখাত। এখন রিস্টোর আগে হয়।
  const hasLocal = !!(await idb.get('keys', 'identity'))
  let restored = false
  if (!hasLocal) {
    const backup = await api('/me/backup').catch(() => null)
    if (backup?.blob) {
      restored = await restoreBackup(password, backup.blob, backup.salt)
    }
    if (!restored && backup?.pinBlob) {
      // মূল ব্লব খোলা গেল না (যেমন পুরনো-ফরম্যাট/ভাঙা) — পাসকোড-ব্লব
      // লোকালি-সেভ-করা পাসকোড দিয়ে খোলার চেষ্টা (একই ডিভাইসে আগে
      // পিন-লগইন করা থাকলে)
      const { getStoredPasscode } = await import('../crypto/backup')
      const pin = await getStoredPasscode()
      if (pin) restored = await restorePinBackup(pin, backup.pinBlob, backup.pinSalt)
    }
    if (!restored) {
      // নতুন ডিভাইস + কোনো ব্যাকআপ নেই → নতুন আইডেন্টিটি
      const bundle = await createIdentityBundle()
      await api('/me/keys', { body: await publicBundleForUpload(bundle) })
      const { blob, salt } = await createBackup(password)
      await api('/me/backup', { method: 'PUT', body: { blob, salt } })
    }
  } else {
    // 🩹 স্মার্ট-মার্জ (ফোনে পিয়ারের মেসেজ উধাও-বাগের আসল ফিক্স):
    // এই ডিভাইসে পুরনো লোকাল ডেটা আছে, কিন্তু সার্ভারের ব্যাকআপ
    // **তাজা** (ল্যাপটপ থেকে সিঙ্ক হয়েছে) — আগে লগইন করলেই লোকালের
    // পুরনো স্ন্যাপশট সার্ভারে উঠে গিয়ে তাজাটা মুছে দিত; ফোনে নিজের
    // মেসেজ দেখা গেলেও পিয়ারেরগুলো রিস্টোর-ছাড়া উধাও থাকত।
    // এখন: রিমোট তাজা হলে আগে সেটাই লোকালে বসে, তারপর আপলোড।
    const pin = await (await import('../crypto/backup')).getStoredPasscode()
    restored = await mergeRemoteIfFresher(password, pin)
    await syncBackup(password).catch(() => {})
  }

  // এখন UI রেডি — হিস্ট্রি-লোড রিস্টোর-শেষ হওয়া কী দিয়েই শুরু হবে
  set({ user, settings: settings || {}, status: 'ready' })

  // বেল্ট-অ্যান্ড-সাসপেন্ডার: রিস্টোর/মার্জ হয়ে থাকলে চ্যাট-স্টোরকে জানিয়ে দিই —
  // আগে-হয়ে-যাওয়া কোনো ব্ল্যাকলিস্ট/খালি-হিস্ট্রি থাকলে নিজে থেকেই রি-লোড করবে
  if (restored) window.dispatchEvent(new Event('fcfc:keys-restored'))
  return null
}

// 🆕 পিন-লগইনের রিস্টোর-পাথ — পাসকোড-ব্লব থেকে
async function finishPinLogin(set: any, get: any, access: string, refresh: string, passcode: string) {
  setTokens({ access, refresh })
  set({ passcode })
  const { user, settings } = await api('/me')
  await ensureLocalOwner(user.id)

  const hasLocal = !!(await idb.get('keys', 'identity'))
  let restored = false
  if (!hasLocal) {
    const backup = await api('/me/backup').catch(() => null)
    if (backup?.pinBlob) {
      restored = await restorePinBackup(passcode, backup.pinBlob, backup.pinSalt)
    }
    if (!restored) {
      // পিন-ব্লব নেই — নতুন আইডেন্টিটি + নতুন পিন-ব্যাকআপ (পাসওয়ার্ড-ব্লব
      // অক্ষত থাকে; পাসওয়ার্ড-লগইনে পুরনোটা রিস্টোর করা যাবে)
      const bundle = await createIdentityBundle()
      await api('/me/keys', { body: await publicBundleForUpload(bundle) })
      await (await import('../crypto/backup')).syncPinBackup(passcode).catch(() => {})
    }
  } else {
    restored = await mergeRemoteIfFresher(null, passcode)
  }

  // পাসকোড লোকালি-সেভ — এই ডিভাইসের পরের সিঙ্কগুলোতে পিন-ব্লবও তাজা হবে
  await storePasscodeLocally(passcode)

  set({ user, settings: settings || {}, status: 'ready' })
  if (restored) window.dispatchEvent(new Event('fcfc:keys-restored'))
  return null
}
