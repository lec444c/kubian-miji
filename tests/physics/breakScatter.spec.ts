import { describe, expect, it } from 'vitest';
import { createRackedSimulation } from '../../src/sim/rack';

/** 开球散开度钉：第十三轮摩擦 0.7（球速上限 10，补力 0.88 → 8.8 m/s）下 0.88 开球在 12 个球堆种子下，
 *  位移 >0.2m 的目标球与平均位移均不低于第十二轮实测（上限 9、0.94=8.46 m/s 时最少 9/15、平均最小 0.494m；
 *  摩擦 1.15 基线合计 78/180、平均 0.268m；0.85 合计 99/180、平均 0.321m；0.7 合计 130/180、平均 0.582m）。
 *  断言留余量取 ≥6 与 ≥0.28m，防止摩擦回调退回到“开球开不散”。 */
describe('round 9 break scatter pin', () => {
  it('0.88 break spreads the rack on every seed 1..12', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const sim = createRackedSimulation(seed);
      const before = sim.state.balls.map(ball => ({ id: ball.id, x: ball.position.x, y: ball.position.y }));
      sim.strike(0, 0.88);
      sim.runUntilStopped(60_000);
      let moved20 = 0;
      let dispSum = 0;
      let n = 0;
      for (const ball of sim.state.balls) {
        if (ball.id === 0) continue;
        const start = before.find(item => item.id === ball.id)!;
        const disp = Math.hypot(ball.position.x - start.x, ball.position.y - start.y);
        if (disp > 0.2) moved20 += 1;
        dispSum += disp;
        n += 1;
      }
      expect(moved20, `seed ${seed}`).toBeGreaterThanOrEqual(6);
      expect(dispSum / n, `seed ${seed}`).toBeGreaterThanOrEqual(0.28);
    }
  }, 120000);
});