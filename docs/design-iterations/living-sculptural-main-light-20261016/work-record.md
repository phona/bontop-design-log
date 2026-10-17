# 客厅浅吸顶雕塑主灯

## 当前状态

`delivery_ready（概念模型范围）`。业主已确认造型方向为“偏心暖铜弧 + 乳白漫射盘”，外轮廓定为1000×1000×120mm（外宽×外深×离顶总厚度）；独立审美与功能复核均PASS。SKU、真实光度和施工条件继续待采购/现场核验。

## 事实基线

- `light_living_dome` 当前锚点为 `(10.80, 7.15, 2.80m)`，3000K，回路 `living_base`。
- 客厅中部为 2.80m 原顶；灯位在北缘边吊以南的平顶区。
- 当前餐桌中心为 `(9.80, 3.45)`，临时六人布局南移 0.32m；灯锚点距当前桌心约 3.83m。
- 用户批准的视觉包络为外宽1.0m、外深1.0m、从原顶向下总厚度0.12m；这是建模尺度，不是SKU/施工尺寸。
- 项目要求宽面漫射、3000K、Ra≥90、客厅一般活动约100lx/U0≥0.7；餐桌局部约150lx。客厅流明目标存在 7,100–8,500lm 与公式约9,287.5lm的算术冲突，SKU/光度结论未冻结。
- `DEC-2026-10-13-R1` 以宽面吸顶灯替代原集中窄束轨道方案；本轮只重开可见造型，不推翻光学约束。style-guide §十一“客厅建议取消独立主吊灯”也由业主新偏好重开，旧理由保留。

## 门禁和基线证据

- `npm run gate:visual`: `CLEAR`，ceiling `50c1c81f9ec8`，electrical `f2b49b7bcdb3`。
- Browser URL `http://localhost:5175/`，title `和萃 701 - 3D 装修设计`，`window.__APP__.isReady()=true`，配置错误横幅为空。
- Target `electrical:light_living_dome` 存在，runtime `fixtureType=dome`；当前画面为通用约400mm半球。
- Baseline screenshot: `tmp/screenshots/living-main-light/living_main_light_before_v001.png`；相机为 orbit，但已聚焦在主灯，不是全屋 overview。

## 已授权范围

1. 实现共享灯具几何，让浏览器和GLB复用同一造型。
2. 保留现有电气锚点、回路、控制和MEP路由。
3. 更新 DEC 与风格口径，列明重开的旧结论、保留的工程约束及静默失效条件；保留已研究的候选与证据。
4. 重跑视觉门禁并采集同机位 before/after；对客厅近景、侧视和俯视做独立审美与功能复核。
5. 保留实际SKU、光度、承重、梁位和驱动维修方式为候选商品/现场待核；不从渲染点光源推断真实照度。

实际SKU、光度、承重、梁位及驱动维修方式不在本轮造型定稿范围内，继续按现场/候选商品待核；不得把渲染点光源强度作为照度证据。

## 实施与最终复核（2026-10-16）

### 完成内容

- `light_living_dome` 的渲染外形从约400mm通用半球改为声明式浅吸顶造型：1000×1000×120mm外包络、920mm乳白盘、一条向南偏置100mm的缎面暖铜弧。浏览器和GLB/export共用 `shared/render/SculpturalDomeGeometry.ts`。
- 保留灯位 `(10.80, 7.15, 2.80m)`、3000K、`living_base` 回路、双控、`strong-light-living` 路由、客厅HVAC与餐桌对象；没有改电气、HVAC、吊顶或家具配置。
- 发现并修复暖铜弧在运行时被刷成乳白色的问题：`MeshStandardMaterial` 的默认 `emissiveIntensity` 为正值，`InteriorLightingSystem` 会把这类材质收进漫射罩更新集合。给灯壳和暖铜材质显式设置 `emissiveIntensity: 0`，漫射盘继续保留发光更新。正式运行时现确认暖铜构件 `color=9a6948`、`emissiveIntensity=0`，乳白盘 `color=f7f7f2`。
- 当前灯体外轮廓在模型中最高点齐原顶2.80m，最低点约2.68m；其z范围约6.65–7.65m，北缘HVAC设备带止于z=5.55m，配置层位无直接交叠。此为模型包络核对，不代替现场梁位、底盒承重与厂商净距确认。

### 验证与审查

- `npm run typecheck`：PASS。
- `npm run verify:lighting-config`：PASS，1个详细灯具配置。
- `npm run gate:visual`：CLEAR；ceiling `50c1c81f9ec8`、electrical `f2b49b7bcdb3`、plumbing `7f1513d14f27`、materials `64176f576326`。浏览器页面为 `http://localhost:5175/?v=20261016-r2`，ready=true、配置错误横幅为空、正式灯光预览状态为 `visualPreviewActive=false`。
- 未运行测试套件；本轮执行了类型检查、现有灯具配置校验和要求的视觉门禁。
- 独立审美复核：PASS。暖铜弧已从浅色接缝变成可辨识的偏心构件；1m盘在2.8m层高下形成客厅焦点；客厅灯、沙发、HVAC边吊和餐桌关系清楚，餐桌未驱动灯位。
- 独立功能/接口复核：PASS。共享浏览器/GLB几何、1m包络、现有电气和MEP接口得到核对。无自动AABB或碰撞报告，包络结论来自共享几何源码、schema约束和runtime尺寸。
- 施工复核仍为现场待核：尚无实测梁位、顶板/接线盒承重、实际固定底盘、灯体重量、驱动更换和漫射盘拆装资料。

### 最终截图与运行时证据

- 客餐厅三分之四视角（灯具、沙发、HVAC带、餐桌同框）：`tmp/screenshots/living-main-light/living_main_light_after_context_view_v010.png`；runtime `evidence/living_light_context_runtime.json`，快照 `evidence/living_light_context.snapshot.txt`。
- 客厅顶视（确认1m包络及沙发/餐桌关系）：`tmp/screenshots/living-main-light/living_main_light_after_top_down_v008.png`；runtime `evidence/living_light_topdown_final_runtime.json`，快照 `evidence/living_light_topdown_final.snapshot.txt`。
- 低位侧剖（确认浅吸顶厚度与弧线投影）：`tmp/screenshots/living-main-light/living_main_light_after_elevation_profile_v002.png`；runtime `evidence/living_light_elevation_profile_runtime.json`，快照 `evidence/living_light_elevation_profile.snapshot.txt`。

### 文档差异与保留项

- 删除了 `object-manifest.yaml` 中已失效的“当前尺寸未知、禁止实现几何”注记，因为尺寸已由业主确认且几何已落地；对应决定和旧基线仍保存在 `fact-table.yaml`、`decision-brief.yaml` 与DEC记录中。
- 将本轮交付范围内的`blocking_issues`清空，并把原两项未决——客厅流明口径、现场承重/梁位/维修方式——明确列为SKU冻结或施工前的 `follow_up_site_pending`。它们仍阻止采购/施工定案，但不阻止已批准造型进入概念模型。
- 未删除商品候选、价格口径、光通量冲突、轨道灯淘汰证据、餐桌关系或旧截图；旧“客厅不设独立视觉主灯”结论由DEC-2026-10-16-R1重开，历史依据保留。
- 新造型可能静默失效的条件：漫射盘实际输出/配光不足；浏览器与GLB绕开共享生成器；改变电气锚点却未同步拓扑与MEP；灯壳或铜件误设为发光材质导致运行时颜色被覆盖；固定承重或检修方式不适配实际顶板与候选SKU。

实际SKU、真实流明与照度、Ra/U0、梁位/承重、驱动维修方式仍待业主、灯具供应商、电工和现场量房核实。本轮结果只交付项目模型中的概念造型。
