import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BALL_RADIUS, CUSHION_HALF_X, CUSHION_HALF_Y, FIXED_DT, TABLE_HALF_X, TABLE_HALF_Y, POCKETS, type SimulationState, type Vec2 } from '../sim/SimulationState';
import { HEAD_STRING_X } from '../rules/placement';
import { cameraInOverheadVolume, CameraController, type CameraAdjustment, type CameraMode, type CameraPhase } from './CameraController';
import { HairdryerEffect } from './HairdryerEffect';
import { AssetLoader } from './assets/AssetLoader';
import { createBallContactShadow, createReferenceBall } from './ReferenceBall';
import { createReferenceCue } from './ReferenceCue';
import { installReferenceTable, type TableFit } from './ReferenceTable';
import { createTraditionalLamp, installTraditionalTable, type TraditionalTableFit } from './TraditionalTable';
import { computeCuePose, createCueStick } from './CueStick';
import { createSittingRoom, TABLE_BED_Y as BED_Y, TABLE_WORLD_SCALE as WORLD_SCALE } from './SittingRoom';

const BALL_Y = BED_Y + BALL_RADIUS;

export class SceneView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(43, 1, 0.01, 80);
  readonly renderer: THREE.WebGLRenderer;
  readonly cameraController: CameraController;
  reducedMotion = false;
  lowQuality = false;
  private world = new THREE.Group();
  private ballMeshes = new Map<number, THREE.Mesh>();
  private ballShadows = new Map<number, THREE.Mesh>();
  private lastBallPositions = new Map<number, THREE.Vector3>();
  private lastSimStep = 0;
  private ballOverrides = new Map<number, Vec2>();
  private cancelHandAnimation: (() => void) | null = null;
  private referenceTableFit: TableFit | null = null;
  private traditionalFit: TraditionalTableFit | null = null;
  private roomBackground = false;
  private room = new THREE.Group();
  private sittingRoom: THREE.Group | null = null;
  private roomCeiling: THREE.Mesh | null = null;
  private lampGroup = new THREE.Group();
  private lampBounds = new THREE.Box3();
  private ceilingBounds = new THREE.Box3();
  private hemiLight = new THREE.HemisphereLight(0xdde5df, 0x211d19, 0.88);
  private keyLight = new THREE.DirectionalLight(0xfff1d9, 1.55);
  private shadowFloor!: THREE.Mesh;
  private environmentMap: THREE.WebGLRenderTarget | null = null;
  private placementCursor: THREE.Group | null = null;
  private tableVisual = new THREE.Group();
  private hairdryer = new HairdryerEffect();
  private hairdryerBall: number | null = null;
  private cue = new THREE.Group();
  private aimLine: THREE.Line;
  private targetLine: THREE.Line;
  private ghostRing: THREE.LineLoop;
  private deflectionLine: THREE.Line;
  private breakLine: THREE.Line;
  private authoritativePositions = new Map<number, Vec2>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BED_Y * WORLD_SCALE);
  private disposed = false;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.id = 'game-canvas';
    this.renderer.domElement.setAttribute('aria-label', '三维台球桌，移动鼠标微调瞄准，点击球桌设定方向');
    container.appendChild(this.renderer.domElement);
    const context = this.renderer.getContext();
    const rendererInfo = context.getExtension('WEBGL_debug_renderer_info');
    const rendererName = rendererInfo ? String(context.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)) : '';
    this.setQuality(/swiftshader|llvmpipe|software/i.test(rendererName));
    this.scene.background = new THREE.Color(0x07110f);
    this.scene.fog = new THREE.Fog(0x07110f, 7, 20);
    this.world.scale.setScalar(WORLD_SCALE);
    this.scene.add(this.world);
    this.cameraController = new CameraController(this.camera, WORLD_SCALE);
    this.buildRoom();
    this.updateOverheadBounds();
    this.buildTable();
    this.buildBalls();
    this.buildCue();
    this.hairdryer.addTo(this.world);
    const aimGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
    this.aimLine = new THREE.Line(aimGeometry, new THREE.LineDashedMaterial({ color: 0xe9ffdc, dashSize: 0.07, gapSize: 0.04, transparent: true, opacity: 0.8 }));
    this.aimLine.computeLineDistances();
    this.aimLine.visible = false;
    this.world.add(this.aimLine);
    // Short amber guide showing where the struck object ball will travel.
    const targetGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
    this.targetLine = new THREE.Line(targetGeometry, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95 }));
    this.targetLine.name = 'target-line';
    this.targetLine.visible = false;
    this.world.add(this.targetLine);
    // Poolians-style ghost ball: a ring at the exact contact position the cue
    // ball must reach, plus a short tangent line showing the cue's deflection.
    // 第九轮：两条方向预测线缩短（目标 0.12m / 偏转 0.08m），降低进球提示强度；
    // 瞄准线与幽灵圈保留（瞄准辅助，不预测结果）。
    const ghostPoints: THREE.Vector3[] = [];
    for (let i = 0; i < 40; i += 1) {
      const a = (i / 40) * Math.PI * 2;
      ghostPoints.push(new THREE.Vector3(Math.cos(a) * BALL_RADIUS, 0, Math.sin(a) * BALL_RADIUS));
    }
    this.ghostRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ghostPoints),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    this.ghostRing.name = 'ghost-ball';
    this.ghostRing.visible = false;
    this.world.add(this.ghostRing);
    const deflectionGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
    this.deflectionLine = new THREE.Line(deflectionGeometry, new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.85 }));
    this.deflectionLine.name = 'deflection-line';
    this.deflectionLine.visible = false;
    this.world.add(this.deflectionLine);
    // Head string marking the kitchen for break placement.
    const breakGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(HEAD_STRING_X, BED_Y + 0.002, -CUSHION_HALF_Y),
      new THREE.Vector3(HEAD_STRING_X, BED_Y + 0.002, CUSHION_HALF_Y),
    ]);
    this.breakLine = new THREE.Line(breakGeometry, new THREE.LineBasicMaterial({ color: 0xc98a3d, transparent: true, opacity: 0.7 }));
    this.breakLine.name = 'break-line';
    this.breakLine.visible = false;
    this.world.add(this.breakLine);
    this.resize();
    void this.loadExternalAssets();
  }

  private buildRoom(): void {
    this.scene.add(this.hemiLight);
    const key = this.keyLight;
    key.position.set(-2.6, 6.5, 3.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    this.scene.add(key);
    // Shadow catcher stays visible even when the cafe HDRI replaces the room.
    this.shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(18, 16), new THREE.ShadowMaterial({ opacity: 0.34 }));
    this.shadowFloor.rotation.x = -Math.PI / 2;
    this.shadowFloor.receiveShadow = true;
    this.scene.add(this.shadowFloor);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 16), new THREE.MeshStandardMaterial({ color: 0x1b2422, roughness: 0.83 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.room.add(floor);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 4.8), new THREE.MeshStandardMaterial({ color: 0x173b33, roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.004;
    rug.receiveShadow = true;
    this.room.add(rug);
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x20332e, roughness: 0.94 });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), wallMaterial);
    backWall.position.set(0, 2.5, -4.8);
    this.room.add(backWall);
    for (let i = -2; i <= 2; i++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.6, 0.05), new THREE.MeshStandardMaterial({ color: 0x355148 }));
      panel.position.set(i * 1.5, 2.0, -4.77);
      this.room.add(panel);
    }
    const shelf = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x604331, roughness: 0.75 });
    for (const y of [0.65, 1.15, 1.65]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.3), wood);
      board.position.y = y;
      shelf.add(board);
    }
    shelf.position.set(3.6, 0, -4.5);
    this.room.add(shelf);
    for (let i = 0; i < 8; i++) {
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.28 + (i % 3) * 0.04, 0.18), new THREE.MeshStandardMaterial({ color: [0x97684a, 0x406f67, 0xb28a45][i % 3] }));
      book.position.set(3.15 + i * 0.1, 0.84, -4.46);
      this.room.add(book);
    }
    const sign = this.makeTextPanel('库边秘技', 'CREATIVE 8-BALL');
    sign.position.set(-3.2, 2.3, -4.72);
    this.room.add(sign);
    this.scene.add(this.room);
    // Procedural hanging lamps live in the scaled world group; replaced by the
    // traditional GLB lamp when it loads, hidden in top view to avoid clipping.
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0x174f43, emissive: 0x0a261f, roughness: 0.4 });
    for (const x of [-0.66, 0.66]) {
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.34, 0.13, 24, 1, true), lampMaterial);
      shade.position.set(x, 1.9, 0);
      this.lampGroup.add(shade);
      const light = new THREE.PointLight(0xffe3bc, 3.2, 7, 2);
      light.position.set(x, 1.81, 0);
      this.lampGroup.add(light);
    }
    this.world.add(this.lampGroup);
  }

  private makeTextPanel(title: string, subtitle: string): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 256;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#0c1c18'; context.fillRect(0, 0, 512, 256);
    context.strokeStyle = '#c9a86a'; context.lineWidth = 4; context.strokeRect(12, 12, 488, 232);
    context.fillStyle = '#e8d7ae'; context.font = 'bold 76px serif'; context.textAlign = 'center'; context.fillText(title, 256, 125);
    context.fillStyle = '#75a699'; context.font = '24px sans-serif'; context.fillText(subtitle, 256, 182);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.62), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65 }));
  }

  private buildTable(): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x593924, roughness: 0.48, metalness: 0.05 });
    const cushion = new THREE.MeshStandardMaterial({ color: 0x155f4b, roughness: 0.85 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x16745a, roughness: 0.96 });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(TABLE_HALF_X * 2 + 0.13, 0.08, TABLE_HALF_Y * 2 + 0.13), cloth);
    bed.position.y = BED_Y - 0.04;
    bed.receiveShadow = true;
    this.tableVisual.add(bed);
    for (const x of [-TABLE_HALF_X - 0.09, TABLE_HALF_X + 0.09]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.15, TABLE_HALF_Y * 2 + 0.34), wood);
      rail.position.set(x, BED_Y, 0);
      rail.castShadow = true;
      this.tableVisual.add(rail);
    }
    for (const z of [-TABLE_HALF_Y - 0.09, TABLE_HALF_Y + 0.09]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(TABLE_HALF_X * 2 + 0.34, 0.15, 0.16), wood);
      rail.position.set(0, BED_Y, z);
      rail.castShadow = true;
      this.tableVisual.add(rail);
    }
    for (const x of [-1.05, 1.05]) for (const z of [-0.48, 0.48]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.72, 0.15), wood);
      leg.position.set(x, 0.37, z);
      leg.castShadow = true;
      leg.userData.keepWithReferenceTable = true;
      this.tableVisual.add(leg);
    }
    for (const pocket of POCKETS) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.077, 0.065, 0.035, 24), new THREE.MeshStandardMaterial({ color: 0x020504, roughness: 1 }));
      hole.position.set(pocket.position.x, BED_Y + 0.012, pocket.position.y);
      this.tableVisual.add(hole);
    }
    // Fallback cushion noses align with the measured playfield boundary so the
    // grey-box table never lets balls visibly penetrate the rails.
    for (const z of [-CUSHION_HALF_Y - 0.0275, CUSHION_HALF_Y + 0.0275]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(TABLE_HALF_X * 2 - 0.18, 0.065, 0.055), cushion);
      strip.position.set(0, BED_Y + 0.025, z);
      this.tableVisual.add(strip);
    }
    for (const x of [-CUSHION_HALF_X - 0.0275, CUSHION_HALF_X + 0.0275]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.065, TABLE_HALF_Y * 2 - 0.18), cushion);
      strip.position.set(x, BED_Y + 0.025, 0);
      this.tableVisual.add(strip);
    }
    this.world.add(this.tableVisual);
  }

  private buildBalls(): void {
    for (let id = 0; id <= 15; id++) {
      const ball = createReferenceBall(id, BALL_RADIUS, this.lowQuality);
      ball.userData.ballId = id;
      ball.visible = false;
      const shadow = createBallContactShadow(BALL_RADIUS);
      shadow.visible = false;
      this.ballMeshes.set(id, ball);
      this.ballShadows.set(id, shadow);
      this.world.add(ball, shadow);
    }
  }

  private buildCue(): void {
    this.cue = createReferenceCue();
    this.world.add(this.cue);
  }

  private async loadExternalAssets(): Promise<void> {
    const loader = new AssetLoader();
    await loader.loadManifest();
    const [hairdryer, traditional, cueStick] = await Promise.all([
      loader.loadOptional('hairdryer'),
      loader.loadGltf('/assets/models/pool-table-traditional.glb'),
      loader.loadGltf('/assets/models/cc0_-_cue_stick.glb'),
    ]);
    if (this.disposed) return;
    if (hairdryer) this.hairdryer.setModel(hairdryer);
    if (cueStick) {
      const stick = createCueStick(cueStick);
      if (stick) {
        this.disposeChildren(this.cue);
        this.cue.add(stick);
      }
      // Baked clones own the geometry now; release the source meshes but keep
      // their materials/textures alive because the stick reuses them.
      cueStick.traverse(child => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
    }
    let traditionalInstalled = false;
    if (traditional) {
      // Extract the lamp before the table wrapper reparents/scales the model.
      const lamp = createTraditionalLamp(traditional, 1.62, 2.42);
      try {
        const { group, fit } = installTraditionalTable(traditional, BED_Y);
        this.tableVisual.visible = false;
        this.world.add(group);
        this.traditionalFit = fit;
        traditionalInstalled = true;
        if (lamp) {
          this.disposeChildren(this.lampGroup);
          this.lampGroup.add(lamp);
          this.updateOverheadBounds();
        }
      } catch (error) {
        console.warn('Traditional table could not be measured; keeping the reference table.', error);
      }
    }
    if (!traditionalInstalled) {
      const table = await loader.loadOptional('table');
      if (this.disposed) return;
      if (table) {
        try {
          this.installTable(table);
        } catch (error) {
          console.warn('Reference table could not be installed; keeping the local fallback.', error);
        }
      }
    }
    await this.loadSittingRoom();
    if (this.disposed) return;

    // Procedural furniture only furnishes the fallback room; the baked sitting
    // room ships its own sofas and tables.
    if (!this.roomBackground) {
      const furnitureSpecs = [
        { path: '/assets/furniture/loungeSofa.obj', height: 0.78, position: new THREE.Vector3(-3.4, 0, -3.3), rotation: 0.2 },
        { path: '/assets/furniture/chair.obj', height: 0.92, position: new THREE.Vector3(3.4, 0, 2.5), rotation: -0.7 },
        { path: '/assets/furniture/lampRoundFloor.obj', height: 1.65, position: new THREE.Vector3(-3.7, 0, -3.6), rotation: 0 },
      ];
      const furniture = await Promise.all(furnitureSpecs.map(spec => loader.loadObj(spec.path)));
      if (this.disposed) return;
      furniture.forEach((model, index) => {
        if (!model) return;
        const spec = furnitureSpecs[index]!;
        this.normalizeProp(model, spec.height);
        model.position.add(spec.position);
        model.rotation.y = spec.rotation;
        this.room.add(model);
      });
    }
  }

  /** The supplied sitting-room GLB becomes the play environment. Its root node
   * already bakes the Z-up authoring basis into Y-up metres, so no extra
   * rotation is needed: the floor plane sits at y=0 and the shell is centred on
   * the table. The baked coffee table standing in the playfield is culled, and
   * the ceiling is split into its own mesh so the top camera can hide it.
   * Baked textures are shown unlit (MeshBasicMaterial); table/balls/cue keep
   * their PBR materials lit by the key light plus a neutral PMREM environment. */
  private async loadSittingRoom(): Promise<void> {
    try {
      const model = await new AssetLoader().loadGltf('/assets/models/sitting_room_with_baked_textures.glb');
      if (!model) throw new Error('sitting room GLB missing');
      if (this.disposed) return;
      const { group, ceiling } = createSittingRoom(model);
      this.scene.add(group);
      this.sittingRoom = group;
      this.roomCeiling = ceiling;
      this.updateOverheadBounds();
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const roomEnvironment = new RoomEnvironment();
      const environment = pmrem.fromScene(roomEnvironment, 0.04);
      pmrem.dispose();
      roomEnvironment.dispose();
      if (this.disposed) { environment.dispose(); return; }
      this.environmentMap = environment;
      this.scene.environment = environment.texture;
      this.scene.environmentIntensity = 0.5;
      this.scene.background = new THREE.Color(0xf2ead9);
      this.scene.fog = new THREE.Fog(0xf2ead9, 12, 26);
      this.room.visible = false;
      // Shadow catcher floats 4 mm above the baked floor to avoid z-fighting.
      this.shadowFloor.position.y = 0.004;
      this.hemiLight.intensity = 0.62;
      this.keyLight.intensity = 1.25;
      this.roomBackground = true;
    } catch (error) {
      console.warn('Sitting room unavailable; keeping the procedural room.', error);
    }
  }

  private disposeChildren(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach(material => material?.dispose());
        }
      });
    }
  }

  private installTable(model: THREE.Group): void {
    this.referenceTableFit = installReferenceTable(model, BED_Y, TABLE_HALF_X, TABLE_HALF_Y);
    this.tableVisual.children.forEach(child => {
      child.visible = child.userData.keepWithReferenceTable === true;
    });
    this.world.add(model);
  }

  private normalizeProp(model: THREE.Group, targetHeight: number): void {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(targetHeight / Math.max(size.y, 0.001));
    const scaled = new THREE.Box3().setFromObject(model);
    const center = scaled.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -scaled.min.y, -center.z);
  }

  syncSimulation(state: SimulationState): void {
    // Presentation-only rotation: drive each mesh from its authoritative angular
    // velocity so follow, draw and side spin are actually visible on the cloth.
    // Table (x, y, z-up) maps to world (x, z, y-up).
    const advanced = Math.max(0, Math.min(state.step - this.lastSimStep, 32));
    this.lastSimStep = state.step;
    const spinDt = advanced * FIXED_DT;
    for (const ball of state.balls) {
      const mesh = this.ballMeshes.get(ball.id);
      const shadow = this.ballShadows.get(ball.id);
      if (!mesh) continue;
      mesh.visible = ball.onTable && !ball.pocketed;
      this.authoritativePositions.set(ball.id, { x: ball.position.x, y: ball.position.y });
      const position = this.ballOverrides.get(ball.id) ?? ball.position;
      const previous = this.lastBallPositions.get(ball.id);
      const next = new THREE.Vector3(position.x, BALL_Y, position.y);
      if (previous && ball.motion !== 'stationary') {
        const spin = ball.angularVelocity;
        const spinRate = Math.hypot(spin.x, spin.y, spin.z);
        const delta = next.clone().sub(previous);
        const travel = Math.hypot(delta.x, delta.z);
        if (spinDt > 0 && spinRate > 1e-4) {
          const axis = new THREE.Vector3(spin.x, spin.z, spin.y).normalize();
          mesh.rotateOnWorldAxis(axis, Math.min(spinRate * spinDt, Math.PI));
        } else if (travel > 1e-7 && travel < 0.2) {
          // Fallback for debug/skill edits that zero the spin: roll by travel.
          const axis = new THREE.Vector3(-delta.z, 0, delta.x).normalize();
          mesh.rotateOnWorldAxis(axis, travel / BALL_RADIUS);
        }
      }
      mesh.position.copy(next);
      this.lastBallPositions.set(ball.id, next);
      if (shadow) {
        shadow.visible = mesh.visible;
        shadow.position.set(next.x, BED_Y + 0.0006, next.z);
      }
      const braking = state.braking.some(effect => effect.ballId === ball.id);
      if (this.hairdryerBall === ball.id && !braking) this.hairdryerBall = null;
    }
  }

  setAim(angle: number, power: number, visible: boolean, charging = false, spin: { x: number; y: number } = { x: 0, y: 0 }): void {
    const cueBall = this.ballMeshes.get(0);
    if (!cueBall) return;
    this.aimLine.visible = visible && cueBall.visible;
    this.targetLine.visible = false;
    this.ghostRing.visible = false;
    this.deflectionLine.visible = false;
    this.cue.visible = visible && cueBall.visible;
    // The camera lives in world space; the cue ball position is local to the
    // scaled world group, so convert before framing the first-person view.
    this.cameraController.setAim(angle, cueBall.position.clone().multiplyScalar(WORLD_SCALE));
    if (!visible) return;
    const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const start = cueBall.position.clone().add(new THREE.Vector3(0, -BALL_RADIUS * 0.15, 0));
    // Poolians-style: stop the dashed aim line at the exact ghost-ball contact
    // point (not a fixed cushion clamp), ring that point, then show the object
    // ball's travel direction and the cue ball's tangent deflection.
    const hit = this.firstAimHit(start, direction);
    const reach = hit ? Math.max(0.02, hit.t) : this.aimReach(start, direction);
    const end = start.clone().add(direction.clone().multiplyScalar(reach));
    const positions = this.aimLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, start.x, start.y, start.z);
    positions.setXYZ(1, end.x, end.y, end.z);
    positions.needsUpdate = true;
    this.aimLine.computeLineDistances();
    if (hit) {
      const ghost = end;
      this.ghostRing.position.copy(ghost);
      this.ghostRing.visible = true;
      const objectDirection = new THREE.Vector3(hit.centre.x - ghost.x, 0, hit.centre.z - ghost.z);
      if (objectDirection.lengthSq() > 1e-12) {
        objectDirection.normalize();
        // Hover just above the ball tops so the guide stays readable in the
        // top-down view instead of being hidden inside the object ball/rack.
        const from = new THREE.Vector3(hit.centre.x, hit.centre.y + BALL_RADIUS * 1.05, hit.centre.z);
        const to = from.clone().addScaledVector(objectDirection, 0.12);
        const targetPositions = this.targetLine.geometry.getAttribute('position') as THREE.BufferAttribute;
        targetPositions.setXYZ(0, from.x, from.y, from.z);
        targetPositions.setXYZ(1, to.x, to.y, to.z);
        targetPositions.needsUpdate = true;
        this.targetLine.visible = true;
        // Cue deflection: the component of the aim direction perpendicular to
        // the impact normal (equal-mass collision tangent), drawn from ghost.
        const tangent = direction.clone().addScaledVector(objectDirection, -direction.dot(objectDirection));
        if (tangent.lengthSq() > 1e-8) {
          tangent.normalize();
          const defTo = ghost.clone().addScaledVector(tangent, 0.08);
          const defPositions = this.deflectionLine.geometry.getAttribute('position') as THREE.BufferAttribute;
          defPositions.setXYZ(0, ghost.x, ghost.y, ghost.z);
          defPositions.setXYZ(1, defTo.x, defTo.y, defTo.z);
          defPositions.needsUpdate = true;
          this.deflectionLine.visible = true;
        }
      }
    }
    // Elevated cue whose axis passes through the ball centre; the tilt and gap
    // are computed so the shaft clears the rail cap (no ball/rail penetration).
    const pose = computeCuePose(cueBall.position.x, cueBall.position.z, angle, power, charging);
    // Round 8: the shaft stays parallel to the aim line but its tip sits on the
    // exact contact point chosen in the spin panel (half a radius at the edge),
    // so what the player clicks is what the cue visibly strikes.
    const tipSide = Math.max(-1, Math.min(1, spin.x)) * BALL_RADIUS * 0.5;
    const tipLift = Math.max(-1, Math.min(1, spin.y)) * BALL_RADIUS * 0.5;
    this.cue.position.set(
      pose.x - Math.sin(angle) * tipSide,
      pose.y + tipLift,
      pose.z + Math.cos(angle) * tipSide,
    );
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
    const tiltQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pose.tilt);
    this.cue.quaternion.copy(yawQuat).multiply(tiltQuat);
  }

  /** Stop the aim guide at the cushion nose instead of drawing through the rail. */
  private aimReach(start: THREE.Vector3, direction: THREE.Vector3): number {
    const halfX = CUSHION_HALF_X - BALL_RADIUS;
    const halfZ = CUSHION_HALF_Y - BALL_RADIUS;
    const tx = direction.x > 1e-6 ? (halfX - start.x) / direction.x
      : direction.x < -1e-6 ? (-halfX - start.x) / direction.x : Infinity;
    const tz = direction.z > 1e-6 ? (halfZ - start.z) / direction.z
      : direction.z < -1e-6 ? (-halfZ - start.z) / direction.z : Infinity;
    return THREE.MathUtils.clamp(Math.min(tx, tz), 0.06, 3);
  }

  /** First object ball the aim ray would contact, via ghost-circle intersection. */
  private firstAimHit(start: THREE.Vector3, direction: THREE.Vector3): { centre: THREE.Vector3; t: number } | null {
    const radiusSquared = (BALL_RADIUS * 2) ** 2;
    let best: { centre: THREE.Vector3; t: number } | null = null;
    for (const [id, mesh] of this.ballMeshes) {
      if (id === 0 || !mesh.visible) continue;
      const relX = mesh.position.x - start.x;
      const relZ = mesh.position.z - start.z;
      const along = relX * direction.x + relZ * direction.z;
      if (along <= 0) continue;
      const perpendicularSquared = relX * relX + relZ * relZ - along * along;
      if (perpendicularSquared > radiusSquared) continue;
      const t = along - Math.sqrt(radiusSquared - perpendicularSquared);
      if (t < 0) continue;
      if (best === null || t < best.t) best = { centre: mesh.position.clone(), t };
    }
    return best;
  }

  /** Presentation-only cue-ball preview while dragging a placement cursor.
   * Pass null to restore the authoritative position; never mutates simulation. */
  previewBallPosition(ballId: number, position: Vec2 | null): void {
    const mesh = this.ballMeshes.get(ballId);
    if (!mesh) return;
    const shadow = this.ballShadows.get(ballId);
    if (position) {
      this.ballOverrides.set(ballId, position);
      mesh.position.set(position.x, BALL_Y, position.y);
      shadow?.position.set(position.x, BED_Y + 0.0006, position.y);
      this.lastBallPositions.set(ballId, mesh.position.clone());
    } else if (this.ballOverrides.has(ballId)) {
      this.ballOverrides.delete(ballId);
      const authoritative = this.authoritativePositions.get(ballId);
      if (authoritative) {
        mesh.position.set(authoritative.x, BALL_Y, authoritative.y);
        shadow?.position.set(authoritative.x, BED_Y + 0.0006, authoritative.y);
        this.lastBallPositions.set(ballId, mesh.position.clone());
      }
    }
  }

  setBreakLine(visible: boolean): void { this.breakLine.visible = visible; }

  getBallPosition(ballId: number): Vec2 | null {
    const mesh = this.ballMeshes.get(ballId);
    return mesh?.visible ? { x: mesh.position.x, y: mesh.position.z } : null;
  }

  getBallScreenPosition(ballId: number): { x: number; y: number } | null {
    const mesh = this.ballMeshes.get(ballId);
    return mesh?.visible ? this.toScreen(mesh.position) : null;
  }

  tableToScreen(position: Vec2): { x: number; y: number } {
    return this.toScreen(new THREE.Vector3(position.x, BED_Y, position.y));
  }

  /** `local` is in unscaled physics metres; project its world-space position. */
  private toScreen(local: THREE.Vector3): { x: number; y: number } {
    const projected = local.clone().multiplyScalar(WORLD_SCALE).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2,
    };
  }

  setCamera(mode: CameraMode): void { this.cameraController.setMode(mode); }
  setCameraPhase(phase: CameraPhase): void { this.cameraController.setPhase(phase); }
  adjustCamera(parameter: CameraAdjustment, delta: number): void { this.cameraController.adjust(parameter, delta); }
  resetCamera(): void { this.cameraController.resetAim(); }
  zoomCamera(deltaY: number): void { this.cameraController.zoom(deltaY); }
  getDebugState(): {
    camera: ReturnType<CameraController['getDebugState']>;
    tableFit: TableFit | null;
    traditionalFit: TraditionalTableFit | null;
    roomBackground: boolean;
    roomOccluders: { lampVisible: boolean; ceilingVisible: boolean };
  } {
    return {
      camera: this.cameraController.getDebugState(),
      tableFit: this.referenceTableFit,
      traditionalFit: this.traditionalFit,
      roomBackground: this.roomBackground,
      roomOccluders: { lampVisible: this.lampGroup.visible, ceilingVisible: this.roomCeiling?.visible ?? false },
    };
  }
  /** Deterministic aiming evidence in unscaled physics metres: the cue tip,
   * its axis, the cue-ball centre, the surface gap, the perpendicular offset of
   * the ball centre from the axis line (0 = perfectly aligned) and the minimum
   * shaft-bottom clearance above the rail cap wherever the shaft crosses it. */
  debugCueAim(): {
    tip: number[]; axis: number[]; ballCentre: number[];
    gap: number; alignment: number; railClearance: number; visible: boolean;
  } | null {
    const ball = this.ballMeshes.get(0);
    if (!ball) return null;
    const cueRadius = 0.031 / 2;
    const railTop = 1.355 / 1.6;
    const tip = this.cue.position.clone();
    const axis = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.cue.quaternion).normalize();
    const centre = ball.position.clone();
    const toCentre = centre.clone().sub(tip);
    const along = toCentre.dot(axis);
    const perp = toCentre.clone().addScaledVector(axis, -along).length();
    let clearance = Infinity;
    for (let t = 0; t <= 1.45 + 1e-9; t += 0.01) {
      const p = tip.clone().addScaledVector(axis, t);
      if (Math.abs(p.x) < CUSHION_HALF_X && Math.abs(p.z) < CUSHION_HALF_Y) continue;
      clearance = Math.min(clearance, p.y - cueRadius - railTop);
    }
    return {
      tip: tip.toArray(), axis: axis.toArray(), ballCentre: centre.toArray(),
      gap: tip.distanceTo(centre) - BALL_RADIUS,
      alignment: perp,
      railClearance: Number.isFinite(clearance) ? clearance : 1,
      visible: this.cue.visible,
    };
  }
  /** Test-only scene graph evidence: world-space bounds + effective visibility
   * for the table/cue/lamp groups and every mesh inside the traditional table. */
  debugNodeReport(): Array<{ name: string; visible: boolean; min: number[]; max: number[] }> {
    const report: Array<{ name: string; visible: boolean; min: number[]; max: number[] }> = [];
    const box = new THREE.Box3();
    const effectiveVisible = (object: THREE.Object3D): boolean => {
      let node: THREE.Object3D | null = object;
      while (node) {
        if (!node.visible) return false;
        node = node.parent;
      }
      return true;
    };
    const push = (name: string, object: THREE.Object3D): void => {
      const line = object as THREE.Line;
      if (line.isLine) line.geometry.computeBoundingBox();
      box.setFromObject(object);
      report.push({
        name,
        visible: effectiveVisible(object),
        min: [box.min.x, box.min.y, box.min.z].map(value => Number(value.toFixed(3))),
        max: [box.max.x, box.max.y, box.max.z].map(value => Number(value.toFixed(3))),
      });
    };
    push('aim-line', this.aimLine);
    push('target-line', this.targetLine);
    push('ghost-ball', this.ghostRing);
    push('deflection-line', this.deflectionLine);
    push('break-line', this.breakLine);
    const table = this.world.getObjectByName('traditional-table');
    if (table) {
      push('traditional-table', table);
      let index = 0;
      table.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const label = materials.map(material => material?.name ?? '?').join('+');
        push(`mesh#${index}:${mesh.name || label}`, mesh);
        const first = materials[0] as THREE.MeshStandardMaterial | undefined;
        if (first) {
          report.push({
            name: `mat#${index}:${label}`,
            visible: true,
            min: [first.transparent ? 1 : 0, first.opacity, first.side],
            max: [first.depthWrite ? 1 : 0, first.alphaTest, 0],
          });
        }
        index += 1;
      });
    }
    push('cue-group', this.cue);
    let cueIndex = 0;
    this.cue.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      push(`cue-mesh#${cueIndex}`, mesh);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const first = materials[0] as THREE.MeshStandardMaterial | undefined;
      report.push({
        name: `cue-mesh#${cueIndex}:${materials.map(material => material?.name ?? '?').join('+')}`,
        visible: true,
        min: [first?.transparent ? 1 : 0, first?.opacity ?? -1, first?.side ?? -1],
        max: [first?.map ? 1 : 0, materials.length, mesh.geometry.groups.length],
      });
      cueIndex += 1;
    });
    push('lamp-group', this.lampGroup);
    push('table-visual', this.tableVisual);
    if (this.sittingRoom) {
      push('sitting-room', this.sittingRoom);
      for (const name of ['room-props', 'room-shell', 'room-ceiling']) {
        const node = this.sittingRoom.getObjectByName(name);
        if (node) push(name, node);
      }
    }
    const cueBall = this.ballMeshes.get(0);
    if (cueBall) push('ball-0', cueBall);
    return report;
  }

  /** Test-only raycast evidence: what object renders a given screen pixel. */
  debugRaycast(clientX: number, clientY: number): Array<{ name: string; material: string; point: number[]; distance: number }> {
    this.setPointer(clientX, clientY);
    const hits = this.raycaster.intersectObjects(this.world.children, true);
    return hits.slice(0, 4).map(hit => {
      const mesh = hit.object as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      return {
        name: hit.object.name || '(unnamed)',
        material: materials.map(material => material?.name ?? '?').join('+'),
        point: [hit.point.x, hit.point.y, hit.point.z].map(value => Number(value.toFixed(3))),
        distance: Number(hit.distance.toFixed(3)),
      };
    });
  }

  /** Test-only visibility toggle for A/B screenshots; presentation only. */
  debugSetNodeVisible(name: string, visible: boolean): boolean {
    const table = this.world.getObjectByName('traditional-table');
    const roots: THREE.Object3D[] = [this.cue, this.lampGroup, this.tableVisual];
    if (table) roots.unshift(table);
    for (const root of roots) {
      if (root.name === name) { root.visible = visible; return true; }
    }
    if (table) {
      let index = 0;
      let found: THREE.Object3D | null = null;
      table.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const label = materials.map(material => material?.name ?? '?').join('+');
        if (`mesh#${index}:${mesh.name || label}` === name) found = mesh;
        index += 1;
      });
      if (found) { (found as THREE.Object3D).visible = visible; return true; }
    }
    return false;
  }

  setHairdryerBall(ballId: number | null): void { this.hairdryerBall = ballId; if (ballId === null) this.hairdryer.hide(); }

  /** Ghost cue-ball cursor for ball-in-hand keyboard placement. Green means the
   * spot is legal, red means blocked; presentation only, never authoritative. */
  setPlacementCursor(position: Vec2 | null, valid: boolean): void {
    if (!position) {
      if (this.placementCursor) this.placementCursor.visible = false;
      return;
    }
    if (!this.placementCursor) {
      const cursor = new THREE.Group();
      cursor.name = 'placement-cursor';
      const ghost = new THREE.Mesh(
        new THREE.SphereGeometry(BALL_RADIUS, 20, 14),
        new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0.35, depthWrite: false }),
      );
      ghost.name = 'ghost';
      cursor.add(ghost);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(BALL_RADIUS * 1.5, BALL_RADIUS * 1.85, 32),
        new THREE.MeshBasicMaterial({ color: 0x5cffc4, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.name = 'ring';
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -BALL_RADIUS + 0.001;
      cursor.add(ring);
      this.placementCursor = cursor;
      this.world.add(cursor);
    }
    this.placementCursor.visible = true;
    this.placementCursor.position.set(position.x, BALL_Y, position.y);
    const tint = valid ? 0x5cffc4 : 0xff5c5c;
    const ghost = this.placementCursor.getObjectByName('ghost') as THREE.Mesh;
    const ring = this.placementCursor.getObjectByName('ring') as THREE.Mesh;
    (ghost.material as THREE.MeshStandardMaterial).color.setHex(valid ? 0xffffff : 0xffb3b3);
    (ring.material as THREE.MeshBasicMaterial).color.setHex(tint);
  }

  setHighlights(ballIds: number[]): void {
    const selected = new Set(ballIds);
    this.ballMeshes.forEach((mesh, id) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.emissive.setHex(selected.has(id) ? 0x5cffc4 : 0x000000);
      material.emissiveIntensity = selected.has(id) ? 0.55 : 0;
    });
  }

  /** Character-free hand micro-adjustment: the ball glides to its new spot with
   * a soft glow. The authoritative position is committed by the caller after
   * this presentation resolves; animation never mutates simulation state. */
  async playHandMicro(ballId: number, target: Vec2, seat: 0 | 1): Promise<void> {
    this.cancelHandAnimation?.();
    const mesh = this.ballMeshes.get(ballId);
    if (!mesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    const glow = seat === 0 ? 0x5cffc4 : 0xffd27a;
    const from = { x: mesh.position.x, y: mesh.position.z };
    const duration = this.reducedMotion ? 120 : 2200;
    const started = performance.now();
    return new Promise(resolve => {
      let frame = 0;
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(frame);
        material.emissive.setHex(0x000000);
        material.emissiveIntensity = 0;
        this.ballOverrides.delete(ballId);
        if (this.cancelHandAnimation === finish) this.cancelHandAnimation = null;
        resolve();
      };
      this.cancelHandAnimation = finish;
      const animate = (now: number): void => {
        if (finished) return;
        const t = Math.min(1, (now - started) / duration);
        const moveT = THREE.MathUtils.smoothstep(t, 0.15, 0.9);
        this.ballOverrides.set(ballId, { x: THREE.MathUtils.lerp(from.x, target.x, moveT), y: THREE.MathUtils.lerp(from.y, target.y, moveT) });
        this.syncBallOverride(ballId);
        material.emissive.setHex(glow);
        material.emissiveIntensity = 0.6 * Math.sin(Math.min(1, t) * Math.PI);
        if (t < 1 && !this.disposed) frame = requestAnimationFrame(animate);
        else finish();
      };
      frame = requestAnimationFrame(animate);
    });
  }

  /** Clear visual-only state when discarding a match; resolve cancelled awaits. */
  resetTransientEffects(): void {
    this.cancelHandAnimation?.();
    this.ballOverrides.clear();
    this.lastBallPositions.clear();
    this.lastSimStep = 0;
    this.setHighlights([]);
    this.setHairdryerBall(null);
    this.setPlacementCursor(null, true);
    this.setBreakLine(false);
    this.setAim(0, 0, false);
  }

  private syncBallOverride(ballId: number): void {
    const mesh = this.ballMeshes.get(ballId);
    const position = this.ballOverrides.get(ballId);
    if (mesh && position) mesh.position.set(position.x, BALL_Y, position.y);
  }

  private setPointer(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  screenToTable(clientX: number, clientY: number): Vec2 | null {
    this.setPointer(clientX, clientY);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.tablePlane, point)) return null;
    // Convert the world-space hit back into unscaled physics metres.
    const x = point.x / WORLD_SCALE;
    const z = point.z / WORLD_SCALE;
    if (Math.abs(x) > TABLE_HALF_X || Math.abs(z) > TABLE_HALF_Y) return null;
    return { x, y: z };
  }

  pickBall(clientX: number, clientY: number): number | null {
    this.setPointer(clientX, clientY);
    const hits = this.raycaster.intersectObjects([...this.ballMeshes.values()].filter(mesh => mesh.visible), false);
    const id = hits[0]?.object.userData.ballId;
    return typeof id === 'number' ? id : null;
  }

  private updateOverheadBounds(): void {
    this.scene.updateMatrixWorld(true);
    this.lampBounds.setFromObject(this.lampGroup);
    if (this.roomCeiling) this.ceilingBounds.setFromObject(this.roomCeiling);
    else this.ceilingBounds.makeEmpty();
  }

  orbit(deltaX: number, deltaY: number): void { this.cameraController.orbit(deltaX, deltaY); }

  render(timeSeconds: number): void {
    const target = this.hairdryerBall === null ? null : this.ballMeshes.get(this.hairdryerBall)?.position ?? null;
    this.hairdryer.update(target, timeSeconds);
    this.cameraController.update(timeSeconds * 1000);
    // A destination mode is selected before the eased camera move starts.
    // Keep overhead geometry hidden until the real camera has cleared its
    // footprint; otherwise top -> aim visibly passes through the lamp/ceiling.
    this.lampGroup.visible = this.cameraController.mode !== 'top'
      && !cameraInOverheadVolume(this.camera.position, this.lampBounds);
    if (this.roomCeiling) this.roomCeiling.visible = this.cameraController.mode !== 'top'
      && !cameraInOverheadVolume(this.camera.position, this.ceilingBounds);
    this.renderer.render(this.scene, this.camera);
  }

  setQuality(low: boolean): void {
    this.lowQuality = low;
    this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = !low;
    this.resize();
  }

  /** Test-only render scale: software WebGL needs sub-1 pixel ratios to keep
   * the fixed-step simulation advancing at a usable wall-clock rate. */
  setRenderScale(scale: number): void {
    this.renderer.setPixelRatio(Math.min(1.75, Math.max(0.25, scale)));
    this.resize();
  }

  resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelHandAnimation?.();
    this.environmentMap?.dispose();
    this.sittingRoom?.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach(material => {
        (material as THREE.MeshBasicMaterial)?.map?.dispose();
        material?.dispose();
      });
    });
    this.scene.background = null;
    this.scene.environment = null;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}