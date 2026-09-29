// সেটিংস স্লাইড-ওভারলে — প্রোফাইল, ভাষা, প্রাইভেসি, নোটিফিকেশন, ডিভাইস/
// সেশন, ব্লকড লিস্ট, আর্কাইভড, স্টারড, অ্যাকাউন্ট ডিলিট।
import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../stores/auth'
import { useChats } from '../../stores/chats'
import { useUi } from '../../stores/ui'
import { api, mediaUrl } from '../../api/client'
import { Avatar, ChatAvatar, EmptyState, Switch, IconTile } from '../common'
import { usePush } from '../../hooks/usePush'
import { processAvatar } from '../../lib/media'
import { fmtLastSeen } from '../../lib/utils'
import { useT, useI18n } from '../../lib/i18n'
import { promptInstall } from '../../lib/install'
import { Emoji } from '../../lib/emoji'
import PinPad from '../auth/PinPad'
import { IcBack, IcCamera, IcBell, IcLock, IcMoon, IcSun, IcLogout, IcUsers, IcArchive, IcStar, IcWallpaper, IcTrash, IcGlobe, IcBlock, IcUnblock, IcChevD, IcCheck, IcUser } from '../../lib/icons'

// লাইক-বাটনের ডিফল্ট-ইমোজির পছন্দ-তালিকা (সেটিংস → প্রোফাইল)
const LIKE_CHOICES = ['👍', '❤️', '😂', '😮', '😢', '😍', '🔥', '🎉', '🥰', '👏', '💯', '🤩', '😎', '🤔', '😅', '🙌', '🙏', '💀', '👀', '🤝', '💪', '✨', '🌈', '⭐', '🥳', '😴', '🤗', '😼']

type View = 'main' | 'profile' | 'privacy' | 'notifications' | 'devices' | 'blocked' | 'appearance' | 'account' | 'passcode'

export default function SettingsPanel() {
  const panel = useUi((s) => s.panel)
  const setPanel = useUi((s) => s.setPanel)
  if (!panel) return null
  return (
    <motion.div
      initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 350, damping: 32 }}
      // 🫧 হালকা গ্লাসমরফিজম — সেটিংস-প্যানেল এখন পেছনের অ্যানিমেটেড
      // ওয়ালপেপার/চ্যাট-লিস্টের উপর ব্লার-কাচের মতো বসে (বেশি স্বচ্ছ না —
      // লেখা পড়ার ক্ষতি হয় না)
      className="absolute inset-0 z-40 glass-bar md:rounded-r-3xl flex flex-col"
    >
      {panel === 'settings' && <SettingsBody />}
      {panel === 'archived' && <ArchivedView />}
      {panel === 'starred' && <StarredView />}
    </motion.div>
  )
}

function SettingsBody() {
  const [view, setView] = useState<View>('main')
  const setPanel = useUi((s) => s.setPanel)
  // রিয়েক্টিভ সাবস্ক্রিপশন — আগে useAuth.getState() স্ন্যাপশট নেওয়া হতো,
  // সাউন্ড-টগল/প্রোফাইল-আপডেটের পরে UI আপডেট হতো না।
  const user = useAuth((s) => s.user)
  const settings = useAuth((s) => s.settings)
  const { updateProfile, updateSettings, logout, deleteAccount } = useAuth.getState()
  const toast = useUi((s) => s.toast)
  const theme = useUi((s) => s.theme)
  const toggleTheme = useUi((s) => s.toggleTheme)
  const subscribePush = usePush()
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const setLang = useI18n((s) => s.setLang)
  const [about, setAbout] = useState(user?.about || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [email, setEmail] = useState(user?.email || '')
  const [nameField, setNameField] = useState(user?.name || '')
  const [likePicker, setLikePicker] = useState(false)
  const [devices, setDevices] = useState<any[]>([])
  const [current, setCurrent] = useState('')
  const [blocked, setBlocked] = useState<any[]>([])
  const [delPass, setDelPass] = useState('')

  useEffect(() => { if (view === 'devices') api('/me/devices').then((r) => { setDevices(r.devices); setCurrent(r.current) }).catch(() => {}) }, [view])
  useEffect(() => { if (view === 'blocked') api('/me/blocked').then((r) => setBlocked(r.results)).catch(() => {}) }, [view])
  // পুশ-নোটিফিকেশন ক্লিক (/?devices=1) → সরাসরি ডিভাইস-ভিউ
  useEffect(() => {
    const fn = () => setView('devices')
    window.addEventListener('fcfc:show-devices', fn)
    return () => window.removeEventListener('fcfc:show-devices', fn)
  }, [])

  if (!user) return null

  const Row = ({ icon, label, sub, onClick, right }: any) => (
    <button onClick={onClick} className="w-full flex items-center gap-3.5 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition text-left">
      <span className="text-slate-400">{icon}</span>
      <span className="flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {sub && <span className="block text-xs text-slate-400 mt-0.5">{sub}</span>}
      </span>
      {right}
    </button>
  )

  // ভাষা বদলানো — লোকালি সেভ + সার্ভার-সেটিংসেও (যেন পুশ-টাইটেলও সেই ভাষায় যায়)
  function pickLang(l: 'en' | 'bn') {
    setLang(l)
    updateSettings({ lang: l }).catch(() => {})
  }

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-100 dark:border-slate-800">
        {view !== 'main' ? (
          <button onClick={() => setView('main')} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><IcBack size={20} /></button>
        ) : (
          <button onClick={() => setPanel(null)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><IcBack size={20} /></button>
        )}
        <h2 className="font-bold text-lg">{{ profile: t('profilePanelT'), privacy: t('privacyT'), notifications: t('notificationsT'), devices: t('devicesT'), blocked: t('blockedPanelT'), appearance: t('themePanelT'), account: t('accountT'), passcode: t('passcodeT'), main: t('settings') }[view]}</h2>
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        <AnimatePresence mode="wait">
          <motion.div key={view}
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="min-h-full">
            {view === 'main' && (
          <>
            <button onClick={() => setView('profile')} className="w-full flex items-center gap-4 px-5 py-5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
              <Avatar name={user.username} id={user.id} avatarKey={user.avatarKey} size={62} />
              <div className="text-left">
                <div className="text-lg font-bold">@{user.username}</div>
                <div className="text-sm text-slate-400 truncate max-w-[200px]">{user.about || t('addAbout')}</div>
              </div>
            </button>
            <div className="border-t border-slate-100 dark:border-slate-800 mt-1" />
            <Row icon={<IcGlobe size={20} />} label={t('languageRow')} sub={t('languageSub')} onClick={() => {}} right={
              <div className="flex gap-2">
                {(['en', 'bn'] as const).map((l) => (
                  <button key={l} onClick={(e) => { e.stopPropagation(); pickLang(l) }}
                    className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold transition ${lang === l ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                    {l === 'en' ? t('english') : t('bangla')}
                  </button>
                ))}
              </div>
            } />
            <Row icon={<IcBell size={20} />} label={t('notificationsT')} sub={t('notifRowSub')} onClick={() => setView('notifications')} />
            <Row icon={<IcLock size={20} />} label={t('privacyT')} sub={t('privacyRowSub')} onClick={() => setView('privacy')} />
            {/* 🆕 ইউজার-আইডি ও পাসকোড ম্যানেজমেন্ট — পুরনো অ্যাকাউন্টেও
                (শুধু username+password দিয়ে সাইনআপ করা) এখান থেকেই সেট-আপ */}
            <Row icon={<IcUser size={20} />} label={t('passcodeRow')} sub={user.userIdCode ? t('passcodeRowSub') : t('passcodeRowSubNone')} onClick={() => setView('passcode')} />
            <Row icon={<IcUsers size={20} />} label={t('devicesT')} sub={t('devicesRowSub')} onClick={() => setView('devices')} />
            <Row icon={<IcArchive size={20} />} label={t('archivedChats')} onClick={() => setPanel('archived')} />
            <Row icon={<IcStar size={20} />} label={t('starredRow')} onClick={() => setPanel('starred')} />
            <Row icon={<IcBlock size={20} />} label={t('blockedPanelT')} onClick={() => setView('blocked')} />
            <Row icon={theme === 'dark' ? <IcSun size={20} /> : <IcMoon size={20} />} label={theme === 'dark' ? t('lightTheme') : t('darkTheme')} onClick={toggleTheme} />
            <div className="border-t border-slate-100 dark:border-slate-800 mt-1" />
            <Row icon={<IcTrash size={20} />} label={t('deleteAccountRow')} sub={t('deleteAccountSub')} onClick={() => setView('account')} />
            <Row icon={<IcLogout size={20} />} label={t('logoutRow')} onClick={() => useUi.getState().openModal('confirm', { title: t('logoutRow'), body: t('logoutConfirmB'), confirmText: t('logoutRow'), onConfirm: () => logout() })} />
          </>
        )}

        {view === 'profile' && (
          <div className="p-5 space-y-4">
            <div className="flex justify-center">
              <div className="relative">
                <Avatar name={user.username} id={user.id} avatarKey={user.avatarKey} size={100}
                  onClick={() => useUi.getState().openAvatarView(user.username, user.id, user.avatarKey)} />
                <label className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-brand-600 text-white flex items-center justify-center cursor-pointer shadow-lg">
                  <IcCamera size={17} />
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (!f) return
                    try {
                      // হাই-কোয়ালিটি ডাউনস্কেল (স্টেপ-হালভিং): ফুল ≤800px + ছোট ≤200px।
                      const { full, small } = await processAvatar(f)
                      await api('/me/avatar', { method: 'POST', body: full, headers: { 'content-type': 'image/jpeg' } })
                      await api('/me/avatar?variant=small', { method: 'POST', body: small, headers: { 'content-type': 'image/jpeg' } }).catch(() => {})
                      toast(t('avatarUpdated'))
                      useAuth.getState().updateProfile({})
                    } catch {
                      // ফলব্যাক — পুরনো পথ: অপ্রসেসড ফাইল সরাসরি
                      await api('/me/avatar', { method: 'POST', body: f, headers: { 'content-type': f.type } })
                      toast(t('avatarUpdated'))
                      useAuth.getState().updateProfile({})
                    }
                  }} />
                </label>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">{t('usernameFixed')}</label>
              <div className="mt-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 opacity-70">@{user.username}</div>
            </div>
            {/* 🆕 নাম — চ্যাটে প্রেরকের নাম হিসেবে দেখায় (username/ID ছাড়া এটা বদলানো যায়) */}
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">{t('nameLabel')} <span className="normal-case font-normal">({t('nameSub')})</span></label>
              <div className="mt-1 flex gap-2">
                <input value={nameField} onChange={(e) => setNameField(e.target.value.slice(0, 60))}
                  placeholder={user.username} className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
                <button onClick={async () => {
                  try {
                    await updateProfile({ name: nameField.trim() })
                    toast(t('savedToast'))
                  } catch (e: any) { toast(e.message || t('failedRetry')) }
                }} className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">{t('saveBtn')}</button>
              </div>
            </div>
            {/* ── ফোন / ইমেইল — সাইনআপে না দিলে এখান থেকেই যোগ/বদল ── */}
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">{t('phoneLabel')}</label>
              <div className="mt-1 flex gap-2">
                <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9+\s-]/g, '').slice(0, 22))}
                  inputMode="tel" placeholder={t('phonePh')}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
                <button onClick={async () => {
                  try {
                    await updateProfile({ phone })
                    toast(t('savedToast'))
                  } catch (e: any) { toast(e.message || t('failedRetry')) }
                }} className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">{t('saveBtn')}</button>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">{t('emailLabel')} <span className="normal-case font-normal">({t('optionalTag')})</span></label>
              <div className="mt-1 flex gap-2">
                <input value={email} onChange={(e) => setEmail(e.target.value.trim().slice(0, 190))}
                  inputMode="email" placeholder={t('emailPh')}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
                <button onClick={async () => {
                  try {
                    await updateProfile({ email })
                    toast(t('savedToast'))
                  } catch (e: any) { toast(e.message || t('failedRetry')) }
                }} className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">{t('saveBtn')}</button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{t('phoneEmailSearchHint')}</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">{t('aboutBio')}</label>
              <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={2} maxLength={200}
                className="mt-1 w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30 resize-none" />
              <button onClick={async () => { await updateProfile({ about }); toast(t('savedToast')) }}
                className="mt-2 px-5 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">{t('saveBtn')}</button>
            </div>
            {/* ── ডিফল্ট লাইক-বাটন ইমোজি (Messenger-স্টাইল) — প্রতি-চ্যাট ওভাররাইড প্রোফাইল-প্যানেলে */}
            <div className="relative">
              <label className="text-xs font-semibold text-slate-400 uppercase">{t('likeBtnSetting')}</label>
              <button onClick={() => setLikePicker(!likePicker)}
                className="mt-1.5 w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                <Emoji char={settings?.likeEmoji || '👍'} size={26} />
                <span className="text-sm font-medium flex-1 text-left">{t('likeBtnSettingSub')}</span>
                <IcChevD size={16} className="text-slate-400" />
              </button>
              <AnimatePresence>
                {likePicker && (
                  <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    className="absolute left-0 right-0 top-full mt-2 z-30 rounded-2xl glass shadow-xl p-2.5">
                    <div className="grid grid-cols-7 gap-0.5">
                      {LIKE_CHOICES.map((e) => (
                        <button key={e} onClick={() => { updateSettings({ likeEmoji: e }); setLikePicker(false); toast(t('savedToast')) }}
                          className={`rounded-lg p-1 flex items-center justify-center transition-transform hover:scale-110 ${e === (settings?.likeEmoji || '👍') ? 'bg-brand-500/15' : ''}`}>
                          <Emoji char={e} size={24} />
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {view === 'privacy' && (
          <div className="p-5 space-y-5">
            <div>
              <div className="font-semibold text-sm mb-1">{t('whoCanDm')}</div>
              <p className="text-xs text-slate-400 mb-2">{t('whoCanDmHint')}</p>
              <div className="flex gap-2">
                {[['everyone', t('everyone')], ['request', t('requestOnly')]].map(([v, l]) => (
                  <button key={v} onClick={async () => { await updateProfile({ privacyDm: v }); toast(t('updatedToast')) }}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold ${user.privacyDm === v || (!user.privacyDm && v === 'everyone') ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-semibold text-sm mb-2">{t('lastSeenWho')}</div>
              <div className="flex gap-2">
                {[['everyone', t('everyone')], ['nobody', t('nobody')]].map(([v, l]) => (
                  <button key={v} onClick={async () => { await updateProfile({ lastseenPriv: v }); toast(t('updatedToast')) }}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold ${(user.lastSeenPriv || 'everyone') === v ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>{l}</button>
                ))}
              </div>
            </div>
            <div className="text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/70 rounded-xl p-3.5 leading-relaxed">
              {t('e2eNote')}
            </div>
          </div>
        )}

        {view === 'notifications' && (
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div><div className="font-medium text-sm">{t('soundRow')}</div><div className="text-xs text-slate-400">{t('soundRowSub')}</div></div>
              <Switch on={settings.sound !== false} onChange={(v) => updateSettings({ sound: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div><div className="font-medium text-sm">{t('pushRow')}</div><div className="text-xs text-slate-400">{t('pushRowSub')}</div></div>
              <button onClick={async () => { const ok = await subscribePush(); toast(ok ? t('pushOnToast') : t('pushFailToast')) }}
                className="px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold">{t('enableBtn')}</button>
            </div>
            {/* অ্যাপ ইনস্টল — "Never show again" বলে ব্যানার বন্ধ করলেও
                এখান থেকে যেকোনো সময় ইনস্টল করা যায় */}
            <div className="flex items-center justify-between">
              <div><div className="font-medium text-sm">{t('installBannerT')}</div><div className="text-xs text-slate-400">{t('installBannerSub')}</div></div>
              <button onClick={async () => {
                const r = await promptInstall()
                if (r === 'accepted') toast(t('installedToast'))
                else if (r === 'unavailable') toast(t('installHintBrowser'))
              }}
                className="px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold">{t('installBtn2')}</button>
            </div>
            <p className="text-xs text-slate-400">{t('perChatMuteHint')}</p>
          </div>
        )}

        {view === 'devices' && (
          <div className="p-4">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <span className={`w-2.5 h-2.5 rounded-full ${d.approved === 1 ? 'bg-emerald-500' : d.approved === 2 ? 'bg-rose-500' : 'bg-amber-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{d.name} {d.id === current && <span className="text-brand-500 text-xs">{t('thisDevice')}</span>}</div>
                  <div className="text-xs text-slate-400">{t('lastActive')} {d.last_active ? fmtLastSeen(d.last_active) : '—'}{d.approved === 2 ? ` · ${t('revokedTag')}` : d.approved !== 1 ? ` · ${t('awaitingTag')}` : ''}</div>
                </div>
                {d.id !== current && (
                  <button onClick={async () => { await api(`/me/devices/${d.id}`, { method: 'DELETE' }); setDevices(devices.filter((x) => x.id !== d.id)); toast(t('sessionClosed')) }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-500 font-semibold">{t('logoutRow')}</button>
                )}
              </div>
            ))}
            {devices.length === 0 && <div className="text-center text-sm text-slate-400 py-8">{t('noDevices')}</div>}
          </div>
        )}

        {view === 'blocked' && (
          <div className="p-4">
            {blocked.length === 0 && <EmptyState icon={<IcBlock size={26} />} title={t('noBlocked')} />}
            {blocked.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={b.username} id={b.id} avatarKey={b.avatarKey} size={40} />
                <span className="flex-1 text-sm font-medium">@{b.username}</span>
                <button onClick={async () => {
                  await useChats.getState().unblock(b.id)
                  setBlocked(blocked.filter((x) => x.id !== b.id))
                }} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 font-semibold flex items-center gap-1">
                  <IcUnblock size={13} /> {t('unblock')}
                </button>
              </div>
            ))}
          </div>
        )}

        {view === 'passcode' && <PasscodeView />}

        {view === 'account' && (
          <div className="p-5 space-y-4">
            <div className="text-sm text-rose-500 bg-rose-500/10 rounded-xl p-4 leading-relaxed">
              {t('deleteWarn')}
            </div>
            <input type="password" value={delPass} onChange={(e) => setDelPass(e.target.value)} placeholder={t('confirmPassPh')}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500/30" />
            <button disabled={!delPass} onClick={async () => {
              const err = await deleteAccount(delPass)
              if (err) toast(err)
              else toast(t('accountDeletedToast'))
            }} className="w-full py-2.5 rounded-xl bg-rose-500 text-white font-semibold disabled:opacity-40">{t('permDelete')}</button>
          </div>
        )}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}

function ArchivedView() {
  const chats = useChats((s) => s.chats)
  const setPanel = useUi((s) => s.setPanel)
  const patchChatState = useChats((s) => s.patchChatState)
  const t = useT()
  const archived = Object.values(chats).filter((c) => c.archived)
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-100 dark:border-slate-800">
        <button onClick={() => setPanel(null)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><IcBack size={20} /></button>
        <h2 className="font-bold text-lg">{t('archivedT')}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {archived.length === 0 && <EmptyState icon={<IcArchive size={26} />} title={t('noArchived')} />}
        {archived.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <ChatAvatar chat={c} size={44} />
            <span className="flex-1 font-medium text-sm truncate">{c.title || c.peer?.username}</span>
            <button onClick={() => patchChatState(c.id, { archived: false })} className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 font-semibold">{t('unarchive')}</button>
          </div>
        ))}
      </div>
    </>
  )
}

function StarredView() {
  const [msgs, setMsgs] = useState<any[]>([])
  const chats = useChats((s) => s.chats)
  const setPanel = useUi((s) => s.setPanel)
  const t = useT()
  useEffect(() => { useChats.getState().starredList().then(setMsgs) }, [])
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-100 dark:border-slate-800">
        <button onClick={() => setPanel(null)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><IcBack size={20} /></button>
        <h2 className="font-bold text-lg">{t('starredT')}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {msgs.length === 0 && <EmptyState icon={<IcStar size={26} />} title={t('noStarred')} sub={t('starHint')} />}
        {msgs.map((m) => (
          <button key={m.id} onClick={() => { setPanel(null); useChats.getState().openChat(m.chatId) }}
            className="w-full text-left px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800">
            <div className="text-xs font-semibold text-brand-500">{chats[m.chatId]?.title || chats[m.chatId]?.peer?.username || 'Chat'}</div>
            <div className="text-sm mt-1 truncate">{m.body || `(${m.type})`}</div>
          </button>
        ))}
      </div>
    </>
  )
}

/* ═══ 🆕 ইউজার-আইডি ও পাসকোড ম্যানেজমেন্ট ═══
   পুরনো অ্যাকাউন্ট (শুধু username+password): প্রথমে আইডি+পাসকোড সেট-আপ।
   নতুন অ্যাকাউন্ট / সেট-আপ হয়ে গেলে: পাসকোড বদলানো (পাসওয়ার্ড যাচাইয়ে)।
   ইউজার-আইডি আর username — দুটোই immutable। সব ধাপে কাস্টম নাম্প্যাড। */
function PasscodeView() {
  const t = useT()
  const user = useAuth((s) => s.user)
  const toast = useUi((s) => s.toast)
  const { setupPasscode } = useAuth.getState()
  const hasId = !!user?.userIdCode

  // gate → (setup: uid → pin → pin2) | (change: pin → pin2) → done
  const [phase, setPhase] = useState<'gate' | 'uid' | 'pin' | 'pin2' | 'done'>('gate')
  const [password, setPassword] = useState('')
  const [uidCode, setUidCode] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dir, setDir] = useState(1)
  const slide: any = {
    initial: { opacity: 0, x: 34 * dir, scale: 0.98 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: { opacity: 0, x: -34 * dir, scale: 0.98 },
    transition: { type: 'spring', stiffness: 380, damping: 32 },
  }

  async function verify() {
    if (busy || !password) return
    setBusy(true); setError('')
    // পাসওয়ার্ড যাচাই সার্ভারে /me/passcode-ই করবে — এখানে শুধু
    // ফর্ম-গেট হিসেবে ধরি; ভুল পাসওয়ার্ড দিলে পরের ধাপে এরর আসবে।
    setBusy(false)
    setDir(1)
    setPhase(hasId ? 'pin' : 'uid')
  }

  async function save(newPin: string) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const err = await setupPasscode(password, uidCode, newPin)
      if (err) { setError(err); setPhase(hasId ? 'pin' : 'uid'); setPin(''); setPin2(''); }
      else { toast(t('passcodeSavedToast')); setPhase('done'); setDir(1) }
    } finally { setBusy(false) }
  }

  if (!user) return null

  return (
    <div className="p-5">
      <AnimatePresence mode="wait">
        {error && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-3">
            <div className="text-[13px] text-rose-500 bg-rose-500/10 rounded-xl px-4 py-2.5">{error}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {/* ── স্ট্যাটাস / গেট ── */}
        {phase === 'gate' && (
          <motion.div key="gate" {...slide} className="space-y-4">
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">{t('uidImmutable')}</span>
                <span className="font-bold text-[16px] tabular-nums text-slate-800 dark:text-slate-100">{user.userIdCode || t('uidNotSet')}</span>
              </div>
              <div className="text-[12px] text-slate-400 leading-relaxed">{t('suPinSub')}</div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">{t('passcodeVerifyPassT')}</label>
              <p className="text-[12px] text-slate-400 mt-0.5 mb-2">{t('passcodeVerifyPassSub')}</p>
              <div className="flex gap-2">
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('passwordPh')}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
                <motion.button whileTap={{ scale: 0.95 }} disabled={!password || busy} onClick={verify}
                  className="px-5 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold disabled:opacity-40">{t('verifyBtn')}</motion.button>
              </div>
            </div>
            <div className="text-[11.5px] text-slate-400 leading-relaxed px-1">{t('noRecovery')}</div>
          </motion.div>
        )}

        {/* ── সেট-আপ: ইউজার-আইডি বাছাই (একবারই) ── */}
        {phase === 'uid' && (
          <motion.div key="uid" {...slide} className="space-y-2">
            <div className="text-center pt-1">
              <div className="text-[16px] font-bold text-slate-800 dark:text-slate-100">{t('suUidTitle')}</div>
              <div className="text-[12.5px] text-slate-400 mt-1">{t('suUidSub')}</div>
            </div>
            <PinPad value={uidCode} onChange={setUidCode} max={12} minLength={4} secure={false} />
            <div className="flex gap-2.5 pt-1">
              <button className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 font-semibold text-sm" onClick={() => { setDir(-1); setPhase('gate') }}>
                {t('backBtn')}
              </button>
              <motion.button whileTap={{ scale: 0.96 }} disabled={uidCode.length < 4 || busy} className="flex-1 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold text-sm disabled:opacity-40"
                onClick={() => { setPin(''); setDir(1); setPhase('pin') }}>
                {t('nextBtn')} →
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ── পাসকোড সেট/বদল ── */}
        {phase === 'pin' && (
          <motion.div key="pin" {...slide} className="space-y-2">
            <div className="text-center pt-1">
              <div className="text-[16px] font-bold text-slate-800 dark:text-slate-100">{hasId ? t('passcodeChangeBtn') : t('suPinTitle')}</div>
              <div className="text-[12.5px] text-slate-400 mt-1">{t('suPinSub')}</div>
            </div>
            <PinPad value={pin} onChange={setPin} max={8} minLength={6} />
            <div className="flex gap-2.5 pt-1">
              <button className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 font-semibold text-sm" onClick={() => { setDir(-1); setPhase(hasId ? 'gate' : 'uid') }}>
                {t('backBtn')}
              </button>
              <motion.button whileTap={{ scale: 0.96 }} disabled={pin.length < 6 || busy} className="flex-1 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold text-sm disabled:opacity-40"
                onClick={() => { setPin2(''); setDir(1); setPhase('pin2') }}>
                {t('nextBtn')} →
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ── পাসকোড কনফার্ম ── */}
        {phase === 'pin2' && (
          <motion.div key="pin2" {...slide} className="space-y-2">
            <div className="text-center pt-1">
              <div className="text-[16px] font-bold text-slate-800 dark:text-slate-100">{t('suPin2Title')}</div>
              <div className="text-[12.5px] text-slate-400 mt-1">{t('suPin2Sub')}</div>
            </div>
            <PinPad value={pin2} onChange={setPin2} max={8} minLength={6} />
            {pin2.length >= 6 && pin !== pin2 && (
              <div className="text-[12px] text-rose-500 font-semibold text-center">{t('passMismatch')}</div>
            )}
            {pin2.length >= 6 && pin === pin2 && (
              <div className="text-[12px] text-emerald-500 font-semibold text-center flex items-center justify-center gap-1">
                <IcCheck size={14} /> {t('pinMatched')}
              </div>
            )}
            <div className="flex gap-2.5 pt-1">
              <button className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 font-semibold text-sm" onClick={() => { setDir(-1); setPhase('pin') }}>
                {t('backBtn')}
              </button>
              <motion.button whileTap={{ scale: 0.96 }} disabled={pin !== pin2 || pin.length < 6 || busy} className="flex-1 px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold text-sm disabled:opacity-40"
                onClick={() => save(pin)}>
                {busy ? '…' : t('saveBtn')}
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ── সেভ হয়ে গেছে ── */}
        {phase === 'done' && (
          <motion.div key="done" {...slide} className="flex flex-col items-center gap-3 py-8">
            <motion.div initial={{ scale: 0.3, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 16 }}
              className="w-16 h-16 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
              <IcCheck size={30} strokeWidth={2.5} />
            </motion.div>
            <div className="font-bold text-[16px] text-slate-800 dark:text-slate-100">{t('passcodeSavedToast')}</div>
            {user.userIdCode && (
              <div className="text-[13px] text-slate-400">{t('uidImmutable')}: <span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{user.userIdCode}</span></div>
            )}
            <button className="mt-2 px-5 py-2.5 rounded-xl bg-brand-600 text-white font-bold text-sm" onClick={() => { setPhase('gate'); setPassword(''); setPin(''); setPin2(''); setUidCode('') }}>
              {t('backBtn')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
