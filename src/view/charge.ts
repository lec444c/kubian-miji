// Round 13 (0.04 -> 0.02): the user asked to widen the shot-power range again —
// an even softer minimum. At MAX_SHOT_SPEED 10 this floors the lightest tap at
// 0.2 m/s (was 0.36). The charge curve stays linear from MIN to MAX, so hold
// time, drag distance and the slider all distribute power evenly across the
// full 0.2-10 m/s range.
export const MIN_SHOT_POWER = 0.02;
export const MAX_SHOT_POWER = 1;
export const CHARGE_DURATION_SECONDS = 1.35;

/** Deterministic, clamped hold-to-charge curve shared by input and tests. */
export function chargePower(elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds)) return MIN_SHOT_POWER;
  const progress = Math.min(1, Math.max(0, elapsedSeconds) / CHARGE_DURATION_SECONDS);
  return MIN_SHOT_POWER + (MAX_SHOT_POWER - MIN_SHOT_POWER) * progress;
}
