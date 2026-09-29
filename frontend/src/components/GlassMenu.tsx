// 💧 Liquid-Glass মেনু — qu.ax/dsP2u + SlcUY/HJQ08/JRaPN রেফারেন্সের
// হুবহু ডিজাইন-সিস্টেম। সব মেনু (হ্যামবার্গার, মেসেজ-কনটেক্সট,
// চ্যাট-হেডার, চ্যাট-লিস্ট) এই একটাই কম্পোনেন্ট ব্যবহার করে।
//
//  • ফ্রস্টেড-গ্লাস + saturate/brightness (CSS: .lgm)
//  • ঘূর্ণায়মান iridescent রিম (::before, --lg-ang)
//  • কার্সার/আঙুল-অনুসরণ আলো (::after, --lg-mx/--lg-my — lerp-সহ)
//  • গ্লাইডিং গ্লাস-পিল (.lgm-hl) — আইটেমের মাঝে ভেসে যায়
//  • ট্যাপে তরল-রিপল + press-squash
//  • jelly-in ওপেন-অ্যানিমেশন + আইটেম-স্ট্যাগার
import React, { useCallback, useEffect, useRef } from 'react'

/* ═══ 🌈 আসল রিফ্র্যাকশন (রেফারেন্সের SVG displacement-map) ═══
   প্রতিটি গ্লাস-এলিমেন্টের জন্য একটা "লেন্স-ম্যাপ" আঁকি: কিনারার কাছে
   backdrop-টা ভেতরের দিকে ঠেলে যায় (convex কাচের মতো), আর R/G/B সামান্য
   ভিন্ন হারে সরে (chromatic aberration)। Chrome/Edge/Opera-তে কাজ করে;
   অন্য ব্রাউজার সাধারণ ফ্রস্টেড-গ্লাসেই থেকে যায়। */
const SVGNS = 'http://www.w3.org/2000/svg'
export const CAN_REFRACT = typeof navigator !== 'undefined' && /Chrom(e|ium)\//.test(navigator.userAgent)

const PRESETS: Record<string, { bezel: number; scale: number }> = {
  menu: { bezel: 30, scale: 50 },
  chip: { bezel: 14, scale: 24 },
  bar: { bezel: 16, scale: 26 },
}

let defsEl: SVGSVGElement | null = null
function ensureDefs(): SVGSVGElement {
  if (defsEl && defsEl.isConnected) return defsEl
  const d = document.createElementNS(SVGNS, 'svg') as SVGSVGElement
  d.setAttribute('width', '0')
  d.setAttribute('height', '0')
  d.style.position = 'absolute'
  document.body.appendChild(d)
  defsEl = d
  return d
}

let refractClassOn = false
function ensureRefractClass() {
  if (refractClassOn) return
  refractClassOn = true
  document.documentElement.classList.add('refract')
}

function makeLensMap(w: number, h: number, r: number, bezel: number): string {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const d = img.data
  const hx = w / 2
  const hy = h / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5
      const py = y + 0.5
      // rounded-rect থেকে signed distance
      const qx = Math.abs(px - hx) - (hx - r)
      const qy = Math.abs(py - hy) - (hy - r)
      const ox = Math.max(qx, 0)
      const oy = Math.max(qy, 0)
      const len = Math.hypot(ox, oy)
      const depth = -(len + Math.min(Math.max(qx, qy), 0) - r)
      let nx: number, ny: number
      if (len > 0) {
        nx = Math.sign(px - hx) * (ox / len)
        ny = Math.sign(py - hy) * (oy / len)
      } else if (qx > qy) {
        nx = Math.sign(px - hx)
        ny = 0
      } else {
        nx = 0
        ny = Math.sign(py - hy)
      }
      let mag = 0
      if (depth >= 0 && depth < bezel) mag = Math.pow(1 - depth / bezel, 2.4)
      const i = (y * w + x) * 4
      d[i] = 127.5 * (1 - nx * mag) // R → x-shift
      d[i + 1] = 127.5 * (1 - ny * mag) // G → y-shift
      d[i + 2] = 128
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

function buildFilter(el: HTMLElement, id: string, preset: { bezel: number; scale: number }) {
  const w = Math.round(el.offsetWidth)
  const h = Math.round(el.offsetHeight)
  if (!w || !h) return
  const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2)
  const url = makeLensMap(w, h, r, preset.bezel)
  let f = document.getElementById(id) as unknown as SVGFilterElement | null
  if (!f) {
    f = document.createElementNS(SVGNS, 'filter') as SVGFilterElement
    f.id = id
    ensureDefs().appendChild(f)
  }
  f.setAttribute('color-interpolation-filters', 'sRGB')
  f.setAttribute('filterUnits', 'userSpaceOnUse')
  f.setAttribute('x', '0')
  f.setAttribute('y', '0')
  f.setAttribute('width', String(w))
  f.setAttribute('height', String(h))
  const s = preset.scale
  const ch = (name: string, mat: string, k: number) =>
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${(s * k).toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="d${name}"/>` +
    `<feColorMatrix in="d${name}" type="matrix" values="${mat}" result="c${name}"/>`
  f.innerHTML =
    `<feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>` +
    ch('R', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', 1.0) +
    ch('G', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', 0.94) +
    ch('B', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', 0.88) +
    `<feBlend in="cR" in2="cG" mode="screen" result="rg"/>` +
    `<feBlend in="rg" in2="cB" mode="screen" result="rgb"/>` +
    `<feGaussianBlur in="rgb" stdDeviation="0.6"/>`
  el.style.setProperty('--lg', `url(#${id})`)
}

let uid = 0
/** কোনো গ্লাস-এলিমেন্টে রিফ্র্যাকশন লাগায় (Chromium-এ)। */
export function useRefraction(ref: React.RefObject<HTMLElement | null>, preset: 'menu' | 'chip' | 'bar' = 'menu') {
  useEffect(() => {
    if (!CAN_REFRACT || !ref.current) return
    const el = ref.current
    const id = 'lgf-' + ++uid
    ensureRefractClass()
    const apply = () => buildFilter(el, id, PRESETS[preset])
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => {
      ro.disconnect()
      el.style.removeProperty('--lg')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])
}

export function GlassMenu({
  children,
  className = '',
  style,
  radius = 22,
  onMouseLeave,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  radius?: number
  onMouseLeave?: (e: React.MouseEvent) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const hlOn = useRef(false)
  // কার্সার-লাইটের lerp-স্টেট
  const home = useRef({ x: 30, y: 10 })
  const target = useRef({ ...home.current })
  const cur = useRef({ ...home.current })
  const raf = useRef(0)

  const tick = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    cur.current.x += (target.current.x - cur.current.x) * 0.16
    cur.current.y += (target.current.y - cur.current.y) * 0.16
    el.style.setProperty('--lg-mx', cur.current.x.toFixed(1) + 'px')
    el.style.setProperty('--lg-my', cur.current.y.toFixed(1) + 'px')
    const dx = Math.abs(target.current.x - cur.current.x)
    const dy = Math.abs(target.current.y - cur.current.y)
    raf.current = dx + dy > 0.3 ? requestAnimationFrame(tick) : 0
  }, [])

  const aim = useCallback(
    (x: number, y: number) => {
      target.current = { x, y }
      if (!raf.current) raf.current = requestAnimationFrame(tick)
    },
    [tick],
  )

  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  // 🌈 Chromium-এ আসল কাচ-রিফ্র্যাকশন (SVG displacement)
  useRefraction(boxRef, 'menu')

  function moveHl(item: HTMLElement) {
    const hl = hlRef.current
    if (!hl) return
    if (!hlOn.current) hl.classList.add('no-anim')
    hl.style.width = item.offsetWidth + 'px'
    hl.style.height = item.offsetHeight + 'px'
    hl.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`
    if (!hlOn.current) {
      void hl.offsetWidth // reflow — প্রথমবার জাম্প, তারপর থেকে গ্লাইড
      hl.classList.remove('no-anim')
      hl.classList.add('on')
      hlOn.current = true
    }
  }
  function hideHl() {
    hlRef.current?.classList.remove('on', 'press')
    hlOn.current = false
  }

  function onPointerOver(e: React.PointerEvent) {
    const it = (e.target as HTMLElement).closest('.lgm-item') as HTMLElement | null
    if (it) moveHl(it)
  }
  function onPointerDown(e: React.PointerEvent) {
    const it = (e.target as HTMLElement).closest('.lgm-item') as HTMLElement | null
    if (it) { moveHl(it); hlRef.current?.classList.add('press') }
  }
  function onPointerUp() {
    hlRef.current?.classList.remove('press')
  }
  function onPointerMove(e: React.PointerEvent) {
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    aim(
      (e.clientX - r.left) * (el.offsetWidth / r.width),
      (e.clientY - r.top) * (el.offsetHeight / r.height),
    )
  }
  function onPointerLeave() {
    hideHl()
    aim(home.current.x, home.current.y)
  }

  // ট্যাপে তরল-রিপল — রেফারেন্সের মতোই মেনু-লেভেলে ডেলিগেট করা
  function onClick(e: React.MouseEvent) {
    const item = (e.target as HTMLElement).closest('.lgm-item') as HTMLElement | null
    if (!item) return
    const rect = item.getBoundingClientRect()
    const rp = document.createElement('span')
    rp.className = 'lgm-ripple'
    rp.style.left = e.clientX - rect.left + 'px'
    rp.style.top = e.clientY - rect.top + 'px'
    item.appendChild(rp)
    setTimeout(() => rp.remove(), 800)
  }

  return (
    <div
      ref={boxRef}
      className={`lgm ${className}`}
      style={{ borderRadius: radius, ...style }}
      role="menu"
      onPointerOver={onPointerOver}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerMove={onPointerMove}
      onPointerLeave={(e) => { onPointerLeave(); onMouseLeave?.(e) }}
      onClick={onClick}
    >
      <div ref={hlRef} className="lgm-hl" />
      {children}
    </div>
  )
}

// ── একটা মেনু-আইটেম — আইকন বাম, লেবেল মাঝ, ডানে ঐচ্ছিক কনটেন্ট/chevron ──
export function GlassItem({
  icon,
  label,
  danger,
  right,
  account,
  index = 0,
  onClick,
  onMouseEnter,
  children,
}: {
  icon?: React.ReactNode
  label?: React.ReactNode
  danger?: boolean
  right?: React.ReactNode
  account?: boolean
  index?: number
  onClick?: () => void
  onMouseEnter?: (e: React.MouseEvent) => void
  children?: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`lgm-item ${danger ? 'danger' : ''} ${account ? 'account' : ''}`}
      style={{ ['--i' as any]: index }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      {icon}
      {label !== undefined && <span className="lgm-label">{label}</span>}
      {right}
      {children}
    </button>
  )
}

// ── ডিভাইডার ──
export function GlassDivider() {
  return <div className="lgm-divider" />
}
