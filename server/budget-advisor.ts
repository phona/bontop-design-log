import type { ProjectCatalog } from './project-catalog.js';
import type { BudgetCalculator } from './budget-calculator.js';
import type { RuleEngine } from './rule-engine.js';
import type { CurrentScheme, Risk } from '../shared/types.js';

export interface BudgetSuggestion {
  topic: string;
  fromOptionId: string | null;
  fromName: string;
  toOptionId: string;
  toName: string;
  savings: number;
  loses: string;
  risksAdded: Risk[];
}

export interface AdviceResult {
  currentTotal: number;
  target: number;
  overBy: number;
  feasible: boolean;
  resultingTotal: number;
  suggestions: BudgetSuggestion[];
  maxSavings: number;
}

export class BudgetAdvisor {
  constructor(
    private catalog: ProjectCatalog,
    private calc: BudgetCalculator,
    private ruleEngine: RuleEngine
  ) {}

  suggest(scheme: CurrentScheme, target?: number): AdviceResult {
    const currentSnap = this.calc.calculate(scheme);
    const resolvedTarget = target ?? currentSnap.projectCeiling ?? currentSnap.totalBudget;
    const currentTotal = currentSnap.totalActual;
    const overBy = currentTotal - resolvedTarget;

    if (overBy <= 0) {
      return {
        currentTotal,
        target: resolvedTarget,
        overBy,
        feasible: true,
        resultingTotal: currentTotal,
        suggestions: [],
        maxSavings: 0,
      };
    }

    const currentRiskIds = new Set(
      this.ruleEngine.evaluate(scheme, this.catalog).risks.map((r) => r.id)
    );

    const candidates: BudgetSuggestion[] = [];

    for (const topic of this.catalog.getTopics()) {
      const currentOptionId = scheme.selections[topic.id]?.default ?? null;
      const options = this.catalog.getOptions(topic.id);
      if (options.length < 2) continue;

      const currentCost = currentSnap.lineItems
        .filter((li) => li.topic === topic.id)
        .reduce((s, li) => s + li.cost, 0);

      // 每个 topic 只取"最优降档"（省最多的选项）——同一 topic 的多个选项互斥，不可叠加
      let best: BudgetSuggestion | null = null;
      for (const option of options) {
        if (option.id === currentOptionId) continue;

        const simScheme: CurrentScheme = {
          updatedAt: new Date().toISOString(),
          selections: JSON.parse(JSON.stringify(scheme.selections)),
        };
        if (!simScheme.selections[topic.id]) {
          simScheme.selections[topic.id] = { default: null, roomOverrides: {} };
        }
        simScheme.selections[topic.id].default = option.id;

        const simSnap = this.calc.calculate(simScheme);
        const simCost = simSnap.lineItems
          .filter((li) => li.topic === topic.id)
          .reduce((s, li) => s + li.cost, 0);
        const savings = currentCost - simCost;
        if (savings <= 0) continue;
        if (best && savings <= best.savings) continue;

        const simRisks = this.ruleEngine.evaluate(simScheme, this.catalog).risks;
        const risksAdded = simRisks.filter((r) => !currentRiskIds.has(r.id));

        const affectedRooms = new Set(
          currentSnap.lineItems.filter((li) => li.topic === topic.id && li.roomId).map((li) => li.roomId as string)
        ).size;

        best = {
          topic: topic.id,
          fromOptionId: currentOptionId,
          fromName:
            (currentOptionId && this.catalog.getOption(topic.id, currentOptionId)?.name) ??
            String(currentOptionId),
          toOptionId: option.id,
          toName: option.name,
          savings,
          loses: this.describeLoses(option.data as Record<string, unknown> | undefined, affectedRooms),
          risksAdded,
        };
      }
      if (best) candidates.push(best);
    }

    candidates.sort((a, b) => b.savings - a.savings);

    const suggestions: BudgetSuggestion[] = [];
    let runningTotal = currentTotal;
    for (const cand of candidates) {
      if (runningTotal <= resolvedTarget) break;
      suggestions.push(cand);
      runningTotal -= cand.savings;
    }

    const maxSavings = candidates.reduce((s, c) => s + c.savings, 0);

    return {
      currentTotal,
      target: resolvedTarget,
      overBy,
      feasible: runningTotal <= resolvedTarget,
      resultingTotal: runningTotal,
      suggestions,
      maxSavings,
    };
  }

  private describeLoses(data: Record<string, unknown> | undefined, roomCount: number): string {
    const cons = (data?.cons as string[] | undefined) ?? [];
    const conPart = cons.length > 0 ? cons.join('；') : '档次/质感降低';
    const roomPart = roomCount > 0 ? `（影响 ${roomCount} 个房间）` : '';
    return `${conPart}${roomPart}`;
  }
}
