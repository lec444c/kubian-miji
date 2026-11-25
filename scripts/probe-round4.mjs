import { chromium } from '@playwright/test';
import fs from 'node:fs';

const out = 'D:/game race/shots-probe';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
await page.goto('http://127.0.0.1:4173');
await page.evaluate(() => window.__creativeEight.renderScale(0.5));
await page.waitForTimeout(2000);
await page.getByRole('button', { name: '开 局' }).click();
await page.waitForSelector('.draft-option', { timeout: 30000 });
for (let i = 0; i < 3; i += 1) await page.locator('.draft-option').nth(i).click();
await page.locator('[data-confirm]').click();
await page.evaluate(() => window.__creativeEight.cancelAi());
await page.waitForFunction(() => window.__creativeEight.getState().view.traditionalFit !== null, null, { timeout: 45000 });
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming', null, { timeout: 45000 });
await page.waitForTimeout(2500);
const report = await page.evaluate(() => ({
  nodes: window.__creativeEight.nodeReport().filter(entry => /cue|ball-0|traditional-table/.test(entry.name)),
  camera: window.__creativeEight.getState().view.camera,
}));
fs.writeFileSync(`${out}/round4-cue-report.json`, JSON.stringify(report, null, 2));
console.log('CAMERA', JSON.stringify(report.camera));
for (const entry of report.nodes) console.log(entry.name, entry.visible, entry.min.map(v => +v.toFixed(3)), entry.max.map(v => +v.toFixed(3)));
await page.screenshot({ path: `${out}/probe4-aim.png` });
await page.keyboard.press('o');
await page.waitForTimeout(2200);
await page.screenshot({ path: `${out}/probe4-orbit.png` });
const orbitReport = await page.evaluate(() => window.__creativeEight.nodeReport().filter(entry => /cue-group|ball-0/.test(entry.name)));
for (const entry of orbitReport) console.log('ORBIT', entry.name, entry.min.map(v => +v.toFixed(3)), entry.max.map(v => +v.toFixed(3)));
await page.keyboard.press('o');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/probe4-top.png` });
console.log('PROBE4 pageErrors=', pageErrors.length, pageErrors);
await browser.close();