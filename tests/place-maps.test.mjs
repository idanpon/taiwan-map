import assert from 'node:assert/strict';
import test from 'node:test';
import {createGoogleMapsOpener, googleMapsUrl} from '../public/place-maps.js';

const place = {
 name: 'Музей & парк',
 address: ' 臺北市信義路 1 ',
 lat: 25.034,
 lon: 121.564
};

test('the Google Maps link searches by place name and address', () => {
 const url = new URL(googleMapsUrl(place));
 assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/search/');
 assert.deepEqual([...url.searchParams], [['api', '1'], ['query', 'Музей & парк 臺北市信義路 1']]);
});

test('a place with only coordinates opens a pin at its saved position', () => {
 for (const address of [undefined, null, '', '  ', '25.03, 121.56']) {
  const url = new URL(googleMapsUrl({...place, address}));
  assert.equal(url.pathname, '/maps/search/');
  assert.equal(url.searchParams.get('query'), '25.034,121.564');
 }
});

function openerFixture(t, navigator = {userAgent: 'iPhone'}) {
 t.mock.timers.enable({apis:['setTimeout']});
 const document = new EventTarget();
 document.hidden = false;
 const navigations = [];
 const window = Object.assign(new EventTarget(), {
  document,
  location: {assign: url => navigations.push(url)},
  navigator,
  setTimeout,
  clearTimeout
 });
 return {document, navigations, window, open: createGoogleMapsOpener(window)};
}

test('iPhone tries the same Google Maps destination in the app before web fallback', t => {
 const {navigations, open} = openerFixture(t);
 open(place);
 const webUrl = googleMapsUrl(place);
 assert.deepEqual(navigations, [webUrl.replace(/^https:/, 'comgooglemapsurl:')]);
 t.mock.timers.tick(1499);
 assert.equal(navigations.length, 1);
 t.mock.timers.tick(1);
 assert.equal(navigations.at(-1), webUrl);
});

test('returning after an app switch does not open the web fallback', t => {
 const {document, navigations, open} = openerFixture(t);
 const coordinateOnly = {...place, address: ''};
 open(coordinateOnly);
 assert.equal(new URL(navigations[0]).searchParams.get('query'), '25.034,121.564');
 document.hidden = true;
 document.dispatchEvent(new Event('visibilitychange'));
 document.hidden = false;
 document.dispatchEvent(new Event('visibilitychange'));
 t.mock.timers.tick(3000);
 assert.equal(navigations.length, 1);
});

test('pagehide cancels web fallback and a repeat swipe only opens the latest destination', t => {
 const {navigations, open, window} = openerFixture(t);
 open(place);
 window.dispatchEvent(new Event('pagehide'));
 t.mock.timers.tick(1500);
 assert.equal(navigations.length, 1);
 open(place);
 t.mock.timers.tick(750);
 const next = {...place, address: '', lat: 24};
 open(next);
 t.mock.timers.tick(750);
 assert.equal(navigations.length, 3);
 t.mock.timers.tick(750);
 assert.deepEqual(navigations.slice(3), [googleMapsUrl(next)]);
});

test('a rejected iOS app URL falls back immediately without leaving another pending attempt', t => {
 const {navigations, open, window} = openerFixture(t);
 window.location.assign = url => {
  if (url.startsWith('comgooglemapsurl:')) throw new Error('Unsupported scheme');
  navigations.push(url);
 };
 open(place);
 t.mock.timers.tick(1500);
 assert.deepEqual(navigations, [googleMapsUrl(place)]);
});

test('Android starts with the current web navigation', t => {
 const {navigations, open} = openerFixture(t, {userAgent:'Android'});
 open(place);
 t.mock.timers.tick(1500);
 assert.deepEqual(navigations, [googleMapsUrl(place)]);
});
