import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { load } from 'js-yaml';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { parseSceneInput } from '../../shared/render/scene-input.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { TextureManager } from '../../app/src/render/TextureManager.js';

// 共墙按面给材质（DEC-2026-10-07-R12）：墙左右两侧贴邻不同房间时使用材质数组，
// 两个大侧面各归属贴邻房间（修复儿童房东墙被刷成客卫墙砖的"材质串脸"）。
// 三层断言：结构（faceRooms/faceSlots/数组实例独立）、过渡拆分（沿墙房间变化处切分）、
// 语义方向（left = 行进方向左侧贴邻房间）。

const MG: any = load(readFileSync('config/layout/model-geometry.yaml', 'utf8'));

function resolvedWalls(): Array<{ id: string; x1: number; z1: number; x2: number; z2: number; height: number }> {
  const V: Record<string, { x: number; z: number }> = {};
  for (const v of MG.vertices) V[v.id] = { x: v.x, z: v.z };
  return MG.walls.map((w: any) => ({ id: w.id, x1: V[w.from].x, z1: V[w.from].z, x2: V[w.to].x, z2: V[w.to].z, height: w.height ?? 2.8 }));
}

function sceneWithFaces() {
  // 与 App 同路径：walls 先经 parseSceneInput 转成 wall 元素，buildScene 才会建墙 mesh。
  const input = parseSceneInput({
    rooms: resolveLayout(MG).rooms,
    walls: resolvedWalls(),
    elements: [],
    furnishings: {},
  });
  return buildScene({ ...input, furnishings: {} } as any);
}

function wallMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((object: any) => { if (object.userData?.type === 'wall') out.push(object as THREE.Mesh); });
  return out;
}

function meshesOfWall(root: THREE.Object3D, wallId: string): THREE.Mesh[] {
  return wallMeshes(root).filter((mesh) => {
    const id = String(mesh.userData.objectId);
    return id === wallId || id.startsWith(`${wallId}:`) || id.startsWith(`${wallId}.`);
  });
}

test('异 finish 共墙用材质数组且左右面归属正确（w_gbath_west）', () => {
  const scene = sceneWithFaces();
  const meshes = meshesOfWall(scene.exportRoot, 'w_gbath_west');
  assert.equal(meshes.length, 1, 'w_gbath_west 全长两侧房间不变，不应拆分');
  const mesh = meshes[0];
  const materials = mesh.material as THREE.Material[];
  assert.ok(Array.isArray(materials), '客卫西墙（客卫|西北次卧）应使用材质数组');
  assert.equal(materials.length, 6);
  assert.deepEqual(mesh.userData.faceRooms, { left: 'bedroom_nw', right: 'guest_bath' });
  const slots = mesh.userData.faceSlots as { left: number; right: number };
  assert.ok(slots.left === 4 || slots.left === 5, `侧面槽位应为 4 或 5，实际 ${slots.left}`);
  assert.equal(slots.right, 9 - slots.left, '左右槽位应为 +Z/−Z 一对');
  assert.notEqual(materials[slots.left], materials[slots.right], '两侧面材质实例必须独立');
  assert.equal(materials[0], materials[1], '两端头槽位共用基础材质');
});

test('同房间两脸与单侧临空墙保持单材质（w_gbath_south / w_st_north）', () => {
  const scene = sceneWithFaces();
  for (const mesh of meshesOfWall(scene.exportRoot, 'w_gbath_south')) {
    assert.ok(!Array.isArray(mesh.material), '客卫南墙两侧同为 guest_bath，应保持单材质');
    assert.equal(mesh.userData.faceRooms, undefined);
  }
  for (const mesh of meshesOfWall(scene.exportRoot, 'w_st_north')) {
    assert.ok(!Array.isArray(mesh.material), '书房北墙北侧临走廊（无房间），应保持单材质');
    assert.equal(mesh.userData.faceRooms, undefined);
  }
});

test('沿墙房间变化处拆分（w_mbath_east：主卫段 / 主卧段）', () => {
  const scene = sceneWithFaces();
  const meshes = meshesOfWall(scene.exportRoot, 'w_mbath_east');
  assert.equal(meshes.length, 2, 'w_mbath_east 西侧在 z=2.86 由主卫换为主卧，应拆成两段');
  const faceRoomsList = meshes.map((mesh) => mesh.userData.faceRooms as { left: string | null; right: string | null });
  assert.deepEqual(
    faceRoomsList.filter((face) => face.left === 'master_bath'),
    [{ left: 'master_bath', right: 'bedroom_nw' }],
    '北段（z<2.86）西侧为主卫',
  );
  assert.deepEqual(
    faceRoomsList.filter((face) => face.left === 'master_bedroom'),
    [{ left: 'master_bedroom', right: 'bedroom_nw' }],
    '南段（z>2.86）西侧为主卧',
  );
  for (const mesh of meshes) {
    assert.ok(Array.isArray(mesh.material), '两段两侧房间都不同，都应使用材质数组');
  }
});

test('局部临空墙拆出临空段（w_balc_west：北端 0.10m 临风洞）', () => {
  const scene = sceneWithFaces();
  const meshes = meshesOfWall(scene.exportRoot, 'w_balc_west');
  assert.equal(meshes.length, 2, '阳台西墙 z[1.00,1.10] 段西侧临空（次卧北墙凹进），应单独成段');
  const spaned = meshes.filter((mesh) => Array.isArray(mesh.material));
  assert.equal(spaned.length, 1, '仅 z[1.10,2.20] 段两侧都有房间，使用材质数组');
  assert.deepEqual(spaned[0].userData.faceRooms, { left: 'bedroom_nw', right: 'balcony' });
  const bare = meshes.filter((mesh) => !Array.isArray(mesh.material));
  assert.equal(bare.length, 1);
  assert.equal(bare[0].userData.faceRooms, undefined);
});

test('厨房东墙按面归属（w_ent_west：南段客餐厅 | 北段厨房，东侧全程入户花园）', () => {
  const scene = sceneWithFaces();
  const meshes = meshesOfWall(scene.exportRoot, 'w_ent_west');
  assert.ok(meshes.length >= 2, '西侧在 z=2.40 由客餐厅换为厨房，应拆分');
  const faced = meshes.filter((mesh) => Array.isArray(mesh.material));
  assert.ok(faced.length >= 2, '入户花园(unpainted) 与西侧各房间 finish 不同，均应使用材质数组');
  const pairs = faced.map((mesh) => {
    const pair = mesh.userData.faceRooms as { left: string | null; right: string | null };
    return [pair.left, pair.right].sort().join('|');
  });
  assert.ok(
    pairs.some((pair) => pair === 'entry_garden|kitchen'),
    `应存在 厨房|入户花园 面，实际 ${pairs.join(' / ')}`,
  );
  assert.ok(
    pairs.some((pair) => pair === 'entry_garden|living_dining'),
    `应存在 客餐厅|入户花园 面，实际 ${pairs.join(' / ')}`,
  );
});

test('TextureManager.applyToRoom 只染 faceRooms 命中的侧面槽位', () => {
  const tm = new TextureManager([]);
  const slots: Array<{ copyCalls: number; needsUpdate: boolean; copy: () => void }> = Array.from({ length: 6 }, () => ({
    copyCalls: 0,
    needsUpdate: false,
    copy(this: { copyCalls: number; needsUpdate: boolean }) { this.copyCalls++; this.needsUpdate = true; },
  }));
  const wallMesh = {
    material: slots,
    userData: { faceRooms: { left: 'bedroom_nw', right: 'guest_bath' }, faceSlots: { left: 5, right: 4 } },
  };
  tm.setMeshes([], [wallMesh as unknown as THREE.Mesh], []);

  const appearance = { type: 'ceramic_tile_v2', color: '#f5f5f5' } as const;
  tm.applyToRoom('guest_bath', appearance, 'wall');
  assert.equal(slots[4].copyCalls, 1, 'guest_bath 贴右侧（槽位 4），应被染');
  assert.equal(slots[5].copyCalls, 0, 'bedroom_nw 侧面（槽位 5）不应被 guest_bath 触碰');
  assert.equal(slots[4].needsUpdate, true);

  tm.applyToRoom('bedroom_nw', appearance, 'wall');
  assert.equal(slots[5].copyCalls, 1, 'bedroom_nw 贴左侧（槽位 5），应被染');
  assert.equal(slots[4].copyCalls, 1, 'bedroom_nw 应用不应重复染 guest_bath 侧面');
});

test('TextureManager.applyToRoom 对畸形 face 数据安全跳过', () => {
  const tm = new TextureManager([]);
  const noSlots = { material: [], userData: { faceRooms: { left: 'a', right: 'b' } } };
  const wholeMesh = { material: { copyCalls: 0, copy(this: { copyCalls: number }) { this.copyCalls++; } }, userData: { roomId: 'guest_bath' } };
  tm.setMeshes([], [noSlots as unknown as THREE.Mesh, wholeMesh as unknown as THREE.Mesh], []);
  assert.doesNotThrow(() => tm.applyToRoom('guest_bath', { type: 'ceramic_tile_v2', color: '#fff' }, 'wall'));
  assert.equal((wholeMesh.material as { copyCalls: number }).copyCalls, 1, '单材质墙仍走 roomId 整体匹配');
});
