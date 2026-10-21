ALTER TABLE trips ADD COLUMN departure_date TEXT;
ALTER TABLE trips ADD COLUMN start_date TEXT;
ALTER TABLE trips ADD COLUMN end_date TEXT;
UPDATE trips SET departure_date='2026-12-28',start_date='2026-12-29',end_date='2027-01-09' WHERE id='taiwan-2026';
CREATE TABLE planning_items (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 kind TEXT NOT NULL CHECK(kind IN ('task','decision','visit')),
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','in_progress','done','cancelled')),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
 assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 date_start TEXT, date_end TEXT, starts_at TEXT, ends_at TEXT,
 event_timezone TEXT NOT NULL DEFAULT 'Asia/Taipei', sort_order INTEGER NOT NULL DEFAULT 0,
 fixed_external INTEGER NOT NULL DEFAULT 0, source_urls TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_urls)),
 selected_option_id TEXT, version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES users(id), updated_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE INDEX planning_items_trip_dates ON planning_items(trip_id,date_start,date_end);
CREATE TABLE planning_options (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES planning_items(id) ON DELETE CASCADE,
 label TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE planning_item_places (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES planning_items(id) ON DELETE CASCADE,
 option_id TEXT REFERENCES planning_options(id) ON DELETE CASCADE,
 place_id TEXT REFERENCES places(id) ON DELETE SET NULL, place_name TEXT NOT NULL,
 affects_visit INTEGER NOT NULL DEFAULT 0, unselected_action TEXT NOT NULL DEFAULT 'keep' CHECK(unselected_action IN ('keep','hide'))
);
CREATE INDEX planning_places_place ON planning_item_places(place_id,item_id);
CREATE TABLE planning_dependencies (
 item_id TEXT NOT NULL REFERENCES planning_items(id) ON DELETE CASCADE,
 depends_on_id TEXT NOT NULL REFERENCES planning_items(id) ON DELETE CASCADE,
 PRIMARY KEY(item_id,depends_on_id), CHECK(item_id<>depends_on_id)
);
CREATE TABLE planning_events (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), item_id TEXT REFERENCES planning_items(id) ON DELETE SET NULL,
 actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 created_at INTEGER NOT NULL
);
CREATE INDEX planning_events_item ON planning_events(item_id,created_at);
ALTER TABLE trips ADD COLUMN planning_version INTEGER NOT NULL DEFAULT 1;
