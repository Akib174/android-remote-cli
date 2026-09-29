// 🔐 লগইন / সাইনআপ — পুরো লিকুইড-গ্লাস ডিজাইনে নতুন ফ্লো।
//
// ফ্লো:
//  • ওয়েলকাম — উপরে "Log in", নিচে "Sign up" (দুটো গ্লাস-প্যানেল)
//  • লগইন — username+password  ─ নিচে ─  user-ID+passcode (কাস্টম নাম্প্যাড)
//  • সাইনআপ-উইজার্ড — নাম → ইউজারনেম (unique) → ফোন (স্কিপযোগ্য) →
//    ইমেইল (স্কিপযোগ্য) → পাসওয়ার্ড → কনফার্ম → ইউজার-আইডি (নাম্প্যাড,
//    min 4, unique) → পাসকোড (নাম্প্যাড, 6-8) → পাসকোড-কনফার্ম →
//    শেষ-ধাপ (নো-রিকভারি টিক) → অ্যাকাউন্ট
//
// প্রতিটি ধাপ-বদল smooth slide+jelly অ্যানিমেশনে; নাম্প্যাড iPhone
// লকস্ক্রিনের মতো (কাস্টম গ্লাস-কী — ফোনের ডিফল্ট কীবোর্ড কখনোই খোলে না)।
// কার্ড: ফ্রস্টেড-গ্লাস + ঘূর্ণায়মান রেইনবো-রিম + কার্সার-লাইট + jelly-in।
import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../stores/auth'
import { api } from '../../api/client'
import { Spinner } from '../common'
import { useT } from '../../lib/i18n'
import { useUi } from '../../stores/ui'
import { IcLock, IcCheck, IcEye, IcEyeOff, IcMoon, IcSun, IcBack, IcUser } from '../../lib/icons'
import PinPad from './PinPad'
import { useRefraction } from '../GlassMenu'

type Screen = 'welcome' | 'login' | 'signup'
type LoginMethod = 'pass' | 'pin'
type PinStage = 'uid' | 'passcode'

// সাইনআপ-ধাপের তালিকা (প্রগ্রেস-ডটের জন্য)
const STEP_KEYS = ['name', 'username', 'phone', 'email', 'password', 'confirm', 'uid', 'passcode', 'passcode2', 'finish'] as const
type Step = typeof STEP_KEYS[number]

const slide: any = {
  initial: (dir: number) => ({ opacity: 0, x: dir * 46, scale: 0.97 }),
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -46, scale: 0.97 }),
  transition: { type: 'spring' as const, stiffness: 380, damping: 33 },
}

export default function AuthScreen() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const t = useT()
  const theme = useUi((s) => s.theme)
  const toggleTheme = useUi((s) => s.toggleTheme)
  const cardRef = useRef<HTMLDivElement>(null)
  // 🌈 Chromium-এ আসল কাচ-রিফ্র্যাকশন (বড় কার্ডেও)
  useRefraction(cardRef, 'menu')

  // ── কার্সার-লাইট — কার্ডে আলোর দাগ পিছু পিছু চলে ──
  function onCardMove(e: React.PointerEvent) {
    const el = cardRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--lg-mx', (e.clientX - r.left).toFixed(1) + 'px')
    el.style.setProperty('--lg-my', (e.clientY - r.top).toFixed(1) + 'px')
  }

  return (
    // 🩹 মোবাইল-স্ক্রল ফিক্স: আগে রুট-ডিভটা h-full + overflow-hidden + flex-center
    // ছিল — কার্ড ভিউপোর্টের চেয়ে লম্বা হলে (নাম্প্যাড-ধাপ, কীবোর্ড-ওপেন) দুই
    // দিক থেকেই কেটে যেত, স্ক্রলের কোনো উপায় ছিল না (ডেস্কটপ-মোড লাগত)।
    // এখন: ব্যাকগ্রাউন্ড (অর্ব/টগল) ফিক্সড থাকে, আর কনটেন্ট-লেয়ার
    // min-h-full + overflow-y-auto — জায়গা থাকলে সেন্টার, না থাকলে স্ক্রল।
    <div className="h-full w-full relative overflow-hidden chat-bg">
      {/* কোণায় লাইট/ডার্ক টগল */}
      <motion.button
        whileTap={{ scale: 0.85, rotate: 20 }}
        onClick={toggleTheme}
        title={theme === 'dark' ? t('lightTheme') : t('darkTheme')}
        className="absolute top-4 right-4 z-20 w-11 h-11 rounded-full lgm-chip flex items-center justify-center text-slate-600 dark:text-slate-200"
      >
        <AnimatePresence mode="wait">
          <motion.span key={theme} initial={{ rotate: -90, opacity: 0, scale: 0.5 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: 90, opacity: 0, scale: 0.5 }} transition={{ duration: 0.25 }}>
            {theme === 'dark' ? <IcSun size={20} /> : <IcMoon size={20} />}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      {/* অ্যানিমেটেড ব্লার অর্ব — গ্লাসের পেছনে রঙিন আলো */}
      <motion.div className="absolute w-[480px] h-[480px] rounded-full bg-brand-500/25 blur-3xl"
        animate={{ x: [-120, 80, -120], y: [-60, 100, -60] }} transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="absolute w-[380px] h-[380px] rounded-full bg-violet-500/20 blur-3xl"
        animate={{ x: [100, -90, 100], y: [80, -80, 80] }} transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="absolute w-[300px] h-[300px] rounded-full bg-sky-400/15 blur-3xl"
        animate={{ x: [-60, 120, -60], y: [120, -40, 120] }} transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }} />

      {/* 🩹 স্ক্রলযোগ্য কনটেন্ট-লেয়ার — ফোনে কার্ড লম্বা হলে স্ক্রল হয়,
          খাটো হলে (ডেস্কটপ) আগের মতোই পুরো সেন্টারে থাকে। iOS-কীবোর্ডেও
          html/body-র visualViewport-সিঙ্কের সাথে মিলে যায়। */}
      <div className="lg-auth-scroll absolute inset-0 z-10 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center py-4">
          <motion.div
            ref={cardRef}
            onPointerMove={onCardMove}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.2, 0.9, 0.3, 1] }}
            className="lg-card relative w-full max-w-[420px] mx-4 py-8 px-7"
          >
            {/* ব্র্যান্ড-হেডার */}
            <div className="flex flex-col items-center mb-5 lg-step">
              <motion.div
                className="w-16 h-16 rounded-[22px] bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-brand-500/30"
                whileHover={{ rotate: [0, -7, 7, 0], scale: 1.06 }} transition={{ duration: 0.5 }}
              >
                fc
              </motion.div>
              <h1 className="mt-2.5 text-[26px] font-black tracking-tight text-slate-800 dark:text-white">fcfc</h1>
              <p className="text-[12.5px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                <IcLock size={12} /> {t('e2eBadge')}
              </p>
            </div>

            <AnimatePresence mode="wait">
              {screen === 'welcome' && <Welcome key="w" onLogin={() => setScreen('login')} onSignup={() => setScreen('signup')} />}
              {screen === 'login' && <LoginView key="l" onBack={() => setScreen('welcome')} />}
              {screen === 'signup' && <SignupWizard key="s" onBack={() => setScreen('welcome')} />}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

/* ═══ ওয়েলকাম — উপরে Log in, নিচে Sign up ═══ */
function Welcome({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  const t = useT()
  return (
    <motion.div {...slide} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} className="lg-step space-y-3.5">
      <motion.button
        whileTap={{ scale: 0.97 }}
        whileHover={{ y: -1 }}
        onClick={onLogin}
        className="lg-btn"
      >
        {t('loginBtn')}
      </motion.button>
      <motion.button
        whileTap={{ scale: 0.97 }}
        whileHover={{ y: -1 }}
        onClick={onSignup}
        className="lg-btn-ghost w-full flex items-center justify-center gap-2 py-3.5"
      >
        <IcUser size={17} /> {t('signupBtn')}
      </motion.button>
      <p className="text-[11.5px] text-center text-slate-400 dark:text-slate-500 leading-relaxed pt-1.5">
        {t('signupNote')}
      </p>
    </motion.div>
  )
}

/* ═══ লগইন — username+password ─ নিচে ─ userid+passcode ═══ */
function LoginView({ onBack }: { onBack: () => void }) {
  const t = useT()
  const { login, loginPin } = useAuth()
  const [method, setMethod] = useState<LoginMethod>('pass')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // পিন-লগইন স্টেজ
  const [pinStage, setPinStage] = useState<PinStage>('uid')
  const [uid, setUid] = useState('')
  const [passcode, setPasscode] = useState('')
  const [pinDir, setPinDir] = useState(1)
  // মেথড-সুইচের স্ট্যাটিক ভ্যারিয়েন্ট — custom ছাড়া function-variant
  // AnimatePresence(mode=wait)-এ exit আটকে দেয়, তাই এখানে প্লেইন অবজেক্ট
const slideStatic: any = {
    initial: { opacity: 0, x: 28, scale: 0.985 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: { opacity: 0, x: -28, scale: 0.985 },
    transition: { type: 'spring', stiffness: 400, damping: 34 },
  }
  // গ্লাইডিং-পিল পজিশন
  const navRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const nav = navRef.current, pill = pillRef.current
    if (!nav || !pill) return
    const idx = method === 'pass' ? 0 : 1
    const btn = nav.children[idx + 1] as HTMLElement // children[0] = pill
    if (btn) {
      pill.style.width = btn.offsetWidth + 'px'
      pill.style.transform = `translateX(${btn.offsetLeft - 5}px)`
    }
  }, [method])

  async function submitPass(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !username || password.length < 1) return
    setBusy(true); setError('')
    try {
      const err = await login(username, password)
      if (err) setError(err)
    } finally { setBusy(false) }
  }

  async function submitPin() {
    if (busy || uid.length < 4 || passcode.length < 6) return
    setBusy(true); setError('')
    try {
      const err = await loginPin(uid, passcode)
      if (err) { setError(err); setPasscode('') } // ব্যর্থ পিন মুছে দিই — রিট্রাই পরিষ্কার প্যাডে
    } finally { setBusy(false) }
  }

  return (
    <motion.div {...slide} className="lg-step">
      {/* ⬅ ব্যাক */}
      <div className="flex items-center gap-2 mb-4 -mt-1">
        <button onClick={onBack} className="lgm-chip p-2.5 rounded-full text-slate-500 dark:text-slate-300 flex items-center gap-1.5" title={t('backBtn')}>
          <IcBack size={18} />
        </button>
        <div className="text-[15px] font-bold text-slate-700 dark:text-slate-100">{t('loginBtn')}</div>
      </div>

      {/* মেথড-সুইচ — গ্লাইডিং পিল */}
      <div ref={navRef} className="lg-nav mb-5">
        <div ref={pillRef} className="lg-nav-pill" />
        <button type="button" className={method === 'pass' ? 'on' : ''} onClick={() => { setMethod('pass'); setError(''); setPinStage('uid') }}>
          {t('loginWithPass')}
        </button>
        <button type="button" className={method === 'pin' ? 'on' : ''} onClick={() => { setMethod('pin'); setError(''); setPinStage('uid') }}>
          {t('loginWithPin')}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div initial={{ opacity: 0, y: -6, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-3">
            <div className="text-[13px] text-rose-500 bg-rose-500/10 rounded-xl px-4 py-2.5">{error}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {method === 'pass' ? (
          <motion.form key="pass" {...slideStatic} onSubmit={submitPass} className="space-y-4">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t('username')}</label>
              <input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                placeholder={t('usernamePh')} autoComplete="username"
                className="lg-input mt-1.5" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t('password')}</label>
              <div className="relative mt-1.5">
                <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('passwordPh')} autoComplete="current-password"
                  className="lg-input pr-12" />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
                  title={showPass ? t('hidePass') : t('showPass')}>
                  {showPass ? <IcEyeOff size={18} /> : <IcEye size={18} />}
                </button>
              </div>
            </div>
            <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={busy || !username || !password} className="lg-btn mt-1">
              {busy ? <Spinner size={18} className="mx-auto" /> : t('loginBtn')}
            </motion.button>
          </motion.form>
        ) : (
          <motion.div key="pin" {...slideStatic} className="space-y-3">
            <AnimatePresence mode="wait">
              {pinStage === 'uid' ? (
                <motion.div key="pin-uid" {...slideStatic} className="space-y-2">
                  <div className="text-center">
                    <div className="text-[15px] font-bold text-slate-700 dark:text-slate-100">{t('enterUserId')}</div>
                    <div className="text-[12px] text-slate-400 mt-0.5">{t('userIdHint')}</div>
                  </div>
                  <PinPad value={uid} onChange={setUid} max={12} minLength={4} secure={false} />
                  <div className="flex gap-2.5 pt-1">
                    <button className="lg-btn-ghost flex-1" onClick={() => { setPinStage('passcode'); setPinDir(1) }} disabled={uid.length < 4}>
                      {t('nextBtn')} →
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="pin-pass" {...slideStatic} className="space-y-2">
                  <div className="text-center">
                    <div className="text-[15px] font-bold text-slate-700 dark:text-slate-100">{t('enterPasscode')}</div>
                    <div className="text-[12px] text-slate-400 mt-0.5">{t('passcodeHintLogin')}</div>
                  </div>
                  <PinPad
                    value={passcode}
                    onChange={(v) => {
                      setPasscode(v)
                      if (v.length === 8) setTimeout(() => submitPin(), 150) // ৮-ডিজিটে অটো-সাবমিট
                    }}
                    max={8}
                    minLength={6}
                    onEnter={() => passcode.length >= 6 && submitPin()}
                  />
                  <div className="flex gap-2.5 pt-1">
                    <button className="lg-btn-ghost flex-1 flex items-center justify-center gap-1" onClick={() => { setPinStage('uid'); setPinDir(-1) }}>
                      <IcBack size={16} /> {t('backBtn')}
                    </button>
                    <motion.button whileTap={{ scale: 0.96 }} className="lg-btn flex-1" disabled={busy || passcode.length < 6} onClick={submitPin}>
                      {busy ? <Spinner size={18} className="mx-auto" /> : t('loginBtn')}
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ═══ সাইনআপ-উইজার্ড — ১০টি ধাপ, smooth slide+jelly ═══ */
function SignupWizard({ onBack }: { onBack: () => void }) {
  const t = useT()
  const { signup } = useAuth()
  const [step, setStep] = useState<number>(0)
  const [dir, setDir] = useState(1)

  // ফিল্ডগুলো
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [uidCode, setUidCode] = useState('')
  const [passcode, setPasscode] = useState('')
  const [passcode2, setPasscode2] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // ইউজারনেম-অ্যাভেইলেবিলিটি — টাইপ করার সাথে সাথে
  const [nameStatus, setNameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle')
  useEffect(() => {
    const u = username.toLowerCase()
    if (!/^[a-z0-9_]{3,24}$/.test(u)) { setNameStatus(u ? 'invalid' : 'idle'); return }
    setNameStatus('checking')
    const timer = setTimeout(async () => {
      try {
        const { ok } = await api(`/auth/check?username=${u}`, { noAuth: true })
        setNameStatus(ok ? 'ok' : 'taken')
      } catch { setNameStatus('idle') }
    }, 450)
    return () => clearTimeout(timer)
  }, [username])

  // 🆕 ইউজার-আইডি-অ্যাভেইলেবিলিটি — নাম্প্যাডে টাইপের পর
  const [uidStatus, setUidStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle')
  useEffect(() => {
    if (step !== 6) return
    if (uidCode.length < 4) { setUidStatus('idle'); return }
    setUidStatus('checking')
    const timer = setTimeout(async () => {
      try {
        const { ok } = await api(`/auth/check?uidcode=${uidCode}`, { noAuth: true })
        setUidStatus(ok ? 'ok' : 'taken')
      } catch { setUidStatus('idle') }
    }, 400)
    return () => clearTimeout(timer)
  }, [uidCode, step])

  const phoneValid = !phone || /^\+?[0-9][0-9\s-]{5,19}$/.test(phone)
  const emailValid = !email || /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-zA-Z]{2,24}$/.test(email)
  const mismatch = step === 5 && password2.length > 0 && password !== password2
  const passcodeMismatch = step === 8 && passcode2.length > 0 && passcode !== passcode2

  function stepValid(): boolean {
    switch (STEP_KEYS[step]) {
      case 'name': return name.trim().length >= 1
      case 'username': return /^[a-z0-9_]{3,24}$/.test(username) && nameStatus !== 'taken' && nameStatus !== 'invalid'
      case 'phone': return phoneValid
      case 'email': return emailValid
      case 'password': return password.length >= 8
      case 'confirm': return password === password2 && password2.length > 0
      case 'uid': return uidCode.length >= 4 && uidStatus !== 'taken'
      case 'passcode': return passcode.length >= 6 && passcode.length <= 8
      case 'passcode2': return passcode === passcode2
      case 'finish': return understood
      default: return false
    }
  }

  function go(next: number) {
    setError('')
    setDir(next > step ? 1 : -1)
    // 🩹 confirm-ধাপে (re-)প্রবেশে আগের অর্ধ-লেখা মান রিসেট — নইলে
    // back→forward করলে পুরনো ভুল কনফার্ম-মান আটকে থেকে মিসম্যাচ দেখাত
    if (STEP_KEYS[next] === 'confirm') setPassword2('')
    if (STEP_KEYS[next] === 'passcode2') setPasscode2('')
    setStep(next)
  }

  async function finish() {
    if (busy || !stepValid()) return
    setBusy(true); setError('')
    try {
      const err = await signup({
        username, password, understood,
        name: name.trim(), phone: phone.trim(), email: email.trim(),
        userIdCode: uidCode, passcode,
      })
      if (err) setError(err)
    } finally { setBusy(false) }
  }

  const hasNext = step < STEP_KEYS.length - 1
  const isOptional = step === 2 || step === 3

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    if (!stepValid()) return
    if (hasNext) go(step + 1)
    else await finish()
  }

  return (
    <motion.div {...slide} className="lg-step">
      {/* ⬅ ব্যাক + প্রগ্রেস-ডট */}
      <div className="flex items-center gap-3 mb-4 -mt-1">
        <button onClick={() => (step === 0 ? onBack() : go(step - 1))}
          className="lgm-chip p-2.5 rounded-full text-slate-500 dark:text-slate-300" title={t('backBtn')}>
          <IcBack size={18} />
        </button>
        <div className="lg-dots flex-1 justify-start">
          {STEP_KEYS.map((_, i) => (
            <div key={i} className={`lg-dot ${i <= step ? 'on' : ''}`} />
          ))}
        </div>
        <div className="text-[12px] font-bold text-slate-400 tabular-nums">{step + 1}/{STEP_KEYS.length}</div>
      </div>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-3">
            <div className="text-[13px] text-rose-500 bg-rose-500/10 rounded-xl px-4 py-2.5">{error}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={submitForm}>
        <AnimatePresence mode="wait" custom={dir}>
          {/* ── ১. নাম ── */}
          {step === 0 && (
            <motion.div key="s0" {...slide} custom={dir} className="space-y-4">
              <StepHead title={t('suNameTitle')} sub={t('suNameSub')} />
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} autoFocus placeholder={t('suNamePh')}
                className="lg-input text-[17px]" autoComplete="name" />
            </motion.div>
          )}

          {/* ── ২. ইউজারনেম ── */}
          {step === 1 && (
            <motion.div key="s1" {...slide} custom={dir} className="space-y-4">
              <StepHead title={t('suUserTitle')} sub={t('suUserSub')} />
              <div className="relative">
                <input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())} autoFocus placeholder={t('usernamePh')}
                  className="lg-input text-[17px] pl-9" autoComplete="username" />
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">@</span>
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm">
                  {nameStatus === 'checking' && <Spinner size={15} className="text-slate-400" />}
                  {nameStatus === 'ok' && <span className="text-emerald-500"><IcCheck size={17} /></span>}
                  {nameStatus === 'taken' && <span className="text-rose-500 text-[11px] font-bold">{t('nameTaken')}</span>}
                  {nameStatus === 'invalid' && username && <span className="text-amber-500 text-[11px] font-bold">{t('nameInvalid')}</span>}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── ৩. ফোন (ঐচ্ছিক — স্কিপযোগ্য) ── */}
          {step === 2 && (
            <motion.div key="s2" {...slide} custom={dir} className="space-y-4">
              <StepHead title={t('phoneLabel')} sub={t('suPhoneSub')} />
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9+\s-]/g, '').slice(0, 22))} autoFocus inputMode="tel" placeholder={t('phonePh')}
                className={`lg-input text-[17px] ${!phoneValid ? 'border-rose-400' : ''}`} autoComplete="tel" />
            </motion.div>
          )}

          {/* ── ৪. ইমেইল (ঐচ্ছিক — স্কিপযোগ্য) ── */}
          {step === 3 && (
            <motion.div key="s3" {...slide} custom={dir} className="space-y-4">
              <StepHead title={t('emailLabel')} sub={t('suEmailSub')} />
              <input value={email} onChange={(e) => setEmail(e.target.value.trim().slice(0, 190))} autoFocus inputMode="email" placeholder={t('emailPh')}
                className={`lg-input text-[17px] ${!emailValid ? 'border-rose-400' : ''}`} autoComplete="email" />
            </motion.div>
          )}

          {/* ── ৫. পাসওয়ার্ড ── */}
          {step === 4 && (
            <motion.div key="s4" {...slide} custom={dir} className="space-y-4">
              <StepHead title={t('suPassTitle')} sub={t('suPassSub')} />
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus placeholder={t('passwordPh')}
                  className="lg-input pr-12 text-[17px]" autoComplete="new-password" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition">
                  {showPass ? <IcEyeOff size={18} /> : <IcEye size={18} />}
                </button>
              </div>
              {password.length > 0 && password.length < 8 && (
                <div className="text-[12px] text-amber-500 font-medium">{t('passShort')}</div>
              )}
            </motion.div>
          )}

          {/* ── ৬. কনফার্ম পাসওয়ার্ড ── */}
          {step === 5 && (
            <motion.div key="s5" {...slide} custom={dir} className="space-y-4">
              <StepHead title={t('confirmPass')} sub={t('suConfirmSub')} />
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={password2} onChange={(e) => setPassword2(e.target.value)} autoFocus placeholder={t('passwordPh')}
                  className={`lg-input pr-12 text-[17px] ${mismatch ? 'border-rose-400' : ''}`} autoComplete="new-password" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  {showPass ? <IcEyeOff size={18} /> : <IcEye size={18} />}
                </button>
                {!mismatch && password2.length > 0 && (
                  <span className="absolute right-11 top-1/2 -translate-y-1/2 text-emerald-500"><IcCheck size={16} /></span>
                )}
              </div>
              {mismatch && <div className="text-[12px] text-rose-500 font-medium">{t('passMismatch')}</div>}
            </motion.div>
          )}

          {/* ── ৭. ইউজার-আইডি (নাম্প্যাড) ── */}
          {step === 6 && (
            <motion.div key="s6" {...slide} custom={dir} className="space-y-2">
              <StepHead title={t('suUidTitle')} sub={t('suUidSub')} center />
              <PinPad value={uidCode} onChange={setUidCode} max={12} minLength={4} secure={false} />
              <div className="h-5 flex items-center justify-center gap-1.5">
                {uidStatus === 'checking' && <Spinner size={14} className="text-slate-400" />}
                {uidStatus === 'ok' && <span className="text-[12px] text-emerald-500 font-semibold flex items-center gap-1"><IcCheck size={14} /> {t('uidAvailable')}</span>}
                {uidStatus === 'taken' && <span className="text-[12px] text-rose-500 font-semibold">{t('uidTaken')}</span>}
              </div>
            </motion.div>
          )}

          {/* ── ৮. পাসকোড (নাম্প্যাড) ── */}
          {step === 7 && (
            <motion.div key="s7" {...slide} custom={dir} className="space-y-2">
              <StepHead title={t('suPinTitle')} sub={t('suPinSub')} center />
              <PinPad value={passcode} onChange={setPasscode} max={8} minLength={6} />
            </motion.div>
          )}

          {/* ── ৯. কনফার্ম পাসকোড ── */}
          {step === 8 && (
            <motion.div key="s8" {...slide} custom={dir} className="space-y-2">
              <StepHead title={t('suPin2Title')} sub={t('suPin2Sub')} center />
              <PinPad value={passcode2} onChange={setPasscode2} max={8} minLength={6} />
              {passcodeMismatch && <div className="text-[12px] text-rose-500 font-semibold text-center">{t('passMismatch')}</div>}
              {!passcodeMismatch && passcode2.length >= 6 && passcode === passcode2 && (
                <div className="text-[12px] text-emerald-500 font-semibold text-center flex items-center justify-center gap-1"><IcCheck size={14} /> {t('pinMatched')}</div>
              )}
            </motion.div>
          )}

          {/* ── ১০. শেষ — নো-রিকভারি টিক + Create Account ── */}
          {step === 9 && (
            <motion.div key="s9" {...slide} custom={dir} className="space-y-4">
              <StepHead title={t('suFinishTitle')} sub={`${t('suFinishSub')} @${username} · ID ${uidCode}`} center />
              <button type="button" onClick={() => setUnderstood(!understood)}
                className="w-full flex gap-3.5 items-start text-left rounded-2xl bg-amber-500/10 border border-amber-400/25 p-4 transition hover:bg-amber-500/15">
                <span className={`lg-check ${understood ? 'on' : ''}`}>
                  {understood && <IcCheck size={15} className="text-white" strokeWidth={3} />}
                </span>
                <span className="text-[13px] leading-relaxed text-amber-700 dark:text-amber-300/90">
                  {t('noRecovery')}
                </span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── নেভিগেশন-বাটন ── */}
        <div className="flex gap-2.5 mt-6">
          {hasNext ? (
            <>
              {isOptional && (
                <motion.button whileTap={{ scale: 0.96 }} type="button" className="lg-btn-ghost flex-1" onClick={() => go(step + 1)}>
                  {t('skipBtn')}
                </motion.button>
              )}
              <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={!stepValid()} className="lg-btn flex-1 flex items-center justify-center gap-2">
                {t('nextBtn')} →
              </motion.button>
            </>
          ) : (
            <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={busy || !stepValid()} className="lg-btn flex items-center justify-center gap-2">
              {busy ? <Spinner size={18} className="mx-auto" /> : <><IcCheck size={17} /> {t('signupBtn')}</>}
            </motion.button>
          )}
        </div>
      </form>
    </motion.div>
  )
}

/* ধাপের শিরোনাম + সাব-টেক্সট */
function StepHead({ title, sub, center = false }: { title: string; sub?: string; center?: boolean }) {
  return (
    <div className={center ? 'text-center pt-1.5' : 'pt-0.5'}>
      <div className="text-[16.5px] font-bold text-slate-800 dark:text-slate-100">{title}</div>
      {sub && <div className="text-[12.5px] text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">{sub}</div>}
    </div>
  )
}
