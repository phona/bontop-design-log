import * as THREE from 'three';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createMaterialTexture, type MaterialAppearance } from './TextureFactory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface MaterialYamlEntry {
  id: string;
  topic_id?: string;
  appearance?: MaterialAppearance;
  [key: string]: unknown;
}

export class TextureManager {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  private materialsData: MaterialYamlEntry[] | null = null;
  private floorMeshes: THREE.Mesh[] = [];
  private wallMeshes: THREE.Mesh[] = [];

  setMeshes(floorMeshes: THREE.Mesh[], wallMeshes: THREE.Mesh[]): void {
    this.floorMeshes = floorMeshes;
    this.wallMeshes = wallMeshes;
  }

  preload(): void {
    const materials = this.loadMaterialsData();
    for (const entry of materials) {
      if (entry.appearance) {
        this.getMaterial(entry.id);
      }
    }
  }

  getMaterial(appearanceId: string): THREE.MeshStandardMaterial {
    const cached = this.cache.get(appearanceId);
    if (cached) return cached;

    const materials = this.loadMaterialsData();
    const entry = materials.find((m) => m.id === appearanceId);

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

  private loadMaterialsData(): MaterialYamlEntry[] {
    if (this.materialsData) return this.materialsData;
    try {
      const raw = readFileSync(resolve(__dirname, '../../../config/materials.yaml'), 'utf-8');
      const parsed = load(raw) as { materials: MaterialYamlEntry[] };
      this.materialsData = parsed.materials ?? [];
    } catch {
      this.materialsData = [];
    }
    return this.materialsData;
  }

  get cachedMaterialCount(): number {
    return this.cache.size;
  }

  private buildMaterial(key: string, appearance: MaterialAppearance): THREE.MeshStandardMaterial {
    try {
      const tex = createMaterialTexture(appearance);
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
