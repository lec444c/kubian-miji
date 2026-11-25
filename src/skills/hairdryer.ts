import {
  FIXED_DT,
  length,
  type BallState,
  type BrakingEffect,
  type SimulationState,
} from '../sim/SimulationState';

export const HAIRDRYER_DURATION_MS = 3000;
export const HAIRDRYER_DURATION_SECONDS = HAIRDRYER_DURATION_MS / 1000;
export const HAIRDRYER_REMAINING_STEPS = Math.ceil(HAIRDRYER_DURATION_SECONDS / FIXED_DT);

export interface HairdryerBrakingConfig {
  durationMs: typeof HAIRDRYER_DURATION_MS;
  fixedDt: number;
  remainingSteps: number;
}

export const HAIRDRYER_BRAKING_CONFIG: Readonly<HairdryerBrakingConfig> = Object.freeze({
  durationMs: HAIRDRYER_DURATION_MS,
  fixedDt: FIXED_DT,
  remainingSteps: HAIRDRYER_REMAINING_STEPS,
});

export function isHairdryerCandidate(ball: BallState): boolean {
  return ball.onTable
    && !ball.pocketed
    && (ball.motion === 'sliding' || ball.motion === 'rolling')
    && length(ball.velocity) > 1e-10;
}

export function getHairdryerCandidateBalls(state: SimulationState): BallState[] {
  return state.balls.filter(isHairdryerCandidate);
}

export function getHairdryerCandidates(state: SimulationState): number[] {
  return getHairdryerCandidateBalls(state).map((ball) => ball.id);
}

/** Build physics input only; applying or integrating the effect belongs to the simulation. */
export function createHairdryerEffect(
  state: SimulationState,
  ballId: number,
  effectId: string,
): BrakingEffect | null {
  const ball = state.balls.find((candidate) => candidate.id === ballId);
  if (!ball || !isHairdryerCandidate(ball) || effectId.trim().length === 0) return null;
  const effectDuration = HAIRDRYER_REMAINING_STEPS * FIXED_DT;
  return {
    id: effectId,
    ballId,
    remainingSteps: HAIRDRYER_REMAINING_STEPS,
    deceleration: length(ball.velocity) / effectDuration,
  };
}
