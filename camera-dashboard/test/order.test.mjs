import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreOrder, moveCamera } from '../public/order.js';

const cameras = ['a', 'b', 'c', 'd'].map(id => ({ id }));
const ids = value => value.map(camera => camera.id);

test('saved order ignores removed and duplicate IDs and includes newly configured cameras', () => {
  assert.deepEqual(ids(restoreOrder(cameras, ['c', 'removed', 'a', 'c'])), ['c', 'a', 'b', 'd']);
  for (const value of [null, {}, 'invalid']) assert.deepEqual(restoreOrder(cameras, value), cameras);
});

test('camera moves work in either direction and persist independently of filtering', () => {
  assert.deepEqual(ids(moveCamera(cameras, 'a', 'c')), ['b', 'c', 'a', 'd']);
  const moved = moveCamera(cameras, 'd', 'b');
  assert.deepEqual(ids(moved), ['a', 'd', 'b', 'c']);
  assert.deepEqual(restoreOrder(cameras, JSON.parse(JSON.stringify(ids(moved)))), moved);
  assert.deepEqual(ids(cameras), ['a', 'b', 'c', 'd']);
  assert.deepEqual(moveCamera(cameras, 'missing', 'a'), cameras);
  assert.deepEqual(moveCamera(cameras, 'a', 'a'), cameras);
});
