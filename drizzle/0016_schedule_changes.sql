-- Stage 3: schedule checks and atomic group changes; no automatic model switch.
ALTER TABLE planning_placements ADD COLUMN approved_context_json TEXT CHECK(approved_context_json IS NULL OR json_valid(approved_context_json));
CREATE TABLE planning_time_links (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 from_placement_id TEXT NOT NULL, to_placement_id TEXT NOT NULL, scope_id TEXT NOT NULL, relation TEXT NOT NULL DEFAULT 'finish_before_start' CHECK(relation='finish_before_start'), minimum_minutes INTEGER NOT NULL CHECK(minimum_minutes>=0),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,from_placement_id) REFERENCES planning_placements(trip_id,id),
 FOREIGN KEY(trip_id,to_placement_id) REFERENCES planning_placements(trip_id,id),
 FOREIGN KEY(trip_id,scope_id) REFERENCES planning_scopes(trip_id,id),
 CHECK(from_placement_id<>to_placement_id));
CREATE INDEX planning_time_links_trip ON planning_time_links(trip_id);
CREATE INDEX planning_time_links_from_placement_id ON planning_time_links(from_placement_id);
CREATE INDEX planning_time_links_to_placement_id ON planning_time_links(to_placement_id);
CREATE INDEX planning_time_links_scope_id ON planning_time_links(scope_id);
CREATE TRIGGER planning_time_links_revision_insert AFTER INSERT ON planning_time_links BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_time_links_revision_update AFTER UPDATE ON planning_time_links BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_time_links_revision_delete AFTER DELETE ON planning_time_links BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TABLE planning_transition_overrides (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 from_placement_id TEXT NOT NULL, to_placement_id TEXT NOT NULL, context_hash TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('accepted','manual','disabled')), minutes INTEGER CHECK(minutes>=0), route_checked INTEGER NOT NULL DEFAULT 0 CHECK(route_checked IN (0,1)), service_id TEXT, source_service_version INTEGER, note TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,from_placement_id) REFERENCES planning_placements(trip_id,id),
 FOREIGN KEY(trip_id,to_placement_id) REFERENCES planning_placements(trip_id,id),
 FOREIGN KEY(trip_id,service_id) REFERENCES booking_services(trip_id,id),
 CHECK(from_placement_id<>to_placement_id));
CREATE INDEX planning_transition_overrides_trip ON planning_transition_overrides(trip_id);
CREATE INDEX planning_transition_overrides_from_placement_id ON planning_transition_overrides(from_placement_id);
CREATE INDEX planning_transition_overrides_to_placement_id ON planning_transition_overrides(to_placement_id);
CREATE INDEX planning_transition_overrides_service_id ON planning_transition_overrides(service_id);
CREATE TRIGGER planning_transition_overrides_revision_insert AFTER INSERT ON planning_transition_overrides BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_transition_overrides_revision_update AFTER UPDATE ON planning_transition_overrides BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_transition_overrides_revision_delete AFTER DELETE ON planning_transition_overrides BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TABLE planning_reschedule_requests (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 placement_id TEXT NOT NULL, task_id TEXT NOT NULL, desired_json TEXT NOT NULL CHECK(json_valid(desired_json)), sources_json TEXT NOT NULL CHECK(json_valid(sources_json)), reason TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,placement_id) REFERENCES planning_placements(trip_id,id),
 FOREIGN KEY(trip_id,task_id) REFERENCES planning_items(trip_id,id));
CREATE INDEX planning_reschedule_requests_trip ON planning_reschedule_requests(trip_id);
CREATE INDEX planning_reschedule_requests_placement_id ON planning_reschedule_requests(placement_id);
CREATE INDEX planning_reschedule_requests_task_id ON planning_reschedule_requests(task_id);
CREATE TRIGGER planning_reschedule_requests_revision_insert AFTER INSERT ON planning_reschedule_requests BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_reschedule_requests_revision_update AFTER UPDATE ON planning_reschedule_requests BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_reschedule_requests_revision_delete AFTER DELETE ON planning_reschedule_requests BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE UNIQUE INDEX planning_time_link_live ON planning_time_links(from_placement_id,to_placement_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_transition_live ON planning_transition_overrides(from_placement_id,to_placement_id,context_hash) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_reschedule_open ON planning_reschedule_requests(placement_id) WHERE archived_at IS NULL AND state='open';
