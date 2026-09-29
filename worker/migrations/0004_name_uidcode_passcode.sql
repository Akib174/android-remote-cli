-- fcfc migration 0004 — display name, numeric user ID + passcode login,
-- dual (password + passcode) key backups.

-- সাইনআপে "আপনার নাম" (চ্যাটে নাম হিসেবে দেখায়) — username আলাদা থাকে
ALTER TABLE users ADD COLUMN name TEXT DEFAULT '';

-- নিউমেরিক ইউজার-আইডি (৪+ ডিজিট, unique) + পাসকোড (৬-৮ ডিজিট) লগইন
ALTER TABLE users ADD COLUMN user_id_code TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN passcode_hash TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN passcode_salt TEXT DEFAULT '';

-- ইউজার-আইডি ইউনিক (খালি মান বাদে — পুরনো অ্যাকাউন্টে সেট হয়নি)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uidcode ON users (user_id_code) WHERE user_id_code <> '';

-- কী-ব্যাকআপের পাশাই পাসকোড-দিয়ে-খোলা কপি — userid+passcode লগইনে
-- নতুন ডিভাইসে রিস্টোর করার জন্য (পাসওয়ার্ড ছাড়াই)
ALTER TABLE key_backups ADD COLUMN pin_blob TEXT DEFAULT '';
ALTER TABLE key_backups ADD COLUMN pin_salt TEXT DEFAULT '';
