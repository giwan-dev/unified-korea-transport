import {test, expect} from '@playwright/test';

test('transport groups, individual types and congestion can be toggled independently', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('ukt-guide-mode', 'off');
    localStorage.setItem('ukt-lang', 'ko');
  });
  await page.goto('/?serial');
  await page.waitForFunction(() => window.ukt?.result && !document.querySelector('#btn-next').disabled, null, {timeout: 120000});
  await page.locator('[data-setup-act="ok"]').click();
  await page.evaluate(() => { window.filterErrors = []; ukt.map.on('error', event => filterErrors.push(event.error.message)); });
  const toggle = key => page.locator(`[data-network-filter="${key}"]`);
  const group = key => page.locator(`[data-network-group="${key}"]`);
  await expect(page.locator('#layerview')).toHaveCount(0);
  await expect(toggle('roadCongestion')).toBeChecked();
  await expect(toggle('railCongestion')).not.toBeChecked();
  await toggle('hsr').uncheck();
  expect(await group('rail').evaluate(el => el.indeterminate)).toBe(true);
  const filter = await page.evaluate(() => ukt.map.getFilter('rails'));
  expect(filter.at(-1).at(-1)[1]).not.toContain('hsr');
  await expect(toggle('rail')).toBeChecked();
  await group('rail').check();
  await group('road').uncheck();
  await group('rail').uncheck();
  expect(await page.evaluate(() => ukt.map.getLayoutProperty('bg-roads', 'visibility'))).toBe('none');
  expect(await page.evaluate(() => ukt.map.getLayoutProperty('airroutes', 'visibility'))).toBe('visible');
  expect(await page.evaluate(() => ukt.map.getSource('services')._data.features.length)).toBe(0);
  await group('air').uncheck();
  expect(await page.evaluate(() => ukt.map.getLayoutProperty('airports', 'visibility'))).toBe('none');
  for (const id of ['roads', 'rails', 'metro', 'links-building', 'ext-links', 'hotspots', 'closed-line']) {
    const f = await page.evaluate(id => ukt.map.getFilter(id), id);
    expect(JSON.stringify(f)).toContain('["literal",[]]');
  }
  await toggle('narrow').check();
  await toggle('railCongestion').check();
  expect(await page.evaluate(() => ukt.map.getLayoutProperty('rails', 'visibility'))).toBe('none');
  expect(await page.evaluate(() => ukt.map.getLayoutProperty('rails-vc', 'visibility'))).toBe('visible');
  expect(await page.evaluate(() => ukt.map.getFilter('rails-vc').at(-1).at(-1)[1])).toEqual(['narrow']);
  await group('road').check();
  await toggle('roadCongestion').uncheck();
  expect(await page.evaluate(() => ukt.map.getPaintProperty('roads', 'line-color'))).toBe('#3f9e63');
  await toggle('roadCongestion').check();
  expect(Array.isArray(await page.evaluate(() => ukt.map.getPaintProperty('roads', 'line-color')))).toBe(true);
  await group('rail').check();
  await group('air').check();
  await toggle('railCongestion').uncheck();
  await page.screenshot({path: 'test-results/network-filters-desktop.png'});
  await page.setViewportSize({width: 390, height: 844});
  await expect(group('road')).toBeVisible();
  await expect(toggle('metro')).toBeVisible();
  await toggle('metro').uncheck();
  await page.screenshot({path: 'test-results/network-filters-mobile.png'});
  const bounds = await page.locator('#legend').boundingBox();
  const mapBounds = await page.locator('#map').boundingBox();
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(mapBounds.y + mapBounds.height);
  expect(await page.evaluate(() => filterErrors)).toEqual([]);
  expect(errors).toEqual([]);
});

test('each transport type renders on its own without restoring other types', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('ukt-guide-mode', 'off');
    localStorage.setItem('ukt-lang', 'ko');
  });
  await page.goto('/?serial');
  await page.waitForFunction(() => window.ukt?.result && !document.querySelector('#btn-next').disabled, null, {timeout: 120000});
  await page.locator('[data-setup-act="ok"]').click();
  const types = ['motorway', 'road', 'hsr', 'rail', 'narrow', 'metro'];
  await page.evaluate(types => {
    const map = ukt.map;
    map.getSource('links').setData({type: 'FeatureCollection', features: types.map((type, i) => ({
      type: 'Feature', id: 900000 + i,
      properties: {testType: type, mode: i < 2 ? 0 : type === 'metro' ? 2 : 1,
        cls: type === 'motorway' ? 'motorway' : type === 'hsr' ? 'hsr' : 'primary',
        narrow: type === 'narrow' ? 1 : 0, building: 0, ext: 0, minor: 0, colour: ''},
      geometry: {type: 'LineString', coordinates: [350, 600].map(x => map.unproject([x, 100 + i * 40]).toArray())}
    }))});
  }, types);
  for (const group of ['road', 'rail', 'air']) await page.locator(`[data-network-group="${group}"]`).uncheck();
  const renderedTypes = () => page.evaluate(() => [...new Set(ukt.map.queryRenderedFeatures({layers: ['roads', 'roads-motorway', 'rails', 'metro']}).map(f => f.properties.testType).filter(Boolean))].sort());
  await expect.poll(renderedTypes).toEqual([]);
  for (const type of types) {
    await page.locator(`[data-network-filter="${type}"]`).check();
    await expect.poll(renderedTypes).toEqual([type]);
    await page.locator(`[data-network-filter="${type}"]`).uncheck();
    await expect.poll(renderedTypes).toEqual([]);
  }
});
