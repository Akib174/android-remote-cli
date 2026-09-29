// সাইডবার চ্যাট লিস্ট — টেলিগ্রাম-স্টাইল: সার্চ-বার, কমপ্যাক্ট রাউন্ডেড-আইটেম,
// পিন/আর্কাইভ/মিউট, টাইপিং, আনরিড ব্যাজ, নিচে-ডানে পেন্সিল-FAB।
//
// 🆕 এই ভার্সনে:
//  • 🍔 টেলিগ্রামের হুবহু হ্যামবার্গার-মেনু (স্ক্রিনশট-রেফারেন্স): অ্যাকাউন্ট-হেডার,
//    Add Account, My Profile, Saved Messages, Contacts, Wallet, Settings, More
//    (More-এ Night Mode + Archived + Log Out সাব-মেনু)
//  • 🔎 সার্চে Enter-লাগবে না — টাইপ করার সাথে সাথে নিচে ইউজার-রেজাল্ট ভেসে
//    ওঠে; ইউজারে ক্লিক করলেই সরাসরি চ্যাট/প্রোফাইল খুলে যায়
//  • গ্লাসমরফিজম + ডান-কোণাগুলো কার্ভড, সরু হলে কম্প্যাক্ট-মোড (শুধু অ্যাভাটার)
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useChats } from '../../stores/chats'
import { useAuth } from '../../stores/auth'
import { useUi } from '../../stores/ui'
import { Avatar, ChatAvatar } from '../common'
import { fmtTime, fmtDay, MUTE_OPTIONS } from '../../lib/utils'
import { chatTitle } from '../../lib/notify'
import { useT } from '../../lib/i18n'
import { EmojiText } from '../../lib/emoji'
import { api } from '../../api/client'
import { IcSearch, IcPencil, IcPin, IcBellOff, IcBell, IcArchive, IcTrash, IcUsers, IcUser, IcBookmark, IcGear, IcMore, IcChevR, IcMoon, IcSun, IcLogout } from '../../lib/icons'
import { GlassMenu, GlassItem, GlassDivider, useRefraction } from '../GlassMenu'
import type { Chat } from '../../types'

// এই প্রস্থর নিচে সাইডবার কম্প্যাক্ট-মোডে চলে যায় (শুধু অ্যাভাটার)
export const COMPACT_W = 116

// 🆕 হোভার-ক্যাপাবল ডিভাইস? (ডেস্কটপ/ল্যাপটপ) — More-সাব-মেনুর
// hover-auto-expand শুধু এখানেই চালু; টাচ-ডিভাইসে ট্যাপ-টগল থাকে।
// ইভেন্টের সময়ে যাচাই (কনস্ট-নয়) — ডিভাইস-মোড বদলালেও (টাচ-স্ক্রিন
// ল্যাপটপ) সঠিক আচরণ।
function hoverCapable(): boolean {
  try { return window.matchMedia('(hover: hover) and (pointer: fine)').matches } catch { return false }
}

export default function ChatList() {
  const chats = useChats((s) => s.chats)
  // ⚡ ল্যাগ-ফিক্স: পুরো presence-ম্যাপ সাবস্ক্রাইব নয় — প্রতিটি সারি নিজের
  // পিয়ারের বুলিয়ান-স্টেট সাবস্ক্রাইব করে। ৬০-সেকেন্ডের প্রেজেন্স-পোলের
  // অবজেক্ট-চার্নে পুরো লিস্ট আর রি-রেন্ডার হয় না।
  const activeChatId = useChats((s) => s.activeChatId)
  const requests = useChats((s) => s.requests)
  const openChat = useChats((s) => s.openChat)
  const patchChatState = useChats((s) => s.patchChatState)
  const respondRequest = useChats((s) => s.respondRequest)
  const sidebarW = useUi((s) => s.sidebarW)
  const compact = sidebarW < COMPACT_W
  const { openModal, setPanel, toast } = useUi.getState()
  const t = useT()
  const me = useAuth((s) => s.user)

  const [q, setQ] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  // 🔎 গ্লোবাল ইউজার-সার্চ (ইনলাইন — Enter ছাড়াই)
  const [userHits, setUserHits] = useState<any[]>([])
  // 🩹 মেনু-পজিশন — বার্গারের রেক্ট থেকে fixed-কোঅর্ডিনেট। আগে মেনুটা
  // সাইডবারের ভেতরে absolute + overflow-hidden-ক্লিপড ছিল — সাইডবার
  // সরু হলে (116px-ও হতে পারে) 224px-মেনুর ডান-অর্ধেক কাটা পড়ত ("profile
  // option অর্ধেক দেখা যায়")। এখন body-তে portal + position:fixed —
  // সাইডবার যতই সরু/চওড়া হোক, মেনু সবসময় পুরোটা দেখা যায়।
  const [menuPos, setMenuPos] = useState({ left: 12, top: 66 })

  // ESC — হ্যামবার্গার-মেনু/সাব-মেনু বন্ধ (টেলিগ্রাম-স্টাইল)
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setMenuOpen(false)
      setMoreOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [menuOpen])

  const sorted = useMemo(() => {
    const needle = q.toLowerCase()
    const list = Object.values(chats).filter((c) => !c.archived)
      .filter((c) => !needle || chatTitle(c).toLowerCase().includes(needle))
    return list.sort((a, b) => {
      // 📌 Saved Messages সবার উপরে (Telegram-এর মতো), তারপর পিনড, তারপর সময়
      if (!!a.saved !== !!b.saved) return a.saved ? -1 : 1
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return (b.lastTs || 0) - (a.lastTs || 0)
    })
  }, [chats, q])

  const archivedCount = useMemo(() => Object.values(chats).filter((c) => c.archived).length, [chats])

  // টাইপ করার সাথে সাথে ইউজার-সার্চ (debounced) — ক্লিকেই চ্যাট খোলে
  useEffect(() => {
    const needle = q.trim()
    if (needle.length < 2) { setUserHits([]); return }
    const ctrl = new AbortController()
    const id = setTimeout(async () => {
      try {
        const r = await api(`/users/search?q=${encodeURIComponent(needle)}`, { signal: (ctrl as any).signal } as any)
        setUserHits((r.results || []).filter((u: any) => u.id !== me?.id).slice(0, 8))
      } catch { /* abort/নেটওয়ার্ক — চুপচাপ */ }
    }, 300)
    return () => { clearTimeout(id); ctrl.abort() }
  }, [q, me?.id])

  async function openUser(u: any) {
    setQ(''); setUserHits([])
    const res = await useChats.getState().createDm(u.id)
    if (res.chatId) useChats.getState().openChat(res.chatId)
    else if (res.request) toast(t('reqSentShort'))
  }

  function itemMenu(e: React.MouseEvent, chat: Chat) {
    e.preventDefault()
    useUi.getState().openMenu(e.clientX, e.clientY, [
      {
        label: chat.pinned ? t('unpinChat') : t('pinChat'),
        icon: <IcPin size={18} />,
        onClick: () => patchChatState(chat.id, { pinned: !chat.pinned }),
      },
      {
        label: t('mute8'),
        icon: <IcBellOff size={18} />,
        onClick: () => patchChatState(chat.id, { mutedUntil: Date.now() + MUTE_OPTIONS[0].ms }),
      },
      {
        label: t('muteForever'),
        icon: <IcBellOff size={18} />,
        onClick: () => patchChatState(chat.id, { mutedUntil: Date.now() + MUTE_OPTIONS[2].ms }),
      },
      {
        label: t('unmute'),
        icon: <IcBell size={18} />,
        onClick: () => patchChatState(chat.id, { mutedUntil: 0 }),
      },
      {
        label: chat.archived ? t('unarchive') : t('archive'),
        icon: <IcArchive size={18} />,
        onClick: () => patchChatState(chat.id, { archived: !chat.archived }),
      },
      {
        label: t('deleteChatMe'), danger: true,
        icon: <IcTrash size={18} />,
        onClick: () => { patchChatState(chat.id, { deleteForMe: true }); toast(t('chatDeleted')) },
      },
    ])
  }

  // ── 🍔 হ্যামবার্গার-মেনু — রেফারেন্স qu.ax/dsP2u (Liquid Glass Menu v2)
  //    হুবহু: অ্যাকাউন্ট-হেডার + My Profile / Saved Messages / Contacts /
  //    Settings / More। 🗑️ "Add Account"-ডামি-ফিচার বাদ দেওয়া হয়েছে। ──
  const theme = useUi((s) => s.theme)

  // বার্গার-পপ রিস্টার্ট-ট্রিক (রেফারেন্সের burger-pop)
  const burgerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // 🌈 গ্লাস-চিপেও রিফ্র্যাকশন (Chromium)
  useRefraction(burgerRef, 'chip')
  useRefraction(searchRef, 'chip')
  function popBurger() {
    const el = burgerRef.current
    if (!el) return
    el.classList.remove('lgm-pop'); void el.offsetWidth; el.classList.add('lgm-pop')
  }

  // বার্গারের আসল স্ক্রিন-পজিশন থেকে মেনুর fixed-কোঅর্ড হিসাব —
  // ভিউপোর্ট-ক্ল্যাম্পড (ডান-ধারে 244px জায়গা না থাকলে বামে সরে)
  function openBurgerMenu() {
    popBurger()
    const el = burgerRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      const MENU_W = 224 + 12
      let left = r.left
      if (left + MENU_W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - MENU_W - 8)
      let top = r.bottom + 8
      // খুব নিচে নেমে গেলে উপরের দিকে নামাই
      if (top + 420 > window.innerHeight) top = Math.max(8, window.innerHeight - 430)
      setMenuPos({ left, top })
    }
    setMenuOpen((v) => !v)
    setMoreOpen(false)
  }

  return (
    // গ্লাস + ডান-কোণা কার্ভড — ডেস্কটপে অ্যাপ-শেলের rounded-কনটেইনারে বসে
    <div className="h-full flex flex-col glass-bar md:rounded-r-3xl md:overflow-hidden">
      {/* হেডার — 🍔 গ্লাস-চিপ বার্গার (মরফ-হয়ে X) + গ্লাস-চিপ সার্চ
          (রেফারেন্স ডিজাইনের topbar হুবহু: ৪৬px চিপ, ১২px গ্যাপ) */}
      <div className={`pt-3 px-3 pb-2 flex items-center gap-3 relative ${compact ? 'justify-center' : ''}`}>
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={openBurgerMenu}
          ref={burgerRef}
          className={`lgm-chip lgm-burger ${menuOpen ? 'open' : ''} rounded-[23px] flex items-center justify-center shrink-0 w-[46px] h-[46px]`}
          title={t('menuMyProfile')}
          aria-label="Menu"
          aria-expanded={menuOpen}
        >
          <span /><span /><span />
        </motion.button>

        {/* 💧 লিকুইড-গ্লাস হ্যামবার্গার-মেনু — body-portal + position:fixed
            (সাইডবার যে-সাইজই হোক পুরোটা দেখা যায়; overflow-ক্লিপ আর নয়) */}
        {createPortal(
          <AnimatePresence>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[60]" onClick={() => { setMenuOpen(false); setMoreOpen(false) }} />
                <motion.div
                  // enter CSS-এ (jelly-in) — framer শুধু exit
                  exit={{ opacity: 0, scale: 0.9, y: -6, transition: { duration: 0.15, ease: [0.4, 0, 0.6, 1] } }}
                  className="fixed z-[61]"
                  style={{ left: menuPos.left, top: menuPos.top, transformOrigin: '26px -14px' }}
                >
                  <GlassMenu style={{ width: 224 }} radius={24}>
                    {/* অ্যাকাউন্ট-হেডার — নামে ক্লিকে প্রোফাইল */}
                    <GlassItem account index={0} onClick={() => { setMenuOpen(false); setPanel('settings') }}>
                      <Avatar name={me?.name || me?.username || '?'} id={me?.id || ''} avatarKey={me?.avatarKey} size={30} />
                      <span className="lgm-label font-semibold">{me?.name || me?.username}</span>
                    </GlassItem>

                    <GlassDivider />

                    <GlassItem index={1} icon={<IcUser size={22} />} label={t('menuMyProfile')} onClick={() => { setMenuOpen(false); setPanel('settings') }} />
                    {/* 📌 Saved Messages — আসল self-chat (Telegram-এর মতো):
                        মেনু থেকে সরাসরি খোলে/তৈরি হয়, ফরওয়ার্ডও করা যায় */}
                    <GlassItem index={2} icon={<IcBookmark size={22} />} label={t('menuSaved')} onClick={() => { setMenuOpen(false); useChats.getState().openSaved() }} />
                    <GlassItem index={3} icon={<IcUsers size={22} />} label={t('menuContacts')} onClick={() => { setMenuOpen(false); openModal('contacts') }} />
                    <GlassItem index={4} icon={<IcGear size={22} />} label={t('settings')} onClick={() => { setMenuOpen(false); setPanel('settings') }} />
                    <GlassItem
                      index={5}
                      icon={<IcMore size={22} />}
                      label={t('menuMore')}
                      onClick={() => setMoreOpen((v) => !v)}
                      // 🆕 কার্সর আনলেই সাব-মেনু খুলে যায় (টেলিগ্রামের মতো)
                      // — শুধু সত্যিকারের হোভার-ক্যাপাবল ডিভাইসে (ডেস্কটপ/ল্যাপটপ);
                      // টাচ-ডিভাইসে ট্যাপ-ই একমাত্র উপায় থাকে (মোবাইলে ট্যাপের
                      // সাথে mouseenter-ও ফায়ার হয় — ওখানে স্কিপ না করলে
                      // ট্যাপ-টগল ভেঙে যেত: enter-এ খুলে click-এ আবার বন্ধ!)
                      onMouseEnter={() => { if (hoverCapable()) setMoreOpen(true) }}
                      right={<IcChevR size={18} className={`lgm-chev transition-transform ${moreOpen ? 'rotate-90' : ''}`} />}
                    />
                    {/* More-সাব-মেনু — Night Mode / Archived / Log Out */}
                    <AnimatePresence>
                      {moreOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: [0.2, 0.9, 0.3, 1] }}
                          className="lgm-sub"
                        >
                          <div className="lgm-sub-inner">
                            <GlassItem
                              index={6}
                              icon={theme === 'dark' ? <IcSun size={22} /> : <IcMoon size={22} />}
                              label={t('menuNightMode')}
                              onClick={() => useUi.getState().toggleTheme()}
                              right={
                                <span className={`w-9 h-5 rounded-full p-0.5 transition-colors flex ${theme === 'dark' ? 'bg-brand-600' : 'bg-slate-300'}`}>
                                  <span className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${theme === 'dark' ? 'translate-x-4' : ''}`} />
                                </span>
                              }
                            />
                            <GlassItem index={7} icon={<IcArchive size={22} />} label={t('archivedChats')} onClick={() => { setMenuOpen(false); setPanel('archived') }} />
                            <GlassItem index={8} icon={<IcLogout size={22} />} label={t('logoutRow')} danger onClick={() => { setMenuOpen(false); useAuth.getState().logout() }} />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </GlassMenu>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}

        {!compact && (
          <div className="flex-1 relative">
            <IcSearch size={19} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { useUi.getState().openModal('search', { q }); setQ('') } }}
              placeholder={t('searchPh')}
              className="lgm-chip relative w-full h-[46px] pl-11 pr-4 rounded-[23px] text-[17px] placeholder:text-slate-400 dark:placeholder:text-slate-500 bg-transparent focus:ring-2 focus:ring-brand-500/30 transition outline-none"
            />
            {/* 🔎 ইনলাইন ইউজার-রেজাল্ট — টাইপ করলেই ভেসে ওঠে, ক্লিকেই চ্যাট খোলে (Enter-এর দরকার নেই) */}
            <AnimatePresence>
              {q.trim().length >= 2 && userHits.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.13 }}
                  className="absolute top-full left-0 right-0 mt-1.5 z-40 rounded-2xl bg-white dark:bg-[#232529] shadow-2xl ring-1 ring-black/10 dark:ring-white/10 overflow-hidden py-1.5 max-h-[320px] overflow-y-auto"
                >
                  <div className="px-4 pt-1 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{t('usersLabel')}</div>
                  {userHits.map((u) => (
                    <button key={u.id} onClick={() => openUser(u)}
                      className="w-full flex items-center gap-3 px-3.5 py-2 hover:bg-slate-100 dark:hover:bg-white/[0.07] text-left">
                      <Avatar name={u.name || u.username} id={u.id} avatarKey={u.avatarKey} size={38} />
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {u.name || u.username}
                          {u.name && <span className="ml-1.5 text-[12px] font-normal text-slate-400">@{u.username}</span>}
                        </div>
                        {u.about && <div className="text-[12px] text-slate-400 truncate">{u.about}</div>}
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* মেসেজ রিকোয়েস্ট — কম্প্যাক্টে শুধু ব্যাজ-আইকন */}
      {requests.length > 0 && (
        <button onClick={() => openModal('requests')}
          className={`rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300 text-sm font-medium text-left flex items-center transition hover:bg-brand-500/15 ${compact ? 'mx-auto mb-1 p-2 flex-col gap-0.5' : 'mx-3 mb-1 px-3.5 py-2.5 justify-between'}`}>
          {compact ? (
            <>
              <IcUsers size={20} />
              <span className="bg-brand-600 text-white text-[10px] rounded-full px-1.5 py-0.5">{requests.length}</span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-2"><IcUsers size={16} /> {t('msgRequests')}</span>
              <span className="bg-brand-600 text-white text-xs rounded-full px-2 py-0.5">{requests.length}</span>
            </>
          )}
        </button>
      )}

      {!compact && archivedCount > 0 && (
        <button onClick={() => setPanel('archived')} className="mx-3 mb-1 px-3.5 py-2 rounded-xl text-slate-500 dark:text-slate-400 text-sm text-left flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition">
          <IcArchive size={16} /> {t('archivedChats')} <span className="text-xs opacity-60">{archivedCount}</span>
        </button>
      )}

      {/* লিস্ট */}
      <div className={`flex-1 overflow-y-auto ${compact ? 'px-1.5 pb-3' : 'px-2 pb-3'}`}>
        {sorted.length === 0 && !compact && (
          <div className="text-center text-sm text-slate-400 mt-16 px-6">
            {q ? t('noChatsFound') : t('noChatsYet')}
          </div>
        )}
        {sorted.map((c) => (
          <ChatItem key={c.id} chat={c} active={c.id === activeChatId} compact={compact} onClick={() => openChat(c.id)} onMenu={(e) => itemMenu(e, c)} />
        ))}
      </div>

      {/* নতুন-চ্যাট FAB — টেলিগ্রামের মতো নিচে-ডানে পেন্সিল */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        whileHover={{ scale: 1.06 }}
        onClick={() => openModal('new-chat')}
        className={`absolute bottom-5 right-5 z-20 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white flex items-center justify-center shadow-xl shadow-brand-500/40 ${compact ? 'w-11 h-11' : 'w-14 h-14'}`}
        title={t('newChatBtn')}
      >
        <IcPencil size={compact ? 19 : 22} />
      </motion.button>
    </div>
  )
}

function ChatItem({ chat, active, compact, onClick, onMenu }: {
  chat: Chat; active: boolean; compact: boolean
  onClick: () => void; onMenu: (e: React.MouseEvent) => void
}) {
  const t = useT()
  const me = useAuth.getState().user?.id
  // ⚡ শুধু এই সারির পিয়ারের অনলাইন-স্টেট — অন্য কারো প্রেজেন্স বদলালে
  // এই সারি রি-রেন্ডার হয় না
  const online = useChats((s) => !!(chat.kind === 'dm' && chat.peer && s.presence[chat.peer.id]))
  const typing = (chat.typing || []).length > 0
  const muted = !!chat.mutedUntil && chat.mutedUntil > Date.now()
  const title = chatTitle(chat)
  const last = chat.lastPreview

  // ── কম্প্যাক্ট মোড: শুধু অ্যাভাটার, মাঝ-বরাবর (টেলিগ্রামের সরু-সাইডবার) ──
  if (compact) {
    return (
      <motion.button
        layout
        onClick={onClick}
        onContextMenu={onMenu}
        whileTap={{ scale: 0.94 }}
        title={`${title}${chat.unread ? ` (${chat.unread})` : ''}`}
        className={`relative w-full flex items-center justify-center py-2.5 rounded-2xl transition-colors ${
          active ? 'bg-brand-600/15' : 'hover:bg-slate-100 dark:hover:bg-white/[0.06]'
        }`}
      >
        <ChatAvatar chat={chat} size={52} online={!!online} />
        {chat.unread > 0 && (
          <span className="absolute bottom-1 right-1 bg-brand-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
            {chat.unread > 99 ? '99+' : chat.unread}
          </span>
        )}
        {chat.pinned && !chat.saved && <span className="absolute top-1.5 right-1.5 text-slate-400"><IcPin size={12} /></span>}
      </motion.button>
    )
  }

  return (
    <motion.button
      layout
      onClick={onClick}
      onContextMenu={onMenu}
      whileTap={{ scale: 0.98 }}
      className={`w-full flex items-center gap-3 px-2.5 py-[9px] rounded-xl text-left transition-colors mb-px ${
        active
          ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
          : 'hover:bg-slate-100 dark:hover:bg-white/[0.05]'
      }`}
    >
      <ChatAvatar chat={chat} size={54} online={!active && online} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-[15px] truncate">{title}</span>
          {chat.pinned && <IcPin size={13} className={active ? 'text-white/80' : 'text-slate-400'} />}
          {muted && <IcBellOff size={13} className={active ? 'text-white/70' : 'text-slate-400'} />}
          <span className={`ml-auto text-[11.5px] shrink-0 ${active ? 'text-white/80' : 'text-slate-400'}`}>
            {chat.lastTs ? (Date.now() - chat.lastTs < 864e5 ? fmtTime(chat.lastTs) : fmtDay(chat.lastTs)) : ''}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className={`text-[13.5px] truncate ${typing ? (active ? 'text-white' : 'text-brand-500 font-medium') : active ? 'text-white/85' : 'text-slate-400'}`}>
            {typing
              ? t('typing')
              : <EmojiText text={last || (chat.kind === 'group' ? chat.description?.slice(0, 60) : '')} size={16} />}
          </span>
          {chat.unread > 0 && (
            <span className={`ml-auto shrink-0 text-[11px] font-bold rounded-full min-w-[21px] h-[21px] px-1.5 flex items-center justify-center ${
              muted ? 'bg-slate-300 dark:bg-slate-600 text-white' : active ? 'bg-white text-brand-700' : 'bg-brand-600 text-white'
            }`}>
              {chat.unread > 99 ? '99+' : chat.unread}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}
