import assert from 'node:assert/strict';
import test from 'node:test';
import {googleMapsUrl} from '../public/place-maps.js';

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
