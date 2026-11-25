import * as THREE from 'three';

/** Fight actors stand 1.8 m tall before the tabletop scene applies its miniature scale. */
export const FIGHTER_HEIGHT = 1.8;

const FIXED_NAMES: Record<string, string> = {
  Hips_01: 'pelvis',
  Spine_02: 'spine_01',
  Spine1_03: 'spine_02',
  Spine2_04: 'spine_03',
  Neck_05: 'neck_01',
  Head_08: 'Head',
  LeftShoulder_012: 'clavicle_l',
  LeftArm_013: 'upperarm_l',
  LeftForeArm_014: 'lowerarm_l',
  LeftHand_017: 'hand_l',
  RightShoulder_038: 'clavicle_r',
  RightArm_039: 'upperarm_r',
  RightForeArm_040: 'lowerarm_r',
  RightHand_043: 'hand_r',
  LeftUpLeg_063: 'thigh_l',
  LeftLeg_064: 'calf_l',
  LeftFoot_065: 'foot_l',
  LeftToeBase_066: 'ball_l',
  LeftToe_End_067: 'ball_leaf_l',
  RightUpLeg_068: 'thigh_r',
  RightLeg_069: 'calf_r',
  RightFoot_070: 'foot_r',
  RightToeBase_071: 'ball_r',
  RightToe_End_072: 'ball_leaf_r',
};

const REQUIRED = [
  'pelvis', 'spine_03', 'neck_01', 'Head',
  'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'foot_l', 'foot_r', 'thumb_04_leaf_l', 'index_03_l', 'thumb_04_leaf_r', 'index_03_r',
];

function fingerName(name: string): string | undefined {
  const match = /^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)([1-4])_\d+$/.exec(name);
  if (!match) return undefined;
  const side = match[1] === 'Left' ? 'l' : 'r';
  const segment = match[3]!;
  return `${match[2]!.toLowerCase()}_0${segment}${segment === '4' ? '_leaf' : ''}_${side}`;
}

/**
 * Adapts the supplied Sketchfab character to FighterRig's bone contract.
 * The GLB carries a 1.83× centimetre-conversion root scale and Mixamo-style
 * suffixed joint names; scale the whole hierarchy once and rename only the
 * bones FighterRig consumes. Extra neck/twist/eye bones and all skin bind
 * matrices remain untouched. Safe to call again after the first adaptation.
 */
export function normalizeFightCharacter(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const height = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  if (!(height > 0.5 && height < 20)) throw new Error(`Fight character height is implausible: ${height}`);
  root.scale.multiplyScalar(FIGHTER_HEIGHT / height);

  const renamed = new Set<string>();
  root.traverse(object => {
    if (!(object instanceof THREE.Bone)) return;
    const name = fingerName(object.name) ?? FIXED_NAMES[object.name];
    if (!name) return;
    if (renamed.has(name)) throw new Error(`Duplicate fight bone after normalization: ${name}`);
    renamed.add(name);
    object.name = name;
  });

  const present = new Set<string>();
  root.traverse(object => { if (object instanceof THREE.Bone) present.add(object.name); });
  const missing = REQUIRED.filter(name => !present.has(name));
  if (missing.length) throw new Error(`Fight character is missing bones: ${missing.join(', ')}`);
  root.updateMatrixWorld(true);
}
