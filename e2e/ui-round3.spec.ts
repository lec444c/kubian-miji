import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function startClassicPractice(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await page.evaluate(() => window.__creativeEight!.cancelAi());
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('breakPlacement');
  await page.keyboard.press('Space');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
}

async function startCreativePractice(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  for (let round = 0; round < 2; round += 1) {
    const options = page.locator('.draft-option');
    await expect(options).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) await options.nth(index).click();
    await page.locator('[data-confirm]').click();
  }
  await page.evaluate(() => {
    window.__creativeEight!.cancelAi();
    window.__creativeEight!.reducedMotion(true);
  });
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('breakPlacement');
  await page.keyboard.press('Space');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
}

test('设置面板调节音量并持久化，顶栏静音按钮与设置双向同步', async ({ page }) => {
  await startClassicPractice(page);
  // 运行时核实：首次手势后 BGM 真正播放、采样真正解码（不是只改了设置值）。
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.audio().bgmPlaying), { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.audio().loadedSamples.includes('strike')), { timeout: 20_000 }).toBe(true);
  await expect(page.locator('.hud [data-mute]')).toHaveText('有声');
  await page.locator('[data-settings]').click();
  await expect(page.locator('.dialog.settings')).toBeVisible();
  await page.locator('[data-music]').evaluate((input: HTMLInputElement) => {
    input.value = '30';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('[data-music-value]')).toHaveText('30');
  expect(await page.evaluate(() => window.__creativeEight!.audio().music)).toBeCloseTo(0.3);
  await page.locator('.dialog.settings [data-mute]').click();
  expect(await page.evaluate(() => window.__creativeEight!.audio().muted)).toBe(true);
  await expect(page.locator('.hud [data-mute]')).toHaveText('已静音');
  await expect(page.locator('.hud [data-mute]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-done]').click();
  await expect(page.locator('.dialog.settings')).toBeHidden();
  await page.locator('.hud [data-mute]').click();
  await expect(page.locator('.hud [data-mute]')).toHaveText('有声');
  await page.locator('.hud [data-mute]').click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('creative8.audio.v1')!));
  expect(stored.music).toBeCloseTo(0.3);
  expect(stored.muted).toBe(true);
  await page.reload();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('creative8.audio.v1')!));
  expect(persisted.music).toBeCloseTo(0.3);
  expect(persisted.muted).toBe(true);
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  const runtime = await page.evaluate(() => window.__creativeEight!.audio());
  expect(runtime.muted).toBe(true);
  expect(runtime.music).toBeCloseTo(0.3);
});

test('键位提示默认收起，可展开再收起', async ({ page }) => {
  await startClassicPractice(page);
  const hints = page.locator('.key-hints');
  await expect(hints.locator('.hint-list li')).toHaveCount(12);
  await expect(page.locator('[data-hint-list]')).toBeHidden();
  await page.locator('[data-hints]').click();
  await expect(hints).toBeVisible();
  await expect(hints).toContainText('WASD');
  await expect(page.locator('[data-hints]')).toHaveText('收起');
  await page.locator('[data-hints]').click();
  await expect(page.locator('[data-hint-list]')).toBeHidden();
  await expect(page.locator('[data-hints]')).toHaveText('展开');
});

test('WASD 与方向键功能相同：瞄准 / 杆法 · Shift+方向 侧旋', async ({ page }) => {
  await startClassicPractice(page);
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
  const readHuman = () => page.evaluate(() => window.__creativeEight!.getState().human);
  const base = await readHuman();
  await page.keyboard.press('d');
  const afterD = await readHuman();
  expect(afterD.angle - base.angle).toBeCloseTo(0.0005, 6);
  await page.evaluate(() => window.__creativeEight!.aim(0));
  await page.keyboard.press('ArrowRight');
  expect((await readHuman()).angle).toBeCloseTo(afterD.angle, 6);
  await page.keyboard.press('w');
  expect((await readHuman()).spin.y).toBeCloseTo(0.08, 6);
  await page.keyboard.press('ArrowUp');
  expect((await readHuman()).spin.y).toBeCloseTo(0.16, 6);
  await page.keyboard.press('s');
  await page.keyboard.press('ArrowDown');
  expect((await readHuman()).spin.y).toBeCloseTo(0, 6);
  await page.keyboard.press('Shift+a');
  expect((await readHuman()).spin.x).toBeCloseTo(-0.08, 6);
  await page.keyboard.press('Shift+ArrowRight');
  expect((await readHuman()).spin.x).toBeCloseTo(0, 6);
  await page.evaluate(() => window.__creativeEight!.aim(0));
  await page.keyboard.press('Alt+d');
  expect((await readHuman()).angle).toBeCloseTo(0.000125, 6);
});

test('力度条范围跟随权威最小力度：2–100 线性均布，最轻杆 0.02', async ({ page }) => {
  await startClassicPractice(page);
  const slider = page.locator('[data-power]');
  // 第十三轮：MIN_SHOT_POWER 0.02 → 滑块下限 2（旧硬编码 min=8 曾把第十二轮最小力度挡在条外）。
  await expect(slider).toHaveAttribute('min', '2');
  await expect(slider).toHaveAttribute('max', '100');
  // 默认 step=1：每格 1% = 0.1 m/s（MAX_SHOT_SPEED 10），0.2–10 m/s 全区间线性均布。
  expect(await slider.evaluate((input: HTMLInputElement) => input.step)).toBe('1');
  const setSlider = (value: string): Promise<void> => slider.evaluate((input: HTMLInputElement, next) => {
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await setSlider('2');
  expect(await page.evaluate(() => window.__creativeEight!.getState().human.power)).toBeCloseTo(0.02, 6);
  await setSlider('51');
  expect(await page.evaluate(() => window.__creativeEight!.getState().human.power)).toBeCloseTo(0.51, 6);
  await setSlider('100');
  expect(await page.evaluate(() => window.__creativeEight!.getState().human.power)).toBeCloseTo(1, 6);
});

test('Shift+滚轮推拉环绕视角并钳制在房间内；普通滚轮只微调瞄准', async ({ page }) => {
  await startClassicPractice(page);
  await page.keyboard.press('c');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode)).toBe('orbit');
  const dist = () => page.evaluate(() => {
    const position = window.__creativeEight!.getState().view.camera.position;
    return Math.hypot(position[0]!, position[2]!);
  });
  await expect.poll(dist, { timeout: 10_000 }).toBeGreaterThan(3.5);
  const before = await dist();
  await page.mouse.move(640, 500);
  // 普通滚轮 = 微调瞄准（第七轮），不再推拉视角。
  const angleBefore = await page.evaluate(() => window.__creativeEight!.getState().human.angle);
  await page.mouse.wheel(0, 240);
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().human.angle)).not.toBe(angleBefore);
  expect(await dist()).toBeCloseTo(before, 1);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 240);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await dist()) > before + 0.05, { timeout: 10_000 }).toBe(true);
  await page.keyboard.down('Shift');
  for (let index = 0; index < 12; index += 1) await page.mouse.wheel(0, -240);
  await page.keyboard.up('Shift');
  await expect.poll(async () => Math.abs((await dist()) - 2.88) < 0.01, { timeout: 10_000 }).toBe(true);
});

test('自由球自动顶视：鼠标拖动白球、WASD 微调、Space 确定', async ({ page }) => {
  await startCreativePractice(page);
  await page.locator('[data-skills="0"] .skill-card').filter({ hasText: '假自由球' }).click();
  await page.evaluate(() => window.__creativeEight!.advanceTime(10_100));
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().rule.ballInHand)).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().placementCursor)).not.toBeNull();
  // 获得自由球即自动进入顶视，方便拖放。
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode), { timeout: 15_000 }).toBe('top');
  const before = await page.evaluate(() => window.__creativeEight!.getState().placementCursor!);
  await page.keyboard.press('d');
  await page.keyboard.press('d');
  await page.keyboard.press('s');
  const moved = await page.evaluate(() => window.__creativeEight!.getState().placementCursor!);
  expect(moved.x).toBeGreaterThan(before.x + 0.03);
  expect(moved.y).toBeGreaterThan(before.y + 0.015);
  await page.keyboard.press('Alt+d');
  const fine = await page.evaluate(() => window.__creativeEight!.getState().placementCursor!);
  expect(fine.x - moved.x).toBeGreaterThan(0.002);
  expect(fine.x - moved.x).toBeLessThan(0.006);
  // 鼠标拖动：等顶视落定后，从白球屏幕位置按住拖到目标点。
  const target = { x: -0.3, y: 0.12 };
  await expect.poll(async () => {
    const a = await page.evaluate(t => window.__creativeEight!.tableScreen(t), target);
    await page.waitForTimeout(150);
    const b = await page.evaluate(t => window.__creativeEight!.tableScreen(t), target);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }, { timeout: 15_000 }).toBeLessThan(1.5);
  const from = await page.evaluate(() => {
    const cursor = window.__creativeEight!.getState().placementCursor!;
    return window.__creativeEight!.tableScreen(cursor);
  });
  const to = await page.evaluate(t => window.__creativeEight!.tableScreen(t), target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => window.__creativeEight!.getState().placementCursor!);
  expect(dragged.x).toBeCloseTo(target.x, 2);
  expect(dragged.y).toBeCloseTo(target.y, 2);
  // Space 只确认摆放，不蓄力；确认后回到第一人称瞄准。
  await page.keyboard.press('Space');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
  const state = await page.evaluate(() => window.__creativeEight!.getState());
  const cue = state.simulation.balls.find(ball => ball.id === 0)!;
  expect(cue.onTable).toBe(true);
  expect(cue.position.x).toBeCloseTo(dragged.x, 5);
  expect(cue.position.y).toBeCloseTo(dragged.y, 5);
  expect(state.placementCursor).toBeNull();
  expect(state.charging).toBe(false);
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode)).toBe('aim');
});