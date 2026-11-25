// Registers round-3 assets (cafe HDRI, traditional table GLB, normalized BGM,
// sample SFX, game-icons SVGs) into assets/asset-manifest.json and mirrors the
// manifest to public/assets/asset-manifest.json. Idempotent: existing ids/paths
// are skipped. Hashes are computed from the actual bytes on disk.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'assets/asset-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const round3 = JSON.parse(readFileSync(resolve(root, 'scripts/round3-assets-report.json'), 'utf8'));
const scout = JSON.parse(readFileSync(resolve(root, 'scripts/asset-scout-report.json'), 'utf8'));

const hash = rel => createHash('sha256').update(readFileSync(resolve(root, rel))).digest('hex');
const fileRecord = rel => ({
  path: rel,
  roles: [rel.startsWith('assets/source/') ? 'supplied-source' : 'runtime-asset'],
  bytes: statSync(resolve(root, rel)).size,
  sha256: hash(rel),
  operation: rel.startsWith('assets/source/')
    ? 'Copied byte-for-byte from the user-supplied round-3 files'
    : 'Produced locally by scripts/prepare_round3_assets.py or scripts/optimize-table.mjs, or downloaded from the recorded public source',
});

const acquired = '2026-11-19';
const newAssets = [];
const newFiles = [];
const addFile = rel => { if (!manifest.files.some(f => f.path === rel) && !newFiles.some(f => f.path === rel)) newFiles.push(fileRecord(rel)); };
const addAsset = entry => { if (!manifest.assets.some(a => a.id === entry.id)) newAssets.push(entry); };

// 1. Cafe HDRI (user-supplied file; name matches the Poly Haven CC0 HDRI).
const hdri = round3.find(r => r.id === 'comfy-cafe-hdri');
addAsset({
  id: 'comfy-cafe-hdri',
  name: 'comfy_cafe 4k equirectangular HDRI (cafe interior)',
  author: 'Poly Haven (file supplied directly by the user)',
  sourceUrl: 'https://polyhaven.com/a/comfy_cafe',
  acquiredDate: acquired,
  license: 'CC0 1.0 Universal (Poly Haven HDRI license); file handed over by the user for this personal non-commercial Demo.',
  licenseUrl: 'https://polyhaven.com/license',
  usage: 'Scene background and PMREM environment light. Downscaled at runtime to a 2048x1024 half-float render target; the 4k EXR is served locally unchanged.',
  restrictions: 'Local runtime use only; no remote fetch.',
  status: 'available',
  originalPaths: ['assets/source/round3/comfy_cafe_4k.exr'],
  outputPaths: ['public/assets/textures/comfy_cafe_4k.exr'],
});
addFile('assets/source/round3/comfy_cafe_4k.exr');
addFile('public/assets/textures/comfy_cafe_4k.exr');

// 2. Traditional pool table / cue / lamp GLB (Sketchfab, CC-BY-4.0).
const tableSrc = round3.find(r => r.id === 'pool-table-traditional-source');
addAsset({
  id: 'pool-table-traditional',
  name: 'Pool Table Traditional (table, cue, ceiling lamp)',
  author: 'fizyman (Sketchfab)',
  sourceUrl: 'https://sketchfab.com/3d-models/pool-table-traditional-e0b938c0c2e74eb794a49ebde2543977',
  acquiredDate: acquired,
  license: 'CC BY 4.0 (Sketchfab model license, recorded in the GLB asset metadata); file supplied directly by the user.',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  usage: 'Replaces the reference table mesh, cue and hanging lamp visuals. Baked-in balls and the duplicate cue are removed at dev time; textures resized to 1024px. Runtime fit measures the cloth and cushion nose so the authoritative physics geometry is unchanged.',
  restrictions: 'Attribution retained in NOTICE. Personal non-commercial Demo per user instruction.',
  status: 'available',
  originalPaths: ['assets/source/round3/pool_table_traditional.glb'],
  outputPaths: ['public/assets/models/pool-table-traditional.glb'],
});
addFile('assets/source/round3/pool_table_traditional.glb');
addFile('public/assets/models/pool-table-traditional.glb');

// 3. BGM tracks (user-supplied Pixabay music, loudness-normalized to -16 LUFS).
const bgmMeta = [
  ['bgm-track-1', 'Background Jazz Music', 'pulsebox', 'https://pixabay.com/music/id-448453/'],
  ['bgm-track-2', 'Jazz Background Music', 'pulsebox', 'https://pixabay.com/music/id-448455/'],
  ['bgm-track-3', 'Free Lounge Music', 'happinessinmusic', 'https://pixabay.com/music/id-478072/'],
  ['bgm-track-4', 'Background Music Instrumental', 'faespencer', 'https://pixabay.com/music/id-207886/'],
];
for (const [id, name, author, url] of bgmMeta) {
  const rec = round3.find(r => r.id === id);
  addAsset({
    id,
    name: `${name} (BGM, normalized to -16 LUFS)`,
    author: `${author} (Pixabay); file supplied directly by the user`,
    sourceUrl: url,
    acquiredDate: acquired,
    license: 'Pixabay Content License (free use, no attribution required); two-pass ffmpeg loudnorm I=-16 LUFS TP=-1.5 LRA=11 applied locally.',
    licenseUrl: 'https://pixabay.com/service/license-summary/',
    usage: `Random-order background music playlist. Input integrated loudness ${rec.inputI} LUFS, output ${rec.outputI} LUFS, true peak ${rec.outputTp} dBTP.`,
    restrictions: 'Local runtime use only.',
    status: 'available',
    originalPaths: [rec.original.replace(/\\/g, '/').replace('D:/game race/', '')],
    outputPaths: [rec.runtime],
  });
  addFile(rec.original.replace(/\\/g, '/').replace('D:/game race/', ''));
  addFile(rec.runtime);
}

// 4. Sample SFX and skill icons from the scout report.
const slotUsage = {
  'ball-hit': 'Ball-ball collision impact sample.',
  cushion: 'Ball-cushion impact sample.',
  'cue-strike': 'Cue tip strike sample.',
  pocket: 'Ball dropping into pocket sample.',
  'hairdryer-loop': 'Looped hairdryer blower sample for the hairdryer skill.',
  'icon-hand': 'Skill icon for 手部微操 (open-palm).',
  'icon-hairdryer': 'Skill icon for 吹风机 (wind-hole).',
  'icon-fake': 'Skill icon for 假自由球 (domino-mask).',
};
for (const rec of scout) {
  addAsset({
    id: `round3-${rec.slot}`,
    name: rec.notes.split('.')[0],
    author: rec.author,
    sourceUrl: rec.sourceUrl,
    acquiredDate: rec.downloadedAt,
    license: rec.license,
    licenseUrl: rec.licenseUrl,
    usage: slotUsage[rec.slot] ?? rec.slot,
    restrictions: rec.license === 'CC BY 3.0' ? 'Attribution required and retained in NOTICE.' : 'None beyond local runtime use.',
    status: 'available',
    originalPaths: [],
    outputPaths: [rec.localPath],
  });
  addFile(rec.localPath);
}

manifest.assets.push(...newAssets);
manifest.files.push(...newFiles);
for (const file of manifest.files) {
  if (!file.roles) file.roles = [file.path.startsWith('assets/source/') ? 'supplied-source' : 'runtime-asset'];
  if (!file.operation) file.operation = 'Registered by scripts/register-round3-assets.mjs';
}
manifest.lastAcquiredDate = [manifest.acquiredDate, manifest.lastAcquiredDate, acquired].filter(Boolean).sort().pop();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
copyFileSync(manifestPath, resolve(root, 'public/assets/asset-manifest.json'));
console.log(`registered ${newAssets.length} assets, ${newFiles.length} files; manifest now ${manifest.assets.length} assets / ${manifest.files.length} files`);