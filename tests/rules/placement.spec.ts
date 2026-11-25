import { describe, expect, it } from 'vitest';
import { BALL_RADIUS, CUSHION_HALF_X, CUSHION_HALF_Y } from '../../src/sim/SimulationState';
import { PLACEMENT_FINE_STEP, PLACEMENT_STEP, clampPlacement, stepPlacement } from '../../src/rules/placement';

describe('自由球键盘摆放', () => {
  it('光标被限制在库边 playable 区域内', () => {
    const clamped = clampPlacement({ x: 9, y: -9 });
    expect(clamped.x).toBeCloseTo(CUSHION_HALF_X - BALL_RADIUS, 10);
    expect(clamped.y).toBeCloseTo(-(CUSHION_HALF_Y - BALL_RADIUS), 10);
    const inside = clampPlacement({ x: 0.2, y: -0.1 });
    expect(inside).toEqual({ x: 0.2, y: -0.1 });
  });

  it('WASD 步进 2 cm，Alt 微调 4 mm，且越界后仍合法', () => {
    const moved = stepPlacement({ x: 0, y: 0 }, 1, -1, false);
    expect(moved.x).toBeCloseTo(PLACEMENT_STEP, 10);
    expect(moved.y).toBeCloseTo(-PLACEMENT_STEP, 10);
    const fine = stepPlacement({ x: 0, y: 0 }, 1, 0, true);
    expect(fine.x).toBeCloseTo(PLACEMENT_FINE_STEP, 10);
    const edge = stepPlacement({ x: CUSHION_HALF_X, y: 0 }, 1, 0, false);
    expect(edge.x).toBeCloseTo(CUSHION_HALF_X - BALL_RADIUS, 10);
  });

  it('步进是纯函数：相同输入得到相同输出，不修改入参', () => {
    const origin = { x: 0.3, y: 0.2 };
    const a = stepPlacement(origin, -1, 1, false);
    const b = stepPlacement(origin, -1, 1, false);
    expect(a).toEqual(b);
    expect(origin).toEqual({ x: 0.3, y: 0.2 });
  });
});