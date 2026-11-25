/** Round 8 spin picker: a real cue-ball face instead of nine preset dots.
 * Clicking or dragging any point inside the circle commands that exact contact
 * point (unit disc, y up = follow), which Simulation.strike turns into roll and
 * side spin. Presentation only: it never touches authoritative ball state. */
const FACE_RADIUS = 46; // viewBox units, the drawable ball edge
const KEY_STEP = 0.05;
const KEY_FINE_STEP = 0.012;
const EDGE_WARN = 0.92;

function clampToFace(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length <= 1) return { x, y };
  return { x: x / length, y: y / length };
}

function describe(spin: { x: number; y: number }): string {
  const parts: string[] = [];
  if (Math.abs(spin.y) >= 0.06) parts.push(`${spin.y > 0 ? '高杆' : '低杆'} ${Math.abs(spin.y).toFixed(2)}`);
  if (Math.abs(spin.x) >= 0.06) parts.push(`${spin.x > 0 ? '右塞' : '左塞'} ${Math.abs(spin.x).toFixed(2)}`);
  if (!parts.length) return '中杆 · 无塞';
  if (Math.hypot(spin.x, spin.y) > EDGE_WARN) parts.push('接近滑杆极限');
  return parts.join(' · ');
}

export class SpinFace {
  readonly element = document.createElement('div');
  private face: HTMLElement;
  private marker: SVGCircleElement;
  private vector: SVGLineElement;
  private readout: HTMLElement;
  private dragging = false;
  private current = { x: 0, y: 0 };

  constructor(private onSpin: (x: number, y: number) => void) {
    this.element.className = 'spin-face-wrap';
    this.element.innerHTML = `
      <div class="spin-face" data-spin-face tabindex="0" role="application" aria-label="杆法击球点：中杆 · 无塞">
        <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id="spin-face-shade" cx="36%" cy="30%" r="80%">
              <stop offset="0%" stop-color="#ffffff"/>
              <stop offset="52%" stop-color="#f6efe4"/>
              <stop offset="100%" stop-color="#c9b8a1"/>
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="${FACE_RADIUS}" fill="url(#spin-face-shade)" stroke="#ded3c0" stroke-width="1.6"/>
          <circle cx="50" cy="50" r="${FACE_RADIUS / 2}" fill="none" stroke="#cdbda6" stroke-width="0.9" stroke-dasharray="3 3"/>
          <path d="M50 5 V95 M5 50 H95" stroke="#c0ae95" stroke-width="0.9" stroke-dasharray="4 4" opacity="0.75"/>
          <line data-spin-vector x1="50" y1="50" x2="50" y2="50" stroke="#a56a24" stroke-width="2.2" stroke-linecap="round" opacity="0.5"/>
          <circle data-spin-marker cx="50" cy="50" r="6.6" fill="#c98a3d" stroke="#fffdf8" stroke-width="2.4"/>
        </svg>
      </div>
      <div class="spin-face-meta">
        <span class="spin-readout" data-spin-readout>中杆 · 无塞</span>
        <button class="spin-reset" data-spin-reset type="button" title="击球点回到球心（中杆）">回中</button>
      </div>`;
    this.face = this.element.querySelector<HTMLElement>('[data-spin-face]')!;
    this.marker = this.element.querySelector<SVGCircleElement>('[data-spin-marker]')!;
    this.vector = this.element.querySelector<SVGLineElement>('[data-spin-vector]')!;
    this.readout = this.element.querySelector<HTMLElement>('[data-spin-readout]')!;
    this.element.querySelector<HTMLButtonElement>('[data-spin-reset]')!.addEventListener('click', () => {
      this.current = { x: 0, y: 0 };
      this.onSpin(0, 0);
      this.paint();
    });
    this.face.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.dragging = true;
      this.face.setPointerCapture(event.pointerId);
      // Deliberately no focus steal: WASD/arrow keys must keep their global
      // aim/spin meaning after a mouse click. Keyboard users reach the face
      // with Tab, and then its own arrow handling takes over.
      this.applyPointer(event.clientX, event.clientY);
    });
    this.face.addEventListener('pointermove', event => {
      if (this.dragging) this.applyPointer(event.clientX, event.clientY);
    });
    const endDrag = (event: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.face.hasPointerCapture(event.pointerId)) this.face.releasePointerCapture(event.pointerId);
    };
    this.face.addEventListener('pointerup', endDrag);
    this.face.addEventListener('pointercancel', endDrag);
    this.face.addEventListener('keydown', event => {
      const dirs: Record<string, [number, number]> = {
        ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
        KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0],
      };
      const dir = dirs[event.code];
      if (dir) {
        // The window-level aim/spin handler must not also fire for these keys.
        event.preventDefault();
        event.stopPropagation();
        const step = event.altKey ? KEY_FINE_STEP : KEY_STEP;
        this.set(this.current.x + dir[0] * step, this.current.y + dir[1] * step);
        return;
      }
      if (event.code === 'Home' || event.code === 'Backspace' || event.code === 'Delete') {
        event.preventDefault();
        event.stopPropagation();
        this.set(0, 0);
      }
    });
    this.paint();
  }

  private applyPointer(clientX: number, clientY: number): void {
    const rect = this.face.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const vx = ((clientX - rect.left) / rect.width) * 100;
    const vy = ((clientY - rect.top) / rect.height) * 100;
    this.set((vx - 50) / FACE_RADIUS, (50 - vy) / FACE_RADIUS);
  }

  private set(x: number, y: number): void {
    this.current = clampToFace(x, y);
    this.onSpin(this.current.x, this.current.y);
    this.paint();
  }

  /** Reflect the authoritative spin (keyboard nudges included) without echoing
   * a callback, so the marker never fights the controller. */
  update(spin: { x: number; y: number }, locked: boolean): void {
    this.current = clampToFace(spin.x, spin.y);
    this.element.classList.toggle('locked', locked);
    this.paint();
  }

  private paint(): void {
    const cx = 50 + this.current.x * FACE_RADIUS;
    const cy = 50 - this.current.y * FACE_RADIUS;
    this.marker.setAttribute('cx', cx.toFixed(2));
    this.marker.setAttribute('cy', cy.toFixed(2));
    this.vector.setAttribute('x2', cx.toFixed(2));
    this.vector.setAttribute('y2', cy.toFixed(2));
    const edge = Math.hypot(this.current.x, this.current.y) > EDGE_WARN;
    this.marker.setAttribute('fill', edge ? '#c0453e' : '#c98a3d');
    this.element.classList.toggle('at-edge', edge);
    const label = describe(this.current);
    this.readout.textContent = label;
    this.face.setAttribute('aria-label', `杆法击球点：${label}。点击或拖动球面选择加塞位置，方向键微调，Home 回中`);
  }
}