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
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'breakPlacement', null, { polling: 100, timeout: 45000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming', null, { polling: 100, timeout: 45000 });
await page.waitForTimeout(2500);

// Confirm the visible cue is the new cc0 GLB (material CueStick), not the
// reference fallback or the old table-extracted cue.
const cueNodes = await page.evaluate(() => window.__creativeEight.nodeReport().filter(entry => /cue-mesh#\d+:/.test(entry.name)));
console.log('CUE MATERIALS', JSON.stringify(cueNodes.map(entry => entry.name)));
const usesCc0 = cueNodes.some(entry => entry.name.includes('CueStick'));

const readAim = () => page.evaluate(() => window.__creativeEight.cueAim());
const check = (label, aim) => {
  const ok = aim && aim.alignment < 1e-3 && aim.gap >= 0.006 && aim.railClearance >= -1e-6;
  console.log(label, JSON.stringify({
    alignment: +aim.alignment.toFixed(5), gap: +aim.gap.toFixed(5),
    railClearance: +aim.railClearance.toFixed(5), visible: aim.visible, ok,
  }));
  return ok;
};

let allOk = usesCc0;
// Default break aim + a sweep of angles at the normal cue-ball spot.
for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  await page.evaluate(a => window.__creativeEight.aim(a), angle);
  await page.waitForTimeout(350);
  allOk = check(`aim angle=${angle.toFixed(2)}`, await readAim()) && allOk;
}
// Frozen-to-left-rail: butt must bridge steeply over the rail cap.
await page.evaluate(() => window.__creativeEight.setBall(0, { x: -1.1807, y: 0 }));
await page.evaluate(() => window.__creativeEight.aim(0));
await page.waitForTimeout(400);
const frozen = await readAim();
allOk = check('frozen-left-rail', frozen) && allOk;
allOk = frozen.gap > 0.05 && allOk;
// Frozen corner aiming diagonally out.
await page.evaluate(() => window.__creativeEight.setBall(0, { x: -1.1807, y: -0.5479 }));
await page.evaluate(() => window.__creativeEight.aim(Math.PI / 4));
await page.waitForTimeout(400);
allOk = check('frozen-corner', await readAim()) && allOk;

// Restore a clean break position for the visual screenshots.
await page.evaluate(() => window.__creativeEight.setBall(0, { x: -0.6, y: 0 }));
await page.evaluate(() => window.__creativeEight.aim(0));
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/probe5-aim.png` });
await page.keyboard.press('o');
await page.waitForTimeout(2200);
await page.screenshot({ path: `${out}/probe5-orbit.png` });
await page.keyboard.press('o');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/probe5-top.png` });

const report = { usesCc0, allOk, pageErrors };
fs.writeFileSync(`${out}/round5-cue-report.json`, JSON.stringify(report, null, 2));
console.log('PROBE5', JSON.stringify(report));
await browser.close();
if (!allOk || pageErrors.length) process.exit(1);