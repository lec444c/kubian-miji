import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'D:/game race/shots-refine';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:4173';

async function confirmDraft(page, n) {
  const options = page.locator('.draft-option');
  await options.first().waitFor({ state: 'visible', timeout: 15000 });
  for (let i = 0; i < n; i++) await options.nth(i).click();
  await page.locator('[data-confirm]').click();
}

async function startCreativePractice(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await confirmDraft(page, 3);
  await confirmDraft(page, 3);
  await page.locator('[data-skills="0"] .skill-card').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate(() => { window.__creativeEight.cancelAi(); });
  await page.waitForFunction(() => Math.abs((window.__creativeEight.getState().view.tableFit?.clothTopY ?? 0) - 0.79) < 0.01, null, { timeout: 20000 });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));

// 1. First-person aiming view with the enlarged table.
await startCreativePractice(page);
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'aim', null, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/01-aim-firstperson.png` });
console.log('shot 01 aim', await page.evaluate(() => window.__creativeEight.getState().view.camera));

// 2. Top view: balls placed exactly at the cushion nose centres must not penetrate.
await page.evaluate(() => {
  const d = window.__creativeEight;
  d.setBall(1, { x: 1.1807, y: 0 });
  d.setBall(2, { x: -1.1807, y: 0.1 });
  d.setBall(3, { x: 0.3, y: 0.5479 });
  d.setBall(4, { x: -0.3, y: -0.5479 });
});
await page.keyboard.press('KeyC'); // aim -> orbit
await page.keyboard.press('KeyC'); // orbit -> top
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'top', null, { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/02-cushion-top.png` });
console.log('shot 02 top');

// 3. Delayed camera: strike, hold first-person ~1s, then orbit after 2s.
await page.evaluate(() => { const d = window.__creativeEight; d.setCurrentPlayer(1); d.strike(0, 0.6); });
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'rolling', null, { timeout: 15000 });
await page.waitForTimeout(900);
const modeEarly = await page.evaluate(() => window.__creativeEight.getState().view.camera.mode);
await page.screenshot({ path: `${OUT}/03-rolling-firstperson.png` });
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'orbit', null, { timeout: 15000 });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/04-rolling-orbit.png` });
console.log('shot 03/04 rolling earlyMode=', modeEarly, 'lateMode=', await page.evaluate(() => window.__creativeEight.getState().view.camera.mode));

// 4. Hairdryer: enlarged model + brighter wind on a moving ball.
await startCreativePractice(page);
await page.evaluate(() => { const d = window.__creativeEight; d.setCurrentPlayer(1); d.strike(0, 0.7); });
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'rolling', null, { timeout: 15000 });
await page.evaluate(() => window.__creativeEight.useSkill(0, 'hairdryer', 0));
await page.waitForFunction(() => window.__creativeEight.getState().simulation.braking.length > 0, null, { timeout: 15000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/05-hairdryer.png` });
console.log('shot 05 hairdryer braking=', await page.evaluate(() => window.__creativeEight.getState().simulation.braking));

// 5. Fullscreen skill announcement for hand micro-adjustment.
await startCreativePractice(page);
await page.evaluate(() => {
  const d = window.__creativeEight;
  d.setGroups(0, 'solids');
  d.setBall(1, { x: 0.3, y: 0.545 });
  d.setCurrentPlayer(1);
});
await page.evaluate(() => window.__creativeEight.useSkill(0, 'hand', 1));
await page.locator('.skill-announce').waitFor({ state: 'visible', timeout: 15000 });
await page.screenshot({ path: `${OUT}/06-skill-announce.png` });
console.log('shot 06 announce text=', await page.locator('.skill-announce').innerText());

// 6. Fake free ball: no countdown element and no announcement.
await startCreativePractice(page);
await page.evaluate(() => window.__creativeEight.useSkill(0, 'fakeFreeBall'));
await page.waitForFunction(() => window.__creativeEight.getState().rule.currentPlayer === 1, null, { timeout: 15000 });
await page.waitForTimeout(800);
const fakeTimerCount = await page.locator('.fake-timer').count();
const announceCount = await page.locator('.skill-announce').count();
await page.screenshot({ path: `${OUT}/07-fake-freeball.png` });
console.log('shot 07 fake fakeTimerCount=', fakeTimerCount, 'announceCount=', announceCount, 'status=', await page.evaluate(() => window.__creativeEight.getState().fake?.status));

await browser.close();
console.log('DONE');