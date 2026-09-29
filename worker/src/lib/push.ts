// Minimal Web Push sender: VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291).
// সব ক্রিপ্টো ওয়ার্কার স্ট্যান্ডার্ড WebCrypto দিয়ে — কোনো ডিপেন্ডেন্সি নেই।
import { b64u, b64uToBytes, concatBytes } from './util'

const enc = new TextEncoder()

async function importVapidKeys(pubX: string, pubY: string, privD: string) {
  const jwkBase: any = { kty: 'EC', crv: 'P-256', x: pubX, y: pubY }
  const priv = await crypto.subtle.importKey(
    'jwk', { ...jwkBase, d: privD },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  )
  return { priv }
}

async function vapidJwt(endpoint: URL, privKey: CryptoKey, contact: string): Promise<string> {
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(enc.encode(JSON.stringify({
    aud: `${endpoint.protocol}//${endpoint.host}`,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: contact || 'mailto:admin@localhost',
  })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, enc.encode(`${head}.${body}`))
  return `${head}.${body}.${b64u(sig)}`
}

async function hkdfImport(ikm: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
}

async function hkdfBits(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bits: number): Promise<Uint8Array> {
  const key = await hkdfImport(ikm)
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, bits,
  ))
}

function importRawP256(raw: Uint8Array, usages: any[]): Promise<CryptoKey> {
  // ⚠️ পাবলিক কী-র জন্য usages অবশ্যই খালি লিস্ট হবে (WebCrypto স্পেক) —
  // নইলে স্পেক-কমপ্লায়েন্ট রানটাইম (workerd/Node) SyntaxError ছুঁড়ে দেয়।
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, usages)
}

// RFC 8291 — aes128gcm কন্টেন্ট কোডিং।
// দুই-ধাপের HKDF (আগে এক ধাপ ছিল — CEK/nonce কখনো সঠিকভাবে derive হতো না):
//   ১) IKM = HKDF(salt=auth_secret, ikm=ecdh_secret,
//                 info="WebPush: info"||0x00||ua_public||as_public, L=32)
//   ২) CEK   = HKDF(salt=<হেডারের ১৬-বাইট সল্ট>, ikm=IKM,
//                   info="Content-Encoding: aes128gcm"||0x00, L=16)
//      NONCE = HKDF(salt=<একই সল্ট>, ikm=IKM,
//                   info="Content-Encoding: nonce"||0x00, L=12)
// হেডারে অবশ্যই sender-এর ephemeral ECDH পাবলিক কী (keyid) যেতে হয় —
// নইলে ব্রাউজার shared secret বানাতে পারে না (idlen=0 পাঠানো ভুল ছিল)।
async function encryptPush(payload: Uint8Array, sub: any): Promise<Uint8Array> {
  const p256dh = b64uToBytes(sub.keys.p256dh)
  const authSecret = b64uToBytes(sub.keys.auth)
  const eph = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const ephRaw = new Uint8Array((await crypto.subtle.exportKey('raw', eph.publicKey as CryptoKey)) as ArrayBuffer)
  const uaPub = await importRawP256(p256dh, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPub } as any, eph.privateKey, 256))

  // ধাপ ১: ECDH সিক্রেট + auth সিক্রেট মিশিয়ে IKM
  const keyInfo = concatBytes(enc.encode('WebPush: info\0'), p256dh, ephRaw)
  const ikm = await hkdfBits(authSecret, ecdh, keyInfo, 256)

  // ধাপ ২: মেসেজ-স্পেসিফিক সল্ট থেকে CEK ও NONCE
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cekInfo = enc.encode('Content-Encoding: aes128gcm\0')
  const nonceInfo = enc.encode('Content-Encoding: nonce\0')
  const cek = await hkdfBits(salt, ikm, cekInfo, 128)
  const nonce = await hkdfBits(salt, ikm, nonceInfo, 96)

  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt'])
  // রেকর্ড = প্লেইনটেক্সট + ডেলিমিটার 0x02 (শেষ রেকর্ড)
  const recordPlain = concatBytes(payload, new Uint8Array([2]))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, recordPlain as BufferSource))

  // aes128gcm হেডার: salt(16) | rs(4, big-endian) | idlen(1) | keyid(idlen বাইট)
  const header = new Uint8Array(21 + ephRaw.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096, false)
  header[20] = ephRaw.length
  header.set(ephRaw, 21)
  return concatBytes(header, ct)
}

export type PushPayload = { title: string; body: string; tag?: string; url?: string; silent?: boolean; data?: Record<string, unknown> }

export async function sendWebPush(env: any, sub: any, msg: PushPayload): Promise<boolean> {
  try {
    const endpoint = new URL(sub.endpoint)
    const pubB64 = String(env.VAPID_PUBLIC_KEY || '')
    if (pubB64.length < 80) throw new Error('VAPID keys not configured')
    // raw uncompressed P-256 point: 0x04 || x(32) || y(32)
    const raw = b64uToBytes(pubB64)
    const x = b64u(raw.subarray(1, 33))
    const y = b64u(raw.subarray(33, 65))
    const { priv } = await importVapidKeys(x, y, String(env.VAPID_PRIVATE_KEY))
    const jwtToken = await vapidJwt(endpoint, priv, String(env.PUSH_CONTACT || ''))
    const p256ecdsa = pubB64

    const body = await encryptPush(enc.encode(JSON.stringify(msg)), sub)
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'authorization': `WebPush ${jwtToken}`,
        'crypto-key': `p256ecdsa=${p256ecdsa}`,
        'content-type': 'application/octet-stream',
        'content-encoding': 'aes128gcm',
        // TTL ২৪ ঘণ্টা — ডিভাইস অফলাইন থাকলেও পুশ-সার্ভিস মেসেজটা জমা রাখে
        'ttl': '86400',
        'urgency': 'high',
        'topic': msg.tag || 'fcfc',
      },
      body: body as BufferSource,
    })
    if (res.status === 404 || res.status === 410) return false // সাবস্ক্রিপশন মেয়াদোত্তীর্ণ
    return res.ok
  } catch {
    return false
  }
}

// এক ইউজারের সব সাবস্ক্রিপশনে পুশ (ব্যর্থ হলে সেই সাবস্ক্রিপশন মুছে যায়)
export async function pushToUser(env: any, db: any, userId: string, msg: PushPayload) {
  const res = await db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').bind(userId).all()
  const rows: any[] = res.results || []
  await Promise.all(
    rows.map(async (r: any) => {
      const ok = await sendWebPush(env, { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, msg)
      if (!ok) await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(r.endpoint).run().catch(() => {})
    }),
  )
}
