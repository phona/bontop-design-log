# 决策日志 · 涂装范围与门禁编排

> 本文件收录涂装范围（墙/顶/窗台）扩展、以及门禁编排相关决策。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-09-G01` 门禁编排器取代 `&&` 链（已计入 `16-verify-gate.md`，此处不重复）
- `DEC-2026-10-09-P02` 涂装范围扩展到显式顶面与上飘窗外露面，并修正顶面多计 7.726㎡

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
