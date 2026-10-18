-- Supplemental place metadata; existing category/status/note rows remain untouched.
ALTER TABLE places ADD COLUMN tags_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(tags_json) AND json_type(tags_json)='object');
ALTER TABLE places ADD COLUMN tags_version INTEGER NOT NULL DEFAULT 1 CHECK(tags_version>=1);
