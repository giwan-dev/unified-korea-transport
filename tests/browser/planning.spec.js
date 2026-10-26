import {test, expect} from '@playwright/test';

test('fork retains original rules and supports station selection, reuse and insertion', async ({page}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('ukt-guide-mode', 'off'); localStorage.setItem('ukt-lang', 'ko'); });
  await page.goto('/?serial');
  await page.waitForFunction(() => window.ukt?.result && !document.querySelector('#btn-next').disabled, null, {timeout: 120000});
  await page.locator('[data-setup-act="ok"]').waitFor({state: 'visible'});
  await page.locator('[data-setup-act="ok"]').click();
  await expect(page.locator('#s-budget')).not.toHaveText('–');
  await expect(page.locator('#trains-toggle')).toHaveCount(0);
  await expect(page.locator('#metric')).toHaveValue('none');
  const ids = await page.evaluate(() => Object.fromEntries(['서울', '행신'].map(name => [name, ukt.base.stations.find(([n]) => n === name)[1]])));
  await page.locator('[data-tab="build"]').click();
  await page.locator('[data-build="hsr"]').click();
  for (const name of ['서울', '행신']) {
    await page.locator('#draft-station-query').fill(name);
    await page.locator('#draft-station-select').selectOption(String(ids[name]));
    await page.locator('#draft-station-add').click();
  }
  await expect(page.locator('.reuse-summary')).toContainText('기존선 이용');
  await expect(page.locator('#draft-ok')).toBeDisabled();
  await expect(page.locator('#draft-ok')).toHaveText('전 구간 기존선 이용');
  expect(await page.evaluate(() => ukt.map.getSource('draft')._data.features.filter(f => f.properties.reused === 1).length)).toBeGreaterThan(0);
  const before = await page.evaluate(() => ({projects: ukt.state.projects.length, links: ukt.state.newLinks.length, budget: ukt.state.budget}));
  await page.evaluate(() => ukt.addDraftPoint({lng: 126.7, lat: 37.72}));
  await expect(page.locator('#draft-ok')).toBeEnabled();
  await page.locator('#draft-ok').click();
  await page.waitForFunction(n => ukt.state.projects.length > n, before.projects);
  const built = await page.evaluate(() => ({project: ukt.state.projects.at(-1), newLinks: ukt.state.newLinks.length, budget: ukt.state.budget}));
  expect(built.newLinks).toBe(before.links + 1);
  expect(built.project.reusedLinks.length).toBeGreaterThan(0);
  expect(built.budget).toBeLessThan(before.budget);
  // Close the original game's gazette, then check insertion using its curved line.
  await page.evaluate(() => { document.querySelectorAll('.gazette-wrap,.gz-wrap').forEach(e => e.remove()); ukt.cancelDraft(); ukt.openPlan('restore-donghae'); ukt.map.stop(); });
  const ends = await page.evaluate(() => ukt.draft.points.filter(p => !p.via).map(p => p.node));
  expect(ends).toHaveLength(2);
  const click = await page.evaluate(() => {
    ukt.map.jumpTo({center: [128.345, 38.629], zoom: 12});
    const line = ukt.map.getSource('draft')._data.features.find(f => f.geometry.type === 'LineString');
    const p = ukt.map.project(line.geometry.coordinates[Math.floor(line.geometry.coordinates.length / 2)]);
    return {x: p.x, y: p.y};
  });
  // Use the app's click handler through the map event, avoiding a gazette overlay.
  await page.evaluate(p => ukt.map.fire('click', {point: p, lngLat: ukt.map.unproject([p.x, p.y]), originalEvent: {}}), click);
  const inserted = await page.evaluate(() => ukt.draft.points.filter(p => !p.via).map(p => ({node:p.node, inserted:p.inserted})));
  expect(inserted).toHaveLength(3);
  expect(inserted[0].node).toBe(ends[0]);
  expect(inserted[2].node).toBe(ends[1]);
  expect(inserted[1].inserted).toBe(true);
  // A metro route must not be mistaken for an existing high-speed route.
  const mismatch = await page.evaluate(async () => {
    const {reusableRailSegments} = await import('/js/game/state.js');
    const from = ukt.base.metro_stations.find(([name]) => name === '강남')[1];
    const to = ukt.base.metro_stations.find(([name]) => name === '역삼')[1];
    const points = [from,to].map(node => ({node, lon:ukt.base.nodes[node][0], lat:ukt.base.nodes[node][1]}));
    return reusableRailSegments(ukt.base, ukt.state, 'hsr', points).length;
  });
  expect(mismatch).toBe(0);
  expect(errors).toEqual([]);
  await page.screenshot({path:'test-results/fork-planning.png'});
});
