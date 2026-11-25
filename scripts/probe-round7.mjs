// Round 7 visual probe: rail-side reverse aim must stay inside the room shell.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.goto('http://127.0.0.1:4173/');
await page.locator('[data-field="mode"] [data-value="classic"]').click();
await page.locator('[data-field="playMode"] [data-value="practice"]').click();
await page.getByRole('button', { name: '开 局' }).click();
await page.evaluate(() => window.__creativeEight.cancelAi());
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'breakPlacement');
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming');
await page.evaluate(() => {
  window.__creativeEight.setBall(0, { x: 1.1, y: 0.5 });
  window.__creativeEight.aim(Math.PI);
});
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const state = window.__creativeEight.getState();
  return { camera: state.view.camera.position, mode: state.view.camera.mode, roomBackground: state.view.roomBackground };
});
console.log('CLAMP', JSON.stringify(info), 'pageErrors=', errors.length, errors);
await page.screenshot({ path: 'shots-round7/12-aim-rail-clamp-full.png' });
// Cut-shot guides in top view at full quality.
await page.evaluate(() => {
  window.__creativeEight.setBall(0, { x: -0.5, y: 0 });
  window.__creativeEight.setBall(1, { x: 0.3, y: 0.05 });
  window.__creativeEight.aim(0);
});
await page.keyboard.press('o');
await page.keyboard.press('o');
await page.waitForTimeout(2000);
const lines = await page.evaluate(() => window.__creativeEight.nodeReport().filter(node => ['aim-line', 'target-line', 'ghost-ball', 'deflection-line'].includes(node.name)));
console.log('GUIDES', JSON.stringify(lines));
await page.screenshot({ path: 'shots-round7/13-guides-top-full.png' });
// 360° mouse aim must work in every camera mode (top / orbit / aim).
const aimInMode = async (label) => {
  await page.mouse.move(800, 450);
  const before = await page.evaluate(() => window.__creativeEight.getState().human.angle);
  await page.mouse.move(1000, 450, { steps: 5 });
  const after = await page.evaluate(() => window.__creativeEight.getState().human.angle);
  const mode = await page.evaluate(() => window.__creativeEight.getState().view.camera.mode);
  console.log('AIM360', label, mode, 'delta=', (after - before).toFixed(4));
};
await aimInMode('top');
await page.keyboard.press('c');
await page.waitForTimeout(1200);
await aimInMode('orbit');
await page.keyboard.press('c');
await page.waitForTimeout(1200);
await aimInMode('aim');
// Full 360°+ sweep via mouse: two forward sweeps, repositioning while locked.
await page.mouse.move(200, 450);
await page.evaluate(() => window.__creativeEight.aim(0));
await page.mouse.move(1500, 450, { steps: 40 });
const first = await page.evaluate(() => window.__creativeEight.getState().human.angle);
await page.mouse.click(1500, 450, { button: 'right' });
await page.mouse.move(200, 450);
await page.mouse.click(200, 450, { button: 'right' });
await page.evaluate(angle => window.__creativeEight.aim(angle), first);
await page.mouse.move(1500, 450, { steps: 40 });
const swept = await page.evaluate(() => window.__creativeEight.getState().human.angle);
console.log('SWEEP first=', first.toFixed(3), 'total=', swept.toFixed(3), 'turns=', (swept / (2 * Math.PI)).toFixed(2));
await browser.close();