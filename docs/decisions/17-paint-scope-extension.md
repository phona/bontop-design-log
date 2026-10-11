# 决策日志 · 涂装范围与门禁编排

> 本文件收录涂装范围（墙/顶/窗台）扩展、以及门禁编排相关决策。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-09-G01` 门禁编排器取代 `&&` 链（已计入 `16-verify-gate.md`，此处不重复）
- `DEC-2026-10-09-P02` 涂装范围扩展到显式顶面与上飘窗外露面，并修正顶面多计 7.726㎡
- `DEC-2026-10-09-P03` 上飘窗涂装精度与几何口径修正：逐段 round3 累加改内部全精度、底面映射与 bay_sill 本体对齐、审计分水平/立面
- `DEC-2026-10-09-P04` 全部上飘窗纳入涂装范围：主卫刷防霉漆独立计价，其余 8 处按普通漆；预算侧补算漏记的窗台面积
- `DEC-2026-10-09-P05` 相邻上飘窗端面去重：背靠背的内部接缝按「算 0 次」剔除，并留档包围盒测量的错误
- `DEC-2026-10-09-P06` 建立 `verify:finish-scope` 面层范围核查层（F01–F04），查出 2.741㎡ 面层双计含一处 C18 后 stale 瓷砖声明
- `DEC-2026-10-09-P07` 业主裁定「砖漆互斥 + 不能悬空」：F01–F04 全升 error，修 6 处声明、删 1 处 stale 瓷砖声明
- `DEC-2026-10-09-P08` 吊顶纳入面层核查：新增 F05/F06，业主确认铝扣板不刷漆
- `DEC-2026-10-09-P09` 厨房上飘窗终裁改贴砖（竖面+底面），`sill_region` 的 face 枚举扩为 front/top/underside
- `DEC-2026-10-09-P10` 两个「名实不符」飘窗按方案 A 改名：只改 id，不动几何/面积/room
- `DEC-2026-10-09-P11` 新增 F07 面层不得盖住门/窗洞，修 3 条 stale 瓷砖声明共 1.05㎡
- `DEC-2026-10-09-P12` 非房间地面进预算：`floor_region` 加 `costed`，主走廊 3.75㎡ 计入、设备平台不计
- `DEC-2026-10-09-P13` 新增 F08 面层声明必须附着在 3D 实体（回答「漆面是不是飘在空中」）
- `DEC-2026-10-09-P14` 修 `sill_region` 弧墙悬空：弦中点改沿折线逐段出网
- `DEC-2026-10-09-P15` 修 `wall_region`/`paint_region` 弧墙悬空 + 新增 F09 网格几何附着核查
- `DEC-2026-10-09-P16` 地面算量从 `costed` opt-in 改为几何驱动 opt-out：`excluded` 只留给例外，双计风险从根上消失

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-10-09-P02 涂装范围扩展到显式顶面与上飘窗外露面，并修正顶面多计 7.726㎡

- **日期**：2026-10-09。触发：codex 会话额度用完，业主让我接手其未提交的「涂装范围扩展」改动并收口。
- **问题（口径缺陷，不是精度问题）**：原 `paint_region` 只声明墙面，顶面面积由实现侧按「有墙面声明的房间」取**满 footprint**，既不显式也不扣除非涂装顶面。实测后果：客卫 3.15㎡ 与主卫 4.576㎡ 的顶面**整间都是铝扣板**（`ceiling_guest_bath` / `ceiling_master_bath`），却被当成普通乳胶漆顶面计费，**多计 7.726㎡**。主卫上飘窗（`master_bath_west_bay`）的外露底面/前缘/端面则完全没有任何声明与算法。
- **可选方案**：
  - ① 只改数字不改结构（否决：口径仍在实现里，下次加房间还会漂）；
  - ② 顶面也写成 `paint_region`（否决：与墙面共用一种声明，无法表达「按房扣非涂装投影」）；
  - ③ **两类新声明 + 一个纯函数模块**（选定）。
- **选定方案**：
  - **`paint_ceiling_region`（7 段）**：显式顶面涂装范围，按房取 footprint 后**扣除该房 `aluminum_buckle` 投影**（矩形精确并集，重叠只扣一次）。7 间 footprint 合计 110.95 − 7.726 = **103.224㎡**。
  - **`paint_sill_region`（1 段）**：主卫上飘窗，`faces: [underside, front, start_end]`、`finish: wet_area`。新模块 `shared/paint-sill-scope.ts`（纯函数）只算**显式声明**的面：底面用 bay_sill outline 鞋带公式；前缘/端面按**吊顶完成面**裁垂面（`ceilingFinishY`），完成面以下记 `occludedAreaSqm`；与声明墙完全重合的端面剔除并 push 指名 warning。
  - **湿区单独计价**：`PaintScopeResult` 新增 `sillAreaByRoom` / `ordinarySillAreaSqm` / `wetAreaSqm` / `ordinaryAreaSqm` / `sillSurfaces`。**湿区窗台不按普通墙漆费率计费**——`netAreaSqm`（267.337，全部涂装面）与 `ordinaryAreaSqm`（263.139，普通漆计费口径）分开，预算行项目与成本情景取后者，湿区状态 `pending_system_quote_and_site_validation`。守恒：`ordinaryAreaSqm + wetAreaSqm = netAreaSqm`。
  - **3D 侧**：飘窗外露面作为 `inspectionLayer: 'wall-paint'` 网格进涂漆区高亮，`highlightedIn3d` 由 `walls_only` 改 `walls_and_declared_sill_faces`。
- **接管中发现并修掉的两个真实 bug**（均在 codex 未提交 diff 里，非既有代码）：
  1. **`app/src/render/HouseScene.ts` TDZ**：`grossByRegion` 在 1146 行声明、1137 行使用。真实场景里一点「涂漆区」检视按钮，飘窗外露面网格（`face ≠ 'wall'`）走进该分支即 `ReferenceError`，整个审计崩掉。既有 533 个 app 测试全没抓到——mock 的网格全是 `face === 'wall'` 的旧形状。修法：声明上移到循环前。
  2. **`shared/render/BaySillGeometry.ts` `reverse()` 原地反转**：`[...outerLeft, ...outerRight.reverse()]` 把 `outerRight` 本身也翻掉，而它随即被作为 `wallPath` 返回 → `wallPath` 与 `frontPath` 方向相反 → `start_end`/`end_end` 被配成**横跨整条窗台的 1.803m 斜肢**（1.046㎡）而非两端的 1.1m 端面（0.638㎡），违背声明 reason「西端面」的本意。修法：反转副本。影响 `wallPath` 只被 `paint-sill-scope.ts` 消费，爆炸半径限死。窗台合计 **4.606 → 4.198㎡**。
- **接管中补的登记与测试**：
  - `scripts/verify/collision/verify-collision-coverage.ts` 的 `nonCollidableTypes` 漏登记两种新类型 → 该 verifier 直接 fail-closed 报 8 个 `unknown element type`（这正是它该干的事，但也说明**新增 overlay 类型必须同步登记**）。已补，并加注释说明三类涂装声明为何是非碰撞体。
  - 新功能**零测试**：新建 `tests/server/paint-sill-scope.test.ts`（8 项，含独立鞋带公式 + 解析闭式 + 20 万点数值积分三重对账、6 处变异全部被咬）；更新 `tests/server/paint-scope.test.ts` 与 `paint-comparison-api.test.ts`（含一条从 config 现算顶面的独立复算：`total + (3.15+4.576) ≈ 110.95`、`110.95 − total ≈ 7.726`）；修 `app/src/scene/HouseScene.test.ts` 与 `OverviewMenu.test.ts` 的 mock（真实布局几何 + 新 scope 字段）。
- **决策依据**：顶面 103.224 由独立复算证实（`resolveLayout` + `loadCeilingConfig` + overlay 声明现算，与实现逐分一致）；窗台 4.198 由修复后的几何现算（start_end = 1.1 × 0.58 = 0.638）；预算/报价折算全部改用 `ordinaryAreaSqm`，多乐士 55 元/㎡ 对照从 ¥13,510.53 更新为 ¥14,472.65。
- **预算影响**：普通漆计费面积 270.865 → 263.139㎡（−7.726㎡），`painting.actual` 8212.10 → **7977.02** 元；湿区窗台 4.198㎡ 单独计价，费率与材料系统**待现场核验与分项报价**，未计入普通漆金额。
- **关联文件**：`config/layout/overlay.yaml`（+42 行，2 类 8 段声明）、`shared/paint-sill-scope.ts`（新增）、`shared/paint-scope.ts`、`shared/render/{BaySillGeometry,SceneBuilder,CeilingZoneBuilder,layout-bounds}.ts`、`shared/types.ts`、`server/{overlay-merge,paint-cost-comparison,routes}.ts`、`app/src/render/HouseScene.ts`、`app/src/ui/OverviewMenu.ts`、`scripts/verify/collision/verify-collision-coverage.ts`、`tests/server/{paint-scope,paint-comparison-api,paint-sill-scope}.test.ts`、`app/src/scene/HouseScene.test.ts`、`app/src/ui/OverviewMenu.test.ts`、`README.md`、`config/facts.yaml`、`docs/decisions/README.md`、本文件。
- **决策人**：业主（授权接管 codex 未完成工作）+ AI 执行。
- **验证**：`test:server` **839/839**、`test:app` **533/533**、`typecheck`（根 + app）干净、`verify:facts` OK（39 warning）、`verify:all` **14/15 通过**——唯一失败是既有的 `verify-consistency`（`sock_child_ac` 卡空调厂家深化图，先于本次改动，归属已证实）。`verify-collision-coverage` 由 8 error 转 OK。
- **后续议题**：① 湿区窗台的材料系统/基层适配/人工需现场核验后分项报价（`wetAreaStatus` 跟踪）；② `paint_sill_region` 目前只声明了主卫一处，其余上飘窗（西北次卧/主卫北墙等）是否纳入需业主逐处裁定；③ 声明的 `2.07/0.76m` 飘窗尺寸本身是待复尺值。

---

### DEC-2026-10-09-P03 上飘窗涂装精度与几何口径修正：逐段 round3 累加改内部全精度、底面映射与 bay_sill 本体对齐、审计分水平/立面

- **日期**：2026-10-09。触发：P02 落地后复核发现三个口径缺陷——面积算错、3D 盖错位、审计公式套错面。
- **问题（三个都是口径错，不是精度不够）**：
  1. **逐段 round3 再累加会系统性放大误差**：`shared/paint-sill-scope.ts` 原对每个折线段 `round3(area)` 后再求和，弧段折线的每段宽度是无理数量级，误差单向累积——真实主卫上飘窗汇总成 **4.198㎡**，而浏览器独立三角网格复算只有 **4.193365㎡**（差 0.0046㎡，全是高估）。
  2. **涂装底面与 bay_sill 本体不同位同形**：`SceneBuilder` 给 `paint_sill_region` 底面（flat ShapeGeometry）只写了 `rotation.x = -PI/2`，没做 bay_sill 本体那套 `scale.y = -1`——平面 Shape 的第二个坐标被翻成负值，真实飘窗脚印 `z=[1.10,2.20]` 被打到 `z=[-2.20,-1.10]`。**预算里算了 2.536㎡ 却盖不到目标实体**，业主在 3D 里看到的高亮面和算钱的面不是同一块。
  3. **审计把水平面当墙面算**：审计用「面积÷高」反推段长时没区分朝向，把 4.198㎡ 的水平底面套成 **4,198,000,003.81m**。
- **选定方案**：
  - **全精度内算、汇总才 round3**：`areaSqm` / `occludedAreaSqm` 内部保留全精度，只在 `totalAreaSqm` / `areaByFinish`（给业主看的口径）处 round3。修正后 **4.193㎡**，与独立三角网格复算一致。
  - **平面→世界映射收敛为单一函数**：新增 `applyPlanFootprint(mesh)`（`rotation.x = -PI/2` + `scale.set(1,-1,1)`），bay_sill 本体与 `paint_sill_region` 底面**共用**——从结构上保证「算钱的面」与「模型的实体」重合，杜绝再次分叉。
  - **审计面加朝向与标高**：mesh userData 增 `surfaceOrientation: 'horizontal' | 'vertical'` 与 `bottom` / `top`；水平面只有面积有意义，不得套墙的面积÷高公式。
- **决策依据**：4.193㎡ 由浏览器独立三角网格复算（4.193365㎡）对账；底面重合由共用同一映射函数保证；审计朝向由 `surfaceOrientation` 显式声明。
- **预算影响**：湿区窗台 4.198 → **4.193㎡**；全部涂装面 267.337 → **267.332㎡**；毛涂装面 282.142 → **282.137㎡**。**普通乳胶漆计费面积不变（263.139㎡）**、`painting.actual` 不变（7977.02 元）——湿区窗台本就单独计价，精度修正只影响湿区那一行。
- **关联文件**：`shared/paint-sill-scope.ts`、`shared/render/SceneBuilder.ts`、`app/src/render/HouseScene.ts`、`app/src/ui/OverviewMenu.test.ts`、`tests/server/{paint-sill-scope,paint-sill-scene,paint-scope,paint-comparison-api}.test.ts`、`README.md`、本文件。
- **决策人**：并行会话实施（commit `4e6c763`），业主授权后由 AI 补登记本 DEC 并校正文档数字。
- **验证**：`test:server` **869/869**、`test:app` **564/564**、`typecheck` 干净、`verify:facts` OK、`verify:all` **14/15**（唯一失败是既有的 `sock_child_ac`）。测试已钉 4.193㎡；`README.md` 与两处测试字面量由 4.198/267.337 校正为 4.193/267.332（原靠 ±0.02 容差掩盖）。代码注释中保留的「4.198㎡」均为**旧值说明**（记载曾用口径），非现行口径。
- **后续议题**：湿区窗台 4.193㎡ 的材料系统/基层适配/人工仍待现场核验与分项报价；`paint_sill_region` 仅声明主卫一处，其余上飘窗是否纳入待业主裁定。

---

### DEC-2026-10-09-P04 全部上飘窗纳入涂装范围：主卫刷防霉漆独立计价，其余 8 处按普通漆；预算侧补算漏记的窗台面积

- **日期**：2026-10-09。触发：业主要求「所有上飘窗都算上」，并指出「主卫的上飘窗需要刷防霉漆，更复杂」。
- **问题（覆盖面只有 1/12）**：overlay 有 12 个 `bay_sill`，其中 3 个防水台已由 `sill_region`（贴砖）覆盖、1 个主卫上飘窗有 `paint_sill_region`，**其余 8 个没有任何涂装声明**——漆面统计只覆盖十二分之一。按主卫那处的量级（约 4.2㎡/个）推算，8 个漏算约 25–35㎡，属实质性预算口径缺口（P02 后续议题② 已登记，本条落地）。
- **选定方案**：
  - **8 处全部补 `paint_sill_region` 声明**，`finish: ordinary`；`faces` 取**精确面集**（与 `wallCoversCap` 实测一致：被实体墙盖住的端面不声明）。未采用「声明全 4 面让算法排除」的方案——那会产生 11 条「已排除」warning 并流入 `/api/paint/comparison` 的 warnings 与 UI 警告列表，而 warning 本该意味着「需要关注」。`wallCoversCap` 安全网保留：将来几何变化导致声明面被墙盖住时照常 warning，提示声明过期。
  - **主卫上飘窗改刷防霉漆**：`finish` 由 `wet_area` 改名 `anti_mold`（全仓约 45 处触点：枚举、`PaintScopeResult.antiMoldSqm`、API scope、UI 行、测试），中文措辞由「湿区涂装」改为「防霉漆涂装（漆种/遍数/基层防霉处理）」——`antiMoldStatus: pending_system_quote_and_site_validation` 不变，仍单独计价、不进普通漆金额。
  - **room 按几何归属**：`bedroom_nw_west_bay` 的 outline x[0,1.1]×z[2.1,2.86] 整块落在 master_bath 矩形内（bedroom_nw 西界是 x=2.6）、`corridor_west_bay` 整块落在 master_bedroom 矩形内（走廊本体是 x[4.2,7.2]×z[4.3,6.45]）——**id 命名与几何不符**，两处均按几何归属并在 reason 里显式标注「名实不符待核」。房间归属决定吊顶遮挡用哪间房的 zone（主卫铝扣板完成面 2.65 会遮住约 0.5㎡），不能按名字猜。
- **决策依据**：43.097㎡ 普通漆窗台 + 4.193㎡ 防霉漆窗台由 `computePaintSillScope` 逐面实算（与 3D mesh 同一 outline）；普通计费面积 263.139 → 306.236㎡。
- **预算影响（重要）**：修复一处**预算侧漏算**——`server/budget-calculator.ts` 的 `loadPaintScopeAreaByRoom` 原先只加「净墙 + 顶面」，**完全没加窗台面积**，导致预算行项目比 `/api/paint/comparison` 的 `ordinaryAreaSqm` 少 43.097㎡（被 `paint-scope.test.ts` 的守恒断言「预算行项目合计必须等于普通计费面积」抓住）。已修：改为「净墙 + 顶 + 普通漆窗台」，房间集合取两者并集（厨房只有窗台声明、无 `paint_region`，按并集才进预算）。`painting.actual` 7977.02 → **9284.15** 元。
- **关联文件**：`config/layout/overlay.yaml`（+8 段声明、主卫 finish 改名）、`shared/paint-scope.ts`（新增 `ordinarySillAreaByRoom` / `antiMoldSillAreaByRoom`）、`server/overlay-merge.ts`（枚举）、`shared/types.ts`、`shared/paint-sill-scope.ts`、`server/paint-cost-comparison.ts`（API scope 暴露分房面积 + 告警措辞）、`server/budget-calculator.ts`（预算面积含窗台）、`app/src/render/HouseScene.ts`、`app/src/ui/OverviewMenu.ts`、`tests/server/{paint-scope,paint-comparison-api,paint-sill-scope,paint-sill-scene}.test.ts`、`app/src/ui/OverviewMenu.test.ts`、`README.md`、本文件。
- **决策人**：业主（「都算上」+ 主卫防霉漆）。
- **验证**：`test:server` **869/869**、`test:app` **564/564**、`typecheck`（根 + app）干净、`verify:facts` OK、`verify:all` **14/15**（唯一失败是既有的 `sock_child_ac`）。`scope.warnings` 为 0（精确声明不产噪音）。
- **后续议题**：① `kitchen_north_bay` 已由业主 2026-10-09 裁定「按统一刷漆价格先算」→ 维持 `ordinary`；业界做法留档于该声明 reason（厨房/飘窗窗台首选贴砖，与厨房墙砖连续、耐油污；若维持刷漆应加阳角条并升级厨卫/外墙漆，普通内墙乳胶漆在厨卫窗台并不合适），将来改贴砖需改挂 `sill_region` 并从 `ordinaryAreaSqm` 移出；② ~~`bedroom_nw_west_bay` / `corridor_west_bay` 的 id 命名与几何归属不符~~ **已由 DEC-2026-10-09-P10 关闭**（按方案 A 改名为 `master_bath_west_lower_bay` / `master_bedroom_west_mid_bay`，只改 id 不动几何）；原始不符情况留档：前者整块落在 master_bath 矩形、后者整块落在 master_bedroom 矩形，git 考古显示两者分属不同 commit 引入（`8440e60` 走廊西墙飘窗 depth 0.5/sill 2.55、`096bad8` 西北次卧西墙飘窗），后被统一为 depth 1.1/sill 2.07/h 0.76；③ **西墙幕墙两个 bay_sill 声明重叠 0.110㎡**（`master_bath_west_bay` z[1.10,2.20] vs `bedroom_nw_west_bay` z[2.10,2.86]，sill/height 完全相同 → 同一高度带双重声明，两处都已声明 paint_sill_region 故被双计），已登记 `docs/pending-site-data.md` #57；④ 上飘窗是异形面（水平+立面混合），普通漆按平墙费率计价可能偏低，费率口径待报价轮确认；⑤ 9 处飘窗的 `sill/height/depth` 仍为待复尺值，得房后复尺重算。

---

### DEC-2026-10-09-P05 相邻上飘窗端面去重：背靠背的内部接缝按「算 0 次」剔除

- **日期**：2026-10-09。触发：业主确认「得做一些去重」后，追问「是因为曲面角吗」，据实核查发现此前两版根因描述都不准确，遂重做测量并落地去重。
- **测量纠错（重要，留档防止再犯）**：此前两版数字都是**包围盒相交**，不是真相 polygon 相交——
  - v1 报「重叠 0.110㎡」：拿 master_bath_west_bay 与 bedroom_nw_west_bay 的**包围盒**相交（1.1×0.10）
  - v2 报「双计 0.186㎡」：在 v1 基础上加了一个用首末点当弦算的前缘面重叠，同样不实
  - **真相**：用 2mm 网格在两多边形交叠区采样，全部 12 个 bay_sill 两两普查——真相 polygon 相交只有两处、
    各 **0.002148㎡**（`bedroom_nw_west_bay↔master_bath_west_bay`、`master_bedroom_west_bay↔master_bedroom_south_bay`）。
    另两处「重叠」是异高度带（防水基座 sill 0/h 0.15 vs 飘窗台 sill 2.07/h 0.76），不同面、不冲突。
  - **教训**：轴对齐包围盒相交会严重高估；裁一个多边形必须用**另一个多边形的真实边**，且裁剪方向搞反
    （拿矩形去裁复杂多边形）就会静默退化成包围盒相交。已用网格采样交叉验证。
- **主体双计在端面，不在 footprint**：三对相邻飘窗在分界线上各自声明了 `start_end`/`end_end`，
  而两个盒体在该线**背靠背**（一个在南、一个在北），那张端面是内部接缝、不外露：
  | 相邻对 | 分界线 | 双方各计的端面 |
  |---|---|---|
  | `master_bath_west_bay` ↔ `bedroom_nw_west_bay` | z=2.10 | 0.638㎡ × 2 |
  | `corridor_west_bay` ↔ `master_bedroom_west_bay` | z=5.55 | 0.836㎡ × 2 |
  | `master_bedroom_south_bay` ↔ `master_bedroom_west_bay` | z=8.80（主卧 SW 圆角） | 0.638㎡ × 2 |
  合计双计 **4.224㎡**，占原全部涂装面 310.429㎡ 的 **1.36%**。
- **圆角的作用是减小而非造成重叠**：西北角 `v_bath_nw` radius 1.00，弧从西墙切点 (0,2.10) 到北墙切点
  (1.00,1.10)；resolver 按设计把弧划归 `w_bath_north` 所有并把 `w_west_ap` 修剪成零长段（正确行为）。
  圆角把西墙起点从 z=1.10 推到 z=2.10，才使 footprint 重叠从 1.21㎡ 缩到 0.002148㎡。
- **选定方案**：新增 `shared/paint-sill-scope.ts` 的 `bayCoversCap` + `dedupeAdjacentBayCaps`，
  与既有 `wallCoversCap` 同构——端面与**另一个 bay_sill 的轮廓边完全重合**即判为内部接缝并剔除，
  留指名 warning 经 `/api/paint/comparison` 与 UI 可见（不静默改数）。只认**完全覆盖**：部分重合
  （如防水基座只盖住 0.15m）说明该面仍有外露部分，不能整张排除。
- **为什么两张都剔除而不是留一张**：业主 2026-10-09 裁定「算 0 次」。几何上两个盒体背靠背，
  该面朝向室内那一侧被对方盒体占满，没有外露面可计；若两张都留则是把同一张内部接缝计两次。
- **数字**：全部涂装面 310.429 → **306.205㎡**；普通计费 306.236 → **302.65㎡**；防霉漆 4.193 → **3.555㎡**；
  普通窗台 43.097 → **39.511㎡**；`painting.actual` 9284.15 → **9175.09** 元；
  报价对标：总价 16842.98 → 16645.75 元，vs 计划 +5145.75、vs 业主目标 +5645.75、vs 涂装模型 +3859.5。
- **关联文件**：`shared/paint-sill-scope.ts`（+`bayCoversCap`/`dedupeAdjacentBayCaps`）、
  `server/paint-cost-comparison.ts`（接去重、传全部 bay_sill 轮廓而非仅已声明的）、
  `tests/server/{paint-scope,paint-comparison-api}.test.ts`、`README.md`、本文件。
- **决策人**：业主（「算 0 次」）。
- **验证**：`test:server` **869/869**、`test:app` **564/564**、`typecheck`（根+app）干净、
  `verify:facts` OK、`verify:all` **14/15**（唯一失败是既有 `sock_child_ac`）。
  `scope.warnings` 现有 6 条，全部是内部接缝剔除（测试断言 `/excluded as an internal seam/` 全匹配，
  不允许夹带别的问题）；合成场景（无 bay_sill）warnings 仍为空。
- **后续议题**：① 真相 polygon 相交残留 0.0043㎡（两处各 0.002148㎡，位于 x[1.00,1.10] 的弧端扫掠区）
  仍待复尺定弧端收口；② 上飘窗是异形面，普通漆按平墙费率计价可能偏低；③ 9 处飘窗尺寸待复尺。

---

### DEC-2026-10-09-P06 建立 `verify:finish-scope` 面层范围核查层（F01–F04），并查出 2.741㎡ 面层双计

- **日期**：2026-10-09。触发：业主问「漆跟瓷砖都有 linter 了吗」——答案是**都没有**。
  防穿模有 P01–P04 + 专职 linter，漆和砖只有测试没有 linter。业主指出根因：
  「不然你每次都得开浏览器，而且也看不太出来」——漆是 inspection-only 半透明叠加层，
  要开开关转视角，且「压了 0.3㎡」肉眼判不了，浏览器核对面层归属不可行。
- **命名**：原拟 `verify-finish`，只说了领域没说要查什么（对比 `verify-penetration` 是拿
  问题命名）。改 **`verify-finish-scope`**——与项目既有 `paint-scope` / `paint-sill-scope` /
  `paint_region` 的「scope」词汇一致，且「scope」正是本层查的东西：每片面层声明圈了多少地。
- **结构**（照 `shared/penetration/` 同构）：
  `shared/finish/{types,rules,registry}.ts` + `config/finish-lint.yaml` +
  `scripts/verify/finish/verify-finish-scope.ts` + `tests/server/finish-scope.test.ts`。
  已登记进 `scripts/verify/verify-all.ts`（门禁 15 → 16 个 verifier）与 `package.json`。
- **规则**：
  | 规则 | code | 查什么 |
  |---|---|---|
  | F01 | `finish.wall_finish_overlap` | 同一面墙、同一房间（=同侧）、水平与竖向区间都相交 → 该面被计两次。跨房间是双面涂漆，合法不报 |
  | F02 | `finish.sill_finish_duplicate` | 同一 bay 元素的同一个面被漆（paint_sill_region）与砖（sill_region）同时声明 |
  | F03 | `finish.paint_duplicate_same_side` | 同一面墙同一房间同侧两段 paint_region 的 along 相交 → 纯计量重复 |
  | F04 | `finish.paint_outside_room` 等 4 个 code | along 端点须落在声明房间的 boundary **多边形**上；挂 suppress 墙或定位失败显形 |
- **查出现状 8 条 warning、合计 2.741㎡ 双计**（此前手工只查到 7 条 2.868㎡，且竖向区间算错）：
  - **7 条漆压砖**（2.291㎡）：主卫/客卫的 0.30m 砖带与台盆防溅带被同侧漆声明整面覆盖。
    声明 `reason` 写「按桶吸收」——已核：6 桶面漆覆盖 302.65㎡，减掉这些量仍是 6 桶，说法成立。
  - **1 条砖压砖（0.45㎡）——真 stale 声明**：`walltile_kitchen_ent_hood_wall`（烟机后挡水砖，
    along[1.27,2.17] 竖向[0.90,1.40]）整块落在 `walltile_kitchen_ent_west`（同墙 along[0.5,2.9]
    竖向[0,2.65] 满铺）内。后者 reason 写明「C18 废止杂砖后整段正砖」——即 C18 已废止杂砖带、
    改整段正砖，R11 为填「油溅裸墙缺口」而补的 hood_wall 从此多余，却一直没删。
- **一个必须记下来的字段歧义**：`height` 在 `paint_region` / `wall_region` 里的语义是
  **顶面标高**，不是「高度」——`shared/paint-scope.ts` `const top = region.height ?? wall.height ?? 2.8`；
  SceneBuilder wall_region 分支 `PlaneGeometry(span, element.height - bottom)`、
  `position.y = bottom + (element.height - bottom) / 2`。字段名有歧义但两侧一致。
  本层第一版按 `bottom + height` 算，把竖向区间整体上移，导致 `vanity_splash` 重叠从 0.248
  虚报成 0.825、hood_wall 从 0.45 虚报成 1.26。已改口径并加回归测试钉住
  （`walltile_gbath_east_vanity_splash` bottom 0.77 / height 1.10 → 竖向[0.77,1.10]，
  reason 原话「0.77 台面 → 1.10 镜柜下沿」）。
- **房间归属用 boundary 多边形不用包围盒**：本户型有两对房间包围盒相交而多边形不重叠
  （主卧×西北次卧 2.304㎡、客餐厅×入户花园 1.300㎡，已用 2mm 网格复算真相交均为 0）。
  用包围盒判「墙属于哪个房间」会误判，F04 因此一律走多边形。
- **severity 一律先 warning**：配置只许加严不许放宽；`config/finish-lint.yaml` 的 `waivers[]`
  **当前为空**——2.291㎡ 的漆压砖是已知项但尚未经业主书面确认，所以先让 warning 显形，
  不预设豁免。确认后按 `pair + reason/owner/expires` 补登记，到期自动复活。
- **关联文件**：`shared/finish/{types,rules,registry}.ts`、`config/finish-lint.yaml`、
  `scripts/verify/finish/verify-finish-scope.ts`、`scripts/verify/verify-all.ts`、`package.json`、
  `tests/server/finish-scope.test.ts`、`config/facts.yaml`（coverage 登记 5 个字段）、
  `docs/decisions/README.md`、本文件。
- **决策人**：业主（要求建 linter）。
- **验证**：`test:server` **878/878**、`test:app` **564/564**、`typecheck`（根+app）干净、
  `verify:facts` OK（41 warning）、`verify:all` **15/16**（唯一失败是既有 `sock_child_ac`）。
  `verify:finish-scope` 0 error / 8 warning。
- **后续议题**：① 厨房 `walltile_kitchen_ent_hood_wall` 是 C18 后的 stale 声明，建议直接删除
  （0.45㎡ 瓷砖双计），待业主确认；② 2.291㎡ 漆压砖的「按桶吸收」需业主书面确认后转入
  `waivers[]`；③ 本层尚未覆盖吊顶（paint_ceiling_region vs aluminum_buckle zone），
  当前扣减只在 `computePaintScope` 内部做、无独立复核。

---

### DEC-2026-10-09-P07 业主裁定「砖漆互斥 + 不能悬空」：F01–F04 全升 error，修 6 处声明 + 删 1 处 stale 瓷砖声明

- **日期**：2026-10-09。触发：P06 建完 `verify:finish-scope` 报出 8 条 warning 后，业主裁定两条规则级口径：
  **「砖跟漆应该是互斥的」**、**「不能悬空的」**。
- **裁定落地**：
  - F01 `finish.wall_overlap`（漆压砖/砖压漆）、F02 `finish.sill_finish_duplicate`（同元素同面漆砖双声明）、
    F03 `finish.paint_duplicate_same_side`（同侧重复涂漆）→ 一律 **error**。一片墙 either 刷漆 or 贴砖，
    不存在 P06 记录里那种「按桶吸收」的中间态。
  - F04 `finish.paint_room_binding`（along 端点须落在声明房间 boundary 多边形上）→ **error**。
    这正是「漆面悬在过道上」的几何判据；过道区没有 room，漆挂上去端点会离所有房间边界都远。
  - 配置只许加严不许放宽，四条同时从 warning 升 error 符合该铁律。
- **修声明让门禁回绿**（不是加豁免掩盖）：
  - **6 处 `paint_region` 加 `bottom`，让出砖带**（漆从砖带顶面起算）：
    `paint_master_bath_w_mbath_east` / `paint_master_bath_w_mbath_south` / `paint_guest_bath_w_gbath_east` /
    `paint_guest_bath_w_gbath_west` / `paint_guest_bath_w_gbath_west_open_vanity` 均 `bottom: 0.30`
    （让出 0.30m 防水砖带）；`paint_guest_bath_w_gbath_east_open_vanity` 因被**两条**砖带
    （墙裙 [0,0.30] 与台盆防溅带 [0.77,1.10]）夹住，**拆成上下两段声明**：
    `_lower`（[0.30,0.77]）与 `_upper`（[1.10,2.80]）。
    各声明 reason 已把「按桶吸收」的旧口径改写为「砖漆互斥不重叠」。
  - **删 `walltile_kitchen_ent_hood_wall`**（R11 补的灶台后挡水砖）：C18 废止杂砖后东墙改
    `walltile_kitchen_ent_west` 整段正砖到 2.65，挡水条 along[1.27,2.17]×竖向[0.90,1.40]
    整块落其内，属 **C18 之后的 stale 重复声明**，多计 0.45㎡ 瓷砖。删除不影响任何漆面计算。
- **连带修正两处测试不变量**（都因「同房间同墙上下分段」变成合法而失效）：
  - `paint-scope.test.ts` 的「同一面墙每个涂漆面必须是不同房间」→ 改为真实不变量
    **「同墙同房的两块平面不许共面」**（竖向带重叠才会 z-fighting）；同一段声明被门洞拆出的多块跳过。
  - `paint-scope.test.ts` 的 L2 独立复算：原假设漆刷整面高，现改为「可漆跨长 × 层高 − 同 (wall,room) 的部分高砖带面积」，
    其中「到顶砖」（height ≥ 2.6）整跨剔除。复算仍只读 model-geometry boundary + overlay wall_region，不读 paint_region。
  - `paint-comparison-api.test.ts` 的「每个 entry.top === 2.80」→ 改为「top > bottom 且净面积为正」
    （客卫开放洗漱区东墙下段 top 是 0.77，不是 2.80）。
- **数字**（普通漆计费面积因让出砖带而下降）：
  | 指标 | P06 后 | P07 后 |
  |---|---|---|
  | 毛墙面 | 172.430 | **172.430**（不变，声明跨长未动） |
  | 净墙面 | 157.850 | **157.850** |
  | 门洞占位 | 14.580 | **14.580** |
  | 普通计费 | 302.650 | **300.585㎡** |
  | 全部涂装面 | 306.205 | **304.140㎡** |
  | 防霉漆 | 3.555 | 3.555（不变） |
  | `painting.actual` | 9113.11 | **9113.11** |
  | 报价总额（55 元/㎡） | 16532.18 | **16532.18** |
  注：净墙/门洞占位不变是因为让出的是 0.30m 砖带所在的竖向区间，而毛/净墙按声明跨长×全高算，
  真正变化的是**漆面净面积**（客卫 −1.342㎡、主卫 −0.723㎡，合计 −2.065㎡）。
- **关联文件**：`config/finish-lint.yaml`（四条规则 severity → error + note 补裁定）、
  `shared/finish/registry.ts`（IMPLEMENTED_RULES 同步）、`config/layout/overlay.yaml`（6 处加 bottom、
  1 处拆两段、删 1 条 stale 瓷砖声明）、`tests/server/{finish-scope,paint-scope,paint-comparison-api,wall-tile-inspection}.test.ts`、
  `README.md`、本文件。
- **决策人**：业主（「砖跟漆应该是互斥的」「不能悬空的」）。
- **验证**：`test:server` **878/878**、`test:app` **564/564**、`typecheck`（根+app）干净、
  `verify:facts` OK（41 warning）、`verify:all` **15/16**（唯一失败是既有 `sock_child_ac`）。
  `verify:finish-scope` **0 error / 0 warning**。
- **后续议题**：① 吊顶仍未纳入本层（`paint_ceiling_region` vs `aluminum_buckle` zone 无独立复核）；
  ② 业主要求「统一刷漆价格先算」的厨房上飘窗，其漆/砖归属仍待终裁（当前按 ordinary 计）；
  ③ `waivers[]` 仍为空——现在没有已知豁免项，这是好事。

---

### DEC-2026-10-09-P08 吊顶纳入面层核查：新增 F05（顶面归属未登记）/ F06（铝扣板越界），确认铝扣板不刷漆

- **日期**：2026-10-09。触发：业主问「吊顶也是要刷漆面的吗」，并确认「铝扣板就不用刷漆了吧」。
- **吊顶面层现状（已逐房间核实）**：
  | 类别 | 房间 | 顶面 |
  |---|---|---|
  | 刷漆（5 间） | living_dining 44.580 / master_bedroom 26.844 / study 12.750 / bedroom_nw 9.600 / bedroom_se 9.450 | `drop` + `ac_indoor` 石膏板，整间 footprint 全算漆面，合计 **103.224㎡** |
  | 不刷（3 间） | master_bath / guest_bath / kitchen | `aluminum_buckle` 铝扣板 |
  | 无吊顶（2 间） | balcony / elevator_shaft | 无 ceiling zone |
  | 出范围（1 间） | entry_garden | 有 `drop`（3.64㎡）但 DEC-2026-10-08-C06 已把 4 段声明删除（开发商已做好） |
  `drop`（降板区）与 `ac_indoor`（空调内机区）同材质，与 2.80 平顶一起整间算漆面，所以这 5 间顶面面积 = 房间 footprint、无扣减。
- **业主裁定**：**铝扣板不用刷漆**。据此 F05 对「整间铝扣板的房间」豁免。
- **新增规则**（均 error）：
  - **F05 `finish.ceiling_finish_unaccounted`**：房间**在涂装范围内**（有 `paint_region`）且吊顶里有**非铝扣板** zone，却没有 `paint_ceiling_region` → error。
    失败模式是**静默少算**：`computePaintScope` 的 `ceilingAreaByRoom` 只对有声明的房间建项
    （`ceilingRoomIds` 来自声明），漏声明的房间顶面一律按 0 计，不报错也不告警。
    两类豁免：整间铝扣板（业主裁定不刷）；完全不在涂装范围（如 entry_garden）。
  - **F06 `finish.buckle_zone_outside_room` / `buckle_zone_room_unknown`**：铝扣板矩形须整块落在声明房间内。
    `computePaintScope` 用「zone ∩ 房间矩形」扣减顶面漆面积，zone 越界则扣减口径错——多扣（扣到邻居头上）或少扣。
- **一个已存在的不对称，裁定后保留**：master_bath / guest_bath **显式声明** `paint_ceiling_region`（净面积记 0），
   kitchen **不声明**。理由是主卫/客卫有墙漆声明（在涂装范围内），顶面不刷这个决定必须登记在案；
  厨房整间都没漆（墙全贴砖、北墙玻璃幕墙），顶面不刷是顺带结果。F05 按「有没有 `paint_region`」
  判定在不在涂装范围，正好复现这个不对称而不误报。
- **关联文件**：`shared/finish/rules.ts`（+`checkCeilingFinishUnaccounted` / `checkBuckleZoneOutsideRoom`，
  输入加 `ceilings` / `roomRects` / `ceilingPaintRooms` / `wallPaintRooms`）、`shared/finish/registry.ts`、
  `config/finish-lint.yaml`、`scripts/verify/finish/verify-finish-scope.ts`（接入 `loadCeilingConfig`）、
  `tests/server/finish-scope.test.ts`（+5 条，含铝扣板豁免与出范围豁免的负例）、`README.md`、本文件。
- **决策人**：业主（「铝扣板就不用刷漆了吧」）。
- **验证**：`test:server` **883/883**、`test:app` **564/564**、`typecheck`（根+app）干净、
  `verify:facts` OK（41 warning）、`verify:all` **15/16**（唯一失败是既有 `sock_child_ac`）。
  `verify:finish-scope` **0 error / 0 warning**，规则数 F01–F06 六条，配置与实现互为镜像。
- **后续议题**：F06 目前只校验铝扣板越界，尚未独立复算顶面漆面积（第二套算法对账）；
  `drop` / `ac_indoor` zone 只作「这个房间有石膏板吊顶」的证据，其自身矩形不参与扣减。

---

### DEC-2026-10-09-P09 厨房上飘窗终裁改贴砖（竖面 + 底面），`sill_region` 的 face 枚举扩为 `front`/`top`/`underside`

- **日期**：2026-10-09。触发：业主问「厨房上飘窗这种，业界里最佳实践是什么？有论文或者手册什么的参考吗」，
  终裁「好，那就贴砖」，并补一条通用判据——**「以现实使用的合理度为准」**。
- **标准侧查证结果（如实登记，不夸大）**：
  - 有依据的：**GB/T 11228-2008《住宅厨房》**管厨房墙面砖高度（贴 1.2–1.5m 覆盖溅水区）；
    **GB 50210《建筑装饰装修工程质量验收标准》**管饰面砖/涂饰质量；**JGJ 367-2015《住宅室内装饰装修设计规范》**
    含窗台细部；**GB 50327-2001《住宅装饰装修工程施工规范》**管工艺；**T/CBDA 1-2017《住宅装饰装修工程技术规程》**。
  - **没有查到任何国标条文直接规定「厨房窗台必须贴砖」**。业界做法（非条文）：厨房/飘窗窗台首选贴砖、
    与厨房墙砖连续、阳角海棠角收口；若刷漆需加阳角条并升级厨卫/外墙漆（普通内墙漆在西晒与油污下易开裂起皮）。
  - **所以本条不是规范强制，是工序经济性 + 现状一致性判断**，已按此登记。
- **决定性事实（不是规范，是现状）**：厨房三面可贴墙已贴砖（`walltile_kitchen_*`）、
  北墙 `w_kit_north` 是 `suppress_kitchen_north` 玻璃幕墙（不可贴）、全厨房零 `paint_region`——
  这处上飘窗是全厨房**唯一需要定面层的面**。给一间接了墙砖工艺的房间单独开一套刷漆工序
  （找平 + 阳角条 + 厨卫漆）不经济；贴砖只是瓦工顺手带一段。
- **立面裁定（含业主原话）**：竖面与底面**都贴**。业主：「底面肯定要的，以现实使用的合理度为准」。
  该飘窗 sill 2.12m，底面朝下、抬头可见，只贴竖面会留约 3.96㎡ 没人管的面。
- **实现**：
  - `shared/types.ts` 与 `server/overlay-merge.ts` 的 `sill_region.face` 枚举由 `'front' | 'top'`
    扩为 **`'front' | 'top' | 'underside'`**。
  - `shared/render/SceneBuilder.ts` 新增 `face=underside` 分支：几何必须与 `paint_sill_region` 的
    underside **同源**——`buildBaySillGeometry` 的 footprint + `applyPlanFootprint` 映射
    （只写 `rotation.x` 会把 z 翻负，真实飘窗脚印 z=[1.10,2.20] 曾被打到 z=[-2.20,-1.10]，
    导致预算算了面积却盖不到实体）。平面标高 = `target.sill`。
  - `config/layout/overlay.yaml`：删除 `paint_kitchen_north_bay`（`paint_sill_region`，ordinary），
    新增 `silltile_kitchen_north_bay_front` 与 `silltile_kitchen_north_bay_underside` 两条 `sill_region`。
- **数字**（厨房上飘窗整块移出涂装范围）：
  | 指标 | P08 后 | P09 后 |
  |---|---|---|
  | `paint_sill_region` 段数 | 8 | 8（厨房那条本就是第 9 条，现删） |
  | 普通漆窗台 | 39.511 | **33.643㎡** |
  | 普通计费 | 300.585 | **294.717㎡** |
  | 全部涂装面 | 304.140 | **298.272㎡** |
  | `sillAreaByRoom` | 含 kitchen 5.868 | **kitchen 消失** |
  | 报价总额（55 元/㎡） | 16532.18 | **16209.44** |
  | vs PKG-080 计划 | +5032.18 | **+4709.44** |
  | `painting.actual` | 9113.11 | **8934.91** |
  | 瓷砖总面积（wall-tile 检视） | 25.201 | **31.717㎡**（+front 2.556 + underside 3.960） |
  净墙/顶面/防霉漆均不变。
- **关联文件**：`shared/types.ts`、`server/overlay-merge.ts`、`shared/render/SceneBuilder.ts`、
  `config/layout/overlay.yaml`、`tests/server/{finish-scope,paint-scope,paint-comparison-api,paint-sill-scene,wall-tile-inspection}.test.ts`、
  `README.md`、本文件。
- **决策人**：业主（「那就贴砖」「底面肯定要的，以现实使用的合理度为准」）。
- **验证**：`test:server` **884/884**、`test:app` **564/564**、`typecheck`（根+app）干净、
  `verify:facts` OK（41 warning）、`verify:all` **15/16**（唯一失败是既有 `sock_child_ac`）。
  `verify:finish-scope` **0 error / 0 warning**。新增回归测试：厨房上飘窗必须恰好是
  front + underside 两条瓷砖声明、无漆声明混入。
- **后续议题**：① `underside` 目前只服务厨房这一处；主卫那处仍是 `anti_mold` 漆（含底面），
  若将来主卫也要整贴砖可直接复用；② 通用判据「以现实使用的合理度为准」已确立，后续
  异形窗台费率、两个名实不符飘窗等取舍都按它走。

---

### DEC-2026-10-09-P10 两个「名实不符」飘窗按方案 A 改名：只改 id，不动几何/面积/room

- **日期**：2026-10-09。触发：业主问「两个窗台是什么问题」，听完选 **A（改名）**而非 B（改几何）。
- **问题**：两个 `bay_sill` 的 id 命名与几何位置对不上，都在**西墙玻璃幕墙（x=0）**上、是相邻两段：
  | 原名 | 名字说它是 | outline 实际在哪 | 按几何归属的 room |
  |---|---|---|---|
  | `bedroom_nw_west_bay` | 西北次卧的西墙 | x[0,1.1]×z[2.10,2.86]，**整块在 master_bath 矩形内** | `master_bath` |
  | `corridor_west_bay` | 走廊的西墙 | x[0,1.1]×z[2.86,5.55]，**整块在 master_bedroom 矩形内** | `master_bedroom` |
  西北次卧的西界在 **x=2.6**（它在主卫东边），不可能有 x=0 的墙；**模型里根本没有 `corridor` 这个 room**——
  走廊是房间覆盖栅格里的一个洞（x[4.2,7.2]×z[4.3,6.45]），离这扇窗 4 米远。
- **为什么不是小事**：room 归属决定吊顶遮挡用哪间房的 zone。主卫是铝扣板、完成面 2.65，
  会遮住飘窗台面上方约 0.5㎡。归属错了遮挡就算错。而且这是**认知陷阱**——配置里写着
  `bedroom_nw_west_bay` + `room: bedroom_nw`，任何人下次来改都会以为它是西北次卧的窗。
- **来源（git 考古）**：两个分属不同 commit 各自引入，**引入者当时就判错了房间**：
  `corridor_west_bay` 出自 `8440e60`（原 depth 0.5 / sill 2.55 / h 0.45，reason「走廊西墙飘窗」）；
  `bedroom_nw_west_bay` 出自 `096bad8`（reason「西北次卧西墙飘窗」）。后被统一为
  depth 1.1 / sill 2.07 / h 0.76，错误一路带到现在。
- **为什么选 A 不选 B**：B（把两个 bay 挪到名字说的位置）不可行——西北次卧西墙在 x=2.6，
  那是主卫的东墙、已经有 `w_mbath_east` 了；走廊西墙在 x=4.2。挪过去会和现有墙/飘窗撞，
  且要动几何就得重新量，属于猜。按业主「以现实使用的合理度为准」的判据：
  **几何是量出来的，名字是人起的**——改名字零成本，改几何是猜。
- **落地**（只改 id 与 reason，几何/面积/room/finish/faces 全不动）：
  - `bedroom_nw_west_bay` → **`master_bath_west_lower_bay`**
  - `paint_bedroom_nw_west_bay` → **`paint_master_bath_west_lower_bay`**
  - `corridor_west_bay` → **`master_bedroom_west_mid_bay`**
  - `paint_corridor_west_bay` → **`paint_master_bedroom_west_mid_bay`**
  四条声明的 reason 都改写了：删掉原来的「⚠️ 名实不符待核」，换成明确的房间归属说明 +
  「2026-10-09 由 <旧名> 改名，原名是引入者误判」的留档。`docs/dressing-map.md` 的两行同步。
- **数字**：**完全不变**。普通计费 294.717㎡、防霉漆 3.555㎡、全部涂装面 298.272㎡、
  窗台按房 `{master_bath:4.832, master_bedroom:16.706, study:5.04, bedroom_se:5.04, bedroom_nw:5.58}`，
  `scope.warnings` 仍 6 条（相邻飘窗内部接缝，与本次改名无关）。
- **关联文件**：`config/layout/overlay.yaml`（4 个 id + 4 条 reason + 1 处注释）、
  `docs/dressing-map.md`、本文件。
- **决策人**：业主（选 A）。
- **验证**：`test:server` **884/884**、`test:app` **564/564**、`typecheck`（根+app）干净、
  `verify:facts` OK（41 warning）、`verify:all` **15/16**（唯一失败是既有 `sock_child_ac`）。
  `verify:finish-scope` **0 error / 0 warning**。改名后涂装数字逐项复算一致。
- **后续议题**：DEC-2026-10-09-P04 的后续议题② 至此关闭（命名与几何已统一）。

---

### DEC-2026-10-09-P11 新增 F07 面层不得盖住门/窗洞，修 3 条 stale 瓷砖声明共 1.05㎡

> **补写说明**：本条对应的改动在 commit `c1a2a49` 就已落地（F07 规则 + 3 条瓷砖声明修正），
> 但当时只在 commit message 里写了编号、**没有落本文档**，目录也一直缺 P11–P15。
> 2026-10-11 验收 P16 时发现此缺口，按 commit 实测事实补写。规则现状以 F07a/F07b 为准。

- **日期**：2026-10-09（补写于 2026-10-11）。触发：业主问「Linter 兜底了哪几个部分」，
  指出**漆面刷到门上**这个缺口我只是一次性手工验过、没有常驻守卫。业主裁定：
  **「补，限制住不该刷漆贴砖的地方不要做」**。
- **查证结果（第一版探针读错字段，已修正）**：洞口在 resolved layout 里是世界坐标
  `x/z/width`，不是 `from/to`（一开始读错、得出「0 重叠」的假结论）。
  按 `doorGapsOnWall` 同款投影换算后，**11 段声明跨洞**：
  - **8 段 `paint_region`** —— 面积与 3D 网眼已由 `splitRectByGaps` 实扣，跨洞正是漆的声明机制
    （声明整面墙，拆成左条+右条+门楃条），**没问题**。
  - **3 段 `wall_region`（瓷砖）—— 真问题**：`wall_region` 分支是**单张 PlaneGeometry、不拆洞**，
    瓷砖算量也按 `len × band` 不扣洞。所以砖声明盖住洞就是**实打实多算**，且物理上不能贴砖过门洞。
- **规则**（拆两条，因为级别不同）：
  - **F07a `finish.tile_over_opening`（error）**：瓷砖声明圈定的沿墙×竖向区间盖住门/窗洞。
  - **F07b `finish.paint_over_opening`（info）**：漆声明跨洞。只登记「这段声明跨了洞、扣减正在发生」，
    供核对，不判错。业主要升 severity 改 `config/finish-lint.yaml` 即可。
  - 为什么必须拆两条：`severityFloor` 是「配置只许加严」，若合成一条且配置声明 error，
    漆自判的 info 会被抬成 error——8 段正常声明瞬间全红。
- **修声明让门禁回绿**（3 条，合计让出 **1.05㎡**）：
  | 声明 | 原 along | 现 along | 让出 |
  |---|---|---|---|
  | `walltile_mbath_south_shower` | [0, 1.20] | **[0, 1.15]** | 0.05×2.10 = 0.105㎡ |
  | `walltile_mbath_south_dry` | [1.20, 2.60] | **[1.95, 2.60]** | 0.75×0.30 = 0.225㎡ |
  | `walltile_kitchen_balc_east` | [0, 1.20] 整段 | **拆 `_west` [0,0.20] + `_east` [1.00,1.20]** | 0.80×0.90 = 0.720㎡ |
  `walltile_kitchen_balc_east` 的 reason 原话是「门洞 0.80m 占大半」却仍按整段 1.20m 声明——典型的口径漂移。
- **连带修正（修复暴露的真问题，不是遮掩）**：
  - 淋浴砖收到 1.15 后，`paint_master_bath_w_mbath_south` 还从 1.20 起算，**留了 0.05m 无人面层**。
    已把该漆声明的 along 由 [1.20,2.60] 提前至 **[1.15,2.60]**，与砖带衔接。
  - `paint-scope.test.ts` 的 L2 独立复算**原本不建模门洞**，声明跨洞时两边不再抵消
    （master_bath 差 0.24㎡）。已改为**两边都扣洞**：声明侧按「声明区间 ∩ 洞口」算扣除量
    （不调 `computePaintScope`，保持独立），复算侧扣「洞口跨度 × 洞口高度」
    （门楣仍是墙，天然只扣洞口那一段）。到顶砖与洞重叠的部分不重复扣。
- **数字**：普通计费 294.717 → **294.752㎡**；全部涂装面 298.272 → **298.307㎡**；
  净墙面 157.850 → **157.885㎡**；门洞占位 14.580 → **14.670㎡**；
  报价总额 16209.44 → **16211.36**；`painting.actual` 8934.91 → **8936.10**；
  瓷砖检视总面积 31.157 → **30.640㎡**；`wall_region` 16 → **17 段**；瓷砖网眼 24 → **25**。
- **关联文件**：`shared/finish/{rules,registry,types}.ts`、`config/finish-lint.yaml`、
  `scripts/verify/finish/verify-finish-scope.ts`、`config/layout/overlay.yaml`（3 条瓷砖 + 1 条漆）、
  `tests/server/{finish-scope,paint-scope,paint-comparison-api,wall-tile-inspection}.test.ts`、
  `config/facts.yaml`、`README.md`。
- **决策人**：业主（「补，限制住不该刷漆贴砖的地方不要做」）。
- **验证**（commit `c1a2a49` 时）：`test:server` 884/884、`test:app` 564/564、
  `typecheck`（根+app）干净、`verify:facts` OK、`verify:all` **15/16**（唯一失败是既有 `sock_child_ac`）。
  `verify:finish-scope` **0 error / 0 warning / 8 info**。

---

### DEC-2026-10-09-P12 非房间地面进预算：`floor_region` 加 `costed` 标志，主走廊 3.75㎡ 计入、设备平台 1.60㎡ 不计

- **日期**：2026-10-09。触发：业主问「地面评估下缺少哪些，如果不缺就不用补」。
- **评估结论（先查后说）**：
  - **已经兜住的**：`floor_region` 互相**零重叠**（网格采样实测）；`facts-lint` 的 T3.8 已有
    `ignore_follow` 语义（只抓「没 follow 却整块落在别人房间里」的，声明了 follow 的按约定
    不计交叠并留 INFO）；`follow` **真生效**（`TextureManager.ts:101` 读 `userData.follow`
    套用被跟随房间地材）；房间地面 121.51㎡ 由 `applyRooms` 9 间覆盖；`floor_region` 本身
    不进成本，所以它的"重叠"不影响预算。
  - **缺的**：走廊 3.75㎡ 与 VRV 设备平台 1.60㎡ **不在任何房间内**，而 floor lineItem 的
    `applyRooms` 只能列房间 id，这两块地进不了 `floorArea`。
    （`entry_garden_floor` 12.91㎡ 未计费是**有意的**——DEC-041 开发商已铺、移出算量，不算缺口。）
- **业主裁定**：**「设备平台不需要铺砖，走廊需要」**。
- **落地**：
  - `shared/types.ts` + `server/overlay-merge.ts`：`floor_region` 加 `costed?: boolean`。
  - `config/layout/overlay.yaml`：`main_corridor_floor` 补 `follow: living_dining`
    （DEC-040 走廊与客餐厅通铺同材，600×1200 木纹砖 75 元/㎡）+ `costed: true`；
    `north_platform_floor` **不设 costed**，reason 登记业主裁定与"如需改裸混凝土面请另议"。
    顺带补上走廊原本缺失的 `follow`（5 条里唯一没有的一条，渲染会落回默认地材）。
  - `server/budget-calculator.ts`：新增 `loadCostedFloorRegionArea()`，读 overlay 里
    `costed: true` 的 `floor_region`、**按声明多边形实算面积**（不硬编码数字，配置是唯一权威），
    加进 floor 分支的 quantity。
- **为什么不硬编码面积**：硬编码就出现了第二个真相源，改几何时数字不会跟着动——
  与 `loadPaintScopeAreaByRoom` 读 overlay 声明同理。
- **数字**：floor 算量 121.51 → **125.26㎡**（+3.75 走廊）；设备平台 1.60㎡ 按裁定不计。
  瓦工人工按 45 元/㎡ 计，laborAdded 相应增加（测试已钉）。
- **关联文件**：`shared/types.ts`、`server/overlay-merge.ts`、`config/layout/overlay.yaml`、
  `server/budget-calculator.ts`、`tests/server/budget-calculator.test.ts`、本文件。
- **决策人**：业主（「设备平台不需要铺砖，走廊需要」）。
- **验证**：`test:server` **884/884**、`test:app` **564/564**、`typecheck`（根+app）干净、
  `verify:facts` OK（40 warning）、`verify:all` **15/16**（唯一失败是既有 `sock_child_ac`）。
- **后续议题**：① 设备平台渲染仍 `follow: balcony`（室外灰砖面），若业主认为不铺砖就不该显示砖面，
  需另定它的渲染材质；② 顶面漆面积仍无第二套算法独立复算。

---

### DEC-2026-10-09-P13 新增 F08 面层声明必须附着在 3D 实体（回答「漆面是不是飘在空中」）

- **日期**：2026-10-09。触发：业主提出「linter 可以校验漆面是不是附着在物体上吧？而不是离大谱的飘在空中」。
- **这条检查抓什么**：声明是一回事，**场景里有没有实体是另一回事**。声明落空**不会报错**——
  `computePaintScope` 照样按声明算出面积进预算，而 3D 里那块什么都没有。结果是
  「预算算了钱、现场找不到活儿干」，而且从面积数字上完全看不出来。
- **与既有检查的分工**：SceneBuilder 的 `report.unsupported` 只覆盖「引用不存在 / along 越界」
  这类硬错误，且**只有测试在断言它为空**，不在门禁里；`verify:spatial` 管声明完整性与拓扑。
  本规则把「声明 → 场景实体」的对应关系提升为门禁级，并覆盖 `paint_ceiling_region`
  （它本身不产网格，只能通过「房间有无 ceiling 几何」间接判断）。
- **实现**：
  - 新增 `shared/finish/scene.ts` 的 `collectFinishSceneMeshes()`——`buildScene` 后遍历
    `userData.objectId`，同时按 `ceiling:<room>` 收集有顶面网格的房间。与
    `shared/penetration/scene.ts` 同构：verifier 与测试共用同一份采集，结论不会两边漂移。
  - `shared/finish/rules.ts` 新增 `checkDeclarationAttached()`（F08）：
    - `paint_region` / `walltile`：objectId 直接命中，或命中门洞拆分的 `${id}:s${n}`；
    - `paint_sill_region` / `sill_region`：objectId 命中；
    - `paint_ceiling_region`：声明顶面漆的房间必须有 ceiling 网格，否则「顶面漆飘在 2.80m 高度上，那儿没有顶」。
  - 场景建不起来时**抛错**（fail-closed）：不能因为拿不到几何就假装没有飘空声明。
- **规则编号**：F08 `finish.declaration_attached` / code `finish.declaration_unattached`，severity **error**。
- **当前结论**：**0 命中**——45 段面层声明全部在场景里找到了实体，7 间顶面漆房间全有 ceiling 网格。
  这条的价值在未来：谁加了一段声明却忘了让它落地，门禁当场红。
- **关联文件**：`shared/finish/scene.ts`（新）、`shared/finish/rules.ts`、`shared/finish/registry.ts`、
  `config/finish-lint.yaml`、`scripts/verify/finish/verify-finish-scope.ts`、
  `tests/server/finish-scope.test.ts`（+3 条，含合成孤儿声明与人为清空 ceilingRooms 的负例）、本文件。
- **决策人**：业主（提出该检查维度）。
- **验证**：`test:server` **887/887**、`test:app` **564/564**、`typecheck`（根+app）干净、
  `verify:facts` OK（40 warning）、`verify:all` **15/16**（唯一失败是既有 `sock_child_ac`）。
  `verify:finish-scope` **0 error / 0 warning / 8 info**。
- **面层核查层现状（F01–F08 八条）**：F01 漆砖互斥（同墙同侧重叠）、F02 同元素同面漆砖双声明、
  F03 同侧重复涂漆、F04 声明挂错房间（悬空判据）、F05 顶面归属未登记、F06 铝扣板越界、
  F07a 瓷砖盖门洞 / F07b 漆跨洞（info）、F08 声明未附着 3D 实体。

---

### DEC-2026-10-09-P14 修 `sill_region` 弧墙悬空：`mid` 取弦中点改为沿折线逐段出网

- **日期**：2026-10-09。触发：业主追问「瓷砖呢？有没有悬空」。
- **查证方法**：F08 只查「声明的 id 在不在场景里」，查不出"网格存在但位置错了"。所以加做了**几何附着核查**——
  把每块面层网格的世界包围盒中心拿去和全部墙段求最近距离，>0.12m 即判未附着。
- **查出的结果**：
  - `wall_region` 17 块、`paint_region` 43 块：**0 未附着**。
  - `sill_region` 8 块里 **2 块悬空**：`silltile_mbath_north_front` 与 `silltile_mbath_north_top`，
    中心 (1.30,1.60)，离真实墙面 **0.50m**。
  - `paint_sill_region` 54 块：探针报 16 块未附着，**是误报**——前缘面本身就在 bay 多边形边界上，
    射线法 `inPoly` 对边界点不稳定。那段代码用真实点定位，几何是对的，未改。
- **根因（真 bug）**：SceneBuilder 的 `sill_region` 分支用
  `mid = ((start.x+end.x)/2, (start.z+end.z)/2)`——**起终点的弦中点**。直墙上弦就是墙，成立；
  **弧墙（圆角）上弦不是墙**。`mbath_north_waterproof_ledge` 挂在 `w_bath_north`
  （r=1.0 圆角弧 + z=1.10 直线，共 17 段、总长 3.170m），弦中点被算成 (1.30,1.60)，
  而真实墙面在 (1.00,1.10) 附近——整块砖面飘在卫生间中间。
  `span` 同样取弦长（2.786 而非 3.170），所以网格既错位又偏窄。
- **修法**：沿折线把 `[from,to]` 裁成一段段直线，**逐段出网**（`front` 与 `top` 都是）。
  每块用自己的中点与法线，弧墙上每一块都贴在墙上。`top` 的法线也改为逐段算
  （原来用整段的单一法线，弧墙上会朝错方向）。
- **连带修正**：
  - `writeMeta` 加 `part/parts` 参数，多块时 objectId 用 `${id}:s${n}`——否则多块共用一个 id，
    导出与检视都去重不出。
  - F08 的 `sill_region` 分支补认 `:sN` 后缀（原来只认直接命中，会把逐段出网的声明误判成落空）。
- **数字影响**：
  - `sill_region` 网格 8 → **40 块**（两条弧墙声明各拆成 17 段 front + 17 段 top）。
  - **涂装面积完全不变**（294.752 / 3.555 / 298.307）——面积按声明 along × band 算，与网格无关。
  - `scene.unsupported` 仍为空。
- **复验**：几何附着核查重跑——瓷砖 57 块 / 漆 43 块，**0 未附着**。
- **关联文件**：`shared/render/SceneBuilder.ts`、`shared/finish/rules.ts`（F08 认 `:sN`）、
  `tests/server/finish-scope.test.ts`（+1 条钉住弧墙逐段 / 直墙单块）、本文件。
- **决策人**：业主（追问瓷砖有没有悬空）。
- **验证**：`test:server` **888/888**、`test:app` **564/564**、`typecheck`（根+app）干净、
  `verify:facts` OK（40 warning）、`verify:all` **15/16**（唯一失败是既有 `sock_child_ac`）。
  `verify:finish-scope` **0 error / 0 warning / 8 info**。
- **后续议题**：几何附着核查目前是**一次性探针**，未固化为规则。若要常驻，应在 F08 里加
  「网格中心到最近墙段的距离」判定——但需先处理 `paint_sill_region` 前缘面在边界上的误报
  （改用「到 bay footprint 边界的距离」而非 `inPoly`）。

---

### DEC-2026-10-09-P15 新增 F09「网格必须贴在墙面几何上」：把一次性探针固化为门禁规则

- **日期**：2026-10-09。触发：P14 的「后续议题」——几何附着核查当时是**一次性探针**，
  未固化；而 F08 查不出「网格存在但位置错了」，谁再引入一个弦中点/偏移错误，门禁一声不响。
- **规则编号**：F09 `finish.mesh_unattached`（+ `finish.mesh_unattached_unknown_anchor`），
  severity **error**。
- **判据（逐块判，与网格总数无关）**：
  1. `wall_region` / `paint_region` / `sill_region` 的 `sill-front`：网格世界包围盒中心到
     `wallGeometry[wallId].polyline` 任一段的最近距离 ≤ 0.12m；
  2. `sill_region` 的 `sill-top` / `sill-underside`、以及 `paint_sill_region`：中心到该 bay
     footprint **边界**的距离 ≤ 0.12m，**或**中心在 footprint 内；
  3. 拿不到 wallId / elementId / 对应几何 → `finish.mesh_unattached_unknown_anchor`（error），
     不静默跳过（fail-closed）。
- **为什么第 2 类必须用「到边界距离」而不是射线法 `inPoly`**：前缘面（front）与两端面
  （start_end/end_end）的中心**本身就落在 footprint 边界上**，射线法对边界点不稳定
  （半开区间比较让同一个点随机判成内/外）——P14 那次探针正是只用 `inPoly`，把 16 块几何
  正确的网格误报成飘空。距离法对边界点稳定（恒 ≈ 0），所以边界点全走距离支；`inPoly`
  只用来放行「中心明显在 footprint 内部」的网格（台面/底面中心合法地落在 depth/2 处）。
  **两支都要**：只用到边界距离会把每一块 top/underside 误报（距边界 0.55m），只用 `inPoly`
  会把每一块 front 误报。测试里用「取 footprint 顶点当中心」钉住这个边界点不误报。
- **容差为什么是 0.12m 而不是 config 的 `tolerance: 0.01`**：0.01 是 F01/F03 的**重叠**容差。
  面层网格天生不贴在墙中心线上——paint_region 外偏移 `PAINT_FACE_OFFSET = 0.12/2 + 0.008 =
  0.068m`（墙厚半 + 8mm 避 z-fighting），sill-top 在 depth/2 处。用 0.01 会把每块漆面都判成
  飘空。0.12m 与弧墙悬空实测值 0.50m 差 4 倍、与合法偏移 0.068m 差 2 倍，两头都够；
  这个数字沿用 P14 探针的口径，不是新造的。
- **逐块清单而不是 `Map<objectId, …>`**：`computePaintSillScope` 的 start_end 与 end_end
  都产 `${id}:${i}`，真实配置里 `paint_master_bedroom_west_bay:0` 被两块网格共用
  （154 块网格、153 个 id）。按 id 收敛必然静默漏判一块，故采集返回 `meshes` 清单逐块判，
  `meshCentres`（id → 中心）只作视图。测试钉住了这个撞车。
- **不钉网格数量**：另一个 agent 正把 wall_region/paint_region 改成逐段出网（数量会变），
  F09 逐块判附着，与总数无关；实测该改动落地后，全跨度挂在 w_bath_north 的探针声明产出
  17 块 `:sN` 网格，F09 **0 命中**（不误报）。
- **当前结论**：**0 命中**——154 块面层网格全部贴在各自锚几何上。探针三段全过：真实产出
  0 命中；旧算法「弦中点」单块几何报 0.500m 悬空；把任意一块平移 0.5m 立刻报 1 条。
- **关联文件**：`shared/finish/scene.ts`（采集扩为 meshCentres/meshes/bayOutlines）、
  `shared/finish/rules.ts`（新增 `checkMeshAttachedToGeometry()` + `distanceToPolyline` /
  `pointInPolygon`）、`shared/finish/registry.ts`、`config/finish-lint.yaml`、
  `scripts/verify/finish/verify-finish-scope.ts`、`tests/server/finish-scope.test.ts`（+7 条）、
  本文件。
- **决策人**：业主（追问瓷砖有没有悬空）+ 工程侧把一次性探针固化为门禁。
- **面层核查层现状（F01–F09 九条）**：F01 漆砖互斥、F02 同元素同面漆砖双声明、
  F03 同侧重复涂漆、F04 声明挂错房间、F05 顶面归属未登记、F06 铝扣板越界、
  F07a 瓷砖盖门洞 / F07b 漆跨洞（info）、F08 声明未附着 3D 实体、F09 网格未贴墙。

---

### DEC-2026-10-09-P16 地面算量从 `costed` opt-in 改为几何驱动 opt-out：`excluded` 只留给例外

- **日期**：2026-10-09。触发：业主看 P12 的落地方式，判「**太反直觉**」——「走廊要铺砖」
  居然要在 overlay 上手写一个 `costed: true`，而这块地是不是已经被某个房间算过，几何上
  本来就写得出来。
- **为什么 `costed` 反直觉（根因，不是文风问题）**：`costed` 这个手工布尔量**重复了几何
  已知的信息**——「这块 floor_region 是不是整块落在某个 `applyRooms` 房间内」。同一个事实
  存两处（一处是几何、一处是手写标志），改一处忘另一处就是双计/漏计，而且**从任何单处都
  看不出来**：看 overlay 只知道标志写了没写，看房间表只知道房间算没算，两边对不上时没有
  第三处能报警。业主原话指向的正是这个「第二份真相」。
- **新口径（照此实现，不许自行发挥）**：
  ```
  floor 算量 = Σ(applyRooms 房间 footprint)
             + Σ(floor_region 面积，且该 region 不整块落在任何 applyRooms 房间内)
             − Σ(显式 excluded 的 region 面积)
  ```
  **默认该算就算；只有例外才标 `excluded: true` 并带 reason。** 与 `costed` 的方向相反：
  opt-out 的默认值就是对的，忘写标志不会再漏算；而 opt-in 忘写标志就是漏算。
- **5 条 floor_region 逐条裁定**（探针实测，`applyRooms` = 9 间、footprint 合计 121.51㎡）：

  | region | 面积（㎡） | 整块落在 | 新口径处置 |
  |---|---|---|---|
  | `entry_garden_floor` | 12.9050 | `entry_garden`（**不在** applyRooms） | **`excluded: true`**，reason 引 DEC-041 开发商已铺 |
  | `entry_foyer_floor` | 3.6400 | `living_dining`（在 applyRooms） | **自动跳过**，不标任何标志 |
  | `corridor_floor` | 6.7500 | `study`（在 applyRooms） | **自动跳过**，不标任何标志 |
  | `main_corridor_floor` | 3.7500 | 无 | **自动计入**（删掉原 `costed: true`） |
  | `north_platform_floor` | 1.3854（带弧） | 无 | **`excluded: true`**，reason 保留业主 2026-10-09 裁定不铺砖 |

  `skippedInsideRoomArea` = 3.64 + 6.75 = **10.39㎡**（已被房间 footprint 算过，再算即双计）；
  `excludedArea` = 12.905 + 1.3854 = **14.2904㎡**；`extraArea` = **3.75㎡**。
- **面积守恒**：floor 算量 **125.26㎡ 一个数没变**（房间 121.51 + 主走廊 3.75）。P12 也是
  125.26，但那是「手工标志蒙对」的 125.26；P16 是「几何推出来」的 125.26——**同一个数，
  不同的可信度**。瓦工人工 45 元/㎡ 不变，涂装面积 294.752 / 3.555 / 298.307 / 312.977
  全部不变（本条不动涂装口径）。`scene.unsupported` 仍为空。
- **弧段不许静默算错**：`north_platform_floor` 的 NW 角 `radius: 1.0`（弧心 (6.6,1.0)），
  朴素 shoelace 会按外接矩形算成 **1.60㎡**，真实 **1.3854㎡**（1.60 − [0.5 − π/4]）。
  生产侧取**闭式解**：圆心 + 半径在两条邻边上定切点（垂足），「锐角三角形面积 − 圆弓面积
  `r²(θ−sinθ)/2`」逐角结算，与 `shared/render` 的圆角同一套几何但不采样折线，所以不存在
  「渲染端折线段数不同导致面积对不上」的第二套口径。切点落在邻边线段外、半径与弧心不自洽、
  扫角退化 → **抛错**（fail-closed）。新口径下它被 `excluded` 所以不影响预算，但标志一去掉
  就会咬人：摘掉 `excluded` 后 `extraArea` 立刻变成 18.0404，其中弧项贡献实测 **1.3854**
  （探针差分证实），不是 1.60。
- **包含判定**：房间有 `points`（异形房）走**多边形包含**（bbox 四角全在多边形内**或边上**），
  否则回落 `x/z/width/depth` 包围盒。边界必须算「内」——`corridor_floor` 的四角正压在
  `study` 的南/东/西边上，射线法对边界点不稳定会把它判成外面，双计就回来了。当前 11 间房里
  6 间带 `points`（master_bedroom / living_dining / master_bath / guest_bath / kitchen /
  balcony），其余 5 间是轴对齐矩形，两条分支在现行数据上都精确。
- **双计风险从根上消失**：`corridor_floor`（6.75㎡，落在 study 内）和 `entry_foyer_floor`
  （3.64㎡，落在 living_dining 内）是 P12 时期**只差一个手写标志**的两处双计候选——谁给
  `corridor_floor` 补一个 `costed: true`，6.75㎡ 就静默双计。新口径下这两条**不需要标任何
  标志**，而且标了也没用：负例①把 `corridor_floor` 的 `excluded` 显式设成 `false`，
  `extraArea` 一动不动（对照组把 `study` 移出 `applyRooms` 后它才计入，证明跳过确实是几何
  驱动、不是把区域吞了）。负例②把不在任何房间内的 `main_corridor_floor` 标 `excluded: true`，
  `extraArea` 归零、`excludedArea` 留档 +3.75——「有意不算」与「漏算」从此可区分。
- **落地文件**：
  - `server/budget-calculator.ts`：`loadCostedFloorRegionArea(catalog)` → `loadExtraFloorRegionArea(rooms, applyRoomIds)`，
    返回 `{ extraArea, excludedArea, skippedInsideRoomArea }` 三档留档；`case 'floor'` 改为
    `quantity = roomArea + extraArea`。第三参数 `elements?` 是测试缝（缺省读 overlay.yaml），
    供负例做合成复算，不必为跑测试改配置文件。
  - `config/layout/overlay.yaml`：`main_corridor_floor` 删 `costed: true`；`north_platform_floor`
    与 `entry_garden_floor` 加 `excluded: true` + reason；三条 reason 都改写成「为什么」。
  - `shared/types.ts` / `server/overlay-merge.ts`：`costed?: boolean` → `excluded?: boolean`，
    注释写清「默认计入，标了才排除」。
  - `tests/server/budget-calculator.test.ts`：第 48–74 行按 `costed` 复算那段改为按新口径
    **独立复算**（自带 shoelace + 包含判定，不调生产函数，两边各自算才算交叉验证），
    并钉住 `extra === 3.75` 与 `floor 算量 === 125.26`；新增上述两条负例。
- **决策人**：业主（「太反直觉」，要求改成几何驱动）。
- **验证**：`npx tsc --noEmit` 干净；`test:server` **902/902**；`test:app` **564/564**；
  `verify:facts` OK（53 warning）；`verify:all` **15/16**（唯一失败是既有 `sock_child_ac`，
  与本条无关）。两条负例的「能红」证据：临时拿掉房间包含判定 → 负例①红（`extra` 从 3.75 变
  14.14）；临时把 `excluded` 语义写反 → 负例②红（`extra` 变 18.04）。改动已还原。
- **后续议题**：① `entry_garden_floor` 的 `excluded` 与「不在 applyRooms 内」在几何上结论一致
  （双保险），保留显式标志是为了让「为什么不算」在声明处可读；若将来 entry_garden 进
  applyRooms，这条 `excluded` 就是唯一防线，删除前须先改 DEC-041。② 设备平台渲染仍
  `follow: balcony`（P12 遗留，未决）。
