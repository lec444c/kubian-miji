import { describe, expect, it } from 'vitest';
import { chargePower, CHARGE_DURATION_SECONDS, MAX_SHOT_POWER, MIN_SHOT_POWER } from '../../src/view/charge';

describe('Space 蓄力曲线', () => {
  it('从零到满力单调且两端有界', () => {
    expect(chargePower(-1)).toBe(MIN_SHOT_POWER);
    expect(chargePower(0)).toBe(MIN_SHOT_POWER);
    expect(chargePower(CHARGE_DURATION_SECONDS / 2)).toBeCloseTo((MIN_SHOT_POWER + MAX_SHOT_POWER) / 2);
    expect(chargePower(CHARGE_DURATION_SECONDS)).toBe(MAX_SHOT_POWER);
    expect(chargePower(CHARGE_DURATION_SECONDS * 3)).toBe(MAX_SHOT_POWER);
  });

  it('非法时间不会产生非有限击球力度', () => {
    expect(chargePower(Number.NaN)).toBe(MIN_SHOT_POWER);
    expect(chargePower(Number.POSITIVE_INFINITY)).toBe(MIN_SHOT_POWER);
  });
});
