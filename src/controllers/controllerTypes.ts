import type { Seat } from '../app/matchTypes';

export interface SeatController {
  controlsSeat(seat: Seat): boolean;
  cancelPending?(): void;
}
