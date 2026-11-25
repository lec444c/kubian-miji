import * as THREE from 'three';
import { BALL_RADIUS, CUSHION_HALF_X, CUSHION_HALF_Y } from '../sim/SimulationState';

/**
 * Runtime installer for the CC-BY "Pool Table Traditional" GLB (fizyman).
 * The export is millimetre-scaled with a Z-up authoring basis baked into node
 * matrices, so every fit is measured from transformed vertices instead of
 * hard-coded offsets. Physics geometry (cloth edge / cushion nose) stays
 * authoritative: the visual model is scaled so its cushion nose lands exactly
 * on CUSHION_HALF_X / CUSHION_HALF_Y and its cloth top on BED_Y.
 */

export interface TraditionalTableFit {
  clothTopY: number;
  noseX: number;
  noseZ: number;
  bedHalfX: number;
  bedHalfZ: number;
}

function meshesWithMaterial(root: THREE.Object3D, materialName: string): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some(material => material && material.name === materialName)) found.push(mesh);
  });
  return found;
}

/** Bake each mesh's world transform into cloned geometry so measurements and
 * re-orientation happen in a single flat space. Returns raw points plus world
 *-space triangles for tessellation-independent probe measurements. */
function bakedGeometry(meshes: THREE.Mesh[], root: THREE.Object3D): { points: Float32Array; tris: Float32Array } {
  root.updateMatrixWorld(true);
  const pointChunks: Float32Array[] = [];
  const triChunks: Float32Array[] = [];
  let pointTotal = 0, triTotal = 0;
  const point = new THREE.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const array = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      array[i * 3] = point.x; array[i * 3 + 1] = point.y; array[i * 3 + 2] = point.z;
    }
    pointChunks.push(array);
    pointTotal += array.length;
    const index = mesh.geometry.getIndex();
    const triCount = index ? index.count / 3 : position.count / 3;
    const tris = new Float32Array(triCount * 9);
    for (let t = 0; t < triCount; t++) {
      for (let v = 0; v < 3; v++) {
        const vertex = index ? index.getX(t * 3 + v) : t * 3 + v;
        tris[t * 9 + v * 3] = array[vertex * 3]!;
        tris[t * 9 + v * 3 + 1] = array[vertex * 3 + 1]!;
        tris[t * 9 + v * 3 + 2] = array[vertex * 3 + 2]!;
      }
    }
    triChunks.push(tris);
    triTotal += tris.length;
  }
  const points = new Float32Array(pointTotal);
  const tris = new Float32Array(triTotal);
  let offset = 0;
  for (const chunk of pointChunks) { points.set(chunk, offset); offset += chunk.length; }
  offset = 0;
  for (const chunk of triChunks) { tris.set(chunk, offset); offset += chunk.length; }
  return { points, tris };
}

/** Innermost |measureAxis| coordinate where the cushion surface crosses the
 * probe line (fixedAxis = fixedValue, y = yProbe). Independent of tessellation. */
export function probeNose(tris: Float32Array, fixedAxis: number, fixedValue: number, measureAxis: number, yProbe: number): number {
  let best = Infinity;
  for (let t = 0; t < tris.length; t += 9) {
    const d = [0, 1, 2].map(v => tris[t + v * 3 + fixedAxis]! - fixedValue);
    const [d0, d1, d2] = d as [number, number, number];
    if ((d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 < 0 && d1 < 0 && d2 < 0)) continue;
    const crosses: number[][] = [];
    for (let e = 0; e < 3; e++) {
      const a = e, b = (e + 1) % 3;
      const da = d[a]!, db = d[b]!;
      if ((da >= 0) === (db >= 0)) continue;
      const ratio = da / (da - db);
      crosses.push([0, 1, 2].map(axis => tris[t + a * 3 + axis]! + ratio * (tris[t + b * 3 + axis]! - tris[t + a * 3 + axis]!)));
    }
    if (crosses.length < 2) continue;
    const p = crosses[0]!, q = crosses[1]!;
    const py = p[1]!, qy = q[1]!;
    if ((py - yProbe) * (qy - yProbe) > 0) continue;
    const span = qy - py;
    const ratio = Math.abs(span) < 1e-9 ? 0 : (yProbe - py) / span;
    const value = p[measureAxis]! + ratio * (q[measureAxis]! - p[measureAxis]!);
    best = Math.min(best, Math.abs(value));
  }
  return best;
}

function axisExtent(points: Float32Array, axis: number): [number, number] {
  let min = Infinity, max = -Infinity;
  for (let i = axis; i < points.length; i += 3) {
    const value = points[i]!;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return [min, max];
}

/** Perpendicular spread of vertices near one end of an axis (identifies the
 * wide shade end of the lamp versus the thin cord end). */
function spreadAt(points: Float32Array, axis: number, value: number, tolerance: number): number {
  const other = [0, 1, 2].filter(a => a !== axis);
  const axisA = other[0]!, axisB = other[1]!;
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    if (Math.abs(points[i + axis]! - value) > tolerance) continue;
    const a = points[i + axisA]!, b = points[i + axisB]!;
    if (a < minA) minA = a; if (a > maxA) maxA = a;
    if (b < minB) minB = b; if (b > maxB) maxB = b;
  }
  return Math.max(maxA - minA, maxB - minB);
}

function tuneMaterials(root: THREE.Object3D): void {
  root.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (!standard || !standard.isMeshStandardMaterial) continue;
      if (standard.name === 'pool_table_mat') {
        standard.roughness = 0.82;
        standard.metalness = 0.04;
        standard.envMapIntensity = 0.5;
        // The export marks the whole table transparent without depth writes,
        // so legs/stretchers under the cloth sort on top of it (posts standing
        // on the playfield). Opaque + depth write restores correct occlusion;
        // DoubleSide stays for the pocket nets.
        standard.transparent = false;
        standard.opacity = 1;
        standard.depthWrite = true;
        standard.needsUpdate = true;
      }
      if (standard.name === 'light_mat') {
        standard.roughness = 0.5;
        standard.emissive = new THREE.Color(0xffd9a0);
        standard.emissiveIntensity = 1.35;
        standard.envMapIntensity = 0.4;
      }
    }
  });
}

/** Install the table so its cushion nose matches the authoritative playfield. */
export function installTraditionalTable(model: THREE.Group, bedY: number): { group: THREE.Group; fit: TraditionalTableFit } {
  const tableMeshes = meshesWithMaterial(model, 'pool_table_mat');
  if (!tableMeshes.length) throw new Error('pool_table_mat mesh missing from traditional table GLB');
  // The lamp was already extracted into its own wrapper; its authored copy
  // must not stay inside the fitted table (a duplicate lamp would hang between
  // the top camera and the bed). The authored cue is likewise culled here —
  // the visible cue now comes from the standalone cc0 cue-stick GLB.
  const foreign: THREE.Mesh[] = [];
  model.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some(material => material && material.name === 'pool_table_mat')) foreign.push(mesh);
  });
  for (const mesh of foreign) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach(material => material?.dispose());
  }
  const group = new THREE.Group();
  group.name = 'traditional-table';
  // Inner wrapper carries the authoring-axis rotation so the outer group's
  // scale/position act in the same world-oriented space as the measurements.
  const oriented = new THREE.Group();
  oriented.rotation.y = Math.PI / 2;
  oriented.add(model);
  group.add(oriented);
  group.updateMatrixWorld(true);
  const { points, tris } = bakedGeometry(tableMeshes, oriented);

  const [, railTop] = axisExtent(points, 1);
  // Cloth is the dominant horizontal vertex level just below the rail top.
  const bins = new Map<number, number>();
  for (let i = 1; i < points.length; i += 3) {
    const y = points[i]!;
    if (y < railTop - 0.12 || y > railTop - 0.04) continue;
    const bin = Math.round(y * 1000);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  let clothBin = 0, clothCount = 0;
  for (const [bin, count] of bins) if (count > clothCount) { clothBin = bin; clothCount = count; }
  // Highest level whose vertex population is at least 90% of the dominant one.
  for (const [bin, count] of bins) if (count >= clothCount * 0.9 && bin > clothBin) clothBin = bin;
  const clothY = clothBin / 1000;

  let bedHalfX = 0, bedHalfZ = 0, centerX = 0, centerZ = 0, bedCount = 0;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]!, y = points[i + 1]!, z = points[i + 2]!;
    if (Math.abs(y - clothY) < 0.002) {
      bedHalfX = Math.max(bedHalfX, Math.abs(x));
      bedHalfZ = Math.max(bedHalfZ, Math.abs(z));
      centerX += x; centerZ += z; bedCount++;
    }
  }
  if (!bedCount) throw new Error('traditional table cloth measurement failed');
  centerX /= bedCount; centerZ /= bedCount;
  // Cushion nose = innermost rail face on probe lines away from pocket jaws:
  // the X probe (z=0) meets only short rails, the Z probe (x=45% bed) avoids
  // both the middle pockets (x≈0) and the corner jaws (x≈bed edge). The nose
  // face is sloped, so probe at ball-centre height; two passes converge because
  // the vertical scale depends on the measured nose.
  let noseX = probeNose(tris, 2, 0, 0, clothY + 0.02);
  let noseZ = probeNose(tris, 0, bedHalfX * 0.45, 2, clothY + 0.02);
  for (let pass = 0; pass < 2; pass++) {
    const probeScaleY = (CUSHION_HALF_X / noseX + CUSHION_HALF_Y / noseZ) / 2;
    const yProbe = clothY + BALL_RADIUS / probeScaleY;
    noseX = probeNose(tris, 2, 0, 0, yProbe);
    noseZ = probeNose(tris, 0, bedHalfX * 0.45, 2, yProbe);
  }
  if (!Number.isFinite(noseX) || !Number.isFinite(noseZ)) throw new Error('traditional table cushion nose measurement failed');

  const scaleX = CUSHION_HALF_X / noseX;
  const scaleZ = CUSHION_HALF_Y / noseZ;
  const scaleY = (scaleX + scaleZ) / 2;
  group.scale.set(scaleX, scaleY, scaleZ);
  group.position.set(-centerX * scaleX, bedY - clothY * scaleY, -centerZ * scaleZ);
  group.updateMatrixWorld(true);
  tuneMaterials(group);
  return {
    group,
    fit: { clothTopY: bedY, noseX: CUSHION_HALF_X, noseZ: CUSHION_HALF_Y, bedHalfX: bedHalfX * scaleX, bedHalfZ: bedHalfZ * scaleZ },
  };
}

/** Isolate the ceiling lamp, hang it cord-up with the shade bottom at
 * shadeBottomY and the cord top no higher than cordTopY (local metres). */
export function createTraditionalLamp(model: THREE.Group, shadeBottomY: number, cordTopY = shadeBottomY + 0.8): THREE.Group | null {
  const meshes = meshesWithMaterial(model, 'light_mat');
  if (!meshes.length) return null;
  const { points } = bakedGeometry(meshes, model);
  const extents = [0, 1, 2].map(axis => { const [min, max] = axisExtent(points, axis); return max - min; });
  // Cord = the axis whose two ends differ most in perpendicular spread (thin
  // ceiling rose versus wide shade). Picking the longest extent instead would
  // choose the shade bar and hang the lamp sideways.
  let cordAxis = 0, bestRatio = -1;
  for (let axis = 0; axis < 3; axis++) {
    const [min, max] = axisExtent(points, axis);
    const lo = spreadAt(points, axis, min, 0.02), hi = spreadAt(points, axis, max, 0.02);
    const ratio = Math.max(lo, hi) / Math.max(1e-6, Math.min(lo, hi));
    if (ratio > bestRatio) { bestRatio = ratio; cordAxis = axis; }
  }
  const rest = [0, 1, 2].filter(a => a !== cordAxis);
  const restA = rest[0]!, restB = rest[1]!;
  const shadeAxis = extents[restA]! >= extents[restB]! ? restA : restB;
  const [cordMin, cordMax] = axisExtent(points, cordAxis);
  const shadeAtMax = spreadAt(points, cordAxis, cordMax, 0.02) >= spreadAt(points, cordAxis, cordMin, 0.02);
  const thinAxis = rest.find(axis => axis !== shadeAxis)!;
  // Columns are images of model X/Y/Z: map shade axis to world X, cord axis to
  // world Y (shade end down), thin axis to world Z with a right-handed basis.
  const images = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  images[shadeAxis]!.set(1, 0, 0);
  images[cordAxis]!.set(0, shadeAtMax ? -1 : 1, 0);
  images[thinAxis]!.set(0, 0, 1);
  const basis = new THREE.Matrix4().makeBasis(images[0]!, images[1]!, images[2]!);
  if (basis.determinant() < 0) { images[thinAxis]!.set(0, 0, -1); basis.makeBasis(images[0]!, images[1]!, images[2]!); }
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);

  const wrapper = new THREE.Group();
  wrapper.name = 'traditional-lamp';
  model.updateMatrixWorld(true);
  const material = (meshes[0]!.material as THREE.MeshStandardMaterial).clone();
  material.emissive = new THREE.Color(0xffd9a0);
  material.emissiveIntensity = 1.35;
  const point = new THREE.Vector3();
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone();
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      position.setXYZ(i, point.x, point.y, point.z);
    }
    position.needsUpdate = true;
    geometry.applyQuaternion(quaternion);
    geometry.computeBoundingBox();
    const bakedMesh = new THREE.Mesh(geometry, material);
    bakedMesh.castShadow = true;
    wrapper.add(bakedMesh);
  }
  wrapper.updateMatrixWorld(true);
  // Fit the cord between shade and ceiling so the lamp never penetrates the
  // room shell; the shade keeps its authored proportions.
  const lampScale = Math.min(1, (cordTopY - shadeBottomY) / Math.max(extents[cordAxis]!, 1e-6));
  wrapper.scale.setScalar(lampScale);
  wrapper.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrapper);
  const center = box.getCenter(new THREE.Vector3());
  wrapper.position.set(-center.x, shadeBottomY - box.min.y, -center.z);
  wrapper.updateMatrixWorld(true);
  // Two warm bulbs under the shade, hidden together with the lamp in top view.
  for (const x of [-0.34, 0.34]) {
    const light = new THREE.PointLight(0xffe3bc, 2.6, 7, 2);
    light.position.set(x, shadeBottomY - 0.07 - wrapper.position.y, -wrapper.position.z);
    wrapper.add(light);
  }
  return wrapper;
}