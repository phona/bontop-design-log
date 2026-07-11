# Full Renovation Tradeoff System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the 3D renovation tool from scheme management into a full tradeoff decision system: rich material options, automated risk checking, visual preview with textures/furniture, complete budget calculation with labor+soft furnishings, and cross-scheme/layout comparison.

**Architecture:** Data-first approach — expand config files (materials.yaml, house.yaml, budget/base.json, design-rules.yaml) first, then upgrade server logic (ProjectCatalog, BudgetCalculator, routes, DesignState, MCP), then app rendering (TextureFactory, FurnitureFactory, HouseScene), then UI (SchemePanel, OverviewMenu, App), then CAD unlock.

**Tech Stack:** TypeScript (shared types), Python 3 (ezdxf for CAD), Three.js (CanvasTexture, BoxGeometry, OrbitControls), Node.js/Express (REST API), MCP SDK (remote tools), Vitest + Node test runner + pytest.

## Global Constraints

- All material entries in `materials.yaml` must include `alternative_group`, `calc_mode`, `pros`, `cons`, `price_source` fields
- `MaterialItem` type in `shared/types.ts` must match — no field mismatches between config and code
- Budget calculations must separate `material` + `labor` + `furnishing` categories in the response
- Furniture meshes get `userData: { hoverable: false }` — no raycast interaction
- `parse_cad.py` geometry merge must only carry over unlabeled rooms (entry_garden, south_balcony, west_platform), not preserve old geometry for labeled rooms
- All new server tests use `node:test` + `node:assert/strict` (existing pattern)
- All new app tests use Vitest (existing pattern)
- No external image files or .glb models — textures are CanvasTexture, furniture is BoxGeometry

---

### Task 1: Expand shared types for all new fields

**Files:**
- Modify: `shared/types.ts`

**Interfaces:**
- Produces: `MaterialItem` with `alternative_group?: string`, `calc_mode?: 'area' | 'length' | 'count' | 'fixed'`, `pros?: string[]`, `cons?: string[]`, `price_source?: string`, `appearance?: { type: string; color: string }`. New types: `FurnitureDef`, `ElectricalMarker`, `LayoutOption`, `SchemeDiff`, `StructuralDiff`.

- [ ] Add `alternative_group`, `calc_mode`, `pros`, `cons`, `price_source`, `appearance` to `MaterialItem` interface

```ts
export interface MaterialItem {
  id: string;
  category: string;
  name: string;
  brand: string;
  model: string;
  spec: string;
  unit: string;
  price_per_unit: number;
  coverage_per_unit: number;
  loss_rate: number;
  supplier: string;
  online_link: string;
  sample_acquired: boolean;
  sample_date: string | null;
  status: string;
  notes: string;
  alternative_group?: string;
  calc_mode?: 'area' | 'length' | 'count' | 'fixed';
  pros?: string[];
  cons?: string[];
  price_source?: string;
  appearance?: { type: string; color: string };
  data?: Record<string, unknown>;
}
```

- [ ] Add new types after existing type definitions (before EOF, after `CadLayoutYaml`)

```ts
export type CalcMode = 'area' | 'length' | 'count' | 'fixed';

export interface FurnitureDef {
  roomId: string;
  type: string;
  position: { x: number; z: number };
  rotation?: number;
}

export interface ElectricalMarker {
  roomId: string;
  type: 'switch' | 'outlet' | 'network' | 'curtain_power';
  wall: 'north' | 'south' | 'east' | 'west';
  height: number;
  offset: number;
}

export interface FurnishingsYaml {
  [roomId: string]: Record<string, number>;
}

export interface LaborRate {
  rate: number;
  unit: string;
  area: string;
}

export interface BudgetCategoryRaw {
  budget: number;
  material: number;
  labor?: LaborRate;
  actual: number;
  status: string;
  notes: string;
}

export interface LayoutOption {
  name: string;
  path: string;
  rooms: Array<{ id: string; name: string }>;
  platform?: { id: string; name: string };
}

export interface SelectionDiff {
  topic: string;
  current: string | null;
  compare: string | null;
  priceDelta: number;
}

export interface SchemeDiff {
  budget: number;
  selections: SelectionDiff[];
  risks: {
    added: Array<{ id: string; severity: string }>;
    removed: Array<{ id: string; severity: string }>;
  };
}

export interface StructuralDiffEntry {
  roomId: string;
  current: { area: number };
  compare: { area: number };
  delta: number;
}

export interface CompareSchemesResult {
  current: { scheme: CurrentScheme; budget: BudgetSnapshot; risks: DesignCheckResult };
  compare: { scheme: CurrentScheme; budget: BudgetSnapshot; risks: DesignCheckResult };
  diff: SchemeDiff;
  structural?: {
    roomsOnlyInCurrent: string[];
    roomsOnlyInCompare: string[];
    areaDelta: StructuralDiffEntry[];
  };
}
```

- [ ] Update `DesignRulesConfig` budget to support `lineItems` with `quantityField`

```ts
export interface DesignRulesConfig {
  version: string;
  objectMapping?: Array<{ pattern: string; topics: string[] }>;
  budget?: {
    baseCategoriesFrom?: string;
    topicCategories?: Record<string, string>;
    lineItems?: Array<{ topic: string; quantityField?: string; calcMode?: string }>;
  };
  risks?: Array<{
    id: string;
    severity: 'high' | 'medium' | 'low';
    message: string;
    when: { topic: string; options?: string[]; condition?: string };
  }>;
  constraints?: Array<{
    id: string;
    description: string;
    when: { topic: string; condition: string };
    require: { topic: string; minValue?: { field: string; value: number }; fields?: string[] };
  }>;
}
```

- [ ] Update `Risk` severity union type

```ts
export interface Risk {
  id: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  topic: string;
  roomId: string | null;
}
```

- [ ] Update `HouseYaml` to include furnishings

```ts
export interface HouseYaml {
  project: Record<string, unknown>;
  rooms: Array<HouseRoom>;
  gift_areas: Array<Record<string, unknown>>;
  mechanical_electrical_plumbing: Record<string, unknown>;
  constraints: Record<string, unknown>;
  furnishings?: FurnishingsYaml;
  electrical?: ElectricalMarker[];
}
```

- [ ] Remove deprecated `Snapshot` and `Command` interfaces (lines 19-47) — they are marked `@deprecated` but still vestigial

- [ ] Run typecheck: `npm run typecheck`
- [ ] Commit: `git add shared/types.ts && git commit -m "feat: expand shared types for tradeoff system"`

---

### Task 2: Expand materials.yaml with candidates, calc_mode, pros/cons

**Files:**
- Modify: `config/materials.yaml`

**Interfaces:**
- Produces: 40+ material entries with `alternative_group`, `calc_mode`, `pros`, `cons`, `price_source`, `appearance` fields on every entry. Alternative entries for floor tiles (2 additional), wall tiles (2 additional), and soft furnishings (~10 new).

- [ ] Add `alternative_group`, `calc_mode`, `pros`, `cons`, `price_source` to all existing 22 entries. Read `docs/material_selection_log.md` to extract pros/cons

- [ ] Add `appearance` field to floor tile, wall tile, and paint entries:

```yaml
  - id: "floor_tile_01"
    # ... existing fields
    alternative_group: "floor_tile"
    calc_mode: "area"
    pros: ["木纹颜值高", "防滑好", "品牌可靠"]
    cons: ["需确认具体型号", "800x800 对工人手艺要求高"]
    price_source: "快环建材市场A区3号 / 马可波罗门店报价"
    appearance: { type: "wood_grain", color: "#c49a6c" }
```

- [ ] Add `floor_tile_02` (灰色柔光砖 — 冠珠, ~55元/片, alternative_group: floor_tile, calc_mode: area)
```yaml
  - id: "floor_tile_02"
    alternative_group: "floor_tile"
    category: "地砖"
    name: "灰色柔光砖"
    brand: "冠珠"
    model: "600x1200 柔光灰（型号待门店确认）"
    spec: "600x1200mm"
    unit: "片"
    price_per_unit: 99
    coverage_per_unit: 0.72
    loss_rate: 1.08
    calc_mode: "area"
    supplier: "冠珠门店"
    online_link: ""
    sample_acquired: false
    sample_date: null
    status: "candidate"
    pros: ["耐脏", "现代感强", "柔光不刺眼"]
    cons: ["价格较高", "大砖工费加价"]
    price_source: "冠珠门店报价"
    notes: "灰色系搭配大白墙，风格统一"
    appearance: { type: "ceramic_tile", color: "#b0a89c" }
```

- [ ] Add `floor_tile_03` (浅灰亮光砖 — 东鹏, ~45元/片)
```yaml
  - id: "floor_tile_03"
    alternative_group: "floor_tile"
    category: "地砖"
    name: "浅灰亮光砖"
    brand: "东鹏"
    model: "800x800 浅灰亮面"
    spec: "800x800mm"
    unit: "片"
    price_per_unit: 45
    coverage_per_unit: 0.64
    loss_rate: 1.08
    calc_mode: "area"
    supplier: "东鹏门店"
    online_link: ""
    sample_acquired: false
    sample_date: null
    status: "candidate"
    pros: ["价格最低", "亮面好清洁", "品牌可靠"]
    cons: ["反光刺眼", "纹理不够自然"]
    price_source: "东鹏门店报价"
    notes: "预算最低方案，适合出租/务实档"
    appearance: { type: "ceramic_tile", color: "#d4cfc7" }
```

- [ ] Add `wall_tile_02` (柔光白瓷片 — 马可波罗)
```yaml
  - id: "wall_tile_02"
    alternative_group: "wall_tile"
    category: "墙砖"
    name: "柔光白瓷片"
    brand: "马可波罗"
    model: "300x600 柔光白"
    spec: "300x600mm"
    unit: "片"
    price_per_unit: 22
    coverage_per_unit: 0.18
    loss_rate: 1.05
    calc_mode: "area"
    supplier: "马可波罗门店"
    online_link: ""
    sample_acquired: false
    sample_date: null
    status: "candidate"
    pros: ["质感更好", "防滑", "品牌溢价可接受"]
    cons: ["价格高 83%", "需确认库存"]
    price_source: "马可波罗门店报价"
    notes: "预算允许下推荐，质感明显提升"
    appearance: { type: "ceramic_tile", color: "#f0ede6" }
```

- [ ] Add `wall_tile_03` (灰色仿古砖 — 冠珠)
```yaml
  - id: "wall_tile_03"
    alternative_group: "wall_tile"
    category: "墙砖"
    name: "灰色仿古砖"
    brand: "冠珠"
    model: "300x600 灰色仿古"
    spec: "300x600mm"
    unit: "片"
    price_per_unit: 18
    coverage_per_unit: 0.18
    loss_rate: 1.05
    calc_mode: "area"
    supplier: "冠珠门店"
    online_link: ""
    sample_acquired: false
    sample_date: null
    status: "candidate"
    pros: ["耐脏", "风格独特", "性价比适中"]
    cons: ["厨房显暗", "不宜大面积用"]
    price_source: "冠珠门店报价"
    notes: "建议卫生间用，厨房搭配亮色"
    appearance: { type: "ceramic_tile", color: "#a8a09a" }
```

- [ ] Add soft furnishing entries (all `calc_mode: "count"`, `alternative_group` per type):

```yaml
  - id: "bed_180_01"
    alternative_group: "bed"
    category: "家具"
    name: "1.8m 实木床"
    brand: "本地家具厂 / 源氏木语"
    model: "1.8×2.0m 橡木/白蜡木"
    spec: "1800×2000mm"
    unit: "张"
    price_per_unit: 2500
    coverage_per_unit: 1
    loss_rate: 1
    calc_mode: "count"
    supplier: "本地家具市场 / 源氏木语线上"
    online_link: ""
    sample_acquired: false
    sample_date: null
    status: "candidate"
    pros: ["实木环保", "耐用"]
    cons: ["价格中等"]
    price_source: "源氏木语天猫旗舰店"
    notes: "含床头柜, 不含床垫"

  - id: "mattress_180_01"
    alternative_group: "mattress"
    category: "家具"
    name: "1.8m 独立袋装弹簧床垫"
    brand: "喜临门 / 雅兰"
    model: "20-25cm 独立袋装弹簧 + 乳胶"
    spec: "1800×2000mm"
    unit: "张"
    price_per_unit: 2000
    coverage_per_unit: 1
    loss_rate: 1
    calc_mode: "count"
    supplier: "京东 / 天猫 / 本地家具城"
    online_link: ""
    sample_acquired: false
    sample_date: null
    status: "candidate"
    pros: ["独立弹簧互不干扰", "中等偏软舒适"]
    cons: ["需试躺确认"]
    price_source: "喜临门天猫旗舰店"
    notes: "建议到店试躺后再确定"

  - id: "wardrobe_240_01"
    alternative_group: "wardrobe"
    category: "家具"
    name: "2.4m 定制衣柜"
    brand: "本地全屋定制工厂"
    model: "2.4×0.6×2.7m，平开门"
    spec: "2400×600×2700mm"
    unit: "个"
    price_per_unit: 4200
    coverage_per_unit: 1
    loss_rate: 1
    calc_mode: "count"
    supplier: "快环建材市场全屋定制"
    online_link: ""
    sample_acquired: false
    sample_date: null
    status: "candidate"
    pros: ["尺寸精准", "板材可选"]
    cons: ["定制周期长"]
    price_source: "本地全屋定制工厂报价"
    notes: "按投影面积约 1700 元/㎡ × 2.4m × 2.7m 估算"

  - id: "sofa_3seat_01"
    alternative_group: "sofa"
    category: "家具"
    name: "三人位科技布沙发"
    brand: "林氏家居 / 全友"
    model: "2.8m 三人位 + 贵妃位"
    spec: "2800×900×400mm"
    unit: "套"
    price_per_unit: 3200
    coverage_per_unit: 1
    loss_rate: 1
    calc_mode: "count"
    supplier: "林氏家居天猫 / 线下门店"
    online_link: ""
    sample_acquired: false
    sample_date: null
    status: "candidate"
    pros: ["科技布防水耐脏", "性价比高"]
    cons: ["布艺不如真皮高级"]
    price_source: "林氏家居天猫旗舰店"
    notes: "科技布是务实档首选，真皮预算翻倍"

  - id: "dining_table_01"
    alternative_group: "dining_table"
    category: "家具"
    name: "1.4m 岩板餐桌"
    brand: "本地家具厂"
    model: "1.4×0.8m 岩板台面 + 碳素钢腿"
    spec: "1400×800×750mm"
    unit: "张"
    price_per_unit: 1800
    coverage_per_unit: 1
    loss_rate: 1
    calc_mode: "count"
    supplier: "本地家具市场"
    online_link: ""
    sample_acquired: false
    sample_date: null
    status: "candidate"
    pros: ["岩板耐高温易清洁", "现代感强"]
    cons: ["岩板较脆怕撞击"]
    price_source: "本地家居建材市场"
    notes: "1.4m 适合 4 人常用，6 人挤一挤"

  - id: "dining_chair_01"
    alternative_group: "dining_chair"
    category: "家具"
    name: "简约餐椅"
    brand: "林氏家居"
    model: "科技布软包 + 金属腿"
    spec: "标准"
    unit: "把"
    price_per_unit: 300
    coverage_per_unit: 1
    loss_rate: 1
    calc_mode: "count"
    supplier: "林氏家居天猫旗舰店"
    online_link: ""
    sample_acquired: false
    sample_date: null
    status: "candidate"
    pros: ["百搭", "价格低"]
    cons: []
    price_source: "林氏家居天猫旗舰店"
    notes: "4 把起步，可根据实际增减"

  - id: "tv_stand_01"
    alternative_group: "tv_stand"
    category: "家具"
    name: "1.8m 电视柜"
    brand: "本地家具厂 / 林氏家居"
    model: "1.8×0.4×0.4m 简约款"
    spec: "1800×400×400mm"
    unit: "个"
    price_per_unit: 1200
    coverage_per_unit: 1
    loss_rate: 1
    calc_mode: "count"
    supplier: "林氏家居天猫 / 本地家具市场"
    online_link: ""
    sample_acquired: false
    sample_date: null
    status: "candidate"
    pros: ["简约实用", "收纳够用"]
    cons: []
    price_source: "林氏家居天猫旗舰店"
    notes: "与沙发风格统一"
```

- [ ] Commit: `git add config/materials.yaml && git commit -m "feat: expand materials with candidates, calc_mode, pros/cons, soft furnishings"`

---

### Task 3: Add furnishings and electrical defaults to house.yaml

**Files:**
- Modify: `config/house.yaml`

**Interfaces:**
- Produces: `furnishings` section with per-room item counts. `electrical` section with default marker placements.

- [ ] Add `furnishings` section after the existing `mechanical_electrical_plumbing` section, before `constraints`:

```yaml
furnishings:
  master_bedroom:
    bed_180: 1
    mattress_180: 1
    wardrobe_240: 1
    curtain_set: 1
    ceiling_light: 1
  bedroom_nw:
    bed_180: 1
    mattress_180: 1
    wardrobe_240: 1
    curtain_set: 1
    ceiling_light: 1
  bedroom_se:
    bed_180: 1
    mattress_180: 1
    wardrobe_240: 1
    curtain_set: 1
    ceiling_light: 1
  study:
    desk: 1
    chair: 1
    bookshelf: 1
    curtain_set: 1
    ceiling_light: 1
  living_dining:
    sofa_3seat: 1
    dining_table: 1
    dining_chair: 4
    tv_stand: 1
    curtain_set: 2
    ceiling_light: 2
  kitchen:
    cabinet_base: 3.5
    cabinet_wall: 2.0
    countertop_quartz: 3.5
    sink: 1
    range_hood: 1
    gas_stove: 1
    ceiling_light: 1
  master_bath:
    toilet: 1
    shower_set: 1
    vanity: 1
    faucet: 1
    ceiling_light: 1
    exhaust_fan: 1
  guest_bath:
    toilet: 1
    shower_set: 1
    vanity: 1
    faucet: 1
    ceiling_light: 1
    exhaust_fan: 1
  balcony:
    ceiling_light: 1
  entry_garden:
    shoe_cabinet: 1
    ceiling_light: 1
  south_balcony:
    ceiling_light: 1
```

- [ ] Add `electrical` defaults section:

```yaml
electrical:
  # Light switches — one per room, interior side of door, 1.3m high
  - type: "switch"
    roomId: "master_bedroom"
    wall: "east"
    height: 1.3
    offset: -0.5
  - type: "switch"
    roomId: "bedroom_nw"
    wall: "south"
    height: 1.3
    offset: -0.5
  - type: "switch"
    roomId: "bedroom_se"
    wall: "west"
    height: 1.3
    offset: -0.5
  - type: "switch"
    roomId: "study"
    wall: "north"
    height: 1.3
    offset: -0.5
  - type: "switch"
    roomId: "living_dining"
    wall: "north"
    height: 1.3
    offset: -0.5
  - type: "switch"
    roomId: "kitchen"
    wall: "north"
    height: 1.3
    offset: 0
  - type: "switch"
    roomId: "master_bath"
    wall: "east"
    height: 1.3
    offset: 0
  - type: "switch"
    roomId: "guest_bath"
    wall: "west"
    height: 1.3
    offset: 0
  # Power outlets — every 3m along walls, 0.3m high
  - type: "outlet"
    roomId: "master_bedroom"
    wall: "north"
    height: 0.3
    offset: -1.0
  - type: "outlet"
    roomId: "master_bedroom"
    wall: "west"
    height: 0.3
    offset: 0
  - type: "outlet"
    roomId: "living_dining"
    wall: "south"
    height: 0.3
    offset: -0.8
  - type: "outlet"
    roomId: "living_dining"
    wall: "north"
    height: 0.3
    offset: 0.8
  - type: "outlet"
    roomId: "kitchen"
    wall: "north"
    height: 1.1
    offset: -1.0
  - type: "outlet"
    roomId: "kitchen"
    wall: "north"
    height: 1.1
    offset: 1.0
  # Network ports
  - type: "network"
    roomId: "living_dining"
    wall: "south"
    height: 0.3
    offset: 0
  - type: "network"
    roomId: "study"
    wall: "west"
    height: 0.3
    offset: 0
  # Curtain power — window wall, 2.7m high
  - type: "curtain_power"
    roomId: "master_bedroom"
    wall: "south"
    height: 2.7
    offset: -0.8
  - type: "curtain_power"
    roomId: "master_bedroom"
    wall: "south"
    height: 2.7
    offset: 0.8
  - type: "curtain_power"
    roomId: "living_dining"
    wall: "south"
    height: 2.7
    offset: -1.5
  - type: "curtain_power"
    roomId: "living_dining"
    wall: "south"
    height: 2.7
    offset: 1.5
```

- [ ] Commit: `git add config/house.yaml && git commit -m "feat: add furnishings and electrical defaults to house.yaml"`

---

### Task 4: Add labor rates to budget/base.json

**Files:**
- Modify: `config/budget/base.json`

**Interfaces:**
- Produces: Each category gains optional `material` (number) and `labor` (`{ rate, unit, area }`) fields. Service-only categories (demolition, property_fees, contingency) skip labor.

- [ ] Add `material: 0` and `labor` to applicable categories:

```json
{
  "version": "v0.4-tradeoff",
  "locked_date": null,
  "currency": "CNY",
  "total_budget": 110000,
  "notes": "11 万务实档。套内 94.76㎡、层高 3.0m；开放式厨房、中央空调/多联机、全屋窗帘、智能预留 B 级。量房和施工图完成后需重新核算。",
  "categories": {
    "demolition": {"budget": 5000, "material": 0, "actual": 0, "status": "draft", "notes": "拆改+清运，按设计图拆除非承重墙"},
    "water_electric": {"budget": 8500, "material": 0, "labor": {"rate": 5000, "unit": "一口价", "area": "fixed"}, "actual": 0, "status": "draft", "notes": "四房两厅两卫 + 开放式厨房，插座点位多；含智能开关零线、电动窗帘电源布线"},
    "waterproof": {"budget": 3500, "material": 0, "labor": {"rate": 20, "unit": "元/㎡", "area": "wet_floor"}, "actual": 0, "status": "draft", "notes": "两卫+厨房+北阳台，南向大阳台已封闭但地面仍需防水处理"},
    "masonry": {"budget": 18500, "material": 0, "labor": {"rate": 45, "unit": "元/㎡", "area": "floor"}, "actual": 0, "status": "draft", "notes": "地砖 35-45元/片，墙砖 10元/片；按 94.76㎡ 套内 + 部分赠送面积估算"},
    "carpentry": {"budget": 5000, "material": 0, "labor": {"rate": 40, "unit": "元/㎡", "area": "ceiling"}, "actual": 0, "status": "draft", "notes": "厨卫铝扣板吊顶 + 客餐厅局部吊顶，层高 3.0m"},
    "painting": {"budget": 11500, "material": 0, "labor": {"rate": 25, "unit": "元/㎡", "area": "paint_wall"}, "actual": 0, "status": "draft", "notes": "大白墙为主，局部跳色；层高 3.0m，墙面面积比 2.8m 高约 7%"},
    "doors_windows": {"budget": 10500, "material": 0, "labor": {"rate": 150, "unit": "元/扇", "area": "door_count"}, "actual": 0, "status": "draft", "notes": "室内门 4 扇、卫生间门 2 扇、入户门 1 扇；外立面玻璃幕墙已由开发商完成，不含封窗"},
    "sanitary": {"budget": 10000, "material": 0, "labor": {"rate": 200, "unit": "元/件", "area": "fixture_count"}, "actual": 0, "status": "draft", "notes": "国产基础款（九牧/箭牌），含两卫三件套"},
    "kitchen_cabinet": {"budget": 6500, "material": 0, "actual": 0, "status": "draft", "notes": "L 型地柜约 3.5m，多层板+石英石；含洗碗机/净水器预留"},
    "range_hood": {"budget": 2500, "material": 0, "actual": 0, "status": "draft", "notes": "开放式厨房必须配大功率侧吸油烟机，≥22m³/min"},
    "hvac": {"budget": 0, "material": 0, "actual": 0, "status": "draft", "notes": "中央空调/多联机，actual 由 HVAC 选项自动计算；budget 0 表示不占用 11 万基础包，可手动调整"},
    "lighting": {"budget": 2800, "material": 0, "actual": 0, "status": "draft", "notes": "吸顶灯为主 + 局部筒灯，控制成本"},
    "curtains": {"budget": 4000, "material": 0, "actual": 0, "status": "draft", "notes": "全屋玻璃幕墙，窗帘为刚需；纱帘+遮光帘，厨卫用防水卷帘/百叶"},
    "smart_home": {"budget": 2000, "material": 0, "actual": 0, "status": "draft", "notes": "智能开关零线 + 网关位 + 电动窗帘电源 + 人体传感器位；不上调光和自动化"},
    "miscellaneous": {"budget": 5700, "material": 0, "actual": 0, "status": "draft", "notes": "美缝、踢脚线、五金、清洁"},
    "property_fees": {"budget": 3000, "material": 0, "actual": 0, "status": "draft", "notes": "装修押金、垃圾清运费、管理费"},
    "contingency": {"budget": 11000, "material": 0, "actual": 0, "status": "reserved", "notes": "不可预见费"}
  }
}
```

- [ ] Commit: `git add config/budget/base.json && git commit -m "feat: add labor rates to budget categories"`

---

### Task 5: Add rules and topic mappings to design-rules.yaml

**Files:**
- Modify: `config/design-rules.yaml`

**Interfaces:**
- Produces: 6 risk rules, 2 constraint rules, expanded `topicCategories` (18 entries), `lineItems` (18 entries).

- [ ] Add risks section:

```yaml
risks:
  - id: "kitchen_hood_weak"
    severity: "high"
    when:
      topic: "range_hood"
      condition: "$option.airflow < 22"
    message: "开放式厨房必须配 ≥22m³/min 侧吸油烟机，当前油烟机风量不足"

  - id: "outdoor_unit_overflow"
    severity: "high"
    when:
      topic: "hvac"
      condition: "$selection.hvac == 'E1'"
    message: "叠叠乐方案外机过多，散热、噪音、维修风险高，不建议"

  - id: "garden_outdoor_warning"
    severity: "medium"
    when:
      topic: "hvac"
      condition: "$selection.hvac == 'F2'"
    message: "外机放入户花园存在噪音、热风及物业/消防风险，需现场确认"

  - id: "floor_tile_no_frost"
    severity: "medium"
    when:
      topic: "floor"
      condition: "$selection.floor == 'floor_tile_03'"
    message: "亮光砖反光较强，客厅大面积使用可能刺眼；建议搭配哑光家具和窗帘"

  - id: "dark_tile_small_room"
    severity: "low"
    when:
      topic: "wall"
      condition: "$selection.wall == 'wall_tile_03'"
    message: "灰色仿古砖在小卫生间使用可能显暗，建议搭配亮色灯光"

  - id: "wall_tile_cost_warning"
    severity: "low"
    when:
      topic: "wall"
      condition: "$selection.wall == 'wall_tile_02'"
    message: "柔光白瓷片价格 22 元/片，比标配贵 83%，全屋墙砖预算将明显增加"

constraints:
  - id: "open_kitchen_hood"
    when:
      topic: "kitchen"
      condition: "$selection.kitchen == 'open'"
    require:
      topic: "range_hood"
      minValue:
        field: "airflow"
        value: 22
    description: "开放式厨房必须选配 ≥22m³/min 油烟机"

  - id: "hvac_platform_check"
    when:
      topic: "hvac"
      condition: "$selection.hvac == 'E1'"
    require:
      topic: "hvac"
      fields: ["outdoor_width"]
    description: "E1 方案多台外机需确认西平台宽度是否足够"
```

- [ ] Expand `topicCategories`:

```yaml
  topicCategories:
    floor: masonry
    wall: masonry
    paint: painting
    hvac: hvac
    cabinet: kitchen_cabinet
    countertop: kitchen_cabinet
    interior_door: doors_windows
    bathroom_door: doors_windows
    entry_door: doors_windows
    curtain: curtains
    toilet: sanitary
    shower: sanitary
    vanity: sanitary
    faucet: sanitary
    lighting: lighting
    switch_socket: water_electric
    range_hood: range_hood
    water_heater: water_electric
    smart_home: smart_home
    hardware: miscellaneous
    bed: miscellaneous
    mattress: miscellaneous
    wardrobe: miscellaneous
    sofa: miscellaneous
    dining_table: miscellaneous
    dining_chair: miscellaneous
    tv_stand: miscellaneous
    desk: miscellaneous
```

- [ ] Expand `lineItems` with `calcMode`:

```yaml
  lineItems:
    - topic: floor
      quantityField: floorArea
      calcMode: area
    - topic: wall
      quantityField: wetWallArea
      calcMode: area
    - topic: paint
      quantityField: paintWallArea
      calcMode: area
    - topic: hvac
      calcMode: fixed
    - topic: cabinet
      quantityField: linearKitchen
      calcMode: length
    - topic: countertop
      quantityField: linearKitchen
      calcMode: length
    - topic: interior_door
      quantityField: doorCount
      calcMode: count
    - topic: bathroom_door
      quantityField: doorCount
      calcMode: count
    - topic: entry_door
      quantityField: doorCount
      calcMode: count
    - topic: toilet
      quantityField: fixtureCount
      calcMode: count
    - topic: shower
      quantityField: fixtureCount
      calcMode: count
    - topic: vanity
      quantityField: fixtureCount
      calcMode: count
    - topic: faucet
      quantityField: fixtureCount
      calcMode: count
    - topic: lighting
      calcMode: fixed
    - topic: switch_socket
      calcMode: fixed
    - topic: range_hood
      calcMode: fixed
    - topic: water_heater
      calcMode: fixed
    - topic: smart_home
      calcMode: fixed
    - topic: hardware
      calcMode: fixed
    - topic: curtain
      calcMode: fixed
    - topic: bed
      calcMode: count
    - topic: mattress
      calcMode: count
    - topic: wardrobe
      calcMode: count
    - topic: sofa
      calcMode: count
    - topic: dining_table
      calcMode: count
    - topic: dining_chair
      calcMode: count
    - topic: tv_stand
      calcMode: count
```

- [ ] Commit: `git add config/design-rules.yaml && git commit -m "feat: add risk rules, constraints, expanded topic/budget mappings"`

---

### Task 6: ProjectCatalog — multi-layout support and expanded topic mapping

**Files:**
- Modify: `server/project-catalog.ts`

**Interfaces:**
- Consumes: Updated `shared/types.ts` with `LayoutOption`, `MaterialItem` with `alternative_group`, `FurnishingsYaml`, `ElectricalMarker`
- Produces: `getLayouts()`, `getFurnishings()`, `getElectricalMarkers()`, expanded `MATERIAL_TOPIC_MAP`, catalog loads materials with new `alternative_group` field

- [ ] Expand `MATERIAL_TOPIC_MAP` to cover all categories from materials.yaml:

```ts
const MATERIAL_TOPIC_MAP: Record<string, string> = {
  地砖: 'floor',
  墙砖: 'wall',
  乳胶漆: 'paint',
  柜体板材: 'cabinet',
  台面: 'countertop',
  室内门: 'interior_door',
  卫生间门: 'bathroom_door',
  入户门: 'entry_door',
  窗帘: 'curtain',
  卫浴洁具: 'sanitary',
  灯具: 'lighting',
  开关插座: 'switch_socket',
  五金件: 'hardware',
  暖通空调: 'hvac',
  热水器: 'water_heater',
  厨房电器: 'range_hood',
  智能家居: 'smart_home',
  家具: 'miscellaneous',
};
```

- [ ] Update `materialToOption` to carry `alternative_group`, `calc_mode`, `pros`, `cons`, `price_source`, `appearance` through to `DesignOption.data`:

```ts
function materialToOption(m: MaterialItem): DesignOption | null {
  const topicId = MATERIAL_TOPIC_MAP[m.category];
  if (!topicId) return null;
  return {
    id: m.id,
    topicId,
    name: m.name,
    description: `${m.brand} ${m.model} · ${m.price_per_unit} 元/${m.unit}`,
    price_per_unit: m.price_per_unit,
    coverage_per_unit: m.coverage_per_unit,
    loss_rate: m.loss_rate,
    data: {
      ...m,
      alternative_group: m.alternative_group,
      calc_mode: m.calc_mode,
      pros: m.pros,
      cons: m.cons,
      price_source: m.price_source,
      appearance: m.appearance,
    },
  };
}
```

- [ ] Add layout tracking fields and load method:

```ts
export class ProjectCatalog {
  private topics = new Map<string, CatalogTopic>();
  private rooms = new Map<string, RoomLayout>();
  private platform: RoomLayout | undefined;
  private budgetCategories: BudgetCategory[] = [];
  private furnishings: FurnishingsYaml = {};
  private electricalMarkers: ElectricalMarker[] = [];
  private layoutSource: string = '';

  constructor(
    materials: MaterialsYaml,
    budgetBase: {
      total_budget: number;
      categories: Record<string, Omit<BudgetCategory, 'key'>>;
    },
    layout: CadLayoutYaml,
    houseMeta?: HouseYaml,
    layoutSource?: string
  ) {
    // ... existing topic loading ...

    this.furnishings = houseMeta?.furnishings ?? {};
    this.electricalMarkers = houseMeta?.electrical ?? [];
    this.layoutSource = layoutSource ?? layout.source;

    // ... existing room loading ...
  }

  getFurnishings(): FurnishingsYaml {
    return this.furnishings;
  }

  getElectricalMarkers(): ElectricalMarker[] {
    return this.electricalMarkers;
  }

  getLayoutSource(): string {
    return this.layoutSource;
  }
}
```

- [ ] Add `getLayouts()` static method and layout-aware `load()`:

```ts
import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

static getLayouts(configDir = '.'): LayoutOption[] {
  const layoutDir = join(configDir, 'config/layout');
  const results: LayoutOption[] = [];
  try {
    const files = readdirSync(layoutDir).filter((f) => f.endsWith('.yaml'));
    for (const file of files) {
      const yaml = load(readFileSync(join(layoutDir, file), 'utf8')) as CadLayoutYaml;
      results.push({
        name: basename(file, '.yaml'),
        path: `config/layout/${file}`,
        rooms: yaml.rooms.map((r) => ({ id: r.id, name: r.name })),
        platform: yaml.platform ? { id: yaml.platform.id, name: yaml.platform.name } : undefined,
      });
    }
  } catch {
    // directory may not exist or be empty
  }
  return results;
}

static load(configDir = '.', layoutName?: string): ProjectCatalog {
  const materials = load(readFileSync(`${configDir}/config/materials.yaml`, 'utf8')) as MaterialsYaml;
  const budgetBase = JSON.parse(readFileSync(`${configDir}/config/budget/base.json`, 'utf8')) as {
    total_budget: number;
    categories: Record<string, Omit<BudgetCategory, 'key'>>;
  };
  const layoutPath = layoutName
    ? `${configDir}/config/layout/${layoutName}.yaml`
    : `${configDir}/config/layout/cad-extracted.yaml`;
  const layout = load(readFileSync(layoutPath, 'utf8')) as CadLayoutYaml;
  const houseMeta = load(readFileSync(`${configDir}/config/house.yaml`, 'utf8')) as HouseYaml;
  return new ProjectCatalog(materials, budgetBase, layout, houseMeta, basename(layoutPath));
}
```

- [ ] Run: `npx tsx --test tests/server/project-catalog.test.ts` — verify existing tests still pass
- [ ] Commit: `git add server/project-catalog.ts && git commit -m "feat: multi-layout support and expanded topic mapping in ProjectCatalog"`

---

### Task 7: BudgetCalculator — calc_mode dispatch, labor, furnishings

**Files:**
- Modify: `server/budget-calculator.ts`
- Create: `tests/server/budget-calculator.test.ts` (update existing)

**Interfaces:**
- Consumes: `MaterialItem` with `calc_mode`, `DesignRulesConfig.budget.lineItems` with `calcMode`, `HouseYaml.furnishings`, budget categories with `labor`
- Produces: `computeLabor()`, `getFurnishingsQuantity()`, `computeLineItem()` with mode dispatch

- [ ] Add new quantity formulas for new `quantityField` values:

```ts
const QUANTITY_FORMULAS: Record<string, (room: RoomLayout) => number> = {
  floorArea: (room) => room.width * room.depth,
  wetWallArea: (room) => (room.width + room.depth) * 2 * room.height * 0.7,
  paintWallArea: (room) => (room.width + room.depth) * 2 * room.height * 0.75,
  ceilingArea: (room) => room.width * room.depth,
  linearKitchen: (room) => room.depth * 0.8,       // approx L-shape
  doorCount: () => 1,
  fixtureCount: () => 1,
};
```

- [ ] Add `computeLabor()` method:

```ts
import type { FurnishingsYaml, ElectricalMarker } from '../shared/types.js';

interface LaborRate {
  rate: number;
  unit: string;
  area: string;
}

interface BudgetCategoryRaw {
  budget: number;
  material: number;
  labor?: LaborRate;
  actual: number;
  status: string;
  notes: string;
}

private computeLabor(
  categories: BudgetCategory[],
  baseRaw: Record<string, BudgetCategoryRaw>,
  rooms: RoomLayout[],
  furnishings: FurnishingsYaml
): void {
  for (const cat of categories) {
    const raw = baseRaw[cat.key];
    if (!raw?.labor) continue;

    const { rate, area } = raw.labor;
    let quantity = 0;

    switch (area) {
      case 'floor':
        quantity = rooms.reduce((sum, r) => sum + r.width * r.depth, 0);
        break;
      case 'ceiling':
        quantity = rooms.reduce((sum, r) => sum + r.width * r.depth, 0);
        break;
      case 'paint_wall':
        quantity = rooms.reduce((sum, r) => sum + (r.width + r.depth) * 2 * r.height * 0.75, 0);
        break;
      case 'wet_floor': {
        const wetRooms = rooms.filter((r) =>
          ['master_bath', 'guest_bath', 'kitchen', 'balcony', 'south_balcony'].includes(r.id)
        );
        quantity = wetRooms.reduce((sum, r) => sum + r.width * r.depth, 0);
        break;
      }
      case 'door_count': {
        let count = 0;
        for (const [_, items] of Object.entries(furnishings)) {
          count += items['interior_door'] ?? 0;
          count += items['bathroom_door'] ?? 0;
          count += items['entry_door'] ?? 0;
          count += items['door'] ?? 0;
        }
        quantity = count;
        break;
      }
      case 'fixture_count': {
        let count = 0;
        for (const [_, items] of Object.entries(furnishings)) {
          count += items['toilet'] ?? 0;
          count += items['shower_set'] ?? 0;
          count += items['vanity'] ?? 0;
          count += items['faucet'] ?? 0;
        }
        quantity = count;
        break;
      }
      case 'fixed':
        cat.actual += rate;
        continue;
      default:
        continue;
    }
    cat.actual += Math.round(rate * quantity);
  }
}
```

- [ ] Update `calculate()` with mode dispatch:

```ts
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

    const calcMode = li.calcMode ?? 'area';

    if (calcMode === 'fixed') {
      const optionId = scheme.selections[li.topic]?.default;
      if (!optionId) continue;
      const option = this.catalog.getOption(li.topic, optionId);
      if (!option) continue;

      allLineItems.push({
        topic: li.topic,
        roomId: null,
        optionId,
        quantity: 1,
        unitPrice: option.price_per_unit,
        coveragePerUnit: 1,
        lossRate: 1,
        cost: option.price_per_unit,
      });
      categoryAutoActual.set(categoryKey, (categoryAutoActual.get(categoryKey) ?? 0) + option.price_per_unit);
      continue;
    }

    if (calcMode === 'count') {
      const furnishings = this.catalog.getFurnishings();
      let totalCost = 0;
      for (const [roomId, items] of Object.entries(furnishings)) {
        const qty = items[li.topic];
        if (!qty || qty <= 0) continue;
        const optionId = scheme.selections[li.topic]?.roomOverrides[roomId]
                       ?? scheme.selections[li.topic]?.default;
        if (!optionId) continue;
        const option = this.catalog.getOption(li.topic, optionId);
        if (!option) continue;

        const cost = option.price_per_unit * qty;
        allLineItems.push({
          topic: li.topic, roomId, optionId,
          quantity: qty, unitPrice: option.price_per_unit,
          coveragePerUnit: 1, lossRate: 1, cost,
        });
        totalCost += cost;
      }
      categoryAutoActual.set(categoryKey, (categoryAutoActual.get(categoryKey) ?? 0) + totalCost);
      continue;
    }

    // area and length modes — per-room calculation
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
          topic: li.topic, roomId: room.id, optionId,
          quantity, unitPrice: pricePerUnit,
          coveragePerUnit, lossRate, cost,
        });

        categoryAutoActual.set(
          categoryKey,
          (categoryAutoActual.get(categoryKey) ?? 0) + cost
        );
      }
    }
    // ... non-perRoom fallback unchanged from original ...
  }

  // Build categories with labor
  const budgetRaw = JSON.parse(
    readFileSync('config/budget/base.json', 'utf8')
  ) as { categories: Record<string, BudgetCategoryRaw> };

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

  this.computeLabor(categories, budgetRaw.categories, this.catalog.getRooms(), this.catalog.getFurnishings());

  const totalBudget = categories.reduce((sum, c) => sum + c.budget, 0);
  const totalActual = categories.reduce((sum, c) => sum + c.actual, 0);

  return { totalBudget, totalActual, categories, lineItems: allLineItems };
}
```

- [ ] Update test file to verify calc_mode dispatch, labor calculation, and furnishings

- [ ] Run: `npx tsx --test tests/server/budget-calculator.test.ts`
- [ ] Commit: `git add server/budget-calculator.ts tests/server/budget-calculator.test.ts && git commit -m "feat: calc_mode dispatch, labor, furnishings in BudgetCalculator"`

---

### Task 8: Server routes — layouts, layout param, compare endpoint

**Files:**
- Modify: `server/routes.ts`

**Interfaces:**
- Consumes: `ProjectCatalog.getLayouts()`, `ProjectCatalog.load()` with layoutName
- Produces: `GET /api/layouts`, `GET /api/project?layout=<name>`, `GET /api/schemes/compare?other=<archiveId>`

- [ ] Add `getConfigRegistry` to `ApiDeps` (if not already there) and new routes:

```ts
// In createApiRouter, after existing routes:

router.get('/layouts', (_req, res) => {
  res.json({ layouts: ProjectCatalog.getLayouts('.') });
});

// Modify existing GET /project to accept layout param:
router.get('/project', (req, res) => {
  const layoutName = req.query.layout as string | undefined;
  const projectCatalog = layoutName
    ? ProjectCatalog.load('.', layoutName)
    : deps.catalog;
  res.json({
    house: {
      rooms: projectCatalog.getRooms(),
      platform: projectCatalog.getPlatform(),
      furnishings: projectCatalog.getFurnishings(),
      electrical: projectCatalog.getElectricalMarkers(),
      layoutSource: projectCatalog.getLayoutSource(),
    },
    topics: projectCatalog.getTopics().map((t) => ({
      id: t.id, name: t.name, perRoom: t.perRoom, optionCount: t.options.length,
    })),
    budgetCategories: projectCatalog.getBudgetCategories(),
  });
});

router.get('/schemes/compare', (req, res) => {
  const archiveId = req.query.other as string;
  if (!archiveId) {
    res.status(400).json({ error: 'query param "other" (archiveId) required' });
    return;
  }
  const archived = archiveStore.get(archiveId);
  if (!archived) {
    res.status(404).json({ error: 'archived scheme not found' });
    return;
  }
  const current = state.getCurrentScheme();
  const currentBudget = deps.getBudgetCalculator().calculate(current);
  const currentRisks = deps.getRuleEngine().evaluate(current, deps.catalog);
  const compareBudget = deps.getBudgetCalculator().calculate(archived);
  const compareRisks = deps.getRuleEngine().evaluate(archived, deps.catalog);

  const allTopics = new Set([
    ...Object.keys(current.selections),
    ...Object.keys(archived.selections),
  ]);

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
    const curOpt = curOptId ? deps.catalog.getOption(topic, curOptId) : null;
    const cmpOpt = cmpOptId ? deps.catalog.getOption(topic, cmpOptId) : null;
    selectionDiffs.push({
      topic,
      current: curOpt?.name ?? curOptId,
      compare: cmpOpt?.name ?? cmpOptId,
      priceDelta: (cmpOpt?.price_per_unit ?? 0) - (curOpt?.price_per_unit ?? 0),
    });
  }

  const currentRiskIds = new Set(currentRisks.risks.map((r) => r.id));
  const compareRiskIds = new Set(compareRisks.risks.map((r) => r.id));

  res.json({
    current: { scheme: current, budget: currentBudget, risks: currentRisks },
    compare: { scheme: archived, budget: compareBudget, risks: compareRisks },
    diff: {
      budget: compareBudget.totalActual - currentBudget.totalActual,
      selections: selectionDiffs,
      risks: {
        added: compareRisks.risks.filter((r) => !currentRiskIds.has(r.id)).map((r) => ({ id: r.id, severity: r.severity })),
        removed: currentRisks.risks.filter((r) => !compareRiskIds.has(r.id)).map((r) => ({ id: r.id, severity: r.severity })),
      },
    },
  });
});
```

- [ ] Run: `npx tsx --test tests/server/index.test.ts` — verify server startup and existing routes
- [ ] Run: `npx tsx --test tests/server/design-state.test.ts` — verify
- [ ] Commit: `git add server/routes.ts && git commit -m "feat: layouts list, layout param, compare endpoint"`

---

### Task 9: DesignState — compare slot + MCP compare tool

**Files:**
- Modify: `server/design-state.ts`

**Interfaces:**
- Consumes: `ArchivedSchemesStore.get()`, `CurrentScheme`
- Produces: `setCompareArchive()`, `clearCompare()`, `getCompareScheme()`

- [ ] Add compare fields and methods to `DesignState` class:

```ts
export class DesignState {
  private scheme: CurrentScheme;
  private decisionLog: DecisionLogEntry[];
  private visualCommands: VisualCommand[] = [];
  private viewContext: ViewContext | null = null;
  private compareArchiveId: string | null = null;
  private compareScheme: CurrentScheme | null = null;

  // ... existing code ...

  setCompareArchive(archiveId: string, archivedScheme: CurrentScheme): void {
    this.compareArchiveId = archiveId;
    this.compareScheme = archivedScheme;
  }

  clearCompare(): void {
    this.compareArchiveId = null;
    this.compareScheme = null;
  }

  getCompareArchiveId(): string | null {
    return this.compareArchiveId;
  }

  getCompareScheme(): CurrentScheme | null {
    return this.compareScheme;
  }
}
```

- [ ] Commit: `git add server/design-state.ts && git commit -m "feat: compare scheme slot in DesignState"`

---

### Task 10: MCP server — compare_schemes tool

**Files:**
- Modify: `server/mcp-server.ts`

**Interfaces:**
- Consumes: `archiveStore.get()`, `state.getCurrentScheme()`, `getBudgetCalculator()`, `getRuleEngine()`
- Produces: `compare_schemes` MCP tool

- [ ] Add `compare_schemes` tool after the `archive_scheme` tool:

```ts
server.registerTool(
  'compare_schemes',
  {
    title: 'Compare schemes',
    description: 'Compare current scheme against an archived scheme. Returns budget diff, selection diffs, and risk changes.',
    inputSchema: z.object({ archiveId: z.string() }),
  },
  async (args) => {
    const archived = archiveStore.get(args.archiveId);
    if (!archived) return text({ error: 'archived scheme not found' });

    const current = state.getCurrentScheme();
    const currentBudget = getBudgetCalculator().calculate(current);
    const currentRisks = getRuleEngine().evaluate(current, catalog);
    const compareBudget = getBudgetCalculator().calculate({
      ...archived,
      // Create a CurrentScheme-compatible object
      updatedAt: archived.createdAt,
    } as CurrentScheme);
    const compareRisks = getRuleEngine().evaluate(
      { ...archived, updatedAt: archived.createdAt } as CurrentScheme, catalog
    );

    const allTopics = new Set([
      ...Object.keys(current.selections),
      ...Object.keys(archived.selections),
    ]);

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
        priceDelta: (cmpOpt?.price_per_unit ?? 0) - (curOpt?.price_per_unit ?? 0),
      });
    }

    const currentRiskIds = new Set(currentRisks.risks.map((r) => r.id));
    const compareRiskIds = new Set(compareRisks.risks.map((r) => r.id));

    return text({
      current: { scheme: current, budget: currentBudget, risks: currentRisks },
      compare: { scheme: archived, budget: compareBudget, risks: compareRisks },
      diff: {
        budget: compareBudget.totalActual - currentBudget.totalActual,
        selections: selectionDiffs,
        risks: {
          added: compareRisks.risks.filter((r) => !currentRiskIds.has(r.id)),
          removed: currentRisks.risks.filter((r) => !compareRiskIds.has(r.id)),
        },
      },
    });
  }
);
```

- [ ] Run: `npx tsx --test tests/server/mcp.test.ts` — verify all MCP tools still work
- [ ] Commit: `git add server/mcp-server.ts && git commit -m "feat: compare_schemes MCP tool"`

---

### Task 11: TextureFactory — procedural texture generators

**Files:**
- Create: `app/src/render/TextureFactory.ts`

**Interfaces:**
- Produces: `createMaterialTexture(appearance)`, `woodGrainTexture(ctx, w, h)`, `ceramicTileTexture(ctx, w, h)`, `mattePaintTexture(ctx, w, h)`

- [ ] Create file:

```ts
import * as THREE from 'three';

export interface MaterialAppearance {
  type: string;
  color: string;
  textureUrl?: string;
}

export function createMaterialTexture(appearance: MaterialAppearance): THREE.CanvasTexture | THREE.Texture {
  if (appearance.textureUrl) {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(appearance.textureUrl);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  switch (appearance.type) {
    case 'wood_grain':
      drawWoodGrain(ctx, 512, 512, appearance.color);
      break;
    case 'ceramic_tile':
      drawCeramicTile(ctx, 512, 512, appearance.color);
      break;
    case 'matte_paint':
      drawMattePaint(ctx, 512, 512, appearance.color);
      break;
    default:
      ctx.fillStyle = appearance.color;
      ctx.fillRect(0, 0, 512, 512);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawWoodGrain(ctx: CanvasRenderingContext2D, w: number, h: number, baseColor: string): void {
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, w, h);

  // Grain lines
  for (let y = 0; y < h; y += 8 + Math.random() * 24) {
    const alpha = 0.05 + Math.random() * 0.1;
    ctx.strokeStyle = `rgba(80, 50, 20, ${alpha})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x < w; x += 20) {
      const yOff = Math.sin(x * 0.02 + y * 0.1) * 3 + (Math.random() - 0.5) * 2;
      ctx.lineTo(x, y + yOff);
    }
    ctx.stroke();
  }
}

function drawCeramicTile(ctx: CanvasRenderingContext2D, w: number, h: number, baseColor: string): void {
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, w, h);

  const tileSize = 128;
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 2;

  for (let x = 0; x <= w; x += tileSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += tileSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawMattePaint(ctx: CanvasRenderingContext2D, w: number, h: number, baseColor: string): void {
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 16;
    data[i] = Math.min(255, Math.max(0, data[i] + noise));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
  }
  ctx.putImageData(imageData, 0, 0);
}
```

- [ ] Create test file `app/src/render/TextureFactory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMaterialTexture } from './TextureFactory.ts';

describe('TextureFactory', () => {
  it('creates a CanvasTexture for wood_grain appearance', () => {
    const tex = createMaterialTexture({ type: 'wood_grain', color: '#c49a6c' });
    expect(tex).toBeDefined();
  });

  it('creates a CanvasTexture for ceramic_tile appearance', () => {
    const tex = createMaterialTexture({ type: 'ceramic_tile', color: '#f5f5f5' });
    expect(tex).toBeDefined();
  });

  it('creates a CanvasTexture for matte_paint appearance', () => {
    const tex = createMaterialTexture({ type: 'matte_paint', color: '#f7f5ef' });
    expect(tex).toBeDefined();
  });

  it('falls back to solid fill for unknown type', () => {
    const tex = createMaterialTexture({ type: 'unknown', color: '#ff0000' });
    expect(tex).toBeDefined();
  });
});
```

- [ ] Run: `npx vitest run app/src/render/TextureFactory.test.ts`
- [ ] Commit: `git add app/src/render/TextureFactory.ts app/src/render/TextureFactory.test.ts && git commit -m "feat: TextureFactory with procedural wood/tile/paint textures"`

---

### Task 12: FurnitureFactory — BoxGeometry furniture assembly

**Files:**
- Create: `app/src/render/FurnitureFactory.ts`

**Interfaces:**
- Produces: `createFurniture(type, w, d, h)` returning `THREE.Group`, `placeFurnishings(scene, furnishings, roomLayouts)`

- [ ] Create file:

```ts
import * as THREE from 'three';
import type { RoomLayout } from '@shared/types';

export function createFurniture(type: string): THREE.Group | null {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6 });

  switch (type) {
    case 'bed_180': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 2.0), mat);
      base.position.y = 0.2;
      group.add(base);
      const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.1), mat);
      headboard.position.set(0, 0.5, -0.95);
      group.add(headboard);
      return group;
    }
    case 'wardrobe_240': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.7, 0.6), mat);
      body.position.y = 1.35;
      group.add(body);
      return group;
    }
    case 'sofa_3seat': {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.4, 0.9), mat);
      seat.position.y = 0.2;
      group.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.5, 0.15), mat);
      back.position.set(0, 0.55, -0.38);
      group.add(back);
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.9), mat);
      armL.position.set(-1.4, 0.4, 0);
      group.add(armL);
      const armR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.9), mat);
      armR.position.set(1.4, 0.4, 0);
      group.add(armR);
      return group;
    }
    case 'dining_table': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.8), mat);
      top.position.y = 0.75;
      group.add(top);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.8 });
      for (const [lx, lz] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.73, 0.04), legMat);
        leg.position.set(lx, 0.365, lz);
        group.add(leg);
      }
      return group;
    }
    case 'dining_chair': {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.45), mat);
      seat.position.y = 0.45;
      group.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.04), mat);
      back.position.set(0, 0.65, -0.2);
      group.add(back);
      return group;
    }
    case 'tv_stand': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.4), mat);
      body.position.y = 0.2;
      group.add(body);
      return group;
    }
    case 'desk': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.6), mat);
      top.position.y = 0.75;
      group.add(top);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.8 });
      for (const [lx, lz] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.735, 0.03), legMat);
        leg.position.set(lx, 0.368, lz);
        group.add(leg);
      }
      return group;
    }
    default:
      return null;
  }
}

export interface FurnishingItems {
  [roomId: string]: Record<string, number>;
}

export function placeFurnishings(
  scene: THREE.Scene,
  furnishings: FurnishingItems,
  rooms: Record<string, RoomLayout>
): void {
  for (const [roomId, items] of Object.entries(furnishings)) {
    const room = rooms[roomId];
    if (!room) continue;

    for (const [type, count] of Object.entries(items)) {
      if (!count || count <= 0) continue;
      if (['ceiling_light', 'curtain_set', 'switch', 'power_outlet', 'network',
           'sink', 'toilet', 'shower_set', 'vanity', 'faucet', 'exhaust_fan',
           'range_hood', 'gas_stove', 'shoe_cabinet', 'cabinet_base', 'cabinet_wall',
           'countertop_quartz', 'desk', 'chair', 'bookshelf'].includes(type)) continue;

      const model = createFurniture(type);
      if (!model) continue;

      model.position.set(room.x, 0, room.z);
      model.userData = { objectId: `furniture:${roomId}:${type}`, hoverable: false, type: 'furniture' };
      scene.add(model);
    }
  }
}
```

- [ ] Run: Visual verification by starting dev server and checking that furniture appears
- [ ] Commit: `git add app/src/render/FurnitureFactory.ts && git commit -m "feat: FurnitureFactory with BoxGeometry furniture assembly"`

---

### Task 13: designData — texture-backed material integration

**Files:**
- Modify: `app/src/data/designData.ts`

**Interfaces:**
- Consumes: `TextureFactory.createMaterialTexture()`, `MaterialItem.appearance` from materials.yaml
- Produces: `floorOptions`, `wallOptions`, `paintOptions` with `color` derived from textures

- [ ] Replace hardcoded color maps with appearance-driven textures:

```ts
import { load } from 'js-yaml';
import type { MaterialItem, MaterialsYaml, TopicOption } from '@shared/types';
import { createMaterialTexture } from '../render/TextureFactory';
import materialsRaw from '../../../config/materials.yaml?raw';

const materialsData = load(materialsRaw) as MaterialsYaml;

function byCategory(category: string): TopicOption[] {
  return materialsData.materials
    .filter((m: MaterialItem) => m.category === category)
    .map((m: MaterialItem) => ({
      id: m.id,
      name: m.name,
      description: `${m.brand} ${m.model} · ${m.price_per_unit} 元/${m.unit}`,
      price: m.price_per_unit,
      pros: m.pros ?? [],
      cons: m.cons ?? [],
      data: m,
    }));
}

function ensureAppearance(options: TopicOption[]): TopicOption[] {
  return options.map((opt) => {
    if (opt.color) return opt;
    const m = opt.data as MaterialItem | undefined;
    if (m?.appearance) {
      const tex = createMaterialTexture(m.appearance);
      return { ...opt, color: '#' + tex.image ? 'texture' : m.appearance.color, data: { ...m, texture: tex } };
    }
    return { ...opt, color: '#cccccc' };
  });
}

export const floorOptions = ensureAppearance(byCategory('地砖'));
export const wallOptions = ensureAppearance(byCategory('墙砖'));
export const paintOptions = ensureAppearance(byCategory('乳胶漆'));

export const materialCategories: Record<string, TopicOption[]> = {
  floor: floorOptions,
  wall: wallOptions,
  paint: paintOptions,
};

export function getMaterialOptions(): Record<string, TopicOption[]> {
  return materialCategories;
}
```

- [ ] Run: `npx vitest run app/src/data/objectMapping.test.ts`
- [ ] Commit: `git add app/src/data/designData.ts && git commit -m "feat: texture-backed material options in designData"`

---

### Task 14: HouseScene — textures, furniture, markers, compare toggle

**Files:**
- Modify: `app/src/render/HouseScene.ts`

**Interfaces:**
- Consumes: `TextureFactory`, `FurnitureFactory.placeFurnishings()`, `MaterialItem.appearance`, `FurnishingsYaml`, `ElectricalMarker[]`
- Produces: Textured floors/walls, furniture placed, electrical markers, `applyCompareScheme()` toggle method

- [ ] Update `createRoom()` to use textures for floor and walls. Read appearance from material data via `TopicRegistry`:

```ts
// In createRoom, replace solid color floor:
const floorMat = new THREE.MeshStandardMaterial({
  color: DEFAULT_FLOOR,
  roughness: 0.75,
  metalness: 0.05,
});
// If a topic has an applied option with texture data, use it later via applyScheme

// Walls similarly
```

- [ ] Add `placeFurnishings()` call in `buildFromCatalog()`:

```ts
async buildFromCatalog(projectData: ProjectData): Promise<void> {
  // ... existing room/platform creation ...

  if (projectData.house.furnishings) {
    placeFurnishings(this.scene, projectData.house.furnishings as Record<string, Record<string, number>>, this.rooms);
  }

  if (projectData.house.electrical) {
    this.placeElectricalMarkers(projectData.house.electrical as ElectricalMarker[]);
  }
}
```

- [ ] Add `placeElectricalMarkers()` method:

```ts
private placeElectricalMarkers(markers: ElectricalMarker[]): void {
  const colorMap: Record<string, number> = {
    switch: 0xffffff,
    outlet: 0xaaaaaa,
    network: 0x4488ff,
    curtain_power: 0xaa44ff,
  };
  for (const m of markers) {
    const room = this.rooms[m.roomId];
    if (!room) continue;
    const geo = new THREE.BoxGeometry(0.08, 0.08, 0.02);
    const mat = new THREE.MeshBasicMaterial({ color: colorMap[m.type] ?? 0xffffff });
    const cube = new THREE.Mesh(geo, mat);
    cube.userData = { objectId: `electrical:${m.roomId}:${m.type}`, hoverable: false, type: 'electrical' };
    const dirVectors: Record<string, [number, number]> = {
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    };
    const [dx, dz] = dirVectors[m.wall] ?? [0, 0];
    cube.position.set(
      room.x + m.offset,
      m.height,
      room.z + dz * (room.depth / 2 + 0.01)
    );
    if (dx !== 0) {
      cube.position.set(
        room.x + dx * (room.width / 2 + 0.01),
        m.height,
        room.z + m.offset
      );
    }
    this.scene.add(cube);
  }
}
```

- [ ] Add `applySchemeTextures()` and `applyCompareScheme()`:

```ts
applySchemeTextures(topicId: string, optionId: string): void {
  const topic = this.topicRegistry.get(topicId);
  if (!topic) return;
  const option = topic.options.find((o) => o.id === optionId);
  if (!option) return;
  const data = (option.data as Record<string, unknown> | undefined);
  const appearance = data?.appearance as { type: string; color: string } | undefined;
  if (!appearance) return;

  const tex = createMaterialTexture(appearance);
  tex.repeat.set(2, 2);

  if (topicId === 'floor') {
    for (const mesh of this.floorMeshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.map = tex;
      mat.color.set(appearance.color);
      mat.needsUpdate = true;
    }
  } else if (topicId === 'wall' || topicId === 'paint') {
    for (const mesh of this.wallMeshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.map = tex;
      mat.color.set(appearance.color);
      mat.needsUpdate = true;
    }
  }
}

private compareSchemeData?: CurrentScheme;

setCompareScheme(scheme: CurrentScheme): void {
  this.compareSchemeData = scheme;
}

applyCompareScheme(): void {
  if (!this.compareSchemeData) return;
  for (const [topicId, selection] of Object.entries(this.compareSchemeData.selections)) {
    const effective = selection.default;
    if (effective) {
      this.applySchemeTextures(topicId, effective);
    }
  }
}
```

- [ ] Run: `npx vitest run app/src/scene/HouseScene.test.ts`
- [ ] Commit: `git add app/src/render/HouseScene.ts && git commit -m "feat: textures, furniture, electrical markers, compare toggle in HouseScene"`

---

### Task 15: SchemePanel — comparison mode UI

**Files:**
- Modify: `app/src/ui/SchemePanel.ts`

**Interfaces:**
- Consumes: `SchemeDiff`, `ArchivedScheme` list
- Produces: Three-column comparison mode when archive is selected for compare

- [ ] Add comparison mode methods to `SchemePanel`:

```ts
export class SchemePanel {
  // ... existing fields ...
  private compareActive = false;
  private compareArchiveName = '';

  // Add to constructor:
  // private comparePanel: HTMLDivElement;

  initCompare(archiveName: string, diff: SchemeDiff): void {
    this.compareActive = true;
    this.compareArchiveName = archiveName;
    this.renderCompare(diff);
  }

  clearCompare(): void {
    this.compareActive = false;
    this.compareArchiveName = '';
    // Hide compare panel
  }

  private renderCompare(diff: SchemeDiff): void {
    // Build three-column HTML:
    // Column 1: Current selections
    // Column 2: Compare selections
    // Column 3: Delta (price +/- red/green)
    // Show budget diff at top
    // Show risk additions/removals
    const html = `
      <div class="compare-header">
        <span>当前方案</span>
        <span>vs</span>
        <span>${this.compareArchiveName}</span>
      </div>
      <div class="compare-budget">
        预算差异: ${diff.budget > 0 ? '+' + diff.budget : diff.budget} 元
      </div>
      <div class="compare-rows">
        ${diff.selections.map((s) => `
          <div class="compare-row">
            <span>${s.current ?? '—'}</span>
            <span>${s.compare ?? '—'}</span>
            <span class="${s.priceDelta > 0 ? 'up' : 'down'}">${s.priceDelta > 0 ? '+' : ''}${s.priceDelta} 元</span>
          </div>
        `).join('')}
      </div>
    `;
    // Set HTML into compare panel element
  }
}
```

- [ ] Run: `npx vitest run app/src/ui/SchemePanel.test.ts`
- [ ] Commit: `git add app/src/ui/SchemePanel.ts && git commit -m "feat: scheme comparison mode in SchemePanel"`

---

### Task 16: OverviewMenu — layout selector dropdown

**Files:**
- Modify: `app/src/ui/OverviewMenu.ts`

**Interfaces:**
- Consumes: `LayoutOption[]` from `GET /api/layouts`
- Produces: Layout dropdown, `onLayoutChange` callback

- [ ] Add layout selector:

```ts
export interface OverviewMenuOptions {
  onArchive: (name: string, reason?: string) => void;
  onRestore: (id: string) => void;
  onDeleteArchive: (id: string) => void;
  onLayoutChange?: (layoutName: string) => void;
  onCompare?: (archiveId: string) => void;
  onClearCompare?: () => void;
}

export class OverviewMenu {
  // ... existing fields ...
  private layoutSelect: HTMLSelectElement | null;

  constructor(options: OverviewMenuOptions) {
    // ... existing init ...
    this.layoutSelect = document.getElementById('layout-select') as HTMLSelectElement | null;
    if (this.layoutSelect) {
      this.layoutSelect.addEventListener('change', () => {
        options.onLayoutChange?.(this.layoutSelect!.value);
      });
    }
  }

  setLayouts(layouts: Array<{ name: string; path: string }>): void {
    if (!this.layoutSelect) return;
    this.layoutSelect.innerHTML = layouts.map((l) => `<option value="${l.name}">${l.name}</option>`).join('');
  }

  setActiveLayout(name: string): void {
    if (!this.layoutSelect) return;
    this.layoutSelect.value = name;
  }
}
```

- [ ] Have HTML template include `<select id="layout-select">` element
- [ ] Commit: `git add app/src/ui/OverviewMenu.ts && git commit -m "feat: layout selector in OverviewMenu"`

---

### Task 17: App.ts — layout switching, compare toggle, new data fetching

**Files:**
- Modify: `app/src/App.ts`

**Interfaces:**
- Consumes: `GET /api/layouts`, `GET /api/project?layout=<name>`, `GET /api/schemes/compare?other=<archiveId>`, `SchemePanel.compare`, `OverviewMenu.layout`, `HouseScene.applyCompareScheme`
- Produces: Layout switching with scene rebuild, Tab key compare toggle

- [ ] Add layout loading in `start()`:

```ts
async start(): Promise<void> {
  const response = await fetch('/api/project');
  this.projectData = await response.json();
  // ... existing setup ...

  // Load available layouts
  try {
    const layoutsRes = await fetch('/api/layouts');
    const layoutsData = await layoutsRes.json();
    this.overviewMenu.setLayouts(layoutsData.layouts);
    this.overviewMenu.setActiveLayout(this.projectData.house.layoutSource ?? 'cad-extracted');
  } catch (e) {
    // layouts not critical
  }
}
```

- [ ] Add layout change handler:

```ts
this.overviewMenu = new OverviewMenu({
  // ... existing options ...
  onLayoutChange: (layoutName) => void this.handleLayoutChange(layoutName),
  onCompare: (archiveId) => void this.handleCompare(archiveId),
  onClearCompare: () => this.handleClearCompare(),
});

private async handleLayoutChange(layoutName: string): Promise<void> {
  const response = await fetch(`/api/project?layout=${layoutName}`);
  this.projectData = await response.json();
  this.collision.setRooms(this.projectData?.house?.rooms ?? []);
  await this.houseScene.buildFromCatalog(this.projectData);
  const scheme = this.stateSync.fetchScheme();
  if (scheme) this.applyScheme(await scheme);
}
```

- [ ] Add compare handler and Tab toggle:

```ts
private compareActive = false;

private async handleCompare(archiveId: string): Promise<void> {
  const response = await fetch(`/api/schemes/compare?other=${archiveId}`);
  const data = await response.json();
  this.schemePanel.initCompare(archiveId, data.diff);
  this.houseScene.setCompareScheme(data.compare.scheme);
  this.compareActive = true;
}

private handleClearCompare(): void {
  this.schemePanel.clearCompare();
  this.compareActive = false;
  // Re-apply current scheme to reset 3D scene
  this.stateSync.fetchScheme().then((s) => { if (s) this.applyScheme(s); });
}

// In setupKeyboard, add Tab handler:
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.code === 'Tab' && this.compareActive) {
    e.preventDefault();
    this.houseScene.applyCompareScheme();
    setTimeout(() => {
      this.stateSync.fetchScheme().then((s) => { if (s) this.applyScheme(s); });
    }, 0); // toggle: Tab press toggles, next Tab reverts
  }
  // ... existing key handlers ...
});
```

- [ ] Commit: `git add app/src/App.ts && git commit -m "feat: layout switching, compare toggle in App"`

---

### Task 18: parse_cad.py — geometry unlock + --output flag

**Files:**
- Modify: `scripts/parse_cad.py`

**Interfaces:**
- Consumes: DXF file, previous YAML
- Produces: New YAML with CAD geometry as authoritative source. `--output` flag for custom path. `geometry_changes` in extraction report.

- [ ] In `merge_with_previous_layout()`, change the merge logic from "preserve old geometry" to "CAD geometry wins":

```python
# Change lines 393-408:
    for r in rooms:
        prev_room = prev_by_id.get(r.id)
        if prev_room:
            # CAD geometry is authoritative for labeled rooms.
            # Only carry over unlabeled rooms below.
            merged.append(r)
        else:
            merged.append(r)
```

- [ ] Add geometry change logging in `write_layout_yaml()`:

```python
def write_layout_yaml(rooms, platform, output_path, dxf_source, prev_yaml_path=None):
    # ... existing code ...
    geometry_changes = []
    if prev_yaml_path and Path(prev_yaml_path).exists():
        with open(prev_yaml_path, "r") as f:
            prev = yaml.safe_load(f)
        prev_by_id = {r.get("id"): r for r in prev.get("rooms", []) if r.get("id")}
        for r in rooms:
            prev_room = prev_by_id.get(r.id)
            if prev_room:
                for field in ["x", "z", "width", "depth"]:
                    old_val = prev_room.get(field)
                    new_val = getattr(r, field)
                    if old_val != new_val:
                        geometry_changes.append({
                            "room_id": r.id,
                            "field": field,
                            "old": old_val,
                            "new": new_val,
                        })
    # ... write YAML ...
    # Add geometry_changes to report
    report = { ..., "geometry_changes": geometry_changes }
```

- [ ] Add `--output` flag support (`argparse`):

```python
parser.add_argument("--output", type=str, default=None,
                    help="Write layout YAML to custom path (default: config/layout/cad-extracted.yaml)")
```

- [ ] Update `write_layout_yaml` call to use `args.output` or default

- [ ] Update `parse_cad_test.py` — add test for geometry propagation (CAD changes must appear in output):

```python
def test_cad_geometry_is_authoritative():
    """CAD-extracted geometry must be used, not overwritten by previous YAML."""
    rooms = [Room(id="master_bedroom", name="主卧", x=-5.5, z=2.0, width=4.6, depth=4.0, height=3.0)]
    platform = Platform(id="west_platform", name="西设备平台", x=-8.5, z=2.0, width=1.6, depth=1.55, height=3.0)
    merged, _ = merge_with_previous_layout(rooms, platform, PREV_OUTPUT)  # uses existing prev fixture
    mb = next((r for r in merged if r.id == "master_bedroom"), None)
    assert mb is not None
    assert mb.x == -5.5  # CAD value, not previous YAML value
    assert mb.width == 4.6

def test_output_flag(tmp_path):
    """--output flag writes to custom path."""
    # Test that parser accepts --output and writes to the specified path
    # (integration test)
```

- [ ] Run: `python -m pytest scripts/parse_cad_test.py -v`
- [ ] Commit: `git add scripts/parse_cad.py scripts/parse_cad_test.py && git commit -m "fix(cad): CAD geometry is authoritative, add --output flag and change logging"`

---

### Task 19: Update all test files for type and interface changes

**Files:**
- Modify: `tests/server/project-catalog.test.ts`, `tests/server/rule-engine.test.ts`, `tests/server/design-state.test.ts`, `app/src/scene/HouseScene.test.ts`, `app/src/topics/TopicRegistry.test.ts`, `app/src/ui/SchemePanel.test.ts`

**Interfaces:**
- Consumes: All changed type definitions from Task 1
- Produces: All tests passing with updated fixtures and assertions

- [ ] Fix any type errors in test files caused by Task 1-18 changes
- [ ] Update `project-catalog.test.ts` layout fixture to use `unit: m` (was `unit: mm`)
- [ ] Add rule engine tests for new risk/constraint rules
- [ ] Add design-state test for `setCompareArchive`/`clearCompare`
- [ ] Add HouseScene test for `placeElectricalMarkers` (verify markers created)
- [ ] Run: `npx tsx --test tests/server/**/*.test.ts` — all server tests pass
- [ ] Run: `npx vitest run` — all app tests pass
- [ ] Commit: `git add tests/ app/src/scene/HouseScene.test.ts app/src/topics/TopicRegistry.test.ts app/src/ui/SchemePanel.test.ts && git commit -m "test: update all tests for tradeoff system changes"`

---

### Task 20: Final verification — full test suite + typecheck

- [ ] Run: `python -m pytest scripts/parse_cad_test.py -v`
- [ ] Run: `npx tsx --test tests/server/**/*.test.ts`
- [ ] Run: `npx vitest run`
- [ ] Run: `npm run typecheck`
- [ ] Start dev server and app, verify: material options show alternatives with pros/cons, budget updates with labor, rules fire on selection, 3D shows textures/furniture/markers, Tab toggles compare scheme, layout dropdown switches scene
- [ ] Fix any failures
- [ ] Commit any remaining changes
