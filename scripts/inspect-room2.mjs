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
const mesh = json.meshes[json.nodes.find(n => n.name === 'Object_2').mesh];
const verts = acc(mesh.primitives[0].attributes.POSITION);
const bins = new Map();
for (const v of verts) { const b = Math.round(v[2] * 20) / 20; bins.set(b, (bins.get(b) ?? 0) + 1); }
console.log('Object_2 z-levels (0.05 bins):', [...bins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));
// horizontal extent of vertices at the dominant low level
const low = [...bins.entries()].filter(([z]) => z <= 0.1).sort((a, b) => b[1] - a[1])[0][0];
const at = verts.filter(v => Math.abs(v[2] - low) < 0.03);
console.log('dominant low z', low, 'count', at.length, 'x', Math.min(...at.map(v => v[0])).toFixed(2), Math.max(...at.map(v => v[0])).toFixed(2), 'y', Math.min(...at.map(v => v[1])).toFixed(2), Math.max(...at.map(v => v[1])).toFixed(2));
const high = verts.filter(v => v[2] > 0.3);
console.log('above 0.3 count', high.length, 'x', Math.min(...high.map(v => v[0])).toFixed(2), Math.max(...high.map(v => v[0])).toFixed(2), 'y', Math.min(...high.map(v => v[1])).toFixed(2), Math.max(...high.map(v => v[1])).toFixed(2), 'zmax', Math.max(...high.map(v => v[2])).toFixed(2));
