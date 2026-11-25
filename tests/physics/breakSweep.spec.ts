import { describe, expect, it } from 'vitest';
import { createRackedSimulation } from '../../src/sim/rack';

/** 开球自动补力 0.89 的取值依据：球堆带种子随机微扰，临界力度随球堆变化。
 *  第十三轮摩擦 0.7（球速上限 10）下实测 0.80–0.89（8.0–8.9 m/s）连续带 40/40 种子均满足
 *  “至少四颗目标球碰库”且白球不落袋；0.90 起洗袋随种子混沌出现（0.90 挂 seed 27、0.94 挂 seed 19），
 *  故补力取连续安全带上沿 0.89（第十二轮上限 9 时 0.94=8.46 m/s 全合法）。
 *  此测试钉住该跨球堆稳健性。 */
describe('break auto-power robustness across rack seeds', () => {
  it('0.89 break is legal on every rack seed 1..40', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const sim = createRackedSimulation(seed);
      sim.strike(0, 0.89);
      sim.runUntilStopped(60_000);
      const outcome = sim.currentOutcome!;
      const objectCushions = new Set(outcome.cushionContacts.filter(id => id !== 0));
      expect(objectCushions.size, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(outcome.cueScratch, `seed ${seed}`).toBe(false);
    }
  }, 120000);
});