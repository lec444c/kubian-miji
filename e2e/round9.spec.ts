import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/** 第九轮：摩擦回调（0.85，第十二轮再降到 0.7，开球散开）、预测辅助线缩短（0.12/0.08 m）。
 *  表现层慢放的墙钟比例验证在 round9-timescale.spec.ts（需真实 Chrome 高帧率）。 */

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

test('辅助线缩短：目标线 0.12m / 偏转线 0.08m，幽灵圈与瞄准线保留', async ({ page }) => {
  await startClassicPractice(page);
  // 薄切角保证偏转线（切向分量）非零；正对心球时偏转为零属正确物理。
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
  const span = (name: string): number => {
    const node = report.find(item => item.name === name)!;
    expect(node.visible, `${name} visible`).toBe(true);
    return Math.hypot(node.max[0]! - node.min[0]!, node.max[1]! - node.min[1]!, node.max[2]! - node.min[2]!);
  };
  // 世界缩放 1.6：0.12m→0.192、0.08m→0.128（nodeReport 坐标保留三位小数）。
  expect(span('target-line')).toBeGreaterThan(0.186);
  expect(span('target-line')).toBeLessThan(0.198);
  expect(span('deflection-line')).toBeGreaterThan(0.122);
  expect(span('deflection-line')).toBeLessThan(0.134);
  expect(span('ghost-ball')).toBeGreaterThan(0.09);
  expect(span('aim-line')).toBeGreaterThan(1.0);
  await page.screenshot({ path: 'shots-round9/40-guides-short.png' });
});

test('满力度按钮开球散开：至少 6 颗目标球位移超 0.2m', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await page.evaluate(() => window.__creativeEight!.cancelAi());
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('breakPlacement');
  const before = await page.evaluate(() =>
    window.__creativeEight!.getState().simulation.balls.map(ball => ({ id: ball.id, x: ball.position.x, y: ball.position.y })));
  await page.keyboard.press('Space');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode)).toBe('aim');
  // 明确使用力度滑杆与击球按钮；Space 仅用于前面的开球摆位。
  await page.locator('[data-power]').focus();
  await page.keyboard.press('End');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().human.power)).toBe(1);
  await page.locator('[data-strike]').click();
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('rolling');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase), { timeout: 280_000 })
    .toMatch(/^(aiming|ballInHand|gameOver)$/);
  // 满蓄力（1.0）开球在 Date.now() 随机种子下可能合法洗袋→自由球（breakSweep 只钉住
  // 0.89 跨种子全合法，不含 1.0）。洗袋属正确规则，不影响目标球散开度；若落到自由球，
  // 原地放回白球并确认，回到瞄准态再读取散开结果。
  const phase = (): Promise<string> => page.evaluate(() => window.__creativeEight!.getState().phase);
  if ((await phase()) === 'ballInHand') {
    const cue = await page.evaluate(() => {
      const ball = window.__creativeEight!.getState().simulation.balls.find(item => item.id === 0)!;
      return { x: ball.position.x, y: ball.position.y };
    });
    const placed = await page.evaluate(point => window.__creativeEight!.placeCue(point), cue);
    if (!placed) await page.keyboard.press('Space');
    await expect.poll(phase, { timeout: 30_000 }).toMatch(/^(aiming|gameOver)$/);
  }
  const after = await page.evaluate(() =>
    window.__creativeEight!.getState().simulation.balls.map(ball => ({ id: ball.id, x: ball.position.x, y: ball.position.y })));
  let moved = 0;
  for (const ball of after) {
    if (ball.id === 0) continue;
    const start = before.find(item => item.id === ball.id)!;
    if (Math.hypot(ball.x - start.x, ball.y - start.y) > 0.2) moved += 1;
  }
  // 12 种子实测最少 7/15（breakScatter 单测钉住 ≥6）；这里验证真实 UI 路径同样散开。
  expect(moved).toBeGreaterThanOrEqual(6);
  await page.screenshot({ path: 'shots-round9/41-break-scatter.png' });
});