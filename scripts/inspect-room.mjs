import { readFileSync } from 'node:fs';
const buf = readFileSync('public/assets/models/sitting_room_with_baked_textures.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart);
function acc(i) {
  const a = json.accessors[i]; const bv = json.bufferViews[a.bufferView];
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ?? 12;
  const out = [];
  for (let k = 0; k < a.count; k++) out.push([bin.readFloatLE(off + k * stride), bin.readFloatLE(off + k * stride + 4), bin.readFloatLE(off + k * stride + 8)]);
  return out;
}
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
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const world = json.nodes.map(() => null);
function walk(i, parent) {
  const m = parent ? mul(parent, mat(json.nodes[i])) : mat(json.nodes[i]);
  world[i] = m;
  for (const c of json.nodes[i].children ?? []) walk(c, m);
}
for (const s of json.scenes[json.scene ?? 0].nodes) walk(s, null);
json.nodes.forEach((n, i) => {
  if (n.mesh === undefined) return;
  for (const p of json.meshes[n.mesh].primitives) {
    const verts = acc(p.attributes.POSITION).map(v => {
      const m = world[i];
      return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
    });
    const min = [0, 1, 2].map(a => Math.min(...verts.map(v => v[a])));
    const max = [0, 1, 2].map(a => Math.max(...verts.map(v => v[a])));
    console.log(n.name, 'mat', json.materials[p.material]?.name, 'verts', verts.length, 'min', min.map(v => +v.toFixed(3)), 'max', max.map(v => +v.toFixed(3)));
  }
});
console.log('textures', json.images?.map(im => im.mimeType ?? im.uri));
