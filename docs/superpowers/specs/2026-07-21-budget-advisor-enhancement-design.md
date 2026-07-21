# Design: Budget Advisor Enhancement

## Status

Draft → pending implementation

## Scope

This spec covers the budget-planning dimension enhancement for the bontop-design-log system. The current system has a complete budget calculation engine (17 categories, 3 calc modes, labor cost), but lacks an AI analysis feedback loop: AI can only read numbers via MCP, not provide analysis, attribution, what-if simulation, or pitfall guidance.

### In Scope

Four server-side changes totaling ~550 lines, with **zero frontend changes, zero breaking changes, zero new npm dependencies**:

1. **Overrun detection + attribution** — enhance `get_budget` to return `status` (`ok`/`near`/`over`) and `attribution` (top line items causing overrun)
2. **Fast feedback on selection** — `set_selection` and `batch_set_selections` return `budgetImpact` (total delta, category deltas, new risks)
3. **What-if simulation tool** — new `what_if` MCP tool that simulates selection changes without persisting; returns full budget snapshot + risks + diff
4. **Pitfall knowledge base** — new `config/budget-pitfalls.yaml` + `server/pitfall-engine.ts` + 2 MCP tools (`get_pitfalls`, `recommend_allocation`), covering three knowledge types: budget traps, construction shortcuts, acceptance checkpoints

### Out of Scope

- Visual feedback loop (GLTF loading, screenshots, per-room 3D override) — user will use multimodal model with manual screenshots instead
- Material archive enhancement (image_url, product_url, procurement status) — separate future work
- AI analysis quality validation — validate empirically after implementation; add `analyze_budget` precomputation tool only if AI reasoning proves insufficient
- Real-time push notifications (SSE/WebSocket) — current polling is sufficient
- Trigger expression parsing for pitfalls (`selection.kitchen == 'open'` syntax) — pitfalls return all entries; AI filters contextually
- Localized price data for Nanning — prices are research snapshots in `materials.yaml`

## Background

### Current State

The system's budget engine is functionally complete for calculation, but the AI feedback loop is broken at six points:

| Breakpoint | Evidence | Impact |
|---|---|---|
| No overrun detection | `budget-calculator.ts:222` returns `status: bc.status` directly from `base.json`, always `"draft"` | AI cannot tell if a category is over budget |
| No attribution | `BudgetSnapshot` (`shared/types.ts:284-289`) has no `attribution` field | AI sees overrun number but not which line items caused it |
| No what-if | `set_selection` persists immediately; no way to simulate without committing | AI cannot answer "what if I chose X instead?" without changing state |
| No fast feedback | `mcp-server.ts:120` `set_selection` returns only `{ updated, entries }` | AI must make a second `get_budget` call to see impact |
| No pitfall knowledge | `design-rules.yaml:114-176` has only 6 product-level risks (range hood airflow, tile glare) | AI has no renovation experience to draw on |
| No allocation templates | `config/budget/base.json` is a single fixed 110k CNY baseline | AI cannot recommend alternative budget allocations |

Additionally, `mcp-server.ts:306` in `compare_schemes` has a bug: `priceDelta` is computed as unit-price difference, not total-cost difference, which is misleading. (The original design in `2026-07-12-full-renovation-tradeoff-system-design.md:390-391` intended `priceDelta` as a useful signal, but implementation made it unit-price difference rather than total-cost difference. Since fixing it to total-cost would require line-item attribution per topic — which is non-trivial — and `diff.budget` already provides the total-cost delta, this spec removes the misleading field rather than fixing it.)

### Root Cause

The root cause is architectural: `BudgetCalculator` was designed as a pure calculation engine, `RuleEngine` was designed for product-selection rules (its `resolveVariable` at `rule-engine.ts:19-32` only resolves `$topic`/`$room`/`$selection.X`/`$option.field`, not budget context), and `McpServer` was designed as a data access layer. None of them were designed to provide analytical feedback.

Rather than rewriting these engines, this spec layers analysis on top of existing infrastructure:

- Overrun detection lives in `BudgetCalculator` (it already computes `actual`)
- What-if reuses `BudgetCalculator.calculate(scheme)` and `RuleEngine.evaluate(scheme, catalog)` with a temporary non-persisted scheme
- Pitfalls live in a new `PitfallEngine` that mirrors `RuleEngine`'s config-driven pattern

### Goal

Transform AI from "data administrator" to "budget advisor":

- **Before**: AI calls `get_budget`, reads numbers, user asks follow-up questions
- **After**: AI calls `set_selection`, automatically receives budget impact + risks; calls `what_if` to compare alternatives; calls `get_pitfalls` to ground advice in renovation experience

## Design

### Change 1: Overrun Detection + Attribution

#### Problem

`BudgetCategory.status` is always `"draft"`. `BudgetSnapshot` has no attribution analysis.

#### Solution

**1a. `shared/types.ts` — extend types**

`BudgetCategory.status` changes from `string` to a union:
```typescript
status: 'draft' | 'ok' | 'near' | 'over' | 'reserved';
```

New interface:
```typescript
export interface BudgetAttribution {
  topItems: BudgetLineItem[];  // top 3 by cost, descending
  overBy: number;              // actual - budget
  ratio: number;               // actual / budget
}
```

`BudgetSnapshot` gains an optional `attribution` field:
```typescript
export interface BudgetSnapshot {
  totalBudget: number;
  totalActual: number;
  categories: BudgetCategory[];
  lineItems: BudgetLineItem[];
  attribution?: Record<string, BudgetAttribution>;  // only for near/over categories
}
```

**1b. `budget-calculator.ts` — modify `calculate()`**

At `budget-calculator.ts:214-225`, compute `status` before returning:
```typescript
const categories: BudgetCategory[] = baseCategories.map((bc) => {
  const autoActual = categoryAutoActual.get(bc.key) ?? 0;
  const actual = bc.actual + autoActual;
  const ratio = bc.budget > 0 ? actual / bc.budget : 0;
  const status: BudgetCategory['status'] =
    bc.status === 'reserved' ? 'reserved' :
    ratio > 1.0 ? 'over' :
    ratio > 0.9 ? 'near' : 'ok';
  return { key: bc.key, budget: bc.budget, actual, manualActual: bc.actual, autoActual, status, notes: bc.notes };
});
```

After `computeLabor` (line 227) and before `return` (line 232), add attribution:
```typescript
const topicCategoriesMap = this.rulesConfig.budget?.topicCategories ?? {};
const attribution: Record<string, BudgetAttribution> = {};
for (const cat of categories) {
  if (cat.status === 'over' || cat.status === 'near') {
    const catLineItems = allLineItems
      .filter(li => topicCategoriesMap[li.topic] === cat.key)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 3);
    attribution[cat.key] = {
      topItems: catLineItems,
      overBy: cat.actual - cat.budget,
      ratio: cat.budget > 0 ? cat.actual / cat.budget : 0,
    };
  }
}
return { totalBudget, totalActual, categories, lineItems: allLineItems, attribution };
```

#### Design Decisions

- **Threshold 0.9 for `near`**: gives AI early warning before actual overrun. Tunable via config if needed later.
- **`reserved` preserved for `contingency`**: `base.json:24` sets contingency status to `"reserved"`; we honor this rather than collapsing it to `ok`.
- **Attribution optional**: existing consumers ignore the new field; no breaking change.
- **No rule-engine extension**: adding `$category.actual` variable resolution to `RuleEngine` was considered but rejected — it would entangle budget state with rule evaluation. Overrun is a property of the budget snapshot, not a selection rule.

#### Impact

- `shared/types.ts`: modify 2 interfaces + add 1 new interface (~20 lines)
- `server/budget-calculator.ts`: modify `calculate()` return logic (~55 lines)
- `config/budget/base.json`: no change (status now computed in code)
- **0 frontend changes, 0 breaking changes**

#### Verification

- `npm run typecheck` passes
- `npm run test:server` passes (update `tests/server/budget-calculator.test.ts` status assertions from `"draft"` to `"ok"`/`"near"`/`"over"`)
- Manual MCP call `get_budget` confirms `status` and `attribution` present

---

### Change 2: Fast Feedback on Selection

#### Problem

`mcp-server.ts:120` `set_selection` returns `{ updated, entries }`. AI must make a second `get_budget` call to see budget impact — too slow for iterative decision-making.

#### Solution

**2a. `server/design-state.ts` — `applySelections` returns `previousScheme`**

At the start of `applySelections`, deep-copy the current scheme:
```typescript
applySelections(patches, reason, source): {
  updated: string;
  entries: DecisionLogEntry[];
  previousScheme: CurrentScheme;
} {
  const previousScheme = JSON.parse(JSON.stringify(this.currentScheme)) as CurrentScheme;
  // ... existing logic unchanged ...
  return { updated: this.currentScheme.updatedAt, entries, previousScheme };
}
```

**2b. `mcp-server.ts` — enhance `set_selection`**

`mcp-server.ts:114-121` becomes:
```typescript
async (args) => {
  const result = state.applySelections(
    [{ topic: args.topic, optionId: args.optionId, roomId: args.roomId, reason: args.reason }],
    args.reason, args.source ?? 'ai'
  );
  const calc = getBudgetCalculator();
  const engine = getRuleEngine();
  const newScheme = state.getCurrentScheme();
  const prevBudget = calc.calculate(result.previousScheme);
  const newBudget = calc.calculate(newScheme);
  const newRisks = engine.evaluate(newScheme, catalog);
  const categoryDeltas = newBudget.categories
    .map((c, i) => ({ key: c.key, delta: c.actual - prevBudget.categories[i].actual, status: c.status }))
    .filter(d => d.delta !== 0);
  return text({
    updated: result.updated,
    entries: result.entries,
    budgetImpact: {
      totalDelta: newBudget.totalActual - prevBudget.totalActual,
      totalActual: newBudget.totalActual,
      totalBudget: newBudget.totalBudget,
      categoryDeltas,
      overCategories: newBudget.categories.filter(c => c.status === 'over'),
      risks: newRisks.risks,
    },
  });
}
```

**2c. `batch_set_selections` — same enhancement** (`mcp-server.ts:124-146`)

Reuse `result.previousScheme`, same logic.

#### Design Decisions

- **Two `calculate()` calls (previous + new)**: BudgetCalculator is pure computation, no IO; 17 categories × ~50 line items completes in <1ms. Acceptable.
- **Deep copy of previousScheme**: `JSON.parse(JSON.stringify(...))` is safe because `CurrentScheme` is plain JSON-serializable data (no methods, no cycles).
- **`budgetImpact` as new field**: existing consumers ignore it; no breaking change.

#### Impact

- `server/design-state.ts`: `applySelections` return type adds `previousScheme` (~15 lines)
- `server/mcp-server.ts`: 2 tools enhanced (~30 lines)
- `shared/types.ts`: optional `BudgetImpact` interface for type safety
- Check all `applySelections` callers: `mcp-server.ts` (2 tools), `routes.ts` (if any) — update to consume or ignore `previousScheme`
- **0 frontend changes, 0 breaking changes**

#### Verification

- `npm run typecheck` passes
- `npm run test:server` passes (update `set_selection` tests to assert `budgetImpact`)
- Manual MCP call `set_selection` confirms `budgetImpact.totalDelta` and `overCategories` present

---

### Change 3: What-if Simulation Tool

#### Problem

AI cannot simulate selection changes without persisting. To answer "what if I chose X?", AI must: `set_selection(X)` → `get_budget` → `set_selection(original)`. This mutates state, triggers frontend updates, and risks leaving the scheme in an inconsistent state if the revert fails.

#### Solution

**3a. `mcp-server.ts` — new `what_if` tool**

Append after `restore_scheme` (line 378):
```typescript
server.registerTool(
  'what_if',
  {
    title: 'What-if analysis',
    description: 'Simulate selection changes without persisting. Returns full budget snapshot, risks, and diff vs current scheme.',
    inputSchema: z.object({
      changes: z.array(z.object({
        topic: z.string(),
        optionId: z.string().nullable(),
        roomId: z.string().optional(),
      })),
    }),
  },
  async (args) => {
    const current = state.getCurrentScheme();
    const calc = getBudgetCalculator();
    const engine = getRuleEngine();

    // Construct temporary scheme (deep copy, not persisted)
    const tempScheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: JSON.parse(JSON.stringify(current.selections)),
    };
    for (const change of args.changes) {
      const sel = tempScheme.selections[change.topic]
        ?? { default: null as string | null, roomOverrides: {} as Record<string, string> };
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

    const currentRiskIds = new Set(currentRisks.risks.map(r => r.id));
    const simRiskIds = new Set(simRisks.risks.map(r => r.id));

    return text({
      current: {
        totalBudget: currentBudget.totalBudget,
        totalActual: currentBudget.totalActual,
      },
      simulated: {
        totalBudget: simBudget.totalBudget,
        totalActual: simBudget.totalActual,
        budget: simBudget,    // full snapshot for deep analysis
        risks: simRisks,      // full risk evaluation
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
          .filter(d => d.delta !== 0),
        risksAdded: simRisks.risks.filter(r => !currentRiskIds.has(r.id)),
        risksRemoved: currentRisks.risks.filter(r => !simRiskIds.has(r.id)),
      },
    });
  }
);
```

**3b. Fix `compare_schemes` priceDelta bug** (`mcp-server.ts:306`)

Current code computes unit-price difference, which is misleading:
```typescript
// Current (buggy):
priceDelta: (cmpOpt?.price_per_unit ?? 0) - (curOpt?.price_per_unit ?? 0),
```

Remove the `priceDelta` field. AI can infer cost impact from `diff.budget` (total actual difference) and the full budget snapshots already returned in `current.budget` and `compare.budget`:
```typescript
selectionDiffs.push({
  topic,
  current: curOpt?.name ?? curOptId,
  compare: cmpOpt?.name ?? cmpOptId,
  // priceDelta removed: unit-price difference does not reflect total cost
  // AI should use diff.budget and full budget snapshots for cost analysis
});
```

#### Design Decisions

- **Full snapshot in `simulated`**: user confirmed this choice. Token cost is acceptable because AI needs line-item detail for attribution analysis. If token cost becomes an issue, add a `detailed: boolean` parameter later.
- **Deep copy of `current.selections`**: safe because `CurrentScheme.selections` is JSON-serializable.
- **Two `calculate()` + two `evaluate()` calls**: <5ms total. Acceptable.
- **`priceDelta` removal from `compare_schemes`**: this is a bug fix. The field was misleading. AI can compute cost impact from the full budget snapshots. The `selectionDiffs` array still shows which topics changed (by name), which is the useful signal.

#### Impact

- `server/mcp-server.ts`: 1 new tool + 1 bug fix (~65 lines)
- **0 frontend changes, 0 breaking changes** (`what_if` is new; `priceDelta` removal is backward-compatible)

#### Verification

- `npm run typecheck` passes
- Manual MCP call `what_if` with sample changes; confirm `simulated.budget`, `simulated.risks`, `delta.totalDelta`, `delta.risksAdded` are correct
- Manual MCP call `compare_schemes`; confirm `priceDelta` is absent and `diff.budget` is present

---

### Change 4: Pitfall Knowledge Base

#### Problem

`design-rules.yaml` has only 6 product-level risks. AI lacks renovation experience to ground its advice. The user specifically requested coverage of:
1. Budget traps (overrun-prone categories, hidden costs, scope creep)
2. Construction shortcuts (where contractors cut corners, common quality issues)
3. Acceptance checkpoints (verification standards, detection methods, tools)

#### Solution

**4a. `config/budget-pitfalls.yaml` (new file, ~200 lines)**

Three knowledge types, unified structure:

```yaml
version: "1.0"

pitfalls:
  # === Budget Traps (type: budget) ===
  - id: waterproof_overshoot
    type: budget
    stage: waterproof
    category: waterproof
    trigger: always
    severity: high
    title: "防水常超 30%"
    description: "拆改后需修补防水层;老房水管老化易漏水,实际防水面积常比设计图大"
    mitigation: "预算上浮 30%;拆改前做闭水试验;确认防水范围含墙面 1.8m"

  - id: open_kitchen_hood
    type: budget
    stage: installation
    category: range_hood
    trigger: "selection.kitchen == 'open'"
    severity: high
    title: "开放厨房油烟机别省"
    description: "开放式厨房必须 ≥22m³/min 侧吸,否则全屋串味,窗帘家具沾油"
    mitigation: "选 22m³/min 以上;预算 2500+;侧吸比顶吸好"

  - id: curtain_hardcoded
    type: budget
    stage: installation
    category: curtains
    trigger: always
    severity: medium
    title: "玻璃幕窗帘是刚需"
    description: "全屋玻璃幕墙,窗帘不可省;纱帘+遮光帘;厨卫用防水卷帘/百叶"
    mitigation: "预算 4000+;主卧/客厅/书房预留电动窗帘电源"

  - id: smart_zero_line
    type: budget
    stage: water_electric
    category: smart_home
    trigger: always
    severity: medium
    title: "智能零线预留成本"
    description: "智能开关需零线,后期改造成本 10 倍(需拆墙走线)"
    mitigation: "水电阶段全屋预留零线;预算 2000;不上调光/自动化"

  - id: contingency_reserve
    type: budget
    stage: planning
    category: contingency
    trigger: always
    severity: high
    title: "不可预见费留 10%"
    description: "老房拆改常发现隐藏问题(承重墙位置/管道老化/梁位);10% 不可预见费是底线"
    mitigation: "totalBudget * 10% 作为 contingency;拆改前做全面检查"

  - id: demolition_unknown
    type: budget
    stage: demolition
    category: demolition
    trigger: always
    severity: medium
    title: "拆改范围不确定"
    description: "设计图标注的非承重墙需物业/设计院确认;承重墙绝对不能拆"
    mitigation: "拆改前获取竣工图;物业审批;预留拆改后的修补费用"

  - id: hvac_platform
    type: budget
    stage: installation
    category: hvac
    trigger: always
    severity: high
    title: "中央空调外机散热"
    description: "西设备平台仅 2.48㎡,外机叠放散热差、噪音大、维修难"
    mitigation: "优先多联机;外机不叠放;预留检修空间;确认平台承重"

  - id: tile_waste_rate
    type: budget
    stage: masonry
    category: masonry
    trigger: always
    severity: medium
    title: "瓷砖损耗率 5-8%"
    description: "异形房间(弧角/飘窗)瓷砖切割损耗大;大砖(800x800)比小砖损耗高"
    mitigation: "预算含 5-8% 损耗;弧角区域用小砖;连纹大砖损耗更高"

  - id: floor_vs_furniture_tradeoff
    type: budget
    stage: planning
    category: tradeoff
    trigger: manual
    severity: low
    title: "地板 vs 家具升级优先级"
    description: "地板每天踩,铺了难换(需砸砖);家具可后期逐步升级;硬装优先于软装"
    mitigation: "优先升级地板和硬装;家具先用基础款;沙发/床垫可后期换"

  # === Construction Shortcuts (type: construction) ===
  - id: waterproof_shortcut
    type: construction
    stage: waterproof
    category: waterproof
    trigger: always
    severity: high
    title: "防水偷工减料重灾区"
    description: "涂刷遍数不够(应 2-3 遍)、墙面高度不够(淋浴区应 1.8m)、防水层破损未修补、管根/阴角未做圆弧处理"
    mitigation: "要求施工队:遍数≥2遍;淋浴区墙面≥1.8m;管根/阴角做圆弧+网格布;涂刷后做保护层"

  - id: electric_shortcut
    type: construction
    stage: water_electric
    category: water_electric
    trigger: always
    severity: high
    title: "水电偷工减料重灾区"
    description: "线管质量差(应阻燃PVC)、单管穿线过多(不超过管径40%)、零线未预留(智能开关需要)、线管接头未用胶水、强弱电未分管"
    mitigation: "要求:阻燃PVC线管;单管穿线≤40%;全屋预留零线;强弱电分管间距≥30cm"

  - id: masonry_shortcut
    type: construction
    stage: masonry
    category: masonry
    trigger: always
    severity: high
    title: "泥瓦偷工减料重灾区"
    description: "找平层太薄(应≥2cm)、瓷砖背胶未刷/刷不够、留缝太小(应1.5-2mm)、空鼓(>15%不合格)、地漏处坡度不够"
    mitigation: "要求:找平≥2cm;大砖刷背胶;留缝1.5-2mm;铺贴后24h检查空鼓;卫生间坡度≥1%"

  - id: painting_shortcut
    type: construction
    stage: painting
    category: painting
    trigger: always
    severity: medium
    title: "油漆偷工减料重灾区"
    description: "腻子遍数不够(应2-3遍)、底漆不刷或兑水太多、阴阳角不直、接缝处不开裂处理"
    mitigation: "要求:腻子≥2遍;底漆必刷;阴阳角用PVC角条;接缝处贴网格布"

  - id: carpentry_shortcut
    type: construction
    stage: carpentry
    category: carpentry
    trigger: always
    severity: medium
    title: "木工偷工减料重灾区"
    description: "吊顶龙骨间距过大(应≤400mm)、石膏板拼接处未留缝、柜体背板太薄(应≥9mm)、五金件以次充好"
    mitigation: "要求:龙骨间距≤400mm;石膏板留V型缝;背板≥9mm;五金用品牌(海蒂诗/百隆)"

  - id: door_window_shortcut
    type: construction
    stage: installation
    category: doors_windows
    trigger: always
    severity: medium
    title: "门窗安装偷工减料重灾区"
    description: "门框灌浆不实、合页螺丝少打、密封胶打得不均匀、门吸位置不合理"
    mitigation: "要求:门框灌浆密实;合页螺丝全打;密封胶均匀无断点;门吸避开踢脚线"

  - id: cabinet_install_shortcut
    type: construction
    stage: installation
    category: kitchen_cabinet
    trigger: always
    severity: medium
    title: "橱柜安装偷工减料重灾区"
    description: "柜体不水平、台面拼接缝明显、五金件未调阻尼、下水管未做存水弯"
    mitigation: "要求:水平仪校正;台面拼接打磨;五金调阻尼;下水管做存水弯防臭"

  - id: sanitary_install_shortcut
    type: construction
    stage: installation
    category: sanitary
    trigger: always
    severity: medium
    title: "卫浴安装偷工减料重灾区"
    description: "马桶法兰圈未装/装歪、地漏未做存水弯、花洒混水阀高度不对、浴室柜未固定"
    mitigation: "要求:法兰圈正确安装;地漏存水弯;混水阀高度110cm;浴室柜膨胀螺丝固定"

  # === Acceptance Checkpoints (type: acceptance) ===
  - id: waterproof_acceptance
    type: acceptance
    stage: waterproof
    category: waterproof
    trigger: always
    severity: high
    title: "防水验收要点"
    description: "闭水试验:蓄水深度≥2cm,持续24-48小时,楼下无渗漏;墙面防水高度:淋浴区≥1.8m,其他≥0.3m"
    mitigation: "工具:闭水试验;检查墙面高度;目测防水层无破损"
    checklist:
      - "闭水试验 24-48h 无渗漏"
      - "淋浴区墙面防水 ≥1.8m"
      - "管根/阴角做圆弧处理"
      - "防水层无破损/气泡"

  - id: electric_acceptance
    type: acceptance
    stage: water_electric
    category: water_electric
    trigger: always
    severity: high
    title: "水电验收要点"
    description: "水管打压:0.8MPa 保压30分钟无压降;电线绝缘测试;线管材质确认;穿线数量检查"
    mitigation: "工具:打压泵、绝缘摇表;检查线管阻燃标识;数穿线数量"
    checklist:
      - "水管打压 0.8MPa 30min 无压降"
      - "电线绝缘测试合格"
      - "线管阻燃PVC(看标识)"
      - "单管穿线 ≤40%管径"
      - "强弱电分管间距 ≥30cm"
      - "全屋零线预留"

  - id: masonry_acceptance
    type: acceptance
    stage: masonry
    category: masonry
    trigger: always
    severity: medium
    title: "泥瓦验收要点"
    description: "空鼓率<5%(空鼓锤)、平整度2m靠尺±2mm、阴阳角方正、卫生间坡度泼水试验、留缝均匀"
    mitigation: "工具:空鼓锤、2m靠尺、塞尺、水平仪"
    checklist:
      - "空鼓率 <5%(空鼓锤全敲)"
      - "平整度 2m靠尺 ±2mm"
      - "阴阳角方正(用角尺)"
      - "卫生间泼水试验无积水"
      - "留缝均匀 1.5-2mm"
      - "地漏处坡度正确"

  - id: painting_acceptance
    type: acceptance
    stage: painting
    category: painting
    trigger: always
    severity: low
    title: "油漆验收要点"
    description: "墙面无明显色差、无流坠、无砂眼、阴阳角顺直、收边整齐"
    mitigation: "工具:手电筒侧照、目测"
    checklist:
      - "无色差(自然光下)"
      - "无流坠/砂眼"
      - "阴阳角顺直"
      - "收边整齐"

  - id: carpentry_acceptance
    type: acceptance
    stage: carpentry
    category: carpentry
    trigger: always
    severity: medium
    title: "木工验收要点"
    description: "吊顶无开裂、柜门开关顺畅、缝隙均匀(≤2mm)、五金件功能正常"
    mitigation: "工具:目测、手感、开关门测试"
    checklist:
      - "吊顶无开裂(拼接缝处)"
      - "柜门开关顺畅无异响"
      - "柜门缝隙均匀 ≤2mm"
      - "五金件(铰链/滑轨)功能正常"

  - id: installation_acceptance
    type: acceptance
    stage: installation
    category: doors_windows
    trigger: always
    severity: medium
    title: "安装验收要点"
    description: "门开关无异响、密封胶均匀、洁具无划痕、下水通畅"
    mitigation: "工具:目测、手感、冲水测试"
    checklist:
      - "门开关无异响"
      - "密封胶均匀无断点"
      - "洁具无划痕/瑕疵"
      - "下水通畅(冲水/倒水测试)"

templates:
  - id: pragmatic
    name: "务实档(11 万)"
    total: 110000
    description: "保证基础质量,非豪华装修;套内 94.76㎡、层高 3.0m"
    allocation:
      demolition: 5000
      water_electric: 8500
      waterproof: 3500
      masonry: 18500
      carpentry: 5000
      painting: 11500
      doors_windows: 10500
      sanitary: 10000
      kitchen_cabinet: 6500
      range_hood: 2500
      hvac: 0
      lighting: 2800
      curtains: 4000
      smart_home: 2000
      miscellaneous: 5700
      property_fees: 3000
      contingency: 11000

  - id: balanced
    name: "均衡档(15 万)"
    total: 150000
    description: "品质硬装 + 基础家电 + 中端家具"
    allocation:
      demolition: 5000
      water_electric: 12000
      waterproof: 4500
      masonry: 25000
      carpentry: 8000
      painting: 15000
      doors_windows: 14000
      sanitary: 15000
      kitchen_cabinet: 10000
      range_hood: 3500
      hvac: 0
      lighting: 5000
      curtains: 6000
      smart_home: 4000
      miscellaneous: 7600
      property_fees: 3000
      contingency: 15000

  - id: quality
    name: "品质档(20 万)"
    total: 200000
    description: "品牌硬装 + 中高端家电 + 定制家具"
    allocation:
      demolition: 5000
      water_electric: 15000
      waterproof: 5000
      masonry: 32000
      carpentry: 12000
      painting: 18000
      doors_windows: 20000
      sanitary: 22000
      kitchen_cabinet: 15000
      range_hood: 5000
      hvac: 0
      lighting: 8000
      curtains: 8000
      smart_home: 8000
      miscellaneous: 10000
      property_fees: 3000
      contingency: 20000
```

**4b. `server/pitfall-engine.ts` (new file, ~60 lines)**

```typescript
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

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

interface PitfallConfig {
  version: string;
  pitfalls: Pitfall[];
  templates: BudgetTemplate[];
}

export class PitfallEngine {
  private config: PitfallConfig;

  constructor(configPath = 'config/budget-pitfalls.yaml') {
    const raw = readFileSync(configPath, 'utf8');
    this.config = load(raw) as PitfallConfig;
  }

  getPitfalls(opts?: { category?: string; type?: string; stage?: string }): Pitfall[] {
    return this.config.pitfalls.filter(p =>
      (!opts?.category || p.category === opts.category) &&
      (!opts?.type || p.type === opts.type) &&
      (!opts?.stage || p.stage === opts.stage)
    );
  }

  getTemplate(tier?: string, targetBudget?: number): BudgetTemplate | undefined {
    if (tier) {
      const found = this.config.templates.find(t => t.id === tier);
      if (found) return found;
    }
    if (targetBudget) {
      return this.config.templates
        .filter(t => t.total <= targetBudget)
        .sort((a, b) => b.total - a.total)[0];
    }
    return this.config.templates[0];
  }

  listTemplates(): BudgetTemplate[] {
    return this.config.templates;
  }
}
```

**4c. `mcp-server.ts` — 2 new tools + McpDeps extension**

Add `pitfallEngine: PitfallEngine` to `McpDeps` interface.

Register `get_pitfalls`:
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
  async (args) => text(pitfallEngine.getPitfalls(args))
);
```

Register `recommend_allocation`:
```typescript
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
    const template = pitfallEngine.getTemplate(args.tier, args.totalBudget);
    if (!template) return text({ error: 'no matching template' });
    return text(template);
  }
);
```

**4d. `server/index.ts` — load + hot-reload integration**

Load `PitfallEngine` at startup, add to chokidar watch list (alongside `design-rules.yaml`, `materials.yaml`, `base.json`), pass to `McpDeps`.

#### Design Decisions

- **Static YAML, not AI-generated**: user confirmed. The knowledge base is author-maintained, AI queries but does not modify. Content accuracy is the user's responsibility; chokidar hot-reload allows quick iteration.
- **`trigger` field is informational, not executed**: the `trigger` field has three values:
  - `always` — the pitfall applies unconditionally (most pitfalls)
  - `manual` — the pitfall is a tradeoff heuristic, not an automatic risk (e.g., "floor vs furniture priority"); AI should surface it when the user asks about tradeoffs
  - A rule-expression string like `"selection.kitchen == 'open'"` — intended for future trigger evaluation, but `PitfallEngine` currently does **not** parse these; all pitfalls are returned regardless of trigger value, and AI filters contextually based on the current scheme. This avoids entangling `PitfallEngine` with `RuleEngine`'s DSL. Future iteration may add trigger evaluation if needed.
- **`checklist` optional field**: only `acceptance` type pitfalls have checklists. `budget` and `construction` types use `description` + `mitigation`.
- **Three templates (pragmatic/balanced/quality)**: covers the 11万/15万/20万 tiers. `hvac: 0` in all templates because HVAC is calculated from option selection, not allocation.
- **Content needs user review**: the pitfall content is based on general renovation knowledge, not project-specific research. The user should cross-verify against `docs/material_selection_log.md` (499 lines) and `docs/decision_log.md` after implementation.

#### Impact

- New `config/budget-pitfalls.yaml` (~200 lines)
- New `server/pitfall-engine.ts` (~60 lines)
- `server/mcp-server.ts`: McpDeps extension + 2 tools (~45 lines)
- `server/index.ts`: load + hot-reload (~10 lines)
- `shared/types.ts`: optional, re-export `Pitfall`/`BudgetTemplate` from pitfall-engine for type safety
- **0 frontend changes, 0 breaking changes**

#### Verification

- `npm run typecheck` passes
- `npm run test:server` passes
- Manual MCP call `get_pitfalls({ category: "waterproof" })` returns all three types (budget + construction + acceptance)
- Manual MCP call `get_pitfalls({ type: "acceptance" })` returns all acceptance pitfalls with checklists
- Manual MCP call `recommend_allocation({ tier: "pragmatic" })` returns the 11万 template
- Modify `config/budget-pitfalls.yaml`, confirm chokidar hot-reloads without restart

---

## Execution Order

| Step | Change | Depends On | Verification |
|---|---|---|---|
| 1 | Change 1: Overrun detection + attribution | None | typecheck + test:server |
| 2 | Change 2: Fast feedback on selection | Change 1 (uses `status`) | typecheck + test:server |
| 3 | Change 3: What-if simulation tool | Change 1 (uses `attribution`) | typecheck + manual MCP |
| 4 | Change 4: Pitfall knowledge base | None (independent) | typecheck + manual MCP |

Changes 1 and 4 can be done in parallel. Changes 2 and 3 depend on Change 1.

After each step, also run:
```bash
npx tsx scripts/verify-topology.ts
npx tsx scripts/verify-layout.ts
```
(These verify geometry, but ensure no collateral damage from the changes.)

## Total Impact

| Metric | Value |
|---|---|
| New code (server) | ~550 lines |
| New config files | 1 (`config/budget-pitfalls.yaml`) |
| New server files | 1 (`server/pitfall-engine.ts`) |
| Modified files | 4 (`shared/types.ts`, `budget-calculator.ts`, `design-state.ts`, `mcp-server.ts`) + `server/index.ts` |
| New MCP tools | 3 (`what_if`, `get_pitfalls`, `recommend_allocation`) |
| Enhanced MCP tools | 2 (`set_selection`, `batch_set_selections`) |
| Frontend changes | 0 |
| Breaking changes | 0 |
| New npm dependencies | 0 |

## Known Limitations

1. **Pitfall content is general, not project-specific**: The yaml content is based on general renovation knowledge. It should be cross-verified against `docs/material_selection_log.md` and `docs/decision_log.md` after implementation. This is content review work, not code work.

2. **AI analysis quality depends on model capability**: The 4 changes provide data and knowledge, but AI must reason over them to produce useful advice. If AI analysis proves insufficient in practice, a future `analyze_budget` tool can pre-compute analysis reports to reduce AI reasoning burden. This is deferred until empirically needed.

3. **No real-time price data**: `materials.yaml` prices are research snapshots. AI cannot know current Nanning market prices. This is a data limitation, not an architectural one.

4. **No material archive enhancement**: `materials.yaml` lacks `image_url`, `product_url`, and procurement status fields. AI cannot show product images or track procurement. This is explicitly out of scope for this spec; it is future work.

5. **No proactive push**: AI does not automatically analyze after every selection change; the user or AI must initiate analysis. The `budgetImpact` field in `set_selection` provides passive feedback, but there is no server-side trigger that proactively runs `what_if` or `get_pitfalls`. Future work could add an SSE-based notification system if needed.

6. **Pitfall triggers are informational**: The `trigger` field (e.g., `selection.kitchen == 'open'`) is not evaluated by `PitfallEngine`. All pitfalls are returned regardless of trigger; AI must filter contextually. This is intentional to avoid coupling `PitfallEngine` to `RuleEngine`'s DSL.

7. **`what_if` does not validate option existence**: The tool constructs a temporary scheme by deep-copying and overriding selections. If `optionId` does not exist in the catalog, `BudgetCalculator.calculate()` will skip that line item (returns 0 cost). This is safe but may produce misleading results. A future iteration could add validation.
