# 项目铁律（AI 会话必读）

## CAD / 3D 渲染架构

> `config/layout/model-geometry.yaml` 是户型几何的唯一权威源；`config/layout/overlay.yaml` 出一切意图。代码只读、只执行，禁止推断。
>
> `parse_cad.py` 仅用于从 CAD 初始化或参考导出，默认不覆盖 `model-geometry.yaml`。需要新行为 → 新增 element type + 声明式配置。

## 坐标系约定

- 采用 Three.js 默认右手坐标系：Y 轴向上（高度）。
- 水平面：`x` 为东西向，`z` 为南北向。
- 方向约定：
  - `+x` = 东，`-x` = 西
  - `+z` = 南，`-z` = 北
- 俯视图约定：北朝上（`-z` 方向），南朝下（`+z` 方向）。
- `model-geometry.yaml` 使用 DXF 原值（局部坐标），允许 `z < 0`（如入户花园向北凸出）。
- `overlay.yaml` 必须与 `model-geometry.yaml` 使用同一坐标系，不得保留独立偏移。
- 全局坐标与局部坐标换算：
  - `DXF_mm = (local_m + origin) / scale`
  - `local_m = DXF_mm * scale - origin`
