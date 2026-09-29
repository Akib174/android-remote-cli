// /calls/* — Cloudflare Realtime SFU (Calls) প্রক্সি।
// ক্লায়েন্ট কখনো CALLS_API_TOKEN দেখে না; সব রিকোয়েস্ট ওয়ার্কারের মাধ্যমে যায়।
// ডোমেইন/টোকেন — কোনোটাই কোডে হার্ডকোড নেই, সব এনভায়রনমেন্ট বাইন্ডিং।
//
// API আকৃতি (verified: developers.cloudflare.com/realtime OpenAPI + অফিসিয়াল
// video-room উদাহরণের SfuClient-এর সঙ্গে হুবহু মিলিয়ে):
//   POST {base}/apps/{appId}/sessions/new                      → { sessionId }  (বডি লাগে না)
//   POST {base}/apps/{appId}/sessions/{sessionId}/tracks/new   → publish: answer / subscribe: offer+requiresImmediateRenegotiation
//   PUT  {base}/apps/{appId}/sessions/{sessionId}/renegotiate  → subscribe-এর অফারের উত্তর (answer)
//   PUT  {base}/apps/{appId}/sessions/{sessionId}/tracks/close → force-close
// অথ: Authorization: Bearer <App Secret>।
//
// ⚠️ আগের ভার্সনের মূল বাগ: ক্লায়েন্ট এক tracks/new-এ local+remote ট্র্যাক মেশাত
// (API নিয়ম: ব্যাচ হয় সব local, নয় সব remote) এবং SFU-অফারের answer কখনোই
// /renegotiate-এ পাঠাত না — লাইভে 400 decoding_error আসত। এখন প্রতিটি
// পার্টিসিপ্যান্টের আলাদা producer ও consumer সেশন (অফিসিয়াল প্যাটার্ন)।
//
// সেশন-মালিকানা: /session তৈরির সময় sessionId→chatId ম্যাপিং call_sessions
// টেবিলে রাখা হয় — /negotiate, /renegotiate-এ চ্যাট-মেম্বারশিপ যাচাই ছাড়া
// আর কেউ ট্র্যাক ইনজেক্ট করতে পারে না।
import { Hono } from 'hono'
import type { AppContext, Env } from '../types'
import { json, err, now } from '../lib/util'
import { authMiddleware } from '../middleware/auth'

const app = new Hono<AppContext>()
app.use('*', authMiddleware)

async function isMember(env: Env, chatId: string, userId: string) {
  return !!(await env.DB.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').bind(chatId, userId).first())
}

// sessionId → chatId ম্যাপিং থেকে মেম্বারশিপ যাচাই — প্রতিটি SFU-প্রক্সি
// রুটেই লাগে। ম্যাপিং না থাকলে (একই নামের সেশন নয়, তালিকাভুক্ত নয়) প্রত্যাখ্যান।
async function sessionChat(env: Env, sessionId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT chat_id FROM call_sessions WHERE session_id = ?').bind(String(sessionId)).first<any>()
  return row ? String(row.chat_id) : null
}

async function requireMembership(c: any, sessionId: string): Promise<string | null> {
  const chatId = await sessionChat(c.env, sessionId)
  if (!chatId) return null
  if (!(await isMember(c.env, chatId, c.get('user').id))) return null
  return chatId
}

// SFU বেস URL + কনফিগ-চেক। App ID ছাড়া URL-ই ভুল হয়ে যেত (আগের বাগ)।
// ক্রেডেনশিয়াল সাফ করি — PowerShell/CMD-কোটিং দুর্ঘটনায় কোট (" ") বা
// ফাঁকা অক্ষর ঢুকে যায়; Bearer হেডারে গেলেই auth ব্যর্থ হতো।
function clean(v: unknown): string {
  return String(v || '').trim().replace(/^["']+|["']+$/g, '')
}

function sfuCreds(env: Env) {
  const base = (clean(env.CALLS_API_BASE) || 'https://rtc.live.cloudflare.com/v1').replace(/\/+$/, '')
  const appId = clean(env.CALLS_APP_ID).replace(/[^a-zA-Z0-9_-]/g, '')
  const token = clean(env.CALLS_API_TOKEN)
  if (!appId || !token) return null
  return { base: `${base}/apps/${appId}`, token }
}

const NOT_CONFIGURED = 'কল কনফিগার করা হয়নি — ড্যাশবোর্ডের Realtime → Serverless SFU থেকে App ID ও App Secret নিয়ে CALLS_APP_ID ও CALLS_API_TOKEN সেট করুন, তারপর আবার deploy করুন'

// SFU-র ত্রুটিকে ব্যবহারযোগ্য বাংলা রূপে আনি — আগে সব ঢেকে
// "calls api error" দেখাত, আসল কারণ (App ID না ক্রেডেনশিয়াল?) জানা
// যেত না। Cloudflare errorCode/errorDescription-ও সাথে দিই যেন
// সার্ভার ঠিক কী বলেছিল সেটা পরিষ্কার দেখা যায়।
async function sfuFail(res: Response) {
  const raw = await res.text().catch(() => '')
  let code = '', desc = ''
  try {
    const j = JSON.parse(raw)
    code = String(j.errorCode || '')
    desc = String(j.errorDescription || j.message || j.error || '')
  } catch { desc = raw.slice(0, 160) }
  const both = code || desc ? ` (${[code, desc].filter(Boolean).join(': ')})` : ''
  if (res.status === 404 || code === 'not_found' || /does not exist/i.test(desc)) {
    return err(
      `কল অ্যাপ খুঁজে পাওয়া যায়নি — CALLS_APP_ID সম্ভবত ভুল${both}। ড্যাশবোর্ড → Realtime → Serverless SFU → আপনার অ্যাপের App ID (৩২-অক্ষরের হেক্স) কপি করে আবার deploy করুন। অ্যাপ এইমাত্র বানালে ৬০ সেকেন্ড অপেক্ষা করুন`,
      502,
    )
  }
  if (res.status === 401 || res.status === 403 || /auth|credential|token|secret|unauthor|forbidden/i.test(desc)) {
    return err(
      `কল ক্রেডেনশিয়াল প্রত্যাখ্যাত — CALLS_API_TOKEN ভুল${both}। খেয়াল রাখুন: এখানে লাগে অ্যাপটি বানানোর সময় দেখানো ৬৪-অক্ষরের App Secret — ড্যাশবোর্ডের "Create API Token"-এর টোকেন নয়। ঠিক Secret দিয়ে আবার deploy করুন`,
      502,
    )
  }
  if (res.status === 429) return err(`কল API-র rate limit পার হয়েছে — কিছুক্ষণ পরে আবার চেষ্টা করুন${both}`, 502)
  return err(`কল API ত্রুটি — HTTP ${res.status}${both}`, 502)
}

function sfuHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

// নতুন SFU সেশন — প্রতি পার্টিসিপ্যান্ট **দুটি** সেশন নেয় (producer +
// consumer; অফিসিয়াল video-room প্যাটার্ন)। বডি লাগে না — আগে {} পাঠানো
// হতো, স্পেসিফিকেশন বলে "no request body"।
app.post('/session', async (c) => {
  const b = await c.req.json<any>().catch(() => ({}))
  const { chatId } = b
  if (!chatId) return err('missing chatId')
  if (!(await isMember(c.env, chatId, c.get('user').id))) return err('not a member', 403)
  const creds = sfuCreds(c.env)
  if (!creds) return err(NOT_CONFIGURED, 503)
  const res = await fetch(`${creds.base}/sessions/new`, {
    method: 'POST',
    headers: sfuHeaders(creds.token),
    // স্পেসিফিকেশন-ক্যানোনিক্যাল: বডি নেই (আগে JSON.stringify({}) যেত)
  })
  if (!res.ok) return sfuFail(res)
  const out = await res.json<any>().catch(() => null)
  // spec বলে 2xx এলে sessionId থাকার কথা; না থাকলে যা এলো সেটাই দেখাই
  if (!out?.sessionId) {
    const why = out?.errorCode ? ` (${out.errorCode}: ${out.errorDescription || '?'})` : ''
    return err(`কল API থেকে অপ্রত্যাশিত উত্তর${why}`, 502)
  }
  // sessionId → chatId ম্যাপিং রাখি — negotiate/renegotiate/close-এ অথরাইজেশনের জন্য
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO call_sessions (session_id, chat_id, created_by, created_at) VALUES (?,?,?,?)',
  ).bind(String(out.sessionId), String(chatId), c.get('user').id, now()).run().catch(() => {})
  return json({ sessionId: String(out.sessionId) })
})

// ট্র্যাক নেগোসিয়েশন প্রক্সি (tracks/new)।
// ক্লায়েন্ট এখন স্পেসিফিকেশন-ক্যানোনিক্যাল বডি পাঠায়:
//   publish:    { sessionDescription: {type:'offer',sdp}, tracks: [{location:'local', mid, trackName}] }
//   subscribe:  { tracks: [{location:'remote', sessionId, trackName}] }   ← sessionDescription নেই
app.post('/negotiate', async (c) => {
  const { sessionId, body } = await c.req.json<any>().catch(() => ({}))
  if (!sessionId || !body || !Array.isArray(body.tracks)) return err('missing sessionId/tracks')
  if (!(await requireMembership(c, sessionId))) return err('not a member', 403)
  const creds = sfuCreds(c.env)
  if (!creds) return err(NOT_CONFIGURED, 503)
  const res = await fetch(`${creds.base}/sessions/${encodeURIComponent(String(sessionId))}/tracks/new`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sfuHeaders(creds.token) },
    body: JSON.stringify(body),
  })
  if (!res.ok) return sfuFail(res)
  return json(await res.json<any>().catch(() => ({})))
})

// subscribe-এ SFU যে অফার দেয়, তার answer এখানে জমা হয় (PUT renegotiate)।
// আগে এই ধাপটাই ছিল না — রিমোট ট্র্যাকের ডিক্রিপশন-হ্যান্ডশেক অসম্পূর্ণ
// থেকে যেত। বডি: { sessionId, body: { sessionDescription: {type:'answer', sdp} } }
app.put('/renegotiate', async (c) => {
  const { sessionId, body } = await c.req.json<any>().catch(() => ({}))
  if (!sessionId || !body?.sessionDescription) return err('missing sessionId/sessionDescription')
  if (!(await requireMembership(c, sessionId))) return err('not a member', 403)
  const creds = sfuCreds(c.env)
  if (!creds) return err(NOT_CONFIGURED, 503)
  const res = await fetch(`${creds.base}/sessions/${encodeURIComponent(String(sessionId))}/renegotiate`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...sfuHeaders(creds.token) },
    body: JSON.stringify({ sessionDescription: body.sessionDescription }),
  })
  if (!res.ok) return sfuFail(res)
  return json(await res.json<any>().catch(() => ({ ok: true })))
})

// ট্র্যাক force-close (PUT tracks/close) — কল ছাড়ার সমযে ভদ্র পরিচ্ছন্নতা।
app.put('/tracks/close', async (c) => {
  const { sessionId, mids } = await c.req.json<any>().catch(() => ({}))
  if (!sessionId || !Array.isArray(mids) || !mids.length) return json({ ok: true })
  if (!(await requireMembership(c, sessionId))) return err('not a member', 403)
  const creds = sfuCreds(c.env)
  if (!creds) return err(NOT_CONFIGURED, 503)
  const res = await fetch(`${creds.base}/sessions/${encodeURIComponent(String(sessionId))}/tracks/close`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...sfuHeaders(creds.token) },
    body: JSON.stringify({ force: true, tracks: mids.map((m: unknown) => ({ mid: String(m) })) }),
  })
  if (!res.ok) return sfuFail(res)
  return json(await res.json<any>().catch(() => ({ ok: true })))
})

// সেশন বন্ধ — ম্যাপিং-ও পরিষ্কার (মিডিয়া SFU টাইমআউটে নিজেই বন্ধ হয়)
app.post('/session/close', async (c) => {
  const { sessionId } = await c.req.json<any>().catch(() => ({}))
  if (!sessionId) return err('missing sessionId')
  if (!(await requireMembership(c, sessionId))) return err('not a member', 403)
  await c.env.DB.prepare('DELETE FROM call_sessions WHERE session_id = ?').bind(String(sessionId)).run().catch(() => {})
  return json({ ok: true })
})

export default app
