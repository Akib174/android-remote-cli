// Shared types for the fcfc worker.
export type Env = {
  DB: D1Database
  KV: KVNamespace
  R2: R2Bucket
  CHAT_ROOM: DurableObjectNamespace
  USER_HUB: DurableObjectNamespace
  JWT_SECRET: string
  REFRESH_PEPPER: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  PUSH_CONTACT: string
  CALLS_API_TOKEN: string
  CALLS_API_BASE: string
  CALLS_APP_ID: string
}

export type AuthUser = { id: string; username: string; deviceId?: string }

export type AppContext = {
  Bindings: Env
  Variables: { user: AuthUser }
}
