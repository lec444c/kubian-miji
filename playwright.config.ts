import { defineConfig } from '@playwright/test';

const previewPort = Number(process.env.PLAYWRIGHT_PORT ?? 4273);

export default defineConfig({
  testDir: './e2e',
  // 第十二轮：摩擦 0.7 + 表现层 0.85 慢放使滚动结算墙钟时间约增 60%，
  // 软件渲染（约 1 FPS、每帧最多推进 0.25s 模拟）下开球结算需要更大预算。
  timeout: 180_000,
  // 第九轮慢放后，击球结算类轮询（等 aiming/顶视落定）在软件渲染下需要更长时间；
  // 轮询命中即返回，放宽上限只影响失败等待，不拖慢通过用例。
  expect: { timeout: 60_000 },
  // 咖啡馆 HDRI + 传统球桌场景在 headless 软件渲染下较重，
  // 并行 worker 会互相挤占主线程导致点击超时，串行执行更稳定。
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
    viewport: { width: 1280, height: 800 },
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run preview -- --port ${previewPort} --strictPort`,
    url: `http://127.0.0.1:${previewPort}`,
    // Never silently run acceptance tests against another project's preview.
    reuseExistingServer: false,
  },
});
