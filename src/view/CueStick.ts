import * as THREE from 'three';
import { BALL_RADIUS, CUSHION_HALF_X, CUSHION_HALF_Y } from '../sim/SimulationState';

export const CUE_LENGTH = 1.45;
export const CUE_DIAMETER = 0.031;

const BED_Y = 0.79;
const BALL_Y = BED_Y + BALL_RADIUS;
/** Traditional table rail cap top in simulation metres (world 1.355 / 1.6). */
const RAIL_TOP = 1.355 / 1.6;
const CUE_RADIUS = CUE_DIAMETER / 2;
const BASE_TILT = (5 * Math.PI) / 180;
const MAX_TILT = (30 * Math.PI) / 180;

export interface CuePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tilt: number;
  gap: number;
}

/**
 * Pure aiming pose: the cue axis line passes through the cue-ball centre, the
 * tip keeps a safe surface gap, and the shaft elevates enough to clear the rail
 * cap wherever the butt crosses it (steep bridge when the ball freezes to a
 * cushion). No penetration of ball or rail by construction.
 */
export function computeCuePose(ballX: number, ballZ: number, angle: number, power: number, charging: boolean): CuePose {
  const backX = -Math.cos(angle);
  const backZ = -Math.sin(angle);
  const tx = backX > 1e-6 ? (CUSHION_HALF_X - ballX) / backX : backX < -1e-6 ? (-CUSHION_HALF_X - ballX) / backX : Infinity;
  const tz = backZ > 1e-6 ? (CUSHION_HALF_Y - ballZ) / backZ : backZ < -1e-6 ? (-CUSHION_HALF_Y - ballZ) / backZ : Infinity;
  const noseDistance = Math.min(tx, tz);
  const rise = RAIL_TOP + CUE_RADIUS + 0.004 - BALL_Y;
  let gap = 0.008 + (charging ? power * 0.18 : 0);
  let tilt = BASE_TILT;
  const firstRail = noseDistance - (BALL_RADIUS + gap);
  if (firstRail < CUE_LENGTH) {
    const need = rise / Math.max(firstRail, 1e-4);
    if (need > Math.sin(MAX_TILT)) {
      tilt = MAX_TILT;
      gap = Math.max(gap, rise / Math.sin(MAX_TILT) - BALL_RADIUS + 0.002);
    } else {
      tilt = Math.max(tilt, Math.asin(need));
    }
  }
  const reach = BALL_RADIUS + gap;
  const axisX = Math.cos(tilt) * Math.cos(angle);
  const axisY = -Math.sin(tilt);
  const axisZ = Math.cos(tilt) * Math.sin(angle);
  return {
    x: ballX - axisX * reach,
    y: BALL_Y - axisY * reach,
    z: ballZ - axisZ * reach,
    yaw: -angle,
    tilt: -tilt,
    gap,
  };
}

/**
 * Normalises the supplied CC0 cue-stick GLB (plaggy, CC-BY-4.0): the shaft lies
 * diagonally in world space, so the long axis comes from a covariance power
 * iteration, the thinner end becomes the tip at local x=0 (butt along -X),
 * length scales to CUE_LENGTH and butt diameter to CUE_DIAMETER.
 */
export function createCueStick(model: THREE.Group): THREE.Group | null {
  const baked: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }> = [];
  model.updateMatrixWorld(true);
  model.traverse(child => {
    if (child instanceof THREE.Mesh) {
      const geometry = child.geometry.clone();
      geometry.applyMatrix4(child.matrixWorld);
      baked.push({ geometry, material: child.material });
    }
  });
  if (!baked.length) return null;
  const points: THREE.Vector3[] = [];
  for (const { geometry } of baked) {
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) points.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  if (points.length < 8) return null;
  const centre = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = [p.x - centre.x, p.y - centre.y, p.z - centre.z];
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) cov[i * 3 + k] = (cov[i * 3 + k] ?? 0) + d[i]! * d[k]!;
  }
  let axis = new THREE.Vector3(0, 0, 1);
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const next = new THREE.Vector3(
      cov[0]! * axis.x + cov[1]! * axis.y + cov[2]! * axis.z,
      cov[3]! * axis.x + cov[4]! * axis.y + cov[5]! * axis.z,
      cov[6]! * axis.x + cov[7]! * axis.y + cov[8]! * axis.z,
    );
    if (next.lengthSq() < 1e-12) break;
    axis = next.normalize();
  }
  const along = points.map(p => p.clone().sub(centre).dot(axis));
  const tMin = Math.min(...along);
  const tMax = Math.max(...along);
  const span = Math.max(tMax - tMin, 1e-6);
  const endRadius = (end: number): number => {
    let maxR = 1e-6;
    points.forEach((p, i) => {
      if (Math.abs(along[i]! - end) > span * 0.03) return;
      const d = p.clone().sub(centre);
      const radial = d.clone().addScaledVector(axis, -d.dot(axis));
      maxR = Math.max(maxR, radial.length());
    });
    return maxR;
  };
  const tipAtMin = endRadius(tMin) <= endRadius(tMax);
  const tipDirection = axis.clone().multiplyScalar(tipAtMin ? -1 : 1);
  const align = new THREE.Quaternion().setFromUnitVectors(tipDirection, new THREE.Vector3(1, 0, 0));
  for (const { geometry } of baked) geometry.applyQuaternion(align);
  const box = new THREE.Box3();
  for (const { geometry } of baked) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox!);
  }
  const size = box.getSize(new THREE.Vector3());
  let cy = 0;
  let cz = 0;
  let maxR = 1e-6;
  for (const { geometry } of baked) {
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      cy += pos.getY(i);
      cz += pos.getZ(i);
    }
  }
  cy /= points.length;
  cz /= points.length;
  for (const { geometry } of baked) {
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) maxR = Math.max(maxR, Math.hypot(pos.getY(i) - cy, pos.getZ(i) - cz));
  }
  const lengthScale = CUE_LENGTH / Math.max(size.x, 1e-6);
  const radialScale = CUE_DIAMETER / (2 * maxR);
  const group = new THREE.Group();
  group.name = 'cue-stick';
  for (const { geometry, material } of baked) {
    geometry.scale(lengthScale, radialScale, radialScale);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(-box.max.x * lengthScale, -cy * radialScale, -cz * radialScale);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  return group;
}