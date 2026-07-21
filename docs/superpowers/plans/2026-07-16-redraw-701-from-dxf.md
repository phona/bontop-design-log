# 701 户型按 DXF 重新绘制实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 `survey/photos/contract_structure_preview_2026-07-03.png`（合同图）为布局意图权威源，以 `cad/design/01_floor_plan/Drawing2.dxf` 为精确几何参考，将 `config/layout/model-geometry.yaml` 中 701 左单元的轮廓从错误的 16.4m 尺度改为与合同图/DXF 一致的 9.71m × 9.71m 真实轮廓，并同步修正房间、墙线、overlay、场景边界和测试。效果图仅用于材质/视觉风格参考，尺寸以合同图和 DXF 为准。

**Architecture:** 先用 vision subagent 重新精读合同图、并与 DXF 墙线交叉验证；然后以验证后的墙线重写 `model-geometry.yaml`；`overlay.yaml` 表达玻璃幕墙/飘窗/门窗意图；最后更新 `HouseScene.ts` 默认边界、相机和指南针，并回归测试。

**Tech Stack:** TypeScript/Node.js（服务端和 app 测试）、Python 3 + `ezdxf`（DXF 解析）、Three.js（渲染）、Vitest / node:test（测试）、vision subagent（合同图精读）。

## Global Constraints
- `config/layout/model-geometry.yaml` 是户型几何的唯一权威源；`config/layout/overlay.yaml` 表达一切渲染意图。代码只读、只执行，禁止推断。
- 采用 Three.js 默认右手坐标系：Y 轴向上（高度），水平面 x 为东西向、z 为南北向，+x 为东、+z 为南，-z 为北。俯视图北朝上。
- `model-geometry.yaml` 使用局部坐标（单位 m），允许 z < 0；DXF 单位是 mm，换算：`local_m = DXF_mm * scale - origin`，其中 scale = 0.001。
- 合同图是 701 布局意图的权威源；DXF 是精确几何的权威源；效果图仅用于视觉风格参考，尺寸与合同图/DXF 冲突时以后两者为准。
- 701 左单元的 DXF 原点（西南角内墙交点）约 (1529.719, 1780.198) mm，新房型建议以该点为局部原点。
- 不引入新的运行时依赖；解析脚本可以临时使用 `ezdxf`（已安装）。
- 不要修改 DXF 文件、合同图照片或任何计划外的现有代码。

---

### 文件结构

| 文件 | 用途 |
|------|------|
| `config/layout/model-geometry.yaml` | 重写：房间、平台、墙线 |
| `config/layout/overlay.yaml` | 重写：玻璃幕墙、飘窗、门窗洞、地板补区 |
| `app/src/render/HouseScene.ts` | 修改：删除红色调试框、更新默认场景边界/相机/指南针 |
| `app/src/main.ts` | 保留 `window.__APP__` 暴露（调试用途） |
| `scripts/extract-dxf-walls.py` | 新增：从 DXF 提取 701 左单元墙线中心线 |
| `scripts/verify-layout.ts` | 修改/沿用：验证房间不重叠 |
| `tests/server/api.test.ts` | 修改：平台 id 断言 |
| `tests/server/model-geometry-layout.test.ts` | 修改：房间/尺寸断言 |
| `app/src/scene/HouseScene.test.ts` | 修改：默认边界断言 |
| `screenshots/floorplan-701-v2.png` | 生成：正俯视截图 |

---

### Task 0: 重新精读合同图并交叉验证 DXF

**Files:**
- Read: `survey/photos/contract_structure_preview_2026-07-03.png`
- Read: `cad/design/01_floor_plan/Drawing2.dxf`
- Create: `scripts/.tmp/contract-analysis.md`（临时笔记，不入仓库）
- Test: 与 DXF 提取结果一致

**Interfaces:**
- Consumes: 合同图照片、DXF 墙线数据
- Produces: 经交叉验证后的 701 轮廓、房间分区、门窗洞位置

- [ ] **Step 1: 用 vision subagent 精读合同图**

调用 subagent 分析合同图，要求输出：
1. 701 左单元的外轮廓多边形（按东南西北顺序，单位 m）。
2. 每个房间的位置和名称（主卧、次卧、书房、卫生间、厨房、客餐厅、阳台、入户花园等）。
3. 西设备平台、飘窗、门洞、阳台栏杆、入户花园的具体位置。
4. 所有可见的尺寸标注。
5. 与 DXF 9.71m × 9.71m 轮廓是否一致，若不一致指出差异。

- [ ] **Step 2: 与 DXF 提取结果交叉验证**

将 vision subagent 输出的合同图轮廓与 `scripts/.tmp/701-walls.json` 中的 DXF 墙线叠图比较：
- 如果合同图轮廓与 DXF 在 0.2m 以内一致，以 DXF 坐标为准。
- 如果差异超过 0.2m，记录差异并提示用户决策。

- [ ] **Step 3: 输出验证后的房间分区表**

将最终确认的房间 id、名称、中心坐标、width、depth 写入 `scripts/.tmp/contract-analysis.md`，供 Task 3 使用。

---

### Task 1: 删除西设备平台的红色调试边框

**Files:**
- Modify: `app/src/render/HouseScene.ts:942-948`
- Test: 视觉截图（无红色块）

**Interfaces:**
- Consumes: 现有的 `createPlatform` 方法
- Produces: 不再有 `frame` 网格的 platform 渲染

- [ ] **Step 1: 删除红色半透明边框代码**

```typescript
// 删除这段代码
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(p.width + 0.1, 0.05, p.depth + 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.4 })
    );
    frame.position.set(p.x, 0.2, p.z);
    frame.userData = { roomId: p.id, objectId: 'platform_boundary', type: 'platform' };
    this.scene.add(frame);
```

- [ ] **Step 2: 编译验证**

Run: `cd /home/tao/projects/bontop-design-log && npm run typecheck`
Expected: `tsc --noEmit && cd app && tsc --noEmit` 无错误

- [ ] **Step 3: 提交**

```bash
cd /home/tao/projects/bontop-design-log
git add app/src/render/HouseScene.ts
git commit -m "chore: remove red debug frame around platform"
```

---

### Task 2: 从 DXF 提取 701 左单元墙线中心线

**Files:**
- Create: `scripts/extract-dxf-walls.py`
- Test: 运行脚本并查看输出 JSON/可视化

**Interfaces:**
- Consumes: `cad/design/01_floor_plan/Drawing2.dxf`
- Produces: `scripts/.tmp/701-walls.json`（墙线中心线数组）

- [ ] **Step 1: 编写 DXF 解析脚本**

```python
# scripts/extract-dxf-walls.py
import json
from pathlib import Path
import ezdxf
from ezdxf.math import Vec2

DXF_PATH = Path(__file__).resolve().parent.parent / 'cad/design/01_floor_plan/Drawing2.dxf'
OUT_PATH = Path(__file__).resolve().parent.parent / 'scripts/.tmp/701-walls.json'

def main():
    doc = ezdxf.readfile(DXF_PATH)
    msp = doc.modelspace()

    # 1. 收集所有 LINE 和 LWPOLYLINE 的线段
    segments = []
    for entity in msp.query('LINE'):
        s = entity.dxf.start
        e = entity.dxf.end
        segments.append((Vec2(s.x, s.y), Vec2(e.x, e.y)))
    for entity in msp.query('LWPOLYLINE'):
        pts = list(entity.get_points('xy'))
        closed = entity.closed
        for i in range(len(pts) - 1):
            segments.append((Vec2(pts[i][0], pts[i][1]), Vec2(pts[i+1][0], pts[i+1][1])))
        if closed and len(pts) > 2:
            segments.append((Vec2(pts[-1][0], pts[-1][1]), Vec2(pts[0][0], pts[0][1])))

    # 2. 去重并归并共线重叠线段（简化处理：先按长度和角度聚类）
    # 这里仅做简单的去重：如果两条线段端点接近，保留一条
    unique = []
    def same_seg(a, b, tol=1e-3):
        return (a[0].isclose(b[0], tol) and a[1].isclose(b[1], tol)) or \
               (a[0].isclose(b[1], tol) and a[1].isclose(b[0], tol))
    for seg in segments:
        if not any(same_seg(seg, u) for u in unique):
            unique.append(seg)

    # 3. 仅保留 701 左单元（DXF 西侧，x < 12500 mm）
    left_unit = []
    for s, e in unique:
        if s.x < 12500 and e.x < 12500:
            left_unit.append((s, e))

    # 4. 计算局部原点（701 西南角内墙交点，取最小 x 和最小 y）
    min_x = min(min(s.x, e.x) for s, e in left_unit)
    min_y = min(min(s.y, e.y) for s, e in left_unit)
    origin_mm = (min_x, min_y)

    # 5. 把双线墙合并成中心线（简化：将距离 < 260 mm 的平行线段取中值）
    # 这里先直接输出所有线段，后续人工或脚本合并
    walls = []
    for s, e in left_unit:
        walls.append({
            'x1': round((s.x - min_x) / 1000, 4),
            'z1': round((s.y - min_y) / 1000, 4),
            'x2': round((e.x - min_x) / 1000, 4),
            'z2': round((e.y - min_y) / 1000, 4),
        })

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({
        'origin_mm': {'x': round(min_x, 3), 'z': round(min_y, 3)},
        'origin_m': {'x': round(min_x / 1000, 6), 'z': round(min_y / 1000, 6)},
        'wall_count': len(walls),
        'walls': walls,
    }, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'Wrote {len(walls)} wall segments to {OUT_PATH}')
    print(f'Origin (mm): x={min_x:.3f}, y={min_y:.3f}')

if __name__ == '__main__':
    main()
```

- [ ] **Step 2: 运行脚本**

Run: `cd /home/tao/projects/bontop-design-log && python3 scripts/extract-dxf-walls.py`
Expected: 输出类似 `Wrote 128 wall segments to scripts/.tmp/701-walls.json` 和原点坐标

- [ ] **Step 3: 可视化检查**

Run: `python3 -c "
import json
import matplotlib.pyplot as plt
with open('scripts/.tmp/701-walls.json') as f: data = json.load(f)
for w in data['walls']:
    plt.plot([w['x1'], w['x2']], [w['z1'], w['z2']], 'k-')
plt.gca().set_aspect('equal')
plt.title('701 walls from DXF')
plt.savefig('scripts/.tmp/701-walls.png', dpi=150)
print('saved scripts/.tmp/701-walls.png')
"`
Expected: 生成 `scripts/.tmp/701-walls.png`，显示闭合轮廓和内部墙线

- [ ] **Step 4: 提交脚本**

```bash
cd /home/tao/projects/bontop-design-log
git add scripts/extract-dxf-walls.py
git commit -m "feat: add DXF wall extraction script for 701 unit"
```

---

### Task 3: 重写 `config/layout/model-geometry.yaml`

**Files:**
- Modify: `config/layout/model-geometry.yaml`
- Test: `scripts/verify-layout.ts` + `npm run test:server`

**Interfaces:**
- Consumes: `scripts/.tmp/701-walls.json` 的墙线数据
- Produces: 新的 `model-geometry.yaml`（9.71m 轮廓、10 房间、西设备平台）

**房间命名约定（基于 DXF 标注和位置）：**
- `master_bedroom`：主卧（西南，x≈1.89, z≈2.99）
- `bedroom_nw`：西北次卧（x≈3.68, z≈6.76）
- `study`：中部次卧（x≈5.06, z≈2.0）
- `master_bath`：西北卫生间（x≈1.27, z≈7.39）
- `guest_bath`：中部卫生间（x≈5.67, z≈6.01）
- `kitchen`：厨房（东北，x≈7.94, z≈8.43）
- `living_dining`：客餐厅（东侧，x≈8.69, z≈3.56）
- `bedroom_se`：东南次卧（东侧未标注区域，从墙线多边形划分）
- `balcony`：东北阳台（x≈5.68, z≈8.40）
- `entry_garden`：南侧入口区域（根据 DXF 南墙门洞，x≈3.5–6.1, z≈-2.5–0）
- `west_platform`：西南角设备平台（x≈0–0.5, z≈0–0.5 的 45° 区域）

- [ ] **Step 1: 手动或脚本从墙线推导出房间矩形**

由于 DXF 墙线形成复杂多边形，直接手工量取每个房间的 bounding box 或最小外接矩形。参考上一步可视化图的墙线端点，得到每个房间的中心 x、z、width、depth。

如果端点不清晰，可以用 `scripts/.tmp/701-walls.json` 中的坐标手动测量：房间中心取两条对角墙线交点的平均值，width/depth 取房间东西向和南北向最大跨度。

- [ ] **Step 2: 写入新的 `model-geometry.yaml`**

文件内容模板（具体数值以上一步测量为准）：

```yaml
version: '1.0'
source: '人工维护：DXF 701 左单元提取 + 合同图意图'
unit: m
scale: 0.001
origin:
  x: 1.529719  # 701 左下角 DXF x (mm) * 0.001
  z: 1.780198  # 701 左下角 DXF y (mm) * 0.001
export_date: '2026-07-16'
notes: '701 左单元按 DXF 9.71m × 9.71m 轮廓重绘。以 DXF 西南角内墙交点为局部原点。'

rooms:
  - id: master_bedroom
    name: 主卧
    x: 1.89
    z: 2.99
    width: 4.20
    depth: 4.25
    height: 3.0
    area: 17.85
    perimeter: 16.9
  - id: bedroom_nw
    name: 西北次卧
    x: 3.68
    z: 6.76
    width: 3.00
    depth: 2.80
    height: 3.0
    area: 8.39
    perimeter: 11.6
  - id: study
    name: 书房
    x: 5.06
    z: 2.00
    width: 3.00
    depth: 2.80
    height: 3.0
    area: 8.40
    perimeter: 11.6
  - id: master_bath
    name: 主卫
    x: 1.27
    z: 7.39
    width: 2.60
    depth: 1.74
    height: 3.0
    area: 4.53
    perimeter: 8.68
  - id: guest_bath
    name: 客卫
    x: 5.67
    z: 6.01
    width: 1.50
    depth: 1.77
    height: 3.0
    area: 2.66
    perimeter: 6.54
  - id: kitchen
    name: 厨房
    x: 7.94
    z: 8.43
    width: 2.88
    depth: 2.11
    height: 3.0
    area: 6.09
    perimeter: 9.99
  - id: living_dining
    name: 客餐厅
    x: 8.69
    z: 3.56
    width: 5.00
    depth: 5.68
    height: 3.0
    area: 28.40
    perimeter: 21.36
  - id: bedroom_se
    name: 东南次卧
    x: 8.20
    z: 6.50
    width: 2.80
    depth: 3.00
    height: 3.0
    area: 8.40
    perimeter: 11.6
  - id: balcony
    name: 阳台
    x: 5.68
    z: 8.40
    width: 1.96
    depth: 1.23
    height: 3.0
    area: 2.42
    perimeter: 6.39
  - id: entry_garden
    name: 入户花园
    x: 4.50
    z: -1.20
    width: 3.00
    depth: 2.50
    height: 3.0
    area: 7.50
    perimeter: 11.0

platform:
  id: west_platform
  name: 西设备平台
  x: 0.18
  z: 0.18
  width: 0.52
  depth: 0.52
  height: 0.15
  area: 0.13

walls:
  # 从 scripts/.tmp/701-walls.json 复制所有墙线中心线
  # 这里放示例，实际以上述 JSON 为准
  - { x1: 0.0, z1: 0.518, x2: 0.0, z2: 6.26 }
  - { x1: 0.0, z1: 0.518, x2: 0.518, z2: 0.0 }
  # ... 复制全部墙线 ...
```

- [ ] **Step 3: 验证房间无重叠**

Run: `cd /home/tao/projects/bontop-design-log && npx tsx scripts/verify-layout.ts`
Expected: `No overlaps`

- [ ] **Step 4: 运行服务端测试**

Run: `npm run test:server`
Expected: 103 tests pass（此时 api.test.ts 和 model-geometry-layout.test.ts 可能仍会失败，因为还没更新，见 Task 6）

- [ ] **Step 5: 提交**

```bash
cd /home/tao/projects/bontop-design-log
git add config/layout/model-geometry.yaml
git commit -m "feat: rewrite model-geometry.yaml from DXF 701 unit walls"
```

---

### Task 4: 重写 `config/layout/overlay.yaml`

**Files:**
- Modify: `config/layout/overlay.yaml`
- Test: `npm run test:server`（parseOverlay 测试）

**Interfaces:**
- Consumes: 新的 `model-geometry.yaml` 的墙线位置
- Produces: 与新户型匹配的 suppress/curtain_run/bay_sill/floor_region

- [ ] **Step 1: 删除旧 overlay 的 16.4m 相关元素**

将原文件内容清空，只保留版本头。

- [ ] **Step 2: 根据新外轮廓重写 overlay**

```yaml
version: 1
notes: '2026-07-16：按 DXF 9.71m 新轮廓重写，西/南玻璃幕墙，飘窗，门洞补区'

suppress: []
  # 如需把某些墙段改为玻璃幕墙，在这里声明 suppress 区域
  # 例如：西侧 x=0 墙整体改为玻璃幕墙

elements:
  - id: west_curtain
    type: curtain_run
    closed: false
    points:
      - { x: 0.0, z: 0.518 }
      - { x: 0.0, z: 6.26 }
    height: 3.0

  - id: south_curtain
    type: curtain_run
    closed: false
    points:
      - { x: 0.518, z: 0.0 }
      - { x: 6.85, z: 0.0 }
    height: 3.0

  # 主卧飘窗：西南转角
  - id: master_bedroom_bay
    type: bay_sill
    points:
      - { x: 0.0, z: 0.518 }
      - { x: 0.518, z: 0.0 }
    depth: 0.3
    sill: 0.45
    height: 2.55
    reason: '主卧西南转角飘窗'

  # 厨房/北侧飘窗（根据合同图推断，位置待调整）
  - id: north_bay
    type: bay_sill
    points:
      - { x: 0.512, z: 8.755 }
      - { x: 2.269, z: 8.755 }
    depth: 0.3
    sill: 0.45
    height: 2.55
    reason: '北侧飘窗（待精确）'
```

- [ ] **Step 3: 验证 overlay 可解析**

Run: `npm run test:server -- tests/server/overlay-merge.test.ts`
Expected: `parseOverlay` 测试全部通过

- [ ] **Step 4: 提交**

```bash
cd /home/tao/projects/bontop-design-log
git add config/layout/overlay.yaml
git commit -m "feat: rewrite overlay.yaml for new 9.71m 701 outline"
```

---

### Task 5: 更新 `HouseScene.ts` 默认场景边界和相机

**Files:**
- Modify: `app/src/render/HouseScene.ts:33,82-83,1313-1318`
- Test: `app/src/scene/HouseScene.test.ts` + `cd app && npm test`

**Interfaces:**
- Consumes: 新的 `model-geometry.yaml` 的户型边界（约 x: -0.5 ~ 9.7, z: -2.5 ~ 9.7）
- Produces: 新的默认 `DEFAULT_LAYOUT_BOUNDS`、`ORBIT_POSITION`、`ORBIT_TARGET`、`COMPASS_ANCHORS`

- [ ] **Step 1: 更新默认边界**

```typescript
const DEFAULT_LAYOUT_BOUNDS: LayoutBounds = { minX: -1.0, maxX: 10.5, minZ: -3.0, maxZ: 10.5 };
```

- [ ] **Step 2: 更新相机中心和指南针锚点**

```typescript
private readonly ORBIT_POSITION = new THREE.Vector3(4.75, 14, 12.0);
private readonly ORBIT_TARGET = new THREE.Vector3(4.75, 0, 3.75);

private readonly COMPASS_ANCHORS: Record<'n' | 's' | 'e' | 'w', THREE.Vector3> = {
  n: new THREE.Vector3(4.75, 0.05, -4.5),
  s: new THREE.Vector3(4.75, 0.05, 12.0),
  e: new THREE.Vector3(12.0, 0.05, 3.75),
  w: new THREE.Vector3(-2.5, 0.05, 3.75),
};
```

- [ ] **Step 3: 运行 app 测试**

Run: `cd /home/tao/projects/bontop-design-log/app && npm test`
Expected: 130 tests pass（此时 HouseScene.test.ts 默认边界断言还没更新，见 Task 6）

- [ ] **Step 4: 提交**

```bash
cd /home/tao/projects/bontop-design-log
git add app/src/render/HouseScene.ts
git commit -m "chore: update HouseScene default bounds and compass for 9.71m 701 unit"
```

---

### Task 6: 更新测试断言

**Files:**
- Modify: `tests/server/api.test.ts:55-58`
- Modify: `tests/server/model-geometry-layout.test.ts`
- Modify: `app/src/scene/HouseScene.test.ts:173-178`
- Test: `npm run test:server` + `cd app && npm test`

**Interfaces:**
- Consumes: 新的 `model-geometry.yaml` 的房间 id、平台 id、尺寸
- Produces: 与新模型一致的测试断言

- [ ] **Step 1: 更新 `api.test.ts` 平台断言**

```typescript
if (res.body.house.platform) {
  assert.equal(res.body.house.platform?.id, 'west_platform');
  assert.equal(res.body.house.platform?.name, '西设备平台');
}
```

- [ ] **Step 2: 更新 `model-geometry-layout.test.ts`**

```typescript
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ProjectCatalog } from '../../server/project-catalog.js';

describe('model-geometry layout matches DXF 701 unit', () => {
  it('has expected rooms and platform with approximate dimensions', () => {
    const catalog = ProjectCatalog.load('.');
    const rooms = catalog.getRooms();
    const byId = new Map(rooms.map(r => [r.id, r]));

    assert(byId.has('master_bedroom'));
    const master = byId.get('master_bedroom')!;
    assert(master.width >= 3.8 && master.width <= 4.6, 'master width ~4.2m');
    assert(master.depth >= 3.8 && master.depth <= 4.6, 'master depth ~4.25m');

    assert(byId.has('living_dining'));
    const living = byId.get('living_dining')!;
    assert(living.width >= 4.5 && living.width <= 5.5, 'living width ~5.0m');
    assert(living.depth >= 5.0 && living.depth <= 6.0, 'living depth ~5.68m');

    assert(byId.has('study'));
    const study = byId.get('study')!;
    assert(study.width >= 2.6 && study.width <= 3.4, 'study width ~3.0m');

    assert(byId.has('balcony'));
    const balcony = byId.get('balcony')!;
    assert(balcony.width >= 1.6 && balcony.width <= 2.4, 'balcony width ~2.0m');

    assert(byId.has('entry_garden'));
    const entry = byId.get('entry_garden')!;
    assert(entry.width >= 2.5 && entry.width <= 3.5, 'entry garden width ~3.0m');

    const platform = catalog.getPlatform();
    assert(platform);
    assert(platform.id === 'west_platform');
    assert(platform.width >= 0.4 && platform.width <= 0.7, 'west platform width ~0.5m');
    assert(platform.depth >= 0.4 && platform.depth <= 0.7, 'west platform depth ~0.5m');
  });
});
```

- [ ] **Step 3: 更新 `app/src/scene/HouseScene.test.ts` 默认边界断言**

```typescript
expect((scene as any).topDownLayoutBounds).toEqual({
  minX: -1.0,
  maxX: 10.5,
  minZ: -3.0,
  maxZ: 10.5,
});
```

- [ ] **Step 4: 运行全部测试**

Run: `cd /home/tao/projects/bontop-design-log && npm run test:server && cd app && npm test`
Expected: 服务端 103 tests pass，app 130 tests pass

- [ ] **Step 5: 提交**

```bash
cd /home/tao/projects/bontop-design-log
git add tests/server/api.test.ts tests/server/model-geometry-layout.test.ts app/src/scene/HouseScene.test.ts
git commit -m "test: update assertions for DXF-based 701 geometry"
```

---

### Task 7: 截图验证

**Files:**
- Generate: `screenshots/floorplan-701-v2.png`
- Test: 视觉 subagent 检查

**Interfaces:**
- Consumes: `window.__APP__.captureFloorPlan()` 返回的 base64 PNG
- Produces: 保存到 `screenshots/floorplan-701-v2.png`

- [ ] **Step 1: 确保前后端在运行**

Run: `cd /home/tao/projects/bontop-design-log && npm run dev:server`（一个终端）
Run: `cd /home/tao/projects/bontop-design-log/app && npm run dev`（另一个终端）

- [ ] **Step 2: 通过 subagent 调用 Windows Edge 截图**

使用 `task` 工具派 subagent：
- 打开 `http://localhost:5173`
- 等待页面加载
- 在控制台执行 `await window.__APP__.captureFloorPlan()`
- 保存 base64 PNG 为 `screenshots/floorplan-701-v2.png`
- 返回文件路径和尺寸

- [ ] **Step 3: 视觉检查**

使用 vision subagent 分析 `screenshots/floorplan-701-v2.png`：
- 确认外轮廓约 9.71m × 9.71m
- 确认 10 个房间可见
- 确认左侧无红色块
- 确认北（-z）方向上、南（+z）方向下
- 确认西设备平台在左侧
- 确认入户花园在南侧
- 确认阳台在东北侧或南侧（取决于最终布局）

- [ ] **Step 4: 提交截图（如果用户希望纳入版本）**

```bash
cd /home/tao/projects/bontop-design-log
git add screenshots/floorplan-701-v2.png
git commit -m "docs: add top-down floor plan screenshot for 701 v2"
```

---

## 自我审查

### Spec 覆盖
- 所有任务覆盖了：几何重写、overlay 重写、渲染调试、测试更新、截图验证。

### Placeholder 扫描
- 无 TBD、TODO。
- `overlay.yaml` 中的 curtain_run 和 bay_sill 坐标是示例，需在实际执行时根据 `scripts/.tmp/701-walls.json` 精确填写。
- `model-geometry.yaml` 中的具体数值是模板，需根据 DXF 墙线测量结果填写。

### 类型一致性
- 平台 id 统一为 `west_platform`。
- 房间 id 与 `house.yaml` 和现有 API 保持一致。
- 默认边界在 `HouseScene.ts` 和 `HouseScene.test.ts` 中一致。

### 风险点
- DXF 墙线中心线需要手动合并双线墙，否则 walls 数组会过大。
- 客餐厅、东南次卧、入户花园的具体尺寸在 DXF 中不够明确，需结合墙线多边形和合同图意图人工确定。
- 如果用户希望保留 16.4m 模型而不是 9.71m 模型，本方案需要重新评估。

---

## 执行选项

计划已保存到 `docs/superpowers/plans/2026-07-16-redraw-701-from-dxf.md`。

**1. Subagent-Driven（推荐）**：每个 Task 派一个独立 subagent 执行，完成后我 review 再进入下一步。

**2. Inline Execution**：在本会话中按 Task 顺序批量执行，每个 Task 完成后 checkpoint 给你确认。

请选择执行方式，并确认以下假设：
- 接受 DXF 9.71m 轮廓作为 701 几何参考。
- 入户花园按 DXF 放在南侧（南墙门洞区域）。
- 中部次卧命名为 `study`，东侧未标注房间命名为 `bedroom_se`。
