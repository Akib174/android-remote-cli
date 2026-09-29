// ChatRoom — প্রতিটি চ্যাট/গ্রুপের জন্য একটি করে Durable Object ইনস্ট্যান্স।
// কাজ: রিয়েল-টাইম মেসেজ রিলে, প্রেজেন্স/টাইপিং, রিসিট, এডিট/ডিলিট-ফর-এভরিওয়ান
// ব্রডকাস্ট (Thanos-vanish), রিয়্যাকশন, পিন, গ্রুপ কল সিগন্যালিং স্টেট।
// মেসেজের বডি এনক্রিপ্টেড — অবজেক্ট কখনো প্লেইনটেক্সট দেখে না।
//
// হাইবারনেশন: সকেটের পরিচয় (userId, chatId) acceptWebSocket-ট্যাগে বাঁধা —
// আগে ইন-মেমোরি Map-এ রাখা হতো, DO ইভিক্ট হলে Map হারিয়ে যেত আর
// প্রতিটি ইনকামিং মেসেজ নীরবে ড্রপ হতো।
import { verifyTokenRaw } from '../middleware/auth'

export class ChatRoom {
  private state: DurableObjectState
  private env: any
  private chatId = ''
  private activeCall: any = null
  private pins: string[] | null = null
  // ⚡ dmGate-এর chat-kind ক্যাশ — DO প্রতি-চ্যাট, kind কখনো বদলায় না।
  // আগে প্রতিটি গ্রুপ-মেসেজেই "SELECT kind FROM chats" চলত — ব্যস্ত গ্রুপে
  // প্রতি মেসেজে একটা করে অপ্রয়োজনীয় DB-রাউন্ডট্রিপ জমত।
  private chatKind: string | null = null

  constructor(state: DurableObjectState, env: any) {
    this.state = state
    this.env = env
  }

  private chatIdFromPath(pathname: string) {
    const segs = pathname.split('/').filter(Boolean)
    return segs[segs.length - 1]
  }

  // সকেটের ট্যাগ থেকে পরিচয় — হাইবারনেশন-সেফ (ট্যাগ: [userId, chatId])।
  // ⚠️ আগে ws.getAttribute(i) ডাকা হতো — সেই API Workers-এ WebSocket-এ নেই
  // (ওটা HTMLRewriter-এর Element-এর মেথড) — প্রতিটি কলই throw করত, catch
  // খালি স্ট্রিং দিত, আর webSocketMessage-এর `if (!from) return` **প্রতিটি
  // ইনকামিং মেসেজ নীরবে ড্রপ** করত — মেসেজ DB-তে ঢোকতই না। সঠিক API:
  // DurableObjectState.getTags(ws)[i]।
  private wsUser(ws: WebSocket): string {
    try { return this.state.getTags(ws)[0] || '' } catch { return '' }
  }
  private wsChat(ws: WebSocket): string {
    try { return this.state.getTags(ws)[1] || '' } catch { return '' }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.headers.get('upgrade') === 'websocket') {
      const user = await verifyTokenRaw(this.env, url.searchParams.get('token') || '')
      if (!user) return new Response('unauthorized', { status: 401 })
      const chatId = this.chatIdFromPath(url.pathname)
      const member = await this.env.DB.prepare(
        'SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?',
      ).bind(chatId, user.id).first()
      if (!member) return new Response('forbidden', { status: 403 })
      // রিভোকড ডিভাইস (Decline-কৃত নতুন লগইন) চ্যাট-রুমেও ঢুকতে পারবে না
      let dev: any = null
      try {
        dev = await this.env.DB.prepare('SELECT approved FROM devices WHERE id = ?').bind(user.deviceId || '').first()
      } catch {}
      if (!dev || dev.approved !== 1) return new Response('device revoked', { status: 403 })

      const pair = new WebSocketPair()
      const server = pair[1]
      // রুমের নিজস্ব chatId (URL থেকে) সকেটের সাথে বেঁধে রাখি —
      // ক্লায়েন্ট পাঠানো msg.chatId আর বিশ্বাস করা হয় না (অন্য চ্যাটে
      // লেখা/মুছার সুযোগ বন্ধ)। ট্যাগ = [userId, chatId]।
      this.state.acceptWebSocket(server, [user.id, chatId])
      this.chatId = chatId

      if (this.pins === null) this.pins = (await this.state.storage.get<string[]>('pins')) || []
      if (this.activeCall === null) this.activeCall = (await this.state.storage.get<any>('activeCall')) || null
      server.send(JSON.stringify({ t: 'hello', call: this.activeCall, pins: this.pins }))
      // বর্তমানে রুমে কানেক্টেড সদস্যদের "online" অবস্থা নতুন সকেটকে জানাই —
      // যেন রিকানেক্টের পরেও কারো প্রেজেন্স পুরনো না থাকে
      const seen = new Set<string>()
      for (const s of this.state.getWebSockets()) {
        if (s === server) continue
        const uid = this.wsUser(s)
        if (uid && uid !== user.id && !seen.has(uid)) {
          seen.add(uid)
          server.send(JSON.stringify({ t: 'presence', userId: uid, online: true }))
        }
      }
      // এই ইউজারের প্রথম সকেট হলেই "online" ব্রডকাস্ট যায়
      if (this.countSockets(user.id) === 1) {
        this.broadcast({ t: 'presence', userId: user.id, online: true }, user.id)
      }
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    // অন্য সার্ভিস থেকে আসা ছোট নোটিফিকেশন (সদস্য পরিবর্তন / কিক ইত্যাদি) —
    // DO শুধু ওয়ার্কারের ভেতর থেকেই অ্যাক্সেসযোগ্য, বাইরে থেকে নয়।
    if (request.method === 'POST') {
      const ev = await request.json<any>().catch(() => null)
      if (!ev) return new Response('bad', { status: 400 })
      if (ev.t === 'kick' && ev.userId) {
        // সদস্য বাদ/সেশন-রিভোক হলে তার এই রুমের সকেট সার্ভার-সাইডে বন্ধ
        for (const ws of this.state.getWebSockets()) {
          if (this.wsUser(ws) === ev.userId) { try { ws.close(4003, 'removed') } catch {} }
        }
        return new Response('ok')
      }
      this.broadcast(ev)
      return new Response('ok')
    }
    return new Response('chatroom', { status: 200 })
  }

  private countSockets(userId: string, exclude?: WebSocket) {
    let n = 0
    for (const ws of this.state.getWebSockets()) if (ws !== exclude && this.wsUser(ws) === userId) n++
    return n
  }

  // 🔒 WS-রেট-লিমিট — মেসেজ-স্প্যাম আটকাই। REST-রুটগুলোতে (লগইন/সাইনআপ/
  // মেটা-প্রিভিউ) rateLimit-আছে, কিন্তু চ্যাট-সকেটে কিছুই ছিল না — একটা
  // দুষ্টু ক্লায়েন্ট লুপে msg পাঠিয়ে প্রতি সেকেন্ডে ডজনখানেক D1-INSERT +
  // ব্রডকাস্ট চালিয়ে যেতে পারত (খরচ + DO-ব্যস্ততা)। DO-মেমোরির স্লাইডিং-
  // উইন্ডো — evict-এ রিসেট হয়, সেটা রেট-লিমিটারের জন্য ঠিকই।
  private msgTimes = new Map<string, number[]>()
  private rateLimited(userId: string, max = 30, windowMs = 10_000): boolean {
    const now = Date.now()
    const arr = (this.msgTimes.get(userId) || []).filter((ts) => now - ts < windowMs)
    if (arr.length >= max) { this.msgTimes.set(userId, arr); return true }
    arr.push(now)
    this.msgTimes.set(userId, arr)
    return false
  }

  private broadcast(msg: any, exceptUserId?: string) {
    const data = JSON.stringify(msg)
    for (const ws of this.state.getWebSockets()) {
      if (exceptUserId && this.wsUser(ws) === exceptUserId) continue
      try { ws.send(data) } catch {}
    }
  }

  // ডিএম-নাকি-গ্রুপ চ্যাট তা একবার খুঁজে ক্যাশ করি (kind কখনো বদলায় না)।
  // কল-এন্ড লজিকে লাগে: ১:১ কলে যে-ই কাটুক দুই পাশই বন্ধ হয়।
  private async ensureKind(chatId: string): Promise<string> {
    if (this.chatKind === null) {
      try {
        const chat = await this.env.DB.prepare('SELECT kind FROM chats WHERE id = ?').bind(chatId).first()
        this.chatKind = chat?.kind || 'group'
      } catch { this.chatKind = 'group' }
    }
    return this.chatKind
  }

  // DM-গেট: "শুধু রিকোয়েস্ট" প্রাইভেসি + ব্লক এখানেই প্রয়োগ হয় —
  private async dmGate(chatId: string, from: string): Promise<boolean> {
    try {
      await this.ensureKind(chatId)
      if (this.chatKind !== 'dm') return true
      const pending = await this.env.DB.prepare(
        "SELECT 1 FROM message_requests WHERE chat_id = ? AND status = 'pending'",
      ).bind(chatId).first()
      if (pending) return false
      const { results: members } = await this.env.DB.prepare(
        'SELECT user_id FROM chat_members WHERE chat_id = ?',
      ).bind(chatId).all()
      const ids = (members || []).map((m: any) => m.user_id)
      if (!ids.includes(from)) return false
      const peer = ids.find((id: string) => id !== from)
      if (peer) {
        const blocked = await this.env.DB.prepare(
          'SELECT 1 FROM blocked WHERE (user_id = ? AND other_id = ?) OR (user_id = ? AND other_id = ?)',
        ).bind(from, peer, peer, from).first()
        if (blocked) return false
      }
      return true
    } catch { return false }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: any
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) } catch { return }
    const from = this.wsUser(ws)
    if (!from) return
    // 🩺 ক্লায়েন্টের লাইভনেস-পিং — ওয়াচডগের জন্য সাথে সাথে উত্তর
    if (msg.t === 'ping') { try { ws.send(JSON.stringify({ t: 'pong' })) } catch {} return }
    // নিরাপত্তা: chatId সবসময় রুমের নিজস্ব আইডি (কানেক্টের সময় URL থেকে নেওয়া)।
    // ক্লায়েন্ট যা পাঠাক না কেন, এই রুমের বাইরে কোনো চ্যাট টাচ করা যাবে না।
    const chatId = this.wsChat(ws) || this.chatId

    switch (msg.t) {
      case 'msg': {
        const m = msg.m
        if (!m?.id || !m?.payload) return
        // type NOT NULL — না দিলে D1-ই নাকচ করত, আর "ghost" ব্রডকাস্ট হতো
        if (typeof m.type !== 'string' || !m.type) return
        // 🔒 স্প্যাম-গার্ড — ১০ সেকেন্ডে সর্বোচ্চ ৩০টা মেসেজ-রো (স্বাভাবিক
        // কথাবার্তায় কখনোই ছোঁায় না; স্প্যামারকে msg-rejected দিয়ে জানাই —
        // ক্লায়েন্ট-UI আগে থেকেই ওটা হ্যান্ডেল করে: ✕-চিহ্ন + টোস্ট)
        if (this.rateLimited(from)) {
          try { ws.send(JSON.stringify({ t: 'msg-rejected', chatId, id: m.id, reason: 'rate-limited' })) } catch {}
          return
        }
        const payload = typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload)
        // D1 স্টেটমেন্ট-লিমিটের নিরাপদ নিচে
        if (payload.length > 90_000) return
        const ts = typeof m.ts === 'number' ? m.ts : Date.now()

        // DM-প্রাইভেসি/ব্লক গেট — ব্যর্থ হলে মেসেজ পার্সিস্টও হয় না
        if (!(await this.dmGate(chatId, from))) {
          try { ws.send(JSON.stringify({ t: 'msg-rejected', chatId, id: m.id, reason: 'request-pending-or-blocked' })) } catch {}
          return
        }
        try {
          const stmts = [
            this.env.DB.prepare(
              'INSERT OR IGNORE INTO messages (mid, chat_id, sender_id, ts, type, payload) VALUES (?,?,?,?,?,?)',
            ).bind(m.id, chatId, from, ts, m.type, payload),
            this.env.DB.prepare('UPDATE chats SET last_ts = ? WHERE id = ?').bind(ts, chatId),
          ]
          // 🆕 সেল্ফ-কপি (নতুন-ডিভাইস ফিক্স): ১:১ প্রেরক নিজের কী-তে এনক্রিপ্টেড
          // কপিও পাঠায় — অন্য ডিভাইস/নতুন লগইনে হিস্টোরি থেকে নিজের মেসেজ
          // ফেরত ডিক্রিপ্ট করা যায় (আগে নিজের পুরনো মেসেজ উধাও হতো)।
          if (m.self) {
            try {
              const selfBlob = JSON.stringify({ ref: m.id, env: m.self })
              if (selfBlob.length <= 90_000) {
                stmts.push(
                  this.env.DB.prepare(
                    'INSERT OR IGNORE INTO messages (mid, chat_id, sender_id, ts, type, payload) VALUES (?,?,?,?,?,?)',
                  ).bind(m.id + '~s', chatId, from, ts, 'self-copy', selfBlob),
                )
              }
            } catch {}
          }
          await this.env.DB.batch(stmts)
        } catch { return } // DB-এ না ঢুকলে ব্রডকাস্টও না — রিলোডে "ghost" মেসেজ এড়াতে
        this.broadcast({ t: 'msg', chatId, m: { ...m, senderId: from } })
        // 🆕 ক্রস-ডিভাইস-ফিক্স: আগে রুমে-কানেক্টেড **ইউজার**-দের হাব-নোটিফাই বাদ
        // যেত — কিন্তু ফিল্টারটা ইউজার-লেভেলে: একই ইউজারের একটা ডিভাইস রুমে থাকলে
        // ওর **অন্য ডিভাইস** (রুমে নেই) আর কিছুই পেত না — অনরিড/প্রিভিউ/কনটেন্ট
        // কিছুই আপডেট হতো না পরের ৬০-সেকেন্ড পোল পর্যন্ত (মূল অভিযোগটাই এটা!)।
        // এখন সব মেম্বারের হাবেই ইভেন্ট যায় — হাব ও-ইউজারের সব ডিভাইসে পৌঁছে
        // দেয়; ক্লায়েন্ট ডিডুপ করে (মেসেজ আগেই এসে থাকলে/চ্যাট খোলা থাকলে
        // আনরিড-নোটিফিকেশন বাদ)। পুশ-স্প্যাম বাড়ে না — সকেট-কানেক্টেড ইউজারের
        // কাছে পুশ যায় না, শুধু লাইভ-ইভেন্ট।
        await this.fanout(chatId, new Set(), { t: 'msg', chatId, from, type: m.type, mid: m.id })
        break
      }
      case 'delivered':
      case 'read':
        this.broadcast({ t: msg.t, chatId, from, ids: Array.isArray(msg.ids) ? msg.ids : [] })
        break
      case 'typing':
        this.broadcast({ t: 'typing', chatId, from, on: !!msg.on }, from)
        break
      case 'renego':
        // র‍্যামচেট রি-নেগোসিয়েশন সংকেত — পাঠানোর পক্ষ নতুন হ্যান্ডশেক শুরু করবে
        this.broadcast({ t: 'renego', chatId, from })
        break
      case 'skrequest':
        // রিসিভারের সেন্ডার-কী নেই (নতুন ডিভাইস/ক্যাশ মুছে গেছে) — সেন্ডার
        // পরের বার্টায় কী পুনঃবণ্টন করবে। রুমে রিলে করলেই হয়।
        this.broadcast({ t: 'skrequest', chatId, from })
        break
      case 'edit': {
        try {
          // পুরনো পেলোডে রিয়্যাকশন জমা থাকে — এডিটে নতুন পেলোড বসানোর সময়
          // সেগুলো বজায় রাখতে হয়, নইলে রিয়্যাকশন হারিয়ে যায়।
          const row = await this.env.DB.prepare('SELECT payload FROM messages WHERE mid = ? AND chat_id = ?').bind(msg.id, chatId).first() as any
          let newPayload = JSON.stringify(msg.payload)
          if (row) {
            try {
              const old = JSON.parse(row.payload)
              if (old && typeof old === 'object' && old.reactions) {
                newPayload = JSON.stringify({ ...msg.payload, reactions: old.reactions })
              }
            } catch {}
          }
          // শুধু নিজের মেসেজই এডিট করা যায় — আগে sender_id চেক ছিল না
          const res = await this.env.DB.prepare('UPDATE messages SET payload = ? WHERE mid = ? AND chat_id = ? AND sender_id = ?')
            .bind(newPayload, msg.id, chatId, from).run()
          // ডিবি-আপডেট সফল হলেই ব্রডকাস্ট — নইলে লাইভ আর হিস্টোরি আলাদা হয়ে যেত
          if (res?.meta?.changes > 0) this.broadcast({ t: 'edit', chatId, from, id: msg.id, payload: msg.payload })
        } catch {}
        break
      }
      case 'delAll': {
        // "Delete for everyone" + Thanos-vanish ব্রডকাস্ট — কোনো ট্রেস থাকে না।
        // শুধু নিজের পাঠানো মেসেজই সবার জন্য ডিলিট করা যায়।
        const ids = (Array.isArray(msg.ids) ? msg.ids : []).map(String).filter(Boolean).slice(0, 100)
        if (ids.length) {
          try {
            await this.env.DB.prepare('UPDATE messages SET deleted = 1 WHERE chat_id = ? AND sender_id = ? AND mid IN (' +
              ids.map(() => '?').join(',') + ')').bind(chatId, from, ...ids).run()
          } catch { return }
        }
        this.broadcast({ t: 'delAll', chatId, from, ids })
        break
      }
      case 'react': {
        try {
          const row = await this.env.DB.prepare('SELECT payload FROM messages WHERE mid = ? AND chat_id = ?').bind(msg.id, chatId).first() as any
          if (row) {
            const p = JSON.parse(row.payload)
            p.reactions = p.reactions || {}
            const list: string[] = p.reactions[msg.emoji] || []
            p.reactions[msg.emoji] = msg.on ? [...new Set([...list, from])] : list.filter((u: string) => u !== from)
            if (!p.reactions[msg.emoji].length) delete p.reactions[msg.emoji]
            await this.env.DB.prepare('UPDATE messages SET payload = ? WHERE mid = ? AND chat_id = ?').bind(JSON.stringify(p), msg.id, chatId).run()
          }
        } catch {}
        this.broadcast({ t: 'react', chatId, from, id: msg.id, emoji: msg.emoji, on: !!msg.on })
        break
      }
      case 'emoji-replay': {
        // 🎭 একক-ইমোজিতে ক্লিক — ephemeral কন্ট্রোল-ইভেন্ট (DB-তে কিছু লেখা হয় না)।
        // রুমে ব্রডকাস্ট করলে ওপাশের ক্লায়েন্টও ১-বার অ্যানিমেশন রিপ্লে করে
        // (উভয় পাশে দেখা যায়)।
        const rid = String(msg.id || '')
        if (rid) this.broadcast({ t: 'emoji-replay', chatId, from, id: rid })
        break
      }
      case 'pin': {
        if (this.pins === null) this.pins = (await this.state.storage.get<string[]>('pins')) || []
        const mid = String(msg.mid || '')
        this.pins = this.pins.includes(mid) ? this.pins.filter((p) => p !== mid) : [...this.pins.slice(-4), mid]
        await this.state.storage.put('pins', this.pins)
        this.broadcast({ t: 'pins', chatId, pins: this.pins, by: from })
        break
      }
      case 'call': {
        // গ্রুপ/১:১ কল সিগন্যালিং স্টেট — চলমান কলে যেকোনো সময় জয়েন করা যায়।
        // স্টোরেজে রাখা হয় — আগে ইন-মেমোরি ছিল, DO রিস্টার্টে কল-স্টেট হারাত।
        //
        // প্রতি পার্টিসিপ্যান্টের নিজের SFU সেশন-আইডি `sessions` ম্যাপে থাকে —
        // অন্য প্রান্ত রিমোট ট্র্যাক pull করার সময় এটাই জানতে হয়।
        // কল-ওনার কেটে দিলে বা সবাই চলে গেলে কল-স্টেট শেষ; একজন বের হলে
        // শুধু তার এন্ট্রি বাদ যায় (বাকিরা কলে থাকে)।
        //
        // 🎮 গেম-মোড স্টেট (activeCall.game):
        //   teams:   uid → তার টিম (নিজেসহ) — ইনভাইটে ঠিক হয়
        //   entered: uid → Enter চেপেছে কিনা
        //   invites: uid → { by, team } — পেন্ডিং ইনভাইট
        // সবাই Enter চাপলে টিম "অ্যাকটিভ" — প্রত্যেক ক্লায়েন্ট নিজের দিকের
        // অডিও নিজেই মিউট/আনমিউট করে (রিসিভ-সাইড ফিল্টারিং)।
        if (msg.action === 'start') {
          const sid = String(msg.call?.sessionId || '')
          this.activeCall = {
            sessionId: sid, mode: msg.call?.mode || 'audio',
            auto: !!msg.call?.auto, // 🔴 লাল-বাটন কল: ওপাশে অটো-ধরা হবে
            startedBy: from, startedAt: Date.now(),
            acceptedAt: null, declinedBy: null, sharing: null,
            sessions: { [from]: sid },
          }
        } else if (msg.action === 'join') {
          const sid = String(msg.join?.sessionId || '')
          const base = this.activeCall || { sessionId: '', mode: msg.call?.mode || 'audio', startedBy: from, startedAt: Date.now(), acceptedAt: null, declinedBy: null, sharing: null, sessions: {} as Record<string, string> }
          // ⏱️ প্রথম join = কল অ্যাকসেপ্ট — কল-হিস্ট্রির duration এখান থেকে হিসাব
          this.activeCall = { ...base, acceptedAt: base.acceptedAt || Date.now(), sessions: { ...(base.sessions || {}), [from]: sid } }
        } else if (msg.action === 'decline') {
          // 📞 ডিক্লাইন — কল-হিস্ট্রিতে declined আউটকামের জন্য চিহ্ন
          if (this.activeCall) this.activeCall = { ...this.activeCall, declinedBy: from }
        } else if (msg.action === 'share') {
          // 🖥️ স্ক্রিনশেয়ার-স্টেট — সবাই যেন বড়-ভিউ (main stage) দেখায়
          if (this.activeCall) {
            const sharing = msg.on ? from : null
            this.activeCall = { ...this.activeCall, sharing }
          }
        } else if (msg.action === 'end') {
          if (this.activeCall) {
            // কল ছেড়ে গেলে তার গেম-স্টেটও পরিষ্কার
            const g = this.activeCall.game
            if (g) this.gameRemoveUser(g, from)
            if (this.activeCall.sharing === from) this.activeCall.sharing = null
            const sessions = { ...(this.activeCall.sessions || {}) }
            delete sessions[from]
            // 🩹 ১:১ (ডিএম) কলে যে-কোনো পাশ কাটলেই কল সম্পূর্ণ শেষ —
            // আগে শুধু কল-শুরু-করা মানুষ বা "শেষ জন" কাটলে ফুল-এন্ড হতো;
            // রিসিভ-পাশ কাটলে কল-স্টেট বেঁচে থাকত (ev.call সত্য) → কলারের
            // কল-UI চিরকাল খোলা থেকে যেত। এখন ডিএম-তে সবসময় ফুল-এন্ড।
            const dm = (await this.ensureKind(chatId)) === 'dm'
            const fullEnd = dm || from === this.activeCall.startedBy || Object.keys(sessions).length === 0
            if (fullEnd) {
              // 📞 কল-হিস্ট্রি লগ — চ্যাটে টেলিগ্রাম-স্টাইল সার্ভিস-পিল হিসেবে দেখায়:
              //   ended → "Outgoing/Incoming (Video) Call (6 minutes, 54 seconds)"
              //   declined/canceled → কলারের কাছে "Canceled Call", পিয়ারের কাছে "Missed Call"
              try {
                const ac = this.activeCall
                const dur = ac.acceptedAt ? Math.max(1, Math.round((Date.now() - ac.acceptedAt) / 1000)) : 0
                const outcome = ac.acceptedAt ? 'ended' : (ac.declinedBy ? 'declined' : 'canceled')
                const mid = 'call_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
                const ts = Date.now()
                const payload = JSON.stringify({ mode: ac.mode || 'audio', outcome, dur })
                await this.env.DB.batch([
                  this.env.DB.prepare(
                    'INSERT OR IGNORE INTO messages (mid, chat_id, sender_id, ts, type, payload) VALUES (?,?,?,?,?,?)',
                  ).bind(mid, chatId, ac.startedBy, ts, 'call', payload),
                  this.env.DB.prepare('UPDATE chats SET last_ts = ? WHERE id = ?').bind(ts, chatId),
                ])
                this.broadcast({ t: 'msg', chatId, m: { id: mid, ts, type: 'call', payload, senderId: ac.startedBy } })
                await this.fanout(chatId, new Set(), { t: 'msg', chatId, from: ac.startedBy, type: 'call', mid })
              } catch {}
              this.activeCall = null
            } else {
              this.activeCall = { ...this.activeCall, sessions }
            }
          }
        } else if (msg.action === 'game-invite') {
          // টিম সিলেক্ট করে ইনভাইট — ইনভাইটার নিজেই এন্টার্ড, বাকিদের Enter লাগবে
          const team = (Array.isArray(msg.team) ? msg.team : []).map(String).filter(Boolean).slice(0, 20)
          if (this.activeCall && team.includes(from)) {
            const game = this.activeCall.game || { teams: {}, entered: {}, invites: {} }
            game.teams[from] = team
            game.entered[from] = true
            for (const u of team) {
              if (u !== from) {
                game.invites[u] = { by: from, team }
                // নতুন ইনভাইটে আগের টিম রিসেট — গ্রুপ সুইচ
                delete game.teams[u]
                delete game.entered[u]
              }
            }
            this.activeCall = { ...this.activeCall, game }
          }
        } else if (msg.action === 'game-enter') {
          const g = this.activeCall?.game
          if (g) {
            const inv = g.invites[from]
            if (inv) {
              g.teams[from] = inv.team
              g.entered[from] = true
              delete g.invites[from]
            }
          }
        } else if (msg.action === 'game-decline') {
          const g = this.activeCall?.game
          if (g) delete g.invites[from]
        } else if (msg.action === 'game-exit') {
          const g = this.activeCall?.game
          if (g) this.gameRemoveUser(g, from)
        }
        await this.state.storage.put('activeCall', this.activeCall).catch(() => {})
        this.broadcast({ t: 'call', chatId, from, action: msg.action, call: this.activeCall, team: msg.team })
        // 📞 রুম-সকেট খোলা নেই এমন সদস্যদেরও (অন্য চ্যাটে/লিস্টে) হাবের
        // মাধ্যমে জানাই — ইনকামিং-কল UI + রিং + গেম-মোড ইভেন্ট পেতে।
        if (msg.action === 'start' || msg.action === 'end' || msg.action === 'decline' || msg.action === 'share' || msg.action.startsWith('game-')) {
          // 🆕 ক্রস-ডিভাইস: কল-ইভেন্টও সব মেম্বারের হাবে — এক ডিভাইস রুমে থাকলেও
          // ওর অন্য ডিভাইসে ইনকামিং-কল/কল-শেষ UI ঠিকঠাক দেখা যায় (সব ডিভাইসে
          // রিং বাজে — টেলিগ্রাম/হোয়াটসঅ্যাপের মতোই)।
          let ev: any = { t: 'call', chatId, from, action: msg.action, call: this.activeCall, team: msg.team }
          if (msg.action === 'start') {
            try {
              const chat = await this.env.DB.prepare('SELECT kind, title FROM chats WHERE id = ?').bind(chatId).first() as any
              if (chat?.title) ev = { ...ev, title: String(chat.title) }
            } catch {}
          }
          await this.fanout(chatId, new Set(), ev)
        }
        break
      }
      case 'call-state':
        try { ws.send(JSON.stringify({ t: 'call', chatId, call: this.activeCall })) } catch {}
        break
      case 'seen-req': {
        // গ্রুপে "কে দেখেছে" — ক্লায়েন্ট-সাইড রিসিট থেকে হিসাব হয়; এখানে শুধু অ্যাক
        try { ws.send(JSON.stringify({ t: 'seen-ack', chatId, ids: msg.ids })) } catch {}
        break
      }
    }
  }

  private async fanout(chatId: string, onlineHere: Set<string>, event: any) {
    try {
      const { results } = await this.env.DB.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').bind(chatId).all()
      // ⚡ ল্যাগ-ফিক্স: আগে প্রতিটি অফলাইন সদস্যের হাব-POST পরপর (sequential)
      // await হতো — ১০০-২০০ সদস্যের গ্রুপে মেসেজের পরে সেকেন্ডখানেটি পুরো DO
      // আটকে থাকত, ওই সময়ে এসেছা টাইপিং/মেসেজ সব জমা পড়ত ("গ্রুপে হঠাৎ
      // ল্যাগ")। এখন সব সমান্তরালে — মোট সময় ধীরতম একটা POST-এর সমান।
      const body = JSON.stringify(event)
      await Promise.allSettled((results || [])
        .filter((r: any) => !onlineHere.has(r.user_id))
        .map((r: any) =>
          this.env.USER_HUB.get(this.env.USER_HUB.idFromName(r.user_id)).fetch(
            `https://hub.internal/notify?uid=${encodeURIComponent(r.user_id)}`,
            { method: 'POST', body },
          ).catch(() => {}),
        ))
    } catch {}
  }

  // গেম-মোড থেকে একজন ইউজারকে সরানো — তার টিম/এন্ট্রি/ইনভাইট +
  // তার পাঠানো পেন্ডিং ইনভাইটগুলোও বাতিল।
  private gameRemoveUser(game: any, userId: string) {
    try {
      delete game.teams[userId]
      delete game.entered[userId]
      delete game.invites[userId]
      for (const [uid, inv] of Object.entries<any>(game.invites || {})) {
        if (inv && inv.by === userId) delete game.invites[uid]
      }
    } catch {}
  }

  async webSocketClose(ws: WebSocket) {
    const userId = this.wsUser(ws)
    // ⚠️ webSocketClose চলাকালীন getWebSockets() এখনো বন্ধ-হওয়া সকেটটাকে
    // ফেরত দেয় — আগে countSockets(userId)===0 কখনোই সত্য হতো না, তাই
    // "অফলাইন" প্রেজেন্স-ব্রডকাস্ট আর লাস্ট-সিন আপডেট কখনোই চলত না
    // (পিয়ার অফলাইনে গেলেও হেডারে চিরকাল "online" দেখাত)।
    // এখন বন্ধ-হওয়া সকেটটাকে বাদ দেওয়া হয়।
    if (userId && this.countSockets(userId, ws) === 0) {
      this.broadcast({ t: 'presence', userId, online: false })
      try {
        await this.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(Date.now(), userId).run()
      } catch {}
    }
  }
}
