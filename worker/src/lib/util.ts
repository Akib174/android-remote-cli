// Small shared helpers.
export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })

export const err = (message: string, status = 400) => json({ error: message }, status)

export const uid = (prefix = '') =>
  prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 22)

export const now = () => Date.now()

const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

export const b64uToStr = (s: string) => b64u(b64uToBytes(s))

export function randHex(bytes = 16): string {
  const u8 = new Uint8Array(bytes)
  crypto.getRandomValues(u8)
  return [...u8].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/

export function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((a, b) => a + b.length, 0)
  const out = new Uint8Array(len)
  let off = 0
  for (const a of arrs) { out.set(a, off); off += a.length }
  return out
}
