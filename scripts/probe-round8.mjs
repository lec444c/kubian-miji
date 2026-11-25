// Round 8 full-quality probe: continuous spin face, cue tip on the contact point,
// real draw / follow / rail-english behaviour, and multi-turn mouse aim.
// Runs at native pixel ratio (no renderScale override) so the screenshots are
// what a player actually sees.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-round8', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

await page.goto('http://127.0.0.1:4173/');
await page.locator('[data-field="mode"] [data-value="classic"]').click();
await page.locator('[data-field="playMode"] [data-value="practice"]').click();
await page.getByRole('button', { name: '开 局' }).click();
await page.evaluate(() => window.__creativeEight.cancelAi());
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'breakPlacement');
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming');
await page.waitForTimeout(2500);

const face = page.locator('[data-spin-face]');
const box = await face.boundingBox();
const spin = () => page.evaluate(() => window.__creativeEight.getState().human.spin);
const readout = () => page.locator('[data-spin-readout]').textContent();
const cueAim = () => page.evaluate(() => window.__creativeEight.cueAim());
const clickFace = async (fx, fy) => {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(450);
};

// 1. Widget at rest, then a real off-centre contact point.
await page.locator('.spin-face-wrap').screenshot({ path: 'shots-round8/30-spin-face-centre.png' });
console.log('FACE centre', JSON.stringify(await spin()), await readout());
await clickFace(0.78, 0.24);
const highRightSpin = await spin();
console.log('FACE high-right', JSON.stringify(highRightSpin), await readout());
await page.locator('.spin-face-wrap').screenshot({ path: 'shots-round8/31-spin-face-high-right.png' });
const aimHighRight = await cueAim();
await clickFace(0.5, 0.5);
const aimCentre = await cueAim();
console.log('TIP centre', JSON.stringify(aimCentre));
console.log('TIP high-right', JSON.stringify(aimHighRight));
console.log('TIP offset lateral=', Math.hypot(aimHighRight.tip[0] - aimCentre.tip[0], aimHighRight.tip[2] - aimCentre.tip[2]).toFixed(5),
  'lift=', (aimHighRight.tip[1] - aimCentre.tip[1]).toFixed(5),
  'expected lateral=', (highRightSpin.x * 0.0315 * 0.5).toFixed(5),
  'lift=', (highRightSpin.y * 0.0315 * 0.5).toFixed(5));
await page.screenshot({ path: 'shots-round8/32-hud-full.png' });

// 2. Solo table helper: only the cue ball (plus an optional object ball).
const solo = async (cue, object) => {
  await page.evaluate(({ cue, object }) => {
    const debug = window.__creativeEight;
    for (let id = 1; id <= 15; id += 1) debug.removeBall(id);
    debug.setBall(0, cue);
    if (object) debug.setBall(1, object);
    debug.aim(0);
  }, { cue, object });
  await page.waitForTimeout(600);
};
const setPower = async value => {
  await page.locator('[data-power]').evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};
// Record the cue trajectory inside the page so no CDP round-trip skews sampling.
// Keeps ticking until the shot has actually started (rolling) and finished.
const record = () => page.evaluate(() => {
  window.__trace = [];
  window.__seenRolling = false;
  const tick = () => {
    const state = window.__creativeEight.getState();
    const ball = state.simulation.balls.find(item => item.id === 0);
    if (state.phase === 'rolling') window.__seenRolling = true;
    if (window.__seenRolling) {
      window.__trace.push({ t: state.elapsedMs, x: +ball.position.x.toFixed(4), y: +ball.position.y.toFixed(4), motion: ball.motion });
    }
    if (!window.__seenRolling || state.phase === 'rolling') requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const trace = () => page.evaluate(() => window.__trace);
const settled = async () => {
  await page.waitForFunction(() => window.__seenRolling === true, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => ['aiming', 'ballInHand', 'gameOver'].includes(window.__creativeEight.getState().phase), undefined, { timeout: 90_000 });
  if (await page.evaluate(() => window.__creativeEight.getState().phase) === 'ballInHand') {
    const cue = await page.evaluate(() => {
      const ball = window.__creativeEight.getState().simulation.balls.find(item => item.id === 0);
      return { x: ball.position.x, y: ball.position.y };
    });
    const placed = await page.evaluate(point => window.__creativeEight.placeCue(point), cue);
    if (!placed) await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__creativeEight.getState().phase === 'aiming', undefined, { timeout: 30_000 });
  }
};
const shot = async (fx, fy, power) => {
  await clickFace(fx, fy);
  await setPower(power);
  await record();
  await page.locator('[data-strike]').click();
  await page.waitForFunction(() => window.__seenRolling === true, undefined, { timeout: 60_000 });
  await page.screenshot({ path: `shots-round8/33-roll-${fy < 0.4 ? 'high' : fy > 0.6 ? 'low' : 'centre'}.png` });
  await settled();
  return trace();
};

// 3. Draw / follow / stun on a straight full-ball hit.
// 第十三轮球速上限 10：力度 30% = 3.0 m/s，复现单测 0.3=3.0 m/s 轨迹（更高力度会多弹库）。
await solo({ x: -0.3, y: 0 }, { x: 0, y: 0 });
const draw = await shot(0.5, 0.98, 30);
console.log('DRAW samples=', draw.length, 'final=', JSON.stringify(draw[draw.length - 1]), 'minX=', Math.min(...draw.map(s => s.x)).toFixed(4));
console.log('DRAW path=', draw.filter((_, i) => i % Math.max(1, Math.floor(draw.length / 6)) === 0).map(s => `${s.x}/${s.motion}`).join(' '));
await solo({ x: -0.3, y: 0 }, { x: 0, y: 0 });
const follow = await shot(0.5, 0.02, 30);
console.log('FOLLOW final=', JSON.stringify(follow[follow.length - 1]), 'maxX=', Math.max(...follow.map(s => s.x)).toFixed(4));
await solo({ x: -0.3, y: 0 }, { x: 0, y: 0 });
const stun = await shot(0.5, 0.73, 30);
console.log('STUN final=', JSON.stringify(stun[stun.length - 1]));

// 4. Rail english: same shot, three contact points.
for (const [label, fx] of [['plain', 0.5], ['right', 0.98], ['left', 0.02]]) {
  await solo({ x: 0.5, y: 0 });
  const samples = await shot(fx, 0.5, 30);
  const last = samples[samples.length - 1];
  console.log('RAIL', label, 'final=', JSON.stringify(last), 'maxY=', Math.max(...samples.map(s => s.y)).toFixed(4), 'minY=', Math.min(...samples.map(s => s.y)).toFixed(4));
}

// 5. Friction: a soft centre-ball tap must roll ~1.61 m (round 13 cloth 0.7, max speed 10).
await solo({ x: -0.5, y: 0 });
const roll = await shot(0.5, 0.5, 15);
console.log('FRICTION final=', JSON.stringify(roll[roll.length - 1]), 'distance=', (roll[roll.length - 1].x + 0.5).toFixed(4));

// 6. Multi-turn mouse aim at full quality, with a frame-rate sample.
await page.evaluate(() => window.__creativeEight.aim(0));
await page.mouse.move(200, 450);
const before = await page.evaluate(() => window.__creativeEight.getState().human.angle);
await page.mouse.move(400, 450, { steps: 10 });
const after = await page.evaluate(() => window.__creativeEight.getState().human.angle);
console.log('AIM 200px delta=', (after - before).toFixed(4), 'expected=1.6');
await page.mouse.click(400, 450, { button: 'right' });
await page.mouse.move(160, 450);
await page.mouse.click(160, 450, { button: 'right' });
await page.evaluate(() => {
  window.__frames = 0;
  const tick = () => { window.__frames += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__fpsStart = performance.now();
});
for (let sweep = 0; sweep < 3; sweep += 1) {
  await page.mouse.move(1440, 450, { steps: 40 });
  if (sweep < 2) {
    await page.mouse.click(1440, 450, { button: 'right' });
    await page.mouse.move(160, 450);
    await page.mouse.click(160, 450, { button: 'right' });
  }
}
const swept = await page.evaluate(() => window.__creativeEight.getState().human.angle);
const fps = await page.evaluate(() => window.__frames / ((performance.now() - window.__fpsStart) / 1000));
console.log('SWEEP total=', swept.toFixed(3), 'turns=', (swept / (2 * Math.PI)).toFixed(2), 'fps=', fps.toFixed(1));
console.log('SWEEP cueAim=', JSON.stringify(await cueAim()));
// Let the aim camera finish damping after the fast sweep before capturing, so
// the frame shows the settled aim guide instead of a mid-swing close-up.
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots-round8/34-multi-turn-aim.png' });
// Fine aim: one wheel notch and Alt+wheel.
await page.mouse.move(800, 450);
await page.evaluate(() => window.__creativeEight.aim(0));
await page.mouse.wheel(0, 120);
const notch = await page.evaluate(() => window.__creativeEight.getState().human.angle);
await page.keyboard.down('Alt');
await page.mouse.wheel(0, 120);
await page.keyboard.up('Alt');
const altNotch = await page.evaluate(() => window.__creativeEight.getState().human.angle);
console.log('WHEEL notch=', notch.toFixed(6), 'altNotch=', altNotch.toFixed(6));
console.log('ERRORS', errors.length, errors.slice(0, 6));
await browser.close();