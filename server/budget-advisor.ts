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

    // 在「原方案 + 给定建议集」上重跑 calculate() 的全额总盘。选取与核定共用
    // 同一个重跑入口，保证对外声称的每个数字都来自真实重跑（见文件头注释）。
    const totalWith = (extra: BudgetSuggestion[]): number => {
      const appliedScheme: CurrentScheme = {
        updatedAt: new Date().toISOString(),
        selections: JSON.parse(JSON.stringify(scheme.selections)),
      };
      for (const s of extra) {
        if (!appliedScheme.selections[s.topic]) {
          appliedScheme.selections[s.topic] = { default: null, roomOverrides: {} };
        }
        appliedScheme.selections[s.topic].default = s.toOptionId;
      }
      return fullTotal(this.calc.calculate(appliedScheme));
    };

    // 序贯边际贪心（2026-10-23 独立评审 P1 修订）：旧实现用单项 savings 累减
    // runningTotal 决定取舍、maxSavings 取单项之和。topic 间有联动时组合节省
    // ≠ 单项之和（共享节省被每个单项各计一次），累减值会先于真实总盘「达标」：
    // 建议集真实重跑仍超标，又因以为选完而漏掉「再多选一条即可行」的组合，
    // 还会把 feasible 误报为 false。现在每轮都在已选集（appliedScheme 的内存
    // 形态即 suggestions）基础上逐个重跑剩余候选，边际节省 = 当前已选集总盘
    // − 加入该候选后的总盘，取边际最大且为正的一条应用，重算下一轮，直到
    // 达标或无正边际。suggestions 里每条的 savings 记为它被选入时的边际节省
    // （候选阶段的单项 savings 只用于同 topic 内挑最优降档选项，不对外），
    // 于是 Σ suggestions.savings 恒等于 currentTotal − resultingTotal。
    // 语义边界：这是边际贪心而非穷举搜索，不保证全局最优组合；
    // feasible / resultingTotal 描述的是所构造建议集的真实重跑结果，
    // maxSavings 是全部候选一并应用的真实组合节省——不再有估算冒充核定值。
    const suggestions: BudgetSuggestion[] = [];
    const chosenTopics = new Set<string>();
    let resultingTotal = currentTotal;
    while (resultingTotal > resolvedTarget) {
      let bestCand: BudgetSuggestion | null = null;
      let bestTotal = resultingTotal;
      for (const cand of candidates) {
        if (chosenTopics.has(cand.topic)) continue;
        const total = totalWith([...suggestions, cand]);
        if (total < bestTotal) {
          bestCand = cand;
          bestTotal = total;
        }
      }
      if (!bestCand) break;
      // 边际节省覆写单项 savings 后入选（见上方注释的 Σ 恒等式）。
      suggestions.push({ ...bestCand, savings: resultingTotal - bestTotal });
      chosenTopics.add(bestCand.topic);
      resultingTotal = bestTotal;
    }
    // 返回顺序 = 贪心选入顺序，**不得重排**（2026-10-23 评审 P2）：每条 savings
    // 是「在排在它前面的建议已全部应用」前提下的边际节省——按返回顺序逐条
    // 执行，每一步的实际节省恰为其标注值，累积到达 resultingTotal；若按
    // savings 降序重排，互补型候选的边际值（如单独只省 50、组合里边际 900）
    // 会跑到前面，读者按列表顺序单独执行该条时实际节省与其标注不符。
    // 互补场景下选入序的 savings 本就不是单调降序，这是语义而非乱序。

    // maxSavings = 全部候选一并应用的真实组合节省，不是单项之和：联动场景下
    // 单项之和会把共享节省重复计入，虚增可省空间（评审实测可高估近一倍）。
    const maxSavings = candidates.length > 0 ? currentTotal - totalWith(candidates) : 0;

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
