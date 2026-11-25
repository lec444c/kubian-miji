import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'assets/asset-manifest.json');
const errors = [];
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const runtimeManifestPath = resolve(root, 'public/assets/asset-manifest.json');
if (!existsSync(runtimeManifestPath) || readFileSync(runtimeManifestPath, 'utf8') !== readFileSync(manifestPath, 'utf8')) {
  errors.push('Runtime asset manifest is missing or differs from assets/asset-manifest.json');
}
const fileRecords = new Map();

function fail(message) {
  errors.push(message);
}

function safePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\')) {
    fail(`Invalid manifest path: ${relativePath}`);
    return null;
  }
  const absolute = resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    fail(`Path escapes project root: ${relativePath}`);
    return null;
  }
  if (!/^(assets\/source\/|public\/assets\/)/.test(relativePath)) {
    fail(`Path is outside approved asset directories: ${relativePath}`);
  }
  return absolute;
}

for (const file of manifest.files ?? []) {
  if (fileRecords.has(file.path)) {
    fail(`Duplicate file record: ${file.path}`);
    continue;
  }
  fileRecords.set(file.path, file);
  const absolute = safePath(file.path);
  if (!absolute) continue;
  if (!existsSync(absolute)) {
    fail(`Missing file: ${file.path}`);
    continue;
  }
  if (!/^[a-f0-9]{64}$/.test(file.sha256 ?? '')) {
    fail(`Invalid SHA256 for ${file.path}`);
    continue;
  }
  const bytes = readFileSync(absolute);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== file.sha256) {
    fail(`SHA256 mismatch for ${file.path}: expected ${file.sha256}, got ${actualHash}`);
  }
  if (bytes.length !== file.bytes) {
    fail(`Byte count mismatch for ${file.path}: expected ${file.bytes}, got ${bytes.length}`);
  }
}

for (const asset of manifest.assets ?? []) {
  for (const field of ['name', 'author', 'sourceUrl', 'acquiredDate', 'license', 'usage', 'restrictions', 'status']) {
    if (!asset[field]) fail(`${asset.id ?? asset.name}: missing ${field}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asset.acquiredDate ?? '')) {
    fail(`${asset.id}: acquiredDate is not an ISO date`);
  } else if (asset.acquiredDate < manifest.acquiredDate || asset.acquiredDate > (manifest.lastAcquiredDate ?? manifest.acquiredDate)) {
    fail(`${asset.id}: acquisition date ${asset.acquiredDate} outside manifest batch window ${manifest.acquiredDate}..${manifest.lastAcquiredDate ?? manifest.acquiredDate}`);
  }
  for (const path of [...(asset.licenseEvidence ?? []), ...(asset.documentationPaths ?? []), ...(asset.originalPaths ?? []), ...(asset.outputPaths ?? [])]) {
    if (!fileRecords.has(path)) fail(`${asset.id}: referenced path has no file record: ${path}`);
  }
  if (asset.status === 'unavailable') {
    if (!asset.reason) fail(`${asset.id}: unavailable asset needs a reason`);
    if ((asset.outputPaths ?? []).length) fail(`${asset.id}: unavailable asset unexpectedly declares outputs`);
  } else if (asset.status === 'available') {
    if (!(asset.outputPaths ?? []).length) fail(`${asset.id}: available asset has no outputs`);
  } else {
    fail(`${asset.id}: unsupported status ${asset.status}`);
  }

  if (asset.clipValidation) {
    const check = asset.clipValidation;
    const absolute = safePath(check.path);
    if (absolute && existsSync(absolute)) {
      const glb = readFileSync(absolute);
      if (glb.length < 20 || glb.toString('ascii', 0, 4) !== 'glTF' || glb.readUInt32LE(4) !== 2) {
        fail(`${asset.id}: not a glTF 2.0 GLB: ${check.path}`);
      } else {
        const jsonLength = glb.readUInt32LE(12);
        const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
        const clips = (json.animations ?? []).map((animation) => animation.name);
        for (const required of check.requiredClips ?? []) {
          if (!clips.includes(required)) fail(`${asset.id}: missing animation clip ${required}`);
        }
        if (check.expectedClipCount !== clips.length) {
          fail(`${asset.id}: expected ${check.expectedClipCount} clips, found ${clips.length}`);
        }
        if (JSON.stringify(check.availableClips) !== JSON.stringify(clips)) {
          fail(`${asset.id}: availableClips does not match GLB animation order/content`);
        }
      }
    }
  }
}

for (const file of manifest.files ?? []) {
  if (!file.path.endsWith('.obj') || !file.path.startsWith('public/assets/')) continue;
  const absolute = resolve(root, file.path);
  if (!existsSync(absolute)) continue;
  const obj = readFileSync(absolute, 'utf8');
  const libraries = [...obj.matchAll(/^mtllib\s+(.+)$/gm)].map((match) => match[1].trim());
  if (!libraries.length) fail(`${file.path}: OBJ has no mtllib reference`);
  for (const library of libraries) {
    const materialPath = resolve(dirname(absolute), library);
    if (!existsSync(materialPath)) {
      fail(`${file.path}: missing MTL ${library}`);
      continue;
    }
    const material = readFileSync(materialPath, 'utf8');
    const textureMaps = [...material.matchAll(/^(?:map_[A-Za-z0-9_]+|bump|disp|decal)\s+(?:-\S+\s+\S+\s+)*(.+)$/gm)];
    for (const match of textureMaps) {
      const texturePath = resolve(dirname(materialPath), match[1].trim());
      if (!existsSync(texturePath)) fail(`${file.path}: missing texture referenced by ${library}: ${match[1].trim()}`);
    }
  }
}

function verifyGltfReferences(relativePath, absolutePath, gltf) {
  for (const section of ['buffers', 'images']) {
    for (const resource of gltf[section] ?? []) {
      const uri = resource.uri;
      if (!uri || uri.startsWith('data:')) continue;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(uri)) {
        fail(`${relativePath}: external or non-embedded ${section} URI: ${uri}`);
        continue;
      }
      let decoded;
      try {
        decoded = decodeURIComponent(uri.split(/[?#]/, 1)[0]);
      } catch {
        fail(`${relativePath}: invalid encoded ${section} URI: ${uri}`);
        continue;
      }
      const dependency = resolve(dirname(absolutePath), decoded);
      const assetRoot = resolve(root, 'public/assets');
      if (dependency !== assetRoot && !dependency.startsWith(assetRoot + sep)) {
        fail(`${relativePath}: dependency escapes public/assets: ${uri}`);
      } else if (!existsSync(dependency)) {
        fail(`${relativePath}: missing ${section} dependency: ${uri}`);
      }
    }
  }
}

for (const file of manifest.files ?? []) {
  if (!file.path.startsWith('public/assets/') || !/\.(?:gltf|glb)$/i.test(file.path)) continue;
  const absolute = resolve(root, file.path);
  if (!existsSync(absolute)) continue;
  try {
    if (file.path.toLowerCase().endsWith('.gltf')) {
      verifyGltfReferences(file.path, absolute, JSON.parse(readFileSync(absolute, 'utf8')));
    } else {
      const glb = readFileSync(absolute);
      if (glb.length < 20 || glb.toString('ascii', 0, 4) !== 'glTF' || glb.readUInt32LE(4) !== 2) {
        fail(`${file.path}: not a glTF 2.0 GLB`);
        continue;
      }
      const jsonLength = glb.readUInt32LE(12);
      verifyGltfReferences(file.path, absolute, JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')));
    }
  } catch (error) {
    fail(`${file.path}: unable to parse glTF/GLB: ${error.message}`);
  }
}

for (const asset of manifest.assets ?? []) {
  console.log(`${asset.status.toUpperCase()} ${asset.id}: ${(asset.outputPaths ?? []).length} runtime files`);
}
if (errors.length) {
  console.error(`\nAsset verification failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const bytes = [...fileRecords.values()].reduce((sum, file) => sum + file.bytes, 0);
  console.log(`\nVerified ${fileRecords.size} unique files (${bytes} bytes), all SHA256 hashes, OBJ/MTL references, local glTF/GLB dependencies, and declared GLB clips.`);
}
