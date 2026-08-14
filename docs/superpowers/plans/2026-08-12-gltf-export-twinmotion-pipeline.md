# glTF 导出与 Twinmotion 云渲染管线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **状态说明（2026-08-12）：** 本计划为追溯性文档——Task 1–3 已实现并全量验证通过（test:app 321 绿 / verify:all OK / typecheck OK），Task 4 为手动验收项。文档代码与仓库最终代码一致。

**Goal:** 从 Three.js 场景单向导出 house.glb（节点名 = objectId），并从声明式底座自动生成《装扮映射表》，作为 Twinmotion 云渲染的上游桥。

**Architecture:** model-geometry.yaml 仍是唯一权威源；本管线只做单向导出（Three.js 场景 → glb），不回写、不同步、不双写。收集规则基于现有 `userData.type` / `userData.objectId` 约定；映射表从 materials.yaml / house.yaml furnishings / electrical.yaml / overlay.yaml / environment.yaml / data/current-scheme.json 直接生成，杜绝手工抄数。

**Tech Stack:** Three.js ^0.166（GLTFExporter 来自 `three/examples/jsm/exporters/`）、TypeScript、Vitest、tsx、js-yaml。

**Spec:** `docs/superpowers/specs/2026-08-12-gltf-export-twinmotion-pipeline.md`

## Global Constraints

- 纳入 `userData.type` 集合（Group 整体纳入，不递归子节点）：`floor`, `ceiling`, `ceiling_zone`, `ceiling_zone_solid`, `wall`, `curtain_run`, `curtain`, `glass_infill`, `bay_sill`, `railing_run`, `sliding_door_run`, `sliding_door`, `door`, `floor_region`, `furniture`
- 排除 `userData.type` 集合：`annotation`, `electrical`, `plumbing`, `platform`, `highlight_object`；另排除无 type 的 gridHelper/标签 sprite/太阳轨迹/hover 高亮
- 导出前把 `userData.objectId` 写入 `mesh.name`，导出后恢复原 name/visible/父子挂载，不污染运行态
- 天花运行时 `visible = false`（HouseScene.ts:599），导出时强制 `visible = true` 纳入
- GLTFExporter 参数：`binary: true, embedImages: true`
- 灯光点位数量由 `config/electrical.yaml` 派生（当前 14 个），禁止硬编码
- 坐标系：Three.js 右手系，Y 向上；导出不做任何坐标变换
- 验证门禁：`npm run test:app && npm run verify:all && npm run typecheck` 全绿

---

### Task 1: collectExportSet + exportSceneToGlb（TDD）

**Files:**
- Create: `app/src/render/export-gltf.ts`
- Test: `app/src/render/export-gltf.test.ts`

**Interfaces:**
- Produces（Task 2 依赖）：
  - `export function collectExportSet(root: THREE.Object3D): THREE.Object3D[]`
  - `export async function exportSceneToGlb(scene: THREE.Scene): Promise<Blob>`
  - `export const EXPORT_INCLUDE_TYPES: ReadonlySet<string>`
  - `export const EXPORT_EXCLUDE_TYPES: ReadonlySet<string>`

- [ ] **Step 1: Write the failing test**

`app/src/render/export-gltf.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { collectExportSet, EXPORT_INCLUDE_TYPES, EXPORT_EXCLUDE_TYPES } from './export-gltf.js';

function mesh(type: string | undefined, objectId?: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  if (type !== undefined) m.userData = { type, ...(objectId ? { objectId } : {}) };
  return m;
}

describe('collectExportSet', () => {
  it('includes geometry, doors, ceiling zones, curtains and furniture groups', () => {
    const scene = new THREE.Scene();
    const floor = mesh('floor', 'floor:living_dining');
    const ceiling = mesh('ceiling', 'ceiling:living_dining');
    const ceilingZone = new THREE.Group();
    ceilingZone.userData = { type: 'ceiling_zone', objectId: 'cz:living' };
    ceilingZone.add(mesh('ceiling_zone_solid', 'cz:living:solid'));
    const wall = mesh('wall', 'wall:living_dining:N');
    const door = mesh('door', 'opening:entry');
    const slidingDoor = mesh('sliding_door', 'sliding_door:balcony');
    const curtainRun = mesh('curtain_run', 'curtain:living');
    const curtainSheer = mesh('curtain', 'curtain:living:sheer');
    const glass = mesh('glass_infill', 'glass:bay1');
    const sill = mesh('bay_sill', 'sill:bay1');
    const railing = mesh('railing_run', 'rail:balcony');
    const slidingRun = mesh('sliding_door_run', 'sdr:balcony');
    const region = mesh('floor_region', 'region:kitchen');
    const furniture = new THREE.Group();
    furniture.userData = { type: 'furniture', objectId: 'furniture:living:sofa_3seat:0' };
    furniture.add(mesh(undefined));
    scene.add(floor, ceiling, ceilingZone, wall, door, slidingDoor, curtainRun, curtainSheer, glass, sill, railing, slidingRun, region, furniture);

    const set = collectExportSet(scene);
    expect(set).toContain(floor);
    expect(set).toContain(ceiling);
    expect(set).toContain(ceilingZone);
    expect(set).toContain(wall);
    expect(set).toContain(door);
    expect(set).toContain(slidingDoor);
    expect(set).toContain(curtainRun);
    expect(set).toContain(curtainSheer);
    expect(set).toContain(glass);
    expect(set).toContain(sill);
    expect(set).toContain(railing);
    expect(set).toContain(slidingRun);
    expect(set).toContain(region);
    expect(set).toContain(furniture);
  });

  it('excludes annotations, electrical/plumbing markers, platform boundary and untyped helpers', () => {
    const scene = new THREE.Scene();
    const annotation = mesh('annotation', 'electrical:p1');
    const electrical = mesh('electrical', 'electrical:p1');
    const plumbing = mesh('plumbing', 'plumbing:p2');
    const platform = mesh('platform', 'platform_boundary');
    const highlight = mesh('highlight_object');
    const grid = new THREE.GridHelper();
    const untyped = mesh(undefined);
    scene.add(annotation, electrical, plumbing, platform, highlight, grid, untyped);

    const set = collectExportSet(scene);
    expect(set).toHaveLength(0);
  });

  it('does not double-collect children of an included group', () => {
    const scene = new THREE.Scene();
    const furniture = new THREE.Group();
    furniture.userData = { type: 'furniture', objectId: 'furniture:bed:bed_180:0' };
    const inner = mesh('furniture');
    furniture.add(inner);
    scene.add(furniture);

    const set = collectExportSet(scene);
    expect(set).toEqual([furniture]);
  });

  it('keeps include and exclude sets disjoint', () => {
    for (const t of EXPORT_INCLUDE_TYPES) {
      expect(EXPORT_EXCLUDE_TYPES.has(t)).toBe(false);
    }
  });
});
```

注意：测试不实例化 HouseScene（DOM 依赖重），只构造裸 scene 树——这是纯函数可测的关键。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/render/export-gltf.test.ts`
Expected: FAIL（`./export-gltf.js` 模块不存在，0 tests）

- [ ] **Step 3: Write minimal implementation**

`app/src/render/export-gltf.ts`：

```ts
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export const EXPORT_INCLUDE_TYPES: ReadonlySet<string> = new Set([
  'floor',
  'ceiling',
  'ceiling_zone',
  'ceiling_zone_solid',
  'wall',
  'curtain_run',
  'curtain',
  'glass_infill',
  'bay_sill',
  'railing_run',
  'sliding_door_run',
  'sliding_door',
  'door',
  'floor_region',
  'furniture',
]);

export const EXPORT_EXCLUDE_TYPES: ReadonlySet<string> = new Set([
  'annotation',
  'electrical',
  'plumbing',
  'platform',
  'highlight_object',
]);

export function collectExportSet(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const visit = (obj: THREE.Object3D) => {
    const type = obj.userData?.type as string | undefined;
    if (type && EXPORT_INCLUDE_TYPES.has(type)) {
      out.push(obj);
      return;
    }
    for (const child of obj.children) visit(child);
  };
  visit(root);
  return out;
}

export async function exportSceneToGlb(scene: THREE.Scene): Promise<Blob> {
  scene.updateMatrixWorld(true);
  const exportSet = collectExportSet(scene);
  const exportRoot = new THREE.Group();
  exportRoot.name = 'house';
  const savedNames = new Map<THREE.Object3D, string>();
  const savedVisible = new Map<THREE.Object3D, boolean>();
  const savedParents = new Map<THREE.Object3D, THREE.Object3D | null>();

  for (const obj of exportSet) {
    savedNames.set(obj, obj.name);
    savedVisible.set(obj, obj.visible);
    savedParents.set(obj, obj.parent);
    if (obj.userData?.objectId) obj.name = String(obj.userData.objectId);
    obj.visible = true;
    exportRoot.attach(obj);
  }
  exportRoot.updateMatrixWorld(true);

  try {
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(exportRoot, { binary: true, embedImages: true });
    if (result instanceof ArrayBuffer) {
      return new Blob([result], { type: 'model/gltf-binary' });
    }
    return new Blob([JSON.stringify(result)], { type: 'model/gltf+json' });
  } finally {
    for (const obj of exportSet) {
      savedParents.get(obj)?.attach(obj);
      obj.name = savedNames.get(obj) ?? '';
      obj.visible = savedVisible.get(obj) ?? true;
    }
  }
}
```

要点：`attach()` 保世界变换（导出根为 identity，无需坐标换算）；`finally` 里 `parent.attach(obj)` 恢复原挂载即恢复原局部变换，无需手动 decompose；`visible = true` 让隐藏天花进入 glb。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/render/export-gltf.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/render/export-gltf.ts app/src/render/export-gltf.test.ts
git commit -m "feat: add glTF export collect/export module with tests"
```

---

### Task 2: app 内导出按钮

**Files:**
- Modify: `app/index.html`（scheme-panel 内）
- Modify: `app/src/App.ts`（import + constructor 调用 + 新方法 `setupExportButton`）

**Interfaces:**
- Consumes: Task 1 的 `exportSceneToGlb(scene: THREE.Scene): Promise<Blob>`；`this.houseScene.scene`（App.ts 既有 public 字段）
- Produces: 无（终端 UI 功能）

- [ ] **Step 1: 在 index.html 的 scheme-panel 加按钮**

`app/index.html`，`<div id="warnings"></div>` 之后、`</div>`（scheme-panel 结束）之前：

```html
      <div id="warnings"></div>
      <button id="export-glb-btn" title="导出 glb（云渲染用）">导出 glb</button>
    </div>
```

- [ ] **Step 2: App.ts 接线**

import 区（`import { isInHuinanWindow } from '@shared/humidity-model';` 之后）加：

```ts
import { exportSceneToGlb } from './render/export-gltf.js';
```

constructor 内 `this.setupPlacementPanel();` 之后加：

```ts
    this.setupExportButton();
```

类中新增方法（放在 `setupFurniturePanel` 与 `exitFurniturePlaceMode` 之间）：

```ts
  private setupExportButton(): void {
    const btn = document.getElementById('export-glb-btn');
    btn?.addEventListener('click', async () => {
      const blob = await exportSceneToGlb(this.houseScene.scene);
      const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `house-${stamp}.glb`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
```

- [ ] **Step 3: 验证**

Run: `npm run test:app && npm run typecheck`
Expected: 全绿（按钮为 UI 接线，无单测；typecheck 保证签名正确）。手动 `npm run dev` 点按钮可下载 `house-YYYYMMDD.glb`。

- [ ] **Step 4: Commit**

```bash
git add app/index.html app/src/App.ts
git commit -m "feat: add export-glb button to scheme panel"
```

---

### Task 3: 装扮映射表生成脚本

**Files:**
- Create: `scripts/generate-dressing-map.ts`
- Modify: `package.json`（scripts 加 `export:dressing-map`）
- Create（生成物）: `docs/dressing-map.md`

**Interfaces:**
- Consumes（全部只读）：`config/materials.yaml`（materials[].id/name/brand/model/spec/appearance）、`data/current-scheme.json`（selections[topic].default/roomOverrides）、`config/house.yaml`（furnishings[room][]：有 x/z 为 placed，无为 count-only）、`config/electrical.yaml`（type ∈ pendant/dome/wall_lamp/downlight/led_strip）、`config/layout/overlay.yaml`（elements[].type/height/depth/sill/reason）、`config/environment.yaml`（location）、`shared/types.ts` 的 `FURNITURE_DIMS: Record<string, { width: number; depth: number }>`
- Produces: `docs/dressing-map.md`；npm 脚本 `export:dressing-map`

- [ ] **Step 1: Write the generator**

`scripts/generate-dressing-map.ts`（完整代码即仓库当前版本；核心结构）：

```ts
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { FURNITURE_DIMS } from '../shared/types.js';

// interfaces: MaterialEntry / ElectricalPoint / FurnishingItem / OverlayElement
const LIGHT_TYPES = new Set(['pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip']);
const LIGHT_TYPE_LABEL: Record<string, string> = {
  pendant: '吊灯', dome: '吸顶灯', wall_lamp: '壁灯', downlight: '筒灯', led_strip: '灯带',
};

// main():
// 1. yaml.load 各 config + JSON.parse current-scheme.json
// 2. §1 材料表：遍历 scheme.selections，byId 查 materials.yaml，
//    appearanceToTwinmotion() 把 appearance(color/pattern/plank_mm/finish) 翻成替换建议；
//    找不到的 id 输出 "⚠ materials.yaml 未找到" 行（暴露数据漂移，不静默）
// 3. §2 家具表：placed 实例按 type 聚合，给 (x, z)/rotation 与 FURNITURE_DIMS 宽×深；
//    count-only 单列一行标注 "不在 glb，按实物补摆"
// 4. §3 灯光表：electrical.filter(type ∈ LIGHT_TYPES)，表头数量为派生值
// 5. §4 玻璃幕/飘窗：overlay elements 按 curtain_run/glass_infill 与 bay_sill 分组
// 6. §5 太阳定位：environment.location + 建议工况（8月17:30 西晒 / 20:00 夜景）
// 7. fs.writeFileSync('docs/dressing-map.md', lines.join('\n'))
```

（完整逐行代码见仓库 `scripts/generate-dressing-map.ts`，约 160 行，无外部新依赖。）

- [ ] **Step 2: 注册 npm 脚本**

`package.json` scripts 内，`verify:all` 之后：

```json
    "export:dressing-map": "tsx scripts/generate-dressing-map.ts"
```

- [ ] **Step 3: 运行并检查输出**

Run: `npm run export:dressing-map`
Expected stdout: `docs/dressing-map.md written: 14 lights, 36 topics`

人工检查 `docs/dressing-map.md`：
- §1 含 floor/wall/paint 等 36 个 topic，木纹砖行含 `底色 #c49a6c，木纹·直铺`
- §2 家具行与 `npm run verify:furniture` 的 placed 清单一致（坐标同源）
- §3 灯光 14 行，含坐标/高度/色温（厨卫 4000K，其余 3000K）
- §4 玻璃幕 5 条 + 飘窗 9 条
- §5 南宁 22.82°N, 108.37°E

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-dressing-map.ts package.json docs/dressing-map.md
git commit -m "feat: add dressing-map generator for Twinmotion pipeline"
```

---

### Task 4: 全量验证 + 手动验收

**Files:**
- Modify: 无（纯验证）

- [ ] **Step 1: 全量自动验证**

Run: `npm run test:app && npm run verify:all && npm run typecheck`
Expected（2026-08-12 实测）：test:app 37 files / 321 tests 全绿；verify:all OK（仅既有 3 条 clearance warning）；typecheck 无输出。

- [ ] **Step 2: Blender 导入验收（手动）**

`npm run dev` → 方案面板点"导出 glb" → Blender `File > Import > glTF 2.0`：
- [ ] 总长宽与 model-geometry 一致（米制，客厅东西约 14m 量级）
- [ ] Outliner 节点名 = objectId（如 `floor:living_dining`、`furniture:living_dining:sofa_3seat:0`）
- [ ] 天花存在（运行时隐藏但已导出）、门扇在位、家具体块在位

- [ ] **Step 3: Twinmotion 验收（云端手动，spec 验收标准 3）**

云电脑 Twinmotion：导入 glb → 替换某房间地面材质 → reimport 同名新 glb → 材质覆盖保留。若不兼容，退化为 OBJ（几何）+ dressing-map 手动（spec 风险 3 预案）。

- [ ] **Step 4: Commit（如有文档收尾）**

```bash
git add docs/
git commit -m "docs: gltf export pipeline acceptance notes"
```

---

## Self-Review 记录

- **Spec 覆盖**：变更清单 1（export-gltf.ts）→ Task 1；变更清单 2（App.ts 按钮）→ Task 2；变更清单 3+4（dressing-map + package.json）→ Task 3；测试/验收标准 → Task 1 Step 1-4 与 Task 4。风险 3 的 OBJ 退化预案保留在 spec，不在本计划实现。
- **Placeholder 扫描**：Task 3 Step 1 以结构注释 + 指向仓库完整代码的方式给出（追溯性文档，代码已在库），无 TBD/TODO。
- **类型一致性**：`collectExportSet(root: THREE.Object3D): THREE.Object3D[]`、`exportSceneToGlb(scene: THREE.Scene): Promise<Blob>`、`EXPORT_INCLUDE_TYPES/EXPORT_EXCLUDE_TYPES: ReadonlySet<string>` 在 Task 1 定义、Task 2 消费，签名一致。
