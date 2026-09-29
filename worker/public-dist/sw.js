/* fcfc service worker — PWA ইনস্টলযোগ্য + অফলাইন ফলব্যাক + ওয়েব পুশ।
 *
 * ক্যাশ স্ট্র্যাটেজি:
 *  - /assets/* (হ্যাশ-নাম, অপরিবর্তনীয়) → cache-first: তাৎক্ষণিক, অফলাইনেও চলে
 *  - নেভিগেশন (/) → network-first, ফেল হলে ক্যাশ তারপর offline.html
 *  - বাকি GET → network-first + রানটাইম ক্যাশ (মিডিয়া/WS বাদ)
 */
const VERSION = 'v2'
const CACHE = `fcfc-${VERSION}`
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/offline.html', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// নতুন SW-কে ক্লায়েন্ট রিলোড ছাড়াই দ্রুত নিয়ন্ত্রণ নিতে দেয়
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // WebSocket বা মিডিয়া-স্ট্রিমে হস্তক্ষেপ নয়
  if (url.pathname.startsWith('/ws/') || url.pathname.startsWith('/media/')) return

  // হ্যাশ-নাম অ্যাসেট — cache-first
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }).catch(() => caches.match('/offline.html')),
      ),
    )
    return
  }

  // নেভিগেশন — network-first, অফলাইনে ক্যাশড শেল
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put('/', copy))
          }
          return res
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('/index.html').then((h2) => h2 || caches.match('/offline.html'))),
      ),
    )
    return
  }

  // বাকি সেম-অরিজিন GET — network-first + রানটাইম ক্যাশ
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'default')) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
      .catch(() => caches.match(req)),
  )
})

// পুশ নোটিফিকেশন — অ্যাপ বন্ধ থাকলেও ডিভাইস ট্রে-তে দেখাবে
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch {}
  const title = data.title || 'fcfc'
  const options = {
    body: data.body || 'New message',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'fcfc',
    renotify: true,
    vibrate: [120, 60, 120],
    silent: !!data.silent,
    requireInteraction: false,
    data: data.data || {},
  }
  e.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const d = e.notification.data || {}
  // চ্যাট-মেসেজ → ওই চ্যাট খোলে; ডিভাইস-লগইন নোটিফিকেশন → ডিভাইস-লিস্ট
  // (Decline করার জায়গা)।
  const target = d.chatId ? `/?chat=${encodeURIComponent(d.chatId)}` : d.deviceId ? '/?devices=1' : '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
