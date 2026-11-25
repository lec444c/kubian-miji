import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FIGHTER_HEIGHT, normalizeFightCharacter } from '../../src/fight/characterModel';

const SUPPLIED_BONES = [
  'Hips_01', 'Spine_02', 'Spine1_03', 'Spine2_04', 'Neck_05', 'Neck1_06', 'Head_08',
  'LeftShoulder_012', 'LeftArm_013', 'LeftForeArm_014', 'LeftForeArm1_015', 'LeftHand_017',
  'LeftHandThumb1_018', 'LeftHandThumb4_021', 'LeftHandIndex3_024', 'LeftHandMiddle1_00',
  'RightShoulder_038', 'RightArm_039', 'RightForeArm_040', 'RightHand_043',
  'RightHandThumb1_044', 'RightHandThumb4_047', 'RightHandIndex3_050', 'RightHandMiddle4_054',
  'LeftUpLeg_063', 'LeftLeg_064', 'LeftFoot_065', 'LeftToeBase_066', 'LeftToe_End_067',
  'RightUpLeg_068', 'RightLeg_069', 'RightFoot_070', 'RightToeBase_071', 'RightToe_End_072',
];

function synthetic(): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.3, 0.5), new THREE.MeshBasicMaterial());
  body.position.y = 1.65;
  root.add(body);
  for (const name of SUPPLIED_BONES) {
    const bone = new THREE.Bone(); bone.name = name; root.add(bone);
  }
  return root;
}

describe('normalizeFightCharacter / supplied GLB adaptation', () => {
  it('normalizes the centimetre root scale, renames the rig contract and stays idempotent', () => {
    const root = synthetic();
    normalizeFightCharacter(root);
    expect(root.scale.x).toBeCloseTo(FIGHTER_HEIGHT / 3.3, 7);
    expect(root.getObjectByName('pelvis')).toBeInstanceOf(THREE.Bone);
    expect(root.getObjectByName('thumb_04_leaf_l')).toBeInstanceOf(THREE.Bone);
    expect(root.getObjectByName('middle_04_leaf_r')).toBeInstanceOf(THREE.Bone);
    expect(root.getObjectByName('ball_leaf_l')).toBeInstanceOf(THREE.Bone);
    // Extra twist/neck/eye bones are not part of FighterRig's contract and stay named.
    expect(root.getObjectByName('LeftForeArm1_015')).toBeInstanceOf(THREE.Bone);
    expect(root.getObjectByName('Neck1_06')).toBeInstanceOf(THREE.Bone);
    normalizeFightCharacter(root);
    expect(root.scale.x).toBeCloseTo(FIGHTER_HEIGHT / 3.3, 7);
    expect(root.getObjectByName('Hips_01')).toBeUndefined();
  });

  it('rejects a hierarchy that lacks required rig bones', () => {
    const root = synthetic();
    root.getObjectByName('LeftHand_017')!.name = 'LeftHand_999';
    expect(() => normalizeFightCharacter(root)).toThrow(/missing bones/);
  });
});
