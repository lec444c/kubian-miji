import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'assets/asset-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const today = '2026-11-23';

const removedExecutive = [
  'assets/source/fight/executive_in_a_navy_suit.glb',
  'assets/source/fight/executive-in-a-navy-suit-provenance.txt',
  'public/assets/fight/character/executive_in_a_navy_suit.glb',
];
for (const rel of removedExecutive) {
  const abs = resolve(root, rel);
  if (existsSync(abs)) rmSync(abs);
}
manifest.assets = manifest.assets.filter(a => a.id !== 'fight-user-executive-in-a-navy-suit');
manifest.files = manifest.files.filter(f => !removedExecutive.includes(f.path));
const round22Ids = ['fight-user-labrador-dog', 'fight-user-dagou-audio', 'fight-user-dagou-banner', 'kenney-particle-pack'];
manifest.assets = manifest.assets.filter(a => !round22Ids.includes(a.id));
manifest.files = manifest.files.filter(f => !f.path.includes('labrador_dog') && !f.path.includes('dagou') && !f.path.includes('fight/particles/'));

const sha = rel => createHash('sha256').update(readFileSync(resolve(root, rel))).digest('hex');
const fileEntry = (rel, roles, operation) => ({
  path: rel, bytes: statSync(resolve(root, rel)).size, sha256: sha(rel), roles, operation,
});

const particleNames = ['fire_01', 'flame_04', 'flare_01', 'light_01', 'magic_05', 'spark_04', 'star_06', 'smoke_08', 'slash_01', 'trace_01', 'twirl_01', 'circle_05', 'muzzle_02', 'scorch_01'];

const newAssets = [
  {
    id: 'fight-user-labrador-dog',
    name: 'Labrador Dog (ultimate skill projectile)',
    author: 'kenchoo (Sketchfab)',
    sourceUrl: 'https://sketchfab.com/3d-models/labrador-dog-1f56cfbab07e4fe49b5d9e521c82073a',
    downloadUrl: null,
    acquiredDate: today,
    license: 'CC-BY-4.0 (transcribed from embedded GLB metadata; not independently verified)',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    usage: 'Local fight demo: rage ultimate summons the dog to charge, launch and stun the opponent.',
    restrictions: 'Embedded CC-BY-4.0 declaration is transcribed, not independently verified; attribution required if redistributed. Not a commercial-license certification.',
    status: 'available',
    releaseClearance: 'Not cleared for external distribution or commercial release',
    licenseEvidence: [],
    documentationPaths: ['assets/source/fight/conversion-report.json'],
    originalPaths: ['assets/source/fight/labrador_dog.glb'],
    outputPaths: ['public/assets/fight/dog/labrador_dog.glb'],
    processing: { copy: 'Byte-for-byte copy; skinned mesh with one built-in animation clip, normalized and scaled at runtime.' },
  },
  {
    id: 'fight-user-dagou-audio',
    name: 'User-supplied ultimate voice line (大狗大狗叫叫叫)',
    author: 'Unknown; attachment author and third-party origin not verified',
    sourceUrl: 'file:///D:/智器云杯/大狗大狗叫叫叫（戴口罩）_爱给网_aigei_com.mp3',
    downloadUrl: null,
    acquiredDate: today,
    license: 'User attachment; no verified third-party license evidence supplied',
    licenseUrl: null,
    usage: 'Local fight demo: chant loop while casting the ultimate, bark segment on hit.',
    restrictions: 'User attachment origin, authorship and third-party redistribution/commercial rights are unverified. Local demo only.',
    status: 'available',
    releaseClearance: 'Not cleared for external distribution or commercial release',
    licenseEvidence: [],
    documentationPaths: ['assets/source/fight/conversion-report.json'],
    originalPaths: ['assets/source/fight/audio/dagou-source.mp3'],
    outputPaths: ['public/assets/fight/audio/dagou-chant.mp3', 'public/assets/fight/audio/dagou-bark.mp3'],
    processing: {
      trim: 'dagou-chant.mp3 = 0-0.87 s (repeated 大狗大狗 syllables) with 10 ms fade-in / 30 ms fade-out; dagou-bark.mp3 = 0.88-1.78 s (叫叫叫 syllables) with 10 ms fade-in / 50 ms fade-out. Segments chosen from the 50 ms RMS envelope; not a labeled stem split. imageio_ffmpeg ffmpeg 7.1, 128 kbps.',
    },
  },
  {
    id: 'fight-user-dagou-banner',
    name: 'User-supplied flaming dog banner image (ultimate broadcast)',
    author: 'Unknown; user-provided image, origin not verified',
    sourceUrl: 'file:///C:/Users/yuhongyi/Documents/Qoder/2026-11-21/5c7ca13c/game/assets/source/fight/dagou-banner.webp',
    downloadUrl: null,
    acquiredDate: today,
    license: 'User attachment; no verified third-party license evidence supplied',
    licenseUrl: null,
    usage: 'Local fight demo: near-fullscreen ultimate name broadcast artwork.',
    restrictions: 'User attachment origin and third-party redistribution/commercial rights are unverified. Local demo only.',
    status: 'available',
    releaseClearance: 'Not cleared for external distribution or commercial release',
    licenseEvidence: [],
    documentationPaths: ['assets/source/fight/conversion-report.json'],
    originalPaths: ['assets/source/fight/dagou-banner.webp'],
    outputPaths: ['public/assets/fight/dagou-banner.webp'],
    processing: { copy: 'Byte-for-byte copy of the user-provided WebP.' },
  },
  {
    id: 'kenney-particle-pack',
    name: 'Kenney Particle Pack 1.1 (selected transparent PNG sprites)',
    author: 'Kenney Vleugels (Kenney.nl)',
    sourceUrl: 'https://kenney.nl/assets/particle-pack',
    downloadUrl: null,
    acquiredDate: today,
    license: 'CC0 (Creative Commons Zero), per bundled License.txt',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    usage: 'Local fight demo: textured sprites for skill projectiles, hit bursts, trails and the ultimate explosion.',
    restrictions: 'CC0 permits reuse; credit appreciated but not required. 14 of the pack PNGs are used at runtime.',
    status: 'available',
    releaseClearance: 'CC0; no known restriction',
    licenseEvidence: ['assets/source/fight/particles/License.txt'],
    documentationPaths: ['assets/source/fight/conversion-report.json'],
    originalPaths: ['assets/source/fight/particles/kenney_particle-pack.zip', 'assets/source/fight/particles/License.txt'],
    outputPaths: particleNames.map(n => `public/assets/fight/particles/${n}.png`),
    processing: { extract: 'Unzipped locally; 14 transparent PNGs copied byte-for-byte to public/assets/fight/particles/. No remote service.' },
  },
];
manifest.assets.push(...newAssets);

const newFiles = [
  fileEntry('assets/source/fight/labrador_dog.glb', ['supplied-source'], 'User-supplied dog GLB retained locally; embedded CC-BY-4.0 declaration transcribed, not independently verified.'),
  fileEntry('public/assets/fight/dog/labrador_dog.glb', ['runtime'], 'Byte-for-byte runtime copy of the supplied dog GLB.'),
  fileEntry('assets/source/fight/audio/dagou-source.mp3', ['supplied-source'], 'User-supplied ultimate voice line retained locally; third-party rights unverified.'),
  fileEntry('public/assets/fight/audio/dagou-chant.mp3', ['runtime', 'derived'], 'Chant loop segment 0-0.87 s trimmed from dagou-source.mp3.'),
  fileEntry('public/assets/fight/audio/dagou-bark.mp3', ['runtime', 'derived'], 'Bark hit segment 0.88-1.78 s trimmed from dagou-source.mp3.'),
  fileEntry('assets/source/fight/dagou-banner.webp', ['supplied-source'], 'User-supplied banner image retained locally; third-party rights unverified.'),
  fileEntry('public/assets/fight/dagou-banner.webp', ['runtime'], 'Byte-for-byte runtime copy of the banner image.'),
  fileEntry('assets/source/fight/particles/kenney_particle-pack.zip', ['supplied-source'], 'Kenney Particle Pack 1.1 archive retained locally (CC0).'),
  fileEntry('assets/source/fight/particles/License.txt', ['license-evidence'], 'Bundled CC0 license text of the Kenney Particle Pack.'),
  ...particleNames.map(n => fileEntry(`public/assets/fight/particles/${n}.png`, ['runtime'], `Byte-for-byte copy of Kenney Particle Pack PNG (Transparent)/${n}.png (CC0).`)),
];
manifest.files.push(...newFiles);
manifest.lastAcquiredDate = today;
if (!manifest.notes.includes('Round 22:')) manifest.notes += ',Round 22: the round-21 executive character was removed at user request (both fighters share the Indian Man in Suit model); its source/runtime copies and manifest entries were deleted. Added labrador dog GLB, ultimate voice line segments, banner WebP and 14 Kenney CC0 particle sprites.';

const reportPath = resolve(root, 'assets/source/fight/conversion-report.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
delete report.executive;
report.executiveRemoved = 'Round 22 (2026-11-23): executive_in_a_navy_suit.glb removed at user request; both fighters use indian_man_in_suit.glb. Source copy, runtime copy, provenance file and manifest entries deleted; D-drive original untouched.';
report.dog = {
  source: 'assets/source/fight/labrador_dog.glb',
  output: 'public/assets/fight/dog/labrador_dog.glb',
  bytes: statSync(resolve(root, 'public/assets/fight/dog/labrador_dog.glb')).size,
  sha256: sha('public/assets/fight/dog/labrador_dog.glb'),
  structure: '1 skin, 2 meshes, 1 material, 3 embedded images, 1 animation clip; bbox height ~2.78 m, length ~5.44 m before runtime normalization.',
  license: 'Embedded CC-BY-4.0 (kenchoo, Sketchfab), transcribed not verified.',
};
report.dagouAudio = {
  source: 'assets/source/fight/audio/dagou-source.mp3',
  durationSeconds: 1.86,
  chant: { output: 'public/assets/fight/audio/dagou-chant.mp3', range: '0-0.87 s', sha256: sha('public/assets/fight/audio/dagou-chant.mp3') },
  bark: { output: 'public/assets/fight/audio/dagou-bark.mp3', range: '0.88-1.78 s', sha256: sha('public/assets/fight/audio/dagou-bark.mp3') },
  method: '50 ms RMS envelope syllable boundaries; imageio_ffmpeg ffmpeg 7.1; not a labeled stem split.',
};
report.dagouBanner = { source: 'assets/source/fight/dagou-banner.webp', output: 'public/assets/fight/dagou-banner.webp', sha256: sha('public/assets/fight/dagou-banner.webp') };
report.particles = {
  pack: 'Kenney Particle Pack 1.1 (CC0, bundled License.txt)',
  archive: 'assets/source/fight/particles/kenney_particle-pack.zip',
  selected: particleNames.map(n => `public/assets/fight/particles/${n}.png`),
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

const reportEntry = manifest.files.find(f => f.path === 'assets/source/fight/conversion-report.json');
if (reportEntry) {
  reportEntry.bytes = statSync(reportPath).size;
  reportEntry.sha256 = createHash('sha256').update(readFileSync(reportPath)).digest('hex');
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(resolve(root, 'public/assets/asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const scratch = resolve(root, 'assets/source/fight/audio/dagou.pcm');
if (existsSync(scratch)) rmSync(scratch);

console.log(JSON.stringify({
  removedExecutive, addedAssets: newAssets.map(a => a.id), addedFiles: newFiles.length,
  totalFiles: manifest.files.length,
}, null, 2));