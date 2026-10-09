import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { ResolvedLayout } from '../shared/types.js';
import { buildBaySillGeometry } from '../shared/render/BaySillGeometry.js';
import { computePaintSillScope, type PaintSillFaceInput } from '../shared/paint-sill-scope.js';
import type { ProjectCatalog } from './project-catalog.js';
import { mergeSceneElements, parseOverlay } from './overlay-merge.js';
import { loadCeilingConfig } from './config-loader.js';
import {
  computePaintScope,
  type PaintRegionInput,
  type PaintScopeResult,
  type PaintWallInput,
  type PaintWindowInput,
} from '../shared/paint-scope.js';

/**
 * 涂漆成本核算（墙顶面涂装 PKG-080；DEC-2026-10-08-C05 建立、C06 洞口扣除）。
 * 与 tile-cost-comparison 同构：声明式范围 + 显式口径 + 逐项对账，算不出就 throw，
 * 由路由降级成 503，绝不静默凑数。
 *
 * 面积唯一来源是 overlay.yaml 的 paint_region 声明，几何与拆洞一律走 shared/paint-scope.ts
 * ——3D 检视态、本服务、预算 painting 科目三处共用同一份数学，不允许任何一处另立口径。
 */

export interface PaintRegionDeclaration extends PaintRegionInput {
  type: 'paint_region';
  color?: string;
  reason?: string;
}

export interface PaintSillRegionDeclaration extends PaintSillFaceInput { type: 'paint_sill_region'; reason?: string }

export interface PaintComparisonConfig {
  version: number;
  area_source: string;
  room_finish_source: string;
  planning: {
    loss_multiplier: number;
    topcoat_material_id: string;
    topcoats: number;
    primer_included: boolean;
    primer_coverage_per_unit: number;
    primer_price_basis: 'same_as_topcoat' | 'declared_unit_price';
    primer_declared_unit_price?: number;
    primer_coverage_status?: string;
    primer_price_status?: string;
  };
  deductions: {
    /** true = 面积按净（扣门洞窗洞）；false = 按毛。业主 2026-10-08 裁定为 true。 */
    deduct_openings: boolean;
    /** 溯源说明（窗洞当前为 0：窗全在玻璃幕墙上）。 */
    reason?: string;
  };
  labor: {
    rate_yuan_per_sqm: number;
    rate_source: string;
    scope_note: string;
  };
  reconciliation: {
    pkg_id: string;
    planned_cny: number;
    owner_target_cny: number;
  };
  scenarios: Array<{ id: string; topcoats: number; deduct_openings: boolean }>;
  fees_status: Record<string, string>;
  /** 外部报价（证据，不是本模型的假设）。 */
  quotes?: PaintQuoteInput[];
}

export interface PaintQuoteInput {
  id: string;
  source: string;
  material_id?: string;
  form: string;
  unit: string;
  rate: number;
  area_basis?: 'net_area' | 'gross_area';
  coverage?: string;
  coats?: string;
  quote_status: string;
  observed_at?: string;
  evidence?: string;
  note?: string;
}

/** 报价折算结果：把「X 元每平米」变成可与计划额、与自下而上模型对照的总额。 */
export interface PaintQuoteResult {
  quoteId: string;
  source: string;
  form: string;
  rateYuanPerSqm: number;
  areaSqm: number;
  totalYuan: number;
  vsPlannedDeltaYuan: number;
  vsOwnerTargetDeltaYuan: number;
  /** 与自下而上「涂刷」模型（默认情景）的差额——即基层/腻子/样品保护的隐含额度。 */
  vsBrushingModelDeltaYuan: number;
  /** 折算到面积的等效单价拆分提示：报价总额 − 模型涂刷额。 */
  impliedAllowanceYuanPerSqm: number;
  coverage: string;
  coats: string;
  quoteStatus: string;
  observedAt?: string;
  evidence?: string;
  materialId?: string;
  note?: string;
}

export interface PaintAssumption {
  key: string;
  value: number | string | boolean;
  status: 'from_overlay_declaration' | 'from_materials_yaml' | 'from_budget_base_json' | 'assumed_unconfirmed';
  source: string;
  note?: string;
}

export interface PaintScenarioResult {
  scenarioId: string;
  topcoats: number;
  deductOpenings: boolean;
  areaSqm: number;
  topcoatBuckets: number;
  primerBuckets: number;
  totalBuckets: number;
  materialYuan: number;
  laborRateYuanPerSqm: number;
  laborYuan: number;
  subtotalYuan: number;
  vsPlannedDeltaYuan: number;
  vsOwnerTargetDeltaYuan: number;
}

export interface PaintCostComparison {
  areaSource: string;
  roomFinishSource: string;
  scope: {
    entries: PaintScopeResult['regions'];
    paintRoomCount: number;
    wallRegionEntryCount: number;
    wallAreaByRoom: Record<string, number>;
    /** 毛墙面面积（含门洞窗洞）。 */
    grossWallAreaSqm: number;
    /** 门洞占位。 */
    doorGapAreaSqm: number;
    /** 窗洞占位（当前 0）。 */
    windowGapAreaSqm: number;
    /** 净墙面面积 = 毛 − 门洞 − 窗洞。 */
    netWallAreaSqm: number;
    ceilingAreaByRoom: Record<string, number>;
    ceilingAreaSqm: number;
    sillAreaByRoom: Record<string, number>;
    ordinarySillAreaSqm: number;
    wetAreaSqm: number;
    ordinaryAreaSqm: number;
    wetAreaStatus: 'pending_system_quote_and_site_validation';
    sillSurfaces: PaintScopeResult['sillSurfaces'];
    grossAreaSqm: number;
    /** 墙 + 顶的净面积（默认计费口径）。 */
    netAreaSqm: number;
    highlightedIn3d: 'walls_and_declared_sill_faces';
  };
  material: {
    id: string;
    name: string;
    brand: string;
    unit: string;
    pricePerUnit: number;
    coveragePerUnit: number;
    lossRate: number;
    priceYuanPerSqmPerCoat: number;
  };
  labor: {
    rateYuanPerSqm: number;
    rateSource: string;
    scopeNote: string;
  };
  reconciliation: {
    pkgId: string;
    plannedCny: number;
    ownerTargetCny: number;
    modeledRangeCny: [number, number];
    selectedScenarioId: null;
  };
  scenarios: PaintScenarioResult[];
  quotes: PaintQuoteResult[];
  assumptions: PaintAssumption[];
  feesStatus: Record<string, string>;
  warnings: string[];
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1_000) / 1_000;

function requiredPositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`);
}

export function loadPaintComparisonConfig(path = 'config/paint-comparison.yaml'): PaintComparisonConfig {
  return load(readFileSync(path, 'utf8')) as PaintComparisonConfig;
}

export interface PaintScopeInputs {
  regions: PaintRegionDeclaration[];
  sillRegions: PaintSillRegionDeclaration[];
  ceilingRooms: Array<{ id: string; type: 'paint_ceiling_region'; room: string; reason?: string }>;
  suppressedWallIds: Set<string>;
  windows: PaintWindowInput[];
}

/**
 * 读 overlay.yaml：paint_region 声明 + suppress 墙 + 窗洞声明（bay_sill / glass_infill）。
 * 预算侧与成本侧都走这里，保证读到的永远是同一份声明。
 */
export function loadPaintScopeInputs(path = 'config/layout/overlay.yaml'): PaintScopeInputs {
  const overlay = load(readFileSync(path, 'utf8')) as {
    suppress?: Array<{ wall?: string; walls?: string[] }>;
    elements?: Array<Record<string, unknown>>;
  };
  const suppressedWallIds = new Set<string>();
  for (const entry of overlay.suppress ?? []) {
    for (const key of ['wall', 'walls'] as const) {
      const value = (entry as Record<string, unknown>)[key];
      if (!value) continue;
      for (const wall of Array.isArray(value) ? value : [value]) suppressedWallIds.add(String(wall));
    }
  }
  const regions = (overlay.elements ?? []).filter(
    (element) => element?.type === 'paint_region',
  ) as unknown as PaintRegionDeclaration[];
  const sillRegions = (overlay.elements ?? []).filter((element) => element?.type === 'paint_sill_region') as unknown as PaintSillRegionDeclaration[];
  const ceilingRooms = (overlay.elements ?? []).filter((element) => element?.type === 'paint_ceiling_region') as unknown as PaintScopeInputs['ceilingRooms'];
  const windows: PaintWindowInput[] = (overlay.elements ?? [])
    .filter((element) => element?.type === 'bay_sill' || element?.type === 'glass_infill')
    .flatMap((element) => {
      const sill = (element.sill as number | undefined) ?? 0;
      const height = element.height as number;
      const along = element.along as [number, number] | undefined;
      const wallIds = element.type === 'bay_sill'
        ? ((element.walls as string[] | undefined) ?? (element.wall ? [element.wall as string] : []))
        : [element.wall as string];
      return wallIds
        .filter((wallId): wallId is string => Boolean(wallId))
        .map((wallId) => ({ id: element.id as string, wall: wallId, sill, height, ...(along ? { along } : {}) }));
    });
  return { regions, sillRegions, ceilingRooms, suppressedWallIds, windows };
}

/** buildScene 的墙 / catalog 的墙 / resolved layout 的墙 → 共享算法的输入形状。 */
function toPaintWalls(walls: Array<Record<string, any>>): PaintWallInput[] {
  return walls.map((wall) => ({
    id: String(wall.id),
    x1: Number(wall.x1),
    z1: Number(wall.z1),
    x2: Number(wall.x2),
    z2: Number(wall.z2),
    ...(wall.segments ? { segments: wall.segments } : {}),
    ...(wall.height !== undefined ? { height: Number(wall.height) } : {}),
    ...(wall.openings ? { openings: wall.openings } : {}),
  }));
}

/** Exact union for axis-aligned ceiling footprints; overlapping declarations subtract once. */
function rectangleUnionArea(rectangles: Array<[number, number, number, number]>): number {
  if (!rectangles.length) return 0;
  const xs = [...new Set(rectangles.flatMap(([x1, , x2]) => [x1, x2]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x1 = xs[i], x2 = xs[i + 1];
    const intervals = rectangles.filter(([a, , b]) => a < x2 && b > x1).map(([, z1, , z2]) => [z1, z2] as [number, number]).sort((a, b) => a[0] - b[0]);
    let length = 0, start = NaN, end = NaN;
    for (const [z1, z2] of intervals) {
      if (!Number.isFinite(start)) { start = z1; end = z2; }
      else if (z1 <= end) end = Math.max(end, z2);
      else { length += end - start; start = z1; end = z2; }
    }
    if (Number.isFinite(start)) length += end - start;
    area += (x2 - x1) * length;
  }
  return area;
}

/**
 * 计算涂装范围并做三道一致性校验：
 *   ① 引用的墙存在且未被 suppress；
 *   ② along 落在墙长内、同 (墙, 房间) 不重叠；
 *   ③ 有 paint_region 声明的房间集合 == catalog 里 `wall_finish==='paint'` 的房间集合。
 * 第③条是防声明腐烂的锚：house.yaml 改意图而 overlay 没跟着改（或反过来）就在这里炸掉。
 */
export function computePaintScopeForLayout(
  layout: ResolvedLayout,
  catalog: ProjectCatalog,
  inputs: PaintScopeInputs = loadPaintScopeInputs(),
): PaintScopeResult {
  if (!inputs.regions.length) throw new Error('overlay.yaml declares no paint_region elements');
  const ceilingAreaByRoom: Record<string, number> = {};
  const roomById = new Map(layout.rooms.map((room) => [room.id, room]));
  const declaredRooms = new Set(inputs.regions.map((region) => region.room));
  const ceilingRoomIds = new Set(inputs.ceilingRooms.map((region) => region.room));
  const ceilingZones = loadCeilingConfig();
  for (const roomId of ceilingRoomIds) {
    const room = roomById.get(roomId);
    if (!room) throw new Error(`paint_ceiling_region room ${roomId} not found in resolved layout`);
    const areaSqm = room.area ?? room.width * room.depth;
    requiredPositiveNumber(areaSqm, `Resolved footprint for ${roomId}`);
    const nonPaintRects = ceilingZones
      .filter((zone) => zone.room === roomId && zone.type === 'aluminum_buckle' && zone.area)
      .map((zone) => {
        const [x1, z1, x2, z2] = zone.area!;
        return [Math.max(x1, room.x - room.width / 2), Math.max(z1, room.z - room.depth / 2), Math.min(x2, room.x + room.width / 2), Math.min(z2, room.z + room.depth / 2)] as [number, number, number, number];
      })
      .filter(([x1, z1, x2, z2]) => x2 > x1 && z2 > z1);
    ceilingAreaByRoom[roomId] = round3(Math.max(0, areaSqm - rectangleUnionArea(nonPaintRects)));
  }

  const mergedElements = mergeSceneElements(layout.walls as any, parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')));
  const bayById = new Map(mergedElements.filter((element) => element.type === 'bay_sill').map((element) => [element.id, element]));
  const sillScopes = inputs.sillRegions.map((declaration) => {
    const bay = bayById.get(declaration.element);
    const room = roomById.get(declaration.room);
    if (!bay || bay.type !== 'bay_sill' || !bay.wallRefs?.length) throw new Error(`paint_sill_region ${declaration.id} references unresolved bay_sill ${declaration.element}`);
    if (!room) throw new Error(`paint_sill_region ${declaration.id} references unknown room ${declaration.room}`);
    const geometry = buildBaySillGeometry(bay.wallRefs, layout.rooms, bay.depth);
    return computePaintSillScope(declaration, geometry, bay, room, ceilingZones, layout.walls as any);
  });
  const scope = computePaintScope(
    toPaintWalls(layout.walls as unknown as Array<Record<string, any>>),
    inputs.regions,
    inputs.windows,
    { ceilingAreaByRoom, suppressedWallIds: inputs.suppressedWallIds, sillAreas: sillScopes.map((item) => ({ room: item.declaration.room, finish: item.declaration.finish, totalAreaSqm: item.totalAreaSqm })) },
  );
  scope.sillSurfaces = sillScopes as unknown as PaintScopeResult['sillSurfaces'];
  scope.warnings.push(...sillScopes.flatMap((item) => item.warnings));

  const finishRooms = new Set(
    catalog.getRooms().filter((room) => room.wall_finish === 'paint').map((room) => room.id),
  );
  const drift = [...declaredRooms].filter((id) => !finishRooms.has(id));
  const undeclared = [...finishRooms].filter((id) => !declaredRooms.has(id));
  if (drift.length || undeclared.length) {
    throw new Error(
      `paint_region declarations diverge from house.yaml wall_finish: declared-without-finish=[${drift.join(', ')}]; finish-without-declaration=[${undeclared.join(', ')}]`,
    );
  }
  const ceilingMissing = [...declaredRooms].filter((id) => !ceilingRoomIds.has(id));
  const ceilingExtra = [...ceilingRoomIds].filter((id) => !declaredRooms.has(id));
  if (ceilingMissing.length || ceilingExtra.length) throw new Error(`paint_ceiling_region declarations diverge from paint rooms: missing=[${ceilingMissing.join(', ')}]; extra=[${ceilingExtra.join(', ')}]`);
  return scope;
}

export function buildPaintCostComparison(
  layout: ResolvedLayout,
  config: PaintComparisonConfig,
  catalog: ProjectCatalog,
): PaintCostComparison {
  const { planning, deductions, labor, reconciliation, scenarios } = config;
  if (!Number.isFinite(planning.loss_multiplier) || planning.loss_multiplier < 1) {
    throw new Error('planning.loss_multiplier must be a finite number >= 1');
  }
  requiredPositiveNumber(planning.topcoats, 'planning.topcoats');
  if (!scenarios.length) throw new Error('scenarios must include at least one entry');

  const scope = computePaintScopeForLayout(layout, catalog);

  // 主材与 materials.yaml 逐项对账：价格、覆盖率、损耗、calc_mode 必须一致，否则口径已漂移。
  const material = catalog.getOption('paint', planning.topcoat_material_id);
  if (!material) throw new Error(`materials.yaml has no paint option ${planning.topcoat_material_id}`);
  requiredPositiveNumber(material.price_per_unit, `${material.id} price_per_unit`);
  requiredPositiveNumber(material.coverage_per_unit, `${material.id} coverage_per_unit`);
  const materialEntry = catalog.getAllMaterials().find((entry) => entry.id === material.id);
  if (materialEntry?.calc_mode && materialEntry.calc_mode !== 'area') {
    throw new Error(`${material.id} calc_mode must be area, got ${materialEntry.calc_mode}`);
  }
  const lossRate = material.loss_rate ?? planning.loss_multiplier;
  if (Math.abs(lossRate - planning.loss_multiplier) > 1e-9) {
    throw new Error(`${material.id} loss_rate ${lossRate} diverges from planning.loss_multiplier ${planning.loss_multiplier}`);
  }
  const primerPricePerUnit = planning.primer_price_basis === 'declared_unit_price'
    ? (requiredPositiveNumber(planning.primer_declared_unit_price ?? 0, 'planning.primer_declared_unit_price'), planning.primer_declared_unit_price!)
    : material.price_per_unit;
  requiredPositiveNumber(planning.primer_coverage_per_unit, 'planning.primer_coverage_per_unit');

  const results: PaintScenarioResult[] = scenarios.map((scenario) => {
    requiredPositiveNumber(scenario.topcoats, `scenario ${scenario.id} topcoats`);
    // 净面积是基准口径（业主裁定扣洞）；deduct_openings=false 的情景把洞口加回去做对照。
    const areaSqm = round3(
      scope.ordinaryAreaSqm + (scenario.deduct_openings ? 0 : scope.doorGapAreaSqm + scope.windowGapAreaSqm),
    );
    requiredPositiveNumber(areaSqm, `scenario ${scenario.id} area`);
    const rawTopcoat = (areaSqm / material.coverage_per_unit) * scenario.topcoats * lossRate;
    const topcoatBuckets = Math.ceil(rawTopcoat - 1e-9);
    const rawPrimer = planning.primer_included ? (areaSqm / planning.primer_coverage_per_unit) * lossRate : 0;
    const primerBuckets = planning.primer_included ? Math.ceil(rawPrimer - 1e-9) : 0;
    const materialYuan = round2(topcoatBuckets * material.price_per_unit + primerBuckets * primerPricePerUnit);
    const laborYuan = round2(labor.rate_yuan_per_sqm * areaSqm);
    const subtotalYuan = round2(materialYuan + laborYuan);
    return {
      scenarioId: scenario.id,
      topcoats: scenario.topcoats,
      deductOpenings: scenario.deduct_openings,
      areaSqm,
      topcoatBuckets,
      primerBuckets,
      totalBuckets: topcoatBuckets + primerBuckets,
      materialYuan,
      laborRateYuanPerSqm: labor.rate_yuan_per_sqm,
      laborYuan,
      subtotalYuan,
      vsPlannedDeltaYuan: round2(subtotalYuan - reconciliation.planned_cny),
      vsOwnerTargetDeltaYuan: round2(subtotalYuan - reconciliation.owner_target_cny),
    };
  });

  const subtotals = results.map((result) => result.subtotalYuan);

  // 外部报价折算：面积口径默认取净计费面积（与默认情景同源），与计划额/业主目标/
  // 自下而上涂刷模型三方对照。覆盖范围未确认的报价，差额不解释成「省了/超了」，
  // 而是显形为「隐含额度」，等覆盖范围确认后再拆分。
  const defaultScenario = results.find((result) => result.deductOpenings) ?? results[0];
  const quoteResults: PaintQuoteResult[] = (config.quotes ?? []).map((quote) => {
    requiredPositiveNumber(quote.rate, `quote ${quote.id} rate`);
    const areaSqm = round3(
      quote.area_basis === 'gross_area' ? (scope.grossWallAreaSqm + scope.ceilingAreaSqm + scope.ordinarySillAreaSqm) : scope.ordinaryAreaSqm,
    );
    const totalYuan = round2(quote.rate * areaSqm);
    return {
      quoteId: quote.id,
      source: quote.source,
      form: quote.form,
      rateYuanPerSqm: quote.rate,
      areaSqm,
      totalYuan,
      vsPlannedDeltaYuan: round2(totalYuan - reconciliation.planned_cny),
      vsOwnerTargetDeltaYuan: round2(totalYuan - reconciliation.owner_target_cny),
      vsBrushingModelDeltaYuan: round2(totalYuan - defaultScenario.subtotalYuan),
      impliedAllowanceYuanPerSqm: round2(quote.rate - defaultScenario.subtotalYuan / areaSqm),
      coverage: quote.coverage ?? 'unconfirmed',
      coats: quote.coats ?? 'unconfirmed',
      quoteStatus: quote.quote_status,
      ...(quote.observed_at ? { observedAt: quote.observed_at } : {}),
      ...(quote.evidence ? { evidence: quote.evidence } : {}),
      ...(quote.material_id ? { materialId: quote.material_id } : {}),
      ...(quote.note ? { note: quote.note } : {}),
    };
  });

  const assumptions: PaintAssumption[] = [
    {
      key: 'net_wall_area_sqm',
      value: scope.netWallAreaSqm,
      status: 'from_overlay_declaration',
      source: 'config/layout/overlay.yaml paint_region',
      note: `毛 ${scope.grossWallAreaSqm}㎡ − 门洞 ${scope.doorGapAreaSqm}㎡ − 窗洞 ${scope.windowGapAreaSqm}㎡；与 3D 高亮的是同一批声明、同一个拆洞算法`,
    },
    {
      key: 'ceiling_area_sqm',
      value: scope.ceilingAreaSqm,
      status: 'from_overlay_declaration',
      source: 'config/layout/model-geometry.yaml room footprint',
      note: '顶面涂装在成本口径中单列；3D 涂漆检视态只高亮墙面，不显示顶面',
    },
    {
      key: 'door_gap_area_sqm',
      value: scope.doorGapAreaSqm,
      status: 'from_overlay_declaration',
      source: 'config/layout/model-geometry.yaml walls[].openings',
      note: '按洞口与声明的几何相交实算，不手写常量；双面涂漆墙的同一樘门在两个房间面各扣一次',
    },
    {
      key: 'window_gap_area_sqm',
      value: scope.windowGapAreaSqm,
      status: 'from_overlay_declaration',
      source: 'config/layout/overlay.yaml bay_sill / glass_infill',
      note: '当前为 0：全部 8 樘窗都在 suppress 的玻璃幕墙/飘窗让路墙上，非涂装面。将来窗声明落到实体墙上必须写 along，否则记 warning',
    },
    {
      key: 'topcoat_price_per_unit',
      value: material.price_per_unit ?? 0,
      status: 'from_materials_yaml',
      source: `config/materials.yaml ${material.id}`,
    },
    {
      key: 'topcoat_coverage_per_unit',
      value: material.coverage_per_unit ?? 0,
      status: 'from_materials_yaml',
      source: `config/materials.yaml ${material.id}`,
      note: '每桶单遍覆盖；遍数由 scenario.topcoats 单独表达，不并进 coverage',
    },
    {
      key: 'loss_rate',
      value: lossRate,
      status: 'from_materials_yaml',
      source: `config/materials.yaml ${material.id}`,
    },
    {
      key: 'labor_rate_yuan_per_sqm',
      value: labor.rate_yuan_per_sqm,
      status: 'from_budget_base_json',
      source: labor.rate_source,
      note: labor.scope_note,
    },
    {
      key: 'primer_coverage_per_unit',
      value: planning.primer_coverage_per_unit,
      status: planning.primer_coverage_status === 'confirmed' ? 'from_materials_yaml' : 'assumed_unconfirmed',
      source: 'config/paint-comparison.yaml planning.primer_coverage_per_unit',
      note: planning.primer_coverage_status === 'confirmed' ? undefined : '底漆覆盖率未经门店确认，暂按与面漆同覆盖',
    },
    {
      key: 'primer_price_per_unit',
      value: primerPricePerUnit,
      status: planning.primer_price_status === 'confirmed' ? 'from_materials_yaml' : 'assumed_unconfirmed',
      source: 'config/paint-comparison.yaml planning',
      note: planning.primer_price_status === 'confirmed' ? undefined : '底漆单价未经门店确认，暂按与面漆同价',
    },
  ];

  const warnings: string[] = [...scope.warnings];
  if (scope.wetAreaSqm > 0) warnings.push(`主卫上飘窗湿区涂装 ${scope.wetAreaSqm.toFixed(3)}㎡ 已从普通墙漆单价/材料费/人工中排除；湿区完整涂装系统、基层适配、直接淋水等级及人工均待现场核验与分项报价，不能将其记作零元或已含。`);
  for (const quote of quoteResults) {
    if (quote.coverage === 'pending_confirmation' || quote.coverage === 'unconfirmed') {
      warnings.push(
        `包工包料报价 ${quote.quoteId}（${quote.source} ${quote.rateYuanPerSqm} 元每平米）覆盖范围未确认：是否含基层修补/找平批刮腻子/颜色样板与成品保护未知，其与涂刷模型的差额暂按「隐含额度」看待，不与 PKG-080 计划额直接划等号`,
      );
    }
  }
  if (planning.primer_price_status !== 'confirmed' || planning.primer_coverage_status !== 'confirmed') {
    warnings.push('底漆单价/覆盖率未确认（primer_price_status / primer_coverage_status），材料费含未确认假设');
  }
  if (!deductions.deduct_openings) {
    warnings.push('配置当前不扣门窗洞口，与业主 2026-10-08 裁定（门窗洞均按实扣除）不一致');
  }
  const overPlan = results.filter((result) => result.vsPlannedDeltaYuan > 0);
  if (overPlan.length) {
    warnings.push(`情景 ${overPlan.map((r) => r.scenarioId).join(', ')} 高于 ${reconciliation.pkg_id} 计划额`);
  }

  return {
    areaSource: config.area_source,
    roomFinishSource: config.room_finish_source,
    scope: {
      entries: scope.regions,
      paintRoomCount: Object.keys(scope.wallAreaByRoom).length,
      wallRegionEntryCount: scope.regions.length,
      wallAreaByRoom: scope.wallAreaByRoom,
      grossWallAreaSqm: scope.grossWallAreaSqm,
      doorGapAreaSqm: scope.doorGapAreaSqm,
      windowGapAreaSqm: scope.windowGapAreaSqm,
      netWallAreaSqm: scope.netWallAreaSqm,
      ceilingAreaByRoom: scope.ceilingAreaByRoom,
      ceilingAreaSqm: scope.ceilingAreaSqm,
      sillAreaByRoom: scope.sillAreaByRoom,
      ordinarySillAreaSqm: scope.ordinarySillAreaSqm,
      wetAreaSqm: scope.wetAreaSqm,
      ordinaryAreaSqm: scope.ordinaryAreaSqm,
      wetAreaStatus: 'pending_system_quote_and_site_validation',
      sillSurfaces: scope.sillSurfaces,
      grossAreaSqm: scope.grossAreaSqm,
      netAreaSqm: scope.netAreaSqm,
      highlightedIn3d: 'walls_and_declared_sill_faces',
    },
    material: {
      id: material.id,
      name: material.name,
      brand: materialEntry?.brand ?? '',
      unit: materialEntry?.unit ?? '',
      pricePerUnit: material.price_per_unit ?? 0,
      coveragePerUnit: material.coverage_per_unit ?? 0,
      lossRate,
      priceYuanPerSqmPerCoat: round2((material.price_per_unit ?? 0) / (material.coverage_per_unit ?? 1)),
    },
    labor: {
      rateYuanPerSqm: labor.rate_yuan_per_sqm,
      rateSource: labor.rate_source,
      scopeNote: labor.scope_note,
    },
    reconciliation: {
      pkgId: reconciliation.pkg_id,
      plannedCny: reconciliation.planned_cny,
      ownerTargetCny: reconciliation.owner_target_cny,
      modeledRangeCny: [round2(Math.min(...subtotals)), round2(Math.max(...subtotals))],
      selectedScenarioId: null,
    },
    scenarios: results,
    quotes: quoteResults,
    assumptions,
    feesStatus: config.fees_status ?? {},
    warnings,
  };
}
