# 夜景色彩、全屋铺向与主走廊涂装范围

**迭代 ID：** `visual-calibration-floor-angle-20261015`
**当前状态：** `delivery_ready`（2026-10-15）。

## 业主确认

- 夜景同时保留原始 CCT 色度和肉眼适应，默认肉眼适应。
- 地砖角度滑块全屋统一；0°为当前方向，90°转为南北向；角度只用于临时预演。
- 主走廊独立声明实际墙面涂装；吊顶也归主走廊并独立计墙顶涂装。
- 业主在看到工作区再次回退到 `semantic_only` 后，明确选择“按刚才决定，恢复独立涂装”。现行配置已按此恢复。

## 实现

- `HouseScene` 固定 sRGB 输出、`NeutralToneMapping` 和 exposure=1；灯光预演在 raw CCT 和 eye-adapted 之间切换，默认 eye-adapted。
- 夜景手动模式仍只保留室内灯；亮度滑块仍是相对渲染倍率，不标注为 lux/流明。
- 全屋地面颜色贴图和法线贴图随 0–90°角度旋转；存在粗糙度贴图的材质同步旋转。A 保存 0°、B 保存 90°；正式地材选择未变。
- `house.yaml` 为主走廊声明 `wall_finish: paint`。`overlay.yaml` 只声明 3 段与主走廊相邻的实体墙脸：`w_strip_east [0,1.25]`、`w_st_north [0,3]`、`w_nw_south [1.6,3]`。门洞沿用几何源的 `d_mb`、`d_study`、`d_bnw` 自动扣除；开放边不生成涂装面。
- `ceiling_main_corridor` 归属 `main_corridor`，原 `[4.20,4.30,7.20,5.55]` 投影、3.75㎡面积、厚度和标高不变；新增对应 `paint_ceiling_region`。
- 修复 `shared/finish/scene.ts`：finish-scope 场景采集显式加载 ceiling config，并把显式 `ceiling_zone_solid` 的 `roomId` 纳入有顶面网格的房间集合。此前 collector 未传吊顶分区，semantic-only 房间的真实吊顶因此触发错误的“顶面无网格”告警。
- 按业主单独授权完成的 MEP YAML 语法修复也保留在本次交付链：DEC 文案并入原 `reason` 字符串，没有改路线坐标。此文件已有 0-error lint 结果；最后一次 `verify:mep` 为 0 errors、129 warnings，其中 26 条被 verifier 分到交底前必须清除，82 条待量房复判，21 条包络近似/非物理警告。

## 并发回退与决策审计

- 工作区曾在业主确认独立涂装后，再次移除 `house.yaml` 的 `wall_finish` 和 `overlay.yaml` 的三条墙面、一条顶面声明。业主随后明确选择恢复；本记录和当前权威配置均按该最新答复执行。
- 历史迭代 `continuous-band-1250-20261015` 记录其当时移除主走廊涂装的决定，保留为历史证据，不改写旧轮次；本迭代明确 supersede 其涂装范围结论。
- 本轮没有删除或移动墙体、门洞、灯位、家具、几何坐标、正式墙漆色号、正式地砖选择或灯具 SKU。新增的 3 面和 1 顶是对既有表面的饰面声明，不是新增实体。
- 本轮将屏幕默认显示从 raw CCT 切换为 eye-adapted；raw CCT 对照仍保留。被推翻的是“4000K/60%默认显示仍明显琥珀”的旧判断，该判断仍适用于 raw CCT 对照模式。
- fact-table 里原先用现在时写的“渲染器依赖 Three.js 默认设置”和“Kelvin 走旧经验式 RGB 映射”已改成变更前历史事实，并补上当前 NeutralToneMapping 与 CIE/Planckian 映射；保留原理、数值边界和旧截图来源，不把旧实现误写成现状。
- 旧 work-record 的“等待业主选择恢复或保留 semantic_only”段落已由本轮最终决定、恢复记录和门禁结果取代；并发回退作为历史事件保留，不再表示当前阻塞。

## 验证

- `npm run generate:project-render-facts`：通过，投影出 15 个灯具条目。
- `npm run verify:finish-scope`：0 errors、0 warnings；11 条 `paint_over_opening` 信息确认门洞会由现有 split 逻辑裁切。
- `npm run verify:all`：17/17 通过；MEP 0 errors、129 warnings。
- `npm run verify:mep`：0 errors、129 warnings；告警分桶为 26 条交底前必须清除、82 条量房后复判、21 条包络/近似类。
- `npm run typecheck`：通过。
- `VISUAL_GATE_API=http://127.0.0.1:5173 npm run gate:visual`：CLEAR。
- 最后一轮 `verify:all`（2026-10-15 09:24:55–09:25:08 UTC）再次 17/17。其前的同源窗口（09:09:59–09:10:11 UTC）为 `verify:all` 17/17、`typecheck` PASS、`gate:visual` CLEAR；此后只补充了范围量事实和审计文档，没有改代码或权威配置。
- 当前浏览器重载后 `ready=true`、`/api/project` 200、无配置错误/离线提示。4000K、60%、手动仅室内灯时，global ambient/directional 为 0、environment 为 null，15 个室内灯仍在场。
- 当前源码运行时找到主走廊 8 个墙漆网格（由三段墙面和既有门洞切分而成）和 5 个 `ceiling_zone_solid`；顶面 room id 为 `main_corridor`。涂装层按 inspection-only 约定默认隐藏，打开“涂漆区”后 8 个主走廊网格均显示。
- `/api/budget` 200；paint comparison preview 将主走廊拆出墙面净面积 10.15㎡、顶面 3.75㎡，共 13.90㎡。该接口标为 `comparison_overlay_only`，不并入当前 `totalActual` 或分类合计。
- 全屋有 15 个地面 mesh。实际操作滑块验证 0°时 15 个颜色贴图、15 个法线贴图为 0；90°时均为 π/2，11 个粗糙度贴图也同步为 π/2。A=0°、B=90°，正式 floor selection unchanged。
- 同机位夜景截图和 runtime 对照：默认 eye-adapted 为 `#fff3e9`，raw CCT 为 `#ffd3a5`；两组均为 4000K、60%、仅室内灯。
- 本轮没有运行测试套件；只运行了用户授权的配置验证、typecheck 和视觉门禁。

## 独立复核

- 审美复核 `PASS`：默认 eye-adapted 明显减轻 raw CCT 的橙黄；木纹、家具和颜色层次可辨，没有冷白漂移。0°/90°方向差异清楚，可用于铺向预演。结论只覆盖屏幕视觉。
- 功能复核 `PASS`：当前 house/overlay/ceiling 声明与 runtime mesh 数量、门洞裁切、房间侧及 ceiling owner 一致；finish collector 修复只补全显式 ceiling zone 的房间归属采集。没有请求改动。
- 两位复核均指出的限制已记录在下节：raw CCT 本身仍偏暖；眼适应不等于真实光谱/照度；只有具备 roughness map 的地面材质才会旋转该贴图。

## 仍然适用的限制和静默失效条件

- 4000K 屏幕表现是 CIE/CCT 色度近似与 70% D65 混合，不是 SPD/IES、照度、显色指数或实物白点测量。换灯具、材料实测色变化或重新打开全局光后，视觉结论可能变化。
- 地砖方向预演旋转可用的贴图；当前没有 roughness map 的材质不会产生粗糙度方向旋转，因此不是完整物理材质重排，更不代表现场砖缝排版。
- 房间边界、三面墙的线段/门洞、房间侧或 ceiling owner/投影变化时，现有 `along` 范围和顶面匹配可能失效；必须重跑 finish-scope。
- finish-scope collector 必须继续显式加载 ceiling zones，并识别 `ceiling_zone_solid.roomId`。若新增另一种顶面实体却未纳入 collector，semantic-only 房间可能再次被误判为没有顶面。
- 业主可通过涂漆区图层检查声明面；该图层默认隐藏。工作区 `config/house.yaml` 与 `overlay.yaml` 被并发回退过一次，最终交付以本记录对应的当前 source version、运行时和复核结果为准。
