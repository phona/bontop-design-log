# 机电走线施工指导（水路 / 电路 / 中央空调，燃气除外）

> 状态：**协调级 v1（2026-09-01）**。本文档把 `config/mep-hvac-coordination.yaml`（132 条走线；2026-09-07 补全普通插座/照明/专用回路实体走线，DEC-2026-09-07-057；2026-10-04 DEC-2026-10-04-R2 补外机供电 strong-ac-outdoor，72→73；2026-10-05 给排水 v1 补 5 条排水路线并改 water-kitchen-requirement 端点，73→78；2026-10-05 DEC-2026-10-05-R18 两台内机方向相反+下出风成组补 2 条送风路线，78→80；2026-10-06 DEC-2026-10-06-R1 给排水缺项兜底补 7 条给排水路线，80→87；2026-10-07 v1 水路估算：6 条给水 + 1 条排水 requirement 按推断锚点提升为 physical（uncertainty ±0.3m、construction_status 恒 pending），并新增 5 条 water-v1-* 正交干管路由（热水器→两卫冷/热/回水），87→133；DEC-2026-10-07-R15 删除 NP-4b 夜灯路线后当前为 132）与邻户原始结构图（`survey/neighbor_ys01_original_structure_2025-06.png`）读出的墙体类型合并成一份施工沟通底稿。
> **不是施工放线依据**：所有坐标为协调值，穿墙点、梁位、立管、墙体类型均需交房量房后终核修正。配置驱动，修正只改 yaml，渲染与校验自动跟随。

## 0. 规模口径（与 config/facts.yaml 对账）

| 数据源 | 条目数 | 登记事实 |
|---|---:|---|
| `config/mep-hvac-coordination.yaml` | 共 132 条路由 | `fact.mep_routes_count` |
| `config/mep-hvac-coordination.yaml` | 共 8 层（强电/弱电/给水/排水/冷媒/冷凝水/送风/回风） | `fact.mep_layers_count` |
| `config/electrical.yaml` | 共 107 个点位 | `fact.electrical_points_count` |
| `config/plumbing.yaml` | 共 27 个点位 | `fact.plumbing_points_count` |
| `config/ceiling.yaml` | 共 25 个吊顶分区 | `fact.ceiling_zones_count` |
| `config/mep-hvac-coordination.yaml` 路线点位 vs 吊顶完成面 | 低于降板完成面的既有冲突 55 处 | 契约 `c.mep_layer_below_drop_bottom`（`registered_conflicts: 55`） |

> 上表数字必须与 yaml 实际条目数一致，否则 `verify:facts` 的 count/fact 对账直接失败。
>
> **表头口径说明**：末行的登记数 **55 处**是**契约登记数**，不是任何 `fact.*` 计数的复述——它由 `config/facts.yaml` 契约 `c.mep_layer_below_drop_bottom` 的 `registered_conflicts` 字段承载，并靠该契约的 `prose` 正则回抽本表末行数字做双向绑定（该行上方没有对应的 `fact.mep_routes_count` 之类的派生事实，登记事实列因此只写契约名）。

> **2026-10-06 DEC-2026-10-06-R5 更新（#41 已裁定，160 → 24）**：**分层标高升入降板空腔、保走廊净高 2.50m**（废止「降板加厚到 0.35–0.40m」方案②），分层标高从「低于吊顶完成面」改为**分区口径**：
>
> - **A 区**（走廊满吊 / 门厅满吊 / 客厅北缘边吊 / 餐厅两条服务带 / 各房边吊，完成面 **2.50**）：强电 **2.55**、弱电 **2.60**、冷凝水 **2.65**、冷媒 **2.60**（冷媒取 2.60 而非 2.65 是梁硬约束所致，见 §3.3），上限 **≤2.75**；层间关系保持 强电 → 弱电 → 冷凝水 → 冷媒 → 送风 2.68 → 回风 2.72。
> - **B 区**（厨房铝扣板 / 主卫铝扣板 / 客卫铝扣板，完成面 **2.65**，空腔仅 150mm）：进入该区的管路段 **≥2.70 且 ≤2.76**；不进 B 区的路线不动。
> - **梁硬约束**：任一路由在 5 条参考梁约束带内必须 **≤ 该梁参考梁底 −0.05m**（南窗带 2.73→2.68、厨房北窗带 2.65→2.60、厨房局部梁头 2.56→2.51、主卫梁头 2.41→2.36、走廊服务带 2.65→2.60）。不能同时满足「高于完成面」与「低于梁底」时**优先改平面绕开梁带**（保持正交折线、不新增穿墙、不改吊顶范围、不新增路线），确实绕不开的保留原标高并逐条显式登记。
> - **配套口径修正（DEC 明文授权，写进 `shared/mep-hvac-lint.ts` 与本契约）**：`ceiling_clearance_unverified` / `c.mep_layer_below_drop_bottom` 的比较范围收窄为**吊顶承载层**（强电/弱电/冷媒/冷凝水/送风/回风），**走地给排水（water_supply 0.18 / drainage 0.10）退出比较**——地面管与吊顶完成面无可比性，原口径把地面管计入冲突、稀释真信号。
>
> 实算 **55 处**「路线点位低于所经吊顶完成面」，涉及 **45 条路线 / 16 个吊顶分区**（`verify:mep` 与 `verify:facts` 双引擎实算一致；`shared/mep-hvac-lint.ts` 的 `CEILING_CARRIED_LAYERS` 与 `shared/facts-lint.ts` 的 `CEILING_CARRIED_LAYERS_FACTS` 同口径收窄，20 处走地给排水按 DEC-2026-10-06-R5 裁定退出比较）。**承载层 55 处残留全部显式登记，没有一处是静默的**：① 竖直下引至设备点位的末点（to_height 0.02–1.60m，点位坐标在 `config/electrical.yaml` / `config/plumbing.yaml`，本轮禁改；竖直下引段本身合法，属「设备在完成面以下」而非「管路穿出吊顶」）；② 贴在完成面上的设备开口（回风格栅 2.49，`config/ceiling.yaml` 回风口坐标即 2.49）；③ 窗帘盒内电动窗帘电源（0.7m）；④ `condensate-living` / `condensate-dining` 两条绕不开走廊服务带梁带的候选路线（末端立管接点 (6.70,3.70) 固定，客卫吊顶区除北缘开放边外四面有墙，重力管不得上弯，无法同时满足「梁带内 ≤2.60」与「客卫段 ≥2.70」，按 DEC「确实绕不开的保留原标高」处理，量房实测梁底后复判）。**路线条数仍 92 条不变（v1 估算干管另计）**；`config/ceiling.yaml`（降板厚度/范围）本轮未动。

> **2026-10-04 新增登记（契约 `c.mep_layer_below_drop_bottom`）——原始症状（已被 DEC-2026-10-06-R5 修正，留档备查）**：走线表的**分层标高整层低于降板完成面**——强电 2.45m / 弱电 2.50m / 冷媒 2.55m / 冷凝水 2.35m，而 0.30m 降板的完成面是 2.80−0.30=**2.50m**、0.15m 降板与铝扣板是 **2.65m**。当时实算 **160 处**「路线点位低于所经吊顶完成面」，涉及 **69 条路线 / 14 个吊顶分区**。分解链条按契约登记口径（与 `git log -p config/facts.yaml` 的 144→149→154→153→160 一致）：① 2026-10-05 给排水 v1 新增 5 条排水路线，每条在所属厨卫铝扣板吊顶范围内新增 1 处——144→149；② 2026-10-05 DEC-2026-10-05-R11 客餐厅冷凝水改线，`condensate-living`/`condensate-dining` 不再横穿客餐厅平顶，改经走廊吊顶进客卫开放洗漱区并移入候选端点——149→154，合计 +5 全部为分区内 hit；③ 2026-10-05 DEC-2026-10-05-R19 厨房铝扣板范围收回真实南墙 z=2.40（DEC-014 口径），z[2.40,4.30] 餐区改由 `ceiling_dining_north_band` + `ceiling_dining_west_band` 两条石膏板服务带（底 2.50）承担管线通道、餐桌中部恢复 2.80 平顶，`refrigerant-trunk` 原在厨房铝扣板（完成面 2.65）内的线段随之改在西侧服务带（完成面 2.50）空腔内，其 2.55 标高由低于完成面变为高于完成面，该 hit 合法消失——154→153；④ 2026-10-06 DEC-2026-10-06-R1 给排水缺项兜底新增 7 条 floor-branch 给排水路线（燃气热水器进水 / 主卫热水 / 客卫热水 / 回水管 / 洗碗机进水 / 进水总阀 / 主卫沉箱二次排水），每条在所经厨卫/套间吊顶 footprint 内新增 1 处「点位低于吊顶完成面」hit——给排水走地 0.02–0.45m 本就低于完成面，与既有给排水 floor-branch 路线同源、非 #41 分层标高问题，153→160（本轮按 `repair_channel` 附 DEC-2026-10-06-R1 全引 + 4 文件同步记此正当修正）；⑤ **2026-10-06 DEC-2026-10-06-R5 #41 裁定并执行**：160 → 24（承载层 −116、走地给排水口径豁免 −20，见上一段）。契约以 error 级强制：实算数与上表登记的 24 不符即失败（变多=有人乱加路线，变少=有人改数据消音）。

## 1. 走线总则

- **电与空调走顶**：主干藏走廊满吊（z=4.6 轴线）/门厅满吊/客厅北缘边吊，分支进各房间边吊；到点位上方后**沿墙竖直下引**（开关 1.3m、低位插座 0.3m、床头 0.6–0.7m）。空调插座贴边吊下沿，不下引。分层标高按 **A/B 分区口径**（DEC-2026-10-06-R5，见 §3.3.1）：A 区（完成面 2.50）强电 2.55 / 弱电 2.60 / 冷凝水 2.65 / 冷媒 2.60，B 区铝扣板（完成面 2.65）进入段 2.70–2.76；参考梁约束带内 ≤ 梁底−0.05。
- **水走地**：给水垫层内 0.18m，排水贴地 0.02–0.10m；重力管（排水/冷凝水）全程 1% 坡（阳台 2%），禁止上弯。
- **全部正交折线**，穿墙段与墙正交；穿墙点逐条声明在 `docs/design-iterations/mep-routing-20260901/design-datum.yaml`（v1 留档，penetrations 15 条），每条含墙 id、坐标、标高、门洞避让关系。
  > 口径：现行 route 级穿墙声明写在 `config/mep-hvac-coordination.yaml` 每条 route 的 `penetration` 数组里，合计 40 条声明、落在 21 个不同孔位（同一墙同一坐标由多条路线共用一孔，如 w_strip_east(4.2,4.6) 三管同孔）；`design-datum.yaml` 是 2026-09-01 v1 留档（15 条），**不是现行清点工具**，两套都以量房实测终核。
- 权威几何：`config/layout/model-geometry.yaml`；吊顶通道：`config/ceiling.yaml`；走线：`config/mep-hvac-coordination.yaml`（每条 route 的 reason 字段含逐条说明）。

## 2. 墙体类型参考图 v1（邻户图比例映射）

读图口径：实心黑填充 = 剪力墙/结构柱；空心双线 = 填充墙；带 LD/LH/LW 标注的多线 = 窗带/幕墙。邻户图东西向尺寸链 16.65m 与模型 15.85m 有差，**只能做轴线级映射，不能坐标级映射**；交房后以物业结构图 + 钢筋探测仪终核。

### 2.1 判读为剪力墙/结构（参考置信：高）——打孔开槽按承重墙工艺

| 墙 id | 位置 | 与本方案的关系 |
|---|---|---|
| w_mb_east | x=4.2 南段（主卧东/父母房西） | condensate-parent 贴此墙东侧南下（不穿）；下引点位优先避开 |
| w_strip_east | x=4.2 北段（套间条带东） | ⚠️ 三管同孔穿点 (4.2,4.6) 在此墙（冷媒/电源/弱电进主卧檐口）——钻孔前必须探测钢筋 |
| w_mbath_east | x=2.6（主卫东/西北卧西） | 无穿越；置信中（图上黑段与 2.6 轴线粗对） |
| w_foyer_east | 门厅东（配电箱墙） | 模型注释已标承重，与图一致；强电箱/弱电箱挂此墙 |
| w_be_north | 书房北（邻电梯厅） | 无穿越，禁入侧 |
| w_east_upper | 东外框 | 无穿越 |

### 2.2 判读为填充墙（参考置信：中）——开槽相对自由

| 墙 id | 位置 | 备注 |
|---|---|---|
| w_vrv_east / w_balc_east / w_kit_west | x=7.2 链（厨房西/阳台东） | 冷媒主干、水电穿厨房西墙均在此链，约束最小 |
| w_nw_south | z=4.3（儿童房南） | 穿点 x=4.35 距门洞仅 0.20m，量房重点复核 |
| w_st_north | z=5.55（书房北/走廊南） | 三管穿点 x=5.5 |
| w_be_west | x=13.4（书房西） | 主体填充墙，门洞旁有结构柱；过门头穿点 (13.4,5.9)/(13.4,6.29) 避开柱位 |
| w_gbath_south / w_gbath_east* | 客卫南/东 | 给水沿门洞区间低位通过，非穿孔 |
| w_st_east / w_liv_east / w_ent_west | 书房东/客厅东/入户花园西 | 图上分辨度不足，暂记填充墙待核 |

### 2.3 幕墙/窗带（禁挂、禁穿孔、禁开槽）

w_mb_south / w_st_south / w_liv_south / w_be_south（南面全链）、w_west_*（西外框含弧段）、w_bath_north / w_nw_north（北面幕墙段）、w_ent_north_railing（栏杆）。与 `config/layout/overlay.yaml` suppress 清单一致。

### 2.4 新建隔墙（图上不存在，由施工做法决定）

w_mbath_south（2026-08-25 台盆外移条带新建墙，给水/冷凝水穿点 x=0.26 / x=2.0 在此墙）——新建轻体墙开槽最自由，但要在砌筑时预埋线管/套管，不要砌完再剔。

## 2.5 梁位参考图 v1（邻户图比例映射）

读图口径：图例中虚线 = 梁线；每个房间中央的 **+2830 = 结构板底标高**（与我们模型层高 2.8m 一致）；梁旁的 LD/LH 数字 = **板底下挂深度（mm）**，即 **梁底标高 ≈ 2.83 − 下挂/1000**。下挂 750/760 这类大数值更可能是窗洞口高度而非梁，不计入梁位。全部条目为轴线级映射，`verify:mep` 中以 `reference_constraint_uncertain` warning 形式常驻提醒，**不得据此开孔或穿梁**。

### 2.5.1 已录入 config/hvac.yaml 的 5 条（lint 自动校验）

| id | 图上标注 | 梁底参考 | 范围（模型坐标） | 影响 |
|---|---|---|---|---|
| ref_south_window_band_ld100 | 南侧窗带 LD:100 | 2.73m | x[1.8,15.2] z[9.65,9.95] | 南侧窗带浅梁压缩客厅/卧室吊顶净空 |
| ref_kitchen_north_ld180 | 厨房北窗带 LD:180 | 2.65m | x[7.7,10.8] z[-0.15,0.25] | 影响冷媒主管转入与冷凝水坡度 |
| ref_kitchen_local_beam_head | LH:270/LW:210 | 2.56m | x[9.0,9.4] z[1.5,2.1] | 厨房局部梁头，阻断北侧服务带横绕 |
| ref_master_bath_local_beam_head | LH:420/LW:400 | 2.41m | x[1.2,1.9] z[3.5,4.1] | 主卫梁头；冷凝水穿点 x=2.0 已贴其东缘避让 |
| ref_corridor_service_band | 走廊浅梁组 | 2.65m | x[6.9,7.5] z[3.6,8.0] | 主干/分支汇集区，偏差影响所有入房转弯 |

> 状态口径（2026-10-06 与 `config/hvac.yaml` 对齐）：5 条中 **3 条 `inferred`**（`ref_south_window_band_ld100` / `ref_kitchen_north_ld180` / `ref_corridor_service_band`）+ **2 条 `pending`**（`ref_kitchen_local_beam_head` / `ref_master_bath_local_beam_head`，图上 LH：270/420 属局部投影，判读本身未定）。**均未 confirmed**，`beam_collision` 规则因此休眠（见 §6），5 条都只以 `reference_constraint_uncertain` warning 形式常驻提醒；量房逐条实测后按 §6 的墙/约束 confirmed 口径升级。

### 2.5.2 图上可见但未录入的候选（待判读，暂不收进 config）

- **主卫 LH:250**（竖向虚线，约 x≈1.0 一线）→ 若按梁读，梁底约 2.58m，影响主卫冷凝水/给水贴顶段；也可能是沉箱构造线，待量房拍照判读后再决定是否录入；
- **儿童房/客卫北 LH:400/LW:200**（约 x≈4.0 一线）→ 若按梁头读，梁底约 2.43m，紧邻儿童房穿点 x=4.35 所在墙面，**量房时优先核这条**；
- 玄关区 LH:710、各房间南向 LH:750/760 + LW:1160/1380——按窗洞口判读，不计梁位。

### 2.5.3 硬规则

管线不得穿梁（梁底受力筋密集，规范禁止梁上开洞钻孔，严于剪力墙开槽）；走线空间 = 梁底以下；绕梁优先，实测梁底低于参考值时下调穿点或改路。书房过门头穿点 2.45–2.55m 即按"门洞顶 2.1m 与参考梁底 2.65m 之间窗口"设定，梁底实测偏低则整条改路。

## 3. 规格与依据（三档置信度）


### 3.1 规范条文级（验收的硬依据）

| 事项 | 规格 | 依据 |
|---|---|---|
| 管内导线填充率 | 导线总截面积 ≤ 管内截面积 40% | GB 50327《住宅装饰装修工程施工规范》、GB 50303《建筑电气工程施工质量验收规范》 |
| 承重墙开槽 | 禁止横槽；剔槽不得损坏钢筋 | GB 50327 + 《住宅室内装饰装修管理办法》（建设部令第 110 号） |
| 钢筋保护层 | 剪力墙最小约 15–20mm | GB 50010《混凝土结构设计规范》 |
| 线管规格 | φ16 / φ20 绝缘电工套管 | JG/T 3050《建筑用绝缘电工套管及配件》 |
| 回路线径 | 照明 1.5mm²；插座 ≥2.5mm²；大功率单独回路 4mm² | JGJ 242《住宅建筑电气设计规范》 |

### 3.1a GB 55038-2025《住宅项目规范》电气条文（2026-10-03 收口新增，验收硬依据）

全文强制规范，自 2025-05-01 实施；与既有规定不一致时以本规范为准。

| 条文 | 要求 | 本项目落实 |
|---|---|---|
| 7.4.3-1 | 家居配电箱应设能同时断开相线和中性线且具隔离功能的**电源进线开关**；电源配电回路应设短路和过负荷保护；**电源插座回路均应加设剩余电流动作值 ≤30mA 的保护电器** | topology 21 路中所有含 `type: socket` 的回路 breaker 均带 `+漏保`；进线开关未建模，列入量房开箱确认（pending-site-data #30） |
| 7.4.3-2 | 保护电器单排布置的家居配电箱底边距地 **≥1.80m**；双排布置 **≥1.60m**；安装位置应便于使用维修维护 | 现 `panel_strong_entry_left` `mount_height: 1.65` → 双排箱合规、单排箱不合规；单/双排列为量房必测（#30） |
| 7.4.3-3 | 家居配电箱进出电源线应选用铜导体，**电源进线截面 ≥10mm²** | 待开箱复核（#30） |
| 7.4.4 | 住宅**照明回路、空调电源插座回路、电热水器等 2kW 及以上用电设备回路、厨房内的电源插座回路、其他功能用房的电源插座回路应分别设置**（类型级要求，不要求每房每灯独立） | 25 路合并至 20 路（DEC-2026-10-05-R3 浴霸按设备锚点拆每卫一路 → 21 路）：照明 5、空调内机 2、空调外机 1（2kW 以上设备单独成路）、专用 6（冰箱/洗碗机/洗衣机/烘干机/主卫浴霸/客卫浴霸）、普通 7 |
| 7.4.5 | 住宅电源插座均应采用**安全型插座**；**卫生间设置的电源插座尚应加设防溅措施**；每套住宅插座设置要求和数量应符合表 7.4.5；布置洗衣机、冰箱、排油烟机、排风机、电/燃气热水器、空调器处尚应加设 1 个专用单相三孔插座 | 专用三孔位已全覆盖（洗衣机/冰箱/烟机/两卫浴霸（换气模块承担排风，DEC-2026-10-05-R3）/燃气热水器/空调内机）；两卫共 8 个 socket，其中 6 个已在 note 声明防溅盒，`sock_mbath_batcheheater` / `sock_gbath_batheheater` 两个浴霸插座未声明，由新 lint 规则 `bath_socket_splash_box_undeclared`（`verify:electrical`）常驻盯住，水电交底前须补齐（GB 55038-2025 7.4.5，见台账 `docs/design-iterations/mep-lint-governance-20261006/review-manifest.json`） |
| 7.4.7 | 进出住宅建筑的金属管道应与接地装置做保护等电位联结；**装有固定浴盆或淋浴器的卫生间应设等电位联结作为附加防护** | 全屋尚无 LEB 点位：`shared/types.ts` 的 `PlumbingPointType` 已有 `leb` 枚举（2026-10-04 A6 补），`shared/project-render-facts-schema.ts` 已同源补齐，schema 不再挡路；契约 `c.leb_point_requires_bond_schedule` 在等端子箱位置与需联结金属构件清单，跟踪 `docs/pending-site-data.md #43`（位置未知前不得造点位，防水/贴砖前必须预埋），已进验收清单 `check_elec_leb` 与量房项 |

燃气探测器位置依据 **CJJ/T 146-2011《城镇燃气报警控制系统技术规程》**：探测器距灶具及排风口的水平距离均应 **>0.5m**；使用天然气等相对密度小于 1 的燃气时，探测器应设置在**顶棚或距顶棚 <0.3m 的墙上**（液化石油气相反，距地面 ≤0.3m）；且不应装在灶具正上方。本项目 `sock_kitchen_gas` 已按此定在 (10.80,0.20) h=2.35（DEC-2026-10-04-R2 按机体最近缘重算后北移；距油烟机北缘 0.53m、距灶具北缘 0.61m，依据 config/electrical.yaml sock_kitchen_gas note 与 docs/decision_log.md:1487），最终位置随燃气公司报警器 + 切断阀方案终核。

### 3.2 行业惯例/厂家文件级（最佳实践，非强制条文）

| 事项 | 数值 | 来源 |
|---|---|---|
| 冷凝水管坡度 | ≥1/100，全程无上弯 | 中央空调厂家安装手册（大金/日立等 VRV 安装书） |
| 86 底盒 | 面板 86×86mm；标准深 45–50mm；剪力墙用 40mm 薄型 | 市场标准件产品规格 |
| 点位高度 | 开关 1.3m、低位插座 0.3m、床头 0.6–0.7m、厨房台面 1.2m | GB 50327 建议范围 + 通行做法 |
| 剪力墙浅槽 | φ16 管单回路（≤3×2.5mm²），槽深 20–25mm | 由 3.1 的保护层与填充率推算的工程上限 |

### 3.3 项目协调值（本方案自定，量房后修正）

#### 3.3.1 吊顶内分层标高（2026-10-06 DEC-2026-10-06-R5 分区重设，#41 已裁定）

`config/mep-hvac-coordination.yaml` 的 `layers.height` 是 **A 区默认层高**；B 区由各 route 的 via/from/to y 单独体现。完成面权威 = `config/ceiling.yaml`（0.30m 降板 2.50m、0.15m 降板/铝扣板/窗帘盒 2.65m，空腔即完成面至 2.80m 结构板底）。

| 分层 | A 区标高（完成面 2.50） | B 区标高（完成面 2.65，铝扣板） | 说明 |
|---|---:|---:|---|
| 强电 strong_power | **2.55**（下限 ≥2.55） | **2.70** | 全分层最低；走廊服务带梁带内 ≤2.60 |
| 弱电 weak_power | **2.60** | **2.70** | 与强电保持净距；梁带内 ≤2.60（恰为参考梁底 2.65−0.05） |
| 冷凝水 condensate | **2.65** | **2.70** | 重力管 1% 坡、全程禁上弯；末端需落 B 区的路线起点取 A 区上限 2.75 以保住坡度 |
| 冷媒 refrigerant | **2.60** | **2.70** | 取值受走廊服务带梁带 2.60 上限约束（低于 A 区下限 2.55 的上限区间内取满），详见下表梁硬约束 |
| 送风 supply_air | **2.68**（原位不变） | — | 已在空腔内，无需抬升 |
| 回风 return_air | **2.72**（原位不变） | — | 回风格栅面板贴完成面（2.49，设备开口，见 §0 残留②） |

分区上限：A 区 ≤**2.75**（轻钢龙骨+板材占用后）；B 区 ≤**2.76**。

**梁硬约束（与 §2.5.1 的 5 条参考梁对应，上限 = 参考梁底 −0.05m）**：

| 参考梁 | 参考梁底 | 带内上限 | 本轮处置 |
|---|---:|---:|---|
| ref_south_window_band_ld100（x[1.8,15.2] z[9.65,9.95]） | 2.73 | 2.68 | 无路线进入该带 |
| ref_kitchen_north_ld180（x[7.7,10.8] z[-0.15,0.25]） | 2.65 | 2.60 | 无路线进入该带 |
| ref_kitchen_local_beam_head（x[9.0,9.4] z[1.5,2.1]） | 2.56 | 2.51 | **绕梁改道**：`strong-light-kitchen` / `strong-ded-dishwasher` 原 x=9.0 竖段贴梁头西缘，与厨房铝扣板 ≥2.70 无解，改沿服务带边缘西折至 x=8.6 正交下行后东折到位 |
| ref_master_bath_local_beam_head（x[1.2,1.9] z[3.5,4.1]） | 2.41 | 2.36 | `strong-power-mbath-service` 的 x=1.5 竖段压至 **2.35**（该段无吊顶、无完成面下限，按梁约束取值而非"压标高糊过去"） |
| ref_corridor_service_band（x[6.9,7.5] z[3.6,8.0]） | 2.65 | 2.60 | 主干/分支带内全部 ≤2.60（强电 2.55、弱电/冷媒 2.60）；`condensate-living` / `condensate-dining` **绕不开**——末端立管接点 (6.70,3.70) 固定、客卫吊顶区除北缘开放边外四面有墙，重力管不得上弯，无法同时满足「梁带内 ≤2.60」与「客卫段 ≥2.70」，按 DEC「确实绕不开的保留原标高」保留原值并列为显式残留（量房实测梁底后复判） |

**A→B 升位做法**：进入厨卫铝扣板的路线不在梁带内直接换标高——统一在**服务带内设竖向升降段**（同一 x/z 两点、只改 y，模型既有竖向做法），或在**不带梁的服务带水平段**上完成升位，确保梁带内段落始终 ≤2.60、厨卫段落整体 ≥2.70。

主干轴线（z=4.6、x=13.3、x=7.45）、全部穿点坐标——见 `design-datum.yaml`（穿点标高已随分层同步抬升，见各 route `penetration.height`）。

### 3.4 给排水规格与口径（2026-10-06 DEC-2026-10-06-R1 新增）

给排水管径分级、水封与附属通气管/间接排水的工程口径（依据 GB 50242《建筑给水排水及采暖工程施工质量验收规范》与通用图集；本项目量房后按实测立管复核）：

| 项目 | 口径 |
|---|---|
| 排污（马桶）管径 | **de110** |
| 排水干管管径 | **de75** |
| 排水支管管径 | **de50** |
| 水封 | 各受水点存水弯/水封 **≥50mm**；墙排/地漏均须保证 |
| 通气管 / 间接排水 | 按需设通气管或间接排水；排水口不得密封直插（须留溢流/间接接入，防虹吸与气堵） |
| 同层排水沉箱二次排水 | 主卫/客卫沉箱最低处设 **DN50 二次排水**，向二次口找 1% 坡 + 轻质回填 + 回填前通球与 24h 闭水（见 pending-site-data #50） |

> **管径登记口径**：排污 de110 / 干管 de75 / 支管 de50 为施工分级口径；`config/plumbing.yaml` 排水立管的 `diameter: 0.075` 与其马桶排污/立管 note 已按本口径补 `de110` 注记（**只加 note 文本、不改 diameter 数值**——0.075m 是既有登记值，全宅 de110 批量升级属设计决策，留待 docs/pending-site-data.md #41 轮裁定）。

## 4. 现场作业规则（给施工队的硬约束）

1. 玻璃幕墙/窗带墙体：禁止挂点、打孔、开槽（项目铁律）。
2. 判读为剪力墙的墙面（§2.1）：禁止横槽；竖槽前先钢筋探测仪扫筋；φ16 单回路浅槽 + 40mm 薄底盒为上限；装不下就把点位挪到填充墙。
3. 三管同孔区（w_strip_east z=4.6、w_st_north x=5.5、w_nw_south x=4.35、w_be_west 过门头）：钻孔分散排列，禁止并排大孔；过门头穿点 2.45–2.55m 位于门洞顶 2.1m 与参考梁底 2.65m 之间，量房实测梁底后方可开钻。
4. 重力管全程保坡，冷凝水禁止上弯、禁止直插地漏（要有存水弯/间接排水，最终接入点现场定）。
5. 新建隔墙（§2.4）砌筑时预埋套管，不后剔。

## 5. 量房复核清单（site-pending）

- 梁位：§2.5 表内 5 条已录 config 的参考梁位逐段实测梁底；2 条未录入候选（主卫 LH:250、儿童房/客卫北 LH:400/LW:200）拍照判读后决定是否升级进 config——后者紧邻儿童房穿点，优先核；
- 给排水立管位置、主卫沉箱下沉:300 分界线、燃气表位（不做燃气线，但表位影响厨房水电）；
- 两处薄余量穿点：w_nw_south x=4.35（距门洞 0.20m）、w_strip_east z=4.6（距门洞 0.05m）；
- 墙体类型终核：§2.1/2.2 全表按物业结构图 + 探测仪逐墙确认，确认后回填到本表并把置信度升为 confirmed；
- 三处吊顶外暴露段做法（客厅边吊南至书房过门头约 0.7m、弱电下引段、客卫开放洗漱区候选竖管穿铝扣板的收口做法）：包管/管窿/开槽现场定。原客餐厅冷凝水竖管外露段已随 DEC-2026-10-05-R11 移入 `ceiling_guest_bath` 吊顶，不再是外露段。

## 6. 验收自检

改任何走线/点位后运行：

```bash
npm run verify:all      # 含 verify:mep：穿墙声明、抑制墙穿越、坡度、包络重叠
npm run test:server
npm run typecheck
```

`verify:mep` 的结构安全规则（2026-09-01 新增，`shared/mep-hvac-lint.ts`；2026-10-06 补登此前漏登记的 `ceiling_clearance_unverified` / `reference_constraint_uncertain` / `suppressed_wall_crossing` / `nonphysical_route` / `supply_return_overlap`，并登记本轮新增的 4 条交底前规则）：

- `shear_wall_penetration`：路线穿越 `structure: shear` 的墙 → warning；墙与路线双双 confirmed 时升 error（剪力墙开孔须实测结构数据 + 套管 + 避钢筋区）。墙类型标注在 `config/layout/model-geometry.yaml` 的 wall 条目上（`structure` / `structure_status`），当前全部 inferred，交房量房确认后转 confirmed。
- `beam_collision`：`reference_constraints` 中 `status: confirmed` 且带 `reference_beam_bottom_y` 的梁位，物理路线在约束带内高于梁底 → error。当前 §2.5.1 的 5 条约束为 **3 条 inferred + 2 条 pending**（`ref_kitchen_local_beam_head` / `ref_master_bath_local_beam_head`），无一 confirmed，`beam_collision` 规则休眠；量房实测转 confirmed 后自动激活。
- `penetration_missing` / `penetration_point_mismatch`：逐墙核对——穿越的每面实体墙都要在 `penetration` 数组里有对应墙 id 的声明（confirmed 路线缺失即 error）；声明穿点与实际几何交点偏差 > 0.25m 报 mismatch。
- `ceiling_clearance_unverified`：路线点位低于所经实心吊顶（`drop` / `aluminum_buckle` / `integrated`）完成面 → warning。与 §0 的契约登记数同源不同级：契约 `c.mep_layer_below_drop_bottom` 用 error 锁「登记数 = 实算数」，本规则用 warning 逐条点名是哪条 route / 哪个分区。**DEC-2026-10-06-R5 明文授权的口径收窄**：本规则的比较范围只含**吊顶承载层**（strong_power / weak_power / refrigerant / condensate / supply_air / return_air），走地给排水（water_supply 0.18 / drainage 0.10）退出比较（地面管与吊顶完成面无可比性，原口径把 20 处地面管计入、稀释真信号；授权全引见 `shared/mep-hvac-lint.ts` 的 `CEILING_CARRIED_LAYERS` 注释与 `config/facts.yaml` 契约 `check_scope`）。当前实算 **55 处**，全部为 §0 已登记的显式残留（竖直下引至设备点位的末点 / 贴完成面的设备开口 / 窗帘盒电源 / 2 条绕不开梁带的冷凝水候选路线）。
- `reference_constraint_uncertain`：非 confirmed 的 `reference_constraints` 只提醒、不当硬碰撞；量房转 confirmed 后由 `beam_collision` 接手。
- `supply_return_overlap`：送/回风包络相邻重叠。风路线没有 `height`，`depth` 只是竖向代理，`shared/mep-hvac-lint.ts` 的 `airRouteBox` 注释明确它 "can produce a warning, but never supports a confirmed error"——本代码结构上不可能升 error。
- `suppressed_wall_crossing`：路线进入 `config/layout/overlay.yaml` suppress 的幕墙/窗帘区 → warning；confirmed 路线升 error。
- `nonphysical_route`：起终点重合（`design_requirement` 口径另走 `degenerate_requirement`）→ warning；confirmed 升 error。
- `route_overlap`：两条路线包络重叠（双双 confirmed 才 error）；共享主干的 trunk/branch 已按白名单排除。
- `gravity_slope_geometry_mismatch`：重力管声明 1%（阳台 2%）坡度，但折线段实际高差推不出该坡度（容差 ±50%）→ warning。DEC-2026-10-06-R1 已把 14 条全清（地埋全平/过陡、冷凝水候选沿程、墙排汇总不足坡、drain-balcony 2% 回算），当前实配 0 命中；现场仍须按 §1「重力管全程 1% 坡、禁止上弯」敷设。
- `route_not_orthogonal`：折线段非曼哈顿正交 → warning。DEC-2026-10-06-R1 已把 3 条给水路线（water-master-bath / water-guest-bath / water-garden-requirement）正交化，当前实配 0 命中；§1「全部正交折线」仍是铁律。
- `penetration_door_clearance`（**本轮新增**）：声明穿点距同墙门洞 <0.15m → warning。DEC-2026-10-06-R1 细分类别：declared height **高于门头高度** = 合法过门头穿梁，真风险在过梁/梁底而非门垛 → 归 survey_dependent（量房核梁底与套管后消，当前 13 条）；declared height **落在门洞高度带内**（会打门垛/门套）且净距 <0.15m → 留 must_fix_before_briefing（当前 2 条：water-guest-bath / water-balcony 低位过门洞）。交底前按类别逐条实测门洞/门套/过梁尺寸后重定穿点。
- `shear_wall_parallel_route`（**本轮新增**）：路线长距离贴剪力墙平行敷设 → warning。贴墙段须明确套管/剔槽/避钢筋策略，否则剪力墙开槽超出 §3.2 的浅槽上限。

**当前基线（2026-10-07 v1 水路估算后实跑口径；数字由 `tests/server/mep-guidance-baseline.test.ts` 动态对账，不写死）**：

- `npm run verify:mep` = **0 error / 与实算一致的 warning 数**（`shared/mep-hvac-lint.ts` 只输出三桶，未登记 code 一律落 must_fix 桶）；
- `npm run verify:electrical` = **0 error / 与实算一致的 warning 数**。
| 桶 / 规则组 | 条数 | 代码明细 |
|---|---:|---|
| MEP must_fix_before_briefing（交底前必须清） | 23 | shear_wall_parallel_route 14 + penetration_door_clearance 2 + penetration_missing 7（全部来自 2026-10-07 v1 水路估算干管 water-v1-*，量房日按实测墙位补 penetration 后归零） |
| MEP survey_dependent（量房后自然消/复判） | 83 | ceiling_clearance_unverified 56 + penetration_door_clearance 17 + shear_wall_penetration 10（ceiling 由 24 逐轮增至 56，全部来自 2026-10-07 声明式补路由"下行至声明设备点位的竖直末段"，属 §0 已登记①类残留同源） |
| MEP envelope_approximation（模型包络近似/非物理需求） | 19 | supply_return_overlap 8 + reference_constraint_uncertain 5 + suppressed_wall_crossing 4 + nonphysical_route 2（nonphysical 由 9 降为 2：route_kind=physical 的纯竖直段改为按真实管段计） |
| 电气 参数/覆盖依赖待定 | 53 | dedicated_parameters_pending 9 + point_uncovered 30 + pending_parameter 14 |

> 上表六组是**分类台账**，不是「已接受项」清单。逐条的 accept / reject / pending_adjudication 裁决、依据 DEC、责任人与解除条件，见治理台账 `docs/design-iterations/mep-lint-governance-20261006/review-manifest.json`（本轮新建）。旧的 `docs/design-iterations/mep-routing-20260901/review-manifest.json` 只留 v1/v2/v3 三轮评审结论，其中「15 条已接受项 / 22 warning」是 2026-09-07 的快照，**不再是现行基线**。
