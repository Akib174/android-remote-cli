// X3DH-style প্রাথমিক কী-এক্সচেঞ্জ (Signal-inspired)।
// ইনিশিয়েটর: dh1=IKa×SPKb, dh2=EKa×IKb, dh3=EKa×SPKb, dh4=EKa×OPKb (থাকলে)
// ডাবল-র‍্যামচেট স্পেক অনুযায়ী একাধিক ডিভাইসের প্রথম হ্যান্ডশেকের জন্য
// এফেমেরাল কী-ই প্রথম র‍্যামচেট কী হিসেবে পুনর্ব্যবহার করা হয়েছে।
import { dh, genDH, importPrivJwk, importPubJwk, loadIdentityBundle, verifySignedPrekey } from './keys'
import { hkdf } from './ratchet'

export interface PrekeyBundle {
  identityPub: JsonWebKey
  signPub: JsonWebKey
  spkPub: JsonWebKey
  spkSig: string
  opkPub: JsonWebKey | null
}

export interface Handshake { ik: JsonWebKey; ek: JsonWebKey; opk: JsonWebKey | null }

export interface X3dhResult {
  rootKey: Uint8Array
  dh3: Uint8Array // EKa×SPKb — প্রথম র‍্যামচেট স্টেপে পুনর্ব্যবহার হয়
  handshake: Handshake | null
  ekaPriv: JsonWebKey | null
  ekaPub: JsonWebKey | null
}

export async function x3dhInitiate(their: PrekeyBundle): Promise<X3dhResult> {
  if (!(await verifySignedPrekey(their.spkPub, their.spkSig, their.signPub))) {
    throw new Error('signed prekey signature invalid')
  }
  const me = await loadIdentityBundle()
  if (!me) throw new Error('identity not ready')

  const ek = await genDH()
  const ekPriv = await crypto.subtle.exportKey('jwk', ek.privateKey)
  const ekPub = await crypto.subtle.exportKey('jwk', ek.publicKey)

  const ikB = await importPubJwk(their.identityPub)
  const spkB = await importPubJwk(their.spkPub)
  const ekKey = await importPrivJwk(ekPriv, ['deriveBits'])

  const dh1 = await dh(me.identity.privateKey, spkB)
  const dh2 = await dh(ekKey, ikB)
  const dh3 = await dh(ekKey, spkB)
  const parts = [dh1, dh2, dh3]
  if (their.opkPub) {
    const opkB = await importPubJwk(their.opkPub)
    parts.push(await dh(ekKey, opkB))
  }
  const concat = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let off = 0
  for (const p of parts) { concat.set(p, off); off += p.length }
  const rootKey = await hkdf(new Uint8Array(32), concat, 'fcfc-x3dh', 32)

  const ikPub = await crypto.subtle.exportKey('jwk', me.identity.publicKey)
  return {
    rootKey,
    dh3,
    handshake: { ik: ikPub, ek: ekPub, opk: their.opkPub },
    ekaPriv: ekPriv,
    ekaPub: ekPub,
  }
}

// রিসিভার সাইড: হ্যান্ডশেক দেখে নিজের দিকের শেয়ার্ড সিক্রেট বানানো
export async function x3dhRespond(hs: Handshake): Promise<{ rootKey: Uint8Array; dh3Shared: Uint8Array }> {
  const me = await loadIdentityBundle()
  if (!me) throw new Error('identity not ready')
  const ikA = await importPubJwk(hs.ik)
  const ekA = await importPubJwk(hs.ek)

  const dh1 = await dh(me.signedPrekey.privateKey, ikA)
  const dh2 = await dh(me.identity.privateKey, ekA)
  const dh3 = await dh(me.signedPrekey.privateKey, ekA)
  const parts = [dh1, dh2, dh3]

  if (hs.opk) {
    // ব্যবহৃত ওয়ান-টাইম প্রিকিটি লোকাল তালিকা থেকে খুঁজে বের করা
    const opkPubJson = JSON.stringify(hs.opk)
    let found = false
    for (const otk of me.otks) {
      const pub = await crypto.subtle.exportKey('jwk', otk.publicKey)
      if (JSON.stringify(pub) === opkPubJson) {
        parts.push(await dh(otk.privateKey, ekA))
        found = true
        break
      }
    }
    // প্রিকি না পেলে আগে নীরবে ৩-অংশের সিক্রেট বানানো হতো — ইনিশিয়েটরের
    // ৪-অংশের সাথে মিলত না, সেশনটা চিরকালের জন্য ভাঙা থাকত। এখন স্পষ্ট এরর।
    if (!found) throw new Error('one-time prekey not found locally (rotated/restored backup?)')
  }
  const concat = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let off = 0
  for (const p of parts) { concat.set(p, off); off += p.length }
  const rootKey = await hkdf(new Uint8Array(32), concat, 'fcfc-x3dh', 32)
  return { rootKey, dh3Shared: dh3 }
}
