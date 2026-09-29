import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerServiceWorker } from './pwa/register'
import { useI18n } from './lib/i18n'
import { applyThemeColor } from './stores/ui'
import { useChats } from './stores/chats'
import { useUi } from './stores/ui'

// ডিবাগিং/টেস্টিং সহায়তা — স্টোরগুলো window-তে (প্রোডাকশনে নিরীহ)
;(window as any).__fcfc = { useChats, useUi }

// থিম আগে থেকেই প্রয়োগ (ফ্ল্যশ এড়াতে)
try {
  const t = localStorage.getItem('fcfc.theme')
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark')
  }
} catch {}

// PWA থিম-কালার: অ্যাপের থিম অনুযায়ী স্ট্যাটাস-বারের রঙ (আগে সবসময় নীল ছিল)
try { applyThemeColor(document.documentElement.classList.contains('dark') ? 'dark' : 'light') } catch {}

// ভাষা অনুযায়ী <html lang> সেট (ডিফল্ট ইংরেজি)
try {
  const lang = useI18n.getState().lang
  document.documentElement.lang = lang === 'bn' ? 'bn' : 'en'
} catch {}

// ⌨️ মোবাইল-কীবোর্ড সিঙ্ক — iOS Safari interactive-widget সাপোর্ট করে না
// (কীবোর্ড ভিজ্যুয়াল-ভিউপোর্টের উপর বসে, লেআউট শেষ না)। visualViewport-এর
// প্রকৃত উচ্চতা দিয়ে html/body-র উচ্চতা সিঙ্ক করলে কম্পোজার/সেন্ড-বাটন
// সবসময় কীবোর্ডের ঠিক উপরে থাকে। Android (resizes-content) আর ডেস্কটপে
// উচ্চতা একই থাকায় কোনো পার্শ্ব-প্রভাব নেই। (body-তে transform দিই না —
// position:fixed মেনু/মডাল ভেঙে যেত।)
;(function syncVisualViewport() {
  const vv = window.visualViewport
  if (!vv) return
  let raf = 0
  const apply = () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const h = Math.round(vv.height)
      document.documentElement.style.height = `${h}px`
      document.body.style.height = `${h}px`
    })
  }
  vv.addEventListener('resize', apply)
  apply()
})()

// ═══ 💧 লিকুইড-গ্লাস গ্লোবাল-ইফেক্ট (পুরো অ্যাপ) ═══
// ১) ট্যাপ-রিপল — যে-কোনো বাটনে (নাম্প্যাড-কীসহ) ছোপ পড়লেই তরল-রিপল
//    ছড়ায়। মেনু-সিস্টেমের (.lgm) নিজস্ব রিপল আছে — ওটা বাদ দিই।
// ২) কার্সার-লাইট — .lg-card-গুলোতে (অথ-কার্ড ইত্যাদি) আলোর দাগ পিছু
//    পিছু চলে (.lgm-মেনু GlassMenu নিজেই করে)।
;(function liquidGlassGlobals() {
  document.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('button, .lg-key')
    if (!el || el.closest('.lgm')) return
    const rect = (el as HTMLElement).getBoundingClientRect()
    const rp = document.createElement('span')
    rp.className = 'lg-ripple-fx'
    rp.style.left = e.clientX + 'px'
    rp.style.top = e.clientY + 'px'
    ;(el as HTMLElement).appendChild(rp)
    setTimeout(() => rp.remove(), 700)
  }, { passive: true })

  const cardAim = { x: 40, y: 30 }
  document.addEventListener('pointermove', (e) => {
    const card = (e.target as HTMLElement | null)?.closest?.('.lg-card') as HTMLElement | null
    if (!card) return
    const r = card.getBoundingClientRect()
    cardAim.x = e.clientX - r.left
    cardAim.y = e.clientY - r.top
    card.style.setProperty('--lg-mx', cardAim.x.toFixed(1) + 'px')
    card.style.setProperty('--lg-my', cardAim.y.toFixed(1) + 'px')
  }, { passive: true })
})()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

registerServiceWorker()
