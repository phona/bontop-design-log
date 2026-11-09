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
 */

import type { FurnishingsYaml } from './types.js';
import {
  pointMountHostIndex,
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
}

/** 两项输入齐备（交付/建场主路径）：两个索引都必然产出。 */
export function buildPlacementIndexes(input: {
  geometry: PlacementGeometrySource;
  furnishings: FurnishingsYaml;
}): { pointWalls: Map<string, PointWall>; mountHosts: Map<string, PointMountHost> };
/** 容缺路径（lint/loader 的局部上下文）：缺哪份输入，对应索引即 undefined。 */
export function buildPlacementIndexes(input: {
  geometry?: PlacementGeometrySource;
  furnishings?: FurnishingsYaml;
}): PlacementIndexes;
export function buildPlacementIndexes(input: {
  geometry?: PlacementGeometrySource;
  furnishings?: FurnishingsYaml;
}): PlacementIndexes {
  return {
    pointWalls: input.geometry === undefined
      ? undefined
      : pointWallIndexFromElements(input.geometry.walls),
    // 入参 furnishings 必须是全量（含一期不显示的家具）：见文件头「阶段可见性与定位宿主」。
    mountHosts: input.furnishings === undefined
      ? undefined
      : pointMountHostIndex(Object.values(input.furnishings).flat()),
  };
}
