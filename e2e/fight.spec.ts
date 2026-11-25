import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-fight-entry]').click();
  await expect(page.locator('.fight-mode')).toHaveAttribute('data-ready', 'true', { timeout: 120_000 });
  await expect(page.locator('[data-fight-stage] canvas')).toBeVisible();
}

test('格斗加载双方同模型与P1/P2标识、原球杆与14段动作，可预览和镜像且没有外部请求或异常', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = []; const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = request.url(); if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:')) external.push(url); });
  await enter(page);
  const state = await page.evaluate(() => window.__cueFight!.getState());
  expect(state.visuals?.motionCount).toBe(14);
  expect(state.visuals?.actorCount).toBe(2);
  expect([...state.visuals!.characterAssignment].sort()).toEqual(['indian', 'indian']);
  expect(state.visuals?.skills.dogLoaded).toBe(true);
  expect(state.visuals?.skills.particleTextures).toBe(14);
  expect(state.visuals?.skills.seatLabels).toBe(2);
  await expect(page.locator('.fight-player:not(.opponent) strong')).toContainText('P1');
  await expect(page.locator('.fight-player.opponent strong')).toContainText('P2');
  await expect(page.locator('[data-rage]')).toHaveCount(2);
  expect(state.visuals?.arena.table).toBe('traditional-table');
  expect(state.visuals?.arena.room).toBe('sitting-room');
  expect(state.visuals?.arena.ballCount).toBe(0);
  expect(state.visuals?.arena.surfaceY).toBeCloseTo(0.79 * 1.6);
  for (const scale of state.visuals!.arena.fighterScales) for (const axis of scale) expect(axis).toBeCloseTo(0.18 * 1.6);
  await page.locator('[data-fight-training]').click();
  await page.evaluate(() => window.__cueFight!.arrange(-1.3, 1.3));
  await page.screenshot({ path: 'shots-fight/tabletop.png' });
  await page.locator('.fight-lab summary').click();
  for (const clip of ['idle', 'walk', 'run', 'jump', 'jumpBack', 'turn', 'turnAlt', 'impact', 'impactAlt', 'slash', 'slashAlt', 'skillBall', 'skillVolley', 'down']) {
    await page.locator('[data-fight-preview]').selectOption(clip);
    await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().preview)).toBe(clip);
    await page.waitForTimeout(250);
    const visuals = await page.evaluate(() => window.__cueFight!.getState().visuals);
    expect(visuals?.motionCount).toBe(14);
    const expectedClip = clip === 'down' ? 'death' : clip;
    visuals!.actors.forEach((actor, index) => {
      expect(actor.sourceClip).toBe(expectedClip);
      expect(actor.mappedBones).toBe(64);
      expect(actor.targetBoneCount).toBe(74);
      expect(actor.skinnedMeshCount).toBe(11);
      expect(actor.cueVisible).toBe(clip !== 'skillVolley' && clip !== 'down');
      expect(actor.cueGripError).toBeLessThan(1e-5);
      expect(actor.cueGripSpan).toBeLessThan(0.201);
      expect(actor.cueLength).toBe(1.45);
    });
    if (['idle', 'slash', 'jump', 'impactAlt', 'skillBall', 'skillVolley', 'down'].includes(clip)) await page.screenshot({ path: `shots-fight/${clip}.png` });
  }
  await page.locator('[data-fight-mirror]').uncheck();
  await page.locator('[data-fight-mirror]').check();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'shots-fight/mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('[data-fight-exit]').click();
  await expect(page.locator('.fight-mode .exit-dialog')).toBeVisible();
  await page.locator('[data-exit-confirm]').last().click();
  await expect(page.locator('.fight-mode')).toHaveCount(0);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('微缩角色在空台桌面边界内移动跳跃，横屏与平板取景正常', async ({ page }) => {
  test.setTimeout(300_000);
  await enter(page);
  await page.locator('[data-fight-training]').click();
  await page.evaluate(() => window.__cueFight!.arrange(-4.6, 4.6));
  await page.keyboard.down('a');
  await page.waitForTimeout(300);
  await page.keyboard.up('a');
  const edge = await page.evaluate(() => window.__cueFight!.getState());
  expect(edge.fighters[0].x).toBe(-4.6);
  for (const position of edge.visuals!.arena.fighterPositions) {
    expect(Math.abs(position[0]!)).toBeLessThan(edge.visuals!.arena.bounds.halfX - 0.5);
    expect(position[1]).toBeCloseTo(edge.visuals!.arena.surfaceY, 5);
    expect(position[2]).toBeCloseTo(0, 5);
  }
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => {
    const state = window.__cueFight!.getState();
    return state.visuals!.arena.fighterPositions[0]![1]! - state.visuals!.arena.surfaceY;
  })).toBeGreaterThan(0.03);
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].y)).toBe(0);
  const beforeRun = await page.evaluate(() => window.__cueFight!.getState().fighters[0].x);
  await page.keyboard.down('Shift');
  await page.keyboard.down('d');
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].x)).toBeGreaterThan(beforeRun);
  await page.keyboard.up('d');
  await page.keyboard.up('Shift');
  await page.screenshot({ path: 'shots-fight/tabletop-boundaries.png' });
  await page.evaluate(() => window.__cueFight!.arrange(-1.3, 1.3));
  for (const viewport of [{ width: 1024, height: 768 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `shots-fight/tabletop-${viewport.width}.png` });
  }
});

test('真实按键移动跳跃和攻击扣血，暂停隔离、胜负与重新开始正常', async ({ page }) => {
  test.setTimeout(300_000);
  // Software WebGL is fill-rate bound; a 960×600 stage keeps real input responsive while polling fight time.
  await page.setViewportSize({ width: 960, height: 600 });
  await enter(page);
  await page.locator('[data-fight-training]').click();
  await page.evaluate(() => window.__cueFight!.arrange(-0.65, 0.65));
  await page.keyboard.press('j');
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].hp)).toBeLessThan(200);
  await page.waitForTimeout(1300);
  const hp = await page.evaluate(() => window.__cueFight!.getState().fighters[1].hp);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__cueFight!.getState().fighters[1].hp)).toBe(hp);
  // Jump only after the 0.62 s slash action has finished; render dt is capped, so wall time can be much longer.
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].action), { timeout: 90_000 }).toBe('idle');
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].y)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].y)).toBe(0);
  await page.locator('[data-fight-pause]').click();
  const paused = await page.evaluate(() => window.__cueFight!.getState());
  await page.keyboard.down('d'); await page.keyboard.press('k'); await page.waitForTimeout(350); await page.keyboard.up('d');
  const after = await page.evaluate(() => window.__cueFight!.getState());
  expect(after.fighters).toEqual(paused.fighters); expect(after.timeLeft).toBe(paused.timeLeft);
  await page.locator('[data-fight-pause]').click();
  await page.evaluate(() => window.__cueFight!.arrange(-0.65, 0.65));
  // The acceptance hook lowers the remaining health so one real heavy swing can show the KO presentation.
  await page.evaluate(() => window.__cueFight!.setHp(1, 20));
  for (let i = 0; i < 2; i++) {
    if ((await page.evaluate(() => window.__cueFight!.getState())).winner !== null) break;
    await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].action), { timeout: 90_000 }).toBe('idle');
    const before = await page.evaluate(() => window.__cueFight!.getState().fighters[1].hp);
    await page.keyboard.press('k');
    await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].hp), { timeout: 90_000 }).toBeLessThan(before);
  }
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().winner)).toBe(0);
  // Resize before waiting out the 0.65 s cosmetic fall, so subsequent frames repaint the 1280×800 stage.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('[data-fight-center]')).toContainText('你赢了');
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().visuals!.koTimes[1])).toBe(0.65);
  await page.screenshot({ path: 'shots-fight/victory.png' });
  await page.locator('[data-fight-restart]').click();
  const reset = await page.evaluate(() => window.__cueFight!.getState());
  expect(reset.fighters.map(f => f.hp)).toEqual([200, 200]); expect(reset.winner).toBeNull();
});

test('三个技能可由数字键施放，伤害、冷却与命中特效正确', async ({ page }) => {
  test.setTimeout(400_000);
  const errors: string[] = []; const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = request.url(); if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:')) external.push(url); });
  await enter(page);
  await page.locator('[data-fight-training]').click();
  await page.evaluate(() => window.__cueFight!.arrange(-0.8, 0.8));
  await page.screenshot({ path: 'shots-fight/skills.png' });
  const state = () => page.evaluate(() => window.__cueFight!.getState());
  await page.keyboard.press('1');
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].hp), { timeout: 120_000 }).toBe(170);
  // 命中后释放物在落点缩小淡出（不立即消失）：观察到滞留的同一帧页内暂停，定格拍清后再继续。
  await page.waitForFunction(() => {
    if (window.__cueFight!.getState().visuals!.skills.lingering > 0) {
      (document.querySelector('[data-fight-pause]') as HTMLElement).click();
      return true;
    }
    return false;
  }, null, { timeout: 120_000 });
  expect((await state()).visuals!.skills.lingered).toBeGreaterThanOrEqual(1);
  // 暂停面板挡住落点，仅测试期隐藏它拍清命中后保留的释放物，拍完立即移除。
  const hideCenter = await page.addStyleTag({ content: '[data-fight-center]{visibility:hidden}' });
  await page.screenshot({ path: 'shots-fight/skill-ball-linger.png' });
  await hideCenter.evaluate(el => el.parentNode?.removeChild(el));
  await page.locator('[data-fight-pause]').click();
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].action), { timeout: 120_000 }).toBe('down');
  await page.screenshot({ path: 'shots-fight/skill-ball-hit.png' });
  const ball = await state();
  expect(ball.skillCooldowns[0].ball).toBeGreaterThan(0);
  expect(ball.visuals!.skills.lastKind).toBe('ball');
  expect(ball.visuals!.skills.particles + ball.visuals!.skills.rings + ball.visuals!.skills.flashes).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].action), { timeout: 120_000 }).toBe('idle');
  await page.keyboard.press('2');
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].hp), { timeout: 120_000 }).toBe(146);
  await page.screenshot({ path: 'shots-fight/skill-cat-hit.png' });
  const cat = await state();
  expect(cat.skillCooldowns[0].cat).toBeGreaterThan(0);
  expect(cat.visuals!.skills.lastKind).toBe('cat');
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].action), { timeout: 120_000 }).toBe('idle');
  await page.keyboard.press('3');
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().visuals!.skills.bows[0]), { timeout: 120_000 }).toBe(true);
  await page.screenshot({ path: 'shots-fight/skill-volley-bow.png' });
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].hp), { timeout: 120_000 }).toBe(126);
  await page.screenshot({ path: 'shots-fight/skill-volley-hit.png' });
  const volley = await state();
  expect(volley.skillCooldowns[0].volley).toBeGreaterThan(0);
  expect(volley.visuals!.skills.lastKind).toBe('volley');
  expect(volley.visuals!.skills.particles + volley.visuals!.skills.rings + volley.visuals!.skills.flashes).toBeGreaterThan(0);
  // 万杆齐发的多枚投射物同样在命中后保留；滞留计数由渲染帧累加，用轮询等待。
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().visuals!.skills.lingered), { timeout: 120_000 }).toBeGreaterThanOrEqual(3);
  // Skill 3 knocks the dummy down, then it rises again after the lie-down window.
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].action), { timeout: 120_000 }).toBe('down');
  await page.screenshot({ path: 'shots-fight/skill-volley-down.png' });
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].action), { timeout: 120_000 }).toBe('idle');
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('三连击打倒对手并重置连击，HUD 显示连击数', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 960, height: 600 });
  await enter(page);
  await page.locator('[data-fight-training]').click();
  await page.evaluate(() => window.__cueFight!.arrange(-0.65, 0.65));
  const combo = () => page.evaluate(() => window.__cueFight!.getState().fighters[0].combo);
  for (let index = 0; index < 2; index += 1) {
    await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].action), { timeout: 90_000 }).toBe('idle');
    await page.keyboard.press('j');
    await expect.poll(combo, { timeout: 90_000 }).toBeGreaterThan(index);
  }
  expect(await combo()).toBe(2);
  await expect(page.locator('[data-fight-combo]')).toBeVisible();
  await expect(page.locator('[data-combo-count]')).toContainText('×2');
  await page.screenshot({ path: 'shots-fight/combo.png' });
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].action), { timeout: 90_000 }).toBe('idle');
  await page.keyboard.press('j');
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].action), { timeout: 90_000 }).toBe('down');
  expect(await combo()).toBe(0);
  await page.screenshot({ path: 'shots-fight/combo-knockdown.png' });
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].action), { timeout: 120_000 }).toBe('idle');
});

test('怒气大招：满怒才可施放，全屏播报、狗冲锋击飞晕眩与大额伤害', async ({ page }) => {
  test.setTimeout(400_000);
  const errors: string[] = []; const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = request.url(); if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:')) external.push(url); });
  await page.setViewportSize({ width: 960, height: 600 });
  await enter(page);
  await page.locator('[data-fight-training]').click();
  await page.evaluate(() => window.__cueFight!.arrange(-3.4, 3.4));
  const state = () => page.evaluate(() => window.__cueFight!.getState());
  await page.keyboard.press('4');
  await page.waitForTimeout(400);
  expect((await state()).fighters[0].action).toBe('idle');
  expect((await state()).fighters[1].hp).toBe(200);
  await page.evaluate(() => window.__cueFight!.setRage(0, 100));
  await expect(page.locator('[data-rage-label]').first()).toContainText('怒气全满');
  await page.keyboard.press('4');
  await expect(page.locator('[data-fight-broadcast]')).toBeVisible();
  await expect(page.locator('[data-fight-broadcast] b')).toContainText('大狗大狗叫叫叫');
  await expect(page.locator('[data-fight-broadcast] img')).toBeVisible();
  // 全屏播报期间对局冻结：holding 为真，且隔一帧模拟时间与角色位置不推进。
  const freeze = await page.evaluate(async () => {
    const before = window.__cueFight!.getState();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const after = window.__cueFight!.getState();
    return { holding: after.holding, same: before.timeLeft === after.timeLeft && before.fighters[0].x === after.fighters[0].x };
  });
  expect(freeze.holding).toBe(true);
  expect(freeze.same).toBe(true);
  // 软件渲染帧间隔可能超过2.6秒墙钟动画窗口，轮询采样永远赶不上全不透明帧；
  // 在同一个页面任务里找到动画立刻暂停并定格在1秒平台段，避免等待与隐藏竞态。
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-fight-broadcast]');
    const anim = el?.getAnimations()[0];
    if (!anim) return false;
    anim.pause();
    anim.currentTime = 1000;
    return true;
  }, null, { timeout: 15_000 });
  const broadcastOpacity = await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-fight-broadcast]')!).opacity));
  expect(broadcastOpacity).toBe(1);
  await page.screenshot({ path: 'shots-fight/dog-broadcast.png' });
  await page.evaluate(() => { const anim = document.querySelector('[data-fight-broadcast]')?.getAnimations()[0]; if (anim) anim.play(); });
  // 低帧率下轮询与点击之间会隔好几帧，狗早已命中消失；在观察到投射物的同一帧内
  // 页内点击暂停，把出生帧定格后再截图，才能拍到飞行中的狗。
  await page.waitForFunction(() => {
    if (window.__cueFight!.getState().visuals!.skills.projectiles > 0) {
      (document.querySelector('[data-fight-pause]') as HTMLElement).click();
      return true;
    }
    return false;
  }, null, { timeout: 90_000 });
  // 暂停面板正好挡住奔向中线的狗头，仅测试期隐藏它拍下完整冲刺姿态，拍完立即移除。
  const hideCenter = await page.addStyleTag({ content: '[data-fight-center]{visibility:hidden}' });
  await page.screenshot({ path: 'shots-fight/dog-flight.png' });
  await hideCenter.evaluate(el => el.parentNode?.removeChild(el));
  await page.locator('[data-fight-pause]').click();
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].rage), { timeout: 90_000 }).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].hp), { timeout: 120_000 }).toBe(140);
  await page.screenshot({ path: 'shots-fight/dog-hit.png' });
  const hit = await state();
  expect(hit.fighters[1].action).toBe('down');
  expect(hit.fighters[1].downDuration).toBe(3);
  expect(hit.visuals!.skills.lastKind).toBe('dog');
  // 猛犬命中后同样在落点保留缩小淡出；计数由渲染帧累加。
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().visuals!.skills.lingered), { timeout: 120_000 }).toBeGreaterThanOrEqual(1);
  expect(hit.visuals!.skills.particles + hit.visuals!.skills.rings + hit.visuals!.skills.flashes).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[1].action), { timeout: 180_000 }).toBe('idle');
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('电脑会追近出招，退出清理格斗输入后原台球仍可开局，再进格斗状态全新', async ({ page }) => {
  test.setTimeout(300_000);
  await enter(page);
  await expect.poll(() => page.evaluate(() => window.__cueFight!.getState().fighters[0].hp), { timeout: 120_000 }).toBeLessThan(200);
  await page.locator('[data-fight-exit]').click();
  await page.locator('[data-exit-cancel]').last().click();
  expect((await page.evaluate(() => window.__cueFight!.getState())).paused).toBe(false);
  await page.locator('[data-fight-exit]').click();
  await page.locator('[data-exit-confirm]').last().click();
  await expect(page.locator('.menu-overlay')).toBeVisible();
  expect(await page.evaluate(() => window.__cueFight)).toBeUndefined();
  await page.locator('[data-value="classic"]').click();
  await page.locator('.start-button').click();
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('breakPlacement');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.getState().phase)).toBe('aiming');
  await expect.poll(() => page.evaluate(() => window.__creativeEight!.getState().view.roomBackground)).toBe(true);
  const billiards = await page.evaluate(() => window.__creativeEight!.getState());
  expect(billiards.view.traditionalFit).not.toBeNull();
  expect(billiards.simulation.balls.filter(ball => !ball.pocketed)).toHaveLength(16);
  await page.screenshot({ path: 'shots-fight/returned-billiards.png' });
  await page.locator('[data-exit]').click();
  await page.locator('[data-exit-confirm]').click();
  await page.locator('[data-fight-entry]').click();
  await expect(page.locator('.fight-mode')).toHaveAttribute('data-ready', 'true', { timeout: 120_000 });
  const fresh = await page.evaluate(() => window.__cueFight!.getState());
  expect(fresh.fighters.map(f => f.hp)).toEqual([200, 200]); expect(fresh.winner).toBeNull();
});
