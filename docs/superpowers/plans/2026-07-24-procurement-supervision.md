# Phase 4: 采购监理系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a config-driven procurement supervision system that tracks material lifecycle stages, generates tradeoff comparisons, provides acceptance checklists, and detects pitfalls — all through MCP tools.

**Architecture:** A `LifecycleEngine` manages per-material state. A `TradeoffEngine` reads `config/tradeoffs.yaml` and presents options with cost/risk/time data. An `AcceptanceEngine` reads `config/acceptance.yaml` and generates phase-appropriate checklists. New MCP tools expose all three.

**Tech Stack:** TypeScript, Node built-in test runner, js-yaml, Express, MCP SDK.

**Spec:** `docs/superpowers/specs/2026-07-23-procurement-supervision-design.md`

## Global Constraints

- Config-driven: lifecycle transitions are user-triggered, not auto-advanced
- Room display names from `model-geometry.yaml` `rooms[].name`
- Zero lock-in to procurement mode (清包/半包 = config toggle, not code change)
- After each task: `npm run typecheck && npm run test:server`
- All tradeoff output is comparative (AI suggests, user decides)

---

### Task 1: Material lifecycle config + engine

**Files:**
- Create: `config/procurement.yaml`
- Create: `server/lifecycle-engine.ts`
- Modify: `server/config-loader.ts` (add loader)
- Test: `tests/server/lifecycle-engine.test.ts`

**Interfaces:**
- Consumes: `materials.yaml` (existing material catalog), `model-geometry.yaml` (room areas)
- Produces: `LifecycleEngine.getStatus(materialId)`, `LifecycleEngine.setStage(materialId, stage)`, `LifecycleEngine.getQuantity(materialId)`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('LifecycleEngine', () => {
  it('defaults all materials to selection stage', () => {
    const engine = new LifecycleEngine();
    const status = engine.getStatus('floor_tile_01');
    assert.equal(status.stage, 'selection');
  });

  it('advances to next stage on setStage', () => {
    const engine = new LifecycleEngine();
    engine.setStage('floor_tile_01', 'quantity');
    assert.equal(engine.getStatus('floor_tile_01').stage, 'quantity');
  });

  it('calculates quantity from room area', () => {
    const engine = new LifecycleEngine();
    const qty = engine.calculateQuantity('floor_tile_01');
    assert.ok(qty.area > 0);
    assert.ok(qty.total > qty.area); // includes waste
  });

  it('supports stage transitions back to previous', () => {
    const engine = new LifecycleEngine();
    engine.setStage('floor_tile_01', 'purchased');
    engine.setStage('floor_tile_01', 'selection'); // Rollback
    assert.equal(engine.getStatus('floor_tile_01').stage, 'selection');
  });
});
```

- [ ] **Step 2: Create `config/procurement.yaml`**

```yaml
materials:
  - id: floor_tile_01
    name: "客厅地砖"
    room: living_dining
    category: floor
    current_stage: selection
    waste_rate: 1.05
    unit: sqm
    notes: []

  - id: wall_tile_01
    name: "主卫墙砖"
    room: master_bath
    category: wall_tile
    current_stage: selection
    waste_rate: 1.08
    unit: sqm
    notes: []

  - id: paint_01
    name: "全屋墙面漆"
    room: null  # null = whole house
    category: paint
    current_stage: selection
    waste_rate: 1.1
    unit: L
    notes: []
```

- [ ] **Step 3: Implement `LifecycleEngine`**

```typescript
export type LifecycleStage = 'selection' | 'quantity' | 'purchased' | 'delivered' | 'installed' | 'accepted' | 'maintenance' | 'returned';

export interface MaterialStatus {
  id: string;
  stage: LifecycleStage;
  quantity?: { area: number; wasteRate: number; total: number; unit: string };
  notes: string[];
}

export class LifecycleEngine {
  private materials: Map<string, MaterialStatus> = new Map();

  load(configPath: string = 'config/procurement.yaml'): void {
    const data = loadConfig<ProcurementConfig>(configPath);
    data.materials.forEach(m => {
      this.materials.set(m.id, {
        id: m.id,
        stage: m.current_stage,
        notes: [],
      });
    });
  }

  getStatus(materialId: string): MaterialStatus {
    const s = this.materials.get(materialId);
    if (!s) throw new Error(`Unknown material: ${materialId}`);
    return s;
  }

  setStage(materialId: string, stage: LifecycleStage): void {
    const s = this.materials.get(materialId);
    if (!s) throw new Error(`Unknown material: ${materialId}`);
    s.stage = stage;
  }

  calculateQuantity(materialId: string): { area: number; wasteRate: number; total: number; unit: string } {
    const s = this.materials.get(materialId);
    if (!s) throw new Error(`Unknown material: ${materialId}`);
    const entry = this.getConfigEntry(materialId);
    // Read room area from model-geometry via ProjectCatalog
    const catalog = new ProjectCatalog('.');
    const room = catalog.rooms.find(r => r.id === entry.room);
    const area = room ? room.width * room.depth : 0;
    return {
      area,
      wasteRate: entry.waste_rate,
      total: area * entry.waste_rate,
      unit: entry.unit,
    };
  }

  private getConfigEntry(materialId: string): ProcurementMaterial {
    // Load from procurement.yaml
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx tsx --test tests/server/lifecycle-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck + test:server**

Run: `npm run typecheck && npm run test:server`

- [ ] **Step 6: Commit**

```bash
git add config/procurement.yaml server/lifecycle-engine.ts tests/server/lifecycle-engine.test.ts
git commit -m "feat: LifecycleEngine — material lifecycle state machine + quantity calculation"
```

---

### Task 2: Tradeoff engine

**Files:**
- Create: `config/tradeoffs.yaml`
- Create: `server/tradeoff-engine.ts`
- Test: `tests/server/tradeoff-engine.test.ts`

**Interfaces:**
- Consumes: `LifecycleEngine` status, materials config
- Produces: `TradeoffEngine.getTradeoffs(topic) → Tradeoff[]`, `TradeoffEngine.getAffectedTradeoffs(materialId) → Tradeoff[]`

- [ ] **Step 1: Write failing tests**

```typescript
it('returns tradeoffs for a known topic', () => {
  const engine = new TradeoffEngine();
  const tradeoffs = engine.getTradeoffs('tile_installation');
  assert.ok(tradeoffs.length >= 2);
  assert.ok(tradeoffs[0].options.length >= 2);
  assert.ok(tradeoffs[0].options[0].cost > 0);
});

it('returns empty for unknown topic', () => {
  const engine = new TradeoffEngine();
  const tradeoffs = engine.getTradeoffs('nonexistent_topic');
  assert.equal(tradeoffs.length, 0);
});
```

- [ ] **Step 2: Create `config/tradeoffs.yaml`**

```yaml
tradeoffs:
  - topic: tile_installation
    label: "瓷砖铺贴"
    options:
      - label: "装修公司包工"
        cost: 4500
        risk: "medium"
        time_days: 3
        acceptance_items: ["空鼓率<5%", "缝隙2mm", "平整度2m靠尺<2mm"]
      - label: "自己找师傅"
        cost: 3000
        risk: "high"
        time_days: 4
        tips: "小区群里问邻居用过的师傅"
        acceptance_items: ["同上"]

  - topic: paint_brand
    label: "乳胶漆品牌"
    options:
      - label: "多乐士"
        cost: 1800
        risk: "low"
        note: "市场占有率最高，配色最准"
      - label: "立邦"
        cost: 1600
        risk: "low"
        note: "价格略低，颜色可选范围小"
      - label: "三棵树"
        cost: 1200
        risk: "medium"
        note: "最便宜，但调色偏差较大"
```

- [ ] **Step 3: Implement `TradeoffEngine`**

```typescript
export interface TradeoffOption {
  label: string;
  cost: number;
  risk: 'low' | 'medium' | 'high';
  time_days?: number;
  acceptance_items?: string[];
  tips?: string;
  note?: string;
}

export interface Tradeoff {
  topic: string;
  label: string;
  options: TradeoffOption[];
}

export class TradeoffEngine {
  private tradeoffs: Tradeoff[] = [];

  load(path: string = 'config/tradeoffs.yaml'): void {
    this.tradeoffs = loadConfig<{ tradeoffs: Tradeoff[] }>(path).tradeoffs;
  }

  getTradeoffs(topic: string): Tradeoff[] {
    return this.tradeoffs.filter(t => t.topic === topic);
  }

  getAffectedTradeoffs(materialId: string): Tradeoff[] {
    // Map material category to tradeoff topics
    // e.g., floor_tile → tile_installation
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx tsx --test tests/server/tradeoff-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add config/tradeoffs.yaml server/tradeoff-engine.ts tests/server/tradeoff-engine.test.ts
git commit -m "feat: TradeoffEngine — config-driven tradeoff comparison"
```

---

### Task 3: Acceptance knowledge base

**Files:**
- Create: `config/acceptance.yaml`
- Create: `server/acceptance-engine.ts`
- Test: `tests/server/acceptance-engine.test.ts`

**Interfaces:**
- Consumes: `LifecycleEngine` stage
- Produces: `AcceptanceEngine.getChecklist(phase) → AcceptanceItem[]`

- [ ] **Step 1: Write failing tests**

```typescript
it('returns checklist for tile installation phase', () => {
  const engine = new AcceptanceEngine();
  const items = engine.getChecklist('tile_installation');
  assert.ok(items.length > 0);
  assert.ok(items[0].item);
  assert.ok(items[0].method);
  assert.ok(items[0].standard);
});

it('returns empty for unknown phase', () => {
  const engine = new AcceptanceEngine();
  const items = engine.getChecklist('unknown_phase');
  assert.equal(items.length, 0);
});
```

- [ ] **Step 2: Create `config/acceptance.yaml`**

```yaml
phases:
  - phase: demolition
    name: "拆改验收"
    items:
      - id: check_demo_wall
        item: "拆除范围核对"
        method: |
          对照拆墙图用卷尺量，重点检查承重墙是否误拆
        standard: "与图纸一致，误差 < 5cm"
        severity: critical
        knowledge: "承重墙：图纸粗实线、敲击声沉闷、厚度 > 20cm"

      - id: check_demo_structure
        item: "梁柱状况检查"
        method: "裸露梁柱是否有裂缝、钢筋是否锈蚀"
        standard: "无结构性裂缝，钢筋无锈蚀"
        severity: critical

  - phase: waterproofing
    name: "防水+闭水"
    items:
      - id: check_wp_coats
        item: "涂刷遍数检查"
        method: "墙面刷到1.8m，地面满刷。干透再刷下一遍，至少2遍"
        standard: "均匀无漏刷"
        severity: critical

      - id: check_wp_flood
        item: "闭水试验"
        method: "堵地漏→放水3~5cm→标记水位→等48h→去楼下看天花板"
        standard: "水位无下降，楼下无渗水"
        severity: critical
        knowledge: "闭水前通知楼下邻居。失败则补刷后重做48h"

  - phase: tile_installation
    items:
      - item: "空鼓检查"
        method: "用空鼓锤轻敲每块砖的四角+中心"
        standard: "单片空鼓率 < 15%，整面墙 < 5%"
        severity: critical
      - item: "缝隙均匀"
        method: "用塞尺测量相邻砖缝"
        standard: "2mm ± 0.5mm"
        severity: major
      - item: "平整度"
        method: "2m靠尺贴墙面，测量最大空隙"
        standard: "< 2mm"
        severity: major
      - item: "坡度检查"
        method: "倒水测试是否流向地漏"
        standard: "不积水"
        severity: critical
        rooms: [master_bath, guest_bath, balcony]

  - phase: painting
    name: "油漆验收"
    items:
      - item: "漆膜质量"
        method: "手机手电筒贴墙斜照，看刷痕/流挂/起泡/色差"
        standard: "侧光45°无明显瑕疵"
        severity: major
      - item: "环境记录"
        method: "刷漆时记录温湿度"
        standard: "温度 ≥ 5°C，湿度 ≤ 85%"
        severity: warning
        knowledge: "南宁回南天绝对不能刷漆"

  - phase: hvac_installation
    name: "中央空调验收"
    items:
      - item: "铜管焊接质量"
        method: "检查焊接处有无氧化、砂眼"
        standard: "充氮焊接，无氧化皮"
        severity: critical
      - item: "抽真空时间"
        method: "看真空泵运行记录"
        standard: "≥ 15min，保持 -756mmHg"
        severity: critical
      - item: "冷凝水排水"
        method: "内机注水测试"
        standard: "排水通畅无积水"
        severity: critical
      - item: "内机水平度"
        method: "水平尺测量四角"
        standard: "误差 < 2mm"
        severity: major
      - item: "风口尺寸"
        method: "测量风口开孔 vs 内机接口"
        standard: "对齐无缝隙"
        severity: major
      - item: "制冷测试"
        method: "开机 30min 测出风口温度"
        standard: "出风口 6-12°C（与环境温差）"
        severity: critical
      - item: "外机散热"
        method: "测量外机位通风尺寸"
        standard: "百叶通风面积 ≥ 80%"
        severity: major

  - phase: electrical_check
    items:
      - item: "通断测试"
        method: "用测电笔逐个插座测试"
        standard: "全部通电，零火线正确"
        severity: critical
      - item: "开关功能"
        method: "逐个开关测试"
        standard: "双控/单控功能正常"
        severity: major

  - phase: occupancy
    name: "入住前检测"
    items:
      - item: "甲醛检测"
        method: "找CMA机构，封闭12h后测，每个房间中央离地1m"
        standard: "甲醛 < 0.08mg/m³ (GB/T 18883)"
        severity: critical
        knowledge: "有小孩建议 < 0.05mg/m³; 夏季通风1~2月"
```

- [ ] **Step 3: Implement `AcceptanceEngine`**

```typescript
export interface AcceptanceItem {
  item: string;
  method: string;
  standard: string;
  severity: 'critical' | 'major' | 'minor' | 'warning';
  rooms?: string[];
  knowledge?: string;     // 背景知识/实操技巧
  picture_url?: string;   // 参考图片
  source?: string;        // 来源（国标/经验）
}

export interface AcceptanceChecklist {
  phase: string;
  items: AcceptanceItem[];
}

export class AcceptanceEngine {
  private checklists: Map<string, AcceptanceItem[]> = new Map();

  load(path: string = 'config/acceptance.yaml'): void {
    const data = loadConfig<{ checklists: AcceptanceChecklist[] }>(path);
    data.checklists.forEach(c => this.checklists.set(c.phase, c.items));
  }

  getChecklist(phase: string): AcceptanceItem[] {
    return this.checklists.get(phase) ?? [];
  }

  getChecklistForRoom(phase: string, roomId: string): AcceptanceItem[] {
    const items = this.getChecklist(phase);
    return items.filter(i => !i.rooms || i.rooms.includes(roomId));
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx tsx --test tests/server/acceptance-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add config/acceptance.yaml server/acceptance-engine.ts tests/server/acceptance-engine.test.ts
git commit -m "feat: AcceptanceEngine — config-driven acceptance checklists"
```

---

### Task 4: Appliance installation pitfalls

**Files:**
- Modify: `config/budget-pitfalls.yaml` (add appliance pitfalls)
- Test: `tests/server/pitfall-engine.test.ts` (verify new pitfalls load)

**Interfaces:**
- Consumes: existing `PitfallEngine`
- Produces: new appliance pitfalls accessible via MCP `get_pitfalls`

- [ ] **Step 1: Write failing tests**

```typescript
it('returns pitfalls for central AC installation', () => {
  const engine = new PitfallEngine();
  const pitfalls = engine.getPitfalls({ category: 'appliance_hvac' });
  assert.ok(pitfalls.length >= 5);
  assert.ok(pitfalls.some(p => p.item.includes('抽真空')));
});

it('returns pitfalls for appliance by name', () => {
  const engine = new PitfallEngine();
  const pitfalls = engine.getPitfalls({ appliance: 'gas_water_heater' });
  assert.ok(pitfalls.length > 0);
});
```

- [ ] **Step 2: Append appliance pitfalls to `config/budget-pitfalls.yaml`**

```yaml
- category: appliance_hvac
  name: "中央空调安装"
  pitfalls:
    - item: "铜管焊接未充氮保护"
      risk: "铜管氧化堵塞系统，压缩机损坏"
      prevention: "要求充氮焊接，写在合同里"
      severity: critical
    - item: "抽真空不足15分钟"
      risk: "系统含水，制冷差、压缩机磨损"
      prevention: "验收时看真空泵运行时间"
    - item: "冷凝水管未做坡度"
      risk: "漏水泡吊顶"
      prevention: "吊顶前确认1%坡度"
    - item: "风口尺寸与吊顶开口不对"
      risk: "装不进去或漏缝"
      prevention: "木工进场前给风口尺寸图"
    - item: "外机散热空间不足"
      risk: "过热停机、费电"
      prevention: "百叶通风面积 ≥ 80%"

- category: appliance_water_heater
  name: "燃气热水器安装"
  pitfalls:
    - item: "排烟管用铝箔管(应用不锈钢)"
      risk: "高温烧穿，CO泄漏"
      prevention: "指定不锈钢排烟管"
    - item: "排烟管未伸出室外"
      risk: "CO中毒"
      prevention: "排烟口伸出外墙 ≥ 30cm"
    - item: "未预埋回水管"
      risk: "零冷水装不了"
      prevention: "水电阶段预埋回水管"

- category: appliance_smart_home
  name: "智能家居预留"
  pitfalls:
    - item: "开关盒未拉零线"
      risk: "智能开关装不了"
      prevention: "水电阶段要求所有开关盒拉零线"
    - item: "窗帘电机未留电源"
      risk: "电动窗帘装不了"
      prevention: "窗帘盒旁预留插座"
```

- [ ] **Step 3: Run tests to verify**

Run: `npx tsx --test tests/server/pitfall-engine.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add config/budget-pitfalls.yaml
git commit -m "feat: appliance installation pitfalls (AC, water heater, smart home)"
```

---

### Task 5: MCP tools for procurement

**Files:**
- Modify: `server/mcp-server.ts` (add tools)
- Test: `tests/server/mcp.test.ts`

**Interfaces:**
- Consumes: `LifecycleEngine.getStatus()`, `TradeoffEngine.getTradeoffs()`, `AcceptanceEngine.getChecklist()`
- Produces: MCP tools `get_procurement_status`, `run_tradeoff`, `get_acceptance_list`

- [ ] **Step 1: Write failing tests for MCP tools**

Add tests to `tests/server/mcp.test.ts`:

```typescript
it('get_procurement_status returns material stages', async () => {
  const res = await callMcpTool('get_procurement_status', {});
  assert.ok(res.content);
  const data = JSON.parse(res.content[0].text);
  assert.ok(Array.isArray(data.materials));
  assert.ok(data.materials[0].id);
  assert.ok(data.materials[0].stage);
});

it('run_tradeoff returns options for a topic', async () => {
  const res = await callMcpTool('run_tradeoff', { topic: 'tile_installation' });
  assert.ok(res.content);
  const data = JSON.parse(res.content[0].text);
  assert.ok(data.tradeoffs.length > 0);
});

it('get_acceptance_list returns items for phase', async () => {
  const res = await callMcpTool('get_acceptance_list', { phase: 'tile_installation' });
  assert.ok(res.content);
  const data = JSON.parse(res.content[0].text);
  assert.ok(data.items.length > 0);
});
```

- [ ] **Step 2: Implement MCP tool handlers**

In `server/mcp-server.ts`, register three new tools:

```typescript
server.setRequestHandler('get_procurement_status', async () => {
  const engine = deps.getLifecycleEngine();
  const materials = engine.getAllStatuses();
  return {
    content: [{ type: 'text', text: JSON.stringify({ materials }) }],
  };
});

server.setRequestHandler('run_tradeoff', async (req) => {
  const topic = req.params.topic;
  const engine = deps.getTradeoffEngine();
  const tradeoffs = engine.getTradeoffs(topic);
  return {
    content: [{ type: 'text', text: JSON.stringify({ tradeoffs }) }],
  };
});

server.setRequestHandler('get_acceptance_list', async (req) => {
  const { phase, roomId } = req.params;
  const engine = deps.getAcceptanceEngine();
  const items = roomId
    ? engine.getChecklistForRoom(phase, roomId)
    : engine.getChecklist(phase);
  return {
    content: [{ type: 'text', text: JSON.stringify({ items }) }],
  };
});
```

- [ ] **Step 3: Add engine factories to McpDeps**

```typescript
export interface McpDeps {
  // ... existing deps
  getLifecycleEngine: () => LifecycleEngine;
  getTradeoffEngine: () => TradeoffEngine;
  getAcceptanceEngine: () => AcceptanceEngine;
}
```

Implement as getters (hot-reload safe, same pattern as `getPitfallEngine`).

- [ ] **Step 4: Run tests to verify pass**

Run: `npx tsx --test tests/server/mcp.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck + test:server**

Run: `npm run typecheck && npm run test:server`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add server/mcp-server.ts tests/server/mcp.test.ts
git commit -m "feat: MCP tools — get_procurement_status, run_tradeoff, get_acceptance_list"
```

---

### Self-Review

- [ ] Spec coverage: LifecycleEngine (Task 1), TradeoffEngine (Task 2), AcceptanceEngine (Task 3), Appliance pitfalls (Task 4), MCP tools (Task 5) — all covered
- [ ] No placeholders: all code blocks contain real implementation
- [ ] Type consistency: engine interfaces match across tasks
- [ ] Each task produces independently shippable, testable code
