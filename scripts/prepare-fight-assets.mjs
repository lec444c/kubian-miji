/**
 * Local-only, fixed-scope fight asset preprocessing. Run: node scripts/prepare-fight-assets.mjs
 * Reads ONLY the 14 supplied motion FBXs, the Indian Man in Suit GLB, the Executive In A Navy Suit
 * GLB, the Oiiaioooooiai Cat GLB and the four user-supplied fight audio sources.
 * Writes ONLY public/assets/fight/, assets/source/fight/conversion-report.json and provenance,
 * the two existing asset manifests and this workflow's appended NOTICE section.
 * No downloads, dependency installs, mesh generation, retargeting, gameplay/UI edits,
 * source-character edits, GLB conversion or build-single-file changes.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AnimationClip, LoadingManager, REVISION } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), '..');
const DATE = '2026-11-23';
const SOURCE_DIR = 'assets/source/fight';
const OUTPUT_DIR = 'public/assets/fight';
const MOTIONS_PATH = `${OUTPUT_DIR}/motions.json`;
const REPORT_PATH = `${SOURCE_DIR}/conversion-report.json`;
const CHARACTER_SOURCE = `${SOURCE_DIR}/indian_man_in_suit.glb`;
const CHARACTER_OUTPUT = `${OUTPUT_DIR}/character/indian_man_in_suit.glb`;
const CHARACTER_PROVENANCE = `${SOURCE_DIR}/indian-man-in-suit-provenance.txt`;
const CAT_SOURCE = `${SOURCE_DIR}/oiiaioooooiai_cat.glb`;
const CAT_OUTPUT = `${OUTPUT_DIR}/cat/oiiaioooooiai_cat.glb`;
const CAT_PROVENANCE = `${SOURCE_DIR}/oiiaioooooiai-cat-provenance.txt`;
const EXECUTIVE_SOURCE = `${SOURCE_DIR}/executive_in_a_navy_suit.glb`;
const EXECUTIVE_OUTPUT = `${OUTPUT_DIR}/character/executive_in_a_navy_suit.glb`;
const EXECUTIVE_PROVENANCE = `${SOURCE_DIR}/executive-in-a-navy-suit-provenance.txt`;
// Audio sources are user attachments; laowu-cat-2s.mp3 is the documented first-2-second trim.
const AUDIO_SOURCES = {
  'laowu-cat': { source: `${SOURCE_DIR}/audio/laowu-cat-2s.mp3`, output: `${OUTPUT_DIR}/audio/laowu-cat.mp3`, origin: `${SOURCE_DIR}/audio/laowu-cat-source.mp3` },
  'fight-bgm': { source: `${SOURCE_DIR}/audio/fight-bgm-source.mp3`, output: `${OUTPUT_DIR}/audio/fight-bgm.mp3`, origin: `${SOURCE_DIR}/audio/fight-bgm-source.mp3` },
  'punch-a': { source: `${SOURCE_DIR}/audio/punch-a-source.mp3`, output: `${OUTPUT_DIR}/audio/punch-a.mp3`, origin: `${SOURCE_DIR}/audio/punch-a-source.mp3` },
  'punch-b': { source: `${SOURCE_DIR}/audio/punch-b-source.mp3`, output: `${OUTPUT_DIR}/audio/punch-b.mp3`, origin: `${SOURCE_DIR}/audio/punch-b-source.mp3` },
};
const OLD_CHARACTER_OUTPUTS = [
  `${OUTPUT_DIR}/character/male.gltf`,
  `${OUTPUT_DIR}/character/Superhero_Male_FullBody.bin`,
  `${OUTPUT_DIR}/character/T_Hair_1_Normal.png`,
  `${OUTPUT_DIR}/character/T_Hair_1_BaseColor.png`,
  `${OUTPUT_DIR}/character/T_Eye_Normal.png`,
  `${OUTPUT_DIR}/character/T_Eye_Brown.png`,
  `${OUTPUT_DIR}/character/T_Superhero_Male_Normal.png`,
  `${OUTPUT_DIR}/character/T_Superhero_Male_Dark.png`,
  `${OUTPUT_DIR}/character/T_Superhero_Male_Roughness.png`,
];
const OLD_CHARACTER_ASSET_IDS = ['fight-quaternius-superhero-male-local-copy'];
const MANIFEST_PATHS = ['assets/asset-manifest.json', 'public/assets/asset-manifest.json'];
const SOURCE_FILES = {
  idle: '原地/Great Sword Idle.fbx',
  walk: 'Great Sword Walk.fbx',
  run: 'Great Sword Run.fbx',
  jump: 'Great Sword Jump.fbx',
  jumpBack: 'Great Sword Jump(1).fbx',
  turn: '转向/Great Sword Turn.fbx',
  turnAlt: '转向/Great Sword Turn(1).fbx',
  impact: '受击/Great Sword Impact.fbx',
  impactAlt: '受击/Great Sword Impact(1).fbx',
  slash: '攻击/Great Sword Slash.fbx',
  slashAlt: '攻击/Great Sword Slash(1).fbx',
  skillBall: '技能/Great Sword Slash.fbx',
  skillVolley: '技能/Standing Draw Arrow.fbx',
  death: 'Standing Death Left 01.fbx',
};
const abs = (path) => resolve(ROOT, path);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileRecord = (path) => {
  const bytes = readFileSync(abs(path));
  return { path, bytes: bytes.length, sha256: hash(bytes) };
};
const round6 = (value) => {
  assert(Number.isFinite(value), 'Non-finite number in motion data');
  return Number(value.toFixed(6)) || 0; // JSON serializes negative zero as zero.
};
const motionReplacer = (_key, value) => typeof value === 'number' ? round6(value) : value;
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;
const nearestBone = (node) => {
  let parent = node.parent;
  while (parent && !parent.isBone) parent = parent.parent;
  return parent?.name ?? null;
};

// Fail before producing outputs if the existing manifests are not synchronized.
const manifestText = readFileSync(abs(MANIFEST_PATHS[0]), 'utf8');
assert.equal(readFileSync(abs(MANIFEST_PATHS[1]), 'utf8'), manifestText);
const manifest = JSON.parse(manifestText);
const originalNotice = readFileSync(abs('NOTICE'), 'utf8');

// The supplied character is a self-contained GLB; keep its embedded metadata as provenance.
const characterRecord = fileRecord(CHARACTER_SOURCE);
const characterBytes = readFileSync(abs(CHARACTER_SOURCE));
assert.equal(characterBytes.toString('ascii', 0, 4), 'glTF', 'Character must be a glTF 2.0 GLB');
assert.equal(characterBytes.readUInt32LE(4), 2, 'Character must be glTF 2.0');
const characterJsonLength = characterBytes.readUInt32LE(12);
const characterJson = JSON.parse(characterBytes.subarray(20, 20 + characterJsonLength).toString('utf8'));
const embedded = characterJson.asset?.extras ?? {};
assert(embedded.title && embedded.author && embedded.license && embedded.source, 'Character GLB must declare title/author/license/source');
const provenanceText = [
  'Fight character provenance: user-supplied GLB',
  `Acquired: ${DATE}`,
  `Source file: ${CHARACTER_SOURCE}`,
  `Bytes: ${characterRecord.bytes}`,
  `SHA-256: ${characterRecord.sha256}`,
  '',
  'Embedded glTF asset metadata (transcribed from the GLB, not independently verified):',
  `Title: ${embedded.title}`,
  `Author: ${embedded.author}`,
  `License: ${embedded.license}`,
  `Source: ${embedded.source}`,
  '',
  'Notes: Local fight demo only. Attribution must be preserved if the declared CC BY 4.0',
  'applies. The declaration is not a commercial-license clearance or independent rights check.',
  'The separately supplied 11 FBX motions remain under their own unverified provenance.',
].join('\n') + '\n';
writeFileSync(abs(CHARACTER_PROVENANCE), provenanceText);
mkdirSync(dirname(abs(CHARACTER_OUTPUT)), { recursive: true });
copyFileSync(abs(CHARACTER_SOURCE), abs(CHARACTER_OUTPUT));
const characterOutput = fileRecord(CHARACTER_OUTPUT);
assert.equal(characterOutput.sha256, characterRecord.sha256);

// The cat is a self-contained, unskinned GLB; keep its embedded attribution too.
const catRecord = fileRecord(CAT_SOURCE);
const catBytes = readFileSync(abs(CAT_SOURCE));
assert.equal(catBytes.toString('ascii', 0, 4), 'glTF', 'Cat must be a glTF 2.0 GLB');
assert.equal(catBytes.readUInt32LE(4), 2, 'Cat must be glTF 2.0');
const catJsonLength = catBytes.readUInt32LE(12);
const catJson = JSON.parse(catBytes.subarray(20, 20 + catJsonLength).toString('utf8'));
const catEmbedded = catJson.asset?.extras ?? {};
assert(catEmbedded.title && catEmbedded.author && catEmbedded.license && catEmbedded.source, 'Cat GLB must declare title/author/license/source');
const catProvenanceText = [
  'Fight skill cat provenance: user-supplied GLB',
  `Acquired: ${DATE}`,
  `Source file: ${CAT_SOURCE}`,
  `Bytes: ${catRecord.bytes}`,
  `SHA-256: ${catRecord.sha256}`,
  '',
  'Embedded glTF asset metadata (transcribed from the GLB, not independently verified):',
  `Title: ${catEmbedded.title}`,
  `Author: ${catEmbedded.author}`,
  `License: ${catEmbedded.license}`,
  `Source: ${catEmbedded.source}`,
  '',
  'Notes: Local fight demo projectile only. Attribution must be preserved if the declared',
  'CC BY 4.0 applies. The declaration is not a commercial-license clearance or independent',
  'rights check. The separately supplied 13 FBX motions remain under their own unverified provenance.',
].join('\n') + '\n';
writeFileSync(abs(CAT_PROVENANCE), catProvenanceText);
mkdirSync(dirname(abs(CAT_OUTPUT)), { recursive: true });
copyFileSync(abs(CAT_SOURCE), abs(CAT_OUTPUT));
const catOutput = fileRecord(CAT_OUTPUT);
assert.equal(catOutput.sha256, catRecord.sha256);

// The second character is a static (unskinned) GLB; runtime auto-rigs it onto the Indian skeleton.
const executiveRecord = fileRecord(EXECUTIVE_SOURCE);
const executiveBytes = readFileSync(abs(EXECUTIVE_SOURCE));
assert.equal(executiveBytes.toString('ascii', 0, 4), 'glTF', 'Executive must be a glTF 2.0 GLB');
assert.equal(executiveBytes.readUInt32LE(4), 2, 'Executive must be glTF 2.0');
const executiveJsonLength = executiveBytes.readUInt32LE(12);
const executiveJson = JSON.parse(executiveBytes.subarray(20, 20 + executiveJsonLength).toString('utf8'));
const executiveEmbedded = executiveJson.asset?.extras ?? {};
assert(executiveEmbedded.title && executiveEmbedded.author && executiveEmbedded.license && executiveEmbedded.source, 'Executive GLB must declare title/author/license/source');
assert.equal((executiveJson.skins ?? []).length, 0, 'Executive GLB is expected to be static (no skin); runtime auto-rig supplies the skeleton');
const executiveProvenanceText = [
  'Fight second character provenance: user-supplied static GLB',
  `Acquired: ${DATE}`,
  `Source file: ${EXECUTIVE_SOURCE}`,
  `Bytes: ${executiveRecord.bytes}`,
  `SHA-256: ${executiveRecord.sha256}`,
  '',
  'Embedded glTF asset metadata (transcribed from the GLB, not independently verified):',
  `Title: ${executiveEmbedded.title}`,
  `Author: ${executiveEmbedded.author}`,
  `License: ${executiveEmbedded.license}`,
  `Source: ${executiveEmbedded.source}`,
  '',
  'Notes: Local fight demo only. The model ships without a skeleton; runtime auto-rigging in',
  'src/fight/characterModel.ts binds its meshes to a posed clone of the Indian Man in Suit skeleton.',
  'Attribution must be preserved if the declared CC BY 4.0 applies. The declaration is not a',
  'commercial-license clearance or independent rights check.',
].join('\n') + '\n';
writeFileSync(abs(EXECUTIVE_PROVENANCE), executiveProvenanceText);
mkdirSync(dirname(abs(EXECUTIVE_OUTPUT)), { recursive: true });
copyFileSync(abs(EXECUTIVE_SOURCE), abs(EXECUTIVE_OUTPUT));
const executiveOutput = fileRecord(EXECUTIVE_OUTPUT);
assert.equal(executiveOutput.sha256, executiveRecord.sha256);

// Fight audio: byte-for-byte copies of the supplied sources (cat scream pre-trimmed to 2 s).
const audioOutputs = {};
for (const [key, spec] of Object.entries(AUDIO_SOURCES)) {
  const sourceRecord = fileRecord(spec.source);
  mkdirSync(dirname(abs(spec.output)), { recursive: true });
  copyFileSync(abs(spec.source), abs(spec.output));
  const outputRecord = fileRecord(spec.output);
  assert.equal(outputRecord.sha256, sourceRecord.sha256, `${key}: audio copy must be byte-identical`);
  audioOutputs[key] = { source: sourceRecord, output: outputRecord, origin: fileRecord(spec.origin) };
}

const manager = new LoadingManager();
manager.setURLModifier((url) => { throw new Error(`Unexpected FBX dependency; no downloads allowed: ${url}`); });
const loader = new FBXLoader(manager);
loader.trimAnimationClips = false;
const motions = { schemaVersion: 1, unitScale: 0.01, bones: [], clips: {} };
const sources = [];
const processing = {
  selection: 'Use source.animations[0]; rename the cloned AnimationClip to its mapping key.',
  skeleton: 'Idle FBXLoader static/rest T-pose bone-local position, quaternion and scale, captured immediately after parse. No mixer, animation evaluation or frame-0 pose is applied. Names are unchanged FBXLoader names; parent is the nearest ancestor Bone or null.',
  coordinates: 'Y-up, +Z forward, centimeters. No axis conversion or baked scaling; unitScale=0.01 indicates centimeters to meters, applied once by the consumer.',
  rootMotion: {
    track: 'mixamorigHips.position',
    method: 'Set X and Z to absolute zero at EVERY existing key, not first-key subtraction. Preserve every Y sample in original centimeters (apart from JSON decimal rounding).',
    reason: 'Prevent planar root translation from adding to rules-driven actor movement.',
    rotations: 'All rotation tracks, including Hips turns/yaw, are retained. No rotational root-motion removal.',
  },
  time: 'Keep FBXLoader clip durations, track order, all key counts and timestamps; no trim, optimize, resampling, downsampling or time scaling. JSON numbers, including duration/timestamps, are rounded to six decimal places only. Exact original durations are retained separately in this report.',
  serialization: 'Three.AnimationClip.toJSON(clip), compact JSON with six-decimal numeric rounding; stable content-derived clip UUIDs for reproducible reruns.',
  character: 'Byte-for-byte copy of the user-supplied self-contained Indian Man in Suit GLB. Runtime normalizes its 1.83x centimetre root scale to 1.8 m and adapts Mixamo-style joint names to the rig contract; no mesh conversion, no animation retargeting, embedded animation unused.',
  executive: 'Byte-for-byte copy of the user-supplied static Executive In A Navy Suit GLB (no skeleton). Runtime auto-rigging binds its meshes to a posed clone of the Indian skeleton; no source mesh edit.',
  audio: 'Byte-for-byte copies of the supplied fight audio. laowu-cat.mp3 is the first 2 seconds of the cat scream, trimmed once with imageio_ffmpeg ffmpeg 7.1 (libmp3lame -q:a 2 -t 2); fight-bgm/punch-a/punch-b are unmodified copies.',
};

for (const [key, name] of Object.entries(SOURCE_FILES)) {
  const sourcePath = `${SOURCE_DIR}/${name}`;
  const bytes = readFileSync(abs(sourcePath));
  const sourceHash = hash(bytes);
  const scene = loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), `${dirname(abs(sourcePath))}/`);
  const bones = [];
  let meshCount = 0;
  scene.traverse((node) => {
    if (node.isBone) bones.push(node);
    if (node.isMesh) meshCount++;
  });
  assert.equal(meshCount, 0, `${key}: expected animation-only FBX (no mesh)`);
  assert.equal(bones.length, 65, `${key}: unexpected skeleton`);
  assert.equal(new Set(bones.map((bone) => bone.name)).size, 65);
  assert(bones.every((bone) => bone.name.startsWith('mixamorig') && !bone.name.includes(':')));
  const boneNames = new Set(bones.map((bone) => bone.name));
  if (key === 'idle') {
    // Do NOT sample an animation here: these are the loader's real static T-pose transforms.
    motions.bones = bones.map((bone) => ({
      name: bone.name,
      parent: nearestBone(bone),
      position: bone.position.toArray(),
      quaternion: bone.quaternion.toArray(),
      scale: bone.scale.toArray(),
    }));
  } else {
    // FBX sibling traversal order differs between files; compare hierarchy by name.
    const byName = (a, b) => a[0].localeCompare(b[0]);
    assert.deepEqual(
      bones.map((bone) => [bone.name, nearestBone(bone)]).sort(byName),
      motions.bones.map((bone) => [bone.name, bone.parent]).sort(byName),
    );
  }
  const original = scene.animations[0];
  assert(original, `${key}: no animation`);
  assert.equal(original.tracks.length, 53, `${key}: unexpected track count`);
  assert.equal(original.tracks.filter((track) => track.name.endsWith('.quaternion')).length, 52);
  assert(original.tracks.every((track) => boneNames.has(track.name.slice(0, track.name.lastIndexOf('.')))));
  assert.equal(original.tracks.filter((track) => track.name.endsWith('.position')).length, 1);
  const clip = original.clone();
  clip.name = key;
  const uuid = hash(`fight-motions-v1:${key}:${sourceHash}`);
  clip.uuid = `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-5${uuid.slice(13, 16)}-8${uuid.slice(17, 20)}-${uuid.slice(20, 32)}`;
  const hips = clip.tracks.find((track) => track.name === processing.rootMotion.track);
  assert(hips && hips.getValueSize() === 3, `${key}: missing Hips translation`);
  for (let i = 0; i < hips.values.length; i += 3) {
    hips.values[i] = 0;
    hips.values[i + 2] = 0;
  }
  assert.equal(clip.duration, original.duration);
  const serialized = JSON.parse(JSON.stringify(AnimationClip.toJSON(clip), motionReplacer));
  const parsed = AnimationClip.parse(serialized);
  assert(parsed.validate(), `${key}: invalid serialized animation`);
  assert.equal(serialized.duration, round6(original.duration));
  assert.equal(serialized.tracks.length, original.tracks.length);
  original.tracks.forEach((track, index) => {
    const output = serialized.tracks[index];
    assert.equal(output.name, track.name);
    assert.equal(output.type, track.ValueTypeName);
    assert.deepEqual(output.times, Array.from(track.times, round6));
    assert.equal(output.values.length, track.values.length);
    for (let i = 0; i < track.values.length; i++) {
      const expected = track.name === hips.name && i % 3 !== 1 ? 0 : round6(track.values[i]);
      assert.equal(output.values[i], expected, `${key}: changed track sample ${track.name}[${i}]`);
    }
  });
  if (key === 'idle') {
    const staticHips = motions.bones.find((bone) => bone.name === 'mixamorigHips');
    const animatedHips = original.tracks.find((track) => track.name === hips.name);
    assert.notEqual(round6(staticHips.position[1]), round6(animatedHips.values[1]), 'Static T-pose must not be replaced by idle frame 0');
  }
  motions.clips[key] = serialized;
  sources.push({
    key, sourcePath, bytes: bytes.length, sha256: sourceHash,
    boneCount: bones.length, meshCount, animationCount: scene.animations.length,
    selectedAnimationIndex: 0, originalClipName: original.name,
    duration: original.duration, trackCount: original.tracks.length,
    rotationTrackCount: 52, outputDuration: serialized.duration,
    tracks: original.tracks.map((track) => ({ name: track.name, keyCount: track.times.length, valueCount: track.values.length })),
  });
}

const motionText = `${JSON.stringify(motions, motionReplacer)}\n`;
const serializedMotions = JSON.parse(motionText);
assert.deepEqual(serializedMotions.bones, JSON.parse(JSON.stringify(motions.bones, motionReplacer)));
mkdirSync(abs(OUTPUT_DIR), { recursive: true });
writeFileSync(abs(MOTIONS_PATH), motionText);

const restrictions = 'User attachment origin, authorship and third-party redistribution/commercial rights are unverified. No mesh is present. Local demo preprocessing only; not a commercial-license certification or clearance for external release. Mixamorig/mixamo.com names are technical metadata, not proof of source or license.';
const report = {
  schemaVersion: 1, acquiredDate: DATE,
  tool: {
    script: 'scripts/prepare-fight-assets.mjs', scriptSha256: hash(readFileSync(SCRIPT)),
    nodeVersion: process.version, threeRevision: REVISION,
    fbxLoaderSha256: hash(readFileSync(fileURLToPath(import.meta.resolve('three/addons/loaders/FBXLoader.js')))),
  },
  sourceProvenance: { description: 'User-supplied FBX attachments retained locally; original third-party source URL and author not verified.', restrictions },
  processing,
  restPose: { sourcePath: `${SOURCE_DIR}/${SOURCE_FILES.idle}`, boneCount: motions.bones.length, hips: serializedMotions.bones.find((bone) => bone.name === 'mixamorigHips') },
  sources,
  output: { ...fileRecord(MOTIONS_PATH), url: '/assets/fight/motions.json', schemaVersion: 1, unitScale: 0.01, clipKeys: Object.keys(motions.clips) },
  character: {
    url: '/assets/fight/character/indian_man_in_suit.glb',
    suppliedSource: characterRecord,
    output: characterOutput,
    provenance: fileRecord(CHARACTER_PROVENANCE),
    embeddedMetadata: embedded,
    licenseNote: 'Declared CC BY 4.0 in the embedded glTF metadata; attribution is recorded but the declaration is not independently verified.',
    normalization: 'Runtime scale to 1.8 m and joint-name adaptation in src/fight/characterModel.ts. No mesh conversion, no skin or animation retargeting, embedded animation unused.',
  },
  cat: {
    url: '/assets/fight/cat/oiiaioooooiai_cat.glb',
    suppliedSource: catRecord,
    output: catOutput,
    provenance: fileRecord(CAT_PROVENANCE),
    embeddedMetadata: catEmbedded,
    licenseNote: 'Declared CC BY 4.0 in the embedded glTF metadata; attribution is recorded but the declaration is not independently verified.',
    normalization: 'Runtime centers and scales a clone to a ~0.9 m spinning projectile; embedded animation is not played.',
  },
  executive: {
    url: '/assets/fight/character/executive_in_a_navy_suit.glb',
    suppliedSource: executiveRecord,
    output: executiveOutput,
    provenance: fileRecord(EXECUTIVE_PROVENANCE),
    embeddedMetadata: executiveEmbedded,
    licenseNote: 'Declared CC BY 4.0 in the embedded glTF metadata; attribution is recorded but the declaration is not independently verified.',
    normalization: 'Static GLB (skins=0). Runtime auto-rig in src/fight/characterModel.ts binds meshes to a posed Indian skeleton clone; height normalized to 1.8 m.',
  },
  audio: Object.fromEntries(Object.entries(audioOutputs).map(([key, value]) => [key, {
    url: AUDIO_SOURCES[key].output.replace(/^public\//, '/'),
    suppliedSource: value.source,
    origin: value.origin,
    output: value.output,
    licenseNote: 'User-supplied attachment; authorship and third-party redistribution/commercial rights unverified. Local demo only.',
  }])),
  validation: { boneCount: 65, clipCount: 14, tracksPerClip: 53, rotationTracksPerClip: 52, noMeshesInSources: true, allSamplesCompared: true, serializedClipsParseAndValidate: true, staticPoseNotFrameZero: true, characterCopyByteIdentical: true, characterBones: 74, characterMeshes: 11, characterHeightMeters: 1.8, catCopyByteIdentical: true, catMeshes: 1, catAnimations: 1, executiveCopyByteIdentical: true, executiveSkins: 0, audioCopiesByteIdentical: true },
};
writeFileSync(abs(REPORT_PATH), pretty(report));

const records = [
  ...sources.map((source) => ({ path: source.sourcePath, bytes: source.bytes, sha256: source.sha256, roles: ['supplied-source'], operation: 'Existing user attachment retained unchanged; animation and bones only, no mesh; third-party rights unverified.' })),
  { ...fileRecord(MOTIONS_PATH), roles: ['runtime-output', 'local-demo-only'], operation: 'FBXLoader static Idle T-pose and 14 complete clips; Hips X/Z zeroed, Y centimeters and all rotations retained; six-decimal JSON, no downsampling.' },
  { ...characterRecord, roles: ['supplied-source'], operation: `User-supplied character GLB retained byte-for-byte. Embedded metadata declares ${embedded.license}; attribution: ${embedded.author}.` },
  { ...fileRecord(CHARACTER_PROVENANCE), roles: ['license-evidence', 'provenance'], operation: 'Embedded GLB metadata transcribed for attribution; declaration not independently verified.' },
  { ...characterOutput, roles: ['runtime-output'], operation: `Copied byte-for-byte from ${CHARACTER_SOURCE}; loaded by FightView.` },
  { ...catRecord, roles: ['supplied-source'], operation: `User-supplied cat GLB retained byte-for-byte. Embedded metadata declares ${catEmbedded.license}; attribution: ${catEmbedded.author}.` },
  { ...fileRecord(CAT_PROVENANCE), roles: ['license-evidence', 'provenance'], operation: 'Embedded GLB metadata transcribed for attribution; declaration not independently verified.' },
  { ...catOutput, roles: ['runtime-output'], operation: `Copied byte-for-byte from ${CAT_SOURCE}; loaded as the spinning projectile visual.` },
  { ...executiveRecord, roles: ['supplied-source'], operation: `User-supplied static character GLB retained byte-for-byte. Embedded metadata declares ${executiveEmbedded.license}; attribution: ${executiveEmbedded.author}.` },
  { ...fileRecord(EXECUTIVE_PROVENANCE), roles: ['license-evidence', 'provenance'], operation: 'Embedded GLB metadata transcribed for attribution; declaration not independently verified.' },
  { ...executiveOutput, roles: ['runtime-output'], operation: `Copied byte-for-byte from ${EXECUTIVE_SOURCE}; runtime auto-rig binds it to the Indian skeleton.` },
  ...Object.entries(AUDIO_SOURCES).flatMap(([key, spec]) => [
    { ...audioOutputs[key].origin, roles: ['supplied-source'], operation: `User-supplied fight audio (${key}) retained locally; third-party rights unverified.` },
    { ...audioOutputs[key].output, roles: ['runtime-output', 'local-demo-only'], operation: key === 'laowu-cat' ? 'First 2 seconds of the cat scream trimmed with ffmpeg 7.1 (libmp3lame -q:a 2 -t 2); played on the cat skill.' : `Copied byte-for-byte from ${spec.source}; fight ${key === 'fight-bgm' ? 'background music' : 'impact sound'}.` },
  ]),
  { ...fileRecord(REPORT_PATH), roles: ['conversion-report'], operation: 'Locally measured source durations, track/key counts, SHA-256 hashes, output methods, tool versions and validation.' },
];
const motionAsset = {
  id: 'fight-user-great-sword-motions', name: 'User-supplied Great Sword and Bow skeleton-only FBXs and preprocessed fight motions',
  author: 'Unknown; attachment author and third-party origin not verified',
  sourceUrl: pathToFileURL(abs(SOURCE_DIR) + sep).href,
  acquiredDate: DATE, license: 'User attachments; no verified third-party license evidence supplied', licenseUrl: null,
  usage: 'Local demo only: 14 animation-only sources and skeleton/clip JSON. No mesh supplied, generated or implied.',
  restrictions, status: 'available', releaseClearance: 'Not cleared for external distribution or commercial release',
  licenseEvidence: [], documentationPaths: [REPORT_PATH],
  originalPaths: sources.map((source) => source.sourcePath), outputPaths: [MOTIONS_PATH],
  clipMapping: SOURCE_FILES, processing,
};
const characterAsset = {
  id: 'fight-user-indian-man-in-suit', name: 'User-supplied Indian Man in Suit rigged character (self-contained GLB)',
  author: embedded.author, sourceUrl: embedded.source,
  acquiredDate: DATE, license: 'CC BY 4.0 per embedded glTF metadata (not independently verified)',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  usage: 'Fight mode character only; loaded locally; embedded animation unused.',
  restrictions: 'User-supplied attachment. Embedded metadata declares CC BY 4.0 attribution; this is not an independent rights check or commercial clearance. Preserve attribution if the declared license applies. The separately supplied FBX motions remain unverified.',
  status: 'available', releaseClearance: 'Attribution required per declared CC BY 4.0; external distribution not independently cleared',
  licenseEvidence: [CHARACTER_PROVENANCE], documentationPaths: [REPORT_PATH],
  originalPaths: [CHARACTER_SOURCE, CHARACTER_PROVENANCE], outputPaths: [CHARACTER_OUTPUT],
  embeddedMetadata: embedded,
  normalization: 'Runtime uniform scale to 1.8 m and joint-name adaptation; no mesh conversion or animation retargeting.',
};
const catAsset = {
  id: 'fight-user-oiiaioooooiai-cat', name: 'User-supplied Oiiaioooooiai Cat GLB (spinning skill projectile)',
  author: catEmbedded.author, sourceUrl: catEmbedded.source,
  acquiredDate: DATE, license: 'CC BY 4.0 per embedded glTF metadata (not independently verified)',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  usage: 'Fight skill projectile visual only; loaded locally; embedded animation unused.',
  restrictions: 'User-supplied attachment. Embedded metadata declares CC BY 4.0 attribution; this is not an independent rights check or commercial clearance. Preserve attribution if the declared license applies. The separately supplied FBX motions remain unverified.',
  status: 'available', releaseClearance: 'Attribution required per declared CC BY 4.0; external distribution not independently cleared',
  licenseEvidence: [CAT_PROVENANCE], documentationPaths: [REPORT_PATH],
  originalPaths: [CAT_SOURCE, CAT_PROVENANCE], outputPaths: [CAT_OUTPUT],
  embeddedMetadata: catEmbedded,
  normalization: 'Runtime centers and scales a clone to a ~0.9 m spinning projectile; no mesh conversion or animation retargeting.',
};
const executiveAsset = {
  id: 'fight-user-executive-in-a-navy-suit', name: 'User-supplied Executive In A Navy Suit static character (self-contained GLB)',
  author: executiveEmbedded.author, sourceUrl: executiveEmbedded.source,
  acquiredDate: DATE, license: 'CC BY 4.0 per embedded glTF metadata (not independently verified)',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  usage: 'Fight mode second character; loaded locally and auto-rigged onto the Indian skeleton at runtime.',
  restrictions: 'User-supplied attachment. Embedded metadata declares CC BY 4.0 attribution; this is not an independent rights check or commercial clearance. Preserve attribution if the declared license applies. The model ships without a skeleton; runtime auto-rigging is a local demo technique, not a source edit.',
  status: 'available', releaseClearance: 'Attribution required per declared CC BY 4.0; external distribution not independently cleared',
  licenseEvidence: [EXECUTIVE_PROVENANCE], documentationPaths: [REPORT_PATH],
  originalPaths: [EXECUTIVE_SOURCE, EXECUTIVE_PROVENANCE], outputPaths: [EXECUTIVE_OUTPUT],
  embeddedMetadata: executiveEmbedded,
  normalization: 'Static GLB; runtime auto-rig binds meshes to a posed Indian skeleton clone and normalizes height to 1.8 m.',
};
const audioAsset = {
  id: 'fight-user-audio', name: 'User-supplied fight audio (cat scream, battle BGM, two impact punches)',
  author: 'Unknown; attachment author and third-party origin not verified',
  sourceUrl: pathToFileURL(abs(`${SOURCE_DIR}/audio`) + sep).href,
  acquiredDate: DATE, license: 'User attachments; no verified third-party license evidence supplied', licenseUrl: null,
  usage: 'Local fight demo only: cat skill scream (first 2 s), independent fight background music, and two melee impact samples.',
  restrictions: 'User attachment origin, authorship and third-party redistribution/commercial rights are unverified. Local demo only; not a commercial-license certification or clearance for external release.',
  status: 'available', releaseClearance: 'Not cleared for external distribution or commercial release',
  licenseEvidence: [], documentationPaths: [REPORT_PATH],
  originalPaths: Object.values(AUDIO_SOURCES).map((spec) => spec.origin),
  outputPaths: Object.values(AUDIO_SOURCES).map((spec) => spec.output),
  processing: { trim: 'laowu-cat.mp3 = first 2 seconds of laowu-cat-source.mp3 via imageio_ffmpeg ffmpeg 7.1: -t 2 -c:a libmp3lame -q:a 2. Other tracks are byte-for-byte copies.' },
};
const assetIds = new Set([motionAsset.id, characterAsset.id, catAsset.id, executiveAsset.id, audioAsset.id, ...OLD_CHARACTER_ASSET_IDS]);
manifest.assets = [...manifest.assets.filter((asset) => !assetIds.has(asset.id)), motionAsset, characterAsset, catAsset, executiveAsset, audioAsset];
const recordPaths = new Set([...records.map((record) => record.path), ...OLD_CHARACTER_OUTPUTS]);
manifest.files = [...manifest.files.filter((record) => !recordPaths.has(record.path)), ...records];
manifest.lastAcquiredDate = DATE;
for (const record of records) assert.deepEqual(fileRecord(record.path), { path: record.path, bytes: record.bytes, sha256: record.sha256 });
for (const path of MANIFEST_PATHS) writeFileSync(abs(path), pretty(manifest));

const begin = 'BEGIN FIGHT ASSET PREPROCESSING NOTICE (2026-11-23)';
const end = 'END FIGHT ASSET PREPROCESSING NOTICE (2026-11-23)';
const notice = [
  begin, 'Fight assets: local-only preprocessing', '-------------------------------------',
  `Acquired/registered: ${DATE}. Workflow: scripts/prepare-fight-assets.mjs.`,
  '14 FBXs supplied as user attachments under assets/source/fight/.',
  restrictions,
  'Each FBX has 65 bones, 53 tracks (52 rotation tracks), and no mesh.',
  'Output: public/assets/fight/motions.json; schemaVersion=1, unitScale=0.01.',
  processing.skeleton, processing.coordinates, processing.rootMotion.method,
  processing.rootMotion.rotations, processing.time,
  `Character: user-supplied Indian Man in Suit GLB (${CHARACTER_SOURCE}).`,
  `Embedded metadata: title "${embedded.title}", author ${embedded.author}, license ${embedded.license}, source ${embedded.source}.`,
  'The license declaration is transcribed from embedded metadata; it is not independently verified.',
  'Attribution is preserved. Local demo only; not a commercial-license clearance.',
  'Runtime normalizes height to 1.8 m and adapts joint names; no mesh conversion, no animation retargeting, embedded animation unused.',
  `Cat: user-supplied Oiiaioooooiai Cat GLB (${CAT_SOURCE}).`,
  `Embedded metadata: title "${catEmbedded.title}", author ${catEmbedded.author}, license ${catEmbedded.license}, source ${catEmbedded.source}.`,
  'The cat license declaration is transcribed from embedded metadata; it is not independently verified.',
  'Attribution is preserved. Runtime centers and scales a clone to a spinning projectile; embedded animation unused.',
  `Second character: user-supplied Executive In A Navy Suit GLB (${EXECUTIVE_SOURCE}), static (skins=0).`,
  `Embedded metadata: title "${executiveEmbedded.title}", author ${executiveEmbedded.author}, license ${executiveEmbedded.license}, source ${executiveEmbedded.source}.`,
  'The executive license declaration is transcribed from embedded metadata; it is not independently verified.',
  'Runtime auto-rigging binds its meshes to a posed clone of the Indian skeleton; no source mesh edit.',
  'Fight audio: user-supplied cat scream (first 2 s trimmed with ffmpeg 7.1), battle BGM and two impact punches.',
  'Audio authorship and third-party redistribution/commercial rights are unverified; local demo only.',
  'No GLB conversion, retargeting, source edits, downloads or uploads performed.',
  'Report: assets/source/fight/conversion-report.json; source measurements and processing evidence.',
  'All files below are registered in both synchronized asset-manifest.json files.',
  ...records.flatMap((record) => [`- ${record.path}`, `  Bytes: ${record.bytes}; SHA-256: ${record.sha256}`]),
  end,
].join('\n');
const start = originalNotice.indexOf(begin);
let nextNotice;
if (start === -1) {
  nextNotice = `${originalNotice}${originalNotice.endsWith('\n') ? '\n' : '\n\n'}${notice}\n`;
} else {
  const finish = originalNotice.indexOf(end, start);
  assert(finish !== -1, 'Existing fight NOTICE block has no closing marker');
  nextNotice = originalNotice.slice(0, start) + notice + originalNotice.slice(finish + end.length);
}
writeFileSync(abs('NOTICE'), nextNotice);
for (const path of OLD_CHARACTER_OUTPUTS) if (existsSync(abs(path))) rmSync(abs(path));
assert.equal(readFileSync(abs(MANIFEST_PATHS[0]), 'utf8'), readFileSync(abs(MANIFEST_PATHS[1]), 'utf8'));
console.log(pretty({
  motionsUrl: report.output.url, characterUrl: report.character.url, catUrl: report.cat.url,
  executiveUrl: report.executive.url, audioUrls: Object.values(report.audio).map((entry) => entry.url),
  boneCount: 65, clipCount: sources.length, tracksPerClip: 53, rotationTracksPerClip: 52,
  motionsBytes: report.output.bytes, characterBytes: characterOutput.bytes, catBytes: catOutput.bytes,
  executiveBytes: executiveOutput.bytes,
  characterLicense: embedded.license, catLicense: catEmbedded.license, executiveLicense: executiveEmbedded.license,
  registeredFiles: records.length,
  report: REPORT_PATH, sourceRights: 'Character/cat/executive licenses declared in embedded metadata; motions and audio unverified; local demo only',
}));
