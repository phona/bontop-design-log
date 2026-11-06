/**
 * 主卫冷凝水遮蔽链的锚点派生几何（issue #98 PR-10）。
 *
 * 由来：三件协调示意家具（condensate_pipe_ac_outlet / mb_vanity_pvc_wardrobe_entry /
 * mb_vanity_pvc_service_chase）原先各自手写绝对 x/z——outlet (3.70,5.10)、
 * wardrobe_entry (4.10,4.62)、service_chase (2.925,4.62)。同一个接口坐标在
 * house.yaml 注释、FixtureFactory 配方零件长度、mep-hvac-coordination.yaml 的 via
 * 点里各写一份：改一段（挪衣柜、改穿墙点）另一段不跟随，三处静默漂移。
 *
 * 本模块把整条链收敛到**一份锚点解算**，链上每个点只由锚点算出一次：
 *
 *   ac_master 内机锚点（hvac.yaml `indoor_master` → ceiling `ac_master`）
 *     → 空调盒东转点（w_mb_east 卧室侧完成面 − 40mm）
 *     → 衣柜顶服务带（通顶衣柜东缘 × 服务带 z）
 *     → 墙行管心（w_mbath_east 西完成面 − 40mm）
 *     → 折点（MEP `condensate-master` 穿墙点 x × 墙行南端 z）
 *     → 候选接入点（hvac.yaml terminal `condensate_master_candidate`）
 *
 * 家具链是遮蔽构造、MEP 是管：本模块只读引用 MEP 的穿墙点，不改线（改线是设计
 * 决定，既有先例见 `condensate-living-dining-trunk` 与机器人仓冲突的登记口径）。
 *
 * 消费方（同一份 geometry，不各自复录坐标）：
 * - shared/furniture-placement.ts：三件家具的摆位原点；
 * - shared/render/FixtureFactory.ts：配方零件位置（原写死长度改为按几何算）；
 * - scripts/verify/placement/verify-furniture-placement.ts：段接口与 MEP 对照诊断。
 */

import { declaredFurnitureDims, resolveFurniturePlacement, WALL_THICKNESS, type PlacementAnchors, type PlacementItem, type WallLike } from './furniture-placement.js';
import { CONDENSATE_CHAIN_FURNITURE_TYPES, type CondensateChainFurnitureType } from './types.js';
import type { HvacDiagram } from './types.js';
import { hvacAnchorPositions, type HvacBuilderSources } from './render/HvacBuilder.js';

export { CONDENSATE_CHAIN_FURNITURE_TYPES };
export type { CondensateChainFurnitureType };

/** 管心距完成面的净距（既有约定：墙行 2.50 = 西完成面 2.54 − 0.04；空调盒转点 4.10 = 卧室侧完成面 4.14 − 0.04）。 */
export const CHAIN_CLEARANCE_FROM_FINISH = 0.04;
/** 衣柜顶服务带管心相对衣柜中心线的北偏（既有声明值 4.62 = 4.59 + 0.03）。 */
export const SERVICE_BAND_OFFSET_Z = 0.03;
/** 检视态管路的示意标高：mep-hvac-coordination.yaml layers 表 condensate 层高（A 区）。 */
export const CHAIN_SCHEMATIC_Y = 2.65;

export interface ChainPoint {
  x: number;
  z: number;
}

/** 墙段最小形态（= furniture-placement.WallLike，解算入口沿用同一形状）。 */
export type ChainWallLike = WallLike;

export interface CondensateChainAnchors {
  /** ac_master 内机锚点平面位置（hvac.yaml `indoor_master`，ref ceiling `ac_master`）。 */
  unit: ChainPoint;
  /** MEP `condensate-master` 在 w_mbath_south 的穿墙点（只读引用）。 */
  penetration: ChainPoint;
  /** hvac.yaml terminal `condensate_master_candidate`（含下引段终点标高 y）。 */
  candidate: ChainPoint & { y: number };
}

export interface CondensateChainGeometry {
  /** 三件家具的摆位原点（锚点派生，替代原绝对 x/z）。 */
  placements: Record<CondensateChainFurnitureType, ChainPoint>;
  /** 链上关键点：段间接口全部由这些点算出，不各自手写。 */
  points: {
    unit: ChainPoint;
    /** 空调盒东转点：outlet 南端 = wardrobe_entry 东端。 */
    boxTurn: ChainPoint;
    /** 衣柜东缘 × 服务带：wardrobe_entry 西端 = service_chase 原点。 */
    wardrobeEastBand: ChainPoint;
    /** 墙行顶（服务带标高）：柜顶下落段起点。 */
    wallRunNorth: ChainPoint;
    /** 墙行包管北端（mb_vanity_pvc_box 摆位解算）：与衣柜南缘的接口在此对照。 */
    wallRunBoxNorth: ChainPoint;
    /** 墙行包管南端 = 折点所在标高。 */
    wallRunSouth: ChainPoint;
    /** 折点：穿墙点 x × 墙行南端 z。 */
    fold: ChainPoint;
    /** 穿墙点正下方、候选点标高处的转角。 */
    foldDrop: ChainPoint;
    penetration: ChainPoint;
    candidate: ChainPoint;
  };
  /** 派生标量（FixtureFactory 配方零件位置用）。 */
  derived: {
    wardrobeEastX: number;
    wardrobeSouthZ: number;
    serviceBandZ: number;
    wallRunX: number;
    wallRunSouthZ: number;
    boxTurnX: number;
    /** w_mbath_south 卧室侧完成面 z（L 形包边收口，既有声明 z=2.92）。 */
    penetrationWallBedroomFinishZ: number;
    candidateY: number;
  };
  /** 平面折线（unit → … → candidate，共 10 点），供与 MEP `condensate-master` 逐点对照。 */
  plan: ChainPoint[];
  /** 段清单（含被 mb_vanity_pvc_box 覆盖的墙行段），供接口诊断。 */
  segments: Array<{ id: string; from: ChainPoint; to: ChainPoint }>;
}

export interface ResolveCondensateChainInput {
  anchors: CondensateChainAnchors;
  /** 通顶衣柜条目（house.yaml `mb.wardrobe_950`）：链的服务带/东缘/南缘都由它派生。 */
  wardrobe: PlacementItem | undefined;
  /** 墙行包管条目（house.yaml `mb.vanity_pvc_box`）：墙行侧向（wall_side）与南端（折点 z）由它派生。 */
  wallRun: PlacementItem | undefined;
  wallSegments: Map<string, ChainWallLike[]>;
  hosts?: ReadonlyMap<string, PlacementItem>;
}

/** 竖直墙的「链所在侧」完成面 x：链（衣柜/管行）在墙的哪一侧就取哪侧完成面。 */
function finishXOnChainSide(wall: ChainWallLike, chainX: number): number {
  const lineX = Math.abs(wall.x2 - wall.x1) < 1e-9 ? wall.x1 : (wall.x1 + wall.x2) / 2;
  return chainX < lineX ? lineX - WALL_THICKNESS / 2 : lineX + WALL_THICKNESS / 2;
}

/** 竖直墙指定侧的完成面 x（side 语义同 wall_side：west = 取墙线西侧完成面）。 */
function finishXOnSide(wall: ChainWallLike, side: 'west' | 'east'): number {
  const lineX = Math.abs(wall.x2 - wall.x1) < 1e-9 ? wall.x1 : (wall.x1 + wall.x2) / 2;
  return side === 'west' ? lineX - WALL_THICKNESS / 2 : lineX + WALL_THICKNESS / 2;
}

/** 水平墙的「链所在侧」完成面 z（链在墙的哪一侧就取哪侧完成面）。 */
function finishZOnChainSide(wall: ChainWallLike, chainZ: number): number {
  const lineZ = Math.abs(wall.z2 - wall.z1) < 1e-9 ? wall.z1 : (wall.z1 + wall.z2) / 2;
  return chainZ < lineZ ? lineZ - WALL_THICKNESS / 2 : lineZ + WALL_THICKNESS / 2;
}

/**
 * 墙锚家具沿墙方向的 z 跨度（rotation 270/90 时局部 width 沿世界 z，0/180 时局部 depth 沿世界 z）。
 * 与 verify-furniture-placement 的 rotatedDims 同一约定——那份在校验器里，链模块要用同一事实。
 */
function alongWallZSpan(item: PlacementItem, centerZ: number): { north: number; south: number } | null {
  const dims = declaredFurnitureDims(item);
  if (dims.width === undefined || dims.depth === undefined) return null;
  const quarterTurn = Math.round((item.rotation ?? 0) / 90) % 2 !== 0;
  const extent = quarterTurn ? dims.width : dims.depth;
  return { north: centerZ + extent / 2, south: centerZ - extent / 2 };
}

function wallOrDiagnostic(
  wallSegments: Map<string, ChainWallLike[]>,
  wallId: string,
  diagnostics: string[],
): ChainWallLike | undefined {
  const wall = wallSegments.get(wallId)?.[0];
  if (!wall) diagnostics.push(`condensate chain: wall "${wallId}" not found（链派生需要该墙几何）`);
  return wall;
}

/**
 * 解出主卫冷凝链几何。解析失败（衣柜缺失/断引用、墙缺失、段反向或零长）时
 * geometry 为 null 且 diagnostics 非空——调用方（resolver / SceneBuilder /
 * verify）据此显形，禁止回退到绝对坐标。
 */
export function resolveCondensateChain(
  input: ResolveCondensateChainInput,
): { geometry: CondensateChainGeometry | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const { anchors, wallSegments } = input;

  const wardrobe = input.wardrobe;
  if (wardrobe === undefined) {
    diagnostics.push('condensate chain: 通顶衣柜条目缺失（链的服务带/东缘/南缘无宿主）');
    return { geometry: null, diagnostics };
  }
  const wardrobeResolved = resolveFurniturePlacement(wardrobe, wallSegments, input.hosts);
  if (wardrobeResolved.diagnostic !== undefined) {
    diagnostics.push(`condensate chain: 宿主衣柜 "${String(wardrobe.id)}": ${wardrobeResolved.diagnostic}`);
    return { geometry: null, diagnostics };
  }
  if (!wardrobeResolved.placement) {
    diagnostics.push(`condensate chain: 宿主衣柜 "${String(wardrobe.id)}" 无平面摆位（count-only 条目不能当宿主）`);
    return { geometry: null, diagnostics };
  }
  const wardrobeDims = declaredFurnitureDims(wardrobe);
  if (wardrobeDims.width === undefined || wardrobeDims.depth === undefined) {
    diagnostics.push(`condensate chain: 宿主衣柜 "${String(wardrobe.id)}" 缺 width/depth（行内与目录均无，东缘/南缘算不出）`);
    return { geometry: null, diagnostics };
  }

  const mbEast = wallOrDiagnostic(wallSegments, 'w_mb_east', diagnostics);
  const mbathEast = wallOrDiagnostic(wallSegments, 'w_mbath_east', diagnostics);
  const mbathSouth = wallOrDiagnostic(wallSegments, 'w_mbath_south', diagnostics);
  if (!mbEast || !mbathEast || !mbathSouth) return { geometry: null, diagnostics };

  const wallRunBox = input.wallRun;
  if (wallRunBox === undefined) {
    diagnostics.push('condensate chain: 墙行包管条目缺失（mb.vanity_pvc_box：墙行侧向与折点 z 的宿主）');
    return { geometry: null, diagnostics };
  }
  if (wallRunBox.wall !== 'w_mbath_east' || wallRunBox.wall_side !== 'west') {
    diagnostics.push(`condensate chain: 墙行包管 "${String(wallRunBox.id)}" 必须声明 wall=w_mbath_east / wall_side=west（管行在西完成面内侧 40mm，不穿墙）`);
    return { geometry: null, diagnostics };
  }
  const wallRunResolved = resolveFurniturePlacement(wallRunBox, wallSegments, input.hosts);
  if (wallRunResolved.diagnostic !== undefined) {
    diagnostics.push(`condensate chain: 墙行包管 "${String(wallRunBox.id)}": ${wallRunResolved.diagnostic}`);
    return { geometry: null, diagnostics };
  }
  if (!wallRunResolved.placement) {
    diagnostics.push(`condensate chain: 墙行包管 "${String(wallRunBox.id)}" 无平面摆位`);
    return { geometry: null, diagnostics };
  }
  const wallRunSpan = alongWallZSpan(wallRunBox, wallRunResolved.placement.z);
  if (!wallRunSpan) {
    diagnostics.push(`condensate chain: 墙行包管 "${String(wallRunBox.id)}" 缺 width/depth（沿墙跨度算不出）`);
    return { geometry: null, diagnostics };
  }

  const wardrobeCenter = wardrobeResolved.placement;
  const wardrobeEastX = wardrobeCenter.x + wardrobeDims.width / 2;
  const wardrobeSouthZ = wardrobeCenter.z - wardrobeDims.depth / 2;
  const serviceBandZ = wardrobeCenter.z + SERVICE_BAND_OFFSET_Z;

  // 空调盒东转点：卧室侧完成面再退 40mm（与墙行同一条净距约定）。
  const boxTurnX = finishXOnChainSide(mbEast, wardrobeEastX) - CHAIN_CLEARANCE_FROM_FINISH;
  // 墙行管心：w_mbath_east 西完成面再退 40mm（不穿墙）——侧向由墙行包管的 wall_side 声明。
  const wallRunX = finishXOnSide(mbathEast, 'west') - CHAIN_CLEARANCE_FROM_FINISH;
  // 折点 z = 墙行包管的南端（mb_vanity_pvc_box 摆位解算，非手写常数）。
  const wallRunSouthZ = wallRunSpan.south;
  // L 形包边收至主卫南墙卧室侧完成面（链在墙北侧 → 北侧完成面）。
  const penetrationWallBedroomFinishZ = finishZOnChainSide(mbathSouth, wallRunSouthZ);

  const points: CondensateChainGeometry['points'] = {
    unit: { x: anchors.unit.x, z: anchors.unit.z },
    boxTurn: { x: boxTurnX, z: serviceBandZ },
    wardrobeEastBand: { x: wardrobeEastX, z: serviceBandZ },
    /** 墙行顶（服务带标高）：柜顶下落段的起点。 */
    wallRunNorth: { x: wallRunX, z: serviceBandZ },
    /** 墙行包管北端（由 mb_vanity_pvc_box 摆位解算）：与衣柜南缘的接口在此对照。 */
    wallRunBoxNorth: { x: wallRunX, z: wallRunSpan.north },
    wallRunSouth: { x: wallRunX, z: wallRunSouthZ },
    fold: { x: anchors.penetration.x, z: wallRunSouthZ },
    foldDrop: { x: anchors.penetration.x, z: anchors.candidate.z },
    penetration: { x: anchors.penetration.x, z: anchors.penetration.z },
    candidate: { x: anchors.candidate.x, z: anchors.candidate.z },
  };

  const segments: CondensateChainGeometry['segments'] = [
    { id: 'outlet-east', from: points.unit, to: { x: boxTurnX, z: anchors.unit.z } },
    { id: 'outlet-drop', from: { x: boxTurnX, z: anchors.unit.z }, to: points.boxTurn },
    { id: 'wardrobe-entry', from: points.boxTurn, to: points.wardrobeEastBand },
    { id: 'chase-band', from: points.wardrobeEastBand, to: points.wallRunNorth },
    // 柜顶下落段止于**衣柜南缘**（衣柜派生）；其下由 mb_vanity_pvc_box 覆盖。两者不重合
    // （衣柜 z 向移位后包管 along 没跟着改）时接口诊断显形——这正是要的报警。
    { id: 'chase-wall-drop', from: points.wallRunNorth, to: { x: wallRunX, z: wardrobeSouthZ } },
    { id: 'pvc-box-wall-run', from: points.wallRunBoxNorth, to: points.wallRunSouth },
    { id: 'chase-fold-west', from: points.wallRunSouth, to: points.fold },
    { id: 'chase-fold-drop', from: points.fold, to: points.foldDrop },
    { id: 'chase-to-candidate', from: points.foldDrop, to: points.candidate },
  ];

  // 段合法性：每段必须沿声明方向且长度 > 0。锚点相对位置失效（衣柜东缘跑到空调盒转点以东、
  // 穿墙点跑到墙行以东、候选点跑到穿墙点以东……）在这里显形，而不是画出一条反向管。
  const directions: Record<string, 'east' | 'west' | 'south'> = {
    'outlet-east': 'east',
    'outlet-drop': 'south',
    'wardrobe-entry': 'west',
    'chase-band': 'west',
    'chase-wall-drop': 'south',
    'pvc-box-wall-run': 'south',
    'chase-fold-west': 'west',
    'chase-fold-drop': 'south',
    'chase-to-candidate': 'west',
  };
  const INTERFACE_EPS = 1e-6;
  for (const segment of segments) {
    const dx = segment.to.x - segment.from.x;
    const dz = segment.to.z - segment.from.z;
    const expected = directions[segment.id];
    if (expected === 'east' && dx <= INTERFACE_EPS) {
      diagnostics.push(`condensate chain 段 ${segment.id} 非东行或零长：(${segment.from.x.toFixed(3)},${segment.from.z.toFixed(3)})→(${segment.to.x.toFixed(3)},${segment.to.z.toFixed(3)})（接口不重合：锚点相对位置失效）`);
    }
    if (expected === 'west' && dx >= -INTERFACE_EPS) {
      diagnostics.push(`condensate chain 段 ${segment.id} 非西行或零长：(${segment.from.x.toFixed(3)},${segment.from.z.toFixed(3)})→(${segment.to.x.toFixed(3)},${segment.to.z.toFixed(3)})（接口不重合：锚点相对位置失效）`);
    }
    if (expected === 'south' && dz >= -INTERFACE_EPS) {
      diagnostics.push(`condensate chain 段 ${segment.id} 非南行或零长：(${segment.from.x.toFixed(3)},${segment.from.z.toFixed(3)})→(${segment.to.x.toFixed(3)},${segment.to.z.toFixed(3)})（接口不重合：锚点相对位置失效）`);
    }
  }
  // 接口重合：相邻段必须共享端点。单一解算下恒等，这条断言防的是将来把三段拆成
  // 独立解算后静默漂移（接口坐标不再由共同锚点算出时立刻显形）。
  for (let index = 0; index < segments.length - 1; index += 1) {
    const end = segments[index].to;
    const start = segments[index + 1].from;
    if (Math.abs(end.x - start.x) > INTERFACE_EPS || Math.abs(end.z - start.z) > INTERFACE_EPS) {
      diagnostics.push(`condensate chain 接口不重合：段 ${segments[index].id} 终点 (${end.x.toFixed(3)},${end.z.toFixed(3)}) ≠ 段 ${segments[index + 1].id} 起点 (${start.x.toFixed(3)},${start.z.toFixed(3)})`);
    }
  }
  // 段不合法（反向/零长/接口不重合）时整条链作废：几何不给出去，三件链条家具随即可解出
  // 失败并显形——不拿一条断链去摆家具。
  if (diagnostics.length > 0) return { geometry: null, diagnostics };

  // 平面折线（供与 MEP condensate-master 逐点对照）。柜顶下落段止于衣柜南缘、墙行包管起于
  // 自身北端：两者重合时（接口诊断已保证）是同一个折点，去重后与 MEP 的 10 点一一对应。
  const rawPlan: ChainPoint[] = [
    points.unit,
    { x: boxTurnX, z: anchors.unit.z },
    points.boxTurn,
    points.wardrobeEastBand,
    points.wallRunNorth,
    { x: wallRunX, z: wardrobeSouthZ },
    points.wallRunBoxNorth,
    points.wallRunSouth,
    points.fold,
    points.foldDrop,
    points.candidate,
  ];
  const plan = rawPlan.filter((point, index) =>
    index === 0 || Math.hypot(point.x - rawPlan[index - 1].x, point.z - rawPlan[index - 1].z) > 1e-9);

  const geometry: CondensateChainGeometry = {
    placements: {
      condensate_pipe_ac_outlet: points.unit,
      mb_vanity_pvc_wardrobe_entry: points.wardrobeEastBand,
      mb_vanity_pvc_service_chase: points.wardrobeEastBand,
    },
    points,
    derived: {
      wardrobeEastX,
      wardrobeSouthZ,
      serviceBandZ,
      wallRunX,
      wallRunSouthZ,
      boxTurnX,
      penetrationWallBedroomFinishZ,
      candidateY: anchors.candidate.y,
    },
    plan,
    segments,
  };
  return { geometry, diagnostics };
}

/**
 * 家具链 ↔ MEP `condensate-master` 平面折线逐点对照（x/z，不含标高）。
 *
 * 家具链是遮蔽构造、MEP 是管，两者平面必须对应。不一致处**不自动改线**（改线是设计
 * 决定）：由 verify 显形为 error，处置方式沿用 `condensate-living-dining-trunk` 与
 * 机器人仓冲突那条——带 owner 与触发条件登记，量房/会审日再裁。
 */
export function diffCondensateChainPlanAgainstMep(
  chainPlan: readonly ChainPoint[],
  mepPlan: readonly ChainPoint[],
  toleranceM = 0.005,
): string[] {
  const findings: string[] = [];
  if (chainPlan.length !== mepPlan.length) {
    findings.push(`condensate chain ↔ MEP condensate-master 折点点数不一致：链 ${chainPlan.length} 点 vs MEP ${mepPlan.length} 点（改线后须重跑对照）`);
    return findings;
  }
  chainPlan.forEach((point, index) => {
    const other = mepPlan[index];
    const delta = Math.hypot(point.x - other.x, point.z - other.z);
    if (delta > toleranceM) {
      findings.push(`condensate chain ↔ MEP condensate-master 第 ${index + 1} 个折点不重合：链 (${point.x.toFixed(3)},${point.z.toFixed(3)}) vs MEP (${other.x.toFixed(3)},${other.z.toFixed(3)})，差 ${(delta * 1000).toFixed(0)}mm`);
    }
  });
  return findings;
}

// ── 锚点提取（消费方只读配置，提取口径全仓只此一份） ──────────────────────

/** MEP 路线里穿墙声明的最小形态（结构同 MepRoute.penetration；schema 里是 unknown，故运行时校验）。 */
export interface MepRoutePenetrationLike {
  penetration?: unknown;
}

/**
 * 从 MEP 路线取出指定墙的穿墙点（x/z）。
 * `penetration` 在 schema 里是 `z.unknown()`（穿墙声明由 lint 另行校验），这里做运行时
 * 形状检查：取不到就返回 undefined，由调用方显形，不猜坐标。
 */
export function mepPenetrationAt(route: MepRoutePenetrationLike | undefined, wallId: string): ChainPoint | undefined {
  if (!Array.isArray(route?.penetration)) return undefined;
  for (const entry of route!.penetration as Array<{ wall?: unknown; at?: unknown }>) {
    if (entry?.wall !== wallId) continue;
    const at = entry.at as { x?: unknown; z?: unknown } | undefined;
    if (at && typeof at.x === 'number' && typeof at.z === 'number') return { x: at.x, z: at.z };
  }
  return undefined;
}

/** hvac terminal 的最小形态（结构同 HvacTerminal）。 */
export interface HvacTerminalLike {
  id: string;
  position?: { x: number; y?: number; z: number };
}

export interface BuildCondensateChainInput {
  /** config/hvac.yaml `diagram.anchors`（id → 平面位置），由 HvacBuilder.hvacAnchorPositions 解出。 */
  hvacAnchors: ReadonlyMap<string, { x: number; z: number }>;
  /** config/hvac.yaml `diagram.terminals`（取 `condensate_master_candidate`）。 */
  hvacTerminals?: readonly HvacTerminalLike[];
  /** MEP `condensate-master` 路线（只读穿墙点，不改线）。 */
  mepRoute?: MepRoutePenetrationLike;
  /** 通顶衣柜条目（house.yaml `mb.wardrobe_950`）。 */
  wardrobe: PlacementItem | undefined;
  /** 墙行包管条目（house.yaml `mb.vanity_pvc_box`）。 */
  wallRun: PlacementItem | undefined;
  wallSegments: Map<string, ChainWallLike[]>;
  hosts?: ReadonlyMap<string, PlacementItem>;
}

/**
 * 从配置数据解出整条链（锚点提取 + 几何派生 + 段诊断）。
 * 任一锚点缺失即 diagnostics 显形、geometry 为 null——不发明坐标、不回退绝对值。
 */
export function buildCondensateChain(
  input: BuildCondensateChainInput,
): { geometry: CondensateChainGeometry | null; diagnostics: string[] } {
  const unit = input.hvacAnchors.get('indoor_master');
  if (!unit) {
    return {
      geometry: null,
      diagnostics: ['condensate chain: hvac 锚点 indoor_master 缺失（config/hvac.yaml anchors → ceiling ac_master），outlet 无锚可挂'],
    };
  }
  const candidate = input.hvacTerminals?.find((terminal) => terminal.id === 'condensate_master_candidate');
  if (!candidate?.position) {
    return {
      geometry: null,
      diagnostics: ['condensate chain: hvac terminal condensate_master_candidate 缺失，链的候选接入点无锚'],
    };
  }
  const penetration = mepPenetrationAt(input.mepRoute, 'w_mbath_south');
  if (!penetration) {
    return {
      geometry: null,
      diagnostics: ['condensate chain: MEP condensate-master 未声明 w_mbath_south 穿墙点，service_chase 的折点无锚'],
    };
  }
  return resolveCondensateChain({
    anchors: {
      unit,
      penetration,
      candidate: { x: candidate.position.x, y: candidate.position.y ?? 0.1, z: candidate.position.z },
    },
    wardrobe: input.wardrobe,
    wallRun: input.wallRun,
    wallSegments: input.wallSegments,
    hosts: input.hosts,
  });
}

/**
 * 摆位锚点上下文（issue #98 PR-10）：把「hvac diagram + MEP 穿墙点 + 衣柜/墙行条目」收敛成
 * `resolveFurniturePlacement` 的第四个参数。SceneBuilder（3D/GLB）、verify:spatial、
 * verify:furniture 共用这一份——三处各自拼上下文必然漂移。
 *
 * 解算失败时 anchors 里**不给** condensateChain（三件链条家具随即可解出失败并显形），
 * diagnostics 由调用方入列。
 */
export function resolveCondensatePlacementAnchors(input: {
  hvacDiagram?: HvacDiagram;
  hvacSources?: HvacBuilderSources;
  penetration?: ChainPoint;
  wardrobe?: PlacementItem;
  wallRun?: PlacementItem;
  wallSegments: Map<string, ChainWallLike[]>;
  hosts?: ReadonlyMap<string, PlacementItem>;
}): { anchors: PlacementAnchors; diagnostics: string[] } {
  const hvacAnchors = input.hvacDiagram ? hvacAnchorPositions(input.hvacDiagram, input.hvacSources ?? {}) : new Map<string, { x: number; z: number }>();
  const chain = buildCondensateChain({
    hvacAnchors,
    hvacTerminals: input.hvacDiagram?.terminals,
    mepRoute: input.penetration ? { penetration: [{ wall: 'w_mbath_south', at: input.penetration }] } : undefined,
    wardrobe: input.wardrobe,
    wallRun: input.wallRun,
    wallSegments: input.wallSegments,
    hosts: input.hosts,
  });
  return {
    anchors: { hvacAnchors, ...(chain.geometry ? { condensateChain: chain.geometry } : {}) },
    diagnostics: chain.diagnostics,
  };
}
