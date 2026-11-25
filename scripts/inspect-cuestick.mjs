import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'D:/智器云杯/cc0_-_cue_stick.glb';
const buf = readFileSync(path);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart);
console.log('asset', JSON.stringify(json.asset));
console.log('meshes', json.meshes.length, 'materials', (json.materials ?? []).map(m => m.name).join(','));
console.log('images', (json.images ?? []).length, 'textures', (json.textures ?? []).length);
console.log('extensions', JSON.stringify(json.extensionsUsed ?? []));

const accessors = json.accessors;
const bufferViews = json.bufferViews;
const readPos = prim => {
  const acc = accessors[prim.attributes.POSITION];
  const view = bufferViews[acc.bufferView];
  const out = [];
  const stride = view.byteStride ?? 12;
  for (let i = 0; i < acc.count; i++) {
    const off = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * stride;
    out.push([bin.readFloatLE(off), bin.readFloatLE(off + 4), bin.readFloatLE(off + 8)]);
  }
  return out;
};
const nodes = json.nodes;
const world = i => {
  const n = nodes[i];
  let m = n.matrix ? [...n.matrix] : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (!n.matrix) {
    const q = n.rotation ?? [0, 0, 0, 1];
    const s = n.scale ?? [1, 1, 1];
    const t = n.translation ?? [0, 0, 0];
    const [x, y, z, w] = q;
    const r = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0,
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0,
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
    m = r.map((v, idx) => (idx < 12 ? v * s[Math.floor(idx / 4)] : v));
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  }
  return m;
};
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const all = [];
const walk = (i, parent) => {
  const m = mul(parent, world(i));
  const n = nodes[i];
  if (n.mesh !== undefined) {
    for (const prim of json.meshes[n.mesh].primitives) {
      const pts = readPos(prim).map(p => apply(m, p));
      all.push({ name: n.name, pts });
    }
  }
  for (const c of n.children ?? []) walk(c, m);
};
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const s of json.scenes[json.scene ?? 0].nodes) walk(s, identity);
for (const { name, pts } of all) {
  const min = [0, 1, 2].map(a => Math.min(...pts.map(p => p[a])));
  const max = [0, 1, 2].map(a => Math.max(...pts.map(p => p[a])));
  console.log('mesh', name, 'verts', pts.length, 'min', min.map(v => v.toFixed(4)).join(','), 'max', max.map(v => v.toFixed(4)).join(','));
  const size = [0, 1, 2].map(a => max[a] - min[a]);
  const axis = size.indexOf(Math.max(...size));
  const rad = [0, 1, 2].filter(a => a !== axis);
  for (const f of [0, 0.02, 0.5, 0.98, 1]) {
    const target = min[axis] + size[axis] * f;
    const slice = pts.filter(p => Math.abs(p[axis] - target) < size[axis] * 0.02);
    if (!slice.length) continue;
    const c = rad.map(a => slice.reduce((s, p) => s + p[a], 0) / slice.length);
    const maxR = Math.max(...slice.map(p => Math.hypot(p[rad[0]] - c[0], p[rad[1]] - c[1])));
    console.log(`  f${f} pts${slice.length} center ${c.map(v => v.toFixed(4)).join(',')} maxR ${maxR.toFixed(4)}`);
  }
}