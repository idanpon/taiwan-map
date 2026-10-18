ALTER TABLE statuses ADD COLUMN dimmed INTEGER NOT NULL DEFAULT 0 CHECK(dimmed IN (0,1));
UPDATE statuses SET dimmed=1,version=version+1 WHERE id='visited';
