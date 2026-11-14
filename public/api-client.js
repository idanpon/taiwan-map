// Session transport is independent from the map and its persisted trip data.
export function createApiClient({
  apiBase = '',
  authMode = 'cookie',
  storage,
  legacyStorage,
  fetchImpl = globalThis.fetch,
  onUnauthorized = () => {},
} = {}) {
  if (!['cookie', 'bearer'].includes(authMode)) throw new Error('Некорректный режим авторизации.');
  const loginPaths = new Set([
    '/api/login',
    '/api/auth/telegram/login',
    '/api/auth/setup',
    '/api/auth/passkeys/login/verify',
  ]);
  const key = 'taiwan-map.session.v1:' + apiBase;
  let token = '',
    sessionVersion = 0;
  if (authMode === 'bearer') {
    try {
      const saved = storage?.getItem(key) || legacyStorage?.getItem(key);
      if (/^[a-f0-9]{64}$/.test(saved || '')) {
        token = saved;
        storage?.setItem(key, saved);
        if (legacyStorage !== storage) legacyStorage?.removeItem(key);
      } else storage?.removeItem(key);
    } catch {}
  }
  function setToken(value) {
    sessionVersion++;
    token = value;
    try {
      if (value) storage?.setItem(key, value);
      else storage?.removeItem(key);
      if (legacyStorage !== storage) legacyStorage?.removeItem(key);
    } catch {}
  }
  function currentToken() {
    if (authMode === 'bearer')
      try {
        if (storage) {
          const saved = storage.getItem(key);
          token = /^[a-f0-9]{64}$/.test(saved || '') ? saved : '';
        }
      } catch {}
    return token;
  }
  async function api(path, options = {}) {
    if (!/^\/api\/planning\?model=[23]$/.test(path) && !/^\/api\/[a-zA-Z0-9/_-]+$/.test(path))
      throw new Error('Некорректный путь API.');
    // Re-read persisted credentials so logout in another tab revokes local access.
    const requestToken = currentToken(),
      requestSession = sessionVersion;
    const sameSession = () =>
      requestSession === sessionVersion &&
      (authMode !== 'bearer' || requestToken === currentToken());
    const headers = new Headers(options.headers);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', typeof options.body==='string'?'application/json':'application/octet-stream');
    if (authMode === 'bearer' && token && (!loginPaths.has(path) || path === '/api/auth/setup'))
      headers.set('Authorization', 'Bearer ' + token);
    const { allowAnonymous, responseType, ...requestOptions } = options;
    const response = await fetchImpl(apiBase + path, {
      ...requestOptions,
      headers,
      credentials: authMode === 'bearer' ? 'omit' : 'include',
      redirect: 'error',
      cache: 'no-store',
    });
    if(response.ok && !sameSession())throw new Error('Сессия изменилась. Повторите запрос после входа.');
    if(response.ok && responseType==='blob'){
      const blob=await response.blob();
      if(!sameSession())throw new Error('Сессия изменилась. Повторите запрос после входа.');
      return blob;
    }
    let value;
    try {
      value = await response.json();
    } catch {
      throw new Error('Сервер вернул неожиданный ответ.');
    }
    if (!response.ok) {
      if (
        response.status === 401 &&
        !loginPaths.has(path) &&
        !path.startsWith('/api/auth/passkeys/') &&
        sameSession()
      ) {
        setToken('');
        if (!options.allowAnonymous) onUnauthorized();
      }
      const error = new Error(value.error || 'Не удалось выполнить запрос.');
      error.status = response.status;
      error.details = value.details;
      throw error;
    }
    if(!sameSession())throw new Error('Сессия изменилась. Повторите запрос после входа.');
    if (authMode === 'bearer' && loginPaths.has(path)) {
      if (!/^[a-f0-9]{64}$/.test(value.token || ''))
        throw new Error('Сервер не поддерживает выбранный режим авторизации.');
      setToken(value.token);
      // The caller does not need access to the session credential.
      const { token: credential, ...result } = value;
      return result;
    }
    if (authMode === 'cookie' && loginPaths.has(path)) sessionVersion++;
    if (path === '/api/logout' && sameSession()) setToken('');
    return value;
  }
  api.hasSession = () => authMode === 'cookie' || Boolean(currentToken());
  return api;
}
