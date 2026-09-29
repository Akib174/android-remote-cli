// /me/* এবং /users/* — প্রোফাইল, সার্চ, ব্লক, ডিভাইস, প্রিকি, কী-ব্যাকআপ, পুশ।
import { Hono } from 'hono'
import type { AppContext } from '../types'
import { json, err, uid, now, b64u } from '../lib/util'
import { authMiddleware } from '../middleware/auth'
import { verifyPassword, hashPassword } from '../lib/password'
import { uploadKeys, PHONE_RE, EMAIL_RE } from './auth'

const app = new Hono<AppContext>()
app.use('*', authMiddleware)

// 🔒 প্রাইভেসি-ফিক্স: ফোন/ইমেইল এখন **শুধু নিজের কাছে** (/me) যায়।
// আগে publicUser-এর সাথে সার্চ-রেজাল্ট ও /users/:id-তেও যে-কোনো
// লগইন-করা ইউজারের কাছে অন্য সবার ফোন-নম্বর/ইমেইল ফাঁস হতো —
// টেলিগ্রামও অপরিচিতকে ফোন দেখায় না। চ্যাট-মেম্বার-কোয়েরি আগে থেকেই
// এগুলো দেয় না, তাই পিয়ার-প্যানেলে কিছু ভাঙে না।
function publicUser(u: any, includeContact = false) {
  return {
    id: u.id, username: u.username, name: u.name || '', userIdCode: u.user_id_code || '',
    about: u.about || '',
    avatarKey: u.avatar_key || '',
    phone: includeContact ? (u.phone || '') : '',
    email: includeContact ? (u.email || '') : '',
    lastSeenPriv: u.lastseen_priv,
    lastSeenAt: u.lastseen_priv === 'everyone' ? u.last_seen_at : 0,
    deleted: !!u.deleted,
  }
}

// ── প্রোফাইল ──
app.get('/me', async (c) => {
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('user').id).first<any>()
  if (!u) return err('not found', 404)
  const settings = await c.env.DB.prepare('SELECT json FROM settings WHERE user_id = ?').bind(u.id).first<any>()
  return json({ user: { ...publicUser(u, true), privacyDm: u.privacy_dm }, settings: JSON.parse(settings?.json || '{}') })
})

app.patch('/me', async (c) => {
  const b = await c.req.json<any>().catch(() => ({}))
  const me = c.get('user').id
  const ops: any[] = []
  // ── নাম (ডিসপ্লে-নেম) — username আর ইউজার-আইডি যেমনই থাকুক, নাম
  //    বদলানো যায় (চ্যাটে প্রেরকের নাম এটাই দেখায়) ──
  if (typeof b.name === 'string') {
    const name = b.name.trim().slice(0, 60)
    ops.push(c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, me))
  }

  if (typeof b.about === 'string')
    ops.push(c.env.DB.prepare('UPDATE users SET about = ? WHERE id = ?').bind(b.about.slice(0, 200), me))
  if (typeof b.avatarKey === 'string')
    ops.push(c.env.DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(b.avatarKey, me))
  if (b.privacyDm === 'everyone' || b.privacyDm === 'request')
    ops.push(c.env.DB.prepare('UPDATE users SET privacy_dm = ? WHERE id = ?').bind(b.privacyDm, me))
  if (b.lastseenPriv === 'everyone' || b.lastseenPriv === 'nobody')
    ops.push(c.env.DB.prepare('UPDATE users SET lastseen_priv = ? WHERE id = ?').bind(b.lastseenPriv, me))

  // ── ফোন/ইমেইল — সাইনআপে না দিলে পরে এখান থেকেই যোগ/বদলানো যায় ──
  if (typeof b.phone === 'string') {
    const phone = b.phone.replace(/[^0-9+]/g, '')
    if (!phone || !PHONE_RE.test(phone)) return err('invalid phone number (6-20 digits, optional +)')
    const taken = await c.env.DB.prepare('SELECT id FROM users WHERE phone = ? AND deleted = 0 AND id != ?').bind(phone, me).first()
    if (taken) return err('this phone number is already in use', 409)
    ops.push(c.env.DB.prepare('UPDATE users SET phone = ? WHERE id = ?').bind(phone, me))
  }
  if (typeof b.email === 'string') {
    const email = b.email.toLowerCase().trim()
    if (email && !EMAIL_RE.test(email)) return err('invalid email address')
    if (email) {
      const taken = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND deleted = 0 AND id != ?').bind(email, me).first()
      if (taken) return err('this email is already in use', 409)
    }
    ops.push(c.env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, me))
  }

  if (b.settings && typeof b.settings === 'object')
    ops.push(c.env.DB.prepare('INSERT INTO settings (user_id, json) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json').bind(me, JSON.stringify(b.settings)))
  if (ops.length) await c.env.DB.batch(ops)
  return json({ ok: true })
})

// প্রোফাইল ছবি (≤ 5MB) সরাসরি R2-তে।
// ?variant=small → ছোট থাম্বনেইল (`*_small.bin` কনভেনশন-কী) — শুধু R2-তে
// রাখে, users.avatar_key বদলায় না (ক্লায়েন্ট কী থেকে নামটা নিজেই বানায়:
// `<hash>.bin` → `<hash>_small.bin`; পুরনো অ্যাভাটারে ছোটটা না থাকলে ক্লায়েন্ট
// ফুল-রেজে ফলব্যাক করে)।
app.post('/me/avatar', async (c) => {
  const blob = await c.req.arrayBuffer()
  if (blob.byteLength > 5 * 1024 * 1024) return err('too large', 413)
  const variant = c.req.query('variant')
  const id = uid()
  if (variant === 'small') {
    const key = `avatars/${c.get('user').id}/${id}_small.bin`
    await c.env.R2.put(key, blob, { httpMetadata: { contentType: c.req.header('content-type') || 'image/jpeg' } })
    return json({ key })
  }
  const key = `avatars/${c.get('user').id}/${id}.bin`
  await c.env.R2.put(key, blob, { httpMetadata: { contentType: c.req.header('content-type') || 'image/webp' } })
  await c.env.DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(key, c.get('user').id).run()
  return json({ key })
})

// ── সার্চ: username / phone / email / name / user-id — multi-token ("both") সাপোর্ট ──
// 🆕 এখন নাম ও নিউমেরিক ইউজার-আইডি দিয়েও খোঁজা যায় (userid, number,
//    name, username — সবই)।
app.get('/users/search', async (c) => {
  const raw = (c.req.query('q') || '').toLowerCase().trim()
  // username(a-z0-9_) + phone(0-9+) + email(@ . - _) + বাংলা/ইংরেজি নাম — এসব রাখি
  if (raw.length < 2) return json({ results: [] })
  const tokens = raw.replace(/[^\w\s+@.\-\u0980-\u09FF]/g, ' ').split(/\s+/).filter((t) => t.length >= 1).slice(0, 4)
  if (!tokens.length) return json({ results: [] })
  // LIKE-এর wildcard % ও _ escape করি (ESCAPE '\\' সহ)
  const esc = (s: string) => s.replace(/[\\%_]/g, (ch) => '\\' + ch)
  const cols = ['username', 'phone', 'email', 'name', 'user_id_code']
  let where = 'deleted = 0'
  const binds: any[] = []
  for (const tok of tokens) {
    where += ` AND (${cols.map((col) => `${col} LIKE ? COLLATE NOCASE ESCAPE '\\'`).join(' OR ')})`
    for (const _ of cols) binds.push(`%${esc(tok)}%`)
  }
  const first = tokens[0]
  const { results } = await c.env.DB.prepare(
    `SELECT id, username, name, user_id_code, about, avatar_key, phone, email, lastseen_priv, last_seen_at, deleted FROM users
     WHERE ${where}
     ORDER BY (username LIKE ? COLLATE NOCASE ESCAPE '\\') DESC, length(username) ASC LIMIT 20`,
  ).bind(...binds, `${esc(first)}%`).all()
  // 🔒 ফোন/ইমেইল ছাড়া — নিজের সার্চ-রেজাল্টেও দরকার নেই (সেটিংসে /me থেকে আসে)
  return json({ results: results.map((r: any) => publicUser(r, false)) })
})

// presence: KV ফ্ল্যাগ (UserHub হার্টবিট থেকে সেট হয়)
// ⚠️ এই রুটটি অবশ্যই `/users/:id`-এর **আগে** রেজিস্টার করতে হবে —
// নইলে Hono প্যারামিটার-রুট `:id` আগে ম্যাচ করে এটাকে ঢেকে ফেলে (404)।
app.get('/users/presence', async (c) => {
  const ids = (c.req.query('ids') || '').split(',').filter(Boolean).slice(0, 100)
  const out: Record<string, boolean> = {}
  for (const id of ids) out[id] = !!(await c.env.KV.get(`online:${id}`))
  return json(out)
})

// ── ইউজার পাবলিক প্রোফাইল ──
app.get('/users/:id', async (c) => {
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.req.param('id')).first<any>()
  if (!u) return err('not found', 404)
  // 🔒 ফোন/ইমেইল শুধু নিজের প্রোফাইলেই — অন্যের কাছে নয়
  return json({ user: publicUser(u, u.id === c.get('user').id) })
})

// ── ব্লক লিস্ট ──
app.get('/me/blocked', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.user_id_code, u.about, u.avatar_key, u.lastseen_priv, u.last_seen_at, u.deleted
     FROM blocked b JOIN users u ON u.id = b.other_id WHERE b.user_id = ?`,
  ).bind(c.get('user').id).all()
  return json({ results: results.map((r: any) => publicUser(r, false)) })
})
app.put('/me/blocked/:id', async (c) => {
  await c.env.DB.prepare('INSERT OR IGNORE INTO blocked (user_id, other_id) VALUES (?,?)')
    .bind(c.get('user').id, c.req.param('id')).run()
  return json({ ok: true })
})
app.delete('/me/blocked/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM blocked WHERE user_id = ? AND other_id = ?')
    .bind(c.get('user').id, c.req.param('id')).run()
  return json({ ok: true })
})

// ── ডিভাইস/সেশন ম্যানেজমেন্ট ──
app.get('/me/devices', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, approved, created_at, last_active FROM devices WHERE user_id = ? ORDER BY created_at DESC',
  ).bind(c.get('user').id).all()
  return json({ devices: results, current: c.get('user').deviceId })
})

// রিমোট লগআউট + পেন্ডিং ডিভাইস বাতিল
app.delete('/me/devices/:id', async (c) => {
  const me = c.get('user')
  const target = c.req.param('id')
  if (target === me.deviceId) return err('use /auth/logout?device=1', 400)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM refresh_tokens WHERE device_id = ? AND user_id = ?').bind(target, me.id),
    c.env.DB.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').bind(target, me.id),
  ])
  try {
    const id = c.env.USER_HUB.idFromName(me.id)
    await c.env.USER_HUB.get(id).fetch(`https://hub.internal/notify?uid=${encodeURIComponent(me.id)}`, {
      method: 'POST', body: JSON.stringify({ t: 'device-revoked', deviceId: target }),
    })
  } catch {}
  return json({ ok: true })
})

// ── কী-ব্যাকআপ (পাসওয়ার্ড-ডিরাইভড, সার্ভার কখনো ডিক্রিপ্ট করতে পারে না) ──
// 🆕 দুটো কপি: পাসওয়ার্ড-এনক্রিপ্টেড মূল ব্লব + পাসকোড-এনক্রিপ্টেড কপি —
// user-ID + পাসকোড লগইনেও নতুন ডিভাইসে রিস্টোর করা যায়।
app.get('/me/backup', async (c) => {
  const row = await c.env.DB.prepare('SELECT blob, salt, pin_blob, pin_salt FROM key_backups WHERE user_id = ?').bind(c.get('user').id).first<any>()
  return json(row ? { blob: row.blob, salt: row.salt, pinBlob: row.pin_blob || null, pinSalt: row.pin_salt || null } : { blob: null })
})
app.put('/me/backup', async (c) => {
  const { blob, salt, pinBlob, pinSalt } = await c.req.json<any>()
  const hasMain = !!blob && !!salt
  const hasPin = !!pinBlob && !!pinSalt
  if (!hasMain && !hasPin) return err('missing blob/salt')
  // 🔒 সাইজ-ক্যাপ — দুষ্টু ক্লায়েন্ট বিশাল স্ট্রিং দিয়ে D1-রো ফুলিয়ে দিতে
  // পারত (D1-স্টেটমেন্ট ব্যর্থ হলেও আংশিক-লেখার চাপ বসত)। কী-ব্যাকআপ
  // কখনোই কয়েকশ KB-র বেশি হয় না।
  const MAX_BLOB = 900_000
  if (hasMain && (typeof blob !== 'string' || typeof salt !== 'string' || blob.length > MAX_BLOB || salt.length > 200))
    return err('blob too large', 413)
  if (hasPin && (typeof pinBlob !== 'string' || typeof pinSalt !== 'string' || pinBlob.length > MAX_BLOB || pinSalt.length > 200))
    return err('pin blob too large', 413)
  if (hasMain) {
    // মূল ব্লব (+ চাইলে পিন-ব্লব) আপডেট
    await c.env.DB.prepare(
      `INSERT INTO key_backups (user_id, blob, salt, pin_blob, pin_salt, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET blob = excluded.blob, salt = excluded.salt,
         pin_blob = CASE WHEN excluded.pin_blob IS NOT NULL AND excluded.pin_blob <> '' THEN excluded.pin_blob ELSE key_backups.pin_blob END,
         pin_salt = CASE WHEN excluded.pin_salt IS NOT NULL AND excluded.pin_salt <> '' THEN excluded.pin_salt ELSE key_backups.pin_salt END,
         updated_at = excluded.updated_at`,
    ).bind(c.get('user').id, blob, salt, pinBlob || '', pinSalt || '', now()).run()
  } else {
    // শুধু-পিন আপডেট (পিন-লগইন করা ডিভাইস থেকে) — মূল পাসওয়ার্ড-ব্লব অক্ষত
    await c.env.DB.prepare(
      'UPDATE key_backups SET pin_blob = ?, pin_salt = ?, updated_at = ? WHERE user_id = ?',
    ).bind(pinBlob, pinSalt, now(), c.get('user').id).run()
  }
  return json({ ok: true })
})

// ── 🆕 ইউজার-আইডি + পাসকোড ম্যানেজমেন্ট (সেটিংস) ──
// পুরনো অ্যাকাউন্ট (শুধু username+password) এখান থেকেই সেট-আপ করে;
// পাসকোড বদলানো যায় — ইউজার-আইডি ও username বদলানো যায় না (immutable)।
// সব অপারেশনে পাসওয়ার্ড যাচাই বাধ্যতামূলক (ক্লায়েন্ট-হ্যাশড)।
app.post('/me/passcode', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}))
  const me = c.get('user').id
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me).first<any>()
  if (!u) return err('not found', 404)
  // পাসওয়ার্ড যাচাই (ক্লায়েন্ট-হ্যাশ সার্ভার-হ্যাশের সাথে)
  if (!body.password || !(await verifyPassword(String(body.password), u.pass_hash, u.pass_salt)))
    return err('wrong password', 403)

  const passcode = String(body.passcode || '')
  // ক্লায়েন্ট-হ্যাসড পাসকোড (b64u, ~43 অক্ষর) — আসল ৬-৮ ডিজিট-চেক
  // ক্লায়েন্ট-UI-তে হয়ে যায়
  if (passcode.length < 40) return err('passcode must be 6-8 digits')

  // প্রথমবার সেট-আপ: ইউজার-আইডি লাগবে (একবার সেট হলে আর বদলানো যায় না)
  const uidcode = String(body.userIdCode || '').replace(/[^0-9]/g, '')
  if (!u.user_id_code) {
    if (!/^[0-9]{4,12}$/.test(uidcode)) return err('user id must be at least 4 digits (0-9)')
    const taken = await c.env.DB.prepare('SELECT id FROM users WHERE user_id_code = ? AND deleted = 0 AND id != ?').bind(uidcode, me).first()
    if (taken) return err('this user id is already taken', 409)
  }

  const pc = await hashPassword(passcode)
  await c.env.DB.prepare(
    'UPDATE users SET passcode_hash = ?, passcode_salt = ?, user_id_code = ? WHERE id = ?',
  ).bind(pc.hash, pc.salt, u.user_id_code || uidcode, me).run()
  return json({ ok: true, userIdCode: u.user_id_code || uidcode })
})

// ── প্রিকি (X3DH বান্ডল) ──
app.get('/users/:id/prekeys', async (c) => {
  const id = c.req.param('id')
  const k = await c.env.DB.prepare('SELECT * FROM user_keys WHERE user_id = ?').bind(id).first<any>()
  if (!k) return err('no keys', 404)
  // একটি ওয়ান-টাইম প্রিকি ক্লেম করা হয়
  const otk = await c.env.DB.prepare(
    'SELECT id, pub FROM one_time_prekeys WHERE user_id = ? AND claimed = 0 ORDER BY id LIMIT 1',
  ).bind(id).first<any>()
  if (otk) await c.env.DB.prepare('UPDATE one_time_prekeys SET claimed = 1 WHERE id = ?').bind(otk.id).run()
  return json({
    identityPub: JSON.parse(k.identity_pub),
    signPub: JSON.parse(k.sign_pub),
    spkPub: JSON.parse(k.spk_pub),
    spkSig: k.spk_sig,
    opkPub: otk ? JSON.parse(otk.pub) : null,
  })
})

app.post('/me/keys', async (c) => {
  await uploadKeys(c.env, c.get('user').id, await c.req.json())
  return json({ ok: true })
})

// ── Web Push সাবস্ক্রিপশন ──
app.post('/me/push/subscribe', async (c) => {
  const { endpoint, keys } = await c.req.json<any>().catch(() => ({}))
  if (!endpoint || !keys?.p256dh || !keys?.auth) return err('bad subscription')
  // upsert — আগে প্লাইন INSERT ছিল, পুনরায় সাবস্ক্রাইব করলেই ডুপ্লিকেট রো,
  // প্রতি মেসেজে একই নোটিফিকেশন কয়েকবার আসত।
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  ).bind(uid('p_'), c.get('user').id, endpoint, keys.p256dh, keys.auth, now()).run()
  return json({ ok: true })
})
app.get('/push/vapid-public', (c) => json({ key: c.env.VAPID_PUBLIC_KEY || '' }))

// ── অ্যাকাউন্ট ডিলিট (পাসওয়ার্ড কনফার্ম) ──
app.delete('/me/account', async (c) => {
  const { password } = await c.req.json<any>().catch(() => ({}))
  const me = c.get('user').id
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me).first<any>()
  if (!u || !(await verifyPassword(String(password || ''), u.pass_hash, u.pass_salt)))
    return err('wrong password', 403)
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET deleted = 1, about = '', avatar_key = '', pass_hash = '', pass_salt = '', phone = '', email = '', user_id_code = '', passcode_hash = '', passcode_salt = '' WHERE id = ?`).bind(me),
    c.env.DB.prepare('DELETE FROM user_keys WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM one_time_prekeys WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM key_backups WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM devices WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM settings WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM chat_members WHERE user_id = ?').bind(me),
  ])
  // প্রোফাইল ছবিও মুছে ফেলা হয়
  if (u.avatar_key) {
    await c.env.R2.delete(u.avatar_key).catch(() => {})
    // ছোট-ভ্যারিয়েন্টটাও মুছি (`*_small.bin` কনভেনশন)
    await c.env.R2.delete(u.avatar_key.replace(/\.bin$/, '_small.bin')).catch(() => {})
  }
  return json({ ok: true })
})

export default app
