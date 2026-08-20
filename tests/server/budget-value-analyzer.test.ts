import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { BudgetValueAnalyzer } from '../../server/budget-value-analyzer.js';
import { RuleEngine } from '../../server/rule-engine.js';
import type { CurrentScheme } from '../../shared/types.js';

function loadAnalyzer() {
  const catalog = ProjectCatalog.load('.');
  const rules = RuleEngine.load('config/design-rules.yaml').getConfig();
  const calc = new BudgetCalculator(catalog, rules);
  const analyzer = new BudgetValueAnalyzer(catalog, calc, rules);
  return { analyzer, calc };
}

function currentScheme(): CurrentScheme {
  return JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;
}

function schemeWithPremiumWall(): CurrentScheme {
  const scheme = currentScheme();
  return {
    ...scheme,
    selections: {
      ...scheme.selections,
      wall: { ...scheme.selections.wall, default: 'wall_tile_02' },
    },
  };
}

describe('BudgetValueAnalyzer', () => {
  it('analyzes masonry with room×material breakdown', () => {
    const { analyzer } = loadAnalyzer();
    const value = analyzer.analyzeCategory(currentScheme(), 'masonry');
    assert.ok(value, 'masonry category exists');
    assert.ok(value!.breakdown.length > 0, 'has breakdown items');
    const item = value!.breakdown[0];
    assert.ok(item.roomName, 'breakdown has roomName');
    assert.ok(item.materialName, 'breakdown has materialName');
    assert.ok(item.cost > 0, 'breakdown has cost');
    const sorted = [...value!.breakdown].sort((a, b) => b.cost - a.cost);
    assert.deepEqual(value!.breakdown, sorted, 'breakdown sorted by cost desc');
  });

  it('provides cheaper alternatives with loses description', () => {
    const { analyzer } = loadAnalyzer();
    const value = analyzer.analyzeCategory(schemeWithPremiumWall(), 'masonry');
    assert.ok(value);
    assert.ok(value!.alternatives.length > 0, 'masonry has cheaper floor/wall alternatives');
    const alt = value!.alternatives[0];
    assert.ok(alt.savings > 0, 'alternative saves money');
    assert.ok(alt.loses.length > 0, 'alternative describes what is lost');
    const sorted = [...value!.alternatives].sort((a, b) => b.savings - a.savings);
    assert.deepEqual(value!.alternatives, sorted, 'alternatives sorted by savings desc');
  });

  it('analyzeOverBudget returns only over/near categories', () => {
    const { analyzer } = loadAnalyzer();
    const values = analyzer.analyzeOverBudget(currentScheme());
    assert.ok(values.length > 0, 'has over/near categories');
    for (const v of values) {
      assert.ok(v.status === 'over' || v.status === 'near', `${v.category} is over/near`);
    }
  });

  it('returns undefined for unknown category', () => {
    const { analyzer } = loadAnalyzer();
    assert.equal(analyzer.analyzeCategory(currentScheme(), 'nonexistent'), undefined);
  });
});
