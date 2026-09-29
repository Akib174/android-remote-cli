// ফাইল এনক্রিপশন — ক্লায়েন্ট-সাইডে, আপলোডের আগে।
// প্রতি 1MB চাঙ্ক আলাদা কাউন্টার-ভিত্তিক নন্সে দিয়ে এনক্রিপ্ট হয়
// (বড় ফাইলে র‍্যান্ডম-অ্যাক্সেস স্ট্রিমিং সম্ভব রাখতে)।
import { b64u, b64uToBytes } from '../lib/utils'

const CHUNK = 1024 * 1024

export interface EncryptedBlob { blob: Blob; key: string; iv: string; size: number }

function nonceFor(base: Uint8Array, i: number) {
  const iv = base.slice()
  const dv = new DataView(iv.buffer)
  dv.setUint32(8, dv.getUint32(8) + i, false)
  return iv
}

export async function encryptBlob(input: Blob): Promise<EncryptedBlob> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  const baseIv = crypto.getRandomValues(new Uint8Array(12))
  const parts: BlobPart[] = []
  let i = 0
  for (let off = 0; off < input.size; off += CHUNK) {
    const chunk = input.slice(off, Math.min(off + CHUNK, input.size))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceFor(baseIv, i) as BufferSource }, key, await chunk.arrayBuffer())
    parts.push(new Uint8Array(ct))
    i++
  }
  return { blob: new Blob(parts), key: b64u(rawKey), iv: b64u(baseIv), size: input.size }
}

export async function decryptBlob(enc: Blob, keyB64: string, ivB64: string): Promise<Blob> {
  const key = await crypto.subtle.importKey('raw', b64uToBytes(keyB64) as BufferSource, 'AES-GCM', false, ['decrypt'])
  const baseIv = b64uToBytes(ivB64)
  const parts: BlobPart[] = []
  let i = 0
  // প্রতিটি এনক্রিপ্টেড চাঙ্ক = প্লেইন চাঙ্ক + 16 বাইট ট্যাগ
  for (let off = 0; off < enc.size; off += CHUNK + 16) {
    const chunk = enc.slice(off, Math.min(off + CHUNK + 16, enc.size))
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonceFor(baseIv, i) as BufferSource }, key, await chunk.arrayBuffer())
    parts.push(new Uint8Array(plain))
    i++
  }
  return new Blob(parts)
}

// ছোট ফাইলের (স্টিকার/ছবি) থাম্বনেইল বানানো
export function makeThumb(file: Blob, max = 320): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((b) => { URL.revokeObjectURL(url); resolve(b) }, 'image/jpeg', 0.6)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}
