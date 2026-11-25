import { test, expect, type Page } from '@playwright/test';

async function draftDuel(page: Page): Promise<void> {
  const options = page.locator('.draft-option');
  await expect(options).toHaveCount(4);
  await options.filter({ hasText: '绅士决斗' }).click();
  await options.filter({ hasText: '手部微操' }).click();
  await options.filter({ hasText: '假自由球' }).click();
  await page.locator('[data-confirm]').click();
  await expect(page.locator('.draft-option').first()).toBeHidden();
}

async function enterDuel(page: Page): Promise<void> {
  const card = page.locator('[data-skills="0"] .skill-card').filter({ hasText: '绅士决斗' });
  await expect(card).toBeEnabled();
  await card.click();
  await expect(page.locator('.fight-mode[data-duel="true"]')).toBeVisible();
  await expect(page.locator('[data-fight-center]')).toContainText('加载中');
  await expect(page.locator('.fight-mode')).toHaveAttribute('data-ready', 'true', { timeout: 150_000 });
  await expect(page.locator('.fight-mode')).toHaveAttribute('data-load-progress', '100');
  await expect(page.locator('[data-fight-exit]')).toHaveText('放弃决斗');
}

test('绅士决斗：开球前即可展开，格斗胜者直接赢下台球比赛', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = []; const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = request.url(); if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:')) external.push(url); });
  await page.goto('/');
  await page.getByRole('button', { name: '开 局' }).click();
  await draftDuel(page);
  // 尚在开球摆位、一次球都未击打时使用，验证「对局任意时刻」。
  expect(await page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('breakPlacement');
  await enterDuel(page);
  await page.screenshot({ path: 'shots-fight/duel-ui.png' });
  await page.locator('[data-fight-training]').click();
  await page.evaluate(() => window.__cueFight!.arrange(-0.8, 0.8));
  await page.evaluate(() => window.__cueFight!.setHp(1, 20));
  // 木桩不还手，一次重击（伤害 20）即 KO；胜者产生后格斗会在 2.4 秒墙钟内自动返回球局。
  await page.keyboard.press('k');
  await expect(page.locator('.winner-overlay h2')).toContainText('甲方获胜', { timeout: 180_000 });
  await expect(page.locator('.winner-overlay p')).toContainText('绅士决斗');
  await expect(page.locator('.fight-mode')).toHaveCount(0);
  const state = await page.evaluate(() => window.__creativeEight!.getState());
  expect(state.phase).toBe('gameOver');
  expect(state.rule.winner).toBe(0);
  await page.screenshot({ path: 'shots-fight/duel-result.png' });
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('放弃绅士决斗退回原球局：技能已用且不宣布胜负', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto('/');
  await page.getByRole('button', { name: '开 局' }).click();
  await draftDuel(page);
  const phaseBefore = await page.evaluate(() => window.__creativeEight!.getState().phase);
  await enterDuel(page);
  await page.locator('[data-fight-exit]').click();
  await expect(page.locator('.fight-mode .exit-dialog')).toBeVisible();
  await expect(page.locator('.fight-mode .exit-dialog h2')).toContainText('放弃决斗');
  await page.locator('.fight-mode [data-exit-confirm]').click();
  await expect(page.locator('.fight-mode')).toHaveCount(0);
  const after = await page.evaluate(() => window.__creativeEight!.getState());
  expect(after.phase).toBe(phaseBefore);
  expect(after.rule.winner).toBeNull();
  await expect(page.locator('[data-skills="0"] .skill-card').filter({ hasText: '绅士决斗' })).toContainText('已用');
});
