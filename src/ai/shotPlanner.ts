import type { Difficulty } from '../app/matchTypes';
import type { SeededRng } from '../core/random/SeededRng';
import type { RuleContext } from '../rules/ruleTypes';
import { POCKETS, clamp, distance } from '../sim/SimulationState';
import { getDifficultyParameters } from './difficulty';
import {
  enumerateGhostAimCandidates,
  enumerateLegalTargets,
  rankAimCandidates,
} from './ghostAim';
import type { GhostAimCandidate } from './ghostAim';

export interface ShotCommand {
  angle: number;
  power: number;
  spin: { x: number; y: number };
  targetBallId: number;
  pocketId: number;
}

function normalizeAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  return ((angle + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

function plannedPower(candidate: GhostAimCandidate, isBreak: boolean): number {
  // Round 13: MAX_SHOT_SPEED 10 makes 0.94 (9.4 m/s) scratch on some rack seeds;
  // 0.89 (8.9 m/s) is the top of the contiguous 40/40-legal break band.
  if (isBreak) return 0.89;
  // Coefficients raised to compensate for the less lubricated cloth so the AI
  // still reaches its intended pocket after the friction increase.
  const distancePower = candidate.cueDistance * 0.2 + candidate.objectDistance * 0.28;
  const cutPower = (candidate.cutAngle / (Math.PI / 2)) * 0.12;
  return clamp(0.28 + distancePower + cutPower, 0.24, 0.94);
}

function selectCandidate(
  ranked: readonly GhostAimCandidate[],
  candidateDepth: number,
): GhostAimCandidate | undefined {
  let best: GhostAimCandidate | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of ranked.slice(0, candidateDepth)) {
    // Easy uses only the basic pot score. Normal also balances the two path
    // lengths; hard evaluates every candidate and avoids contact positions
    // near pockets, a lightweight cue-ball scratch-risk heuristic.
    let score = candidate.score;
    if (candidateDepth > 1) {
      score += Math.abs(candidate.cueDistance - candidate.objectDistance) * 0.08;
      score += candidate.cutAngle * 0.12;
    }
    if (!Number.isFinite(candidateDepth)) {
      const nearestPocket = Math.min(...POCKETS.map(pocket =>
        distance(candidate.ghostPosition, pocket.position)));
      score += Math.max(0, 0.16 - nearestPocket) * 2;
    }
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Plan one shot using only public rule/simulation data. The context is never
 * cloned into a live simulation or advanced: this function performs geometry
 * and arithmetic only, leaving every state object untouched.
 */
export function planShot(
  context: RuleContext,
  rng: SeededRng,
  difficulty: Difficulty,
): ShotCommand {
  const legalTargets = enumerateLegalTargets(context);
  if (legalTargets.length === 0) {
    throw new RangeError('Cannot plan a shot without an active legal target ball');
  }

  const parameters = getDifficultyParameters(difficulty);
  const ranked = rankAimCandidates(enumerateGhostAimCandidates(context));
  const directPots = ranked.filter(candidate => candidate.viable);
  const pool = directPots.length > 0 ? directPots : ranked;
  const candidate = selectCandidate(pool, parameters.candidateDepth);

  // A legal target always produces candidates in a valid table layout. Keep a
  // defensive error here rather than silently emitting an illegal ball id.
  if (!candidate) {
    throw new RangeError('Cannot plan a shot without a usable cue ball and pocket');
  }

  const angleNoise = rng.range(-parameters.aimError, parameters.aimError);
  const powerNoise = rng.range(-parameters.powerError, parameters.powerError);
  const idealPower = plannedPower(candidate, context.state.isBreak);

  return {
    angle: normalizeAngle(candidate.angle + angleNoise),
    power: clamp(idealPower * (1 + powerNoise), parameters.minPower, parameters.maxPower),
    spin: { x: 0, y: 0 },
    targetBallId: candidate.targetBallId,
    pocketId: candidate.pocketId,
  };
}
