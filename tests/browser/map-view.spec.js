import {test, expect} from '@playwright/test';

test('map camera survives a reload and invalid saved coordinates use the default view', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('ukt-guide-mode', 'off');
    localStorage.setItem('ukt-lang', 'ko');
    if (!localStorage.getItem('ukt-map-view')) {
      localStorage.setItem('ukt-map-view', JSON.stringify({center: [127, 100], zoom: 999}));
    }
  });
  await page.goto('/?serial');
  await page.waitForFunction(() => window.ukt?.result && !document.querySelector('#btn-next').disabled, null, {timeout: 120000});
  await page.locator('[data-setup-act="ok"]').click();
  expect(await page.evaluate(() => ukt.map.getZoom())).toBeCloseTo(5.6);
  const camera = {center: [126.76, 37.61], zoom: 10.25, bearing: 12, pitch: 25};
  await page.evaluate(camera => ukt.map.jumpTo(camera), camera);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ukt-map-view')).zoom)).toBeCloseTo(camera.zoom);
  await page.reload();
  await page.waitForFunction(() => window.ukt?.map, null, {timeout: 120000});
  const restored = await page.evaluate(() => ({center: ukt.map.getCenter().toArray(), zoom: ukt.map.getZoom(),
    bearing: ukt.map.getBearing(), pitch: ukt.map.getPitch()}));
  expect(restored.center[0]).toBeCloseTo(camera.center[0], 5);
  expect(restored.center[1]).toBeCloseTo(camera.center[1], 5);
  expect(restored.zoom).toBeCloseTo(camera.zoom);
  expect(restored.bearing).toBeCloseTo(camera.bearing);
  expect(restored.pitch).toBeCloseTo(camera.pitch);
});
