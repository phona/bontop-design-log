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
  private ceilingMeshes: THREE.Mesh[] = [];

  constructor(materialsData?: MaterialYamlEntry[]) {
    if (materialsData) this.materialsData = materialsData;
  }

  setMeshes(floorMeshes: THREE.Mesh[], wallMeshes: THREE.Mesh[], ceilingMeshes: THREE.Mesh[] = []): void {
    this.floorMeshes = floorMeshes;
    this.wallMeshes = wallMeshes;
    this.ceilingMeshes = ceilingMeshes;
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
    const entry = this.materialsData.find((m) => m.id === appearanceId);

    if (entry?.appearance) {
      const key = `${appearanceId}:${appearanceCacheKey(entry.appearance)}`;
      const cached = this.cache.get(key);
      return cached ?? this.buildMaterial(key, entry.appearance);
    }

    const cached = this.cache.get(appearanceId);
    if (cached) return cached;
    const fallback = new THREE.MeshStandardMaterial();
    this.cache.set(appearanceId, fallback);
    return fallback;
  }

  applyToRoom(roomId: string, appearance: MaterialAppearance, meshType?: 'floor' | 'wall' | 'ceiling' | 'all'): void {
    const mat = this.getOrBuild(appearance);

    if (meshType === undefined || meshType === 'all' || meshType === 'wall') {
      for (const mesh of this.wallMeshes) {
        // 共墙按面给材质（DEC-2026-10-07-R12）：faceRooms 声明了左右侧面各归属哪个房间，
        // 只把外观拷进贴邻该房间的槽位；整段单材质墙仍走 roomId 整体匹配。
        const faceRooms = mesh.userData.faceRooms as { left: string | null; right: string | null } | undefined;
        if (faceRooms) {
          const slots = mesh.userData.faceSlots as { left: number; right: number } | undefined;
          if (!slots) continue;
          if (faceRooms.left === roomId) this.copyToMeshAt(mesh, slots.left, mat);
          if (faceRooms.right === roomId) this.copyToMeshAt(mesh, slots.right, mat);
          continue;
        }
        if (mesh.userData.roomId === roomId) {
          this.copyToMesh(mesh, mat);
        }
      }
    }
    if (meshType === undefined || meshType === 'all' || meshType === 'floor') {
      for (const mesh of this.floorMeshes) {
        // Internal floor regions may carry a host roomId for accounting and inspection, but their
        // finish is resolved only by applyToFloorRegions from `follow`.
        if (mesh.userData.type === 'floor_region') continue;
        if (mesh.userData.roomId === roomId) {
          this.copyToMesh(mesh, mat);
        }
      }
    }
    if (meshType === 'ceiling' || meshType === 'all') {
      // 只染基础天花（type='ceiling'）；吊顶造型 solid（铝扣板等）不跟刷
      for (const mesh of this.ceilingMeshes) {
        if (mesh.userData.roomId === roomId && mesh.userData.type === 'ceiling') {
          this.copyToMesh(mesh, mat);
        }
      }
    }
  }

  // floor_region（过渡带或房间内材质分区）始终由 follow 解析；不走宿主roomId覆盖。
  // DEC-041：带 follow 的过渡带跟随目标房间的有效地材（分房覆盖感知），其余跟随 default。
  applyToFloorRegions(
    defaultAppearance: MaterialAppearance,
    followAppearance?: (roomId: string) => MaterialAppearance | null
  ): void {
    const defaultMat = this.getOrBuild(defaultAppearance);
    for (const mesh of this.floorMeshes) {
      if (mesh.userData.type !== 'floor_region') continue;
      const follow = mesh.userData.follow as string | undefined;
      const followed = follow ? followAppearance?.(follow) : null;
      this.copyToMesh(mesh, followed ? this.getOrBuild(followed) : defaultMat);
    }
  }

  private getOrBuild(appearance: MaterialAppearance): THREE.MeshStandardMaterial {
    const cacheKey = appearanceCacheKey(appearance);
    let mat = this.cache.get(cacheKey);
    if (!mat) {
      mat = this.buildMaterial(cacheKey, appearance);
    }
    return mat;
  }

  get cachedMaterialCount(): number {
    return this.cache.size;
  }

  private buildMaterial(key: string, appearance: MaterialAppearance): THREE.MeshStandardMaterial {
    const result = createMaterialTexture(appearance);
    if ('map' in result) {
      // worldSize（米）存在 → UV 米制标定（ShapeGeometry UV=顶点米坐标）；矩形砖按 U/V 轴分别标定。
      const repeat = Array.isArray(result.worldSize)
        ? [1 / result.worldSize[0], 1 / result.worldSize[1]]
        : result.worldSize
          ? [1 / result.worldSize, 1 / result.worldSize]
          : [2, 2];
      for (const t of [result.map, result.normalMap, result.roughnessMap]) {
        if (!t) continue;
        t.repeat.set(repeat[0], repeat[1]);
        this.applyPreviewRotation(t, appearance.rotationDeg);
        t.anisotropy = 8; // 掠射角清晰度（如掉帧降至 4）
      }
      const mat = new THREE.MeshStandardMaterial({
        map: result.map,
        normalMap: result.normalMap,
        roughnessMap: result.roughnessMap,
      });
      // DEC-042：appearance 声明 roughness 时覆盖（哑光釉面砖不全漫反射，暖光下不吃黄）。
      // 仅限程序化陶瓷砖——pbr_texture 的 roughness 字段历史上被忽略（无 roughnessMap 时默认 1.0
      // 漫反射才能显出扫描木纹）；若对 PBR 生效会把地板变高反光、木纹被环境光洗白（2026-08-22 回归）。
      if (appearance.type === 'ceramic_tile_v2' && typeof appearance.roughness === 'number') {
        mat.roughness = appearance.roughness;
      }
      if (result.roughnessMap) {
        mat.roughness = 1.0; // 实际粗糙度由 roughnessMap 逐板承载
        mat.metalness = 0;
      }
      if (result.worldSize && result.normalMap) {
        mat.normalScale.set(0.5, 0.5); // 板缝沟槽柔化，防"灰网"观感
      }
      if (result.ready) this.trackTextureLoad(mat, result.ready);
      this.cache.set(key, mat);
      return mat;
    }
    this.applyPreviewRotation(result, appearance.rotationDeg);
    result.repeat.set(2, 2);
    const mat = new THREE.MeshStandardMaterial({ map: result });
    const ready = result.userData.ready as Promise<void> | undefined;
    if (ready) this.trackTextureLoad(mat, ready);
    this.cache.set(key, mat);
    return mat;
  }

  private trackTextureLoad(material: THREE.MeshStandardMaterial, ready: Promise<void>): void {
    material.userData.textureLoadState = 'pending';
    void ready.then(() => {
      material.userData.textureLoadState = 'ready';
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      material.userData.textureLoadState = 'error';
      material.userData.textureLoadError = message;
      console.error(`[TextureManager] ${message}`);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('material-texture-error', { detail: { message, material } }));
      }
    });
  }

  private applyPreviewRotation(texture: THREE.Texture, rotationDeg: number | undefined): void {
    const normalized = Number.isFinite(rotationDeg) ? Math.min(90, Math.max(0, rotationDeg!)) : 0;
    texture.center.set(0.5, 0.5);
    texture.rotation = (normalized * Math.PI) / 180;
    texture.needsUpdate = true;
  }

  private copyToMesh(mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial): void {
    const m = mesh.material as THREE.MeshStandardMaterial;
    const keepPolygonOffset = mesh.userData.type === 'floor_region';
    const polygonOffset = m.polygonOffset;
    const polygonOffsetFactor = m.polygonOffsetFactor;
    const polygonOffsetUnits = m.polygonOffsetUnits;
    m.copy(mat);
    if (keepPolygonOffset) {
      // SceneBuilder raises floor_region over a room floor to avoid z-fighting. Material.copy()
      // resets these render-order fields, so preserve the declared overlay depth across scheme changes.
      m.polygonOffset = polygonOffset;
      m.polygonOffsetFactor = polygonOffsetFactor;
      m.polygonOffsetUnits = polygonOffsetUnits;
    }
    m.needsUpdate = true;
  }

  private copyToMeshAt(mesh: THREE.Mesh, slot: number, mat: THREE.MeshStandardMaterial): void {
    const materials = mesh.material as THREE.MeshStandardMaterial[];
    if (!Array.isArray(materials) || !materials[slot]) return;
    materials[slot].copy(mat);
    materials[slot].needsUpdate = true;
  }
}

function appearanceCacheKey(appearance: MaterialAppearance): string {
  // Include the entire appearance contract (including image URL/hash, atlas cells and PBR knobs).
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]));
    }
    return value;
  };
  return JSON.stringify(stable(appearance));
}
