// মেসেজ বাবল — টেক্সট/মিডিয়া/স্টিকার, রিপ্লাই কোট, রিয়্যাকশন, রিসিট চেকমার্ক,
// কনটেক্সট মেনু (টেলিগ্রাম-স্টাইল + রিয়্যাকশন-স্ট্রিপ), ডাবল-ক্লিক-টু-রিপ্লাই,
// সোয়াইপ-টু-রিপ্লাই, আর "delete for everyone"-এর Thanos-ভ্যানিশ।
//
// 🆕 এই ভার্সনে:
//  • একক-ইমোজি মেসেজ = ৫x বড় + টেলিগ্রাম-অ্যানিমেটেড (webp) — বাবল-ছাড়া
//  • মেসেজ-টেক্সট সিলেক্টেবল (আগে বন্ধ ছিল)
//  • হোভার-অ্যাকশন বার (Messenger-স্টাইল): রিপ্লাই / ইমোজি / এডিট / ৩-ডট মেনু
//  • রিসিট-টিক আরেকটু বড় (১৪→১৮px) — দূর থেকেই বোঝা যায়
import React, { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import type { Message } from '../../types'
import { useChats } from '../../stores/chats'
import { useAuth } from '../../stores/auth'
import { useUi } from '../../stores/ui'
import { Avatar } from '../common'
import { LinkPreview } from './LinkPreview'
import { vanishElement } from '../effects/VanishEffect'
import { decryptedMediaUrl, downloadMedia } from '../../lib/media'
import { fmtTime, fmtSize, URL_RE, extractUrl, cls } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import { Emoji, EmojiText, AnimatedEmoji, isSingleEmoji, REACTIONS, ALL_EMOJIS } from '../../lib/emoji'
import { IcCheck, IcDoubleCheck, IcDownload, IcPlay, IcDoc, IcReply2, IcForward, IcStar, IcPin, IcCopy, IcPencil, IcTrash, IcUsers, IcMore, IcSmile, IcVideo, IcPhone, IcPhoneIn, IcPhoneOut, IcPhoneMissed } from '../../lib/icons'

// ── টিক-মার্ক (টেলিগ্রামের মতো) — ১ টিক = sent/delivered, ২ টিক = seen (পড়া) ──
// স্টেট বদলালে key-চেঞ্জে রি-মাউন্ট → স্প্রিং-পপ + রঙ-বদল (seen = আকাশি)।
function Ticks({ msg }: { msg: Message }) {
  const state = msg.failed ? 'failed' : msg.pending ? 'pending' : msg.read ? 'read' : 'sent'
  return (
    <motion.span
      key={state}
      initial={{ scale: 0.3, opacity: 0, rotate: -35 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 540, damping: 20 }}
      className={cls('inline-flex items-center', state === 'read' ? 'text-sky-500 dark:text-sky-400' : '')}
    >
      {state === 'failed'
        ? <span className="text-rose-500 font-bold text-[14px]">!</span>
        : state === 'pending'
          ? <Emoji char="🕓" size={14} />
          : state === 'read'
            ? <IcDoubleCheck size={18} strokeWidth={2.4} />
            : <IcCheck size={18} strokeWidth={2.4} />}
    </motion.span>
  )
}

// কুইক-রিয়্যাকশন "আরও"-প্যানেলের বড় সেট (টেলিগ্রামের মতো জনপ্রিয়গুলো)
const MORE_REACTIONS = ALL_EMOJIS.slice(0, 96)

// ── 📞 কল-হিস্ট্রি পিল — টেলিগ্রামের সার্ভিস-মেসেজের মতো মাঝ-বরাবর সবুজ পিল ──
// "Incoming Call (6 minutes, 54 seconds)" / "Outgoing Video Call (…)" /
// "Canceled Call" / "Missed Call" (লাল)।
export function fmtCallDur(t: (k: string, v?: any) => string, dur?: number): string {
  if (!dur || dur < 1) return ''
  const m = Math.floor(dur / 60), s = dur % 60
  const parts: string[] = []
  if (m > 0) parts.push(t(m === 1 ? 'durMin1' : 'durMinN', { n: m }))
  if (s > 0 || m === 0) parts.push(t(s === 1 ? 'durSec1' : 'durSecN', { n: s }))
  return ` (${parts.join(', ')})`
}

function CallPill({ msg, mine }: { msg: Message; mine: boolean }) {
  const t = useT()
  const c = (msg as any).call || {}
  const ended = c.outcome === 'ended'
  const missed = !mine && (c.outcome === 'canceled' || c.outcome === 'declined')
  let label: string
  if (ended) {
    // টেলিগ্রাম ফরম্যাট: "Outgoing Video Call (1 minute, 7 seconds)" /
    // "Incoming Call (6 minutes, 54 seconds)"
    const dir = t(mine ? 'callOutgoing' : 'callIncoming')
    const type = c.mode === 'video' ? t('callTypeVideo') : t('callTypeCall')
    label = `${dir} ${type}` + fmtCallDur(t, c.dur)
  } else if (mine) {
    label = t('callCanceled')
  } else {
    label = c.outcome === 'declined' ? t('callDeclined') : t('callMissed')
  }
  const Icon = ended ? (c.mode === 'video' ? IcVideo : mine ? IcPhoneOut : IcPhoneIn)
    : missed ? IcPhoneMissed : IcPhoneOut
  return (
    <div className="flex justify-center my-2 px-3">
      <span className={cls(
        'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12.5px] font-medium backdrop-blur shadow-sm',
        missed ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      )}>
        <Icon size={14} />
        {label}
      </span>
    </div>
  )
}

// সোয়াইপ-টু-রিপ্লাই থ্রেশহোল্ড — এর বেশি ডানে টানলে রিপ্লাই সেট হয়
const SWIPE_REPLY_PX = 56

// ⚡ পারফরম্যান্স: React.memo — গ্রুপে টাইপিং/unread/প্রেজেন্স-আপডেটে চ্যাট-
// অবজেক্টের আইডেন্টিটি বদলায়, কিন্তু বাবলের সত্যিকার ইনপুট (msg/prev/
// chatId/kind/members) বদলায় না। আগে প্রতিটি টাইপিং-ইভেন্টে ২০০-৩০০টা
// বাবল framer-motion layout-সহ রি-রেন্ডার হতো — গ্রুপে "হঠাৎ হঠাৎ ল্যাগ"
// এর প্রধান কারণ এটাই ছিল। props-এ পুরো chat-অবজেক্ট না পাঠিয়ে স্টেবল
// টুকরা (chatId/kind/members — members-অ্যারে স্টোর-স্প্রেডে রেফারেন্স
// হারায় না) পাঠানো হয়, তাই memo-তুলনা কাজ করে।
const MessageBubbleImpl = ({ msg, prev, chatId, kind, members }: { msg: Message; prev?: Message; chatId: string; kind: string; members: any[] }) => {
  const me = useAuth.getState().user!
  const t = useT()
  const mine = msg.senderId === me.id
  const vanishing = useChats((s) => !!s.vanish[msg.id])
  const starred = useChats((s) => !!s.starredIds[msg.id])
  const replyingToId = useChats((s) => s.replyingTo?.id)
  // 🎭 একক-ইমোজির প্লে-কাউন্টার — ক্লিক/পিয়ারের ক্লিকে বাড়ে, key বদলে অ্যানিমেশন রিপ্লে
  const emojiPlaySeq = useChats((s) => s.emojiPlays[msg.id] || 0)
  const { finishVanish, toggleReaction, toggleStar, togglePinMessage, setReplying, deleteForEveryone, deleteForMe, editMessage, replaySoloEmoji } = useChats.getState()
  const { openMenu, openModal, toast } = useUi.getState()
  const bubbleRef = useRef<HTMLDivElement>(null)

  // ── একক-ইমোজি = ৫x সাইজ + অ্যানিমেটেড (টেলিগ্রাম) ──
  const soloEmoji = msg.type === 'text' ? isSingleEmoji(msg.body) : null

  // ── সোয়াইপ-টু-রিপ্লাই ──
  const swipeX = useMotionValue(0)
  const replyIconOpacity = useTransform(swipeX, [0, SWIPE_REPLY_PX], [0, 1])
  const swipe = useRef({ x0: 0, y0: 0, active: false, horizontal: false })

  function onTouchStart(e: React.TouchEvent) {
    const tc = e.touches[0]
    swipe.current = { x0: tc.clientX, y0: tc.clientY, active: true, horizontal: false }
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!swipe.current.active) return
    const tc = e.touches[0]
    const dx = tc.clientX - swipe.current.x0
    const dy = tc.clientY - swipe.current.y0
    if (!swipe.current.horizontal) {
      // অনুভূমিক ইনটেন্ট নিশ্চিত হলেই ড্র্যাগ শুরু (উল্লম্ব স্ক্রলে বাধা নেই)
      if (Math.abs(dx) > Math.abs(dy) + 8 && dx > 0) swipe.current.horizontal = true
      else if (Math.abs(dy) > Math.abs(dx) + 4) { swipe.current.active = false; return }
      else return
    }
    // ডানে টানা, রেজিস্ট্যান্স-সহ — বেশি দূর যেতে দিই না
    swipeX.set(Math.max(0, Math.min(dx, SWIPE_REPLY_PX + 30)) * 0.62)
  }
  function onTouchEnd() {
    if (!swipe.current.active) return
    const triggered = swipe.current.horizontal && swipeX.get() > SWIPE_REPLY_PX * 0.62
    animate(swipeX, 0, { type: 'spring', stiffness: 420, damping: 30 })
    swipe.current.active = false
    swipe.current.horizontal = false
    if (triggered) setReplying(msg)
  }

  const isGroup = kind === 'group'
  const sender = members.find((m) => m.id === msg.senderId)
  const sameSender = !!prev && prev.senderId === msg.senderId && msg.ts - prev.ts < 4 * 60_000 && prev.type !== 'system'

  // ভ্যানিশ অ্যানিমেশন ট্রিগার
  useEffect(() => {
    if (vanishing && bubbleRef.current) {
      const el = bubbleRef.current
      vanishElement(el).then(() => finishVanish(chatId, [msg.id]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vanishing])

  function menu(e: React.MouseEvent | React.TouchEvent) {
    if ('preventDefault' in e) e.preventDefault()
    // টাচ-লংপ্রেসে (বিশেষত iOS) contextmenu-র clientX/Y অনেক সময় 0 থাকে —
    // তখন বাবলের অবস্থান থেকে মেনু বসাই।
    const anyE = e as any
    const tc = anyE.changedTouches?.[0] || anyE.touches?.[0]
    let cx: number = tc?.clientX ?? anyE.clientX ?? 0
    let cy: number = tc?.clientY ?? anyE.clientY ?? 0
    if (!cx && !cy && bubbleRef.current) {
      const r = bubbleRef.current.getBoundingClientRect()
      cx = r.left + r.width / 2
      cy = r.top + 40
    }
    // টেলিগ্রামের হুবহু ক্রম: Reply → Copy Text → Pin → Forward → (এডিট/স্টার/সিন-বাই)
    // → ডেঞ্জার-সেপারেটর → Delete (me) → Delete (everyone)। উপরে রিয়্যাকশন-স্ট্রিপ।
    const items: any[] = [
      {
        label: t('replyLabel'),
        icon: <IcReply2 size={18} />,
        onClick: () => setReplying(msg),
      },
    ]
    if (msg.body) items.push({
      label: t('copyText'),
      icon: <IcCopy size={18} />,
      onClick: () => { navigator.clipboard.writeText(msg.body!); toast(t('copied')) },
    })
    items.push({
      label: t('pinUnpin'),
      icon: <IcPin size={18} />,
      onClick: () => togglePinMessage(chatId, msg.id),
    })
    items.push({
      label: t('forward'),
      icon: <IcForward size={18} />,
      onClick: () => openModal('forward', { msg }),
    })
    if (mine && msg.type === 'text') items.push({
      label: t('edit'),
      icon: <IcPencil size={18} />,
      onClick: () => openModal('edit', { chatId: chatId, msg }),
    })
    items.push({
      label: starred ? t('unstar') : t('star'),
      icon: <IcStar size={18} />,
      onClick: () => toggleStar(msg),
    })
    if (isGroup && mine) items.push({
      label: t('seenBy'),
      icon: <IcUsers size={18} />,
      onClick: () => openModal('seen-by', { chatId: chatId, msgId: msg.id }),
    })
    items.push({
      label: t('deleteMe'), danger: true,
      icon: <IcTrash size={18} />,
      onClick: () => deleteForMe(chatId, [msg.id]),
    })
    if (mine) items.push({
      label: t('deleteAll'), danger: true,
      icon: <IcTrash size={18} />,
      onClick: () => deleteForEveryone(chatId, [msg.id]),
    })
    openMenu(cx + 6, cy + 8, items, {
      emojis: REACTIONS,
      more: MORE_REACTIONS,
      onPick: (em) => toggleReaction(chatId, msg.id, em),
    })
  }

  // ৩-ডট মেনুর আইটেম (হোভার-বার থেকে) — রাইট-ক্লিক মেনুরই সাবসেট:
  // ফরওয়ার্ড, ডিলিট (আমার), ডিলিট (সবার), পিন, স্টার
  function moreMenu(x: number, y: number) {
    openMenu(x, y, [
      { label: t('forward'), icon: <IcForward size={18} />, onClick: () => openModal('forward', { msg }) },
      { label: t('pinUnpin'), icon: <IcPin size={18} />, onClick: () => togglePinMessage(chatId, msg.id) },
      { label: starred ? t('unstar') : t('star'), icon: <IcStar size={18} />, onClick: () => toggleStar(msg) },
      { label: t('deleteMe'), danger: true, icon: <IcTrash size={18} />, onClick: () => deleteForMe(chatId, [msg.id]) },
      ...(mine ? [{ label: t('deleteAll'), danger: true, icon: <IcTrash size={18} />, onClick: () => deleteForEveryone(chatId, [msg.id]) }] : []),
    ])
  }

  function emojiMenu(x: number, y: number) {
    openMenu(x, y, [], {
      emojis: REACTIONS,
      more: MORE_REACTIONS,
      onPick: (em) => toggleReaction(chatId, msg.id, em),
    })
  }

  const isMedia = ['image', 'gif'].includes(msg.type)
  const bubblePad = isMedia || msg.type === 'sticker' || soloEmoji ? 'p-1' : 'px-3 py-2'

  // 📞 কল-হিস্ট্রি রো — টেলিগ্রামের মতো মাঝ-বরাবর সার্ভিস-পিল (বাবল নয়)
  if (msg.type === 'call') {
    return <CallPill msg={msg} mine={mine} />
  }

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 480, damping: 34 }}
      // 🎯 টেলিগ্রামের মতো: মেসেজের পাশের ফাঁকা জায়গাতেও (সমান্তরালে)
      // ডাবল-ক্লিক করলেই রিপ্লাইয়ের জন্য সিলেক্ট হয় — শুধু বাবলে নয়।
      onDoubleClick={() => setReplying(msg)}
      className={cls('group flex w-full px-3 cursor-default', mine ? 'justify-end' : 'justify-start', sameSender ? 'mt-0.5' : 'mt-2.5')}
    >
      {/* গ্রুপে অন্যের অ্যাভাটার */}
      {!mine && isGroup && (
        <div className="w-9 mr-2 self-end">
          {!sameSender && <Avatar name={sender?.name || sender?.username || '?'} id={msg.senderId} avatarKey={sender?.avatarKey} size={32} />}
        </div>
      )}

      {/* সোয়াইপে ফিকে হয়ে ওঠা রিপ্লাই-আইকন (ইনকামিং বাবলের বামে) */}
      {!mine && (
        <motion.div style={{ opacity: replyIconOpacity }} className="self-center mr-1.5 text-brand-500 shrink-0">
          <IcReply2 size={17} />
        </motion.div>
      )}

      {/* আউটগোয়িং বাবলের বামে + ইনকামিং বাবলের ডানে — হোভার-অ্যাকশন বার
          ⚠️ বাগ-ফিক্স: আগে framer-motion-এর animate={{opacity:1}} ইনলাইন স্টাইল
          দিয়ে Tailwind-এর opacity-0 group-hover:opacity-100 ওভাররাইড করে
          দিচ্ছিল — বারটা প্রতিটি মেসেজের পাশে সবসময় দেখা যেত। এখন pure-CSS:
          কার্সর মেসেজের পাশে আনলেই স্প্রিং-স্টাইল অ্যানিমেশনে প্রিভিউ হয়। */}
      <div
        className={cls(
          'self-center shrink-0 hidden sm:flex items-center gap-0.5 px-1.5 py-1 rounded-full glass shadow-md z-10',
          // ডিফল্টে অদৃশ্য + ছোট — hover-এ অ্যানিমেট হয়ে ফুটে ওঠে (preview)
          'opacity-0 scale-75 pointer-events-none',
          'group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto',
          'transition-all duration-150 ease-out',
          mine ? 'mr-1.5 order-1' : 'ml-1.5 order-3',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <HoverAction title={t('replyLabel')} onClick={() => setReplying(msg)}><IcReply2 size={16} /></HoverAction>
        <HoverAction title={t('reactBtn')} onClick={(e) => emojiMenu(e.clientX, e.clientY + 10)}><IcSmile size={16} /></HoverAction>
        {mine && msg.type === 'text' && (
          <HoverAction title={t('edit')} onClick={() => openModal('edit', { chatId, msg })}><IcPencil size={16} /></HoverAction>
        )}
        <HoverAction title={t('moreBtn')} onClick={(e) => moreMenu(e.clientX - 100, e.clientY + 12)}><IcMore size={16} /></HoverAction>
      </div>

      <motion.div
        ref={bubbleRef}
        style={{ x: swipeX }}
        data-mid={msg.id}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onContextMenu={menu}
        // টেলিগ্রামের মতো: ডাবল-ক্লিকে মেসেজ রিপ্লাইয়ের জন্য সিলেক্ট হয়
        onDoubleClick={() => setReplying(msg)}
        className={cls(
          'relative max-w-[78%] md:max-w-[62%] rounded-2xl shadow-sm cursor-default transition-shadow msg-body',
          bubblePad,
          // একক-ইমোজি / স্টিকারে বাবল-ব্যাকগ্রাউন্ড নেই — নিখুঁত টেলিগ্রাম-লুক
          soloEmoji || msg.type === 'sticker' ? 'bg-transparent shadow-none border-none'
            : mine ? 'bg-bubble-out dark:bg-[#2b3a67] rounded-br-md' : 'bg-bubble-in dark:bg-[#1c2333] rounded-bl-md border border-slate-200/50 dark:border-slate-700/40',
          replyingToId === msg.id && 'ring-2 ring-brand-500/70 shadow-md',
        )}>
        {/* সেন্ডার নাম (গ্রুপ) */}
        {!mine && isGroup && !sameSender && (
          <div className="text-[12.5px] font-semibold px-1 pt-0.5" style={{ color: senderColor(msg.senderId) }}>{sender?.name || sender?.username || 'Unknown'}</div>
        )}

        {/* রিপ্লাই কোট — ক্লিক করলে অরিজিনাল মেসেজে জাম্প + ব্লিংক (টেলিগ্রাম) */}
        {msg.replyTo && (
          <button
            onClick={() => useChats.getState().jumpToMessage(chatId, msg.replyTo!.id)}
            className="mx-1 mt-1 mb-0.5 px-2.5 py-1.5 rounded-lg border-l-[3px] border-brand-500 bg-brand-500/10 text-[12.5px] text-left w-[calc(100%-8px)] hover:bg-brand-500/15 transition-colors"
          >
            <div className="font-semibold text-brand-600 dark:text-brand-300">{members.find((m) => m.id === msg.replyTo!.senderId)?.name || members.find((m) => m.id === msg.replyTo!.senderId)?.username || 'Unknown'}</div>
            <div className="opacity-75 truncate max-w-[260px]">{msg.replyTo.body}</div>
          </button>
        )}

        {/* ফরওয়ার্ড লেবেল */}
        {msg.fwdFrom && (
          <div className="text-[11.5px] italic opacity-60 px-1.5 pt-1 flex items-center gap-1">
            <IcForward size={12} /> {t('forwardedTag')}
          </div>
        )}

        {/* কনটেন্ট */}
        {msg.type === 'text' && !soloEmoji && <TextBody msg={msg} mine={mine} soloEmoji={soloEmoji} />}
        {msg.type === 'sticker' && (
          <div className="px-2 py-1">
            {/* 🎬 স্টিকারও টেলিগ্রামের মতো অ্যানিমেটেড webp */}
            <Emoji char={msg.body || '🙂'} size={96} animated className="sticker-pop" />
          </div>
        )}
        {soloEmoji && (
          <div className="px-2 py-1 flex items-center justify-center">
            {/* 🎬 টেলিগ্রামের মতো অ্যানিমেটেড লুপ + ক্লিকে দুই পাশেই রিস্টার্ট */}
            <AnimatedEmoji
              char={soloEmoji}
              size={95}
              playSeq={emojiPlaySeq}
              onReplay={() => replaySoloEmoji(chatId, msg.id)}
            />
          </div>
        )}
        {isMedia && <MediaBody msg={msg} />}
        {msg.type === 'video' && <MediaBody msg={msg} video />}
        {msg.type === 'voice' && <VoiceBody msg={msg} mine={mine} />}
        {msg.type === 'file' && <FileBody msg={msg} />}

        {/* রিয়্যাকশন — টেলিগ্রাম-স্টাইল পিল, Apple artwork */}
        {Object.keys(msg.reactions).length > 0 && (
          <div className="flex flex-wrap gap-1 px-1 pb-1 -mb-2.5">
            {Object.entries(msg.reactions).map(([em, users]) => {
              const active = users.includes(me.id)
              return (
                <button key={em} onClick={(e) => { e.stopPropagation(); toggleReaction(chatId, msg.id, em) }}
                  className={cls('text-[12px] shadow rounded-full px-1.5 py-0.5 flex items-center gap-1 border transition',
                    active
                      ? 'bg-brand-500/15 border-brand-500/40'
                      : 'bg-white/90 dark:bg-slate-700/90 border-slate-200 dark:border-slate-600 hover:bg-white dark:hover:bg-slate-600')}
                  title={users.map((u) => members.find((m) => m.id === u)?.name || members.find((m) => m.id === u)?.username || u).join(', ')}>
                  <Emoji char={em} size={16} />
                  {users.length > 1 && <span className="opacity-70">{users.length}</span>}
                </button>
              )
            })}
          </div>
        )}

        {/* মেটা লাইন */}
        {msg.type !== 'sticker' && !soloEmoji && (
          <div className={cls('flex items-center gap-1 justify-end px-1.5 pb-0.5 text-[11px]', mine ? 'text-brand-700/60 dark:text-brand-200/50' : 'text-slate-400', (msg.reactions && Object.keys(msg.reactions).length) ? 'mt-3' : 'mt-0.5')}>
            {starred && <Emoji char="⭐" size={11} />}
            {msg.editedAt && <span className="italic">{t('editedTag')}</span>}
            {msg.expiresAt && <Emoji char="⏳" size={11} />}
            {(msg as any).ap && <Emoji char="🔴" size={11} />}
            <span>{fmtTime(msg.ts)}</span>
            {mine && <Ticks msg={msg} />}
          </div>
        )}
        {/* একক-ইমোজি/স্টিকারে মেটা ভেসে থাকে (টেলিগ্রাম) */}
        {(soloEmoji || msg.type === 'sticker') && (
          <div className={cls('absolute bottom-0 right-1 flex items-center gap-1 text-[10.5px] px-1.5 rounded-full', mine ? 'text-brand-700/70 dark:text-brand-200/60' : 'text-slate-500', 'bg-white/60 dark:bg-black/30 backdrop-blur-sm')}>
            {starred && <Emoji char="⭐" size={10} />}
            <span>{fmtTime(msg.ts)}</span>
            {mine && <Ticks msg={msg} />}
          </div>
        )}
      </motion.div>

      {/* আউটগোয়িং বাবলের ডানে ফিকে রিপ্লাই-আইকন */}
      {mine && (
        <motion.div style={{ opacity: replyIconOpacity }} className="self-center ml-1.5 text-brand-500 shrink-0">
          <IcReply2 size={17} />
        </motion.div>
      )}
    </motion.div>
  )
}

const MessageBubble = React.memo(MessageBubbleImpl)
export default MessageBubble

// হোভার-অ্যাকশন বারের ছোট বাটন
function HoverAction({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <motion.button whileTap={{ scale: 0.8 }} title={title} aria-label={title}
      onClick={onClick}
      className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-300 hover:text-brand-500 hover:bg-brand-500/10 transition-colors">
      {children}
    </motion.button>
  )
}

// ── কনটেন্ট সাব-কম্পোনেন্ট ────────────────────────────────

function TextBody({ msg, mine, soloEmoji }: { msg: Message; mine: boolean; soloEmoji?: string | null }) {
  const url = extractUrl(msg.body || '')
  const parts = (msg.body || '').split(URL_RE)
  const urls = (msg.body || '').match(URL_RE) || []
  return (
    <div className="text-[14.5px] leading-relaxed whitespace-pre-wrap break-words px-0.5 pt-0.5">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {/* টেক্সটের ভেতরের ইমোজি — Apple artwork (টেলিগ্রামের মতো) */}
          <EmojiText text={p} size={19} />
          {urls[i] && <a className="msg-link" href={urls[i]} target="_blank" rel="noreferrer">{urls[i]}</a>}
        </React.Fragment>
      ))}
      {url && <LinkPreview url={url} dark={mine} />}
    </div>
  )
}

function useDecrypted(media?: { key: string; fileKey?: string; iv?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let dead = false
    if (media) decryptedMediaUrl(media as any).then((u) => !dead && setUrl(u)).catch(() => !dead && setErr(true))
    return () => { dead = true }
  }, [media?.key])
  return { url, err }
}

function MediaBody({ msg, video }: { msg: Message; video?: boolean }) {
  const t = useT()
  const { url, err } = useDecrypted(msg.media)
  const { openViewer } = useUi.getState()
  return (
    <div className="relative rounded-xl overflow-hidden my-0.5 mx-0.5">
      {err && <div className="w-56 h-40 flex items-center justify-center text-sm text-slate-400 bg-slate-100 dark:bg-slate-800">{t('mediaLoadFail')}</div>}
      {url && !video && (
        <img src={url} alt="" className="max-w-[320px] max-h-[360px] object-cover cursor-zoom-in block"
          onClick={() => openViewer([url], 0, msg.media?.name)} loading="lazy" />
      )}
      {url && video && (
        <video src={url} controls className="max-w-[340px] max-h-[380px] bg-black" preload="metadata" />
      )}
      {!url && !err && (
        <div className="w-56 h-40 skeleton" />
      )}
      {url && (
        <button onClick={() => downloadMedia(msg.media!)} title={t('download')}
          className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center backdrop-blur hover:bg-black/75 transition">
          <IcDownload size={15} />
        </button>
      )}
    </div>
  )
}

function VoiceBody({ msg, mine }: { msg: Message; mine: boolean }) {
  const t = useT()
  const { url, err } = useDecrypted(msg.media)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  // ⚠️ বাগ-ফিক্স (ক্লিক-রেস): <audio> এলিমেন্ট ডিক্রিপশন শেষ হলে রেন্ডার হয়।
  // আগে সেটার আগে প্লে-বাটনে ক্লিক করলে audioRef খালি → ক্লিক চুপচাপ হারিয়ে
  // যেত, আবার ক্লিক করতে হতো। এখন ক্লিক-ইন্টেন্ট রেখে দিই — url এলেই
  // নিজে থেকে বেজে ওঠে। ডিক্রিপ্ট ব্যর্থ হলে লাল ⚠ দেখায় (আগে মৃত-বাটন)।
  const wantPlay = useRef(false)
  const [queued, setQueued] = useState(false)
  useEffect(() => {
    if (url && wantPlay.current) {
      wantPlay.current = false
      setQueued(false)
      audioRef.current?.play().catch(() => {})
    }
  }, [url])
  const dur = msg.media?.dur || 0
  const bars = useRef(Array.from({ length: 30 }, () => 6 + Math.abs(Math.sin(msg.id.charCodeAt(2) * 7 + Math.random() * 3)) * 14)).current

  const toggle = () => {
    const a = audioRef.current
    if (a) {
      if (playing) { a.pause() }
      else { a.play().catch(() => {}) }
    } else if (!url && !err) {
      // মিডিয়া এখনো ডিক্রিপ্ট হচ্ছে — ইন্টেন্ট টগল (url এলেই বাজবে)
      wantPlay.current = !wantPlay.current
      setQueued(wantPlay.current)
    }
  }

  return (
    <div className="flex items-center gap-2.5 px-1.5 py-1.5 min-w-[220px]">
      <motion.button whileTap={{ scale: 0.85 }}
        onClick={toggle}
        className={cls('w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center shrink-0 shadow', queued && !url && 'animate-pulse')}>
        {playing ? <span className="flex gap-0.5"><i className="w-1 h-3.5 bg-white rounded" /><i className="w-1 h-3.5 bg-white rounded" /></span> : <IcPlay size={17} />}
      </motion.button>
      <div className="flex items-end gap-[2.5px] h-7">
        {bars.map((h, i) => <div key={i} className={cls('w-[3px] rounded-full', mine ? 'bg-brand-600/60' : 'bg-slate-400/70')} style={{ height: h }} />)}
      </div>
      <span className="text-[11px] opacity-60">{dur ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}` : ''}</span>
      {(msg as any).ap && <span className="text-[10px] font-semibold text-rose-500" title={t('autoPlayTag')}>{t('autoPlayTag')}</span>}
      {err && <span className="text-[10px] font-semibold text-rose-500" title={t('mediaLoadFail')}>⚠</span>}
      {queued && !url && !err && <span className="text-[10px] opacity-50 animate-pulse">…</span>}
      {url && <audio ref={audioRef} src={url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />}
    </div>
  )
}

function FileBody({ msg }: { msg: Message }) {
  const t = useT()
  const { url } = useDecrypted(msg.media)
  return (
    <div className="flex items-center gap-3 px-2 py-2 min-w-[230px]">
      <div className="w-11 h-11 rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-300 flex items-center justify-center shrink-0"><IcDoc size={22} /></div>
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium truncate max-w-[240px]">{msg.media?.name || t('fileLabel')}</div>
        <div className="text-[11.5px] opacity-60">{fmtSize(msg.media?.size)}</div>
      </div>
      {url && (
        <button onClick={() => downloadMedia(msg.media!)} className="ml-auto w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-600 transition">
          <IcDownload size={16} />
        </button>
      )}
    </div>
  )
}

function senderColor(id: string) {
  const colors = ['#e5484d', '#f76808', '#00a2c7', '#30a46c', '#6e56cf', '#d6409f', '#e93d82', '#12a594']
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}
