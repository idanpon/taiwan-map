ALTER TABLE sessions ADD COLUMN authenticated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN passkey_id TEXT;
CREATE TABLE passkeys (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 public_key TEXT NOT NULL,
 counter INTEGER NOT NULL DEFAULT 0,
 transports_json TEXT NOT NULL DEFAULT '[]',
 name TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 last_used_at INTEGER
);
CREATE INDEX passkeys_user ON passkeys(user_id);
CREATE TABLE passkey_challenges (
 id TEXT PRIMARY KEY,
 challenge TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('register','login')),
 user_id TEXT,
 session_hash TEXT,
 origin TEXT NOT NULL,
 rp_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
