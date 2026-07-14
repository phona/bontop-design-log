# 项目铁律（AI 会话必读）

## CAD / 3D 渲染架构

> `config/layout/model-geometry.yaml` 是户型几何的唯一权威源；`config/layout/overlay.yaml` 出一切意图。代码只读、只执行，禁止推断。
>
> `parse_cad.py` 仅用于从 CAD 初始化或参考导出，默认不覆盖 `model-geometry.yaml`。需要新行为 → 新增 element type + 声明式配置。
