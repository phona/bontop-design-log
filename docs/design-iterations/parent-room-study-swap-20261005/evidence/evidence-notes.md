# evidence-notes — parent-room-study-swap-20261005

> 纯讨论轮次记录。**本轮未采集任何浏览器/渲染证据，未修改任何配置文件。**
> 所有结论分三类：①权威源可核对的事实；②由几何推导的推断（标注“粗算/待核”）；③业主决策与待决事项。

## 讨论轮次

### R1（2026-10-05）交换父母房与书房 + 删除健身器材

- 业主诉求：交换父母房与书房；删掉健身器材；“让我看看你的建议”。
- 业主随即澄清：**只是功能交换，不是几何交换**。
- 核实结论（权威源）：
  - 两房几何/天花/机电高度对称，最大利好是 **空调容量与机型完全对称**：两房均为成交设备 MJV-28T2/P-SS 2.8kW（`ac_parent` @(5.50,6.00) 在 study、`ac_study` @(15.10,5.85) 在 bedroom_se），¥36,000 合同（DEC-2026-10-04-R1）与逐房映射（DEC-2026-10-05-R1）**不需要动**。
  - 容量对调后：书房 2.8kW÷12.75㎡ ≈ 220W/㎡（与原父母房设计口径一致）；客房 2.8kW÷8.35㎡ ≈ 335W/㎡（超配无害）。
  - 删除对象：`bench_adjustable` / `adjustable_dumbbell_pair` / `rollable_training_mat` 三条 placed + `home_fitness_light_set_01`（¥1,800 candidate 未核价、procurement `current_stage=selection` 未下单）。
  - 阶段边界：PKG-150 一期家具池 ¥19,000 含“父母房床、床垫和成品衣柜”；“东南书房全部家具”后移二期未采购。
- 当时提出的三个待解决问题：父母房面积从 12.75㎡ 缩到 8.35/9.45㎡；起夜动线；噪音。

### R2（2026-10-05）父母建议：客房跟我们隔开 + 书房承担更多储物

- 业主转述父母建议：**客房应该跟我们隔开**；同时书房要承担更多储物收纳。
- 核实结论：
  - “隔开”只有东南角能做到：现西侧中间房与主卧**直接共墙** `w_mb_east`（x=4.20，shear inferred）；换到 bedroom_se 后与主卧/主卫之间隔客餐厅+主走廊，不共墙、不共用卫生间门口、不共用电视墙。
  - **新发现 1**：`elevator_shaft`（x[13.40,15.25] z[2.90,5.55]）与客房北墙（z=5.55 的 x[13.40,15.25] 段）**直接共墙**。此前任何轮次（含书房期）均未评估电梯噪声/振动 → 登记为 site_pending。
  - **新发现 2**：客卫是全屋唯一公区卫生间（x[5.60,7.10] z[2.20,4.30]），东南翼加卫生间须改西侧排水立管，不现实 → 卫浴共用无法解决，只能缓解。
  - 起夜动线粗算（未经工具核算）：现父母房门口→客卫 ≈2m；东南客房门口（d_bese @13.40,≈6.1）→客厅→主走廊→客卫 ≈8–9m。
  - 书房储物墙面盘点：北墙 1.95m（柜≤2.40m，避让 d_study 扫掠 x[6.15,7.05]）；东墙 3.35m 无吊顶但**即客厅电视墙**（客厅侧通顶柜 z[5.55,6.90]、低柜 z[6.95,9.05]、65" 挂装 z=8.00 已占满）；南墙飘窗台下约 1.8m（柜≤2.00m，窗台 2.07m 为推断值待量房 #20）；西墙北段 1.95m。
- 提出客房两个排布方案（A：床靠东外墙+1.8m 衣柜北墙、床尾半进凸窗带；B：床靠北墙全避凸窗带+衣柜缩 1.2–1.5m 放西墙门下）。

### R3（2026-10-05）不急着开工，持续讨论

- 业主确认：先把方案聊透；同意建立本迭代工作区（五件协议）。
- 本工作区建立：`fact-table.yaml` / `object-manifest.yaml` / `decision-brief.yaml` / `design-datum.yaml` / `review-manifest.json` / `evidence-notes.md`。
- 状态：`frozen: false`、`delivery_ready: false`、10 项 alignment 待收口。

## 已知文档漂移（本轮发现，实施前必须处理）

| 编号 | 内容 | 影响 |
|---|---|---|
| D-1 | `model-geometry.yaml:249` d_bese 的 anchor(v_be_se_s)/offset 3.7 与 `verify-furniture-placement.ts:400` 门扇扫掠域 x[13.40,14.30] z[5.65,6.55]（以及 house.yaml、mep 穿墙注释）口径不一致 | 客房家具扫掠判据以哪边为准 |
| D-2 | `config/facts.yaml` 跨文件对账把“父母房 12.75㎡”与 HVAC 220W/㎡ 绑定；互换后须改写为“父母房 8.35㎡ / 书房 12.75㎡” | `verify:facts` 会红 |
| D-3 | `ceiling.yaml` 书房/父母房两条天花注释、`hvac.yaml` load basis、`electrical.yaml` 点位注释均按旧功能叙述 | 实施时必须改注释而非只改数据 |
| D-4 | `overlay.yaml` 窗帘 element reason 提到“父母房（study…）”“书房（东南次卧南墙）” | 同上 |

### R4（2026-10-05）接受代价 + 立项起夜照明

- 业主原话：“这个没关系，我们还需要做，接近就自动亮起地面灯，提高起夜的体验感。我们不只这套房子。”
- 结论：
  1. **接受**互换的三项硬代价（面积收缩、起夜动线、卫浴共用），互换方案继续推进；
  2. **起夜路径照明立项为必做项**：人接近即自动亮起的地面灯，覆盖 客房→客厅→主走廊→客卫 全程；
  3. “不只这套房子”含义待确认（本户型非父母唯一住所？还是要沉淀成可复用标准？）→ 登记为 `align-portfolio-scope`。
- 已核实的电气基线（`fact-lighting-baseline`）：全屋**现有 0 个**感应/低位夜灯；可用资源为 `lighting_entry_base`（light_corridor_1 @(7.90,5.00) 等）、`lighting_bedrooms_batch`（各寝区吸顶+厨卫面板）、house.yaml 已声明的“智能预留 B 级（智能开关零线+网关位+电动窗帘电源+人体传感器位）”。
- 新增 site_pending：起夜路径地面完成面/门槛高差、照度与选型参数、客卫扫地机基站避让。

### R5（2026-10-05）A+B：本户落地 + 可复用标准

- 业主原话：“A + B一起做。我们继续其它议题，把方案聊透”。
- 产出：
  1. **可复用标准** `docs/standards/night-path-lighting.md` v1（坐标无关：夜路径定义、点位规则、光学/电气规格、控制分层、失效与验收、复用步骤）；
  2. **本户实例** `night-path-lighting-instance.md`：8–9 个候选点位 NP-1..NP-9、新增独立回路 `lighting_night_path`（C16A）。
- 新发现：过渡段 NP-4→NP-5 间距约 5.4m，**超出标准 §4-1 的 3m 暗区上限**，需补 NP-9（x≈8.6,z≈5.5）或西移 NP-4；点位最终数以路径实测为准。
- 客房定位确认：按“客房（父母/客人）”推进，不再按长期同住老人房设计 → 面积/动线两项硬代价的权重下降，但**不取消**缓解措施。
- 状态：`align-night-path-lighting-design`、`align-portfolio-scope` 已关闭；剩余 9 项 alignment，转入客房排布议题。

### R6（2026-10-05）先把约束聊透

- 业主原话：“我们先把约束聊透，不然我觉得你会做偏”。
- 产出：**约束台账** `constraints-ledger.md` v1——A 几何结构 / B 合同采购 / C 既有决策 / D 标准验证 / E 自我审计 / F 待业主补充，共 40+ 条，每条带出处。
- 自我审计纠正 7 项（详见台账 E 节）：改 model-geometry 仅限 name/注释；方案 A 依赖"凸窗带可站人"未实测假设（已转决策树）；柜前 0.45m 属惯例突破须显式记录；起夜照度参数改为候选默认值；**作废**随口估的北墙隔声造价；容量 basis 文本漂移须同步（D-2）；西北次卧客房弹性不得默认失效（升格为约束 C4）。
- 标准 v1 §5 同步修正：光学/电气规格标注为"候选默认值，非规范引用值"。
- 状态：等业主补充 F 节约束后再继续排布/储物议题。

### R9（2026-10-05）v0 实施完成

- 业主拍板"开始"：按稳健摆法做最小交换（全部 `candidate_not_frozen`）。
- 实施内容：house.yaml 两房家具互换 + 房间改名；model-geometry/overlay 仅改 name 与注释；electrical/ceiling/hvac/mep/topology 注释纠偏（id 一律未改）；删除 home_fitness 全部条目（materials/procurement/design-rules/current-scheme）；facts.yaml `fact.parent_room_area` 对账措辞更新；decision_log 新增 DEC-2026-10-05-R9；PKG-150 描述随功能改写并重渲染 schedule。
- 测试改写：`study-seasonal-storage.test.ts` 作废 → 新增 `tests/server/parent-room-study-swap.test.ts`（6 项）；budget-calculator / cli-glb-export / spatial-validation 三处断言随新状态改写；`scripts/generate-dressing-map.ts` 恢复 `furnishings 共 N 件` 对账行（此前丢失致 verify:facts 红灯）。
- 结果：`verify:all`、`test:server` 608/608、`test:app` 470/470、`typecheck` 全绿；无配置几何改动，git 可回滚。
- 新发现（已登记）：`ordinary_power_study` 书房电脑专用回路物理管线现通向客房——口径债，禁止默认共用儿童房回路；`furniture:study:desk↔west_curtain` 一条 glass clearance 警告为存量（与本次无关）。

## 未采集/禁止伪造
- 未经 `npm run` 任何验证命令；无浏览器证据、无截图、无 runtime AABB。
- 起夜距离、面积口径、W/㎡ 均为几何推导，量房后必须复核。
