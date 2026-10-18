ALTER TABLE places ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1));
ALTER TABLE places ADD COLUMN visibility_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX places_visibility_idx ON places(trip_id,hidden);
