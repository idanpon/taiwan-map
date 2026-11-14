import assert from 'node:assert/strict';
import test from 'node:test';
import {groupMapPlaces, placeCountLabel} from '../public/map-model.js';

const point = {lat: 25.034, lon: 121.564};
const place = (id, attrs = {}) => ({id, ...point, ...attrs});

test('only exact coordinates group and only supplied places are counted', () => {
 const a = place('a');
 const b = place('b');
 const near = place('near', {lat: point.lat + 0.00001});
 const key = point.lat + ',' + point.lon;
 const groups = groupMapPlaces([a, near, b]);
 assert.equal(groups.size, 2);
 assert.deepEqual(groups.get(key), [b, a]);
 assert.deepEqual(groupMapPlaces([a, near]).get(key), [a]);
});

test('a group puts the prior top marker first and sorts by the existing map priority', () => {
 const visited = place('visited', {status_id: 'visited'});
 const want = place('want', {status_id: 'want'});
 const maybe = place('maybe', {status_id: 'maybe'});
 const stay = place('stay', {status_id: 'visited', has_stay: true});
 const unbooked = place('unbooked', {category_id: 'lodging'});
 const laterWant = place('later', {status_id: 'want'});
 const [ranked] = groupMapPlaces([maybe, want, visited, stay, unbooked, laterWant]).values();
 assert.deepEqual(ranked, [stay, laterWant, want, maybe, unbooked, visited]);
});

test('place counts use the correct Russian form', () => {
 assert.equal(placeCountLabel(1), '1 место');
 assert.equal(placeCountLabel(3), '3 места');
 assert.equal(placeCountLabel(12), '12 мест');
 assert.equal(placeCountLabel(21), '21 место');
});
