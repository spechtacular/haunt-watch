import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreOrder, moveCamera, pageSize, cameraPage, restoreGroups, validateGroup } from '../public/order.js';

const cameras = ['a', 'b', 'c', 'd'].map(id => ({ id }));
const ids = value => value.map(camera => camera.id);

test('named pages preserve explicit membership/order, sharing cameras and ignoring stale entries', () => {
  const saved = [{ id: 'ship', name: ' Ship ', cameras: ['c', 'a', 'c', 'removed'] },
    { id: 'backstage', name: 'Backstage', cameras: ['a', 'b'] },
    { id: 'ship', name: 'duplicate ID', cameras: ['d'] }, null];
  assert.deepEqual(restoreGroups(saved, cameras), [
    { id: 'ship', name: 'Ship', cameras: ['c', 'a'] },
    { id: 'backstage', name: 'Backstage', cameras: ['a', 'b'] }]);
  assert.deepEqual(restoreGroups({}, cameras), []);
  assert.equal(restoreGroups([{ id: 'empty', name: 'Empty', cameras: ['removed'] }], cameras)[0].cameras.length, 0);
  const many = Array.from({length: 10}, (_, id) => ({ id: String(id) }));
  assert.equal(restoreGroups([{id: 'limit', name: 'Limit', cameras: ids(many)}], many)[0].cameras.length, 6);
});

test('page editor requires a unique name and one to six distinct cameras', () => {
  const groups = [{ id: 'ship', name: 'Ship', cameras: ['a'] }];
  assert.match(validateGroup('', ['a'], groups), /name/);
  assert.match(validateGroup(' ship ', ['a'], groups), /already exists/);
  assert.match(validateGroup('Backstage', [], groups), /1 and 6/);
  assert.match(validateGroup('Backstage', ['a', 'a'], groups), /different/);
  assert.match(validateGroup('Backstage', ['a','b','c','d','e','f','g'], groups), /1 and 6/);
  assert.equal(validateGroup('Ship', ['a','b'], groups, 'ship'), '');
  assert.equal(validateGroup('Backstage', ['a','b','c','d','e','f'], groups), '');
});

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
