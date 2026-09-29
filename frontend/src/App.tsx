// fcfc অ্যাপ শেল — টেলিগ্রাম-স্টাইল রাউন্ডেড কন্টেইনার + অ্যানিমেটেড
// TWallpaper ওয়ালপেপার (সব ইউজারের ডিফল্ট, থিম-অ্যাওয়্যার), অথেনটিকেশন
// গেট, চ্যাট লেআউট, ডান-পাশের প্রোফাইল-প্যানেল, ওভারলে, পুশ-আপডেট টোস্ট।
import React, { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import AuthScreen from './components/auth/AuthScreen'
import ChatList, { COMPACT_W } from './components/chat/ChatList'
import ChatWindow from './components/chat/ChatWindow'
import ProfilePanel from './components/chat/ProfilePanel'
import SettingsPanel from './components/settings/SettingsPanel'
import Modals from './components/modals/Modals'
import CallOverlay from './components/calls/CallOverlay'
import { ContextMenu, Toasts, Spinner } from './components/common'
import { useAuth } from './stores/auth'
import { useChats } from './stores/chats'
import { useUi, applyThemeColor } from './stores/ui'
import { startBackupSync, stopBackupSync } from './crypto/backup'
import { useTWallpaper } from './lib/twallpaper'
import InstallBanner from './components/pwa/InstallBanner'
import { IcLock } from './lib/icons'
import { useT } from './lib/i18n'

// ⚠️ ওয়ালপেপার-বাগ #2-র ফিক্স: useTWallpaper-এর effect আগে App-এর একেবারে
// শুরুতে (boot-স্ক্রিন অবস্থায়) চলত — তখন wallpaper-div-ই render হয়নি,
// ref.current = null → early-return → login-এর পরেও আর কখনো চলত না!
// এখন ওয়ালপেপার নিজের component — mount-ই effect-কে গ্যারান্টি দেয়।
function WallpaperLayer({ theme }: { theme: 'light' | 'dark' }) {
  const wallpaperRef = useRef<HTMLDivElement>(null)
  useTWallpaper(wallpaperRef, theme)
  return <div id="fcfc-wallpaper" ref={wallpaperRef} className="tw-wrap absolute inset-0 z-0 pointer-events-none" />
}

export default function App() {
  const status = useAuth((s) => s.status)
  const userId = useAuth((s) => s.user?.id)
  const activeChatId = useChats((s) => s.activeChatId)
  const panel = useUi((s) => s.panel)
  const call = useUi((s) => s.call)
  const mobileView = useUi((s) => s.mobileView)
  const theme = useUi((s) => s.theme)
  const sidebarW = useUi((s) => s.sidebarW)
  const setMobileView = useUi((s) => s.setMobileView)
  const t = useT()
  // (ওয়ালপেপার-হুক এখন <WallpaperLayer>-এর ভেতরে — mount-সময় নিশ্চিত চলে)

  // বুট: টোকেন থাকলে সেশন লোড
  useEffect(() => { useAuth.getState().boot() }, [])

  // লগইন/লগআউট ট্রানজিশন — অথেন্টিকেশন স্টেট নয় এমন সবকিছু রিসেট।
  // আগে এটা ছিল না: user1 লগআউট → user2 লগইন করলে useChats-স্টোরে user1-এর
  // চ্যাট-লিস্ট ইন-মেমরিতে রয়ে যেত (booted=true → নতুন loadChats-ই চলত না)
  // — user1-এর কিছু কন্টাক্ট user2-এর চ্যাটে দেখা যেত, পরে হারিয়ে যেত।
  useEffect(() => {
    if (status !== 'ready') {
      useChats.getState().reset()
      useUi.getState().setPanel(null)
      useUi.getState().closeRightPanel()
      // চলমান কল/ইনকামিং-রিংও বন্ধ — নইলে লগআউটের পরেও রিংটোন বাজত
      useUi.getState().setCall(null)
    }
  }, [status])

  // 🎯 ESC — অনেক কাজে (টেলিগ্রাম-স্টাইল, প্রায়োরিটি-ক্রমে একবারে একটা):
  // কনটেক্সট-মেনু → মডাল → মিডিয়া-ভিউয়ার → অ্যাভাটার-জুম → ইমোজি/পপওভার
  // → ডান প্রোফাইল-প্যানেল → সেটিংস-প্যানেল → রিপ্লাই-ডিসিলেক্ট → (মোবাইল) চ্যাট-ব্যাক
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const ui = useUi.getState()
      if (ui.menu) { ui.closeMenu(); return }
      if (ui.modal) { ui.closeModal(); return }
      if (ui.viewer) { ui.closeViewer(); return }
      if (ui.avatarView) { ui.closeAvatarView(); return }
      if (ui.rightPanel) { ui.closeRightPanel(); return }
      if (ui.panel) { ui.setPanel(null); return }
      const chats = useChats.getState()
      if (chats.replyingTo) { chats.setReplying(null); return }
      if (chats.activeChatId && window.innerWidth < 768) {
        ui.setMobileView('list')
        chats.closeChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // নতুন ইউজারে লগইন (একই সেশনে, যদি কখনো হয়) — স্টোর রিসেট করে বুট আবার
  useEffect(() => {
    if (status === 'ready' && userId) {
      useChats.getState().boot()
      applyThemeColor(useUi.getState().theme)
      // কী-ব্যাকআপের থ্রটলড পর্যায়ক্রমিক সিঙ্ক — লগআউটে বন্ধ
      startBackupSync()
    } else {
      stopBackupSync()
    }
  }, [status, userId])

  // মোবাইল ভিউ সিঙ্ক
  useEffect(() => { setMobileView(activeChatId ? 'chat' : 'list') }, [activeChatId])

  // ── 🖱️ সাইডবার রিসাইজ (টেলিগ্রাম-স্টাইল) ──
  // বর্ডার ধরে টানলে চওড়া/সরু — সর্বনিম্ন ৬৮px (শুধু প্রোফাইল-আইকন,
  // কম্প্যাক্ট-মোড), সর্বোচ্চ ৫২০px। ডাবল-ক্লিকে ডিফল্টে ফেরে।
  function onResizeStart(e: React.PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = useUi.getState().sidebarW
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(68, Math.min(520, startW + (ev.clientX - startX)))
      useUi.getState().setSidebarW(w)
    }
    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ইনভাইট লিংক: /#/join/<code>
  useEffect(() => {
    if (status !== 'ready') return
    const m = location.hash.match(/#\/join\/([\w-]+)/)
    if (m) {
      useChats.getState().joinInvite(m[1])
        .then((id) => { useChats.getState().openChat(id); history.replaceState(null, '', location.pathname) })
        .catch(() => { useUi.getState().toast(t('joinInvalid')) })
    }
  }, [status])

  // পুশ-নোটিফিকেশন ক্লিক ডিপ-লিংক: /?chat=<id> → চ্যাট খোলে,
  // /?devices=1 → সেটিংসের ডিভাইস-লিস্ট (নতুন-লগইন Decline করার জায়গা)।
  useEffect(() => {
    if (status !== 'ready') return
    const sp = new URLSearchParams(location.search)
    const chatParam = sp.get('chat')
    if (chatParam) {
      useChats.getState().openChat(chatParam).catch(() => {})
      history.replaceState(null, '', location.pathname)
    } else if (sp.get('devices') === '1') {
      useUi.getState().setPanel('settings')
      window.dispatchEvent(new Event('fcfc:show-devices'))
      history.replaceState(null, '', location.pathname)
    }
  }, [status])

  // PWA আপডেট টোস্ট
  useEffect(() => {
    const fn = () => useUi.getState().toast(t('newVersion'))
    window.addEventListener('fcfc:update-available', fn)
    return () => window.removeEventListener('fcfc:update-available', fn)
  }, [])

  if (status === 'boot') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 chat-bg">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-2xl font-black shadow-xl shadow-brand-500/30">
          fc
        </motion.div>
        <Spinner className="text-brand-500" />
      </div>
    )
  }

  if (status === 'auth') return <AuthScreen />

  return (
    <div className="h-full md:p-2.5">
      {/* টেলিগ্রাম-স্টাইল রাউন্ডেড অ্যাপ-কন্টেইনার — ডেস্কটপে বাইরে ব্যাকগ্রাউন্ড-গাটার */}
      <div className="h-full flex relative overflow-hidden bg-white dark:bg-[#0e1220] md:rounded-2xl md:shadow-2xl md:ring-1 md:ring-black/5 dark:md:ring-white/10">
        {/* অ্যানিমেটেড ওয়ালপেপার (TWallpaper) — অ্যাপের পুরো পটভূমি।
            id-selector CSS (#fcfc-wallpaper) CDN-এর .tw-wrap-এর fixed/-1
            মারত — এটাই "ওয়ালপেপার দেখা যাচ্ছে না" বাগের দ্বিতীয় অর্ধেক */}
        <WallpaperLayer theme={theme} />

        <div className="relative z-10 flex h-full w-full">
          {/* বাম: চ্যাট লিস্ট + সেটিংস ওভারলে — ড্র্যাগে রিসাইজযোগ্য (var(--sw))।
              সরু হলে ChatList নিজেই কম্প্যাক্ট-মোডে (শুধু অ্যাভাটার) চলে যায় */}
          <div
            style={{ ['--sw' as any]: `${sidebarW}px` }}
            className={`relative h-full w-full md:w-[var(--sw)] md:flex-none md:min-w-[68px] md:max-w-[520px] ${activeChatId && mobileView === 'chat' ? 'hidden md:block' : 'block'}`}
          >
            <ChatList />
            <AnimatePresence>{panel && <SettingsPanel />}</AnimatePresence>
            {/* রিসাইজ হ্যান্ডল — বর্ডারে হোভার করলেই দেখা দেয়, টেনে ছাড়লে ওয়াইড/ন্যারো */}
            <div
              onPointerDown={onResizeStart}
              onDoubleClick={() => useUi.getState().setSidebarW(380)}
              title={t('resizeHint')}
              className="hidden md:block absolute top-0 -right-[3px] bottom-0 w-[7px] cursor-col-resize z-30 group"
            >
              <div className="h-full w-full rounded-full transition-colors group-hover:bg-brand-500/40 group-active:bg-brand-500/60" />
            </div>
          </div>

          {/* ডান: চ্যাট উইন্ডো + প্রোফাইল-প্যানেল */}
          <div className={`h-full flex-1 min-w-0 ${!activeChatId || mobileView === 'list' ? 'hidden md:flex' : 'flex'}`}>
            {activeChatId ? (
              <div className="flex-1 h-full min-w-0">
                <ChatWindow key={activeChatId} chatId={activeChatId} />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center px-6 py-5 rounded-3xl bg-white/70 dark:bg-[#17181a]/80 backdrop-blur shadow-sm">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-xl font-black shadow-lg shadow-brand-500/25">fc</div>
                  <div className="mt-3 font-bold text-lg">fcfc</div>
                  <p className="text-sm text-slate-400 mt-1 max-w-[280px] flex items-center gap-1.5 justify-center">
                    <IcLock size={13} /> {t('e2eTagline')}
                  </p>
                </div>
              </div>
            )}
            {/* ডান-পাশের প্রোফাইল-প্যানেল (হেডার-ক্লিকে খোলে) */}
            <ProfilePanel />
          </div>
        </div>
      </div>

      {/* ওভারলে */}
      <Modals />
      <ContextMenu />
      <Toasts />
      <AnimatePresence>{call && <CallOverlay />}</AnimatePresence>
      {/* PWA ইনস্টল-ব্যানার — নিচে, "Never show again" বললে আর কখনো নয় */}
      <InstallBanner />
    </div>
  )
}
