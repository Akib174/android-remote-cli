-- fcfc migration 0003 — phone/email (signup + search), per-chat like emoji,
-- one-time invite links.

ALTER TABLE users ADD COLUMN phone TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN email TEXT DEFAULT '';

-- প্রতি-ইউজার প্রতি-চ্যাট "লাইক বাটন" ইমোজি (Messenger-স্টাইল কাস্টমাইজেশন)
ALTER TABLE chat_state ADD COLUMN like_emoji TEXT DEFAULT '';

-- ইনভাইট লিংক কতবার ব্যবহার করা যাবে (ডিফল্ট ১ = one-time)
ALTER TABLE invite_links ADD COLUMN max_uses INTEGER DEFAULT 1;

-- ইউনিকনেস (সফট-ডিলিটেড বা খালি মান বাদে) — D1 = SQLite, পার্শিয়াল ইনডেক্স সাপোর্টেড
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users (phone) WHERE phone <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email <> '';
