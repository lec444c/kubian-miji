import { chromium } from '@playwright/test';
const OUT = 'D:/game race/shots-refine';
const BASE = 'http://127.0.0.1:4173';
async function confirmDraft(page, n) {
  const options = page.locator('.draft-option');
  await options.first().waitFor({ state: 'visible', timeout: 15000 });
  for (let i = 0; i < n; i++) await options.nth(i).click();
  await page.locator('[data-confirm]').click();
}
async function start(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await confirmDraft(page, 3); await confirmDraft(page, 3);
  await page.locator('[data-skills="0"] .skill-card').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate(() => window.__creativeEight.cancelAi());
  await page.waitForFunction(() => Math.abs((window.__creativeEight.getState().view.tableFit?.clothTopY ?? 0) - 0.79) < 0.01, null, { timeout: 20000 });
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Settled top view with balls resting exactly on the cushion nose centres.
await start(page);
await page.evaluate(() => {
  const d = window.__creativeEight;
  d.setBall(1, { x: 1.1807, y: 0 }); d.setBall(2, { x: -1.1807, y: 0.1 });
  d.setBall(3, { x: 0.3, y: 0.5479 }); d.setBall(4, { x: -0.3, y: -0.5479 });
});
await page.keyboard.press('KeyC'); await page.keyboard.press('KeyC');
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'top', null, { timeout: 15000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/02-cushion-top.png` });
console.log('02 settled top', await page.evaluate(() => window.__creativeEight.getState().view.camera.position));

// Hairdryer captured while braking is still active.
await start(page);
await page.evaluate(() => { const d = window.__creativeEight; d.setCurrentPlayer(1); d.strike(Math.PI, 0.5); });
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'rolling', null, { timeout: 15000 });
await page.evaluate(() => window.__creativeEight.useSkill(0, 'hairdryer', 0));
await page.waitForFunction(() => window.__creativeEight.getState().simulation.braking.length > 0, null, { timeout: 15000 });
await page.waitForTimeout(250);
const braking = await page.evaluate(() => window.__creativeEight.getState().simulation.braking);
await page.screenshot({ path: `${OUT}/05-hairdryer.png` });
console.log('05 hairdryer brakingAtCapture=', JSON.stringify(braking));
await browser.close();
console.log('DONE2');