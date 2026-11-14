import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, writeFileSync, readFileSync, chmodSync, statSync, realpathSync, rmSync } from 'node:fs';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.mjs';
import { databaseInventory, rehearsePlanningUpgrade } from './rehearse-planning-upgrade.mjs';
import { backupDocuments, restoreDocuments } from './document-backup.mjs';
import { createDocumentStorage, documentHash } from './document-storage.mjs';
import { fingerprint } from '../src/planning-domain-store.mjs';
import { readModel3 } from '../src/planning-command-service.mjs';

const readyAssets = sqlite => sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='document_assets'").get()
  ? sqlite.prepare("SELECT * FROM document_assets WHERE status='ready' ORDER BY id").all() : [];

// Restore deliberately expires interrupted uploads and clears operational leases.
// No other difference (including history, sessions and reminder generations) is allowed.
function recoveryFingerprint(sqlite) {
  return fingerprint(databaseInventory(sqlite).map(table => ({ ...table, rows:
    table.name === 'document_storage_leases' ? [] : table.rows.map(row =>
      table.name === 'document_uploads' && ['pending', 'receiving', 'uploaded'].includes(row.status)
        ? { ...row, status: 'expired', lease_until: null } : row).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })));
}

function bundleFingerprint(directory) {
  const manifestBytes = readFileSync(join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const assets = manifest.assets.map(asset => {
    if (!/^[a-f0-9-]{36}$/.test(asset.storage_key)) throw new Error('Invalid manifest storage key');
    return documentHash(readFileSync(join(directory, 'documents', 'assets', asset.storage_key)));
  });
  return fingerprint([documentHash(manifestBytes), documentHash(readFileSync(join(directory, 'database.sqlite'))), assets]);
}

// Operates only on supplied snapshots and new directories. Never switches a service,
// creates credentials, contacts providers or promotes the candidate to production.
export async function rehearsePlanningRelease(sourcePath, outputDirectory, actorId) {
  const source = realpathSync(sourcePath), isBundle = statSync(source).isDirectory();
  // Resolve the parent too: a symlink must not place outputs inside the source bundle.
  const directory = join(realpathSync(dirname(resolve(outputDirectory))), basename(resolve(outputDirectory)));
  if (directory === source || (isBundle && directory.startsWith(source + sep)))
    throw new Error('Release destination must be outside the source backup');
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(join(directory, 'INCOMPLETE'), 'Release rehearsal not verified\n', { mode: 0o600 });
  const rollback = join(directory, 'rollback'), candidate = join(directory, 'candidate');
  let sourceDB, db, recovered;
  try {
    let sourceHash;
    if (isBundle) {
      sourceHash = bundleFingerprint(source);
      // Restore rejects incomplete, corrupt and missing assets before producing a copy.
      restoreDocuments(source, rollback);
    } else {
      sourceDB = new DatabaseSync(source, { readOnly: true });
      if (readyAssets(sourceDB).length) throw new Error('SQLite contains ready document assets; provide a complete document backup bundle');
      sourceHash = fingerprint(databaseInventory(sourceDB));
      mkdirSync(rollback, { mode: 0o700 });
      await backup(sourceDB, join(rollback, 'database.sqlite'));
      chmodSync(join(rollback, 'database.sqlite'), 0o600);
      createDocumentStorage(join(rollback, 'documents'));
    }
    const migration = await rehearsePlanningUpgrade(join(rollback, 'database.sqlite'), candidate, actorId);
    db = openDatabase(join(candidate, 'upgraded.sqlite'));
    db.documentStore = createDocumentStorage(join(candidate, 'documents'));
    const originalStore = createDocumentStorage(join(rollback, 'documents'));
    for (const asset of readyAssets(db.sqlite)) {
      const checked = originalStore.inspect(asset, { includeBytes: true });
      if (checked.availability !== 'ready') throw new Error('Rehearsal asset unavailable');
      writeFileSync(db.documentStore.path('assets', asset.storage_key), checked.bytes, { mode: 0o600, flag: 'wx' });
    }
    const model = readModel3(db, { id: actorId });
    const required = ['changesets', 'requirements', 'bookings', 'route_options', 'documents', 'group_shift', 'route_completion', 'deadline_reminders'];
    if (!required.every(key => model.capabilities[key])) throw new Error('Candidate lacks required route UI capabilities');
    const beforeRecovery = recoveryFingerprint(db.sqlite);
    const recoveryBackup = await backupDocuments(db, db.documentStore, join(directory, 'candidate-backup'));
    const restore = restoreDocuments(join(directory, 'candidate-backup'), join(directory, 'recovered'));
    recovered = openDatabase(join(directory, 'recovered', 'database.sqlite'));
    const restoredDataPreserved = beforeRecovery === recoveryFingerprint(recovered.sqlite);
    const sourceUnchanged = sourceHash === (isBundle ? bundleFingerprint(source) : fingerprint(databaseInventory(sourceDB)));
    if (!restoredDataPreserved || !sourceUnchanged) throw new Error('Release rehearsal failed source/recovery preservation checks');
    const report = {
      schema_version: 1, verified: true, source_kind: isBundle ? 'document_bundle' : 'sqlite',
      source_fingerprint: sourceHash, source_unchanged: sourceUnchanged,
      migration, capabilities_verified: true, policy_version: model.policy_version,
      migrations: db.sqlite.prepare('SELECT name,hash FROM _app_migrations ORDER BY name').all(),
      recovery: { ...recoveryBackup, restored: restore.verified, data_preserved: restoredDataPreserved,
        interrupted_uploads_expire: true, operational_leases_cleared: true },
      production_changed: false,
    };
    // Close/checkpoint before calling this a completed, portable output.
    recovered.close(); recovered = null; db.close(); db = null;
    writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    rmSync(join(directory, 'INCOMPLETE'));
    return report;
  } finally { recovered?.close(); db?.close(); sourceDB?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output, actor, ...extra] = process.argv.slice(2);
  if (!source || !output || !actor || extra.length) throw new Error('Usage: node server/rehearse-planning-release.mjs SOURCE.sqlite_OR_BUNDLE NEW_OUTPUT_DIRECTORY ACTOR_ID');
  console.log(JSON.stringify(await rehearsePlanningRelease(source, output, actor), null, 2));
}
