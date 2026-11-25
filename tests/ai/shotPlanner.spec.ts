import { describe, expect, it } from 'vitest';
import { SeededRng } from '../../src/core/random/SeededRng';
import { isLegalTarget } from '../../src/rules/ruleTypes';
import type { RuleContext, RuleState } from '../../src/rules/ruleTypes';
import {
  BALL_RADIUS,
  POCKETS,
  createBall,
  distance,
} from '../../src/sim/SimulationState';
import type { BallState } from '../../src/sim/SimulationState';
import { DIFFICULTY_PARAMETERS } from '../../src/ai/difficulty';
import {
  calculateGhostBallPosition,
  enumerateGhostAimCandidates,
  enumerateLegalTargets,
  enumeratePockets,
  isPathBlocked,
  rankAimCandidates,
} from '../../src/ai/ghostAim';
import { planShot } from '../../src/ai/shotPlanner';

function ruleState(overrides: Partial<RuleState> = {}): RuleState {
  return {
    currentPlayer: 0,
    groups: [null, null],
    openTable: true,
    isBreak: false,
    ballInHand: false,
    winner: null,
    consecutiveFouls: [0, 0],
    shotNumber: 1,
    ...overrides,
  };
}

function contextWith(balls: BallState[], state: Partial<RuleState> = {}): RuleContext {
  return { state: ruleState(state), simulation: { balls, step: 10, braking: [] } };
}

function simpleContext(state: Partial<RuleState> = {}): RuleContext {
  return contextWith([
    createBall(0, { x: -0.55, y: 0 }),
    createBall(1, { x: 0.2, y: 0 }),
  ], state);
}

describe('ghostAim', () => {
  it('enumerates independent pocket definitions and only active legal targets', () => {
    const pocketedNine = createBall(9, { x: 0.4, y: 0 });
    pocketedNine.pocketed = true;
    pocketedNine.onTable = false;
    const context = contextWith([
      createBall(0, { x: -0.5, y: 0 }),
      createBall(1, { x: 0, y: 0 }),
      pocketedNine,
      createBall(8, { x: 0.4, y: 0.2 }),
    ], { groups: ['solids', 'stripes'], openTable: false });

    expect(enumerateLegalTargets(context).map(ball => ball.id)).toEqual([1]);
    const pockets = enumeratePockets();
    expect(pockets).toHaveLength(6);
    expect(pockets).not.toBe(POCKETS);
    pockets[0]!.position.x = 999;
    expect(POCKETS[0]!.position.x).not.toBe(999);
  });

  it('allows the eight ball only after the assigned group is cleared', () => {
    const one = createBall(1, { x: 0, y: 0 });
    one.pocketed = true;
    one.onTable = false;
    const context = contextWith([
      createBall(0, { x: -0.5, y: 0 }),
      one,
      createBall(8, { x: 0.2, y: 0 }),
    ], { groups: ['solids', 'stripes'], openTable: false });

    expect(enumerateLegalTargets(context).map(ball => ball.id)).toEqual([8]);
  });

  it('places the ghost ball two radii behind the target and detects blockers', () => {
    const target = { x: 0, y: 0 };
    const pocket = { x: 1, y: 0 };
    const ghost = calculateGhostBallPosition(target, pocket);
    expect(ghost.x).toBeCloseTo(-BALL_RADIUS * 2);
    expect(ghost.y).toBeCloseTo(0);
    expect(distance(ghost, target)).toBeCloseTo(BALL_RADIUS * 2);

    const simulation = contextWith([
      createBall(0, { x: -0.5, y: 0 }),
      createBall(1, target),
      createBall(9, { x: -0.25, y: 0 }),
    ]).simulation;
    expect(isPathBlocked(simulation, { x: -0.5, y: 0 }, ghost, [0, 1])).toBe(true);
    expect(isPathBlocked(simulation, { x: -0.5, y: 0 }, ghost, [0, 1, 9])).toBe(false);
  });
});

describe('planShot', () => {
  it('returns a legal target, a real pocket, bounded power and neutral spin', () => {
    const context = simpleContext({ groups: ['solids', 'stripes'], openTable: false });
    const shot = planShot(context, new SeededRng(42), 'normal');

    expect(isLegalTarget(context, shot.targetBallId)).toBe(true);
    expect(POCKETS.some(pocket => pocket.id === shot.pocketId)).toBe(true);
    expect(shot.power).toBeGreaterThanOrEqual(0.18);
    expect(shot.power).toBeLessThanOrEqual(1);
    expect(shot.spin).toEqual({ x: 0, y: 0 });
    expect(Number.isFinite(shot.angle)).toBe(true);
  });

  it('replays exactly with the same seed and state', () => {
    const context = simpleContext();
    const first = planShot(context, new SeededRng(123456), 'hard');
    const second = planShot(context, new SeededRng(123456), 'hard');
    expect(first).toEqual(second);
  });

  it('uses strictly decreasing aim and power noise with increasing skill', () => {
    const easy = DIFFICULTY_PARAMETERS.easy;
    const normal = DIFFICULTY_PARAMETERS.normal;
    const hard = DIFFICULTY_PARAMETERS.hard;
    expect(easy.aimError).toBeGreaterThan(normal.aimError);
    expect(normal.aimError).toBeGreaterThan(hard.aimError);
    expect(easy.powerError).toBeGreaterThan(normal.powerError);
    expect(normal.powerError).toBeGreaterThan(hard.powerError);
    expect(easy.candidateDepth).toBeLessThan(normal.candidateDepth);
    expect(normal.candidateDepth).toBeLessThan(hard.candidateDepth);
  });

  it('produces larger average aiming errors on easy than hard', () => {
    const context = simpleContext();
    const ideal = rankAimCandidates(enumerateGhostAimCandidates(context))
      .find(candidate => candidate.viable)!.angle;
    const angularError = (angle: number): number => {
      const raw = Math.abs(angle - ideal) % (Math.PI * 2);
      return Math.min(raw, Math.PI * 2 - raw);
    };
    const samples = 80;
    let easyError = 0;
    let hardError = 0;
    for (let seed = 1; seed <= samples; seed += 1) {
      easyError += angularError(planShot(context, new SeededRng(seed), 'easy').angle);
      hardError += angularError(planShot(context, new SeededRng(seed), 'hard').angle);
    }
    expect(easyError / samples).toBeGreaterThan((hardError / samples) * 3);
  });

  it('does not mutate rules, balls, braking effects or pocket definitions', () => {
    const context = simpleContext();
    context.simulation.braking.push({ id: 'brake', ballId: 1, remainingSteps: 5, deceleration: 0.2 });
    const before = structuredClone(context);
    const pocketsBefore = structuredClone(POCKETS);

    planShot(context, new SeededRng(77), 'normal');

    expect(context).toEqual(before);
    expect(POCKETS).toEqual(pocketsBefore);
  });

  it('still selects a legal intended target when every direct pot is blocked', () => {
    const context = contextWith([
      createBall(0, { x: -0.5, y: 0 }),
      createBall(1, { x: 0, y: 0 }),
      createBall(9, { x: -0.25, y: 0 }),
      createBall(10, { x: 0.25, y: 0 }),
    ]);
    const shot = planShot(context, new SeededRng(8), 'hard');
    expect(isLegalTarget(context, shot.targetBallId)).toBe(true);
  });

  it('refuses to invent a target when the rules provide none', () => {
    const context = contextWith([createBall(0, { x: 0, y: 0 })]);
    expect(() => planShot(context, new SeededRng(1), 'easy')).toThrow(RangeError);
  });
});
