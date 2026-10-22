import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { BudgetAdvisor } from '../../server/budget-advisor.js';
import { RuleEngine } from '../../server/rule-engine.js';
import type { CurrentScheme } from '../../shared/types.js';

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
});
