import { TRIP, stmt, body, fail, json } from './auth.mjs';
import { readTags, mergeTags } from '../public/place-tags.js';
import { guardPlanningStatus } from './planning.mjs';

export async function handlePlaceState(request, db, user, stateUser) {
  const path = new URL(request.url).pathname;
  const match = path.match(/^\/api\/places\/([a-zA-Z0-9-]+)\/state$/);
  if (match && request.method === 'PUT') {
    if (!['owner', 'admin', 'editor'].includes(user.role))
      fail(403, 'Доступ только для просмотра.');
    const place = await stmt(
      db,
      'SELECT * FROM places WHERE id=? AND trip_id=? AND hidden=0',
      match[1],
      TRIP,
    ).first();
    if (!place) fail(404, 'Место не найдено.');
    // One bounded request can contain both a 2000-character note and schedule.
    const b = await body(request, 32768);
    if (
      !Number.isSafeInteger(b.version) ||
      b.version < 0 ||
      typeof b.note !== 'string' ||
      b.note.length > 2000
    )
      fail(400, 'Некорректная версия или заметка (до 2000 символов).');
    if (
      b.status_id !== null &&
      (typeof b.status_id !== 'string' ||
        !(await stmt(
          db,
          'SELECT id FROM statuses WHERE id=? AND trip_id=? AND archived=0',
          b.status_id,
          TRIP,
        ).first()))
    )
      fail(400, 'Неизвестный статус.');
    const hasTags = Object.hasOwn(b, 'tags');
    let tags;
    if (hasTags) {
      if (!Number.isSafeInteger(b.tags_version) || b.tags_version < 1)
        fail(400, 'Некорректная версия ярлыков.');
      if (b.tags_version !== place.tags_version)
        fail(409, 'Ярлыки изменены. Обновите данные и повторите.');
      try {
        tags = mergeTags(readTags(place.tags_json), b.tags);
      } catch (error) {
        fail(400, error.message);
      }
    }
    guardPlanningStatus(db, place.id, b.status_id, stateUser);
    const now = Date.now(),
      next = b.version + 1,
      eventId = crypto.randomUUID();
    const statements = [
      b.version === 0
        ? stmt(
            db,
            'INSERT OR IGNORE INTO user_place_states(user_id,place_id,status_id,note,version,updated_at) SELECT ?,?,?,?,1,? WHERE EXISTS (SELECT 1 FROM places WHERE id=? AND trip_id=? AND hidden=0)',
            stateUser,
            place.id,
            b.status_id,
            b.note,
            now,
            place.id,
            TRIP,
          )
        : stmt(
            db,
            'UPDATE user_place_states SET status_id=?,note=?,version=version+1,updated_at=? WHERE user_id=? AND place_id=? AND version=? AND EXISTS (SELECT 1 FROM places WHERE id=? AND trip_id=? AND hidden=0)',
            b.status_id,
            b.note,
            now,
            stateUser,
            place.id,
            b.version,
            place.id,
            TRIP,
          ),
      stmt(
        db,
        `INSERT INTO state_events(id,user_id,place_id,status_id,note,version,created_at) SELECT ?,?,place_id,status_id,note,version,? FROM user_place_states WHERE user_id=? AND place_id=? AND version=? AND changes()=1`,
        eventId,
        user.id,
        now,
        stateUser,
        place.id,
        next,
      ),
    ];
    if (hasTags)
      statements.push(
        stmt(
          db,
          'UPDATE places SET tags_json=?,tags_version=tags_version+1,updated_at=? WHERE id=? AND trip_id=? AND tags_version=? AND changes()=1',
          JSON.stringify(tags),
          now,
          place.id,
          TRIP,
          b.tags_version,
        ),
      );
    // Validate before COMMIT: a stale version or ignored write rolls back every field.
    await db.batch(statements, {
      validate(results) {
        if (results.some((r) => r.meta.changes !== 1))
          fail(409, 'Место или ярлыки изменили на другом устройстве. Обновите данные и повторите.');
      },
    });
    return json({
      version: next,
      updated_at: now,
      ...(hasTags ? { tags, tags_version: b.tags_version + 1 } : {}),
    });
  }
  return null;
}
