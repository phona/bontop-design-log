# 决策日志 · MEP · 综合

> 本文件是 `docs/decision_log.md` 2026-10-09 主题拆分（DEC-2026-10-09-S01）的产物：
> 收录范围 = MEP 分层标高裁定、水电工程口径兜底、水电主材选型基线归档。条目为原文件的连续切片，正文未改写；文件内按时间正序。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-06-R1` 水电工程口径兜底轮：几何自洽 + 给排水缺项建模
- `DEC-2026-10-06-R5` #41 裁定：MEP 分层标高升入降板空腔，保走廊净高 2.50m
- `DEC-2026-10-07-M01` 归档水电主材选型基线（业主锁死项 + 成本目标 + 反转条件）

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-10-06-R1 水电工程口径兜底轮：几何自洽 + 给排水缺项建模

- **日期**：2026-10-06。触发：全水电 review 后，业主授权"工程标准答案明确的项由 AI 按业界最佳实践兜住，不逐项请示"。
- **范围**（两类，均不涉业主取舍）：①几何/坡度/坐标不自洽——lint 新规则 `route_not_orthogonal` 3 条、`gravity_slope_geometry_mismatch` 14 条、穿点坐标漂移（`water-master-bath` 穿点 x=0.26→0.575 对齐盆心、`water-master-bath` 首段斜线、`water-guest-bath` 末段斜线、`water-garden-requirement` seg2 斜线）；②给排水缺项建模——燃气热水器冷热水 + **回水管三通**（DEC-009 已决策预埋但配置层 0 路线）、洗碗机进水、全宅进水总阀 DN20 + 减压 0.25MPa + 前置过滤器位、主卫沉箱 DN50 二次排水、洗衣机专用墙排独立接管（**不通地漏**）、RO 浓水排放、管径分级 de110 排污 / de75 干管 / de50 支管 + 水封 ≥50mm + 通气管/间接排水。
- **口径**（业界通行 / 规范 / 厂家安装手册）：重力管坡度 1%（阳台 2%）、禁上弯、禁直插密封下水；同层排水沉箱必须二次排水 + 轻质回填 + 回填前通球与 24h 闭水；管径分级按《建筑给水排水及采暖工程施工质量验收规范》GB 50242 与通用图集；等电位/防溅/零线按 GB 55038-2025。新点位/新路线一律带精度三件套（`status: inferred` + `construction_status: pending` + `not_for_construction`），坐标只取自 `docs/pending-site-data.md` 已登记推断值或以 `design_requirement` 路线表达需求（不写显式坐标端点）。
- **影响**：#41 的 clearance 实算数可能因新增排水路线而变化——按契约 `c.mep_layer_below_drop_bottom.repair_channel` 通道办理（附本 DEC 全引 + 同步 ceiling.yaml / guidance §0 / pending-site-data #41 / facts.yaml 四处）。
- **验证**：`verify:all` / `test:server` / `typecheck` 见执行记录。
- **未动**：#41 分层标高裁定、强电箱迁位、空调内机逐台回路三项属设计迭代，另见 DEC-2026-10-06-R3。

### DEC-2026-10-06-R5 #41 裁定：MEP 分层标高升入降板空腔，保走廊净高 2.50m

- **日期**：2026-10-06。触发：业主确认"吊顶应遮盖管线"的常态施工口径，而模型里强电 2.45 / 冷凝水 2.35 低于走廊满吊完成面 2.50，属标高数值缺陷（走线路径与"贴吊顶/贴墙、吊顶遮盖"的原则不变）。
- **裁定**：**方案① 管线分层升入降板空腔**，不改降板厚度、不降净高。同步废止方案②（降板加厚到 0.35–0.40m、净高 2.40–2.45m）。
- **标高口径（分区，非全局单一值）**：
  - **A 区（走廊/门厅/客厅北缘边吊/餐厅两条服务带/各房边吊，完成面 2.50）**：强电 ≥2.55、弱电 ≥2.55、冷媒 ≥2.60、冷凝水 ≥2.60；上限按轻钢龙骨+板材占用后 **≤2.75**；层间保持强弱电分离与冷凝水保坡。
  - **B 区（厨房铝扣板/两卫铝扣板，完成面 2.65，空腔仅 150mm）**：进入该区的管线路由标高 **≥2.70 且 ≤2.76**。
  - **硬约束**：任一路由在参考梁约束带内必须**低于该梁参考梁底 −0.05m**（`config/hvac.yaml` reference_constraints：厨房局部梁头 2.56、走廊服务带 2.65、南窗带 2.73、厨房北窗带 2.65、主卫梁头 2.41）；不能同时满足"高于完成面"与"低于梁底"的路由，**优先改平面绕开梁带（保持正交）**，不得靠压标高糊过去。
- **配套口径修正**：`c.mep_layer_below_drop_bottom` 的检查范围收窄为**吊顶承载层**（强电/弱电/冷媒/冷凝水/送风/回风）；**走地给排水分层（water_supply 0.18 / drainage 0.10）不参与"低于吊顶完成面"比较**——地面管与吊顶完成面无可比性，原口径把 13 处地面管计入冲突、稀释真信号。该口径变化按契约修正通道登记（附本 DEC 全引 + 4 文件同步），不是消音。
- **影响**：`config/mep-hvac-coordination.yaml` 的 `layers` 标高与相关 route 的 via/from/to/penetration 高度按区分层重算；重力管（冷凝水/排水）坡度与"不得上弯"铁律继续成立；路线条数 87 不变（除非绕梁必须新增，需另登 DEC）。
- **验证**：`verify:all` / `test:server` / `typecheck` 见执行记录；GLB 重导。
- **未动**：走线路由平面、吊顶范围与降板厚度、穿墙点平面坐标、空调内外机与末端选型。

### DEC-2026-10-07-M01 归档水电主材选型基线（业主锁死项 + 成本目标 + 反转条件）

- **日期**：2026-10-07。触发：业主提供一版「主流国产、不过度堆料、但把基础质量拉满」的水电材料基线（规格表 + 品牌档位 + 锁死项 + 成本目标），并要求归档。
- **归档位置**：`config/mep-material-baseline.yaml`（新文件；`specs` / `brand_tiers` / `locked_choices` / `cost_target` / `reversal_conditions` / `pending_actions` 六段）。选型方向归它，**单价与米数不在这里**——单价在 `config/mep-quotes.yaml`、米数由 `shared/mep-takeoff.ts` 派生，禁双写。业主采购入口同步更新 `schedule/procurement.md` §02。
- **按采购铁律分层**：① 项目硬约束 = 本文件的 `specs` + `locked_choices`；② 研究支持的首选/备选 = `brand_tiers` + `config/mep-quotes.yaml` 的 candidates（多数仍是 `public_reference`/`derived_estimate`，**不是成交价**）；③ 现场反转条件 = `reversal_conditions` 五条（微蒸烤线径、底盒深浅、配电箱单双排、前置与减压阀、弱电箱与光纤）。
- **规格层已与算量底座对齐**：管径分档（dn25 主管 / dn20 末端 / de50-75-110 排水）、芯数（照明 3 芯含零线、插座 L/N/PE、大功率 4mm²）已在 `config/mep-takeoff.yaml` 的 `units` 与 `pipe_route_segments` 生效；`mixed` 自动拆冷/热两根物理管。
- **与现行配置的三处冲突已显形，不静默改**：① 微蒸烤：基线写 4mm²，而 `electrical-topology` 现为 C16A+漏保/2.5mm²（美的 GC5 3200W、16A 插座口径）——按铭牌终核，若定 4mm² 须同步 wire_size/管径/箱体模数；② 底盒"加深型优先"与剪力墙 40mm 薄盒上限冲突——分墙型处理；③ 弱电箱"加大箱体 + 2 芯光纤"在现行配置里没有光纤点位、现登记箱体为开发商预留 400×300mm——量房后补登记。
- **成本目标 vs 代码实算（2026-10-07 口径，`npm run takeoff:mep`）**：业主目标材料 1.0~1.4 万、人工约 5,000、全阶段 1.6~2 万；代码算得主材小计 **¥10,010**（落在目标区间内）、人工 **¥5,686**（市价参考 60 元/㎡，高于业主口径 40 元/㎡）、总额 **¥20,125**（含 10% 不可预见，略高于目标上限 ¥125）。差异全部来自人工口径，不是材料超配。
- **为什么这版能拿去报价**：量已经有确定性来源（92 条 MEP 路由 + 111 电气点位 + 27 给排水点 + allowange 规则），师傅开的材料单可以逐项对着 `config/mep-quotes.yaml` 的 active 单价与 takeoff 数量核；他自带面积/米数不认（铁律同 `config/ceiling-quotes.yaml`）。
- **未入 QR 轮次**：本次只归档基线与成本目标；正式报价轮次要等师傅材料单或门店书面报价（需 price_type + component_ids + evidence_path），届时补 `hard_finish_quote_rounds` 并 `npm run schedule:render`。
- **下一步**：师傅开单后做「规格 / 数量 / 单价 / 是否必要 / 是否超配」采购审核表；取得南宁门店书面报价后把 `config/mep-quotes.yaml` 的 `price_type` 升级为 quoted_sheet。
- **关联文件**：`config/mep-material-baseline.yaml`（新）、`config/mep-takeoff.yaml`（units / pipe_route_segments）、`config/mep-quotes.yaml`（candidates / active）、`config/mep-labor.yaml`（clear_labor_by_area 60 元/㎡ 市价参考）、`schedule/procurement.md` §02、`config/facts.yaml` coverage 登记。
- **决策人**：业主。

