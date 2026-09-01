# 渲染图归档

> **PAUSED / HISTORICAL BLENDER OUTPUTS**：Blender 主线已暂停；本目录保留历史证据，不代表当前 active 渲染入口。后续默认效果预览采用 Web + GPT，Web/CLI GLB 仍用于结构化场景交付。冷归档说明见 `scripts/archive/blender-pipeline/README.md`。

当前正式归档仅保留已确认的正式体验图和决策板引用图；失败预览留在 `tmp/`，不进入正式归档。历史最佳 `living_sofa_glass` SHA-256 为 `a05eef42dd3fdcc1cb96e97a8d078c60e4086ffb0acb62748f4bd9b8ecf9116c`。最后 Luna 最小验证约耗时 24 分钟、15.9k tokens；Eevee 因远端 EGL/性能问题未产出新 PNG，未进入 Cycles。

## 归档目录

- `final-living-daylight-20260831-f/`：客厅白天
- `final-living-20260831-f/`：客厅蓝调/傍晚
- `formal-living-multiview-20260831/`：客餐厅多角度正式决策图（`living_sofa_glass` 客厅局部 + `living_from_sw` 客餐厅关系）
- `final-dining-20260831-f/`：餐厅白天
- `final-kitchen-cooktop-20260831-b/`：厨房真实灶台局部
- `kitchen-overview-20260831/`：厨房整体关系（受遮挡限制）
- `formal-kitchen-pair-20260831/`：当前 bundle 的厨房互补正式图（L 型总览受遮挡 + 灶台材质 detail）
- `final-master-bedroom-20260831-d/`：主卧白天
- `formal-study-dressed-20260901/`：父母房新增正式图，仅作为床品/布局方向的中间证据；不是最终完整效果图
- `hy-study-final-5/`：书房工作区辅助图
- `hy-guestbath-final-5/`：客卫洗漱台辅助图
- `hy-masterbath-final-5/`：主卫辅助图

命名规则：`<版本>__<机位>__<工况>.png`。所有图像用途、相机、场景、尺寸和 SHA-256 以 `data/render-decision-boards.json` 为准。

## 当前已确认正式 PNG

以下文件已进入正式归档，均为 1920×1080；父母房新增正式 PNG 已确认存在：

- `renders/formal-living-multiview-20260831/formal07-living-multiview__living_from_sw__daylight.png` — SHA-256 `086c7219d1755e84388dc286678f92ca5ba4a9581d9f1a68f1da49b3ca5806b0`
- `renders/formal-living-multiview-20260831/formal07-living-multiview__living_sofa_glass__daylight.png` — SHA-256 `a05eef42dd3fdcc1cb96e97a8d078c60e4086ffb0acb62748f4bd9b8ecf9116c`
- `renders/formal-kitchen-pair-20260831/formal23-kitchen-pair__kitchen_l_overview__material_review.png` — SHA-256 `b3a1004c6987271e2db59985752baba378544a9da9b7895d118f03c4c977f1d0`
- `renders/formal-kitchen-pair-20260831/formal23-kitchen-pair__kitchen_cooktop_closeup__material_review.png` — SHA-256 `2cfd5ef91096dae4d80705ef1f6e85597f9b374b9bc96983d7a601fb65d0297c`
- `renders/formal-study-dressed-20260901/formal67-study-dressed__study_overview__material_review.png` — SHA-256 `a1ae9813518dc4ee274e7717587a7ca5edf683c97a7241d0cefde7e90f81cd6d`

## 资产审计状态

- `bed_150` BlenderKit 候选：`REJECTED_CANDIDATE`；原因：多 mesh 尺度/bbox 契约不一致，fallback 正常。

## 当前状态

- 客餐厅：正式图可用于整体方向判断。
- 厨房：仅可用于材料和部分布局判断，不能视为完整厨房审查。
- 父母房：新增正式图已存在，仅作为床品/布局中间证据；仍不是最终完整效果图。
- 其他房间：仍不完整，未达到完整房间效果图门槛。

本轮所有失败预览、失败机位和中间 bundle 均留在 `tmp/`，不进入正式归档，也不加入正式 `views`。已有局部正式图仍按其声明用途保留，不代表对应空间的完整审查已完成。正式归档只接受已确认、路径真实存在且元数据完整的 PNG。
