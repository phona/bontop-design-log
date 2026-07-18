import { readFileSync } from 'node:fs';
import type {
  CurrentScheme,
  BudgetSnapshot,
  BudgetLineItem,
  BudgetCategory,
  DesignRulesConfig,
  RoomLayout,
  FurnishingsYaml,
  BudgetCategoryRaw,
} from '../shared/types.js';
import type { ProjectCatalog } from './project-catalog.js';

const QUANTITY_FORMULAS: Record<string, (room: RoomLayout) => number> = {
  floorArea: (room) => room.area ?? room.width * room.depth,
  wetWallArea: (room) => (room.width + room.depth) * 2 * room.height * 0.7,
  paintWallArea: (room) => (room.width + room.depth) * 2 * room.height * 0.75,
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
    furnishings: FurnishingsYaml
  ): void {
    for (const cat of categories) {
      const raw = baseRaw[cat.key];
      if (!raw?.labor) continue;

      const { rate, area } = raw.labor;
      let quantity = 0;

      switch (area) {
        case 'floor':
          quantity = rooms.reduce((sum, r) => sum + r.width * r.depth, 0);
          break;
        case 'ceiling':
          quantity = rooms.reduce((sum, r) => sum + r.width * r.depth, 0);
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
          for (const items of Object.values(furnishings)) {
            count += items['interior_door'] ?? 0;
            count += items['bathroom_door'] ?? 0;
            count += items['entry_door'] ?? 0;
            count += items['door'] ?? 0;
          }
          quantity = count;
          break;
        }
        case 'fixture_count': {
          let count = 0;
          for (const items of Object.values(furnishings)) {
            count += items['toilet'] ?? 0;
            count += items['shower_set'] ?? 0;
            count += items['vanity'] ?? 0;
            count += items['faucet'] ?? 0;
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

  calculate(scheme: CurrentScheme): BudgetSnapshot {
    const topicCategories = this.rulesConfig.budget?.topicCategories ?? {};
    const lineItems = this.rulesConfig.budget?.lineItems ?? [];
    const baseCategories = this.catalog.getBudgetCategories();

    const allLineItems: BudgetLineItem[] = [];
    const categoryAutoActual = new Map<string, number>();

    for (const li of lineItems) {
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
        const furnishings = this.catalog.getFurnishings();
        let totalCost = 0;
        for (const [roomId, items] of Object.entries(furnishings)) {
          const qty = items[li.topic];
          if (!qty || qty <= 0) continue;
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
          const overrideOptionId = scheme.selections[li.topic]?.roomOverrides[room.id];
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
    ) as { categories: Record<string, BudgetCategoryRaw> };

    const categories: BudgetCategory[] = baseCategories.map((bc) => {
      const autoActual = categoryAutoActual.get(bc.key) ?? 0;
      return {
        key: bc.key,
        budget: bc.budget,
        actual: bc.actual + autoActual,
        manualActual: bc.actual,
        autoActual,
        status: bc.status,
        notes: bc.notes,
      };
    });

    this.computeLabor(categories, budgetRaw.categories, this.catalog.getRooms(), this.catalog.getFurnishings());

    const totalBudget = categories.reduce((sum, c) => sum + c.budget, 0);
    const totalActual = categories.reduce((sum, c) => sum + c.actual, 0);

    return { totalBudget, totalActual, categories, lineItems: allLineItems };
  }
}
