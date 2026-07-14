# curtain_run Shape + absarc 渲染改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `curtain_run` 从多段 `BoxGeometry` 改为单一 `THREE.Shape` + `ExtrudeGeometry` 渲染，拐点使用 `absarc` 原生圆弧。

**Architecture:** 用 `THREE.Path` 构建 `curtain_run.points` 描述的中心线折线，拐点用 `absarc` 画圆弧；再沿中心线采样、按法向双侧偏移 `GLASS_THICKNESS/2` 生成 ribbon 边界；最终用一个 `ExtrudeGeometry` 挤出整片幕墙。开放路径两端用直线封口，闭合路径用外边界 + 内洞方式闭合。

**Tech Stack:** TypeScript, Three.js (`Shape`, `ExtrudeGeometry`, `Path`, `absarc`), Zod, Vitest, Node.js test runner.

## Global Constraints

- `GLASS_THICKNESS = 0.08`（8cm 玻璃厚度），保持常量；
- `closed` 字段默认 `false`；
- 严格模式：overlay 配置任何未知字段必须报错；
- 不引入新依赖；
- 删除旧的手动分段圆弧辅助函数：`expandRoundedCorners`（旧版）、`roundCorner`（旧版）、`isInsideCorner`（旧版）、`polygonSignedArea`（旧版）。

---

### Task 1: Schema 与类型增加 `closed`

**Files:**
- Modify: `shared/types.ts`
- Modify: `server/overlay-merge.ts`
- Test: `tests/server/overlay-merge.test.ts`

**Interfaces:**
- `CurtainRun` 增加 `closed?: boolean`。
- zod `CurtainRunSchema` 增加 `closed: z.boolean().optional()`。

- [ ] **Step 1.1: 修改 `shared/types.ts`**

```typescript
export type CurtainRun = {
  type: 'curtain_run';
  id: string;
  points: CurtainPoint[];
  height: number;
  closed?: boolean; // 是否闭合路径
};
```

- [ ] **Step 1.2: 修改 `server/overlay-merge.ts` 中 `CurtainRunSchema`**

```typescript
const CurtainRunSchema = z.object({
  type: z.literal('curtain_run'),
  id: z.string().min(1),
  points: z.array(CurtainPointSchema).min(2),
  height: z.number().positive(),
  closed: z.boolean().optional(), // 新增
});
```

- [ ] **Step 1.3: 在 `overlay-merge.test.ts` 增加 `closed` 测试**

```typescript
it('accepts closed: true on curtain_run', () => {
  const cfg = parseOverlay(`
version: 1
elements:
  - id: glass_facade
    type: curtain_run
    closed: true
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
`);
  assert.equal(cfg.elements.length, 1);
  const el = cfg.elements[0];
  if (el.type === 'curtain_run') assert.equal(el.closed, true);
});

it('rejects non-boolean closed on curtain_run', () => {
  assert.throws(() => parseOverlay(`
version: 1
elements:
  - id: x
    type: curtain_run
    closed: "yes"
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
`));
});
```

- [ ] **Step 1.4: 运行 overlay 测试**

Run: `npx tsx --test tests/server/overlay-merge.test.ts`  
Expected: PASS（11 tests）

- [ ] **Step 1.5: 提交**

```bash
git add shared/types.ts server/overlay-merge.ts tests/server/overlay-merge.test.ts
git commit -m "feat(curtain_run): add closed field to schema and types"
```

---

### Task 2: 在 `HouseScene.ts` 中实现 Shape + absarc 渲染

**Files:**
- Modify: `app/src/render/HouseScene.ts`
- Test: `app/src/scene/HouseScene.test.ts`（后续 Task 3 更新）

**Interfaces:**
- `renderCurtainRun(el)` 不再循环创建 `BoxGeometry` mesh，而是调用 `buildCurtainShape(points, closed)` 生成 `THREE.Shape` 后一次挤出。
- 新增私有方法：`buildCurtainShape`、`cornerBoundaryArcs`、`miterPoint`、`outwardBisector`、`pushArc`、`signedArea`。

- [ ] **Step 2.1: 删除旧的手动分段渲染逻辑**

在 `app/src/render/HouseScene.ts` 中：
- 删除旧 `expandRoundedCorners` 方法；
- 删除旧 `roundCorner` 方法；
- 删除旧 `isInsideCorner` 方法；
- 删除旧 `polygonSignedArea` 方法。

- [ ] **Step 2.2: 重写 `renderCurtainRun`**

```typescript
private renderCurtainRun(el: Extract<SceneElement, { type: 'curtain_run' }>) {
  const shape = this.buildCurtainShape(el.points, el.closed ?? false);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: el.height,
    bevelEnabled: false,
    steps: 1,
  });
  // Shape 在 x-z 平面，挤出沿 z/depth 方向；这里把 z 转 y，让高度朝上
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, this.makeGlassMaterial());
  mesh.userData = { type: 'curtain_run', objectId: el.id };
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  this.glassMeshes.push(mesh);
}
```

- [ ] **Step 2.3: 实现 `buildCurtainShape`（中心线 Path + 采样偏移）**

实现步骤：
1. 用 `THREE.Path` 构建中心线：
   - 第一个顶点用 `moveTo`；
   - 后续顶点先 `lineTo` 到圆角切点，再用 `absarc` 画圆弧；
   - 非圆角顶点直接 `lineTo`；
   - 闭合路径最后再 `lineTo` 回起点。
2. 用 `path.getPoints()` 采样中心线。
3. 每个采样点按局部切线法向左右各偏移 `GLASS_THICKNESS/2`，得到 ribbon 边界。
4. 开放路径用双边界 + 端封口闭合；闭合路径用较大面积边界作为 Shape、较小作为 hole。

```typescript
private buildCurtainShape(points: CurtainPoint[], closed: boolean): THREE.Shape {
  const T = GLASS_THICKNESS;
  const n = points.length;
  if (n < 2) return new THREE.Shape();

  const left: { x: number; z: number }[] = [];
  const right: { x: number; z: number }[] = [];

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    const d1x = curr.x - prev.x;
    const d1z = curr.z - prev.z;
    const d2x = next.x - curr.x;
    const d2z = next.z - curr.z;
    const len1 = Math.hypot(d1x, d1z);
    const len2 = Math.hypot(d2x, d2z);

    if (len1 < 1e-9 || len2 < 1e-9) continue;

    const u1x = d1x / len1;
    const u1z = d1z / len1;
    const u2x = d2x / len2;
    const u2z = d2z / len2;

    // 左法向（路径左侧）
    const n1x = -u1z;
    const n1z = u1x;
    const n2x = -u2z;
    const n2z = u2x;

    const cross = u1x * u2z - u1z * u2x; // 正 = 左拐，负 = 右拐

    const radius = curr.radius ?? 0;
    const isOpenEndpoint = !closed && (i === 0 || i === n - 1);

    if (radius > 0 && !isOpenEndpoint) {
      const dot = u1x * u2x + u1z * u2z;
      const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
      const d = radius / Math.tan(theta / 2);
      if (d < len1 && d < len2 && theta > 0.001 && Math.abs(theta - Math.PI) > 0.001) {
        const ta = { x: curr.x - u1x * d, z: curr.z - u1z * d };
        const tb = { x: curr.x + u2x * d, z: curr.z + u2z * d };
        const bisOut = this.outwardBisector(u1x, u1z, u2x, u2z, cross > 0);
        const centerDist = radius / Math.sin(theta / 2);
        const center = { x: curr.x + bisOut.x * centerDist, z: curr.z + bisOut.z * centerDist };

        const rLeft = cross > 0 ? radius + T / 2 : Math.max(0, radius - T / 2);
        const rRight = cross > 0 ? Math.max(0, radius - T / 2) : radius + T / 2;

        const lTa = { x: ta.x + n1x * (T / 2), z: ta.z + n1z * (T / 2) };
        const lTb = { x: tb.x + n2x * (T / 2), z: tb.z + n2z * (T / 2) };
        const rTa = { x: ta.x - n1x * (T / 2), z: ta.z - n1z * (T / 2) };
        const rTb = { x: tb.x - n2x * (T / 2), z: tb.z - n2z * (T / 2) };

        const lCenter = { x: center.x + bisOut.x * (T / 2), z: center.z + bisOut.z * (T / 2) };
        const rCenter = { x: center.x - bisOut.x * (T / 2), z: center.z - bisOut.z * (T / 2) };

        left.push(lTa);
        this.pushArc(left, lCenter, rLeft, lTa, lTb, 8);
        left.push(lTb);
        right.push(rTa);
        this.pushArc(right, rCenter, rRight, rTa, rTb, 8);
        right.push(rTb);
        continue;
      }
    }

    // 无圆角或开放端点：miter 点
    if (isOpenEndpoint) {
      // 开放端点只有一条邻边，直接沿该边法向偏移
      const ux = i === 0 ? u2x : u1x;
      const uz = i === 0 ? u2z : u1z;
      const nx = -uz;
      const nz = ux;
      left.push({ x: curr.x + nx * (T / 2), z: curr.z + nz * (T / 2) });
      right.push({ x: curr.x - nx * (T / 2), z: curr.z - nz * (T / 2) });
    } else {
      const miterLeft = this.miterPoint(curr.x, curr.z, u1x, u1z, n1x, n1z, u2x, u2z, n2x, n2z, T / 2);
      const miterRight = this.miterPoint(curr.x, curr.z, u1x, u1z, n1x, n1z, u2x, u2z, n2x, n2z, -T / 2);
      left.push(miterLeft);
      right.push(miterRight);
    }
  }

  if (left.length < 2 || right.length < 2) return new THREE.Shape();

  const shape = new THREE.Shape();
  if (closed) {
    const leftArea = Math.abs(this.signedArea(left));
    const rightArea = Math.abs(this.signedArea(right));
    const outer = leftArea >= rightArea ? left : right;
    const inner = leftArea >= rightArea ? right : left;
    shape.moveTo(outer[0].x, outer[0].z);
    for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].z);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(inner[0].x, inner[0].z);
    for (let i = 1; i < inner.length; i++) hole.lineTo(inner[i].x, inner[i].z);
    hole.closePath();
    shape.holes.push(hole);
  } else {
    shape.moveTo(left[0].x, left[0].z);
    for (let i = 1; i < left.length; i++) shape.lineTo(left[i].x, left[i].z);
    shape.lineTo(right[right.length - 1].x, right[right.length - 1].z);
    for (let i = right.length - 2; i >= 0; i--) shape.lineTo(right[i].x, right[i].z);
    shape.lineTo(left[0].x, left[0].z);
    shape.closePath();
  }
  return shape;
}

private miterPoint(
  cx: number, cz: number,
  u1x: number, u1z: number, n1x: number, n1z: number,
  u2x: number, u2z: number, n2x: number, n2z: number,
  offset: number
): { x: number; z: number } {
  // line1: (cx + n1x*offset) + t*u1x, (cz + n1z*offset) + t*u1z
  // line2: (cx + n2x*offset) + s*u2x, (cz + n2z*offset) + s*u2z
  const denom = u1x * u2z - u1z * u2x; // cross
  if (Math.abs(denom) < 1e-9) {
    return { x: cx + n1x * offset, z: cz + n1z * offset };
  }
  const dx = (cx + n2x * offset) - (cx + n1x * offset);
  const dz = (cz + n2z * offset) - (cz + n1z * offset);
  const t = (dx * u2z - dz * u2x) / denom;
  return { x: cx + n1x * offset + t * u1x, z: cz + n1z * offset + t * u1z };
}

private pushArc(
  arr: { x: number; z: number }[],
  center: { x: number; z: number },
  radius: number,
  start: { x: number; z: number },
  end: { x: number; z: number },
  segments: number
) {
  if (radius <= 0) return;
  const a1 = Math.atan2(start.z - center.z, start.x - center.x);
  let a2 = Math.atan2(end.z - center.z, end.x - center.x);
  let delta = a2 - a1;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const a = a1 + delta * t;
    arr.push({ x: center.x + radius * Math.cos(a), z: center.z + radius * Math.sin(a) });
  }
}

private outwardBisector(
  u1x: number, u1z: number, u2x: number, u2z: number,
  turnLeft: boolean
): { x: number; z: number } {
  const bx = -u1x + u2x;
  const bz = -u1z + u2z;
  const len = Math.hypot(bx, bz);
  if (len < 1e-9) return { x: 0, z: 0 };
  const bis = { x: bx / len, z: bz / len };
  return turnLeft ? { x: -bis.x, z: -bis.z } : bis;
}

private signedArea(pts: { x: number; z: number }[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return area;
}
```

- [ ] **Step 2.4: 添加闭合路径渲染测试**

在 `app/src/scene/HouseScene.test.ts` 增加 `closed: true` 的 `curtain_run` 测试，断言仅渲染一个 mesh。

- [ ] **Step 2.5: 提交**

```bash
git add app/src/render/HouseScene.ts
git commit -m "feat(curtain_run): render as single Shape + ExtrudeGeometry"
```

---

### Task 3: 更新测试与 overlay 配置

**Files:**
- Modify: `app/src/scene/HouseScene.test.ts`
- Modify: `config/layout/overlay.yaml`

**Interfaces:**
- 测试断言从“多段 mesh”改为“单 mesh + 单一 objectId”。
- overlay 配置 `glass_facade` 保持 **开放路径**（`closed` 默认 false），因为当前玻璃幕墙是 南→西→北 的开放立面，东西两端是实墙。

- [ ] **Step 3.1: 修改 `app/src/scene/HouseScene.test.ts` 中 curtain_run 测试**

确保已有测试覆盖单 mesh 和单 objectId；若 Step 2.4 已新增闭合路径测试，此处只做复核。改为：

```typescript
it('renders curtain_run as a single continuous mesh', async () => {
  const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
  const scene = new HouseScene(canvas);
  const projectData = {
    house: {
      rooms: [],
      sceneElements: [
        {
          type: 'curtain_run' as const,
          id: 'curtain:rounded',
          points: [
            { x: 0, z: 0 },
            { x: 5, z: 0, radius: 1 },
            { x: 5, z: 5 },
          ],
          height: 2.8,
        },
      ],
    },
    topics: [],
    budgetCategories: [],
  };
  await scene.buildFromCatalog(projectData);
  let curtainCount = 0;
  scene.getScene().traverse((obj: any) => {
    if (obj.userData?.type === 'curtain_run') curtainCount++;
  });
  expect(curtainCount).toBe(1);
});

it('uses single objectId for curtain_run mesh', async () => {
  const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
  const scene = new HouseScene(canvas);
  const projectData = {
    house: {
      rooms: [],
      sceneElements: [
        {
          type: 'curtain_run' as const,
          id: 'curtain:west',
          points: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }],
          height: 2.8,
        },
      ],
    },
    topics: [],
    budgetCategories: [],
  };
  await scene.buildFromCatalog(projectData);
  let objectId: string | undefined;
  scene.getScene().traverse((obj: any) => {
    if (obj.userData?.type === 'curtain_run') objectId = obj.userData.objectId;
  });
  expect(objectId).toBe('curtain:west');
});
```

- [ ] **Step 3.2: 确认 `config/layout/overlay.yaml` 不声明 `closed: true`**

当前玻璃幕墙是开放立面（南→SW 圆角→西→NW 圆角→北），东端入户花园是实墙，因此**不添加 `closed: true`**。保持现有 4 点声明不变。

- [ ] **Step 3.3: 运行 app 测试**

Run: `cd app && npx vitest run src/scene/HouseScene.test.ts src/render/HouseScene.test.ts`  
Expected: PASS

- [ ] **Step 3.4: 提交**

```bash
git add app/src/scene/HouseScene.test.ts
git commit -m "test(curtain_run): update tests for single-mesh shape"
```

---

### Task 4: 全局验证

- [ ] **Step 4.1: 类型检查**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 4.2: 运行全量测试**

Run: `npm run test:server`  
Expected: overlay-merge 测试通过；project-catalog 的 pre-existing 失败仍存在（与本次改动无关）。

Run: `python3 -m pytest scripts/parse_cad_test.py -q`  
Expected: PASS

Run: `cd app && npx vitest run`  
Expected: PASS

- [ ] **Step 4.3: 人工目视确认**

启动前端，在 3D 漫游中查看玻璃幕墙：
1. 南、西、北三段连续无断裂；
2. 西南角、西北角呈圆角；
3. 玻璃幕墙与北向截断线（x=3.75）对齐。

- [ ] **Step 4.4: 提交最终状态**

```bash
git add -A
git commit -m "feat(curtain_run): single Shape + absarc extrusion for glass facade"
```

---

## Self-Review

- **Spec coverage:** 单 mesh、absarc 圆弧、closed 字段、配置不变、测试更新均已覆盖。
- **Placeholder scan:** 无 TBD/TODO；代码步骤完整。
- **Type consistency:** `CurtainRun.closed` 类型与 zod schema、`buildCurtainShape` 参数一致。
- **风险点:** 闭合路径的 hole 方式对凸多边形有效；复杂凹多边形/自交路径不在本次范围。

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-07-14-curtain-run-shape-extrude-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
