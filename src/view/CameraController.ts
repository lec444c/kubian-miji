import * as THREE from 'three';

export type CameraMode = 'orbit' | 'top' | 'aim';
export type CameraPhase = 'aiming' | 'rolling' | 'placing' | 'other';
export type CameraAdjustment = 'fov' | 'distance' | 'look' | 'height';

/** True while a camera is above, or inside, an overhead object's footprint.
 * Mode names change at the start of a 0.9-second move, so visibility must use
 * the actual camera position rather than the destination mode. */
export function cameraInOverheadVolume(position: THREE.Vector3, bounds: THREE.Box3, margin = 0.1): boolean {
  if (bounds.isEmpty()) return false;
  return position.y > bounds.min.y - margin
    && position.x >= bounds.min.x - margin && position.x <= bounds.max.x + margin
    && position.z >= bounds.min.z - margin && position.z <= bounds.max.z + margin;
}

/**
 * First-person cue camera while aiming. The moment a shot is struck — and while
 * placing the cue ball (break or ball-in-hand) — the view rises straight to the
 * top-down view so the whole table stays readable; it returns to first person
 * when the next aim begins. `worldScale` matches the scene's visual enlargement
 * so framing stays correct while physics remains in unscaled metres.
 */
export class CameraController {
  mode: CameraMode = 'aim';
  private phase: CameraPhase = 'other';
  private desired = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  private cuePosition = new THREE.Vector3();
  private aimAngle = 0;
  private aimYawOffset = 0;
  private orbitYaw = Math.PI / 2;
  // Orbit stays inside the sitting room: interior half-width ~4.05 m and
  // ceiling 3.95 m in world units, i.e. 2.53 / 2.47 in local (pre-scale) metres.
  private orbitDistance = 2.3;
  private orbitHeight = 1.9;
  private aimDistance = 0.62;
  private aimHeight = 0.31;
  private aimLook = 0.025;
  private targetFov = 48;
  private lastUpdateMs: number | null = null;
  private transition: {
    elapsed: number;
    duration: number;
    fromPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    fromFov: number;
  } | null = null;

  constructor(private camera: THREE.PerspectiveCamera, private worldScale = 1) {
    this.desired.set(0, 1.9 * worldScale, 2.3 * worldScale);
    this.desiredTarget.set(0, 0.79 * worldScale, 0);
    this.lookTarget.copy(this.desiredTarget);
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.lookTarget);
  }

  setPhase(phase: CameraPhase): void {
    if (phase === this.phase) return;
    this.phase = phase;
    // Rolling and placing both read best from directly above; aiming returns
    // to the first-person cue view, everything else settles into orbit.
    this.mode = phase === 'aiming' ? 'aim' : phase === 'other' ? 'orbit' : 'top';
    this.applyMode();
    this.beginTransition();
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.applyMode();
    this.beginTransition();
  }

  private beginTransition(): void {
    this.transition = {
      elapsed: 0,
      // A visible, eased move lets the player follow a strike or placement. Once
      // it ends, normal within-mode damping remains fast for aim/orbit tracking.
      duration: 0.9,
      fromPosition: this.camera.position.clone(),
      fromTarget: this.lookTarget.clone(),
      fromFov: this.camera.fov,
    };
  }

  private applyMode(): void {
    if (this.mode === 'top') {
      this.desired.set(0, 3.35 * this.worldScale, 0.01);
      this.desiredTarget.set(0, 0.79 * this.worldScale, 0);
    } else if (this.mode === 'orbit') {
      this.updateOrbitDesired();
    } else {
      this.updateAimDesired();
    }
  }

  setAim(angle: number, cuePosition: THREE.Vector3): void {
    this.aimAngle = angle;
    this.cuePosition.copy(cuePosition);
    if (this.mode === 'aim') this.updateAimDesired();
  }

  private updateAimDesired(): void {
    const s = this.worldScale;
    const direction = new THREE.Vector3(Math.cos(this.aimAngle), 0, Math.sin(this.aimAngle));
    // Right-drag orbits; in aim mode it pulls the viewpoint back and raises it.
    const cameraAzimuth = this.aimAngle + this.aimYawOffset;
    const back = new THREE.Vector3(Math.cos(cameraAzimuth), 0, Math.sin(cameraAzimuth));
    this.desired.copy(this.cuePosition).addScaledVector(back, -this.aimDistance * s);
    this.desired.y = this.cuePosition.y + this.aimHeight * s;
    // Round 7: keep the first-person camera inside the room and above the rail
    // cap. Without this, aiming along a rail pushed the viewpoint into the
    // sideboard wood (the "cue through furniture" screenshot). Local metres:
    // room interior half-width ~2.53, rail cap top 0.8469 (1.355 / 1.6).
    this.desired.x = THREE.MathUtils.clamp(this.desired.x, -1.55 * s, 1.55 * s);
    this.desired.z = THREE.MathUtils.clamp(this.desired.z, -0.95 * s, 0.95 * s);
    const localX = this.desired.x / s;
    const localZ = this.desired.z / s;
    if (Math.abs(localX) > 1.2122 || Math.abs(localZ) > 0.5794) {
      this.desired.y = Math.max(this.desired.y, (0.8469 + 0.08) * s);
    }
    this.desiredTarget.copy(this.cuePosition).addScaledVector(direction, 0.48 * s);
    this.desiredTarget.y = this.cuePosition.y + this.aimLook * s;
  }

  private updateOrbitDesired(): void {
    const s = this.worldScale;
    this.desired.set(
      Math.cos(this.orbitYaw) * this.orbitDistance * s,
      this.orbitHeight * s,
      Math.sin(this.orbitYaw) * this.orbitDistance * s,
    );
    this.desiredTarget.set(0, 0.79 * s, 0);
  }

  orbit(deltaX: number, deltaY: number): void {
    if (this.mode === 'aim') {
      this.aimDistance = THREE.MathUtils.clamp(this.aimDistance + deltaX * 0.0015, 0.28, 1.25);
      this.aimHeight = THREE.MathUtils.clamp(this.aimHeight - deltaY * 0.002, 0.09, 0.9);
      this.updateAimDesired();
      return;
    }
    if (this.mode !== 'orbit') return;
    this.orbitYaw += deltaX * 0.004;
    this.orbitHeight = THREE.MathUtils.clamp(this.orbitHeight + deltaY * 0.005, 1.15, 2.2);
    this.updateOrbitDesired();
  }

  /** Mouse-wheel push/pull along the current view axis; top view stays fixed. */
  zoom(deltaY: number): void {
    const step = THREE.MathUtils.clamp(deltaY, -160, 160) * 0.0016;
    if (this.mode === 'aim') {
      this.aimDistance = THREE.MathUtils.clamp(this.aimDistance + step, 0.28, 1.25);
      this.updateAimDesired();
    } else if (this.mode === 'orbit') {
      this.orbitDistance = THREE.MathUtils.clamp(this.orbitDistance + step, 1.8, 2.4);
      this.updateOrbitDesired();
    }
  }

  adjust(parameter: CameraAdjustment, delta: number): void {
    if (parameter === 'fov') this.targetFov = THREE.MathUtils.clamp(this.targetFov + delta * 8, 32, 72);
    if (parameter === 'look') this.aimLook = THREE.MathUtils.clamp(this.aimLook + delta * 0.12, -0.08, 0.35);
    if (parameter === 'height') {
      if (this.mode === 'aim') this.aimHeight = THREE.MathUtils.clamp(this.aimHeight + delta * 0.2, 0.09, 0.9);
      else this.orbitHeight = THREE.MathUtils.clamp(this.orbitHeight + delta * 0.35, 1.15, 2.2);
    }
    if (parameter === 'distance') {
      if (this.mode === 'aim') this.aimDistance = THREE.MathUtils.clamp(this.aimDistance + delta * 0.16, 0.28, 1.25);
      else this.orbitDistance = THREE.MathUtils.clamp(this.orbitDistance + delta * 0.3, 1.8, 2.4);
    }
    this.applyMode();
  }

  resetAim(): void {
    this.aimDistance = 0.62;
    this.aimHeight = 0.31;
    this.aimLook = 0.025;
    this.aimYawOffset = 0;
    this.targetFov = 48;
    this.applyMode();
  }

  update(timeMs: number = performance.now()): void {
    // Frame-rate independent damping: per-frame lerp factors would converge in
    // frame count, so at low FPS the view keeps creeping for seconds and screen
    // picks drift. Exponential smoothing keeps the same feel at 60 FPS and
    // settles in wall-clock time on slow devices.
    const dt = this.lastUpdateMs === null ? 1 / 60 : Math.min(0.5, Math.max(0, (timeMs - this.lastUpdateMs) / 1000));
    this.lastUpdateMs = timeMs;
    if (this.mode === 'aim') this.updateAimDesired();
    if (this.transition) {
      const transition = this.transition;
      transition.elapsed += dt;
      const progress = Math.min(1, transition.elapsed / transition.duration);
      // Smoothstep has zero velocity at both ends: no sudden cut when a shot
      // starts, and no camera snap when the destination is reached.
      const eased = progress * progress * (3 - 2 * progress);
      this.camera.position.lerpVectors(transition.fromPosition, this.desired, eased);
      this.lookTarget.lerpVectors(transition.fromTarget, this.desiredTarget, eased);
      this.camera.fov = THREE.MathUtils.lerp(transition.fromFov, this.targetFov, eased);
      this.camera.updateProjectionMatrix();
      if (progress >= 1) {
        this.camera.position.copy(this.desired);
        this.lookTarget.copy(this.desiredTarget);
        this.camera.fov = this.targetFov;
        this.camera.updateProjectionMatrix();
        this.transition = null;
      }
      this.camera.lookAt(this.lookTarget);
      return;
    }
    this.camera.position.lerp(this.desired, 1 - Math.exp(-dt * 9));
    this.lookTarget.lerp(this.desiredTarget, 1 - Math.exp(-dt * 10));
    // Snap to exact rest once close: residual sub-millimetre creep would otherwise
    // drift screen-space pick coordinates between probe and click on slow devices.
    if (this.camera.position.distanceToSquared(this.desired) < 1e-5) this.camera.position.copy(this.desired);
    if (this.lookTarget.distanceToSquared(this.desiredTarget) < 1e-5) this.lookTarget.copy(this.desiredTarget);
    const nextFov = THREE.MathUtils.lerp(this.camera.fov, this.targetFov, 1 - Math.exp(-dt * 9));
    if (Math.abs(nextFov - this.camera.fov) > 0.001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    } else if (this.camera.fov !== this.targetFov && Math.abs(this.targetFov - this.camera.fov) < 0.01) {
      this.camera.fov = this.targetFov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.lookTarget);
  }

  getDebugState(): { mode: CameraMode; position: number[]; target: number[]; fov: number } {
    return {
      mode: this.mode,
      position: this.camera.position.toArray(),
      target: this.lookTarget.toArray(),
      fov: this.camera.fov,
    };
  }
}