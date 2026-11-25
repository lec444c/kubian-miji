// Dev-time optimisation of the supplied CC-BY pool table GLB: drop the baked-in
// balls (the Demo keeps its own physics-driven balls) and the duplicate cue,
// then downscale textures so the local preview loads fast. Never runs in browser.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, textureCompress, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read('D:/智器云杯/pool_table_traditional.glb');

const drop = [];
for (const node of document.getRoot().listNodes()) {
  const name = node.getName() ?? '';
  if (/^billiard_ball/.test(name) || name === 'pool_cue001') drop.push(node);
}
for (const node of drop) {
  for (const child of [...node.listChildren()]) child.dispose();
  node.dispose();
}

await document.transform(
  dedup(),
  prune({ keepAttributes: false, keepLeaves: false }),
  textureCompress({ encoder: sharp, resize: [1024, 1024], filter: 'lanczos3' }),
);

await io.write('public/assets/models/pool-table-traditional.glb', document);
console.log('optimised table written');