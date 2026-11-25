import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function confirmDraft(page: Page, optionCount: number, selectionCount = optionCount, prefer: string[] = []): Promise<void> {
  const options = page.locator('.draft-option');
  await expect(options).toHaveCount(optionCount);
  const selected = new Set<string>();
  for (const name of prefer) {
    await options.filter({ hasText: name }).click();
    selected.add(name);
  }
  for (let index = 0; selected.size < selectionCount && index < optionCount; index += 1) {
    const option = options.nth(index);
    const name = (await option.locator('strong').textContent()) ?? '';
    if (selected.has(name)) continue;
    await option.click();
    selected.add(name);
  }
  await page.locator('[data-confirm]').click();
}

async function startCreativePractice(page: Page, prefer: string[] = []): Promise<void> {
  await page.goto('/');
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await confirmDraft(page, 4, 3, prefer);
  await confirmDraft(page, 4);
  await expect(page.locator('[data-skills="0"] .skill-card')).toHaveCount(3);
  await expect(page.locator('[data-skills="1"] .skill-card')).toHaveCount(3);
  await page.evaluate(() => {
    window.__creativeEight!.cancelAi();
    window.__creativeEight!.reducedMotion(true);
  });
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('breakPlacement');
  await page.keyboard.press('Space');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
}

async function clickBall(page: Page, ballId: number): Promise<void> {
  // 软件渲染帧率低，两次采样可能落在同一帧内造成“假稳定”；
  // 拉长采样间隔并要求连续两次跨帧稳定，再点击最新屏幕坐标。
  let stableCount = 0;
  await expect.poll(async () => {
    const before = await page.evaluate(id => window.__creativeEight!.ballScreen(id), ballId);
    await page.waitForTimeout(350);
    const after = await page.evaluate(id => window.__creativeEight!.ballScreen(id), ballId);
    const delta = before && after ? Math.hypot(before.x - after.x, before.y - after.y) : Number.POSITIVE_INFINITY;
    stableCount = delta < 2.5 ? stableCount + 1 : 0;
    return stableCount;
  }, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  const point = await page.evaluate(id => window.__creativeEight!.ballScreen(id), ballId);
  expect(point).not.toBeNull();
  // 低机位环绕镜头下球体屏幕投影可能互相重叠：射线先命中邻球会让技能选错目标。
  // 在投影中心附近探测，直到拾取结果确实是目标球再点击。
  const offsets: Array<[number, number]> = [
    [0, 0], [3, 0], [-3, 0], [0, 3], [0, -3],
    [4, 4], [-4, -4], [4, -4], [-4, 4], [6, 0], [-6, 0], [0, 6], [0, -6],
  ];
  let clickPoint: { x: number; y: number } | null = null;
  const probe = async (centre: { x: number; y: number }): Promise<{ x: number; y: number } | null> => {
    for (const [dx, dy] of offsets) {
      const candidate = { x: centre.x + dx, y: centre.y + dy };
      const picked = await page.evaluate(p => window.__creativeEight!.pickBallAt(p.x, p.y), candidate);
      if (picked === ballId) return candidate;
    }
    return null;
  };
  clickPoint = await probe(point!);
  if (!clickPoint) {
    // 完全被邻球遮挡时切到顶视（无重叠）再拾取。
    for (let i = 0; i < 3 && !clickPoint; i += 1) {
      await page.keyboard.press('c');
      await page.waitForTimeout(900);
      const mode = await page.evaluate(() => window.__creativeEight!.getState().view.camera.mode);
      if (mode !== 'top') continue;
      const top = await page.evaluate(id => window.__creativeEight!.ballScreen(id), ballId);
      if (top) clickPoint = await probe(top);
    }
  }
  expect(clickPoint, `ball ${ballId} is not pickable near its projected centre`).not.toBeNull();
  await page.mouse.click(clickPoint!.x, clickPoint!.y);
}

async function clickTable(page: Page, point: { x: number; y: number }): Promise<void> {
  await expect.poll(async () => {
    const before = await page.evaluate(value => window.__creativeEight!.tableScreen(value), point);
    await page.waitForTimeout(100);
    const after = await page.evaluate(value => window.__creativeEight!.tableScreen(value), point);
    return Math.hypot(before.x - after.x, before.y - after.y);
  }).toBeLessThan(3);
  const screen = await page.evaluate(value => window.__creativeEight!.tableScreen(value), point);
  await page.mouse.click(screen.x, screen.y);
}

test('手部微操通过真实技能按钮和球体点击提交，且只能使用一次', async ({ page }) => {
  await startCreativePractice(page, ['手部微操']);
  await page.evaluate(() => {
    const debug = window.__creativeEight!;
    debug.setGroups(0, 'solids');
    debug.setBall(1, { x: 0.3, y: 0.545 });
    debug.setCurrentPlayer(1);
  });
  const before = await page.evaluate(() => window.__creativeEight!.getState().simulation.balls.find(ball => ball.id === 1)!.position);
  const button = page.locator('[data-skills="0"] .skill-card').filter({ hasText: '手部微操' });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator('.target-banner')).toBeVisible();
  await clickBall(page, 1);
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
  await expect(page.locator('.skill-announce')).toContainText('手部微操');
  await expect(page.locator('.skill-announce')).toContainText('甲方');
  const state = await page.evaluate(() => window.__creativeEight!.getState());
  const after = state.simulation.balls.find(ball => ball.id === 1)!.position;
  expect(after).not.toEqual(before);
  expect(state.rule.currentPlayer).toBe(1);
  expect(state.skills[0].find(instance => instance.skillId === 'hand')!.remainingUses).toBe(0);
  await expect(button).toBeDisabled();
});

test('吹风机在真实击球后暂停选球并提交有界减速', async ({ page }) => {
  await startCreativePractice(page, ['吹风机']);
  await page.evaluate(() => window.__creativeEight!.setCurrentPlayer(1));
  // 第七轮摩擦提高后滚动窗口变短：满力开球拉长窗口，并在页面内于按钮可用的
  // 当帧原子点击，避免 Playwright 重试间隙滚动已结算导致按钮禁用。
  await page.locator('[data-power]').evaluate((input: HTMLInputElement) => {
    input.value = '100';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('[data-strike]').click();
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll('[data-skills="0"] .skill-card'));
    const card = cards.find(element => element.textContent?.includes('吹风机')) as HTMLButtonElement | undefined;
    if (!card || card.disabled) return false;
    card.click();
    return true;
  }, null, { timeout: 15_000, polling: 50 });
  await expect(page.locator('.target-banner')).toContainText('物理已暂停');
  // 击球后镜头缓动升起顶视；等镜头落定再点球，避免坐标漂移。
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().view.camera.mode), { timeout: 30_000 }).toBe('top');
  // 物理暂停后候选冻结：选速度最快的运动球。慢速球（尤其开球后的白球）恢复后
  // 几步内即停，减速效果按规则随停球清理，轮询无法稳定观测；快球可观测约 3 秒。
  const target = await page.evaluate(() => {
    const balls = window.__creativeEight!.getState().simulation.balls;
    const moving = balls.filter(ball => ball.onTable && !ball.pocketed && (ball.motion === 'sliding' || ball.motion === 'rolling'));
    moving.sort((a, b) => Math.hypot(b.velocity.x, b.velocity.y) - Math.hypot(a.velocity.x, a.velocity.y));
    return moving[0]!.id;
  });
  await clickBall(page, target);
  // 减速效果只持续 3 秒：在命中当帧原子捕获状态，避免轮询与读状态之间效果已过期。
  const applied = await page.waitForFunction(() => {
    const state = window.__creativeEight!.getState();
    const braking = state.simulation.braking[0];
    if (!braking) return null;
    return {
      ballId: braking.ballId,
      deceleration: braking.deceleration,
      uses: state.skills[0].find(instance => instance.skillId === 'hairdryer')!.remainingUses,
    };
  }, null, { timeout: 15_000, polling: 100 });
  const info = (await applied.jsonValue())!;
  await expect(page.locator('.skill-announce')).toContainText('吹风机');
  expect(info.ballId).toBe(target);
  expect(info.deceleration).toBeGreaterThan(0);
  expect(info.uses).toBe(0);
});

test('假自由球由真实按钮发动，对手实际放置白球立即触发特殊犯规', async ({ page }) => {
  await startCreativePractice(page, ['假自由球']);
  await page.locator('[data-skills="0"] .skill-card').filter({ hasText: '假自由球' }).click();
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().rule.currentPlayer)).toBe(1);
  await expect(page.locator('.fake-timer')).toHaveCount(0);
  await expect(page.locator('.skill-announce')).toHaveCount(0);
  await clickTable(page, { x: -0.2, y: 0.2 });
  // 点击只移动光标；Enter/Space 确认放置才触发假自由球的特殊犯规。
  await page.keyboard.press('Enter');
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().rule.currentPlayer)).toBe(0);
  const state = await page.evaluate(() => window.__creativeEight!.getState());
  expect(state.rule.ballInHand).toBe(true);
  expect(state.fake).toBeNull();
  expect(state.rule.shotNumber).toBe(0);
  expect(state.skills[0].find(instance => instance.skillId === 'fakeFreeBall')!.remainingUses).toBe(0);
});

test('假自由球超时只结算一次并让对手获得真自由球', async ({ page }) => {
  await startCreativePractice(page, ['假自由球']);
  await page.locator('[data-skills="0"] .skill-card').filter({ hasText: '假自由球' }).click();
  // 主循环按真实时间推进假自由球（10 秒寿命）。软件渲染慢帧下，发动到读状态之间的
  // 真实间隙可能把 elapsed 推过 10 秒造成提前超时。发动后立即暂停冻结真实时间，
  // 使 advanceTime 成为唯一时间源，再按已冻结的 elapsedMs 相对推进，结果完全确定。
  await page.evaluate(() => window.__creativeEight!.pause(true));
  await expect.poll(async () => page.evaluate(() => window.__creativeEight!.getState().fake?.status)).toBe('active');
  const elapsed = await page.evaluate(() => window.__creativeEight!.getState().fake!.elapsedMs);
  await page.evaluate(ms => window.__creativeEight!.advanceTime(ms), 9_000 - elapsed);
  expect(await page.evaluate(() => window.__creativeEight!.getState().fake?.status)).toBe('active');
  await page.evaluate(() => window.__creativeEight!.advanceTime(1_100));
  const state = await page.evaluate(() => window.__creativeEight!.getState());
  expect(state.rule.currentPlayer).toBe(1);
  expect(state.rule.ballInHand).toBe(true);
  expect(state.fake).toBeNull();
  expect(state.rule.shotNumber).toBe(0);
  await expect(page.locator('.fake-timer')).toHaveCount(0);
});

test('十分钟加时双方真实二选一，同名新实例独立且只触发一次', async ({ page }) => {
  await startCreativePractice(page);
  const oldIds = await page.evaluate(() => window.__creativeEight!.getState().skills[0].map(instance => instance.instanceId));
  await page.evaluate(() => window.__creativeEight!.advanceTime(600_000));
  await confirmDraft(page, 2, 1);
  await confirmDraft(page, 2, 1);
  const state = await page.evaluate(() => window.__creativeEight!.getState());
  expect(state.skills[0]).toHaveLength(4);
  expect(state.skills[1]).toHaveLength(4);
  expect(state.skills[0].filter(instance => instance.source === 'overtime')).toHaveLength(1);
  expect(state.skills[0].every(instance => !oldIds.includes(instance.instanceId) || instance.source === 'opening')).toBe(true);
  expect(state.elapsedMs).toBeGreaterThanOrEqual(600_000);
  await page.evaluate(() => window.__creativeEight!.advanceTime(600_000));
  await expect(page.locator('.draft-option').first()).toBeHidden();
  expect((await page.evaluate(() => window.__creativeEight!.getState())).skills[0]).toHaveLength(4);
});

test('合法清台后打进 8 号显示胜负并可重开，窗口缩放保留场景', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await page.evaluate(() => {
    const debug = window.__creativeEight!;
    debug.cancelAi();
    for (let id = 1; id <= 7; id += 1) debug.removeBall(id);
    debug.setGroups(0, 'solids');
    debug.setBall(8, { x: 1.08, y: 0.45 });
    debug.setBall(0, { x: 0.86, y: 0.24 });
    debug.setCurrentPlayer(0);
  });
  await clickBall(page, 8);
  // 第十三轮球速上限 10、摩擦 0.7：力度 17% = 0.17×10 = 1.70 m/s。中杆白球全球撞击后跟进，
  // ≥1.80 m/s（力度 18）会跟袋洗袋判负（40/40 种子实测）；1.70 m/s 稳妥打进 8 号且白球不洗袋，
  // 跨 40 个球堆种子实测 40/40 获胜（力度 10–17 全胜、18–24 全洗袋）。轨迹与速度一一对应、确定性不变。
  await page.locator('[data-power]').evaluate((input: HTMLInputElement) => {
    input.value = '17';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('[data-strike]').click();
  await expect(page.getByRole('heading', { name: '甲方获胜' })).toBeVisible({ timeout: 15_000 });
  await page.setViewportSize({ width: 960, height: 640 });
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.locator('[data-restart]').click();
  await expect(page.locator('[data-shots]')).toHaveText('0');
  await expect(page.getByRole('heading', { name: '甲方获胜' })).toHaveCount(0);
});
