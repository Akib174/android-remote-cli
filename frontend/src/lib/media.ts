// R2 → ফেচ → ক্লায়েন্ট-সাইড ডিক্রিপ্ট → অবজেক্ট URL (ক্যাশে সহ)।
// সার্ভারে সব ফাইল এনক্রিপ্টেড থাকে; ব্রাউজারে দেখানোর আগে ডিক্রিপ্ট হয়।
import { api, mediaPath } from '../api/client'
import { decryptBlob, encryptBlob } from '../crypto/files'
import type { MediaMeta } from '../types'

const cache = new Map<string, string>()

export async function decryptedMediaUrl(media: MediaMeta): Promise<string> {
  const key = media.key
  if (cache.has(key)) return cache.get(key)!
  const res = await api(`/media/${mediaPath(key)}`, { raw: true })
  if (!res.ok) throw new Error(`media ${res.status}`)
  const enc = await res.blob()
  const plain = media.fileKey && media.iv ? await decryptBlob(enc, media.fileKey, media.iv) : enc
  const url = URL.createObjectURL(plain)
  cache.set(key, url)
  return url
}

export async function downloadMedia(media: MediaMeta) {
  const url = await decryptedMediaUrl(media)
  const a = document.createElement('a')
  a.href = url
  a.download = media.name || 'fcfc-file'
  a.click()
}

// আপলোড: এনক্রিপ্ট → মাল্টিপার্ট (বড় ফাইল) বা ছোট আপলোড
export async function uploadEncrypted(file: Blob, name: string, mime: string): Promise<MediaMeta> {
  const enc = await encryptBlob(file)

  if (enc.blob.size <= 20 * 1024 * 1024) {
    const res = await api('/media/upload/small', { method: 'POST', body: enc.blob, headers: { 'x-content-type': 'application/octet-stream' } })
    return { key: res.key, name, size: file.size, mime, iv: enc.iv, fileKey: enc.key }
  }

  // বড় ফাইল → মাল্টিপার্ট (পার্ট প্রতি 64MB, 2GB পর্যন্ত)
  const init = await api('/media/upload/init', { body: { name, mime, size: enc.blob.size, iv: enc.iv } })
  const PART = 64 * 1024 * 1024
  const parts: any[] = []
  let n = 1
  for (let off = 0; off < enc.blob.size; off += PART) {
    const chunk = enc.blob.slice(off, off + PART)
    const r = await api('/media/upload/part', {
      method: 'PUT',
      body: chunk,
      headers: { 'content-type': 'application/octet-stream', 'x-key': init.key, 'x-upload-id': init.uploadId, 'x-part-number': String(n) },
    })
    parts.push({ partNumber: n, etag: r.part?.etag })
    n++
  }
  await api('/media/upload/complete', { body: { key: init.key, uploadId: init.uploadId, parts } })
  return { key: init.key, name, size: file.size, mime, iv: enc.iv, fileKey: enc.key }
}

// অ্যাভাটার-কী থেকে ছোট-ভ্যারিয়েন্টের কী — কনভেনশন: `<hash>.bin` → `<hash>_small.bin`
// (আপলোডে দুই সাইজই যায়; ছোটটা চ্যাট-লিস্টে নিখুঁত শার্প দেখায়, বড়টা প্রোফাইল/জুমে)
export const smallAvatarKey = (key: string) => key.replace(/\.bin$/, '_small.bin')

// ── হাই-কোয়ালিটি ক্লায়েন্ট-সাইড ডাউনস্কেল ──
// ব্রাউজার বড় ছবি ছোট বক্সে দেখালে দ্রুত বাইলিনিয়ার নমুনায় মুখ মিহে যায়
// ("compress মোটো")। স্টেপ-হালভিং (টেলিগ্রাম-থাম্বনেল কৌশল) দিয়ে ধাপে ধাপে
// নামালে ডিটেইল বাঁচে।
async function stepwiseScale(img: HTMLImageElement, target: number): Promise<HTMLCanvasElement> {
  let w = img.naturalWidth, h = img.naturalHeight
  const scale = Math.min(1, target / Math.max(w, h))
  let tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale))
  let src: HTMLImageElement | HTMLCanvasElement = img
  // প্রতি ধাপে অর্ধেক — এক লাফে নামানোর বদলে
  while (w / 2 > tw && h / 2 > th) {
    const half = document.createElement('canvas')
    half.width = Math.max(1, Math.floor(w / 2))
    half.height = Math.max(1, Math.floor(h / 2))
    const hc = half.getContext('2d')!
    hc.imageSmoothingEnabled = true
    hc.imageSmoothingQuality = 'high'
    hc.drawImage(src, 0, 0, half.width, half.height)
    src = half
    w = half.width
    h = half.height
  }
  const out = document.createElement('canvas')
  out.width = tw
  out.height = th
  const oc = out.getContext('2d')!
  oc.imageSmoothingEnabled = true
  oc.imageSmoothingQuality = 'high'
  oc.drawImage(src, 0, 0, tw, th)
  return out
}

export interface AvatarVariants { full: Blob; small: Blob }

// প্রোফাইল-ছবি প্রসেসিং: ফুল (≤800px) + ছোট (≤200px) JPEG — দুটোই শার্প।
export async function processAvatar(file: Blob): Promise<AvatarVariants> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('ছবিটি পড়া যায়নি'))
      i.src = url
    })
    const toBlob = (canvas: HTMLCanvasElement, q: number) =>
      new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', q))
    const fullCanvas = await stepwiseScale(img, 800)
    const smallCanvas = await stepwiseScale(img, 200)
    return { full: await toBlob(fullCanvas, 0.92), small: await toBlob(smallCanvas, 0.86) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// চ্যাট-ওয়ালপেপার: ছবিকে কমপ্রেস করে ছোট ডেটা-URL বানাই।
// সার্ভার (D1) বড় স্ট্রিং রাখতে পারে না — ১২৮০px/JPEG-এ নামিয়ে ~90KB-এর
// নিচে রাখা হয়, নইলে আপলোড ব্যর্থ বা ট্রাঙ্কেটেড (ভাঙা) ওয়ালপেপার হতো।
export async function wallpaperDataUrl(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('ছবিটি পড়া যায়নি'))
      i.src = url
    })
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    let out = canvas.toDataURL('image/jpeg', 0.72)
    if (out.length > 90_000) out = canvas.toDataURL('image/jpeg', 0.5)
    if (out.length > 100_000) throw new Error('ছবিটি খুব বড় — একটু ছোট ছবি দিন')
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}
