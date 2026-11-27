import type { SeededRng } from '../core/random/SeededRng';
import { createSkillInstance } from './skillCatalog';
import type { SkillId, SkillInstance } from './skillTypes';

export type DraftPhase = 'initial' | 'overtime';
export type SkillInstanceIdFactory = (skillId: SkillId, selectionIndex: number) => string;

export interface SkillDraft {
  phase: DraftPhase;
  candidates: SkillId[];
  instances: SkillInstance[];
}

let generatedInstanceSequence = 0;

const defaultInstanceId: SkillInstanceIdFactory = (skillId) => {
  generatedInstanceSequence += 1;
  return `${skillId}-${generatedInstanceSequence}`;
};

/** Shuffle a copy and draw unique candidates without mutating the pool. */
export function drawUniqueCandidates<T>(pool: readonly T[], rng: Pick<SeededRng, 'shuffle'>, maximum: number): T[] {
  const uniquePool = [...new Set(pool)];
  return rng.shuffle(uniquePool).slice(0, Math.max(0, Math.min(maximum, uniquePool.length)));
}

export function draftSkills(
  pool: readonly SkillId[],
  rng: Pick<SeededRng, 'shuffle'>,
  phase: DraftPhase = 'initial',
  instanceId: SkillInstanceIdFactory = defaultInstanceId,
): SkillDraft {
  const candidateLimit = phase === 'initial' ? 7 : 2;
  const candidates = drawUniqueCandidates(pool, rng, candidateLimit);
  const selectionCount = phase === 'initial' ? Math.min(3, candidates.length) : Math.min(1, candidates.length);
  const selectedIds = rng.shuffle(candidates).slice(0, selectionCount);

  return {
    phase,
    candidates,
    instances: selectedIds.map((skillId, index) => createSkillInstance(skillId, instanceId(skillId, index))),
  };
}

export function draftInitialSkills(
  pool: readonly SkillId[],
  rng: Pick<SeededRng, 'shuffle'>,
  instanceId?: SkillInstanceIdFactory,
): SkillDraft {
  return draftSkills(pool, rng, 'initial', instanceId);
}

export function draftOvertimeSkills(
  pool: readonly SkillId[],
  rng: Pick<SeededRng, 'shuffle'>,
  instanceId?: SkillInstanceIdFactory,
): SkillDraft {
  return draftSkills(pool, rng, 'overtime', instanceId);
}
