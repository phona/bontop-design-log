import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SceneBatcher } from './SceneBatcher.js';

function makeUnit(name: string, material: THREE.Material, x: number): THREE.Group {
  const unit = new THREE.Group();
  unit.name = name;
  unit.userData = { type: 'electrical', objectId: name, roomId: 'living_dining' };
  const part = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02), material);
  part.name = `${name}:part:0`;
  part.position.set(0, 1, 0);
  unit.add(part);
  unit.position.set(x, 0, 0);
  return unit;
}

describe('SceneBatcher', () => {
  it('同外观零件跨 unit 合为一个 BatchedMesh，原 mesh 摘下暂存', () => {
    const parent = new THREE.Group();
    const units = [0, 1, 2].map((i) => makeUnit(`electrical:sock_${i}`, new THREE.MeshStandardMaterial({ color: 0xffffff }), i));
    units.forEach((u) => parent.add(u));

    const batcher = new SceneBatcher();
    batcher.batchScope('electrical', units, parent);

    const batches = parent.children.filter((c) => c.userData.isSceneBatch);
    expect(batches).toHaveLength(1);
    for (const unit of units) {
      expect(unit.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(0);
    }
  });

  it('不同材质外观分成不同批次；单件组留在原位', () => {
    const parent = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const black = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const units = [
      makeUnit('electrical:a', white, 0),
      makeUnit('electrical:b', white, 1),
      makeUnit('electrical:c', black, 2),
    ];
    units.forEach((u) => parent.add(u));

    const batcher = new SceneBatcher();
    batcher.batchScope('electrical', units, parent);

    const batches = parent.children.filter((c) => c.userData.isSceneBatch);
    expect(batches).toHaveLength(1); // 白色两件合批；黑色单件不合批
    expect(units[2].children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(1);
  });

  it('batchUserData 合并 unit 与零件元数据，供拾取解析', () => {
    const parent = new THREE.Group();
    const units = [0, 1].map((i) => makeUnit(`electrical:sock_${i}`, new THREE.MeshStandardMaterial(), i));
    units.forEach((u) => parent.add(u));

    const batcher = new SceneBatcher();
    batcher.batchScope('electrical', units, parent);

    const batch = parent.children.find((c) => c.userData.isSceneBatch) as THREE.BatchedMesh;
    const map = batch.userData.batchUserData as Map<number, Record<string, unknown>>;
    expect(map.size).toBe(2);
    const objectIds = [...map.values()].map((d) => d.objectId);
    expect(objectIds).toContain('electrical:sock_0');
    expect(objectIds).toContain('electrical:sock_1');
  });

  it('setUnitVisible 桥接到批内 per-object visibility', () => {
    const parent = new THREE.Group();
    const units = [0, 1].map((i) => makeUnit(`electrical:sock_${i}`, new THREE.MeshStandardMaterial(), i));
    units.forEach((u) => parent.add(u));

    const batcher = new SceneBatcher();
    batcher.batchScope('electrical', units, parent);

    const batch = parent.children.find((c) => c.userData.isSceneBatch) as THREE.BatchedMesh;
    expect(batch.getVisibleAt(0)).toBe(true);
    batcher.setUnitVisible(units[0], false);
    const map = batch.userData.batchUserData as Map<number, Record<string, unknown>>;
    const hiddenId = [...map.entries()].find(([, d]) => d.objectId === 'electrical:sock_0')![0];
    expect(batch.getVisibleAt(hiddenId)).toBe(false);
    const otherId = [...map.entries()].find(([, d]) => d.objectId === 'electrical:sock_1')![0];
    expect(batch.getVisibleAt(otherId)).toBe(true);
  });

  it('restoreScopes 挂回原 mesh，reapplyScopes 重新合批', () => {
    const parent = new THREE.Group();
    const units = [0, 1].map((i) => makeUnit(`electrical:sock_${i}`, new THREE.MeshStandardMaterial(), i));
    units.forEach((u) => parent.add(u));

    const batcher = new SceneBatcher();
    batcher.batchScope('electrical', units, parent);
    expect(parent.children.filter((c) => c.userData.isSceneBatch)).toHaveLength(1);

    batcher.restoreScopes();
    expect(parent.children.filter((c) => c.userData.isSceneBatch)).toHaveLength(0);
    for (const unit of units) {
      expect(unit.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(1);
    }

    batcher.reapplyScopes();
    expect(parent.children.filter((c) => c.userData.isSceneBatch)).toHaveLength(1);
    for (const unit of units) {
      expect(unit.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(0);
    }
  });

  it('clearScope 销毁批次且不挂回原 mesh（场景重建语义）', () => {
    const parent = new THREE.Group();
    const units = [0, 1].map((i) => makeUnit(`electrical:sock_${i}`, new THREE.MeshStandardMaterial(), i));
    units.forEach((u) => parent.add(u));

    const batcher = new SceneBatcher();
    batcher.batchScope('electrical', units, parent);
    batcher.clearScope('electrical');

    expect(parent.children.filter((c) => c.userData.isSceneBatch)).toHaveLength(0);
    for (const unit of units) {
      expect(unit.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(0);
    }
  });
});
