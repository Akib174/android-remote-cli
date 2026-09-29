// Minimal HS256 JWT implementation on WebCrypto (no dependencies).
import { b64u, b64uToBytes } from './util'

const enc = new TextEncoder()
const dec = new TextDecoder()

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signJwt(payload: Record<string, unknown>, secret: string, ttlSec: number): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const full = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec }
  const head = b64u(enc.encode(JSON.stringify(header)))
  const body = b64u(enc.encode(JSON.stringify(full)))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`))
  return `${head}.${body}.${b64u(sig)}`
}

export async function verifyJwt(token: string, secret: string): Promise<Record<string, any> | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const sig = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64uToBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`))
    if (!sig) return null
    const payload = JSON.parse(dec.decode(b64uToBytes(parts[1])))
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
