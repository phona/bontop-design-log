/**
 * 吊顶算量子系统（独立于房间面积近似口径）。
 *
 * 背景：`server/budget-calculator.ts` 的 `area: 'ceiling'` 一直按**房间面积**汇总木工人工
 * （11 个房间 bbox ≈ 142.92 ㎡），把没有吊顶的平顶、电梯井、入户花园都计了费。本模块改为
 * 按 `config/ceiling.yaml` 的**逐分区声明**实算，几何口径与
 * `shared/render/CeilingZoneBuilder.ts` 严格一致（同一个圆角/阴角规则），所以
 * 「3D 看到的吊顶」和「算出来的量」永远是同一份数据。
 *
 * 铁律：
 * - **禁止推断**：工艺/计价类别（trade）只能来自 yaml 显式声明，缺失时只按渲染类型回退，
 *   永远不靠 id 命名猜「这是窗帘盒/晾衣架」——归不了的进 `unclassifiedZoneIds` 显形。
 * - **不静默丢弃**：没有 area/thickness 的、几何非法的、无法归类的分区全部进显式清单。
 * - **不四舍五入**：数量保持原始浮点（只有金额才 round，见 budget-calculator.ts），
 *   由调用方/测试用容差断言。
 * - 本模块**不 import three**：server 运行时不需要 WebGL，浏览器与 CLI 共用同一份口径。
 */

import type { CeilingZone } from './types.js';

/** 工艺/计价类别：与渲染类型（drop/integrated/aluminum_buckle）是两回事。 */
export const CEILING_TRADE_CLASSES = ['gypsum_board', 'aluminum_buckle', 'curtain_box', 'drying_rack'] as const;
export type CeilingTradeClass = (typeof CEILING_TRADE_CLASSES)[number];

export const isCeilingTradeClass = (value: unknown): value is CeilingTradeClass =>
  typeof value === 'string' && (CEILING_TRADE_CLASSES as readonly string[]).includes(value);

/** 渲染侧认可的实心吊顶类型；与 CeilingZoneBuilder 的 SOLID_TYPES 同源（此处不 import three）。 */
const SOLID_CEILING_TYPES = new Set(['drop', 'integrated', 'aluminum_buckle']);

const CORNERS = ['nw', 'ne', 'se', 'sw'] as const;
type Corner = (typeof CORNERS)[number];

/** 圆角切掉的材料 = r²(1 − π/4)；阴角加出的材料同形（见 CeilingZoneBuilder 弧心推导）。 */
const CORNER_AREA_K = 1 - Math.PI / 4;

const EPS = 1e-9;

/** 带 eps 的向上取整：1.5/0.3 在浮点下是 5.000000000000001，裸 Math.ceil 会多算一块板。 */
const ceilEps = (value: number): number => Math.ceil(value - EPS);

export interface CeilingTakeoffZone {
  id: string;
  room: string;
  /** 渲染类型（决定几何）：drop / integrated / aluminum_buckle。 */
  type: string;
  /** 工艺/计价类别；无法归类时为 null（并进 unclassifiedZoneIds）。 */
  trade: CeilingTradeClass | null;
  /** trade 来自 yaml 显式声明（true）还是按渲染类型回退（false）。 */
  tradeDeclared: boolean;
  thickness: number;
  /** 完成面标高 = 房间净高 − thickness；与 shared/mep-hvac-lint.ts 的 ceilingSurfaceY 同口径。 */
  bottomY: number;
  /** 轴对齐外框面积（未扣圆角/阴角）。 */
  grossAreaM2: number;
  /** 净面积：外框 − 阳角圆角 + 阴角加料。 */
  netAreaM2: number;
  /** 展开面积 = 净面积 + 周长 × 厚度（施工方对石膏板吊顶常按展开报价）。 */
  expandedAreaM2: number;
  perimeterM: number;
  /** 长边长度：窗帘盒等按延长米计价用。 */
  longSideM: number;
  /** 仅 aluminum_buckle：300×300 分格块数（沿 area 最小角起排，边块现场切割）。 */
  panelCount?: number;
  treatments: { rounds: Record<Corner, number>; fillets: Record<Corner, number> } | null;
}

export interface CeilingTakeoffClassRollup {
  zones: number;
  netAreaM2: number;
  expandedAreaM2: number;
  perimeterM: number;
  linearM: number;
  panelCount: number;
  /** 行业主口径：供报价时逐项列，别把不同单位混一张表。 */
  pricingUnit: 'sqm' | 'linear_m' | 'panel';
}

export interface CeilingTakeoff {
  zones: CeilingTakeoffZone[];
  byRoom: Record<string, number>;
  /** 渲染口径小计（drop / integrated / aluminum_buckle）。 */
  byType: Record<string, number>;
  /** 计价口径小计（gypsum_board / aluminum_buckle / curtain_box / drying_rack）。 */
  byClass: Record<CeilingTradeClass, CeilingTakeoffClassRollup>;
  gypsumBoardM2: number;
  aluminumBuckleM2: number;
  aluminumBucklePanelCount: number;
  curtainBoxM2: number;
  curtainBoxLinearM: number;
  dryingRackM2: number;
  totalNetAreaM2: number;
  totalExpandedAreaM2: number;
  totalPerimeterM: number;
  /** 非实心/缺 area 或缺 thickness 的条目（本项目应只有 ac_indoor）。 */
  excludedIds: string[];
  /** 渲染侧会拒绝（几何非法）的条目——图和数必须同时消失，不能只算不建。 */
  invalidZoneIds: string[];
  /** 归不进任何 trade class 的条目：显形，禁止猜。 */
  unclassifiedZoneIds: string[];
  /** 有吊顶声明的房间 id。 */
  roomIdsWithCeiling: string[];
  /** 传入房间表里没有任何吊顶分区的房间（2.80m 原顶）——证明没有 silently skip。 */
  roomIdsWithoutCeiling: string[];
  /** 声明了但房间不在传入房间表里的分区。 */
  unknownRoomZoneIds: string[];
  /** 平面重叠告警（防重复计费）；贴边相接不算重叠。 */
  overlaps: string[];
  /** 重叠面积合计（㎡）：`totalNetAreaM2` 含这部分重复计费，业主裁定分区边界后归零。 */
  overlapAreaM2: number;
}

export interface CeilingTakeoffRoom {
  id: string;
  height?: number;
}

interface ResolvedTreatment {
  radii: Record<Corner, number>;
  fillets: Record<Corner, number>;
  netAreaM2: number;
  perimeterM: number;
}

/**
 * 与 `CeilingZoneBuilder.resolveCornerRadii` / `resolveConcaveFillets` 同规则地解析角部处理，
 * 并给出解析化的净面积与周长（几何非法返回 null，调用方按「渲染侧也不会有这个分区」处理）。
 */
function resolveTreatment(
  x1: number, z1: number, x2: number, z2: number,
  cornerRadius: number | undefined,
  cornerRadii: Partial<Record<Corner, number>> | undefined,
  concaveFillets: Partial<Record<Corner, number>> | undefined,
): ResolvedTreatment | null {
  const width = Math.abs(x2 - x1);
  const depth = Math.abs(z2 - z1);
  if (!(width > 0) || !(depth > 0)) return null;
  const radii: Record<Corner, number> = { nw: 0, ne: 0, se: 0, sw: 0 };
  const fillets: Record<Corner, number> = { nw: 0, ne: 0, se: 0, sw: 0 };
  for (const corner of CORNERS) {
    const declaredRound = cornerRadii?.[corner] ?? cornerRadius ?? 0;
    const declaredFillet = concaveFillets?.[corner] ?? 0;
    if (!Number.isFinite(declaredRound) || declaredRound < 0) return null;
    if (!Number.isFinite(declaredFillet) || declaredFillet < 0) return null;
    // 同一个角不能既要阳角圆角又要阴角加料（与 builder 的 resolveConcaveFillets 一致）。
    if (declaredRound > 0 && declaredFillet > 0) return null;
    if (declaredRound > Math.min(width, depth) / 2 + EPS) return null;
    if (declaredFillet > Math.min(width, depth) / 2 + EPS) return null;
    radii[corner] = declaredRound;
    fillets[corner] = declaredFillet;
  }
  // 共享一条边的两个角部处理不能吃掉整条边（与 builder 的 edge budget 检查一致）。
  const edges: Array<[Corner, Corner, number]> = [
    ['sw', 'se', width], ['se', 'ne', depth], ['ne', 'nw', width], ['nw', 'sw', depth],
  ];
  for (const [a, b, length] of edges) {
    const consumedA = fillets[a] > 0 ? fillets[a] : radii[a];
    const consumedB = fillets[b] > 0 ? fillets[b] : radii[b];
    if (consumedA + consumedB > length + EPS) return null;
  }

  let netAreaM2 = width * depth;
  let perimeterM = 2 * (width + depth);
  for (const corner of CORNERS) {
    const r = radii[corner];
    const f = fillets[corner];
    if (r > 0) {
      // 阳角：切掉 r²(1 − π/4)，两条邻边各短 r，换成 πr/2 的弧。
      netAreaM2 -= r * r * CORNER_AREA_K;
      perimeterM += -2 * r + (Math.PI * r) / 2;
    }
    if (f > 0) {
      // 阴角：加料 f²(1 − π/4)，两条邻边各长出 f，换成 πf/2 的弧。
      netAreaM2 += f * f * CORNER_AREA_K;
      perimeterM += 2 * f + (Math.PI * f) / 2;
    }
  }
  return { radii, fillets, netAreaM2, perimeterM };
}

function resolveTrade(zone: CeilingZone): { trade: CeilingTradeClass | null; declared: boolean } {
  if (typeof zone.trade === 'string') {
    return isCeilingTradeClass(zone.trade)
      ? { trade: zone.trade, declared: true }
      // schema 会拦住错字；这里不猜，直接显形。
      : { trade: null, declared: true };
  }
  if (zone.type === 'aluminum_buckle') return { trade: 'aluminum_buckle', declared: false };
  if (zone.type === 'drop' || zone.type === 'integrated') return { trade: 'gypsum_board', declared: false };
  return { trade: null, declared: false };
}

function emptyClassRollup(unit: 'sqm' | 'linear_m' | 'panel'): CeilingTakeoffClassRollup {
  return { zones: 0, netAreaM2: 0, expandedAreaM2: 0, perimeterM: 0, linearM: 0, panelCount: 0, pricingUnit: unit };
}

/**
 * 按 `config/ceiling.yaml`（或任何同 shape 的 CeilingZone[]）实算吊顶工程量。
 * `rooms` 只用于完成面标高与「哪些房间没有吊顶」的对照，可省略（默认净高 2.8m）。
 */
export function computeCeilingTakeoff(zones: CeilingZone[], rooms?: CeilingTakeoffRoom[]): CeilingTakeoff {
  const roomHeights = new Map<string, number>();
  for (const room of rooms ?? []) {
    if (typeof room?.id === 'string' && typeof room.height === 'number') roomHeights.set(room.id, room.height);
  }

  const result: CeilingTakeoff = {
    zones: [],
    byRoom: {},
    byType: {},
    byClass: {
      gypsum_board: emptyClassRollup('sqm'),
      aluminum_buckle: emptyClassRollup('panel'),
      curtain_box: emptyClassRollup('linear_m'),
      drying_rack: emptyClassRollup('sqm'),
    },
    gypsumBoardM2: 0,
    aluminumBuckleM2: 0,
    aluminumBucklePanelCount: 0,
    curtainBoxM2: 0,
    curtainBoxLinearM: 0,
    dryingRackM2: 0,
    totalNetAreaM2: 0,
    totalExpandedAreaM2: 0,
    totalPerimeterM: 0,
    excludedIds: [],
    invalidZoneIds: [],
    unclassifiedZoneIds: [],
    roomIdsWithCeiling: [],
    roomIdsWithoutCeiling: [],
    unknownRoomZoneIds: [],
    overlaps: [],
    overlapAreaM2: 0,
  };
  const solid: Array<{ zone: CeilingZone; x1: number; z1: number; x2: number; z2: number; width: number; depth: number; measured: CeilingTakeoffZone }> = [];

  for (const zone of [...zones].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!SOLID_CEILING_TYPES.has(zone.type) || zone.area === undefined || zone.thickness === undefined) {
      result.excludedIds.push(zone.id);
      continue;
    }
    const [x1, z1, x2, z2] = zone.area;
    const width = Math.abs(x2 - x1);
    const depth = Math.abs(z2 - z1);
    const { trade, declared } = resolveTrade(zone);
    if (trade === null) result.unclassifiedZoneIds.push(zone.id);

    const treatment = resolveTreatment(x1, z1, x2, z2, zone.corner_radius, zone.corner_radii, zone.concave_fillets);
    if (!treatment) {
      // 渲染侧返回 null → 场景里没有这个分区，算量也不能有。
      result.invalidZoneIds.push(zone.id);
      continue;
    }
    if (!(zone.thickness > 0)) {
      result.invalidZoneIds.push(zone.id);
      continue;
    }

    const netAreaM2 = treatment.netAreaM2;
    const entry: CeilingTakeoffZone = {
      id: zone.id,
      room: zone.room,
      type: zone.type,
      trade,
      tradeDeclared: declared,
      thickness: zone.thickness,
      bottomY: (roomHeights.get(zone.room) ?? 2.8) - zone.thickness,
      grossAreaM2: width * depth,
      netAreaM2,
      expandedAreaM2: netAreaM2 + treatment.perimeterM * zone.thickness,
      perimeterM: treatment.perimeterM,
      longSideM: Math.max(width, depth),
      treatments: { rounds: treatment.radii, fillets: treatment.fillets },
    };
    if (zone.type === 'aluminum_buckle' && zone.buckle_panel) {
      const module = zone.buckle_panel.module;
      if (Number.isFinite(module) && module > 0) {
        entry.panelCount = ceilEps(width / module) * ceilEps(depth / module);
      }
    }

    result.zones.push(entry);
    result.totalNetAreaM2 += netAreaM2;
    result.totalExpandedAreaM2 += entry.expandedAreaM2;
    result.totalPerimeterM += treatment.perimeterM;
    result.byType[zone.type] = (result.byType[zone.type] ?? 0) + netAreaM2;
    result.byRoom[zone.room] = (result.byRoom[zone.room] ?? 0) + netAreaM2;
    if (trade !== null) {
      const rollup = result.byClass[trade];
      rollup.zones += 1;
      rollup.netAreaM2 += netAreaM2;
      rollup.expandedAreaM2 += entry.expandedAreaM2;
      rollup.perimeterM += treatment.perimeterM;
      rollup.linearM += entry.longSideM;
      rollup.panelCount += entry.panelCount ?? 0;
    }
    solid.push({ zone, x1, z1, x2, z2, width, depth, measured: entry });
  }

  // 便捷字段（与 byClass 同源，避免调用方各自再算一遍口径）
  result.gypsumBoardM2 = result.byClass.gypsum_board.netAreaM2;
  result.aluminumBuckleM2 = result.byClass.aluminum_buckle.netAreaM2;
  result.aluminumBucklePanelCount = result.byClass.aluminum_buckle.panelCount;
  result.curtainBoxM2 = result.byClass.curtain_box.netAreaM2;
  result.curtainBoxLinearM = result.byClass.curtain_box.linearM;
  result.dryingRackM2 = result.byClass.drying_rack.netAreaM2;

  // 房间对照：哪些房间有吊顶、哪些是 2.80m 原顶、分区引用了不存在的房间
  const roomsWithCeiling = new Set<string>();
  for (const item of solid) {
    roomsWithCeiling.add(item.zone.room);
    if (rooms !== undefined && !roomHeights.has(item.zone.room)) result.unknownRoomZoneIds.push(item.zone.id);
  }
  result.roomIdsWithCeiling = [...roomsWithCeiling].sort();
  if (rooms !== undefined) {
    result.roomIdsWithoutCeiling = rooms.map((r) => r.id).filter((id) => !roomsWithCeiling.has(id)).sort();
  }

  // 平面重叠（同一层高平面上重复计费的风险）；贴边相接不告警
  for (let i = 0; i < solid.length; i += 1) {
    for (let j = i + 1; j < solid.length; j += 1) {
      const a = solid[i];
      const b = solid[j];
      const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
      const overlapZ = Math.min(a.z2, b.z2) - Math.max(a.z1, b.z1);
      if (overlapX > EPS && overlapZ > EPS) {
        result.overlaps.push(`${a.zone.id} ↔ ${b.zone.id} (${overlapX.toFixed(3)}×${overlapZ.toFixed(3)}m)`);
        result.overlapAreaM2 += overlapX * overlapZ;
      }
    }
  }

  return result;
}
