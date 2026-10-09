# 决策日志 · 涂装范围与门禁编排

> 本文件收录涂装范围（墙/顶/窗台）扩展、以及门禁编排相关决策。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-09-G01` 门禁编排器取代 `&&` 链（已计入 `16-verify-gate.md`，此处不重复）
- `DEC-2026-10-09-P02` 涂装范围扩展到显式顶面与上飘窗外露面，并修正顶面多计 7.726㎡
- `DEC-2026-10-09-P03` 上飘窗涂装精度与几何口径修正：逐段 round3 累加改内部全精度、底面映射与 bay_sill 本体对齐、审计分水平/立面
- `DEC-2026-10-09-P04` 全部上飘窗纳入涂装范围：主卫刷防霉漆独立计价，其余 8 处按普通漆；预算侧补算漏记的窗台面积
- `DEC-2026-10-09-P05` 相邻上飘窗端面去重：背靠背的内部接缝按「算 0 次」剔除，并留档包围盒测量的错误

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
- **后续议题**：① `kitchen_north_bay` 已由业主 2026-10-09 裁定「按统一刷漆价格先算」→ 维持 `ordinary`；业界做法留档于该声明 reason（厨房/飘窗窗台首选贴砖，与厨房墙砖连续、耐油污；若维持刷漆应加阳角条并升级厨卫/外墙漆，普通内墙乳胶漆在厨卫窗台并不合适），将来改贴砖需改挂 `sill_region` 并从 `ordinaryAreaSqm` 移出；② `bedroom_nw_west_bay` / `corridor_west_bay` 的 id 命名与几何归属不符（前者整块落在 master_bath 矩形、后者整块落在 master_bedroom 矩形），git 考古显示两者分属不同 commit 引入（`8440e60` 走廊西墙飘窗 depth 0.5/sill 2.55、`096bad8` 西北次卧西墙飘窗），后被统一为 depth 1.1/sill 2.07/h 0.76；③ **西墙幕墙两个 bay_sill 声明重叠 0.110㎡**（`master_bath_west_bay` z[1.10,2.20] vs `bedroom_nw_west_bay` z[2.10,2.86]，sill/height 完全相同 → 同一高度带双重声明，两处都已声明 paint_sill_region 故被双计），已登记 `docs/pending-site-data.md` #57；④ 上飘窗是异形面（水平+立面混合），普通漆按平墙费率计价可能偏低，费率口径待报价轮确认；⑤ 9 处飘窗的 `sill/height/depth` 仍为待复尺值，得房后复尺重算。

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
