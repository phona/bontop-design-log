import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { load } from 'js-yaml';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { parseOverlay, mergeSceneElements } from '../../server/overlay-merge.js';
import { buildPaintCostComparison, computePaintScopeForLayout, loadPaintComparisonConfig, loadPaintScopeInputs } from '../../server/paint-cost-comparison.js';
import { computePaintScope, type PaintWallInput, type PaintWindowInput } from '../../shared/paint-scope.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';

// 涂漆检视态 + 成本核算子系统（墙顶面涂装 PKG-080）。DEC-2026-10-08-C05 建立、C06 洞口扣除。
// 四道防线：
//  ① overlay 的 paint_region 声明能过 schema 校验
//  ② buildScene 真的建出 inspection-only 网格，且朝声明房间侧外偏移（不共面 z-fighting）
//  ③ 面积独立复算：声明值 vs 从 model-geometry/house.yaml 推出的几何值，逐房间对账；
//     门洞/窗洞按实扣除，且 3D 网格数、净面积、预算行项目三处必须一致
//  ④ 成本模型与 materials.yaml / base.json / control.yaml 对账，口径未拍板前不选单一情景

const MG: any = load(readFileSync('config/layout/model-geometry.yaml', 'utf8'));
const OV: any = load(readFileSync('config/layout/overlay.yaml', 'utf8'));
const HOUSE: any = load(readFileSync('config/house.yaml', 'utf8'));

const V: Record<string, [number, number]> = {};
for (const v of MG.vertices) V[v.id] = [v.x, v.z];
const WALLS: Array<{ id: string; a: [number, number]; b: [number, number]; height: number }> =
  MG.walls.map((w: any) => ({ id: w.id as string, a: V[w.from] as [number, number], b: V[w.to] as [number, number], height: (w.height ?? 2.8) as number }));
const SUP = new Set<string>();
for (const s of OV.suppress ?? []) for (const k of ['wall', 'walls']) if (s[k]) (Array.isArray(s[k]) ? s[k] : [s[k]]).forEach((w: string) => SUP.add(w));

const paintFinish = new Set<string>();
for (const r of HOUSE.rooms) if (r.id && r.wall_finish === 'paint') paintFinish.add(r.id);
for (const r of HOUSE.gift_areas ?? []) if (r.id && r.wall_finish === 'paint') paintFinish.add(r.id);

function resolvedWalls(): Array<{ id: string; x1: number; z1: number; x2: number; z2: number; height: number }> {
  return WALLS.map((w) => ({ id: w.id, x1: w.a[0], z1: w.a[1], x2: w.b[0], z2: w.b[1], height: w.height }));
}

function sceneWithPaintRegions() {
  // 与 app 实际路径一致：rooms 用 resolved 房间（带 x/z/width/depth/area，涂漆平面靠房间
  // 中心点决定朝哪一侧外偏移）；walls 用 resolved 墙（带 segments/openings，门洞在这里）。
  return buildScene({
    walls: resolveLayout(MG).walls,
    rooms: resolveLayout(MG).rooms,
    // 只喂能直接消费的类型：paint_region（被测）+ bay_sill/glass_infill（窗洞声明源）+ wall。
    // 其余 element 类型需要 overlay-merge 补默认值，直接喂原始声明会炸。
    elements: (OV.elements ?? []).filter((e: any) => ['paint_region', 'wall'].includes(e.type)),
    furnishings: {},
  } as any);
}

function paintMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o: any) => { if (o.userData?.inspectionLayer === 'wall-paint') out.push(o as THREE.Mesh); });
  return out;
}

/**
 * L2 独立复算：房间 boundary 每条边被未 suppress 的实体墙覆盖的长度。
 * 与 tmp/verify-wall-tile.ts 的 tileableOf 同款算法（几何交叉，不用正则、不用顶点同一性），
 * 不读 overlay 声明，所以能真正独立验证声明值。
 */
function paintFaceCoverage(boundary: string[]): Array<{ wall: string; lengthM: number; height: number }> {
  const hits: Array<{ wall: string; lengthM: number; height: number }> = [];
  for (let i = 0; i < boundary.length; i++) {
    const p = V[boundary[i]], q = V[boundary[(i + 1) % boundary.length]];
    const vert = p[0] === q[0], horz = p[1] === q[1];
    if (!vert && !horz) continue;
    for (const w of WALLS) {
      if (SUP.has(w.id)) continue;
      const wv = w.a[0] === w.b[0], wh = w.a[1] === w.b[1];
      let ov = 0;
      if (vert && wv && w.a[0] === p[0]) {
        ov = Math.max(0, Math.min(Math.max(p[1], q[1]), Math.max(w.a[1], w.b[1])) - Math.max(Math.min(p[1], q[1]), Math.min(w.a[1], w.b[1])));
      } else if (horz && wh && w.a[1] === p[1]) {
        ov = Math.max(0, Math.min(Math.max(p[0], q[0]), Math.max(w.a[0], w.b[0])) - Math.max(Math.min(p[0], q[0]), Math.min(w.a[0], w.b[0])));
      }
      if (ov > 1e-9) hits.push({ wall: w.id, lengthM: +ov.toFixed(3), height: w.height });
    }
  }
  return hits;
}

function roomFootprint(room: { boundary: string[] }): number {
  const pts = room.boundary.map((id: string) => V[id]);
  return Math.abs(pts.reduce((sum: number, p: [number, number], i: number) => {
    const q = pts[(i + 1) % pts.length];
    return sum + (p[0] * q[1] - q[0] * p[1]);
  }, 0) / 2);
}

test('overlay paint_region declarations pass the Zod discriminated union', () => {
  const parsed = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  const regions: any[] = (parsed.elements ?? []).filter((e: any) => e.type === 'paint_region');
  // DEC-2026-10-08-C06：入户花园出范围（开发商已做好，收房后再定），4 段声明已删
  assert.equal(regions.length, 22, 'C05 声明 26 段，C06 删除入户花园 4 段后为 22 段');
  for (const r of regions) {
    assert.equal(r.bottom, 0, 'schema 默认 bottom=0');
    assert.ok(r.height > 0, `${r.id} height 必须为正`);
    assert.ok(r.along[1] > r.along[0], `${r.id} along 区间必须为正`);
    assert.ok(r.wall.length > 0, `${r.id} 必须引用一面墙`);
    assert.ok(r.room.length > 0, `${r.id} 必须声明归属房间`);
  }
});

test('mergeSceneElements preserves paint_region elements alongside overlay types', () => {
  const parsed = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  const merged = mergeSceneElements(resolvedWalls(), parsed);
  const regions: any[] = merged.filter((e: any) => e.type === 'paint_region');
  assert.equal(regions.length, 22);
});

test('buildScene emits paint meshes with reversible initial state, split at door openings', () => {
  const scene: any = sceneWithPaintRegions();
  assert.deepEqual(scene.unsupported ?? [], [], '所有 paint_region 都必须能落地');
  const meshes = paintMeshes(scene.exportRoot);
  const regionIds = [...new Set(meshes.map((mesh: any) => mesh.userData.regionId))];
  assert.equal(regionIds.length, 22, '声明仍是 22 段');
  assert.ok(meshes.length > 22, `门洞必须把声明拆成多块平面，实际 ${meshes.length} 块`);
  for (const mesh of meshes) {
    assert.equal(mesh.visible, false, '默认不可见（GLB 导出自动排除）');
    assert.equal(mesh.renderOrder, 0);
    assert.equal((mesh.userData as any).inspectionVisibleOnly, true);
    assert.equal((mesh.userData as any).inspectionLayer, 'wall-paint');
    assert.ok(typeof (mesh.userData as any).roomId === 'string' && (mesh.userData as any).roomId.length > 0);
    assert.ok(typeof (mesh.userData as any).regionId === 'string' && (mesh.userData as any).regionId.length > 0);
    const material = mesh.material as THREE.MeshStandardMaterial;
    assert.equal(material.depthTest, true);
    assert.equal(material.opacity, 0.38);
  }
});

test('every door opening on a declared wall is split out of the paint planes', () => {
  const scene: any = sceneWithPaintRegions();
  const meshes = paintMeshes(scene.exportRoot);
  // 逐段声明统计拆分后的矩形数：有门洞穿过的必须是 2~3 块（左条/右条/门楣条）
  const byRegion = new Map<string, THREE.Mesh[]>();
  for (const mesh of meshes) {
    const regionId = String((mesh as any).userData.regionId);
    (byRegion.get(regionId) ?? byRegion.set(regionId, []).get(regionId)!).push(mesh);
  }
  const splitRegions = [...byRegion.entries()].filter(([, group]) => group.length > 1);
  assert.equal(splitRegions.length, 7, '5 房范围内有 7 段声明被门洞穿过');
  for (const [regionId, group] of splitRegions) {
    assert.ok(group.length >= 2 && group.length <= 3, `${regionId} 拆成 ${group.length} 块`);
  }
  // 全部 mesh 的净面积必须小于毛面积（洞真的被扣掉了）
  const net = meshes.reduce((sum: number, mesh: any) => {
    const g = mesh.geometry.parameters;
    return sum + g.width * g.height;
  }, 0);
  const gross = (OV.elements ?? [])
    .filter((e: any) => e.type === 'paint_region')
    .reduce((sum: number, e: any) => sum + (e.along[1] - e.along[0]) * (e.height - (e.bottom ?? 0)), 0);
  assert.ok(Math.abs(gross - 155.652) <= 0.02, `毛墙面 ${gross.toFixed(3)}`);
  assert.ok(Math.abs(net - 142.422) <= 0.02, `净墙面 ${net.toFixed(3)}`);
});

test('splitRectByGaps keeps the lintel above a door and both side strips', () => {
  // 门洞 0.9m 宽、2.1m 高，落在 3.0m 宽、2.8m 高的墙中段
  const rects = computePaintScope(
    [{ id: 'w', x1: 0, z1: 0, x2: 3, z2: 0, height: 2.8, openings: [] }],
    [{ id: 'r', wall: 'w', room: 'room', along: [0, 3], bottom: 0, height: 2.8 }],
    [],
  ).regions[0].rects;
  assert.equal(rects.length, 1, '没有洞口时应保持整块');
  const gapped = computePaintScope(
    [{
      id: 'w', x1: 0, z1: 0, x2: 3, z2: 0, height: 2.8,
      openings: [{ id: 'd', type: 'door', x: 1.5, z: 0, width: 0.9, height: 2.1, room: 'room' }],
    }],
    [{ id: 'r', wall: 'w', room: 'room', along: [0, 3], bottom: 0, height: 2.8 }],
    [],
  ).regions[0];
  // 拆法：洞口以下分左右两条，洞口以上是一条通长带（楣上整段都要刷）
  const pieces = gapped.rects;
  assert.equal(pieces.length, 3, '左条 + 右条 + 门楣上通长带');
  const left = pieces.find((p) => p.from === 0 && p.to === 1.05 && p.bottom === 0 && p.top === 2.1);
  const right = pieces.find((p) => p.from === 1.95 && p.to === 3 && p.bottom === 0 && p.top === 2.1);
  const lintel = pieces.find((p) => p.from === 0 && p.to === 3 && p.bottom === 2.1 && p.top === 2.8);
  assert.ok(left && right && lintel, '三块矩形的位置与竖向带必须正确');
  assert.ok(Math.abs(gapped.netAreaSqm - (1.05 * 2.1 + 1.05 * 2.1 + 3 * 0.7)) < 1e-6);
  assert.ok(Math.abs(gapped.grossAreaSqm - 3 * 2.8) < 1e-6);
  assert.ok(Math.abs(gapped.gaps[0].areaSqm - 0.9 * 2.1) < 1e-6, '门洞占位 0.9×2.1');
});

test('window declarations only deduct when along is resolvable, and warn when not', () => {
  const wallWithWindow: PaintWallInput = { id: 'w', x1: 0, z1: 0, x2: 3, z2: 0, height: 2.8 };
  const windowWithAlong: PaintWindowInput = { id: 'win_a', wall: 'w', along: [1.0, 2.5], sill: 2.0, height: 0.7 };
  const scope = computePaintScope([wallWithWindow], [{ id: 'r', wall: 'w', room: 'room', along: [0, 3], bottom: 0, height: 2.8 }], [windowWithAlong]);
  assert.ok(Math.abs(scope.windowGapAreaSqm - 1.5 * 0.7) < 1e-6, '窗洞沿墙 1.5m × 窗带 0.7m');
  assert.ok(Math.abs(scope.netWallAreaSqm - (3 * 2.8 - 1.5 * 0.7)) < 1e-6, '净面积 = 毛 − 窗洞');
  assert.deepEqual(scope.warnings, []);

  const windowWithoutAlong: PaintWindowInput = { id: 'win_b', wall: 'w', sill: 2.0, height: 0.7 };
  const warned = computePaintScope([wallWithWindow], [{ id: 'r', wall: 'w', room: 'room', along: [0, 3], bottom: 0, height: 2.8 }], [windowWithoutAlong]);
  assert.equal(warned.windowGapAreaSqm, 0, '定位不了就不能扣');
  assert.equal(warned.warnings.length, 1, '但必须告警——显形而不是静默少扣');
  assert.match(warned.warnings[0], /win_b/);
});

test('paint plane is offset toward the declared room instead of the wall centreline', () => {
  const scene: any = sceneWithPaintRegions();
  const meshes = paintMeshes(scene.exportRoot);
  const wallById = new Map(WALLS.map((w) => [w.id, w]));
  for (const mesh of meshes) {
    const wall = wallById.get(String((mesh as any).userData.wallId))!;
    assert.ok(wall, 'paint_region 引用的墙必须存在');
    const room = MG.rooms.find((r: any) => r.id === (mesh as any).userData.roomId);
    assert.ok(room, 'paint_region 声明的房间必须存在');
    const pts = room.boundary.map((id: string) => V[id]);
    const centroid = {
      x: pts.reduce((s: number, p: [number, number]) => s + p[0], 0) / pts.length,
      z: pts.reduce((s: number, p: [number, number]) => s + p[1], 0) / pts.length,
    };
    const cx = wall.a[0], cz = wall.a[1];
    const dx = wall.b[0] - cx, dz = wall.b[1] - cz;
    const len = Math.hypot(dx, dz) || 1;
    const left = { x: -dz / len, z: dx / len };
    const toRoom = { x: centroid.x - mesh.position.x, z: centroid.z - mesh.position.z };
    const side = toRoom.x * left.x + toRoom.z * left.z;
    assert.ok(Math.abs(side) > 1e-6, `${(mesh as any).userData.objectId} 平面不应落在墙中心线上`);
    const alongNormal = Math.abs(mesh.position.x - (cx + dx / 2) - left.x * 0.068) + Math.abs(mesh.position.z - (cz + dz / 2) - left.z * 0.068);
    assert.ok(alongNormal < 1e-6 || Math.abs(side) > 0.06, `${(mesh as any).userData.objectId} 偏移必须指向房间侧`);
  }
});

test('double-sided painted walls keep both faces without coplanar overlap', () => {
  const scene: any = sceneWithPaintRegions();
  const meshes = paintMeshes(scene.exportRoot);
  const byWall = new Map<string, THREE.Mesh[]>();
  for (const mesh of meshes) {
    const wallId = String((mesh as any).userData.wallId);
    (byWall.get(wallId) ?? byWall.set(wallId, []).get(wallId)!).push(mesh);
  }
  const shared = [...byWall.entries()].filter(([, group]) => group.length > 1);
  assert.ok(shared.length >= 4, '双面涂漆墙：w_mb_east / w_st_east / w_be_west / w_nw_south / w_mbath_east / w_ent_west / w_ent_south_w');
  for (const [wallId, group] of shared) {
    // 一段声明被门洞拆成多块，但 (墙, 声明) → 房间必须唯一；不同声明（= 不同面）房间必须不同
    const roomsByRegion = new Map<string, Set<string>>();
    for (const mesh of group) {
      const regionId = String((mesh as any).userData.regionId);
      const roomId = String((mesh as any).userData.roomId);
      (roomsByRegion.get(regionId) ?? roomsByRegion.set(regionId, new Set()).get(regionId)!).add(roomId);
    }
    for (const [regionId, rooms] of roomsByRegion) {
      assert.equal(rooms.size, 1, `${wallId}/${regionId} 只能归属一个房间`);
    }
    const roomSets = [...roomsByRegion.values()].map((rooms) => [...rooms][0]);
    assert.equal(new Set(roomSets).size, roomSets.length, `${wallId} 的每个涂漆面必须是不同房间`);
    // 两个面的平面必须分开偏移，否则共面 z-fighting
    const firstOfEachRoom = new Map<string, THREE.Mesh>();
    for (const mesh of group) {
      const roomId = String((mesh as any).userData.roomId);
      if (!firstOfEachRoom.has(roomId)) firstOfEachRoom.set(roomId, mesh);
    }
    const anchors = [...firstOfEachRoom.values()];
    for (let i = 1; i < anchors.length; i++) {
      const distance = Math.hypot(anchors[i].position.x - anchors[0].position.x, anchors[i].position.z - anchors[0].position.z);
      assert.ok(distance > 0.1, `${wallId} 的两个涂漆面必须分开（否则共面 z-fighting），实际间距 ${distance.toFixed(3)}m`);
    }
  }
});

test('paint_region references only existing, non-suppressed walls and stays in span', () => {
  const { regions } = loadPaintScopeInputs();
  const wallLength = new Map(WALLS.map((w) => [w.id, Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])]));
  for (const region of regions) {
    assert.ok(!SUP.has(region.wall), `${region.id} 不得引用被 suppress 的墙 ${region.wall}`);
    assert.ok(wallLength.has(region.wall), `${region.id} 引用的墙必须存在`);
    const total = wallLength.get(region.wall)!;
    assert.ok(region.along[0] >= -1e-9 && region.along[1] <= total + 1e-9, `${region.id} along 不得越界`);
  }
});

test('declared paint areas match an independent geometric recomputation, room by room', () => {
  const { regions } = loadPaintScopeInputs();
  const declaredWallByRoom = new Map<string, number>();
  const declaredIdsByRoom = new Map<string, Set<string>>();
  for (const region of regions) {
    const span = region.along[1] - region.along[0];
    const height = region.height ?? 2.8;
    declaredWallByRoom.set(region.room, (declaredWallByRoom.get(region.room) ?? 0) + span * height);
    const ids = declaredIdsByRoom.get(region.room) ?? new Set<string>();
    ids.add(region.wall);
    declaredIdsByRoom.set(region.room, ids);
  }
  let totalWall = 0;
  let totalCeiling = 0;
  for (const room of MG.rooms) {
    if (!paintFinish.has(room.id)) continue;
    const expected = paintFaceCoverage(room.boundary);
    const expectedLength = +expected.reduce((sum: number, hit) => sum + hit.lengthM, 0).toFixed(3);
    const expectedWalls = new Set(expected.map((hit) => hit.wall));
    const declared = declaredWallByRoom.get(room.id) ?? 0;
    assert.ok(
      Math.abs(declared - expectedLength * (room.height ?? 2.8)) <= 0.02,
      `${room.id} 声明涂装面积 ${declared} 与独立复算 ${(expectedLength * (room.height ?? 2.8)).toFixed(3)} 不一致`,
    );
    const declaredIds = declaredIdsByRoom.get(room.id) ?? new Set<string>();
    assert.deepEqual([...declaredIds].sort(), [...expectedWalls].sort(), `${room.id} 覆盖的墙集合不一致`);
    totalWall += expectedLength * (room.height ?? 2.8);
    totalCeiling += roomFootprint(room);
  }
  assert.ok(Math.abs(totalWall - 155.652) <= 0.02, `涂装墙面毛面积应约 155.65 ㎡，实算 ${totalWall.toFixed(2)}`);
  assert.ok(Math.abs(totalCeiling - 103.224) <= 0.02, `顶面合计应约 103.22 ㎡，实算 ${totalCeiling.toFixed(2)}`);
});

test('paint_region rooms equal the catalog rooms whose wall_finish is paint', () => {
  const { regions } = loadPaintScopeInputs();
  const declared = new Set(regions.map((r) => r.room));
  const catalog = ProjectCatalog.load('.');
  const finished = new Set(catalog.getRooms().filter((r) => r.wall_finish === 'paint').map((r) => r.id));
  assert.deepEqual([...declared].sort(), [...finished].sort(), '声明范围必须与 house.yaml 的 wall_finish 意图一致');
  // 2026-10-08 业主裁定：入户花园开发商已做好墙面，本期不刷
  assert.equal(catalog.getRooms().find((r) => r.id === 'entry_garden')?.wall_finish, 'unpainted');
  assert.ok(!declared.has('entry_garden'), '入户花园不在涂装范围');
  // 边缘房间：都不在涂装范围
  for (const outOfScope of ['elevator_shaft', 'kitchen', 'master_bath', 'guest_bath', 'balcony']) {
    assert.ok(!declared.has(outOfScope), `${outOfScope} 不在涂装范围`);
  }
  for (const notModeled of ['west_platform', 'south_balcony']) {
    assert.ok(!declared.has(notModeled), `${notModeled} 不是 model-geometry 的房间，不得出现在声明里`);
  }
});

test('net area equals gross minus door and window gaps, and matches the budget line items', () => {
  const layout = resolveLayout(MG);
  const catalog = ProjectCatalog.load('.');
  const scope = computePaintScopeForLayout(layout, catalog, loadPaintScopeInputs());
  assert.equal(scope.doorGapAreaSqm, 13.23, '入户花园出范围后门洞占位 13.23㎡');
  assert.equal(scope.windowGapAreaSqm, 0, '窗洞当前为 0：窗全在 suppress 的玻璃幕墙上');
  assert.ok(Math.abs(scope.grossWallAreaSqm - 155.652) <= 0.02, `毛墙面 ${scope.grossWallAreaSqm}`);
  assert.ok(Math.abs(scope.netWallAreaSqm - 142.422) <= 0.02, `净墙面 ${scope.netWallAreaSqm}`);
  assert.ok(Math.abs(scope.netWallAreaSqm - (scope.grossWallAreaSqm - scope.doorGapAreaSqm - scope.windowGapAreaSqm)) <= 0.01);
  assert.ok(Math.abs(scope.ceilingAreaSqm - 103.224) <= 0.02, `顶面 ${scope.ceilingAreaSqm}`);
  assert.ok(Math.abs(scope.netAreaSqm - 245.646) <= 0.02, `墙+顶净面积 ${scope.netAreaSqm}`);
  assert.deepEqual(scope.warnings, []);

  // 预算侧读取的必须是同一个净面积
  const rules = load(readFileSync('config/design-rules.yaml', 'utf8')) as any;
  const calc = new BudgetCalculator(catalog, rules);
  const snapshot = calc.calculate({ selections: { paint: { default: 'latex_paint_01' } } } as any, 'full');
  const painted = snapshot.lineItems.filter((li) => li.topic === 'paint').reduce((sum, li) => sum + li.quantity, 0);
  assert.ok(Math.abs(painted - scope.netAreaSqm) <= 0.01, `预算行项目合计 ${painted} 必须等于净面积 ${scope.netAreaSqm}`);
  const painting = snapshot.categories.find((category) => category.key === 'painting')!;
  assert.ok(Math.abs(painting.actual - 7447.02) <= 1, `painting actual=${painting.actual}`);
  assert.equal(painting.status, 'ok');
});

test('paint cost comparison reconciles declared scope with materials/base/control inputs', () => {
  const layout = resolveLayout(MG);
  const catalog = ProjectCatalog.load('.');
  const config = loadPaintComparisonConfig();
  const comparison = buildPaintCostComparison(layout, config, catalog);
  // 溯源标注必须与配置一致：面积来自 overlay 声明，房间涂装意图来自 house.yaml
  assert.equal(comparison.areaSource, config.area_source);
  assert.equal(comparison.roomFinishSource, config.room_finish_source);
  assert.match(comparison.areaSource, /paint_region/);
  assert.equal(comparison.scope.paintRoomCount, 5);
  assert.equal(comparison.scope.wallRegionEntryCount, 22);
  assert.equal(comparison.material.id, 'latex_paint_01');
  assert.equal(comparison.material.pricePerUnit, 580);
  assert.equal(comparison.material.coveragePerUnit, 120);
  assert.equal(comparison.material.lossRate, 1.1);
  assert.equal(comparison.labor.rateYuanPerSqm, 25);
  assert.equal(comparison.reconciliation.pkgId, 'PKG-080');
  assert.equal(comparison.reconciliation.plannedCny, 11500);
  assert.equal(comparison.reconciliation.ownerTargetCny, 11000);
  assert.equal(comparison.reconciliation.selectedScenarioId, null, '遍数未裁定前不选单一情景');
  assert.equal(config.deductions.deduct_openings, true, '业主 2026-10-08 裁定门窗洞均扣');
});

test('paint cost comparison outputs every declared scenario with coat/deduction variants', () => {
  const layout = resolveLayout(MG);
  const catalog = ProjectCatalog.load('.');
  const comparison = buildPaintCostComparison(layout, loadPaintComparisonConfig(), catalog);
  const byId = new Map(comparison.scenarios.map((s) => [s.scenarioId, s]));
  assert.equal(comparison.scenarios.length, 4);

  // 默认口径：2 遍面漆 + 1 遍底漆，扣门窗洞
  const twoCoats = byId.get('topcoats2_deduct')!;
  assert.equal(twoCoats.areaSqm, 245.646);
  assert.equal(twoCoats.topcoatBuckets, 5, '2 遍面漆需 5 桶');
  assert.equal(twoCoats.primerBuckets, 3, '1 遍底漆需 3 桶');
  assert.equal(twoCoats.materialYuan, 4640);
  assert.equal(twoCoats.laborYuan, 6141.15);
  assert.equal(twoCoats.subtotalYuan, 10781.15);
  assert.equal(twoCoats.vsPlannedDeltaYuan, -718.85);
  assert.equal(twoCoats.vsOwnerTargetDeltaYuan, -218.85);

  // 对照：不扣洞 = 毛面积
  const twoCoatsGross = byId.get('topcoats2_no_deduct')!;
  assert.equal(twoCoatsGross.areaSqm, 258.876);
  assert.equal(twoCoatsGross.laborYuan, 6471.9);
  assert.equal(twoCoatsGross.subtotalYuan, 11111.9);

  const oneCoat = byId.get('topcoats1_deduct')!;
  assert.equal(oneCoat.topcoatBuckets, 3);
  assert.equal(oneCoat.materialYuan, 3480);
  assert.equal(oneCoat.subtotalYuan, 9621.15);

  assert.deepEqual(comparison.reconciliation.modeledRangeCny, [9621.15, 11111.9]);
});

test('paint cost comparison surfaces unconfirmed primer assumptions as warnings instead of hiding them', () => {
  const layout = resolveLayout(MG);
  const catalog = ProjectCatalog.load('.');
  const comparison = buildPaintCostComparison(layout, loadPaintComparisonConfig(), catalog);
  const primerPrice = comparison.assumptions.find((a) => a.key === 'primer_price_per_unit')!;
  const primerCoverage = comparison.assumptions.find((a) => a.key === 'primer_coverage_per_unit')!;
  assert.equal(primerPrice.status, 'assumed_unconfirmed');
  assert.equal(primerCoverage.status, 'assumed_unconfirmed');
  const netWall = comparison.assumptions.find((a) => a.key === 'net_wall_area_sqm')!;
  assert.equal(netWall.status, 'from_overlay_declaration');
  const doorGap = comparison.assumptions.find((a) => a.key === 'door_gap_area_sqm')!;
  assert.equal(doorGap.value, 13.23);
  const windowGap = comparison.assumptions.find((a) => a.key === 'window_gap_area_sqm')!;
  assert.equal(windowGap.value, 0);
  const laborRate = comparison.assumptions.find((a) => a.key === 'labor_rate_yuan_per_sqm')!;
  assert.equal(laborRate.status, 'from_budget_base_json');
  assert.ok(comparison.warnings.some((w) => w.includes('底漆')), '未确认假设必须显形');
});

test('paint cost comparison refuses to run when declarations drift from wall_finish intent', () => {
  const layout = resolveLayout(MG);
  const catalog = ProjectCatalog.load('.');
  const config = loadPaintComparisonConfig();
  const rigged: any = {
    ...catalog,
    getRooms: () => ProjectCatalog.load('.').getRooms().map((room) => (
      room.id === 'master_bedroom' ? { ...room, wall_finish: 'tile' } : room
    )),
  };
  assert.throws(
    () => buildPaintCostComparison(layout, config, rigged),
    /diverge from house.yaml wall_finish/,
  );
});

test('paint scope reconciliation stays free of browser globals and HVAC coupling', () => {
  const sceneBuilder = readFileSync('shared/render/SceneBuilder.ts', 'utf8');
  assert.ok(!/window|document|HTMLCanvasElement|fetch/.test(sceneBuilder));

  const houseScene = readFileSync('app/src/render/HouseScene.ts', 'utf8');
  const paintToggle = /setPaintInspectionVisible\(visible: boolean\): void \{[\s\S]*?\n  \}/.exec(houseScene);
  assert.ok(paintToggle, 'HouseScene 必须有自包含的 setPaintInspectionVisible');
  assert.ok(!/Hvac|hvac|PipeChase|pipe-chase|Ceiling|ceiling/.test(paintToggle![0]), '涂漆开关不得引用其他检视态');

  const hvacToggle = /setHvacCoordinationVisible\(visible: boolean\): void \{[\s\S]*?\n  \}/.exec(houseScene);
  assert.ok(hvacToggle);
  assert.ok(!/Paint|paint/.test(hvacToggle![0]), 'HVAC 开关不得引用涂漆检视态');

  const paintStatus = /getPaintInspectionStatus\(\): \{[\s\S]*?\n  \}/.exec(houseScene);
  assert.ok(paintStatus);
  assert.ok(!/Hvac|hvac/.test(paintStatus![0]));

  const app = readFileSync('app/src/App.ts', 'utf8');
  const appPaint = /private setPaintInspectionVisible\(visible: boolean\): void \{[\s\S]*?\n  \}/.exec(app);
  assert.ok(appPaint);
  assert.ok(!/Hvac|hvac/.test(appPaint![0]), 'App 的涂漆开关播报不得引用 HVAC');
});

test('paint inspection overlay is excluded from GLB export by default visibility', () => {
  const scene: any = sceneWithPaintRegions();
  const meshes = paintMeshes(scene.exportRoot);
  assert.ok(meshes.every((mesh) => mesh.visible === false), 'GLTFExporter 默认只导可见对象，默认不可见即自动排除');
});
