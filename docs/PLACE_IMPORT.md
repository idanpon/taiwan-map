# Incremental place import

`server/import-places.mjs` imports a privately prepared, reviewed JSON manifest
into an existing map. It is separate from `server/import.mjs`, which restores
an export into an empty database. Keep real source files and manifests out of
the public repository.

Each manifest record retains the original CSV row. Only `import_action=import`
can create a place; `review` and `separate` are always skipped. New places use
the source ID. Explicit `existing_id` mappings preserve old IDs and their
associated notes, statuses, hours and links. A category conflict must carry an
explicit approved `category_change: {from, to}`. Nothing writes visit states.

Coordinates require human-reviewed correspondence, a source URL and an honest
precision label. Missing or ambiguous results remain pending. Do not accept a
nearby station, bicycle rental, another branch or a whole river's midpoint as
the requested destination. Mall coordinates must be labelled as building-level
coordinates, with the floor retained separately. Opening hours default to
unverified; imported places do not acquire a fabricated verification date.

The source-ID ledger lives in `app_meta` under `import:taiwan-trip-csv:TWnnn`.
It retains the target ID, source row fingerprint and geocoding provenance.
Repeated identical records are unchanged. Changed source rows require manual
reconciliation. Imports run in one transaction; validation, uniqueness or
foreign-key failures leave the batch unapplied.

Check first:

```sh
DATABASE_PATH=/private/copy.sqlite node server/import-places.mjs /private/manifest.json --check
```

Apply on a database copy, compare preserved tables, and repeat to check
idempotency before touching production. The apply command creates a consistent
SQLite backup before writing and refuses to overwrite an existing backup:

```sh
DATABASE_PATH=/private/copy.sqlite node server/import-places.mjs /private/manifest.json --apply /private/before-import.sqlite
```

Use a private directory and the database's service account in production.
Retain the manifest, backup and import report together. Code checkout should
use `umask 022`; backups and manifests remain private. No service restart is
required just to add records to the existing database.
