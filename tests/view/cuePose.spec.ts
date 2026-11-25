import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { computeCuePose, CUE_LENGTH } from '../../src/view/CueStick';
import { BALL_RADIUS, CUSHION_HALF_X, CUSHION_HALF_Y } from '../../src/sim/SimulationState';

/** 第五轮：杆头对齐球心 + 不穿库边/不穿球的纯函数位姿验证。 */
const BED_Y = 0.79;
const BALL_Y = BED_Y + BALL_RADIUS;
const RAIL_TOP = 1.355 / 1.6;
const CUE_RADIUS = 0.031 / 2;

/** 与 SceneView.setAim 相同的四元数合成，返回杆轴单位方向（杆尖→杆尾为 -dir）。 */
function axisDirection(pose: { yaw: number; tilt: number }): THREE.Vector3 {
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pose.tilt);
  return new THREE.Vector3(1, 0, 0).applyQuaternion(yaw.multiply(tilt));
}

describe('computeCuePose 杆头对齐与防穿模', () => {
  const cases: Array<[number, number, number, number, boolean]> = [
    [-0.6, 0, 0, 0, false],
    [0, 0, Math.PI / 4, 0.5, true],
    [0.9, 0.4, Math.PI, 1, true],
    [-CUSHION_HALF_X + BALL_RADIUS, 0, 0, 0, false], // 贴左库
    [0, -CUSHION_HALF_Y + BALL_RADIUS, -Math.PI / 2, 0, false], // 贴下库
    [CUSHION_HALF_X - BALL_RADIUS, CUSHION_HALF_Y - BALL_RADIUS, Math.PI / 4, 0.3, true], // 贴角
  ];

  it('杆轴延长线精确穿过球心，杆尖与球面保持安全间隙', () => {
    for (const [x, z, angle, power, charging] of cases) {
      const pose = computeCuePose(x, z, angle, power, charging);
      const dir = axisDirection(pose);
      const tip = new THREE.Vector3(pose.x, pose.y, pose.z);
      const centre = tip.clone().addScaledVector(dir, BALL_RADIUS + pose.gap);
      expect(centre.x).toBeCloseTo(x, 6);
      expect(centre.y).toBeCloseTo(BALL_Y, 6);
      expect(centre.z).toBeCloseTo(z, 6);
      expect(pose.gap).toBeGreaterThanOrEqual(0.006);
      expect(pose.tilt).toBeLessThanOrEqual(0); // 杆尾抬高、杆尖朝下
    }
  });

  it('杆身在库边帽上方通过：任何越出库鼻的杆身采样点底缘不低于库帽顶', () => {
    const balls: Array<[number, number]> = [
      [-0.6, 0], [0, 0], [0.9, 0.4],
      [-CUSHION_HALF_X + BALL_RADIUS, 0],
      [CUSHION_HALF_X - BALL_RADIUS, 0.2],
      [0, -CUSHION_HALF_Y + BALL_RADIUS],
      [-CUSHION_HALF_X + BALL_RADIUS, -CUSHION_HALF_Y + BALL_RADIUS],
    ];
    for (const [x, z] of balls) {
      for (let step = 0; step < 16; step++) {
        const angle = (step / 16) * Math.PI * 2;
        const pose = computeCuePose(x, z, angle, 0.4, true);
        const dir = axisDirection(pose);
        const tip = new THREE.Vector3(pose.x, pose.y, pose.z);
        for (let t = 0; t <= CUE_LENGTH + 1e-9; t += 0.02) {
          const p = tip.clone().addScaledVector(dir, -t); // 杆尖→杆尾
          const overRail = Math.abs(p.x) >= CUSHION_HALF_X || Math.abs(p.z) >= CUSHION_HALF_Y;
          if (!overRail) continue;
          expect(p.y - CUE_RADIUS).toBeGreaterThanOrEqual(RAIL_TOP - 1e-9);
        }
      }
    }
  });

  it('贴库球采用陡桥：倾角到上限、间隙加大、杆尖底缘仍高于库帽', () => {
    const pose = computeCuePose(-CUSHION_HALF_X + BALL_RADIUS, 0, 0, 0, false);
    expect(-pose.tilt).toBeCloseTo((30 * Math.PI) / 180, 5);
    expect(pose.gap).toBeGreaterThan(0.05);
    expect(pose.y - CUE_RADIUS).toBeGreaterThan(RAIL_TOP);
  });

  it('蓄力后拉增大间隙，且不超过最大后拉行程', () => {
    const idle = computeCuePose(-0.6, 0, 0, 0, false);
    const full = computeCuePose(-0.6, 0, 0, 1, true);
    expect(full.gap).toBeGreaterThan(idle.gap);
    expect(full.gap).toBeCloseTo(0.008 + 0.18, 6);
  });
});