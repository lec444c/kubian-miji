import type { BallGroup, Seat } from '../app/matchTypes';
import { otherSeat } from '../app/matchTypes';
import type { ShotOutcome } from '../sim/ShotOutcome';
import {
  BALL_RADIUS,
  CUSHION_HALF_X,
  TABLE_HALF_X,
  cloneSimulationState,
  type SimulationState,
} from '../sim/SimulationState';

// Rule decisions are adapted from
// third_party/tailuge-billiards/src/controller/rules/eightball.ts (GPLv3,
// reuse approved), with controller/view side effects replaced by pure results.

export interface RuleState {
  currentPlayer: Seat;
  groups: [BallGroup | null, BallGroup | null];
  openTable: boolean;
  isBreak: boolean;
  ballInHand: boolean;
  winner: Seat | null;
  consecutiveFouls: [number, number];
  shotNumber: number;
}

export interface RuleContext {
  state: RuleState;
  /** Post-shot simulation state. */
  simulation: SimulationState;
  /** Immutable state captured immediately before strike(). */
  preShotSimulation?: SimulationState;
}

export interface RuleResolution {
  state: RuleState;
  foul: string | null;
  message: string;
  continued: boolean;
  respotEight: boolean;
  /** Object balls (never cue/eight) that flew off the table and must be respotted. */
  respotBalls: number[];
}

export function createInitialRuleState(): RuleState {
  return {
    currentPlayer: 0,
    groups: [null, null],
    openTable: true,
    isBreak: true,
    ballInHand: false,
    winner: null,
    consecutiveFouls: [0, 0],
    shotNumber: 0,
  };
}

export function cloneRuleState(state: RuleState): RuleState {
  return {
    ...state,
    groups: [...state.groups],
    consecutiveFouls: [...state.consecutiveFouls],
  };
}

/**
 * Capture everything needed to resolve a later shot. Neither the supplied
 * context nor its simulation is retained by reference.
 */
export function prepareShot(context: RuleContext): RuleContext {
  const simulation = cloneSimulationState(context.simulation);
  return {
    state: cloneRuleState(context.state),
    simulation,
    preShotSimulation: cloneSimulationState(simulation),
  };
}

export const captureShot = prepareShot;

/** shotNumber doubles as a monotonic, serialisable duplicate-shot guard. */
export function isDuplicateShot(state: RuleState, shot: number | Pick<ShotOutcome, 'shotId'>): boolean {
  const shotId = typeof shot === 'number' ? shot : shot.shotId;
  return state.shotNumber > 0 && shotId <= state.shotNumber;
}

export function canResolveShot(state: RuleState, outcome: ShotOutcome): boolean {
  return state.winner === null && !isDuplicateShot(state, outcome);
}

export function assertShotResolvable(state: RuleState, outcome: ShotOutcome): void {
  if (state.winner !== null) throw new Error('Cannot resolve a shot after the game has ended');
  if (isDuplicateShot(state, outcome)) throw new Error(`Shot ${outcome.shotId} has already been resolved`);
}

export function remainingGroupBalls(simulation: SimulationState, group: BallGroup): number {
  return simulation.balls.filter(ball => !ball.pocketed && ball.onTable &&
    (group === 'solids' ? ball.id >= 1 && ball.id <= 7 : ball.id >= 9 && ball.id <= 15)).length;
}

export function isLegalTarget(context: RuleContext, ballId: number, seat = context.state.currentPlayer): boolean {
  if (ballId === 0) return false;
  const group = context.state.groups[seat];
  if (group) {
    return remainingGroupBalls(context.preShotSimulation ?? context.simulation, group) === 0 ? ballId === 8 :
      group === 'solids' ? ballId >= 1 && ballId <= 7 : ballId >= 9 && ballId <= 15;
  }
  return ballId !== 8;
}

function isObjectBall(ballId: number): boolean {
  return ballId >= 1 && ballId <= 15;
}

function isInGroup(ballId: number, group: BallGroup): boolean {
  return group === 'solids' ? ballId >= 1 && ballId <= 7 : ballId >= 9 && ballId <= 15;
}

/** Count group balls after also applying outcome pots, for lightweight tests/replays. */
function remainingAfterOutcome(simulation: SimulationState, outcome: ShotOutcome, group: BallGroup): number {
  const potted = new Set(outcome.pocketed.map(ball => ball.ballId));
  return simulation.balls.filter(ball => isInGroup(ball.id, group) && !potted.has(ball.id) &&
    !ball.pocketed && ball.onTable).length;
}

function nonEightRemaining(simulation: SimulationState, outcome: ShotOutcome): number {
  const potted = new Set(outcome.pocketed.map(ball => ball.ballId));
  return simulation.balls.filter(ball => isObjectBall(ball.id) && ball.id !== 8 &&
    !potted.has(ball.id) && !ball.pocketed && ball.onTable).length;
}

function basicFoul(context: RuleContext, outcome: ShotOutcome): string | null {
  const before = context.preShotSimulation ?? context.simulation;
  const targetContext: RuleContext = {
    state: context.state,
    simulation: before,
    preShotSimulation: before,
  };

  if (outcome.cueScratch) return '白球洗袋';
  if (outcome.flewOffTable.length > 0) return '有球飞出球台';
  if (outcome.firstContact === null) return '白球未碰到目标球';
  if (!isLegalTarget(targetContext, outcome.firstContact)) return '首碰目标球不合法';
  if (outcome.pocketed.length === 0 && !outcome.cushionAfterContact) return '首碰后无球碰库且无人入袋';

  if (context.state.isBreak && outcome.pocketed.every(ball => ball.ballId === 0)) {
    const objectCushions = new Set(outcome.cushionContacts.filter(isObjectBall));
    if (objectCushions.size < 4) return '开球未使至少四颗目标球碰库';
  }
  return null;
}

/**
 * Resolve one completed shot without mutating context or outcome.
 *
 * Chinese-eight resolution: only a player who had already cleared the group
 * before this shot may win with the eight. An early eight, clearing the final
 * group ball and eight together, or potting a legal eight with a foul all lose.
 * Potting the eight on the break also ends the match immediately (breaker loses).
 */
export function resolveChineseEight(context: RuleContext, outcome: ShotOutcome): RuleResolution {
  assertShotResolvable(context.state, outcome);
  const next = cloneRuleState(context.state);
  const seat = context.state.currentPlayer;
  const opponent = otherSeat(seat);
  const before = context.preShotSimulation ?? context.simulation;
  const groupBefore = context.state.groups[seat];
  const pottedIds = outcome.pocketed.map(ball => ball.ballId);
  const eightPotted = pottedIds.includes(8);
  const eightFlew = outcome.flewOffTable.includes(8);
  const ordinaryPots = pottedIds.filter(ballId => ballId !== 0 && ballId !== 8);
  const wasOnEight = groupBefore !== null && remainingGroupBalls(before, groupBefore) === 0;

  let foul = basicFoul(context, outcome);
  let message = foul ?? '击球合法';
  // The eight is never respotted by rule resolution any more; the fake-free-ball
  // special foul still respots it via respotEightBall in GameController.
  const respotEight = false;
  // Round 7: object balls that jumped the table are respotted instead of being
  // silently counted as cleared, which used to leave matches unable to finish.
  const respotBalls = outcome.flewOffTable.filter(ballId => ballId !== 0 && ballId !== 8);
  let continued = false;
  let gameEnded = false;

  if (eightFlew) {
    next.winner = opponent;
    foul = foul ?? '8号球跳离球台';
    message = '8号球跳离球台，判负';
    gameEnded = true;
  } else if (eightPotted) {
    next.winner = !foul && wasOnEight ? seat : opponent;
    if (context.state.isBreak) {
      foul = foul ?? '开球击入8号球';
      message = '开球击入8号球，提前进8判负';
    } else if (wasOnEight) {
      message = foul ? `击打8号球时犯规：${foul}，判负` : '合法击入8号球，获胜';
    } else {
      foul = foul ?? '提前击入8号球';
      message = '提前击入8号球或同杆清台并打入8号球，判负';
    }
    gameEnded = true;
  }

  if (!gameEnded) {
    if (foul) {
      next.consecutiveFouls[seat] += 1;
      next.ballInHand = true;
      next.currentPlayer = opponent;
      continued = false;
      if (!eightPotted) message = `${message}，对方获得自由球`;
    } else {
      next.consecutiveFouls[seat] = 0;
      next.ballInHand = false;

      // Groups are never selected by the break, and mixed pots leave it open.
      if (!context.state.isBreak && context.state.openTable) {
        const solids = ordinaryPots.filter(ballId => isInGroup(ballId, 'solids')).length;
        const stripes = ordinaryPots.filter(ballId => isInGroup(ballId, 'stripes')).length;
        if ((solids > 0) !== (stripes > 0)) {
          const selected: BallGroup = solids > 0 ? 'solids' : 'stripes';
          next.groups[seat] = selected;
          next.groups[opponent] = selected === 'solids' ? 'stripes' : 'solids';
          next.openTable = false;
          message = `确定球组：${selected === 'solids' ? '全色球' : '花色球'}`;
        }
      }

      const effectiveGroup = next.groups[seat];
      continued = ordinaryPots.length > 0 &&
        (effectiveGroup === null || ordinaryPots.some(ballId => isInGroup(ballId, effectiveGroup)));
      if (!continued) next.currentPlayer = opponent;
      if (ordinaryPots.length > 0 && message === '击球合法') {
        message = continued ? '合法入袋，继续击球' : '合法入袋，交换击球权';
      }
    }
  } else {
    next.ballInHand = false;
    next.consecutiveFouls[seat] = foul ? next.consecutiveFouls[seat] + 1 : 0;
    continued = false;
  }

  next.isBreak = false;
  next.shotNumber = Math.max(next.shotNumber + 1, outcome.shotId);
  return { state: next, foul, message, continued, respotEight, respotBalls: gameEnded ? [] : respotBalls };
}

/** Pure helper for applying RuleResolution.respotEight to a simulation state. */
export function respotEightBall(simulation: SimulationState): SimulationState {
  return respotBallsOnTable(simulation, [8]);
}

/**
 * Return a copy with the given balls placed back on the foot spot line, scanning
 * toward the foot rail for the first free slot. Used for jumped object balls and
 * for the fake-free-ball special foul's eight.
 */
export function respotBallsOnTable(simulation: SimulationState, ballIds: number[]): SimulationState {
  const next = cloneSimulationState(simulation);
  for (const ballId of ballIds) {
    const ball = next.balls.find(candidate => candidate.id === ballId);
    if (!ball) throw new Error(`Ball ${ballId} is missing`);
    let x = TABLE_HALF_X / 2;
    const occupied = (candidateX: number): boolean => next.balls.some(other => other.id !== ballId &&
      other.onTable && !other.pocketed && Math.hypot(other.position.x - candidateX, other.position.y) < BALL_RADIUS * 2 + 1e-6);
    while (occupied(x) && x < CUSHION_HALF_X - BALL_RADIUS) x += BALL_RADIUS * 2.01;
    ball.position = { x, y: 0 };
    ball.velocity = { x: 0, y: 0 };
    ball.angularVelocity = { x: 0, y: 0, z: 0 };
    ball.motion = 'stationary';
    ball.onTable = true;
    ball.pocketed = false;
  }
  return next;
}
