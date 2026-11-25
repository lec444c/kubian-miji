import type { SkillDefinition, SkillId, SkillInstance } from './skillTypes';

export const SKILL_CATALOG: Readonly<Record<SkillId, Readonly<SkillDefinition>>> = Object.freeze({
  hand: Object.freeze({
    id: 'hand',
    name: '手部微操',
    description: '选择己方已分组且静止的库边球，将它安全地微调至最近袋口附近；目标点不会与其他球重叠，也不会处于袋口捕获区。',
    glyph: '手',
    timing: '对手回合、击球前使用',
    targetKind: 'ownCushionBall',
  }),
  hairdryer: Object.freeze({
    id: 'hairdryer',
    name: '吹风机',
    description: '选择一颗仍在桌面上合法运动的球，为其创建持续 3 秒的固定步进制动效果；技能本身不直接驱动物理模拟。',
    glyph: '风',
    timing: '球局运动中，对指定球使用',
    targetKind: 'movingBall',
  }),
  fakeFreeBall: Object.freeze({
    id: 'fakeFreeBall',
    name: '假自由球',
    description: '制造持续 10 秒的假自由球。对手主动放置或击球并造成移动时触发特殊犯规，技能使用者获得真自由球；若无人触发，超时后对手获得真自由球。',
    glyph: '假',
    timing: '己方回合、击球前使用，持续 10 秒',
    targetKind: 'none',
  }),
  gentlemanDuel: Object.freeze({
    id: 'gentlemanDuel',
    name: '绅士决斗',
    description: '对局任意时刻展开球桌领域，双方持杆进行一局桌面格斗；格斗胜者直接赢下本场台球比赛，落败方无需再击球。平局或放弃决斗则退回球局继续。',
    glyph: '决',
    timing: '对局任意时刻',
    targetKind: 'none',
  }),
});

export const SKILL_IDS: readonly SkillId[] = Object.freeze(['hand', 'hairdryer', 'fakeFreeBall', 'gentlemanDuel']);

export function createSkillInstance(skillId: SkillId, instanceId: string): SkillInstance {
  if (!SKILL_CATALOG[skillId]) throw new Error(`Unknown skill: ${skillId}`);
  if (instanceId.trim().length === 0) throw new Error('A skill instance requires a non-empty instanceId');
  return { instanceId, definitionId: skillId, skillId, maxUses: 1, remainingUses: 1 };
}
