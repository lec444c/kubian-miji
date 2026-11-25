import type { GamePhase } from './matchTypes';

const transitions: Record<GamePhase, GamePhase[]> = {
  menu: ['draft', 'breakPlacement', 'aiming', 'ballInHand'],
  draft: ['breakPlacement', 'aiming', 'ballInHand', 'menu'],
  breakPlacement: ['aiming', 'menu'],
  aiming: ['rolling', 'skillTargeting', 'ballInHand', 'gameOver', 'menu'],
  ballInHand: ['aiming', 'rolling', 'skillTargeting', 'gameOver', 'menu'],
  rolling: ['aiming', 'ballInHand', 'skillTargeting', 'gameOver', 'menu'],
  skillTargeting: ['aiming', 'ballInHand', 'rolling', 'gameOver', 'menu'],
  gameOver: ['draft', 'breakPlacement', 'aiming', 'menu'],
};

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return from === to || transitions[from].includes(to);
}

export function assertTransition(from: GamePhase, to: GamePhase): void {
  if (!canTransition(from, to)) throw new Error(`非法对局状态转换：${from} → ${to}`);
}
