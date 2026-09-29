// /meta/preview — লিংক প্রিভিউ (og:* ট্যাগ পার্স)। সার্ভার-সাইড ফেচ বলে
// ক্লায়েন্টের CORS সমস্যা হয় না; শুধু হেডার+প্রথম 64KB পার্স করা হয়।
import { Hono } from 'hono'
import type { AppContext } from '../types'
import { json, err } from '../lib/util'
import { authMiddleware } from '../middleware/auth'
import { rateLimit } from '../lib/ratelimit'

const app = new Hono<AppContext>()

app.get('/meta/preview', authMiddleware, async (c) => {
  const rl = await rateLimit(c.env.KV, `preview:${c.get('user').id}`, 30, 60)
  if (!rl.ok) return err('rate limited', 429)
  const url = c.req.query('url') || ''
  let u: URL
  try { u = new URL(url) } catch { return err('bad url') }
  // https-ই শুধু — http:// টার্গেটে সার্ভার-সাইড ফেচ (SSRF-সুরফেস) বন্ধ
  if (u.protocol !== 'https:') return err('bad scheme')
  const cacheKey = `lp:${url}`
  const cached = await c.env.KV.get(cacheKey, 'json')
  if (cached) return json(cached)
  try {
    const res = await fetch(u, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; fcfc-preview/1.0)', accept: 'text/html' },
      cf: { cacheTtl: 300 },
    } as any)
    const ct = res.headers.get('content-type') || ''
    if (!res.ok || !ct.includes('text/html')) return json({ url })
    // পুরো বডি রিড না করে স্ট্রিম থেকে সর্বোচ্চ ৬৪KB নিই —
    // বিশাল পেজ আইসোলেটের মেমোরি শেষ করে ফেলত।
    let html = ''
    if (res.body) {
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let received = 0
      try {
        while (received < 65536) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          html += dec.decode(value, { stream: true })
        }
      } catch {}
      try { await reader.cancel() } catch {}
      html += dec.decode()
    } else {
      html = await res.text()
    }
    html = html.slice(0, 65536)
    const pick = (prop: string) => {
      const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'))
      return m ? decodeEntities(m[1]) : ''
    }
    const title = pick('og:title') || (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] ?? '')
    const out = { url, title: title.slice(0, 200), description: pick('og:description').slice(0, 300), image: pick('og:image') }
    if (out.image) {
      try { out.image = new URL(out.image, u).toString() } catch { out.image = '' }
    }
    await c.env.KV.put(cacheKey, JSON.stringify(out), { expirationTtl: 3600 })
    return json(out)
  } catch {
    return json({ url })
  }
})

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

export default app
