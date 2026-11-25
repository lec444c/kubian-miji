import { describe, expect, it } from 'vitest';
import {
  chooseAiSkill,
  shouldWaitForFakeBallInHand,
} from '../../src/ai/skillPolicy';
import type {
  PublicMatchSituation,
  PublicSkillView,
} from '../../src/ai/skillPolicy';

const publicSituation: PublicMatchSituation = {
  phase: 'aiming',
  currentPlayer: 0,
  ballInHand: false,
  ownRemainingBalls: 4,
  opponentRemainingBalls: 4,
  hasClearShot: true,
};

const skills: PublicSkillView[] = [
  { id: 'aim-1', owner: 0, kind: 'aiming', usesRemaining: 1 },
  { id: 'guard-1', owner: 0, kind: 'defense', usesRemaining: 1 },
  { id: 'opponent-skill', owner: 1, kind: 'ballInHand', usesRemaining: 1 },
];

describe('skillPolicy', () => {
  it('uses an aiming skill for a publicly obstructed shot', () => {
    expect(chooseAiSkill({ ...publicSituation, hasClearShot: false }, skills, 0)).toEqual({
      type: 'useSkill', skillId: 'aim-1', reason: 'no-clear-shot',
    });
  });

  it('saves skills in an ordinary public position and respects availability', () => {
    expect(chooseAiSkill(publicSituation, skills, 0)).toEqual({
      type: 'none', reason: 'save-skill',
    });
    const unavailable = skills.map(skill => ({ ...skill, available: false }));
    expect(chooseAiSkill({ ...publicSituation, hasClearShot: false }, unavailable, 0).type)
      .toBe('none');
  });

  it('waits only from public ball-in-hand ownership, never a hidden fake flag', () => {
    const waiting: PublicMatchSituation = {
      ...publicSituation,
      phase: 'ballInHand',
      currentPlayer: 1,
      ballInHand: true,
    };
    expect(shouldWaitForFakeBallInHand(waiting, 0)).toBe(true);
    expect(chooseAiSkill(waiting, skills, 0)).toEqual({
      type: 'wait', reason: 'opponent-ball-in-hand',
    });

    const withHiddenFlags = { ...waiting, fake: true, isFakeBallInHand: true };
    expect(shouldWaitForFakeBallInHand(withHiddenFlags, 0)).toBe(true);
    expect(chooseAiSkill(withHiddenFlags, skills, 0)).toEqual(chooseAiSkill(waiting, skills, 0));
    expect(shouldWaitForFakeBallInHand({ ...waiting, currentPlayer: 0 }, 0)).toBe(false);
  });
});
