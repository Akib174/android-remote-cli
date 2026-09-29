// PWA: service worker রেজিস্ট্রেশন + আপডেট টোস্ট হুক।
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        if (!w) return
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            // নতুন ভার্সন এসেছে — নীরবে রিলোড না করে ইউজারকে জানাই
            window.dispatchEvent(new CustomEvent('fcfc:update-available'))
          }
        })
      })
      // প্রতি ৬ ঘণ্টায় আপডেট-চেক — ট্যাব দিনের পর দিন খোলা থাকলেও নতুন
      // ভার্সন ধরা পড়ে।
      setInterval(() => reg.update().catch(() => {}), 6 * 3600_000)
    } catch (e) {
      console.warn('SW registration failed', e)
    }
  })
}

export async function pushPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission === 'default') return Notification.requestPermission()
  return Notification.permission
}
