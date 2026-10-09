# 决策日志 · 控制 · 预算 · 阶段边界

> 本文件是 `docs/decision_log.md` 2026-10-09 主题拆分（DEC-2026-10-09-S01）的产物：
> 收录范围 = 项目控制框架、四池预算口径、一期/二期范围冻结、询价轮次与合同登记、施工排期与延后登记。条目为原文件的连续切片，正文未改写；文件内按时间正序。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-07-03-001` 项目控制框架确定
- `DEC-2026-07-25-008` 验证体系补强
- `DEC-2026-08-01-009` 预算口径重构为四池 + 关键选材定稿
- `DEC-2026-08-01-010` 承包方式与飘窗（计划内默认，可否决）
- `DEC-2026-08-01-011` 卧室地面建模 + 数据置信度机制 + 人工费假设
- `DEC-2026-08-01-012` 巡场高优先修复：补空调插座 + 西北次卧衣柜降 1.8m
- `DEC-2026-08-01-013` 窗帘预算调整 + 电动策略
- `DEC-2026-08-02-013` 设计审查：全屋布局深化 + 水电交底清单
- `DEC-2026-09-12-R1` 一期预算压缩至20万：成品柜路线+七项后移二期+选择性保档
- `DEC-2026-09-12-R2` 一期家具逐房范围冻结：最低浪费、保证日常
- `DEC-2026-09-12-R3` 云鲸 J6 按 3,000 元追加进入一期
- `DEC-2026-10-03-R2` 业主全硬装询价轮次归档：登记进 control.yaml，不新建第二套预算矩阵
- `DEC-2026-10-03-R4` 固定柜体维持阶段边界：成品柜走一期家具池，通顶定制衣柜继续二期
- `DEC-2026-10-05-R4` 微蒸烤一体机定标进入一期与必需家电池扩容
- `DEC-2026-10-05-R5` 热水器型号方向换选海尔 KL7PRO
- `DEC-2026-10-06-R3` 三项设计迭代延后登记（业主授权默认方案，执行轮次待排）
- `DEC-2026-10-06-R6` 施工排期捋顺：补三个接口冻结阻断项 + 两处依赖倒挂修正
- `DEC-2026-10-09-S01` 决策日志按主题拆分：单文件 417 KB → docs/decisions/ 14 个主题文件 + README 索引

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-07-03-001 项目控制框架确定

- **日期**：2026-07-03
- **决策事项**：采用本地化 Git + YAML/JSON + Python 的项目管理方式
- **可选方案**：
  1. 全手动 Excel + 微信记录
  2. 本地 Git + 结构化配置 + Python 审计（本方案）
  3. 第三方装修管理软件
- **选定方案**：方案2
- **决策依据**：数据主权、可审计、可定制
- **预算影响**：无
- **关联文件**：README.md、audit/audit.log
- **决策人**：业主

---

### DEC-2026-07-25-008 验证体系补强

- **日期**：2026-07-25
- **决策事项**：建立通用规则驱动的验证体系
- **可选方案**：
  1. 各脚本独立硬编码检查
  2. 通用引擎 + YAML 规则声明（verify-rules.ts + verify-rules.yaml）
- **选定方案**：方案2
- **决策依据**：新增设备只改 YAML 不改代码；规则集中可审计；5 种检查类型覆盖所有场景
- **预算影响**：无
- **关联文件**：`scripts/verify/rules/verify-rules.ts`、`config/verify-rules.yaml`、`package.json`、`AGENTS.md`
- **决策人**：业主

---

### DEC-2026-08-01-009 预算口径重构为四池 + 关键选材定稿

- **日期**：2026-08-01
- **决策事项**：预算口径重构（硬装/暖通/家具/家电四池）+ 空调/热水/地面选材定稿
- **可选方案**：见会话评估（预算口径 A/B/C 收敛选项；空调 A1/A2/A3/B1；热水零冷水与否；地面木纹砖/柔光砖/木地板）
- **选定方案**：
  - 预算口径 = 四池（硬装 118,000 + 暖通 29,000 + 家具软装 35,000 + 家电 10,000 = 192,000），`project_ceiling=190,000`
  - 空调 = 美的理想家 III 一拖五（A2，29,000），hvac budget 由 0 纳入总控
  - 热水 = 燃气热水器，水电阶段**预埋回水管**、暂不上零冷水（后期可升级）
  - 客餐厅地面 = 木纹砖通铺（floor_tile_01）
  - 偏紧科目上调：water_electric 8500→12000、waterproof 3500→4500、kitchen_cabinet 6500→8000、sanitary 10000→12000
- **决策依据**：原 11 万仅硬装基础包，hvac=0、家具误塞 miscellaneous(5700)、家电无科目，AI 与业主均无法看到真实落地价；重构后 config 与 MCP 运行时同源全口径
- **预算影响**：total_budget 110,000 → 192,000；新增 furniture_soft / appliances 科目；修复家具 count 计价 bug（type≠topic 漏算，原家具 actual 恒为 0）
- **关联文件**：`config/budget/base.json`、`config/design-rules.yaml`、`config/materials.yaml`、`server/budget-calculator.ts`、`shared/types.ts`、`data/current-scheme.json`
- **决策人**：业主

---

### DEC-2026-08-01-010 承包方式与飘窗（计划内默认，可否决）

- **日期**：2026-08-01
- **决策事项**：施工承包方式 / 主卧飘窗利用
- **选定方案**：
  - 承包方式 = **半包**（施工方包工+辅材，业主自购主材），务实档最常见、主材可控
  - 主卧飘窗 = **保留，大理石台面+坐垫简装**（不做榻榻米，控成本）
  - 入户花园消防通道 = 列为**外部行动项**（物业/消防确认通道宽度），非配置决策
- **决策依据**：控成本 + 主材自主；飘窗简装避免木工超支；消防通道须合规
- **预算影响**：半包主材自购计入各池；飘窗简装含在 miscellaneous
- **关联文件**：`config/house.yaml`、`docs/designer_brief.md`
- **决策人**：业主（默认建议，未单独表决）

---

### DEC-2026-08-01-011 卧室地面建模 + 数据置信度机制 + 人工费假设

- **日期**：2026-08-01
- **决策事项**：卧室地面材料建模（待决#6）/ 数据置信度机制 / 人工费静态假设文档化
- **选定方案**：
  - 卧室地面 = 新增 `bedroom_floor` topic，默认**木纹砖通铺**（bedroom_tile_01，与客餐厅一致），
    备选实木复合（bedroom_wood_01）；applyRooms=[master_bedroom, study, bedroom_nw, bedroom_se]，计入 masonry
  - 数据置信度 = house.yaml 增结构化 `data_precision`（geometry/structure/mep=inferred、materials=candidate、
    survey_completed=false）；MCP 新工具 `get_data_confidence` 汇总精度 + 材料确认率 + 量房状态
  - 人工费 = **静态费率假设**（不改代码）：labor 不随选材变；大砖(≥800)/人字拼工费上浮约 20–50%，
    已含在务实估算，精确数待施工图
- **决策依据**：补全硬装预算卧室地面留白；让 AI 识别估算值避免伪精确；务实档人工难精确建模，不过度工程
- **预算影响**：masonry actual +~5,800（卧室 34.5㎡ 木纹砖），21,680→27,488（仍 over 18,500，
  系诚实拆算，整体 totalActual 143,710 在 ceiling 190,000 内）
- **关联文件**：`config/materials.yaml`、`config/design-rules.yaml`、`config/house.yaml`、
  `server/project-catalog.ts`、`server/mcp-server.ts`、`shared/types.ts`、`data/current-scheme.json`
- **决策人**：业主

---

### DEC-2026-08-01-012 巡场高优先修复：补空调插座 + 西北次卧衣柜降 1.8m

- **日期**：2026-08-01
- **决策事项**：设计巡场发现的 2 个高优先问题修复
- **选定方案**：
  - 补主卧、西北次卧空调内机电源：`sock_master_ac`（主卧东墙 w_mb_east 4.2,7.0 h2.5 吊顶内）、
    `sock_child_ac`（西北次卧南墙 w_nw_south 4.0,4.30 h2.5 吊顶内）。中央空调一拖五每房有吊顶风管机，
    原仅客厅/书房/父母房有 sock_*_ac，主卧/西北次卧遗漏
  - 西北次卧（儿童房 8.39㎡）衣柜 wardrobe_240 → wardrobe_180（位置 2.90,2.70 rot90 不变），
    腾 0.6m 改善过道（原 bed_180 北侧通道仅 0.30m，3 处 clearance 警告 <0.5m）；保留 1.8m 床
- **决策依据**：中央空调每房需内机供电（暖通落地必备）；8.39㎡ 小房 1.8m 床+2.4m 衣柜动线局促，降衣柜保床
- **预算影响**：wardrobe_180 报价 3200（candidate）；count 模式 wardrobe 同 topic 暂按默认价计（per-size 计价留后续）
- **已知**：风管机电源走吊顶，距内机 >1m 触发 ac_socket_to_unit warn 属正常，不阻塞
- **关联文件**：`config/electrical.yaml`、`config/house.yaml`、`config/materials.yaml`
- **决策人**：业主

---

### DEC-2026-08-01-013 窗帘预算调整 + 电动策略

- **日期**：2026-08-02
- **决策事项**：curtains 科预算缺口处理 + 窗帘电动策略
- **选定方案**：
  - 窗帘策略 = **高频区（客厅/主卧）电动纱帘+遮光帘 + 低频区（父母房/书房）手动（后期可加，电源已预留）+ 厨卫防水百叶**
  - curtains 预算 **4000 → 10000**
- **决策依据**：
  - 原 4000 不足（curtain_01 3930 仅"一套"价，全屋 9 处玻璃幕需多处窗帘）
  - 分阶段不省总价：手动先行+后期电动（~11200-12000）≈ 一步到位全电动（~12000），因电动电源已预留（DEC-009），后期加装只需电机+轨道
  - 故选高频区电动享便利、低频区手动省"用不上几次的奢侈"
- **预算影响**：total_budget 192000 → 198000；ceiling 保持 190000（守实际花销，totalActual 143710 远低于，余量 46k）
- **关联文件**：`config/budget/base.json`、`docs/curtain-design.md`
- **决策人**：业主

---

### DEC-2026-08-02-013 设计审查：全屋布局深化 + 水电交底清单

- **日期**：2026-08-02
- **决策事项**：专业设计审查，逐空间深化布局，输出水电/拆改交底清单
- **选定方案**：
  - **入户花园**：开发商已完成（地面/墙面/天花/入户门），一梯一户不换门；西墙做玄关组合柜（2400×350×2400，翻斗门，底部架空150mm 内缩踢脚），待 3D 体验 + 家人确认
  - **客餐厅**：电视插座组 z=5.8→7.0（电视柜正后方）；新增餐桌吊灯（9.0,5.3 天花出线）+ 电视墙灯带（7.2,7.0 h2.0）；厨房与客餐厅加三联动长虹玻璃吊轨推拉门（z=4.3，3500-5300）
  - **厨房布局重排**：东墙（灶台+烟机+冰箱），北墙（水槽+切配，上下水走地面），西墙（阳台门+辅助台面）；北墙不做吊柜（玻璃幕）；冰箱在西墙南端（进门左手）
  - **主卫方案 A+C**：洗手台外移到过道段（z≈4.7，干湿分离），湿区只留马桶+淋浴（挡水条+玻璃隔断），过道段做薄柜；不泡浴缸
  - **衣柜统一推拉门**：主卧/父母房/儿童房，节省过道空间
  - **儿童房**：床 bed_180→bed_150（通道 0.3→0.6m）；书桌插座 x=4.5→3.2
  - **父母房弹性设计**：成品床（可搬走）、大白墙、衣柜可拆层板、插座/网口保留兼容书房
  - **主卧**：取消电视位（改 USB 插座）；投影 A 方案（床尾插座，便携投影，需求少）；空调出风口避开床头
  - **客卫**：挡水条+浴帘（不做淋浴房）；新增电热毛巾架插座（5.60,2.8 h1.2 防溅）
  - **不装新风**：防尘靠密封缝隙+净化器+扫地机器人+减少开放搁板；新风工程复杂度高且不能根治落灰
  - **飘窗**：全屋上飘窗（sill=2.55m），不做坐垫，石英石台面放绿植（量房确认实际高度）
  - **入户门**：entry_door_01 标 provided_by_developer，price=0
- **决策依据**：专业设计师 + 装修老炮视角逐空间审查；西墙有阳台门中断不能做连续台面（灶台只能东墙）；三层 Low-E 中空玻璃隔热已满足（窗帘非隔热刚需）；一梯一户入户门无需高安防
- **预算影响**：doors_windows 10500→12000（减入户门 3000，加推拉门 3500-5300）；厨房水电改走东墙/北墙增加约 500-800
- **待量房确认**：厨房排水立管/燃气表/排烟道位置、主卫立管位置、梁位、承重墙、飘窗实际 sill 高度、幕墙可开启扇尺寸
- **关联文件**：`config/house.yaml`、`config/electrical.yaml`、`config/plumbing.yaml`、`config/materials.yaml`、`config/budget/base.json`、`docs/pending-site-data.md`
- **决策人**：业主

---

### DEC-2026-09-12-R1 一期预算压缩至20万：成品柜路线+七项后移二期+选择性保档

- **日期**：2026-09-12
- **起因**：业主认为一期约25.2万口径不可接受，要求一期20万以内达到可入住；策略为不搞一步到位，低ROI项延后或砍掉，两人居住。
- **业主拍板保留**：中央空调33,000、基础施工、防水15,000/水电5,000所在包、瓷砖只降半档（泥瓦30,000，约70–80元/㎡档）、厨房橱柜11,500、三卧室基础窗帘5,000、美缝4,500留一期。
- **后移二期**：主卧通顶定制衣柜（藏冷凝水管槽，必须定制，3,000–5,000）、壁床柜（3,000–5,000）、客厅大收纳柜（2,000–4,000）、展示柜（1,000–3,000）、复杂灯光（筒射灯轨道灯，2,000–4,000）、客厅/书房窗帘（4,000–6,000）、书房次卧家具（3,000–5,000）。
- **成品柜路线**：次卧/父母房成品衣柜（次卧柜前通道0.65m，须推拉门款）、书房成品柜、玄关柜、客厅低柜、斗柜；不通顶、顶部留空为已知妥协；将来换定制不动硬装。部分修订 DEC-2026-09-06-R7 等定制柜决策的采购时点（设计保留、采购推二期）。
- **压缩后口径**：一期上限240,000→200,000，已分配200,000，未分配0，预备金12,000→5,000；家具池43,000→19,000，家电7,000→9,000（下探组合），设计12,000→8,000，门11,500→9,000，洁具11,500→8,000，窗帘10,000→5,000；二期区间30,000–45,000→49,000–76,200。
- **已知代价**：主卧前期衣架+斗柜过渡；客厅晚间无隐私、西晒无遮光；未分配归零、预备金仅5,000，83个待报价项冒缺口时只能砍配置或追加；洁具和门为下探档。
- **关联文件**：schedule/phase-1/control.yaml、schedule/roadmap.yaml、schedule/phase-2/control.yaml、schedule/README.md、schedule/phase-1/README.md、schedule/phase-2/README.md、scripts/schedule/control.ts、config/house.yaml
- **决策人**：业主

### DEC-2026-09-12-R2 一期家具逐房范围冻结：最低浪费、保证日常

- **日期**：2026-09-12
- **起因**：一期需要从全案家具模型中拆出可采购、可复用且满足日常的最小范围；邻居 CAD 仅作预演基线，实际尺寸继续 site_pending。
- **业主决定**：主卧一期保留床、床垫、两只床头柜和过渡斗柜；衣架待选宜家或其他可复用成品，尺寸未定前不进入 `config/house.yaml` 建模。父母房保留床、床垫和成品衣柜。客餐厅保留沙发、餐桌椅和玄关收纳组合。
- **明确后移二期**：主卧通顶定制衣柜、主卧梳妆桌凳、客厅低柜/电视/咖啡桌/地灯/绿植、东南书房全部家具、西北次卧全部家具；西北次卧仅保留一期窗帘。壁床柜、客厅大收纳柜、展示柜、复杂灯光和客厅/书房窗帘继续按 R1 后移。
- **边界**：本决定只冻结采购范围，不改变 `config/house.yaml` 的全案渲染基线；未定尺寸的主卧衣架不建模。实际完成面、通道、墙体固定和防倾倒条件交房量房后复核。
- **关联文件**：`schedule/phase-1/control.yaml`、`schedule/roadmap.yaml`、`schedule/phase-2/control.yaml`、`docs/design-iterations/phase1-scope-20260912/`
- **决策人**：业主

### DEC-2026-09-12-R3 云鲸 J6 按 3,000 元追加进入一期

- **日期**：2026-09-12
- **起因**：一期范围原将扫地机器人后移二期，但客卫台盆下的电源、自动进水和墙排协调位以及云鲸 J6 上下水版模型已经完成预演；业主要求将该设备一并计入一期。
- **业主决定**：云鲸 J6 上下水版按 ¥3,000 纳入一期必需家电，使用客卫悬空台盆柜下主位；一期总上限及已分配额由 ¥200,000 增至 ¥203,000，必需家电预算由 ¥9,000 增至 ¥12,000，未分配仍为 ¥0。
- **跨阶段处理**：从二期清单移除扫地机器人，二期规划区间由 ¥46,100—¥72,700 调整为 ¥42,100—¥67,200，避免重复计费；洗碗机、干衣机和净水设备仍留二期。
- **现场边界**：¥3,000 为业主确认的设备预算；采购前仍需核对具体版本、柜下净空、进水三通、墙排穿墙条件、坡度、电源防溅及检修空间。
- **关联文件**：`schedule/phase-1/control.yaml`、`schedule/phase-scope.yaml`、`schedule/roadmap.yaml`、`schedule/phase-2/control.yaml`、`docs/design-iterations/phase1-scope-20260912/`
- **决策人**：业主

### DEC-2026-10-03-R2 业主全硬装询价轮次归档：登记进 control.yaml，不新建第二套预算矩阵

- **日期**：2026-10-03
- **起因**：业主提供《和萃701｜全硬装预算与待采购决策（2026-10-03）》工作簿（3 sheet：总览 / 项目明细 26+1 项 / 待采购决策 9 项），要求归档并结合本项目形成落地方案。项目里已有更细的采购体系（`control.yaml` 的 90 个 `COST-xxx` 成本组件、自动渲染的 `budget.md`/`checklist.md` 询价明细、`procurement.md` 19 组决策源、`material_selection_log.md` 报价来源归档），AGENTS.md 又明令不得拆出第二套业主采购矩阵。
- **选定方案**：把该工作簿作为**一轮询价证据**登记为 `control.yaml` 的 `hard_finish_quote_rounds`（26 条记录，`round_id: ROUND-2026-10-03`），由 `scripts/schedule/control.ts` 自动渲染为 `budget.md`「询价轮次回填与父包对账」与 `checklist.md`「硬装询价轮次核对」；原件 xlsx 不入库，凭据另行归档到 `contracts/2026-10-03/`。
- **价格口径分级**（本轮核心规则）：`quoted_sheet`=带报价单；`owner_budget_pool`=业主给定的预算池；`cap`=封顶价；`candidate`=候选价/询价目标。轮次目标合计 203,598（核心硬装 185,598 + 固定柜体 18,000），但**只有厨卫铝扣板套件 9,537 是报价单**；18,500 是业主预算池，20,000/36,000/5,598/6,000 是封顶或候选价，均不得相加后当作已锁价。
- **映射与去重规则**：Excel 26 项逐条映射到 PKG 与 COST 组件（如瓷砖主材→`COST-060-01`、瓦工人工池→`COST-060-04/05`、铝扣板报价→`COST-070-03`、智能马桶→`COST-100-01`、空调→`PKG-030`、固定柜体→`PKG-150`）。必须去重的三处：①瓦工 18,500 与防水 3,000、辅材 4,000 是否含并；②2 浴霸+凉霸+灯塞在吊顶报价里，归属须与 `COST-100-06`、PKG-120 二选一；③通用五金 1,500 与龙头下水角阀 1,200 同归 `COST-100-04`，不得叠加。Excel 口径**不含**厨房三联动推拉门（`COST-090-03`，BLK-GAS-DOOR）、物业收费、设计费、一期窗帘、必需家电与竣工清洁，因此其 8,800 元"门"不是降价空间。
- **回填与缺口显形**：按可核口径回填 6 个组件金额（`COST-060-01=20000`、`COST-060-02=4000`、`COST-060-04=18500`、`COST-070-03=9537`、`COST-100-01=5598`、`COST-100-02=6000`），待报价组件由 85 项降到 79 项；PKG-060/070/100/110 登记 `estimated_need_cny` + `funding_status: owner_review_pending_20261003`，缺口合计 **42,235**（PKG-070 +17,037、PKG-100 +10,698、PKG-060 +12,500、PKG-110 +2,000）自动进入 `budget.md`「已知待分配预算缺口」与 checklist。未取得业主批准前不动用硬装预备金。
- **审计闭环**：`npm run verify:schedule`/`schedule:render` 一行输出待报价组件数；`npm run schedule:audit` 追加待购项数、已锁轮次项数、报价单口径金额、已量化缺口与上限余量。后续轮次只追加记录并用 `supersedes` 指向被取代项，锁定项必须同时给 `locked_cny`/`contract_ref`/`evidence_path`，历史轮次不覆盖。
- **关联文件**：`schedule/phase-1/control.yaml`（`hard_finish_quote_rounds`、组件回填、`estimated_need_cny`）、`scripts/schedule/control.ts`（校验+渲染+`--audit`）、`schedule/phase-1/budget.md`、`schedule/phase-1/checklist.md`、`schedule/procurement.md`（各组一句证据摘要）、`docs/material_selection_log.md`（floor_tile_04 与业主提供轮次归档）、`docs/pending-site-data.md`（#34–#39）、`contracts/2026-10-03/README.md`
- **决策人**：业主（提供轮次并要求归档）；映射与去重口径由 AI 助理整理，待业主复核

### DEC-2026-10-03-R4 固定柜体维持阶段边界：成品柜走一期家具池，通顶定制衣柜继续二期

- **日期**：2026-10-03
- **决策事项**：询价轮次中的"衣柜/玄关柜/其他固定柜体 ¥18,000"（`QR-2026-10-03-26`）**不计入一期硬装**。维持 DEC-2026-09-12-R1/R2 的边界：玄关收纳组合、父母房成品衣柜、主卧过渡衣架/斗柜走 PKG-150 一期家具池（¥19,000）；主卧北墙通顶定制衣柜仍受 BLK-MASTER-WARDROBE 阻塞、后移二期。
- **决策依据**：硬装与家具/柜体口径必须分开，否则 203,598 的"含柜体目标"会被误读成硬装缺口；一期未分配额度为 0，任何提前都需另行批准资金并避免跨阶段重复计费。
- **下一步**：先由业主决定成品柜与定制柜的比例，再按投影面积拿完整报价；报价落地时只回填 PKG-150 对应组件，不新开硬装科目。
- **关联文件**：`schedule/phase-1/control.yaml`（PKG-150、BLK-MASTER-WARDROBE）、`schedule/procurement.md` §16
- **决策人**：业主

### DEC-2026-10-05-R4 微蒸烤一体机定标进入一期与必需家电池扩容

- **日期**：2026-10-05。
- **定标**：业主确认**美的 GC5 嵌入式微蒸烤一体机**（TR850E-TSBC00，55L，微/蒸/烤/空气炸四合一，变频微波+双孔直喷+上下管热风，额定 3200W，机身 595×565×454mm）进入一期，目标 ≤3,800、封顶 4,200（官方现价 4,199，2026-10-05 页面观察、非成交价），登记 `COST-160-08`（planned 4,000，candidate）+ `AQ-160-06`。
- **账目**：沿用"追加即抬上限"先例（同 DEC-2026-09-12-R3 云鲸），必需家电预算 12,000 → 16,000，一期执行上限及已分配额 20.6 万 → 21 万（`control.phase_ceiling_cny`/`allocated_cny`/`budget_reconciliation.phase_1_ceiling_cny`、PKG-160 planned/need、竣工结算 pass_condition、`config/facts.yaml` fact.phase1_ceiling_cny 权威值同步），未分配仍为 0。
- **接口前置**：3200W 按 GB 55038 7.4.4 需 16A/2.5mm² 专用回路（现有厨房插座回路 4mm² 预留口径不足以共路承载），回路 21→22、点位与嵌位随橱柜 600 宽高柜方案冻结后落，台账面/高柜开孔前必须定型号；已入 topology pending_parameters。
- **未做**：同档竞品（方太/凯度/西门子等 3,000–6,000 档）比价未跑；嵌位设计未定；phase-scope/house.yaml 场景对象（3D 摆位与算量）随嵌位定案后另迭代，本轮仅入预算与采购台账。

### DEC-2026-10-05-R5 热水器型号方向换选海尔 KL7PRO

- **日期**：2026-10-05。
- **换选**：业主确认热水器型号方向由美的 JSQ30-MK6（1,399，价值档）换为**海尔 KL7PRO（静音王）16L 水伺服+增压+静音**，预算 2,600；京东活动页观察区间 2,444–2,612（业主侧检索转述，一手核价待下单前补）。价格线：≤2,500 直接买 / 2,500–2,800 正常 / >3,000 转 JM6S/JM6C。登记 `AQ-160-05-C`，`hot_water_decision.preferred_model` 更新；MK6/HWF Pro 原始证据链（AQ-160-05-A/B，观察日 2026-09-14）留档为价值/下探备选，只追加不覆盖。
- **账目**：`COST-160-05` planned null → 2,600（selection_confirmed_site_pending 不变）；PKG-160 need 14,825 → 16,496（热水器 floor 929→2,600），**超池 496** 挂 funding_status owner_review_pending_20261005——冰箱/洗衣机/热水器均为"现有设备不可用"条件件，任一不成立即回落，全部成立需业主追加约 500。
- **不变**：BLK-WATER-HEATER-SITE 全部前置（安装墙面 w_vrv_east、燃气表、排烟、CO 红线、物业审批）未解除前不得下单；"开发商设备可用则不买"仍是第一反转条件；16L 一厨两卫与"回水管已预埋、不上零冷水主机"口径不变。
- **未做**：KL7PRO 南宁一手核价与安装边界报价；JM6C/KL7PRO 同门对比的实测噪声数据。

### DEC-2026-10-06-R3 三项设计迭代延后登记（业主授权默认方案，执行轮次待排）

- **日期**：2026-10-06。业主已认可下列默认方向，但三者都要动 80 条路线标高/箱体几何/拓扑，混入 R1/R2 施工轮会不可验收，故先登记授权与执行条件。
- **① #41 分层标高裁定 → 默认方案：管线分层升入降板空腔 2.50–3.00m，保走廊净高 2.50m**。触发条件：单独一轮，改 `config/mep-hvac-coordination.yaml` 各层 from/to/via 标高 + `config/ceiling.yaml` 降板厚度/范围，按 `repair_channel` 同步四处并重算 registered_conflicts。不做的代价：153 处"管线低于吊顶完成面"仍是交底阻断项。
- **② 强电箱迁位 → 默认方案：从剪力墙 `w_foyer_east` 迁至非承重隔墙/玄关柜假墙内暗装**。触发条件：需先出玄关柜体与假墙做法（2–3 个候选位），并核物业对开发商预留箱的处置口径。不做的代价：21（潜在 22）路 + 进线 + 浪涌装不进 390mm 箱，或在承重墙上开大洞。
- **③ 空调 6 台内机供电 → 默认方案：逐台独立回路**（6 路，替换现 2 路）。触发条件：厂家正式配电图（PKG-030 / BLK-HVAC-DEEPENING）确认是否允许及端子/集中供电方式。登记"若厂家要求逐台，箱位需 +4"。
- **验证/未动**：本轮不改任何路线标高、箱体坐标与回路拓扑。

### DEC-2026-10-06-R6 施工排期捋顺：补三个接口冻结阻断项 + 两处依赖倒挂修正

- **日期**：2026-10-06。触发：业主要求"整个施工进度捋顺，以便围绕基座模型数据推进"；对 `schedule/phase-1/control.yaml` 23 个包做依赖体检（无序号倒挂、无悬空引用），发现 4 处真实缺陷。
- **诊断**：
  1. **水电与空调之间没有交底节点**：`PKG-030`（空调第一次安装，seq 30）与 `PKG-040`（水电改造，seq 40）都只依赖 `PKG-020`，互不依赖。而空调内机/外机供电（`hvac_power_living/bedrooms/outdoor`）属 `PKG-040` 的 `COST-040-05`，控制线与冷凝水接点同样在水电 scope——空调商可在无电气交接的情况下先进场；而 `SCH-040-01`（点位/回路与空调匹配）是 before_covering 检查，等于空调装完才核冲突。
  2. **橱柜深化图是水电点位的 owner，却排在水电之后**：微蒸烤预留点位（`sock_kitchen_oven`）、厨房台面电位、客卫扫地机基站柜格，全部等橱柜深化图，而 `PKG-110`（橱柜安装）在 `PKG-040` 之后 seq 110。缺的是"设计冻结"前置，不是安装前置。
  3. **吊顶封板不依赖防水**：`PKG-070` deps 只有 `[PKG-030, PKG-040]`，与 `PKG-050`（防水及闭水，含主卫沉箱二次排水）无依赖关系——闭水失败需返工时可能要动已封吊顶。
  4. **洁具不显式依赖水电**：`PKG-100` deps `[PKG-060, PKG-080]`，仅通过 060←050←040 传递；洁具直接消费水电成果（角阀、专用三孔、防水），传递链太长。
  5. **量房数据未成为任何阻断项**：`docs/pending-site-data.md` 52 项（给水入户点 #8、梁位 7 条、墙类型、立管/燃气表/排烟道、强电箱开箱、沉箱分界线）只挂在 `BLK-HANDOVER` 之下，没有独立门槛。
- **修正（不改任何付款门槛金额与 sequence 编号）**：
  1. 新增 `BLK-MEP-INTERFACE-FREEZE`（alignment_required）：水电/空调接口未联合冻结——点位与回路、吊顶内分层标高（#41 分区口径）、穿墙孔位高度、冷凝水接入点与立管、检修口与风口。`clears_when`：水电、空调、设计、施工四方联合交底并签认（附签认记录）。**挂到 `PKG-030.blockers` 与 `PKG-040.blockers` 双方**。
  2. 新增 `BLK-CABINET-FREEZE-FOR-MEP`（alignment_required）：橱柜深化图未冻结而它是水电点位的 owner。`clears_when`：橱柜深化图与水电点位表双向核对完成（微蒸烤预留点位/台面电位/基站柜格落实到图）。**挂到 `PKG-040.blockers`**——注意这是设计冻结前置，`PKG-110` 安装包本身仍保留在 seq 110。
  3. 新增 `BLK-SURVEY-DATA-FREEZE`（site_pending）：量房待填清单 52 项未清零。`clears_when`：影响水电与空调的条目逐项转为实测或显式豁免。**挂到 `PKG-000` / `PKG-030` / `PKG-040`**。
  4. `PKG-070.dependencies` 加 `PKG-050`（二次排水/防水/闭水在封板前完成，卫浴铝扣板吊顶须在贴砖后）。
  5. `PKG-100.dependencies` 加 `PKG-040`（洁具直接消费水电成果）。
  6. 新增两条交底留痕检查：`SCH-030-04`（空调侧：进场前提供机身/接管/检修口与水电接口清单）、`SCH-040-03`（水电侧：联合交底记录与签认归档，critical / before_covering）。
- **影响**：`schedule:render` 重出 checklist/budget；auditable checks 86 → 88。
- **未动**：sequence 编号、付款门槛（payment_gate）、各包预算与 COST 拆分、既有 blocker 定义。
- **验证**：`npm run verify:schedule` / `verify:facts` / `verify:all` / `test:server` / `typecheck` 见执行记录。


### DEC-2026-10-09-S01 决策日志按主题拆分：单文件 417 KB → docs/decisions/ 14 个主题文件 + README 索引

- **日期**：2026-10-09
- **决策事项**：`docs/decision_log.md`（2505 行 / 427,082 B / 177 条 DEC）过大且时间序混乱，按**主题**拆分为 `docs/decisions/` 下 14 个文件，原文件删除，由 `docs/decisions/README.md` 承接入口职责。
- **可选方案**：①按主题拆（本方案）；②按月份拆（2026-07/08/09/10）；③现役/归档分离（`decision_log.md` 只留近期 + 待决，旧内容进 archive）。
- **选定方案**：①。理由：DEC 的检索主线是"一件事的来龙去脉"（主卫 6 轮、客卫 R1-R7、东南角弧面 6 轮评审），主题文件让一次回溯只读一个文件；月份拆会把连续轮次打散，且 10 月仍要二次拆；现役/归档分离要反复重划边界。
- **拆分结果**（177 条全覆盖，正文一字未改，只改存放位置与文件内顺序）：

  | 文件 | 主题 | 条数 |
  |------|------|-----|
  | `01-control-budget.md` | 控制/预算/阶段边界 | 18（含本条 S01） |
  | `02-layout-public.md` | 布局与公共区 | 27 |
  | `03-master-bedroom.md` | 主卧 | 21 |
  | `04-bathrooms.md` | 主卫 + 客卫 | 19 |
  | `05-hvac.md` | 中央空调 | 12 |
  | `06-electrical.md` | 电气回路/走线/审计 | 21 |
  | `07-lighting.md` | 照明与起夜灯 | 7 |
  | `08-ceiling-form.md` | 吊顶造型（弧面返工全链） | 13 |
  | `09-ceiling-takeoff.md` | 吊顶算量与报价 | 10 |
  | `10-paint.md` | 涂漆 | 3 |
  | `11-tile-finish.md` | 贴砖与饰面终裁 | 13 |
  | `12-plumbing.md` | 给排水 | 4 |
  | `13-mep-integration.md` | MEP 标高/路由/水电主材基线 | 3 |
  | `14-style-furniture.md` | 风格/家具/地面 | 7 |

  最大文件 50 KB（原 1/8）。README 承载模板、待决策事项 4 节、文件索引、归档纪律与跨主题速查。
  表中条数按拆分时点计；本条登记在 `01-control-budget.md`，故该文件为 18 条。
- **决策依据**：
  1. 原文件里时间序有三段方向（头部倒序、中段正序、尾部正序），「待决策事项」被埋在 L934 后面还跟着 100 多条历史，README 教的 `cat docs/decision_log.md` 看待决事项实际要翻到文件中段；
  2. `config/facts.yaml` 早已把 decision_log 定性为"时间序档案，只做追溯，不做对账"（`exempt_occurrences` 全文件豁免），拆分不改变这一定性；
  3. 主题边界与本项目 config 的域划分一致（hvac/electrical/ceiling/plumbing/tile/paint/mep），后续新增条目的归档规则无歧义。
- **门禁同步（关键，缺一项即 error）**：
  1. `config/facts.yaml` `scan.exempt_occurrences` 路径 `docs/decision_log.md` → `docs/decisions/`（引擎 `pathMatches` 已支持目录前缀），否则新文件里的 ¥金额/回路数/㎡ 全部报 `unregistered_fact_occurrence`；
  2. `c.dec_unique.source` 与 `c.dec_ref_resolvable.target`、`c.dec045_subject_pending_adjudication.target` 由单文件改为 14 文件列表，为此改造 `shared/facts-lint.ts` 的 `runUnique`/`runFk` 支持 `string | string[]`（向后兼容，现有测试不受影响）——否则跨文件重号查不到、208 处短引 + 68 处 DEC-045 反查会集体 dangling；
  3. `c.gas_water_heater_model_resolvable.exclude` 与 `c.prose_paths_exist.exclude` 的 `docs/decision_log.md` → `docs/decisions/`；
  4. coverage 里 `config/mep-material-baseline.yaml` 5 个字段的 `readers: ["docs/decision_log.md"]` → `docs/decisions/13-mep-integration.md`（M01 所在文件）；
  5. 外部引用 10 个文件同步：README（目录树 + 快速开始）、`.opencode/agents/interior-designer.md`、`docs/visual-change-playbook.md`、`docs/twinmotion-acceptance.md`、`docs/mep-construction-guidance.md`（原带行号 `:1487`，行号失效故改指向 DEC 编号）、`schedule/procurement.md`、`schedule/phase-1/control.yaml`、`config/facts.yaml` 注释、`docs/design-iterations/hvac-caliber-sync-20261005/decision-brief.yaml`。
- **历史条目处理纪律**：本次只改路径字符串与文件内顺序，**不改写任何条目正文**；17 处 `关联文件：docs/decision_log.md（本条）` 自引用随条目落到新文件后改为指向所在文件（保留可追溯）。`docs/design-iterations/hvac-caliber-sync-20261005/decision-brief.yaml` 的"不得删除 docs/decision_log.md …只登记不改写"铁律同步修正为"正文不改写；位置迁移须登记 DEC"。
- **预算影响**：无。文档结构调整，不动任何 config 数据字段与预算口径。
- **关联文件**：`docs/decisions/`（新增 15 个文件）、`config/facts.yaml`、`shared/facts-lint.ts`、`tests/server/facts-lint.test.ts`、`README.md`、`.opencode/agents/interior-designer.md`、`docs/visual-change-playbook.md`、`docs/twinmotion-acceptance.md`、`docs/mep-construction-guidance.md`、`schedule/procurement.md`、`schedule/phase-1/control.yaml`、`docs/design-iterations/hvac-caliber-sync-20261005/decision-brief.yaml`、`tmp/split-decision-log.py`（一次性迁移脚本）
- **决策人**：业主（拆分方案经业主评审通过）
- **回滚**：全部改动收敛在一个提交，`git revert` 即恢复 417 KB 单文件状态。
- **一次性工具**：`tmp/split-decision-log.py`（tmp/ 按约定不入库）是迁移工具，输入是已删除的
  `docs/decision_log.md`；**不得重跑**——重跑会按旧映射表重建 14 个文件，抹掉本条及之后新增的条目。
  条目级映射已固化为本条的「拆分结果」表与各文件头部的本文件目录。
