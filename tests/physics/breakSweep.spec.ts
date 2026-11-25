import { describe, expect, it } from 'vitest';
import { createRackedSimulation } from '../../src/sim/rack';

/** 开球自动补力 0.88 的取值依据：袋角碰撞几何修正后重新扫描 100 个球堆种子，
 *  0.88（8.8 m/s）全部满足“至少四颗目标球碰库”且白球不落袋；提高到 0.89 时
 *  seed 12 白球洗袋。混沌散开使临界力度随球堆变化，故补力取当前实测安全带上沿 0.88。 */
describe('break auto-power robustness across rack seeds', () => {
  it('0.88 break is legal on every rack seed 1..100', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const sim = createRackedSimulation(seed);
      sim.strike(0, 0.88);
      sim.runUntilStopped(60_000);
      const outcome = sim.currentOutcome!;
      const objectCushions = new Set(outcome.cushionContacts.filter(id => id !== 0));
      expect(objectCushions.size, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(outcome.cueScratch, `seed ${seed}`).toBe(false);
    }
  }, 120000);
});