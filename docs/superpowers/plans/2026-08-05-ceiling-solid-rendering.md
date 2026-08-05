# 吊顶实体渲染与天花板缺口修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `config/ceiling.yaml` 声明的吊顶（局部下沉/铝扣板）在第一人称模式渲染为实体几何，并补齐走廊/门厅三块天花板缺口。

**Architecture:** ceiling.yaml 为唯一权威源；新增纯函数模块 `CeilingZoneBuilder.ts` 把 zone 配置转成 THREE.Group（下沉板+边裙），HouseScene 经 `/api/annotations/ceiling` 拉取并挂到 `ceilingMeshes`，继承现有「仅第一人称可见」逻辑。无碰撞（头顶上方，pitch ±80°）。

**Tech Stack:** TypeScript, Three.js, Vitest (app), tsx --test (server), js-yaml。

**Spec:** `docs/superpowers/specs/2026-08-05-ceiling-region-design.md`
**扩展指南（新增造型时）：** `docs/ceiling-style-extension-guide.md`

## Global Constraints

- `config/ceiling.yaml` 是吊顶意图唯一权威源；调造型只改配置，不改代码。
- 坐标一律使用 model-geometry 同一局部坐标系（米），禁止独立偏移。
- 吊顶几何**无碰撞**：不得触碰 `app/src/scene/collision-utils.ts` 的 `extractCollisionWalls`。
- 吊顶 mesh 必须注册进 `HouseScene.ceilingMeshes`，仅第一人称可见；轨道/俯视必须隐藏。
- 未知 `type` 跳过并 `console.warn`，不得抛异常。
- 发光灯带类效果只允许 emissive 材质，禁止真实光源（本期无此需求，仅约束未来）。
- 每个 Task 完成后运行对应测试；最后统一跑 `npm run verify:all && npm run test:app && npm run test:server && npm run typecheck`。

---

### Task 1: ceiling.yaml 缺口条目 + CeilingZone 类型同步 + 校验

**Files:**
- Modify: `server/config-loader.ts:103-113`（CeilingZone 定义）
- Modify: `app/src/render/annotations/ProblemDetector.ts`（CeilingZone 镜像接口，约 line 23-40）
- Modify: `app/src/render/annotations/AnnotationRenderer.ts:28-38`（CeilingZone 镜像接口）
- Modify: `config/ceiling.yaml`（追加 3 条）
- Modify: `scripts/verify-rules.ts:64` 附近（ceiling 类型 + area 校验）
- Test: `tests/server/ceiling-config.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `loadCeilingConfig()`（server/config-loader.ts:130）。
- Produces: `export const VALID_CEILING_TYPES: readonly string[]`（server/config-loader.ts）；`CeilingZone.type` 含 `'aluminum_buckle'`。Task 2/3 的消费端只依赖 yaml 结构，不依赖本常量。

- [ ] **Step 1: 写失败测试**

创建 `tests/server/ceiling-config.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { VALID_CEILING_TYPES } from '../../server/config-loader.js';

interface CeilingEntry {
  id: string;
  room: string;
  type: string;
  thickness?: number;
  area?: [number, number, number, number];
}

const entries = parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as CeilingEntry[];

test('ceiling.yaml: every entry type is in VALID_CEILING_TYPES', () => {
  for (const e of entries) {
    assert.ok(
      (VALID_CEILING_TYPES as readonly string[]).includes(e.type),
      `ceiling/${e.id}: unknown type "${e.type}"`,
    );
  }
});

test('ceiling.yaml: corridor/foyer gap entries exist with matching floor_region areas', () => {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const expected: Record<string, [number, number, number, number]> = {
    ceiling_main_corridor: [4.20, 4.30, 7.20, 5.55],
    ceiling_corridor: [4.20, 5.55, 7.20, 7.80],
    ceiling_entry_foyer: [10.80, 2.90, 13.40, 4.30],
  };
  for (const [id, area] of Object.entries(expected)) {
    const e = byId.get(id);
    assert.ok(e, `missing ceiling entry ${id}`);
    assert.equal(e.type, 'drop');
    assert.equal(e.thickness, 0.30);
    assert.deepEqual(e.area, area);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:server -- --test-name-pattern=ceiling`
Expected: FAIL — `VALID_CEILING_TYPES` 不存在（import 报错），或缺口条目 missing。

- [ ] **Step 3: 类型定义改造（server/config-loader.ts:103-113）**

替换 CeilingZone 定义：

```ts
export const VALID_CEILING_TYPES = [
  'drop',
  'integrated',
  'cove',
  'none',
  'ac_indoor',
  'aluminum_buckle',
] as const;

export interface CeilingZone {
  id: string;
  room: string;
  type: (typeof VALID_CEILING_TYPES)[number];
  thickness?: number;
  area?: [number, number, number, number];
  x?: number;
  z?: number;
  height?: number;
  model?: string;
  note?: string;
}
```

- [ ] **Step 4: 同步应用侧两处镜像类型**

`app/src/render/annotations/ProblemDetector.ts` 与 `app/src/render/annotations/AnnotationRenderer.ts` 中的 `CeilingZone` 接口，`type` 行改为：

```ts
  type: 'drop' | 'integrated' | 'cove' | 'none' | 'ac_indoor' | 'aluminum_buckle';
```

- [ ] **Step 5: ceiling.yaml 追加缺口条目**

追加到 `config/ceiling.yaml` 末尾：

```yaml
# === 走廊/门厅吊顶（2026-08-05 天花板缺口修复，藏多联机风管） ===

- id: ceiling_main_corridor
  room: living_dining
  type: drop
  thickness: 0.30
  area: [4.20, 4.30, 7.20, 5.55]
  note: "主走廊吊顶（藏多联机风管），净高约2.50m"

- id: ceiling_corridor
  room: master_bedroom
  type: drop
  thickness: 0.30
  area: [4.20, 5.55, 7.20, 7.80]
  note: "主卧与父母房之间走廊吊顶（藏风管），净高约2.50m"

- id: ceiling_entry_foyer
  room: entry_garden
  type: drop
  thickness: 0.30
  area: [10.80, 2.90, 13.40, 4.30]
  note: "入户门厅吊顶（藏风管），净高约2.50m"
```

- [ ] **Step 6: verify-rules 加 ceiling 校验**

`scripts/verify-rules.ts` 中，`const ceiling = ...`（line 64）之后、`for (const c of ceiling)` 存在性循环（line 140）处，循环体内追加：

```ts
    if (!VALID_CEILING_TYPES.includes(c.type as (typeof VALID_CEILING_TYPES)[number])) {
      report('error', `[ceiling_type] ceiling/${c.id}: 未知 type "${c.type}"`);
    }
```

文件顶部 import 加：

```ts
import { VALID_CEILING_TYPES } from '../server/config-loader.js';
```

并在 ceiling 循环后再加一个整体包围盒校验（`rooms` 来自 line 59 `catalog.getRooms()`，含 x/z/width/depth）：

```ts
  // === ceiling area within unit bounds ===
  const unitMinX = Math.min(...rooms.map((r) => r.x - r.width / 2)) - 0.2;
  const unitMaxX = Math.max(...rooms.map((r) => r.x + r.width / 2)) + 0.2;
  const unitMinZ = Math.min(...rooms.map((r) => r.z - r.depth / 2)) - 0.2;
  const unitMaxZ = Math.max(...rooms.map((r) => r.z + r.depth / 2)) + 0.2;
  for (const c of ceiling) {
    const area = (c as { area?: [number, number, number, number] }).area;
    if (!area) continue;
    const [ax1, az1, ax2, az2] = area;
    if (ax1 < unitMinX || ax2 > unitMaxX || az1 < unitMinZ || az2 > unitMaxZ) {
      report('error', `[ceiling_area] ceiling/${c.id}: area 超出户型整体范围`);
    }
  }
```

注意：entry_garden 北凸 z<0 属合法（入户花园向北凸出），整体并集天然包含，无需特判。

- [ ] **Step 7: 跑测试确认通过 + 全量校验**

Run: `npm run test:server && npm run verify:all && npm run typecheck`
Expected: 全绿。

- [ ] **Step 8: Commit**

```bash
git add server/config-loader.ts app/src/render/annotations/ProblemDetector.ts app/src/render/annotations/AnnotationRenderer.ts config/ceiling.yaml scripts/verify-rules.ts tests/server/ceiling-config.test.ts
git commit -m "feat(ceiling): sync CeilingZone types (aluminum_buckle), add corridor/foyer gap entries + validation"
```

---

### Task 2: CeilingZoneBuilder 纯函数模块

**Files:**
- Create: `app/src/render/CeilingZoneBuilder.ts`
- Test: `app/src/render/CeilingZoneBuilder.test.ts`

**Interfaces:**
- Consumes: Task 1 的 yaml 结构（ duck-typed，不 import server）。
- Produces: `buildCeilingZone(zone: CeilingZoneSpec, ceilingHeight?: number): THREE.Group | null`。Task 3 的 HouseScene 只调这一个函数。

- [ ] **Step 1: 写失败测试**

创建 `app/src/render/CeilingZoneBuilder.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCeilingZone } from './CeilingZoneBuilder.js';

const dropZone = {
  id: 'ceiling_main_corridor',
  room: 'living_dining',
  type: 'drop',
  thickness: 0.30,
  area: [4.20, 4.30, 7.20, 5.55] as [number, number, number, number],
};

describe('buildCeilingZone', () => {
  it('drop: top slab at ceilingHeight - thickness + 0.002, centered, with 4 skirts', () => {
    const g = buildCeilingZone(dropZone)!;
    expect(g).not.toBeNull();
    const slabs = g.children.filter(
      (c) => (c as THREE.Mesh).userData.part === 'slab',
    ) as THREE.Mesh[];
    expect(slabs).toHaveLength(1);
    expect(slabs[0].position.y).toBeCloseTo(2.502, 5);
    expect(slabs[0].position.x).toBeCloseTo(5.70, 5);
    expect(slabs[0].position.z).toBeCloseTo(4.925, 5);
    const skirts = g.children.filter((c) => c.userData.part === 'skirt');
    expect(skirts).toHaveLength(4);
  });

  it('aluminum_buckle: metalness 0.3', () => {
    const g = buildCeilingZone({ ...dropZone, id: 'ceiling_kitchen', type: 'aluminum_buckle', thickness: 0.15 })!;
    const slab = g.children.find((c) => c.userData.part === 'slab') as THREE.Mesh;
    expect((slab.material as THREE.MeshStandardMaterial).metalness).toBeCloseTo(0.3);
    expect(slab.position.y).toBeCloseTo(2.652, 5);
  });

  it('userData on group carries ceiling_zone identity', () => {
    const g = buildCeilingZone(dropZone)!;
    expect(g.userData).toMatchObject({
      type: 'ceiling_zone',
      objectId: 'ceiling_main_corridor',
      roomId: 'living_dining',
    });
  });

  it('returns null for ac_indoor / none / missing area / missing thickness', () => {
    expect(buildCeilingZone({ ...dropZone, type: 'ac_indoor' })).toBeNull();
    expect(buildCeilingZone({ ...dropZone, type: 'none' })).toBeNull();
    expect(buildCeilingZone({ ...dropZone, area: undefined })).toBeNull();
    expect(buildCeilingZone({ ...dropZone, thickness: undefined })).toBeNull();
    expect(buildCeilingZone({ ...dropZone, type: 'future_unknown' })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx vitest run src/render/CeilingZoneBuilder.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 CeilingZoneBuilder.ts**

创建 `app/src/render/CeilingZoneBuilder.ts`：

```ts
import * as THREE from 'three';

export interface CeilingZoneSpec {
  id: string;
  room: string;
  type: string;
  thickness?: number;
  area?: [number, number, number, number];
  note?: string;
}

const SLAB_EPS = 0.002;
const SKIRT_THICKNESS = 0.02;
const COLOR_DROP = '#f5f5f5';
const COLOR_BUCKLE = '#eceff1';

const SOLID_TYPES = new Set(['drop', 'integrated', 'aluminum_buckle']);

export function buildCeilingZone(zone: CeilingZoneSpec, ceilingHeight = 2.8): THREE.Group | null {
  if (!SOLID_TYPES.has(zone.type)) return null;
  if (!zone.area || zone.thickness === undefined) return null;

  const [x1, z1, x2, z2] = zone.area;
  const w = x2 - x1;
  const d = z2 - z1;
  if (w <= 0 || d <= 0) return null;
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const topY = ceilingHeight - zone.thickness + SLAB_EPS;
  const isBuckle = zone.type === 'aluminum_buckle';

  const slabMat = new THREE.MeshStandardMaterial({
    color: isBuckle ? COLOR_BUCKLE : COLOR_DROP,
    roughness: isBuckle ? 0.6 : 0.9,
    metalness: isBuckle ? 0.3 : 0.02,
    side: THREE.DoubleSide,
  });
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(w, d), slabMat);
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(cx, topY, cz);
  slab.userData = { part: 'slab' };

  const skirtMat = new THREE.MeshStandardMaterial({
    color: COLOR_DROP,
    roughness: 0.9,
    metalness: 0.02,
  });
  const skirtH = zone.thickness;
  const skirtY = ceilingHeight - skirtH / 2;
  const mkSkirt = (len: number, px: number, pz: number, rotY: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, skirtH, SKIRT_THICKNESS), skirtMat);
    m.position.set(px, skirtY, pz);
    m.rotation.y = rotY;
    m.userData = { part: 'skirt' };
    return m;
  };
  const skirts = [
    mkSkirt(w, cx, z1, 0),
    mkSkirt(w, cx, z2, 0),
    mkSkirt(d, x1, cz, Math.PI / 2),
    mkSkirt(d, x2, cz, Math.PI / 2),
  ];

  const group = new THREE.Group();
  group.add(slab, ...skirts);
  group.userData = { type: 'ceiling_zone', objectId: zone.id, roomId: zone.room };
  return group;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx vitest run src/render/CeilingZoneBuilder.test.ts`
Expected: 4 passed。

- [ ] **Step 5: Commit**

```bash
git add app/src/render/CeilingZoneBuilder.ts app/src/render/CeilingZoneBuilder.test.ts
git commit -m "feat(app): CeilingZoneBuilder — pure builder for solid ceiling zones (slab + skirts)"
```

---

### Task 3: HouseScene 集成 + App 接线

**Files:**
- Modify: `app/src/render/HouseScene.ts`（import + 两个方法 + objectDisplayName 标签）
- Modify: `app/src/App.ts:140` 附近（buildFromCatalog 之后调用）
- Test: `app/src/render/HouseScene.test.ts`（追加 source-based 用例，沿用该文件既有风格）

**Interfaces:**
- Consumes: `buildCeilingZone(zone, ceilingHeight?)`（Task 2）；`/api/annotations/ceiling` 返回 `CeilingZoneSpec[]`。
- Produces: `HouseScene.loadCeilingZones(): Promise<void>`；`ceilingMeshes` 含吊顶子 mesh；`objectDisplayName` 支持 `ceiling_zone → '吊顶'`。

- [ ] **Step 1: 写失败测试**

`app/src/render/HouseScene.test.ts` 追加：

```ts
describe('HouseScene ceiling zones', () => {
  it('renders solid ceiling zones via buildCeilingZone and registers meshes in ceilingMeshes', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toContain('buildCeilingZone');
    expect(source).toContain('loadCeilingZones');
    expect(source).toContain("'/api/annotations/ceiling'");
    expect(source).toContain("ceiling_zone_solid: '吊顶'");
  });

  it('ceiling zone meshes follow first-person-only visibility', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).toMatch(/renderCeilingZones[\s\S]*ceilingMeshes\.push/);
    expect(source).toContain('setCeilingVisible(this._mode');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx vitest run src/render/HouseScene.test.ts`
Expected: FAIL — 不包含 buildCeilingZone 等符号。

- [ ] **Step 3: HouseScene 实现**

`app/src/render/HouseScene.ts` 顶部 import 加：

```ts
import { buildCeilingZone, type CeilingZoneSpec } from './CeilingZoneBuilder.js';
```

类中新增字段与方法（放在 `setCeilingVisible` 附近）：

```ts
  private ceilingZoneGroups: THREE.Group[] = [];

  async loadCeilingZones(): Promise<void> {
    let zones: CeilingZoneSpec[];
    try {
      const res = await fetch('/api/annotations/ceiling');
      zones = (await res.json()) as CeilingZoneSpec[];
    } catch (err) {
      console.warn('[ceiling] load failed, skipped', err);
      return;
    }
    this.renderCeilingZones(zones);
  }

  private renderCeilingZones(zones: CeilingZoneSpec[]): void {
    for (const g of this.ceilingZoneGroups) {
      this.scene.remove(g);
    }
    this.ceilingZoneGroups = [];
    this.ceilingMeshes = this.ceilingMeshes.filter((m) => m.userData.type !== 'ceiling_zone_solid');

    for (const zone of zones) {
      const group = buildCeilingZone(zone);
      if (!group) {
        if (zone.type !== 'ac_indoor' && zone.type !== 'none') {
          console.warn(`[ceiling] skipped zone ${zone.id} (type=${zone.type})`);
        }
        continue;
      }
      this.scene.add(group);
      this.ceilingZoneGroups.push(group);
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.userData.type = 'ceiling_zone_solid';
          mesh.userData.objectId = zone.id;
          mesh.userData.roomId = zone.room;
          this.ceilingMeshes.push(mesh);
        }
      });
    }
    this.setCeilingVisible(this._mode === 'first-person');
  }
```

注意：`ceilingMeshes` 原为 `private ceilingMeshes: THREE.Mesh[] = []`（line 75），filter 重赋值需保持 private 语义，无需改声明。子 mesh 的 `userData.type` 覆写为 `'ceiling_zone_solid'`，以便重入清理与拾取区分；group 上仍保留 `ceiling_zone` 标识。

`objectDisplayName` 的 `typeLabel` 记录（约 line 1627）加一行：

```ts
      ceiling_zone_solid: '吊顶',
```

（若现有 key 为 `ceiling: '顶面'`，保留不动，新增上面一行即可。）

- [ ] **Step 4: App 接线**

`app/src/App.ts` 中 `await this.houseScene.buildFromCatalog(this.projectData);`（约 line 140）之后加：

```ts
    await this.houseScene.loadCeilingZones();
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd app && npx vitest run src/render/HouseScene.test.ts src/render/CeilingZoneBuilder.test.ts`
Expected: 全过。

- [ ] **Step 6: Commit**

```bash
git add app/src/render/HouseScene.ts app/src/render/HouseScene.test.ts app/src/App.ts
git commit -m "feat(app): render solid ceiling zones in first-person mode (gap fix for corridors/foyer)"
```

---

### Task 4: 全量验证 + 人工验收清单

**Files:**
- 无新增；仅运行与记录。

- [ ] **Step 1: 四条验证命令**

Run:
```bash
npm run verify:all
npm run test:app
npm run test:server
npm run typecheck
```
Expected: 全绿。任一失败 → 回到对应 Task 修，不得跳过。

- [ ] **Step 2: 人工验收（启动 app 后逐项确认）**

- [ ] 第一人称走进主走廊（x≈5.7, z≈4.9）抬头：有 2.50m 净高吊顶，无缺口
- [ ] 次走廊（z≈6.7）、入户门厅（x≈12, z≈3.6）同上
- [ ] 客厅：0.30m 下沉吊顶 + 南侧 0.15m 晾衣架浅吊顶，边裙封闭不透底
- [ ] 厨房/两卫：铝扣板吊顶（视觉与石膏板可区分）
- [ ] 切轨道/俯视模式：所有吊顶隐藏，户型图无遮挡
- [ ] 控制台无 `[ceiling] load failed` 告警

- [ ] **Step 3: 记录验收结果并提交（如有改动）**

```bash
git add -A
git commit -m "chore: ceiling zones acceptance pass" --allow-empty
```
