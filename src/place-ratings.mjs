import { TRIP, body, fail, json } from './auth.mjs';
import { all, one, run, transaction } from './sqlite.mjs';

export const canRatePlaces = (user) => user.role === 'admin' || user.role === 'editor';

function visiblePlace(db, placeId, stateUser) {
  const place = one(db, `SELECT p.id, s.status_id FROM places p
    LEFT JOIN user_place_states s ON s.place_id = p.id AND s.user_id = ?
    WHERE p.id = ? AND p.trip_id = ? AND p.hidden = 0`, stateUser, placeId, TRIP);
  if (!place) fail(404, 'Место не найдено.');
  return place;
}

export async function handlePlaceRatings(request, db, user, stateUser) {
  const match = new URL(request.url).pathname.match(/^\/api\/places\/([a-zA-Z0-9-]+)\/ratings$/);
  if (!match || !['GET', 'PUT'].includes(request.method)) return null;
  if (!canRatePlaces(user)) fail(403, 'Оценки по авторам и редактирование доступны редакторам и админам.');

  const placeId = match[1];
  if (request.method === 'GET') {
    visiblePlace(db, placeId, stateUser);
    return json({ ratings: all(db, `SELECT u.display_name AS name, r.rating
      FROM place_ratings r JOIN users u ON u.id = r.user_id
      WHERE r.place_id = ? ORDER BY u.display_name, u.id`, placeId) });
  }

  const { rating } = await body(request, 1024);
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5))
    fail(400, 'Выберите от 1 до 5 звёзд.');

  return json(transaction(db, () => {
    const member = one(db, `SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.trip_id = ? AND m.user_id = ? AND u.disabled = 0`, TRIP, user.id);
    if (!member || !canRatePlaces(member)) fail(403, 'Право редактирования недоступно.');

    const place = visiblePlace(db, placeId, stateUser);
    if (rating === null) {
      run(db, 'DELETE FROM place_ratings WHERE place_id = ? AND user_id = ?', place.id, user.id);
    } else {
      const own = one(db, 'SELECT rating FROM place_ratings WHERE place_id = ? AND user_id = ?', place.id, user.id);
      if (place.status_id !== 'visited' && !own)
        fail(409, 'Сначала отметьте место как посещённое.');
      run(db, `INSERT INTO place_ratings (place_id, user_id, rating, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (place_id, user_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at
        WHERE place_ratings.rating <> excluded.rating`, place.id, user.id, rating, Date.now());
    }
    const average = one(db, 'SELECT average_rating FROM place_rating_averages WHERE place_id = ?', place.id);
    return { average_rating: average?.average_rating ?? null, my_rating: rating };
  }));
}
