-- Additive schema only. The explicit, transactional model upgrade is separate.
ALTER TABLE trips ADD COLUMN planning_model INTEGER NOT NULL DEFAULT 2 CHECK(planning_model IN (2,3));
ALTER TABLE trips ADD COLUMN planning_revision INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX planning_items_trip_id ON planning_items(trip_id,id);
ALTER TABLE planning_items ADD COLUMN activation_scope_id TEXT REFERENCES planning_scopes(id);
ALTER TABLE planning_items ADD COLUMN route_owner_decision_id TEXT REFERENCES planning_items(id);
ALTER TABLE planning_items ADD COLUMN decision_mode TEXT CHECK(decision_mode IN ('legacy_place','route_segment'));
ALTER TABLE planning_items ADD COLUMN task_activation TEXT CHECK(task_activation IN ('independent','linked_needs','scope'));
ALTER TABLE planning_items ADD COLUMN completion_placement_id TEXT REFERENCES planning_placements(id);
ALTER TABLE planning_items ADD COLUMN completion_snapshot_json TEXT CHECK(completion_snapshot_json IS NULL OR json_valid(completion_snapshot_json));
ALTER TABLE planning_items ADD COLUMN archived_at INTEGER;
ALTER TABLE planning_items ADD COLUMN archived_by TEXT REFERENCES users(id);
ALTER TABLE planning_options ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1);
ALTER TABLE planning_options ADD COLUMN archived_at INTEGER;
ALTER TABLE planning_events ADD COLUMN operation_id TEXT REFERENCES planning_operations(id);

CREATE TABLE planning_scopes (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 parent_scope_id TEXT, option_id TEXT UNIQUE REFERENCES planning_options(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,parent_scope_id) REFERENCES planning_scopes(trip_id,id),
 CHECK((parent_scope_id IS NULL)=(option_id IS NULL))
);

CREATE TABLE planning_placements (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 item_id TEXT NOT NULL, scope_id TEXT NOT NULL,
 participation TEXT NOT NULL DEFAULT 'included' CHECK(participation IN ('included','excluded')),
 commitment TEXT NOT NULL DEFAULT 'tentative' CHECK(commitment IN ('tentative','approved')),
 precision TEXT NOT NULL CHECK(precision IN ('unscheduled','day','part_of_day','approximate','exact')),
 date_start TEXT, date_end TEXT, starts_at TEXT, ends_at TEXT,
 start_timezone TEXT, end_timezone TEXT,
 part_of_day TEXT CHECK(part_of_day IN ('morning','afternoon','evening','night')),
 intended_duration_minutes INTEGER CHECK(intended_duration_minutes>0),
 order_key INTEGER NOT NULL DEFAULT 0,
 location_state TEXT NOT NULL DEFAULT 'unspecified' CHECK(location_state IN ('unspecified','candidates','chosen')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,item_id) REFERENCES planning_items(trip_id,id),
 FOREIGN KEY(trip_id,scope_id) REFERENCES planning_scopes(trip_id,id)
);

CREATE TABLE planning_placement_places (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 placement_id TEXT NOT NULL, place_id TEXT REFERENCES places(id) ON DELETE SET NULL,
 role TEXT NOT NULL CHECK(role IN ('visit','lodging','departure','arrival','reference')),
 selection TEXT NOT NULL DEFAULT 'chosen' CHECK(selection IN ('chosen','candidate')),
 label_snapshot TEXT NOT NULL, coordinate_snapshot_json TEXT CHECK(coordinate_snapshot_json IS NULL OR json_valid(coordinate_snapshot_json)),
 sort_order INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,placement_id) REFERENCES planning_placements(trip_id,id)
);

CREATE TABLE planning_time_constraints (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 placement_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('fixed_start','fixed_interval','date_range','window','min_duration','max_duration')),
 values_json TEXT NOT NULL CHECK(json_valid(values_json)), reason TEXT NOT NULL, source_url TEXT,
 origin TEXT NOT NULL CHECK(origin IN ('manual','legacy')), version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,placement_id) REFERENCES planning_placements(trip_id,id)
);

CREATE TABLE bookings (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 category TEXT NOT NULL CHECK(category IN ('activity','lodging','air','rail','other')),
 provider_name TEXT NOT NULL DEFAULT '', reference TEXT, note TEXT NOT NULL DEFAULT '',
 source_urls TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_urls)), version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id)
);

CREATE TABLE booking_services (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 booking_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('admission','stay','transport')),
 state TEXT NOT NULL CHECK(state IN ('pending','held','confirmed','cancelled','used','expired','superseded')),
 title TEXT NOT NULL,
 validity TEXT NOT NULL CHECK(validity IN ('exact_start','exact_interval','date_range','open_window','unknown')),
 starts_at TEXT, ends_at TEXT, start_timezone TEXT, end_timezone TEXT, date_start TEXT, date_end TEXT,
 capacity_units INTEGER CHECK(capacity_units>0), unit_type TEXT NOT NULL DEFAULT 'unspecified' CHECK(unit_type IN ('person','room','group','unspecified')),
 hold_expires_at INTEGER, arrival_lead_minutes INTEGER CHECK(arrival_lead_minutes>=0),
 exit_allowance_minutes INTEGER CHECK(exit_allowance_minutes>=0),
 terms_json TEXT NOT NULL DEFAULT '{"schema_version":1}' CHECK(json_valid(terms_json)),
 source_url TEXT, replaces_service_id TEXT, origin TEXT NOT NULL CHECK(origin IN ('manual','legacy_stay')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id), FOREIGN KEY(trip_id,booking_id) REFERENCES bookings(trip_id,id),
 FOREIGN KEY(trip_id,replaces_service_id) REFERENCES booking_services(trip_id,id)
);

CREATE TABLE booking_service_places (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 service_id TEXT NOT NULL, place_id TEXT REFERENCES places(id) ON DELETE SET NULL,
 role TEXT NOT NULL CHECK(role IN ('visit','lodging','departure','arrival','reference')),
 label_snapshot TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,service_id) REFERENCES booking_services(trip_id,id)
);

CREATE TABLE planning_needs (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 scope_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('admission','accommodation','transport','task_result','decision_result')),
 label TEXT NOT NULL, lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','waived','retired')),
 waived_reason TEXT, required_units INTEGER CHECK(required_units>0),
 unit_type TEXT NOT NULL DEFAULT 'unspecified' CHECK(unit_type IN ('person','room','group','unspecified')),
 criteria_json TEXT NOT NULL CHECK(json_valid(criteria_json)), version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,scope_id) REFERENCES planning_scopes(trip_id,id)
);

CREATE TABLE planning_need_targets (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 need_id TEXT NOT NULL, placement_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,need_id) REFERENCES planning_needs(trip_id,id),
 FOREIGN KEY(trip_id,placement_id) REFERENCES planning_placements(trip_id,id)
);

CREATE TABLE planning_need_services (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 need_id TEXT NOT NULL, service_id TEXT NOT NULL,
 allocated_units INTEGER CHECK(allocated_units>0), use_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK(use_mode IN ('exclusive','shared')),
 context_note TEXT NOT NULL DEFAULT '', place_match_override TEXT NOT NULL DEFAULT 'none' CHECK(place_match_override IN ('none','verified')),
 place_match_context_hash TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,need_id) REFERENCES planning_needs(trip_id,id),
 FOREIGN KEY(trip_id,service_id) REFERENCES booking_services(trip_id,id)
);

CREATE TABLE planning_deadlines (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 task_id TEXT, service_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('target','sales_open','sales_close','payment','cancel_by','check_in')),
 at TEXT, local_date TEXT, timezone TEXT NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('manual','provider')), source_url TEXT, note TEXT NOT NULL DEFAULT '',
 mode TEXT CHECK(mode IN ('manual','relative')), aggregate TEXT CHECK(aggregate='min'), version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,task_id) REFERENCES planning_items(trip_id,id),
 FOREIGN KEY(trip_id,service_id) REFERENCES booking_services(trip_id,id),
 CHECK((task_id IS NULL)<>(service_id IS NULL)),
 CHECK((at IS NULL)<>(local_date IS NULL) OR (mode='relative' AND at IS NULL AND local_date IS NULL))
);

CREATE UNIQUE INDEX planning_root_scope ON planning_scopes(trip_id) WHERE parent_scope_id IS NULL;
CREATE UNIQUE INDEX planning_live_placement ON planning_placements(item_id,scope_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_live_need_target ON planning_need_targets(need_id,placement_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_live_need_service ON planning_need_services(need_id,service_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_target_deadline ON planning_deadlines(task_id) WHERE kind='target' AND archived_at IS NULL;
CREATE UNIQUE INDEX planning_live_place_role ON planning_placement_places(placement_id,role) WHERE archived_at IS NULL AND selection='chosen' AND role IN ('lodging','departure','arrival');

CREATE TABLE planning_migration_refs (
 trip_id TEXT NOT NULL REFERENCES trips(id), source_table TEXT NOT NULL, source_id TEXT NOT NULL,
 target_kind TEXT NOT NULL, target_id TEXT NOT NULL, migration_key TEXT NOT NULL,
 PRIMARY KEY(trip_id,source_table,source_id,target_kind,migration_key)
);
CREATE TABLE planning_changesets (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), author_id TEXT NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL CHECK(status IN ('draft','ready','applied','cancelled')),
 commands_json TEXT NOT NULL CHECK(json_valid(commands_json)), stable_ids_json TEXT NOT NULL CHECK(json_valid(stable_ids_json)),
 preview_json TEXT CHECK(preview_json IS NULL OR json_valid(preview_json)),
 base_revision INTEGER, fingerprint TEXT, expires_at INTEGER, applied_result_json TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX planning_changesets_author ON planning_changesets(trip_id,author_id);
CREATE TABLE planning_operations (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), actor_id TEXT NOT NULL REFERENCES users(id),
 idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 changeset_id TEXT REFERENCES planning_changesets(id), result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 applied_at INTEGER NOT NULL, UNIQUE(trip_id,actor_id,idempotency_key)
);
CREATE TABLE planning_event_refs (
 event_id TEXT NOT NULL REFERENCES planning_events(id), item_id TEXT REFERENCES planning_items(id),
 placement_id TEXT REFERENCES planning_placements(id),
 CHECK((item_id IS NULL)<>(placement_id IS NULL))
);
CREATE INDEX planning_event_refs_item ON planning_event_refs(item_id,event_id);
CREATE INDEX planning_event_refs_placement ON planning_event_refs(placement_id,event_id);
CREATE INDEX planning_events_operation ON planning_events(operation_id);
-- ON DELETE SET NULL keeps the historical label, but must also invalidate versions.
CREATE TRIGGER planning_place_detached AFTER UPDATE OF place_id ON planning_placement_places
 WHEN OLD.place_id IS NOT NULL AND NEW.place_id IS NULL AND NEW.version=OLD.version
 BEGIN
 UPDATE planning_placement_places SET version=version+1,updated_by=NULL,updated_at=unixepoch()*1000 WHERE id=NEW.id;
 UPDATE planning_placements SET version=version+1,updated_by=NULL,updated_at=unixepoch()*1000 WHERE id=NEW.placement_id;
 UPDATE planning_items SET version=version+1,updated_at=unixepoch()*1000 WHERE id=(SELECT item_id FROM planning_placements WHERE id=NEW.placement_id);
 END;
CREATE TRIGGER booking_place_detached AFTER UPDATE OF place_id ON booking_service_places
 WHEN OLD.place_id IS NOT NULL AND NEW.place_id IS NULL AND NEW.version=OLD.version
 BEGIN
 UPDATE booking_service_places SET version=version+1,updated_by=NULL,updated_at=unixepoch()*1000 WHERE id=NEW.id;
 UPDATE booking_services SET version=version+1,updated_by=NULL,updated_at=unixepoch()*1000 WHERE id=NEW.service_id;
 UPDATE bookings SET version=version+1,updated_by=NULL,updated_at=unixepoch()*1000 WHERE id=(SELECT booking_id FROM booking_services WHERE id=NEW.service_id);
 END;
CREATE INDEX planning_scopes_trip ON planning_scopes(trip_id);
CREATE INDEX planning_scopes_parent_scope_id ON planning_scopes(parent_scope_id);
CREATE INDEX planning_scopes_option_id ON planning_scopes(option_id);
CREATE INDEX planning_placements_trip ON planning_placements(trip_id);
CREATE INDEX planning_placements_item_id ON planning_placements(item_id);
CREATE INDEX planning_placements_scope_id ON planning_placements(scope_id);
CREATE INDEX planning_placement_places_trip ON planning_placement_places(trip_id);
CREATE INDEX planning_placement_places_placement_id ON planning_placement_places(placement_id);
CREATE INDEX planning_placement_places_place_id ON planning_placement_places(place_id);
CREATE INDEX planning_time_constraints_trip ON planning_time_constraints(trip_id);
CREATE INDEX planning_time_constraints_placement_id ON planning_time_constraints(placement_id);
CREATE INDEX bookings_trip ON bookings(trip_id);
CREATE INDEX booking_services_trip ON booking_services(trip_id);
CREATE INDEX booking_services_booking_id ON booking_services(booking_id);
CREATE INDEX booking_services_replaces_service_id ON booking_services(replaces_service_id);
CREATE INDEX booking_service_places_trip ON booking_service_places(trip_id);
CREATE INDEX booking_service_places_service_id ON booking_service_places(service_id);
CREATE INDEX booking_service_places_place_id ON booking_service_places(place_id);
CREATE INDEX planning_needs_trip ON planning_needs(trip_id);
CREATE INDEX planning_needs_scope_id ON planning_needs(scope_id);
CREATE INDEX planning_need_targets_trip ON planning_need_targets(trip_id);
CREATE INDEX planning_need_targets_need_id ON planning_need_targets(need_id);
CREATE INDEX planning_need_targets_placement_id ON planning_need_targets(placement_id);
CREATE INDEX planning_need_services_trip ON planning_need_services(trip_id);
CREATE INDEX planning_need_services_need_id ON planning_need_services(need_id);
CREATE INDEX planning_need_services_service_id ON planning_need_services(service_id);
CREATE INDEX planning_deadlines_trip ON planning_deadlines(trip_id);
CREATE INDEX planning_deadlines_task_id ON planning_deadlines(task_id);
CREATE INDEX planning_deadlines_service_id ON planning_deadlines(service_id);
CREATE TRIGGER planning_scopes_revision_insert AFTER INSERT ON planning_scopes BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_scopes_revision_update AFTER UPDATE ON planning_scopes BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_scopes_revision_delete AFTER DELETE ON planning_scopes BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER planning_placements_revision_insert AFTER INSERT ON planning_placements BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_placements_revision_update AFTER UPDATE ON planning_placements BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_placements_revision_delete AFTER DELETE ON planning_placements BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER planning_placement_places_revision_insert AFTER INSERT ON planning_placement_places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_placement_places_revision_update AFTER UPDATE ON planning_placement_places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_placement_places_revision_delete AFTER DELETE ON planning_placement_places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER planning_time_constraints_revision_insert AFTER INSERT ON planning_time_constraints BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_time_constraints_revision_update AFTER UPDATE ON planning_time_constraints BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_time_constraints_revision_delete AFTER DELETE ON planning_time_constraints BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER bookings_revision_insert AFTER INSERT ON bookings BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER bookings_revision_update AFTER UPDATE ON bookings BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER bookings_revision_delete AFTER DELETE ON bookings BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER booking_services_revision_insert AFTER INSERT ON booking_services BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER booking_services_revision_update AFTER UPDATE ON booking_services BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER booking_services_revision_delete AFTER DELETE ON booking_services BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER booking_service_places_revision_insert AFTER INSERT ON booking_service_places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER booking_service_places_revision_update AFTER UPDATE ON booking_service_places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER booking_service_places_revision_delete AFTER DELETE ON booking_service_places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER planning_needs_revision_insert AFTER INSERT ON planning_needs BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_needs_revision_update AFTER UPDATE ON planning_needs BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_needs_revision_delete AFTER DELETE ON planning_needs BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER planning_need_targets_revision_insert AFTER INSERT ON planning_need_targets BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_targets_revision_update AFTER UPDATE ON planning_need_targets BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_targets_revision_delete AFTER DELETE ON planning_need_targets BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER planning_need_services_revision_insert AFTER INSERT ON planning_need_services BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_services_revision_update AFTER UPDATE ON planning_need_services BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_services_revision_delete AFTER DELETE ON planning_need_services BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER planning_deadlines_revision_insert AFTER INSERT ON planning_deadlines BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_deadlines_revision_update AFTER UPDATE ON planning_deadlines BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_deadlines_revision_delete AFTER DELETE ON planning_deadlines BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER planning_items_revision_insert AFTER INSERT ON planning_items BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_items_revision_update AFTER UPDATE ON planning_items BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_items_revision_delete AFTER DELETE ON planning_items BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER places_revision_insert AFTER INSERT ON places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER places_revision_update AFTER UPDATE ON places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER places_revision_delete AFTER DELETE ON places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER trip_timezone_changes_revision_insert AFTER INSERT ON trip_timezone_changes BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER trip_timezone_changes_revision_update AFTER UPDATE ON trip_timezone_changes BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER trip_timezone_changes_revision_delete AFTER DELETE ON trip_timezone_changes BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER planning_options_revision_insert AFTER INSERT ON planning_options BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=(SELECT trip_id FROM planning_items WHERE id=NEW.item_id); END;
CREATE TRIGGER planning_options_revision_update AFTER UPDATE ON planning_options BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=(SELECT trip_id FROM planning_items WHERE id=NEW.item_id); END;
CREATE TRIGGER planning_options_revision_delete AFTER DELETE ON planning_options BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=(SELECT trip_id FROM planning_items WHERE id=OLD.item_id); END;
CREATE TRIGGER planning_item_places_revision_insert AFTER INSERT ON planning_item_places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=(SELECT trip_id FROM planning_items WHERE id=NEW.item_id); END;
CREATE TRIGGER planning_item_places_revision_update AFTER UPDATE ON planning_item_places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=(SELECT trip_id FROM planning_items WHERE id=NEW.item_id); END;
CREATE TRIGGER planning_item_places_revision_delete AFTER DELETE ON planning_item_places BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=(SELECT trip_id FROM planning_items WHERE id=OLD.item_id); END;
CREATE TRIGGER planning_dependencies_revision_insert AFTER INSERT ON planning_dependencies BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=(SELECT trip_id FROM planning_items WHERE id=NEW.item_id); END;
CREATE TRIGGER planning_dependencies_revision_update AFTER UPDATE ON planning_dependencies BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=(SELECT trip_id FROM planning_items WHERE id=NEW.item_id); END;
CREATE TRIGGER planning_dependencies_revision_delete AFTER DELETE ON planning_dependencies BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=(SELECT trip_id FROM planning_items WHERE id=OLD.item_id); END;
CREATE TRIGGER planning_trip_revision AFTER UPDATE OF departure_date,start_date,end_date,timezone,timezone_revision,planning_model ON trips
 WHEN OLD.departure_date IS NOT NEW.departure_date OR OLD.start_date IS NOT NEW.start_date OR OLD.end_date IS NOT NEW.end_date OR OLD.timezone IS NOT NEW.timezone OR OLD.timezone_revision IS NOT NEW.timezone_revision OR OLD.planning_model IS NOT NEW.planning_model
 BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.id; END;

