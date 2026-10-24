import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreOrder, moveCamera, pageSize, cameraPage } from '../public/order.js';

const cameras = ['a', 'b', 'c', 'd'].map(id => ({ id }));
const ids = value => value.map(camera => camera.id);

test('pages contain every camera once for all supported sizes, with a six-camera limit', () => {
  const inventory = Array.from({ length: 23 }, (_, id) => ({ id: String(id) }));
  for (let size = 1; size <= 6; size++) {
    const combined = [];
    const { pages } = cameraPage(inventory, 0, size);
    for (let index = 0; index < pages; index++) {
      const result = cameraPage(inventory, index, size);
      assert.ok(result.visible.length <= size);
      combined.push(...result.visible);
    }
    assert.deepEqual(combined, inventory);
    assert.equal(cameraPage(inventory, 100, size).page, pages - 1);
  }
  for (const value of ['all', '9', '16', null, -1, 0, 7, 2.5]) assert.equal(pageSize(value), 6);
  assert.deepEqual(cameraPage([], 5, 6), { size: 6, page: 0, pages: 1, visible: [] });
});

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
