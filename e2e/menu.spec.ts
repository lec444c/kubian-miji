import { test, expect } from './fixtures';

test('经典中八可进入单人对局并显示三维球桌', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '库边秘技' })).toBeVisible();
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect(page.locator('.hud')).toBeVisible();
  await expect(page.locator('[data-status-title]')).toHaveText('开球摆位');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-strike]')).toBeEnabled();
  await expect(page.locator('[data-rule]')).toHaveText('经典中八');
});

test('创意中八展示真实四个候选并获得三个技能', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开 局' }).click();
  await expect(page.locator('.draft-option')).toHaveCount(4);
  await page.locator('.draft-option').nth(0).click();
  await page.locator('.draft-option').nth(1).click();
  await page.locator('.draft-option').nth(2).click();
  await page.locator('[data-confirm]').click();
  await expect(page.locator('[data-skills="0"] .skill-card')).toHaveCount(3);
  await page.keyboard.press('Space');
  await expect(page.locator('[data-strike]')).toBeEnabled();
});

test('练习模式不会由后台 AI 自动击球', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await expect(page.locator('[data-shots]')).toHaveText('0');
  await expect(page.locator('[data-strike]')).toBeEnabled();
});
