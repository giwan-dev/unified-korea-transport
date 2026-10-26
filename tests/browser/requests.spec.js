import {test, expect} from '@playwright/test';

test('expansion requests exclude maxed-out Hanam-daero and retain actionable roads', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('ukt-guide-mode', 'off');
    localStorage.setItem('ukt-lang', 'ko');
  });
  await page.goto('/?serial');
  await page.waitForFunction(() => window.ukt?.result && !document.querySelector('#btn-next').disabled, null, {timeout: 120000});
  await page.locator('[data-setup-act="ok"]').click();
  await page.locator('[data-tab="requests"]').click();
  const panel = page.locator('[data-panel="requests"]');
  await expect(panel).not.toContainText('하남대로');
  const requests = panel.locator('.item').filter({has: page.locator('[data-goto]')});
  expect(await requests.count()).toBeGreaterThan(0);
  expect(await requests.locator('[data-fix]').count()).toBe(await requests.count());
  const count = await page.evaluate(() => ukt.requests.length);
  await expect(page.locator('#req-count')).toHaveText(String(count));
  await expect(panel.locator('[data-req-side="all"]')).toHaveText(`전체 ${count}`);
  await page.screenshot({path: 'test-results/requests.png'});
});
