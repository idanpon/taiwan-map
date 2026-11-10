import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../server/database.mjs';
import { handle, passwordHash, sha } from '../src/core.mjs';

test('scores belong to the authenticated editor, with only the average visible to guests and viewers', async (t) => {
  const DB = openDatabase();
  t.after(() => DB.close());
  migrate(DB, 'drizzle');
  const origin = 'https://rating-test.example';
  const env = { DB, APP_ORIGIN: origin, AUTH_MODE: 'bearer', APP_PASSWORD_HASH: await passwordHash('test-only') };
  const call = (path, token, method = 'GET', body) => handle(new Request(origin + path, {
    method,
    headers: {
      Origin: origin,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  const { token: admin } = await (await call('/api/login', null, 'POST', { password: 'test-only' })).json();
  const path = '/api/places/taipei-101/ratings';
  const score = (token, rating, extra) => call(path, token, 'PUT', { rating, ...extra });
  assert.equal((await score(admin, 5)).status, 403, 'legacy shared login cannot rate');
  DB.sqlite.exec("INSERT INTO app_meta VALUES ('accounts_v1','shared'); UPDATE memberships SET role='admin';");
  const editor = 'a'.repeat(64), viewer = 'b'.repeat(64);
  for (const [role, token] of [['editor', editor], ['viewer', viewer]]) {
    DB.sqlite.prepare('INSERT INTO users(id,display_name,created_at) VALUES(?,?,1)').run(role, 'rating-test-' + role);
    DB.sqlite.prepare('INSERT INTO memberships VALUES(?,?,?)').run('taiwan-2026', role, role);
    DB.sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await sha(token), role, Date.now() + 60000);
  }
  assert.equal((await call(path, null)).status, 401);
  assert.equal((await call(path, viewer)).status, 403);
  assert.equal((await score(viewer, 5)).status, 403);
  assert.equal((await score(editor, 4)).status, 409, 'first score requires a visited place');
  assert.equal((await call('/api/places/taipei-101/state', admin, 'PUT', {
    version: 0, status_id: 'visited', note: 'Preserve shared note',
  })).status, 200);
  for (const invalid of [0, 6, 2.5, '4', undefined])
    assert.equal((await score(editor, invalid)).status, 400);
  assert.deepEqual(await (await score(admin, 5)).json(), { average_rating: 5, my_rating: 5 });
  assert.deepEqual(await (await score(editor, 2, { user_id: 'trip-shared' })).json(), { average_rating: 3.5, my_rating: 2 });
  assert.deepEqual(await (await score(editor, 4)).json(), { average_rating: 4.5, my_rating: 4 });
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS total FROM place_ratings').get().total, 2);

  const readPlace = async (url, token) => (await (await call(url, token)).json()).places.find(p => p.id === 'taipei-101');
  for (const [url, token] of [['/api/public/data', null], ['/api/data', viewer], ['/api/export', editor]]) {
    const place = await readPlace(url, token);
    assert.equal(place.average_rating, 4.5);
    assert.equal(Object.hasOwn(place, 'my_rating'), false);
    assert.equal(Object.hasOwn(place, 'ratings'), false);
  }
  const own = await readPlace('/api/data', editor);
  assert.equal(own.my_rating, 4);
  assert.equal(own.note, 'Preserve shared note');
  assert.equal(own.version, 1);
  const { ratings } = await (await call(path, editor)).json();
  assert.equal(ratings.length, 2);
  assert.ok(ratings.some(row => row.name === 'rating-test-editor' && row.rating === 4));

  assert.deepEqual(await (await score(editor, null)).json(), { average_rating: 5, my_rating: null });
  assert.equal((await call('/api/places/taipei-101/visibility', admin, 'PUT', { hidden: true, version: 1 })).status, 200);
  assert.equal(await readPlace('/api/public/data', null), undefined);
  assert.equal((await call(path, admin)).status, 404);
  assert.equal((await score(admin, 3)).status, 404);
  assert.equal((await call('/api/places/taipei-101', admin, 'DELETE', { version: 2 })).status, 200);
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS total FROM place_ratings').get().total, 0);
  assert.deepEqual(DB.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});
