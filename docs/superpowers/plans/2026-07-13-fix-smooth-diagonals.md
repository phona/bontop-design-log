# 修复 _smooth_diagonals() 误平滑室内倒角 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `_smooth_diagonals()` 只平滑靠近幕墙拐角的斜线，室内倒角保持直线。

**Architecture:** CAD 是主数据源，`house.yaml` 新增 `curtain_wall_corners` 配置显式标记幕墙拐角位置（场景坐标，米）。`_smooth_diagonals()` 接收 DXF 坐标的拐角列表，只平滑距离拐角 ≤ 500mm 的斜线。

**Tech Stack:** Python, ezdxf, PyYAML, pytest

## Global Constraints

- CAD 是权威数据源，配置只做微调
- 向后兼容：`curtain_wall_corners` 为空时保持原行为
- 坐标单位：DXF 用 mm，场景用 m，转换公式 `dxf_x = scene_x * 1000 + origin_x`
- 默认容差：500mm（0.5m）

---

### Task 1: 修改 `_smooth_diagonals()` 支持拐角过滤

**Files:**
- Modify: `scripts/parse_cad.py:287-323`
- Test: `scripts/parse_cad_test.py` (add new tests)

**Interfaces:**
- Consumes: 斜线段列表
- Produces: 修改后的 `_smooth_diagonals(segments, curtain_corners_dxf=None, corner_tolerance=500.0)` 函数

- [ ] **Step 1: 写测试 - 无拐角配置时保持原行为**

```python
def test_smooth_diagonals_without_corners_keeps_original_behavior():
    """When curtain_corners_dxf is None, all diagonals >= 200mm are smoothed."""
    from parse_cad import _smooth_diagonals

    segments = [
        ((0, 0), (1000, 0)),      # horizontal, skip
        ((0, 0), (0, 1000)),      # vertical, skip
        ((0, 0), (500, 500)),     # diagonal 707mm, should smooth
    ]
    result = _smooth_diagonals(segments)
    # horizontal and vertical pass through unchanged
    assert result[0] == ((0, 0), (1000, 0))
    assert result[1] == ((0, 0), (0, 1000))
    # diagonal is split into 12 sub-segments
    assert len(result) == 14  # 2 unchanged + 12 sub-segments
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd scripts && python -m pytest parse_cad_test.py::test_smooth_diagonals_without_corners_keeps_original_behavior -v
```

- [ ] **Step 3: 写测试 - 有拐角配置时只平滑靠近拐角的斜线**

```python
def test_smooth_diagonals_with_corners_filters_by_distance():
    """Only diagonals near a curtain corner are smoothed."""
    from parse_cad import _smooth_diagonals

    segments = [
        ((0, 0), (500, 500)),     # diagonal near corner at (250, 250), should smooth
        ((10000, 10000), (10500, 10500)),  # diagonal far from corner, should NOT smooth
    ]
    corners = [(250, 250)]  # DXF mm
    result = _smooth_diagonals(segments, curtain_corners_dxf=corners)
    # first diagonal smoothed (12 sub-segments)
    # second diagonal passes through unchanged
    assert len(result) == 13  # 12 sub-segments + 1 unchanged
```

- [ ] **Step 4: 修改 `_smooth_diagonals()` 实现**

```python
def _smooth_diagonals(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
    curtain_corners_dxf: list[tuple[float, float]] | None = None,
    corner_tolerance: float = 500.0,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Split diagonal wall segments near curtain corners into sub-segments.
    
    The chord midpoint is bowed outward by ``bulge`` mm so the glass curtain
    wall corner renders as an approximated smooth curve.
    
    If ``curtain_corners_dxf`` is given, only diagonals within ``corner_tolerance``
    mm of a corner are smoothed; others pass through unchanged.
    """
    import math
    bulge = 80.0        # mm – outward bow at chord midpoint
    subdiv = 12           # sub-segments per diagonal
    result: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for (x1, y1), (x2, y2) in segments:
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        is_diagonal = abs(x1 - x2) > 1 and abs(y1 - y2) > 1
        if not is_diagonal or length < 200:
            result.append(((x1, y1), (x2, y2)))
            continue

        # Check if this diagonal is near a curtain corner
        if curtain_corners_dxf is not None:
            mid_x, mid_y = (x1 + x2) / 2, (y1 + y2) / 2
            near_corner = any(
                math.hypot(mid_x - cx, mid_y - cy) <= corner_tolerance
                for cx, cy in curtain_corners_dxf
            )
            if not near_corner:
                result.append(((x1, y1), (x2, y2)))
                continue

        # Perpendicular direction, bow outward (west = more-negative x)
        nx, ny = -dy / length, dx / length
        if nx > 0:
            nx, ny = -nx, -ny

        # Compute sub-segment endpoints along the chord with parabolic bulge
        pts = [(x1, y1)]
        for k in range(1, subdiv):
            t = k / subdiv  # 0…1
            # Parabolic bulge: max at t=0.5, zero at t=0,1
            offset = 4 * bulge * t * (1 - t)
            px = x1 + dx * t + nx * offset
            py = y1 + dy * t + ny * offset
            pts.append((round(px), round(py)))
        pts.append((x2, y2))

        for i in range(len(pts) - 1):
            result.append((pts[i], pts[i+1]))
    return result
```

- [ ] **Step 5: 运行测试验证通过**

```bash
cd scripts && python -m pytest parse_cad_test.py::test_smooth_diagonals_without_corners_keeps_original_behavior parse_cad_test.py::test_smooth_diagonals_with_corners_filters_by_distance -v
```

Expected: Both PASS

- [ ] **Step 6: 运行所有测试确保无回归**

```bash
cd scripts && python -m pytest parse_cad_test.py -v
```

- [ ] **Step 7: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "feat: add curtain corner filtering to _smooth_diagonals()"
```

---

### Task 2: 在 `house.yaml` 添加幕墙拐角配置

**Files:**
- Modify: `config/house.yaml` (add `curtain_wall_corners` section)

**Interfaces:**
- Produces: `house.yaml` 中的 `curtain_wall_corners` 配置项

- [ ] **Step 1: 在 `house.yaml` 末尾添加 `curtain_wall_corners` section**

```yaml
# 幕墙拐角位置（场景坐标，米）
# 用于 parse_cad.py 的 _smooth_diagonals() 过滤
curtain_wall_corners:
  # NW 玻璃幕墙拐角
  - x: -5.88
    z: 4.87
  # SW 玻璃幕墙拐角  
  - x: -5.37
    z: -3.36
  # S 玻璃幕墙拐角
  - x: -0.58
    z: -4.32
  # 飘窗/内弧
  - x: -1.99
    z: 0.62
```

- [ ] **Step 2: 验证 YAML 格式正确**

```bash
python -c "import yaml; yaml.safe_load(open('config/house.yaml'))"
```

Expected: No output (success)

- [ ] **Step 3: Commit**

```bash
git add config/house.yaml
git commit -m "config: add curtain_wall_corners for _smooth_diagonals filtering"
```

---

### Task 3: 修改 `extract_walls()` 加载拐角配置

**Files:**
- Modify: `scripts/parse_cad.py:259-283` (extract_walls function)
- Test: `scripts/parse_cad_test.py` (add new test)

**Interfaces:**
- Consumes: `house.yaml` 的 `curtain_wall_corners` 配置
- Produces: 修改后的 `extract_walls()` 函数，传入拐角坐标给 `_smooth_diagonals()`

- [ ] **Step 1: 写测试 - extract_walls 加载拐角配置**

```python
def test_extract_walls_loads_curtain_corners_from_config(tmp_path: Path):
    """extract_walls loads curtain_wall_corners from house.yaml and filters smoothing."""
    from ezdxf.document import Drawing
    from parse_cad import extract_walls

    # Create a house.yaml with curtain_wall_corners
    house_config = tmp_path / "house.yaml"
    house_config.write_text(yaml.dump({
        "curtain_wall_corners": [
            {"x": 0.25, "z": 0.25},  # near the diagonal at (250, 250)mm
        ]
    }, allow_unicode=True))

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("BS-非承重墙")
    # diagonal near corner (250, 250)mm - should be smoothed
    msp.add_line((0, 0), (500, 500), dxfattribs={"layer": "BS-非承重墙"})
    # diagonal far from corner - should NOT be smoothed
    msp.add_line((10000, 10000), (10500, 10500), dxfattribs={"layer": "BS-非承重墙"})

    walls = extract_walls(
        msp, bounds=None, origin_x=0.0, origin_z=0.0,
        house_config_path=house_config,
    )
    # first diagonal smoothed into 12 segments
    # second diagonal passes through as 1 segment
    assert len(walls) == 13
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd scripts && python -m pytest parse_cad_test.py::test_extract_walls_loads_curtain_corners_from_config -v
```

Expected: FAIL (extract_walls doesn't accept house_config_path yet)

- [ ] **Step 3: 添加加载配置的辅助函数**

在 `parse_cad.py` 中添加：

```python
def load_curtain_corners(
    config_path: Path,
    origin_x: float,
    origin_z: float,
) -> list[tuple[float, float]] | None:
    """Load curtain_wall_corners from house.yaml and convert to DXF coords.
    
    Returns list of (dxf_x, dxf_y) tuples, or None if config not found.
    """
    if not config_path.exists():
        return None
    
    with open(config_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    
    corners = data.get("curtain_wall_corners")
    if not corners:
        return None
    
    result = []
    for corner in corners:
        scene_x = corner["x"]
        scene_z = corner["z"]
        # Convert scene coords (m) to DXF coords (mm)
        dxf_x = scene_x * 1000 + origin_x
        dxf_y = origin_z - scene_z * 1000
        result.append((dxf_x, dxf_y))
    
    return result
```

- [ ] **Step 4: 修改 `extract_walls()` 签名和实现**

```python
def extract_walls(
    modelspace,
    bounds: tuple[float, float, float, float] | None,
    origin_x: float,
    origin_z: float,
    house_config_path: Path | None = None,
) -> list[Wall]:
    """Return wall segments in meters, origin-subtracted, for the renderer.

    The DXF draws each physical wall exactly once (shared walls are single
    segments, openings are gaps), so exporting the segments verbatim gives the
    renderer a continuous, non-duplicated wall graph.
    
    If ``house_config_path`` is given, curtain_wall_corners are loaded and
    passed to _smooth_diagonals() for filtering.
    """
    segments = collect_wall_segments(modelspace, bounds=bounds)
    
    # Load curtain corners if config is provided
    curtain_corners_dxf = None
    if house_config_path is not None:
        curtain_corners_dxf = load_curtain_corners(
            house_config_path, origin_x, origin_z
        )
    
    segments = _smooth_diagonals(segments, curtain_corners_dxf=curtain_corners_dxf)
    walls: list[Wall] = []
    for (x1, y1), (x2, y2) in segments:
        walls.append(
            Wall(
                x1=round((x1 - origin_x) / 1000.0, 3),
                z1=round((origin_z - y1) / 1000.0, 3),
                x2=round((x2 - origin_x) / 1000.0, 3),
                z2=round((origin_z - y2) / 1000.0, 3),
            )
        )
    return walls
```

- [ ] **Step 5: 运行测试验证通过**

```bash
cd scripts && python -m pytest parse_cad_test.py::test_extract_walls_loads_curtain_corners_from_config -v
```

Expected: PASS

- [ ] **Step 6: 更新 `extract_rooms()` 调用**

修改 `parse_cad.py:831`：

```python
walls = extract_walls(
    msp, bounds=bounds, origin_x=origin_x, origin_z=origin_z,
    house_config_path=HOUSE_CONFIG,
)
```

- [ ] **Step 7: 运行所有测试确保无回归**

```bash
cd scripts && python -m pytest parse_cad_test.py -v
```

- [ ] **Step 8: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "feat: load curtain_wall_corners from house.yaml in extract_walls()"
```

---

### Task 4: 验证修复效果

**Files:**
- Verify: `config/layout/cad-extracted.yaml` (regenerate and check)

**Interfaces:**
- Consumes: 所有前面的修改

- [ ] **Step 1: 重新运行 parse_cad.py**

```bash
python scripts/parse_cad.py
```

- [ ] **Step 2: 检查红框区域的墙段**

```bash
python -c "
import yaml
with open('config/layout/cad-extracted.yaml') as f:
    data = yaml.safe_load(f)

walls = data['walls']
# Find walls in red box area (scene x=[-2,0], z=[0,1])
print('=== Wall segments in red box area ===')
for w in walls:
    x1, z1, x2, z2 = w['x1'], w['z1'], w['x2'], w['z2']
    mx, mz = (x1+x2)/2, (z1+z2)/2
    if -2 <= mx <= 0 and 0 <= mz <= 1:
        length = ((x2-x1)**2 + (z2-z1)**2)**0.5
        print(f'  ({x1:6.3f}, {z1:6.3f}) -> ({x2:6.3f}, {z2:6.3f})  len={length*1000:6.1f}mm')
"
```

Expected: 应该只有少量直线段（3-5 条），而不是之前的 20+ 条小弧线

- [ ] **Step 3: 检查幕墙拐角保持圆弧**

```bash
python -c "
import yaml
with open('config/layout/cad-extracted.yaml') as f:
    data = yaml.safe_load(f)

walls = data['walls']
# Check NW corner area (scene x≈-5.9, z≈4.9)
print('=== NW curtain wall corner ===')
count = 0
for w in walls:
    x1, z1, x2, z2 = w['x1'], w['z1'], w['x2'], w['z2']
    mx, mz = (x1+x2)/2, (z1+z2)/2
    if -6 <= mx <= -5 and 4.5 <= mz <= 5.5:
        count += 1
print(f'NW corner segments: {count} (should be ~12-24 for smooth curve)')

# Check SW corner area (scene x≈-5.4, z≈-3.4)
print('=== SW curtain wall corner ===')
count = 0
for w in walls:
    x1, z1, x2, z2 = w['x1'], w['z1'], w['x2'], w['z2']
    mx, mz = (x1+x2)/2, (z1+z2)/2
    if -6 <= mx <= -5 and -4 <= mz <= -3:
        count += 1
print(f'SW corner segments: {count} (should be ~12-24 for smooth curve)')
"
```

Expected: 幕墙拐角应该保持 12-24 段圆弧

- [ ] **Step 4: Commit 更新后的 cad-extracted.yaml**

```bash
git add config/layout/cad-extracted.yaml
git commit -m "chore: regenerate cad-extracted.yaml with curtain corner filtering"
```

---

## 验证清单

- [ ] 红框区域（室内倒角）恢复为少量直线段
- [ ] 幕墙拐角（NW/SW/S）保持圆弧
- [ ] 所有测试通过：`cd scripts && python -m pytest parse_cad_test.py -v`
- [ ] 向后兼容：`curtain_wall_corners` 为空时保持原行为
