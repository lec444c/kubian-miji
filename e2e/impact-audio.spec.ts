import { test, expect } from './fixtures';

test('真实出杆与撞球分别播放用户录音的两段采样，而不是旧音效或合成回退', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/audio/sfx/')) requests.push(new URL(request.url()).pathname);
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as typeof window & { __impactPlayback: number[] };
    state.__impactPlayback = [];
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<AudioBufferSourceNode['start']>) {
      if (this.buffer) state.__impactPlayback.push(this.buffer.duration);
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.audio().loadedSamples.sort())).toEqual(['collision', 'cushion', 'hairdryer', 'pocket', 'strike']);
  await page.keyboard.press('Space');
  await page.evaluate(() => {
    const api = window.__creativeEight!;
    api.getState().rule.isBreak = false;
    api.setCurrentPlayer(0);
    api.setBall(0, { x: 0, y: 0.13 });
    api.setBall(1, { x: 0, y: 0.46 });
    api.aim(Math.PI / 2);
    const power = document.querySelector<HTMLInputElement>('[data-power]')!;
    power.value = '11';
    power.dispatchEvent(new Event('input', { bubbles: true }));
    (window as typeof window & { __impactPlayback: number[] }).__impactPlayback = [];
  });
  await page.locator('[data-strike]').click();
  await expect.poll(() => page.evaluate(() => {
    const played = (window as typeof window & { __impactPlayback: number[] }).__impactPlayback;
    return [0.162, 0.173].map(duration => played.some(value => Math.abs(value - duration) < .0002));
  })).toEqual([true, true]);
  await expect(page.locator('[data-pocketed] [data-ball-id="1"]')).toBeVisible();
  expect(requests).toContain('/assets/audio/sfx/cue-strike-user.wav');
  expect(requests).toContain('/assets/audio/sfx/ball-hit-user.wav');
  expect(requests).not.toContain('/assets/audio/sfx/cue-strike.ogg');
  expect(requests).not.toContain('/assets/audio/sfx/ball-hit.ogg');
  expect(errors).toEqual([]);
});
