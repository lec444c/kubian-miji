import { chromium } from '@playwright/test';

const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const measure = ms => page.evaluate(duration => new Promise(resolve => {
  let frames = 0;
  const start = performance.now();
  const tick = () => {
    frames += 1;
    if (performance.now() - start < duration) requestAnimationFrame(tick);
    else resolve(Math.round(frames / ((performance.now() - start) / 1000)));
  };
  requestAnimationFrame(tick);
}), ms);

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.getByRole('button', { name: '开 局' }).click();
await page.waitForSelector('.draft-option', { timeout: 30000 });
for (let i = 0; i < 3; i += 1) await page.locator('.draft-option').nth(i).click();
await page.locator('[data-confirm]').click();
await page.evaluate(() => window.__creativeEight.cancelAi());
await page.waitForFunction(() => window.__creativeEight.getState().view.traditionalFit !== null, null, { timeout: 60000 });
await page.waitForFunction(() => window.__creativeEight.getState().view.roomBackground === true, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'breakPlacement', null, { polling: 100, timeout: 30000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming', null, { polling: 100, timeout: 30000 });
await page.waitForTimeout(1200);
const aimFps = await measure(4000);
await page.keyboard.down('Space');
// 第十二轮摩擦 0.7：满蓄力开球满足“四颗目标球碰库”且散开充分，滚动窗口也更完整。
await page.waitForTimeout(1400);
await page.keyboard.up('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'rolling', null, { polling: 100, timeout: 20000 });
const rollFps = await measure(4000);
console.log('FPS 1080p default quality (headless software GL):', JSON.stringify({ aimFps, rollFps }), 'pageErrors=', errors.length, errors.slice(0, 3));
await browser.close();