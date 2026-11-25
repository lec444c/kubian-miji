import { describe, expect, it } from 'vitest';
import type { Difficulty, Seat } from '../../src/app/matchTypes';
import { SeededRng } from '../../src/core/random/SeededRng';
import { PracticeController } from '../../src/controllers/PracticeController';
import { planShot } from '../../src/ai/shotPlanner';
import {
  createInitialRuleState,
  isLegalTarget,
  resolveChineseEight,
  respotEightBall,
  type RuleContext,
  type RuleState,
} from '../../src/rules/ruleTypes';
import { createRackedSimulation } from '../../src/sim/rack';
import {
  BALL_RADIUS,
  CUSHION_HALF_X,
  CUSHION_HALF_Y,
  POCKETS,
  POCKET_RADIUS,
  cloneSimulationState,
  type Vec2,
} from '../../src/sim/SimulationState';
import type { Simulation } from '../../src/sim/Simulation';

interface ShotLogEntry {
  seat: Seat;
  angle: number;
  power: number;
  targetBallId: number;
}

/** Mirror of GameController.validCuePosition for headless ball-in-hand play. */
function legalCueSpot(simulation: Simulation): Vec2 {
  const spots: Vec2[] = [{ x: -0.72, y: 0 }, { x: -0.5, y: 0.25 }, { x: -0.5, y: -0.25 }, { x: 0, y: 0 }];
  for (let x = -1.1; x <= 1.1; x += 0.1) {
    for (let y = -0.5; y <= 0.5; y += 0.1) spots.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) });
  }
  const spot = spots.find(position => {
    if (Math.abs(position.x) > CUSHION_HALF_X - BALL_RADIUS || Math.abs(position.y) > CUSHION_HALF_Y - BALL_RADIUS) return false;
    if (POCKETS.some(pocket => Math.hypot(position.x - pocket.position.x, position.y - pocket.position.y) < POCKET_RADIUS + BALL_RADIUS)) return false;
    return !simulation.state.balls.some(ball => ball.id !== 0 && ball.onTable && !ball.pocketed &&
      Math.hypot(position.x - ball.position.x, position.y - ball.position.y) < BALL_RADIUS * 2.05);
  });
  if (!spot) throw new Error('No legal ball-in-hand spot exists');
  return spot;
}

function placeCue(simulation: Simulation): void {
  const cue = simulation.state.balls.find(ball => ball.id === 0);
  if (!cue) throw new Error('Cue ball missing');
  const spot = legalCueSpot(simulation);
  cue.position = { ...spot };
  cue.velocity = { x: 0, y: 0 };
  cue.angularVelocity = { x: 0, y: 0, z: 0 };
  cue.motion = 'stationary';
  cue.onTable = true;
  cue.pocketed = false;
}

/** Full headless match: planner + fixed-step sim + single rule resolver. */
function runMatch(difficulty: Difficulty, seed: number, maxShots = 120): { rule: RuleState; log: ShotLogEntry[] } {
  const simulation = createRackedSimulation(seed);
  const rng = new SeededRng(seed * 7 + 13);
  let rule = createInitialRuleState();
  const log: ShotLogEntry[] = [];
  while (rule.winner === null && log.length < maxShots) {
    if (rule.ballInHand) placeCue(simulation);
    const preShotSimulation = cloneSimulationState(simulation.state);
    const context: RuleContext = { state: rule, simulation: simulation.state, preShotSimulation };
    const command = planShot(context, rng, difficulty);
    expect(isLegalTarget(context, command.targetBallId)).toBe(true);
    expect(command.power).toBeGreaterThanOrEqual(0);
    expect(command.power).toBeLessThanOrEqual(1);
    simulation.shooter = rule.currentPlayer;
    const outcome = simulation.strike(command.angle, command.power, command.spin);
    expect(simulation.runUntilStopped(512 * 40)).toBeLessThan(512 * 40);
    for (const ball of simulation.state.balls) {
      expect(Number.isFinite(ball.position.x)).toBe(true);
      expect(Number.isFinite(ball.position.y)).toBe(true);
    }
    const resolution = resolveChineseEight({ state: rule, simulation: simulation.state, preShotSimulation }, outcome);
    rule = resolution.state;
    if (resolution.respotEight) simulation.state = respotEightBall(simulation.state);
    log.push({ seat: outcome.shooter, angle: command.angle, power: command.power, targetBallId: command.targetBallId });
  }
  return { rule, log };
}

describe('match flow integration', () => {
  it.each<Difficulty>(['easy', 'normal', 'hard'])('plays a full %s match to a winner with legal commands', difficulty => {
    const { rule, log } = runMatch(difficulty, 20261119);
    expect(rule.winner).not.toBeNull();
    expect(log.length).toBeGreaterThan(1);
    expect(log.length).toBeLessThan(120);
    expect(rule.isBreak).toBe(false);
  }, 60000);

  it('replays the identical shot sequence for the same seed', () => {
    const first = runMatch('normal', 4242);
    const second = runMatch('normal', 4242);
    expect(second.log).toEqual(first.log);
    expect(second.rule.winner).toBe(first.rule.winner);
  }, 60000);

  it('practice mode hands both seats to the same human controller with no AI', () => {
    const practice = new PracticeController();
    expect(practice.controlsSeat(0)).toBe(true);
    expect(practice.controlsSeat(1)).toBe(true);
    expect(practice.currentController(0)).toBe(practice.human);
    expect(practice.currentController(1)).toBe(practice.human);

    // A break that contacts no ball is a foul and transfers the seat;
    // practice still owns the receiving seat with the same human controller.
    const simulation = createRackedSimulation(7);
    const preShotSimulation = cloneSimulationState(simulation.state);
    const rule = createInitialRuleState();
    simulation.shooter = 0;
    const outcome = simulation.strike(Math.PI, 0.2);
    simulation.runUntilStopped(512 * 40);
    const resolution = resolveChineseEight({ state: rule, simulation: simulation.state, preShotSimulation }, outcome);
    expect(resolution.state.currentPlayer).toBe(1);
    expect(practice.controlsSeat(resolution.state.currentPlayer)).toBe(true);
    expect(practice.currentController(resolution.state.currentPlayer)).toBe(practice.human);
  });
});