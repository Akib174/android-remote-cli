// পাসওয়ার্ড যাচাই — ভারী PBKDF2 (৬০০k রাউন্ড) চলে ক্লায়েন্ট-সাইডে (ব্রাউজারে),
// কারণ Workers ফ্রি প্ল্যানের CPU-লিমিট মাত্র ১০ms।
// সার্ভার রাখে ক্লায়েন্ট-হ্যাশের সল্টেড SHA-256 — হালকা ও নিরাপদ:
// DB লিক হলেও আক্রমণকারী সরাসরি পাসওয়ার্ড পায় না, পায় ক্লায়েন্ট-হ্যাশের হ্যাশ।
import { b64u, randHex } from './util'

export async function hashPassword(clientHash: string): Promise<{ hash: string; salt: string }> {
  const salt = randHex(16)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${clientHash}`))
  return { hash: b64u(digest), salt }
}

export async function verifyPassword(clientHash: string, hash: string, salt: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${clientHash}`))
  const check = b64u(digest)
  if (check.length !== hash.length) return false
  let diff = 0
  for (let i = 0; i < check.length; i++) diff |= check.charCodeAt(i) ^ hash.charCodeAt(i)
  return diff === 0
}
