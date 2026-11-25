// Round-4 asset registration: remove the cafe EXR background entirely and
// register the user-supplied sitting room GLB (source archive + runtime copy).
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const manifestPath = 'assets/asset-manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const runtime = 'public/assets/models/sitting_room_with_baked_textures.glb';
const source = 'assets/source/round4/sitting_room_with_baked_textures.glb';
mkdirSync('assets/source/round4', { recursive: true });
copyFileSync(runtime, source);

const record = path => {
  const bytes = readFileSync(path);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
};

manifest.files = (manifest.files ?? []).filter(file => !file.path.includes('comfy_cafe'));
manifest.assets = (manifest.assets ?? []).filter(asset => asset.id !== 'comfy-cafe-hdri');
for (const path of ['public/assets/textures/comfy_cafe_4k.exr', 'assets/source/round3/comfy_cafe_4k.exr']) {
  if (existsSync(path)) rmSync(path);
}
const sourceRecord = { ...record(source), roles: ['supplied-source'], operation: 'Registered by scripts/register-round4-assets.mjs' };
const runtimeRecord = { ...record(runtime), roles: ['runtime-asset'], operation: 'Registered by scripts/register-round4-assets.mjs' };
manifest.files.push(sourceRecord, runtimeRecord);
manifest.assets.push({
  id: 'sitting-room-baked',
  name: 'Sitting Room with Baked Textures (room shell, floor, baked furniture)',
  author: 'jimbogies (Sketchfab)',
  sourceUrl: 'https://sketchfab.com/3d-models/sitting-room-with-baked-textures-61fdbbef86b9496d80644492a84c916f',
  acquiredDate: '2026-11-19',
  license: 'CC BY 4.0 (recorded in the supplied GLB asset extras); file handed over by the user from D:\\智器云杯.',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  usage: 'Play environment replacing the cafe HDRI: floor at y=0, shell centred on the table, baked coffee table in the playfield culled at load, ceiling split out for the top camera. Baked textures shown unlit; served locally unchanged.',
  restrictions: 'Attribution retained in NOTICE. Personal non-commercial Demo per user instruction. Local runtime use only; no remote fetch.',
  status: 'available',
  originalPaths: [source],
  outputPaths: [runtime],
});
manifest.lastAcquiredDate = '2026-11-19';
manifest.notes = `${manifest.notes ?? ''},Round 4 removed the comfy_cafe EXR (background and source archive deleted) and replaced it with the user-supplied sitting room GLB; the procedural room remains only as a load-failure fallback.`;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
copyFileSync(manifestPath, 'public/assets/asset-manifest.json');
console.log('registered', sourceRecord.bytes, 'byte source and', runtimeRecord.bytes, 'byte runtime copy; cafe EXR entries and files removed');