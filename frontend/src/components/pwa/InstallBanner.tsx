// PWA ইনস্টল-ব্যানার — ওয়েবসাইটে ঢুকলেই নিচে দেখায়:
//   [Install] → ব্রাউজারের ইনস্টল-ডায়ালগ
//   [✕]       → এই ভিজিটে বন্ধ (পরের বার আবার আসবে)
//   [Never show again] → localStorage-ফ্ল্যাগ, আর কখনো নয়
// (সেটিংস → Install app থেকে যেকোনো সময় ইনস্টল করা যায়।)
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useT } from '../../lib/i18n'
import { useUi } from '../../stores/ui'
import { armInstallPrompt, canInstall, promptInstall, neverAskAgain, isNeverAsk } from '../../lib/install'
import { IcX, IcDownload } from '../../lib/icons'

// লিসেনার এখনই বসিয়ে রাখি — ব্যানার মাউন্টের আগেই ইভেন্ট এলেও হারাবে না
armInstallPrompt()

export default function InstallBanner() {
  const t = useT()
  const toast = useUi((s) => s.toast)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // ইতিমধ্যে ইনস্টল-করা বা "never" বলা → নীরব
    try {
      if (isNeverAsk() || matchMedia('(display-mode: standalone)').matches) return
    } catch {}
    const check = () => { if (canInstall()) setShow(true) }
    // প্রম্পট ইতিমধ্যে ধরা পড়ে থাকলে এখনই, নাহলে ইভেন্টে
    if (canInstall()) { const id = setTimeout(() => setShow(true), 1200); return () => clearTimeout(id) }
    window.addEventListener('fcfc:can-install', check)
    const onHide = () => setShow(false)
    window.addEventListener('fcfc:installed', onHide)
    return () => { window.removeEventListener('fcfc:can-install', check); window.removeEventListener('fcfc:installed', onHide) }
  }, [])

  async function install() {
    setBusy(true)
    const r = await promptInstall()
    setBusy(false)
    setShow(false)
    if (r === 'accepted') toast(t('installedToast'))
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,420px)]"
        >
          <div className="glass rounded-2xl px-3.5 py-3 flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white flex items-center justify-center font-black shadow-md shrink-0">fc</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-bold truncate">{t('installBannerT')}</div>
              <div className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate">{t('installBannerSub')}</div>
            </div>
            <button
              onClick={install}
              disabled={busy}
              className="px-3.5 py-2 rounded-xl bg-brand-600 text-white text-[12.5px] font-bold flex items-center gap-1.5 shrink-0 shadow-md shadow-brand-600/25 disabled:opacity-60"
            >
              <IcDownload size={14} /> {t('installBtn2')}
            </button>
            <button onClick={() => { neverAskAgain(); setShow(false) }}
              className="text-[10.5px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline underline-offset-2 shrink-0 max-w-[64px] leading-tight">
              {t('neverShowAgain')}
            </button>
            <button onClick={() => setShow(false)} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-500/10 shrink-0" title="✕">
              <IcX size={15} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
