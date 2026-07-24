import * as THREE from 'three';
import { createMaterialTexture, type MaterialAppearance, type ProceduralTextures } from './TextureFactory.js';

interface MaterialYamlEntry {
  id: string;
  topic_id?: string;
  appearance?: MaterialAppearance;
  [key: string]: unknown;
}

export class TextureManager {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  private materialsData: MaterialYamlEntry[] = [];
  private floorMeshes: THREE.Mesh[] = [];
  private wallMeshes: THREE.Mesh[] = [];

  constructor(materialsData?: MaterialYamlEntry[]) {
    if (materialsData) this.materialsData = materialsData;
  }

  setMeshes(floorMeshes: THREE.Mesh[], wallMeshes: THREE.Mesh[]): void {
    this.floorMeshes = floorMeshes;
    this.wallMeshes = wallMeshes;
  }

  loadMaterials(materials: MaterialYamlEntry[]): void {
    this.materialsData = materials;
  }

  preload(): void {
    for (const entry of this.materialsData) {
      if (entry.appearance) {
        this.getMaterial(entry.id);
      }
    }
  }

  getMaterial(appearanceId: string): THREE.MeshStandardMaterial {
    const cached = this.cache.get(appearanceId);
    if (cached) return cached;

    const entry = this.materialsData.find((m) => m.id === appearanceId);

    if (entry?.appearance) {
      return this.buildMaterial(appearanceId, entry.appearance);
    }

    const fallback = new THREE.MeshStandardMaterial();
    this.cache.set(appearanceId, fallback);
    return fallback;
  }

  applyToRoom(roomId: string, appearance: MaterialAppearance, meshType?: 'floor' | 'wall' | 'all'): void {
    const cacheKey = `${appearance.type}:${appearance.color}`;
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = this.buildMaterial(cacheKey, appearance);
    }

    if (meshType === undefined || meshType === 'all' || meshType === 'wall') {
      for (const mesh of this.wallMeshes) {
        if (mesh.userData.roomId === roomId) {
          this.copyToMesh(mesh, mat);
        }
      }
    }
    if (meshType === undefined || meshType === 'all' || meshType === 'floor') {
      for (const mesh of this.floorMeshes) {
        if (mesh.userData.roomId === roomId) {
          this.copyToMesh(mesh, mat);
        }
      }
    }
  }

  get cachedMaterialCount(): number {
    return this.cache.size;
  }

  private buildMaterial(key: string, appearance: MaterialAppearance): THREE.MeshStandardMaterial {
    try {
      const result = createMaterialTexture(appearance);
      const tex = 'map' in result ? result.map : result;
      if ('map' in result && result.normalMap) {
        tex.repeat.set(2, 2);
        const mat = new THREE.MeshStandardMaterial({ map: tex, normalMap: result.normalMap });
        this.cache.set(key, mat);
        return mat;
      }
      tex.repeat.set(2, 2);
      const mat = new THREE.MeshStandardMaterial({ map: tex });
      this.cache.set(key, mat);
      return mat;
    } catch {
      const mat = new THREE.MeshStandardMaterial();
      this.cache.set(key, mat);
      return mat;
    }
  }

  private copyToMesh(mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial): void {
    const m = mesh.material as THREE.MeshStandardMaterial;
    m.copy(mat);
    m.needsUpdate = true;
  }
}
