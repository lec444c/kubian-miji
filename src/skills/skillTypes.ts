import type { BallGroup, Seat } from '../app/matchTypes';

export type SkillId = 'hand' | 'hairdryer' | 'fakeFreeBall' | 'gentlemanDuel' | 'enhancedEnglish' | 'luckyPocket' | 'pierceShot';

export type SkillTargetKind = 'ownCushionBall' | 'movingBall' | 'none';

export interface SkillDefinition {
  id: SkillId;
  name: string;
  description: string;
  glyph: string;
  timing: string;
  targetKind: SkillTargetKind;
}

/** A skill instance is single-use. Two instances may share a definition, never an instanceId. */
export interface SkillInstance {
  instanceId: string;
  definitionId: SkillId;
  skillId: SkillId;
  readonly maxUses: 1;
  remainingUses: number;
  ownerSeat?: Seat;
  source?: 'opening' | 'overtime';
  usedAtTurn?: number;
}

export type SkillInventory = SkillInstance[];

export type PlayerGroups = Readonly<Partial<Record<Seat, BallGroup | null>>>;

export interface SkillTargeting<Target = unknown> {
  instanceId: string;
  skillId: SkillId;
  target?: Target;
}

export interface CommittedSkillUse<Target = unknown> extends SkillTargeting<Target> {
  remainingUses: number;
}
