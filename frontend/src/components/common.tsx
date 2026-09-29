// ছোট শেয়ার্ড কম্পোনেন্ট: অ্যাভাটার, টোস্ট, কনটেক্সট মেনু, স্পিনার, আইকন-টাইল।
import React, { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { initials, avatarGradient } from '../lib/utils'
import { mediaUrl } from '../api/client'
import { smallAvatarKey } from '../lib/media'
import { useUi, type MenuReactions } from '../stores/ui'
import { useT } from '../lib/i18n'
import { Emoji } from '../lib/emoji'
import { chatTitle } from '../lib/notify'
import { IcPlus, IcChevD, IcBookmark } from '../lib/icons'
import { GlassMenu, GlassItem, useRefraction } from './GlassMenu'
import type { Chat } from '../types'

// সুন্দর ডিফল্ট অ্যাভাটার — দুই-স্টপ গ্রেডিয়েন্ট + সফট শ্যাডো + হালকা রিং।
// ছোট প্রদর্শনে _small ভ্যারিয়েন্ট (নিখুঁত শার্প — হাই-রেজ ছবি ৪০px-এ
// ব্রাউজারে মিহে যাওয়ার সমস্যা নেই), বড় ভিউ/জুমে ফুল-রেজ।
export function Avatar({ name = '?', id = '', avatarKey, size = 44, online, ring, onClick, full }: {
  name?: string; id?: string; avatarKey?: string; size?: number; online?: boolean; ring?: boolean; onClick?: () => void; full?: boolean
}) {
  // stage: 0 = ছোট ভ্যারিয়েন্ট, 1 = ফুল, 2 = ইনিশিয়াল-গ্রেডিয়েন্ট ফলব্যাক
  const [stage, setStage] = useState<0 | 1 | 2>(avatarKey ? (full ? 1 : 0) : 2)
  const url = !avatarKey || stage === 2 ? '' : mediaUrl(stage === 0 ? smallAvatarKey(avatarKey) : avatarKey)
  const [c1, c2] = avatarGradient(id || name)
  const inner = (
    <>
      {url ? (
        <img src={url} alt={name} loading="lazy" draggable={false}
          onError={() => setStage((s) => (s === 0 ? 1 : 2))}
          className="w-full h-full rounded-full object-cover" />
      ) : (
        <div
          className="w-full h-full rounded-full flex items-center justify-center text-white font-semibold select-none"
          style={{
            background: `linear-gradient(135deg, ${c1}, ${c2})`,
            fontSize: size * 0.38,
            letterSpacing: '0.02em',
            boxShadow: 'inset 0 -18% 24% -12% rgba(0,0,0,.28), inset 0 12% 20% -14% rgba(255,255,255,.45)',
          }}
        >
          {initials(name)}
        </div>
      )}
      {ring && <div className="absolute inset-0 rounded-full ring-2 ring-brand-500/70" />}
      {online && (
        <span className="absolute bottom-0 right-0 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" style={{ width: Math.max(9, size * 0.24), height: Math.max(9, size * 0.24) }} />
      )}
    </>
  )
  const box = (
    <div className={`relative shrink-0 ${onClick ? 'cursor-pointer' : ''}`} style={{ width: size, height: size }}>
      {inner}
    </div>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick() }}
        className="rounded-full focus:outline-none"
        aria-label={name}
      >
        {box}
      </button>
    )
  }
  return box
}

export function Spinner({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21.5 12a9.5 9.5 0 00-9.5-9.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] flex flex-col gap-2 items-center pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            // ⚠️ আগে bg-slate-900/92 ছিল — Tailwind অপাসিটি মডিফায়ার ৫-এর
            // ধাপে না হলে জেনারেটই হয় না; /92 বৈধ নয় → টোস্টের ব্যাকগ্রাউন্ড
            // স্বচ্ছ হয়ে লাইট মোডে সাদা লেখা অদৃশ্য ছিল। এখন /95।
            className="px-4 py-2.5 rounded-xl bg-slate-900/95 dark:bg-slate-700/95 text-white text-sm shadow-xl backdrop-blur"
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// 📌 Saved Messages-এর অ্যাভাটার — Telegram-এর মতো নীল-গ্রেডিয়েন্ট + বুকমার্ক
export function SavedAvatar({ size = 44 }: { size?: number }) {
  return (
    <div className="rounded-full flex items-center justify-center text-white shrink-0"
      style={{
        width: size, height: size,
        background: 'linear-gradient(135deg, #4f8ef7 0%, #6366f1 100%)',
        boxShadow: 'inset 0 -18% 24% -12% rgba(0,0,0,.28), inset 0 12% 20% -14% rgba(255,255,255,.45)',
      }}>
      <IcBookmark size={Math.round(size * 0.52)} strokeWidth={2.1} />
    </div>
  )
}

// চ্যাট-অ্যাভাটার — Saved Messages হলে বুকমার্ক-টাইল, নাহলে সাধারণ অ্যাভাটার।
// লিস্ট/হেডার/প্যানেল/ফরওয়ার্ড — সব জায়গায় এই একটাই হেল্পার।
export function ChatAvatar({ chat, size = 44, online, onClick }: {
  chat: Chat; size?: number; online?: boolean; onClick?: () => void
}) {
  if (chat.saved) return <SavedAvatar size={size} />
  return (
    <Avatar
      name={chatTitle(chat)}
      id={chat.id}
      avatarKey={chat.kind === 'group' ? chat.photoKey : chat.peer?.avatarKey}
      size={size}
      online={online}
      onClick={onClick}
    />
  )
}

// জেল-টাইল আইকন — রাউন্ডেড-স্কয়ার রঙিন টাইলে সাদা আইকন (স্ক্রিনশটের
// রেফারেন্স-স্টাইল)। মেনু-আইটেমে ইমোজির বদলে এটা বসে।
export function IconTile({ children, from, to, size = 30 }: { children: React.ReactNode; from: string; to: string; size?: number }) {
  return (
    <span
      className="rounded-[9px] flex items-center justify-center text-white shrink-0"
      style={{
        width: size, height: size,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        boxShadow: 'inset 0 10% 18% -10% rgba(255,255,255,.5), 0 2px 5px -1px rgba(0,0,0,.25)',
      }}
    >
      {children}
    </span>
  )
}

// টেলিগ্রাম-স্টাইল কনটেক্সট মেনু — রিয়্যাকশন-স্ট্রিপ (উপরে আলাদা বাবল),
// কমপ্যাক্ট মনোক্রোম আইকন-সারি, ডেঞ্জার-আইটেম লাল, উপরে সেপারেটর।
//
// 🆕💧 এখন **Liquid-Glass** ডিজাইনে (qu.ax/SlcUY — "Glass menu 1" রেফারেন্স
// হুবহু): ফ্রস্টেড-গ্লাস + ঘূর্ণায়মান রেইনবো-রিম + কার্সার-লাইট +
// গ্লাইডিং-পিল + ট্যাপ-রিপল + jelly-in। আইটেম-ক্রম আগের মতোই
// (Reply → Copy → Pin → Forward → Edit → Star → Delete…)।
export const TG_QUICK_REACTIONS = ['👍', '😢', '❤️', '👎', '🔥', '😂', '👏']

export function ContextMenu() {
  const menu = useUi((s) => s.menu)
  const closeMenu = useUi((s) => s.closeMenu)
  const [expanded, setExpanded] = useState(false)
  const rbarRef = useRef<HTMLDivElement>(null)
  // 🌈 রিয়্যাকশন-বারেও রিফ্র্যাকশন (Chromium)
  useRefraction(rbarRef, 'bar')
  // expanded-গ্রিডের উচ্চতা হিসাব — মেনু স্ক্রিনের নিচে না যায়
  const gridRows = Math.ceil((menu?.reactions?.more?.length || 0) / 8)
  const estH = (menu?.items.length || 0) * 46 + (menu?.reactions ? (expanded ? Math.min(gridRows, 4) * 44 + 16 : 62) : 0) + 24
  return (
    <AnimatePresence>
      {menu && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu() }} />
          <motion.div
            // enter-অ্যানিমেশন CSS-এ (jelly-in) — framer শুধু exit হ্যান্ডেল করে
            exit={{ opacity: 0, scale: 0.92, y: -4, transition: { duration: 0.14, ease: [0.4, 0, 0.6, 1] } }}
            className="fixed z-[71] flex flex-col items-start gap-2"
            style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 312)), top: Math.max(8, Math.min(menu.y, window.innerHeight - estH)), transformOrigin: '26px -14px' }}
          >
            {/* রিয়্যাকশন-স্ট্রিপ — একই লিকুইড-গ্লাস (রেফারেন্সের rbar) */}
            {menu.reactions && !expanded && (
              <div ref={rbarRef} className="lgm-rbar flex items-center gap-0.5">
                {TG_QUICK_REACTIONS.map((em, i) => (
                  <button key={em}
                    onClick={() => { closeMenu(); menu.reactions!.onPick(em) }}
                    className="relative z-[1] w-[38px] h-[42px] rounded-[14px] flex items-center justify-center transition-transform duration-300 hover:-translate-y-1 hover:scale-[1.28] active:scale-90"
                    style={{ animation: 'lgm-item-in .5s cubic-bezier(.2,.9,.25,1.15) backwards', animationDelay: `${i * 35 + 100}ms` }}
                  >
                    <Emoji char={em} size={26} />
                  </button>
                ))}
                {menu.reactions.more && menu.reactions.more.length > 0 && (
                  <button onClick={() => setExpanded(true)} title="More"
                    className="relative z-[1] w-9 h-[42px] rounded-[14px] text-slate-500 dark:text-slate-300 flex items-center justify-center transition">
                    <IcChevD size={17} />
                  </button>
                )}
              </div>
            )}
            {/* এক্সপ্যান্ডেড রিয়্যাকশন গ্রিড — সব ইমোজি এখানে দেখা যায় (৮-কলাম) */}
            {menu.reactions && expanded && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.15, ease: [0.2, 0.9, 0.3, 1.2] }}
                className="lgm-rbar"
                style={{ padding: 8 }}
              >
                <div className="relative z-[1] grid grid-cols-8 gap-0.5 max-h-[176px] overflow-y-auto">
                  {(menu.reactions.more || menu.reactions.emojis).map((em) => (
                    <button key={em}
                      onClick={() => { closeMenu(); menu.reactions!.onPick(em) }}
                      className="w-[38px] h-[42px] rounded-[14px] flex items-center justify-center transition-transform duration-300 hover:-translate-y-1 hover:scale-[1.28] active:scale-90">
                      <Emoji char={em} size={26} />
                    </button>
                  ))}
                </div>
                <button onClick={() => setExpanded(false)}
                  className="relative z-[1] mt-1 w-full flex items-center justify-center py-1 rounded-[14px] text-slate-400 hover:bg-white/50 dark:hover:bg-white/10 transition">
                  <IcChevD size={15} className="rotate-180" />
                </button>
              </motion.div>
            )}
            {/* মেনু-সারি — লিকুইড-গ্লাস (রেফারেন্সের .glass.menu হুবহু, min-w ২৩৬px) */}
            <GlassMenu style={{ minWidth: 236 }}>
              {menu.items.map((it, i) => (
                <GlassItem
                  key={i}
                  index={i}
                  icon={it.icon}
                  label={it.label}
                  danger={it.danger}
                  onClick={() => { closeMenu(); it.onClick() }}
                />
              ))}
            </GlassMenu>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-11 h-6.5 rounded-full p-0.5 transition-colors h-7 ${on ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'}`}
    >
      <motion.div layout className="w-6 h-6 rounded-full bg-white shadow" animate={{ x: on ? 18 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
    </button>
  )
}

export function EmptyState({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-3">
      <div className="w-16 h-16 rounded-2xl bg-slate-200/60 dark:bg-slate-800 flex items-center justify-center text-slate-400">{icon}</div>
      <div className="font-semibold text-slate-600 dark:text-slate-300">{title}</div>
      {sub && <div className="text-sm text-slate-400 max-w-xs">{sub}</div>}
    </div>
  )
}
