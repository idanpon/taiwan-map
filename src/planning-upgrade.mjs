import { createHash } from 'node:crypto';
import { transaction, all, one, run } from './sqlite.mjs';
import { TRIP } from './auth.mjs';
import { authorizePlanning, insertRow, problem } from './planning-domain-store.mjs';

const idFor = (kind, id) => 'route-' + createHash('sha256').update(kind + ':' + id).digest('hex').slice(0, 32);
// Explicit opt-in, never called by server startup or a legacy writer.
export function upgradePlanningModel(db, user, now = Date.now()) {
  return transaction(db, () => {
    authorizePlanning(db, user, true);
    const trip = one(db, 'SELECT * FROM trips WHERE id=?', TRIP);
    if (trip.planning_model === 3) return { model: 3, already_upgraded: true };
    const audit = { version: 1, created_at: now, updated_at: now, created_by: user.id, updated_by: user.id };
    const root = idFor('root', TRIP);
    insertRow(db, 'planning_scopes', { id: root, trip_id: TRIP, parent_scope_id: null, option_id: null, ...audit });
    const counts = { items: 0, placements: 0, links: 0, stays: 0, targets: 0 };
    function add(table, kind, sourceId, data, sourceTable = 'planning_items') {
      const id = idFor(kind, sourceId);
      insertRow(db, table, { id, trip_id: TRIP, ...data, ...audit });
      run(db, 'INSERT INTO planning_migration_refs VALUES(?,?,?,?,?,?)', TRIP, sourceTable, sourceId, kind, id, 'route-model-3-v1');
      return id;
    }
    for (const item of all(db, 'SELECT * FROM planning_items WHERE trip_id=? ORDER BY id', TRIP)) {
      counts.items++;
      run(db, 'UPDATE planning_items SET activation_scope_id=?,decision_mode=?,task_activation=? WHERE id=?', root, item.kind === 'decision' ? 'legacy_place' : null, item.kind === 'task' ? 'independent' : null, item.id);
      // A work interval is not an invented deadline, including equal date endpoints.
      const singleDate = !item.starts_at && !item.ends_at && Boolean(item.date_start) !== Boolean(item.date_end);
      const singleInstant = Boolean(item.starts_at) && !item.ends_at && !item.date_end;
      if (item.kind === 'task' && (singleDate || singleInstant)) {
        add('planning_deadlines', 'target', item.id, { task_id: item.id, service_id: null, kind: 'target', at: singleInstant ? item.starts_at : null, local_date: singleDate ? item.date_start || item.date_end : null, timezone: item.event_timezone, origin: 'manual', mode: 'manual' });
        counts.targets++;
      }
      if (!['visit', 'stay', 'transport'].includes(item.kind)) continue;
      const transport = item.transport_json ? JSON.parse(item.transport_json) : null;
      const links = all(db, 'SELECT * FROM planning_item_places WHERE item_id=? ORDER BY id', item.id);
      const completeTimes = item.starts_at && item.ends_at && Date.parse(item.starts_at) < Date.parse(item.ends_at);
      const precision = item.starts_at || item.ends_at ? completeTimes ? 'exact' : 'approximate' : item.date_start || item.date_end ? 'day' : 'unscheduled';
      const placement = add('planning_placements', 'placement', item.id, {
        item_id: item.id, scope_id: root, participation: 'included', commitment: 'tentative', precision,
        date_start: item.date_start, date_end: item.date_end, starts_at: item.starts_at, ends_at: item.ends_at,
        start_timezone: item.event_timezone, end_timezone: transport?.arrival_timezone || item.event_timezone,
        location_state: links.some(l => l.place_id) ? 'chosen' : 'unspecified', order_key: item.sort_order,
      });
      counts.placements++;
      for (const link of links) {
        add('planning_placement_places', 'placement-place', link.id, { placement_id: placement, place_id: link.place_id, role: link.role || 'visit', selection: 'chosen', label_snapshot: link.place_name }, 'planning_item_places');
        counts.links++;
      }
      if (item.fixed_external) {
        let kind, values;
        if (completeTimes) { kind = 'fixed_interval'; values = { start: item.starts_at, end: item.ends_at, start_timezone: item.event_timezone, end_timezone: transport?.arrival_timezone || item.event_timezone }; }
        else if (item.starts_at) { kind = 'fixed_start'; values = { at: item.starts_at, timezone: item.event_timezone }; }
        else if (item.date_start || item.date_end) { kind = 'date_range'; values = { date_start: item.date_start, date_end: item.date_end, timezone: item.event_timezone }; }
        if (kind) add('planning_time_constraints', 'constraint', item.id, { placement_id: placement, kind, values_json: JSON.stringify(values), reason: 'Ранее отмечено вручную', origin: 'legacy' });
      }
      if (item.kind !== 'stay') continue;
      if (!item.date_start || !item.date_end || item.date_start >= item.date_end)
        problem(422, 'MIGRATION_INVALID_STAY', 'Проверьте даты существующего проживания перед переходом.');
      const lodging = links.find(l => l.role === 'lodging');
      if (!lodging) problem(422, 'MIGRATION_INVALID_STAY', 'У существующего проживания отсутствует связь с жильём.');
      const booking = add('bookings', 'booking', item.id, { category: 'lodging', provider_name: '', source_urls: item.source_urls });
      const service = add('booking_services', 'service', item.id, { booking_id: booking, kind: 'stay', state: item.state === 'cancelled' ? 'cancelled' : 'confirmed', title: item.title, validity: 'date_range', date_start: item.date_start, date_end: item.date_end, start_timezone: item.event_timezone, end_timezone: item.event_timezone, origin: 'legacy_stay' });
      add('booking_service_places', 'service-place', item.id, { service_id: service, role: 'lodging', place_id: lodging.place_id, label_snapshot: lodging.place_name });
      const need = add('planning_needs', 'need', item.id, { scope_id: root, kind: 'accommodation', label: 'Проживание', criteria_json: JSON.stringify({ schema_version: 1, allowed_service_kinds: ['stay'], require_confirmed: true, require_selected_location: true }) });
      add('planning_need_targets', 'need-target', item.id, { need_id: need, placement_id: placement });
      add('planning_need_services', 'need-service', item.id, { need_id: need, service_id: service });
      counts.stays++;
    }
    if (db.sqlite.prepare('PRAGMA foreign_key_check').get()) problem(422, 'MIGRATION_FOREIGN_KEY', 'Нарушена целостность связей.');
    run(db, 'UPDATE trips SET planning_model=3 WHERE id=?', TRIP);
    // One migration event; no changes to prior history or reminder generations.
    run(db, 'INSERT INTO planning_events(id,trip_id,item_id,actor_id,action,payload,created_at) VALUES(?,?,NULL,?,?,?,?)', crypto.randomUUID(), TRIP, user.id, 'model3_upgrade', JSON.stringify(counts), now);
    return { model: 3, already_upgraded: false, counts };
  });
}
