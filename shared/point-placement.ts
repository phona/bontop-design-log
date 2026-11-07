/**
 * 点位定位解算（纯几何，无 THREE、无 I/O）——issue #98 第四阶段 S1，设计文档 §4.3/§4.4。
 *
 * 电气/给排水点位原先有**两个事实源**：声明的绝对 x/z（DXF/MEP/校验直接消费）与墙引用
 * wall/wall_side（3D 用来重算投影），且 x/z 的垂直分量分了三种互不兼容的口径（墙中心线 65 个 /
 * 完成面+0.04 惯用偏移 10 个 / 完成面 3 个），3D 还完全丢弃声明垂直分量改按「中心线 + 0.075」落位。
 * 本文件把沿墙点位收敛成**单一解算**：`along`（沿墙距离，起算口径与家具摆位/洞口投影同一，
 * 见下）+ `face_offset`（离开完成面的附加量）+ 侧别法线，解析失败返回**诊断文本**而不是
 * clamp——clamp 正是 sock_weakbox 242mm 静默偏差的机制根源。
 *
 * 解果的两个位置分量（消费者按需取用，全部来自同一次解算）：
 * - `datum`：墙线（中心线）上 along 处的点。3D 渲染与 DXF 出图在它上面按**薄板惯例**
 *   （THIN_PLATE_FACE_OFFSET = 半墙厚 + 墙缝 + 半件厚 = 0.075m）偏移——2026-11-07 业主裁定
 *   「DXF 迁就 3D 投影」，该偏移是投影真值，DXF 与 3D 从此按构造同点。
 * - `x/z`：完成面 + face_offset 处的点位（wallFaceOffset 解算）。迁移期它必须等于声明的
 *   x/z（断言字段，容差 0.005m，见 tests/server/point-placement.test.ts）；MEP 路线端点取它
 *   （管线接在底盒上，不在面盘上），因此本期 MEP 几何零变化。
 *
 * along 起算口径（§4.4，与 S2 统一）：**墙段起点顶点 (x1,z1) 沿折线链累计**——与
 * `shared/furniture-placement.ts` resolveItem 的 along 语义、`shared/wall-segments.ts`
 * openingsAlongWall 的洞口沿墙区间同一口径。注意 InfrastructureBuilder 原先取「最近段 +
 * clamp」，多段墙上与累计口径不等价；本案被引用墙实测全部单段，但本解算按折线累计实现并
 * 显式拒绝越界。
 */

import type { WallSide } from './types.js';
import { WALL_THICKNESS } from './furniture-placement.js';
import { pointAlongPolyline, polylineLength, wallFaceOffset } from './wall-segments.js';

/** 墙段最小形态（SceneSegment 同构；ChainWallLike / InfrastructureWallSegment 亦满足）。 */
export interface PointWallSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** 宿主墙解算上下文：折线段 + 线基准（line_datum 缺声明时 wallFaceOffset 抛错，不设默认值）。 */
export interface PointWall {
  segments: readonly PointWallSegment[];
  line_datum?: 'centerline';
}

/** 点位定位声明的最小形态（ElectricalPoint / PlumbingPoint 的定位相关子集）。
 *
 * 侧别字段双名：`wall_side` 是 config YAML 声明名，`wallSide` 是 parseElectricalPoints /
 * parsePlumbingPoints 投影名（shared/types.ts 的历史驼峰字段）——两者等价，`wall_side` 优先，
 * 免得每个调用方各写一遍映射。 */
export interface PointPlacementInput {
  id?: string;
  wall?: string;
  wall_side?: WallSide;
  wallSide?: WallSide;
  along?: number;
  face_offset?: number;
  x?: number;
  z?: number;
  /** 显式绝对坐标意图（C/D/E/F 组：顶面灯位/建筑服务基准/地面排水/器具邻接点）。 */
  absolute?: boolean;
  /** 柜面/家具挂载定位来源（S2 把 mount_anchor 升级为真挂载后启用；本期见 resolveMounted）。 */
  mount?: { furniture_id: string; face: WallSide; surface_gap?: number };
  /** 锚点引用定位来源（S4：F 组转家具挂载 / 暖通 ref 通道）。 */
  anchor?: { source: string; id: string };
  /** 宿主意图标注（只作文档与校验输入，不参与解算）。 */
  host_intent?: string;
}

export interface PointPlacementWall {
  /** 墙线（中心线）上 along 处的点——3D/DXF 薄板惯例偏移的基准。 */
  datum: { x: number; z: number };
  /** 完成面 + face_offset 处的点位（迁移期断言目标；MEP 路线端点取它）。 */
  x: number;
  z: number;
  along: number;
  wallId: string;
  wallSide: WallSide;
  /** 指向 wall_side 侧的单位法线（世界坐标）。 */
  normal: { x: number; z: number };
  /** 离开墙中心线的总偏移 = wallFaceOffset + face_offset（米）。 */
  offsetFromCenterline: number;
}

export type PointPlacement =
  | { kind: 'absolute'; x: number; z: number }
  | ({ kind: 'wall' } & PointPlacementWall);

export interface PointPlacementResolution {
  /** count-only 之外的条目都应有位置；解析失败为 null 且必须带 diagnostic。 */
  placement: PointPlacement | null;
  diagnostic?: string;
}

/** along 合法域的数值容差（米）：消浮点噪声，1µm 对施工无意义。 */
const ALONG_EPS = 1e-6;

/**
 * 薄板惯例偏移（米）：墙中心线 → 面盘安装面。3D 渲染（InfrastructureBuilder.placeModel 原
 * 口径）与 DXF 出图共用这一份——2026-11-07 业主裁定「DXF 迁就 3D 投影」，0.075 是投影真值，
 * 施工图底盒整体移动 15~75mm 是该裁定的预期交付物变更（79 个沿墙点位中 56 个原先画在
 * 120mm 墙身中心线上）。
 */
/** 面盘与完成面之间的安装缝（米）。 */
export const POINT_WALL_GAP = 0.005;
/** 薄型面件半厚（米）：插座/开关面板类。 */
export const POINT_FIXTURE_HALF_THICKNESS = 0.01;
export const THIN_PLATE_FACE_OFFSET = WALL_THICKNESS / 2 + POINT_WALL_GAP + POINT_FIXTURE_HALF_THICKNESS;

const SIDE_VECTORS: Record<WallSide, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

/** 折线累计解算：返回 along 处的点与该段切向（pointAlongPolyline 取点，本函数补切向）。 */
function pointAndTangentOnPolyline(
  segments: readonly PointWallSegment[],
  along: number,
): { point: { x: number; z: number }; tangent: { x: number; z: number } } | null {
  const point = pointAlongPolyline(segments, along);
  if (!point) return null;
  let remaining = along;
  for (const segment of segments) {
    const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
    if (length <= 1e-9) continue;
    if (remaining <= length + 1e-9) {
      return {
        point,
        tangent: { x: (segment.x2 - segment.x1) / length, z: (segment.z2 - segment.z1) / length },
      };
    }
    remaining -= length;
  }
  return null;
}

/**
 * 点位定位解算。定位来源必须唯一（与 resolveFurniturePlacement 同构）：
 * `wall + along` / `mount` / `anchor` / `absolute` 四者之一，同时声明多个即诊断失败。
 * 越界（along 超出墙段总长）返回诊断，**不 clamp**。
 */
export function resolvePointPlacement(
  point: PointPlacementInput,
  wallSegments: ReadonlyMap<string, readonly PointWallSegment[]> | undefined,
  lineDatum?: 'centerline',
): PointPlacementResolution {
  const id = point.id ?? '(无 id)';
  const wallSide = point.wall_side ?? point.wallSide;
  // wall_side 单独出现**不是**定位来源（它只是「装在哪一面」的标注，没有宿主墙定不了位）：
  // 只有 wall / along 触发沿墙分支，wall_side alone 落到绝对分支或「未声明来源」诊断。
  const hasWallAnchor = point.wall !== undefined || point.along !== undefined;
  const hasAbsoluteFlag = point.absolute === true;

  if (point.mount !== undefined) {
    if (point.anchor !== undefined || hasWallAnchor || hasAbsoluteFlag) {
      return { placement: null, diagnostic: `点位 ${id}: mount 与 anchor/wall/absolute 不得同时声明（定位来源必须唯一）` };
    }
    // S2 的活（设计文档 §4.8-S2）：把 mount_anchor 升级为真挂载，平面基准由宿主脸 + surface_gap
    // 解析。本期不实现——返回诊断让消费者显形，而不是静默回落到声明 x/z 造第二事实源。
    return {
      placement: null,
      diagnostic: `点位 ${id}: mount 定位解析未实现（S2：mount_anchor 升级为真挂载，位置由宿主脸 + surface_gap 解出）`,
    };
  }

  if (point.anchor !== undefined) {
    if (hasWallAnchor || hasAbsoluteFlag) {
      return { placement: null, diagnostic: `点位 ${id}: anchor 与 wall/absolute 不得同时声明（定位来源必须唯一）` };
    }
    return {
      placement: null,
      diagnostic: `点位 ${id}: anchor 定位解析未实现（S4：F 组转家具挂载 / 暖通 ref 通道改走本解算器）`,
    };
  }

  if (hasWallAnchor && hasAbsoluteFlag) {
    return { placement: null, diagnostic: `点位 ${id}: wall/wall_side/along 与 absolute 不得同时声明（定位来源必须唯一）` };
  }

  if (hasWallAnchor) {
    if (point.wall === undefined || point.along === undefined) {
      return {
        placement: null,
        diagnostic: `点位 ${id}: 沿墙定位要求 wall + along 齐备（x/z 只是迁移期断言字段，不是定位来源；缺 along 无法解算）`,
      };
    }
    if (wallSide === undefined) {
      return { placement: null, diagnostic: `点位 ${id}: 沿墙定位要求 wall_side（安装面决定侧别法线；x/z 删除后无从推断）` };
    }
    const segments = wallSegments?.get(point.wall);
    if (!segments?.length) {
      return { placement: null, diagnostic: `点位 ${id}: 宿主墙 "${point.wall}" 不在墙段索引里（断引用：墙不存在或调用方未提供 wallSegments）` };
    }
    if (!Number.isFinite(point.along) || point.along < -ALONG_EPS) {
      return { placement: null, diagnostic: `点位 ${id}: along=${String(point.along)} 不是合法的沿墙距离（必须 ≥ 0）` };
    }
    const total = polylineLength(segments);
    if (point.along > total + ALONG_EPS) {
      // fail-closed：不钳位到端点。sock_weakbox 的历史事故正是「投影超段就悄悄挪到端点」，
      // 声明 z=3.23 超出墙段端 0.23m 被 clamp 成 242mm 静默偏差。
      return {
        placement: null,
        diagnostic: `点位 ${id}: along=${point.along.toFixed(3)} 越出墙段 "${point.wall}"（沿墙总长 ${total.toFixed(3)}m；拒绝钳位，请修正声明或改挂正确的宿主墙）`,
      };
    }
    const located = pointAndTangentOnPolyline(segments, Math.max(0, point.along));
    if (!located) {
      return { placement: null, diagnostic: `点位 ${id}: along=${point.along} 在墙 "${point.wall}" 上解不出点（折线退化？）` };
    }
    const { point: datum, tangent } = located;
    const left = { x: -tangent.z, z: tangent.x };
    const right = { x: tangent.z, z: -tangent.x };
    const authored = SIDE_VECTORS[wallSide];
    const normal = left.x * authored.x + left.z * authored.z >= right.x * authored.x + right.z * authored.z ? left : right;
    let faceOffset: number;
    try {
      faceOffset = wallFaceOffset({ line_datum: lineDatum, id: point.wall });
    } catch (error) {
      // 宿主墙缺 line_datum：转成诊断（与越界同一条显形通道），不让 wallFaceOffset 的抛错
      // 绕过解算器的诊断契约把调用方炸掉。
      return { placement: null, diagnostic: `点位 ${id}: ${error instanceof Error ? error.message : String(error)}` };
    }
    const offset = faceOffset + (point.face_offset ?? 0);
    return {
      placement: {
        kind: 'wall',
        datum: { x: datum.x, z: datum.z },
        x: datum.x + normal.x * offset,
        z: datum.z + normal.z * offset,
        along: Math.max(0, point.along),
        wallId: point.wall,
        wallSide,
        normal,
        offsetFromCenterline: offset,
      },
    };
  }

  // 绝对坐标（C/D/E/F 组）：顶面灯位、建筑服务基准、地面排水口、器具邻接点——参照物不在本模型
  // 对象体系里（开发商预留物/地面/顶面/未 frozen 的器具），用墙或家具派生反而要发明锚点。
  if (point.x === undefined || point.z === undefined) {
    return {
      placement: null,
      diagnostic: `点位 ${id}: 绝对定位要求 x 与 z 齐备（或改声明 wall + along / mount / anchor）`,
    };
  }
  return { placement: { kind: 'absolute', x: point.x, z: point.z } };
}

/**
 * 从场景墙元素建点位宿主墙索引（id → 折线段 + line_datum）。DXF 装配、MEP 端点解析、
 * 浏览器 MEP 渲染共用这一份构造，避免每个调用方各写一遍「segments 缺省取主线」。
 */
export function pointWallIndexFromElements(
  walls: Iterable<{ id?: string; x1?: number; z1?: number; x2?: number; z2?: number; segments?: readonly PointWallSegment[]; line_datum?: 'centerline' }>,
): Map<string, PointWall> {
  const index = new Map<string, PointWall>();
  for (const wall of walls) {
    if (!wall.id || wall.x1 === undefined || wall.z1 === undefined || wall.x2 === undefined || wall.z2 === undefined) continue;
    index.set(wall.id, {
      segments: wall.segments?.length
        ? wall.segments.map((segment) => ({ x1: segment.x1, z1: segment.z1, x2: segment.x2, z2: segment.z2 }))
        : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }],
      ...(wall.line_datum ? { line_datum: wall.line_datum } : {}),
    });
  }
  return index;
}

/**
 * 便捷包装：调用方持有 `id → PointWall`（折线段 + line_datum）时不必自己拆 lineDatum。
 * 与三参版同一解算，只是把宿主墙查找收在一处。
 */
export function resolvePointPlacementInWalls(
  point: PointPlacementInput,
  walls: ReadonlyMap<string, PointWall> | undefined,
): PointPlacementResolution {
  const host = point.wall !== undefined ? walls?.get(point.wall) : undefined;
  return resolvePointPlacement(point, host ? new Map([[point.wall!, host.segments]]) : undefined, host?.line_datum);
}
