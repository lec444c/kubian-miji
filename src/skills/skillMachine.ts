import type {
  CommittedSkillUse,
  SkillInstance,
  SkillInventory,
  SkillTargeting,
} from './skillTypes';

const copyInstance = (instance: SkillInstance): SkillInstance => ({ ...instance });

/** Consume exactly the addressed instance; another instance with the same skillId is untouched. */
export function consumeSkillInstance(inventory: readonly SkillInstance[], instanceId: string): SkillInventory | null {
  const instance = inventory.find((candidate) => candidate.instanceId === instanceId);
  if (!instance || instance.remainingUses <= 0) return null;
  return inventory.map((candidate) => candidate.instanceId === instanceId
    ? { ...candidate, remainingUses: candidate.remainingUses - 1 }
    : copyInstance(candidate));
}

/** Targeting is deliberately single-active: starting, changing a target, and cancelling never consume inventory. */
export class SkillMachine<Target = unknown> {
  private inventory: SkillInventory;
  private active: SkillTargeting<Target> | null = null;

  constructor(instances: readonly SkillInstance[] = []) {
    const ids = new Set<string>();
    for (const instance of instances) {
      if (ids.has(instance.instanceId)) throw new Error(`Duplicate skill instanceId: ${instance.instanceId}`);
      ids.add(instance.instanceId);
    }
    this.inventory = instances.map(copyInstance);
  }

  get activeTargeting(): SkillTargeting<Target> | null {
    return this.active ? { ...this.active } : null;
  }

  getInventory(): SkillInventory {
    return this.inventory.map(copyInstance);
  }

  getInstance(instanceId: string): SkillInstance | null {
    const instance = this.inventory.find((candidate) => candidate.instanceId === instanceId);
    return instance ? copyInstance(instance) : null;
  }

  addInstance(instance: SkillInstance): boolean {
    return this.addInstances([instance]);
  }

  /** Add overtime instances atomically. Same-name skills are allowed, duplicate instance IDs are not. */
  addInstances(instances: readonly SkillInstance[]): boolean {
    const ids = new Set(this.inventory.map((instance) => instance.instanceId));
    for (const instance of instances) {
      if (ids.has(instance.instanceId)) return false;
      ids.add(instance.instanceId);
    }
    this.inventory.push(...instances.map(copyInstance));
    return true;
  }

  beginTargeting(instanceId: string, target?: Target): boolean {
    if (this.active) return false;
    const instance = this.inventory.find((candidate) => candidate.instanceId === instanceId);
    if (!instance || instance.remainingUses <= 0) return false;
    this.active = {
      instanceId: instance.instanceId,
      skillId: instance.skillId,
      ...(target !== undefined ? { target } : {}),
    };
    return true;
  }

  selectTarget(target: Target): boolean {
    if (!this.active) return false;
    this.active.target = target;
    return true;
  }

  cancelTargeting(): boolean {
    if (!this.active) return false;
    this.active = null;
    return true;
  }

  commitTargeting(): CommittedSkillUse<Target> | null {
    if (!this.active) return null;
    const consumed = consumeSkillInstance(this.inventory, this.active.instanceId);
    if (!consumed) return null;
    const consumedInstance = consumed.find((candidate) => candidate.instanceId === this.active?.instanceId);
    const committed: CommittedSkillUse<Target> = {
      ...this.active,
      remainingUses: consumedInstance?.remainingUses ?? 0,
    };
    this.inventory = consumed;
    this.active = null;
    return committed;
  }
}

export function createSkillMachine<Target = unknown>(instances: readonly SkillInstance[] = []): SkillMachine<Target> {
  return new SkillMachine<Target>(instances);
}
