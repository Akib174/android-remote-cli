// fcfc backend entrypoint — Hono router + WebSocket→Durable Object রাউটিং।
import { Hono } from 'hono'
import type { AppContext } from './types'
import { json } from './lib/util'
import { verifyTokenRaw } from './middleware/auth'
import authRoutes from './routes/auth'
import usersRoutes from './routes/users'
import chatsRoutes from './routes/chats'
import mediaRoutes from './routes/media'
import callsRoutes from './routes/calls'
import miscRoutes from './routes/misc'

export { ChatRoom } from './objects/ChatRoom'
export { UserHub } from './objects/UserHub'

const app = new Hono<AppContext>()

// CORS — প্রিফ্লাইট (OPTIONS) মিডলওয়্যারের ভেতরেই শেষ করি, আর বাকি রিকোয়েস্টে
// রেসপন্স তৈরির *পরে* হেডার বসাই, যেন এরর রেসপন্সেও CORS থাকে।
function corsHeaders(origin?: string): Record<string, string> {
  if (!origin) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,range,x-content-type,x-key,x-upload-id,x-part-number',
    'access-control-expose-headers': 'x-file-name,x-file-iv,content-range',
    'access-control-max-age': '86400',
    'vary': 'origin',
  }
}

app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(c.req.header('origin')) })
  }
  await next()
  // WebSocket (101) রেসপন্সের হেডার immutable — সেখানে হেডার বসাতে গেলে throw করে।
  // WS-এর CORS লাগেই না, তাই webSocket রেসপন্স হলে স্কিপ।
  if (c.res && !(c.res as any).webSocket) {
    for (const [k, v] of Object.entries(corsHeaders(c.req.header('origin')))) {
      try { c.res.headers.set(k, v) } catch { /* immutable */ }
    }
  }
})

app.get('/', (c) => json({ name: 'fcfc', ok: true }))

app.route('/auth', authRoutes)
app.route('/', usersRoutes)
app.route('/', chatsRoutes)
app.route('/media', mediaRoutes)
app.route('/calls', callsRoutes)
app.route('/', miscRoutes)

// ── WebSocket → Durable Object ─────────────────────────────────
// প্রতিটি চ্যাটের জন্য আলাদা ChatRoom ইনস্ট্যান্স
app.get('/ws/chat/:chatId', (c) => {
  const id = c.env.CHAT_ROOM.idFromName(c.req.param('chatId'))
  return c.env.CHAT_ROOM.get(id).fetch(c.req.raw)
})

// প্রতিটি ইউজারের জন্য আলাদা UserHub ইনস্ট্যান্স
app.get('/ws/user', async (c) => {
  const user = await verifyTokenRaw(c.env, c.req.query('token') || '')
  if (!user) return new Response('unauthorized', { status: 401 })
  const id = c.env.USER_HUB.idFromName(user.id)
  return c.env.USER_HUB.get(id).fetch(c.req.raw)
})

app.onError((e, c) => {
  console.error('fcfc error:', e)
  // আসল এরর-বার্তাটাও সাথে দিই — লাইভে D1-বাইন্ডিং/টেবিলের সমস্যা হলে
  // ("no such table: users", "database not found" ইত্যাদি) রেসপন্স/লগ
  // থেকেই কারণ বোঝা যায়; নইলে 500-এর পেছনের কারণ অদৃশ্য থেকে যেত।
  const msg = String((e as any)?.message || e).replace(/\s+/g, ' ').slice(0, 300)
  return json({ error: `server error: ${msg}` }, 500)
})

export default app
