import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCueStick } from '../../src/view/CueStick';
import { createTraditionalLamp } from '../../src/view/TraditionalTable';

/** 第四/五轮回归：球杆归一化（cc0 cue_stick 管线）与吊灯绳轴识别。 */
describe('球杆与吊灯几何修复', () => {
  it('斜置锥形杆身归一化：杆尖在原点、杆尾沿 -X、径向 31mm 且锥度保留', () => {
    const model = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0xd2b48c });
    // 锥形杆身：细端（杆尖）半径 6mm、粗端（杆尾）14mm，斜置模拟真实 GLB 姿态。
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.014, 1.4, 16), material);
    shaft.rotation.set(0.5, 0.3, 0.9);
    shaft.position.set(0.2, 0.5, -0.3);
    model.add(shaft);
    const wrapper = createCueStick(model);
    expect(wrapper).not.toBeNull();
    wrapper!.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrapper!);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1.45, 2);
    expect(size.y).toBeLessThan(0.032);
    expect(size.z).toBeLessThan(0.032);
    expect(Math.abs(size.y - size.z)).toBeLessThan(1e-6);
    // 杆尖位于局部原点，杆尾沿 -X。
    expect(box.max.x).toBeCloseTo(0, 4);
    expect(box.min.x).toBeCloseTo(-1.45, 2);
    // 锥度保留：杆尖截面明显细于杆尾。
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
    expect(buttRadius).toBeCloseTo(0.0155, 3);
    expect(tipRadius).toBeLessThan(buttRadius * 0.7);
  });

  it('吊灯以绳轴竖直悬挂：灯罩长边水平、绳顶不超过给定高度', () => {
    const model = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ name: 'light_mat' });
    // 绳：沿 Y 细柱 0.865m；灯罩：Z 向 1.212m 的宽扁盒（比绳更长）。
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.865, 8), material);
    cord.position.y = 0.865 / 2 + 0.12;
    model.add(cord);
    const shade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 1.212), material);
    shade.position.y = 0.06;
    model.add(shade);
    const wrapper = createTraditionalLamp(model, 1.62, 2.42);
    expect(wrapper).not.toBeNull();
    const box = new THREE.Box3().setFromObject(wrapper!);
    // 灯罩底落在 shadeBottomY，绳顶不穿天花板。
    expect(box.min.y).toBeCloseTo(1.62, 2);
    expect(box.max.y).toBeLessThanOrEqual(2.42 + 1e-6);
    const size = box.getSize(new THREE.Vector3());
    // 灯罩长边映射到世界 X（水平），竖直方向只有罩厚+绳长。
    expect(size.x).toBeGreaterThan(0.9);
    expect(size.x).toBeGreaterThan(size.z * 2);
    expect(size.y).toBeLessThan(0.85);
  });
});