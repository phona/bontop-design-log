import type { ProjectCatalog } from './project-catalog.js';
import type { BudgetCalculator } from './budget-calculator.js';
import type {
  CurrentScheme,
  DesignRulesConfig,
  CategoryValue,
  ValueBreakdownItem,
  ValueAlternative,
  BudgetLineItem,
} from '../shared/types.js';

// 把预算 lineItems 聚合成"价值叙事"：每个超支科目买到了什么（房间×材料×档次），
// 降级能省多少、会失去什么。让 AI/业主看到"超支换来了什么"，而非只有超支警报。
export class BudgetValueAnalyzer {
  constructor(
    private catalog: ProjectCatalog,
    private calc: BudgetCalculator,
    private rulesConfig: DesignRulesConfig
  ) {}

  analyzeCategory(scheme: CurrentScheme, categoryKey: string): CategoryValue | undefined {
    const snap = this.calc.calculate(scheme);
    const category = snap.categories.find((c) => c.key === categoryKey);
    if (!category) return undefined;

    const topicCategories = this.rulesConfig.budget?.topicCategories ?? {};
    const topicsForCategory = Object.entries(topicCategories)
      .filter(([, cat]) => cat === categoryKey)
      .map(([topic]) => topic);

    const items = snap.lineItems.filter((li) => topicsForCategory.includes(li.topic));

    const breakdown: ValueBreakdownItem[] = items
      .map((li) => {
        const option = this.catalog.getOption(li.topic, li.optionId);
        const data = option?.data as Record<string, unknown> | undefined;
        const room = li.roomId ? this.catalog.getRoom(li.roomId) : undefined;
        return {
          roomId: li.roomId,
          roomName: room?.name ?? (li.roomId ?? '全屋'),
          topic: li.topic,
          optionId: li.optionId,
          materialName: option?.name ?? li.optionId,
          quantity: li.quantity,
          unit: String(data?.unit ?? ''),
          unitPrice: li.unitPrice,
          cost: li.cost,
        };
      })
      .sort((a, b) => b.cost - a.cost);

    return {
      category: categoryKey,
      actual: category.actual,
      budget: category.budget,
      overBy: category.actual - category.budget,
      status: category.status,
      breakdown,
      alternatives: this.buildAlternatives(scheme, topicsForCategory, snap.lineItems),
    };
  }

  analyzeOverBudget(scheme: CurrentScheme): CategoryValue[] {
    const snap = this.calc.calculate(scheme);
    return snap.categories
      .filter((c) => c.status === 'over' || c.status === 'near')
      .map((c) => this.analyzeCategory(scheme, c.key))
      .filter((v): v is CategoryValue => v !== undefined);
  }

  private buildAlternatives(
    scheme: CurrentScheme,
    topics: string[],
    lineItems: BudgetLineItem[]
  ): ValueAlternative[] {
    const alternatives: ValueAlternative[] = [];
    for (const topic of topics) {
      const currentOptionId = scheme.selections[topic]?.default ?? null;
      const options = this.catalog.getOptions(topic);
      if (!currentOptionId || options.length < 2) continue;

      const currentOption = this.catalog.getOption(topic, currentOptionId);
      const currentPrice = currentOption?.price_per_unit ?? 0;
      const topicQty = lineItems
        .filter((li) => li.topic === topic)
        .reduce((s, li) => s + li.quantity, 0);
      const affectedRooms = new Set(
        lineItems.filter((li) => li.topic === topic && li.roomId).map((li) => li.roomId as string)
      );

      for (const option of options) {
        if (option.id === currentOptionId) continue;
        const price = option.price_per_unit ?? 0;
        if (price >= currentPrice) continue;
        const savings = (currentPrice - price) * (topicQty || 1);
        alternatives.push({
          topic,
          fromOptionId: currentOptionId,
          fromName: currentOption?.name ?? currentOptionId,
          toOptionId: option.id,
          toName: option.name,
          savings,
          loses: this.describeLoses(option, affectedRooms.size),
        });
      }
    }
    return alternatives.sort((a, b) => b.savings - a.savings);
  }

  private describeLoses(option: { data?: unknown }, roomCount: number): string {
    const data = option.data as Record<string, unknown> | undefined;
    const cons = (data?.cons as string[] | undefined) ?? [];
    const conPart = cons.length > 0 ? cons.join('；') : '档次/质感降低';
    const roomPart = roomCount > 0 ? `（影响 ${roomCount} 个房间）` : '';
    return `${conPart}${roomPart}`;
  }
}
