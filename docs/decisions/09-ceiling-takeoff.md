# 决策日志 · 吊顶 · 算量与报价

> 本文件是 `docs/decision_log.md` 2026-10-09 主题拆分（DEC-2026-10-09-S01）的产物：
> 收录范围 = 吊顶算量子系统、窗帘盒延长米、报价卡与报价面板、主材参考成本区间与证据台账。条目为原文件的连续切片，正文未改写；文件内按时间正序。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-08-C01` 吊顶算量子系统独立：按分区实算替代房间面积近似（+ trade 工艺分类与一键高亮）
- `DEC-2026-10-08-C02` 窗帘盒人工从吊顶 ㎡ 行拆出，按延长米单列（rate 待报价）
- `DEC-2026-10-08-C03` 吊顶报价卡片：多家报价可切换（量不变、只换单价）
- `DEC-2026-10-08-C04` 吊顶报价面板：App 内并排看数 + 一键切换
- `DEC-2026-10-08-C08` 归档吊顶材料与施工方案（全轻钢 + 9mm ENF 欧松板满铺 + C7 封面），并把业主转述报价登记为候选卡
- `DEC-2026-10-08-C09` 吊顶主材参考成本区间入配置：155 元/㎡ 判定为「配置兑现则价格合理偏好」
- `DEC-2026-10-08-C10` 吊顶主材改证据台账：用可核实电商/工程报价重算，区间 70～115 收窄为 80～103 元/㎡
- `DEC-2026-10-08-C11` 补龙骨用量口径：龙骨从"不可折算"变 36～45 元/㎡，材料额度判定翻转为 below_range
- `DEC-2026-10-08-C12` 代码按施工方真实口径分形态计价：边吊按米、平顶按㎡，报价总额 ¥6,455.70
- `DEC-2026-10-08-C13` 厨卫铝扣板独立计价：先按业主估价 150 元/㎡ 入卡（¥2,454.90）

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-10-08-C01 吊顶算量子系统独立：按分区实算替代房间面积近似（+ trade 工艺分类与一键高亮）

- **日期**：2026-10-08。触发：业主问「吊顶区域，有单独计算的子系统吗？」并要求补上，同时要求「页面加个按钮，一键高亮需要吊顶的区域，不同的吊顶区域用不同的颜色」。
- **问题（口径错误，不是精度问题）**：`config/budget/base.json` 的 `carpentry.labor.area` 长期是 `ceiling`，而 `server/budget-calculator.ts` 的 `case 'ceiling'` 取的是**房间 bbox 面积合计 142.92㎡**——把没有吊顶的 2.80m 平顶、电梯井（4.90㎡）、入户花园（12.91㎡）全计了费，`living_dining` 也按整间 45.88㎡ 计（实际只有 10.57㎡ 是吊顶）。历史快照 `docs/design-iterations/phase1-scope-20260912/evidence/phase1-j6-final-body.txt:119-120` 的 `carpentry ¥5,717 / ¥5,000`（over）就是这个近似值的果。
- **选定方案**：新建 `shared/ceiling-takeoff.ts`（纯函数、零依赖、与渲染同源），按 `config/ceiling.yaml` 的**逐分区声明**实算；同时把「渲染类型」与「工艺/计价类别」分开：
  - **面积口径与渲染严格一致**：阳角圆角扣 `r²(1−π/4)`、阴角 fillet 加 `F²(1−π/4)`；解析值用 `tests/server/ceiling-takeoff.test.ts` 与 `buildMixedRectangleOutline` + shoelace 交叉验证（渲染弧线被采样成折线，必然略小于解析真值）。
  - **展开面积 = 净面积 + 周长×厚度**（施工方对石膏板吊顶通常按展开报价）。
  - **`trade` 工艺类别显式声明，禁止靠 id 前缀推断**（AGENTS.md「代码只读、只执行，禁止推断」）：`gypsum_board` / `aluminum_buckle` / `curtain_box` / `drying_rack`，落在 `config/ceiling.yaml` 的 6 个分区上（5 窗帘盒 + 1 晾衣架吊顶）；`shared/project-render-facts-schema.ts` 用 strict 枚举接住错字，`shared/render/SceneBuilder.ts` 随 `userData.ceiling` 透出到浏览器。归不了的进 `unclassifiedZoneIds` 显形，不猜。
  - **不静默丢弃**：`excludedIds`（6 台 `ac_indoor` 无 area）、`invalidZoneIds`（渲染侧也会拒绝的几何）、`roomIdsWithoutCeiling`（保持 2.80m 原顶的生活阳台/电梯井）、`overlaps` 全部显式输出。
- **业主两问的答复**：
  - **窗帘盒算了吗？算。** 5 个 `curtain_box_*` 全部计量：净 4.463㎡，并**单列延长米 17.85m**（窗帘盒行业主口径是元/米，混在 ㎡ 里会失真）。
  - **区分吊顶类型了吗？区分。** 见上表 `trade` 四类，高亮配色与图例分组、算量小计、报价口径全部按它走。
- **当前声明快照（19 个实心分区 / 25 条声明）**：

  | 工艺类别 | 分区 | 净㎡ | 展开㎡ | 延长米 | 板块 | 计价主口径 |
  |---|---|---|---|---|---|---|
  | gypsum_board 石膏板吊顶 | 10 | 23.222 | 44.506 | 27.07 | — | 元/㎡ |
  | aluminum_buckle 铝扣板 | 3 | 16.366 | 20.554 | 8.30 | 185 | 元/㎡ 或 元/块 |
  | curtain_box 窗帘盒 | 5 | 4.463 | 10.193 | 17.85 | — | 元/延长米 |
  | drying_rack 隐藏晾衣架吊顶 | 1 | 1.080 | 1.800 | 1.80 | — | 元/㎡ |
  | **合计** | **19** | **45.130** | **77.053** | — | — | — |

  铝扣板板块数 185 = 厨房 96（⌈3.6/0.3⌉×⌈2.4/0.3⌉）+ 主卫 54 + 客卫 35；**必须用带 eps 的 ceil**——`1.5/0.3` 在浮点下是 `5.000000000000001`，裸 `Math.ceil` 会把客卫算成 42 块。
- **预算影响（需业主确认的部分单列）**：`base.json` 的 `carpentry.labor.area` 由 `ceiling` 改为 `ceiling_zones`，人工量 = 40 元/㎡ × 45.130㎡ ≈ **¥1,805**（原 ¥5,717），carpentry 由 over 翻 ok，`totalActual` **≈ −¥3,911**。**窗帘盒与铝扣板的费率未动**：`byClass` 只输出数量拆分，改单价=重新谈价，超出本条范围；报价阶段按 README「没有合并项报价」逐项列，主口径见 `GET /api/ceiling/takeoff` / `npm run takeoff:ceiling` / MCP `get_ceiling_takeoff`。若业主希望保留保守预算，`case 'ceiling'` 分支仍在，可回退。
- **待业主裁定（不擅自改几何）**：`curtain_box_master_south`（z[8.70,8.95]）与 `curtain_box_master_west`（x[1.10,1.35], z[5.55,8.80]）在 x[1.10,1.35]×z[8.70,8.80] 上**重叠 0.25×0.10m = 0.025㎡**（合计净面积含这部分重复计费，已由 `takeoff.overlapAreaM2` 单独计量）。是「西盒应收在 z=8.70」还是「转角有意交汇」属设计裁定，本轮只显形不改数。
- **验证**：`tests/server/ceiling-takeoff.test.ts` 12 条（含 eps-ceil 浮点回归、id 改名不跟随归类、重叠检出、渲染轮廓交叉验证）+ `budget-calculator.test.ts` 木工人工口径断言 + `render-facts-api.test.ts` `/api/ceiling/takeoff`；`app/src/render/CeilingZoneHighlight.test.ts` 9 条 + `analysis/ceiling-zone-colors.test.ts` 5 条 + `ui/CeilingZoneButton.test.ts` 3 条；`test:server` 677/677/0 → `test:app` 504/504 → `typecheck` Exit 0 → `verify:all` Exit 0。线上复核：`GET /api/ceiling/takeoff` 19 区 / 净 45.130㎡ / 展开 77.053㎡ / 185 块 / 窗帘盒 17.85m；`GET /api/budget` carpentry 1,805（status ok）。
- **查询三层出口**：`GET /api/ceiling/takeoff`（API）、`get_ceiling_takeoff`（MCP）、`npm run takeoff:ceiling`（CLI，可归档）。三者同源同口径，业主/AI 30 秒可拿逐区面积/展开面积/延长米/板块数，PKG-070 的「待报价/待算量」不再靠手抄。
- **一键高亮按钮（同一DEC交付）**：机电组新增「吊顶分区」按钮（`#ceiling-zone-btn`），开启即给每个分区上色并弹出图例面板。
  - **颜色**：HSL 连续偏移而非固定调色板——19 个实心分区必须 19 个互不相同的颜色（固定色板必然撞色）；每个工艺类别一个色相带（石膏板蓝灰 / 铝扣板青 / 窗帘盒黄 / 晾衣架橙），按 `zoneId` 哈希取点，**新增或删除分区不打乱已有颜色**；图例顶部可切「每分区一色 / 按工艺归并」。
  - **必须走 `exportRoot.traverse` 而不是 `ceilingMeshes`**：后者被 `SceneBuilder` 排除了 `ceilingPersistent` 分区（圆角/阴角区，含主卧门头盒 `ceiling_master_ac`），只用它会漏分区。
  - **与既有机制的打架点全部用「状态 + 重放」解决**：`setCeilingVisible` 在 `setMode` / MEP 总览 / 重建后都会重写天花材质，高亮因此在 `setCeilingVisible` 末尾重放配色；关闭时按 `Map<Mesh, Material>` 快照还原（不写死默认值），反复开关不累积快照。高亮期间强制天花可见（轨道/俯视默认隐藏），关闭即恢复模式默认。
  - **图例即审计**：按工艺分组、每组小计（净/展开/延长米/板块数），行点击=隔离该分区（其余压暗 0.14），hover 该分区在机电信息里给出工艺、净面积、展开面积与板块数。数字全部来自 `HouseScene.inspectCeilingZones()` → `shared/ceiling-takeoff.ts`，与预算/CLI 同一份口径（图数同源，不抓第二套数）。
  - **隔离铁律（源码级测试看守）**：`setCeilingZoneHighlightVisible` / `setCeilingZoneSolo` / `getCeilingZoneHighlightStatus` / `inspectCeilingZones` / `applyCeilingZoneColors` / `restoreCeilingZoneMaterials` 与 App 的播报段，函数体内**不得出现 `Hvac|hvac|WallTile|wall-tile`**（与贴砖检视态 R08/R10 同一手法）。
- **关联文件**：`shared/ceiling-takeoff.ts`（新）、`shared/types.ts`、`shared/project-render-facts-schema.ts`、`shared/render/CeilingZoneBuilder.ts`、`shared/render/SceneBuilder.ts`、`config/ceiling.yaml`、`config/budget/base.json`、`server/budget-calculator.ts`、`server/routes.ts`、`server/mcp-server.ts`、`scripts/project/ceiling-takeoff.ts`（新）、`package.json`、`data/project-render-facts.json`、`tests/server/ceiling-takeoff.test.ts`、`tests/server/budget-calculator.test.ts`、`tests/server/render-facts-api.test.ts`。
- **决策人**：业主。

### DEC-2026-10-08-C02 窗帘盒人工从吊顶 ㎡ 行拆出，按延长米单列（rate 待报价）

- **日期**：2026-10-08。触发：业主在看懂 C01 的分类小计后要求「拆窗帘盒人工」。
- **问题**：C01 把木工人工统一按 40 元/㎡ 铺在「全部实心分区净面积 45.130㎡」上，其中窗帘盒 4.463㎡ 也按 ㎡ 计（≈¥178）。但窗帘盒的行业主口径是**元/延长米**（藏双轨、电动窗帘电源、与墙体/顶面收口都按米算），混在 ㎡ 里既对不上施工方报价单，也违反 README「没有合并项报价」。
- **选定方案**：`config/budget/base.json` 的 `carpentry.labor` 从单对象改为**数组两条计价行**，`server/budget-calculator.ts` 的 `computeLabor` 同时兼容单对象与数组（其余分类不动）：
  1. `ceiling_zones`（元/㎡，rate 40）：吊顶**板面** = 总净面积 − 窗帘盒 = 40.667㎡ → **¥1,627**；
  2. `curtain_box_linear`（元/m，**rate: null = 待报价**）：数量 **17.85 延长米**，取自 `shared/ceiling-takeoff.ts` 的 `byClass.curtain_box.linearM`，与 3D 图例、CLI、API 同一份口径。
- **rate 留空但不静默归零**：`BudgetCategory.pendingLabor` 显形输出 `{area:'curtain_box_linear', quantity:17.85, unit:'元/m', reason:'rate 待报价'}`，API/MCP 的预算快照直接带这个字段；报价回来后只需在 `base.json` 填一个数，不改代码。若把 rate 拍成 0，就是拿「拆分」掩护「少算一笔钱」——README「没有无依据决策」不允许。
- **预算影响**：carpentry actual 由 ¥1,805 降到 **¥1,627**（−¥178，即窗帘盒那 4.463㎡ 的 ㎡ 计价整笔拆出）；`totalActual` 同步下移。**注意预算风险转向**：板面 ¥1,627 + 窗帘盒人工（17.85m × 未定费率）之和可能超过 carpentry 的 ¥5,000 预算——原口径把两者捆在一起时这个风险被掩盖了。取得施工方按米报价后必须与 ¥5,000 对账，超了走 DEC 调预算而不是改数量。
- **未触及**：`shared/ceiling-takeoff.ts` 一行未改（窗帘盒的面积/延长米/分类小计口径 C01 已定）；不改其他分类的 labor 结构；不预设窗帘盒费率（示例：若 30 元/m 则 ¥536，**仅为算术示例，不是报价**）。
- **验证**：`tests/server/budget-calculator.test.ts` 新增 1 条（板面量排除窗帘盒 + `pendingLabor` 精确等于 17.85m + base.json 两行结构）；`test:server` 678/678/0 → `verify:facts` / `verify:schedule` Exit 0 → `typecheck` Exit 0。
- **关联文件**：`config/budget/base.json`、`server/budget-calculator.ts`、`shared/types.ts`（`LaborRate.rate` 可空、`BudgetCategoryRaw.labor` 可为数组、`BudgetCategory.pendingLabor`）、`tests/server/budget-calculator.test.ts`。
- **决策人**：业主。

### DEC-2026-10-08-C03 吊顶报价卡片：多家报价可切换（量不变、只换单价）

- **日期**：2026-10-08。触发：业主问「有多个报价的话，这套架构支持切换吗」，看完 C01/C02 的分层后选方案 A（报价卡片 + 生效开关）。
- **分层结论（先说清楚哪些本来就有）**：**工程量层早已支持多家报价**——所有量由 `shared/ceiling-takeoff.ts` 从 `config/ceiling.yaml` 单独实算，报价方之间只差单价，所以 A 家按毛面积、B 家按展开面积这种「口径对不上」从根上不可能发生。**不支持的是单价层**：`base.json` 的 `labor[].rate` 只有一个生效值，切报价=改文件，不能并排对比、不能一键切换、旧报价不留档。
- **选定方案**：新增 `config/ceiling-quotes.yaml`（`active:` + `quotes[]`，每张卡只写**单价 + 含项范围**，禁止自带面积）+ `server/ceiling-quotes.ts`：
  - `GET /api/ceiling/quotes`：全部候选并排（板面 ㎡、窗帘盒 延长米两行，逐行 subtotal、总额、与生效卡的差额）。
  - `POST /api/ceiling/quotes/active` 与 MCP `set_ceiling_quote`：切换生效卡。**只改写 `active:` 一行**（正则定点替换，保留注释与排版，先留 `.bak`），保证 Git diff 只有一行、业主看得懂；找不到唯一 active 行或 id 不存在 → 抛错不写盘。
  - `BudgetCalculator` 的两个吊顶计价行单价改从**生效卡**取；卡里没写的行回落到 `base.json` 并在对比里标记 `rate_source: 'base.json'`——回落必须看得见，不悄悄替换。
  - 预算快照新增 `ceilingQuotes` 字段（`activeId` + 全量对比），API/MCP/App 拿预算的地方都能看到「当前金额是哪家报出来的」。
- **默认卡 = 现状口径**：`baseline_self_computed` 把 C01/C02 已落地的口径固化成卡（板面 40 元/㎡、窗帘盒 rate null），保证「没有施工方报价时可回退、金额与 C02 完全一致」——测试钉死 carpentry 仍为 ¥1,627、`pendingLabor` 仍为 17.85m。
- **不可直接比较要显形**：报价卡没写 `scope_note`（含辅材/安装/损耗/税费的口径）→ 该候选 `comparable: false` 并给出原因；有 `per_unit: null` 的行 → `total: null`、进 `pendingRows`，**不许把待报价当 0 元**（AGENTS.md 采购铁律）。
- **抗摔**：`ceiling-quotes.yaml` 坏掉（YAML 错/version 错/active 指向不存在的卡）时预算**不冻结**——`BudgetCalculator` 捕获后回落 `base.json` 费率并在服务端日志报错；`parseCeilingQuotes` 本身 fail closed，绝不给默认值。
- **验证**：`tests/server/ceiling-quotes.test.ts` 7 条（量与价分离、并排总额/差额/可比性、回落标记、切换只改一行且留 .bak 保留注释、fail-closed 五种坏输入、基线卡金额不变、坏文件回落）；联机烟测：加假报价 `smoke_kima`（板面 55/㎡、窗帘盒 32/m）→ `POST /active` → carpentry ¥1,627 → **¥2,808**（55×40.6676 + 32×17.85）、`pendingLabor` 清空、`totalActual` +¥1,181；未知 id 被拒并列出可用卡；烟测后已删除该卡并还原 active。`test:server` 685/685/0 → `verify:all` Exit 0 → `typecheck` 0。
- **关联文件**：`config/ceiling-quotes.yaml`（新）、`server/ceiling-quotes.ts`（新）、`server/budget-calculator.ts`、`server/routes.ts`、`server/mcp-server.ts`、`shared/types.ts`、`config/facts.yaml`、`tests/server/ceiling-quotes.test.ts`（新）。
- **决策人**：业主。

### DEC-2026-10-08-C04 吊顶报价面板：App 内并排看数 + 一键切换

- **日期**：2026-10-08。触发：C03 只给了 API/MCP 两个切换入口，业主要求 App 里也能看、也能切。
- **选定方案**：机电组新增「吊顶报价」按钮 → `app/src/render/analysis/CeilingQuotePanel.ts`（`#right-panel-stack` 动态面板，样式沿用 `analysis.css` 与 `OverviewMenu` 瓷砖预览的语言）：
  - **面板不算量**：只渲染 `GET /api/ceiling/quotes` 返回的内容——头部是「板面 40.668㎡ · 窗帘盒 17.85m」（服务端 takeoff 实算），下面每张卡两行 `数量 × 单价 = 小计` + 合计 + 与生效卡的差额。浏览器里不出现第二套面积口径。
  - **切换即 API**：卡上「切换为生效」→ `POST /api/ceiling/quotes/active` → 刷新面板 + 回调 `App.refreshOverviewData()` 刷新总览/预算 → 播报摘要。失败时把服务端错误原文显示在面板顶部（不静默、不抛异常）。
  - **把后果讲清楚**：面板脚注写明「只改写 active 一行、留 .bak、量不变只换单价、需进 Git」；没写含项范围的卡显示 `comparable` 警告，`per_unit: null` 的行显示「待报价」而不是 0。
- **为什么不并进「吊顶分区」面板**：分区面板答「哪里要吊顶、多少量」，报价面板答「哪家多少钱、切哪家」——一个是几何视图、一个是价格台账，混在一起会让业主在 3D 检视时被价格干扰；按钮平级、面板平级，代码也平级（`CeilingQuotePanel` 不引用 3D 与分区高亮任何状态）。
- **验证**：`app/src/render/analysis/CeilingQuotePanel.test.ts` 4 条（渲染算式与生效标记/差额、点击切换的 POST 体与回调、切换失败显示错误、接口坏掉不抛异常）+ `app/src/ui/CeilingQuoteButton.test.ts` 3 条；`test:app` 510/510 → `typecheck` 0 → `build:app` 通过；接口自检 `GET /api/ceiling/quotes` 返回 activeId/quantities/comparison 三块，面板取数即用。
- **关联文件**：`app/src/render/analysis/CeilingQuotePanel.ts`（新）、`app/src/render/analysis/CeilingQuotePanel.test.ts`（新）、`app/src/ui/CeilingQuoteButton.ts`（新）、`app/src/ui/CeilingQuoteButton.test.ts`（新）、`app/src/render/analysis/analysis.css`、`app/index.html`、`app/src/App.ts`。
- **决策人**：业主。

### DEC-2026-10-08-C08 归档吊顶材料与施工方案（全轻钢 + 9mm ENF 欧松板满铺 + C7 封面），并把业主转述报价登记为候选卡

- **日期**：2026-10-08。触发：业主提供一版吊顶材料与施工方案（报价表 + 材料结构 + 主材 + 方案评价 + 性价比备选 + 施工重点 + 中央空调节点 + 当前决策），要求归档。
- **归档位置**：`docs/ceiling-scheme-20261008.md`（新）；报价登记进 `config/ceiling-quotes.yaml` 新候选卡 `owner_turnkey_20261008`；业主采购入口 `schedule/procurement.md` §10 同步。
- **方案本体**：可耐福蓝臻 50 **全轻钢**龙骨（不用木龙骨作主体）+ 千年舟 ENF 9mm 欧松板**满铺**打底 + 可耐福 C7 石膏板封面（双层封板）。定位是**偏扎实的中高配**：用少量材料成本换施工容错、节点可靠性与后期固定便利；代价是材料更多、自重增加、欧松板全铺有堆料属性、普通大平顶性能收益有限。
- **为什么不能直接把 155 元/㎡ 套进报价面板（本条核心）**：业主口径的 155 元/㎡（平顶，包工包料）**只适用于石膏板分区 23.222㎡**；而报价面板「吊顶板面」行的数量 = 总净面积 − 窗帘盒 = **40.668㎡**，其中 **17.448㎡**（厨卫铝扣板 16.366㎡，属 `QR-2026-10-03-08` 铝扣板捆绑单 + 隐藏晾衣架吊顶 1.08㎡，尚未报价）不该由本案报价承担。按这家价计会得 155×40.668 + 105×17.85 = **8,177.73**，比本案真实范围 **5,473.60** 多 **2,704.13 元**——又是「数字对、口径错」。因此候选卡的 `ceiling_zones.per_unit` 记 **null（待报价）**，宁可显形也不让面板显示假总额；`curtain_box_linear` 记 105 元/m（17.85m × 105 = 1,874.25）。
- **第二层口径差**：业主口径还有「边吊 160 元/米」这一**按米计价**的平行口径，而 `config/ceiling.yaml` 的石膏板分区全部声明为 `drop`（无 `integrated` 平顶），模型**拆不出边吊/平顶两类**，报价面板的 ㎡ 行也表达不了按米口径。要机算就得先补声明——本轮不改 `config/ceiling.yaml`。
- **算术（本案真实适用范围）**：石膏板 23.222㎡ × 155 = **3,599.35** + 窗帘盒 17.85m × 105 = **1,874.25** → **5,473.60**（不含铝扣板、晾衣架吊顶、线型灯）。业主自家两个口径的差额 3,187.80 元 ÷ 23.222㎡ ≈ **137.28 元/㎡**，即「龙骨 + 9mm ENF 欧松板满铺 + C7 + 吊杆吊件 + 辅材」的隐含额度。**本项目未对它做过任何南宁市场取证，不做贵/便宜结论**；核验方式是向施工方要分项报价单逐项拆这 137 元/㎡。
- **active 不动**：仍为 `baseline_self_computed`。切到本卡会让预算按 155 × 40.668㎡ 计木工人工（多算 2,704.13 元），正是上面那个口径错；等施工方按本模型计价行出书面分项价再切。同步不改 `config/budget/base.json` 的木工费率行、不动 `DEC-2026-10-08-C02` 的拆分行、不入 `schedule/phase-1/control.yaml` 报价轮次（需 price_type + component_ids + evidence_path）。
- **性价比备选与差值判据（已归档，未裁定）**：欧松板**局部加强**（只做窗帘盒、线型灯槽、空调长风口、回风/检修口、重物位、复杂转角、未来打螺丝位），普通大平顶回到「轻钢龙骨 + C7」。便宜 10～15 元/㎡ 不值得降配（对 23.222㎡ 只省 232～348 元）；便宜 20～30 元/㎡ 以上才值得（省 464～697 元）。**这个决策的全部价值不到 700 元**——先按施工重点验收节点，节点都过再谈这 700 元，顺序不能反。
- **施工重点 11 条已固化为验收清单**（`docs/ceiling-scheme-20261008.md` §6）：龙骨间距不得放大、吊杆吊件牢固、大平顶水平顺直、石膏板错缝禁十字通缝、转角禁简单直缝、风口/回风/检修口周围加强、线型灯提前做基层禁后割、窗帘盒预留轨道基层、自攻螺丝均匀禁打穿纸面、水电/空调/灯线全确认才封板、**封板前拍照归档**。
- **中央空调接口**：施工顺序定为「定内机位 → 定吊顶尺寸 → 定出风/回风/检修口 → 龙骨避让加强 → 欧松板基层 → 石膏板封面 → 开口 → 百叶」；**木工不得脱离空调施工图自行决定风口尺寸**（机型映射见 `DEC-2026-10-04-R1` / `DEC-2026-10-05-R1`，`config/ceiling.yaml` 的 `ac_*` 是非实心分区、不计量，只留协调关系）。
- **接受前提（三条同时成立才认这个价）**：① 三样主材进场验收品牌/型号/环保等级，不接受同档替换；② 欧松板确实满铺；③ 施工重点 11 条全过。
- **显形项**：`config/materials.yaml` **无任何吊顶主材条目**（石膏板/龙骨/欧松板均未入库），本方案品牌型号以文档与报价单为准；入库需先定 `topic_id` 与 `config/design-rules.yaml` 挂接，本轮不做（避免动 `materials.yaml` 条数不变量）。线型灯长度、风口/检修口清单、灯孔数量、晾衣架吊顶 1.08㎡ 报价均未定，是本方案的「未报价/数量待定」四项。
- **验证**：候选卡落盘后 `parseCeilingQuotes` / `compareCeilingQuotes` 实测——本卡 `ceiling_zones` 40.668㎡ 显示「待报价」、`curtain_box_linear` 17.85m × 105 = 1,874.25、`total: null`、`comparable: false`（原因「待报价行：吊顶板面（㎡）」），`active` 仍 `baseline_self_computed`、预算口径不变；`verify:facts` 新增两条豁免（`docs/ceiling-scheme-20261008.md` 全文件 + `config/ceiling-quotes.yaml` 的 area_sqm），未登记出现数回到基线。
- **下一步**：① 业主要书面分项报价单（`docs/ceiling-scheme-20261008.md` §1.1 七问 + 按本模型计价行分行）；② 取得局部加强差价后按判据决定是否降配；③ 进场验收三样主材；④ 封板前拍照并确认水电/空调/灯线完成。
- **关联文件**：`docs/ceiling-scheme-20261008.md`（新）、`config/ceiling-quotes.yaml`（+候选卡 `owner_turnkey_20261008`）、`config/facts.yaml`（+2 条 exempt_occurrences）、`schedule/procurement.md` §10、`shared/ceiling-takeoff.ts`（量）、`server/ceiling-quotes.ts`（单价）、`docs/decisions/09-ceiling-takeoff.md`（本条）。
- **决策人**：业主。

**【DEC-2026-10-07-M01 同日更正 · 代码不产出报价】** 业主指出：没有单价表，代码不该算出报价。原 DEC 里"代码实算主材 ¥10,010 / 人工 ¥5,686 / 总额 ¥20,125"的表述过度硬化——那 24 项 active 单价中 6 项为公开页参考价（电商页、非南宁门店）、18 项为按规则推导的估计，均非报价。已处置：`config/mep-quotes.yaml` 与 `config/mep-labor.yaml` 的 `per_unit` / `rate` 全部退回 `null`，原值移入 `reference_cny` / `reference_rate` **只作展示与谈判锚点、永不参与计算**；`shared/mep-cost.ts` 同步只认 `per_unit`。当前 `npm run takeoff:mep` 输出 28/28 行"待报价"、总额 `null`、blockers 列全——这才是没有单价表时的唯一正确状态。基线文件 `config/mep-material-baseline.yaml` 的 `cost_target.cross_check` 已改标为"历史量级、仅参考、不作依据"。

### DEC-2026-10-08-C09 吊顶主材参考成本区间入配置：155 元/㎡ 判定为「配置兑现则价格合理偏好」

- **日期**：2026-10-08。触发：业主要求把吊顶主材的参考价格写进归档，但明确**写参考成本区间、不写死单价**（这几样公开零售价不透明，经销商与工程渠道差异极大），并要求「给代码算报价」。
- **新增配置 `config/ceiling-material-cost.yaml` + 服务 `server/ceiling-material-cost.ts` + 只读接口 `GET /api/ceiling/material-cost` + `tests/server/ceiling-material-cost.test.ts` 8 条**。无 POST：区间是参考证据，不是可切换的报价。
- **四条铁律（配置头部声明，代码落地）**：① 只记区间；② 张价 → 元/㎡ 一律由 `sheet_size_m2` 现算，配置里不许出现折算结果（换板规格只改一个数）；③ 面积口径只有一份（`shared/ceiling-takeoff.ts` 的 `gypsumBoardM2`），本模块不另立公式；④ 材料额度 = 包工包料 − 纯人工，两个单价由调用方传入、可覆盖。
- **区间表（业主提供，`owner_provided_20261008`）**：欧松板 9mm 80～140 元/张 → 27～47 元/㎡；C7 石膏板 45～70 元/张 → 16～24 元/㎡；蓝臻 50 龙骨 18～28 元/㎡；吊杆吊件等辅材 5～8 元/㎡；切割损耗 4～8 元/㎡；**合计 70～115 元/㎡**（对 23.222㎡ = 1,625.52～2,670.47 元）。蓝臻 50 是可耐福独立吊顶龙骨系列（非杂牌 50 龙骨），归属以本地授权与包装标识为准。
- **本次最有用的一个数**：`155 − 60 = 95 元/㎡`。师傅只有 95 元/㎡ 去覆盖「龙骨 + 9mm ENF 欧松板满铺 + C7 + 辅材 + 损耗 + 材料运输 + 自己的材料利润」，而 95 落在 70～115 区间内（距下限 +25、距上限 −20）。**因此把价格评价从「很划算」修正为「配置兑现的话，价格合理偏好」**——尤其欧松板确实满铺时更有竞争力（满铺毛算约 7.8 张）。
- **结论只出三态，不出市场判断**：`below_range` / `within_range` / `above_range` + 余量。低于下限才触发「必须核进货单、防降档」告警。全区间仍是 owner_provided → 固定 warn「不作为结算依据」；另 warn「区间不含施工方利润、超高费、清运与成品保护」与「改局部加强时欧松板项要跟着下调」。
- **取整口径（差点成为口径漂移）**：张价折算必须取整到元，不能留一位小数——留一位会得 26.9 + 15.6 + 18 + 5 + 4 = **69.5**，与归档表读到的 **70** 对不上。代码与表必须同一把尺子，测试钉死 27/47、16/24、合计 70/115。
- **一处显形的新对比**：§3.2 的 137.28 元/㎡ 是把窗帘盒的材料也摊进石膏板面积得到的（窗帘盒包工包料与纯人工差 55 元/米，摊到 23.222㎡ 是 42.28 元/㎡）；95 元/㎡ 只用平顶价差。两者并列说明**窗帘盒那一档材料额度（55 元/米）也偏宽**，核验时分项单要单独拆窗帘盒。
- **不改动**：`config/ceiling-quotes.yaml` 的候选卡与 `active`（仍是 C08 的候选卡，板面行待报价）；`config/budget/base.json`；`config/materials.yaml` 仍无吊顶主材条目（入库需先定 `topic_id`，本轮不做）。
- **验证**：`tests/server/ceiling-material-cost.test.ts` 8/8（张价折算与取整、合计区间与金额区间 = 单价 × takeoff 面积、三态判定与告警文案、覆盖单价不动配置、owner_provided 必须 warn、七类结构错误 fail closed、面积为 0 不许对账）；`verify:facts` 新增 1 条 config 豁免 + 5 条 coverage 登记，回到基线（详见下方已知 FAIL 说明）。**注意：工作区现有 1 条 `verify:facts` FAIL（`fact.circuit_count` 在 `config/mep-quotes.yaml` 的镜像 `/ (\d+)\s*路 /` 命中 0 次、期望 2 次）属并行会话未提交的水电子系统改动，不是本次引入——把 facts.yaml 还原到 HEAD 再跑即为 0 error。**
- **下一步**：拿到本地进货单后把 `evidence` 升级为 `local_invoice` 并重出判定（`docs/ceiling-scheme-20261008.md` §9 第 6/7 条）。
- **关联文件**：`config/ceiling-material-cost.yaml`（新）、`server/ceiling-material-cost.ts`（新）、`server/routes.ts`（+GET `/ceiling/material-cost`）、`tests/server/ceiling-material-cost.test.ts`（新）、`docs/ceiling-scheme-20261008.md`（+§2.3/§2.4/§4.1/§0/§9）、`config/facts.yaml`（+1 豁免 + 5 coverage）、`schedule/procurement.md` §10。
- **决策人**：业主。

### DEC-2026-10-08-C10 吊顶主材改证据台账：用可核实电商/工程报价重算，区间 70～115 收窄为 80～103 元/㎡

- **日期**：2026-10-08。触发：业主要求「用真实电商有报价的做参考」，并提供一组带来源的可核实价格（欧松板 80、85 元/张；可耐福普通板 47.70/53.30 元/张@3000×1200；耐潮板 75、耐水板 85 元/张@1200×2400；50 副龙骨 6.34、卡式主龙骨 8.50、边龙骨 4.10 元/米；C7 与蓝臻 50 京东价格隐藏、SKU 在售）。
- **配置改为证据台账结构**：`config/ceiling-material-cost.yaml` 的 `sheets`/`area_rates` 合并为 `items[]`，每条材料带 `observations[]`（grade + rate/min/max + unit + sheet_size_m2 + source + observed_at + caliber），没台账的价格不许入库；`server/ceiling-material-cost.ts` 重写，按 verified > comparable > owner_reported 分流，`comparable_off_spec` / `in_stock_no_price` / `product_confirmed` 只登记不折算。
- **折算结果（代码现算）**：欧松板 80/85 ÷ 2.9768 → **27～29 元/㎡（verified）**；C7 用同级耐潮/耐水板 75/85 ÷ 2.88 → **26～30 元/㎡（comparable 旁证）**；龙骨 **18～28 元/㎡（owner_reported，不可机算）**；辅材 5～8、损耗 4～8（owner_reported）。**合计 80～103 元/㎡**，对 23.222㎡ 为 ¥1,857.73～2,391.82。
- **判定变化**：材料额度 95 元/㎡ 仍 `within_range`，但 slackVsMin +25 → **+15**、slackVsMax −20 → **−8**。结论从「合理偏好」改成 **「合理但材料侧没有余量」**，代码新增「距参考上限 ≤10 元/㎡」告警。
- **结构性看点（本案最有用的一眼）**：两张板 27～29 + 26～30 = **53～59 元/㎡**，把 95 元里的近六成先吃掉；剩下 36～42 元要覆盖龙骨 18～28 + 辅材 5～8 + 损耗 4～8（合计 27～44）+ 运输 + 师傅利润。最坏情况（C7 按同级耐水板拿货、龙骨取 28）= 42 对 44，**刚好贴住**。
- **两处口径修正（本条核心）**：
  ① **规格差一倍不许混算**。家装 1200×2400 = 2.88㎡/张，工程 3000×1200 = 3.6㎡/张；47.70 元/张按家装算是 16.6 元/㎡、按工程规格只有 13.3 元/㎡。故鑫方盛 47.70/53.30（且 100/80 张起订、普通板功能档低于 C7）判为 `comparable_off_spec`，**只登记不进区间**。折算一律按**各观察自己的 sheet_size_m2** 算。
  ② **龙骨单价可核实、金额不可机算**。三条米价（6.34/8.50/4.10）是真的，但折算 元/㎡ 需要每平米用量（吊杆间距、主副龙骨间距、边龙骨周长），模型与配置都没声明。新增 `per_metre_unconverted`：米价进 `unconvertedEvidence` 显形，判定仍用业主的 18～28 元/㎡ 并标 owner_reported。**这个用量口径正是施工重点第 1 条「龙骨间距不得为省材料放大」缺的那个数**——补上它，本项即可升级 verified。
- **C7 是本案唯一拿不到可核实成交价的主材**：只能确认产品在售（耐水、抗菌、防霉、抗下陷、净醛）。旁证用同档耐潮/耐水板，但 C7 比它们多净醛/抗菌功能，属高端线——若真实拿货价高于旁证，区间上限还要上移。**C7 规格（1200×2400 还是 3000×1200）也未确认**，代码按未确认规格出告警。
- **欧松板上限的业主口径被证据推翻**：业主原给 80～140 元/张，可核实证据只到 85（85 那条还是 E0 级、低于本案 ENF 档，偏保守）。ENF 级 9mm 的真实成交价仍是下一步要向本地经销商要的数；「ENF 99 元/张」那条因检索结果未标厚度**不能当 9mm 价**，不入台账。
- **不改动**：`config/ceiling-quotes.yaml` 的候选卡与 active（仍是 C08 那版）；接口仍只读无 POST；面积口径仍是 takeoff 的 `gypsumBoardM2`。
- **验证**：`tests/server/ceiling-material-cost.test.ts` 10/10（各观察按自己规格折算、verified 优先与取整、合计与金额区间、三态与贴上限告警、证据分级点名、米价不可折算、在售无价只显形、规格未确认告警、13 类结构错误 fail closed、面积为 0 不许对账）；`tests/server/api.test.ts` 11/11（含 `/api/ceiling/material-cost` 的 evidenceMix / offSpec / unconverted 断言）；`tsc --noEmit` 0。
- **下一步**：① 向经销商要 C7 与蓝臻 50 的书面价（本案唯一两个不可核实项）；② 声明龙骨每平米用量口径，把龙骨项升级为 verified；③ ENF 级 9mm 欧松板成交价。三条回来后把对应 `evidence` 从 owner/comparable 升级，重跑 §4.1 判定。
- **关联文件**：`config/ceiling-material-cost.yaml`（结构改为 items[] + observations[]）、`server/ceiling-material-cost.ts`（重写：证据分流 + per_metre_unconverted + 贴上限告警）、`tests/server/ceiling-material-cost.test.ts`（重写，10 条）、`tests/server/api.test.ts`、`docs/ceiling-scheme-20261008.md`（§0/§2.3/§2.4/§4.1 改为可核实口径）、`schedule/procurement.md` §10、`docs/decision_log.md`（本条，C09 的区间表与结论由本条修正）。
- **决策人**：业主。

### DEC-2026-10-08-C11 补龙骨用量口径：龙骨从"不可折算"变 36～45 元/㎡，材料额度判定翻转为 below_range

- **日期**：2026-10-08。触发：业主追问「数据不够？」。确实不够——**龙骨占了材料成本的三成却完全不可机算**（单价可核实、缺每平米用量）。本条把这一项补成可折算，并顺带查出本案一个结构性成本。
- **新证据（公开检索，2026-10-08）**：① 用量口径——主龙骨间距 1000mm（规范 800–1200mm）→ 0.83～1.25 米每平米；副龙骨间距 400mm、不加横撑（规范 300–400mm）→ 2.5～3.33 米每平米；行业算例给「每平方主龙骨 1 米、副龙骨 2.5 米、边龙骨 0.4 米」，后者按 **10m×10m 单区**算。② 50 主龙骨 50×15×1.2mm（GB/T 11981-2024）招标页 20.81 元/米——是**上人型**，本案不用，只登记为价位上限。③ 「蓝臻」被证实是可耐福吊顶**系统**系列（蓝臻系列石膏板 + 配套热镀锌轻钢龙骨 + 专用配件），另有「蓝均 Pro 系列 + 蓝均镀铝锌龙骨」提法 → 进场必须核包装。
- **配置新增 `usage_assumptions`**，服务新增 `per_metre_derived`：逐构件「米价 × 用量」折算，`source: takeoff_perimeter` 的用量由代码从 takeoff 周长实算，**手抄会被 fail closed 拦下**（`takeoff_perimeter` 与 `metres_per_sqm` 同时出现即抛错）。
- **折算结果**：主龙骨 8.50×0.83～1.25 = 7～11；副龙骨 6.34×2.5～3.33 = 16～21；边龙骨 4.10×**3.06** = 13 → **龙骨 36～45 元/㎡**（comparable，米价是可耐福普通/卡式系列，非蓝臻）。业主口径是 18～28 元/㎡。
- **本案结构性发现（本条最有价值的产出）**：边龙骨 3.06 米每平米 = **全部分区周长 70.95m ÷ 石膏板净面积 23.222㎡**，是行业算例 0.4 米每平米（按 10m×10m 单区）的 **7.7 倍**。原因是本案 10 个分区（客餐厅设备带 / 走廊 / 门厅 / 各房边吊 / 窗帘盒）犬牙交错，周长面积比天然高。**这是模型算出来、肉眼和经验值都看不出的成本**，也是业主口径低估龙骨的主因。已标 `model_derived_upper_bound` 并告警：真实边龙骨只沿墙与错台边，同标高相接的内部边不需要，实际用量低于此上界、须现场核定。
- **判定翻转**：材料区间 98～120 元/㎡（¥2,275.72～2,786.59）> 材料额度 95 元/㎡ → `verdict: below_range`、`slackVsMin: −3 元/㎡`。同时并列 `ownerOnlyPerSqm: 70～115`（全按业主转述口径，95 落在区间内），并出「两个口径给出不同结论，下限差 28 元/㎡、上限差 5 元/㎡，全部来自未核实数据」告警。**不许只报一个数。**
- **结论从"合理但贴上限"改成**：155 元/㎡ 不算离谱，但按可核实价格与规范用量，材料成本已贴住并略超额度；**这个报价能否兑现完全取决于进场材料真实等级，而不是师傅手艺**。缺口只有 3 元/㎡（3%），可能被批量价/本地渠道/损耗控制抹平——所以它的正确用法是把验收重心压在进场材料上（龙骨是否蓝臻、欧松板是否 ENF、C7 是否真 C7），不是据此推翻交付。
- **仍然不够的四项（诚实清单）**：① **C7 成交价**——无任何公开价，只能用同级耐潮 75 / 耐水 85 元每张旁证；② **蓝臻 50 龙骨价格**——京东在售但价格隐藏，只能用可耐福普通/卡式系列 8.50/6.34/4.10 元每米旁证（蓝臻是同品牌更高档，实际价应不低于此）；③ **千年舟 ENF 9mm 欧松板成交价**——只有 E0 级 85 元每张与电商索引 80 元每张；检索到的「ENF 99 元每张」未标厚度、「ENF 800 元每投影」是柜体成品价、「116 元每张」是**中密度板不是 OSB**，三条都不可用；④ **辅材与损耗**——完全无来源，纯业主口径。另有一条未裁定项：**横撑龙骨**（间距 600–800mm）本案未计入，若现场要求加，约 +8～11 元每平米，代码只告警不取值。
- **验证**：`tests/server/ceiling-material-cost.test.ts` 13/13（逐构件折算与用量来源、边龙骨上界 7.7 倍、合计与金额区间、below_range 与告警、三态随单价翻转、证据分级点名、敏感性并列、在售无价/off_spec 只显形、缺用量不许折算、18 类结构错误 fail closed）；`tests/server/api.test.ts` 11/11；`tsc --noEmit` 0；`verify:facts` 0 error（新增 `usage_assumptions` coverage 登记）。
- **下一步**：见 `docs/ceiling-scheme-20261008.md` §9 第 6–9 条（核进货单、现场定龙骨用量与边龙骨沿边、局部加强重估、进场核包装系列）。
- **关联文件**：`config/ceiling-material-cost.yaml`（+usage_assumptions、龙骨项改 per_metre_derived）、`server/ceiling-material-cost.ts`（+per_metre_derived / derivedComponents / ownerOnly 敏感性 / 上界告警）、`tests/server/ceiling-material-cost.test.ts`（重写，13 条）、`tests/server/api.test.ts`、`docs/ceiling-scheme-20261008.md`（§0/§2.3/§2.4/§4.1/§9）、`config/facts.yaml`（+usage_assumptions coverage）、`schedule/procurement.md` §10、`docs/decision_log.md`（本条，C09/C10 的区间表与结论由本条修正）。
- **决策人**：业主。

### DEC-2026-10-08-C12 代码按施工方真实口径分形态计价：边吊按米、平顶按㎡，报价总额 ¥6,455.70

- **日期**：2026-10-08。触发：业主给出施工方的完整报价结构——**边吊 160 元/米、平顶 155 元/㎡、窗帘盒 105 元/米、线型灯安装 10 元/米、灯孔免费开**，要求按这个口径算。之前代码只能按「一个 155 元/㎡」近似，正是本文要修掉的。
- **为什么必须分形态**：边吊是 0.5～0.9m 宽的窄带，按米折成 ㎡ 是 178～320 元/㎡，是平顶（155 元/㎡）的 1.2～2 倍。混成一行算，总额会差 **¥982.10**（¥5,473.60 vs ¥6,455.70）。
- **声明层**：`config/ceiling.yaml` 的 10 个石膏板分区全部补 `pricing_form`——8 个 `edge_drop`（客厅北缘边吊+设备带、书房北缘边吊、主卧门头盒、客房北墙边吊及 L 拐角、儿童房南墙边吊、餐厅南北两条服务带）+ 2 个 `flat`（主走廊满吊、入户门厅满吊）。铝扣板/窗帘盒/晾衣架各有自己的计价行，不需要声明；漏声明的石膏板分区进 `unclassifiedPricingFormIds` 显形（当前 0 条）。
- **算量层**：`shared/ceiling-takeoff.ts` 新增 `edgeDropLinearM`（边吊长边之和 **21.475m**）、`edgeDropNetAreaM2`（15.832㎡）、`flatNetAreaM2`（**7.390㎡**）。**覆盖不变量由测试钉死**：边吊面积 + 平顶面积 = 石膏板净面积 23.222㎡。两种单位的量不许相加。
- **报价层**：`server/ceiling-quotes.ts` 新增两条计价行 `gypsum_edge_drop_linear` / `gypsum_flat_sqm`，并新增 **`out_of_scope` 语义**——「这家不报这项」≠「这项待报价」。厨卫铝扣板归 `QR-2026-10-03-08` 那张 ¥9,537 单，属超出范围：**总额照算，该行只显形**；若是待报价，总额必须留空不编。这是本轮总额能算出来的关键。面板同步：超出范围的行灰掉、不显示金额、不写"待报价"，并显示"本家覆盖：…"。
- **算出来的报价**：边吊 21.475m × 160 = ¥3,436.00 + 满吊平顶 7.390㎡ × 155 = ¥1,145.45 + 窗帘盒 17.85m × 105 = ¥1,874.25 = **¥6,455.70**。**未含**：厨卫铝扣板（另有报价单）、隐藏晾衣架吊顶 1.08㎡、线型灯（10 元/米但长度未声明）、灯孔（免费）。`active` 仍为 `baseline_self_computed`（¥1,626.70 + 待报价），预算口径不变。
- **连带修正 C11 的结论**：材料额度改按分形态口径算——石膏板包工包料 ¥4,581.45（197.31 元/㎡）− 纯人工 ¥1,731.90（74.75 元/㎡）= **¥2,849.55 = 122.71 元/㎡**，对照可核实材料区间 98～120 元/㎡ → **`above_range`，高于上限 2.71 元**。C11 的「低于下限 3 元」是"全部按 155 元/㎡"这个近似造成的假象（把边吊溢价算丢了，低估额度 27.71 元/㎡）。**修正后结论：材料这一项基本够，甚至略宽**；旧口径仍保留在配置里作对照，两个口径都能跑，测试各钉一套。
- **两个未定量**：① 边吊计价长度取各分区**长边（中线）**；L 形拐角 `ceiling_study_ac_corner` 按展开边算会多约 1.2m ≈ ¥192，须与施工方确认量法；② 施工方 160 元/米是否按标准宽度报价需确认（本案带宽 0.5～0.9m 不一）。
- **验证**：`tests/server/ceiling-quotes.test.ts` 10/10（分形态量、覆盖不变量、out_of_scope 与待报价的区别、总额 6,455.70、未知 out_of_scope 抛错）；`tests/server/ceiling-material-cost.test.ts` 14/14（分形态额度 122.71、旧口径 95 的假象、三态随单价翻转）；`tests/server/api.test.ts` 12/12；`tests/server/ceiling-takeoff.test.ts` 全绿；`app` CeilingQuotePanel 5/5（边吊按米显示、超出范围行不显示金额）；`tsc --noEmit` 0；`verify:facts` 0 error。
- **关联文件**：`config/ceiling.yaml`（+10 条 `pricing_form`）、`shared/ceiling-takeoff.ts`（+edgeDrop/flat 量与 unclassified 显形）、`shared/types.ts`（+`pricing_form` 字段与常量）、`shared/project-render-facts-schema.ts`（Zod 同步）、`server/ceiling-quotes.ts`（+2 计价行 + out_of_scope + coveredScope）、`server/routes.ts` / `server/budget-calculator.ts` / `server/mcp-server.ts`（fallback 兜底 null）、`app/src/render/analysis/CeilingQuotePanel.ts` + `.test.ts` + `analysis.css`、`config/ceiling-quotes.yaml`（候选卡改四行 + out_of_scope）、`config/ceiling-material-cost.yaml`（contractor_rates 改 forms）、`docs/ceiling-scheme-20261008.md`（§0/§2.4/§3.2/§3.3 新节/§4.1/§9）、`schedule/procurement.md` §10、`docs/decisions/09-ceiling-takeoff.md`（本条）。
- **决策人**：业主。

### DEC-2026-10-08-C13 厨卫铝扣板独立计价：先按业主估价 150 元/㎡ 入卡（¥2,454.90）

- **日期**：2026-10-08。触发：业主要求"厨卫铝扣板吊顶先按 150 元/㎡ 估价"。
- **归属确认**：铝扣板是另一家的货、另一张单——`QR-2026-10-03-08`（厨卫铝扣板+收边+2 浴霸+凉霸+灯，书面报价 ¥9,537，全仓唯一带报价单项）。因此新增独立计价行 `aluminum_buckle_sqm`，量取 `takeoff.aluminumBuckleM2`，与石膏板的边吊/平顶两行、混合口径行**互相 `out_of_scope`**，三张卡之间不会重复计费。
- **量（takeoff 实算）**：16.366㎡ / 185 块 300×300（厨房 8.640㎡·96 块、主卫 4.576㎡·54 块、客卫 3.150㎡·35 块）。
- **估价卡** `aluminum_buckle_owner_estimate_150`：`per_unit: 150 元/㎡`、`status: candidate`、`contractor: 业主估价（非报价单）`、scope_note 明写"非成交价" → **总额 ¥2,454.90**；`active` 不动，预算口径不变。
- **连带语义修正（重要）**：基线卡 `baseline_self_computed` 只用混合口径行计价，四条拆分行对它而言是「不用」而不是「没报」——已把 `gypsum_edge_drop_linear / gypsum_flat_sqm / aluminum_buckle_sqm` 加进它的 `out_of_scope`，否则只要有一行待报价，基线总额就永远被卡成 null。修正后基线 `pendingRows` 只剩 `curtain_box_linear`，行为与 C02/C03 一致。
- **诚实提示（已写入文档与卡内）**：150 元/㎡ 是**地板价**，不是市场判断。原 ¥9,537 捆绑单剔除已拆走的浴霸（奥普 S2-Air ≈¥1,362）与凉霸（¥999，不做）后，反推「铝扣板+收边+开孔」裸价约 **275～408 元/㎡**；此前给商家定的裸价重报目标 ≈¥4,500（≈275 元/㎡）。按 150 算的 ¥2,454.90 与 ¥4,500 差 **≈¥2,045**，预算要按后者留余量。
- **类型漂移顺手修掉**：`shared/types.ts` 的 `BudgetSnapshot.ceilingQuotes` 是手抄的窄版形状，缺 C12 新增的 `outOfScopeRows / coveredScope / out_of_scope`（运行时有、类型上没有， excess property 不报错所以一直静默）。已补全，否则快照消费方拿不到这几个字段。
- **本案覆盖范围合计**：石膏板 + 窗帘盒 ¥6,455.70 + 铝扣板估价 ¥2,454.90 = **¥8,910.60**（仍不含隐藏晾衣架吊顶 1.08㎡ 与线型灯）。PKG-070 计划额仅 ¥6,000，缺口将在商家裸价到手后一并重算。
- **验证**：`tests/server/ceiling-quotes.test.ts` 11/11（新增：铝扣板卡总额 2,454.90、三张卡互不重复计费、基线卡 out_of_scope 修正、估价卡必须带"非报价"标注）；`tests/server/api.test.ts` 12/12；`tsc --noEmit` 0（吊顶相关）；`verify:facts` 吊顶相关 0 FAIL（现存 5 条 FAIL 全在并行会话未提交的 `config/mep-quotes.yaml` / `config/mep-labor.yaml`，非本次引入）。
- **下一步**：向商家催「铝扣板+收边+开孔」裸价书面报价（目标 ≈¥4,500），到手后替换该卡 `per_unit` 与 `status`。
- **关联文件**：`config/ceiling-quotes.yaml`（+候选卡 `aluminum_buckle_owner_estimate_150`、基线卡与石膏板卡补 out_of_scope）、`server/ceiling-quotes.ts`（+`aluminum_buckle_sqm` 计价行）、`server/routes.ts` / `server/mcp-server.ts` / `server/budget-calculator.ts`（fallback 补 null 行）、`shared/types.ts`（快照形状补三字段）、`tests/server/ceiling-quotes.test.ts`、`tests/server/api.test.ts`、`docs/ceiling-scheme-20261008.md`（§3 表 + §3.4 新节 + §8.4 + §9）、`schedule/procurement.md` §10、`docs/decisions/09-ceiling-takeoff.md`（本条）。
- **决策人**：业主。

