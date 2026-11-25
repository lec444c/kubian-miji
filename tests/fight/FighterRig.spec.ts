import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { FighterRig, type MotionData } from '../../src/fight/FighterRig';
import { normalizeFightCharacter } from '../../src/fight/characterModel';
import { FIGHT_SURFACE_Y, FIGHT_WORLD_SCALE, TABLETOP_BOUNDS } from '../../src/fight/TabletopArena';

const project = fileURLToPath(new URL('../../', import.meta.url));
const attachments: Record<string, string> = {
  idle: '原地/Great Sword Idle.fbx', walk: 'Great Sword Walk.fbx', run: 'Great Sword Run.fbx',
  jump: 'Great Sword Jump.fbx', jumpBack: 'Great Sword Jump(1).fbx',
  turn: '转向/Great Sword Turn.fbx', turnAlt: '转向/Great Sword Turn(1).fbx',
  impact: '受击/Great Sword Impact.fbx', impactAlt: '受击/Great Sword Impact(1).fbx',
  slash: '攻击/Great Sword Slash.fbx', slashAlt: '攻击/Great Sword Slash(1).fbx',
  skillBall: '技能/Great Sword Slash.fbx', skillVolley: '技能/Standing Draw Arrow.fbx',
  death: 'Standing Death Left 01.fbx',
};
let data: MotionData;
let character: THREE.Group;
let sourceBind: THREE.Group;

function fbx(file: string): THREE.Group {
  const bytes = readFileSync(`${project}assets/source/fight/${file}`);
  return new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

/** Strip textures/animations from the supplied GLB in memory; no image decoder, DOM, fetch or network. */
async function fighterCharacter(): Promise<THREE.Group> {
  const bytes = readFileSync(`${project}public/assets/fight/character/indian_man_in_suit.glb`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  const binary = bytes.subarray(binHeader + 8, binHeader + 8 + bytes.readUInt32LE(binHeader));
  delete json.materials;
  delete json.images;
  delete json.textures;
  delete json.samplers;
  delete json.animations;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
  text.copy(padded);
  const bin = Buffer.alloc(Math.ceil(binary.length / 4) * 4);
  binary.copy(bin);
  const glb = Buffer.alloc(28 + padded.length + bin.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20);
  glb.writeUInt32LE(bin.length, 20 + padded.length); glb.writeUInt32LE(0x004e4942, 24 + padded.length);
  bin.copy(glb, 28 + padded.length);
  const scene = (await new GLTFLoader().parseAsync(glb.buffer, '')).scene;
  normalizeFightCharacter(scene);
  return scene;
}

function makeRig(motions = data) {
  const model = clone(character) as THREE.Group;
  // Test stand-in obeys createCueStick's input contract; production preserves the passed model.
  const cue = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.031, 0.031), new THREE.MeshBasicMaterial());
  shaft.position.x = -0.725;
  cue.add(shaft);
  const rig = new FighterRig(model, cue, motions, 0x29c6bb);
  return { rig, model, cue, shaft };
}
function bones(root: THREE.Object3D): THREE.Bone[] {
  const result: THREE.Bone[] = [];
  root.traverse(object => { if (object instanceof THREE.Bone) result.push(object); });
  return result;
}
function meshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const result: THREE.SkinnedMesh[] = [];
  root.traverse(object => { if (object instanceof THREE.SkinnedMesh) result.push(object); });
  return result;
}
function point(root: THREE.Object3D, name: string): THREE.Vector3 {
  return root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
}
function pose(root: THREE.Object3D): number[][] {
  return bones(root).map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]);
}
function expectPoseClose(a: number[][], b: number[][], digits = 5): void {
  a.forEach((row, i) => {
    row.slice(0, 3).forEach((value, j) => expect(value).toBeCloseTo(b[i]![j]!, digits));
    const qa = new THREE.Quaternion().fromArray(row, 3).normalize();
    const qb = new THREE.Quaternion().fromArray(b[i]!, 3).normalize();
    expect(qa.angleTo(qb)).toBeLessThan(10 ** -digits);
  });
}

beforeAll(async () => {
  sourceBind = fbx(attachments.idle!);
  sourceBind.updateMatrixWorld(true);
  const sourceBones = bones(sourceBind);
  data = {
    schemaVersion: 1, unitScale: 0.01,
    bones: sourceBones.map(bone => ({
      name: bone.name, parent: bone.parent instanceof THREE.Bone ? bone.parent.name : null,
      position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray(),
    })),
    clips: {},
  };
  for (const [name, file] of Object.entries(attachments)) {
    const input = name === 'idle' ? sourceBind : fbx(file);
    expect(meshes(input)).toHaveLength(0);
    const clip = input.animations[0]!.clone();
    for (const track of clip.tracks) {
      if (track.name.endsWith('Hips.position')) {
        for (let i = 0; i < track.values.length; i += 3) { track.values[i] = 0; track.values[i + 2] = 0; }
      }
    }
    data.clips[name] = THREE.AnimationClip.toJSON(clip);
  }
  character = await fighterCharacter();
}, 20000);

describe('FighterRig / real Mixamo FBX to supplied Indian Man in Suit skin', () => {
  it('微缩后真实皮肤脚底位于台面，移动边界内跳跃、挥杆与倒地不越过库边', () => {
    const { rig, model, cue } = makeRig();
    const stage = new THREE.Group();
    stage.scale.setScalar(FIGHT_WORLD_SCALE);
    stage.position.y = FIGHT_SURFACE_Y;
    stage.add(rig.root);
    const p = new THREE.Vector3();
    // Bind-pose feet are stable; precompute them once instead of rescanning 11 meshes on every pose.
    const footVertices = new Map<THREE.SkinnedMesh, number[]>();
    const allVertices = new Map<THREE.SkinnedMesh, number[]>();
    for (const mesh of meshes(model)) {
      const count = mesh.geometry.getAttribute('position').count;
      const all = Array.from({ length: count }, (_, index) => index);
      allVertices.set(mesh, all);
      footVertices.set(mesh, all.filter(index => mesh.geometry.getAttribute('position').getY(index) < 0.1));
    }
    for (const facing of [-1, 1] as const) for (const name of [...Object.keys(data.clips).filter(n => n !== 'death'), 'ko']) {
      const samples = name === 'ko' ? 5 : 12;
      for (let i = 0; i <= samples; i++) {
        const ko = name === 'ko';
        rig.root.position.set(facing * 4.6, ko ? 0 : 0.7, 0);
        rig.update(name, (ko ? 0.65 : data.clips[name]!.duration) * i / samples, 1, facing, facing === -1, !ko);
        expect(rig.getDebug().cueGripError).toBeLessThan(1e-6);
        expect(cue.getWorldScale(p).x).toBeCloseTo(FIGHT_WORLD_SCALE, 6);
        for (const mesh of meshes(model)) {
          const vertices = (ko ? allVertices : footVertices).get(mesh)!;
          for (const v of vertices) {
            mesh.getVertexPosition(v, p).applyMatrix4(mesh.matrixWorld);
            expect(p.y, `${name} frame ${i} sole`).toBeGreaterThanOrEqual(FIGHT_SURFACE_Y + rig.root.position.y * FIGHT_WORLD_SCALE - 1e-6);
            expect(Math.abs(p.x), `${name} frame ${i} X`).toBeLessThan(TABLETOP_BOUNDS.halfX);
            expect(Math.abs(p.z), `${name} frame ${i} Z`).toBeLessThan(TABLETOP_BOUNDS.halfZ);
          }
        }
      }
    }
  }, 120_000);
  it('discloses and constrains the real impactAlt off-hand release rather than faking a grip error', () => {
    const { rig, model } = makeRig();
    rig.update('impactAlt', data.clips.impactAlt!.duration * 25 / 60, 1, 1, false, true);
    const debug = rig.getDebug();
    expect(debug.unconstrainedGripSpan).toBeGreaterThan(0.8);
    expect(debug.gripIKCorrection).toBeGreaterThan(0.3);
    expect(debug.cueGripSpan).toBeCloseTo(0.2, 5);
    expect(debug.cueGripError).toBeLessThan(1e-6);
    // Forearm/upperarm lengths are unchanged even for the largest contact correction.
    for (const side of ['l', 'r']) for (const [a, b] of [['upperarm', 'lowerarm'], ['lowerarm', 'hand']]) {
      const bindLength = point(character, `${a}_${side}`).distanceTo(point(character, `${b}_${side}`));
      expect(point(model, `${a}_${side}`).distanceTo(point(model, `${b}_${side}`))).toBeCloseTo(bindLength, 5);
    }
  });
  it('measures replacement arm compensation and leaves all skin inverse binds, lengths and shared assets intact', () => {
    expect(bones(character)).toHaveLength(74);
    expect(meshes(character)).toHaveLength(11);
    const originalGeometry = meshes(character).map(mesh => mesh.geometry);
    const inverses = meshes(character)[0]!.skeleton.boneInverses.map(matrix => matrix.toArray());
    const originalPositions = new Map(bones(character).map(bone => [bone.name, bone.position.clone()]));
    const { rig, model, shaft, cue } = makeRig();
    const cueGeometry = shaft.geometry;
    rig.update('slash', 0.37, 1, 1, false, true);
    const debug = rig.getDebug();
    expect(debug.mappedBones).toBe(64);
    expect(debug.sourceBoneCount).toBe(65);
    expect(debug.targetBoneCount).toBe(74);
    expect(debug.skinnedMeshCount).toBe(11);
    expect(debug.upperArmBindAlignment).toHaveLength(2);
    for (const correction of debug.upperArmBindAlignment) expect(THREE.MathUtils.radToDeg(correction.radians)).toBeCloseTo(5.84, 1);
    for (const bone of bones(model)) {
      if (bone.name !== 'pelvis') expect(bone.position.toArray()).toEqual(originalPositions.get(bone.name)!.toArray());
    }
    expect(meshes(model)[0]!.skeleton.boneInverses.map(matrix => matrix.toArray())).toEqual(inverses);
    meshes(model).forEach((mesh, i) => expect(mesh.geometry).toBe(originalGeometry[i]));
    expect(shaft.geometry).toBe(cueGeometry);
    expect(cue.children).toEqual([shaft]);
    expect(() => JSON.stringify(debug)).not.toThrow();
  });

  it('bind-direction alignment follows source upper/lower arms without overwriting target offsets', () => {
    const motions: MotionData = { ...data, clips: { idle: THREE.AnimationClip.toJSON(new THREE.AnimationClip('bind', 1, [])) } };
    const { rig, model } = makeRig(motions);
    rig.update('idle', 0, 0, 1, false, true);
    const undoFacing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    for (const side of ['Left', 'Right']) {
      const suffix = side === 'Left' ? 'l' : 'r';
      for (const [a, b, sa, sb] of [['upperarm', 'lowerarm', 'Arm', 'ForeArm'], ['lowerarm', 'hand', 'ForeArm', 'Hand']]) {
        const targetDirection = point(model, `${b}_${suffix}`).sub(point(model, `${a}_${suffix}`)).normalize().applyQuaternion(undoFacing);
        const sourceDirection = point(sourceBind, `mixamorig${side}${sb}`).sub(point(sourceBind, `mixamorig${side}${sa}`)).normalize();
        expect(targetDirection.distanceTo(sourceDirection)).toBeLessThan(1e-5);
      }
    }
  });

  it('converts source hip centimetres along rig Y and grounds skinned soles', () => {
    const { rig, model } = makeRig();
    const direct = clone(sourceBind);
    const mixer = new THREE.AnimationMixer(direct);
    const bindHeight = point(sourceBind, 'mixamorigHips').y;
    const targetBind = point(character, 'pelvis');
    rig.root.position.set(4, 0.7, 2);
    for (const [name, json] of Object.entries(data.clips)) {
      mixer.stopAllAction();
      const clip = THREE.AnimationClip.parse(json);
      mixer.clipAction(clip).play();
      const time = clip.duration * 0.37;
      mixer.setTime(time);
      direct.updateMatrixWorld(true);
      const delta = (point(direct, 'mixamorigHips').y - bindHeight) / 100;
      rig.update(name, time, 1, -1, false, true);
      const actual = rig.root.getObjectByName('fighter-pose')!.worldToLocal(point(model, 'pelvis'));
      expect(actual.x).toBeCloseTo(targetBind.x, 5);
      expect(actual.y).toBeCloseTo(targetBind.y + delta, 5);
      expect(actual.z).toBeCloseTo(targetBind.z, 5);
      const vertex = new THREE.Vector3();
      for (const mesh of meshes(model)) {
        const positions = mesh.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          if (positions.getY(i) >= 0.1) continue;
          mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
          expect(vertex.y, name).toBeGreaterThanOrEqual(rig.root.position.y - 1e-6);
        }
      }
    }
  });

  it('previews all combat clips at full original durations and keeps real finger-derived grips on the original cue', () => {
    const { rig, model, cue } = makeRig();
    let worstSpan = 0;
    for (const [name, clip] of Object.entries(data.clips).filter(([n]) => n !== 'death')) {
      const weaponless = name === 'skillVolley';
      rig.reset();
      for (let frame = 0; frame <= 60; frame++) {
        const time = clip.duration * frame / 60;
        rig.update(name, time, 1, 1, frame % 2 === 0, true);
        const debug = rig.getDebug();
        expect(debug.sourceClip).toBe(name);
        expect(debug.sourceDuration).toBe(clip.duration);
        expect(debug.sampledTime).toBeCloseTo(time % clip.duration, 6);
        expect(debug.cueVisible).toBe(!weaponless);
        expect(debug.cueGripError, `${name}@${time}`).toBeLessThan(1e-6);
        expect(debug.soleMinY).toBeGreaterThanOrEqual(-1e-7);
        expect(debug.cueLength).toBe(1.45);
        worstSpan = Math.max(worstSpan, debug.cueGripSpan);
        for (const side of weaponless ? [] : ['l', 'r']) {
          // Reconstruct actual bone-derived grip independently of getDebug().
          const palm = point(model, `hand_${side}`).multiplyScalar(0.2)
            .addScaledVector(point(model, `thumb_04_leaf_${side}`), 0.4)
            .addScaledVector(point(model, `index_03_${side}`), 0.4);
          const local = cue.worldToLocal(palm);
          expect(local.x).toBeGreaterThanOrEqual(-1.350001);
          expect(local.x).toBeLessThanOrEqual(-1.149999);
          expect(Math.hypot(local.y, local.z)).toBeLessThan(1e-6);
        }
        for (const bone of bones(model)) {
          expect(bone.matrixWorld.elements.every(Number.isFinite)).toBe(true);
          expect(bone.matrixWorld.determinant()).toBeGreaterThan(0);
          expect(bone.quaternion.length()).toBeCloseTo(1, 5);
        }
        expect(cue.matrixWorld.determinant()).toBeGreaterThan(0);
      }
    }
    console.log('real attachment max grip separation (m)', worstSpan);
  });

  it('maps skill casts to the supplied clips and hides the cue only for the bow volley', () => {
    const { rig, cue } = makeRig();
    for (const [action, clip, duration] of [
      ['skillBall', 'skillBall', 1.2], ['skillCat', 'slash', 0.9], ['skillDog', 'skillBall', 1.5], ['skillVolley', 'skillVolley', 1.4],
    ] as const) {
      rig.update(action, duration / 2, 1, 1, false, false);
      const debug = rig.getDebug();
      expect(debug.sourceClip).toBe(clip);
      expect(debug.sampledTime).toBeCloseTo(data.clips[clip]!.duration / 2, 6);
      expect(debug.cueVisible).toBe(action !== 'skillVolley');
    }
    expect(cue.visible).toBe(false);
    rig.update('slash', 0.2, 1, 1, false, false);
    expect(cue.visible).toBe(true);
  });

  it('sampling is independent of outside translation, rotation, facing and frame history', () => {
    const a = makeRig();
    const b = makeRig();
    const world = new THREE.Group();
    world.position.set(9, 3, -4);
    world.rotation.set(0.1, 1.2, 0);
    world.add(b.rig.root);
    b.rig.root.position.set(5, 2, 1);
    a.rig.update('slashAlt', 0.31, 1, 1, false, true);
    b.rig.update('walk', 0.75, 1, -1, false, true);
    b.rig.update('slashAlt', 0.31, 1, -1, false, true);
    expectPoseClose(pose(a.model), pose(b.model));
    expect(b.rig.root.position.toArray()).toEqual([5, 2, 1]);
    expect(a.rig.getDebug().cueGripCoordinates.right).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(a.rig.getDebug().groundLift).toBeCloseTo(b.rig.getDebug().groundLift, 5);
    expect(a.rig.getDebug().cueGripSpan).toBeCloseTo(b.rig.getDebug().cueGripSpan, 5);
    a.rig.reset();
    a.rig.update('slashAlt', 0.31, 0, 1, false, true);
    expectPoseClose(pose(a.model), pose(b.model));
  });

  it('mirrors swapped world deltas sagittally without negative scales, and faces the opponent', () => {
    const normal = makeRig();
    const mirror = makeRig();
    normal.rig.update('slash', 0.45, 1, 1, false, true);
    mirror.rig.update('slash', 0.45, 1, -1, true, true);
    const unface = (p: THREE.Vector3, facing: number): THREE.Vector3 => p.applyAxisAngle(new THREE.Vector3(0, 1, 0), -facing * Math.PI / 2);
    // Actual paired endpoint positions are a stronger test than the sign of a quaternion.
    for (const name of ['upperarm', 'lowerarm', 'hand', 'foot', 'index_03', 'thumb_03']) {
      const right = unface(point(normal.model, `${name}_r`), 1);
      const left = unface(point(mirror.model, `${name}_l`), -1);
      right.x *= -1;
      expect(right.distanceTo(left), name).toBeLessThan(0.002);
    }
    for (const instance of [normal, mirror]) {
      instance.rig.root.traverse(object => expect(Math.min(...object.scale.toArray())).toBeGreaterThan(0));
    }
    const normalForward = new THREE.Vector3(0, 0, 1).applyQuaternion(normal.rig.root.getObjectByName('fighter-facing')!.quaternion);
    const mirroredForward = new THREE.Vector3(0, 0, 1).applyQuaternion(mirror.rig.root.getObjectByName('fighter-facing')!.quaternion);
    expect(normalForward.x).toBeCloseTo(1);
    expect(mirroredForward.x).toBeCloseTo(-1);
  });

  it('maps live rule windows, strips only live jump root ascent, and uses a grounded impact end-pose for KO', () => {
    const { rig, model } = makeRig();
    for (const [name, duration] of Object.entries({ slash: 0.62, slashAlt: 0.8, impact: 0.32, impactAlt: 0.48, jump: 0.61, jumpBack: 0.61, turn: 0.18, turnAlt: 0.18 })) {
      rig.reset();
      rig.update(name, duration / 2, 1, 1, false, false);
      const midpointFraction = name === 'slash'
        ? (0.46 / 1.05) + (1 - 0.46 / 1.05) * ((0.31 - 0.30) / (0.62 - 0.30))
        : name === 'slashAlt'
          ? (0.625 / 1.2) + ((0.70 - 0.625) / 1.2) * ((0.4 - 0.24) / (0.42 - 0.24))
          : 0.5;
      expect(rig.getDebug().sampledTime).toBeCloseTo(data.clips[name]!.duration * midpointFraction, 6);
      rig.update(name, duration * 3, 1, 1, false, false);
      expect(rig.getDebug().sampledTime).toBe(data.clips[name]!.duration);
    }
    let previewPeak = -Infinity;
    for (let i = 0; i <= 20; i++) {
      rig.update('jump', i / 20 * data.clips.jump!.duration, 1, 1, false, true);
      previewPeak = Math.max(previewPeak, rig.getDebug().hipDelta);
      rig.root.position.y = 0.7;
      rig.update('jump', i / 20 * 0.61, 1, 1, false, false);
      expect(rig.getDebug().hipDelta).toBeLessThanOrEqual(0);
      expect(rig.root.position.y).toBe(0.7);
    }
    expect(previewPeak).toBeGreaterThan(0.15);
    rig.root.position.y = 0;
    rig.update('guard', 0.2, 1, 1, false, false);
    expect(rig.getDebug().sourceClip).toBe('idle');
    rig.update('ko', 2, 1, 1, false, false);
    expect(rig.getDebug().sourceClip).toBe('death');
    expect(rig.getDebug().koClipDriven).toBe(true);
    expect(rig.getDebug().sampledTime).toBe(data.clips.death!.duration);
    let minY = Infinity;
    let maxY = -Infinity;
    const p = new THREE.Vector3();
    for (const mesh of meshes(model)) for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeLessThan(0.9);
  });

  it('plays the supplied death clip for a knockdown: fall, lie, then rise back toward standing', () => {
    const { rig } = makeRig();
    const deathDuration = data.clips.death!.duration;
    const liePose = deathDuration * 0.82;
    rig.update('down', 0.35, 1, 1, false, false);
    expect(rig.getDebug().sourceClip).toBe('death');
    expect(rig.getDebug().sampledTime).toBeCloseTo(0.35 / 0.7 * liePose, 6);
    rig.update('down', 1.0, 1, 1, false, false);
    expect(rig.getDebug().sampledTime).toBeCloseTo(liePose, 6);
    rig.update('down', 2.0, 1, 1, false, false);
    expect(rig.getDebug().sampledTime).toBeCloseTo(0, 6);
    expect(rig.getDebug().cueVisible).toBe(false);
  });

  it('keeps the same hand nearest the cue tip through full swings and mirrors that order', () => {
    const { rig } = makeRig();
    rig.update('idle', 0, 1, 1, false, true);
    const grips = rig.getDebug().cueGripCoordinates;
    const sign = Math.sign(grips.right[0]! - grips.left[0]!);
    for (const name of ['slash', 'slashAlt', 'impactAlt']) for (const mirrored of [false, true]) {
      for (let i = 0; i < 120; i++) {
        rig.update(name, data.clips[name]!.duration * i / 120, 1, 1, mirrored, true);
        const next = rig.getDebug().cueGripCoordinates;
        expect(Math.sign(next.right[0]! - next.left[0]!)).toBe(sign * (mirrored ? -1 : 1));
      }
    }
  });

  it('places the cue in front at the exact live damage onset, not during backswing', () => {
    const { rig, cue } = makeRig();
    for (const [name, onset, sourceFraction] of [['slash', 0.14, 0.425 / 1.05], ['slashAlt', 0.24, 0.625 / 1.2]] as const) {
      for (const mirrored of [false, true]) {
        rig.update(name, onset, 1, 1, mirrored, false);
        const tip = cue.localToWorld(new THREE.Vector3());
        expect(tip.x).toBeGreaterThan(0.9);
        expect(tip.y).toBeGreaterThan(1.2);
        expect(tip.y).toBeLessThan(1.9);
        expect(rig.getDebug().sampledTime).toBeCloseTo(data.clips[name]!.duration * sourceFraction, 6);
      }
    }
  });

  it('blends an action change over 80ms, freezes at dt=0 and resets deterministically', () => {
    const { rig, model } = makeRig();
    rig.update('idle', 0.2, 0, 1, false, true);
    const before = pose(model);
    rig.update('slash', 0.6, 0, 1, false, true);
    expectPoseClose(pose(model), before);
    expect(rig.getDebug().transition).toBe(0);
    rig.update('slash', 0.6, 0.04, 1, false, true);
    expect(rig.getDebug().transition).toBeCloseTo(0.5);
    const halfway = pose(model);
    rig.update('slash', 0.6, 0, 1, false, true);
    expectPoseClose(pose(model), halfway);
    rig.update('slash', 0.6, 0.04, 1, false, true);
    expect(rig.getDebug().transition).toBe(1);
    const final = pose(model);
    expect(final).not.toEqual(before);
    rig.reset();
    rig.update('slash', 0.6, 0, 1, false, true);
    expectPoseClose(pose(model), final);
  });
});
