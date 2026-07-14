# DXF 底稿 + Overlay 配置驱动渲染 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 CAD 提取坐标系塌陷，删除全部意图猜测器，建立 overlay.yaml 声明式场景覆盖层，使 3D 渲染完全由 DXF 几何 + config 声明驱动。

**Architecture:** 五层管线：cad-anchor.yaml（DXF→场景坐标显式锚点）→ parse_cad.py（纯几何提取）→ overlay.yaml（人工声明幕墙/玻璃/补墙）→ server overlay-merge（zod 校验 + 机械合并）→ HouseScene（按 type 分发渲染）。

**Tech Stack:** Python 3 + pytest（提取）、TypeScript + zod 4 + node:test（server）、Three.js + vitest（app）。

**Spec:** `docs/superpowers/specs/2026-07-14-dxf-overlay-rendering-design.md`

## Global Constraints

- 铁律：CAD 只出几何，overlay.yaml 出一切意图。代码只读、只执行，禁止推断。禁止任何基于几何位置/邻接关系的自动分类。
- 校验失败必须 fail loud（报错/进配置错误通道），禁止静默跳过、禁止"智能降级"。
- zod schema 全部 `.strict()`；判别字段统一叫 `type`。
- 坐标换算公式（唯一）：`x_scene = (x_dxf - origin.x) / 1000`；`z_scene = (origin.y - y_dxf) / 1000`。
- 测试命令：Python `python3 -m pytest scripts/parse_cad_test.py -q`；server `npm run test:server`；app `cd app && npx vitest run`；类型 `npm run typecheck`。
- 每个 Task 结束必须全绿再 commit。

---

### Task 1: cad-anchor.yaml 与 load_cad_anchor()

**Files:**
- Create: `config/layout/cad-anchor.yaml`
- Modify: `scripts/parse_cad.py`（新增 dataclass + 加载函数，暂不接线）
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Produces: `CadAnchor` dataclass（`origin_x: float, origin_y: float, frame: tuple[float,float,float,float]`，全部 DXF 毫米）；`load_cad_anchor(path: Path) -> CadAnchor`（缺文件 raise FileNotFoundError，缺字段 raise ValueError）；模块常量 `CAD_ANCHOR_CONFIG = Path("config/layout/cad-anchor.yaml")`。

- [ ] **Step 1: 创建 cad-anchor.yaml**

```yaml
# DXF → 场景坐标系锚点声明。
# 铁律：坐标换算不做任何推断，只用本文件声明的值。
# 本文件缺失或字段不全时，parse_cad.py 必须报错退出，禁止静默输出未平移的几何。
version: 1

# 场景原点在 DXF 图纸上的位置（DXF 毫米坐标）。
# 来源：2026-07-13 正确提取版本（git fe31b2d）的标签质心，
# 经门位坐标交叉验证（DXF x≈35783mm → 场景 4.14m）。
dxf_origin:
  x: 31642.04
  y: -12484.34

# 有效图框（DXF 毫米坐标）：只提取中点在该矩形内的墙线。
# 用于排除同一 modelspace 里的重复图纸副本（墙体定位图 等）。
dxf_frame:
  min_x: 25500
  min_y: -18200
  max_x: 40500
  max_y: -7900
```

- [ ] **Step 2: 写失败测试**（追加到 `scripts/parse_cad_test.py`）

```python
def test_load_cad_anchor_valid(tmp_path: Path):
    from parse_cad import load_cad_anchor
    p = tmp_path / "cad-anchor.yaml"
    p.write_text(
        "version: 1\n"
        "dxf_origin: {x: 31642.04, y: -12484.34}\n"
        "dxf_frame: {min_x: 25500, min_y: -18200, max_x: 40500, max_y: -7900}\n",
        encoding="utf-8",
    )
    anchor = load_cad_anchor(p)
    assert anchor.origin_x == 31642.04
    assert anchor.origin_y == -12484.34
    assert anchor.frame == (25500.0, -18200.0, 40500.0, -7900.0)


def test_load_cad_anchor_missing_file_fails_loud(tmp_path: Path):
    from parse_cad import load_cad_anchor
    with pytest.raises(FileNotFoundError, match="cad-anchor"):
        load_cad_anchor(tmp_path / "nope.yaml")


def test_load_cad_anchor_missing_field_fails_loud(tmp_path: Path):
    from parse_cad import load_cad_anchor
    p = tmp_path / "cad-anchor.yaml"
    p.write_text("version: 1\ndxf_origin: {x: 1.0, y: 2.0}\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_cad_anchor(p)
```

- [ ] **Step 3: 跑测试确认失败**

Run: `python3 -m pytest scripts/parse_cad_test.py -q -k cad_anchor`
Expected: 3 FAIL（ImportError: cannot import name 'load_cad_anchor'）

- [ ] **Step 4: 实现**（`scripts/parse_cad.py`，加在 `Wall` dataclass 之后）

```python
CAD_ANCHOR_CONFIG = Path("config/layout/cad-anchor.yaml")


@dataclass
class CadAnchor:
    """DXF→场景坐标系锚点。全部字段为 DXF 毫米，值只来自 cad-anchor.yaml 声明。"""
    origin_x: float
    origin_y: float
    frame: tuple[float, float, float, float]  # (min_x, min_y, max_x, max_y)


def load_cad_anchor(path: Path) -> CadAnchor:
    """Load the declared DXF anchor. Fail loud —— 绝不静默退化为 (0,0)/None。"""
    if not path.exists():
        raise FileNotFoundError(
            f"cad-anchor config not found: {path}. "
            "Walls cannot be extracted without an explicit dxf_origin/dxf_frame. "
            "Declare them in config/layout/cad-anchor.yaml."
        )
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"Invalid cad-anchor config {path}: expected a mapping")
    try:
        origin = data["dxf_origin"]
        frame = data["dxf_frame"]
        return CadAnchor(
            origin_x=float(origin["x"]),
            origin_y=float(origin["y"]),
            frame=(
                float(frame["min_x"]), float(frame["min_y"]),
                float(frame["max_x"]), float(frame["max_y"]),
            ),
        )
    except (KeyError, TypeError) as exc:
        raise ValueError(f"cad-anchor config {path} missing required key: {exc}") from exc
```

- [ ] **Step 5: 跑测试确认通过**

Run: `python3 -m pytest scripts/parse_cad_test.py -q`
Expected: 全部 PASS（39 旧 + 3 新）

- [ ] **Step 6: Commit**

```bash
git add config/layout/cad-anchor.yaml scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "feat: add cad-anchor.yaml declaring DXF origin and frame, fail-loud loader"
```

---

### Task 2: 提取管线改用锚点，删除隐式 origin/bounds 与 entry_garden 硬编码

**Files:**
- Modify: `scripts/parse_cad.py`（`extract_walls` L211-249、`extract` L893-927、`extract_room_geometry` 内部 bounds、`compute_origin` L168-175、`label_cluster_bounds` L156-165、`main`）
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Consumes: Task 1 的 `CadAnchor` / `load_cad_anchor` / `CAD_ANCHOR_CONFIG`。
- Produces: `extract_walls(modelspace, anchor: CadAnchor) -> list[Wall]`；`extract(dxf_path, default_height=3.0, anchor_path: Path | None = None)` 返回签名不变（origin 元组返回锚点值）；`extract_room_geometry(..., bounds: tuple | None)` 新增显式 bounds 参数。`compute_origin` 与 `label_cluster_bounds` 被删除。

- [ ] **Step 1: 写失败测试**

```python
def _write_anchor(tmp_path: Path, ox: float, oy: float,
                  frame: tuple[float, float, float, float]) -> Path:
    p = tmp_path / "cad-anchor.yaml"
    p.write_text(
        f"version: 1\n"
        f"dxf_origin: {{x: {ox}, y: {oy}}}\n"
        f"dxf_frame: {{min_x: {frame[0]}, min_y: {frame[1]}, "
        f"max_x: {frame[2]}, max_y: {frame[3]}}}\n",
        encoding="utf-8",
    )
    return p


def test_extract_walls_uses_anchor_origin():
    """墙体坐标 = (DXF - 锚点原点) / 1000，y 轴翻转。"""
    from parse_cad import CadAnchor, extract_walls

    class FakeLine:
        def __init__(self, s, e):
            self.dxf = type("D", (), {})()
            self.dxf.layer = "BS-非承重墙"
            self.dxf.start = type("P", (), {"x": s[0], "y": s[1]})()
            self.dxf.end = type("P", (), {"x": e[0], "y": e[1]})()
        def dxftype(self):
            return "LINE"

    anchor = CadAnchor(origin_x=30000.0, origin_y=-10000.0,
                       frame=(25000.0, -20000.0, 40000.0, -5000.0))
    msp = [FakeLine((31000.0, -12000.0), (33000.0, -12000.0))]
    walls = extract_walls(msp, anchor)
    assert len(walls) == 1
    assert (walls[0].x1, walls[0].z1) == (1.0, 2.0)
    assert (walls[0].x2, walls[0].z2) == (3.0, 2.0)


def test_extract_walls_frame_filters_duplicate_copy():
    """图框外的重复图纸副本墙线被排除。"""
    from parse_cad import CadAnchor, extract_walls

    class FakeLine:
        def __init__(self, s, e):
            self.dxf = type("D", (), {})()
            self.dxf.layer = "BS-非承重墙"
            self.dxf.start = type("P", (), {"x": s[0], "y": s[1]})()
            self.dxf.end = type("P", (), {"x": e[0], "y": e[1]})()
        def dxftype(self):
            return "LINE"

    anchor = CadAnchor(origin_x=30000.0, origin_y=-10000.0,
                       frame=(25000.0, -20000.0, 40000.0, -5000.0))
    inside = FakeLine((31000.0, -12000.0), (33000.0, -12000.0))
    duplicate_copy = FakeLine((5000.0, -12000.0), (7000.0, -12000.0))  # 图框外副本
    walls = extract_walls([inside, duplicate_copy], anchor)
    assert len(walls) == 1


def test_extract_has_no_hardcoded_entry_garden():
    """extract() 源码不得硬编码任何房间几何。"""
    src = Path("scripts/parse_cad.py").read_text(encoding="utf-8")
    assert 'id="entry_garden"' not in src
    assert "compute_origin" not in src
    assert "label_cluster_bounds" not in src
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest scripts/parse_cad_test.py -q -k "anchor_origin or duplicate_copy or hardcoded"`
Expected: FAIL（extract_walls 签名不符 / 源码含硬编码）

- [ ] **Step 3: 实现**

`extract_walls` 改为（同时删除其 docstring 里 curtain 相关句子；`_smooth_diagonals` 调用暂保留原样、Task 3 处理）：

```python
def extract_walls(modelspace, anchor: CadAnchor) -> list[Wall]:
    """Return wall segments in meters, anchor-origin-subtracted, frame-filtered.

    The DXF draws each physical wall exactly once (shared walls are single
    segments, openings are gaps), so exporting the segments verbatim gives the
    renderer a continuous, non-duplicated wall graph.
    """
    segments = collect_wall_segments(modelspace, bounds=anchor.frame)
    walls: list[Wall] = []
    for (x1, y1), (x2, y2) in segments:
        walls.append(
            Wall(
                x1=round((x1 - anchor.origin_x) / 1000.0, 3),
                z1=round((anchor.origin_y - y1) / 1000.0, 3),
                x2=round((x2 - anchor.origin_x) / 1000.0, 3),
                z2=round((anchor.origin_y - y2) / 1000.0, 3),
            )
        )
    return walls
```

`extract()` 改为：

```python
def extract(dxf_path, default_height: float = 3.0, anchor_path: Path | None = None):
    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()
    anchor = load_cad_anchor(anchor_path or CAD_ANCHOR_CONFIG)
    labels, skipped = extract_room_labels(msp)
    areas = parse_label_areas(msp, labels)
    rooms = extract_room_geometry(
        labels, msp, origin_x=anchor.origin_x, origin_z=anchor.origin_y,
        default_height=default_height, areas=areas, bounds=anchor.frame,
    )
    walls = extract_walls(msp, anchor)
    return rooms, walls, [], skipped, (anchor.origin_x, anchor.origin_y)
```

其余修改：

1. 删除 `compute_origin`（L168-175）与 `label_cluster_bounds`（L156-165）。
2. `extract_room_geometry` 增加 `bounds: tuple[float, float, float, float] | None = None` 参数，内部所有 `label_cluster_bounds(labels)` 调用点改用传入的 `bounds`。
3. 删除 `extract()` 里 entry_garden 硬编码追加块（`rooms.append(Room(id="entry_garden", ...))`）——merge 机制会保留已提交文件里的该房间。
4. `main()` 增加 `parser.add_argument("--anchor", type=Path, default=CAD_ANCHOR_CONFIG)` 并传入 `extract(..., anchor_path=args.anchor)`。
5. 修正既有测试：`test_extract_walls_returns_origin_subtracted_meters`、`test_write_layout_yaml_includes_walls_and_origin`、`test_cad_geometry_is_authoritative`、`test_extract_room_geometry*` 等涉及 `extract_walls`/`extract` 签名的用例，改为构造 `CadAnchor` 或传 `_write_anchor(tmp_path, ...)`。凡此前依赖"labels 为空→origin(0,0)"行为的断言按新语义更新。

- [ ] **Step 4: 跑全量 Python 测试确认通过**

Run: `python3 -m pytest scripts/parse_cad_test.py -q`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "fix: walls extraction uses declared cad-anchor, delete implicit origin/bounds and entry_garden hardcode"
```

---

### Task 3: 删除幕墙猜测器与弧化合成，加字段白名单守卫

**Files:**
- Modify: `scripts/parse_cad.py`、`config/house.yaml`（暂不删 curtain 段，Task 7 删）
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Produces: `Wall` 仅含 `x1/z1/x2/z2` 四字段；`parse_cad.py` 源码中不再出现字符串 `curtain`（任何形式）；`_smooth_diagonals` 整个删除。

- [ ] **Step 1: 写失败守卫测试**

```python
def test_wall_dataclass_is_pure_geometry():
    """Wall 只允许纯几何字段——出现意图字段（如 curtain）即失败。"""
    from dataclasses import fields
    from parse_cad import Wall
    assert {f.name for f in fields(Wall)} == {"x1", "z1", "x2", "z2"}


def test_walls_yaml_output_contains_only_geometry_fields(tmp_path: Path):
    from parse_cad import Room, Wall, write_layout_yaml
    rooms = [Room(id="r1", name="房", x=0, z=0, width=1, depth=1, height=3, area=1.0)]
    walls = [Wall(x1=0, z1=0, x2=1, z2=0)]
    out = tmp_path / "layout.yaml"
    write_layout_yaml(rooms, walls, None, out, source="test.dxf",
                      origin=(0.0, 0.0))
    data = yaml.safe_load(out.read_text(encoding="utf-8"))
    for w in data["walls"]:
        assert set(w.keys()) == {"x1", "z1", "x2", "z2"}, f"意图字段泄漏: {w}"


def test_no_intent_guessing_code_in_parse_cad():
    """铁律守卫：parse_cad.py 不得包含任何幕墙分类/最外侧判定/弧化合成代码。"""
    src = Path("scripts/parse_cad.py").read_text(encoding="utf-8")
    for banned in ["curtain", "_is_outermost", "_smooth_diagonals", "bulge"]:
        assert banned not in src, f"禁止的意图猜测标识重新出现: {banned}"
```

注意：`write_layout_yaml` 实际签名以现有代码为准（含 `Room.perimeter` 等必填项时补齐）；测试编写者先读该函数签名再落笔。

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest scripts/parse_cad_test.py -q -k "pure_geometry or only_geometry or intent_guessing"`
Expected: FAIL

- [ ] **Step 3: 删除实现**

1. 删除函数：`_mark_curtain_from_config`、`_is_outermost`（内嵌）、`_load_curtain_config`、`load_curtain_corners`、`_smooth_diagonals`。
2. `Wall` 删除 `curtain: bool = False` 字段。
3. `extract_walls` 删除 `_smooth_diagonals` 调用（segments 直接使用）。
4. `write_layout_yaml` 的 walls 输出行改为：

```python
data["walls"] = [
    {"x1": w.x1, "z1": w.z1, "x2": w.x2, "z2": w.z2} for w in walls
]
```

5. 删除 `HOUSE_CONFIG` 在 walls 提取路径上的一切使用（`load_house_room_ids` 用于房间校验的保留）。
6. 删除既有测试：`test_mark_curtain_walls_from_config`、`test_extract_walls_loads_curtain_corners_from_config`、`test_smooth_diagonals_without_corners_keeps_original_behavior`、`test_smooth_diagonals_with_corners_filters_by_distance`（及其它引用被删函数的用例）。
7. 在 `parse_cad.py` 模块 docstring 顶部加入铁律注释：

```python
"""Extract house layout geometry from CAD DXF.

架构铁律（docs/superpowers/specs/2026-07-14-dxf-overlay-rendering-design.md）：
  CAD 只出几何，config 出一切意图。本模块只读图纸、只做坐标换算，禁止推断。
  - 坐标系换算只用 config/layout/cad-anchor.yaml 的显式声明（fail loud）。
  - 输出的 Wall 只有 x1/z1/x2/z2 纯几何字段，禁止追加任何分类/意图字段。
  - 幕墙、玻璃、补墙等一切"这是什么"的知识属于 config/layout/overlay.yaml。
  - 要新行为 → 加声明式配置；禁止添加基于几何位置/邻接的自动分类启发式。
"""
```

- [ ] **Step 4: 跑全量测试确认通过**

Run: `python3 -m pytest scripts/parse_cad_test.py -q`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "refactor: delete curtain guessers and diagonal smoothing, Wall is pure geometry with whitelist guard"
```

---

### Task 4: 重新生成 cad-extracted.yaml 并加坐标系一致性守卫

**Files:**
- Modify: `config/layout/cad-extracted.yaml`（重新生成）
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Produces: 正确坐标系的 `config/layout/cad-extracted.yaml`（walls 与 rooms 同框，无 curtain 字段，无副本）。后续 Task 以此文件为几何基准。

- [ ] **Step 1: 写失败守卫测试（对提交的文件做一致性断言）**

```python
def test_committed_layout_walls_share_frame_with_rooms():
    """守卫：cad-extracted.yaml 的 walls 与 rooms 必须在同一坐标系。

    2026-07-14 曾发生 origin 静默塌陷导致 walls 跑到 30 米外。
    """
    data = yaml.safe_load(
        Path("config/layout/cad-extracted.yaml").read_text(encoding="utf-8")
    )
    rooms, walls = data["rooms"], data.get("walls", [])
    assert walls, "cad-extracted.yaml 应包含墙体"
    wx = [w[k] for w in walls for k in ("x1", "x2")]
    wz = [w[k] for w in walls for k in ("z1", "z2")]
    rx = [v for r in rooms for v in (r["x"] - r["width"] / 2, r["x"] + r["width"] / 2)]
    rz = [v for r in rooms for v in (r["z"] - r["depth"] / 2, r["z"] + r["depth"] / 2)]
    # 墙体包围盒必须覆盖房间包围盒（允许 1m 出入）
    assert min(wx) <= min(rx) + 1.0 and max(wx) >= max(rx) - 1.0
    assert min(wz) <= min(rz) + 1.0 and max(wz) >= max(rz) - 1.0
    # 户型宽不超过 20m —— 双副本会把范围撑到 37m
    assert max(wx) - min(wx) < 20.0
    assert max(wz) - min(wz) < 20.0
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest scripts/parse_cad_test.py -q -k share_frame`
Expected: FAIL（当前文件 walls 在错误坐标系）

- [ ] **Step 3: 重新生成**

Run: `python3 scripts/parse_cad.py`
Expected: 正常退出；`scripts/logs/cad-extraction-report.json` 中 `geometry_changes` 只涉及 walls。
检查：`git diff config/layout/cad-extracted.yaml` —— rooms 应保持不变（merge 保留），walls 全部落在 x -6~11 / z -5~9 附近，无 `curtain:` 字段。

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest scripts/parse_cad_test.py -q`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add config/layout/cad-extracted.yaml scripts/parse_cad_test.py scripts/logs/cad-extraction-report.json
git commit -m "fix: regenerate cad-extracted.yaml in correct coordinate frame, add frame-consistency guard"
```

---

### Task 5: SceneElement 类型 + overlay zod schema + overlay-merge

**Files:**
- Modify: `shared/types.ts`（L334-340 `WallSegment` 一带）
- Create: `server/overlay-merge.ts`
- Test: `tests/server/overlay-merge.test.ts`

**Interfaces:**
- Consumes: `shared/types.ts` 的 `WallSegment`（本 Task 删其 `curtain` 字段）。
- Produces:
  - `shared/types.ts`：`OverlayPoint {x,z}`、`SceneElement` 判别联合（见下）、`WallSegment`（纯几何）。
  - `server/overlay-merge.ts`：`parseOverlay(raw: string): OverlayConfig`（zod 校验，失败 throw，错误信息带路径）；`mergeSceneElements(walls: WallSegment[], overlay: OverlayConfig | undefined): SceneElement[]`；`type OverlayConfig`。

- [ ] **Step 1: 更新 shared/types.ts**

```ts
export interface WallSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface OverlayPoint {
  x: number;
  z: number;
}

/** 合并后的场景元素。判别字段 type 与 overlay.yaml 一致。 */
export type SceneElement =
  | { type: 'wall'; id: string; x1: number; z1: number; x2: number; z2: number }
  | { type: 'curtain_run'; id: string; points: OverlayPoint[]; height: number }
  | { type: 'wall_run'; id: string; points: OverlayPoint[]; height: number }
  | {
      type: 'glass_infill';
      id: string;
      room: string;
      wall: 'north' | 'south' | 'east' | 'west';
      center_offset: number;
      width: number;
      height: number;
      sill: number;
    };
```

- [ ] **Step 2: 写失败测试**（`tests/server/overlay-merge.test.ts`，node:test 风格与 rule-engine.test.ts 一致）

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOverlay, mergeSceneElements } from '../../server/overlay-merge.js';
import type { WallSegment } from '../../shared/types.js';

const WALLS: WallSegment[] = [
  { x1: -5.88, z1: -3.0, x2: -5.88, z2: 5.0 }, // 最外侧西墙
  { x1: 0, z1: 0, x2: 3, z2: 0 },              // 内墙
];

describe('parseOverlay', () => {
  it('parses a valid overlay', () => {
    const cfg = parseOverlay(`
version: 1
suppress:
  - id: s1
    region: {x1: -6.2, z1: -3.5, x2: -5.6, z2: 5.0}
    reason: "幕墙位置残线"
elements:
  - id: west_curtain
    type: curtain_run
    points: [{x: -5.88, z: 4.87}, {x: -5.37, z: -3.36}]
    height: 3.0
`);
    assert.equal(cfg.suppress.length, 1);
    assert.equal(cfg.elements.length, 1);
  });

  it('rejects unknown element type — 禁止静默跳过', () => {
    assert.throws(
      () => parseOverlay(`
version: 1
elements:
  - id: x
    type: magic_auto_wall
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
`),
      /type/
    );
  });

  it('rejects unknown extra fields (strict)', () => {
    assert.throws(() =>
      parseOverlay(`
version: 1
elements:
  - id: x
    type: curtain_run
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
    auto_detect: true
`)
    );
  });

  it('rejects suppress without reason', () => {
    assert.throws(() =>
      parseOverlay(`
version: 1
suppress:
  - id: s1
    region: {x1: 0, z1: 0, x2: 1, z2: 1}
`)
    );
  });
});

describe('mergeSceneElements', () => {
  it('undefined overlay → 所有 DXF 段原样输出为 wall（空 overlay 直通）', () => {
    const out = mergeSceneElements(WALLS, undefined);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((e) => e.type), ['wall', 'wall']);
    assert.equal(out[0].id, 'wall:seg:0');
  });

  it('铁律守卫：最外侧边界墙不声明就永远是 wall，不存在按位置自动分类', () => {
    const out = mergeSceneElements(WALLS, parseOverlay('version: 1'));
    for (const el of out) assert.equal(el.type, 'wall');
  });

  it('suppress 移除中点在区域内的段，区域外不受影响', () => {
    const cfg = parseOverlay(`
version: 1
suppress:
  - id: s1
    region: {x1: -6.2, z1: -3.5, x2: -5.6, z2: 5.0}
    reason: "测试"
`);
    const out = mergeSceneElements(WALLS, cfg);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { type: 'wall', id: 'wall:seg:1', x1: 0, z1: 0, x2: 3, z2: 0 });
  });

  it('suppress region 坐标顺序无关（x1>x2 也成立）', () => {
    const cfg = parseOverlay(`
version: 1
suppress:
  - id: s1
    region: {x1: -5.6, z1: 5.0, x2: -6.2, z2: -3.5}
    reason: "测试"
`);
    assert.equal(mergeSceneElements(WALLS, cfg).length, 1);
  });

  it('elements 校验后追加到输出', () => {
    const cfg = parseOverlay(`
version: 1
elements:
  - id: west_curtain
    type: curtain_run
    points: [{x: -5.88, z: 4.87}, {x: -5.37, z: -3.36}]
  - id: living_glass
    type: glass_infill
    room: living_dining
    wall: south
    width: 3.5
    height: 1.6
`);
    const out = mergeSceneElements(WALLS, cfg);
    assert.equal(out.length, 4);
    const curtain = out.find((e) => e.id === 'west_curtain');
    assert.equal(curtain?.type, 'curtain_run');
    if (curtain?.type === 'curtain_run') assert.equal(curtain.height, 3.0); // 默认值
    const glass = out.find((e) => e.id === 'living_glass');
    if (glass?.type === 'glass_infill') {
      assert.equal(glass.sill, 0.9);          // 默认值
      assert.equal(glass.center_offset, 0);   // 默认值
    }
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx tsx --test tests/server/overlay-merge.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 server/overlay-merge.ts**

```ts
/**
 * overlay.yaml 合并层。
 *
 * 架构铁律（docs/superpowers/specs/2026-07-14-dxf-overlay-rendering-design.md）：
 *   CAD 只出几何，overlay.yaml 出一切意图。本模块只做两件机械操作：
 *   suppress（声明区域内的 DXF 段移除）与 add（声明元素追加）。
 *   禁止任何基于几何位置/邻接关系的自动分类——不声明的墙永远是 wall。
 *   要新元素 → 在 schema 加 type + 在渲染器加分支；禁止加启发式。
 *   校验失败必须 throw（进配置错误横幅），禁止静默跳过、禁止智能降级。
 */
import { z } from 'zod';
import { load } from 'js-yaml';
import type { SceneElement, WallSegment } from '../shared/types.js';

const PointSchema = z.object({ x: z.number(), z: z.number() }).strict();

const SuppressSchema = z
  .object({
    id: z.string().min(1),
    region: z
      .object({ x1: z.number(), z1: z.number(), x2: z.number(), z2: z.number() })
      .strict(),
    reason: z.string().min(1),
  })
  .strict();

const CurtainRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('curtain_run'),
    points: z.array(PointSchema).min(2),
    height: z.number().positive().default(3.0),
  })
  .strict();

const WallRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('wall_run'),
    points: z.array(PointSchema).min(2),
    height: z.number().positive().default(3.0),
  })
  .strict();

const GlassInfillSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('glass_infill'),
    room: z.string().min(1),
    wall: z.enum(['north', 'south', 'east', 'west']),
    center_offset: z.number().default(0),
    width: z.number().positive(),
    height: z.number().positive(),
    sill: z.number().min(0).default(0.9),
  })
  .strict();

const OverlaySchema = z
  .object({
    version: z.literal(1),
    suppress: z.array(SuppressSchema).default([]),
    elements: z
      .array(z.discriminatedUnion('type', [CurtainRunSchema, WallRunSchema, GlassInfillSchema]))
      .default([]),
  })
  .strict();

export type OverlayConfig = z.infer<typeof OverlaySchema>;

export function parseOverlay(raw: string): OverlayConfig {
  return OverlaySchema.parse(load(raw) ?? {});
}

export function mergeSceneElements(
  walls: WallSegment[],
  overlay: OverlayConfig | undefined
): SceneElement[] {
  const suppress = overlay?.suppress ?? [];
  const elements = overlay?.elements ?? [];

  const kept: SceneElement[] = [];
  walls.forEach((w, i) => {
    const mx = (w.x1 + w.x2) / 2;
    const mz = (w.z1 + w.z2) / 2;
    const suppressed = suppress.some(({ region }) => {
      const [minX, maxX] = [Math.min(region.x1, region.x2), Math.max(region.x1, region.x2)];
      const [minZ, maxZ] = [Math.min(region.z1, region.z2), Math.max(region.z1, region.z2)];
      return mx >= minX && mx <= maxX && mz >= minZ && mz <= maxZ;
    });
    if (!suppressed) {
      kept.push({ type: 'wall', id: `wall:seg:${i}`, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2 });
    }
  });

  return [...kept, ...elements];
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx tsx --test tests/server/overlay-merge.test.ts && npm run test:server && npm run typecheck`
Expected: 全部 PASS（`WallSegment.curtain` 删除若引起其它编译错，一并修复：全库 grep `\.curtain`，见 Task 8 前不动 app 的运行时逻辑，只允许为编译通过做最小类型适配）

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts server/overlay-merge.ts tests/server/overlay-merge.test.ts
git commit -m "feat: SceneElement types + zod-validated overlay-merge (suppress/add, no auto-classification)"
```

---

### Task 6: server 接线——overlay 热重载 + /project 输出 sceneElements

**Files:**
- Modify: `server/index.ts`（loader 注册区 L38-95、apiDeps L104-110）
- Modify: `server/routes.ts`（`/project` L31-50、deps 类型）
- Test: `tests/server/api.test.ts`（追加用例；先读该文件现有 deps 构造方式，保持同风格）

**Interfaces:**
- Consumes: Task 5 的 `parseOverlay` / `mergeSceneElements` / `OverlayConfig`。
- Produces: REST `/api/project` 响应 `house.sceneElements: SceneElement[]`（替换原 `house.walls` 字段）；apiDeps 新增 `getOverlay: () => OverlayConfig | undefined`。

- [ ] **Step 1: 写失败测试**（追加到 `tests/server/api.test.ts`，按该文件现有 supertest 构造方式）

```ts
it('GET /api/project returns sceneElements merged from walls and overlay', async () => {
  // 按本文件既有模式构造 app；overlay deps 注入一个含 curtain_run 的 OverlayConfig
  const res = await request(app).get('/api/project');
  assert.equal(res.status, 200);
  const els = res.body.house.sceneElements;
  assert.ok(Array.isArray(els));
  assert.ok(els.every((e: { type: string }) => typeof e.type === 'string'));
  assert.equal(res.body.house.walls, undefined); // 旧字段必须消失
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:server`
Expected: 新用例 FAIL（`sceneElements` undefined）

- [ ] **Step 3: 实现**

`server/index.ts` 追加 loader（在 houseMetaLoader 之后）：

```ts
const overlayLoader = new ConfigLoader<OverlayConfig>(
  'config/layout/overlay.yaml',
  (raw) => parseOverlay(raw),
  () => {
    console.log('[server] config/layout/overlay.yaml reloaded');
  }
);
registry.register(overlayLoader);
// ...
overlayLoader.load();
```

apiDeps 增加：

```ts
getOverlay: () => overlayLoader.getConfig(),
```

`server/routes.ts` `/project` 改为：

```ts
res.json({
  house: {
    rooms: projectCatalog.getRooms(),
    platform: projectCatalog.getPlatform(),
    furnishings: projectCatalog.getFurnishings(),
    electrical: projectCatalog.getElectricalMarkers(),
    sceneElements: mergeSceneElements(projectCatalog.getWalls(), deps.getOverlay()),
    layoutSource: projectCatalog.getLayoutSource(),
  },
  ...
});
```

deps 接口类型同步加 `getOverlay`。overlay.yaml 文件 Task 7 才创建——文件缺失时 loader status=failed、`getConfig()` 返回 undefined、merge 走空 overlay 直通，渲染管线不断（临时的配置错误横幅在 Task 7 落文件后消失）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:server && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.ts server/routes.ts tests/server/api.test.ts
git commit -m "feat: serve merged sceneElements from /api/project with hot-reloaded overlay.yaml"
```

---

### Task 7: 初版 overlay.yaml + house.yaml 清理

**Files:**
- Create: `config/layout/overlay.yaml`
- Modify: `config/house.yaml`（删 `curtain_walls`、`curtain_wall_corners` 段，L607-623 一带）

**Interfaces:**
- Consumes: Task 4 重新生成的 walls 几何（核对坐标用）、Task 5 schema。
- Produces: 声明了玻璃立面与窗洞玻璃的权威 overlay 配置。

- [ ] **Step 1: 写初版 overlay.yaml**

坐标基准：正确坐标系历史数据（git fe31b2d 幕墙段）+ house.yaml 拐角。玻璃立面是一条连续折线：南段 → S 拐角 → SW 斜面 → 西段 → NW 拐角 → 北段。

```yaml
# 场景覆盖层：DXF 表达不了/画错的信息在此声明。
# 铁律：这里声明什么就渲染什么；不声明的 DXF 墙永远是实墙。
# schema 见 server/overlay-merge.ts（zod strict，未知字段/类型直接报错）。
version: 1

suppress: []
# 如重新生成后幕墙位置有 DXF 残线，按下述格式声明移除：
# - id: xxx
#   region: {x1: ..., z1: ..., x2: ..., z2: ...}
#   reason: "..."

elements:
  # 玻璃幕墙立面：南 → SW 斜面 → 西 → NW 拐角 → 北，一条连续折线。
  # 入户花园（x>3.75 的南边界）与西设备平台外墙不在此列——它们是实墙，
  # 由 DXF 墙线默认渲染，无需声明。
  - id: glass_facade
    type: curtain_run
    points:
      - {x: 3.75, z: -4.32}    # 南段东端（入户花园以西）
      - {x: -0.58, z: -4.32}   # S 拐角
      - {x: -5.75, z: -3.17}   # SW 拐角（斜面）
      - {x: -5.88, z: -2.99}
      - {x: -5.88, z: 4.87}    # 西段北端
      - {x: -5.36, z: 5.39}    # NW 拐角（斜面）
      - {x: 5.98, z: 5.39}     # 北段东端
    height: 3.0

  # 窗洞玻璃填充（源自 house.yaml rooms[].openings 中 type=window 的条目）
  - id: living_south_glass
    type: glass_infill
    room: living_dining
    wall: south
    center_offset: 0
    width: 3.5
    height: 1.6
    sill: 0.9
```

注意：执行时先 `grep -n "type: \"window\"" -A4 config/house.yaml` 列出全部窗洞条目，逐一转成 `glass_infill`（上面 living_dining 是格式样例，实际按清单补全）。

- [ ] **Step 2: 校验 overlay 能通过 schema**

Run: `npx tsx -e "import {parseOverlay} from './server/overlay-merge.js'; import {readFileSync} from 'node:fs'; parseOverlay(readFileSync('config/layout/overlay.yaml','utf8')); console.log('overlay OK')"`
Expected: `overlay OK`

- [ ] **Step 3: 删除 house.yaml 的 curtain 段**

删除 `curtain_walls:`（含注释）与 `curtain_wall_corners:` 整段。
Run: `grep -c curtain_wall config/house.yaml`
Expected: `0`

- [ ] **Step 4: 全量回归**

Run: `python3 -m pytest scripts/parse_cad_test.py -q && npm run test:server && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add config/layout/overlay.yaml config/house.yaml
git commit -m "feat: initial overlay.yaml declaring glass facade and window infills, drop curtain hints from house.yaml"
```

---

### Task 8: HouseScene 按 type 分发渲染

**Files:**
- Modify: `app/src/render/HouseScene.ts`（ProjectData L25-35、build L133-155、createWalls L267-305、setWallColor/setPaintColor L480-500、常量 L19-23）
- Test: `app/src/render/HouseScene.test.ts`

**Interfaces:**
- Consumes: `shared/types.ts` 的 `SceneElement`；`/api/project` 的 `house.sceneElements`。
- Produces: `ProjectData.house.sceneElements?: SceneElement[]`；私有渲染器 `renderWallSegment` / `renderCurtainRun` / `renderWallRun` / `renderGlassInfill`；玻璃网格单独存入 `private glassMeshes: THREE.Mesh[]`（不进 `wallMeshes`，从而 setWallColor/setPaintColor 天然不碰玻璃）。

- [ ] **Step 1: 写失败测试**（沿用该文件现有"源码扫描"风格 + 行为断言）

```ts
import { describe, it, expect } from 'vitest';

describe('HouseScene scene elements', () => {
  it('renders by declared type only — no curtain boolean, no position-based classification', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).not.toContain('userData.curtain');
    expect(source).not.toContain('curtain?:');
    expect(source).toContain("case 'curtain_run'");
    expect(source).toContain("case 'glass_infill'");
    expect(source).toContain("case 'wall_run'");
    expect(source).toContain("case 'wall'");
  });

  it('house.walls is no longer consumed — sceneElements is the only wall source', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./src/render/HouseScene.ts', 'utf8');
    expect(source).not.toContain('house.walls');
    expect(source).toContain('sceneElements');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx vitest run src/render/HouseScene.test.ts`
Expected: 新用例 FAIL

- [ ] **Step 3: 实现**

1. 常量重命名：`CURTAIN_WALL_COLOR/OPACITY/THICKNESS` → `GLASS_COLOR/GLASS_OPACITY/GLASS_THICKNESS`（值不变）。
2. `ProjectData.house`：`walls?: WallSegment[]` → `sceneElements?: SceneElement[]`；import 改 `SceneElement`。
3. build 流程（L133-155）：`useWallSegments` 改为 `useSceneElements = Array.isArray(projectData.house.sceneElements) && projectData.house.sceneElements.length > 0`；调用 `this.buildSceneElements(projectData.house.sceneElements!, wallHeight)`。
4. 新增私有成员 `private glassMeshes: THREE.Mesh[] = [];`（build 开头随 wallMeshes 一起清空）与玻璃材质工厂：

```ts
private makeGlassMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: GLASS_COLOR,
    transparent: true,
    opacity: GLASS_OPACITY,
    roughness: 0.05,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
}
```

5. 分发器 + 渲染器（替换原 `createWalls`）：

```ts
/**
 * 铁律：按声明的 type 渲染，禁止在这里做任何"这段墙是什么"的推断。
 * 新元素类型 = schema（server/overlay-merge.ts）+ 此处新增一个 case。
 */
private buildSceneElements(elements: SceneElement[], defaultHeight: number) {
  for (const el of elements) {
    switch (el.type) {
      case 'wall': this.renderWallSegment(el, defaultHeight); break;
      case 'curtain_run': this.renderCurtainRun(el); break;
      case 'wall_run': this.renderWallRun(el); break;
      case 'glass_infill': this.renderGlassInfill(el); break;
      default: {
        const exhaustive: never = el;
        console.error('[HouseScene] 未知场景元素类型（渲染器缺 case）', exhaustive);
      }
    }
  }
}

private renderBox(
  x1: number, z1: number, x2: number, z2: number,
  height: number, thickness: number, mat: THREE.Material,
): THREE.Mesh {
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const length = Math.hypot(x2 - x1, z2 - z1);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(length, thickness), height, thickness),
    mat
  );
  mesh.position.set(cx, height / 2, cz);
  if (length > thickness) mesh.rotation.y = Math.atan2(z2 - z1, x2 - x1);
  this.scene.add(mesh);
  return mesh;
}

private renderWallSegment(el: Extract<SceneElement, { type: 'wall' }>, height: number) {
  const mat = new THREE.MeshStandardMaterial({ color: DEFAULT_PAINT, roughness: 0.85 });
  const mesh = this.renderBox(el.x1, el.z1, el.x2, el.z2, height, WALL_THICKNESS, mat);
  mesh.userData = { type: 'wall', objectId: el.id };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  this.wallMeshes.push(mesh);
}

private renderCurtainRun(el: Extract<SceneElement, { type: 'curtain_run' }>) {
  for (let i = 0; i < el.points.length - 1; i++) {
    const a = el.points[i];
    const b = el.points[i + 1];
    const mesh = this.renderBox(a.x, a.z, b.x, b.z, el.height, GLASS_THICKNESS, this.makeGlassMaterial());
    mesh.userData = { type: 'curtain_run', objectId: `${el.id}:${i}` };
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.glassMeshes.push(mesh);
  }
}

private renderWallRun(el: Extract<SceneElement, { type: 'wall_run' }>) {
  for (let i = 0; i < el.points.length - 1; i++) {
    const a = el.points[i];
    const b = el.points[i + 1];
    const mat = new THREE.MeshStandardMaterial({ color: DEFAULT_PAINT, roughness: 0.85 });
    const mesh = this.renderBox(a.x, a.z, b.x, b.z, el.height, WALL_THICKNESS, mat);
    mesh.userData = { type: 'wall', objectId: `${el.id}:${i}` };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.wallMeshes.push(mesh);
  }
}

private renderGlassInfill(el: Extract<SceneElement, { type: 'glass_infill' }>) {
  const room = this.rooms[el.room];
  if (!room) {
    console.error(`[HouseScene] glass_infill "${el.id}" 引用不存在的房间 "${el.room}"，未渲染`);
    return;
  }
  const halfW = room.width / 2;
  const halfD = room.depth / 2;
  let x = room.x;
  let z = room.z;
  let rotate = false;
  switch (el.wall) {
    case 'south': x += el.center_offset; z += halfD; break;
    case 'north': x += el.center_offset; z -= halfD; break;
    case 'east': x += halfW; z += el.center_offset; rotate = true; break;
    case 'west': x -= halfW; z += el.center_offset; rotate = true; break;
  }
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(el.width, el.height, GLASS_THICKNESS),
    this.makeGlassMaterial()
  );
  mesh.position.set(x, el.sill + el.height / 2, z);
  if (rotate) mesh.rotation.y = Math.PI / 2;
  mesh.userData = { type: 'glass_infill', objectId: el.id };
  mesh.castShadow = false;
  this.scene.add(mesh);
  this.glassMeshes.push(mesh);
}
```

注意：`glass_infill` 的 south/north 方向沿用 `_openingPosition` 现有约定（south=+z）。
6. `setWallColor` / `setPaintColor` 删除 `if (mesh.userData.curtain) continue;` 两行（玻璃已不在 wallMeshes）。
7. dispose/重建路径把 `glassMeshes` 与 `wallMeshes` 同等清理。
8. 全库 grep `house.walls`、`userData.curtain`、`WallSegment`（app 内）确认无残留。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx vitest run && cd .. && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/render/HouseScene.ts app/src/render/HouseScene.test.ts
git commit -m "feat: HouseScene renders sceneElements by declared type, delete curtain boolean branch"
```

---

### Task 9: 防回归护栏——AGENTS.md 与铁律注释补全

**Files:**
- Create: `AGENTS.md`（若已存在则追加章节）
- Modify: `scripts/parse_cad.py`、`server/overlay-merge.ts`、`app/src/render/HouseScene.ts`（核对 Task 3/5/8 已写的头注释是否完整，缺则补）

**Interfaces:** 无代码接口；产出项目级 AI 指令。

- [ ] **Step 1: 写 AGENTS.md**

```markdown
# 项目铁律（AI 会话必读）

## CAD / 3D 渲染架构（2026-07-14 起生效）

> CAD 只出几何，config 出一切意图。代码只读、只执行，禁止推断。

- `scripts/parse_cad.py` 只做几何提取与坐标换算；坐标系锚点只来自
  `config/layout/cad-anchor.yaml` 的显式声明，缺失必须报错（fail loud）。
- 输出的墙体只有 `x1/z1/x2/z2` 纯几何字段。禁止追加分类/意图字段。
- "这段墙是什么"（幕墙/玻璃/补墙…）只在 `config/layout/overlay.yaml` 声明；
  合并逻辑（`server/overlay-merge.ts`）只有 suppress 和 add 两条机械规则。
- **禁止**添加任何基于几何位置、边界、邻接关系的自动分类启发式。
  需要新行为 → 新增 element type（zod schema + 渲染器 case）+ 声明式配置。
- 配置校验失败必须报错并进配置错误横幅；禁止静默跳过、禁止"智能降级"。
- 守卫测试位于 `scripts/parse_cad_test.py`（字段白名单、禁用标识扫描）与
  `tests/server/overlay-merge.test.ts`（不声明永远是 wall）。删除或绕过
  守卫测试视同违反铁律。

设计文档：`docs/superpowers/specs/2026-07-14-dxf-overlay-rendering-design.md`
```

- [ ] **Step 2: 核对三处模块头注释**

逐一确认 `parse_cad.py`（Task 3 Step 3.7）、`overlay-merge.ts`（Task 5 Step 4）、`HouseScene.ts`（Task 8 分发器注释）铁律注释在位；HouseScene 文件顶部若无模块级注释，补：

```ts
/**
 * 3D 场景渲染。
 * 铁律：场景元素按 /api/project 下发的声明 type 渲染（见 AGENTS.md）。
 * 本文件禁止出现任何"根据位置猜这是什么"的逻辑。
 */
```

- [ ] **Step 3: 全量回归**

Run: `python3 -m pytest scripts/parse_cad_test.py -q && npm run test:server && cd app && npx vitest run && cd .. && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md scripts/parse_cad.py server/overlay-merge.ts app/src/render/HouseScene.ts
git commit -m "docs: add AGENTS.md architecture rules and module-header guards"
```

---

### Task 10: 端到端验收

**Files:** 无新增；可能微调 `config/layout/overlay.yaml`（坐标核对）。

- [ ] **Step 1: 全量自动化验证**

```bash
python3 -m pytest scripts/parse_cad_test.py -q
npm run test:server
cd app && npx vitest run && cd ..
npm run typecheck
```

Expected: 全部 PASS。

- [ ] **Step 2: 手动验收（需要用户配合看浏览器）**

```bash
npm run dev:server &
npm run dev:app
```

核对清单（逐项让用户确认）：
1. 南（x<3.75）/西/北立面为半透明玻璃幕墙，拐角斜面为玻璃；
2. 入户花园、西设备平台外墙为实墙（不再被误判为玻璃）；
3. 墙体与房间地板对齐（坐标系修复生效），无 30 米外的漂移墙体、无双副本；
4. 声明的窗洞位置有玻璃填充；
5. 修改 overlay.yaml（如临时把 glass_facade 的 height 改 1.5）→ 保存 → 浏览器数秒内自动更新；改回后恢复；
6. 在 overlay.yaml 里写一个未知 type → 配置错误横幅出现且指明字段路径；删除后横幅消失。

- [ ] **Step 3: 按用户反馈微调 overlay.yaml 坐标**（幕墙折线端点与 DXF 墙线接缝、suppress 残线），每次改动热重载即时核对。

- [ ] **Step 4: Commit 收尾**

```bash
git add config/layout/overlay.yaml
git commit -m "chore: tune overlay glass facade coordinates after visual acceptance"
```
