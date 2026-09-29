// সব মডাল এক ফাইলে — বেস মডাল + সার্চ, নতুন চ্যাট/গ্রুপ, গ্রুপ ইনফো,
// প্রোফাইল, ফরওয়ার্ড, এডিট, ডিভাইস-অ্যাপ্রুভাল, রিকোয়েস্ট,
// ছবি ভিউয়ার + প্রোফাইল-ছবি ফুলস্ক্রিন ভিউয়ার (হোয়াটসঅ্যাপ-স্টাইল)।
// 🗑️ ওয়ালপেপার-মোডাল বাদ — ফিচার রিমুভ করা হয়েছে।
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUi } from '../../stores/ui'
import { useAuth } from '../../stores/auth'
import { useChats } from '../../stores/chats'
import { api, mediaUrl } from '../../api/client'
import { Avatar, ChatAvatar, Spinner, IconTile } from '../common'
import { debounce } from '../../lib/utils'
import { useT, tHtml } from '../../lib/i18n'
import { IcSearch, IcX, IcUsers, IcDownload, IcTrash, IcCopy, IcCheck, IcBlock, IcUnblock } from '../../lib/icons'

export default function Modals() {
  const modal = useUi((s) => s.modal)
  const viewer = useUi((s) => s.viewer)
  const avatarView = useUi((s) => s.avatarView)
  const closeModal = useUi((s) => s.closeModal)
  const closeViewer = useUi((s) => s.closeViewer)
  const closeAvatarView = useUi((s) => s.closeAvatarView)
  const t = useT()

  return (
    <>
      <AnimatePresence>
        {modal && (
          <ModalShell onClose={closeModal} wide={modal.type === 'search'}>
            {modal.type === 'search' && <SearchModal chatId={modal.props?.chatId} q0={modal.props?.q || ''} />}
            {modal.type === 'new-chat' && <NewChatModal />}
            {modal.type === 'group-info' && <GroupInfo chatId={modal.props.chatId} />}
            {modal.type === 'profile' && <ProfileModal userId={modal.props.userId} />}
            {modal.type === 'forward' && <ForwardModal msg={modal.props.msg} />}
            {modal.type === 'edit' && <EditModal chatId={modal.props.chatId} msg={modal.props.msg} />}
            {modal.type === 'device-approval' && <DeviceApproval {...modal.props} />}
            {modal.type === 'requests' && <RequestsModal />}
            {modal.type === 'contacts' && <ContactsModal />}
            {modal.type === 'seen-by' && <SeenBy chatId={modal.props.chatId} msgId={modal.props.msgId} />}
            {modal.type === 'confirm' && <ConfirmModal {...modal.props} />}
          </ModalShell>
        )}
        {viewer && (
          // ⚠️ bg-black/92 আগে ছিল — Tailwind-এর অপাসিটি মডিফায়ার ৫-এর ধাপে
          // না হলে জেনারেট হয় না; /92 বৈধ নয় → ব্যাকড্রপ স্বচ্ছ হয়ে যেত। /95।
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[85] bg-black/95 flex items-center justify-center" onClick={closeViewer}>
            <motion.img key={viewer.index} initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              src={viewer.urls[viewer.index]} className="max-w-[92vw] max-h-[88vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
            <button className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={(e) => { e.stopPropagation(); closeViewer() }}><IcX size={26} /></button>
            {viewer.name && <div className="absolute top-5 left-6 text-white/80 text-sm font-medium truncate max-w-[50vw]">{viewer.name}</div>}
            {viewer.urls.length > 1 && (
              <div className="absolute bottom-6 flex gap-2">
                {viewer.urls.map((_, i) => (
                  <button key={i} onClick={(e) => { e.stopPropagation(); useUi.getState().openViewer(viewer.urls, i) }}
                    className={`w-2.5 h-2.5 rounded-full ${i === viewer.index ? 'bg-white' : 'bg-white/30'}`} />
                ))}
              </div>
            )}
          </motion.div>
        )}
        {/* প্রোফাইল-ছবি ফুলস্ক্রিন — টেলিগ্রামের মতো: ফুল-রেজ ছবি +
            স্ক্রল/ডাবল-ক্লিক জুম + ড্র্যাগ-প্যান। ছোট থাম্বনেইল-সমস্যা এখানে
            নেই — আসল ৮০০px ভার্সনটাই দেখায়। */}
        {avatarView && (
          <AvatarZoomView
            name={avatarView.name}
            id={avatarView.id}
            avatarKey={avatarView.avatarKey}
            onClose={closeAvatarView}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ── অ্যাভাটার ফুলস্ক্রিন ভিউয়ার (জুম + প্যান সহ) ──
function AvatarZoomView({ name, id, avatarKey, onClose }: { name: string; id: string; avatarKey?: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const size = Math.min(window.innerWidth, window.innerHeight) * 0.72

  const url = avatarKey ? mediaUrl(avatarKey) : ''

  function clampPan(z: number) {
    const maxX = (size * (z - 1)) / 2
    const maxY = (size * (z - 1)) / 2
    setPan((p) => ({ x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) }))
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[85] flex flex-col items-center justify-center gap-5"
      style={{ backgroundColor: 'rgba(0,0,0,0.94)', cursor: zoom > 1 ? 'grab' : 'default' }}
      onClick={() => (zoom > 1 ? (setZoom(1), setPan({ x: 0, y: 0 })) : onClose())}
      onWheel={(e) => {
        e.preventDefault()
        const next = Math.max(1, Math.min(4, zoom * (e.deltaY < 0 ? 1.18 : 0.85)))
        setZoom(next)
        clampPan(next)
      }}>
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        onClick={(e) => { e.stopPropagation(); const nz = zoom > 1.05 ? 1 : 2.4; setZoom(nz); if (nz === 1) setPan({ x: 0, y: 0 }) }}
        onPointerDown={(e) => { if (zoom > 1) { drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId) } }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const maxX = (size * (zoom - 1)) / 2
          const maxY = (size * (zoom - 1)) / 2
          setPan({
            x: Math.max(-maxX, Math.min(maxX, drag.current.px + (e.clientX - drag.current.x))),
            y: Math.max(-maxY, Math.min(maxY, drag.current.py + (e.clientY - drag.current.y))),
          })
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerLeave={() => { drag.current = null }}
        style={{ touchAction: 'none' }}
      >
        {url ? (
          <img
            src={url}
            alt={name}
            draggable={false}
            className="rounded-full object-cover select-none shadow-2xl"
            style={{
              width: size,
              height: size,
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transition: drag.current ? 'none' : 'transform 0.18s ease-out',
            }}
          />
        ) : (
          <Avatar name={name} id={id} size={size} />
        )}
      </motion.div>
      <div className="text-white/90 text-lg font-semibold">{name}</div>
      <button className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={(e) => { e.stopPropagation(); onClose() }}><IcX size={26} /></button>
      {zoom > 1 && (
        <div className="absolute bottom-5 text-white/50 text-xs">scroll = zoom · drag = pan · click = reset</div>
      )}
    </motion.div>
  )
}

export function ModalShell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      // ⚠️ আগে backdrop-blur-[2px] ছিল — ফুলস্ক্রিন backdrop-filter প্রতি ফ্রেমে
      // অ্যানিমেটেড-ওয়ালপেপার ক্যানভাস কম্পোজিট করতে হতো; পেন/সার্চ আইকনে
      // মডাল খুললেই পুরো স্ক্রিন এক ঝলক ("blink") মারত। সাধারণ আধা-কালো
      // ব্যাকড্রপ — ঝলক নেই, মডাল-কার্ডের নিজের গ্লাস-ই যথেষ্ট।
      className="fixed inset-0 z-[80] bg-black/45 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        // 🫧 হালকা গ্লাস-কার্ড — ব্যাকড্রপ-ব্লার + প্রায়-অপারাক সাদা (ডার্কে গাঢ়);
        // লেখা পড়ার ক্ষতি না করে পেছনের ওয়ালপেপার আভা ফুটে ওঠে
        className={`w-full ${wide ? 'max-w-xl' : 'max-w-md'} max-h-[85vh] overflow-hidden rounded-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl shadow-2xl flex flex-col ring-1 ring-black/5 dark:ring-white/10`}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

export function ModalHeader({ title, onClose, icon }: { title: string; onClose?: () => void; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
      {icon}{<h3 className="font-bold text-lg flex-1">{title}</h3>}
      <button onClick={onClose || useUi.getState().closeModal} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 opacity-60"><IcX size={18} /></button>
    </div>
  )
}

// ── সার্চ (গ্লোবাল ইউজার + লোকাল মেসেজ) ──
function SearchModal({ chatId, q0 }: { chatId?: string; q0?: string }) {
  const [q, setQ] = useState(q0)
  const [users, setUsers] = useState<any[]>([])
  const [msgs, setMsgs] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const closeModal = useUi((s) => s.closeModal)
  const chats = useChats((s) => s.chats)
  const t = useT()

  const doSearch = useMemo(() => debounce(async (qq: string) => {
    if (qq.trim().length < 2) { setUsers([]); setMsgs([]); return }
    setBusy(true)
    try {
      const [u, m] = await Promise.all([
        api(`/users/search?q=${encodeURIComponent(qq)}`),
        useChats.getState().localSearch(qq),
      ])
      setUsers(u.results || [])
      setMsgs(chatId ? m.filter((x: any) => x.chatId === chatId) : m)
    } finally { setBusy(false) }
  }, 350), [chatId])

  useEffect(() => { doSearch(q) }, [q])

  return (
    <>
      <div className="px-4 pt-4 pb-2">
        <div className="relative">
          <IcSearch size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPh2')}
            className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-[15px] focus:ring-2 focus:ring-brand-500/30 outline-none" />
        </div>
      </div>
      <div className="overflow-y-auto px-2 pb-3">
        {busy && <div className="p-6 flex justify-center"><Spinner /></div>}
        {!busy && users.length > 0 && (
          <>
            <div className="px-3 pt-2 pb-1 text-xs font-semibold text-slate-400 uppercase">{t('usersLabel')}</div>
            {users.map((u) => (
              <button key={u.id} onClick={async () => { closeModal(); const res = await useChats.getState().createDm(u.id); if (res.chatId) useChats.getState().openChat(res.chatId); else if (res.request) useUi.getState().toast(t('reqSentShort')) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left">
                <Avatar name={u.username} id={u.id} avatarKey={u.avatarKey} size={44} />
                <div className="min-w-0">
                  <div className="font-semibold">{u.username}</div>
                  {u.about && <div className="text-xs text-slate-400 truncate">{u.about}</div>}
                </div>
              </button>
            ))}
          </>
        )}
        {!busy && msgs.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1 text-xs font-semibold text-slate-400 uppercase">{t('messagesLabel')}</div>
            {msgs.slice(0, 40).map((m) => {
              const c = chats[m.chatId]
              return (
                <button key={m.id} onClick={() => { closeModal(); useChats.getState().openChat(m.chatId) }}
                  className="w-full px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left">
                  <div className="text-xs font-semibold text-brand-500">{c?.title || c?.peer?.username || 'Chat'}</div>
                  <div className="text-sm truncate mt-0.5">{m.body}</div>
                </button>
              )
            })}
          </>
        )}
        {!busy && q.length >= 2 && !users.length && !msgs.length && (
          <div className="text-center text-sm text-slate-400 py-8">{t('nothingFound')}</div>
        )}
      </div>
    </>
  )
}

// ── কন্টাক্টস — 🍔 মেনুর "Contacts" থেকে খোলে; ডিএম-চ্যাটগুলো + সার্চ ──
function ContactsModal() {
  const chats = useChats((s) => s.chats)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<any[]>([])
  const closeModal = useUi((s) => s.closeModal)
  const t = useT()
  const contacts = useMemo(() => {
    const seen = new Set<string>()
    return Object.values(chats)
      .filter((c) => c.kind === 'dm' && c.peer && !c.peer.deleted)
      .filter((c) => { if (seen.has(c.peer!.id)) return false; seen.add(c.peer!.id); return true })
      .map((c) => c.peer!)
      .filter((p) => !q.trim() || p.username.toLowerCase().includes(q.trim().toLowerCase()))
  }, [chats, q])

  const doSearch = useMemo(() => debounce(async (qq: string) => {
    if (qq.trim().length < 2) return setHits([])
    try { const r = await api(`/users/search?q=${encodeURIComponent(qq)}`); setHits(r.results || []) } catch {}
  }, 300), [])
  useEffect(() => { doSearch(q) }, [q])

  async function open(u: any) {
    closeModal()
    const res = await useChats.getState().createDm(u.id)
    if (res.chatId) useChats.getState().openChat(res.chatId)
    else if (res.request) useUi.getState().toast(t('reqSentShort'))
  }

  return (
    <>
      <ModalHeader title={t('contactsT')} />
      <div className="px-4 pb-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchUserPh')}
          className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
      </div>
      <div className="overflow-y-auto px-2 pb-3 min-h-[220px]">
        {contacts.length === 0 && hits.length === 0 && (
          <div className="text-center text-sm text-slate-400 py-8">{t('noContacts')}</div>
        )}
        {contacts.map((p) => (
          <button key={p.id} onClick={() => open(p)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left">
            <Avatar name={p.username} id={p.id} avatarKey={p.avatarKey} size={42} />
            <div className="min-w-0">
              <div className="font-semibold text-sm">{p.username}</div>
              {p.about && <div className="text-xs text-slate-400 truncate max-w-[240px]">{p.about}</div>}
            </div>
          </button>
        ))}
        {hits.filter((u) => !contacts.some((p) => p.id === u.id)).map((u) => (
          <button key={u.id} onClick={() => open(u)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left">
            <Avatar name={u.username} id={u.id} avatarKey={u.avatarKey} size={42} />
            <div className="min-w-0">
              <div className="font-semibold text-sm">{u.username}</div>
              {u.about && <div className="text-xs text-slate-400 truncate max-w-[240px]">{u.about}</div>}
            </div>
          </button>
        ))}
      </div>
    </>
  )
}

// ── নতুন চ্যাট / গ্রুপ ──
// 🆕 কন্টাক্ট-লোড ফিক্স: আগে গ্রুপে মেম্বার যোগ করতে গেলে **সার্চ করা ছাড়া
// কিছুই দেখাত না** — এখন খোলামাত্রই বিদ্যমান কন্টাক্টগুলো (আগের DM-পিয়ার)
// লিস্টে ভেসে ওঠে; সার্চ করলে লোকাল-কন্টাক্ট ফিল্টার + গ্লোবাল ইউজার-হিট
// দুটোই পাওয়া যায়। DM-ট্যাবেও একই অভ্যাস (Telegram-এর মতো)।
function NewChatModal() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [tab, setTab] = useState<'dm' | 'group'>('dm')
  const [members, setMembers] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [limit, setLimit] = useState(200)
  const [joinCode, setJoinCode] = useState('')
  // 🐛 গ্রুপ-ডুপ্লিকেট ফিক্স: বাটন ডাবল-ক্লিক/বারবার-ট্যাপে একই নামে একাধিক
  // গ্রুপ তৈরি হতো — তৈরি-চলাকালীন বাটন বন্ধ + সার্ভারও same-name dedupe করে
  const [creating, setCreating] = useState(false)
  const closeModal = useUi((s) => s.closeModal)
  const toast = useUi((s) => s.toast)
  const t = useT()
  const me = useAuth((s) => s.user)
  const chats = useChats((s) => s.chats)

  // বিদ্যমান কন্টাক্ট — আগের DM-চ্যাটের পিয়াররা (ডুপ্লিকেট-মুক্ত, সার্চ-ফিল্টারড)
  const contacts = useMemo(() => {
    const seen = new Set<string>()
    const needle = q.trim().toLowerCase()
    return Object.values(chats)
      .filter((c) => c.kind === 'dm' && c.peer && !c.peer.deleted && !c.saved)
      .filter((c) => { if (seen.has(c.peer!.id)) return false; seen.add(c.peer!.id); return true })
      .map((c) => c.peer!)
      .filter((p) => p.id !== me?.id && (!needle || p.username.toLowerCase().includes(needle)))
  }, [chats, q, me?.id])

  const doSearch = useMemo(() => debounce(async (qq: string) => {
    if (qq.trim().length < 2) return setResults([])
    const r = await api(`/users/search?q=${encodeURIComponent(qq)}`)
    setResults((r.results || []).filter((u: any) => u.id !== me?.id))
  }, 350), [me?.id])
  useEffect(() => { doSearch(q) }, [q])

  // গ্লোবাল হিটের মধ্যে যারা আগেই কন্টাক্ট — সেগুলো নিচের সেকশনে না দেখিয়ে
  // উপরের কন্টাক্ট-লিস্টেই রাখি (ডুপ্লিকেট রো এড়াতে)
  const globalHits = results.filter((u) => !contacts.some((p) => p.id === u.id))

  async function openDm(u: any) {
    const res = await useChats.getState().createDm(u.id)
    closeModal()
    if (res.request) toast(t('reqSent'))
    else if (res.chatId) useChats.getState().openChat(res.chatId)
  }

  const UserRow = ({ u, selected, onClick }: { u: any; selected?: boolean; onClick: () => void }) => (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-2 py-2 rounded-2xl transition ${selected ? 'bg-brand-500/15' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
      <Avatar name={u.username} id={u.id} avatarKey={u.avatarKey} size={40} />
      <div className="text-left flex-1 min-w-0">
        <div className="font-semibold text-sm">{u.username}</div>
        <div className="text-xs text-slate-400 truncate max-w-[220px]">{u.about}</div>
      </div>
      {selected !== undefined && selected && <span className="text-brand-500 shrink-0"><IcCheck size={18} /></span>}
    </button>
  )

  return (
    <>
      <ModalHeader title={t('newChatT')} />
      <div className="px-5 pt-3 flex gap-2">
        <button onClick={() => setTab('dm')} className={`px-4 py-1.5 rounded-full text-sm font-semibold ${tab === 'dm' ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{t('dmChat')}</button>
        <button onClick={() => setTab('group')} className={`px-4 py-1.5 rounded-full text-sm font-semibold ${tab === 'group' ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{t('newGroup')}</button>
      </div>

      <div className="p-4 space-y-3 overflow-y-auto">
        {tab === 'dm' && (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchUserPh')}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
            {contacts.length > 0 && (
              <div>
                <div className="px-2 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{t('contactsT')}</div>
                {contacts.map((u) => <UserRow key={u.id} u={u} onClick={() => openDm(u)} />)}
              </div>
            )}
            {globalHits.length > 0 && (
              <div>
                <div className="px-2 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{t('usersLabel')}</div>
                {globalHits.map((u) => <UserRow key={u.id} u={u} onClick={() => openDm(u)} />)}
              </div>
            )}
            {q.trim().length >= 2 && contacts.length === 0 && globalHits.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-6">{t('nothingFound')}</div>
            )}
          </>
        )}
        {tab === 'group' && (
          <>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('groupNamePh')}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('descOptional')}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">{t('memberLimit')}</span>
              <input type="number" min={2} max={1000} value={limit} onChange={(e) => setLimit(parseInt(e.target.value) || 200)}
                className="w-24 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 outline-none" />
            </div>
            {/* মেম্বার-সিলেকশন — খোলামাত্রই কন্টাক্ট লোড হয়; সার্চে গ্লোবাল ইউজারও */}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('addMembersPh')}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
            {contacts.length > 0 && (
              <div>
                <div className="px-2 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{t('contactsT')}</div>
                {contacts.map((u) => (
                  <UserRow key={u.id} u={u} selected={members.includes(u.id)}
                    onClick={() => setMembers((m) => m.includes(u.id) ? m.filter((x) => x !== u.id) : [...m, u.id])} />
                ))}
              </div>
            )}
            {globalHits.length > 0 && (
              <div>
                <div className="px-2 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{t('usersLabel')}</div>
                {globalHits.map((u) => (
                  <UserRow key={u.id} u={u} selected={members.includes(u.id)}
                    onClick={() => setMembers((m) => m.includes(u.id) ? m.filter((x) => x !== u.id) : [...m, u.id])} />
                ))}
              </div>
            )}
            {q.trim().length >= 2 && contacts.length === 0 && globalHits.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-4">{t('nothingFound')}</div>
            )}
            <button
              disabled={!title.trim() || creating}
              onClick={async () => {
                if (creating) return
                setCreating(true)
                try {
                  const r = await useChats.getState().createGroup(title, desc, members, limit)
                  closeModal()
                  if ((r as any)?.existing) toast(t('groupExistsToast'))
                  useChats.getState().openChat((r as any).chatId || r)
                } finally { setCreating(false) }
              }}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-violet-600 text-white font-semibold disabled:opacity-40">
              {creating ? '…' : `${t('createGroup')} ${members.length > 0 ? t('nMembersSuffix', { n: members.length }) : ''}`}
            </button>
          </>
        )}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">{t('orInvite')}</div>
          <div className="flex gap-2">
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder={t('linkCodePh')}
              className="flex-1 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none" />
            <button onClick={async () => {
              try { const id = await useChats.getState().joinInvite(joinCode.trim().split('/').pop() || ''); closeModal(); useChats.getState().openChat(id) }
              catch (e: any) { toast(e.message || t('joinInvalid')) }
            }} className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">{t('joinBtn')}</button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── গ্রুপ ইনফো ──
function GroupInfo({ chatId }: { chatId: string }) {
  const chat = useChats((s) => s.chats[chatId])
  const me = useAuth.getState().user!
  const [invites, setInvites] = useState<any[]>([])
  const closeModal = useUi((s) => s.closeModal)
  const toast = useUi((s) => s.toast)
  const t = useT()
  if (!chat) return null
  const myRole = chat.members.find((m) => m.id === me.id)?.role || 'member'
  const isAdmin = myRole === 'owner' || myRole === 'admin'

  async function loadInvites() {
    if (!isAdmin) return
    try { const r = await api(`/chats/${chatId}/invites`); setInvites(r.invites || []) } catch {}
  }
  // ⚠️ বাগ-ফিক্স: ইনভাইট-স্টেটাস স্টেল হয়ে থাকত — এখন খোলা থাকলে মাঝে মাঝে রিফ্রেশ
  useEffect(() => {
    loadInvites()
    const iv = setInterval(loadInvites, 12_000)
    return () => clearInterval(iv)
  }, [])

  return (
    <>
      <ModalHeader title={t('groupInfoT')} />
      <div className="p-5 overflow-y-auto space-y-4">
        <div className="flex items-center gap-4">
          <Avatar name={chat.title || '?'} id={chatId} avatarKey={chat.photoKey} size={64}
            onClick={() => useUi.getState().openAvatarView(chat.title || 'Group', chatId, chat.photoKey)} />
          <div>
            <div className="text-lg font-bold">{chat.title}</div>
            <div className="text-sm text-slate-400">{t('membersCount', { n: chat.members.length })}</div>
          </div>
        </div>
        {chat.description && <p className="text-sm bg-slate-50 dark:bg-slate-800 rounded-xl p-3">{chat.description}</p>}

        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase mb-2">{t('membersLabel')}</div>
          {chat.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-1.5">
              <Avatar name={m.username} id={m.id} avatarKey={m.avatarKey} size={36} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{m.username}</span>
                {m.role !== 'member' && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-600 dark:text-brand-300">{m.role === 'owner' ? t('owner') : t('admin')}</span>}
              </div>
              {isAdmin && m.id !== me.id && (
                <div className="flex gap-1">
                  {myRole === 'owner' && (
                    <button onClick={async () => { await api(`/chats/${chatId}/admin`, { body: { userId: m.id, admin: m.role === 'member' } }); useChats.getState().loadChats() }}
                      className="text-xs px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800">{m.role === 'member' ? t('makeAdmin') : t('removeAdmin')}</button>
                  )}
                  {(myRole === 'owner' || m.role === 'member') && (
                    <button onClick={async () => { await api(`/chats/${chatId}/members/${m.id}`, { method: 'DELETE' }); useChats.getState().loadChats() }}
                      className="text-xs px-2 py-1 rounded-lg bg-rose-500/10 text-rose-500">{t('removeBtn')}</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {isAdmin && (
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase mb-2">{t('inviteLinksLabel')}</div>
            <button onClick={async () => {
              const r = await api(`/chats/${chatId}/invites`, { body: {} })
              const link = `${location.origin}/#/join/${r.code}`
              await navigator.clipboard.writeText(link).catch(() => {})
              toast(t('inviteCopied', { link }))
              loadInvites()
            }} className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">{t('newInvite')}</button>
            {invites.map((inv) => (
              <div key={inv.code} className="flex items-center gap-2 mt-2 text-sm">
                <code className="flex-1 truncate bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-1.5">{location.origin}/#/join/{inv.code}</code>
                <button onClick={() => navigator.clipboard.writeText(`${location.origin}/#/join/${inv.code}`)} className="p-1.5 opacity-60 hover:opacity-100"><IcCopy size={15} /></button>
                <button onClick={async () => { await api(`/invites/${inv.code}`, { method: 'DELETE' }); loadInvites() }} className="p-1.5 text-rose-500"><IcTrash size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ── ইউজার প্রোফাইল ──
function ProfileModal({ userId }: { userId: string }) {
  const [u, setU] = useState<any>(null)
  const blockedIds = useChats((s) => s.blockedIds)
  const toast = useUi((s) => s.toast)
  const t = useT()
  const blocked = !!blockedIds[userId]
  useEffect(() => { api(`/users/${userId}`).then((r) => setU(r.user)).catch(() => {}) }, [userId])
  if (!u) return <div className="p-8 flex justify-center"><Spinner /></div>
  return (
    <>
      <ModalHeader title={t('profileT')} />
      <div className="p-6 flex flex-col items-center gap-3">
        <Avatar name={u.username} id={u.id} avatarKey={u.avatarKey} size={90}
          onClick={() => useUi.getState().openAvatarView(u.username, u.id, u.avatarKey)} />
        <div className="text-xl font-bold">@{u.username}</div>
        {u.about && <div className="text-sm text-slate-400 text-center max-w-xs">{u.about}</div>}
        {u.deleted && <div className="text-sm text-rose-500">{t('userDeleted')}</div>}
        <div className="flex gap-2 mt-3">
          <button onClick={async () => { const res = await useChats.getState().createDm(u.id); useUi.getState().closeModal(); if (res.chatId) useChats.getState().openChat(res.chatId); else toast(t('reqSentShort')) }}
            className="px-5 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">{t('sendMsgBtn')}</button>
          <button onClick={async () => {
            if (blocked) {
              await useChats.getState().unblock(u.id)
              toast(t('unblockedToast'))
            } else {
              await api(`/me/blocked/${u.id}`, { method: 'PUT' }).catch(() => {})
              useChats.getState().loadBlocked().catch(() => {})
              toast(t('blockedToast'))
            }
          }} className={`px-5 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 ${blocked ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/10 text-rose-500'}`}>
            {blocked ? <><IcUnblock size={15} /> {t('unblock')}</> : <><IcBlock size={15} /> {t('blockBtn')}</>}
          </button>
        </div>
      </div>
    </>
  )
}

// ── ফরওয়ার্ড ──
function ForwardModal({ msg }: { msg: any }) {
  const chats = useChats((s) => s.chats)
  const closeModal = useUi((s) => s.closeModal)
  const toast = useUi((s) => s.toast)
  const t = useT()
  return (
    <>
      <ModalHeader title={t('forwardT')} />
      <div className="p-2 overflow-y-auto max-h-[55vh]">
        {Object.values(chats).map((c) => (
          <button key={c.id} onClick={async () => {
            await useChats.getState().sendDraft(c.id, { type: msg.type, body: msg.body, media: msg.media, fwdFrom: msg.senderId })
            closeModal(); toast(t('forwardedToast'))
          }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800">
            <ChatAvatar chat={c} size={40} />
            <span className="font-medium text-sm">{c.title || c.peer?.username}</span>
          </button>
        ))}
      </div>
    </>
  )
}

// ── এডিট ──
function EditModal({ chatId, msg }: { chatId: string; msg: any }) {
  const [text, setText] = useState(msg.body || '')
  const closeModal = useUi((s) => s.closeModal)
  const t = useT()
  return (
    <>
      <ModalHeader title={t('editMsgT')} />
      <div className="p-4">
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4}
          className="w-full p-3 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30 resize-none" />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={closeModal} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm">{t('cancel')}</button>
          <button onClick={async () => { await useChats.getState().editMessage(chatId, msg.id, text); closeModal() }}
            className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">{t('saveBtn')}</button>
        </div>
      </div>
    </>
  )
}

// ── নতুন ডিভাইস লগইন নোটিফিকেশন (Telegram-স্টাইল) ──
function DeviceApproval({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const closeModal = useUi((s) => s.closeModal)
  const decide = useAuth((s) => s.decideDevice)
  const toast = useUi((s) => s.toast)
  const t = useT()
  return (
    <>
      <ModalHeader title={t('deviceApprovalT')} />
      <div className="p-5">
        <p className="text-sm" dangerouslySetInnerHTML={{ __html: tHtml('deviceApprovalBody', { name: deviceName }) }} />
        <p className="text-sm text-slate-400 mt-2">
          {t('deviceApprovalHint')}
        </p>
        <div className="flex gap-2 mt-5">
          <button onClick={async () => { try { await decide(deviceId, true) } catch {} closeModal() }}
            className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white font-semibold">{t('itWasMe')}</button>
          <button onClick={async () => {
            try {
              await decide(deviceId, false)
              toast(t('deviceLoggedOut'))
            } catch { toast(t('failedRetry')) }
            closeModal()
          }}
            className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-semibold">{t('declineLogout')}</button>
        </div>
      </div>
    </>
  )
}

// ── মেসেজ রিকোয়েস্ট লিস্ট ──
function RequestsModal() {
  const requests = useChats((s) => s.requests)
  const respondRequest = useChats((s) => s.respondRequest)
  const t = useT()
  return (
    <>
      <ModalHeader title={t('requestsT')} />
      <div className="p-3 overflow-y-auto">
        {requests.length === 0 && <div className="text-center text-sm text-slate-400 py-8">{t('noRequests')}</div>}
        {requests.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-2 py-2.5">
            <Avatar name={r.username} id={r.from_user} avatarKey={r.avatar_key} size={44} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{r.username}</div>
              {r.about && <div className="text-xs text-slate-400 truncate">{r.about}</div>}
            </div>
            <button onClick={() => respondRequest(r.id, true)} className="px-3.5 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-bold">Accept</button>
            <button onClick={() => respondRequest(r.id, false)} className="px-3.5 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold">Decline</button>
          </div>
        ))}
      </div>
    </>
  )
}

// ── গ্রুপে কে দেখেছে ──
function SeenBy({ chatId, msgId }: { chatId: string; msgId: string }) {
  const chat = useChats((s) => s.chats[chatId])
  const seenBy = useChats((s) => (s as any).seenBy?.[msgId] || [])
  const t = useT()
  if (!chat) return null
  const viewers = chat.members.filter((m) => seenBy.includes(m.id) || m.id === useAuth.getState().user?.id)
  return (
    <>
      <ModalHeader title={t('seenByT')} />
      <div className="p-4 max-h-[50vh] overflow-y-auto">
        {viewers.map((m) => (
          <div key={m.id} className="flex items-center gap-3 py-1.5">
            <Avatar name={m.username} id={m.id} avatarKey={m.avatarKey} size={36} />
            <span className="text-sm font-medium">{m.username}</span>
          </div>
        ))}
        {viewers.length <= 1 && <div className="text-sm text-slate-400 text-center py-4">{t('nobodySeen')}</div>}
      </div>
    </>
  )
}

export function ConfirmModal({ title, body, confirmText, onConfirm }: any) {
  const closeModal = useUi((s) => s.closeModal)
  const t = useT()
  return (
    <>
      <ModalHeader title={title || t('confirmT')} />
      <div className="p-5">
        <p className="text-sm text-slate-500 dark:text-slate-300">{body}</p>
        <div className="flex gap-2 mt-5">
          <button onClick={closeModal} className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-semibold">{t('cancel')}</button>
          <button onClick={async () => { await onConfirm?.(); closeModal() }} className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-semibold">{confirmText || t('yesBtn')}</button>
        </div>
      </div>
    </>
  )
}
