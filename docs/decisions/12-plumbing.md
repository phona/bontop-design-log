# 决策日志 · 给排水

> 本文件是 `docs/decision_log.md` 2026-10-09 主题拆分（DEC-2026-10-09-S01）的产物：
> 收录范围 = 上下水推断落库、端点绑定兜底、地漏重力排水、water_entry 落位修正。条目为原文件的连续切片，正文未改写；文件内按时间正序。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-07-F03` water_entry 落位修正：平台侧接入候选与户内阀位锚点解耦
- `DEC-2026-10-08-W01` 上下水按最佳实践推断落库：water_entry / 阳台立管 落点 + 13 条路线端点绑定
- `DEC-2026-10-08-W02` 端点绑定兜底：linter 两条新规则 + 10 处内联端点焊死 + water_heater 管道锚点
- `DEC-2026-10-08-W03` 上下水补齐（除入户花园）：客卫热水孤岛改绑 + 两卫 4 处地漏重力排水

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-10-07-F03 water_entry 落位修正：平台侧接入候选与户内阀位锚点解耦

- **触发**：verify-rules bounds error——`water_entry`（DEC-2026-10-08-W01 落库）坐标 (7.00,0.45) 在厨房西墙 w_vrv_east（x=7.20）外侧 0.20m（VRV 设备平台侧），却声明 `room: kitchen`，bounds 检查（tolerance 0.05）报错并阻断 verify:all。
- **辨析**：W01 的语义是"入户接入点在平台侧"（水表井/立管在公区，入户管经平台穿墙进厨房）——接入候选折点 (7.00,0.45) 本身没错且与 pending #8/#49、三条 requirement 路线的同源候选一致；错的是把**接入点**与**阀位锚点**两个语义压进了同一个点位——W01 note 自己写明本点用途是「总阀→减压阀→前置过滤器位」安装顺序锚（acceptance.yaml check_plumb_prefilter_and_prv），而阀件必须在户内可操作位，不能在室外平台。
- **决策**：两语义解耦——① 平台侧接入候选 (7.00,0.45) 保持不变，由 `water-kitchen-requirement` 的折线与 w_vrv_east 穿墙声明表达（口径不动，量房闭环同 #8）；② 点位本体修正为穿墙后的**户内阀位锚点** (7.35,0.45)（厨房西北角墙内侧 0.15m，bound 合规，room: kitchen 成立），status: inferred / not_for_construction: true / uncertainty_m 0.3 不变；③ 绑定本点的 4 条路线（water-water-heater-inlet / water-v1-entry-to-mbath-cold / water-v1-entry-to-gbath-cold / water-entry-valve-requirement）via 随新坐标改正交折线（原折点 x=7.00 在墙外，改 x=7.35 户内沿墙北上/南下，路线全程正交）。
- **验证**：verify-rules 0 error（bounds 清零）；verify:mep 0 error；`mep-hvac-lint.test.ts` / `mep-takeoff.test.ts` 全绿；pending-site-data #8 行同步。
- **关联文件**：`config/plumbing.yaml`（water_entry + §头纪律注释补记）、`config/mep-hvac-coordination.yaml`（4 条绑定路线 via）、`docs/pending-site-data.md` #8、`docs/decisions/12-plumbing.md`（本条）。
- **决策人**：业主。

### DEC-2026-10-08-W01 上下水按最佳实践推断落库：water_entry / 阳台立管 落点 + 13 条路线端点绑定

- **日期**：2026-10-08。触发：业主要求"没有上下水点位就按业界常用点位先落模型，量房日只核对不现场找点位"，明确不愿"一边找点位一边改代码"；授权口径为**全量落库**（推断点位 + 端点绑定 + 新增支路），全部带 `not_for_construction` / `construction_status: pending`，量房日升级 `measured`。
- **为什么不是"位置未知不许造点位"**：`config/plumbing.yaml` 头部注释 3 与 `config/facts.yaml` #43 口径针对的是**连候选值都没有**的情形（#43 LEB）。本轮两个新点位的坐标**全部取自仓内既有候选**——`water_entry` 取 `water-kitchen-requirement` / `water-water-heater-inlet-requirement` / `water-entry-valve-requirement` 三条路线一直在用的 `(7.00,0.45)` 折点（= `docs/pending-site-data.md` #8/#49 登记的入户候选）；`drain_riser_balcony` 取既有 `drain-balcony` 路线终点 `(6.50,1.50)`（2026-10-06 DEC-2026-10-06-R1 改向后的"接入阳台排水立管方向"）。**一个数都没新造**，与 2026-10-05 给排水 v1 的同款先例一致（把登记的推断值写进点位 + `status: inferred` + `not_for_construction: true`）。#43 LEB 仍不建模。
- **业界最佳实践依据（写入 note）**：① 新交付住宅水表井多在公区/户外，入户管通常经**设备平台/管井**进厨房，本户型厨房与 VRV 平台仅一墙（x=7.2），故取 (7.00,0.45) 穿 `w_vrv_east`；户内顺序固定"总阀 → 减压阀 → 前置"（既有验收项 `check_plumb_prefilter_and_prv`）；② 阳台排水立管多在阳台与厨卫之间的管井/墙角，洗衣机独立三通、不通地面泄水地漏（否则共路反水）。
- **变更清单**：`shared/types.ts` / `shared/project-render-facts-schema.ts` / `shared/mep-takeoff.ts` / `shared/render/InfrastructureBuilder.ts` + `FixtureFactory.ts`（新增 `water_supply` 类型与水表箱渲染配方）；`config/plumbing.yaml` +2 点位（27→29）；`config/mep-hvac-coordination.yaml` 13 条路线端点由内联坐标改绑点位 id（`water-kitchen-requirement` / `water-water-heater-inlet-requirement` / `water-entry-valve-requirement` / `water-hot-water-mbath|gbath-requirement` / `water-water-heater-recirc-requirement` / `water-v1-heater-to-mbath|gbath-hot` / `water-v1-entry-to-mbath|gbath-cold` / `water-v1-recirc-loop` / `drain-mbath-secondary-requirement` / `drain-balcony`）+ 新增 `water-purifier-branch` / `drain-balcony-floor-to-riser` 2 条路线（132→134）；`config/mep-takeoff.yaml` 补 2 条 `pipe_route_segments`；`docs/mep-construction-guidance.md` §0 规模表同步；`docs/pending-site-data.md` #8/#44/#50/#51 状态更新。
- **修掉的隐性缺陷**：`shower_mbath`(0.50,2.76) / `shower_gbath`(7.10,2.45) 的给水路线**本来就画在 3D 里**，但端点是内联坐标（恰好等于点位坐标），导致 takeoff 判"未路由"、房间归属丢失、点线无法互查——本轮绑定后这 4 条 v1 干管 + 3 条 requirement + `drain-mbath-secondary-requirement` 一致。
- **碰到的硬约束（留档）**：`shared/mep-hvac-coordination-schema.ts` 的 `validateMepCoordination` 明文**禁止 `source_status: design_requirement` 的路线引用给排水点位 id**（"Requirement plumbing route must not imply an authoritative plumbing endpoint"）——即"只表达需求、未画线"的路线不得指向已建模点位，否则需求就被当成了权威落点。故 `water-garden-requirement` / `drain-garden-requirement` 两条**保持内联坐标不改绑**（其端点本是"龙头出水口/地漏中心"示意值，非墙盒位），与 #48 入户花园去留未决、两点位本身是"不能接管就删"候选的状态一致。这条约束也解释了给排水 v1 为什么只把 6 条 requirement 提升为 physical、花园两条始终留 requirement。
- **数字变化（可复算）**：覆盖度 routed 97→**103**、unrouted 33→**29**（剩余 29 个 = 电气 27 + 给排水 2，给排水仅剩 `faucet_garden`/`drain_garden` 随 #48 去留保持 requirement）；有效点位 130→**132**；路线 132→**134**；给排水点位 27→**29**；管长仅新增两段可复算几何（净水器竖向下引 0.50m + 阳台地漏竖段 0.566m），其余 15 条路线几何未动故长度不变；`requirementRoutes` 仍为 2 条（花园两条随 #48 去留保持 requirement、不计量）；`feasibleForQuote` 仍为 false（主干线径 pending + 花园 2 条 requirement + `sock_child_ac`/`sock_kitchen_oven` deferred），**推断值不进入任何报价**。
- **边界（本轮明确不做）**：① 不动电气侧 33 个未路由点位（另一批，等 SKU/橱柜冻结与线控器归属裁定）；② 不给 `faucet_garden` / `drain_garden` 补 physical 路线（#48 去留未决，两点位本身是"不能接管就删"的候选）；③ 不建 #43 LEB；④ 不改 `config/acceptance.yaml` 任何验收项；⑤ 推断值一律不得作为施工放线依据，量房日核对表见 `docs/pending-site-data.md` #8/#50/#51。
- **量房日核对表（一张表，逐项打勾）**：水表井位置与入户管径（DN20/DN25）→ 平台侧能否开孔（物业）→ 全宅总阀/减压/前置安装位与柜体净空 → 厨房/主卫/客卫三处排水立管实测位（现均 inferred ±0.3m）→ 阳台立管位与洗衣机墙排接入方式 → 主卫沉箱深度 300/330 与最低点 → 燃气热水器机身尺寸（h=1.8 插座是否被挡）。
- **验证（本轮实跑结果）**：`verify:mep` 0 error / 125 warning（与本轮前完全同桶：must_fix 23 / survey 83 / envelope 19，**新增 2 条走地给排水路线 0 warning**，因 DEC-2026-10-06-R5 已把 water_supply/drainage 移出吊顶净空比较）；`verify:mep-takeoff` OK（C2 有效点位 132、C9 未路由 29、deferred 2、requirement 2、pending 1，与预期逐项一致）；`verify:facts` OK（39 warning，`fact.plumbing_points_count` 镜像 29 对账通过）；`verify:project-render-facts` plumbing=29；`typecheck` 0；`test:server` 737/749——余 12 个失败**全部与本轮无关**：5 个为 DEC-2026-10-07-M05 已记录的 `outdoor_a2` anchor 与外机 id 重复（`config/hvac.yaml` 既有问题），7 个为并发电气/夜灯会话未提交改动所致（`electrical-lint` point_uncovered 58≠53、mep-ceiling-clearance 的 `probe-mixed` 与 curtain_box_master_west footprint 漂移、layout/spatial/paint/RuleEngine/HouseScene 簇）；其中 `mep-ceiling-clearance` 那条已用脚本证明**加不加本轮两个点位结果完全相同**。`data/project-render-facts.json` 已重新生成。
- **本轮同步更新的测试基线**：`tests/server/mep-takeoff.test.ts`（routed 97→103、faucet 4→5、新增 shower 2 / drain_riser 4 / water_supply 1 断言、端点解析 132→134）、`tests/server/mep-hvac-lint.test.ts`（路由数 132→134 ×2）、`tests/server/cli-glb-export.test.ts`（plumbing fixtures 20→21，新增 `water_supply` 渲染配方）。
- **关联文件**：`config/plumbing.yaml`、`config/mep-hvac-coordination.yaml`、`config/mep-takeoff.yaml`、`config/facts.yaml`、`shared/types.ts`、`shared/project-render-facts-schema.ts`、`shared/mep-takeoff.ts`、`shared/render/InfrastructureBuilder.ts`、`shared/render/FixtureFactory.ts`、`docs/mep-construction-guidance.md`、`docs/pending-site-data.md`、`tests/server/mep-takeoff.test.ts`、`docs/decisions/12-plumbing.md`（本条）。
- **决策人**：业主。


### DEC-2026-10-08-W02 端点绑定兜底：linter 两条新规则 + 10 处内联端点焊死 + water_heater 管道锚点

- **日期**：2026-10-08。触发：业主要求"让 linter 兜底，否则改动还得靠 review 配置和代码，不现实"——量房时的标准动作只是改点位坐标，任何"本该跟着走却没跟着走"的东西必须被机器喊出来。
- **新增规则**（`shared/mep-hvac-lint.ts`，随 `verify:mep` 一起跑）：
  - `endpoint_not_bound_to_point`（warning，**must_fix_before_briefing** 桶）：非 requirement/candidate 路线，`from`/`to` 写成内联坐标、且与**同专业点位**平面重合 ≤0.02m → "该端点不跟随点位，请改用点位 id"。同距多点位时在消息里列出候选，要求按 route reason 裁定绑哪一个。
  - `inline_endpoint_without_point_anchor`（warning，**survey_dependent** 桶）：给排水层的内联端点 >0.02m 内没有任何同专业点位 → 进"量房判读清单"，不强行绑。
  - **三条明文边界**（写进代码注释，避免后人误扩）：① requirement/candidate 路线豁免——`validateMepCoordination` 禁止 design_requirement 路线引用给排水点位 id，对它们报警只会产出改不掉的 warning（#48 花园两条即属此类）；② 只查 from/to 不查 via——via 是几何弯点不是设备位，折点 stale 由 `route_not_orthogonal` 与端点重生成时处理；③ 强电/弱电只查"重合未绑"——它们的内联端点多数是吊顶缘汇流点（DEC-2026-10-07-M04 地插 from 口径），报"无锚点"是纯噪音。
  - 判定容差 0.02m = 坐标两位小数舍入量级再留一倍余量：≤0.02m 只可能是"抄了点位坐标写成字面量"；>0.02m 视为有意的工艺差（如 `faucet_garden` 出水口 10.85 vs 底盒 10.80 的 0.05m）不报警。
- **当场焊掉 5 处"重合未绑"**：`water-v1-entry-to-mbath-cold` / `-gbath-cold` 的 `from` → `water_entry`（此前只绑了 to，入户点一改两卫 cold 干管起点就留在原地）；`water-entry-valve-requirement` 的 `from` → `faucet_kitchen_sink`；`drain-kitchen-requirement` 的 `from` → `drain_kitchen_sink`（排水路线应锚排水点位而非龙头）；`water-hot-water-mbath-requirement` 的 `to` → `faucet_mbath_vanity`。
- **新建 `water_heater` 管道锚点**（7.30,1.00,h1.20）：坐标取自 `config/house.yaml:524` furnishings 锚点，一个数都没新造。此前 **6 条**给排水路线把该坐标写成内联字面量（`water-water-heater-inlet-requirement` / `water-v1-heater-to-mbath-hot` / `-gbath-hot` / `water-v1-recalc-loop` / `water-balcony`），而热水器正是 #26/#32 待量房项——量房一移位，6 条线集体静默 stale。新增类型 `water_heater` 并加入 `SUPPLY_TYPES` 与 lint 的给水锚点池，但**不进 `FIXTURE_TYPES`**：house.yaml furnishings 已渲染热水器本体，再画一个箱子就是双重几何。
- **顺手修两条过期 note**：`faucet_kitchen_purifier` 与 `drain_balcony_floor` 的 note 还写着"本轮不画 MEP route"，而 W01 已给它们画了路线（`water-purifier-branch` / `drain-balcony-floor-to-riser`）——这正是"配置与模型不同步"的活例，本轮改为"已画路线 + 仍待定项"。
- **数字变化**：路线数仍 **134**（只改端点引用方式，不增删路线）；给排水点位 29→**30**；覆盖度 routed 103→**104**、unrouted 仍 **29**；`endpoint_not_bound_to_point` 实算 **0**（焊完后归零，成为哨兵）；`inline_endpoint_without_point_anchor` 实算 **5**（`drain-kitchen-requirement` to(6.95,0.5) 推断立管接入方向 / `water-hot-water-gbath-requirement` to(6.7,2.7) 穿墙点 / `water-water-heater-recalc-requirement` to(0.4,2.6) 回水阀预留 / `water-kitchen-dishwasher-branch` to(8.8,0.3) 洗碗机锚点 / `drain-mbath-secondary-requirement` to(1.4,1.15) #50 二次排水口方向）——这 5 条就是量房日要给业主看的判读清单。管长不变（绑定不改几何，`terminalDrop` 全为 0：各路线 to_height 均不高于所绑点位高度）。
- **量房闭环（本轮之后成立）**：改 `config/plumbing.yaml` 任一给排水点位坐标 → 绑定点位的路线起终点自动跟随 → 跑 `verify:mep` / `verify:mep-takeoff`：`endpoint_not_bound_to_point` 抓"漏绑"、`inline_endpoint_without_point_anchor` 给判读清单、`route_not_orthogonal` / `gravity_slope_geometry_mismatch` / `penetration_point_mismatch` 抓折点与坡度返工、覆盖度与 facts 对账抓数量漂移。仍要人判断的三类：坡度取值、穿墙孔位、剪力墙平行段（warning 级，不阻塞但交底前要逐条过）。
- **验证**：`verify:mep` 0 error / warning 130（must_fix 23 不变、survey 88 = 83+5、envelope 19 不变）；`verify:mep-takeoff` OK（C9 未路由 29）；`verify:facts` OK；`verify:project-render-facts` plumbing=30；`test:server` 相关 4 文件全绿（`mep-takeoff` / `mep-hvac-lint` / `mep-guidance-baseline` / `cli-glb-export`）。
- **已知外部问题（非本轮）**：并行会话在 `shared/mep-hvac-lint.ts` 有未提交的 `unsupported_span`（飞线依托）改动，其新代码 `from.y`/`to.y` 两个 TS18048 报错 + 未跟踪的 `scripts/verify/mep/debug-support.ts` 4 个 TS2322 报错，使 `npm run typecheck` 当前为红——与本轮规则无关，需该会话自行收口。
- **关联文件**：`shared/mep-hvac-lint.ts`、`shared/types.ts`、`shared/project-render-facts-schema.ts`、`shared/mep-takeoff.ts`、`config/plumbing.yaml`、`config/mep-hvac-coordination.yaml`、`config/facts.yaml`、`docs/mep-construction-guidance.md`、`docs/pending-site-data.md`、`tests/server/mep-takeoff.test.ts`、`docs/decisions/12-plumbing.md`（本条）。
- **决策人**：业主。

### DEC-2026-10-08-W03 上下水补齐（除入户花园）：客卫热水孤岛改绑 + 两卫 4 处地漏重力排水

- **日期**：2026-10-08。触发：业主在连通性核查后要求"除了入户花园，都帮我补上"。
- **背景（本次修的两个真实缺口，来自逐点连通性核查而非"没画线"）**：① 客卫 `water-guest-bath`（`faucet_gbath_vanity ↔ toilet_gbath`）自成环但上游无源，是**取水孤岛**——根因是 `water-hot-water-gbath-requirement` 的 `to` 指向穿墙点内联坐标 `(6.7,2.7)`，而主卫同构那条已经绑到 `faucet_mbath_vanity`；② 两卫 4 处地漏（`drain_mbath_shower` / `drain_mbath_floor` / `drain_gbath_shower` / `drain_gbath_floor`）从来没有重力排水路线（plumbing.yaml note 原写"待量房确认"）。
- **A. 客卫热水改绑**：`water-hot-water-gbath-requirement` 的 `to` → `faucet_gbath_vanity`，`via` 由 `(6.7,2.45)` 改为 `(7.05,2.45)`（保持正交：x 7.10→7.05 后沿 x=7.05 北行 1.45m 至台盆位下方），`to_height` 0.30→0.80 对齐主卫口径。改绑后客卫并入 `water_heater` / `water_entry` 主树，形状与主卫完全同构。
- **B. 4 条重力排水路线**（`drain-mbath-shower-to-riser` / `drain-mbath-floor-to-riser` / `drain-gbath-shower-to-riser` / `drain-gbath-floor-to-riser`）：终点一律用已登记推断立管（主卫 (0.30,1.30) pending #19 / 客卫 (5.80,2.40) pending #7 同源），口径照抄 `drain-mbath-toilet-to-riser`：`gravity_floor_drain` + `from/to_height` 三点回算 1% 坡且单调非升 + 起端略高于地漏缘（垫层内敷设近似）+ **全程在房间内不穿墙**（故不声明 penetration）+ 精度三件套 `status: inferred` / `source_status: plan_supported` / `construction_status: pending`。与既有 `drain-*-to-riser` 的西行带平行且相距 ≥0.35m、不共轴（避免 `route_overlap` 与"同一物理路径不重复画线"惯例冲突）。客卫淋浴那条取 z=2.40 而非台盆路线已占的 z=2.45。
- **显式区分（避免混淆）**：`drain_mbath_floor` 这条是**地面泄水**，与 #50 `drain-mbath-secondary-requirement`（防水层下二次排水）是两回事，不得并入同一接点——已在两条 reason 互写。
- **数字变化**：路线 134→**138**；覆盖度 routed 104→**108**、unrouted 29→**25**（给排水侧只剩 `faucet_garden` / `drain_garden` 两处，随 #48 去留保持 requirement）；给排水点位 30 不变（未新增点位，全部复用既有推断点位）；管长新增 4 段合计 4.90m de50 支管（1.20+1.85+0.55+1.30），`water-hot-water-gbath-requirement` 换绑后 hot/25 长度小幅变化；`inline_endpoint_without_point_anchor` 5→**4**。
- **边界**：① 入户花园 2 处不动（#48 去留未决 + 验证器禁止 requirement 绑点位）；② 推断值一律 `not_for_construction` 口径的 `construction_status: pending`，不作为施工放线依据；③ 坡度、分歧/水封做法、立管实测位三项仍需量房定，linter 只保证"几何自洽"不保证"施工正确"。
- **验证**：`verify:mep`（预期 0 error；新增 4 条重力线若触发 `route_overlap` / `gravity_slope_geometry_mismatch` / `route_not_orthogonal` 需回头调折点）、`verify:mep-takeoff`（C2=133、C9=25、routed 108）、`verify:facts`、`verify:project-render-facts`、`verify:consistency`、`typecheck`、`test:server`（路线数 138、routed 108、drain.routed 14 三处基线同步）。
- **关联文件**：`config/mep-hvac-coordination.yaml`、`config/mep-takeoff.yaml`、`config/plumbing.yaml`（4 个点位 note）、`config/facts.yaml`、`docs/mep-construction-guidance.md`、`tests/server/mep-hvac-lint.test.ts`、`tests/server/mep-takeoff.test.ts`、`docs/decisions/12-plumbing.md`（本条）。
- **决策人**：业主。

