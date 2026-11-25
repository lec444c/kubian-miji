import {
  FightSimulation, MAX_HP, NEUTRAL_INPUT, SKILL_NAMES, SKILL_ORDER, aiInput,
  type FightInput, type FightAction, type FightSkill,
} from './FightSimulation';
import { FightView } from './FightView';
import { ExitDialog } from '../ui/ExitDialog';
import type { AudioEffects } from '../view/AudioEffects';
import './fight.css';

const STEP = 1 / 120;
const SKILL_CODES: Record<FightSkill, string> = { ball: 'Digit1', cat: 'Digit2', volley: 'Digit3', dog: 'Digit4' };
const ACTION_NAMES: Record<FightAction, string> = {
  idle: '持杆待机', walk: '步行', run: '奔跑', jump: '跳跃一', jumpBack: '跳跃二',
  slash: '挥杆一', slashAlt: '挥杆二', impact: '受击一', impactAlt: '受击二',
  turn: '转身一', turnAlt: '转身二', guard: '防御', down: '倒地', ko: '击倒',
  skillBall: '挥杆·自由球', skillCat: '召唤·老吴出击', skillVolley: '拉弓·万杆齐发', skillDog: '召唤·大狗大狗叫叫叫',
};
const CLIPS: FightAction[] = ['idle', 'walk', 'run', 'jump', 'jumpBack', 'turn', 'turnAlt', 'impact', 'impactAlt', 'slash', 'slashAlt', 'skillBall', 'skillVolley', 'down'];
export interface FightDebug {
  getState(): ReturnType<FightSimulation['getSnapshot']> & { ready: boolean; paused: boolean; holding: boolean; training: boolean; preview: string; visuals: ReturnType<FightView['getDebug']> | null };
  arrange(x0: number, x1: number): void;
  setHp(seat: 0 | 1, hp: number): void;
  setRage(seat: 0 | 1, rage: number): void;
}
export type DuelResult = 'win0' | 'win1' | 'draw' | 'abort';
export interface DuelOptions { onResult: (result: DuelResult) => void }
declare global { interface Window { __cueFight?: FightDebug } }

/** Independent lifetime: no fight state or key press enters the billiards match. */
export class FightMode {
  readonly element = document.createElement('section');
  private sim = new FightSimulation();
  private view: FightView | null = null;
  private disposed = false;
  private ready = false;
  private paused = false;
  private beforeExit = false;
  private training = false;
  private preview: FightAction | null = null;
  private previewTime = 0;
  private mirrored = true;
  private keys = new Set<string>();
  private pulses = new Set<string>();
  private abort = new AbortController();
  private frame = 0;
  private lastTime = 0;
  private accumulator = 0;
  private hitFlash = 0;
  private broadcastTimer = 0;
  private broadcastHold = false;
  private duelTimer = -1;
  private duelResultSent = false;
  private dialog: ExitDialog;
  private debug: FightDebug;

  constructor(host: HTMLElement, private audio: AudioEffects, private onExit: () => void, reducedMotion: boolean, private duel: DuelOptions | null = null) {
    this.element.className = 'fight-mode';
    this.element.setAttribute('aria-label', '球杆格斗演示');
    this.element.innerHTML = `
      <div class="fight-stage" data-fight-stage></div>
      <header class="fight-top">
        <div class="fight-title"><span class="fight-mark">杆</span><div><b>球杆格斗</b><span>空台桌面 · 微缩对决</span></div></div>
        <nav aria-label="格斗操作"><button data-fight-training aria-pressed="false">电脑：对战</button><button data-fight-mute>声音</button><button data-fight-pause>暂停</button><button data-fight-restart>重新开始</button><button data-fight-exit>返回主菜单</button></nav>
      </header>
      <div class="fight-score" aria-label="对战状态">
        <div class="fight-player"><div><strong>P1 · 你 · 青方</strong><span data-hp-label="0">${MAX_HP} / ${MAX_HP}</span></div><div class="fight-health" role="progressbar" aria-label="玩家生命" aria-valuemin="0" aria-valuemax="${MAX_HP}" aria-valuenow="${MAX_HP}"><i data-hp="0"></i></div><div class="fight-rage" role="progressbar" aria-label="玩家怒气" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i data-rage="0"></i><span data-rage-label="0">怒气 0%</span></div><small data-action="0">持杆待机</small></div>
        <div class="fight-clock"><b data-fight-clock>100</b><span>单局对决</span></div>
        <div class="fight-player opponent"><div><strong>P2 · 电脑 · 朱方</strong><span data-hp-label="1">${MAX_HP} / ${MAX_HP}</span></div><div class="fight-health" role="progressbar" aria-label="电脑生命" aria-valuemin="0" aria-valuemax="${MAX_HP}" aria-valuenow="${MAX_HP}"><i data-hp="1"></i></div><div class="fight-rage" role="progressbar" aria-label="电脑怒气" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i data-rage="1"></i><span data-rage-label="1">怒气 0%</span></div><small data-action="1">持杆待机</small></div>
      </div>
      <div class="fight-center" data-fight-center role="status" aria-live="polite"><b>加载中</b><div class="fight-progress" role="progressbar" aria-label="格斗资源加载" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i data-load-bar></i></div><span class="fight-load-percent" data-load-percent>0%</span></div>
      <div class="fight-hit" data-fight-hit aria-hidden="true"></div>
      <div class="fight-broadcast" data-fight-broadcast hidden aria-hidden="true"><img alt="火焰猛犬横幅"><b>大狗大狗叫叫叫</b><span>怒气大招 · 猛犬冲锋</span></div>
      <div class="fight-combo" data-fight-combo hidden aria-live="polite">连击 <b data-combo-count>0</b><span>攻速提升</span></div>
      <footer class="fight-bottom">
        <div class="fight-instructions"><b>A / D</b> 移动 <b>Shift+方向</b> 奔跑 <b>Space</b> 跳跃 <b>J</b> 挥杆 <b>K</b> 重击 <b>L</b> 防御·蓄怒气 <b>1/2/3</b> 技能 <b>4</b> 大招·怒气满 <b>Esc</b> 暂停</div>
        <div class="fight-skills" aria-label="格斗技能">${SKILL_ORDER.map((skill, index) => `<button data-skill="${skill}" aria-label="技能${index + 1} ${SKILL_NAMES[skill]}"><b>${index + 1}</b><span>${SKILL_NAMES[skill]}</span><small data-skill-cd="${skill}">就绪</small></button>`).join('')}</div>
        <div class="fight-touch" aria-label="屏幕格斗按键"><button data-hold="KeyA" aria-label="向左移动">←</button><button data-hold="KeyD" aria-label="向右移动">→</button><button data-hold="ShiftLeft">奔跑</button><button data-tap="Space">跳跃 Space</button><button data-tap="KeyJ">挥杆 J</button><button data-tap="KeyK">重击 K</button><button data-hold="KeyL">防御 L</button><button data-tap="Digit4">大招 4</button></div>
        <details class="fight-lab"><summary>动作预览 · 14 段动作</summary><div class="fight-lab-row"><label>预览动作 <select data-fight-preview><option value="">返回对战</option>${CLIPS.map(name => `<option value="${name}">${ACTION_NAMES[name]}</option>`).join('')}</select></label><label><input type="checkbox" data-fight-mirror checked> 对手镜像</label><span>预览时停止计时与伤害，可检查双手握杆与弓箭姿态。</span></div></details>
      </footer>`;
    host.append(this.element);
    // 离线单文件包只拦截 src 属性赋值；innerHTML 里的 src 特性会绕过拦截，故在此用属性赋值。
    this.element.querySelector<HTMLImageElement>('[data-fight-broadcast] img')!.src = '/assets/fight/dagou-banner.webp';
    if (this.duel) {
      this.element.dataset.duel = 'true';
      this.element.querySelector('[data-fight-exit]')!.textContent = '放弃决斗';
      this.element.querySelector('.fight-title div>span')!.textContent = '绅士决斗 · 胜者赢下台球比赛';
    }
    this.dialog = new ExitDialog(() => this.exit(), () => {
      this.paused = this.beforeExit || document.hidden;
      this.clearInput();
      this.updateHud();
    }, 'fight-exit', this.duel
      ? { title: '放弃决斗？', description: '放弃后退回球局继续台球比赛，决斗技能不会返还。', cancel: '继续决斗', confirm: '放弃并返回球局' }
      : undefined);
    this.element.append(this.dialog.element);
    const signal = this.abort.signal;
    this.element.querySelector('[data-fight-exit]')!.addEventListener('click', () => {
      this.beforeExit = this.paused;
      this.paused = true;
      this.clearInput();
      this.dialog.open();
    }, { signal });
    this.element.querySelector('[data-fight-restart]')!.addEventListener('click', () => this.restart(), { signal });
    this.element.querySelector('[data-fight-pause]')!.addEventListener('click', () => this.togglePause(), { signal });
    this.element.querySelector('[data-fight-training]')!.addEventListener('click', () => {
      this.training = !this.training;
      this.restart();
    }, { signal });
    this.element.querySelector('[data-fight-mute]')!.addEventListener('click', () => {
      this.audio.setMuted(!this.audio.getSettings().muted);
      this.updateHud();
    }, { signal });
    this.element.querySelector<HTMLSelectElement>('[data-fight-preview]')!.addEventListener('change', event => {
      this.preview = (event.target as HTMLSelectElement).value as FightAction || null;
      this.previewTime = 0;
      this.clearInput();
      this.view?.resetActions();
      this.updateHud();
    }, { signal });
    this.element.querySelector<HTMLInputElement>('[data-fight-mirror]')!.addEventListener('change', event => {
      this.mirrored = (event.target as HTMLInputElement).checked;
    }, { signal });
    this.element.querySelectorAll<HTMLButtonElement>('[data-hold],[data-tap]').forEach(button => {
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        if (!this.ready || this.paused || this.broadcastHold || this.preview || this.sim.winner !== null) return;
        const code = button.dataset.hold ?? button.dataset.tap!;
        button.setPointerCapture(event.pointerId);
        button.classList.add('held');
        this.keys.add(code);
        this.pulses.add(code);
        this.audio.unlock();
      }, { signal });
      const release = (): void => {
        this.keys.delete(button.dataset.hold ?? button.dataset.tap!);
        button.classList.remove('held');
      };
      button.addEventListener('pointerup', release, { signal });
      button.addEventListener('pointercancel', release, { signal });
      button.addEventListener('lostpointercapture', release, { signal });
      // Keyboard activation of on-screen buttons is an attack pulse, not a held gesture.
      button.addEventListener('click', event => {
        if (event.detail === 0 && button.dataset.tap && this.ready && !this.paused && !this.broadcastHold && !this.preview && this.sim.winner === null) this.pulses.add(button.dataset.tap);
      }, { signal });
    });
    this.element.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach(button => {
      const code = SKILL_CODES[button.dataset.skill as FightSkill];
      if (!code) return;
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        if (!this.ready || this.paused || this.broadcastHold || this.preview || this.sim.winner !== null) return;
        this.pulses.add(code);
        this.audio.unlock();
        button.blur();
      }, { signal });
      button.addEventListener('click', event => {
        if (event.detail === 0 && this.ready && !this.paused && !this.broadcastHold && !this.preview && this.sim.winner === null) this.pulses.add(code);
      }, { signal });
    });
    window.addEventListener('keydown', event => this.key(event, true), { capture: true, signal });
    window.addEventListener('keyup', event => this.key(event, false), { capture: true, signal });
    window.addEventListener('blur', () => this.autoPause(), { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autoPause(); }, { signal });
    window.addEventListener('resize', () => this.view?.resize(), { signal });
    this.debug = {
      getState: () => ({ ...this.sim.getSnapshot(), ready: this.ready, paused: this.paused, holding: this.broadcastHold, training: this.training, preview: this.preview ?? '', visuals: this.view?.getDebug() ?? null }),
      arrange: (x0, x1) => {
        if (![x0, x1].every(Number.isFinite)) return;
        this.sim.reset();
        this.sim.fighters[0].x = Math.max(-4.6, Math.min(4.6, x0));
        this.sim.fighters[1].x = Math.max(-4.6, Math.min(4.6, x1));
        this.clearInput();
      },
      setHp: (seat, hp) => {
        if ((seat !== 0 && seat !== 1) || !Number.isFinite(hp)) return;
        this.sim.fighters[seat].hp = Math.max(0, Math.min(MAX_HP, hp));
        this.updateHud();
      },
      setRage: (seat, rage) => {
        if ((seat !== 0 && seat !== 1) || !Number.isFinite(rage)) return;
        this.sim.fighters[seat].rage = Math.max(0, Math.min(100, rage));
        this.updateHud();
      },
    };
    window.__cueFight = this.debug;
    void this.load(reducedMotion);
  }

  private async load(reducedMotion: boolean): Promise<void> {
    try {
      const view = new FightView(this.element.querySelector<HTMLElement>('[data-fight-stage]')!, reducedMotion);
      this.view = view;
      await view.load((done, total) => this.setLoadProgress(done, total));
      if (this.disposed) { view.dispose(); return; }
      this.ready = true;
      this.setLoadProgress(1, 1);
      delete this.element.dataset.loadError;
      this.audio.unlock();
      this.audio.startFightMusic();
      this.updateHud();
      this.frame = requestAnimationFrame(time => this.loop(time));
    } catch (error) {
      if (this.disposed) return;
      const center = this.element.querySelector<HTMLElement>('[data-fight-center]')!;
      center.replaceChildren();
      const title = document.createElement('b'); title.textContent = '格斗素材未能载入';
      const detail = document.createElement('span'); detail.textContent = error instanceof Error ? error.message : String(error);
      const retry = document.createElement('button'); retry.textContent = '重试载入';
      retry.addEventListener('click', () => { retry.disabled = true; retry.textContent = '正在重试…'; this.view?.dispose(); this.view = null; void this.load(reducedMotion); }, { signal: this.abort.signal });
      center.append(title, detail, retry);
      this.element.dataset.loadError = 'true';
    }
  }

  /** Real asset-progress percentage shown on the loading card. */
  private setLoadProgress(done: number, total: number): void {
    const percent = Math.max(0, Math.min(100, Math.round(done / Math.max(1, total) * 100)));
    this.element.dataset.loadProgress = String(percent);
    const bar = this.element.querySelector<HTMLElement>('[data-load-bar]');
    if (bar) bar.style.width = `${percent}%`;
    const label = this.element.querySelector<HTMLElement>('[data-load-percent]');
    if (label) label.textContent = `${percent}%`;
    const track = this.element.querySelector<HTMLElement>('.fight-progress');
    if (track) track.setAttribute('aria-valuenow', String(percent));
  }

  private key(event: KeyboardEvent, down: boolean): void {
    if (this.dialog.isOpen) { event.stopImmediatePropagation(); return; }
    // Isolate the dormant billiards hotkeys, but retain Tab and native browser shortcuts.
    event.stopImmediatePropagation();
    if (event.ctrlKey || event.metaKey) return;
    const code = event.code;
    if (!down) this.keys.delete(code);
    // Space is the jump key even when a toolbar button still owns focus; Enter keeps native activation.
    if (event.target instanceof HTMLButtonElement && code === 'Enter') return;
    const controls = ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyJ', 'KeyK', 'KeyL', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'ShiftLeft', 'ShiftRight', 'Escape', 'KeyR'];
    if (!controls.includes(code)) return;
    const formFocused = event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement;
    if (formFocused && code !== 'Escape') { event.stopImmediatePropagation(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!down) { this.keys.delete(code); return; }
    if (event.repeat) return;
    this.audio.unlock();
    if (code === 'Escape') { this.togglePause(); return; }
    if (code === 'KeyR') { this.restart(); return; }
    if (!this.ready || this.paused || this.broadcastHold || this.preview || this.sim.winner !== null) return;
    this.keys.add(code); this.pulses.add(code);
  }

  private clearInput(): void {
    this.keys.clear(); this.pulses.clear(); this.accumulator = 0;
    this.element.querySelectorAll('.held').forEach(el => el.classList.remove('held'));
  }

  private autoPause(): void {
    this.clearInput();
    if (this.ready && this.sim.winner === null) { this.paused = true; this.updateHud(); }
  }

  private togglePause(): void {
    if (!this.ready || this.sim.winner !== null || this.dialog.isOpen) return;
    this.paused = !this.paused;
    this.clearInput();
    this.updateHud();
  }

  private showBroadcast(): void {
    const el = this.element.querySelector<HTMLElement>('[data-fight-broadcast]')!;
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.broadcastTimer = 2.6;
    // 全屏播报期间冻结对局：不推进模拟、不接受新输入，播报结束后自动继续。
    this.broadcastHold = true;
    this.pulses.clear();
  }

  /** 验收截图会把播报动画定格在满不透明帧；此时不要按计时把它隐藏。 */
  private broadcastAnimationsPaused(): boolean {
    const el = this.element.querySelector<HTMLElement>('[data-fight-broadcast]');
    return el !== null && el.getAnimations().some(animation => animation.playState === 'paused');
  }

  private hideBroadcast(): void {
    const el = this.element.querySelector<HTMLElement>('[data-fight-broadcast]')!;
    el.classList.remove('show');
    el.hidden = true;
    this.broadcastTimer = 0;
    this.broadcastHold = false;
  }

  private restart(): void {
    if (!this.ready) return;
    this.sim.reset(); this.view?.resetActions(); this.audio.stopSfx();
    this.paused = false; this.preview = null; this.previewTime = 0; this.hitFlash = 0;
    this.duelTimer = -1; this.duelResultSent = false;
    this.hideBroadcast();
    this.element.querySelector<HTMLSelectElement>('[data-fight-preview]')!.value = '';
    this.clearInput(); this.updateHud();
  }

  private input(): FightInput {
    const held = (...codes: string[]): boolean => codes.some(code => this.keys.has(code));
    const tap = (...codes: string[]): boolean => codes.some(code => this.pulses.has(code));
    const move = Number(held('KeyD', 'ArrowRight')) - Number(held('KeyA', 'ArrowLeft'));
    const skills: FightSkill[] = [];
    if (tap('Digit1')) skills.push('ball');
    if (tap('Digit2')) skills.push('cat');
    if (tap('Digit3')) skills.push('volley');
    if (tap('Digit4')) skills.push('dog');
    return {
      move,
      run: held('ShiftLeft', 'ShiftRight') && move !== 0,
      jump: tap('Space'),
      light: tap('KeyJ'),
      heavy: tap('KeyK'),
      guard: held('KeyL'),
      skills,
    };
  }

  private loop(time: number): void {
    if (this.disposed) return;
    const wallDt = this.lastTime ? Math.max(0, (time - this.lastTime) / 1000) : 0;
    const dt = this.lastTime ? Math.min(0.05, wallDt) : 0;
    this.lastTime = time;
    if (!this.paused && !this.preview && this.sim.winner === null && !this.broadcastHold) {
      this.accumulator += dt;
      while (this.accumulator >= STEP) {
        this.sim.step(STEP, [this.input(), this.training ? { ...NEUTRAL_INPUT } : aiInput(this.sim)]);
        this.pulses.clear();
        for (const event of this.sim.events) {
          if (event.kind === 'swing') this.audio.strike(0.35);
          if (event.kind === 'skillCast') {
            this.audio.strike(0.5);
            if (event.skill === 'cat') this.audio.catScream();
            if (event.skill === 'dog') {
              this.audio.dagouPhrase();
              this.showBroadcast();
            }
          }
          if (event.kind === 'hit') {
            this.audio.punch(0.75);
            this.hitFlash = 0.18;
            this.view?.hit(event.seat, false);
            this.element.querySelector<HTMLElement>('[data-fight-hit]')!.textContent = `命中 −${event.damage}`;
          }
          if (event.kind === 'block') {
            this.audio.collision(0.2);
            this.hitFlash = 0.12;
            this.view?.hit(event.seat, true);
            this.element.querySelector<HTMLElement>('[data-fight-hit]')!.textContent = '格挡';
          }
          if (event.kind === 'skillHit') {
            this.audio.collision(0.7);
            this.hitFlash = 0.18;
            this.view?.skillHit(event.skill ?? 'ball', event.x ?? 0, event.y ?? 0);
            this.view?.impactLinger(event.skill ?? 'ball', event.x ?? 0, event.y ?? 0, event.projectileId);
            this.element.querySelector<HTMLElement>('[data-fight-hit]')!.textContent = `技能命中 −${event.damage}`;
            if (event.skill === 'dog') {
              this.audio.dagouBark();
              this.broadcastTimer = Math.min(this.broadcastTimer, 0.45);
              this.hitFlash = 0.3;
            }
          }
          if (event.kind === 'down') {
            this.audio.punch(0.95);
            this.hitFlash = 0.24;
            // Skill knockdowns already burst in skillHit; melee knockdowns get their own slash burst.
            if (!event.skill) this.view?.knockdown(event.x ?? 0, event.y ?? 0);
            this.element.querySelector<HTMLElement>('[data-fight-hit]')!.textContent = `打倒 −${event.damage}`;
          }
        }
        this.accumulator -= STEP;
        if (this.sim.winner !== null) { this.clearInput(); break; }
      }
    }
    if (this.preview && !this.paused) this.previewTime += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.broadcastHold) this.pulses.clear();
    if (this.broadcastTimer > 0) {
      // 播报层与暂停时长按墙钟计时：低帧率下也恰好显示到动画结束再继续对局。
      this.broadcastTimer -= wallDt;
    }
    // 验收定格会把播报动画暂停；恢复播放前不隐藏、不解除冻结。
    if (this.broadcastHold && this.broadcastTimer <= 0 && !this.broadcastAnimationsPaused()) this.hideBroadcast();
    if (this.duel && this.sim.winner !== null && this.duelTimer < 0) this.duelTimer = 2.4;
    if (this.duelTimer > 0 && !this.paused) {
      this.duelTimer -= wallDt;
      if (this.duelTimer <= 0) { this.finishDuel(); return; }
    }
    this.element.querySelector<HTMLElement>('[data-fight-hit]')!.style.opacity = this.hitFlash > 0 ? '1' : '0';
    this.view?.render(this.sim.fighters, this.sim.projectiles, this.paused || this.broadcastHold ? 0 : dt, this.preview, this.previewTime, this.mirrored);
    this.updateHud();
    this.frame = requestAnimationFrame(t => this.loop(t));
  }

  private updateHud(): void {
    this.element.dataset.ready = String(this.ready);
    this.sim.fighters.forEach((fighter, seat) => {
      const fill = this.element.querySelector<HTMLElement>(`[data-hp="${seat}"]`)!;
      fill.style.transform = `scaleX(${fighter.hp / MAX_HP})`;
      fill.parentElement!.setAttribute('aria-valuenow', String(fighter.hp));
      fill.parentElement!.setAttribute('aria-valuemax', String(MAX_HP));
      this.element.querySelector(`[data-hp-label="${seat}"]`)!.textContent = `${fighter.hp} / ${MAX_HP}`;
      const rageFill = this.element.querySelector<HTMLElement>(`[data-rage="${seat}"]`)!;
      rageFill.style.transform = `scaleX(${fighter.rage / 100})`;
      rageFill.parentElement!.setAttribute('aria-valuenow', String(fighter.rage));
      rageFill.parentElement!.classList.toggle('full', fighter.rage >= 100);
      this.element.querySelector(`[data-rage-label="${seat}"]`)!.textContent = fighter.rage >= 100 ? '怒气全满 · 按4放大招' : `怒气 ${fighter.rage}%`;
      this.element.querySelector(`[data-action="${seat}"]`)!.textContent = this.preview ? ACTION_NAMES[this.preview] : ACTION_NAMES[fighter.action];
    });
    const combo = this.sim.fighters[0].combo;
    const comboEl = this.element.querySelector<HTMLElement>('[data-fight-combo]')!;
    comboEl.hidden = this.preview !== null || combo < 2;
    this.element.querySelector('[data-combo-count]')!.textContent = `×${combo}`;
    comboEl.classList.toggle('hot', combo >= 5);
    const cooldowns = this.sim.skillCooldowns[0];
    for (const skill of SKILL_ORDER) {
      const button = this.element.querySelector<HTMLButtonElement>(`[data-skill="${skill}"]`);
      const label = this.element.querySelector<HTMLElement>(`[data-skill-cd="${skill}"]`);
      const cooldown = cooldowns[skill];
      const rageLocked = skill === 'dog' && this.sim.fighters[0].rage < 100;
      const disabled = !this.ready || this.paused || !!this.preview || this.sim.winner !== null || cooldown > 0.05 || rageLocked;
      if (button) {
        button.disabled = disabled;
        button.classList.toggle('cooling', cooldown > 0.05);
        button.classList.toggle('rage-ready', skill === 'dog' && !rageLocked && this.ready);
      }
      if (label) label.textContent = cooldown > 0.05 ? `${cooldown.toFixed(1)}s` : rageLocked ? `怒气 ${this.sim.fighters[0].rage}%` : '就绪';
    }
    this.element.querySelector('[data-fight-clock]')!.textContent = this.preview ? '预览' : String(Math.ceil(this.sim.timeLeft)).padStart(2, '0');
    this.element.querySelector('[data-fight-pause]')!.textContent = this.paused ? '继续' : '暂停';
    const training = this.element.querySelector('[data-fight-training]')!;
    training.textContent = this.training ? '电脑：木桩' : '电脑：对战'; training.setAttribute('aria-pressed', String(this.training));
    this.element.querySelector('[data-fight-mute]')!.textContent = this.audio.getSettings().muted ? '声音：关' : '声音：开';
    if (!this.ready) return;
    const center = this.element.querySelector<HTMLElement>('[data-fight-center]')!;
    const winner = this.sim.winner;
    const baseText = winner !== null ? winner === 'draw' ? '平局' : winner === 0 ? '你赢了' : '本局落败' : this.paused && !this.dialog.isOpen ? '已暂停' : '';
    const text = this.duel && winner !== null
      ? winner === 'draw' ? '决斗平局' : winner === 0 ? '决斗胜利' : '决斗落败'
      : baseText;
    const help = this.duel && winner !== null
      ? winner === 'draw' ? '即将返回球局继续对局…' : '即将返回球局并宣布台球比赛胜者…'
      : winner !== null ? '按 R 或点击「重新开始」再战一局' : '按 Esc 或点击「继续」恢复';
    center.hidden = !text;
    if (center.dataset.text !== text) { center.innerHTML = `<b>${text}</b><span>${help}</span>`; center.dataset.text = text; }
  }

  private finishDuel(): void {
    if (!this.duel || this.duelResultSent) return;
    this.duelResultSent = true;
    const winner = this.sim.winner;
    const result: DuelResult = winner === 0 ? 'win0' : winner === 1 ? 'win1' : 'draw';
    this.dispose();
    this.duel.onResult(result);
  }

  private exit(): void {
    const duel = this.duel;
    const sendAbort = duel !== null && !this.duelResultSent;
    if (duel) this.duelResultSent = true;
    this.dispose();
    if (duel) { if (sendAbort) duel.onResult('abort'); }
    else this.onExit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort(); cancelAnimationFrame(this.frame);
    this.clearInput(); this.audio.stopSfx(); this.audio.stopFightMusic(); this.dialog.close();
    this.view?.dispose(); this.element.remove();
    if (window.__cueFight === this.debug) delete window.__cueFight;
  }
}
