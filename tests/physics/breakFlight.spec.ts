import { describe, expect, it } from 'vitest';
import { createRackedSimulation } from '../../src/sim/rack';

/** 袋口兜底回归（第十三轮球速上限 10 m/s）：2D 模型无跳球，球越过台呢边缘的唯一
 *  途径是袋口缺口，故越界球必须落入最近袋而非飞出台面。修复前 0.80 力度开球在
 *  4/40 球堆种子（9/15/24/32）出现 flewOffTable；detectFlight 改为最近袋捕获后清零。 */
describe('pocket-mouth backstop: no ball flies off the table', () => {
  it('seed 9 at 0.80 power pockets the escapee instead of flying off', () => {
    const sim = createRackedSimulation(9);
    sim.strike(0, 0.8);
    sim.runUntilStopped(60_000);
    const outcome = sim.currentOutcome!;
    expect(outcome.flewOffTable).toEqual([]);
    // 10 号球原从左下角袋口下方缝隙穿出；现应落入袋中。
    const ten = sim.state.balls.find(ball => ball.id === 10)!;
    expect(ten.onTable).toBe(false);
    expect(ten.pocketed).toBe(true);
    expect(outcome.pocketed.some(ball => ball.ballId === 10)).toBe(true);
  }, 120000);

  it('breaks across powers 0.80/0.89/1.00 and seeds 1..40 never fly a ball off', () => {
    for (const power of [0.8, 0.89, 1.0]) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const sim = createRackedSimulation(seed);
        sim.strike(0, power);
        sim.runUntilStopped(60_000);
        const outcome = sim.currentOutcome!;
        expect(outcome.flewOffTable, `power ${power} seed ${seed}`).toEqual([]);
        // 球数守恒：每颗球要么在台上要么已落袋，不会凭空消失。
        const accounted = sim.state.balls.filter(ball => ball.onTable || ball.pocketed).length;
        expect(accounted, `power ${power} seed ${seed}`).toBe(16);
      }
    }
  }, 300000);
});