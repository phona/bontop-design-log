# 项目铁律（AI 会话必读）

## 当前施工状态

- **当前状态：尚未交房，硬装、水电、吊顶和空调均未施工。**
- 设计预演允许比较需要拆改天花或迁改 HVAC/冷凝水的方案；评估时不得以“已施工、拆改成本高”作为否决理由。
- 历史记录中的“已施工/拆改成本”判断仅作为历史背景，不自动作为当前方案约束。
- 若后续状态变化（交房、量房、墙体/机电/窗帘施工、入住），由业主更新本节；更新前的状态是设计讨论和验证的唯一当前口径。

## CAD / 3D 渲染架构

> Blender 主线已暂停并冷归档到 `scripts/archive/blender-pipeline/`；本文件中的 Blender-specific 约束仅在明确恢复冷归档时适用。几何、坐标、电气、家具、碰撞与数据一致性铁律始终有效。
>
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

## 计划阶段采购预研铁律

本项目尚未交房不等于不能做商品决策。采购研究必须先于采购推荐；量房、接口和本地报价用于验证或反转推荐，**不得**成为把具体候选退化为泛称、只给施工原则或停止竞品研究的理由。

- 涉及商品、品牌、型号、供应商或价格比较时，必须使用 `shopping-research`：先写项目需求 brief，再真实探索、搜索和详情核验候选，并按信息增益继续扩展至收敛或明确阻塞。禁止以配置文件、历史模型、搜索摘要或常识直接伪造“专业买手推荐”。
- 每个一期采购组的交付必须区分三层：
  1. **项目硬约束**：来自当前控制源的预算、数量、接口、阶段与现场前提；
  2. **研究支持的首选/备选**：具体品牌/系列/型号或 SKU、候选链接、已观察的规格与价格口径、为何胜出/淘汰；
  3. **现场反转条件**：哪些复尺、燃气、水电、结构、安装或报价事实会改选。
- “SKU 未选”“展示价不可比”“尚未交房”只能降低推荐强度，并要求写明下一步核验；不能删除具体首选、竞品、取舍或把未证实的推断写成事实。
- 采购推荐必须比较同口径的版本、数量、地区与全安装成本。设备裸价、券价、国补、运费、安装、辅材、增项、税费、交期和保修责任必须分列；不同口径必须明确“不可直接比较”。不得把默认 SKU、起价、套餐价、MOQ 或营销文案当成成交结论。
- 质量、耐用、售后和“官方/授权”只有在本次可追溯证据支持时才能写为事实；没有 reviews 能力时必须标为未验证。允许基于结构/规格做推断，但必须标注为推断和理由。
- `schedule/procurement.md` 是唯一的业主采购入口，不得拆出多份面向业主的矩阵、状态表或排障日志。每个采购组内应以可扫读小标题保留简洁证据摘要（平台/链接、观察时间、状态、规格、价格类型/口径），而非删除证据后只剩泛称。浏览器/CDP 排障只保留为该采购组的一句阻塞说明或在会话中处理。
- 任何声称“可支持购买决策”的采购文件，至少要能回答：买什么具体候选、为何优于关键竞品、预计总成本及其未知边界、品质/性能/维护/视觉取舍、什么事实会反转推荐，以及下一步由谁核验。做不到时只能称为范围/询价计划，不能称为商品采购决策。
- 在重写、压缩或美化采购文档前，先检查是否保留以上三层和竞品原因；禁止为了减少文件、避免表格或增强可读性而丢失已研究的具体候选、证据口径或淘汰理由。

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
- `model-geometry.yaml` 的 wall 条目可带 `structure`（`shear`/`fill`/`curtain`/`new_partition`）+ `structure_status`（`confirmed`/`inferred`），由 `resolveWall` 透传给 lint。`verify:mep` 据此检查非法凿墙/穿梁：穿剪力墙报 `shear_wall_penetration`（双 confirmed 升 error）；`hvac.yaml` 的 `reference_constraints` 转 `confirmed` 且带 `reference_beam_bottom_y` 后，高于梁底的走线报 `beam_collision` error；穿越实体墙必须逐墙声明 `penetration` 且穿点与实际交点偏差 ≤0.25m。墙体结构分类依据与施工口径见 `docs/mep-construction-guidance.md`。

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

## 渲染性能铁律

- 玻璃材质默认禁用 `transmission`（会触发 three.js 全场景二次渲染，draw call 翻倍），走 `transparent + opacity` 快路径；高保真仅在导出/取证时经工具栏「玻璃质感」开关临时开启。新增玻璃类材质必须走 `BrowserSceneMaterials.registerGlass` 注册，禁止直接写死 `transmission > 0`。
- 静态 unit 经 `SceneBatcher` 跨 unit 合批为 `BatchedMesh`：电气点位（`electrical:*`）、装饰层 plumbing marker、HVAC 实体（`HVAC_CONFIRMED_ENTITIES`）、铰链门。**家具不合批**（碰撞分析需逐 unit 改 emissive）；滑动门、窗帘、灯具等有动态行为的不合批。新增需要动态改材质/显隐/开合的零件不得加入合批 scope，或在 mesh 上标 `userData.noBatch`。
- 合批后拾取走 `batchId → batchUserData` 桥接（`targetFromIntersects`）；unit 级显隐用 `batcher.setUnitVisible` 桥接；统一换色用 `batcher.updateScopeMaterials` 桥接（见 `setDoorMaterial`）；`hvac-export-check` 已识别批次元数据，统计实体时不要绕过它直接遍历场景。
- GLB 导出前后必须 `restoreStaticBatches` / `reapplyStaticBatches`（GLTFExporter 不认 BatchedMesh），且 restore 必须先于 `getHvacExportStatus`。
- 修改 `SceneBatcher`、`SceneMeshMerger` 或玻璃材质链路后，必须跑：
  ```bash
  npm run test:app
  npm run typecheck
  ```
