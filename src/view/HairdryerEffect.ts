import * as THREE from 'three';

const WIND_LINE_COUNT = 14;

export class HairdryerEffect {
  readonly group = new THREE.Group();
  private target: THREE.Vector3 | null = null;
  private wind: THREE.Line[] = [];
  private blast: THREE.Mesh;

  constructor() {
    const enamel = new THREE.MeshStandardMaterial({ color: 0xd7b894, metalness: 0.3, roughness: 0.38 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x824c38, metalness: 0.65, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.2, 16), enamel);
    body.rotation.x = Math.PI / 2;
    this.group.add(body);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.065, 0.16, 16), trim);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = 0.17;
    this.group.add(nozzle);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.19, 0.06), enamel);
    handle.position.set(0, -0.12, -0.025);
    handle.rotation.z = -0.18;
    this.group.add(handle);
    const rear = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.009, 8, 18), trim);
    rear.position.z = -0.105;
    this.group.add(rear);
    // Translucent wind blast widening from the nozzle toward the target ball.
    this.blast = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.6, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xb9fff0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.blast.rotation.x = -Math.PI / 2;
    this.blast.position.z = 0.5;
    this.blast.visible = false;
    this.group.add(this.blast);
    for (let i = 0; i < WIND_LINE_COUNT; i++) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xd6fff4, transparent: true, opacity: 0.6 }));
      line.frustumCulled = false;
      this.wind.push(line);
    }
    this.group.visible = false;
  }

  addTo(parent: THREE.Object3D): void {
    parent.add(this.group);
    this.wind.forEach(line => { parent.add(line); line.visible = false; });
  }

  setModel(model: THREE.Group): void {
    this.group.children.forEach(child => { if (child instanceof THREE.Mesh && child !== this.blast) child.visible = false; });
    // The supplied Blender prop is Z-up with its barrel on +X. glTF export
    // converts it to Y-up; this rotation aligns the barrel with the effect's +Z nozzle.
    model.rotation.y = -Math.PI / 2;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(0.62 / Math.max(size.x, size.y, size.z, 0.001));
    model.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    model.position.sub(center);
    this.group.add(model);
  }

  show(target: THREE.Vector3): void { this.target = target.clone(); this.group.visible = true; }
  hide(): void {
    this.target = null;
    this.group.visible = false;
    this.blast.visible = false;
    this.wind.forEach(line => { line.visible = false; });
  }

  update(target: THREE.Vector3 | null, time: number): void {
    if (!target) { this.hide(); return; }
    this.target = target.clone();
    this.group.visible = true;
    const offset = new THREE.Vector3(-0.4, 0.3, 0.22);
    this.group.position.copy(target).add(offset);
    this.group.lookAt(target);
    this.blast.visible = true;
    (this.blast.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.07 * Math.abs(Math.sin(time * 5));
    const distance = this.group.position.distanceTo(target);
    this.wind.forEach((line, i) => {
      line.visible = true;
      const spread = (i / WIND_LINE_COUNT - 0.5) * 0.16;
      const start = this.group.position.clone().lerp(target, 0.22 + (i % 4) * 0.03);
      start.y += spread;
      const end = target.clone().add(new THREE.Vector3(spread * 0.4, Math.sin(time * 9 + i) * 0.03, Math.cos(time * 7 + i) * 0.03));
      const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      positions.setXYZ(0, start.x, start.y, start.z);
      positions.setXYZ(1, end.x, end.y, end.z);
      positions.needsUpdate = true;
      (line.material as THREE.LineBasicMaterial).opacity = (0.35 + 0.45 * Math.abs(Math.sin(time * 6 + i))) * Math.min(1, distance * 2);
    });
  }
}