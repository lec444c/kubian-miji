import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** 在 node 里解析真实 GLB：剥离贴图引用，避免加载图片/DRACO 等运行时资源。 */
export function parseWithoutTextures(path = 'public/assets/models/pool-table-traditional.glb'): Promise<THREE.Group> {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  delete json.extensionsUsed; delete json.extensionsRequired;
  for (const material of json.materials ?? []) {
    delete material.extensions;
    const pbr = material.pbrMetallicRoughness ?? {};
    delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture;
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  const jsonText = JSON.stringify(json);
  const pad = (4 - (jsonText.length % 4)) % 4;
  const jsonChunk = Buffer.from(jsonText + ' '.repeat(pad), 'utf8');
  const bin = buf.subarray(20 + jsonLen + 8);
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  const binHeader = 20 + jsonChunk.length;
  out.writeUInt32LE(bin.length, binHeader); out.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(out, binHeader + 8);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(out.buffer.slice(out.byteOffset, out.byteOffset + out.length), '', gltf => resolve(gltf.scene), reject);
  });
}
