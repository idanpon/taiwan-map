-- Rebuild both sides of the FK together, retaining all reminder/delivery IDs.
CREATE TABLE planning_reminders_next (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_id TEXT REFERENCES planning_items(id) ON DELETE CASCADE,
 deadline_id TEXT REFERENCES planning_deadlines(id) ON DELETE CASCADE,
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
 CHECK ((item_id IS NULL) <> (deadline_id IS NULL)),
 UNIQUE (user_id,item_id),
 UNIQUE (user_id,deadline_id)
);
INSERT INTO planning_reminders_next
 SELECT id,user_id,item_id,NULL,enabled,mode,local_time,offset_minutes,fires_at,
 chosen_at,chosen_revision,review,version,generation,sent_generation,updated_at
 FROM planning_reminders;
CREATE TABLE push_deliveries_next (
 id TEXT PRIMARY KEY,
 reminder_id TEXT NOT NULL REFERENCES planning_reminders_next(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK (state IN ('queued','sending','sent','failed','expired')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 UNIQUE (reminder_id,generation,device_id)
);
INSERT INTO push_deliveries_next SELECT * FROM push_deliveries;
DROP TABLE push_deliveries;
DROP TABLE planning_reminders;
ALTER TABLE planning_reminders_next RENAME TO planning_reminders;
ALTER TABLE push_deliveries_next RENAME TO push_deliveries;
CREATE INDEX planning_reminders_due ON planning_reminders(enabled,fires_at);
CREATE INDEX push_deliveries_queue ON push_deliveries(state,next_at);
