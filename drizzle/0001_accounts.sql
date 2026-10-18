ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1));
CREATE UNIQUE INDEX users_username_unique ON users(username COLLATE NOCASE);
CREATE TABLE auth_challenges (
 nonce_hash TEXT PRIMARY KEY NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('login','link')),
 user_id TEXT REFERENCES users(id),
 expires_at INTEGER NOT NULL
);
CREATE INDEX auth_challenges_expiry_idx ON auth_challenges(expires_at);
CREATE TABLE telegram_requests (
 subject TEXT PRIMARY KEY NOT NULL,
 display_name TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
