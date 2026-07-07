# Spec 4: Rule Engine + Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a rule engine for budget calculation, risk/constraint evaluation, config hot-reload, and scheme archive/restore/diff.

**Architecture:** The RuleEngine loads `config/design-rules.yaml` and evaluates risks and constraints against the CurrentScheme. BudgetCalculator computes per-topic costs using room dimensions and material properties, mapping to `budget/base.json` categories. ArchivedSchemesStore provides CRUD with pinyin slug IDs. A file watcher enables hot-reload of design rules during development. New REST endpoints and MCP tools expose all functionality.

**Tech Stack:** TypeScript (NodeNext), `node:test`, `chokidar` (file watching), `pinyin-pro` (slug generation), `js-yaml` (config parsing), Express (REST), MCP SDK (tools)

## Global Constraints

- All imports use `.js` extension for NodeNext compatibility
- Use `node:test` for all server-side tests
- `config/design-rules.yaml` parse failure keeps old config, logs error
- Archived scheme IDs: `archived_YYYYMMDD_HHMMSS_<slug>` format
- Slug: pinyin-pro → lowercase → replace non-alphanumeric with `-` → truncate 30 chars
- Budget formula: per-room = `price_per_unit × quantity ÷ coverage_per_unit × loss_rate`; global = `price_per_unit`
- Quantity: floor = `w×d`, wall = `(w+d)×2×h×0.7`, paint = `(w+d)×2×h×0.75`
- Restore: full overwrite, DecisionLog entries with `archiveId`, last-write-wins
- Diff: path-based (`topic.default`, `topic.roomOverrides.<roomId>`), only differences

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `shared/types.ts` | Modify | Add Spec 4 types (Risk, ConstraintViolation, BudgetSnapshot, ArchivedScheme, DiffEntry) |
| `server/rule-engine.ts` | Create | Load design-rules.yaml, evaluate risks/constraints, condition parser |
| `server/budget-calculator.ts` | Create | Calculate budget from CurrentScheme + catalog + rules |
| `server/design-rules-watcher.ts` | Create | Watch config/design-rules.yaml, hot-reload RuleEngine |
| `server/archived-schemes.ts` | Create | Archive CRUD, diff, slug generation |
| `server/routes.ts` | Modify | Add budget/risks/schemes endpoints |
| `server/mcp-server.ts` | Modify | Add get_budget, get_risks, archive/restore/design-check tools |
| `server/index.ts` | Modify | Wire watcher, rule engine, budget calc, archive store |
| `tests/server/rule-engine.test.ts` | Create | Rule engine unit tests |
| `tests/server/budget-calculator.test.ts` | Create | Budget calculation tests |
| `tests/server/archived-schemes.test.ts` | Create | Archive CRUD + diff tests |
| `tests/server/budget-api.test.ts` | Create | Budget/risks/schemes REST API integration tests |
| `package.json` | Modify | Add `chokidar` and `pinyin-pro` dependencies |

---

### Task 1: Shared Types + Dependencies

**Files:**
- Modify: `shared/types.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing types (CurrentScheme, TopicSelection, DecisionLogEntry)
- Produces: Risk, ConstraintViolation, BudgetLineItem, BudgetSnapshot, DesignCheckResult, ArchivedScheme, DiffEntry, DesignRulesConfig

- [ ] **Step 1: Install new dependencies**

```bash
npm install chokidar pinyin-pro
```

- [ ] **Step 2: Add Spec 4 types to `shared/types.ts`**

Append before the final closing of the file (after the `CatalogTopic` interface):

```typescript
export interface Risk {
  id: string;
  severity: 'warning' | 'error' | 'info';
  message: string;
  topic: string;
  roomId: string | null;
}

export interface ConstraintViolation {
  id: string;
  description: string;
  topic: string;
  roomId: string | null;
  requirement: {
    topic: string;
    minValue?: { field: string; value: number };
  };
}

export interface DesignCheckResult {
  risks: Risk[];
  constraintViolations: ConstraintViolation[];
}

export interface BudgetLineItem {
  topic: string;
  roomId: string | null;
  optionId: string;
  quantity: number;
  unitPrice: number;
  coveragePerUnit: number;
  lossRate: number;
  cost: number;
}

export interface BudgetCategory {
  key: string;
  budget: number;
  actual: number;
  manualActual: number;
  autoActual: number;
  status: string;
  notes: string;
}

export interface BudgetSnapshot {
  totalBudget: number;
  totalActual: number;
  categories: BudgetCategory[];
  lineItems: BudgetLineItem[];
}

export interface ArchivedScheme {
  id: string;
  name: string;
  selections: Record<string, TopicSelection>;
  reason?: string;
  createdAt: string;
}

export interface DiffEntry {
  path: string;
  current: string | null;
  archived: string | null;
}

export interface DesignRulesConfig {
  version: string;
  objectMapping?: Array<{ pattern: string; topics: string[] }>;
  budget?: {
    baseCategoriesFrom?: string;
    topicCategories?: Record<string, string>;
    lineItems?: Array<{ topic: string; quantityField?: string }>;
  };
  risks?: Array<{
    id: string;
    severity: 'warning' | 'error' | 'info';
    message: string;
    when: { topic: string; options?: string[]; condition?: string };
  }>;
  constraints?: Array<{
    id: string;
    description: string;
    when: { topic: string; condition: string };
    require: { topic: string; minValue?: { field: string; value: number } };
  }>;
}
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```

---

### Task 2: Rule Engine

**Files:**
- Create: `server/rule-engine.ts`
- Create: `tests/server/rule-engine.test.ts`

**Interfaces:**
- Consumes: DesignRulesConfig, CurrentScheme, ProjectCatalog
- Produces: DesignCheckResult (risks + constraintViolations)

- [ ] **Step 1: Create `server/rule-engine.ts`**

```typescript
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type {
  CurrentScheme,
  DesignRulesConfig,
  Risk,
  ConstraintViolation,
  DesignCheckResult,
} from '../shared/types.js';
import type { ProjectCatalog } from './project-catalog.js';

interface ConditionContext {
  topic: string | null;
  room: string | null;
  selection: Record<string, string | null>;
  option: Record<string, unknown> | null;
}

function resolveVariable(varPath: string, ctx: ConditionContext): unknown {
  if (varPath === '$topic') return ctx.topic;
  if (varPath === '$room') return ctx.room;
  if (varPath.startsWith('$selection.')) {
    const topicName = varPath.slice('$selection.'.length);
    return ctx.selection[topicName] ?? null;
  }
  if (varPath.startsWith('$option.')) {
    if (!ctx.option) return undefined;
    const field = varPath.slice('$option.'.length);
    return ctx.option[field];
  }
  return undefined;
}

function parseLiteral(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseList(value: string): unknown[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  const inner = trimmed.slice(1, -1);
  return inner.split(',').map((s) => parseLiteral(s));
}

function evaluateCondition(condition: string, ctx: ConditionContext): boolean {
  const operators = ['not in', 'in', '>=', '<=', '!=', '==', '>', '<'];
  for (const op of operators) {
    const idx = condition.indexOf(` ${op} `);
    if (idx === -1) continue;
    const leftStr = condition.slice(0, idx).trim();
    const rightStr = condition.slice(idx + op.length + 2).trim();
    const leftVal = resolveVariable(leftStr, ctx);
    if (op === 'in') {
      const list = parseList(rightStr);
      return list.some((item) => String(item) === String(leftVal));
    }
    if (op === 'not in') {
      const list = parseList(rightStr);
      return !list.some((item) => String(item) === String(leftVal));
    }
    const rightVal = parseLiteral(rightStr);
    switch (op) {
      case '==': return leftVal == rightVal;
      case '!=': return leftVal != rightVal;
      case '>': return Number(leftVal) > Number(rightVal);
      case '<': return Number(leftVal) < Number(rightVal);
      case '>=': return Number(leftVal) >= Number(rightVal);
      case '<=': return Number(leftVal) <= Number(rightVal);
    }
  }
  return false;
}

export class RuleEngine {
  private config: DesignRulesConfig;

  constructor(config: DesignRulesConfig) {
    this.config = config;
  }

  static load(configPath = 'config/design-rules.yaml'): RuleEngine {
    const raw = readFileSync(configPath, 'utf8');
    const config = load(raw) as DesignRulesConfig;
    return new RuleEngine(config);
  }

  getConfig(): DesignRulesConfig {
    return this.config;
  }

  evaluate(
    scheme: CurrentScheme,
    catalog: ProjectCatalog
  ): DesignCheckResult {
    const risks = this.evaluateRisks(scheme, catalog);
    const constraintViolations = this.evaluateConstraints(scheme, catalog);
    return { risks, constraintViolations };
  }

  private getSelectionMap(scheme: CurrentScheme): Record<string, string | null> {
    const map: Record<string, string | null> = {};
    for (const [topic, sel] of Object.entries(scheme.selections)) {
      map[topic] = sel.default;
    }
    return map;
  }

  private evaluateRisks(
    scheme: CurrentScheme,
    catalog: ProjectCatalog
  ): Risk[] {
    const rules = this.config.risks ?? [];
    const selectionMap = this.getSelectionMap(scheme);
    const risks: Risk[] = [];

    for (const rule of rules) {
      const { when } = rule;
      const selectedOptionId = selectionMap[when.topic] ?? null;
      if (!selectedOptionId) continue;

      let triggered = false;
      if (when.options && when.options.length > 0) {
        triggered = when.options.includes(selectedOptionId);
      } else if (when.condition) {
        const option = catalog.getOption(when.topic, selectedOptionId);
        const ctx: ConditionContext = {
          topic: selectedOptionId,
          room: null,
          selection: selectionMap,
          option: option?.data ? option.data as Record<string, unknown> : null,
        };
        triggered = evaluateCondition(when.condition, ctx);
      }

      if (triggered) {
        let message = rule.message;
        const option = catalog.getOption(when.topic, selectedOptionId);
        if (option) {
          message = message.replace(`{{${when.topic}.name}}`, option.name);
        }
        risks.push({
          id: rule.id,
          severity: rule.severity,
          message,
          topic: when.topic,
          roomId: null,
        });
      }
    }
    return risks;
  }

  private evaluateConstraints(
    scheme: CurrentScheme,
    catalog: ProjectCatalog
  ): ConstraintViolation[] {
    const rules = this.config.constraints ?? [];
    const selectionMap = this.getSelectionMap(scheme);
    const violations: ConstraintViolation[] = [];

    for (const rule of rules) {
      const { when, require } = rule;
      const selectedOptionId = selectionMap[when.topic] ?? null;
      if (!selectedOptionId) continue;

      const option = catalog.getOption(when.topic, selectedOptionId);
      const ctx: ConditionContext = {
        topic: selectedOptionId,
        room: null,
        selection: selectionMap,
        option: option?.data ? option.data as Record<string, unknown> : null,
      };

      const triggered = evaluateCondition(when.condition, ctx);
      if (!triggered) continue;

      const requiredTopic = catalog.getTopic(require.topic);
      if (!requiredTopic) continue;

      const requiredOptionId = selectionMap[require.topic];
      if (!requiredOptionId) {
        violations.push({
          id: rule.id,
          description: rule.description,
          topic: when.topic,
          roomId: null,
          requirement: { topic: require.topic, minValue: require.minValue },
        });
        continue;
      }

      if (require.minValue) {
        const requiredOption = catalog.getOption(require.topic, requiredOptionId);
        if (!requiredOption) {
          violations.push({
            id: rule.id,
            description: rule.description,
            topic: when.topic,
            roomId: null,
            requirement: { topic: require.topic, minValue: require.minValue },
          });
          continue;
        }
        const data = requiredOption.data as Record<string, unknown> | undefined;
        const fieldValue = data?.[require.minValue.field];
        if (fieldValue === undefined || Number(fieldValue) < require.minValue.value) {
          violations.push({
            id: rule.id,
            description: rule.description,
            topic: when.topic,
            roomId: null,
            requirement: { topic: require.topic, minValue: require.minValue },
          });
        }
      }
    }
    return violations;
  }
}

export { evaluateCondition, type ConditionContext };
```

- [ ] **Step 2: Create `tests/server/rule-engine.test.ts`**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RuleEngine, evaluateCondition } from '../../server/rule-engine.js';
import type { ConditionContext } from '../../server/rule-engine.js';
import type { CurrentScheme, DesignRulesConfig } from '../../shared/types.js';

function makeContext(overrides: Partial<ConditionContext> = {}): ConditionContext {
  return {
    topic: 'A2',
    room: null,
    selection: { hvac: 'A2', floor: 'floor_tile_01' },
    option: null,
    ...overrides,
  };
}

describe('evaluateCondition', () => {
  it('handles == operator', () => {
    assert.equal(evaluateCondition('$topic == "A2"', makeContext()), true);
    assert.equal(evaluateCondition('$topic == "A1"', makeContext()), false);
  });

  it('handles != operator', () => {
    assert.equal(evaluateCondition('$topic != "A1"', makeContext()), true);
  });

  it('handles in operator', () => {
    assert.equal(
      evaluateCondition('$topic in ["A1", "A2", "B1"]', makeContext()),
      true
    );
    assert.equal(
      evaluateCondition('$topic in ["E1", "F2"]', makeContext()),
      false
    );
  });

  it('handles not in operator', () => {
    assert.equal(
      evaluateCondition('$topic not in ["E1", "F2"]', makeContext()),
      true
    );
  });

  it('handles > and < operators', () => {
    const ctx = makeContext({ option: { airflow: 25 } });
    assert.equal(evaluateCondition('$option.airflow > 20', ctx), true);
    assert.equal(evaluateCondition('$option.airflow < 20', ctx), false);
  });

  it('handles >= and <= operators', () => {
    const ctx = makeContext({ option: { price: 3000 } });
    assert.equal(evaluateCondition('$option.price >= 3000', ctx), true);
    assert.equal(evaluateCondition('$option.price <= 3000', ctx), true);
  });

  it('handles $selection variable', () => {
    assert.equal(
      evaluateCondition('$selection.hvac == "A2"', makeContext()),
      true
    );
  });
});

describe('RuleEngine', () => {
  const config: DesignRulesConfig = {
    version: '1.0',
    risks: [
      {
        id: 'platform_width',
        severity: 'warning',
        message: '{{hvac.name}} 外机摆放紧张，需现场确认',
        when: { topic: 'hvac', options: ['B1', 'B2', 'E1'] },
      },
    ],
    constraints: [
      {
        id: 'high_airflow_requires_hood',
        description: '大风量 HVAC 方案必须配大功率油烟机',
        when: { topic: 'hvac', condition: '$topic in ["B1", "B2", "E1"]' },
        require: {
          topic: 'range_hood',
          minValue: { field: 'airflow', value: 22 },
        },
      },
    ],
  };

  it('returns empty risks when no rule matches', () => {
    const engine = new RuleEngine(config);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
      },
    };
    const result = engine.evaluate(scheme, {} as any);
    assert.equal(result.risks.length, 0);
  });

  it('returns risk when option matches', () => {
    const engine = new RuleEngine(config);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'B1', roomOverrides: {} },
      },
    };
    const result = engine.evaluate(scheme, {} as any);
    assert.equal(result.risks.length, 1);
    assert.equal(result.risks[0].id, 'platform_width');
    assert.equal(result.risks[0].severity, 'warning');
  });

  it('returns empty constraints when required topic not registered', () => {
    const engine = new RuleEngine(config);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'B1', roomOverrides: {} },
      },
    };
    const result = engine.evaluate(scheme, {
      getTopic: () => undefined,
      getOption: () => undefined,
    } as any);
    assert.equal(result.constraintViolations.length, 0);
  });

  it('handles empty risks and constraints', () => {
    const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {},
    };
    const result = engine.evaluate(scheme, {} as any);
    assert.equal(result.risks.length, 0);
    assert.equal(result.constraintViolations.length, 0);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx tsx --test tests/server/rule-engine.test.ts
```

---

### Task 3: Budget Calculator

**Files:**
- Create: `server/budget-calculator.ts`
- Create: `tests/server/budget-calculator.test.ts`

**Interfaces:**
- Consumes: CurrentScheme, ProjectCatalog, DesignRulesConfig
- Produces: BudgetSnapshot

- [ ] **Step 1: Create `server/budget-calculator.ts`**

```typescript
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
```

- [ ] **Step 2: Create `tests/server/budget-calculator.test.ts`**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import type { CurrentScheme, DesignRulesConfig } from '../../shared/types.js';

const rulesConfig: DesignRulesConfig = {
  version: '1.0',
  budget: {
    topicCategories: {
      floor: 'masonry',
      wall: 'masonry',
      paint: 'painting',
      hvac: 'hvac',
    },
    lineItems: [
      { topic: 'floor', quantityField: 'floorArea' },
      { topic: 'wall', quantityField: 'wetWallArea' },
      { topic: 'paint', quantityField: 'paintWallArea' },
      { topic: 'hvac' },
    ],
  },
  risks: [],
  constraints: [],
};

describe('BudgetCalculator', () => {
  it('calculates HVAC as global topic', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A2', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const hvacCategory = snapshot.categories.find((c) => c.key === 'hvac');
    assert.ok(hvacCategory);
    assert.equal(hvacCategory.autoActual, 29000);
  });

  it('calculates per-room floor topic', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const floorItems = snapshot.lineItems.filter((li) => li.topic === 'floor');
    assert.ok(floorItems.length > 0);
    const masonryCategory = snapshot.categories.find((c) => c.key === 'masonry');
    assert.ok(masonryCategory);
    assert.ok(masonryCategory.autoActual > 0);
  });

  it('returns zero for unregistered topic line items', () => {
    const catalog = ProjectCatalog.load('.');
    const configWithUnknown: DesignRulesConfig = {
      ...rulesConfig,
      budget: {
        ...rulesConfig.budget,
        lineItems: [
          ...(rulesConfig.budget?.lineItems ?? []),
          { topic: 'curtains', quantityField: 'windowLength' },
        ],
        topicCategories: {
          ...rulesConfig.budget?.topicCategories,
          curtains: 'curtains',
        },
      },
    };
    const calc = new BudgetCalculator(catalog, configWithUnknown);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const curtainItems = snapshot.lineItems.filter((li) => li.topic === 'curtains');
    assert.equal(curtainItems.length, 0);
  });

  it('handles room overrides', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
        floor: {
          default: 'floor_tile_01',
          roomOverrides: { master_bedroom: 'floor_tile_01' },
        },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const masterFloor = snapshot.lineItems.find(
      (li) => li.topic === 'floor' && li.roomId === 'master_bedroom'
    );
    assert.ok(masterFloor);
  });

  it('totalBudget sums all category budgets', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const expectedTotal = snapshot.categories.reduce((s, c) => s + c.budget, 0);
    assert.equal(snapshot.totalBudget, expectedTotal);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx tsx --test tests/server/budget-calculator.test.ts
```

---

### Task 4: Design Rules Watcher

**Files:**
- Create: `server/design-rules-watcher.ts`

**Interfaces:**
- Consumes: config/design-rules.yaml file path
- Produces: RuleEngine (reloaded on change), event callback

- [ ] **Step 1: Create `server/design-rules-watcher.ts`**

```typescript
import chokidar from 'chokidar';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { DesignRulesConfig } from '../shared/types.js';
import { RuleEngine } from './rule-engine.js';

export type RulesChangeCallback = (engine: RuleEngine) => void;

export class DesignRulesWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private engine: RuleEngine;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs = 300;

  constructor(
    private configPath: string,
    private onChange: RulesChangeCallback
  ) {
    this.engine = this.loadEngine();
  }

  private loadEngine(): RuleEngine {
    try {
      const raw = readFileSync(this.configPath, 'utf8');
      const config = load(raw) as DesignRulesConfig;
      return new RuleEngine(config);
    } catch (err) {
      console.error(`[design-rules-watcher] Failed to load ${this.configPath}:`, err);
      return this.engine ?? new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    }
  }

  getEngine(): RuleEngine {
    return this.engine;
  }

  start(): void {
    this.watcher = chokidar.watch(this.configPath, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        const newEngine = this.loadEngine();
        this.engine = newEngine;
        this.onChange(newEngine);
      }, this.debounceMs);
    });

    this.watcher.on('error', (err) => {
      console.error('[design-rules-watcher] Watcher error:', err);
    });
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
```

---

### Task 5: Archived Schemes Store

**Files:**
- Create: `server/archived-schemes.ts`
- Create: `tests/server/archived-schemes.test.ts`

**Interfaces:**
- Consumes: CurrentScheme, ArchivedScheme
- Produces: ArchivedScheme, DiffEntry[]

- [ ] **Step 1: Create `server/archived-schemes.ts`**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { convert } from 'pinyin-pro';
import type {
  ArchivedScheme,
  CurrentScheme,
  DiffEntry,
  TopicSelection,
} from '../shared/types.js';

function generateSlug(name: string): string {
  let slug: string;
  try {
    slug = convert(name, { toneType: 'none', type: 'array' }).join('').toLowerCase();
  } catch {
    slug = name.toLowerCase();
  }
  slug = slug.replace(/[^a-z0-9]+/g, '-');
  slug = slug.replace(/^-+|-+$/g, '');
  slug = slug.slice(0, 30);
  slug = slug.replace(/^-+|-+$/g, '');
  if (!slug) slug = 'archive';
  return slug;
}

function generateTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}${mo}${d}_${h}${mi}${s}`;
}

export class ArchivedSchemesStore {
  private schemes: ArchivedScheme[] = [];
  private readonly filePath: string;

  constructor(dataDir = './data') {
    this.filePath = `${dataDir}/archived-schemes.json`;
    this.schemes = this.loadFromDisk();
  }

  private loadFromDisk(): ArchivedScheme[] {
    if (!existsSync(this.filePath)) return [];
    return JSON.parse(readFileSync(this.filePath, 'utf8')) as ArchivedScheme[];
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.schemes, null, 2));
  }

  private generateId(name: string): string {
    const timestamp = generateTimestamp();
    let slug = generateSlug(name);
    const baseId = `archived_${timestamp}_${slug}`;
    if (!this.schemes.some((s) => s.id === baseId)) return baseId;
    let n = 2;
    while (this.schemes.some((s) => s.id === `${baseId}-${n}`)) n++;
    return `${baseId}-${n}`;
  }

  list(): Array<Pick<ArchivedScheme, 'id' | 'name' | 'createdAt'>> {
    return this.schemes.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
    }));
  }

  get(id: string): ArchivedScheme | undefined {
    return this.schemes.find((s) => s.id === id);
  }

  create(
    scheme: CurrentScheme,
    name: string,
    reason?: string
  ): { scheme: ArchivedScheme; error?: string } {
    if (this.schemes.some((s) => s.name === name)) {
      return { scheme: null as any, error: 'name_conflict' };
    }
    const id = this.generateId(name);
    const archived: ArchivedScheme = {
      id,
      name,
      selections: structuredClone(scheme.selections),
      reason,
      createdAt: new Date().toISOString(),
    };
    this.schemes.push(archived);
    this.persist();
    return { scheme: archived };
  }

  delete(id: string): boolean {
    const idx = this.schemes.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.schemes.splice(idx, 1);
    this.persist();
    return true;
  }

  diff(archivedId: string, current: CurrentScheme): DiffEntry[] | undefined {
    const archived = this.get(archivedId);
    if (!archived) return undefined;

    const entries: DiffEntry[] = [];
    const allTopics = new Set([
      ...Object.keys(archived.selections),
      ...Object.keys(current.selections),
    ]);

    for (const topic of allTopics) {
      const archSel: TopicSelection = archived.selections[topic] ?? {
        default: null,
        roomOverrides: {},
      };
      const curSel: TopicSelection = current.selections[topic] ?? {
        default: null,
        roomOverrides: {},
      };

      if (archSel.default !== curSel.default) {
        entries.push({
          path: `${topic}.default`,
          current: curSel.default,
          archived: archSel.default,
        });
      }

      const allRooms = new Set([
        ...Object.keys(archSel.roomOverrides),
        ...Object.keys(curSel.roomOverrides),
      ]);

      for (const roomId of allRooms) {
        const archOverride = archSel.roomOverrides[roomId] ?? null;
        const curOverride = curSel.roomOverrides[roomId] ?? null;
        if (archOverride !== curOverride) {
          entries.push({
            path: `${topic}.roomOverrides.${roomId}`,
            current: curOverride,
            archived: archOverride,
          });
        }
      }
    }

    return entries;
  }
}

export { generateSlug };
```

- [ ] **Step 2: Create `tests/server/archived-schemes.test.ts`**

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { ArchivedSchemesStore, generateSlug } from '../../server/archived-schemes.js';
import type { CurrentScheme } from '../../shared/types.js';

const TEST_DATA_DIR = './tmp/test-data-archived';

function makeScheme(hvacId = 'A1'): CurrentScheme {
  return {
    updatedAt: new Date().toISOString(),
    selections: {
      hvac: { default: hvacId, roomOverrides: {} },
      floor: { default: 'floor_tile_01', roomOverrides: {} },
      wall: { default: 'wall_tile_01', roomOverrides: {} },
      paint: { default: 'latex_paint_01', roomOverrides: {} },
    },
  };
}

describe('generateSlug', () => {
  it('converts Chinese to pinyin slug', () => {
    const slug = generateSlug('奶油白主卧');
    assert.equal(slug, 'naiyoubaizhuwo');
  });

  it('handles English input', () => {
    const slug = generateSlug('Modern Minimalist');
    assert.equal(slug, 'modern-minimalist');
  });

  it('truncates to 30 chars', () => {
    const slug = generateSlug('a'.repeat(50));
    assert.ok(slug.length <= 30);
  });

  it('falls back to archive for empty result', () => {
    const slug = generateSlug('!!!');
    assert.equal(slug, 'archive');
  });
});

describe('ArchivedSchemesStore', () => {
  beforeEach(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  it('creates and lists archived schemes', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const result = store.create(makeScheme(), '奶油白主卧', '预算12万');
    assert.ok(result.scheme);
    assert.ok(result.scheme.id.startsWith('archived_'));
    assert.equal(result.scheme.name, '奶油白主卧');
    assert.equal(store.list().length, 1);
  });

  it('rejects duplicate names', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    store.create(makeScheme(), '奶油白主卧');
    const result = store.create(makeScheme(), '奶油白主卧');
    assert.equal(result.error, 'name_conflict');
  });

  it('gets archived scheme by id', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const { scheme } = store.create(makeScheme(), '测试方案');
    const found = store.get(scheme.id);
    assert.ok(found);
    assert.equal(found.name, '测试方案');
  });

  it('deletes archived scheme', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const { scheme } = store.create(makeScheme(), '测试方案');
    assert.equal(store.delete(scheme.id), true);
    assert.equal(store.list().length, 0);
  });

  it('returns false for deleting nonexistent', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    assert.equal(store.delete('nonexistent'), false);
  });

  it('computes diff between archived and current', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const { scheme: archived } = store.create(makeScheme('A1'), '方案A');
    const current = makeScheme('A2');
    const diff = store.diff(archived.id, current);
    assert.ok(diff);
    const hvacDiff = diff.find((d) => d.path === 'hvac.default');
    assert.ok(hvacDiff);
    assert.equal(hvacDiff.current, 'A2');
    assert.equal(hvacDiff.archived, 'A1');
  });

  it('diff includes room overrides', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const schemeA = makeScheme('A1');
    schemeA.selections.floor.roomOverrides.master_bedroom = 'floor_tile_01';
    const { scheme: archived } = store.create(schemeA, '方案B');

    const current = makeScheme('A1');
    current.selections.floor.roomOverrides.master_bedroom = 'floor_tile_02';
    const diff = store.diff(archived.id, current);
    assert.ok(diff);
    const overrideDiff = diff.find(
      (d) => d.path === 'floor.roomOverrides.master_bedroom'
    );
    assert.ok(overrideDiff);
    assert.equal(overrideDiff.current, 'floor_tile_02');
    assert.equal(overrideDiff.archived, 'floor_tile_01');
  });

  it('diff returns undefined for nonexistent scheme', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const diff = store.diff('nonexistent', makeScheme());
    assert.equal(diff, undefined);
  });

  it('persists to disk and reloads', () => {
    const store1 = new ArchivedSchemesStore(TEST_DATA_DIR);
    store1.create(makeScheme(), '持久化测试');
    const store2 = new ArchivedSchemesStore(TEST_DATA_DIR);
    assert.equal(store2.list().length, 1);
    assert.equal(store2.list()[0].name, '持久化测试');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx tsx --test tests/server/archived-schemes.test.ts
```

---

### Task 6: REST API Endpoints

**Files:**
- Modify: `server/routes.ts`
- Create: `tests/server/budget-api.test.ts`

**Interfaces:**
- Consumes: RuleEngine, BudgetCalculator, ArchivedSchemesStore, DesignState, ProjectCatalog
- Produces: HTTP endpoints for budget, risks, schemes

- [ ] **Step 1: Update `server/routes.ts`**

Replace the entire file with the updated version that adds new endpoints. The `createApiRouter` function signature changes to accept additional dependencies:

```typescript
import { Router, type Request, type Response } from 'express';
import type { ProjectCatalog } from './project-catalog.js';
import type { DesignState } from './design-state.js';
import type { RuleEngine } from './rule-engine.js';
import type { BudgetCalculator } from './budget-calculator.js';
import type { ArchivedSchemesStore } from './archived-schemes.js';

export interface ApiDeps {
  catalog: ProjectCatalog;
  state: DesignState;
  getRuleEngine: () => RuleEngine;
  getBudgetCalculator: () => BudgetCalculator;
  archiveStore: ArchivedSchemesStore;
}

export function createApiRouter(deps: ApiDeps): Router {
  const { catalog, state, getRuleEngine, getBudgetCalculator, archiveStore } = deps;
  const router = Router();

  router.get('/project', (_req, res) => {
    res.json({
      house: { rooms: catalog.getRooms() },
      topics: catalog.getTopics().map((t) => ({
        id: t.id,
        name: t.name,
        perRoom: t.perRoom,
        optionCount: t.options.length,
      })),
      budgetCategories: catalog.getBudgetCategories(),
    });
  });

  router.get('/scheme/current', (_req, res) => {
    res.json(state.getCurrentScheme());
  });

  router.patch('/scheme/current', (req, res) => {
    const { selections, reason, source, expectedUpdatedAt } = req.body ?? {};
    if (!Array.isArray(selections)) {
      res.status(400).json({ error: 'selections must be an array' });
      return;
    }
    try {
      const result = state.applySelections(selections, reason, source, expectedUpdatedAt);
      if (result.conflict) {
        res.status(409).json({ error: 'conflict', serverUpdatedAt: state.getCurrentScheme().updatedAt });
        return;
      }
      res.json({ updated: result.updated, entries: result.entries, scheme: state.getCurrentScheme() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/decisions', (_req, res) => {
    res.json(state.getDecisionLog());
  });

  router.post('/decisions', (req, res) => {
    try {
      const entry = state.recordDecision(req.body ?? {});
      res.status(201).json(entry);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/topics', (_req, res) => {
    res.json(
      catalog.getTopics().map((t) => ({
        id: t.id,
        name: t.name,
        perRoom: t.perRoom,
        options: t.options.map((o) => ({ id: o.id, name: o.name, price_per_unit: o.price_per_unit })),
      }))
    );
  });

  router.get('/topics/:id/options', (req, res) => {
    const topic = catalog.getTopic(req.params.id);
    if (!topic) {
      res.status(404).json({ error: 'topic not found' });
      return;
    }
    res.json(
      topic.options.map((o) => ({
        id: o.id,
        name: o.name,
        description: o.description,
        price_per_unit: o.price_per_unit,
        coverage_per_unit: o.coverage_per_unit,
        loss_rate: o.loss_rate,
      }))
    );
  });

  router.get('/topics/:id/options/:optionId', (req, res) => {
    const option = catalog.getOption(req.params.id, req.params.optionId);
    if (!option) {
      res.status(404).json({ error: 'option not found' });
      return;
    }
    res.json(option);
  });

  router.post('/view-context', (req, res) => {
    const { objectId } = req.body ?? {};
    if (typeof objectId !== 'string') {
      res.status(400).json({ error: 'objectId is required' });
      return;
    }
    res.json(state.setViewContext(objectId));
  });

  router.get('/view-context', (_req, res) => {
    res.json(state.getViewContext());
  });

  router.get('/visual-commands', (_req, res) => {
    res.json(state.getVisualCommands());
  });

  router.post('/visual-commands', (req, res) => {
    const { type, payload } = req.body ?? {};
    if (type !== 'set_camera_target' && type !== 'highlight_object') {
      res.status(400).json({ error: 'invalid visual command type' });
      return;
    }
    const cmd = state.appendVisualCommand(type, payload);
    res.status(201).json(cmd);
  });

  router.post('/visual-commands/ack', (req, res) => {
    const { ids } = req.body ?? {};
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      res.status(400).json({ error: 'ids must be an array of strings' });
      return;
    }
    state.ackVisualCommands(ids);
    res.json({ acked: ids.length });
  });

  router.get('/budget', (_req, res) => {
    const scheme = state.getCurrentScheme();
    const calc = getBudgetCalculator();
    const snapshot = calc.calculate(scheme);
    res.json(snapshot);
  });

  router.get('/risks', (_req, res) => {
    const scheme = state.getCurrentScheme();
    const engine = getRuleEngine();
    const result = engine.evaluate(scheme, catalog);
    res.json(result);
  });

  router.get('/design-check', (_req, res) => {
    const scheme = state.getCurrentScheme();
    const engine = getRuleEngine();
    const result = engine.evaluate(scheme, catalog);
    res.json(result);
  });

  router.get('/schemes', (_req, res) => {
    res.json(archiveStore.list());
  });

  router.post('/schemes', (req, res) => {
    const { name, reason } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const scheme = state.getCurrentScheme();
    const result = archiveStore.create(scheme, name, reason);
    if (result.error === 'name_conflict') {
      res.status(409).json({ error: 'archive name already exists' });
      return;
    }
    res.status(201).json(result.scheme);
  });

  router.get('/schemes/:id', (req, res) => {
    const archived = archiveStore.get(req.params.id);
    if (!archived) {
      res.status(404).json({ error: 'archived scheme not found' });
      return;
    }
    res.json(archived);
  });

  router.get('/schemes/:id/diff', (req, res) => {
    const current = state.getCurrentScheme();
    const diff = archiveStore.diff(req.params.id, current);
    if (!diff) {
      res.status(404).json({ error: 'archived scheme not found' });
      return;
    }
    res.json(diff);
  });

  router.post('/schemes/:id/restore', (req, res) => {
    const archived = archiveStore.get(req.params.id);
    if (!archived) {
      res.status(404).json({ error: 'archived scheme not found' });
      return;
    }

    const current = state.getCurrentScheme();
    const patches: Array<{ topic: string; optionId: string | null; roomId?: string | null; reason?: string }> = [];

    const allTopics = new Set([
      ...Object.keys(archived.selections),
      ...Object.keys(current.selections),
    ]);

    for (const topic of allTopics) {
      const archSel = archived.selections[topic] ?? { default: null, roomOverrides: {} };
      const curSel = current.selections[topic] ?? { default: null, roomOverrides: {} };

      if (archSel.default !== curSel.default) {
        patches.push({
          topic,
          optionId: archSel.default,
          reason: `restored from archive ${archived.id}`,
        });
      }

      const allRooms = new Set([
        ...Object.keys(archSel.roomOverrides),
        ...Object.keys(curSel.roomOverrides),
      ]);

      for (const roomId of allRooms) {
        const archOverride = archSel.roomOverrides[roomId] ?? null;
        const curOverride = curSel.roomOverrides[roomId] ?? null;
        if (archOverride !== curOverride) {
          patches.push({
            topic,
            optionId: archOverride,
            roomId,
            reason: `restored from archive ${archived.id}`,
          });
        }
      }
    }

    if (patches.length > 0) {
      const result = state.applySelections(patches, `restored from ${archived.id}`, 'restore');
      const log = state.getDecisionLog();
      for (const entry of result.entries) {
        entry.archiveId = archived.id;
      }
    }

    res.json({
      restored: true,
      archiveId: archived.id,
      scheme: state.getCurrentScheme(),
    });
  });

  router.delete('/schemes/:id', (req, res) => {
    const deleted = archiveStore.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'archived scheme not found' });
      return;
    }
    res.json({ deleted: true });
  });

  return router;
}
```

- [ ] **Step 2: Create `tests/server/budget-api.test.ts`**

```typescript
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { mkdirSync, rmSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { createApiRouter } from '../../server/routes.js';
import type { DesignRulesConfig } from '../../shared/types.js';

const TEST_DATA_DIR = './tmp/test-data-budget-api';

const rulesConfig: DesignRulesConfig = {
  version: '1.0',
  budget: {
    topicCategories: { floor: 'masonry', wall: 'masonry', paint: 'painting', hvac: 'hvac' },
    lineItems: [
      { topic: 'floor', quantityField: 'floorArea' },
      { topic: 'wall', quantityField: 'wetWallArea' },
      { topic: 'paint', quantityField: 'paintWallArea' },
      { topic: 'hvac' },
    ],
  },
  risks: [
    {
      id: 'platform_width',
      severity: 'warning',
      message: '{{hvac.name}} 外机摆放紧张',
      when: { topic: 'hvac', options: ['B1', 'B2', 'E1'] },
    },
  ],
  constraints: [],
};

describe('Budget + Risks + Schemes API', () => {
  let app: express.Express;
  let archiveStore: ArchivedSchemesStore;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const engine = new RuleEngine(rulesConfig);
    const calc = new BudgetCalculator(catalog, rulesConfig);
    archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);

    app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter({
        catalog,
        state,
        getRuleEngine: () => engine,
        getBudgetCalculator: () => calc,
        archiveStore,
      })
    );
  });

  it('GET /api/budget returns budget snapshot', async () => {
    const res = await request(app).get('/api/budget').expect(200);
    assert.ok(res.body.totalBudget > 0);
    assert.ok(Array.isArray(res.body.categories));
    assert.ok(Array.isArray(res.body.lineItems));
  });

  it('GET /api/risks returns risks', async () => {
    const res = await request(app).get('/api/risks').expect(200);
    assert.ok(Array.isArray(res.body.risks));
    assert.ok(Array.isArray(res.body.constraintViolations));
  });

  it('POST /api/schemes creates archive', async () => {
    const res = await request(app)
      .post('/api/schemes')
      .send({ name: '测试归档', reason: '测试' })
      .expect(201);
    assert.ok(res.body.id.startsWith('archived_'));
    assert.equal(res.body.name, '测试归档');
  });

  it('POST /api/schemes rejects duplicate name', async () => {
    await request(app)
      .post('/api/schemes')
      .send({ name: '重复方案' })
      .expect(201);
    await request(app)
      .post('/api/schemes')
      .send({ name: '重复方案' })
      .expect(409);
  });

  it('GET /api/schemes lists archives', async () => {
    const res = await request(app).get('/api/schemes').expect(200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);
  });

  it('GET /api/schemes/:id returns archive detail', async () => {
    const listRes = await request(app).get('/api/schemes').expect(200);
    const id = listRes.body[0].id;
    const res = await request(app).get(`/api/schemes/${id}`).expect(200);
    assert.equal(res.body.id, id);
    assert.ok(res.body.selections);
  });

  it('GET /api/schemes/:id/diff returns diff', async () => {
    const listRes = await request(app).get('/api/schemes').expect(200);
    const id = listRes.body[0].id;
    const res = await request(app).get(`/api/schemes/${id}/diff`).expect(200);
    assert.ok(Array.isArray(res.body));
  });

  it('POST /api/schemes/:id/restore restores scheme', async () => {
    await request(app)
      .patch('/api/scheme/current')
      .send({ selections: [{ topic: 'hvac', optionId: 'A1' }] })
      .expect(200);

    const listRes = await request(app).get('/api/schemes').expect(200);
    const id = listRes.body[0].id;
    const res = await request(app).post(`/api/schemes/${id}/restore`).expect(200);
    assert.equal(res.body.restored, true);
  });

  it('DELETE /api/schemes/:id deletes archive', async () => {
    const createRes = await request(app)
      .post('/api/schemes')
      .send({ name: '待删除' })
      .expect(201);
    const id = createRes.body.id;
    await request(app).delete(`/api/schemes/${id}`).expect(200);
    await request(app).get(`/api/schemes/${id}`).expect(404);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx tsx --test tests/server/budget-api.test.ts
```

---

### Task 7: MCP Tools

**Files:**
- Modify: `server/mcp-server.ts`

**Interfaces:**
- Consumes: RuleEngine, BudgetCalculator, ArchivedSchemesStore, DesignState, ProjectCatalog
- Produces: MCP tools: get_budget, get_risks, get_archived_schemes, archive_scheme, restore_scheme, run_design_check

- [ ] **Step 1: Update `server/mcp-server.ts`**

Replace the entire file:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectCatalog } from './project-catalog.js';
import type { DesignState } from './design-state.js';
import type { RuleEngine } from './rule-engine.js';
import type { BudgetCalculator } from './budget-calculator.js';
import type { ArchivedSchemesStore } from './archived-schemes.js';

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export interface McpDeps {
  catalog: ProjectCatalog;
  state: DesignState;
  getRuleEngine: () => RuleEngine;
  getBudgetCalculator: () => BudgetCalculator;
  archiveStore: ArchivedSchemesStore;
}

export function createMcpServer(deps: McpDeps): McpServer {
  const { catalog, state, getRuleEngine, getBudgetCalculator, archiveStore } = deps;
  const server = new McpServer(
    { name: 'bontop-design', version: '0.2.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'get_project_summary',
    { title: 'Get project summary', description: 'Return house, topics, and budget base.' },
    async () => {
      return text({
        rooms: catalog.getRooms().map((r) => ({ id: r.id, name: r.name })),
        topics: catalog.getTopics().map((t) => ({ id: t.id, name: t.name, perRoom: t.perRoom })),
        budgetCategories: catalog.getBudgetCategories(),
      });
    }
  );

  server.registerTool(
    'get_current_scheme',
    { title: 'Get current scheme', description: 'Return current selections.' },
    async () => text(state.getCurrentScheme())
  );

  server.registerTool(
    'get_decisions',
    { title: 'Get decision log', description: 'Return recorded decisions.' },
    async () => text(state.getDecisionLog())
  );

  server.registerTool(
    'list_topics',
    { title: 'List topics', description: 'List all design topics.' },
    async () =>
      text(
        catalog.getTopics().map((t) => ({
          id: t.id,
          name: t.name,
          perRoom: t.perRoom,
          options: t.options.map((o) => o.id),
        }))
      )
  );

  server.registerTool(
    'list_options',
    {
      title: 'List options',
      description: 'List options for a topic.',
      inputSchema: z.object({ topic: z.string() }),
    },
    async (args) => {
      const options = catalog.getOptions(args.topic);
      if (options.length === 0) return text({ error: 'topic not found' });
      return text(options.map((o) => ({ id: o.id, name: o.name, price_per_unit: o.price_per_unit })));
    }
  );

  server.registerTool(
    'get_option_details',
    {
      title: 'Get option details',
      description: 'Return full details of one option.',
      inputSchema: z.object({ topic: z.string(), optionId: z.string() }),
    },
    async (args) => {
      const option = catalog.getOption(args.topic, args.optionId);
      if (!option) return text({ error: 'option not found' });
      return text(option);
    }
  );

  server.registerTool(
    'get_view_context',
    { title: 'Get view context', description: 'Return the currently selected object in the App.' },
    async () => text(state.getViewContext())
  );

  server.registerTool(
    'set_selection',
    {
      title: 'Set selection',
      description: 'Set a single topic default or per-room override.',
      inputSchema: z.object({
        topic: z.string(),
        optionId: z.string().nullable(),
        roomId: z.string().optional(),
        reason: z.string().optional(),
        source: z.string().optional(),
      }),
    },
    async (args) => {
      const result = state.applySelections(
        [{ topic: args.topic, optionId: args.optionId, roomId: args.roomId, reason: args.reason }],
        args.reason,
        args.source ?? 'ai'
      );
      return text({ updated: result.updated, entries: result.entries });
    }
  );

  server.registerTool(
    'batch_set_selections',
    {
      title: 'Batch set selections',
      description: 'Atomic batch update of multiple selections.',
      inputSchema: z.object({
        selections: z.array(
          z.object({
            topic: z.string(),
            optionId: z.string().nullable(),
            roomId: z.string().optional(),
            reason: z.string().optional(),
          })
        ),
        reason: z.string().optional(),
        source: z.string().optional(),
      }),
    },
    async (args) => {
      const result = state.applySelections(args.selections, args.reason, args.source ?? 'ai');
      return text({ updated: result.updated, entries: result.entries });
    }
  );

  server.registerTool(
    'record_decision',
    {
      title: 'Record decision',
      description: 'Append a decision record without changing the scheme.',
      inputSchema: z.object({
        topic: z.string().optional(),
        roomId: z.string().optional(),
        optionId: z.string().optional(),
        reason: z.string().optional(),
        source: z.string().optional(),
      }),
    },
    async (args) => {
      const entry = state.recordDecision(args);
      return text({ id: entry.id });
    }
  );

  server.registerTool(
    'set_camera_target',
    {
      title: 'Set camera target',
      description: 'Ask the App to move the camera to an object.',
      inputSchema: z.object({ targetId: z.string(), mode: z.string().optional() }),
    },
    async (args) => {
      const cmd = state.appendVisualCommand('set_camera_target', {
        targetId: args.targetId,
        mode: args.mode,
      });
      return text({ commandId: cmd.commandId });
    }
  );

  server.registerTool(
    'highlight_object',
    {
      title: 'Highlight object',
      description: 'Ask the App to highlight an object.',
      inputSchema: z.object({ objectId: z.string() }),
    },
    async (args) => {
      const cmd = state.appendVisualCommand('highlight_object', { objectId: args.objectId });
      return text({ commandId: cmd.commandId });
    }
  );

  server.registerTool(
    'get_budget',
    {
      title: 'Get budget',
      description: 'Return budget breakdown with categories and line items.',
    },
    async () => {
      const scheme = state.getCurrentScheme();
      const calc = getBudgetCalculator();
      return text(calc.calculate(scheme));
    }
  );

  server.registerTool(
    'get_risks',
    {
      title: 'Get risks',
      description: 'Return current risks and constraint violations.',
    },
    async () => {
      const scheme = state.getCurrentScheme();
      const engine = getRuleEngine();
      return text(engine.evaluate(scheme, catalog));
    }
  );

  server.registerTool(
    'run_design_check',
    {
      title: 'Run design check',
      description: 'Evaluate all risk and constraint rules against current scheme.',
    },
    async () => {
      const scheme = state.getCurrentScheme();
      const engine = getRuleEngine();
      return text(engine.evaluate(scheme, catalog));
    }
  );

  server.registerTool(
    'get_archived_schemes',
    {
      title: 'Get archived schemes',
      description: 'List all archived design schemes.',
    },
    async () => text(archiveStore.list())
  );

  server.registerTool(
    'archive_scheme',
    {
      title: 'Archive current scheme',
      description: 'Save current scheme as a named archive.',
      inputSchema: z.object({
        name: z.string(),
        reason: z.string().optional(),
      }),
    },
    async (args) => {
      const scheme = state.getCurrentScheme();
      const result = archiveStore.create(scheme, args.name, args.reason);
      if (result.error) return text({ error: result.error });
      return text(result.scheme);
    }
  );

  server.registerTool(
    'restore_scheme',
    {
      title: 'Restore archived scheme',
      description: 'Restore an archived scheme as the current scheme.',
      inputSchema: z.object({ schemeId: z.string() }),
    },
    async (args) => {
      const archived = archiveStore.get(args.schemeId);
      if (!archived) return text({ error: 'archived scheme not found' });

      const current = state.getCurrentScheme();
      const patches: Array<{ topic: string; optionId: string | null; roomId?: string | null; reason?: string }> = [];

      const allTopics = new Set([
        ...Object.keys(archived.selections),
        ...Object.keys(current.selections),
      ]);

      for (const topic of allTopics) {
        const archSel = archived.selections[topic] ?? { default: null, roomOverrides: {} };
        const curSel = current.selections[topic] ?? { default: null, roomOverrides: {} };

        if (archSel.default !== curSel.default) {
          patches.push({ topic, optionId: archSel.default, reason: `restored from ${archived.id}` });
        }

        const allRooms = new Set([
          ...Object.keys(archSel.roomOverrides),
          ...Object.keys(curSel.roomOverrides),
        ]);
        for (const roomId of allRooms) {
          const archVal = archSel.roomOverrides[roomId] ?? null;
          const curVal = curSel.roomOverrides[roomId] ?? null;
          if (archVal !== curVal) {
            patches.push({ topic, optionId: archVal, roomId, reason: `restored from ${archived.id}` });
          }
        }
      }

      if (patches.length > 0) {
        const result = state.applySelections(patches, `restored from ${archived.id}`, 'restore');
        for (const entry of result.entries) {
          entry.archiveId = archived.id;
        }
      }

      return text({ restored: true, archiveId: archived.id, scheme: state.getCurrentScheme() });
    }
  );

  return server;
}
```

---

### Task 8: Wiring + Server Entrypoint

**Files:**
- Modify: `server/index.ts`
- Modify: `server/mcp-transports.ts`

**Interfaces:**
- Consumes: All Spec 4 modules
- Produces: Running server with hot-reload, budget, risks, archives

- [ ] **Step 1: Update `server/index.ts`**

```typescript
import express from 'express';
import { ProjectCatalog } from './project-catalog.js';
import { DesignState } from './design-state.js';
import { createApiRouter } from './routes.js';
import { createMcpServer } from './mcp-server.js';
import { attachMcpTransports } from './mcp-transports.js';
import { RuleEngine } from './rule-engine.js';
import { BudgetCalculator } from './budget-calculator.js';
import { DesignRulesWatcher } from './design-rules-watcher.js';
import { ArchivedSchemesStore } from './archived-schemes.js';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? './data';
const CONFIG_PATH = process.env.CONFIG_PATH ?? 'config/design-rules.yaml';

const catalog = ProjectCatalog.load('.');
const state = DesignState.load(catalog, DATA_DIR);
const archiveStore = new ArchivedSchemesStore(DATA_DIR);

let ruleEngine = RuleEngine.load(CONFIG_PATH);
let budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());

const watcher = new DesignRulesWatcher(CONFIG_PATH, (newEngine) => {
  ruleEngine = newEngine;
  budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());
  console.log('[server] design-rules.yaml reloaded');
});
watcher.start();

const apiDeps = {
  catalog,
  state,
  getRuleEngine: () => ruleEngine,
  getBudgetCalculator: () => budgetCalculator,
  archiveStore,
};

const app = express();
app.use(express.json());
app.use('/api', createApiRouter(apiDeps));

attachMcpTransports(app, () => createMcpServer(apiDeps)).then(() => {
  app.listen(PORT, () => {
    console.log(`Bontop design server listening on http://localhost:${PORT}`);
  });
});

process.on('SIGINT', () => {
  watcher.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  watcher.stop();
  process.exit(0);
});
```

- [ ] **Step 2: Verify typecheck passes**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Run all server tests**

```bash
npm run test:server
```

- [ ] **Step 4: Start the dev server and verify it boots**

```bash
timeout 5 npx tsx server/index.ts || true
```

---

### Task 9: Update Existing Tests for New API Signature

**Files:**
- Modify: `tests/server/api.test.ts`
- Modify: `tests/server/mcp.test.ts`

**Interfaces:**
- Consumes: new ApiDeps / McpDeps interfaces
- Produces: Updated test files that compile and pass

- [ ] **Step 1: Update `tests/server/api.test.ts`**

The `createApiRouter` signature changed from `(catalog, state)` to `(deps: ApiDeps)`. Update the test:

```typescript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { mkdirSync, rmSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { createApiRouter } from '../../server/routes.js';

const TEST_DATA_DIR = './tmp/test-data-api';

describe('REST API', () => {
  let app: express.Express;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    const calc = new BudgetCalculator(catalog, engine.getConfig());
    const archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);

    app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter({
        catalog,
        state,
        getRuleEngine: () => engine,
        getBudgetCalculator: () => calc,
        archiveStore,
      })
    );
  });

  after(() => {
  });

  it('GET /api/project returns topics', async () => {
    const res = await request(app).get('/api/project').expect(200);
    assert.ok(Array.isArray(res.body.topics));
  });

  it('PATCH /api/scheme/current changes selection', async () => {
    const res = await request(app)
      .patch('/api/scheme/current')
      .send({ selections: [{ topic: 'hvac', optionId: 'A1' }], source: 'user' })
      .expect(200);
    assert.equal(res.body.scheme.selections.hvac.default, 'A1');
  });

  it('POST /api/decisions records a decision', async () => {
    const res = await request(app)
      .post('/api/decisions')
      .send({ topic: 'hvac', optionId: 'A1', reason: 'test' })
      .expect(201);
    assert.equal(res.body.topic, 'hvac');
  });

  it('POST /api/visual-commands creates a command', async () => {
    const res = await request(app)
      .post('/api/visual-commands')
      .send({ type: 'set_camera_target', payload: { targetId: 'room:master_bedroom' } })
      .expect(201);
    assert.equal(res.body.type, 'set_camera_target');
  });
});
```

- [ ] **Step 2: Read and update `tests/server/mcp.test.ts`**

First read the existing file:

```bash
cat tests/server/mcp.test.ts
```

Then update it to use the new `McpDeps` interface. The `createMcpServer` signature changed from `(catalog, state)` to `(deps: McpDeps)`. Update accordingly:

```typescript
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { createMcpServer } from '../../server/mcp-server.js';

const TEST_DATA_DIR = './tmp/test-data-mcp';

describe('MCP Server', () => {
  let server: ReturnType<typeof createMcpServer>;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    const calc = new BudgetCalculator(catalog, engine.getConfig());
    const archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);

    server = createMcpServer({
      catalog,
      state,
      getRuleEngine: () => engine,
      getBudgetCalculator: () => calc,
      archiveStore,
    });
  });

  it('creates server instance', () => {
    assert.ok(server);
  });
});
```

- [ ] **Step 3: Run all server tests**

```bash
npm run test:server
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```
