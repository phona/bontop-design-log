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
    // 缓存键含 pattern/plank_mm/seed：同色不同拼法（直铺 vs 人字拼）不得共用材质
    const plankKey = Array.isArray(appearance.plank_mm) ? (appearance.plank_mm as number[]).join('x') : '';
    const cacheKey = `${appearance.type}:${appearance.color}:${appearance.pattern ?? ''}:${plankKey}:${appearance.seed ?? ''}`;
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
      if ('map' in result) {
        // worldSize（米）存在 → UV 米制标定（ShapeGeometry UV=顶点米坐标）；否则旧 2×2 兼容
        const repeat = result.worldSize ? 1 / result.worldSize : 2;
        for (const t of [result.map, result.normalMap, result.roughnessMap]) {
          if (!t) continue;
          t.repeat.set(repeat, repeat);
          t.anisotropy = 8; // 掠射角清晰度（如掉帧降至 4）
        }
        const mat = new THREE.MeshStandardMaterial({
          map: result.map,
          normalMap: result.normalMap,
          roughnessMap: result.roughnessMap,
        });
        if (result.roughnessMap) {
          mat.roughness = 1.0; // 实际粗糙度由 roughnessMap 逐板承载
          mat.metalness = 0;
        }
        this.cache.set(key, mat);
        return mat;
      }
      result.repeat.set(2, 2);
      const mat = new THREE.MeshStandardMaterial({ map: result });
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
