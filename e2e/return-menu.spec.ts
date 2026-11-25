import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function start(page: Page, creative = false, solo = false): Promise<void> {
  await page.goto('/');
  await page.locator(`[data-field="mode"] [data-value="${creative ? 'creative' : 'classic'}"]`).click();
  if (!solo) await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  if (creative) await draft(page, solo ? 1 : 2);
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('breakPlacement');
}

async function draft(page: Page, seats = 2): Promise<void> {
  for (let seat = 0; seat < seats; seat++) {
    for (let index = 0; index < 3; index++) await page.locator('.draft-option').nth(index).click();
    await page.locator('[data-confirm]').click();
  }
}

async function exit(page: Page): Promise<void> {
  await page.locator('[data-exit]').click();
  await expect(page.getByRole('dialog', { name: '返回主菜单？' })).toBeVisible();
  await page.locator('[data-exit-confirm]').click();
  await expect(page.getByRole('button', { name: '开 局' })).toBeVisible();
  expect(await page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('menu');
}

test('退出确认隔离键盘，取消保留摆位和原暂停状态', async ({ page }) => {
  await start(page);
  await page.keyboard.press('KeyD');
  const placement = await page.evaluate(() => window.__creativeEight!.getState().placementCursor);
  await page.locator('[data-exit]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-exit-cancel]')).toBeFocused();
  expect(await page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('breakPlacement');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-exit]')).toBeFocused();
  await expect(page.locator('[data-pause]')).toHaveText('暂停');
  expect(await page.evaluate(() => window.__creativeEight!.getState().placementCursor)).toEqual(placement);
  await page.locator('[data-pause]').click();
  await page.locator('[data-exit]').click();
  await page.locator('[data-exit-cancel]').click();
  await expect(page.locator('[data-pause]')).toHaveText('继续');
  const elapsed = await page.evaluate(() => window.__creativeEight!.getState().elapsedMs);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__creativeEight!.getState().elapsedMs)).toBe(elapsed);
  await page.locator('[data-pause]').click();
  await page.locator('#game-canvas').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
});

test('运动中退出清空旧局，音乐暂停、音量及显示设置保留，重新开局正常', async ({ page }) => {
  await start(page);
  await page.locator('[data-playlist-open]').click();
  await page.locator('[data-track="4"]').click();
  await expect(page.locator('[data-music-toggle]')).toHaveText('暂停音乐');
  await page.locator('[data-music-toggle]').click();
  for (const [selector, value] of [['[data-music]', '27'], ['[data-sfx]', '41']]) {
    await page.locator(selector!).evaluate((element, number) => {
      (element as HTMLInputElement).value = number!;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  await page.locator('[data-motion]').click();
  await page.locator('[data-done]').click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Space');
  await page.locator('[data-strike]').click();
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('rolling');
  await exit(page);
  const stopped = await page.evaluate(() => window.__creativeEight!.getState());
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__creativeEight!.getState())).toMatchObject({ phase: 'menu', elapsedMs: 0, simulation: stopped.simulation });
  await page.getByRole('button', { name: '开 局' }).click();
  const fresh = await page.evaluate(() => window.__creativeEight!.getState());
  expect(fresh.phase).toBe('breakPlacement');
  expect(fresh.rule.shotNumber).toBe(0);
  expect(fresh.simulation.balls.filter(ball => ball.onTable)).toHaveLength(16);
  expect(fresh.human.spin).toEqual({ x: 0, y: 0 });
  expect(fresh.cueLocked).toBe(false);
  await page.locator('[data-playlist-open]').click();
  await expect(page.locator('[data-music-toggle]')).toHaveText('继续音乐');
  await expect(page.locator('[data-music]')).toHaveValue('27');
  await expect(page.locator('[data-sfx]')).toHaveValue('41');
  await expect(page.locator('[data-motion]')).toHaveText('恢复动效');
  await page.locator('[data-done]').click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Space');
  await page.locator('[data-strike]').click();
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('rolling');
});

test('抽选阶段也能退出，窄屏确认框和退出入口不溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '开 局' }).click();
  await page.locator('[data-draft-exit]').click();
  const dialog = page.locator('.exit-dialog');
  const rect = await dialog.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-exit.png' });
  await page.locator('[data-exit-confirm]').click();
  await expect(page.getByRole('button', { name: '开 局' })).toBeFocused();
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  const button = await page.locator('[data-exit]').boundingBox();
  expect(button!.x).toBeGreaterThanOrEqual(0);
  expect(button!.x + button!.width).toBeLessThanOrEqual(390);
  await exit(page);
});

for (const scenario of ['targeting', 'fake', 'hand'] as const) {
  test(`${scenario} 技能期间退出并立即重开，无旧局状态或异步动画污染`, async ({ page }) => {
    await start(page, true);
    const result = await page.evaluate(async which => {
      const debug = window.__creativeEight!;
      // 手部微操只能在对手回合发动，假自由球则是己方回合。
      debug.setCurrentPlayer(which === 'fake' ? 0 : 1);
      debug.setGroups(0, 'solids');
      debug.setBall(1, { x: 0.3, y: 0.545 });
      const operation = which === 'hand' ? debug.useSkill(0, 'hand', 1)
        : which === 'fake' ? debug.useSkill(0, 'fakeFreeBall') : debug.useSkill(0, 'hand');
      const during = debug.getState();
      const animating = during.phase === 'skillTargeting' && document.querySelector('.target-banner')!.classList.contains('hidden');
      document.querySelector<HTMLButtonElement>('[data-exit]')!.click();
      document.querySelector<HTMLButtonElement>('[data-exit-confirm]')!.click();
      document.querySelector<HTMLButtonElement>('.start-button')!.click();
      return { applied: await operation, phase: during.phase, fake: during.fake, animating };
    }, scenario);
    if (scenario === 'fake') expect(result.fake?.status).toBe('active');
    else {
      expect(result.phase).toBe('skillTargeting');
      expect(result.applied).toBe(scenario !== 'hand');
      expect(result.animating).toBe(scenario === 'hand');
    }
    await draft(page);
    await page.waitForTimeout(2400);
    const state = await page.evaluate(() => window.__creativeEight!.getState());
    expect(state.phase).toBe('breakPlacement');
    expect(state.fake).toBeNull();
    expect(state.rule.groups).toEqual([null, null]);
    expect(state.rule.shotNumber).toBe(0);
    expect(state.skills[0]).toHaveLength(3);
    expect(state.skills[0].every(skill => skill.remainingUses === 1)).toBe(true);
    await expect(page.locator('.target-banner')).toBeHidden();
    await expect(page.locator('.skill-announce')).toHaveCount(0);
  });
}

test('待人机出杆时退出后不再推进或触发加时抽选', async ({ page }) => {
  await start(page, true, true);
  await page.keyboard.press('Space');
  await page.evaluate(() => {
    void window.__creativeEight!.useSkill(0, 'fakeFreeBall');
    document.querySelector<HTMLButtonElement>('[data-exit]')!.click();
    document.querySelector<HTMLButtonElement>('[data-exit-confirm]')!.click();
  });
  await page.evaluate(() => window.__creativeEight!.advanceTime(900_000));
  await page.waitForTimeout(1800);
  const state = await page.evaluate(() => window.__creativeEight!.getState());
  expect(state.phase).toBe('menu');
  expect(state.elapsedMs).toBe(0);
  expect(state.rule.shotNumber).toBe(0);
  await expect(page.locator('[data-confirm]')).toBeHidden();
});

test('胜负界面返回主菜单不刷新文档，可再次开局', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    document.body.dataset.documentIdentity = 'same-document';
    const debug = window.__creativeEight!;
    for (let id = 1; id <= 7; id++) debug.removeBall(id);
    debug.setGroups(0, 'solids');
    debug.setBall(8, { x: 1.08, y: 0.45 });
    debug.setBall(0, { x: 0.86, y: 0.24 });
    debug.setCurrentPlayer(0);
    debug.strike(Math.atan2(0.21, 0.22), 0.17);
  });
  await expect(page.getByRole('heading', { name: '甲方获胜' })).toBeVisible();
  await page.locator('[data-menu]').click();
  await expect(page.getByRole('button', { name: '开 局' })).toBeVisible();
  expect(await page.locator('body').getAttribute('data-document-identity')).toBe('same-document');
  await expect(page.locator('.winner-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: '开 局' }).click();
  await expect(page.locator('[data-shots]')).toHaveText('0');
});
