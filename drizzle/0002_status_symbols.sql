ALTER TABLE statuses ADD COLUMN symbol TEXT NOT NULL DEFAULT '';
ALTER TABLE statuses ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Persist the palette previously applied only by the browser. Later edits are
-- taken directly from the saved status, including edits to built-in statuses.
UPDATE statuses SET color='#1456e0',symbol='!' WHERE id='want';
UPDATE statuses SET color='#6b7280',symbol='✓' WHERE id='visited';
UPDATE statuses SET color='#facc15',symbol='?' WHERE id='maybe';
UPDATE statuses SET color='#dc2626' WHERE trim(replace(replace(replace(lower(label),'🔥',''),'!',''),'Х','х')) IN ('хайп','hype');
