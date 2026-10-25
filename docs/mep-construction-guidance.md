# 机电走线施工指导（水路 / 电路 / 中央空调，燃气除外）

> 状态：**协调级 v1（2026-09-01）**。本文档把 `config/mep-hvac-coordination.yaml`（138 条走线；2026-09-07 补全普通插座/照明/专用回路实体走线，DEC-2026-09-07-057；2026-10-04 DEC-2026-10-04-R2 补外机供电 strong-ac-outdoor，72→73；2026-10-05 给排水 v1 补 5 条排水路线并改 water-kitchen-requirement 端点，73→78；2026-10-05 DEC-2026-10-05-R18 两台内机方向相反+下出风成组补 2 条送风路线，78→80；2026-10-06 DEC-2026-10-06-R1 给排水缺项兜底补 7 条给排水路线，80→87；2026-10-07 v1 水路估算：6 条给水 + 1 条排水 requirement 按推断锚点提升为 physical（uncertainty ±0.3m、construction_status 恒 pending），并新增 5 条 water-v1-* 正交干管路由（热水器→两卫冷/热/回水），87→133；DEC-2026-10-07-R15 删除 NP-4b 夜灯路线后当前为 132；2026-10-08 DEC-2026-10-08-W01 上下水按最佳实践推断落库：新建 water_entry / drain_riser_balcony 两个推断点位（坐标取自既有候选路线端点，一个数都没新造），15 条给排水路线端点由内联坐标改绑点位 id，新增净水器进水与阳台地漏两条路线——132→134，给排水点位 27→29；全部 status: inferred / construction_status: pending / not_for_construction，量房日升级 measured；2026-10-12~10-17 各批删改以 config 同名头部计数链为准，DEC-2026-10-17-R20 水电 review 落地删除 2 条旧位路线（strong-ded-fridge / strong-power-parent-child-parentbed-l，新位走线专项另画），130→128；同批走线专项为 7 个新点位补 7 条路线（strong-ded-fridge-living / strong-power-waterbar / strong-power-kitchen-east / strong-power-weakbox / weak-ap-master / strong-light-balcony / strong-light-entry-night-mid），128→135；2026-10-23 DEC-2026-10-23-R03 客卫沉箱二次排水补 1 条需求路线，137→138）与邻户原始结构图（`survey/neighbor_ys01_original_structure_2025-06.png`）读出的墙体类型合并成一份施工沟通底稿。
> **不是施工放线依据**：所有坐标为协调值，穿墙点、梁位、立管、墙体类型均需交房量房后终核修正。配置驱动，修正只改 yaml，渲染与校验自动跟随。

## 0. 规模口径（与 config/facts.yaml 对账）

| 数据源 | 条目数 | 登记事实 |
|---|---:|---|
| `config/mep-hvac-coordination.yaml` | 共 138 条路由 | `fact.mep_routes_count` |
| `config/mep-hvac-coordination.yaml` | 共 8 层（强电/弱电/给水/排水/冷媒/冷凝水/送风/回风） | `fact.mep_layers_count` |
| `config/electrical.yaml` | 共 105 个点位 | `fact.electrical_points_count` |
| `config/plumbing.yaml` | 共 33 个点位 | `fact.plumbing_points_count` |
| `config/ceiling.yaml` | 共 25 个吊顶分区 | `fact.ceiling_zones_count` |
| `config/mep-hvac-coordination.yaml` 路线点位 vs 吊顶完成面 | 低于降板完成面的既有冲突 101 处 | 契约 `c.mep_layer_below_drop_bottom`（`registered_conflicts: 101`） |

> 上表数字必须与 yaml 实际条目数一致，否则 `verify:facts` 的 count/fact 对账直接失败。
>
> **表头口径说明**：末行的登记数 **101 处** 是**契约登记数**（沿革：50→54（DEC-2026-10-17-R20）→52（R21）→49（R22-v0.5）→62（DEC-2026-10-19-R25 外包络复核，DEC-2026-10-22-R01 对账确认）→101（DEC-2026-10-23-R04：ceiling_guest_bath 东界随客卫东墙线 7.10→7.20 后 SE 角点 (7.20,4.30) 与走廊枢纽 bend_corridor 重合，39 条经枢纽路线起点单点触碰角部新增登记，逐条 diff 核实无实体穿越，见下段）），不是任何 `fact.*` 计数的复述——它由 `config/facts.yaml` 契约 `c.mep_layer_below_drop_bottom` 的 `registered_conflicts` 字段承载，并靠该契约的 `prose` 正则回抽本表末行数字做双向绑定（该行上方没有对应的 `fact.mep_routes_count` 之类的派生事实，登记事实列因此只写契约名）。

> **2026-10-06 DEC-2026-10-06-R5 更新（#41 已裁定，160 → 24）**：**分层标高升入降板空腔、保走廊净高 2.50m**（废止「降板加厚到 0.35–0.40m」方案②），分层标高从「低于吊顶完成面」改为**分区口径**：
>
> - **A 区**（走廊满吊 / 门厅满吊 / 客厅北缘边吊 / 餐厅两条服务带 / 各房边吊，完成面 **2.50**）：强电 **2.55**、弱电 **2.60**、冷凝水 **2.65**、冷媒 **2.60**（冷媒取 2.60 而非 2.65 是梁硬约束所致，见 §3.3），上限 **≤2.75**；层间关系保持 强电 → 弱电 → 冷凝水 → 冷媒 → 送风 2.68 → 回风 2.72。
> - **B 区**（厨房铝扣板 / 主卫铝扣板 / 客卫铝扣板，完成面 **2.65**，空腔仅 150mm）：进入该区的管路段 **≥2.70 且 ≤2.76**；不进 B 区的路线不动。
> - **梁硬约束**：任一路由在 5 条参考梁约束带内必须 **≤ 该梁参考梁底 −0.05m**（南窗带 2.73→2.68、厨房北窗带 2.65→2.60、厨房局部梁头 2.56→2.51、主卫梁头 2.41→2.36、走廊服务带 2.65→2.60）。不能同时满足「高于完成面」与「低于梁底」时**优先改平面绕开梁带**（保持正交折线、不新增穿墙、不改吊顶范围、不新增路线），确实绕不开的保留原标高并逐条显式登记。
> - **配套口径修正（DEC 明文授权，写进 `shared/mep-hvac-lint.ts` 与本契约）**：`ceiling_clearance_unverified` / `c.mep_layer_below_drop_bottom` 的比较范围收窄为**吊顶承载层**（强电/弱电/冷媒/冷凝水/送风/回风），**走地给排水（water_supply 0.18 / drainage 0.10）退出比较**——地面管与吊顶完成面无可比性，原口径把地面管计入冲突、稀释真信号。
>
> 当前实算 **101 处**「路线点位低于所经吊顶完成面」，涉及 **78 条路线 / 16 个吊顶分区**（DEC-2026-10-19-R25 外包络复核口径：按管径+声明保温逐点/每 50mm 采样，与契约 registered_conflicts 101 双引擎一致；2026-10-23 DEC-2026-10-23-R04 对账增量 +39：ceiling_guest_bath 东界 7.10→7.20 后 SE 角点 (7.20,4.30) 与走廊枢纽 bend_corridor 坐标重合，39 条以该枢纽为端点的路线在起点单点触碰角部（标高 2.55 < B 区完成面 2.65、含外包络 110mm），逐条 diff 核实无一例实体穿越新增东界带，属角点单点触碰登记、量房实测任一偏移即消解；上一态 62 处 / 50 条路线（DEC-2026-10-22-R01 对账确认）；上一态 R22-v0.5 历史快照 49 处 / 42 条路线 / 15 分区，R22-v0.5-3 纯重力迭代 −3：condensate-living/dining 走廊段抬入吊顶腔（重力口假设 2.52 待厂家 #39），走廊/客厅带 3 处低板 hit 消失；上一态 52/42 为 DEC-2026-10-18-R21 走线修复 −2：strong-power-kitchen / strong-ded-dishwasher 尾段改 w_ent_west (10.8,2.35) 竖井落地进垫层，ceiling_kitchen hit 合法消失；上一态 54/44 为 DEC-2026-10-17-R20 走线专项后口径，其 +4：strong-ded-fridge-living / strong-power-waterbar / strong-power-kitchen-east / strong-power-weakbox 四条路线终点即设备点位本身，落吊顶分区边缘、属已登记①类「竖直下引至设备点位的末点」同类残留；其中 ceiling_entry_foyer 为新增涉及分区）。契约登记数已按修正通道同步 50→54（config/facts.yaml `registered_conflicts` + pending-site-data #41 注记，DEC-2026-10-17-R20 走线专项），verify:facts 双 FAIL 已闭合；上一致结果为删 2 条旧位路线后的 50/40/14。历史上，DEC-2026-10-12-R1 删除两条主卧壁灯路由后由 55→54，R2 删除四条卫浴照明路由后由 54→52；这些是设计侧删路由导致的真实减少。DEC-2026-10-17-R4 规定吊顶承载层中 `method: floor_branch` / `floor_branch_candidate` 且至少一个点进入 `y≤0.35m` 垫层带时，才退出吊顶完成面比较；高位误标仍参与比较，并由 `floor_branch_missing_floor_band` 显形，开放起降仍由 `unsupported_span` 按实际 3D 长度检查。事实引擎现与 MEP 共用渲染用的 rounded footprint 与线段相交算法，修复了此前只按 route points 统计的差异：此前漏掉的 `strong-power-master × curtain_box_master_south` 段内穿越现已计入；sofa-r 穿过 `ceiling_living` / `ceiling_entry_foyer` 的垫层段和 sofa-l 的地面支路不再产生“低于吊顶面”误报。R22-v0.5 历史双引擎快照为49处 / 42条路线 / 15个分区（R22-v0.5-3 纯重力迭代：condensate-living/dining 走廊段抬入腔 −3，52→49；上一态：DEC-2026-10-18-R21 走线修复 −2：strong-power-kitchen / strong-ded-dishwasher 尾段改 w_ent_west (10.8,2.35) 竖井落地进垫层，不再低于 ceiling_kitchen 完成面，登记数已按修正通道同步 54→52；上一态 54/44/15 为 DEC-2026-10-17-R20 走线专项 +4 后口径）；设备末端低位、贴完成面的开口及绕梁冷凝水路线仍按现场项复核。R5 原始 24 项残留分类见下文 DEC 历史说明。

> **2026-10-04 新增登记（契约 `c.mep_layer_below_drop_bottom`）——原始症状（已被 DEC-2026-10-06-R5 修正，留档备查）**：走线表的**分层标高整层低于降板完成面**——强电 2.45m / 弱电 2.50m / 冷媒 2.55m / 冷凝水 2.35m，而 0.30m 降板的完成面是 2.80−0.30=**2.50m**、0.15m 降板与铝扣板是 **2.65m**。当时实算 **160 处**「路线点位低于所经吊顶完成面」，涉及 **69 条路线 / 14 个吊顶分区**。分解链条按契约登记口径（与 `git log -p config/facts.yaml` 的 144→149→154→153→160 一致）：① 2026-10-05 给排水 v1 新增 5 条排水路线，每条在所属厨卫铝扣板吊顶范围内新增 1 处——144→149；② 2026-10-05 DEC-2026-10-05-R11 客餐厅冷凝水改线，`condensate-living`/`condensate-dining` 不再横穿客餐厅平顶，改经走廊吊顶进客卫开放洗漱区并移入候选端点——149→154，合计 +5 全部为分区内 hit；③ 2026-10-05 DEC-2026-10-05-R19 厨房铝扣板范围收回真实南墙 z=2.40（DEC-014 口径），z[2.40,4.30] 餐区改由 `ceiling_dining_north_band` + `ceiling_dining_west_band` 两条石膏板服务带（底 2.50）承担管线通道、餐桌中部恢复 2.80 平顶，`refrigerant-trunk` 原在厨房铝扣板（完成面 2.65）内的线段随之改在西侧服务带（完成面 2.50）空腔内，其 2.55 标高由低于完成面变为高于完成面，该 hit 合法消失——154→153；④ 2026-10-06 DEC-2026-10-06-R1 给排水缺项兜底新增 7 条 floor-branch 给排水路线（燃气热水器进水 / 主卫热水 / 客卫热水 / 回水管 / 洗碗机进水 / 进水总阀 / 主卫沉箱二次排水），每条在所经厨卫/套间吊顶 footprint 内新增 1 处「点位低于吊顶完成面」hit——给排水走地 0.02–0.45m 本就低于完成面，与既有给排水 floor-branch 路线同源、非 #41 分层标高问题，153→160（本轮按 `repair_channel` 附 DEC-2026-10-06-R1 全引 + 4 文件同步记此正当修正）；⑤ **2026-10-06 DEC-2026-10-06-R5 #41 裁定并执行**：160 → 24（承载层 −116、走地给排水口径豁免 −20，见上一段）。契约以 error 级强制：实算数与上表登记的 24 不符即失败（变多=有人乱加路线，变少=有人改数据消音）。

## 1. 走线总则

- **电与空调走顶**：主干藏走廊满吊（z=4.6 轴线）/门厅满吊/客厅北缘边吊，分支进各房间边吊；到点位上方后**沿墙竖直下引**（开关 1.3m、低位插座 0.3m、床头 0.6–0.7m）。空调插座贴边吊下沿，不下引。分层标高按 **A/B 分区口径**（DEC-2026-10-06-R5，见 §3.3.1）：A 区（完成面 2.50）强电 2.55 / 弱电 2.60 / 冷凝水 2.65 / 冷媒 2.60，B 区铝扣板（完成面 2.65）进入段 2.70–2.76；参考梁约束带内 ≤ 梁底−0.05。
- **水走地**：给水垫层内 0.18m，排水贴地 0.02–0.10m；重力管（排水/冷凝水）全程 1% 坡（阳台 2%），禁止上弯。
- **全部正交折线**，穿墙段与墙正交；穿墙点逐条声明在 `docs/design-iterations/mep-routing-20260901/round.yaml` 的 datum 段（v1 留档，penetrations 15 条），每条含墙 id、坐标、标高、门洞避让关系。
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

### 2.5.1 已录入 config/hvac.yaml 的 11 条（lint 自动校验）

| id | 图上标注 | 梁底参考 | 范围（模型坐标） | 影响 |
|---|---|---|---|---|
| ref_south_window_band_ld100 | 南侧窗带 LD:100 | 2.73m | x[1.8,15.2] z[9.65,9.95] | 南侧窗带浅梁压缩客厅/卧室吊顶净空 |
| ref_kitchen_north_ld180 | 厨房北窗带 LD:180 | 2.65m | x[7.7,10.8] z[-0.15,0.25] | 影响冷媒主管转入与冷凝水坡度 |
| ref_kitchen_local_beam_head | LH:270/LW:210 | 2.56m | x[9.0,9.4] z[1.5,2.1] | 厨房局部梁头，阻断北侧服务带横绕；**位置存疑**（2026-10-25：LH:270/LW:210 文字约在 (9.10,3.24)，与本范围差约 1.4m，与 ref_kitchen_dashed_beam_candidate 并存，量房定后删其一） |
| ref_kitchen_dashed_beam_candidate | LH:270/LW:210（虚线梁对） | 2.56m | x[7.37,10.15] z[2.48,2.66] | 厨房虚线梁候选；若为真，北侧服务带横向绕行与厨房吊顶衔接段均须避让 |
| ref_master_bath_local_beam_head | LH:420/LW:400 | 2.41m | x[1.2,1.9] z[3.5,4.1] | 主卫梁头；冷凝水穿点 x=2.0 已贴其东缘避让；**归属存疑**（2026-10-25：LH:420/LW:400 文字约在 (1.44,5.27) 不在本范围，LH:250 文字约在 (1.44,3.90) 正落本范围，与 ref_master_bath_lh250_candidate 并存） |
| ref_master_bath_lh250_candidate | LH:250 | 2.58m | x[1.2,1.9] z[3.10,3.50] | 主卫 LH:250 梁头候选（同一足印的两种底沉读法，非两个独立梁头） |
| ref_master_bath_lh420_candidate | LH:420/LW:400 | 2.41m | x[1.2,1.9] z[4.32,4.72] | 主卫 LH:420 文字所在处候选梁头；若为真，按 2.41m 复核该处贴顶段 |
| ref_corridor_service_band | 走廊浅梁组 | 2.65m | x[6.9,7.5] z[3.6,8.0] | 主干/分支汇集区，偏差影响所有入房转弯；原 5 条中证据最弱（无单条 LH/LW 标签），定线前不得引用作梁底依据 |
| ref_child_guest_bath_north_beam_candidate | LH:400/LW:200 | 2.43m | x[4.4,4.8] z[4.43,4.83] | 儿童房/客卫北侧梁头候选，紧邻儿童房穿点 x=4.35 墙面，量房优先核这条 |
| ref_north_window_band_ld150_candidate | 北侧窗带 LD:150 | 2.68m | x[6.3,6.7] z[0.17,0.57] | 北侧窗带浅梁候选，可能影响主管转入与吊顶净空 |
| ref_north_window_band_ld100_candidate | 北侧窗带 LD:100 | 2.73m | x[3.5,3.9] z[1.28,1.68] | 北侧窗带浅梁候选，可能影响主管转入与吊顶净空 |

> 状态口径（2026-10-06 与 `config/hvac.yaml` 对齐；2026-10-25 梁体修正后 11 条）：**3 条 `inferred`**（`ref_south_window_band_ld100` / `ref_kitchen_north_ld180` / `ref_corridor_service_band`）+ **8 条 `pending`**（原 2 条 `ref_kitchen_local_beam_head` / `ref_master_bath_local_beam_head`，其位置/归属存疑并各有并存候选；新增 6 条候选 `ref_kitchen_dashed_beam_candidate` / `ref_master_bath_lh250_candidate` / `ref_master_bath_lh420_candidate` / `ref_child_guest_bath_north_beam_candidate` / `ref_north_window_band_ld150_candidate` / `ref_north_window_band_ld100_candidate`）。**均未 confirmed**，`beam_collision` 规则因此休眠（见 §6），11 条都只以 `reference_constraint_uncertain` warning 形式常驻提醒；量房逐条实测后按 §6 的墙/约束 confirmed 口径升级。
>
> **z 标定口径（2026-10-25 Framework B，重要）**：邻户图的**竖向尺寸链相对平面主体被压缩约 11–13%**，直接按链读数会把所有 z 系统性读小。本表 z 值一律按平面主体两要素标定——厨房北墙北脸 pdf_y 325.8 ↔ z 0.00、客厅南墙北脸 pdf_y 840.0 ↔ z 9.80（52.469 pt/m，300dpi 下 orig_y = 977.4 + 157.4×z）。**注意：`DEC-2026-10-25-R01`（PR #21）的墙线 z 值仍按旧链式标定落模，系统性偏大 0.6–0.8m，需按同一 Framework B 口径复核回改**（见 §0 待办与 pending-site-data）。

### 2.5.2 图上可见的候选（2026-10-25 梁体修正后，LH:250 / LH:420 / LH:400/LW:200 / LD:150 / LD:100 均已录入 config 为 pending 候选）

- **主卫 LH:250**（竖向虚线，约 x≈1.0 一线）→ 已录入 `ref_master_bath_lh250_candidate`（pending，梁底 2.58m），影响主卫冷凝水/给水贴顶段；也可能是沉箱构造线，待量房拍照判读后定 2.41 还是 2.58；
- **主卫 LH:420/LW:400**（约 (1.44,5.27)）→ 已录入 `ref_master_bath_lh420_candidate`（pending，梁底 2.41m）；量房时核该处是否另有一条 LH:420 梁头；
- **儿童房/客卫北 LH:400/LW:200**（约 x≈4.0 一线）→ 已录入 `ref_child_guest_bath_north_beam_candidate`（pending，梁底 2.43m），紧邻儿童房穿点 x=4.35 所在墙面，**量房时优先核这条**；
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
| 7.4.3-1 | 家居配电箱应设能同时断开相线和中性线且具隔离功能的**电源进线开关**；电源配电回路应设短路和过负荷保护；**电源插座回路均应加设剩余电流动作值 ≤30mA 的保护电器** | topology 20 路中所有含 `type: socket` 的回路 breaker 均带 `+漏保`；进线开关未建模，列入量房开箱确认（pending-site-data #30） |
| 7.4.3-2 | 保护电器单排布置的家居配电箱底边距地 **≥1.80m**；双排布置 **≥1.60m**；安装位置应便于使用维修维护 | 现 `panel_strong_entry_left` `mount_height: 1.65` → 双排箱合规、单排箱不合规；单/双排列为量房必测（#30） |
| 7.4.3-3 | 家居配电箱进出电源线应选用铜导体，**电源进线截面 ≥10mm²** | 待开箱复核（#30） |
| 7.4.4 | 住宅**照明回路、空调电源插座回路、电热水器等 2kW 及以上用电设备回路、厨房内的电源插座回路、其他功能用房的电源插座回路应分别设置**（类型级要求，不要求每房每灯独立） | 25 路合并至 20 路（DEC-2026-10-05-R3 浴霸按设备锚点拆每卫一路 → 21 路；DEC-2026-10-13-R5 删电视墙灯带整条照明回路 → 20 路）：照明 4、空调内机 2、空调外机 1（2kW 以上设备单独成路）、专用 6（冰箱/洗碗机/洗衣机/烘干机/主卫浴霸/客卫浴霸）、普通 7 |
| 7.4.5 | 住宅电源插座均应采用**安全型插座**；**卫生间设置的电源插座尚应加设防溅措施**；每套住宅插座设置要求和数量应符合表 7.4.5；布置洗衣机、冰箱、排油烟机、排风机、电/燃气热水器、空调器处尚应加设 1 个专用单相三孔插座 | 专用三孔位已全覆盖（洗衣机/冰箱/烟机/两卫浴霸（换气模块承担排风，DEC-2026-10-05-R3）/燃气热水器/空调内机）；两卫共 8 个 socket，其中 6 个已在 note 声明防溅盒，`sock_mbath_batcheheater` / `sock_gbath_batheheater` 两个浴霸插座未声明，由新 lint 规则 `bath_socket_splash_box_undeclared`（`verify:electrical`）常驻盯住，水电交底前须补齐（GB 55038-2025 7.4.5，见台账 `docs/design-iterations/mep-lint-governance-20261006/review-manifest.json`） |
| 7.4.7 | 进出住宅建筑的金属管道应与接地装置做保护等电位联结；**装有固定浴盆或淋浴器的卫生间应设等电位联结作为附加防护** | 全屋尚无 LEB 点位：`shared/types.ts` 的 `PlumbingPointType` 已有 `leb` 枚举（2026-10-04 A6 补），`shared/project-render-facts-schema.ts` 已同源补齐，schema 不再挡路；契约 `c.leb_point_requires_bond_schedule` 在等端子箱位置与需联结金属构件清单，跟踪 `docs/pending-site-data.md #43`（位置未知前不得造点位，防水/贴砖前必须预埋），已进验收清单 `check_elec_leb` 与量房项 |

燃气探测器位置依据 **CJJ/T 146-2011《城镇燃气报警控制系统技术规程》**：探测器距灶具及排风口的水平距离均应 **>0.5m**；使用天然气等相对密度小于 1 的燃气时，探测器应设置在**顶棚或距顶棚 <0.3m 的墙上**（液化石油气相反，距地面 ≤0.3m）；且不应装在灶具正上方。本项目 `sock_kitchen_gas` 已按此定在 (10.80,0.20) h=2.35（DEC-2026-10-04-R2 按机体最近缘重算后北移；距油烟机北缘 0.53m、距灶具北缘 0.61m，依据 config/electrical.yaml sock_kitchen_gas note 与 docs/decisions/06-electrical.md DEC-2026-10-04-R2），最终位置随燃气公司报警器 + 切断阀方案终核。

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

**梁硬约束（与 §2.5.1 的 11 条参考梁对应，上限 = 参考梁底 −0.05m）**：

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
| 同层排水沉箱二次排水 | **主卫**：沉箱最低处设 **DN50 二次排水**，向二次口找 1% 坡 + 轻质回填；回填前通球与沉箱 24h 蓄水**分开验收**（见 pending-site-data #50、acceptance 主卫沉箱两条）。**客卫**：业主 2026-10-23 确认有沉箱、开发商未设二次排水、须自做——与主卫同口径：沉箱最低处设 **DN50 二次排水**，向二次口找 1% 坡 + 轻质回填；回填前通球与沉箱 24h 蓄水**分开验收**（见 pending-site-data #74、acceptance 客卫沉箱两条、DEC-2026-10-23-R03）；下沉深度/沉箱底防水现状/最低点口位待量房 |

> **管径登记口径**：排污 de110 / 干管 de75 / 支管 de50 为施工分级口径；`config/plumbing.yaml` 排水立管的 `diameter: 0.075` 与其马桶排污/立管 note 已按本口径补 `de110` 注记（**只加 note 文本、不改 diameter 数值**——0.075m 是既有登记值，全宅 de110 批量升级属设计决策，留待 docs/pending-site-data.md #41 轮裁定）。

**水电主材施工基线（DEC-2026-10-07-M01）**：以下是规格和安装边界，不是商品报价；采购品牌与当前成本目标见 `schedule/procurement.md` §02，点位/回路/数量以现行 `config/` 与算量为准。

| 系统 | 施工规格与控制点 |
|---|---|
| 给水 | PPR 热水管同用于冷热主管：主干 25×3.5mm S3.2，普通末端 20×2.8mm S3.2；双卫、花洒等高流量支路按拓扑保留 25mm。管件与管材同品牌同系列，不混牌；总阀/重要分区阀用全通径铜球阀。 |
| 前置过滤器 | 本期只预留 DN20/25 接口、排污与旁通三通及检修空间，设备本体另列；安装顺序按 `config/acceptance.yaml`：总阀 → 减压阀（0.25MPa）→ 前置过滤器位。 |
| 导线 | 回路线径按 §3.1 和当前负载配置；插座回路 L/N/PE 同规格，黄绿 PE 线不缩水；洗衣机与烘干机分专线，微蒸烤和 HVAC 线径必须按设备铭牌/厂家要求复核，不能直接套旧基线。 |
| 线管与弱电 | 强电、弱电分管；剪力墙执行 §4.2 的 φ16 单回路与 40mm 薄盒上限。弱电 CAT6 需纯铜、23AWG 级并独立穿管；PoE 点各自回弱电箱，光纤与箱体规格待量房闭合。 |
| 接头与排水配件 | 导线不得在线管内接头；接线端子必须留在可检修盒内，封管前确认可抽换。PVC-U 排水管件与管材同品牌同系列，优先用 45°组合满足坡度，禁止为省件破坏重力流。 |

上述项目规格中有待现场或铭牌反转的部分，按 `docs/pending-site-data.md` 与采购 §02 的条件闭合后再放行施工；未确认项不能因为写入基线而视为已测量或可施工。

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

**Severity 口径（2026-10-17）**：`must_fix_before_briefing` 是硬门禁，不只是报表分桶；这类 finding 统一进入 `errors`，不因 route 仍是 inferred/pending 降级。只有明确归入 `survey_dependent` 或 `envelope_approximation` 的项保持 warning；数据近似一旦补齐并证明实体冲突，按对应硬规则报 error。`verify:mep` 在硬门禁未清时返回非零。

- `shear_wall_penetration`：路线穿越 `structure: shear` 的墙 → warning；墙与路线双双 confirmed 时升 error（剪力墙开孔须实测结构数据 + 套管 + 避钢筋区）。墙类型标注在 `config/layout/model-geometry.yaml` 的 wall 条目上（`structure` / `structure_status`），当前全部 inferred，交房量房确认后转 confirmed。
- `beam_collision`：`reference_constraints` 中 `status: confirmed` 且带 `reference_beam_bottom_y` 的梁位，物理路线在约束带内高于梁底 → error。当前 §2.5.1 的 11 条约束为 **3 条 inferred + 8 条 pending**，无一 confirmed，`beam_collision` 规则休眠；量房实测转 confirmed 后自动激活。
- `penetration_missing` / `penetration_point_mismatch`：逐墙核对——穿越的每面实体墙都要在 `penetration` 数组里有对应墙 id 的声明；缺声明或穿点与实际几何交点偏差 >0.25m 均为 must_fix error。
- `ceiling_clearance_unverified`：管线外包络（管径与已声明保温）穿出所经实心吊顶（`drop` / `aluminum_buckle` / `integrated`）完成面 → warning。与 §0 的契约登记数同源不同级：契约 `c.mep_layer_below_drop_bottom` 用 error 锁「登记数 = 实算数」，本规则用 warning 逐条点名是哪条 route / 哪个分区。**DEC-2026-10-06-R5 明文授权的比较范围**：只含吊顶承载层（strong_power / weak_power / refrigerant / condensate / supply_air / return_air）；走地给排水（water_supply / drainage）与吊顶面无可比性，退出比较。DEC-2026-10-17-R4 又排除承载层中方法为 `floor_branch` / `floor_branch_candidate` 且至少一个 route point 落入 `y≤0.35m` 地面支持带的走地候选；缺少地面点的高位误标继续参与比较，并由 `floor_branch_missing_floor_band` 提醒。其开放起降仍由 3D `unsupported_span` 检查依托。facts lint 与 MEP lint 共享渲染用 rounded footprint、管线外包络（直径+已声明保温）及50mm中心线采样；R25两引擎当前均为 **62 条 route-zone warnings / 50 条路线 / 15 个吊顶分区**；历史变化链（R22-v0.5-3 纯重力迭代 −3：condensate 走廊段抬入腔；上一态 52/44 为 DEC-2026-10-17-R20 口径）strong-power-kitchen / strong-ded-dishwasher 尾段改 (10.8,2.35) 竖井落地，ceiling_kitchen hit 合法消失，登记数已同步；上一态 54/44/15 为 DEC-2026-10-17-R20 走线专项后口径）。相较原 facts 52 处，R4 退出 floor-branch 完成面误报，并把先前只在两 route points 之间穿过 `curtain_box_master_south` 的 `strong-power-master` 段纳入；旧的双引擎差异现已消除。历史 24 处残留类型见 §0 与 DEC-2026-10-06-R5 原裁定。
- `reference_constraint_uncertain`：非 confirmed 的 `reference_constraints` 只提醒、不当硬碰撞；量房转 confirmed 后由 `beam_collision` 接手。
- `supply_return_overlap`：送/回风包络相邻重叠。风路线没有 `height`，`depth` 只是竖向代理，`shared/mep-hvac-lint.ts` 的 `airRouteBox` 注释明确它 "can produce a warning, but never supports a confirmed error"——本代码结构上不可能升 error。
- `suppressed_wall_crossing`：路线穿越或贴触 `config/layout/overlay.yaml` suppress 的玻璃幕墙/窗帘墙，均为 must_fix error，不因路线状态未 confirmed 降级；“到墙面结束”及沿墙敷设也纳入触碰检测。
- `nonphysical_route`：起终点重合（`design_requirement` 口径另走 `degenerate_requirement`）→ warning；confirmed 升 error。
- `route_overlap` / `route_clearance_unverified`：逐段做 3D 净距检查。圆管按管径，矩形风管按 x/y/z 轴向尺寸；缺风管高度或线段非正交时，不把代理包络直接定成实体碰撞，而转成 envelope 桶的净距待核。实体包络相交属于 must_fix，直接 error；候选路线或近似净距仍是 warning。只对同一明确端点附近 0.20m 接头段豁免；同层电气/冷媒/风管可共用走廊，重力给排水仍互相检查。当前 113 条 `route_overlap` 中 70 条为 error、43 条为近似包络 warning，另有 32 条 `route_clearance_unverified`（DEC-2026-10-18-R21 验收实测）。
- `route_furniture_collision` / `endpoint_inaccessible`：用 SceneBuilder runtime 家具包络扫描固定柜体与主要家电；路线在包络内累计超过 0.25m、或电气端点落在高柜/家电内部时，物理路线属于 must_fix，报 error。地面暗敷给排水水平段、接到相邻设备点的末端服务段按工艺豁免；声明挂载到家具端板的点位不报被家具包住。需求路线归 envelope 桶，仍是 warning。柜内服务路线须补明检修口、开放格或穿柜做法。
- `route_endpoint_unusable` / `mep_endpoint_service_conflict` / `endpoint_elevation_mismatch`：已标记 blocked/superseded 的电气端点、强弱电与给排水同柱同高冲突、或开关端点标高不符都属于 must_fix error。
- `floor_band_method_mismatch` / `gravity_method_elevation_mismatch` / `gravity_slope_pending`：未声明 floor_branch 却在地面支持带长距离走线、gravity_floor_drain 实际位于高位、或有水平投影的重力线缺坡度/流向契约，都属于 must_fix error。
- `door_opening_collision`：路线沿门洞范围低于门头连续通过至少 0.15m 属于 must_fix error；与过门头穿梁的 `penetration_door_clearance` 分开判断。
- `penetration_declaration_orphaned` / `penetration_declaration_incomplete` / `penetration_wall_unknown`：检查声明墙是否存在、声明点是否仍靠近当前路线与墙、是否同时给出穿点和高度。穿点在路由起止点或折点附近时按近邻容差识别，避免把端点穿墙误判成孤立声明。
- `gravity_slope_geometry_mismatch`：重力管声明 1%（阳台 2%）坡度，但折线段实际高差推不出该坡度（容差 ±50%）→ must_fix error。DEC-2026-10-06-R1 已把当轮 14 条清零；现场仍须按 §1「重力管全程 1% 坡、禁止上弯」敷设。
- `gravity_slope_below_design_target`：逐段（短段链）实际坡度低于声明最低坡度（仅 1mm 几何容差、无施工容差）→ must_fix error。DEC-2026-10-19-R25 随冷凝水显式汇流拓扑上线，首报 11 条；DEC-2026-10-22-R01 补短段链门槛（<0.3m 短段按链判、近竖直下行段不供落差）并把 4 条路线按声明坡度建真几何后清零。
- `route_insulation_unverified`：冷凝水/冷媒路线未声明保温厚度、或保温状态未确认 → survey_dependent warning（DEC-2026-10-19-R25 上线，DEC-2026-10-22-R01 补登治理台账）；选型与量房确认后逐条消解。
- `route_not_orthogonal`：物理路线折线不满足曼哈顿正交 → error；需求/近似包络归 envelope warning。DEC-2026-10-06-R1 已把 3 条给水路线正交化；当时 0 命中是历史基线。当前实报 37 条（33 errors + 4 requirement/envelope，DEC-2026-10-18-R21 验收实测）：全部专业检查平面斜段，强弱电/给水/冷媒/送回风还检查把平面位移与升降合成一段的 3D 斜线；重力排水/冷凝水坡度由 `gravity_slope_geometry_mismatch` 检查。F02 短设备接线段例外保留。§1「全部正交折线」是硬约束。
- `penetration_door_clearance`（**本轮新增**）：声明穿点距同墙门洞 <0.15m。穿点高于门头、需复核梁底与套管的 16 条属于 survey warning；落在门洞高度带内、会打到门垛/门套的 2 条属于 must_fix error。
- `shear_wall_parallel_route`（**本轮新增**）：长距离贴剪力墙敷设属于 must_fix error；须明确套管/剔槽/避钢筋策略，或移出剪力墙净距。
- `endpoint_not_bound_to_point`（**DEC-2026-10-08-W02 新增**，must_fix error）：非 requirement/candidate 路线的 `from`/`to` 写成内联坐标、且与**同专业点位**平面重合 ≤0.02m（坐标两位小数的舍入量级再留一倍余量；>0.02m 视为有意的工艺差，如 `faucet_garden` 出水口 10.85 vs 底盒 10.80 的 0.05m，不报）。**这条规则存在的理由**：量房的标准动作是改点位坐标，内联端点不会跟随，而 `endpoint_unknown` / `endpoint_unresolved` 只能查 id 能不能解析、查不出"这个字面量本来是抄某个点位的"。同距多点位时消息里列出候选，要求按 route reason 裁定绑哪一个。requirement/candidate 路线豁免（`validateMepCoordination` 禁止 design_requirement 路线引用给排水点位 id，报了也改不掉）；只查 from/to 不查 via（via 是几何弯点不是设备位）。当前实算 0（DEC-2026-10-08-W02 已把 5 处全部焊死），是哨兵而非待办。
- `inline_endpoint_without_point_anchor`（**DEC-2026-10-08-W02 新增**，warning，survey 桶）：给排水层的内联端点 0.02m 内没有任何同专业点位 → 进"量房判读清单"，不强行绑。当前 6 条：`drain-kitchen-requirement` to(6.95,0.5)（推断立管接入方向）、`water-water-heater-recirc-requirement` to(0.4,2.6)（回水阀预留）、`water-kitchen-dishwasher-branch` to(8.8,0.3)（洗碗机锚点）、`drain-mbath-secondary-requirement` to(1.4,1.15)（#50 二次排水口方向）、`drain-gbath-secondary-requirement` from(6.60,3.05)/to(6.60,2.45)（#74 客卫二次排水示意段两端，DEC-2026-10-23-R03）。原第 5 条 `water-hot-water-gbath-requirement` to(6.7,2.7)（穿墙点）已由 DEC-2026-10-08-W03 改绑 `faucet_gbath_vanity` 并补 `w_gbath_south` 穿墙声明，该条归零。强电/弱电不报"无锚点"——它们的内联端点多数是吊顶缘汇流点（DEC-2026-10-07-M04 地插 from 口径），报了是纯噪音。

**历史基线快照（2026-10-07 / 2026-10-17 R4；数字由 `tests/server/mep-guidance-baseline.test.ts` 动态对账，不写死）**：

- `npm run verify:mep` = **0 error / 与实算一致的 warning 数**（`shared/mep-hvac-lint.ts` 只输出三桶，未登记 code 一律落 must_fix 桶）；
- `npm run verify:electrical` = **0 error / 与实算一致的 warning 数**。
| 桶 / 规则组 | 条数 | 代码明细 |
|---|---:|---|
| MEP must_fix_before_briefing（交底前必须清，R19 硬门禁起整体计 error、由验收断言单独锁定 132） | 132 | route_overlap 67 + route_not_orthogonal 30 + route_furniture_collision 11 + unsupported_span 7 + suppressed_wall_crossing 7 + endpoint_inaccessible 5 + door_opening_collision 1 + mep_endpoint_service_conflict 2 + route_endpoint_unusable 1 + floor_band_method_mismatch 1（DEC-2026-10-25-R01 对账增量：厨房东南角墙线改判后 route_overlap −2（东南房束随墙面带重画、旧 13.40 墙共线束解散）、route_not_orthogonal −2（花园线与弱电书房线正交化）、floor_band_method_mismatch +1（strong-light-entry-night-guest-door 墙面带走线 1.29m 落 0.30m 带、方法仍 conduit，属该规则对墙面带走线的启发式误标、非地面路径，计入 must_fix 显形不消音），合计由 135 降至 132；同日 R01 本体重算 composition 变化（总数不变）：route_overlap +1（guest-north 贴墙走线新增共线段）、route_furniture_collision −1（guest-north 避开 wardrobe_180）；DEC-2026-10-23-R04 对账增量：几何改判后 route_overlap 与 suppressed_wall_crossing 各减一、bay_sill_collision 清零，合计由 138 降至 135；此前 DEC-2026-10-22-R01 对账实测 138：bf29283 逐段坡度规则带入的 11 条 gravity_slope_below_design_target 已由短段链门槛与 4 条路线几何建真坡度清零，route_overlap 实修 −1；上一态 R25 口径 149、R22-v0.5 口径 139）|
| MEP survey_dependent（量房后自然消/复判） | 153 | ceiling_clearance_unverified 101 + penetration_door_clearance 16 + shear_wall_parallel_route 12 + shear_wall_penetration 11 + route_insulation_unverified 7 + inline_endpoint_without_point_anchor 6（DEC-2026-10-25-R01 对账：剪力墙穿孔数 10→11（strong-light-entry-base 花园段正交穿新中竖墙北段 w_cent_north 的声明穿孔，剪力墙 inferred、量房复核套管）；ceiling_clearance_unverified 仍 101（strong-light-entry-night-guest-door 虽改墙面带走线、但其段仍在 ceiling_study_ac / ceiling_living footprint 内且低于完成面、方法未走 floor_branch 口径，故该 hit 未消失；weakbox×dining_north_band 新增 1 处与 guest-north 出 study_ac footprint 减少 1 处相抵，净零）；shear_wall_parallel_route 增加 1 条（guest-north 贴北墙面走线 1.10m 超 1.00m 阈值，见 R01 对账增量段）；DEC-2026-10-23-R04 对账：ceiling_clearance_unverified 由 62 增至 101，新增 39 条全为 bend_corridor 角点单点触碰登记，见 §0；DEC-2026-10-23-R03 对账：客卫二次排水示意段两端点 +2，4→6；DEC-2026-10-22-R01 对账实测：ceiling_clearance_unverified 为 R25 外包络复核口径，与 verify:facts 契约登记双引擎一致，见 §0；route_insulation_unverified 为 R25 同批新检查、保温厚度/状态未确认，登记治理台账 pending_adjudication 待厂家选型与量房；上一态 R21 口径 91）|
| MEP envelope_approximation（模型包络近似/非物理需求） | 134 | route_clearance_unverified 40 + route_overlap 39 + bay_sill_crossing_declared 13 + route_overlap_declared_trunk 14 + nonphysical_route 8 + reference_constraint_uncertain 11 + route_not_orthogonal 4 + route_furniture_collision 2 + unsupported_span 2 + supply_return_overlap 1（2026-10-25 梁体修正对账：参考梁约束 5 条增至 11 条，reference_constraint_uncertain +6，本桶 128→134；DEC-2026-10-22-R01 对账实测，按 R25 外包络复核口径逐 code 对齐；上一态 R22-v0.5 快照 123；DEC-2026-10-23-R03 复核：客卫二次排水独立接立管、刻意不声明 shared_trunk，本桶不变）|
> R20历史快照：must_fix桶（166）已按 R19 硬门禁整体升为 errors、不在本表；本表仅承载两个 warning 桶。当前实跑分桶见上方 R25 快照。
>
> **DEC-2026-10-17-R20 走线专项增量**：为 R20 批次 7 个新点位落地 7 条路线（strong-ded-fridge-living / strong-power-waterbar / strong-power-kitchen-east / strong-power-weakbox / weak-ap-master / strong-light-balcony / strong-light-entry-night-mid，128→135），**must_fix 桶 166 逐 code 零增量**；增量全部落在允许的 survey/envelope 桶（survey +5、envelope +3，逐 code 见两行明细内注）——新路线自身不带任何交底前必清项，穿墙/共孔/贴干线均以声明通道表达。
| 电气 参数/覆盖依赖待定 | 55 | circuit_member_dangling_or_superseded 1 + curtain_power_near_curtain_wall 1 + dedicated_parameters_pending 9 + point_uncovered 29 + pending_parameter 15（DEC-2026-10-23-R04 新增 curtain_power_near_curtain_wall 一条：sock_study_curtain 距改判后东南玻璃线 2.08m 超 2.00m 阈值，随东南房床尾区重新预演复核；DEC-2026-10-17-R20 验收实测：+sock_weakbox 纳入回路后 point_uncovered 含 net_master_ap 等弱电点位；dangling 检查上线，唯一命中为 sock_balcony_washer blocked 的 warning 口径；2026-10-12 R1 删两盏壁灯、R2 删两卫墙控后，未覆盖开关点减少、总数由 53 降为 51；本格不得再写「code + 历史数字」，解析器会把重复 code 相加） |

**R25当前实跑结果**：verify:mep 扫描137/137条路线，149 errors / 238 warnings；基线514c715为139/214。分桶 must_fix_before_briefing 139→149，survey_dependent 91→110，envelope_approximation 123→128。新增11条逐段低于1%的硬finding属于既有 drain / 主卧与儿童房冷凝水路线；新增7条保温厚度未确认warning；完成面外包络基数由R22历史49升至62。客餐厅现行两支管与当前风管/强电无硬overlap，R24客厅×餐厅回风/送风、餐厅×弱电AP三组提示消失；Y节点3组局部接头交叠仍以 route_overlap_declared_trunk warning 显形。另有6组其他房间冷凝水×送回风外包络交叠新显形，留在原route findings，不在本轮范围清零。

当前 error 仍为 verify:mep 阻断项（R25 时点 149 个；DEC-2026-10-22-R01 对账后 138 个，见下段）；本轮保留其他路线硬冲突，不以改基线或计数钉子制造通过。R20的166-error与“30条风管净距”均为历史快照；warning按当前类别继续显形。
R20历史快照：166 个 error 属于当时 verify:mep 阻断项；本轮基线与当前值见 R25 快照。未确认风管/梁位 warning 不会仅因路线状态变成 confirmed 就自动升级。

**DEC-2026-10-22-R01 对账结果（当前口径，取代 R25 快照）**：verify:mep 扫描 137/137 条路线，138 errors / 238 warnings；分桶 must_fix_before_briefing 138、survey_dependent 110、envelope_approximation 128。R25 记录的 11 条 gravity_slope_below_design_target 已清零（短段链门槛消除短段噪音 + condensate-child / condensate-master / 两条台盆墙排按声明 1% 建真坡度）；route_overlap error 侧实修 −1（70→69）一并销账；route_insulation_unverified 7 条已登记治理台账 pending_adjudication。上方 149/139 等数字均为历史快照。

**DEC-2026-10-23-R03 对账增量（当前口径）**：verify:mep 扫描 138/138 条路线，138 errors / 240 warnings；分桶 must_fix_before_briefing 138（不变，钉死值不动）、survey_dependent 112（+2：drain-gbath-secondary-requirement 示意段两端点，量房判读清单）、envelope_approximation 128（不变：二次排水独立接立管、不与淋浴→地漏串联支路作共干管声明，PR #17 评审 P1）。errors 零新增；§6 表与治理台账已同步。

**DEC-2026-10-23-R04 对账增量（当前口径）**：verify:mep 扫描 138/138 条路线，135 errors / 279 warnings；分桶 must_fix_before_briefing 138→135（东南房玻璃线 9.88 与客卫东墙 7.20 改判的几何副产物：route_overlap 与 suppressed_wall_crossing 各减一、bay_sill_collision 清零，其余 code 与 R03 态逐项一致；改判过程中一度引入的 2 条 route_not_orthogonal（客卫电源末段斜落、走廊开关线斜折）已按正交折线当场修复、不进登记）、survey_dependent 112→151（ceiling_clearance_unverified 62→101：客卫吊顶东界东移后 SE 角点与走廊枢纽 bend_corridor 重合，39 条经枢纽路线起点单点触碰登记，逐条 diff 核实无实体穿越，见 §0 与 facts 契约 engine_note）、envelope_approximation 128（不变）。电气侧新增 curtain_power_near_curtain_wall 一条（sock_study_curtain 距改判后东南玻璃线 2.08m、超 2.00m 阈值，随东南房床尾区重新预演一并复核，已登记治理台账）。§6 表钉死值已同步，验收断言（mep-guidance-baseline / mep-hvac-lint 两处 errors 钉）已同步。

**DEC-2026-10-25-R01 对账增量（当前口径）**：verify:mep 扫描 138/138 条路线，132 errors / 281 warnings；分桶 must_fix_before_briefing 132（不变：交付态 132 的分项逐 code 复核无增减，见 §6 must_fix 行）、survey_dependent 152→153（shear_wall_parallel_route +1，guest-north 贴北墙面走线 1.10m 超 1.00m 阈值；shear_wall_penetration 11 不变，w_cent_north 声明穿孔仍在；ceiling_clearance_unverified 101 不变——weakbox×dining_north_band 新增 1 处与 guest-north 出 study_ac footprint 减少 1 处相抵，净零，见 §6 survey 行）、envelope_approximation 128（不变）。电气侧仍 0 error。§6 表钉死值已同步，验收断言（mep-guidance-baseline / mep-hvac-lint 两处 errors 钉 132）已同步。

**仍未建模的检查边界**：MEP lint 现在检查门洞本身和静态柜体/家电实体，但 config 尚无门扇开启扫掠区、冰箱/洗碗机/洗烘开门区与检修抽拉区的权威几何，因此不能判定运行时活动包络是否挡线。飘窗规则也按路线中心线判定实体相交，未按管径计算贴边净距。要把这两类也纳入判定，需要先在权威配置声明扫掠/净距几何，代码不得自行猜开门角度或边界。

> 上表六组是**历史分类台账快照**，不是「已接受项」清单。逐条的 accept / reject / pending_adjudication 裁决、依据 DEC、责任人与解除条件，见治理台账 `docs/design-iterations/mep-lint-governance-20261006/review-manifest.json`（本轮新建）。旧的 `docs/design-iterations/mep-routing-20260901/round.yaml 的 review 段` 只留 v1/v2/v3 三轮评审结论，其中「15 条已接受项 / 22 warning」是 2026-09-07 的快照，**不再是现行基线**。
