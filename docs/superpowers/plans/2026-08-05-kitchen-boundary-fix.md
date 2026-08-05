# 厨房南界修正（DEC-014）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按开发商创想图把厨房南界从 z=4.3 修正到 z=2.9，餐厅带+走廊并入客餐厅，冰箱位移到东墙南端，同步电气/furnishings/文档。

**Architecture:** model-geometry.yaml 是唯一权威源，先改几何（顶点/房间边界/墙），再改下游（电气点位、house.yaml 房间档案与 furnishings），最后补文档。overlay.yaml 零改动（已核实无引用 w_kit_west/w_kit_east）。

**Tech Stack:** YAML 配置 + tsx 校验脚本（scripts/verify-*.ts）+ node:test（tests/server）+ vitest（app）。

**Spec:** `docs/superpowers/specs/2026-08-05-kitchen-boundary-fix-design.md`

## Global Constraints

- 坐标系：+x=东，+z=南，单位米，局部坐标系（model-geometry v2.0 vertex 格式）
- rooms.boundary 用顶点 id 列表；walls 用 from/to 顶点 id
- 几何改动后必须跑：`npm run verify:all && npm run test:server && npm run typecheck`
- 墙体改动影响碰撞提取，必须跑：`npm run test:app`
- 几何改动后必须使用 floor-plan-compare 技能对比俯视图基线
- furnishings 中无 x/z 的条目为 count-only；预算 counts 由列表 derive，禁止双写
- 禁止提交未验证的改动；每 Task 结束单独 commit

---

### Task 1: 几何修正 — 顶点 + 房间边界 + 墙体缩短

**Files:**
- Modify: `config/layout/model-geometry.yaml`（vertices ~line 30、rooms ~line 60-82、walls ~line 210-213）
- Test: `tests/server/model-geometry-layout.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: 新顶点 `v_kit_s2`(7.20, 2.90)、`v_ent_kit2`(10.80, 2.90)；kitchen 南界 z=2.9；living_dining 北界 z=2.9。后续 Task 的电气/家具坐标以此为准。

- [ ] **Step 1: 先改测试（TDD）——加入 kitchen/living 新尺寸断言**

在 `tests/server/model-geometry-layout.test.ts` 的 `assert(byId.has('living_dining'));` 块之后、`assert(byId.has('balcony'));` 之前插入：

```ts
    assert(living.depth >= 6.7 && living.depth <= 7.1, 'living depth ~6.9m (DEC-014 吞并餐厅带+走廊 z:[2.90,9.80])');

    assert(byId.has('kitchen'));
    const kitchen = byId.get('kitchen')!;
    assert(kitchen.width >= 3.4 && kitchen.width <= 3.8, 'kitchen width ~3.6m');
    assert(kitchen.depth >= 2.7 && kitchen.depth <= 3.1, 'kitchen depth ~2.9m (DEC-014 南界 z=2.9)');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx --test tests/server/model-geometry-layout.test.ts`
Expected: FAIL —— kitchen depth 当前 4.3，断言 2.7~3.1 不通过

- [ ] **Step 3: 新增顶点**

`config/layout/model-geometry.yaml` 在 `- { id: v_ent_kit, x: 10.80, z: 4.30 }` 一行之后插入：

```yaml
  # DEC-014 厨房新南界（创想图核对：与入户花园南墙 z=2.90 齐平）
  - { id: v_kit_s2,  x: 7.20,  z: 2.90 }
  - { id: v_ent_kit2, x: 10.80, z: 2.90 }
```

- [ ] **Step 4: 改房间边界**

kitchen 房间：

```yaml
  - id: kitchen
    name: 厨房
    boundary: [v_kit_w, v_vrv_se, v_balc_ne, v_kit_s2, v_ent_kit2, v_ent_nw]
    height: 2.8
    type: service
```

living_dining 房间：

```yaml
  - id: living_dining
    name: 客餐厅
    boundary: [v_kit_s2, v_foyer_se, v_be_se_s, v_step_t]
    height: 2.8
    type: public
```

- [ ] **Step 5: 缩短两段墙**

```yaml
  - { id: w_kit_west,   from: v_balc_ne, to: v_kit_s2, height: 2.8 }
```

```yaml
  - { id: w_kit_east,   from: v_ent_nw,  to: v_ent_kit2, height: 2.8 }
```

同时在 w_kit_west 上方注释行 `# 内墙 — x=7.20 纵向墙（厨房西墙，在 v_vrv_se, v_balc_ne, v_kit_s 处切开）` 改为 `# 内墙 — x=7.20 纵向墙（厨房西墙，在 v_vrv_se, v_balc_ne 处切开；DEC-014 南界缩至 z=2.90，z[2.9,4.3] 段由 w_gbath_east@x=7.1 覆盖）`。

- [ ] **Step 6: 跑测试 + 拓扑校验**

Run: `npx tsx --test tests/server/model-geometry-layout.test.ts && npx tsx scripts/verify-topology.ts`
Expected: 测试 PASS；拓扑无新 error（living_dining 北边 z=2.9 的 x∈[7.2,10.8] 段为开放边，与厨房相邻，属预期）

- [ ] **Step 7: Commit**

```bash
git add config/layout/model-geometry.yaml tests/server/model-geometry-layout.test.ts
git commit -m "feat(layout): DEC-014 厨房南界 z=4.3→2.9，餐厅带+走廊并入客餐厅"
```

---

### Task 2: 电气修正 — 5 个点位 + 注释

**Files:**
- Modify: `config/electrical.yaml`（line 313 注释、324-332 fridge、316-322 counter、350-357 gas、474-481 switch_corridor、568-577 sock_gateway）

**Interfaces:**
- Consumes: Task 1 的 `w_kit_east`（现跨 z∈[0,2.9] @x=10.8）、`w_kit_west`（现跨 z∈[2.2,2.9] @x=7.2）、`w_gbath_east`（x=7.1, z∈[2.2,4.3]）、`w_st_east`（x=7.2, z∈[5.55,9.8]）
- Produces: 全部厨房/走廊点位落在 Task 1 后的有效墙段上

背景：计划评审时发现两个遗漏点位——`switch_corridor`(7.20,4.30) 和 `sock_gateway`(7.20,4.80) 引用的 w_kit_west 缩短后不再覆盖其 z 坐标（verify-rules 只查墙 id 存在性、不查跨度，不会报错但语义错误），一并修正。

- [ ] **Step 1: 改厨房段头注释**

```yaml
# 厨房（DEC-013 布局重排：灶台→东墙，水槽→北墙；DEC-014 冰箱→东墙南端，南界 z=2.9）
```

- [ ] **Step 2: 台面插座避开冰箱位**

```yaml
- id: sock_kitchen_counter
  room: kitchen
  wall: w_kit_east
  type: socket
  x: 10.80
  z: 2.0
  height: 1.2
  count: 4
  note: "厨房台面带开关插座（东墙切配区正后方；DEC-014 由 z=2.7 移至 z=2.0，避开冰箱位 z∈[2.2,2.9]）"
```

- [ ] **Step 3: 冰箱插座移到东墙南端**

```yaml
- id: sock_kitchen_fridge
  room: kitchen
  wall: w_kit_east
  type: socket
  x: 10.80
  z: 2.55
  height: 0.3
  count: 1
  note: "冰箱插座（DEC-014 由西墙移至东墙南端高柜位，与创想图一致，单独回路）"
```

- [ ] **Step 4: 燃气报警器收回界内**

```yaml
- id: sock_kitchen_gas
  room: kitchen
  wall: w_kit_east
  type: socket
  x: 10.80
  z: 1.9
  height: 2.0
  count: 1
  note: "燃气报警器插座（DEC-014 由 z=3.0 收回厨房界内，近灶台）"
```

- [ ] **Step 5: 走廊灯开关改挂客卫东墙**

```yaml
- id: switch_corridor
  room: living_dining
  wall: w_gbath_east
  type: switch
  x: 7.10
  z: 4.10
  height: 1.3
  note: "走廊灯光开关（DEC-014 w_kit_west 缩短后改挂客卫东墙）"
```

- [ ] **Step 6: 网关插座改挂父母房东墙**

```yaml
- id: sock_gateway
  room: living_dining
  wall: w_st_east
  type: socket
  x: 7.20
  z: 5.70
  height: 0.3
  count: 1
  note: "智能网关/路由位（走廊，房子中央，WiFi覆盖最优；DEC-014 由 z=4.8 移至 w_st_east 有效墙段）"
```

- [ ] **Step 7: 校验**

Run: `npx tsx scripts/verify-rules.ts && npm run test:server`
Expected: 无 wall_ref error；全部测试 PASS

- [ ] **Step 8: Commit**

```bash
git add config/electrical.yaml
git commit -m "fix(electrical): DEC-014 冰箱→东墙南端，台面/燃气/走廊开关/网关点位收回有效墙段"
```

---

### Task 3: house.yaml — furnishings + 房间档案

**Files:**
- Modify: `config/house.yaml`（rooms kitchen ~line 187-209、rooms living_dining ~line 164-186、furnishings kitchen ~line 452-459）

**Interfaces:**
- Consumes: Task 1 的新房间尺寸（kitchen 3.6×2.9、living_dining 6.2×6.9）
- Produces: `fridge` count-only 条目（ProjectCatalog.getFurnishingCounts 自动 derive 到家电池归集）；厨房柜体 5.0m

- [ ] **Step 1: kitchen 房间档案**

```yaml
  - name: "厨房"
    id: "kitchen"
    type: "service"
    wall_finish: "tile"
    needs_waterproof: true
    width: 3.60
    length: 2.90
    height: 2.8
    area: 10.44
    status: "design"
    orientation: "北"
    notes: "开放式厨房，DEC-014 按创想图修正南界 z=2.9（3.6×2.9=10.44㎡）；开发商 6.09㎡ 为净面积标注口径，净尺寸待量房；需配大功率侧吸油烟机 ≥22m³/min"
```

furniture_concept 改为：

```yaml
    furniture_concept:
      - "L 型地柜约 5.0m（北墙 3.6m 水槽切配 + 东墙 2.2m 灶台）"
      - "冰箱位 0.7m × 0.7m（东墙南端高柜位，创想图一致）"
      - "大功率侧吸油烟机 ≥22m³/min"
      - "洗碗机/净水器预留上下水"
```

- [ ] **Step 2: living_dining 房间档案**

width 保持 6.20，改两行：

```yaml
    length: 6.90
    area: 42.78
```

（z∈[2.90,9.80]，含餐厅带 x∈[7.2,10.8]×z∈[2.9,4.3] 与玄关走廊 x∈[10.8,13.4]×z∈[2.9,4.3]）

- [ ] **Step 3: kitchen furnishings 加冰箱 + 柜体改 5.0m**

```yaml
  kitchen:
    - { type: cabinet_base, count: 5.0 }      # DEC-014 北墙3.6+东墙2.2 L型
    - { type: cabinet_wall, count: 2.0 }
    - { type: countertop_quartz, count: 5.0 } # DEC-014 同地柜
    - { type: fridge }                        # DEC-014 东墙南端高柜位 0.7×0.7
    - { type: sink }
    - { type: range_hood }
    - { type: gas_stove }
    - { type: ceiling_light }
```

- [ ] **Step 4: 校验**

Run: `npm run verify:furniture && npm run test:server`
Expected: furniture placement OK（south_balcony warning 为既有项，不处理）；预算测试 PASS

- [ ] **Step 5: Commit**

```bash
git add config/house.yaml
git commit -m "feat(house): DEC-014 厨房档案 10.44㎡ + fridge + 柜体5.0m；客餐厅 42.78㎡"
```

---

### Task 4: 文档 — decision_log + pending-site-data

**Files:**
- Modify: `docs/decision_log.md`（"## 待决策事项"之前插入新条目）
- Modify: `docs/pending-site-data.md`（建筑细节表末尾追加）

**Interfaces:**
- Consumes: Task 1-3 的全部变更
- Produces: DEC-2026-08-05-014 决策记录；量房项 #21-23

- [ ] **Step 1: decision_log.md 插入 DEC-014**

在 `## 待决策事项` 之前插入：

```markdown
### DEC-2026-08-05-014 厨房南界修正（创想图核对）

- **决策**：
  - 厨房南界 z=4.3 → z=2.9（与入户花园南墙齐平），3.6×2.9=10.44㎡；z∈[2.9,4.3] 餐厅带 + x∈[10.8,13.4] 走廊并入客餐厅（42.78㎡）
  - 冰箱：西墙 → 东墙南端高柜位（创想图一致），插座 (10.80, 2.55)
  - 三联动长虹玻璃推拉门位置 z=4.3 → z=2.9（预算项不变）
  - 餐桌维持 (9.0,5.3) 不动（创想图同款餐厅位）
  - 柜体/台面 3.5m → 5.0m；家电池加冰箱
- **决策依据**：
  - 开发商创想图（survey/photos/9a8d1ce3eb3740a7ceb061b43244783d.jpg）：厨房操作区仅北墙+东墙，纵深至 z≈2.9；餐桌 staged 于 (8.5,4.7)
  - house.yaml 6.09㎡ 为开发商净面积标注口径；model-geometry 15.48㎡ 系 2026-07-17 大修把餐厅带并入厨房（e874a6b）
  - 本条目取代 DEC-2026-08-02-013 中"东墙（灶台+烟机+冰箱）/冰箱在西墙南端"的自相矛盾描述，统一为东墙南端
- **预算影响**：kitchen_cabinet 8000 预计 +2000~3000（5.0m 地柜+台面）；家电池 +冰箱 3000-5000——待业主拍板后改 budget 配置
- **关联文件**：`config/layout/model-geometry.yaml`、`config/electrical.yaml`、`config/house.yaml`、`docs/superpowers/specs/2026-08-05-kitchen-boundary-fix-design.md`
- **决策人**：业主

---
```

- [ ] **Step 2: pending-site-data.md 建筑细节表追加**

在 `| 20 | 全屋飘窗实际sill高度 |` 一行之后插入：

```markdown
| 21 | 厨房实际南界/餐厅带划分 | model-geometry.yaml 顶点 v_kit_s2/v_ent_kit2 | 更新 z | 推断 z=2.90（创想图） | inferred | DEC-014 厨房面积/餐桌方案前提 |
| 22 | 冰箱实际位置 | electrical.yaml sock_kitchen_fridge | `{x, z}` | 推断东墙南端 (10.80,2.55) | inferred | 插座/高柜设计 |
| 23 | 厨房净面积复核 | house.yaml rooms.kitchen | 更新 width/length/area | 3.6×2.9=10.44（开发商标注 6.09 为净口径） | inferred | 预算/柜体延米 |
```

- [ ] **Step 3: Commit**

```bash
git add docs/decision_log.md docs/pending-site-data.md
git commit -m "docs: DEC-014 厨房南界修正决策记录 + 量房项 #21-23"
```

---

### Task 5: 全量验证 + 俯视图基线对比

**Files:**
- 无改动（纯验证）

**Interfaces:**
- Consumes: Task 1-4 全部产出

- [ ] **Step 1: 全量验证**

Run: `npm run verify:all && npm run test:server && npm run typecheck && npm run test:app`
Expected: 全部通过（test:app 覆盖碰撞提取——w_kit_east/w_kit_west 缩短后的碰撞段变化）

- [ ] **Step 2: 俯视图对比**

使用 floor-plan-compare 技能：截取 3D 俯视图与开发商基线对比，确认厨房/客餐厅分区与创想图一致。

- [ ] **Step 3: 如全部通过，向业主汇报变更完成；若俯视图有出入，回到 Task 1 排查**

---

## Self-Review 记录

- Spec 覆盖：几何✓(T1) overlay零改动✓(无需任务) 电气✓(T2) house✓(T3) 文档✓(T4) 验证✓(T5)；预算配置数字按 spec 约定不改（仅决策记录标注）
- 计划评审新增：switch_corridor/sock_gateway 两个 w_kit_west 悬空引用（spec 未列，Task 2 已含，属几何缩短的直接后果）
- 既有问题不处理：verify:furniture 的 south_balcony warning、父母房/儿童房插座错位、wardrobe_180 等无 3D 模型——另立任务
