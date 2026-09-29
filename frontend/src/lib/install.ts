// PWA ইনস্টল-প্রম্পট ম্যানেজার।
// Chrome/Edge ইত্যাদি beforeinstallprompt দিলে সেটা আটকে রেখে নিজেদের
// UI-তে দেখাই; promptInstall() দিলে ব্রাউজারের নিজস্ব ডায়ালগ খোলে।
// "Never show again" → localStorage-ফ্ল্যাগ, সেটিংস থেকে যখন-খুশি ইনস্টল।
let savedPrompt: any = null
let armed = false

export function armInstallPrompt() {
  if (armed) return
  armed = true
  window.addEventListener('beforeinstallprompt', (e: any) => {
    e.preventDefault()
    savedPrompt = e
    window.dispatchEvent(new Event('fcfc:can-install'))
  })
  window.addEventListener('appinstalled', () => {
    savedPrompt = null
    window.dispatchEvent(new Event('fcfc:installed'))
  })
}

export function canInstall(): boolean {
  return !!savedPrompt
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!savedPrompt) return 'unavailable'
  try {
    savedPrompt.prompt()
    const { outcome } = await savedPrompt.userChoice
    savedPrompt = null
    return outcome || 'dismissed'
  } catch {
    return 'dismissed'
  }
}

export function neverAskAgain() {
  try { localStorage.setItem('fcfc.installBanner', 'never') } catch {}
}

export function isNeverAsk() {
  try { return localStorage.getItem('fcfc.installBanner') === 'never' } catch { return false }
}
