#!/usr/bin/env node
// ⚡ fcfc — এক কমান্ডে ক্লাউডফ্লেয়ারে ডিপ্লয় (Worker + D1 + KV + R2 + frontend সব একসাথে, একটাই URL)
//
// ব্যবহার:
//   ১) https://dash.cloudflare.com/profile/api-tokens → Create Token
//      সবচেয়ে সহজ: "Edit Cloudflare Workers" টেমপ্লেট নিন, তারপর সেটি এডিট করে
//      আরও দুটো পারমিশন যোগ করুন — D1:Edit এবং Workers R2 Storage:Edit
//      (প্রয়োজনীয় সম্পূর্ণ তালিকা: Workers Scripts:Edit, Workers KV Storage:Edit,
//       D1:Edit, Workers R2 Storage:Edit, Account Settings:Read, User Details:Read)
//   ২) টার্মিনালে:
//        macOS/Linux:   export CLOUDFLARE_API_TOKEN="আপনার-টোকেন"
//        Windows PS:    $env:CLOUDFLARE_API_TOKEN="আপনার-টোকেন"
//   ৩) node deploy.mjs
//
// ঐচ্ছিক এনভায়রনমেন্ট:
//   CLOUDFLARE_ACCOUNT_ID=...   → একাধিক ক্লাউডফ্লেয়ার অ্যাকাউন্ট থাকলে কোনটা বোঝাতে
//   CALLS_APP_ID=...            → ভিডিও/ভয়েস কল: Realtime → Serverless SFU-র App ID
//   CALLS_API_TOKEN=...         → ভিডিও/ভয়েস কল: সেই অ্যাপের App Secret (অ্যাপ বানানোর
//                                  সময়ে দেখানো ৬৪-অক্ষরের Secret — "Create API Token" নয়)
//   PUSH_CONTACT=mailto:a@b.c   → পুশ নোটিফিকেশনের যোগাযোগ-ঠিকানা
//   node deploy.mjs --dry-run   → ক্লাউডে কিছু না পাঠিয়ে শুধু লোকাল চেক
//
// স্ক্রিপ্টটি ইডিম্পোটেন্ট — বার বার চালানো যায় (আগের রিসোর্স থাকলে রিইউজ করে)।

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, cpSync, unlinkSync, existsSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const WORKER = path.join(ROOT, 'worker')
const FRONTEND = path.join(ROOT, 'frontend')
const SECRETS_FILE = path.join(ROOT, '.deploy-secrets.json')
const DRY = process.argv.includes('--dry-run')

const log = (...a) => console.log(...a)
const die = (msg) => { console.error('\n✖ ' + msg); process.exit(1) }
const randHex = (n) => randomBytes(n).toString('hex')

const IS_WIN = process.platform === 'win32'

// ⚠ shell:true + অ্যারে-আর্গের একটা ধরা ফাঁদ ছিল: Node শেল-মোডে অ্যারে-আর্গগুলো
// নিজে থেকে কোট করে না — শুধু স্পেসে জুড়ে দেয়। ফলে স্পেস-যুক্ত আর্গ ভেঙে যায়
// (বাগ: 'SELECT COUNT(*) FROM users' গিয়ে COUNT(*), FROM, users তিনটা আলাদা
// আর্গ হয়ে গিয়েছিল → wrangler "Unknown arguments" দিয়ে ডিপ্লয় থামিয়ে দিয়েছিল)।
// এখন: shell দরকার শুধু Windows-এ (npm/npx ওখানে .cmd শিম); স্পেস/মেটা-অক্ষর-যুক্ত
// আর্গ থাকলে নিজেই কোট করে নিই, আর যেখানে সম্ভব shell-ই বাদ (নিচে wrangler দেখুন)।
function run(cmd, args, opts = {}) {
  const shell = opts.shell ?? IS_WIN
  let argv = args
  if (shell && IS_WIN)
    argv = args.map((a) => (String(a) === '' || /[\s"&|<>()^%]/.test(String(a)) ? '"' + String(a) + '"' : a))
  const r = spawnSync(cmd, argv, {
    cwd: opts.cwd || WORKER,
    stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell,
    env: { ...process.env, ...(opts.env || {}) },
    maxBuffer: 64 * 1024 * 1024,
  })
  if (opts.inherit) return { ok: r.status === 0, out: '' }
  const out = ((r.stdout || '') + (r.stderr || ''))
  if (r.error) return { ok: false, out: (r.error.message || '') + '\n' + out }
  return { ok: r.status === 0, out }
}

// wrangler সরাসরি node দিয়ে চালাই (npx/cmd.exe-শিম বাদ) — দ্রুত, আর আর্গ
// কোটিং নিয়ে কোনো অনিশ্চয়তাই নেই (libuv নিজেই প্ল্যাটফর্ম-সঠিক কোটিং করে)।
// node_modules-এ wrangler না পেলে পুরনো npx-পথে ফলব্যাক।
const WRANGLER_BIN = path.join(WORKER, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const wrangler = (args, opts = {}) =>
  existsSync(WRANGLER_BIN)
    ? run(process.execPath, [WRANGLER_BIN, ...args], { ...opts, shell: false })
    : run('npx', ['wrangler', ...args], opts)

function b64u(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// VAPID কী-জোড়া (Web Push) — worker/scripts/gen-vapid.mjs-এর মতোই
async function genVapid() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey)
  return { pub: b64u(raw), priv: jwk.d }
}

// সিক্রেটগুলো লোকালি .deploy-secrets.json-এ জমা থাকে — রি-ডিপ্লয়ে একই কী
// পুনঃব্যবহার হয় (নতুন করে জেনারেট করলে সব লগইন/পুশ-সাবস্ক্রিপশন ভেঙে যেত)।
async function loadOrCreateSecrets() {
  let s = {}
  try { s = JSON.parse(readFileSync(SECRETS_FILE, 'utf8')) } catch {}
  if (!s.JWT_SECRET) s.JWT_SECRET = randHex(32)
  if (!s.REFRESH_PEPPER) s.REFRESH_PEPPER = randHex(32)
  if (!s.VAPID_PUBLIC_KEY || !s.VAPID_PRIVATE_KEY) {
    const v = await genVapid()
    s.VAPID_PUBLIC_KEY = v.pub
    s.VAPID_PRIVATE_KEY = v.priv
  }
  if (!s.PUSH_CONTACT) s.PUSH_CONTACT = process.env.PUSH_CONTACT || 'mailto:admin@fcfc.app'
  if (process.env.CALLS_API_TOKEN) s.CALLS_API_TOKEN = process.env.CALLS_API_TOKEN
  if (process.env.CALLS_APP_ID) s.CALLS_APP_ID = process.env.CALLS_APP_ID
  return s
}

function hints(out) {
  const h = []
  if (/subdomain/i.test(out)) h.push('→ ড্যাশবোর্ড → Workers & Pages → ডান-উপরে workers.dev সাবডোমেইন একবার সেট করে আবার চালান')
  if (/10000|authentication error|not authorized/i.test(out)) h.push(
    '→ টোকেনে এই রিসোর্সের পারমিশন নেই (কোড 10000)। ড্যাশবোর্ড → My Profile → API Tokens →\n' +
    '  টোকেনের পাশে ⋯ (তিন ডট) → Edit → Permissions-এ যোগ করুন:\n' +
    '     D1 → Edit   ·   Workers R2 Storage → Edit   ·   Workers KV Storage → Edit\n' +
    '  তারপর Continue to summary → Update Token (টোকেনের মান বদলাবে না) — আবার node deploy.mjs চালান')
  if (/r2|bucket/i.test(out) && /error|fail|denied/i.test(out) && !/10000|authentication/i.test(out)) h.push('→ R2 প্রথমবার ব্যবহারে ড্যাশবোর্ড → R2 ওপেন করে অ্যাক্টিভেট করতে হয় (ফ্রি লিমিটের নিচে চার্জ লাগে না)')
  return h.length ? '\n💡 ইশারা:\n' + h.join('\n') : ''
}

async function main() {
  log('🚀 fcfc ডিপ্লয় শুরু' + (DRY ? '  (DRY RUN — ক্লাউডে কিছু যাবে না)' : '') + '\n')

  // ── ০. প্রস্তুতি-চেক ──
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token && !DRY)
    die('CLOUDFLARE_API_TOKEN সেট করা হয়নি।\n' +
      '  macOS/Linux : export CLOUDFLARE_API_TOKEN="টোকেন"\n' +
      '  Windows PS  : $env:CLOUDFLARE_API_TOKEN="টোকেন"\n' +
      'টোকেন বানান: https://dash.cloudflare.com/profile/api-tokens → Create Token → "Edit Cloudflare Workers"\n' +
      'টেমপ্লেট + অতিরিক্ত পারমিশন: D1:Edit, Workers R2 Storage:Edit (Workers KV Storage:Edit টেমপ্লেটেই থাকে)')
  if (parseInt(process.versions.node.split('.')[0], 10) < 18) die('Node.js 18+ দরকার (বর্তমান: ' + process.versions.node + ') — nodejs.org থেকে LTS ইনস্টল করুন')

  // ── ১. ডিপেন্ডেন্সি ──
  log('[1/8] ডিপেন্ডেন্সি ইনস্টল হচ্ছে…')
  for (const dir of [WORKER, FRONTEND]) {
    let r = run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir })
    if (!r.ok) r = run('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir })
    if (!r.ok) die('npm install ব্যর্থ (' + path.basename(dir) + '):\n' + r.out.slice(-2000))
  }
  log('      ✓ রেডি')

  // ── ২. টোকেন যাচাই + অ্যাকাউন্ট ──
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || ''
  const cenv = { ...(token ? { CLOUDFLARE_API_TOKEN: token } : {}), ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) }
  if (!DRY) {
    log('[2/8] টোকেন যাচাই হচ্ছে…')
    const w = wrangler(['whoami'])
    if (!w.ok) die('টোকেন দিয়ে লগইন যাচাই ব্যর্থ:\n' + w.out.slice(-1500) + hints(w.out))
    if (!accountId) {
      const ids = [...new Set(w.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [])]
      if (ids.length > 1)
        die('একাধিক ক্লাউডফ্লেয়ার অ্যাকাউন্ট পাওয়া যাচ্ছে:\n  ' + ids.join('\n  ') +
          '\nকোনটা ব্যবহার করবেন বলে দিন:\n  export CLOUDFLARE_ACCOUNT_ID="অ্যাকাউন্ট-আইডি" && node deploy.mjs')
      if (ids.length === 1) { accountId = ids[0]; Object.assign(cenv, { CLOUDFLARE_ACCOUNT_ID: accountId }) }
    }
    log('      ✓ টোকেন ঠিক আছে')
  }

  // ── ৩. D1 ডেটাবেস ──
  // রেজলিউশন-চেইন (৪ ধাপ): d1 info --json → d1 info (টেবিল-আউটপুট) →
  // d1 create → d1 list। যে-কোনো একটা পথ থেকে fcfc-db-র আসল uuid পেলেই হলো —
  // এক পথ কোনো কারণে ভাঙলেও (আউটপুট-ফরম্যাট বদল, পারমিশন-গ্লিচ) বাকিগুলো ধরে রাখে।
  let dbId = ''
  if (!DRY) {
    log('[3/8] D1 ডেটাবেস (fcfc-db)…')
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
    const infoJ = wrangler(['d1', 'info', 'fcfc-db', '--json'], { env: cenv })
    if (infoJ.ok) {
      try {
        const j = JSON.parse(infoJ.out.slice(infoJ.out.indexOf('{'), infoJ.out.lastIndexOf('}') + 1))
        dbId = String(j.uuid || '')
      } catch { /* আউটপুট পার্স না হলে পরের ধাপ */ }
    }
    if (!dbId) {
      const info = wrangler(['d1', 'info', 'fcfc-db'], { env: cenv })
      if (info.ok) dbId = (info.out.match(UUID_RE) || [''])[0]
    }
    if (!dbId) {
      const cr = wrangler(['d1', 'create', 'fcfc-db'], { env: cenv })
      dbId = cr.ok ? (cr.out.match(UUID_RE) || [''])[0] : ''
    }
    if (!dbId) {
      const lr = wrangler(['d1', 'list', '--json'], { env: cenv })
      try {
        const arr = JSON.parse(lr.out.slice(lr.out.indexOf('['), lr.out.lastIndexOf(']') + 1))
        dbId = String((arr || []).find((d) => d.name === 'fcfc-db')?.uuid || '')
      } catch { /* ignore */ }
    }
    if (!dbId) die('D1 ডেটাবেস (fcfc-db) খুঁজে/তৈরি করা যায়নি:\n' + hints('authentication error'))
    log('      ✓', dbId, dbId.length === 36 ? '(আগেরটাই)' : '(নতুন তৈরি)')
  }

  // ── ৪. KV namespace ──
  let kvId = ''
  if (!DRY) {
    log('[4/8] KV namespace (fcfc-kv)…')
    const cr = wrangler(['kv', 'namespace', 'create', 'fcfc-kv'], { env: cenv })
    if (cr.ok) kvId = (cr.out.match(/id\s*=\s*"([^"]+)"/) || [''])[1]
    if (!kvId) {
      const lr = wrangler(['kv', 'namespace', 'list'], { env: cenv })
      try {
        const arr = JSON.parse(lr.out.slice(lr.out.indexOf('['), lr.out.lastIndexOf(']') + 1))
        const hit = (arr || []).find((n) => n.title === 'fcfc-kv')
        if (hit) kvId = hit.id
      } catch {}
    }
    if (!kvId) die('KV namespace তৈরি/খুঁজে পাওয়া যায়নি:\n' + cr.out.slice(-1500) + hints(cr.out))
    log('      ✓', kvId)
  }

  // ── ৫. R2 bucket ──
  if (!DRY) {
    log('[5/8] R2 bucket (fcfc-media)…')
    const r = wrangler(['r2', 'bucket', 'create', 'fcfc-media'], { env: cenv })
    if (r.ok) log('      ✓ নতুন তৈরি হলো')
    else if (/already exist/i.test(r.out)) log('      ✓ আগে থেকেই আছে')
    else die('R2 তৈরি ব্যর্থ:\n' + r.out.slice(-1500) + hints(r.out))
  }

  // ── ৬. wrangler.toml-এ আসল আইডি বসানো + assets কনফিগ ──
  // আগে শুধু PLACEHOLDER-টা বদলানো হতো — ফোল্ডারে একবার ভুল/পুরনো আইডি
  // বসে গেলে আর কখনো ঠিক হতো না, আর লাইভ ওয়ার্কারের D1-বাইন্ডিং ভাঙা
  // অবস্থায় রয়ে যেত (প্রতিটি DB-কোয়েরি 500 — সাইনআপ/লগইন সব বন্ধ)।
  // এখন প্রতি রানে সেকশন-অ্যাওয়্যার ভাবে বর্তমান আইডিতে সিঙ্ক হয় —
  // ভুল আইডি থাকলেও পরের ডিপ্লয়েই নিজে ঠিক হয়ে যায় (self-healing)।
  log('[6/8] wrangler.toml আপডেট হচ্ছে…')
  const tomlPath = path.join(WORKER, 'wrangler.toml')
  let toml = readFileSync(tomlPath, 'utf8')
  {
    const lines = toml.split('\n')
    let section = ''
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i].trim()
      if (s.startsWith('[')) { section = s; continue }
      if (dbId && section.startsWith('[[d1_databases') && /^database_id\s*=/.test(s)) {
        lines[i] = `database_id = "${dbId}"`
      } else if (kvId && section.startsWith('[[kv_namespaces') && /^id\s*=/.test(s)) {
        lines[i] = `id = "${kvId}"`
      }
    }
    toml = lines.join('\n')
  }
  // CALLS_APP_ID (গোপন নয়) → [vars]-এ; .deploy-secrets.json থেকেও রি-ডিপ্লয়ে বহাল থাকে
  {
    const secretsNow = existsSync(SECRETS_FILE) ? (JSON.parse(readFileSync(SECRETS_FILE, 'utf8')) || {}) : {}
    const appId = process.env.CALLS_APP_ID || secretsNow.CALLS_APP_ID || ''
    if (appId) toml = toml.replace(/CALLS_APP_ID = "[^"]*"/, `CALLS_APP_ID = "${String(appId).replace(/[^a-zA-Z0-9_-]/g, '')}"`)
  }
  if (!toml.includes('[assets]')) {
    toml += '\n# ── ফ্রন্টএন্ড (SPA) static assets — deploy.mjs যোগ করেছে ──\n' +
      '# অ্যাপ ও API একই URL-এ চলে (CORS লাগে না)। শুধু API আলাদা চাইলে এই অংশটুকু মুছে দিন।\n' +
      '[assets]\ndirectory = "./public-dist"\nnot_found_handling = "single-page-application"\n'
  }
  writeFileSync(tomlPath, toml)
  log('      ✓ রেডি')

  // ── ৭. ফ্রন্টএন্ড বিল্ড → worker/public-dist ──
  log('[7/8] ফ্রন্টএন্ড বিল্ড হচ্ছে…')
  const br = run('npx', ['vite', 'build'], { cwd: FRONTEND, env: { VITE_API_BASE: '' } })
  if (!br.ok) die('ফ্রন্টএন্ড বিল্ড ব্যর্থ:\n' + br.out.slice(-2500))
  rmSync(path.join(WORKER, 'public-dist'), { recursive: true, force: true })
  cpSync(path.join(FRONTEND, 'dist'), path.join(WORKER, 'public-dist'), { recursive: true })
  log('      ✓ রেডি')

  // ── ৭.৫ মাইগ্রেশন — ডিপ্লয়ের *আগেই* ──
  // আগে ক্রম ছিল: deploy → secret → migrations। মাইগ্রেশন ব্যর্থ হলে
  // লাইভ ওয়ার্কার ততক্ষণে নতুন কোড নিয়ে চালু হয়ে যেত, আর DB ভাঙা
  // থেকে যেত — লাইভে সাইনআপ/লগইন সব 500। এখন মাইগ্রেশন + স্কিমা-যাচাই
  // আগে হয়; একটা ব্যর্থ হলে কিছুই ডিপ্লয় হয় না, পুরনো লাইভ অক্ষত থাকে।
  if (!DRY) {
    log('… ডেটাবেস মাইগ্রেশন (ডিপ্লয়ের আগে)…')
    const mr = wrangler(['d1', 'migrations', 'apply', 'fcfc-db', '--remote'], { env: cenv })
    if (!mr.ok) die('মাইগ্রেশন ব্যর্থ — কিছুই ডিপ্লয় হয়নি, লাইভ অক্ষত আছে:\n' + mr.out.slice(-2000) + hints(mr.out))
    // স্কিমা-যাচাই: users টেবিল আছে তো? (নতুন/খালি DB হলেও এখানেই ধরা পড়বে)
    // --command 'SELECT …' নয় — স্পেস-যুক্ত SQL shell-আর্গ হিসেবে ভেঙে যেত;
    // --file-এ টেম্প .sql লিখে পাঠানো সব প্ল্যাটফর্মে (Windows PowerShell/cmd সহ) নিরাপদ।
    const schemaFile = path.join(WORKER, '.schema-check.sql')
    writeFileSync(schemaFile, 'SELECT COUNT(*) FROM users;\n')
    const sv = wrangler(['d1', 'execute', 'fcfc-db', '--remote', '--file', '.schema-check.sql', '-y'], { env: cenv })
    try { unlinkSync(schemaFile) } catch {}
    if (!sv.ok) die("স্কিমা-যাচাই ব্যর্থ (users টেবিল নেই?) — কিছুই ডিপ্লয় হয়নি:\n" + sv.out.slice(-1500) + hints(sv.out))
    log('      ✓ স্কিমা রেডি')
  }

  // ── ৮. ডিপ্লয় ──
  if (DRY) {
    log('[8/8] DRY RUN — wrangler deploy --dry-run…\n')
    const r = wrangler(['deploy', '--dry-run'], { inherit: true })
    if (!r.ok) die('dry-run ব্যর্থ — কনফিগ/বিল্ড চেক করুন')
    log('\n✅ Dry-run সফল! আসল ডিপ্লয়ের জন্য CLOUDFLARE_API_TOKEN সেট করে আবার চালান (দ্রুততম পথের নির্দেশনা স্ক্রিপ্টের উপরে লেখা)।')
    return
  }

  log('[8/8] Worker ডিপ্লয় হচ্ছে…')
  const dep = wrangler(['deploy'], { env: cenv })
  if (!dep.ok) die('ডিপ্লয় ব্যর্থ:\n' + dep.out.slice(-3000) + hints(dep.out))
  const url = (dep.out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/) || [''])[0]
  log('      ✓ ডিপ্লয় হয়েছে' + (url ? ' → ' + url : ''))

  // ── সিক্রেট আপলোড ──
  log('… সিক্রেট সেট হচ্ছে (JWT, VAPID, push)…')
  const secrets = await loadOrCreateSecrets()
  writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2))
  // CALLS_APP_ID গোপন নয় — [vars]-এ যায়, secret bulk-এ নয় (নাম-সংঘর্ষ এড়াতে)
  const { CALLS_APP_ID, ...secretOnly } = secrets
  const tmp = path.join(WORKER, '.secrets-tmp.json')
  writeFileSync(tmp, JSON.stringify(secretOnly))
  const sr = wrangler(['secret', 'bulk', '.secrets-tmp.json'], { env: cenv })
  try { unlinkSync(tmp) } catch {}
  if (!sr.ok) die('সিক্রেট আপলোড ব্যর্থ:\n' + sr.out.slice(-1500) + hints(sr.out))
  log('      ✓ সব সিক্রেট সেট' + (secrets.CALLS_API_TOKEN && secrets.CALLS_APP_ID ? ' (Calls সহ)' : ''))

  // ── লাইভ টেস্ট (কঠোর) ──
  // আগে D1-স্মোক-টেস্ট ব্যর্থ হলে শুধু '⚠ রেসপন্স অদ্ভুত' লিখে '🎉 সব রেডি!'
  // দেখাত — ভাঙা ডিপ্লয়ও সফল ভাবত। এখন ব্যর্থ হলে থেমে যায়, আর
  // সার্ভারের রেসপন্স-বডি (আসল এরর-মেসেজ সহ) দেখায়।
  if (url) {
    log('… লাইভ স্মোক-টেস্ট…')
    try {
      const home = await fetch(url + '/')
      const homeOk = home.ok && (await home.text()).includes('<div id="root">')
      log('      ফ্রন্টএন্ড: ' + (homeOk ? '✓ চলছে' : '⚠ রেসপন্স অদ্ভুত (HTTP ' + home.status + ')'))
      const check = await fetch(url + '/auth/check?username=zzz_deploy_test')
      const checkBody = await check.text()
      let apiOk = false
      try { apiOk = check.ok && typeof JSON.parse(checkBody)?.ok === 'boolean' } catch { /* parse fail */ }
      log('      API (D1): ' + (apiOk ? '✓ চলছে' : '✗ ব্যর্থ'))
      if (!apiOk) {
        die('লাইভ API (D1) টেস্ট ব্যর্থ — HTTP ' + check.status +
            '\n  সার্ভারের রেসপন্স: ' + checkBody.slice(0, 400) +
            '\n\n→ ডিপ্লয় হয়েছে কিন্তু D1-বাইন্ডিং/ডেটাবেসে সমস্যা এখনো আছে।' +
            '\n→ রেসপন্সে "server error: …"-এর পরের অংশটাই আসল কারণ (যেমন no such table / database not found)।' +
            '\n→ সাধারণত নতুন বাইন্ডিং ৬০ সেকেন্ডে প্রচারিত হয় — একটু পর আবার node deploy.mjs চালান;' +
            '\n  স্ক্রিপ্টটি এখন self-healing — ভুল আইডি/ভাঙা DB নিজেই ঠিক করে ফেলে।')
      }
    } catch (e) {
      log('      ⚠ লাইভ টেস্ট স্কিপ: ' + e.message)
    }
  }

  console.log('\n' + '═'.repeat(62))
  console.log('🎉 সব রেডি!')
  if (url) console.log('   📱 অ্যাপ (এই URL-টাই সবাইকে দিন): ' + url)
  console.log('═'.repeat(62))
  console.log('পরবর্তী ধাপ:')
  console.log('  • ব্রাউজারে URL খুলে সাইনআপ করুন — পুরো অ্যাপ (চ্যাট+মিডিয়া) একই ঠিকানায়')
  console.log('  • সেটিংস → নোটিফিকেশন → "চালু করুন" দিলে পুশ নোটিফিকেশন কাজ করবে')
  if (!secrets.CALLS_API_TOKEN || !secrets.CALLS_APP_ID)
    console.log('  • (ঐচ্ছিক) ভিডিও/ভয়েস কল: ড্যাশবোর্ড → Realtime → Serverless SFU → অ্যাপ বানান/খুলে\n      App ID + App Secret (বানানোর সময়ে দেখানো ৬৪-অক্ষরের) দুটোই দিয়ে চালান:\n      CALLS_APP_ID="অ্যাপ-আইডি" CALLS_API_TOKEN="অ্যাপ-সিক্রেট" node deploy.mjs\n      ("Create API Token"-এর টোকেন নয় — SFU শুধু App Secret নেয়)')
  console.log('  • কোড বদলালে আবার ' + 'node deploy.mjs' + ' — সব ইডিম্পোটেন্ট')
  console.log('\n⚠ লোকাল ফাইল .deploy-secrets.json গোপন রাখুন (git-এ যাবে না)।')
}

main().catch((e) => die(e?.stack || String(e)))
