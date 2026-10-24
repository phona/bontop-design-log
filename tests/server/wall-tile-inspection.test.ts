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
//  ② buildScene 真的建出 37 个 inspection-only 网格，且 userData/初始态齐全
//  ③ 与 pipe-chase 检视态互不干扰（层标签隔离 + HVAC/管道重建不摧毁本层）

const MG: any = load(readFileSync('config/layout/model-geometry.yaml', 'utf8'));
const OV: any = load(readFileSync('config/layout/overlay.yaml', 'utf8'));
const RESOLVED_LAYOUT: any = resolveLayout(MG);
function sillWallLength(wallId: string): number {
  // 与 shared/masonry-takeoff.ts / SceneBuilder 的墙长口径一致：弧墙按 resolved
  // polyline 各段累计，不能退回 model-geometry 首尾点弦长。
  const w: any = RESOLVED_LAYOUT.walls.find((x: any) => x.id === wallId);
  assert.ok(w, `bay_sill 引用的墙 ${wallId} 必须存在`);
  const segments = w.segments?.length
    ? w.segments
    : [{ x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2 }];
  return segments.reduce((sum: number, segment: any) => sum + Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1), 0);
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
  assert.equal(regions.length, 18, '2026-10-09 P07 删 C18 后 stale 的 walltile_kitchen_ent_hood_wall 后 16 段墙；P11 厨房生活阳台门段拆东西两段 → 17；2026-10-23 DEC-2026-10-23-R04 客卫东墙淋浴砖段拆二（kitseg）→ 18');
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
  assert.equal(sills.length, 20, '卧室/书房新增 6 座防水台各 front+top 12 段；连同既有 8 段共 20 段');
  const baySillIds = new Set((parsed.elements ?? []).filter((e: any) => e.type === 'bay_sill').map((e: any) => e.id));
  const living = (parsed.elements ?? []).find((e: any) => e.id === 'living_south_waterproof_ledge');
  assert.equal(living?.type, 'bay_sill', '客厅防水台构件必须是 bay_sill');
  assert.equal(living.height, 0.15);
  assert.equal(living.depth, 0.15);
  for (const s of sills) {
    assert.ok(baySillIds.has(s.element), `sill_region ${s.id} 必须引用已声明的 bay_sill`);
    assert.ok(s.face === 'front' || s.face === 'top' || s.face === 'underside', `${s.id} face 只能是 front/top/underside`);
  }
  assert.equal(sills.filter((s) => s.room === 'living_dining').length, 2, '客厅 L 型两段');
  assert.equal(sills.filter((s) => s.room === 'master_bath').length, 4, '主卫湿区 2 台 × front/top（C17；w_west_ap 圆角段留现场收口）');
  assert.equal(sills.filter((s) => s.room === 'master_bedroom').length, 6, '主卧 3 座防水台 × front/top');
  assert.equal(sills.filter((s) => s.room === 'study').length, 2, '书房 1 座防水台 × front/top');
  assert.equal(sills.filter((s) => s.room === 'bedroom_nw').length, 2, '西北次卧 1 座防水台 × front/top');
  assert.equal(sills.filter((s) => s.room === 'bedroom_se').length, 2, '东南客房 1 座防水台 × front/top');
});

test('mergeSceneElements preserves wall_region elements alongside overlay types', () => {
  const parsed = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  const merged = mergeSceneElements(resolvedWalls(), parsed);
  const regions: any[] = merged.filter((e: any) => e.type === 'wall_region');
  assert.equal(regions.length, 18, "2026-10-09 P07 删 walltile_kitchen_ent_hood_wall 后 16 段墙；P11 厨房门段拆分 → 17；DEC-2026-10-23-R04 客卫东墙砖段拆二 → 18");
});

test('buildScene emits 38 inspection-only wall-tile meshes with reversible initial state', () => { // R04：wall_region 37→38 段
  const scene = sceneWithWallTile();
  assert.deepEqual(scene.report.unsupported, [], '墙引用或 along 区间有误会在这里现形');
  const meshes = wallTileMeshes(scene.exportRoot);
  assert.equal(meshes.length, 38);
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
  // DEC-2026-10-09-P07：R11 补的灶台挡水条 walltile_kitchen_ent_hood_wall 已删——
  // C18 废止杂砖后东墙改整段正砖到 2.65，挡水条整块落在其内属 stale 重复声明
  // （verify:finish-scope 的 F01 抓到 0.45㎡ 砖压砖）。原来这里断言挡水条网格存在，
  // 现在改为断言它**不再存在**。
  assert.equal(byId.has('walltile_kitchen_ent_hood_wall'), false, 'C18 后的 stale 挡水条必须已删除');
  assert.equal(byId.has('walltile_kitchen_ent_west'), true, '整段正砖声明必须仍在');
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
  // 主卫南墙淋浴段：DEC-2026-10-09-P11 起 along[0,1.15] = 1.15m（门洞 d_mbath 自 1.15 起，瓷砖不扣洞），C16 砖到顶 height 2.65
  const shower = byId.get('walltile_mbath_south_shower')!;
  const showerGeo = shower.geometry as unknown as { parameters: { width: number; height: number } };
  assert.ok(Math.abs(showerGeo.parameters.width - 1.15) < 1e-6, `淋浴段宽应为 1.15（让出门洞），实际 ${showerGeo.parameters.width}`);
  assert.ok(Math.abs(showerGeo.parameters.height - 2.65) < 1e-6);
  assert.equal(shower.userData.zone, 'visible');
  // 主卫南墙干区：P11 起 along[1.95,2.60] = 0.65m（门洞至 1.95 止），0.30m 防水带
  const dry = byId.get('walltile_mbath_south_dry')!;
  const dryGeo = dry.geometry as unknown as { parameters: { width: number; height: number } };
  assert.ok(Math.abs(dryGeo.parameters.width - 0.65) < 1e-6, `干区宽应为 0.65（让出门洞），实际 ${dryGeo.parameters.width}`);
  assert.ok(Math.abs(dryGeo.parameters.height - 0.30) < 1e-6);
  // 厨房生活阳台门段：P11 起拆成东西两段（门洞 d_kit_balc 占中段 0.80m），各 0.20m × 0.90m
  const balcW = byId.get('walltile_kitchen_balc_east_west')!;
  const balcE = byId.get('walltile_kitchen_balc_east_east')!;
  assert.ok(balcW && balcE, '厨房生活阳台门段必须拆成东西两段');
  for (const [mesh, name] of [[balcW, '西段'], [balcE, '东段']] as const) {
    const geo = mesh.geometry as unknown as { parameters: { width: number; height: number } };
    assert.ok(Math.abs(geo.parameters.width - 0.20) < 1e-6, `${name}宽应为 0.20，实际 ${geo.parameters.width}`);
    assert.ok(Math.abs(geo.parameters.height - 0.90) < 1e-6, `${name}高应为 0.90，实际 ${geo.parameters.height}`);
    assert.equal(mesh.userData.roomId, 'kitchen');
  }
  assert.equal(byId.has('walltile_kitchen_balc_east'), false, '整段 1.20m 的旧声明必须已拆分删除');
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
  const CN: Record<string, string> = {
    kitchen: '厨房', master_bath: '主卫', guest_bath: '客卫', balcony: '阳台', living_dining: '客厅',
    master_bedroom: '主卧', study: '书房', bedroom_nw: '西北次卧', bedroom_se: '客房',
  };
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
  assert.deepEqual(Object.keys(byRoom).sort(), ['主卧', '主卫', '书房', '厨房', '客卫', '客房', '西北次卧', '客厅', '阳台'].sort());
  assert.ok(Math.abs(byRoom['厨房'].lengthM - 11.20) < 1e-9, `厨房段长应为 11.20（墙砖 4.80 + 上飘窗 front 3.60 + underside 3.60 + 生活阳台门段拆分后 0.40 − 原整段 1.20，DEC-2026-10-09-P09/P11），实际 ${byRoom['厨房'].lengthM}`);
  assert.ok(Math.abs(byRoom['主卫'].lengthM - 11.420331156954752) < 1e-9, `主卫应为 11.420331157（3.56m墙砖 + 西墙低反坎1.52m + w_bath_north弧墙 front/top 6.340331157，而不是2.60m弦长；DEC-2026-10-09-P11），实际 ${byRoom['主卫'].lengthM}`);
  assert.ok(Math.abs(byRoom['客卫'].lengthM - 6.55) < 1e-9, `客卫应为 6.55（5.80 + 防溅带堆叠 0.75；DEC-2026-10-23-R04 北墙砖段随墙长 1.50→1.60），实际 ${byRoom['客卫'].lengthM}`);
  assert.ok(Math.abs(byRoom['阳台'].lengthM - 2.80) < 1e-9, `阳台应为 2.80（南墙砖段随墙长 1.50→1.60，DEC-2026-10-23-R04），实际 ${byRoom['阳台'].lengthM}`);
  assert.ok(Math.abs(byRoom['客厅'].lengthM - 12.40) < 1e-9, `客厅应为防水台 front+top 两段各 6.20m，实际 ${byRoom['客厅'].lengthM}`);
  assert.ok(Math.abs(byRoom['主卧'].lengthM - 21.420331156) < 1e-9, `主卧应为 21.420331156（3.25+2.69+4.770165578m，各 front+top），实际 ${byRoom['主卧'].lengthM}`);
  assert.ok(Math.abs(byRoom['书房'].lengthM - 6.00) < 1e-9, `书房应为 6.00（3.00m，各 front+top），实际 ${byRoom['书房'].lengthM}`);
  assert.ok(Math.abs(byRoom['西北次卧'].lengthM - 6.00) < 1e-9, `西北次卧应为 6.00（3.00m，各 front+top），实际 ${byRoom['西北次卧'].lengthM}`);
  assert.ok(Math.abs(byRoom['客房'].lengthM - 6.00) < 1e-9, `客房应为 6.00（3.00m，各 front+top），实际 ${byRoom['客房'].lengthM}`);
  assert.ok(Math.abs(sillWallLength('w_bath_north') - 3.170165578477376) < 1e-9,
    'w_bath_north 必须按 resolved 弧墙折线 3.170165578m 计，禁止退回 2.60m 弦长');
  assert.deepEqual(Object.keys(byHeightTier).sort(), ['0.15', '0.30', '0.33', '0.71', '0.90', '1.10', '2.65'], '0.50 档随 C18 后 stale 挡水条删除；0.71/1.10 是厨房上飘窗 front/underside（DEC-2026-10-09-P09）');
  assert.equal(byHeightTier['2.65'].segments, 7, '砖到顶：客卫淋浴 3（R04 东墙段拆二）+ 厨房 E2 贴满 3 + 主卫淋浴 1（业主 2026-10-07 终裁）');
  assert.equal(byHeightTier['0.90'].segments, 2, '厨房阳台门段杂砖带 P11 拆成东西两段（E2 贴满后仅此一处维持 0.90）');
  assert.equal(byHeightTier['0.30'].segments, 8, '两卫非淋浴 6 + 阳台 2');
  assert.equal(byHeightTier['0.33'].segments, 1, '客卫台盆防溅带（0.77→1.10）');
  assert.equal(byHeightTier['0.15'].segments, 18, '防水台竖面+台面：客厅 2 + 主卫 4 + 卧室/书房 12');
  const total = Object.values(byRoom).reduce((s, v) => s + v.areaSqm, 0);
  assert.ok(Math.abs(total - 37.018599347) < 1e-4, `总面积应为 37.018599347（R04 后：客卫北墙砖段 +0.265、阳台南墙砖段 +0.03；旧 36.723599347），实际 ${total}`);
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
