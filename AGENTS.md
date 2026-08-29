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

## 坐标系补充约定

- `model-geometry.yaml` 的 `rooms` 使用**中心坐标**：
  - `x` 和 `z` 是房间中心点。
  - `width` 和 `depth` 是房间总尺寸。
  - 西边缘 = `x - width / 2`，东边缘 = `x + width / 2`。
  - 北边缘 = `z - depth / 2`，南边缘 = `z + depth / 2`。
- `model-geometry.yaml` 的 `walls` 使用**角点坐标**：
  - `x1, z1` 和 `x2, z2` 是墙体线段的两个端点。
- 修改房间时，先确定对应的墙体边界，再计算中心点：
  - `x = (west_edge + east_edge) / 2`
  - `z = (north_edge + south_edge) / 2`
- 任何几何修改后，必须运行：
  ```bash
  npm run verify:all
  npm run test:server
  npm run typecheck
  ```
- 修改 `config/house.yaml` 的 `furnishings`（家具摆位）后，必须运行：
  ```bash
  npm run verify:furniture
  ```
  furnishings 条目带 `x/z/rotation` 的为 placed 实例（3D 渲染 + MCP 暴露位置）；无 `x/z` 的为 count-only（只喂预算/库存）。坐标使用 model-geometry 同一局部坐标系（米），预算 counts 由列表 derive（`ProjectCatalog.getFurnishingCounts`），禁止双写。
- `model-geometry.yaml` 采用 v2.0 vertex 格式：rooms 使用中心坐标 (x, z, width, depth)，walls 使用角点坐标 (x1, z1, x2, z2)。几何修改须同时更新拓扑一致性。使用 `scripts/verify/layout/verify-topology.ts` 替代旧的 `validate-room-wall-alignment.ts`。`scripts/archive/` 保留旧脚本供参考。
- `house.yaml` rooms 的 width/length/area 是 `model-geometry.yaml` 的**镜像字段**（预算算量走 layout-resolver，不读这些字段）；gift_areas 的 expected_centroid 同理。几何修改后 `verify-data-consistency`（已含在 verify:all）会列出漂移项，须同步镜像字段。量房修正只改 model-geometry.yaml，再按脚本输出同步。

## 电气/家具修改铁律

- 移动任何电气点位或家具前，必须确认目标墙面是**实体墙**（不在 `overlay.yaml` 的 `suppress` 列表中）。
- 玻璃幕墙（`curtain_run` / 被 suppress 的墙）**不能挂载**：电视、插座、挂件、柜体。
- 家具布局与电气点位必须**交叉验证**：插座位置 ≈ 电器实际位置（偏差 > 1.5m 需报警）。
- 修改前先问："这面墙是什么材质？能打孔/挂重物吗？"
- 修改电气/家具后，必须运行：
  ```bash
  npm run verify:all
  ```
- 挂墙点位（electrical/plumbing）坐标压在墙线上时必须显式声明 `wall_side`，否则渲染默认取墙段左侧，可能渲到房间背面。`verify-data-consistency` 的点位专项会以 error 拦截"渲染面与所属房间异侧"（检查逻辑在 `scripts/verify/placement/verify-point-placement.ts`，与 `HouseScene.projectInfrastructurePoint` 同口径）。

## 碰撞/相机修改铁律

- 新增任何 `SceneElement` 类型时，必须评估是否需要碰撞：
  - 需要碰撞：`wall`, `curtain_run`
  - 不需要碰撞：`floor_region`, `bay_sill`, `railing_run`, `glass_infill`, `shower_screen`
- 碰撞数据提取逻辑在 `app/src/scene/collision-utils.ts`（`extractCollisionWalls`）。
- 修改 `FirstPersonController` 旋转逻辑后，必须跑 `npm run test:app`。
- 修改 `CollisionDetector`、`extractCollisionWalls` 或 `CameraAnimator` 后，必须跑：
  ```bash
  npm run test:app
  npm run verify:all
  ```
- 第一人称 pitch 限制 ±80°，旋转带平滑阻尼。禁止移除 clamp 或改为无平滑直接赋值。
- `CameraAnimator.interrupt()` 必须停在当前位置，禁止跳到动画终点。
