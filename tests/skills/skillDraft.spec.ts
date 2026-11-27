import { describe, expect, it } from 'vitest';
import { SeededRng } from '../../src/core/random/SeededRng';
import { SKILL_CATALOG, SKILL_IDS, createSkillInstance } from '../../src/skills/skillCatalog';
import { draftInitialSkills, draftOvertimeSkills, drawUniqueCandidates } from '../../src/skills/skillDraft';
import { SkillMachine } from '../../src/skills/skillMachine';

 describe('skill catalog and drafts', () => {
  it('provides Chinese descriptions and independent single-use instances', () => {
    for (const id of SKILL_IDS) {
      expect(SKILL_CATALOG[id].description).toMatch(/[\u4e00-\u9fff]/);
      expect(SKILL_CATALOG[id].id).toBe(id);
    }
    const first = createSkillInstance('hand', 'hand-a');
    const second = createSkillInstance('hand', 'hand-b');
    expect(first.instanceId).not.toBe(second.instanceId);
    expect(first.remainingUses).toBe(1);
    expect(second.remainingUses).toBe(1);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('draws min(7, poolSize) unique candidates for pool size %i', (poolSize) => {
    const pool = Array.from({ length: poolSize }, (_, index) => `skill-${index}`);
    const candidates = drawUniqueCandidates(pool, new SeededRng(42), 7);
    expect(candidates).toHaveLength(Math.min(7, poolSize));
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(pool).toHaveLength(poolSize);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('selects min(3, candidateCount) initial instances for %i skills', (poolSize) => {
    const draft = draftInitialSkills(SKILL_IDS.slice(0, poolSize), new SeededRng(7));
    expect(draft.candidates).toHaveLength(Math.min(7, poolSize));
    expect(new Set(draft.candidates).size).toBe(draft.candidates.length);
    expect(draft.instances).toHaveLength(Math.min(3, draft.candidates.length));
  });

  it('includes all seven opening skills and selects three', () => {
    expect(SKILL_IDS).toHaveLength(7);
    expect(SKILL_CATALOG.enhancedEnglish).toMatchObject({ name: '加塞强化', glyph: '塞', targetKind: 'none' });
    expect(SKILL_CATALOG.luckyPocket).toMatchObject({ name: '幸运袋口', glyph: '袋', targetKind: 'none' });
    expect(SKILL_CATALOG.pierceShot).toMatchObject({ name: '穿透击', glyph: '穿', targetKind: 'none' });
    const draft = draftInitialSkills(SKILL_IDS, new SeededRng(11));
    expect(draft.candidates).toHaveLength(7);
    expect(draft.instances).toHaveLength(3);
  });

  it('draws at most two overtime candidates and creates fresh same-name instances', () => {
    const initial = draftInitialSkills(['hand'], new SeededRng(1), () => 'old-hand');
    const machine = new SkillMachine(initial.instances);
    expect(machine.beginTargeting('old-hand')).toBe(true);
    expect(machine.commitTargeting()?.remainingUses).toBe(0);

    const overtime = draftOvertimeSkills(SKILL_IDS, new SeededRng(2), (skillId) => `new-${skillId}`);
    expect(overtime.candidates.length).toBeLessThanOrEqual(2);
    expect(overtime.candidates.length).toBe(Math.min(2, SKILL_IDS.length));
    expect(overtime.instances).toHaveLength(Math.min(1, overtime.candidates.length));
    expect(overtime.instances.every(instance => overtime.candidates.includes(instance.skillId))).toBe(true);

    const newHand = draftOvertimeSkills(['hand'], new SeededRng(3), () => 'new-hand');
    expect(machine.addInstances(newHand.instances)).toBe(true);
    expect(machine.getInstance('old-hand')?.remainingUses).toBe(0);
    expect(machine.getInstance('new-hand')?.remainingUses).toBe(1);
    expect(newHand.instances[0]?.instanceId).not.toBe(initial.instances[0]?.instanceId);
  });
});
