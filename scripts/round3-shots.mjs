import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:4173/';
const OUT = 'D:/game race/shots-round3';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });
const state = () => page.evaluate(() => window.__creativeEight.getState());

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
// 软件渲染全画质帧率过低会让等待帧的断言超时；0.6 渲染比例仍足够核实视觉。
await page.evaluate(() => window.__creativeEight.renderScale(0.6));
await page.waitForTimeout(2500);
await shot('01-menu-light');

// 创意单人：技能抽取对话框（game-icons 图标）
await page.getByRole('button', { name: '开 局' }).click();
await page.waitForSelector('.draft-option', { timeout: 30000 });
await shot('02-draft-icons');
for (let i = 0; i < 3; i += 1) await page.locator('.draft-option').nth(i).click();
await page.locator('[data-confirm]').click();
await page.evaluate(() => { window.__creativeEight.cancelAi(); window.__creativeEight.reducedMotion(true); });
await page.waitForFunction(() => window.__creativeEight.getState().view.traditionalFit !== null, null, { timeout: 45000 });
await page.waitForFunction(() => window.__creativeEight.getState().view.roomBackground === true, null, { timeout: 45000 });
// 开局开球摆位：自动顶视 + 开球线 + 白球光标。
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'breakPlacement', null, { timeout: 30000 });
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'top', null, { timeout: 30000 });
await page.waitForTimeout(1500);
await shot('03-break-placement-top');
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming', null, { polling: 100, timeout: 30000 });
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'aim', null, { timeout: 30000 });
await page.waitForTimeout(1500);
// 默认瞄准球堆：绿色白球辅助线 + 琥珀色目标球方向短线。
await shot('04-aim-two-lines');

// 设置面板（音量 / 静音 / 动效 / 画质）
await page.locator('[data-settings]').click();
await page.waitForSelector('.dialog.settings:not(.hidden)', { timeout: 15000 });
await shot('05-settings-dialog');
await page.locator('[data-done]').click();

// 顶视：吊灯应隐藏，避免穿模（镜头循环 aim→orbit→top，按两次到顶视）
await page.keyboard.press('o');
await page.keyboard.press('o');
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'top', null, { timeout: 15000 });
await page.waitForTimeout(1200);
await shot('06-top-view-no-lamp');
await page.keyboard.press('z');
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'aim', null, { timeout: 15000 });

// 自由球光标：假自由球期间乙方移动白球触发特殊犯规 → 甲方获得真自由球。
// 超时分支的真自由球归乙方（AI 自行放置，无人类光标），故用 debug placeCue
// 确定性走犯规分支，避免依赖 AI 随机等待分支。
await page.locator('[data-skills="0"] .skill-card').filter({ hasText: '假自由球' }).click();
await page.waitForFunction(() => window.__creativeEight.getState().fake !== null, null, { polling: 100, timeout: 15000 });
await page.evaluate(() => window.__creativeEight.placeCue({ x: -0.6, y: 0 }));
await page.waitForFunction(() => window.__creativeEight.getState().placementCursor !== null, null, { polling: 100, timeout: 15000 });
// 自由球同样自动顶视。
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'top', null, { timeout: 15000 });
await page.keyboard.press('d');
await page.keyboard.press('s');
await page.waitForTimeout(900);
await shot('07-ball-in-hand-top');
await page.keyboard.press('Enter');
// AI 观察分支下放置后 aiming 窗口仅约 0.9s；软件渲染低帧率时 raf 轮询会整窗跳过，
// 改用独立于渲染帧的 100ms 间隔轮询，并覆盖 AI 10.2s 真实时间观察期。
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming', null, { polling: 100, timeout: 30000 });

// 击球后滚动：自动顶视 + 咖啡馆背景 + 传统球桌
await page.keyboard.down('Space');
// 第十三轮摩擦 0.7、上限 10：满蓄力开球散开充分（自动补力 0.88 兜底）；随机种子下可能合法洗袋→自由球。
await page.waitForTimeout(1400);
await page.keyboard.up('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'rolling', null, { timeout: 20000 });
await page.waitForFunction(() => window.__creativeEight.getState().view.camera.mode === 'top', null, { timeout: 20000 });
await page.waitForTimeout(1200);
await shot('08-rolling-top');
await page.waitForFunction(() => window.__creativeEight.getState().phase !== 'rolling', null, { timeout: 300000 });

const final = await state();
console.log('ROUND3 SHOTS OK', JSON.stringify({
  phase: final.phase,
  camera: final.view.camera.mode,
  traditionalFit: final.view.traditionalFit,
  roomBackground: final.view.roomBackground,
  placementCursor: final.placementCursor,
}), 'pageErrors=', errors.length, errors.slice(0, 3));
await browser.close();