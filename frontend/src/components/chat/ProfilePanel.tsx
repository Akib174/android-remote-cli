// ডানপাশের প্রোফাইল-প্যানেল (টেলিগ্রাম-স্টাইল) — চ্যাট-হেডারে ক্লিক করলে খোলে।
// DM: বড় অ্যাভাটার, ইউজারনেম, ফোন/ইমেইল, অ্যাবাউট, লাস্ট-সিন, ব্লক/আনব্লক, ডিলিট-চ্যাট।
// গ্রুপ: গ্রুপ-ফটো, টাইটেল, ডেসক্রিপশন, মেম্বার-লিস্ট (অ্যাডমিন-অপসহ),
//        ওয়ান-টাইম ইনভাইট-লিংক ম্যানেজমেন্ট।
//
// 🆕 এই ভার্সনে:
//  • প্যানেলটা কার্ভড (rounded-l-3xl) + গ্লাস — কম্পোজারের মতো ফ্লোটিং লুক
//  • গ্রুপ-অ্যাডমিনরা এখান থেকেই ওয়ান-টাইম ইনভাইট লিংক বানাতে/কপি/ডিলিট করতে পারে
//  • প্রতি-চ্যাট লাইক-বাটন ইমোজি এখান থেকেই বদলানো যায় (Messenger-স্টাইল)
import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChats } from '../../stores/chats'
import { useAuth } from '../../stores/auth'
import { useUi } from '../../stores/ui'
import { api } from '../../api/client'
import { Avatar, SavedAvatar } from '../common'
import { fmtLastSeen, useMediaQuery } from '../../lib/utils'
import { chatTitle } from '../../lib/notify'
import { useT } from '../../lib/i18n'
import { Emoji } from '../../lib/emoji'
import { IcX, IcBlock, IcUnblock, IcTrash, IcBell, IcBellOff, IcUsers, IcSearch, IcTimer, IcExport, IcCopy, IcPlus, IcLink, IcChevD } from '../../lib/icons'

// লাইক-বাটনের পিক-তালিকা (প্রোফাইল-প্যানেলের প্রতি-চ্যাট ওভাররাইড)
const LIKE_CHOICES = ['👍', '❤️', '😂', '😮', '😢', '😍', '🔥', '🎉', '🥰', '👏', '💯', '🤩', '😎', '🤔', '😅', '🙌', '🙏', '💀', '👀', '🤝', '💪', '✨', '🌈', '⭐', '🥳', '😴', '🤗', '😼']

export default function ProfilePanel() {
  const rightPanel = useUi((s) => s.rightPanel)
  const activeChatId = useChats((s) => s.activeChatId)
  // সক্রিয় চ্যাট বদলালে প্যানেলও বদলায়; বন্ধ চ্যাটে ভাসমান প্যানেল বন্ধ
  const chatId = rightPanel?.chatId || activeChatId
  const chat = useChats((s) => (chatId ? s.chats[chatId] : undefined))

  return (
    <AnimatePresence>
      {rightPanel && chat && (
        <ProfilePanelInner chatId={chat.id} />
      )}
    </AnimatePresence>
  )
}

function ProfilePanelInner({ chatId }: { chatId: string }) {
  // 🐛 হোয়াইট-স্ক্রিন ফিক্স (গার্ড নিচে): চ্যাট ডিলিট হলে স্টোর থেকে চ্যাট চলে
  // যায়, কিন্তু AnimatePresence-এর exit-অ্যানিমেশনে প্যানেল মাউন্টেড থাকে —
  // আগে undefined-চ্যাটের .kind পড়ে পুরো অ্যাপ ক্র্যাশ (সাদা স্ক্রিন) করত।
  const chat = useChats((s) => s.chats[chatId])
  const messages = useChats((s) => s.messages[chatId] || [])
  const me = useAuth((s) => s.user)
  const authUser = useAuth((s) => s.user)
  const settings = useAuth((s) => s.settings)
  const closeRightPanel = useUi((s) => s.closeRightPanel)
  const openModal = useUi((s) => s.openModal)
  const toast = useUi((s) => s.toast)
  const t = useT()
  // 🖥️ ডেস্কটপ-কিনা — প্যানেলের অ্যানিমেশন-ধরন (width-reveal বনাম স্লাইড) এর উপর নির্ভর
  const desktop = useMediaQuery('(min-width: 768px)')
  const [about, setAbout] = useState('')
  const [likePicker, setLikePicker] = useState(false)
  // ইনভাইট-লিংক (গ্রুপ-অ্যাডমিন)
  const [invites, setInvites] = useState<any[]>([])

  const isGroup = chat?.kind === 'group'
  const peer = chat?.peer
  // ⚡ পিয়ারের নিজস্ব অনলাইন-বুলিয়ান — presence-ম্যাপের চার্নে প্যানেল রি-রেন্ডার হয় না
  const online = useChats((s) => !!(peer && s.presence[peer.id]))
  const myRole = chat?.members.find((m) => m.id === me?.id)?.role
  const isAdmin = myRole === 'owner' || myRole === 'admin'

  const likeEmoji = chat?.likeEmoji || settings?.likeEmoji || '👍'

  async function loadInvites() {
    if (!isGroup || !isAdmin) return
    try { const r = await api(`/chats/${chatId}/invites`); setInvites(r.invites || []) } catch {}
  }
  // ⚠️ বাগ-ফিক্স: ইনভাইট-লিস্ট একবার লোড হয়ে বসে থাকত — লিংক ব্যবহার হয়ে
  // "Used" হয়ে গেলেও প্যানেলে পুরনো স্টেটাস দেখাত। প্যানেল খোলা থাকতে
  // মাঝে মাঝে রিফ্রেশ হয় এখন।
  useEffect(() => {
    loadInvites()
    const iv = setInterval(loadInvites, 12_000)
    return () => clearInterval(iv)
  }, [chatId])

  // DM-এ পিয়ারের ফ্রেশ প্রোফাইল (অ্যাবা�উট ইত্যাদি)
  useEffect(() => {
    if (!peer) return
    setAbout(peer.about || '')
    api(`/users/${peer.id}`).then((r: any) => {
      if (r?.user?.about !== undefined) setAbout(r.user.about || '')
    }).catch(() => {})
  }, [peer?.id])

  // 🛑 সব হুকের পরে গার্ড (rules-of-hooks মেনে) — চ্যাট স্টোরে আর নেই এমন
  // মুহূর্তে (ডিলিট + exit-অ্যানিমেশন চলাকালে) প্যানেল কিছুই রেন্ডার করে না।
  if (!chat) return null
  const title = chatTitle(chat)

  async function createInvite() {
    try {
      const r = await api(`/chats/${chatId}/invites`, { body: {} })
      const link = `${location.origin}/#/join/${r.code}`
      await navigator.clipboard.writeText(link).catch(() => {})
      toast(t('inviteCopied', { link: '📋' }))
      loadInvites()
    } catch (e: any) {
      toast(e.message || t('failedRetry'))
    }
  }

  function Row({ icon, label, sub, onClick, danger }: { icon: React.ReactNode; label: string; sub?: string; onClick?: () => void; danger?: boolean }) {
    return (
      <button onClick={onClick} className={`w-full flex items-center gap-4 px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition text-left ${danger ? 'text-rose-500' : ''}`}>
        <span className={danger ? 'text-rose-500' : 'text-slate-400 dark:text-slate-400'}>{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14.5px] font-medium truncate">{label}</span>
          {sub && <span className="block text-xs text-slate-400 mt-0.5 truncate">{sub}</span>}
        </span>
      </button>
    )
  }

  return (
    <>
      {/* মোবাইলে ব্যাকড্রপ */}
      <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={closeRightPanel} />
      {/* 🆕 স্মুথ-ওপেন: ডেস্কটপে Telegram-ওয়েবের মতো width-reveal (০→৩৫০px,
          চ্যাট-এরিয়া স্প্রিং-এ সরে জায়গা করে), মোবাইলে আগের মতো ফুল-স্ক্রিন
          ডান-স্লাইড। ভেতরের কন্টেন্ট ফিক্সড-প্রস্থ — রিভিলের সময় মিঞ্গিয়ে যায় না। */}
      <motion.aside
        initial={desktop ? { width: 0, opacity: 0.6 } : { x: '104%', opacity: 0.5 }}
        animate={desktop ? { width: 350, opacity: 1 } : { x: 0, opacity: 1 }}
        exit={desktop ? { width: 0, opacity: 0 } : { x: '104%', opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 33 }}
        className="fixed md:static inset-y-0 right-0 z-50 md:z-auto w-full md:w-auto overflow-hidden glass-bar border-l-0 flex flex-col shadow-2xl md:shadow-lg"
      >
      <div className="h-full w-full md:w-[350px] md:min-w-[350px] md:h-[calc(100%-1rem)] md:my-2 md:mr-2 md:rounded-l-3xl md:border md:border-slate-200/60 dark:md:border-white/[0.07] flex flex-col">
        {/* হেডার */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-100 dark:border-white/[0.06] shrink-0">
          <button onClick={closeRightPanel} className="p-2 -ml-2 rounded-full hover:bg-slate-100 dark:hover:bg-white/10"><IcX size={20} /></button>
          <h3 className="font-semibold text-[16px]">{isGroup ? t('groupInfo') : t('viewProfile')}</h3>
        </div>

        <div className="flex-1 overflow-y-auto pb-6">
          {/* বড় অ্যাভাটার + নাম */}
          <div className="pt-6 pb-4 px-4 flex flex-col items-center text-center gap-3">
            {chat.saved ? (
              <SavedAvatar size={110} />
            ) : (
              <Avatar
                name={title}
                id={chatId}
                avatarKey={isGroup ? chat.photoKey : peer?.avatarKey}
                size={110}
                full
                online={!isGroup && online}
                onClick={() => useUi.getState().openAvatarView(title, isGroup ? chatId : peer?.id || chatId, isGroup ? chat.photoKey : peer?.avatarKey)}
              />
            )}
            <div>
              <div className="text-[19px] font-bold leading-tight">{title}</div>
              <div className="text-[13px] text-slate-400 mt-0.5">
                {chat.saved
                  ? t('savedSub')
                  : isGroup
                  ? t('membersCount', { n: chat.members.length })
                  : online ? t('online')
                  : peer?.lastSeenPriv === 'nobody' ? t('lastSeenHidden')
                  : t('lastSeenAt', { when: fmtLastSeen(peer?.lastSeenAt) })}
              </div>
            </div>
            {!isGroup && peer && <>
              {peer.name && <div className="text-[15px] font-semibold text-slate-700 dark:text-slate-200">{peer.name}</div>}
              <div className="text-[13px] text-brand-500 font-medium">@{peer.username}</div>
            </>}
            {/* ফোন / ইমেইল (DM-পিয়ার) — সার্চযোগ্য তথ্য */}
            {!isGroup && peer && (peer as any).phone && (
              <div className="text-[12.5px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">📞 {(peer as any).phone}</div>
            )}
            {!isGroup && peer && (peer as any).email && (
              <div className="text-[12.5px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">✉️ {(peer as any).email}</div>
            )}
          </div>

          <div className="h-px bg-slate-100 dark:bg-white/[0.06] mx-4" />

          {/* অ্যাবাউট / ডেসক্রিপশন */}
          {(about || chat.description) && (
            <div className="px-4 pt-3.5 pb-1">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{isGroup ? t('groupInfoT') : t('aboutBio')}</div>
              <p className="text-[14px] mt-1 leading-relaxed break-words">{isGroup ? chat.description : about}</p>
            </div>
          )}

          {/* ইনফো-রো */}
          <div className="mt-1.5">
            <Row icon={<IcSearch size={19} />} label={t('searchInChat')} onClick={() => { closeRightPanel(); openModal('search', { chatId }) }} />
            {!chat.saved && (
              <Row icon={<IcUsers size={19} />} label={t('membersCount', { n: chat.members.length })} sub={isGroup ? `${messages.length} ${t('messagesLabel') || ''}`.trim() : undefined} />
            )}
            <Row
              icon={chat.mutedUntil && chat.mutedUntil > Date.now() ? <IcBellOff size={19} /> : <IcBell size={19} />}
              label={chat.mutedUntil && chat.mutedUntil > Date.now() ? t('unmute') : t('mute8h')}
              onClick={() => useChats.getState().patchChatState(chatId, { mutedUntil: chat.mutedUntil && chat.mutedUntil > Date.now() ? 0 : Date.now() + 8 * 3600_000 })}
            />
            <Row icon={<IcTimer size={19} />} label={chat.ttl ? t('disappOff') : t('disapp24')}
              onClick={() => useChats.getState().patchChatState(chatId, { ttl: chat.ttl ? 0 : 86400 })} />
            <Row icon={<IcExport size={19} />} label={t('exportChat')} onClick={() => useChats.getState().exportChat(chatId)} />
          </div>

          {/* ── 🧡 এই চ্যাটের লাইক-বাটন (Messenger-স্টাইল প্রতি-চ্যাট ওভাররাইড) ── */}
          <div className="relative">
            <Row icon={<Emoji char={likeEmoji} size={19} />} label={t('likeBtnSetting')} sub={t('likeBtnSettingSub')}
              onClick={() => setLikePicker(!likePicker)} />
            <AnimatePresence>
              {likePicker && (
                <motion.div initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  className="mx-3 mt-1 mb-2 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl p-2.5 z-10">
                  <div className="grid grid-cols-7 gap-0.5">
                    {LIKE_CHOICES.map((e) => (
                      <button key={e} onClick={() => { useChats.getState().patchChatState(chatId, { likeEmoji: e }); setLikePicker(false); toast(t('likeUpdatedToast')) }}
                        className={`rounded-lg p-1 flex items-center justify-center transition-transform hover:scale-110 ${e === likeEmoji ? 'bg-brand-500/15' : ''}`}>
                        <Emoji char={e} size={24} />
                      </button>
                    ))}
                  </div>
                  {chat.likeEmoji && (
                    <button onClick={() => { useChats.getState().patchChatState(chatId, { likeEmoji: '' }); setLikePicker(false); toast(t('likeResetToast')) }}
                      className="mt-1.5 w-full py-1.5 rounded-xl text-[11.5px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">
                      {t('likeResetDefault')}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── 🔗 ওয়ান-টাইম ইনভাইট লিংক (গ্রুপ-অ্যাডমিন) — এখানেই জেনারেট হয় ── */}
          {isGroup && isAdmin && (
            <div className="px-4 pt-3 pb-1">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <IcLink size={13} /> {t('inviteLinksLabel')} <span className="normal-case font-normal">({t('oneTimeTag')})</span>
              </div>
              <motion.button whileTap={{ scale: 0.97 }} onClick={createInvite}
                className="mt-2 w-full py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold flex items-center justify-center gap-1.5">
                <IcPlus size={16} /> {t('newInvite')}
              </motion.button>
              <AnimatePresence>
                {invites.map((inv) => (
                  <motion.div key={inv.code} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="mt-2 flex items-center gap-1.5 text-[12px]">
                    <code className={`flex-1 truncate bg-slate-100 dark:bg-slate-800 rounded-lg px-2.5 py-1.5 ${!inv.active ? 'opacity-40 line-through' : ''}`}>
                      {location.origin}/#/join/{inv.code}
                    </code>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${inv.active ? 'bg-emerald-500/15 text-emerald-600' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'}`}>
                      {inv.active ? t('inviteUnused') : t('inviteUsed')}
                    </span>
                    <button onClick={() => { navigator.clipboard.writeText(`${location.origin}/#/join/${inv.code}`).catch(() => {}); toast(t('copied')) }}
                      className="p-1.5 opacity-60 hover:opacity-100 shrink-0"><IcCopy size={14} /></button>
                    <button onClick={async () => { await api(`/invites/${inv.code}`, { method: 'DELETE' }); loadInvites() }}
                      className="p-1.5 text-rose-500 shrink-0"><IcTrash size={14} /></button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          <div className="h-px bg-slate-100 dark:bg-white/[0.06] mx-4 my-1.5" />

          {/* মেম্বার-লিস্ট (গ্রুপ) — stagger-ফেড-ইন (Telegram-এর মতো প্রবাহ) */}
          {isGroup && (
            <div className="px-1">
              <div className="px-3 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{t('membersLabel')}</div>
              {chat.members.map((m, i) => (
                <motion.div key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.35), duration: 0.22 }}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/[0.04] rounded-lg">
                  <Avatar name={m.username} id={m.id} avatarKey={m.avatarKey} size={38} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium truncate">{m.name || m.username}</div>
                    <div className="text-[11px] text-slate-400 truncate">{m.about || '—'}</div>
                  </div>
                  {m.role !== 'member' && <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-600 dark:text-brand-300">{m.role === 'owner' ? t('owner') : t('admin')}</span>}
                  {isAdmin && m.id !== me?.id && (
                    <div className="flex gap-1">
                      {myRole === 'owner' && (
                        <button onClick={async () => { await api(`/chats/${chatId}/admin`, { body: { userId: m.id, admin: m.role === 'member' } }); useChats.getState().loadChats() }}
                          className="text-[10.5px] px-1.5 py-1 rounded-md bg-slate-100 dark:bg-white/10">{m.role === 'member' ? t('makeAdmin') : t('removeAdmin')}</button>
                      )}
                      {(myRole === 'owner' || m.role === 'member') && (
                        <button onClick={async () => { await api(`/chats/${chatId}/members/${m.id}`, { method: 'DELETE' }); useChats.getState().loadChats() }}
                          className="text-[10.5px] px-1.5 py-1 rounded-md bg-rose-500/10 text-rose-500">{t('removeBtn')}</button>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}

          {/* অ্যাকশন: ব্লক/আনব্লক, ডিলিট (DM) */}
          {!isGroup && peer && (
            <div className="mt-1.5">
              {useChats.getState().blockedIds[peer.id] ? (
                <Row icon={<IcUnblock size={19} />} label={t('unblock')} onClick={async () => { await useChats.getState().unblock(peer.id); toast(t('unblockedToast')) }} />
              ) : (
                <Row danger icon={<IcBlock size={19} />} label={t('blockBtn')} onClick={async () => {
                  await api(`/me/blocked/${peer.id}`, { method: 'PUT' }).catch(() => {})
                  useChats.getState().loadBlocked()
                  toast(t('blockedToast'))
                }} />
              )}
              <Row danger icon={<IcTrash size={19} />} label={t('deleteChatMe')} onClick={() => {
                useChats.getState().patchChatState(chatId, { deleteForMe: true })
                closeRightPanel()
                useChats.getState().closeChat()
                toast(t('chatDeletedToast'))
              }} />
            </div>
          )}

          {/* মোবাইলে নিচে-এক্সট্রা স্পেস */}
          <div className="h-4" />
        </div>
      </div>
      </motion.aside>
    </>
  )
}
