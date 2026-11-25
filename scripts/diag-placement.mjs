import { chromium } from '@playwright/test';

const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const state = () => page.evaluate(() => {
  const s = window.__creativeEight.getState();
  return { phase: s.phase, seat: s.rule.currentPlayer, bih: s.rule.ballInHand, cursor: s.placementCursor, fake: s.fake && { status: s.fake.status, ms: s.fake.elapsedMs }, elapsed: s.elapsedMs };
});

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.evaluate(() => window.__creativeEight.renderScale(0.6));
await page.waitForTimeout(2500);
await page.getByRole('button', { name: '开 局' }).click();
await page.waitForSelector('.draft-option', { timeout: 30000 });
for (let i = 0; i < 3; i += 1) await page.locator('.draft-option').nth(i).click();
await page.locator('[data-confirm]').click();
await page.evaluate(() => { window.__creativeEight.cancelAi(); window.__creativeEight.reducedMotion(true); });
await page.waitForFunction(() => window.__creativeEight.getState().view.traditionalFit !== null, null, { timeout: 45000 });
await page.waitForFunction(() => window.__creativeEight.getState().view.roomBackground === true, null, { timeout: 45000 });
await page.locator('[data-skills="0"] .skill-card').filter({ hasText: '假自由球' }).click();
console.log('after click', JSON.stringify(await state()));
await page.evaluate(() => window.__creativeEight.advanceTime(10_100));
console.log('after advance', JSON.stringify(await state()));
await page.waitForTimeout(1000);
console.log('advance+1s', JSON.stringify(await state()));
await page.keyboard.press('d');
await page.keyboard.press('s');
await page.waitForTimeout(600);
await page.keyboard.press('Enter');
console.log('after enter', JSON.stringify(await state()));
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(500);
  const s = await state();
  if (i % 4 === 0 || s.phase === 'aiming') console.log(`t+${(i + 1) * 0.5}s`, JSON.stringify(s));
  if (s.phase === 'aiming' && i > 2) break;
}
console.log('pageErrors=', errors.length, errors.slice(0, 3));
await browser.close();