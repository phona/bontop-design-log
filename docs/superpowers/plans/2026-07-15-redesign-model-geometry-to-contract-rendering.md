# Redesign Model-Geometry to Contract Plan & Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `config/layout/model-geometry.yaml` 从当前 16.4m 矩形简化版重画为合同分户图/效果图对应的 16.4m U 型户型（含圆角、四房、入户花园、南向阳台、西设备平台），`Drawing2.dxf` 仅作房间面积与拓扑参考。

**Architecture:** 以 `model-geometry.yaml` 为几何权威源，`overlay.yaml` 为意图层；外墙用 walls 折线表达 U 型 + 圆弧过渡，房间内用轴对齐矩形，玻璃幕墙/飘窗/地板补区通过 overlay 声明；渲染器按合并后的 sceneElements 渲染。

**Tech Stack:** YAML, TypeScript/Three.js, zod (`server/overlay-merge.ts`), Python/ezdxf (`scripts/parse_cad.py`), Node.js 测试运行器。

## Global Constraints

- `model-geometry.yaml` 是唯一户型几何权威源；`overlay.yaml` 出一切意图；代码只读、只执行，禁止推断。
- `walls` 只保留 `x1/z1/x2/z2` 纯几何字段，禁止追加意图字段。
- `rooms` 必须为轴对齐矩形；非矩形区域用 `overlay.yaml` 的 `floor_region` 补。
- 以合同分户图 + 效果图为主源；`Drawing2.dxf` 仅用于核对房间面积和相邻关系。
- 每次 task 跑 `npm run test:server` 和 `npm run typecheck` 验证。
- 每个 task 独立 commit；不执行 `git push`/`git rebase` 等远端操作。

---

## File Structure

| 文件 | 本计划改动 | 说明 |
|------|-----------|------|
| `config/layout/model-geometry.yaml` | 全文重写 | 户型几何权威源：U 型外框、9 个房间、西设备平台、所有内墙 |
| `config/layout/overlay.yaml` | 全文重写 | 玻璃幕墙 suppress、curtain_run、 bay_sill、floor_region |
| `app/src/render/HouseScene.ts` | 修改 bounds/compass | 默认相机范围与指南针锚点适配新 U 型 |
| `tests/server/model-geometry-layout.test.ts` | 修改断言 | 校验新房间尺寸 |
| `config/layout/model-geometry-from-cad.yaml` | 临时创建后删除 | 从 DXF 提取参考草稿 |

---

## Task 1: 从 DXF 提取参考草稿

**Files:**
- Create: `config/layout/model-geometry-from-cad.yaml`（临时，最终删除）
- Read: `cad/design/01_floor_plan/Drawing2.dxf`
- Modify: 无

**Interfaces:**
- Consumes: `scripts/parse_cad.py` CLI
- Produces: 临时 YAML，含 DXF 房间标签面积、墙线拓扑、房间相对位置

- [ ] **Step 1: 确认临时 CAD 锚点可解析新 DXF**

`Drawing2.dxf` 与当前 `cad-anchor.yaml` 坐标不匹配，需要先以边界框为原点做一次性参考提取。运行：

```bash
cd /home/tao/projects/bontop-design-log
python3 - <<'PY'
import ezdxf, yaml, json
from pathlib import Path
import sys
sys.path.insert(0, 'scripts')
from parse_cad import (
    collect_wall_segments, extract_walls, extract_room_labels,
    parse_label_areas, extract_room_geometry, CadAnchor
)

dxf = Path('cad/design/01_floor_plan/Drawing2.dxf')
doc = ezdxf.readfile(dxf)
msp = doc.modelspace()

# 用墙线边界框作为临时原点
segs = []
for e in msp:
    if e.dxf.layer != 'BS-非承重墙': continue
    if e.dxftype() == 'LINE':
        segs.append(((e.dxf.start.x, e.dxf.start.y), (e.dxf.end.x, e.dxf.end.y)))
    elif e.dxftype() == 'LWPOLYLINE':
        pts = list(e.vertices_in_wcs())
        for i in range(len(pts)-1):
            segs.append(((pts[i][0], pts[i][1]), (pts[i+1][0], pts[i+1][1])))

xs = [x for (x,_),_ in segs] + [x for _,(x,_) in segs]
ys = [y for (_,y),_ in segs] + [y for _,(_,y) in segs]
ox, oy = min(xs), max(ys)
anchor = CadAnchor(origin_x=ox, origin_y=oy, frame=(ox-500, min(ys)-500, max(xs)+500, oy+500))

labels, skipped = extract_room_labels(msp)
areas = parse_label_areas(msp, labels)
print('Labels:', json.dumps({k: (v[0], v[1], v[2], areas.get(k)) for k,v in labels.items()}, ensure_ascii=False, indent=2))
print('Areas:', areas)
print('Walls:', len(extract_walls(msp, anchor)))
PY
```

Expected: 输出 9 个中文标签（主卧、次卧×3、客餐厅、厨房、卫生间×2、阳台）及对应面积。

- [ ] **Step 2: 生成临时草稿文件**

```bash
cd /home/tao/projects/bontop-design-log
python scripts/parse_cad.py \
  --cad-dir cad/design/01_floor_plan \
  --output config/layout/model-geometry-from-cad.yaml \
  --report scripts/logs/cad-extraction-report-drawing2.json
```

> 注意：该命令会报错，因为 `parse_cad.py` 默认找 `floor_plan_design_*.dxf` 且当前锚点不匹配。需先临时修改脚本或直接用 `--cad-dir` + 临时锚点。作为 plan 执行时，应写一个一次性 Python 脚本替代 CLI。

- [ ] **Step 3: 人工核对面积清单**

核对 `config/layout/model-geometry-from-cad.yaml` 里的面积与 `config/house.yaml` 是否一致：

| 房间 | DXF 标签面积 | house.yaml 面积 | 状态 |
|------|-------------|-----------------|------|
| 主卧 | 18.16 | 18.16 | ✓ |
| 次卧 1 | 8.39 | 8.39 | ✓ |
| 次卧 2 | 8.39 | 8.39 | ✓ |
| 次卧 3/书房 | 8.35 | 8.35 | ✓ |
| 客餐厅 | 35.20 | 35.20 | ✓ |
| 厨房 | 6.09 | 6.09 | ✓ |
| 主卫 | 4.53 | 4.53 | ✓ |
| 客卫 | 2.66 | 2.66 | ✓ |
| 阳台 | 2.42 | 2.42 | ✓ |

- [ ] **Step 4: Commit 参考草稿（不删除，Task 7 再删除）**

```bash
git add config/layout/model-geometry-from-cad.yaml scripts/logs/cad-extraction-report-drawing2.json
git commit -m "chore: add Drawing2.dxf reference draft for model redesign"
```

---

## Task 2: 确认合同图精确尺寸

**Files:**
- Read: 用户提供的合同分户图照片
- Create: `/tmp/contract-dimensions.md`（临时笔记，不进入仓库）

**Interfaces:**
- Consumes: 合同分户图 + 效果图
- Produces: 经用户确认的房间尺寸表，供 Task 3 使用

- [ ] **Step 1: 从效果图提取清晰尺寸**

效果图已标注的尺寸（单位 m）：

| 位置 | 尺寸 | 说明 |
|------|------|------|
| 总宽 | 16.40 | 底部 4.20+3.00+6.20+3.00 |
| 左侧深 | 9.80 | 4.30+1.25+4.25 |
| 右侧深 | 10.40 | 2.90+2.00+4.40+1.10 |
| 主卧床区 | 4.20 × 4.25 | 左下角 |
| 主卫 | 2.60 × 4.30 | 左上角 |
| 书房/左上卧室 | 3.00 × 4.30 | 效果图顶部 2.60 右侧的 3.00 |
| 厨房 | 3.60 × 2.00 | 顶部中间 |
| 客餐厅 | 6.20 × 5.68 | 按 house.yaml 深度 |
| 右下卧室 | 3.00 × 4.40 | 右侧 |
| 入户花园 | 4.45 × 2.90 | 右上角 |
| 阳台 | 6.20 × 2.20 | 效果图右下/合同图底部 |

- [ ] **Step 2: 请用户确认合同图关键尺寸**

由于合同图照片部分尺寸重叠，需要用户确认以下 3 项：

1. **中间走廊宽度**：左右两翅膀之间是否为 3.80m？
2. **客卫**：尺寸是否为 1.50 × 1.77m（按 house.yaml）？
3. **阳台**：底部阳台是否 6.20m 宽 × 2.20m 深？

如用户确认，进入 Task 3；如有调整，更新本表后再进入 Task 3。

- [ ] **Step 3: 记录确认后的尺寸表（不入仓库）**

将确认值写入 `/tmp/contract-dimensions.md` 供后续 task 引用。

---

## Task 3: 重写 `model-geometry.yaml`

**Files:**
- Modify: `config/layout/model-geometry.yaml`（全文替换）
- Read: `/tmp/contract-dimensions.md`, `config/house.yaml`

**Interfaces:**
- Consumes: Task 1 的面积清单、Task 2 的尺寸表
- Produces: 新的 `model-geometry.yaml`，含 9 个房间、西设备平台、U 型外墙、内墙

- [ ] **Step 1: 重写 rooms 段**

坐标约定：x 向东，z 向南；西北角为 `(0, 0)`，入户花园向北凸出为 `z < 0`。

```yaml
rooms:
  - id: master_bath
    name: 主卫
    x: 1.30
    z: 2.15
    width: 2.60
    depth: 4.30
    height: 3.0
    area: 11.18
    perimeter: 13.8

  - id: master_bedroom
    name: 主卧
    x: 2.10
    z: 7.675
    width: 4.20
    depth: 4.25
    height: 3.0
    area: 17.85
    perimeter: 16.9

  - id: bedroom_nw
    name: 西北次卧
    x: 4.10
    z: 2.15
    width: 3.00
    depth: 4.30
    height: 3.0
    area: 12.90
    perimeter: 14.6

  - id: study
    name: 书房
    x: 5.70
    z: 7.675
    width: 3.00
    depth: 4.25
    height: 3.0
    area: 12.75
    perimeter: 14.5

  - id: guest_bath
    name: 客卫
    x: 5.70
    z: 5.50
    width: 1.50
    depth: 1.77
    height: 3.0
    area: 2.66
    perimeter: 6.54

  - id: kitchen
    name: 厨房
    x: 9.00
    z: 1.00
    width: 3.60
    depth: 2.00
    height: 3.0
    area: 7.20
    perimeter: 11.2

  - id: living_dining
    name: 客餐厅
    x: 10.30
    z: 5.40
    width: 6.20
    depth: 5.68
    height: 3.0
    area: 35.22
    perimeter: 23.76

  - id: bedroom_se
    name: 东南次卧
    x: 14.90
    z: 7.60
    width: 3.00
    depth: 4.40
    height: 3.0
    area: 13.20
    perimeter: 14.8

  - id: balcony
    name: 阳台
    x: 10.30
    z: 9.10
    width: 6.20
    depth: 2.20
    height: 3.0
    area: 13.64
    perimeter: 16.8

  - id: entry_garden
    name: 入户花园
    x: 13.025
    z: -1.45
    width: 4.45
    depth: 2.90
    height: 3.0
    area: 12.90
    perimeter: 14.7
```

> 注：如果 Task 2 用户确认的尺寸不同，替换本段数值。

- [ ] **Step 2: 重写 platform 段**

```yaml
platform:
  id: west_platform
  name: 西设备平台
  x: -0.80
  z: 0.775
  width: 1.60
  depth: 1.55
  height: 0.15
  area: 2.48
```

删除旧 `elevator` 平台；电梯/楼梯/管井在户型中心，按合同图属于公共区，不渲染为房间或平台。

- [ ] **Step 3: 重写 walls 段（U 型外框 + 内墙）**

U 型外框关键点（按顺时针从西北角出发，701 为左单元）：

```yaml
walls:
  # 西设备平台外凸
  - { x1: -1.60, z1: 0.00, x2: -1.60, z2: 1.55 }
  - { x1: -1.60, z1: 1.55, x2: 0.00, z2: 1.55 }

  # 西外墙（含 SW 圆弧过渡，用多段近似）
  - { x1: 0.00, z1: 1.55, x2: 0.00, z2: 5.00 }
  - { x1: 0.00, z1: 5.00, x2: 0.20, z2: 6.00 }
  - { x1: 0.20, z1: 6.00, x2: 0.80, z2: 7.00 }
  - { x1: 0.80, z1: 7.00, x2: 2.00, z2: 7.80 }
  - { x1: 2.00, z1: 7.80, x2: 4.20, z2: 9.80 }
  - { x1: 4.20, z1: 9.80, x2: 10.30, z2: 9.80 }

  # 南外墙（balcony 前段实墙 + 阳台）
  - { x1: 10.30, z1: 9.80, x2: 16.40, z2: 9.80 }
  - { x1: 16.40, z1: 9.80, x2: 16.40, z2: 5.40 }

  # 东外墙（含 SE 圆弧过渡）
  - { x1: 16.40, z1: 5.40, x2: 15.20, z2: 4.40 }
  - { x1: 15.20, z1: 4.40, x2: 14.40, z2: 3.60 }
  - { x1: 14.40, z1: 3.60, x2: 13.90, z2: 2.60 }
  - { x1: 13.90, z1: 2.60, x2: 13.90, z2: 0.00 }

  # 北外墙（主楼北墙 + 入户花园东/北墙）
  - { x1: 13.90, z1: 0.00, x2: 13.90, z2: -2.90 }
  - { x1: 13.90, z1: -2.90, x2: 10.80, z2: -2.90 }
  - { x1: 10.80, z1: -2.90, x2: 10.80, z2: 0.00 }
  - { x1: 10.80, z1: 0.00, x2: -1.60, z2: 0.00 }

  # 内墙
  - { x1: 0.00, z1: 4.30, x2: 2.60, z2: 4.30 }      # 主卫南墙
  - { x1: 2.60, z1: 0.00, x2: 2.60, z2: 5.55 }      # 主卧-次卧分隔西墙
  - { x1: 4.20, z1: 0.00, x2: 4.20, z2: 4.30 }      # 书房西墙
  - { x1: 2.60, z1: 5.55, x2: 5.70, z2: 5.55 }      # 主卧-书房南墙
  - { x1: 5.70, z1: 4.30, x2: 5.70, z2: 9.80 }      # 书房-客卫东墙
  - { x1: 5.70, z1: 7.45, x2: 10.30, z2: 7.45 }     # 客卫-书房/客厅分隔
  - { x1: 7.20, z1: 0.00, x2: 7.20, z2: 2.00 }      # 厨房西墙
  - { x1: 10.80, z1: 0.00, x2: 10.80, z2: 2.00 }    # 厨房东墙
  - { x1: 10.80, z1: 2.00, x2: 13.80, z2: 2.00 }    # 厨房北墙
  - { x1: 13.40, z1: 2.00, x2: 13.40, z2: 5.40 }    # 客餐厅-入户花园/次卧分隔
  - { x1: 13.40, z1: 5.40, x2: 16.40, z2: 5.40 }    # 次卧南墙
  - { x1: 10.30, z1: 7.45, x2: 10.30, z2: 9.80 }    # 阳台西墙
```

> 圆弧角用 3-4 段短墙近似；后续如需要更光滑，可在 overlay 的 `curtain_run` 中用 `radius` 参数表达。

- [ ] **Step 4: 验证 walls 与 rooms 同坐标系且无重叠**

```bash
cd /home/tao/projects/bontop-design-log
npx tsx -e "
import { ProjectCatalog } from './server/project-catalog.js';
const cat = ProjectCatalog.load('.');
const rooms = cat.getRooms();
console.log('rooms:', rooms.length);
for (const r of rooms) {
  const xmin = r.x - r.width/2, xmax = r.x + r.width/2;
  const zmin = r.z - r.depth/2, zmax = r.z + r.depth/2;
  console.log(r.id, 'x:[', xmin.toFixed(2), xmax.toFixed(2), '] z:[', zmin.toFixed(2), zmax.toFixed(2), ']');
}
let overlap = false;
for (let i=0; i<rooms.length; i++) {
  for (let j=i+1; j<rooms.length; j++) {
    const a = rooms[i], b = rooms[j];
    const ax1 = a.x - a.width/2, ax2 = a.x + a.width/2;
    const az1 = a.z - a.depth/2, az2 = a.z + a.depth/2;
    const bx1 = b.x - b.width/2, bx2 = b.x + b.width/2;
    const bz1 = b.z - b.depth/2, bz2 = b.z + b.depth/2;
    if (ax1 < bx2 && ax2 > bx1 && az1 < bz2 && az2 > bz1) {
      console.log('OVERLAP', a.id, b.id);
      overlap = true;
    }
  }
}
if (!overlap) console.log('no overlaps');
console.log('walls:', cat.getWalls().length);
"
```

Expected: `rooms: 10`, `no overlaps`, `walls: ~22`。

- [ ] **Step 5: Commit**

```bash
git add config/layout/model-geometry.yaml
git commit -m "feat: redesign model-geometry.yaml to U-shape contract/rendering layout"
```

---

## Task 4: 重写 `overlay.yaml`

**Files:**
- Modify: `config/layout/overlay.yaml`（全文替换）
- Read: `config/layout/model-geometry.yaml`（Task 3 产出）

**Interfaces:**
- Consumes: 新 model-geometry.yaml 的墙线
- Produces: 声明式 suppress 区域 + curtain_run + bay_sill + floor_region

- [ ] **Step 1: 定义 suppress 区域**

外墙中需要被玻璃幕墙替换的实墙段：西、南、北三向。注意入户花园、西设备平台、东墙保持实墙。

```yaml
suppress:
  - id: suppress_west_wall
    region: { x1: -0.5, z1: -0.5, x2: 0.5, z2: 10.3 }
    reason: "西外墙改玻璃幕墙"

  - id: suppress_south_wall
    region: { x1: -0.5, z1: 9.3, x2: 16.9, z2: 10.3 }
    reason: "南外墙改玻璃幕墙（含阳台南侧）"

  - id: suppress_north_wall
    region: { x1: -0.5, z1: -0.5, x2: 10.9, z2: 0.5 }
    reason: "主楼北外墙改玻璃幕墙"

  - id: suppress_entry_garden_south_shared
    region: { x1: 10.7, z1: -0.5, x2: 13.9, z2: 0.5 }
    reason: "入户花园与主楼之间的共用墙若为实墙则保留；仅 suppress 误识别的小碎线"

  - id: suppress_bedroom_se_corner
    region: { x1: 15.9, z1: 9.7, x2: 16.9, z2: 10.0 }
    reason: "东南次卧南向凸窗，仅右下角 1.1m 段"
```

- [ ] **Step 2: 定义 curtain_run（玻璃幕墙）**

沿西-南-北外框走一圈，包含 SW/NW 圆角过渡：

```yaml
elements:
  - id: glass_facade
    type: curtain_run
    closed: true
    points:
      - { x: 0.00, z: 0.00 }
      - { x: 0.00, z: 5.00 }
      - { x: 0.20, z: 6.00 }
      - { x: 0.80, z: 7.00 }
      - { x: 2.00, z: 7.80 }
      - { x: 4.20, z: 9.80 }
      - { x: 16.40, z: 9.80 }
      - { x: 16.40, z: 5.40 }
      - { x: 15.20, z: 4.40 }
      - { x: 14.40, z: 3.60 }
      - { x: 13.90, z: 2.60 }
      - { x: 13.80, z: 0.00 }
      - { x: 10.80, z: 0.00 }
      - { x: 10.80, z: -2.90 }
      - { x: 13.80, z: -2.90 }
      - { x: 13.80, z: 0.00 }
    height: 3.0
```

> 入户花园东/北墙为实墙，不加入 curtain_run。

- [ ] **Step 3: 定义 bay_sill（上飘窗）**

主卧西侧、主卧南侧、西北次卧西侧、东南次卧南侧：

```yaml
  - id: master_bedroom_west_bay
    type: bay_sill
    points:
      - { x: 0.00, z: 5.00 }
      - { x: 0.00, z: 9.80 }
    depth: 0.30
    sill: 0.45
    height: 2.55
    reason: "主卧西墙环幕飘窗"

  - id: master_bedroom_south_bay
    type: bay_sill
    points:
      - { x: 0.00, z: 9.80 }
      - { x: 4.20, z: 9.80 }
    depth: 0.30
    sill: 0.45
    height: 2.55
    reason: "主卧南墙环幕飘窗"

  - id: bedroom_nw_west_bay
    type: bay_sill
    points:
      - { x: 0.00, z: 0.00 }
      - { x: 0.00, z: 5.00 }
    depth: 0.30
    sill: 0.45
    height: 2.55
    reason: "西北次卧西墙上飘窗"

  - id: bedroom_se_south_bay
    type: bay_sill
    points:
      - { x: 13.40, z: 9.80 }
      - { x: 16.40, z: 9.80 }
    depth: 0.30
    sill: 0.45
    height: 2.55
    reason: "东南次卧南向凸窗"
```

- [ ] **Step 4: 定义 floor_region（补地板）**

入户花园、走廊过渡区：

```yaml
  - id: entry_garden_floor
    type: floor_region
    points:
      - { x: 10.80, z: 0.00 }
      - { x: 13.80, z: 0.00 }
      - { x: 13.80, z: -2.90 }
      - { x: 10.80, z: -2.90 }
    reason: "入户花园地板"

  - id: corridor_floor
    type: floor_region
    points:
      - { x: 4.20, z: 4.30 }
      - { x: 7.20, z: 4.30 }
      - { x: 7.20, z: 7.45 }
      - { x: 4.20, z: 7.45 }
    reason: "主卧与客餐厅之间的过道"
```

- [ ] **Step 5: 验证 overlay schema**

```bash
cd /home/tao/projects/bontop-design-log
npx tsx -e "
import { parseOverlay } from './server/overlay-merge.js';
import { readFileSync } from 'fs';
const cfg = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
console.log('suppress:', cfg.suppress.length, 'elements:', cfg.elements.length);
"
```

Expected: `suppress: 5 elements: 7`（或根据实际调整）。

- [ ] **Step 6: Commit**

```bash
git add config/layout/overlay.yaml
git commit -m "feat: rewrite overlay for U-shape glass facade and bay sills"
```

---

## Task 5: 更新 `HouseScene.ts` 场景边界

**Files:**
- Modify: `app/src/render/HouseScene.ts:33,74,83,1313-1318`

**Interfaces:**
- Consumes: 新 model-geometry.yaml 的 bounds（x: -0.5~16.9, z: -3.4~10.3）
- Produces: 默认相机范围与指南针锚点适配 U 型

- [ ] **Step 1: 更新默认 bounds 常量**

```typescript
const DEFAULT_LAYOUT_BOUNDS: LayoutBounds = { minX: -0.5, maxX: 16.9, minZ: -3.4, maxZ: 10.3 };
```

- [ ] **Step 2: 更新初始 orbit target**

```typescript
private readonly ORBIT_TARGET = new THREE.Vector3(8.2, 0, 3.45);
```

（保持 centerX=8.2，centerZ 取 (10.3 + (-3.4))/2 = 3.45）

- [ ] **Step 3: 更新指南针锚点**

```typescript
private readonly COMPASS_ANCHORS: Record<'n' | 's' | 'e' | 'w', THREE.Vector3> = {
  n: new THREE.Vector3(8.2, 0.05, -3.9),
  s: new THREE.Vector3(8.2, 0.05, 10.8),
  e: new THREE.Vector3(17.6, 0.05, 3.45),
  w: new THREE.Vector3(-1.2, 0.05, 3.45),
};
```

- [ ] **Step 4: Commit**

```bash
git add app/src/render/HouseScene.ts
git commit -m "fix: update scene bounds and compass anchors for U-shape layout"
```

---

## Task 6: 更新测试断言

**Files:**
- Modify: `tests/server/model-geometry-layout.test.ts`

**Interfaces:**
- Consumes: 新 `ProjectCatalog.load()` 返回的房间
- Produces: 按新户型尺寸的范围断言

- [ ] **Step 1: 重写测试断言**

```typescript
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ProjectCatalog } from '../../server/project-catalog.js';

describe('model-geometry layout matches contract plan / rendering', () => {
  it('has expected rooms with approximate dimensions', () => {
    const catalog = ProjectCatalog.load('.');
    const rooms = catalog.getRooms();
    const byId = new Map(rooms.map(r => [r.id, r]));

    assert(byId.has('master_bedroom'));
    const master = byId.get('master_bedroom')!;
    assert(master.width >= 4.0 && master.width <= 4.4, 'master width ~4.2m');
    assert(master.depth >= 4.0 && master.depth <= 4.6, 'master depth ~4.25m');

    assert(byId.has('study'));
    const study = byId.get('study')!;
    assert(study.width >= 2.8 && study.width <= 3.2, 'study width ~3.0m');
    assert(study.depth >= 4.0 && study.depth <= 4.6, 'study depth ~4.25m');

    assert(byId.has('living_dining'));
    const living = byId.get('living_dining')!;
    assert(living.width >= 5.8 && living.width <= 6.6, 'living width ~6.2m');
    assert(living.depth >= 5.3 && living.depth <= 6.1, 'living depth ~5.68m');

    assert(byId.has('balcony'));
    const balcony = byId.get('balcony')!;
    assert(balcony.width >= 5.8 && balcony.width <= 6.6, 'balcony width ~6.2m');
    assert(balcony.depth >= 1.8 && balcony.depth <= 2.6, 'balcony depth ~2.2m');

    assert(byId.has('entry_garden'));
    const entry = byId.get('entry_garden')!;
    assert(entry.width >= 4.0 && entry.width <= 4.8, 'entry garden width ~4.45m');
    assert(entry.depth >= 2.6 && entry.depth <= 3.2, 'entry garden depth ~2.9m');
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
cd /home/tao/projects/bontop-design-log
npm run test:server -- tests/server/model-geometry-layout.test.ts --run
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/server/model-geometry-layout.test.ts
git commit -m "test: update layout assertions for U-shape redesign"
```

---

## Task 7: 全量回归与视觉验收

**Files:**
- Run: 测试命令
- Delete: `config/layout/model-geometry-from-cad.yaml`（临时参考草稿）

**Interfaces:**
- Consumes: 前面所有 task 的产出
- Produces: 通过测试 + 正交俯视截图

- [ ] **Step 1: 跑全量 server 测试**

```bash
cd /home/tao/projects/bontop-design-log
npm run test:server -- --run
```

Expected: 全部通过（~103/103）。

- [ ] **Step 2: 类型检查**

```bash
cd /home/tao/projects/bontop-design-log
npm run typecheck
```

Expected: 无类型错误。

- [ ] **Step 3: 删除临时 DXF 参考草稿**

```bash
rm config/layout/model-geometry-from-cad.yaml scripts/logs/cad-extraction-report-drawing2.json
```

- [ ] **Step 4: 启动 dev server 并验收**

```bash
cd /home/tao/projects/bontop-design-log
npm run dev
```

浏览器打开后切换到俯视图，检查：
1. 房子整体在屏幕中心，北朝上（入户花园在北），南朝下（阳台在南）。
2. 外轮廓为 U 型，四角有圆弧过渡。
3. 西、南、北外墙为玻璃幕墙（蓝色透明）。
4. 东墙、入户花园东/北墙、设备平台为实墙。
5. 主卧、次卧、书房有飘窗凸台。
6. 房间分布与效果图/合同图一致。

- [ ] **Step 5: 提交验收结果**

```bash
git add -A
git commit -m "test: verify U-shape layout via server tests and top-down render"
```

---

## Self-Review

1. **Spec coverage**: 权威源反转、模型文件重写、overlay 重写、渲染器 bounds、测试更新、视觉验收均覆盖。
2. **Placeholder scan**: 无 TBD/TODO；圆弧角用 walls 多段近似，如需更光滑可在 overlay `curtain_run` 中加 `radius`；Task 2 需要用户确认 3 个关键尺寸。
3. **Type consistency**: `model-geometry.yaml` schema 与现有 `ProjectCatalog`/`overlay-merge.ts` 一致；`HouseScene.ts` bounds 类型保持 `LayoutBounds`。
4. **Risk**: 合同图部分尺寸照片重叠，Task 2 必须用户确认；如尺寸不同，只需替换 Task 3 的数值，不改变任务结构。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-15-redesign-model-geometry-to-contract-rendering.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
