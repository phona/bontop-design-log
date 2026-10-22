import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { BudgetAdvisor } from '../../server/budget-advisor.js';
import { RuleEngine } from '../../server/rule-engine.js';
import type { BudgetSnapshot, CurrentScheme } from '../../shared/types.js';

function loadAdvisor() {
  const catalog = ProjectCatalog.load('.');
  const rules = RuleEngine.load('config/design-rules.yaml').getConfig();
  const calc = new BudgetCalculator(catalog, rules);
  const advisor = new BudgetAdvisor(catalog, calc, new RuleEngine(rules));
  return { advisor, calc };
}

function currentScheme(): CurrentScheme {
  return JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;
}

/**
 * advisor 的总盘口径：全额口径 = Σ lineItems.cost（人工 + 已取证 + candidate 全额）。
 * 不是 totalActual（已取证口径）——2026-10-22 修复前 advisor 混用两种口径产生幻影节省，
 * 本文件的目标值一律从全额总盘派生，与 advisor 内部口径一致。
 */
function fullTotal(calc: BudgetCalculator, scheme: CurrentScheme): number {
  return calc.calculate(scheme).lineItems.reduce((s, li) => s + li.cost, 0);
}

function applySuggestions(
  scheme: CurrentScheme,
  suggestions: Array<{ topic: string; toOptionId: string }>
): CurrentScheme {
  const applied: CurrentScheme = {
    updatedAt: new Date().toISOString(),
    selections: JSON.parse(JSON.stringify(scheme.selections)),
  };
  for (const s of suggestions) {
    if (!applied.selections[s.topic]) {
      applied.selections[s.topic] = { default: null, roomOverrides: {} };
    }
    applied.selections[s.topic].default = s.toOptionId;
  }
  return applied;
}

describe('BudgetAdvisor', () => {
  it('returns empty suggestions when under target', () => {
    const { advisor, calc } = loadAdvisor();
    const scheme = currentScheme();
    const total = fullTotal(calc, scheme);
    const result = advisor.suggest(scheme, total + 100000);
    assert.equal(result.suggestions.length, 0);
    assert.ok(result.overBy < 0);
    assert.equal(result.feasible, true);
  });

  it('suggests downgrades sorted by savings when over a tight target', () => {
    const { advisor, calc } = loadAdvisor();
    const scheme = currentScheme();
    const total = fullTotal(calc, scheme);
    const result = advisor.suggest(scheme, total - 6000);
    assert.ok(result.overBy > 0, 'over a tight target');
    assert.ok(result.suggestions.length > 0, 'has suggestions');
    for (let i = 1; i < result.suggestions.length; i++) {
      assert.ok(
        result.suggestions[i - 1].savings >= result.suggestions[i].savings,
        'suggestions sorted by savings desc'
      );
    }
    assert.ok(result.feasible, 'greedy should fit given large hvac downgrade available');
    assert.ok(result.resultingTotal <= result.target);
  });

  it('reports infeasible when target cannot be reached', () => {
    const { advisor, calc } = loadAdvisor();
    const scheme = currentScheme();
    const total = fullTotal(calc, scheme);
    const result = advisor.suggest(scheme, total - 1000000);
    assert.equal(result.feasible, false);
    assert.ok(result.maxSavings < 1000000);
  });

  it('uses project ceiling as default target', () => {
    const { advisor } = loadAdvisor();
    const scheme = currentScheme();
    const result = advisor.suggest(scheme);
    // 默认目标是一期执行上限（schedule/phase-1/control.yaml phase_ceiling_cny=210000），
    // 不再是 config/budget/base.json 的作废值 190,000。
    assert.equal(result.target, 210000);
  });

  it('each suggestion describes what is lost (loses)', () => {
    const { advisor, calc } = loadAdvisor();
    const scheme = currentScheme();
    const total = fullTotal(calc, scheme);
    const result = advisor.suggest(scheme, total - 6000);
    assert.ok(result.suggestions.length > 0);
    for (const s of result.suggestions) {
      assert.ok(s.loses && s.loses.length > 0, `suggestion ${s.topic} has loses description`);
    }
  });

  it('suggests at most one option per topic (mutually exclusive swaps)', () => {
    const { advisor, calc } = loadAdvisor();
    const scheme = currentScheme();
    const total = fullTotal(calc, scheme);
    // 2026-10-13 阶段 2 第二半：floor 的材料量从 121.51㎡ 变成 123.34㎡（含主走廊 extra），
    // 单是 floor 换砖的最大可省就从 ~14k 抬到 15,088。
    // 2026-10-13 阶段 3：hvac 只剩成交方案 A2（七套 invented 方案已删），原本「hvac 换便宜方案
    // 省 14,000」这条降级路径消失，全库最大可省从 ~44k 降到 27,387.627——所以缺口取 20k：
    // 仍需 2 个 topic（floor 15,087.627 + dresser 6,600），足以检验「同一 topic 不出两条互斥建议」。
    // 2026-10-22 口径修复：目标改从全额总盘派生（见文件头 fullTotal），缺口仍取 20k、场景不变。
    const result = advisor.suggest(scheme, total - 20000);
    const topics = result.suggestions.map((s) => s.topic);
    assert.equal(new Set(topics).size, topics.length, 'no duplicate topics');
    assert.ok(result.suggestions.length >= 2, `needs 2+ topics to cover 20k (got ${result.suggestions.length})`);
    assert.ok(result.feasible);
    assert.ok(result.resultingTotal <= result.target);
  });

  it('candidate-heavy topics: claimed totals match a real re-run (no phantom savings)', () => {
    const { advisor, calc } = loadAdvisor();
    const scheme = currentScheme();
    const before = fullTotal(calc, scheme);
    // 回归场景 = 2026-10-22 审计探针：目标 52,789 时旧实现用已取证口径总盘
    // （totalActual 65,987）扣全额口径的 floor 节省 15,234，声称 resultingTotal
    // 50,752 且 feasible——但那笔节省全在 candidate 桶里，totalActual 里根本没有，
    // 真实应用后一分未动。现行方案 41 条选材绝大多数是 candidate，正中此场景。
    const result = advisor.suggest(scheme, 52789);
    assert.ok(
      Math.abs(result.currentTotal - before) < 0.01,
      `currentTotal 必须是全额总盘 ${before}，实际 ${result.currentTotal}`
    );
    assert.equal(result.feasible, false, '全额口径下 52,789 不可达，不许假阳性');
    // 声称的 resultingTotal 必须等于「把全部建议真实应用后重跑」的总盘。
    const appliedTotal = fullTotal(calc, applySuggestions(scheme, result.suggestions));
    assert.ok(
      Math.abs(appliedTotal - result.resultingTotal) < 0.01,
      `resultingTotal 声称 ${result.resultingTotal}，真实重跑 ${appliedTotal}`
    );
    // 单条核对（floor 是 candidate 占大头的 topic）：声称的节省必须等于真实总盘变化。
    const floor = result.suggestions.find((s) => s.topic === 'floor');
    assert.ok(floor, 'floor downgrade should be among suggestions');
    const moved = before - fullTotal(calc, applySuggestions(scheme, [floor]));
    assert.ok(
      Math.abs(moved - floor.savings) < 0.01,
      `floor 声称省 ${floor.savings}，真实应用后总盘只动了 ${moved}`
    );
  });

  /**
   * 非加法联动场景（2026-10-23 独立评审 P1）：三个 topic 各自降档省 400，
   * 且任一降档都触发同一笔共享节省 300（只计一次）。于是单项 savings 各 700、
   * 单项之和 2,100，但真实组合节省只有 400×3 + 300 = 1,500。
   * 旧实现用单项累减选取：取两条即「估算达标」停手，建议集真实重跑仍超标，
   * 报 feasible:false——漏掉了三条全取的可行组合；maxSavings 也虚增为 2,100。
   * 序贯边际贪心必须：按真实边际继续取第三条 → feasible:true，且 maxSavings
   * 等于真实组合节省 1,500。
   */
  it('non-additive interaction: marginal greedy finds the feasible set, maxSavings is the true combined value', () => {
    const topics = ['A', 'B', 'C'];
    const fakeCatalog = {
      getTopics: () => topics.map((id) => ({ id })),
      getOptions: (topicId: string) => [
        { id: `${topicId}-std`, name: `${topicId} 标准` },
        { id: `${topicId}-down`, name: `${topicId} 降档`, data: { cons: ['测试降档代价'] } },
      ],
      getOption: (topicId: string, optionId: string) => ({
        id: optionId,
        name: optionId.endsWith('-down') ? `${topicId} 降档` : `${topicId} 标准`,
      }),
    };
    const fakeCalc = {
      calculate: (s: CurrentScheme): BudgetSnapshot => {
        const down = topics.filter((t) => s.selections[t]?.default === `${t}-down`);
        const lineItems = [
          ...topics.map((t) => ({ topic: t, cost: down.includes(t) ? 600 : 1000 })),
          // 共享行项：任一 topic 降档即从 500 降到 200，多个降档不叠加。
          { topic: 'shared', cost: down.length > 0 ? 200 : 500 },
        ];
        return { lineItems } as unknown as BudgetSnapshot;
      },
    };
    const fakeRules = { evaluate: () => ({ risks: [] }) };
    const advisor = new BudgetAdvisor(
      fakeCatalog as unknown as ProjectCatalog,
      fakeCalc as unknown as BudgetCalculator,
      fakeRules as unknown as RuleEngine
    );
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: Object.fromEntries(
        topics.map((t) => [t, { default: `${t}-std`, roomOverrides: {} }])
      ),
    };
    const fakeFullTotal = (s: CurrentScheme): number =>
      fakeCalc.calculate(s).lineItems.reduce((sum, li) => sum + li.cost, 0);
    assert.equal(fakeFullTotal(scheme), 3500, '场景基线总盘');

    // 目标 2,200（需省 ≥1,300）：两项组合真实只省 1,100（不可行），三项省 1,500（可行）。
    const result = advisor.suggest(scheme, 2200);
    assert.equal(result.feasible, true, '三条全取可行，不许因单项累减提前停手而误报 infeasible');
    assert.equal(result.resultingTotal, 2000);
    assert.deepEqual(
      result.suggestions.map((s) => s.topic).sort(),
      ['A', 'B', 'C'],
      '建议集必须是三条全取'
    );
    // resultingTotal 必须与独立重跑一致。
    assert.equal(fakeFullTotal(applySuggestions(scheme, result.suggestions)), result.resultingTotal);
    // 每条 savings 是选入时的边际节省（700/400/400），不是单项 700×3：
    // Σ suggestions.savings 恒等于 currentTotal − resultingTotal。
    assert.deepEqual(
      result.suggestions.map((s) => s.savings).sort((a, b) => b - a),
      [700, 400, 400],
      '边际 savings 应为 700/400/400（共享节省只在首条计一次）'
    );
    assert.equal(
      result.suggestions.reduce((sum, s) => sum + s.savings, 0),
      result.currentTotal - result.resultingTotal,
      'Σ 边际 savings 必须等于总盘真实降幅'
    );
    // maxSavings = 真实组合节省 1,500，不是单项之和 2,100。
    assert.equal(result.maxSavings, 1500, `maxSavings 应为真实组合节省 1500，实际 ${result.maxSavings}`);
    // maxSavings 也必须等于「全部候选一并应用」的真实重跑总盘差。
    const allDown: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: Object.fromEntries(
        topics.map((t) => [t, { default: `${t}-down`, roomOverrides: {} }])
      ),
    };
    assert.equal(result.maxSavings, result.currentTotal - fakeFullTotal(allDown));

    // 不可达目标下同样不得虚增：maxSavings 仍是 1,500，resultingTotal 停在 2,000。
    const impossible = advisor.suggest(scheme, 0);
    assert.equal(impossible.feasible, false);
    assert.equal(impossible.resultingTotal, 2000);
    assert.equal(impossible.maxSavings, 1500);
  });
});
