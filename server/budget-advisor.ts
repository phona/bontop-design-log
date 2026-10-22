import type { ProjectCatalog } from './project-catalog.js';
import type { BudgetCalculator } from './budget-calculator.js';
import type { RuleEngine } from './rule-engine.js';
import type { BudgetSnapshot, CurrentScheme, Risk } from '../shared/types.js';

/**
 * 本模块的唯一总盘口径：**全额口径** = Σ lineItems.cost
 * （在快照上恒等于 Σ (category.manualActual + category.autoActual)，
 * 即人工 + 已取证材料 + candidate 候选价材料全额）。
 *
 * 历史教训（2026-10-22 审计实测）：2026-10-14 阶段 5 把快照的 `totalActual`
 * 改成已取证口径（只含 verified 材料 + 人工）后，本模块未同步——总盘用
 * totalActual、savings 却由 lineItems（全额口径）求差，跨口径扣减出幻影节省：
 * 对 candidate 占大头的 topic 声称省 ¥15,234，实际应用后 totalActual 一分未动、
 * feasible 假阳性。advisor 是规划工具（问的是「若候选价属实、换档后总盘多少」），
 * 故全程只用全额口径一个总盘：currentTotal、每条 savings、resultingTotal
 * 全部由 fullTotal() 求差，禁止再引用 totalActual。
 */
function fullTotal(snap: BudgetSnapshot): number {
  return snap.lineItems.reduce((s, li) => s + li.cost, 0);
}

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
    // 全额口径总盘（见文件头 fullTotal 注释）；不得改回 totalActual（已取证口径）。
    const currentTotal = fullTotal(currentSnap);
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
        // savings = 同一全额总盘在「只换这一个 topic」前后的差。它天然包含该 topic
        // 对其他 topic 行项的连带影响（如换砖连动瓦工人工），且与 currentTotal 同口径，
        // 不再按 topic 过滤 lineItems 求差——过滤口径曾与总盘口径不一致（见文件头）。
        const savings = currentTotal - fullTotal(simSnap);
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

    // 贪心选取：用单项 savings 累减决定取到哪一条为止（估算，仅用于选取）。
    const suggestions: BudgetSuggestion[] = [];
    let runningTotal = currentTotal;
    for (const cand of candidates) {
      if (runningTotal <= resolvedTarget) break;
      suggestions.push(cand);
      runningTotal -= cand.savings;
    }

    const maxSavings = candidates.reduce((s, c) => s + c.savings, 0);

    // 核定：把选中的建议全部应用后重跑 calculate()，resultingTotal / feasible
    // 以重跑的全额总盘为准——单项 savings 相加只是估算（topic 间连带影响会让
    // 组合结果偏离累减值），对外声称的数字必须与真实重跑一致，不许再用累减值冒充。
    let resultingTotal = currentTotal;
    if (suggestions.length > 0) {
      const appliedScheme: CurrentScheme = {
        updatedAt: new Date().toISOString(),
        selections: JSON.parse(JSON.stringify(scheme.selections)),
      };
      for (const s of suggestions) {
        if (!appliedScheme.selections[s.topic]) {
          appliedScheme.selections[s.topic] = { default: null, roomOverrides: {} };
        }
        appliedScheme.selections[s.topic].default = s.toOptionId;
      }
      resultingTotal = fullTotal(this.calc.calculate(appliedScheme));
    }

    return {
      currentTotal,
      target: resolvedTarget,
      overBy,
      feasible: resultingTotal <= resolvedTarget,
      resultingTotal,
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
