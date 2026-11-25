import * as THREE from 'three';

export const TABLE_BED_Y = 0.79;
// The whole table assembly (cloth, balls, cue, aim line, hairdryer) is enlarged
// uniformly for display. Physics stays in unscaled metres inside this group;
// camera framing and screen<->table conversions account for the scale.
export const TABLE_WORLD_SCALE = 1.6;

/** Build the supplied two-mesh sitting-room GLB in Y-up metres, without a renderer.
 * Its authored transforms and baked textures are preserved; only the central
 * coffee table is culled and the ceiling is split for top-camera visibility.
 * Consumes source geometries/materials after baking. Shared map textures stay
 * alive and belong to the returned group (shell and ceiling share one map). */
export function createSittingRoom(model: THREE.Group): { group: THREE.Group; ceiling: THREE.Mesh } {
  model.updateMatrixWorld(true);
  const sources: THREE.Mesh[] = [];
  model.traverse(child => { const mesh = child as THREE.Mesh; if (mesh.isMesh) sources.push(mesh); });
  if (sources.length < 2) throw new Error('sitting room GLB has unexpected mesh layout');
  const baked = sources.map(mesh => {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const standard = mesh.material as THREE.MeshStandardMaterial;
    return { geometry, box: geometry.boundingBox!, map: standard.map ?? null };
  });
  // Source meshes are fully baked into clones; release them (their textures
  // stay alive through the shared map references on the new materials).
  for (const mesh of sources) {
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach(material => material?.dispose());
  }
  // Shell = the mesh reaching the ceiling; props = floor furniture.
  const shellIndex = baked[0]!.box.max.y > 3 ? 0 : 1;
  const splitTriangles = (geometry: THREE.BufferGeometry, inside: (x: number, y: number, z: number) => boolean) => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const nor = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const index = geometry.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    const keep: number[] = [], drop: number[] = [];
    for (let t = 0; t < triCount; t++) {
      const ids = [0, 1, 2].map(v => index ? index.getX(t * 3 + v) : t * 3 + v);
      const hit = ids.every(id => inside(pos.getX(id), pos.getY(id), pos.getZ(id)));
      (hit ? drop : keep).push(...ids);
    }
    const build = (ids: number[]): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      const p = new Float32Array(ids.length * 3);
      const n = nor ? new Float32Array(ids.length * 3) : null;
      const u = uv ? new Float32Array(ids.length * 2) : null;
      ids.forEach((id, k) => {
        p[k * 3] = pos.getX(id); p[k * 3 + 1] = pos.getY(id); p[k * 3 + 2] = pos.getZ(id);
        if (n && nor) { n[k * 3] = nor.getX(id); n[k * 3 + 1] = nor.getY(id); n[k * 3 + 2] = nor.getZ(id); }
        if (u && uv) { u[k * 2] = uv.getX(id); u[k * 2 + 1] = uv.getY(id); }
      });
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      if (n) g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
      if (u) g.setAttribute('uv', new THREE.BufferAttribute(u, 2));
      return g;
    };
    return { keep: build(keep), drop: build(drop) };
  };
  const group = new THREE.Group();
  group.name = 'sitting-room';
  const addMesh = (name: string, geometry: THREE.BufferGeometry, map: THREE.Texture | null): THREE.Mesh => {
    const material = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  const shell = baked[shellIndex]!;
  const props = baked[1 - shellIndex]!;
  const shellSplit = splitTriangles(shell.geometry, (_x, y) => y > 3.5);
  const propsSplit = splitTriangles(props.geometry, (x, y, z) => y > 0.15 && Math.abs(x) < 2.7 && z > -0.5 && z < 1.3);
  propsSplit.drop.dispose();
  shell.geometry.dispose();
  props.geometry.dispose();
  addMesh('room-props', propsSplit.keep, props.map);
  addMesh('room-shell', shellSplit.keep, shell.map);
  const ceiling = addMesh('room-ceiling', shellSplit.drop, shell.map);
  const shellBox = new THREE.Box3().setFromBufferAttribute(shellSplit.keep.getAttribute('position') as THREE.BufferAttribute);
  const center = shellBox.getCenter(new THREE.Vector3());
  group.position.set(-center.x, 0, -center.z);
  return { group, ceiling };
}
