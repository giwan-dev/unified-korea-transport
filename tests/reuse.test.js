import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findRailReuse } from '../js/game/reuse.js';
import { newGame, startNewBuild, reusableRailSegments } from '../js/game/state.js';
import { NEW_BUILDS } from '../js/game/catalog.js';
import { decodeNetwork } from '../js/data/netpack.js';

const points = [
  { node: 0, lon: 127, lat: 37, name: 'A' },
  { node: 1, lon: 127, lat: 37.1, name: 'B' },
  { node: 2, lon: 127, lat: 37.2, name: 'C' },
];
function fixture(mode = 1, cls = 'hsr') {
  return { nodes: points.map((p) => [p.lon, p.lat]),
    links: [{ a: 0, b: 1, mode, cls, len: 11, speed: mode === 2 ? 35 : 230, tracks: 2, power: 'AC', kp: 0, name: '기존선', geom: [127, 37, 127, 37.1] }],
    stations: [['A', 0], ['B', 1]], metro_stations: [], junctions: [] };
}

test('same-kind operating tracks are reused and only B–C is constructed and charged', () => {
  const base = fixture(), state = newGame();
  assert.deepEqual(reusableRailSegments(base, state, 'hsr', points)[0].links, [0]);
  const before = state.budget;
  assert.equal(startNewBuild(base, state, { type: 'hsr', points, names: {}, reuseExisting: true }).ok, true);
  assert.deepEqual(state.newLinks.map((l) => [l.a, l.b]), [[1, 2]]);
  assert.deepEqual(state.projects[0].links, [1]);
  assert.deepEqual(state.projects[0].reusedLinks, [0]);
  assert.equal(state.budget, before - state.projects[0].annual);
  assert.ok(state.projects[0].cost < NEW_BUILDS.hsr.perKm * 15);
});

test('an entirely existing route makes no project, nodes, links or financial changes', () => {
  const base = fixture(), state = newGame(), before = structuredClone(state);
  const result = startNewBuild(base, state, { type: 'hsr', points: points.slice(0, 2), names: {}, reuseExisting: true });
  assert.equal(result.reusedOnly, true);
  assert.deepEqual(state, before);
});

test('metro tracks cannot replace new high-speed tracks', () => {
  const base = fixture(2, 'metro'), state = newGame();
  assert.deepEqual(reusableRailSegments(base, state, 'hsr', points.slice(0, 2)), []);
  assert.equal(startNewBuild(base, state, { type: 'hsr', points: points.slice(0, 2), names: {}, reuseExisting: true }).ok, true);
  assert.equal(state.newLinks.length, 1);
  assert.equal(state.newLinks[0].mode, 1);
  assert.equal(state.newLinks[0].cls, 'hsr');
});

test('inactive, unbuilt and virtual-service links are not reused', () => {
  for (const flags of [{ active: false }, { built: false }, { replaced: true }, { service: 'virtual' }]) {
    const net = fixture(); Object.assign(net.links[0], flags);
    assert.deepEqual(findRailReuse(net, NEW_BUILDS.hsr, points.slice(0, 2)), []);
  }
  const net = fixture(); net.physCount = 0;
  assert.deepEqual(findRailReuse(net, NEW_BUILDS.hsr, points.slice(0, 2)), []);
});

test('the shortest existing same-kind path can cross multiple physical links', () => {
  const net = fixture();
  net.links.push({ ...net.links[0], a: 1, b: 2, len: 12 });
  const result = findRailReuse(net, NEW_BUILDS.hsr, [points[0], points[2]]);
  assert.deepEqual(result[0].links, [0, 1]);
  assert.equal(result[0].km, 23);
});

test('legacy straightening callers and road construction keep their original behavior', () => {
  const base = fixture(), state = newGame();
  assert.equal(startNewBuild(base, state, { type: 'hsr', points: points.slice(0, 2), names: {} }).ok, true);
  assert.equal(state.newLinks.length, 1);
  const roadBase = fixture(0, 'motorway'), roadState = newGame();
  assert.equal(startNewBuild(roadBase, roadState, { type: 'motorway', points: points.slice(0, 2), names: {}, reuseExisting: true }).ok, true);
  assert.equal(roadState.newLinks.length, 1);
});

test('failure to afford a mixed plan leaves no orphan nodes or partial project', () => {
  const base = fixture(), state = newGame(); state.budget = 0; state.debt = 100000000;
  const before = structuredClone(state);
  const result = startNewBuild(base, state, { type: 'hsr', points: [...points.slice(0, 2), {lon: 127.2, lat: 37.2}], names: {}, reuseExisting: true });
  assert.equal(result.ok, false);
  for (const key of ['newNodes', 'newLinks', 'projects', 'budget', 'debt']) assert.deepEqual(state[key], before[key]);
});

test('the real Seoul–Haengsin KTX shared corridor reuses existing conventional geometry', async () => {
  const meta = JSON.parse(await readFile(new URL('../data/network.meta.json', import.meta.url), 'utf8'));
  const bytes = await readFile(new URL('../data/network.bin', import.meta.url));
  const base = decodeNetwork(meta, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const from = base.stations.find(([name]) => name === '서울')[1];
  const to = base.stations.find(([name]) => name === '행신')[1];
  const ps = [from, to].map((node) => ({node, lon: base.nodes[node][0], lat: base.nodes[node][1]}));
  const reused = reusableRailSegments(base, newGame(), 'hsr', ps);
  assert.equal(reused.length, 1);
  assert.equal(reused[0].shared, true);
  assert.ok(reused[0].km > 10 && reused[0].km < 20);
  assert.ok(reused[0].links.every((id) => base.links[id].name === '경의선' && base.links[id].cls === 'conv'));
});
