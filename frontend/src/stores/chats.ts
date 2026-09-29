// মূল চ্যাট স্টোর — রিয়েল-টাইম মেসেজ, এনক্রিপশন/ডিক্রিপশন, রিসিট, ভ্যানিশ,
// রিয়্যাকশন, পিন, স্টার, টাইপিং, প্রেজেন্স, সার্চ, এক্সপোর্ট।
import { create } from 'zustand'
import { api, deviceId } from '../api/client'
import { handlers, connectChat, disconnectChat, sendChat, connectHub, resetSockets } from '../realtime/sockets'
import { encryptFor, decryptFrom, type Envelope } from '../crypto/sessions'
import * as sk from '../crypto/sender'
import { idb } from '../lib/db'
import { uid, URL_RE } from '../lib/utils'
import { useAuth } from './auth'
import { notifyMessage, playPing, playVoiceThroughCtx, stopVoicePlayback } from '../lib/notify'
import { bumpEmojis } from '../lib/emoji'
import { t } from '../lib/i18n'
import { markBackupDirty, mergeRemoteIfFresher, getStoredPasscode } from '../crypto/backup'
import { decryptedMediaUrl } from '../lib/media'
import type { Chat, Message, SendDraft } from '../types'

interface ChatsState {
  booted: boolean
  chats: Record<string, Chat>
  messages: Record<string, Message[]>
  loadedAll: Record<string, boolean>
  activeChatId: string | null
  presence: Record<string, boolean>
  requests: any[]
  vanish: Record<string, boolean>
  starredIds: Record<string, boolean>
  seenBy: Record<string, string[]>
  replyingTo: Message | null
  blockedIds: Record<string, boolean>
  // 🎭 একক-ইমোজির এক-শট অ্যানিমেশন কতবার "প্লে" হলো (msgId → কাউন্টার)
  // ক্লিক বা পিয়ারের ক্লিকে বাড়ে — MessageBubble key হিসেবে ব্যবহার করে
  emojiPlays: Record<string, number>

  boot(): Promise<void>
  reset(): void
  loadChats(): Promise<void>
  loadBlocked(): Promise<void>
  unblock(userId: string): Promise<void>
  openChat(chatId: string): Promise<void>
  closeChat(): void
  loadHistory(chatId: string, before?: number): Promise<void>
  _loadHistory(chatId: string, before?: number): Promise<void>
  sendDraft(chatId: string, draft: SendDraft): Promise<void>
  setTyping(on: boolean): void
  editMessage(chatId: string, id: string, text: string): Promise<void>
  deleteForEveryone(chatId: string, ids: string[]): void
  deleteForMe(chatId: string, ids: string[]): Promise<void>
  finishVanish(chatId: string, ids: string[]): void
  toggleReaction(chatId: string, id: string, emoji: string): void
  toggleStar(msg: Message): Promise<void>
  togglePinMessage(chatId: string, id: string): void
  patchChatState(chatId: string, patch: Record<string, any>): Promise<void>
  markRead(chatId: string): void
  mergeCallSession(chatId: string, userId: string, sessionId: string): void
  setReplying(m: Message | null): void
  jumpToMessage(chatId: string, msgId: string): Promise<boolean>
  localSearch(q: string): Promise<Message[]>
  starredList(): Promise<Message[]>
  exportChat(chatId: string): Promise<void>
  createDm(userId: string): Promise<{ chatId?: string; request?: boolean }>
  openSaved(): Promise<void>
  createGroup(title: string, description: string, memberIds: string[], limit?: number): Promise<string>
  joinInvite(code: string): Promise<string>
  respondRequest(id: string, accept: boolean): Promise<void>
  loadRequests(): Promise<void>
  _event(chatId: string, ev: any): void
  _hub(ev: any): void
  bumpEmojiPlay(chatId: string, id: string): void
  replaySoloEmoji(chatId: string, id: string): void
}

export const useChats = create<ChatsState>((set, get) => ({
  booted: false,
  chats: {},
  messages: {},
  loadedAll: {},
  activeChatId: null,
  presence: {},
  requests: [],
  vanish: {},
  starredIds: {},
  seenBy: {},
  replyingTo: null,
  blockedIds: {},
  emojiPlays: {},

  async boot() {
    if (get().booted) return
    handlers.onChat = (chatId, ev) => get()._event(chatId, ev)
    handlers.onHub = (ev) => get()._hub(ev)
    // (রি)কানেক্ট হলে মিস হওয়া মেসেজ/চ্যাটলিস্ট নিজ থেকেই মিলিয়ে নেওয়া
    handlers.onChatOpen = (chatId) => { get().loadHistory(chatId).catch(() => {}) }
    handlers.onHubOpen = () => { get().loadChats().catch(() => {}); get().loadRequests().catch(() => {}); get().loadBlocked().catch(() => {}); presenceTick().catch(() => {}) }
    connectHub()
    set({ booted: true })
    await get().loadChats()
    get().loadRequests().catch(() => {})
    get().loadBlocked().catch(() => {})
    const stars = await idb.allKeys('starred')
    const starredIds: Record<string, boolean> = {}
    for (const k of stars) starredIds[String(k)] = true
    set({ starredIds })
    startPresencePoll()
    // 🆕 লগইনের-পর অটো-মেসেজ-লোড: চ্যাট লিস্ট শুধু নাম/সময় দেখাত — মেসেজের
    // কনটেন্ট আসত না চ্যাট খোলার আগে (অন্য/নতুন ডিভাইসে হিস্ট্রি “নেই”
    // মনে হতো)। এখন লগইনের পরপরই সব চ্যাটের হিস্ট্রি ব্যাকগ্রাউন্ডে টেনে
    // আনা হয় — ইউজার কিছু টেরও পায় না, লিস্টে প্রিভিউসহ সব তৈরি (টেলিগ্রাম)।
    loadAllHistories().catch(() => {})
  },

  // ইউজার বদলালে/লগআউটে পুরো স্টোর রিসেট — নইলে একই ডিভাইসে user1 লগআউট
  // করে user2 লগইন করলে user1-এর চ্যাট-লিস্ট ইন-মেমরিতে রয়ে গিয়ে user2-এর
  // চ্যাটে দেখা যেত (booted=true থাকায় নতুন loadChats-ই চলত না)।
  // মডিউল-লেভেল ব্ল্যাকলিস্ট/ইন-ফ্লাইটও পরিষ্কার করি — নইলে আগের
  // সেশনের "ডিক্রিপ্ট-ব্যর্থ" তালিকা নতুন লগইনের হিস্ট্রিকেও চুপচাপ লুকিয়ে
  // রাখত (মেসেজ-হারানোর আরেকটা উৎস)।
  reset() {
    stopPresencePoll()
    resetSockets()
    failedDecryptIds.clear()
    skDoneIds.clear()
    historyInflight.clear()
    // 🆕 অটো-লোড-গার্ডও রিসেট — নতুন লগইনে আবার সব হিস্ট্রি লোড হবে
    allHistoriesLoaded = false
    set({
      booted: false, chats: {}, messages: {}, loadedAll: {},
      activeChatId: null, presence: {}, requests: [], vanish: {},
      starredIds: {}, seenBy: {}, replyingTo: null, blockedIds: {},
      emojiPlays: {},
    })
  },

  async loadBlocked() {
    try {
      const { results } = await api('/me/blocked')
      const blockedIds: Record<string, boolean> = {}
      for (const r of results || []) blockedIds[r.id] = true
      set({ blockedIds })
    } catch {}
  },

  async unblock(userId) {
    await api(`/me/blocked/${userId}`, { method: 'DELETE' }).catch(() => {})
    set((s) => {
      const blockedIds = { ...s.blockedIds }
      delete blockedIds[userId]
      return { blockedIds }
    })
  },

  async loadChats() {
    const me = useAuth.getState().user?.id
    const { chats: rows } = await api('/chats')
    const chats: Record<string, Chat> = {}
    for (const r of rows) {
      // "Delete for me"-চ্যাট লুকানো — সার্ভার এখন ফিল্টার করেই দেয়, এটা
      // বেল্ট-অ্যান্ড-সাসপেন্ডার: ডিলিটের পরে নতুন কোনো মেসেজ না এলে
      // (last_ts ≤ deleted_before) চ্যাট লিস্টে ফেরত আসে না।
      if (r.deleted_before && (!r.last_ts || r.deleted_before >= r.last_ts)) continue
      const c: Chat = {
        id: r.id, kind: r.kind, title: r.title || '', photoKey: r.photo_key || '',
        description: r.description || '', memberLimit: r.member_limit,
        members: [],
        pinned: !!r.pinned, archived: !!r.archived, mutedUntil: r.muted_until || 0,
        wallpaper: r.wallpaper || '', ttl: r.ttl || 0,
        likeEmoji: r.like_emoji || '',
        unread: r.unread || 0, lastTs: r.last_ts || 0,
      }
      chats[r.id] = c
    }
    // DM-এর জন্য পিয়ার তথ্য (self-chat = Saved Messages — peer নেই, saved-ফ্ল্যাগ)
    const dmChats = rows.filter((r: any) => r.kind === 'dm')
    if (dmChats.length) {
      for (const r of dmChats) {
        try {
          const detail = await api(`/chats/${r.id}`)
          const peer = detail.members.find((m: any) => m.id !== me)
          if (peer) {
            chats[r.id].peer = {
              id: peer.id, username: peer.username, name: peer.name || '', userIdCode: peer.user_id_code || '',
              about: peer.about,
              avatarKey: peer.avatar_key, deleted: !!peer.deleted,
              // লাস্ট-সিন আগে কখনোই পিয়ারে বসানো হতো না — হেডারে চিরকাল
              // "অনেক দিন আগে" দেখাত। এখন members-কোয়েরি এটা ফেরত দেয়।
              lastSeenAt: peer.last_seen_at || 0,
              lastSeenPriv: peer.lastseen_priv,
            }
            chats[r.id].members = detail.members
          } else {
            // একমাত্র মেম্বর আমিই — Saved Messages চ্যাট
            chats[r.id].saved = true
            chats[r.id].members = detail.members
          }
        } catch {}
      }
    }
    // গ্রুপ মেম্বার (ছোট স্কেল — প্রতি গ্রুপে ১টি কল)
    for (const r of rows.filter((x: any) => x.kind === 'group')) {
      try {
        const detail = await api(`/chats/${r.id}`)
        chats[r.id].members = detail.members
      } catch {}
    }
    set({ chats })
    // 🐛 প্রেজেন্স-ফিক্স: চ্যাটলিস্ট লোড হওয়ার সাথে সাথেই সব DM-পিয়ারের
    // অনলাইন-স্ট্যাটাস এক কলে এনে বসিয়ে দিই। আগে প্রথম প্রেজেন্স-পোল ৬০
    // সেকেন্ড পরে হতো — লগইনের পরপরই খোলা চ্যাটে পিয়ার অনলাইন থাকলেও
    // "last seen" দেখাত ("অনলাইন হলেও অনেকক্ষণ পরে online দেখায়")।
    {
      const ids = Object.values(chats)
        .filter((c) => c.kind === 'dm' && c.peer && c.peer.id !== me && !c.peer.deleted)
        .map((c) => c.peer!.id)
      if (ids.length) {
        api(`/users/presence?ids=${encodeURIComponent(ids.join(','))}`).then((out: any) => {
          useChats.setState((st) => {
            let changed = false
            const presence = { ...st.presence }
            for (const k of Object.keys(out || {})) {
              if (presence[k] !== !!out[k]) { presence[k] = !!out[k]; changed = true }
            }
            return changed ? { presence } : st
          })
        }).catch(() => {})
      }
    }
    // 🐛 সাদা-স্ক্রিন ফিক্স (বেল্ট-অ্যান্ড-সাসপেন্ডার): সার্ভার-রিফ্রেশে যদি
    // active চ্যাট নতুন লিস্টে না থাকে (অন্য ডিভাইস থেকে ডিলিট/বাদ পড়া),
    // activeChatId পরিষ্কার — নইলে ফাঁকা চ্যাট-এরিয়া ঝুলে থাকত।
    if (get().activeChatId && !chats[get().activeChatId!]) {
      set({ activeChatId: null, replyingTo: null })
    }
    // লোকাল ক্যাশ থেকে শেষ মেসেজ প্রিভিউ
    for (const id of Object.keys(chats)) {
      const cached = await lastLocalMessage(id)
      if (cached) set((s) => ({ chats: { ...s.chats, [id]: { ...s.chats[id], lastPreview: previewOf(cached), lastTs: cached.ts } } }))
    }
  },

  async openChat(chatId) {
    const me = useAuth.getState().user?.id
    if (!get().chats[chatId]) {
      try {
        const detail = await api(`/chats/${chatId}`)
        const c = detail.chat
        const chat: Chat = {
          id: c.id, kind: c.kind, title: c.title, photoKey: c.photo_key, description: c.description,
          memberLimit: c.member_limit, members: detail.members, unread: 0,
        }
        if (c.kind === 'dm') {
          const peer = detail.members.find((m: any) => m.id !== me)
          if (peer) chat.peer = {
            id: peer.id, username: peer.username, name: peer.name || '', userIdCode: peer.user_id_code || '',
            about: peer.about,
            avatarKey: peer.avatar_key, deleted: !!peer.deleted,
            lastSeenAt: peer.last_seen_at || 0, lastSeenPriv: peer.lastseen_priv,
          }
          else chat.saved = true // নিজেই একমাত্র মেম্বর — Saved Messages
        }
        set((s) => ({ chats: { ...s.chats, [chatId]: chat } }))
      } catch {}
    } else if (get().chats[chatId]?.kind === 'dm') {
      // চ্যাট খোলার সময় পিয়ারের লাস্ট-সিন একবার ফ্রেশ করি —
      // স্টোরে পুরনো স্ন্যাপশট রয়ে গিয়ে "onek din age" দেখাত।
      const peer = get().chats[chatId].peer
      if (peer) {
        api(`/users/${peer.id}`).then((r: any) => {
          if (r?.user) set((s) => ({
            chats: s.chats[chatId] ? {
              ...s.chats,
              [chatId]: { ...s.chats[chatId], peer: { ...s.chats[chatId].peer!, name: r.user.name || '', lastSeenAt: r.user.lastSeenAt || 0, lastSeenPriv: r.user.lastSeenPriv } },
            } : s.chats,
          }))
        }).catch(() => {})
        // 🐛 প্রেজেন্স-ফিক্স: পিয়ারের অনলাইন-স্ট্যাটাসও সাথে সাথে — আগে
        // চ্যাট খুললে "online" দেখতে ৬০ সেকেন্ড/পরের ইভেন্ট পর্যন্ত অপেক্ষা।
        api(`/users/presence?ids=${encodeURIComponent(peer.id)}`).then((out: any) => {
          const online = !!(out && out[peer.id])
          useChats.setState((s) => (s.presence[peer.id] === online ? s : { presence: { ...s.presence, [peer.id]: online } }))
        }).catch(() => {})
      }
    }
    set({ activeChatId: chatId })
    // অন্য চ্যাটে গেলে প্রোফাইল-প্যানেল বন্ধ (টেলিগ্রামের মতো) — নইলে পুরনো
    // চ্যাটের প্যানেল নতুন চ্যাটের পাশে ঝুলে থাকত।
    try { useUi.getState().closeRightPanel() } catch {}
    connectChat(chatId)
    // খালি-অ্যারে থাকলেও (আগের ব্যর্থ লোড) আবার চেষ্টা করি — নইলে একবার
    // ব্যর্থ হলে ওই চ্যাট রিলোড পর্যন্ত চিরকাল খালি থেকে যেত।
    if (!get().messages[chatId] || !(get().messages[chatId] || []).length) {
      set((s) => ({ messages: { ...s.messages, [chatId]: [] } }))
      await get().loadHistory(chatId)
    }
    get().markRead(chatId)
  },

  closeChat() {
    const id = get().activeChatId
    if (id) disconnectChat(id)
    // ⚠️ পেন্ডিং (🕓) মেসেজ থাকলে সেগুলো আর একো পাবে না — কিন্তু আউটবক্স
    // এখন সংরক্ষিত (disconnectChat-এ কিউ ফেলা হয় না), পরে চ্যাট খুললে
    // পাঠানো+হিস্ট্রি-হিল হবে। এখানে কিছু ব্যর্থ-চিহ্নিত করি না।
    set({ activeChatId: null, replyingTo: null })
  },

  async loadHistory(chatId, before) {
    // একই চ্যাটের সমান্তরাল দুটি লোড (openChat + সকেট-ওপেন দুটোই ডাকত)
    // একই রো দুবার প্রসেস করত — র‍্যামচেট-কী দুবার খরচ হয়ে দ্বিতীয়বার
    // OperationError, আর sender-key ইনজেস্টও দুবার চলত। ইন-ফ্লাইট শেয়ার।
    const key = chatId + ':' + (before || '')
    const running = historyInflight.get(key)
    if (running) return running
    const p = get()._loadHistory(chatId, before).finally(() => historyInflight.delete(key))
    historyInflight.set(key, p)
    return p
  },

  async _loadHistory(chatId, before) {
    const rows = await api(`/chats/${chatId}/messages?before=${before || ''}&limit=80`)
    const known = new Set((get().messages[chatId] || []).map((m) => m.id))
    // "শুধু আমার থেকে ডিলিট"-এর টম্বস্টোন — রিলোডে সার্ভার-হিস্টোরি
    // থেকে মেসেজ ফিরে আসা আটকাই (গ্রুপ-মেসেজ রি-ডিক্রিপ্টযোগ্য বলে ফিরত)।
    let tomb: string[] = []
    try { tomb = (await idb.get('meta', `del:${chatId}`)) || [] } catch {}
    const tombSet = new Set(tomb)
    const me = useAuth.getState().user?.id

    // 🆕 সেল্ফ-কপি রো আগে ম্যাপে তুলি (ref-mid → নিজের কী-তে এনক্রিপ্টেড কপি) —
    // নতুন ডিভাইসে নিজের ১:১ মেসেজ ক্যাশ-ছাড়াই এখান থেকে ডিক্রিপ্ট হয়
    const selfCopies = new Map<string, any>()
    for (const r of rows.messages) {
      if (r.type !== 'self-copy' || r.sender_id !== me) continue
      try {
        const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
        if (p?.ref && p?.env) selfCopies.set(String(p.ref), p.env)
      } catch {}
    }

    // ── পাস ১: sender-key রো আগে ইনজেস্ট ──
    // সার্ভার ASC অর্ডারে রো দেয়, আর sk-মেসেজের ts প্রায়ই এনক্রিপ্ট-করা
    // মেসেজের ts-এর পরে। কী-এর আগে মেসেজ প্রসেস হলে "sender key missing"
    // হয়ে মেসেজ ব্ল্যাকলিস্টে যেত — গ্রুপের প্রথম-খোলা মেসেজ পেজ
    // রিলোড পর্যন্ত অদৃশ্য থাকত।
    for (const r of rows.messages) {
      if (r.type !== 'sender-key' || !r.mid) continue
      if (known.has(r.mid) || skDoneIds.has(r.mid) || tombSet.has(r.mid)) continue
      if (r.sender_id === me) { skDoneIds.add(r.mid); continue }
      try {
        if (await sk.hasSenderKey(chatId, r.sender_id)) { skDoneIds.add(r.mid); continue }
        const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
        const plain = await decryptFrom(r.sender_id, payload as Envelope)
        if (plain?.sk) await sk.ingestSenderKey(plain.chatId || chatId, r.sender_id, plain.sk)
        skDoneIds.add(r.mid)
      } catch { /* পিয়ার-সেশন সারলে পরের লোডে আবার চেষ্টা */ }
    }

    // ── পাস ২: সাধারণ মেসেজ-রো ──
    const msgs: Message[] = []
    let decryptFailed = false
    for (const r of rows.messages) {
      if (r.type === 'sender-key' || r.type === 'self-copy') continue
      if (tombSet.has(r.mid) || known.has(r.mid) || failedDecryptIds.has(r.mid)) continue
      const m = await rowToMessage(chatId, r, selfCopies.get(r.mid))
      if (m) msgs.push(m)
      else {
        if (failedDecryptIds.has(r.mid)) decryptFailed = true
        // গ্রুপ-মেসেজের কী নেই হলে (নতুন ডিভাইস/ক্যাশ ক্লিয়ার) — সেন্ডারকে পুনর্বণ্টন চাই
        if (!m && r.sender_id !== me && get().chats[chatId]?.kind === 'group') {
          sk.hasSenderKey(chatId, r.sender_id).then((has) => { if (!has) requestSenderKey(chatId) }).catch(() => {})
        }
      }
    }
    set((s) => {
      const existing = s.messages[chatId] || []
      const ids = new Set(msgs.map((m) => m.id))
      const merged = [...msgs, ...existing.filter((m) => !ids.has(m.id))]
      merged.sort((a, b) => a.ts - b.ts)
      // "আর নেই" ফ্ল্যাগ সার্ভার-ফেরত রো-সংখ্যা দিয়ে হিসাব করি — ডিক্রিপ্ট-
      // ব্যর্থ/ডুপ্লিকেট বাদ পড়লেও পেজিনেশন অসময়ে থেমে যেত না।
      return { messages: { ...s.messages, [chatId]: merged }, loadedAll: { ...s.loadedAll, [chatId]: rows.messages.length < 80 } }
    })
    // 🆕 লিস্ট-প্রিভিউ ফ্রেশ-আপ: লোকাল-ক্যাশ-ভিত্তিক প্রিভিউ খালি/পুরনো থাকলে
    // (নতুন ডিভাইস, অটো-লোড, ক্রস-ডিভাইস রিলোড) সদ্য-লোড হওয়া শেষ
    // মেসেজ থেকেই প্রিভিউ বসে — লিস্টে মেসেজ-কনটেন্ট দেখা যায় চ্যাট
    // না খুলেও।
    {
      const list = get().messages[chatId] || []
      const lastMsg = list.length ? list[list.length - 1] : null
      if (lastMsg) set((s) => {
        const c = s.chats[chatId]
        if (!c) return s
        const newTs = Math.max(c.lastTs || 0, lastMsg.ts)
        const needPreview = !c.lastPreview || lastMsg.ts >= (c.lastTs || 0)
        const newPreview = needPreview ? previewOf(lastMsg) : c.lastPreview
        if (newPreview === c.lastPreview && newTs === (c.lastTs || 0)) return s
        return { chats: { ...s.chats, [chatId]: { ...c, lastPreview: newPreview, lastTs: newTs } } }
      })
    }
    // 🆕 গ্যাপ-হিল: সার্ভারের সর্বশেষ পেজে এমন রো আছে যে আমাদের লিস্টে
    // ঢোকেনি (নিজের অন্য-ডিভাইসের self-copy ডিক্রিপ্ট-ব্যর্থ, বা সেশন
    // পিছিয়ে আছে) → রিমোট কী-ব্যাকআপ রি-পুল (পাঠানো ডিভাইস ৬ সেকেন্ডের
    // কুইক-সিঙ্কে সেশন + ডিক্রিপ্টেড মেসেজ-ক্যাশ জমা রেখেছে) → মার্জ করে
    // হিস্ট্রি আবার টানি — মেসেজ ক্যাশ থেকেই রেন্ডার হয়ে যায়।
    if (!before) {
      const localIds = new Set((get().messages[chatId] || []).map((m) => m.id))
      const missing = rows.messages.filter((r: any) =>
        r.type !== 'sender-key' && r.type !== 'self-copy' && !localIds.has(r.mid))
      if (missing.length) {
        const newest = missing[missing.length - 1]
        if (Date.now() - (newest.ts || 0) < 30 * 60_000) scheduleBackupGapHeal(chatId)
      }
    }
    // 🔴 অফলাইনে-পাওয়া লাল-ভয়েস: রিসিভ-সময়ে অ্যাপ বন্ধ/নেট-ড্রপ ছিল মানে
    // লাইভ-পথে autoPlayVoice আর ডাকাই হয়নি — হিস্ট্রি-পথে এসে চিরকাল নীরব
    // থাকত। সদ্য-পাঠানো (৩ মিনিটের ভেতরের) পিয়ার-ভয়েস হলে এখানেও বাজাই।
    // (autoPlayedVoiceIds-সেট থাকায় একই মেসেজ দুইবার বাজবে না; পুরনো
    // হিস্ট্রি-স্ক্রলে পুরোনো ভয়েস বেজে ওঠে না।)
    if (!before) {
      const me2 = useAuth.getState().user?.id
      for (const m of msgs) {
        if (m.type === 'voice' && (m as any).ap && m.senderId !== me2 && Date.now() - m.ts < 3 * 60_000) {
          autoPlayVoice(m).catch(() => {})
        }
      }
    }
    // 🩹 হিস্ট্রি-হিল: সার্ভার-রো-তে থাকা লোকাল-মেসেজ যদি এখনো pending/
    // failed দেখায় (একো মিস — যেমন পাঠানোর পরপরই চ্যাট বন্ধ/সকেট ড্রপ)
    // তাহলে ✓ বসিয়ে দিই — সার্ভারে তো ওটা আছেই।
    {
      const rowIds = new Set(rows.messages.map((r: any) => r.mid))
      set((s) => {
        const list = s.messages[chatId] || []
        let changed = false
        const next = list.map((m) => rowIds.has(m.id) && (m.pending || m.failed)
          ? (changed = true, { ...m, pending: false, failed: false }) : m)
        return changed ? { messages: { ...s.messages, [chatId]: next } } : s
      })
    }
    // ডিসঅ্যাপিয়ারিং মেসেজ — লাইভ পাথে নতুনগুলোর টাইমার বসত, হিস্টোরিতে
    // এলে আর বসত না; মেয়াদোত্তীর্ণগুলো চিরকাল দেখা যেত।
    for (const m of msgs) {
      if (!m.expiresAt) continue
      if (m.expiresAt <= Date.now()) get().deleteForMe(chatId, [m.id])
      else scheduleExpiry(chatId, m.id, m.expiresAt)
    }
    // হিস্টোরিতে ডিক্রিপ্ট-ব্যর্থ রো থাকলে এখান থেকেও renego পাঠাই।
    if (decryptFailed && Date.now() - (lastRenego[chatId] || 0) > 10000) {
      const peer = get().chats[chatId]?.peer
      if (me && peer && peer.id !== me) {
        lastRenego[chatId] = Date.now()
        sendChat(chatId, { t: 'renego', chatId, from: me })
      }
    }
  },

  async sendDraft(chatId, draft) {
    const me = useAuth.getState().user!
    const chat = get().chats[chatId]
    if (!chat) return
    const id = uid('m_')
    // ⚠️ মেসেজ-ক্রম বাগের ফিক্স: দুই ডিভাইসের ঘড়ি আলাদা হলে (এমনকি ১-২
    // সেকেন্ড) পিয়ারের মেসেজের ts আমার রিপ্লাইয়ের ts-এর চেয়ে বড় হতে
    // পারত — আমার রিপ্লাই আগের মেসেজের *উপরে* উঠে যেত। এখন প্রতি-চ্যাট
    // মনোটোনিক: আমার ts কখনোই চ্যাটের শেষ ts-এর চেয়ে ছোট নয়।
    const list = get().messages[chatId] || []
    const ts = Math.max(Date.now(), (list.length ? list[list.length - 1].ts : 0) + 1)
    const expiresAt = draft.ttl ? ts + draft.ttl * 1000 : undefined
    const local: Message = {
      id, chatId, senderId: me.id, ts, type: draft.type, body: draft.body,
      media: draft.media, replyTo: draft.replyTo, fwdFrom: draft.fwdFrom,
      reactions: {}, pending: true, expiresAt,
      ap: draft.type === 'voice' ? !!draft.autoPlay : undefined,
    }
    appendMessage(chatId, local)
    setReplyingPreview(chatId, local)
    // প্রায়ই-ব্যবহৃত ইমোজির গণনা — পিকারের "Recent" সেকশনের জন্য
    if (draft.body) bumpEmojis(draft.body)

    try {
      const plain: any = { body: draft.body, media: draft.media, replyTo: draft.replyTo, fwdFrom: draft.fwdFrom, expiresAt }
      // 🔴 ভয়েস অটো-প্লে ফ্ল্যাগ — এনক্রিপ্টেড পেলোডের ভেতরেই যায়
      if (draft.autoPlay) plain.ap = true
      let payload: any
      let selfEnv: any = undefined
      if (chat.kind === 'group') {
        // sk-বণ্টন আগে, আর তার ts মেসেজের ts-এর চেয়ে ছোট — নইলে ASC
        // হিস্টোরিতে কী-এর আগে মেসেজ এসে ডিক্রিপ্ট ব্যর্থ হত।
        await distributeSenderKeys(chatId, chat, ts)
        payload = await sk.groupEncrypt(chatId, me.id, plain)
      } else {
        // 📌 Saved Messages (self-chat): peer নেই — নিজের কী-তেই এনক্রিপ্ট
        // হয়, হিস্ট্রি self-copy থেকে যেকোনো ডিভাইসে ফেরত আসে।
        const targetId = chat.peer?.id || me.id
        payload = await encryptFor(targetId, plain)
        // 🆕 সেল্ফ-কপি (নতুন-ডিভাইস ফিক্স): ১:১-মেসেজ পিয়ারের কী-তে
        // এনক্রিপ্ট হয় — নিজের অন্য ডিভাইস এটা ডিক্রিপ্ট করতে পারে না
        // (ক্যাশ না থাকলে হিস্টোরিতে নিজের মেসেজই হারিয়ে যেত)। তাই নিজের
        // কী-তে এনক্রিপ্ট করা একটা কপিও সার্ভারে জমা যায় — যেকোনো নতুন
        // ডিভাইস হিস্টোরি থেকে নিজের পুরো মেসেজ ফেরত পায় (টেলিগ্রাম-স্টাইল)।
        try { selfEnv = await encryptFor(me.id, plain) } catch {}
      }
      sendChat(chatId, { t: 'msg', chatId, m: { id, ts, type: draft.type, payload, self: selfEnv } })
      // ⚠️ আর এখানেই pending:false করা হয় না — সার্ভার-একো (রুম-ব্রডকাস্ট
      // নিজের কাছেই ফেরে) এলেই _event 'msg' সেটি নামায়। আগে WS-এ write হতে
      // দেখেই "✓ পাঠানো" দেখাত — সকেট কানেক্টিং থাকলে আউটবক্সে জমে থাকত,
      // আর disconnectChat কিউ ফেলে দিলে মেসেজ **চিরকাল ✓-সহ উধাও** হতো
      // (নীরব মেসেজ-লস)। এখন ✓ = সার্ভারে সত্যিই সেভ+ব্রডকাস্ট হয়েছে।
    } catch (e) {
      set((s) => ({ messages: { ...s.messages, [chatId]: (s.messages[chatId] || []).map((m) => m.id === id ? { ...m, pending: false, failed: true } : m) } }))
      console.error('send failed', e)
    }
    if (get().replyingTo) set({ replyingTo: null })
  },

  setTyping(on) {
    const chatId = get().activeChatId
    if (chatId) sendChat(chatId, { t: 'typing', chatId, on })
  },

  async editMessage(chatId, id, text) {
    const chat = get().chats[chatId]
    if (!chat) return
    const plain: any = { body: text, edited: true }
    let payload: any
    if (chat.kind === 'group') payload = await sk.groupEncrypt(chatId, useAuth.getState().user!.id, plain)
    else payload = await encryptFor(chat.peer!.id, plain)
    sendChat(chatId, { t: 'edit', chatId, id, payload })
    applyEdit(chatId, id, text)
  },

  // "Delete for everyone" — সব ডিভাইসে Thanos-ভ্যানিশ
  deleteForEveryone(chatId, ids) {
    sendChat(chatId, { t: 'delAll', chatId, ids })
    set((s) => ({ vanish: { ...s.vanish, ...Object.fromEntries(ids.map((i) => [i, true])) } }))
  },

  async deleteForMe(chatId, ids) {
    set((s) => ({
      messages: { ...s.messages, [chatId]: (s.messages[chatId] || []).filter((m) => !ids.includes(m.id)) },
    }))
    for (const id of ids) idb.del('messages', id).catch(() => {})
    // টম্বস্টোন রাখি — নইলে রিলোডে সার্ভার-হিস্টোরি থেকে ফিরে আসত
    // (গ্রুপ-মেসেজ রি-ডিক্রিপ্টযোগ্য, ১:১-ও ক্যাশ এখন সব মেসেজে)।
    try {
      const key = `del:${chatId}`
      const t: string[] = (await idb.get('meta', key)) || []
      await idb.put('meta', key, [...new Set([...t, ...ids])]).catch(() => {})
    } catch {}
  },

  finishVanish(chatId, ids) {
    set((s) => {
      const v = { ...s.vanish }
      for (const i of ids) delete v[i]
      return {
        vanish: v,
        messages: { ...s.messages, [chatId]: (s.messages[chatId] || []).filter((m) => !ids.includes(m.id)) },
      }
    })
    for (const id of ids) idb.del('messages', id).catch(() => {})
  },

  toggleReaction(chatId, id, emoji) {
    const me = useAuth.getState().user!.id
    // আগে সবসময় on:true পাঠানো হতো — নিজের রিয়্যাকশন সরানোই যেত না।
    // এখন আমার রিয়্যাকশন আগে থেকে থাকলে বন্ধ (off) করি।
    const msg = (get().messages[chatId] || []).find((m) => m.id === id)
    const on = !(msg?.reactions?.[emoji] || []).includes(me)
    sendChat(chatId, { t: 'react', chatId, id, emoji, on })
    applyReaction(chatId, id, emoji, me, on)
  },

  async toggleStar(msg) {
    const on = !get().starredIds[msg.id]
    set((s) => ({ starredIds: { ...s.starredIds, [msg.id]: on } }))
    if (on) await idb.put('starred', msg.id, { ...msg, starred: true })
    else await idb.del('starred', msg.id)
  },

  togglePinMessage(chatId, id) {
    sendChat(chatId, { t: 'pin', chatId, mid: id })
  },

  async patchChatState(chatId, patch) {
    await api(`/me/chats/${chatId}/state`, { method: 'PATCH', body: patch })
    if (patch.deleteForMe) {
      // "চ্যাট ডিলিট (আমার)" — লোকাল স্টেট থেকেও সরিয়ে দিই, নইলে রিলোড
      // পর্যন্ত মেসেজ/প্রিভিউ দেখে থেকে যেত।
      // ⚠️ বাগ-ফিক্স: লোকাল IndexedDB-র মেসেজ-ক্যাশও এখন মুছি — নইলে
      // রিলোডের পরেও সার্চ-রেজাল্ট/লাস্ট-প্রিভিউতে ডিলিট করা চ্যাটের
      // মেসেজ ফিরে আসত (server deleted_before শুধু হিস্টোরি-API আটকাত)।
      try {
        const all = await idb.all<Message>('messages')
        for (const m of all) if (m.chatId === chatId) idb.del('messages', m.id).catch(() => {})
      } catch {}
      // 🐛 সাদা-স্ক্রিন ফিক্স: খোলা (active) চ্যাট/গ্রুপ ডিলিট করলে
      // activeChatId আগে পরিষ্কার হতো না — ChatWindow মিসিং চ্যাটের
      // জন্য null রেন্ডার করে ডান-পাশ (মোবাইলে পুরো স্ক্রিন) ফাঁকা সাদা
      // হয়ে যেত, রিলোড দিলে সেরে যেত। এখন সাথে সাথে: সকেট বন্ধ +
      // activeChatId/replying রিসেট + ডান-প্যানেল বন্ধ → লিস্টে ফিরে যায়।
      if (get().activeChatId === chatId) {
        disconnectChat(chatId)
        try { useUi.getState().closeRightPanel() } catch {}
      }
      set((s) => {
        const chats = { ...s.chats }; delete chats[chatId]
        const messages = { ...s.messages }; delete messages[chatId]
        return {
          chats, messages,
          activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
          replyingTo: s.activeChatId === chatId ? null : s.replyingTo,
        }
      })
      return
    }
    set((s) => ({ chats: { ...s.chats, [chatId]: { ...s.chats[chatId], ...localStateFromPatch(patch) } } }))
  },

  markRead(chatId) {
    const msgs = get().messages[chatId] || []
    const me = useAuth.getState().user?.id
    // শুধু এখনো "read" হয়নি এমন পিয়ার-মেসেজের রিসিট — আগে প্রতি ফোকাসে
    // সব মেসেজের রিসিট আবার যেত।
    const unreadIds = msgs.filter((m) => m.senderId !== me && !m.read && !m.delivered).map((m) => m.id)
    if (unreadIds.length) sendChat(chatId, { t: 'read', chatId, ids: unreadIds })
    set((s) => ({ chats: { ...s.chats, [chatId]: { ...s.chats[chatId], unread: 0 } } }))
    api(`/me/chats/${chatId}/state`, { method: 'PATCH', body: { unread: 0, lastReadTs: Date.now() } }).catch(() => {})
  },

  // নিজের SFU সেশন-আইডি activeCall.sessions-এ মার্জ — CallOverlay নিজের
  // broadcast ফেরত না পেলেও (বা join-ইভেন্ট আগে পৌঁছালেও) স্টেট সঠিক থাকে।
  mergeCallSession(chatId, userId, sessionId) {
    set((s) => {
      const c = s.chats[chatId]
      if (!c || !sessionId) return {}
      const base = c.activeCall || { sessionId: '', mode: 'audio', startedBy: userId, startedAt: Date.now(), sessions: {} as Record<string, string> }
      const sessions = { ...(base.sessions || {}), [userId]: sessionId }
      return { chats: { ...s.chats, [chatId]: { ...c, activeCall: { ...base, sessions } } } }
    })
  },

  setReplying(m) { set({ replyingTo: m }) },

  // রিপ্লাই-জাম্প — রেফারেন্স মেসেজে স্ক্রল + ব্লিংক (টেলিগ্রাম)।
  // মেসেজটি এখনো লোড হয়নি থাকলে পেজ-করে খুঁজে নেয়।
  async jumpToMessage(chatId, msgId) {
    const ok = await jumpToMessage(chatId, msgId)
    if (!ok) useUi.getState().toast(t('msgNotFound'))
    return ok
  },

  async localSearch(q) {
    const all = await idb.all<Message>('messages')
    const needle = q.toLowerCase()
    return all.filter((m) => (m.body || '').toLowerCase().includes(needle)).sort((a, b) => b.ts - a.ts).slice(0, 100)
  },

  async starredList() {
    return (await idb.all<Message>('starred')).sort((a, b) => b.ts - a.ts)
  },

  async exportChat(chatId) {
    const msgs = get().messages[chatId] || []
    const chat = get().chats[chatId]
    const name = (id: string) => chat.members.find((m) => m.id === id)?.username || id
    const lines = msgs.map((m) => `[${new Date(m.ts).toLocaleString()}] ${name(m.senderId)}: ${m.body || `(${m.type})`}`)
    const blob = new Blob([`fcfc chat export — ${chat.title || chat.peer?.username}\n\n${lines.join('\n')}`], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fcfc-export-${chatId}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  },

  async createDm(userId) {
    const res = await api('/chats', { body: { kind: 'dm', with: userId } })
    if (res.request) return { request: true }
    await get().loadChats()
    return { chatId: res.chatId }
  },

  // 📌 Saved Messages — Telegram-স্টাইল: আগেরটা থাকলে খোলে, না থাকলে বানায়
  // (সার্ভার self-DM ছেলেই একটাই সেভড-চ্যাট দেয় — নিজের কী-তে এনক্রিপ্ট)।
  async openSaved() {
    const me = useAuth.getState().user
    if (!me) return
    const existing = Object.values(get().chats).find((c) => c.saved)
    if (existing) { await get().openChat(existing.id); return }
    try {
      const res = await api('/chats', { body: { kind: 'dm', with: me.id } })
      if (res.chatId) {
        await get().loadChats()
        await get().openChat(res.chatId)
      }
    } catch (e: any) {
      useUi.getState().toast(e?.message || t('failedRetry'))
    }
  },

  async createGroup(title, description, memberIds, limit = 200) {
    // 🐛 গ্রুপ-ডুপ্লিকেট ফিক্স: সার্ভার এখন একই-নাম (নিজের-তৈরি) গ্রুপ থাকলে
    // নতুন করে না বানিয়ে সেটাই ফেরত দেয় (existing: true)
    const res = await api('/chats', { body: { kind: 'group', title, description, memberIds, memberLimit: limit } })
    await get().loadChats()
    return res
  },

  async joinInvite(code) {
    if (!code) throw new Error('invite code required')
    // পোস্ট না করলে ৪০৪ — সার্ভার-রুট POST, ক্লায়েন্ট ডিফল্ট GET পাঠাত
    const res = await api(`/invites/${code}/join`, { method: 'POST' })
    await get().loadChats()
    return res.chatId
  },

  async respondRequest(id, accept) {
    // একই ৪০৪-বাগ — accept/decline রুটও POST
    await api(`/requests/${id}/${accept ? 'accept' : 'decline'}`, { method: 'POST' })
    await get().loadRequests()
    if (accept) await get().loadChats()
  },

  async loadRequests() {
    const { requests } = await api('/me/requests')
    set({ requests })
  },

  // 🎭 একক-ইমোজি রিপ্লে — ক্লিক করা দিকে লোকাল কাউন্টার বাড়ে + রিয়েল-টাইম
  // ইভেন্ট যায়; ChatRoom ব্রডকাস্ট করে ওপাশেও ১-বার প্লে হয় (উভয় পাশে)।
  bumpEmojiPlay(chatId, id) {
    set((s) => ({ emojiPlays: { ...s.emojiPlays, [id]: (s.emojiPlays[id] || 0) + 1 } }))
  },

  replaySoloEmoji(chatId, id) {
    get().bumpEmojiPlay(chatId, id)
    sendChat(chatId, { t: 'emoji-replay', chatId, id })
  },

  // ── ChatRoom WebSocket ইভেন্ট হ্যান্ডলার ──
  async _event(chatId, ev) {
    const me = useAuth.getState().user?.id
    const chat = () => get().chats[chatId]
    switch (ev.t) {
      case 'hello': {
        set((s) => ({ chats: s.chats[chatId] ? { ...s.chats, [chatId]: { ...s.chats[chatId], pins: ev.pins, activeCall: ev.call } } : s.chats }))
        // 🎥 গ্রুপ-কল চলছে + আমি এখনো কল-UI-তে নেই → ইনকামিং-কল UI দেখাই।
        // 🐛 আগে 'start'-ইভেন্ট পাওয়া লোকেরাই কল-UI দেখত — কল শুরুর **পরে**
        // অ্যাপ খুললে/রিকানেক্ট করলে শুধু চ্যাট-হেডারের ছোট ব্যানারটা দেখত,
        // ফুল-স্ক্রিন কল-UI কখনোই পপ করত না ("every user should see CallUI")।
        // এখন hello-তেই চলমান কল ধরা পড়ে — প্রতি sessionId-তে একবারই রিং হয়।
        if (ev.call && ev.call.sessionId) {
          const c = chat()
          const meNow = me
          const uiNow = useUi.getState()
          if (c?.kind === 'group' && meNow && ev.call.startedBy !== meNow && !uiNow.call
              && !helloCallShown.has(String(ev.call.sessionId))) {
            helloCallShown.add(String(ev.call.sessionId))
            if (ev.call.auto) {
              uiNow.setCall({ chatId, mode: ev.call.mode === 'video' ? 'video' : 'audio', incoming: false, auto: true })
              uiNow.toast(t('callAutoAnswered'))
            } else {
              uiNow.setCall({ chatId, mode: ev.call.mode === 'video' ? 'video' : 'audio', incoming: true })
            }
          }
        }
        break
      }
      case 'msg': {
        const m = ev.m
        if (m.senderId === me) {
          // 🩹 নিজের মেসেজের সার্ভার-একো = সত্যিই সেভ+ব্রডকাস্ট হয়েছে —
          // pending-ঘড়ি নামিয়ে ✓ বসাই (আগে sendDraft-ই আগেভাগে ✓ দেখাত)।
          set((s) => {
            const list = s.messages[chatId] || []
            if (!list.some((x) => x.id === m.id)) return s
            let changed = false
            const next = list.map((x) => x.id === m.id && (x.pending || x.failed)
              ? (changed = true, { ...x, pending: false, failed: false }) : x)
            return changed ? { messages: { ...s.messages, [chatId]: next } } : s
          })
          if (get().messages[chatId]?.some((x) => x.id === m.id)) return
        }
        const msg = await rowToMessage(chatId, { mid: m.id, sender_id: m.senderId, ts: m.ts, type: m.type, payload: m.payload }, m.self)
        if (!msg) {
          // ডিক্রিপ্ট ব্যর্থ → পাঠানোর পক্ষকে র‍্যামচেট রি-নেগো করার সংকেত (১০ সেকেন্ডে সর্বোচ্চ ১বার)
          // ⚠️ sender-key / call মেসেজ ইচ্ছাকৃতভাবে null রিটার্ন করে — সেগুলো "ব্যর্থ" নয়,
          // আগে সেগুলোর জন্যও renego যেত (অকারণ সেশন-চার্ন)।
          // ⚠️ বাগ-ফিক্স: গ্রুপ-চ্যাটে renego নয় — গ্রুপে ব্যর্থতা প্রায়ই সাময়িক
          // ("sender key missing", নতুন মেম্বার), আর গ্রুপ-রুমে ব্রডকাস্ট হওয়া renego
          // বাকি সদস্যদের পাঠানো-সদস্যের সাথে ১:১ সেশন মুখে মুখে ডিলিট করে দিত —
          // ক্যাসকেডিং সেশন-লুপ (সেশন উইপ-বাগের সাথে মিলে ডেথ-স্পাইরাল)।
          // গ্রুপের জন্য আছে আলাদা skrequest মেকানিজম।
          if (m.senderId !== me && m.type !== 'sender-key' && m.type !== 'call' && chat()?.kind !== 'group' && Date.now() - (lastRenego[chatId] || 0) > 10000) {
            lastRenego[chatId] = Date.now()
            sendChat(chatId, { t: 'renego', chatId, from: me })
          }
          // গ্রুপে কী নেই — সেন্ডারকে পুনর্বণ্টন চাই
          if (m.senderId !== me && chat()?.kind === 'group' && m.type !== 'sender-key' && m.type !== 'call') {
            sk.hasSenderKey(chatId, m.senderId).then((has) => { if (!has) requestSenderKey(chatId) }).catch(() => {})
          }
          return
        }
        // লাইভ মেসেজ ডিক্রিপ্ট সফল = সেশন সেরে গেছে — এই চ্যাটে আগে ব্ল্যাকলিস্ট
        // হওয়া পুরনো মেসেজগুলো আর কখনো রিট্রাই হতো না (রিলোড পর্যন্ত উধাও)।
        // ব্ল্যাকলিস্ট মুছে হিস্ট্রি আবার মার্জ করি — গ্যাপ নিজে থেকেই ভরে যায়।
        if (healFailedChat(chatId)) get().loadHistory(chatId).catch(() => {})
        // 📞 কল-হিস্ট্রি রো — লিস্টে যোগ হয়, কিন্তু পিং/আনরিড/নোটিফিকেশন নেই
        if (msg.type === 'call') { appendMessage(chatId, msg); break }
        appendMessage(chatId, msg)
        setReplyingPreview(chatId, msg)
        if (m.senderId !== me) {
          sendChat(chatId, { t: 'delivered', chatId, ids: [m.id] })
          // 🔴 ভয়েস অটো-প্লে: প্রেরক লাল-মাইক দিয়ে পাঠিয়েছে — অন্য চ্যাটে
          // থাকলেও / অ্যাপ ফোকাসে না থাকলেও নিজে থেকেই বেজে ওঠে (মিডিয়া
          // ডিক্রিপ্ট করে চালানো হয় — ব্রাউজার অটোপ্লে-পলিসি ব্লক করলে নীরব)।
          if (msg.type === 'voice' && (msg as any).ap) {
            autoPlayVoice(msg).catch(() => {})
          }
          // 🔊 পিং-সাউন্ড নিয়ম: ইউজার ঐ চ্যাটে **এবং** ট্যাব দেখছে থাকলে
          // শব্দ হয় না। চ্যাটের বাইরে / অন্য ট্যাবে (facebook, youtube) /
          // উইন্ডো মিনিমাইজ — কোনো একটা হলেই পিং বাজে।
          const active = get().activeChatId === chatId
          const visible = document.visibilityState === 'visible'
          if (active && visible) {
            get().markRead(chatId)
          } else {
            if (!active) {
              set((s) => ({ chats: { ...s.chats, [chatId]: { ...s.chats[chatId], unread: (s.chats[chatId]?.unread || 0) + 1 } } }))
            }
            const c = chat()
            if (c && !(c.mutedUntil && c.mutedUntil > Date.now())) {
              notifyMessage(c, msg)
              if (useAuth.getState().settings?.sound !== false) playPing()
            }
          }
        }
        if (msg.expiresAt) scheduleExpiry(chatId, msg.id, msg.expiresAt)
        break
      }
      case 'msg-rejected': {
        // সার্ভার মেসেজ নেয়নি (ব্লকড পিয়ার / পেন্ডিং রিকোয়েস্ট) — আগে
        // প্রেরকের UI-তে ভুয়া "পাঠানো" মেসেজ রয়ে গিয়ে রিলোডে উধাও হতো।
        set((s) => ({
          messages: {
            ...s.messages,
            [chatId]: (s.messages[chatId] || []).map((m) => m.id === ev.id ? { ...m, pending: false, failed: true } : m),
          },
        }))
        const rejected = (get().messages[chatId] || []).find((x) => x.id === ev.id)
        if (rejected) idb.put('messages', rejected.id, { ...rejected, failed: true }).catch(() => {})
        useUi.getState().toast(t('msgRejected'))
        break
      }
      case 'delivered':
      case 'read': {
        if (ev.from === me) return
        set((s) => {
          const seenBy = { ...s.seenBy }
          if (ev.t === 'read') {
            for (const id of ev.ids) seenBy[id] = [...new Set([...(seenBy[id] || []), ev.from])]
          }
          return {
            seenBy,
            messages: {
              ...s.messages,
              [chatId]: (s.messages[chatId] || []).map((m) =>
                ev.ids.includes(m.id) && m.senderId === me ? { ...m, [ev.t === 'read' ? 'read' : 'delivered']: true } : m),
            },
          }
        })
        break
      }
      case 'typing': {
        if (ev.from === me) return
        set((s) => {
          const c = s.chats[chatId]
          if (!c) return s
          let typing = c.typing || []
          typing = ev.on ? [...new Set([...typing, ev.from])] : typing.filter((u) => u !== ev.from)
          return { chats: { ...s.chats, [chatId]: { ...c, typing } } }
        })
        if (ev.on) setTimeout(() => {
          set((s) => {
            const c = s.chats[chatId]
            if (!c) return s
            return { chats: { ...s.chats, [chatId]: { ...c, typing: (c.typing || []).filter((u) => u !== ev.from) } } }
          })
        }, 6000)
        break
      }
      case 'presence': {
        set((s) => ({ presence: { ...s.presence, [ev.userId]: ev.online } }))
        // অফলাইনে গেলেই পিয়ারের লাস্ট-সিন এখনই বসিয়ে দিই — সার্ভার যে-মুহূর্তে
        // DB-তে লিখছে, ক্লায়েন্টও সেই মুহূর্ত দেখাক। আগে পুরনো স্ন্যাপশট রয়ে যেত।
        if (ev.online === false) {
          set((s) => {
            const chats = { ...s.chats }
            let changed = false
            for (const c of Object.values(chats)) {
              if (c.kind === 'dm' && c.peer?.id === ev.userId) {
                chats[c.id] = { ...c, peer: { ...c.peer!, lastSeenAt: Date.now() } }
                changed = true
              }
            }
            return changed ? { chats } : {}
          })
        }
        break
      }
      case 'renego': {
        // ওপক্ষের ডিক্রিপশন ভেঙেছে — ওর সাথে পুরনো র‍্যামচেট সেশন ফেলে দিই,
        // পরের মেসেজটা নতুন হ্যান্ডশেকসহ যাবে
        // ⚠️ বাগ-ফিক্স: শুধু ১:১-চ্যাটেই — গ্রুপ-রুমের renego ব্রডকাস্টে অন্য
        // সদস্যদের (ev.from-এর সাথে আমার) ভালো ১:১ সেশন মুছে যেত।
        if (ev.from && ev.from !== me && chat()?.kind !== 'group') idb.del('sessions', ev.from).catch(() => {})
        break
      }
      case 'skrequest': {
        // ওপক্ষের (গ্রুপ-সেন্ডার) কাছে আমার সেন্ডার-কী নেই — পুনঃবণ্টনের
        // ট্র্যাকিং থেকে ওকে বাদ দিলে পরের মেসেজেই কী আবার যাবে
        // ⚠️ বাগ-ফিক্স: শুধু "পরের মেসেজে" নয় — এখনই পুনঃবণ্টন করি। নইলে
        // নতুন মেম্বার কী-মালিকের পরের মেসেজ পর্যন্ত ইতিহাস পড়তে পারত না
        // (মালিক আর কখনো না লিখলে চিরকালের জন্যই না)।
        if (ev.from && ev.from !== me && ev.chatId) {
          sk.markNeedsRedistribution(ev.chatId, [ev.from]).catch(() => {})
          const chat = get().chats[ev.chatId]
          if (chat?.kind === 'group') distributeSenderKeys(ev.chatId, chat).catch(() => {})
        }
        break
      }
      case 'edit': {
        try {
          const c = chat()
          if (!c) return
          const plain = c.kind === 'group'
            ? await sk.groupDecrypt(chatId, ev.from, ev.payload)
            : await decryptFrom(ev.from, ev.payload as Envelope)
          applyEdit(chatId, ev.id, plain.body)
        } catch {}
        break
      }
      case 'delAll': {
        // সব ডিভাইসে একসাথে ভ্যানিশ অ্যানিমেশন
        const ids: string[] = ev.ids || []
        set((s) => ({ vanish: { ...s.vanish, ...Object.fromEntries(ids.map((i) => [i, true])) } }))
        break
      }
      case 'react': {
        applyReaction(chatId, ev.id, ev.emoji, ev.from, ev.on)
        break
      }
      case 'emoji-replay': {
        // ওপাশে ইমোজিতে ক্লিক করেছে — আমার দিকেও ১-বার অ্যানিমেশন প্লে হয়
        // (নিজের ক্লিকের ইকো নয় — লোকাল বাম্প replaySoloEmoji-ই দিয়েছে)
        if (ev.from !== me && ev.id) get().bumpEmojiPlay(chatId, ev.id)
        break
      }
      case 'pins': {
        set((s) => ({ chats: s.chats[chatId] ? { ...s.chats, [chatId]: { ...s.chats[chatId], pins: ev.pins } } : s.chats }))
        break
      }
      case 'call': {
        handleCallEvent(chatId, ev)
        break
      }
    }
  },

  // ── UserHub ইভেন্ট ──
  async _hub(ev) {
    const { openModal, toast } = useUi.getState()
    const me = useAuth.getState().user?.id
    switch (ev.t) {
      case 'device-approval':
        openModal('device-approval', { deviceId: ev.deviceId, deviceName: ev.deviceName })
        break
      case 'device-revoked':
        // Telegram-style Decline: আমার নিজের সেশনই রিভোক হলে → তৎক্ষণাৎ লগআউট
        if (ev.deviceId && ev.deviceId === deviceId()) {
          useAuth.getState().forceLogout()
        }
        break
      case 'request-declined': {
        // আমার পাঠানো রিকোয়েস্ট বাতিল — লোকাল চ্যাটও সরে যায়
        const s = get()
        if (ev.chatId && s.chats[ev.chatId]) {
          const chats = { ...s.chats }
          delete chats[ev.chatId]
          set({ chats, activeChatId: s.activeChatId === ev.chatId ? null : s.activeChatId })
        }
        break
      }
      case 'message-request':
        get().loadRequests()
        toast(t('newReqToast'))
        break
      case 'request-accepted':
        await get().loadChats()
        toast(t('reqAcceptedToast'))
        break
      case 'chat-new':
        await get().loadChats()
        break
      case 'chat-updated':
        await get().loadChats()
        break
      case 'call': {
        // চ্যাট-রুম সকেট বন্ধ থাকলেও (অন্য চ্যাটে/লিস্টে) DO হাব দিয়ে কল-ইভেন্ট
        // পাঠায় — ইনকামিং-কল UI তাই সবসময় পপ করে (ট্যাব খোলা থাকলে)।
        if (ev.chatId) handleCallEvent(ev.chatId, ev)
        break
      }
      case 'members-changed': {
        if (Array.isArray(ev.added) && !ev.added.includes(useAuth.getState().user?.id)) {
          await sk.markNeedsRedistribution(ev.chatId, ev.added)
        }
        await get().loadChats()
        break
      }
      case 'removed-from-chat': {
        const s = get()
        const chats = { ...s.chats }
        delete chats[ev.chatId]
        set({ chats, activeChatId: s.activeChatId === ev.chatId ? null : s.activeChatId })
        break
      }
      case 'msg': {
        // অন্য চ্যাটে নতুন মেসেজ (হাব হয়ে এসেছে)
        // 🆕 ক্রস-ডিভাইস ফিক্স: নিজের **অন্য ডিভাইস** থেকে পাঠানো মেসেজেও
        // (ev.from === me) এই ইভেন্ট আসে — আগে ওটাও "আনরিড+1 + নোটিফিকেশন
        // + পিং" খাইয়ে দিত (নিজের মেসেজে নিজের কাছে নোটিফিকেশন!), আর মেসেজের
        // কনটেন্ট কখনোই টানা হতো না। সার্ভার এখন সব মেম্বারের হাবেই ইভেন্ট
        // পাঠায় (রুমে-থাকা ডিভাইসও পায়) — তাই ডিডুপ-গার্ড:
        //  • মেসেজ একই ডিভাইসে আগেই এসে থাকলে (লাইভ-সকেট) আনরিড/নোটিফিকেশন নয়
        //  • চ্যাট এই ডিভাইসে খোলা থাকলেও নয় (লাইভ-পথ নিজেই markRead করে)
        const c = get().chats[ev.chatId]
        const own = ev.from === me
        const alreadyHave = !!ev.mid && (get().messages[ev.chatId] || []).some((m) => m.id === ev.mid)
        const openHere = get().activeChatId === ev.chatId
        if (c) set((st) => ({
          chats: { ...st.chats, [ev.chatId]: own || alreadyHave || openHere
            ? { ...c }
            : { ...c, unread: (c.unread || 0) + 1 } },
        }))
        // ⚠️ এখানে lastTs: Date.now() বাড়ানো হয় **না** — এস্টিমেটেড সময় মেসেজের
        // আসল ts-এর পরে হলে নিচের loadHistory-প্রিভিউ-আপডেটের `lastMsg.ts >= c.lastTs`
        // তুলনা ভেঙে প্রিভিউ আপডেটই হতো না (প্রিভিউ পুরনো থেকে যেত)। আসল
        // lastTs/প্রিভিউ reloadChatSoon → loadHistory থেকেই বসে — ৪০০ms-এর মধ্যে।
        if (c && !own && !alreadyHave && !openHere && !(c.mutedUntil && c.mutedUntil > Date.now())) {
          const sender = ev.from
          notifyMessage(c, { id: ev.mid, chatId: ev.chatId, senderId: sender, ts: Date.now(), type: 'text', body: t('newEncryptedMsg'), reactions: {} })
          if (useAuth.getState().settings?.sound !== false) playPing()
        }
        // 🆕 মেসেজের আসল কনটেন্ট এখনই টেনে আনি (ডিবাউন্সড) — লিস্টের
        // প্রিভিউ সাথে সাথে বদলায়, চ্যাট খুললে তাৎক্ষণিক সব দেখা যায়।
        // আগে শুধু আনরিড-ব্যাজ বাড়ত — কনটেন্ট আসত চ্যাট খোলার পরেই।
        if (c && ev.chatId) reloadChatSoon(ev.chatId)
        break
      }
      case 'presence': {
        // ⚡ রিয়েল-টাইম গ্লোবাল-প্রেজেন্স: আগে শুধু ৬০-সেকেন্ডের পোলে (বা খোলা
        // চ্যাট-রুমের সকেটে) অনলাইন/অফলাইন জানা পড়ত — পিয়ার অনলাইন হওয়ার
        // অনেক পরে ("কিছুক্ষণ পরে") ডট/সাবটাইটেলে দেখা দিত। এখন UserHub
        // কানেক্ট/ডিসকানেক্টেই সব শেয়ার্ড-চ্যাট সদস্যের হাবে পুশ করে — সাথে
        // সাথেই আপডেট হয়। (৬০-সেকেন্ডের পোল সেফটি-নেট হিসেবেই থাকে।)
        if (!ev.userId || ev.userId === me) break
        set((s) => (s.presence[ev.userId] === ev.online ? s : { presence: { ...s.presence, [ev.userId]: !!ev.online } }))
        // অফলাইনে গেলে পিয়ারের লাস্ট-সিন এখনই বসিয়ে দিই — সার্ভার যে-মুহূর্তে
        // DB-তে লিখছে, ক্লায়েন্টও সেই মুহূর্ত দেখাক।
        if (ev.online === false) {
          set((s) => {
            const chats = { ...s.chats }
            let changed = false
            for (const c of Object.values(chats)) {
              if (c.kind === 'dm' && c.peer?.id === ev.userId) {
                chats[c.id] = { ...c, peer: { ...c.peer!, lastSeenAt: Date.now() } }
                changed = true
              }
            }
            return changed ? { chats } : {}
          })
        }
        break
      }
    }
  },
}))

// ── হেল্পার ─────────────────────────────────────────────────
import { useUi } from './ui'

export function previewOf(m: Message): string {
  switch (m.type) {
    case 'text': return m.body || ''
    case 'image': return t('pImage')
    case 'video': return t('pVideo')
    case 'voice': return t('pVoice')
    case 'file': return `📎 ${m.media?.name || t('fileLabel')}`
    case 'sticker': return t('pSticker')
    case 'gif': return t('pGif')
    case 'call': return t('pCall')
    default: return ''
  }
}

// ── কল-ইভেন্ট (চ্যাট-রুম + হাব দুই পথ থেকেই) ──
// start → অন্যজন কল দিলে ইনকামিং-কল UI + রিংটোন; decline → কলারের
// ওভারলে বন্ধ + টোস্ট; end (কল শেষ) → সবার ওভারলে বন্ধ।
// 🔴 auto = লাল-বাটন কল: রিং ছাড়াই ওপাশে অটো-অ্যান্সার (CallOverlay-ই জয়েন করে নেয়)।
function handleCallEvent(chatId: string, ev: any) {
  const me = useAuth.getState().user?.id
  useChats.setState((s) => (s.chats[chatId] ? { chats: { ...s.chats, [chatId]: { ...s.chats[chatId], activeCall: ev.call ?? null } } } : {}))
  if (!me || ev.from === me) return
  const ui = useUi.getState()
  if (ev.action === 'start' && ev.call && !ui.call) {
    if (ev.call.auto) {
      // অটো-অ্যান্সার: ইনকামিং-রিং নয় — সরাসরি কলে ঢুকে যাই + জানানো টোস্ট
      ui.setCall({ chatId, mode: ev.call.mode === 'video' ? 'video' : 'audio', incoming: false, auto: true })
      ui.toast(t('callAutoAnswered'))
    } else {
      // ট্যাব খোলা থাকলে ফুলস্ক্রিন ইনকামিং-কল UI + রিং (CallOverlay করে)
      ui.setCall({ chatId, mode: ev.call.mode === 'video' ? 'video' : 'audio', incoming: true })
    }
  } else if (ev.action === 'decline' && ui.call && !ui.call.incoming && ui.call.chatId === chatId) {
    ui.setCall(null)
    ui.toast(t('callDeclinedToast'))
  } else if (ev.action === 'end') {
    // 🩹 কল-এন্ড দুই পাশেই কাটবে:
    //  • ইনকামিং (রিং-অবস্থা) হলে 'end' = কলার ক্যানসেল — রিং বন্ধ
    //    (আগে !ui.call.incoming শর্তের কারণে ওপাশ ক্যানসেল করলেও
    //     রিংটোন ৬০-সেকেন্ড পর্যন্ত বাজত)
    //  • ১:১ (ডিএম) কলে যে-ই কাটুক দুই পাশ বন্ধ (সার্ভার-সাইড ফুল-এন্ড
    //    + এখানে ক্লায়েন্ট-গার্ড দুটোই)
    //  • গ্রুপ-কলে শুধু ফুল-এন্ড (ev.call নেই) হলে বন্ধ — একজন বের
    //    হলে বাকিদের কল চলতে থাকে
    const isDm = useChats.getState().chats[chatId]?.kind === 'dm'
    if (ui.call && ui.call.chatId === chatId && (ui.call.incoming || isDm || !ev.call)) {
      const wasIncoming = !!ui.call.incoming
      ui.setCall(null)
      ui.toast(wasIncoming ? t('callMissedToast') : t('callEndedToast'))
    }
  }
}

// 🔴 ভয়েস অটো-প্লে — মিডিয়া ডিক্রিপ্ট করে একবার বাজানো (রিপিট নয়)।
// ⚠️ বাগ-ফিক্স: আগে শুধু new Audio(url).play() হতো — ব্রাউজারের অটোপ্লে-
// পলিসি পিয়ারের সাম্প্রতিক ইউজার-জেসচার না থাকলে (ব্যাকগ্রাউন্ড ট্যাব /
// লকড ফোন / নতুন পেজ-লোড / অন্য চ্যাটে) NotAllowedError দিত আর
// .catch(()=>{}) চুপচাপ গিলে নিত — লাল-ভয়েস ঠিক যেখানে কাজ করার
// কথা ("ওপাশে অটো-প্লে") সেখানেই নীরব থাকত। এখন ৩-স্তরের চেষ্টা:
//   ১) আনলকড AudioContext (পিং/রিংটোনের ctx) দিয়ে Web-Audio পাথ —
//      জেসচার ছাড়াই চলে (প্রথম টাচে unlock-লিসেনার ctx চালু করে)
//   ২) ফলব্যাক new Audio().play() — স্টিকি অ্যাক্টিভেশন থাকলে চলে
//   ৩) দুটোই ব্লক হলে পরের ইউজার-টাচে একবার রিট্রাই — ফোন আনলক/
//      অ্যাপে টাচ করা মাত্রই ভয়েসটা বেজে ওঠে
const autoPlayedVoiceIds = new Set<string>()
let curAutoAudio: HTMLAudioElement | null = null
let pendingVoiceGesture: (() => void) | null = null

async function autoPlayVoice(msg: Message) {
  try {
    if (!msg.media) return
    if (autoPlayedVoiceIds.has(msg.id)) return
    autoPlayedVoiceIds.add(msg.id)
    const url = await decryptedMediaUrl(msg.media as any)
    // ১) Web-Audio পাথ (আনলকড ctx) — প্রধান সমাধান
    if (await playVoiceThroughCtx(url)) return
    // ২) <audio> ফলব্যাক — স্টিকি অ্যাক্টিভেশন থাকলে চলে
    try { curAutoAudio?.pause() } catch {}
    const a = new Audio(url)
    a.volume = 1
    curAutoAudio = a
    let ok = false
    try { await a.play(); ok = true } catch { ok = false }
    if (ok) return
    // ৩) ব্লকড — পরের ইউজার-জেসচারে একবার রিট্রাই (জেসচার-হ্যান্ডলারের
    // ভেতরে <audio>.play() সবসময় অনুমোদিত)। পুরনো পেন্ডিং হলে বদলে যায় —
    // একাধিক ব্লকড ভয়েস এলে শেষটাই বাজে (ওভারল্যাপ-ক্যাকোফনি এড়াতে)।
    queueVoiceOnGesture(url)
  } catch {}
}

function queueVoiceOnGesture(url: string) {
  try {
    if (pendingVoiceGesture) {
      window.removeEventListener('pointerdown', pendingVoiceGesture)
      window.removeEventListener('keydown', pendingVoiceGesture)
    }
    const tryPlay = () => {
      try {
        window.removeEventListener('pointerdown', tryPlay)
        window.removeEventListener('keydown', tryPlay)
      } catch {}
      if (pendingVoiceGesture !== tryPlay) return
      pendingVoiceGesture = null
      stopVoicePlayback()
      const a = new Audio(url)
      a.volume = 1
      try { a.play().catch(() => {}) } catch {}
    }
    pendingVoiceGesture = tryPlay
    window.addEventListener('pointerdown', tryPlay)
    window.addEventListener('keydown', tryPlay)
  } catch {}
}

// ⚠️ রিপ্লাই-জাম্পের ভেতরের হেল্পার — স্টোর-মেথড থেকে ডাকা হয়।
async function jumpToMessage(chatId: string, msgId: string): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    const el = document.querySelector(`[data-mid="${msgId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('msg-blink')
      void (el as HTMLElement).offsetWidth // reflow — অ্যানিমেশন রিস্টার্ট
      el.classList.add('msg-blink')
      return true
    }
    const s = useChats.getState()
    const list = s.messages[chatId] || []
    if (s.loadedAll[chatId] || !list.length) return false
    await s.loadHistory(chatId, list[0].ts).catch(() => {})
    await new Promise((r) => setTimeout(r, 160))
  }
  return false
}

function appendMessage(chatId: string, msg: Message) {
  const s0 = useChats.getState()
  const list = s0.messages[chatId] || []
  if (list.some((m) => m.id === msg.id)) return
  // ⚠️ মেসেজ-ক্রম বাগের ফিক্স (রিসিভ-পাশ): প্রেরকের ঘড়ি পিছিয়ে থাকলে
  // তার নতুন মেসেজের ts আমার আগের মেসেজের ts-এর চেয়ে ছোট হতে পারত —
  // সেটা আগের মেসেজের উপরে সরে যেত। চ্যাট-শেষের ts-এর চেয়ে ছোট হলে
  // +1 করে নিই — প্রতি-চ্যাট ক্রম চিরকাল মনোটোনিক।
  const lastTs = list.length ? list[list.length - 1].ts : 0
  const m2: Message = msg.ts <= lastTs ? { ...msg, ts: lastTs + 1 } : msg
  useChats.setState({ messages: { ...s0.messages, [chatId]: [...list, m2].sort((a, b) => a.ts - b.ts) } })
  // লোকাল সার্চ ইনডেক্স + নিজের-মেসেজ ক্যাশ — ক্যাপশন-ছাড়া মিডিয়াও ক্যাশ হয়
  // (নইলে রিলোডের পরে নিজের পাঠানো ছবি/ভয়েস আর দেখা যেত না)।
  if ((m2.body || m2.media) && m2.type !== 'sender-key') { markBackupDirty(); idb.put('messages', m2.id, { ...m2, payload: undefined }).catch(() => {}) }
}

function setReplyingPreview(chatId: string, msg: Message) {
  useChats.setState((s) => ({
    chats: { ...s.chats, [chatId]: { ...s.chats[chatId], lastPreview: previewOf(msg), lastTs: msg.ts } },
  }))
}

// রি-নেগো থ্রটল + যে মেসেজ ডিক্রিপ্ট করা যায়নি সেগুলোর তালিকা (বারবার চেষ্টা এড়াতে)
const lastRenego: Record<string, number> = {}
// mid → chatId: কোন চ্যাটে কোন মেসেজ-রো ডিক্রিপ্ট-ব্যর্থ হলো। আগে একটা
// গ্লোবাল Set ছিল — একবার ব্যর্থ হলে সেশন সেরে গেলেও রিট্রাই হতো না
// (মেসেজগুলো রিলোড পর্যন্ত উধাও থাকত)। এখন লাইভ-মেসেজ সফল হলে
// healFailedChat() ওই চ্যাটের ব্ল্যাকলিস্ট মুছে হিস্ট্রি রি-মার্জ করে।
const failedDecryptIds = new Map<string, string>()
function healFailedChat(chatId: string): boolean {
  let healed = false
  for (const [mid, cid] of failedDecryptIds) {
    if (cid === chatId) { failedDecryptIds.delete(mid); healed = true }
  }
  return healed
}

// কী-রিস্টোর শেষে (লগইনে) — ব্ল্যাকলিস্ট সব মুছে যেসব চ্যাট ইতিমধ্যে খোলা/
// লোড-হওয়া কিন্তু খালি দেখাচ্ছে সেগুলোর হিস্ট্রি আবার টানি।
// 🩹 আপগ্রেড: আগে **খালি** চ্যাটগুলোই কেবল রিলোড হতো — কিন্তু আংশিক-
// লোড চ্যাটে (নিজের মেসেজ আছে, পিয়ারেরগুলো ডিক্রিপ্ট-ব্যর্থ) রিস্টোরের
// পরেও রিট্রাই হতো না → পিয়ারের মেসেজ চিরকাল উধাও। এখন লোড-হওয়া
// **সব** চ্যাটই রিলোড — রিস্টোর হওয়া ক্যাশ/সেশন দিয়ে ফাঁকগুলো ভরে ওঠে।
// (রিলোড আস্তে-আস্তে, সিরিয়াল — একসাথে ৩০টা রিকোয়েস্ট ছুঁড়ে র‍্যামচেট/
// SFU-লিমিট গোলমাল করে না)
function onKeysRestored() {
  const s = useChats.getState()
  if (!s.booted) return
  failedDecryptIds.clear()
  const ids = Object.keys(s.messages)
  ;(async () => {
    for (const chatId of ids) {
      try {
        await s.loadHistory(chatId)
      } catch {}
      // স্টোর-রেফ টাটকা রাখি — রিসেট হলে থেমে যাই
      if (useChats.getState().booted !== true) return
    }
  })()
}
window.addEventListener('fcfc:keys-restored', onKeysRestored)
// 🎥 hello-তে দেখা গ্রুপ-কল — কোন sessionId-তে ইতিমধ্যে কল-UI দেখানো হয়েছে
const helloCallShown = new Set<string>()
// ইনজেস্ট-হওয়া sender-key রো + চলমান হিস্টোরি-লোড — ডাবল-প্রসেস আটকাই
const skDoneIds = new Set<string>()
const historyInflight = new Map<string, Promise<void>>()

// ── 🆕 ক্রস-ডিভাইস মেসেজ-সিঙ্ক ─────────────────────────────────
// সমস্যা: এক ডিভাইস থেকে কথা বললে অন্য লগইন-করা ডিভাইসে মেসেজ আসত না —
// হাব-ইভেন্ট শুধু আনরিড-ব্যাজ বাড়াতো, কনটেন্ট টানতো না; আর লগইনের পরেও
// চ্যাট না খুললে হিস্ট্রি লোডই হতো না। সমাধান (ইউজারের পছন্দমতো স্বয়ংক্রিয়,
// ইউজার কিছু টের পায় না):
//  ১) লগইন-পরেই সব চ্যাটের হিস্ট্রি ব্যাকগ্রাউন্ডে অটো-লোড
//  ২) হাবে 'msg' এলে সেই চ্যাটের হিস্ট্রি ডিবাউন্সড রিলোড — লিস্টে
//     প্রিভিউ + আনরিড + নোটিফিকেশন সব লাইভ আপডেট হয়
let allHistoriesLoaded = false
async function loadAllHistories() {
  if (allHistoriesLoaded) return
  allHistoriesLoaded = true
  const seen = new Set<string>()
  // ২ রাউন্ড — প্রথম রাউন্ড চলার মাঝে নতুন চ্যাট যোগ হলে (হাব-ইভেন্ট/
  // রিকোয়েস্ট-অ্যাকসেপ্ট) দ্বিতীয় রাউন্ডে সেগুলোও ঢুকে যায়
  for (let round = 0; round < 2; round++) {
    const ids = Object.keys(useChats.getState().chats)
    for (const chatId of ids) {
      // লগআউট/ইউজার-বদল হলে স্টপ — রিসেটের পর নতুন লগইন নিজেই আবার চালাবে
      if (useChats.getState().booted !== true) return
      if (seen.has(chatId)) continue
      seen.add(chatId)
      try { await useChats.getState().loadHistory(chatId) } catch {}
    }
    if (round === 0) await new Promise((r) => setTimeout(r, 1200))
  }
}

// হাব-ইভেন্টে চ্যাট-রিলোড — ৪০০ms দেরি (ব্যাচে-আসা বার্তা এক লোডে),
// আর একই চ্যাটে ২.৫ সেকেন্ডে বেশি একবার নয় (স্প্যাম-গার্ড)।
const hubReloadAt: Record<string, number> = {}
function reloadChatSoon(chatId: string) {
  const now = Date.now()
  if ((hubReloadAt[chatId] || 0) && now - hubReloadAt[chatId] < 2500) return
  hubReloadAt[chatId] = now
  setTimeout(() => {
    const s = useChats.getState()
    if (s.booted !== true || !s.chats[chatId]) return
    s.loadHistory(chatId).catch(() => {})
  }, 400)
}

// ── 🆕 ব্যাকআপ-গ্যাপ-হিল ──
// নিজের অন্য-ডিভাইসের self-copy এই ডিভাইসে র‍্যামচেট-মিসম্যাচে ডিক্রিপ্ট
// হয় না (এক আইডেন্টিটি, দুই ডিভাইসের সেশন-চেইন আলাদা এগোয়)। কিন্তু
// পাঠানো ডিভাইস ৬-সেকেন্ড কুইক-সিঙ্কে রিমোট ব্যাকআপে ডিক্রিপ্টেড
// মেসেজ-ক্যাশ তুলে রাখে। এখানে: ফাঁক ধরা পড়লে (সার্ভারে রো আছে, লোকালে
// মেসেজ নেই) ব্যাকআপ রি-পুল → মার্জ → হিস্ট্রি রি-লোড — মেসেজ ক্যাশ
// থেকেই রেন্ডার। ব্যাকআপেও না থাকলে (৬-সেকেন্ড সিঙ্ক এখনো হয়নি) ১২
// সেকেন্ড পরে আরেকবার — মোট ২ চেষ্টা, তারপর পরের হাব-ইভেন্ট/রিলোডে আবার।
const lastGapHeal: Record<string, number> = {}
const gapHealTries: Record<string, number> = {}
let backupHealing = false
function scheduleBackupGapHeal(chatId: string) {
  // প্রতি চ্যাটে সর্বোচ্চ ৩ চেষ্টা (সফল মার্জ হলে কাউন্টার রিসেট) — ব্যাকআপেও
  // নেই-এমন চিরকাল-ভাঙা মেসেজে হিল-লুপ বন্ধ; পরের হাব-ইভেন্ট/রিলোডে ফের
  // সুযোগ (স্যলটেস্ট থ্রটল ১৫ সেকেন্ড)।
  if ((gapHealTries[chatId] || 0) >= 3) return
  if (Date.now() - (lastGapHeal[chatId] || 0) < 15_000) return
  lastGapHeal[chatId] = Date.now()
  gapHealTries[chatId] = (gapHealTries[chatId] || 0) + 1
  setTimeout(async () => {
    try {
      if (backupHealing || useChats.getState().booted !== true) return
      backupHealing = true
      const st = useAuth.getState()
      let pass: string | null = st.password || null
      let pin: string | null = st.passcode || null
      // 🩹 রিলোডের পর পাসওয়ার্ড/পাসকোড মেমরিতে থাকে না — লোকাল-সেভ করা
      // পাসকোড (idb meta) দিয়ে পিন-ব্লবটা খোলা যায়, সেটাই ফলব্যাক
      if (!pass && !pin) pin = await getStoredPasscode()
      const merged = await mergeRemoteIfFresher(pass, pin)
      if (merged) {
        gapHealTries[chatId] = 0
        healFailedChat(chatId)
        await useChats.getState().loadHistory(chatId).catch(() => {})
      } else {
        // ব্যাকআপ এখনো পুরনো (প্রেরকের কুইক-সিঙ্ক বাকি) — একবার আবার
        setTimeout(() => {
          lastGapHeal[chatId] = 0
          const s = useChats.getState()
          if (s.booted === true && s.chats[chatId]) s.loadHistory(chatId).catch(() => {})
        }, 12_000)
      }
    } catch {}
    finally { backupHealing = false }
  }, 3_000)
}
// গ্রুপ-কী না থাকলে সেন্ডারকে পুনর্বণ্টনের অনুরোধ (১০ সেকেন্ডে সর্বোচ্চ ১বার)
const lastSkReq: Record<string, number> = {}
function requestSenderKey(chatId: string) {
  if (Date.now() - (lastSkReq[chatId] || 0) < 10000) return
  lastSkReq[chatId] = Date.now()
  sendChat(chatId, { t: 'skrequest', chatId })
}

async function rowToMessage(chatId: string, row: any, selfEnv?: any): Promise<Message | null> {
  try {
    let payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    const me = useAuth.getState().user?.id

    if (row.type === 'sender-key') {
      // বন্টন করা সেন্ডার-কী ইনজেস্ট করি
      if (row.sender_id !== me) {
        const plain = await decryptFrom(row.sender_id, payload as Envelope)
        if (plain?.sk) await sk.ingestSenderKey(plain.chatId || chatId, row.sender_id, plain.sk)
      }
      return null
    }
    // 🆕 সেল্ফ-কপি রো সরাসরি রেন্ডার-যোগ্য নয় (মূল মেসেজের সাথে যুক্ত হয়)
    if (row.type === 'self-copy') return null
    // 📞 কল-হিস্ট্রি রো — প্লেইনটেক্সট মেটাডেটা (কনটেন্ট নয়); CallPill রেন্ডার করে
    if (row.type === 'call') {
      try {
        const c = typeof payload === 'string' ? JSON.parse(payload) : payload
        return { id: row.mid, chatId, senderId: row.sender_id, ts: row.ts, type: 'call', body: '', call: c, reactions: {} } as any
      } catch { return null }
    }

    // CACHE-FIRST-FOR-ALL: রিসিভ করা মেসেজও ডিক্রিপ্টেড-ক্যাশ থেকে ফেরত —
    // র‍্যামচেট কী একবারই খরচ হয়; রিলোডে পুনঃডিক্রিপ্ট OperationError দিত।
    const cachedAll = await idb.get<Message>('messages', row.mid)
    if (cachedAll) {
      return { ...cachedAll, reactions: payload.reactions || {}, pending: false, failed: false }
    }

    // ── নিজের পাঠানো মেসেজ ──
    // 1:1-তে নিজের এনভেলপ নিজে ডিক্রিপ্ট করা যায় না (ওটা পিয়ারের জন্যই
    // এনক্রিপ্টেড) — লোকাল ক্যাশ থেকে রেন্ডার হয়। গ্রুপে নিজের সেন্ডার-কী
    // চেইন থেকে পুরনো মেসেজ-কী বানিয়ে ডিক্রিপ্ট করা যায়।
    if (row.sender_id === me) {
      if (payload.g === 1) {
        const plain = await sk.groupDecryptOwn(chatId, payload)
        const own: Message = {
          id: row.mid, chatId, senderId: row.sender_id, ts: row.ts, type: row.type,
          body: plain.body, media: plain.media, replyTo: plain.replyTo, fwdFrom: plain.fwdFrom,
          editedAt: plain.edited ? row.ts : undefined, expiresAt: plain.expiresAt,
          ap: !!plain.ap,
          reactions: payload.reactions || {},
        }
        // ক্যাশে রাখি — পরের রিলোডে আর চেইন-রিপ্লে লাগবে না
        if (own.body || own.media) idb.put('messages', row.mid, own).catch(() => {})
        return own
      }
      // 🆕 সেল্ফ-কপি থাকলে সেখান থেকে ডিক্রিপ্ট — নতুন ডিভাইসেও নিজের
      // ১:১ মেসেজ হারায় না (আগে এখানেই null ফেরত গিয়ে মেসেজ উধাও হতো)
      if (selfEnv) {
        const plain = await decryptFrom(me, selfEnv as Envelope)
        const own: Message = {
          id: row.mid, chatId, senderId: row.sender_id, ts: row.ts, type: row.type,
          body: plain.body, media: plain.media, replyTo: plain.replyTo, fwdFrom: plain.fwdFrom,
          editedAt: plain.edited ? row.ts : undefined, expiresAt: plain.expiresAt,
          ap: !!plain.ap,
          reactions: payload.reactions || {},
        }
        if (own.body || own.media) { markBackupDirty(); idb.put('messages', row.mid, own).catch(() => {}) }
        return own
      }
      return null // নিজের 1:1 মেসেজ, ক্যাশ/সেল্ফ-কপি নেই — বাদ
    }

    let plain: any
    if (payload.g === 1) {
      // গ্রুপ মেসেজ — চ্যাটের মেম্বার হলেই সেন্ডার-কী থাকে; না থাকলে এররই ঠিক
      plain = await sk.groupDecrypt(chatId, row.sender_id, payload)
    } else {
      plain = await decryptFrom(row.sender_id, payload as Envelope)
    }
    // ⚠️ বাগ-ফিক্স: হিস্টোরি থেকে ডিক্রিপ্ট করা পিয়ার-মেসেজ এখন ক্যাশে যায়।
    // র‍্যামচেট-কী একবারই খরচ হয় — আগে ক্যাশে না লেখা হলে (ইউজার অফলাইনে
    // থাকায় হিস্টোরি-পথে আসা) মেসেজটা প্রথম রিলোডে দেখা গেলেও দ্বিতীয়
    // রিলোডে আর ডিক্রিপ্ট করা যেত না — মেসেজ উধাও হয়ে যেত; লোকাল-সার্চও
    // এগুলো দেখত না। লাইভ-পথের (appendMessage) মতোই এখানেও জমা হয়।
    const msgOut: Message = {
      id: row.mid, chatId, senderId: row.sender_id, ts: row.ts, type: row.type,
      body: plain.body, media: plain.media, replyTo: plain.replyTo, fwdFrom: plain.fwdFrom,
      editedAt: plain.edited ? row.ts : undefined, expiresAt: plain.expiresAt,
      ap: !!plain.ap,
      reactions: payload.reactions || {},
    }
    if (msgOut.body || msgOut.media) { markBackupDirty(); idb.put('messages', row.mid, { ...msgOut, payload: undefined }).catch(() => {}) }
    return msgOut
  } catch (e: any) {
    console.warn('decrypt failed', row.mid, e)
    // "সেশন নেই" মানে সাময়িক অবস্থা (নতুন লগইনে কী রিস্টোর চলছে, বা
    // পিয়ারের হ্যান্ডশেক এখনো আসেনি) — এগুলো **ব্ল্যাকলিস্ট করা যাবে না**,
    // নইলে কী এসে গেলেও মেসেজ আর কখনো রেন্ডার হয় না (হারিয়ে যায়)।
    // ব্ল্যাকলিস্ট শুধু সত্যিকারের ক্রিপ্টো-ব্যর্থতার জন্য।
    const msg = String(e?.message || e || '')
    // ⚠️ "sender key missing" যোগ করা হলো — আগে 'keys' substring-ম্যাচ
    // "sender key missing"-এ ধরা পড়ত না, নতুন মেম্বারের সাময়িক অবস্থাকেই
    // স্থায়ী ব্ল্যাকলিস্টে পাঠাত (রিট্রাই বন্ধ — মেসেজ উধাও)।
    const transient = !row || row.type === 'sender-key' || row.type === 'call' || row.type === 'self-copy'
      || msg.includes('no session and no handshake')
      || msg.includes('sender key missing')
      || msg.includes('identity')
      || msg.includes('OperationError')
      || msg.includes('keys')
    if (!transient) failedDecryptIds.set(row.mid, chatId)
    return null
  }
}

function applyEdit(chatId: string, id: string, text: string) {
  useChats.setState((s) => ({
    messages: {
      ...s.messages,
      [chatId]: (s.messages[chatId] || []).map((m) => (m.id === id ? { ...m, body: text, editedAt: Date.now() } : m)),
    },
  }))
  idb.get('messages', id).then((m) => { if (m) { markBackupDirty(); idb.put('messages', id, { ...m, body: text, editedAt: Date.now() }) } })
}

function applyReaction(chatId: string, id: string, emoji: string, userId: string, on: boolean) {
  useChats.setState((s) => ({
    messages: {
      ...s.messages,
      [chatId]: (s.messages[chatId] || []).map((m) => {
        if (m.id !== id) return m
        const reactions = { ...m.reactions }
        const list = reactions[emoji] || []
        reactions[emoji] = on ? [...new Set([...list, userId])] : list.filter((u) => u !== userId)
        if (!reactions[emoji].length) delete reactions[emoji]
        return { ...m, reactions }
      }),
    },
  }))
}

async function lastLocalMessage(chatId: string): Promise<Message | null> {
  const all = await idb.all<Message>('messages')
  const mine = all.filter((m) => m.chatId === chatId && m.type !== 'sender-key')
  return mine.sort((a, b) => b.ts - a.ts)[0] || null
}

function localStateFromPatch(patch: Record<string, any>): Partial<Chat> {
  const out: Partial<Chat> = {}
  if (typeof patch.pinned === 'boolean') out.pinned = patch.pinned
  if (typeof patch.archived === 'boolean') out.archived = patch.archived
  if (typeof patch.mutedUntil === 'number') out.mutedUntil = patch.mutedUntil
  if (typeof patch.wallpaper === 'string') out.wallpaper = patch.wallpaper
  if (typeof patch.ttl === 'number') out.ttl = patch.ttl
  return out
}

// ডিসঅ্যাপিয়ারিং মেসেজ টাইমার
const expiryTimers = new Map<string, any>()
function scheduleExpiry(chatId: string, msgId: string, expiresAt: number) {
  if (expiryTimers.has(msgId)) return
  const delay = Math.max(0, expiresAt - Date.now())
  expiryTimers.set(msgId, setTimeout(() => {
    expiryTimers.delete(msgId)
    useChats.getState().deleteForEveryone(chatId, [msgId])
  }, delay))
}

async function distributeSenderKeys(chatId: string, chat: Chat, beforeTs?: number) {
  const me = useAuth.getState().user!.id
  const distributed = await sk.distributedSet(chatId)
  const targets = chat.members.filter((m) => m.id !== me && !m.deleted && !distributed.has(m.id))
  if (!targets.length) return
  const pkg = await sk.distributionPackage(chatId)
  for (const t of targets) {
    try {
      const env = await encryptFor(t.id, { sk: pkg, chatId })
      sendChat(chatId, {
        t: 'msg', chatId,
        // ts মেসেজের চেয়ে এক টিক আগে — ASC হিস্টোরিতে কী আগে আসে
        m: { id: uid('sk_'), ts: beforeTs ? beforeTs - 1 : Date.now(), type: 'sender-key', payload: env },
      })
      await sk.markDistributed(chatId, t.id)
    } catch (e) {
      console.warn('sender key distribution failed for', t.id, e)
    }
  }
}

// ── প্রেজেন্স পোলিং ──
// চ্যাট-রুম সকেট শুধু খোলা চ্যাটের প্রেজেন্স-ইভেন্ট দেয়; লিস্টের বাকি
// পিয়ারদের অনলাইন/অফলাইন আর লাস্ট-সিন কেউ আপডেট করত না। প্রতি ৬০
// সেকেন্ডে KV-ভিত্তিক /users/presence পোল করে ডট-স্ট্যাটাস ফ্রেশ রাখি,
// আর সক্রিয় চ্যাটের পিয়ারের লাস্ট-সিনও একবার রিফ্রেশ করি।
//
// 🛟 সেফটি-নেট (নতুন): একই টিকারে /chats লাইট-চেক — স্টোরে নেই এমন নতুন
// চ্যাট পেলে পুরো লিস্ট রিলোড (হাব-ইভেন্ট কোনো কারণে মিস হলেও ৬০
// সেকেন্ডের মধ্যে নিজে থেকেই ঠিক হয়ে যায় — যেমন নতুন গ্রুপ-অ্যাড)।
let presenceTimer: any = null

async function presenceTick() {
  try {
    const s = useChats.getState()
    const me = useAuth.getState().user?.id
    const peerIds = Object.values(s.chats)
      .filter((c) => c.kind === 'dm' && c.peer && c.peer.id !== me && !c.peer.deleted)
      .map((c) => c.peer!.id)
    if (peerIds.length) {
      const out = await api(`/users/presence?ids=${encodeURIComponent(peerIds.join(','))}`)
      // ⚡ ল্যাগ-ফিক্স: মান বদলালে তবেই নতুন অবজেক্ট — প্রতি পোলে অবজেক্ট-
      // চার্নে সাবস্ক্রাইবার-রি-রেন্ডার হতো (পুরো চ্যাটলিস্ট + চ্যাটউইন্ডো)
      useChats.setState((st) => {
        let changed = false
        const presence = { ...st.presence }
        for (const k of Object.keys(out)) {
          if (presence[k] !== !!out[k]) { presence[k] = !!out[k]; changed = true }
        }
        return changed ? { presence } : st
      })
    }
    // সক্রিয় DM-চ্যাটের পিয়ারের লাস্ট-সিন রিফ্রেশ
    const active = s.chats[s.activeChatId || '']
    if (active?.kind === 'dm' && active.peer) {
      api(`/users/${active.peer.id}`).then((r: any) => {
        if (r?.user) {
          useChats.setState((st) => {
            const c = st.chats[active.id]
            if (!c || !c.peer || c.peer.id !== r.user.id) return st
            return { chats: { ...st.chats, [c.id]: { ...c, peer: { ...c.peer, lastSeenAt: r.user.lastSeenAt || 0 } } } }
          })
        }
      }).catch(() => {})
    }
    // 🛟 নতুন-চ্যাট সেফটি-নেট — হালকা /chats কল, নতুন চ্যাট গেলেই পুরো রিলোড
    try {
      const { chats: rows } = await api('/chats')
      const known = useChats.getState().chats
      const hasNew = (rows || []).some((r: any) =>
        !known[r.id] && !(r.deleted_before && (!r.last_ts || r.deleted_before >= r.last_ts)))
      if (hasNew) useChats.getState().loadChats().catch(() => {})
    } catch {}
  } catch {}
}

function startPresencePoll() {
  stopPresencePoll()
  // ⚡ বুটেই একবার সাথে সাথে — আগে প্রথম পোল ৬০ সেকেন্ড পরে হতো, মানে
  // লগইনের পরপরই কারো "online" ডট দেখাতে এক মিনিট অপেক্ষা লাগত।
  presenceTick().catch(() => {})
  presenceTimer = setInterval(presenceTick, 60_000)
}

function stopPresencePoll() {
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null }
}
