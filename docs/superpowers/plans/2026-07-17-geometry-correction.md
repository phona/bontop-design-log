# Geometry Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the model-geometry.yaml and overlay.yaml to match the authoritative floor-plan coordinates (provided by user via Gemini analysis), fixing misplaced rooms (kitchen/living/entry_garden shifted 3.55m north), deleting the phantom south balcony, adding the north balcony, and adding the missing study bay window.

**Architecture:** Pure configuration changes to two YAML files plus one test update. No code logic changes. The 3D renderer (HouseScene.ts) reads these configs and will automatically reflect the new geometry. Coordinate transform: `model_x = X_mm / 1000`, `model_z = 9.80 - Y_mm / 1000` (origin at master bedroom SW corner, Y=south→north).

**Tech Stack:** YAML config, TypeScript verification scripts, node:test

## Global Constraints

- `config/layout/model-geometry.yaml` is the geometry authority; `config/layout/overlay.yaml` is the intent authority. Code only reads and executes (AGENTS.md).
- Coordinate system: Y-up (Three.js), +x=east, +z=south, -z=north. North is up in top-down view.
- Rooms use center coordinates (x, z = center; width, depth = total size).
- Walls use endpoint coordinates (x1,z1 → x2,z2).
- After ANY geometry change, run: `npx tsx scripts/verify-layout.ts`, `npx tsx scripts/validate-room-wall-alignment.ts`, `npm run test:server`, `npm run typecheck` (AGENTS.md).
- Left-side rooms (master_bath, bedroom_nw, master_bedroom, study, guest_bath) are already correct — DO NOT change them.
- South wall has a 150mm step: left side z=9.80, right side z=9.95.
- No south balcony exists — living room south wall is flush glass at z=9.95.
- Bay windows (bay_sill) protrude 1.1m: master (z→10.90), study (z→10.90), SE bedroom (z→11.05).
- The `balcony` room id is repurposed from south balcony to north balcony (matching house.yaml's `balcony` = 北阳台, 2.42m²).

---

### Task 1: Update model-geometry.yaml — Rooms and Platform

**Files:**
- Modify: `config/layout/model-geometry.yaml` (rooms section lines 10-100, platform section lines 101-109)

**Interfaces:**
- Produces: corrected room coordinates that walls (Task 2) and overlay (Task 3) must align with.

- [ ] **Step 1: Update the `notes` field (line 9)**

Replace the notes line with:

```yaml
notes: '701 左单元 U 型户型。以合同图/效果图为主源，DXF 仅参考面积。主卧/书房南缘齐平 z=10.90（飘窗凸 1.1m），客厅落地玻璃 z=9.95，东南次卧凸窗 z=11.05。北生活阳台（balcony）在厨房北侧 z=0~3.55，VRV 设备平台在公卫北侧。入户花园北墙 z=0.65。右侧动区南墙 z=9.95 比左侧 z=9.80 低 150mm。'
```

- [ ] **Step 2: Update kitchen room (lines 56-64)**

Change `z: 1.00` to `z: 4.55`:

```yaml
  - id: kitchen
    name: 厨房
    x: 9.00
    z: 4.55
    width: 3.60
    depth: 2.00
    height: 3.0
    area: 7.20
    perimeter: 11.2
```

- [ ] **Step 3: Update living_dining room (lines 65-73)**

Change `z: 5.00` to `z: 7.75` and `depth: 6.00` to `depth: 4.40`:

```yaml
  - id: living_dining
    name: 客餐厅
    x: 10.30
    z: 7.75
    width: 6.20
    depth: 4.40
    height: 3.0
    area: 27.28
    perimeter: 21.20
```

- [ ] **Step 4: Update bedroom_se room (lines 74-82)**

Change `z: 7.60` to `z: 7.75`:

```yaml
  - id: bedroom_se
    name: 东南次卧
    x: 14.90
    z: 7.75
    width: 3.00
    depth: 4.40
    height: 3.0
    area: 13.20
    perimeter: 14.8
```

- [ ] **Step 5: Replace balcony room (lines 83-91) — south balcony → north balcony**

Replace the entire balcony room entry:

```yaml
  - id: balcony
    name: 北生活阳台
    x: 9.00
    z: 1.775
    width: 3.60
    depth: 3.55
    height: 3.0
    area: 12.78
    perimeter: 14.3
```

- [ ] **Step 6: Update entry_garden room (lines 92-100)**

Change `z: -1.45` to `z: 2.10`:

```yaml
  - id: entry_garden
    name: 入户花园
    x: 13.025
    z: 2.10
    width: 4.45
    depth: 2.90
    height: 3.0
    area: 12.90
    perimeter: 14.7
```

- [ ] **Step 7: Update platform (lines 101-109)**

Change `x: 9.00` to `x: 6.40`, `z: -0.775` to `z: 0.50`, `depth: 1.55` to `depth: 1.00`:

```yaml
platform:
  id: west_platform
  name: VRV设备平台
  x: 6.40
  z: 0.50
  width: 1.60
  depth: 1.00
  height: 0.05
  area: 1.60
```

- [ ] **Step 8: Verify no room overlaps**

Run: `npx tsx scripts/verify-layout.ts`
Expected: "No overlaps" with 10 rooms listed. The balcony room should now show `z:[ 0.00 3.55 ]` (north position).

- [ ] **Step 9: Commit**

```bash
git add config/layout/model-geometry.yaml
git commit -m "fix: correct room coordinates — kitchen/living/entry_garden south 3.55m, balcony→north, platform→VRV west"
```

---

### Task 2: Update model-geometry.yaml — Walls (Exterior + Interior)

**Files:**
- Modify: `config/layout/model-geometry.yaml` (walls section, lines 110-157)

**Interfaces:**
- Consumes: room coordinates from Task 1.
- Produces: wall segments aligned with corrected rooms.

- [ ] **Step 1: Replace the entire walls section**

Replace everything from `walls:` to the end of the file with:

```yaml
walls:
  # 外框（顺时针，从西北角出发）
  - { x1: 0.00, z1: 0.00, x2: 0.00, z2: 5.00 }           # 西墙北段
  - { x1: 0.00, z1: 5.00, x2: 0.20, z2: 6.00 }            # 西南圆角段 1
  - { x1: 0.20, z1: 6.00, x2: 0.80, z2: 7.00 }            # 西南圆角段 2
  - { x1: 0.80, z1: 7.00, x2: 2.00, z2: 8.50 }            # 西南圆角段 3
  - { x1: 2.00, z1: 8.50, x2: 4.20, z2: 9.80 }            # 西南圆角段 4
  - { x1: 4.20, z1: 9.80, x2: 7.20, z2: 9.80 }            # 南墙西段（书房南侧；飘窗凸出至 z=10.90）
  - { x1: 7.20, z1: 9.80, x2: 7.20, z2: 9.95 }            # 南墙台阶（150mm，左 9.80 → 右 9.95）
  - { x1: 7.20, z1: 9.95, x2: 15.20, z2: 9.95 }           # 南墙东段（客厅落地玻璃/东南次卧凸窗内墙；凸窗凸出至 z=11.05）
  - { x1: 15.20, z1: 9.95, x2: 16.00, z2: 8.50 }          # 东南圆角段 1
  - { x1: 16.00, z1: 8.50, x2: 16.20, z2: 7.00 }          # 东南圆角段 2
  - { x1: 16.20, z1: 7.00, x2: 16.40, z2: 5.55 }          # 东南圆角段 3
  - { x1: 16.40, z1: 5.55, x2: 16.40, z2: 0.65 }          # 东墙
  - { x1: 16.40, z1: 0.65, x2: 15.25, z2: 0.65 }          # 入户花园北墙
  - { x1: 15.25, z1: 0.65, x2: 15.25, z2: 3.55 }          # 入户花园东墙
  - { x1: 15.25, z1: 3.55, x2: 10.80, z2: 3.55 }          # 入户花园南墙
  - { x1: 10.80, z1: 3.55, x2: 10.80, z2: 0.00 }          # 入户花园西墙（=北生活阳台东墙）
  - { x1: 10.80, z1: 0.00, x2: 0.00, z2: 0.00 }           # 主楼北墙

  # 内墙 — 左侧卧室区（不变）
  - { x1: 0.00, z1: 4.30, x2: 2.60, z2: 4.30 }            # 主卫南墙
  - { x1: 2.60, z1: 0.00, x2: 2.60, z2: 4.30 }            # 主卫-西北次卧分隔
  - { x1: 2.60, z1: 4.30, x2: 5.60, z2: 4.30 }            # 西北次卧南墙
  - { x1: 4.20, z1: 5.55, x2: 4.20, z2: 9.80 }            # 主卧东墙
  - { x1: 4.20, z1: 5.55, x2: 7.20, z2: 5.55 }            # 主卧-书房分隔
  - { x1: 7.20, z1: 5.55, x2: 7.20, z2: 9.80 }            # 书房东墙

  # 内墙 — 客卫（不变）
  - { x1: 5.60, z1: 2.00, x2: 5.60, z2: 3.77 }            # 客卫西墙
  - { x1: 5.60, z1: 3.77, x2: 7.10, z2: 3.77 }            # 客卫南墙
  - { x1: 7.10, z1: 2.00, x2: 7.10, z2: 3.77 }            # 客卫东墙

  # 内墙 — VRV 设备平台
  - { x1: 5.60, z1: 0.00, x2: 5.60, z2: 1.00 }            # VRV 平台西墙
  - { x1: 5.60, z1: 1.00, x2: 7.20, z2: 1.00 }            # VRV 平台南墙

  # 内墙 — 北生活阳台 / 厨房 / 客餐厅 / 东南次卧
  - { x1: 7.20, z1: 0.00, x2: 7.20, z2: 3.55 }            # 北生活阳台西墙（分隔 VRV/客卫/走道）
  - { x1: 7.20, z1: 3.55, x2: 10.80, z2: 3.55 }           # 北生活阳台-厨房分隔
  - { x1: 7.20, z1: 3.55, x2: 7.20, z2: 5.55 }            # 厨房西墙
  - { x1: 7.20, z1: 5.55, x2: 10.80, z2: 5.55 }           # 厨房-客餐厅分隔
  - { x1: 10.80, z1: 3.55, x2: 10.80, z2: 5.55 }          # 厨房-入户花园分隔
  - { x1: 7.20, z1: 5.55, x2: 7.20, z2: 9.95 }            # 客餐厅西墙
  - { x1: 13.40, z1: 5.55, x2: 13.40, z2: 9.95 }          # 客餐厅-东南次卧分隔
  - { x1: 13.40, z1: 5.55, x2: 16.40, z2: 5.55 }          # 东南次卧北墙
```

- [ ] **Step 2: Run verify-layout**

Run: `npx tsx scripts/verify-layout.ts`
Expected: "No overlaps" with 10 rooms. Balcony should show `z:[ 0.00 3.55 ]`, kitchen `z:[ 3.55 5.55 ]`, living `z:[ 5.55 9.95 ]`.

- [ ] **Step 3: Run validate-room-wall-alignment**

Run: `npx tsx scripts/validate-room-wall-alignment.ts`
Expected: Same "MISALIGNED" warnings with overlap=0.00, distance=0.00 (false positives from exact-edge alignment). No NEW misalignments compared to pre-change baseline. Wall bounding box should show `maxZ: 10.90` (from study/master south wall, NOT 11.05 since bay windows are overlay elements not walls).

Wait — actually the south exterior wall is at z=9.95 (right) and z=9.80 (left). The max z in walls should be 9.95. But the SE arc starts at (15.20, 9.95). Let me verify: the south-east wall segment is (7.20, 9.95) → (15.20, 9.95). And the SE arc goes from (15.20, 9.95) to (16.40, 5.55). So maxZ in walls = 9.95.

Expected: `Wall bounding box: { minX: 0.00, maxX: 16.40, minZ: 0.00, maxZ: 9.95 }`

- [ ] **Step 4: Run server tests**

Run: `npm run test:server`
Expected: The test `model-geometry layout matches floor plan` will FAIL on `balcony.depth >= 1.0 && balcony.depth <= 1.2` because balcony depth is now 3.55. This is expected — Task 3 fixes the test. All other tests should PASS.

- [ ] **Step 5: Commit**

```bash
git add config/layout/model-geometry.yaml
git commit -m "fix: rewrite exterior+interior walls for corrected room positions"
```

---

### Task 3: Update test assertions for balcony dimension change

**Files:**
- Modify: `tests/server/model-geometry-layout.test.ts:20-22`

**Interfaces:**
- Consumes: balcony room with depth=3.55 (north balcony) from Task 1.

- [ ] **Step 1: Update the balcony test assertion**

Replace lines 20-22:

```typescript
    assert(byId.has('balcony'));
    const balcony = byId.get('balcony')!;
    assert(balcony.depth >= 1.0 && balcony.depth <= 1.2, 'balcony depth ~1.1m');
```

With:

```typescript
    assert(byId.has('balcony'));
    const balcony = byId.get('balcony')!;
    assert(balcony.depth >= 3.0 && balcony.depth <= 4.0, 'balcony (north) depth ~3.5m');
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm run test:server`
Expected: All 118 tests PASS, including `has expected rooms with approximate floor-plan dimensions`.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add tests/server/model-geometry-layout.test.ts
git commit -m "test: update balcony assertion for north balcony (depth 3.55m)"
```

---

### Task 4: Update overlay.yaml — Delete south balcony elements, add living glass + study bay

**Files:**
- Modify: `config/layout/overlay.yaml` (entire file)

**Interfaces:**
- Consumes: corrected wall positions from Task 2 (south wall at z=9.95 for right side, z=9.80 for left).
- Produces: overlay elements (curtain_run, bay_sill, suppress, floor_region) aligned with new geometry.

- [ ] **Step 1: Update header comment**

Replace lines 1-4:

```yaml
# overlay.yaml: 渲染意图声明（intent-only），严格 schema。
# 2026-07-15：overlay.yaml 与 model-geometry.yaml 共用同一坐标系，z 字段不再单独偏移。
# 2026-07-16：按新外墙轮廓重写：西/南玻璃幕墙，西南/东南圆弧，飘窗，门洞补区。
# 2026-07-16 17:55：主卧、东南次卧南向飘窗 depth 0.5 → 1.1，与阳台南墙 z=10.90 齐平；书房南墙保留 z=9.80 凹陷。
```

With:

```yaml
# overlay.yaml: 渲染意图声明（intent-only），严格 schema。
# 2026-07-15：overlay.yaml 与 model-geometry.yaml 共用同一坐标系，z 字段不再单独偏移。
# 2026-07-16：按新外墙轮廓重写：西/南玻璃幕墙，西南/东南圆弧，飘窗，门洞补区。
# 2026-07-17：大修——删除南阳台（客厅落地玻璃齐平 z=9.95），新增书房南飘窗，
#   新增客厅南墙玻璃幕，东南次卧凸窗 base 移至 z=9.95，北生活阳台/VRV 平台地板位置更新。
```

- [ ] **Step 2: Update suppress section — delete balcony suppresses, add living south, update SE**

Replace the entire `suppress:` section with:

```yaml
suppress:
  - id: suppress_west_wall
    region: { x1: -0.5, z1: -0.5, x2: 0.5, z2: 5.5 }
    reason: "西外墙北段（x=0, z=0~5.0）改玻璃幕墙"
  - id: suppress_southwest_arc
    region: { x1: 0.5, z1: 5.5, x2: 4.0, z2: 9.85 }
    reason: "西南圆弧（0,5.0→4.2,9.8）改玻璃幕墙"
  - id: suppress_south_wall_west
    region: { x1: 4.0, z1: 9.75, x2: 7.3, z2: 9.85 }
    reason: "南外墙西段（x=4.2~7.2, z=9.8）改玻璃幕墙（书房飘窗）"
  - id: suppress_living_south
    region: { x1: 7.15, z1: 9.90, x2: 13.45, z2: 10.00 }
    reason: "客厅南墙落地玻璃幕（z=9.95）"
  - id: suppress_south_wall_east
    region: { x1: 13.35, z1: 9.90, x2: 15.3, z2: 10.00 }
    reason: "南外墙东段（x=13.4~15.2, z=9.95）改玻璃幕墙"
  - id: suppress_bedroom_se_south_bay
    region: { x1: 13.4, z1: 9.90, x2: 16.4, z2: 10.00 }
    reason: "东南次卧南向凸窗（凸窗南缘 z=11.05，替换原南墙为玻璃）"
```

Note: The three `suppress_balcony_*` entries are DELETED. A new `suppress_living_south` is ADDED. The `suppress_south_wall_east` and `suppress_bedroom_se_south_bay` z-values are updated from 9.75~9.85 to 9.90~10.00.

- [ ] **Step 3: Update elements section — delete balcony curtains, add living curtain, add study bay, update SE bay**

Replace the entire `elements:` section with:

```yaml
elements:
  # 西墙 + 西南圆弧 + 南墙西段（到书房东侧）
  - id: west_curtain
    type: curtain_run
    closed: false
    points:
      - { x: 0.0, z: 0.0 }
      - { x: 0.0, z: 5.0 }
      - { x: 0.2, z: 6.0 }
      - { x: 0.8, z: 7.0 }
      - { x: 2.0, z: 8.5 }
      - { x: 4.2, z: 9.8 }
      - { x: 7.2, z: 9.8 }
    height: 3.0

  # 客厅南墙落地玻璃幕（z=9.95）
  - id: living_south_curtain
    type: curtain_run
    closed: false
    points:
      - { x: 7.2, z: 9.95 }
      - { x: 13.4, z: 9.95 }
    height: 3.0

  # 南墙东段（东南次卧凸窗内墙到东南圆弧）
  - id: south_east_curtain
    type: curtain_run
    closed: false
    points:
      - { x: 13.4, z: 9.95 }
      - { x: 15.2, z: 9.95 }
    height: 3.0

  # 飘窗
  - id: master_bedroom_west_bay
    type: bay_sill
    points:
      - { x: 0.0, z: 5.55 }
      - { x: 0.0, z: 9.8 }
    depth: 0.5
    sill: 0.45
    height: 2.55
    reason: "主卧西墙环幕飘窗"

  - id: master_bedroom_south_bay
    type: bay_sill
    points:
      - { x: 0.0, z: 9.8 }
      - { x: 4.2, z: 9.8 }
    depth: 1.1
    sill: 0.45
    height: 2.55
    reason: "主卧南墙环幕飘窗（南缘 z=10.90）"

  - id: study_south_bay
    type: bay_sill
    points:
      - { x: 4.2, z: 9.8 }
      - { x: 7.2, z: 9.8 }
    depth: 1.1
    sill: 0.45
    height: 2.55
    reason: "书房南墙飘窗（南缘 z=10.90，与主卧齐平）"

  - id: bedroom_se_south_bay
    type: bay_sill
    points:
      - { x: 13.4, z: 9.95 }
      - { x: 16.4, z: 9.95 }
    depth: 1.1
    sill: 0.45
    height: 2.55
    reason: "东南次卧南向凸窗（南缘 z=11.05）"

  - id: bedroom_nw_west_bay
    type: bay_sill
    points:
      - { x: 0.0, z: 0.0 }
      - { x: 0.0, z: 4.3 }
    depth: 0.5
    sill: 0.45
    height: 2.55
    reason: "西北次卧西墙飘窗"

  # 地板补区
  - id: entry_garden_floor
    type: floor_region
    points:
      - { x: 10.8, z: 0.65 }
      - { x: 15.25, z: 0.65 }
      - { x: 15.25, z: 3.55 }
      - { x: 10.8, z: 3.55 }
    reason: "入户花园地板"

  - id: corridor_floor
    type: floor_region
    points:
      - { x: 4.2, z: 5.55 }
      - { x: 7.2, z: 5.55 }
      - { x: 7.2, z: 7.8 }
      - { x: 4.2, z: 7.8 }
    reason: "主卧与书房之间的走廊"

  - id: north_platform_floor
    type: floor_region
    points:
      - { x: 5.6, z: 0.0 }
      - { x: 7.2, z: 0.0 }
      - { x: 7.2, z: 1.0 }
      - { x: 5.6, z: 1.0 }
    reason: "VRV 设备平台地板"
```

Key changes:
- DELETED: `balcony_west_curtain`, `balcony_south_curtain`, `balcony_east_curtain`
- ADDED: `living_south_curtain` (z=9.95, x=7.2~13.4)
- ADDED: `study_south_bay` (z=9.80, x=4.2~7.2, depth=1.1)
- UPDATED: `south_east_curtain` z 9.8→9.95
- UPDATED: `bedroom_se_south_bay` z 9.8→9.95
- UPDATED: `entry_garden_floor` points (z from -2.9~0 to 0.65~3.55)
- UPDATED: `north_platform_floor` points (from x=8.2~9.8/z=-1.55~0 to x=5.6~7.2/z=0~1.0)

- [ ] **Step 4: Run server tests**

Run: `npm run test:server`
Expected: All 118 tests PASS, including `parseOverlay` and `mergeSceneElements` tests.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add config/layout/overlay.yaml
git commit -m "fix: overlay — delete south balcony, add living glass + study bay, update positions"
```

---

### Task 5: Final verification and preview

**Files:**
- No file changes (verification only). Optional: `tmp/overlay-preview.png` (generated, not committed).

- [ ] **Step 1: Run full verification suite**

Run all four commands sequentially:

```bash
npx tsx scripts/verify-layout.ts
npx tsx scripts/validate-room-wall-alignment.ts
npm run test:server
npm run typecheck
```

Expected:
- verify-layout: "No overlaps", 10 rooms
- validate-room-wall-alignment: wall bounding box `{ minX: 0.00, maxX: 16.40, minZ: 0.00, maxZ: 9.95 }`, same false-positive MISALIGNED warnings (overlap=0.00, distance=0.00)
- test:server: 118 tests PASS, 0 FAIL
- typecheck: no errors

- [ ] **Step 2: Verify key room positions**

Run: `npx tsx scripts/verify-layout.ts`

Confirm the output shows:
- `balcony x:[ 7.20 10.80 ] z:[ 0.00 3.55 ]` (north balcony, NOT south)
- `kitchen x:[ 7.20 10.80 ] z:[ 3.55 5.55 ]`
- `living_dining x:[ 7.20 13.40 ] z:[ 5.55 9.95 ]`
- `entry_garden x:[ 10.80 15.25 ] z:[ 0.65 3.55 ]`
- `master_bedroom x:[ 0.00 4.20 ] z:[ 5.55 9.80 ]` (unchanged)

- [ ] **Step 3: Verify git diff is clean**

Run: `git diff --stat`
Expected: Only `config/layout/model-geometry.yaml`, `config/layout/overlay.yaml`, and `tests/server/model-geometry-layout.test.ts` changed.

- [ ] **Step 4: Generate preview (optional)**

If the preview script exists at `/tmp/overlay-preview.py`:

```bash
python3 /tmp/overlay-preview.py
```

This generates `tmp/overlay-preview.png` showing the corrected layout with bay windows and curtain walls. Not committed to git.

---

## Self-Review

**1. Spec coverage:**
- ✅ Kitchen moved south 3.55m (Task 1, Step 2)
- ✅ Living room depth corrected 6.0→4.4m, z moved (Task 1, Step 3)
- ✅ Entry garden moved south 3.55m (Task 1, Step 6)
- ✅ Bedroom SE moved south 0.15m (Task 1, Step 4)
- ✅ South balcony deleted, north balcony added (Task 1, Step 5)
- ✅ VRV platform moved to correct position (Task 1, Step 7)
- ✅ Exterior walls rewritten with 150mm step (Task 2, Step 1)
- ✅ Interior walls rewritten for all corrected rooms (Task 2, Step 1)
- ✅ Balcony test assertion updated (Task 3, Step 1)
- ✅ Overlay: balcony curtains deleted, living glass added (Task 4, Steps 2-3)
- ✅ Overlay: study bay window added (Task 4, Step 3)
- ✅ Overlay: SE bay window z updated (Task 4, Step 3)
- ✅ Overlay: floor regions updated (Task 4, Step 3)
- ✅ Full verification (Task 5)

**2. Placeholder scan:** No placeholders found. All steps contain exact coordinates and commands.

**3. Type consistency:** Room id `balcony` is used consistently (repurposed from south to north). Test assertion matches new depth range (3.0~4.0). Overlay elements reference correct z values (9.80 for left, 9.95 for right).

**Gaps:** None identified. The `house.yaml` `south_balcony` entry becomes orphaned metadata (no matching room in model-geometry). This is harmless (metadata without geometry is ignored by ProjectCatalog) and can be cleaned up in a follow-up.
