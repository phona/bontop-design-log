import type {
  CurrentScheme,
  BudgetSnapshot,
  BudgetLineItem,
  BudgetCategory,
  DesignRulesConfig,
  RoomLayout,
} from '../shared/types.js';
import type { ProjectCatalog } from './project-catalog.js';

const QUANTITY_FORMULAS: Record<string, (room: RoomLayout) => number> = {
  floorArea: (room) => room.width * room.depth,
  wetWallArea: (room) => (room.width + room.depth) * 2 * room.height * 0.7,
  paintWallArea: (room) => (room.width + room.depth) * 2 * room.height * 0.75,
};

export class BudgetCalculator {
  constructor(
    private catalog: ProjectCatalog,
    private rulesConfig: DesignRulesConfig
  ) {}

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
            topic: li.topic,
            roomId: room.id,
            optionId,
            quantity,
            unitPrice: pricePerUnit,
            coveragePerUnit,
            lossRate,
            cost,
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

    const totalBudget = categories.reduce((sum, c) => sum + c.budget, 0);
    const totalActual = categories.reduce((sum, c) => sum + c.actual, 0);

    return { totalBudget, totalActual, categories, lineItems: allLineItems };
  }
}
