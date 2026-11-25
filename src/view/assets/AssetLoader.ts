import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

interface AssetEntry {
  name?: string;
  id?: string;
  status?: string;
  runtimePath?: string;
  convertedPath?: string;
  output?: string;
}

export class AssetLoader {
  private loader = new GLTFLoader();
  private manifest: AssetEntry[] = [];

  async loadManifest(): Promise<void> {
    try {
      const response = await fetch('/assets/asset-manifest.json');
      if (!response.ok) return;
      const data = await response.json() as { assets?: AssetEntry[] } | AssetEntry[];
      this.manifest = Array.isArray(data) ? data : data.assets ?? [];
    } catch { /* Local procedural fallbacks remain available. */ }
  }

  async loadOptional(kind: 'male' | 'female' | 'table' | 'hairdryer'): Promise<THREE.Group | null> {
    const patterns: Record<typeof kind, RegExp> = {
      male: /(?:superhero|regular).*male|male.*regular|^male$|男/i,
      female: /(?:superhero|regular).*female|female.*regular|^female$|女/i,
      table: /pool.*table|billiard.*table|台球桌/i,
      hairdryer: /hairdryer|hair-dryer|吹风机/i,
    };
    const matching = this.manifest.filter(item => patterns[kind].test(`${item.name ?? ''} ${item.id ?? ''}`));
    const entry = matching.find(item => {
      const path = item.runtimePath ?? item.convertedPath ?? item.output;
      return path && !/missing|failed|unavailable/i.test(item.status ?? '');
    });
    const manifestPath = entry?.runtimePath ?? entry?.convertedPath ?? entry?.output;
    const defaults: Record<typeof kind, string[]> = {
      male: ['/assets/characters/male.gltf', '/assets/models/regular-male.glb', '/assets/models/male.glb'],
      female: ['/assets/characters/female.gltf', '/assets/models/regular-female.glb', '/assets/models/female.glb'],
      table: ['/assets/models/p8.gltf', '/assets/models/pool-table.glb'],
      hairdryer: ['/assets/models/hairdryer.glb', '/assets/models/vintage-hairdryer.glb'],
    };
    const paths = [...new Set([...(manifestPath ? [manifestPath] : []), ...defaults[kind]])]
      .filter(path => /\.(?:gltf|glb)(?:$|\?)/i.test(path))
      .map(path => path.startsWith('/') ? path : `/assets/${path.replace(/^\.\//, '')}`);
    for (const path of paths) {
      try {
        const gltf = await this.loader.loadAsync(path);
        this.enableShadows(gltf.scene);
        gltf.scene.userData.animations = gltf.animations;
        return gltf.scene;
      } catch { /* Try the next known local path. */ }
    }
    return null;
  }

  /** Load a known local glTF/GLB path directly (no manifest matching). */
  async loadGltf(path: string): Promise<THREE.Group | null> {
    try {
      const gltf = await this.loader.loadAsync(path);
      this.enableShadows(gltf.scene);
      gltf.scene.userData.animations = gltf.animations;
      return gltf.scene;
    } catch {
      return null;
    }
  }

  async loadHumanoidAnimations(): Promise<GLTF | null> {
    try {
      const gltf = await this.loader.loadAsync('/assets/animations/universal-animation-library-standard.glb');
      this.enableShadows(gltf.scene);
      return gltf;
    } catch {
      return null;
    }
  }

  async loadObj(path: string): Promise<THREE.Group | null> {
    try {
      const url = encodeURI(path);
      const separator = url.lastIndexOf('/');
      const directory = url.slice(0, separator + 1);
      const filename = url.slice(separator + 1);
      const materials = await new MTLLoader().setPath(directory).loadAsync(filename.replace(/\.obj$/i, '.mtl'));
      materials.preload();
      const object = await new OBJLoader().setMaterials(materials).loadAsync(url);
      this.enableShadows(object);
      return object;
    } catch {
      return null;
    }
  }

  private enableShadows(root: THREE.Object3D): void {
    root.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
  }
}
