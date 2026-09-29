// 💧 কাস্টম ০-৯ নাম্প্যাড — iPhone লকস্ক্রিনের মতো।
// সিস্টেম কীবোর্ড কখনোই খোলে না (ইনপুট-এলিমেন্টই নেই — শুধু div),
// তাই ফোনের ডিফল্ট কীবোর্ড আনা সম্ভব নয়। গ্লাস-কী, ডিজিট-ডট,
// ব্যাকস্পেস, jelly-প্রেস অ্যানিমেশন।
//
// 💻 ডেস্কটপ/ল্যাপটপ: ফিজিক্যাল কীবোর্ড থেকে ০-৯, Backspace, Enter —
// সব কাজ করে (window keydown লিসেনার; ইনপুট-ফিল্ডে ফোকাস থাকলে হাইজ্যাক করে না)।
//
// ⚡ ইনস্ট্যান্ট-রেসপন্স (মোবাইল-ল্যাগ ফিক্স): ট্যাপ করার **সাথে সাথে** ডিজিট
// দেখা যায় — তিনটা কারণে আগে দেরি লাগত:
//  ১) onClick টাচে-জেসচার শেষ হওয়া পর্যন্ত অপেক্ষা করে (touchend-এর পরেও
//     ফায়ার হয়) → এখন onPointerDown-এই প্রেস হ্যান্ডেল হয় (আঙুল ছোঁার মুহূর্তে)
//  ২) প্যারেন্ট (AuthScreen — ভারী গ্লাস/ব্লার-ইফেক্ট) রি-রেন্ডারের পেছনে
//     ডট-রেন্ডার আটকে থাকত → এখন লোকাল mirror-স্টেট + flushSync: ডিজিটটা
//     সিঙ্ক্রোনাসলি কমিট হয়ে যায়, তারপর প্যারেন্ট-আপডেট নিজের ছন্দে আসে
//  ৩) ক্লিক-ডাবল-ফায়ার গার্ড — pointerdown-এ হ্যান্ডেল হলে পরের click-টা
//     নীরবে বাদ (কীবোর্ড-Enter প্যাথ কাজ করা থাকে)
//
// ● ডট-নিয়ম: শুরুতে কোনো ফাঁকা-ডট নেই — সংখ্যা ঢোকালেই ডট আঁকা হয়।
//
// ব্যবহার: <PinPad value={pin} onChange={setPin} length={6} ... />
import React, { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { motion } from 'framer-motion'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

export default function PinPad({
  value,
  onChange,
  max = 8,
  minLength = 4,
  secure = true,
  onEnter,
  disabled = false,
}: {
  value: string
  onChange: (v: string) => void
  max?: number
  minLength?: number
  secure?: boolean            // false হলে ডিজিটগুলো দেখা যায় (user-ID-তে)
  onEnter?: () => void
  disabled?: boolean
}) {
  // ⚡ ডিসপ্লে-মিরর: লোকাল স্টেট — প্যারেন্টের value পিছু নেয়, কিন্তু প্রেসের
  // মুহূর্তে flushSync দিয়ে সাথে সাথে আপডেট হয় (ভারী প্যারেন্ট-রি-রেন্ডারের
  // জন্য অপেক্ষা করে না)। প্যারেন্ট রিসেট/ব্যাক-নেভিগেশনে value ছোট হয়ে
  // গেলে useEffect মিররকে সিঙ্ক করে দেয়।
  const [mirror, setMirror] = useState(value)
  useEffect(() => { setMirror(value) }, [value])
  const ref = useRef({ mirror, onChange, onEnter, disabled, max })
  ref.current = { mirror, onChange, onEnter, disabled, max }

  function press(k: string) {
    const { mirror, onChange, onEnter, disabled, max } = ref.current
    if (disabled) return
    if (k === '⌫') {
      if (!mirror) return
      const back = mirror.slice(0, -1)
      flushSync(() => setMirror(back))
      onChange(back)
      return
    }
    if (!k) return
    if (mirror.length >= max) return
    const next = mirror + k
    // ডিজিট/ডট এক্ষুনি পেইন্ট — প্যারেন্ট-রি-রেন্ডার যত ভারীই হোক
    flushSync(() => setMirror(next))
    onChange(next)
    // ম্যাক্স-দৈর্ঘ্যে পৌঁছালে অটো-এন্টার নয় — ব্যবহারকারী নিজে Next চাপবে
    // (iPhone-এর মতো নিয়ন্ত্রণ ব্যবহারকারীর হাতে)
    if (next.length === max && onEnter) {
      // ছোট একটা বিরতি — শেষ ডিজিটের পপ-অ্যানিমেশনটা দেখা যাক
      setTimeout(() => onEnter(), 180)
    }
  }

  // ── 💻 ফিজিক্যাল কীবোর্ড সাপোর্ট (ল্যাপটপ/ডেস্কটপ) ──
  // ফোনে ফিজিক্যাল কীবোর্ড নেই → এখানে কিছুই হয় না, আর ইনপুট-এলিমেন্ট
  // না থাকায় মোবাইলের ডিফল্ট কীবোর্ডও কখনো খোলে না — দুই দুনিয়া মিলেমিশে।
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (ref.current.disabled) return
      const tgt = e.target as HTMLElement | null
      // অন্য টেক্সট-ফিল্ডে টাইপ করছলে হাইজ্যাক নয় (যেমন পাসওয়ার্ড ভেরিফাই বক্স)
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        press(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        press('⌫')
      } else if (e.key === 'Enter') {
        // ফোকাসড বাটনে Enter → তার নিজের ক্লিক-ই চলুক (double-fire এড়াতে)
        if (tgt && tgt.tagName === 'BUTTON') return
        ref.current.onEnter?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ⚡ ক্লিক-ডাবল-ফায়ার গার্ড: pointerdown-এ প্রেস হ্যান্ডেল হয়ে গেলে পরের
  // click ইভেন্টটা বাদ; কীবোর্ড-Enter/অ্যাসিস্টিভ-টেক প্যাথে click একা এলে চলে।
  const lastPtrTs = useRef(0)

  return (
    <div className="select-none w-full max-w-[300px] mx-auto">
      {/* ডিজিট-ডট / দৃশ্যমান সংখ্যা — শুরুতে ফাঁকা, সংখ্যা ঢোকালেই আঁকা হয় */}
      <div className="flex items-center justify-center gap-2.5 h-12 mb-5" aria-label="entered digits">
        {Array.from({ length: mirror.length }).map((_, i) => {
          const current = i === mirror.length - 1
          return (
            <div key={i} className={`${secure ? 'w-[13px]' : 'w-[18px]'} flex items-center justify-center`}>
              {secure ? (
                <motion.div
                  initial={{ scale: 0.2, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 700, damping: 26 }}
                  className={`rounded-full transition-colors ${current ? 'bg-slate-700 dark:bg-white' : 'bg-slate-400 dark:bg-slate-300'}`}
                  style={{ width: 13, height: 13 }}
                />
              ) : (
                <motion.span
                  initial={{ scale: 0.3, opacity: 0, y: 4 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 700, damping: 28 }}
                  className="text-[19px] font-semibold tabular-nums text-slate-800 dark:text-slate-100"
                >
                  {mirror[i]}
                </motion.span>
              )}
            </div>
          )
        })}
      </div>

      {/* কীগ্রিড — ৩×৪, iPhone-বিন্যাস */}
      <div className="grid grid-cols-3 gap-[14px] max-w-[264px] mx-auto">
        {KEYS.map((k, i) =>
          k === '' ? (
            <div key={i} />
          ) : (
            <motion.button
              key={i}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              whileTap={{ scale: 0.82 }}
              transition={{ type: 'spring', stiffness: 600, damping: 20 }}
              onPointerDown={() => { lastPtrTs.current = Date.now(); press(k) }}
              onClick={() => { if (Date.now() - lastPtrTs.current < 700) return; press(k) }}
              aria-label={k === '⌫' ? 'backspace' : k}
              className={`lg-key relative ${k === '⌫' ? 'lg-key-alt' : ''}`}
            >
              {k === '⌫' ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 6H11l-8.5 6L11 18h11a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0022 6z" />
                  <path d="M13.5 9.5l4 5M17.5 9.5l-4 5" />
                </svg>
              ) : (
                <span className="text-[26px] font-medium tabular-nums">{k}</span>
              )}
            </motion.button>
          ),
        )}
        {/* মিড-গ্রিড ফাঁকা ঘর (iPhone-এ যেমন ফেস-আইডি/খালি থাকে) নয় —
            এখানে নিচে-মাঝে ছোট ডট-এম্ফাসিস নেই; ব্যাকস্পেস-ই যথেষ্ট */}
      </div>

      {/* ন্যূনতম-দৈর্ঘ্যের হিন্ট + (ডেস্কটপে) কীবোর্ড টাইপ-হিন্ট */}
      <div className="text-center text-[12px] text-slate-400 dark:text-slate-500 mt-4 h-4 tabular-nums">
        {mirror.length > 0 && mirror.length < minLength
          ? `${mirror.length}/${minLength}`
          : ''}
        {mirror.length === 0 && (
          <span className="lg-kbd-hint">⌨ type or tap</span>
        )}
      </div>
    </div>
  )
}
