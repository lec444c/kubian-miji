/** Next-shot creative skill modifiers. Neutral values keep ordinary shots unchanged. */
export interface ShotEnhancements {
  sideSpinMultiplier: number;
  pocketRadiusBonus: number;
  pierceNextShot: boolean;
}

export const ENHANCED_ENGLISH_MULTIPLIER = 1.5;
export const LUCKY_POCKET_RADIUS_BONUS = 0.02;

export function neutralShotEnhancements(): ShotEnhancements {
  return { sideSpinMultiplier: 1, pocketRadiusBonus: 0, pierceNextShot: false };
}
