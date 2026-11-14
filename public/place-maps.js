import {isAppleMobile} from './client-runtime.js';

export function googleMapsUrl({name, address, lat, lon}) {
 const streetAddress = address?.trim();
 const isCoordinateAddress = /^[+-]?\d+(?:\.\d+)?\s*,\s*[+-]?\d+(?:\.\d+)?$/.test(streetAddress);
 const query = streetAddress && !isCoordinateAddress ? name + ' ' + streetAddress : lat + ',' + lon;
 const url = new URL('https://www.google.com/maps/search/');
 url.searchParams.set('api', '1');
 url.searchParams.set('query', query);
 return url.href;
}

const appFallbackDelay = 1500;

export function createGoogleMapsOpener(window) {
 const {document, location, navigator} = window;
 let cancelPending;

 return function openGoogleMaps(place) {
  cancelPending?.();
  const webUrl = googleMapsUrl(place);
  if (!isAppleMobile(navigator)) {
   location.assign(webUrl);
   return;
  }

  function cancelFallback() {
   window.clearTimeout(timer);
   document.removeEventListener('visibilitychange', onVisibilityChange);
   window.removeEventListener('pagehide', cancelFallback);
   cancelPending = undefined;
  }

  function onVisibilityChange() {
   if (document.hidden) cancelFallback();
  }

  function openWeb() {
   cancelFallback();
   if (!document.hidden) location.assign(webUrl);
  }

  // A webpage cannot check whether the app is installed. Leaving the page
  // cancels the fallback so it cannot open Google Maps again on return.
  const timer = window.setTimeout(openWeb, appFallbackDelay);
  cancelPending = cancelFallback;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', cancelFallback);

  try {
   location.assign(webUrl.replace(/^https:/, 'comgooglemapsurl:'));
  } catch {
   openWeb();
  }
 };
}
