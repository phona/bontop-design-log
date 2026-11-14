/**
 * 四项常驻基准测试（issue #192；来源 = issue #98 验收清单第 5 项「部分完成」的未尽部分）。
 *
 * issue #98 原文：「Resolver 需要**独立几何基准测试**，不能只用 3D 与 DXF 互相一致证明正确。」
 * 派生坐标（placement.ref / mount / wall+along）的最大风险是「改了 A 忘了 B」。3D 与 DXF 同源
 * （都消费 `shared/point-placement.ts` / `shared/furniture-placement.ts`），两者一致只能证明
 * **消费者接线一致**，不能证明**解算本身正确**——同一个错公式会被两边同时复制。因此本文件的
 * 期望值一律来自**声明几何的独立复算**，不 import 任何 3D / DXF 模块，也不从场景或图纸反推：
 *
 *  - 手算锚点：挑覆盖四个朝向、四档 face_offset（−0.06 / 缺省 / 0.04 / 0.09）、挂载 / 槽位 /
 *    挂墙 / 绝对四类定位的代表对象，把算式写进注释、期望值写成字面量；
 *  - 全量独立复算：从 `config/layout/model-geometry.yaml` 的 **raw vertices + wall from/to**、
 *    `config/electrical.yaml` / `config/plumbing.yaml` / `config/house.yaml` 的原始声明出发，
 *    用本文件自己写的向量运算重算 datum / 法线 / 完成面偏移 / 宿主 AABB / 挂位，再与解算器输出
 *    逐条对照（容差 1e-9）。参考实现不调用 `shared/point-placement.ts`、
 *    `shared/furniture-placement.ts`、`shared/wall-segments.ts` 的任何几何函数；只把
 *    `FURNITURE_DIMS`（尺寸目录）与 `vanity_layout`（柜体分割声明）当**数据**读。
 *
 * 四组（与 issue #192 正文逐条对应）：
 *  1) 独立几何基准 —— 声明几何 → 独立真值；不是 3D 对 DXF 互证。
 *  2) 移墙跟随 —— 墙平移 / 墙段起点平移后，挂它的点位与家具（含挂载子件）跟着走，别墙不动。
 *  3) 柜宽变化 —— 柜宽变后，挂它的点、槽位子件、派生分割量、MEP 算量跟着走。
 *  4) ID 对重排稳定 —— 同房间数组重排，稳定 id 与全部关联不变；关联确实按 id 而非数组下标。
 *
 * 「会红」验证记录（改坏 → 红 → 还原 → 绿）见 issue #192 的 PR 正文；本文件只承载常驻断言。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { load as parseYaml } from 'js-yaml';

import { resolveLayout } from '../../server/layout-resolver.js';
import {
  pointMountHostIndex,
  pointWallIndexFromElements,
  resolvePointPlacementInWalls,
  type PointMountHost,
  type PointWall,
} from '../../shared/point-placement.js';
import {
  furnitureHostIndex,
  resolveFurniturePlacement,
  resolveVanityLayout,
  WALL_THICKNESS,
  type PlacementItem,
  type WallLike,
} from '../../shared/furniture-placement.js';
import {
  collectDeclaredFurnitureIds,
  findDuplicateFurnitureIds,
  furnitureObjectId,
} from '../../shared/furniture-object-id.js';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
} from '../../shared/mep-hvac-coordination-schema.js';
import { computeMepTakeoff, type MepTakeoffRules, type TakeoffCircuit } from '../../shared/mep-takeoff.js';
import { FURNITURE_DIMS, type FurnishingItem, type VertexLayoutYaml, type WallSide } from '../../shared/types.js';

/* ───────────────────────── 声明源（纯 config，无 3D/DXF） ───────────────────────── */

const GEOMETRY_PATH = 'config/layout/model-geometry.yaml';
const ELECTRICAL_PATH = 'config/electrical.yaml';
const PLUMBING_PATH = 'config/plumbing.yaml';
const HOUSE_PATH = 'config/house.yaml';
const COORDINATION_PATH = 'config/mep-hvac-coordination.yaml';
const TOPOLOGY_PATH = 'config/electrical-topology.yaml';
const HVAC_PATH = 'config/hvac.yaml';
const CEILING_PATH = 'config/model/envelope/ceiling.yaml';
const MEP_RULES_PATH = 'config/mep-takeoff.yaml';

const readYaml = (path: string): unknown => parseYaml(readFileSync(path, 'utf8'));

const geometryDecl = readYaml(GEOMETRY_PATH) as {
  vertices: Array<{ id: string; x: number; z: number; radius?: number }>;
  walls: Array<{ id: string; from: string; to: string; line_datum?: 'centerline'; segments?: unknown[] }>;
};
const houseDecl = readYaml(HOUSE_PATH) as { furnishings?: Record<string, FurnishingItem[]> };
const electricalDecl = readYaml(ELECTRICAL_PATH) as RawPoint[];
const plumbingDecl = readYaml(PLUMBING_PATH) as RawPoint[];

/** config/electrical.yaml / plumbing.yaml 的定位相关原始声明（只列被测字段，其余透传）。 */
interface RawPoint {
  id?: string;
  wall?: string;
  wall_side?: WallSide;
  wallSide?: WallSide;
  along?: number;
  face_offset?: number;
  x?: number;
  z?: number;
  absolute?: boolean;
  mount?: { furniture_id: string; face: WallSide; surface_gap?: number; along?: number; face_offset?: number };
}

const allRawPoints: RawPoint[] = [...electricalDecl, ...plumbingDecl];
const allRawFurnishings: FurnishingItem[] = Object.values(houseDecl.furnishings ?? {}).flat();

/** 本文件独立复算要覆盖的墙：点位或家具声明引用到的墙。 */
const referencedWallIds = new Set<string>([
  ...allRawPoints.flatMap((point) => (point.wall !== undefined ? [point.wall] : [])),
  ...allRawFurnishings.flatMap((item) => (item.wall !== undefined ? [item.wall] : [])),
]);

/* ─────────────────── 独立参考实现（本文件自己的向量运算） ─────────────────── */

const SIDE_COMPASS: Record<WallSide, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

const dot = (a: { x: number; z: number }, b: { x: number; z: number }): number => a.x * b.x + a.z * b.z;

/**
 * 侧别法线：单元切向 t 的两个垂直候选中，取与声明侧别（罗盘方向）点积更大者。
 * 这是本文件自己的独立实现，不调用解算器。
 */
function wallNormal(tangent: { x: number; z: number }, side: WallSide): { x: number; z: number } {
  const candidates = [
    { x: -tangent.z, z: tangent.x },
    { x: tangent.z, z: -tangent.x },
  ];
  const authored = SIDE_COMPASS[side];
  return dot(candidates[0], authored) >= dot(candidates[1], authored) ? candidates[0] : candidates[1];
}

/**
 * 独立墙段：raw `walls[].from/to` + `vertices[]`（模型几何的原始声明，不经 resolveLayout）。
 * 只建本文件真的会引用的墙；圆弧端点（radius）墙会导致端点坐标不是顶点本身，直接拒绝，
 * 逼新增引用墙时先补圆弧参考实现——不静默用弦线顶替。
 */
function rawWallSegments(ids: ReadonlySet<string>): Map<string, { x1: number; z1: number; x2: number; z2: number }> {
  const vertices = new Map(geometryDecl.vertices.map((vertex) => [vertex.id, vertex]));
  const index = new Map<string, { x1: number; z1: number; x2: number; z2: number }>();
  for (const wall of geometryDecl.walls) {
    if (!ids.has(wall.id)) continue;
    if (wall.segments !== undefined) {
      throw new Error(`独立基准不支持声明了 segments 的墙 ${wall.id}（多段墙须单独建参考实现）`);
    }
    const from = vertices.get(wall.from);
    const to = vertices.get(wall.to);
    if (!from || !to) throw new Error(`墙 ${wall.id} 的 from/to 顶点不在 vertices 声明里`);
    if (from.radius !== undefined || to.radius !== undefined) {
      throw new Error(`墙 ${wall.id} 的端点带 radius（圆弧采样），独立参考实现只覆盖直墙`);
    }
    index.set(wall.id, { x1: from.x, z1: from.z, x2: to.x, z2: to.z });
  }
  return index;
}

const rawWalls = rawWallSegments(referencedWallIds);

/** 参考解：沿墙点位 = 起点 + along·切向（datum），再沿侧别法线偏 (半墙厚 + face_offset)。 */
function referenceWallPoint(point: RawPoint): {
  datum: { x: number; z: number };
  normal: { x: number; z: number };
  x: number;
  z: number;
  offset: number;
} {
  if (point.wall === undefined || point.along === undefined) throw new Error(`点位 ${point.id}: 参考解要求 wall + along`);
  const wall = rawWalls.get(point.wall);
  if (!wall) throw new Error(`点位 ${point.id}: 墙 ${point.wall} 不在 raw 墙索引`);
  const side = point.wall_side ?? point.wallSide;
  if (side === undefined) throw new Error(`点位 ${point.id}: 参考解要求 wall_side`);
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const length = Math.hypot(dx, dz);
  const tangent = { x: dx / length, z: dz / length };
  const datum = { x: wall.x1 + tangent.x * point.along, z: wall.z1 + tangent.z * point.along };
  const normal = wallNormal(tangent, side);
  const offset = WALL_THICKNESS / 2 + (point.face_offset ?? 0);
  return { datum, normal, x: datum.x + normal.x * offset, z: datum.z + normal.z * offset, offset };
}

/** length 型家具：外框宽 = 声明的 length（与 3D 建模同优先级，见 shared/furniture-placement.ts 头注）。 */
const LENGTH_BASED_TYPES = new Set(['kitchen_cabinet_run', 'kitchen_countertop_bridge', 'bath_side_cabinet']);

/** 参考尺寸：vanity_layout > 行内 width/depth > FURNITURE_DIMS 目录（只读声明数据）。 */
function referenceDims(item: FurnishingItem): { width: number; depth: number } {
  if (item.type === 'vanity' && item.vanity_layout !== undefined) {
    return { width: item.vanity_layout.width, depth: item.vanity_layout.depth };
  }
  const catalog = FURNITURE_DIMS[item.type];
  const width = item.width ?? catalog?.width;
  const depth = item.depth ?? catalog?.depth;
  if (width === undefined || depth === undefined) throw new Error(`家具 ${item.id ?? item.type}: 声明与目录都缺宽深`);
  return { width, depth };
}

function referenceFootprint(item: FurnishingItem): { width: number; depth: number } {
  if (LENGTH_BASED_TYPES.has(item.type) && item.length !== undefined) {
    const catalog = FURNITURE_DIMS[item.type];
    const depth = item.depth ?? catalog?.depth;
    if (depth === undefined) throw new Error(`家具 ${item.id ?? item.type}: length 型缺进深声明`);
    return { width: item.length, depth };
  }
  return referenceDims(item);
}

/** 参考解：挂墙家具中心 = 墙线点 + 法线 × (半墙厚 + wall_clearance + 半深)。 */
function referenceWallFurniture(item: FurnishingItem): { x: number; z: number } {
  if (item.wall === undefined || item.wall_side === undefined || item.along === undefined) {
    throw new Error(`家具 ${item.id}: 参考解要求 wall + wall_side + along`);
  }
  const wall = rawWalls.get(item.wall);
  if (!wall) throw new Error(`家具 ${item.id}: 墙 ${item.wall} 不在 raw 墙索引`);
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const length = Math.hypot(dx, dz);
  const tangent = { x: dx / length, z: dz / length };
  const normal = wallNormal(tangent, item.wall_side);
  const footprint = referenceFootprint(item);
  const offset = WALL_THICKNESS / 2 + (item.wall_clearance ?? 0) + footprint.depth / 2;
  return {
    x: wall.x1 + tangent.x * item.along + normal.x * offset,
    z: wall.z1 + tangent.z * item.along + normal.z * offset,
  };
}

/** 参考宿主 AABB（rotation 取 0/90/180/270 的轴对齐包络；与本仓家具旋转约定一致）。 */
function referenceHostBounds(host: FurnishingItem): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (host.x === undefined || host.z === undefined) throw new Error(`宿主 ${host.id}: 未放置（无 x/z）`);
  const dims = referenceDims(host);
  const radians = ((host.rotation ?? 0) * Math.PI) / 180;
  const widthX = Math.abs(Math.cos(radians)) * dims.width + Math.abs(Math.sin(radians)) * dims.depth;
  const depthZ = Math.abs(Math.sin(radians)) * dims.width + Math.abs(Math.cos(radians)) * dims.depth;
  return {
    minX: host.x - widthX / 2,
    maxX: host.x + widthX / 2,
    minZ: host.z - depthZ / 2,
    maxZ: host.z + depthZ / 2,
  };
}

/** 参考解：挂载点 = 宿主指定脸平面点 + along（东西脸自 minZ 向北、南北脸自 minX 向东）+ face_offset。 */
function referenceMountPoint(
  mount: NonNullable<RawPoint['mount']>,
  host: FurnishingItem,
): { x: number; z: number; datum: { x: number; z: number } } {
  if (mount.along === undefined) throw new Error(`挂载点 ${mount.furniture_id}: 参考解要求 along`);
  const bounds = referenceHostBounds(host);
  const horizontalFace = mount.face === 'east' || mount.face === 'west';
  const plane = mount.face === 'east' ? bounds.maxX
    : mount.face === 'west' ? bounds.minX
      : mount.face === 'south' ? bounds.maxZ
        : bounds.minZ;
  const axisMin = horizontalFace ? bounds.minZ : bounds.minX;
  const alongCoord = axisMin + mount.along;
  const datum = horizontalFace ? { x: plane, z: alongCoord } : { x: alongCoord, z: plane };
  const normal = SIDE_COMPASS[mount.face];
  const offset = mount.face_offset ?? 0;
  return { x: datum.x + normal.x * offset, z: datum.z + normal.z * offset, datum };
}

/** 参考解：vanity 的 robot_bay 槽位（宿主局部系 → 世界；θ 旋转与 3D 摆放同一约定）。 */
function referenceRobotBay(host: FurnishingItem, hostPlacement: { x: number; z: number }): { x: number; z: number } {
  if (host.vanity_layout === undefined) throw new Error(`槽位宿主 ${host.id}: 缺 vanity_layout`);
  const layout = host.vanity_layout;
  const dockDims = FURNITURE_DIMS['robot_dock_gbath'];
  const localX = -layout.width / 2 + layout.robot_bay_width / 2;
  const localZ = -layout.depth / 2 + (dockDims?.depth ?? NaN) / 2;
  const theta = ((host.rotation ?? 0) * Math.PI) / 180;
  return {
    x: hostPlacement.x + localX * Math.cos(theta) + localZ * Math.sin(theta),
    z: hostPlacement.z - localX * Math.sin(theta) + localZ * Math.cos(theta),
  };
}

/* ─────────────────────────────── 生产索引（被测） ─────────────────────────────── */

const resolvedLayout = resolveLayout(geometryDecl as unknown as VertexLayoutYaml);
const pointWalls: Map<string, PointWall> = pointWallIndexFromElements(resolvedLayout.walls);
const furnitureWallSegments = new Map<string, WallLike[]>(
  resolvedLayout.walls.map((wall) => [wall.id, wall.segments?.length ? wall.segments : [wall]]),
);

function hostIndex(items: FurnishingItem[]): Map<string, PlacementItem> {
  return furnitureHostIndex(items as unknown as PlacementItem[]);
}

function mountHostIndex(items: FurnishingItem[]): Map<string, PointMountHost> {
  return pointMountHostIndex(items as unknown as PlacementItem[]);
}

const baseMountHosts = mountHostIndex(allRawFurnishings);
const baseFurnitureHosts = hostIndex(allRawFurnishings);

/* ─────────────────────────────── 断言工具 ─────────────────────────────── */

const TOL = 1e-9;

function assertClose(actual: number, expected: number, label: string, tol = TOL): void {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: 实际 ${actual} 与期望 ${expected} 差 ${Math.abs(actual - expected)}（容差 ${tol}）`,
  );
}

function assertXZ(actual: { x: number; z: number }, expected: { x: number; z: number }, label: string): void {
  assertClose(actual.x, expected.x, `${label}.x`);
  assertClose(actual.z, expected.z, `${label}.z`);
}

function pointById(id: string): RawPoint {
  const point = allRawPoints.find((candidate) => candidate.id === id);
  assert.ok(point, `config 里必须有 ${id}`);
  return point;
}

function furnishingById(id: string): FurnishingItem {
  const item = allRawFurnishings.find((candidate) => candidate.id === id);
  assert.ok(item, `config/house.yaml 里必须有 ${id}`);
  return item;
}

function cloneFurnishings(): FurnishingItem[] {
  return JSON.parse(JSON.stringify(allRawFurnishings)) as FurnishingItem[];
}

function resolvePoint(point: RawPoint, hosts: ReadonlyMap<string, PointMountHost>, walls = pointWalls) {
  return resolvePointPlacementInWalls(point, walls, hosts);
}

/** 把 raw 挂载点按「宿主 id 前插入一份改过宽度的宿主副本」重算索引（不改 config）。 */
function mountHostsWithWidth(hostId: string, width: number): Map<string, PointMountHost> {
  const items = cloneFurnishings().map((item) => (item.id === hostId ? { ...item, width } : item));
  return mountHostIndex(items);
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * 1) 独立几何基准：声明几何 → 手算锚点 + 全量独立复算（不 import 3D/DXF）
 * ═══════════════════════════════════════════════════════════════════════════════ */

describe('独立几何基准（issue #192 第 1 项；issue #98「不能只用 3D 与 DXF 互证」）', () => {
  it('手算锚点：沿墙点位覆盖四朝向 / 两侧别 / 四档 face_offset（字面量真值）', () => {
    // 期望值全部由下列手算得出，算式写死在这里；任何一项与实际不符都说明解算口径漂了。
    // 口径常量：WALL_THICKNESS = 0.12 ⇒ 完成面 = 墙线 ± 0.06；点位再沿法线加 face_offset。
    const anchors: Array<{ id: string; x: number; z: number; datum: { x: number; z: number }; offset: number; why: string }> = [
      {
        id: 'sock_gbath_vanity',
        // 墙 w_gbath_east_open_vanity: (7.20,3.55)→(7.20,4.30)，切向 +z；west 侧法线 (−1,0)。
        // along 0.565 ⇒ datum (7.20, 3.55+0.565=4.115)；face_offset 缺省 0 ⇒ x = 7.20−0.06 = 7.14。
        x: 7.14, z: 4.115, datum: { x: 7.20, z: 4.115 }, offset: 0.06,
        why: 'west 脸 × 纯完成面（face_offset 缺省）',
      },
      {
        id: 'sock_fridge_living',
        // 墙 w_gbath_east: (7.20,2.40)→(7.20,3.55)，切向 +z；east 侧法线 (+1,0)。
        // along 0.9 ⇒ datum (7.20, 3.30)；offset = 0.06+0.04 = 0.10 ⇒ x = 7.30。
        x: 7.30, z: 3.30, datum: { x: 7.20, z: 3.30 }, offset: 0.10,
        why: 'east 脸 × 惯用 0.04',
      },
      {
        id: 'switch_living_entrance',
        // 墙 w_ent_south_w_east: (12.77,3.00)→(13.40,3.00)，切向 +x；south 侧法线 (0,+1)。
        // along 0.33 ⇒ datum (13.10, 3.00)；offset = 0.06−0.06 = 0 ⇒ 点落在墙中心线上。
        x: 13.10, z: 3.00, datum: { x: 13.10, z: 3.00 }, offset: 0,
        why: 'south 脸 × face_offset −0.06（历史「绝对 z」组，落在墙线上）',
      },
      {
        id: 'switch_child',
        // 墙 w_nw_south: (2.60,4.30)→(5.60,4.30)，切向 +x；north 侧法线 (0,−1)。
        // along 1.875 ⇒ datum (4.475, 4.30)；offset 0 ⇒ 同上落在墙线。
        x: 4.475, z: 4.30, datum: { x: 4.475, z: 4.30 }, offset: 0,
        why: 'north 脸 × face_offset −0.06',
      },
      {
        id: 'sock_mbath_vanity',
        // 墙 w_mbath_south: (0,2.86)→(2.60,2.86)，切向 +x；south 侧法线 (0,+1)。
        // along 0.78 ⇒ datum (0.78, 2.86)；offset 0.06+0.04 = 0.10 ⇒ z = 2.96。
        x: 0.78, z: 2.96, datum: { x: 0.78, z: 2.86 }, offset: 0.10,
        why: 'south 脸 × 惯用 0.04',
      },
      {
        id: 'sock_gbath_robot',
        // 墙 w_gbath_east_open_vanity，west 侧；along 0.55 ⇒ datum (7.20, 4.10)；
        // offset 0.06+0.09 = 0.15 ⇒ x = 7.20−0.15 = 7.05。
        x: 7.05, z: 4.10, datum: { x: 7.20, z: 4.10 }, offset: 0.15,
        why: 'west 脸 × sock_gbath_robot 0.09',
      },
      {
        id: 'sock_kitchen_hood',
        // 墙 w_ent_west: (10.80,3.00)→(10.80,0.00)，切向 −z（方向朝北）；west 侧法线 (−1,0)。
        // along 1.5 ⇒ datum (10.80, 3.00−1.50 = 1.50)；offset 0 ⇒ 墙线点。
        x: 10.80, z: 1.50, datum: { x: 10.80, z: 1.50 }, offset: 0,
        why: '反向（−z）墙段 × face_offset −0.06',
      },
    ];

    for (const anchor of anchors) {
      const point = pointById(anchor.id);
      const reference = referenceWallPoint(point);
      assertXZ(reference, { x: anchor.x, z: anchor.z }, `${anchor.id} 独立参考解（${anchor.why}）`);
      assertXZ(reference.datum, anchor.datum, `${anchor.id} 独立 datum`);
      assertClose(reference.offset, anchor.offset, `${anchor.id} 独立完成面偏移`);

      const { placement, diagnostic } = resolvePoint(point, baseMountHosts);
      assert.equal(diagnostic, undefined, `${anchor.id}: ${diagnostic ?? ''}`);
      assert.ok(placement && placement.kind === 'wall', `${anchor.id}: 必须解成沿墙点位`);
      assertXZ(placement, { x: anchor.x, z: anchor.z }, `${anchor.id} 解算结果`);
      assertXZ(placement.datum, anchor.datum, `${anchor.id} 解算 datum`);
      assertClose(placement.offsetFromCenterline, anchor.offset, `${anchor.id} 解算 offsetFromCenterline`);
    }
  });

  it('手算锚点：挂载点 = 宿主 AABB 脸平面 + along + face_offset', () => {
    // night_living_mid：宿主 entry_half_height_cabinet（2.00×0.35 @ (11.24,4.35), rot90）。
    // rot90 后世界包络：x 半宽 = 0.35/2 = 0.175 ⇒ x∈[11.065,11.415]；z 半宽 = 2.00/2 = 1.00 ⇒ z∈[3.35,5.35]。
    // east 脸 x = 11.415；along 1.45 自南端 minZ 3.35 向北 ⇒ z = 4.80；face_offset 0.005 ⇒ x = 11.420。
    const living = pointById('night_living_mid');
    const livingReference = referenceMountPoint(living.mount!, furnishingById(living.mount!.furniture_id));

    // night_corridor：宿主 wall_cabinet_tall（1.35×0.35 @ (7.375,6.225), rot270）。
    // rot270 后 x∈[7.20,7.55]、z∈[5.55,6.90]；north 脸 z = 5.55；along 0.25 自西端 minX 7.20 向东
    // ⇒ x = 7.45；face_offset 缺省 0。
    const corridor = pointById('night_corridor');
    const corridorReference = referenceMountPoint(corridor.mount!, furnishingById(corridor.mount!.furniture_id));

    const anchors = [
      { point: living, reference: livingReference, x: 11.42, z: 4.80, datum: { x: 11.415, z: 4.80 } },
      { point: corridor, reference: corridorReference, x: 7.45, z: 5.55, datum: { x: 7.45, z: 5.55 } },
    ] as const;

    for (const anchor of anchors) {
      assertXZ(anchor.reference, { x: anchor.x, z: anchor.z }, `${anchor.point.id} 独立参考解`);
      assertXZ(anchor.reference.datum, anchor.datum, `${anchor.point.id} 独立 datum`);
      const { placement, diagnostic } = resolvePoint(anchor.point, baseMountHosts);
      assert.equal(diagnostic, undefined, `${anchor.point.id}: ${diagnostic ?? ''}`);
      assert.ok(placement && placement.kind === 'mount', `${anchor.point.id}: 必须解成挂载点位`);
      assertXZ(placement, { x: anchor.x, z: anchor.z }, `${anchor.point.id} 解算结果`);
      assertXZ(placement.datum, anchor.datum, `${anchor.point.id} 解算 datum`);
    }
  });

  it('手算锚点：挂墙家具中心 = 完成面 + wall_clearance + 半深', () => {
    // gbath.vanity：墙线 x=7.20、west 侧 ⇒ 完成面 7.14；柜深 0.50、clearance 0 ⇒ 中心 x = 7.14−0.25 = 6.89；
    // along 0.405 自墙段北端 z=3.55 ⇒ z = 3.955。
    // mb.full_height_cabinet：墙线 x=2.60、west ⇒ 完成面 2.54；深 0.565、clearance 0.015
    // ⇒ 中心 x = 2.60−0.06−0.015−0.2825 = 2.2425；along 2.51 自 z=1.10 ⇒ z = 3.61。
    // （2026-11-13 issue #116：原底柜 mb.vanity_base_cabinet 退役，同数由通顶柜承接。）
    // gbath.mirror_cabinet：墙线 7.20、west ⇒ 中心 x = 7.20−0.06−0.14/2 = 7.07；z = 3.955。
    // gbath.heated_towel_rack：墙线 5.60、east ⇒ 中心 x = 5.60+0.06+0.10/2 = 5.71；z = 3.55+0.405 = 3.955。
    const anchors: Array<{ id: string; x: number; z: number }> = [
      { id: 'gbath.vanity', x: 6.89, z: 3.955 },
      { id: 'mb.full_height_cabinet', x: 2.2425, z: 3.61 },
      { id: 'gbath.mirror_cabinet', x: 7.07, z: 3.955 },
      { id: 'gbath.heated_towel_rack', x: 5.71, z: 3.955 },
    ];
    for (const anchor of anchors) {
      const item = furnishingById(anchor.id);
      assertXZ(referenceWallFurniture(item), { x: anchor.x, z: anchor.z }, `${anchor.id} 独立参考解`);
      const { placement, diagnostic } = resolveFurniturePlacement(
        item as unknown as PlacementItem,
        furnitureWallSegments,
        baseFurnitureHosts,
      );
      assert.equal(diagnostic, undefined, `${anchor.id}: ${diagnostic ?? ''}`);
      assert.ok(placement, `${anchor.id}: 必须有摆位`);
      assertXZ(placement, { x: anchor.x, z: anchor.z }, `${anchor.id} 解算结果`);
    }
  });

  it('手算锚点：槽位挂载家具（robot_bay）与绝对声明', () => {
    // gbath.robot_dock：宿主柜中心 (6.89,3.955)、rot270，vanity_layout 0.69×0.50，仓宽 0.50，基站深 0.433。
    // 局部：lx = −0.69/2 + 0.50/2 = −0.095；lz = −0.50/2 + 0.433/2 = −0.0335。
    // θ=270°：cos=0、sin=−1 ⇒ Δx = lz·sinθ = +0.0335；Δz = −lx·sinθ = −0.095。
    // 世界 = (6.89+0.0335, 3.955−0.095) = (6.9235, 3.860)。
    const host = furnishingById('gbath.vanity');
    const hostPlacement = referenceWallFurniture(host);
    assertXZ(hostPlacement, { x: 6.89, z: 3.955 }, 'gbath.vanity 宿主独立摆位');
    const dockReference = referenceRobotBay(host, hostPlacement);
    assertXZ(dockReference, { x: 6.9235, z: 3.86 }, 'robot_bay 独立参考解');
    const dock = resolveFurniturePlacement(
      furnishingById('gbath.robot_dock') as unknown as PlacementItem,
      furnitureWallSegments,
      baseFurnitureHosts,
    );
    assert.equal(dock.diagnostic, undefined, `robot_dock: ${dock.diagnostic ?? ''}`);
    assert.ok(dock.placement);
    assertXZ(dock.placement, { x: 6.9235, z: 3.86 }, 'robot_dock 解算结果');

    // 绝对声明：解算器不得用任何派生量覆盖声明的 x/z。
    for (const id of ['light_living_dome', 'sock_living_sofa_l', 'drain_gbath_shower']) {
      const point = pointById(id);
      assert.ok(point.x !== undefined && point.z !== undefined, `${id}: 应为绝对点位`);
      const { placement, diagnostic } = resolvePoint(point, baseMountHosts);
      assert.equal(diagnostic, undefined, `${id}: ${diagnostic ?? ''}`);
      assert.deepEqual(placement, { kind: 'absolute', x: point.x, z: point.z }, `${id}: 绝对点位必须原样返回`);
    }
  });

  it('全量独立复算：79 沿墙点位 + 2 挂载点位 + 4 挂墙家具 + 全部绝对家具逐条对照', () => {
    // 参考实现的墙几何来自 raw vertices + wall from/to；先证明它与生产 layout 的墙段一致，
    // 否则参考值与被测输入不是同一份声明，对照无意义。
    for (const wallId of referencedWallIds) {
      const raw = rawWalls.get(wallId);
      assert.ok(raw, `raw 墙索引缺 ${wallId}`);
      const resolved = resolvedLayout.walls.find((wall) => wall.id === wallId);
      assert.ok(resolved, `生产 layout 缺 ${wallId}`);
      const segments = resolved.segments?.length ? resolved.segments : [resolved];
      assert.equal(segments.length, 1, `${wallId}: 参考实现只覆盖单段直墙，而生产 layout 给了 ${segments.length} 段`);
      assertXZ({ x: segments[0].x1, z: segments[0].z1 }, { x: raw.x1, z: raw.z1 }, `${wallId} raw from 顶点`);
      assertXZ({ x: segments[0].x2, z: segments[0].z2 }, { x: raw.x2, z: raw.z2 }, `${wallId} raw to 顶点`);
    }

    let wallPoints = 0;
    for (const point of allRawPoints) {
      if (point.wall === undefined) continue;
      wallPoints += 1;
      const reference = referenceWallPoint(point);
      const { placement, diagnostic } = resolvePoint(point, baseMountHosts);
      assert.equal(diagnostic, undefined, `${point.id}: ${diagnostic ?? ''}`);
      assert.ok(placement && placement.kind === 'wall', `${point.id}: 必须解成沿墙点位`);
      assertXZ(placement, reference, `${point.id}`);
      assertXZ(placement.datum, reference.datum, `${point.id} datum`);
      assertXZ(placement.normal, reference.normal, `${point.id} normal`);
      assertClose(placement.offsetFromCenterline, reference.offset, `${point.id} offset`);
    }
    assert.equal(wallPoints, 79, '沿墙点位数量变化：新增/删除点位必须同步更新本基准的覆盖口径');

    let mountPoints = 0;
    for (const point of allRawPoints) {
      if (point.mount === undefined) continue;
      mountPoints += 1;
      const host = allRawFurnishings.find((item) => item.id === point.mount!.furniture_id);
      assert.ok(host, `${point.id}: 宿主 ${point.mount.furniture_id} 不在 house.yaml`);
      const reference = referenceMountPoint(point.mount, host);
      const { placement, diagnostic } = resolvePoint(point, baseMountHosts);
      assert.equal(diagnostic, undefined, `${point.id}: ${diagnostic ?? ''}`);
      assert.ok(placement && placement.kind === 'mount', `${point.id}: 必须解成挂载点位`);
      assertXZ(placement, reference, `${point.id}`);
      assertXZ(placement.datum, reference.datum, `${point.id} datum`);
    }
    assert.equal(mountPoints, 2, '挂载点位数量变化：新增/删除点位必须同步更新本基准的覆盖口径');

    let wallFurniture = 0;
    for (const item of allRawFurnishings) {
      if (item.wall === undefined) continue;
      wallFurniture += 1;
      const reference = referenceWallFurniture(item);
      const { placement, diagnostic } = resolveFurniturePlacement(
        item as unknown as PlacementItem,
        furnitureWallSegments,
        baseFurnitureHosts,
      );
      assert.equal(diagnostic, undefined, `${item.id}: ${diagnostic ?? ''}`);
      assert.ok(placement, `${item.id}: 必须有摆位`);
      assertXZ(placement, reference, `${item.id}`);
    }
    assert.equal(wallFurniture, 4, '挂墙家具数量变化：新增/删除对象必须同步更新本基准的覆盖口径');

    let absoluteFurniture = 0;
    for (const item of allRawFurnishings) {
      if (item.wall !== undefined || item.mount !== undefined || item.anchor !== undefined) continue;
      if (item.x === undefined || item.z === undefined) continue; // count-only：无平面几何
      absoluteFurniture += 1;
      const { placement, diagnostic } = resolveFurniturePlacement(
        item as unknown as PlacementItem,
        furnitureWallSegments,
        baseFurnitureHosts,
      );
      assert.equal(diagnostic, undefined, `${item.id}: ${diagnostic ?? ''}`);
      assert.ok(placement, `${item.id}: 必须有摆位`);
      assertXZ(placement, { x: item.x, z: item.z }, `${item.id}: 绝对声明必须原样解出`);
    }
    assert.ok(absoluteFurniture > 0, '绝对家具一件都没检查到：遍历口径有问题');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
 * 2) 移墙跟随：墙动 → 挂它的点位/家具跟着动，别墙不动
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** 用 raw 墙段造一份只改目标墙的 PointWall 索引（其余墙原样）。 */
function pointWallsWith(wallId: string, segment: { x1: number; z1: number; x2: number; z2: number }): Map<string, PointWall> {
  const result = new Map<string, PointWall>();
  for (const [id, wall] of pointWalls) {
    result.set(id, {
      segments: [id === wallId ? segment : wall.segments[0]],
      ...(wall.line_datum !== undefined ? { line_datum: wall.line_datum } : {}),
    });
  }
  return result;
}

/** 用 raw 墙段造一份只改目标墙的家具墙索引。 */
function furnitureWallsWith(wallId: string, segment: WallLike): Map<string, WallLike[]> {
  const result = new Map<string, WallLike[]>();
  for (const [id, segments] of furnitureWallSegments) {
    result.set(id, id === wallId ? [segment] : segments);
  }
  return result;
}

describe('移墙跟随（issue #192 第 2 项）', () => {
  it('墙段整体平移 0.10m：本墙点位跟走，别墙点位不动', () => {
    // w_gbath_east_open_vanity 原 (7.20,3.55)→(7.20,4.30)；整段东移 0.10 ⇒ (7.30,3.55)→(7.30,4.30)。
    const moved = { x1: 7.30, z1: 3.55, x2: 7.30, z2: 4.30 };
    const walls = pointWallsWith('w_gbath_east_open_vanity', moved);

    const before = resolvePoint(pointById('sock_gbath_vanity'), baseMountHosts);
    const after = resolvePoint(pointById('sock_gbath_vanity'), baseMountHosts, walls);
    assert.ok(before.placement && before.placement.kind === 'wall');
    assert.ok(after.placement && after.placement.kind === 'wall');
    assertXZ(after.placement, { x: before.placement.x + 0.10, z: before.placement.z }, '本墙点位随墙平移');
    assertXZ(after.placement.datum, { x: before.placement.datum.x + 0.10, z: before.placement.datum.z }, 'datum 随墙平移');

    // 对照：另一面墙上的点位在同一个 walls 索引里不动（证明不是「所有点位都跟着变」）。
    const controlBefore = resolvePoint(pointById('switch_child'), baseMountHosts);
    const controlAfter = resolvePoint(pointById('switch_child'), baseMountHosts, walls);
    assert.ok(controlBefore.placement && controlBefore.placement.kind === 'wall');
    assert.ok(controlAfter.placement && controlAfter.placement.kind === 'wall');
    assertXZ(controlAfter.placement, { x: controlBefore.placement.x, z: controlBefore.placement.z }, '别墙点位不动');
  });

  it('墙段起点沿墙轴平移 0.10m：along 从新起点量，点位沿墙向跟走、法向不变', () => {
    // 墙段保持方向与长度，仅把起点/终点同时沿 +z 平移 0.10。
    const moved = { x1: 7.20, z1: 3.65, x2: 7.20, z2: 4.40 };
    const walls = pointWallsWith('w_gbath_east_open_vanity', moved);
    const before = resolvePoint(pointById('sock_gbath_vanity'), baseMountHosts);
    const after = resolvePoint(pointById('sock_gbath_vanity'), baseMountHosts, walls);
    assert.ok(before.placement && before.placement.kind === 'wall');
    assert.ok(after.placement && after.placement.kind === 'wall');
    assertXZ(after.placement, { x: before.placement.x, z: before.placement.z + 0.10 }, 'along 起点随墙段起点');
  });

  it('挂墙家具与它的挂载子件随宿主墙平移；别墙家具不动', () => {
    const moved = { x1: 7.30, z1: 3.55, x2: 7.30, z2: 4.30 };
    const walls = furnitureWallsWith('w_gbath_east_open_vanity', moved);

    const vanityBefore = resolveFurniturePlacement(furnishingById('gbath.vanity') as unknown as PlacementItem, furnitureWallSegments, baseFurnitureHosts);
    const vanityAfter = resolveFurniturePlacement(furnishingById('gbath.vanity') as unknown as PlacementItem, walls, baseFurnitureHosts);
    assert.ok(vanityBefore.placement && vanityAfter.placement);
    assertXZ(vanityAfter.placement, { x: vanityBefore.placement.x + 0.10, z: vanityBefore.placement.z }, 'gbath.vanity 随墙');

    const mirrorBefore = resolveFurniturePlacement(furnishingById('gbath.mirror_cabinet') as unknown as PlacementItem, furnitureWallSegments, baseFurnitureHosts);
    const mirrorAfter = resolveFurniturePlacement(furnishingById('gbath.mirror_cabinet') as unknown as PlacementItem, walls, baseFurnitureHosts);
    assert.ok(mirrorBefore.placement && mirrorAfter.placement);
    assertXZ(mirrorAfter.placement, { x: mirrorBefore.placement.x + 0.10, z: mirrorBefore.placement.z }, 'gbath.mirror_cabinet 随墙');

    // 挂载子件：宿主柜跟着墙走 0.10，robot_bay 槽位必须整体跟走 0.10（不是回到声明原点）。
    const dockBefore = resolveFurniturePlacement(furnishingById('gbath.robot_dock') as unknown as PlacementItem, furnitureWallSegments, baseFurnitureHosts);
    const dockAfter = resolveFurniturePlacement(furnishingById('gbath.robot_dock') as unknown as PlacementItem, walls, baseFurnitureHosts);
    assert.ok(dockBefore.placement && dockAfter.placement);
    assertXZ(dockAfter.placement, { x: dockBefore.placement.x + 0.10, z: dockBefore.placement.z }, 'robot_dock 随宿主墙');

    // 对照：另一面墙（w_mbath_east）上的家具不动。
    const controlBefore = resolveFurniturePlacement(furnishingById('mb.full_height_cabinet') as unknown as PlacementItem, furnitureWallSegments, baseFurnitureHosts);
    const controlAfter = resolveFurniturePlacement(furnishingById('mb.full_height_cabinet') as unknown as PlacementItem, walls, baseFurnitureHosts);
    assert.ok(controlBefore.placement && controlAfter.placement);
    assertXZ(controlAfter.placement, { x: controlBefore.placement.x, z: controlBefore.placement.z }, '别墙家具不动');
  });

  it('墙段反向声明（起点终点互换）后 along 仍从新起点顶点量，世界位置随之镜像', () => {
    // 反向后 (7.20,4.30)→(7.20,3.55)：切向 −z；along 0.565 自 z=4.30 向北 ⇒ z = 3.735（原 4.115）。
    const reversed = { x1: 7.20, z1: 4.30, x2: 7.20, z2: 3.55 };
    const walls = pointWallsWith('w_gbath_east_open_vanity', reversed);
    const after = resolvePoint(pointById('sock_gbath_vanity'), baseMountHosts, walls);
    assert.ok(after.placement && after.placement.kind === 'wall');
    assertXZ(after.placement, { x: 7.14, z: 3.735 }, '反向墙的手算真值');
    assertXZ(after.placement.datum, { x: 7.20, z: 3.735 }, 'along 自新起点（z=4.30）量 0.565');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
 * 3) 柜宽变化：挂它的点、槽位子件、派生分割量、MEP 算量跟着走
 * ═══════════════════════════════════════════════════════════════════════════════ */

describe('柜宽变化（issue #192 第 3 项）', () => {
  it('半高柜宽度 2.00→1.60：东脸挂载点随宿主脸轴起点移动，脸平面不动', () => {
    // 宿主 entry_half_height_cabinet @ (11.24,4.35), rot90：世界 z 向长度 = 声明 width。
    // width 2.00 ⇒ z∈[3.35,5.35]；width 1.60（中心不变）⇒ z∈[3.55,5.15]。
    // east 脸由 depth 0.35 决定，x 恒为 11.415；along 1.45 自 minZ 3.55 向北 ⇒ z = 5.00（原 4.80）。
    const point = pointById('night_living_mid');
    const before = resolvePoint(point, baseMountHosts);
    const after = resolvePoint(point, mountHostsWithWidth('ld.entry_half_height_cabinet', 1.60));
    assert.ok(before.placement && before.placement.kind === 'mount');
    assert.ok(after.placement && after.placement.kind === 'mount');
    assertXZ(after.placement, { x: 11.42, z: 5.00 }, '变窄后的挂载点（手算）');
    assertClose(after.placement.x - before.placement.x, 0, '脸平面 x 不变');
    assertClose(after.placement.z - before.placement.z, 0.20, '沿脸轴 z 跟走 0.20');
    assert.ok(after.placement.along <= 1.60 + TOL, 'along 仍在新脸长度内');

    // 全量独立复算：改宽后的宿主索引值 = 参考 AABB 重算值。
    const host = { ...furnishingById('ld.entry_half_height_cabinet'), width: 1.60 };
    const reference = referenceMountPoint(point.mount!, host);
    assertXZ(after.placement, reference, '变窄后与独立参考解一致');
    assertXZ(reference, { x: 11.42, z: 5.00 }, '独立参考解手算值');
  });

  it('台盆柜宽度 0.69→0.61：robot_bay 槽位与派生抽屉宽跟着走', () => {
    // 柜中心由墙锚决定，与柜宽无关（沿墙 along 指柜中心），所以宿主中心不变 (6.89,3.955)。
    // width 0.69：lx = −0.345+0.25 = −0.095 ⇒ dock z = 3.955−0.095 = 3.860；抽屉宽 = 0.69−0.50 = 0.190。
    // width 0.61：lx = −0.305+0.25 = −0.055 ⇒ dock z = 3.955−0.055 = 3.900；抽屉宽 = 0.61−0.50 = 0.110。
    const items = cloneFurnishings();
    const vanity = items.find((item) => item.id === 'gbath.vanity');
    assert.ok(vanity && vanity.vanity_layout);
    const dock = items.find((item) => item.id === 'gbath.robot_dock');
    assert.ok(dock);

    const beforeDock = resolveFurniturePlacement(dock as unknown as PlacementItem, furnitureWallSegments, hostIndex(items));
    assert.ok(beforeDock.placement);
    assertXZ(beforeDock.placement, { x: 6.9235, z: 3.86 }, '改宽前 dock');

    vanity.vanity_layout.width = 0.61;
    const afterHosts = hostIndex(items);
    const afterVanity = resolveFurniturePlacement(vanity as unknown as PlacementItem, furnitureWallSegments, afterHosts);
    const afterDock = resolveFurniturePlacement(dock as unknown as PlacementItem, furnitureWallSegments, afterHosts);
    assert.equal(afterVanity.diagnostic, undefined, `vanity: ${afterVanity.diagnostic ?? ''}`);
    assert.equal(afterDock.diagnostic, undefined, `dock: ${afterDock.diagnostic ?? ''}`);
    assert.ok(afterVanity.placement && afterDock.placement);
    assertXZ(afterVanity.placement, { x: 6.89, z: 3.955 }, '宿主中心不随宽度变（along 指中心）');
    assertXZ(afterDock.placement, { x: 6.9235, z: 3.90 }, '变窄后 dock（手算）');
    assertXZ(afterDock.placement, referenceRobotBay(vanity, afterVanity.placement), '变窄后与独立参考解一致');

    // 派生分割量：抽屉宽 = width − robot_bay_width（剩余尺寸算出，不声明）。
    const beforeLayout = resolveVanityLayout(vanity.vanity_layout === undefined ? undefined : { ...vanity.vanity_layout, width: 0.69 });
    assert.ok(beforeLayout.ok);
    assertClose(beforeLayout.layout.drawer_width, 0.19, '改宽前抽屉宽');
    const afterLayout = resolveVanityLayout(vanity.vanity_layout);
    assert.ok(afterLayout.ok);
    assertClose(afterLayout.layout.drawer_width, 0.11, '改宽后抽屉宽');
    assertClose(afterLayout.layout.drawer_width, 0.61 - 0.50, '抽屉宽 = 柜宽 − 仓宽');
  });

  it('半高柜变宽后 MEP 算量（drawnM）按端点位移的几何增量跟着走', () => {
    // 算量链：柜宽 → 挂载点 night_living_mid → 路由 strong-light-entry-night-mid 的 to 端点
    // → routeLength → shared/mep-takeoff 的 conduit.drawnM。
    // 路由末段 = 最后 via (11.42,4.80,y=0.02) → to 端点（to_height 0.30）：改宽前 to=(11.42,4.80)
    // ⇒ 竖直 0.28m；柜宽 2.00→1.60 后 to=(11.42,5.00) ⇒ 末段 =
    // hypot(0, 0.30−0.02, 0.20) = 0.344093…。全屋只有该路由的端点位移，所以 drawnM 的增量
    // 必须恰好等于这段几何增量（增量由声明值 + 解出的端点手算，从 takeoff 结果反推不算）。
    const rules = readYaml(MEP_RULES_PATH) as MepTakeoffRules;
    const coordination = parseMepCoordination(readFileSync(COORDINATION_PATH, 'utf8'));
    const topology = readYaml(TOPOLOGY_PATH) as {
      circuits: TakeoffCircuit[];
      controls?: Array<{ switch_point_ids?: string[]; target_point_ids?: string[] }>;
    };
    const hvac = readYaml(HVAC_PATH) as { plans: unknown[] };
    const ceiling = readYaml(CEILING_PATH) as unknown[];

    const runTakeoff = (hosts: ReadonlyMap<string, PointMountHost>) => {
      const sources = endpointSourcesFromFacts({
        electrical: electricalDecl as never[],
        plumbing: plumbingDecl as never[],
        ceiling: ceiling as never[],
        hvac: hvac as never,
      }, pointWalls, hosts);
      const resolution = resolveMepRoutes(coordination, sources);
      const takeoff = computeMepTakeoff({
        electrical: electricalDecl as never[],
        plumbing: plumbingDecl as never[],
        circuits: topology.circuits,
        controls: topology.controls ?? [],
        routes: coordination.routes,
        resolution,
        rules,
      });
      return { takeoff, resolution };
    };

    const before = runTakeoff(baseMountHosts);
    const after = runTakeoff(mountHostsWithWidth('ld.entry_half_height_cabinet', 1.60));

    const routeId = 'strong-light-entry-night-mid';
    const routeDecl = coordination.routes.find((route) => route.id === routeId);
    assert.ok(routeDecl, `${routeId} 必须仍在声明的路由表里`);
    const routeBefore = before.resolution.routes.find((entry) => entry.route.id === routeId);
    const routeAfter = after.resolution.routes.find((entry) => entry.route.id === routeId);
    assert.ok(routeBefore?.to && routeAfter?.to, `${routeId} 必须解析出端点`);
    // 这条路由的末段声明是本基准的几何前提：末 via 落点 + to_height 变了，增量公式必须重推。
    // （二阶段 S1）末 via 读统一出口的 viaPoints，不读原始 route.via。
    const lastVia = routeBefore.viaPoints[routeBefore.viaPoints.length - 1]!;
    assertXZ(lastVia, { x: 11.42, z: 4.80 }, `${routeId} 末 via 平面点`);
    assertClose(lastVia.y ?? NaN, 0.02, `${routeId} 末 via 标高`);
    assertClose(routeDecl.to_height ?? NaN, 0.30, `${routeId} to_height`);

    assertXZ(routeBefore.to, { x: 11.42, z: 4.80 }, '改宽前路由端点');
    assertXZ(routeAfter.to, { x: 11.42, z: 5.00 }, '改宽后路由端点');

    const endY = routeDecl.to_height as number;
    const viaY = lastVia.y as number;
    const expectedDelta = Math.hypot(routeAfter.to.x - lastVia.x, endY - viaY, routeAfter.to.z - lastVia.z)
      - Math.hypot(routeBefore.to.x - lastVia.x, endY - viaY, routeBefore.to.z - lastVia.z);
    assertClose(after.takeoff.conduit.drawnM - before.takeoff.conduit.drawnM, expectedDelta, 'drawnM 增量 = 手算末段增量');
    assert.ok(expectedDelta > 0, '本案例的算量增量必须为正（否则测试证明不了「跟着走」）');

    // 反向对照：其余挂载点不动时算量不动（同一次比对里，night_corridor 的宿主未改）。
    const corridorPoint = pointById('night_corridor');
    const corridorAfter = resolvePoint(corridorPoint, mountHostsWithWidth('ld.entry_half_height_cabinet', 1.60));
    const corridorBefore = resolvePoint(corridorPoint, baseMountHosts);
    assert.ok(corridorAfter.placement && corridorBefore.placement);
    assertXZ(corridorAfter.placement, corridorBefore.placement, '未改宽的宿主挂载点不动');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
 * 4) ID 对重排稳定：同房间重排家具，id 不变则关联不漂
 * ═══════════════════════════════════════════════════════════════════════════════ */

describe('ID 对重排稳定（issue #192 第 4 项）', () => {
  const reorderedRooms = ['guest_bath', 'living_dining'] as const;

  it('同房间数组逆序后：宿主索引、逐件摆位、挂载点解算全部不变', () => {
    const byRoom = houseDecl.furnishings ?? {};
    const before = Object.values(byRoom).flat();
    const reorderedByRoom = new Map<string, FurnishingItem[]>();
    for (const [roomId, items] of Object.entries(byRoom)) {
      reorderedByRoom.set(roomId, reorderedRooms.includes(roomId as never) ? [...items].reverse() : [...items]);
    }
    const after = [...reorderedByRoom.values()].flat();

    let orderChanges = 0;
    for (const roomId of Object.keys(byRoom)) {
      const originalOrder = byRoom[roomId].map((item) => item.id);
      const reorderedOrder = reorderedByRoom.get(roomId)!.map((item) => item.id);
      if (reorderedRooms.includes(roomId as never) && JSON.stringify(originalOrder) !== JSON.stringify(reorderedOrder)) {
        orderChanges += 1;
      } else if (!reorderedRooms.includes(roomId as never)) {
        assert.deepEqual(reorderedOrder, originalOrder, `${roomId}: 未点名的房间不应被改动`);
      }
    }
    assert.ok(orderChanges > 0, '重排必须真的发生（否则本用例证明不了稳定性）');

    const beforeHosts = hostIndex(before);
    const afterHosts = hostIndex(after);
    assert.deepEqual([...afterHosts.keys()].sort(), [...beforeHosts.keys()].sort(), '宿主索引键（稳定 id）不变');

    const beforeMountHosts = mountHostIndex(before);
    const afterMountHosts = mountHostIndex(after);
    assert.deepEqual(
      [...afterMountHosts.entries()].sort(([a], [b]) => a.localeCompare(b)),
      [...beforeMountHosts.entries()].sort(([a], [b]) => a.localeCompare(b)),
      '挂载宿主索引（id → 宿主几何）不变',
    );

    for (const item of before) {
      if (item.id === undefined) continue;
      const beforeResolution = resolveFurniturePlacement(item as unknown as PlacementItem, furnitureWallSegments, beforeHosts);
      const afterResolution = resolveFurniturePlacement(item as unknown as PlacementItem, furnitureWallSegments, afterHosts);
      assert.deepEqual(afterResolution, beforeResolution, `${item.id}: 重排后摆位解漂移`);
    }

    for (const id of ['night_living_mid', 'night_corridor']) {
      const point = pointById(id);
      const beforeResolution = resolvePoint(point, beforeMountHosts);
      const afterResolution = resolvePoint(point, afterMountHosts);
      assert.deepEqual(afterResolution, beforeResolution, `${id}: 重排后挂载点解算漂移`);
    }

    const dockBefore = resolveFurniturePlacement(furnishingById('gbath.robot_dock') as unknown as PlacementItem, furnitureWallSegments, beforeHosts);
    const dockAfter = resolveFurniturePlacement(furnishingById('gbath.robot_dock') as unknown as PlacementItem, furnitureWallSegments, afterHosts);
    assert.deepEqual(dockAfter, dockBefore, 'gbath.robot_dock: 重排后槽位解漂移');
  });

  it('稳定 id 与关联通道在重排后不变；sourceIndex 只作溯源', () => {
    const before = collectDeclaredFurnitureIds(houseDecl.furnishings ?? {});
    const after = collectDeclaredFurnitureIds(houseDecl.furnishings === undefined ? {} : Object.fromEntries(
      Object.entries(houseDecl.furnishings).map(([roomId, items]) => [
        roomId,
        reorderedRooms.includes(roomId as never) ? [...items].reverse() : items,
      ]),
    ));

    const normalize = (entries: ReturnType<typeof collectDeclaredFurnitureIds>) =>
      entries
        .map(({ id, roomId, type, placement, mountHost }) => ({ id, roomId, type, placement, mountHost }))
        .sort((a, b) => `${a.roomId}/${a.id}`.localeCompare(`${b.roomId}/${b.id}`));
    assert.deepEqual(normalize(after), normalize(before), 'id / 房间 / 类型 / 摆位种类 / 宿主引用不随重排变化');

    // sourceIndex 是唯一允许变化的字段（数组下标只作溯源，不参与关联）。
    const indexOf = (entries: ReturnType<typeof collectDeclaredFurnitureIds>) =>
      new Map(entries.map((entry) => [entry.id, entry.sourceIndex]));
    const beforeIndex = indexOf(before);
    const afterIndex = indexOf(after);
    for (const entry of before) {
      assert.equal(beforeIndex.get(entry.id), entry.sourceIndex);
      if (reorderedRooms.includes(entry.roomId as never)) {
        const items = houseDecl.furnishings![entry.roomId];
        const newIndex = items.length - 1 - entry.sourceIndex;
        assert.equal(afterIndex.get(entry.id), newIndex, `${entry.id}: 逆序后 sourceIndex 应镜像（证明重排生效）`);
      } else {
        assert.equal(afterIndex.get(entry.id), entry.sourceIndex, `${entry.id}: 未重排房间 sourceIndex 不变`);
      }
    }

    // runtime object id：带声明 id 的条目，id 必须直接来自声明，与数组位置无关。
    for (const [roomId, items] of Object.entries(houseDecl.furnishings ?? {})) {
      items.forEach((item, index) => {
        if (item.id === undefined) return;
        assert.equal(furnitureObjectId(roomId, item, index), item.id, `${item.id}: runtime id 不得由数组下标派生`);
      });
    }

    assert.deepEqual(findDuplicateFurnitureIds(houseDecl.furnishings ?? {}), [], '重排前后都不该出现重复 id');
  });

  it('关联确实按 id 而非位置：改掉宿主 id 只让挂它的点诊断，其余不动', () => {
    const items = cloneFurnishings().map((item) => (
      item.id === 'ld.entry_half_height_cabinet'
        ? { ...item, id: 'ld.entry_half_height_cabinet_renamed' }
        : item
    ));
    const hosts = mountHostIndex(items);

    const broken = resolvePoint(pointById('night_living_mid'), hosts);
    assert.equal(broken.placement, null, '宿主 id 改掉后挂载点必须解不出来');
    assert.match(broken.diagnostic ?? '', /不在家具宿主索引或未放置/, '断引用必须显形为诊断');

    const corridor = resolvePoint(pointById('night_corridor'), hosts);
    assert.equal(corridor.diagnostic, undefined, `不相关的挂载点不得受影响：${corridor.diagnostic ?? ''}`);
    assert.ok(corridor.placement && corridor.placement.kind === 'mount');
    assertXZ(corridor.placement, { x: 7.45, z: 5.55 }, '不相关的挂载点坐标不变');

    const dock = resolveFurniturePlacement(
      furnishingById('gbath.robot_dock') as unknown as PlacementItem,
      furnitureWallSegments,
      hostIndex(items),
    );
    assert.equal(dock.diagnostic, undefined, `不相关的槽位子件不得受影响：${dock.diagnostic ?? ''}`);
    assert.ok(dock.placement);
    assertXZ(dock.placement, { x: 6.9235, z: 3.86 }, '不相关的槽位子件坐标不变');

    // 同一份断引用在重排后仍是同一条诊断（按 id 绑定，与数组位置无关）。
    const reorderedItems = [...items];
    const reorderedHosts = mountHostIndex(reorderedItems.reverse());
    const brokenAfterReorder = resolvePoint(pointById('night_living_mid'), reorderedHosts);
    assert.equal(brokenAfterReorder.placement, null);
    assert.match(brokenAfterReorder.diagnostic ?? '', /不在家具宿主索引或未放置/);
  });
});
