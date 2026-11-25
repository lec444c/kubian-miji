// 视觉取证：传统球桌组内每个网格的世界包围盒 + 顶视/瞄准对照截图。
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const OUT = 'D:/game race/shots-probe';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
await page.goto('http://127.0.0.1:4173/');
await page.evaluate(() => window.__creativeEight.renderScale(0.5));
await page.locator('[data-field="mode"] [data-value="classic"]').click();
await page.locator('[data-field="playMode"] [data-value="practice"]').click();
await page.getByRole('button', { name: '开 局' }).click();
await page.evaluate(() => window.__creativeEight.cancelAi());
await page.waitForFunction(() => window.__creativeEight.getState().view.traditionalFit !== null, null, { timeout: 60_000 });
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming', null, { timeout: 60_000 });
await page.waitForTimeout(2500);

const report = await page.evaluate(() => window.__creativeEight.nodeReport());
fs.writeFileSync(`${OUT}/node-report.json`, JSON.stringify(report, null, 2));
console.log('NODE REPORT');
for (const node of report) console.log(node.name, node.visible ? 'vis' : 'HID', JSON.stringify(node.min), JSON.stringify(node.max));

await page.screenshot({ path: `${OUT}/probe-aim.png` });
for (const [label, x, y] of [['post', 540, 560], ['beam', 720, 420], ['foot', 540, 650], ['cloth', 720, 560], ['plank', 350, 520]]) {
  console.log('RAY', label, JSON.stringify(await page.evaluate(([px, py]) => window.__creativeEight.raycastAt(px, py), [x, y])));
}
const meshName = report.find(node => node.name.startsWith('mesh#0'))?.name;
if (meshName) {
  await page.evaluate(n => window.__creativeEight.setNodeVisible(n, false), meshName);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/probe-aim-nomesh.png` });
  await page.evaluate(n => window.__creativeEight.setNodeVisible(n, true), meshName);
  await page.waitForTimeout(400);
}
await page.keyboard.press('o');
await page.keyboard.press('o');
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'top', null, { timeout: 30_000 });
await page.waitForTimeout(3500);
console.log('TOP CAMERA', JSON.stringify(await page.evaluate(() => window.__creativeEight.getState().view.camera)));
await page.screenshot({ path: `${OUT}/probe-top.png` });
await page.evaluate(() => window.__creativeEight.setNodeVisible('traditional-table', false));
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/probe-top-notable.png` });
await page.evaluate(() => window.__creativeEight.setNodeVisible('traditional-table', true));
await page.keyboard.press('z');
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'aim', null, { timeout: 30_000 });
await page.waitForTimeout(2500);
// 隐藏传统组内疑似球杆/吊灯的网格后再拍瞄准视角
const suspects = report.filter(node => node.name.startsWith('mesh#') && !node.name.includes('pool_table_mat')).map(node => node.name);
for (const name of suspects) await page.evaluate(n => window.__creativeEight.setNodeVisible(n, false), name);
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/probe-aim-clean.png` });
console.log('SUSPECTS HIDDEN', JSON.stringify(suspects));
console.log('PROBE OK pageErrors=', pageErrors.length, pageErrors.slice(0, 5));
await browser.close();