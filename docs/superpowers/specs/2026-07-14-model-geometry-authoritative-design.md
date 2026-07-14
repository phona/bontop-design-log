# Model-Geometry 作为权威户型数据源

- 日期：2026-07-14
- 状态：已确认（待实施）
- 前置：`2026-07-14-dxf-overlay-rendering-design.md`（本 spec 反转该架构的“源”方向，但保留 overlay 意图层）

## 背景与问题

当前流程为 **CAD 单源**：

```
CAD (.dxf) ──parse_cad.py──► cad-extracted.yaml ──overlay──► 3D
```

但实际运行中发现：

1. **CAD 与效果图尺寸不一致**：DXF 中的户型副本宽 14.42m/深 9.71m，而营销效果图标注为 16.4m/10.4m 且带圆角。
2. **CAD 房间标签与效果图位置不一致**：`主卧` 标签位置在 CAD 中偏到左上区域，与效果图左下主卧位置错位；多个 `次卧`、`卫生间` 无法直接映射到效果图房间。
3. **CAD 双线墙、碎斜线多**：即使做几何清洗，外墙轮廓仍是斜切角，和效果图圆弧角差距明显；小碎线 suppress 维护成本高。
4. **用户维护意愿**：用户 CAD 能力不强，不愿改 CAD；希望 3D 模型正确后，只维护模型，并反向生成 CAD 给设计师参考。

因此，本轮将权威数据源从 CAD 反转到人工维护的模型文件。

## 设计决策

### 1. 权威源反转

- `config/layout/model-geometry.yaml` 成为户型几何的**唯一权威**。
- `config/layout/cad-extracted.yaml` **改名**为 `model-geometry.yaml`，避免文件名暗示它是“CAD 产物”。
- `parse_cad.py` 仍然可用，但**不再默认覆盖** `model-geometry.yaml`；它降级为“从 CAD 初始化/导出”工具，产出可手动审查的临时文件（默认输出到 `model-geometry-from-cad.yaml`）。
- `config/layout/overlay.yaml` 保留并继续承担**意图声明**：哪里是玻璃幕墙、哪里是飘窗、哪里要补地板、哪里 suppress 掉模型里的墙。

新的数据流：

```
model-geometry.yaml（人工维护） ──► overlay-merge.ts ──► 3D
CAD (.dxf) ──► parse_cad.py ──► 参考/临时导出（可选）
```

### 2. 模型文件 Schema

`model-geometry.yaml` 保持与当前 `cad-extracted.yaml` 的格式一致，语义改为人工维护：

```yaml
version: '1.0'
source: '参考：cad/design/01_floor_plan/floor_plan_design_2026-07-05.dxf'
unit: m
scale: 0.001
origin: { x: 31.64204, z: -12.48434 }   # 保留，用于日后反向导出 CAD 时坐标换算
export_date: '2026-07-14'
rooms:
  - id: master_bedroom
    name: 主卧
    x: ...
    z: ...
    width: ...
    depth: ...
    height: 3.0
    area: ...
    perimeter: ...
  # ...
walls:
  - { x1: ..., z1: ..., x2: ..., z2: ... }
  # ...
platform:
  id: west_platform
  name: 西设备平台
  x: ...
  z: ...
  width: ...
  depth: ...
  height: 0.15
  area: ...
```

约束：

- `walls` 只保留 `x1/z1/x2/z2` 纯几何字段。
- `rooms` 必须是轴对齐矩形；非矩形房间用 `floor_region` 在 overlay 中补。
- 房间和墙线必须在同一坐标系（保留现有 guard test）。

### 3. Overlay 角色不变

`overlay.yaml` 仍然是**声明式意图层**：

- `suppress`：移除模型中不需要渲染的墙段（如被幕墙替换的外墙、碎斜线）。
- `curtain_run`：玻璃幕墙折线。
- `bay_sill`：上飘窗凸台。
- `floor_region`：地板补区。
- `glass_infill`：窗洞玻璃填充。

模型文件本身**不携带任何意图字段**，继续遵守“模型只出几何，config 出意图”的铁律。

### 4. 文件改名范围

所有消费 `config/layout/cad-extracted.yaml` 的位置需要改为 `config/layout/model-geometry.yaml`：

| 文件 | 修改内容 |
|---|---|
| `server/index.ts` | chokidar watch 列表中的路径 |
| `server/project-catalog.ts` | `loadCadLayout` 默认加载路径 |
| `app/src/App.ts` | `layoutSource ?? 'cad-extracted'` 默认值改为 `'model-geometry'` |
| `scripts/parse_cad.py` | `OUTPUT_YAML` 默认输出改为 `config/layout/model-geometry.yaml`（或改为临时导出路径） |
| `scripts/parse_cad_test.py` | 所有测试输出路径字符串和 `test_committed_layout_walls_share_frame_with_rooms` 中的文件路径 |
| `README.md` | 文档引用 |
| `scripts/README.md` | 文档引用 |
| `shared/houseData.ts` | 顶部注释 |
| `AGENTS.md` | 更新“CAD 单源”铁律为“模型文件是源，CAD 是参考/可导出产物” |

旧设计文档中引用 `cad-extracted.yaml` 的（如 `2026-07-09-cad-driven-3d-layout-design.md`）在本次实施中**不强制修改正文**，但需在 spec 末尾加“Note: 本文件描述的 CAD 单源架构已被 `2026-07-14-model-geometry-authoritative-design.md` 反转”。

### 5. parse_cad.py 行为调整

当前 `parse_cad.py` 默认覆盖 `cad-extracted.yaml`。改名后：

- 默认输出改为 `model-geometry-from-cad.yaml`（临时文件），避免误覆盖人工维护的 `model-geometry.yaml`。
- 当用户显式指定 `--output config/layout/model-geometry.yaml` 且加 `--force` 时，才允许覆盖。
- 新增 `--output` 参数支持导出到任意路径，便于从 CAD 初始化时先生成临时文件进行人工审查。
- 新增 `--preview` 或 `--dry-run` 模式：只打印报告，不写文件。

### 6. 更新 AGENTS.md

原铁律：

> CAD 只出几何，config 出一切意图。代码只读、只执行，禁止推断。

更新后：

> `config/layout/model-geometry.yaml` 是户型几何的唯一权威源；`config/layout/overlay.yaml` 出一切意图。`parse_cad.py` 仅用于从 CAD 初始化或参考导出，不默认覆盖模型文件。代码只读、只执行，禁止推断。

### 7. 手动维护 workflow

本轮实施完成后，用户修改户型的标准流程：

1. 打开 `config/layout/model-geometry.yaml`。
2. 修改 `walls` 或 `rooms`。
3. 保存后 dev server 自动热重载，浏览器刷新即可看到 3D 变化。
4. 如需玻璃/飘窗/地板补区，同时修改 `config/layout/overlay.yaml`。

如需从 CAD 重新初始化：

1. 备份当前 `model-geometry.yaml`。
2. 运行 `python scripts/parse_cad.py --output model-geometry-from-cad.yaml`。
3. 人工核对并合并到 `model-geometry.yaml`。

## 实施步骤

1. **创建新的模型文件**
   - 复制当前 `config/layout/cad-extracted.yaml` 到 `config/layout/model-geometry.yaml`。
   - 更新 `source` 字段为参考说明。
   - 按效果图调整外墙轮廓、房间位置和内墙（本次重点）。

2. **文件改名与引用更新**
   - 修改 `server/index.ts`、`server/project-catalog.ts`、`app/src/App.ts`、`scripts/parse_cad.py`。
   - 更新 `scripts/parse_cad_test.py` 中的路径和 guard test。
   - 更新 `README.md`、`scripts/README.md`、`shared/houseData.ts` 注释。
   - 更新 `AGENTS.md`。

3. **Overlay 调整**
   - 根据新的 `model-geometry.yaml` 墙线重新调整 `suppress` 区域。
   - 更新 `curtain_run`、`bay_sill` 坐标以匹配新外墙。
   - 删除或保留 `floor_region`、`glass_infill` 按需。

4. **测试**
   - `npm run test:server`。
   - `python -m pytest scripts/parse_cad_test.py -q`。
   - 启动 dev server + app，正交俯视截图与效果图对比。

5. **提交与归档**
   - 删除 `config/layout/cad-extracted.yaml`（已完成迁移）。
   - 提交 `config/layout/model-geometry.yaml`、overlay 更新、代码引用更新、AGENTS.md 更新。

## 防回归护栏

1. **文件字段守卫**：`scripts/parse_cad_test.py` 中 `test_walls_yaml_output_contains_only_geometry_fields` 与 `test_wall_dataclass_is_pure_geometry` 继续生效，确保模型文件 wall 条目不携带意图字段。
2. **坐标系一致性守卫**：`test_committed_layout_walls_share_frame_with_rooms` 改为读取 `model-geometry.yaml`，确保 walls 与 rooms 同坐标系。
3. **架构铁律守卫**：`test_no_intent_guessing_code_in_parse_cad` 继续禁止 parser 自动分类。

## 不在范围内

- 反向生成 CAD 脚本：本轮只准备文件结构；后续单独项目实现 `scripts/export_cad.py`。
- 新 element type：本轮不新增 wall type，仍通过 overlay 声明玻璃/飘窗。
- 相机取景/spawn 推断、碰撞检测、漫游路线：保持现状。

## 验证步骤

1. `npm run test:server` 通过。
2. `python -m pytest scripts/parse_cad_test.py -q` 通过。
3. 启动前后端，正交俯视截图与效果图轮廓、房间分布一致。
4. 修改 `model-geometry.yaml` 中一个房间坐标，保存后浏览器刷新可见变化。
