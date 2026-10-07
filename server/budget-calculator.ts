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
import type { ProjectCatalog } from './project-catalog.js';
import { isBudgetTopicIncluded, loadPhaseScopes } from './phase-scope.js';
import { controlPathForPhase, loadPhaseControlAuthority } from './phase-control.js';

/**
 * 吊顶工程量：按 `config/ceiling.yaml` 的逐分区声明实算，不再按房间面积近似。
 * 工艺/计价类别（trade）拆分见 shared/ceiling-takeoff.ts；返回值为原始浮点，不取整。
 */
function ceilingTakeoff(catalog: ProjectCatalog): CeilingTakeoff {
  return computeCeilingTakeoff(loadCeilingConfig(), catalog.getRooms().map((room) => ({ id: room.id, height: room.height })));
}

const QUANTITY_FORMULAS: Record<string, (room: RoomLayout) => number> = {
  floorArea: (room) => room.area ?? room.width * room.depth,
  wetWallArea: (room) => (room.width + room.depth) * 2 * room.height * 0.7,
  paintWallArea: (room) => (room.width + room.depth) * 2 * room.height * 0.75,
  // 已废弃：吊顶算量请用 shared/ceiling-takeoff.ts 的逐分区实算（见 computeLabor 的 ceiling_zones）。
  // 这个房间面积别名会把没有吊顶的平顶也计费，仅为兼容旧 lineItem 声明而保留。
  ceilingArea: (room) => room.area ?? room.width * room.depth,
  linearKitchen: (room) => room.depth * 0.8,
  doorCount: () => 1,
  fixtureCount: () => 1,
};

export class BudgetCalculator {
  constructor(
    private catalog: ProjectCatalog,
    private rulesConfig: DesignRulesConfig
  ) {}

  private computeLabor(
    categories: BudgetCategory[],
    baseRaw: Record<string, BudgetCategoryRaw>,
    rooms: RoomLayout[],
    phase: PhaseId,
    takeoff: CeilingTakeoff
  ): void {
    for (const cat of categories) {
      const raw = baseRaw[cat.key];
      if (!raw?.labor) continue;

      const { rate, area } = raw.labor;
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
        // 吊顶实算口径：config/ceiling.yaml 的实心分区净面积合计
        // （石膏板 + 铝扣板 + 窗帘盒 + 晾衣架吊顶，ac_indoor 不计）。
        // 分类小计/延长米/板块数见 takeoff.byClass，由 GET /api/ceiling/takeoff 与
        // MCP get_ceiling_takeoff 输出，报价时按 README「没有合并项报价」逐项列。
        case 'ceiling_zones':
          quantity = takeoff.totalNetAreaM2;
          break;
        case 'paint_wall':
          quantity = rooms.reduce((sum, r) => sum + (r.width + r.depth) * 2 * r.height * 0.75, 0);
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
          cat.actual += rate;
          continue;
        default:
          continue;
      }
      cat.actual += Math.round(rate * quantity);
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
        const quantityFn = li.quantityField ? QUANTITY_FORMULAS[li.quantityField] : null;
        if (!quantityFn) continue;

        for (const room of rooms) {
          const overrideOptionId = scheme.selections[li.topic]?.roomOverrides?.[room.id];
          // applyRooms 只限制默认满铺；显式房间覆盖（用户 deliberate 选择）始终尊重
          if (li.applyRooms && !li.applyRooms.includes(room.id) && overrideOptionId === undefined) continue;
          const defaultOptionId = scheme.selections[li.topic]?.default;
          const optionId = overrideOptionId ?? defaultOptionId;
          if (!optionId) continue;

          const option = this.catalog.getOption(li.topic, optionId);
          if (!option) continue;

          const quantity = quantityFn(room);
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

    this.computeLabor(categories, budgetRaw.categories, this.catalog.getRooms(), phase, ceilingTakeoff(this.catalog));

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
    };
  }
}
