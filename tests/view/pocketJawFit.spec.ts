import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ballRestingConflict } from '../../src/sim/Simulation';
import { BALL_RADIUS, POCKET_RADIUS, POCKETS } from '../../src/sim/SimulationState';
import { installTraditionalTable } from '../../src/view/TraditionalTable';
import { parseWithoutTextures } from '../helpers/loadGlb';

/** 袋角穿模回归：物理只认库边直线和几个小圆点，而真实球桌模型的库边在袋口处有 45° 切角，
 *  伸进袋口远得多，球心能停在绿色胶边里 1–2 cm（肉眼可见穿模）。
 *  这里用真实 GLB 的三角形，检查“白球不落袋就能走到的每一个停留位置”都不切入模型实体。 */
const STEP = 0.001;
const X_MIN = -1.4;
const Y_MIN = -0.8;
const COLS = 2801;
const ROWS = 1601;
const BED_Y = 0.79;
// 允许的模型拟合误差：袋角轮廓是按球心高度逐点量的，毫米级偏差不可避免。
// 直线库边本身就有约 4mm：installTraditionalTable 在台面上方 2cm 处量胶边位置，而球心高度
// (3.15cm) 的胶边再凸出约 4mm。这是全局的既有偏差，不在本测试范围，只保证袋角处不更糟。
const MAX_OVERLAP = 0.005;
// 只检查袋口附近；直线库边的胶边位置由 installTraditionalTable 按常量缩放，天然吻合。
const POCKET_SCAN_RADIUS = 0.3;
const BUCKET = 0.04;

interface Tri { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; minY: number; maxY: number }

function collectSolid(root: THREE.Object3D, clothY: number): Tri[] {
  const tris: Tri[] = [];
  root.updateMatrixWorld(true);
  root.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = geometry.getIndex();
    const triCount = index ? index.count / 3 : position.count / 3;
    const abc = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let t = 0; t < triCount; t += 1) {
      for (let v = 0; v < 3; v += 1) {
        const i = index ? index.getX(t * 3 + v) : t * 3 + v;
        abc[v]!.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      }
      const minY = Math.min(abc[0]!.y, abc[1]!.y, abc[2]!.y);
      const maxY = Math.max(abc[0]!.y, abc[1]!.y, abc[2]!.y);
      // 台面之上、球心高度以下（延伸到球赤道以下）的实体：排除台面本身、库边顶盖和袋底下沉的衬网。
      if (minY >= clothY - 0.002 && maxY >= clothY + 0.004 && minY <= clothY + BALL_RADIUS + 0.004) {
        tris.push({ a: abc[0]!.clone(), b: abc[1]!.clone(), c: abc[2]!.clone(), minY, maxY });
      }
    }
  });
  return tris;
}

// 三角形最近点：平面投影 + 内含测试，否则取三条边的线段最近点。
const tN = new THREE.Vector3(), tU = new THREE.Vector3(), tV = new THREE.Vector3();
const tE = new THREE.Vector3(), tP = new THREE.Vector3(), tW = new THREE.Vector3();
function segmentClosest(p: THREE.Vector3, v1: THREE.Vector3, v2: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  tE.subVectors(v2, v1);
  const lengthSq = tE.lengthSq();
  const t = lengthSq > 1e-30 ? THREE.MathUtils.clamp(tP.subVectors(p, v1).dot(tE) / lengthSq, 0, 1) : 0;
  return out.copy(v1).addScaledVector(tE, t);
}
function distanceToTriangle(p: THREE.Vector3, tri: Tri): number {
  const { a, b, c } = tri;
  tN.subVectors(b, a).cross(tU.subVectors(c, a));
  const denom = tN.lengthSq();
  if (denom > 1e-30) {
    const out = tV.copy(p).addScaledVector(tN, tN.dot(tU.subVectors(a, p)) / denom);
    const outside = (v1: THREE.Vector3, v2: THREE.Vector3): boolean => tN.dot(tE.subVectors(v2, v1).cross(tW.subVectors(out, v1))) < 0;
    if (!outside(a, b) && !outside(b, c) && !outside(c, a)) return p.distanceTo(out);
  }
  let best = p.distanceTo(segmentClosest(p, a, b, tW));
  for (const [v1, v2] of [[b, c], [c, a]] as [THREE.Vector3, THREE.Vector3][]) {
    best = Math.min(best, p.distanceTo(segmentClosest(p, v1, v2, tW)));
  }
  return best;
}

describe('袋角物理与真实球桌模型吻合', () => {
  it('截图里的穿模位置现在被袋角挡住', () => {
    // (+x,+y) 角袋长边胶边的 45° 切角里：旧物理允许球心停在这里。
    for (const [x, y] of [[1.17, 0.585], [1.187, 0.6], [1.15, 0.57]] as const) {
      expect(ballRestingConflict(x, y), `(${x}, ${y})`).toBe('jaw');
    }
    // 中袋胶边角同样。
    for (const [x, y] of [[0.066, 0.579], [0.1, 0.555]] as const) {
      expect(ballRestingConflict(x, y), `(${x}, ${y})`).toBe('jaw');
    }
    // 袋口本身仍然开着：角袋和对角线、中袋正中都能进到捕获圈。
    expect(ballRestingConflict(1.21, 0.575)).toBeNull();
    expect(ballRestingConflict(0.05, 0.556)).toBeNull();
    expect(ballRestingConflict(1.1, 0.5479)).toBeNull();
    expect(ballRestingConflict(0.12, 0.5479)).toBeNull();
  });

  it('白球不落袋就能走到的每个停留位置，球体切入模型不超过 5mm', async () => {
    const { group, fit } = installTraditionalTable(await parseWithoutTextures(), BED_Y);
    const solid = collectSolid(group, fit.clothTopY);

    // 1. 从台面中心洪水填充，找出白球不落袋就能走到的球心格点。
    const blocked = new Uint8Array(COLS * ROWS);
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        blocked[row * COLS + col] = ballRestingConflict(X_MIN + col * STEP, Y_MIN + row * STEP) === null ? 0 : 1;
      }
    }
    const reachable = new Uint8Array(COLS * ROWS);
    const start = Math.round(-Y_MIN / STEP) * COLS + Math.round(-X_MIN / STEP);
    expect(blocked[start]).toBe(0);
    const stack = [start];
    reachable[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop()!;
      const col = index % COLS;
      const row = (index - col) / COLS;
      for (const next of [col > 0 ? index - 1 : -1, col < COLS - 1 ? index + 1 : -1, row > 0 ? index - COLS : -1, row < ROWS - 1 ? index + COLS : -1]) {
        if (next < 0 || blocked[next] || reachable[next]) continue;
        reachable[next] = 1;
        stack.push(next);
      }
    }

    // 2. 每个袋口的捕获圈边缘必须走得到，否则袋口被新胶边堵死了。
    for (const pocket of POCKETS) {
      let edge = 0;
      for (let row = 0; row < ROWS; row += 1) {
        const y = Y_MIN + row * STEP;
        if (Math.abs(y - pocket.position.y) > POCKET_RADIUS + 0.01) continue;
        for (let col = 0; col < COLS; col += 1) {
          const x = X_MIN + col * STEP;
          const distance = Math.hypot(x - pocket.position.x, y - pocket.position.y);
          if (reachable[row * COLS + col] && distance < POCKET_RADIUS + 0.006) edge += 1;
        }
      }
      // 至少 1cm 长的可达弧段。
      expect(edge, `pocket ${pocket.id}`).toBeGreaterThan(10);
    }

    // 3. 空间分桶，逐个可达格点量球心到模型实体的距离。
    const buckets = new Map<number, Tri[]>();
    const bucketKey = (x: number, y: number): number => Math.floor(x / BUCKET) * 10000 + Math.floor(y / BUCKET);
    for (const tri of solid) {
      const minX = Math.min(tri.a.x, tri.b.x, tri.c.x) - BALL_RADIUS;
      const maxX = Math.max(tri.a.x, tri.b.x, tri.c.x) + BALL_RADIUS;
      const minZ = Math.min(tri.a.z, tri.b.z, tri.c.z) - BALL_RADIUS;
      const maxZ = Math.max(tri.a.z, tri.b.z, tri.c.z) + BALL_RADIUS;
      for (let bx = Math.floor(minX / BUCKET); bx <= Math.floor(maxX / BUCKET); bx += 1) {
        for (let by = Math.floor(minZ / BUCKET); by <= Math.floor(maxZ / BUCKET); by += 1) {
          const key = bx * 10000 + by;
          const list = buckets.get(key);
          if (list) list.push(tri); else buckets.set(key, [tri]);
        }
      }
    }
    const center = new THREE.Vector3();
    const worst = new Map<number, { depth: number; x: number; y: number }>();
    let scanned = 0;
    for (let row = 0; row < ROWS; row += 1) {
      const y = Y_MIN + row * STEP;
      for (let col = 0; col < COLS; col += 1) {
        const index = row * COLS + col;
        if (!reachable[index]) continue;
        const x = X_MIN + col * STEP;
        const pocket = POCKETS.find(p => Math.hypot(x - p.position.x, y - p.position.y) < POCKET_SCAN_RADIUS);
        if (!pocket) continue;
        const list = buckets.get(bucketKey(x, y));
        if (!list) continue;
        scanned += 1;
        center.set(x, fit.clothTopY + BALL_RADIUS, y);
        let nearest = Infinity;
        for (const tri of list) nearest = Math.min(nearest, distanceToTriangle(center, tri));
        const depth = BALL_RADIUS - nearest;
        const current = worst.get(pocket.id);
        if (!current || depth > current.depth) worst.set(pocket.id, { depth, x, y });
      }
    }
    const report = POCKETS.map(pocket => `袋 ${pocket.id}: ${((worst.get(pocket.id)?.depth ?? 0) * 1000).toFixed(1)}mm @ (${worst.get(pocket.id)?.x.toFixed(3)}, ${worst.get(pocket.id)?.y.toFixed(3)})`).join(' | ');
    console.log(`袋角拟合：检查 ${scanned} 个可达停留位置 -> ${report}`);
    expect(scanned).toBeGreaterThan(50_000);
    for (const pocket of POCKETS) {
      expect(worst.get(pocket.id)!.depth, `袋 ${pocket.id} ${report}`).toBeLessThan(MAX_OVERLAP);
    }
  }, 120_000);
});
