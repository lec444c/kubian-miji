import type { SkillId } from '../skills/skillTypes';

/** game-icons.net SVGs (CC BY 3.0, see NOTICE), tinted via CSS mask-image. */
const ICON_PATHS: Partial<Record<SkillId, string>> = {
  hand: '/assets/icons/hand.svg',
  hairdryer: '/assets/icons/hairdryer.svg',
  fakeFreeBall: '/assets/icons/fake.svg',
};

/** 无外部图标的技能使用定义里的单字徽记（本项目原创字形样式，无第三方素材）。 */
const ICON_GLYPHS: Partial<Record<SkillId, string>> = {
  gentlemanDuel: '决',
  enhancedEnglish: '塞',
  luckyPocket: '袋',
  pierceShot: '穿',
};

export function skillIcon(id: SkillId, extraClass = ''): string {
  const path = ICON_PATHS[id];
  if (path) return `<span class="skill-icon ${extraClass}" style="--icon:url('${path}')" aria-hidden="true"></span>`;
  return `<span class="skill-icon skill-glyph ${extraClass}" aria-hidden="true">${ICON_GLYPHS[id] ?? '技'}</span>`;
}