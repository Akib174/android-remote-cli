// Double Ratchet — প্রতিটি মেসেজের জন্য আলাদা কী (forward secrecy)।
// হেডার: {pk: র‍্যামচেট পাবলিক কী, pn: আগের সেন্ড-চেইনের দৈর্ঘ্য, n: সিকোয়েন্স}
import { b64u, b64uToBytes } from '../lib/utils'

export interface RatchetState {
  rootKey: string                  // b64u
  sendDhPriv: JsonWebKey | null    // আমার বর্তমান র‍্যামচেট প্রাইভেট
  sendChainKey: string | null      // b64u
  sendIdx: number
  prevSendCount: number
  recvKey: JsonWebKey | null       // রিমোটের সর্বশেষ র‍্যামচেট পাবলিক
  recvChainKey: string | null
  recvIdx: number
  skipped: Record<string, string>  // `${pk}:${n}` → msgKey
}

const te = new TextEncoder()

export async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: string, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: te.encode(info) as BufferSource }, key, len * 8,
  )
  return new Uint8Array(bits)
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource))
}

// KDF_RK: (rootKey, dhOut) → (newRootKey, chainKey)
export async function kdfRoot(rootKey: Uint8Array, dhOut: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const out = await hkdf(rootKey, dhOut, 'fcfc-rk', 64)
  return [out.slice(0, 32), out.slice(32)]
}

// chainKey → (messageKey, nextChainKey)
export async function kdfChain(chainKey: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const msgKey = await hmac(chainKey, new Uint8Array([1]))
  const next = await hmac(chainKey, new Uint8Array([2]))
  return [msgKey, next]
}

export function pkFingerprint(jwk: JsonWebKey): string {
  return `${jwk.x}`
}

export function skipKeyRef(jwk: JsonWebKey, n: number) {
  return `${pkFingerprint(jwk)}:${n}`
}

async function aesEncrypt(key: Uint8Array, plain: Uint8Array): Promise<{ ct: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt'])
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, k, plain as BufferSource)
  return { ct: b64u(ct), iv: b64u(iv) }
}

async function aesDecrypt(key: Uint8Array, ctB64: string, ivB64: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['decrypt'])
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uToBytes(ivB64) as BufferSource }, k, b64uToBytes(ctB64) as BufferSource)
  return new Uint8Array(out)
}

export async function ratchetEncrypt(st: RatchetState, plainObj: any, pubJwk: JsonWebKey): Promise<{ ct: string; iv: string; hdr: any }> {
  if (!st.sendChainKey || !st.sendDhPriv) throw new Error('send chain not initialised')
  const chainKey = b64uToBytes(st.sendChainKey)
  const [msgKey, nextChain] = await kdfChain(chainKey)
  const { ct, iv } = await aesEncrypt(msgKey, te.encode(JSON.stringify(plainObj)))
  const hdr = { pk: pubJwk, pn: st.prevSendCount, n: st.sendIdx }
  st.sendChainKey = b64u(nextChain)
  st.sendIdx++
  return { ct, iv, hdr }
}

export interface DecryptCtx {
  deriveDh: (remotePub: JsonWebKey) => Promise<Uint8Array>        // DH(আমার বর্তমান সেন্ড কী, রিমোট)
  newSendKey: () => Promise<{ priv: JsonWebKey; pub: JsonWebKey; dhWithRemote: (r: JsonWebKey) => Promise<Uint8Array> }>
  save: () => void
}

export async function ratchetDecrypt(st: RatchetState, msg: { ct: string; iv: string; hdr: any }, ctx: DecryptCtx): Promise<any> {
  const { hdr } = msg
  const ref = skipKeyRef(hdr.pk, hdr.n)

  // আগেই স্কিপ করা কী?
  if (st.skipped[ref]) {
    const key = b64uToBytes(st.skipped[ref])
    delete st.skipped[ref]
    const plain = await aesDecrypt(key, msg.ct, msg.iv)
    return JSON.parse(new TextDecoder().decode(plain))
  }

  // নতুন র‍্যামচেট কী এলে ডিএইচ-স্টেপ
  if (!st.recvKey || pkFingerprint(st.recvKey) !== pkFingerprint(hdr.pk)) {
    // পুরনো রিসিভ-চেইনের বাকি কীগুলো স্কিপ-লিস্টে
    if (st.recvKey && st.recvChainKey) {
      let chain = b64uToBytes(st.recvChainKey)
      for (let i = st.recvIdx; i < hdr.pn && i < st.recvIdx + 1000; i++) {
        const [mk, next] = await kdfChain(chain)
        st.skipped[skipKeyRef(st.recvKey, i)] = b64u(mk)
        chain = next
      }
      if (Object.keys(st.skipped).length > 800) st.skipped = {}
    }
    // রিসিভ সাইড: DH(আমার সেন্ড কী, ওদের নতুন কী)
    const dhRecv = await ctx.deriveDh(hdr.pk)
    const [rk1, recvChain] = await kdfRoot(b64uToBytes(st.rootKey), dhRecv)
    st.recvKey = hdr.pk
    st.recvChainKey = b64u(recvChain)
    st.recvIdx = 0
    st.prevSendCount = st.sendIdx
    // সেন্ড সাইড: নতুন সেন্ড কী জেনারেট
    const nk = await ctx.newSendKey()
    st.sendDhPriv = nk.priv
    const dhSend = await nk.dhWithRemote(hdr.pk)
    const [rk2, sendChain] = await kdfRoot(rk1, dhSend)
    st.rootKey = b64u(rk2)
    st.sendChainKey = b64u(sendChain)
    st.sendIdx = 0
  }

  // সিকোয়েন্স পর্যন্ত কী এগিয়ে নেওয়া
  let chain = b64uToBytes(st.recvChainKey!)
  while (st.recvIdx < hdr.n) {
    const [mk, next] = await kdfChain(chain)
    st.skipped[skipKeyRef(st.recvKey!, st.recvIdx)] = b64u(mk)
    chain = next
    st.recvIdx++
  }
  const [msgKey, nextChain] = await kdfChain(chain)
  st.recvChainKey = b64u(nextChain)
  st.recvIdx++
  const plain = await aesDecrypt(msgKey, msg.ct, msg.iv)
  // ডিক্রিপ্ট **সফল হলে** সেভ — আগে আগে সেভ হতো, তাই জিসিএম-ব্যর্থ মেসেজের
  // কী চেইন থেকে খরচ হয়ে যেত, রি-ডেলিভারি আর কখনো ডিক্রিপ্ট হতো না।
  ctx.save()
  return JSON.parse(new TextDecoder().decode(plain))
}
