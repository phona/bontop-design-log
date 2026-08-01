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

describe('BudgetAdvisor', () => {
  it('returns empty suggestions when under target', () => {
    const { advisor, calc } = loadAdvisor();
    const scheme = currentScheme();
    const total = calc.calculate(scheme).totalActual;
    const result = advisor.suggest(scheme, total + 100000);
    assert.equal(result.suggestions.length, 0);
    assert.ok(result.overBy < 0);
    assert.equal(result.feasible, true);
  });

  it('suggests downgrades sorted by savings when over a tight target', () => {
    const { advisor, calc } = loadAdvisor();
    const scheme = currentScheme();
    const total = calc.calculate(scheme).totalActual;
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
    const total = calc.calculate(scheme).totalActual;
    const result = advisor.suggest(scheme, total - 1000000);
    assert.equal(result.feasible, false);
    assert.ok(result.maxSavings < 1000000);
  });

  it('uses project ceiling as default target', () => {
    const { advisor } = loadAdvisor();
    const scheme = currentScheme();
    const result = advisor.suggest(scheme);
    assert.equal(result.target, 190000);
  });

  it('suggests at most one option per topic (mutually exclusive swaps)', () => {
    const { advisor, calc } = loadAdvisor();
    const scheme = currentScheme();
    const total = calc.calculate(scheme).totalActual;
    // target 在理论最大可省范围内（~16.7k），确保可达
    const result = advisor.suggest(scheme, total - 15000);
    const topics = result.suggestions.map((s) => s.topic);
    assert.equal(new Set(topics).size, topics.length, 'no duplicate topics');
    assert.ok(result.suggestions.length >= 2, 'needs 2+ topics to cover 15k (hvac max 14k)');
    assert.ok(result.feasible);
    assert.ok(result.resultingTotal <= result.target);
  });
});
