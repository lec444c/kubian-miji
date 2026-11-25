import type { Difficulty } from '../app/matchTypes';

/** Noise is sampled uniformly from [-error, +error]. */
export interface DifficultyParameters {
  /** Maximum aiming error in radians. */
  readonly aimError: number;
  /** Maximum power error as a fraction of the planned power. */
  readonly powerError: number;
  /** Number of ranked aim candidates considered by the planner. */
  readonly candidateDepth: number;
  readonly minPower: number;
  readonly maxPower: number;
}

const parameters: Record<Difficulty, DifficultyParameters> = {
  easy: {
    aimError: 0.075,
    powerError: 0.25,
    candidateDepth: 1,
    minPower: 0.18,
    maxPower: 1,
  },
  normal: {
    aimError: 0.025,
    powerError: 0.12,
    candidateDepth: 4,
    minPower: 0.18,
    maxPower: 1,
  },
  hard: {
    aimError: 0.006,
    powerError: 0.035,
    candidateDepth: Number.POSITIVE_INFINITY,
    minPower: 0.18,
    maxPower: 1,
  },
};

export const DIFFICULTY_PARAMETERS: Readonly<Record<Difficulty, DifficultyParameters>> = {
  easy: Object.freeze(parameters.easy),
  normal: Object.freeze(parameters.normal),
  hard: Object.freeze(parameters.hard),
};

/** Short alias retained for callers that prefer the shorter name. */
export const DIFFICULTY_PARAMS = DIFFICULTY_PARAMETERS;

export function getDifficultyParameters(difficulty: Difficulty): DifficultyParameters {
  return DIFFICULTY_PARAMETERS[difficulty];
}
