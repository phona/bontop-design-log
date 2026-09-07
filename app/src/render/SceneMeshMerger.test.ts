import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { mergeUnitMaterials } from './SceneMeshMerger.js';

function partMesh(color: number, x: number, y = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 }),
  );
  mesh.position.set(x, y, 0);
  return mesh;
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
  });
  return meshes;
}

describe('SceneMeshMerger.mergeUnitMaterials', () => {
  it('同参材质去重合并，包围盒与拾取元数据保留（含嵌套子组）', () => {
    const unit = new THREE.Group();
    unit.name = 'furniture:living_dining:bench:0';
    unit.userData = { type: 'furniture', objectId: 'furniture:living_dining:bench:0', exportName: 'furniture:living_dining:bench:0' };
    const a = partMesh(0xaa0000, -1);
    const b = partMesh(0xaa0000, 1);
    for (const part of [a, b]) part.userData = { objectId: unit.userData.objectId, roomId: 'living_dining' };
    const nested = new THREE.Group();
    nested.position.set(0, 2, 0);
    nested.add(partMesh(0x00aa00, 0));
    unit.add(a, b, nested);

    const beforeBox = new THREE.Box3().setFromObject(unit);
    const result = mergeUnitMaterials(unit);

    expect(result.before).toBe(3);
    expect(result.after).toBe(2);
    expect(result.mergedMeshes).toBe(1);

    const meshes = collectMeshes(unit);
    expect(meshes).toHaveLength(2);
    const red = meshes.find((m) => (m.material as THREE.MeshStandardMaterial).color.getHex() === 0xaa0000);
    expect(red).toBeDefined();
    expect(red!.userData.objectId).toBe('furniture:living_dining:bench:0');
    expect(red!.userData.roomId).toBe('living_dining');
    expect(red!.userData.type).toBe('furniture');

    const afterBox = new THREE.Box3().setFromObject(unit);
    expect(afterBox.min.distanceTo(beforeBox.min)).toBeLessThan(1e-4);
    expect(afterBox.max.distanceTo(beforeBox.max)).toBeLessThan(1e-4);
  });

  it('被淘汰的重复材质实例被 dispose，保留材质不受影响', () => {
    const unit = new THREE.Group();
    const a = partMesh(0x0000ff, -1);
    const b = partMesh(0x0000ff, 1);
    unit.add(a, b);
    const duplicate = b.material as THREE.MeshStandardMaterial;
    const duplicateSpy = vi.spyOn(duplicate, 'dispose');
    const canonical = a.material as THREE.MeshStandardMaterial;
    const canonicalSpy = vi.spyOn(canonical, 'dispose');

    mergeUnitMaterials(unit);

    expect(duplicateSpy).toHaveBeenCalled();
    expect(canonicalSpy).not.toHaveBeenCalled();
  });

  it('noMerge 与替换过 raycast 的 mesh 不参与合并', () => {
    const unit = new THREE.Group();
    const merged1 = partMesh(0x112233, -1);
    const merged2 = partMesh(0x112233, 1);
    const noMerge = partMesh(0x112233, 3);
    noMerge.userData.noMerge = true;
    const customRaycast = partMesh(0x112233, 5);
    customRaycast.raycast = () => undefined;
    unit.add(merged1, merged2, noMerge, customRaycast);

    const result = mergeUnitMaterials(unit);

    expect(result.before).toBe(4);
    expect(result.after).toBe(3);
    const meshes = collectMeshes(unit);
    expect(meshes).toContain(noMerge);
    expect(meshes).toContain(customRaycast);
  });

  it('索引与非索引几何不混并', () => {
    const unit = new THREE.Group();
    const indexed = partMesh(0x445566, -1);
    const nonIndexed = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5).toNonIndexed(),
      new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.5, metalness: 0.1 }),
    );
    nonIndexed.position.set(1, 0, 0);
    unit.add(indexed, nonIndexed);

    const result = mergeUnitMaterials(unit);

    expect(result.before).toBe(2);
    expect(result.after).toBe(2);
  });

  it('单零件组只做材质复用，不做几何合并', () => {
    const unit = new THREE.Group();
    const only = partMesh(0x778899, 0);
    unit.add(only);

    const result = mergeUnitMaterials(unit);

    expect(result.before).toBe(1);
    expect(result.after).toBe(1);
    expect(collectMeshes(unit)[0]).toBe(only);
  });
});
