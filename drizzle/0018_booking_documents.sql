-- Immutable private assets; shared document metadata is written through changesets.
CREATE TABLE document_uploads (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), owner_id TEXT NOT NULL REFERENCES users(id),
 storage_key TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL, declared_size INTEGER NOT NULL CHECK(declared_size>0),
 expected_sha256 TEXT NOT NULL, declared_mime TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','receiving','uploaded','finalized','failed','expired')),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, lease_until INTEGER,
 UNIQUE(trip_id,id)
);
CREATE INDEX document_uploads_quota ON document_uploads(trip_id,status,expires_at);
CREATE TABLE document_assets (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), upload_id TEXT NOT NULL UNIQUE,
 storage_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size>0),
 detected_mime TEXT NOT NULL, original_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('ready','quarantined','deleted')),
 created_at INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 UNIQUE(trip_id,id), FOREIGN KEY(trip_id,upload_id) REFERENCES document_uploads(trip_id,id)
);
CREATE INDEX document_assets_trip ON document_assets(trip_id,status);
CREATE TABLE documents (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
 kind TEXT NOT NULL CHECK(kind IN ('file','link')), title TEXT NOT NULL,
 asset_id TEXT, external_url TEXT, replaces_document_id TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id), archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id), FOREIGN KEY(trip_id,asset_id) REFERENCES document_assets(trip_id,id),
 FOREIGN KEY(trip_id,replaces_document_id) REFERENCES documents(trip_id,id),
 CHECK((kind='file' AND asset_id IS NOT NULL AND external_url IS NULL) OR (kind='link' AND asset_id IS NULL AND external_url IS NOT NULL)),
 CHECK(replaces_document_id IS NULL OR replaces_document_id<>id)
);
CREATE INDEX documents_asset ON documents(asset_id);
CREATE INDEX documents_replaces ON documents(replaces_document_id);
CREATE INDEX documents_trip ON documents(trip_id);
CREATE TABLE booking_documents (
 id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), booking_id TEXT NOT NULL, service_id TEXT, document_id TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id), archived_at INTEGER, archived_by TEXT REFERENCES users(id),
 UNIQUE(trip_id,id), FOREIGN KEY(trip_id,booking_id) REFERENCES bookings(trip_id,id),
 FOREIGN KEY(trip_id,service_id) REFERENCES booking_services(trip_id,id), FOREIGN KEY(trip_id,document_id) REFERENCES documents(trip_id,id)
);
CREATE INDEX booking_documents_trip ON booking_documents(trip_id);
CREATE INDEX booking_documents_document ON booking_documents(document_id);
CREATE INDEX booking_documents_service ON booking_documents(service_id);
CREATE UNIQUE INDEX booking_document_live ON booking_documents(booking_id,IFNULL(service_id,''),document_id) WHERE archived_at IS NULL;
CREATE TABLE planning_document_event_refs (
 event_id TEXT NOT NULL REFERENCES planning_events(id), document_id TEXT NOT NULL REFERENCES documents(id),
 PRIMARY KEY(event_id,document_id)
);
CREATE INDEX planning_document_events_document ON planning_document_event_refs(document_id);
CREATE TABLE document_storage_leases (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TRIGGER documents_revision_insert AFTER INSERT ON documents BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER documents_revision_update AFTER UPDATE ON documents BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER documents_revision_delete AFTER DELETE ON documents BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
CREATE TRIGGER booking_documents_revision_insert AFTER INSERT ON booking_documents BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER booking_documents_revision_update AFTER UPDATE ON booking_documents BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=NEW.trip_id; END;
CREATE TRIGGER booking_documents_revision_delete AFTER DELETE ON booking_documents BEGIN UPDATE trips SET planning_revision=planning_revision+1 WHERE id=OLD.trip_id; END;
