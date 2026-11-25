import { readFileSync } from 'node:fs';
const buf = readFileSync('public/assets/models/pool-table-traditional.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = buf.subarray(20 + jsonLen + 8);
function acc(i) {
  const a = json.accessors[i]; const bv = json.bufferViews[a.bufferView];
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0); const stride = bv.byteStride ?? 12;
  const out = [];
  for (let k = 0; k < a.count; k++) out.push([bin.readFloatLE(off + k * stride), bin.readFloatLE(off + k * stride + 4), bin.readFloatLE(off + k * stride + 8)]);
  return out;
}
function mat(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0], r = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = r;
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
  for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) m[c * 4 + row] *= s[c];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
const world = json.nodes.map(() => null);
function walk(i, p) { const m = p ? mul(p, mat(json.nodes[i])) : mat(json.nodes[i]); world[i] = m; for (const c of json.nodes[i].children ?? []) walk(c, m); }
for (const s of json.scenes[json.scene ?? 0].nodes) walk(s, null);
json.nodes.forEach((n, i) => {
  if (n.mesh === undefined) return;
  for (const p of json.meshes[n.mesh].primitives) {
    if (json.materials[p.material]?.name !== 'cue_mat') continue;
    const m = world[i];
    const verts = acc(p.attributes.POSITION).map(v => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
    const min = [0, 1, 2].map(a => Math.min(...verts.map(v => v[a])));
    const max = [0, 1, 2].map(a => Math.max(...verts.map(v => v[a])));
    console.log('cue mesh', n.name, 'verts', verts.length, 'min', min.map(v => +v.toFixed(4)), 'max', max.map(v => +v.toFixed(4)));
  }
});
{
  const n = json.nodes.find(nd => nd.name === 'pool_cue_cue_mat_0') ?? json.nodes.find(nd => nd.mesh !== undefined && json.meshes[nd.mesh].primitives.some(p => json.materials[p.material]?.name === 'cue_mat'));
  const i = json.nodes.indexOf(n);
  const prim = json.meshes[n.mesh].primitives.find(p => json.materials[p.material]?.name === 'cue_mat');
  const m = world[i];
  const raw = acc(prim.attributes.POSITION);
  const verts = raw.map(v => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
  const cx = (0.3116 + 0.429) / 2, cy = (0.7607 + 0.7997) / 2;
  const rad = verts.map(v => Math.hypot(v[0] - cx, v[1] - cy));
  const sorted = [...rad].sort((a, b) => a - b);
  console.log('radial median', sorted[Math.floor(sorted.length / 2)].toFixed(4), 'p90', sorted[Math.floor(sorted.length * 0.9)].toFixed(4), 'max', sorted[sorted.length - 1].toFixed(4));
  const high = rad.map((r, k) => r > 0.026 ? k : -1).filter(k => k >= 0);
  console.log('high-radial verts', high.length, 'their z range', Math.min(...high.map(k => verts[k][2])).toFixed(3), Math.max(...high.map(k => verts[k][2])).toFixed(3));
  const idx = prim.indices !== undefined ? acc(prim.indices).map(v => v[0]) : null;
  const index = json.accessors[prim.indices];
  const bv = json.bufferViews[index.bufferView]; const off = (bv.byteOffset ?? 0) + (index.byteOffset ?? 0);
  const ids = [];
  const comp = index.componentType === 5123 ? 2 : 4;
  for (let k = 0; k < index.count; k++) ids.push(comp === 2 ? bin.readUInt16LE(off + k * 2) : bin.readUInt32LE(off + k * 4));
  const highSet = new Set(high);
  let mixed = 0, pure = 0;
  for (let t = 0; t < ids.length; t += 3) {
    const h = [ids[t], ids[t + 1], ids[t + 2]].filter(id => highSet.has(id)).length;
    if (h === 3) pure++; else if (h > 0) mixed++;
  }
  console.log('triangles pure-high', pure, 'mixed', mixed, 'total', ids.length / 3);
}
{
  const n = json.nodes.find(nd => nd.mesh !== undefined && json.meshes[nd.mesh].primitives.some(p => json.materials[p.material]?.name === 'cue_mat'));
  const i = json.nodes.indexOf(n);
  const prim = json.meshes[n.mesh].primitives.find(p => json.materials[p.material]?.name === 'cue_mat');
  const m = world[i];
  const verts = acc(prim.attributes.POSITION).map(v => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
  const slice = verts.filter(v => Math.abs(v[2]) < 0.05);
  console.log('mid:', slice.map(v => (v[0] - 0.3703).toFixed(3) + ',' + (v[1] - 0.7802).toFixed(3)).join(' | '));
  const slice2 = verts.filter(v => v[2] > 0.6);
  console.log('tip:', slice2.map(v => (v[0] - 0.3703).toFixed(3) + ',' + (v[1] - 0.7802).toFixed(3)).join(' | '));
}
{
  const n = json.nodes.find(nd => nd.mesh !== undefined && json.meshes[nd.mesh].primitives.some(p => json.materials[p.material]?.name === 'cue_mat'));
  const i = json.nodes.indexOf(n);
  const prim = json.meshes[n.mesh].primitives.find(p => json.materials[p.material]?.name === 'cue_mat');
  const m = world[i];
  const verts = acc(prim.attributes.POSITION).map(v => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const cx = med(verts.map(v => v[0])), cy = med(verts.map(v => v[1]));
  const radii = verts.map(v => Math.hypot(v[0] - cx, v[1] - cy));
  const cutoff = med(radii) * 1.45 + 1e-4;
  console.log('median center', cx.toFixed(4), cy.toFixed(4), 'median radius', med(radii).toFixed(4), 'cutoff', cutoff.toFixed(4));
  const index = json.accessors[prim.indices];
  const bv = json.bufferViews[index.bufferView]; const off = (bv.byteOffset ?? 0) + (index.byteOffset ?? 0);
  const ids = [];
  for (let k = 0; k < index.count; k++) ids.push(index.componentType === 5123 ? bin.readUInt16LE(off + k * 2) : bin.readUInt32LE(off + k * 4));
  const keep = [];
  for (let t = 0; t < ids.length; t += 3) {
    const tri = [ids[t], ids[t + 1], ids[t + 2]];
    if (tri.every(id => radii[id] <= cutoff)) keep.push(...tri);
  }
  const kv = keep.map(id => verts[id]);
  console.log('kept tris', keep.length / 3, 'of', ids.length / 3, 'kept bbox z', Math.min(...kv.map(v => v[2])).toFixed(3), Math.max(...kv.map(v => v[2])).toFixed(3), 'x', Math.min(...kv.map(v => v[0])).toFixed(3), Math.max(...kv.map(v => v[0])).toFixed(3));
  const rs = [...radii].sort((a, b) => a - b);
  console.log('radius deciles', [0, .1, .25, .5, .75, .9, 1].map(q => rs[Math.min(rs.length - 1, Math.floor(q * (rs.length - 1)))].toFixed(4)).join(' '));
}
{
  const n = json.nodes.find(nd => nd.mesh !== undefined && json.meshes[nd.mesh].primitives.some(p => json.materials[p.material]?.name === 'cue_mat'));
  const i = json.nodes.indexOf(n);
  const prim = json.meshes[n.mesh].primitives.find(p => json.materials[p.material]?.name === 'cue_mat');
  const m = world[i];
  const verts = acc(prim.attributes.POSITION).map(v => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
  const zmin = Math.min(...verts.map(v => v[2])), zmax = Math.max(...verts.map(v => v[2]));
  const span = zmax - zmin;
  for (const end of [zmin, zmax]) {
    const pts = verts.filter(v => Math.abs(v[2] - end) <= span * 0.15);
    const cx = pts.reduce((s, v) => s + v[0], 0) / pts.length, cy = pts.reduce((s, v) => s + v[1], 0) / pts.length;
    const maxR = Math.max(...pts.map(v => Math.hypot(v[0] - cx, v[1] - cy)));
    console.log('end', end.toFixed(3), 'pts', pts.length, 'center', cx.toFixed(4), cy.toFixed(4), 'maxR', maxR.toFixed(4));
  }
}
{
  const n = json.nodes.find(nd => nd.mesh !== undefined && json.meshes[nd.mesh].primitives.some(p => json.materials[p.material]?.name === 'cue_mat'));
  const i = json.nodes.indexOf(n);
  const prim = json.meshes[n.mesh].primitives.find(p => json.materials[p.material]?.name === 'cue_mat');
  const m = world[i];
  const verts = acc(prim.attributes.POSITION).map(v => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
  const paddle = verts.filter(v => Math.hypot(v[0] - 0.4072, v[1] - 0.7788) > 0.03);
  console.log('paddle verts', paddle.length, 'z range', Math.min(...paddle.map(v => v[2])).toFixed(3), Math.max(...paddle.map(v => v[2])).toFixed(3));
  const zmin = Math.min(...verts.map(v => v[2])), zmax = Math.max(...verts.map(v => v[2]));
  for (const f of [0.5, 0.65, 0.75]) {
    const z = zmin + (zmax - zmin) * f;
    const pts = verts.filter(v => Math.abs(v[2] - z) <= (zmax - zmin) * 0.15);
    const cx = pts.reduce((s, v) => s + v[0], 0) / pts.length, cy = pts.reduce((s, v) => s + v[1], 0) / pts.length;
    const maxR = Math.max(...pts.map(v => Math.hypot(v[0] - cx, v[1] - cy)));
    console.log('slice f', f, 'pts', pts.length, 'center', cx.toFixed(4), cy.toFixed(4), 'maxR', maxR.toFixed(4));
  }
}
