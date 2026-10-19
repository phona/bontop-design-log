# 决策日志 · MEP · 综合

> 本文件是 `docs/decision_log.md` 2026-10-09 主题拆分（DEC-2026-10-09-S01）的产物：
> 收录范围 = MEP 分层标高裁定、水电工程口径兜底、水电主材选型基线归档。条目为原文件的连续切片，正文未改写；文件内按时间正序。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-06-R1` 水电工程口径兜底轮：几何自洽 + 给排水缺项建模
- `DEC-2026-10-06-R5` #41 裁定：MEP 分层标高升入降板空腔，保走廊净高 2.50m
- `DEC-2026-10-07-M01` 归档水电主材选型基线（业主锁死项 + 成本目标 + 反转条件）
- `DEC-2026-10-18-R21` 走线修复批：R13 误序回归还原 + 六条飞线/斜线/穿幕墙路线重画 + F01 下引漏计回补
- `DEC-2026-10-18-R23` R22-v0.5 迭代批：冷凝水柜内隐藏 + 弱电走廊轴北移（首批配置迭代，分支 mep-iter-r23）
- `DEC-2026-10-19-R25` 客餐厅冷凝水显式Y汇流、外包络与逐段坡度校核

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

### DEC-2026-10-17-R15 route_overlap 治理第一轮：弱电让轴 z=4.60→4.55 + 剩余 80 对的分类口径

- **日期/来源**：2026-10-17。触发：P3 第二项。`verify:mep` must_fix 桶 `route_overlap` 85 对（R14 后基线），业主已裁定走「平面错距」方向（不动 DEC-2026-10-06-R5 分层标高表）。
- **几何分类（对 85 对逐对还原折线）**：平行共跑 ×15（弱电×冷媒沿 z=4.6 轴为主）、垂直同高交叉 ×18、平行微高差包络触碰 ×16、斜段触碰 ×4、端点/解析外部 ×32。真正「长距离共跑」只是一部分，多数是**枢纽区同高交叉触碰**。
- **本轮决定（已执行）**：**弱电让轴**——6 条 weak_power 路线的 15 个 z=4.60 via 统一错到 **z=4.55**（客厅北缘边吊带 z[4.30,5.55] 内，R5 A区口径不变）。约定：**冷媒/强电保轴**（冷媒有参考梁硬约束与厂家深化口径；强电 2.55 与弱电 2.60 的 Δy 本就够包络），**弱电平面让 0.05m**（软管最灵活）。效果：overlap 85→80，弱电×冷媒长距离共跑清零；未产生 bay_sill/furniture/span 新增（逐桶核对）。
- **剩余 80 对的分类与既定口径（未执行，留下一轮）**：①**x=7.2 枢纽区交叉**——弱电 4.55 线穿过干线北腿（(7.2,4.3)→(7.2,4.6) 同高），这类交叉触碰的正确解法是**局部高程错层**（过线处弱电局部绕降至 ≥2.57，仍在 R5 A区下限 2.55 之上）或**枢纽盒内声明共槽**（需 lint 的 shared-connection 豁免通道扩展，随 DEC）；②垂直同高交叉 ×18 同口径；③平行微高差 ×16（Δy≈0.02–0.03 包络触碰）——微调错距或错层；④斜段触碰 ×4——随 39 条制度过渡斜段定点自然消解；⑤端点汇聚 ×32——多线汇入同一盒/立管的收敛区，需解析级分析（本轮融资脚本无法还原 id 端点段），其中给排水汇流对（drain 系 ×8）建议按「同立管共点」申请 shared-connection 豁免声明通道。
- **被本条推翻的旧结论**：无（R13 已把 overlap 列为 P3 待办，本条是其第一轮执行）。
- **实质内容/删除审计**：6 条弱电路线共 15 个 via 坐标 z 平移 0.05m，reason 未逐条改写（错轴不改变路由语义与工程结论，本条即为集中记录）；无删除。
- **需要避免的静默失效**：①弱电 z=4.55 与强电 z=4.60 的空间距 0.071m、与冷媒 0.05m——均在包络之外但**施工时同一吊顶带内三排管线紧贴**，交底需注明排列；②枢纽区交叉若不做错层/共槽声明，后续每次 lint 都会持续显形——不许以「已知」为由静默接受，必须在下一轮 DEC 里落一个通道。
- **下一步责任**：枢纽盒共槽声明通道 + 交叉错层批量（owner：设计侧下一轮 P3；触发=交底排期前）。给排水汇流对由量房日立管实测后一并终核。
- **验证**：`verify:mep` 191→186；overlap 85→80（refrigerant×weak 长距共跑段清零）。
- **决策人**：弱电让轴方向业主已裁定（平面错距方案）；枢纽盒错层/共槽通道设计属下一轮。
- **附注（suppressed_wall_crossing ×8 的本轮核查结论）**：lint 的 `wallCrosses`/`routeTouchesWall` 均已弧感知（走 `wall.segments` 弦段），「弧墙弦线误报」的假设**不成立**——5 处 w_bath_north 触碰是 v1 排水估算线真实贴近圆角弧线（±0.3m 口径），3 处 recirc 回水管是真实幕墙触碰（z=1.00 恰为三段圆角切点线）。本轮试将回水管平移 z 1.00→1.05，结果落入 w_balc_west/w_balc_east 墙带新增 2 处穿墙，已回退。结论：这 8 处的正当出路是**量房日按实测重画 v1 水路**（连同 water-v1 penetration_missing ×6、suppressed 桶保持 must_fix 不挪桶——真实穿幕墙是交底禁区），不是 lint 改动。此前 R13「5 处弧墙弦线误报需 lint 级修复」的判断据此修正。

### DEC-2026-10-17-R16 共槽/汇流声明通道 shared_trunk_with（给排水 overlap 清零）

- **日期/来源**：2026-10-17。触发：P3-2 剩余 80 对 overlap 中的给排水簇（water×water ×10、drain×drain ×8）——逐对核查后主体是**物理上合法的汇流**：多支管经三通合并进同一立管（drain-mbath 系×4、drain-guest-bath×1、drain-kitchen×1）、冷/热干管同源共 prefix（热水器两路、进水阀两路 ×2）、净水器/洗碗机支路自主管开三通（×2）、热水器进水恰在冷水干管上取水（×2）。
- **本轮决定**：
  1. `MepRouteSchema` 新增可选字段 `shared_trunk_with: string[]`——列出与本路线共享干管合并段的 route id；声明双向生效（任一侧声明即跳过该对的 route_overlap）。
  2. `shared/mep-hvac-lint.ts` overlap 检查在 shared-endpoint 局部豁免之后增加声明对跳过。**只在声明时生效**：lint 不做语义猜测，配对是否属实由 review 与量房判定。
  3. 8 条路线落声明（drain-mbath-toilet/floor-to-riser、drain-gbath-floor-to-riser、drain-kitchen-dishwasher-to-riser、water-v1-heater-to-gbath-hot、water-v1-entry-to-gbath-cold、water-kitchen-dishwasher-branch、water-water-heater-inlet-requirement），覆盖 11 对。
  4. 钉子测试：`tests/server/mep-hvac-lint.test.ts`「shared_trunk_with 声明对跳过 overlap；未声明的同线汇入仍报」。
- **被本条推翻的旧结论**：无——R15 已把给排水汇流对登记为「建议按同立管共点申请豁免声明通道」，本条是该通道的落地。
- **实质内容/删除审计**：schema/lint 为新增能力，无删除；8 条路线 reason 各追加一条 R16 注记。
- **需要避免的静默失效**：①声明是**人工断言**——若两条路线实为并行两根管却误声明为汇流，真实碰撞会被静默跳过（owner：量房日对 8 条声明逐条复核管位）；②跨专业对（drain×water 回水管×排水管 ×2）**未声明**、保持显形——回水管与排水管并行走线是真实间距需求，量房时定间距。
- **验证**：`verify:mep` 186→175（route_overlap 80→69，给排水 overlap error 清零）；钉子测试过；`verify:facts` OK。
- **决策人**：通道设计为设计侧提案；8 条声明的管位属实性由量房+施工方终核。

### DEC-2026-10-17-R17 台体穿越声明通道 sill_crossings（bay_sill 15→1）

- **日期/来源**：2026-10-17。触发：P3 收尾。`bay_sill_collision` ×15 的共性：**端点/目标位于 bay_sill 建模实心台体的覆盖区内**（厨房北飘窗下的外机/厨房点位、南窗台带内的卧室插座、主卫防水反边汇流段），下引/穿行段必然穿过建模实心体——模型没有「台体开洞/墙脸预留」概念，而实际施工是管线沿墙脸敷设、过台体处加套管。
- **本轮决定**：
  1. `MepRouteSchema` 新增可选字段 `sill_crossings: string[]`（列出穿越的 bay_sill id）；lint 的台体碰撞检查对声明 bay 跳过（与 R16 shared_trunk_with 同构的声明式豁免）。
  2. 14 条路线落声明（kitchen_north_bay ×4、master/study/guest 南窗台带 ×5、主卫防水反边 ×5），覆盖 14 对；钉子测试 `tests/server/mep-hvac-lint.test.ts`「sill_crossings 声明跳过台体碰撞」双向断言。
  3. **保留 2 处不声明**：`strong-power-parent-child-guest-west`（水平段横穿客房南台体——水平穿台不是「沿墙脸过台」，必须重画绕行，随该路线的制度过渡斜段定点一并处理）；`strong-power-mbath-service` 后经补声明（西台体段同为墙脸下引）。
- **被本条推翻的旧结论**：R13 曾把 bay_sill×15 归为「竖降段平移出飘窗台体积」的机械批次——逐条核查后不成立：这些端点就在台体区内，平移不可达，声明通道才是正解。
- **实质内容/删除审计**：schema/lint 新增能力，无删除；14 条路线 reason 各追加 R17 注记。
- **需要避免的静默失效**：声明是人工断言——若某路线实际横穿台体中部（非墙脸），声明会掩盖真实碰撞（owner：量房日复核 14 条声明的管位与台体关系；触发=量房/施工交底）。
- **验证**：`verify:mep` 169→155（bay_sill 15→1，剩余 1 条为待重画的 guest-west）；钉子测试双向过；`verify:facts` OK。
- **决策人**：通道机制设计侧提案；14 条声明的管位属实性由量房+施工方终核。

### DEC-2026-10-17-R18 声明通道一律显形降级，不做静默跳过（业主裁定：不怕红，怕静默）

- **日期/来源**：2026-10-17。业主原话裁定：「量房更新数据后我就是要它在不合理的时候给我红，我不怕它一堆红，我怕它静默」。触发：R16/R17 两个声明通道（shared_trunk_with / sill_crossings）原实现是**静默跳过**——声明错误（如把并行两根管错声明为三通汇流）时 lint 零输出，正是业主最怕的失效形态。
- **本轮决定**：声明对不再从报告中消失，统一改为**显形降级**：碰撞检测照常执行，命中声明对时发出 warning（新码 `route_overlap_declared_trunk` / `bay_sill_crossing_declared`，入 envelope_approximation 桶，message 带 DECLARED 标记与量房复核要求）。must_fix 阻断语义不变（155 error 不变），但 26 条声明对全部留在报告里供量房日逐条复核。两个钉子测试改为双向断言：不阻断 + 必须显形。
- **被本条推翻的旧结论**：R16「lint 对声明对跳过 route_overlap」、R17「lint 跳过该对碰撞」的静默跳过实现。声明通道的**豁免语义保留，静默语义废除**。
- **实质内容/删除审计**：无删除；新增两个诊断码与两处显形发射；测试断言从「零输出」改为「零 error + 必须 warning」。
- **需要避免的静默失效**：本条本身就是反静默补丁。残余风险：①声明里的 id 拼错会导致声明无效、碰撞回到 must_fix——这是显形的，可接受；②量房日若不复核这 26 条显形 warning，它们会一直留在报告里——**这是设计意图**，复核完成前不允许当作已解决删除声明。
- **下一步责任**：量房日对 26 条 DECLARED warning 逐条复核管位（owner：量房+施工方；触发=量房/交底）。
- **验证**：errors 155 不变；warnings 192→218（+26 显形声明）；钉子测试双向过；typecheck OK。
- **决策人**：业主（原话裁定）；实现为设计侧执行。

### DEC-2026-10-18-R21 走线修复批：R13 误序回归还原 + 六条飞线/斜线/穿幕墙路线重画 + F01 下引漏计回补

- **日期/来源**：2026-10-18。触发：业主看渲染逐条点名六条路线异常（`strong-power-living-table` 飞线、`strong-power-living-curtain` 斜线且无强电箱溯源、`strong-power-kitchen`/`strong-ded-dishwasher` 贴玻璃幕墙、`strong-light-bedrooms-master-door`/`strong-power-living-sofa-l` 飞线），并质疑「这些问题不是修复过 linter 跟走线配置吗」。复查结论：lint 全部有报（verify:mep 自 R13 起持续红：9e0df36 时 224 error → R13 202 → R20 166），「修复过」的各批次只处理了各自点名范围，红门禁带着落地贯穿 R13→R20。
- **本轮决定**（七条路线）：
  1. `strong-power-kitchen` / `strong-ded-dishwasher`：还原 R13 误序——R13 插 `(8.6,3,2.55)` 时误插到 `(7.45,3)` 之前，把原本正交的 via 变成对角线往返（route_not_orthogonal 回归即源于此）；尾段按点位声明「北墙玻璃幕不可挂载、柜内预留、电源走地面」重画：吊顶段 x=8.6 南下 z=2.35 东行至 `w_ent_west` 西脸 (10.8,2.35) 垂直落地进垫层（灶台柜带 z[0.30,2.25] 以南 0.10m），垫层走柜前 z≥0.7 走道带到位。method conduit→floor_branch_candidate。两稿弃案：西侧 (7.3,2.1) 竖井与 x=7.45 冷媒干线轴 / x=7.30 热水器热水立管 / w_balc_east 门洞带三重冲突；(10.8,0.7) 竖井穿灶台柜高度带（route_furniture_collision 显形）。
  2. `strong-power-living-table`：点位 2026-10-16 随餐桌迁 (9.8,3.45) 而路线未跟随（旧 from (7.9,3.0) 造成 1.9m 垫层斜线 + 2.0m 吊顶缘无依托竖降）。改按 `strong-power-living-sofa-r` 同款（R4 先例）自 `panel_strong_entry_left` 客厅侧 (13.34,3.6) 落地走垫层，全程地面依托。
  3. `strong-power-living-sofa-l`：同理废除「吊顶缘 2.28m 悬空竖降」——客厅中部 x[7.2,13.4] 无任何可依托实体墙，竖降无解；改 panel 落地垫层支路（与 sofa-r 共竖井）。
  4. `strong-power-living-curtain`：首末斜拉一段拆为贴 `w_be_west` 西脸正交折线，北行轴取墙面 x=13.34（避开 `w_be_south` 图元 (13.4,8.7) 墙角顶点）。
  5. 新增 `strong-power-living-water`：sock_living_water 下引 2.4m 补画回实体路线（纯竖直段按 M04 口径 route_kind: physical），路线计数 135→136。
  6. `strong-light-bedrooms-master-door`：0.75m 单段横穿主卧门洞 d_mb（旧 reason 只论证端点未查路径），改自北床头开关位竖升 2.20m（门楣 2.10 以上）过洞后下引；to_height 0.75→1.30 对齐点位。
  7. `config/mep-warning-adjudication.yaml` 补登记 13 个存活 warning 类（每条附已落地 DEC 全引 + owner/trigger；仅覆盖 survey/envelope 桶实例，must_fix 不适用）。
- **被本条推翻的旧结论**：① R13「干线正交化」对厨房两根的实现——插序错误构成回归，本轮还原；② F01「sock_living_water 下引量由 takeoff terminalDrop 派生」——terminalDrop 只对路线 to 端点计，撤并后无任何路线以该点为端点，2.4m 下引从未进量且渲染溯源断链，本轮补画回实体路线（takeoff 随画线计数，不再依赖派生口径）；③ 旧 sofa-l/table「吊顶缘下引进垫层」的做法——客厅中部无依托竖降被 unsupported_span 显形为不可施工，panel 落地是唯一全程依托解。
- **实质内容/删除审计**：新增路线 1 条；删除字段仅 `sill_crossings` ×2（kitchen 两根的新路径 z≥2.35/y≤0.3 不再进入任何台体体积，声明失实故撤销，理由写入 reason）；`config/facts.yaml` registered_conflicts 54→52、engine_note/`docs/mep-construction-guidance.md` §0/§6、路线计数 135→136 均按修正通道同步；adjudication +13 条。无既有候选/证据/淘汰理由被删除。
- **明确遗留（不在本轮范围，属点位审查）**：`sock_kitchen_dishwasher` 与 `faucet_kitchen_dishwasher` 同点位（mep_endpoint_service_conflict + dishwasher×水路 0.000m overlap 的共同根源）；`sock_kitchen_counter` (8.6,0.3) 落在洗碗机家具体积内（endpoint_inaccessible）。两条均为 R20 点位审查批遗留，下一轮点位批处理。
- **需要避免的静默失效**：① 垫层段与 z=0.3 给水线/z≤0.5 排水线的平面错位是人工断言（owner：量房日复核柜前走道带实际管位）；② kitchen 两根与 R20 `strong-power-kitchen-east` 的共走廊/共竖井以 shared_trunk_with 声明显形，量房逐条复核；③ (10.8,2.35) 竖井与灶台柜带南缘的 0.10m 间距待橱柜深化复核对位。
- **验证**：verify:mep 166→140（本批六条路线的 route_not_orthogonal/unsupported_span/door_opening_collision/endpoint_elevation_mismatch/suppressed_wall_crossing 全部清零；剩余 140 为其他路线存量 overlap 山等，下一批）；13 条 warning_class_unadjudicated 清零；verify:facts 7 fail→0（计数镜像/DEC 引用/52 基数全部按通道闭合）；verify-mep-takeoff 通过（垫层加长已进量）。
- **决策人**：业主点名问题并授权修复（「修」）；改线路径为设计侧按点位既有声明推导，量房日复核。

### DEC-2026-10-18-R23 R22-v0.5 迭代批：冷凝水柜内隐藏 + 弱电走廊轴北移（首批配置迭代）

- **日期/来源**：2026-10-18。触发：业主 R22-v0.5 目标重定义——项目处于方案设计阶段，目标改为「有依据、可解释、可调整、可经 Linter 持续验证的初版管综方案」，解除「B1/B2/B3 全关才能改配置」冻结，允许带显式标注的暂定参数迭代；禁止纯审计循环。
- **本轮决定**：
  1. condensate-living / condensate-dining：S3/S4 竖管自客卫室中 (6.70,3.70) 改贴 w_gbath_east_open_vanity 柜内 (7.00,3.70)（两根 φ25 并管），末端 0.30m 以 0.10m 高接原排水点——**排水接点不动**（R5 固定断言保留）；客卫明露立管（B2a 视觉项）改柜内隐藏。
  2. 弱电 5 条（master/parent/gateway/ap/main-living）走廊主轴 z=4.55→4.38：并行会话 return-air-living 新回风行（z=4.45，管体 y2.59–2.81）与旧轴包络相交（6 warning），新轴北移出管体投影，同时避开送风竖段（z≥4.75）与冷媒/强电 4.60 轴（平面距 0.22m）。weak-master 西尾段 x[4.05,4.60] 保持 4.55（master_ac 分区覆盖下限）+ 0.17m 正交过渡；weak-study 经回归验证不经 x≈10.30 风管区，不移轴（移轴曾引入 entry-night-living-north 新交叉，已回退）。
  3. 新增 design-intent.md（冷凝水/走廊干线/客厅西墙服务带三组的目标/红线/可调参数/依赖/替代序）。
- **被本条推翻的旧结论**：R22 v0.2–v0.4 的「B1/B2/B3 全部解除前不得修改走线配置」冻结——被业主 v0.5 目标重定义（§三 允许进入配置修改）推翻；「弱电走廊轴 4.55」作废（新轴 4.38，旧轴与新回风行包络相交）。
- **实质内容/删除审计**：无路线增删；via 坐标改动 + reason R23 注记（含一次 YAML 单引号转义错误即改）；weak-study 移轴尝试回退（过程留存分支历史）。无既有候选/证据被删除。
- **静默失效风险**：①柜内隐藏依赖开放洗漱柜体实际深化——柜体取消即回到明露（owner：业主+木工，柜体深化节点）；②弱电 4.38 与回风行净距 0.07m 为暂定值——回风行/龙骨定版后复判（owner：并行 HVAC 批+施工方）。
- **验证**：verify:mep before 139 errors/215 warnings → after 139/218（overlap 70 对集合零变化——交叉类按优先级留待后续；weak×风管中心距 0.100→0.122 且出管体投影；condensate unsupported_span 3.60→约 3.1m）；typecheck ✓。design-intent.md 与 R22-v0.5-iteration.md 载全量对比与交底问题清单。
- **决策人**：业主（R22-v0.5 目标重定义 + 迭代授权）；改线路径为设计侧按 design-intent 推导，交底后按现场反馈迭代。

### DEC-2026-10-19-R25 客餐厅冷凝水显式Y汇流、外包络与逐段坡度校核

- **日期/来源**：2026-10-19。按业主 R25 指令从最新基线 `514c715` 重新复核。当前仍是未量房的协调候选；本条不批准吊顶、镜柜、vanity 家具、固定排水接点或增项改动。
- **推荐拓扑**：客厅 71T2、餐厅 42T2 各走独立 φ25 支管，在客卫开放洗漱区 `(6.80,3.70,2.435)` 以显式 45°Y 节点合流，之后只设一根 DN32 共用主管，落到未移动的候选排水点 `(6.70,3.70,0.10)`。两支管并管只发生在声明的接头外包络内；节点外的同位或长距离平行重叠仍是 route_overlap。DN32、45°Y、6cm 局部接头包络与支管6mm保温均为初步假设，不是厂家确认规格。并发排水量、防倒灌/止回、通气/存水弯、清扫口及检修方式须在厂家/安装方确认后冻结；不允许把两个泵出口仅因同终点而直接当作合法汇流。
- **当前配置中的低设备依赖候选**：沿用自然重力出口 `y=2.52m` 作为未确认假设。客厅支管路线为 `(10.70,4.95,2.52)→(11.20,4.95)→(11.20,4.50)→(6.50,4.50)→(6.50,3.70)→节点`，各水平段约1%–3%；餐厅支管由 `(7.60,4.34,2.52)` 经 `(6.60,4.34)→(6.60,3.90)`，再以45°短段进入节点，各段约4.93%。走向避开更新后的客餐厅送回风支管与强电主干，强电主干转折轴由 `x=10.90` 移至 `x=11.50`；固定接点不动。弱电AP在x=10.80处先于高位将z轴由4.48移至4.55，再降至y=2.51，穿墙前回到z=4.48。曾试将降层点西移至x=4.60，导致y=2.60段与6条冷媒支路同轴重叠，已回退；该失败试验没有留在当前候选。外包络显示部分支管低于完成面，客厅连续约3.92m还需现场确定支撑；客卫竖管在现有 vanity 投影内，必须先确认既有柜底/背部服务空间、清扫与检修可达性。**不把40mm收口条、加长镜柜或降吊顶当作本方案组成。**
- **隐蔽候选**：若厂家确认两台内机的内置 P-SS 泵允许把排水局部提升到约 `y=2.75m`，之后连续重力排至节点约 `y=2.6855m`，则可把支管维持在吊顶空腔内。此几何要求泵后净提升约0.23m；按6mm保温假设，支管外包络顶约2.7685m，距假设结构板底2.80m仅31.5mm，客卫完成面2.65m处管底约2.667m。梁底/板底、风管截面、吊架空间、泵实际扬程和维护路径都未实测/确认，因此这只是最佳隐蔽候选，不写入现行施工定位。若自然重力口不存在或厂家禁止重力主用，则优先转入此方案深化；若泵扬程、支撑或吊顶空腔不足，保持原排水点并另做需业主审核的独立接管/饰面方案。
- **外包络与拓扑规则**：MEP 路线冲突和完成面检查用实际直径、已声明保温和已知风管截面；未确认保温厚度发 `route_insulation_unverified`。facts 契约与 MEP Linter 共用管线垂直外包络及50mm中心线采样，完成面容差设为0（不承诺任何施工偏差）。冷凝水汇流须有节点、inlet/outlet route ids 和几何坐标；仅在6cm接头包络内发 `route_overlap_declared_trunk`，不会扩大到整条 route 或相同 endpoint。
- **被本条推翻的旧结论**：①R24「两根φ25共走同轴路径至同一排水点」不再作为当前几何，改为两条独立支管与一个显式汇流节点；②R24 关于 `(7.00,4.30)→(7.00,3.70)` 的0.67%坡段不再用于当前客餐厅候选，本条将每段按1%最低目标重算；③“相同终点可解释两支管重叠”不适用于冷凝水合流，接头以外的重叠仍报硬 finding；④R24 的自然重力口 2.52m、排水方式和40mm收口均继续是未确认假设，不能转述为已批准。
- **Linter 回归快照**：514c715 基线为136路线、139 errors / 214 warnings；R25 为137路线、149 errors / 238 warnings。分桶 must-fix 139→149（+10）、survey 91→110（+19）、envelope 123→128（+5）。新增11条逐段低于1%最低坡度 error（分布在既有 `drain-*`、`condensate-master/child`，R25 客餐厅两支管均满足声明）；新增7条未确认保温 warning；吊顶外包络计数50→62，facts / MEP 双引擎实算62并登记，原因是纳入管径和保温，不是几何冲突被消账。硬 overlap 70→69；新增的其他6组非客餐厅冷凝水与送/回风外包络近似重叠 warning 继续显形，留给后续路线批单独核查。R24 客厅×餐厅与新送回风的3组碰撞提示消失；新Y节点的3组局部交叠均以声明接头 warning 显形。其余历史 finding 保留，不追求全 MEP 清零。
- **静默失效风险与负责人**：①自然排水出口高度/方位和 P-SS 是否允许泵旁通主重力——空调厂家，取得逐台深化图时确认；②两支泵能否共接、DN32并发能力与止回/通气/清扫做法——厂家+安装方，排水管封闭前确认；③走廊梁底、结构板底、最新送回风管外包络、吊架空间——量房+暖通，放线前复核；④vanity 柜体净空与清扫检修空间——木作/安装方现场复核，禁止先改柜/镜柜迁就管线。任一项不满足时，不移动固定排水点、不降低吊顶，提交备选给业主。
- **验证**：R25 定向回归测试覆盖无节点同位管碰撞、合法Y节点、节点外长平行碰撞、0.67%坡段、1mm数值容差、保温外包络及吊顶参数变化。验证结果见 R25 设计迭代记录。
- **决策人**：设计侧根据业主 R25 授权提出推荐拓扑；厂家参数、现场尺寸及任何建筑/家具/增项变更均未获确认。
