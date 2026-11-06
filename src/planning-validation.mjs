import { TRIP, fail } from './auth.mjs';
import { one } from './sqlite.mjs';
import {
  validDate,
  validZone,
  dayInZone,
  kindLabels,
  priorityLabels,
} from '../public/planning-model.js';

function text(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    fail(400, `Проверьте поле «${name}» (до ${max} символов).`);
  return required ? value.trim() : value;
}
export function normalizePlanningItem(db, b, current = {}) {
  const value = { ...current, ...b };
  delete value.ack_dependencies;
  const kind = value.kind;
  if (!Object.hasOwn(kindLabels, kind)) fail(400, 'Неизвестный тип записи.');
  const out = {
    kind,
    title: text(value.title, 'Название', 160, true),
    description: text(value.description ?? '', 'Описание', 10000),
    note: text(value.note ?? '', 'Заметка', 5000),
    state: value.state ?? 'open',
    priority: value.priority ?? 'normal',
    assignee_id: value.assignee_id || null,
    date_start: value.date_start || null,
    date_end: value.date_end || null,
    starts_at: value.starts_at || null,
    ends_at: value.ends_at || null,
    event_timezone: value.event_timezone || 'Asia/Taipei',
    sort_order: value.sort_order ?? 0,
    fixed_external: value.fixed_external ?? false,
    source_urls: value.source_urls ?? [],
  };
  if (
    !['open', 'in_progress', 'done', 'cancelled'].includes(out.state) ||
    !Object.hasOwn(priorityLabels, out.priority) ||
    !Number.isSafeInteger(out.sort_order) ||
    Math.abs(out.sort_order) > 1000000 ||
    typeof out.fixed_external !== 'boolean'
  )
    fail(400, 'Проверьте состояние, приоритет и порядок.');
  if (!validZone(out.event_timezone)) fail(400, 'Некорректный часовой пояс.');
  for (const key of ['date_start', 'date_end'])
    if (out[key] && !validDate(out[key])) fail(400, 'Некорректная календарная дата.');
  for (const key of ['starts_at', 'ends_at'])
    if (out[key]) {
      if (
        typeof out[key] !== 'string' ||
        !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{3})?)?Z$/.test(out[key]) ||
        !validDate(out[key].slice(0, 10)) ||
        !Number.isFinite(Date.parse(out[key]))
      )
        fail(400, 'Точное время передаётся в UTC.');
      out[key] = new Date(out[key]).toISOString();
    }
  if (out.ends_at && !out.starts_at)
    fail(400, 'Укажите точное время начала или используйте однодневный дедлайн.');
  if (out.starts_at && out.date_end && !out.ends_at)
    fail(400, 'Для периода с точным временем укажите начало и окончание.');
  if (out.starts_at) out.date_start = dayInZone(out.starts_at, out.event_timezone);
  if (out.ends_at) out.date_end = dayInZone(out.ends_at, out.event_timezone);
  if (
    (out.date_start && out.date_end && out.date_start > out.date_end) ||
    (out.starts_at && out.ends_at && out.starts_at > out.ends_at)
  )
    fail(400, 'Окончание должно быть не раньше начала.');
  if (out.kind === 'visit' && !out.date_start && !out.date_end)
    fail(400, 'Для пункта маршрута укажите дату.');
  if (out.assignee_id && typeof out.assignee_id !== 'string')
    fail(400, 'Некорректный ответственный.');
  if (
    out.assignee_id &&
    out.assignee_id !== current.assignee_id &&
    !one(
      db,
      'SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.trip_id=? AND u.disabled=0',
      out.assignee_id,
      TRIP,
    )
  )
    fail(400, 'Ответственный не найден.');
  if (
    !Array.isArray(out.source_urls) ||
    out.source_urls.length > 20 ||
    out.source_urls.some((url) => {
      try {
        const u = new URL(url);
        return (
          !['https:', 'http:'].includes(u.protocol) ||
          Boolean(u.username || u.password) ||
          url.length > 2000
        );
      } catch {
        return true;
      }
    })
  )
    fail(400, 'Укажите корректные HTTP/HTTPS-источники.');
  out.options = value.options ?? [];
  out.places = value.places ?? [];
  out.dependencies = value.dependencies ?? [];
  if (
    !Array.isArray(out.options) ||
    out.options.length > 20 ||
    !Array.isArray(out.places) ||
    out.places.length > 200 ||
    !Array.isArray(out.dependencies) ||
    out.dependencies.length > 100
  )
    fail(400, 'Слишком много связей или вариантов.');
  if (out.kind !== 'decision' && out.options.length)
    fail(400, 'Варианты доступны только решениям.');
  const ids = new Set();
  out.options = out.options.map((o, i) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) fail(400, 'Некорректный вариант.');
    const id = o.id || crypto.randomUUID();
    if (
      typeof id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(id) ||
      ids.has(id) ||
      one(db, 'SELECT 1 FROM planning_options WHERE id=? AND item_id<>?', id, current.id || '')
    )
      fail(400, 'Некорректный ID варианта.');
    ids.add(id);
    return {
      id,
      label: text(o.label, 'Вариант', 160, true),
      description: text(o.description ?? '', 'Описание варианта', 5000),
      sort_order: i,
    };
  });
  out.places = out.places.map((l) => {
    if (!l || typeof l !== 'object' || Array.isArray(l)) fail(400, 'Некорректная связь.');
    if (
      (l.place_id && typeof l.place_id !== 'string') ||
      (l.affects_visit !== undefined && typeof l.affects_visit !== 'boolean')
    )
      fail(400, 'Некорректная связь с местом.');
    const p = l.place_id
      ? one(db, 'SELECT id,name FROM places WHERE id=? AND trip_id=?', l.place_id, TRIP)
      : null;
    if (l.place_id && !p) fail(400, 'Связанное место удалено. Обновите данные.');
    if (l.option_id && !ids.has(l.option_id)) fail(400, 'Связь с неизвестным вариантом.');
    if (l.affects_visit && out.kind !== 'decision')
      fail(400, 'Условие посещения относится к решению.');
    if (l.affects_visit && !l.option_id)
      fail(400, 'Для условия посещения укажите вариант решения.');
    if (!['keep', 'hide'].includes(l.unselected_action || 'keep'))
      fail(400, 'Альтернативы можно только скрыть или оставить.');
    return {
      place_id: p?.id ?? null,
      place_name: p?.name || text(l.place_name || 'Место удалено', 'Подпись места', 200, true),
      option_id: l.option_id || null,
      affects_visit: Boolean(l.affects_visit),
      unselected_action: l.unselected_action || 'keep',
    };
  });
  out.dependencies = [...new Set(out.dependencies)];
  for (const id of out.dependencies)
    if (
      id === current.id ||
      typeof id !== 'string' ||
      !one(db, 'SELECT 1 FROM planning_items WHERE id=? AND trip_id=?', id, TRIP)
    )
      fail(400, 'Некорректная зависимость.');
  if (current.id)
    for (const id of out.dependencies) {
      const cycle = one(
        db,
        `WITH RECURSIVE chain(id) AS (SELECT ? UNION SELECT d.depends_on_id FROM planning_dependencies d JOIN chain c ON c.id=d.item_id) SELECT 1 FROM chain WHERE id=? LIMIT 1`,
        id,
        current.id,
      );
      if (cycle) fail(400, 'Зависимости не должны образовывать цикл.');
    }
  return out;
}
export const fields = [
  'kind',
  'title',
  'description',
  'note',
  'state',
  'priority',
  'assignee_id',
  'date_start',
  'date_end',
  'starts_at',
  'ends_at',
  'event_timezone',
  'sort_order',
  'fixed_external',
  'source_urls',
];
export const values = (v) =>
  fields.map((key) =>
    key === 'source_urls'
      ? JSON.stringify(v[key])
      : key === 'fixed_external'
        ? Number(v[key])
        : v[key],
  );
