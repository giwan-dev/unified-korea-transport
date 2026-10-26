import {test, expect} from '@playwright/test';

test('accordion state survives internal buttons, selects and a reload independently', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('ukt-guide-mode', 'off');
    localStorage.setItem('ukt-lang', 'ko');
  });
  await page.goto('/?serial');
  await page.waitForFunction(() => window.ukt?.result && !document.querySelector('#btn-next').disabled, null, {timeout: 120000});
  await page.locator('[data-setup-act="ok"]').click();
  await page.locator('[data-tab="ops"]').click();
  const panel = page.locator('[data-panel="ops"]');
  const air = panel.locator('details.fold').filter({has: page.locator(':scope > summary', {hasText: /^항공$/})});
  const economics = panel.locator('details.fold').filter({has: page.locator(':scope > summary', {hasText: '영업계수 · 노선 정리'})});
  // Keep the last section closed while changing an earlier section.
  await air.locator(':scope > summary').click();
  await economics.locator(':scope > summary').click();
  await economics.locator(':scope > summary').click();
  await expect(economics).toHaveAttribute('open', '');
  await economics.locator('[data-econ="filter:metro"]').click();
  await expect(economics).toHaveAttribute('open', '');
  await expect(air).not.toHaveAttribute('open');
  await expect(economics.locator('[data-econ="filter:metro"]')).toHaveClass(/on/);
  const frequency = economics.locator('[data-freq]').first();
  const line = await frequency.getAttribute('data-freq');
  await frequency.selectOption('0.5');
  await expect(economics).toHaveAttribute('open', '');
  await expect(air).not.toHaveAttribute('open');
  expect(await page.evaluate(line => ukt.state.lineFreq[line], line)).toBe(0.5);
  await page.screenshot({path: 'test-results/accordion.png'});
  await page.reload();
  await page.waitForFunction(() => window.ukt?.result && !document.querySelector('#btn-next').disabled, null, {timeout: 120000});
  await page.locator('[data-tab="ops"]').click();
  await expect(economics).toHaveAttribute('open', '');
  await expect(air).not.toHaveAttribute('open');
  // A deliberate header click still closes the section and saves that state.
  await economics.locator(':scope > summary').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ukt-folds-v2'))['ops:영업계수 · 노선 정리'])).toBe(false);
  await page.locator('[data-tab="settings"]').click();
  await page.locator('[data-tab="ops"]').click();
  await expect(economics).not.toHaveAttribute('open');
});
