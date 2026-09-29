// মেসেজ কম্পোজার — টেলিগ্রাম-স্টাইল ইনপুট-বার: বামে ক্লিপ, মাঝে ইনপুট,
// ডানে ইমোজি + মাইক/সেন্ড + লাইক। ফাইল/ছবি/ভিডিও (2GB), ভয়েস রেকর্ড,
// রিপ্লাই প্রিভিউ, টাইপিং ইন্ডিকেটর, ডিসঅ্যাপিয়ারিং মোড।
//
// 🆕 এই ভার্সনে:
//  • ইমোজি/ক্লিপ আইকনে হোভার করলেই পপওভার খোলে, কার্সর সরালে বন্ধ (ক্লিকও চলে)
//  • মাইকে হোভার/ক্লিকে 🔴 লাল + 🔵 নীল দুটি বাটন — লাল = ওপাশে অটো-প্লে ভয়েস,
//    নীল = সাধারণ ভয়েস মেসেজ
//  • Messenger-স্টাইল লাইক-বাটন (ডানে) — ট্যাপে ইনস্ট্যান্ট পাঠায়, লংপ্রেসে
//    এই চ্যাটের জন্য ইমোজি বদলানো যায় (প্রোফাইল থেকেও বদলানো যায়)
//  • "@date" টাইপ করলে মিনি ক্যালেন্ডার — তারিখ বাছলে dd/mm/yyyy বসে যায়
import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Chat } from '../../types'
import { useChats } from '../../stores/chats'
import { useAuth } from '../../stores/auth'
import { useUi } from '../../stores/ui'
import { useRecorder } from '../../hooks/useRecorder'
import { uploadEncrypted } from '../../lib/media'
import { makeThumb } from '../../crypto/files'
import { cls, debounce } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import { Emoji, emojiUrl, EMOJI_CATEGORIES, STICKER_SET, getRecentEmojis, bumpEmojis } from '../../lib/emoji'
import { IcSmile, IcClip, IcMic, IcSend, IcX, IcImage, IcDoc, IcTimer, IcCamera, IcChevD } from '../../lib/icons'

// লাইক-বাটনের কুইক-পিক সেট (Messenger-এর মতো কমনগুলো)
const REACTIONS_LIKE = ['👍', '❤️', '😂', '😮', '😢', '😍', '🔥', '🎉', '🥰', '👏', '💯', '🤩', '😎', '🤔', '😅', '🙌', '🙏', '💀', '👀', '🤝', '💪', '✨', '🌈', '⭐', '🥳', '😴', '🤗', '😼']

// ── @date মিনি-ক্যালেন্ডার (কমপ্যাক্ট, মিনিমাল — "বেশি কিউট" নয়) ──
const WD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
function MiniCalendar({ onPick, onClose }: { onPick: (d: Date) => void; onClose: () => void }) {
  const [view, setView] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const today = new Date()
  const y = view.getFullYear(), m = view.getMonth()
  const first = new Date(y, m, 1)
  const start = (first.getDay() + 6) % 7 // সোমবার = ০
  const days = new Date(y, m + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(start).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="absolute bottom-full right-2 mb-2 z-30 rounded-2xl glass shadow-xl p-2.5 w-[236px]"
    >
      <div className="flex items-center justify-between px-1 pb-1.5">
        <button className="w-6 h-6 rounded-full hover:bg-slate-200/70 dark:hover:bg-white/10 text-slate-500 rotate-90"
          onClick={() => setView(new Date(y, m - 1, 1))}><IcChevD size={15} /></button>
        <div className="text-[12.5px] font-semibold">{view.toLocaleString('en', { month: 'long', year: 'numeric' })}</div>
        <button className="w-6 h-6 rounded-full hover:bg-slate-200/70 dark:hover:bg-white/10 text-slate-500 -rotate-90"
          onClick={() => setView(new Date(y, m + 1, 1))}><IcChevD size={15} /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-slate-400 pb-1">
        {WD.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {cells.map((d, i) => {
          const isToday = d === today.getDate() && m === today.getMonth() && y === today.getFullYear()
          return (
            <button key={i} disabled={!d}
              onClick={() => d && onPick(new Date(y, m, d))}
              className={cls('h-7 rounded-lg text-[12px] font-medium transition',
                !d && 'opacity-0',
                d && 'hover:bg-brand-500/15 text-slate-700 dark:text-slate-200',
                isToday && 'bg-brand-600 text-white hover:bg-brand-600')}>
              {d || ''}
            </button>
          )
        })}
      </div>
      <div className="flex justify-end pt-1.5">
        <button onClick={onClose} className="text-[11px] px-2.5 py-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10">✕</button>
      </div>
    </motion.div>
  )
}

export default function Composer({ chat }: { chat: Chat }) {
  const [hasText, setHasText] = useState(false)
  const [pop, setPop] = useState<null | 'emoji' | 'sticker' | 'attach'>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [showCal, setShowCal] = useState(false)
  // 🔴🔵 ভয়েস-মোড: লাল = ওপাশে অটো-প্লে, নীল = সাধারণ
  const [voiceMode, setVoiceMode] = useState<'red' | 'blue' | null>(null)
  const [showVoicePair, setShowVoicePair] = useState(false)
  // লাইক-বাটন পিকার (লংপ্রেস)
  const [likePicker, setLikePicker] = useState(false)
  const likeHold = useRef<any>(null)
  const ceRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dateRange = useRef<Range | null>(null)
  const rec = useRecorder()
  const { sendDraft, setTyping, setReplying, jumpToMessage, patchChatState } = useChats.getState()
  const replyingTo = useChats((s) => s.replyingTo)
  const toast = useUi((s) => s.toast)
  const t = useT()

  // লাইক-বাটনের ইমোজি: এই চ্যাটের ওভাররাইড → গ্লোবাল ডিফল্ট → 👍 (Messenger)
  const likeEmoji = chat.likeEmoji || useAuth.getState().settings?.likeEmoji || '👍'

  // হোভার-পপওভার টাইমার — কার্সর সরালে আধা-সেকেন্ড দেরিতে বন্ধ
  const hoverTimer = useRef<any>(null)
  const openHover = (p: 'emoji' | 'attach') => {
    clearTimeout(hoverTimer.current)
    setRecent(getRecentEmojis())
    setPop(p)
  }
  const closeHover = () => {
    clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setPop(null), 350)
  }

  // টাইপিং ইভেন্ট (থ্রটলড)
  const typingOn = useRef(debounce(() => setTyping(true), 150))
  const typingOff = useRef(debounce(() => setTyping(false), 2200))
  useEffect(() => () => setTyping(false), [])

  // ── contentEditable ইনপুট-হেল্পার ──
  function nodeText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const e = node as HTMLElement
    if (e.tagName === 'BR') return '\n'
    if (e.tagName === 'IMG') return e.getAttribute('alt') || ''
    let out = ''
    for (const child of Array.from(e.childNodes)) out += nodeText(child)
    // DIV/P = নতুন লাইনের ব্লক (Enter চাপলে ব্রাউজার এগুলো বানায়)
    if (e.tagName === 'DIV' || e.tagName === 'P') out += '\n'
    return out
  }

  function extractText(): string {
    const el = ceRef.current
    if (!el) return ''
    let out = ''
    for (const node of Array.from(el.childNodes)) out += nodeText(node)
    return out.replace(/\n+$/, '')
  }

  function placeCaretEnd(el: HTMLElement) {
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
  }

  // শেষের "@date" টোকেন খুঁজে তার উপর রেঞ্জ বানাই — পিক করলে ওই রেঞ্জ
  // replace হয়ে dd/mm/yyyy বসে যায় (বাকি কনটেন্ট অক্ষত থাকে)।
  function findTrailingDateToken(): boolean {
    const el = ceRef.current
    if (!el) return false
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const texts: Text[] = []
    while (walker.nextNode()) texts.push(walker.currentNode as Text)
    let combined = ''
    for (const tn of texts) combined += tn.nodeValue || ''
    if (!/@date\s*$/i.test(combined)) return false
    // শেষ নন-স্পেস অবস্থান পর্যন্ত টোকেন-ইনডেক্স হিসাব
    const m = combined.match(/@date(?=\s*$)/i)
    if (!m) return false
    const tokenStart = (m.index ?? 0)
    let offset = 0
    for (const tn of texts) {
      const len = (tn.nodeValue || '').length
      const s = Math.max(offset, tokenStart), e2 = Math.min(offset + len, tokenStart + 5)
      if (s < e2) {
        const r = document.createRange()
        r.setStart(tn, s - offset)
        r.setEnd(tn, e2 - offset)
        dateRange.current = r
        return true
      }
      offset += len
    }
    return false
  }

  function insertDate(d: Date) {
    const el = ceRef.current
    const r = dateRange.current
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    const fmt = `${dd}/${mm}/${yyyy}`
    if (el && r) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
      try { document.execCommand('insertText', false, fmt + ' ') } catch {
        r.deleteContents()
        r.insertNode(document.createTextNode(fmt + ' '))
      }
    }
    setShowCal(false)
    dateRange.current = null
    afterInput()
  }

  // ইমোজি-আর্টওয়ার্ক <img> ক্যারেটে বসায় (ক্যারেট না থাকলে শেষে)
  function insertEmoji(char: string) {
    const el = ceRef.current
    if (!el) return
    el.focus()
    const img = document.createElement('img')
    img.src = emojiUrl(char, 64)
    img.alt = char
    img.className = 'ce-emoji'
    img.draggable = false
    let ok = false
    try { ok = document.execCommand('insertHTML', false, img.outerHTML) } catch {}
    if (!ok) {
      el.appendChild(img)
      placeCaretEnd(el)
    }
    afterInput()
  }

  function afterInput() {
    const txt = extractText()
    setHasText(!!txt.trim())
    // "@date" ট্রিগার — লাইভ চেক
    setShowCal(findTrailingDateToken())
    typingOn.current()
    typingOff.current()
  }

  function onInput() { afterInput() }

  function onKeyDown(e: React.KeyboardEvent) {
    // ESC → পপওভার বন্ধ (গ্লোবাল ESC-চেইনের অংশ)
    if (e.key === 'Escape' && (pop || showCal)) { setPop(null); setShowCal(false); e.preventDefault(); return }
    // Enter = পাঠানো, Shift+Enter = নতুন লাইন
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing) {
      e.preventDefault()
      send()
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    // প্লেইন-টেক্সট ছাড়া কিছু ঢুকতে দিই না (ফরম্যাটিং-জাঙ্ক এড়াতে)
    e.preventDefault()
    const txt = e.clipboardData.getData('text/plain')
    if (txt) {
      try { document.execCommand('insertText', false, txt) } catch {}
      afterInput()
    }
  }

  async function send() {
    const el = ceRef.current
    const body = extractText().trim()
    if (!body) return
    if (el) { el.innerHTML = ''; placeCaretEnd(el) }
    setHasText(false)
    setShowCal(false)
    setTyping(false)
    await sendDraft(chat.id, { type: 'text', body, replyTo: replyingTo ? { id: replyingTo.id, body: replyingTo.body?.slice(0, 120) || `(${replyingTo.type})`, senderId: replyingTo.senderId } : undefined, ttl: chat.ttl })
  }

  // লাইক-বাটন — ট্যাপে ইনস্ট্যান্ট পাঠায় (Messenger-স্টাইল)
  async function sendLike() {
    await sendDraft(chat.id, { type: 'text', body: likeEmoji, ttl: chat.ttl })
    bumpEmojis(likeEmoji)
  }
  // লংপ্রেস → এই চ্যাটের লাইক-ইমোজি বদলানোর পিকার
  function likeDown() {
    likeHold.current = setTimeout(() => { setLikePicker(true); if (navigator.vibrate) navigator.vibrate(15) }, 480)
  }
  function likeUp() { clearTimeout(likeHold.current) }

  async function pickFile(kind: 'media' | 'file') {
    setPop(null)
    fileRef.current?.setAttribute('data-kind', kind)
    fileRef.current?.click()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 2 * 1024 * 1024 * 1024) { toast(t('maxSize2gb')); return }
    setUploading(true)
    try {
      const kind = fileRef.current?.getAttribute('data-kind')
      const isImg = file.type.startsWith('image/')
      const isVid = file.type.startsWith('video/')
      const meta = await uploadEncrypted(file, file.name, file.type || 'application/octet-stream')
      if (isImg) {
        const img = await new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = URL.createObjectURL(file) })
        if (img) { meta.w = img.naturalWidth; meta.h = img.naturalHeight }
      }
      const type = isImg ? 'image' : isVid ? 'video' : kind === 'media' ? (isVid ? 'video' : 'image') : 'file'
      await sendDraft(chat.id, { type: type as any, media: meta, ttl: chat.ttl })
    } catch (err: any) {
      toast(t('uploadFailed', { msg: err.message || '' }))
    } finally {
      setUploading(false)
    }
  }

  // 🔴🔵 ভয়েস — মোড বেছে রেকর্ড শুরু
  async function startVoice(mode: 'red' | 'blue') {
    setShowVoicePair(false)
    const ok = await rec.start()
    if (!ok) { toast(t('micDenied')); return }
    setVoiceMode(mode)
  }

  async function finishRecording(discard: boolean) {
    const mode = voiceMode
    const blob = await rec.stop()
    setVoiceMode(null)
    if (discard || !blob) return
    const meta = await uploadEncrypted(blob, `voice-${Date.now()}.webm`, blob.type)
    meta.dur = rec.seconds
    await sendDraft(chat.id, { type: 'voice', media: meta, ttl: chat.ttl, autoPlay: mode === 'red' })
  }

  return (
    <div className="relative px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {/* রিপ্লাই প্রিভিউ — টেলিগ্রাম-স্টাইল: ইনপুটের উপরে, বাম-বর্ডার-সহ কার্ড।
          ক্লিক করলে অরিজিনাল মেসেজে জাম্প + ব্লিংক */}
      <AnimatePresence>
        {replyingTo && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mx-1 mb-1.5">
            <button
              onClick={() => jumpToMessage(chat.id, replyingTo.id)}
              className="w-full flex items-center gap-2.5 pl-2.5 pr-2 py-1.5 rounded-xl glass border border-slate-200/80 dark:border-white/10 text-left hover:bg-white/85 dark:hover:bg-white/[0.8] transition-colors"
            >
              <span className="w-[3px] self-stretch rounded-full bg-brand-500 shrink-0" />
              <div className="flex-1 min-w-0 text-[13px] py-0.5">
                <div className="font-semibold text-brand-500">{t('replyLabel')}</div>
                <div className="truncate opacity-70">{replyingTo.body || `(${replyingTo.type})`}</div>
              </div>
              <span onClick={(e) => { e.stopPropagation(); setReplying(null) }} className="opacity-50 hover:opacity-100 p-1.5"><IcX size={16} /></span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* রেকর্ডিং ব্যানার */}
      {rec.recording ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white dark:bg-[#23252b] border border-slate-200/80 dark:border-white/10 shadow-sm">
          <span className="text-lg">{voiceMode === 'red' ? '🔴' : '🔵'}</span>
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-sm font-medium tabular-nums">{Math.floor(rec.seconds / 60)}:{String(rec.seconds % 60).padStart(2, '0')}</span>
          <span className="text-xs opacity-50">{voiceMode === 'red' ? t('recordingAuto') : t('recording')}</span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => { rec.cancel(); setVoiceMode(null) }} className="px-3 py-1.5 rounded-xl text-sm bg-slate-100 dark:bg-white/10">{t('cancel')}</button>
            <button onClick={() => finishRecording(false)} className="px-4 py-1.5 rounded-xl text-sm bg-brand-600 text-white font-medium">{t('sendBtn')}</button>
          </div>
        </motion.div>
      ) : (
        /* টেলিগ্রাম-স্টাইল ইনপুট-বার: [ক্লিপ] [ইনপুট…] [ইমোজি] [মাইক/সেন্ড] [লাইক] */
        <div className="flex items-end gap-1 rounded-[22px] glass border border-slate-200/80 dark:border-white/10 shadow-[0_1px_6px_rgba(0,0,0,.07)] pl-1 pr-1 py-1">
          <input ref={fileRef} type="file" className="hidden" onChange={onFile} />

          {/* অ্যাটাচমেন্ট (ক্লিপ) — বামে; হোভারেই মেনু খোলে, সরালে বন্ধ */}
          <div
            className="shrink-0"
            onMouseEnter={() => openHover('attach')}
            onMouseLeave={closeHover}
          >
            <button onClick={() => (pop === 'attach' ? setPop(null) : openHover('attach'))}
              className={cls('w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition', pop === 'attach' ? 'text-brand-500 bg-brand-500/10' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200')}>
              <IcClip size={21} />
            </button>
          </div>

          {/* ইনপুট — contentEditable: ইমোজি Apple-artwork ছবি হিসেবে দেখায়।
              📱 মোবাইলে ফন্ট ১৬px — iOS Safari ফোকাসে পেজ জুম করে না
              (<16px হলে জুম করে — টাইপিং-এ বিরক্তিকর)। লম্বা টেক্সটে ভেতরেই
              স্ক্রল-বার (overscroll-contain সহ)। */}
          <div className="relative flex-1 min-w-0">
            {!hasText && !rec.recording && (
              <div className="absolute left-1 top-1/2 -translate-y-1/2 pointer-events-none text-[16px] sm:text-[14.5px] text-slate-400 select-none">
                {t('writeMessage')}
              </div>
            )}
            <div
              ref={ceRef}
              contentEditable
              role="textbox"
              aria-label={t('writeMessage')}
              suppressContentEditableWarning
              onInput={onInput}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={() => { if (!extractText().trim()) setHasText(false) }}
              className="ce-input w-full px-1 py-2.5 text-[16px] sm:text-[14.5px] leading-relaxed max-h-[120px] sm:max-h-[160px] overflow-y-auto overscroll-contain outline-none break-words"
            />

            {/* @date মিনি-ক্যালেন্ডার */}
            <AnimatePresence>
              {showCal && <MiniCalendar onPick={insertDate} onClose={() => { setShowCal(false); dateRange.current = null }} />}
            </AnimatePresence>
          </div>

          {chat.ttl ? <span className="text-brand-500 self-center mr-1" title={t('disappModeOn')}><IcTimer size={17} /></span> : null}

          {/* ইমোজি — ডানে, ইনপুটের পাশে; হোভারেই খোলে, সরালে বন্ধ */}
          <div
            className="shrink-0"
            onMouseEnter={() => openHover('emoji')}
            onMouseLeave={closeHover}
          >
            <button onClick={() => (pop === 'emoji' || pop === 'sticker' ? setPop(null) : openHover('emoji'))}
              className={cls('w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition', pop === 'emoji' || pop === 'sticker' ? 'text-brand-500 bg-brand-500/10' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200')}>
              <IcSmile size={21} />
            </button>
          </div>

          {/* মাইক / সেন্ড — ডানে রাউন্ড বাটন। মাইকে হোভার/ক্লিক করলে 🔴🔵 জোড়া ওপেন */}
          {hasText ? (
            <motion.button whileTap={{ scale: 0.85 }} onClick={send}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white flex items-center justify-center shadow-md shadow-brand-500/30 shrink-0">
              <IcSend size={18} />
            </motion.button>
          ) : (
            <div
              className="relative shrink-0"
              onMouseEnter={() => setShowVoicePair(true)}
              onMouseLeave={() => setShowVoicePair(false)}
            >
              <AnimatePresence mode="wait">
                {showVoicePair ? (
                  <motion.div key="pair"
                    initial={{ opacity: 0, scale: 0.7, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                    className="flex gap-1.5 items-center">
                    <motion.button whileTap={{ scale: 0.85 }} whileHover={{ scale: 1.08 }}
                      onClick={() => startVoice('red')} title={t('voiceAutoHint')}
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-rose-500 to-red-600 text-white flex items-center justify-center shadow-md shadow-rose-500/40">
                      <IcMic size={19} />
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.85 }} whileHover={{ scale: 1.08 }}
                      onClick={() => startVoice('blue')} title={t('voiceNormalHint')}
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white flex items-center justify-center shadow-md shadow-brand-500/30">
                      <IcMic size={19} />
                    </motion.button>
                  </motion.div>
                ) : (
                  <motion.button key="mic" whileTap={{ scale: 0.85 }}
                    onClick={() => setShowVoicePair(true)}
                    initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white flex items-center justify-center shadow-md shadow-brand-500/30">
                    <IcMic size={19} />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* 🧡 Messenger-স্টাইল লাইক-বাটন — সবসময় ডানে-কোণে।
              ট্যাপ = পাঠায়, লংপ্রেস = এই চ্যাটের ইমোজি বদল */}
          <div className="relative shrink-0">
            <motion.button
              whileTap={{ scale: 0.8 }}
              onClick={() => { if (!likePicker) sendLike() }}
              onPointerDown={likeDown}
              onPointerUp={likeUp}
              onPointerLeave={likeUp}
              onContextMenu={(e) => { e.preventDefault(); setLikePicker(true) }}
              title={t('likeBtnHint')}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/10 transition"
            >
              <Emoji char={likeEmoji} size={26} animated />
            </motion.button>
            <AnimatePresence>
              {likePicker && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setLikePicker(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.94 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    className="absolute bottom-full right-0 mb-2 z-30 rounded-2xl glass shadow-xl p-2.5 w-[228px]"
                  >
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide px-1 pb-1.5">{t('likePickTitle')}</div>
                    <div className="grid grid-cols-7 gap-0.5">
                      {REACTIONS_LIKE.map((e) => (
                        <button key={e} onClick={() => { patchChatState(chat.id, { likeEmoji: e }); setLikePicker(false); toast(t('likeUpdatedToast')) }}
                          className={cls('rounded-lg p-1 flex items-center justify-center transition-transform hover:scale-110', e === likeEmoji && 'bg-brand-500/15')}>
                          <Emoji char={e} size={22} />
                        </button>
                      ))}
                    </div>
                    {chat.likeEmoji && (
                      <button onClick={() => { patchChatState(chat.id, { likeEmoji: '' }); setLikePicker(false); toast(t('likeResetToast')) }}
                        className="mt-2 w-full py-1.5 rounded-xl text-[11.5px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">
                        {t('likeResetDefault')}
                      </button>
                    )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* পপওভার — ইমোজি/স্টিকার/অ্যাটাচ (গ্লাসমরফিজম) */}
      <AnimatePresence>
        {pop && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onMouseEnter={() => clearTimeout(hoverTimer.current)}
            onMouseLeave={closeHover}
            className="absolute bottom-full left-2 right-2 mb-2 rounded-2xl glass overflow-hidden z-20"
          >
            {pop === 'emoji' && (
              <div>
                <div className="max-h-64 overflow-y-auto px-2 py-2">
                  {/* সাম্প্রতিক — প্রায়ই ব্যবহৃত ইমোজি সবার আগে (টেলিগ্রাম) */}
                  {recent.length > 0 && (
                    <div>
                      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide sticky top-0 bg-white/60 dark:bg-[#1c1d21]/60 backdrop-blur">{t('recentEmojis')}</div>
                      <div className="grid grid-cols-8 gap-0.5">
                        {recent.map((e, i) => (
                          <button key={e + i} onClick={() => { insertEmoji(e); bumpEmojis(e); setRecent(getRecentEmojis()) }}
                            className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-white/10 transition-transform hover:scale-110 flex items-center justify-center">
                            <Emoji char={e} size={26} animated lazy />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {EMOJI_CATEGORIES.map((cat) => (
                    <div key={cat.label}>
                      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide sticky top-0 bg-white/60 dark:bg-[#1c1d21]/60 backdrop-blur">{cat.label}</div>
                      <div className="grid grid-cols-8 gap-0.5">
                        {cat.emojis.map((e, i) => (
                          <button key={e + i} onClick={() => { insertEmoji(e); bumpEmojis(e) }}
                            className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-white/10 transition-transform hover:scale-110 flex items-center justify-center">
                            <Emoji char={e} size={26} animated lazy />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-slate-100/80 dark:border-white/10 px-3 py-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{t('stickerHint')}</span>
                  <button onClick={() => setPop('sticker')} className="text-xs font-semibold text-brand-600 dark:text-brand-300">{t('stickers')} →</button>
                </div>
              </div>
            )}
            {pop === 'sticker' && (
              <div className="max-h-72 overflow-y-auto p-2">
                <div className="px-2 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{t('stickers')}</div>
                <div className="grid grid-cols-5 gap-1">
                  {STICKER_SET.map((s) => (
                    <button key={s} onClick={async () => { setPop(null); await sendDraft(chat.id, { type: 'sticker', body: s }) }}
                      className="rounded-xl p-2 hover:bg-slate-100 dark:hover:bg-white/10 transition-transform hover:scale-110 flex items-center justify-center">
                      <Emoji char={s} size={52} animated lazy />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {pop === 'attach' && (
              <div className="p-2 grid grid-cols-3 gap-2">
                {[
                  { icon: <IcImage size={22} />, label: t('photo'), fn: () => pickFile('media'), accept: 'image/*' },
                  { icon: <IcCamera size={22} />, label: t('video'), fn: () => pickFile('media'), accept: 'video/*' },
                  { icon: <IcDoc size={22} />, label: t('file2gb'), fn: () => pickFile('file'), accept: '*/*' },
                ].map((a) => (
                  <button key={a.label} onClick={a.fn}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-xl hover:bg-brand-500/10 text-slate-600 dark:text-slate-300 transition">
                    <span className="text-brand-500">{a.icon}</span>
                    <span className="text-xs font-medium">{a.label}</span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {uploading && (
        <div className="absolute inset-x-4 top-0 h-1 rounded-full overflow-hidden bg-brand-500/20">
          <motion.div className="h-full bg-brand-500" animate={{ x: ['-100%', '100%'] }} transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }} style={{ width: '40%' }} />
        </div>
      )}
    </div>
  )
}
