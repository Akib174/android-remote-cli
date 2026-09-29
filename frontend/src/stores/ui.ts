// UI স্টেট — থিম, মডাল, টোস্ট, কল, ভিউয়ার, কনটেক্সট মেনু, অ্যাভাটার-ভিউয়ার।
import { create } from 'zustand'
import type React from 'react'

export interface MenuItem {
  label: string
  danger?: boolean
  onClick: () => void
  icon?: React.ReactNode
}

// মেনুর উপরের রিয়্যাকশন-স্ট্রিপ (টেলিগ্রাম-স্টাইল) — কুইক ইমোজি + আরও-বাটন
export interface MenuReactions {
  emojis: string[]
  more?: string[]
  onPick: (emoji: string) => void
  onMore?: () => void
}

interface UiState {
  theme: 'light' | 'dark'
  panel: null | 'settings' | 'archived' | 'starred'
  rightPanel: { chatId: string } | null
  modal: { type: string; props?: any } | null
  viewer: { urls: string[]; index: number; name?: string } | null
  avatarView: { name: string; id: string; avatarKey?: string } | null
  // call.auto = 🔴 লাল-বাটন কল — ওপাশে রিং না বাজিয়ে অটো-ধরা হয়
  // acceptedNow = ইনকামিং কল অ্যাকসেপ্ট করা হয়েছে (ক্যালির টাইমার সাথে সাথে শুরু)
  call: { chatId: string; mode: 'audio' | 'video'; incoming?: any; auto?: boolean; acceptedNow?: boolean } | null
  menu: { x: number; y: number; items: MenuItem[]; reactions?: MenuReactions } | null
  toasts: { id: number; text: string }[]
  mobileView: 'list' | 'chat'
  // সাইডবার-প্রস্থ (ড্র্যাগ-রিসাইজ, টেলিগ্রাম-স্টাইল) — px
  sidebarW: number

  toggleTheme(): void
  setPanel(p: UiState['panel']): void
  openRightPanel(chatId: string): void
  closeRightPanel(): void
  openModal(type: string, props?: any): void
  closeModal(): void
  openViewer(urls: string[], index?: number, name?: string): void
  closeViewer(): void
  openAvatarView(name: string, id: string, avatarKey?: string): void
  closeAvatarView(): void
  setCall(c: UiState['call']): void
  openMenu(x: number, y: number, items: MenuItem[], reactions?: MenuReactions): void
  closeMenu(): void
  toast(text: string): void
  setMobileView(v: UiState['mobileView']): void
  setSidebarW(w: number): void
}

let toastId = 0

// PWA থিম-কালার — অ্যাপের থিমের সাথে মিলিয়ে স্ট্যাটাস-বার/টাইটেল-বারের রঙ।
// (আগে হার্ডকোড নীল ছিল — লাইট/ডার্ক যা-ই হোক নীলই থাকত।)
export function applyThemeColor(theme: 'light' | 'dark') {
  const color = theme === 'dark' ? '#0e1220' : '#ffffff'
  try {
    let el = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
    if (!el) {
      el = document.createElement('meta')
      el.name = 'theme-color'
      document.head.appendChild(el)
    }
    el.content = color
  } catch {}
}

export const useUi = create<UiState>((set, get) => ({
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  panel: null,
  rightPanel: null,
  modal: null,
  viewer: null,
  avatarView: null,
  call: null,
  menu: null,
  toasts: [],
  mobileView: 'list',
  sidebarW: 380,

  toggleTheme() {
    const t = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.classList.toggle('dark', t === 'dark')
    localStorage.setItem('fcfc.theme', t)
    applyThemeColor(t)
    set({ theme: t })
    window.dispatchEvent(new CustomEvent('fcfc:theme', { detail: t }))
  },
  setPanel(p) { set({ panel: p }) },
  openRightPanel(chatId) { set({ rightPanel: { chatId } }) },
  closeRightPanel() { set({ rightPanel: null }) },
  openModal(type, props) { set({ modal: { type, props } }) },
  closeModal() { set({ modal: null }) },
  openViewer(urls, index = 0, name) { set({ viewer: { urls, index, name } }) },
  closeViewer() { set({ viewer: null }) },
  openAvatarView(name, id, avatarKey) { set({ avatarView: { name, id, avatarKey } }) },
  closeAvatarView() { set({ avatarView: null }) },
  setCall(c) { set({ call: c }) },
  openMenu(x, y, items, reactions) { set({ menu: { x, y, items, reactions } }) },
  closeMenu() { set({ menu: null }) },
  toast(text) {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200)
  },
  setMobileView(v) { set({ mobileView: v }) },
  setSidebarW(w) {
    try { localStorage.setItem('fcfc.sidebarW', String(w)) } catch {}
    set({ sidebarW: w })
  },
}))

// সেভ-করা সাইডবার-প্রস্থ রিস্টোর (টেলিগ্রামের মতো মনে রাখে)
try {
  const w = parseInt(localStorage.getItem('fcfc.sidebarW') || '', 10)
  if (w >= 68 && w <= 520) useUi.setState({ sidebarW: w })
} catch {}
