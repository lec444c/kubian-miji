import fs from 'node:fs';

const buf = fs.readFileSync('D:/game race/public/assets/models/pool-table-traditional.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const acc = json.accessors;

function mat(n) {
  const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  const M = new Array(16).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) M[c * 4 + r] = R[c * 3 + r] * s[c];
  M[12] = t[0]; M[13] = t[1]; M[14] = t[2]; M[15] = 1;
  return M;
}
function mul(A, B) {
  const C = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += A[k * 4 + r] * B[c * 4 + k];
    C[c * 4 + r] = v;
  }
  return C;
}
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function verts(matName) {
  const out = [];
  function walk(idx, P) {
    const n = json.nodes[idx];
    const W = mul(P, mat(n));
    if (n.mesh !== undefined) {
      const m = json.meshes[n.mesh];
      const name = json.materials[m.primitives[0].material]?.name;
      if (name === matName) {
        for (const p of m.primitives) {
          const a = acc[p.attributes.POSITION];
          const bv = json.bufferViews[a.bufferView];
          const off = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0);
          const stride = bv.byteStride || 12;
          for (let i = 0; i < a.count; i++) {
            const o = off + i * stride;
            const v = [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)];
            out.push([0, 1, 2].map(r => W[r] * v[0] + W[4 + r] * v[1] + W[8 + r] * v[2] + W[12 + r]));
          }
        }
      }
    }
    (n.children || []).forEach(c => walk(c, W));
  }
  (json.scenes[json.scene || 0].nodes || []).forEach(n => walk(n, I));
  return out;
}
function bounds(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const v of points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
  return { min, max };
}

const cue = verts('cue_mat');
const cb = bounds(cue);
console.log('cue baked min', cb.min.map(v => +v.toFixed(4)), 'max', cb.max.map(v => +v.toFixed(4)));
const size = cb.max.map((v, i) => v - cb.min[i]);
const axis = size[0] >= size[1] && size[0] >= size[2] ? 0 : size[1] >= size[2] ? 1 : 2;
console.log('cue axis', axis, 'size', size.map(v => +v.toFixed(4)));
const center = cb.min.map((v, i) => (v + cb.max[i]) / 2);
function radiusAt(value) {
  let s = 0, c = 0;
  const other = [0, 1, 2].filter(a => a !== axis);
  for (const v of cue) {
    if (Math.abs(v[axis] - value) > 0.02) continue;
    s += Math.hypot(v[other[0]] - center[other[0]], v[other[1]] - center[other[1]]);
    c++;
  }
  return c ? s / c : Infinity;
}
console.log('cue radiusAt(min/max)', +radiusAt(cb.min[axis]).toFixed(4), +radiusAt(cb.max[axis]).toFixed(4));

const light = verts('light_mat');
const lb = bounds(light);
console.log('light baked min', lb.min.map(v => +v.toFixed(3)), 'max', lb.max.map(v => +v.toFixed(3)));
function spreadAt(axisIdx, value, tol) {
  const other = [0, 1, 2].filter(a => a !== axisIdx);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const v of light) {
    if (Math.abs(v[axisIdx] - value) > tol) continue;
    a0 = Math.min(a0, v[other[0]]); a1 = Math.max(a1, v[other[0]]);
    b0 = Math.min(b0, v[other[1]]); b1 = Math.max(b1, v[other[1]]);
  }
  return Math.max(a1 - a0, b1 - b0);
}
for (let a = 0; a < 3; a++) {
  console.log('light axis', a, 'extent', +(lb.max[a] - lb.min[a]).toFixed(3),
    'spreadMin', +spreadAt(a, lb.min[a], 0.02).toFixed(3), 'spreadMax', +spreadAt(a, lb.max[a], 0.02).toFixed(3));
}