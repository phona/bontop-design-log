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
 *    挂墙 / 绝对四类定位的代表对象，把算式与手算值写进注释供人核对；断言只验
 *    解算 == 独立参考解（参考实现用本文件自己的向量运算从 raw 声明重算），不钉字面量；
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
import { FURNITURE_DIMS, type FurnishingItem, type FurnishingsYaml, type VertexLayoutYaml, type WallSide } from '../../shared/types.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';

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
 * 圆角切点（本文件自己的独立推导，不 import shared/arc.ts）：
 * 角点 C、两邻点 A（本墙 from 侧）与 B（邻墙 to 侧）、半径 r。
 * 切点距角点 d = r / tan(θ/2)，θ 为两邻边夹角（acos 归一化点积）。
 * 返回本墙侧切点（角点沿 A 方向退 d）；夹角退化或切点出边返回 null。
 * 共线（θ≈0 或 π）时无圆角：返回角点本身，即墙段不修剪（与生产 tangentArc
 * 返回 null → 不修剪一致）。
 */
function tangentPointOnWall(
  corner: { x: number; z: number },
  legA: { x: number; z: number },
  legB: { x: number; z: number },
  radius: number,
): { x: number; z: number } | null {
  if (!(radius > 0)) return null;
  const toA = { x: legA.x - corner.x, z: legA.z - corner.z };
  const toB = { x: legB.x - corner.x, z: legB.z - corner.z };
  const lenA = Math.hypot(toA.x, toA.z);
  const lenB = Math.hypot(toB.x, toB.z);
  if (lenA < 1e-9 || lenB < 1e-9) return null;
  const uA = { x: toA.x / lenA, z: toA.z / lenA };
  const uB = { x: toB.x / lenB, z: toB.z / lenB };
  const cos = Math.max(-1, Math.min(1, uA.x * uB.x + uA.z * uB.z));
  const theta = Math.acos(cos);
  if (theta < 0.001 || Math.abs(theta - Math.PI) < 0.001) return { x: corner.x, z: corner.z };
  const tangent = radius / Math.tan(theta / 2);
  if (tangent > lenA + 0.001 || tangent > lenB + 0.001) return null;
  return { x: corner.x + uA.x * tangent, z: corner.z + uA.z * tangent };
}

/**
 * 独立墙段：raw `walls[].from/to` + `vertices[]`（模型几何的原始声明，不经 resolveLayout）。
 * 只建本文件真的会引用的墙。
 *
 * 圆角端点（radius）的处理（2026-11-15 #98 Tier 1：mb.dressing_table 墙锚到 w_west_upper，
 * 其 to 端 v_sw 带 radius=1.00）：
 * - `to` 端圆角：弧归下一面墙，本墙只留直线段、末端修剪到切点（切点距角点 r/tan(θ/2)，
 *   θ 为本墙与下一面墙在角点的夹角，见 tangentPointOnWall）。修剪后的端点与生产 layout 的
 *   segments[0] 逐值对照（全量复算开头的墙段一致性断言），不是弦线顶替——along 在直线段内时
 *   datum 与弦线同值，但墙长/合法域不同，错了会在此被抓住。
 * - `from` 端圆角：生产会把该墙解成弧采样多段（圆角归本墙），单段直墙参考实现无法表示，
 *   直接拒绝（全量复算的 segments.length === 1 断言是第二道守卫）；新增此类引用墙时须先补
 *   多段参考实现。
 * 解不出的圆角（无邻墙/切点出边）一律抛错，不回落弦线；生产侧在这些情形保留整墙不修剪，
 * 分歧须人工裁定，不得静默取任一侧。
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
    if (from.radius !== undefined) {
      throw new Error(
        `墙 ${wall.id} 的 from 端点带 radius：生产 layout 会把该墙解成弧采样多段（圆角归本墙），`
        + '单段直墙参考实现无法表示——新增此类引用墙时须先补多段参考实现',
      );
    }
    let x2 = to.x;
    let z2 = to.z;
    if (to.radius !== undefined) {
      const nextWall = geometryDecl.walls.find((candidate) => candidate.from === wall.to);
      if (!nextWall) {
        throw new Error(
          `墙 ${wall.id} 的 to 端点带 radius=${to.radius} 但找不到以该顶点为 from 的下一面墙：`
          + '转角夹角无法确定，参考实现拒绝用弦线顶替（生产侧此时保留整墙不修剪——分歧须人工裁定）',
        );
      }
      const nextTo = vertices.get(nextWall.to);
      if (!nextTo) throw new Error(`墙 ${nextWall.id} 的 to 顶点不在 vertices 声明里`);
      const trimmed = tangentPointOnWall(to, from, nextTo, to.radius);
      if (!trimmed) {
        throw new Error(
          `墙 ${wall.id} 的 to 端圆角解不出切点（夹角退化或切点超出邻边）：`
          + '参考实现拒绝回落弦线（生产侧此时保留整墙不修剪——分歧须人工裁定）',
        );
      }
      x2 = trimmed.x;
      z2 = trimmed.z;
    }
    index.set(wall.id, { x1: from.x, z1: from.z, x2, z2 });
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

// （#98 Tier 2）宿主索引改走共享解算：墙锚/anchor 家具无声明 x/z，直读原始 YAML
// 的 pointMountHostIndex 会把它排除出表，night_corridor 等挂载点随即断引用。
// 只改取数来源；mountHostsWithWidth 保持「先改宽再解算」顺序（宽 override 后再解算）。
function mountHostIndex(items: FurnishingItem[]): Map<string, PointMountHost> {
  return buildPlacementIndexes({
    geometry: { walls: resolvedLayout.walls },
    furnishings: { __test__: items } as unknown as FurnishingsYaml,
  }).mountHosts;
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

/** 参考解用的宿主条目（#98 Tier 2）：声明字段取 raw，位置取 baseMountHosts 的解算值——
 * anchor/墙锚家具无声明 x/z，参考解直接读 raw 会得 undefined。手算期望值不动。 */
function resolvedHostItem(id: string): FurnishingItem {
  const item = furnishingById(id);
  const host = baseMountHosts.get(id);
  assert.ok(host !== undefined && host.x !== undefined && host.z !== undefined, `宿主 ${id} 解不出位置`);
  return { ...item, x: host.x, z: host.z };
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
  it('手算锚点：沿墙点位覆盖四朝向 / 两侧别 / 四档 face_offset（手算值见注释，断言验解算 == 参考解）', () => {
    // 手算期望值见各条目注释（算式与数值都在注释里，供人核对）；断言只验
    // 解算 == 独立参考解（参考实现用本文件自己的向量运算从 raw 声明重算，
    // 不调用生产解算器）。口径常量：WALL_THICKNESS = 0.12 ⇒ 完成面 = 墙线 ± 0.06；
    // 点位再沿法线加 face_offset。
    const anchors: Array<{ id: string; why: string }> = [
      {
        id: 'sock_gbath_vanity',
        // 墙 w_gbath_east_open_vanity: (7.20,3.55)→(7.20,4.30)，切向 +z；west 侧法线 (−1,0)。
        // along 0.565 ⇒ datum (7.20, 3.55+0.565=4.115)；face_offset 缺省 0 ⇒ x = 7.20−0.06 = 7.14。
        why: 'west 脸 × 纯完成面（face_offset 缺省）',
      },
      {
        id: 'sock_fridge_living',
        // 墙 w_gbath_east: (7.20,2.40)→(7.20,3.55)，切向 +z；east 侧法线 (+1,0)。
        // along 0.9 ⇒ datum (7.20, 3.30)；offset = 0.06+0.04 = 0.10 ⇒ x = 7.30。
        why: 'east 脸 × 惯用 0.04',
      },
      {
        id: 'switch_living_entrance',
        // 墙 w_ent_south_w_east: (12.77,3.00)→(13.40,3.00)，切向 +x；south 侧法线 (0,+1)。
        // along 0.33 ⇒ datum (13.10, 3.00)；offset = 0.06−0.06 = 0 ⇒ 点落在墙中心线上。
        why: 'south 脸 × face_offset −0.06（历史「绝对 z」组，落在墙线上）',
      },
      {
        id: 'switch_child',
        // 墙 w_nw_south: (2.60,4.30)→(5.60,4.30)，切向 +x；north 侧法线 (0,−1)。
        // along 1.875 ⇒ datum (4.475, 4.30)；offset 0 ⇒ 同上落在墙线。
        why: 'north 脸 × face_offset −0.06',
      },
      {
        id: 'sock_mbath_vanity',
        // 墙 w_mbath_south: (0,2.86)→(2.60,2.86)，切向 +x；south 侧法线 (0,+1)。
        // along 0.78 ⇒ datum (0.78, 2.86)；offset 0.06+0.04 = 0.10 ⇒ z = 2.96。
        why: 'south 脸 × 惯用 0.04',
      },
      {
        id: 'sock_gbath_robot',
        // 墙 w_gbath_east_open_vanity，west 侧；along 0.55 ⇒ datum (7.20, 4.10)；
        // offset 0.06+0.09 = 0.15 ⇒ x = 7.20−0.15 = 7.05。
        why: 'west 脸 × sock_gbath_robot 0.09',
      },
      {
        id: 'sock_kitchen_hood',
        // 墙 w_ent_west: (10.80,3.00)→(10.80,0.00)，切向 −z（方向朝北）；west 侧法线 (−1,0)。
        // along 1.5 ⇒ datum (10.80, 3.00−1.50 = 1.50)；offset 0 ⇒ 墙线点。
        why: '反向（−z）墙段 × face_offset −0.06',
      },
    ];

    for (const anchor of anchors) {
      const point = pointById(anchor.id);
      const reference = referenceWallPoint(point);
      const { placement, diagnostic } = resolvePoint(point, baseMountHosts);
      assert.equal(diagnostic, undefined, `${anchor.id}: ${diagnostic ?? ''}`);
      assert.ok(placement && placement.kind === 'wall', `${anchor.id}: 必须解成沿墙点位`);
      assertXZ(placement, reference, `${anchor.id} 解算结果须等于独立参考解（${anchor.why}）`);
      assertXZ(placement.datum, reference.datum, `${anchor.id} 解算 datum`);
      assertClose(placement.offsetFromCenterline, reference.offset, `${anchor.id} 解算 offsetFromCenterline`);
    }
  });

  it('手算锚点：挂载点 = 宿主 AABB 脸平面 + along + face_offset', () => {
    // 手算期望值见下列注释（算式与数值都在注释里，供人核对）；断言只验
    // 解算 == 独立参考解。
    // night_living_mid：宿主 entry_half_height_cabinet（2.00×0.35 @ (11.24,4.35), rot90）。
    // rot90 后世界包络：x 半宽 = 0.35/2 = 0.175 ⇒ x∈[11.065,11.415]；z 半宽 = 2.00/2 = 1.00 ⇒ z∈[3.35,5.35]。
    // east 脸 x = 11.415；along 1.45 自南端 minZ 3.35 向北 ⇒ z = 4.80；face_offset 0.005 ⇒ x = 11.420。
    const living = pointById('night_living_mid');
    const livingReference = referenceMountPoint(living.mount!, furnishingById(living.mount!.furniture_id));

    // night_corridor：宿主 wall_cabinet_tall（1.35×0.35 @ (7.375,6.225), rot270）。
    // rot270 后 x∈[7.20,7.55]、z∈[5.55,6.90]；north 脸 z = 5.55；along 0.25 自西端 minX 7.20 向东
    // ⇒ x = 7.45；face_offset 缺省 0。
    const corridor = pointById('night_corridor');
    const corridorReference = referenceMountPoint(corridor.mount!, resolvedHostItem(corridor.mount!.furniture_id));

    const anchors = [
      { point: living, reference: livingReference },
      { point: corridor, reference: corridorReference },
    ] as const;

    for (const anchor of anchors) {
      const { placement, diagnostic } = resolvePoint(anchor.point, baseMountHosts);
      assert.equal(diagnostic, undefined, `${anchor.point.id}: ${diagnostic ?? ''}`);
      assert.ok(placement && placement.kind === 'mount', `${anchor.point.id}: 必须解成挂载点位`);
      assertXZ(placement, anchor.reference, `${anchor.point.id} 解算结果须等于独立参考解`);
      assertXZ(placement.datum, anchor.reference.datum, `${anchor.point.id} 解算 datum`);
    }
  });

  it('手算锚点：挂墙家具中心 = 完成面 + wall_clearance + 半深', () => {
    // 手算期望值见下列注释（算式与数值都在注释里，供人核对）；断言只验
    // 解算 == 独立参考解。
    // gbath.vanity：墙线 x=7.20、west 侧 ⇒ 完成面 7.14；柜深 0.50、clearance 0 ⇒ 中心 x = 7.14−0.25 = 6.89；
    // along 0.405 自墙段北端 z=3.55 ⇒ z = 3.955。
    // mb.full_height_cabinet：墙线 x=2.60、west ⇒ 完成面 2.54；深 0.565、clearance 0.015
    // ⇒ 中心 x = 2.60−0.06−0.015−0.2825 = 2.2425；along 2.51 自 z=1.10 ⇒ z = 3.61。
    // （2026-11-13 issue #116：原底柜 mb.vanity_base_cabinet 退役，同数由通顶柜承接。）
    // gbath.mirror_cabinet：墙线 7.20、west ⇒ 中心 x = 7.20−0.06−0.14/2 = 7.07；z = 3.955。
    // gbath.heated_towel_rack：墙线 5.60、east ⇒ 中心 x = 5.60+0.06+0.10/2 = 5.71；z = 3.55+0.405 = 3.955。
    // mb.dressing_table：墙 w_west_upper (0,5.55)→(0,9.80)，to 端 v_sw 带 radius=1.00，
    // 转角 90°（下一面墙 w_mb_south 向东），切点距角点 1.00/tan45° = 1.00 ⇒ 修剪后墙段
    // (0,5.55)→(0,8.80)，切向 +z；east 侧法线 (+1,0)；along 0.50 ⇒ datum (0,6.05)；
    // 柜深 0.45、clearance 0.14 ⇒ 中心 x = 0.06+0.14+0.225 = 0.425。
    const anchorIds = [
      'gbath.vanity',
      'mb.full_height_cabinet',
      'gbath.mirror_cabinet',
      'gbath.heated_towel_rack',
      'mb.dressing_table',
    ];
    for (const id of anchorIds) {
      const item = furnishingById(id);
      const reference = referenceWallFurniture(item);
      const { placement, diagnostic } = resolveFurniturePlacement(
        item as unknown as PlacementItem,
        furnitureWallSegments,
        baseFurnitureHosts,
      );
      assert.equal(diagnostic, undefined, `${id}: ${diagnostic ?? ''}`);
      assert.ok(placement, `${id}: 必须有摆位`);
      assertXZ(placement, reference, `${id} 解算结果须等于独立参考解`);
    }
  });

  it('手算锚点：槽位挂载家具（robot_bay）与绝对声明', () => {
    // 手算期望值见下列注释（算式与数值都在注释里，供人核对）；断言只验
    // 解算 == 独立参考解。
    // gbath.robot_dock：宿主柜中心 (6.89,3.955)、rot270，vanity_layout 0.69×0.50，仓宽 0.50，基站深 0.433。
    // 局部：lx = −0.69/2 + 0.50/2 = −0.095；lz = −0.50/2 + 0.433/2 = −0.0335。
    // θ=270°：cos=0、sin=−1 ⇒ Δx = lz·sinθ = +0.0335；Δz = −lx·sinθ = −0.095。
    // 世界 = (6.89+0.0335, 3.955−0.095) = (6.9235, 3.860)。
    const host = furnishingById('gbath.vanity');
    const hostPlacement = referenceWallFurniture(host);
    const dockReference = referenceRobotBay(host, hostPlacement);
    const dock = resolveFurniturePlacement(
      furnishingById('gbath.robot_dock') as unknown as PlacementItem,
      furnitureWallSegments,
      baseFurnitureHosts,
    );
    assert.equal(dock.diagnostic, undefined, `robot_dock: ${dock.diagnostic ?? ''}`);
    assert.ok(dock.placement);
    assertXZ(dock.placement, dockReference, 'robot_dock 解算结果须等于独立参考解');

    // 绝对声明：解算器不得用任何派生量覆盖声明的 x/z。
    // sock_living_sofa_l 已不在此列：二阶段 Stage 2 起它改为 anchor 相对定位（见
    // tests/server/stage2-sofa-move.test.ts），不再是绝对点位；此处以 sock_living_table 补位。
    for (const id of ['light_living_dome', 'sock_living_table', 'drain_gbath_shower']) {
      const point = pointById(id);
      assert.ok(point.x !== undefined && point.z !== undefined, `${id}: 应为绝对点位`);
      const { placement, diagnostic } = resolvePoint(point, baseMountHosts);
      assert.equal(diagnostic, undefined, `${id}: ${diagnostic ?? ''}`);
      assert.deepEqual(placement, { kind: 'absolute', x: point.x, z: point.z }, `${id}: 绝对点位必须原样返回`);
    }
  });

  it('全量独立复算：81 沿墙点位 + 2 挂载点位 + 20 挂墙家具 + 全部绝对家具逐条对照', () => {
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
    assert.equal(wallPoints, 81, '沿墙点位数量变化：新增/删除点位必须同步更新本基准的覆盖口径');

    let mountPoints = 0;
    for (const point of allRawPoints) {
      if (point.mount === undefined) continue;
      mountPoints += 1;
      const host = resolvedHostItem(point.mount!.furniture_id);
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
    // 集成合并：Tier 1 计 17 件，Tier 2 本批新增 3 件墙锚家具（bnw.wardrobe_180、bnw.desk、ld.fridge），
    // 两批无重叠，合计 20 件；逐件对照循环是数据驱动的，本行只更新覆盖口径。
    assert.equal(wallFurniture, 20, '挂墙家具数量变化：新增/删除对象必须同步更新本基准的覆盖口径');

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
    // 期望值由反向后的墙段 + 点位声明当轮算出（与参考实现同口径的向量运算，
    // 手算 3.735 见上行注释）；断言解算 == 独立复算。
    const reversed = { x1: 7.20, z1: 4.30, x2: 7.20, z2: 3.55 };
    const walls = pointWallsWith('w_gbath_east_open_vanity', reversed);
    const point = pointById('sock_gbath_vanity');
    const after = resolvePoint(point, baseMountHosts, walls);
    assert.ok(after.placement && after.placement.kind === 'wall');
    const dx = reversed.x2 - reversed.x1;
    const dz = reversed.z2 - reversed.z1;
    const length = Math.hypot(dx, dz);
    const tangent = { x: dx / length, z: dz / length };
    const datum = { x: reversed.x1 + tangent.x * point.along!, z: reversed.z1 + tangent.z * point.along! };
    const normal = wallNormal(tangent, point.wall_side!);
    const offset = WALL_THICKNESS / 2 + (point.face_offset ?? 0);
    const expected = { x: datum.x + normal.x * offset, z: datum.z + normal.z * offset };
    assertXZ(after.placement, expected, '反向墙的解算位置须等于独立复算');
    assertXZ(after.placement.datum, datum, 'along 自新起点量');
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
    // 手算值见上行注释，供人核对；断言只验相对位移与独立参考解。
    const newWidth = 1.60;
    const point = pointById('night_living_mid');
    const before = resolvePoint(point, baseMountHosts);
    const after = resolvePoint(point, mountHostsWithWidth('ld.entry_half_height_cabinet', newWidth));
    assert.ok(before.placement && before.placement.kind === 'mount');
    assert.ok(after.placement && after.placement.kind === 'mount');
    // 中心不变 ⇒ 脸轴起点（minZ）北移半个变窄量，along 不变 ⇒ 挂载点 z 跟走半个变窄量；
    // 脸平面由 depth 决定，与 width 无关 ⇒ x 不变。
    const oldWidth = referenceDims(furnishingById('ld.entry_half_height_cabinet')).width;
    const expectedShift = (oldWidth - newWidth) / 2;
    assertClose(after.placement.x - before.placement.x, 0, '脸平面 x 不变');
    assertClose(after.placement.z - before.placement.z, expectedShift, '沿脸轴 z 跟走半个变窄量');
    assert.ok(after.placement.along <= newWidth + TOL, 'along 仍在新脸长度内');

    // 全量独立复算：改宽后的宿主索引值 = 参考 AABB 重算值。
    const host = { ...furnishingById('ld.entry_half_height_cabinet'), width: newWidth };
    const reference = referenceMountPoint(point.mount!, host);
    assertXZ(after.placement, reference, '变窄后与独立参考解一致');
  });

  it('台盆柜宽度 0.69→0.61：robot_bay 槽位与派生抽屉宽跟着走', () => {
    // 柜中心由墙锚决定，与柜宽无关（沿墙 along 指柜中心），所以宿主中心不变 (6.89,3.955)。
    // width 0.69：lx = −0.345+0.25 = −0.095 ⇒ dock z = 3.955−0.095 = 3.860；抽屉宽 = 0.69−0.50 = 0.190。
    // width 0.61：lx = −0.305+0.25 = −0.055 ⇒ dock z = 3.955−0.055 = 3.900；抽屉宽 = 0.61−0.50 = 0.110。
    // 手算值见上行注释，供人核对；断言只验前后不变式、相对位移与独立参考解。
    const newWidth = 0.61;
    const items = cloneFurnishings();
    const vanity = items.find((item) => item.id === 'gbath.vanity');
    assert.ok(vanity && vanity.vanity_layout);
    const originalWidth = vanity.vanity_layout.width;
    const robotBayWidth = vanity.vanity_layout.robot_bay_width;
    const dock = items.find((item) => item.id === 'gbath.robot_dock');
    assert.ok(dock);

    const beforeHosts = hostIndex(items);
    const beforeVanity = resolveFurniturePlacement(vanity as unknown as PlacementItem, furnitureWallSegments, beforeHosts);
    const beforeDock = resolveFurniturePlacement(dock as unknown as PlacementItem, furnitureWallSegments, beforeHosts);
    assert.ok(beforeVanity.placement && beforeDock.placement);
    assertXZ(beforeDock.placement, referenceRobotBay(vanity, beforeVanity.placement), '改宽前 dock 须等于独立参考解');

    vanity.vanity_layout.width = newWidth;
    const afterHosts = hostIndex(items);
    const afterVanity = resolveFurniturePlacement(vanity as unknown as PlacementItem, furnitureWallSegments, afterHosts);
    const afterDock = resolveFurniturePlacement(dock as unknown as PlacementItem, furnitureWallSegments, afterHosts);
    assert.equal(afterVanity.diagnostic, undefined, `vanity: ${afterVanity.diagnostic ?? ''}`);
    assert.equal(afterDock.diagnostic, undefined, `dock: ${afterDock.diagnostic ?? ''}`);
    assert.ok(afterVanity.placement && afterDock.placement);
    // 宿主中心由墙锚（along 指柜中心）决定，与柜宽无关 ⇒ 改宽前后中心不变。
    assertXZ(afterVanity.placement, beforeVanity.placement, '宿主中心不随宽度变（along 指中心）');
    assertXZ(afterDock.placement, referenceRobotBay(vanity, afterVanity.placement), '变窄后与独立参考解一致');

    // 派生分割量：抽屉宽 = width − robot_bay_width（剩余尺寸算出，不声明）。
    const beforeLayout = resolveVanityLayout(vanity.vanity_layout === undefined ? undefined : { ...vanity.vanity_layout, width: originalWidth });
    assert.ok(beforeLayout.ok);
    assertClose(beforeLayout.layout.drawer_width, originalWidth - robotBayWidth, '改宽前抽屉宽 = 柜宽 − 仓宽');
    const afterLayout = resolveVanityLayout(vanity.vanity_layout);
    assert.ok(afterLayout.ok);
    assertClose(afterLayout.layout.drawer_width, newWidth - robotBayWidth, '改宽后抽屉宽 = 柜宽 − 仓宽');
  });

  it('半高柜变宽后 MEP 算量（drawnM）按端点位移的几何增量跟着走', () => {
    // 算量链：柜宽 → 挂载点 night_living_mid → 路由 strong-light-entry-night-mid 的 to 端点
    // → routeLength → shared/mep-takeoff 的 conduit.drawnM。
    // 2026-11-16 MEP 关系化后，本路由的 via 是关系步：level y=0.02 → axis_run x 跟 to.x →
    // axis_run z 跟 to.z。折线 = from (12.77,4.37,0.30) 落 0.02 → 西行至 x=11.42 →
    // 南行至 to.z → 竖直升 0.28 端接。柜宽 2.00→1.60 后 to=(11.42,5.00)：末 via 也跟到
    // (11.42,5.00,0.02)，末段仍是竖直 0.28m（不变）；动的是 z 向轴跑段：4.80−4.37=0.43
    // → 5.00−4.37=0.63，增量恰为 0.20。全屋只有该路由的端点位移，所以 drawnM 的增量
    // 必须恰好等于这段几何增量。
    // 手算值见上行注释，供人核对；断言只验派生规则（端点 == 当轮解出的挂载点、
    // 末 via 标高 == 路由声明的 level 步、增量 == 挂载点位移、末段竖直且长 == 声明高差）。
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

    // 路由端点就是当轮解出的挂载点 night_living_mid（改宽前后各解一次）。
    const mountBefore = resolvePoint(pointById('night_living_mid'), baseMountHosts);
    const mountAfter = resolvePoint(pointById('night_living_mid'), mountHostsWithWidth('ld.entry_half_height_cabinet', 1.60));
    assert.ok(mountBefore.placement && mountAfter.placement);
    assertXZ(routeBefore.to, mountBefore.placement, `${routeId} 改宽前路由端点 == 挂载点`);
    assertXZ(routeAfter.to, mountAfter.placement, `${routeId} 改宽后路由端点 == 挂载点`);

    // 末 via 标高 == 路由声明的 level 步标高（不读旧绝对弯点）。
    const levelStep = (routeDecl.via as Array<{ kind?: string; y?: number }>).find((step) => step.kind === 'level');
    const levelY = levelStep?.y;
    assert.ok(levelY !== undefined, `${routeId} 必须声明 level 步标高`);
    // 这条路由的末段声明是本基准的几何前提：末 via 落点 + to_height 变了，增量公式必须重推。
    // （二阶段 S1）末 via 读统一出口的 viaPoints，不读原始 route.via。
    const lastVia = routeBefore.viaPoints[routeBefore.viaPoints.length - 1]!;
    assertXZ(lastVia, mountBefore.placement, `${routeId} 末 via 平面点 == 挂载点`);
    assertClose(lastVia.y ?? NaN, levelY, `${routeId} 末 via 标高 == 声明 level 步`);

    // 关系步口径：末 via 是 axis_run z 跟 to，不是固定弯点——改宽后它也跟 to 走。
    const lastViaAfter = routeAfter.viaPoints[routeAfter.viaPoints.length - 1]!;
    assertXZ(lastViaAfter, mountAfter.placement, `${routeId} 改宽后末 via 跟 to 走（axis_run 关系步）`);
    assertClose(lastViaAfter.y ?? NaN, levelY, `${routeId} 改宽后末 via 标高 == 声明 level 步`);

    const endY = routeDecl.to_height as number;
    const viaY = lastVia.y as number;
    // 增量全在 z 向轴跑段（上一 via 的 z 不动，末 via 的 z 跟挂载点走）：
    // z 向轴跑段增量 == 挂载点 z 位移。
    const zRunBefore = lastVia.z - routeBefore.viaPoints[routeBefore.viaPoints.length - 2]!.z;
    const zRunAfter = lastViaAfter.z - routeAfter.viaPoints[routeAfter.viaPoints.length - 2]!.z;
    assertClose(zRunAfter - zRunBefore, mountAfter.placement.z - mountBefore.placement.z, `${routeId} z 向轴跑段增量 == 挂载点 z 位移`);
    // 末段（末 via → to）改宽前后都是竖直段：dx=dz=0，长度 = to_height − 末 via 标高（均取声明值）。
    const finalBefore = Math.hypot(routeBefore.to.x - lastVia.x, endY - viaY, routeBefore.to.z - lastVia.z);
    const finalAfter = Math.hypot(routeAfter.to.x - lastViaAfter.x, endY - (lastViaAfter.y as number), routeAfter.to.z - lastViaAfter.z);
    assertClose(routeBefore.to.x - lastVia.x, 0, `${routeId} 改宽前末段无 x 位移`);
    assertClose(routeBefore.to.z - lastVia.z, 0, `${routeId} 改宽前末段无 z 位移`);
    assertClose(finalBefore, endY - viaY, `${routeId} 改宽前末段长 = to_height − 末 via 标高`);
    assertClose(routeAfter.to.x - lastViaAfter.x, 0, `${routeId} 改宽后末段无 x 位移`);
    assertClose(routeAfter.to.z - lastViaAfter.z, 0, `${routeId} 改宽后末段无 z 位移`);
    assertClose(finalAfter, endY - viaY, `${routeId} 改宽后末段长 = to_height − 末 via 标高`);
    const expectedDelta = (zRunAfter - zRunBefore) + (finalAfter - finalBefore);
    assertClose(after.takeoff.conduit.drawnM - before.takeoff.conduit.drawnM, expectedDelta, 'drawnM 增量 = 轴跑段增量 + 末段增量（0）');
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
    // 不相关的挂载点：与改名前基线解算逐项一致（无变化规则，不钉坐标）。
    const corridorBaseline = resolvePoint(pointById('night_corridor'), baseMountHosts);
    assert.deepEqual(corridor, corridorBaseline, '不相关的挂载点解算不变');

    const dock = resolveFurniturePlacement(
      furnishingById('gbath.robot_dock') as unknown as PlacementItem,
      furnitureWallSegments,
      hostIndex(items),
    );
    assert.equal(dock.diagnostic, undefined, `不相关的槽位子件不得受影响：${dock.diagnostic ?? ''}`);
    assert.ok(dock.placement);
    // 不相关的槽位子件：与改名前基线解算逐项一致（无变化规则，不钉坐标）。
    const dockBaseline = resolveFurniturePlacement(
      furnishingById('gbath.robot_dock') as unknown as PlacementItem,
      furnitureWallSegments,
      baseFurnitureHosts,
    );
    assert.deepEqual(dock, dockBaseline, '不相关的槽位子件解算不变');

    // 同一份断引用在重排后仍是同一条诊断（按 id 绑定，与数组位置无关）。
    const reorderedItems = [...items];
    const reorderedHosts = mountHostIndex(reorderedItems.reverse());
    const brokenAfterReorder = resolvePoint(pointById('night_living_mid'), reorderedHosts);
    assert.equal(brokenAfterReorder.placement, null);
    assert.match(brokenAfterReorder.diagnostic ?? '', /不在家具宿主索引或未放置/);
  });
});
