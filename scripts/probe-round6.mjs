import { chromium } from '@playwright/test';
import fs from 'node:fs';

const out = 'D:/game race/shots-round6';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
await page.goto('http://127.0.0.1:4173');
await page.evaluate(() => window.__creativeEight.renderScale(0.6));
await page.waitForTimeout(2000);
await page.locator('[data-field="mode"] [data-value="classic"]').click();
await page.locator('[data-field="playMode"] [data-value="practice"]').click();
await page.getByRole('button', { name: '开 局' }).click();
await page.waitForFunction(() => window.__creativeEight.getState().view.traditionalFit !== null, null, { timeout: 45000 });
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'breakPlacement', null, { polling: 100, timeout: 45000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming', null, { polling: 100, timeout: 45000 });
await page.waitForTimeout(1500);

// Case A: default break aim at the full rack — the amber object-ball guide
// must remain readable from the top view even across the packed balls.
await page.evaluate(() => window.__creativeEight.aim(0));
await page.keyboard.press('o');
await page.keyboard.press('o');
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'top', null, { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/09-target-line-rack-top.png` });
await page.screenshot({ path: `${out}/09b-rack-crop.png`, clip: { x: 860, y: 330, width: 420, height: 260 } });
console.log('LINES-A', JSON.stringify(await page.evaluate(() => window.__creativeEight.nodeReport().filter(entry => entry.name.includes('target-line') || entry.name.includes('aim-line')))));

// Case B: isolated object ball — guide visible from top and first-person aim.
await page.evaluate(() => {
  for (const id of [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]) window.__creativeEight.removeBall(id);
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/10-target-line-isolated-top.png` });
await page.screenshot({ path: `${out}/10b-isolated-crop.png`, clip: { x: 860, y: 330, width: 420, height: 260 } });
console.log('LINES-B', JSON.stringify(await page.evaluate(() => window.__creativeEight.nodeReport().filter(entry => entry.name.includes('target-line') || entry.name.includes('aim-line')))));
await page.keyboard.press('z');
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'aim', null, { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/11-target-line-isolated-aim.png` });

console.log('PROBE6', JSON.stringify({ pageErrors }));
await browser.close();
if (pageErrors.length) process.exit(1);