import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', error => console.log('PAGEERROR', error.message));
await page.goto('http://127.0.0.1:4284/');
await page.locator('[data-fight-entry]').click();
await page.waitForSelector('.fight-mode[data-ready="true"]', { timeout: 150_000 });
await page.locator('[data-fight-training]').click();
await page.evaluate(() => window.__cueFight.arrange(-0.8, 0.8));
await page.evaluate(() => {
  window.__probe = [];
  setInterval(() => {
    const s = window.__cueFight?.getState();
    if (s) window.__probe.push([s.visuals.skills.projectiles, s.visuals.skills.lingering, s.visuals.skills.lingered, s.fighters[1].hp]);
  }, 60);
});
await page.keyboard.press('1');
await page.waitForTimeout(25_000);
const probe = await page.evaluate(() => window.__probe);
const interesting = probe.filter((row, index) => index === 0 || JSON.stringify(row) !== JSON.stringify(probe[index - 1]));
console.log('samples', probe.length, 'changes', JSON.stringify(interesting.slice(0, 60)));
await browser.close();
