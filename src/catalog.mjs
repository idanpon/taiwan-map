import { TRIP, stmt, json } from './auth.mjs';
import { categories, verifiedAt } from './places.mjs';
import { readTags } from '../public/place-tags.js';
import { planningData } from './planning.mjs';

export async function handleCatalog(request, db, user, stateUser, scope) {
  const path = new URL(request.url).pathname;
  if ((path === '/api/data' || path === '/api/export') && request.method === 'GET') {
    const [ps, cs, ss, ls] = await db.batch([
      stmt(
        db,
        `SELECT p.*,s.status_id,s.note,COALESCE(s.version,0) version FROM places p LEFT JOIN user_place_states s ON s.place_id=p.id AND s.user_id=? WHERE p.trip_id=? ${path === '/api/data' ? 'AND p.hidden=0' : ''} ORDER BY p.city,p.name`,
        stateUser,
        TRIP,
      ),
      db.prepare('SELECT * FROM categories ORDER BY sort_order'),
      stmt(
        db,
        'SELECT id,label,color,symbol,dimmed,version,sort_order FROM statuses WHERE trip_id=? AND archived=0 ORDER BY sort_order,label',
        TRIP,
      ),
      stmt(
        db,
        'SELECT l.* FROM place_links l JOIN places p ON p.id=l.place_id WHERE p.trip_id=?',
        TRIP,
      ),
    ]);
    const data = {
      schema_version: 1,
      trip: { id: TRIP, name: 'Тайвань', timezone: 'Asia/Taipei' },
      state_scope: scope || 'shared',
      user: {
        id: user.id,
        name: user.display_name,
        username: user.username,
        role: user.role === 'owner' ? 'admin' : user.role,
        telegram_linked: Boolean(user.auth_subject),
        has_password: Boolean(user.has_password),
        can_setup: !scope && user.role === 'owner',
      },
      verified_at: verifiedAt,
      categories: cs.results.map((c) => ({
        ...c,
        description: categories.find((definition) => definition.id === c.id)?.description || '',
      })),
      statuses: ss.results.map((s) => ({ ...s, dimmed: Boolean(s.dimmed) })),
      places: ps.results.map((p) => ({
        ...p,
        hidden: Boolean(p.hidden),
        tags: readTags(p.tags_json),
        tags_json: undefined,
        hours: JSON.parse(p.hours_json),
        hours_json: undefined,
        note: p.note || '',
        links: ls.results.filter((l) => l.place_id === p.id),
      })),
    };
    const tripRecord = await stmt(db, 'SELECT * FROM trips WHERE id=?', TRIP).first();
    data.trip = {
      ...data.trip,
      departure_date: tripRecord?.departure_date,
      start_date: tripRecord?.start_date,
      end_date: tripRecord?.end_date,
    };
    if (path === '/api/export') data.planning = planningData(db);
    return json(
      data,
      200,
      path === '/api/export'
        ? { 'Content-Disposition': 'attachment; filename="taiwan-map.json"' }
        : {},
    );
  }
  return null;
}
