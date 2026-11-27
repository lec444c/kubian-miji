import { SeededRng } from '../core/random/SeededRng';
import { MatchClock } from '../core/time/MatchClock';
import { Simulation } from '../sim/Simulation';
import { createRackedSimulation } from '../sim/rack';
import { BALL_RADIUS, CUSHION_HALF_X, CUSHION_HALF_Y, FIXED_DT, POCKETS, POCKET_RADIUS, distance, type Vec2 } from '../sim/SimulationState';
import { PRESENTATION_TIME_SCALE } from './presentation';
import type { ShotOutcome } from '../sim/ShotOutcome';
import {
  cloneRuleState, createInitialRuleState, isLegalTarget, prepareShot, remainingGroupBalls,
  resolveChineseEight, respotEightBall, respotBallsOnTable, type RuleContext, type RuleState,
} from '../rules/ruleTypes';
import { planShot } from '../ai/shotPlanner';
import { clampPlacement, stepPlacement, clampBreakPlacement, stepBreakPlacement, HEAD_STRING_X } from '../rules/placement';
import { SceneView } from '../view/SceneView';
import { InputController } from '../view/InputController';
import { AudioEffects } from '../view/AudioEffects';
import { MIN_SHOT_POWER } from '../view/charge';
import type { CameraMode } from '../view/CameraController';
import { MainMenu } from '../ui/MainMenu';
import { FightMode } from '../fight/FightMode';
import { MatchHud } from '../ui/MatchHud';
import { groupAssignmentText, pocketedBallIds } from '../ui/ballStatus';
import { DraftDialog } from '../ui/DraftDialog';
import { SettingsDialog, type SettingsState } from '../ui/SettingsDialog';
import { ExitDialog } from '../ui/ExitDialog';
import { SKILL_CATALOG, SKILL_IDS, createSkillInstance } from '../skills/skillCatalog';
import { drawUniqueCandidates } from '../skills/skillDraft';
import { SkillMachine, consumeSkillInstance } from '../skills/skillMachine';
import { getHandCandidates, createHandAdjustment, commitHandAdjustment } from '../skills/handMicroAdjustment';
import { createHairdryerEffect, getHairdryerCandidates, HAIRDRYER_DURATION_MS } from '../skills/hairdryer';
import { FakeFreeBallMachine, type FakeFreeBallResolution } from '../skills/fakeFreeBall';
import {
  ENHANCED_ENGLISH_MULTIPLIER,
  LUCKY_POCKET_RADIUS_BONUS,
  neutralShotEnhancements,
  type ShotEnhancements,
} from '../skills/shotEnhancements';
import type { SkillId, SkillInstance } from '../skills/skillTypes';
import { otherSeat, seatName, type GamePhase, type MatchSetup, type Seat } from './matchTypes';
import type { DebugApi } from './debugTypes';

interface TargetingState {
  seat: Seat;
  instanceId: string;
  skillId: SkillId;
  returnPhase: GamePhase;
}

interface FakeState {
  machine: FakeFreeBallMachine;
  owner: Seat;
  opponent: Seat;
  aiActed: boolean;
}

interface DraftState { seat: Seat; overtime: boolean; candidates: SkillId[] }

/** A contact point must stay on the ball face: clamp into the unit disc so a
 * diagonal click can never command more than the miscue limit. */
function clampSpinToFace(x: number, y: number): { x: number; y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const length = Math.hypot(x, y);
  if (length <= 1) return { x, y };
  return { x: x / length, y: y / length };
}

export class GameController {
  private view: SceneView;
  private hud: MatchHud;
  private menu: MainMenu;
  private draftDialog: DraftDialog;
  private settingsDialog: SettingsDialog;
  private exitDialog: ExitDialog;
  private input: InputController;
  private pausedBeforeExit = false;
  private fightMode: FightMode | null = null;
  private audio = new AudioEffects();
  private sceneHost: HTMLElement;
  private simulation = createRackedSimulation(1);
  private rule: RuleState = createInitialRuleState();
  private clock = new MatchClock();
  private rng = new SeededRng(1);
  private setup: MatchSetup = { mode: 'creative', playMode: 'solo', difficulty: 'normal', seed: 1 };
  private phase: GamePhase = 'menu';
  private human = { angle: 0, power: 0.56, spin: { x: 0, y: 0 } };
  private machines: [SkillMachine, SkillMachine] = [new SkillMachine(), new SkillMachine()];
  private enhancements: [ShotEnhancements, ShotEnhancements] = [neutralShotEnhancements(), neutralShotEnhancements()];
  private targeting: TargetingState | null = null;
  private fake: FakeState | null = null;
  private fakeShotResolution: FakeFreeBallResolution | null = null;
  private shotContext: RuleContext | null = null;
  private resolvedShots = new Set<number>();
  private draft: DraftState | null = null;
  private paused = false;
  private message = '移动鼠标瞄准，按住左键向后拖动蓄力，松开击球；摆位用 Space / Enter 确认。';
  private revision = 0;
  private skillSequence = 0;
  private lastFrame = performance.now();
  private accumulator = 0;
  private lastHudUpdate = 0;
  private aiReadyAt = 0;
  private aiRollingSkillAttempted = false;
  private aiHandAttemptKey = '';
  private handAnimating = false;
  private charging = false;
  /** Round 7: left-drag pull-back charge (power proportional to drag distance). */
  private dragCharging = false;
  /** Round 7: right-click toggles this; while locked all aim inputs freeze so
   * the spin panel can be clicked without moving the cue. */
  private cueLocked = false;
  private placement: Vec2 | null = null;
  private hairdryerAudible = false;
  private targetBanner: HTMLElement;

  constructor(private root: HTMLElement) {
    this.root.innerHTML = '<div id="game-shell"><div id="scene"></div><div class="vignette"></div></div>';
    this.sceneHost = this.root.querySelector('#scene')!;
    this.view = new SceneView(this.sceneHost);
    this.hud = new MatchHud({
      onSkill: (seat, instanceId) => void this.useSkill(seat, instanceId),
      onPower: power => { this.cancelCharge(); this.human.power = Math.max(MIN_SHOT_POWER, Math.min(1, power)); },
      onSpin: (x, y) => { this.human.spin = clampSpinToFace(x, y); },
      onStrike: () => this.humanStrike(),
      onReposition: () => this.repositionCueBall(),
      onCamera: () => this.cycleCamera(),
      onPause: () => this.togglePause(),
      onSettings: () => { this.cancelCharge(); this.settingsDialog.open(this.settingsState()); },
      onPlaylist: () => { this.cancelCharge(); this.settingsDialog.open(this.settingsState(), true); },
      onMute: () => this.toggleMute(),
      onExit: () => this.requestExit(),
    });
    this.hud.setMuted(this.audio.getSettings().muted);
    this.root.querySelector('#game-shell')!.appendChild(this.hud.element);
    this.settingsDialog = new SettingsDialog({
      onMusicVolume: volume => { this.audio.setMusicVolume(volume); this.settingsDialog.sync(this.settingsState()); },
      onSelectTrack: index => this.audio.selectTrack(index),
      onNextTrack: () => this.audio.nextTrack(),
      onToggleMusic: () => this.audio.toggleMusic(),
      onSfxVolume: volume => { this.audio.setSfxVolume(volume); },
      onMute: muted => { this.audio.setMuted(muted); this.hud.setMuted(muted); this.settingsDialog.sync(this.settingsState()); },
      onMotion: () => {
        this.view.reducedMotion = !this.view.reducedMotion;
        this.settingsDialog.sync(this.settingsState());
      },
      onQuality: () => {
        this.view.setQuality(!this.view.lowQuality);
        this.settingsDialog.sync(this.settingsState());
      },
    });
    this.root.querySelector('#game-shell')!.appendChild(this.settingsDialog.element);
    this.audio.subscribeMusic(state => this.settingsDialog.syncMusic(state));
    this.exitDialog = new ExitDialog(() => this.returnToMenu(), () => this.cancelExit());
    this.root.querySelector('#game-shell')!.appendChild(this.exitDialog.element);
    this.draftDialog = new DraftDialog(ids => this.confirmDraft(ids), () => this.requestExit());
    this.root.querySelector('#game-shell')!.appendChild(this.draftDialog.element);
    this.menu = new MainMenu(setup => this.start(setup), () => this.startFight());
    this.root.querySelector('#game-shell')!.appendChild(this.menu.element);
    this.targetBanner = document.createElement('div');
    this.targetBanner.className = 'target-banner hidden';
    this.root.querySelector('#game-shell')!.appendChild(this.targetBanner);
    this.input = new InputController(this.view, {
      onAim: point => this.aimAt(point),
      onTableClick: point => this.tableClick(point),
      onBallClick: ballId => void this.ballClick(ballId),
      onChargeCancel: () => this.cancelChargeWithFeedback(),
      onCamera: () => this.cycleCamera(),
      onNudgeAim: delta => {
        if (this.phase === 'aiming' && this.canHumanStrike() && !this.cueLocked) this.human.angle += delta;
      },
      onFineAim: delta => {
        if (this.phase === 'aiming' && this.canHumanStrike() && !this.cueLocked) this.human.angle += delta;
      },
      onToggleLock: () => this.toggleCueLock(),
      cueLocked: () => this.cueLocked && this.phase === 'aiming',
      strikeBackDirection: () => this.strikeBackDirection(),
      onStrikeDragStart: () => this.beginDragCharge(),
      onStrikeDrag: power => { if (this.dragCharging) this.human.power = Math.max(MIN_SHOT_POWER, Math.min(1, power)); },
      onStrikeDragEnd: strike => this.endDragCharge(strike),
      onNudgeSpin: (x, y) => {
        if (this.phase !== 'aiming' || !this.canHumanStrike()) return;
        this.human.spin = clampSpinToFace(this.human.spin.x + x, this.human.spin.y + y);
      },
      onKeyMove: (dx, dy, fine) => this.keyMove(dx, dy, fine),
      onPlaceConfirm: () => this.confirmPlacement(),
      placingActive: () => this.isPlacementPhase() && this.isHumanSeat(this.rule.currentPlayer) && !this.paused && !this.targeting && !this.handAnimating,
      onPlaceDrag: point => {
        if (!this.isPlacementPhase() || !this.isHumanSeat(this.rule.currentPlayer) || this.paused || this.targeting || this.handAnimating) return;
        this.placement = this.phase === 'breakPlacement' ? clampBreakPlacement(point) : clampPlacement(point);
      },
    });
    window.addEventListener('resize', () => this.view.resize());
    // Browsers require a user gesture before audio may start; sound is on by
    // default and the HUD mute button silences everything in one action.
    window.addEventListener('pointerdown', () => this.audio.unlock());
    window.addEventListener('keydown', () => this.audio.unlock());
    this.attachAudioEvents();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase !== 'menu' && !this.paused) {
        this.paused = true;
        this.clock.setRunning(false);
        this.hud.toast('页面已隐藏，对局自动暂停');
      } else if (!document.hidden && this.paused) {
        this.hud.toast('对局仍处于暂停状态，点击右上角继续');
      }
    });
    this.view.syncSimulation(this.simulation.getSnapshot());
    requestAnimationFrame(time => this.loop(time));
  }

  private attachAudioEvents(): void {
    this.simulation.onEvent = event => {
      if (event.kind === 'ballHit') this.audio.collision(event.strength);
      else if (event.kind === 'cushion') this.audio.cushion(event.strength);
      else this.audio.pocket();
    };
  }

  /** Invalidate awaited skills before cancelling their visual animation. */
  private clearMatchTransients(): void {
    this.revision += 1;
    this.clock.setRunning(false);
    this.cancelCharge();
    this.input.reset();
    this.view.resetTransientEffects();
    this.audio.stopSfx();
    this.hairdryerAudible = false;
    this.handAnimating = false;
    this.cueLocked = false;
    this.placement = null;
    this.cueReplacementAvailable = null;
    this.targeting = null;
    this.enhancements = [neutralShotEnhancements(), neutralShotEnhancements()];
    this.fake = null;
    this.fakeShotResolution = null;
    this.shotContext = null;
    this.draft = null;
    this.resolvedShots.clear();
    this.aiReadyAt = Number.POSITIVE_INFINITY;
    this.aiRollingSkillAttempted = false;
    this.aiHandAttemptKey = '';
    this.accumulator = 0;
    this.breakPowerRestore = null;
    this.hideTargetBanner();
    this.settingsDialog.close(false);
    this.draftDialog.hide();
    this.exitDialog.close();
    this.hud.clearTransient();
  }

  private requestExit(): void {
    if (this.phase === 'menu' || this.exitDialog.isOpen) return;
    this.pausedBeforeExit = this.paused;
    this.paused = true;
    this.clock.setRunning(false);
    this.cancelCharge();
    this.input.reset();
    this.exitDialog.open();
    this.updateHud();
  }

  private cancelExit(): void {
    this.paused = this.pausedBeforeExit || document.hidden;
    this.clock.setRunning(!this.paused && this.phase !== 'draft' && this.phase !== 'menu' && this.phase !== 'gameOver');
    this.updateHud();
  }

  private returnToMenu(): void {
    this.clearMatchTransients();
    this.phase = 'menu';
    this.paused = false;
    this.pausedBeforeExit = false;
    this.simulation = createRackedSimulation(1);
    this.rule = createInitialRuleState();
    this.clock = new MatchClock();
    this.machines = [new SkillMachine(), new SkillMachine()];
    this.human = { angle: 0, power: 0.56, spin: { x: 0, y: 0 } };
    this.view.setCameraPhase('other');
    this.view.setCamera('orbit');
    this.view.syncSimulation(this.simulation.getSnapshot());
    this.hud.element.classList.add('hidden');
    this.menu.element.classList.remove('hidden');
    this.menu.element.querySelector<HTMLButtonElement>('.start-button')!.focus();
  }

  private startFight(): void {
    if (this.fightMode || this.phase !== 'menu') return;
    this.clearMatchTransients();
    this.menu.element.classList.add('hidden');
    this.sceneHost.classList.add('hidden');
    this.audio.unlock();
    this.fightMode = new FightMode(this.root.querySelector<HTMLElement>('#game-shell')!, this.audio, () => {
      this.fightMode = null;
      this.sceneHost.classList.remove('hidden');
      this.input.reset();
      this.hud.setMuted(this.audio.getSettings().muted);
      this.settingsDialog.sync(this.settingsState());
      this.returnToMenu();
      this.view.resize();
      this.menu.element.querySelector<HTMLButtonElement>('[data-fight-entry]')!.focus();
    }, this.view.reducedMotion);
  }

  /** 创意中八「绅士决斗」：冻结球局，进入格斗；结果由 onResult 回到球局结算。 */
  private startDuel(): void {
    if (this.fightMode) return;
    this.audio.unlock();
    this.fightMode = new FightMode(this.root.querySelector<HTMLElement>('#game-shell')!, this.audio, () => {
      this.fightMode = null;
      this.returnToMenu();
    }, this.view.reducedMotion, { onResult: result => this.finishDuel(result) });
  }

  private finishDuel(result: 'win0' | 'win1' | 'draw' | 'abort'): void {
    this.fightMode = null;
    this.input.reset();
    this.view.resize();
    if (result === 'abort' || result === 'draw') {
      this.message = result === 'abort' ? '已放弃决斗，回到球局继续。' : '决斗平局，回到球局继续。';
      this.updateHud();
      return;
    }
    const winner: Seat = result === 'win0' ? 0 : 1;
    this.paused = false;
    this.rule.winner = winner;
    this.phase = 'gameOver';
    this.clock.setRunning(false);
    this.hud.showWinner(winner, () => this.start(this.setup), () => this.returnToMenu(), {
      reason: '绅士决斗胜出，直接赢下本场台球比赛。', glyph: '决',
    });
    this.updateHud();
  }

  start(setup: MatchSetup): void {
    if (this.fightMode) return;
    this.clearMatchTransients();
    this.setup = { ...setup };
    this.rng = new SeededRng(setup.seed ?? Date.now());
    this.simulation = createRackedSimulation(setup.seed ?? 1);
    this.attachAudioEvents();
    this.audio.unlock();
    this.audio.hairdryer(false);
    this.hairdryerAudible = false;
    this.rule = createInitialRuleState();
    this.hud.resetGroupAnnouncement();
    this.clock = new MatchClock();
    this.machines = [new SkillMachine(), new SkillMachine()];
    this.enhancements = [neutralShotEnhancements(), neutralShotEnhancements()];
    this.targeting = null;
    this.fake = null;
    this.fakeShotResolution = null;
    this.shotContext = null;
    this.resolvedShots.clear();
    this.draft = null;
    this.paused = false;
    this.handAnimating = false;
    this.cancelCharge();
    this.placement = null;
    this.accumulator = 0;
    this.aiRollingSkillAttempted = false;
    this.aiHandAttemptKey = '';
    this.human.angle = 0;
    this.human.spin = { x: 0, y: 0 };
    this.human.power = setup.mode === 'classic' ? 0.72 : 0.56;
    this.breakPowerRestore = null;
    this.message = '开球摆位：白球可在开球线后自由摆放。';
    this.menu.element.classList.add('hidden');
    this.hud.element.classList.remove('hidden');
    if (setup.mode === 'creative') this.beginDraftSequence(false);
    else {
      this.phase = 'breakPlacement';
      this.clock.setRunning(true);
      this.aiReadyAt = performance.now() + 900;
    }
    this.updateHud();
  }

  private beginDraftSequence(overtime: boolean): void {
    this.phase = 'draft';
    this.clock.setRunning(false);
    this.showDraftFor(0, overtime);
  }

  private showDraftFor(seat: Seat, overtime: boolean): void {
    const candidates = drawUniqueCandidates(SKILL_IDS, this.rng, overtime ? 2 : 7);
    this.draft = { seat, overtime, candidates };
    const canChoose = this.isHumanSeat(seat);
    if (!canChoose) {
      const count = overtime ? 1 : Math.min(3, candidates.length);
      const selected = this.rng.shuffle(candidates).slice(0, count);
      selected.forEach(skillId => this.addSkill(seat, skillId, overtime ? 'overtime' : 'opening'));
      this.advanceDraft();
      return;
    }
    const definitions = candidates.map(id => SKILL_CATALOG[id]);
    this.draftDialog.show(seatName(seat), definitions, overtime ? 1 : Math.min(3, definitions.length), overtime);
  }

  private confirmDraft(ids: string[]): void {
    if (!this.draft || this.phase !== 'draft') return;
    const valid = ids.filter((id): id is SkillId => SKILL_IDS.includes(id as SkillId) && this.draft!.candidates.includes(id as SkillId));
    const expected = this.draft.overtime ? 1 : Math.min(3, this.draft.candidates.length);
    if (valid.length !== expected) return;
    valid.forEach(skillId => this.addSkill(this.draft!.seat, skillId, this.draft!.overtime ? 'overtime' : 'opening'));
    this.advanceDraft();
  }

  private advanceDraft(): void {
    if (!this.draft) return;
    const { seat, overtime } = this.draft;
    if (seat === 0) {
      this.showDraftFor(1, overtime);
      return;
    }
    this.draft = null;
    if (overtime) this.clock.consumeOvertime();
    this.phase = this.phaseForTurn();
    this.clock.setRunning(true);
    this.aiReadyAt = performance.now() + 850;
    this.message = overtime ? '加时技能已加入双方库存，对局继续。' : '技能就绪。开球后首个合法入袋将确定球组。';
    this.updateHud();
  }

  private addSkill(seat: Seat, skillId: SkillId, source: 'opening' | 'overtime'): void {
    const instance = createSkillInstance(skillId, `${source}-s${seat}-${++this.skillSequence}-${skillId}`);
    instance.ownerSeat = seat;
    instance.source = source;
    this.machines[seat].addInstance(instance);
  }

  private isHumanSeat(seat: Seat): boolean { return this.setup.playMode === 'practice' || seat === 0; }
  /** Pre-break slider power, restored once the break shot resolves. */
  private breakPowerRestore: number | null = null;
  /** A confirmed ball-in-hand can be reopened until this turn actually shoots. */
  private cueReplacementAvailable: Seat | null = null;
  private isInteractivePhase(): boolean { return !this.paused && !this.handAnimating && (this.phase === 'aiming' || this.phase === 'ballInHand'); }
  private isPlacementPhase(): boolean { return this.phase === 'ballInHand' || this.phase === 'breakPlacement'; }
  /** Turn hand-off: free ball first, otherwise the break still needs placement. */
  private phaseForTurn(): GamePhase {
    if (this.rule.ballInHand) {
      this.cueReplacementAvailable = this.rule.currentPlayer;
      return 'ballInHand';
    }
    return this.rule.isBreak ? 'breakPlacement' : 'aiming';
  }

  private aimAt(point: Vec2): void {
    if (this.phase !== 'aiming' || !this.isInteractivePhase() || !this.isHumanSeat(this.rule.currentPlayer) || this.targeting) return;
    const cue = this.simulation.state.balls.find(ball => ball.id === 0);
    if (!cue?.onTable) return;
    const dx = point.x - cue.position.x;
    const dy = point.y - cue.position.y;
    if (Math.hypot(dx, dy) > 0.03) this.human.angle = Math.atan2(dy, dx);
  }

  private tableClick(point: Vec2): void {
    if (this.targeting || this.paused) return;
    if (this.isPlacementPhase() && this.isHumanSeat(this.rule.currentPlayer)) {
      // Clicking only moves the cursor; Space/Enter confirms the placement.
      this.placement = this.phase === 'breakPlacement' ? clampBreakPlacement(point) : clampPlacement(point);
      return;
    }
    this.aimAt(point);
  }

  /** WASD/arrows while placing: nudge the placement cursor (Alt = fine step).
   * Outside placement the same keys aim/adjust spin via onNudgeAim/onNudgeSpin;
   * camera push/pull lives on the wheel and right-drag orbit. */
  private keyMove(dx: number, dy: number, fine: boolean): void {
    if (this.phase === 'menu' || this.paused || this.handAnimating) return;
    if (this.isPlacementPhase() && this.isHumanSeat(this.rule.currentPlayer) && !this.targeting) {
      const step = this.phase === 'breakPlacement' ? stepBreakPlacement : stepPlacement;
      this.placement = step(this.placement ?? this.defaultPlacement(), dx, dy, fine);
    }
  }

  private defaultPlacement(): Vec2 {
    const cue = this.simulation.state.balls.find(ball => ball.id === 0);
    const base = cue?.onTable && !cue.pocketed ? cue.position : { x: -0.72, y: 0 };
    const clamped = this.phase === 'breakPlacement' ? clampBreakPlacement(base) : clampPlacement(base);
    if (this.validPlacement(clamped)) return clamped;
    // 犯规后白球可能贴着目标球或已落袋，原位不可放：扫一个合法落点，
    // 保证提示所说的“Space / Enter 确定放置”一次就能确认。
    return this.firstLegalPlacement() ?? clamped;
  }

  private firstLegalPlacement(): Vec2 | null {
    const spots: Vec2[] = [{ x: -0.72, y: 0 }, { x: -0.5, y: 0.25 }, { x: -0.5, y: -0.25 }, { x: 0, y: 0 }];
    for (let x = -1.1; x <= 1.1; x += 0.1) {
      for (let y = -0.5; y <= 0.5; y += 0.1) spots.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) });
    }
    for (const spot of spots) {
      const clamped = this.phase === 'breakPlacement' ? clampBreakPlacement(spot) : clampPlacement(spot);
      if (this.validPlacement(clamped)) return clamped;
    }
    return null;
  }

  private confirmPlacement(): void {
    if (!this.isPlacementPhase() || !this.isHumanSeat(this.rule.currentPlayer) || this.paused || this.targeting) return;
    const position = this.placement ?? this.defaultPlacement();
    if (this.placeCueBall(this.rule.currentPlayer, position)) this.placement = null;
  }

  private validCuePosition(position: Vec2): boolean {
    if (Math.abs(position.x) > CUSHION_HALF_X - BALL_RADIUS || Math.abs(position.y) > CUSHION_HALF_Y - BALL_RADIUS) return false;
    if (POCKETS.some(pocket => distance(position, pocket.position) < POCKET_RADIUS + BALL_RADIUS)) return false;
    return !this.simulation.state.balls.some(ball => ball.id !== 0 && ball.onTable && !ball.pocketed && distance(position, ball.position) < BALL_RADIUS * 2.05);
  }

  /** Break placement additionally stays behind the head string (kitchen). */
  private validPlacement(position: Vec2): boolean {
    if (!this.validCuePosition(position)) return false;
    return this.phase !== 'breakPlacement' || position.x <= HEAD_STRING_X + 1e-9;
  }

  private placeCueBall(seat: Seat, position: Vec2): boolean {
    if (!this.isPlacementPhase() || seat !== this.rule.currentPlayer || !this.validPlacement(position)) {
      if (seat === this.rule.currentPlayer && this.isHumanSeat(seat)) {
        this.hud.toast(this.phase === 'breakPlacement' ? '开球摆位需在开球线之后，且避开其他球与袋口' : '此处不能放置白球，请避开其他球与袋口');
      }
      return false;
    }
    const cue = this.simulation.state.balls.find(ball => ball.id === 0)!;
    cue.position = { ...position };
    cue.velocity = { x: 0, y: 0 };
    cue.angularVelocity = { x: 0, y: 0, z: 0 };
    cue.motion = 'stationary';
    cue.onTable = true;
    cue.pocketed = false;
    if (this.fake?.machine.status === 'active' && seat === this.fake.opponent) {
      const result = this.fake.machine.opponentPlaced(true);
      if (result.accepted) this.applyFakeResolution(result.resolution);
      return true;
    }
    const wasBreak = this.phase === 'breakPlacement';
    if (!wasBreak) this.cueReplacementAvailable = seat;
    this.rule.ballInHand = false;
    this.phase = 'aiming';
    if (wasBreak && this.isHumanSeat(seat)) {
      // 第十三轮摩擦 0.7、球速上限 10：开局力度（经典 0.72 / 创意 0.56）仍可能四球碰库不足，
      // 自动补到 0.88（8.8 m/s，袋角碰撞修正后实测 100/100 种子合法且散开充分；0.89 在
      // seed 12 白球洗袋，见 breakSweep/breakScatter 单测），避免首次交互必犯规，结算后还原玩家原有力度。
      if (this.breakPowerRestore === null) this.breakPowerRestore = this.human.power;
      this.human.power = Math.max(this.human.power, 0.88);
    }
    this.message = wasBreak
      ? `${seatName(seat)}已摆好白球，瞄准球堆后按住左键向后拖动蓄力开球。`
      : this.isHumanSeat(seat)
        ? `${seatName(seat)}已放置白球，可以瞄准击球；点「重摆」可再次调整位置。`
        : `${seatName(seat)}已放置白球，可以瞄准击球。`;
    return true;
  }

  private repositionCueBall(): void {
    const seat = this.rule.currentPlayer;
    if (this.phase !== 'aiming' || !this.canHumanStrike() || this.cueReplacementAvailable !== seat) return;
    this.cancelCharge();
    this.cueLocked = false;
    this.placement = null;
    this.rule.ballInHand = true;
    this.phase = 'ballInHand';
    this.message = `${seatName(seat)}重新摆放自由球：拖动白球或使用 WASD 调整，Space / Enter 确定。`;
    this.updateHud();
  }

  private canHumanStrike(): boolean {
    return this.isInteractivePhase() && this.isHumanSeat(this.rule.currentPlayer) && !this.targeting;
  }

  private cancelCharge(): void {
    this.charging = false;
    this.dragCharging = false;
  }

  /** Esc / window blur: cancel any pending charge and tell the player nothing was struck. */
  private cancelChargeWithFeedback(): void {
    const wasCharging = this.charging || this.dragCharging;
    this.cancelCharge();
    if (wasCharging) this.hud.toast('已取消蓄力，未击球');
  }

  private toggleCueLock(): void {
    if (this.phase !== 'aiming' || !this.canHumanStrike()) return;
    this.cueLocked = !this.cueLocked;
    this.hud.toast(this.cueLocked ? '球杆已锁定：移动鼠标不再改变瞄准，可点击杆法面板调整击球点' : '球杆已解锁：移动鼠标继续瞄准');
    this.updateHud();
  }

  /** Screen-space unit vector pointing from the aim target back toward the cue
   * ball; left-dragging along it pulls the cue back to charge. */
  private strikeBackDirection(): { x: number; y: number } | null {
    const cueScreen = this.view.getBallScreenPosition(0);
    const cue = this.simulation.state.balls.find(ball => ball.id === 0);
    if (!cueScreen || !cue) return null;
    const ahead = this.view.tableToScreen({
      x: cue.position.x + Math.cos(this.human.angle) * 0.4,
      y: cue.position.y + Math.sin(this.human.angle) * 0.4,
    });
    const vx = cueScreen.x - ahead.x;
    const vy = cueScreen.y - ahead.y;
    const length = Math.hypot(vx, vy);
    return length > 1e-3 ? { x: vx / length, y: vy / length } : null;
  }

  private beginDragCharge(): boolean {
    if (this.charging || this.dragCharging || this.paused || this.handAnimating || this.targeting) return false;
    if (this.isPlacementPhase() || !this.canHumanStrike()) return false;
    const cue = this.simulation.state.balls.find(ball => ball.id === 0);
    if (!cue?.onTable || cue.pocketed) return false;
    this.dragCharging = true;
    this.charging = true;
    this.human.power = MIN_SHOT_POWER;
    return true;
  }

  private endDragCharge(strike: boolean): void {
    if (!this.dragCharging) return;
    this.dragCharging = false;
    this.charging = false;
    if (strike) this.humanStrike();
    else this.hud.toast('已取消击球');
  }

  private humanStrike(): void {
    this.cancelCharge();
    if (!this.canHumanStrike()) return;
    this.strike(this.rule.currentPlayer, this.human.angle, this.human.power, this.human.spin);
  }

  private strike(seat: Seat, angle: number, power: number, spin: { x: number; y: number }): boolean {
    this.cancelCharge();
    if (!this.isInteractivePhase() || seat !== this.rule.currentPlayer || this.targeting) return false;
    const cue = this.simulation.state.balls.find(ball => ball.id === 0);
    if (!cue?.onTable || cue.pocketed) {
      if (this.isHumanSeat(seat)) this.hud.toast('请先在球桌上放置白球');
      this.phase = 'ballInHand';
      this.rule.ballInHand = true;
      this.cueReplacementAvailable = seat;
      return false;
    }
    this.shotContext = prepareShot({ state: this.rule, simulation: this.simulation.getSnapshot() });
    this.simulation.shooter = seat;
    this.simulation.strike(angle, power, spin, {
      ...this.enhancements[seat],
      pierceFirstContact: this.enhancements[seat].pierceNextShot,
    });
    this.enhancements[seat] = neutralShotEnhancements();
    // English is a per-shot input, not a persistent player setting. The strike
    // above consumes the current value synchronously; the next shot starts clean.
    this.human.spin = { x: 0, y: 0 };
    this.cueReplacementAvailable = null;
    this.rule.ballInHand = false;
    this.cueLocked = false;
    this.phase = 'rolling';
    this.accumulator = 0;
    this.aiRollingSkillAttempted = false;
    this.audio.strike(power);
    this.message = `${seatName(seat)}击球，等待所有球停止。`;
    if (this.fake?.machine.status === 'active' && seat === this.fake.opponent) {
      const result = this.fake.machine.opponentShot(true);
      if (result.accepted) this.fakeShotResolution = result.resolution;
    }
    this.aiReadyAt = performance.now() + 300;
    return true;
  }

  private resolveShot(): void {
    const outcome = this.simulation.currentOutcome;
    if (!outcome || this.resolvedShots.has(outcome.shotId) || !this.shotContext) return;
    this.resolvedShots.add(outcome.shotId);
    this.view.setHairdryerBall(null);
    this.audio.hairdryer(false);
    this.hairdryerAudible = false;
    if (this.fakeShotResolution) {
      this.applySpecialFakeShot(outcome, this.fakeShotResolution);
    } else {
      const resolution = resolveChineseEight({
        state: this.shotContext.state,
        simulation: this.simulation.getSnapshot(),
        preShotSimulation: this.shotContext.preShotSimulation,
      }, outcome);
      const assignment = groupAssignmentText(this.rule.groups, resolution.state.groups, this.setup.playMode === 'solo');
      this.rule = resolution.state;
      if (assignment) this.hud.announceGroups(assignment);
      if (resolution.respotEight) this.simulation.restoreSnapshot(respotEightBall(this.simulation.state));
      if (resolution.respotBalls.length > 0) {
        this.simulation.restoreSnapshot(respotBallsOnTable(this.simulation.state, resolution.respotBalls));
      }
      if (resolution.foul) this.audio.foul();
      this.message = resolution.message;
    }
    this.fakeShotResolution = null;
    this.fake = null;
    this.shotContext = null;
    if (this.breakPowerRestore !== null && !this.rule.isBreak) {
      this.human.power = this.breakPowerRestore;
      this.breakPowerRestore = null;
    }
    if (this.rule.winner !== null) {
      this.phase = 'gameOver';
      this.clock.setRunning(false);
      this.hud.showWinner(this.rule.winner, () => this.start(this.setup), () => this.returnToMenu());
    } else {
      this.phase = this.phaseForTurn();
      this.aiReadyAt = performance.now() + 850;
      if (this.clock.hasOvertimePending && this.setup.mode === 'creative') this.beginDraftSequence(true);
    }
    this.updateHud();
  }

  private applySpecialFakeShot(outcome: ShotOutcome, resolution: FakeFreeBallResolution): void {
    const owner = resolution.freeBallFor;
    const next = cloneRuleState(this.shotContext!.state);
    next.currentPlayer = owner;
    next.ballInHand = true;
    next.isBreak = false;
    next.winner = null;
    next.shotNumber = Math.max(next.shotNumber + 1, outcome.shotId);
    this.rule = next;
    if (outcome.pocketed.some(ball => ball.ballId === 8) || outcome.flewOffTable.includes(8)) {
      this.simulation.restoreSnapshot(respotEightBall(this.simulation.state));
    }
    const flewObjects = outcome.flewOffTable.filter(ballId => ballId !== 0 && ballId !== 8);
    if (flewObjects.length > 0) this.simulation.restoreSnapshot(respotBallsOnTable(this.simulation.state, flewObjects));
    this.audio.foul();
    this.message = `假自由球触发特殊犯规，${seatName(owner)}获得真自由球；本杆不确定球组或胜负。`;
  }

  private applyFakeResolution(resolution: FakeFreeBallResolution): void {
    const seat = resolution.freeBallFor;
    this.rule.currentPlayer = seat;
    this.rule.ballInHand = true;
    this.cueReplacementAvailable = seat;
    this.rule.winner = null;
    this.phase = 'ballInHand';
    this.fake = null;
    this.audio.foul();
    this.message = resolution.kind === 'timeout'
      ? `对手未移动白球，${seatName(seat)}获得真正的自由球。`
      : `对手移动了球，假自由球判定犯规，${seatName(seat)}获得真自由球。`;
    this.hud.toast(this.message);
    this.aiReadyAt = performance.now() + 900;
  }

  private skillEligible(seat: Seat, instance: SkillInstance): boolean {
    if (this.setup.mode !== 'creative' || instance.remainingUses <= 0 || this.paused || this.handAnimating || this.phase === 'draft' || this.phase === 'gameOver') return false;
    // 绅士决斗：对局任意时刻可用（含对手回合与球运动中），但不能与其它选球操作并发。
    if (instance.skillId === 'gentlemanDuel') return !this.targeting && !this.exitDialog.isOpen;
    if (instance.skillId === 'hand') {
      return this.isInteractivePhase() && this.rule.currentPlayer === otherSeat(seat) && !this.fake &&
        getHandCandidates(this.simulation.state, seat, this.rule.groups).length > 0;
    }
    if (instance.skillId === 'hairdryer') {
      return this.phase === 'rolling' && this.rule.currentPlayer === otherSeat(seat) && !this.fakeShotResolution &&
        getHairdryerCandidates(this.simulation.state).length > 0;
    }
    if (instance.skillId === 'enhancedEnglish') {
      return this.isInteractivePhase() && this.rule.currentPlayer === seat && !this.fake &&
        this.enhancements[seat].sideSpinMultiplier === 1;
    }
    if (instance.skillId === 'luckyPocket') {
      return this.isInteractivePhase() && this.rule.currentPlayer === seat && !this.fake &&
        this.enhancements[seat].pocketRadiusBonus === 0;
    }
    if (instance.skillId === 'pierceShot') {
      return this.isInteractivePhase() && this.rule.currentPlayer === seat && !this.fake &&
        !this.enhancements[seat].pierceNextShot;
    }
    return this.isInteractivePhase() && this.rule.currentPlayer === seat && !this.fake;
  }

  private async useSkill(seat: Seat, instanceId: string, targetBallId?: number): Promise<boolean> {
    const instance = this.machines[seat].getInstance(instanceId);
    if (!instance || !this.skillEligible(seat, instance) || this.targeting) return false;
    if (!this.machines[seat].beginTargeting(instanceId, targetBallId)) return false;
    if (instance.skillId === 'gentlemanDuel') {
      this.machines[seat].commitTargeting();
      this.cancelCharge();
      this.input.reset();
      this.hideTargetBanner();
      this.hud.announceSkill(seat, SKILL_CATALOG.gentlemanDuel.name);
      this.message = `${seatName(seat)}展开「绅士决斗」领域：格斗胜者直接赢下本场台球比赛。`;
      this.audio.skill();
      this.hud.toast(this.message);
      this.updateHud();
      this.startDuel();
      return true;
    }
    if (instance.skillId === 'fakeFreeBall') {
      this.machines[seat].commitTargeting();
      const opponent = otherSeat(seat);
      this.fake = { machine: new FakeFreeBallMachine(seat), owner: seat, opponent, aiActed: false };
      this.rule.currentPlayer = opponent;
      this.rule.ballInHand = true;
      this.phase = 'ballInHand';
      this.message = `${seatName(seat)}：“给你自由球。” ${seatName(opponent)}可决定是否移动白球。`;
      this.audio.skill();
      this.hud.toast(this.message);
      this.aiReadyAt = performance.now() + 1200;
      this.updateHud();
      return true;
    }
    if (instance.skillId === 'enhancedEnglish' || instance.skillId === 'luckyPocket') {
      this.machines[seat].commitTargeting();
      if (instance.skillId === 'enhancedEnglish') {
        this.enhancements[seat].sideSpinMultiplier = ENHANCED_ENGLISH_MULTIPLIER;
        this.message = `${seatName(seat)}发动「加塞强化」：下一杆侧旋增强 50%。`;
      } else {
        this.enhancements[seat].pocketRadiusBonus = LUCKY_POCKET_RADIUS_BONUS;
        this.message = `${seatName(seat)}发动「幸运袋口」：下一杆袋口捕获范围扩大。`;
      }
      this.cancelCharge();
      this.hud.announceSkill(seat, SKILL_CATALOG[instance.skillId].name);
      this.audio.skill();
      this.hud.toast(this.message);
      this.aiReadyAt = performance.now() + 250;
      this.updateHud();
      return true;
    }
    if (instance.skillId === 'pierceShot') {
      this.machines[seat].commitTargeting();
      this.enhancements[seat].pierceNextShot = true;
      this.message = `${seatName(seat)}发动「穿透击」：下一杆白球将穿过第一颗碰到的球。`;
      this.cancelCharge();
      this.hud.announceSkill(seat, SKILL_CATALOG.pierceShot.name);
      this.audio.skill();
      this.hud.toast(this.message);
      this.aiReadyAt = performance.now() + 250;
      this.updateHud();
      return true;
    }
    const returnPhase = this.phase;
    this.targeting = { seat, instanceId, skillId: instance.skillId, returnPhase };
    this.phase = 'skillTargeting';
    const candidates = instance.skillId === 'hand'
      ? getHandCandidates(this.simulation.state, seat, this.rule.groups)
      : getHairdryerCandidates(this.simulation.state);
    this.view.setHighlights(candidates);
    this.showTargetBanner(instance.skillId === 'hand' ? '选择一颗发光的己方库边球' : '物理已暂停，选择一颗正在运动的球');
    this.audio.skill();
    if (targetBallId !== undefined) return this.executeTargetedSkill(targetBallId);
    return true;
  }

  private async ballClick(ballId: number): Promise<void> {
    if (this.targeting) { await this.executeTargetedSkill(ballId); return; }
    if (this.phase === 'aiming' && this.isHumanSeat(this.rule.currentPlayer)) {
      const cue = this.simulation.state.balls.find(ball => ball.id === 0)!;
      const target = this.simulation.state.balls.find(ball => ball.id === ballId);
      if (target) this.human.angle = Math.atan2(target.position.y - cue.position.y, target.position.x - cue.position.x);
    }
  }

  private async executeTargetedSkill(ballId: number): Promise<boolean> {
    const targeting = this.targeting;
    if (!targeting) return false;
    const { seat, instanceId, skillId, returnPhase } = targeting;
    if (skillId === 'hand') {
      const adjustment = createHandAdjustment(this.simulation.state, seat, this.rule.groups, ballId);
      if (!adjustment) { this.hud.toast('这颗球不符合手部微操条件'); return false; }
      const result = commitHandAdjustment(this.simulation.state, seat, this.rule.groups, adjustment);
      if (!result.ok) { this.hud.toast('目标位置不安全，技能未消耗'); return false; }
      const revision = this.revision;
      this.handAnimating = true;
      this.hideTargetBanner();
      this.message = `${seatName(seat)}俯身微调 ${ballId} 号球……`;
      await this.view.playHandMicro(ballId, adjustment.position, seat);
      if (revision !== this.revision) return false;
      this.simulation.restoreSnapshot(result.state);
      this.machines[seat].commitTargeting();
      this.hud.announceSkill(seat, SKILL_CATALOG[skillId].name);
      this.handAnimating = false;
      this.targeting = null;
      this.phase = returnPhase;
      this.view.setHighlights([]);
      this.message = `${seatName(seat)}将 ${ballId} 号球推近袋口，仍由${seatName(this.rule.currentPlayer)}击球。`;
      this.updateHud();
      return true;
    }
    const effect = createHairdryerEffect(this.simulation.state, ballId, instanceId);
    if (!effect) { this.hud.toast('请选择仍在运动的发光球'); return false; }
    this.simulation.applyBrakingEffect(effect);
    this.machines[seat].commitTargeting();
    this.hud.announceSkill(seat, SKILL_CATALOG[skillId].name);
    this.targeting = null;
    this.phase = returnPhase;
    this.view.setHighlights([]);
    this.view.setHairdryerBall(ballId);
    this.audio.hairdryer(true);
    this.hairdryerAudible = true;
    this.hideTargetBanner();
    this.message = `吹风机对准 ${ballId} 号球，持续减速 ${HAIRDRYER_DURATION_MS / 1000} 秒。`;
    this.updateHud();
    return true;
  }

  private showTargetBanner(text: string): void {
    this.targetBanner.innerHTML = `${text}<button>取消</button>`;
    this.targetBanner.querySelector('button')!.addEventListener('click', () => this.cancelTargeting(), { once: true });
    this.targetBanner.classList.remove('hidden');
  }
  private hideTargetBanner(): void { this.targetBanner.classList.add('hidden'); }

  private cancelTargeting(): void {
    if (!this.targeting) return;
    this.machines[this.targeting.seat].cancelTargeting();
    this.phase = this.targeting.returnPhase;
    this.targeting = null;
    this.view.setHighlights([]);
    this.hideTargetBanner();
    this.message = '已取消技能选择，技能次数未消耗。';
  }

  private updateAi(now: number): void {
    if (this.setup.playMode !== 'solo' || this.paused || this.handAnimating || this.phase === 'draft' || this.phase === 'gameOver' || now < this.aiReadyAt) return;
    if (this.fake) {
      if (this.rule.currentPlayer === 1 && this.phase === 'ballInHand' && !this.fake.aiActed) {
        this.fake.aiActed = true;
        const wait = this.rng.next() < (this.setup.difficulty === 'hard' ? 0.7 : 0.45);
        if (wait) { this.message = '乙方正在观察这颗自由球……'; this.aiReadyAt = now + 10_200; }
        else {
          const position = this.findAiCuePosition();
          if (position) this.placeCueBall(1, position);
        }
      }
      return;
    }
    if (this.phase === 'rolling') {
      if (this.rule.currentPlayer === 0 && !this.aiRollingSkillAttempted) {
        this.aiRollingSkillAttempted = true;
        const skill = this.machines[1].getInventory().find(instance => instance.skillId === 'hairdryer' && this.skillEligible(1, instance));
        const target = getHairdryerCandidates(this.simulation.state)[0];
        if (skill && target !== undefined) void this.useSkill(1, skill.instanceId, target);
      }
      return;
    }
    if (this.phase === 'breakPlacement') {
      if (this.rule.currentPlayer === 1) {
        const position = [{ x: -0.72, y: 0 }, { x: -0.66, y: 0.2 }, { x: -0.66, y: -0.2 }]
          .find(candidate => this.validPlacement(candidate));
        if (position) this.placeCueBall(1, position);
      }
      return;
    }
    if (!this.isInteractivePhase()) return;
    if (this.rule.currentPlayer === 0) {
      const key = `${this.rule.shotNumber}-0`;
      if (this.aiHandAttemptKey === key) return;
      this.aiHandAttemptKey = key;
      const skill = this.machines[1].getInventory().find(instance => instance.skillId === 'hand' && this.skillEligible(1, instance));
      const target = skill ? getHandCandidates(this.simulation.state, 1, this.rule.groups)[0] : undefined;
      if (skill && target !== undefined) void this.useSkill(1, skill.instanceId, target);
      return;
    }
    const fakeSkill = this.machines[1].getInventory().find(instance => instance.skillId === 'fakeFreeBall' && this.skillEligible(1, instance));
    if (fakeSkill && this.rng.next() < 0.22) { void this.useSkill(1, fakeSkill.instanceId); return; }
    if (this.phase === 'ballInHand') {
      const position = this.findAiCuePosition();
      if (position) this.placeCueBall(1, position);
      if (this.fake) return;
    }
    const englishSkill = this.machines[1].getInventory().find(instance => instance.skillId === 'enhancedEnglish' && this.skillEligible(1, instance));
    const englishChance = this.setup.difficulty === 'hard' ? 0.8 : this.setup.difficulty === 'normal' ? 0.55 : 0.3;
    if (englishSkill && !this.rule.isBreak && this.rng.next() < englishChance) {
      void this.useSkill(1, englishSkill.instanceId);
      return;
    }
    const luckySkill = this.machines[1].getInventory().find(instance => instance.skillId === 'luckyPocket' && this.skillEligible(1, instance));
    const luckyChance = this.setup.difficulty === 'hard' ? 0.85 : this.setup.difficulty === 'normal' ? 0.6 : 0.35;
    if (luckySkill && this.rng.next() < luckyChance) {
      void this.useSkill(1, luckySkill.instanceId);
      return;
    }
    const pierceSkill = this.machines[1].getInventory().find(instance => instance.skillId === 'pierceShot' && this.skillEligible(1, instance));
    const pierceChance = this.setup.difficulty === 'hard' ? 0.7 : this.setup.difficulty === 'normal' ? 0.45 : 0.25;
    if (pierceSkill && !this.rule.isBreak && this.rng.next() < pierceChance) {
      void this.useSkill(1, pierceSkill.instanceId);
      return;
    }
    try {
      const shot = planShot({ state: this.rule, simulation: this.simulation.getSnapshot() }, this.rng, this.setup.difficulty);
      if (this.enhancements[1].sideSpinMultiplier > 1 && shot.spin.x === 0) {
        shot.spin.x = this.rng.next() < 0.5 ? -0.45 : 0.45;
      }
      this.strike(1, shot.angle, shot.power, shot.spin);
    } catch {
      this.strike(1, this.rng.range(-Math.PI, Math.PI), 0.35, { x: 0, y: 0 });
    }
  }

  private findAiCuePosition(): Vec2 | null {
    const candidates = [{ x: -0.72, y: 0 }, { x: -0.5, y: 0.25 }, { x: -0.5, y: -0.25 }, { x: 0, y: 0 }];
    return candidates.find(position => this.validCuePosition(position)) ?? null;
  }

  private togglePause(): void {
    if (this.phase === 'menu' || this.phase === 'gameOver' || this.exitDialog.isOpen) return;
    this.paused = !this.paused;
    if (this.paused) this.cancelCharge();
    this.clock.setRunning(!this.paused && this.phase !== 'draft');
    this.hud.toast(this.paused ? '对局已暂停' : '对局继续');
  }

  private settingsState(): SettingsState {
    const audio = this.audio.getSettings();
    return { musicState: this.audio.getMusicState(), muted: audio.muted, music: audio.music, sfx: audio.sfx, reducedMotion: this.view.reducedMotion, lowQuality: this.view.lowQuality };
  }

  private toggleMute(): void {
    const muted = !this.audio.getSettings().muted;
    this.audio.setMuted(muted);
    this.hud.setMuted(muted);
    this.settingsDialog.sync(this.settingsState());
    this.hud.toast(muted ? '已静音，音乐与音效全部关闭' : '声音已恢复');
  }

  private cycleCamera(): void {
    // Derive from the live mode so manual cycles stay correct after the
    // automatic top-view transitions during rolling and placement.
    const modes: CameraMode[] = ['aim', 'orbit', 'top'];
    const index = modes.indexOf(this.view.cameraController.mode);
    this.view.setCamera(modes[(index + 1) % modes.length]!);
  }

  private loop(now: number): void {
    const delta = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    // The hidden billiards renderer and simulation remain dormant during combat.
    if (this.fightMode) { requestAnimationFrame(time => this.loop(time)); return; }
    if (!this.paused && this.phase !== 'menu' && this.phase !== 'draft' && this.phase !== 'gameOver') {
      this.clock.advance(delta * 1000);
      if (this.fake?.machine.status === 'active') {
        const resolution = this.fake.machine.advance(delta * 1000);
        if (resolution) this.applyFakeResolution(resolution);
      }
      if (this.phase === 'rolling') {
        // 第九轮观感慢放：物理步数不变，仅步长到墙钟的映射变慢（距离/确定性不变）。
        this.accumulator += delta * PRESENTATION_TIME_SCALE;
        let steps = 0;
        while (this.accumulator >= FIXED_DT && steps < 128 && this.phase === 'rolling') {
          this.simulation.step();
          this.accumulator -= FIXED_DT;
          steps++;
        }
        if (this.simulation.allStopped()) this.resolveShot();
      }
      if (this.hairdryerAudible && this.simulation.state.braking.length === 0) {
        this.audio.hairdryer(false);
        this.hairdryerAudible = false;
      }
      this.updateAi(now);
    }
    this.view.syncSimulation(this.simulation.getSnapshot());
    const placing = this.isPlacementPhase() && this.isHumanSeat(this.rule.currentPlayer) && !this.paused && !this.targeting && !this.handAnimating;
    if (placing) {
      if (!this.placement) {
        this.placement = this.defaultPlacement();
        this.message += this.phase === 'breakPlacement'
          ? ' 拖动白球或 WASD/方向键移动（Alt 微调），Space / Enter 确定后开球。'
          : ' 拖动白球或 WASD/方向键移动（Alt 微调），Space / Enter 确定放置。';
      }
      this.view.setPlacementCursor(this.placement, this.validPlacement(this.placement));
      this.view.previewBallPosition(0, this.placement);
    } else {
      if (!this.isPlacementPhase()) this.placement = null;
      this.view.setPlacementCursor(null, true);
      this.view.previewBallPosition(0, null);
    }
    this.view.setBreakLine(this.phase === 'breakPlacement');
    const aiming = this.isInteractivePhase() && this.isHumanSeat(this.rule.currentPlayer);
    // 吹风机选球发生在滚动中（物理暂停），镜头保持顶视，方便看清全台候选球。
    const rollingLike = this.phase === 'rolling' || (this.phase === 'skillTargeting' && this.targeting?.returnPhase === 'rolling');
    this.view.setCameraPhase(placing ? 'placing' : rollingLike ? 'rolling' : aiming ? 'aiming' : 'other');
    this.view.setAim(this.human.angle, this.human.power, aiming, this.charging, this.human.spin);
    this.view.render(now / 1000);
    if (now - this.lastHudUpdate > 100) { this.updateHud(); this.lastHudUpdate = now; }
    requestAnimationFrame(time => this.loop(time));
  }

  private updateHud(): void {
    if (this.phase === 'menu') return;
    this.hud.setPaused(this.paused);
    const remaining: [number, number] = [7, 7];
    for (const seat of [0, 1] as Seat[]) {
      const group = this.rule.groups[seat];
      remaining[seat] = group ? remainingGroupBalls(this.simulation.state, group) : 7;
    }
    this.hud.update({
      mode: this.setup.mode,
      phase: this.phase,
      currentSeat: this.rule.currentPlayer,
      groups: this.rule.groups,
      remaining,
      pocketed: pocketedBallIds(this.simulation.state.balls),
      solo: this.setup.playMode === 'solo',
      isBreak: this.rule.isBreak,
      message: this.paused ? '对局已暂停，点击右上角继续。' : this.message,
      elapsedSeconds: this.clock.elapsed / 1000,
      shotNumber: this.rule.shotNumber,
      power: this.human.power,
      spin: this.human.spin,
      charging: this.charging,
      locked: this.cueLocked,
      canStrike: this.isInteractivePhase() && this.isHumanSeat(this.rule.currentPlayer) && !!this.simulation.state.balls.find(ball => ball.id === 0)?.onTable,
      canRepositionCue: this.phase === 'aiming' && this.canHumanStrike()
        && this.cueReplacementAvailable === this.rule.currentPlayer,
      canUseSkills: [this.isHumanSeat(0), this.isHumanSeat(1)],
      skills: [this.machines[0].getInventory(), this.machines[1].getInventory()],
      catalog: SKILL_IDS.map(id => SKILL_CATALOG[id]),
      eligible: (seat, instance) => this.skillEligible(seat, instance),
    });
  }

  getDebugApi(): DebugApi {
    return {
      getState: () => ({ phase: this.phase, rule: this.rule, simulation: this.simulation.getSnapshot(), outcome: this.simulation.currentOutcome, skills: [this.machines[0].getInventory(), this.machines[1].getInventory()], enhancements: [{ ...this.enhancements[0] }, { ...this.enhancements[1] }], elapsedMs: this.clock.elapsed, charging: this.charging, cueLocked: this.cueLocked, view: this.view.getDebugState(), placementCursor: this.placement, fake: this.fake ? { owner: this.fake.owner, status: this.fake.machine.status, elapsedMs: this.fake.machine.elapsedMs } : null, human: { angle: this.human.angle, power: this.human.power, spin: { ...this.human.spin } } }),
      advanceTime: (ms: number) => {
        if (this.phase === 'menu' || this.phase === 'gameOver') return;
        this.clock.advance(ms);
        if (this.clock.hasOvertimePending && this.setup.mode === 'creative' && this.phase !== 'rolling') this.beginDraftSequence(true);
        if (this.fake) {
          const resolution = this.fake.machine.advance(ms);
          if (resolution) this.applyFakeResolution(resolution);
        }
        this.updateHud();
      },
      useSkill: (seat: Seat, skillId: SkillId, targetBallId?: number) => {
        const instance = this.machines[seat].getInventory().find(item => item.skillId === skillId && item.remainingUses > 0);
        return instance ? this.useSkill(seat, instance.instanceId, targetBallId) : false;
      },
      strike: (angle = 0, power = 0.5) => this.strike(this.rule.currentPlayer, angle, power, { x: 0, y: 0 }),
      placeCue: (point: Vec2) => this.placeCueBall(this.rule.currentPlayer, point),
      setGroups: (seat: Seat, group: 'solids' | 'stripes') => {
        this.rule.groups[seat] = group;
        this.rule.groups[otherSeat(seat)] = group === 'solids' ? 'stripes' : 'solids';
        this.rule.openTable = false;
        this.rule.isBreak = false;
        this.updateHud();
      },
      setCurrentPlayer: (seat: Seat) => { this.rule.currentPlayer = seat; this.phase = 'aiming'; this.rule.ballInHand = false; this.cueReplacementAvailable = null; this.aiReadyAt = Number.POSITIVE_INFINITY; this.updateHud(); },
      setBall: (ballId: number, position: Vec2) => {
        const ball = this.simulation.state.balls.find(item => item.id === ballId);
        if (ball) { ball.position = { ...position }; ball.velocity = { x: 0, y: 0 }; ball.motion = 'stationary'; ball.onTable = true; ball.pocketed = false; }
      },
      removeBall: (ballId: number) => {
        const ball = this.simulation.state.balls.find(item => item.id === ballId);
        if (ball && ballId !== 0) { ball.onTable = false; ball.pocketed = true; ball.motion = 'pocketed'; ball.velocity = { x: 0, y: 0 }; }
      },
      ballScreen: (ballId: number) => this.view.getBallScreenPosition(ballId),
      pickBallAt: (x: number, y: number) => this.view.pickBall(x, y),
      tableScreen: (point: Vec2) => this.view.tableToScreen(point),
      reducedMotion: (enabled: boolean) => {
        this.view.reducedMotion = enabled;
        this.settingsDialog.sync(this.settingsState());
      },
      renderScale: (scale: number) => this.view.setRenderScale(scale),
      renderFrame: (timeSeconds: number) => this.view.render(timeSeconds),
      audio: () => this.audio.getDebugState(),
      nodeReport: () => this.view.debugNodeReport(),
      cueAim: () => this.view.debugCueAim(),
      aim: (angle: number) => { this.human.angle = angle; },
      setNodeVisible: (name: string, visible: boolean) => this.view.debugSetNodeVisible(name, visible),
      raycastAt: (x: number, y: number) => this.view.debugRaycast(x, y),
      cancelAi: () => { this.aiReadyAt = Number.POSITIVE_INFINITY; },
      pause: (enabled: boolean) => {
        if (this.phase === 'menu' || this.phase === 'gameOver') return;
        this.paused = enabled;
        if (enabled) this.cancelCharge();
        this.clock.setRunning(!enabled && this.phase !== 'draft');
      },
      consumeSkill: (seat: Seat, instanceId: string) => {
        const consumed = consumeSkillInstance(this.machines[seat].getInventory(), instanceId);
        if (consumed) { this.machines[seat] = new SkillMachine(consumed); this.updateHud(); }
      },
    };
  }
}
