import { describe, expect, it } from 'vitest';
import { emptyShotOutcome, type ShotOutcome } from '../../src/sim/ShotOutcome';
import { createRack as rackBalls } from '../../src/sim/rack';
import {
  canResolveShot,
  createInitialRuleState,
  isDuplicateShot,
  isLegalTarget,
  prepareShot,
  remainingGroupBalls,
  resolveChineseEight,
  respotEightBall,
  respotBallsOnTable,
  type RuleContext,
  type RuleState,
} from '../../src/rules/ruleTypes';

function table() {
  return { balls: rackBalls(7), step: 0, braking: [] };
}

function outcome(shotId: number, firstContact: number | null, potted: number[] = [], shooter: 0 | 1 = 0): ShotOutcome {
  const result = emptyShotOutcome(shotId, shooter, 0);
  result.firstContact = firstContact;
  result.anyBallMoved = true;
  result.cushionAfterContact = true;
  result.cushionContacts = [firstContact ?? 0];
  result.pocketed = potted.map((ballId, index) => ({ ballId, pocketId: index % 6, step: index + 1 }));
  result.cueScratch = potted.includes(0);
  result.endedStep = 100;
  return result;
}

function context(state: RuleState = createInitialRuleState()): RuleContext {
  return prepareShot({ state, simulation: table() });
}

function assigned(group: 'solids' | 'stripes' = 'solids'): RuleState {
  return {
    ...createInitialRuleState(),
    groups: group === 'solids' ? ['solids', 'stripes'] : ['stripes', 'solids'],
    openTable: false,
    isBreak: false,
  };
}

describe('rule setup and shot snapshots', () => {
  it('starts on an open break with player zero', () => {
    const state = createInitialRuleState();
    expect(state).toMatchObject({ currentPlayer: 0, openTable: true, isBreak: true, winner: null, shotNumber: 0 });
  });

  it('captures an independent pre-shot table and does not mutate its input', () => {
    const original = context();
    const before = JSON.stringify(original);
    const prepared = prepareShot(original);
    original.simulation.balls[1]!.pocketed = true;
    expect(prepared.preShotSimulation?.balls[1]?.pocketed).toBe(false);
    expect(prepared.state).not.toBe(original.state);
    expect(JSON.stringify(original)).not.toBe(before);
  });

  it('uses the pre-shot table for legal targets and group counts', () => {
    const ctx = context(assigned());
    expect(isLegalTarget(ctx, 1)).toBe(true);
    expect(isLegalTarget(ctx, 8)).toBe(false);
    expect(remainingGroupBalls(ctx.simulation, 'solids')).toBe(7);
  });
});

describe('break and open table', () => {
  it('requires four object balls to reach a rail on a dry break', () => {
    const shot = outcome(1, 1);
    shot.cushionContacts = [1, 2, 3];
    const dry = resolveChineseEight(context(), shot);
    expect(dry.foul).toMatch(/四颗/);
    expect(dry.state.currentPlayer).toBe(1);
    expect(dry.state.ballInHand).toBe(true);
    expect(dry.state.isBreak).toBe(false);
  });

  it('allows a dry break with four distinct object cushions', () => {
    const shot = outcome(1, 1);
    shot.cushionContacts = [1, 2, 3, 4];
    const result = resolveChineseEight(context(), shot);
    expect(result.foul).toBeNull();
    expect(result.continued).toBe(false);
    expect(result.state.currentPlayer).toBe(1);
    expect(result.state.openTable).toBe(true);
  });

  it('keeps the table open after a potted break and lets the breaker continue', () => {
    const result = resolveChineseEight(context(), outcome(1, 1, [1, 9]));
    expect(result.foul).toBeNull();
    expect(result.continued).toBe(true);
    expect(result.state).toMatchObject({ currentPlayer: 0, openTable: true, groups: [null, null], isBreak: false });
  });

  it('ends the match immediately when the eight drops on the break (breaker loses)', () => {
    const result = resolveChineseEight(context(), outcome(1, 1, [8]));
    expect(result.respotEight).toBe(false);
    expect(result.state.winner).toBe(1);
    expect(result.continued).toBe(false);
    expect(result.message).toContain('开球击入8号球');
    expect(result.state.isBreak).toBe(false);
  });

  it('assigns a single potted group after the break', () => {
    const state = createInitialRuleState();
    state.isBreak = false;
    const result = resolveChineseEight(context(state), outcome(1, 1, [1]));
    expect(result.state.groups).toEqual(['solids', 'stripes']);
    expect(result.state.openTable).toBe(false);
    expect(result.continued).toBe(true);
  });

  it('leaves a mixed-group pot open and continues', () => {
    const state = createInitialRuleState();
    state.isBreak = false;
    const result = resolveChineseEight(context(state), outcome(1, 1, [1, 9]));
    expect(result.state.groups).toEqual([null, null]);
    expect(result.state.openTable).toBe(true);
    expect(result.continued).toBe(true);
  });
});

describe('fouls, turns and ball in hand', () => {
  it.each([
    ['no contact', outcome(1, null)],
    ['wrong first ball', outcome(1, 9)],
    ['eight first on an open table', outcome(1, 8)],
  ])(' penalises %s', (_name, shot) => {
    const result = resolveChineseEight(context(assigned()), shot);
    expect(result.foul).not.toBeNull();
    expect(result.state.currentPlayer).toBe(1);
    expect(result.state.ballInHand).toBe(true);
    expect(result.continued).toBe(false);
  });

  it('requires a rail after contact when nothing is potted', () => {
    const shot = outcome(1, 1);
    shot.cushionAfterContact = false;
    shot.cushionContacts = [];
    const result = resolveChineseEight(context(assigned()), shot);
    expect(result.foul).toMatch(/碰库/);
    expect(result.state.ballInHand).toBe(true);
  });

  it('treats a cue scratch as a foul even when an own ball is potted', () => {
    const result = resolveChineseEight(context(assigned()), outcome(1, 1, [0, 1]));
    expect(result.foul).toMatch(/白球/);
    expect(result.state.currentPlayer).toBe(1);
    expect(result.state.ballInHand).toBe(true);
  });

  it('continues for an own-group pot even if an opponent ball also falls', () => {
    const result = resolveChineseEight(context(assigned()), outcome(1, 1, [1, 9]));
    expect(result.foul).toBeNull();
    expect(result.continued).toBe(true);
    expect(result.state.currentPlayer).toBe(0);
  });

  it('passes the turn when only the opponent group falls', () => {
    const result = resolveChineseEight(context(assigned()), outcome(1, 1, [9]));
    expect(result.foul).toBeNull();
    expect(result.continued).toBe(false);
    expect(result.state.currentPlayer).toBe(1);
    expect(result.state.ballInHand).toBe(false);
  });

  it('tracks consecutive fouls and resets the shooter after a legal shot', () => {
    const state = assigned();
    state.consecutiveFouls = [2, 1];
    const foul = resolveChineseEight(context(state), outcome(3, null));
    expect(foul.state.consecutiveFouls).toEqual([3, 1]);
    const legal = resolveChineseEight(context(state), outcome(3, 1, [1]));
    expect(legal.state.consecutiveFouls).toEqual([0, 1]);
  });
});

describe('eight-ball endings', () => {
  it('loses immediately after potting an early eight while object balls remain', () => {
    const result = resolveChineseEight(context(assigned()), outcome(1, 1, [8]));
    expect(result.respotEight).toBe(false);
    expect(result.foul).toMatch(/提前/);
    expect(result.state.currentPlayer).toBe(0);
    expect(result.state.winner).toBe(1);
    expect(result.state.ballInHand).toBe(false);
  });

  it('loses when an early eight falls with no other object balls remaining', () => {
    const state = createInitialRuleState();
    state.isBreak = false;
    const ctx = context(state);
    for (const ball of ctx.simulation.balls) {
      if (ball.id !== 0 && ball.id !== 8) {
        ball.onTable = false;
        ball.pocketed = true;
      }
    }
    ctx.preShotSimulation = structuredClone(ctx.simulation);
    const result = resolveChineseEight(ctx, outcome(1, 8, [8]));
    expect(result.state.winner).toBe(1);
    expect(result.respotEight).toBe(false);
  });

  it('wins with a clean eight after the group was already cleared', () => {
    const ctx = context(assigned());
    for (const ball of ctx.simulation.balls) {
      if (ball.id >= 1 && ball.id <= 7) {
        ball.onTable = false;
        ball.pocketed = true;
      }
    }
    ctx.preShotSimulation = structuredClone(ctx.simulation);
    const result = resolveChineseEight(ctx, outcome(1, 8, [8]));
    expect(result).toMatchObject({ foul: null, continued: false, respotEight: false });
    expect(result.state.winner).toBe(0);
  });

  it('loses when the final group ball and eight fall in the same shot', () => {
    const ctx = context(assigned());
    for (const ball of ctx.simulation.balls) {
      if (ball.id >= 2 && ball.id <= 7) {
        ball.onTable = false;
        ball.pocketed = true;
      }
    }
    ctx.preShotSimulation = structuredClone(ctx.simulation);
    const result = resolveChineseEight(ctx, outcome(1, 1, [1, 8]));
    expect(result.foul).toMatch(/提前/);
    expect(result.state.winner).toBe(1);
  });

  it('loses when scratching on an otherwise legal eight', () => {
    const ctx = context(assigned());
    for (const ball of ctx.simulation.balls) {
      if (ball.id >= 1 && ball.id <= 7) {
        ball.onTable = false;
        ball.pocketed = true;
      }
    }
    ctx.preShotSimulation = structuredClone(ctx.simulation);
    const result = resolveChineseEight(ctx, outcome(1, 8, [0, 8]));
    expect(result.foul).toMatch(/白球/);
    expect(result.state.winner).toBe(1);
  });

  it('respots eight immutably at the foot spot', () => {
    const state = table();
    state.balls.find(ball => ball.id === 8)!.pocketed = true;
    state.balls.find(ball => ball.id === 8)!.onTable = false;
    const result = respotEightBall(state);
    expect(result.balls.find(ball => ball.id === 8)).toMatchObject({ onTable: true, pocketed: false, motion: 'stationary' });
    expect(state.balls.find(ball => ball.id === 8)?.pocketed).toBe(true);
  });
});

describe('jumped balls (round 7)', () => {
  it('loses the match when the eight flies off the table', () => {
    const ctx = context(assigned());
    const shot = outcome(1, 1, []);
    shot.flewOffTable = [8];
    const result = resolveChineseEight(ctx, shot);
    expect(result.state.winner).toBe(1);
    expect(result.foul).toMatch(/8号球跳离球台|飞出/);
    expect(result.respotBalls).toEqual([]);
  });

  it('respots jumped object balls and hands a free ball to the opponent', () => {
    const ctx = context(assigned());
    const shot = outcome(1, 1, []);
    shot.flewOffTable = [3, 11];
    const result = resolveChineseEight(ctx, shot);
    expect(result.state.winner).toBeNull();
    expect(result.respotBalls).toEqual([3, 11]);
    expect(result.state.ballInHand).toBe(true);
    expect(result.state.currentPlayer).toBe(1);
    const respotted = respotBallsOnTable(ctx.simulation, result.respotBalls);
    for (const id of [3, 11]) {
      expect(respotted.balls.find(ball => ball.id === id)).toMatchObject({ onTable: true, pocketed: false });
    }
    // The two respotted balls must not overlap each other or the rack.
    const a = respotted.balls.find(ball => ball.id === 3)!.position;
    const b = respotted.balls.find(ball => ball.id === 11)!.position;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.06);
  });

  it('does not respot the cue ball (ball-in-hand restores it)', () => {
    const ctx = context(assigned());
    const shot = outcome(1, 1, []);
    shot.flewOffTable = [0];
    const result = resolveChineseEight(ctx, shot);
    expect(result.respotBalls).toEqual([]);
    expect(result.state.ballInHand).toBe(true);
  });
});

describe('duplicate shot protection', () => {
  it('rejects resolving the same outcome twice and rejects post-game shots', () => {
    const ctx = context(assigned());
    const shot = outcome(1, 1, [1]);
    const first = resolveChineseEight(ctx, shot);
    expect(isDuplicateShot(first.state, shot)).toBe(true);
    expect(canResolveShot(first.state, shot)).toBe(false);
    expect(() => resolveChineseEight(ctx, shot)).not.toThrow();
    expect(() => resolveChineseEight({ ...ctx, state: first.state }, shot)).toThrow(/already/);
    expect(() => resolveChineseEight({ ...ctx, state: { ...first.state, winner: 0 } }, outcome(2, 1))).toThrow(/ended/);
  });
});
