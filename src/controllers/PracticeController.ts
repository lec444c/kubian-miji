import type { Seat } from '../app/matchTypes';
import { HumanController } from './HumanController';

export class PracticeController {
  readonly human = new HumanController();
  controlsSeat(_seat: Seat): boolean { return true; }
  currentController(_seat: Seat): HumanController { return this.human; }
}
