# 客厅主灯 R5→R7：10头球泡半吸顶预演（R6 按参数图、R7 修径向排布）

## 状态

`delivery_ready（模型范围）`。独立审美与功能复核均 PASS（R6 轮，review-manifest.json 记录）；安装、承重、换泡路径、真实光度与补光层仍为 site_pending，不可直接转为商品/施工定案。R4 深钟形侧架造型由本轮替换；R1–R5b 模型、截图、评审、DEC 与价格口径全部保留为历史，不删除。

## 本轮输入

- 业主参考图：`/home/tao/.shellboard/uploads/s_LZ63XlvICjQ/image.png`（商品页截图：上部场景图，下部产品图+规格行）。
- 规格行（页面印刷值）：10头 / 1000\*450mm / G9\*10 / 适用18-25㎡。
- 产品图像素测量：前视可见 6 个乳白球泡（上2/中2/下2，宽约195–241px）；黑色灯盘暗像素集中于图幅中段；镀铬弯臂为平滑弧线；双层环布置与10头自洽。
- 业主三项 alignment 决定（2026-10-16）：按图建模、光度缺口登记待 SKU 核验；配色按图（黑灯盘+镀铬臂+乳白球泡）；包络按商品规格（Ø1000mm+总下垂450mm）。

## 与 R4 的差异审计

- **移除/替换**：R4 的单件深钟形乳白灯体（上口Ø780/下口Ø520×深280）、三根暖铜外置吊杆、单条偏心暖铜弧、暖铜配色语言、350mm 总下垂上限。
- **新增**：黑色台阶单灯盘（上盘Ø200×28mm/下盘Ø155×22mm/盘隙5mm+finial Ø18mm）、镀铬小吸顶盘Φ120×H25mm+吊杆120mm+黑色球形关节Ø50mm、10根镀铬弯臂双层布置（上层5根贴 hub 紧内环 r=0.20m 略挑、下层5根垂环 r=0.434m+tiltDeg 12° 近低下高，相邻36°，臂弓0.06m）、10个乳白球泡Ø130mm+镀铬灯头座Ø45×28mm（每球泡一个独立 PointLight）；总下垂448mm、最低点约2.352m、实测AABB x向0.956m/z向0.898m。
- **保留**：电气锚点 (10.80,7.15,h=2.80)、`living_base` 回路、双控、`strong-light-living` 路由、客厅吊顶/HVAC、餐桌与餐吊配置、R1–R4 全部历史证据。
- **显式改判**：`docs/style-guide.md` §十「新主灯保持单件、乳白漫射和克制的铜色结构，不做多头点光组合」被本轮推翻（DEC-2026-10-16-R5 记录理由）。
- **R5 视觉代价**：10头点状球泡的配光结构与项目宽面漫射要求不同；整厅 7,100–8,500lm 口径与 10×G9（估2,800–4,000lm）存在结构性缺口，按业主裁定登记待 SKU 核验，补光层另算。
- **静默失效条件**：若球泡/臂/灯盘的连接只在渲染层成立而厂家无对应结构，模型不构成可安装证据；若真实球泡透光率低或驱动输出不足，渲染亮度不代表光度；若量房发现梁位/承重/风口冲突，需按现场净距重画，不能移电气点位。

## 实现范围

- `config/render/lighting.yaml`：`light_living_dome` 换多头球泡半吸顶声明式配置（R5b 修正值）。
- `shared/types.ts` + `shared/project-render-facts-schema.ts`：新配置类型与 schema（球泡不互穿、臂不穿盘、直径/下垂不超包络、层角不重复、rise/droop 语义）。
- `shared/render/MultiGlobeChandelierGeometry.ts`：浏览器与 GLB/export 共用的声明式几何。
- `shared/render/LightingFixtureBuilder.ts` + `app/src/render/InteriorLightingSystem.ts`：dome 分支按 config style 分流。
- `data/project-render-facts.json` 重新生成；`tests/server/cli-glb-export.test.ts` 断言同步。
- 只修改灯具造型；不改电气点位、回路、双控、家具、客餐厅灯位、吊顶或 HVAC 路由。

## R5b 几何修正（独立复核后）

首版经双复核：功能指标全过，审美复核指出「上层5根上挑」读不出（首版上层球心仅高于上盘中心22.5mm，立面呈「平环+下垂环」）；功能复核指出记录未同步。修正：吊杆60→**120mm**并下移灯盘；灯盘上盘Ø240×25/下盘Ø170×40 改为**上盘Ø270×30/下盘Ø190×45**（总厚80→90mm）；下层球泡中心半径0.42→**0.43m**；臂弓0.05→**0.07m**。修正后上层球心y=2.67m、高于上盘中心约75mm，立面读成双环冠。外包络、最低点、锚点与全部接口不变；DEC-2026-10-16-R5 已补 R5b 条目，首版参数显式取代。

## R6 几何修正（业主产品参数图，取代 R5b 内部分解）

业主审 R5b 后反馈「感觉不太一样吧？」，并提供带制造商标注的**产品参数图**（image-2.png：吸顶盘Φ120/H25、球泡Φ130、整高450、Φ1000）。此前 R5/R5b 依据商品场景照目测建模，与标注不符。R6 逐条修正：球泡Ø**140→130mm**；吸顶盘高 20→**25mm**；灯盘由厚双盘 Ø270×30/Ø190×45+finial Ø24（总90mm）改为**台阶单盘**上盘Ø**200×28**/下盘Ø**155×22**/盘隙5mm/finial Ø**18**（总约50mm）；上层球心由「高于上盘75mm的双环冠」改为**贴顶紧凑冠**（球心 y=2.63m 与球关节同高、仅高于上盘中心约39mm，参数图上层5臂为近环）；下层球心半径 0.43→**0.434m**（环标称外径 0.998m≈Φ1000）；臂弓 0.07→**0.06m**。未变：外包络Ø1.0m×总下垂449mm、最低球泡底 2.351m、锚点、10头5+5@36°、全部电气/回路/双控/MEP/吊顶接口。代价：层间间隙110→84mm、关节球与上盘顶由约4mm间隙变为相切、两处1mm级紧约束（环外径对包络、最低点对 totalThickness）——球泡Ø若回140将触发 schema 包络错误，当前合法但无回退余量。R5b 的「75mm双环冠」结论被 DEC-2026-10-16-R6 显式推翻（产品规格优先于场景照审美推断）。

R6 独立复核：审美 PASS（三症结——球泡过大/灯盘过重/上层环过高——均解决；遗留的臂3D方位与上层环俯仰属参数图不可测量、需业主接受的设计提案）；功能首轮 FAIL 为记录完整性（DEC R6 条目缺失、权威指针与镜像文档停在 R5b），落档 DEC-2026-10-16-R6 并同步 design-datum/object-manifest/fact-table/work-record/review-manifest/procurement/decision-brief record_pointers 后复审通过。

## R8 修复主灯发光链路（业主反馈「这个主灯不会发光吗」）

业主截图显示夜预演下 10 个球泡是 flat 白、无光晕无天花反射。诊断（复现坐实，非猜测）：`App.ts` `setupLightingPreviewPanel` 的 `onModeChange` 以 `setPreviewMode(mode)` 进入手动夜预演，而 `setPreviewMode(mode, manualOn = this.on)` 的默认值取当前 `this.on`——白天 auto 状态下 `autoOn=false` 导致 `this.on=false`，于是 `setInteriorOnlyNightPreview(true)` 把场景变暗的同时**全屋灯具保持全灭**，球泡 emissive 被 `applyVisibility` 压在 `FIXTURE_EMISSIVE_OFF`(0.05)，PointLight 亦不可见。复现截图 `living_main_light_r8_night_off_v001.png` 与业主截图一致（全黑 silhouettes）； carried-preview 路径（`applyLightingPreviewState`）本就正确传 `state.manualOn`，只有交互切模式这一条路漏传。

**修复（app/src/App.ts，一处调用）**：`setPreviewMode(mode, mode === 'manual')`——进入手动夜预演显式开灯（该模式的目的就是看室内照明）；退回 auto 时第二参数被忽略、仍由 syncSolar 的 autoOn 驱动。回归测试落在 `app/src/render/InteriorLightingSystem.test.ts`（15/15 PASS，锁定「dark auto → manual(true) 全灯亮 → auto 复灭」语义；App.test.ts 在本环境既有 DOM 加载失败，故测试放在系统层）。

**修复后验证**：`living_main_light_r8_night_on_v001.png`（同机位）10 球泡全亮、天花有光晕、客厅空间有照明。typecheck（root+app）PASS。发光链路说明：球泡 emissive 走统一 CCT 管线（`applyAppearance` 把 `emissive` 覆写为 3000K 适配色、强度 `FIXTURE_EMISSIVE_ON`=0.21），实际照明由锚点 PointLight(intensity 8×0.6=4.8, distance 7, decay 1.5) 完成——预览亮度是人为校准值，**不得**用于反推照度（光度缺口仍 site_pending）。

R6 只修了尺寸与灯盘结构，**没修径向排布**：上层5球泡环半径 0.38m 与下层 0.434m 接近等宽，双宽平环从任意角度都读成 10 根臂摊平放射（八爪鱼）。参数图实测上层球泡距中心约 ±162mm（贴 hub 紧内环），宽环只有下层一个。R7 修正（一处声明值）：上层 `globeRadius` 0.38→**0.22m**，其余不变。改后侧视/仰视读成「贴顶紧冠+下层垂环」的喷泉形。约束复核：上层球泡内缘 0.155m vs 上盘半径 0.10m（隙 55mm）；相邻上层球泡弦距 0.258m > 球径 0.13m；跨层最小球心距约 0.358m；实测 AABB 变为 x向 0.956m、**z向 0.916m**（上层不再贡献 +z 极值），仍内切 Ø1.0m；最低点 2.351m 不变。DEC-2026-10-16-R7 记录依据与静默失效条件（上层环再调宽 >0.30m 会复发八爪鱼读法；上层球泡与上盘檐 55mm 间隙无 schema 约束）。

R7 验证补充：采集时 `data/presentation-state.json` 窗帘默认态**再次**被应用持久化（R6 的 open→privacy 之后，这次写成 blackout）——同一副作用复发，确认是本环境跑 dev server + 浏览器采集的固有行为而非业主决定；仍按 committed 内容（open / 2026-10-06）写回并重新生成 facts，复跑 verify:all 17/17。后续任何采集轮次都需在交付前检查该文件。

## R8 修复夜预演开灯（业主反馈「这个主灯不会发光吗」）

见上方 R8 节（修复与复现证据齐）。补记：修复后 `verify:all` 与 `gate:visual` 复跑通过；`data/presentation-state.json` 本轮采集**未再**被持久化改写（git status 仅 facts 一个文件）。

## R9 每球泡独立光源（业主要求）

此前 10 个球泡只是 emissive 网格，实际照明只有锚点一个 PointLight（R5 功能复核登记过的局限）。R9：`shared/render/MultiGlobeChandelierGeometry.ts` 导出 `getMultiGlobeGlobeCenters()`，视觉与光源共用同一份球心坐标；`InteriorLightingSystem` dome 分支对 multi_globe 配置按球心建 **10 个 PointLight**（单头 raw 1.2 → 经 `LIGHTING_ENERGY_VISUAL_SCALE` 0.6 后 **0.72/头**，distance 3.5、decay 1.5——10 个 7m 程灯会整屋重叠过曝，故收程让每球照亮各自邻域）。runtime 验证：该灯具 10 个 PointLight 全部落在几何球心（上层 y=2.63、r=0.20；下层 y=2.417~2.581、r=0.434）。回归测试 17/17（含 R9 两测：多球泡 10 灯位置/强度、普通 dome 单灯不回退）。代价：场景 PointLight 总数 +9；预览光照分布**不证明**光度达标，光度缺口仍 site_pending。GLB/export 走 LightingFixtureBuilder（不含光源），导出链不受影响。

## R10 造型对齐参考图（业主要求「对齐一下造型」）

参考图（商品照 image.png + 参数图 image-2.png）前视测量（同一标尺）：**最宽球泡在灯盘高度（≈250mm）、内圈球泡才下垂到≈400mm**；R7 下层平环 5 球同高（2.416m）读不出这个有机簇；上层环 0.22m 亦略宽于参考图实测（±162~225mm）。R10 修正（schema/builder 机制级）：armTiers 新增 `tiltDeg`（绕东西轴，正值向南近侧下垂、北侧抬高）；下层球心基准 -0.384→**-0.31m** + `tiltDeg: 12`（近侧两球下垂至球心≈2.417m、侧球抬至≈2.581m、最低球泡底 2.352m≈450mm 总高）；上层 `globeRadius` 0.22→**0.20m**。schema 的位置计算与逐球校验同步应用倾斜（按各臂实际方位算球心 offset，平环基准值不再够用）。实测 AABB x向 0.956m、**z向 0.898m**、y[2.352,2.800]；前视/仰视读成贴顶紧冠 + 近低下垂的有机簇。R7/R6 的「下层平环」读法被 DEC-2026-10-16-R10 显式推翻（参考图测量优先，半径/头数/包络均不变）。

## R11 等曲度等长10臂模板（业主要求「每个都是一样的曲度弧线长度」）

业主点破根因：R7~R10 的上层 5 臂（臂根上盘檐 r0.10m→球泡 r0.20~0.22m，短臂微挑）与下层 5 臂（臂根下盘檐 r0.0775m→球泡 r0.434m，长臂下垂+tilt12°）是**两套不同的臂几何**——长短、曲直、起止高度都不同，任意角度都读出参差触手；此前只改半径与倾斜，没解决「臂本身不一样」。R11 改为**单臂模板用 10 次**：两层同 `globeRadius` 0.434m、同臂根（下盘檐 r0.0775m、y2.517m）、同 `armBow` 0.06m、`tiltDeg` 归零，仅球心对称 ±0.10m（上 2.617m/下 2.417m）；10 臂按 36° 均布、上下交替（az 0/72/144/216/288 上挑，36/108/180/252/324 下垂）。为给臂根让位，吊杆 0.12→**0.165m**、灯盘随之下移（上盘中心 -0.254、下盘中心 -0.284）。实测 AABB x向0.956m、**z向0.998m**（两层同半径后 ±z 极值由上层 az0 球与下层 az180 球定，标称 Ø1000 在 z 向兑现）、y[2.352,2.800]；runtime 10 个球泡灯全部落在 r=0.434m 统一环（5 盏 y=2.617、5 盏 y=2.417）。R7 的「上层紧内环」与 R10 的「下层 tilt12°」被 DEC-2026-10-16-R11 显式推翻（等长约束下，双层观感由球心对称 ±0.10m+上下交替实现）。代价：上层球泡由贴 hub 紧内环改为统一环（「紧冠」让位「等臂对称冠」）；吊杆加长 45mm 视觉重心略降；tiltDeg 字段置零保留能力。回归测试 17/17（含等长断言：10 灯同半径 0.434m）。

## R11 同版证据（当前在役）

URL `http://localhost:5173/?v=20261016-r11`；underside（仰视）与 front-elevation（前视，从南向北≈参考图朝向）runtime+snapshot+PNG 存于 `evidence/r5/`，PNG 在 `tmp/screenshots/living-main-light/living_main_light_r11_*_v001.png`；R8/R9/R10 修复与迭代验证图 `living_main_light_r8_night_off_v001.png`（复现全黑）/`living_main_light_r8_night_on_v001.png`（修复后球泡全亮）/`living_main_light_r9_per_globe_v001.png`（每球泡光源效果）/`living_main_light_r10_front_v001.png`（R10 倾斜环）。实测 AABB（两份一致）：x[10.322,11.278]、y[2.352,2.800]、z[6.651,7.649]。

历史轮次绑定：R10 `?v=20261016-r10`、R7 `?v=20261016-r7`、R6 `?v=20261016-r6`、R5b `?v=20261016-r5b`、R5 `?v=20261016-r5`（同名 PNG/runtime 已被后续轮次覆盖，历史结论以 DEC 条目与 review-manifest 轮次记录为准）。

## 验证

| 命令 | 结果 |
|---|---|
| `npm run generate:project-render-facts` | PASS，15个灯具事实，lighting.fixtures 为 multi_globe_semi_flush_chandelier |
| `npm run typecheck`（root + app） | PASS |
| `npm run test:server` | 1008 tests / 1000 pass / 8 fail；其中2个由 verify:facts 悬空 DEC 引用连锁（落档 DEC-2026-10-16-R5 后已消除），其余6个为环境/在役改建既有失败（FixtureFactory browser-free lint、BudgetCalculator 候选价门控、墙砖面积三处一致、solar α≤0、TextureManager ×2 `document is not defined`），与本轮改动无关 |
| `npm run test:app` | 554 tests / 498 pass / 56 fail；失败全部为 `ResizeObserver is not defined` / `document is not defined` 的 vitest DOM 环境问题，与本轮改动无关 |
| `npm run verify:lighting-config` | PASS，1个详细灯具配置 |
| `npm run verify:facts` | OK（93 warnings，0 fail；DEC-2026-10-16-R5 落档后悬空引用消除） |
| `npm run verify:all` | R5 落档后 17/17 passed；R5b 配置修正后复跑仍 17/17；R6 配置修正+文档同步后复跑 17/17 passed |
| `npm run gate:visual` | 动手前与 R5b/R6 交付前均 CLEAR：ceiling `50c1c81f9ec8`、electrical `f2b49b7bcdb3`、plumbing `7f1513d14f27`、materials `64176f576326` |
| `npx tsx --test tests/server/cli-glb-export.test.ts` | 13/13 PASS（新增球泡/弯臂/灯头座/灯盘/吸顶盘 part 断言） |

R6 验证补充：`npm run generate:project-render-facts` 重新生成后 verify:project-render-facts 初报 stale——diff 定位为 `data/presentation-state.json` 的窗帘默认态在本 session 跑 dev server + 浏览器采集时被应用持久化（open→privacy，会话开始时该文件不在 modified 列表，属采集副作用而非业主决定），已写回 committed 内容并重新生成 facts，复跑 17/17。

机制级验证补充：`shared/render/MultiGlobeChandelierGeometry.ts` 与 `LightingFixtureBuilder.addDome`、`InteriorLightingSystem.makeDomeFixture` 同源，GLB 导出与浏览器渲染共用；`getSculpturalDomeConfig` 增加 style 守卫，避免两个 dome 变体互相误捕（该缺陷由 cli-glb-export 测试先抓到并修复）。

## R7 同版证据（当前在役）

URL `http://localhost:5173/?v=20261016-r7`；四视图 runtime+snapshot+PNG：underside（仰视）、elevation-profile（立面）、closeup（近景）、context（客厅空间），存于 `evidence/r5/`，PNG 在 `tmp/screenshots/living-main-light/living_main_light_after_r7_*_v001.png`。每张 ready=true、空配置错误横幅、`visualPreviewActive=false`、目标 `electrical:light_living_dome`、非总览相机；hover tooltip 以 patch `HoverTooltip.update` 持久压制。实测 AABB（四份一致）：x[10.322,11.278]、y[2.351,2.800]、z[6.651,7.566]。

历史证据绑定：R6 `?v=20261016-r6`（六视图）、R5b `?v=20261016-r5b`、R5 `?v=20261016-r5`（PNG 已被 r7 同名覆盖、runtime 重写为 R7；各轮结论以 DEC 条目与 review-manifest 轮次记录为准）。

## 独立复核结论

四轮（review-manifest.json 固定 JSON 契约）：
1. R5 首版：审美 PASS（附非阻塞意见：上层上挑量不足、黑灯盘偏薄、包络口径差、underside tooltip、topdown 为全户总览）；功能 PASS（附 requested_changes：AABB 口径入档、内部分解同步、重采 underside+补包络俯视、electrical.yaml 指针、fact-table refs 补齐）。→ 落地为 R5b 几何修正 + 证据重采 + 文档同步。
2. R5b：审美 PASS；功能 FAIL（B1 object-manifest parts 尺寸未同步；B2 DEC-2026-10-16-R5 正文仍写首版比例且被 record_pointers 声明共为权威，权威记录自相矛盾）。
3. R5b 复审：审美 PASS（维持）；功能 PASS（B1/B2 核销，另有三项非阻塞：manifest 版本指针、fact-table 措辞、work-record 回填，均已处理）。
4. R6（业主参数图修正后）：审美 PASS（造型语言与参数图一致，球泡过大/灯盘过重/上层环过高三症结均解决；臂3D方位与上层环俯仰属参数图不可测量、需业主接受的设计提案；要求补 DEC-2026-10-16-R6——已落）；功能首轮 FAIL（又是记录完整性：DEC R6 条目缺失、record_pointers 与全部镜像文档停在 R5b 值），落档 DEC-2026-10-16-R6 并同步 design-datum/object-manifest/fact-table/work-record/review-manifest/procurement/decision-brief record_pointers 后复审 PASS（净距/互穿/接口全部通过且无一项变差：最低点2.351m、北缘净距1.101m、层间间隙84mm、跨层最小球心距0.334m）。
5. R7（业主反馈「还是像八爪鱼」，上层环 0.38→0.22m 纯视觉微调）：目检确认贴顶紧冠+下层垂环的喷泉形，双宽平环放射读法消除；按 playbook §5「纯视觉微调只记一条 DEC + 一个 probe 数」落 DEC-2026-10-16-R7，同步 design-datum/object-manifest/fact-table/work-record/review-manifest 镜像值与实测 AABB（z向 0.944→0.916m），未开新五件套。

## 独立复核/遗留（site_pending）

光度（10×G9 vs 7,100–8,500lm 口径）、承重与梁位、10个G9换泡路径、风口气流、坐姿视线与补光层均未核实；模型范围可供业主继续评估，不可直接转为商品/施工定案。
