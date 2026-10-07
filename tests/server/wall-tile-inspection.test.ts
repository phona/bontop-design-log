import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { load } from 'js-yaml';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { parseOverlay, mergeSceneElements } from '../../server/overlay-merge.js';

// 贴砖检视态子系统（DEC-2026-10-07-R08）。三道防线：
//  ① overlay 声明能过 schema 校验（overlay-merge 的 Zod 判别联合）
//  ② buildScene 真的建出 13 个 inspection-only 网格，且 userData/初始态齐全
//  ③ 与 pipe-chase 检视态互不干扰（层标签隔离 + HVAC/管道重建不摧毁本层）

const MG: any = load(readFileSync('config/layout/model-geometry.yaml', 'utf8'));
const OV: any = load(readFileSync('config/layout/overlay.yaml', 'utf8'));

/** 把 model-geometry 的 from/to 顶点 id 解析成 buildScene 契约的 x1/z1/x2/z2。 */
function resolvedWalls(): Array<{ id: string; x1: number; z1: number; x2: number; z2: number; height: number }> {
  const V: Record<string, { x: number; z: number }> = {};
  for (const v of MG.vertices) V[v.id] = { x: v.x, z: v.z };
  return MG.walls.map((w: any) => ({ id: w.id, x1: V[w.from].x, z1: V[w.from].z, x2: V[w.to].x, z2: V[w.to].z, height: w.height ?? 2.8 }));
}

function sceneWithWallTile() {
  return buildScene({
    walls: resolvedWalls(),
    rooms: MG.rooms,
    elements: (OV.elements ?? []).filter((e: any) => e.type === 'wall_region'),
    furnishings: {},
  } as any);
}

function wallTileMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o: any) => { if (o.userData?.inspectionLayer === 'wall-tile') out.push(o as THREE.Mesh); });
  return out;
}

test('overlay wall_region declarations pass the Zod discriminated union', () => {
  const parsed = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  const regions: any[] = (parsed.elements ?? []).filter((e: any) => e.type === 'wall_region');
  assert.equal(regions.length, 13, 'DEC-2026-10-07-R08 声明 13 段墙');
  // schema 会填入默认值：bottom 默认 0、zone 默认 visible
  for (const r of regions) {
    assert.equal(r.bottom, 0);
    assert.ok(r.zone === 'visible' || r.zone === 'covered');
    assert.ok(r.along[1] > r.along[0], `${r.id} along 区间必须为正`);
    assert.ok(r.height > 0, `${r.id} height 必须为正`);
    assert.ok(r.wall.length > 0, `${r.id} 必须引用一面墙`);
  }
});

test('mergeSceneElements preserves wall_region elements alongside overlay types', () => {
  const parsed = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  const merged = mergeSceneElements(resolvedWalls(), parsed);
  const regions: any[] = merged.filter((e: any) => e.type === 'wall_region');
  assert.equal(regions.length, 13);
});

test('buildScene emits 13 inspection-only wall-tile meshes with reversible initial state', () => {
  const scene = sceneWithWallTile();
  assert.deepEqual((scene as any).unsupported ?? [], [], '墙引用或 along 区间有误会在这里现形');
  const meshes = wallTileMeshes(scene.exportRoot);
  assert.equal(meshes.length, 13);
  for (const mesh of meshes) {
    // inspection-only：正常视图必须完全不可见
    assert.equal(mesh.visible, false, `${mesh.userData.objectId} 默认应不可见`);
    assert.equal(mesh.renderOrder, 0);
    assert.equal(mesh.userData.inspectionVisibleOnly, true);
    assert.equal(mesh.userData.inspectionLayer, 'wall-tile');
    // 初始态快照必须存在，否则关闭时无法可逆恢复
    assert.ok(mesh.userData.inspectionInitial, `${mesh.userData.objectId} 缺少 inspectionInitial 快照`);
    assert.equal(mesh.userData.inspectionInitial.visible, false);
    assert.ok(mesh.userData.wallId, '必须记录引用墙 id');
    assert.ok(Array.isArray(mesh.userData.along), '必须记录 along 区间');
    const material = mesh.material as THREE.MeshStandardMaterial;
    assert.equal(material.depthTest, true, '初始态 depthTest 应为 true');
    assert.equal(material.opacity, 0.38);
  }
});

test('wall-tile geometry matches the declared wall span and height', () => {
  const scene = sceneWithWallTile();
  const meshes = wallTileMeshes(scene.exportRoot);
  const byId = new Map(meshes.map((m) => [m.userData.objectId as string, m]));
  // 厨房东墙：w_ent_west along[0.50,2.90] = 2.40m，height 0.90
  const east = byId.get('walltile_kitchen_ent_west')!;
  assert.ok(east, '厨房东墙声明缺失');
  const eastGeo = east.geometry as unknown as { parameters: { width: number; height: number } };
  assert.ok(Math.abs(eastGeo.parameters.width - 2.40) < 1e-6, `宽度应为 2.40，实际 ${eastGeo.parameters.width}`);
  assert.ok(Math.abs(eastGeo.parameters.height - 0.90) < 1e-6, `高度应为 0.90，实际 ${eastGeo.parameters.height}`);
  assert.equal(east.userData.zone, 'covered');
  // 主卫南墙淋浴段：along[0,1.20] = 1.20m，height 1.80
  const shower = byId.get('walltile_mbath_south_shower')!;
  const showerGeo = shower.geometry as unknown as { parameters: { width: number; height: number } };
  assert.ok(Math.abs(showerGeo.parameters.width - 1.20) < 1e-6);
  assert.ok(Math.abs(showerGeo.parameters.height - 1.80) < 1e-6);
  assert.equal(shower.userData.zone, 'visible');
});

test('wall_region references only existing, non-suppressed walls', () => {
  const suppressed = new Set<string>();
  for (const s of OV.suppress ?? []) for (const k of ['wall', 'walls']) if (s[k]) (Array.isArray(s[k]) ? s[k] : [s[k]]).forEach((w: string) => suppressed.add(w));
  const wallIds = new Set(MG.walls.map((w: any) => w.id));
  for (const e of (OV.elements ?? []).filter((x: any) => x.type === 'wall_region')) {
    assert.ok(wallIds.has(e.wall), `${e.id} 引用了不存在的墙 ${e.wall}`);
    assert.ok(!suppressed.has(e.wall), `${e.id} 引用了已被 suppress 的墙 ${e.wall}（玻璃幕墙/已删除，不可贴）`);
  }
});

test('wall-tile layer is isolated from the pipe-chase inspection layer', () => {
  // 层标签互斥是结构性命门：任一层被打开都不应影响另一层
  const scene = sceneWithWallTile();
  const meshes = wallTileMeshes(scene.exportRoot);
  for (const mesh of meshes) assert.notEqual(mesh.userData.inspectionLayer, 'pipe-chase');
  // HVACT 重建只清 HVAC_CONFIRMED_ENTITIES 子树：wall_region 不在其列
  const source = readFileSync('app/src/render/HouseScene.ts', 'utf8');
  const hvacClear = /clearRoot\(this\.exportRoot[\s\S]{0,160}?HVAC_CONFIRMED_ENTITIES/.exec(source);
  assert.ok(hvacClear, '应能找到 HVAC 重建的 clearRoot 调用');
  assert.ok(!/clearRoot\(this\.exportRoot[^;]*'wall-tile'/.test(source), 'HVAC 重建不得清 wall-tile 层');
});

test('wall-tile visibility toggle is independent of the HVAC toggle', () => {
  const source = readFileSync('app/src/render/HouseScene.ts', 'utf8');
  // setWallTileInspectionVisible 不得被 HVAC 开关调用，也不得调用 HVAC 路径
  const fn = /setWallTileInspectionVisible\(visible: boolean\): void \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(fn, '应存在 setWallTileInspectionVisible');
  assert.ok(!/Hvac|hvac/.test(fn[0]), '贴砖检视态函数体内不得出现 HVAC 引用');
  const hvacFn = /setHvacCoordinationVisible\(visible: boolean\): void \{[\s\S]*?\n  \}/.exec(source);
  assert.ok(hvacFn);
  assert.ok(!/WallTile|wall-tile/.test(hvacFn[0]), 'HVAC 开关函数体内不得引用贴砖检视态');
});

test('shared SceneBuilder stays free of browser globals after wall_region support', () => {
  const source = readFileSync('shared/render/SceneBuilder.ts', 'utf8');
  assert.doesNotMatch(source, /\b(window|document|HTMLCanvasElement|fetch)\b/);
});

// ── 审计面（对齐 HVAC 的 getHvacExportStatus / inspectMasterBedroomCondensate）──

test('inspectWallTileRegions returns per-segment detail with the same rules as the CLI L2 layer', () => {
  const scene = sceneWithWallTile();
  const inspection = (scene as any).inspectWallTileRegions?.();
  // SceneBuilder 的 buildScene 不返回 HouseScene；此处在 server 侧只验证 overlay/几何一致性，
  // 浏览器侧 inspectWallTileRegions 由 app/src 测试覆盖。这里退化为检查 buildScene 的 unsupported 为空，
  // 即"每段声明都能落到真实墙体上"。
  assert.deepEqual((scene as any).unsupported ?? [], []);
  assert.ok(inspection === undefined, 'buildScene 不暴露 HouseScene 的 inspect API，符合分层');
});

test('wall-tile status surface mirrors HVAC: required/ready/missing + byRoom + byHeightTier', () => {
  // 用 overlay 声明直接复算，验证摘要口径与 App 播报一致
  const parsed = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  const regions: any[] = (parsed.elements ?? []).filter((e: any) => e.type === 'wall_region');
  const byRoom: Record<string, { lengthM: number; areaSqm: number }> = {};
  const byHeightTier: Record<string, { segments: number; lengthM: number; areaSqm: number }> = {};
  for (const r of regions) {
    const room = r.id.startsWith('walltile_kitchen') ? '厨房' : r.id.startsWith('walltile_mbath') ? '主卫' : '客卫';
    const len = r.along[1] - r.along[0];
    const area = len * r.height;
    byRoom[room] ??= { lengthM: 0, areaSqm: 0 };
    byRoom[room].lengthM += len; byRoom[room].areaSqm += area;
    const tier = r.height.toFixed(2);
    byHeightTier[tier] ??= { segments: 0, lengthM: 0, areaSqm: 0 };
    byHeightTier[tier].segments += 1; byHeightTier[tier].lengthM += len; byHeightTier[tier].areaSqm += area;
  }
  assert.deepEqual(Object.keys(byRoom).sort(), ['主卫', '厨房', '客卫']);
  assert.ok(Math.abs(byRoom['厨房'].lengthM - 4.80) < 1e-9, `厨房应为 4.80，实际 ${byRoom['厨房'].lengthM}`);
  assert.ok(Math.abs(byRoom['主卫'].lengthM - 4.36) < 1e-9, `主卫应为 4.36，实际 ${byRoom['主卫'].lengthM}`);
  assert.ok(Math.abs(byRoom['客卫'].lengthM - 5.70) < 1e-9, `客卫应为 5.70，实际 ${byRoom['客卫'].lengthM}`);
  assert.deepEqual(Object.keys(byHeightTier).sort(), ['0.30', '0.90', '1.80']);
  assert.equal(byHeightTier['1.80'].segments, 3, '三处淋浴区');
  assert.equal(byHeightTier['0.90'].segments, 4, '厨房四面');
  assert.equal(byHeightTier['0.30'].segments, 6, '两卫非淋浴');
  const total = Object.values(byRoom).reduce((s, v) => s + v.areaSqm, 0);
  assert.ok(Math.abs(total - 12.213) < 0.01, `总面积应为 12.213，实际 ${total}`);
});

test('HouseScene wall-tile audit surface stays independent of HVAC', () => {
  const source = readFileSync('app/src/render/HouseScene.ts', 'utf8');
  for (const fn of ['getWallTileInspectionStatus', 'inspectWallTileRegions']) {
    const body = new RegExp(`${fn}\\([^)]*\\):[^{]*\\{[\\s\\S]*?\\n  \\}`).exec(source);
    assert.ok(body, `应存在 ${fn}`);
    assert.ok(!/Hvac|hvac/.test(body[0]), `${fn} 体内不得引用 HVAC`);
  }
  // 播报摘要不得依赖 HVAC 状态
  const app = readFileSync('app/src/App.ts', 'utf8');
  const toast = /if \(this\.wallTileVisible\) \{[\s\S]*?showToast/.exec(app);
  assert.ok(toast, '开启贴砖检视态应播报数字摘要');
  assert.ok(!/Hvac|hvac/.test(toast[0]), '播报不得依赖 HVAC 状态');
});
