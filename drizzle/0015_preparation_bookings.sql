-- Stage 2: preparation and supplier facts; model3 remains explicit opt-in.
CREATE TABLE planning_need_tasks (id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id),
 need_id TEXT NOT NULL, task_id TEXT NOT NULL, relation TEXT NOT NULL CHECK(relation IN ('produce','review')), version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,need_id) REFERENCES planning_needs(trip_id,id),
 FOREIGN KEY(trip_id,task_id) REFERENCES planning_items(trip_id,id));
CREATE INDEX planning_need_tasks_trip ON planning_need_tasks(trip_id);
CREATE INDEX planning_need_tasks_need_id ON planning_need_tasks(need_id);
CREATE INDEX planning_need_tasks_task_id ON planning_need_tasks(task_id);
CREATE TRIGGER planning_need_tasks_revision_insert AFTER INSERT ON planning_need_tasks BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_tasks_revision_update AFTER UPDATE ON planning_need_tasks BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_tasks_revision_delete AFTER DELETE ON planning_need_tasks BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TABLE planning_need_task_results (id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id),
 need_id TEXT NOT NULL, task_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,need_id) REFERENCES planning_needs(trip_id,id),
 FOREIGN KEY(trip_id,task_id) REFERENCES planning_items(trip_id,id));
CREATE INDEX planning_need_task_results_trip ON planning_need_task_results(trip_id);
CREATE INDEX planning_need_task_results_need_id ON planning_need_task_results(need_id);
CREATE INDEX planning_need_task_results_task_id ON planning_need_task_results(task_id);
CREATE TRIGGER planning_need_task_results_revision_insert AFTER INSERT ON planning_need_task_results BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_task_results_revision_update AFTER UPDATE ON planning_need_task_results BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_task_results_revision_delete AFTER DELETE ON planning_need_task_results BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TABLE planning_service_tasks (id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id),
 service_id TEXT NOT NULL, task_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('exchange','cancel','review')), version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,service_id) REFERENCES booking_services(trip_id,id),
 FOREIGN KEY(trip_id,task_id) REFERENCES planning_items(trip_id,id));
CREATE INDEX planning_service_tasks_trip ON planning_service_tasks(trip_id);
CREATE INDEX planning_service_tasks_service_id ON planning_service_tasks(service_id);
CREATE INDEX planning_service_tasks_task_id ON planning_service_tasks(task_id);
CREATE TRIGGER planning_service_tasks_revision_insert AFTER INSERT ON planning_service_tasks BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_service_tasks_revision_update AFTER UPDATE ON planning_service_tasks BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_service_tasks_revision_delete AFTER DELETE ON planning_service_tasks BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TABLE planning_task_prerequisites (id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id),
 task_id TEXT NOT NULL, required_task_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,task_id) REFERENCES planning_items(trip_id,id),
 FOREIGN KEY(trip_id,required_task_id) REFERENCES planning_items(trip_id,id), CHECK(task_id<>required_task_id));
CREATE INDEX planning_task_prerequisites_trip ON planning_task_prerequisites(trip_id);
CREATE INDEX planning_task_prerequisites_task_id ON planning_task_prerequisites(task_id);
CREATE INDEX planning_task_prerequisites_required_task_id ON planning_task_prerequisites(required_task_id);
CREATE TRIGGER planning_task_prerequisites_revision_insert AFTER INSERT ON planning_task_prerequisites BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_task_prerequisites_revision_update AFTER UPDATE ON planning_task_prerequisites BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_task_prerequisites_revision_delete AFTER DELETE ON planning_task_prerequisites BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TABLE planning_need_exemptions (id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id),
 need_id TEXT NOT NULL, placement_id TEXT NOT NULL,
 date_start TEXT NOT NULL, date_end TEXT NOT NULL, reason TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id),
 FOREIGN KEY(trip_id,need_id) REFERENCES planning_needs(trip_id,id),
 FOREIGN KEY(trip_id,placement_id) REFERENCES planning_placements(trip_id,id), CHECK(date_start<date_end));
CREATE INDEX planning_need_exemptions_trip ON planning_need_exemptions(trip_id);
CREATE INDEX planning_need_exemptions_need_id ON planning_need_exemptions(need_id);
CREATE INDEX planning_need_exemptions_placement_id ON planning_need_exemptions(placement_id);
CREATE TRIGGER planning_need_exemptions_revision_insert AFTER INSERT ON planning_need_exemptions BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_exemptions_revision_update AFTER UPDATE ON planning_need_exemptions BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_exemptions_revision_delete AFTER DELETE ON planning_need_exemptions BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TABLE planning_deadline_rules (id TEXT PRIMARY KEY,trip_id TEXT NOT NULL REFERENCES trips(id),
 task_id TEXT NOT NULL, anchor_placement_id TEXT NOT NULL,
 anchor TEXT NOT NULL CHECK(anchor IN ('start','end')),
 offset_minutes INTEGER, offset_days INTEGER, rule_timezone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id), FOREIGN KEY(trip_id,task_id) REFERENCES planning_items(trip_id,id),
 FOREIGN KEY(trip_id,anchor_placement_id) REFERENCES planning_placements(trip_id,id),
 CHECK((offset_minutes IS NULL)<>(offset_days IS NULL)));
CREATE INDEX planning_deadline_rules_trip ON planning_deadline_rules(trip_id);
CREATE INDEX planning_deadline_rules_task_id ON planning_deadline_rules(task_id);
CREATE INDEX planning_deadline_rules_anchor_placement_id ON planning_deadline_rules(anchor_placement_id);
CREATE TRIGGER planning_deadline_rules_revision_insert AFTER INSERT ON planning_deadline_rules BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_deadline_rules_revision_update AFTER UPDATE ON planning_deadline_rules BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_deadline_rules_revision_delete AFTER DELETE ON planning_deadline_rules BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE UNIQUE INDEX planning_need_tasks_live ON planning_need_tasks(need_id,task_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_need_task_results_live ON planning_need_task_results(need_id,task_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_service_tasks_live ON planning_service_tasks(service_id,task_id,action) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_task_prerequisites_live ON planning_task_prerequisites(task_id,required_task_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_deadline_rules_live ON planning_deadline_rules(task_id,anchor_placement_id,anchor) WHERE archived_at IS NULL;
CREATE TABLE planning_result_event_refs (
 event_id TEXT NOT NULL REFERENCES planning_events(id), need_id TEXT REFERENCES planning_needs(id),
 booking_id TEXT REFERENCES bookings(id), service_id TEXT REFERENCES booking_services(id),
 CHECK((need_id IS NOT NULL)+(booking_id IS NOT NULL)+(service_id IS NOT NULL)=1));
CREATE INDEX planning_result_events_need ON planning_result_event_refs(need_id,event_id);
CREATE INDEX planning_result_events_booking ON planning_result_event_refs(booking_id,event_id);
CREATE INDEX planning_result_events_service ON planning_result_event_refs(service_id,event_id);
CREATE UNIQUE INDEX booking_service_live_place ON booking_service_places(service_id,role) WHERE archived_at IS NULL AND role IN ('lodging','departure','arrival');

