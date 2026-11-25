import { groupOfBall, type Seat } from '../app/matchTypes';
import {
  BALL_RADIUS,
  CUSHION_HALF_X,
  CUSHION_HALF_Y,
  POCKET_RADIUS,
  POCKETS,
  cloneSimulationState,
  distance,
  normalize,
  sub,
  type BallState,
  type PocketDefinition,
  type SimulationState,
  type Vec2,
} from '../sim/SimulationState';
import type { PlayerGroups } from './skillTypes';

export const CUSHION_TOLERANCE = BALL_RADIUS * 1.5;
export const HAND_POCKET_CLEARANCE = POCKET_RADIUS + BALL_RADIUS + 1e-4;
export const HAND_MAX_TARGET_DISTANCE = HAND_POCKET_CLEARANCE + 0.45;

export interface HandAdjustment {
  ballId: number;
  pocketId: number;
  from: Vec2;
  position: Vec2;
}

export type HandCommitFailure =
  | 'not-candidate'
  | 'no-safe-target'
  | 'stale-ball-position'
  | 'wrong-pocket'
  | 'unsafe-position';

export type HandCommitResult =
  | { ok: true; state: SimulationState; adjustment: HandAdjustment }
  | { ok: false; reason: HandCommitFailure };

export function isStationaryCushionBall(ball: BallState): boolean {
  if (!ball.onTable || ball.pocketed || ball.motion !== 'stationary') return false;
  const { x, y } = ball.position;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x) >= CUSHION_HALF_X - BALL_RADIUS - CUSHION_TOLERANCE
    || Math.abs(y) >= CUSHION_HALF_Y - BALL_RADIUS - CUSHION_TOLERANCE;
}

export function getHandCandidateBalls(
  state: SimulationState,
  seat: Seat,
  groups: PlayerGroups,
): BallState[] {
  const ownGroup = groups[seat];
  if (!ownGroup) return [];
  return state.balls.filter((ball) => groupOfBall(ball.id) === ownGroup && isStationaryCushionBall(ball));
}

export function getHandCandidates(state: SimulationState, seat: Seat, groups: PlayerGroups): number[] {
  return getHandCandidateBalls(state, seat, groups).map((ball) => ball.id);
}

export function nearestPocket(position: Vec2): PocketDefinition {
  let nearest = POCKETS[0]!;
  for (const pocket of POCKETS.slice(1)) {
    if (distance(position, pocket.position) < distance(position, nearest.position)) nearest = pocket;
  }
  return nearest;
}

function isLegalCenter(position: Vec2): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Math.abs(position.x) <= CUSHION_HALF_X - BALL_RADIUS + CUSHION_TOLERANCE
    && Math.abs(position.y) <= CUSHION_HALF_Y - BALL_RADIUS + CUSHION_TOLERANCE;
}

export function isSafeHandPosition(state: SimulationState, ballId: number, position: Vec2): boolean {
  if (!isLegalCenter(position)) return false;
  if (POCKETS.some((pocket) => distance(position, pocket.position) < HAND_POCKET_CLEARANCE)) return false;
  return !state.balls.some((ball) => ball.id !== ballId
    && ball.onTable
    && !ball.pocketed
    && distance(position, ball.position) < BALL_RADIUS * 2 - 1e-9);
}

function inwardDirection(pocket: PocketDefinition): Vec2 {
  return normalize({
    x: pocket.position.x === 0 ? 0 : -Math.sign(pocket.position.x),
    y: pocket.position.y === 0 ? 0 : -Math.sign(pocket.position.y),
  });
}

/** Find the closest safe radial point to the supplied pocket, deterministically. */
export function findSafePocketTarget(
  state: SimulationState,
  ball: BallState,
  pocket: PocketDefinition,
): Vec2 | null {
  const towardBall = sub(ball.position, pocket.position);
  const baseDirection = distance(towardBall, { x: 0, y: 0 }) > 1e-10
    ? normalize(towardBall)
    : inwardDirection(pocket);
  const baseAngle = Math.atan2(baseDirection.y, baseDirection.x);
  const angleOffsets = [0];
  for (let step = 1; step <= 12; step += 1) {
    const offset = step * Math.PI / 12;
    angleOffsets.push(offset, -offset);
  }

  const radialStep = BALL_RADIUS / 2;
  const ringCount = Math.ceil((HAND_MAX_TARGET_DISTANCE - HAND_POCKET_CLEARANCE) / radialStep);
  for (let ring = 0; ring <= ringCount; ring += 1) {
    const radius = Math.min(HAND_MAX_TARGET_DISTANCE, HAND_POCKET_CLEARANCE + ring * radialStep);
    for (const offset of angleOffsets) {
      const angle = baseAngle + offset;
      const candidate = {
        x: pocket.position.x + Math.cos(angle) * radius,
        y: pocket.position.y + Math.sin(angle) * radius,
      };
      if (isSafeHandPosition(state, ball.id, candidate)) return candidate;
    }
  }
  return null;
}

export function createHandAdjustment(
  state: SimulationState,
  seat: Seat,
  groups: PlayerGroups,
  ballId: number,
): HandAdjustment | null {
  const ball = getHandCandidateBalls(state, seat, groups).find((candidate) => candidate.id === ballId);
  if (!ball) return null;
  const pocket = nearestPocket(ball.position);
  const position = findSafePocketTarget(state, ball, pocket);
  if (!position) return null;
  return { ballId, pocketId: pocket.id, from: { ...ball.position }, position };
}

function samePosition(a: Vec2, b: Vec2): boolean {
  return distance(a, b) <= 1e-9;
}

/** Validate and apply a hand adjustment without mutating state or the adjustment. */
export function commitHandAdjustment(
  state: SimulationState,
  seat: Seat,
  groups: PlayerGroups,
  adjustment: HandAdjustment,
): HandCommitResult {
  const ball = getHandCandidateBalls(state, seat, groups).find((candidate) => candidate.id === adjustment.ballId);
  if (!ball) return { ok: false, reason: 'not-candidate' };
  if (!samePosition(ball.position, adjustment.from)) return { ok: false, reason: 'stale-ball-position' };

  const pocket = nearestPocket(ball.position);
  if (adjustment.pocketId !== pocket.id) return { ok: false, reason: 'wrong-pocket' };
  if (distance(adjustment.position, pocket.position) > HAND_MAX_TARGET_DISTANCE + 1e-9
    || !isSafeHandPosition(state, ball.id, adjustment.position)) {
    return { ok: false, reason: 'unsafe-position' };
  }

  const nextState = cloneSimulationState(state);
  const nextBall = nextState.balls.find((candidate) => candidate.id === adjustment.ballId);
  if (!nextBall) return { ok: false, reason: 'not-candidate' };
  nextBall.position = { ...adjustment.position };
  nextBall.velocity = { x: 0, y: 0 };
  nextBall.angularVelocity = { x: 0, y: 0, z: 0 };
  nextBall.motion = 'stationary';

  return {
    ok: true,
    state: nextState,
    adjustment: {
      ballId: adjustment.ballId,
      pocketId: adjustment.pocketId,
      from: { ...adjustment.from },
      position: { ...adjustment.position },
    },
  };
}
