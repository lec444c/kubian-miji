import type { SkillDefinition } from '../skills/skillTypes';
import { skillIcon } from './icons';

export class DraftDialog {
  readonly element = document.createElement('div');
  private selected = new Set<string>();
  private maxSelections = 3;

  constructor(private onConfirm: (ids: string[]) => void, private onExit: () => void) {
    this.element.className = 'overlay hidden';
    this.element.addEventListener('keydown', event => event.stopPropagation());
    this.element.addEventListener('keyup', event => event.stopPropagation());
    this.element.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('[data-draft-exit]')) { this.onExit(); return; }
      const option = (event.target as HTMLElement).closest<HTMLButtonElement>('.draft-option');
      if (option) {
        const id = option.dataset.id!;
        if (this.selected.has(id)) this.selected.delete(id);
        else if (this.selected.size < this.maxSelections) this.selected.add(id);
        option.classList.toggle('selected', this.selected.has(id));
        this.refresh();
      }
      if ((event.target as HTMLElement).closest('[data-confirm]') && this.selected.size === this.maxSelections) {
        this.element.classList.add('hidden');
        this.onConfirm([...this.selected]);
      }
    });
  }

  show(seatName: string, candidates: SkillDefinition[], maxSelections: number, overtime: boolean): void {
    this.selected.clear();
    this.maxSelections = Math.min(maxSelections, candidates.length);
    this.element.innerHTML = `<section class="dialog" role="dialog" aria-label="技能选择"><div class="dialog-header"><div class="eyebrow">${overtime ? 'OVERTIME SKILL' : 'OPENING SKILLS'}</div><h2>${seatName} · ${overtime ? '加时技能二选一' : '选择本局技能'}</h2><p>${overtime ? '对局已超过 10 分钟。新技能与前序技能相互独立，可在后续对局使用一次。' : `当前技能池提供 ${candidates.length} 个不同技能，请选择 ${this.maxSelections} 个。`}</p></div><div class="draft-options">${candidates.map(skill => `<button class="draft-option" data-id="${skill.id}">${skillIcon(skill.id, 'large')}<strong>${skill.name}</strong><small>${skill.description}</small></button>`).join('')}</div><div class="dialog-actions"><span data-count>已选择 0 / ${this.maxSelections}</span><div class="draft-actions"><button class="secondary" data-draft-exit>返回主菜单</button><button class="primary" data-confirm disabled>确认技能</button></div></div></section>`;
    this.element.classList.remove('hidden');
  }

  hide(): void {
    this.element.classList.add('hidden');
    this.selected.clear();
  }

  private refresh(): void {
    const count = this.element.querySelector<HTMLElement>('[data-count]');
    const confirm = this.element.querySelector<HTMLButtonElement>('[data-confirm]');
    if (count) count.textContent = `已选择 ${this.selected.size} / ${this.maxSelections}`;
    if (confirm) confirm.disabled = this.selected.size !== this.maxSelections;
  }
}