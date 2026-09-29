// Web Push সাবস্ক্রিপশন হুক — অ্যাপ বন্ধ থাকলেও ডিভাইস ট্রে-তে নোটিফিকেশন।
import { useCallback } from 'react'
import { api } from '../api/client'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export function usePush() {
  return useCallback(async (): Promise<boolean> => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return false
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        const { key } = await api('/push/vapid-public')
        if (!key) return false
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        })
      }
      await api('/me/push/subscribe', { body: sub.toJSON() })
      return true
    } catch (e) {
      console.warn('push subscribe failed', e)
      return false
    }
  }, [])
}
