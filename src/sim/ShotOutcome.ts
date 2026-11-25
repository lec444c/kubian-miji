export interface PocketedBall {
  ballId: number;
  pocketId: number;
  step: number;
}

/** Read-only presentation notifications emitted during fixed steps. They never
 * feed back into physics; the audio layer is the only consumer. */
export type PhysicsEvent =
  | { kind: 'ballHit'; strength: number }
  | { kind: 'cushion'; strength: number }
  | { kind: 'pocket'; ballId: number };

export interface ShotOutcome {
  shotId: number;
  shooter: 0 | 1;
  firstContact: number | null;
  cushionContacts: number[];
  cushionAfterContact: boolean;
  pocketed: PocketedBall[];
  cueScratch: boolean;
  flewOffTable: number[];
  anyBallMoved: boolean;
  startedStep: number;
  endedStep: number;
}

export function emptyShotOutcome(shotId: number, shooter: 0 | 1, startedStep: number): ShotOutcome {
  return {
    shotId, shooter, firstContact: null, cushionContacts: [], cushionAfterContact: false,
    pocketed: [], cueScratch: false, flewOffTable: [], anyBallMoved: false,
    startedStep, endedStep: startedStep,
  };
}
