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
import { loadCeilingConfig } from '../../server/config-loader.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';

// 涂漆检视态 + 成本核算子系统（墙顶面涂装 PKG-080）。DEC-2026-10-08-C05 建立、C06 洞口扣除。
// 四道防线：
//  ① overlay 的 paint_region 声明能过 schema 校验
//  ② buildScene 真的建出 inspection-only 网格，且朝声明房间侧外偏移（不共面 z-fighting）
//  ③ 面积独立复算：声明值 vs 从 model-geometry/house.yaml 推出的几何值，逐房间对账；
//     门洞/窗洞按实扣除，且 3D 网格数、净面积、预算行项目三处必须一致
//  ④ 成本模型与 materials.yaml / base.json / control.yaml 对账，口径未拍板前不选单一情景
//  ⑤ 顶面/窗台口径：顶面 = Σ footprint − Σ 整间铝扣板投影（集成吊顶不是涂装面）；
//     湿区窗台是单独计价的特殊系统面，只进 netAreaSqm，不进普通墙漆的 ordinaryAreaSqm

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

/** 轴对齐矩形的并集面积（重叠只算一次）。独立实现，不借用 server 侧同名私有函数。 */
function rectangleUnion(rects: Array<[number, number, number, number]>): number {
  if (!rects.length) return 0;
  const xs = [...new Set(rects.flatMap(([x1, , x2]) => [x1, x2]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x1 = xs[i], x2 = xs[i + 1];
    const spans = rects
      .filter(([a, , b]) => a < x2 && b > x1)
      .map(([, z1, , z2]) => [z1, z2] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    let covered = 0, start = Number.NaN, end = Number.NaN;
    for (const [z1, z2] of spans) {
      if (!Number.isFinite(start)) { start = z1; end = z2; }
      else if (z1 <= end + 1e-9) end = Math.max(end, z2);
      else { covered += end - start; start = z1; end = z2; }
    }
    if (Number.isFinite(start)) covered += end - start;
    area += (x2 - x1) * covered;
  }
  return area;
}

/**
 * L2 独立复算（顶面涂装面积）：从 config 现算，不读 scope 结果、不读 ceilingAreaByRoom。
 *
 *   顶面 = Σ(overlay 的 paint_ceiling_region 房间 footprint)
 *        − Σ(该房间内 aluminum_buckle 铝扣板吊顶的投影 ∩ 房间边界)
 *
 * footprint 走 resolveLayout(MG) 的房间面积，铝扣板投影走 loadCeilingConfig() 的 area 矩形。
 * 与 server/paint-cost-comparison.ts 的 computePaintScopeForLayout 同款算法、独立实现
 * （同 paintFaceCoverage 与 tmp/verify-wall-tile.ts 的 tileableOf 的关系）。
 *
 * 为什么必须复算：旧口径把两间卫浴的**整间铝扣板顶面**（客卫 3.15㎡ / 主卫 4.576㎡）
 * 当成普通乳胶漆顶面计费，顶面因此虚高成 110.95㎡。集成吊顶不是涂装面，
 * 必须在普通墙漆口径里按投影扣除。
 */
function ceilingPaintAreaFromConfig(): { byRoom: Record<string, number>; total: number } {
  const layout = resolveLayout(MG);
  const roomById = new Map(layout.rooms.map((room) => [room.id, room]));
  const ceilingZones = loadCeilingConfig();
  const byRoom: Record<string, number> = {};
  for (const element of (OV.elements ?? [])) {
    if (element.type !== 'paint_ceiling_region') continue;
    const room = roomById.get(element.room);
    if (!room) throw new Error(`paint_ceiling_region references unknown room ${element.room}`);
    const footprint = room.area ?? room.width * room.depth;
    const bounds: [number, number, number, number] = [
      room.x - room.width / 2, room.z - room.depth / 2,
      room.x + room.width / 2, room.z + room.depth / 2,
    ];
    const buckles = ceilingZones
      .filter((zone) => zone.room === room.id && zone.type === 'aluminum_buckle' && zone.area)
      .map((zone) => {
        const [x1, z1, x2, z2] = zone.area!;
        return [
          Math.max(x1, bounds[0]), Math.max(z1, bounds[1]),
          Math.min(x2, bounds[2]), Math.min(z2, bounds[3]),
        ] as [number, number, number, number];
      })
      .filter(([x1, z1, x2, z2]) => x2 > x1 && z2 > z1);
    byRoom[room.id] = Math.max(0, footprint - rectangleUnion(buckles));
  }
  return { byRoom, total: Object.values(byRoom).reduce((sum, value) => sum + value, 0) };
}

test('overlay paint_region declarations pass the Zod discriminated union', () => {
  const parsed = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  const regions: any[] = (parsed.elements ?? []).filter((e: any) => e.type === 'paint_region');
  // DEC-2026-10-08-C06：入户花园出范围（开发商已做好，收房后再定），4 段声明已删
  assert.equal(regions.length, 28, '2026-10-07 C14/C16 两卫饰面终裁后 28 段（22 + 客卫 4 + 主卫 2）');
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
  assert.equal(regions.length, 28);
});

test('buildScene emits paint meshes with reversible initial state, split at door openings', () => {
  const scene: any = sceneWithPaintRegions();
  assert.deepEqual(scene.unsupported ?? [], [], '所有 paint_region 都必须能落地');
  const meshes = paintMeshes(scene.exportRoot);
  const regionIds = [...new Set(meshes.map((mesh: any) => mesh.userData.regionId))];
  assert.equal(regionIds.length, 28, '声明仍是 28 段');
  assert.ok(meshes.length > 28, `门洞必须把声明拆成多块平面，实际 ${meshes.length} 块`);
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
  assert.equal(splitRegions.length, 8, '7 房范围内有 8 段声明被门洞穿过（主卫干区段被 d_mbath 穿过）');
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
  assert.ok(Math.abs(gross - 174.720) <= 0.02, `毛墙面 ${gross.toFixed(3)}`);
  assert.ok(Math.abs(net - 159.915) <= 0.02, `净墙面 ${net.toFixed(3)}`);
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
  // 2026-10-07 客卫"带+漆"终裁：砖到顶（wall_region height ≥ 2.6）的 (wall, room) 跨面不漆，
  // 独立复算按声明跨长剔除；0.30m 砖带/防溅带与漆的高度重叠是已知按桶吸收量，声明与复算
  // 两侧同按整面计，互相抵消不进入本对账。
  const tileToCeilSpan = new Map<string, number>();
  for (const e of (OV.elements ?? [])) {
    if (e.type !== 'wall_region' || (e.height ?? 0) < 2.6) continue;
    const span = e.along[1] - e.along[0];
    tileToCeilSpan.set(`${e.wall}|${e.room}`, (tileToCeilSpan.get(`${e.wall}|${e.room}`) ?? 0) + span);
  }
  let totalWall = 0;
  let totalCeiling = 0;
  for (const room of MG.rooms) {
    if (!paintFinish.has(room.id)) continue;
    const expected = paintFaceCoverage(room.boundary);
    const pruned = expected.map((hit) => {
      const tiled = tileToCeilSpan.get(`${hit.wall}|${room.id}`) ?? 0;
      return { wall: hit.wall, lengthM: Math.max(0, hit.lengthM - tiled) };
    }).filter((hit) => hit.lengthM > 1e-9);
    const expectedLength = +pruned.reduce((sum: number, hit) => sum + hit.lengthM, 0).toFixed(3);
    const expectedWalls = new Set(pruned.map((hit) => hit.wall));
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
  assert.ok(Math.abs(totalWall - 174.720) <= 0.02, `涂装墙面毛面积应约 174.72 ㎡，实算 ${totalWall.toFixed(2)}`);
  assert.ok(Math.abs(totalCeiling - 110.95) <= 0.02, `顶面 footprint 合计应约 110.95 ㎡，实算 ${totalCeiling.toFixed(2)}`);
});

/**
 * 顶面独立复算：Σ(7 间 footprint) − Σ(两间卫浴整间铝扣板投影) = 103.224㎡。
 * 全部从 config 现算（resolveLayout + loadCeilingConfig + overlay 的 paint_ceiling_region），
 * 不写死 103.224 冒充复算。
 */
test('ceiling paint area equals the config footprints minus the whole-room aluminium-buckle projections', () => {
  const recomputed = ceilingPaintAreaFromConfig();
  // footprint 口径先自证：7 间 paint_ceiling_region 的 footprint 合计仍是 110.95㎡
  assert.ok(Math.abs(recomputed.total + (3.15 + 4.576) - 110.95) <= 0.02,
    `扣除前 footprint 合计应约 110.95 ㎡，实算 ${(recomputed.total + 3.15 + 4.576).toFixed(3)}`);
  // 涂装顶面：两间卫浴的整间铝扣板顶面（客卫 3.15㎡ / 主卫 4.576㎡）不是普通乳胶漆面，必须扣除
  assert.ok(Math.abs(recomputed.total - 103.224) <= 0.02,
    `顶面涂装面积应约 103.224 ㎡（110.95 − 客卫 3.15 − 主卫 4.576），实算 ${recomputed.total.toFixed(3)}`);
  assert.ok(Math.abs((110.95 - recomputed.total) - 7.726) <= 0.02,
    `铝扣板扣除量应为 7.726 ㎡（3.15 + 4.576），实算 ${(110.95 - recomputed.total).toFixed(3)}`);

  // 独立复算必须与 server 侧口径逐分对账：同一个数字不能有两套算法
  const catalog = ProjectCatalog.load('.');
  const scope = computePaintScopeForLayout(resolveLayout(MG), catalog, loadPaintScopeInputs());
  assert.ok(Math.abs(scope.ceilingAreaSqm - recomputed.total) <= 0.02,
    `scope.ceilingAreaSqm=${scope.ceilingAreaSqm} 与独立复算 ${recomputed.total.toFixed(3)} 不一致`);
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
  // 边缘房间：都不在涂装范围（guest_bath 2026-10-07 终裁改"带+漆"后已入涂装范围）
  for (const outOfScope of ['elevator_shaft', 'kitchen', 'balcony']) {
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
  assert.equal(scope.doorGapAreaSqm, 14.805, '门洞占位 13.23 + 主卫门跨内 1.575㎡');
  assert.equal(scope.windowGapAreaSqm, 0, '窗洞当前为 0：窗全在 suppress 的玻璃幕墙上');
  assert.ok(Math.abs(scope.grossWallAreaSqm - 174.720) <= 0.02, `毛墙面 ${scope.grossWallAreaSqm}`);
  assert.ok(Math.abs(scope.netWallAreaSqm - 159.915) <= 0.02, `净墙面 ${scope.netWallAreaSqm}`);
  assert.ok(Math.abs(scope.netWallAreaSqm - (scope.grossWallAreaSqm - scope.doorGapAreaSqm - scope.windowGapAreaSqm)) <= 0.01);
  assert.ok(Math.abs(scope.ceilingAreaSqm - 103.224) <= 0.02, `顶面 ${scope.ceilingAreaSqm}`);
  assert.ok(Math.abs(scope.netAreaSqm - 267.337) <= 0.02, `墙+顶+窗台净面积 ${scope.netAreaSqm}`);
  assert.deepEqual(scope.warnings, []);

  // 顶面旧值 110.95㎡ 错在：把客卫 3.15㎡ / 主卫 4.576㎡ 的**整间铝扣板顶面**当成普通
  // 乳胶漆顶面计费。集成吊顶不是涂装面，必须按投影从普通墙漆口径里扣除 → 103.224㎡。

  // 窗台是「单独计价的特殊系统面」：湿区窗台不进普通墙漆费率，湿区单列待分项报价。
  // 旧窗台值源于 BaySillGeometry.reverse() 原地反转污染 wallPath：start_end 被配成横跨
  // 整条窗台的 1.803m 斜肢（1.046㎡）而不是 1.1m 真端面（0.638㎡），窗台因此虚高成 4.606㎡。
  // 2026-10-09 精度口径修复：不再逐段 round3 再累加，改为内部全精度 + 汇总 round3，
  // 4.198 → 4.193㎡（与浏览器独立三角网格复算 4.193365㎡ 一致；旧口径系统性高 0.0046㎡）。
  assert.deepEqual(scope.sillAreaByRoom, { master_bath: 4.193 });
  assert.equal(scope.ordinarySillAreaSqm, 0, '当前没有按普通漆计价的窗台');
  assert.equal(scope.wetAreaSqm, 4.193, '主卫上飘窗外露面是湿区，单独计价');
  assert.equal(scope.sillSurfaces.length, 1, '只有一条 paint_sill_region 声明');
  const sillSurface = scope.sillSurfaces[0];
  assert.equal(sillSurface.declaration.room, 'master_bath');
  assert.equal(sillSurface.declaration.finish, 'wet_area');
  assert.equal(sillSurface.totalAreaSqm, 4.193);

  // 普通计费面积 = 净墙 + 顶 + 普通窗台（湿区窗台不按普通墙漆费率计费）
  assert.equal(scope.ordinaryAreaSqm, 263.139);
  assert.equal(scope.grossAreaSqm, 282.137, '毛面积含湿区窗台');
  // 守恒：普通 + 湿区 = 全部涂装面（netAreaSqm），一处不漏也不重复计
  assert.ok(
    Math.abs(scope.ordinaryAreaSqm + scope.wetAreaSqm - scope.netAreaSqm) <= 0.01,
    `普通 ${scope.ordinaryAreaSqm} + 湿区 ${scope.wetAreaSqm} 必须等于全部涂装面 ${scope.netAreaSqm}`,
  );

  // 预算侧读取的必须是同一个「普通墙漆计费面积」：湿区窗台单独计价（待分项报价），
  // 不进普通墙漆预算行项目，所以对账口径是 ordinaryAreaSqm 而不是 netAreaSqm。
  const rules = load(readFileSync('config/design-rules.yaml', 'utf8')) as any;
  const calc = new BudgetCalculator(catalog, rules);
  const snapshot = calc.calculate({ selections: { paint: { default: 'latex_paint_01' } } } as any, 'full');
  const painted = snapshot.lineItems.filter((li) => li.topic === 'paint').reduce((sum, li) => sum + li.quantity, 0);
  assert.ok(Math.abs(painted - scope.ordinaryAreaSqm) <= 0.01, `预算行项目合计 ${painted} 必须等于普通计费面积 ${scope.ordinaryAreaSqm}`);
  const painting = snapshot.categories.find((category) => category.key === 'painting')!;
  assert.ok(Math.abs(painting.actual - 7977.02235) <= 1, `painting actual=${painting.actual}`);
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
  assert.equal(comparison.scope.paintRoomCount, 7);
  assert.equal(comparison.scope.wallRegionEntryCount, 28);
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
  // 计价面积是 ordinaryAreaSqm（263.139㎡）：湿区窗台单独计价，不按普通墙漆费率计费
  const twoCoats = byId.get('topcoats2_deduct')!;
  assert.equal(twoCoats.areaSqm, 263.139);
  assert.equal(twoCoats.topcoatBuckets, 5, '2 遍面漆需 5 桶');
  assert.equal(twoCoats.primerBuckets, 3, '1 遍底漆需 3 桶');
  assert.equal(twoCoats.materialYuan, 4640);
  assert.equal(twoCoats.laborYuan, 6578.48);
  assert.equal(twoCoats.subtotalYuan, 11218.48);
  assert.equal(twoCoats.vsPlannedDeltaYuan, -281.52);
  assert.equal(twoCoats.vsOwnerTargetDeltaYuan, 218.48);

  // 对照：不扣洞 = 普通计费面积 + 门窗洞占位（旧值 285.67㎡ = 270.865 + 14.805，
  // 其中 270.865 含已被排除的湿区窗台且顶面未扣铝扣板，两处口径都已作废）
  const twoCoatsGross = byId.get('topcoats2_no_deduct')!;
  assert.equal(twoCoatsGross.areaSqm, 277.944);
  assert.equal(twoCoatsGross.laborYuan, 6948.6);
  assert.equal(twoCoatsGross.subtotalYuan, 12168.6);

  const oneCoat = byId.get('topcoats1_deduct')!;
  assert.equal(oneCoat.areaSqm, 263.139);
  assert.equal(oneCoat.topcoatBuckets, 3);
  assert.equal(oneCoat.materialYuan, 3480);
  assert.equal(oneCoat.laborYuan, 6578.48);
  assert.equal(oneCoat.subtotalYuan, 10058.48);

  const oneCoatGross = byId.get('topcoats1_no_deduct')!;
  assert.equal(oneCoatGross.areaSqm, 277.944);
  assert.equal(oneCoatGross.subtotalYuan, 10428.6);

  assert.deepEqual(comparison.reconciliation.modeledRangeCny, [10058.48, 12168.6]);
});

test('paint cost comparison turns an all-in quote into comparable totals', () => {
  const layout = resolveLayout(MG);
  const catalog = ProjectCatalog.load('.');
  const comparison = buildPaintCostComparison(layout, loadPaintComparisonConfig(), catalog);
  assert.equal(comparison.quotes.length, 1);
  const quote = comparison.quotes[0];
  assert.equal(quote.quoteId, 'dulux_turnkey_55');
  assert.equal(quote.source, '多乐士');
  assert.equal(quote.form, 'turnkey_labor_and_material');
  assert.equal(quote.rateYuanPerSqm, 55);
  // 计价面积取普通计费面积（与默认情景同源：扣门窗洞，且湿区窗台不按普通漆计价）
  assert.equal(quote.areaSqm, 263.139);
  assert.equal(quote.totalYuan, 14472.65);            // 55 × 263.139
  assert.equal(quote.vsPlannedDeltaYuan, 2972.65);    // vs PKG-080 计划 11500
  assert.equal(quote.vsOwnerTargetDeltaYuan, 3472.65); // vs 业主目标 11000
  // 与自下而上涂刷模型（2 遍 + 扣洞 = 11218.48）的差额 = 基层/腻子/样品保护的隐含额度
  assert.equal(quote.vsBrushingModelDeltaYuan, 3254.17);
  assert.equal(quote.impliedAllowanceYuanPerSqm, 12.37);
  // 覆盖范围/遍数未确认 → 状态显形，且 warning 必须提示
  assert.equal(quote.coverage, 'pending_confirmation');
  assert.equal(quote.coats, 'pending_confirmation');
  assert.equal(quote.quoteStatus, 'owner_reported_unconfirmed');
  assert.ok(
    comparison.warnings.some((w) => w.includes('dulux_turnkey_55') && w.includes('覆盖范围未确认')),
    '未确认覆盖范围的报价必须显形',
  );
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
  assert.equal(doorGap.value, 14.805);
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
  // app/src/App.ts:572 的签名已带 `announce = true`（DEC-2026-10-07-R09：同一开关被 PaintButton
  // onToggle 与图层同步复用，关态时不应重复播报），旧正则 `\(visible: boolean\): void` 写死单参故失配。
  // 这里放行新增参数（[^)]*），但保持原检测意图：仍然只取开关函数体、仍然要求体内不得引用 HVAC。
  const appPaint = /private setPaintInspectionVisible\(visible: boolean[^)]*\): void \{[\s\S]*?\n  \}/.exec(app);
  assert.ok(appPaint);
  assert.ok(!/Hvac|hvac/.test(appPaint![0]), 'App 的涂漆开关播报不得引用 HVAC');
});

test('paint inspection overlay is excluded from GLB export by default visibility', () => {
  const scene: any = sceneWithPaintRegions();
  const meshes = paintMeshes(scene.exportRoot);
  assert.ok(meshes.every((mesh) => mesh.visible === false), 'GLTFExporter 默认只导可见对象，默认不可见即自动排除');
});
