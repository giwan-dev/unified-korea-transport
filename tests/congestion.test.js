import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, updateCongestion, defaultFix, updateApproval } from '../js/game/state.js';

const road = (attrs = {}) => ({ mode: 0, cls: 'motorway', kp: 0, name: '하남대로', len: 2, lanes: 10, speed: 95, ...attrs });

test('maxed-out roads do not create requests or neglected-request penalties', () => {
  const base = { links: [road()] }, state = newGame();
  assert.equal(defaultFix(base.links[0]), null);
  for (let year = 0; year < 5; year++) assert.deepEqual(updateCongestion(base, state, [1.5]), []);
  assert.deepEqual(state.congestion, {});
  updateApproval(state, [], null, null, 2);
  assert.ok(!state.approvalWhy.some(([label]) => label.startsWith('오래 방치한 민원')));
});

test('saved congestion and completed upgrades are filtered without advancing time', () => {
  const base = { links: [road({ lanes: 8 })] }, state = newGame();
  state.congestion = { 0: 4 };
  assert.equal(updateCongestion(base, state, [1.5], false).length, 1);
  state.overrides[0] = { lanes: 10 };
  const requests = updateCongestion(base, state, [1.5], false);
  assert.deepEqual(requests, []);
  updateApproval(state, requests, null, null, 2);
  assert.ok(!state.approvalWhy.some(([label]) => label.startsWith('오래 방치한 민원')));
});

test('a mixed route retains only improvable segments regardless of link order', () => {
  for (const links of [[road(), road({ lanes: 8 })], [road({ lanes: 8 }), road()]]) {
    const state = newGame();
    state.congestion = { 0: 3, 1: 3 };
    const requests = updateCongestion({ links }, state, [1.8, 1.4], false);
    const id = links.findIndex(l => l.lanes === 8);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].links, [id]);
    assert.equal(requests[0].km, 2);
    assert.equal(requests[0].vc, [1.8, 1.4][id]);
    assert.equal(defaultFix(links[id]).id, 'widen');
  }
});

test('road conversion and rail upgrades remain available until their limits', () => {
  const links = [road({ cls: 'trunk' }), road({ mode: 1, cls: 'conv', tracks: 2, speed: 150 }), road({ mode: 1, cls: 'conv', tracks: 4, speed: 200 })];
  const requests = updateCongestion({ links }, newGame(), [1.5, 1.5, 1.5]);
  assert.deepEqual(requests.flatMap(r => r.links), [0, 1]);
  assert.equal(defaultFix(links[0]).id, 'tomotorway');
  assert.equal(defaultFix(links[1]).id, 'quad');
});
