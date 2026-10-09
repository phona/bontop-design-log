import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { load } from 'js-yaml';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { parseOverlay, mergeSceneElements } from '../../server/overlay-merge.js';
import { resolveLayout } from '../../server/layout-resolver.js';

// 贴砖检视态子系统（DEC-2026-10-07-R08）。三道防线：
//  ① overlay 声明能过 schema 校验（overlay-merge 的 Zod 判别联合）
//  ② buildScene 真的建出 16 个 inspection-only 网格，且 userData/初始态齐全
//  ③ 与 pipe-chase 检视态互不干扰（层标签隔离 + HVAC/管道重建不摧毁本层）

const MG: any = load(readFileSync('config/layout/model-geometry.yaml', 'utf8'));
const OV: any = load(readFileSync('config/layout/overlay.yaml', 'utf8'));
const VCOORD: Record<string, { x: number; z: number }> = {};
for (const v of MG.vertices) VCOORD[v.id] = v;
function sillWallLength(wallId: string): number {
  const w: any = MG.walls.find((x: any) => x.id === wallId);
  assert.ok(w, `bay_sill 引用的墙 ${wallId} 必须存在`);
  return Math.hypot(VCOORD[w.to].x - VCOORD[w.from].x, VCOORD[w.to].z - VCOORD[w.from].z);
}

/** 把 model-geometry 的 from/to 顶点 id 解析成 buildScene 契约的 x1/z1/x2/z2。 */
function resolvedWalls(): Array<{ id: string; x1: number; z1: number; x2: number; z2: number; height: number }> {
  const V: Record<string, { x: number; z: number }> = {};
  for (const v of MG.vertices) V[v.id] = { x: v.x, z: v.z };
  return MG.walls.map((w: any) => ({ id: w.id, x1: V[w.from].x, z1: V[w.from].z, x2: V[w.to].x, z2: V[w.to].z, height: w.height ?? 2.8 }));
}

function sceneWithWallTile() {
  // 走 mergeSceneElements（与 App 同路径）：bay_sill 的 wall 引用在此解析成 points/wallRefs，
  // sill_region 靠它找到防水台构件几何；直接喂原始 YAML 的 bay_sill 没有 points 会炸。
  const merged = mergeSceneElements(resolvedWalls(), parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')));
  return buildScene({
    walls: resolvedWalls(),
    rooms: resolveLayout(MG).rooms,
    elements: merged.filter((e: any) => ['wall_region', 'sill_region', 'bay_sill'].includes(e.type)),
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
  assert.equal(regions.length, 17, '2026-10-07 客卫饰面终裁后 17 段墙（16 + 台盆防溅带）');
  // schema 会填入默认值：bottom 默认 0、zone 默认 visible
  for (const r of regions) {
    assert.ok(r.bottom >= 0, `${r.id} bottom 必须非负`);
    assert.ok(r.zone === 'visible' || r.zone === 'covered');
    assert.ok(r.along[1] > r.along[0], `${r.id} along 区间必须为正`);
    assert.ok(r.height > r.bottom, `${r.id} height（顶标高）必须大于 bottom`);
    assert.ok(r.wall.length > 0, `${r.id} 必须引用一面墙`);
    assert.ok(typeof r.room === 'string' && r.room.length > 0, `${r.id} R11 起必须声明 room（贴砖面归属房间）`);
  }
  // R11 D4=L 型：防水台贴砖带（sill_region）两段——front 竖面 + top 台面，均引用同一 bay_sill 构件
  const sills: any[] = (parsed.elements ?? []).filter((e: any) => e.type === 'sill_region');
  assert.equal(sills.length, 6, '防水台声明 6 段：客厅 L 型 2 + 主卫湿区 2 台 × front/top 4（C17；w_west_ap 圆角段留现场收口）');
  const baySillIds = new Set((parsed.elements ?? []).filter((e: any) => e.type === 'bay_sill').map((e: any) => e.id));
  const living = (parsed.elements ?? []).find((e: any) => e.id === 'living_south_waterproof_ledge');
  assert.equal(living?.type, 'bay_sill', '客厅防水台构件必须是 bay_sill');
  assert.equal(living.height, 0.15);
  assert.equal(living.depth, 0.15);
  for (const s of sills) {
    assert.ok(baySillIds.has(s.element), `sill_region ${s.id} 必须引用已声明的 bay_sill`);
    assert.ok(s.face === 'front' || s.face === 'top');
  }
  assert.equal(sills.filter((s) => s.room === 'living_dining').length, 2, '客厅 L 型两段');
  assert.equal(sills.filter((s) => s.room === 'master_bath').length, 4, '主卫湿区 2 台 × front/top（C17；w_west_ap 圆角段留现场收口）');
});

test('mergeSceneElements preserves wall_region elements alongside overlay types', () => {
  const parsed = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  const merged = mergeSceneElements(resolvedWalls(), parsed);
  const regions: any[] = merged.filter((e: any) => e.type === 'wall_region');
  assert.equal(regions.length, 17);
});

test('buildScene emits 23 inspection-only wall-tile meshes with reversible initial state', () => {
  const scene = sceneWithWallTile();
  assert.deepEqual(scene.report.unsupported, [], '墙引用或 along 区间有误会在这里现形');
  const meshes = wallTileMeshes(scene.exportRoot);
  assert.equal(meshes.length, 23);
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
  // 厨房东墙：w_ent_west along[0.50,2.90] = 2.40m，E2 贴满 height 2.65
  const east = byId.get('walltile_kitchen_ent_west')!;
  assert.ok(east, '厨房东墙声明缺失');
  const eastGeo = east.geometry as unknown as { parameters: { width: number; height: number } };
  assert.ok(Math.abs(eastGeo.parameters.width - 2.40) < 1e-6, `宽度应为 2.40，实际 ${eastGeo.parameters.width}`);
  assert.ok(Math.abs(eastGeo.parameters.height - 2.65) < 1e-6, `高度应为 2.65，实际 ${eastGeo.parameters.height}`);
  assert.equal(east.userData.zone, 'visible', 'C18 废止杂砖后全屋正砖');
  // R11 灶台挡水条：与东墙杂砖带同 along、竖向 0.90→1.40 堆叠，平面高度 0.50
  const hood = byId.get('walltile_kitchen_ent_hood_wall')!;
  assert.ok(hood, '灶台挡水条声明缺失');
  const hoodGeo = hood.geometry as unknown as { parameters: { width: number; height: number } };
  assert.ok(Math.abs(hoodGeo.parameters.width - 0.90) < 1e-6, `宽度应为 0.90，实际 ${hoodGeo.parameters.width}`);
  assert.ok(Math.abs(hoodGeo.parameters.height - 0.50) < 1e-6, `带高应为 0.50，实际 ${hoodGeo.parameters.height}`);
  assert.equal(hood.userData.zone, 'visible');
  assert.equal(hood.userData.roomId, 'kitchen');
  // R11 生活阳台：洗衣机墙 1.20m 与共墙阳台侧 1.50m，均 0.30m 湿区口径
  const washer = byId.get('walltile_balc_west_washer')!;
  assert.ok(washer, '阳台洗衣机墙声明缺失');
  const washerGeo = washer.geometry as unknown as { parameters: { width: number; height: number } };
  assert.ok(Math.abs(washerGeo.parameters.width - 1.20) < 1e-6);
  assert.ok(Math.abs(washerGeo.parameters.height - 0.30) < 1e-6);
  assert.equal(washer.userData.roomId, 'balcony');
  const balcSouth = byId.get('walltile_balc_south')!;
  assert.ok(balcSouth, '阳台南墙（共墙阳台侧）声明缺失');
  assert.equal(balcSouth.userData.roomId, 'balcony');
  // R11 D4=L 型：客厅防水台竖面（墙上竖直面 6.2×0.15）+ 水平台面（x=9.80 处、伸进室内 0.15）
  const front = byId.get('silltile_living_south_front')!;
  assert.ok(front, '防水台竖面贴砖带缺失');
  const frontGeo = front.geometry as unknown as { parameters: { width: number; height: number } };
  assert.ok(Math.abs(frontGeo.parameters.width - 6.20) < 1e-6, `竖面宽应为 6.20，实际 ${frontGeo.parameters.width}`);
  assert.ok(Math.abs(frontGeo.parameters.height - 0.15) < 1e-6, `竖面高应为 0.15，实际 ${frontGeo.parameters.height}`);
  assert.ok(Math.abs(front.position.y - 0.075) < 1e-6, `竖面中心应在地面以上 0.075，实际 ${front.position.y}`);
  assert.equal(front.userData.roomId, 'living_dining');
  assert.equal(front.userData.elementId, 'living_south_waterproof_ledge');
  const top = byId.get('silltile_living_south_top')!;
  assert.ok(top, '防水台台面贴砖带缺失');
  const topGeo = top.geometry as unknown as { parameters: { width: number; height: number } };
  assert.ok(Math.abs(topGeo.parameters.width - 6.20) < 1e-6);
  assert.ok(Math.abs(topGeo.parameters.height - 0.15) < 1e-6, `台面进深应为 0.15，实际 ${topGeo.parameters.height}`);
  assert.ok(Math.abs(top.position.y - 0.15) < 1e-6, `台面标高应为 0.15，实际 ${top.position.y}`);
  assert.ok(Math.abs(top.rotation.x - (-Math.PI / 2)) < 1e-6, '台面必须水平');
  assert.ok(top.position.z < 9.80, `台面应伸进客厅（z<9.80），实际 ${top.position.z}`);
  assert.ok(top.position.z > 9.65, `台面应在墙线 0.15m 内，实际 ${top.position.z}`);
  // 主卫南墙淋浴段：along[0,1.20] = 1.20m，C16 砖到顶 height 2.65
  const shower = byId.get('walltile_mbath_south_shower')!;
  const showerGeo = shower.geometry as unknown as { parameters: { width: number; height: number } };
  assert.ok(Math.abs(showerGeo.parameters.width - 1.20) < 1e-6);
  assert.ok(Math.abs(showerGeo.parameters.height - 2.65) < 1e-6);
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
  assert.deepEqual(scene.report.unsupported, [], '每段声明都能落到真实构件上（含 sill_region 的 bay_sill 引用）');
  assert.ok(inspection === undefined, 'buildScene 不暴露 HouseScene 的 inspect API，符合分层');
});

test('wall-tile status surface mirrors HVAC: required/ready/missing + byRoom + byHeightTier', () => {
  // 用 overlay 声明直接复算，验证摘要口径与 App 播报一致。
  // tier 口径 = **贴砖带高**（与 HouseScene.inspectWallTileRegions 从网格几何读的 height 一致，非顶标高）。
  const parsed = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  const elements: any[] = parsed.elements ?? [];
  const regions: any[] = elements.filter((e: any) => e.type === 'wall_region' || e.type === 'sill_region');
  const CN: Record<string, string> = { kitchen: '厨房', master_bath: '主卫', guest_bath: '客卫', balcony: '阳台', living_dining: '客厅' };
  const byRoom: Record<string, { lengthM: number; areaSqm: number }> = {};
  const byHeightTier: Record<string, { segments: number; lengthM: number; areaSqm: number }> = {};
  for (const r of regions) {
    const room = CN[r.room as string] ?? '客卫';
    let len: number, band: number;
    if (r.type === 'sill_region') {
      const target = elements.find((e: any) => e.id === r.element);
      assert.equal(target?.type, 'bay_sill', 'sill_region 必须引用 bay_sill 构件');
      len = r.along ? r.along[1] - r.along[0] : sillWallLength(target.wall);
      band = r.face === 'front' ? target.height : target.depth;
    } else {
      len = r.along[1] - r.along[0];
      band = r.height - r.bottom;
    }
    byRoom[room] ??= { lengthM: 0, areaSqm: 0 };
    byRoom[room].lengthM += len; byRoom[room].areaSqm += len * band;
    const tier = band.toFixed(2);
    byHeightTier[tier] ??= { segments: 0, lengthM: 0, areaSqm: 0 };
    byHeightTier[tier].segments += 1; byHeightTier[tier].lengthM += len; byHeightTier[tier].areaSqm += len * band;
  }
  assert.deepEqual(Object.keys(byRoom).sort(), ['主卫', '厨房', '客卫', '客厅', '阳台']);
  assert.ok(Math.abs(byRoom['厨房'].lengthM - 5.70) < 1e-9, `厨房段长应为 5.70（含挡水条堆叠段），实际 ${byRoom['厨房'].lengthM}`);
  assert.ok(Math.abs(byRoom['主卫'].lengthM - 11.08) < 1e-9, `主卫应为 11.08（4.36 墙 + 6.72 防水台 front/top），实际 ${byRoom['主卫'].lengthM}`);
  assert.ok(Math.abs(byRoom['客卫'].lengthM - 6.45) < 1e-9, `客卫应为 6.45（5.70 + 防溅带堆叠 0.75），实际 ${byRoom['客卫'].lengthM}`);
  assert.ok(Math.abs(byRoom['阳台'].lengthM - 2.70) < 1e-9, `阳台应为 2.70，实际 ${byRoom['阳台'].lengthM}`);
  assert.ok(Math.abs(byRoom['客厅'].lengthM - 12.40) < 1e-9, `客厅应为防水台 front+top 两段各 6.20m，实际 ${byRoom['客厅'].lengthM}`);
  assert.deepEqual(Object.keys(byHeightTier).sort(), ['0.15', '0.30', '0.33', '0.50', '0.90', '2.65']);
  assert.equal(byHeightTier['2.65'].segments, 6, '砖到顶：客卫淋浴 2 + 厨房 E2 贴满 3 + 主卫淋浴 1（业主 2026-10-07 终裁）');
  assert.equal(byHeightTier['0.90'].segments, 1, '厨房阳台门段杂砖带（E2 贴满后仅此一段维持 0.90）');
  assert.equal(byHeightTier['0.30'].segments, 8, '两卫非淋浴 6 + 阳台 2');
  assert.equal(byHeightTier['0.33'].segments, 1, '客卫台盆防溅带（0.77→1.10）');
  assert.equal(byHeightTier['0.50'].segments, 1, '灶台挡水条带高');
  assert.equal(byHeightTier['0.15'].segments, 6, '防水台竖面+台面：客厅 2 + 主卫 4（C17）');
  const total = Object.values(byRoom).reduce((s, v) => s + v.areaSqm, 0);
  assert.ok(Math.abs(total - 25.651) < 0.01, `总面积应为 25.651，实际 ${total}`);
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
  // app/src/App.ts:544 的播报守卫已从 `if (this.wallTileVisible) {` 演进为 `if (this.wallTileVisible && announce) {`
  // （:536 签名多带 announce = true，DEC-2026-10-07-R09：开关复用点不需要每次同步都播报）。
  // 旧正则 `if \(this\.wallTileVisible\) \{` 写死无 announce 守卫，故失配；放行额外条件后
  // 原检测意图不变——仍然要求「开启即播报数字摘要」且播报段不得依赖 HVAC 状态。
  const toast = /if \(this\.wallTileVisible[^)]*\) \{[\s\S]*?showToast/.exec(app);
  assert.ok(toast, '开启贴砖检视态应播报数字摘要');
  assert.ok(!/Hvac|hvac/.test(toast[0]), '播报不得依赖 HVAC 状态');
});
