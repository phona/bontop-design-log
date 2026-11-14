/**
 * 定位索引单一产地（issue #98 疗法②，方案见 PR #122 §2.1 / §三.2 / 补篇 3）。
 *
 * issue #98 第四阶段把点位坐标从「声明绝对 x/z」改成「关系派生」：config 只留
 * wall/wall_side/along 或 mount.furniture_id，平面位置由 shared/point-placement.ts 解算。
 * 解算需要两个索引包：
 *
 * - **pointWalls**：宿主墙表 —— 用 **layout.walls**（model-geometry 解析后的墙几何）构造；
 * - **mountHosts**：家具宿主表 —— 用 **未按阶段过滤的全量 furnishings**（house.yaml 全表）构造。
 *
 * 为什么 mountHosts 必须是全量：**阶段可见性与定位宿主是两个正交的关注点**（补篇 3）。
 * `schedule/phase-scope.yaml` 只决定「渲染时画不画」，不决定「家具在不在」。一期按 ID 排除
 * `ld.wall_cabinet_tall` 是故意的（一期视图不显示它），但已交付的 `night_corridor` 仍挂在该柜上，
 * 它的位置只能由宿主脸解出。若宿主表也按阶段过滤，该点位解不出位置，消费方只能降级
 * （回落原点 / 跳过该模型）——灯静默错位，而画面其余部分看起来正常。所以：
 *   - 几何渲染用 phase-filtered `house.furnishings`；
 *   - 定位宿主用全量 `house.furnishingsAll`。
 * 本函数入参 `furnishings` 因此**永远是全量表**，调用方不得在这里传阶段过滤后的清单。
 *
 * 单一产地：本文件是**生产链路**（server / app / shared 消费方）里 pointWalls / mountHosts
 * 的唯一构造入口。点位解算的消费方（电气 lint、3D 建场、DXF、MEP 端点、暖通投影、交付
 * 闭合性断言）全部改调 `buildPlacementIndexes`，不再各自拼
 * `pointWallIndexFromElements` + `pointMountHostIndex`。两个底层构造函数保留纯函数语义
 * （`scripts/**` 与 `tests/**` 仍可直接调用），本函数只做组装，不另立第三套口径。
 *
 * 疗法① 的交付闭合性断言（server/placement-closure.ts）消费的就是本函数的 `mountHosts`：
 * `assertPlacementHostClosure(..., buildPlacementIndexes({ furnishings: 全量 }).mountHosts)`。
 * 断言与被断言的数据来自同一份产物，不存在第二张宿主表。
 *
 * （二阶段 S1）mountHosts 的 x/z 不再读条目手写 x/z，改由
 * `resolveFurniturePlacements`（shared/furniture-placement.ts）一次解出——墙锚/挂载/
 * 锚点派生家具至此才进宿主索引；解不出的 id 条目进 `furnitureDiagnostics`，完整上下文
 * 下非空即定位失败，正式消费方（verify:* 门禁）必须把它计入错误，**不得静默过滤**。
 * 部分上下文（缺 geometry）只能解出绝对/mount/anchor 来源的家具，墙锚家具以
 * `wall "<id>" not found` 显式失败——不回落手写 x/z。
 */

import type { FurnishingsYaml } from './types.js';
import {
  resolveFurniturePlacements,
  type PlacementAnchors,
  type WallLike,
} from './furniture-placement.js';
import {
  pointMountHostIndexFromResolved,
  pointWallIndexFromElements,
  type PointMountHost,
  type PointWall,
  type PointWallElementInput,
} from './point-placement.js';

/**
 * 墙几何来源：必带 `.walls` 的对象（ResolvedLayout 等 layout 对象；也可用
 * `{ walls: snapshotWalls }` / `{ walls: wallsById.values() }` 包装裸数组或迭代器）。
 * 不接受裸 iterable：Map 本身也是 iterable，直接传 Map 会静默得到空索引。
 */
export type PlacementGeometrySource = { walls: Iterable<PointWallElementInput> };

export interface PlacementIndexes {
  /** 宿主墙表；未提供 geometry 时为 undefined（保留「无墙上下文」的既有语义）。 */
  pointWalls: Map<string, PointWall> | undefined;
  /** 家具宿主表；未提供 furnishings 时为 undefined（保留「无家具上下文」的既有语义）。 */
  mountHosts: Map<string, PointMountHost> | undefined;
  /**
   * 家具批量解算诊断（issue #98 二阶段 S1）：有 id 的家具解不出位置即逐条列入；
   * 未提供 furnishings 时为 undefined。完整上下文（geometry + furnishings）下非空即
   * 定位失败，正式消费方必须计入错误，不得静默过滤。
   */
  furnitureDiagnostics: Array<{ id: string; diagnostic: string }> | undefined;
}

/** 两项输入齐备（交付/建场主路径）：两个索引与诊断都必然产出。 */
export function buildPlacementIndexes(input: {
  geometry: PlacementGeometrySource;
  furnishings: FurnishingsYaml;
  anchors?: PlacementAnchors;
}): {
  pointWalls: Map<string, PointWall>;
  mountHosts: Map<string, PointMountHost>;
  furnitureDiagnostics: Array<{ id: string; diagnostic: string }>;
};
/** 容缺路径（lint/loader 的局部上下文）：缺哪份输入，对应索引即 undefined。 */
export function buildPlacementIndexes(input: {
  geometry?: PlacementGeometrySource;
  furnishings?: FurnishingsYaml;
  anchors?: PlacementAnchors;
}): PlacementIndexes;
export function buildPlacementIndexes(input: {
  geometry?: PlacementGeometrySource;
  furnishings?: FurnishingsYaml;
  anchors?: PlacementAnchors;
}): PlacementIndexes {
  // 墙输入可能是一次性 iterable（如 Map.values()）：先物化为数组再供两个索引共用，
  // 否则第二次遍历得到空墙表，墙锚家具被静默排除出 mountHosts。
  const wallList = input.geometry === undefined ? undefined : [...input.geometry.walls];
  const pointWalls = wallList === undefined
    ? undefined
    : pointWallIndexFromElements(wallList);
  if (input.furnishings === undefined) {
    return { pointWalls, mountHosts: undefined, furnitureDiagnostics: undefined };
  }
  // 入参 furnishings 必须是全量（含一期不显示的家具）：见文件头「阶段可见性与定位宿主」。
  const items = Object.values(input.furnishings).flat();
  // 缺 geometry 时墙段表为空：墙锚家具显式失败（`wall "<id>" not found`），绝对/mount/
  // anchor 来源照常解算——绝对 x/z 是其自身声明来源，不是回落。
  const wallSegments = wallList === undefined
    ? new Map<string, WallLike[]>()
    : wallSegmentsFromElements(wallList);
  const resolved = resolveFurniturePlacements(items, wallSegments, input.anchors);
  return {
    pointWalls,
    mountHosts: pointMountHostIndexFromResolved(resolved.placements),
    furnitureDiagnostics: resolved.diagnostics,
  };
}

/**
 * 家具解算用墙段表（与 scripts/generate-dressing-map.ts 同一构造）：按墙 id 分组，
 * 每墙取细分段（有 segments 走 segments，无 segments 才取主线）。
 *
 * 口径与 resolveItem（shared/furniture-placement.ts，取 segments[0]）、SceneBuilder、
 * DXF、verify-furniture-placement、pointWallIndexFromElements 完全一致：3 弧形墙
 * （w_mb_south / w_bath_north / w_vrv_north 各 17 段）上，批量解算与逐件解算从此走
 * 同一段；沿墙位置只在首段内有定义，超出首段域的 along 两路同报「outside wall span」，
 * 不再一路放弦上、一路放弧上。现 4 件墙锚家具均在单段墙上，几何零漂移。
 */
export function wallSegmentsFromElements(
  walls: Iterable<PointWallElementInput>,
): Map<string, WallLike[]> {
  const segments = new Map<string, WallLike[]>();
  for (const wall of walls) {
    if (wall.id === undefined || wall.x1 === undefined || wall.z1 === undefined || wall.x2 === undefined || wall.z2 === undefined) continue;
    const wallSegments = wall.segments?.length
      ? wall.segments.map((segment) => ({ x1: segment.x1, z1: segment.z1, x2: segment.x2, z2: segment.z2 }))
      : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
    const list = segments.get(wall.id) ?? [];
    list.push(...wallSegments);
    segments.set(wall.id, list);
  }
  return segments;
}
