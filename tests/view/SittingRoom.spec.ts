import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSittingRoom, TABLE_BED_Y, TABLE_WORLD_SCALE } from '../../src/view/SittingRoom';

const shellKept = [
  -4, 0, -3, 8, 0, -3, 8, 0, 5, // floor; bounds centre is (2, 0, 1)
  -4, 0, -3, -4, 4, -3, -4, 4, 5, // wall crossing the ceiling cutoff stays whole
  -4, 3.5, -3, 8, 3.5, -3, 8, 3.5, 5, // cutoff itself is not ceiling
];
const ceilingPoints = [-4, 4, -3, 8, 4, -3, 8, 4, 5];
const coffeeTable = [0, 0.75, 0, 1, 0.75, 0, 0, 0.75, 1];
const propsKept = [
  0, 0, 0, 1, 0, 0, 0, 0, 1, // floor directly below the coffee table
  3, 1, 0, 4, 1, 0, 3, 1, 1, // side furniture
  -4, 1, 0, -3, 1, 0, -4, 1, 1, // opposite side furniture
  0, 1, -2, 1, 1, -2, 0, 1, -1, // back furniture
  0, 1, 2, 1, 1, 2, 0, 1, 3, // front furniture
  2.5, 0.75, 0, 3, 0.75, 0, 2.5, 0.75, 1, // partial overlap is not culled
];

function geometry(points: number[], indexed: boolean): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(
    Array.from({ length: points.length / 9 }, () => [0, 0, 1, 0, 0, 1]).flat(), 2,
  ));
  if (indexed) result.setIndex(Array.from({ length: points.length / 3 }, (_, i) => i));
  result.computeVertexNormals();
  return result;
}

function sourceRoom(propsFirst = false) {
  const model = new THREE.Group();
  model.position.set(10, 2, -6);
  model.rotation.x = Math.PI / 2;
  model.scale.setScalar(2);
  const shellMap = new THREE.Texture();
  const propsMap = new THREE.Texture();
  const shell = new THREE.Mesh(geometry([...shellKept, ...ceilingPoints], true), new THREE.MeshStandardMaterial({ map: shellMap }));
  const props = new THREE.Mesh(geometry([...coffeeTable, ...propsKept], false), new THREE.MeshStandardMaterial({ map: propsMap }));
  shell.position.set(1, 0, -1);
  props.position.set(-1, 0, 1);
  model.add(...(propsFirst ? [props, shell] : [shell, props]));
  model.updateMatrixWorld(true);
  // Author geometry in the inverse basis: the builder must bake root and mesh transforms.
  for (const mesh of [shell, props]) mesh.geometry.applyMatrix4(mesh.matrixWorld.clone().invert());
  return { model, shell, props, shellMap, propsMap };
}

function roomMesh(group: THREE.Group, name: string): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  return group.getObjectByName(name) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

function expectValues(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, expected: number[]): void {
  expect(attribute.array.length).toBe(expected.length);
  expected.forEach((value, i) => expect(attribute.array[i]).toBeCloseTo(value, 5));
}

afterEach(() => vi.restoreAllMocks());

describe('烘焙起居室构建器', () => {
  it.each([false, true])('源网格顺序 propsFirst=%s：拆分天花板，只移除中央咖啡桌', propsFirst => {
    const { group, ceiling } = createSittingRoom(sourceRoom(propsFirst).model);
    expect(group.name).toBe('sitting-room');
    expect(group.children.map(child => child.name)).toEqual(['room-props', 'room-shell', 'room-ceiling']);
    expect(ceiling).toBe(roomMesh(group, 'room-ceiling'));
    expect(ceiling.parent).toBe(group);
    const shell = roomMesh(group, 'room-shell');
    const props = roomMesh(group, 'room-props');
    expectValues(shell.geometry.getAttribute('position'), shellKept);
    expectValues(props.geometry.getAttribute('position'), propsKept);
    expectValues(ceiling.geometry.getAttribute('position'), ceilingPoints);
    ceiling.visible = false;
    expect(shell.visible).toBe(true);
    expect(props.visible).toBe(true);
  });

  it('烘焙源变换、保留法线和 UV，仅在水平面居中且不缩放房间', () => {
    const { group, ceiling } = createSittingRoom(sourceRoom().model);
    expect(group.position.toArray()).toEqual([-2, 0, -1]);
    expect(group.scale.toArray()).toEqual([1, 1, 1]);
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
    expect(box.getCenter(new THREE.Vector3()).z).toBeCloseTo(0);
    expect(box.getSize(new THREE.Vector3()).toArray()).toEqual([12, 4, 8]);
    expectValues(ceiling.geometry.getAttribute('uv'), [0, 0, 1, 0, 0, 1]);
    expectValues(ceiling.geometry.getAttribute('normal'), [0, -1, 0, 0, -1, 0, 0, -1, 0]);
  });

  it('释放源几何和材质，结果使用新双面无光材质并接管共享贴图', () => {
    const source = sourceRoom();
    const disposeGeometry = [source.shell, source.props].map(mesh => vi.spyOn(mesh.geometry, 'dispose'));
    const disposeMaterial = [source.shell, source.props].map(mesh => vi.spyOn(mesh.material, 'dispose'));
    const disposeMaps = [source.shellMap, source.propsMap].map(map => vi.spyOn(map, 'dispose'));
    const { group } = createSittingRoom(source.model);
    for (const dispose of [...disposeGeometry, ...disposeMaterial]) expect(dispose).toHaveBeenCalledTimes(1);
    for (const dispose of disposeMaps) expect(dispose).not.toHaveBeenCalled();
    const shell = roomMesh(group, 'room-shell');
    const props = roomMesh(group, 'room-props');
    const ceiling = roomMesh(group, 'room-ceiling');
    expect(shell.geometry).not.toBe(source.shell.geometry);
    expect(props.geometry).not.toBe(source.props.geometry);
    expect(shell.material).not.toBe(source.shell.material);
    expect(props.material).not.toBe(source.props.material);
    expect(shell.material.map).toBe(source.shellMap);
    expect(ceiling.material.map).toBe(source.shellMap);
    expect(props.material.map).toBe(source.propsMap);
    for (const mesh of [shell, props, ceiling]) {
      expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(mesh.material.side).toBe(THREE.DoubleSide);
    }
  });

  it.each([0, 1])('拒绝不足两项的源网格布局（%s 项），不提前释放源资源', count => {
    const source = sourceRoom();
    source.model.clear();
    if (count) source.model.add(source.shell);
    const disposeGeometry = vi.spyOn(source.shell.geometry, 'dispose');
    const disposeMaterial = vi.spyOn(source.shell.material, 'dispose');
    expect(() => createSittingRoom(source.model)).toThrow('sitting room GLB has unexpected mesh layout');
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
  });

  it('导出原有台面高度和桌面世界缩放', () => {
    expect(TABLE_BED_Y).toBe(0.79);
    expect(TABLE_WORLD_SCALE).toBe(1.6);
  });
});
