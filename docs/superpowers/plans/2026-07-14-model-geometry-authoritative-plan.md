# Model-Geometry 权威户型源 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `config/layout/model-geometry.yaml` 设为户型几何权威源，并基于效果图重新整理墙线与房间；保留 overlay 作为视觉/意图层；最终通过浏览器正交俯视截图与效果图对比验收。

**Architecture:** 文件重命名 + 所有消费路径更新；`parse_cad.py` 默认不再覆盖模型文件；`model-geometry.yaml` 由人工维护，包含外墙、内墙、房间矩形、平台；`overlay.yaml` 继续声明 suppress/curtain_run/bay_sill/floor_region/glass_infill。

**Tech Stack:** YAML, TypeScript/Node.js, Python/ezdxf, pytest, CDP (Chrome DevTools Protocol) 截图验收。

## Global Constraints

- `model-geometry.yaml` 的 `walls` 只保留 `x1/z1/x2/z2` 纯几何字段，禁止任何意图字段。
- CAD 不再作为权威源；`parse_cad.py` 默认输出到临时文件，不得覆盖 `model-geometry.yaml`。
- Overlay schema 保持 strict；未知字段/类型必须报错。
- 所有既有测试在修改后仍须通过。
- 最终验收：正交俯视截图与效果图的户型轮廓、房间分布一致。

---

### Task 1: 新增失败测试——`ProjectCatalog.load` 默认读取 `model-geometry.yaml`

**Files:**
- Create: `tests/server/model-geometry-path.test.ts`
- Modify: 无（先写测试，后改代码）

**Interfaces:**
- Consumes: `ProjectCatalog.load()` from `server/project-catalog.ts`
- Produces: 断言 `ProjectCatalog.load('.')` 的默认 layout 源为 `model-geometry.yaml`

- [ ] **Step 1: 写失败测试**

```typescript
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ProjectCatalog default layout source', () => {
  it('loads config/layout/model-geometry.yaml by default', () => {
    const dir = join(tmpdir(), `bontop-model-geometry-${Date.now()}`);
    mkdirSync(join(dir, 'config/layout'), { recursive: true });
    mkdirSync(join(dir, 'config/budget'), { recursive: true });
    mkdirSync(join(dir, 'config/materials'), { recursive: true });

    writeFileSync(
      join(dir, 'config/layout/model-geometry.yaml'),
      `version: '1.0'\nunit: m\nrooms: []\nwalls: []\n`,
    );
    writeFileSync(join(dir, 'config/house.yaml'), `rooms: []\ngift_areas: []\n`);
    writeFileSync(join(dir, 'config/materials.yaml'), `materials: []\n`);
    writeFileSync(join(dir, 'config/budget/base.json'), `{"total_budget": 0, "categories": {}}`);

    const catalog = ProjectCatalog.load(dir);
    assert.strictEqual(catalog.layoutSource, 'model-geometry.yaml');

    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test:server -- tests/server/model-geometry-path.test.ts --run
```

预期：FAIL，因为 `ProjectCatalog.load` 当前默认读取 `cad-extracted.yaml`。

- [ ] **Step 3: 提交测试**

```bash
git add tests/server/model-geometry-path.test.ts
git commit -m "test: add failing test for model-geometry default layout source"
```

---

### Task 2: 重命名文件并更新所有消费路径

**Files:**
- Modify: `server/project-catalog.ts:180`
- Modify: `server/index.ts:72,76`
- Modify: `app/src/App.ts:105`
- Modify: `shared/houseData.ts:5`（注释）
- Modify: `README.md:86`
- Modify: `scripts/README.md:9,23,30`
- Create: `config/layout/model-geometry.yaml`（从当前 `cad-extracted.yaml` 复制，作为临时起点）
- Delete: `config/layout/cad-extracted.yaml`

**Interfaces:**
- Consumes: Task 1 的测试结果
- Produces: 所有 `cad-extracted` 路径/默认值改为 `model-geometry`

- [ ] **Step 1: 复制临时模型文件**

```bash
cp config/layout/cad-extracted.yaml config/layout/model-geometry.yaml
```

- [ ] **Step 2: 修改 `server/project-catalog.ts`**

将 `ProjectCatalog.load` 默认路径改为 `config/layout/model-geometry.yaml`：

```typescript
const layoutPath = layoutName
  ? `${configDir}/config/layout/${layoutName}.yaml`
  : `${configDir}/config/layout/model-geometry.yaml`;
```

- [ ] **Step 3: 修改 `server/index.ts` 的 watch 路径和日志**

将 watch 列表中的 `config/layout/cad-extracted.yaml` 改为 `config/layout/model-geometry.yaml`；日志文本同步修改。

- [ ] **Step 4: 修改 `app/src/App.ts` 默认 layout source**

```typescript
this.overviewMenu.setActiveLayout(this.projectData.house.layoutSource ?? 'model-geometry');
```

- [ ] **Step 5: 更新注释和 README 引用**

将所有 `cad-extracted.yaml` 的文本引用改为 `model-geometry.yaml`。

- [ ] **Step 6: 删除旧文件**

```bash
rm config/layout/cad-extracted.yaml
```

- [ ] **Step 7: 运行测试**

```bash
npm run test:server -- --run
```

预期：Task 1 的测试通过；其他既有测试通过。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "refactor: rename cad-extracted.yaml to model-geometry.yaml"
```

---

### Task 3: 新增失败测试——`parse_cad.py` 默认不覆盖模型文件

**Files:**
- Create: 临时测试代码（直接在 `scripts/parse_cad_test.py` 末尾追加）
- Modify: 无

**Interfaces:**
- Consumes: `parse_cad.py` CLI 接口
- Produces: 断言默认输出文件不再是 `config/layout/model-geometry.yaml`（而是临时路径）

- [ ] **Step 1: 写失败测试**

在 `scripts/parse_cad_test.py` 末尾追加：

```python
def test_parse_cad_default_output_does_not_overwrite_model_geometry(tmp_path: Path, monkeypatch):
    """默认输出必须避开人工维护的 model-geometry.yaml。"""
    from parse_cad import OUTPUT_YAML

    # 模拟存在 model-geometry.yaml
    model = tmp_path / "config" / "layout" / "model-geometry.yaml"
    model.parent.mkdir(parents=True)
    model.write_text("version: '1.0'\n", encoding="utf-8")

    assert OUTPUT_YAML.name != "model-geometry.yaml" or OUTPUT_YAML != Path("config/layout/model-geometry.yaml")
```

> 注：此测试通过断言 `OUTPUT_YAML` 路径，确保实现后默认输出已改变。

- [ ] **Step 2: 运行测试确认失败**

```bash
python -m pytest scripts/parse_cad_test.py::test_parse_cad_default_output_does_not_overwrite_model_geometry -q
```

预期：FAIL，因为 `OUTPUT_YAML` 当前仍是 `config/layout/cad-extracted.yaml`（即使已重命名，值未改）。

- [ ] **Step 3: 提交测试**

```bash
git add scripts/parse_cad_test.py
git commit -m "test: add failing test for parse_cad default output path"
```

---

### Task 4: 修改 `parse_cad.py` 默认输出行为

**Files:**
- Modify: `scripts/parse_cad.py:28`
- Modify: `scripts/parse_cad.py:main()`（添加 `--force` 逻辑）
- Modify: `scripts/parse_cad_test.py`（Step 1 的测试可能随实现微调）

**Interfaces:**
- Consumes: Task 3 的测试结果
- Produces: `parse_cad.py` 默认输出到 `model-geometry-from-cad.yaml`；需要 `--force` 才覆盖 `model-geometry.yaml`

- [ ] **Step 1: 修改 `OUTPUT_YAML` 默认值为临时导出路径**

```python
OUTPUT_YAML = Path("model-geometry-from-cad.yaml")
```

- [ ] **Step 2: 在 `main()` 添加 `--force` 保护**

```python
parser.add_argument(
    "--force",
    action="store_true",
    help="允许覆盖已存在的 model-geometry.yaml",
)
```

在写文件前判断：

```python
if args.output == Path("config/layout/model-geometry.yaml") and args.output.exists() and not args.force:
    print("[parse_cad] model-geometry.yaml already exists. Use --force to overwrite.")
    sys.exit(1)
```

- [ ] **Step 3: 运行测试**

```bash
python -m pytest scripts/parse_cad_test.py -q
```

预期：Task 3 测试通过；其他测试通过。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat: parse_cad defaults to temp export, requires --force to overwrite model-geometry"
```

---

### Task 5: 新增失败测试——模型文件坐标与效果图一致

**Files:**
- Create: `tests/server/model-geometry-layout.test.ts`
- Modify: 无

**Interfaces:**
- Consumes: `ProjectCatalog.load()` and `config/layout/model-geometry.yaml`
- Produces: 断言关键房间尺寸/位置与效果图一致

- [ ] **Step 1: 写失败测试**

```typescript
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ProjectCatalog } from '../../server/project-catalog.js';

describe('model-geometry layout matches floor plan', () => {
  it('has expected rooms with approximate floor-plan dimensions', () => {
    const catalog = ProjectCatalog.load('.');
    const rooms = catalog.getRooms();
    const byId = new Map(rooms.map(r => [r.id, r]));

    assert(byId.has('master_bedroom'));
    const master = byId.get('master_bedroom')!;
    assert(master.width >= 4.0 && master.width <= 4.4, 'master width ~4.2m');
    assert(master.depth >= 4.0 && master.depth <= 4.6, 'master depth ~4.3m');

    assert(byId.has('living_dining'));
    const living = byId.get('living_dining')!;
    assert(living.width >= 5.8 && living.width <= 6.6, 'living width ~6.2m');

    assert(byId.has('entry_garden'));
    const entry = byId.get('entry_garden')!;
    assert(entry.width >= 4.0 && entry.width <= 4.8, 'entry garden width ~4.45m');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test:server -- tests/server/model-geometry-layout.test.ts --run
```

预期：FAIL，因为当前 `model-geometry.yaml` 还是从 CAD 复制的 14.4m 宽版本，房间尺寸不符。

- [ ] **Step 3: 提交测试**

```bash
git add tests/server/model-geometry-layout.test.ts
git commit -m "test: add failing layout validation against floor plan"
```

---

### Task 6: 根据效果图重写 `model-geometry.yaml` 房间与外墙

**Files:**
- Modify: `config/layout/model-geometry.yaml`（全文替换）

**Interfaces:**
- Consumes: 效果图尺寸；Task 5 的测试结果
- Produces: 新的 `model-geometry.yaml`，房间尺寸与效果图一致

- [ ] **Step 1: 替换 `model-geometry.yaml` 内容**

坐标约定：x 向东，z 向南；SW 外墙角置于 (-8.2, 5.2)。效果图左下为 master_bedroom，右上为 entry_garden。

```yaml
version: '1.0'
source: '人工维护：参考效果图尺寸与 cad/design/01_floor_plan/floor_plan_design_2026-07-05.dxf'
unit: m
scale: 0.001
origin:
  x: 31.64204
  z: -12.48434
export_date: '2026-07-14'
rooms:
  - id: master_bedroom
    name: 主卧
    x: -6.1
    z: 3.05
    width: 4.2
    depth: 4.3
    height: 3.0
    area: 18.06
    perimeter: 17.0
  - id: bedroom_nw
    name: 西北次卧
    x: -6.7
    z: -1.225
    width: 3.0
    depth: 4.25
    height: 3.0
    area: 12.75
    perimeter: 14.5
  - id: study
    name: 书房
    x: -6.9
    z: -3.975
    width: 2.6
    depth: 1.25
    height: 3.0
    area: 3.25
    perimeter: 7.7
  - id: master_bath
    name: 主卫
    x: -2.5
    z: 4.2
    width: 3.0
    depth: 2.0
    height: 3.0
    area: 6.0
    perimeter: 10.0
  - id: guest_bath
    name: 客卫
    x: 0.5
    z: -1.25
    width: 3.0
    depth: 2.0
    height: 3.0
    area: 6.0
    perimeter: 10.0
  - id: living_dining
    name: 客餐厅
    x: 2.1
    z: 1.9
    width: 6.2
    depth: 4.4
    height: 3.0
    area: 27.28
    perimeter: 21.2
  - id: kitchen
    name: 厨房
    x: 3.8
    z: -1.25
    width: 3.6
    depth: 2.0
    height: 3.0
    area: 7.2
    perimeter: 11.2
  - id: bedroom_se
    name: 东南次卧
    x: 6.7
    z: 4.65
    width: 3.0
    depth: 1.1
    height: 3.0
    area: 3.3
    perimeter: 8.2
  - id: entry_garden
    name: 入户花园
    x: 8.325
    z: -3.65
    width: 4.45
    depth: 2.9
    height: 3.0
    area: 12.9
    perimeter: 14.7
walls:
  # 西外墙
  - { x1: -8.2, z1: 5.2, x2: -8.2, z2: -5.2 }
  # 北外墙（公寓主体）
  - { x1: -8.2, z1: -5.2, x2: 5.6, z2: -5.2 }
  # 入户花园外框
  - { x1: 5.6, z1: -5.2, x2: 5.6, z2: -2.3 }
  - { x1: 5.6, z1: -2.3, x2: 10.05, z2: -2.3 }
  - { x1: 10.05, z1: -2.3, x2: 10.05, z2: -5.2 }
  - { x1: 10.05, z1: -5.2, x2: 5.6, z2: -5.2 }
  # 东外墙：SE -> 卧室南 -> 起居东
  - { x1: 8.2, z1: 5.2, x2: 8.2, z2: 4.1 }
  - { x1: 8.2, z1: 4.1, x2: 5.2, z2: 4.1 }
  - { x1: 5.2, z1: 4.1, x2: 5.2, z2: -2.3 }
  # 南外墙
  - { x1: -8.2, z1: 5.2, x2: 8.2, z2: 5.2 }
  # 内墙：主卧-主卫
  - { x1: -4.0, z1: 5.2, x2: -4.0, z2: 3.2 }
  - { x1: -4.0, z1: 3.2, x2: -1.0, z2: 3.2 }
  # 内墙：主卫-客餐厅
  - { x1: -1.0, z1: 5.2, x2: -1.0, z2: -2.3 }
  # 内墙：主卧/次卧-客餐厅
  - { x1: -4.0, z1: 3.2, x2: -4.0, z2: -5.2 }
  # 内墙：卧室与起居分隔
  - { x1: -1.0, z1: 4.1, x2: 5.2, z2: 4.1 }
  # 内墙：厨房-客卫
  - { x1: 2.0, z1: -0.3, x2: 2.0, z2: -2.3 }
  - { x1: -1.0, z1: -0.3, x2: 2.0, z2: -0.3 }
  # 内墙：厨房-客餐厅
  - { x1: 2.0, z1: -0.3, x2: 5.6, z2: -0.3 }
  # 内墙：东南次卧-起居
  - { x1: 5.2, z1: 4.1, x2: 5.2, z2: 5.2 }
platform:
  id: west_platform
  name: 西设备平台
  x: -8.2
  z: 0.0
  width: 1.0
  depth: 9.8
  height: 0.15
  area: 9.8
```

> 注：这是基于效果图尺寸的初版；Task 10 的浏览器验收会微调。

- [ ] **Step 2: 运行布局测试**

```bash
npm run test:server -- tests/server/model-geometry-layout.test.ts --run
```

预期：PASS（尺寸落在允许区间内）。

- [ ] **Step 3: 提交**

```bash
git add config/layout/model-geometry.yaml
git commit -m "feat: initial model-geometry.yaml based on floor plan rendering"
```

---

### Task 7: 更新 `overlay.yaml` 以匹配新模型

**Files:**
- Modify: `config/layout/overlay.yaml`（全文替换）

**Interfaces:**
- Consumes: 新的 `model-geometry.yaml` 外墙轮廓；保留玻璃幕墙/飘窗意图
- Produces: 更新后的 `overlay.yaml`，suppress 区域覆盖新外墙，curtain_run/bay_sill 与新墙对齐

- [ ] **Step 1: 替换 `overlay.yaml` 内容**

```yaml
version: 1

suppress:
  - id: suppress_south_wall
    region: { x1: -8.5, z1: 5.5, x2: 8.5, z2: 4.8 }
    reason: "南外墙改玻璃幕墙"
  - id: suppress_west_wall
    region: { x1: -8.5, z1: 5.5, x2: -7.8, z2: -5.5 }
    reason: "西外墙改玻璃幕墙"
  - id: suppress_north_wall
    region: { x1: -8.5, z1: -4.8, x2: 5.6, z2: -5.5 }
    reason: "北外墙改玻璃幕墙（入户花园以西）"

elements:
  - id: glass_facade
    type: curtain_run
    points:
      - { x: 8.2, z: 5.2 }
      - { x: -8.2, z: 5.2 }
      - { x: -8.2, z: -5.2 }
      - { x: 5.6, z: -5.2 }
    height: 3.0

  - id: living_south_glass
    type: glass_infill
    room: living_dining
    wall: south
    center_offset: 0
    width: 3.5
    height: 1.6
    sill: 0.9

  - id: corridor_floor
    type: floor_region
    points:
      - { x: -1.0, z: 3.2 }
      - { x: 3.45, z: 3.2 }
      - { x: 3.45, z: 4.1 }
      - { x: -1.0, z: 4.1 }
    reason: "客餐厅与走廊过渡区"

  - id: master_left_bay
    type: bay_sill
    points:
      - { x: -8.2, z: 0.9 }
      - { x: -8.2, z: 5.2 }
    depth: 0.6
    sill: 0.45
    height: 2.55
    reason: "主卧西墙上飘窗"

  - id: bedroom_nw_bay
    type: bay_sill
    points:
      - { x: -8.2, z: -3.35 }
      - { x: -8.2, z: 0.9 }
    depth: 0.6
    sill: 0.45
    height: 2.55
    reason: "西北次卧西墙上飘窗"

  - id: master_top_bay
    type: bay_sill
    points:
      - { x: -8.2, z: -5.2 }
      - { x: -4.0, z: -5.2 }
    depth: 0.6
    sill: 0.45
    height: 2.55
    reason: "主卧北墙上飘窗"
```

- [ ] **Step 2: 运行 overlay 测试**

```bash
npm run test:server -- --run
```

预期：overlay schema 解析通过；所有测试通过。

- [ ] **Step 3: 提交**

```bash
git add config/layout/overlay.yaml
git commit -m "feat: align overlay with new model-geometry layout"
```

---

### Task 8: 更新 `AGENTS.md` 与旧 spec 批注

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-07-09-cad-driven-3d-layout-design.md`（末尾加批注）

**Interfaces:**
- Consumes: 新架构决策
- Produces: 文档与代码约定一致

- [ ] **Step 1: 修改 `AGENTS.md` 铁律**

将相关段落改为：

```markdown
## CAD / 3D 渲染架构

> `config/layout/model-geometry.yaml` 是户型几何的唯一权威源；`config/layout/overlay.yaml` 出一切意图。代码只读、只执行，禁止推断。
>
> `parse_cad.py` 仅用于从 CAD 初始化或参考导出，默认不覆盖 `model-geometry.yaml`。需要新行为 → 新增 element type + 声明式配置。
```

- [ ] **Step 2: 在旧 cad-driven spec 末尾加批注**

```markdown

> **Note (2026-07-14):** 本文件描述的“CAD 单源”架构已被
> `2026-07-14-model-geometry-authoritative-design.md` 反转。
> `config/layout/model-geometry.yaml` 现为人工维护的权威户型几何源。
```

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md docs/superpowers/specs/2026-07-09-cad-driven-3d-layout-design.md
git commit -m "docs: update AGENTS.md and old spec for model-geometry authority"
```

---

### Task 9: 全量回归测试

**Files:**
- 无（仅运行命令）

- [ ] **Step 1: 运行后端测试**

```bash
npm run test:server -- --run
```

预期：全部通过。

- [ ] **Step 2: 运行 Python 测试**

```bash
python -m pytest scripts/parse_cad_test.py -q
```

预期：全部通过。

- [ ] **Step 3: 类型检查**

```bash
npm run typecheck
```

预期：无类型错误。

- [ ] **Step 4: 提交（如有修复）**

```bash
git commit -am "fix: resolve regressions from model-geometry rename"
```

---

### Task 10: 浏览器正交俯视验收与坐标微调

**Files:**
- Modify: `config/layout/model-geometry.yaml`（根据截图微调）
- Modify: `config/layout/overlay.yaml`（根据截图微调）

**Interfaces:**
- Consumes: 运行中的 dev server + Chrome CDP 脚本
- Produces: 与效果图轮廓一致的最终布局截图

- [ ] **Step 1: 启动 dev server 和 app**

```bash
npm run dev:server &
npm run dev:app &
```

- [ ] **Step 2: 连接 Chrome 并截取正交俯视**

使用已验证的 CDP 脚本（如 `/tmp/bontop-ortho-topdown3.ps1`）或等效脚本，设置相机为正交俯视，截取 PNG。

- [ ] **Step 3: 与效果图对比**

检查：
- 外墙轮廓是否为 16.4m × 10.4m 的大致矩形，左上/左下圆角。
- master_bedroom 是否在左下。
- 客餐厅是否在中央。
- 入户花园是否在右上。
- 东南次卧是否在右下。
- 玻璃幕墙是否沿南/西/北外墙。
- 飘窗是否在西墙和北墙。

- [ ] **Step 4: 逐项微调**

根据对比结果，修改 `model-geometry.yaml` 的 room/wall 坐标或 `overlay.yaml` 的 suppress/curtain_run/bay_sill，重复截图直到吻合。

- [ ] **Step 5: 提交最终截图**

```bash
cp /tmp/ortho-final.png screenshots/2026-07-14-3d-model-geometry-final.png
git add screenshots/2026-07-14-3d-model-geometry-final.png config/layout/model-geometry.yaml config/layout/overlay.yaml
git commit -m "chore: final layout acceptance screenshot"
```

---

## Plan Self-Review

**Spec coverage:**
- 权威源反转：Task 2、Task 8。
- 文件重命名：Task 2。
- Parser 不覆盖：Task 3、Task 4。
- 模型文件 schema/纯几何：Task 5、Task 6。
- Overlay 意图层：Task 7。
- 文档更新：Task 8。
- 验收测试：Task 5、Task 10。

**Placeholder scan:** 无 TBD/TODO；模型文件给出了初版坐标，验收步骤负责迭代修正。

**Type consistency:** 所有 `model-geometry` 路径与 `cad-extracted` 全部替换，无混用。

**Risk:** 效果图与 CAD 标注本身存在差异，房间边界需依赖验收迭代；计划已预留 Task 10 应对此风险。

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-07-14-model-geometry-authoritative-plan.md`.

**两个执行选项：**

1. **Subagent-Driven（推荐）**：每个 Task 派发独立子代理，逐任务审查。
2. **Inline Execution**：在当前会话内按 Task 顺序执行，可在 Task 10 截图后检查。

**你选哪个？**
