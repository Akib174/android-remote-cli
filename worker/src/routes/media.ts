// /media/* — R2 multipart upload (2GB পর্যন্ত) + authenticated range-download (streaming)।
// সব ফাইল ক্লায়েন্ট-সাইডে এনক্রিপ্ট করা হয়; সার্ভার শুধু সাইফারটেক্সট স্টোর করে।
import { Hono } from 'hono'
import type { AppContext } from '../types'
import { json, err, uid } from '../lib/util'
import { authMiddleware, verifyTokenRaw } from '../middleware/auth'

const app = new Hono<AppContext>()
const MAX_FILE = 2 * 1024 * 1024 * 1024 // 2GB
const MAX_PART = 100 * 1024 * 1024

app.use('*', authMiddleware)

// 1) upload শুরু → multipart upload তৈরি
app.post('/upload/init', async (c) => {
  const b = await c.req.json<any>()
  const size = Number(b.size || 0)
  if (!size || size > MAX_FILE) return err('size must be 1B..2GB', 413)
  const key = `files/${c.get('user').id}/${uid()}${(b.name || '').slice(-24).replace(/[^\w.\-]/g, '')}`
  const mpu = await c.env.R2.createMultipartUpload(key, {
    customMetadata: { name: String(b.name || ''), mime: String(b.mime || 'application/octet-stream'), iv: String(b.iv || '') },
  })
  return json({ key, uploadId: mpu.uploadId })
})

// 2) প্রতিটি পার্ট (≤100MB) — হেডারে মেটা, বডিতে বাইনারি
app.put('/upload/part', async (c) => {
  const key = c.req.header('x-key') || ''
  const uploadId = c.req.header('x-upload-id') || ''
  const pn = Number(c.req.header('x-part-number') || '0')
  if (!key || !uploadId || !pn) return err('bad part request')
  if (!key.startsWith(`files/${c.get('user').id}/`)) return err('forbidden', 403)
  const body = await c.req.arrayBuffer()
  if (body.byteLength > MAX_PART) return err('part too large', 413)
  const mpu = await c.env.R2.resumeMultipartUpload(key, uploadId)
  const part = await mpu.uploadPart(pn, body)
  return json({ part: { partNumber: part.partNumber, etag: part.etag } })
})

// 3) সমাপ্ত
app.post('/upload/complete', async (c) => {
  const { key, uploadId, parts } = await c.req.json<any>().catch(() => ({}))
  if (!key || !uploadId || !Array.isArray(parts)) return err('bad complete')
  // ওনারশিপ চেক — /upload/part-এ আছে, কিন্তু complete-এ ছিল না: অন্যের
  // চালু আপলোড key+uploadId জানলে নষ্ট/করাপ্ট করে দিতে পারত।
  if (!key.startsWith(`files/${c.get('user').id}/`)) return err('forbidden', 403)
  if (parts.length > 10_000) return err('too many parts')
  for (const p of parts) {
    if (!p || typeof p.partNumber !== 'number' || typeof p.etag !== 'string') return err('bad parts')
  }
  try {
    const mpu = await c.env.R2.resumeMultipartUpload(key, uploadId)
    await mpu.complete(parts)
  } catch {
    return err('upload complete failed', 400)
  }
  return json({ ok: true, key })
})

// ছোট আপলোড (স্টিকার/থাম্বনেইল, ≤20MB) এক কলে
app.post('/upload/small', async (c) => {
  const blob = await c.req.arrayBuffer()
  if (blob.byteLength > 20 * 1024 * 1024) return err('too large', 413)
  const key = `files/${c.get('user').id}/${uid()}`
  await c.env.R2.put(key, blob, { httpMetadata: { contentType: c.req.header('x-content-type') || 'application/octet-stream' } })
  return json({ key })
})

// ডাউনলোড: ?token= সাপোর্ট (যাতে <img>/<video src> কাজ করে), Range সহ স্ট্রিমিং
// কী দুই প্রিফিক্সে থাকতে পারে: `files/...` (মিডিয়া) এবং `avatars/...` (প্রোফাইল ছবি)
app.get('/:key{(files|avatars)/.+}', async (c) => {
  const token = c.req.query('token') || (c.req.header('authorization') || '').replace('Bearer ', '')
  const user = await verifyTokenRaw(c.env, token)
  if (!user) return err('unauthorized', 401)
  let key = c.req.param('key')
  try { key = decodeURIComponent(key) } catch { /* কী-তে % নেই; নিরাপদ */ }
  const range = rangeHeader(c.req)
  const obj = await c.env.R2.get(key, range ? { range } : undefined)
  if (!obj) return err('not found', 404)
  const headers: Record<string, string> = {
    // মাল্টিপার্ট আপলোডে httpMetadata সেট হয় না — mime টাইপ
    // customMetadata থেকে ফেরত আসে (নইলে সব ফাইল octet-stream হতো)।
    'content-type': obj.httpMetadata?.contentType || obj.customMetadata?.mime || 'application/octet-stream',
    'content-length': String(obj.size),
    'accept-ranges': 'bytes',
    'x-file-name': encodeURIComponent(obj.customMetadata?.name || ''),
    'x-file-iv': obj.customMetadata?.iv || '',
    'cache-control': 'private, max-age=86400',
  }
  if (range && obj.range && typeof (obj.range as any).offset === 'number') {
    // R2 রেঞ্জ-অবজেক্ট {offset, length} আকারে ফেরত দেয় — `end` নিজে থেকে হিসাব
    // করতে হয়। ২০৬-এর জন্য content-length অবশ্যই *অংশের* সাইজ, পুরো ফাইলের নয়
    // (নইলে ভিডিও স্ট্রিমিং/সিক ভেঙে যায়)।
    const r = obj.range as any
    const start = r.offset as number
    const end = typeof r.end === 'number' ? r.end : typeof r.length === 'number' ? start + r.length - 1 : obj.size - 1
    headers['content-range'] = `bytes ${start}-${end}/${obj.size}`
    headers['content-length'] = String(end - start + 1)
  }
  return new Response(obj.body, { status: range ? 206 : 200, headers })
})

function rangeHeader(req: any): { offset: number; length?: number } | undefined {
  const r = req.header('range') as string | undefined
  if (!r) return undefined
  const m = /^bytes=(\d+)-(\d*)$/.exec(r)
  if (!m) return undefined
  const offset = parseInt(m[1], 10)
  const end = m[2] ? parseInt(m[2], 10) : undefined
  return end ? { offset, length: end - offset + 1 } : { offset }
}

export default app
