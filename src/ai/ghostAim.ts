import type { RuleContext } from '../rules/ruleTypes';
import { isLegalTarget } from '../rules/ruleTypes';
import {
  BALL_RADIUS,
  POCKETS,
  add,
  clamp,
  distance,
  dot,
  length,
  normalize,
  scale,
  sub,
} from '../sim/SimulationState';
import type {
  BallState,
  PocketDefinition,
  SimulationState,
  Vec2,
} from '../sim/SimulationState';

const EPSILON = 1e-9;
const DEFAULT_COLLISION_CLEARANCE = BALL_RADIUS * 2;

export interface GhostAimCandidate {
  readonly targetBallId: number;
  readonly pocketId: number;
  readonly ghostPosition: Vec2;
  readonly angle: number;
  readonly cutAngle: number;
  readonly cueDistance: number;
  readonly objectDistance: number;
  readonly cuePathClear: boolean;
  readonly objectPathClear: boolean;
  readonly viable: boolean;
  readonly score: number;
}

/** Return copies so callers cannot accidentally mutate the shared table definitions. */
export function enumeratePockets(): PocketDefinition[] {
  return POCKETS.map(pocket => ({ id: pocket.id, position: { ...pocket.position } }));
}

/** Enumerate active object balls accepted by the rules for the requested seat. */
export function enumerateLegalTargets(
  context: RuleContext,
  seat = context.state.currentPlayer,
): BallState[] {
  return context.simulation.balls.filter(ball =>
    ball.onTable && !ball.pocketed && isLegalTarget(context, ball.id, seat));
}

export const enumerateTargetBalls = enumerateLegalTargets;

/** The cue-ball centre at contact which sends the target towards the pocket. */
export function calculateGhostBallPosition(
  targetPosition: Vec2,
  pocketPosition: Vec2,
  radius = BALL_RADIUS,
): Vec2 {
  const awayFromPocket = normalize(sub(targetPosition, pocketPosition));
  return add(targetPosition, scale(awayFromPocket, radius * 2));
}

export const ghostBallPosition = calculateGhostBallPosition;

/**
 * Find the first active ball intersecting a segment. Ignored ids normally contain
 * the moving ball and, for a cue path, the intended contact ball.
 */
export function findBlockingBall(
  simulation: SimulationState,
  start: Vec2,
  end: Vec2,
  ignoredBallIds: readonly number[] = [],
  clearance = DEFAULT_COLLISION_CLEARANCE,
): BallState | null {
  const segment = sub(end, start);
  const segmentLengthSquared = dot(segment, segment);
  if (segmentLengthSquared <= EPSILON) return null;

  const ignored = new Set(ignoredBallIds);
  const clearanceSquared = clearance * clearance;
  let nearest: BallState | null = null;
  let nearestProjection = Number.POSITIVE_INFINITY;

  for (const ball of simulation.balls) {
    if (!ball.onTable || ball.pocketed || ignored.has(ball.id)) continue;
    const fromStart = sub(ball.position, start);
    const projection = clamp(dot(fromStart, segment) / segmentLengthSquared, 0, 1);
    const closest = add(start, scale(segment, projection));
    if (distance(closest, ball.position) > clearance) continue;

    // Clamp can put a ball beyond an endpoint at that endpoint. Its actual
    // distance check above still determines whether it intersects the path.
    if (projection < nearestProjection ||
      (projection === nearestProjection && nearest !== null && ball.id < nearest.id)) {
      nearest = ball;
      nearestProjection = projection;
    }
  }

  return nearest;
}

export function isPathBlocked(
  simulation: SimulationState,
  start: Vec2,
  end: Vec2,
  ignoredBallIds: readonly number[] = [],
  clearance = DEFAULT_COLLISION_CLEARANCE,
): boolean {
  return findBlockingBall(simulation, start, end, ignoredBallIds, clearance) !== null;
}

export const isLineBlocked = isPathBlocked;

/** Build all target/pocket ghost-ball candidates without changing simulation state. */
export function enumerateGhostAimCandidates(context: RuleContext): GhostAimCandidate[] {
  const cueBall = context.simulation.balls.find(ball =>
    ball.id === 0 && ball.onTable && !ball.pocketed);
  if (!cueBall) return [];

  const candidates: GhostAimCandidate[] = [];
  for (const target of enumerateLegalTargets(context)) {
    for (const pocket of enumeratePockets()) {
      const ghostPosition = calculateGhostBallPosition(target.position, pocket.position);
      const cueLine = sub(ghostPosition, cueBall.position);
      const objectLine = sub(pocket.position, target.position);
      const cueDistance = length(cueLine);
      const objectDistance = length(objectLine);
      if (cueDistance <= EPSILON || objectDistance <= EPSILON) continue;

      const cueDirection = normalize(cueLine);
      const objectDirection = normalize(objectLine);
      const alignment = dot(cueDirection, objectDirection);
      const cutAngle = Math.acos(clamp(alignment, -1, 1));
      const cuePathClear = !isPathBlocked(
        context.simulation,
        cueBall.position,
        ghostPosition,
        [cueBall.id, target.id],
      );
      const objectPathClear = !isPathBlocked(
        context.simulation,
        target.position,
        pocket.position,
        [target.id],
      );
      const geometricallyPossible = alignment > 0.025 && cutAngle < Math.PI / 2 - 0.01;
      const viable = geometricallyPossible && cuePathClear && objectPathClear;

      // Lower is better. Large penalties keep blocked or impossible shots as
      // fallbacks without allowing them to outrank a direct pot.
      const score = cueDistance + objectDistance * 1.15 + cutAngle * 1.4 +
        (geometricallyPossible ? 0 : 30) +
        (cuePathClear ? 0 : 20) + (objectPathClear ? 0 : 20);

      candidates.push({
        targetBallId: target.id,
        pocketId: pocket.id,
        ghostPosition,
        angle: Math.atan2(cueLine.y, cueLine.x),
        cutAngle,
        cueDistance,
        objectDistance,
        cuePathClear,
        objectPathClear,
        viable,
        score,
      });
    }
  }

  return candidates;
}

export const buildGhostAimCandidates = enumerateGhostAimCandidates;

export function rankAimCandidates(candidates: readonly GhostAimCandidate[]): GhostAimCandidate[] {
  return [...candidates].sort((a, b) =>
    a.score - b.score ||
    a.targetBallId - b.targetBallId ||
    a.pocketId - b.pocketId);
}
