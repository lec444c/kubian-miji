import * as THREE from 'three';

const BALL_COLORS = [
  '#f4f1df', '#e7c62f', '#2770b7', '#c53b35', '#704b96', '#e8792f', '#31855b', '#7d241f',
  '#161b1b', '#e7c62f', '#2770b7', '#c53b35', '#704b96', '#e8792f', '#31855b', '#7d241f',
];

/** Adapted from tailuge/billiards src/view/balltexturefactory.ts (GPL-3.0). */
export function createReferenceBallTexture(label: number, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const scale = size / 256;
  context.fillStyle = BALL_COLORS[label]!;
  context.fillRect(0, 0, size, size);
  if (label >= 9) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size * 0.2);
    context.fillRect(0, size * 0.8, size, size * 0.2);
  }
  if (label > 0) {
    const center = size / 2;
    const radius = Math.round(52 * scale);
    const border = Math.round(15 * scale);
    context.fillStyle = '#111111';
    context.beginPath(); context.arc(center, center, radius + border, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#ffffff';
    context.beginPath(); context.arc(center, center, radius, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#111111';
    context.strokeStyle = '#111111';
    const fontSize = Math.round(97 * scale);
    context.lineWidth = fontSize * 0.05;
    context.font = `900 ${fontSize}px "Arial Black", Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.strokeText(String(label), center, center + Math.round(5 * scale));
    context.fillText(String(label), center, center + Math.round(5 * scale));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Projected numbers and physical clearcoat adapted from ballmaterialfactory.ts. */
export function createReferenceBall(id: number, radius: number, lowQuality: boolean): THREE.Mesh {
  const texture = createReferenceBallTexture(id, lowQuality ? 128 : 256);
  const material = lowQuality
    ? new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0 })
    : new THREE.MeshPhysicalMaterial({
        roughness: 0.1,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        reflectivity: 0.25,
      });
  material.onBeforeCompile = shader => {
    shader.uniforms.numberTex = { value: texture };
    shader.uniforms.invScale = { value: 1 / (radius * 2) };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vLocalPosition;',
    ).replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvLocalPosition = position;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform sampler2D numberTex;
       uniform float invScale;
       varying vec3 vLocalPosition;`,
    ).replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       vec2 projUv = vLocalPosition.xz * invScale + 0.5;
       vec2 dx = dFdx(projUv);
       vec2 dy = dFdy(projUv);
       if (vLocalPosition.y < 0.0) {
         projUv.x = 1.0 - projUv.x;
         dx.x = -dx.x;
         dy.x = -dy.x;
       }
       projUv = clamp(projUv, 0.0, 1.0);
       diffuseColor.rgb = textureGrad(numberTex, projUv, dx * 0.5, dy * 0.5).rgb;`,
    );
  };
  material.customProgramCacheKey = () => 'reference-projected-ball-y-up-v1';
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, lowQuality ? 2 : 3), material);
  mesh.rotation.set(id * 0.37, id * 0.61, id * 0.23);
  mesh.castShadow = !lowQuality;
  mesh.receiveShadow = false;
  return mesh;
}

let shadowTexture: THREE.CanvasTexture | null = null;
export function createBallContactShadow(radius: number): THREE.Mesh {
  if (!shadowTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(0,0,0,0.48)');
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.28)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    shadowTexture = new THREE.CanvasTexture(canvas);
  }
  const material = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.8, radius * 2.8), material);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  return shadow;
}
