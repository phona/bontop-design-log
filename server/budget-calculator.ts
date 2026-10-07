import { readFileSync } from 'node:fs';
import type {
  CurrentScheme,
  BudgetSnapshot,
  BudgetLineItem,
  BudgetCategory,
  BudgetAttribution,
  DesignRulesConfig,
  RoomLayout,
  BudgetCategoryRaw,
  PhaseId,
} from '../shared/types.js';
import { computeCeilingTakeoff, type CeilingTakeoff } from '../shared/ceiling-takeoff.js';
import { loadCeilingConfig } from './config-loader.js';
import { loadCeilingQuotes, type CeilingQuotesFile } from './ceiling-quotes.js';
import { resolveActiveCeilingRates, compareCeilingQuotes, type CeilingQuoteRateKey, type ResolvedCeilingRates } from './ceiling-quotes.js';
import type { ProjectCatalog } from './project-catalog.js';
import type { ResolvedLayout } from '../shared/types.js';
import { isBudgetTopicIncluded, loadPhaseScopes } from './phase-scope.js';
import { controlPathForPhase, loadPhaseControlAuthority } from './phase-control.js';
import { computePaintScopeForLayout, loadPaintScopeInputs } from './paint-cost-comparison.js';

/**
 * 涂装**净**面积（净墙 + 顶）逐房间表：唯一来源是 overlay.yaml 的 paint_region 声明 +
 * catalog 的 resolved 房间面积，走 shared/paint-scope.ts 的同一套拆洞算法，
 * 与 3D「涂漆区」检视态、/api/paint/comparison、paintBudgetPreview 完全同源。
 * 无声明的房间不进表（= 不算量），不给默认值、不猜面积；算不出就抛错，
 * 由调用方降级——绝不退化成一个拍系数公式。
 */
function loadPaintScopeAreaByRoom(catalog: ProjectCatalog): Map<string, number> {
  const areaByRoom = new Map<string, number>();
  const inputs = loadPaintScopeInputs();
  if (!inputs.regions.length) return areaByRoom;
  const rooms = catalog.getRooms();
  // 墙几何（x/z/segments/openings）+ 房间 footprint 都取 catalog，与 /api/paint/comparison 的
  // resolved layout 版本是同一批数据的两个入口；算不出直接抛，由调用方处理。
  const scope = computePaintScopeForLayout(
    { rooms, walls: catalog.getWalls() } as unknown as ResolvedLayout,
    catalog,
    inputs,
  );
  for (const [roomId, wallArea] of Object.entries(scope.wallAreaByRoom)) {
    areaByRoom.set(roomId, wallArea + (scope.ceilingAreaByRoom[roomId] ?? 0));
  }
  return areaByRoom;
}

/**
 * 吊顶工程量：按 `config/ceiling.yaml` 的逐分区声明实算，不再按房间面积近似。
 * 工艺/计价类别（trade）拆分见 shared/ceiling-takeoff.ts；返回值为原始浮点，不取整。
 */
function ceilingTakeoff(catalog: ProjectCatalog): CeilingTakeoff {
  return computeCeilingTakeoff(loadCeilingConfig(), catalog.getRooms().map((room) => ({ id: room.id, height: room.height })));
}

/** base.json 的兜底费率：生效报价没声明的计价行回落到它（回落必须看得见）。 */
/**
 * base.json 的兜底吊顶费率。C12 新增的两行（边吊按米 / 满吊平顶按㎡）base.json 没有对应
 * labor 行 → 回落 null（待报价）：不进预算 actual，只在报价面板显形。
 */
function fallbackCeilingRates(baseRaw: Record<string, BudgetCategoryRaw>): Record<CeilingQuoteRateKey, { per_unit: number | null; unit: string }> {
  const carpentry = baseRaw.carpentry;
  const entries = carpentry?.labor ? (Array.isArray(carpentry.labor) ? carpentry.labor : [carpentry.labor]) : [];
  const byArea = new Map(entries.map((entry) => [entry.area, entry]));
  return {
    ceiling_zones: { per_unit: byArea.get('ceiling_zones')?.rate ?? null, unit: byArea.get('ceiling_zones')?.unit ?? '元/㎡' },
    curtain_box_linear: { per_unit: byArea.get('curtain_box_linear')?.rate ?? null, unit: byArea.get('curtain_box_linear')?.unit ?? '元/m' },
    gypsum_edge_drop_linear: { per_unit: null, unit: '元/m' },
    gypsum_flat_sqm: { per_unit: null, unit: '元/㎡' },
    // C13：厨卫铝扣板（归 QR-2026-10-03-08，不在木工 labor 行里）
    aluminum_buckle_sqm: { per_unit: null, unit: '元/㎡' },
  };
}

const QUANTITY_FORMULAS: Record<string, (room: RoomLayout) => number> = {
  floorArea: (room) => room.area ?? room.width * room.depth,
  wetWallArea: (room) => (room.width + room.depth) * 2 * room.height * 0.7,
  // 已废弃：吊顶算量请用 shared/ceiling-takeoff.ts 的逐分区实算（见 computeLabor 的 ceiling_zones）。
  // 这个房间面积别名会把没有吊顶的平顶也计费，仅为兼容旧 lineItem 声明而保留。
  ceilingArea: (room) => room.area ?? room.width * room.depth,
  linearKitchen: (room) => room.depth * 0.8,
  doorCount: () => 1,
  fixtureCount: () => 1,
};

export class BudgetCalculator {
  private paintScopeCache: Map<string, number> | null = null;

  constructor(
    private catalog: ProjectCatalog,
    private rulesConfig: DesignRulesConfig
  ) {}

  /** 涂装面积（墙+顶）逐房间表，进程内缓存：一次请求里材料与人工必须读到同一份口径。 */
  private paintScopeAreaByRoom(): Map<string, number> {
    if (!this.paintScopeCache) {
      this.paintScopeCache = loadPaintScopeAreaByRoom(this.catalog);
    }
    return this.paintScopeCache;
  }

  /**
   * 一个人工费分类可以有多条计价行（DEC-2026-10-08-C02：窗帘盒从吊顶 40 元/㎡ 里拆出来，
   * 改按延长米单列——README「没有合并项报价」）。`raw.labor` 兼容两种写法：
   * 单对象（既有各分类）或数组（carpentry）。
   * rate 为 null = 待报价：**不计入 actual，但数量必须显形**（cat.pendingLabor），
   * 否则「拆分」会变成「悄悄少算一笔钱」。
   */
  private computeLabor(
    categories: BudgetCategory[],
    baseRaw: Record<string, BudgetCategoryRaw>,
    rooms: RoomLayout[],
    phase: PhaseId,
    takeoff: CeilingTakeoff,
    quoteRates: ResolvedCeilingRates
  ): void {
    for (const cat of categories) {
      const raw = baseRaw[cat.key];
      if (!raw?.labor) continue;
      const laborEntries = Array.isArray(raw.labor) ? raw.labor : [raw.labor];

      for (const labor of laborEntries) {
      const { area } = labor;
      // 吊顶两条计价行的单价以生效报价为准（DEC-2026-10-08-C03）；未声明则回落 base.json。
      const quoted = area === 'ceiling_zones' || area === 'curtain_box_linear' ? quoteRates[area] : undefined;
      const rate = quoted ? quoted.per_unit : labor.rate;
      const unit = quoted ? quoted.unit : labor.unit;
      let quantity = 0;

      switch (area) {
        case 'floor':
          {
            const floorApplyRooms = this.rulesConfig.budget?.lineItems
              ?.find((item) => item.topic === 'floor' && item.quantityField === 'floorArea')
              ?.applyRooms ?? [];
            const allowedRoomIds = new Set(floorApplyRooms);
            quantity = rooms
              .filter((room) => allowedRoomIds.has(room.id))
              .reduce((sum, room) => sum + (room.area ?? room.width * room.depth), 0);
          }
          break;
        // 已废弃：按房间面积近似吊顶人工量（把无吊顶平顶/电梯井/入户花园都计了费）。
        // 保留分支只为兜底，新口径一律用 ceiling_zones；删除前须确认没有分类再引用它。
        case 'ceiling':
          quantity = rooms.reduce((sum, r) => sum + r.width * r.depth, 0);
          break;
        // 吊顶板面人工（石膏板 + 铝扣板 + 隐藏晾衣架吊顶）按实算净面积计价；
        // 窗帘盒已按 DEC-2026-10-08-C02 拆到 curtain_box_linear，不重复计。
        // 分类小计/延长米/板块数见 takeoff.byClass，由 GET /api/ceiling/takeoff 与
        // MCP get_ceiling_takeoff 输出，报价时按 README「没有合并项报价」逐项列。
        case 'ceiling_zones':
          quantity = takeoff.totalNetAreaM2 - takeoff.curtainBoxM2;
          break;
        // 窗帘盒人工：按延长米（行业主口径，与算量子系统的 byClass.curtain_box.linearM 同源）。
        // rate 待报价时数量照样显形（见函数末尾 pendingLabor）。
        case 'curtain_box_linear':
          quantity = takeoff.curtainBoxLinearM;
          break;
        case 'paint_wall':
          // 与材料侧同源：overlay.yaml 的 paint_region 声明 + resolved 房间面积（墙+顶）。
          quantity = rooms.reduce((sum, r) => sum + (this.paintScopeAreaByRoom().get(r.id) ?? 0), 0);
          break;
        case 'wet_floor': {
          const wetRooms = rooms.filter((r) => r.needs_waterproof === true);
          quantity = wetRooms.reduce((sum, r) => sum + r.width * r.depth, 0);
          break;
        }
        case 'door_count': {
          let count = 0;
          for (const roomId of Object.keys(this.catalog.getFurnishingsForPhase(phase))) {
            const counts = this.catalog.getFurnishingCounts(roomId, phase);
            count += counts['interior_door'] ?? 0;
            count += counts['bathroom_door'] ?? 0;
            count += counts['entry_door'] ?? 0;
            count += counts['door'] ?? 0;
          }
          quantity = count;
          break;
        }
        case 'fixture_count': {
          let count = 0;
          for (const roomId of Object.keys(this.catalog.getFurnishingsForPhase(phase))) {
            const counts = this.catalog.getFurnishingCounts(roomId, phase);
            count += counts['toilet'] ?? 0;
            count += counts['shower_set'] ?? 0;
            count += counts['vanity'] ?? 0;
            count += counts['mb_washbasin_cabinet'] ?? 0;
            count += counts['faucet'] ?? 0;
          }
          quantity = count;
          break;
        }
        case 'fixed':
          if (rate === null || rate === undefined) break;
          cat.actual += rate;
          continue;
        default:
          continue;
      }
      if (rate === null || rate === undefined) {
        // 待报价：数量入 pendingLabor 显形，金额不编（README：没有无依据决策）
        cat.pendingLabor = [...(cat.pendingLabor ?? []), { area, quantity, unit, reason: 'rate 待报价' }];
        continue;
      }
      cat.actual += Math.round(rate * quantity);
      }
    }
  }

  calculate(scheme: CurrentScheme, phase: PhaseId = 'full'): BudgetSnapshot {
    const topicCategories = this.rulesConfig.budget?.topicCategories ?? {};
    const lineItems = this.rulesConfig.budget?.lineItems ?? [];
    const baseCategories = this.catalog.getBudgetCategories();

    const allLineItems: BudgetLineItem[] = [];
    const categoryAutoActual = new Map<string, number>();

    for (const li of lineItems) {
      if (!isBudgetTopicIncluded(li.topic, phase)) continue;
      const topic = this.catalog.getTopic(li.topic);
      if (!topic) continue;

      const categoryKey = topicCategories[li.topic];
      if (!categoryKey) continue;

      const calcMode = li.calcMode ?? 'area';

      if (calcMode === 'fixed') {
        const optionId = scheme.selections[li.topic]?.default;
        if (!optionId) continue;
        const option = this.catalog.getOption(li.topic, optionId);
        if (!option) continue;

        allLineItems.push({
          topic: li.topic,
          roomId: null,
          optionId,
          quantity: 1,
          unitPrice: option.price_per_unit,
          coveragePerUnit: 1,
          lossRate: 1,
          cost: option.price_per_unit,
        });
        categoryAutoActual.set(categoryKey, (categoryAutoActual.get(categoryKey) ?? 0) + option.price_per_unit);
        continue;
      }

      if (calcMode === 'count') {
        const typeToTopic = this.rulesConfig.budget?.furnishingTypeToTopic ?? {};
        let totalCost = 0;
        for (const roomId of Object.keys(this.catalog.getFurnishingsForPhase(phase))) {
          const counts = this.catalog.getFurnishingCounts(roomId, phase);
          let qty = 0;
          for (const [type, count] of Object.entries(counts)) {
            const resolvedTopic = type === li.topic ? li.topic : typeToTopic[type];
            if (resolvedTopic === li.topic) qty += count;
          }
          if (qty <= 0) continue;
          const optionId = scheme.selections[li.topic]?.roomOverrides?.[roomId]
                         ?? scheme.selections[li.topic]?.default;
          if (!optionId) continue;
          const option = this.catalog.getOption(li.topic, optionId);
          if (!option) continue;

          const cost = option.price_per_unit * qty;
          allLineItems.push({
            topic: li.topic, roomId, optionId,
            quantity: qty, unitPrice: option.price_per_unit,
            coveragePerUnit: 1, lossRate: 1, cost,
          });
          totalCost += cost;
        }
        categoryAutoActual.set(categoryKey, (categoryAutoActual.get(categoryKey) ?? 0) + totalCost);
        continue;
      }

      if (topic.perRoom) {
        const rooms = this.catalog.getRooms();
        // 涂装面积单独走声明表：数量来源是 overlay.yaml 的 paint_region（并与 catalog 的
        // resolved 房间面积相加得到墙+顶），不再用 QUANTITY_FORMULAS 的拍系数公式。
        const paintScope = li.quantityField === 'paintScopeArea'
          ? this.paintScopeAreaByRoom()
          : null;
        const quantityFn = li.quantityField ? QUANTITY_FORMULAS[li.quantityField] : null;
        if (!paintScope && !quantityFn) continue;

        for (const room of rooms) {
          const overrideOptionId = scheme.selections[li.topic]?.roomOverrides?.[room.id];
          // applyRooms 只限制默认满铺；显式房间覆盖（用户 deliberate 选择）始终尊重
          if (li.applyRooms && !li.applyRooms.includes(room.id) && overrideOptionId === undefined) continue;
          const defaultOptionId = scheme.selections[li.topic]?.default;
          const optionId = overrideOptionId ?? defaultOptionId;
          if (!optionId) continue;

          const option = this.catalog.getOption(li.topic, optionId);
          if (!option) continue;

          const quantity = paintScope
            ? (paintScope.get(room.id) ?? 0)
            : quantityFn!(room);
          const pricePerUnit = option.price_per_unit ?? 0;
          const coveragePerUnit = option.coverage_per_unit ?? 1;
          const lossRate = option.loss_rate ?? 1.0;
          const cost = pricePerUnit * quantity / coveragePerUnit * lossRate;

          allLineItems.push({
            topic: li.topic, roomId: room.id, optionId,
            quantity, unitPrice: pricePerUnit,
            coveragePerUnit, lossRate, cost,
          });

          categoryAutoActual.set(
            categoryKey,
            (categoryAutoActual.get(categoryKey) ?? 0) + cost
          );
        }
      } else {
        const optionId = scheme.selections[li.topic]?.default;
        if (!optionId) continue;

        const option = this.catalog.getOption(li.topic, optionId);
        if (!option) continue;

        const pricePerUnit = option.price_per_unit ?? 0;
        const cost = pricePerUnit;

        allLineItems.push({
          topic: li.topic,
          roomId: null,
          optionId,
          quantity: 1,
          unitPrice: pricePerUnit,
          coveragePerUnit: 1,
          lossRate: 1,
          cost,
        });

        categoryAutoActual.set(
          categoryKey,
          (categoryAutoActual.get(categoryKey) ?? 0) + cost
        );
      }
    }

    const budgetRaw = JSON.parse(
      readFileSync('config/budget/base.json', 'utf8')
    ) as { categories: Record<string, BudgetCategoryRaw>; project_ceiling?: number; status?: string };

    const categories: BudgetCategory[] = baseCategories.map((bc) => {
      const autoActual = categoryAutoActual.get(bc.key) ?? 0;
      return {
        key: bc.key,
        budget: bc.budget,
        actual: bc.actual + autoActual,
        manualActual: bc.actual,
        autoActual,
        status: bc.status as BudgetCategory['status'],
        notes: bc.notes,
      };
    });

    const takeoff = ceilingTakeoff(this.catalog);
    // 生效报价（DEC-2026-10-08-C03）：报价文件缺失/非法时按「无报价」处理，
    // 回落 base.json 的 labor rate——预算不能被一个坏配置文件冻结。
    let quotes: CeilingQuotesFile | null = null;
    try {
      quotes = loadCeilingQuotes();
    } catch (err) {
      console.error('[budget-calculator] ceiling-quotes.yaml 不可用，回落 base.json 费率：', err instanceof Error ? err.message : String(err));
    }
    const quoteRates = resolveActiveCeilingRates(
      quotes ?? { version: 1, active: 'base.json', quotes: [] },
      fallbackCeilingRates(budgetRaw.categories),
    );

    this.computeLabor(categories, budgetRaw.categories, this.catalog.getRooms(), phase, takeoff, quoteRates);

    // 报价对比进快照：active 那家就是 actual 的来源，其余候选只并排展示、不动金额。
    const ceilingQuotes = quotes
      ? {
          activeId: quotes.active,
          source: quoteRates.ceiling_zones.source === 'quote' ? 'quote' as const : 'base.json' as const,
          comparison: compareCeilingQuotes(quotes, takeoff, fallbackCeilingRates(budgetRaw.categories)),
        }
      : undefined;

    // Status computed AFTER computeLabor: labor can push a category over budget.
    for (const cat of categories) {
      if (cat.status === 'reserved') continue;
      const ratio = cat.budget > 0 ? cat.actual / cat.budget : 0;
      cat.status = ratio > 1.0 ? 'over' : ratio > 0.9 ? 'near' : 'ok';
    }

    const topicCategoriesMap = this.rulesConfig.budget?.topicCategories ?? {};
    const attribution: Record<string, BudgetAttribution> = {};
    for (const cat of categories) {
      if (cat.status === 'over' || cat.status === 'near') {
        const catLineItems = allLineItems
          .filter((li) => topicCategoriesMap[li.topic] === cat.key)
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 3);
        attribution[cat.key] = {
          topItems: catLineItems,
          overBy: cat.actual - cat.budget,
          ratio: cat.budget > 0 ? cat.actual / cat.budget : 0,
        };
      }
    }

    const totalBudget = categories.reduce((sum, c) => sum + c.budget, 0);
    const totalActual = categories.reduce((sum, c) => sum + c.actual, 0);
    // 现行执行上限取自 schedule/phase-1/control.yaml `control.phase_ceiling_cny`。
    // 2026-10-04 之前这里读的是 config/budget/base.json 的 `project_ceiling`（190,000），
    // 而该字段已被 control.yaml `budget_reconciliation.historical_baseline` 标为
    // `historical_reference_only` —— 业主通过 budget API / MCP 看到的一期上限长期是作废值。
    // base.json 只保留分科目明细与作废口径留档，不再作为任何计算与接口的输入源。
    const authority = loadPhaseControlAuthority(controlPathForPhase(loadPhaseScopes()[phase]));
    const projectCeiling = authority.ceilingCny;
    const overCeilingBy = totalActual - projectCeiling;

    return {
      totalBudget: authority.ceilingCny,
      totalActual,
      projectCeiling,
      overCeilingBy,
      historicalBaseline: authority.historicalBaseline,
      categories,
      lineItems: allLineItems,
      attribution,
      ...(ceilingQuotes ? { ceilingQuotes } : {}),
    };
  }
}
