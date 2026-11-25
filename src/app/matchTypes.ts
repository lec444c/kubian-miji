export type Seat = 0 | 1;
export type MatchMode = 'classic' | 'creative';
export type PlayMode = 'solo' | 'practice';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type BallGroup = 'solids' | 'stripes';
export type GamePhase = 'menu' | 'draft' | 'aiming' | 'breakPlacement' | 'ballInHand' | 'rolling' | 'skillTargeting' | 'gameOver';

export interface MatchSetup {
  mode: MatchMode;
  playMode: PlayMode;
  difficulty: Difficulty;
  seed?: number;
}

export const otherSeat = (seat: Seat): Seat => seat === 0 ? 1 : 0;
export const seatName = (seat: Seat): string => seat === 0 ? '甲方' : '乙方';
export const groupOfBall = (ballId: number): BallGroup | 'eight' | 'cue' => {
  if (ballId === 0) return 'cue';
  if (ballId === 8) return 'eight';
  return ballId < 8 ? 'solids' : 'stripes';
};
