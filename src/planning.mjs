import { planningData, itemById, readItem, currentPlace } from './planning-store.mjs';
import { normalizePlanningItem as normalize, fields, values } from './planning-validation.mjs';
import { computePreview } from './planning-decisions.mjs';
export { planningData, guardPlanningStatus, unresolvedForPlace } from './planning-store.mjs';
import { TRIP, SHARED_USER, body, fail, json, Problem } from './auth.mjs';
import { validDate } from '../public/planning-model.js';
import { isTravel } from '../public/planning-travel.js';
import { all, one, run, transaction } from './sqlite.mjs';
import { refreshItemReminders, readZonePlan } from './reminders.mjs';
import { handlePlanningDomain } from './planning-domain-http.mjs';
import { planningModel, problem } from './planning-domain-store.mjs';
import { applyMetadataCommands } from './planning-command-service.mjs';
const editable = (u) => ['owner', 'admin', 'editor'].includes(u.role);
const conflict = (message, details = {}) => {
  const error = new Problem(409, message);
  error.details = details;
  throw error;
};
const event = (db, user, item, action, payload) =>
  run(
    db,
    'INSERT INTO planning_events(id,trip_id,item_id,actor_id,action,payload,created_at) VALUES(?,?,?,?,?,?,?)',
    crypto.randomUUID(),
    TRIP,
    item,
    user.id,
    action,
    JSON.stringify(payload),
    Date.now(),
  );
function writeRelations(db, id, value) {
  run(db, 'DELETE FROM planning_item_places WHERE item_id=?', id);
  run(db, 'DELETE FROM planning_options WHERE item_id=?', id);
  run(db, 'DELETE FROM planning_dependencies WHERE item_id=?', id);
  for (const o of value.options)
    run(
      db,
      'INSERT INTO planning_options(id,item_id,label,description,sort_order) VALUES(?,?,?,?,?)',
      o.id,
      id,
      o.label,
      o.description,
      o.sort_order,
    );
  for (const l of value.places)
    run(
      db,
      'INSERT INTO planning_item_places(id,item_id,option_id,place_id,place_name,affects_visit,unselected_action,role) VALUES(?,?,?,?,?,?,?,?)',
      crypto.randomUUID(),
      id,
      l.option_id,
      l.place_id,
      l.place_name,
      Number(l.affects_visit),
      l.unselected_action,
      l.role,
    );
  for (const dep of value.dependencies)
    run(db, 'INSERT INTO planning_dependencies VALUES(?,?)', id, dep);
}
function setPlaceStatus(db, user, placeId, statusId) {
  const p = currentPlace(db, placeId);
  if (!p || p.status_id === statusId) return;
  run(
    db,
    `INSERT INTO user_place_states(user_id,place_id,status_id,note,version,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,place_id) DO UPDATE SET status_id=excluded.status_id,version=excluded.version,updated_at=excluded.updated_at`,
    SHARED_USER,
    p.id,
    statusId,
    p.note || '',
    p.state_version + 1,
    Date.now(),
  );
  run(
    db,
    'INSERT INTO state_events VALUES(?,?,?,?,?,?,?)',
    crypto.randomUUID(),
    user.id,
    p.id,
    statusId,
    p.note || '',
    p.state_version + 1,
    Date.now(),
  );
}
export async function handlePlanning(request, db, user, { creationId = null } = {}) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (!path.startsWith('/api/planning') && !path.startsWith('/api/bookings') && path!=='/api/preparation') return null;
  if (path === '/api/planning' && method === 'GET' && url.searchParams.has('model') && !['1','2','3'].includes(url.searchParams.get('model')))
    fail(400, 'Неизвестная версия модели планирования.');
  const domainResponse = await handlePlanningDomain(request, db, user);
  if (domainResponse) return domainResponse;
  if (path === '/api/planning' && method === 'GET')
    return json(planningData(db, { legacy: url.searchParams.get('model') !== '2' }));
  const history = path.match(/^\/api\/planning\/items\/([a-zA-Z0-9_-]+)\/events$/);
  if (history && method === 'GET') {
    itemById(db, history[1]);
    return json({
      events: all(
        db,
        'SELECT e.id,e.action,e.payload,e.created_at,u.display_name actor FROM planning_events e JOIN users u ON u.id=e.actor_id WHERE e.item_id=? OR EXISTS(SELECT 1 FROM planning_event_refs r WHERE r.event_id=e.id AND r.item_id=?) ORDER BY e.created_at DESC,e.rowid DESC LIMIT 100',
        history[1],
        history[1],
      ).map((e) => ({ ...e, payload: JSON.parse(e.payload) })),
    });
  }
  if (!editable(user)) fail(403, 'Доступ только для просмотра.');
  const b = await body(request, 65536);
  return applyPlanningChange(db, user, { path, method, body: b, creationId });
}
// The HTTP adapter and reviewed CLI imports use the same synchronous write
// service. Keep body parsing/network work outside the transaction.
export function applyPlanningChange(db, user, { path, method, body: b, creationId = null }) {
  if (!editable(user)) fail(403, 'Доступ только для просмотра.');
  return transaction(db, () => {
    if (planningModel(db) === 3) {
      const target = path.match(/^\/api\/planning\/items\/([a-zA-Z0-9_-]+)$/);
      const safe = ['version', 'title', 'description', 'note', 'priority', 'assignee_id', 'idempotency_key'];
      if (method !== 'PUT' || !target || Object.keys(b).some(key => !safe.includes(key)))
        problem(409, 'MODEL3_REQUIRED', 'Изменение дат, состояния или связей требует нового протокола планирования.');
      const { version, idempotency_key, ...data } = b;
      applyMetadataCommands(db, user, { version: 3, idempotency_key: idempotency_key || crypto.randomUUID(),
        commands: [{ key: 'metadata', type: 'edit_item', id: target[1], expected_version: version, data }] });
      return json({ item: readItem(db, itemById(db, target[1])) });
    }
    if (path === '/api/planning/trip' && method === 'PUT') {
      if (!Number.isSafeInteger(b.version)) fail(400, 'Укажите версию поездки.');
      for (const k of ['departure_date', 'start_date', 'end_date'])
        if (!validDate(b[k])) fail(400, 'Проверьте даты поездки.');
      if (b.departure_date > b.start_date || b.start_date > b.end_date)
        fail(400, 'Проверьте порядок дат поездки.');
      const r = run(
        db,
        'UPDATE trips SET departure_date=?,start_date=?,end_date=?,planning_version=planning_version+1 WHERE id=? AND planning_version=?',
        b.departure_date,
        b.start_date,
        b.end_date,
        TRIP,
        b.version,
      );
      if (!r.changes) conflict('Даты поездки изменены другим участником.');
      event(db, user, null, 'trip', b);
      return json({ ok: true, version: b.version + 1 });
    }
    const action = path.match(/^\/api\/planning\/items\/([a-zA-Z0-9_-]+)\/(preview|resolve)$/);
    if (action && method === 'POST') {
      const preview = computePreview(db, action[1], b);
      if (action[2] === 'preview') return json(preview);
      if (b.version !== preview.version || b.fingerprint !== preview.fingerprint)
        conflict('Данные изменились. Обновите предварительный просмотр.');
      for (const e of preview.effects) {
        if (e.before.status_id !== e.after.status_id) {
          if (
            e.after.status_id &&
            !one(
              db,
              'SELECT 1 FROM statuses WHERE id=? AND trip_id=? AND archived=0',
              e.after.status_id,
              TRIP,
            )
          )
            conflict('Статус больше недоступен. Обновите предварительный просмотр.');
          run(
            db,
            `INSERT INTO user_place_states(user_id,place_id,status_id,note,version,updated_at) VALUES(?,?,?,COALESCE((SELECT note FROM user_place_states WHERE user_id=? AND place_id=?),''),?,?) ON CONFLICT(user_id,place_id) DO UPDATE SET status_id=excluded.status_id,version=excluded.version,updated_at=excluded.updated_at`,
            SHARED_USER,
            e.id,
            e.after.status_id,
            SHARED_USER,
            e.id,
            e.after.state_version,
            Date.now(),
          );
          run(
            db,
            'INSERT INTO state_events VALUES(?,?,?,?,?,?,?)',
            crypto.randomUUID(),
            user.id,
            e.id,
            e.after.status_id,
            one(
              db,
              'SELECT note FROM user_place_states WHERE user_id=? AND place_id=?',
              SHARED_USER,
              e.id,
            ).note,
            e.after.state_version,
            Date.now(),
          );
        }
        if (e.before.hidden !== e.after.hidden)
          run(
            db,
            'UPDATE places SET hidden=?,visibility_version=?,updated_at=? WHERE id=?',
            e.after.hidden,
            e.after.visibility_version,
            Date.now(),
            e.id,
          );
      }
      const reopen = preview.mode === 'reopen',
        old = itemById(db, preview.item_id);
      run(
        db,
        'UPDATE planning_items SET state=?,selected_option_id=?,version=version+1,updated_by=?,updated_at=?,completed_at=? WHERE id=?',
        reopen ? 'open' : 'done',
        reopen ? null : preview.option_id,
        user.id,
        Date.now(),
        reopen ? null : Date.now(),
        preview.item_id,
      );
      const updated = itemById(db, preview.item_id);
      refreshItemReminders(db, old, updated);
      event(db, user, preview.item_id, reopen ? 'reopen' : 'resolve', preview);
      return json({ item: readItem(db, updated), preview });
    }
    const match = path.match(/^\/api\/planning\/items\/([a-zA-Z0-9_-]+)$/),
      creating = path === '/api/planning/items' && method === 'POST';
    if (!creating && !(match && ['PUT', 'DELETE'].includes(method)))
      fail(404, 'Маршрут планировщика не найден.');
    const old = creating ? null : readItem(db, itemById(db, match[1]));
    if (old && b.version !== old.version)
      conflict('Запись изменена другим участником. Обновите данные; черновик можно скопировать.');
    if (method === 'DELETE') {
      if (old.kind === 'decision' && old.state === 'done')
        conflict('Сначала пересмотрите решение, чтобы проверить последствия.');
      if (isTravel(old.kind)) {
        const dependants = all(db, 'SELECT item_id FROM planning_dependencies WHERE depends_on_id=?', old.id);
        for (const { item_id } of dependants) {
          run(db, 'UPDATE planning_items SET version=version+1,updated_by=?,updated_at=? WHERE id=?',
            user.id, Date.now(), item_id);
          event(db, user, item_id, 'dependency_deleted', { dependency: old.id });
        }
      }
      event(db, user, old.id, 'delete', { before: old });
      run(db, 'DELETE FROM planning_items WHERE id=?', old.id);
      return json({ ok: true });
    }
    // New date editors opt into a plan revision check; older clients stay compatible.
    if (Object.hasOwn(b, 'timezone_revision') && b.timezone_revision !== readZonePlan(db).revision)
      conflict('План часовых поясов изменился. Обновите данные и проверьте дату ещё раз.', { code: 'timezone_changed' });
    if (
      creating &&
      one(db, 'SELECT COUNT(*) n FROM planning_items WHERE trip_id=?', TRIP).n >= 1000
    )
      fail(400, 'Достигнут лимит 1000 записей.');
    const value = normalize(db, b, old || {}),
      id = old?.id || creationId || crypto.randomUUID(),
      now = Date.now();
    if (old?.kind === 'decision' && old.state === 'done') {
      const previous = normalize(db, {}, old);
      if (
        value.kind !== old.kind ||
        value.state !== old.state ||
        ['options', 'places', 'dependencies'].some(
          (key) => JSON.stringify(value[key]) !== JSON.stringify(previous[key]),
        )
      )
        conflict('Для изменения вариантов сначала откройте решение повторно.');
    }
    if (value.kind === 'decision' && value.state === 'done' && old?.state !== 'done')
      fail(400, 'Решение завершается выбором варианта с предварительным просмотром.');
    const blockers = value.dependencies
      .map((dep) => itemById(db, dep))
      .filter((i) => !['done', 'cancelled'].includes(i.state));
    if (value.state === 'done' && old?.state !== 'done' && blockers.length && !b.ack_dependencies)
      conflict('Есть незавершённые зависимости. Всё равно отметить выполнение?', {
        code: 'dependencies_open',
        dependencies: blockers.map((i) => ({ id: i.id, title: i.title })),
      });
    if (old)
      run(
        db,
        `UPDATE planning_items SET ${fields.map((k) => k + '=?').join(',')},version=version+1,updated_by=?,updated_at=?,completed_at=? WHERE id=?`,
        ...values(value),
        user.id,
        now,
        value.state === 'done' ? old.completed_at || now : null,
        id,
      );
    else
      run(
        db,
        `INSERT INTO planning_items(id,trip_id,${fields.join(',')},created_by,updated_by,created_at,updated_at,completed_at) VALUES(${Array(
          2 + fields.length + 5,
        )
          .fill('?')
          .join(',')})`,
        id,
        TRIP,
        ...values(value),
        user.id,
        user.id,
        now,
        now,
        value.state === 'done' ? now : null,
      );
    if (!old || ['options', 'places', 'dependencies'].some(key => Object.hasOwn(b, key)))
      writeRelations(db, id, value);
    if (value.kind === 'decision' && ['open', 'in_progress'].includes(value.state)) {
      const existing = new Set(
        old && old.kind === 'decision' && ['open', 'in_progress'].includes(old.state)
          ? old.places.filter((l) => l.affects_visit).map((l) => l.place_id)
          : [],
      );
      for (const placeId of new Set(
        value.places
          .filter((l) => l.affects_visit && l.place_id && !existing.has(l.place_id))
          .map((l) => l.place_id),
      )) {
        const p = currentPlace(db, placeId);
        if (p && (!p.status_id || p.status_id === 'want')) {
          if (
            !one(db, "SELECT 1 FROM statuses WHERE id='maybe' AND trip_id=? AND archived=0", TRIP)
          )
            conflict(
              'Статус вопроса недоступен. Восстановите его перед добавлением условия посещения.',
            );
          setPlaceStatus(db, user, placeId, 'maybe');
        }
      }
    }
    const updated = readItem(db, itemById(db, id));
    if (old) refreshItemReminders(db, old, updated, now);
    event(db, user, id, old ? 'update' : 'create', { before: old, after: updated });
    return json({ item: updated }, creating ? 201 : 200);
  });
}
