import { fail } from './auth.mjs';

export function handleStatuses(request, _db, user) {
  const path = new URL(request.url).pathname;
  if (/^\/api\/statuses(?:\/[a-zA-Z0-9-]+)?$/.test(path) &&
      ['POST', 'PUT', 'DELETE'].includes(request.method)) {
    if (!['owner', 'admin', 'editor'].includes(user.role)) fail(403, 'Доступ только для просмотра.');
    fail(405, 'Доступны только фиксированные статусы мест.');
  }
  return null;
}
