// Round-5 asset registration: the user-supplied cc0 cue stick GLB replaces the
// cue previously extracted from the traditional table model. The filename says
// CC0 but the GLB asset extras record CC-BY-4.0 by plaggy; the truthful license
// is registered and attribution is kept in NOTICE.
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const manifestPath = 'assets/asset-manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const runtime = 'public/assets/models/cc0_-_cue_stick.glb';
const source = 'assets/source/round5/cc0_-_cue_stick.glb';

const record = path => {
  const bytes = readFileSync(path);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
};

manifest.files = (manifest.files ?? []).filter(file => !file.path.endsWith('cc0_-_cue_stick.glb'));
manifest.assets = (manifest.assets ?? []).filter(asset => asset.id !== 'cc0-cue-stick');
const sourceRecord = { ...record(source), roles: ['supplied-source'], operation: 'Registered by scripts/register-round5-assets.mjs' };
const runtimeRecord = { ...record(runtime), roles: ['runtime-asset'], operation: 'Registered by scripts/register-round5-assets.mjs' };
manifest.files.push(sourceRecord, runtimeRecord);
manifest.assets.push({
  id: 'cc0-cue-stick',
  name: 'CC0 - Cue Stick (billiard cue, single tapered mesh with baked wood textures)',
  author: 'plaggy (Sketchfab)',
  sourceUrl: 'https://sketchfab.com/3d-models/cc0-cue-stick-311d2a1ac8d64037b6b9f8561d6d13ed',
  acquiredDate: '2026-11-19',
  license: 'CC BY 4.0 (recorded in the supplied GLB asset extras; the CC0 filename is not the license). File handed over by the user from D:\\智器云杯.',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  usage: 'Visible aiming cue replacing the cue formerly extracted from the traditional table GLB. src/view/CueStick.ts aligns the diagonal shaft by covariance axis, puts the thin tip at local x=0, scales to 1.45 m length / 31 mm butt diameter; computeCuePose keeps the axis through the ball centre and elevates the shaft over the rail cap. Served locally unchanged.',
  restrictions: 'Attribution retained in NOTICE. Personal non-commercial Demo per user instruction. Local runtime use only; no remote fetch.',
  status: 'available',
  originalPaths: [source],
  outputPaths: [runtime],
});
manifest.lastAcquiredDate = '2026-11-19';
manifest.notes = `${manifest.notes ?? ''},Round 5 replaced the table-extracted cue with the user-supplied cc0 cue stick GLB (CC-BY-4.0 by plaggy per asset extras) and added an elevated anti-penetration aiming pose.`;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
copyFileSync(manifestPath, 'public/assets/asset-manifest.json');
console.log('registered', sourceRecord.bytes, 'byte source and', runtimeRecord.bytes, 'byte runtime copy; sha256', runtimeRecord.sha256);