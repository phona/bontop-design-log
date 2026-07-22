# AI Design Advisor Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform AI from a "data administrator" into a "design advisor" by adding budget overrun detection, fast selection feedback, what-if simulation, a pitfall knowledge base, and spatial data exposure — all via MCP, with zero frontend changes.

**Architecture:** Five independent enhancements layered on existing server infrastructure. `BudgetCalculator` gains post-labor status computation and attribution. `DesignState.applySelections` returns `previousScheme` so MCP tools can compute budget deltas. A new `PitfallEngine` (config-driven, like `RuleEngine`) serves renovation knowledge from a new YAML. New MCP tools expose room geometry and furniture dimensions already loaded in `ProjectCatalog`. A spec-text parser extracts furniture dimensions from `materials.yaml`.

**Tech Stack:** TypeScript, Node.js built-in test runner (`node:test`), Express, MCP SDK (`@modelcontextprotocol/sdk`), js-yaml, zod.

**Spec:** `docs/superpowers/specs/2026-07-21-budget-advisor-enhancement-design.md`

## Global Constraints

- Zero frontend changes, zero breaking changes, zero new npm dependencies.
- `ApplyResult.updated` stays `boolean`; `ApplyResult.conflict` stays unchanged. Only `previousScheme` is added.
- `BudgetCategory.status` becomes `'draft' | 'ok' | 'near' | 'over' | 'reserved'`; `contingency` keeps `'reserved'` from `base.json`.
- `hvac` (`budget: 0`) always reports `ok` by design (outside the 110k base package).
- Status must be computed AFTER `computeLabor()` runs.
- `SelectionDiff.priceDelta` type is unchanged; only its computation is fixed (per-topic total-cost delta from line items), in BOTH `mcp-server.ts` and `routes.ts`.
- `McpDeps.getPitfallEngine` is a getter `() => PitfallEngine`, never a value field (hot-reload safety).
- Test framework: `node:test` + `assert/strict`, run via `npm run test:server`. Tests use real `ProjectCatalog.load('.')`.
- Furniture-type matcher regex: `/_\d+\w*$/` (strip trailing digit-led suffix), exact-match `alternative_group`.
- After each task, run: `npm run typecheck && npm run test:server`.

---

### Task 1: Budget Status Computation + Attribution

**Files:**
- Modify: `shared/types.ts` (BudgetCategory, BudgetSnapshot, add BudgetAttribution)
- Modify: `server/budget-calculator.ts:214-232`
- Test: `tests/server/budget-calculator.test.ts`

**Interfaces:**
- Consumes: existing `BudgetCalculator.calculate(scheme: CurrentScheme): BudgetSnapshot`, `QUANTITY_FORMULAS`, `computeLabor()`.
- Produces: `BudgetAttribution` interface; `BudgetCategory.status` union `'draft' | 'ok' | 'near' | 'over' | 'reserved'`; `BudgetSnapshot.attribution?: Record<string, BudgetAttribution>`. Later tasks (2, 3) rely on `status` and `attribution` being present in snapshots.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/budget-calculator.test.ts` inside the existing `describe('BudgetCalculator', ...)` block:

```typescript
it('computes status ok when actual is below 90% of budget', () => {
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
  const painting = snapshot.categories.find((c) => c.key === 'painting');
  assert.ok(painting);
  assert.ok(['ok', 'near', 'over'].includes(painting.status));
});

it('computes status over when actual exceeds budget and includes attribution', () => {
  const catalog = ProjectCatalog.load('.');
  // Force wall_tile_02 (22元/片, expensive) to push masonry over budget
  const calc = new BudgetCalculator(catalog, rulesConfig);
  const scheme: CurrentScheme = {
    updatedAt: new Date().toISOString(),
    selections: {
      hvac: { default: 'A2', roomOverrides: {} },
      floor: { default: 'floor_tile_03', roomOverrides: {} },
      wall: { default: 'wall_tile_02', roomOverrides: {} },
      paint: { default: 'latex_paint_01', roomOverrides: {} },
    },
  };
  const snapshot = calc.calculate(scheme);
  const masonry = snapshot.categories.find((c) => c.key === 'masonry');
  assert.ok(masonry);
  if (masonry.status === 'over' || masonry.status === 'near') {
    const att = snapshot.attribution?.masonry;
    assert.ok(att, 'attribution must exist for near/over category');
    assert.ok(att.topItems.length > 0);
    assert.equal(att.overBy, masonry.actual - masonry.budget);
  }
});

it('keeps contingency status as reserved', () => {
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
  const contingency = snapshot.categories.find((c) => c.key === 'contingency');
  assert.ok(contingency);
  assert.equal(contingency.status, 'reserved');
});

it('hvac with budget 0 stays ok even with actual spend', () => {
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
  const hvac = snapshot.categories.find((c) => c.key === 'hvac');
  assert.ok(hvac);
  assert.ok(hvac.actual > 0);
  assert.equal(hvac.status, 'ok');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:server -- --test-name-pattern="status|attribution|contingency|hvac with budget 0"`
Expected: FAIL — `status` is a plain string from base.json (`'draft'`), `attribution` is undefined, union type does not exist yet (typecheck also fails).

- [ ] **Step 3: Extend types in `shared/types.ts`**

At `shared/types.ts:274-289`, replace `BudgetCategory` and `BudgetSnapshot`, and add `BudgetAttribution`:

```typescript
export interface BudgetCategory {
  key: string;
  budget: number;
  actual: number;
  manualActual: number;
  autoActual: number;
  status: 'draft' | 'ok' | 'near' | 'over' | 'reserved';
  notes: string;
}

export interface BudgetAttribution {
  topItems: BudgetLineItem[];
  overBy: number;
  ratio: number;
}

export interface BudgetSnapshot {
  totalBudget: number;
  totalActual: number;
  categories: BudgetCategory[];
  lineItems: BudgetLineItem[];
  attribution?: Record<string, BudgetAttribution>;
}
```

- [ ] **Step 4: Implement status computation + attribution in `budget-calculator.ts`**

In `server/budget-calculator.ts`, replace the section from `const categories: BudgetCategory[] = baseCategories.map(...)` (line 214) through the final `return` (line 232) with:

```typescript
    const categories: BudgetCategory[] = baseCategories.map((bc) => {
      const autoActual = categoryAutoActual.get(bc.key) ?? 0;
      return {
        key: bc.key,
        budget: bc.budget,
        actual: bc.actual + autoActual,
        manualActual: bc.actual,
        autoActual,
        status: bc.status as BudgetCategory['status'],
        notes: bc.notes,
      };
    });

    this.computeLabor(categories, budgetRaw.categories, this.catalog.getRooms(), this.catalog.getFurnishings());

    // Status computed AFTER computeLabor: labor can push a category over budget.
    for (const cat of categories) {
      if (cat.status === 'reserved') continue;
      const ratio = cat.budget > 0 ? cat.actual / cat.budget : 0;
      cat.status = ratio > 1.0 ? 'over' : ratio > 0.9 ? 'near' : 'ok';
    }

    const topicCategoriesMap = this.rulesConfig.budget?.topicCategories ?? {};
    const attribution: Record<string, BudgetAttribution> = {};
    for (const cat of categories) {
      if (cat.status === 'over' || cat.status === 'near') {
        const catLineItems = allLineItems
          .filter((li) => topicCategoriesMap[li.topic] === cat.key)
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 3);
        attribution[cat.key] = {
          topItems: catLineItems,
          overBy: cat.actual - cat.budget,
          ratio: cat.budget > 0 ? cat.actual / cat.budget : 0,
        };
      }
    }

    const totalBudget = categories.reduce((sum, c) => sum + c.budget, 0);
    const totalActual = categories.reduce((sum, c) => sum + c.actual, 0);

    return { totalBudget, totalActual, categories, lineItems: allLineItems, attribution };
```

Also add `BudgetAttribution` to the type imports at the top of `budget-calculator.ts`:

```typescript
import type {
  CurrentScheme,
  BudgetSnapshot,
  BudgetLineItem,
  BudgetCategory,
  BudgetAttribution,
  DesignRulesConfig,
  RoomLayout,
  FurnishingsYaml,
  BudgetCategoryRaw,
} from '../shared/types.js';
```

Note: the pre-existing duplicate `const totalBudget`/`const totalActual` lines at 229-230 must be removed (they are included in the replacement above).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:server`
Expected: PASS — all budget-calculator tests including the 4 new ones.

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts server/budget-calculator.ts tests/server/budget-calculator.test.ts
git commit -m "feat(budget): compute overrun status after labor + attribution top items

status: ok/near/over computed from actual/budget ratio (reserved preserved).
attribution: top 3 line items + overBy + ratio for near/over categories.
hvac (budget=0) stays ok by design."
```

---

### Task 2: `previousScheme` in ApplyResult

**Files:**
- Modify: `server/design-state.ts:19-23,127-199`
- Test: `tests/server/design-state.test.ts`

**Interfaces:**
- Consumes: existing `ApplyResult { updated: boolean; conflict?: boolean; entries: DecisionLogEntry[] }`.
- Produces: `ApplyResult` gains required field `previousScheme: CurrentScheme`. `updated` stays boolean, `conflict` unchanged. Task 3 consumes `result.previousScheme`.

- [ ] **Step 1: Write the failing test**

Append to `tests/server/design-state.test.ts` inside `describe('DesignState', ...)`:

```typescript
it('returns previousScheme snapshot before mutation', () => {
  const catalog = ProjectCatalog.load('.');
  const state = DesignState.load(catalog, TEST_DATA_DIR);
  const before = state.getCurrentScheme().selections.hvac.default;
  const result = state.applySelections([{ topic: 'hvac', optionId: 'A3' }], 'test', 'user');
  assert.ok(result.previousScheme);
  assert.equal(result.previousScheme.selections.hvac.default, before);
  assert.equal(state.getCurrentScheme().selections.hvac.default, 'A3');
  // previousScheme must be a deep copy, not a live reference
  assert.notEqual(result.previousScheme.selections.hvac.default, state.getCurrentScheme().selections.hvac.default);
});

it('returns previousScheme even on conflict', () => {
  const catalog = ProjectCatalog.load('.');
  const state = DesignState.load(catalog, TEST_DATA_DIR);
  const result = state.applySelections(
    [{ topic: 'hvac', optionId: 'A1' }],
    undefined,
    'user',
    '2000-01-01T00:00:00Z'
  );
  assert.equal(result.conflict, true);
  assert.ok(result.previousScheme);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:server -- --test-name-pattern="previousScheme"`
Expected: FAIL — `previousScheme` is undefined on the returned object.

- [ ] **Step 3: Implement in `design-state.ts`**

At `server/design-state.ts:19-23`, extend `ApplyResult`:

```typescript
export interface ApplyResult {
  updated: boolean;
  conflict?: boolean;
  entries: DecisionLogEntry[];
  previousScheme: CurrentScheme;
}
```

In `applySelections` (line 127), deep-copy the scheme at method start and include it in both return paths:

```typescript
  applySelections(
    patches: SelectionPatch[],
    reason?: string,
    source = 'ai',
    expectedUpdatedAt?: string
  ): ApplyResult {
    const previousScheme = JSON.parse(JSON.stringify(this.scheme)) as CurrentScheme;
    if (expectedUpdatedAt && this.scheme.updatedAt !== expectedUpdatedAt) {
      return { updated: false, conflict: true, entries: [], previousScheme };
    }
    // ... existing logic unchanged ...
    return { updated: changed, entries, previousScheme };
  }
```

The only edits: insert the `previousScheme` line at the top, and add `previousScheme` to both `return` statements (line 134 early-return and line 199 final return).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:server`
Expected: PASS — existing design-state tests plus the 2 new ones. (`routes.ts` and `mcp-server.ts` callers ignore the new field; no changes needed there for typecheck.)

- [ ] **Step 5: Commit**

```bash
git add server/design-state.ts tests/server/design-state.test.ts
git commit -m "feat(state): applySelections returns previousScheme deep copy

Enables budget-delta computation in MCP selection tools.
updated stays boolean; conflict unchanged; no caller changes required."
```

---

### Task 3: `budgetImpact` in `set_selection` and `batch_set_selections`

**Files:**
- Modify: `server/mcp-server.ts:101-146`
- Test: `tests/server/mcp.test.ts`

**Interfaces:**
- Consumes: `ApplyResult.previousScheme` (Task 2), `BudgetCalculator.calculate()` with `status` (Task 1), `RuleEngine.evaluate()`.
- Produces: MCP responses for `set_selection`/`batch_set_selections` gain a `budgetImpact` object: `{ totalDelta, totalActual, totalBudget, categoryDeltas: Array<{key, delta, status}>, overCategories: BudgetCategory[], risks: Risk[] }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/server/mcp.test.ts` inside `describe('MCP remote', ...)`:

```typescript
it('set_selection returns budgetImpact with deltas', async () => {
  const result = await client.callTool({
    name: 'set_selection',
    arguments: { topic: 'hvac', optionId: 'A1', reason: 'budget impact test' },
  });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  assert.equal(parsed.updated, true);
  assert.ok(parsed.budgetImpact, 'budgetImpact must be present');
  assert.equal(typeof parsed.budgetImpact.totalDelta, 'number');
  assert.equal(typeof parsed.budgetImpact.totalActual, 'number');
  assert.ok(Array.isArray(parsed.budgetImpact.categoryDeltas));
  assert.ok(Array.isArray(parsed.budgetImpact.overCategories));
  assert.ok(Array.isArray(parsed.budgetImpact.risks));
});

it('batch_set_selections returns budgetImpact', async () => {
  const result = await client.callTool({
    name: 'batch_set_selections',
    arguments: {
      selections: [{ topic: 'hvac', optionId: 'A2' }],
      reason: 'batch impact test',
    },
  });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  assert.equal(parsed.updated, true);
  assert.ok(parsed.budgetImpact);
  assert.equal(typeof parsed.budgetImpact.totalDelta, 'number');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:server -- --test-name-pattern="budgetImpact"`
Expected: FAIL — `budgetImpact` is undefined in the response.

- [ ] **Step 3: Implement in `mcp-server.ts`**

Replace the `set_selection` handler body (`mcp-server.ts:114-121`) with:

```typescript
    async (args) => {
      const result = state.applySelections(
        [{ topic: args.topic, optionId: args.optionId, roomId: args.roomId, reason: args.reason }],
        args.reason,
        args.source ?? 'ai'
      );
      const calc = getBudgetCalculator();
      const engine = getRuleEngine();
      const newScheme = state.getCurrentScheme();
      const prevBudget = calc.calculate(result.previousScheme);
      const newBudget = calc.calculate(newScheme);
      const newRisks = engine.evaluate(newScheme, catalog);
      const categoryDeltas = newBudget.categories
        .map((c, i) => ({
          key: c.key,
          delta: c.actual - prevBudget.categories[i].actual,
          status: c.status,
        }))
        .filter((d) => d.delta !== 0);
      return text({
        updated: result.updated,
        entries: result.entries,
        budgetImpact: {
          totalDelta: newBudget.totalActual - prevBudget.totalActual,
          totalActual: newBudget.totalActual,
          totalBudget: newBudget.totalBudget,
          categoryDeltas,
          overCategories: newBudget.categories.filter((c) => c.status === 'over'),
          risks: newRisks.risks,
        },
      });
    }
```

Replace the `batch_set_selections` handler body (`mcp-server.ts:142-145`) with the same pattern:

```typescript
    async (args) => {
      const result = state.applySelections(args.selections, args.reason, args.source ?? 'ai');
      const calc = getBudgetCalculator();
      const engine = getRuleEngine();
      const newScheme = state.getCurrentScheme();
      const prevBudget = calc.calculate(result.previousScheme);
      const newBudget = calc.calculate(newScheme);
      const newRisks = engine.evaluate(newScheme, catalog);
      const categoryDeltas = newBudget.categories
        .map((c, i) => ({
          key: c.key,
          delta: c.actual - prevBudget.categories[i].actual,
          status: c.status,
        }))
        .filter((d) => d.delta !== 0);
      return text({
        updated: result.updated,
        entries: result.entries,
        budgetImpact: {
          totalDelta: newBudget.totalActual - prevBudget.totalActual,
          totalActual: newBudget.totalActual,
          totalBudget: newBudget.totalBudget,
          categoryDeltas,
          overCategories: newBudget.categories.filter((c) => c.status === 'over'),
          risks: newRisks.risks,
        },
      });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:server`
Expected: PASS — the existing `mcp.test.ts` test `parsed.updated === true` still passes (updated stays boolean), plus the 2 new tests.

- [ ] **Step 5: Commit**

```bash
git add server/mcp-server.ts tests/server/mcp.test.ts
git commit -m "feat(mcp): set_selection/batch_set_selections return budgetImpact

totalDelta, categoryDeltas, overCategories, risks — fast feedback for AI
without a second get_budget call. updated stays boolean."
```

---

### Task 4: `what_if` Simulation Tool

**Files:**
- Modify: `server/mcp-server.ts` (append new tool after `restore_scheme`, ~line 378)
- Test: `tests/server/mcp.test.ts`

**Interfaces:**
- Consumes: `DesignState.getCurrentScheme()`, `BudgetCalculator.calculate(scheme)` (Task 1 status), `RuleEngine.evaluate(scheme, catalog)`.
- Produces: MCP tool `what_if` with input `{ changes: Array<{ topic: string; optionId: string | null; roomId?: string }> }`, output `{ current, simulated: { totalBudget, totalActual, budget, risks }, delta: { totalDelta, categoryDeltas, risksAdded, risksRemoved } }`. Does NOT persist state.

- [ ] **Step 1: Write the failing test**

Append to `tests/server/mcp.test.ts` inside `describe('MCP remote', ...)`:

```typescript
it('what_if simulates changes without persisting', async () => {
  const before = await client.callTool({ name: 'get_current_scheme', arguments: {} });
  const beforeScheme = JSON.parse((before.content as { text: string }[])[0].text);
  const beforeHvac = beforeScheme.selections.hvac.default;

  const result = await client.callTool({
    name: 'what_if',
    arguments: { changes: [{ topic: 'hvac', optionId: 'B1' }] },
  });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  assert.ok(parsed.current);
  assert.ok(parsed.simulated);
  assert.ok(parsed.simulated.budget);
  assert.ok(parsed.delta);
  assert.equal(typeof parsed.delta.totalDelta, 'number');
  assert.ok(Array.isArray(parsed.delta.risksAdded));

  const after = await client.callTool({ name: 'get_current_scheme', arguments: {} });
  const afterScheme = JSON.parse((after.content as { text: string }[])[0].text);
  assert.equal(afterScheme.selections.hvac.default, beforeHvac, 'what_if must not persist');
});

it('what_if supports room override simulation', async () => {
  const result = await client.callTool({
    name: 'what_if',
    arguments: {
      changes: [{ topic: 'floor', optionId: 'floor_tile_02', roomId: 'master_bedroom' }],
    },
  });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  assert.ok(parsed.simulated.budget);
  const floorItems = parsed.simulated.budget.lineItems.filter(
    (li: { topic: string; roomId: string | null }) => li.topic === 'floor' && li.roomId === 'master_bedroom'
  );
  assert.ok(floorItems.length > 0, 'simulated budget must contain master_bedroom floor line item');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:server -- --test-name-pattern="what_if"`
Expected: FAIL — tool `what_if` not found.

- [ ] **Step 3: Implement in `mcp-server.ts`**

Append after the `restore_scheme` registration (before `return server;`):

```typescript
  server.registerTool(
    'what_if',
    {
      title: 'What-if analysis',
      description: 'Simulate selection changes without persisting. Returns full budget snapshot, risks, and diff vs current scheme.',
      inputSchema: z.object({
        changes: z.array(
          z.object({
            topic: z.string(),
            optionId: z.string().nullable(),
            roomId: z.string().optional(),
          })
        ),
      }),
    },
    async (args) => {
      const current = state.getCurrentScheme();
      const calc = getBudgetCalculator();
      const engine = getRuleEngine();

      const tempScheme: CurrentScheme = {
        updatedAt: new Date().toISOString(),
        selections: JSON.parse(JSON.stringify(current.selections)),
      };
      for (const change of args.changes) {
        const sel = tempScheme.selections[change.topic] ?? {
          default: null as string | null,
          roomOverrides: {} as Record<string, string>,
        };
        if (change.roomId) {
          if (change.optionId === null) delete sel.roomOverrides[change.roomId];
          else sel.roomOverrides[change.roomId] = change.optionId;
        } else {
          sel.default = change.optionId;
        }
        tempScheme.selections[change.topic] = sel;
      }

      const currentBudget = calc.calculate(current);
      const currentRisks = engine.evaluate(current, catalog);
      const simBudget = calc.calculate(tempScheme);
      const simRisks = engine.evaluate(tempScheme, catalog);

      const currentRiskIds = new Set(currentRisks.risks.map((r) => r.id));
      const simRiskIds = new Set(simRisks.risks.map((r) => r.id));

      return text({
        current: {
          totalBudget: currentBudget.totalBudget,
          totalActual: currentBudget.totalActual,
        },
        simulated: {
          totalBudget: simBudget.totalBudget,
          totalActual: simBudget.totalActual,
          budget: simBudget,
          risks: simRisks,
        },
        delta: {
          totalDelta: simBudget.totalActual - currentBudget.totalActual,
          categoryDeltas: simBudget.categories
            .map((c, i) => ({
              key: c.key,
              currentActual: currentBudget.categories[i].actual,
              simulatedActual: c.actual,
              delta: c.actual - currentBudget.categories[i].actual,
              status: c.status,
            }))
            .filter((d) => d.delta !== 0),
          risksAdded: simRisks.risks.filter((r) => !currentRiskIds.has(r.id)),
          risksRemoved: currentRisks.risks.filter((r) => !simRiskIds.has(r.id)),
        },
      });
    }
  );
```

`CurrentScheme` is already imported at `mcp-server.ts:8`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:server`
Expected: PASS — both new what_if tests.

- [ ] **Step 5: Commit**

```bash
git add server/mcp-server.ts tests/server/mcp.test.ts
git commit -m "feat(mcp): add what_if simulation tool

Simulates selection changes on a deep-copied scheme without persisting.
Returns full budget snapshot, risks, and diff (totalDelta, categoryDeltas,
risksAdded, risksRemoved) for AI tradeoff analysis."
```

---

### Task 5: Fix `priceDelta` in MCP `compare_schemes` and REST `/schemes/compare`

**Files:**
- Modify: `server/mcp-server.ts:289-308`
- Modify: `server/routes.ts:247-266`
- Test: `tests/server/archive/compare-schemes.test.ts` (check existing) or `tests/server/mcp.test.ts`

**Interfaces:**
- Consumes: `BudgetSnapshot.lineItems` (`{ topic, roomId, optionId, quantity, unitPrice, cost }`).
- Produces: `SelectionDiff.priceDelta` semantics change from unit-price delta to per-topic total-cost delta. Type `SelectionDiff` (`shared/types.ts:520-525`) is unchanged. Frontend (`SchemePanel.ts`) keeps working with corrected values.

First check for an existing compare test:

Run: `ls tests/server/archive/ 2>/dev/null; grep -rln "compare_schemes\|/schemes/compare" tests/server/`

- [ ] **Step 1: Write the failing test**

Append to `tests/server/mcp.test.ts` inside `describe('MCP remote', ...)`:

```typescript
it('compare_schemes priceDelta reflects total-cost delta', async () => {
  // Ensure current scheme has a known hvac selection
  await client.callTool({
    name: 'set_selection',
    arguments: { topic: 'hvac', optionId: 'A2', reason: 'setup compare' },
  });
  const arch = await client.callTool({
    name: 'archive_scheme',
    arguments: { name: 'compare-test', reason: 'test' },
  });
  const archived = JSON.parse((arch.content as { text: string }[])[0].text);

  // Switch to a different hvac option
  await client.callTool({
    name: 'set_selection',
    arguments: { topic: 'hvac', optionId: 'A1', reason: 'compare target' },
  });

  const cmp = await client.callTool({
    name: 'compare_schemes',
    arguments: { archiveId: archived.id },
  });
  const parsed = JSON.parse((cmp.content as { text: string }[])[0].text);
  const hvacDiff = parsed.diff.selections.find((s: { topic: string }) => s.topic === 'hvac');
  assert.ok(hvacDiff, 'hvac must appear in selection diffs');
  // priceDelta must equal the line-item cost difference, not the unit-price difference
  const curCost = parsed.current.budget.lineItems
    .filter((li: { topic: string }) => li.topic === 'hvac')
    .reduce((sum: number, li: { cost: number }) => sum + li.cost, 0);
  const cmpCost = parsed.compare.budget.lineItems
    .filter((li: { topic: string }) => li.topic === 'hvac')
    .reduce((sum: number, li: { cost: number }) => sum + li.cost, 0);
  assert.equal(hvacDiff.priceDelta, cmpCost - curCost);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server -- --test-name-pattern="priceDelta"`
Expected: FAIL — current implementation returns unit-price delta `(cmpOpt?.price_per_unit ?? 0) - (curOpt?.price_per_unit ?? 0)`.

- [ ] **Step 3: Fix in `mcp-server.ts`**

In `compare_schemes` handler (`mcp-server.ts:284-308`), replace the `selectionDiffs` construction. The inline array type annotation must also drop nothing (type stays `{topic, current, compare, priceDelta: number}`):

```typescript
      const topicCost = (snapshot: typeof currentBudget, topic: string): number =>
        snapshot.lineItems
          .filter((li) => li.topic === topic)
          .reduce((sum, li) => sum + li.cost, 0);

      const selectionDiffs: Array<{
        topic: string;
        current: string | null;
        compare: string | null;
        priceDelta: number;
      }> = [];

      for (const topic of allTopics) {
        const curOptId = current.selections[topic]?.default ?? null;
        const cmpOptId = archived.selections[topic]?.default ?? null;
        if (curOptId === cmpOptId) continue;
        const curOpt = curOptId ? catalog.getOption(topic, curOptId) : null;
        const cmpOpt = cmpOptId ? catalog.getOption(topic, cmpOptId) : null;
        selectionDiffs.push({
          topic,
          current: curOpt?.name ?? curOptId,
          compare: cmpOpt?.name ?? cmpOptId,
          priceDelta: topicCost(compareBudget, topic) - topicCost(currentBudget, topic),
        });
      }
```

- [ ] **Step 4: Fix identically in `routes.ts`**

In `/schemes/compare` handler (`routes.ts:247-266`), apply the same change — the handler already computes `currentBudget` and `compareBudget` (verify variable names at lines ~236-240; they are `currentBudget` and `compareBudget`):

```typescript
    const topicCost = (snapshot: typeof currentBudget, topic: string): number =>
      snapshot.lineItems
        .filter((li) => li.topic === topic)
        .reduce((sum, li) => sum + li.cost, 0);

    const selectionDiffs: Array<{
      topic: string;
      current: string | null;
      compare: string | null;
      priceDelta: number;
    }> = [];

    for (const topic of allTopics) {
      const curOptId = current.selections[topic]?.default ?? null;
      const cmpOptId = archived.selections[topic]?.default ?? null;
      if (curOptId === cmpOptId) continue;
      const curOpt = curOptId ? catalog.getOption(topic, curOptId) : null;
      const cmpOpt = cmpOptId ? catalog.getOption(topic, cmpOptId) : null;
      selectionDiffs.push({
        topic,
        current: curOpt?.name ?? curOptId,
        compare: cmpOpt?.name ?? cmpOptId,
        priceDelta: topicCost(compareBudget, topic) - topicCost(currentBudget, topic),
      });
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:server`
Expected: PASS — the new priceDelta test passes; frontend type unchanged so `npm run typecheck` also passes.

- [ ] **Step 6: Commit**

```bash
git add server/mcp-server.ts server/routes.ts tests/server/mcp.test.ts
git commit -m "fix(compare): priceDelta is per-topic total-cost delta, not unit-price delta

Fixed identically in MCP compare_schemes and REST /schemes/compare.
SelectionDiff type unchanged; frontend now displays real cost deltas."
```

---

### Task 6: PitfallEngine + `config/budget-pitfalls.yaml`

**Files:**
- Create: `config/budget-pitfalls.yaml`
- Create: `server/pitfall-engine.ts`
- Test: `tests/server/pitfall-engine.test.ts` (new)

**Interfaces:**
- Consumes: nothing (self-contained).
- Produces: `Pitfall`, `BudgetTemplate`, `PitfallConfig` interfaces; `PitfallEngine` class with `getPitfalls(opts?: { category?: string; type?: string; stage?: string }): Pitfall[]`, `getTemplate(tier?: string, targetBudget?: number): BudgetTemplate | undefined`, `listTemplates(): BudgetTemplate[]`. Constructor takes a `PitfallConfig` object (NOT a file path). Task 7 consumes these.

- [ ] **Step 1: Write the failing test**

Create `tests/server/pitfall-engine.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { PitfallEngine } from '../../server/pitfall-engine.js';
import type { PitfallConfig } from '../../server/pitfall-engine.js';

function loadEngine(): PitfallEngine {
  const raw = readFileSync('config/budget-pitfalls.yaml', 'utf8');
  return new PitfallEngine(load(raw) as PitfallConfig);
}

describe('PitfallEngine', () => {
  it('loads pitfalls from config/budget-pitfalls.yaml', () => {
    const engine = loadEngine();
    const all = engine.getPitfalls();
    assert.ok(all.length >= 20, 'expected at least 20 pitfalls (budget + construction + acceptance)');
  });

  it('filters by category', () => {
    const engine = loadEngine();
    const waterproof = engine.getPitfalls({ category: 'waterproof' });
    assert.ok(waterproof.length >= 3, 'waterproof should have budget + construction + acceptance entries');
    assert.ok(waterproof.every((p) => p.category === 'waterproof'));
  });

  it('filters by type', () => {
    const engine = loadEngine();
    const acceptance = engine.getPitfalls({ type: 'acceptance' });
    assert.ok(acceptance.length >= 5);
    assert.ok(acceptance.every((p) => p.type === 'acceptance'));
    assert.ok(acceptance.every((p) => Array.isArray(p.checklist) && p.checklist.length > 0));
  });

  it('filters by stage', () => {
    const engine = loadEngine();
    const we = engine.getPitfalls({ stage: 'water_electric' });
    assert.ok(we.length >= 2);
    assert.ok(we.every((p) => p.stage === 'water_electric'));
  });

  it('returns templates and selects by tier', () => {
    const engine = loadEngine();
    const templates = engine.listTemplates();
    assert.ok(templates.length >= 3);
    const pragmatic = engine.getTemplate('pragmatic');
    assert.ok(pragmatic);
    assert.equal(pragmatic.total, 110000);
  });

  it('selects template by target budget', () => {
    const engine = loadEngine();
    const t = engine.getTemplate(undefined, 160000);
    assert.ok(t);
    assert.equal(t.id, 'balanced');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server -- tests/server/pitfall-engine.test.ts`
Expected: FAIL — `config/budget-pitfalls.yaml` and `server/pitfall-engine.ts` do not exist.

- [ ] **Step 3: Create `server/pitfall-engine.ts`**

```typescript
export interface Pitfall {
  id: string;
  type: 'budget' | 'construction' | 'acceptance';
  stage: string;
  category: string;
  trigger: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  mitigation: string;
  checklist?: string[];
}

export interface BudgetTemplate {
  id: string;
  name: string;
  total: number;
  description: string;
  allocation: Record<string, number>;
}

export interface PitfallConfig {
  version: string;
  pitfalls: Pitfall[];
  templates: BudgetTemplate[];
}

export class PitfallEngine {
  private config: PitfallConfig;

  constructor(config: PitfallConfig) {
    this.config = config;
  }

  getPitfalls(opts?: { category?: string; type?: string; stage?: string }): Pitfall[] {
    return this.config.pitfalls.filter(
      (p) =>
        (!opts?.category || p.category === opts.category) &&
        (!opts?.type || p.type === opts.type) &&
        (!opts?.stage || p.stage === opts.stage)
    );
  }

  getTemplate(tier?: string, targetBudget?: number): BudgetTemplate | undefined {
    if (tier) {
      const found = this.config.templates.find((t) => t.id === tier);
      if (found) return found;
    }
    if (targetBudget) {
      return this.config.templates
        .filter((t) => t.total <= targetBudget)
        .sort((a, b) => b.total - a.total)[0];
    }
    return this.config.templates[0];
  }

  listTemplates(): BudgetTemplate[] {
    return this.config.templates;
  }
}
```

- [ ] **Step 4: Create `config/budget-pitfalls.yaml`**

Copy the full content from the spec's "4a. `config/budget-pitfalls.yaml`" section (in `docs/superpowers/specs/2026-07-21-budget-advisor-enhancement-design.md`, search for heading `**4a.` — the complete pitfalls + templates YAML, already validated in the spec). The file must contain:
- 9 `type: budget` pitfalls: `waterproof_overshoot`, `open_kitchen_hood`, `curtain_hardcoded`, `smart_zero_line`, `contingency_reserve`, `demolition_unknown`, `hvac_platform`, `tile_waste_rate`, `floor_vs_furniture_tradeoff`
- 8 `type: construction` pitfalls: `waterproof_shortcut`, `electric_shortcut`, `masonry_shortcut`, `painting_shortcut`, `carpentry_shortcut`, `door_window_shortcut`, `cabinet_install_shortcut`, `sanitary_install_shortcut`
- 6 `type: acceptance` pitfalls (each with a `checklist` array): `waterproof_acceptance`, `electric_acceptance`, `masonry_acceptance`, `painting_acceptance`, `carpentry_acceptance`, `installation_acceptance`
- 3 templates: `pragmatic` (110000), `balanced` (150000), `quality` (200000)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:server`
Expected: PASS — all 6 PitfallEngine tests.

- [ ] **Step 6: Commit**

```bash
git add config/budget-pitfalls.yaml server/pitfall-engine.ts tests/server/pitfall-engine.test.ts
git commit -m "feat(pitfalls): add PitfallEngine + budget-pitfalls.yaml knowledge base

Three knowledge types: budget traps, construction shortcuts, acceptance
checkpoints (with checklists). Three allocation templates (11w/15w/20w).
Engine takes parsed config object (ConfigLoader owns IO)."
```

---

### Task 7: Pitfall MCP Tools + `index.ts` Integration

**Files:**
- Modify: `server/mcp-server.ts` (McpDeps + 2 tools at end)
- Modify: `server/index.ts` (pitfallsLoader, rebuildDerived, apiDeps)
- Test: `tests/server/mcp.test.ts`
- Modify: `tests/server/mcp.test.ts:33-41` and `tests/server/index.test.ts` deps objects (add `getPitfallEngine`)

**Interfaces:**
- Consumes: `PitfallEngine` (Task 6).
- Produces: `McpDeps.getPitfallEngine: () => PitfallEngine`; MCP tools `get_pitfalls({category?, type?, stage?})` and `recommend_allocation({totalBudget?, tier?})`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/mcp.test.ts` inside `describe('MCP remote', ...)`:

```typescript
it('get_pitfalls returns pitfalls filtered by category', async () => {
  const result = await client.callTool({
    name: 'get_pitfalls',
    arguments: { category: 'waterproof' },
  });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.length >= 3);
  assert.ok(parsed.every((p: { category: string }) => p.category === 'waterproof'));
});

it('get_pitfalls returns acceptance checklists', async () => {
  const result = await client.callTool({
    name: 'get_pitfalls',
    arguments: { type: 'acceptance' },
  });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  assert.ok(parsed.length >= 5);
  assert.ok(parsed.every((p: { checklist?: string[] }) => Array.isArray(p.checklist)));
});

it('recommend_allocation returns pragmatic template', async () => {
  const result = await client.callTool({
    name: 'recommend_allocation',
    arguments: { tier: 'pragmatic' },
  });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  assert.equal(parsed.id, 'pragmatic');
  assert.equal(parsed.total, 110000);
  assert.ok(parsed.allocation.masonry);
});
```

- [ ] **Step 2: Update the test deps object in `tests/server/mcp.test.ts`**

In the `before` block (lines 33-41), add `getPitfallEngine` to the deps and import the engine:

```typescript
import { PitfallEngine } from '../../server/pitfall-engine.js';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
```

```typescript
    const pitfallEngine = new PitfallEngine(
      load(readFileSync('config/budget-pitfalls.yaml', 'utf8')) as never
    );
    const deps = {
      catalog,
      state,
      getRuleEngine: () => engine,
      getBudgetCalculator: () => calc,
      getPitfallEngine: () => pitfallEngine,
      archiveStore,
      getConfigRegistry: () => new ConfigRegistry(),
      getOverlay: () => undefined,
    };
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:server -- --test-name-pattern="pitfalls|allocation"`
Expected: FAIL — tools `get_pitfalls`/`recommend_allocation` not found. Also `npm run typecheck` FAILS — `McpDeps` doesn't yet require `getPitfallEngine`, but `createMcpServer(deps)` in `index.test.ts`/`mcp.test.ts` has an extra property (excess property check may or may not trigger depending on how deps is typed; the authoritative failure is missing tools at runtime).

- [ ] **Step 4: Add `getPitfallEngine` to `McpDeps` and register the tools**

In `server/mcp-server.ts`, update imports and `McpDeps` (lines 1-20):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectCatalog } from './project-catalog.js';
import type { DesignState } from './design-state.js';
import type { RuleEngine } from './rule-engine.js';
import type { BudgetCalculator } from './budget-calculator.js';
import type { PitfallEngine } from './pitfall-engine.js';
import type { ArchivedSchemesStore } from './archived-schemes.js';
import type { CurrentScheme } from '../shared/types.js';

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export interface McpDeps {
  catalog: ProjectCatalog;
  state: DesignState;
  getRuleEngine: () => RuleEngine;
  getBudgetCalculator: () => BudgetCalculator;
  getPitfallEngine: () => PitfallEngine;
  archiveStore: ArchivedSchemesStore;
}
```

Destructure `getPitfallEngine` in `createMcpServer` (line 23):

```typescript
  const { catalog, state, getRuleEngine, getBudgetCalculator, getPitfallEngine, archiveStore } = deps;
```

Register the two tools (append after `what_if`, before `return server;`):

```typescript
  server.registerTool(
    'get_pitfalls',
    {
      title: 'Get budget pitfalls',
      description: 'Return renovation pitfalls: budget traps, construction shortcuts, acceptance checkpoints. Filter by category/type/stage.',
      inputSchema: z.object({
        category: z.string().optional(),
        type: z.string().optional(),
        stage: z.string().optional(),
      }),
    },
    async (args) => text(getPitfallEngine().getPitfalls(args))
  );

  server.registerTool(
    'recommend_allocation',
    {
      title: 'Recommend budget allocation',
      description: 'Return budget allocation template for a target total and tier (pragmatic/balanced/quality).',
      inputSchema: z.object({
        totalBudget: z.number().optional(),
        tier: z.string().optional(),
      }),
    },
    async (args) => {
      const template = getPitfallEngine().getTemplate(args.tier, args.totalBudget);
      if (!template) return text({ error: 'no matching template' });
      return text(template);
    }
  );
```

- [ ] **Step 5: Wire `index.ts` with pitfallsLoader**

In `server/index.ts`:

Add import:

```typescript
import { PitfallEngine } from './pitfall-engine.js';
import type { PitfallConfig } from './pitfall-engine.js';
```

Add engine instance near the other `let` declarations (line 28):

```typescript
let pitfallEngine = new PitfallEngine({ version: '1.0', pitfalls: [], templates: [] });
```

In `rebuildDerived()` (lines 30-39), add at the end:

```typescript
  const pitfallConfig = pitfallsLoader.getConfig() ?? { version: '1.0', pitfalls: [], templates: [] };
  pitfallEngine = new PitfallEngine(pitfallConfig);
```

Add the loader (after `houseMetaLoader` registration, ~line 89):

```typescript
const pitfallsLoader = new ConfigLoader<PitfallConfig>(
  'config/budget-pitfalls.yaml',
  (raw) => load(raw) as PitfallConfig,
  () => {
    rebuildDerived();
    console.log('[server] config/budget-pitfalls.yaml reloaded');
  }
);
registry.register(pitfallsLoader);
```

Call `pitfallsLoader.load()` after `houseMetaLoader.load()` (line 104), and `pitfallsLoader.startWatching()` in the listen callback (after line 140).

Add `getPitfallEngine` to `apiDeps` (lines 117-125):

```typescript
const apiDeps = {
  get catalog() { return catalog; },
  state,
  getRuleEngine: () => ruleEngine,
  getBudgetCalculator: () => budgetCalculator,
  getPitfallEngine: () => pitfallEngine,
  archiveStore,
  getConfigRegistry: () => registry,
  getOverlay: () => overlayLoader.getConfig(),
};
```

- [ ] **Step 6: Fix `tests/server/index.test.ts` deps**

`tests/server/index.test.ts` calls `createMcpServer(deps)` — its deps object (around line 45-55) must gain `getPitfallEngine`. Add the import and field the same way as `mcp.test.ts` Step 2:

```typescript
import { PitfallEngine } from '../../server/pitfall-engine.js';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
```

```typescript
      getPitfallEngine: () => new PitfallEngine(
        load(readFileSync('config/budget-pitfalls.yaml', 'utf8')) as never
      ),
```

(`api.test.ts` and `budget-api.test.ts` only use `createApiRouter`, whose `ApiDeps` is unchanged — no edits needed there.)

- [ ] **Step 7: Run typecheck and tests**

Run: `npm run typecheck && npm run test:server`
Expected: PASS — typecheck clean, all tests pass including the 3 new pitfall tool tests.

- [ ] **Step 8: Commit**

```bash
git add server/mcp-server.ts server/index.ts tests/server/mcp.test.ts tests/server/index.test.ts
git commit -m "feat(mcp): register get_pitfalls + recommend_allocation tools

McpDeps.getPitfallEngine is a getter (hot-reload safe). index.ts loads
config/budget-pitfalls.yaml via ConfigLoader and rebuilds engine on change."
```

---

### Task 8: Spec Parser Utility

**Files:**
- Create: `server/spec-parser.ts`
- Test: `tests/server/spec-parser.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `ParsedDimensions { width: number; height: number; depth: number }` (meters); `parseSpecDimensions(spec: string): ParsedDimensions | null`. Task 9/10 consume this.

- [ ] **Step 1: Write the failing test**

Create `tests/server/spec-parser.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpecDimensions } from '../../server/spec-parser.js';

describe('parseSpecDimensions', () => {
  it('parses 3-dimension mm spec', () => {
    const d = parseSpecDimensions('2800×900×400mm');
    assert.ok(d);
    assert.equal(d.width, 2.8);
    assert.equal(d.height, 0.9);
    assert.equal(d.depth, 0.4);
  });

  it('parses 2-dimension mm spec with x separator', () => {
    const d = parseSpecDimensions('800x800mm');
    assert.ok(d);
    assert.equal(d.width, 0.8);
    assert.equal(d.height, 0.8);
    assert.equal(d.depth, 0);
  });

  it('parses bed spec', () => {
    const d = parseSpecDimensions('1800×2000mm');
    assert.ok(d);
    assert.equal(d.width, 1.8);
    assert.equal(d.height, 2.0);
    assert.equal(d.depth, 0);
  });

  it('parses meter-unit spec as meters', () => {
    const d = parseSpecDimensions('2.8×0.9×0.4m');
    assert.ok(d);
    assert.equal(d.width, 2.8);
    assert.equal(d.height, 0.9);
    assert.equal(d.depth, 0.4);
  });

  it('returns null for non-dimension specs', () => {
    assert.equal(parseSpecDimensions('18L'), null);
    assert.equal(parseSpecDimensions('标准'), null);
    assert.equal(parseSpecDimensions('L型'), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server -- tests/server/spec-parser.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `server/spec-parser.ts`**

```typescript
export interface ParsedDimensions {
  width: number;
  height: number;
  depth: number;
}

export function parseSpecDimensions(spec: string): ParsedDimensions | null {
  const cleaned = spec.replace(/\s/g, '');
  const match = cleaned.match(/(\d+(?:\.\d+)?)[×xX](\d+(?:\.\d+)?)(?:[×xX](\d+(?:\.\d+)?))?/);
  if (!match) return null;

  const toMeters = (val: number): number => (cleaned.includes('mm') ? val / 1000 : val);

  const w = toMeters(parseFloat(match[1]));
  const h = toMeters(parseFloat(match[2]));
  const d = match[3] ? toMeters(parseFloat(match[3])) : 0;

  return { width: w, height: h, depth: d };
}
```

Note: `'2.8×0.9×0.4m'` contains `mm`? No — it contains single `m` only. But check: `'2.8×0.9×0.4m'.includes('mm')` is `false` → values treated as meters. Correct. And `'800x800mm 亮光'.replace(/\s/g,'')` → `'800x800mm亮光'` includes `'mm'` → mm. Correct. Edge: `'18L'` has no `×` → null. Correct.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:server`
Expected: PASS — all 5 parser tests.

- [ ] **Step 5: Commit**

```bash
git add server/spec-parser.ts tests/server/spec-parser.test.ts
git commit -m "feat(parser): add spec dimension parser (mm/m, 2-3 dims)

Parses materials.yaml spec text like '2800×900×400mm' into meters.
Returns null for non-dimension specs ('18L', '标准')."
```

---

### Task 9: ProjectCatalog Spatial Methods (`getAllMaterials`, `getRoomLayoutDetail`)

**Files:**
- Modify: `server/project-catalog.ts` (constructor ~line 108, add methods at end)
- Test: `tests/server/project-catalog.test.ts`

**Interfaces:**
- Consumes: existing `ProjectCatalog` fields (`rooms`, `walls`, `furnishings`, `electricalMarkers`).
- Produces: `getAllMaterials(): MaterialItem[]`; `getRoomLayoutDetail(roomId: string): { room: RoomLayout; walls: WallSegment[]; furnishings: Record<string, number>; electricalMarkers: ElectricalMarker[]; adjacentRooms: string[] } | undefined`. Task 10 consumes both.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/project-catalog.test.ts` inside `describe('ProjectCatalog', ...)`:

```typescript
it('getAllMaterials returns raw material items', () => {
  const catalog = ProjectCatalog.load('.');
  const materials = catalog.getAllMaterials();
  assert.ok(materials.length >= 28);
  const sofa = materials.find((m) => m.id === 'sofa_3seat_01');
  assert.ok(sofa);
  assert.equal(sofa.spec, '2800×900×400mm');
  assert.equal(sofa.alternative_group, 'sofa');
});

it('getRoomLayoutDetail returns room with walls, openings, furnishings', () => {
  const catalog = ProjectCatalog.load('.');
  const detail = catalog.getRoomLayoutDetail('master_bedroom');
  assert.ok(detail);
  assert.equal(detail.room.id, 'master_bedroom');
  assert.ok(detail.room.width > 0);
  assert.ok(detail.room.depth > 0);
  assert.ok(detail.walls.length > 0, 'must find boundary walls');
  assert.ok(detail.furnishings.bed_180 === 1);
  assert.ok(Array.isArray(detail.electricalMarkers));
  assert.ok(Array.isArray(detail.adjacentRooms));
});

it('getRoomLayoutDetail returns undefined for unknown room', () => {
  const catalog = ProjectCatalog.load('.');
  assert.equal(catalog.getRoomLayoutDetail('nonexistent_room'), undefined);
});

it('getRoomLayoutDetail includes wall openings for rooms with doors', () => {
  const catalog = ProjectCatalog.load('.');
  const detail = catalog.getRoomLayoutDetail('master_bedroom');
  assert.ok(detail);
  const openings = detail.walls.flatMap((w) => w.openings ?? []);
  assert.ok(openings.length > 0, 'master_bedroom must have at least one door opening');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:server -- --test-name-pattern="getAllMaterials|getRoomLayoutDetail"`
Expected: FAIL — methods do not exist (typecheck fails too).

- [ ] **Step 3: Implement in `project-catalog.ts`**

Add a private field to the class (near line 89-96):

```typescript
  private rawMaterials: MaterialItem[] = [];
```

In the constructor (line 98-107), store raw materials before the topic-building loop:

```typescript
    this.rawMaterials = materials.materials;
```

Add methods at the end of the class (after `isValidRoom`, ~line 304):

```typescript
  getAllMaterials(): MaterialItem[] {
    return this.rawMaterials;
  }

  getRoomLayoutDetail(roomId: string): {
    room: RoomLayout;
    walls: WallSegment[];
    furnishings: Record<string, number>;
    electricalMarkers: ElectricalMarker[];
    adjacentRooms: string[];
  } | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const EPS = 0.01;
    const inRoom = (x: number, z: number, r: RoomLayout): boolean =>
      x >= r.x - r.width / 2 - EPS &&
      x <= r.x + r.width / 2 + EPS &&
      z >= r.z - r.depth / 2 - EPS &&
      z <= r.z + r.depth / 2 + EPS;

    const roomWalls = this.walls.filter(
      (w) => inRoom(w.x1, w.z1, room) || inRoom(w.x2, w.z2, room)
    );

    const adjacentRooms = new Set<string>();
    for (const w of roomWalls) {
      for (const [otherId, other] of this.rooms) {
        if (otherId === roomId) continue;
        if (inRoom(w.x1, w.z1, other) || inRoom(w.x2, w.z2, other)) {
          adjacentRooms.add(otherId);
        }
      }
    }

    return {
      room,
      walls: roomWalls,
      furnishings: this.furnishings[roomId] ?? {},
      electricalMarkers: this.electricalMarkers.filter((m) => m.roomId === roomId),
      adjacentRooms: [...adjacentRooms],
    };
  }
```

`MaterialItem`, `RoomLayout`, `WallSegment`, `ElectricalMarker` are already imported in `project-catalog.ts` (lines 4-21).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:server`
Expected: PASS — all 4 new project-catalog tests.

- [ ] **Step 5: Commit**

```bash
git add server/project-catalog.ts tests/server/project-catalog.test.ts
git commit -m "feat(catalog): add getAllMaterials + getRoomLayoutDetail

Exposes raw MaterialItem array (for spec parsing) and full room spatial
detail (walls, openings, furnishings, electrical, adjacent rooms) via
bounding-box heuristic."
```

---

### Task 10: Spatial MCP Tools (`get_room_layout`, `get_furniture_inventory`)

**Files:**
- Modify: `server/mcp-server.ts` (2 tools at end)
- Test: `tests/server/mcp.test.ts`

**Interfaces:**
- Consumes: `ProjectCatalog.getRoomLayoutDetail()` + `getAllMaterials()` (Task 9), `parseSpecDimensions()` (Task 8).
- Produces: MCP tool `get_room_layout({roomId?})` returning detail object or array; MCP tool `get_furniture_inventory({roomId?})` returning `Record<roomId, Array<{type, count, dimensions?, spec?, materialId?}>>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/mcp.test.ts` inside `describe('MCP remote', ...)`:

```typescript
it('get_room_layout returns master_bedroom detail', async () => {
  const result = await client.callTool({
    name: 'get_room_layout',
    arguments: { roomId: 'master_bedroom' },
  });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  assert.equal(parsed.room.id, 'master_bedroom');
  assert.ok(parsed.room.width > 0);
  assert.ok(parsed.walls.length > 0);
  assert.equal(parsed.furnishings.bed_180, 1);
  assert.ok(Array.isArray(parsed.adjacentRooms));
});

it('get_room_layout without roomId returns all rooms', async () => {
  const result = await client.callTool({ name: 'get_room_layout', arguments: {} });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.length >= 10, 'expected at least 10 rooms');
});

it('get_room_layout returns error for unknown room', async () => {
  const result = await client.callTool({
    name: 'get_room_layout',
    arguments: { roomId: 'nonexistent' },
  });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  assert.equal(parsed.error, 'room not found: nonexistent');
});

it('get_furniture_inventory returns sofa with parsed dimensions', async () => {
  const result = await client.callTool({
    name: 'get_furniture_inventory',
    arguments: { roomId: 'living_dining' },
  });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  const items = parsed.living_dining;
  assert.ok(Array.isArray(items));
  const sofa = items.find((i: { type: string }) => i.type === 'sofa_3seat');
  assert.ok(sofa, 'sofa_3seat must be present in living_dining');
  assert.equal(sofa.count, 1);
  assert.ok(sofa.dimensions, 'sofa dimensions must be parsed');
  assert.equal(sofa.dimensions.width, 2.8);
  assert.equal(sofa.dimensions.height, 0.9);
  assert.equal(sofa.dimensions.depth, 0.4);
  assert.equal(sofa.materialId, 'sofa_3seat_01');
});

it('get_furniture_inventory omits dimensions for unparseable specs', async () => {
  const result = await client.callTool({
    name: 'get_furniture_inventory',
    arguments: { roomId: 'living_dining' },
  });
  const text = (result.content as { text: string }[])[0].text;
  const parsed = JSON.parse(text);
  const items = parsed.living_dining;
  const chair = items.find((i: { type: string }) => i.type === 'dining_chair');
  assert.ok(chair);
  assert.equal(chair.dimensions, undefined, 'dining_chair spec "标准" yields no dimensions');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:server -- --test-name-pattern="room_layout|furniture_inventory"`
Expected: FAIL — tools not found.

- [ ] **Step 3: Implement in `mcp-server.ts`**

Add import at top:

```typescript
import { parseSpecDimensions } from './spec-parser.js';
```

Add a module-level helper (above `createMcpServer`):

```typescript
function findMaterialByFurnitureType(
  catalog: ProjectCatalog,
  type: string
): ReturnType<ProjectCatalog['getAllMaterials']>[number] | undefined {
  const materials = catalog.getAllMaterials();
  const base = type.replace(/_\d+\w*$/, '');
  return materials.find((m) => m.alternative_group === base);
}
```

Note: `ProjectCatalog` is imported as a type at `mcp-server.ts:3` (`import type { ProjectCatalog }`). The helper needs the type only — fine.

Register the two tools (append before `return server;`):

```typescript
  server.registerTool(
    'get_room_layout',
    {
      title: 'Get room layout',
      description: 'Return full spatial detail for a room: dimensions, walls, door/window openings, furnishings, electrical markers, and adjacent rooms. If roomId omitted, returns all rooms.',
      inputSchema: z.object({ roomId: z.string().optional() }),
    },
    async (args) => {
      if (args.roomId) {
        const detail = catalog.getRoomLayoutDetail(args.roomId);
        if (!detail) return text({ error: `room not found: ${args.roomId}` });
        return text(detail);
      }
      const allRooms = catalog
        .getRooms()
        .map((r) => catalog.getRoomLayoutDetail(r.id))
        .filter((d) => d !== undefined);
      return text(allRooms);
    }
  );

  server.registerTool(
    'get_furniture_inventory',
    {
      title: 'Get furniture inventory',
      description: 'Return furniture per room with parsed dimensions from materials spec. Combines house.yaml furnishings counts with materials.yaml dimensions.',
      inputSchema: z.object({ roomId: z.string().optional() }),
    },
    async (args) => {
      const furnishings = catalog.getFurnishings();
      const result: Record<
        string,
        Array<{
          type: string;
          count: number;
          dimensions?: { width: number; height: number; depth: number };
          spec?: string;
          materialId?: string;
        }>
      > = {};

      const roomIds = args.roomId ? [args.roomId] : Object.keys(furnishings);
      for (const rid of roomIds) {
        const items = furnishings[rid];
        if (!items) continue;
        result[rid] = [];
        for (const [type, count] of Object.entries(items)) {
          if (!count || count <= 0) continue;
          const material = findMaterialByFurnitureType(catalog, type);
          const dimensions = material ? parseSpecDimensions(material.spec) : null;
          result[rid].push({
            type,
            count,
            dimensions: dimensions ?? undefined,
            spec: material?.spec,
            materialId: material?.id,
          });
        }
      }
      return text(result);
    }
  );
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm run test:server`
Expected: PASS — all 5 new spatial tool tests, plus the full suite.

- [ ] **Step 5: Run geometry verifiers (sanity check per AGENTS.md)**

Run: `npx tsx scripts/verify-topology.ts && npx tsx scripts/verify-layout.ts`
Expected: PASS — no geometry changes were made, but confirm no collateral damage.

- [ ] **Step 6: Commit**

```bash
git add server/mcp-server.ts tests/server/mcp.test.ts
git commit -m "feat(mcp): add get_room_layout + get_furniture_inventory tools

AI can now reason about space from data: room dimensions, walls, openings,
furnishings with parsed dimensions (bed_180→bed, sofa_3seat→sofa)."
```

---

## Self-Review

**1. Spec coverage:**

| Spec change | Task |
|---|---|
| Change 1: Overrun detection + attribution | Task 1 |
| Change 2: Fast feedback (previousScheme + budgetImpact) | Tasks 2, 3 |
| Change 3: what_if + priceDelta fix (MCP + REST) | Tasks 4, 5 |
| Change 4: Pitfall KB (yaml + engine + tools + index.ts) | Tasks 6, 7 |
| Change 5: Spatial exposure (parser + catalog + tools) | Tasks 8, 9, 10 |

All spec sections covered. The `budget-pitfalls.yaml` content itself is in Task 6 Step 4, referencing the spec's validated YAML.

**2. Placeholder scan:** Task 6 Step 4 says "Copy the full content from the spec section 4a" — the YAML content is ~400 lines already written and validated in the spec document; the implementer copies it verbatim. This is a deliberate reference to avoid duplicating 400 lines in two documents, not an underspecified step (the exact ids, counts, and structure are enumerated as a checklist). All other steps contain complete code.

**3. Type consistency:**
- `BudgetCategory.status` union defined in Task 1, consumed in Tasks 3, 4 — consistent.
- `ApplyResult.previousScheme` added in Task 2, consumed in Task 3 — consistent.
- `PitfallEngine` constructor takes `PitfallConfig` object (Task 6), used in Task 7 test deps and index.ts — consistent.
- `getPitfallEngine: () => PitfallEngine` in McpDeps (Task 7) — consistent with index.ts apiDeps.
- `getRoomLayoutDetail` return shape (Task 9) matches what `get_room_layout` returns (Task 10) — consistent.
- `findMaterialByFurnitureType(catalog, type)` signature in Task 10 takes catalog as first arg (helper is module-level, needs catalog passed) — consistent with usage inside the tool handler.
- `parseSpecDimensions` returns `{width, height, depth}` (Task 8), consumed in Task 10 as `dimensions` — consistent.
