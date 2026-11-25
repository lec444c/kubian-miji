import * as THREE from 'three';

/**
 * Visual adaptation of tailuge/billiards dist/models/p8.gltf (GPL-3.0).
 * The source model is Z-up; the Demo's renderer and physics are Y-up.
 */
export const REFERENCE_CLOTH_WIDTH = 46;
export const REFERENCE_CLOTH_DEPTH = 24;

export interface TableFit {
  clothTopY: number;
  clothWidth: number;
  clothDepth: number;
}

/** Fit the cloth itself, never the rails or the whole model's highest point. */
export function installReferenceTable(
  model: THREE.Group,
  bedY: number,
  tableHalfX: number,
  tableHalfY: number,
): TableFit {
  const cloth = model.getObjectByName('FullCloth');
  if (!cloth) throw new Error('Reference table is missing its FullCloth mesh');

  model.rotation.x = -Math.PI / 2;
  model.scale.set(
    tableHalfX * 2 / REFERENCE_CLOTH_WIDTH,
    tableHalfY * 2 / REFERENCE_CLOTH_DEPTH,
    tableHalfX * 2 / REFERENCE_CLOTH_WIDTH,
  );
  model.updateMatrixWorld(true);

  const initialCloth = new THREE.Box3().setFromObject(cloth);
  const center = initialCloth.getCenter(new THREE.Vector3());
  model.position.set(-center.x, bedY - initialCloth.max.y, -center.z);
  model.updateMatrixWorld(true);

  const importedLights: THREE.Object3D[] = [];
  model.traverse(object => {
    if (object instanceof THREE.Light) importedLights.push(object);
    if (!(object instanceof THREE.Mesh)) return;
    const materials = (Array.isArray(object.material) ? object.material : [object.material]).map(source => {
      const material = source.clone();
      const name = material.name.toLowerCase();
      if (material instanceof THREE.MeshStandardMaterial) {
        material.metalness = name.includes('metal') || name.includes('diamond') ? material.metalness : 0;
        material.envMapIntensity = 0.35;
        if (name === 'cloth') {
          material.color.setHex(0x176149);
          material.roughness = 0.91;
          object.receiveShadow = false;
        } else if (name === 'clothshade') {
          material.color.setHex(0x0c382b);
          material.roughness = 0.94;
          object.receiveShadow = false;
        } else if (name.includes('cushion')) {
          material.color.setHex(0x185a45);
          material.roughness = 0.82;
        } else if (name.includes('wood')) {
          material.color.setHex(0x4a2d1c);
          material.roughness = 0.5;
        }
      }
      return material;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0]!;
    object.castShadow = !/cloth/i.test(object.name);
  });
  importedLights.forEach(light => light.removeFromParent());

  const alignedCloth = new THREE.Box3().setFromObject(cloth);
  const size = alignedCloth.getSize(new THREE.Vector3());
  const fit = { clothTopY: alignedCloth.max.y, clothWidth: size.x, clothDepth: size.z };
  model.userData.tableFit = fit;
  return fit;
}
