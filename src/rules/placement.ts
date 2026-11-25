import { BALL_RADIUS, CUSHION_HALF_X, CUSHION_HALF_Y, type Vec2 } from '../sim/SimulationState';

/** Keyboard ball-in-hand nudging: one press moves 2 cm, Alt quarters it. */
export const PLACEMENT_STEP = 0.02;
export const PLACEMENT_FINE_STEP = 0.004;

/** Keep a placement cursor inside the cushion-nose playfield (ball centre). */
export function clampPlacement(position: Vec2): Vec2 {
  const halfX = CUSHION_HALF_X - BALL_RADIUS;
  const halfY = CUSHION_HALF_Y - BALL_RADIUS;
  return {
    x: Math.min(halfX, Math.max(-halfX, position.x)),
    y: Math.min(halfY, Math.max(-halfY, position.y)),
  };
}

export function stepPlacement(position: Vec2, dx: number, dy: number, fine: boolean): Vec2 {
  const step = fine ? PLACEMENT_FINE_STEP : PLACEMENT_STEP;
  return clampPlacement({ x: position.x + dx * step, y: position.y + dy * step });
}

/** Head string: the break may only be taken from behind this line (kitchen). */
export const HEAD_STRING_X = -CUSHION_HALF_X / 2;

/** Break placement stays inside the kitchen: cushion noses and the head string. */
export function clampBreakPlacement(position: Vec2): Vec2 {
  const clamped = clampPlacement(position);
  return { x: Math.min(HEAD_STRING_X, clamped.x), y: clamped.y };
}

export function stepBreakPlacement(position: Vec2, dx: number, dy: number, fine: boolean): Vec2 {
  const step = fine ? PLACEMENT_FINE_STEP : PLACEMENT_STEP;
  return clampBreakPlacement({ x: position.x + dx * step, y: position.y + dy * step });
}