// /auth/* — signup, login (Telegram-style multi-device notify), refresh, sessions.
import { Hono } from 'hono'
import type { AppContext, Env } from '../types'
import { json, err, uid, now, USERNAME_RE, randHex, b64u } from '../lib/util'
import { hashPassword, verifyPassword } from '../lib/password'
import { signJwt } from '../lib/jwt'
import { makeAccessToken } from '../middleware/auth'
import { rateLimit } from '../lib/ratelimit'
import { pushToUser } from '../lib/push'
import { authMiddleware } from '../middleware/auth'

const app = new Hono<AppContext>()

async function notifyUserHub(env: Env, userId: string, event: any) {
  try {
    const id = env.USER_HUB.idFromName(userId)
    await env.USER_HUB.get(id).fetch(`https://hub.internal/notify?uid=${encodeURIComponent(userId)}`, {
      method: 'POST',
      body: JSON.stringify(event),
    })
  } catch { /* hub unreachable — push handled elsewhere */ }
}

async function hashRefresh(env: Env, token: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token + env.REFRESH_PEPPER))
  return b64u(buf)
}

async function issueTokens(env: Env, userId: string, username: string, deviceId: string) {
  const access = await makeAccessToken(env, userId, username, deviceId)
  const refresh = randHex(32)
  const refreshHash = await hashRefresh(env, refresh)
  await env.DB.prepare(
    'INSERT INTO refresh_tokens (token_hash, user_id, device_id, created_at, expires_at) VALUES (?,?,?,?,?)',
  ).bind(refreshHash, userId, deviceId, now(), now() + 90 * 864e5).run()
  return { access, refresh }
}

// ── username availability (real-time check during signup) ──
// ?username= বা ?phone= / ?email= / ?uidcode= — যেটা দেওয়া আছে সেটাই যাচাই হয়।
app.get('/check', async (c) => {
  const u = (c.req.query('username') || '').toLowerCase()
  if (u) {
    if (!USERNAME_RE.test(u)) return json({ ok: false, reason: 'invalid' })
    const row = await c.env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(u).first()
    return json({ ok: !row })
  }
  // 🆕 নিউমেরিক ইউজার-আইডি (৪-১২ ডিজিট) খোলা আছে কিনা — সাইনআপে/
  // সেটিংসে সেট-আপের সময় রিয়েল-টাইম চেক
  const uidcode = (c.req.query('uidcode') || '').replace(/[^0-9]/g, '')
  if (uidcode) {
    if (!/^[0-9]{4,12}$/.test(uidcode)) return json({ ok: false, reason: 'invalid' })
    const row = await c.env.DB.prepare('SELECT id FROM users WHERE user_id_code = ? AND deleted = 0').bind(uidcode).first()
    return json({ ok: !row })
  }
  const phone = (c.req.query('phone') || '').replace(/[^0-9+]/g, '')
  if (phone) {
    const row = await c.env.DB.prepare('SELECT id FROM users WHERE phone = ? AND deleted = 0').bind(phone).first()
    return json({ ok: !row })
  }
  const email = (c.req.query('email') || '').toLowerCase().trim()
  if (email) {
    const row = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND deleted = 0').bind(email).first()
    return json({ ok: !row })
  }
  return json({ ok: false, reason: 'nothing-to-check' })
})

// ফোন: সংখ্যা + অন্তর্বর্তী + দেশকোড, ৬–২০ অক্ষর
export const PHONE_RE = /^\+?[0-9][0-9\s-]{5,19}$/
// ইমেইল: সাধারণ sane ফরম্যাট
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-zA-Z]{2,24}$/

// ── signup ──
// 🆕 নতুন ফ্লো: নাম + username + ফোন (ঐচ্ছিক) + ইমেইল (ঐচ্ছিক) +
// পাসওয়ার্ড + কনফার্ম + নিউমেরিক ইউজার-আইডি + পাসকোড।
// পাসওয়ার্ড/পাসকোড দুটোই ক্লায়েন্ট-সাইডে PBKDF2-হ্যাশড হয়ে আসে
// (ফ্রি প্ল্যানের ১০ms CPU-লিমিট) — সার্ভার আবার নিজে সল্ট করে জমা রাখে।
const UIDCODE_RE = /^[0-9]{4,12}$/ // ইউজার-আইডি: সর্বনিম্ন ৪ ডিজিট
// পাসকোড ক্লায়েন্ট-সাইডে PBKDF2-হ্যাশড (b64u, ৪৩ অক্ষর) হয়ে আসে —
// আসল ৬-৮ ডিজিট-চেক ক্লায়েন্ট-উইজার্ডে হয়; সার্ভার শুধু হ্যাশ-দৈর্ঘ্য
// সেনিটি-চেক করে (একই নীতি পাসওয়ার্ডেও — ওটাও ক্লায়েন্ট-হ্যাশ)।
const CLIENT_HASH_MIN = 40

app.post('/signup', async (c) => {
  const rl = await rateLimit(c.env.KV, `signup:${c.req.header('cf-connecting-ip') || 'x'}`, 10, 3600)
  if (!rl.ok) return err('rate limited', 429)
  const body = await c.req.json<any>().catch(() => ({}))
  const username = String(body.username || '').toLowerCase()
  const password = String(body.password || '')
  const understood = body.understood === true
  if (!USERNAME_RE.test(username)) return err('invalid username')
  if (password.length < 8) return err('password too short (min 8)')
  if (!understood) return err('recovery acknowledgement required')

  // নাম — চ্যাটে প্রেরকের নাম হিসেবে দেখায় (ঐচ্ছিক কিন্তু ফ্লোতে থাকে)
  const name = String(body.name || '').trim().slice(0, 60)

  // ── ফোন (এখন ঐচ্ছিক — স্কিপ করা যায়) ও ইমেইল (ঐচ্ছিক) ──
  const phone = String(body.phone || '').replace(/[^0-9+]/g, '')
  const email = String(body.email || '').toLowerCase().trim()
  if (phone && !PHONE_RE.test(phone)) return err('invalid phone number (6-20 digits, optional +)')
  if (email && !EMAIL_RE.test(email)) return err('invalid email address')

  // ── নিউমেরিক ইউজার-আইডি + পাসকোড (দুটোই বাধ্যতামূলক নতুন ফ্লোতে) ──
  const userIdCode = String(body.userIdCode || '').replace(/[^0-9]/g, '')
  const passcode = String(body.passcode || '')
  if (!UIDCODE_RE.test(userIdCode)) return err('user id must be at least 4 digits (0-9)')
  if (passcode.length < CLIENT_HASH_MIN) return err('passcode must be 6-8 digits')

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(username).first()
  if (exists) return err('username taken', 409)
  const uidTaken = await c.env.DB.prepare('SELECT id FROM users WHERE user_id_code = ? AND deleted = 0').bind(userIdCode).first()
  if (uidTaken) return err('this user id is already taken', 409)
  if (phone) {
    const phoneTaken = await c.env.DB.prepare('SELECT id FROM users WHERE phone = ? AND deleted = 0').bind(phone).first()
    if (phoneTaken) return err('this phone number is already registered', 409)
  }
  if (email) {
    const emailTaken = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND deleted = 0').bind(email).first()
    if (emailTaken) return err('this email is already registered', 409)
  }

  const { hash, salt } = await hashPassword(password)
  const pc = await hashPassword(passcode) // সার্ভার-সাইড আরেকটা সল্ট-লেয়ার
  const userId = uid('u_')
  const deviceId = uid('d_')
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO users (id, username, name, pass_hash, pass_salt, phone, email, user_id_code, passcode_hash, passcode_salt, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(userId, username, name, hash, salt, phone, email, userIdCode, pc.hash, pc.salt, now()),
    c.env.DB.prepare(
      'INSERT INTO devices (id, user_id, name, approved, created_at, last_active) VALUES (?,?,?,?,?,?)',
    ).bind(deviceId, userId, body.deviceName || 'New device', 1, now(), now()),
  ])
  // প্রথম ডিভাইস — তাই অনুমোদনের প্রয়োজন নেই।
  if (body.keys) await uploadKeys(c.env, userId, body.keys)

  const tokens = await issueTokens(c.env, userId, username, deviceId)
  return json({ user: { id: userId, username, name, userIdCode, phone, email }, ...tokens })
})

// ── 🆕 লগইন-উইথ user-ID + পাসকোড ──
// পাসওয়ার্ড না মনে থাকলেও নিজের নিউমেরিক আইডি + ৬-৮ ডিজিট পাসকোডে
// লগইন। টোকেন/ডিভাইস/নোটিফিকেশন ফ্লো পাসওয়ার্ড-লগইনের মতোই।
app.post('/login-pin', async (c) => {
  const rl = await rateLimit(c.env.KV, `loginpin:${c.req.header('cf-connecting-ip') || 'x'}`, 20, 300)
  if (!rl.ok) return err('rate limited', 429)
  const body = await c.req.json<any>().catch(() => ({}))
  const uidcode = String(body.uidcode || '').replace(/[^0-9]/g, '')
  const passcode = String(body.passcode || '')
  if (!UIDCODE_RE.test(uidcode) || passcode.length < CLIENT_HASH_MIN) return err('invalid user id or passcode')
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE user_id_code = ? AND deleted = 0').bind(uidcode).first<any>()
  if (!user || !user.passcode_hash || !(await verifyPassword(passcode, user.passcode_hash, user.passcode_salt)))
    return err('invalid credentials', 401)

  const otherDevices = await c.env.DB.prepare('SELECT COUNT(*) n FROM devices WHERE user_id = ? AND approved = 1').bind(user.id).first<any>()
  const deviceId = uid('d_')
  const deviceName = String(body.deviceName || 'New device')
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO devices (id, user_id, name, approved, created_at, last_active) VALUES (?,?,?,?,?,?)')
      .bind(deviceId, user.id, deviceName, 1, now(), now()),
    c.env.DB.prepare('DELETE FROM devices WHERE user_id = ? AND approved = 0').bind(user.id),
  ])
  const tokens = await issueTokens(c.env, user.id, user.username, deviceId)
  if ((otherDevices?.n || 0) > 0) {
    await notifyUserHub(c.env, user.id, {
      t: 'device-approval', deviceId, deviceName, username: user.username, except: deviceId,
    })
  }
  return json({ user: { id: user.id, username: user.username, name: user.name, userIdCode: user.user_id_code }, ...tokens })
})

// ── login — Telegram-স্টাইল মাল্টি-ডিভাইস ফ্লো ──
// পাসওয়ার্ড মিললেই নতুন ডিভাইস সাথে সাথেই লগইন হয়ে যায় (টোকেন পেয়ে যায়)।
// একই সাথে পুরনো ডিভাইসগুলোতে "নতুন লগইন" নোটিফিকেশন যায় — সেখান থেকে
// Decline করলে এই নতুন ডিভাইসের সেশন তৎক্ষণাৎ রিভোক হয়ে লগআউট হয়ে যায়।
app.post('/login', async (c) => {
  const rl = await rateLimit(c.env.KV, `login:${c.req.header('cf-connecting-ip') || 'x'}`, 20, 300)
  if (!rl.ok) return err('rate limited', 429)
  const body = await c.req.json<any>().catch(() => ({}))
  const username = String(body.username || '').toLowerCase()
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND deleted = 0').bind(username).first<any>()
  if (!user || !(await verifyPassword(String(body.password || ''), user.pass_hash, user.pass_salt)))
    return err('invalid credentials', 401)

  const otherDevices = await c.env.DB.prepare('SELECT COUNT(*) n FROM devices WHERE user_id = ? AND approved = 1').bind(user.id).first<any>()
  const deviceId = uid('d_')
  const deviceName = String(body.deviceName || 'New device')

  // পুরনো পোলিং-ভিত্তিক ফ্লোতে সার্ভার approve করার সময় সিক্রেট NULL করে দিত —
  // ফলে /auth/login/poll-এর secret-ম্যাচ চিরকালের জন্য ভেঙে যেত (404 unknown device)।
  // নতুন ফ্লোতে পোলিং নেইই — লগইন সাথে সাথেই সম্পন্ন।
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO devices (id, user_id, name, approved, created_at, last_active) VALUES (?,?,?,?,?,?)')
      .bind(deviceId, user.id, deviceName, 1, now(), now()),
    // লিগ্যাসি "pending approval" (approved=0) রো-গুলো আর দরকার নেই — পরিষ্কার
    c.env.DB.prepare('DELETE FROM devices WHERE user_id = ? AND approved = 0').bind(user.id),
  ])
  const tokens = await issueTokens(c.env, user.id, user.username, deviceId)

  // পুরনো ডিভাইস থাকলে সেখানে নোটিফিকেশন — নতুন ডিভাইস নিজে এটা পাবে না (except)।
  const notified = (otherDevices?.n || 0) > 0
  if (notified) {
    await notifyUserHub(c.env, user.id, {
      t: 'device-approval', deviceId, deviceName, username: user.username, except: deviceId,
    })
  }
  return json({ user: { id: user.id, username: user.username }, ...tokens, notified })
})

// ── পুরনো ডিভাইস থেকে Accept / Decline (Telegram-স্টাইল) ──
// Accept  = "আমিই করেছি" — সেশন চালুই থাকে, কিছু করার নেই।
// Decline = "আমি করিনি" — ওই ডিভাইসের রিফ্রেশ-টোকেন মুছে যায় + approved=2,
// আর UserHub ওই ডিভাইসের সকেট বন্ধ করে দেয় → তৎক্ষণাৎ লগআউট।
app.post('/devices/:id/decision', authMiddleware, async (c) => {
  const { accept } = await c.req.json<any>().catch(() => ({}))
  const dev = await c.env.DB.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('user').id).first<any>()
  if (!dev) return err('not found', 404)
  if (dev.approved === 2) return json({ ok: true, revoked: true }) // আগেই রিভোক করা
  if (accept) {
    await c.env.DB.prepare('UPDATE devices SET last_active = ? WHERE id = ?').bind(now(), dev.id).run()
    await notifyUserHub(c.env, c.get('user').id, { t: 'device-accepted', deviceId: dev.id, except: dev.id })
    return json({ ok: true })
  }
  // Decline → রিমোট লগআউট
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM refresh_tokens WHERE device_id = ?').bind(dev.id),
    c.env.DB.prepare('UPDATE devices SET approved = 2, secret = NULL WHERE id = ?').bind(dev.id),
  ])
  await notifyUserHub(c.env, c.get('user').id, { t: 'device-revoked', deviceId: dev.id })
  return json({ ok: true, revoked: true })
})

// ── refresh ──
app.post('/refresh', async (c) => {
  const { refresh } = await c.req.json<any>().catch(() => ({}))
  if (!refresh) return err('missing refresh', 400)
  const h = await hashRefresh(c.env, refresh)
  const row = await c.env.DB.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > ?').bind(h, now()).first<any>()
  if (!row) return err('invalid refresh', 401)
  const dev = await c.env.DB.prepare('SELECT * FROM devices WHERE id = ? AND approved = 1').bind(row.device_id).first<any>()
  if (!dev) return err('device revoked', 401)
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').bind(row.user_id).first<any>()
  if (!user) return err('account gone', 401)
  await c.env.DB.prepare('UPDATE devices SET last_active = ? WHERE id = ?').bind(now(), dev.id).run()
  const access = await makeAccessToken(c.env, user.id, user.username, dev.id)
  return json({ access })
})

// ── logout (revoke current device or just token) ──
app.post('/logout', authMiddleware, async (c) => {
  const body = await c.req.json<any>().catch(() => ({}))
  const me = c.get('user')
  if (body.device) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM refresh_tokens WHERE device_id = ?').bind(me.deviceId!),
      c.env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(me.deviceId!),
    ])
  } else if (body.refresh) {
    const h = await hashRefresh(c.env, String(body.refresh))
    await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').bind(h).run()
  }
  return json({ ok: true })
})

export async function uploadKeys(env: Env, userId: string, keys: any) {
  const batch: any[] = [
    env.DB.prepare('INSERT OR REPLACE INTO user_keys (user_id, identity_pub, sign_pub, spk_pub, spk_sig, updated_at) VALUES (?,?,?,?,?,?)')
      .bind(userId, JSON.stringify(keys.identityPub), JSON.stringify(keys.signPub), JSON.stringify(keys.spkPub), keys.spkSig, now()),
    env.DB.prepare('DELETE FROM one_time_prekeys WHERE user_id = ?').bind(userId),
  ]
  await env.DB.batch(batch)
  if (Array.isArray(keys.otks)) {
    for (const k of keys.otks) {
      await env.DB.prepare('INSERT INTO one_time_prekeys (user_id, pub) VALUES (?,?)').bind(userId, JSON.stringify(k)).run()
    }
  }
}

export default app
