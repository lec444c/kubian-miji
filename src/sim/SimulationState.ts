export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

export const BALL_RADIUS = 0.0315;
export const TABLE_HALF_X = 1.27;
export const TABLE_HALF_Y = 0.635;
// Cushion nose faces measured from the reference p8.gltf after cloth alignment.
// The playable field is bounded by these noses; TABLE_HALF_* is the cloth edge
// (pockets sit in the throat just beyond the noses). Using the cloth edge for
// rail contact let balls penetrate the visible cushions by ~5.6 cm.
export const CUSHION_HALF_X = 1.2122;
export const CUSHION_HALF_Y = 0.5794;
// Slightly wider than the reference 0.073 so near-mouth rattles drop instead of
// bouncing out; jaw/knuckle geometry derives from this value automatically.
export const POCKET_RADIUS = 0.077;
export const FIXED_DT = 1 / 512;

export type BallMotion = 'stationary' | 'sliding' | 'rolling' | 'pocketed';

export interface BallState {
  id: number;
  position: Vec2;
  velocity: Vec2;
  angularVelocity: Vec3;
  motion: BallMotion;
  onTable: boolean;
  pocketed: boolean;
}

export interface BrakingEffect {
  id: string;
  ballId: number;
  remainingSteps: number;
  deceleration: number;
}

export interface SimulationState {
  balls: BallState[];
  step: number;
  braking: BrakingEffect[];
}

export interface PocketDefinition { id: number; position: Vec2 }

export const POCKETS: PocketDefinition[] = [
  { id: 0, position: { x: -TABLE_HALF_X, y: -TABLE_HALF_Y } },
  { id: 1, position: { x: 0, y: -TABLE_HALF_Y } },
  { id: 2, position: { x: TABLE_HALF_X, y: -TABLE_HALF_Y } },
  { id: 3, position: { x: -TABLE_HALF_X, y: TABLE_HALF_Y } },
  { id: 4, position: { x: 0, y: TABLE_HALF_Y } },
  { id: 5, position: { x: TABLE_HALF_X, y: TABLE_HALF_Y } },
];

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, n: number): Vec2 => ({ x: a.x * n, y: a.y * n });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const normalize = (a: Vec2): Vec2 => {
  const l = length(a);
  return l > 1e-10 ? scale(a, 1 / l) : v2();
};
export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));
export const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

export function createBall(id: number, position: Vec2): BallState {
  return { id, position, velocity: v2(), angularVelocity: { x: 0, y: 0, z: 0 }, motion: 'stationary', onTable: true, pocketed: false };
}

export function cloneSimulationState(state: SimulationState): SimulationState {
  return structuredClone(state);
}
