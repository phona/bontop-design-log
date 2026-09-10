import * as THREE from 'three';
import { materialKey, geometrySignature } from './SceneMeshMerger.js';

/**
 * 跨 unit 静态合批：mergeUnitMaterials 只合 unit 内部同材质零件，
 * 跨 unit（76 个插座、21 个地漏）每个零件仍是独立 mesh + 独立材质实例。
 * 本模块把多个 unit 的静态零件按"材质外观 + 几何属性签名"分组，
 * 每组一个 THREE.BatchedMesh（一次 draw call），原始 mesh 从 unit 摘下暂存。
 *
 * 保留能力：
 * - 拾取：BatchedMesh.raycast 返回 batchId，batch.userData.batchUserData 映射回
 *   源 userData（unit 元数据 + 零件元数据合并），HouseScene.targetFromIntersects 据此解析。
 * - 可见性：setUnitVisible 桥接 unit 级 visible 开关（机电总览等按组切换）。
 * - GLB 导出：restoreScopes() 把原始 mesh 挂回原父级（GLTFExporter 不认 BatchedMesh），
 *   导出后 reapplyScopes() 重新合批。
 *
 * 不适合合批的对象（调用方负责排除）：
 * - 材质需要逐 unit 突变（家具碰撞分析的 emissive 红闪）。
 * - 有动态行为（滑动门、窗帘、灯光灯具的逐灯 emissive）。
 */

interface BatchItem {
  unit: THREE.Object3D;
  mesh: THREE.Mesh;
  relMatrix: THREE.Matrix4;
}

interface BatchGroup {
  material: THREE.Material;
  items: BatchItem[];
}

interface BatchRecord {
  mesh: THREE.BatchedMesh;
  entriesByUnit: Map<THREE.Object3D, number[]>;
}

interface ScopeState {
  units: THREE.Object3D[];
  parent: THREE.Object3D;
  records: BatchRecord[];
  stashed: Array<{ mesh: THREE.Mesh; originalParent: THREE.Object3D }>;
}

export class SceneBatcher {
  private scopes = new Map<string, ScopeState>();
  private restored = new Map<string, { units: THREE.Object3D[]; parent: THREE.Object3D }>();

  static isSupported(): boolean {
    return typeof (THREE as { BatchedMesh?: unknown }).BatchedMesh === 'function';
  }

  batchScope(scope: string, units: THREE.Object3D[], parent: THREE.Object3D): void {
    this.clearScope(scope);
    this.restored.delete(scope);
    if (!SceneBatcher.isSupported() || units.length === 0) return;
    // 测试用 mock 对象（无 updateWorldMatrix/traverse）不支持合批，直接跳过
    if (typeof (parent as { updateWorldMatrix?: unknown }).updateWorldMatrix !== 'function') return;

    parent.updateWorldMatrix(true, false);
    const parentInverse = parent.matrixWorld.clone().invert();
    const groups = new Map<string, BatchGroup>();

    for (const unit of units) {
      if (typeof (unit as { updateWorldMatrix?: unknown }).updateWorldMatrix !== 'function'
        || typeof unit.traverse !== 'function') continue;
      unit.updateWorldMatrix(true, true);
      unit.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (mesh.userData.noBatch || mesh.userData.noMerge) return;
        if (Array.isArray(mesh.material)) return;
        if (mesh.raycast !== THREE.Mesh.prototype.raycast) return;
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
        if (mesh.geometry?.morphAttributes && Object.keys(mesh.geometry.morphAttributes).length > 0) return;
        if (!mesh.geometry?.attributes?.position) return;
        const material = mesh.material as THREE.Material;
        const key = `${materialKey(material)}#${geometrySignature(mesh.geometry)}`;
        let group = groups.get(key);
        if (!group) {
          group = { material, items: [] };
          groups.set(key, group);
        }
        group.items.push({
          unit,
          mesh,
          relMatrix: new THREE.Matrix4().multiplyMatrices(parentInverse, mesh.matrixWorld),
        });
      });
    }

    const state: ScopeState = { units, parent, records: [], stashed: [] };

    for (const group of groups.values()) {
      if (group.items.length < 2) continue; // 单件不合批，留在原位
      let vertexCount = 0;
      let indexCount = 0;
      for (const item of group.items) {
        const geometry = item.mesh.geometry;
        vertexCount += geometry.attributes.position.count as number;
        indexCount += geometry.index ? geometry.index.count : (geometry.attributes.position.count as number);
      }

      let batch: THREE.BatchedMesh;
      try {
        batch = new THREE.BatchedMesh(group.items.length, vertexCount, Math.max(indexCount, 1), group.material);
      } catch {
        continue; // 分配失败：该组保持原样渲染
      }
      batch.name = `batch:${scope}:${state.records.length}`;
      batch.userData.isSceneBatch = true;
      batch.userData.batchUserData = new Map<number, Record<string, unknown>>();

      const record: BatchRecord = { mesh: batch, entriesByUnit: new Map() };
      const added: BatchItem[] = [];
      let ok = true;
      for (const item of group.items) {
        let id: number;
        try {
          const geometryId = batch.addGeometry(item.mesh.geometry);
          id = batch.addInstance(geometryId);
        } catch {
          ok = false; // 属性不兼容等：该组全部保持原样渲染
          break;
        }
        batch.setMatrixAt(id, item.relMatrix);
        batch.setVisibleAt(id, item.unit.visible && item.mesh.visible);
        (batch.userData.batchUserData as Map<number, Record<string, unknown>>)
          .set(id, { ...item.unit.userData, ...item.mesh.userData });
        const entries = record.entriesByUnit.get(item.unit) ?? [];
        entries.push(id);
        record.entriesByUnit.set(item.unit, entries);
        added.push(item);
      }
      if (!ok) {
        batch.dispose();
        continue;
      }

      batch.castShadow = added.some((item) => item.mesh.castShadow);
      batch.receiveShadow = added.some((item) => item.mesh.receiveShadow);
      parent.add(batch);
      state.records.push(record);
      for (const item of added) {
        const originalParent = item.mesh.parent;
        if (!originalParent) continue;
        originalParent.remove(item.mesh);
        state.stashed.push({ mesh: item.mesh, originalParent });
      }
    }

    this.scopes.set(scope, state);
  }

  /** 桥接 unit 级 visible 开关到批内 per-object visibility。 */
  setUnitVisible(unit: THREE.Object3D, visible: boolean): void {
    for (const state of this.scopes.values()) {
      for (const record of state.records) {
        const entries = record.entriesByUnit.get(unit);
        if (!entries) continue;
        for (const id of entries) record.mesh.setVisibleAt(id, visible);
      }
    }
  }

  /** 对某 scope 的批次材质统一改参（如门换色 topic 全量同色）；暂存的原始材质不在此改，调用方自行同步。 */
  updateScopeMaterials(scope: string, fn: (material: THREE.Material) => void): void {
    const state = this.scopes.get(scope);
    if (!state) return;
    for (const record of state.records) fn(record.mesh.material as THREE.Material);
  }

  /** 把暂存的原始 mesh 挂回原父级并移除批次（GLB 导出前调用，导出后须 reapplyScopes）。 */
  restoreScopes(): void {
    for (const [scope, state] of this.scopes) {
      for (const record of state.records) {
        record.mesh.parent?.remove(record.mesh);
        record.mesh.dispose();
      }
      for (const { mesh, originalParent } of state.stashed) {
        if (!mesh.parent) originalParent.add(mesh);
      }
      this.restored.set(scope, { units: state.units, parent: state.parent });
      this.scopes.delete(scope);
    }
  }

  /** 导出后按原 scope 定义重新合批。 */
  reapplyScopes(): void {
    const definitions = [...this.restored.entries()];
    this.restored.clear();
    for (const [scope, def] of definitions) this.batchScope(scope, def.units, def.parent);
  }

  /** 场景重建时调用：销毁批次，暂存 mesh 不挂回（随旧场景整体丢弃）。 */
  clearScope(scope: string): void {
    const state = this.scopes.get(scope);
    if (!state) return;
    for (const record of state.records) {
      record.mesh.parent?.remove(record.mesh);
      record.mesh.dispose();
    }
    this.scopes.delete(scope);
  }

  disposeAll(): void {
    for (const scope of [...this.scopes.keys()]) this.clearScope(scope);
    this.restored.clear();
  }
}
