import type { RuleState } from '../rules/ruleTypes';
import type { ShotOutcome } from '../sim/ShotOutcome';
import type { SimulationState, Vec2 } from '../sim/SimulationState';
import type { SkillId, SkillInventory } from '../skills/skillTypes';
import type { ShotEnhancements } from '../skills/shotEnhancements';
import type { GamePhase, Seat } from './matchTypes';

export interface DebugMatchState {
  phase: GamePhase;
  rule: RuleState;
  simulation: SimulationState;
  outcome: ShotOutcome | null;
  skills: [SkillInventory, SkillInventory];
  enhancements: [ShotEnhancements, ShotEnhancements];
  elapsedMs: number;
  charging: boolean;
  cueLocked: boolean;
  view: {
    camera: { mode: 'orbit' | 'top' | 'aim'; position: number[]; target: number[]; fov: number };
    tableFit: { clothTopY: number; clothWidth: number; clothDepth: number } | null;
    traditionalFit: { clothTopY: number; noseX: number; noseZ: number; bedHalfX: number; bedHalfZ: number } | null;
    roomBackground: boolean;
    roomOccluders: { lampVisible: boolean; ceilingVisible: boolean };
  };
  placementCursor: Vec2 | null;
  fake: { owner: Seat; status: string; elapsedMs: number } | null;
  human: { angle: number; power: number; spin: { x: number; y: number } };
}

/** Browser-only deterministic acceptance hooks; never used by gameplay rules. */
export interface DebugApi {
  getState(): DebugMatchState;
  advanceTime(ms: number): void;
  useSkill(seat: Seat, skillId: SkillId, targetBallId?: number): boolean | Promise<boolean>;
  strike(angle?: number, power?: number): boolean;
  placeCue(point: Vec2): boolean;
  setGroups(seat: Seat, group: 'solids' | 'stripes'): void;
  setCurrentPlayer(seat: Seat): void;
  setBall(ballId: number, position: Vec2): void;
  removeBall(ballId: number): void;
  ballScreen(ballId: number): { x: number; y: number } | null;
  pickBallAt(x: number, y: number): number | null;
  tableScreen(point: Vec2): { x: number; y: number };
  reducedMotion(enabled: boolean): void;
  renderScale(scale: number): void;
  /** Render one explicit presentation timestamp for deterministic camera checks. */
  renderFrame(timeSeconds: number): void;
  audio(): {
    muted: boolean; music: number; sfx: number; contextState: string;
    bgmPlaying: boolean; trackIndex: number; loadedSamples: string[];
  };
  cancelAi(): void;
  /** Freeze/unfreeze the real-time loop so advanceTime is the sole clock (deterministic timeout tests). */
  pause(enabled: boolean): void;
  consumeSkill(seat: Seat, instanceId: string): void;
  nodeReport(): Array<{ name: string; visible: boolean; min: number[]; max: number[] }>;
  cueAim(): {
    tip: number[]; axis: number[]; ballCentre: number[];
    gap: number; alignment: number; railClearance: number; visible: boolean;
  } | null;
  aim(angle: number): void;
  setNodeVisible(name: string, visible: boolean): boolean;
  raycastAt(x: number, y: number): Array<{ name: string; material: string; point: number[]; distance: number }>;
}
