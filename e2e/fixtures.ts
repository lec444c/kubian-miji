import { test as base, expect } from '@playwright/test';

/**
 * 咖啡馆 HDRI + 传统球桌场景在 headless 软件 WebGL 下渲染很重，
 * 全分辨率时固定步模拟每帧最多推进 0.25 秒，滚动结算会超出测试预算。
 * 每次导航后把渲染像素比降到 0.4（仅测试环境），逻辑与断言不受影响；
 * 视觉验收由 scripts/round3-shots.mjs 在全画质下单独完成。
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const originalGoto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await originalGoto(url, options);
      await page.evaluate(() => { window.__creativeEight?.renderScale(0.4); });
      return response;
    };
    await use(page);
  },
});

export { expect };