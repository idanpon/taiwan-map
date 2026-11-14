import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, migrate } from '../server/database.mjs';
import { rehearsePlanningRelease } from '../server/rehearse-planning-release.mjs';
import { databaseInventory } from '../server/rehearse-planning-upgrade.mjs';
import { backupDocuments } from '../server/document-backup.mjs';
import { createDocumentStorage, documentHash } from '../server/document-storage.mjs';
import { fingerprint } from '../src/planning-domain-store.mjs';
import { upgradePlanningModel } from '../src/planning-upgrade.mjs';
import { startDocumentUpload, receiveDocumentUpload, finalizeDocumentUpload } from '../src/documents.mjs';
import { handle } from '../src/core.mjs';
import { seed } from '../src/seed.mjs';
import { TRIP } from '../src/auth.mjs';
import { one, run } from '../src/sqlite.mjs';
import { routeFixture, ref, NOW } from './route-ui-fixture.mjs';
import { routeUIScenario } from './route-ui-scenario.mjs';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
function directory(t) {
  const dir = mkdtempSync(join(tmpdir(), 'taiwan-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function open(t, file) { const db = openDatabase(file); t.after(() => db.close()); return db; }

test('full release rehearsal preserves an old model2 snapshot and verifies model3 backup recovery', async t => {
  const dir = directory(t), migrations = join(dir, 'migrations'); mkdirSync(migrations);
  for (const file of readdirSync('drizzle').filter(name => name < '0014')) copyFileSync(join('drizzle', file), join(migrations, file));
  const file = join(dir, 'source.sqlite'), source = open(t, file); migrate(source, migrations); await seed(source);
  run(source, "INSERT INTO planning_items(id,trip_id,kind,title,note,date_start,date_end,version,created_by,updated_by,created_at,updated_at) VALUES('hotel',?,'stay','Private hotel','Keep this note','2035-01-04','2035-01-07',9,'trip-shared','trip-shared',1,1)", TRIP);
  run(source, "INSERT INTO planning_item_places(id,item_id,place_id,place_name,role) VALUES('hotel-place','hotel','taipei-101','Private address','lodging')");
  run(source, "INSERT INTO planning_events(id,trip_id,item_id,actor_id,action,payload,created_at) VALUES('past',?,'hotel','trip-shared','create','{}',1)", TRIP);
  const before = fingerprint(databaseInventory(source.sqlite)), output = join(dir, 'release');
  const report = await rehearsePlanningRelease(file, output, 'trip-shared');
  assert.equal(report.verified, true); assert.equal(report.source_unchanged, true);
  assert.equal(report.migration.schema_model, 2); assert.equal(report.migration.schema_rows_preserved, true);
  assert.equal(report.migration.counts.stays, 1); assert.equal(report.recovery.data_preserved, true);
  assert.equal(report.recovery.assets, 0); assert.equal(report.production_changed, false);
  assert.equal(fingerprint(databaseInventory(source.sqlite)), before);
  const rollback = open(t, join(output, 'rollback', 'database.sqlite'));
  assert.equal(fingerprint(databaseInventory(rollback.sqlite)), before);
  const recovered = open(t, join(output, 'recovered', 'database.sqlite'));
  assert.equal(one(recovered, 'SELECT planning_model FROM trips').planning_model, 3);
  assert.equal(one(recovered, "SELECT version FROM planning_items WHERE id='hotel'").version, 9);
  assert.equal(one(recovered, "SELECT note FROM planning_items WHERE id='hotel'").note, 'Keep this note');
  assert.equal(existsSync(join(output, 'INCOMPLETE')), false);
  const text = readFileSync(join(output, 'report.json'), 'utf8');
  assert(!text.includes('Private hotel')); assert(!text.includes('Keep this note')); assert(!text.includes('Private address'));
  assert.equal(statSync(output).mode & 0o777, 0o700); assert.equal(statSync(join(output, 'report.json')).mode & 0o777, 0o600);
  await assert.rejects(rehearsePlanningRelease(file, output, 'trip-shared'), /EEXIST/);
  assert.equal(readFileSync(join(output, 'report.json'), 'utf8'), text);
});

test('bundle rehearsal recovers route decisions, current/history/private files and fails closed without complete assets', async t => {
  const dir = directory(t), f = await routeFixture(t, { filename: join(dir, 'source.sqlite') });
  f.db.documentStore = createDocumentStorage(join(dir, 'documents'));
  const ids = routeUIScenario(f);
  const start = actor => startDocumentUpload(f.db, actor, { original_name: 'ticket.pdf', byte_size: PDF.length, sha256: documentHash(PDF), mime: 'application/pdf' }, NOW);
  async function upload(actor = f.users.editor) {
    const u = start(actor); await receiveDocumentUpload(f.db, actor, u.id, new Request('https://example.test', { method: 'POST', body: PDF }), { now: () => NOW });
    return finalizeDocumentUpload(f.db, actor, u.id, NOW).asset;
  }
  const first = await upload(), second = await upload(), privateAsset = await upload(f.users.other);
  const docs = f.write([{ key: 'doc', type: 'create_document', data: { kind: 'file', asset_id: first.id, title: 'Original ticket' } },
    { key: 'binding', type: 'attach_document', expected_version: 0, document_id: ref('doc', 'document'), booking_id: ids.booking.booking, service_id: ids.ticket.service }]);
  const newer = f.write([{ key: 'new', type: 'replace_document', id: docs.doc.document, expected_version: 1, reason: 'Reissued', data: { kind: 'file', asset_id: second.id, title: 'New ticket' } }]);
  const pending = start(f.users.editor), bundle = join(dir, 'bundle');
  await backupDocuments(f.db, f.db.documentStore, bundle);
  const before = fingerprint(databaseInventory(f.db.sqlite)), output = join(dir, 'release');
  const report = await rehearsePlanningRelease(bundle, output, 'editor');
  assert.equal(report.migration.already_upgraded, true); assert.equal(report.migration.schema_model, 3);
  assert.equal(report.recovery.assets, 3); assert.equal(report.recovery.bytes, PDF.length * 3);
  assert.equal(fingerprint(databaseInventory(f.db.sqlite)), before);
  const db = open(t, join(output, 'recovered', 'database.sqlite'));
  db.documentStore = createDocumentStorage(join(output, 'recovered', 'documents'));
  assert.equal(one(db, 'SELECT status FROM document_uploads WHERE id=?', pending.id).status, 'expired');
  assert.equal(one(db, 'SELECT count(*) n FROM document_storage_leases').n, 0);
  assert.equal(one(db, 'SELECT status FROM document_assets WHERE id=?', privateAsset.id).status, 'ready');
  assert.equal(one(db, 'SELECT state FROM booking_services WHERE id=?', ids.hotelService.service).state, 'confirmed');
  for (const id of [docs.doc.document, newer.new.document]) {
    const response = await handle(new Request('https://example.test/api/documents/' + id + '/content', { headers: { Authorization: 'Bearer ' + f.tokens.viewer } }), { ...f.env, DB: db });
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF);
  }
  await assert.rejects(rehearsePlanningRelease(join(bundle, 'database.sqlite'), join(dir, 'bare-sqlite'), 'editor'), /complete document backup bundle/);
  assert(existsSync(join(dir, 'bare-sqlite', 'INCOMPLETE')));
  await assert.rejects(rehearsePlanningRelease(bundle, join(bundle, 'nested-output'), 'editor'), /outside the source/);
  assert(!existsSync(join(bundle, 'nested-output')));
  await assert.rejects(rehearsePlanningRelease(bundle, join(dir, 'viewer-denied'), 'viewer'), error => error.details?.code === 'PLANNING_ACCESS_DENIED');
  assert(existsSync(join(dir, 'viewer-denied', 'INCOMPLETE')));
  assert(!existsSync(join(dir, 'viewer-denied', 'report.json')));
  const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'))), assetFile = join(bundle, 'documents', 'assets', manifest.assets[0].storage_key);
  writeFileSync(assetFile, Buffer.alloc(PDF.length));
  await assert.rejects(rehearsePlanningRelease(bundle, join(dir, 'corrupt'), 'editor'), /hash\/type mismatch/);
  assert(existsSync(join(dir, 'corrupt', 'INCOMPLETE')));
  assert(!existsSync(join(dir, 'corrupt', 'candidate')));
  rmSync(assetFile);
  await assert.rejects(rehearsePlanningRelease(bundle, join(dir, 'missing'), 'editor'), /ENOENT/);
});

test('invalid legacy data leaves a failed rehearsal and a usable unchanged rollback snapshot', async t => {
  const dir = directory(t), f = await routeFixture(t, { upgrade: false, filename: join(dir, 'source.sqlite') });
  run(f.db, "INSERT INTO planning_items(id,trip_id,kind,title,created_by,updated_by,created_at,updated_at) VALUES('bad',?,'stay','Invalid','editor','editor',1,1)", TRIP);
  const before = fingerprint(databaseInventory(f.db.sqlite)), output = join(dir, 'failed');
  await assert.rejects(rehearsePlanningRelease(join(dir, 'source.sqlite'), output, 'editor'), error => error.details?.code === 'MIGRATION_INVALID_STAY');
  assert.equal(fingerprint(databaseInventory(f.db.sqlite)), before);
  assert(existsSync(join(output, 'INCOMPLETE'))); assert(!existsSync(join(output, 'report.json')));
  const rollback = open(t, join(output, 'rollback', 'database.sqlite'));
  assert.equal(fingerprint(databaseInventory(rollback.sqlite)), before);
});

test('mixed release versions keep model2 usable until opt-in, then reject stale structural writes without losing notes', async t => {
  const f = await routeFixture(t, { upgrade: false });
  assert.equal((await f.call('/api/planning?model=2')).data.model_version, 2);
  const created = await f.call('/api/planning/items', 'POST', { kind: 'visit', title: 'Legacy visit', date_start: '2035-01-04', note: 'Keep this' });
  assert.equal(created.status, 201);
  const item = created.data.item;
  assert.equal((await f.call('/api/planning?model=3')).status, 409);
  upgradePlanningModel(f.db, f.users.editor);
  const legacy = await f.call('/api/planning?model=2');
  assert.equal(legacy.status, 200); assert.equal(legacy.data.compatibility.structural_writes, false);
  assert.equal(legacy.data.items.find(i => i.id === item.id).note, 'Keep this');
  const snapshot = fingerprint(databaseInventory(f.db.sqlite));
  assert.equal((await f.call('/api/planning/items/' + item.id, 'PUT', { version: item.version, date_start: '2035-01-05' })).status, 409);
  assert.equal((await f.call('/api/planning/changesets', 'POST', { version: 3, commands: [{ key: 'new', type: 'create_item', data: { kind: 'visit', title: 'Denied' } }] }, 'viewer')).status, 403);
  assert.equal(fingerprint(databaseInventory(f.db.sqlite)), snapshot);
  const current = await f.call('/api/planning?model=3', 'GET', undefined, 'viewer');
  assert.equal(current.status, 200); assert.equal(current.data.capabilities.deadline_reminders, true);
  const metadata = await f.call('/api/planning/items/' + item.id, 'PUT', { version: item.version, note: 'Edited in a cached client' });
  assert.equal(metadata.status, 200);
  assert.equal(one(f.db, 'SELECT date_start FROM planning_items WHERE id=?', item.id).date_start, '2035-01-04');
});
