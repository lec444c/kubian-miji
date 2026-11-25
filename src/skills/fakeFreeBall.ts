import { otherSeat, type Seat } from '../app/matchTypes';

export const FAKE_FREE_BALL_DURATION_MS = 10_000;

export type FakeFreeBallStatus = 'active' | 'specialFoul' | 'timeout';
export type OpponentBallAction = 'place' | 'shot';

export interface FakeFreeBallResolution {
  kind: 'specialFoul' | 'timeout';
  freeBallFor: Seat;
  trueFreeBall: true;
  elapsedMs: number;
}

export interface OpponentAction {
  type: OpponentBallAction;
  causedMovement: boolean;
}

export type FakeFreeBallActionResult =
  | { accepted: true; resolution: FakeFreeBallResolution }
  | {
    accepted: false;
    reason: 'no-movement' | 'timeout' | 'already-resolved';
    resolution?: FakeFreeBallResolution;
  };

/** A deterministic, clock-independent state machine; callers inject elapsed milliseconds. */
export class FakeFreeBallMachine {
  private elapsed = 0;
  private currentStatus: FakeFreeBallStatus = 'active';
  private currentResolution: FakeFreeBallResolution | null = null;

  constructor(readonly skillUser: Seat) {}

  get status(): FakeFreeBallStatus {
    return this.currentStatus;
  }

  get elapsedMs(): number {
    return this.elapsed;
  }

  get outcome(): FakeFreeBallResolution | null {
    return this.currentResolution;
  }

  /** Returns a resolution only on the transition that resolves the machine. */
  advance(deltaMs: number): FakeFreeBallResolution | null {
    if (this.currentStatus !== 'active' || !Number.isFinite(deltaMs) || deltaMs <= 0) return null;
    return this.advanceTo(this.elapsed + deltaMs);
  }

  /** Set the monotonic injected elapsed time, clamped to the 10 second lifetime. */
  advanceTo(elapsedMs: number): FakeFreeBallResolution | null {
    if (this.currentStatus !== 'active' || !Number.isFinite(elapsedMs)) return null;
    this.elapsed = Math.max(this.elapsed, Math.min(FAKE_FREE_BALL_DURATION_MS, elapsedMs));
    if (this.elapsed >= FAKE_FREE_BALL_DURATION_MS) return this.resolveTimeout();
    return null;
  }

  recordOpponentAction(action: OpponentAction): FakeFreeBallActionResult {
    // Timeout has priority over an action arriving at or after t = 10.000 s.
    if (this.currentStatus === 'active' && this.elapsed >= FAKE_FREE_BALL_DURATION_MS) {
      const resolution = this.resolveTimeout();
      return { accepted: false, reason: 'timeout', resolution };
    }
    if (this.currentStatus !== 'active') {
      return {
        accepted: false,
        reason: 'already-resolved',
        ...(this.currentResolution ? { resolution: this.currentResolution } : {}),
      };
    }
    if (!action.causedMovement) return { accepted: false, reason: 'no-movement' };

    const resolution = this.resolve('specialFoul', this.skillUser);
    return { accepted: true, resolution };
  }

  opponentPlaced(causedMovement = true): FakeFreeBallActionResult {
    return this.recordOpponentAction({ type: 'place', causedMovement });
  }

  opponentShot(causedMovement: boolean): FakeFreeBallActionResult {
    return this.recordOpponentAction({ type: 'shot', causedMovement });
  }

  private resolveTimeout(): FakeFreeBallResolution {
    return this.resolve('timeout', otherSeat(this.skillUser));
  }

  private resolve(kind: 'specialFoul' | 'timeout', freeBallFor: Seat): FakeFreeBallResolution {
    if (this.currentResolution) return this.currentResolution;
    const resolution: FakeFreeBallResolution = Object.freeze({
      kind,
      freeBallFor,
      trueFreeBall: true as const,
      elapsedMs: this.elapsed,
    });
    this.elapsed = Math.min(this.elapsed, FAKE_FREE_BALL_DURATION_MS);
    this.currentStatus = kind;
    this.currentResolution = resolution;
    return resolution;
  }
}
