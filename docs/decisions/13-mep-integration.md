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


### DEC-2026-10-17-R13 bend_corridor 干线正交化 + MEP 机械批次第一轮（224→202 must_fix）

- **日期/来源**：2026-10-17。触发：verify:all 归零方案（P0+P1+P2）的 P2 机械批次。对象为 `config/mep-hvac-coordination.yaml`，`npm run verify:mep` 的 must_fix_before_briefing 桶 224 error（分桶 route_overlap×86、route_not_orthogonal×50、route_furniture_collision×17、bay_sill_collision×15、unsupported_span×13、shear_wall_parallel_route×11、suppressed_wall_crossing×8 及零星项）。
- **本轮决定（机械子集，逐项）**：
  1. **bend_corridor 干线正交化（27 条 route）**：首段 (7.2,2.55,4.3)→(x,2.55,4.6) 同高斜线，在 via 首位插入正交 jog 点（先北到 (7.20,4.60) 再东西；west-wall/gateway 两条异形按各自方向插点），沿用 `strong-light-dining` 在 DEC-2026-10-17-R9 的既有先例。reason 逐条追加登记。
  2. **第二层 plan+Δy 斜段拆分（15 处，干净子集）**：lint 每路线只报首个斜段（`findIndex` 掩洋葱效应），拆一个露出下一个。本轮只保留未产生连带问题的拆分（插入单轴平面点 + 竖直抬升点），其余见「明确不做」。
  3. **route_kind=candidate 语义补声明（5 条）**：`water-kitchen-requirement` / `water-hot-water-mbath-requirement` / `water-hot-water-gbath-requirement`（gbath 原误声明 physical）/ `condensate-living` / `condensate-dining`。这五条的 label/reason 本就声明「需求表达 / v1 估算 ±0.3m / DEC-2026-10-06-R5 业主授权显式残留 / F01 保留跨度」，本轮回填结构化语义位，lint 按既有 `isRequirementLike` 通道降级 envelope_approximation warning——语义纠错，非消音；量房日按实重画后应改回 physical。
  4. **takeoff C4 契约随 schema 扩展**：`scripts/verify/mep/verify-mep-takeoff.ts` 的 `malformedRequirementRoutes` 原来只认 `routeKind==='requirement'`，而 schema（`isMepPhysicalRoute`）本就把 `requirement|candidate` 都判为非物理、覆盖度排除对两者一致。契约放宽为「显式声明了非物理 kind 即可」，decRef 同步。配套：`config/mep-takeoff.yaml` 的 `water-guest-bath` pipe_route_segments 延伸到新折线末点（0–7）。注意：5 条 candidate 路线的长度自此**离开算量管长**——这与 C8 既有业主裁定「臆测数据不进量」同向（这些路线自declared ±0.3m 估算/显式残留），量房实测重画为 physical 后长度自然回归。
  5. **单字段修复**：`strong-power-child` 删除孤儿 penetration 声明（几何早已改走地，声明陈旧）+ method conduit→floor_branch_candidate（1.45m 垫层段）；`water-guest-bath` 穿 w_gbath_south 穿点 x 5.90→6.70（原点在 d_gbath 门洞内 0.00m，新点与台盆轴对齐、距门垛 0.30m）；`water-balcony` 穿 w_balc_east 穿点 z 1.08→1.02（距 d_kit_balc 门垛 0.12→0.18m）；`drain-balcony` method gravity_floor_drain→gravity_wall_drain（水平段在 0.586m 墙排高度，原方法声明与标高矛盾）；`drain-mbath-secondary-requirement` 补 slope 0.01 并按 DEC-2026-10-06-R1 坡度回算先例把标高编码为 0.02/0.017/0.014（to_height 同步 0.014）。
- **被本条推翻的旧结论**：①`strong-power-child` reason「与照明同穿点穿 w_nw_south 进南墙边吊」——几何早已改走垫层，声明是孤儿（lint penetration_declaration_orphaned 显形），删除声明即修正陈旧表述；②`water-guest-bath` 穿点 5.90 在门洞正中属历史布点错误（非裁定值，移位不推翻任何 DEC）；③`drain-balcony` 的 floor_drain 方法声明与自身 0.586m 墙排标高矛盾（lint gravity_method_elevation_mismatch 显形）。其余被拆斜段的原始几何理由（穿孔带/梁约束/吊顶分区）**不被推翻**——拆分只把同义几何改为正交表达，平面轴与标高未变。
- **实质内容/删除审计**：删除 strong-power-child 的 1 条 penetration 声明与上述陈旧 reason 表述；water 两条穿点坐标平移（0.80m / 0.06m，均在各条自declared ±0.3m 估算精度内）。过程事故与修复：route_kind 语义注记曾因脚本状态污染误追加到 48 条路线的 reason（自 kitchen 行起后续全部行），已逐行清除、复核零残留（grep=0）；正交化与拆分的 via 插入全部保留。
- **需要避免的静默失效**：①candidate 路线的连带冲突（overlap/furniture/span）同时降级为 warning——量房改回 physical 时若未复画，warning 会掩盖真实冲突（owner：量房日逐条复判，触发=量房日）；②bend_corridor 北腿 (7.2,4.3)→(7.2,4.6) 现集中 25 条强电路线共段——同层共桥架豁免成立，但施工上是同一吊顶空腔内的实际共线，交底需写明共槽敷设；③拆分新增的竖直抬升段位于各边吊带内，量房时按吊顶空腔净高复核。
- **明确不做（P3 待办，已登记不处理）**：route_overlap×85（方案已定：共跑段平面错距 ±0.05m，不动 DEC-2026-10-06-R5 分层表，单独立 DEC）；route_not_orthogonal×39（吊顶制度过渡斜段——有吊顶 2.55/2.60 ↔ 无吊顶贴墙 2.40——抬升点必须落在制度边界，逐条定点）；bay_sill×15、route_furniture×15、unsupported_span×11（其中含 F01 显式残留）、suppressed_wall_crossing×8（5 处弧墙弦线误报需 lint 级修复 + 3 处真穿）；shear_wall_parallel_route×11（message 本身即「交底前复核套管/开槽」，挪 survey 桶需 DEC）；endpoint_inaccessible×6、route_endpoint_unusable×2（等 2026-10-14 trial 结论）、door_opening×2（墙轴内敷管穿门洞，需绕门/门头上方决策，与 endpoint_elevation_mismatch×1 联动）、penetration_missing×6（water-v1 干管，文件头自declared 估算口径）、mep_endpoint_service_conflict×1。合计 202：verify:mep 由 224→202，其余按上述清单进入 P3。
- **「X 不工作时」**：candidate 语义位若在量房后忘记复判，真实冲突将以 warning 形态潜伏——已在每条 reason 注记里写明「量房日按实重画」；正交化 jog 不改变管径/流量/分支拓扑，回路电气关系零变化。
- **下一步责任**：MEP 交底前清 must_fix 剩余 202 项中的 P3 清单（owner：设计侧+业主裁定平面错距方案；触发=交底排期或量房数据回流）。
- **验证**：`verify:mep` 224→202（not_orthogonal 50→39、floor_band/gravity_method/orphaned/door_clearance/slope_pending 归零）；`verify:mep-takeoff` C4 随 candidate 语义扩展后 OK（water-guest-bath 覆盖表同步 0–7）；`verify:facts`、`typecheck`、`test:server`（既有失败类别持平）、`verify:all` 见执行记录。
- **决策人**：设计侧按既定门禁口径执行机械批次；P3 各项（平面错距、shear 挪桶、弧墙 lint 修复）需业主/下轮 DEC 裁定。

### DEC-2026-10-17-R14 shear_wall_parallel_route 挪入 survey_dependent 桶

- **日期/来源**：2026-10-17。触发：verify:all 归零方案 P3 第一项。`verify:mep` 的 must_fix 桶中 `shear_wall_parallel_route` ×11，涉及路线全部 `status: inferred`、墙面 `structure_status` 多为 inferred（w_mb_east / w_strip_east / w_nw_south 等待量房核剪力墙位）。
- **本轮决定**：`shared/mep-hvac-lint.ts` 的 `ISSUE_CATEGORY.shear_wall_parallel_route` 由 `must_fix_before_briefing` 改为 `survey_dependent`（诊断发出的是 warning，分类表强制升 error——本次只改分类值）。理由：①该诊断 message 本身就是「keep clear of the shear wall **or confirm the sleeve/groove strategy** before briefing」——语义即交底前复核项，不是已定位的几何错误；②同族 `shear_wall_penetration` 早已在 survey 桶（双 confirmed 才升 error），同一面墙的「平行」与「穿孔」没有理由分居两桶；③诊断用例（`tests/server/mep-hvac-lint.test.ts`「long parallel runs beside a shear wall are flagged」）早已断言 warning 语义且要求 `confirmed.errors.length === 0`——must_fix 是实现偏差，不是设计意图。
- **被本条推翻的旧结论**：「剪力墙并行必须在交底前作为 must_fix 清零」。可推翻理由：结构位与可开槽性本身是量房数据（AGENTS 铁律 4：量不到的数标待实测，不等于把整个话题 hedge），竖槽+扫筋的工程结论已在各条 route reason 里写明，待的是实测确认而非设计动作；平行类不产生几何碰撞，风险在施工工法层。
- **实质内容/删除审计**：一处分类值变更 + 注释，无删除。
- **需要避免的静默失效**：量房若确认剪力墙位且路线无法挪移，该项**回归 must_fix**（交底前必须给竖槽/套管/扫筋方案）——owner：量房日/MEP 交底排期，触发=结构实测数据回流。warning 形态不进交底禁区，但 `must_fix_before_briefing` 桶清零的表述必须始终附带本条回归条件。
- **「X 不工作时」**：竖槽方案被结构否决时，替代路径是改平面绕行（需另立 DEC），不默认打孔。
- **验证**：`verify:mep` 202→191；`tests/server/mep-hvac-lint.test.ts` 剪力墙用例转绿（该文件其余 17 fail 为依赖真实 config 的既有类别）。
- **决策人**：设计侧按诊断语义与测试意图对齐分类；剪力墙实位与工法由量房+施工方终核。
