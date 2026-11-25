import { chromium } from '@playwright/test';
import fs from 'node:fs';

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'release/库边秘技-试玩版.html');
const url = pathToFileURL(file).href;
const out = path.join(root, 'shots-single');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const external = [];
const errors = [];
page.on('request', request => {
  const u = request.url();
  // blob: 为 GLTFLoader 将内联字节解码后创建的本地临时 URL，非外部请求。
  if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
});
page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => {
  window.__impactPlayback = [];
  const original = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (this.buffer) window.__impactPlayback.push(this.buffer.duration);
    return original.apply(this, args);
  };
});
const started = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__creativeEight, null, { timeout: 60000 });
const bootMs = Date.now() - started;
await page.evaluate(() => window.__creativeEight.renderScale(0.5));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/01-menu.png` });

// 创意单人完整流程：抽取 → 开球摆位 → 按钮开球 → 滚动顶视 → 落定。
await page.getByRole('button', { name: '开 局' }).click();
await page.waitForSelector('.draft-option', { timeout: 60000 });
for (let i = 0; i < 3; i += 1) await page.locator('.draft-option').nth(i).click();
await page.locator('[data-confirm]').click();
await page.evaluate(() => window.__creativeEight.cancelAi());
await page.waitForFunction(() => window.__creativeEight.getState().view.traditionalFit !== null, null, { timeout: 90000 });
await page.waitForFunction(() => window.__creativeEight.getState().view.roomBackground === true, null, { timeout: 90000 });
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'breakPlacement', null, { polling: 100, timeout: 60000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/02-break-placement.png` });
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming', null, { polling: 100, timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/03-aim.png` });
// Space 按住、重复和释放都不得蓄力或触发按钮原生击球。
await page.locator('[data-strike]').focus();
const beforeSpace = await page.evaluate(() => {
  const { phase, charging, human, rule } = window.__creativeEight.getState();
  return { phase, charging, power: human.power, shots: rule.shotNumber };
});
await page.keyboard.down('Space');
await page.waitForTimeout(1500);
await page.keyboard.down('Space');
await page.keyboard.up('Space');
const afterSpace = await page.evaluate(() => {
  const { phase, charging, human, rule } = window.__creativeEight.getState();
  return { phase, charging, power: human.power, shots: rule.shotNumber };
});
const spaceDoesNotStrike = JSON.stringify(beforeSpace) === JSON.stringify(afterSpace)
  && beforeSpace.phase === 'aiming' && beforeSpace.charging === false;
if (!spaceDoesNotStrike) throw new Error('Space changed aiming/charging/power/shot state');
await page.waitForFunction(() => window.__creativeEight.audio().loadedSamples.length === 10);
await page.evaluate(() => { window.__impactPlayback = []; });
// 使用真实力度滑杆与按钮击球，Space 只用于摆位确认。
// 第十三轮摩擦 0.7、上限 10：满力度开球散开充分；随机种子下可能合法洗袋→自由球。
await page.locator('[data-power]').focus();
await page.keyboard.press('End');
await page.waitForFunction(() => window.__creativeEight.getState().human.power === 1);
await page.locator('[data-strike]').click();
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'rolling', null, { timeout: 30000 });
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'top', null, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/04-rolling-top.png` });
await page.waitForFunction(() => window.__creativeEight.getState().phase !== 'rolling', null, { timeout: 180000 });
const audio = await page.evaluate(() => window.__creativeEight.audio());
const state = await page.evaluate(() => window.__creativeEight.getState());
await page.screenshot({ path: `${out}/05-settled.png` });

// 新增歌曲须在 file:// 下逐首解码并实际播放；歌单键盘操作不能触发击球。
await page.locator('[data-playlist-open]').click();
const musicChecks = [];
for (const index of [4, 5, 6]) {
  await page.locator(`[data-track="${index}"]`).click();
  await page.waitForFunction(i => window.__creativeEight.audio().trackIndex === i && window.__creativeEight.audio().bgmPlaying, index, { timeout: 30000 });
  await page.waitForFunction(i => document.querySelector(`[data-track="${i}"] .track-state`)?.textContent === '播放中', index);
  musicChecks.push({ track: index + 1, playing: true });
}
await page.screenshot({ path: `${out}/06-playlist.png` });
await page.locator('[data-done]').click();
await page.evaluate(() => { window.__creativeEight.removeBall(3); window.__creativeEight.removeBall(12); });
await page.waitForFunction(() => document.querySelector('[data-pocketed] [data-ball-id="3"]') && document.querySelector('[data-pocketed] [data-ball-id="12"]'));
await page.screenshot({ path: `${out}/07-pocketed.png` });

const impactChecks = await page.evaluate(() => [
  { role: 'strike', duration: 0.162 },
  { role: 'collision', duration: 0.173 },
].map(clip => ({
  ...clip,
  played: window.__impactPlayback.some(duration => Math.abs(duration - clip.duration) < .0002),
})));
// 返回主菜单不刷新，旧局清理且保留当前歌曲，再次开局仍完整。
await page.evaluate(() => { document.body.dataset.offlineDocument = 'retained'; });
await page.locator('[data-exit]').click();
await page.screenshot({ path: `${out}/08-exit-confirm.png` });
await page.locator('[data-exit-confirm]').click();
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'menu');
const returnToMenu = await page.evaluate(() => {
  const state = window.__creativeEight.getState();
  const music = window.__creativeEight.audio();
  return document.body.dataset.offlineDocument === 'retained' && state.elapsedMs === 0
    && state.rule.shotNumber === 0 && state.fake === null && music.trackIndex === 6 && music.bgmPlaying;
});
await page.getByRole('button', { name: '开 局' }).click();
for (let i = 0; i < 3; i++) await page.locator('.draft-option').nth(i).click();
await page.locator('[data-confirm]').click();
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'breakPlacement');
const restartFresh = await page.evaluate(() => {
  const state = window.__creativeEight.getState();
  return state.rule.shotNumber === 0 && state.simulation.balls.filter(ball => ball.onTable).length === 16
    && state.skills[0].length === 3 && state.skills[0].every(skill => skill.remainingUses === 1);
});
if (!returnToMenu || !restartFresh) throw new Error('Offline menu/restart lifecycle failed');
const report = {
  bootMs,
  returnToMenu,
  restartFresh,
  spaceDoesNotStrike,
  impactChecks,
  musicChecks,
  pocketedDisplay: true,
  sizeMB: +(fs.statSync(file).size / 1024 / 1024).toFixed(1),
  phase: state.phase,
  loadedSamples: audio.loadedSamples,
  bgmPlaying: audio.bgmPlaying,
  external,
  errors,
};
fs.writeFileSync(`${out}/single-file-report.json`, JSON.stringify(report, null, 2));
console.log('SINGLE FILE VERIFY', JSON.stringify(report));
await browser.close();
if (external.length || errors.length || !audio.bgmPlaying || audio.loadedSamples.length !== 10 || musicChecks.length !== 3
  || !spaceDoesNotStrike || impactChecks.some(clip => !clip.played)) process.exit(1);