import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/** 表现层时间缩放的墙钟比例验证（2026-11-25 起为原速 1.0）。
 *  必须用真实 Chrome（高帧率）：软件渲染约 1 FPS 会触发每帧 0.25s 的 delta 钳制，
 *  墙钟/物理步比例不再等于 1/PRESENTATION_TIME_SCALE，无法据此断言慢放系数。
 *  channel 只能放在文件顶层（describe 内会强制新 worker，Playwright 禁止）。
 *
 *  测量陷阱（第十轮诊断 scripts/diag-timescale.mjs 钉住）：滚动起始常有一次着色器编译/
 *  GC 停顿（约 0.8s 墙钟），游戏把该帧 delta 钳到 0.25s，但记录器看到的是真实墙钟间隔。
 *  直接用「总墙钟/总物理步」会被这一帧污染（实测 1.5 而非 1.176）；停顿边界帧的
 *  ds/dt 也会错位。正解：逐帧记录 dt/ds，剔除钳制帧及其前后 3 帧、再裁首尾各 3 帧，
 *  在清洁稳态窗口上求和比值 → 原速下应稳定在 1.0（旧慢放 0.85 时为 1.176）。 */
test.use({ channel: 'chrome' });

declare global {
  interface Window {
    __r9?: {
      frames: { dt: number; ds: number; clamped: boolean }[];
      t0: number | null; t1: number | null; s0: number; s1: number;
      last: number; lastStep: number;
    };
  }
}

async function startClassicPractice(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await page.evaluate(() => window.__creativeEight!.cancelAi());
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('breakPlacement');
  await page.keyboard.press('Space');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode)).toBe('aim');
}

const readCue = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const ball = window.__creativeEight!.getState().simulation.balls.find(item => item.id === 0)!;
    return { x: ball.position.x, y: ball.position.y };
  });

test('球按原速滚动：清洁窗口墙钟/物理步比例≈1.0，停点距离不变', async ({ page }) => {
  test.setTimeout(120_000);
  await startClassicPractice(page);
  await page.evaluate(() => {
    const debug = window.__creativeEight!;
    for (let id = 1; id <= 15; id += 1) debug.removeBall(id);
    debug.setBall(0, { x: -0.5, y: 0 });
    debug.aim(0);
  });
  const box = (await page.locator('[data-spin-face]').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.locator('[data-power]').evaluate((input: HTMLInputElement) => {
    input.value = '15';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // 逐帧记录 rolling 期间的墙钟间隔 dt 与物理步增量 ds，标记钳制帧（dt≥0.25s）。
  await page.evaluate(() => {
    window.__r9 = { frames: [], t0: null, t1: null, s0: 0, s1: 0, last: 0, lastStep: 0 };
    const tick = (): void => {
      const state = window.__creativeEight!.getState();
      const record = window.__r9!;
      const now = performance.now();
      if (state.phase === 'rolling') {
        if (record.t0 === null) {
          record.t0 = now; record.s0 = state.simulation.step;
          record.last = now; record.lastStep = state.simulation.step;
        } else {
          const dt = (now - record.last) / 1000;
          const ds = state.simulation.step - record.lastStep;
          record.frames.push({ dt, ds, clamped: dt >= 0.2499 });
          record.last = now; record.lastStep = state.simulation.step;
        }
      } else if (record.t0 !== null && record.t1 === null) {
        record.t1 = now; record.s1 = state.simulation.step;
      }
      if (record.t1 === null) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.locator('[data-strike]').click();
  await page.waitForFunction(() => window.__r9?.t1 !== null && window.__r9?.t1 !== undefined, undefined, { timeout: 60_000 });
  const measure = await page.evaluate(() => {
    const record = window.__r9!;
    const bad = new Set<number>();
    record.frames.forEach((frame, index) => {
      if (frame.clamped) for (let k = index - 3; k <= index + 3; k += 1) bad.add(k);
    });
    let wall = 0; let sim = 0; let clean = 0;
    record.frames.forEach((frame, index) => {
      if (index < 3 || index >= record.frames.length - 3 || bad.has(index)) return;
      wall += frame.dt; sim += frame.ds / 512; clean += 1;
    });
    return {
      ratio: sim > 0 ? wall / sim : 0,
      cleanFrames: clean,
      cleanSimMs: sim * 1000,
      totalSimMs: (record.s1 - record.s0) * (1000 / 512),
    };
  });
  // 清洁窗口须有足够帧与物理时长，比例才稳定（真实 Chrome ~110FPS 下约 260 帧）。
  expect(measure.cleanFrames).toBeGreaterThan(30);
  expect(measure.cleanSimMs).toBeGreaterThan(500);
  expect(measure.totalSimMs).toBeGreaterThan(500);
  // 原速只表示物理步长按 1:1 映射到墙钟：清洁窗口比值 = 1.0。
  expect(measure.ratio).toBeGreaterThan(0.9);
  expect(measure.ratio).toBeLessThan(1.1);
  // 清台后首杆按规则判自由球属正确行为：白球原地放回并确认，回到瞄准态。
  const phase = (): Promise<string> => page.evaluate(() => window.__creativeEight!.getState().phase);
  await expect.poll(phase, { timeout: 60_000 }).toMatch(/^(aiming|ballInHand|gameOver)$/);
  if ((await phase()) === 'ballInHand') {
    const cue = await readCue(page);
    const placed = await page.evaluate(point => window.__creativeEight!.placeCue(point), cue);
    if (!placed) await page.keyboard.press('Space');
    await expect.poll(phase, { timeout: 30_000 }).toBe('aiming');
  }
  const cue = await readCue(page);
  // v=10×0.15=1.5 m/s、a=0.7 m/s^2 → s=v^2/2a≈1.607 m：时间缩放不得改变移动距离。
  // 0.2 力度会滚 2.86 m 撞库，故用 0.15 在库边前干净停住（停点 x≈1.107）。
  expect(cue.x).toBeGreaterThan(-0.5 + 1.45);
  expect(cue.x).toBeLessThan(-0.5 + 1.75);
  expect(Math.abs(cue.y)).toBeLessThan(0.01);
});