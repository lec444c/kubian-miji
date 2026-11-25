import { chromium } from '@playwright/test';
// 目标地址默认指向本机预览；局域网验证时用 SMOKE_URL=http://<本机局域网IP>:4173/ 覆盖。
const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:4173/';
// 待更新：下方击球流程仍按第十五轮之前的「空格蓄力」编写。现行版本瞄准阶段空格只用于摆位确认，
// 不会蓄力或击球，因此脚本会停在等待 rolling 一步；复用前需改为鼠标左键后拖蓄力、松开击球。
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.locator('[data-field="mode"] [data-value="classic"]').click();
await page.locator('[data-field="playMode"] [data-value="practice"]').click();
await page.getByRole('button', { name: '开 局' }).click();
await page.evaluate(() => window.__creativeEight.cancelAi());
await page.waitForFunction(() => {
  const view = window.__creativeEight.getState().view;
  const fit = view.traditionalFit ?? view.tableFit;
  return fit !== null && Math.abs(fit.clothTopY - 0.79) < 0.01;
}, null, { timeout: 45000 });
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'breakPlacement', null, { timeout: 15000 });
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'top', null, { timeout: 15000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming', null, { polling: 100, timeout: 15000 });
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'aim', null, { timeout: 15000 });
await page.keyboard.down('Space');
// 第十二轮摩擦 0.7：满蓄力（1.35s）开球满足“四颗目标球碰库”且散开充分。
await page.waitForTimeout(1400);
await page.keyboard.up('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'rolling', null, { timeout: 15000 });
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'top', null, { timeout: 15000 });
await page.screenshot({ path: process.env.SMOKE_SHOT ?? 'shots-refine/08-lan-smoke.png' });
const state = await page.evaluate(() => {
  const view = window.__creativeEight.getState().view;
  return { phase: window.__creativeEight.getState().phase, mode: view.camera.mode, clothTopY: (view.traditionalFit ?? view.tableFit)?.clothTopY, traditional: view.traditionalFit !== null, room: view.roomBackground };
});
console.log('LAN SMOKE OK', JSON.stringify(state), 'pageErrors=', errors.length);
await browser.close();