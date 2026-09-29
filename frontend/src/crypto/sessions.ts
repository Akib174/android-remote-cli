// 1:1 সেশন ম্যানেজার — X3DH + Double Ratchet একসাথে, ইনডেক্সডডিবি-তে সংরক্ষিত।
//
// ইনিশিয়েশন (সিগনাল স্পেক অনুযায়ী):
//   ইনিশিয়েটর: প্রথম র‍্যামচেট কী = তার এফেমেরাল কী (EKa)।
//     CKs = KDF_RK(RK0, DH(EKa, SPKb)) — এটাই তার সেন্ড-চেইন।
//   রিসিভার: প্রথম মেসেজের হ্যান্ডশেক থেকে
//     CKr = KDF_RK(RK0, DH(SPKb, EKa)) — রিসিভ-চেইন।
//     নিজের প্রথম উত্তর পাঠানোর আগে নতুন র‍্যামচেট কী জেনারেট করে
//     সেন্ড-চেইন বানায় (ঠিক যেভাবে ডাবল-র‍্যামচেট স্পেক বলে)।
import { idb } from '../lib/db'
import { api } from '../api/client'
import { genDH, exportJwk, importPrivJwk, importPubJwk, loadIdentityBundle, dh } from './keys'
import { x3dhInitiate, x3dhRespond, type Handshake, type PrekeyBundle } from './x3dh'
import { kdfRoot, ratchetDecrypt, ratchetEncrypt, type RatchetState } from './ratchet'
import { b64u } from '../lib/utils'
import { markBackupDirty } from './backup'

export interface SessionState extends RatchetState {
  peerId: string
  established: boolean
  _pendingHs?: Handshake | null
  _sendPub?: JsonWebKey | null
}

export const getSession = (peerId: string) => idb.get<SessionState>('sessions', peerId)
// সেশন বদলালে কী-ব্যাকআপ dirty — ৪৫ সেকেন্ডের মধ্যে সিঙ্ক হবে (নতুন ডিভাইসে
// রিস্টোর তাজা থাকে; আগে ব্যাকআপ শুধু লগইনের মুহূর্তের ছিল)
export const saveSession = (s: SessionState) => { markBackupDirty(); return idb.put('sessions', s.peerId, { ...s }) }

export interface Envelope { v: 1; ct: string; iv: string; hdr: any; hs?: Handshake }

export async function ensureSession(peerId: string): Promise<SessionState> {
  let st = await getSession(peerId)
  if (st?.established) return st
  const bundle: PrekeyBundle = await api(`/users/${peerId}/prekeys`)
  const x = await x3dhInitiate(bundle)
  const [rk, chain] = await kdfRoot(x.rootKey, x.dh3)
  st = {
    peerId,
    rootKey: b64u(rk),
    sendDhPriv: x.ekaPriv,
    sendChainKey: b64u(chain),
    sendIdx: 0,
    prevSendCount: 0,
    recvKey: bundle.spkPub,    // রিসিভারের প্রথম র‍্যামচেট কী = ওর সাইনড প্রিকি
    recvChainKey: null,
    recvIdx: 0,
    skipped: {},
    established: true,
    _pendingHs: x.handshake,
    _sendPub: x.ekaPub,
  }
  await saveSession(st)
  return st
}

// সেন্ড-চেইন না থাকলে (রিসিভার প্রথম উত্তর পাঠাচ্ছে) নতুন র‍্যামচেট স্টেপ
async function ensureSendChain(st: SessionState) {
  if (st.sendChainKey && st.sendDhPriv && st._sendPub) return
  if (!st.recvKey) throw new Error('cannot establish send chain')
  const pair = await genDH()
  const priv = await exportJwk(pair.privateKey)
  const pub = await exportJwk(pair.publicKey)
  const privKey = await importPrivJwk(priv, ['deriveBits'])
  const remoteKey = await importPubJwk(st.recvKey)
  const dhOut = await dh(privKey, remoteKey)
  const [rk, chain] = await kdfRoot(b64uToBytesSafe(st.rootKey), dhOut)
  st.rootKey = b64u(rk)
  st.sendDhPriv = priv
  st.sendChainKey = b64u(chain)
  st.sendIdx = 0
  st.prevSendCount = st.recvIdx // স্পেক: pn = রিমোট চেইনে পাঠানো মেসেজের সংখ্যা
  st._sendPub = pub
}

function b64uToBytesSafe(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

export async function encryptFor(peerId: string, obj: any): Promise<Envelope> {
  return withPeerLock(peerId, () => encryptForInner(peerId, obj))
}
async function encryptForInner(peerId: string, obj: any): Promise<Envelope> {
  const st = await ensureSession(peerId)
  await ensureSendChain(st)
  const enc = await ratchetEncrypt(st, obj, st._sendPub!)
  const hs = st._pendingHs || undefined
  st._pendingHs = null
  await saveSession(st)
  const env: Envelope = { v: 1, ...enc }
  if (hs) env.hs = hs
  return env
}

export async function decryptFrom(peerId: string, env: Envelope): Promise<any> {
  return withPeerLock(peerId, () => decryptFromInner(peerId, env, 0))
}

// একই পিয়ের এনক্রিপ্ট/ডিক্রিপ্ট কখনো সমান্তরালে চলবে না —
// নইলে র‍্যামচেট স্টেটে race হয়ে চেইন ভেঙে যায়
const peerLocks = new Map<string, Promise<void>>()
export function withPeerLock<T>(peerId: string, fn: () => Promise<T>): Promise<T> {
  const prev = peerLocks.get(peerId) || Promise.resolve()
  const run = prev.then(fn)
  peerLocks.set(peerId, run.then(() => undefined, () => undefined))
  return run
}

async function decryptFromInner(peerId: string, env: Envelope, attempt: number): Promise<any> {
  let st = await getSession(peerId)
  if (!st && env.hs) {
    // আমাদের কাছে সেশন নেই — হ্যান্ডশেক থেকে তৈরি (রিসিভার সাইড)
    const { rootKey, dh3Shared } = await x3dhRespond(env.hs)
    const [rk, recvChain] = await kdfRoot(rootKey, dh3Shared)
    st = {
      peerId,
      rootKey: b64u(rk),
      sendDhPriv: null,        // প্রথম উত্তরের আগে নতুন র‍্যামচেট কী হবে
      sendChainKey: null,
      sendIdx: 0,
      prevSendCount: 0,
      recvKey: env.hs.ek,      // ইনিশিয়েটরের প্রথম র‍্যামচেট কী = এফেমেরাল কী
      recvChainKey: b64u(recvChain),
      recvIdx: 0,
      skipped: {},
      established: true,
      _sendPub: null,
    }
  }
  if (!st) throw new Error('no session and no handshake')

  const state = st
  // প্রিস্টাইন স্ন্যাপশট — ratchetDecrypt ফেল করলে ও st-কে মিউটেট করে ফেলে;
  // হ্যান্ডশেক-রিসেটও যদি ব্যর্থ হয়, এই অক্ষত কপিটাই রিস্টোর হবে।
  const snapshot = env.hs ? (JSON.parse(JSON.stringify(st)) as SessionState) : null
  const ctx = {
    deriveDh: async (remotePub: JsonWebKey) => {
      if (!state.sendDhPriv) throw new Error('send chain not established')
      const priv = await importPrivJwk(state.sendDhPriv, ['deriveBits'])
      const pub = await importPubJwk(remotePub)
      return dh(priv, pub)
    },
    newSendKey: async () => {
      const pair = await genDH()
      const priv = await exportJwk(pair.privateKey)
      const pub = await exportJwk(pair.publicKey)
      state._sendPub = pub
      return {
        priv, pub,
        dhWithRemote: async (r: JsonWebKey) => {
          const privKey = await importPrivJwk(priv, ['deriveBits'])
          const pubKey = await importPubJwk(r)
          return dh(privKey, pubKey)
        },
      }
    },
    save: () => { void saveSession(state) },
  }
  let out
  try {
    out = await ratchetDecrypt(st, env, ctx)
  } catch (e) {
    // স্টেট ভেঙে গেলে এবং মেসেজে হ্যান্ডশেক থাকলে — পুরনো সেশন ফেলে নতুন করে গড়ি
    if (env.hs && attempt === 0) {
      // ⚠️ বাগ-ফিক্স: গ্রুপে sender-key বিতরণ এনভেলপ সব সদস্যকেই ব্রডকাস্ট
      // হয় — অন্য সদস্যের জন্য এনক্রিপ্ট করা এনভেলপে ওই সদস্যের জন্য বানানো
      // হ্যান্ডশেক থাকে। আগে এমন এনভেলপ ডিক্রিপ্ট করতে গিয়ে ব্যর্থ হলে
      // নিজের ভালো সেশনটাই ডিলিট হয়ে যেত, আর রিট্রাই-ও করত (প্রিকি তো
      // আমাদের নয়) — ফলে সেশন চিরতরে উধাও, পরের সব ১:১ মেসেজ আনডিক্রিপ্টেবল।
      // এখন: রিট্রাই ব্যর্থ হলে (হ্যান্ডশেক আমাদের না) পুরনো সেশন রিস্টোর।
      await idb.del('sessions', peerId)
      try {
        return await decryptFromInner(peerId, env, 1)
      } catch (e2) {
        const cur = await getSession(peerId).catch(() => null)
        if (!cur && snapshot) await saveSession(snapshot)
        throw e2
      }
    }
    throw e
  }
  await saveSession(st)
  return out
}
