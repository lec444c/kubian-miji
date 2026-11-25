import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function startClassic(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await page.evaluate(() => { window.__creativeEight!.cancelAi(); window.__creativeEight!.reducedMotion(true); });
  await expect(page.locator('[data-turn-target]')).toContainText('开球阶段');
}

test('七首本地音乐均可手选播放，暂停不会被对局操作恢复，播完继续随机', async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      Object.defineProperty(window, '__lastMusic', { value: this, configurable: true });
      return play.call(this);
    };
  });
  await startClassic(page);
  await page.locator('[data-playlist-open]').click();
  await expect(page.locator('[data-playlist]')).toHaveAttribute('open', '');
  await expect(page.locator('[data-track]')).toHaveCount(7);
  await expect(page.locator('[data-playlist] summary')).toContainText('随机播放');
  for (let index = 0; index < 7; index++) {
    await page.locator(`[data-track="${index}"]`).click();
    await expect.poll(() => page.evaluate(() => window.__creativeEight!.audio().trackIndex)).toBe(index);
    await expect(page.locator(`[data-track="${index}"] .track-state`)).toHaveText('播放中');
    await expect.poll(() => page.evaluate(() => {
      const audio = (window as unknown as { __lastMusic: HTMLAudioElement }).__lastMusic;
      return audio.currentTime > 0 && Number.isFinite(audio.duration) && !audio.error;
    })).toBe(true);
  }
  await page.locator('[data-music-toggle]').click();
  await expect(page.locator('[data-music-toggle]')).toHaveText('继续音乐');
  await page.locator('[data-done]').click();
  await page.locator('[data-hints]').click();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.audio().bgmPlaying)).toBe(false);
  await page.locator('[data-playlist-open]').click();
  await expect(page.locator('[data-now-playing]')).toContainText('已暂停');
  await page.locator('[data-music-toggle]').click();
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.audio().bgmPlaying)).toBe(true);
  const previous = await page.evaluate(() => window.__creativeEight!.audio().trackIndex);
  await page.evaluate(() => (window as unknown as { __lastMusic: HTMLAudioElement }).__lastMusic.dispatchEvent(new Event('ended')));
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.audio().trackIndex)).not.toBe(previous);
  await expect(page.locator('[data-playlist] summary')).toContainText('随机播放');
  const next = await page.evaluate(() => window.__creativeEight!.audio().trackIndex);
  await page.locator('[data-music-next]').click();
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.audio().trackIndex)).not.toBe(next);
});

test('音乐资源全部失败时给出有界错误，恢复资源后可以重试', async ({ page }) => {
  let requests = 0;
  await page.route('**/assets/audio/bgm/*.mp3', route => { requests++; return route.abort(); });
  await startClassic(page);
  await page.locator('[data-playlist-open]').click();
  await expect(page.locator('[data-now-playing]')).toContainText('所有音乐均播放失败');
  await expect(page.locator('[data-music-toggle]')).toHaveText('重试播放');
  expect(requests).toBe(7);
  await page.unroute('**/assets/audio/bgm/*.mp3');
  await page.locator('[data-music-toggle]').click();
  await expect(page.locator('[data-track][aria-pressed="true"] .track-state')).toHaveText('播放中');
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.audio().bgmPlaying)).toBe(true);
});

test('未分球与已分球均显示准确入袋球号，复位即时移除', async ({ page }) => {
  await startClassic(page);
  await expect(page.locator('[data-pocketed]')).toHaveText('尚无进球');
  await page.evaluate(() => { window.__creativeEight!.removeBall(3); window.__creativeEight!.removeBall(12); });
  await expect(page.locator('[data-pocketed] [data-ball-id]')).toHaveCount(2);
  await expect(page.locator('[data-pocketed] [data-ball-id="3"]')).toBeVisible();
  await expect(page.locator('[data-pocketed] [data-ball-id="12"]')).toBeVisible();
  await expect(page.locator('[data-meta="0"]')).toHaveText('开放球台');
  await page.evaluate(() => { window.__creativeEight!.setGroups(0, 'solids'); window.__creativeEight!.setCurrentPlayer(0); });
  await expect(page.locator('[data-dots="0"] [data-ball-id="3"]')).toHaveClass(/potted/);
  await expect(page.locator('[data-dots="0"] [data-ball-id="7"]')).not.toHaveClass(/potted/);
  await expect(page.locator('[data-dots="1"] [data-ball-id="12"]')).toHaveClass(/potted/);
  await expect(page.locator('[data-turn-target]')).toContainText('甲方目标：全色球');
  await page.evaluate(() => window.__creativeEight!.setBall(3, { x: -0.2, y: 0 }));
  await expect(page.locator('[data-pocketed] [data-ball-id]')).toHaveCount(1);
  await expect(page.locator('[data-dots="0"] [data-ball-id="3"]')).not.toHaveClass(/potted/);
  await page.evaluate(() => { for (let id = 1; id <= 7; id++) window.__creativeEight!.removeBall(id); });
  await expect(page.locator('[data-turn-target]')).toContainText('目标：8号球');
  await page.reload();
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await expect(page.locator('[data-pocketed]')).toHaveText('尚无进球');
  await expect(page.locator('[data-group-announcement]')).toBeHidden();
});

test('真实合法进球首次分组后在顶部公告双方球型', async ({ page }) => {
  await startClassic(page);
  await page.keyboard.press('Space');
  await page.evaluate(() => {
    const api = window.__creativeEight!;
    // 非开球的开放球台；保持其余全色球在台，避免误测成击8阶段。
    const state = api.getState();
    state.rule.isBreak = false;
    api.setBall(0, { x: 0, y: 0.13 });
    api.setBall(1, { x: 0, y: 0.46 });
    api.setCurrentPlayer(0);
    api.strike(Math.PI / 2, 0.11);
  });
  await expect(page.locator('[data-group-announcement]')).toContainText('甲方击打全色球（1–7号）');
  await expect(page.locator('[data-group-announcement]')).toContainText('乙方击打花色球（9–15号）');
  await expect(page.locator('[data-pocketed] [data-ball-id="1"]')).toBeVisible();
  await expect(page.locator('[data-turn-target]')).toContainText('甲方目标：全色球');
  await page.screenshot({ path: 'test-results/group-assignment.png' });
});

test('窄屏歌单和进球栏不超出视口，键盘选歌不触发击球', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startClassic(page);
  await page.evaluate(() => { for (const id of [1, 3, 5, 8, 10, 12, 15]) window.__creativeEight!.removeBall(id); });
  await expect(page.locator('[data-pocketed] [data-ball-id]')).toHaveCount(7);
  for (const selector of ['.scoreboard', '.pocket-tray', '.status-actions']) {
    const rect = await page.locator(selector).boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(391);
  }
  await page.screenshot({ path: 'test-results/mobile-pocket-tray.png' });
  await page.locator('[data-playlist-open]').click();
  await page.locator('[data-track="5"]').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.audio().trackIndex)).toBe(5);
  expect(await page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('breakPlacement');
  await page.screenshot({ path: 'test-results/mobile-playlist.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.dialog.settings')).toBeHidden();
  await page.evaluate(() => window.__creativeEight!.setCurrentPlayer(0));
  await page.locator('[data-playlist-open]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.dialog.settings')).toBeVisible();
  expect(await page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
  expect(await page.evaluate(() => window.__creativeEight!.getState().charging)).toBe(false);
});
