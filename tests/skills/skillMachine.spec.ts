import { describe, expect, it } from 'vitest';
import { createSkillInstance } from '../../src/skills/skillCatalog';
import { SkillMachine, consumeSkillInstance } from '../../src/skills/skillMachine';

 describe('skill targeting inventory semantics', () => {
  it('does not consume while selecting or cancelling and enforces mutual exclusion', () => {
    const machine = new SkillMachine<number>([
      createSkillInstance('hand', 'hand-a'),
      createSkillInstance('hand', 'hand-b'),
    ]);

    expect(machine.beginTargeting('hand-a', 1)).toBe(true);
    expect(machine.selectTarget(2)).toBe(true);
    expect(machine.beginTargeting('hand-b', 3)).toBe(false);
    expect(machine.getInstance('hand-a')?.remainingUses).toBe(1);
    expect(machine.getInstance('hand-b')?.remainingUses).toBe(1);

    expect(machine.cancelTargeting()).toBe(true);
    expect(machine.cancelTargeting()).toBe(false);
    expect(machine.activeTargeting).toBeNull();
    expect(machine.getInstance('hand-a')?.remainingUses).toBe(1);

    expect(machine.beginTargeting('hand-a', 2)).toBe(true);
    const committed = machine.commitTargeting();
    expect(committed).toMatchObject({ instanceId: 'hand-a', skillId: 'hand', target: 2, remainingUses: 0 });
    expect(machine.activeTargeting).toBeNull();
    expect(machine.getInstance('hand-a')?.remainingUses).toBe(0);
    expect(machine.getInstance('hand-b')?.remainingUses).toBe(1);

    expect(machine.commitTargeting()).toBeNull();
    expect(machine.beginTargeting('hand-a')).toBe(false);
    expect(machine.beginTargeting('hand-b')).toBe(true);
  });

  it('pure consumption changes only the addressed instance and never resets a same-name instance', () => {
    const inventory = [
      createSkillInstance('hairdryer', 'dryer-a'),
      createSkillInstance('hairdryer', 'dryer-b'),
    ];
    const consumed = consumeSkillInstance(inventory, 'dryer-a');
    expect(inventory.map((instance) => instance.remainingUses)).toEqual([1, 1]);
    expect(consumed?.map((instance) => instance.remainingUses)).toEqual([0, 1]);
    expect(consumeSkillInstance(consumed ?? [], 'dryer-a')).toBeNull();
    expect(consumeSkillInstance(inventory, 'missing')).toBeNull();
  });
});
