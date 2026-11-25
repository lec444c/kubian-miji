export interface ExitDialogTexts { title: string; description: string; cancel: string; confirm: string }
const DEFAULT_TEXTS: ExitDialogTexts = {
  title: '返回主菜单？', description: '本局进度不会保存。音乐、音量和显示设置将保留。', cancel: '继续对局', confirm: '退出并返回',
};

/** Native modal: isolates game input and keeps keyboard focus inside confirmation. */
export class ExitDialog {
  readonly element = document.createElement('dialog');
  private returnFocus: HTMLElement | null = null;

  constructor(onConfirm: () => void, onCancel: () => void, idPrefix = 'exit', private texts: ExitDialogTexts = DEFAULT_TEXTS) {
    this.element.className = 'dialog exit-dialog';
    this.element.setAttribute('aria-labelledby', `${idPrefix}-title`);
    this.element.setAttribute('aria-describedby', `${idPrefix}-description`);
    this.element.innerHTML = `<h2 id="${idPrefix}-title">${texts.title}</h2>
      <p id="${idPrefix}-description">${texts.description}</p>
      <div class="exit-actions"><button class="secondary" data-exit-cancel>${texts.cancel}</button><button class="primary" data-exit-confirm>${texts.confirm}</button></div>`;
    const cancel = (): void => {
      this.close(true);
      onCancel();
    };
    this.element.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    this.element.addEventListener('keydown', event => event.stopPropagation());
    this.element.addEventListener('keyup', event => event.stopPropagation());
    this.element.querySelector('[data-exit-cancel]')!.addEventListener('click', cancel);
    this.element.querySelector('[data-exit-confirm]')!.addEventListener('click', () => {
      this.close(false);
      onConfirm();
    });
  }

  get isOpen(): boolean { return this.element.open; }

  open(): void {
    if (this.isOpen) return;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.element.showModal();
    this.element.querySelector<HTMLButtonElement>('[data-exit-cancel]')!.focus();
  }

  close(restoreFocus = false): void {
    if (this.isOpen) this.element.close();
    if (restoreFocus) this.returnFocus?.focus();
    this.returnFocus = null;
  }
}
