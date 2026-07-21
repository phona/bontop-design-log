# 坐标系统一与 model/overlay 对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 明确项目坐标系约定，撤销 `model-geometry.yaml` 与 `overlay.yaml` 之间的 z 向偏移，让模型、覆盖层、CAD 锚点和渲染器使用同一坐标系。

**Architecture:** 保持 `model-geometry.yaml` 使用 DXF 原值（允许 `z < 0`），将 `overlay.yaml` 的 z 值统一回退到同一坐标系；同步更新 `HouseScene.ts` 的居中常量与 `cad-anchor.yaml`；最终通过俯视图确认玻璃幕墙与飘窗重合。

**Tech Stack:** TypeScript + Three.js, YAML, zod (`server/overlay-merge.ts`).

## Global Constraints

- **YAGNI**: 本次只改坐标系和居中常量，不重构渲染逻辑或新增 element type。
- **DRY**: 对 `model-geometry.yaml` 和 `overlay.yaml` 使用单一机械变换，不逐字段手算。
- **TDD**: 每次改完跑 `npm run test:server` 和 `npm run typecheck`。
- **不推断几何**: 只做坐标平移，不新增/删除墙段或房间。
- **Commit 粒度**: 每个 task 一次独立 commit。

---

## Task 1: 在 AGENTS.md 中写入坐标系约定

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: 项目坐标系规范文档，后续所有 YAML 编辑和渲染器配置均需遵循。

- [ ] **Step 1: 在 AGENTS.md 中追加坐标系约定章节**

在文件末尾追加：

```markdown
## 坐标系约定

- 采用 Three.js 默认右手坐标系：Y 轴向上（高度）。
- 水平面：`x` 为东西向，`z` 为南北向。
- 方向约定：
  - `+x` = 东，`-x` = 西
  - `+z` = 南，`-z` = 北
- 俯视图约定：北朝上（`-z` 方向），南朝下（`+z` 方向）。
- `model-geometry.yaml` 使用 DXF 原值（局部坐标），允许 `z < 0`（如入户花园向北凸出）。
- `overlay.yaml` 必须与 `model-geometry.yaml` 使用同一坐标系，不得保留独立偏移。
- 全局坐标与局部坐标换算：
  - `DXF_mm = (local_m + origin) / scale`
  - `local_m = DXF_mm * scale - origin`
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document coordinate system convention in AGENTS.md"
```

---

## Task 2: 恢复 `model-geometry.yaml` 为 DXF 原值

**Files:**
- Modify: `config/layout/model-geometry.yaml`

**Interfaces:**
- Consumes: 当前文件被错误取反，需要恢复到 DXF 原值（参考 `git diff` 中的目标值）。
- Produces: 8 房 + 1 平台 + 27 段墙，z 值符合 DXF 原值。

- [ ] **Step 1: 恢复所有房间 z 值**

```yaml
rooms:
  - id: master_bath
    name: 主卫
    x: 1.3
    z: 2.15
    width: 2.6
    depth: 4.3
    height: 3.0
    area: 11.18
    perimeter: 13.8
  - id: master_bedroom
    name: 主卧
    x: 2.1
    z: 7.675
    width: 4.2
    depth: 4.25
    height: 3.0
    area: 17.85
    perimeter: 16.9
  - id: bedroom_nw
    name: 西北次卧
    x: 4.1
    z: 2.775
    width: 3.0
    depth: 5.55
    height: 3.0
    area: 16.65
    perimeter: 17.1
  - id: guest_bath
    name: 客卫
    x: 5.7
    z: 8.8
    width: 3.0
    depth: 2.0
    height: 3.0
    area: 6.0
    perimeter: 10.0
  - id: kitchen
    name: 厨房
    x: 9.0
    z: 1.0
    width: 3.6
    depth: 2.0
    height: 3.0
    area: 7.2
    perimeter: 11.2
  - id: living_dining
    name: 客餐厅
    x: 10.3
    z: 5.9
    width: 6.2
    depth: 7.8
    height: 3.0
    area: 48.36
    perimeter: 28.0
  - id: bedroom_se
    name: 东南次卧
    x: 14.9
    z: 7.6
    width: 3.0
    depth: 4.4
    height: 3.0
    area: 13.2
    perimeter: 14.8
  - id: entry_garden
    name: 入户花园
    x: 13.025
    z: -1.45
    width: 4.45
    depth: 2.9
    height: 3.0
    area: 12.9
    perimeter: 14.7
```

- [ ] **Step 2: 恢复 platform 和 walls**

```yaml
platform:
  id: elevator
  name: 电梯井
  x: 12.1
  z: 1.0
  width: 2.6
  depth: 2.0
  height: 0.15
  area: 5.2

walls:
  # 外框（顺时针，从西北角出发）
  - { x1: 0.0, z1: 0.0, x2: 10.8, z2: 0.0 }
  - { x1: 10.8, z1: 0.0, x2: 10.8, z2: -2.9 }
  - { x1: 10.8, z1: -2.9, x2: 15.25, z2: -2.9 }
  - { x1: 15.25, z1: -2.9, x2: 15.25, z2: 0.0 }
  - { x1: 15.25, z1: 0.0, x2: 10.8, z2: 0.0 }
  - { x1: 10.8, z1: 0.0, x2: 10.8, z2: 2.0 }
  - { x1: 10.8, z1: 2.0, x2: 13.4, z2: 2.0 }
  - { x1: 13.4, z1: 2.0, x2: 13.4, z2: 5.4 }
  - { x1: 13.4, z1: 5.4, x2: 16.4, z2: 5.4 }
  - { x1: 16.4, z1: 5.4, x2: 16.4, z2: 9.8 }
  - { x1: 16.4, z1: 9.8, x2: 0.0, z2: 9.8 }
  - { x1: 0.0, z1: 9.8, x2: 0.0, z2: 0.0 }
  # 内墙
  - { x1: 0.0, z1: 4.3, x2: 2.6, z2: 4.3 }
  - { x1: 2.6, z1: 0.0, x2: 2.6, z2: 5.55 }
  - { x1: 5.6, z1: 0.0, x2: 5.6, z2: 5.55 }
  - { x1: 2.6, z1: 5.55, x2: 7.2, z2: 5.55 }
  - { x1: 4.2, z1: 5.55, x2: 4.2, z2: 9.8 }
  - { x1: 4.2, z1: 7.8, x2: 7.2, z2: 7.8 }
  - { x1: 7.2, z1: 7.8, x2: 7.2, z2: 9.8 }
  - { x1: 7.2, z1: 0.0, x2: 7.2, z2: 2.0 }
  - { x1: 7.2, z1: 2.0, x2: 7.2, z2: 9.8 }
  - { x1: 13.4, z1: 0.0, x2: 13.4, z2: 2.0 }
  - { x1: 13.4, z1: 5.4, x2: 13.4, z2: 9.8 }
```

- [ ] **Step 3: 验证文件格式**

```bash
cd /home/tao/projects/bontop-design-log
npx tsx -e "import { load } from 'js-yaml'; import { readFileSync } from 'fs'; const y = load(readFileSync('config/layout/model-geometry.yaml', 'utf8')); console.log('rooms:', y.rooms.length, 'walls:', y.walls.length);"
```

Expected: `rooms: 8 walls: 23`

- [ ] **Step 4: Commit**

```bash
git add config/layout/model-geometry.yaml
git commit -m "revert: restore model-geometry.yaml to DXF original z values"
```

---

## Task 3: 将 `overlay.yaml` z 值回退到 model-geometry 坐标系

**Files:**
- Modify: `config/layout/overlay.yaml`

**Interfaces:**
- Consumes: `model-geometry.yaml` 已回退到 DXF 原值。
- Produces: `overlay.yaml` 所有 z 值与 model-geometry 对齐，玻璃幕墙与上飘窗重合。

- [ ] **Step 1: 更新文件注释**

将第 2 行注释改为：

```yaml
# 2026-07-15：overlay.yaml 与 model-geometry.yaml 共用同一坐标系，z 字段不再单独偏移。
```

- [ ] **Step 2: 更新所有 `z` 字段，减去 3.0**

```yaml
suppress:
  - id: suppress_north_wall
    region: { x1: -0.5, z1: -0.5, x2: 11.3, z2: 0.5 }
    reason: "北外墙改玻璃幕墙"
  - id: suppress_west_wall
    region: { x1: -0.5, z1: -0.5, x2: 0.5, z2: 10.3 }
    reason: "西外墙改玻璃幕墙"
  - id: suppress_south_wall
    region: { x1: -0.5, z1: 9.3, x2: 13.9, z2: 10.3 }
    reason: "南外墙改玻璃幕墙"
  - id: suppress_bedroom_se_corner
    region: { x1: 15.9, z1: 9.7, x2: 16.9, z2: 10.0 }
    reason: "东南次卧南向凸窗（仅右下角 1.1m 那段，剩余东墙保留实墙）"
  - id: suppress_entry_garden_east
    region: { x1: 14.75, z1: -3.4, x2: 15.75, z2: 0.5 }
    reason: "入户花园东墙改玻璃护栏"
  - id: suppress_entry_garden_north
    region: { x1: 10.3, z1: -3.4, x2: 15.75, z2: -2.4 }
    reason: "入户花园北墙改玻璃护栏"

elements:
  - id: glass_facade
    type: curtain_run
    closed: true
    points:
      - { x: 0.0, z: 0.0, radius: 0.8 }
      - { x: 10.8, z: 0.0 }
      - { x: 10.8, z: 2.0 }
      - { x: 13.4, z: 2.0 }
      - { x: 13.4, z: 5.4 }
      - { x: 16.4, z: 5.4 }
      - { x: 16.4, z: 9.8 }
      - { x: 0.0, z: 9.8, radius: 0.8 }
    height: 3.0

  - id: entry_garden_glass
    type: curtain_run
    closed: true
    points:
      - { x: 10.8, z: 0.0 }
      - { x: 15.25, z: 0.0 }
      - { x: 15.25, z: -2.9 }
      - { x: 10.8, z: -2.9 }
    height: 1.1

  - id: master_bedroom_west_bay
    type: bay_sill
    points:
      - { x: 0.0, z: 5.55 }
      - { x: 0.0, z: 9.8 }
    depth: 0.3
    sill: 0.45
    height: 2.55
    reason: "主卧西墙环幕飘窗"

  - id: master_bedroom_south_bay
    type: bay_sill
    points:
      - { x: 0.0, z: 9.8 }
      - { x: 4.2, z: 9.8 }
    depth: 0.3
    sill: 0.45
    height: 2.55
    reason: "主卧南墙环幕飘窗"

  - id: bedroom_se_south_bay
    type: bay_sill
    points:
      - { x: 13.4, z: 9.8 }
      - { x: 16.4, z: 9.8 }
    depth: 0.3
    sill: 0.45
    height: 2.55
    reason: "东南次卧南向凸窗"

  - id: corridor_floor
    type: floor_region
    points:
      - { x: 4.2, z: 5.55 }
      - { x: 7.2, z: 5.55 }
      - { x: 7.2, z: 7.8 }
      - { x: 4.2, z: 7.8 }
    reason: "主卧与客卫之间的过道"
```

- [ ] **Step 3: 验证 schema**

```bash
cd /home/tao/projects/bontop-design-log
npx tsx -e "import { parseOverlay } from './server/overlay-merge.js'; import { readFileSync } from 'fs'; const cfg = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')); console.log('suppress:', cfg.suppress.length, 'elements:', cfg.elements.length);"
```

Expected: `suppress: 6 elements: 7`

- [ ] **Step 4: Commit**

```bash
git add config/layout/overlay.yaml
git commit -m "revert: align overlay.yaml z values with model-geometry DXF coordinates"
```

---

## Task 4: 检查 `cad-anchor.yaml`

**Files:**
- Read/Modify: `config/layout/cad-anchor.yaml`

**Interfaces:**
- Consumes: `model-geometry.yaml` 已回退到 DXF 原值。
- Produces: 确认 `dxf_origin.y` 与 DXF 原值一致。

- [ ] **Step 1: 检查内容**

```bash
cat /home/tao/projects/bontop-design-log/config/layout/cad-anchor.yaml
```

Expected:

```yaml
dxf_origin:
  x: 31642.04
  y: -12484.34
```

- [ ] **Step 2: 如果不一致，修正并 commit**

若 `y` 不是 `-12484.34`，改为：

```yaml
dxf_origin:
  x: 31642.04
  y: -12484.34
```

```bash
git add config/layout/cad-anchor.yaml
git commit -m "revert: restore cad-anchor.yaml dxf_origin.y to DXF original"
```

---

## Task 5: 更新 `HouseScene.ts` 居中常量

**Files:**
- Modify: `app/src/render/HouseScene.ts:33`, `app/src/render/HouseScene.ts:83`

**Interfaces:**
- Consumes: 新的模型 bounds 为 `x: 0~16.4, z: -2.9~9.8`。
- Produces: 渲染器初始视角和俯视图 bounds 与模型匹配。

- [ ] **Step 1: 更新 `DEFAULT_LAYOUT_BOUNDS`**

```ts
const DEFAULT_LAYOUT_BOUNDS: LayoutBounds = { minX: 0, maxX: 16.4, minZ: -2.9, maxZ: 9.8 };
```

- [ ] **Step 2: 更新 `ORBIT_TARGET`**

```ts
private readonly ORBIT_TARGET = new THREE.Vector3(8.2, 0, 3.45);
```

计算依据：

```text
centerZ = (-2.9 + 9.8) / 2 = 3.45
```

- [ ] **Step 3: 可选更新 `ORBIT_POSITION`**

保持原值 `(8.2, 14, 19.2)` 即可；用户可用鼠标拖动。如希望初始更居中，可改为：

```ts
private readonly ORBIT_POSITION = new THREE.Vector3(8.2, 14, 16.2);
```

- [ ] **Step 4: Commit**

```bash
git add app/src/render/HouseScene.ts
git commit -m "fix: update scene bounds and orbit target to DXF-original model coordinates"
```

---

## Task 6: 测试与渲染验证

**Files:**
- Run: `tests/server/overlay-merge.test.ts`, `tests/server/project-catalog.test.ts`

**Interfaces:**
- Consumes: 已修改的 YAML 和 HouseScene.ts。
- Produces: 所有测试通过，俯视渲染中玻璃幕墙与飘窗重合。

- [ ] **Step 1: 跑 server 测试**

```bash
cd /home/tao/projects/bontop-design-log
npm run test:server
```

Expected: 103/103 通过。

- [ ] **Step 2: 跑类型检查**

```bash
npm run typecheck
```

Expected: 无类型错误。

- [ ] **Step 3: 启动 app 并验证俯视渲染**

```bash
npm run dev
```

打开浏览器，切换到俯视图，检查：

1. 房子整体在屏幕中心，北朝上，南朝下。
2. `glass_facade` 蓝色轮廓与 model 外墙对齐。
3. `bedroom_se_south_bay` 在东南角南墙与 `glass_facade` 重合。
4. `master_bedroom_south_bay` 和 `master_bedroom_west_bay` 与对应玻璃幕墙段重合。

- [ ] **Step 4: Commit 验证结果或截图记录**

若验证通过，commit：

```bash
git commit -m "test: verify coordinate alignment via server tests and top-down render"
```

---

## Self-Review

1. **Spec coverage**: 坐标系约定、model-geometry 回退、overlay 回退、渲染器居中、CAD 锚点检查均覆盖。
2. **无占位符**: 所有步骤包含具体文件路径、代码片段和命令。
3. **类型一致性**: 所有 YAML 字段和 TypeScript 常量与现有 schema/类型一致。

**Plan complete and saved to `docs/superpowers/plans/2026-07-15-coordinate-system-standard.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
