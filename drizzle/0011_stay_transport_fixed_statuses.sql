-- rebuild-foreign-keys
-- Refuse to archive a status that is still assigned, even to a hidden place.
CREATE TEMP TABLE fixed_status_check (
 assignments INTEGER CONSTRAINT review_custom_status_assignments_before_upgrade CHECK(assignments = 0)
);
INSERT INTO fixed_status_check
 SELECT count(*) FROM user_place_states WHERE status_id NOT IN ('want','maybe','visited');
DROP TABLE fixed_status_check;

-- Retain historic status definitions for state_events.
UPDATE statuses SET archived=1,version=version+1
 WHERE archived=0 AND id NOT IN ('want','maybe','visited');
WITH fixed(id,label) AS (
 VALUES ('want','Хотим посетить'),('maybe','Под вопросом'),('visited','Уже посетили')
)
UPDATE statuses SET archived=0,label=fixed.label,version=version+1
 FROM fixed WHERE statuses.id=fixed.id AND (archived<>0 OR statuses.label<>fixed.label);

-- Very old or partial imports may be missing a built-in definition.
WITH fixed(id,label,color,sort_order,symbol,dimmed) AS (
 VALUES ('want','Хотим посетить','#1456e0',0,'!',0),
        ('visited','Уже посетили','#6b7280',1,'✓',1),
        ('maybe','Под вопросом','#facc15',2,'?',0)
)
INSERT OR IGNORE INTO statuses(id,trip_id,label,color,sort_order,symbol,dimmed)
 SELECT fixed.id,trips.id,label,color,sort_order,symbol,dimmed
 FROM fixed CROSS JOIN trips WHERE trips.id='taiwan-2026';

-- SQLite cannot alter the kind CHECK in place. Preserve the parent IDs and
-- every referencing row, including reminders and audit events.
CREATE TABLE planning_items_next (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 kind TEXT NOT NULL CHECK(kind IN ('task','decision','visit','stay','transport')),
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','in_progress','done','cancelled')),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
 assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 date_start TEXT, date_end TEXT, starts_at TEXT, ends_at TEXT,
 event_timezone TEXT NOT NULL DEFAULT 'Asia/Taipei', sort_order INTEGER NOT NULL DEFAULT 0,
 fixed_external INTEGER NOT NULL DEFAULT 0, source_urls TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_urls)),
 selected_option_id TEXT, version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES users(id), updated_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
 transport_json TEXT CHECK(
   (kind='transport' AND transport_json IS NOT NULL AND json_type(transport_json)='object')
   OR (kind<>'transport' AND transport_json IS NULL)
 )
);
INSERT INTO planning_items_next
 SELECT id,trip_id,kind,title,description,note,state,priority,assignee_id,
        date_start,date_end,starts_at,ends_at,event_timezone,sort_order,fixed_external,
        source_urls,selected_option_id,version,created_by,updated_by,created_at,updated_at,completed_at,NULL
 FROM planning_items;
DROP TABLE planning_items;
ALTER TABLE planning_items_next RENAME TO planning_items;
CREATE INDEX planning_items_trip_dates ON planning_items(trip_id,date_start,date_end);

ALTER TABLE planning_item_places ADD COLUMN role TEXT CHECK(role IN ('lodging','departure','arrival'));
CREATE UNIQUE INDEX planning_places_role ON planning_item_places(item_id,role) WHERE role IS NOT NULL;
