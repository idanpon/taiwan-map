// Shared startup rules for the map, calendar and Pages build. No DOM side effects.
export function normalizeApiBase(value) {
  if (!value) return '';
  const url = new URL(value);
  const normalized = url.origin + url.pathname.replace(/\/$/, '');
  if (
    url.protocol !== 'https:' ||
    normalized !== value ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !/^[a-zA-Z0-9/_-]*$/.test(url.pathname)
  ) {
    throw new Error('API base must be an exact HTTPS URL without credentials or a trailing slash');
  }
  return normalized;
}

export function readClientConfiguration(
  config = {},
  { missing = 'Сервер данных ещё не подключён.', invalid = 'Некорректный HTTPS-адрес API.' } = {},
) {
  let apiBase = '',
    configurationError = '';
  try {
    apiBase = normalizeApiBase(config.apiBase);
    if (!apiBase && config.requiresApi) configurationError = missing;
  } catch {
    configurationError = invalid;
  }
  const authMode = config.authMode || 'cookie';
  if (!['cookie', 'bearer'].includes(authMode)) {
    configurationError = 'Некорректный режим авторизации в настройках сайта.';
  }
  // A configuration error is surfaced by startup before making API calls.
  return {
    apiBase,
    configurationError,
    authMode: ['cookie', 'bearer'].includes(authMode) ? authMode : 'cookie',
  };
}

export function sessionStores(window) {
  let storage, legacyStorage;
  try {
    legacyStorage = window.sessionStorage;
    storage = window.localStorage;
    storage.setItem('taiwan-storage-check', '1');
    storage.removeItem('taiwan-storage-check');
  } catch {
    storage = legacyStorage;
  }
  return { storage, legacyStorage };
}

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => entities[char]);
