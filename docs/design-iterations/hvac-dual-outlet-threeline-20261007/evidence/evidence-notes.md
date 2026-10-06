# Evidence Notes — 客餐厅三层线风口（DEC-2026-10-07-R03）

- 渲染链：源码 dev（`PATH=$PWD/node_modules/.bin bash scripts/dev.sh`：server :4000 + vite :5175）+ headless Chromium 152（CDP :9222，`--remote-allow-origins=* --enable-unsafe-swiftshader`）。
- 截图脚本：`scripts/render/capture/capture_hvac_ld_threeline_views.py`（CDP `Runtime.evaluate` 设相机 + `Page.captureScreenshot`）。轨道模式默认极角钳位会把低机位相机推高，脚本在页面内放开 `controls.maxPolarAngle≈π` 后按人视高度（1.30–1.60m）截图；相机状态由 `getCameraState()` 回读记录。
- 说明：业主此前的 electrical.yaml 红色横幅来自旧 `app/dist` 构建；本次全部用源码 dev 渲染，未出现该横幅。

## 视角清单与机位（回读值）

| 文件 | 视角 | 相机 position | controls target |
|---|---|---|---|
| view1-living-band-main.png | 客餐厅主效果图（客厅侧看向设备带，南→北） | (9.90, 1.60, 7.70) | (10.40, 2.42, 5.00) |
| view2-from-living-to-dining.png | 从客厅看餐厅（越过设备带北缘看餐区/餐桌） | (12.90, 1.58, 7.20) | (7.80, 2.25, 3.40) |
| view3-from-dining-to-living.png | 从餐厅看客厅（餐桌位看向客厅侧与设备带） | (7.90, 1.52, 3.60) | (12.90, 2.42, 5.60) |
| view4-band-closeup.png | 设备带近景·仰视（底面前侧下出风 + 后侧回风两条线） | (10.30, 1.30, 7.55) | (10.15, 2.56, 5.15) |

## 图纸

- d1-plan-correspondence.png：脚本 `scripts/render/diagrams/draw-hvac-ld-threeline.py`（读 config/hvac.yaml + ceiling.yaml，.venv 需 matplotlib）生成——设备带三层线平面：功能段实心（各自归属一台机器）、装饰段斜纹封闭标注、机器机身占位（外廓待厂家图）、机器↔风口对应虚线。
- d2-ceiling-section.png：同脚本生成——剖面 A-A（x=10.30 穿 71T2：功能上出风 + 功能下出风 + 封闭装饰回风段）与剖面 B-B（x=7.90 穿 42T2：功能上出风 + 功能下出风 + 功能回风/检修），含 2.80 原顶、参考梁底 2.73、边吊 0.30/净高 2.50、设备带进深 0.90 标注。

## 运行时校验（scripts/render/diagrams/draw-hvac-ld-threeline.py（同源数据；运行时尺寸校验：npx tsx scripts/render/diagrams/ld-threeline-runtime-check.ts），buildHvacGeometry over data/project-render-facts.json）

- 可渲染 terminal 共 22；客餐厅 14 个对象全部 `render_style=linear_slot`，8 个 `LD-deco-*` 全部 `decorative=true`。
- 连续性：下出风行 z=4.85 与回风行 z=4.45 均为「功能段 + 封闭装饰段」拼满 x[7.20,13.40] 无缺口；南立面装饰 [7.20,9.70]+功能 [9.70,13.20]，北立面功能 [7.70,9.70]+装饰 [9.70,13.40]（两端正交交接不贴百叶）。
- 尺寸：功能段框宽=length+0.016（端帽），送风排高 0.15 / 回风排高 0.25（grille_height 生效）。

## 验收对照

1. 完整设备带：view1/view4 中侧面为一条连续百叶线，底面为两条连续线（无孤立矩形成品框）。
2. 送回风独立：d1/d2 中 71T2↔supply_living/supply_living_bottom/return_living，42T2↔supply_dining/supply_dining_bottom/return_dining，装饰段标注封闭无风道。
3. 三层平行对齐同语言：z=5.20/4.85/4.45 三层、同 matte_black linear_slot。
4. 吊顶总体结构未变：几何/标高/梁体/机位未动（verify:all Exit 0）。
5. 可交施工深化：d2 剖面节点含标高/进深/段域坐标，段长与合同名义尺寸差异登记 site_pending（q1）。
