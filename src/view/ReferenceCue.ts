import * as THREE from 'three';

/**
 * Cue geometry adapted from tailuge/billiards src/view/cuemesh.ts (GPL-3.0).
 * Keeps its four-point splice, collar, shaft, ferrule, tip and seeded grain.
 * The returned group has its tip at x=0 and its butt along local -X.
 */
export function createReferenceCue(length = 1.45): THREE.Group {
  const tipRadius = 0.0062;
  const buttRadius = 0.0155;
  const jointLength = 0.004;
  const ferruleLength = 0.015;
  const buttLength = length * 0.4;
  const shaftLength = length - buttLength - jointLength - ferruleLength;
  const shaftMaterial = new THREE.MeshPhongMaterial({
    color: '#d2b48c', shininess: 50, map: woodGrainTexture('#d2b48c', 7),
  });
  const buttMaterial = new THREE.MeshPhongMaterial({
    color: '#0d0d0d', shininess: 80, map: woodGrainTexture('#0d0d0d', 11),
  });
  const jointMaterial = new THREE.MeshPhongMaterial({ color: '#2b2f36', shininess: 25, specular: 0x333333 });
  const ferruleMaterial = new THREE.MeshPhongMaterial({ color: '#e5e5e5', shininess: 100, specular: 0x111111 });
  const tipMaterial = new THREE.MeshPhongMaterial({ color: 0x4a7c9a, shininess: 5 });
  const body = new THREE.Group();

  const buttBottomY = -length / 2;
  const spliceTopY = buttBottomY + buttLength;
  const spliceLength = buttLength * 0.38;
  const radiusAtY = (y: number): number => buttRadius * (1 - 0.1 * (y - buttBottomY) / buttLength);
  const vAtY = (y: number): number => (y - buttBottomY) / buttLength;
  const splice = createSpliceGeometries(spliceTopY, buttBottomY, spliceLength, radiusAtY, vAtY);
  body.add(new THREE.Mesh(splice.upper, shaftMaterial));
  body.add(new THREE.Mesh(splice.lower, buttMaterial));

  const cap = new THREE.Mesh(new THREE.CircleGeometry(buttRadius, 24), buttMaterial);
  cap.rotation.x = Math.PI / 2;
  cap.position.y = buttBottomY;
  body.add(cap);

  const jointRadius = buttRadius * 0.9;
  const joint = new THREE.Mesh(new THREE.CylinderGeometry(jointRadius, jointRadius, jointLength, 16), jointMaterial);
  joint.position.y = spliceTopY + jointLength / 2;
  body.add(joint);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(tipRadius, jointRadius, shaftLength, 16), shaftMaterial);
  shaft.position.y = spliceTopY + jointLength + shaftLength / 2;
  body.add(shaft);
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(tipRadius, tipRadius, ferruleLength, 16), ferruleMaterial);
  ferrule.position.y = shaft.position.y + shaftLength / 2 + ferruleLength / 2;
  body.add(ferrule);
  const tipHeight = 0.0055;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(tipRadius * 0.93, tipRadius, tipHeight, 16), tipMaterial);
  tip.position.y = ferrule.position.y + ferruleLength / 2 + tipHeight / 2;
  tip.name = 'cueTip';
  body.add(tip);

  body.rotation.z = -Math.PI / 2;
  body.position.x = -length / 2;
  const group = new THREE.Group();
  group.add(body);
  group.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = false;
    }
  });
  return group;
}

function createSpliceGeometries(
  startY: number,
  endY: number,
  spliceLength: number,
  radiusAtY: (y: number) => number,
  vAtY: (y: number) => number,
): { upper: THREE.BufferGeometry; lower: THREE.BufferGeometry } {
  const segments = 24;
  const points = 4;
  const upperPosition: number[] = [];
  const upperNormal: number[] = [];
  const upperUv: number[] = [];
  const lowerPosition: number[] = [];
  const lowerNormal: number[] = [];
  const lowerUv: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const u1 = index / segments;
    const u2 = (index + 1) / segments;
    const a1 = u1 * Math.PI * 2;
    const a2 = u2 * Math.PI * 2;
    const wave1 = 1 - Math.abs(2 * (((index * points) / segments) % 1) - 1);
    const wave2 = 1 - Math.abs(2 * (((next * points) / segments) % 1) - 1);
    const seamY1 = startY - wave1 * spliceLength;
    const seamY2 = startY - wave2 * spliceLength;
    const top1 = cylindricalPoint(a1, radiusAtY(startY), startY);
    const top2 = cylindricalPoint(a2, radiusAtY(startY), startY);
    const seam1 = cylindricalPoint(a1, radiusAtY(seamY1), seamY1);
    const seam2 = cylindricalPoint(a2, radiusAtY(seamY2), seamY2);
    const bottom1 = cylindricalPoint(a1, radiusAtY(endY), endY);
    const bottom2 = cylindricalPoint(a2, radiusAtY(endY), endY);
    addSpliceQuad(upperPosition, upperNormal, upperUv, top1, seam1, top2, seam2,
      u1, vAtY(startY), u1, vAtY(seamY1), u2, vAtY(startY), u2, vAtY(seamY2));
    addSpliceQuad(lowerPosition, lowerNormal, lowerUv, seam1, bottom1, seam2, bottom2,
      u1, vAtY(seamY1), u1, vAtY(endY), u2, vAtY(seamY2), u2, vAtY(endY));
  }
  return {
    upper: geometry(upperPosition, upperNormal, upperUv),
    lower: geometry(lowerPosition, lowerNormal, lowerUv),
  };
}

function cylindricalPoint(angle: number, radius: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

function geometry(position: number[], normal: number[], uv: number[]): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return result;
}

function addSpliceQuad(
  position: number[], normal: number[], uv: number[],
  v1: THREE.Vector3, v2: THREE.Vector3, v3: THREE.Vector3, v4: THREE.Vector3,
  u1: number, uv1: number, u2: number, uv2: number,
  u3: number, uv3: number, u4: number, uv4: number,
): void {
  position.push(v1.x, v1.y, v1.z, v3.x, v3.y, v3.z, v2.x, v2.y, v2.z);
  position.push(v3.x, v3.y, v3.z, v4.x, v4.y, v4.z, v2.x, v2.y, v2.z);
  const normals = [v1, v2, v3, v4].map(v => new THREE.Vector3(v.x, 0, v.z).normalize());
  const [n1, n2, n3, n4] = normals;
  normal.push(n1!.x, n1!.y, n1!.z, n3!.x, n3!.y, n3!.z, n2!.x, n2!.y, n2!.z);
  normal.push(n3!.x, n3!.y, n3!.z, n4!.x, n4!.y, n4!.z, n2!.x, n2!.y, n2!.z);
  uv.push(u1, uv1, u3, uv3, u2, uv2, u3, uv3, u4, uv4, u2, uv2);
}

function woodGrainTexture(hex: string, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 512;
  const context = canvas.getContext('2d')!;
  context.fillStyle = hex;
  context.fillRect(0, 0, 64, 512);
  const random = mulberry32(seed);
  for (let index = 0; index < 140; index += 1) {
    const x = random() * 64;
    const y = random() * 512;
    const length = 512 * (0.4 + random() * 0.6);
    context.strokeStyle = random() > 0.45 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.07)';
    context.lineWidth = 0.5 + random() * 1.6;
    context.beginPath();
    const amplitude = 0.4 + random() * 1.6;
    context.moveTo(x, y);
    for (let yy = 0; yy < length; yy += 6) {
      context.lineTo(x + Math.sin(yy * (0.05 + random() * 0.06)) * amplitude, y + yy);
    }
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(4, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
