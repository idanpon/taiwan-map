import { TRIP, fail } from './auth.mjs';
import { one } from './sqlite.mjs';
import {
  addDays,
  validDate,
  validZone,
  dayInZone,
  kindLabels,
  priorityLabels,
} from '../public/planning-model.js';

import { civil, civilDayStart, namedZone } from '../public/trip-timezones.js';
import { isTravel, transportModes, travelPlace } from '../public/planning-travel.js';

function text(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    fail(400, `Проверьте поле «${name}» (до ${max} символов).`);
  return required ? value.trim() : value;
}
function travelDates(out, b) {
  const departureZone = out.event_timezone;
  const arrivalZone = out.transport?.arrival_timezone ?? departureZone;
  if (!namedZone(departureZone) || !namedZone(arrivalZone))
    fail(400, 'Для проживания и транспорта укажите часовые пояса IANA.');
  for (const [date, instant, zone] of [
    ['date_start', 'starts_at', departureZone],
    ['date_end', 'ends_at', arrivalZone],
  ]) {
    if (out[instant]) {
      const local = civil(out[instant], zone).day;
      if (b[date] && b[date] !== local)
        fail(400, 'Дата не соответствует точному времени в выбранном поясе.');
      out[date] = local;
    }
    if (!out[date]) fail(400, 'Укажите обе локальные даты.');
  }
  if (out.kind === 'stay') {
    if (out.date_end <= out.date_start)
      fail(400, 'Дата выезда должна быть позже даты заселения.');
    return;
  }
  const departureStart = out.starts_at ? Date.parse(out.starts_at) :
    civilDayStart(out.date_start, departureZone);
  const arrivalEnd = out.ends_at ? Date.parse(out.ends_at) :
    civilDayStart(addDays(out.date_end, 1), arrivalZone) - 1;
  if (civil(departureStart, departureZone).day !== out.date_start ||
      civil(arrivalEnd, arrivalZone).day !== out.date_end || departureStart > arrivalEnd)
    fail(400, 'Прибытие должно быть не раньше отправления. Проверьте даты, время и пояса.');
}

function transportDetails(value) {
  if (!value || typeof value.mode !== 'string' || !Object.hasOwn(transportModes, value.mode) || !namedZone(value.arrival_timezone))
    fail(400, 'Укажите вид транспорта и часовой пояс прибытия.');
  const stops = value.stops ?? [];
  if (!Array.isArray(stops) || stops.length > 30)
    fail(400, 'Укажите не более 30 промежуточных остановок.');
  return {
    mode: value.mode,
    arrival_timezone: value.arrival_timezone,
    service_number: text(value.service_number ?? '', 'Номер рейса или маршрута', 100).trim(),
    departure_details: text(value.departure_details ?? '', 'Сведения об отправлении', 300).trim(),
    arrival_details: text(value.arrival_details ?? '', 'Сведения о прибытии', 300).trim(),
    stops: stops.map(stop => text(stop, 'Остановка', 200, true)),
  };
}

export function normalizePlanningItem(db, b, current = {}) {
  const value = { ...current, ...b };
  delete value.ack_dependencies;
  const kind = value.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(kindLabels, kind)) fail(400, 'Неизвестный тип записи.');
  const out = {
    kind,
    title: value.title,
    description: text(value.description ?? '', 'Описание', 10000),
    note: text(value.note ?? '', 'Заметка', 5000),
    state: value.state ?? 'open',
    priority: value.priority ?? 'normal',
    assignee_id: value.assignee_id || null,
    date_start: value.date_start || null,
    date_end: value.date_end || null,
    starts_at: value.starts_at || null,
    ends_at: value.ends_at || null,
    event_timezone: value.event_timezone || (kind === 'transport' ? '' : 'Asia/Taipei'),
    transport: kind === 'transport' ? transportDetails(value.transport) : null,
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
  if (isTravel(kind)) travelDates(out, b);
  else {
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
  }
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
  const roles = new Set();
  out.places = out.places.map((l) => {
    if (!l || typeof l !== 'object' || Array.isArray(l)) fail(400, 'Некорректная связь.');
    if (
      (l.place_id && typeof l.place_id !== 'string') ||
      (l.place_name != null && typeof l.place_name !== 'string') ||
      (l.affects_visit !== undefined && typeof l.affects_visit !== 'boolean')
    )
      fail(400, 'Некорректная связь с местом.');
    const p = l.place_id
      ? one(db, 'SELECT id,name FROM places WHERE id=? AND trip_id=?', l.place_id, TRIP)
      : null;
    if (l.place_id && !p) fail(400, 'Связанное место удалено. Обновите данные.');
    const role = l.role ?? null;
    const endpoint = role === 'departure' || role === 'arrival';
    if (role !== null) {
      if (roles.has(role) || !(kind === 'stay' && role === 'lodging' || kind === 'transport' && endpoint))
        fail(400, 'Некорректная или повторяющаяся роль места.');
      roles.add(role);
    }
    if (l.option_id && !ids.has(l.option_id)) fail(400, 'Связь с неизвестным вариантом.');
    if (l.affects_visit && out.kind !== 'decision')
      fail(400, 'Условие посещения относится к решению.');
    if (l.affects_visit && !l.option_id)
      fail(400, 'Для условия посещения укажите вариант решения.');
    if (!['keep', 'hide'].includes(l.unselected_action || 'keep'))
      fail(400, 'Альтернативы можно только скрыть или оставить.');
    return {
      place_id: p?.id ?? null,
      place_name: endpoint
        ? text(l.place_name?.trim() || p?.name, 'Пункт маршрута', 200, true)
        : p?.name || text(l.place_name || 'Место удалено', 'Подпись места', 200, true),
      role,
      option_id: l.option_id || null,
      affects_visit: Boolean(l.affects_visit),
      unselected_action: l.unselected_action || 'keep',
    };
  });
  if (kind === 'stay') {
    const lodging = travelPlace(out, 'lodging');
    const previous = current.kind === 'stay' && travelPlace(current, 'lodging');
    if (!lodging || (!lodging.place_id && (previous?.place_id !== null || previous.place_name !== lodging.place_name)))
      fail(400, 'Выберите существующее место проживания.');
    out.title ??= lodging.place_name.slice(0, 160);
  }
  if (kind === 'transport') {
    const departure = travelPlace(out, 'departure'), arrival = travelPlace(out, 'arrival');
    if (!departure || !arrival) fail(400, 'Укажите пункты отправления и прибытия.');
    out.title ??= (departure.place_name + ' → ' + arrival.place_name).slice(0, 160);
  }
  out.title = text(out.title, 'Название', 160, true);
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
  'transport_json',
];
export const values = (v) =>
  fields.map((key) =>
    key === 'source_urls'
      ? JSON.stringify(v[key])
      : key === 'fixed_external'
        ? Number(v[key])
        : key === 'transport_json' && v.transport ? JSON.stringify(v.transport) : v[key] ?? null,
  );
