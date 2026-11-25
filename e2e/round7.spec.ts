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
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode)).toBe('aim');
}

/** Screen-space unit vector pointing backward along the aim (cue-ward). */
async function backVector(page: Page): Promise<{ x: number; y: number; cue: { x: number; y: number } }> {
  return page.evaluate(() => {
    const debug = window.__creativeEight!;
    const state = debug.getState();
    const cue = state.simulation.balls.find(ball => ball.id === 0)!;
    const cueScreen = debug.ballScreen(0)!;
    const ahead = debug.tableScreen({
      x: cue.position.x + Math.cos(state.human.angle) * 0.4,
      y: cue.position.y + Math.sin(state.human.angle) * 0.4,
    });
    const vx = cueScreen.x - ahead.x;
    const vy = cueScreen.y - ahead.y;
    const length = Math.hypot(vx, vy) || 1;
    return { x: vx / length, y: vy / length, cue: cueScreen };
  });
}

test('左键后拖按距离蓄力，Space 按下/重复/松开不放杆，松开鼠标才击球', async ({ page }) => {
  await startClassicPractice(page);
  await page.mouse.move(640, 400);
  await page.evaluate(() => { window.__creativeEight!.aim(0); window.__creativeEight!.reducedMotion(true); });
  await page.waitForTimeout(600);
  const back = await backVector(page);
  await page.mouse.down();
  await page.mouse.move(640 + back.x * 150, 400 + back.y * 150, { steps: 10 });
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().charging)).toBe(true);
  const power = await page.evaluate(() => window.__creativeEight!.getState().human.power);
  expect(power).toBeGreaterThan(0.6);
  expect(power).toBeLessThan(0.76);
  await page.keyboard.down('Space');
  await page.waitForTimeout(1400);
  await page.keyboard.down('Space'); // Playwright emits repeat=true for a held key.
  let held = await page.evaluate(() => window.__creativeEight!.getState());
  expect(held.charging).toBe(true);
  expect(held.human.power).toBe(power);
  expect(held.phase).toBe('aiming');
  await page.keyboard.up('Space');
  held = await page.evaluate(() => window.__creativeEight!.getState());
  expect(held.charging).toBe(true);
  expect(held.human.power).toBe(power);
  expect(held.phase).toBe('aiming');
  await expect(page.locator('[data-shots]')).toHaveText('0');
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('rolling');
  // 第十二轮摩擦 0.7：150px（约 0.68 力度）的开球碰库数随球堆种子变化，可能判犯规
  // 并落到自由球。本测试只验证蓄力比例与“松开只击一杆”，两种结算都算完成一杆。
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase), { timeout: 150_000 }).toMatch(/^(aiming|ballInHand)$/);
  await expect(page.locator('[data-shots]')).toHaveText('1');
});

for (const strikeFocused of [false, true]) {
  test(`瞄准时长按/重复/松开 Space 不改变力度、不击球（${strikeFocused ? '击球按钮聚焦' : '画布操作'}）`, async ({ page }) => {
    await startClassicPractice(page);
    if (strikeFocused) await page.locator('[data-strike]').focus();
    else await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const aimingState = () => page.evaluate(() => {
      const state = window.__creativeEight!.getState();
      return {
        phase: state.phase, charging: state.charging, human: state.human,
        shots: state.rule.shotNumber, balls: state.simulation.balls,
      };
    });
    const before = await aimingState();
    expect(before.phase).toBe('aiming');
    expect(before.charging).toBe(false);
    await page.keyboard.down('Space');
    expect(await aimingState()).toEqual(before);
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(400);
      await page.keyboard.down('Space');
      expect(await aimingState()).toEqual(before);
    }
    await page.keyboard.up('Space');
    await page.waitForTimeout(200);
    expect(await aimingState()).toEqual(before);
    await expect(page.locator('[data-shots]')).toHaveText('0');
    if (strikeFocused) {
      // Only Space is blocked on this button; native Enter activation still shoots.
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('rolling');
    }
  });
}

test('Esc 取消左键后拖蓄力，之后松开鼠标也不击球', async ({ page }) => {
  await startClassicPractice(page);
  await page.mouse.move(640, 400);
  await page.evaluate(() => { window.__creativeEight!.aim(0); window.__creativeEight!.reducedMotion(true); });
  await page.waitForTimeout(400);
  const back = await backVector(page);
  await page.mouse.down();
  await page.mouse.move(640 + back.x * 160, 400 + back.y * 160, { steps: 8 });
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().charging)).toBe(true);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await page.evaluate(() => window.__creativeEight!.getState().charging)).toBe(false);
  expect(await page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
  await expect(page.locator('[data-shots]')).toHaveText('0');
});

test('右键单击锁定球杆：移动鼠标不再瞄准，杆法面板仍可点；再右键解锁', async ({ page }) => {
  await startClassicPractice(page);
  await page.evaluate(() => window.__creativeEight!.aim(0));
  await page.waitForTimeout(400);
  await page.mouse.click(640, 400, { button: 'right' });
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().cueLocked)).toBe(true);
  await expect(page.locator('[data-spin-label]')).toHaveText('杆法 · 已锁定');
  const lockedAngle = await page.evaluate(() => window.__creativeEight!.getState().human.angle);
  await page.mouse.move(900, 400, { steps: 8 });
  expect(await page.evaluate(() => window.__creativeEight!.getState().human.angle)).toBeCloseTo(lockedAngle, 6);
  // 第八轮：杆法面板是连续球面，点击球面右缘即右塞（不再是九宫格按钮）。
  const face = page.locator('[data-spin-face]');
  const box = (await face.boundingBox())!;
  await page.mouse.click(box.x + box.width - 3, box.y + box.height / 2);
  const lockedSpin = await page.evaluate(() => window.__creativeEight!.getState().human.spin);
  expect(lockedSpin.x).toBeGreaterThan(0.9);
  expect(Math.abs(lockedSpin.y)).toBeLessThan(0.1);
  expect(await page.evaluate(() => window.__creativeEight!.getState().human.angle)).toBeCloseTo(lockedAngle, 6);
  await page.mouse.click(640, 400, { button: 'right' });
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().cueLocked)).toBe(false);
  await page.mouse.move(760, 400, { steps: 6 });
  const unlockedAngle = await page.evaluate(() => window.__creativeEight!.getState().human.angle);
  expect(Math.abs(unlockedAngle - lockedAngle)).toBeGreaterThan(0.1);
});

test('滚轮微调瞄准（第八轮 0.0005 rad/格）；Shift+滚轮不改变瞄准', async ({ page }) => {
  await startClassicPractice(page);
  await page.evaluate(() => window.__creativeEight!.aim(0));
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().human.angle)).toBeCloseTo(0.0005, 6);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().human.angle)).toBeCloseTo(0, 6);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => window.__creativeEight!.getState().human.angle)).toBeCloseTo(0, 6);
});

test('贴库反向瞄准时机位钳制在房间内、不嵌入木家具（round 7 穿模修复）', async ({ page }) => {
  await startClassicPractice(page);
  await page.evaluate(() => {
    const debug = window.__creativeEight!;
    debug.setBall(0, { x: 1.1, y: 0.5 });
    debug.aim(Math.PI);
  });
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.position[0]), { timeout: 15_000 }).toBeLessThanOrEqual(2.48 + 0.02);
  const position = await page.evaluate(() => window.__creativeEight!.getState().view.camera.position);
  expect(Math.abs(position[2]!)).toBeLessThanOrEqual(0.95 * 1.6 + 0.02);
  expect(position[1]!).toBeGreaterThanOrEqual((0.8469 + 0.08) * 1.6 - 0.02);
  await page.screenshot({ path: 'shots-round7/12-aim-rail-clamp.png' });
});

test('Poolians 式辅助线：幽灵圈与偏转线在顶视可见', async ({ page }) => {
  await startClassicPractice(page);
  // 薄切角：1 号球偏离白球射线 0.05（< 2R），保证接触法线与瞄准方向不共线，
  // 偏转线（切向分量）非零才会显示；正对心球时偏转为零属正确物理。
  await page.evaluate(() => {
    const debug = window.__creativeEight!;
    debug.setBall(0, { x: -0.5, y: 0 });
    debug.setBall(1, { x: 0.3, y: 0.05 });
    debug.aim(0);
  });
  await page.keyboard.press('o');
  await page.keyboard.press('o');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode)).toBe('top');
  await page.waitForTimeout(800);
  const report = await page.evaluate(() => window.__creativeEight!.nodeReport());
  const ghost = report.find(node => node.name === 'ghost-ball');
  const deflection = report.find(node => node.name === 'deflection-line');
  const target = report.find(node => node.name === 'target-line');
  expect(ghost?.visible).toBe(true);
  expect(deflection?.visible).toBe(true);
  expect(target?.visible).toBe(true);
  await page.screenshot({ path: 'shots-round7/13-guides-top.png' });
});