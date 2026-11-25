import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraController } from '../../src/view/CameraController';

describe('对局双镜头', () => {
  it('瞄准第一人称，击球与摆球缓动切顶视，回到瞄准恢复第一人称', () => {
    const camera = new THREE.PerspectiveCamera(43, 16 / 9, 0.01, 60);
    const controller = new CameraController(camera);
    controller.setPhase('aiming');
    controller.setAim(0, new THREE.Vector3(-0.6, 0.8215, 0));
    // 阻尼按真实时间收敛：单元测试用显式 60FPS 时间戳推进，而非空转 update()。
    for (let index = 0; index < 100; index += 1) controller.update(index * (1000 / 60));
    expect(controller.mode).toBe('aim');
    expect(camera.position.x).toBeLessThan(-0.6);
    expect(camera.position.y).toBeGreaterThan(0.8215);
    controller.setPhase('rolling');
    expect(controller.mode).toBe('top');
    for (let index = 100; index < 220; index += 1) controller.update(index * (1000 / 60));
    expect(camera.position.y).toBeCloseTo(3.35, 1);
    expect(Math.abs(camera.position.x)).toBeLessThan(0.02);
    controller.setPhase('aiming');
    expect(controller.mode).toBe('aim');
    controller.setPhase('placing');
    expect(controller.mode).toBe('top');
    controller.setPhase('other');
    expect(controller.mode).toBe('orbit');
  });

  it('模式切换有约 0.9 秒缓动，模式内跟踪仍快速收敛', () => {
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.01, 60);
    const controller = new CameraController(camera);
    controller.setAim(0, new THREE.Vector3(-0.6, 0.8215, 0));
    controller.setPhase('aiming');
    for (let index = 0; index < 120; index += 1) controller.update(index * (1000 / 60));
    const aimY = camera.position.y;

    controller.setPhase('rolling');
    expect(controller.mode).toBe('top');
    for (let index = 120; index < 135; index += 1) controller.update(index * (1000 / 60));
    expect(camera.position.y).toBeGreaterThan(aimY);
    expect(camera.position.y).toBeLessThan(2.4);
    for (let index = 135; index < 180; index += 1) controller.update(index * (1000 / 60));
    expect(camera.position.y).toBeCloseTo(3.35, 3);

    controller.setPhase('aiming');
    controller.update(3000);
    expect(Math.abs(camera.position.x)).toBeLessThan(0.02);
    expect(camera.position.y).toBeGreaterThan(3.3);
    for (let index = 3000; index < 3060; index += 1) controller.update(index * (1000 / 60));
    expect(camera.position.x).toBeLessThan(-1.1);

    // Once the mode transition has finished, a new cue/aim target is tracked
    // with the original fast damping rather than another 0.9-second move.
    controller.setAim(Math.PI, new THREE.Vector3(0.6, 0.8215, 0));
    for (let index = 3060; index < 3084; index += 1) controller.update(index * (1000 / 60));
    expect(camera.position.x).toBeGreaterThan(1.1);
    expect(camera.position.y).toBeLessThan(1.4);
  });

  it('参考数字键调整参数并可重置', () => {
    const camera = new THREE.PerspectiveCamera(43, 16 / 9, 0.01, 60);
    const controller = new CameraController(camera);
    controller.setPhase('aiming');
    controller.adjust('fov', 1);
    for (let index = 0; index < 100; index += 1) controller.update(index * (1000 / 60));
    expect(camera.fov).toBeGreaterThan(48);
    controller.resetAim();
    for (let index = 0; index < 100; index += 1) controller.update((100 + index) * (1000 / 60));
    expect(camera.fov).toBeCloseTo(48, 1);
  });

  it('滚轮推拉视角并钳制在房间范围内，顶视不受影响', () => {
    const camera = new THREE.PerspectiveCamera(43, 16 / 9, 0.01, 60);
    const controller = new CameraController(camera);
    const settle = (from: number): void => { for (let index = 0; index < 120; index += 1) controller.update((from + index) * (1000 / 60)); };
    const horizontalDistance = (): number => Math.hypot(camera.position.x, camera.position.z);
    controller.setMode('orbit');
    settle(0);
    const before = horizontalDistance();
    controller.zoom(160);
    settle(200);
    expect(horizontalDistance()).toBeGreaterThan(before);
    for (let index = 0; index < 40; index += 1) controller.zoom(160);
    settle(1000);
    expect(horizontalDistance()).toBeLessThanOrEqual(2.4 + 1e-6);
    for (let index = 0; index < 60; index += 1) controller.zoom(-160);
    settle(2000);
    expect(horizontalDistance()).toBeGreaterThanOrEqual(1.8 - 1e-6);
    controller.setMode('top');
    controller.zoom(160);
    settle(3000);
    expect(camera.position.y).toBeCloseTo(3.35, 1);
  });

  it('第一人称机位水平钳制在房间内、越过库边时抬到轨顶之上（round 7 防穿模）', () => {
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.01, 60);
    const s = 1.6;
    const controller = new CameraController(camera, s);
    controller.setPhase('aiming');
    // Cue near the +x rail, aiming back toward -x so the viewpoint would sit
    // beyond the rail inside the sideboard wood without the clamp.
    controller.setAim(Math.PI, new THREE.Vector3(1.1 * s, 0.8215 * s, 0.5 * s));
    for (let index = 0; index < 200; index += 1) controller.update(index * (1000 / 60));
    expect(camera.position.x).toBeLessThanOrEqual(1.55 * s + 1e-6);
    expect(Math.abs(camera.position.z)).toBeLessThanOrEqual(0.95 * s + 1e-6);
    expect(camera.position.y).toBeGreaterThanOrEqual((0.8469 + 0.08) * s - 1e-6);
  });
});
