import type { BallGroup, Seat } from '../app/matchTypes';
import type { BallState } from '../sim/SimulationState';

export function pocketedBallIds(balls: readonly BallState[]): number[] {
  // Restored balls and off-table (but not pocketed) balls are not in a pocket.
  return balls.filter(ball => ball.pocketed && !ball.onTable).map(ball => ball.id).sort((a, b) => a - b);
}

export function groupBallIds(group: BallGroup): number[] {
  return Array.from({ length: 7 }, (_, index) => index + (group === 'solids' ? 1 : 9));
}

export function groupLabel(group: BallGroup): string {
  return group === 'solids' ? '全色球（1–7号）' : '花色球（9–15号）';
}

export function playerLabel(seat: Seat, solo: boolean): string {
  return solo ? (seat === 0 ? '你（甲方）' : '电脑（乙方）') : (seat === 0 ? '甲方' : '乙方');
}

export function groupAssignmentText(
  before: readonly (BallGroup | null)[], after: readonly (BallGroup | null)[], solo: boolean,
): string | null {
  if (before.some(group => group !== null) || !after[0] || !after[1]) return null;
  return `分球已确定：${playerLabel(0, solo)}击打${groupLabel(after[0])}；${playerLabel(1, solo)}击打${groupLabel(after[1])}。`;
}

export function turnTargetText(seat: Seat, group: BallGroup | null, remaining: number, solo: boolean, isBreak: boolean): string {
  if (isBreak) return '开球阶段 · 开球进球不分组';
  if (!group) return '尚未分球 · 可击打全色球或花色球';
  const target = remaining === 0 ? '8号球' : groupLabel(group);
  return `${playerLabel(seat, solo)}目标：${target}`;
}
