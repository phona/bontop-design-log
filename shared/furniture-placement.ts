/**
 * 家具摆位解算（纯几何，无 THREE）。原实现自 render/SceneBuilder.ts 抽出（2026-11-03，
 * DXF 导出需要同一口径但不引入 three.js），SceneBuilder 改为 re-export，全仓仍只有这一份实现。
 *
 * issue #98 PR-3 起兼作「定位声明解算器」：挂墙（wall/wall_side/along）、挂载宿主
 * （mount: {furniture_id, slot}）、锚点引用（anchor: {source, id}，PR-10）、
 * 绝对 x/z 四种定位声明都在这里解算，解析失败返回 **诊断文本**而不是 null——null 只保留给
 * count-only 条目（无平面几何，预期跳过），「声明了却解不出来」必须让页面/DXF/verify:furniture 显形并失败。
 */

import { CONDENSATE_CHAIN_FURNITURE_TYPES, FURNITURE_DIMS, type FurnishingItem, type VanityLayout, type VanityLayoutDecl, type WallSide } from './types.js';
import type { CondensateChainGeometry } from './condensate-chain.js';

/**
 * 墙体完成面基厚（渲染与摆位共用的单一声明）。
 * 墙线基准语义（2026-11-06 业主口径 A，落实 pending #76「渲染口径先行」）：模型线=渲染墙盒
 * 中心线，完成面=线±本值之半。宿主墙必须在 config/layout/model-geometry.yaml 声明
 * `line_datum: centerline`（verify-furniture-placement 对挂墙家具宿主墙强制）。
 */
export const WALL_THICKNESS = 0.12;

/**
 * 协调示意类家具（冷凝水 PVC 走向代理件，FixtureFactory 配方零件全部 materialRole:
 * hvac_coordination_cover + pipe-chase 检视层）：不是施工家具，DXF 导出排除——冷凝水
 * 几何以 M-CAND 候选路线为准，双重表达会产生位置漂移的第二个"事实"（codex 十一审
 * blocking：wardrobe_entry 的 x=4.10 是线段端点锚，居中外框漂移 0.6m）。
 */
export const COORDINATION_SCHEMATIC_FURNITURE_TYPES: ReadonlySet<string> = new Set([
  'condensate_pipe_ac_outlet',
  'mb_vanity_pvc_box',
  'mb_vanity_pvc_wardrobe_entry',
  'mb_vanity_pvc_service_chase',
]);

export interface FurniturePlacement {
  x: number;
  z: number;
  wallId?: string;
  wallSide?: WallSide;
  anchorAlong?: number;
}

export interface FurniturePlacementResolution {
  /** 解析出的平面位置。count-only 条目（无任何定位声明）为 null——预期跳过，非失败。 */
  placement: FurniturePlacement | null;
  /** 定位声明存在但解析失败时的诊断文本（断引用/越界/负净宽/声明互斥等）。 */
  diagnostic?: string;
}

/** 摆位解算可见的最小条目形态（house.yaml FurnishingItem 的定位相关子集）。 */
export type PlacementItem = Pick<FurnishingItem,
  | 'type' | 'id' | 'rotation' | 'wall' | 'wall_side' | 'along' | 'x' | 'z'
  | 'wall_clearance' | 'width' | 'depth' | 'length' | 'vanity_layout' | 'mount' | 'anchor'>;

/**
 * 锚点派生摆位的上下文（issue #98 PR-10）：`anchor: {source, id}` 声明按来源解析。
 * 缺失即诊断失败——取不到值时禁止静默发明坐标（与预算三层架构「不许 ?? default」同口径）。
 */
export interface PlacementAnchors {
  /** config/hvac.yaml `diagram.anchors`（id → 平面位置），供 `anchor: {source: 'hvac'}` 引用。 */
  hvacAnchors?: ReadonlyMap<string, { x: number; z: number }>;
  /** 主卫冷凝链派生几何（shared/condensate-chain.ts 解出），供 `anchor: {source: 'chain'}` 引用。 */
  condensateChain?: CondensateChainGeometry;
}

/** 链上可引用的锚点名 → geometry.points 键（house.yaml 写名字，不写坐标）。 */
const CHAIN_ANCHOR_POINT_IDS: Record<string, keyof CondensateChainGeometry['points']> = {
  unit: 'unit',
  box_turn: 'boxTurn',
  wardrobe_east_band: 'wardrobeEastBand',
};

/** 墙段最小形态（ ChainWallLike 与之同构，供链模块共用）。 */
export type WallLike = { x1: number; z1: number; x2: number; z2: number };

const WALL_SIDES: readonly WallSide[] = ['north', 'south', 'east', 'west'];

/**
 * 主卫柜组端部收口特例：两端贴死的柜组允许 20mm 丈量余量（与原 verify 本地复算同值）。
 * 注意这是「丈量余量」，不是 along 语义特例——along 本身一律沿墙距离，见 resolveItem。
 */
const MB_VANITY_ENDPOINT_TOLERANCE_TYPES: ReadonlySet<string> = new Set([
  'mb_vanity_base_cabinet',
  'mb_vanity_lower_board',
  'mb_vanity_main_board',
]);

/**
 * along 合法域的数值容差：客卫台盆柜「两端贴死 0 容差」的设计值恰好落在墙段边界上
 * （along 0.405 = 墙长 0.75 − 柜半宽 0.345），二进制下 0.75−0.345 与字面 0.405 差 1e-17，
 * 无容差会误判越界。1µm 对施工无意义，仅消浮点噪声。
 */
const ALONG_FIT_EPS = 1e-6;

/** 当前唯一受支持的挂载槽位：机器人仓（贴柜体北端，见 resolveVanityLayout）。 */
const MOUNT_SLOTS: readonly string[] = ['robot_bay'];

/**
 * 行内声明 / vanity_layout / 目录三源合一的平面外框（不含 kitchen run 的台面外伸 0.04，
 * 那是 verify AABB 的包络口径，DXF 按 carcass 出口径，两者刻意保持差异）。
 * 优先级：vanity_layout（柜体分割唯一声明源）> 行内 width/depth > FURNITURE_DIMS 目录。
 */
export function declaredFurnitureDims(item: PlacementItem): { width: number | undefined; depth: number | undefined } {
  if (item.type === 'vanity' && item.vanity_layout !== undefined) {
    return { width: item.vanity_layout.width, depth: item.vanity_layout.depth };
  }
  const dims = FURNITURE_DIMS[item.type];
  return { width: item.width ?? dims?.width, depth: item.depth ?? dims?.depth };
}

/** length 型家具：3D buildFurniture 对这三类按 item.length 建模（连续柜/桥接台面/洁柜侧柜），不咨询目录宽度。 */
const LENGTH_BASED_FURNITURE_TYPES: ReadonlySet<string> = new Set([
  'kitchen_cabinet_run',
  'kitchen_countertop_bridge',
  'bath_side_cabinet',
]);

/**
 * 家具平面外包络尺寸（3D buildFurniture 同优先级，codex 十六审 major）：
 * length 型声明了 length 时外框 = length（显式声明优先于目录宽，否则与 3D 实际建模不一致）；
 * 其余类型走 declaredFurnitureDims（行内 > 目录；vanity 走 vanity_layout）。
 */
export function furnitureFootprint(item: PlacementItem): { width: number | undefined; depth: number | undefined } {
  if (LENGTH_BASED_FURNITURE_TYPES.has(item.type) && item.length !== undefined) {
    return { width: item.length, depth: item.depth ?? FURNITURE_DIMS[item.type]?.depth };
  }
  return declaredFurnitureDims(item);
}

/** 按稳定对象 id 索引全部条目，供 mount 宿主查找；id 缺失的条目不进索引。 */
export function furnitureHostIndex(items: Iterable<PlacementItem>): Map<string, PlacementItem> {
  const index = new Map<string, PlacementItem>();
  for (const item of items) {
    if (item.id !== undefined && !index.has(item.id)) index.set(item.id, item);
  }
  return index;
}

/**
 * 解出客卫台盆柜（type:'vanity'）布局：声明缺失或尺寸非法即失败——取不到值时禁止静默
 * 发明默认值（预算三层架构铁律），调用方（3D 建模 / 挂位解算 / DXF 外框）共用这一份。
 */
export function resolveVanityLayout(
  decl: VanityLayoutDecl | undefined,
): { ok: true; layout: VanityLayout } | { ok: false; diagnostic: string } {
  if (decl === undefined) {
    return { ok: false, diagnostic: 'vanity 缺少 vanity_layout 声明（width/depth/height/robot_bay_width/robot_bay_clear_width/panel_thickness）' };
  }
  const fields: Array<[string, number]> = [
    ['width', decl.width],
    ['depth', decl.depth],
    ['height', decl.height],
    ['robot_bay_width', decl.robot_bay_width],
    ['robot_bay_clear_width', decl.robot_bay_clear_width],
    ['panel_thickness', decl.panel_thickness],
  ];
  for (const [name, value] of fields) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return { ok: false, diagnostic: `vanity_layout.${name} 必须为正数（现为 ${String(value)}）` };
    }
  }
  const drawerWidth = decl.width - decl.robot_bay_width;
  if (drawerWidth <= 0) {
    return {
      ok: false,
      diagnostic: `vanity_layout 剩余尺寸为负：width ${decl.width} − robot_bay_width ${decl.robot_bay_width} = ${drawerWidth.toFixed(3)}m（抽屉区宽度必须 > 0）`,
    };
  }
  const bayInterior = decl.robot_bay_width - 2 * decl.panel_thickness;
  if (decl.robot_bay_clear_width > bayInterior + 1e-9) {
    return {
      ok: false,
      diagnostic: `vanity_layout.robot_bay_clear_width ${decl.robot_bay_clear_width} 超过仓区内腔 ${bayInterior.toFixed(3)}m（= robot_bay_width − 2×panel_thickness）`,
    };
  }
  return { ok: true, layout: { ...decl, drawer_width: drawerWidth } };
}

export function resolveFurniturePlacement(
  item: PlacementItem,
  wallSegments: Map<string, WallLike[]>,
  hosts?: ReadonlyMap<string, PlacementItem>,
  anchors?: PlacementAnchors,
): FurniturePlacementResolution {
  return resolveItem(item, wallSegments, hosts, anchors, new Set<string>());
}

function resolveItem(
  item: PlacementItem,
  wallSegments: Map<string, WallLike[]>,
  hosts: ReadonlyMap<string, PlacementItem> | undefined,
  anchors: PlacementAnchors | undefined,
  visited: ReadonlySet<string>,
): FurniturePlacementResolution {
  // 柜体分割声明先行校验：vanity 自身与挂它的家具都靠这份解果，缺声明/负净宽在此显形。
  if (item.type === 'vanity') {
    const layout = resolveVanityLayout(item.vanity_layout);
    if (!layout.ok) return { placement: null, diagnostic: layout.diagnostic };
  }

  const hasWallAnchor = item.wall !== undefined || item.wall_side !== undefined || item.along !== undefined;
  const hasAbsolute = item.x !== undefined || item.z !== undefined;

  if (item.mount !== undefined) {
    if (item.anchor !== undefined) {
      return { placement: null, diagnostic: 'mount 与 anchor 不得同时声明（定位来源必须唯一）' };
    }
    if (hasAbsolute) {
      return { placement: null, diagnostic: 'mount 与绝对 x/z 不得同时声明（世界坐标由宿主槽位推出，禁写第二来源）' };
    }
    if (hasWallAnchor) {
      return { placement: null, diagnostic: 'mount 与 wall/wall_side/along 不得同时声明（定位来源必须唯一）' };
    }
    return resolveMounted(item, wallSegments, hosts, anchors, visited);
  }

  if (item.anchor !== undefined) {
    if (hasAbsolute) {
      return { placement: null, diagnostic: 'anchor 与绝对 x/z 不得同时声明（世界坐标由锚点推出，禁写第二来源）' };
    }
    if (hasWallAnchor) {
      return { placement: null, diagnostic: 'anchor 与 wall/wall_side/along 不得同时声明（定位来源必须唯一）' };
    }
    return resolveAnchored(item, anchors);
  }

  if (hasWallAnchor) {
    if (item.wall === undefined || item.wall_side === undefined || item.along === undefined) {
      return { placement: null, diagnostic: 'wall anchor requires wall, wall_side, and along' };
    }
    const wall = wallSegments.get(item.wall)?.[0];
    if (!wall) {
      return { placement: null, diagnostic: `wall "${item.wall}" not found` };
    }
    if (!WALL_SIDES.includes(item.wall_side)) {
      return { placement: null, diagnostic: `invalid wall_side "${String(item.wall_side)}"` };
    }
    const dx = wall.x2 - wall.x1;
    const dz = wall.z2 - wall.z1;
    const length = Math.hypot(dx, dz);
    if (length <= 1e-9) {
      return { placement: null, diagnostic: `wall "${item.wall}" has zero length` };
    }
    const dims = declaredFurnitureDims(item);
    if (dims.width === undefined || dims.depth === undefined) {
      return { placement: null, diagnostic: `no width/depth for type "${item.type}"（行内声明与 FURNITURE_DIMS 目录均缺，无法定位）` };
    }
    // along 合法域 = 墙段内缩家具半宽——整件必须落在墙段上。
    // 该校验原为 verify-furniture-placement 的本地复算，PR-3 迁到共享解算：3D/DXF 与
    // verify 从此同一口径，越界返回诊断而非静默跳过。
    //
    // along 语义唯一：从墙段起点顶点（x1,z1）沿墙向到锚点的距离，与 overlay.yaml
    // wall_region/paint_region 的 along 区间同一口径。2026-11-07（issue #98）删除了
    // w_mbath_east / w_mb_east 上「along = 绝对 z」的历史分支（原 ABSOLUTE_ALONG_WALLS）
    // 及其配套的 mb_vanity_pvc_box 半宽豁免与 alongStart=3.10 域收窄——那套只在绝对 z
    // 域里自洽，换成沿墙距离后会把这批墙的合法域算错。受影响条目（mb_vanity_base_cabinet /
    // mb_vanity_lower_board / mb_vanity_main_board along 3.61→2.51、mb_vanity_pvc_box
    // 3.70→2.60）已按同一世界位置改写为沿墙距离，几何零漂移（export:dxf 产物逐字节一致）；
    // 此后这些墙上 along 越界一律走本条诊断，由页面报告 / DXF 失败 / verify:furniture 显形。
    const alongHalf = dims.width / 2;
    const endpointTolerance = MB_VANITY_ENDPOINT_TOLERANCE_TYPES.has(item.type)
      && (item.wall === 'w_mbath_east' || item.wall === 'w_mb_east') ? 0.02 : 0;
    if (item.along < alongHalf - endpointTolerance - ALONG_FIT_EPS
      || item.along > length - alongHalf + endpointTolerance + ALONG_FIT_EPS) {
      return {
        placement: null,
        diagnostic: `wall anchor along=${item.along} places furniture outside wall span [${alongHalf.toFixed(3)}, ${(length - alongHalf).toFixed(3)}] on "${item.wall}"`,
      };
    }
    const tangent = { x: dx / length, z: dz / length };
    const left = { x: -tangent.z, z: tangent.x };
    const sideDirection: Record<WallSide, { x: number; z: number }> = {
      north: { x: 0, z: -1 },
      south: { x: 0, z: 1 },
      east: { x: 1, z: 0 },
      west: { x: -1, z: 0 },
    };
    const authored = sideDirection[item.wall_side];
    const right = { x: -left.x, z: -left.z };
    const normal = left.x * authored.x + left.z * authored.z >= right.x * authored.x + right.z * authored.z ? left : right;
    const wallPoint = { x: wall.x1 + tangent.x * item.along, z: wall.z1 + tangent.z * item.along };
    // 墙线基准（2026-11-06 业主口径 A）：所有 wall/wall_side/along 家具一律从完成面
    // （线 ± WALL_THICKNESS/2）起算，不再按家具类型区分——原「仅 4 个 mb_vanity 类型
    // 加半墙厚」的类型清单已删（同墙镜柜曾按线=完成面贴线、穿渲染墙盒 0.06）。
    // 主体再按 authored 施工余量离开完成面，校验与预演共用同一摆位基准。
    const finishOffset = WALL_THICKNESS / 2;
    const wallClearance = item.wall_clearance ?? 0;
    const centerOffset = finishOffset + wallClearance + dims.depth / 2;
    return {
      placement: {
        x: wallPoint.x + normal.x * centerOffset,
        z: wallPoint.z + normal.z * centerOffset,
        wallId: item.wall,
        wallSide: item.wall_side,
        anchorAlong: item.along,
      },
    };
  }

  if (hasAbsolute) {
    if (CONDENSATE_CHAIN_FURNITURE_TYPES.includes(item.type as (typeof CONDENSATE_CHAIN_FURNITURE_TYPES)[number])) {
      // 被替代的旧机制（issue #98 PR-10）：三件冷凝链家具的绝对 x/z 已废，接口坐标改由
      // 共同锚点单一解算。这里见一份手写坐标即失败，防止第二份坐标源静默回来。
      return {
        placement: null,
        diagnostic: `${item.type} 摆位改锚点派生：绝对 x/z 已废，改声明 anchor（outlet → {source: hvac, id: indoor_master}；wardrobe_entry / service_chase → {source: chain, id: wardrobe_east_band}）`,
      };
    }
    if (item.x === undefined || item.z === undefined) {
      return { placement: null, diagnostic: 'absolute placement requires both x and z' };
    }
    return { placement: { x: item.x, z: item.z } };
  }

  // count-only 条目：只喂预算/库存，无平面几何（AGENTS.md furnishings 口径）。
  return { placement: null };
}

function resolveMounted(
  item: PlacementItem,
  wallSegments: Map<string, WallLike[]>,
  hosts: ReadonlyMap<string, PlacementItem> | undefined,
  anchors: PlacementAnchors | undefined,
  visited: ReadonlySet<string>,
): FurniturePlacementResolution {
  const mount = item.mount!;
  if (!MOUNT_SLOTS.includes(mount.slot)) {
    return { placement: null, diagnostic: `unknown mount slot "${mount.slot}"（当前仅支持 ${MOUNT_SLOTS.join('/')}）` };
  }
  const hostId = mount.furniture_id;
  if (visited.has(hostId)) {
    return { placement: null, diagnostic: `mount 循环依赖：${[...visited, hostId].join(' -> ')}` };
  }
  const host = hosts?.get(hostId);
  if (!host) {
    return { placement: null, diagnostic: `mount host "${hostId}" not found in furnishings（断引用：宿主条目缺失或未声明稳定 id）` };
  }
  const hostResolved = resolveItem(host, wallSegments, hosts, anchors, new Set([...visited, hostId]));
  if (hostResolved.diagnostic !== undefined) {
    return { placement: null, diagnostic: `mount host "${hostId}": ${hostResolved.diagnostic}` };
  }
  if (!hostResolved.placement) {
    return { placement: null, diagnostic: `mount host "${hostId}" has no planar placement（count-only 条目不能当宿主）` };
  }
  if (host.type !== 'vanity') {
    return { placement: null, diagnostic: `mount slot "${mount.slot}" 只在 vanity 宿主上有定义，宿主 "${hostId}" 是 "${host.type}"` };
  }
  const hostLayout = resolveVanityLayout(host.vanity_layout);
  if (!hostLayout.ok) {
    return { placement: null, diagnostic: `mount host "${hostId}": ${hostLayout.diagnostic}` };
  }
  const mountedDepth = item.depth ?? FURNITURE_DIMS[item.type]?.depth;
  if (mountedDepth === undefined) {
    return { placement: null, diagnostic: `mounted furniture "${item.type}" has no depth（行内或目录均缺，无法贴背摆放）` };
  }
  // 槽位在宿主局部系中声明（local +x = 沿墙、local +z = 柜前），再按宿主 rotation 转世界。
  // robot_bay：沿墙方向取仓区中心（贴北端），进深方向背沿贴柜体背板 + 自身半深。
  const layout = hostLayout.layout;
  const localX = -layout.width / 2 + layout.robot_bay_width / 2;
  const localZ = -layout.depth / 2 + mountedDepth / 2;
  const theta = ((host.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    placement: {
      x: hostResolved.placement.x + localX * cos + localZ * sin,
      z: hostResolved.placement.z - localX * sin + localZ * cos,
    },
  };
}

/**
 * 锚点派生解算（issue #98 PR-10）：位置来自另一份配置的锚点对象，不写绝对坐标。
 * hvac 锚点（indoor_master 等）与链上点（unit / box_turn / wardrobe_east_band）
 * 都由调用方预解后随上下文传入——resolver 自己不读配置文件，保持纯函数。
 */
function resolveAnchored(item: PlacementItem, anchors: PlacementAnchors | undefined): FurniturePlacementResolution {
  const anchor = item.anchor!;
  if (anchor.source === 'hvac') {
    const position = anchors?.hvacAnchors?.get(anchor.id);
    if (!position) {
      return {
        placement: null,
        diagnostic: `anchor "${anchor.id}" 解析失败：hvacAnchors 上下文缺失，或 config/hvac.yaml anchors 里没有该 id（断引用）`,
      };
    }
    return { placement: { x: position.x, z: position.z } };
  }
  const chain = anchors?.condensateChain;
  if (!chain) {
    return {
      placement: null,
      diagnostic: `anchor chain:${anchor.id} 解析失败：condensateChain 上下文缺失（链几何未随解算提供，见 shared/condensate-chain.ts）`,
    };
  }
  const pointKey = CHAIN_ANCHOR_POINT_IDS[anchor.id];
  if (!pointKey) {
    return {
      placement: null,
      diagnostic: `unknown chain anchor point "${anchor.id}"（当前支持 ${Object.keys(CHAIN_ANCHOR_POINT_IDS).join(' / ')}）`,
    };
  }
  const point = chain.points[pointKey];
  return { placement: { x: point.x, z: point.z } };
}
