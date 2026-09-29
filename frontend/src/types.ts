export interface User {
  id: string
  username: string
  name?: string            // ডিসপ্লে-নেম (চ্যাটে প্রেরকের নাম হিসেবে দেখায়)
  userIdCode?: string      // 🆕 নিউমেরিক ইউজার-আইডি (৪+ ডিজিট, পাসকোড-লগইন)
  about?: string
  avatarKey?: string
  phone?: string
  email?: string
  lastSeenAt?: number
  lastSeenPriv?: string
  privacyDm?: string
  deleted?: boolean
}

export type MsgType =
  | 'text' | 'image' | 'video' | 'voice' | 'file' | 'sticker' | 'gif'
  | 'system' | 'sender-key' | 'call'

export interface MediaMeta {
  key: string
  name?: string
  size?: number
  mime?: string
  iv?: string         // base64url file-encryption IV
  fileKey?: string    // base64url AES-GCM key (শুধু এনক্রিপ্টেড মেসেজ-পেলোডে থাকে)
  w?: number
  h?: number
  dur?: number
}

export interface ReactionMap { [emoji: string]: string[] }

export interface Message {
  id: string
  chatId: string
  senderId: string
  ts: number
  type: MsgType
  body?: string            // ডিক্রিপ্টেড টেক্সট
  payload?: any            // raw এনক্রিপ্টেড পেলোড (wire format)
  media?: MediaMeta
  replyTo?: { id: string; body: string; senderId: string }
  fwdFrom?: string
  editedAt?: number
  expiresAt?: number
  reactions: ReactionMap
  pending?: boolean
  failed?: boolean
  starred?: boolean
  read?: boolean       // পিয়ার পড়েছে (রিসিট)
  delivered?: boolean  // পিয়ারের ডিভাইসে পৌঁছেছে
  ap?: boolean         // 🔴 ভয়েস অটো-প্লে — রিসিভারের দিকে নিজে থেকেই বাজবে
}

export interface ChatMember { id: string; username: string; name?: string; userIdCode?: string; about?: string; avatarKey?: string; role: string; deleted?: boolean }

export interface Chat {
  id: string
  kind: 'dm' | 'group'
  title?: string
  photoKey?: string
  description?: string
  memberLimit?: number
  members: ChatMember[]
  // পার-ইউজার স্টেট
  pinned?: boolean
  archived?: boolean
  mutedUntil?: number
  wallpaper?: string
  ttl?: number
  unread: number
  lastTs?: number
  lastPreview?: string
  typing?: string[]
  pins?: string[]
  activeCall?: any
  likeEmoji?: string            // এই চ্যাটের লাইক-বাটন ইমোজি (প্রতি-ইউজার, Messenger-স্টাইল)
  saved?: boolean               // 📌 Saved Messages — নিজের সাথে self-chat (Telegram-স্টাইল)
  peer?: User            // dm-এর জন্য
}

export interface DeviceInfo { id: string; name: string; approved: number; created_at: number; last_active: number }

export interface SendDraft {
  type: MsgType
  body?: string
  media?: MediaMeta
  replyTo?: Message['replyTo']
  ttl?: number
  fwdFrom?: string
  autoPlay?: boolean    // 🔴 ভয়েস মেসেজ — ওপাশে অটো-প্লে হবে (এমনকি অন্য চ্যাটে থাকলেও)
}

export type Theme = 'light' | 'dark'
