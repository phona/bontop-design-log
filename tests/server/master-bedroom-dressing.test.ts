import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { FURNITURE_DIMS, isCurtainSoftEnvelopePreview, MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE, type RenderLightingFixture } from '../../shared/types.js';
import { WALL_THICKNESS } from '../../shared/furniture-placement.js';
import { buildFixture, setNorthWallWardrobe950DoorConfiguration, type NorthWallWardrobe950DoorConfiguration, setNorthWallWardrobe950DoorState } from '../../shared/render/FixtureFactory.js';
import { buildInfrastructure } from '../../shared/render/InfrastructureBuilder.js';
import { pointWallIndexFromElements, resolvePointPlacementInWalls } from '../../shared/point-placement.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingsYaml, VertexLayoutYaml } from '../../shared/types.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { buildLightingFixtures } from '../../shared/render/LightingFixtureBuilder.js';
import * as THREE from 'three';

type Furnishing = {
  type: string; id?: string; x?: number; z?: number; rotation?: number;
  width?: number; depth?: number; cabinetHeight?: number;
  // 摆位声明字段（定位形式）：placed() 返回几何身份时剥离，deepEqual 不钉定位形式。
  wall?: string; wall_side?: string; along?: number; wall_clearance?: number;
  anchor?: unknown; mount?: unknown;
  note?: string; blocker?: unknown;
  support?: unknown; room?: string; room_dx?: number; room_dz?: number;
};
type ElectricalPoint = {
  id: string;
  type?: string;
  x?: number;
  z?: number;
  height?: number;
  wall?: string;
  wall_side?: string;
  note?: string;
  appearance?: {
    style: string;
    module: string;
    faceplate_width: number;
    faceplate_height: number;
    projection: number;
    panel_group?: { id: string; role: string; center_spacing: number; union_width: number };
  };
};
type PlumbingPoint = { id: string; x?: number; z?: number; wall?: string; wall_side?: string; along?: number; face_offset?: number };
type RuntimeAabb = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

const house = load(readFileSync('config/house.yaml', 'utf8')) as { furnishings: Record<string, Furnishing[]> };
const electrical = load(readFileSync('config/electrical.yaml', 'utf8')) as ElectricalPoint[];
const plumbing = load(readFileSync('config/plumbing.yaml', 'utf8')) as PlumbingPoint[];
const master = house.furnishings.master_bedroom;

const GAP_EPS = 1e-9;
const RUNTIME_EPS = 1e-6;

test('R6 curtain soft envelope stays separate from hard floor collision', () => {
  assert.equal(isCurtainSoftEnvelopePreview(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE), true);
  // topBox z[8.7, 8.95] 是 R6 裁定值（沙发偏移 −0.30m 的窗帘软包络），按裁定值例外保留。
  assert.deepEqual(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.topBox, { z: [8.7, 8.95], ceilingOnly: true, confidence: 'confirmed', status: 'confirmed' });
  // closedDrop：wallZ 为主卧南缘（房间几何南边缘）；z 带由 wallZ 与本条自身的
  // interiorOffset/thickness 算出（外缘 = wallZ − interiorOffset，内缘再 − thickness）。
  const masterRoom = MB_LAYOUT.rooms.find((room) => room.id === 'master_bedroom');
  assert.ok(masterRoom, 'missing master_bedroom room');
  const roomSouthEdge = masterRoom!.z + masterRoom!.depth / 2;
  const closedDrop = MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.closedDrop;
  assert.ok(Math.abs(closedDrop.wallZ - roomSouthEdge) < GAP_EPS, `closedDrop wallZ ${closedDrop.wallZ} must be the master bedroom south edge ${roomSouthEdge}`);
  assert.ok(Math.abs(closedDrop.z[0] - (closedDrop.wallZ - closedDrop.thickness - closedDrop.interiorOffset)) < GAP_EPS);
  assert.ok(Math.abs(closedDrop.z[1] - (closedDrop.wallZ - closedDrop.interiorOffset)) < GAP_EPS);
  assert.equal(closedDrop.confidence, 'inferred');
  assert.equal(closedDrop.status, 'site_pending');
  assert.equal(closedDrop.conflictLevel, 'warning');
  assert.equal(closedDrop.acceptance, 'BLOCKED');
  assert.equal(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.openStack.end, null);
  assert.equal(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.openStack.status, 'site_pending');
  assert.equal(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.floorHardExclusion, null);
  assert.deepEqual(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.checkedObjects, ['master_bedside_cabinet_350_south', 'master_hot_season_low_dresser']);
  assert.ok(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.retainedObjects.includes('master_hot_season_low_dresser'));
});

function fixtureSize(type: string): THREE.Vector3 {
  const fixture = buildFixture(type);
  assert.ok(fixture, `missing fixture ${type}`);
  fixture!.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(fixture!).getSize(new THREE.Vector3());
}

// （#98 Tier 2）placed() 的 x/z 改走共享解算：墙锚/anchor 家具无声明 x/z，直读原始
// YAML 会把它当「未摆位」丢掉（两床头柜锚床后即如此）。只改取数来源：位置取
// buildPlacementIndexes 的解算结果，类型/id/rotation 取声明；返回形状与断言目标一致
// （{type, id, x, z, rotation}），断言值一字不动。
// 房间相对摆位（2026-11-16 DDD 模型约束）：房间包络随解算上下文传入；不传时 7 件
// 房间相对家具不在 mountHosts 里，placed() 断言「解算失败」。
const PLACED_LAYOUT = resolveLayout(load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml);
const PLACED_HOSTS = buildPlacementIndexes({
  geometry: { walls: PLACED_LAYOUT.walls },
  furnishings: house.furnishings as unknown as FurnishingsYaml,
  anchors: { rooms: new Map(PLACED_LAYOUT.rooms.map((room) => [room.id, room])) },
}).mountHosts;

function placed(type: string, room: Furnishing[] = master): Furnishing {
  const item = room.find((candidate) => candidate.type === type);
  assert.ok(item, `missing placed ${type}`);
  // 关系化家具不再声明 x/z：坐标取 buildPlacementIndexes 的解算结果（与 3D/DXF/
  // verify 同源），与本文件 point()/plumbPoint() 的「解算覆盖声明」同一口径；绝对家具
  // 的解算值与声明一致。返回几何身份（类型/id/尺寸/旋转 + 解算坐标），摆位声明字段
  // （wall/along/anchor/mount）是定位形式、不进 deepEqual——形式由 Tier 1 结构测试覆盖，
  // 几何测试不因迁移改表达形式而逐条改期望值。
  const host = item.id === undefined ? undefined : MB_FURNITURE_HOSTS?.get(item.id);
  assert.ok(host !== undefined && Number.isFinite(host.x) && Number.isFinite(host.z),
    `${type}: 家具摆位解算失败（无宿主或坐标非有限数）`);
  const { wall: _wall, wall_side: _wallSide, along: _along, wall_clearance: _clearance, anchor: _anchor, mount: _mount, support: _support, room: _room, room_dx: _roomDx, room_dz: _roomDz, ...geometry } = item;
  // 解算器浮点噪声（~1e-15m）归一到 1e-9m：与本文件 GAP_EPS 同口径，deepEqual
  // 才能逐位比对；几何容差仍是 0.005m，归一不掩盖任何真实漂移。
  const round9 = (value: number): number => Math.round(value * 1e9) / 1e9;
  return { ...geometry, x: round9(host.x as number), z: round9(host.z as number) };
}

// 主卧宿主墙索引（issue #98 S1/S3）：点位定位走 shared/point-placement.ts 单一解算，
// 沿墙点位不再声明绝对 x/z，测试里的「坐标」一律取解析结果（与 3D/DXF/MEP 同源）。
// 索引直接取 model-geometry（经 resolveLayout），不手抄墙段——手抄就会出现第二份几何。
const MB_POINT_WALLS = pointWallIndexFromElements(
  resolveLayout(load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml).walls,
);

// 家具摆位解算索引（#98 Tier 1，见 placed()）：全屋 furnishings + 全量墙一次解算，
// mountHosts 按声明 id 索引；解算失败的件不在表里，placed() 显式断言、不静默跳过。
// 房间相对摆位（2026-11-16 DDD 模型约束）：房间包络随解算上下文传入（与 PLACED_HOSTS 同源）。
const MB_FURNITURE_HOSTS = buildPlacementIndexes({
  geometry: { walls: PLACED_LAYOUT.walls },
  furnishings: house.furnishings as unknown as FurnishingsYaml,
  anchors: { rooms: new Map(PLACED_LAYOUT.rooms.map((room) => [room.id, room])) },
}).mountHosts;

function plumbPoint(id: string): PlumbingPoint {
  const found = plumbing.find((candidate) => candidate.id === id);
  assert.ok(found, `missing plumbing point ${id}`);
  if (found.wall === undefined) return found;
  const { placement, diagnostic } = resolvePointPlacementInWalls(found as never, MB_POINT_WALLS);
  assert.equal(diagnostic, undefined, `${id}: ${diagnostic ?? ''}`);
  assert.ok(placement, `${id}: 解算失败`);
  return { ...found, x: placement!.x, z: placement!.z };
}

function point(id: string): ElectricalPoint {
  const found = electrical.find((candidate) => candidate.id === id);
  assert.ok(found, `missing electrical point ${id}`);
  if (found.wall === undefined) return found;
  const { placement, diagnostic } = resolvePointPlacementInWalls(found as never, MB_POINT_WALLS);
  assert.equal(diagnostic, undefined, `${id}: ${diagnostic ?? ''}`);
  assert.ok(placement, `${id}: 解算失败`);
  return { ...found, x: placement!.x, z: placement!.z };
}

// 世界 AABB：奇数 quarter-turn 旋转交换 width/depth（与 verify-furniture-placement 同口径）
function worldAabb(item: Furnishing): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const dims = FURNITURE_DIMS[item.type];
  assert.ok(dims, `no FURNITURE_DIMS for ${item.type}`);
  const quarterTurn = Math.round((item.rotation ?? 0) / 90) % 2 !== 0;
  const width = quarterTurn ? dims.depth : dims.width;
  const depth = quarterTurn ? dims.width : dims.depth;
  return { minX: item.x! - width / 2, maxX: item.x! + width / 2, minZ: item.z! - depth / 2, maxZ: item.z! + depth / 2 };
}

function runtimeAabb(object: THREE.Object3D): RuntimeAabb {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  return { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z };
}

function runtimeFurnitureAabb(type: string): RuntimeAabb {
  const item = placed(type);
  const fixture = buildFixture(type);
  assert.ok(fixture, `missing runtime furniture fixture ${type}`);
  fixture!.position.set(item.x!, 0, item.z!);
  fixture!.rotation.y = THREE.MathUtils.degToRad(item.rotation ?? 0);
  return runtimeAabb(fixture!);
}

function runtimeElectricalAabb(id: string): RuntimeAabb {
  const source = point(id);
  if (source.type === 'wall_lamp') {
    const built = buildLightingFixtures([{
      id: source.id,
      room: 'master_bedroom',
      type: 'wall_lamp',
      position: { x: source.x!, y: source.height!, z: source.z! },
      temperatureK: 3000,
      enabled: true,
      wallId: source.wall,
      wallSide: source.wall_side as RenderLightingFixture['wallSide'],
    }]);
    const fixture = built.fixtures.get(`electrical:${id}`);
    assert.ok(fixture, `missing runtime lighting fixture ${id}`);
    return runtimeAabb(fixture!);
  }
  const normalized = { ...source, wallSide: source.wall_side };
  const built = buildInfrastructure({
    electrical: [normalized as any],
    plumbing: [],
    pointWalls: MB_POINT_WALLS,
  });
  const fixture = built.electrical[0];
  assert.ok(fixture, `missing runtime electrical fixture ${id}`);
  return runtimeAabb(fixture!);
}

function aabbIntersects(a: RuntimeAabb, b: RuntimeAabb): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

// ── 规则断言参考实现（PR #253 round 3）：期望值在测试内从声明重算，不抄录
// 已解算坐标。与 resolver-baseline 的独立参考实现同口径：参考实现读原始几何
// （经 resolveLayout 的墙段/房间/洞口），不读解算结果；墙锚家具的深度轴垂直于墙面。
const MB_LAYOUT = resolveLayout(load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml);

function mbWall(id: string): { x1: number; z1: number; x2: number; z2: number } {
  const wall = MB_LAYOUT.walls.find((candidate) => candidate.id === id);
  assert.ok(wall, `missing wall ${id}`);
  return wall!;
}

// 挂面法线（轴向墙）：east → +x，west → −x，south → +z，north → −z。
function wallSideNormal(wallSide: string): { x: number; z: number } {
  if (wallSide === 'east') return { x: 1, z: 0 };
  if (wallSide === 'west') return { x: -1, z: 0 };
  if (wallSide === 'south') return { x: 0, z: 1 };
  if (wallSide === 'north') return { x: 0, z: -1 };
  throw new Error(`unknown wall_side ${wallSide}`);
}

/** 墙锚家具的参考中心：墙段起点 + 沿墙方向 × along，法线偏移半墙厚 + clearance + 深度/2。 */
function referenceWallFurnitureCenter(
  wallId: string, wallSide: string, along: number, wallClearance: number, depth: number,
): { x: number; z: number } {
  const wall = mbWall(wallId);
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  const dirX = (wall.x2 - wall.x1) / length;
  const dirZ = (wall.z2 - wall.z1) / length;
  const normal = wallSideNormal(wallSide);
  const offset = WALL_THICKNESS / 2 + wallClearance + depth / 2;
  return { x: wall.x1 + dirX * along + normal.x * offset, z: wall.z1 + dirZ * along + normal.z * offset };
}

/** 沿墙点位的参考位置：墙段起点 + 沿墙方向 × along，法线偏移半墙厚 + face_offset。 */
function referenceWallPoint(
  wallId: string, wallSide: string, along: number, faceOffset: number,
): { x: number; z: number } {
  const wall = mbWall(wallId);
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  const dirX = (wall.x2 - wall.x1) / length;
  const dirZ = (wall.z2 - wall.z1) / length;
  const normal = wallSideNormal(wallSide);
  const offset = WALL_THICKNESS / 2 + faceOffset;
  return { x: wall.x1 + dirX * along + normal.x * offset, z: wall.z1 + dirZ * along + normal.z * offset };
}

/** anchor 挂载家具的期望位置：宿主已解算位置 + 声明 offset（世界轴，不旋转）。 */
function anchorExpected(hostType: string, item: Furnishing, room: Furnishing[] = master): { x: number; z: number } {
  const anchor = item.anchor as { source: string; id: string; offset: { x: number; z: number } } | undefined;
  assert.ok(anchor, `${item.type} must declare an anchor`);
  const host = placed(hostType, room);
  return { x: host.x! + anchor.offset.x, z: host.z! + anchor.offset.z };
}

/** anchor 声明的宿主 id（须为期望的宿主对象）。 */
function anchorHostId(item: Furnishing): string {
  const anchor = item.anchor as { source: string; id: string; offset: { x: number; z: number } } | undefined;
  assert.ok(anchor, `${item.type} must declare an anchor`);
  return anchor.id;
}

/**
 * 尺寸双源对账：fixture mesh 实测 footprint 与尺寸声明（FURNITURE_DIMS 或行内
 * width/depth）须在同一量级。容差是构造细节 allowance——实测最大偏差为床 rail
 * 外伸 0.06m（mesh x 1.86 vs DIMS 1.8）、桌板边 0.01m、抽屉面 0.014m；换 SKU
 * 的尺寸差 ≥0.10m 仍会被抓住。mesh 概念与 footprint 不同的件（如植物冠幅）
 * 不适用本 helper（本文件无此 pin）。
 */
function assertMeshMatchesDims(type: string, width: number, depth: number, tolerance: number, what: string): void {
  const size = fixtureSize(type);
  assert.ok(Math.abs(size.x - width) <= tolerance, `${what} mesh x ${size.x} vs 声明宽 ${width}（容差 ${tolerance}）`);
  assert.ok(Math.abs(size.z - depth) <= tolerance, `${what} mesh z ${size.z} vs 声明深 ${depth}（容差 ${tolerance}）`);
}

/** 通顶柜的参考中心（行内声明：w_mbath_east 西侧，along 2.51，clearance 0.015，深 0.565）。 */
function fullHeightCabinetCenter(): { x: number; z: number } {
  const cabinet = master.find((item) => item.type === 'mb_full_height_cabinet');
  assert.ok(cabinet, 'missing mb_full_height_cabinet');
  return referenceWallFurnitureCenter(
    cabinet.wall!, cabinet.wall_side!, cabinet.along!, cabinet.wall_clearance!, cabinet.depth!,
  );
}

test('950 left shift clears d_mb while preserving the north-wall room envelope', () => {
  const currentMaxX = 3.55;
  const targetMaxX = 3.25;
  const wardrobeWidth = 0.95;
  const shift = currentMaxX - targetMaxX;
  const candidateMinX = targetMaxX - wardrobeWidth;
  assert.ok(Math.abs(shift - 0.30) < GAP_EPS);
  assert.equal(candidateMinX, 2.30);
  assert.equal(candidateMinX + wardrobeWidth, targetMaxX);
  assert.ok(targetMaxX <= 3.30, 'candidate must clear d_mb sweep west edge');
});

test('R9 master-bedroom furniture set places the full-height cabinet and removes R5/R6 objects', () => {
  // 床是睡眠区布局原点（设计输入，PR #247）：x 可由东墙线 + 深度/2 派生（床东缘
  // 贴东墙线，rotation 270 后世界 x 向跨度为 DIMS depth）；z 无派生源——没有任何
  // 对象锚定床，床是床头柜的锚源；z 保留为具名设计输入锁，不得静默删。
  const bed = placed('bed_180');
  const eastWall = mbWall('w_mb_east');
  assert.equal(bed.type, 'bed_180');
  assert.equal(bed.id, 'mb.bed_180');
  assert.ok(Math.abs(bed.x! - (eastWall.x1 - FURNITURE_DIMS.bed_180.depth / 2)) < GAP_EPS,
    `bed x ${bed.x} must be the east wall line minus half the bed depth`);
  assert.equal(bed.z, 7.40, 'bed z is the sleeping-zone layout origin (design input, PR #247)');
  assert.equal(bed.rotation, 270);
  // 床头柜锚床：位置 = 床位置 + 声明 offset（世界轴，不旋转），宿主须为 mb.bed_180。
  for (const type of ['master_bedside_cabinet_350_north', 'master_bedside_cabinet_350_south'] as const) {
    const decl = master.find((item) => item.type === type);
    assert.ok(decl, `missing ${type}`);
    assert.equal(anchorHostId(decl), 'mb.bed_180', `${type} must anchor to mb.bed_180`);
    const expected = anchorExpected('bed_180', decl);
    const cabinet = placed(type);
    assert.equal(cabinet.type, type);
    assert.equal(cabinet.id, decl.id);
    assert.ok(Math.abs(cabinet.x! - expected.x) < GAP_EPS && Math.abs(cabinet.z! - expected.z) < GAP_EPS,
      `${type} must sit at bed + declared anchor offset`);
    assert.equal(cabinet.rotation, decl.rotation);
    // 尺寸双源对账：mesh 实测 footprint == DIMS（柜体 recipe 与目录严格一致）。
    assertMeshMatchesDims(type, FURNITURE_DIMS[type].width, FURNITURE_DIMS[type].depth, 1e-6, type);
  }
  assert.ok(fixtureSize('master_bedside_cabinet_350_north').y >= 0.495 && fixtureSize('master_bedside_cabinet_350_north').y <= 0.505);
  assert.ok(fixtureSize('master_bedside_cabinet_350_south').y >= 0.495 && fixtureSize('master_bedside_cabinet_350_south').y <= 0.505);
  // 床尺寸双源对账：mesh 宽 1.86 vs DIMS 1.8 差 0.06m 是 rail 外伸（每侧 30mm），
  // 在构造细节容差内；换 SKU 的尺寸差 ≥0.10m 仍会被抓住。
  assertMeshMatchesDims('bed_180', FURNITURE_DIMS.bed_180.width, FURNITURE_DIMS.bed_180.depth, 0.07, 'bed_180');
  for (const type of ['socket', 'switch', 'switch_2way']) {
    const fixture = buildFixture(type);
    assert.ok(fixture);
    fixture!.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(fixture!).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x - 0.086) < 1e-6 && Math.abs(size.y - 0.086) < 1e-6, `${type} must be 86x86mm`);
    assert.ok(fixture!.children.some((child) => child.userData.materialRole === 'faceplate'));
    assert.ok(type === 'socket' ? fixture!.children.some((child) => child.userData.materialRole === 'usb_c') : fixture!.children.some((child) => child.userData.materialRole === 'rocker'));
  }
  for (const removed of ['master_partition_wardrobe_1600', 'master_dressing_connection_storage', 'master_freestanding_wardrobe_062', 'master_bedside_cabinet_north', 'master_bedside_tray_south', 'master_north_wall_wardrobe_600', 'master_north_wall_wardrobe_650']) {
    assert.equal(master.some((item) => item.type === removed && item.x !== undefined), false, `${removed} must be removed from R7 placed set`);
  }
  // 2026-11-13 issue #116：950 衣柜 + 顶封 + 底柜 + 双悬浮板 + 三件 PVC 链件退役，
  // 悬浮板位改为通顶定制柜。退役件是挂墙声明（无 x/z），须按 type 全量查、不能用
  // placed() 的 x/z 条件（该条件对挂墙件恒假，会把「仍在」误判成「已删」）。
  for (const removed of ['master_north_wall_wardrobe_950', 'master_wardrobe_top_pelmet', 'mb_vanity_base_cabinet', 'mb_vanity_lower_board', 'mb_vanity_main_board', 'mb_vanity_pvc_box', 'mb_vanity_pvc_wardrobe_entry', 'mb_vanity_pvc_service_chase', 'mb_condensate_pipe']) {
    assert.equal(master.some((item) => item.type === removed), false, `${removed} must be removed from master_bedroom furnishings (issue #116)`);
  }
  // 通顶柜：单点参数化声明（house.yaml），沿墙 along 2.51 = 沿墙距离（自墙段起点顶点
  // v_bath_ne z=1.10 向北量，2026-11-07 issue #98 删除本墙「along = 绝对 z」历史特例）
  // → 世界 z = 1.10 + 2.51 = 3.61。宽/深/柜身高行内声明（FURNITURE_DIMS 不再是
  // 第二套尺寸来源；PR-9「行内不写第二套」口径由 #116 参数化单点声明取代）。
  const cabinet = master.find((item) => item.type === 'mb_full_height_cabinet');
  // 2026-11-16 用户裁定（浴霸穿柜改顶封 25mm 线槽 infer）：本条带 note + blocker。
  // 原 verbatim deepEqual 改结构断言：摆位形式逐字段、摆位由墙锚参考实现重算、
  // 尺寸由 mesh 对账、blocker 按字段查（kind/owner 精确，trigger/reverses_if/
  // rationale 与 note 只查决策标记，不钉原文 prose）。
  assert.ok(cabinet, 'missing mb_full_height_cabinet');
  assert.equal(cabinet.type, 'mb_full_height_cabinet');
  assert.equal(cabinet.id, 'mb.full_height_cabinet');
  assert.equal(cabinet.wall, 'w_mbath_east');
  assert.equal(cabinet.wall_side, 'west');
  assert.equal(cabinet.rotation, 270);
  assert.equal(cabinet.along, 2.51);
  assert.equal(cabinet.width, 1.38);
  assert.equal(cabinet.depth, 0.565);
  assert.equal(cabinet.cabinetHeight, 2.80);
  assert.equal(cabinet.wall_clearance, 0.015);
  // DDD 模型约束（支撑声明）：柜体落地，support 声明须为 floor（原 verbatim
  // deepEqual 里带的 support 字段，改结构断言后保留为声明锁）。
  assert.deepEqual(cabinet.support, { kind: 'floor' });
  const cabinetPlaced = placed('mb_full_height_cabinet');
  const cabinetExpected = fullHeightCabinetCenter();
  assert.ok(Math.abs(cabinetPlaced.x! - cabinetExpected.x) < GAP_EPS && Math.abs(cabinetPlaced.z! - cabinetExpected.z) < GAP_EPS,
    `cabinet must sit at the wall-anchor reference (w_mbath_east + along + clearance + depth/2)`);
  assertMeshMatchesDims('mb_full_height_cabinet', cabinet.width!, cabinet.depth!, 1e-6, 'mb_full_height_cabinet');
  assert.ok(Math.abs(fixtureSize('mb_full_height_cabinet').y - cabinet.cabinetHeight!) < 1e-6, 'cabinet mesh height must equal the declared cabinetHeight');
  assert.match(cabinet.note ?? '', /25mm/);
  const blocker = cabinet.blocker as { kind?: string; owner?: unknown; trigger?: string; reverses_if?: string; rationale?: string } | undefined;
  assert.ok(blocker, 'cabinet must carry a blocker');
  assert.equal(blocker.kind, 'site_measurement');
  assert.deepEqual(blocker.owner, ['量房']);
  assert.match(blocker.trigger ?? '', /量房/);
  assert.match(blocker.reverses_if ?? '', /25mm|过梁/);
  assert.match(blocker.rationale ?? '', /infer/);
  for (const type of ['mb_vanity_lower_board_bridge', 'mb_vanity_main_board_bridge']) {
    assert.equal(master.some((item) => item.type === type), false, `${type} must be removed from active placed set`);
    assert.equal((FURNITURE_DIMS as Record<string, unknown>)[type], undefined, `${type} fixture dimensions must be removed`);
  }
  const cabinetFixture = buildFixture('mb_full_height_cabinet');
  assert.ok(cabinetFixture);
  // 摆位中心由墙锚参考实现重算（墙线 − 半墙厚 − clearance − 深/2，见 fullHeightCabinetCenter）；
  // 包络由中心 + 行内宽/深/柜身高派生（rotation 270：世界 x 向跨度为深，z 向跨度为宽）。
  const cabinetCenter = fullHeightCabinetCenter();
  cabinetFixture!.position.set(cabinetCenter.x, 0, cabinetCenter.z);
  cabinetFixture!.rotation.y = THREE.MathUtils.degToRad(270);
  cabinetFixture!.updateMatrixWorld(true);
  const cabinetBox = new THREE.Box3().setFromObject(cabinetFixture!);
  assert.ok(Math.abs(cabinetBox.min.x - (cabinetCenter.x - cabinet!.depth! / 2)) < 1e-6 && Math.abs(cabinetBox.max.x - (cabinetCenter.x + cabinet!.depth! / 2)) < 1e-6);
  assert.ok(Math.abs(cabinetBox.min.z - (cabinetCenter.z - cabinet!.width! / 2)) < 1e-6 && Math.abs(cabinetBox.max.z - (cabinetCenter.z + cabinet!.width! / 2)) < 1e-6);
  assert.ok(Math.abs(cabinetBox.min.y - 0) < 1e-6 && Math.abs(cabinetBox.max.y - cabinet!.cabinetHeight!) < 1e-6, 'cabinet must run floor to ceiling: carcass 0–2.50 + fixed header 2.50–2.80');
  assert.equal(buildFixture('mb_vanity_continuous_closure_cabinet'), null);
});

test('R9 vanity boards anchor to the wall west finish without bridge geometry', () => {
  // 悬浮板与通顶柜同 footprint：摆位中心由墙锚参考实现重算，包络由中心 + 柜行内宽/深派生
  //（rotation 270：世界 x 向跨度为深，z 向跨度为宽）。y 带是 recipe 值，无配置源，保留。
  const cabinet = master.find((item) => item.type === 'mb_full_height_cabinet');
  assert.ok(cabinet, 'missing mb_full_height_cabinet');
  const cabinetCenter = fullHeightCabinetCenter();
  for (const [type, yBand] of [['mb_vanity_lower_board', [0.965, 1.035]], ['mb_vanity_main_board', [1.515, 1.585]]] as const) {
    const board = buildFixture(type);
    assert.ok(board, `missing fixture ${type}`);
    board!.position.set(cabinetCenter.x, 0, cabinetCenter.z);
    board!.rotation.y = THREE.MathUtils.degToRad(270);
    board!.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(board!);
    assert.ok(Math.abs(box.min.z - (cabinetCenter.z - cabinet.width! / 2)) < 1e-6 && Math.abs(box.max.z - (cabinetCenter.z + cabinet.width! / 2)) < 1e-6, `${type} z[${box.min.z},${box.max.z}]`);
    assert.ok(Math.abs(box.min.x - (cabinetCenter.x - cabinet.depth! / 2)) < 1e-6 && Math.abs(box.max.x - (cabinetCenter.x + cabinet.depth! / 2)) < 1e-6, `${type} AABB must match the cabinet footprint`);
    assert.ok(box.min.y >= yBand[0] - 1e-6 && box.max.y <= yBand[1] + 1e-6, `${type} y band ${box.min.y}..${box.max.y}`);
    const endFinish = board!.children.find((child) => child.userData.part === 'wardrobe-side-board-end');
    assert.equal(endFinish, undefined, `${type} must remain a plain floating board without a wardrobe-colored end panel`);
  }
});

test('R9 full-height cabinet header closes the cabinet-to-ceiling seam (issue #116)', () => {
  // 2026-11-13 issue #116：950 衣柜 + 顶封退役，悬浮板位改通顶定制柜——柜身到 2.50m、
  // 固定顶封到 2.80m；柜顶为干净固定板（全带泵后无冷凝水管过柜顶，不设托盘/检修口/带子）。
  const cabinetDecl = master.find((item) => item.type === 'mb_full_height_cabinet');
  assert.ok(cabinetDecl, 'missing mb_full_height_cabinet');
  const cabinetCenter = fullHeightCabinetCenter();
  const cabinet = buildFixture('mb_full_height_cabinet');
  assert.ok(cabinet, 'missing mb_full_height_cabinet fixture');
  cabinet!.position.set(cabinetCenter.x, 0, cabinetCenter.z);
  cabinet!.rotation.y = THREE.MathUtils.degToRad(270);
  cabinet!.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(cabinet!);
  // 包络由中心 + 行内宽/深/柜身高派生（rotation 270：世界 x 向跨度为深，z 向跨度为宽）
  assert.ok(Math.abs(box.min.x - (cabinetCenter.x - cabinetDecl.depth! / 2)) < 1e-6 && Math.abs(box.max.x - (cabinetCenter.x + cabinetDecl.depth! / 2)) < 1e-6, `cabinet x[${box.min.x},${box.max.x}]`);
  assert.ok(Math.abs(box.min.z - (cabinetCenter.z - cabinetDecl.width! / 2)) < 1e-6 && Math.abs(box.max.z - (cabinetCenter.z + cabinetDecl.width! / 2)) < 1e-6, `cabinet z[${box.min.z},${box.max.z}]`);
  assert.ok(Math.abs(box.min.y - 0) < 1e-6 && Math.abs(box.max.y - cabinetDecl.cabinetHeight!) < 1e-6, `cabinet y[${box.min.y},${box.max.y}]`);
  // 固定顶封：与柜身同 footprint，2.50–2.80m 不可开启（y 带是 recipe 值：柜身 2.50m
  // 为 #116 设计值，顶封到 2.80m 净高；x/z 由中心 + 行内尺寸派生）
  const parts: THREE.Object3D[] = [];
  cabinet!.traverse((object) => { if (object.userData.part) parts.push(object); });
  const header = parts.find((part) => part.userData.part === 'full-height-header');
  assert.ok(header, 'missing full-height-header');
  const headerBox = new THREE.Box3().setFromObject(header!);
  assert.ok(Math.abs(headerBox.min.x - (cabinetCenter.x - cabinetDecl.depth! / 2)) < 1e-6 && Math.abs(headerBox.max.x - (cabinetCenter.x + cabinetDecl.depth! / 2)) < 1e-6, `header x[${headerBox.min.x},${headerBox.max.x}]`);
  assert.ok(Math.abs(headerBox.min.z - (cabinetCenter.z - cabinetDecl.width! / 2)) < 1e-6 && Math.abs(headerBox.max.z - (cabinetCenter.z + cabinetDecl.width! / 2)) < 1e-6, `header z[${headerBox.min.z},${headerBox.max.z}]`);
  assert.ok(Math.abs(headerBox.min.y - 2.50) < 1e-6 && Math.abs(headerBox.max.y - cabinetDecl.cabinetHeight!) < 1e-6, `header y[${headerBox.min.y},${headerBox.max.y}]`);
  // 不侵 d_mb 开启门扇带 x[3.30,4.20] z[4.63,4.67]
  assert.ok(box.max.x <= cabinetCenter.x + cabinetDecl.depth! / 2 + 1e-9, 'cabinet must remain within the west finish envelope');
  // 不压回风格栅底面包络：return_master 西缘 = 终端中心 x − 长度/2（hvac.yaml 声明）。
  const hvac = load(readFileSync('config/hvac.yaml', 'utf8')) as { plans: Array<{ diagram: { terminals: Array<{ id: string; position: { x: number; y: number; z: number }; length?: number }> } }> };
  const ret = hvac.plans[0].diagram.terminals.find((terminal) => terminal.id === 'return_master');
  assert.ok(ret, 'missing return_master terminal');
  const returnWestX = ret.position.x - ret.length! / 2;
  assert.ok(box.max.x <= returnWestX - 1e-9, 'cabinet must stay west of the return grille bottom envelope');
});

test('dressing table and stool use the 2026-09-04 R1 window-adjacent candidate transforms', () => {
  // 梳妆桌墙锚：位置由墙锚参考实现重算（w_west_upper + along + clearance + 深/2）；
  // 凳锚桌：位置 = 桌位置 + 声明 offset，宿主须为 mb.dressing_table。
  const tableDecl = master.find((item) => item.type === 'master_dressing_table');
  assert.ok(tableDecl, 'missing master_dressing_table');
  const tableExpected = referenceWallFurnitureCenter(
    tableDecl.wall!, tableDecl.wall_side!, tableDecl.along!, tableDecl.wall_clearance!, FURNITURE_DIMS.master_dressing_table.depth,
  );
  const table = placed('master_dressing_table');
  assert.equal(table.type, 'master_dressing_table');
  assert.equal(table.id, 'mb.dressing_table');
  assert.ok(Math.abs(table.x! - tableExpected.x) < GAP_EPS && Math.abs(table.z! - tableExpected.z) < GAP_EPS,
    'dressing table must sit at the wall-anchor reference');
  assert.equal(table.rotation, tableDecl.rotation);
  const stoolDecl = master.find((item) => item.type === 'dressing_stool');
  assert.ok(stoolDecl, 'missing dressing_stool');
  assert.equal(anchorHostId(stoolDecl), 'mb.dressing_table', 'stool must anchor to mb.dressing_table');
  const stoolExpected = anchorExpected('master_dressing_table', stoolDecl);
  const stool = placed('dressing_stool');
  assert.equal(stool.type, 'dressing_stool');
  assert.equal(stool.id, 'mb.dressing_stool');
  assert.ok(Math.abs(stool.x! - stoolExpected.x) < GAP_EPS && Math.abs(stool.z! - stoolExpected.z) < GAP_EPS,
    'stool must sit at table + declared anchor offset');
  assert.equal(stool.rotation, stoolDecl.rotation);
  // 尺寸双源对账：桌板边 0.01m 在构造细节容差内，凳 recipe 与目录严格一致。
  assertMeshMatchesDims('master_dressing_table', FURNITURE_DIMS.master_dressing_table.width, FURNITURE_DIMS.master_dressing_table.depth, 0.07, 'master_dressing_table');
  assertMeshMatchesDims('dressing_stool', FURNITURE_DIMS.dressing_stool.width, FURNITURE_DIMS.dressing_stool.depth, 1e-6, 'dressing_stool');
  // rotation=90 后桌 footprint：桌背与西玻璃留 0.20m 通风/冷凝缝（西玻璃线 x=0，墙段起点 x）。
  const westWall = mbWall('w_west_upper');
  const tableBox = worldAabb(table);
  assert.ok(Math.abs((tableBox.minX - westWall.x1) - 0.20) < GAP_EPS, `table-to-west-glass gap must be 0.20m`);
  // 凳收纳态 AABB 完整含于桌 footprint
  const stoolBox = worldAabb(stool);
  assert.ok(stoolBox.minX >= tableBox.minX - GAP_EPS && stoolBox.maxX <= tableBox.maxX + GAP_EPS);
  assert.ok(stoolBox.minZ >= tableBox.minZ - GAP_EPS && stoolBox.maxZ <= tableBox.maxZ + GAP_EPS);
  assert.equal(master.some((item) => item.type === 'vanity_dresser'), false);
});

test('washbasin-only cabinet preserves envelope and plumbing center without a dressing chair', () => {
  // 2026-09-02 初版（迭代 mb-washbasin-curtain-20260901，假定玻璃通高，待量房终核）：
  // 柜体东移 5cm 收宽 1.05，盆/龙头居中至 x=0.575
  const cabinetDecl = master.find((item) => item.type === 'mb_washbasin_cabinet');
  assert.ok(cabinetDecl, 'missing mb_washbasin_cabinet');
  const cabinetExpected = referenceWallFurnitureCenter(
    cabinetDecl.wall!, cabinetDecl.wall_side!, cabinetDecl.along!, cabinetDecl.wall_clearance!, FURNITURE_DIMS.mb_washbasin_cabinet.depth,
  );
  const cabinet = placed('mb_washbasin_cabinet');
  assert.equal(cabinet.type, 'mb_washbasin_cabinet');
  assert.equal(cabinet.id, 'mb.washbasin_cabinet');
  assert.ok(Math.abs(cabinet.x! - cabinetExpected.x) < GAP_EPS && Math.abs(cabinet.z! - cabinetExpected.z) < GAP_EPS,
    'washbasin cabinet must sit at the wall-anchor reference');
  assert.equal(cabinet.rotation, cabinetDecl.rotation);
  assertMeshMatchesDims('mb_washbasin_cabinet', FURNITURE_DIMS.mb_washbasin_cabinet.width, FURNITURE_DIMS.mb_washbasin_cabinet.depth, 1e-6, 'mb_washbasin_cabinet');
  const faucet = plumbPoint('faucet_mbath_vanity');
  assert.ok(faucet);
  // 龙头居中于柜体；龙头 z 由墙线 + 半墙厚 + 自身 face_offset 重算。
  assert.equal(faucet.x, cabinet.x);
  const faucetExpected = referenceWallPoint(faucet.wall!, faucet.wall_side!, faucet.along!, faucet.face_offset!);
  assert.ok(Math.abs(faucet.z! - faucetExpected.z) < GAP_EPS, `faucet z ${faucet.z} must be the wall reference`);
});

test('R9 bed and bedside AABBs remain explicit', () => {
  // 关系断言（非字面量）：床东缘贴东墙线；rotation 270 换轴（世界 x 向跨度为 DIMS
  // depth，z 向跨度为 DIMS width）；床头柜东缘与床东缘对齐，两侧各留 0.08m 间隙。
  const bed = placed('bed_180');
  const bedBox = worldAabb(bed);
  const eastWall = mbWall('w_mb_east');
  assert.ok(Math.abs(bedBox.maxX - eastWall.x1) < GAP_EPS, 'bed east edge must sit on the east wall line');
  assert.ok(Math.abs((bedBox.maxX - bedBox.minX) - FURNITURE_DIMS.bed_180.depth) < GAP_EPS, 'bed world x extent must be DIMS depth (rotation 270 swaps axes)');
  assert.ok(Math.abs((bedBox.maxZ - bedBox.minZ) - FURNITURE_DIMS.bed_180.width) < GAP_EPS, 'bed world z extent must be DIMS width');
  assert.ok(Math.abs(bedBox.minZ - (bed.z! - FURNITURE_DIMS.bed_180.width / 2)) < GAP_EPS);
  assert.ok(Math.abs(bedBox.maxZ - (bed.z! + FURNITURE_DIMS.bed_180.width / 2)) < GAP_EPS);
  const cabinetDecl = master.find((item) => item.type === 'mb_full_height_cabinet');
  assert.ok(cabinetDecl, 'missing mb_full_height_cabinet');
  const cabinetCenter = fullHeightCabinetCenter();
  const cabinetFixture = buildFixture('mb_full_height_cabinet');
  assert.ok(cabinetFixture, 'missing mb_full_height_cabinet fixture');
  cabinetFixture!.position.set(cabinetCenter.x, 0, cabinetCenter.z);
  cabinetFixture!.rotation.y = THREE.MathUtils.degToRad(270);
  const cabinetBox = runtimeAabb(cabinetFixture!);
  assert.ok(Math.abs(cabinetBox.minX - (cabinetCenter.x - cabinetDecl.depth! / 2)) < RUNTIME_EPS && Math.abs(cabinetBox.maxX - (cabinetCenter.x + cabinetDecl.depth! / 2)) < RUNTIME_EPS);
  assert.ok(Math.abs(cabinetBox.minZ - (cabinetCenter.z - cabinetDecl.width! / 2)) < RUNTIME_EPS && Math.abs(cabinetBox.maxZ - (cabinetCenter.z + cabinetDecl.width! / 2)) < RUNTIME_EPS);
  const north = worldAabb(placed('master_bedside_cabinet_350_north'));
  const south = worldAabb(placed('master_bedside_cabinet_350_south'));
  for (const [name, box] of [['north', north], ['south', south]] as const) {
    assert.ok(Math.abs(box.maxX - bedBox.maxX) < GAP_EPS, `${name} cabinet east edge must align with the bed east edge`);
    assert.ok(Math.abs((box.maxX - box.minX) - FURNITURE_DIMS.master_bedside_cabinet_350_north.width) < GAP_EPS, `${name} cabinet world x extent must be DIMS width`);
    assert.ok(Math.abs((box.maxZ - box.minZ) - FURNITURE_DIMS.master_bedside_cabinet_350_north.depth) < GAP_EPS, `${name} cabinet world z extent must be DIMS depth`);
  }
  assert.ok(Math.abs((bedBox.minZ - north.maxZ) - 0.08) < GAP_EPS, 'north cabinet must stand 0.08m north of the bed');
  assert.ok(Math.abs((south.minZ - bedBox.maxZ) - 0.08) < GAP_EPS, 'south cabinet must stand 0.08m south of the bed');
});

test('floor socket sock_master_projector sits in the under-table service zone', () => {
  const socket = point('sock_master_projector');
  assert.equal(socket.type, 'floor_socket');
  // 插座是 absolute 点位（设计输入）：x/z 不钉字面量，位置由以下关系断言守住。
  // 高度 0.02m 是地面插座设计值（20mm 出地面），保留为具名设计值。
  assert.equal(socket.height, 0.02);
  const tableBox = worldAabb(placed('master_dressing_table'));
  const stoolBox = worldAabb(placed('dressing_stool'));
  // 落在四腿开放式桌 footprint 内（桌下北侧两腿之间的服务域）
  assert.ok(socket.x! >= tableBox.minX - GAP_EPS && socket.x! <= tableBox.maxX + GAP_EPS);
  assert.ok(socket.z! >= tableBox.minZ - GAP_EPS && socket.z! <= tableBox.maxZ + GAP_EPS);
  // 避开桌腿落点 ≥0.10m（腿长边内缩 0.06m、深边内缩 0.065m，rotation=90 换轴）
  const table = placed('master_dressing_table');
  const legDx = FURNITURE_DIMS.master_dressing_table.depth / 2 - 0.065;
  const legDz = FURNITURE_DIMS.master_dressing_table.width / 2 - 0.06;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const dist = Math.hypot(socket.x! - (table.x! + sx * legDx), socket.z! - (table.z! + sz * legDz));
      assert.ok(dist >= 0.10 - GAP_EPS, `socket-to-leg distance ${dist.toFixed(3)}m`);
    }
  }
  // 不在凳收纳包络内、不入西窗帘线/盒带 x[1.10,1.35]、不在床侧主通道（x∉[1.35,床西缘]
  // 且 z < 床北缘 + 0.05m 余量）
  assert.ok(!(socket.x! > stoolBox.minX && socket.x! < stoolBox.maxX && socket.z! > stoolBox.minZ && socket.z! < stoolBox.maxZ), 'socket inside stool stored envelope');
  assert.ok(socket.x! < 1.10);
  const bedBox = worldAabb(placed('bed_180'));
  assert.ok(!(socket.x! >= 1.35 && socket.x! <= bedBox.minX), 'socket inside bedside main aisle');
  assert.ok(socket.z! < bedBox.minZ + 0.05);
});

test('sock_master_bed_r is the southeast general-purpose backup socket', () => {
  const socket = point('sock_master_bed_r');
  // 坐标由墙锚参考实现重算（w_mb_east + along + face_offset）；高度 0.7m 是设计值，
  // 挂面与 note 语义标记（通用备用/解除）保留为决策记录。
  const decl = socket as unknown as { along: number; face_offset: number };
  const expected = referenceWallPoint(socket.wall!, socket.wall_side!, decl.along, decl.face_offset);
  assert.ok(Math.abs(socket.x! - expected.x) < GAP_EPS && Math.abs(socket.z! - expected.z) < GAP_EPS,
    `socket must sit at the wall reference (w_mb_east + along + face_offset)`);
  assert.equal(socket.height, 0.7);
  assert.equal(socket.wall, 'w_mb_east');
  assert.equal(socket.wall_side, 'west');
  assert.match(socket.note ?? '', /通用备用/);
  assert.match(socket.note ?? '', /解除/);
  // 可达：位于床南缘以南，不被床实体封死
  const bedBox = worldAabb(placed('bed_180'));
  assert.ok(socket.z! > bedBox.maxZ, `socket z=${socket.z} must stay south of bed south edge ${bedBox.maxZ}`);
});

test('方案A 床头电气按床头柜轴线布置并避开真实床体包络', () => {
  const left = point('sock_master_bed_l');
  const right = point('sock_master_bed_r_head');
  const switchL = point('switch_master_bed_l');
  const switchN = point('switch_master_bed_north');
  // DEC-2026-10-12-R1：业主删主卧两盏明装床头壁灯（原 light_master_wall_l / light_master_wall_r）
  // 改小米床头灯插电，取电位即 left / right 两个床头插座，故本组不再含壁灯点位。
  // 86 模数标准：面板 86×86mm，双联框两模块中心距 = 一个模数，联框总宽 = 两倍模数。
  const MODULE_PITCH = 0.086;
  for (const p of [left, right, switchL, switchN]) {
    assert.equal(p.wall, 'w_mb_east', `${p.id} must stay on w_mb_east`);
    assert.equal(p.wall_side, 'west', `${p.id} must keep wall_side west`);
    const decl = p as unknown as { along: number; face_offset: number };
    const expected = referenceWallPoint(p.wall!, p.wall_side!, decl.along, decl.face_offset);
    assert.ok(Math.abs(p.x! - expected.x) < GAP_EPS && Math.abs(p.z! - expected.z) < GAP_EPS,
      `${p.id} must sit at the wall reference (w_mb_east + along + face_offset)`);
  }
  // 两侧统一 380×350×500 候选柜分别服务北/南床头点位；两侧均为 172×86 暖白哑光一体双联框（北侧 DEC-2026-09-08-R1 补齐）。
  // 高度 0.75m 是床头插座/开关设计值，保留为具名设计值。
  assert.equal(left.height, 0.75);
  assert.equal(right.height, 0.75);
  assert.equal(switchL.height, 0.75);
  assert.equal(switchN.height, 0.75);
  // 外观：style/module/投影是设计决策（具名保留）；双联框中心距 == 面板宽、
  // 联框总宽 == 2×中心距是关系，不钉字面量。
  assert.equal(left.appearance?.style, 'warm_white_matte_modular');
  assert.equal(left.appearance?.module, 'five_hole_replaceable_usb_c');
  assert.equal(left.appearance?.faceplate_width, MODULE_PITCH);
  assert.equal(left.appearance?.faceplate_height, MODULE_PITCH);
  assert.equal(left.appearance?.projection, 0.008, 'panel projection is the 8mm design value');
  assert.equal(right.appearance?.module, 'five_hole_replaceable_usb_c');
  assert.equal(switchL.appearance?.module, 'two_way_rocker');
  assert.equal(switchN.appearance?.module, 'two_way_rocker');
  const assertDoubleFrame = (p: ElectricalPoint, groupId: string, role: string): void => {
    assert.equal(p.appearance?.panel_group?.id, groupId, `${p.id} must join the ${groupId} double frame`);
    assert.equal(p.appearance?.panel_group?.role, role);
    assert.equal(p.appearance?.panel_group?.center_spacing, p.appearance?.faceplate_width, 'double-frame module pitch must equal the faceplate width');
    assert.equal(p.appearance?.panel_group?.union_width, 2 * p.appearance?.panel_group!.center_spacing!, 'double-frame union width must be twice the module pitch');
  };
  assertDoubleFrame(left, 'master_bed_north_double', 'north');
  assertDoubleFrame(right, 'master_bed_south_double', 'north');
  assertDoubleFrame(switchL, 'master_bed_south_double', 'south');
  assertDoubleFrame(switchN, 'master_bed_north_double', 'south');

  const bed = runtimeFurnitureAabb('bed_180');
  const northCabinet = runtimeFurnitureAabb('master_bedside_cabinet_350_north');
  const southCabinet = runtimeFurnitureAabb('master_bedside_cabinet_350_south');
  const leftBox = runtimeElectricalAabb(left.id);
  const rightBox = runtimeElectricalAabb(right.id);
  const switchBox = runtimeElectricalAabb(switchL.id);
  const switchNBox = runtimeElectricalAabb(switchN.id);
  // DEC-2026-10-12-R1：主卧两盏明装床头壁灯已删，原 lampLBox/lampRBox 及其
  // 「壁灯不撞床 / 突出量 ≤190mm / 不得越过西侧完成面」断言一并移除；
  // 床头阅读与起夜改由小米床头灯（插电，取 left/right 电位）承担。

  // 点位与对应床头柜中心轴对齐；两侧双联框两模块中心距一个模数，边缘无缝相接。
  assert.ok(Math.abs((left.z! + switchN.z!) / 2 - (northCabinet.minZ + northCabinet.maxZ) / 2) < RUNTIME_EPS);
  assert.ok(Math.abs((right.z! + switchL.z!) / 2 - (southCabinet.minZ + southCabinet.maxZ) / 2) < RUNTIME_EPS);
  assert.ok(Math.abs(switchL.z! - right.z! - MODULE_PITCH) < RUNTIME_EPS);
  assert.ok(Math.abs(switchN.z! - left.z! - MODULE_PITCH) < RUNTIME_EPS);
  assert.ok(Math.abs(rightBox.maxZ - switchBox.minZ) < RUNTIME_EPS);
  assert.ok(Math.abs(switchBox.maxZ - rightBox.minZ - 2 * MODULE_PITCH) < RUNTIME_EPS);
  assert.ok(Math.abs(leftBox.maxZ - switchNBox.minZ) < RUNTIME_EPS);
  assert.ok(Math.abs(switchNBox.maxZ - leftBox.minZ - 2 * MODULE_PITCH) < RUNTIME_EPS);

  // 使用真实 runtime mesh，而非 FURNITURE_DIMS 推导：床 rail 包络 z[6.47,8.33]。
  assert.ok(bed.minZ - leftBox.maxZ >= 0.225 - RUNTIME_EPS, `north socket-to-bed gap ${bed.minZ - leftBox.maxZ}`);
  assert.ok(bed.minZ - switchNBox.maxZ >= 0.139 - RUNTIME_EPS, `north switch-to-bed gap ${bed.minZ - switchNBox.maxZ}`);
  assert.ok(rightBox.minZ - bed.maxZ >= 0.139 - RUNTIME_EPS, `south socket-to-bed gap ${rightBox.minZ - bed.maxZ}`);
  assert.ok(switchBox.minZ - bed.maxZ >= 0.225 - RUNTIME_EPS, `south switch-to-bed gap ${switchBox.minZ - bed.maxZ}`);
  // w_mb_east centerline 由墙段读出，西侧完成面 = 墙线 − 半墙厚。
  // 所有保留的床头电气点位必须留在主卧（-x）侧。
  const eastWallFinishX = mbWall('w_mb_east').x1 - WALL_THICKNESS / 2;
  assert.ok(leftBox.maxX <= eastWallFinishX + RUNTIME_EPS && rightBox.maxX <= eastWallFinishX + RUNTIME_EPS, 'bedside electrical must not cross the west finish face');
  for (const [id, box] of [[left.id, leftBox], [right.id, rightBox], [switchL.id, switchBox], [switchN.id, switchNBox]] as const) {
    assert.equal(aabbIntersects(box, bed), false, `${id} must not intersect the real bed mesh AABB`);
  }

  // 86面板/壁灯共轴布置在床头柜上方，采用立面净距：柜顶0.505m，86面板底约0.707m。
  assert.ok(leftBox.minY - northCabinet.maxY >= 0.202 - RUNTIME_EPS, `north cabinet-to-socket elevation gap ${leftBox.minY - northCabinet.maxY}`);
  assert.ok(switchNBox.minY - northCabinet.maxY >= 0.202 - RUNTIME_EPS, `north cabinet-to-switch elevation gap ${switchNBox.minY - northCabinet.maxY}`);
  assert.ok(rightBox.minY - southCabinet.maxY >= 0.202 - RUNTIME_EPS, `south cabinet-to-socket elevation gap ${rightBox.minY - southCabinet.maxY}`);
  assert.ok(switchBox.minY - southCabinet.maxY >= 0.202 - RUNTIME_EPS, `south cabinet-to-switch elevation gap ${switchBox.minY - southCabinet.maxY}`);
});

test('removed master-bedroom items stay removed; living room plant survives', () => {
  assert.equal(master.some((item) => item.type === 'master_wardrobe_tall_240'), false, 'master_wardrobe_tall_240 must not appear in master_bedroom furnishings');
  assert.equal(master.some((item) => item.type === 'plant_fiddle'), false, '主卧 plant_fiddle 已删除');
  const living = house.furnishings.living_dining;
  // 绿植锚电视柜：位置 = 电视柜位置 + 声明 offset，宿主须为 ld.tv_65。
  const plantDecl = living.find((item) => item.type === 'plant_fiddle');
  assert.ok(plantDecl, 'missing plant_fiddle');
  assert.equal(anchorHostId(plantDecl), 'ld.tv_65', 'plant must anchor to ld.tv_65');
  const plantExpected = anchorExpected('tv_65', plantDecl, living);
  const plant = placed('plant_fiddle', living);
  assert.equal(plant.type, 'plant_fiddle');
  assert.equal(plant.id, 'ld.plant_fiddle');
  assert.ok(Math.abs(plant.x! - plantExpected.x) < GAP_EPS && Math.abs(plant.z! - plantExpected.z) < GAP_EPS,
    'plant must sit at tv_65 + declared anchor offset');
  assert.equal(plant.rotation, plantDecl.rotation);
});

test('R8 north wardrobe 950 door configurations use real mesh pivots without door interpenetration', () => {
  const configurations: NorthWallWardrobe950DoorConfiguration[] = [
    'closed', 'left_open', 'middle_open', 'right_open', 'left_middle_open', 'left_right_open', 'middle_right_open', 'all_open',
  ];
  for (const configuration of configurations) {
    const fixture = buildFixture('master_north_wall_wardrobe_950');
    assert.ok(fixture);
    setNorthWallWardrobe950DoorConfiguration(fixture!, configuration);
    fixture!.updateMatrixWorld(true);
    const roots = fixture!.children.filter((child) => child.userData.materialRole === 'door_root');
    assert.equal(roots.length, 3);
    const boxes = roots.map((root) => new THREE.Box3().setFromObject(root));
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        assert.ok(!(boxes[a].min.x < boxes[b].max.x && boxes[a].max.x > boxes[b].min.x && boxes[a].min.z < boxes[b].max.z && boxes[a].max.z > boxes[b].min.z), `${configuration} door leaves ${a + 1}/${b + 1} intersect`);
      }
    }
    assert.ok(roots.every((root) => Math.abs(THREE.MathUtils.radToDeg(root.rotation.y)) <= 95));
  }
});

test('south-window-band low dresser uses the 2026-09-06 east-shifted transform and stays clear of constraints', () => {
  const dresserDecl = master.find((item) => item.type === 'master_hot_season_low_dresser');
  assert.ok(dresserDecl, 'missing master_hot_season_low_dresser');
  const dresser = placed('master_hot_season_low_dresser');
  // 低柜是 Tier 3 可移动件（房间相对摆位，设计输入）：位置不钉字面量，由窗带/不重叠/
  // 插座间距三条关系守住；此处只守摆位形式（声明 room/room_dx/room_dz、无墙锚/挂载）与朝向。
  // （2026-11-16 DDD 模型约束 rebase 跟进：#254 的本条断言写的是绝对摆位，
  //  rebase 后低柜已迁为房间相对——断言形式跟进，关系断言不动。）
  assert.equal(dresserDecl.room, 'master_bedroom', 'low dresser must stay room-relative (Tier 3 movable)');
  assert.ok(dresserDecl.room_dx !== undefined && dresserDecl.room_dz !== undefined, 'low dresser must carry room_dx/room_dz');
  assert.equal(dresserDecl.wall, undefined);
  assert.equal(dresserDecl.anchor, undefined);
  assert.equal(dresserDecl.mount, undefined);
  assert.equal(dresser.rotation, dresserDecl.rotation);
  // 尺寸双源对账：抽屉面 0.014m 在构造细节容差内。
  assertMeshMatchesDims('master_hot_season_low_dresser', FURNITURE_DIMS.master_hot_season_low_dresser.width, FURNITURE_DIMS.master_hot_season_low_dresser.depth, 0.07, 'master_hot_season_low_dresser');
  // rotation=180 为偶数 quarter-turn：正面（局部 +z）转朝北对房间
  const box = worldAabb(dresser);
  // z ⊆ 南侧窗带 [8.95,9.70]（柜高 0.85 < sill 2.07 由 recipe 保证）
  assert.ok(box.minZ >= 8.95 - GAP_EPS && box.maxZ <= 9.70 + GAP_EPS);
  // 与床 AABB 不重叠
  const bedBox = worldAabb(placed('bed_180'));
  assert.ok(box.maxZ <= bedBox.minZ + GAP_EPS || box.minZ >= bedBox.maxZ - GAP_EPS || box.maxX <= bedBox.minX + GAP_EPS || box.minX >= bedBox.maxX - GAP_EPS, 'dresser overlaps bed footprint');
  // 不侵东侧 sock_master_bed_r / sock_master_curtain 点位 0.5m 内（box-to-point 距离）
  for (const id of ['sock_master_bed_r', 'sock_master_curtain']) {
    const socket = point(id);
    const dx = Math.max(box.minX - socket.x!, socket.x! - box.maxX, 0);
    const dz = Math.max(box.minZ - socket.z!, socket.z! - box.maxZ, 0);
    const dist = Math.hypot(dx, dz);
    assert.ok(dist >= 0.5 - GAP_EPS, `dresser-to-${id} distance ${dist.toFixed(3)}m`);
  }
});

test('R8 HVAC beam envelope: ceiling/hvac/electrical stay data-driven', () => {
  type CeilingEntry = { id: string; room?: string; type: string; x?: number; z?: number; height?: number; thickness?: number; area?: [number, number, number, number]; power_point?: string };
  const ceiling = load(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as CeilingEntry[];
  const hvac = load(readFileSync('config/hvac.yaml', 'utf8')) as { plans: Array<{ diagram: { terminals: Array<{ id: string; system: string; position: { x: number; y: number; z: number }; mount_face: string; length?: number }> } }> };
  const beam = ceiling.find((entry) => entry.id === 'ceiling_master_beam');
  assert.ok(beam, 'missing ceiling_master_beam');
  assert.ok(!ceiling.some((entry) => entry.id === 'ceiling_master_ac'), 'ceiling_master_ac must be gone (2026-11-23 beam ruling)');
  assert.equal(beam!.type, 'drop');
  // 梁 area：全宽 x[0,4.20]（西端落西玻璃幕墙、东端为东墙线），深 0.50m；
  // 南北缘 [5.05, 5.55] 是 2026-11-23 业主裁定的寝区与北侧套间条带分界线（z=5.55），无派生源，按裁定值例外保留。
  const [minX, minZ, maxX, maxZ] = beam!.area!;
  const eastWall = mbWall('w_mb_east');
  assert.ok(Math.abs(maxX - eastWall.x1) < GAP_EPS, 'beam east edge must be the east wall line');
  const masterRoom = MB_LAYOUT.rooms.find((room) => room.id === 'master_bedroom');
  assert.ok(masterRoom, 'missing master_bedroom room');
  const westGlass = masterRoom!.x - masterRoom!.width / 2;
  assert.ok(Math.abs(minX - westGlass) < GAP_EPS, 'beam west edge must be the west glass curtain line');
  assert.equal(minZ, 5.05, 'beam north edge is the 2026-11-23 ruled zone');
  assert.equal(maxZ, 5.55, 'beam south edge is the sleeping-area / suite-strip boundary');
  assert.equal((beam as CeilingEntry & { corner_radius?: number }).corner_radius, undefined, 'wall-to-wall beam has no exposed plan corners');
  // 厚度不钉字面量：底面 = 房间净高 − 厚度，须落在 2.45–2.50m 的 HVAC 基准带内。
  const roomHeight = masterRoom!.height;
  const bottom = roomHeight - beam!.thickness!;
  assert.ok(bottom >= 2.45 - GAP_EPS && bottom <= 2.50 + GAP_EPS, `beam bottom ${bottom} outside 2.45–2.50m`);
  const indoor = ceiling.find((entry) => entry.id === 'ac_master');
  assert.ok(indoor && indoor.type === 'ac_indoor');
  assert.equal(indoor!.x, 3.45, 'indoor unit center x is the ruled axis (3.45, 5.30)');
  assert.equal(indoor!.z, 5.3, 'indoor unit center z is the ruled axis (3.45, 5.30)');
  assert.ok(indoor!.x! >= minX && indoor!.x! <= maxX && indoor!.z! >= minZ && indoor!.z! <= maxZ, 'indoor unit center must sit inside the beam');
  // 1200×450 只是未核实的经销商参数表 P-S5 行取值，待厂家安装图 #39 复核，不是实机事实。
  // 下面两行只预演这个 inferred 外廓是否还落在梁内，不把 1200×450 钉成已核实净空。
  assert.ok(indoor!.x! - 0.60 >= minX - GAP_EPS && indoor!.x! + 0.60 <= maxX + GAP_EPS, 'inferred 1200mm dealer-row rehearsal must stay inside the beam width');
  assert.ok(indoor!.z! - 0.225 >= minZ - GAP_EPS && indoor!.z! + 0.225 <= maxZ + GAP_EPS, 'inferred 450mm dealer-row rehearsal must stay inside the beam depth');
  assert.equal(indoor!.power_point, 'sock_master_ac');
  const acSocket = point('sock_master_ac');
  assert.ok(acSocket.x! >= minX && acSocket.x! <= maxX && acSocket.z! >= minZ && acSocket.z! <= maxZ, 'sock_master_ac must sit inside the beam');
  const terminals = hvac.plans[0].diagram.terminals;
  const supply = terminals.find((terminal) => terminal.id === 'supply_master');
  const ret = terminals.find((terminal) => terminal.id === 'return_master');
  assert.ok(supply && ret);
  const eastWallBedroomFinishX = mbWall('w_mb_east').x1 - WALL_THICKNESS / 2;
  const doorMb = MB_LAYOUT.walls.flatMap((wall) => wall.openings ?? []).find((opening) => opening.id === 'd_mb');
  assert.ok(doorMb, 'missing d_mb door opening');
  const doorOpeningTopY = doorMb!.height;
  // 2026-11-23：送回风中心轴统一到内机轴（ac_master x），东端分别留 0.39m/0.44m 至东墙卧室侧完成面。
  assert.ok(Math.abs(supply!.position.x - indoor!.x!) < GAP_EPS, `supply center x=${supply!.position.x} must share the indoor unit axis`);
  assert.ok(Math.abs(ret!.position.x - indoor!.x!) < GAP_EPS, `return center x=${ret!.position.x} must share the indoor unit axis`);
  const supplyEastX = supply!.position.x + supply!.length! / 2;
  const returnEastX = ret!.position.x + ret!.length! / 2;
  assert.ok(Math.abs(eastWallBedroomFinishX - supplyEastX - 0.39) < GAP_EPS, `supply wall clearance ${eastWallBedroomFinishX - supplyEastX}`);
  assert.ok(Math.abs(eastWallBedroomFinishX - returnEastX - 0.44) < GAP_EPS, `return wall clearance ${eastWallBedroomFinishX - returnEastX}`);
  // 两个端点都处于梁与门洞上方的服务高度，回风仍可从梁底检修。
  assert.ok(supply!.position.y > doorOpeningTopY + GAP_EPS, `supply must clear door top y=${supply!.position.y}`);
  assert.ok(ret!.position.y > doorOpeningTopY + GAP_EPS, `return must clear door top y=${ret!.position.y}`);
  assert.ok(supply!.position.z >= minZ - GAP_EPS && supply!.position.z <= maxZ + GAP_EPS, 'supply must remain over the beam service footprint');
  assert.ok(ret!.position.z >= minZ - GAP_EPS && ret!.position.z <= maxZ + GAP_EPS, 'return must remain over the beam service footprint');
  // 侧送：窄线形送风嵌梁南立面
  assert.equal(supply!.system, 'supply_air');
  assert.equal(supply!.mount_face, 'south');
  assert.equal(supply!.length, 0.6);
  assert.ok(Math.abs(supply!.position.z - maxZ) <= 0.02 + GAP_EPS, 'supply grille must sit on the beam south face');
  assert.ok(supply!.position.x - supply!.length! / 2 >= minX - GAP_EPS && supply!.position.x + supply!.length! / 2 <= maxX + GAP_EPS, 'supply span must stay inside the beam');
  assert.ok(supply!.position.y >= bottom && supply!.position.y <= roomHeight, 'supply grille y must be inside the beam face band');
  // 下回：底部回风兼检修（回检一体），平面包络完整落在梁内
  assert.equal(ret!.system, 'return_air');
  assert.equal(ret!.mount_face, 'bottom');
  assert.equal(ret!.length, 0.5);
  assert.ok(Math.abs(ret!.position.y - (bottom - 0.01)) <= 0.02 + GAP_EPS, 'return grille must sit on the beam bottom');
  assert.ok(ret!.position.x - ret!.length! / 2 >= minX - GAP_EPS && ret!.position.x + ret!.length! / 2 <= maxX + GAP_EPS, 'return span must stay inside the beam');
  assert.ok(ret!.position.z - 0.125 >= minZ - GAP_EPS && ret!.position.z + 0.125 <= maxZ + GAP_EPS, 'return footprint must stay inside the beam');
  // 通顶柜完成面与梁底（2.50m）齐平；HVAC 梁仍保持独立责任，不互相侵占。
  // 2026-11-23 业主裁定：门头盒改通长假梁——按未核实的 1200 候选算，56T2 盒装不下（机身东端 4.30 > 盒东界 4.20）；
  // 归档 900 候选的旧东端是 4.15，落在旧盒东界 4.20 以内，盒废弃的因果只在 1200 候选下成立。
  // 不再修盒，机身西移至 x=3.45（按 1200 候选东端 4.05）+ 梁全宽通长，待厂家安装图核机身外廓与安装间隙。
  const cabinetDecl = master.find((item) => item.type === 'mb_full_height_cabinet');
  assert.ok(cabinetDecl, 'missing mb_full_height_cabinet');
  const cabinetCenter = fullHeightCabinetCenter();
  const cabinetFixture = buildFixture('mb_full_height_cabinet');
  assert.ok(cabinetFixture, 'missing mb_full_height_cabinet fixture');
  cabinetFixture!.position.set(cabinetCenter.x, 0, cabinetCenter.z);
  cabinetFixture!.rotation.y = THREE.MathUtils.degToRad(270);
  const cabinetBox = runtimeAabb(cabinetFixture!);
  assert.ok(Math.abs(cabinetBox.minX - (cabinetCenter.x - cabinetDecl.depth! / 2)) < RUNTIME_EPS && Math.abs(cabinetBox.maxX - (cabinetCenter.x + cabinetDecl.depth! / 2)) < RUNTIME_EPS);
  assert.ok(Math.abs(cabinetBox.minZ - (cabinetCenter.z - cabinetDecl.width! / 2)) < RUNTIME_EPS && Math.abs(cabinetBox.maxZ - (cabinetCenter.z + cabinetDecl.width! / 2)) < RUNTIME_EPS);
  assert.ok(supply!.position.x - supply!.length! / 2 >= cabinetBox.maxX - GAP_EPS, 'supply must stay clear of the full-height cabinet');
  assert.ok(ret!.position.x - ret!.length! / 2 >= cabinetBox.maxX - GAP_EPS, 'return must stay clear of the full-height cabinet');
  assert.ok(supplyEastX <= eastWallBedroomFinishX - 0.39 + GAP_EPS, 'supply must stay clear of the bedroom east wall finish');
  assert.ok(returnEastX <= eastWallBedroomFinishX - 0.44 + GAP_EPS, 'return must stay clear of the bedroom east wall finish');
  assert.ok(bottom <= 2.50 + GAP_EPS, 'beam bottom must remain at the independent HVAC datum');
  // 梁全宽通长：通顶柜东缘（真实包络 2.525）在梁 x 范围内，但两者 z 向不重叠
  // （柜 z[2.92,4.30]，梁 z[5.05,5.55]），无贴合缝要收口。
  assert.ok(cabinetBox.maxZ <= minZ - GAP_EPS, `cabinet south edge ${cabinetBox.maxZ} must stay north of the beam ${minZ}`);
});
