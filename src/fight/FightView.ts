import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createTabletopArena, FIGHT_WORLD_SCALE, FIGHT_SURFACE_Y, TABLETOP_BOUNDS, tabletopCameraFrame } from './TabletopArena';
import { normalizeFightCharacter } from './characterModel';
import { createCueStick } from '../view/CueStick';
import { FighterRig, type MotionData } from './FighterRig';
import type { FighterState, FightAction, FightProjectile, FightSkill } from './FightSimulation';

interface ProjectileVisual {
  group: THREE.Group;
  kind: FightSkill;
  disposables: Array<{ dispose(): void }>;
  trailAt: number;
  /** Seconds left of the post-hit linger; >0 while shrinking at the impact point. */
  linger: number;
}

/** 命中后释放物在落点缩小的时长，让玩家看清技能建模而不是命中即消失。 */
const PROJECTILE_LINGER = 0.55;

interface EffectParticle {
  mesh: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;
  spin: number;
}

interface EffectRing {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  growth: number;
}

interface EffectLine {
  object: THREE.Line;
  life: number;
  maxLife: number;
}

interface EffectFlash {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  start: number;
  growth: number;
}

const SKILL_PALETTES: Record<FightSkill, { core: number; hot: number; cool: number; ring: number }> = {
  ball: { core: 0xffffff, hot: 0xffa24a, cool: 0x86d9ff, ring: 0x9fe6ff },
  cat: { core: 0xff8a3d, hot: 0xff3b1f, cool: 0xffb347, ring: 0xff4b24 },
  volley: { core: 0xe3bfff, hot: 0x8a3cff, cool: 0xffffff, ring: 0xc08cff },
  dog: { core: 0xff2a1a, hot: 0xff6a00, cool: 0xffd23f, ring: 0xff1f0f },
};

/** Kenney Particle Pack (CC0) sprites used by bursts, trails and the dog explosion. */
const PARTICLE_TEXTURES = ['fire_01', 'flame_04', 'flare_01', 'light_01', 'magic_05', 'spark_04', 'star_06', 'smoke_08', 'slash_01', 'trace_01', 'twirl_01', 'circle_05', 'muzzle_02', 'scorch_01'] as const;
const BURST_TEXTURES: Record<FightSkill, readonly string[]> = {
  ball: ['spark_04', 'star_06', 'light_01'],
  cat: ['fire_01', 'flame_04', 'smoke_08'],
  volley: ['magic_05', 'twirl_01', 'trace_01'],
  dog: ['fire_01', 'flame_04', 'smoke_08', 'spark_04'],
};
const TRAIL_TEXTURES: Record<FightSkill, string> = {
  ball: 'trace_01', cat: 'fire_01', volley: 'magic_05', dog: 'flame_04',
};

export class FightView {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-5.4, 5.4, 3, -3, 0.1, 60);
  private renderer: THREE.WebGLRenderer;
  private actors: FighterRig[] = [];
  private loaded: THREE.Object3D[] = [];
  private dead = false;
  private feedback = 0;
  private feedbackSeat: 0 | 1 = 0;
  private spark: THREE.Mesh;
  private motionCount = 0;
  private characterAssignment: string[] = [];
  private aspect = 1;
  private frameWidth = 5.1;
  private centerX = 0;
  private combatRoot: THREE.Group | null = null;
  private arena: ReturnType<typeof createTabletopArena> | null = null;
  private environmentMap: THREE.WebGLRenderTarget | null = null;
  private koTimes = [0, 0];
  private readonly resizeObserver: ResizeObserver;
  private projectileRoot: THREE.Group | null = null;
  private cueTemplate: THREE.Group | null = null;
  private catTemplate: THREE.Group | null = null;
  private dogTemplate: THREE.Group | null = null;
  private readonly particleTextures = new Map<string, THREE.Texture>();
  private readonly labelSprites: THREE.Sprite[] = [];
  private shakeTime = 0;
  private readonly projectileVisuals = new Map<number, ProjectileVisual>();
  private lingerCount = 0;
  private impactFallback = 0;
  private readonly bows: THREE.Group[] = [];
  private readonly particles: EffectParticle[] = [];
  private readonly rings: EffectRing[] = [];
  private readonly effectLines: EffectLine[] = [];
  private readonly flashes: EffectFlash[] = [];
  private readonly effectRoot = new THREE.Group();
  private effectSeed = 0x1a2b3c4d;
  private lastEffectKind: FightSkill | null = null;
  private readonly sharedEffects = {
    ring: new THREE.RingGeometry(0.12, 0.18, 28),
    ball: new THREE.SphereGeometry(0.2, 20, 14),
    ballMaterial: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfeaff, emissiveIntensity: 1.8, roughness: 0.22 }),
    glow: new THREE.SphereGeometry(0.32, 14, 10),
    glowMaterial: new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    fireGlowMaterial: new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }),
    flash: new THREE.SphereGeometry(0.42, 14, 10),
  };
  private readonly tempVector = new THREE.Vector3();

  constructor(private host: HTMLElement, private reducedMotion: boolean) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '原台球房间内的空台球桌，两名微缩角色持球杆格斗');
    this.host.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0xf2ead9);
    this.scene.fog = new THREE.Fog(0xf2ead9, 12, 26);
    this.scene.add(new THREE.HemisphereLight(0xdde5df, 0x211d19, 0.62));
    const key = new THREE.DirectionalLight(0xfff1d9, 1.25);
    key.position.set(-2.6, 6.5, 3.6); key.castShadow = true;
    key.target.position.y = FIGHT_SURFACE_Y;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
    key.shadow.camera.near = 0.1; key.shadow.camera.far = 14;
    key.shadow.normalBias = 0.003;
    this.scene.add(key, key.target);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 16), new THREE.ShadowMaterial({ opacity: 0.34 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.004; floor.receiveShadow = true;
    this.scene.add(floor);
    this.spark = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.018, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffd98b, transparent: true, opacity: 0.9 }));
    this.spark.visible = false; this.scene.add(this.spark);
    this.effectRoot.name = 'fight-skill-effects';
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host);
    this.resize();
  }

  async load(progress?: (done: number, total: number) => void): Promise<void> {
    const total = 7 + PARTICLE_TEXTURES.length;
    let done = 0;
    const bump = (): void => { progress?.(++done, total); };
    progress?.(0, total);
    const loader = new GLTFLoader();
    const response = await fetch('/assets/fight/motions.json');
    if (!response.ok) throw new Error(`动作数据读取失败（${response.status}）`);
    const data = await response.json() as MotionData;
    if (data.schemaVersion !== 1 || Object.keys(data.clips).length !== 14) throw new Error('动作数据不完整，需要全部 14 段动作');
    this.motionCount = Object.keys(data.clips).length;
    bump();
    if (this.dead) return;
    // Independent GLTF instances: exiting this mode must never dispose the billiards scene's resources.
    // Sequential ownership lets dispose() release every successfully loaded scene even if the next fails.
    const tableAsset = await loader.loadAsync('/assets/models/pool-table-traditional.glb');
    this.loaded.push(tableAsset.scene);
    bump();
    if (this.dead) { this.releaseObjects(); return; }
    const roomAsset = await loader.loadAsync('/assets/models/sitting_room_with_baked_textures.glb');
    this.loaded.push(roomAsset.scene);
    bump();
    if (this.dead) { this.releaseObjects(); return; }
    this.arena = createTabletopArena(tableAsset.scene, roomAsset.scene);
    this.scene.add(this.arena.group);
    this.combatRoot = this.arena.fighters;
    this.combatRoot.add(this.spark);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnvironment = new RoomEnvironment();
    try { this.environmentMap = pmrem.fromScene(roomEnvironment, 0.04); }
    finally { pmrem.dispose(); roomEnvironment.dispose(); }
    this.scene.environment = this.environmentMap.texture;
    this.scene.environmentIntensity = 0.5;
    const character = await loader.loadAsync('/assets/fight/character/indian_man_in_suit.glb');
    this.loaded.push(character.scene);
    bump();
    if (this.dead) { this.releaseObjects(); return; }
    normalizeFightCharacter(character.scene);
    const cueAsset = await loader.loadAsync('/assets/models/cc0_-_cue_stick.glb');
    this.loaded.push(cueAsset.scene);
    bump();
    if (this.dead) { this.releaseObjects(); return; }
    const cue = createCueStick(cueAsset.scene);
    if (!cue) throw new Error('现有台球杆模型未包含可用网格');
    this.loaded.push(cue);
    this.cueTemplate = cue;
    const catAsset = await loader.loadAsync('/assets/fight/cat/oiiaioooooiai_cat.glb');
    this.loaded.push(catAsset.scene);
    bump();
    if (this.dead) { this.releaseObjects(); return; }
    this.catTemplate = this.makeCatTemplate(catAsset.scene);
    const dogAsset = await loader.loadAsync('/assets/fight/dog/labrador_dog.glb');
    this.loaded.push(dogAsset.scene);
    bump();
    if (this.dead) { this.releaseObjects(); return; }
    this.dogTemplate = this.makeDogTemplate(dogAsset.scene);
    const textureLoader = new THREE.TextureLoader();
    await Promise.all(PARTICLE_TEXTURES.map(async name => {
      try {
        const texture = await textureLoader.loadAsync(`/assets/fight/particles/${name}.png`);
        texture.colorSpace = THREE.SRGBColorSpace;
        if (!this.dead) this.particleTextures.set(name, texture);
        else texture.dispose();
      } catch { /* Plain additive sparks remain as the fallback for this sprite. */ }
      bump();
    }));
    if (this.dead) { this.releaseObjects(); return; }
    this.projectileRoot = new THREE.Group();
    this.projectileRoot.name = 'fight-skill-projectiles';
    this.combatRoot.add(this.projectileRoot);
    this.combatRoot.add(this.effectRoot);
    // Both seats share the same supplied fighter; P1/P2 badges keep them apart.
    this.characterAssignment = ['indian', 'indian'];
    for (let i = 0; i < 2; i++) {
      const actor = new FighterRig(clone(character.scene) as THREE.Group, cue.clone(true), data, i === 0 ? 0x419d80 : 0xb66d58);
      this.actors.push(actor); this.combatRoot.add(actor.root);
      const label = this.makeSeatLabel(i === 0 ? 'P1' : 'P2', i === 0 ? '#419d80' : '#b66d58');
      label.position.set(0, 2.14, 0);
      actor.root.add(label);
      this.labelSprites.push(label);
      const bow = this.createBow();
      bow.visible = false;
      this.combatRoot.add(bow);
      this.bows.push(bow);
    }
  }

  /** Camera-facing seat badge rendered from a local canvas; no external font or image. */
  private makeSeatLabel(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 192; canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(16,14,12,0.82)';
    ctx.beginPath();
    ctx.roundRect(8, 12, 176, 72, 18);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 52px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 96, 50);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.66, 0.33, 1);
    sprite.renderOrder = 900;
    return sprite;
  }

  /** Centre the supplied dog on its feet and align its long axis with +X (~2.4 m). */
  private makeDogTemplate(scene: THREE.Object3D): THREE.Group {
    const wrapper = new THREE.Group();
    const inner = new THREE.Group();
    // 蒙皮包围盒依赖骨骼的世界矩阵，先刷新再测量，否则按未更新的矩阵算出错误缩放。
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 2.4 / Math.max(size.x, size.y, size.z, 1e-6);
    inner.scale.setScalar(scale);
    const rotated = size.z > size.x;
    if (rotated) inner.rotation.y = Math.PI / 2;
    const cx = rotated ? center.z : center.x;
    const cz = rotated ? -center.x : center.z;
    inner.position.set(-cx * scale, -box.min.y * scale, -cz * scale);
    inner.add(scene);
    wrapper.add(inner);
    return wrapper;
  }

  /** Centre and scale the supplied cat to a readable spinning projectile (~2 m long). */
  private makeCatTemplate(scene: THREE.Object3D): THREE.Group {
    const wrapper = new THREE.Group();
    const inner = new THREE.Group();
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 2.0 / Math.max(size.x, size.y, size.z, 1e-6);
    inner.scale.setScalar(scale);
    inner.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    inner.add(scene);
    wrapper.add(inner);
    return wrapper;
  }

  /** A simple stylised bow prop; the supplied draw animation drives the hands. */
  private createBow(): THREE.Group {
    const bow = new THREE.Group();
    bow.name = 'fight-volley-bow';
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.24, 0.62, 0), new THREE.Vector3(-0.02, 0.34, 0),
      new THREE.Vector3(0.03, 0, 0), new THREE.Vector3(-0.02, -0.34, 0),
      new THREE.Vector3(-0.24, -0.62, 0),
    ]);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.5, metalness: 0.12, emissive: 0x2a1608, emissiveIntensity: 0.35 });
    bow.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.048, 8, false), wood));
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x2f1c10, roughness: 0.7 }));
    grip.rotation.z = Math.PI / 2;
    bow.add(grip);
    const stringGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.24, 0.62, 0), new THREE.Vector3(-0.24, -0.62, 0),
    ]);
    bow.add(new THREE.Line(stringGeometry, new THREE.LineBasicMaterial({ color: 0xf4ead2 })));
    return bow;
  }

  resetActions(): void {
    this.actors.forEach(actor => actor.reset());
    this.feedback = 0;
    this.koTimes = [0, 0];
    this.clearTransient();
  }

  hit(seat: 0 | 1, blocked: boolean): void {
    this.feedback = blocked ? 0.12 : 0.18; this.feedbackSeat = seat;
    (this.spark.material as THREE.MeshBasicMaterial).color.setHex(blocked ? 0x94dce3 : 0xffd98b);
  }

  /** Burst for a projectile impact. Positions are in the miniature fighter space. */
  skillHit(kind: FightSkill, x: number, y: number): void {
    const palette = SKILL_PALETTES[kind];
    this.lastEffectKind = kind;
    if (kind === 'dog') {
      // Large red explosion: fire core, flame tongues, smoke and sparks, then the dog vanishes.
      for (let index = 0; index < 110; index++) {
        const angle = this.random() * Math.PI * 2;
        const speed = 0.8 + this.random() * 4.6;
        const texture = BURST_TEXTURES.dog[index % BURST_TEXTURES.dog.length]!;
        const color = [palette.core, palette.hot, palette.cool, 0xff1f0f][index % 4]!;
        this.spawnParticle(
          x, y, (this.random() - 0.5) * 0.9, color,
          Math.cos(angle) * speed, Math.sin(angle) * speed + 1.4,
          -1.6, 0.55 + this.random() * 0.65, 0.12 + this.random() * 0.12, texture,
        );
      }
      this.spawnFlash(x, y, 0xff2a1a, 1.5, 7.5);
      this.spawnRing(x, y, 0xff1f0f, 0.7, 13);
      this.spawnRing(x, y, 0xff6a00, 0.55, 9);
      this.spawnRing(x, y, 0xffd23f, 0.4, 6);
      for (let index = 0; index < 12; index++) this.spawnBolt(x, y, this.random() * Math.PI * 2, index % 2 === 0 ? 0xff2a1a : 0xffd23f);
      this.shake(0.55);
      return;
    }
    const count = kind === 'volley' ? 40 : 52;
    const textures = BURST_TEXTURES[kind];
    for (let index = 0; index < count; index++) {
      const angle = this.random() * Math.PI * 2;
      const speed = 0.5 + this.random() * (kind === 'cat' ? 3.2 : 2.7);
      const color = [palette.core, palette.hot, palette.cool][index % 3]!;
      this.spawnParticle(
        x, y, (this.random() - 0.5) * 0.5, color,
        Math.cos(angle) * speed, Math.sin(angle) * speed + (kind === 'cat' ? 1.1 : 0.45),
        kind === 'cat' ? -2.2 : 0.8, 0.45 + this.random() * 0.45, 0.085,
        textures[index % textures.length],
      );
    }
    this.spawnFlash(x, y, kind === 'cat' ? 0xff5a1f : kind === 'volley' ? 0xe3c8ff : 0xeaffff);
    this.spawnRing(x, y, palette.ring, 0.5, 7);
    if (kind === 'cat') this.spawnRing(x, y, 0xff3b1f, 0.7, 5);
    if (kind === 'ball' || kind === 'volley') {
      const bolts = kind === 'ball' ? 8 : 7;
      for (let index = 0; index < bolts; index++) this.spawnBolt(x, y, this.random() * Math.PI * 2, palette.cool);
    }
  }

  /** Golden slash burst for a melee knockdown (no projectile involved). */
  knockdown(x: number, y: number): void {
    this.lastEffectKind = null;
    for (let index = 0; index < 30; index++) {
      const angle = this.random() * Math.PI * 2;
      const speed = 0.6 + this.random() * 2.6;
      this.spawnParticle(
        x, y + 0.3, (this.random() - 0.5) * 0.4,
        index % 3 === 0 ? 0xff5a3c : index % 3 === 1 ? 0xffd98b : 0xffffff,
        Math.cos(angle) * speed, Math.sin(angle) * speed + 0.9,
        -1.2, 0.4 + this.random() * 0.35, 0.09,
        index % 2 === 0 ? 'slash_01' : 'spark_04',
      );
    }
    this.spawnFlash(x, y + 0.3, 0xffd98b, 0.8, 4);
    this.spawnRing(x, y + 0.2, 0xffb347, 0.45, 6);
    this.shake(0.22);
  }

  shake(strength: number): void {
    this.shakeTime = Math.max(this.shakeTime, strength);
  }

  private spawnFlash(x: number, y: number, color: number, start = 0.6, growth = 3.2): void {
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.sharedEffects.flash, material);
    mesh.position.set(x, y, 0.18);
    mesh.scale.setScalar(start);
    this.effectRoot.add(mesh);
    this.flashes.push({ mesh, life: 0.28, maxLife: 0.28, start, growth });
  }

  private createProjectileVisual(projectile: FightProjectile): ProjectileVisual {
    const group = new THREE.Group();
    group.name = `fight-projectile-${projectile.skill}-${projectile.id}`;
    const disposables: Array<{ dispose(): void }> = [];
    if (projectile.skill === 'ball') {
      group.add(new THREE.Mesh(this.sharedEffects.ball, this.sharedEffects.ballMaterial));
      group.add(new THREE.Mesh(this.sharedEffects.glow, this.sharedEffects.glowMaterial));
      const fire = new THREE.Mesh(this.sharedEffects.glow, this.sharedEffects.fireGlowMaterial);
      fire.scale.setScalar(1.5);
      group.add(fire);
      const points: THREE.Vector3[] = [];
      for (let index = 0; index < 12; index++) {
        const angle = index / 12 * Math.PI * 2;
        const radius = index % 2 === 0 ? 0.19 : 0.26;
        points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
      }
      const boltGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const boltMaterial = new THREE.LineBasicMaterial({ color: 0xd6f4ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
      group.add(new THREE.LineLoop(boltGeometry, boltMaterial));
      disposables.push(boltGeometry, boltMaterial);
    } else if (projectile.skill === 'cat') {
      const aura = new THREE.Mesh(this.sharedEffects.glow, this.sharedEffects.fireGlowMaterial);
      aura.scale.setScalar(2.6);
      group.add(aura);
      if (this.catTemplate) group.add(this.catTemplate.clone(true));
    } else if (projectile.skill === 'dog') {
      const aura = new THREE.Mesh(this.sharedEffects.glow, this.sharedEffects.fireGlowMaterial);
      aura.scale.setScalar(3.4);
      aura.position.y = 0.5;
      group.add(aura);
      // 狗是蒙皮网格：普通 clone 不会重绑骨架，克隆体会以失控的骨骼矩阵渲染成巨物。
      if (this.dogTemplate) group.add(clone(this.dogTemplate) as THREE.Group);
    } else {
      if (this.cueTemplate) {
        const cue = this.cueTemplate.clone(true);
        cue.scale.setScalar(1.4);
        const points: THREE.Vector3[] = [];
        for (let index = 0; index <= 12; index++) {
          const x = -1.45 + index / 12 * 1.45;
          const wiggle = (index % 2 === 0 ? 0.045 : -0.045);
          points.push(new THREE.Vector3(x, wiggle, index % 3 === 0 ? 0.05 : -0.05));
        }
        const boltGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const boltMaterial = new THREE.LineBasicMaterial({ color: 0xc08cff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
        cue.add(new THREE.Line(boltGeometry, boltMaterial));
        group.add(cue);
        disposables.push(boltGeometry, boltMaterial);
      }
    }
    group.position.set(projectile.x, projectile.y, projectile.z);
    this.projectileRoot?.add(group);
    return { group, kind: projectile.skill, disposables, trailAt: 0, linger: 0 };
  }

  /** 命中事件兜底：若投射物在一帧内完成整段飞行、从未被渲染，就在落点补建滞留模型。 */
  impactLinger(kind: FightSkill, x: number, y: number, projectileId?: number): void {
    if (this.dead || !this.projectileRoot) return;
    if (projectileId !== undefined && this.projectileVisuals.has(projectileId)) return;
    const id = projectileId ?? -(++this.impactFallback);
    if (this.projectileVisuals.has(id)) return;
    const visual = this.createProjectileVisual({
      id, owner: 0, skill: kind, x, y, z: 0, vx: 1, radius: 0, damage: 0, spin: 0, life: 1,
    });
    visual.linger = PROJECTILE_LINGER;
    if (kind === 'dog') visual.group.rotation.y = x < 0 ? Math.PI : 0;
    this.projectileVisuals.set(id, visual);
    this.lingerCount += 1;
  }

  private destroyProjectileVisual(id: number): void {
    const visual = this.projectileVisuals.get(id);
    if (!visual) return;
    this.projectileVisuals.delete(id);
    this.projectileRoot?.remove(visual.group);
    for (const disposable of visual.disposables) disposable.dispose();
  }

  private removeProjectileVisual(id: number): void {
    this.destroyProjectileVisual(id);
  }

  private syncProjectiles(projectiles: readonly FightProjectile[], dt: number): void {
    const live = new Set(projectiles.map(projectile => projectile.id));
    for (const [id, visual] of [...this.projectileVisuals]) {
      if (live.has(id)) continue;
      if (visual.linger <= 0) {
        // 命中/过期不立即删除：留在落点缩小淡出，保证释放物建模清晰可见。
        visual.linger = PROJECTILE_LINGER;
        this.lingerCount += 1;
        continue;
      }
      visual.linger -= dt;
      const t = Math.max(0, visual.linger / PROJECTILE_LINGER);
      visual.group.scale.setScalar(t);
      visual.group.position.y += dt * 0.35;
      if (visual.linger <= 0) this.destroyProjectileVisual(id);
    }
    for (const projectile of projectiles) {
      let visual = this.projectileVisuals.get(projectile.id);
      if (!visual) {
        visual = this.createProjectileVisual(projectile);
        this.projectileVisuals.set(projectile.id, visual);
      }
      visual.group.position.set(projectile.x, projectile.y, projectile.z);
      visual.group.scale.setScalar(1);
      if (projectile.skill === 'cat') {
        visual.group.rotation.y = projectile.spin + (projectile.vx > 0 ? Math.PI / 2 : -Math.PI / 2);
      } else if (projectile.skill === 'dog') {
        // Galloping bob and lean; the template's feet sit at local y=0.
        const gait = Math.sin(projectile.spin * 4);
        visual.group.position.y = projectile.y - 0.5 + Math.abs(gait) * 0.09;
        visual.group.rotation.y = projectile.vx > 0 ? 0 : Math.PI;
        visual.group.rotation.z = gait * 0.05;
      } else if (projectile.skill === 'volley') {
        visual.group.rotation.y = projectile.vx > 0 ? 0 : Math.PI;
      } else {
        visual.group.rotation.z = projectile.spin * 1.7;
      }
    }
  }

  private random(): number {
    this.effectSeed = (this.effectSeed * 1664525 + 1013904223) >>> 0;
    return this.effectSeed / 4294967296;
  }

  private spawnParticle(x: number, y: number, z: number, color: number, vx: number, vy: number, gravity: number, life: number, size: number, texture?: string): void {
    if (this.particles.length > 260) {
      const oldest = this.particles.shift();
      if (oldest) { this.effectRoot.remove(oldest.mesh); oldest.mesh.material.dispose(); }
    }
    const map = texture ? this.particleTextures.get(texture) : undefined;
    const material = new THREE.SpriteMaterial({
      map, color, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
      rotation: this.random() * Math.PI * 2,
    });
    const mesh = new THREE.Sprite(material);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(size * 5);
    this.effectRoot.add(mesh);
    this.particles.push({ mesh, vx, vy, vz: (this.random() - 0.5) * 0.6, life, maxLife: life, gravity, spin: (this.random() - 0.5) * 7 });
  }

  private spawnRing(x: number, y: number, color: number, life: number, growth: number): void {
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.sharedEffects.ring, material);
    mesh.position.set(x, y, 0.12);
    mesh.scale.setScalar(0.9);
    this.effectRoot.add(mesh);
    this.rings.push({ mesh, life, maxLife: life, growth });
  }

  private spawnBolt(x: number, y: number, angle: number, color: number): void {
    const points: THREE.Vector3[] = [];
    const length = 0.6 + this.random() * 0.9;
    const steps = 5;
    for (let index = 0; index <= steps; index++) {
      const radius = length * index / steps;
      const spread = (this.random() - 0.5) * 0.16;
      points.push(new THREE.Vector3(
        x + Math.cos(angle) * radius - Math.sin(angle) * spread,
        y + Math.sin(angle) * radius + Math.cos(angle) * spread,
        0.14,
      ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending });
    const object = new THREE.Line(geometry, material);
    this.effectRoot.add(object);
    this.effectLines.push({ object, life: 0.28, maxLife: 0.28 });
  }

  private emitTrails(dt: number): void {
    for (const visual of this.projectileVisuals.values()) {
      visual.trailAt -= dt;
      if (visual.trailAt > 0) continue;
      visual.trailAt = visual.kind === 'dog' ? 0.018 : 0.03;
      const palette = SKILL_PALETTES[visual.kind];
      const position = visual.group.position;
      const color = visual.kind === 'cat' || visual.kind === 'dog'
        ? this.random() < 0.7 ? palette.hot : palette.cool
        : this.random() < 0.5 ? palette.cool : palette.hot;
      const spread = visual.kind === 'cat' ? 0.3 : visual.kind === 'dog' ? 0.4 : 0.12;
      this.spawnParticle(
        position.x + (this.random() - 0.5) * spread,
        position.y + (this.random() - 0.5) * spread,
        position.z + (this.random() - 0.5) * 0.12,
        color, (this.random() - 0.5) * 0.6, (this.random() - 0.5) * 0.5 + 0.2,
        visual.kind === 'dog' ? -0.6 : 0, 0.22 + this.random() * 0.26,
        visual.kind === 'cat' ? 0.065 : visual.kind === 'dog' ? 0.1 : 0.042,
        TRAIL_TEXTURES[visual.kind],
      );
      if (visual.kind === 'dog' && this.random() < 0.5) {
        this.spawnParticle(
          position.x + (this.random() - 0.5) * 0.5, position.y + 0.2 + this.random() * 0.3, position.z,
          0x5a4a42, (this.random() - 0.5) * 0.4, 0.5 + this.random() * 0.4,
          0.2, 0.4 + this.random() * 0.3, 0.12, 'smoke_08',
        );
      }
    }
  }

  private updateEffects(dt: number): void {
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const particle = this.particles[index]!;
      particle.life -= dt;
      if (particle.life <= 0) {
        this.effectRoot.remove(particle.mesh);
        (particle.mesh.material as THREE.Material).dispose();
        this.particles.splice(index, 1);
        continue;
      }
      particle.mesh.position.x += particle.vx * dt;
      particle.mesh.position.y += particle.vy * dt;
      particle.mesh.position.z += particle.vz * dt;
      particle.vy += particle.gravity * dt;
      particle.mesh.material.opacity = Math.max(0, particle.life / particle.maxLife);
      particle.mesh.material.rotation += particle.spin * dt;
    }
    for (let index = this.rings.length - 1; index >= 0; index--) {
      const ring = this.rings[index]!;
      ring.life -= dt;
      if (ring.life <= 0) {
        this.effectRoot.remove(ring.mesh);
        (ring.mesh.material as THREE.Material).dispose();
        this.rings.splice(index, 1);
        continue;
      }
      const progress = 1 - ring.life / ring.maxLife;
      ring.mesh.scale.setScalar(0.9 + progress * ring.growth);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.95;
    }
    for (let index = this.effectLines.length - 1; index >= 0; index--) {
      const line = this.effectLines[index]!;
      line.life -= dt;
      if (line.life <= 0) {
        this.effectRoot.remove(line.object);
        line.object.geometry.dispose();
        (line.object.material as THREE.Material).dispose();
        this.effectLines.splice(index, 1);
        continue;
      }
      (line.object.material as THREE.LineBasicMaterial).opacity = line.life / line.maxLife;
    }
    for (let index = this.flashes.length - 1; index >= 0; index--) {
      const flash = this.flashes[index]!;
      flash.life -= dt;
      if (flash.life <= 0) {
        this.effectRoot.remove(flash.mesh);
        (flash.mesh.material as THREE.Material).dispose();
        this.flashes.splice(index, 1);
        continue;
      }
      const progress = 1 - flash.life / flash.maxLife;
      flash.mesh.scale.setScalar(flash.start + progress * flash.growth);
      (flash.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.9;
    }
  }

  private clearProjectiles(): void {
    for (const id of [...this.projectileVisuals.keys()]) this.removeProjectileVisual(id);
  }

  private clearTransient(): void {
    this.clearProjectiles();
    for (const particle of this.particles) {
      this.effectRoot.remove(particle.mesh);
      (particle.mesh.material as THREE.Material).dispose();
    }
    for (const ring of this.rings) {
      this.effectRoot.remove(ring.mesh);
      (ring.mesh.material as THREE.Material).dispose();
    }
    for (const line of this.effectLines) {
      this.effectRoot.remove(line.object);
      line.object.geometry.dispose();
      (line.object.material as THREE.Material).dispose();
    }
    for (const flash of this.flashes) {
      this.effectRoot.remove(flash.mesh);
      (flash.mesh.material as THREE.Material).dispose();
    }
    this.particles.length = 0;
    this.rings.length = 0;
    this.effectLines.length = 0;
    this.flashes.length = 0;
    this.bows.forEach(bow => { bow.visible = false; });
    this.lastEffectKind = null;
    this.effectSeed = 0x1a2b3c4d;
  }

  resize(): void {
    if (this.dead) return;
    const width = Math.max(1, this.host.clientWidth); const height = Math.max(1, this.host.clientHeight);
    this.aspect = width / height; this.renderer.setSize(width, height, false);
  }

  render(
    fighters: [FighterState, FighterState], projectiles: readonly FightProjectile[],
    dt: number, preview: FightAction | null, previewTime: number, mirrored: boolean,
  ): void {
    if (this.dead || this.actors.length !== 2) return;
    this.actors.forEach((actor, index) => {
      const state = fighters[index]!;
      actor.root.position.set(preview ? (index === 0 ? -1.25 : 1.25) : state.x, preview ? 0 : state.y, 0);
      // The rules freeze at round end; finish only the cosmetic fall on a separate clock.
      this.koTimes[index] = !preview && state.action === 'ko' ? Math.min(0.65, this.koTimes[index]! + dt) : 0;
      const actionTime = state.action === 'ko' ? this.koTimes[index]! : state.actionTime;
      const facing = preview ? index === 0 ? 1 : -1 : state.facing;
      actor.update(preview ?? state.action, preview ? previewTime : actionTime, dt, facing, index === 1 && mirrored, !!preview, state.downDuration);
      const bow = this.bows[index];
      if (bow) {
        const active = preview ? preview === 'skillVolley' : state.action === 'skillVolley';
        bow.visible = active;
        if (active && this.combatRoot) {
          const hand = actor.root.getObjectByName('hand_l');
          if (hand) {
            hand.getWorldPosition(this.tempVector);
            this.combatRoot.worldToLocal(this.tempVector);
            bow.position.copy(this.tempVector);
            bow.rotation.set(0, facing === 1 ? 0 : Math.PI, 0);
          }
        }
      }
    });
    if (!preview) {
      this.syncProjectiles(projectiles, dt);
      this.emitTrails(dt);
    } else {
      this.clearProjectiles();
    }
    this.updateEffects(dt);
    if (this.projectileRoot) this.projectileRoot.visible = !preview;
    this.effectRoot.visible = !preview;
    const frame = tabletopCameraFrame(this.aspect, fighters[0].x, fighters[1].x, !!preview);
    const t = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 5);
    this.frameWidth += (frame.width - this.frameWidth) * t;
    this.centerX += (frame.centerX - this.centerX) * t;
    const height = Math.max(1.7, this.frameWidth / this.aspect);
    const width = height * this.aspect;
    this.camera.left = -width / 2; this.camera.right = width / 2; this.camera.top = height / 2; this.camera.bottom = -height / 2;
    // Raised side view shows the cloth and pockets, without the near cushion hiding small feet.
    this.camera.position.set(this.centerX, frame.targetY + 1.36, 3.4);
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    if (this.shakeTime > 0 && !this.reducedMotion && !preview) {
      this.camera.position.x += (this.random() - 0.5) * this.shakeTime * 0.22;
      this.camera.position.y += (this.random() - 0.5) * this.shakeTime * 0.16;
    }
    this.camera.lookAt(this.centerX, frame.targetY, 0); this.camera.updateProjectionMatrix();
    this.feedback = Math.max(0, this.feedback - dt);
    this.spark.visible = this.feedback > 0 && !preview;
    if (this.spark.visible) {
      const f = fighters[this.feedbackSeat]; this.spark.position.set(f.x, f.y + 1.1, 0.5);
      this.spark.scale.setScalar(1 + (0.18 - this.feedback) * 5);
      (this.spark.material as THREE.MeshBasicMaterial).opacity = this.feedback / 0.18;
    }
    this.renderer.render(this.scene, this.camera);
  }

  getDebug() {
    let ballCount = 0;
    this.scene.traverse(object => { if (object instanceof THREE.Mesh && Number.isInteger(object.userData.ballId)) ballCount++; });
    return {
      motionCount: this.motionCount, koTimes: [...this.koTimes], actorCount: this.actors.length,
      characterAssignment: [...this.characterAssignment],
      actors: this.actors.map(actor => actor.getDebug()),
      arena: {
        table: this.arena?.table.name ?? null, room: this.arena?.room.name ?? null,
        ballCount, surfaceY: this.arena?.surfaceY ?? FIGHT_SURFACE_Y, fighterScale: FIGHT_WORLD_SCALE, bounds: TABLETOP_BOUNDS,
        fighterPositions: this.actors.map(actor => actor.root.getWorldPosition(new THREE.Vector3()).toArray()),
        fighterScales: this.actors.map(actor => actor.root.getWorldScale(new THREE.Vector3()).toArray()),
      },
      skills: {
        catLoaded: this.catTemplate !== null,
        dogLoaded: this.dogTemplate !== null,
        particleTextures: this.particleTextures.size,
        seatLabels: this.labelSprites.length,
        projectiles: [...this.projectileVisuals.values()].filter(visual => visual.linger <= 0).length,
        lingering: [...this.projectileVisuals.values()].filter(visual => visual.linger > 0).length,
        lingered: this.lingerCount,
        particles: this.particles.length,
        rings: this.rings.length,
        lines: this.effectLines.length,
        flashes: this.flashes.length,
        lastKind: this.lastEffectKind,
        bows: this.bows.map(bow => bow.visible),
      },
      renderer: { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles },
    };
  }

  private releaseObjects(): void {
    const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>(); const textures = new Set<THREE.Texture>();
    for (const root of [this.scene, ...this.loaded]) root.traverse(object => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    this.loaded = [];
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.resizeObserver.disconnect();
    this.clearTransient();
    for (const label of this.labelSprites) {
      label.material.map?.dispose();
      label.material.dispose();
      label.removeFromParent();
    }
    this.labelSprites.length = 0;
    this.particleTextures.forEach(texture => texture.dispose());
    this.particleTextures.clear();
    this.releaseObjects();
    this.sharedEffects.ring.dispose();
    this.sharedEffects.ball.dispose();
    this.sharedEffects.ballMaterial.dispose();
    this.sharedEffects.glow.dispose();
    this.sharedEffects.glowMaterial.dispose();
    this.sharedEffects.fireGlowMaterial.dispose();
    this.sharedEffects.flash.dispose();
    this.scene.environment = null;
    this.environmentMap?.dispose(); this.environmentMap = null;
    this.scene.traverse(object => { if (object instanceof THREE.Light && 'shadow' in object) (object as THREE.DirectionalLight).shadow?.dispose(); });
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
