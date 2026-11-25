import { readFileSync } from 'node:fs';
const buf = readFileSync('public/assets/models/sitting_room_with_baked_textures.glb');
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
for (const n of json.nodes) console.log('node', n.name, 'mesh', n.mesh, 'matrix', n.matrix, 't', n.translation, 'r', n.rotation, 's', n.scale, 'children', n.children);
function mat(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0], r = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = r;
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
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
  const m = world[i];
  const verts = acc(json.meshes[n.mesh].primitives[0].attributes.POSITION).map(v => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
  const bins = new Map();
  for (const v of verts) { const b = Math.round(v[1] * 20) / 20; bins.set(b, (bins.get(b) ?? 0) + 1); }
  console.log(n.name, 'world y bins top:', [...bins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
  const low = verts.filter(v => v[1] < 0.06);
  if (low.length) console.log(n.name, 'y<0.06 count', low.length, 'x', Math.min(...low.map(v => v[0])).toFixed(2), Math.max(...low.map(v => v[0])).toFixed(2), 'y', Math.min(...low.map(v => v[1])).toFixed(2), Math.max(...low.map(v => v[1])).toFixed(2));
});
json.nodes.forEach((n, i) => {
  if (n.mesh === undefined) return;
  const m = world[i];
  const verts = acc(json.meshes[n.mesh].primitives[0].attributes.POSITION).map(v => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
  const low = verts.filter(v => v[1] < 0.06);
  console.log(n.name, 'floor-plane z range', Math.min(...low.map(v => v[2])).toFixed(2), Math.max(...low.map(v => v[2])).toFixed(2));
  const ceil = verts.filter(v => v[1] > 3.5);
  console.log(n.name, 'ceiling verts', ceil.length, ceil.length ? 'x ' + Math.min(...ceil.map(v => v[0])).toFixed(2) + '..' + Math.max(...ceil.map(v => v[0])).toFixed(2) + ' z ' + Math.min(...ceil.map(v => v[2])).toFixed(2) + '..' + Math.max(...ceil.map(v => v[2])).toFixed(2) : '');
});
{
  const i = json.nodes.findIndex(n => n.name === 'Object_2');
  const m = world[i];
  const verts = acc(json.meshes[json.nodes[i].mesh].primitives[0].attributes.POSITION).map(v => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
  const furn = verts.filter(v => v[1] > 0.15);
  const cells = new Map();
  for (const v of furn) { const key = Math.round(v[0]) + ',' + Math.round(v[2]); cells.set(key, (cells.get(key) ?? 0) + 1); }
  console.log('furniture occupancy (x,z rounded metre cells):', [...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24));
  const center = furn.filter(v => Math.abs(v[0]) < 2.3 && Math.abs(v[2]) < 1.3);
  console.log('furniture verts inside table zone:', center.length, center.length ? 'y ' + Math.min(...center.map(v => v[1])).toFixed(2) + '..' + Math.max(...center.map(v => v[1])).toFixed(2) : '');
}
{
  const i = json.nodes.findIndex(n => n.name === 'Object_2');
  const m = world[i];
  const verts = acc(json.meshes[json.nodes[i].mesh].primitives[0].attributes.POSITION).map(v => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
  const center = verts.filter(v => v[1] > 0.15 && Math.abs(v[0]) < 2.6 && Math.abs(v[2]) < 1.6);
  console.log('center cluster bbox x', Math.min(...center.map(v => v[0])).toFixed(2), Math.max(...center.map(v => v[0])).toFixed(2), 'z', Math.min(...center.map(v => v[2])).toFixed(2), Math.max(...center.map(v => v[2])).toFixed(2), 'y', Math.min(...center.map(v => v[1])).toFixed(2), Math.max(...center.map(v => v[1])).toFixed(2));
}
