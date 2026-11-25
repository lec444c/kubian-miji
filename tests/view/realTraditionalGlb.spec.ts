import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCueStick } from '../../src/view/CueStick';
import { createTraditionalLamp } from '../../src/view/TraditionalTable';
import { parseWithoutTextures } from '../helpers/loadGlb';
import { createTabletopArena, FIGHT_SURFACE_Y, FIGHT_WORLD_SCALE, TABLETOP_BOUNDS } from '../../src/fight/TabletopArena';

/** 用真实 GLB（剥离贴图引用以便 node 解析）验证球杆/吊灯几何修复。 */
describe('真实 GLB 几何', () => {
  it('格斗复用真实房间和无球球桌，整个微缩运动平面落在实际桌布上', async () => {
    const table = await parseWithoutTextures();
    const room = await parseWithoutTextures('public/assets/models/sitting_room_with_baked_textures.glb');
    const arena = createTabletopArena(table, room);
    expect(arena.table.name).toBe('traditional-table');
    expect(arena.room.name).toBe('sitting-room');
    expect(arena.room.getObjectByName('room-props')).toBeDefined();
    expect(arena.group.getObjectByName('traditional-lamp')).toBeDefined();
    expect(arena.fighters.children).toHaveLength(0);
    expect(arena.fighters.getWorldScale(new THREE.Vector3()).toArray()).toEqual([FIGHT_WORLD_SCALE, FIGHT_WORLD_SCALE, FIGHT_WORLD_SCALE]);
    expect(arena.fighters.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(arena.surfaceY, 7);
    expect(Math.abs(arena.surfaceY - FIGHT_SURFACE_Y)).toBeLessThan(0.002);
    let balls = 0;
    arena.group.traverse(object => { if (Number.isInteger(object.userData.ballId)) balls++; });
    expect(balls).toBe(0);
    // Probe the actual fitted mesh, not just constants: no floating floor stand-in.
    const ray = new THREE.Raycaster();
    for (const x of [-4.6, 0, 4.6]) {
      const worldX = x * FIGHT_WORLD_SCALE;
      ray.set(new THREE.Vector3(worldX, 3, 0), new THREE.Vector3(0, -1, 0));
      const contact = ray.intersectObject(arena.table, true)[0];
      expect(contact).toBeDefined();
      expect(contact!.point.y).toBeCloseTo(arena.surfaceY, 6);
      expect(Math.abs(worldX) + 0.5).toBeLessThan(TABLETOP_BOUNDS.halfX);
    }
  });
  it('cc0 球杆归一化：长 1.45m、径向 31mm 级、杆尖在原点且锥度保留', async () => {
    const model = await parseWithoutTextures('public/assets/models/cc0_-_cue_stick.glb');
    const wrapper = createCueStick(model);
    expect(wrapper).not.toBeNull();
    wrapper!.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrapper!);
    const size = box.getSize(new THREE.Vector3());
    console.log('real cc0 cue size', size.toArray().map(v => +v.toFixed(4)));
    expect(size.x).toBeCloseTo(1.45, 2);
    expect(size.y).toBeLessThan(0.032);
    expect(size.z).toBeLessThan(0.032);
    // 杆尖（细端）位于局部原点，杆尾沿 -X。
    expect(box.max.x).toBeCloseTo(0, 3);
    expect(box.min.x).toBeCloseTo(-1.45, 2);
    // 锥度：杆尖截面细于杆尾。
    const vertex = new THREE.Vector3();
    let tipRadius = 0;
    let buttRadius = 0;
    wrapper!.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const position = child.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
        const radius = Math.hypot(vertex.y, vertex.z);
        if (vertex.x > -0.08) tipRadius = Math.max(tipRadius, radius);
        if (vertex.x < -1.37) buttRadius = Math.max(buttRadius, radius);
      }
    });
    console.log('real cc0 cue tip/butt radius', +tipRadius.toFixed(4), +buttRadius.toFixed(4));
    expect(tipRadius).toBeLessThan(buttRadius);
  });
  it('吊灯竖直且绳顶受限', async () => {
    const model = await parseWithoutTextures();
    const wrapper = createTraditionalLamp(model, 1.62, 2.42);
    expect(wrapper).not.toBeNull();
    const box = new THREE.Box3().setFromObject(wrapper!);
    console.log('real lamp box', box.min.toArray().map(v => +v.toFixed(3)), box.max.toArray().map(v => +v.toFixed(3)));
    expect(box.min.y).toBeCloseTo(1.62, 2);
    expect(box.max.y).toBeLessThanOrEqual(2.42 + 1e-6);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(size.z * 1.5);
  });
});