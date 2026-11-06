import { TRIP, SHARED_USER as USER, stmt } from './auth.mjs';
import { categories, places, verifiedAt } from './places.mjs';

export async function seed(db) {
  if (await stmt(db, 'SELECT value FROM app_meta WHERE key=?', 'seed_v1').first()) return;
  const now = Date.now();
  const q = [
    stmt(
      db,
      'INSERT OR IGNORE INTO trips(id,name,timezone) VALUES(?,?,?)',
      TRIP,
      'Тайвань · 29.12.2026–09.01.2027',
      'Asia/Taipei',
    ),
    stmt(
      db,
      'INSERT OR IGNORE INTO users(id,display_name,created_at) VALUES(?,?,?)',
      USER,
      'Наша поездка',
      now,
    ),
    stmt(
      db,
      'INSERT OR IGNORE INTO memberships(trip_id,user_id,role) VALUES(?,?,?)',
      TRIP,
      USER,
      'owner',
    ),
  ];
  for (const c of categories)
    q.push(
      stmt(
        db,
        'INSERT OR IGNORE INTO categories(id,label,color,icon,sort_order) VALUES(?,?,?,?,?)',
        c.id,
        c.label,
        c.color,
        c.icon,
        c.sort_order,
      ),
    );
  for (const [i, s] of [
    ['want', 'Хочу посетить', '#1456e0', '!', 0],
    ['visited', 'Уже посетил', '#6b7280', '✓', 1],
    ['maybe', 'Под вопросом', '#facc15', '?', 0],
  ].entries())
    q.push(
      stmt(
        db,
        'INSERT OR IGNORE INTO statuses(id,trip_id,label,color,sort_order,created_by,symbol,dimmed) VALUES(?,?,?,?,?,?,?,?)',
        s[0],
        TRIP,
        s[1],
        s[2],
        i,
        USER,
        s[3],
        s[4],
      ),
    );
  for (const p of places) {
    q.push(
      stmt(
        db,
        'INSERT OR IGNORE INTO places(id,trip_id,name,local_name,city,category_id,lat,lon,address,summary,tip,hours_json,verified_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        p.id,
        TRIP,
        p.name,
        p.local_name,
        p.city,
        p.category_id,
        p.lat,
        p.lon,
        p.address,
        p.summary,
        p.tip,
        JSON.stringify(p.hours),
        p.verified_at,
        now,
      ),
    );
    q.push(
      stmt(
        db,
        'INSERT OR IGNORE INTO place_links(id,place_id,label,url,kind) VALUES(?,?,?,?,?)',
        p.id + '-source',
        p.id,
        'Источник часов',
        p.source,
        'source',
      ),
    );
    if (p.extra)
      q.push(
        stmt(
          db,
          'INSERT OR IGNORE INTO place_links(id,place_id,label,url,kind) VALUES(?,?,?,?,?)',
          p.id + '-extra',
          p.id,
          p.extra[0],
          p.extra[1],
          'official',
        ),
      );
  }
  if (
    db.sqlite
      ?.prepare('PRAGMA table_info(trips)')
      .all()
      .some((c) => c.name === 'departure_date')
  )
    q.push(
      stmt(
        db,
        "UPDATE trips SET departure_date=COALESCE(departure_date,'2026-12-28'),start_date=COALESCE(start_date,'2026-12-29'),end_date=COALESCE(end_date,'2027-01-09') WHERE id=?",
        TRIP,
      ),
    );
  q.push(stmt(db, 'INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)', 'seed_v1', verifiedAt));
  await db.batch(q);
}
