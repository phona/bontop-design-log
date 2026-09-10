import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface MergeUnitResult {
  before: number;
  after: number;
  mergedMeshes: number;
}

const METADATA_KEYS = ['objectId', 'roomId', 'type', 'hoverable', 'exportName'] as const;

function textureId(texture: THREE.Texture | null | undefined): string {
  return texture ? texture.uuid : '-';
}

export function materialKey(material: THREE.Material): string {
  const m = material as THREE.MeshStandardMaterial;
  return [
    material.type,
    m.color ? m.color.getHexString() : '-',
    String(m.transparent),
    String(m.opacity),
    String(m.alphaTest),
    String(m.side),
    String(m.flatShading),
    String(m.wireframe),
    String(m.vertexColors),
    String(m.roughness),
    String(m.metalness),
    m.emissive ? m.emissive.getHexString() : '-',
    textureId(m.map),
    textureId(m.normalMap),
    textureId(m.roughnessMap),
    textureId(m.metalnessMap),
    textureId(m.aoMap),
    textureId(m.emissiveMap),
    textureId(m.alphaMap),
  ].join('|');
}

export function geometrySignature(geometry: THREE.BufferGeometry): string {
  const attrs = Object.keys(geometry.attributes).sort().join(',');
  return `${attrs}|${geometry.index ? 'indexed' : 'plain'}`;
}

function collectMergeableMeshes(unit: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  unit.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.noMerge) return;
    if (Array.isArray(mesh.material)) return;
    if (mesh.raycast !== THREE.Mesh.prototype.raycast) return;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (mesh.geometry?.morphAttributes && Object.keys(mesh.geometry.morphAttributes).length > 0) return;
    if (!mesh.geometry?.attributes?.position) return;
    meshes.push(mesh);
  });
  return meshes;
}

function buildMergedMetadata(unit: THREE.Object3D, parts: THREE.Mesh[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const sources: THREE.Object3D[] = [unit, ...parts.slice(0, 8)];
  for (const key of METADATA_KEYS) {
    for (const source of sources) {
      if (source.userData?.[key] !== undefined) {
        out[key] = source.userData[key];
        break;
      }
    }
  }
  return out;
}

function countMeshes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) count++;
  });
  return count;
}

/**
 * 对象内 mesh 合并：先按材质参数去重组内材质实例（FixtureFactory 每个零件
 * 都 new 一份材质），再把同材质零件几何烘焙到 unit 本地坐标系后合并为少量
 * mesh。unit 自身的拾取元数据（objectId/roomId/type/hoverable/exportName）
 * 保留在合并结果上，targetFromIntersects 沿父链命中的行为不变。
 */
export function mergeUnitMaterials(unit: THREE.Object3D): MergeUnitResult {
  // 测试用 three mock 对象（无 updateWorldMatrix/traverse）不支持几何操作，直接跳过
  if (typeof (unit as { updateWorldMatrix?: unknown }).updateWorldMatrix !== 'function'
    || typeof unit.traverse !== 'function') {
    return { before: 0, after: 0, mergedMeshes: 0 };
  }
  const before = countMeshes(unit);
  unit.updateWorldMatrix(true, true);

  const canonicalByKey = new Map<string, THREE.Material>();
  const duplicates: THREE.Material[] = [];
  const groups = new Map<string, { material: THREE.Material; parts: THREE.Mesh[] }>();

  for (const mesh of collectMergeableMeshes(unit)) {
    const material = mesh.material as THREE.Material;
    const key = materialKey(material);
    let canonical = canonicalByKey.get(key);
    if (!canonical) {
      canonical = material;
      canonicalByKey.set(key, canonical);
    } else if (canonical !== material) {
      duplicates.push(material);
      mesh.material = canonical;
    }
    const signature = `${key}#${geometrySignature(mesh.geometry)}`;
    let group = groups.get(signature);
    if (!group) {
      group = { material: canonical, parts: [] };
      groups.set(signature, group);
    }
    group.parts.push(mesh);
  }

  const unitInverse = new THREE.Matrix4().copy(unit.matrixWorld).invert();
  const relative = new THREE.Matrix4();
  const mergedMeshes: THREE.Mesh[] = [];
  const removed: THREE.Mesh[] = [];

  for (const group of groups.values()) {
    if (group.parts.length < 2) continue;
    const geometries: THREE.BufferGeometry[] = [];
    let merged: THREE.BufferGeometry | null = null;
    try {
      for (const part of group.parts) {
        relative.multiplyMatrices(unitInverse, part.matrixWorld);
        geometries.push(part.geometry.clone().applyMatrix4(relative));
      }
      merged = mergeGeometries(geometries, false);
    } finally {
      for (const geometry of geometries) geometry.dispose();
    }
    if (!merged) continue;

    const mesh = new THREE.Mesh(merged, group.material);
    mesh.name = `${unit.name || unit.uuid}:merged:${mergedMeshes.length}`;
    mesh.castShadow = group.parts.some((part) => part.castShadow);
    mesh.receiveShadow = group.parts.some((part) => part.receiveShadow);
    mesh.userData = buildMergedMetadata(unit, group.parts);
    mergedMeshes.push(mesh);
    removed.push(...group.parts);
  }

  for (const mesh of removed) mesh.parent?.remove(mesh);
  for (const mesh of mergedMeshes) unit.add(mesh);
  for (const mesh of removed) mesh.geometry.dispose();

  const stillReferenced = new Set<THREE.Material>();
  unit.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => stillReferenced.add(m));
    else stillReferenced.add(mesh.material as THREE.Material);
  });
  for (const material of duplicates) {
    if (!stillReferenced.has(material)) material.dispose();
  }

  return { before, after: countMeshes(unit), mergedMeshes: mergedMeshes.length };
}
