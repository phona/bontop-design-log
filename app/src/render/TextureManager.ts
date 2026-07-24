import * as THREE from 'three';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { createMaterialTexture, type MaterialAppearance } from './TextureFactory.js';

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

  async preload(): Promise<void> {
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
      try {
        const tex = createMaterialTexture(entry.appearance);
        const mat = new THREE.MeshStandardMaterial({ map: tex });
        this.cache.set(appearanceId, mat);
        return mat;
      } catch {
        // fall through — DOM may be unavailable (e.g. in tests)
      }
    }

    const fallback = new THREE.MeshStandardMaterial();
    this.cache.set(appearanceId, fallback);
    return fallback;
  }

  applyToRoom(roomId: string, appearanceId: string): void {
    const mat = this.getMaterial(appearanceId);
    for (const mesh of this.wallMeshes) {
      if (mesh.userData.roomId === roomId) {
        this.copyToMesh(mesh, mat);
      }
    }
    for (const mesh of this.floorMeshes) {
      if (mesh.userData.roomId === roomId) {
        this.copyToMesh(mesh, mat);
      }
    }
  }

  private loadMaterialsData(): MaterialYamlEntry[] {
    if (this.materialsData) return this.materialsData;
    try {
      const raw = readFileSync('config/materials.yaml', 'utf-8');
      const parsed = load(raw) as { materials: MaterialYamlEntry[] };
      this.materialsData = parsed.materials ?? [];
    } catch {
      this.materialsData = [];
    }
    return this.materialsData;
  }

  private copyToMesh(mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial): void {
    const m = mesh.material as THREE.MeshStandardMaterial;
    m.copy(mat);
    m.needsUpdate = true;
  }
}
