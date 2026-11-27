import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { createBall, type SimulationState } from '../../src/sim/SimulationState';

function simulationWith(...balls: ReturnType<typeof createBall>[]): Simulation {
  const state: SimulationState = { balls, step: 0, braking: [] };
  return new Simulation(state);
}

describe('pierce shot', () => {
  it('passes through the first ball without moving it, then collides normally with the next ball', () => {
    const sim = simulationWith(
      createBall(0, { x: -0.3, y: 0 }),
      createBall(1, { x: 0, y: 0 }),
      createBall(2, { x: 0.3, y: 0 }),
    );

    sim.strike(0, 0.15, { x: 0, y: 0 }, { pierceFirstContact: true });
    sim.runUntilStopped(2000);

    expect(sim.currentOutcome?.firstContact).toBe(1);
    expect(sim.state.balls[1]!.position.x).toBeCloseTo(0, 10);
    expect(sim.state.balls[1]!.velocity.x).toBe(0);
    expect(sim.state.balls[2]!.position.x).toBeGreaterThan(0.4);
    expect(sim.state.balls[0]!.position.x).toBeLessThan(sim.state.balls[2]!.position.x);
  });

  it('restores normal collisions with the pierced ball after they separate', () => {
    const sim = simulationWith(
      createBall(0, { x: -0.3, y: 0 }),
      createBall(1, { x: 0, y: 0 }),
    );

    sim.strike(0, 0.3, { x: 0, y: 0 }, { pierceFirstContact: true });
    sim.runUntilStopped(4000);

    expect(sim.currentOutcome?.firstContact).toBe(1);
    expect(sim.state.balls[1]!.position.x).toBeLessThan(-0.05);
  });

  it('records the first contact even when it is not a legal rules target', () => {
    const sim = simulationWith(
      createBall(0, { x: -0.2, y: 0 }),
      createBall(8, { x: 0, y: 0 }),
    );

    sim.strike(0, 0.1, { x: 0, y: 0 }, { pierceFirstContact: true });
    sim.runUntilStopped(1000);

    expect(sim.currentOutcome?.firstContact).toBe(8);
    expect(sim.state.balls.find(ball => ball.id === 8)!.position.x).toBeCloseTo(0, 10);
    expect(sim.state.balls.find(ball => ball.id === 0)!.position.x).toBeGreaterThan(0);
  });

  it('leaves ordinary collision behavior unchanged when the modifier is absent', () => {
    const sim = simulationWith(
      createBall(0, { x: -0.2, y: 0 }),
      createBall(1, { x: 0, y: 0 }),
    );

    sim.strike(0, 0.15);
    sim.runUntilStopped(1000);

    expect(sim.currentOutcome?.firstContact).toBe(1);
    expect(sim.state.balls[1]!.position.x).toBeGreaterThan(0.05);
  });
});
