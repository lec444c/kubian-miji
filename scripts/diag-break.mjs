// 第十三轮诊断：摩擦 0.7、球速上限 10 下各力度开球是否满足“至少四颗目标球碰库”。
// 真实 Chrome（channel:'chrome'）全画质运行，逐力度新开一局，读取结算消息。
// 0.88 为自动补力（8.8 m/s，袋角修正后 100/100 种子合法）；1.0=10 m/s 随机种子下可能合法洗袋→自由球。
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const POWERS = [0.56, 0.68, 0.8, 0.88, 1.0];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', error => console.log('PAGEERROR', error.message));

for (const power of POWERS) {
  await page.goto(BASE);
  await page.locator('[data-field="mode"] [data-value="classic"]').click();
  await page.locator('[data-field="playMode"] [data-value="practice"]').click();
  await page.getByRole('button', { name: '开 局' }).click();
  await page.evaluate(() => window.__creativeEight.cancelAi());
  await page.waitForFunction(() => window.__creativeEight.getState().phase === 'breakPlacement');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming');
  await page.evaluate(p => {
    window.__creativeEight.aim(0);
    window.__creativeEight.strike(0, p);
  }, power);
  await page.waitForFunction(() => {
    const phase = window.__creativeEight.getState().phase;
    return phase === 'aiming' || phase === 'ballInHand' || phase === 'gameOver';
  }, { timeout: 60_000 });
  const result = await page.evaluate(() => ({
    phase: window.__creativeEight.getState().phase,
    message: document.querySelector('[data-message]')?.textContent ?? '',
    potted: window.__creativeEight.getState().simulation.balls.filter(b => b.pocketed).map(b => b.id),
  }));
  console.log(`POWER ${power.toFixed(2)} -> ${result.phase} | ${result.message} | potted=[${result.potted}]`);
  if (result.phase === 'ballInHand') {
    // 犯规后默认落点可能贴球/落袋：Space 必须一次确认（合法落点回退扫描）。
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    const confirmed = await page.evaluate(() => window.__creativeEight.getState().phase);
    console.log(`POWER ${power.toFixed(2)} SPACE-CONFIRM -> ${confirmed}`);
    if (confirmed !== 'aiming') process.exitCode = 1;
  }
}

await browser.close();