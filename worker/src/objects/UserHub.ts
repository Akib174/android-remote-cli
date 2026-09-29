// UserHub — প্রতিটি ইউজারের জন্য একটি করে Durable Object।
// কাজ: (১) ইউজারের সব ডিভাইসের নোটিফিকেশন চ্যানেল (নতুন ডিভাইস লগইন,
// মেসেজ রিকোয়েস্ট, কল, অন্যান্য চ্যাটের মেসেজ), (২) অনলাইন প্রেজেন্স (KV হার্টবিট),
// (৩) অফলাইন হলে Web Push পাঠানো।
//
// হাইবারনেশন: সকেটের পরিচয় (userId, deviceId) ট্যাগ হিসেবে বাঁধা হয় —
// DO ইভিক্ট হয়ে ক্লাস নতুন করে তৈরি হলেও পরিচয় হারায় না। আগে শুধু
// ইন-মেমোরি ফিল্ডে রাখা হতো — ইভিক্টের পরে হার্টবিট/প্রেজেন্স/ব্রডকাস্ট
// সব নীরবে ভেঙে যেত।
import { verifyTokenRaw } from '../middleware/auth'
import { pushToUser } from '../lib/push'

const PUSHABLE = new Set(['msg', 'device-approval', 'message-request', 'request-accepted', 'chat-new', 'call'])

export class UserHub {
  private state: DurableObjectState
  private env: any
  private userId: string

  constructor(state: DurableObjectState, env: any) {
    this.state = state
    this.env = env
    this.userId = ''
  }

  // সকেটের ট্যাগ থেকে পরিচয় — হাইবারনেশন-সেফ (ট্যাগ: [userId, deviceId])।
  // ⚠️ আগে ws.getAttribute(i) ডাকা হতো — Workers-এ WebSocket-এ সেই API নেই
  // (Element-এর মেথড) — প্রতি কলই খালি স্ট্রিং দিত: হার্টবিট (evict-এর পরে),
  // device-revoked কিক, except-ফিল্টার, প্রেজেন্স-ক্লিনআপ সবই চুপচাপ ভাঙা ছিল।
  // সঠিক API: DurableObjectState.getTags(ws)[i]।
  private tag(ws: WebSocket, i: number): string {
    try { return this.state.getTags(ws)[i] || '' } catch { return '' }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.headers.get('upgrade') === 'websocket') {
      const user = await verifyTokenRaw(this.env, url.searchParams.get('token') || '')
      if (!user) return new Response('unauthorized', { status: 401 })
      // হাবের নামই ইউজার আইডি (idFromName(user.id)) — টোকেনের ইউজার মিলতে হবে
      // রিভোকড/অনুমোদনহীন ডিভাইসের হাব-কানেকশনও বন্ধ (Telegram-style decline)
      let dev: any = null
      try {
        dev = await this.env.DB.prepare('SELECT approved FROM devices WHERE id = ?').bind(user.deviceId || '').first()
      } catch {}
      if (!dev || dev.approved !== 1) return new Response('device revoked', { status: 403 })

      const pair = new WebSocketPair()
      const server = pair[1]
      // ট্যাগ: [userId, deviceId] — ইভিক্টের পরেও সকেটের মালিক-পরিচয় টিকে থাকে
      const wasFirst = this.state.getWebSockets().length === 0
      this.state.acceptWebSocket(server, [user.id, user.deviceId || ''])
      await this.env.KV.put(`online:${user.id}`, '1', { expirationTtl: 180 })
      // কানেক্টেই লাস্ট-সিন আপডেট — আগে শুধু সকেট বন্ধ হলে লিখত, তাই
      // ইউজার ঘণ্টার পর ঘণ্টা অনলাইন থাকলেও DB-তে পুরনো টাইমস্ট্যাম্প
      // রয়ে যেত; অফলাইনে গেলেই "onek din age" দেখাত।
      await this.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(Date.now(), user.id).run().catch(() => {})
      this.userId = user.id
      server.send(JSON.stringify({ t: 'hello' }))
      // ⚡ রিয়েল-টাইম প্রেজেন্স: এই ইউজারের প্রথম সকেট খুললেই যারা তার সাথে
      // কোনো চ্যাট শেয়ার করে তাদের হাবে "online" পুশ যায়। আগে শুধু ৬০-সেকেন্ডের
      // পোল/খোলা-চ্যাটের সকেটে জানা পড়ত — পিয়ার অনলাইন হলে "কিছুক্ষণ পরে"
      // দেখা দেওয়ার অভিযোগের কারণ এটাই ছিল।
      if (wasFirst) this.fanoutPresence(user.id, true).catch(() => {})
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    if (request.method === 'POST' && url.pathname === '/notify') {
      const event = await request.json<any>().catch(() => null)
      if (!event) return new Response('bad', { status: 400 })
      const uid = this.userId || url.searchParams.get('uid') || ''

      // রিভোক করা ডিভাইসের হাব-সকেট সার্ভার-সাইডেই বন্ধ করে দিই —
      // Decline-এর পরে ওই ডিভাইস আর লাইভ-ইভেন্ট পাবে না।
      if (event.t === 'device-revoked' && event.deviceId) {
        for (const ws of this.state.getWebSockets()) {
          if (this.tag(ws, 1) === event.deviceId) { try { ws.close(4001, 'device revoked') } catch {} }
        }
      }

      // যে ডিভাইসের কারণে ইভেন্ট (event.except) — সে নিজে এটা পাবে না।
      // যেমন: নতুন-লগইন নোটিফিকেশন নতুন ডিভাইসটি নিজেই পাবে না।
      const sockets = this.state.getWebSockets().filter((ws) => !(event.except && this.tag(ws, 1) === event.except))
      if (sockets.length > 0) {
        const data = JSON.stringify({ t: 'hub', event })
        for (const ws of sockets) { try { ws.send(data) } catch {} }
      } else if (PUSHABLE.has(event.t) && (event.t !== 'call' || event.action === 'start')) {
        // অ্যাপ বন্ধ থাকলেও ডিভাইস ট্রে-তে পুশ যাবে — ইউজারের ভাষা-সেটিং
        // পড়ে ইংরেজি/বাংলা যেটা সেট করা, সেই ভাষায় টাইটেল।
        // (কলের ক্ষেত্রে শুধু start-অ্যাকশনে পুশ — end/decline-এ নয়।)
        const lang = await this.userLang(uid || this.userId)
        const title = pushTitle(event, lang)
        await pushToUser(this.env, this.env.DB, uid || this.userId, {
          title: title[0], body: title[1], tag: `${event.t}-${event.chatId || event.deviceId || uid}`,
          data: { t: event.t, chatId: event.chatId, deviceId: event.deviceId },
        }).catch(() => {})
      }
      return new Response('ok')
    }

    if (request.method === 'GET' && url.pathname === '/online') {
      return new Response(JSON.stringify({ online: this.state.getWebSockets().length > 0 }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response('hub')
  }

  // ইউজারের ভাষা-সেটিং (settings JSON-এ lang ফিল্ড; ডিফল্ট en)
  private async userLang(userId: string): Promise<'en' | 'bn'> {
    try {
      if (!userId) return 'en'
      const s: any = await this.env.DB.prepare('SELECT json FROM settings WHERE user_id = ?').bind(userId).first()
      if (s?.json) {
        const parsed = JSON.parse(s.json)
        if (parsed?.lang === 'bn') return 'bn'
      }
    } catch {}
    return 'en'
  }

  // ⚡ গ্লোবাল-প্রেজেন্স ফ্যানআউট: এই ইউজারের অনলাইন/অফলাইন খবর যাদের
  // সাথে সে কোনো চ্যাট শেয়ার করে, সবার UserHub-এ সমান্তরালে পৌঁছে দেই।
  // প্রত্যেক হাব নিজের সকেটে {t:'presence'} পাঠায় → ক্লায়েন্ট সাথে সাথে
  // চ্যাটলিস্টের ডট + হেডার-সাবটাইটেল আপডেট করে (৬০-সেকেন্ড পোলের দরকার
  // আর পড়ে না; পোলটা সেফটি-নেট হিসেবে ক্লায়েন্টে থেকেই যায়)।
  private async fanoutPresence(userId: string, online: boolean) {
    try {
      const { results } = await this.env.DB.prepare(
        'SELECT DISTINCT b.user_id AS uid FROM chat_members a JOIN chat_members b ON a.chat_id = b.chat_id WHERE a.user_id = ?1 AND b.user_id != ?1',
      ).bind(userId).all()
      const body = JSON.stringify({ t: 'presence', userId, online })
      await Promise.allSettled((results || []).map((r: any) =>
        this.env.USER_HUB.get(this.env.USER_HUB.idFromName(r.uid)).fetch(
          `https://hub.internal/notify?uid=${encodeURIComponent(r.uid)}`,
          { method: 'POST', body },
        ).catch(() => {}),
      ))
    } catch {}
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    try {
      const msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
      // ইভিক্টের পরে this.userId খালি থাকতে পারে — ট্যাগ থেকে ফিরে পাই
      if (!this.userId) this.userId = this.tag(ws, 0)
      if (msg.t === 'hb' && this.userId) {
        await this.env.KV.put(`online:${this.userId}`, '1', { expirationTtl: 180 })
        // হার্টবিটেও লাস্ট-সিন রিফ্রেশ (৪৫ সেকেন্ড পর পর) — অনলাইন
        // থাকাকালীন DB-টাইমস্ট্যাম্প সবসময় তাজা থাকে
        await this.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(Date.now(), this.userId).run().catch(() => {})
        // 🩺 hb-ack — ক্লায়েন্টের ওয়াচডগ এটা না পেলে সকেটটা মৃত ধরে জোর করে
        // রিকানেক্ট করে (নীরব-মৃত সকেট চিরকাল ঝুলে থাকা আটকাতে)
        try { ws.send(JSON.stringify({ t: 'hb-ack' })) } catch {}
      }
      if (msg.t === 'seen' && msg.chatId) {
        // লাস্ট-সিন আপডেট
        if (this.userId) await this.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(Date.now(), this.userId).run()
      }
    } catch {}
  }

  async webSocketClose(ws: WebSocket) {
    // শেষ সকেট বন্ধ হলে প্রেজেন্স অফ
    // ⚠️ webSocketClose চলাকালীন getWebSockets() বন্ধ-হওয়া সকেটটাকেও
    // ফেরত দেয় — আগে length===0 কখনোই সত্য হতো না, তাই KV-র "online"
    // ফ্ল্যাগ আর লাস্ট-সিন কখনোই মুছত/আপডেট হতো না। এখন বাদ দিয়ে গোনা।
    const uid = this.tag(ws, 0) || this.userId
    let others = 0
    for (const s of this.state.getWebSockets()) if (s !== ws) others++
    if (others === 0 && uid) {
      await this.env.KV.delete(`online:${uid}`).catch(() => {})
      await this.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(Date.now(), uid).run().catch(() => {})
      // ⚡ রিয়েল-টাইম প্রেজেন্স — শেষ সকেট বন্ধ হলেই সব শেয়ার্ড-চ্যাট
      // সদস্যের হাবে "offline" পুশ (ক্লায়েন্ট লাস্ট-সিনও সাথে সাথে বসায়)
      await this.fanoutPresence(uid, false).catch(() => {})
    }
  }
}

function pushTitle(event: any, lang: 'en' | 'bn' = 'en'): [string, string] {
  const bn = lang === 'bn'
  switch (event.t) {
    case 'device-approval': return bn
      ? ['fcfc: নতুন ডিভাইসে লগইন', `"${event.deviceName || 'নতুন ডিভাইস'}" থেকে আপনার অ্যাকাউন্টে লগইন হয়েছে — আপনি না হলে অ্যাপ খুলে Decline করুন`]
      : ['fcfc: New device login', `"${event.deviceName || 'new device'}" just logged in to your account — open the app and press Decline if this wasn't you`]
    case 'message-request': return bn
      ? ['fcfc: নতুন মেসেজ রিকোয়েস্ট', 'একজন আপনাকে মেসেজ পাঠাতে চেয়েছেন']
      : ['fcfc: New message request', 'Someone wants to message you']
    case 'request-accepted': return bn
      ? ['fcfc', 'আপনার রিকোয়েস্ট গৃহীত হয়েছে — চ্যাট শুরু করুন']
      : ['fcfc', 'Your request was accepted — start chatting']
    case 'chat-new': return bn
      ? ['fcfc', 'আপনাকে একটি নতুন চ্যাটে যোগ করা হয়েছে']
      : ['fcfc', 'You were added to a new chat']
    case 'msg': return bn
      ? ['fcfc', 'নতুন মেসেজ এসেছে']
      : ['fcfc', 'New message']
    // 🆞 কল-স্টার্ট (গ্রুপ/ডিএম) — অ্যাপ বন্ধ থাকলে ট্রে-তে কলের পুশ
    case 'call': return bn
      ? [event.title ? `📞 ${event.title}` : '📞 fcfc কল', 'একটি কল শুরু হয়েছে — অ্যাপ খুলে যোগ দিন']
      : [event.title ? `📞 ${event.title}` : '📞 fcfc call', 'A call just started — open the app to join']
    default: return bn
      ? ['fcfc', 'নতুন নোটিফিকেশন']
      : ['fcfc', 'New notification']
  }
}
