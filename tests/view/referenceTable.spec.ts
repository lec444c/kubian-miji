import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { installReferenceTable } from '../../src/view/ReferenceTable';

function sourceTable(): THREE.Group {
  const model = new THREE.Group();
  const clothMaterial = new THREE.MeshStandardMaterial({ name: 'cloth' });
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(46, 24, 0.5), clothMaterial);
  cloth.name = 'FullCloth';
  cloth.position.z = -0.75;
  model.add(cloth);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(48, 26, 2), new THREE.MeshStandardMaterial({ name: 'wood' }));
  rail.position.z = 20;
  model.add(rail);
  return model;
}

describe('参考球桌布面标定', () => {
  it('按 FullCloth 顶面而非整桌最高点对齐权威台高', () => {
    const fit = installReferenceTable(sourceTable(), 0.79, 1.27, 0.635);
    expect(fit.clothTopY).toBeCloseTo(0.79, 10);
    expect(fit.clothWidth).toBeCloseTo(2.54, 10);
    expect(fit.clothDepth).toBeCloseTo(1.27, 10);
  });

  it('缺少语义布面时拒绝猜测性安装', () => {
    expect(() => installReferenceTable(new THREE.Group(), 0.79, 1.27, 0.635)).toThrow('FullCloth');
  });
});
