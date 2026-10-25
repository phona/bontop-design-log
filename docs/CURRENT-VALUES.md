# 现行值速查表（CURRENT-VALUES）

<!-- 生成物，禁止手改：由 scripts/docs/current-values-render.ts 从权威源渲染（文档精简批 4）。
     重跑：npm run docs:generate-current-values；校验：npm run verify:all -- --only verify-current-values
     inputs-fingerprint: sha256:156f7a92b73971cc7d83972592c176ff44f23e38cb9f00061b6e329fb0aac29c -->

> **本表是什么**：一张回答「现在的准数是什么」的表。服务两类读者——AI（grep 到冲突值时第一步查这里，判断哪条现行）和人（不用翻 5 份文档）。
>
> **权威声明**：本表是速查汇总，**权威仍在各 config / docs 原文**。本表与权威冲突时，**以权威为准，并立即修订本表**（连同「权威源」列里的 `file:line`）。本表不创设事实，只转抄；任何情况下不得为了让本表好看而反向改权威源。
>
> **读法**：
> - 「现行值」列是当前生效口径；带 `pending` / `estimated` / `候选` / `封顶` 字样的是未冻结项，引用时必须连同状态一起引。
> - 「权威源」列为 `file:line`，可逐处跳转核对。
> - 「备注」列写口径边界（含/不含、估算/实测、封顶/成交）。**引用本表必须连同边界一起引**，只引数字会丢口径。
> - 标 ※ 的口径已由 `config/facts.yaml` 的 fact / 契约或 `tests/server/` 断言做机器对账；改这些数会先被门禁拦住，改完必须同步本表。
> - **生成口径（批 4 起）**：可机械取值的行由渲染器从权威源现取；编辑判断行保留字面，但其全部权威源已纳入文件头指纹——源文件一变，`verify:current-values` 即报红，须逐行复核后重跑生成。

## 预算与阶段

| 口径 | 现行值 | 权威源（file:line） | 备注 |
|---|---|---|---|
| 一期执行上限 | 210000 元 | schedule/phase-1/control.yaml:17,56 | 已分配额同值、未分配 0；历史基线 208000/190000 已作废 ※ |
| 一期预算池 | 6 池：基础硬装 126000 / 中央空调 36000 / 一期家具 19000 / 必需家电 16000 / 设计与开工准备 8000 / 一期窗帘 5000 | schedule/phase-1/control.yaml:34-52 | 六池合计 = 执行上限；家电 16000 含 GC5 追加 4000 |
| 暖通执行池 | 36000 元 | schedule/phase-1/control.yaml:40 | 与合同成交价同额；原 33000 询价口径作废 |
| 全硬装询价轮次目标 | all_in 205098 元（核心 187098 + 柜体 18000） | schedule/phase-1/control.yaml:203-207 | 业主提供的预算池/封顶/候选价，**不是合同承诺** |
| 墙砖面积（wall_region 实算） | 21.5505 ㎡ | config/layout/overlay.yaml（wall/sill_region 声明）+ config/layout/model-geometry.yaml（几何）+ config/tile-comparison.yaml（干湿分区）+ config/ceiling.yaml（净高上限）→ shared/masonry-takeoff.ts 实算；tests/server/masonry-takeoff.test.ts:160-168 | 窗台/防水台 sill_region 另计 15.468 ㎡；合计 37.0186 ㎡由契约 c.masonry_tile_area_parity 三方对账 ※ |

## 暖通

| 口径 | 现行值 | 权威源（file:line） | 备注 |
|---|---|---|---|
| 外机（成交配置） | 美的领航者Ⅳ MJV-200W-E01-LHIV，20kW / 大7匹 / 220V | config/hvac.yaml:23-32 | 成交配置 DEC-2026-10-04-R1；区别于三代 MJV-200W-E01-LHⅢ |
| 内机额定合计 | 25.3kW | config/hvac.yaml:37 | 六台双出风 /P-SS 全带泵；由 tests/server/vrf-config.test.ts 强制 ※ |
| 连接率 | 1.265（约 1.27） | config/hvac.yaml:39 | 25.3÷20.0；行业上限 1.30；同由 vrf-config.test.ts 断言 |
| 合同成交价 | 36000 元 | config/hvac.yaml:12,18 | 含辅材；**不含**复合风管与风口加长（加长 100 元/米另计）、不含税 ※ |
| 逐房内机映射 | 客厅 MJV-71T2/P-SS 7.1kW；餐厅 MJV-42T2/P-SS 4.2kW；主卧 MJV-56T2/P-SS 5.6kW；书房/儿童房/客房各 MJV-28T2/P-SS 2.8kW | config/hvac.yaml:42-72 | 2026-10-05 业主确认；机位/风口/吊顶净空仍待量房与厂家深化 |
| 西设备平台 | 1.6×1.00 m（bbox 1.60 ㎡） | config/hvac.yaml:33 | 含 r=1.0 西北圆角后「可用约 1.39 ㎡」是**估算**，权威 bbox 见 fact.west_platform_area ※ |
| 外机外廓 | 0.99×0.40×0.81 m | config/hvac.yaml:29-31 | **estimated**；200W 级实测尺寸与平台散热核算 site_pending（pending-site-data.md #39） |

## 电气

| 口径 | 现行值 | 权威源（file:line） | 备注 |
|---|---|---|---|
| 回路总数 | 20 路 | config/electrical-topology.yaml:5 | circuits.length=20；DEC-2026-10-13-R5 删电视墙灯带整条照明回路后回到 20；fact.circuit_count 对账 ※ |
| 空调内机回路 | 2 路：hvac_power_living + hvac_power_bedrooms | config/electrical-topology.yaml:71,82 | 6 台内机暂并口径；厂家正式配电图确认前不冻结供电分组 |
| 空调外机回路 | 1 路 hvac_power_outdoor_a2 | config/electrical-topology.yaml:94 | GB 55038 7.4.4 单独成路；C32A+漏保 / 4.0mm²(φ20) proposed，输入估 ≈6kW |
| 电气点位数 | 105 个 | config/electrical-topology.yaml:15 | 即 config/electrical.yaml 条目数；点位增删必须同步此数与 fact.electrical_points_count ※ |
| 强电箱 | 底边离地 1.65m；箱体 390×390×210mm | config/electrical.yaml:702-705 | 20 路 + 2P 进线 + 浪涌需**双排**；单/双排与进线截面待复测（pending-site-data.md #30） |

## 几何与标高

| 口径 | 现行值 | 权威源（file:line） | 备注 |
|---|---|---|---|
| 结构层高/室内净高 | 2.80 m | config/house.yaml:7；docs/mep-construction-guidance.md:76 | 邻户结构板 +2830 佐证；fact.floor_height_net 由 house.yaml 派生 ※ |
| A 区吊顶完成面 | 2.50 m | config/mep-hvac-coordination.yaml:7 | 0.30m 降板（2.80−0.30）；完成面权威为 config/ceiling.yaml（guidance:141 明文） |
| B 区铝扣板完成面 | 2.65 m | config/mep-hvac-coordination.yaml:12 | 0.15m 板厚；厨房/主卫/客卫三区，空腔仅 150mm |
| 客餐厅面积 | 43.17 ㎡ | config/house.yaml:178；config/hvac.yaml:36 | polygon 实测；bbox 45.88 ㎡含 2.71㎡ 凹口 ※（2026-10-25 DEC-2026-10-25-R01 本体标定重算后客餐厅 44.58→43.1734㎡，凹口 1.30→2.71㎡） |
| 套内面积 | 94.76 ㎡ | config/house.yaml:6 | 合同净口径；与毛口径/赠送/建面三口径未闭合见 pending-site-data.md #40 ※ |
| MEP 路线总数 | 138 条 | config/mep-hvac-coordination.yaml:4 | 走线表 routes 条目数；fact.mep_routes_count ※ |

## 材料选型

| 口径 | 现行值 | 权威源（file:line） | 备注 |
|---|---|---|---|
| 地砖选型基准 | KT 200×1200 木纹长条砖，29 元/片 | config/materials.yaml:748-769；config/tile-comparison.yaml:163-166 | 2026-10-12 业主定的**可推翻工作基准**（非终选）；手写报价 516 片=14964 元；箱规 unknown 前不能下单 |
| 燃气热水器 | 海尔 KL7PRO（静音王，16L 水伺服+增压） | schedule/phase-1/control.yaml:71,181-186 | DEC-2026-10-05-R5 定方向；BLK-WATER-HEATER-SITE 未解且一手核价前不下单 |
| 微蒸烤一体机 | 美的 GC5（TR850E-TSBC00，55L，3200W） | schedule/phase-1/control.yaml:191-193 | DEC-2026-10-05-R4 定标方向；需 16A 专用回路，激活时同步 fact.circuit_count |
| 智能马桶 | 九牧 ZQ6650 ×2，封顶 5598 元 | schedule/phase-1/control.yaml:395-402 | 封顶价不是成交价；坑距 305/400 待核（pending-site-data.md #31） |

## 待决

| 口径 | 现行值 | 权威源（file:line） | 备注 |
|---|---|---|---|
| 待决台账条数 | 74 条编号 | docs/pending-site-data.md:3 | #1–#74 + #3a 子项 = 75 行；fact.pending_site_data_count 锚在表头，新增/关闭必须同步编号数 ※ |
| #30 强电箱规格 | pending（单/双排、回路数、进线截面） | docs/pending-site-data.md:105 | 20 路 + 2P + 浪涌需双排；1.65m 底边仅在双排时合规 |
| #39 暖通待验证项 | pending（外机实测尺寸/平台散热/厂家配电图/风口加长计价/冷负荷计算书） | docs/pending-site-data.md:115 | 已成交 36000，但上述项闭环前不冻结施工 |

---

## 维护纪律

1. **新增口径**：先定位权威源（config 优先，docs 次之），在本表登记一行并写全 `file:line`；同时确认该数已被 `verify:facts` 的 fact / 契约或 `tests/server/` 覆盖。未被覆盖的高频数，按 `config/facts.yaml` 头部维护铁律补 mirror（必须写 `extract` + `expect_matches`，命中数不符即失败，不许静默跳过）。
2. **改数顺序**：改权威源 → 跑 `npm run verify:facts` 与 `npm run test:server` → 重跑 `npm run docs:generate-current-values` 同步本表。本表与权威冲突时，以权威为准并立即修本表；**不许反向改权威来迁就本表**。
3. **引用方纪律**：任何文档引用本表发现冲突，以权威源为准，并回来修本表；不得把本表当作第二权威，也不得因「本表已登记」就跳过权威源核对。
4. **汇总视图身份**：本表已按汇总视图整文件登记进 `config/facts.yaml` 的 `scan.exempt_occurrences`（数值均为已登记权威值的转抄），关键行另由 fact mirror 逐条对账。该豁免只免 T1 发现层的重复报警，**不免权威源侧的对账**；不得以本表已豁免为由在权威源里放松登记。
5. **生成纪律（批 4 起）**：本表禁止手改。新增/修改行请改 `scripts/docs/current-values-render.ts` 的行规约（取值器或字面行）后重跑生成；`verify:current-values` 以「渲染结果与文件逐字节一致」为契约，源文件变动而本表未复核重生成时必然报红。
