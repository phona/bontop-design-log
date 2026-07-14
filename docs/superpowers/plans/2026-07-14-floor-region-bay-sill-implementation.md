# floor_region 与 bay_sill 覆盖层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在声明式 overlay 架构下新增 `floor_region` 和 `bay_sill` 两种场景元素，解决 3D 漫游中地板缝隙与上飘窗缺失问题。

**Architecture:** 延续 DXF 几何 + YAML 意图的铁律：CAD 只输出墙体几何，overlay.yaml 显式声明哪些墙是幕墙、哪些区域需要补地板、哪些幕墙段需要内凹成飘窗；合并逻辑仅保留 DXF 墙段为 `wall` 并追加 overlay 元素，不添加任何几何推断。新增类型通过 `shared/types.ts` 的判别联合、`server/overlay-merge.ts` 的 zod schema 校验、`config/layout/overlay.yaml` 的配置声明以及 `app/src/render/HouseScene.ts` 的渲染 case 共同实现。

**Tech Stack:** TypeScript, Zod, Three.js, js-yaml, Node.js test runner, pytest.

## Global Constraints

- CAD 只出几何，config 出一切意图；代码只读、只执行，禁止推断。
- `parse_cad.py` 输出的墙体只有 `x1/z1/x2/z2` 纯几何字段；禁止追加分类/意图字段。
- 合并逻辑（`server/overlay-merge.ts`）只有 suppress 和 add 两条机械规则。
- 禁止添加任何基于几何位置、边界、邻接关系的自动分类启发式。
- 配置校验失败必须报错（fail loud）；禁止静默跳过或“智能降级”。
- 守卫测试位于 `scripts/parse_cad_test.py` 与 `tests/server/overlay-merge.test.ts`；删除或绕过视同违反铁律。

---

## Task 1: 扩展 SceneElement 类型

**Files:**
- Modify: `shared/types.ts:350-363`

**Interfaces:**
- Consumes: 现有 `CurtainPoint`、`OverlayPoint` 类型。
- Produces: `SceneElement` 联合新增 `floor_region` 与 `bay_sill` 两个分支；后续 zod schema 与渲染器 case 均依赖这些分支。

- [ ] **Step 1: 在 SceneElement 联合中追加两种元素**

```ts
export type SceneElement =
  | { type: 'wall'; id: string; x1: number; z1: number; x2: number; z2: number }
  | { type: 'curtain_run'; id: string; points: CurtainPoint[]; height: number; closed?: boolean }
  | { type: 'wall_run'; id: string; points: OverlayPoint[]; height: number }
  | { type: 'glass_infill'; id: string; room: string; wall: 'north' | 'south' | 'east' | 'west'; center_offset: number; width: number; height: number; sill: number }
  | { type: 'floor_region'; id: string; points: CurtainPoint[]; room?: string }
  | { type: 'bay_sill'; id: string; points: OverlayPoint[]; depth: number; sill: number; height: number };
```

- [ ] **Step 2: 运行类型检查**

Run: `npm run typecheck`
Expected: 仅因渲染器尚未处理新类型而报错（见 Task 4 修复）。

- [ ] **Step 3: 提交**

```bash
git add shared/types.ts
git commit -m "types: add floor_region and bay_sill to SceneElement union"
```

---

## Task 2: 在 overlay-merge.ts 中新增 zod schema

**Files:**
- Modify: `server/overlay-merge.ts:1-66`

**Interfaces:**
- Consumes: `CurtainPointSchema`、`PointSchema`（已存在）。
- Produces: `FloorRegionSchema`、`BaySillSchema` 被加入 `OverlaySchema.elements` 的 `z.discriminatedUnion`；`parseOverlay` 和 `mergeSceneElements` 自动支持新类型。

- [ ] **Step 1: 在 GlassInfillSchema 后添加 FloorRegionSchema 与 BaySillSchema**

```ts
const FloorRegionSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('floor_region'),
    points: z.array(CurtainPointSchema).min(3),
    room: z.string().min(1).optional(),
  })
  .strict();

const BaySillSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('bay_sill'),
    points: z.array(PointSchema).min(2),
    depth: z.number().positive(),
    sill: z.number().min(0),
    height: z.number().positive(),
  })
  .strict();
```

- [ ] **Step 2: 把两个 schema 加入 discriminatedUnion**

```ts
const OverlaySchema = z
  .object({
    version: z.literal(1),
    suppress: z.array(SuppressSchema).default([]),
    elements: z
      .array(
        z.discriminatedUnion('type', [
          CurtainRunSchema,
          WallRunSchema,
          GlassInfillSchema,
          FloorRegionSchema,
          BaySillSchema,
        ])
      )
      .default([]),
  })
  .strict();
```

- [ ] **Step 3: 编写失败测试——验证 floor_region 至少 3 个点**

```ts
it('rejects floor_region with fewer than 3 points', () => {
  assert.throws(() =>
    parseOverlay(`
version: 1
elements:
  - id: bad_floor
    type: floor_region
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
`)
  );
});
```

- [ ] **Step 4: 编写失败测试——验证 bay_sill 至少 2 个点**

```ts
it('rejects bay_sill with fewer than 2 points', () => {
  assert.throws(() =>
    parseOverlay(`
version: 1
elements:
  - id: bad_bay
    type: bay_sill
    points: [{x: 0, z: 0}]
    depth: 1.0
    sill: 0.45
    height: 2.55
`)
  );
});
```

- [ ] **Step 5: 编写失败测试——未知/额外字段报错**

```ts
it('rejects floor_region with unknown extra fields', () => {
  assert.throws(() =>
    parseOverlay(`
version: 1
elements:
  - id: bad_floor
    type: floor_region
    points: [{x: 0, z: 0}, {x: 1, z: 0}, {x: 1, z: 1}]
    auto_fill: true
`)
  );
});

it('rejects bay_sill with unknown extra fields', () => {
  assert.throws(() =>
    parseOverlay(`
version: 1
elements:
  - id: bad_bay
    type: bay_sill
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
    depth: 1.0
    sill: 0.45
    height: 2.55
    width: 3.0
`)
  );
});
```

- [ ] **Step 6: 运行测试**

Run: `npm run test:server`
Expected: 新测试全部 PASS；既有测试仍 PASS。

- [ ] **Step 7: 提交**

```bash
git add server/overlay-merge.ts tests/server/overlay-merge.test.ts
git commit -m "feat: add zod schemas for floor_region and bay_sill"
```

---

## Task 3: 在 overlay.yaml 中声明 floor_region 与 bay_sill 实例

**Files:**
- Modify: `config/layout/overlay.yaml:23-45`

**Interfaces:**
- Consumes: `floor_region` 与 `bay_sill` schema（Task 2）。
- Produces: 配置错误横幅不再出现；`/api/project` 返回的 `sceneElements` 包含新增元素。

- [ ] **Step 1: 在 glass_infill 后追加 floor_region 示例与 bay_sill 清单**

```yaml
  # 地板补区：覆盖房间矩形之间的缝隙/过渡区
  - id: corridor_floor
    type: floor_region
    points:
      - {x: 0.63, z: -1.96}
      - {x: 3.08, z: -1.96}
      - {x: 3.08, z: -1.08}
      - {x: 0.63, z: -1.08}
    reason: "客餐厅与走廊过渡区，房间矩形未覆盖"

  # 上飘窗：沿 curtain_run 向内凹陷
  - id: master_left_bay
    type: bay_sill
    points:
      - {x: -5.88, z: -0.93}
      - {x: -5.88, z: 4.39}
    depth: 1.10
    sill: 0.45
    height: 2.55
    reason: "主卧西墙上飘窗"

  - id: bedroom_nw_bay
    type: bay_sill
    points:
      - {x: -5.88, z: -2.99}
      - {x: -5.88, z: -0.93}
    depth: 1.10
    sill: 0.45
    height: 2.55
    reason: "西北次卧西墙上飘窗"

  - id: master_top_bay
    type: bay_sill
    points:
      - {x: -5.363, z: 5.39}
      - {x: -2.23, z: 5.39}
    depth: 1.10
    sill: 0.45
    height: 2.55
    reason: "主卧北墙上飘窗"

  - id: bedroom_se_bay
    type: bay_sill
    points:
      - {x: -2.23, z: 5.39}
      - {x: 0.39, z: 5.39}
    depth: 1.10
    sill: 0.45
    height: 2.55
    reason: "东南次卧北墙上飘窗"

  - id: master_bottom_bay
    type: bay_sill
    points:
      - {x: -0.578, z: -4.323}
      - {x: -5.75, z: -3.17}
    depth: 1.10
    sill: 0.45
    height: 2.55
    reason: "主卧 SW 对角线上飘窗"
```

- [ ] **Step 2: 验证 overlay.yaml 可通过 zod 校验**

Run: `tsx -e "import { parseOverlay } from './server/overlay-merge.js'; import { readFileSync } from 'fs'; parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')); console.log('OK');"`
Expected: 输出 `OK`。

- [ ] **Step 3: 提交**

```bash
git add config/layout/overlay.yaml
git commit -m "config: add floor_region and bay_sill overlays"
```

---

## Task 4: 在 HouseScene.ts 中渲染 floor_region

**Files:**
- Modify: `app/src/render/HouseScene.ts:295-308`

**Interfaces:**
- Consumes: `SceneElement` 中 `type: 'floor_region'` 分支（Task 1）。
- Produces: `renderFloorRegion` 方法生成 `THREE.Mesh` 并加入 `floorMeshes`，使材质纹理系统可统一处理。

- [ ] **Step 1: 在 buildSceneElements 的 switch 中新增 case**

```ts
switch (el.type) {
  case 'wall': this.renderWallSegment(el, defaultHeight); break;
  case 'curtain_run': this.renderCurtainRun(el); break;
  case 'wall_run': this.renderWallRun(el); break;
  case 'glass_infill': this.renderGlassInfill(el); break;
  case 'floor_region': this.renderFloorRegion(el); break;
  case 'bay_sill': this.renderBaySill(el); break;
  default: {
    const exhaustive: never = el;
    console.error('[HouseScene] 未知场景元素类型（渲染器缺 case）', exhaustive);
  }
}
```

- [ ] **Step 2: 实现 renderFloorRegion 方法**

```ts
private renderFloorRegion(el: Extract<SceneElement, { type: 'floor_region' }>) {
  const shape = this.buildRoundedShape(el.points);
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: DEFAULT_FLOOR,
    roughness: 0.75,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.006;
  mesh.userData = { type: 'floor_region', objectId: el.id, roomId: el.room };
  mesh.receiveShadow = true;
  this.scene.add(mesh);
  this.floorMeshes.push(mesh);
}

private buildRoundedShape(points: CurtainPoint[]): THREE.Shape {
  const n = points.length;
  const shape = new THREE.Shape();
  if (n < 3) return shape;

  let first = true;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    if (curr.radius && curr.radius > 0) {
      const arc = this.centerlineArc(prev, curr, next);
      if (arc) {
        if (first) {
          shape.moveTo(arc.start.x, arc.start.z);
          first = false;
        } else {
          shape.lineTo(arc.start.x, arc.start.z);
        }
        shape.absarc(arc.center.x, arc.center.z, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
      } else {
        if (first) {
          shape.moveTo(curr.x, curr.z);
          first = false;
        } else {
          shape.lineTo(curr.x, curr.z);
        }
      }
    } else {
      if (first) {
        shape.moveTo(curr.x, curr.z);
        first = false;
      } else {
        shape.lineTo(curr.x, curr.z);
      }
    }
  }
  shape.closePath();
  return shape;
}
```

- [ ] **Step 3: 运行 app 类型检查**

Run: `npm run typecheck`
Expected: 此时 `floor_region` 部分无错，`bay_sill` 仍缺失（见 Task 5 修复）。

- [ ] **Step 4: 提交**

```bash
git add app/src/render/HouseScene.ts
git commit -m "feat(renderer): render floor_region polygon patches"
```

---

## Task 5: 在 HouseScene.ts 中渲染 bay_sill

**Files:**
- Modify: `app/src/render/HouseScene.ts:310-330`

**Interfaces:**
- Consumes: `SceneElement` 中 `type: 'bay_sill'` 分支（Task 1）。
- Produces: `renderBaySill` 方法沿 `curtain_run` 向内生成实心水泥凹盒，不破坏幕墙连续性。

- [ ] **Step 1: 实现 renderBaySill 方法**

```ts
private renderBaySill(el: Extract<SceneElement, { type: 'bay_sill' }>) {
  if (el.points.length < 2) return;
  const a = el.points[0];
  const b = el.points[el.points.length - 1];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return;

  // curtain_run 为顺时针，室内在行进方向右侧 => 内法向为 (dz, -dx)
  const nx = dz / length;
  const nz = -dx / length;

  const cx = (a.x + b.x) / 2;
  const cz = (a.z + b.z) / 2;
  const cy = el.sill + el.height / 2;

  const concrete = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.9,
  });
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, el.height, el.depth),
    concrete
  );
  mesh.position.set(
    cx + nx * el.depth / 2,
    cy,
    cz + nz * el.depth / 2
  );
  if (length > 0) {
    mesh.rotation.y = Math.atan2(dz, dx);
  }
  mesh.userData = { type: 'bay_sill', objectId: el.id };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  this.scene.add(mesh);
}
```

- [ ] **Step 2: 运行完整类型检查**

Run: `npm run typecheck`
Expected: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add app/src/render/HouseScene.ts
git commit -m "feat(renderer): render bay_sill recesses from curtain_run"
```

---

## Task 6: 补充 overlay-merge 集成测试

**Files:**
- Modify: `tests/server/overlay-merge.test.ts:185-200`

**Interfaces:**
- Consumes: `parseOverlay` 和 `mergeSceneElements`（Task 2）。
- Produces: 新增断言覆盖 floor_region 与 bay_sill 的解析与合并行为。

- [ ] **Step 1: 在 elements appended 测试后追加集成测试**

```ts
it('accepts floor_region and bay_sill in overlay', () => {
  const cfg = parseOverlay(`
version: 1
elements:
  - id: corridor_floor
    type: floor_region
    points:
      - {x: 0, z: 0}
      - {x: 2, z: 0}
      - {x: 2, z: 1}
      - {x: 0, z: 1}
    room: living_dining
  - id: master_bay
    type: bay_sill
    points:
      - {x: -5.88, z: -0.93}
      - {x: -5.88, z: 4.39}
    depth: 1.10
    sill: 0.45
    height: 2.55
`);
  const out = mergeSceneElements(WALLS, cfg);
  const floor = out.find((e) => e.id === 'corridor_floor');
  assert.equal(floor?.type, 'floor_region');
  if (floor?.type === 'floor_region') {
    assert.equal(floor.room, 'living_dining');
    assert.equal(floor.points.length, 4);
  }
  const bay = out.find((e) => e.id === 'master_bay');
  assert.equal(bay?.type, 'bay_sill');
  if (bay?.type === 'bay_sill') {
    assert.equal(bay.depth, 1.10);
    assert.equal(bay.sill, 0.45);
    assert.equal(bay.height, 2.55);
  }
});
```

- [ ] **Step 2: 运行测试**

Run: `npm run test:server`
Expected: 全部 PASS。

- [ ] **Step 3: 提交**

```bash
git add tests/server/overlay-merge.test.ts
git commit -m "test: add floor_region and bay_sill integration tests"
```

---

## Task 7: 验证 parse_cad 守卫仍有效

**Files:**
- 无需修改（仅运行测试）。

**Interfaces:**
- Consumes: `scripts/parse_cad_test.py` 现有守卫测试。
- Produces: 确认 `parse_cad.py` 未因本次改动引入意图字段或几何推断。

- [ ] **Step 1: 运行 Python 测试**

Run: `pytest scripts/parse_cad_test.py -q`
Expected: 全部 PASS。

- [ ] **Step 2: 如果 parse_cad_test.py 失败，修复 parse_cad.py 后重新运行；不要修改测试绕过铁律。**

- [ ] **Step 3: 提交（如有修复）**

```bash
git add scripts/parse_cad.py
git commit -m "fix: keep parse_cad geometry-only after overlay changes"
```

---

## Task 8: 端到端验证

**Files:**
- 无需修改（仅运行命令）。

**Interfaces:**
- Consumes: 全部实现内容。
- Produces: 确认 `/api/project` 返回正确元素，渲染器无控制台报错。

- [ ] **Step 1: 启动 server 并抓取 /api/project 中的 sceneElements**

Run: `npm run dev:server &`
在另一个终端运行：
```bash
curl -s http://localhost:3000/api/project | npx json "house.sceneElements" | head -n 80
```
Expected: 输出包含 `floor_region` 和 5 个 `bay_sill` 元素；顺序为 wall → curtain_run → glass_infill → floor_region → bay_sill。

- [ ] **Step 2: 运行全量类型检查与测试**

Run: `npm run typecheck && npm run test:server && pytest scripts/parse_cad_test.py -q`
Expected: 全部通过。

- [ ] **Step 3: 提交（如 server 路由有调整）**

```bash
git add server/routes.ts  # 仅在需要时
git commit -m "chore: route adjustments for scene elements"
```

---

## Self-Review

**1. Spec coverage:**
- `floor_region` schema + 渲染：Task 2、Task 4 覆盖。
- `bay_sill` schema + 渲染：Task 2、Task 5 覆盖。
- 坐标对齐 curtain_run：Task 3 覆盖。
- 无几何推断：渲染器仅按声明类型和字段执行，未读取位置/邻接关系推断类别；Task 7 守卫测试覆盖。
- 校验失败 fail loud：zod `.strict()` 和 `.min()` 保证，Task 2 测试覆盖。
- 不改动地砖材质系统：Task 4 仅使用 `DEFAULT_FLOOR`，未触及 `TextureFactory`/`TopicRegistry`。
- 不删除房间矩形地板：Task 4 追加 mesh，不替换现有地板。

**2. Placeholder scan：** 无 TBD、无 “implement later”、无 “类似 Task X”。每个步骤均给出具体代码、命令和预期输出。

**3. Type consistency：**
- `floor_region` 使用 `CurtainPoint[]`（支持 `radius`），与 schema 和 renderer 一致。
- `bay_sill` 使用 `OverlayPoint[]`（2 点），与 schema 和 renderer 一致。
- `SceneElement` 联合、zod schema、renderer switch 三处类型名称一致。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-14-floor-region-bay-sill-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
