import assert from 'node:assert/strict';
import test from 'node:test';
import {markerSwipeAction} from '../public/map-marker-actions.js';

test('marker swipes use the safety radius and two 120-degree action sectors', () => {
 assert.equal(markerSwipeAction(0, -28), null);
 assert.equal(markerSwipeAction(0, 28), null);
 assert.equal(markerSwipeAction(0, -29), 'maps');
 assert.equal(markerSwipeAction(0, 29), 'visited');
 for (const side of [-1, 1]) {
  assert.equal(markerSwipeAction(side * 50, -30), 'maps');
  assert.equal(markerSwipeAction(side * 50, 30), 'visited');
  assert.equal(markerSwipeAction(side * 50, -28), null);
  assert.equal(markerSwipeAction(side * 50, 28), null);
 }
});
