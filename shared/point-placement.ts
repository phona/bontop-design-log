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
 * 解果的三个位置分量（消费者按需取用，全部来自同一次解算）：
 * - `datum`：墙线（中心线）上 along 处的点。3D 渲染与 DXF 出图在它上面按**薄板惯例**
 *   （THIN_PLATE_FACE_OFFSET = 半墙厚 + 墙缝 + 半件厚 = 0.075m）偏移——2026-11-07 业主裁定
 *   「DXF 迁就 3D 投影」，该偏移是投影真值，DXF 与 3D 从此按构造同点。
 * - `x/z`：完成面 + face_offset 处的点位（S2 起 face_offset 基准 = 口径 A 纯完成面
 *   WALL_THICKNESS/2 = 0.06，不再叠加 wallFaceOffset 里 0.008 的漆面/踢脚防 z-fighting 缝隙
 *   ——那是渲染概念，折进坐标会让惯用组 0.04 / sock_gbath_robot 0.09 的意图值全错 8mm）。
 *   迁移期它必须等于声明的 x/z（断言字段，容差 0.005m，见 tests/server/point-placement.test.ts）；
 *   MEP 路线端点取它（管线接在底盒上，不在面盘上）。
 * - `mount`（issue #98 S2 真挂载，处置表 A 组）：位置 = 宿主脸平面点 + along（沿脸位置）+
 *   face_offset；灯体半厚 + surface_gap 由渲染管线追加。S1 的 mount_anchor（身份注记 + 手写
 *   x/z 人工同步）已废——宿主移动时点位自动跟随，不再靠 note 记「随柜西移至 11.42」。
 *
 * along 起算口径（§4.4，与 S2 统一）：**墙段起点顶点 (x1,z1) 沿折线链累计**——与
 * `shared/furniture-placement.ts` resolveItem 的 along 语义、`shared/wall-segments.ts`
 * openingsAlongWall 的洞口沿墙区间同一口径。注意 InfrastructureBuilder 原先取「最近段 +
 * clamp」，多段墙上与累计口径不等价；本案被引用墙实测全部单段，但本解算按折线累计实现并
 * 显式拒绝越界。
 */

import type { WallSide } from './types.js';
import { WALL_THICKNESS, declaredFurnitureDims, type PlacementItem } from './furniture-placement.js';
import { pointAlongPolyline, polylineLength } from './wall-segments.js';

/** 墙段最小形态（SceneSegment 同构；ChainWallLike / InfrastructureWallSegment 亦满足）。 */
export interface PointWallSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** 宿主墙解算上下文：折线段 + 线基准（line_datum 缺声明时解算失败，不设默认值）。 */
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
  /** 家具挂载定位来源（issue #98 S2：位置 = 宿主脸 + along（沿脸位置）+ face_offset，
   * 灯体半厚 + surface_gap 由渲染管线（NightLightGeometry）在其上追加）。 */
  mount?: { furniture_id: string; face: WallSide; surface_gap?: number; along?: number; face_offset?: number };
  /** 锚点引用定位来源（S4：F 组转家具挂载 / 暖通 ref 通道）。 */
  anchor?: { source: string; id: string };
  /** 宿主意图标注（只作文档与校验输入，不参与解算）。 */
  host_intent?: string;
}

/** mount 宿主最小形态（house.yaml FurnishingItem 的定位相关子集；dims 由 declaredFurnitureDims 解）。 */
export interface PointMountHost {
  id: string;
  x?: number;
  z?: number;
  rotation?: number;
  width?: number;
  depth?: number;
}

/** mount 宿主 AABB 包络（与 verify-spatial validateFurnitureFaceMounts 原同式）。 */
export interface PointMountHostBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * mount 宿主 AABB 包络（rotation 0/90/180/270 轴对齐）。width/depth 缺声明返回 null——
 * 调用方转诊断，不发明尺寸。非 90° 整数倍的旋转下「宿主脸」不再与 AABB 侧面对应，同样 null。
 */
export function pointMountHostBounds(host: PointMountHost): PointMountHostBounds | null {
  if (host.x === undefined || host.z === undefined || host.width === undefined || host.depth === undefined) return null;
  const rotation = host.rotation ?? 0;
  if (Math.abs(rotation % 90) > 1e-9) return null;
  const radians = rotation * Math.PI / 180;
  const widthX = Math.abs(Math.cos(radians)) * host.width + Math.abs(Math.sin(radians)) * host.depth;
  const depthZ = Math.abs(Math.sin(radians)) * host.width + Math.abs(Math.cos(radians)) * host.depth;
  return {
    minX: host.x - widthX / 2,
    maxX: host.x + widthX / 2,
    minZ: host.z - depthZ / 2,
    maxZ: host.z + depthZ / 2,
  };
}

/**
 * 家具宿主索引（按稳定对象 id）。dims 走 furniture-placement.declaredFurnitureDims（行内 >
 * FURNITURE_DIMS 目录，vanity 走 vanity_layout），count-only（无 x/z）条目照样入索引——
 * 被 mount 引用时由解算器给出「宿主未放置」诊断，这是设计文档 §6.1-6「挂载潮」的显形探针。
 */
export function pointMountHostIndex(items: Iterable<PlacementItem>): Map<string, PointMountHost> {
  const index = new Map<string, PointMountHost>();
  for (const item of items) {
    if (item.id === undefined || index.has(item.id)) continue;
    const dims = declaredFurnitureDims(item);
    index.set(item.id, {
      id: item.id,
      ...(item.x !== undefined ? { x: item.x } : {}),
      ...(item.z !== undefined ? { z: item.z } : {}),
      ...(item.rotation !== undefined ? { rotation: item.rotation } : {}),
      ...(dims.width !== undefined ? { width: dims.width } : {}),
      ...(dims.depth !== undefined ? { depth: dims.depth } : {}),
    });
  }
  return index;
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
  /** 离开墙中心线的总偏移 = WALL_THICKNESS/2（口径 A 完成面）+ face_offset（米）。 */
  offsetFromCenterline: number;
}

export interface PointPlacementMount {
  /** 宿主脸平面点 + face_offset = 灯位锚点（渲染管线在此之上追加灯体半厚 + surface_gap）。 */
  x: number;
  z: number;
  /** 宿主脸平面点（face_offset 之前）。 */
  datum: { x: number; z: number };
  furnitureId: string;
  face: WallSide;
  /** 指向 face 侧的单位法线（世界坐标）。 */
  normal: { x: number; z: number };
  /** 声明的安装缝（米）；缺声明取渲染管线同款默认 0.003（NightLightGeometry）。 */
  surfaceGap: number;
  along: number;
  offsetFromFace: number;
}

export type PointPlacement =
  | { kind: 'absolute'; x: number; z: number }
  | ({ kind: 'wall' } & PointPlacementWall)
  | ({ kind: 'mount' } & PointPlacementMount);

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

/** mount 缺声明 surface_gap 时与渲染管线（NightLightGeometry `?? 0.003`）同款默认值。 */
const DEFAULT_SURFACE_GAP = 0.003;

/**
 * mount 定位解析（issue #98 S2，设计文档 §4.8-S2 处置表 A 组）：位置 = 宿主脸平面点
 * + along（沿脸位置，起算 = 脸轴负端：东西脸自 minZ 向北、南北脸自 minX 向东）+ face_offset
 * （离脸平面的附加量，缺省 0 = 贴脸）。灯体半厚 + surface_gap 由渲染管线在其上追加
 * （NightLightGeometry 既有偏移公式），不在这里折叠——折叠会让 DXF/MEP 与渲染各算一遍。
 *
 * 越界（along 超出宿主脸长度）返回诊断，**不钳位**；宿主断引用 / count-only（无平面几何）/
 * 尺寸缺声明 / 非轴对齐旋转同样诊断——宿主大量 count-only 时这里会集中显形（§6.1-6 探针）。
 */
function resolveMountedPoint(
  mount: NonNullable<PointPlacementInput['mount']>,
  id: string,
  wallSide: WallSide | undefined,
  mountHosts: ReadonlyMap<string, PointMountHost> | undefined,
): PointPlacementResolution {
  if (mountHosts === undefined) {
    // fail-closed（issue #98 疗法①，与 shared/lighting-fixtures.ts:65「缺失即抛」同一口径）：
    // 缺宿主索引是**调用方接线缺陷**（漏传参数），不是配置缺陷。原来的诊断返回值会被多个
    // 消费方降级——回落声明 x/z（S3 已删光）、回落原点、或把该模型跳过——于是静默错位。
    // 16 轮审查里 A 类 finding 反复复发正是这个机制：解算失败有声音，降级把声音吃掉。
    // 这里改成当场抛：缺索引就炸在调用点上，不许带着空索引继续解算。
    throw new Error(`点位 ${id}: mount 定位要求调用方提供家具宿主索引（mountHosts）；3D/DXF/MEP/校验入口均须从 house.yaml furnishings 建 pointMountHostIndex 传入`);
  }
  const host = mountHosts.get(mount.furniture_id);
  if (!host || host.x === undefined || host.z === undefined) {
    return {
      placement: null,
      diagnostic: `点位 ${id}: mount 宿主 "${mount.furniture_id}" 不在家具宿主索引或未放置（断引用 / count-only 条目无平面几何，不得挂载）`,
    };
  }
  if (mount.along === undefined) {
    return { placement: null, diagnostic: `点位 ${id}: mount 定位要求 along（沿宿主脸的位置；脸轴起算见 shared/point-placement.ts resolveMountedPoint）` };
  }
  if (!Number.isFinite(mount.along) || mount.along < -ALONG_EPS) {
    return { placement: null, diagnostic: `点位 ${id}: mount.along=${String(mount.along)} 不是合法的沿脸距离（必须 ≥ 0）` };
  }
  if (wallSide !== undefined && wallSide !== mount.face) {
    return { placement: null, diagnostic: `点位 ${id}: wall_side ${wallSide} 与 mount.face ${mount.face} 不一致（挂载点没有第二安装面）` };
  }
  const bounds = pointMountHostBounds(host);
  if (!bounds) {
    return {
      placement: null,
      diagnostic: `点位 ${id}: mount 宿主 "${mount.furniture_id}" 无 width/depth 尺寸声明或旋转非 90° 整数倍，宿主脸平面无法解算`,
    };
  }
  const horizontalFace = mount.face === 'east' || mount.face === 'west';
  const plane = mount.face === 'east' ? bounds.maxX : mount.face === 'west' ? bounds.minX : mount.face === 'south' ? bounds.maxZ : bounds.minZ;
  const axisMin = horizontalFace ? bounds.minZ : bounds.minX;
  const axisLength = horizontalFace ? bounds.maxZ - bounds.minZ : bounds.maxX - bounds.minX;
  if (mount.along > axisLength + ALONG_EPS) {
    return {
      placement: null,
      diagnostic: `点位 ${id}: mount.along=${mount.along.toFixed(3)} 越出宿主 "${mount.furniture_id}" ${mount.face} 脸（沿脸长度 ${axisLength.toFixed(3)}m；拒绝钳位，请修正 along 或改挂正确宿主脸）`,
    };
  }
  const normal = SIDE_VECTORS[mount.face];
  const alongCoord = axisMin + Math.max(0, mount.along);
  const datum = horizontalFace ? { x: plane, z: alongCoord } : { x: alongCoord, z: plane };
  const offsetFromFace = mount.face_offset ?? 0;
  return {
    placement: {
      kind: 'mount',
      x: datum.x + normal.x * offsetFromFace,
      z: datum.z + normal.z * offsetFromFace,
      datum,
      furnitureId: mount.furniture_id,
      face: mount.face,
      normal,
      surfaceGap: mount.surface_gap ?? DEFAULT_SURFACE_GAP,
      along: Math.max(0, mount.along),
      offsetFromFace,
    },
  };
}

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
 * 越界（along 超出墙段总长 / 宿主脸长度）返回诊断，**不 clamp**。
 */
export function resolvePointPlacement(
  point: PointPlacementInput,
  wallSegments: ReadonlyMap<string, readonly PointWallSegment[]> | undefined,
  lineDatum?: 'centerline',
  mountHosts?: ReadonlyMap<string, PointMountHost>,
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
    return resolveMountedPoint(point.mount, id, wallSide, mountHosts);
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
    // 完成面基点 = 口径 A 的墙线 ± WALL_THICKNESS/2（2026-11-06 业主口径 A，声明唯一在
    // shared/furniture-placement.ts WALL_THICKNESS）。宿主墙缺 line_datum 照旧 fail-closed
    // （pending #76 裁定前不设默认值）——但不复用 wallFaceOffset() 的返回值：那里面还叠着
    // 0.008 的漆面/踢脚防 z-fighting 缝隙，是渲染概念；折进点位坐标会让 face_offset 的
    // 意图值（惯用组 0.04、sock_gbath_robot 0.09）全都错 8mm。
    if (lineDatum !== 'centerline') {
      return {
        placement: null,
        diagnostic: `点位 ${id}: 宿主墙 "${point.wall}" 未声明 line_datum（或取值不受支持）：完成面偏移无法解算。2026-11-06 业主口径 A 起 line_datum 必须显式声明（当前唯一合法值 centerline）；pending #76 量房裁定前不得设默认值`,
      };
    }
    const offset = WALL_THICKNESS / 2 + (point.face_offset ?? 0);
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
 * 与四参版同一解算，只是把宿主墙查找收在一处。
 */
export function resolvePointPlacementInWalls(
  point: PointPlacementInput,
  walls: ReadonlyMap<string, PointWall> | undefined,
  mountHosts?: ReadonlyMap<string, PointMountHost>,
): PointPlacementResolution {
  const host = point.wall !== undefined ? walls?.get(point.wall) : undefined;
  return resolvePointPlacement(point, host ? new Map([[point.wall!, host.segments]]) : undefined, host?.line_datum, mountHosts);
}
