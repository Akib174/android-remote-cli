// লিংক প্রিভিউ কার্ড — ওয়ার্কারের /meta/preview থেকে og:* ডেটা আনে।
import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../../api/client'
import { IcLink } from '../../lib/icons'

interface Preview { url: string; title?: string; description?: string; image?: string }

const cache = new Map<string, Preview>()

export function LinkPreview({ url, dark }: { url: string; dark?: boolean }) {
  const [p, setP] = useState<Preview | null>(cache.get(url) || null)

  useEffect(() => {
    if (cache.has(url)) return
    let dead = false
    api(`/meta/preview?url=${encodeURIComponent(url)}`)
      .then((res: Preview) => {
        cache.set(url, res)
        if (!dead && (res.title || res.image)) setP(res)
      })
      .catch(() => {})
    return () => { dead = true }
  }, [url])

  if (!p || (!p.title && !p.image)) return null
  return (
    <motion.a
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      className={`flex gap-2.5 mt-1.5 p-2 rounded-xl border-l-4 border-brand-500 no-underline ${dark ? 'bg-black/15' : 'bg-black/5 dark:bg-white/5'}`}
    >
      {p.image && <img src={p.image} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
      <div className="min-w-0">
        <div className="text-[13px] font-semibold truncate">{p.title || url}</div>
        {p.description && <div className="text-xs opacity-70 line-clamp-2 mt-0.5">{p.description}</div>}
        <div className="text-[11px] text-brand-500 dark:text-brand-300 mt-0.5 flex items-center gap-1"><IcLink size={11} />{new URL(url).hostname}</div>
      </div>
    </motion.a>
  )
}
