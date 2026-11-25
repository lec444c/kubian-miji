import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/** 第八轮：球面连续击球点 + 真实旋转物理 + 摩擦 + 360° 多圈转向 + 精调。 */

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

/** 清空球台，只留白球（可选保留 1 号球做接触目标）。 */
async function soloTable(page: Page, cue: { x: number; y: number }, object?: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ cue, object }) => {
    const debug = window.__creativeEight!;
    for (let id = 1; id <= 15; id += 1) debug.removeBall(id);
    debug.setBall(0, cue);
    if (object) debug.setBall(1, object);
    debug.aim(0);
  }, { cue, object });
}

async function setPower(page: Page, value: number): Promise<void> {
  await page.locator('[data-power]').evaluate((input: HTMLInputElement, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/** 点击球面：fx/fy 为球面外框的 0–1 比例（fy 向下）。 */
async function clickFace(page: Page, fx: number, fy: number): Promise<void> {
  const box = (await page.locator('[data-spin-face]').boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function faceBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return (await page.locator('[data-spin-face]').boundingBox())!;
}

const readSpin = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => window.__creativeEight!.getState().human.spin);
const readCue = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const ball = window.__creativeEight!.getState().simulation.balls.find(item => item.id === 0)!;
    return { x: ball.position.x, y: ball.position.y };
  });
const readAngle = (page: Page): Promise<number> =>
  page.evaluate(() => window.__creativeEight!.getState().human.angle);

/** 等球台静止。清台后首杆不满足开球规则会判自由球，这是正确规则行为：
 *  把白球原地放回并 Space 确认，回到瞄准态再读数。 */
async function waitSettled(page: Page): Promise<void> {
  const phase = (): Promise<string> => page.evaluate(() => window.__creativeEight!.getState().phase);
  await expect.poll(phase, { timeout: 150_000 }).toMatch(/^(aiming|ballInHand|gameOver)$/);
  if ((await phase()) === 'ballInHand') {
    const cue = await readCue(page);
    // placeCue 本身即确认摆放（进入 aiming）；只有摆放被拒时才用 Space 走默认点。
    const placed = await page.evaluate(point => window.__creativeEight!.placeCue(point), cue);
    if (!placed) await page.keyboard.press('Space');
    await expect.poll(phase, { timeout: 30_000 }).toBe('aiming');
  }
}

/** 通过真实 UI（球面 + 力度条 + 击球按钮）打出一杆并等待球台静止。 */
async function uiShot(page: Page, face: { fx: number; fy: number }, power: number): Promise<void> {
  await clickFace(page, face.fx, face.fy);
  await setPower(page, power);
  await page.locator('[data-strike]').click();
  await waitSettled(page);
}

test('球面点击任意位置：连续加塞值、读数与标记同步，回中复位', async ({ page }) => {
  await startClassicPractice(page);
  const box = await faceBox(page);
  // 右上 3/4 处：viewBox(75,30) → spin=(25/46, 20/46)，不是九宫格预设值。
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.3);
  const spin = await readSpin(page);
  expect(spin.x).toBeCloseTo(25 / 46, 2);
  expect(spin.y).toBeCloseTo(20 / 46, 2);
  await expect(page.locator('[data-spin-readout]')).toHaveText('高杆 0.43 · 右塞 0.54');
  const marker = page.locator('[data-spin-marker]');
  expect(Number(await marker.getAttribute('cx'))).toBeCloseTo(75, 0);
  expect(Number(await marker.getAttribute('cy'))).toBeCloseTo(30, 0);
  // 再点左下另一处，值连续变化而不是跳到固定档位。
  await page.mouse.click(box.x + box.width * 0.32, box.y + box.height * 0.68);
  const second = await readSpin(page);
  expect(second.x).toBeCloseTo((32 - 50) / 46, 2);
  expect(second.y).toBeCloseTo((50 - 68) / 46, 2);
  await expect(page.locator('[data-spin-readout]')).toContainText('低杆');
  await expect(page.locator('[data-spin-readout]')).toContainText('左塞');
  await page.locator('[data-spin-reset]').click();
  expect(await readSpin(page)).toEqual({ x: 0, y: 0 });
  await expect(page.locator('[data-spin-readout]')).toHaveText('中杆 · 无塞');
  expect(Number(await marker.getAttribute('cx'))).toBeCloseTo(50, 1);
});

test('球面拖动连续加塞：超出球面钳制在单位圆内并提示滑杆极限', async ({ page }) => {
  await startClassicPractice(page);
  const box = await faceBox(page);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + box.width * 0.2, centre.y + box.height * 0.1, { steps: 4 });
  const mid = await readSpin(page);
  expect(mid.x).toBeGreaterThan(0.3);
  expect(mid.y).toBeLessThan(-0.1);
  // 拖到球面外：方向保留、长度钳制为 1（滑杆极限），不会打出非法加塞。
  await page.mouse.move(box.x - box.width, box.y + box.height * 2, { steps: 6 });
  const edge = await readSpin(page);
  expect(Math.hypot(edge.x, edge.y)).toBeCloseTo(1, 5);
  expect(edge.x).toBeLessThan(0);
  expect(edge.y).toBeLessThan(0);
  await expect(page.locator('[data-spin-readout]')).toContainText('接近滑杆极限');
  await expect(page.locator('.spin-face-wrap')).toHaveClass(/at-edge/);
  // 拖回球面内另一侧，值实时跟随。
  await page.mouse.move(centre.x + box.width * 0.3, centre.y - box.height * 0.2, { steps: 5 });
  const back = await readSpin(page);
  expect(back.x).toBeGreaterThan(0.5);
  expect(back.y).toBeGreaterThan(0.3);
  await page.mouse.up();
  await expect(page.locator('.spin-face-wrap')).not.toHaveClass(/at-edge/);
});

test('球面键盘微调与 Home 回中，不触发全局瞄准', async ({ page }) => {
  await startClassicPractice(page);
  await page.evaluate(() => window.__creativeEight!.aim(0.4));
  await page.locator('[data-spin-face]').focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  const spin = await readSpin(page);
  expect(spin.y).toBeCloseTo(0.1, 6);
  expect(spin.x).toBeCloseTo(0.05, 6);
  expect(await readAngle(page)).toBeCloseTo(0.4, 6);
  await page.keyboard.press('Alt+ArrowRight');
  expect((await readSpin(page)).x).toBeCloseTo(0.062, 6);
  await page.keyboard.press('Home');
  expect(await readSpin(page)).toEqual({ x: 0, y: 0 });
  expect(await readAngle(page)).toBeCloseTo(0.4, 6);
});

test('低杆回撤 / 高杆跟进 / 半低杆定杆：白球走位符合真实旋转', async ({ page }) => {
  await startClassicPractice(page);
  const setup = async (): Promise<void> => {
    await soloTable(page, { x: -0.3, y: 0 }, { x: 0, y: 0 });
    await page.waitForTimeout(250);
  };
  // 第十三轮球速上限 9→10：力度 30% = 0.30×10 = 3.0 m/s，复现单测钉住的 3.0 m/s 旋转轨迹
  // （tests/physics/simulation.spec.ts 用 0.3）。若用更高力度目标球会多弹库回撞白球，
  // 属正确物理但会让下面的停点断言失稳。
  // 低杆（球面底部）：撞击后白球必须退回到接触点之后。
  await setup();
  await uiShot(page, { fx: 0.5, fy: 0.98 }, 30);
  const draw = await readCue(page);
  const objectAfterDraw = await page.evaluate(() => window.__creativeEight!.getState().simulation.balls.find(ball => ball.id === 1)!.position.x);
  expect(objectAfterDraw).toBeGreaterThan(0.1);
  expect(draw.x).toBeLessThan(-0.1);
  // 高杆（球面顶部）：白球跟进穿过目标球原位置。
  await setup();
  await uiShot(page, { fx: 0.5, fy: 0.02 }, 30);
  expect((await readCue(page)).x).toBeGreaterThan(0.05);
  // 半低杆（球面下半径处 fy=0.73 → spin.y=-0.5）：定杆，白球停在接触点附近。
  await setup();
  await uiShot(page, { fx: 0.5, fy: 0.73 }, 30);
  const stun = await readCue(page);
  expect(stun.x).toBeGreaterThan(-0.16);
  expect(stun.x).toBeLessThan(0.02);
  await page.screenshot({ path: 'shots-round8/20-spin-shot-hud.png' });
});

test('侧旋吃库横向弹出：右塞 / 左塞方向相反，无塞不偏', async ({ page }) => {
  await startClassicPractice(page);
  const rebound = async (fx: number): Promise<{ x: number; y: number }> => {
    await soloTable(page, { x: 0.5, y: 0 });
    await clickFace(page, fx, 0.5);
    await setPower(page, 30);
    await page.locator('[data-strike]').click();
    await waitSettled(page);
    return readCue(page);
  };
  // 切向冲量受法向冲量上限约束（不凭空造能量）在 tests/physics/simulation.spec.ts
  // 里按固定步长逐帧核验；这里核验玩家看得见的走位结果。
  const plain = await rebound(0.5);
  expect(plain.x).toBeLessThan(1.0);
  expect(Math.abs(plain.y)).toBeLessThan(0.01);
  const right = await rebound(0.98);
  expect(right.x).toBeLessThan(1.0);
  expect(right.y).toBeGreaterThan(0.05);
  const left = await rebound(0.02);
  expect(left.y).toBeLessThan(-0.05);
});

test('摩擦力回调：轻推 0.15 力度滚动约 1.61 m 后停住（第十三轮 0.7 × 球速上限 10）', async ({ page }) => {
  await startClassicPractice(page);
  await soloTable(page, { x: -0.5, y: 0 });
  await uiShot(page, { fx: 0.5, fy: 0.5 }, 15);
  const cue = await readCue(page);
  // v=10×0.15=1.5 m/s，a=0.7 m/s^2 → s=v^2/2a≈1.607 m。0.2 力度会滚 2.86 m 撞库回弹，
  // 故用 0.15 让白球在库边前干净停住（停点 x≈1.107 < 库边捕获 1.181）。
  expect(cue.x).toBeGreaterThan(-0.5 + 1.45);
  expect(cue.x).toBeLessThan(-0.5 + 1.75);
  expect(Math.abs(cue.y)).toBeLessThan(0.01);
  const motion = await page.evaluate(() => window.__creativeEight!.getState().simulation.balls.find(ball => ball.id === 0)!.motion);
  expect(motion).toBe('stationary');
});

test('鼠标转向灵敏度：200 px ≈ 1.6 rad，可连续累计多圈', async ({ page }) => {
  await startClassicPractice(page);
  await page.evaluate(() => window.__creativeEight!.aim(0));
  await page.mouse.move(400, 400);
  const before = await readAngle(page);
  await page.mouse.move(600, 400, { steps: 10 });
  expect((await readAngle(page)) - before).toBeCloseTo(1.6, 2);
  // 三次全幅扫动（每次 1040 px ≈ 8.32 rad），右键锁杆期间回位不计入瞄准。
  await page.mouse.click(600, 400, { button: 'right' });
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().cueLocked)).toBe(true);
  await page.mouse.move(120, 400);
  await page.mouse.click(120, 400, { button: 'right' });
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().cueLocked)).toBe(false);
  await page.evaluate(() => window.__creativeEight!.aim(0));
  for (let sweep = 0; sweep < 3; sweep += 1) {
    await page.mouse.move(1160, 400, { steps: 30 });
    if (sweep < 2) {
      await page.mouse.click(1160, 400, { button: 'right' });
      await page.mouse.move(120, 400);
      await page.mouse.click(120, 400, { button: 'right' });
    }
  }
  const swept = await readAngle(page);
  expect(swept).toBeGreaterThan(4 * Math.PI);
  expect(swept / (2 * Math.PI)).toBeGreaterThan(2);
  // 多圈之后球杆依旧对准白球、没有失效或 NaN。
  const aim = await page.evaluate(() => window.__creativeEight!.cueAim());
  expect(aim?.visible).toBe(true);
  expect(Number.isFinite(swept)).toBe(true);
  expect(aim!.alignment).toBeLessThan(1e-3);
  // 顶视与环绕视角同样灵敏。
  for (const mode of ['orbit', 'top'] as const) {
    await page.keyboard.press('c');
    await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode)).toBe(mode);
    await page.mouse.move(400, 400);
    const base = await readAngle(page);
    await page.mouse.move(600, 400, { steps: 10 });
    expect((await readAngle(page)) - base).toBeCloseTo(1.6, 2);
  }
});

test('精调：滚轮 0.0005 rad/格，Alt+滚轮与 Alt+鼠标更细', async ({ page }) => {
  await startClassicPractice(page);
  await page.evaluate(() => window.__creativeEight!.aim(0));
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => readAngle(page)).toBeCloseTo(0.0005, 6);
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Alt');
  await expect.poll(async () => readAngle(page)).toBeCloseTo(0.00056, 6);
  await page.evaluate(() => window.__creativeEight!.aim(0));
  await page.mouse.move(500, 400);
  const base = await readAngle(page);
  await page.keyboard.down('Alt');
  await page.mouse.move(600, 400, { steps: 10 });
  await page.keyboard.up('Alt');
  // 100 px × 0.008 × 0.12 = 0.096 rad（约 5.5°），普通移动同距离为 0.8 rad。
  expect((await readAngle(page)) - base).toBeCloseTo(0.096, 3);
});

test('杆头落在所选击球点上：侧旋横移半个半径，高杆上抬半个半径', async ({ page }) => {
  await startClassicPractice(page);
  await soloTable(page, { x: -0.4, y: 0 });
  await page.waitForTimeout(500);
  const centre = (await page.evaluate(() => window.__creativeEight!.cueAim()))!;
  expect(centre.alignment).toBeLessThan(1e-3);
  const lateral = (aim: { tip: number[] }): number => Math.hypot(aim.tip[0]! - centre.tip[0]!, aim.tip[2]! - centre.tip[2]!);
  await clickFace(page, 0.98, 0.5);
  await page.waitForTimeout(500);
  const side = (await page.evaluate(() => window.__creativeEight!.cueAim()))!;
  expect(lateral(side)).toBeCloseTo(0.0315 * 0.5, 3);
  expect(Math.abs(side.tip[1]! - centre.tip[1]!)).toBeLessThan(1e-4);
  expect(side.gap).toBeGreaterThanOrEqual(0.006);
  expect(side.railClearance).toBeGreaterThanOrEqual(-1e-6);
  await page.screenshot({ path: 'shots-round8/21-cue-tip-side.png' });
  await clickFace(page, 0.5, 0.02);
  await page.waitForTimeout(500);
  const high = (await page.evaluate(() => window.__creativeEight!.cueAim()))!;
  expect(lateral(high)).toBeLessThan(1e-4);
  expect(high.tip[1]! - centre.tip[1]!).toBeCloseTo(0.0315 * 0.5, 3);
  await page.locator('[data-spin-reset]').click();
  await page.waitForTimeout(400);
  const reset = (await page.evaluate(() => window.__creativeEight!.cueAim()))!;
  expect(reset.alignment).toBeLessThan(1e-3);
  expect(await readSpin(page)).toEqual({ x: 0, y: 0 });
});

test('开球自动补力：确认摆位后力度 0.89，首杆结算后还原开局力度', async ({ page }) => {
  await startClassicPractice(page);
  // 第十三轮摩擦 0.7、上限 10：开局力度仍可能四球碰库不足；补力 0.89（8.9 m/s）跨 40 种子
  // 全合法且散开充分（breakSweep/breakScatter 单测钉住），保证首次交互不必然犯规。
  expect(await page.evaluate(() => window.__creativeEight!.getState().human.power)).toBeCloseTo(0.89, 6);
  await expect(page.locator('[data-power-number]')).toHaveText('89');
  await page.locator('[data-strike]').click();
  await waitSettled(page);
  expect(await page.evaluate(() => window.__creativeEight!.getState().human.power)).toBeCloseTo(0.72, 6);
  await expect(page.locator('[data-shots]')).toHaveText('1');
});