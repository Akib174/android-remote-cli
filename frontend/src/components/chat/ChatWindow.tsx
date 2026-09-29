// চ্যাট উইন্ডো — হেডার (ক্লিকে ডান-পাশের প্রোফাইল-প্যানেল), পিনড বার,
// মেসেজ লিস্ট (ডেট-সেপারেটর সহ), টাইপিং।
// ব্লকড পিয়ার হলে কম্পোজারের বদলে "আনব্লক করুন" বার দেখায়।
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChats } from '../../stores/chats'
import { useAuth } from '../../stores/auth'
import { useUi } from '../../stores/ui'
import { ChatAvatar, IconTile } from '../common'
import MessageBubble from './MessageBubble'
import Composer from './Composer'
import { chatTitle, } from '../../lib/notify'
import { fmtDay, fmtLastSeen, MUTE_OPTIONS } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import { IcBack, IcPhone, IcVideo, IcSearch, IcMore, IcPin, IcX, IcBellOff, IcBell, IcExport, IcTrash, IcTimer, IcUsers, IcUser, IcBlock, IcUnblock } from '../../lib/icons'
import type { Message } from '../../types'

export default function ChatWindow({ chatId }: { chatId: string }) {
  const chat = useChats((s) => s.chats[chatId])
  const messages = useChats((s) => s.messages[chatId] || [])
  // ⚡ ল্যাগ-ফিক্স: আগে পুরো presence-ম্যাপ সাবস্ক্রাইব হতো — ৬০-সেকেন্ডের
  // পোল প্রতিবার নতুন অবজেক্ট বসায়, ফলে পুরো চ্যাট-উইন্ডো + শত-শত বাবল
  // প্রতি মিনিটে বেফারা রি-রেন্ডার হতো (গ্রুপে "হঠাৎ ল্যাগ" অনুভূতি)।
  // এখন সিলেক্টর শুধু এই চ্যাটের পিয়ারের বুলিয়ান-স্টেট ফেরত দেয় —
  // আসল পরিবর্তন ছাড়া রি-রেন্ডার হয় না।
  const online = useChats((s) => {
    const c = s.chats[chatId]
    return !!(c && c.kind === 'dm' && c.peer && s.presence[c.peer.id])
  })
  const blockedIds = useChats((s) => s.blockedIds)
  const { closeChat, loadHistory, markRead, patchChatState, togglePinMessage } = useChats.getState()
  const { openMenu, openModal, toast, setMobileView, openRightPanel } = useUi.getState()
  const t = useT()
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)
  // 🔴🔵 অডিও-কল জোড়া — হোভার/ক্লিকে ওপেন হয় (লাল = অটো-অ্যান্সার, নীল = সাধারণ রিং)
  const [showCallPair, setShowCallPair] = useState(false)

  useEffect(() => {
    // নতুন মেসেজে স্ক্রল
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: messages.length > 40 ? 'auto' : 'smooth' }))
    }
  }, [messages.length])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      if (el.scrollTop < 300 && !useChats.getState().loadedAll[chatId]) {
        const first = useChats.getState().messages[chatId]?.[0]
        if (first) loadHistory(chatId, first.ts)
      }
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [chatId])

  // ভিজিবিলিটি: ফোকাসে এলে রিড-রিচিট
  useEffect(() => {
    const vis = () => { if (document.visibilityState === 'visible') markRead(chatId) }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [chatId])

  // ⚡ ল্যাগ-ফিক্স: আগে প্রতিটি বাবলের জন্য messages.indexOf() ডাকা হতো —
  // N-টি মেসেজে O(N²) স্ক্যান, লম্বা চ্যাটে প্রতি রেন্ডারে লাখ-সংখ্যক
  // তুলনা। এখন একবারই লুপে prev ট্র্যাক করা হয় (O(N))।
  const days = useMemo(() => {
    const out: (Message | { day: string; id: string; prev?: Message })[] = []
    let lastDay = ''
    let prev: Message | undefined
    for (const m of messages) {
      const d = new Date(m.ts).toDateString()
      if (d !== lastDay) { lastDay = d; out.push({ day: fmtDay(m.ts), id: 'day-' + d, prev }) }
      out.push(m)
      prev = m
    }
    // দিন-সেপারেটরের prev রেখে দিই — সেপারেটরের পরের প্রথম বাবলের জন্য
    // (রেন্ডারে সেপারেটর-স্লট থেকে সরিয়ে নেওয়া হয়)
    const withPrev = new Map<string, Message | undefined>()
    let p: Message | undefined
    for (const item of out) {
      if ('day' in item) { withPrev.set('first-after-' + item.id, item.prev); p = item.prev }
      else { withPrev.set(item.id, p); p = item as Message }
    }
    return { out, withPrev }
  }, [messages])

  if (!chat) return null
  const title = chatTitle(chat)
  const typing = (chat.typing || []).map((u) => chat.members.find((m) => m.id === u)?.username || t('someone'))
  const iBlocked = !!(chat.kind === 'dm' && chat.peer && blockedIds[chat.peer.id])
  // 📌 Saved Messages — সাবটাইটেল Telegram-এর মতো
  const subtitle = chat.saved
    ? t('savedSub')
    : typing.length
    ? t('typingMulti', { names: typing.join(', ') })
    : chat.kind === 'group'
      ? t('membersCount', { n: chat.members.length })
      : online ? t('online')
      : chat.peer?.deleted ? t('accountDeleted')
      : chat.peer?.lastSeenPriv === 'nobody' ? t('lastSeenHidden')
      : t('lastSeenAt', { when: fmtLastSeen(chat.peer?.lastSeenAt) })

  const pinnedMsgs = (chat.pins || []).map((id) => messages.find((m) => m.id === id)).filter(Boolean) as Message[]

  function headerMenu(e: React.MouseEvent) {
    // 🗑️ "Change wallpaper"-আইটেম বাদ — ওয়ালপেপার-ফিচার রিমুভ করা হয়েছে।
    openMenu(e.clientX, e.clientY, [
      {
        label: t('searchInChat'),
        icon: <IcSearch size={18} />,
        onClick: () => openModal('search', { chatId }),
      },
      {
        label: chat.mutedUntil && chat.mutedUntil > Date.now() ? t('unmute') : t('mute8h'),
        icon: chat.mutedUntil && chat.mutedUntil > Date.now() ? <IcBell size={18} /> : <IcBellOff size={18} />,
        onClick: () => patchChatState(chatId, { mutedUntil: chat.mutedUntil && chat.mutedUntil > Date.now() ? 0 : Date.now() + MUTE_OPTIONS[0].ms }),
      },
      {
        label: chat.ttl ? t('disappOff') : t('disapp24'),
        icon: <IcTimer size={18} />,
        onClick: () => patchChatState(chatId, { ttl: chat.ttl ? 0 : 86400 }),
      },
      {
        label: t('exportChat'),
        icon: <IcExport size={18} />,
        onClick: () => useChats.getState().exportChat(chatId),
      },
      chat.kind === 'group'
        ? {
            label: t('groupInfo'),
            icon: <IcUsers size={18} />,
            onClick: () => openRightPanel(chatId),
          }
        : {
            label: t('viewProfile'),
            icon: <IcUser size={18} />,
            onClick: () => openRightPanel(chatId),
          },
      ...(chat.kind === 'dm' ? [{
        label: t('deleteChatMe'), danger: true,
        icon: <IcTrash size={18} />,
        onClick: () => { patchChatState(chatId, { deleteForMe: true }); closeChat(); toast(t('chatDeletedToast')) },
      }] : []),
    ])
  }

  return (
    // 🎬 চ্যাট-সুইচ ট্রানজিশন — অন্য চ্যাটে গেলে পুরো উইন্ডোটা হালকা
    // ফেড+স্লাইড হয়ে বসে (Telegram Web-এর মতো অনুভূতি)
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.995 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className="h-full flex flex-col relative">
      {/* হেডার — টেলিগ্রামের মতো পুরো বারে ক্লিক করলে ডান পাশে প্রোফাইল-প্যানেল খোলে।
          🆕 কম্পোজারের মতোই কার্ভড (rounded-2xl) ফ্লোটিং গ্লাস-বার — পেছনের
          অ্যানিমেটেড ওয়ালপেপার চারদিক দিয়ে ঝলমল করে */}
      <div className="flex items-center gap-2.5 px-3 py-2 glass-bar border border-slate-200/60 dark:border-white/[0.07] z-10 mx-2 mt-2 rounded-2xl shadow-sm">
        <button onClick={() => { setMobileView('list'); closeChat() }} className="md:hidden p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/10"><IcBack size={20} /></button>
        <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => openRightPanel(chatId)}>
          <ChatAvatar chat={chat} size={42} online={!!online} />
          <div className="min-w-0">
            <div className="font-semibold text-[15px] truncate">{title}</div>
            <div className={`text-xs truncate ${typing.length ? 'text-brand-500 font-medium' : 'text-slate-400'}`}>{subtitle}</div>
          </div>
        </button>

        {/* চলমান কল ব্যানার */}
        <AnimatePresence>
          {chat.activeCall && (
            <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              onClick={() => useUi.getState().setCall({ chatId, mode: 'video' })}
              className="px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> {t('callOngoing')}
            </motion.button>
          )}
        </AnimatePresence>

        {/* ব্লকড পিয়ার / Saved Messages-এ কল-বাটন নেই — নিজেকে কল দেওয়ার
            দরকার নেই, আনব্লক করলেই ফিরে আসে */}
        {!iBlocked && !chat.saved && (
          <>
            {/* 🔴🔵 অডিও-কল — হোভার/ক্লিকে দুটি বাটন:
                🔴 লাল = ওপাশে রিং না বাজিয়ে অটো-ধরা হয়
                🔵 নীল = সাধারণ কল — ওপাশে রিং বাজে */}
            <div className="relative shrink-0"
              onMouseEnter={() => setShowCallPair(true)}
              onMouseLeave={() => setShowCallPair(false)}>
              <AnimatePresence mode="wait">
                {showCallPair ? (
                  <motion.div key="pair" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                    className="flex gap-1 items-center">
                    <motion.button whileTap={{ scale: 0.85 }} whileHover={{ scale: 1.1 }} title={t('callAutoHint')}
                      onClick={() => useUi.getState().setCall({ chatId, mode: 'audio', auto: true })}
                      className="p-2 rounded-full text-white bg-gradient-to-br from-rose-500 to-red-600 shadow-md shadow-rose-500/40">
                      <IcPhone size={19} />
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.85 }} whileHover={{ scale: 1.1 }} title={t('callNormalHint')}
                      onClick={() => useUi.getState().setCall({ chatId, mode: 'audio' })}
                      className="p-2 rounded-full text-white bg-gradient-to-br from-brand-500 to-violet-600 shadow-md shadow-brand-500/30">
                      <IcPhone size={19} />
                    </motion.button>
                  </motion.div>
                ) : (
                  <motion.button key="phone" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                    onClick={() => setShowCallPair(true)}
                    className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 transition"><IcPhone size={20} /></motion.button>
                )}
              </AnimatePresence>
            </div>
            <button onClick={() => useUi.getState().setCall({ chatId, mode: 'video' })} className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 transition hidden sm:block"><IcVideo size={21} /></button>
          </>
        )}
        <button onClick={() => openModal('search', { chatId })} className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 transition hidden sm:block"><IcSearch size={19} /></button>
        <button onClick={headerMenu} className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 transition"><IcMore size={20} /></button>
      </div>

      {/* পিনড মেসেজ বার */}
      <AnimatePresence>
        {pinnedMsgs.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden glass-bar border border-slate-200/60 dark:border-white/[0.07] z-10 mx-2 mt-1 rounded-2xl">
            <div className="flex items-center gap-2.5 px-4 py-2">
              <IcPin size={16} className="text-brand-500 shrink-0" />
              <div className="flex-1 min-w-0 text-[13px]">
                <span className="font-semibold text-brand-600 dark:text-brand-300">{t('pinnedLabel')}</span>
                <span className="opacity-70 truncate ml-2">{pinnedMsgs[pinnedMsgs.length - 1]?.body || t('nPinnedMsgs', { n: pinnedMsgs.length })}</span>
              </div>
              {pinnedMsgs.length > 1 && <span className="text-xs opacity-50">1/{pinnedMsgs.length}</span>}
              <button onClick={() => togglePinMessage(chatId, pinnedMsgs[pinnedMsgs.length - 1].id)} className="opacity-50 hover:opacity-100"><IcX size={16} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* মেসেজ লিস্ট */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain py-3">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <div className="px-5 py-3 rounded-2xl bg-black/25 dark:bg-black/40 text-white/90 text-sm backdrop-blur text-center">
              {t('encryptedNotice')}
            </div>
          </div>
        )}
        {days.out.map((item) =>
          'day' in item ? (
            <div key={item.id} className="flex justify-center my-3">
              <span className="px-3 py-1 rounded-full bg-black/20 dark:bg-black/40 text-white/90 text-xs font-medium backdrop-blur">{item.day}</span>
            </div>
          ) : (
            <MessageBubble key={item.id} msg={item} prev={days.withPrev.get(item.id)} chatId={chatId} kind={chat.kind} members={chat.members} />
          ),
        )}
        <AnimatePresence>
          {typing.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex px-3 mt-2">
              <div className="bg-bubble-in dark:bg-[#1c2333] rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border border-slate-200/50 dark:border-slate-700/40 flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400"
                    animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* আমি ব্লক করেছি → কম্পোজারের বদলে আনব্লক-বার (মেসেজ পাঠানো বন্ধ) */}
      {iBlocked && chat.peer ? (
        <div className="px-3 pb-3 pt-1">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-rose-500/10 border border-rose-500/25">
            <IconTile from="#ef4444" to="#f87171"><IcBlock size={17} /></IconTile>
            <div className="flex-1 min-w-0 text-[13px] text-rose-600 dark:text-rose-300 font-medium truncate">
              {t('blockedBar', { name: chat.peer.username })}
            </div>
            <button
              onClick={async () => { await useChats.getState().unblock(chat.peer!.id); toast(t('unblockedToast')) }}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold shrink-0 flex items-center gap-1.5"
            >
              <IcUnblock size={16} /> {t('unblock')}
            </button>
          </div>
        </div>
      ) : (
        <Composer chat={chat} />
      )}
    </motion.div>
  )
}
