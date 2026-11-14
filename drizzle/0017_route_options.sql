-- Stage 4: route options. Existing choices, supplier facts and model opt-in are preserved.
ALTER TABLE planning_options ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planning_options ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planning_options ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE planning_options ADD COLUMN updated_by TEXT REFERENCES users(id);
ALTER TABLE planning_options ADD COLUMN archived_by TEXT REFERENCES users(id);

CREATE TABLE planning_decisions (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), scope_id TEXT NOT NULL,
 working_option_id TEXT REFERENCES planning_options(id), accepted_option_id TEXT REFERENCES planning_options(id), resolution TEXT NOT NULL DEFAULT 'open' CHECK(resolution IN ('open','accepted','review')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id), archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id), FOREIGN KEY(trip_id,id) REFERENCES planning_items(trip_id,id), FOREIGN KEY(trip_id,scope_id) REFERENCES planning_scopes(trip_id,id));
CREATE INDEX planning_decisions_trip_id ON planning_decisions(trip_id);
CREATE INDEX planning_decisions_scope_id ON planning_decisions(scope_id);
CREATE INDEX planning_decisions_working_option_id ON planning_decisions(working_option_id);
CREATE INDEX planning_decisions_accepted_option_id ON planning_decisions(accepted_option_id);
CREATE TRIGGER planning_decisions_revision_insert AFTER INSERT ON planning_decisions BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_decisions_revision_update AFTER UPDATE ON planning_decisions BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_decisions_revision_delete AFTER DELETE ON planning_decisions BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;

CREATE TABLE planning_option_constraints (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), option_id TEXT NOT NULL REFERENCES planning_options(id), other_option_id TEXT NOT NULL REFERENCES planning_options(id), relation TEXT NOT NULL CHECK(relation IN ('requires_option','excludes_option')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id), archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id), CHECK(option_id<>other_option_id));
CREATE INDEX planning_option_constraints_trip_id ON planning_option_constraints(trip_id);
CREATE INDEX planning_option_constraints_option_id ON planning_option_constraints(option_id);
CREATE INDEX planning_option_constraints_other_option_id ON planning_option_constraints(other_option_id);
CREATE TRIGGER planning_option_constraints_revision_insert AFTER INSERT ON planning_option_constraints BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_option_constraints_revision_update AFTER UPDATE ON planning_option_constraints BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_option_constraints_revision_delete AFTER DELETE ON planning_option_constraints BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;

CREATE TABLE planning_decision_gaps (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), decision_id TEXT NOT NULL, label TEXT NOT NULL, date_start TEXT, date_end TEXT, location_hint TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id), archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id), FOREIGN KEY(trip_id,decision_id) REFERENCES planning_decisions(trip_id,id), CHECK(date_start IS NULL OR date_end IS NULL OR date_start<=date_end));
CREATE INDEX planning_decision_gaps_trip_id ON planning_decision_gaps(trip_id);
CREATE INDEX planning_decision_gaps_decision_id ON planning_decision_gaps(decision_id);
CREATE TRIGGER planning_decision_gaps_revision_insert AFTER INSERT ON planning_decision_gaps BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_decision_gaps_revision_update AFTER UPDATE ON planning_decision_gaps BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_decision_gaps_revision_delete AFTER DELETE ON planning_decision_gaps BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;

CREATE TABLE planning_need_decision_results (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), need_id TEXT NOT NULL, decision_id TEXT NOT NULL, required_option_id TEXT REFERENCES planning_options(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id), archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id), FOREIGN KEY(trip_id,need_id) REFERENCES planning_needs(trip_id,id), FOREIGN KEY(trip_id,decision_id) REFERENCES planning_decisions(trip_id,id));
CREATE INDEX planning_need_decision_results_trip_id ON planning_need_decision_results(trip_id);
CREATE INDEX planning_need_decision_results_need_id ON planning_need_decision_results(need_id);
CREATE INDEX planning_need_decision_results_decision_id ON planning_need_decision_results(decision_id);
CREATE INDEX planning_need_decision_results_required_option_id ON planning_need_decision_results(required_option_id);
CREATE TRIGGER planning_need_decision_results_revision_insert AFTER INSERT ON planning_need_decision_results BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_decision_results_revision_update AFTER UPDATE ON planning_need_decision_results BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_need_decision_results_revision_delete AFTER DELETE ON planning_need_decision_results BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;

CREATE TABLE planning_task_decision_prerequisites (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), task_id TEXT NOT NULL, decision_id TEXT NOT NULL, required_option_id TEXT REFERENCES planning_options(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id), archived_at INTEGER, archived_by TEXT REFERENCES users(id), UNIQUE(trip_id,id), FOREIGN KEY(trip_id,task_id) REFERENCES planning_items(trip_id,id), FOREIGN KEY(trip_id,decision_id) REFERENCES planning_decisions(trip_id,id));
CREATE INDEX planning_task_decision_prerequisites_trip_id ON planning_task_decision_prerequisites(trip_id);
CREATE INDEX planning_task_decision_prerequisites_task_id ON planning_task_decision_prerequisites(task_id);
CREATE INDEX planning_task_decision_prerequisites_decision_id ON planning_task_decision_prerequisites(decision_id);
CREATE INDEX planning_task_decision_prerequisites_required_option_id ON planning_task_decision_prerequisites(required_option_id);
CREATE TRIGGER planning_task_decision_prerequisites_revision_insert AFTER INSERT ON planning_task_decision_prerequisites BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_task_decision_prerequisites_revision_update AFTER UPDATE ON planning_task_decision_prerequisites BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER planning_task_decision_prerequisites_revision_delete AFTER DELETE ON planning_task_decision_prerequisites BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE UNIQUE INDEX planning_option_constraint_live ON planning_option_constraints(option_id,other_option_id,relation) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_decision_gap_live ON planning_decision_gaps(decision_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_need_decision_result_live ON planning_need_decision_results(need_id,decision_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX planning_task_decision_prerequisite_live ON planning_task_decision_prerequisites(task_id,decision_id) WHERE archived_at IS NULL;
