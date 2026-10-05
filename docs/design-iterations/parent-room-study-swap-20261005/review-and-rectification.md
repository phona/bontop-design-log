# v0 审查报告与整改方案 — parent-room-study-swap-20261005

> 审查时间：2026-10-05（v0 实施后、R9 归档后）。
> 方法：独立复算——以 `config/layout/model-geometry.yaml` 几何、`config/ceiling.yaml` 吊顶、`config/electrical.yaml` 点位、`data/current-scheme.json` 预算映射为事实源，逐条对照 R9 承诺与 v0 落位；所有结论可复算。
> 结论先行：**家具与几何层无回归；但发现 1 个 P0 预算错价、1 个 P0 电气高度错误、4 项 P1 电气语义/预留、4 项 P2 文档与口径收口。** 整改不需要推翻 v0，全部是补丁。

---

## 一、承诺 vs 实现对照

| # | 承诺 | 实际 | 判定 |
|---|---|---|---|
| 1 | 只换功能不换几何 | `model-geometry.yaml` 仅改 room `name` 与 2 处注释文字；顶点/墙体/门/房间边界 diff 为空 | ✅ |
| 2 | 空调合同/机位/风管不动 | `ac_parent`/`ac_study` 机位、`ceiling_study_ac*`/`ceiling_corridor` 吊顶区域、MEP 路由几何均未改 | ✅ |
| 3 | 家具按稳健摆法落位 | 客房 wardrobe_180 x[14.35,16.15] z[5.55,6.15] + bed_150 x[14.35,16.35] z[6.85,8.35]；书房 desk/chair 原位 + 季节柜 x[4.30,6.00] z[5.55,6.10] | ✅ |
| 4 | 门扇扫掠禁入 | 客房衣柜西缘 14.35 > 扫掠东缘 14.30；床 minZ 6.85 > 扫掠 maxZ 6.55；书房柜 maxX 6.00 < d_study 扫掠 minX 6.15 | ✅ |
| 5 | 柜高 ≤2.40m 抵 2.50m 吊底 | 两柜体 recipe 均 2.40m+0.10m 顶封板=2.50m，与所在边吊底 2.50m 齐平（与原父母房衣柜同一做法） | ✅（见 P1-1 零净空登记） |
| 6 | 健身器材全链路删除 | placed 3 件 + materials 条目 + procurement 条目 + design-rules 映射与 topic + current-scheme selection 全清；recipe/dims 保留 | ✅ |
| 7 | 起夜照明立项（采购归二期） | 标准 v1 + 实例文档 + DEC 条目 + PKG-150 描述改写 | ✅ |
| 8 | 全量验证 | verify:all / test:server 608 / test:app 470 / typecheck 全绿 | ✅ |
| 9 | 电气“零改动” | 点位 id/坐标/高度/回路一个未改（仅注释） | ✅（但见 P0-2：零改动本身就是缺陷） |
| 10 | 预算正确 | **❌ 房间错价**，见 P0-1 | ❌ |

---

## 二、发现的问题

### P0-1 衣柜预算 roomOverride 错位（两个房间都算错价）

`data/current-scheme.json` 的 `wardrobe.roomOverrides` 仍是互换前的口径：

```
master_bedroom → wardrobe_north_950_custom_01
bedroom_se     → study_seasonal_wardrobe_170_01   ← 旧书房用柜，现在放客房了
```

实算后果（`BudgetCalculator` 现行 scheme）：

| 房间 | 实际放的柜 | 现在被按什么计价 | 现价 | 应按什么计价 | 正确价 |
|---|---|---|---|---|---|
| `bedroom_se`（客房） | `wardrobe_180` 1.8m 成品衣柜 | `study_seasonal_wardrobe_170_01` 1.7m 模块柜 | ¥2,600 | `wardrobe_180_01` | ¥3,200 |
| `study`（书房） | `study_seasonal_wardrobe_wall` 1.7m 季节柜 | topic 默认 `wardrobe_240_01` 2.4m 定制 | ¥4,200 | `study_seasonal_wardrobe_170_01` | ¥2,600 |

净影响：总额恰好抵消（+600 / −1,600 = −1,000），但**每间房的价格与实物不符**，PKG-150 一期家具池和 QR-2026-10-03-26 报价范围都会拿错数。这是本轮引入的唯一预算正确性缺陷。

**顺带发现的存量口径缺陷（非本轮引入，建议一并登记）**：`bed`/`mattress` topic 不按床宽计价——客房 `bed_150`/`mattress_150` 被按 `bed_180_01`（¥2,500）/`mattress_180_01`（¥2,000）计价；库里已有 `bed_150_01`（¥2,000）却没有对应 mattress_150 SKU。`bedroom_nw` 的 `wardrobe_180` 同样被按 `wardrobe_240_01`（¥4,200）而非 `wardrobe_180_01`（¥3,200）计价。

### P0-2 客房床头“有电位但高度不对”，实际无法使用

`sock_study_extra @(14.50, 5.55) h=0.3` 挂在 `w_be_north`，位置正好在床头顶部——但 **h0.3 是低位/踢脚线高度**（原书房备用插座口径），不是床头插座高度。西侧房原床头电位是 `h=0.7`（`sock_parent_bed_l/r`）。躺床高度（0.5m）+ 使用姿态，0.3m 墙插既够不着也容易被床/床垫挡住。

→ 客房目前**没有可用床头电位**。这一项必须在整改里补，不能把 h0.3 的点当归位。

### P1 电气语义与预留（4 项）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| P1-1 | 客房衣柜东段（x[15.80,16.15] z[5.55,5.85]）位于东北角吊正下方，柜顶 2.50m 与吊底 2.50m **零净空** | `ceiling_study_ac_corner` x[15.80,16.40] z[5.55,5.85]；wardrobe_180 recipe 总高 2.50m | 与原父母房衣柜“整条边吊下同条件”一致，属既有做法；但**必须显式登记为 accepted trade-off**，量房时复核吊顶实际完成面与柜顶封板做法 |
| P1-2 | 书房孤儿插座 `sock_parent_bed_l @(4.20,6.60)`：距书桌 2.6m，无对应电器 | 床已迁出；`sock_parent_bed_r @(4.20,8.90)` 距桌 0.4m 留用 | 改语义为“书房西墙备用/落地灯”，或量房后与新床头组一并位移。（注：AGENTS.md 的“插座≈电器 >1.5m 报警”**无自动化校验**，不会报错，属人工设计债） |
| P1-3 | 书房床头双控 `switch_parent_bed @(4.20,6.40) h0.7`：现在没人会按 | 双控另一端 `switch_parent_door` 可用 | 改语义“书房西墙双控（备用）”；量房时确认是否可移位到书桌位 |
| P1-4 | 书房空调线控器 `ac_panel_parent @(4.20,6.314) h0.7` 仍在原床头位 | DEC-2026-09-08-R1 当初因门口门垛仅 0.15m 容一板而放床头 | 改语义“书房墙面线控器（原床头位）”；门垛仍仅容一板，**位移到门边大概率放不下**，量房复核后定，勿假定 |

### P2 文档与口径收口（4 项）

| # | 问题 | 建议 |
|---|---|---|
| P2-1 | `night-path-lighting-instance.md` 的 NP-1 描述仍按“床沿/床侧”写，未对准 v0 床头朝北的实际 | 随床头组整改一并更新 NP-1 坐标与描述（床头北墙 h0.7 区） |
| P2-2 | `materials.yaml` 的 `bed_150_01` 注记仍写“父母房选低箱液压床箱款” | 改为“客房（供父母/客人）选低箱液压床箱款”等功能中性表述 |
| P2-3 | `dressing-map.md` 由生成器产出，`study_seasonal_wardrobe_170_01` 名称仍含“（书房）”——现在柜确实在书房，此项**反而是对的**；但 `wardrobe_180_01` 注记为“西北次卧（儿童房）用”，与客房冲突 | 修改注记为“西北次卧/客房等 1.8m 成品衣柜通用” |
| P2-4 | `config/electrical-topology.yaml` 的 `ordinary_power_parent_child` 注记仍写“书房 + 儿童房普通电源”，而客房现有插座实际挂 `ordinary_power_study` | 随 B5 决策一并改写（见下） |

### P3 证据缺口

- 未采集同版本浏览器证据（客房门口/床/书房/起夜路径第一人称），`review-manifest.json` 的 aesthetic/functional review 仍 BLOCKED——这是铁律要求，不是遗漏计算。

---

## 三、整改方案（分批，均可回滚）

> **批次 A 已完成（2026-10-05，DEC-2026-10-05-R10）**：
> `data/current-scheme.json` 的 `wardrobe.roomOverrides` 已改为
> `master_bedroom → wardrobe_north_950_custom_01`、`study → study_seasonal_wardrobe_170_01`、`bedroom_se → wardrobe_180_01`；
> 实算：客房 ¥3,200 / 书房 ¥2,600（原 ¥2,600 / ¥4,200），子项总额 22,100 → 23,500。
> 新增防回归测试 `wardrobe roomOverride must follow the furnishing actually placed in each room`
> （房间 → 实际放置柜类 → 应选 option 三元组锁定），此后任何功能互换不同步此表即红灯。
> 存量口径缺陷（bed/mattress 不按床宽、bedroom_nw 衣柜错价）**未擅自修改**，登记为待业主裁决。


### 批次 A — 预算正确性（P0-1）【已完成】
1. `data/current-scheme.json`：`wardrobe.roomOverrides` 改为
   `master_bedroom → wardrobe_north_950_custom_01`、`study → study_seasonal_wardrobe_170_01`、`bedroom_se → wardrobe_180_01`；
2. 顺带登记（**不擅自改**，等业主）：`bed`/`mattress` 床宽口径、`bedroom_nw` 衣柜错价两项存量缺陷 → 写入 `docs/pending-site-data.md` 或 decision_log 待决；
3. 验证：`npm run test:server`（budget-calculator 回归）+ `npm run verify:facts` + `npm run verify:all`。

### 批次 B — 客房床头组与书房电控补齐（P0-2 + P1-2/3/4 + P2-1/2/3）

> **B-1（B5-A 电脑回路改道）已完成（2026-10-05，DEC-2026-10-05-R13）**：`ordinary_power_study` 终点改道到书房书桌位 `sock_parent_desk`，走线复用走廊 x=5.5 穿孔带；客房三席位移交 `ordinary_power_parent_child`（capacity ≈1.2kW）。代价：`c.mep_layer_below_drop_bottom` 实算 +1（153→154，与同穿孔带三条既有路线同一类别），基数已由并发工作线同步登记为 154，`verify:facts` 绿。
>
> **B-2（客房床头双侧电位 + 床头双控）仍未做**：前置量房墙体数据（北墙 w_be_north 为 shear inferred，开孔/挂装条件待确认）；`sock_study_extra` h=0.3 的高度缺陷随 B-2 一并修正。
1. 客房北墙新增床头电位 ×2（候选 (14.60,5.55) 与 (15.60,5.55)，`wall: w_be_north`、`wall_side: south`、`h=0.7`、type socket）——**新增点位，不是把 h0.3 那个顶替**；
2. 客房北墙新增床头双控（候选 (15.60,5.55) h=0.7，与门边 `switch_study` 组双控，control 绑定随改）；
3. 客房线控器保留门边 `ac_panel_study`（h1.3）不动；
4. 书房：`sock_parent_bed_l`、`switch_parent_bed`、`ac_panel_parent` 三项改语义注释（P1-2/3/4）；
5. MEP：床头组新增 route declaration（挂哪条回路**取决于 B5**），过 `verify:mep`；
6. 同步更新 `night-path-lighting-instance.md` NP-1、`materials.yaml` 两条注记；
7. 验证：`verify:all` + `verify:mep` + `verify:electrical` + `test:server` + `typecheck` + 生成物再生成。

### 批次 C — 起夜照明预留条件（前置 = B5 + 量房路径地面）
`lighting_night_path` 回路 + NP-1..NP-9 底盒 + 床头调光零线的 declaration；**回路总数 21→22**，交底时报双排箱。灯体与采购归二期。

### 批次 D — 证据采集（P3）
起 dev server，按 `review-manifest.json` required_views 采同版本截图与 runtime AABB，回填 aesthetic/functional review。

### 需要你拍板的三件事
1. **B5**：书房电脑专用回路——改道到书房，还是修订 DEC-2026-10-03-R1 接受共路？（决定批次 B/C 的回路归属）
2. **床头壁灯要不要**：要→新方案 + 北墙/东墙结构探测（两堵都是 shear inferred）；不要→台灯/小夜灯接新床头电位即可。
3. **床/床垫计价口径**：客房 1.5m 床/垫现在按 1.8m 计价（贵约 ¥500+），是否接受，还是让我补 `bed_150_01` roomOverride（床垫库里没有 1.5m SKU，要按 shopping-research 流程补候选，不能凭空造）。

## 四、残余风险

- 凸窗带可站人性、飘窗台 2.07m、`d_bese` 门洞位置漂移、客房北墙/东墙构造——四项量房数据未回，批次 B/C 的点位坐标仍可能是候选值；
- 批次 A 不改任何几何，批次 B/C 在量房前只应做到“预留条件”级别，不宣称施工冻结。

---

## 五、并发改动提示（不属于本轮，禁止代为消音）

2026-10-05 15:22 前后，另一条工作线（客厅/餐厅冷凝水候选改线：`condensate-living` / `condensate-dining`
改走“北缘边吊→走廊吊顶→客卫开放洗漱区”）进入工作区但未提交。该改线使机器实算的
`c.mep_layer_below_drop_bottom` 冲突数由登记的 **149 升到 153**（2 条路由各新增 2 处低于吊顶完成面），
因此 `npm run verify:facts` 与 `tests/server/mep-hvac-lint.test.ts`（断言 149）当前为红。

- `verify:mep`（带 layout 的真校验）** Exit 0，无 error**；红灯只是“登记基数 vs 实算”对账。
- 按 facts 契约原文，只有两种合法解释：①设计侧真裁定（同步 prose/registered_conflicts/关闭 pending-site-data #41）；②有人改数据消音。**二者都必须是有意识的改动。**
- 本迭代**不代改**该基线、不碰给排水/MEP 文件；需该工作线自行收口。批次 A 自身范围全绿
  （budget-calculator 30/30、verify:schedule、verify:mep、typecheck、test:app 470/470）。

---

## 六、B-1 完成记录（2026-10-05，DEC-2026-10-05-R13）

| 项 | 改动 |
|---|---|
| `ordinary_power_study` 成员 | `[sock_study_desk, sock_study_curtain, sock_study_extra]` → `[sock_parent_desk]` |
| `ordinary_power_parent_child` 成员 | +`sock_study_desk`/`sock_study_extra`/`sock_study_curtain`，capacity ≈0.8kW → ≈1.2kW（方案值） |
| `strong-power-study` 路线 | 走廊 z=4.6 西行至 x=5.5 → 穿 w_st_north（与 ac/light/power 三条同孔区）→ 书房北边吊 → 贴 w_mb_east 南下 → `sock_parent_desk` |
| `sock_parent_desk` 注释 | 标注为电脑专用回路终点（count 2 = 电脑+显示器） |
| 对账 | `c.mep_layer_below_drop_bottom` 实算 +1（153→154），verify:facts OK；归口仍为 pending-site-data #41 |
| 决定编号 |  initially R11 与并发工作线撞号 → 改 R13（R11=客餐厅冷凝水改线，R12=卫浴洁具下调） |
