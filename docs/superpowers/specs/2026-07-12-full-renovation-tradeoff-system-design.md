# Design: Full Renovation Tradeoff System

## 1. Background

The current system has a solid data pipeline (DXF → cad-extracted.yaml → server → 3D scene) and complete object-first interaction, but it cannot function as a practical renovation decision tool because:

1. **Thin material library** — each category has only 1 option in `materials.yaml`, despite `docs/material_selection_log.md` containing 15 categories × 3 candidates of researched pricing data.
2. **Empty rule engine** — `design-rules.yaml` has `risks: []` and `constraints: []`, while `docs/designer_brief.md` lists concrete constraints (open kitchen needs ≥22m³/min hood, load-bearing walls, platform width limits).
3. **Schematic rendering** — walls/floors are flat colored boxes with no textures, furniture, or spatial markers.
4. **Partial budget** — only 4/17 categories auto-calculate; labor costs and soft furnishings are not modeled.
5. **No comparison** — schemes can be archived/restored but cannot be compared side-by-side; layout-level tradeoffs (different floor plans) are not supported.
6. **CAD geometry drift protection** — the merge logic preserves previous YAML geometry over new CAD extraction, blocking CAD updates.

## 2. Goal

Transform the system from a "scheme management tool" into a **renovation tradeoff decision tool** — with real material options, automated risk checking, visual preview, complete budget calculation, and cross-scheme/layout comparison.

## 3. Scope

### In scope

1. **Material library expansion** — import all researched candidates from `material_selection_log.md` into `materials.yaml` with structured grouping, pros/cons, price sources.
2. **Rule engine activation** — encode designer brief constraints as `risks` and `constraints` in `design-rules.yaml`.
3. **3D rendering upgrade** — procedural textures, simplified furniture models, electrical/lighting markers.
4. **Full budget coverage** — auto-calculate all 17 categories including labor costs and soft furnishings.
5. **Tradeoff comparison** — side-by-side scheme diff, 3D scene toggle, layout-level CAD comparison.
6. **CAD geometry unlock** — replace the merge-lock with a diff-report-only approach so CAD changes propagate.

### Out of scope

- Photorealistic rendering or PBR texture authoring.
- Dragging/rotating furniture in 3D (furniture positions come from config).
- Multi-user or collaboration.
- Undo/redo for scheme changes.
- Automated CAD labeling (still requires human-drawn `SH-文字标注` layer).

---

## 4. Design

### 4.1 Material Library Expansion

**Data source:** `docs/material_selection_log.md` (499 lines, 15 categories, 3 candidates each with prices, brands, sources, pros/cons).

**`materials.yaml` schema additions:**

```yaml
materials:
  - id: "wall_tile_01"
    alternative_group: "wall_tile"       # NEW: group alternatives for UI grouping
    category: "墙砖"
    name: "厨卫白色釉面砖"
    brand: "东鹏"
    model: "300x600 白色釉面砖"
    spec: "300x600mm"
    unit: "片"
    price_per_unit: 12
    coverage_per_unit: 0.18
    loss_rate: 1.05
    calc_mode: "area"                    # NEW: area | length | count | fixed
    supplier: "快环建材市场 / 东鹏门店"
    status: "candidate"
    sample_acquired: false
    pros: ["亮面好擦洗", "价格低"]        # NEW
    cons: ["款式单一"]                    # NEW
    price_source: "东鹏门店报价"           # NEW
    notes: "厨房用亮面好擦洗"
```

**`shared/types.ts` additions to `MaterialItem`:**

```ts
interface MaterialItem {
  // ... existing fields
  alternative_group?: string;
  calc_mode?: 'area' | 'length' | 'count' | 'fixed';
  pros?: string[];
  cons?: string[];
  price_source?: string;
}
```

**UI impact:** `SchemePanel` groups options by `alternative_group`, showing up to 3 candidates per category with pros/cons and price comparison.

**Expected new entries:** ~30 from `material_selection_log.md` (15 categories × 2 new candidates), plus ~10 soft furnishing entries (beds, sofas, tables, chairs).

---

### 4.2 Rule Engine Activation

**Source constraints:** `docs/designer_brief.md`.

**`design-rules.yaml` extensions:**

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
      condition: "$option.outdoor_count > 1"
    message: "西平台仅宽 1.6m，{{hvac.name}} 多台外机可能放不下"

  - id: "stacked_splits_warning"
    severity: "medium"
    when:
      topic: "hvac"
      condition: "$option.id == 'E1'"
    message: "叠叠乐方案外机过多，散热、噪音、维修风险高，不建议"

  - id: "garden_outdoor_warning"
    severity: "medium"
    when:
      topic: "hvac"
      condition: "$option.id == 'F2'"
    message: "外机放入户花园存在噪音、热风及物业/消防风险"

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

  - id: "open_kitchen_range_hood_fields"
    when:
      topic: "kitchen"
      condition: "$selection.kitchen == 'open'"
    require:
      topic: "range_hood"
      fields: ["airflow", "type"]
    description: "开放式厨房需确认油烟机风量和类型"
```

Total: ~6 risk rules, ~2 constraint rules. All fit within the existing `rule-engine.ts` condition parser (no engine changes needed).

**MCP enhancement:** The `get_risks` and `run_design_check` tools return these evaluations. The `set_selection` tool can optionally run a pre-check and return warnings before applying.

---

### 4.3 3D Rendering Upgrade

**Architecture principle:** Procedural-first with GLTF/image fallback slots. Every visual asset supports both code-generated and file-based sources via a unified interface. Coding agents compose rather than create.

#### 4.3.1 Textures

```ts
// New file: app/src/render/TextureFactory.ts
interface MaterialAppearance {
  color: string;
  procedural?: (canvas: CanvasRenderingContext2D, w: number, h: number) => void;
  textureUrl?: string;
}

function createMaterialTexture(appearance: MaterialAppearance): THREE.CanvasTexture | THREE.Texture {
  if (appearance.textureUrl) {
    // Future: load from assets/textures/
    return new THREE.TextureLoader().load(appearance.textureUrl);
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  if (appearance.procedural) {
    appearance.procedural(ctx, 512, 512);
  } else {
    ctx.fillStyle = appearance.color;
    ctx.fillRect(0, 0, 512, 512);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
```

Built-in procedural generators:

| Type | Visual | Algorithm |
|---|---|---|
| `wood_grain` | Horizontal grain stripes, warm brown | Multi-pass line drawing with Perlin-like noise |
| `ceramic_tile` | Light base + grey grout grid | Rect grid with 2px line gaps |
| `matte_paint` | Subtle noise, off-white base | Randomized pixel noise at low opacity |

**Mapping:** `materials.yaml` gets `appearance: { type: "wood_grain", color: "#c49a6c" }`. `designData.ts` reads this instead of hardcoded hex maps.

#### 4.3.2 Furniture

```ts
// New file: app/src/render/FurnitureFactory.ts
interface FurnitureDef {
  roomId: string;
  type: string;
  position: { x: number; z: number };
  rotation?: number;  // Y-axis radians
  geometry?: () => THREE.Group;
  modelUrl?: string;   // Future: GLTF path
}
```

Built-in furniture types (all `BoxGeometry` composites):

| Type | Geometry | Dimensions | userData.objectId |
|---|---|---|---|
| `bed_180` | Base + headboard | 1.8×2.0×0.4 + 1.8×0.1×0.6 | `furniture:<room>:bed` |
| `wardrobe_240` | Tall box | 2.4×0.6×2.7 | `furniture:<room>:wardrobe` |
| `sofa_3seat` | Low box + armrests | 2.8×0.9×0.4 | `furniture:<room>:sofa` |
| `dining_table` | Top plate + 4 legs | 1.4×0.8×0.75 | `furniture:<room>:dining_table` |
| `desk` | Top plate + 4 legs | 1.2×0.6×0.75 | `furniture:<room>:desk` |
| `kitchen_cabinet_L` | L-shaped counter | from house.yaml | `furniture:<room>:cabinet` |
| `tv_stand` | Low wide box | 1.8×0.4×0.4 | `furniture:<room>:tv_stand` |

All furniture meshes get `userData: { hoverable: false }` — visual only, no raycast interaction.

**Data source:** `config/house.yaml` already has `furniture_concept` notes per room. Formalize into a `furnishings` section (see 4.4).

#### 4.3.3 Spatial Markers

```ts
// Switches and outlets
interface ElectricalMarker {
  roomId: string;
  type: 'switch' | 'outlet' | 'network' | 'curtain_power';
  wall: 'north' | 'south' | 'east' | 'west';
  height: number;      // distance from floor
  offset: number;      // horizontal offset from room center along wall
}
```

Default layout (derivable from room geometry, configurable per room):

| Marker | Height | Default placement |
|---|---|---|
| Light switch | 1.3m | Next to door, interior side |
| Power outlet | 0.3m | Every 3m along walls |
| Network port | 0.3m | Living room, study |
| Curtain power | 2.7m | Window wall, both sides |

Visual: Small colored cubes (white=switch, grey=outlet, blue=network, purple=curtain).

Lighting indicators: Semi-transparent yellow spheres at ceiling center per room.

#### 4.3.4 Render Pipeline Impact

`HouseScene.createRoom()` changes:
1. Floor: `MeshStandardMaterial` with `map` from `TextureFactory` instead of solid color.
2. Wall: Same, with texture.
3. After all rooms built: iterate `house.yaml.furnishings`, call `FurnitureFactory` to place furniture meshes.
4. After furniture: iterate `house.yaml.electrical` (auto-generated defaults), place marker cubes.

`HouseScene.buildFromCatalog()` gains a post-build step: `placeFurnishings(projectData.house)` and `placeElectricalMarkers(projectData.house)`.

---

### 4.4 Budget Full Coverage

#### 4.4.1 Calculation Modes

`BudgetCalculator` selects formula based on `calc_mode`:

| calc_mode | Formula | Quantity source |
|---|---|---|
| `area` | `price × area / coverage × loss` | Room geometry (width × depth) |
| `length` | `price × length` | Room geometry (perimeter or wall edge) |
| `count` | `price × count` | `house.yaml.furnishings` |
| `fixed` | `price` (one-time) | None |

#### 4.4.2 Labor Cost Model

Each budget category in `config/budget/base.json` gains optional `labor`:

```json
{
  "masonry": {
    "budget": 18500,
    "material": 0,
    "labor": { "rate": 45, "unit": "元/㎡", "area": "floor" },
    "actual": 0,
    "status": "draft"
  }
}
```

Labor formulas:

| Category | Rate | Area basis |
|---|---|---|
| demolition | fixed ~3000 | — |
| water_electric | fixed ~5000 | — |
| waterproof | ~20 元/㎡ | wet rooms floor area |
| masonry | ~45 元/㎡ | all rooms floor area |
| carpentry | ~40 元/㎡ | ceiling area (same as floor) |
| painting | ~25 元/㎡ | all rooms paint wall area |
| doors_windows | ~150 元/扇 | door count from furnishings |
| sanitary | ~200 元/件 | fixture count from furnishings |

`BudgetCalculator.computeLabor()` iterates categories, multiplies rate × area/count, adds to `actual`.

#### 4.4.3 Soft Furnishings

**`config/house.yaml` new `furnishings` section:**

```yaml
furnishings:
  master_bedroom:
    bed_180: 1
    wardrobe_240: 1
    curtain_set: 1
    ceiling_light: 1
    bedside_switch: 2
    power_outlet: 4
  living_dining:
    sofa_3seat: 1
    dining_table: 1
    dining_chair: 4
    tv_stand: 1
    curtain_set: 2
    ceiling_light: 2
    switch: 1
    power_outlet: 6
  # ... all rooms
  kitchen:
    cabinet_base: 3.5      # 延米 (linear meters)
    cabinet_wall: 2.0      # 延米
    countertop_quartz: 3.5 # 延米
    sink: 1
    range_hood: 1
    gas_stove: 1
    switch: 1
    power_outlet: 5
  master_bath:
    toilet: 1
    shower_set: 1
    vanity: 1
    faucet: 1
    ceiling_light: 1
    exhaust_fan: 1
    switch: 1
    power_outlet: 1
```

**New materials.yaml entries for soft furnishings (~10):**

| id | name | category | calc_mode | price |
|---|---|---|---|---|
| bed_180_01 | 1.8m 实木床 | 家具 | count | 2500 |
| sofa_3seat_01 | 三人位科技布沙发 | 家具 | count | 3200 |
| dining_table_01 | 1.4m 岩板餐桌 | 家具 | count | 1800 |
| dining_chair_01 | 餐椅 | 家具 | count | 300 |
| tv_stand_01 | 1.8m 电视柜 | 家具 | count | 1200 |
| mattress_180_01 | 1.8m 床垫 | 家具 | count | 2000 |

**`BudgetCalculator` soft furnishing integration:**

For `calc_mode: "count"` items, quantity comes from `house.yaml.furnishings.<room>.<furnish_type>`. The budget line item shows `roomId`, `optionId`, `quantity`, `unitPrice`, and `cost`.

#### 4.4.4 Category Mapping

**`design-rules.yaml` expanded `topicCategories` and `lineItems`:**

All materials from `materials.yaml` are mapped to budget categories. Service-only categories (demolition, water_electric fixing, property_fees, contingency) remain fixed-budget.

After expansion: 13/17 categories auto-calculate.

---

### 4.5 Scheme Comparison & Tradeoff

#### 4.5.1 Side-by-side Comparison

**New API endpoint:** `GET /api/schemes/compare?other=<archiveId>`

```json
{
  "current": { "scheme": { ... }, "budget": { ... }, "risks": [] },
  "compare": { "scheme": { ... }, "budget": { ... }, "risks": ["platform_tight"] },
  "diff": {
    "budget": -7000,
    "selections": [
      { "topic": "hvac", "current": "A1", "compare": "A2", "priceDelta": 1500 },
      { "topic": "floor", "current": "floor_tile_01", "compare": "floor_tile_02", "priceDelta": -3200 }
    ],
    "risks": {
      "added": [{ "id": "outdoor_unit_overflow", "severity": "high" }],
      "removed": []
    }
  }
}
```

**New MCP tool:** `compare_schemes(archiveId)` — returns the same diff for AI analysis.

**UI: SchemePanel comparison mode**

Three-column layout when a comparison is active:

```
 Current (A)  │  Compare (B)  │  Δ
 ─────────────┼───────────────┼─────────
 A1 格力 一拖五│ A2 美的 理想家 │ +1500 ↑
 浅胡桃木纹砖  │ 灰色柔光砖    │ -3200 ↓
 总预算 11.5万 │ 总预算 10.8万 │ -7000 ↓
 风险: 无      │ 风险: 1      │ ⚠️ 外机溢出
```

**`DesignState` dual-slot model:**

```ts
// server/design-state.ts additions
interface DesignState {
  // ... existing fields
  compareArchiveId?: string;
  compareScheme?: CurrentScheme;
}

setCompareArchive(archiveId: string): void;
clearCompare(): void;
```

#### 4.5.2 3D Scene Toggle

In comparison mode, pressing `Tab` toggles between current and compare schemes. `HouseScene.applyScheme()` runs instantly — no camera transition animation, just material swap. The UI shows which scheme is active in the 3D viewport.

#### 4.5.3 Layout-Level Tradeoff (CAD)

**Design:** `config/layout/` can contain multiple YAML files from different CAD sources:

```
config/layout/
├── cad-extracted.yaml              # Active layout (e.g., open kitchen)
├── cad-extracted-closed.yaml       # Alternative (closed kitchen)
├── cad-extracted-v2.yaml           # V2 design revision
```

**`parse_cad.py` support:** `--output <path>` flag to write to a specific YAML instead of the default.

**ConfigRegistry change:** Watch all `config/layout/*.yaml` files, expose a `getLayouts()` list.

**New API endpoint:** `GET /api/layouts` — returns available layout names and their room summaries.

**New API endpoint:** `GET /api/project?layout=<name>` — returns project data built from the specified layout.

**App LayoutSelector:** OverviewMenu gains a dropdown for active layout. Switching layout triggers `HouseScene.buildFromCatalog()` for the new geometry + `TopicRegistry.apply()` for the current scheme materials. The comparison diff shows structural differences (rooms added/removed, area changes) alongside material diffs.

**`compareSchemes` with layout:** Rooms are matched by `id` across layouts. When comparing two archived schemes created with different layouts, the diff includes a `structural` section showing rooms with differing geometry or rooms only present in one layout:

```json
{
  "structural": {
    "roomsAdded": [],
    "roomsRemoved": [],
    "areaDelta": {
      "living_dining": { "current": 25.7, "compare": 28.1, "delta": 2.4 }
    }
  }
}
```

---

### 4.6 CAD Geometry Unlock

**Current behavior:** `parse_cad.py:merge_with_previous_layout()` preserves previous YAML geometry for rooms that match by ID, only taking the CAD-provided name.

**New behavior:** Remove the geometry preservation logic. CAD extraction is the authoritative geometry source. The merge still carries over unlabeled rooms (gift areas, platform) from previous YAML, but for rooms found in both old and new: CAD geometry wins, old geometry is discarded.

**Safety mechanism:** The extraction report (`cad-extraction-report.json`) gains a `geometry_changes` section listing every room whose `x/z/width/depth` changed vs the previous run, with before/after values. The diff is computed and logged but does not block the update.

```python
# In write_layout_yaml:
geometry_changes = []
for new_room in rooms:
    prev = prev_by_id.get(new_room.id)
    if prev and (new_room.x != prev["x"] or new_room.z != prev["z"] 
                 or new_room.width != prev["width"] or new_room.depth != prev["depth"]):
        geometry_changes.append({
            "room_id": new_room.id,
            "field": "x",
            "old": prev["x"],
            "new": new_room.x,
        })
```

---

## 5. Data Flow (Updated)

```
┌──────────────────────────────────────────────────────────────────┐
│  CAD DXF                                                         │
│  cad/design/*/floor_plan_design_*.dxf                            │
└──────┬───────────────────────────────────────────────────────────┘
       │ parse_cad.py --output <path>
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Layout YAML(s)                                                  │
│  config/layout/cad-extracted.yaml  (active + alternatives)       │
└──────┬───────────────────────────────────────────────────────────┘
       │ ConfigRegistry watches all *.yaml
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Server: ProjectCatalog                                          │
│  ← house.yaml (metadata, furnishings, furniture positions)       │
│  ← materials.yaml (expanded: 40+ entries, calc_mode, pros/cons)  │
│  ← budget/base.json (17 categories + labor rates)                │
│  ← design-rules.yaml (6 risk rules, 2 constraint rules)          │
│  ← shared/houseData.ts (7 HVAC schemes)                          │
└──────┬───────────────────────────────────────────────────────────┘
       │ REST API + Remote MCP
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Browser App (Three.js)                                          │
│  HouseScene.buildFromCatalog()                                   │
│    → TextureFactory (procedural textures per material)           │
│    → FurnitureFactory (BoxGeometry composites per furnishings)   │
│    → Electrical markers (colored cubes per wall)                 │
│  SchemePanel (comparison mode: side-by-side + budget diff)       │
│  LayoutSelector (multiple layouts, full scene rebuild)           │
│  Tab key: toggle compare scheme in 3D viewport                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. File Changes Summary

### New files

| File | Purpose |
|---|---|
| `app/src/render/TextureFactory.ts` | Procedural texture generators + GLTF fallback |
| `app/src/render/FurnitureFactory.ts` | BoxGeometry furniture assembly + GLTF fallback |

### Modified files

| File | Changes |
|---|---|
| `config/materials.yaml` | +30 entries, new fields: `alternative_group`, `calc_mode`, `pros`, `cons`, `price_source`, `appearance` |
| `config/design-rules.yaml` | +6 risk rules, +2 constraint rules, expanded `topicCategories` and `lineItems` |
| `config/budget/base.json` | +`labor` rates per category |
| `config/house.yaml` | +`furnishings` section per room, `electrical` defaults |
| `shared/types.ts` | +`MaterialItem` fields, `FurnitureDef`, `ElectricalMarker`, `LayoutOption`, comparison types |
| `server/project-catalog.ts` | Support `layout` parameter, expose layouts list |
| `server/design-state.ts` | +`compareScheme` slot, `compareArchiveId` |
| `server/budget-calculator.ts` | +calc_mode dispatch, +labor computation, +furnishings integration |
| `server/routes.ts` | +`GET /api/layouts`, layout param on `/api/project`, +`GET /api/schemes/compare` |
| `server/mcp-server.ts` | +`compare_schemes` tool |
| `app/src/data/designData.ts` | Replace hardcoded colors with TextureFactory calls |
| `app/src/render/HouseScene.ts` | +textures, +furnishings build step, +electrical markers, +compare scheme toggle |
| `app/src/ui/SchemePanel.ts` | Comparison mode 3-column layout, Tab key binding |
| `app/src/ui/OverviewMenu.ts` | Layout selector dropdown |
| `app/src/App.ts` | Layout switching, compare toggle, new data fetching |
| `scripts/parse_cad.py` | Remove geometry preservation, add geometry change logging, `--output` flag |

### Test files

| File | Changes |
|---|---|
| `tests/server/project-catalog.test.ts` | Layout fixture update, multi-layout tests |
| `tests/server/budget-calculator.test.ts` | Labor calc tests, calc_mode tests |
| `tests/server/rule-engine.test.ts` | Risk and constraint rule tests |
| `tests/server/design-state.test.ts` | Compare scheme tests |
| `app/src/scene/HouseScene.test.ts` | Texture and furniture rendering tests |
| `app/src/ui/SchemePanel.test.ts` | Comparison mode UI tests |
| `app/src/topics/TopicRegistry.test.ts` | Texture-backed material tests |
| `scripts/parse_cad_test.py` | Geometry propagation test, --output flag test |

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Procedural textures look bad | Canvas-based, tunable parameters; textureUrl fallback available |
| Furniture positions from config are wrong | Default positions derived from room geometry; adjustable in house.yaml |
| CAD geometry unlock causes incorrect rooms | Geometry change report logged; previous YAML always git-tracked for rollback |
| Budget comparison shows misleading numbers | Labor + material + soft furnishing clearly separated in UI |
| Too many materials options overwhelm UI | `alternative_group` grouping collapses to 3-per-category in default view |
