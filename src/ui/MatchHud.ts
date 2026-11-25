import type { BallGroup, GamePhase, MatchMode, Seat } from '../app/matchTypes';
import type { SkillDefinition, SkillInstance } from '../skills/skillTypes';
import { MIN_SHOT_POWER } from '../view/charge';
import { SkillBar } from './SkillBar';
import { SpinFace } from './SpinFace';
import { groupBallIds, turnTargetText } from './ballStatus';

const BALL_COLORS = ['#ffffff', '#dbac25', '#3054a0', '#bb3b35', '#714888', '#d47a28', '#287154', '#81382f', '#252525'];
function ballBadge(id: number, done = false): string {
  const color = BALL_COLORS[id > 8 ? id - 8 : id] ?? '#252525';
  const label = id === 0 ? '白球洗袋（复位后移除）' : `${id}号${id === 8 ? '黑球' : id > 8 ? '花色球' : '全色球'}`;
  return `<span class="numbered-ball ${id > 8 ? 'striped' : ''} ${done ? 'potted' : ''}" style="--ball-color:${color}" data-ball-id="${id}" title="${label}${done ? ' · 已入袋' : ''}" aria-label="${label}${done ? '，已入袋' : ''}"><span>${id === 0 ? '白' : id}</span></span>`;
}

export interface HudModel {
  mode: MatchMode;
  phase: GamePhase;
  currentSeat: Seat;
  groups: [BallGroup | null, BallGroup | null];
  remaining: [number, number];
  pocketed: number[];
  solo: boolean;
  isBreak: boolean;
  message: string;
  elapsedSeconds: number;
  shotNumber: number;
  power: number;
  spin: { x: number; y: number };
  charging: boolean;
  locked: boolean;
  canStrike: boolean;
  canUseSkills: [boolean, boolean];
  skills: [SkillInstance[], SkillInstance[]];
  catalog: SkillDefinition[];
  eligible: (seat: Seat, instance: SkillInstance) => boolean;
}

/** Corner-anchored HUD: panels hug the four corners so the table stays clear. */
export class MatchHud {
  readonly element = document.createElement('div');
  private skillBar: SkillBar;
  private spinFace: SpinFace;
  private toastTimer = 0;
  private lastSkillKey = '';
  private lastBallKey = '';
  private groupTimer = 0;
  private skillTimer = 0;

  constructor(callbacks: {
    onSkill: (seat: Seat, instanceId: string) => void;
    onPower: (power: number) => void;
    onSpin: (x: number, y: number) => void;
    onStrike: () => void;
    onCamera: () => void;
    onPause: () => void;
    onSettings: () => void;
    onPlaylist: () => void;
    onMute: () => void;
    onExit: () => void;
  }) {
    this.element.className = 'hud hidden';
    this.element.innerHTML = `
      <header class="topbar">
        <div class="topbar-row row-main">
          <div class="brand panel"><div class="brand-mark">8</div><div><strong>库边秘技</strong><small>CREATIVE EIGHT</small></div></div>
          <div class="turn-chip panel"><span class="eyebrow">TABLE STATUS</span><b class="status-title" data-status-title>轮到甲方</b></div>
          <div class="scoreboard panel"><div class="player" data-player="0"><div class="player-line"><span class="player-name">甲方 · 青</span><span class="turn-tag">击球中</span></div><div class="player-meta" data-meta="0">开放球台</div><div class="ball-dots" data-dots="0"></div></div><div class="player" data-player="1"><div class="player-line"><span class="player-name">乙方 · 绯</span><span class="turn-tag">击球中</span></div><div class="player-meta" data-meta="1">开放球台</div><div class="ball-dots" data-dots="1"></div></div></div>
          <div class="topbar-spacer"></div>
          <div class="status-stats panel"><span class="stat"><small>规则</small><b data-mode data-rule>创意中八</b></span><span class="stat"><small>用时</small><b data-time>00:00</b></span><span class="stat"><small>杆数</small><b data-shots>0</b></span></div>
          <div class="status-actions"><button class="icon-button" data-playlist-open title="选择背景音乐与控制播放">歌单</button><button class="icon-button" data-mute aria-pressed="false" title="静音 / 取消静音">有声</button><button class="icon-button" data-settings title="音量与显示设置">设置</button><button class="icon-button" data-pause title="暂停 / 继续">暂停</button><button class="icon-button" data-exit title="退出当前对局，返回主菜单" aria-label="退出对局">退出</button></div>
        </div>
        <div class="topbar-row row-sub">
          <p class="status-copy panel" data-message>移动鼠标瞄准，按住左键向后拖动蓄力，松开击球。</p>
          <div class="sub-center">
            <div class="skillstrip panel"><span class="strip-label">本局秘技</span><div class="strip-cards" data-skills="0"></div><div class="opponent-skills" data-opponent><span class="strip-label">对手秘技</span><div class="strip-cards" data-skills="1"></div></div></div>
            <button class="icon-button hint-toggle" data-hints aria-pressed="false" title="展开 / 收起键位提示">展开</button>
          </div>
          <div class="sub-spacer"></div>
        </div>
        <div class="ball-status-row">
          <p class="turn-target" data-turn-target role="status" aria-live="polite"></p>
          <section class="pocket-tray" aria-label="已入袋球" title="实时显示袋内球；白球或目标球复位后从列表移除，不受分球状态影响">
            <strong>已入袋 <span data-pocket-count>0</span></strong>
            <div class="pocket-balls" data-pocketed aria-live="polite"><span class="pocket-empty">尚无进球</span></div>
          </section>
        </div>
        <p class="group-announcement hidden" data-group-announcement role="status" aria-live="polite" aria-atomic="true"></p>
        <aside class="key-hints panel collapsed"><div class="skills-head"><h2>按键提示</h2><span>收起时不遮挡球桌</span></div><ul class="hint-list" data-hint-list>
          <li><b>鼠标移动</b><span>瞄准（360°）· Alt 精调</span></li>
          <li><b>左键后拖</b><span>蓄力，松开击球 · 拖越远力越大</span></li>
          <li><b>右键单击</b><span>锁定 / 解锁球杆 · 锁定后瞄准不再跟随鼠标</span></li>
          <li><b>击球点球面</b><span>点击 / 拖动左下白球面加塞 · 高杆跟进 · 低杆回撤 · 回中复位</span></li>
          <li><b>滚轮</b><span>微调瞄准 · Shift+滚轮 推拉视角</span></li>
          <li><b>Esc</b><span>取消蓄力，不击球</span></li>
          <li><b>点击目标球</b><span>球杆自动指向该球</span></li>
          <li><b>←→↑↓ / WASD</b><span>瞄准 / 杆法 · Shift+方向 侧旋</span></li>
          <li><b>摆球</b><span>拖动白球 · WASD 微调 · Space / Enter 确定</span></li>
          <li><b>击球按钮</b><span>点击按当前力度击球 · Enter 亦可</span></li>
          <li><b>C / O / Z · 1–6 / 7</b><span>镜头切换 / 参数快调与复位</span></li>
          <li><b>右键拖动</b><span>环绕视角</span></li>
        </ul></aside>
      </header>
      <div class="corner bottom-left">
        <div class="controls panel"><div class="control-group camera-controls"><button class="icon-button active" data-camera title="切换顶视 / 环绕 / 击球镜头">镜头 C</button></div><div class="control-group spin-group"><span class="control-label" data-spin-label>杆法</span><div data-spin-mount></div></div><div class="control-group power-wrap"><span class="control-label">力度</span><input type="range" min="2" max="100" step="1" value="56" data-power aria-label="击球力度"><span class="power-number" data-power-number>56</span></div><button class="strike" data-strike>击球 <small>或左键后拖蓄力，松开击球</small></button></div>
      </div>`;
    this.skillBar = new SkillBar(callbacks.onSkill);
    // Round 13: the slider floor follows MIN_SHOT_POWER (the old hardcoded min="8"
    // stranded the round-12 minimum 0.04 out of reach). With max=100 and an
    // explicit step="1" every notch is an even 1% = 0.1 m/s at MAX_SHOT_SPEED 10,
    // so power is distributed uniformly from the softest tap to the hardest break.
    // step is written in the markup because input.step reflects the attribute and
    // reads "" when it is absent, even though the browser default step is 1.
    const powerSlider = this.element.querySelector<HTMLInputElement>('[data-power]')!;
    powerSlider.min = String(Math.round(MIN_SHOT_POWER * 100));
    powerSlider.addEventListener('input', event => callbacks.onPower(Number((event.target as HTMLInputElement).value) / 100));
    this.spinFace = new SpinFace(callbacks.onSpin);
    this.element.querySelector('[data-spin-mount]')!.appendChild(this.spinFace.element);
    const strikeButton = this.element.querySelector<HTMLButtonElement>('[data-strike]')!;
    strikeButton.addEventListener('click', callbacks.onStrike);
    for (const name of ['keydown', 'keyup'] as const) {
      strikeButton.addEventListener(name, event => {
        // A leftover focus must not turn Space into a shot via native click.
        // Keep mouse clicks and native Enter activation available.
        if (event.code === 'Space') event.preventDefault();
      });
    }
    this.element.querySelector('[data-camera]')!.addEventListener('click', callbacks.onCamera);
    this.element.querySelector('[data-pause]')!.addEventListener('click', callbacks.onPause);
    const exitButton = this.element.querySelector<HTMLButtonElement>('[data-exit]')!;
    exitButton.addEventListener('click', callbacks.onExit);
    for (const name of ['keydown', 'keyup'] as const) {
      exitButton.addEventListener(name, event => event.stopPropagation());
    }
    this.element.querySelector('[data-settings]')!.addEventListener('click', callbacks.onSettings);
    const playlistButton = this.element.querySelector<HTMLButtonElement>('[data-playlist-open]')!;
    playlistButton.addEventListener('click', callbacks.onPlaylist);
    for (const name of ['keydown', 'keyup'] as const) {
      playlistButton.addEventListener(name, event => {
        if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
      });
    }
    this.element.querySelector('[data-mute]')!.addEventListener('click', callbacks.onMute);
    const hintToggle = this.element.querySelector<HTMLButtonElement>('[data-hints]')!;
    hintToggle.addEventListener('click', () => {
      const panel = this.element.querySelector<HTMLElement>('.key-hints')!;
      const collapsed = panel.classList.toggle('collapsed');
      hintToggle.textContent = collapsed ? '展开' : '收起';
      hintToggle.setAttribute('aria-pressed', String(!collapsed));
    });
  }

  setMuted(muted: boolean): void {
    const button = this.element.querySelector<HTMLButtonElement>('[data-mute]')!;
    button.textContent = muted ? '已静音' : '有声';
    button.setAttribute('aria-pressed', String(muted));
    button.classList.toggle('active', !muted);
  }

  setPaused(paused: boolean): void {
    const button = this.element.querySelector<HTMLButtonElement>('[data-pause]')!;
    button.textContent = paused ? '继续' : '暂停';
    button.setAttribute('aria-pressed', String(paused));
  }

  update(model: HudModel): void {
    const text = (selector: string, value: string): void => { const element = this.element.querySelector<HTMLElement>(selector); if (element && element.textContent !== value) element.textContent = value; };
    text('[data-mode]', model.mode === 'creative' ? '创意中八' : '经典中八');
    const minutes = Math.floor(model.elapsedSeconds / 60);
    const seconds = Math.floor(model.elapsedSeconds % 60);
    text('[data-time]', `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`);
    text('[data-shots]', String(model.shotNumber));
    text('[data-status-title]', model.phase === 'breakPlacement' ? '开球摆位' : model.phase === 'ballInHand' ? '自由球' : model.phase === 'rolling' ? '球体运动中' : `轮到${model.currentSeat === 0 ? '甲方' : '乙方'}`);
    text('[data-message]', model.message);
    text('[data-power-number]', String(Math.round(model.power * 100)));
    const strike = this.element.querySelector<HTMLButtonElement>('[data-strike]')!;
    strike.disabled = !model.canStrike;
    strike.classList.toggle('charging', model.charging);
    strike.innerHTML = model.charging ? '蓄力中… <small>松开左键击球 · Esc 取消</small>' : '击球 <small>或左键后拖蓄力，松开击球</small>';
    // 力度条始终跟随权威力度（含开球自动补力/还原），不再只在蓄力时同步。
    this.element.querySelector<HTMLInputElement>('[data-power]')!.value = String(Math.round(model.power * 100));
    text('[data-spin-label]', model.locked ? '杆法 · 已锁定' : '杆法');
    this.spinFace.update(model.spin, model.locked);
    for (const seat of [0, 1] as Seat[]) {
      this.element.querySelector(`[data-player="${seat}"]`)!.classList.toggle('active', model.currentSeat === seat);
      const group = model.groups[seat];
      text(`[data-meta="${seat}"]`, group ? `${group === 'solids' ? '全色球 1–7' : '花色球 9–15'} · 剩 ${model.remaining[seat]} 颗` : '开放球台');
    }
    text('[data-turn-target]', model.phase === 'gameOver' ? '本局已结束' : turnTargetText(model.currentSeat, model.groups[model.currentSeat], model.remaining[model.currentSeat], model.solo, model.isBreak));
    const ballKey = JSON.stringify([model.groups, model.pocketed]);
    if (ballKey !== this.lastBallKey) {
      this.lastBallKey = ballKey;
      text('[data-pocket-count]', String(model.pocketed.length));
      this.element.querySelector('[data-pocketed]')!.innerHTML = model.pocketed.length
        ? model.pocketed.map(id => ballBadge(id)).join('')
        : '<span class="pocket-empty">尚无进球</span>';
      for (const seat of [0, 1] as Seat[]) {
        const group = model.groups[seat];
        this.element.querySelector(`[data-dots="${seat}"]`)!.innerHTML = group
          ? groupBallIds(group).map(id => ballBadge(id, model.pocketed.includes(id))).join('')
          : '<span class="unassigned-balls">尚未分球</span>';
      }
    }
    const key = JSON.stringify([model.skills, model.canUseSkills, model.phase, model.currentSeat]);
    if (key !== this.lastSkillKey) {
      this.lastSkillKey = key;
      for (const seat of [0, 1] as Seat[]) this.skillBar.render(this.element.querySelector(`[data-skills="${seat}"]`)!, seat, model.skills[seat], model.catalog, model.canUseSkills[seat], instance => model.eligible(seat, instance));
    }
    this.element.querySelector<HTMLElement>('[data-opponent]')!.style.display = model.mode === 'creative' ? '' : 'none';
  }

  announceGroups(message: string): void {
    window.clearTimeout(this.groupTimer);
    const banner = this.element.querySelector<HTMLElement>('[data-group-announcement]')!;
    banner.textContent = message;
    banner.classList.remove('hidden');
    this.groupTimer = window.setTimeout(() => banner.classList.add('hidden'), 6500);
  }

  resetGroupAnnouncement(): void {
    window.clearTimeout(this.groupTimer);
    const banner = this.element.querySelector<HTMLElement>('[data-group-announcement]')!;
    banner.classList.add('hidden');
    banner.textContent = '';
  }

  toast(message: string): void {
    window.clearTimeout(this.toastTimer);
    document.querySelector('.toast')?.remove();
    const element = document.createElement('div');
    element.className = 'toast';
    element.textContent = message;
    document.body.appendChild(element);
    this.toastTimer = window.setTimeout(() => element.remove(), 2800);
  }

  /** Fullscreen, non-interactive banner announcing who used which skill.
   * Deliberately not used for 假自由球 so the bluff stays hidden. */
  announceSkill(seat: Seat, skillName: string): void {
    window.clearTimeout(this.skillTimer);
    document.querySelector('.skill-announce')?.remove();
    const element = document.createElement('div');
    element.className = 'skill-announce';
    element.innerHTML = `<span class="skill-announce-seat">${seat === 0 ? '甲方 · 青' : '乙方 · 绯'}</span><strong>使用了「${skillName}」</strong>`;
    document.body.appendChild(element);
    this.skillTimer = window.setTimeout(() => element.remove(), 2200);
  }

  clearTransient(): void {
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.skillTimer);
    this.resetGroupAnnouncement();
    document.querySelectorAll('.toast, .skill-announce, .winner-overlay').forEach(element => element.remove());
  }

  showWinner(winner: Seat, onRestart: () => void, onMenu: () => void, detail: { reason: string; glyph: string } = { reason: '最后一颗 8 号球已经落袋，本局对局结束。', glyph: '8' }): void {
    const overlay = document.createElement('div');
    overlay.className = 'overlay winner-overlay';
    overlay.innerHTML = `<section class="dialog winner"><div class="winner-number">${detail.glyph}</div><div class="eyebrow">MATCH COMPLETE</div><h2>${winner === 0 ? '甲方' : '乙方'}获胜</h2><p>${detail.reason}</p><div class="winner-actions"><button class="primary" data-restart>再来一局</button><button class="secondary" data-menu>返回主菜单</button></div></section>`;
    overlay.querySelector('[data-restart]')!.addEventListener('click', () => { overlay.remove(); onRestart(); });
    overlay.querySelector('[data-menu]')!.addEventListener('click', () => { overlay.remove(); onMenu(); });
    document.body.appendChild(overlay);
  }
}