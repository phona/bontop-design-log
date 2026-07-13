# 修复 _smooth_diagonals() 误平滑室内倒角

**日期**: 2026-07-13  
**状态**: 待实现

## 问题

`scripts/parse_cad.py` 的 `_smooth_diagonals()` 函数把 DXF 中**所有斜线**都做了圆弧处理，包括：
- 玻璃幕墙拐角（应该圆弧）✅
- 室内墙体倒角（应该直线）❌
- 幕墙立面长段（应该直线）❌

DXF 里所有墙都是直线，没有区分幕墙拐角和普通墙体。

## 设计思路

**以 CAD 为驱动，外挂配置做微调**：
- CAD 是主要数据源（墙体位置、房间布局）
- 配置（house.yaml）补充 CAD 表达不了的信息（哪些斜线是幕墙拐角）

## 方案

### 1. `config/house.yaml` — 新增 `curtain_wall_corners` section

```yaml
curtain_wall_corners:
  # 场景坐标（米），标记幕墙拐角位置
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

### 2. `scripts/parse_cad.py` 改动

**`_smooth_diagonals()` 增加参数**：
```python
def _smooth_diagonals(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
    curtain_corners_dxf: list[tuple[float, float]] | None = None,
    corner_tolerance: float = 500.0,  # mm
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
```

**逻辑**：
- 如果 `curtain_corners_dxf` 为 None，保持原行为（向后兼容）
- 否则，只平滑距离某个 corner ≤ `corner_tolerance` 的斜线
- 距离计算：斜线中点到最近 corner 的欧氏距离

**`extract_walls()` 加载配置**：
```python
def extract_walls(...):
    # 加载 house.yaml 的 curtain_wall_corners
    # 转换场景坐标到 DXF 坐标
    # 传入 _smooth_diagonals()
```

### 3. 效果

- 只有靠近标记位置的斜线被圆弧化
- 红框区域（scene x≈-1~-2, z≈0.4~0.7）的室内倒角保持直线
- 其他 plan 只需在 config 里加对应 corner 坐标

## 验证

修改后重新运行 `parse_cad.py`，检查：
1. `cad-extracted.yaml` 中红框区域的墙段恢复为少量直线段
2. 幕墙拐角（NW/SW/S）保持圆弧
3. 运行测试：`pytest scripts/parse_cad_test.py`
