import * as THREE from 'three';

/** Local, centimetre-space Mixamo bind pose and unmodified-duration FBX clips. */
export interface MotionData {
  schemaVersion: 1;
  unitScale: number;
  bones: Array<{
    name: string;
    parent: string | number | null;
    position: number[];
    quaternion: number[];
    scale: number[];
  }>;
  clips: Record<string, ReturnType<typeof THREE.AnimationClip.toJSON>>;
}

const TRANSITION = 0.08;
const CUE_LENGTH = 1.45;
const LIVE_DURATION: Record<string, number> = {
  slash: 0.62, slashAlt: 0.8, impact: 0.32, impactAlt: 0.48,
  jump: 0.61, jumpBack: 0.61, turn: 0.18, turnAlt: 0.18,
  skillBall: 1.2, skillCat: 0.9, skillVolley: 1.4, skillDog: 1.5,
};
// Contact markers measured from the retargeted cue-tip trajectory. Preserve the
// entire source clip but time-warp windup/contact/recovery to the pure rules' windows.
const CONTACT_TIMING: Record<string, { start: number; end: number; sourceStart: number; sourceEnd: number }> = {
  slash: { start: 0.14, end: 0.30, sourceStart: 0.425 / 1.05, sourceEnd: 0.46 / 1.05 },
  slashAlt: { start: 0.24, end: 0.42, sourceStart: 0.625 / 1.2, sourceEnd: 0.70 / 1.2 },
};
const LOOPING = new Set(['idle', 'walk', 'run', 'guard']);
// Knockdown timeline within the pure rules' 2.0 s 'down' window: fall, lie, rise.
const DOWN_FALL = 0.7;
const DOWN_LIE = 1.3;
const DOWN_RISE = 2.0;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const IDENTITY = new THREE.Quaternion();

function sourceName(name: string): string { return name.replace(/^mixamorig:?/, ''); }
function opposite(name: string): string {
  return name.startsWith('Left') ? name.replace('Left', 'Right')
    : name.startsWith('Right') ? name.replace('Right', 'Left') : name;
}
function targetName(name: string): string | undefined {
  const central: Record<string, string> = {
    Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head',
  };
  if (central[name]) return central[name];
  const side = /^(Left|Right)(.+)$/.exec(name);
  if (!side) return undefined;
  const suffix = side[1] === 'Left' ? '_l' : '_r';
  const limbs: Record<string, string> = {
    Shoulder: 'clavicle', Arm: 'upperarm', ForeArm: 'lowerarm', Hand: 'hand',
    UpLeg: 'thigh', Leg: 'calf', Foot: 'foot', ToeBase: 'ball', Toe_End: 'ball_leaf',
  };
  const limb = limbs[side[2]!];
  if (limb) return limb + suffix;
  const finger = /^Hand(Thumb|Index|Middle|Ring|Pinky)([1-4])$/.exec(side[2]!);
  return finger ? `${finger[1]!.toLowerCase()}_0${finger[2]}${finger[2] === '4' ? '_leaf' : ''}${suffix}` : undefined;
}

interface SourceBone {
  bone: THREE.Bone;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  bindWorld: THREE.Quaternion;
  bindPoint: THREE.Vector3;
  animatedWorld: THREE.Quaternion;
}
interface TargetBone {
  bone: THREE.Bone;
  source: string;
  bindPosition: THREE.Vector3;
  bindQuaternion: THREE.Quaternion;
  referenceWorld: THREE.Quaternion;
  desired: THREE.Quaternion;
  transitionFrom: THREE.Quaternion;
  transitionPosition: THREE.Vector3;
  alignmentAngle: number;
}
interface TargetNode {
  object: THREE.Object3D;
  parent: TargetNode | undefined;
  world: THREE.Quaternion;
  mapping: TargetBone | undefined;
}
interface Probe { mesh: THREE.SkinnedMesh; index: number }

/** Owns poses, not assets. Geometry, skeleton inverses and shared materials remain intact. */
export class FighterRig {
  readonly root = new THREE.Group();
  private readonly facingGroup = new THREE.Group();
  private readonly poseGroup = new THREE.Group();
  private readonly sourceRoot = new THREE.Group();
  private readonly source = new Map<string, SourceBone>();
  private readonly target = new Map<string, THREE.Bone>();
  private readonly mappings: TargetBone[] = [];
  private readonly nodes: TargetNode[] = [];
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private readonly mixer: THREE.AnimationMixer;
  private readonly feet: Probe[] = [];
  private readonly body: Probe[] = [];
  private readonly unitScale: number;
  private readonly pelvis: TargetBone | undefined;
  private readonly pelvisBindWorld = new THREE.Vector3();
  private readonly inverseFrame = new THREE.Matrix4();
  private readonly tempMatrix = new THREE.Matrix4();
  private readonly tempQuaternion = new THREE.Quaternion();
  private readonly tempVector = new THREE.Vector3();
  private readonly rightGrip = new THREE.Vector3();
  private readonly leftGrip = new THREE.Vector3();
  private readonly cueAxis = new THREE.Vector3(0, 0, 1);
  private readonly gripMid = new THREE.Vector3();
  private readonly cueLocalRight = new THREE.Vector3();
  private readonly cueLocalLeft = new THREE.Vector3();
  private animation: THREE.AnimationAction | undefined;
  private currentAction = '';
  private sourceClip = '';
  private sampledTime = 0;
  private sourceDuration = 0;
  private previousTime = 0;
  private transitionTime = TRANSITION;
  private mirrored = false;
  private facing: 1 | -1 = 1;
  private facingAngle = Math.PI / 2;
  private preview = false;
  private hipDelta = 0;
  private downWindow = DOWN_RISE;
  private groundLift = 0;
  private soleMinY = 0;
  private cueGripError = 0;
  private cueGripSpan = 0;
  private cueAxisSign = 0;
  private unconstrainedGripSpan = 0;
  private gripIKCorrection = 0;
  private skinnedMeshCount = 0;

  constructor(character: THREE.Group, private readonly cue: THREE.Group, data: MotionData, color: number) {
    if (data.schemaVersion !== 1 || !(data.unitScale > 0) || !Number.isFinite(data.unitScale)) {
      throw new Error('Unsupported fighter motion data');
    }
    this.unitScale = data.unitScale;
    this.root.name = 'fighter-rig';
    this.facingGroup.name = 'fighter-facing';
    this.poseGroup.name = 'fighter-pose';
    this.root.add(this.facingGroup);
    this.facingGroup.add(this.poseGroup);
    this.poseGroup.add(character, cue);

    for (const definition of data.bones) {
      const key = sourceName(definition.name);
      if (this.source.has(key)) throw new Error(`Duplicate motion bone: ${key}`);
      const bone = new THREE.Bone();
      bone.name = definition.name;
      bone.position.fromArray(definition.position);
      bone.quaternion.fromArray(definition.quaternion).normalize();
      bone.scale.fromArray(definition.scale);
      this.source.set(key, {
        bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
        bindWorld: new THREE.Quaternion(), bindPoint: new THREE.Vector3(), animatedWorld: new THREE.Quaternion(),
      });
    }
    data.bones.forEach(definition => {
      const parentName = typeof definition.parent === 'number' ? data.bones[definition.parent]?.name : definition.parent;
      const parent = parentName ? this.source.get(sourceName(parentName))?.bone : undefined;
      (parent ?? this.sourceRoot).add(this.source.get(sourceName(definition.name))!.bone);
    });
    this.sourceRoot.updateMatrixWorld(true);
    for (const source of this.source.values()) {
      source.bone.getWorldQuaternion(source.bindWorld);
      source.bone.getWorldPosition(source.bindPoint);
    }
    this.mixer = new THREE.AnimationMixer(this.sourceRoot);
    for (const [name, json] of Object.entries(data.clips)) this.clips.set(name, THREE.AnimationClip.parse(json));
    if (!this.clips.has('idle') || !this.source.has('Hips')) throw new Error('Fighter needs idle and Hips');

    this.root.updateMatrixWorld(true);
    character.traverse(object => {
      if (object instanceof THREE.Bone) this.target.set(object.name, object);
      if (object instanceof THREE.SkinnedMesh) {
        this.skinnedMeshCount++;
        object.frustumCulled = false;
        object.castShadow = true;
        object.receiveShadow = true;
        // Clone only the body tint. The scene owner disposes these instance materials.
        if (/superhero|outfit/i.test(object.name)) {
          const tint = (material: THREE.Material): THREE.Material => {
            const copy = material.clone();
            if ('color' in copy && copy.color instanceof THREE.Color) copy.color.lerp(new THREE.Color(color), 0.32);
            return copy;
          };
          object.material = Array.isArray(object.material) ? object.material.map(tint) : tint(object.material);
        }
        const positions = object.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          const probe = { mesh: object, index: i };
          this.body.push(probe);
          object.getVertexPosition(i, this.tempVector).applyMatrix4(object.matrixWorld);
          if (this.tempVector.y < 0.16) this.feet.push(probe);
        }
      }
    });
    const byBone = new Map<THREE.Bone, TargetBone>();
    for (const [name, source] of this.source) {
      const mappedName = targetName(name);
      const bone = mappedName ? this.target.get(mappedName) : undefined;
      if (!bone) continue;
      const referenceWorld = bone.getWorldQuaternion(new THREE.Quaternion());
      // Replacement characters can be T-pose or A-pose. Derive a swing from the
      // actual bind directions, while keeping the target's roll and ALL skin bind inverses.
      const sourceChild = name.endsWith('Hand')
        ? this.source.get(name + 'Middle1')
        : [...this.source.values()].find(child => child.bone.parent === source.bone && targetName(sourceName(child.bone.name)));
      const childName = sourceChild ? targetName(sourceName(sourceChild.bone.name)) : undefined;
      const targetChild = childName ? this.target.get(childName) : undefined;
      let alignmentAngle = 0;
      if (sourceChild && targetChild) {
        const from = targetChild.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3()));
        const to = sourceChild.bindPoint.clone().sub(source.bindPoint);
        if (from.lengthSq() > 1e-12 && to.lengthSq() > 1e-12) {
          const alignment = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
          alignmentAngle = IDENTITY.angleTo(alignment);
          referenceWorld.premultiply(alignment);
        }
      }
      const mapping: TargetBone = {
        bone, source: name, bindPosition: bone.position.clone(), bindQuaternion: bone.quaternion.clone(),
        referenceWorld, desired: new THREE.Quaternion(), transitionFrom: bone.quaternion.clone(),
        transitionPosition: bone.position.clone(), alignmentAngle,
      };
      this.mappings.push(mapping);
      byBone.set(bone, mapping);
    }
    if (!this.target.has('hand_l') || !this.target.has('hand_r')) throw new Error('Fighter needs both target hands');
    const nodeMap = new Map<THREE.Object3D, TargetNode>();
    character.traverse(object => {
      const node: TargetNode = { object, parent: nodeMap.get(object.parent!), world: new THREE.Quaternion(), mapping: byBone.get(object as THREE.Bone) };
      nodeMap.set(object, node);
      this.nodes.push(node);
    });
    this.pelvis = this.mappings.find(mapping => mapping.source === 'Hips');
    if (!this.pelvis) throw new Error('Fighter needs target pelvis');
    this.pelvis.bone.getWorldPosition(this.pelvisBindWorld);
    this.reset();
  }

  update(action: string, actionTime: number, dt: number, facing: 1 | -1, mirrored: boolean, preview: boolean, downDuration = DOWN_RISE): void {
    const time = Number.isFinite(actionTime) ? Math.max(0, actionTime) : 0;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.downWindow = Number.isFinite(downDuration) && downDuration > 0 ? downDuration : DOWN_RISE;
    const requestedClip = action === 'ko' || action === 'down' ? 'death'
      : action === 'guard' ? 'idle'
        : action === 'skillCat' ? 'slash'
          : action === 'skillDog' ? 'skillBall'
            : action;
    const clipName = this.clips.has(requestedClip) ? requestedClip : 'idle';
    const first = !this.currentAction;
    const changed = action !== this.currentAction || mirrored !== this.mirrored || preview !== this.preview
      || (!preview && time + 0.001 < this.previousTime);
    if (changed) {
      for (const mapping of this.mappings) {
        mapping.transitionFrom.copy(mapping.bone.quaternion);
        mapping.transitionPosition.copy(mapping.bone.position);
      }
      this.transitionTime = first ? TRANSITION : 0;
    }
    this.currentAction = action;
    this.previousTime = time;
    this.mirrored = mirrored;
    this.facing = facing;
    this.preview = preview;
    this.transitionTime = Math.min(TRANSITION, this.transitionTime + step);
    const blend = THREE.MathUtils.smoothstep(this.transitionTime, 0, TRANSITION);
    this.sample(clipName, action, time, preview);
    // Detached source and root-relative target frames never contain the fighter's
    // world position, facing rotation, grounding or KO rotation.
    for (const source of this.source.values()) source.bone.getWorldQuaternion(source.animatedWorld);
    for (const node of this.nodes) {
      const parentWorld = node.parent?.world ?? IDENTITY;
      const mapping = node.mapping;
      if (mapping) {
        const source = this.source.get(mirrored ? opposite(mapping.source) : mapping.source)!;
        mapping.desired.copy(source.bindWorld).invert().premultiply(source.animatedWorld);
        // Sagittal reflection of the WORLD rotation delta, after swapping sides.
        // Reflecting local quaternions would mix unrelated bone axes/rolls.
        if (mirrored) mapping.desired.set(mapping.desired.x, -mapping.desired.y, -mapping.desired.z, mapping.desired.w);
        mapping.desired.multiply(mapping.referenceWorld);
        mapping.desired.premultiply(this.tempQuaternion.copy(parentWorld).invert()).normalize();
        mapping.bone.quaternion.copy(mapping.transitionFrom).slerp(mapping.desired, blend);
      }
      node.world.copy(parentWorld).multiply(node.object.quaternion).normalize();
    }
    const hips = this.source.get('Hips')!;
    this.hipDelta = (hips.bone.getWorldPosition(this.tempVector).y - hips.bindPoint.y) * this.unitScale;
    // Gameplay owns ballistic height. Keep only bounded crouch, never the FBX ascent.
    if (!preview && (action === 'jump' || action === 'jumpBack')) this.hipDelta = THREE.MathUtils.clamp(this.hipDelta, -0.16, 0);
    if (this.pelvis) {
      // The glTF root is -X90: adding local pelvis.y would move along WORLD -Z.
      const desiredPosition = this.pelvisBindWorld.clone();
      desiredPosition.y += this.hipDelta;
      this.updateMatrices();
      this.tempMatrix.copy(this.poseGroup.matrixWorld).invert().multiply(this.pelvis.bone.parent!.matrixWorld).invert();
      desiredPosition.applyMatrix4(this.tempMatrix);
      this.pelvis.bone.position.copy(this.pelvis.transitionPosition).lerp(desiredPosition, blend);
    }
    const targetAngle = facing * Math.PI / 2;
    this.facingAngle += (targetAngle - this.facingAngle) * Math.min(1, step * 12);
    this.facingGroup.rotation.y = this.facingAngle;
    // Knockdown and KO are driven by the supplied death clip, not a procedural fall.
    this.poseGroup.rotation.x = 0;
    this.poseGroup.position.y = 0;
    this.updateMatrices();
    // The bow draw and the death fall do not hold the cue; free both hands.
    const weaponless = action === 'skillVolley' || action === 'ko' || action === 'down' || action === 'death';
    this.cue.visible = !weaponless;
    if (weaponless) {
      this.cueGripError = 0;
      this.cueGripSpan = 0;
      this.unconstrainedGripSpan = 0;
      this.gripIKCorrection = 0;
      this.ground(action === 'ko' || action === 'down' || action === 'death');
    } else {
      this.constrainGrip();
      this.ground(false);
      this.alignCue();
    }
    this.updateMatrices();
  }

  private sample(name: string, action: string, time: number, preview: boolean): void {
    const clip = this.clips.get(name) ?? this.clips.get('idle')!;
    if (this.sourceClip !== name || !this.animation) {
      this.mixer.stopAllAction();
      for (const source of this.source.values()) {
        source.bone.position.copy(source.position);
        source.bone.quaternion.copy(source.quaternion);
        source.bone.scale.copy(source.scale);
      }
      this.animation = this.mixer.clipAction(clip);
      this.animation.reset().setLoop(THREE.LoopOnce, 1).play();
      this.animation.clampWhenFinished = true;
      this.sourceClip = name;
    }
    this.sourceDuration = clip.duration;
    if (action === 'ko') this.sampledTime = clip.duration;
    else if (action === 'down') {
      // Stretch the fall/lie/rise timeline to the rules' knockdown window (3 s for the dog stun).
      const stretch = this.downWindow / DOWN_RISE;
      const fall = DOWN_FALL * stretch;
      const lie = DOWN_LIE * stretch;
      const liePose = clip.duration * 0.82;
      if (time < fall) this.sampledTime = (time / fall) * liePose;
      else if (time < lie) this.sampledTime = liePose;
      else this.sampledTime = liePose * (1 - Math.min(1, (time - lie) / (this.downWindow - lie)));
    }
    else if (preview || LOOPING.has(action) || !LIVE_DURATION[action]) this.sampledTime = clip.duration > 0 ? time % clip.duration : 0;
    else {
      const contact = CONTACT_TIMING[action];
      let fraction = Math.min(time / LIVE_DURATION[action]!, 1);
      if (contact) {
        if (time < contact.start) fraction = time / contact.start * contact.sourceStart;
        else if (time < contact.end) fraction = THREE.MathUtils.lerp(contact.sourceStart, contact.sourceEnd, (time - contact.start) / (contact.end - contact.start));
        else fraction = THREE.MathUtils.lerp(contact.sourceEnd, 1, Math.min(1, (time - contact.end) / (LIVE_DURATION[action]! - contact.end)));
      }
      this.sampledTime = fraction * clip.duration;
    }
    this.animation.enabled = true;
    this.animation.paused = true;
    this.animation.time = this.sampledTime;
    this.mixer.update(0);
    this.sourceRoot.updateMatrixWorld(true);
  }

  private updateMatrices(): void {
    this.root.updateWorldMatrix(true, false);
    // SkinnedMesh overrides updateMatrixWorld, NOT updateWorldMatrix. Its attached
    // bindMatrixInverse must follow the mesh when the scene owner moves our root.
    this.root.updateMatrixWorld(true);
  }

  private ground(wholeBody: boolean): void {
    this.inverseFrame.copy(this.facingGroup.matrixWorld).invert();
    let minY = Infinity;
    for (const { mesh, index } of wholeBody ? this.body : this.feet) {
      mesh.getVertexPosition(index, this.tempVector).applyMatrix4(mesh.matrixWorld).applyMatrix4(this.inverseFrame);
      minY = Math.min(minY, this.tempVector.y);
    }
    if (!Number.isFinite(minY)) {
      for (const name of ['foot_l', 'foot_r', 'ball_l', 'ball_r']) {
        const bone = this.target.get(name);
        if (bone) minY = Math.min(minY, bone.getWorldPosition(this.tempVector).applyMatrix4(this.inverseFrame).y - 0.015);
      }
    }
    if (!Number.isFinite(minY)) minY = 0;
    this.groundLift = wholeBody ? -minY : Math.max(0, -minY);
    this.poseGroup.position.y = this.groundLift;
    this.soleMinY = minY + this.groundLift;
    this.updateMatrices();
  }

  private palm(side: 'l' | 'r', out: THREE.Vector3): void {
    // Thumb/index tips enclose the GreatSword grip. A wrist pivot alone makes the
    // cue float outside the closed fingers, especially during the overhead slash.
    const hand = this.target.get(`hand_${side}`)!;
    hand.getWorldPosition(out);
    const thumb = this.target.get(`thumb_04_leaf_${side}`);
    const index = this.target.get(`index_03_${side}`);
    if (thumb && index) {
      out.multiplyScalar(0.2);
      out.addScaledVector(thumb.getWorldPosition(this.tempVector), 0.4);
      out.addScaledVector(index.getWorldPosition(this.tempVector), 0.4);
    }
    out.applyMatrix4(this.inverseFrame);
  }

  private constrainGrip(): void {
    this.inverseFrame.copy(this.poseGroup.matrixWorld).invert();
    this.palm('r', this.rightGrip);
    this.palm('l', this.leftGrip);
    this.unconstrainedGripSpan = this.rightGrip.distanceTo(this.leftGrip);
    this.gripIKCorrection = 0;
    // Most attachments already have a 7–25cm two-hand grip. ImpactAlt actually
    // releases the off hand (measured 93cm separation). A bounded, length-preserving
    // two-arm IK contact constraint is necessary for the requested two-hand cue;
    // there are no replacement animation curves, and fingers/wrist rotations stay FBX-driven.
    if (this.unconstrainedGripSpan <= 0.2 || !this.clips.get(this.sourceClip)?.tracks.length) return;
    this.gripMid.copy(this.rightGrip).add(this.leftGrip).multiplyScalar(0.5);
    const direction = this.leftGrip.clone().sub(this.rightGrip).normalize();
    const rightGoal = this.gripMid.clone().addScaledVector(direction, -0.1);
    const leftGoal = this.gripMid.clone().addScaledVector(direction, 0.1);
    this.gripIKCorrection = (this.unconstrainedGripSpan - 0.2) / 2;
    this.solveArm('r', rightGoal, this.rightGrip.clone());
    this.solveArm('l', leftGoal, this.leftGrip.clone());
  }

  private solveArm(side: 'l' | 'r', palmGoal: THREE.Vector3, palm: THREE.Vector3): void {
    const upper = this.target.get(`upperarm_${side}`);
    const lower = this.target.get(`lowerarm_${side}`);
    const hand = this.target.get(`hand_${side}`);
    if (!upper || !lower || !hand) return;
    const frameInverse = this.poseGroup.getWorldQuaternion(new THREE.Quaternion()).invert();
    const rotation = (object: THREE.Object3D): THREE.Quaternion => object.getWorldQuaternion(new THREE.Quaternion()).premultiply(frameInverse);
    const position = (object: THREE.Object3D): THREE.Vector3 => object.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverseFrame);
    const shoulder = position(upper);
    const elbow = position(lower);
    const wrist = position(hand);
    const wristRotation = rotation(hand);
    const goal = palmGoal.clone().sub(palm).add(wrist);
    const firstLength = shoulder.distanceTo(elbow);
    const secondLength = elbow.distanceTo(wrist);
    const direction = goal.clone().sub(shoulder);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(firstLength - secondLength) + 1e-6, firstLength + secondLength - 1e-6);
    if (direction.lengthSq() < 1e-12 || firstLength < 1e-6 || secondLength < 1e-6) return;
    direction.normalize();
    goal.copy(shoulder).addScaledVector(direction, distance);
    const pole = elbow.clone().sub(shoulder);
    pole.addScaledVector(direction, -pole.dot(direction));
    if (pole.lengthSq() < 1e-10) {
      pole.set(0, 0, 1).applyQuaternion(rotation(upper));
      pole.addScaledVector(direction, -pole.dot(direction));
    }
    pole.normalize();
    const along = (firstLength * firstLength - secondLength * secondLength + distance * distance) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, firstLength * firstLength - along * along));
    const elbowGoal = shoulder.clone().addScaledVector(direction, along).addScaledVector(pole, bend);
    const swing = new THREE.Quaternion().setFromUnitVectors(elbow.clone().sub(shoulder).normalize(), elbowGoal.clone().sub(shoulder).normalize());
    const world = rotation(upper).premultiply(swing);
    upper.quaternion.copy(rotation(upper.parent!).invert().multiply(world)).normalize();
    this.updateMatrices();
    const movedElbow = position(lower);
    const movedWrist = position(hand);
    swing.setFromUnitVectors(movedWrist.sub(movedElbow).normalize(), goal.sub(movedElbow).normalize());
    world.copy(rotation(lower)).premultiply(swing);
    lower.quaternion.copy(rotation(lower.parent!).invert().multiply(world)).normalize();
    this.updateMatrices();
    hand.quaternion.copy(rotation(hand.parent!).invert().multiply(wristRotation)).normalize();
    this.updateMatrices();
  }

  private alignCue(): void {
    this.inverseFrame.copy(this.poseGroup.matrixWorld).invert();
    this.palm('r', this.rightGrip);
    this.palm('l', this.leftGrip);
    this.gripMid.copy(this.rightGrip).add(this.leftGrip).multiplyScalar(0.5);
    this.cueAxis.copy(this.leftGrip).sub(this.rightGrip);
    this.cueGripSpan = this.cueAxis.length();
    if (this.cueGripSpan < 1e-5) this.cueAxis.set(0, 0, 1);
    else this.cueAxis.normalize();
    if (!this.cueAxisSign) {
      // Establish which hand is nearer the tip from idle once. A per-frame torso
      // dot test flips the entire cue 180 degrees during overhead/back swings.
      const torso = this.target.get('spine_03') ?? this.pelvis!.bone;
      torso.getWorldPosition(this.tempVector).applyMatrix4(this.inverseFrame);
      this.tempVector.subVectors(this.gripMid, this.tempVector);
      this.cueAxisSign = this.cueAxis.dot(this.tempVector) < 0 ? -1 : 1;
    }
    this.cueAxis.multiplyScalar(this.cueAxisSign * (this.mirrored ? -1 : 1));
    this.cue.quaternion.setFromUnitVectors(X_AXIS, this.cueAxis);
    // Mid-grip x=-1.25: the original cue extends toward its tip, away from torso.
    this.cue.position.copy(this.gripMid).addScaledVector(this.cueAxis, 1.25);
    this.cue.updateMatrix();
    this.tempMatrix.copy(this.cue.matrix).invert();
    this.cueLocalRight.copy(this.rightGrip).applyMatrix4(this.tempMatrix);
    this.cueLocalLeft.copy(this.leftGrip).applyMatrix4(this.tempMatrix);
    const distanceToShaft = (grip: THREE.Vector3): number => Math.hypot(
      grip.y, grip.z, grip.x - THREE.MathUtils.clamp(grip.x, -CUE_LENGTH, 0),
    );
    this.cueGripError = Math.max(distanceToShaft(this.cueLocalRight), distanceToShaft(this.cueLocalLeft));
  }

  reset(): void {
    this.mixer.stopAllAction();
    this.animation = undefined;
    this.currentAction = '';
    this.sourceClip = '';
    this.previousTime = 0;
    this.transitionTime = TRANSITION;
    this.facingAngle = Math.PI / 2;
    this.poseGroup.position.set(0, 0, 0);
    this.poseGroup.quaternion.identity();
    this.facingGroup.quaternion.identity();
    for (const mapping of this.mappings) {
      mapping.bone.position.copy(mapping.bindPosition);
      mapping.bone.quaternion.copy(mapping.bindQuaternion);
    }
    this.update('idle', 0, 0, 1, false, false);
    // The next externally requested pose is a deterministic first sample.
    this.currentAction = '';
  }

  getDebug() {
    return {
      currentAction: this.currentAction, sourceClip: this.sourceClip, sampledTime: this.sampledTime,
      sourceDuration: this.sourceDuration, mappedBones: this.mappings.length,
      sourceBoneCount: this.source.size, targetBoneCount: this.target.size, skinnedMeshCount: this.skinnedMeshCount,
      cueGripError: this.cueGripError, cueGripSpan: this.cueGripSpan, cueLength: CUE_LENGTH, cueVisible: this.cue.visible,
      unconstrainedGripSpan: this.unconstrainedGripSpan, gripIKCorrection: this.gripIKCorrection,
      cueGripCoordinates: { right: this.cueLocalRight.toArray(), left: this.cueLocalLeft.toArray() },
      hipDelta: this.hipDelta, groundLift: this.groundLift, soleMinY: this.soleMinY,
      facing: this.facing, mirrored: this.mirrored, preview: this.preview,
      transition: this.transitionTime / TRANSITION, koClipDriven: this.sourceClip === 'death',
      upperArmBindAlignment: this.mappings.filter(mapping => /^upperarm_/.test(mapping.bone.name))
        .map(mapping => ({ name: mapping.bone.name, radians: mapping.alignmentAngle })),
    };
  }
}
