import type { Difficulty } from '../app/matchTypes';
import type { SeededRng } from '../core/random/SeededRng';
import type { RuleContext } from '../rules/ruleTypes';
import { planShot } from './shotPlanner';
import type { ShotCommand } from './shotPlanner';

export type ShotPlanner = (
  context: RuleContext,
  rng: SeededRng,
  difficulty: Difficulty,
) => ShotCommand;

export interface AiScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface AiControllerOptions {
  readonly difficulty: Difficulty;
  readonly rng: SeededRng;
  readonly planner?: ShotPlanner;
  readonly scheduler?: AiScheduler;
  readonly thinkDelayMs?: number;
}

const defaultScheduler: AiScheduler = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: handle => globalThis.clearTimeout(handle as number),
};

/** Small orchestration wrapper; all gameplay and timing dependencies are injectable. */
export class AiController {
  private readonly difficulty: Difficulty;
  private readonly rng: SeededRng;
  private readonly planner: ShotPlanner;
  private readonly scheduler: AiScheduler;
  private readonly thinkDelayMs: number;
  private pending: { token: number; handle: unknown } | null = null;
  private nextToken = 0;

  constructor(options: AiControllerOptions) {
    this.difficulty = options.difficulty;
    this.rng = options.rng;
    this.planner = options.planner ?? planShot;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.thinkDelayMs = Math.max(0, options.thinkDelayMs ?? 350);
  }

  plan(context: RuleContext): ShotCommand {
    return this.planner(context, this.rng, this.difficulty);
  }

  scheduleShot(
    context: RuleContext,
    onShot: (shot: ShotCommand) => void,
    delayMs = this.thinkDelayMs,
  ): number {
    this.cancelScheduledShot();
    const token = ++this.nextToken;
    const handle = this.scheduler.schedule(() => {
      if (this.pending?.token !== token) return;
      this.pending = null;
      onShot(this.plan(context));
    }, Math.max(0, delayMs));
    this.pending = { token, handle };
    return token;
  }

  cancelScheduledShot(): void {
    if (!this.pending) return;
    this.scheduler.cancel(this.pending.handle);
    this.pending = null;
  }

  get hasPendingShot(): boolean {
    return this.pending !== null;
  }
}
