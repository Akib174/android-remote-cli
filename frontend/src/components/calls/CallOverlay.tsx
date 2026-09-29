// ভয়েস/ভিডিও কল — Cloudflare Calls (SFU) + WebRTC।
//
// আর্কিটেকচার (অফিসিয়াল Cloudflare video-room উদাহরণের মতো):
// প্রতি পার্টিসিপ্যান্টের **দুটি** PeerConnection + দুটি SFU সেশন —
//   • producer — নিজের মাইক/ক্যামেরা পাঠায় (sendonly ট্রান্সিভার + অফার/আনসার)
//   • consumer — বাকিদের ট্র্যাক টানে (remote-only ব্যাচ → SFU-অফার →
//     আমাদের answer → PUT /calls/renegotiate)
//
// 🆕 এই ভার্সনে (স্ট্যান্ডার্ড/সুন্দর কল-UI + ৩টা বাগ-ফিক্স):
//  • ⏱️ টাইমার **কল কানেক্ট হলেই** শুরু — আগে ওভারলে খোলার সাথে সাথেই চলত;
//    এখন কলারের দিকে রিং-স্টেটে "Ringing…" দেখায়, ওপক্ষ অ্যাকসেপ্ট করলে
//    (প্রথম রিমোট পার্টিসিপ্যান্ট যুক্ত হলে) কাউন্ট-আপ শুরু হয়
//  • 🎥 ভিডিও-ডিসপ্লে ফিক্স: আগে attachRemote setTimeout(50ms)-এ srcObject
//    বসাত — <video> এলিমেন্ট মাউন্ট-হওয়ার আগে হলে ভিডিও চিরকাল কালো থাকত।
//    এখন remoteStreams **state**-চালিত — টাইল মাউন্ট হলেই useEffect-এ যুক্ত হয়
//  • 🖥️ স্ক্রিনশেয়ার মেইন-স্টেজ: শেয়ার করলে/ওপক্ষ শেয়ার করলে স্ক্রিন বড়
//    ভিউতে দেখায় (ক্যামেরা-টাইলগুলো ছোট স্ট্রিপে) — Zoom/Meet/Telegram-স্টাইল।
//    'call-share' সিগন্যালিং DO-তে activeCall.sharing হিসেবে থাকে
//  • 🎮 গেম-মোড অক্ষত (গ্রুপ কলে টিম-অডিও ফিল্টারিং)
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUi } from '../../stores/ui'
import { useAuth } from '../../stores/auth'
import { useChats } from '../../stores/chats'
import { api } from '../../api/client'
import { sendChat } from '../../realtime/sockets'
import { Avatar } from '../common'
import { chatTitle } from '../../lib/notify'
import { startRingtone } from '../../lib/notify'
import { useT } from '../../lib/i18n'
import { IcMic, IcMicOff, IcVideo, IcVideoOff, IcScreen, IcPhoneEnd, IcVolume, IcPhone, IcUser } from '../../lib/icons'

interface P { uid: string; name: string }

export default function CallOverlay() {
  const call = useUi((s) => s.call)
  const setCall = useUi((s) => s.setCall)
  const me = useAuth.getState().user!
  const t = useT()

  const [participants, setParticipants] = useState<P[]>([])
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  // ⏱️ কানেক্টেড = কল অ্যাকসেপ্ট হয়েছে (কলারের দিকে: ওপক্ষ জয়েন করেছে) —
  // এই মুহূর্ত থেকেই টাইমার চলে
  const [connected, setConnected] = useState(false)
  // 🎮 গেম-মোড UI প্যানেল
  const [gamePanel, setGamePanel] = useState(false)
  // 🖥️ লোকাল স্ক্রিন-শেয়ার স্ট্রিম (নিজের স্ক্রিন বড়-ভিউতে দেখাতে)
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null)

  const prodRef = useRef<RTCPeerConnection | null>(null)
  const consRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenTrackRef = useRef<MediaStreamTrack | null>(null)
  // 🆕 রিমোট স্ট্রিম state — <video>/<audio> মাউন্ট-টাইমিং রেস আর থাকে না
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})

  // producer + consumer সেশন-আইডি
  const sessionsRef = useRef<{ prod: string; cons: string; mode: 'audio' | 'video' } | null>(null)
  // consumer ট্রান্সিভারের mid → trackName (`uid:kind`) — ontrack-এ কার মিডিয়া বোঝায়
  const midToName = useRef<Map<string, string>>(new Map())
  // ইতিমধ্যে pull-করা রিমোট ট্র্যাক ("producerSession/trackName")
  const pulled = useRef<Set<string>>(new Set())
  // consumer-সেশনে একবারে একটাই mutation (সিরিয়ালাইজড) — না হলে SFU
  // "পেন্ডিং নেগোসিয়েশন আগে শেষ করুন" এরর দেয়
  const subBusy = useRef(false)
  const subAgain = useRef(false)

  // ⚠️ reactive subscription — আগে getState() স্ন্যাপশট ছিল, তাই activeCall
  // বদলালেও (join/share) কম্পোনেন্ট রি-রেন্ডারই হতো না (টাইমার শুরু হতো না)
  const chat = useChats((s) => (call ? s.chats[call.chatId] : undefined))

  // ── 🎮 গেম-মোড স্টেট (activeCall.game থেকে) ──
  const game = (chat?.activeCall as any)?.game as { teams: Record<string, string[]>; entered: Record<string, boolean>; invites: Record<string, { by: string; team: string[] }> } | undefined
  const myTeam = game?.teams?.[me.id]
  const myInvite = game?.invites?.[me.id]
  // টিম অ্যাকটিভ = আমার টিমের সবাই Enter চেপেছে
  const teamActive = !!myTeam && myTeam.every((u) => game?.entered?.[u])
  const teamWaiting = !!myTeam && !teamActive
    ? myTeam.filter((u) => !game?.entered?.[u]).filter((u) => u !== me.id)
    : []
  const uname = (uid: string) => (chat?.members || []).find((m) => m.id === uid)?.username || uid.slice(0, 6)

  // 🖥️ ওপক্ষ স্ক্রিনশেয়ার করছে কি (activeCall.sharing = uid)
  const remoteSharingUid: string | null = (() => {
    const s = (chat?.activeCall as any)?.sharing
    return s && s !== me.id ? s : null
  })()

  // রিমোট মিডিয়া-স্ট্রিম **state**-এ রাখি — রেন্ডার-টাইমিং রেস নেই
  function attachRemote(uid: string, name: string, stream: MediaStream) {
    setParticipants((p) => (p.some((x) => x.uid === uid) ? p : [...p, { uid, name }]))
    setRemoteStreams((m) => (m[uid] === stream ? m : { ...m, [uid]: stream }))
  }

  // সব অ-নিজেস্ব পার্টিসিপ্যান্টের এখনো-pull-হয়নি-এমন রিমোট ট্র্যাক
  function pendingPulls(chatId: string, myUid: string): any[] {
    const ac = useChats.getState().chats[chatId]?.activeCall
    const out: any[] = []
    for (const [uid, sid] of Object.entries<any>(ac?.sessions || {})) {
      if (uid === myUid || !sid) continue
      for (const kind of ['audio', 'video']) {
        const trackName = `${uid}:${kind}`
        if (pulled.current.has(`${sid}/${trackName}`)) continue
        out.push({ location: 'remote', sessionId: String(sid), trackName })
      }
    }
    return out
  }

  // ট্র্যাক-রেসপন্স প্রসেস — pull-সেট আপডেট + mid→নাম ম্যাপ + পার্টিসিপ্যান্ট চেনা
  function applyTracks(tracks: any[], chatId: string) {
    const members = useChats.getState().chats[chatId]?.members || []
    for (const tr of tracks || []) {
      if (!tr || tr.location !== 'remote' || !tr.mid) continue
      if (tr.trackName) midToName.current.set(String(tr.mid), String(tr.trackName))
      if (tr.sessionId && tr.trackName) pulled.current.add(`${tr.sessionId}/${tr.trackName}`)
      const uid = String(tr.trackName || '').split(':')[0]
      if (uid) {
        const uname2 = members.find((m) => m.id === uid)?.username || uid.slice(0, 6)
        setParticipants((p) => (p.some((x) => x.uid === uid) ? p : [...p, { uid, name: uname2 }]))
      }
    }
  }

  // রিমোট ট্র্যাক subscribe — স্পেসিফিকেশন-ক্যানোনিকাল ক্রম
  async function subscribe(chatId: string) {
    const cons = consRef.current
    const info = sessionsRef.current
    if (!cons || !info) return
    if (subBusy.current) { subAgain.current = true; return }
    const pulls = pendingPulls(chatId, me.id)
    if (!pulls.length) return
    subBusy.current = true
    try {
      const res = await api('/calls/negotiate', {
        body: { sessionId: info.cons, body: { tracks: pulls } },
      })
      applyTracks(res.tracks, chatId)
      if (res.requiresImmediateRenegotiation && res.sessionDescription) {
        await cons.setRemoteDescription(res.sessionDescription)
        const answer = await cons.createAnswer()
        await cons.setLocalDescription(answer)
        await api('/calls/renegotiate', {
          method: 'PUT',
          body: { sessionId: info.cons, body: { sessionDescription: { type: 'answer', sdp: answer.sdp } } },
        })
      }
    } catch (e) {
      console.warn('subscribe failed', e)
    } finally {
      subBusy.current = false
      if (subAgain.current) { subAgain.current = false; subscribe(chatId).catch(() => {}) }
    }
  }

  function newPc(): RTCPeerConnection {
    return new RTCPeerConnection({
      bundlePolicy: 'max-bundle',
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
    })
  }

  // ── ইনকামিং-কল — রিংটোন + ভাইব্রেশন + ৬০-সেকেন্ড টাইমআউট ──
  // 🩹 টাইমআউটে এখন 'decline' ওপাশে পাঠায় — আগে শুধু নিজের রিং বন্ধ
  // হতো, কলারের দিকে "Ringing…" চিরকাল ঝুলে থাকত।
  useEffect(() => {
    if (!call?.incoming) return
    const stop = startRingtone()
    const timeout = setTimeout(() => {
      try {
        sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'decline' })
      } catch {}
      useUi.getState().setCall(null)
    }, 60000)
    return () => { stop(); clearTimeout(timeout) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.incoming])

  useEffect(() => {
    // ইনকামিং-কল ভিউ থেকে Accept করা পর্যন্ত কোনো WebRTC/SFU সেশন শুরু হয় না
    if (!call || call.incoming) return
    let dead = false
    let unsub: (() => void) | null = null
    setParticipants([{ uid: me.id, name: me.username }])
    setRemoteStreams({})
    setSeconds(0)
    // ⏱️ কানেক্টেড-স্টেট: অ্যাকসেপ্ট করা ক্যালি = সাথে সাথে কানেক্টেড (টাইমার শুরু);
    // কলার/অটো = রিং-স্টেট — ওপক্ষ জয়েন করলে (নিচের sessions-ওয়াচার) শুরু হয়
    if (call.auto || call.acceptedNow) setConnected(true)
    else setConnected(false)

    ;(async () => {
      try {
        // চলমান কলের তথ্য — জয়েনার হলে মোড জানা থাকে
        const existing = useChats.getState().chats[call.chatId]?.activeCall
        const joining = !!(existing?.sessions && Object.keys(existing.sessions).length)
        const mode: 'audio' | 'video' = (joining ? existing?.mode : call.mode) || 'audio'

        // ১. নিজের দুটি SFU সেশন — producer (পাঠানো) + consumer (টানা)
        const [p, c] = await Promise.all([
          api('/calls/session', { body: { chatId: call.chatId } }),
          api('/calls/session', { body: { chatId: call.chatId } }),
        ])
        if (!p.sessionId || !c.sessionId) throw new Error(p.message || c.message || t('noSession'))
        if (dead) return
        sessionsRef.current = { prod: String(p.sessionId), cons: String(c.sessionId), mode }
        useChats.getState().mergeCallSession(call.chatId, me.id, String(p.sessionId))

        // ২. মিডিয়া — 🎥 ক্যামেরা না পেলেও ভিডিও-কল চালু থাকে।
        // আগে ক্যামেরা না পেলে getUserMedia-ই throw করত → পুরো কল মরে যেত
        // ("Could not start video source") এবং ওপাশে কলই যেত না।
        // এখন: ভিডিও+অডিও → শুধু-অডিও → খালি-স্ট্রিম ফলব্যাক — কল সবসময়
        // কানেক্ট হয়, ক্যামেরা-নেই পাশ অ্যাভাটার হিসেবে দেখা যায়।
        let stream: MediaStream
        let camAvailable = false
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: mode === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
          })
          camAvailable = mode !== 'video' || stream.getVideoTracks().length > 0
        } catch {
          // ক্যামেরা/ডিভাইস নেই — অডিও-অনলিতে নামি
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            if (mode === 'video') useUi.getState().toast(t('camUnavailableAudio'))
          } catch {
            stream = new MediaStream()
            useUi.getState().toast(t('noMicNoCam'))
          }
        }
        if (!camAvailable) setCamOff(true)
        if (dead) { stream.getTracks().forEach((tr) => tr.stop()); return }
        localStreamRef.current = stream

        // ৩. producer PC — sendonly ট্রান্সিভার, অফার, mid তারপর পড়া
        const prod = newPc()
        prodRef.current = prod
        const transceivers: RTCRtpTransceiver[] = []
        for (const track of stream.getTracks()) {
          transceivers.push(prod.addTransceiver(track, { direction: 'sendonly' }))
        }
        const offer = await prod.createOffer()
        await prod.setLocalDescription(offer)
        const trackEntries = transceivers.map((tc) => ({
          location: 'local',
          mid: String(tc.mid ?? ''),
          trackName: `${me.id}:${tc.sender.track?.kind || 'audio'}`,
        })).filter((e) => e.mid !== '')
        const pubRes = await api('/calls/negotiate', {
          body: {
            sessionId: sessionsRef.current.prod,
            body: { sessionDescription: { type: 'offer', sdp: offer.sdp }, tracks: trackEntries },
          },
        })
        if (dead) return
        if (pubRes.sessionDescription) await prod.setRemoteDescription(pubRes.sessionDescription)

        // ৪. consumer PC — রিমোট ট্র্যাকের জন্য; ontrack-এ mid→trackName ম্যাপ
        const cons = newPc()
        consRef.current = cons
        cons.ontrack = (e) => {
          const stream2 = e.streams[0] || new MediaStream([e.track])
          const name = midToName.current.get(String((e.transceiver as any)?.mid)) || ''
          const uid = name ? name.split(':')[0] : ''
          const members = useChats.getState().chats[call.chatId]?.members || []
          const label = uid ? (members.find((m) => m.id === uid)?.username || uid.slice(0, 6)) : t('guest')
          attachRemote(uid || `remote-${Math.random().toString(36).slice(2, 8)}`, label, stream2)
        }

        // ৫. চলমান কলের বাকিদের ট্র্যাক টানি (জয়েনার হলে)
        if (joining) await subscribe(call.chatId)

        // ৬. সিগন্যালিং — অন্যদের জানাই (start নতুন কল, join চলমান কলে)
        if (joining) {
          sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'join', join: { sessionId: sessionsRef.current.prod } })
        } else {
          // 🔴 auto = লাল-বাটন কল — ওপাশে অটো-অ্যান্সার হবে
          sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'start', call: { sessionId: sessionsRef.current.prod, mode, auto: !!call.auto } })
        }

        // ৭. নতুন পার্টিসিপ্যান্ট এলে তার ট্র্যাক subscribe — activeCall.sessions-পরিবর্তন শোনা
        unsub = useChats.subscribe((s, prev) => {
          const now2 = s.chats[call.chatId]?.activeCall?.sessions
          const before = prev.chats[call.chatId]?.activeCall?.sessions
          if (now2 && now2 !== before) subscribe(call.chatId).catch(() => {})
        })
      } catch (e: any) {
        console.error(e)
        setError(e.message || t('callNotStarted'))
        try {
          const s = useChats.getState()
          const ac = s.chats[call.chatId]?.activeCall
          if (ac?.sessions && sessionsRef.current && ac.sessions[me.id] === sessionsRef.current.prod) {
            const sessions = { ...ac.sessions }
            delete sessions[me.id]
            useChats.setState((st) => ({ chats: { ...st.chats, [call.chatId]: { ...st.chats[call.chatId], activeCall: Object.keys(sessions).length ? { ...ac, sessions } : null } } }))
          }
        } catch {}
      }
    })()

    return () => {
      dead = true
      unsub?.()
      teardown()
      const info = sessionsRef.current
      if (info) {
        api('/calls/session/close', { body: { sessionId: info.prod } }).catch(() => {})
        api('/calls/session/close', { body: { sessionId: info.cons } }).catch(() => {})
        if (call) {
          sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'end' })
          // শেয়ার চালু অবস্থায় কেটে গেলে শেয়ার-স্টেটও পরিষ্কার
          if (useChats.getState().chats[call.chatId]?.activeCall) {
            sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'share', on: false })
          }
        }
      }
      sessionsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.chatId, call?.mode, call?.incoming])

  // ⏱️ টাইমার — শুধু কানেক্টেড হলেই চলে। কলারের দিকে ওপক্ষ জয়েন করলেই
  // (activeCall.sessions-এ অন্য কারো এন্ট্রি থাকলে) কানেক্টেড ধরি।
  useEffect(() => {
    if (!call || call.incoming || connected) return
    if (participants.length > 1) { setConnected(true); return }
    const ac = useChats.getState().chats[call.chatId]?.activeCall
    const otherJoined = ac?.sessions && Object.keys(ac.sessions).some((u) => u !== me.id)
    if (otherJoined) setConnected(true)
  }, [participants.length, connected, call, chat?.activeCall])

  useEffect(() => {
    if (!connected) return
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [connected])

  // ── 🎮 গেম-মোড অডিও ফিল্টারিং — টিম অ্যাকটিভ হলে শুধু টিমের অডিও বাজে ──
  useEffect(() => {
    for (const p of participants) {
      if (p.uid === me.id) continue
      const el = document.getElementById(`fcfc-call-audio-${p.uid}`) as HTMLAudioElement | null
      if (el) el.muted = teamActive && !myTeam?.includes(p.uid)
      const v = document.getElementById(`fcfc-call-video-${p.uid}`) as HTMLVideoElement | null
      if (v) v.muted = teamActive && !myTeam?.includes(p.uid)
    }
  }, [teamActive, myTeam, participants, game])

  function teardown() {
    localStreamRef.current?.getTracks().forEach((tr) => tr.stop())
    try { screenTrackRef.current?.stop() } catch {}
    try { prodRef.current?.close() } catch {}
    try { consRef.current?.close() } catch {}
    prodRef.current = null
    consRef.current = null
    localStreamRef.current = null
    screenTrackRef.current = null
    midToName.current.clear()
    pulled.current.clear()
  }

  // 🖥️ স্ক্রিনশেয়ার — ট্র্যাক রিপ্লেস + শেয়ার-স্টেট ব্রডকাস্ট (সবাই বড়-ভিউ দেখে)
  async function toggleShare() {
    const prod = prodRef.current
    if (!prod) return
    try {
      if (!sharing) {
        const ds = await navigator.mediaDevices.getDisplayMedia({ video: true })
        const screenTrack = ds.getVideoTracks()[0]
        screenTrackRef.current = screenTrack
        const sender = prod.getSenders().find((s) => s.track?.kind === 'video')
        if (sender) await sender.replaceTrack(screenTrack)
        screenTrack.onended = () => stopShare()
        setLocalScreen(ds)
        setSharing(true)
        sendChat(call!.chatId, { t: 'call', chatId: call!.chatId, action: 'share', on: true })
      } else {
        await stopShare()
      }
    } catch {}
  }

  async function stopShare() {
    const prod = prodRef.current
    if (!prod) return
    const sender = prod.getSenders().find((s) => s.track?.kind === 'video')
    const cam = localStreamRef.current?.getVideoTracks()[0] || null
    if (sender && call?.mode === 'video' && cam) await sender.replaceTrack(cam)
    try { screenTrackRef.current?.stop() } catch {}
    screenTrackRef.current = null
    setLocalScreen(null)
    setSharing(false)
    if (call) sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'share', on: false })
  }

  if (!call) return null
  const title = chat ? chatTitle(chat) : t('callT')
  const dur = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const isGroupCall = !!chat && chat.kind === 'group'
  const others = participants.filter((p) => p.uid !== me.id)
  const mode = sessionsRef.current?.mode || call.mode || 'audio'
  const statusText = error ? error : connected ? dur : t('callRinging')

  // 🖥️ মেইন-স্টেজ: কেউ স্ক্রিনশেয়ার করলে সেটাই বড় ভিউ
  const stageRemoteUid = remoteSharingUid || (sharing ? me.id : null)
  const hasVideoStage = mode === 'video' || !!stageRemoteUid

  // ── ইনকামিং-কল ভিউ — টেলিগ্রামের মতো: বড় অ্যাভাটার + রিং-পালস +
  // অ্যাকসেপ্ট/ডিক্লাইন (ট্যাব খোলা থাকলে এখানেই আসে, রিংটোন বাজে) ──
  if (call.incoming) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{ backgroundColor: 'rgba(11, 15, 26, 0.96)' }}
        className="fixed inset-0 z-[75] backdrop-blur flex flex-col items-center justify-center gap-6 px-6">
        <div className="flex flex-col items-center gap-4">
          <div className="relative ring-pulse">
            {chat?.kind === 'dm' && chat.peer
              ? <Avatar name={title} id={chat.peer.id} avatarKey={chat.peer.avatarKey} size={128} />
              : <div className="w-32 h-32 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-5xl font-bold">{title.slice(0, 1).toUpperCase()}</div>}
          </div>
          <div className="text-white text-2xl font-bold text-center">{title}</div>
          <div className="text-white/55 text-sm flex items-center gap-2">
            {call.mode === 'video' ? <IcVideo size={16} /> : <IcPhone size={16} />}
            {call.mode === 'video' ? t('incomingVideoCall') : t('incomingCall')}
          </div>
        </div>
        <div className="flex items-center gap-10 mt-6">
          <motion.button whileTap={{ scale: 0.88 }}
            onClick={() => { sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'decline' }); setCall(null) }}
            className="w-16 h-16 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-xl shadow-rose-500/40"
            title={t('declineBtn')}>
            <IcPhoneEnd size={26} />
          </motion.button>
          <motion.button whileTap={{ scale: 0.88 }}
            onClick={() => setCall({ chatId: call.chatId, mode: call.mode, acceptedNow: true })}
            className="w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xl shadow-emerald-500/40 animate-bounce"
            title={t('acceptBtn')}>
            <IcPhone size={26} />
          </motion.button>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ backgroundColor: 'rgba(11, 15, 26, 0.96)' }}
      className="fixed inset-0 z-[75] backdrop-blur flex flex-col">
      {/* উপরের সেন্টারে পার্টিসিপ্যান্ট (টেলিগ্রাম-স্টাইল) */}
      <div className="pt-5 flex flex-col items-center gap-1.5">
        <div className="text-white font-semibold text-lg">{title}</div>
        <div className={`text-sm tabular-nums ${error ? 'text-rose-300' : connected ? 'text-white/60' : 'text-amber-300/90'}`}>
          {statusText}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-center max-w-md px-4">
          {participants.map((p) => {
            const inMyTeam = teamActive && myTeam?.includes(p.uid)
            return (
              <motion.span key={p.uid} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 ${inMyTeam ? 'bg-emerald-500/25 text-emerald-200' : 'bg-white/10 text-white/85'}`}>
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${inMyTeam ? 'bg-emerald-400' : 'bg-white/40'}`} />
                {p.name}{p.uid === me.id ? ` (${t('you')})` : ''}
              </motion.span>
            )
          })}
        </div>
      </div>

      {/* ── ভিডিও এরিয়া: মেইন-স্টেজ + ছোট স্ট্রিপ ── */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 gap-3">
        {hasVideoStage ? (
          <>
            {/* মেইন-স্টেজ — স্ক্রিনশেয়ার চললে সেটাই, নইলে রিমোট ভিডিও */}
            <div className="relative w-full max-w-[900px] flex-1 min-h-0 rounded-2xl overflow-hidden bg-black/60 ring-1 ring-white/10">
              {sharing && localScreen ? (
                <ScreenStage stream={localScreen} />
              ) : stageRemoteUid && remoteStreams[stageRemoteUid] ? (
                <VideoEl id={`fcfc-call-video-${stageRemoteUid}`} stream={remoteStreams[stageRemoteUid]} screen />
              ) : others.length > 0 && remoteStreams[others[0].uid] ? (
                <VideoEl id={`fcfc-call-video-${others[0].uid}`} stream={remoteStreams[others[0].uid]} />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/40">
                  <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center overflow-hidden">
                    {chat?.kind === 'dm' && chat.peer
                      ? <Avatar name={title} id={chat.peer.id} avatarKey={chat.peer.avatarKey} size={96} />
                      : <IcUser size={44} />}
                  </div>
                  <div className="text-sm">{t('callRinging')}</div>
                </div>
              )}
              <span className="absolute bottom-2.5 left-3 px-2 py-0.5 rounded-md bg-black/55 text-white text-xs">
                {stageRemoteUid ? (stageRemoteUid === me.id ? `${t('you')} · 🖥️` : `${uname(stageRemoteUid)} · 🖥️`) : uname(others[0]?.uid || '')}
              </span>
              {/* নিজের ক্যামেরা ছোট প্রিভিউ (কোণায়) */}
              {mode === 'video' && !sharing && (
                <div className="absolute top-3 right-3 w-28 h-20 md:w-40 md:h-28 rounded-xl overflow-hidden bg-slate-800 ring-1 ring-white/15 shadow-lg">
                  <LocalPreview stream={localStreamRef.current} camOff={camOff} />
                  <span className="absolute bottom-1 left-1.5 text-[10px] text-white/85 bg-black/45 px-1.5 rounded">{t('you')}</span>
                </div>
              )}
            </div>
            {/* ফিল্মস্ট্রিপ — বাকি পার্টিসিপ্যান্টদের ছোট টাইল */}
            {(others.length > (stageRemoteUid ? 1 : 1) || sharing) && (
              <div className="flex gap-2 justify-center flex-wrap max-h-[104px] overflow-hidden">
                {others.filter((p) => p.uid !== stageRemoteUid && p.uid !== others[0]?.uid).map((p) => (
                  <div key={p.uid} className="relative w-[150px] h-[96px] rounded-xl overflow-hidden bg-slate-800 ring-1 ring-white/10">
                    {remoteStreams[p.uid]
                      ? <VideoEl id={`fcfc-call-video-${p.uid}`} stream={remoteStreams[p.uid]} />
                      : <div className="w-full h-full flex items-center justify-center"><Avatar name={p.name} id={p.uid} size={44} /></div>}
                    <span className="absolute bottom-1 left-1.5 text-[10px] text-white/85 bg-black/45 px-1.5 rounded">{p.name}</span>
                  </div>
                ))}
              </div>
            )}
            {/* ভয়েস-কলের লুকানো অডিও-এলিমেন্ট (সব মোডে দরকার) */}
            <div className="hidden">
              {others.map((p) => (
                <AudioEl key={p.uid} id={`fcfc-call-audio-${p.uid}`} stream={remoteStreams[p.uid]} />
              ))}
            </div>
          </>
        ) : (
          /* 🎙️ ভয়েস-কল ভিউ — স্পন্দিত অ্যাভাটার + লুকানো অডিও */
          <div className="flex flex-col items-center gap-4">
            <motion.div animate={{ scale: connected ? [1, 1.03, 1] : [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: connected ? 3.4 : 1.6 }}
              className={`w-32 h-32 rounded-full flex items-center justify-center text-white text-5xl font-bold shadow-2xl overflow-hidden ${teamActive ? 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/40' : 'bg-gradient-to-br from-brand-500 to-violet-600 shadow-brand-500/40'}`}>
              {chat?.kind === 'dm' && chat.peer
                ? <Avatar name={title} id={chat.peer.id} avatarKey={chat.peer.avatarKey} size={128} />
                : title.slice(0, 1).toUpperCase()}
            </motion.div>
            <div className="text-white/70 text-sm flex items-center gap-1.5"><IcVolume size={15} /> {t('voiceCallTag')}</div>
            {/* ভয়েস কলে ভিডিও-টাইল নেই — রিমোট অডিও এই লুকানো এলিমেন্টে বাজে */}
            <div className="hidden">
              {others.map((p) => (
                <AudioEl key={p.uid} id={`fcfc-call-audio-${p.uid}`} stream={remoteStreams[p.uid]} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 🎮 গেম-মোড কার্ড — ইনভাইট / ওয়েটিং / অ্যাকটিভ ── */}
      <AnimatePresence>
        {isGroupCall && (myInvite || teamWaiting || teamActive) && !gamePanel && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="mx-auto mb-3 w-full max-w-md rounded-2xl bg-white/10 border border-white/15 px-4 py-3.5 backdrop-blur-xl"
          >
            {myInvite && !myTeam ? (
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎮</span>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-semibold">{t('gameInviteT', { name: uname(myInvite.by) })}</div>
                  <div className="text-white/55 text-xs mt-0.5 truncate">
                    {t('gameTeamLabel')}: {myInvite.team.map((u) => uname(u)).join(', ')}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'game-decline' })}
                    className="px-3 py-1.5 rounded-xl bg-white/10 text-white/80 text-xs font-semibold">{t('gameDeclineBtn')}</button>
                  <motion.button whileTap={{ scale: 0.92 }} onClick={() => sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'game-enter' })}
                    className="px-4 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/30">{t('gameEnterBtn')}</motion.button>
                </div>
              </div>
            ) : teamWaiting ? (
              <div className="flex items-center gap-3">
                <span className="text-2xl animate-pulse">🎮</span>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-semibold">{t('gameWaitingT')}</div>
                  <div className="text-white/55 text-xs mt-0.5">
                    {teamWaiting.map((u) => uname(u)).join(', ')} — {t('gameWaitingHint')}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setGamePanel(true)} className="px-3 py-1.5 rounded-xl bg-white/10 text-white/80 text-xs font-semibold">{t('gameEditTeamBtn')}</button>
                  <button onClick={() => sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'game-exit' })}
                    className="px-3 py-1.5 rounded-xl bg-rose-500/20 text-rose-300 text-xs font-semibold">{t('gameExitBtn')}</button>
                </div>
              </div>
            ) : teamActive ? (
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎮</span>
                <div className="flex-1 min-w-0">
                  <div className="text-emerald-300 text-sm font-semibold">{t('gameActiveT')}</div>
                  <div className="text-white/55 text-xs mt-0.5 truncate">
                    {t('gameTeamLabel')}: {(myTeam || []).map((u) => uname(u)).join(', ')}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setGamePanel(true)} className="px-3 py-1.5 rounded-xl bg-white/10 text-white/80 text-xs font-semibold">{t('gameSwitchBtn')}</button>
                  <button onClick={() => sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'game-exit' })}
                    className="px-3 py-1.5 rounded-xl bg-rose-500/20 text-rose-300 text-xs font-semibold">{t('gameExitBtn')}</button>
                </div>
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 🎮 গেম-মোড সিলেকশন প্যানেল — টিম বাছাই ── */}
      <AnimatePresence>
        {gamePanel && (
          <GamePanel
            title={title}
            others={others}
            uname={uname}
            meId={me.id}
            initialSel={(myTeam || []).filter((u) => u !== me.id)}
            onInvite={(sel) => {
              setGamePanel(false)
              sendChat(call.chatId, { t: 'call', chatId: call.chatId, action: 'game-invite', team: [me.id, ...sel] })
            }}
            onClose={() => setGamePanel(false)}
          />
        )}
      </AnimatePresence>

      {/* কন্ট্রোল — স্ট্যান্ডার্ড কল-বার */}
      <div className="pb-8 pt-2 flex items-center justify-center gap-4">
        <CallBtn on={!muted} onClick={() => { const tr = localStreamRef.current?.getAudioTracks()[0]; if (tr) { tr.enabled = muted; setMuted(!muted) } }}>
          {muted ? <IcMicOff size={22} /> : <IcMic size={22} />}
        </CallBtn>
        {mode === 'video' && (
          <CallBtn on={!camOff} onClick={async () => { const tr = localStreamRef.current?.getVideoTracks()[0]; if (tr) { tr.enabled = camOff; setCamOff(!camOff) } }}>
            {camOff ? <IcVideoOff size={22} /> : <IcVideo size={22} />}
          </CallBtn>
        )}
        <CallBtn on={!sharing} onClick={toggleShare} highlight={sharing}><IcScreen size={22} /></CallBtn>
        {/* 🎮 গেম-মোড বাটন — গ্রুপ কলে ২+ পার্টিসিপ্যান্ট থাকলে */}
        {isGroupCall && others.length > 0 && (
          <motion.button whileTap={{ scale: 0.9 }} whileHover={{ scale: 1.06 }}
            onClick={() => setGamePanel(true)}
            title={t('gameModeBtn')}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition text-xl ${teamActive ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/40' : 'bg-white/10 text-white'}`}>
            🎮
          </motion.button>
        )}
        <motion.button whileTap={{ scale: 0.9 }} onClick={async () => { if (sharing) await stopShare(); teardown(); setCall(null) }}
          className="w-14 h-14 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-500/40">
          <IcPhoneEnd size={24} />
        </motion.button>
      </div>
    </motion.div>
  )
}

// ── 🖥️ স্ক্রিন-স্টেজ — contain (পুরো স্ক্রিন দেখা যায়, কাটে না) ──
function ScreenStage({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (v && v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}) }
  }, [stream])
  return <video ref={ref} muted playsInline className="w-full h-full object-contain bg-black" />
}

// ── রিমোট ভিডিও — stream state থেকে সরাসরি যুক্ত (mount-race নেই) ──
// 🎥 স্ট্রিমে ভিডিও-ট্র্যাক না থাকলে (ক্যামেরা-ছাড়া পার্টিসিপ্যান্ট) অ্যাভাটার-প্লেসহোল্ডার
function VideoEl({ id, stream, screen }: { id: string; stream?: MediaStream; screen?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (v && stream && v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}) }
  }, [stream])
  if (!stream) return null
  if (!screen && stream.getVideoTracks().length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black/60 text-white/40">
        <IcUser size={44} />
      </div>
    )
  }
  return <video id={id} ref={ref} autoPlay playsInline className={`w-full h-full ${screen ? 'object-contain bg-black' : 'object-cover'} bg-black`} />
}

function AudioEl({ id, stream }: { id: string; stream?: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const a = ref.current
    if (a && stream && a.srcObject !== stream) { a.srcObject = stream; a.play().catch(() => {}) }
  }, [stream])
  return <audio id={id} ref={ref} autoPlay playsInline />
}

// ── লোকাল প্রিভিউ — নিজের ক্যামেরা; camOff হলে অ্যাভাটার ──
function LocalPreview({ stream, camOff }: { stream: MediaStream | null; camOff: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (stream && v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}) }
  }, [stream])
  if (!stream || camOff) {
    return <div className="w-full h-full flex items-center justify-center bg-slate-700 text-white/50"><IcUser size={30} /></div>
  }
  return <video ref={ref} muted playsInline className="w-full h-full object-cover" />
}

// ── 🎮 টিম-সিলেকশন প্যানেল ──
function GamePanel({ title, others, uname, meId, initialSel, onInvite, onClose }: {
  title: string
  others: P[]
  uname: (uid: string) => string
  meId: string
  initialSel: string[]
  onInvite: (sel: string[]) => void
  onClose: () => void
}) {
  const [sel, setSel] = useState<string[]>(initialSel)
  const t = useT()
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}>
      <motion.div
        initial={{ scale: 0.9, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 10, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-[#141826] border border-white/10 shadow-2xl overflow-hidden"
      >
        <div className="px-5 pt-4 pb-3 border-b border-white/10">
          <div className="text-white font-bold text-lg flex items-center gap-2">🎮 {t('gameModeBtn')}</div>
          <div className="text-white/50 text-xs mt-1 leading-relaxed">{t('gameSelectHint')}</div>
        </div>
        <div className="max-h-[44vh] overflow-y-auto p-2">
          {others.length === 0 && <div className="text-white/40 text-sm text-center py-6">{t('gameNoOthers')}</div>}
          {others.map((p) => {
            const on = sel.includes(p.uid)
            return (
              <button key={p.uid} onClick={() => setSel((s) => (on ? s.filter((x) => x !== p.uid) : [...s, p.uid]))}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl transition ${on ? 'bg-emerald-500/20' : 'hover:bg-white/[0.06]'}`}>
                <Avatar name={p.name} id={p.uid} size={38} />
                <span className="flex-1 text-left text-white text-sm font-medium">{p.name}</span>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${on ? 'bg-emerald-500 border-emerald-500' : 'border-white/25'}`}>
                  {on && <span className="text-white text-[11px] font-black">✓</span>}
                </span>
              </button>
            )
          })}
        </div>
        <div className="p-4 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/10 text-white/80 text-sm font-semibold">{t('cancel')}</button>
          <motion.button whileTap={{ scale: 0.95 }} onClick={() => onInvite(sel)} disabled={sel.length === 0}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-bold disabled:opacity-40">
            {t('gameInviteBtn')} {sel.length > 0 ? `(${sel.length + 1})` : ''}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function CallBtn({ children, onClick, on, highlight }: { children: React.ReactNode; onClick: () => void; on: boolean; highlight?: boolean }) {
  return (
    <motion.button whileTap={{ scale: 0.9 }} onClick={onClick}
      className={`w-12 h-12 rounded-full flex items-center justify-center transition ${
        highlight ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/40'
        : on ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-white text-slate-900'}`}>
      {children}
    </motion.button>
  )
}
