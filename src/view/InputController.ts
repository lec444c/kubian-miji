import type { SceneView } from './SceneView';

// Round 8 control scheme (Poolians-style):
//   move mouse          -> aim (relative, unbounded so any number of full turns
//                          is reachable in every camera mode; Alt quarters the rate)
//   left press + pull   -> charge; power proportional to backward drag distance
//   left release        -> strike (a plain click still picks a ball / aims)
//   right click (no drag)-> lock / unlock the cue so the spin panel can be used
//   right drag / Shift+left drag -> orbit the camera
//   wheel               -> fine aim; Shift+wheel pushes/pulls the view
//   Esc / blur          -> cancel a pending charge without striking
// Round 8: the free-aim rate is 2.3x round 7 so a short flick turns the cue
// decisively, while the wheel step is 3x finer for the last fraction of a degree.
const MOUSE_AIM_RATE = 0.008;
// Round 13 (0.004 -> 0.0005): the user asked for a much finer single key press.
// One A/D or arrow tap now turns the cue 0.0005 rad (~0.029 deg), the same
// granularity as one wheel notch; Alt quarters it to 0.000125 rad (~0.007 deg).
const ARROW_AIM_STEP = 0.0005;
const WHEEL_AIM_STEP = 0.0005;
const FINE_FACTOR = 0.25;
// Mouse Alt precision is tighter than the keyboard's: a pixel is already a much
// smaller intent than a key press, so Alt+move gives 0.00096 rad (~0.055 deg).
const MOUSE_FINE_FACTOR = 0.12;
const DRAG_POWER_PIXELS = 220;
const DRAG_THRESHOLD = 8;
const CLICK_SLOP = 5;

export class InputController {
  private draggingCamera = false;
  private draggingPlacement = false;
  private rightPress = false;
  private cameraTravel = 0;
  private leftDown = false;
  private dragStrike = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastX = 0;
  private lastY = 0;
  private hasLast = false;

  /** Drop pointer gestures across menus so a later pointerup cannot shoot. */
  reset(): void {
    this.draggingCamera = false;
    this.draggingPlacement = false;
    this.rightPress = false;
    this.cameraTravel = 0;
    this.leftDown = false;
    this.dragStrike = false;
    this.hasLast = false;
  }

  constructor(private view: SceneView, callbacks: {
    onAim: (point: { x: number; y: number }) => void;
    onTableClick: (point: { x: number; y: number }) => void;
    onBallClick: (ballId: number) => void;
    onChargeCancel: () => void;
    onCamera: () => void;
    onNudgeAim: (delta: number) => void;
    onFineAim: (delta: number) => void;
    onNudgeSpin: (x: number, y: number) => void;
    onKeyMove: (dx: number, dy: number, fine: boolean) => void;
    onPlaceConfirm: () => void;
    onToggleLock: () => void;
    cueLocked: () => boolean;
    strikeBackDirection: () => { x: number; y: number } | null;
    onStrikeDragStart: () => boolean;
    onStrikeDrag: (power: number) => void;
    onStrikeDragEnd: (strike: boolean) => void;
    placingActive: () => boolean;
    onPlaceDrag: (point: { x: number; y: number }) => void;
  }) {
    const canvas = view.renderer.domElement;
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      this.lastX = event.clientX; this.lastY = event.clientY; this.hasLast = true;
      if (event.button === 2 || event.shiftKey) {
        this.draggingCamera = true;
        this.rightPress = event.button === 2;
        this.cameraTravel = 0;
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      if (event.button !== 0) return;
      // While placing (break or ball-in-hand) a left press/drag moves the cue
      // ball cursor directly; Space/Enter confirms. No aim nudge or ball pick.
      if (callbacks.placingActive()) {
        this.draggingPlacement = true;
        canvas.setPointerCapture(event.pointerId);
        const point = view.screenToTable(event.clientX, event.clientY);
        if (point) callbacks.onPlaceDrag(point);
        return;
      }
      this.leftDown = true;
      this.dragStrike = false;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (this.draggingCamera) {
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        this.cameraTravel += Math.hypot(dx, dy);
        view.orbit(dx, dy);
        this.lastX = event.clientX; this.lastY = event.clientY;
        return;
      }
      if (this.draggingPlacement) {
        this.lastX = event.clientX; this.lastY = event.clientY;
        const point = view.screenToTable(event.clientX, event.clientY);
        if (point) callbacks.onPlaceDrag(point);
        return;
      }
      if (this.leftDown) {
        const back = callbacks.strikeBackDirection() ?? { x: 0, y: 1 };
        const pull = (event.clientX - this.dragStartX) * back.x + (event.clientY - this.dragStartY) * back.y;
        if (!this.dragStrike) {
          if (pull <= DRAG_THRESHOLD) { this.lastX = event.clientX; this.lastY = event.clientY; return; }
          this.dragStrike = callbacks.onStrikeDragStart();
          if (!this.dragStrike) { this.leftDown = false; return; }
        }
        callbacks.onStrikeDrag(Math.max(0, pull) / DRAG_POWER_PIXELS);
        this.lastX = event.clientX; this.lastY = event.clientY;
        return;
      }
      if (!this.hasLast) {
        this.lastX = event.clientX; this.lastY = event.clientY; this.hasLast = true;
        return;
      }
      const dx = event.clientX - this.lastX;
      this.lastX = event.clientX; this.lastY = event.clientY;
      if (dx !== 0 && !callbacks.cueLocked()) callbacks.onNudgeAim(dx * MOUSE_AIM_RATE * (event.altKey ? MOUSE_FINE_FACTOR : 1));
    });
    canvas.addEventListener('pointerleave', () => { this.hasLast = false; });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      if (event.shiftKey) view.zoomCamera(event.deltaY);
      else callbacks.onFineAim(Math.sign(event.deltaY) * WHEEL_AIM_STEP * (event.altKey ? MOUSE_FINE_FACTOR : 1));
    }, { passive: false });
    const stopDrag = (): void => {
      if (this.dragStrike) callbacks.onStrikeDragEnd(false);
      this.draggingCamera = false; this.draggingPlacement = false;
      this.leftDown = false; this.dragStrike = false; this.rightPress = false;
    };
    canvas.addEventListener('pointerup', event => {
      if (this.draggingCamera) {
        const wasRightClick = this.rightPress && this.cameraTravel < CLICK_SLOP;
        this.draggingCamera = false; this.rightPress = false;
        if (wasRightClick) callbacks.onToggleLock();
        return;
      }
      if (this.draggingPlacement) { this.draggingPlacement = false; return; }
      if (this.leftDown) {
        this.leftDown = false;
        if (this.dragStrike) { this.dragStrike = false; callbacks.onStrikeDragEnd(true); return; }
        const ball = view.pickBall(event.clientX, event.clientY);
        if (ball !== null) { callbacks.onBallClick(ball); return; }
        const point = view.screenToTable(event.clientX, event.clientY);
        if (point) callbacks.onTableClick(point);
      }
    });
    canvas.addEventListener('pointercancel', stopDrag);
    window.addEventListener('keydown', event => {
      if (event.code === 'Escape') {
        if (this.dragStrike) { this.dragStrike = false; this.leftDown = false; callbacks.onStrikeDragEnd(false); }
        callbacks.onChargeCancel();
        return;
      }
      if (event.code === 'Space') {
        // Space is placement-only. In aiming it must not touch mouse charging
        // or swallow native keyboard activation of unrelated UI buttons.
        if (callbacks.placingActive()) {
          event.preventDefault();
          if (!event.repeat) callbacks.onPlaceConfirm();
        }
        return;
      }
      const editingRange = event.target instanceof HTMLInputElement;
      if (!editingRange) {
        // WASD mirrors the arrow keys exactly: aim left/right, spin up/down,
        // Shift+direction sidespin. During ball-in-hand GameController routes
        // the same keys to the placement cursor instead. Alt quarters steps.
        const dirs: Record<string, [number, number]> = {
          KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
          ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
        };
        const dir = dirs[event.code];
        if (dir) {
          event.preventDefault();
          callbacks.onKeyMove(dir[0], dir[1], event.altKey);
          const fine = event.altKey ? FINE_FACTOR : 1;
          if (event.shiftKey) callbacks.onNudgeSpin(dir[0] * 0.08, -dir[1] * 0.08);
          else if (dir[0] !== 0) callbacks.onNudgeAim(dir[0] * ARROW_AIM_STEP * fine);
          else callbacks.onNudgeSpin(0, -dir[1] * 0.08);
          return;
        }
        if (event.code === 'Enter' && !event.repeat) {
          callbacks.onPlaceConfirm();
          return;
        }
      }
      if ((event.code === 'KeyC' || event.code === 'KeyO' || event.code === 'KeyZ') && !event.repeat) callbacks.onCamera();
      const adjustments: Record<string, ['fov' | 'distance' | 'look', number]> = {
        Digit1: ['fov', -1], Digit2: ['fov', 1],
        Digit3: ['distance', -1], Digit4: ['distance', 1],
        Digit5: ['look', -1], Digit6: ['look', 1],
      };
      const adjustment = adjustments[event.code];
      if (adjustment) {
        event.preventDefault();
        view.adjustCamera(...adjustment);
      }
      if (event.code === 'Digit7' && !event.repeat) view.resetCamera();
    });
    window.addEventListener('blur', () => {
      if (this.dragStrike) { this.dragStrike = false; this.leftDown = false; callbacks.onStrikeDragEnd(false); }
      callbacks.onChargeCancel();
    });
  }
}