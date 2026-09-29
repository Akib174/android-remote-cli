// "Thanos snap" ভ্যানিশ ইফেক্ট — ডিলিট-ফর-এভরিওয়ান হলে মেসেজ বাবল
// কণায় কণায় ভেঙে উবে যায় (ক্যানভাস পার্টিকেল সিস্টেম)।
// কোনো এক্সটার্নাল লাইব্রেরি লাগে না।
export function vanishElement(el: HTMLElement, accent = '#818cf8'): Promise<void> {
  return new Promise((resolve) => {
    const rect = el.getBoundingClientRect()
    const canvas = document.createElement('canvas')
    const PAD = 40
    canvas.width = rect.width + PAD * 2
    canvas.height = rect.height + PAD * 2
    canvas.style.cssText = `position:fixed;left:${rect.left - PAD}px;top:${rect.top - PAD}px;z-index:80;pointer-events:none;`
    document.body.appendChild(canvas)
    const ctx = canvas.getContext('2d')!

    // বাবলের রঙ নমুনা করি
    const cs = getComputedStyle(el)
    const colors = [cs.backgroundColor, accent, '#a5b4fc', '#94a3b8', cs.backgroundColor].filter(Boolean)

    // গ্রিড-ভিত্তিক পার্টিকেল
    const cols = Math.max(10, Math.min(26, Math.round(rect.width / 14)))
    const rows = Math.max(6, Math.min(18, Math.round(rect.height / 14)))
    const cw = rect.width / cols
    const ch = rect.height / rows

    interface P { x: number; y: number; vx: number; vy: number; s: number; c: string; a: number; d: number; rot: number; vr: number }
    const parts: P[] = []
    for (let gx = 0; gx < cols; gx++) {
      for (let gy = 0; gy < rows; gy++) {
        if (Math.random() < 0.12) continue // ফাঁকফোঁকর — ধোঁয়াটে ভাব
        parts.push({
          x: PAD + gx * cw + Math.random() * cw,
          y: PAD + gy * ch + Math.random() * ch,
          vx: 0.6 + Math.random() * 2.4,          // ডানে সরে যাওয়া (থানোস-ডাস্ট)
          vy: -(0.3 + Math.random() * 1.6),
          s: 1.4 + Math.random() * 2.8,
          c: colors[(Math.random() * colors.length) | 0],
          a: 1,
          d: 0.008 + Math.random() * 0.02 + (gx / cols) * 0.012, // বাম দিক আগে ঝরে
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.25,
        })
      }
    }

    el.style.visibility = 'hidden' // আসল বাবল লুকাই — কণাই অবশিষ্ট থাকে

    const start = performance.now()
    const DURATION = 950

    function frame(now: number) {
      const t = (now - start) / DURATION
      ctx!.clearRect(0, 0, canvas.width, canvas.height)
      let alive = false
      for (const p of parts) {
        if (p.a <= 0) continue
        alive = true
        p.x += p.vx * (1 + t * 2.2)
        p.y += p.vy
        p.vy += 0.02 + Math.random() * 0.02 // হালকা টার্বুলেন্স
        p.vx += (Math.random() - 0.45) * 0.12
        p.a -= p.d * (1 + t * 2)
        p.rot += p.vr
        if (p.a <= 0) continue
        ctx!.save()
        ctx!.globalAlpha = Math.max(0, Math.min(1, p.a))
        ctx!.translate(p.x, p.y)
        ctx!.rotate(p.rot)
        ctx!.fillStyle = p.c
        ctx!.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * (0.5 + p.a * 0.5))
        ctx!.restore()
      }
      if (alive && t < 1.15) requestAnimationFrame(frame)
      else { canvas.remove(); resolve() }
    }
    requestAnimationFrame(frame)
  })
}
