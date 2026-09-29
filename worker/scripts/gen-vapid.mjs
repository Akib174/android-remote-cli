// VAPID কী জেনারেটর: `npm run vapid`
// আউটপুট থেকে দুটি সিক্রেট `wrangler secret put` দিয়ে সেট করুন।
import { webcrypto } from 'node:crypto'

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))
const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey)

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

console.log('# wrangler secret put VAPID_PUBLIC_KEY  →', b64u(raw))
console.log('# wrangler secret put VAPID_PRIVATE_KEY →', jwk.d)
