import { seed } from './seed.mjs';
import { handleCatalog } from './catalog.mjs';
import { handleStatuses } from './statuses.mjs';
import { handlePlaceState } from './place-state.mjs';
import { handlePlanning } from './planning.mjs';
import { handlePlaceTags } from './place-tags.mjs';
import {
  SHARED_USER as USER,
  sha,
  verify,
  Problem,
  fail,
  json,
  body,
  stmt,
  session,
  sessionToken,
  cookie,
  issueSession,
  limitLogin,
} from './auth.mjs';
import { handleAccounts, accountScope } from './accounts.mjs';
import { handlePlaceLifecycle } from './place-lifecycle.mjs';
import { handlePasskeys } from './passkeys.mjs';
import { publicCatalog } from './public-catalog.mjs';
import { handleReminders } from './reminders.mjs';
import { handleNotifications } from './notifications.mjs';
import { assistantRoute, handleAssistant } from './assistant-http.mjs';
export { passwordHash, sha } from './auth.mjs';
async function handleApi(request, env, context = {}) {
  try {
    const url = new URL(request.url),
      db = env.DB,
      path = url.pathname;
    const secure = url.protocol === 'https:';
    if (!db) fail(503, 'Хранилище временно недоступно.');
    if (path === '/api/health' && request.method === 'GET') {
      await db.prepare('SELECT 1').first();
      return json({ ok: true });
    }
    if (path === '/api/public/data' && request.method === 'GET') return await publicCatalog(db);
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (!allowedOrigins(env, url).has(request.headers.get('origin')))
        fail(403, 'Источник запроса не разрешён.');
    }
    const passkeyResponse = await handlePasskeys(request, env, context);
    if (passkeyResponse) return passkeyResponse;
    const accountResponse = await handleAccounts(request, env, context);
    if (accountResponse) return accountResponse;
    if (path === '/api/login' && request.method === 'POST') {
      if (!env.APP_PASSWORD_HASH) fail(503, 'Авторизация не настроена.');
      const b = await body(request);
      if (typeof b.password !== 'string' || b.password.length > 256) fail(400, 'Укажите пароль.');
      await limitLogin(db, context, { legacy: true });
      if (!(await verify(b.password, env.APP_PASSWORD_HASH))) fail(401, 'Неверный пароль.');
      await seed(db);
      return await issueSession(request, env, USER, { legacy: true });
    }
    const user = await session(request, db, env);
    if (!user) fail(401, 'Войдите, чтобы открыть карту.');
    if (path === '/api/logout' && request.method === 'POST') {
      const token = sessionToken(request, env);
      if (token) await stmt(db, 'DELETE FROM sessions WHERE token_hash=?', await sha(token)).run();
      return json(
        { ok: true },
        200,
        env.AUTH_MODE === 'bearer'
          ? {}
          : { 'Set-Cookie': cookie('', secure, 0, env.SESSION_COOKIE_PATH || '/') },
      );
    }
    const scope = await accountScope(db),
      stateUser = scope === 'shared' ? USER : user.id;
    const reminderResponse = await handleReminders(request, db, user);
    if (reminderResponse) return reminderResponse;
    const notificationsResponse = await handleNotifications(request, env, user);
    if (notificationsResponse) return notificationsResponse;
    const planningResponse = await handlePlanning(request, db, user);
    if (planningResponse) return planningResponse;
    const tagResponse = await handlePlaceTags(request, db, user);
    if (tagResponse) return tagResponse;
    const lifecycle = await handlePlaceLifecycle(request, db, user, stateUser);
    if (lifecycle) return lifecycle;
    const catalogResponse = await handleCatalog(request, db, user, stateUser, scope);
    if (catalogResponse) return catalogResponse;
    const statusResponse = await handleStatuses(request, db, user);
    if (statusResponse) return statusResponse;
    const stateResponse = await handlePlaceState(request, db, user, stateUser);
    if (stateResponse) return stateResponse;

    fail(404, 'Маршрут не найден.');
  } catch (error) {
    if (error instanceof Problem)
      return json(
        { error: error.message, ...(error.details ? { details: error.details } : {}) },
        error.status,
        error.status === 429 ? { 'Retry-After': '900' } : {},
      );
    console.error('API failure', error?.name);
    return json({ error: 'Не удалось выполнить запрос. Попробуйте ещё раз.' }, 500);
  }
}

// CORS stays at the transport boundary; authentication and membership still apply.
function allowedOrigins(env, url) {
  const origins = new Set([env.APP_ORIGIN || url.origin]);
  if (env.FRONTEND_ORIGIN) origins.add(env.FRONTEND_ORIGIN);
  return origins;
}
export async function handle(request, env, context = {}) {
  if (assistantRoute(new URL(request.url).pathname)) return handleAssistant(request, env, context);
  const url = new URL(request.url),
    origin = request.headers.get('origin'),
    allowed = allowedOrigins(env, url);
  if (origin && !allowed.has(origin))
    return json({ error: 'Источник запроса не разрешён.' }, 403, { Vary: 'Origin' });
  let response;
  if (request.method === 'OPTIONS') {
    const method = request.headers.get('access-control-request-method');
    const requested = (request.headers.get('access-control-request-headers') || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    const allowedHeaders =
      env.AUTH_MODE === 'bearer' ? ['content-type', 'authorization'] : ['content-type'];
    if (
      !origin ||
      !['GET', 'POST', 'PUT', 'DELETE'].includes(method) ||
      requested.some((h) => !allowedHeaders.includes(h))
    )
      return json({ error: 'Preflight не разрешён.' }, 403, { Vary: 'Origin' });
    response = new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers':
          env.AUTH_MODE === 'bearer' ? 'Content-Type, Authorization' : 'Content-Type',
        'Access-Control-Max-Age': '600',
        'Cache-Control': 'no-store',
      },
    });
  } else response = await handleApi(request, env, context);
  return corsResponse(request, env, response);
}

// Transport rejections must remain readable by the allowed frontend too.
export function apiErrorResponse(request, env, status, message) {
  return corsResponse(request, env, json({ error: message }, status));
}

function corsResponse(request, env, response) {
  const origin = request.headers.get('origin');
  const headers = new Headers(response.headers);
  headers.set('Vary', 'Origin');
  if (origin && allowedOrigins(env, new URL(request.url)).has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    if (env.AUTH_MODE !== 'bearer') headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Expose-Headers', 'Content-Disposition');
  }
  return new Response(response.body, { status: response.status, headers });
}
