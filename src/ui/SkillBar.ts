import type { Seat } from '../app/matchTypes';
import type { SkillDefinition, SkillInstance } from '../skills/skillTypes';
import { skillIcon } from './icons';

export class SkillBar {
  constructor(private onUse: (seat: Seat, instanceId: string) => void) {}

  render(container: HTMLElement, seat: Seat, instances: SkillInstance[], catalog: SkillDefinition[], enabled: boolean, eligibility: (instance: SkillInstance) => boolean): void {
    container.innerHTML = instances.length ? instances.map(instance => {
      const definition = catalog.find(skill => skill.id === instance.definitionId)!;
      const used = instance.remainingUses <= 0;
      const ready = enabled && !used && eligibility(instance);
      const disabled = !enabled || used || !eligibility(instance);
      return `<button class="skill-card ${used ? 'used' : ''} ${ready ? 'ready' : ''}" data-skill="${instance.instanceId}" ${disabled ? 'disabled' : ''} title="${definition.description}">${skillIcon(definition.id)}<span class="skill-text"><strong>${definition.name}</strong><small>${used ? '本局已使用' : definition.timing}</small></span><span class="skill-state">${used ? '已用' : ready ? '可用' : '等待'}</span></button>`;
    }).join('') : '<div class="skill-empty">经典模式不使用技能。<br>选择创意中八即可体验秘技。</div>';
    container.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach(button => button.addEventListener('click', () => this.onUse(seat, button.dataset.skill!)));
  }
}