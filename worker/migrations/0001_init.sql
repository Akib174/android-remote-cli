-- fcfc D1 schema (migration 0001)
-- মেসেজের প্লেইনটেক্সট কখনো সার্ভারে আসে না; `messages.payload`-এ শুধু
-- এনক্রিপ্টেড বডি (ct/iv/hdr) ও নন-সেনসিটিভ মেটাডেটা থাকে।

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  about         TEXT DEFAULT '',
  avatar_key    TEXT DEFAULT '',
  privacy_dm    TEXT DEFAULT 'everyone',     -- everyone | request
  lastseen_priv TEXT DEFAULT 'everyone',     -- everyone | nobody
  last_seen_at  INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL,
  deleted       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_keys (
  user_id      TEXT PRIMARY KEY,
  identity_pub TEXT NOT NULL,               -- X25519 JWK (public)
  sign_pub     TEXT NOT NULL,               -- ECDSA P-256 JWK (public)
  spk_pub      TEXT NOT NULL,               -- signed prekey (X25519 JWK)
  spk_sig      TEXT NOT NULL,               -- base64url signature
  updated_at   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS one_time_prekeys (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  pub     TEXT NOT NULL,
  claimed INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_otk_user ON one_time_prekeys (user_id, claimed);

CREATE TABLE IF NOT EXISTS key_backups (
  user_id    TEXT PRIMARY KEY,
  blob       TEXT NOT NULL,                 -- password-derived key দিয়ে এনক্রিপ্টেড প্রাইভেট কী বান্ডিল
  salt       TEXT NOT NULL,
  updated_at INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT DEFAULT '',
  secret      TEXT,                         -- pending-approval polling secret
  approved    INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL,
  last_active INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices (user_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked (
  user_id  TEXT NOT NULL,
  other_id TEXT NOT NULL,
  PRIMARY KEY (user_id, other_id)
);

CREATE TABLE IF NOT EXISTS chats (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,               -- dm | group
  title        TEXT DEFAULT '',
  photo_key    TEXT DEFAULT '',
  description  TEXT DEFAULT '',
  created_by   TEXT,
  created_at   INTEGER NOT NULL,
  member_limit INTEGER DEFAULT 200,
  last_ts      INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dm_index (
  a       TEXT NOT NULL,
  b       TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  PRIMARY KEY (a, b)
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id   TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  role      TEXT DEFAULT 'member',          -- owner | admin | member
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON chat_members (user_id);

CREATE TABLE IF NOT EXISTS chat_state (
  user_id       TEXT NOT NULL,
  chat_id       TEXT NOT NULL,
  pinned        INTEGER DEFAULT 0,
  archived      INTEGER DEFAULT 0,
  muted_until   INTEGER DEFAULT 0,
  wallpaper     TEXT DEFAULT '',
  ttl           INTEGER DEFAULT 0,          -- disappearing messages (seconds)
  deleted_before INTEGER DEFAULT 0,         -- "delete chat for me" marker
  last_read_ts  INTEGER DEFAULT 0,
  unread        INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, chat_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  mid       TEXT NOT NULL UNIQUE,           -- client-generated message id
  chat_id   TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  type      TEXT NOT NULL,
  payload   TEXT NOT NULL,                  -- JSON: {ct,iv,hdr, meta…} (encrypted body)
  deleted   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chat_id, ts);

CREATE TABLE IF NOT EXISTS message_requests (
  id         TEXT PRIMARY KEY,
  from_user  TEXT NOT NULL,
  to_user    TEXT NOT NULL,
  chat_id    TEXT NOT NULL,
  status     TEXT DEFAULT 'pending',        -- pending | accepted | declined
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invite_links (
  code       TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL,
  created_by TEXT NOT NULL,
  active     INTEGER DEFAULT 1,
  uses       INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY,
  json    TEXT DEFAULT '{}'
);
