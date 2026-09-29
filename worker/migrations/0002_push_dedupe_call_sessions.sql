-- fcfc D1 migration 0002
-- (১) push_subscriptions: endpoint-এ ইউনিক ইনডেক্স + ডুপ্লিকেট রো পরিষ্কার —
--     পুনরায় subscribe করলে ডুপ্লিকেট নোটিফিকেশন আসা বন্ধ।
-- (২) call_sessions: sessionId → chatId ম্যাপিং — /calls/negotiate-এ
--     চ্যাট-মেম্বারশিপ অথরাইজেশনের জন্য।

DELETE FROM push_subscriptions WHERE id NOT IN (SELECT MIN(id) FROM push_subscriptions GROUP BY endpoint);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_endpoint ON push_subscriptions (endpoint);

CREATE TABLE IF NOT EXISTS call_sessions (
  session_id TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
