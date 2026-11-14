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

export function trackTouchInput(document){
 const root=document.documentElement;
 const options={capture:true,passive:true};
 document.addEventListener('pointerdown',event=>root.toggleAttribute('data-ui-touch',event.pointerType==='touch'),options);
 document.addEventListener('touchstart',()=>root.setAttribute('data-ui-touch',''),options);
 document.addEventListener('pointermove',event=>{
  if(event.pointerType==='mouse'&&root.hasAttribute('data-ui-touch'))root.removeAttribute('data-ui-touch');
 },options);
 document.addEventListener('keydown',event=>{
  if(!event.isComposing&&!event.metaKey&&!event.ctrlKey&&!event.altKey)root.removeAttribute('data-ui-touch');
 },true);
}

export function isAppleMobile(navigator) {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
