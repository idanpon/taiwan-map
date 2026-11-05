ALTER TABLE trips ADD COLUMN timezone_revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE trip_timezone_changes (
 trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 at INTEGER NOT NULL,
 zone TEXT NOT NULL,
 region TEXT NOT NULL DEFAULT '',
 PRIMARY KEY (trip_id, at)
);

CREATE TABLE notification_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
 enabled_from INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE push_devices (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 installation_id TEXT NOT NULL,
 name TEXT NOT NULL,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
 expired INTEGER NOT NULL DEFAULT 0 CHECK (expired IN (0,1)),
 enabled_from INTEGER NOT NULL,
 last_seen INTEGER NOT NULL,
 last_sent INTEGER,
 last_test INTEGER,
 UNIQUE (user_id, installation_id)
);
CREATE INDEX push_devices_user ON push_devices(user_id,enabled,expired);

CREATE TABLE planning_reminders (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_id TEXT NOT NULL REFERENCES planning_items(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
 mode TEXT NOT NULL CHECK (mode IN ('day','offset')),
 local_time TEXT,
 offset_minutes INTEGER,
 fires_at INTEGER,
 chosen_at INTEGER,
 chosen_revision INTEGER,
 review TEXT CHECK (review IN ('gap','repeat','date_changed')),
 version INTEGER NOT NULL DEFAULT 1,
 generation INTEGER NOT NULL DEFAULT 1,
 sent_generation INTEGER,
 updated_at INTEGER NOT NULL,
 UNIQUE (user_id,item_id)
);
CREATE INDEX planning_reminders_due ON planning_reminders(enabled,fires_at);

CREATE TABLE push_deliveries (
 id TEXT PRIMARY KEY,
 reminder_id TEXT NOT NULL REFERENCES planning_reminders(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK (state IN ('queued','sending','sent','failed','expired')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 UNIQUE (reminder_id,generation,device_id)
);
CREATE INDEX push_deliveries_queue ON push_deliveries(state,next_at);
