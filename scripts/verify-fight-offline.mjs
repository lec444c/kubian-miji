import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ headless: true });
const errors = []; const external = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await page.goto(pathToFileURL(resolve(root, 'release/库边秘技-试玩版.html')).href, { timeout: 120_000 });
  await page.locator('[data-fight-entry]').click();
  await page.locator('.fight-mode[data-ready="true"]').waitFor({ timeout: 120_000 });
  assert.equal(await page.locator('.fight-mode').getAttribute('data-load-progress'), '100');
  await page.locator('[data-fight-training]').click();
  await page.evaluate(() => window.__cueFight.arrange(-0.8, 0.8));
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__cueFight.getState().fighters[1].hp < 200, null, { timeout: 120_000 });
  const fight = await page.evaluate(() => window.__cueFight.getState());
  assert.equal(fight.visuals.motionCount, 14);
  assert.equal(fight.visuals.actorCount, 2);
  assert.deepEqual([...fight.visuals.characterAssignment].sort(), ['indian', 'indian']);
  assert.equal(fight.visuals.skills.dogLoaded, true);
  assert.equal(fight.visuals.skills.particleTextures, 14);
  assert.equal(fight.visuals.skills.seatLabels, 2);
  fight.visuals.actors.forEach(actor => {
    assert.equal(actor.mappedBones, 64);
    assert.equal(actor.targetBoneCount, 74);
    assert.equal(actor.skinnedMeshCount, 11);
    assert.ok(actor.cueGripError < 1e-5);
  });
  assert.equal(fight.visuals.arena.table, 'traditional-table');
  assert.equal(fight.visuals.arena.room, 'sitting-room');
  assert.equal(fight.visuals.arena.ballCount, 0);
  assert.ok(Math.abs(fight.visuals.arena.surfaceY - 1.264) < 0.002);
  for (const scale of fight.visuals.arena.fighterScales) for (const axis of scale) assert.ok(Math.abs(axis - 0.288) < 1e-6);
  const afterSwing = fight.fighters[1].hp;

  await page.waitForFunction(() => window.__cueFight.getState().fighters[0].action === 'idle', null, { timeout: 120_000 });
  await page.keyboard.press('1');
  await page.waitForFunction(() => window.__cueFight.getState().fighters[1].hp < 188, null, { timeout: 120_000 });
  const ball = await page.evaluate(() => window.__cueFight.getState());
  assert.equal(ball.fighters[1].hp, 158);
  assert.ok(ball.skillCooldowns[0].ball > 0);
  assert.equal(ball.visuals.skills.lastKind, 'ball');
  assert.ok(ball.visuals.skills.catLoaded);
  await page.waitForFunction(() => window.__cueFight.getState().fighters[0].action === 'idle', null, { timeout: 120_000 });
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__cueFight.getState().fighters[1].hp < 158, null, { timeout: 120_000 });
  const cat = await page.evaluate(() => window.__cueFight.getState());
  assert.equal(cat.fighters[1].hp, 134);
  assert.ok(cat.skillCooldowns[0].cat > 0);
  assert.equal(cat.visuals.skills.lastKind, 'cat');
  await page.waitForFunction(() => window.__cueFight.getState().fighters[0].action === 'idle', null, { timeout: 120_000 });
  await page.keyboard.press('3');
  await page.waitForFunction(() => window.__cueFight.getState().visuals.skills.bows[0] === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__cueFight.getState().fighters[1].hp < 134, null, { timeout: 120_000 });
  const volley = await page.evaluate(() => window.__cueFight.getState());
  assert.equal(volley.fighters[1].hp, 114);
  assert.ok(volley.skillCooldowns[0].volley > 0);
  assert.equal(volley.visuals.skills.lastKind, 'volley');
  assert.ok(volley.visuals.skills.particles + volley.visuals.skills.rings + volley.visuals.skills.flashes > 0);
  await page.waitForFunction(() => window.__cueFight.getState().fighters[1].action === 'down', null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__cueFight.getState().fighters[1].action === 'idle', null, { timeout: 120_000 });

  // 拉开站位使猛犬冲锋约0.5秒模拟时间，低帧率下也能采样到飞行帧。
  // arrange 会重置对局，故随后把血链恢复到万杆齐发命中后的114。
  await page.evaluate(() => window.__cueFight.arrange(-3.4, 3.4));
  await page.evaluate(() => window.__cueFight.setHp(1, 114));
  await page.evaluate(() => window.__cueFight.setRage(0, 100));
  await page.keyboard.press('4');
  await page.locator('[data-fight-broadcast]:not([hidden])').waitFor({ timeout: 120_000 });
  assert.equal(await page.evaluate(() => window.__cueFight.getState().holding), true);
  const bannerLoaded = await page.evaluate(() => {
    const img = document.querySelector('[data-fight-broadcast] img');
    return img instanceof HTMLImageElement && img.naturalWidth > 0 && img.src.startsWith('data:');
  });
  assert.equal(bannerLoaded, true);
  mkdirSync(resolve(root, 'shots-fight'), { recursive: true });
  // 软件渲染帧间隔可能超过2.6秒墙钟动画窗口，轮询采样永远赶不上全不透明帧；
  // 在同一个页面任务里找到动画立刻暂停并定格在1秒平台段，避免等待与隐藏竞态；
  // 断言不透明度后截图，拍完恢复播放。
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-fight-broadcast]');
    const anim = el && el.getAnimations()[0];
    if (!anim) return false;
    anim.pause();
    anim.currentTime = 1000;
    return true;
  }, null, { polling: 100, timeout: 15_000 });
  const broadcastOpacity = await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-fight-broadcast]')).opacity));
  assert.equal(broadcastOpacity, 1);
  await page.screenshot({ path: resolve(root, 'shots-fight/offline-dog-broadcast.png') });
  await page.evaluate(() => { const anim = document.querySelector('[data-fight-broadcast]').getAnimations()[0]; if (anim) anim.play(); });
  // 低帧率下轮询与点击之间会隔好几帧，狗早已命中消失；在观察到投射物的同一帧内
  // 页内点击暂停，把出生帧定格后再截图，才能拍到飞行中的狗。
  await page.waitForFunction(() => {
    if (window.__cueFight.getState().visuals.skills.projectiles > 0) {
      document.querySelector('[data-fight-pause]').click();
      return true;
    }
    return false;
  }, null, { timeout: 120_000 });
  // 暂停面板正好挡住奔向中线的狗头，仅测试期隐藏它拍下完整冲刺姿态，拍完立即移除。
  const hideCenter = await page.addStyleTag({ content: '[data-fight-center]{visibility:hidden}' });
  await page.screenshot({ path: resolve(root, 'shots-fight/offline-dog-flight.png') });
  await hideCenter.evaluate(el => el.remove());
  await page.locator('[data-fight-pause]').click();
  await page.waitForFunction(() => window.__cueFight.getState().fighters[1].hp < 114, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__cueFight.getState().visuals.skills.lingered >= 1, null, { timeout: 120_000 });
  const dog = await page.evaluate(() => window.__cueFight.getState());
  assert.equal(dog.fighters[1].hp, 54);
  assert.equal(dog.fighters[1].action, 'down');
  assert.equal(dog.fighters[1].downDuration, 3);
  assert.equal(dog.fighters[0].rage, 0);
  assert.equal(dog.visuals.skills.lastKind, 'dog');
  assert.ok(dog.visuals.skills.lingered >= 1);
  assert.ok(dog.visuals.skills.particles + dog.visuals.skills.rings + dog.visuals.skills.flashes > 0);
  await page.screenshot({ path: resolve(root, 'shots-fight/offline-dog-hit.png') });
  await page.waitForFunction(() => window.__cueFight.getState().fighters[1].action === 'idle', null, { timeout: 180_000 });

  await page.screenshot({ path: resolve(root, 'shots-fight/offline.png') });
  await page.locator('[data-fight-exit]').click();
  await page.locator('.fight-mode [data-exit-confirm]').click();
  await page.locator('.menu-overlay:not(.hidden)').waitFor();
  assert.equal(await page.evaluate(() => typeof window.__cueFight), 'undefined');
  assert.equal(await page.evaluate(() => window.__creativeEight.getState().phase), 'menu');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({
    offline: true, clips: fight.visuals.motionCount, fighters: fight.visuals.actorCount,
    swingDamage: 200 - afterSwing, ballDamage: 188 - ball.fighters[1].hp,
    catDamage: 158 - cat.fighters[1].hp, volleyDamage: 134 - volley.fighters[1].hp,
    dogDamage: 114 - dog.fighters[1].hp, bannerInline: bannerLoaded,
    catLoaded: ball.visuals.skills.catLoaded, dogLoaded: fight.visuals.skills.dogLoaded,
    particleTextures: fight.visuals.skills.particleTextures, seatLabels: fight.visuals.skills.seatLabels,
    returnedToMenu: true, errors, external,
  }, null, 2));
} finally { await browser.close(); }
