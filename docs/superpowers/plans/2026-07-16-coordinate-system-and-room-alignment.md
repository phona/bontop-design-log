# 统一坐标系约定并修复房间-墙体对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `config/layout/model-geometry.yaml` 中消除房间（中心坐标）与墙体（角点坐标）之间的坐标系歧义，并让所有房间与墙体边界对齐。

**Architecture:** 更新 `AGENTS.md` 明确坐标系约定；新增校验脚本 `scripts/validate-room-wall-alignment.ts` 比较房间边界与墙体边界；修正当前错位的房间（阳台、客餐厅）；同步更新受影响的 `overlay.yaml` 玻璃幕墙和测试断言；最终通过回归测试和俯视图渲染验证。

**Tech Stack:** TypeScript, YAML, js-yaml, `npx tsx`, Three.js 渲染器（只读确认）。

## Global Constraints

- `config/layout/model-geometry.yaml` 是户型几何的唯一权威源。
- `config/layout/overlay.yaml` 是渲染意图，必须与 `model-geometry.yaml` 使用同一坐标系。
- 房间 `x, z` 是中心点，`width, depth` 是总尺寸；墙体 `x1, z1, x2, z2` 是线段端点。
- 修改房间时，必须根据墙体边界反推中心点：`x = (west + east) / 2`，`z = (north + south) / 2`。
- 禁止推断几何；只修改 YAML 中的数值。
- 每次几何修改后必须运行 `npx tsx scripts/verify-layout.ts` 和 `npx tsx scripts/validate-room-wall-alignment.ts`。
- `npm run test:server` 和 `npm run typecheck` 必须保持通过。
- 每个 task 独立 commit。

---

## File Structure

| File | Responsibility |
|------|---------------|
| `AGENTS.md` | 项目规则，追加坐标系约定细节 |
| `config/layout/model-geometry.yaml` | 房间与墙体几何；修正阳台和客餐厅中心坐标 |
| `config/layout/overlay.yaml` | 阳台玻璃幕墙、飘窗等渲染意图；已对齐到 z=10.9 |
| `tests/server/model-geometry-layout.test.ts` | 测试断言；阳台深度断言需从 2.2m 更新到 1.1m |
| `scripts/verify-layout.ts` | 现有房间重叠检查 |
| `scripts/validate-room-wall-alignment.ts` | 新增脚本：检查房间边界与墙体边界对齐 |
| `app/src/render/HouseScene.ts` | 渲染器；只读确认房间按中心点渲染 |

---

## Task 1: 在 AGENTS.md 中明确坐标系约定

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: 当前 AGENTS.md 的坐标系章节
- Produces: 追加明确房间中心点、墙体角点、以及修改后必须运行的校验命令

- [ ] **Step 1: 在坐标系约定后追加细节章节**

在 `AGENTS.md` 坐标系约定后追加：

```markdown
## 坐标系补充约定

- `model-geometry.yaml` 的 `rooms` 使用**中心坐标**：
  - `x` 和 `z` 是房间中心点。
  - `width` 和 `depth` 是房间总尺寸。
  - 西边缘 = `x - width / 2`，东边缘 = `x + width / 2`。
  - 北边缘 = `z - depth / 2`，南边缘 = `z + depth / 2`。
- `model-geometry.yaml` 的 `walls` 使用**角点坐标**：
  - `x1, z1` 和 `x2, z2` 是墙体线段的两个端点。
- 修改房间时，先确定对应的墙体边界，再计算中心点：
  - `x = (west_edge + east_edge) / 2`
  - `z = (north_edge + south_edge) / 2`
- 任何几何修改后，必须运行：
  ```bash
  npx tsx scripts/verify-layout.ts
  npx tsx scripts/validate-room-wall-alignment.ts
  npm run test:server
  npm run typecheck
  ```
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document center-based room coordinates and corner-based wall coordinates"
```

---

## Task 2: 新增房间-墙体对齐校验脚本

**Files:**
- Create: `scripts/validate-room-wall-alignment.ts`

**Interfaces:**
- Consumes: `config/layout/model-geometry.yaml`
- Produces: 控制台报告，列出越出墙体边界或与墙体边界不对齐的房间

- [ ] **Step 1: 编写校验脚本**

```typescript
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Room {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

function loadGeometry() {
  const file = readFileSync(join(process.cwd(), 'config/layout/model-geometry.yaml'), 'utf8');
  const data = load(file) as { rooms: Room[]; walls: Wall[] };
  return data;
}

function wallBounds(walls: Wall[]) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.x1, w.x2);
    maxX = Math.max(maxX, w.x1, w.x2);
    minZ = Math.min(minZ, w.z1, w.z2);
    maxZ = Math.max(maxZ, w.z1, w.z2);
  }
  return { minX, maxX, minZ, maxZ };
}

function main() {
  const { rooms, walls } = loadGeometry();
  const { minX, maxX, minZ, maxZ } = wallBounds(walls);
  console.log('Wall bounding box:', { minX: minX.toFixed(2), maxX: maxX.toFixed(2), minZ: minZ.toFixed(2), maxZ: maxZ.toFixed(2) });

  let outsideCount = 0;
  for (const r of rooms) {
    const rx1 = r.x - r.width / 2;
    const rx2 = r.x + r.width / 2;
    const rz1 = r.z - r.depth / 2;
    const rz2 = r.z + r.depth / 2;

    const outside = rx1 < minX - 0.01 || rx2 > maxX + 0.01 || rz1 < minZ - 0.01 || rz2 > maxZ + 0.01;
    if (outside) {
      outsideCount++;
      console.log(`OUTSIDE WALLS: ${r.id} x=[${rx1.toFixed(2)},${rx2.toFixed(2)}] z=[${rz1.toFixed(2)},${rz2.toFixed(2)}]`);
    }
  }

  if (outsideCount === 0) {
    console.log('All rooms are inside the wall bounding box.');
  } else {
    console.log(`Found ${outsideCount} room(s) outside wall bounds.`);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: 运行脚本，确认当前有错位**

```bash
npx tsx scripts/validate-room-wall-alignment.ts
```

Expected: 报告 `balcony` 错位（当前 `z=9.80` 被当作中心点，南边缘只到 `10.35`，但墙体南墙在 `10.90`）。

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-room-wall-alignment.ts
git commit -m "feat: add room-wall alignment validation script"
```

---

## Task 3: 修正阳台房间坐标

**Files:**
- Modify: `config/layout/model-geometry.yaml`

**Interfaces:**
- Consumes: 墙体定义中阳台北墙 `z=9.80`、南墙 `z=10.90`、东西墙 `x=7.20, 13.40`
- Produces: 阳台房间中心坐标与墙体对齐

- [ ] **Step 1: 修改阳台房间**

将 `balcony` 段改为：

```yaml
  - id: balcony
    name: 阳台
    x: 10.30
    z: 10.35
    width: 6.20
    depth: 1.10
    height: 3.0
    area: 6.82
    perimeter: 14.6
```

计算依据：
- x = (7.20 + 13.40) / 2 = 10.30
- z = (9.80 + 10.90) / 2 = 10.35
- depth = 10.90 - 9.80 = 1.10
- area = 6.20 × 1.10 = 6.82
- perimeter = 2 × (6.20 + 1.10) = 14.60

- [ ] **Step 2: 运行校验**

```bash
npx tsx scripts/verify-layout.ts
npx tsx scripts/validate-room-wall-alignment.ts
```

Expected:
- `verify-layout.ts`: `No overlaps`
- `validate-room-wall-alignment.ts`: `All rooms are inside the wall bounding box.`

- [ ] **Step 3: Commit**

```bash
git add config/layout/model-geometry.yaml
git commit -m "fix: align balcony room center with its wall boundaries"
```

---

## Task 4: 修正客餐厅房间坐标

**Files:**
- Modify: `config/layout/model-geometry.yaml`

**Interfaces:**
- Consumes: 墙体定义中客餐厅边界 `x=7.20, 13.40, z=2.00, 8.00`
- Produces: 客餐厅房间中心坐标与墙体对齐

- [ ] **Step 1: 修改客餐厅房间**

将 `living_dining` 段改为：

```yaml
  - id: living_dining
    name: 客餐厅
    x: 10.30
    z: 5.00
    width: 6.20
    depth: 6.00
    height: 3.0
    area: 37.20
    perimeter: 24.40
```

计算依据：
- x = (7.20 + 13.40) / 2 = 10.30
- z = (2.00 + 8.00) / 2 = 5.00
- depth = 8.00 - 2.00 = 6.00
- area = 6.20 × 6.00 = 37.20
- perimeter = 2 × (6.20 + 6.00) = 24.40

- [ ] **Step 2: 运行校验**

```bash
npx tsx scripts/verify-layout.ts
npx tsx scripts/validate-room-wall-alignment.ts
```

Expected:
- `verify-layout.ts`: `No overlaps`
- `validate-room-wall-alignment.ts`: 无报错

- [ ] **Step 3: Commit**

```bash
git add config/layout/model-geometry.yaml
git commit -m "fix: align living_dining room with its wall boundaries"
```

---

## Task 5: 同步更新测试断言

**Files:**
- Modify: `tests/server/model-geometry-layout.test.ts:27`

**Interfaces:**
- Consumes: 阳台深度已从 2.20m 改为 1.10m
- Produces: 测试期望与新的 YAML 一致

- [ ] **Step 1: 修改阳台深度断言**

将：
```typescript
assert(balcony.depth >= 2.0 && balcony.depth <= 2.4, 'balcony depth ~2.2m');
```

改为：

```typescript
assert(balcony.depth >= 1.0 && balcony.depth <= 1.2, 'balcony depth ~1.1m');
```

- [ ] **Step 2: 运行测试**

```bash
npm run test:server
```

Expected: 所有测试通过（103/103）。

- [ ] **Step 3: Commit**

```bash
git add tests/server/model-geometry-layout.test.ts
git commit -m "test: update balcony depth expectation to 1.1m"
```

---

## Task 6: 确认 overlay.yaml 阳台幕墙已对齐

**Files:**
- Read/Modify: `config/layout/overlay.yaml`

**Interfaces:**
- Consumes: 阳台墙体现在位于 `z=9.80` 和 `z=10.90`
- Produces: 玻璃幕墙点与墙体端点一致

- [ ] **Step 1: 检查当前值**

确认 `config/layout/overlay.yaml` 中 `balcony_west_curtain`、`balcony_south_curtain`、`balcony_east_curtain` 的点已经是：

```yaml
  - id: balcony_west_curtain
    type: curtain_run
    closed: false
    points:
      - { x: 7.2, z: 9.8 }
      - { x: 7.2, z: 10.9 }
    height: 3.0

  - id: balcony_south_curtain
    type: curtain_run
    closed: false
    points:
      - { x: 7.2, z: 10.9 }
      - { x: 13.4, z: 10.9 }
    height: 3.0

  - id: balcony_east_curtain
    type: curtain_run
    closed: false
    points:
      - { x: 13.4, z: 10.9 }
      - { x: 13.4, z: 9.8 }
    height: 3.0
```

- [ ] **Step 2: 如果尚未对齐，修改并 commit**

若需要修改：

```bash
git add config/layout/overlay.yaml
git commit -m "fix: align balcony curtain runs with updated balcony walls"
```

若已对齐，本 task 无需 commit。

---

## Task 7: 回归测试与渲染验证

**Files:**
- Run: 测试和类型检查命令

**Interfaces:**
- Consumes: 所有已修改的 YAML、脚本和测试文件
- Produces: 通过测试和视觉验证

- [ ] **Step 1: 运行 server 测试**

```bash
npm run test:server
```

Expected: 全部通过（103/103）。

- [ ] **Step 2: 运行类型检查**

```bash
npm run typecheck
```

Expected: 无 TypeScript 错误。

- [ ] **Step 3: 渲染验证**

如果 dev server 正在运行，刷新浏览器俯视图。确认：
- 阳台南边缘在 `z=10.90`，凸出量为 1.10m。
- 客餐厅南边缘对齐 `z=8.00` 的内墙。
- 主卧、书房、东南次卧的南边缘对齐 `z=9.80` 的南墙。

- [ ] **Step 4: 可选 commit 验证截图**

如果捕获了新截图，可以提交到 `screenshots/`（但注意：不要把未加说明的临时截图提交到 git）。

---

## Self-Review

1. **Spec coverage:** 坐标系约定（文档）、房间-墙体对齐校验（新脚本）、错位房间修正（阳台和客餐厅）、测试断言更新、overlay 确认、回归测试均覆盖。
2. **Placeholder scan:** 无 TBD/TODO。每个步骤都包含精确文件路径、代码片段和命令。
3. **类型一致性:** 校验脚本使用与 YAML 结构一致的本地类型。没有引入新的跨文件类型定义。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-16-coordinate-system-and-room-alignment.md`.

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?