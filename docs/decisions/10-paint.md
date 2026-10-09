# 决策日志 · 涂漆

> 本文件是 `docs/decision_log.md` 2026-10-09 主题拆分（DEC-2026-10-09-S01）的产物：
> 收录范围 = 涂漆子系统独立、范围修正（门洞扣除/入户花园出范围）、报价折算三方对照。条目为原文件的连续切片，正文未改写；文件内按时间正序。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-08-C05` 涂漆（墙顶面涂装）子系统独立：一键高亮 + 声明式成本核算 + 预算面积同源
- `DEC-2026-10-08-C06` 涂漆范围修正：门洞按实扣除 + 入户花园出范围（+ 面积口径三处同源）
- `DEC-2026-10-08-C07` 登记多乐士包工包料报价 55 元/㎡，并折算成三方对照

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-10-08-C05 涂漆（墙顶面涂装）子系统独立：一键高亮 + 声明式成本核算 + 预算面积同源

- **日期**：2026-10-08。触发：业主问「墙面的涂漆系统有专门的一键高亮、还有成本核算功能吗」——查证结论是**都没有**：只有方案面板选漆色 + `paintWallArea = (宽+深)×2×高×0.75` 这个拍系数公式。业主要求「做成瓷砖那样类似的成本核算与一键高亮功能」。
- **先说旧口径错在哪**：`paintWallArea` 对 `catalog.getRooms()` 全部 11 间房算量，把厨卫/阳台/电梯井共约 89㎡ 的**非涂装面**也算进了乳胶漆（算得 306.39㎡）。数值上巧合接近「墙+顶 ≈ 300㎡」，但房间集合是错的——这类「数字对、口径错」正是 R05/R06 在贴砖上揪过一遍的同一类问题。
- **声明层（面积唯一真相）**：`config/layout/overlay.yaml` 新增 **26 条 `paint_region`**（新 element type，与 `wall_region` 平级且互不引用）：每条写 `wall + room + along + height`，`room` 声明漆面归属房间。声明由 `tmp/gen-paint-regions.ts` 从 model-geometry + suppress + house.yaml 的 `wall_finish` 几何交叉生成；**权威校验由 `tests/server/paint-scope.test.ts` 用同款算法独立复算**，逐房间对账（错一条即测试红）。`shared/types.ts` 的 `SceneElement` 联合、`server/overlay-merge.ts` 的 Zod 判别联合、`shared/render/layout-bounds.ts`、`scripts/verify/collision/verify-collision-coverage.ts` 同步接入。
- **3D 一键高亮**：工具栏新增「涂漆区」按钮（`app/src/ui/PaintButton.ts`，与 `WallTileButton` 平级）；`HouseScene.setPaintInspectionVisible` 只遍历 `inspectionLayer === 'wall-paint'`，按 `inspectionInitial` 快照可逆恢复，**不接进 HVAC / 管井 / 吊顶 / MEP / 贴砖任何一条路径**。`SceneBuilder` 的 `paint_region` case 关键差异：**平面沿墙法线朝声明房间侧外偏移 0.068m**（半墙厚 + 间隙），否则同一段墙上的贴砖面与双面涂漆的另一面会共面 z-fighting——`w_mb_east`/`w_st_east`/`w_be_west`/`w_nw_south`/`w_mbath_east`/`w_ent_west`/`w_ent_south_w` 共 7 面墙是双面涂漆；房间取不到 resolved 中心点时**报 unsupported 而不是静默默认某一侧**。打开时 toast 播报逐房间周长与墙面合计。
- **面积口径（业主确认的默认值）**：
  | 项 | 值 | 依据 |
  |---|---|---|
  | 涂装墙面 | **184.35㎡** | 26 段声明实算，与 3D 高亮完全一致 |
  | 顶面 footprint | **116.13㎡** | resolved 房间面积，成本单列，**不在 3D 高亮中显示** |
  | 合计 | **300.48㎡** | 与 `material_selection_log`「墙+顶 280–320㎡」互证 |
  | 门窗洞口 | 7.77㎡ | 默认**不扣**（沿用贴砖「面积不减」铁律）；扣/不扣各算一版情景 |
  | 遍数 | 面漆 2 遍 + 底漆 1 遍 | `materials.yaml` 的 `coverage_per_unit: 120` 是「每桶每遍」，遍数单独表达 |
  - **同时修正文档旧估算法**：`material_selection_log` 的「2 桶面漆 + 1 桶底漆」没按遍数展开；同面积 2 遍口径实为 **6 桶面漆 + 3 桶底漆**。
- **成本核算（`config/paint-comparison.yaml` + `server/paint-cost-comparison.ts`）**：面积只读 overlay 声明，**不在这里另立公式**；与 `materials.yaml`（单价 580/桶、覆盖率 120㎡、损耗 1.1、calc_mode=area）和 `base.json`（人工 25 元/㎡）逐项对账，不一致直接抛错（对齐 `tile-cost-comparison` 的「算不出就 503，绝不静默凑数」）。输出 `GET /api/paint/comparison`（只读，无 POST）与挂在 `/api/budget` 的 `paintBudgetPreview`（`status: 'comparison_overlay_only'`、`includedInTotalActual: false`，不进总额），`OverviewMenu` 渲染成「涂漆范围与用量（墙+顶）」块。
- **不选单一情景**：4 个情景（面漆 1/2 遍 × 扣/不扣洞口）并列，`selectedScenarioId` 恒为 null——口径未拍板前不给单一数字。默认口径（2 遍、不扣）：材料 ¥5,220 + 人工 ¥7,512 = **¥12,732**，高于 PKG-080 计划 ¥11,500 约 **¥1,232**、高于业主目标 ¥11,000 约 ¥1,732；1 遍口径 ¥10,992（低于计划）。**遍数是决定性变量**，这正是必须出敏感性表而不是一个数的原因。不含基层修补/找平批刮腻子/颜色样板与成品保护（COST-080-01/02/04），故不可与 PKG-080 全额划等号。
- **未确认假设显形**：底漆未进 `materials.yaml`（避免动其条数计数不变量与方案面板候选列表），其单价/覆盖率在配置里显式标 `unconfirmed`，`assumptions[]` 逐条带 `status` 与 `source`，`warnings[]` 提示「材料费含未确认假设」。
- **预算侧同源**：`design-rules.yaml` 的 paint 行项目 `quantityField: paintWallArea → paintScopeArea`；`BudgetCalculator` 的 `paintWallArea` 拍系数公式**废除**，改为读 `paint_region` 声明 + catalog resolved 面积（墙+顶），材料与人工同一份缓存。`painting.autoActual` ¥1,598 / `actual` ¥9,110（原 306.39㎡ 口径为 ¥1,629 / ¥9,289），状态仍 `ok`。**面积从此只有一个真相**：3D 高亮、`/api/paint/comparison`、`paintBudgetPreview`、预算 painting 科目同源。
- **边界**：`wall_finish` 进 `RoomLayout`/catalog（`mergeRoom` 与顶点布局两条分支都补），用于「有 paint_region 声明的房间集合 == catalog 里 `wall_finish==='paint'` 的房间集合」这条不变量——不一致就抛错，防止声明腐烂；`elevator_shaft`/`west_platform`/`south_balcony` 都不在涂装范围。
- **不做**：不改 `materials.yaml`（不引入 `latex_paint_02/03`）；不动 `schedule/phase-1/control.yaml` 的 PKG-080/COST-080 台账（那是独立报价决策，走 QR 轮次）；3D 不高亮顶面；不做门洞镂空；不改乳胶漆选色/渲染机制。
- **这不是施工依据**：本子系统的面积与金额是口径对账，用于验收「哪些墙面在涂装范围内」和「预算口径是否对得上」，不作为下单或结算依据；施工范围以 `schedule/phase-1/control.yaml` PKG-080 与现场签证为准。
- **验证**：`tests/server/paint-scope.test.ts` 14 条（schema / 26 网格可逆初始态 / 朝房间侧偏移 / 双面涂漆不共面 / 引用非 suppress 墙且不越界 / **逐房间独立复算面积** / 房间集合与 `wall_finish` 一致 / 成本四情景数值 / 未确认假设显形 / 声明漂移即抛错 / 无浏览器全局与 HVAC 耦合 / GLB 默认排除）；`tests/server/paint-comparison-api.test.ts` 5 条（范围与对账 / 只读且字节一致 / 无 POST / 预算挂载且不动总额 / layout 缺失时不带崩）；`app/src/scene/HouseScene.test.ts` +3 条（切换涂漆不动贴砖·HVAC·管井；反向亦然；(墙,房间) 分组判重 + 越墙长 + 缺墙检出）；`app/src/ui/PaintButton.test.ts` 4 条；`app/src/ui/OverviewMenu.test.ts` +2 条（渲染算式 / 无预览时省略）。`typecheck` 0 → `test:server` 704/704/0 → `test:app` 519/519 → `verify:all` Exit 0（`verify:facts` 33 → 14 warnings，新增覆盖登记 9 条 + overlay 面积豁免 1 条，剩余为存量）→ `build:app` 通过。
- **关联文件**：`config/layout/overlay.yaml`（+26 条 `paint_region`）、`config/paint-comparison.yaml`（新）、`server/paint-cost-comparison.ts`（新）、`server/routes.ts`、`server/budget-calculator.ts`、`server/project-catalog.ts`、`server/overlay-merge.ts`、`shared/render/SceneBuilder.ts`、`shared/render/layout-bounds.ts`、`shared/types.ts`、`app/src/render/HouseScene.ts`、`app/src/ui/PaintButton.ts`（新）、`app/src/ui/OverviewMenu.ts`、`app/src/App.ts`、`app/index.html`、`config/design-rules.yaml`、`config/facts.yaml`、`scripts/verify/collision/verify-collision-coverage.ts`、`tests/server/paint-scope.test.ts`（新）、`tests/server/paint-comparison-api.test.ts`（新）、`tmp/gen-paint-regions.ts`（不入库）。
- **决策人**：业主。

### DEC-2026-10-08-C06 涂漆范围修正：门洞按实扣除 + 入户花园出范围（+ 面积口径三处同源）

- **日期**：2026-10-08。触发：业主看 C05 结果后提出「门怎么也算上了涂漆面积」，并要求剔除入户花园（厨房本来就是贴砖、不在范围内，已核实）。
- **先认错**：C05 有三处错，都是同一类病——**把假设写死、然后拿测试把它锁死**：
  ① 3D 每段声明只生成 1 个 PlaneGeometry，**门洞处不镂空**——门上那面墙整块发绿，视觉上等于"门也刷漆"；
  ② `config/paint-comparison.yaml` 手写 `openings_area_sqm: 7.77`，口径是「openings.room ∈ 涂装房」，**漏了 3 樘门**（d_mbath 主卫门、d_mb 主卧门、d_elev 电梯门的 room 声明在隔壁房间，但物理上贯穿涂装墙），且双面涂漆墙的另一侧默认没门——几何实算 **17.43㎡**，与手写值差 9.66㎡，且该口径**不可复核**；
  ③ 那个 7.77 还被测试钉死了。**已废除该常量**：洞口面积一律由代码从声明与 openings 几何相交实算。
- **门洞实算（5 房范围）**：7 樘物理门 / 9 个门面 / **13.23㎡**。入户门 d_ent 与客房门 d_bese 所在墙两侧都是涂装房，两侧各扣一次（墙的两面各刷各的，正确）。
- **窗洞核查结论（出乎意料）**：**当前涂装范围内窗洞为 0**。house.yaml 叙事的 8 樘窗（涂装房 6 樘、20.70㎡）**全部落在 suppress 的玻璃幕墙/飘窗让路墙上**（w_mb_south / w_st_south / w_be_south / w_liv_south / w_nw_north / w_west_*），9 条 `bay_sill` 引用的墙无一在涂装声明里——这些墙从来就没被算进涂装面积，无需扣。**但机制保留**：`bay_sill`/`glass_infill` 增加可选 `along`，`shared/paint-scope.ts` 据此定位并扣除；**声明落在涂装实体墙上却不写 along → 记 warning，绝不静默少扣**（当前 0 条告警）。
- **入户花园出范围**：业主裁定"开发商已做好墙面，本期不刷，收房后看情况再说（可能二期）"。`house.yaml` 的 `wall_finish` 由 `paint` 改为新增的第三种值 **`unpainted`**，overlay 删掉该房 4 段声明（26 → **22 段**）。副作用已核实：`PaintTopic` 只对 `paint` 房上色，该房墙面回落到默认暖白 `#f7f5ef`（与 `latex_paint_01` 同色），视觉无变化；方案面板仍会把「乳胶漆方案」列给该房墙面（`objectMapping` 按 `wall:*` 匹配，与 `wall_finish` 无关）——这是既有行为，非本次引入。
- **厨房**：本来就不在范围（`wall_finish: tile`，无任何 paint_region 声明）。C05 已修掉旧口径「`paintWallArea` 对 11 间房算量、把厨房算进去」的问题，此处仅复核确认。
- **算法单源化（本条核心）**：新建 `shared/paint-scope.ts`，把「洞口裁剪 + 毛/净面积 + 按房汇总」收成一个纯函数，**3D 检视态（SceneBuilder）、成本核算（paint-cost-comparison）、预算 painting 科目（budget-calculator）三处全部调它**，禁止任何一处另立口径。这是 C05「三处三个数」的根治。拆法：每段声明在洞口处拆成**洞口以下的左右条 + 洞口以上的通长带**（楣上整段都要刷），面积自动变净。
- **修正后数字**：5 房（主卧/书房/客餐厅/西北次卧/客房），毛墙面 **155.652㎡** − 门洞 **13.23㎡** − 窗洞 **0㎡** = 净墙面 **142.422㎡**；顶面 footprint **103.224㎡**；净计费面积 **245.646㎡**（毛 258.876㎡）。3D 网格 22 段声明 → **35 块平面**（7 段被门洞拆开）。
- **成本影响**：默认口径（面漆 2 遍 + 底漆 1 遍、扣洞）= 面漆 5 桶 + 底漆 3 桶，材料 ¥4,640 + 人工 ¥6,141.15 = **¥10,781.15**，低于 PKG-080 计划 ¥11,500 约 **¥719**（C05 的"+1,232 超支"结论作废——它建立在入户花园该刷这个错误前提上）。对照口径（不扣洞）= ¥11,111.9。遍数仍未裁定，`selectedScenarioId` 恒为 null。**面漆桶数 6 → 5 是本次唯一值钱的变化**（剔入户花园）；门洞扣不扣不改变桶数（13.23㎡ 远小于一桶 120㎡），只改人工与「高亮范围==计费范围」这件事。
- **预算侧同源**：`design-rules.yaml` paint 行项目的 `paintWallArea`（0.75 拍系数、11 房）早已废弃，现读 `paintScopeArea` = 同一函数的净面积。`painting.actual` ¥9,110 → **¥7,447**，状态仍 `ok`。测试断言「预算行项目合计 == 净面积」把三处一致性钉死。
- **顺手修了并行会话未提交代码里的一个类型错误**：`app/src/render/HouseScene.ts` 贴砖检视态 R11 二维判重段 `byFace.set(k, []).get(r)` 的 `Map.get` 用错了键（应为 `.get(k)`），会把 app typecheck 卡死、并让贴砖重叠判重产出伪条目。该行属于对方未提交的贴砖 R11 改动，不在本次涂漆提交内；修复已留在工作区，随对方提交一起落库。另代跑了 `npm run verify:schedule` 同步对方新增 `check_sill_tile` 后的 checklist，并把 `config/facts.yaml` 的 `expect_matches` 49→50（这两处同样属于对方的验收项，未纳入本次提交）。
- **验证**：`tests/server/paint-scope.test.ts` 18 条（22 段声明 / 拆洞后 35 块且可逆 / **逐房间独立复算毛面积** / 门洞拆出左条+右条+通长带 / 窗洞缺 along 告警 / 房间集合与 `wall_finish` 一致且 entry_garden=unpainted / **净面积 = 毛 − 门洞 − 窗洞 且等于预算行项目合计** / 成本四情景 / 未确认假设显形 / 声明漂移即抛错 / 无浏览器全局与 HVAC 耦合 / GLB 默认排除）；`tests/server/paint-comparison-api.test.ts` 5 条；`app/src/scene/HouseScene.test.ts` **+4 条**（含"净面积与门洞扣除量"专测）；`app/src/ui/PaintButton.test.ts` 4 条；`app/src/ui/OverviewMenu.test.ts` +2 条。`typecheck` 0 → `test:server` 708/708/0 → `test:app` 520/520/0 → `verify:all` Exit 0（`verify:facts` 回到基线 14 warnings）→ 起服务实测 `/api/paint/comparison` 与 `/api/budget` 数值一致。
- **关联文件**：`shared/paint-scope.ts`（新）、`shared/render/SceneBuilder.ts`、`app/src/render/HouseScene.ts`、`server/paint-cost-comparison.ts`、`server/budget-calculator.ts`、`server/overlay-merge.ts`、`shared/types.ts`、`config/layout/overlay.yaml`（−4 段声明 + bay_sill/glass_infill 加 `along`）、`config/house.yaml`（entry_garden → unpainted）、`config/paint-comparison.yaml`（删手写洞口常量、`deduct_openings: true`）、`config/facts.yaml`、`tests/server/paint-scope.test.ts`、`tests/server/paint-comparison-api.test.ts`、`app/src/scene/HouseScene.test.ts`、`app/src/ui/OverviewMenu.test.ts`。
- **决策人**：业主。

### DEC-2026-10-08-C07 登记多乐士包工包料报价 55 元/㎡，并折算成三方对照

- **日期**：2026-10-08。业主提供：「多乐士包工包料 55 一平」，要求登记。
- **为什么不能只写个数**：一个裸单价在本项目里是死数字——没有面积口径就没有总额，没有覆盖范围就不能和 PKG-080 计划额比。按 tile-comparison.yaml 的 `candidates` 范式，把外部报价作为**证据**登记进 `config/paint-comparison.yaml` 的 `quotes[]`（不是本模型的假设），由 `server/paint-cost-comparison.ts` 折算成三项对照。
- **登记内容**：`dulux_turnkey_55`，source 多乐士，form `turnkey_labor_and_material`（包工包料），`material_id: latex_paint_01`（对账 materials.yaml 的同一款漆，确保"用的还是这款漆"这个前提可验证），`rate: 55`，`area_basis: net_area`（业主裁定的净计费口径：门窗洞已扣），`observed_at: 2026-10-08`，`quote_status: owner_reported_unconfirmed`，`evidence: 待补`。
- **覆盖范围未确认，显形而不猜**：`coverage: pending_confirmation` + `coats: pending_confirmation`。是否含基层修补（COST-080-01）、找平批刮腻子（COST-080-02）、颜色样板与成品保护（COST-080-04）未知，遍数也未确认。服务端据此出一条 warning，面板上明确写"暂不与 PKG-080 计划额划等号"。**不替业主推断覆盖范围。**
- **折算结果**（净计费面积 245.646㎡）：总额 **¥13,510.53**；高于 PKG-080 计划额 ¥11,500 约 **¥2,010.53**；高于业主目标 ¥11,000 约 ¥2,510.53；高于自下而上"涂刷"模型 ¥10,781.15 约 **¥2,729.38**（折合 **11.11 元/㎡**）。
- **这 11.11 元/㎡ 就是下一步要问清的**：自下而上模型只算涂刷（主材桶数 + 涂刷人工），不含基层/腻子/样品保护。若该报价确实含这几项，11.11 元/㎡ 就是它们的隐含额度——需要回店里要一份分项报价单，把这 2,729 元拆开，才能判断贵还是便宜。**不要因为总额超计划 2,010 元就否定它，也不要因为"多乐士"三个字就认下。**
- **未入台账**：本次只登记进涂漆口径文件与对比面板，**没有改 `schedule/phase-1/control.yaml` 的报价轮次**（那需要书面证据、price_type、component_ids 覆盖口径，走正式 QR 轮次）。拿到报价单后再补 QR 轮次并 schedule:render。
- **验证**：`tests/server/paint-scope.test.ts` +1 条（报价折算三项对照 + 未确认覆盖范围 warning）；`app/src/ui/OverviewMenu.test.ts` 补报价行渲染断言；`test:server` 涂漆相关 24/24、`test:app` OverviewMenu 10/10；起服务实测 `/api/paint/comparison` 返回 quotes 块。
- **关联文件**：`config/paint-comparison.yaml`（+quotes 段）、`server/paint-cost-comparison.ts`（PaintQuoteInput/PaintQuoteResult + 折算与 warning）、`shared/types.ts`（PaintBudgetPreview.quotes）、`app/src/ui/OverviewMenu.ts`（报价行 + 隐含额度说明）、`tests/server/paint-scope.test.ts`、`app/src/ui/OverviewMenu.test.ts`。
- **决策人**：业主。

