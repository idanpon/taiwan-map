ALTER TABLE places ADD COLUMN catalog_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE places ADD COLUMN coordinate_accuracy TEXT NOT NULL DEFAULT '';
ALTER TABLE places ADD COLUMN coordinate_source_url TEXT NOT NULL DEFAULT '';

CREATE TABLE assistant_proposals (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft'
 CHECK(status IN ('draft','ready','applied','cancelled')),
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 preview TEXT CHECK(preview IS NULL OR json_valid(preview)),
 snapshot_hash TEXT, confirmation_token TEXT,
 result TEXT CHECK(result IS NULL OR json_valid(result)),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX assistant_proposals_owner ON assistant_proposals(author_id,updated_at);
CREATE TABLE assistant_events (
 id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES assistant_proposals(id),
 actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)), created_at INTEGER NOT NULL
);
CREATE TABLE assistant_oauth_codes (
 code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, resource TEXT NOT NULL,
 challenge TEXT NOT NULL, scope TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE assistant_oauth_grants (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
 resource TEXT NOT NULL, scope TEXT NOT NULL, access_hash TEXT NOT NULL UNIQUE,
 refresh_hash TEXT NOT NULL UNIQUE, access_expires_at INTEGER NOT NULL,
 refresh_expires_at INTEGER NOT NULL, revoked_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX assistant_oauth_grants_user ON assistant_oauth_grants(user_id);
CREATE TRIGGER assistant_revoke_on_credentials AFTER UPDATE OF password_hash,disabled ON users
WHEN NEW.password_hash IS NOT OLD.password_hash OR NEW.disabled IS NOT OLD.disabled
BEGIN
 UPDATE assistant_oauth_grants SET revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE user_id=NEW.id AND revoked_at IS NULL;
 DELETE FROM assistant_oauth_codes WHERE user_id=NEW.id;
END;
