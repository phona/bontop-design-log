import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { ResolvedLayout } from '../shared/types.js';
import type { ProjectCatalog } from './project-catalog.js';
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
    grossAreaSqm: number;
    /** 墙 + 顶的净面积（默认计费口径）。 */
    netAreaSqm: number;
    highlightedIn3d: 'walls_only';
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
  return { regions, suppressedWallIds, windows };
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
  for (const roomId of declaredRooms) {
    const room = roomById.get(roomId);
    if (!room) throw new Error(`paint_region room ${roomId} not found in resolved layout`);
    const areaSqm = room.area ?? room.width * room.depth;
    requiredPositiveNumber(areaSqm, `Resolved footprint for ${roomId}`);
    ceilingAreaByRoom[roomId] = round3(areaSqm);
  }

  const scope = computePaintScope(
    toPaintWalls(layout.walls as unknown as Array<Record<string, any>>),
    inputs.regions,
    inputs.windows,
    { ceilingAreaByRoom, suppressedWallIds: inputs.suppressedWallIds },
  );

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
      (scope.netWallAreaSqm + scope.ceilingAreaSqm) + (scenario.deduct_openings ? 0 : scope.doorGapAreaSqm + scope.windowGapAreaSqm),
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
      grossAreaSqm: scope.grossAreaSqm,
      netAreaSqm: scope.netAreaSqm,
      highlightedIn3d: 'walls_only',
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
    assumptions,
    feesStatus: config.fees_status ?? {},
    warnings,
  };
}
