import type { GamePhase, Seat } from '../app/matchTypes';

/** Skill metadata visible to every player; no private or pending effect flags. */
export interface PublicSkillView {
  readonly id: string;
  readonly owner: Seat;
  readonly kind: 'aiming' | 'power' | 'defense' | 'ballInHand' | 'disruption' | 'other';
  readonly available?: boolean;
  readonly usesRemaining?: number;
  readonly cooldownRemaining?: number;
}

/** A deliberately small public projection of the match used by AI policy. */
export interface PublicMatchSituation {
  readonly phase: GamePhase;
  readonly currentPlayer: Seat;
  readonly ballInHand: boolean;
  readonly ownRemainingBalls: number;
  readonly opponentRemainingBalls: number;
  readonly hasClearShot: boolean;
}

export type AiSkillDecision =
  | { readonly type: 'useSkill'; readonly skillId: string; readonly reason: string }
  | { readonly type: 'wait'; readonly reason: string }
  | { readonly type: 'none'; readonly reason: string };

/**
 * A ball-in-hand phase owned by the opponent requires waiting. This also covers
 * a publicly visible fake-free-ball decision without inspecting its fake flag.
 */
export function shouldWaitForFakeBallInHand(
  situation: PublicMatchSituation,
  aiSeat: Seat,
): boolean {
  return situation.phase === 'ballInHand' && situation.ballInHand &&
    situation.currentPlayer !== aiSeat;
}

export const shouldWaitForFakeFreeBall = shouldWaitForFakeBallInHand;

function isUsable(skill: PublicSkillView, aiSeat: Seat): boolean {
  return skill.owner === aiSeat && skill.available !== false &&
    skill.usesRemaining !== 0 && (skill.cooldownRemaining ?? 0) <= 0;
}

function firstOfKind(
  skills: readonly PublicSkillView[],
  kinds: readonly PublicSkillView['kind'][],
): PublicSkillView | undefined {
  return skills.find(skill => kinds.includes(skill.kind));
}

/** Deterministic, side-effect-free skill selection from public information only. */
export function chooseAiSkill(
  situation: PublicMatchSituation,
  skills: readonly PublicSkillView[],
  aiSeat: Seat = situation.currentPlayer,
): AiSkillDecision {
  if (shouldWaitForFakeBallInHand(situation, aiSeat)) {
    return { type: 'wait', reason: 'opponent-ball-in-hand' };
  }
  if (situation.currentPlayer !== aiSeat) {
    return { type: 'none', reason: 'not-ai-turn' };
  }
  if (situation.phase !== 'aiming' && situation.phase !== 'skillTargeting') {
    return { type: 'none', reason: 'phase-not-actionable' };
  }

  const usable = skills.filter(skill => isUsable(skill, aiSeat));
  let selected: PublicSkillView | undefined;
  let reason: string;

  if (!situation.hasClearShot) {
    selected = firstOfKind(usable, ['aiming', 'ballInHand', 'power']);
    reason = 'no-clear-shot';
  } else if (situation.opponentRemainingBalls <= 1) {
    selected = firstOfKind(usable, ['defense', 'disruption']);
    reason = 'opponent-near-win';
  } else if (situation.ownRemainingBalls <= 1) {
    selected = firstOfKind(usable, ['aiming', 'power']);
    reason = 'finish-rack';
  } else {
    return { type: 'none', reason: 'save-skill' };
  }

  return selected
    ? { type: 'useSkill', skillId: selected.id, reason }
    : { type: 'none', reason: 'no-useful-skill' };
}

export const selectAiSkill = chooseAiSkill;
