# 户型回正 + 玻璃幕墙修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 撤销错误施加的 `+3.0` z 坐标偏移，让 model-geometry.yaml 回到 DXF 原始坐标体系；按 8 房 + 1 平台清单重做几何；按用户红框图修正玻璃幕墙 suppress 区域（仅红框段是玻璃，东侧 + 部分 SE 是实墙）。最终 3D 俯视渲染出 DXF 户型图（北朝上、南朝下）。

**Architecture:** 一次纯几何 + 配置回退：模型坐标全部回到 DXF 派生的原值（entry_garden 在 z<0 表示主楼北凸），cad-anchor 的 dxf_origin.y 同步回退。glass_facade 的 points **保持现状不动**（用户确认形状对），只调整 suppress 区域从"全外圈"收敛到"仅红框三面 + SE 角 bay_sill"。Top-down 切换已经实装，**不再触碰** TopDownView / TopDownButton / main.ts / style.css / index.html（除 `HouseScene.ts` 的 bounds 常量外）。

**Tech Stack:** TypeScript + Three.js (server + app 双侧 tsx 测试)；YAML 配置 + zod schema 验证 (`server/overlay-merge.ts` 的 `parseOverlay`)。

## Global Constraints

- **YAGNI**: 不重构 `TopDownView.ts` 已有结构；不重画 `HouseScene.ts` 的渲染逻辑；不改测试 fixture 中已按"elevator / bedroom_se"对齐的断言。
- **DRY**: 三个 yaml 文件的 z 数值统一 -3.0 一次性回退，避免逐字段手算。
- **TDD**: 每次改完跑 `npm run test:server` + `npm run typecheck`，确保 103/103 通过。
- **不偏移 z**: 撤销 +3.0 后 z 在 DXF 原值，entry_garden 在 z=-2.9~0（主楼北凸），主楼在 z=0~9.8。任何"第一象限"视觉调整通过 `camera.up` 在渲染层做。
- **glass_facade 不动**: 用户确认形状对，只动 suppress 列表 + 加 1 个 bay_sill。
- **commit 粒度**: 每个 task 一次 commit，message 形如 `revert: roll back z +3.0 offset`。

## File Structure

| 文件 | 职责 | 本计划改动 |
|------|------|----------|
| `config/layout/cad-anchor.yaml` | DXF→模型坐标换算锚点 | 1 个值 |
| `config/layout/model-geometry.yaml` | 8 房 + 1 平台 + 27 段墙 | 大改：所有 z 用 DXF 原值，删误识别房间，加 elevator platform |
| `config/layout/overlay.yaml` | 渲染意图 | 中改：删 4 个东侧 suppress、缩 1 个 SE suppress、加 1 个 bay_sill；glass_facade.points **不动** |
| `app/src/render/HouseScene.ts` | Three.js 场景 | 1 个常量 |
| `tests/server/*.test.ts` | 测试 | **不改动** |

---

## Task 1: 回退 `cad-anchor.yaml` 的 dxf_origin.y

**Files:**
- Modify: `config/layout/cad-anchor.yaml:8-12`

- [ ] **Step 1: 把 dxf_origin.y 从 -15484.34 改回 -12484.34**

```yaml
dxf_origin:
  x: 31642.04
  y: -12484.34
```

- [ ] **Step 2: 验证 YAML 可解析**

```bash
cd /home/tao/projects/bontop-design-log
npx tsx -e "import { load } from 'js-yaml'; import { readFileSync } from 'fs'; const y = load(readFileSync('config/layout/cad-anchor.yaml', 'utf8')); console.log(y.dxf_origin);"
```

Expected: `{ x: 31642.04, y: -12484.34 }`

- [ ] **Step 3: Commit**

```bash
git add config/layout/cad-anchor.yaml
git commit -m "revert: roll back dxf_origin.y from -15484.34 to -12484.34"
```

---

## Task 2: 重写 `model-geometry.yaml`（8 房 + 1 平台，z 用 DXF 原值）

**Files:**
- Modify: `config/layout/model-geometry.yaml`（整文件）

**Interfaces:**
- 产出 rooms:
  - `master_bath` (x=1.3, z=2.15, 2.6×4.3)
  - `master_bedroom` (x=2.1, z=6.675, 4.2×4.25)
  - `bedroom_nw` (x=4.1, z=2.775, 3.0×5.55)
  - `guest_bath` (x=5.7, z=8.8, 3.0×2.0)
  - `kitchen` (x=9.0, z=1.0, 3.6×2.0)
  - `living_dining` (x=10.3, z=5.9, 6.2×7.8)
  - `bedroom_se` (x=14.9, z=7.6, 3.0×4.4)
  - `entry_garden` (x=13.025, z=-1.45, 4.45×2.9)
- 产出 platform: `elevator` (x=12.1, z=1.0, 2.6×2.0, height=0.15)
- 产出 27 段 walls

- [ ] **Step 1: 整文件重写**

```yaml
version: '1.0'
source: '人工维护：参考 cad/design/01_floor_plan/floor_plan_design_2026-07-05.dxf'
unit: m
scale: 0.001
origin:
  x: 31.64204
  z: -12.48434
export_date: '2026-07-15'
notes: '撤销 +3.0 z 偏移，回到 DXF 原值。entry_garden 在 z=-2.9~0 表示主楼北凸。'
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
    z: 6.675
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

- [ ] **Step 2: 验证房间无重叠**

```bash
cd /home/tao/projects/bontop-design-log
cat > /tmp/check_overlap.ts << 'EOF'
import { ProjectCatalog } from '/home/tao/projects/bontop-design-log/server/project-catalog.js';
const cat = ProjectCatalog.load('/home/tao/projects/bontop-design-log');
const rooms = cat.getRooms();
for (const r of rooms) {
  const xmin=r.x-r.width/2, xmax=r.x+r.width/2, zmin=r.z-r.depth/2, zmax=r.z+r.depth/2;
  console.log(`  ${r.id.padEnd(18)} x:[${xmin.toFixed(2)},${xmax.toFixed(2)}] z:[${zmin.toFixed(2)},${zmax.toFixed(2)}]`);
}
let any=false;
for (let i=0; i<rooms.length; i++) {
  for (let j=i+1; j<rooms.length; j++) {
    const a=rooms[i], b=rooms[j];
    const ax1=a.x-a.width/2, ax2=a.x+a.width/2, az1=a.z-a.depth/2, az2=a.z+a.depth/2;
    const bx1=b.x-b.width/2, bx2=b.x+b.width/2, bz1=b.z-b.depth/2, bz2=b.z+b.depth/2;
    if (ax1<bx2 && ax2>bx1 && az1<bz2 && az2>bz1) {
      const ox=Math.min(ax2,bx2)-Math.max(ax1,bx1);
      const oz=Math.min(az2,bz2)-Math.max(az1,bz1);
      if (ox > 0.01 && oz > 0.01) { console.log(`  OVERLAP: ${a.id} ∩ ${b.id}`); any=true; }
    }
  }
}
if (!any) console.log('  (no overlaps)');
console.log('platform:', JSON.stringify(cat.getPlatform()));
EOF
npx tsx /tmp/check_overlap.ts && rm /tmp/check_overlap.ts
```

Expected: 8 个房间 + (no overlaps) + platform 是 elevator

- [ ] **Step 3: 跑测试 + typecheck**

```bash
cd /home/tao/projects/bontop-design-log
npm run test:server 2>&1 | tail -10
npm run typecheck 2>&1 | tail -5
```

Expected: 103/103 通过，typecheck 无 error

- [ ] **Step 4: Commit**

```bash
git add config/layout/model-geometry.yaml
git commit -m "revert: 8 rooms + elevator platform, z at DXF original values"
```

---

## Task 3: 改 `overlay.yaml` 的 suppress 列表（glass_facade.points 不动）

**Files:**
- Modify: `config/layout/overlay.yaml`（只改 suppress 段和加一个 bay_sill）

**Interfaces:**
- 消费: Task 2 的新房间清单
- 产出: 
  - 删 4 个 suppress: `suppress_east_kitchen` / `suppress_east_living_north` / `suppress_east_living` / `suppress_bedroom_se_north`
  - 缩 `suppress_bedroom_se_east` → `suppress_bedroom_se_corner`（只 SE 角 1.1m）
  - 加 `bedroom_se_south_bay`（bay_sill，深度 0.3m，sill 0.45m，高 2.55m）
  - **glass_facade / entry_garden_glass / master_bedroom_west_bay / master_bedroom_south_bay / corridor_floor 的 points 全部保留不动**

- [ ] **Step 1: 用 edit 改 suppress 段（最小化修改，不重写整个文件）**

```bash
cd /home/tao/projects/bontop-design-log
# 备份
cp config/layout/overlay.yaml /tmp/overlay-before-task3.yaml
```

**步骤 a：删 4 个 suppress**

用 edit 删除以下 4 个 suppress block（连带它们前面的 `-` 行）：

- `suppress_east_kitchen`（region: x1:10.3,z1:-0.5, x2:11.3,z2:2.5）
- `suppress_east_living_north`（region: x1:10.3,z1:4.5, x2:13.9,z2:5.5）
- `suppress_east_living`（region: x1:12.9,z1:4.5, x2:13.9,z2:8.9）
- `suppress_bedroom_se_north`（region: x1:12.9,z1:7.9, x2:16.9,z2:8.9）

**步骤 b：缩 suppress_bedroom_se_east**

把 `suppress_bedroom_se_east`（region: x1:15.9,z1:7.9, x2:16.9,z2:13.3）改为 `suppress_bedroom_se_corner`：
```yaml
  - id: suppress_bedroom_se_corner
    region: { x1: 15.9, z1: 9.7, x2: 16.9, z2: 10.0 }
    reason: "东南次卧南向凸窗（仅右下角 1.1m 那段）"
```

**步骤 c：加 bedroom_se_south_bay element**

在 `elements` 段的 `master_bedroom_south_bay` 之后加：
```yaml
  - id: bedroom_se_south_bay
    type: bay_sill
    points:
      - { x: 13.4, z: 9.8 }
      - { x: 16.4, z: 9.8 }
    depth: 0.3
    sill: 0.45
    height: 2.55
    reason: "东南次卧南向凸窗"
```

**步骤 d：保留所有其他 element 不动**（glass_facade.points / entry_garden_glass / master_bedroom_west_bay / master_bedroom_south_bay / corridor_floor 都不改）

- [ ] **Step 2: 验证 overlay 解析 + 元素完整性**

```bash
cd /home/tao/projects/bontop-design-log
cat > /tmp/check_overlay.ts << 'EOF'
import { ProjectCatalog } from '/home/tao/projects/bontop-design-log/server/project-catalog.js';
import { parseOverlay } from '/home/tao/projects/bontop-design-log/server/overlay-merge.js';
import { mergeSceneElements } from '/home/tao/projects/bontop-design-log/server/overlay-merge.js';
import { readFileSync } from 'fs';

const cat = ProjectCatalog.load('/home/tao/projects/bontop-design-log');
const overlay = parseOverlay(readFileSync('/home/tao/projects/bontop-design-log/config/layout/overlay.yaml', 'utf8'));
const scene = mergeSceneElements(cat.getWalls(), overlay);
console.log(`suppress: ${overlay.suppress.length}, elements: ${overlay.elements.length}`);
console.log('Element ids:');
for (const e of overlay.elements) console.log(`  ${e.id} (${e.type})`);
const types = new Map<string, number>();
for (const e of scene) types.set(e.type, (types.get(e.type) || 0) + 1);
console.log('Scene types:', Object.fromEntries(types));
EOF
npx tsx /tmp/check_overlay.ts && rm /tmp/check_overlay.ts
```

Expected: suppress 6 个（原 9 减 4 加 1 改名 = 6）、elements 7 个（加 1 个 bay_sill = 7）

- [ ] **Step 3: 跑测试 + typecheck**

```bash
cd /home/tao/projects/bontop-design-log
npm run test:server 2>&1 | tail -10
npm run typecheck 2>&1 | tail -5
```

Expected: 103/103 通过，typecheck 无 error

- [ ] **Step 4: Commit**

```bash
git add config/layout/overlay.yaml
git commit -m "revert: roll back z in overlay + fix glass suppress to red-box scope + add SE bay"
```

---

## Task 4: 改 `HouseScene.ts` 的 topDownLayoutBounds

**Files:**
- Modify: `app/src/render/HouseScene.ts:74`

- [ ] **Step 1: 把 bounds 改为含 entry_garden 凹进部分**

```typescript
private topDownLayoutBounds = { minX: 0, maxX: 16.4, minZ: -2.9, maxZ: 9.8 };
```

- [ ] **Step 2: 跑 typecheck + 测试**

```bash
cd /home/tao/projects/bontop-design-log
npm run typecheck 2>&1 | tail -5
npm run test:server 2>&1 | tail -10
```

Expected: 都过

- [ ] **Step 3: Commit**

```bash
git add app/src/render/HouseScene.ts
git commit -m "revert: topDownLayoutBounds z range to (-2.9, 9.8) for entry_garden recess"
```

---

## Task 5: 最终验证

- [ ] **Step 1: 跑完整测试套件**

```bash
cd /home/tao/projects/bontop-design-log
npm run test:server
npm run typecheck
```

Expected: 103/103 通过，typecheck 无 error

- [ ] **Step 2: diff 总览**

```bash
cd /home/tao/projects/bontop-design-log
git diff --stat HEAD~4 HEAD
```

Expected: 4 个 commit，改动文件 ≤ 4 个（cad-anchor / model-geometry / overlay / HouseScene）

- [ ] **Step 3: 提示用户刷新浏览器**

不 commit。直接告诉用户：

> 改完了。打开 dev server，浏览器**强制刷新**（Cmd+Shift+R / Ctrl+F5），按 T 或点右上"俯视"按钮验证：屏幕上方 = 入户花园（z<0，北凸），屏幕下方 = 主楼南墙（z=9.8），玻璃幕墙只在北/西/南 + SE 角（红框段），东侧是实墙（应该看不到玻璃层）。
