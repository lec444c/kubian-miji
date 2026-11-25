import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { createRackedSimulation, createRack } from '../../src/sim/rack';
import {
  BALL_RADIUS,
  FIXED_DT,
  POCKETS,
  TABLE_HALF_X,
  TABLE_HALF_Y,
  createBall,
  type SimulationState,
} from '../../src/sim/SimulationState';

function simulationWith(...balls: ReturnType<typeof createBall>[]): Simulation {
  const state: SimulationState = { balls, step: 0, braking: [] };
  return new Simulation(state);
}

describe('Simulation fixed-step movement', () => {
  it('strikes in the requested direction and advances exactly 1/512 s', () => {
    const sim = simulationWith(createBall(0, { x: 0, y: 0 }));
    const outcome = sim.strike(Math.PI / 2, 0.5);
    expect(sim.isMoving()).toBe(true);
    expect(outcome.shotId).toBe(1);
    sim.step();
    expect(sim.state.step).toBe(1);
    expect(sim.state.balls[0]!.position.x).toBeCloseTo(0, 10);
    expect(sim.state.balls[0]!.position.y).toBeCloseTo(5 * FIXED_DT, 5);
    expect(() => sim.strike(0, 1)).toThrow(/moving/);
  });

  it('friction stops balls without reversing them', () => {
    const sim = simulationWith(createBall(0, { x: 0, y: 0 }));
    sim.strike(0, 0.1);
    const steps = sim.runUntilStopped();
    expect(steps).toBeGreaterThan(1);
    expect(sim.allStopped()).toBe(true);
    expect(sim.state.balls[0]!.velocity.x).toBe(0);
    expect(sim.state.balls[0]!.position.x).toBeGreaterThan(0);
    expect(sim.currentOutcome?.endedStep).toBe(sim.state.step);
  });

  it.each([-1, 1])('keeps follow/draw shots moving and eventually stops them (spin %i)', spinY => {
    const sim = simulationWith(createBall(0, { x: 0, y: 0 }));
    sim.strike(0, 0.15, { x: 0.25, y: spinY });
    sim.step();
    expect(sim.state.balls[0]!.position.x).toBeGreaterThan(0);
    expect(sim.isMoving()).toBe(true);
    sim.runUntilStopped();
    expect(sim.allStopped()).toBe(true);
    expect(sim.state.balls[0]!.motion).toBe('stationary');
  });

  it('snapshots are independent and restore positions, effects and step', () => {
    const sim = simulationWith(createBall(0, { x: 0, y: 0 }));
    sim.applyBrakingEffect({ id: 'fan', ballId: 0, deceleration: 2, remainingSteps: 10 });
    const snapshot = sim.getSnapshot();
    sim.strike(0, 0.5);
    sim.step();
    snapshot.balls[0]!.position.x = 99;
    expect(sim.state.balls[0]!.position.x).not.toBe(99);
    sim.restoreSnapshot(snapshot);
    expect(sim.state).toEqual(snapshot);
    expect(sim.currentOutcome).toBeNull();
    expect(sim.allStopped()).toBe(true);
  });
});

describe('collisions, cushions and pockets', () => {
  it('transfers momentum and records the cue first contact', () => {
    const sim = simulationWith(
      createBall(0, { x: -0.2, y: 0 }),
      createBall(1, { x: 0, y: 0 }),
    );
    sim.strike(0, 0.3);
    sim.runUntilStopped(100);
    expect(sim.currentOutcome?.firstContact).toBe(1);
    expect(sim.state.balls[1]!.position.x).toBeGreaterThan(0.05);
    expect(sim.state.balls[0]!.position.x).toBeLessThan(sim.state.balls[1]!.position.x);
  });

  it('does not count a cushion before first contact as a post-contact cushion', () => {
    const sim = simulationWith(
      createBall(0, { x: 0.5, y: TABLE_HALF_Y - 0.04 }),
      createBall(1, { x: -0.6, y: 0 }),
    );
    sim.strike(Math.PI / 2, 0.1);
    sim.runUntilStopped(200);
    expect(sim.currentOutcome?.firstContact).toBeNull();
    expect(sim.currentOutcome?.cushionContacts).toContain(0);
    expect(sim.currentOutcome?.cushionAfterContact).toBe(false);
  });

  it('records an object-ball cushion after first contact', () => {
    const sim = simulationWith(
      createBall(0, { x: -0.2, y: 0 }),
      createBall(1, { x: 0, y: 0 }),
    );
    sim.strike(0, 0.5);
    sim.runUntilStopped(1000);
    expect(sim.currentOutcome?.firstContact).toBe(1);
    expect(sim.currentOutcome?.cushionContacts).toContain(1);
    expect(sim.currentOutcome?.cushionAfterContact).toBe(true);
  });

  it('captures pocket order and cue scratches', () => {
    const pocket = POCKETS[1]!;
    const sim = simulationWith(
      createBall(0, { x: pocket.position.x, y: pocket.position.y + 0.12 }),
      createBall(1, { x: 0.5, y: 0 }),
    );
    sim.strike(-Math.PI / 2, 0.1);
    sim.runUntilStopped(100);
    expect(sim.currentOutcome?.cueScratch).toBe(true);
    expect(sim.currentOutcome?.pocketed).toEqual([{ ballId: 0, pocketId: 1, step: expect.any(Number) }]);
    expect(sim.state.balls[0]?.pocketed).toBe(true);
    expect(sim.allStopped()).toBe(true);
  });

  it('keeps simultaneous pocket events in chronological order', () => {
    const sim = simulationWith(
      createBall(0, { x: 0, y: -0.52 }),
      createBall(1, { x: 0, y: 0.52 }),
    );
    sim.strike(-Math.PI / 2, 0.2);
    sim.state.balls[1]!.velocity.y = 2.4;
    sim.state.balls[1]!.motion = 'rolling';
    sim.runUntilStopped(200);
    expect(sim.currentOutcome?.pocketed.map(ball => ball.ballId)).toEqual([1, 0]);
    expect(sim.currentOutcome!.pocketed[0]!.step).toBeLessThan(sim.currentOutcome!.pocketed[1]!.step);
  });

  it('reflects from the real middle-pocket horn instead of capturing or flying off', () => {
    const sim = simulationWith(createBall(0, { x: 0.08, y: 0.5 }));
    sim.strike(Math.PI / 2, 0.1);
    sim.runUntilStopped(2000);
    expect(sim.currentOutcome?.cushionContacts).toContain(0);
    expect(sim.state.balls[0]).toMatchObject({ onTable: true, pocketed: false });
    expect(sim.currentOutcome?.flewOffTable).toEqual([]);
  });

  it('reflects from the corner short-rail jaw without clipping into it', () => {
    const sim = simulationWith(createBall(0, { x: 1.18, y: 0.4 }));
    sim.strike(Math.atan2(0.15, 0.07), 0.1);
    sim.runUntilStopped(2000);
    expect(sim.currentOutcome?.cushionContacts).toContain(0);
    expect(sim.state.balls[0]).toMatchObject({ onTable: true, pocketed: false });
    expect(sim.currentOutcome?.flewOffTable).toEqual([]);
  });

  it('keeps the middle-pocket mouth open for a clean capture', () => {
    const sim = simulationWith(createBall(0, { x: 0, y: 0.5 }));
    sim.strike(Math.PI / 2, 0.06);
    sim.runUntilStopped(1000);
    expect(sim.currentOutcome?.pocketed).toEqual([{ ballId: 0, pocketId: 4, step: expect.any(Number) }]);
    expect(sim.state.balls[0]).toMatchObject({ onTable: false, pocketed: true });
  });

  it('bounces from an ordinary cushion rather than flying off', () => {
    const sim = simulationWith(createBall(0, { x: 0.5, y: 0 }));
    // Round 12 cloth (0.7 m/s^2) lets a 0.3-power tap reach the rail with room
    // to spare, so the rebound is exercised at 0.3 power.
    sim.strike(0, 0.3);
    for (let i = 0; i < 500; i += 1) sim.step();
    expect(sim.currentOutcome?.cushionContacts).toContain(0);
    expect(sim.state.balls[0]!.velocity.x).toBeLessThan(0);
    expect(sim.currentOutcome?.flewOffTable).toEqual([]);
  });

  it('captures a ball that reaches the corner-pocket throat instead of rattling out (round 7)', () => {
    // Centre sits just inside the corner mouth, between the knuckles, where the
    // old circle-only capture missed and resolveJaws pushed the ball back out.
    const sim = simulationWith(createBall(0, { x: 1.18, y: 0.61 }));
    sim.strike(Math.atan2(0.635 - 0.61, 1.27 - 1.18), 0.2);
    sim.runUntilStopped(200);
    expect(sim.state.balls[0]).toMatchObject({ onTable: false, pocketed: true });
    expect(sim.currentOutcome?.pocketed.map(ball => ball.pocketId)).toContain(5);
    expect(sim.currentOutcome?.flewOffTable).toEqual([]);
  });

  it('decelerates a rolling ball at cloth friction (~0.7 m/s^2, round 12)', () => {
    const sim = simulationWith(createBall(0, { x: -0.5, y: 0 }));
    sim.state.balls[0]!.velocity = { x: 1, y: 0 };
    sim.state.balls[0]!.motion = 'rolling';
    for (let i = 0; i < 256; i += 1) sim.step();
    const speed = Math.hypot(sim.state.balls[0]!.velocity.x, sim.state.balls[0]!.velocity.y);
    // v = 1 - 0.7×(256/512) = 0.65 m/s。
    expect(speed).toBeGreaterThan(0.6);
    expect(speed).toBeLessThan(0.7);
  });
});

describe('round 8 spin: contact point drives real roll, draw and english', () => {
  /** Cue 30 cm behind an object ball on the +x axis, straight full-ball hit.
   *  Power 0.3 keeps the strike at exactly 3 m/s after the round-13 max-speed
   *  raise (9 -> 10): at higher speeds the object ball rebounds off rails and
   *  returns into the cue, which is correct physics but invalidates the
   *  final-position assertions below. */
  function contactSetup(): Simulation {
    return simulationWith(createBall(0, { x: -0.3, y: 0 }), createBall(1, { x: 0, y: 0 }));
  }

  it('low tip (draw) pulls the cue ball back after contact', () => {
    const sim = contactSetup();
    sim.strike(0, 0.3, { x: 0, y: -1 });
    sim.runUntilStopped(4000);
    expect(sim.currentOutcome?.firstContact).toBe(1);
    expect(sim.state.balls[1]!.position.x).toBeGreaterThan(0.1);
    // Contact happens at x = -2R; genuine backspin must return the cue past it.
    expect(sim.state.balls[0]!.position.x).toBeLessThan(-0.1);
    expect(sim.allStopped()).toBe(true);
  });

  it('high tip (follow) drives the cue ball through the object ball', () => {
    const sim = contactSetup();
    sim.strike(0, 0.3, { x: 0, y: 1 });
    sim.runUntilStopped(4000);
    expect(sim.currentOutcome?.firstContact).toBe(1);
    expect(sim.state.balls[0]!.position.x).toBeGreaterThan(0.05);
  });

  it('half-low tip stuns: the cue ball stays at the contact point', () => {
    const sim = contactSetup();
    sim.strike(0, 0.3, { x: 0, y: -0.5 });
    sim.runUntilStopped(4000);
    const cueX = sim.state.balls[0]!.position.x;
    expect(cueX).toBeGreaterThan(-0.14);
    expect(cueX).toBeLessThan(0);
  });

  it('centre tip rolls without slip, so no spin is invented', () => {
    const sim = simulationWith(createBall(0, { x: -0.5, y: 0 }));
    sim.strike(0, 0.4);
    const cue = sim.state.balls[0]!;
    expect(cue.motion).toBe('rolling');
    expect(cue.angularVelocity.y).toBeCloseTo(cue.velocity.x / BALL_RADIUS, 6);
    expect(cue.angularVelocity.z).toBeCloseTo(0, 12);
  });

  it('side spin scales with shot speed (off-centre tip torque)', () => {
    const soft = simulationWith(createBall(0, { x: -0.9, y: 0 }));
    soft.strike(0, 0.2, { x: 1, y: 0 });
    const hard = simulationWith(createBall(0, { x: -0.9, y: 0 }));
    hard.strike(0, 0.8, { x: 1, y: 0 });
    const softSpin = Math.abs(soft.state.balls[0]!.angularVelocity.z);
    const hardSpin = Math.abs(hard.state.balls[0]!.angularVelocity.z);
    expect(softSpin).toBeGreaterThan(1);
    expect(hardSpin / softSpin).toBeCloseTo(4, 1);
  });

  it('rail english: side spin kicks the rebound sideways, a centre hit does not', () => {
    const rebound = (spinX: number): { x: number; y: number } => {
      const sim = simulationWith(createBall(0, { x: 0.5, y: 0 }));
      sim.strike(0, 0.3, { x: spinX, y: 0 });
      for (let i = 0; i < 900; i += 1) {
        sim.step();
        if (sim.currentOutcome?.cushionContacts.includes(0)) break;
      }
      const velocity = sim.state.balls[0]!.velocity;
      return { x: velocity.x, y: velocity.y };
    };
    const plain = rebound(0);
    const english = rebound(1);
    expect(plain.x).toBeLessThan(0);
    expect(Math.abs(plain.y)).toBeLessThan(1e-9);
    expect(english.x).toBeLessThan(0);
    expect(english.y).toBeGreaterThan(0.05);
    // The tangential kick is capped by the normal impulse: no energy is created.
    expect(Math.hypot(english.x, english.y)).toBeLessThan(Math.abs(plain.x) * 1.35);
  });

  it('opposite side spin kicks the rebound the opposite way', () => {
    const sim = simulationWith(createBall(0, { x: 0.5, y: 0 }));
    sim.strike(0, 0.3, { x: -1, y: 0 });
    for (let i = 0; i < 900; i += 1) {
      sim.step();
      if (sim.currentOutcome?.cushionContacts.includes(0)) break;
    }
    expect(sim.state.balls[0]!.velocity.y).toBeLessThan(-0.05);
  });

  it('sliding side spin swerves gently instead of massé-ing', () => {
    const sim = simulationWith(createBall(0, { x: -1, y: 0 }));
    // Soft enough to stop well before any rail, so the drift measured here is
    // cloth swerve only and not the (much larger) rail english kick. Power
    // 0.225 keeps the round-12 launch speed 2.25 m/s at MAX_SHOT_SPEED 10.
    sim.strike(0, 0.225, { x: 1, y: -1 });
    sim.runUntilStopped(4000);
    expect(sim.currentOutcome?.cushionContacts).toEqual([]);
    const drift = Math.abs(sim.state.balls[0]!.position.y);
    expect(drift).toBeGreaterThan(0.0005);
    expect(drift).toBeLessThan(0.05);
  });

  it('keeps a spin-only ball alive so draw can re-accelerate it', () => {
    const sim = simulationWith(createBall(0, { x: 0, y: 0 }));
    const cue = sim.state.balls[0]!;
    cue.velocity = { x: 0, y: 0 };
    cue.angularVelocity = { x: 0, y: -40, z: 0 };
    cue.motion = 'sliding';
    expect(sim.isMoving()).toBe(true);
    sim.step();
    expect(cue.velocity.x).toBeLessThan(0);
    sim.runUntilStopped(4000);
    expect(sim.allStopped()).toBe(true);
    expect(cue.position.x).toBeLessThan(0);
  });

  it('clamps an out-of-face contact point to the miscue limit', () => {
    const sim = simulationWith(createBall(0, { x: -0.9, y: 0 }));
    sim.strike(0, 0.5, { x: 4, y: -4 });
    const cue = sim.state.balls[0]!;
    const speed = Math.hypot(cue.velocity.x, cue.velocity.y);
    expect(Math.abs(cue.angularVelocity.z)).toBeLessThanOrEqual(1.25 * speed / BALL_RADIUS + 1e-9);
    expect(sim.runUntilStopped(4000)).toBeGreaterThan(0);
    expect(sim.allStopped()).toBe(true);
  });

  it('full-power break drives at least four object balls to cushions at friction 0.7', () => {
    // Pins the friction/rule interaction: a maximum-charge break must remain a
    // legal Chinese-eight break, otherwise every match would start with a foul.
    const sim = createRackedSimulation(1);
    sim.strike(0, 1);
    sim.runUntilStopped(60_000);
    const outcome = sim.currentOutcome!;
    const objectCushions = new Set(outcome.cushionContacts.filter(id => id !== 0));
    expect(objectCushions.size).toBeGreaterThanOrEqual(4);
    expect(outcome.cueScratch).toBe(false);
    expect(sim.allStopped()).toBe(true);
  });
});

describe('braking effects', () => {
  it('only reduces speed and is idempotent by effect id', () => {
    const sim = simulationWith(createBall(0, { x: 0, y: 0 }));
    sim.strike(0, 0.5);
    const before = Math.hypot(sim.state.balls[0]!.velocity.x, sim.state.balls[0]!.velocity.y);
    sim.applyBrakingEffect({ id: 'fan-1', ballId: 0, deceleration: 30, remainingSteps: 2 });
    sim.applyBrakingEffect({ id: 'fan-1', ballId: 0, deceleration: 30, remainingSteps: 2 });
    sim.step();
    const after = Math.hypot(sim.state.balls[0]!.velocity.x, sim.state.balls[0]!.velocity.y);
    expect(after).toBeLessThan(before);
    expect(sim.state.braking).toHaveLength(1);
    expect(sim.state.balls[0]!.velocity.x).toBeGreaterThanOrEqual(0);
  });

  it('clamps extreme deceleration at rest instead of reversing', () => {
    const sim = simulationWith(createBall(0, { x: 0, y: 0 }));
    sim.strike(0, 0.05);
    sim.applyBrakingEffect({ id: 'wall-of-air', ballId: 0, deceleration: 100000, remainingSteps: 1 });
    sim.step();
    expect(sim.state.balls[0]!.velocity).toEqual({ x: 0, y: 0 });
    expect(sim.state.braking).toHaveLength(0);
    expect(sim.allStopped()).toBe(true);
  });

  it('clears a braking effect as soon as its target is pocketed', () => {
    const pocket = POCKETS[0]!;
    const sim = simulationWith(createBall(0, { x: pocket.position.x, y: pocket.position.y + 0.04 }));
    sim.strike(-Math.PI / 2, 0.1);
    sim.applyBrakingEffect({ id: 'fan', ballId: 0, deceleration: 0.01, remainingSteps: 600 });
    sim.step();
    expect(sim.state.balls[0]!.pocketed).toBe(true);
    expect(sim.state.braking).toHaveLength(0);
  });
});

describe('standard rack', () => {
  it('contains sixteen unique balls with the eight in the centre and non-overlap', () => {
    const balls = createRack(42);
    expect(balls.map(ball => ball.id)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    const eight = balls.find(ball => ball.id === 8)!;
    const apex = balls.find(ball => ball.id === 1)!;
    expect(eight.position.x).toBeCloseTo(apex.position.x + Math.sqrt(3) * (BALL_RADIUS * 2 + 0.0004), 8);
    expect(Math.abs(eight.position.y)).toBeLessThan(1e-10);
    for (let i = 1; i < balls.length; i += 1) {
      for (let j = i + 1; j < balls.length; j += 1) {
        const a = balls[i]!;
        const b = balls[j]!;
        expect(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y)).toBeGreaterThanOrEqual(BALL_RADIUS * 2);
      }
    }
  });

  it('is deterministic by seed and returns independent simulations', () => {
    const a = createRackedSimulation(123);
    const b = createRackedSimulation(123);
    expect(a.state).toEqual(b.state);
    a.state.balls[1]!.position.y += 0.1;
    expect(b.state.balls[1]!.position.y).not.toBe(a.state.balls[1]!.position.y);
    expect(createRack(1).map(ball => ball.position)).not.toEqual(createRack(2).map(ball => ball.position));
  });

  it('places the cue ball on the head spot', () => {
    const sim = createRackedSimulation();
    expect(sim.state.balls[0]!.position.x).toBe(-TABLE_HALF_X / 2);
    expect(sim.state.balls[0]!.position.y).toBe(0);
  });
});
