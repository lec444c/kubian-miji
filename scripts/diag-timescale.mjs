import { chromium } from '@playwright/test';

// 诊断第九轮慢放比例测量：在 e2e 同等条件（chrome、renderScale 0.4、1280x800）下
// 测滚动帧率，并分别计算「全部帧」与「仅未钳制帧（delta<0.25）」的墙钟/物理步比例。
// 低帧率时 Math.min(0.25, delta) 钳制会让全部帧比例失真；未钳制帧比例才等于 1/0.85。
const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.evaluate(() => window.__creativeEight?.renderScale(0.4));
await page.locator('[data-field="mode"] [data-value="classic"]').click();
await page.locator('[data-field="playMode"] [data-value="practice"]').click();
await page.getByRole('button', { name: '开 局' }).click();
await page.evaluate(() => window.__creativeEight.cancelAi());
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'breakPlacement', null, { timeout: 30000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming', null, { timeout: 30000 });
await page.evaluate(() => {
  const d = window.__creativeEight;
  for (let id = 1; id <= 15; id += 1) d.removeBall(id);
  d.setBall(0, { x: -0.5, y: 0 });
  d.aim(0);
});
const box = await page.locator('[data-spin-face]').boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.locator('[data-power]').evaluate(input => { input.value = '15'; input.dispatchEvent(new Event('input', { bubbles: true })); });
await page.evaluate(() => {
  window.__diag = { frames: [], t0: null, t1: null, s0: 0, s1: 0, last: null, lastStep: 0 };
  const tick = () => {
    const state = window.__creativeEight.getState();
    const r = window.__diag;
    const now = performance.now();
    if (state.phase === 'rolling') {
      if (r.t0 === null) { r.t0 = now; r.s0 = state.simulation.step; r.last = now; r.lastStep = state.simulation.step; }
      else {
        const dt = (now - r.last) / 1000;
        const ds = state.simulation.step - r.lastStep;
        r.frames.push({ dt, ds, clamped: dt >= 0.2499 });
        r.last = now; r.lastStep = state.simulation.step;
      }
    } else if (r.t0 !== null && r.t1 === null) { r.t1 = now; r.s1 = state.simulation.step; }
    if (r.t1 === null) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.locator('[data-strike]').click();
await page.waitForFunction(() => window.__diag?.t1 != null, null, { timeout: 90000 });
const out = await page.evaluate(() => {
  const r = window.__diag;
  const simMsAll = (r.s1 - r.s0) * (1000 / 512);
  const ratioAll = (r.t1 - r.t0) / simMsAll;
  let wallU = 0, simU = 0, clamped = 0;
  for (const f of r.frames) { if (f.clamped) clamped += 1; else { wallU += f.dt; simU += f.ds * (1 / 512); } }
  const ratioUnclamped = simU > 0 ? wallU / simU : null;
  // 清洁窗口：剔除钳制帧及其前后 3 帧（停顿边界 ds/dt 错位），再裁掉首尾各 3 帧。
  const bad = new Set();
  r.frames.forEach((f, i) => { if (f.clamped) for (let k = i - 3; k <= i + 3; k += 1) bad.add(k); });
  let wallC = 0, simC = 0, nC = 0;
  r.frames.forEach((f, i) => { if (i < 3 || i >= r.frames.length - 3 || bad.has(i)) return; wallC += f.dt; simC += f.ds * (1 / 512); nC += 1; });
  const ratioClean = simC > 0 ? wallC / simC : null;
  const fps = r.frames.length / ((r.t1 - r.t0) / 1000);
  const cue = window.__creativeEight.getState().simulation.balls.find(b => b.id === 0);
  const samples = r.frames.filter(f => !f.clamped).slice(20, 32).map(f => ({ dtMs: Math.round(f.dt * 10000) / 10, ds: f.ds, instRatio: f.ds > 0 ? Math.round((f.dt / (f.ds / 512)) * 1000) / 1000 : null }));
  return { totalFrames: r.frames.length, clamped, fps: Math.round(fps * 10) / 10, simMsAll: Math.round(simMsAll), ratioAll: Math.round(ratioAll * 1000) / 1000, ratioUnclamped: ratioUnclamped == null ? null : Math.round(ratioUnclamped * 1000) / 1000, ratioClean: ratioClean == null ? null : Math.round(ratioClean * 1000) / 1000, cleanFrames: nC, unclampedSimMs: Math.round(simU * 1000), cueX: Math.round(cue.position.x * 1000) / 1000, samples };
});
console.log('TIMESCALE DIAG', JSON.stringify(out), 'pageErrors=', errors.length, errors.slice(0, 3));
await browser.close();