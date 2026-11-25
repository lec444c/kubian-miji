import { describe, expect, it } from 'vitest';
import { FIXED_DT, createBall, type SimulationState } from '../../src/sim/SimulationState';
import {
  HAIRDRYER_DURATION_MS,
  HAIRDRYER_REMAINING_STEPS,
  createHairdryerEffect,
  getHairdryerCandidates,
} from '../../src/skills/hairdryer';

 describe('hairdryer braking parameters', () => {
  it('filters legal moving balls and creates a 3 second fixed-step effect without physics mutation', () => {
    const rolling = createBall(1, { x: 0, y: 0 });
    rolling.motion = 'rolling';
    rolling.velocity = { x: 0.6, y: 0.8 };
    const stationary = createBall(2, { x: 0.2, y: 0 });
    const pocketed = createBall(3, { x: 0.4, y: 0 });
    pocketed.motion = 'rolling';
    pocketed.velocity = { x: 1, y: 0 };
    pocketed.pocketed = true;
    const zeroVelocity = createBall(4, { x: 0.6, y: 0 });
    zeroVelocity.motion = 'sliding';
    const state: SimulationState = { balls: [rolling, stationary, pocketed, zeroVelocity], step: 20, braking: [] };
    const snapshot = structuredClone(state);

    expect(getHairdryerCandidates(state)).toEqual([1]);
    const effect = createHairdryerEffect(state, 1, 'dryer-instance');
    expect(HAIRDRYER_DURATION_MS).toBe(3000);
    expect(HAIRDRYER_REMAINING_STEPS).toBe(Math.ceil(3 / FIXED_DT));
    expect(effect).toEqual({
      id: 'dryer-instance',
      ballId: 1,
      remainingSteps: HAIRDRYER_REMAINING_STEPS,
      deceleration: 1 / (HAIRDRYER_REMAINING_STEPS * FIXED_DT),
    });
    expect(createHairdryerEffect(state, 2, 'invalid')).toBeNull();
    expect(state).toEqual(snapshot);
  });
});
