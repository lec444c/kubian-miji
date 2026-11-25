import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  POCKETS,
  TABLE_HALF_X,
  TABLE_HALF_Y,
  createBall,
  distance,
  type SimulationState,
} from '../../src/sim/SimulationState';
import {
  HAND_POCKET_CLEARANCE,
  commitHandAdjustment,
  createHandAdjustment,
  getHandCandidates,
  isSafeHandPosition,
} from '../../src/skills/handMicroAdjustment';

const groups = { 0: 'solids', 1: 'stripes' } as const;
const stateOf = (balls: SimulationState['balls']): SimulationState => ({ balls, step: 0, braking: [] });

function cornerBall(id: number): ReturnType<typeof createBall> {
  return createBall(id, { x: TABLE_HALF_X - BALL_RADIUS, y: -TABLE_HALF_Y + BALL_RADIUS });
}

 describe('hand micro adjustment', () => {
  it('filters to stationary, own, assigned-group cushion balls', () => {
    const own = cornerBall(1);
    const notCushion = createBall(2, { x: 0, y: 0 });
    const moving = cornerBall(3);
    moving.motion = 'rolling';
    moving.velocity = { x: 1, y: 0 };
    const opponent = cornerBall(9);
    const eight = cornerBall(8);
    const pocketed = cornerBall(4);
    pocketed.pocketed = true;

    const state = stateOf([own, notCushion, moving, opponent, eight, pocketed]);
    expect(getHandCandidates(state, 0, groups)).toEqual([1]);
    expect(getHandCandidates(state, 0, { 0: null })).toEqual([]);
  });

  it('targets the nearest pocket with a non-overlapping point outside capture zones', () => {
    const own = cornerBall(1);
    const initial = stateOf([own]);
    const first = createHandAdjustment(initial, 0, groups, 1);
    expect(first).not.toBeNull();
    expect(first?.pocketId).toBe(2);
    const pocket = POCKETS.find((candidate) => candidate.id === first?.pocketId)!;
    expect(distance(first!.position, pocket.position)).toBeGreaterThanOrEqual(HAND_POCKET_CLEARANCE);
    expect(isSafeHandPosition(initial, 1, first!.position)).toBe(true);

    const blocker = createBall(0, first!.position);
    const blocked = stateOf([own, blocker]);
    const avoided = createHandAdjustment(blocked, 0, groups, 1);
    expect(avoided).not.toBeNull();
    expect(distance(avoided!.position, blocker.position)).toBeGreaterThanOrEqual(BALL_RADIUS * 2);
    expect(isSafeHandPosition(blocked, 1, avoided!.position)).toBe(true);
  });

  it('commits as a pure position transaction and rejects unsafe or stale submissions', () => {
    const own = cornerBall(1);
    const other = createBall(9, { x: 0, y: 0 });
    const state = stateOf([own, other]);
    const adjustment = createHandAdjustment(state, 0, groups, 1)!;
    const snapshot = structuredClone(state);

    const committed = commitHandAdjustment(state, 0, groups, adjustment);
    expect(committed.ok).toBe(true);
    if (committed.ok) {
      expect(committed.state).not.toBe(state);
      expect(committed.state.balls.find((ball) => ball.id === 1)?.position).toEqual(adjustment.position);
      expect(committed.state.balls.find((ball) => ball.id === 9)?.position).toEqual(other.position);
    }
    expect(state).toEqual(snapshot);

    const unsafe = { ...adjustment, position: { ...POCKETS[2]!.position } };
    expect(commitHandAdjustment(state, 0, groups, unsafe)).toEqual({ ok: false, reason: 'unsafe-position' });

    const moved = structuredClone(state);
    moved.balls.find((ball) => ball.id === 1)!.position.y += 0.01;
    expect(commitHandAdjustment(moved, 0, groups, adjustment)).toEqual({ ok: false, reason: 'stale-ball-position' });
  });
});
