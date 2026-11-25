import {
  BALL_RADIUS,
  CUSHION_HALF_X,
  CUSHION_HALF_Y,
  FIXED_DT,
  POCKET_RADIUS,
  POCKETS,
  TABLE_HALF_X,
  TABLE_HALF_Y,
  cloneSimulationState,
  createBall,
  type BallState,
  type BrakingEffect,
  type PocketDefinition,
  type SimulationState,
  type Vec2,
} from './SimulationState';
import { emptyShotOutcome, type PhysicsEvent, type ShotOutcome } from './ShotOutcome';

// Collision, cushion and pocket algorithms are adapted from
// third_party/tailuge-billiards/src/model/{table.ts,physics/*}. GPLv3 reuse is
// approved; this module deliberately removes the reference's Three.js/view coupling.

// Round 13 (9 -> 10): the user asked to widen the shot-power range again — a
// harder maximum. Full charge now launches at 10 m/s. The minimum is lowered
// separately via MIN_SHOT_POWER (0.02 -> 0.2 m/s), and power maps linearly to
// speed so every 1% slider step is an even 0.1 m/s across the whole range.
export const MAX_SHOT_SPEED = 10;
export const BALL_RESTITUTION = 0.96;
export const CUSHION_RESTITUTION = 0.82;
// Round 12 (0.85 -> 0.7): the user asked for less cloth friction so balls roll
// farther. A 0.88 break (8.8 m/s) still legally scatters the rack on every measured seed
// (breakSweep/breakScatter pins); soft taps now travel noticeably longer.
export const ROLLING_DECELERATION = 0.7;
export const SLIDING_DECELERATION = 9.8 * 0.2;
// Side spin survives several seconds of travel so english still bites at a rail.
export const SPIN_DAMPING = 0.25;
// Fraction of the tangential slip (velocity minus spin surface speed) removed
// by rail friction, capped by the normal impulse so spin never adds energy.
const CUSHION_SPIN_GRIP = 0.45;
// Gentle sliding swerve: side spin curves the path while the ball still slips.
// A flat cue cannot massé, so the drift stays in the centimetre range.
const SWERVE_FACTOR = 0.00015;
// Collision throw: side spin nudges the object ball off the pure normal line.
const THROW_FACTOR = 0.02;
// Tip offset at the miscue limit, in ball radii. Spin torque = 2.5 * offset * v / R,
// so 0.5 radii gives the 1.25 factor used for both side spin and roll spin.
const TIP_OFFSET = 1.25;
export const STOP_SPEED = 0.002;
const COLLISION_PASSES = 5;
const EPSILON = 1e-9;

/** One straight face of a pocket jaw: the ball (centre) stays BALL_RADIUS away
 *  from the segment, like a capsule. Order of the endpoints does not matter. */
interface JawSegment {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  lengthSquared: number;
}

type Outline = ReadonlyArray<readonly [number, number]>;

// Pocket jaws. The table model's cushion ends are cut at 45° and reach much
// further into the pocket mouth than the old round knuckles did, so a ball
// could legally rest 1-2 cm inside the green cushion (visible clipping). These
// outlines are the model's jaw faces at ball-centre height, in table units,
// measured on the (+x, +y) corner pocket and on the +y middle pocket; the
// other pockets are mirror images.
/** Corner pocket: the end of the long-rail (±y) cushion, from its nose inward. */
const CORNER_LONG_RAIL_FACE: Outline = [
  [1.114, 0.5794], [1.124, 0.581], [1.139, 0.594], [1.1662, 0.6208],
  [1.1725, 0.6267], [1.1725, 0.8],
];
/** Corner pocket: the end of the short-rail (±x) cushion plus the pocket rim
 *  wall behind it. */
const CORNER_SHORT_RAIL_FACE: Outline = [
  [1.2122, 0.4834], [1.2165, 0.4981], [1.2287, 0.5096], [1.2419, 0.5252],
  [1.2619, 0.5398], [1.2725, 0.549], [1.2795, 0.564], [1.284, 0.585],
  [1.2845, 0.6], [1.2855, 0.618], [1.2855, 0.8],
];
/** Middle pocket: one cushion end (the +x side of the +y pocket). The tip is
 *  rounded on the model, hence the short first faces. */
const MIDDLE_POCKET_FACE: Outline = [
  [0.1068, 0.5794], [0.095, 0.5794], [0.0921, 0.5819], [0.0732, 0.6084],
  [0.0613, 0.6273], [0.063, 0.64], [0.063, 0.8],
];
/** Where the long rails stop at a pocket (|x|): middle pocket and corner.
 *  The clamp may only end where the jaw tip's capsule takes over at the same
 *  ball-centre line (CUSHION_HALF_Y - BALL_RADIUS). */
const MIDDLE_MOUTH_HALF_WIDTH = 0.1068;
const CORNER_LONG_RAIL_END = 1.126;
/** Where the short rails stop at a corner pocket (|y|). */
const CORNER_SHORT_RAIL_END = 0.4834;
/** Everything past this corner-pocket box is inside the pocket liner. */
const CORNER_BOX_MIN_X = 1.194;
const CORNER_BOX_MIN_Y = 0.628;

function toSegments(outline: Outline, scaleX: number, scaleY: number): JawSegment[] {
  const points = outline.map(([x, y]) => [x * scaleX, y * scaleY] as const);
  const result: JawSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = points[index - 1]!;
    const [bx, by] = points[index]!;
    const dx = bx - ax;
    const dy = by - ay;
    result.push({ ax, ay, dx, dy, lengthSquared: dx * dx + dy * dy });
  }
  return result;
}

interface PocketWalls {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  segments: JawSegment[];
}

const pocketWalls: PocketWalls[] = POCKETS.map(pocket => {
  const endX = Math.sign(pocket.position.x);
  const endY = Math.sign(pocket.position.y);
  const outlines = endX === 0
    ? [toSegments(MIDDLE_POCKET_FACE, 1, endY), toSegments(MIDDLE_POCKET_FACE, -1, endY)]
    : [
      toSegments(CORNER_LONG_RAIL_FACE, endX, endY),
      toSegments(CORNER_SHORT_RAIL_FACE, endX, endY),
    ];
  const xs = outlines.flatMap(outline => outline.flatMap(s => [s.ax, s.ax + s.dx]));
  const ys = outlines.flatMap(outline => outline.flatMap(s => [s.ay, s.ay + s.dy]));
  return {
    minX: Math.min(...xs) - BALL_RADIUS,
    maxX: Math.max(...xs) + BALL_RADIUS,
    minY: Math.min(...ys) - BALL_RADIUS,
    maxY: Math.max(...ys) + BALL_RADIUS,
    segments: outlines.flat(),
  };
});

// Mouth windows match the jaw outlines above: the straight cushions end where
// the jaw faces begin, so no spot in the mouth is left without a collider.
// Mouth windows match the jaw outlines above: the straight cushions end where
// the jaw faces begin, so no spot in the mouth is left without a collider.
function inLongRailMouth(x: number): boolean {
  return Math.abs(x) < MIDDLE_MOUTH_HALF_WIDTH || Math.abs(x) > CORNER_LONG_RAIL_END;
}

function inShortRailMouth(y: number): boolean {
  return Math.abs(y) > CORNER_SHORT_RAIL_END;
}

// Corner pockets: behind the short-rail jaw the pocket liner extends past the
// capture circle. A ball whose centre is in this box is inside the liner.
function inPocketLiner(x: number, y: number, pocket: PocketDefinition): boolean {
  if (pocket.position.x === 0) return false;
  return x * Math.sign(pocket.position.x) >= CORNER_BOX_MIN_X && y * Math.sign(pocket.position.y) >= CORNER_BOX_MIN_Y;
}

function inPocketCapture(x: number, y: number, pocket: PocketDefinition): boolean {
  const dx = x - pocket.position.x;
  const dy = y - pocket.position.y;
  return dx * dx + dy * dy < POCKET_RADIUS * POCKET_RADIUS || inPocketLiner(x, y, pocket);
}

export type BallRestingConflict = 'pocketed' | 'jaw' | 'cushion';

/** What stops a ball whose centre rests at (x, y), or null when the spot is on
 *  the cloth and clear of every cushion and pocket jaw. Shared by the solver
 *  and by the table-fit regression test. */
export function ballRestingConflict(x: number, y: number): BallRestingConflict | null {
  for (const pocket of POCKETS) {
    if (inPocketCapture(x, y, pocket)) return 'pocketed';
  }
  for (const walls of pocketWalls) {
    if (x < walls.minX || x > walls.maxX || y < walls.minY || y > walls.maxY) continue;
    for (const segment of walls.segments) {
      const dx = x - segment.ax;
      const dy = y - segment.ay;
      const t = Math.min(1, Math.max(0, (dx * segment.dx + dy * segment.dy) / segment.lengthSquared));
      const nx = dx - segment.dx * t;
      const ny = dy - segment.dy * t;
      if (nx * nx + ny * ny < BALL_RADIUS * BALL_RADIUS) return 'jaw';
    }
  }
  if (Math.abs(x) > CUSHION_HALF_X - BALL_RADIUS && !inShortRailMouth(y)) return 'cushion';
  if (Math.abs(y) > CUSHION_HALF_Y - BALL_RADIUS && !inLongRailMouth(x)) return 'cushion';
  return null;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function speedOf(ball: BallState): number {
  return Math.hypot(ball.velocity.x, ball.velocity.y);
}

/** Slip between the cloth and the ball surface (roll spin only): zero means
 * natural roll. A ball can be linearly stationary yet still slipping, which is
 * exactly how follow/draw re-accelerates the cue ball after a stun contact. */
function slipSpeedOf(ball: BallState): number {
  return Math.hypot(
    ball.velocity.x - BALL_RADIUS * ball.angularVelocity.y,
    ball.velocity.y + BALL_RADIUS * ball.angularVelocity.x,
  );
}

/** Keep the existing angular velocity after an impulse; only fall back to
 * natural roll when the slip is already gone. Round 8: the old setRolling()
 * here erased follow/draw spin at every contact, so english never showed. */
function refreshMotion(ball: BallState): void {
  const slip = slipSpeedOf(ball);
  if (slip < 0.015) {
    if (speedOf(ball) <= STOP_SPEED) stopBall(ball);
    else setRolling(ball);
    return;
  }
  ball.motion = 'sliding';
}

/** Rail friction turns side spin into a tangential impulse (english). n is the
 * inward rail normal, normalImpulse the rebound speed change along it. The
 * tangential impulse is capped by the normal impulse so spin never adds energy,
 * and the matching torque bleeds away the spin that produced it. */
function applyRailSpin(ball: BallState, nx: number, ny: number, normalImpulse: number): void {
  const tx = -ny;
  const ty = nx;
  const slipTangent = ball.velocity.x * tx + ball.velocity.y * ty - ball.angularVelocity.z * BALL_RADIUS;
  const limit = 0.5 * Math.abs(normalImpulse);
  const impulse = -Math.max(-limit, Math.min(limit, slipTangent)) * CUSHION_SPIN_GRIP;
  ball.velocity.x += tx * impulse;
  ball.velocity.y += ty * impulse;
  ball.angularVelocity.z -= (2.5 * impulse) / BALL_RADIUS;
}

function stopBall(ball: BallState): void {
  ball.velocity.x = 0;
  ball.velocity.y = 0;
  ball.angularVelocity.x = 0;
  ball.angularVelocity.y = 0;
  ball.angularVelocity.z = 0;
  if (ball.onTable) ball.motion = 'stationary';
}

function setRolling(ball: BallState): void {
  const speed = speedOf(ball);
  if (speed <= STOP_SPEED) {
    stopBall(ball);
    return;
  }
  ball.motion = 'rolling';
  ball.angularVelocity.x = -ball.velocity.y / BALL_RADIUS;
  ball.angularVelocity.y = ball.velocity.x / BALL_RADIUS;
}

function reduceSpeed(ball: BallState, amount: number): void {
  const speed = speedOf(ball);
  if (speed <= STOP_SPEED || speed <= amount + STOP_SPEED) {
    stopBall(ball);
    return;
  }
  const nextSpeed = speed - Math.max(0, amount);
  ball.velocity.x *= nextSpeed / speed;
  ball.velocity.y *= nextSpeed / speed;
}

/** Pure-TypeScript deterministic 2D pool simulation. All distances are metres. */
export class Simulation {
  public state: SimulationState;
  public shooter: 0 | 1;
  public currentOutcome: ShotOutcome | null = null;
  /** Optional presentation-only event sink (audio). Null in AI trial sims. */
  public onEvent: ((event: PhysicsEvent) => void) | null = null;

  private nextShotId = 1;
  private shotActive = false;

  public constructor(initialState?: SimulationState, shooter: 0 | 1 = 0) {
    this.state = initialState
      ? cloneSimulationState(initialState)
      : {
          balls: [createBall(0, { x: -TABLE_HALF_X / 2, y: 0 })],
          step: 0,
          braking: [],
        };
    this.shooter = shooter;
  }

  /** Start a shot. Angle is in radians and power is normalized to [0, 1]. */
  public strike(angle: number, power: number, spin: { x: number; y: number } = { x: 0, y: 0 }): ShotOutcome {
    assertFinite(angle, 'angle');
    assertFinite(power, 'power');
    assertFinite(spin.x, 'spin.x');
    assertFinite(spin.y, 'spin.y');
    if (this.isMoving()) throw new Error('Cannot strike while balls are moving');
    if (power < 0) throw new Error('power must be non-negative');

    const cue = this.state.balls.find(ball => ball.id === 0);
    if (!cue || !cue.onTable || cue.pocketed) throw new Error('Cue ball is not available');

    const clampedPower = Math.min(1, power);
    const speed = MAX_SHOT_SPEED * clampedPower;
    cue.velocity.x = Math.cos(angle) * speed;
    cue.velocity.y = Math.sin(angle) * speed;
    // Round 8: spin is a real contact point on the cue ball face, normalized to
    // the miscue limit (half a radius). Side spin therefore scales with shot
    // speed, exactly like the torque of an off-centre tip impulse.
    const side = Math.max(-1, Math.min(1, spin.x));
    cue.angularVelocity.z = -side * TIP_OFFSET * speed / BALL_RADIUS;
    if (speed > STOP_SPEED) {
      // Vertical offset: centre = natural roll, above centre = follow (up to
      // 2x natural roll), -0.5 = genuine stun (no roll spin) and the bottom edge
      // = full draw (-1x natural roll, i.e. real backspin that pulls the cue
      // ball backwards after contact).
      const vertical = Math.max(-1, Math.min(1, spin.y));
      const rollFactor = 1 + vertical * (vertical >= 0 ? 1 : 2);
      cue.angularVelocity.x = (-cue.velocity.y / BALL_RADIUS) * rollFactor;
      cue.angularVelocity.y = (cue.velocity.x / BALL_RADIUS) * rollFactor;
      cue.motion = rollFactor === 1 ? 'rolling' : 'sliding';
    } else {
      stopBall(cue);
    }

    this.currentOutcome = emptyShotOutcome(this.nextShotId++, this.shooter, this.state.step);
    this.shotActive = true;
    if (!this.isMoving()) this.finishShot();
    return this.currentOutcome;
  }

  /** Advance exactly one fixed 1/512 second step. */
  public step(): void {
    this.state.step += 1;
    if (this.currentOutcome && this.shotActive) this.currentOutcome.endedStep = this.state.step;

    this.applyBraking();
    let moved = false;
    for (const ball of this.state.balls) {
      if (!ball.onTable || ball.pocketed) continue;
      // Spin-only motion counts: a stunned cue ball with follow/draw left must
      // keep integrating friction even while its linear speed is near zero.
      if (speedOf(ball) > STOP_SPEED || slipSpeedOf(ball) > 0.015) {
        moved = true;
        this.applyTableFriction(ball);
      }
      if (speedOf(ball) > STOP_SPEED) {
        ball.position.x += ball.velocity.x * FIXED_DT;
        ball.position.y += ball.velocity.y * FIXED_DT;
      } else if (slipSpeedOf(ball) <= 0.015) {
        stopBall(ball);
      }
      ball.angularVelocity.z *= Math.exp(-SPIN_DAMPING * FIXED_DT);
    }
    if (moved && this.currentOutcome && this.shotActive) this.currentOutcome.anyBallMoved = true;

    // Pockets take precedence over a rail at the same position, as in the reference.
    for (const ball of this.state.balls) this.captureAtPocket(ball);

    for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
      let collided = false;
      for (let i = 0; i < this.state.balls.length; i += 1) {
        const a = this.state.balls[i]!;
        if (!a.onTable || a.pocketed) continue;
        for (let j = i + 1; j < this.state.balls.length; j += 1) {
          const b = this.state.balls[j]!;
          if (!b.onTable || b.pocketed) continue;
          if (this.resolveBallCollision(a, b)) collided = true;
        }
      }
      if (!collided) break;
    }

    const cushionsThisStep = new Set<number>();
    for (const ball of this.state.balls) {
      if (!ball.onTable || ball.pocketed) continue;
      this.captureAtPocket(ball);
      if (!ball.onTable || ball.pocketed) continue;
      this.resolveJaws(ball, cushionsThisStep);
      this.resolveCushions(ball, cushionsThisStep);
      this.detectFlight(ball);
    }

    // A target can be captured or leave the table after braking was applied at
    // the start of this step, so prune effects again after all contact events.
    this.clearInactiveBraking();
    if (this.shotActive && this.allStopped()) this.finishShot();
  }

  /** Run until stationary, returning the number of steps actually advanced. */
  public runUntilStopped(maxSteps = 512 * 60): number {
    if (!Number.isInteger(maxSteps) || maxSteps < 0) throw new Error('maxSteps must be a non-negative integer');
    let steps = 0;
    while (this.isMoving() && steps < maxSteps) {
      this.step();
      steps += 1;
    }
    return steps;
  }

  public isMoving(): boolean {
    return this.state.balls.some(ball => ball.onTable && !ball.pocketed &&
      (speedOf(ball) > STOP_SPEED || slipSpeedOf(ball) > 0.015));
  }

  public allStopped(): boolean {
    return !this.isMoving();
  }

  public getSnapshot(): SimulationState {
    return cloneSimulationState(this.state);
  }

  public restoreSnapshot(snapshot: SimulationState): void {
    this.state = cloneSimulationState(snapshot);
    this.currentOutcome = null;
    this.shotActive = false;
  }

  /** Apply (or replace, by id) a finite-speed braking effect. */
  public applyBrakingEffect(effect: BrakingEffect): void {
    if (!effect.id) throw new Error('Braking effect id is required');
    if (!Number.isInteger(effect.ballId)) throw new Error('ballId must be an integer');
    assertFinite(effect.deceleration, 'deceleration');
    if (effect.deceleration < 0) throw new Error('deceleration must be non-negative');
    if (!Number.isInteger(effect.remainingSteps) || effect.remainingSteps < 0) {
      throw new Error('remainingSteps must be a non-negative integer');
    }
    if (!this.state.balls.some(ball => ball.id === effect.ballId)) throw new Error(`Unknown ball ${effect.ballId}`);

    const copy = { ...effect };
    const index = this.state.braking.findIndex(current => current.id === effect.id);
    if (index >= 0) this.state.braking[index] = copy;
    else this.state.braking.push(copy);
  }

  private finishShot(): void {
    for (const ball of this.state.balls) {
      if (ball.onTable && !ball.pocketed && speedOf(ball) <= STOP_SPEED) stopBall(ball);
    }
    if (this.currentOutcome) this.currentOutcome.endedStep = this.state.step;
    this.shotActive = false;
  }

  private applyBraking(): void {
    for (const effect of this.state.braking) {
      const ball = this.state.balls.find(candidate => candidate.id === effect.ballId);
      if (ball && ball.onTable && !ball.pocketed && effect.remainingSteps > 0) {
        // Multiplicative speed scaling guarantees no acceleration or reversal.
        reduceSpeed(ball, effect.deceleration * FIXED_DT);
        if (ball.onTable) refreshMotion(ball);
      }
      effect.remainingSteps = Math.max(0, effect.remainingSteps - 1);
    }
    this.clearInactiveBraking();
  }

  private clearInactiveBraking(): void {
    this.state.braking = this.state.braking.filter(effect => {
      const ball = this.state.balls.find(candidate => candidate.id === effect.ballId);
      return effect.remainingSteps > 0 && !!ball && ball.onTable && !ball.pocketed && speedOf(ball) > STOP_SPEED;
    });
  }

  private applyTableFriction(ball: BallState): void {
    if (ball.motion === 'sliding') {
      const slipX = ball.velocity.x - BALL_RADIUS * ball.angularVelocity.y;
      const slipY = ball.velocity.y + BALL_RADIUS * ball.angularVelocity.x;
      const slipSpeed = Math.hypot(slipX, slipY);
      if (slipSpeed < 0.015) {
        setRolling(ball);
      } else {
        const acceleration = SLIDING_DECELERATION * FIXED_DT;
        const fx = (-slipX / slipSpeed) * acceleration;
        const fy = (-slipY / slipSpeed) * acceleration;
        ball.velocity.x += fx;
        ball.velocity.y += fy;
        // Torque of cloth friction about the contact point r = (0, 0, -R):
        // tau = (R*fy, -R*fx, 0), I = 2/5 m R^2. The x sign matters: with the
        // opposite sign any slip along y diverges and invents energy.
        ball.angularVelocity.y -= (2.5 * fx) / BALL_RADIUS;
        ball.angularVelocity.x += (2.5 * fy) / BALL_RADIUS;
        // Sliding swerve: side spin bends the path while slip remains, fading
        // out once natural roll is reached (a flat cue cannot massé).
        const speed = speedOf(ball);
        if (speed > 0.05 && Math.abs(ball.angularVelocity.z) > 0.5) {
          const perpX = -ball.velocity.y / speed;
          const perpY = ball.velocity.x / speed;
          const swerve = SWERVE_FACTOR * ball.angularVelocity.z * slipSpeed * FIXED_DT;
          ball.velocity.x += perpX * swerve;
          ball.velocity.y += perpY * swerve;
        }
        return;
      }
    }
    reduceSpeed(ball, ROLLING_DECELERATION * FIXED_DT);
    if (speedOf(ball) > STOP_SPEED) setRolling(ball);
  }

  private resolveBallCollision(a: BallState, b: BallState): boolean {
    const dx = b.position.x - a.position.x;
    const dy = b.position.y - a.position.y;
    const minDistance = BALL_RADIUS * 2;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= minDistance * minDistance) return false;
    if (speedOf(a) <= STOP_SPEED && speedOf(b) <= STOP_SPEED && distanceSquared > (minDistance - 1e-7) ** 2) {
      return false;
    }

    let distanceValue = Math.sqrt(distanceSquared);
    let nx: number;
    let ny: number;
    if (distanceValue < EPSILON) {
      const rvx = a.velocity.x - b.velocity.x;
      const rvy = a.velocity.y - b.velocity.y;
      const relativeSpeed = Math.hypot(rvx, rvy);
      nx = relativeSpeed > EPSILON ? rvx / relativeSpeed : 1;
      ny = relativeSpeed > EPSILON ? rvy / relativeSpeed : 0;
      distanceValue = 0;
    } else {
      nx = dx / distanceValue;
      ny = dy / distanceValue;
    }

    const correction = (minDistance - distanceValue + 1e-8) / 2;
    a.position.x -= nx * correction;
    a.position.y -= ny * correction;
    b.position.x += nx * correction;
    b.position.y += ny * correction;

    const relativeNormal = (b.velocity.x - a.velocity.x) * nx + (b.velocity.y - a.velocity.y) * ny;
    if (relativeNormal < 0) {
      const impulse = (-(1 + BALL_RESTITUTION) * relativeNormal) / 2;
      a.velocity.x -= impulse * nx;
      a.velocity.y -= impulse * ny;
      b.velocity.x += impulse * nx;
      b.velocity.y += impulse * ny;
      // Round 8: spin survives the impulse (refreshMotion, not setRolling), so
      // follow/draw re-accelerates the cue ball through cloth friction after
      // contact. Side spin also throws the object ball slightly off the normal.
      const throwSpeed = a.angularVelocity.z * BALL_RADIUS * THROW_FACTOR;
      b.velocity.x += -ny * throwSpeed;
      b.velocity.y += nx * throwSpeed;
      a.velocity.x -= -ny * throwSpeed;
      a.velocity.y -= nx * throwSpeed;
      b.angularVelocity.z += a.angularVelocity.z * 0.15;
      a.angularVelocity.z *= 0.85;
      refreshMotion(a);
      refreshMotion(b);
      this.recordFirstContact(a, b);
      this.onEvent?.({ kind: 'ballHit', strength: Math.min(1, Math.abs(relativeNormal) / MAX_SHOT_SPEED) });
      return true;
    }
    return false;
  }

  private recordFirstContact(a: BallState, b: BallState): void {
    if (!this.currentOutcome || !this.shotActive || this.currentOutcome.firstContact !== null) return;
    if (a.id === 0 && b.id !== 0) this.currentOutcome.firstContact = b.id;
    else if (b.id === 0 && a.id !== 0) this.currentOutcome.firstContact = a.id;
  }

  private captureAtPocket(ball: BallState): void {
    if (!ball.onTable || ball.pocketed) return;
    for (const pocket of POCKETS) {
      if (!inPocketCapture(ball.position.x, ball.position.y, pocket)) continue;
      this.pocketBall(ball, pocket);
      return;
    }
  }

  /** Drop a ball into a pocket: snap to centre, stop, mark pocketed and record. */
  private pocketBall(ball: BallState, pocket: PocketDefinition): void {
    ball.position.x = pocket.position.x;
    ball.position.y = pocket.position.y;
    stopBall(ball);
    ball.onTable = false;
    ball.pocketed = true;
    ball.motion = 'pocketed';
    if (this.currentOutcome && this.shotActive) {
      this.currentOutcome.pocketed.push({ ballId: ball.id, pocketId: pocket.id, step: this.state.step });
      if (ball.id === 0) this.currentOutcome.cueScratch = true;
    }
    this.onEvent?.({ kind: 'pocket', ballId: ball.id });
  }

  private resolveJaws(ball: BallState, recorded: Set<number>): void {
    const x = ball.position.x;
    const y = ball.position.y;
    for (const walls of pocketWalls) {
      if (x < walls.minX || x > walls.maxX || y < walls.minY || y > walls.maxY) continue;
      this.resolveJawSegments(ball, walls.segments, recorded);
    }
  }

  private resolveJawSegments(ball: BallState, segments: JawSegment[], recorded: Set<number>): void {
    for (const segment of segments) {
      const dx = ball.position.x - segment.ax;
      const dy = ball.position.y - segment.ay;
      const t = Math.min(1, Math.max(0, (dx * segment.dx + dy * segment.dy) / segment.lengthSquared));
      // Closest point of the jaw face, and the outward normal from it.
      const nx = dx - segment.dx * t;
      const ny = dy - segment.dy * t;
      const distanceSquared = nx * nx + ny * ny;
      if (distanceSquared >= BALL_RADIUS * BALL_RADIUS) continue;
      const distanceValue = Math.sqrt(distanceSquared);
      const ux = distanceValue > EPSILON ? nx / distanceValue : -Math.sign(ball.position.x || 1);
      const uy = distanceValue > EPSILON ? ny / distanceValue : -Math.sign(ball.position.y || 1);
      const push = BALL_RADIUS / Math.max(distanceValue, EPSILON) - 1;
      ball.position.x += nx * push + ux * 1e-8;
      ball.position.y += ny * push + uy * 1e-8;
      const normalVelocity = ball.velocity.x * ux + ball.velocity.y * uy;
      if (normalVelocity < 0) {
        const normalImpulse = (1 + CUSHION_RESTITUTION) * -normalVelocity;
        ball.velocity.x -= (1 + CUSHION_RESTITUTION) * normalVelocity * ux;
        ball.velocity.y -= (1 + CUSHION_RESTITUTION) * normalVelocity * uy;
        ball.velocity.x *= 0.985;
        ball.velocity.y *= 0.985;
        applyRailSpin(ball, ux, uy, normalImpulse);
        refreshMotion(ball);
        this.recordCushion(ball, recorded);
      }
    }
  }

  private resolveCushions(ball: BallState, recorded: Set<number>): void {
    const minX = -CUSHION_HALF_X + BALL_RADIUS;
    const maxX = CUSHION_HALF_X - BALL_RADIUS;
    const minY = -CUSHION_HALF_Y + BALL_RADIUS;
    const maxY = CUSHION_HALF_Y - BALL_RADIUS;

    if (ball.position.x < minX && ball.velocity.x < 0) {
      if (!inShortRailMouth(ball.position.y)) {
        const normalImpulse = (1 + CUSHION_RESTITUTION) * -ball.velocity.x;
        ball.position.x = minX;
        ball.velocity.x = -ball.velocity.x * CUSHION_RESTITUTION;
        ball.velocity.y *= 0.985;
        applyRailSpin(ball, 1, 0, normalImpulse);
        refreshMotion(ball);
        this.recordCushion(ball, recorded);
      }
    } else if (ball.position.x > maxX && ball.velocity.x > 0) {
      if (!inShortRailMouth(ball.position.y)) {
        const normalImpulse = (1 + CUSHION_RESTITUTION) * ball.velocity.x;
        ball.position.x = maxX;
        ball.velocity.x = -ball.velocity.x * CUSHION_RESTITUTION;
        ball.velocity.y *= 0.985;
        applyRailSpin(ball, -1, 0, normalImpulse);
        refreshMotion(ball);
        this.recordCushion(ball, recorded);
      }
    }

    if (ball.position.y < minY && ball.velocity.y < 0) {
      if (!inLongRailMouth(ball.position.x)) {
        const normalImpulse = (1 + CUSHION_RESTITUTION) * -ball.velocity.y;
        ball.position.y = minY;
        ball.velocity.y = -ball.velocity.y * CUSHION_RESTITUTION;
        ball.velocity.x *= 0.985;
        applyRailSpin(ball, 0, 1, normalImpulse);
        refreshMotion(ball);
        this.recordCushion(ball, recorded);
      }
    } else if (ball.position.y > maxY && ball.velocity.y > 0) {
      if (!inLongRailMouth(ball.position.x)) {
        const normalImpulse = (1 + CUSHION_RESTITUTION) * ball.velocity.y;
        ball.position.y = maxY;
        ball.velocity.y = -ball.velocity.y * CUSHION_RESTITUTION;
        ball.velocity.x *= 0.985;
        applyRailSpin(ball, 0, -1, normalImpulse);
        refreshMotion(ball);
        this.recordCushion(ball, recorded);
      }
    }
  }

  private recordCushion(ball: BallState, recorded: Set<number>): void {
    if (!this.currentOutcome || !this.shotActive || recorded.has(ball.id)) return;
    recorded.add(ball.id);
    this.currentOutcome.cushionContacts.push(ball.id);
    if (this.currentOutcome.firstContact !== null) this.currentOutcome.cushionAfterContact = true;
    this.onEvent?.({ kind: 'cushion', strength: Math.min(1, speedOf(ball) / MAX_SHOT_SPEED) });
  }

  /** Backstop for the pocket mouth: in this 2D model there are no jump shots,
   *  so the only way a ball crosses the cloth edge is through a pocket mouth
   *  (the cushions clamp every other outward crossing). At high speed a ball
   *  can slip the discrete jaw/capture window in the mouth gap; rather
   *  than letting it fly off the table, drop it into the nearest pocket — the
   *  mouth it escaped through. Round 13 (max speed 10 m/s): 0.80-power breaks
   *  flew a ball off on 4/40 rack seeds before this; see breakFlight.spec.ts. */
  private detectFlight(ball: BallState): void {
    if (Math.abs(ball.position.x) <= TABLE_HALF_X + POCKET_RADIUS * 1.2 &&
        Math.abs(ball.position.y) <= TABLE_HALF_Y + POCKET_RADIUS * 1.2) return;
    let nearest = POCKETS[0]!;
    let best = Infinity;
    for (const pocket of POCKETS) {
      const dx = ball.position.x - pocket.position.x;
      const dy = ball.position.y - pocket.position.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < best) { best = distanceSquared; nearest = pocket; }
    }
    this.pocketBall(ball, nearest);
  }
}

export default Simulation;
