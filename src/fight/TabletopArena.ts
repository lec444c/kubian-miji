import * as THREE from 'three';
import { CUSHION_HALF_X, CUSHION_HALF_Y } from '../sim/SimulationState';
import { createSittingRoom, TABLE_BED_Y, TABLE_WORLD_SCALE } from '../view/SittingRoom';
import { createTraditionalLamp, installTraditionalTable } from '../view/TraditionalTable';

/** Presentation only: simulation distances, speed, jump arc and hit windows stay unchanged. */
export const FIGHTER_TABLE_SCALE = 0.18;
export const FIGHT_WORLD_SCALE = FIGHTER_TABLE_SCALE * TABLE_WORLD_SCALE;
export const FIGHT_SURFACE_Y = TABLE_BED_Y * TABLE_WORLD_SCALE;

/** The same room/table installers as billiards, deliberately without balls or aiming helpers. */
export function createTabletopArena(tableModel: THREE.Group, roomModel: THREE.Group) {
  const group = new THREE.Group();
  group.name = 'tabletop-fight-arena';
  const world = new THREE.Group();
  world.name = 'billiards-table-world';
  world.scale.setScalar(TABLE_WORLD_SCALE);
  group.add(world);
  // Extract before installTraditionalTable removes the authored lamp and resting cue.
  const lamp = createTraditionalLamp(tableModel, 1.62, 2.42);
  const { group: table, fit } = installTraditionalTable(tableModel, TABLE_BED_Y);
  world.add(table);
  if (lamp) world.add(lamp);
  const { group: room } = createSittingRoom(roomModel);
  group.add(room);
  const fighters = new THREE.Group();
  fighters.name = 'tabletop-fighters';
  fighters.position.y = TABLE_BED_Y;
  fighters.scale.setScalar(FIGHTER_TABLE_SCALE);
  world.add(fighters);
  group.updateMatrixWorld(true);
  // The shared fitter bins source levels to millimetres. Probe the actual cloth
  // so small feet sit on its triangles rather than a rounded nominal height.
  const ray = new THREE.Raycaster(new THREE.Vector3(0, FIGHT_SURFACE_Y + 0.5, 0), new THREE.Vector3(0, -1, 0));
  const surface = ray.intersectObject(table, true)[0];
  if (!surface || Math.abs(surface.point.y - FIGHT_SURFACE_Y) > 0.01) throw new Error('空台球桌的桌面高度测量失败');
  const surfaceY = surface.point.y;
  fighters.position.y = surfaceY / TABLE_WORLD_SCALE;
  group.updateMatrixWorld(true);
  return { group, fighters, table, room, fit, surfaceY };
}

/** Orthographic framing preserves readable 2.5D controls while exposing cloth, pockets and room. */
export function tabletopCameraFrame(aspect: number, leftX: number, rightX: number, preview: boolean) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const a = preview ? -1.25 : leftX;
  const b = preview ? 1.25 : rightX;
  const spread = Math.abs(a - b) * FIGHT_WORLD_SCALE;
  // Closer framing keeps the miniature fighters readable; the centre pans with them.
  const requestedWidth = Math.max(ratio >= 1.3 ? 3.6 : 2.3, spread + 1.1);
  const height = Math.max(1.7, requestedWidth / ratio);
  const width = height * ratio;
  const edge = (CUSHION_HALF_X + 0.25) * TABLE_WORLD_SCALE;
  const pan = Math.max(0, edge - width / 2);
  const centerX = THREE.MathUtils.clamp((a + b) / 2 * FIGHT_WORLD_SCALE, -pan, pan);
  return { width, height, centerX, targetY: FIGHT_SURFACE_Y + 0.22 };
}

export const TABLETOP_BOUNDS = Object.freeze({
  halfX: CUSHION_HALF_X * TABLE_WORLD_SCALE,
  halfZ: CUSHION_HALF_Y * TABLE_WORLD_SCALE,
});
