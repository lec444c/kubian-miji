import { test, expect } from './fixtures';

test('开球摆位 Space 确定；左键后拖松开只击一杆，击球后自动顶视', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await page.evaluate(() => window.__creativeEight!.cancelAi());

  // 开局先进入开球摆位（顶视），Space 确定后才开始瞄准。
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('breakPlacement');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode)).toBe('top');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().placementCursor)).not.toBeNull();
  await page.keyboard.press('Space');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
  expect(await page.evaluate(() => window.__creativeEight!.getState().charging)).toBe(false);

  await expect.poll(async () => page.evaluate(() => {
    const view = window.__creativeEight!.getState().view;
    return (view.traditionalFit ?? view.tableFit)?.clothTopY;
  })).toBeCloseTo(0.79, 2);
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode)).toBe('aim');
  const initialFov = await page.evaluate(() => window.__creativeEight!.getState().view.camera.fov);
  await page.keyboard.press('Digit2');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.fov)).toBeGreaterThan(initialFov + 1);
  await page.keyboard.press('Digit7');

  // 先把鼠标放到画布安全区再固定瞄准，避免起拖前移动鼠标改变球杆方向。
  await page.mouse.move(640, 400);
  await page.evaluate(() => { window.__creativeEight!.aim(0); window.__creativeEight!.reducedMotion(true); });
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => {
    const api = window.__creativeEight!;
    const state = api.getState();
    const cue = state.simulation.balls.find(ball => ball.id === 0)!;
    const origin = api.ballScreen(0)!;
    const ahead = api.tableScreen({
      x: cue.position.x + Math.cos(state.human.angle) * 0.4,
      y: cue.position.y + Math.sin(state.human.angle) * 0.4,
    });
    const length = Math.hypot(origin.x - ahead.x, origin.y - ahead.y);
    return { x: (origin.x - ahead.x) / length, y: (origin.y - ahead.y) / length };
  });
  await page.mouse.down();
  await page.mouse.move(640 + back.x * 80, 400 + back.y * 80, { steps: 8 });
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().charging)).toBe(true);
  expect(await page.evaluate(() => window.__creativeEight!.getState().human.power)).toBeCloseTo(80 / 220, 2);
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('rolling');
  // 击球后缓动升起顶视，整张球桌可读；不再第一人称保持+环绕缓转。
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode), { timeout: 30_000 }).toBe('top');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-shots]')).toHaveText('0');

  // 第十二轮摩擦 0.7：80px 后拖（约 0.36 力度）的开球碰库数随球堆种子变化，
  // 可能判犯规（首碰后碰库不足），练习模式双方皆人类，故落到自由球；Space 确认默认摆位后继续。
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase), { timeout: 150_000 }).toMatch(/^(aiming|ballInHand)$/);
  if ((await page.evaluate(() => window.__creativeEight!.getState().phase)) === 'ballInHand') {
    await page.keyboard.press('Space');
  }
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase), { timeout: 30_000 }).toBe('aiming');
  await expect(page.locator('[data-shots]')).toHaveText('1');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode)).toBe('aim');
  expect(await page.evaluate(() => window.__creativeEight!.getState().charging)).toBe(false);
});

test('点击目标球后球杆自动指向该球', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await page.evaluate(() => window.__creativeEight!.cancelAi());
  await page.keyboard.press('Space');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode)).toBe('aim');

  // 球堆顶点 1 号球在第一人称瞄准视角正前方；等镜头落定再点击其投影中心。
  await expect.poll(async () => {
    const a = await page.evaluate(() => window.__creativeEight!.ballScreen(1));
    await page.waitForTimeout(200);
    const b = await page.evaluate(() => window.__creativeEight!.ballScreen(1));
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Number.POSITIVE_INFINITY;
  }, { timeout: 20_000 }).toBeLessThan(2);
  const point = await page.evaluate(() => window.__creativeEight!.ballScreen(1));
  expect(point).not.toBeNull();
  expect(await page.evaluate(p => window.__creativeEight!.pickBallAt(p.x, p.y), point!)).toBe(1);
  await page.mouse.click(point!.x, point!.y);
  const expected = await page.evaluate(() => {
    const balls = window.__creativeEight!.getState().simulation.balls;
    const cue = balls.find(ball => ball.id === 0)!;
    const target = balls.find(ball => ball.id === 1)!;
    return Math.atan2(target.position.y - cue.position.y, target.position.x - cue.position.x);
  });
  expect(await page.evaluate(() => window.__creativeEight!.getState().human.angle)).toBeCloseTo(expected, 5);
});

test('开球击入黑8立即结束对局（提前进8判负）', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await page.evaluate(() => window.__creativeEight!.cancelAi());
  await page.keyboard.press('Space');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
  // 确定性摆位：黑8贴角袋口，白球沿对角线直推黑8入袋。
  await page.evaluate(() => {
    const debug = window.__creativeEight!;
    debug.setBall(8, { x: 1.2, y: 0.565 });
    debug.setBall(0, { x: 0.9, y: 0.265 });
  });
  await page.evaluate(() => window.__creativeEight!.strike(Math.atan2(0.3, 0.3), 0.45));
  await expect(page.getByRole('heading', { name: '乙方获胜' })).toBeVisible({ timeout: 40_000 });
  expect(await page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('gameOver');
  expect(await page.evaluate(() => window.__creativeEight!.getState().rule.winner)).toBe(1);
});