import { createHash } from 'node:crypto';
import { all, one, run } from './sqlite.mjs';
import { TRIP, Problem } from './auth.mjs';
import { sharedAssetMetadata } from './document-assets.mjs';

export const sourceTables = {
  documents:'documents', booking_documents:'booking_documents',
  items: 'planning_items', scopes: 'planning_scopes', placements: 'planning_placements',
  placement_places: 'planning_placement_places', constraints: 'planning_time_constraints',
  bookings: 'bookings', services: 'booking_services', service_places: 'booking_service_places',
  needs: 'planning_needs', need_targets: 'planning_need_targets', need_services: 'planning_need_services',
  deadlines: 'planning_deadlines', deadline_rules: 'planning_deadline_rules',
  need_tasks: 'planning_need_tasks', need_task_results: 'planning_need_task_results',
  service_tasks: 'planning_service_tasks', task_prerequisites: 'planning_task_prerequisites',
  need_exemptions: 'planning_need_exemptions',
  time_links: 'planning_time_links', transition_overrides: 'planning_transition_overrides', reschedule_requests: 'planning_reschedule_requests',
  decisions:'planning_decisions', options:'planning_options', option_constraints:'planning_option_constraints', decision_gaps:'planning_decision_gaps',
  need_decision_results:'planning_need_decision_results', decision_prerequisites:'planning_task_decision_prerequisites',
};
export function problem(status, code, message) {
  const error = new Problem(status, message); error.details = { code }; throw error;
}
export function authorizePlanning(db, user, write = false) {
  const current = user?.id && one(db, 'SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.trip_id=? AND m.user_id=? AND u.disabled=0', TRIP, user.id);
  if (!current || (write && !['owner', 'admin', 'editor'].includes(current.role)))
    problem(403, 'PLANNING_ACCESS_DENIED', 'Нет доступа к этому действию.');
}
export const planningModel = db => one(db, 'SELECT planning_model FROM trips WHERE id=?', TRIP)?.planning_model;
export function requireModel3(db) {
  if (planningModel(db) !== 3) problem(409, 'MODEL3_NOT_ENABLED', 'Новая модель поездки ещё не включена.');
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex');
export function readSources(db) {
  const sources = Object.fromEntries(Object.entries(sourceTables).filter(([key])=>key!=='options').map(([key, table]) => [key, all(db, 'SELECT * FROM ' + table + ' WHERE trip_id=? ORDER BY id', TRIP)]));
  sources.options = all(db, 'SELECT o.* FROM planning_options o JOIN planning_items i ON i.id=o.item_id WHERE i.trip_id=? ORDER BY o.id', TRIP);
  sources.document_assets=sharedAssetMetadata(db);
  sources.legacy_places = all(db, 'SELECT p.* FROM planning_item_places p JOIN planning_items i ON i.id=p.item_id WHERE i.trip_id=? ORDER BY p.id', TRIP);
  sources.legacy_dependencies = all(db, 'SELECT d.* FROM planning_dependencies d JOIN planning_items i ON i.id=d.item_id WHERE i.trip_id=? ORDER BY d.item_id,d.depends_on_id', TRIP);
  sources.places = all(db, 'SELECT id,trip_id,name,lat,lon,coordinate_accuracy,coordinate_source_url,catalog_version,hidden,visibility_version FROM places WHERE trip_id=? ORDER BY id', TRIP);
  sources.users = all(db, 'SELECT u.id,u.display_name,m.role,u.disabled FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.trip_id=? ORDER BY u.id', TRIP);
  sources.timezone_changes = all(db, 'SELECT * FROM trip_timezone_changes WHERE trip_id=? ORDER BY at', TRIP);
  return { trip: one(db, 'SELECT id,timezone,departure_date,start_date,end_date,planning_model,planning_revision,planning_version,timezone_revision FROM trips WHERE id=?', TRIP), sources };
}
export function insertRow(db, table, row) {
  const keys = Object.keys(row);
  run(db, 'INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')', ...keys.map(k => row[k]));
}
export function updateRow(db, table, row) {
  const keys = Object.keys(row).filter(k => k !== 'id');
  run(db, 'UPDATE ' + table + ' SET ' + keys.map(k => k + '=?').join(',') + ' WHERE id=?', ...keys.map(k => row[k]), row.id);
}
