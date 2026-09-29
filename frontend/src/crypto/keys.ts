// আইডেন্টিটি কী জেনারেশন ও স্টোরেজ (সব ক্লায়েন্ট-সাইডে, IndexedDB-তে)।
// X25519 → ডিফি-হেলম্যান, ECDSA P-256 → সিগনেড-প্রিকি যাচাই।
import { idb } from '../lib/db'
import { b64u } from '../lib/utils'

export const SIGN_ALG = { name: 'ECDSA', namedCurve: 'P-256' } as EcKeyGenParams

// X25519 সাপোর্ট নেই এমন (পুরনো) ব্রাউজারের জন্য P-256 ফলব্যাক —
// এনক্রিপশন একই রকম শক্তিশালী থাকে, শুধু কার্ভ বদলায়।
const X25519_ALG = { name: 'ECDH', namedCurve: 'X25519' } as EcKeyGenParams
const P256_DH_ALG = { name: 'ECDH', namedCurve: 'P-256' } as EcKeyGenParams

let cachedDhAlg: EcKeyGenParams | null = null
export async function dhAlg(): Promise<EcKeyGenParams> {
  if (cachedDhAlg) return cachedDhAlg
  try {
    await crypto.subtle.generateKey(X25519_ALG, true, ['deriveBits'])
    cachedDhAlg = X25519_ALG
  } catch {
    cachedDhAlg = P256_DH_ALG
  }
  return cachedDhAlg
}

export const genDH = () => dhAlg().then((alg) => crypto.subtle.generateKey(alg, true, ['deriveBits']))
export const genSign = () => crypto.subtle.generateKey(SIGN_ALG, true, ['sign', 'verify'])

export const exportJwk = (k: CryptoKey) => crypto.subtle.exportKey('jwk', k)

// Chrome/Edge এক্সপোর্টেড JWK-তে `key_ops: []` দেয় — সেটা থাকলে importKey
// "key_ops inconsistent" DataError দেয়। তাই ইম্পোর্টের আগে key_ops বাদ দিই।
function cleanJwk(jwk: JsonWebKey): JsonWebKey {
  const { key_ops, ...rest } = jwk as JsonWebKey & { key_ops?: unknown }
  return { ...rest, ext: true } as JsonWebKey
}
export function importPubJwk(jwk: JsonWebKey, usages: KeyUsage[] = []): Promise<CryptoKey> {
  const c = cleanJwk(jwk)
  const alg = c.crv === 'X25519' ? X25519_ALG : usages.includes('verify') ? SIGN_ALG : P256_DH_ALG
  return crypto.subtle.importKey('jwk', c, alg, true, usages)
}
export function importPrivJwk(jwk: JsonWebKey, usages: KeyUsage[]): Promise<CryptoKey> {
  const c = cleanJwk(jwk)
  // প্রাইভেট কী-তে 'verify' অ্যালাউড নয় (ওটা পাবলিক-কী অপ) — থাকলে SyntaxError
  const u = usages.filter((x) => x !== 'verify')
  const alg = c.crv === 'X25519' ? X25519_ALG : u.includes('sign') ? SIGN_ALG : P256_DH_ALG
  return crypto.subtle.importKey('jwk', c, alg, false, u)
}

export async function dh(priv: CryptoKey, pub: CryptoKey): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256)
  return new Uint8Array(bits)
}

export interface IdentityBundle {
  identity: CryptoKeyPair      // X25519
  signing: CryptoKeyPair       // ECDSA P-256
  signedPrekey: CryptoKeyPair  // X25519
  spkSig: string               // base64url
  otks: CryptoKeyPair[]        // one-time prekeys
}

const K = { identity: 'identity', signing: 'signing', spk: 'signedPrekey', spkSig: 'spkSig', otks: 'otks' }

export async function createIdentityBundle(): Promise<IdentityBundle> {
  const [identity, signing, signedPrekey] = await Promise.all([genDH(), genSign(), genDH()])
  const spkJwk = await exportJwk(signedPrekey.publicKey)
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signing.privateKey, new TextEncoder().encode(JSON.stringify(spkJwk)))
  const spkSig = b64u(sig)
  const otks = await Promise.all(Array.from({ length: 20 }, () => genDH()))
  const bundle: IdentityBundle = { identity, signing, signedPrekey, spkSig, otks }
  await persistBundle(bundle)
  return bundle
}

export async function persistBundle(b: IdentityBundle) {
  await idb.put('keys', K.identity, { pub: await exportJwk(b.identity.publicKey), priv: await exportJwk(b.identity.privateKey) })
  await idb.put('keys', K.signing, { pub: await exportJwk(b.signing.publicKey), priv: await exportJwk(b.signing.privateKey) })
  await idb.put('keys', K.spk, { pub: await exportJwk(b.signedPrekey.publicKey), priv: await exportJwk(b.signedPrekey.privateKey) })
  await idb.put('keys', K.spkSig, b.spkSig)
  await idb.put('keys', K.otks, await Promise.all(b.otks.map(async (k) => ({ pub: await exportJwk(k.publicKey), priv: await exportJwk(k.privateKey) }))))
}

export async function loadIdentityBundle(): Promise<IdentityBundle | null> {
  const identity = await idb.get('keys', K.identity)
  if (!identity) return null
  const [signing, spk, spkSig, otks] = await Promise.all([
    idb.get('keys', K.signing), idb.get('keys', K.spk), idb.get('keys', K.spkSig), idb.get('keys', K.otks),
  ])
  const toPair = async (o: any, usages: KeyUsage[]): Promise<CryptoKeyPair> => ({
    publicKey: await importPubJwk(o.pub, usages.includes('verify') ? ['verify'] : []),
    privateKey: await importPrivJwk(o.priv, usages),
  })
  return {
    identity: await toPair(identity, ['deriveBits']),
    signing: await toPair(signing, ['sign', 'verify']),
    signedPrekey: await toPair(spk, ['deriveBits']),
    spkSig,
    otks: await Promise.all((otks || []).map((o: any) => toPair(o, ['deriveBits']))),
  }
}

// সার্ভারে আপলোডের জন্য শুধুই পাবলিক অংশ
export async function publicBundleForUpload(b: IdentityBundle) {
  return {
    identityPub: await exportJwk(b.identity.publicKey),
    signPub: await exportJwk(b.signing.publicKey),
    spkPub: await exportJwk(b.signedPrekey.publicKey),
    spkSig: b.spkSig,
    otks: await Promise.all(b.otks.map((k) => exportJwk(k.publicKey))),
  }
}

export async function verifySignedPrekey(spkPub: JsonWebKey, sig: string, signPub: JsonWebKey): Promise<boolean> {
  try {
    const key = await importPubJwk(signPub, ['verify'])
    const sigBytes = (() => { const s = sig.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - sig.length % 4) % 4); const bin = atob(s); return Uint8Array.from([...bin].map((c) => c.charCodeAt(0))) })()
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, new TextEncoder().encode(JSON.stringify(spkPub)))
  } catch { return false }
}
