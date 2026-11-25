import { describe, expect, it, vi } from 'vitest';
import { AiController } from '../../src/ai/AiController';
import type { AiScheduler } from '../../src/ai/AiController';
import type { ShotCommand } from '../../src/ai/shotPlanner';
import { SeededRng } from '../../src/core/random/SeededRng';
import { createInitialRuleState } from '../../src/rules/ruleTypes';
import { createBall } from '../../src/sim/SimulationState';

const shot: ShotCommand = {
  angle: 0.2,
  power: 0.5,
  spin: { x: 0, y: 0 },
  targetBallId: 1,
  pocketId: 2,
};

const context = {
  state: createInitialRuleState(),
  simulation: {
    balls: [createBall(0, { x: -0.5, y: 0 }), createBall(1, { x: 0, y: 0 })],
    step: 0,
    braking: [],
  },
};

describe('AiController', () => {
  it('supports injected planning and scheduling without DOM dependencies', () => {
    const callbacks: Array<() => void> = [];
    const scheduler: AiScheduler = {
      schedule: callback => {
        callbacks.push(callback);
        return callbacks.length - 1;
      },
      cancel: vi.fn(),
    };
    const planner = vi.fn(() => shot);
    const onShot = vi.fn();
    const controller = new AiController({
      difficulty: 'normal',
      rng: new SeededRng(1),
      planner,
      scheduler,
      thinkDelayMs: 25,
    });

    controller.scheduleShot(context, onShot);
    expect(controller.hasPendingShot).toBe(true);
    expect(onShot).not.toHaveBeenCalled();
    callbacks[0]!();

    expect(planner).toHaveBeenCalledWith(context, expect.any(SeededRng), 'normal');
    expect(onShot).toHaveBeenCalledWith(shot);
    expect(controller.hasPendingShot).toBe(false);
  });

  it('cancels a superseded scheduled shot', () => {
    const cancel = vi.fn();
    const scheduler: AiScheduler = {
      schedule: () => ({}),
      cancel,
    };
    const controller = new AiController({
      difficulty: 'easy',
      rng: new SeededRng(1),
      planner: () => shot,
      scheduler,
    });

    controller.scheduleShot(context, vi.fn());
    controller.scheduleShot(context, vi.fn());
    expect(cancel).toHaveBeenCalledTimes(1);
    controller.cancelScheduledShot();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(controller.hasPendingShot).toBe(false);
  });
});
