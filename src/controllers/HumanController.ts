import { MIN_SHOT_POWER } from '../view/charge';

export class HumanController {
  angle = 0;
  power = 0.56;
  spin = { x: 0, y: 0 };

  adjustAngle(delta: number): void { this.angle += delta; }
  setPower(power: number): void { this.power = Math.max(MIN_SHOT_POWER, Math.min(1, power)); }
  setSpin(x: number, y: number): void { this.spin = { x, y }; }
  resetShot(): void { this.spin = { x: 0, y: 0 }; }
}
