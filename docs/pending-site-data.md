# 量房待填清单

> 量表共 52 条（2026-10-05 给排水 v1 落地：#6/#7/#9/#10/#16/#17/#18/#19 改为「已入模型（inferred）」并新增 #48 入户花园去留**设计待决**；2026-10-06 DEC-2026-10-06-R1 给排水缺项兜底新增 #49 进水总阀/减压/前位、#50 主卫沉箱二次排水口位、#51 阳台排水立管位、#52 RO 浓水排放接点，与 `fact.pending_site_data_count` 对账：新增/关闭条目必须同步此数）。
>
> **计数口径（自证防线）**：本表是 **52 个编号（#1–#52）+ #3a 一条子项 = 53 行表格记录**。`fact.pending_site_data_count` 的权威值是「编号数 52」（即文件开头那一处，由 `expect_matches: 1` 单列锁定），与表格物理行数 53 不相等是设计使然——#3a 是 #3「室内净高」的 A2 HVAC 邻户梁参考约束子项，不另占编号。二者不是漏数也不是多写；新增/关闭条目必须同步的是**编号数**，不是行数（`tests/server/mep-guidance-baseline.test.ts` 按此口径断言，防止把「52 = 53」当漂移、也防止拿自证式计数蒙混）。

> 交房后现场量房，逐项填入。每项标注精度等级：
> - `inferred`：从图纸/规范推断（当前值）
> - `estimated`：从视频/同户型估算
> - `measured`：现场量房确认（最终态）

## 结构

| # | 数据项 | 填入文件 | 格式 | 当前值 | 精度 | 影响 |
|---|--------|----------|------|--------|------|------|
| 1 | 梁体位置/宽度/高度 | model-geometry.yaml `beams:` | `{id, x1,z1, x2,z2, width, depth}` | 推断见下，邻户实测参考见表下注 | inferred | 吊顶/HVAC/灯具 |
| 2 | 承重墙标记 | model-geometry.yaml walls `load_bearing: true` | boolean | 外墙+电梯井墙 | inferred | 拆改红线 |
| 3 | 室内净高 | model-geometry.yaml height | 2.8 | 2.8m（邻户结构板 +2830 佐证） | inferred | 吊顶/柜体 |
| 3a | A2 HVAC 邻户梁参考约束 | config/hvac.yaml `reference_constraints` | 各范围/梁底/底沉 | 南窗带 LD100、北厨房 LD180、厨房/主卫局部梁头、走廊服务带 | inferred/pending，±150mm | 仅作 HVAC 协调提示，非施工 |

### 梁体推断（待确认）

| 位置 | 跨度方向 | 推断梁高 | 推断梁宽 | 依据 |
|------|----------|----------|----------|------|
| z=5.55 线 x[0,7.2] | 东西向 | 350-400mm | 250mm | 板跨 4.25m 支座 |
| z=4.30 线 x[0,13.4] | 东西向 | 400-500mm | 300mm | 客厅 6.2m 跨北支座 |
| x=7.20 线 z[0,9.8] | 南北向 | 400-500mm | 300mm | 结构分界线 |
| x=13.40 线 z[0,9.8] | 南北向 | 350-400mm | 250mm | 结构分界线 |

### 邻户实测参考（survey/neighbor_ys01_original_structure_2025-06.png，点石 2025-06 原始结构图渲染件，同户型）

> 比例标定后映射到本坐标系，精度 ±150mm，仅作参考；自家以现场量房终核。
> 读法修正（2026-08-21，业主样板间视频佐证）：贴外墙虚线为**上飘窗台俯视投影**（高于剖切面故画虚线），
> LH=窗高、LW=窗宽；sill ≈ 2830−LH。自洽验证：2070+760=2830 正好顶到结构板；
> 旧全屋 sill 2.55 系客厅值误推广（2.55+0.45=3.0 穿楼板，无效）。**宽扁梁读法作废**——
> 梁仅为 LD:100–180 组 = 浅梁（底沉 100–180，梁底≈2.65–2.73）。

| 位置（本坐标系约值） | 邻户标注 | 解读 |
|------|------|------|
| 南幕墙线 z≈9.8（主卧/父母房段 x≈1.8–5.4） | LH:760 / LW:1380 ×2，LD:100 | 上飘窗 sill≈2.07、窗高0.76、窗宽1.38×2；梁底沉100 |
| 南幕墙线 z≈9.8（书房段 x≈14.9） | LH:750 / LW:1110，LD:100 | sill≈2.08、窗高0.75 |
| 南幕墙线 z≈9.8（客厅段 x≈9.5） | LH:260，LD:100 | 上光带 sill≈2.57、窗高0.26（与旧假设吻合，仅客厅成立） |
| 北幕墙线 z≈0（厨房/入户段 x≈9.2） | LH:710，LD:180 | sill≈2.12、窗高0.71；梁底沉180 |
| 左翼凹进线 z≈1.10（x≈3.8） | LH:750 / LW:1160 | sill≈2.08 |
| 主卧西墙 x≈0（z≈7.4 段） | LW:970 | 窗宽 0.97 |
| 厨房内（x≈9.2, z≈1.8） | LH:270 / LW:210 | 小梁头/局部投影，非窗尺寸 |
| 主卫内（x≈1.5, z≈3.8） | LH:420 / LW:400 | 小梁头/局部投影，非窗尺寸 |
| 全屋结构板面 | +2830 | 结构净高 ≈2.83m，与 house.yaml 2.8 估算吻合 |
| 下沉板 | 两卫 300/330，厨房/阳台/入户 50 | 同层排水沉箱确认；防水/排水设计按此 |
| 总尺寸 | 16650（北）/16725（南）× 10030（西）/11180（东，含南飘） | 本模型 16400×9800 内净 + 幕墙/飘窗差，量级吻合 |
| 主卧/父母房隔墙（x=4.2） | 图中为实墙，无内窗 | 佐证 w_mb_win 疑为 CAD 残留（#25 仍须自家核实） |

### A2 HVAC 参考约束量房回填

`config/hvac.yaml` 的 A2 `reference_constraints` 是邻户图的比例映射，统一为 ±150mm、`inferred`/`pending` 与 `not_for_construction`。量房时逐项拍照并测量自家南窗带、北厨房、厨房/主卫局部梁头和走廊服务带的范围、梁底、净高及可用绕行空间，同时确认冷凝水立管接点；不得假定现有地漏可接。

回填必须基于自家实测事实并由后续深化流程单独审阅。邻户资料本身不得改标 `measured` 或 `confirmed`，不得作为开孔、穿梁、套管或施工许可依据；在确认前 HVAC 路由继续绕梁优先。

## MEP 基础设施

| # | 数据项 | 填入文件 | 格式 | 当前值 | 精度 | 影响 |
|---|--------|----------|------|--------|------|------|
| 4 | 强电箱位置/容量 | electrical.yaml `type: strong_panel` | `{x, z, mount_height, body_height, width, depth, circuits, capacity}` | living_dining / `w_foyer_east` 西侧，`x=13.40, z=3.60`；开发商预留嵌墙；底部离地 1.65m；本体高度暂占位 0.39m；390×210mm（宽×深，箱体全尺寸口径见 #30 的 390×390×210mm，单/双排待复测） | 位置 inferred；嵌墙属性/箱体规格/本体高度 pending | 回路规划；开发商预留嵌墙和本体高度待复测，回路数/容量仍待开箱量尺 |
| 5 | 弱电箱位置 | electrical.yaml `type: weak_panel` | `{x, z, mount_height, body_height, width, depth}` | living_dining / `w_foyer_east` 西侧，`x=13.40, z=3.60`；开发商预留嵌墙；底部离地 0.50m；本体高度暂占位 0.40m；400×300mm | 位置 inferred；嵌墙属性/箱体规格/本体高度 pending | 网关/路由；开发商预留嵌墙和本体高度待复测，箱体高度和入户线路待开箱确认 |
| 6 | 卫生间排水立管 | plumbing.yaml `type: drain_riser` | `{x, z, diameter}` | **v1 已入模型（`inferred`，±0.3m）**：主卫 `drain_riser_master_bath` (0.3,1.3) / 客卫 `drain_riser_guest_bath` (5.8,2.4)，管径 0.075；量房日升级 `measured` | inferred → 量房日升级 measured | 马桶/地漏定位 |
| 7 | 厨房排水立管 | plumbing.yaml `type: drain_riser` | `{x, z, diameter}` | **v1 已入模型（`inferred`，±0.3m）**：`drain_riser_kitchen` (10.5,0.3)，管径 0.075；量房日升级 `measured` | inferred → 量房日升级 measured | 水槽定位 |
| 8 | 给水入户点 | plumbing.yaml `type: water_supply` | `{x, z, diameter}` | 待确认（**仍未建点位**：坐标未知，schema 要求 x/z，位置未知时不许造点位——同 #43 LEB 先例） | — | 水管走向；**5 处给水（shower_mbath/shower_gbath/faucet_kitchen_sink/faucet_kitchen_purifier/faucet_garden）的路线以本项为前提**。**量房日第一项，必须闭环**（拍全屋给水立管/水表/分水器 → 定 x/z/管径 → 回写 config/plumbing.yaml 并画 water_entry），否则 5 处给水继续无主、#44 的 7 处无主点位也无法收敛 |
| 9 | 燃气表位置 | plumbing.yaml `type: gas_meter` | `{x, z, height}` | **v1 已入模型（`inferred`，±0.2m）**：`gas_meter_kitchen` (8.0,0.2) h=1.5（燃气路由本身不做，仅锚点）；量房日升级 `measured` | inferred → 量房日升级 measured | 热水器/灶具 |
| 10 | 排烟道位置 | plumbing.yaml `type: duct`（业主 2026-10-05 批准并入，不新建 ductwork.yaml） | `{x, z, diameter}` | **v1 已入模型（`inferred`，±0.2m）**：`duct_kitchen_exhaust` (9.0,0.1)，断面 0.15；量房日升级 `measured` | inferred → 量房日升级 measured | 油烟机烟管 |

### 给排水 v1 已入模型锚点 —— 量房日升级勾选（2026-10-05 落地）

> 2026-10-05 给排水 v1：下面 5 个锚点的坐标**全部取自本表原先登记的推断值，一个数都没新造**，已写入 `config/plumbing.yaml`（`status: inferred` / `construction_status: pending` / `not_for_construction: true`），并各带 1~2 条 `status: inferred` 的 MEP 排水路线（`drain-mbath-vanity-to-riser` / `drain-gbath-vanity-to-riser` / `drain-kitchen-sink-to-riser` / `drain-kitchen-dishwasher-to-riser` / `drain-mbath-toilet-to-riser`）。`water_entry`（#8）仍未建点位。
> **现场动作（逐项勾选）**：☐ 测实际位置（立管/表位/排烟道，拍照）→ ☐ 与推断值比对 → ☐ 偏差 >±0.3m（燃气表/排烟道 >±0.2m）则**重画相关路线**并回写 `config/plumbing.yaml` + `config/mep-hvac-coordination.yaml` → ☐ `status` 升 `measured`、删 `uncertainty_m` / `not_for_construction` → ☐ 关闭本表对应条目。

- [ ] #6 → `drain_riser_master_bath` (0.30,1.30)：测主卫排水立管实际位置；关联路线 `drain-mbath-vanity-to-riser` / `drain-mbath-toilet-to-riser`。⚠️ 推断位在主卫西北圆角幕墙切角外侧（距弧心 (1.00,2.10) 1.06m），量房重点核立管是否在房间内侧——在房间内侧则两条路线折线缩短、不再越幕墙。
- [ ] #6 → `drain_riser_guest_bath` (5.80,2.40)：测客卫排水立管实际位置；关联路线 `drain-gbath-vanity-to-riser`。
- [ ] #7/#16 → `drain_riser_kitchen` (10.50,0.30)：测厨房排水立管实际位置；关联路线 `drain-kitchen-sink-to-riser` / `drain-kitchen-dishwasher-to-riser`，并复核 `faucet_kitchen_sink` / `drain_kitchen_sink` 的 x 坐标口径（DEC-2026-08-02-013 北墙落地柜台面）。
- [ ] #18/#9 → `gas_meter_kitchen` (8.00,0.20) h=1.5，±0.2m：测燃气表位（气源/报警器/切断阀另见 #32）；**无 MEP 路线**（本项目燃气路由除外）。
- [ ] #17/#10 → `duct_kitchen_exhaust` (9.00,0.10)，±0.2m：测厨房排烟道实际位置（油烟机烟管走向随 SKU 冻结）；**无 MEP 路线**。

## 建筑细节

| # | 数据项 | 填入文件 | 格式 | 当前值 | 精度 | 影响 |
|---|--------|----------|------|--------|------|------|
| 11 | 幕墙竖梃位置 | overlay.yaml `type: mullion` | `{x, z}` 列表 | 待量 | — | 窗帘轨道/家具避让 |
| 12 | 房间净尺寸复核 | model-geometry.yaml 顶点坐标 | 更新 x/z | CAD 值 | inferred | 面积/家具 |
| 13 | 入户门尺寸/开启方向 | model-geometry.yaml openings | 更新 width/room | 待量 | — | 玄关柜布局 |
| 14 | 空调外机位净尺寸 | house.yaml west_platform | 更新 width/length | 1.6×1.00m（bbox；含 r=1.0 西北圆角可用约 1.39㎡） | inferred | HVAC 选型 |
| 15 | 幕墙可开启扇位置/尺寸 | house.yaml constraints.exterior | 每面位置+宽+高+开启方式 | 四面均有推拉窗，约1m宽 | estimated | 纱窗/窗帘轨道避让/通风方案 |
| 16 | 厨房排水立管实际位置 | plumbing.yaml `type: drain_riser` | `{x, z, diameter}` | **v1 已入模型（`inferred`，±0.3m）**：`drain_riser_kitchen` (10.5,0.3)（与 #7 同值同点，量房日合并升级 `measured`） | inferred → 量房日升级 measured | 北墙水槽x坐标 |
| 17 | 厨房排烟道实际位置 | plumbing.yaml `type: duct`（业主 2026-10-05 批准并入，不新建 ductwork.yaml） | `{x, z, diameter}` | **v1 已入模型（`inferred`，±0.2m）**：`duct_kitchen_exhaust` (9.0,0.1)，断面 0.15 | inferred → 量房日升级 measured | 烟管走向 |
| 18 | 厨房燃气表实际位置 | plumbing.yaml `type: gas_meter` | `{x, z, height}` | **v1 已入模型（`inferred`，±0.2m）**：`gas_meter_kitchen` (8.0,0.2) h=1.5（与 #9 同值同点，量房日合并升级 `measured`） | inferred → 量房日升级 measured | 燃气管路由 |
| 19 | 主卫排水立管实际位置 | plumbing.yaml `type: drain_riser` | `{x, z, diameter}` | **v1 已入模型（`inferred`，±0.3m）**：`drain_riser_master_bath` (0.3,1.3) | inferred → 量房日升级 measured | 洗手台外移坐标 |
| 20 | 全屋飘窗实际sill高度 | overlay.yaml bay_sill | 更新 sill 值 | 卧室系≈2.07 / 厨房≈2.12 / 客厅系≈2.57（邻户图 LH 读法+样板间视频目视；旧值全屋2.55系客厅值误推广且穿楼板无效，已废） | inferred→待量房终核 | 飘窗利用方案/儿童房衣柜降高/窗帘盒 |
| 21 | 厨房实际南界/餐厅带划分 | model-geometry.yaml 顶点 v_kit_s2/v_ent_kit2 | 更新 z | 推断 z=2.40（与 model-geometry.yaml v_kit_s2.z=2.40 现行口径一致；创想图读法 2.90 已废） | inferred | DEC-014 厨房面积/餐桌方案前提 |
| 22 | 冰箱实际位置 | electrical.yaml sock_kitchen_fridge | `{x, z}` | 推断东墙南端 (10.80,2.05)（自 DEC-021 起漂移，本轮回纠） | inferred | 插座/高柜设计；与玄关强弱电箱位置无关 |
| 23 | 厨房净面积复核 | house.yaml rooms.kitchen | 更新 width/length/area | 3.6×2.4=8.64（开发商标注 6.09 为净口径） | inferred | 预算/柜体延米 |
| 24 | 全屋门洞实际位置+开启方向 | model-geometry.yaml openings / electrical.yaml | 各门洞坐标 | resolver 口径（offset=锚点到洞口中心距），重点 d_ent/d_gbath/d_mbath | inferred | 开关/插座避门摆（已按此口径避让）、主卫洗手台距门边 5cm、柜体间隙 |
| 25 | 主卧东墙窗洞是否存在（w_mb_win） | model-geometry.yaml openings | z∈[7.1,9.5] w=2.4 sill=0.9 | inferred（house.yaml/决策日志均无记录，疑 CAD 残留） | 主卧床头位、床头壁灯（h=1.6 落入窗洞）、东墙电气点位 |
| 26 | 燃气热水器位置+排烟/燃气路由 | electrical.yaml / plumbing.yaml | 暂定阳台 sock_balcony_waterheater | undecided（house.yaml：厨房或入户花园待定） | CO 安全（生活阳台为封闭玻璃幕）、物业外立面审批、燃气表路由 |
| 27 | 墙厚：隔墙 100 / 内墙 180-200 / 外侧 280（邻户尺寸链直读） | model-geometry.yaml / 电气布管 | 邻户参考 | reference | 柜体嵌入/挂重、100 墙开槽限制、门套 |
| 28 | 交付标准核实：图纸附交付标准清单但勾选状态不可辨（表格近空白），**不得当作邻户事实**；此前"全房有电线/地面水泥/888"表述已纠正 | budget 水电/拆改 | 以购房合同+交房现场核实为准 | unconfirmed | 水电 12000 预算口径（原线路利用 vs 全改）、888 铲除 |
| 29 | 强电箱/弱电箱/燃气表/排水立管/水表点位 | electrical.yaml / plumbing.yaml | 图例有符号定义，但图面符号与图例不同比例且含图例未收录图标（竖框+圆圈×2，疑灶具/热水器，见 (2.3,0.6)/(6.9,-0.4) 两簇），自动提取不可靠 | 需现场对照图纸逐项核 | 不再尝试从邻户图提取坐标；量房日带图对照 |
| 30 | 强电箱规格：单排/双排、回路数、进线截面 | electrical.yaml `type: strong_panel` | `{单排\|双排, mount_height, body_height, width, depth, circuits, capacity, 进线截面}` | 嵌墙开发商预留，位置 x=13.40,z=3.60；390×390×210mm（宽×高×深，与 electrical.yaml strong_panel width 0.39/body_height 0.39/depth 0.21 同源；单/双排待复测）；底部离地 1.65m | pending（位置 inferred；单双排/箱体规格/本体高度待复测） | 21 路 + 2P 进线开关 + 浪涌需双排（DEC-2026-10-05-R3 浴霸拆每卫一路 20→21；单排约 20 位，扣总开后约 16 位）；GB 55038 7.4.3-2 规定单排箱底边 ≥1.80m、双排 ≥1.60m，现 1.65m 仅双排合规；进线须 ≥10mm² 铜芯（7.4.3-3）。与 #4 同源，量房后合并口径 |
| 31 | 马桶 SKU（主卫/客卫）：坑距、落地/壁挂、智能盖接口 | config/procurement.yaml `id: sanitary_toilet_01`；plumbing `toilet_mbath` / `toilet_gbath` | `{sku, 坑距, 水效等级, 智能盖接口(电源/进水), 分体\|一体}` | 待选型（2 套，均预留智能盖插座） | pending | 主卫马桶排污口 drain_mbath_toilet 与水电错位依赖坑距；壁挂则给水+电+排污全进假墙，现有墙挂模型作废；客卫同柱另有毛巾架 h=1.2 与干区地漏 |
| 32 | 燃气气源（管道天然气/瓶装液化气）与燃气公司报警器+切断阀方案 | plumbing.yaml `type: gas_meter`（暂未建模）；electrical.yaml `sock_kitchen_gas` | `{气源类型, 表位 x/z/height, 报警器型号与位, 切断阀规格}` | 暂定报警位 (10.80,0.20) h=2.35（DEC-2026-10-04-R2 按机体最近缘重算北移，依据 config/electrical.yaml sock_kitchen_gas）（CJJ/T 146 合规）；表位推断 (8.0,0.2) h=1.5 | inferred→待量房/燃气公司确认 | 天然气近顶安装 vs 液化气贴地安装方向相反；切断阀联动与表位影响厨房燃气管路由与 #9/#18；开放式验收口径一并确认 |
| 33 | 洗烘/冰箱 SKU 尺寸与开门侧、检修带 | electrical.yaml `sock_balcony_washer`/`sock_balcony_dryer`/`sock_kitchen_fridge`；house.yaml | `{洗衣机宽×深×高, 烘干机型, 开门侧, 叠放支架, 冰箱宽×深×高}` | 阳台 1.60×1.20m（v_vrv_sw(5.60,1.00)→v_balc_sw(5.60,2.20)→v_balc_se(7.10,2.20)→v_vrv_se(7.20,1.00)），东墙门洞 d_kit_balc 占 z[1.20,2.00] | pending | 现 h=1.2 插座在洗烘叠放体内（叠放高约 1.70m），无侧置检修带；候选改为机器顶部以上可及位或侧柜管井检修口。冰箱位在东墙通顶高柜内，需可及检修口 |
| 34 | 瓦工 18,500 元预算池口径：是否已含防水人工与辅材 | schedule/phase-1/control.yaml `COST-060-02/04/05`、`PKG-050` | `{人工单价, 含防水?, 含辅材?, 复杂砖加价, 海棠角/开孔/包干单价}` | 业主 2026-10-03 给定 18,500（owner_budget_pool，`QR-2026-10-03-05`），与项目既有锚点 17,000–18,500 一致 | pending | 决定 PKG-050 防水（目标 3,000）与 COST-060-02 辅材（目标 4,000）是否去重；与 #28 水电口径同源，报价单到手后合并 |
| 35 | 瓷砖型号/同批/损耗/配送/退补（诺贝尔方向） | config/materials.yaml `floor_tile_04`；`COST-060-01` | `{型号, 规格, 每箱片数, 损耗率, 配送上楼, 退补规则, 单价与总价口径}` | 业主 2026-10-03 看中方向，封顶 20,000 元（owner-provided，未取证） | pending | 直接决定 PKG-060 缺口（12,500）；封顶价不是成交价，须与 floor_tile_01/02/03 同口径比较 |
| 36 | 智能马桶 ZQ6650 坑距/水压/送装/质保 | schedule/phase-1/control.yaml `COST-100-01`（`QR-2026-10-03-14`） | `{坑距 305\\|400, 水压要求, 送装范围, 质保年限}` | 两台封顶 5,598 元，owner-provided，未取证 | pending | 与 #31 互链；排水方向、角阀与插座横向错开 ≥0.15m 或竖向分层需一并确认 |
| 37 | 橱柜延米/投影面积、柜体板、五金、台面厚度 | `COST-110-01~05`（`QR-2026-10-03-20/21`） | `{地柜延米价, 吊柜延米价, 投影面积价, 板材, 五金品牌, 台面 20mm 石英石, 安装}` | 业主 2026-10-03 目标 12,000 + 水槽龙头 1,500 | pending | 超 PKG-110 计划额 2,000；台面开孔须等烟机/灶具/水槽型号冻结 |
| 38 | 石膏板吊顶计价口径 + 浴霸/凉霸归属 | `COST-070-02/03/04`、`COST-100-06`、`PKG-120`（`QR-2026-10-03-08/09`） | `{边吊/平顶/窗帘盒/圆角单价, 龙骨规格, 石膏板品牌, 开孔加固, 浴霸凉霸归吊顶还是卫浴}` | 铝扣板套件已报价 9,537（含 2 浴霸+凉霸+灯）；石膏板吊顶目标 13,500 | pending | PKG-070 最大缺口（17,037）；归属不定会与 `COST-100-06`、PKG-120 双计；5700K 灯光需改 4000K |
| 39 | 中央空调成交配置与待验证项 | config/hvac.yaml `A2.load_design`；config/ceiling.yaml `ac_indoor`；config/mep-hvac-coordination.yaml；`COST-030-01`（`QR-2026-10-03-24` / `DEC-2026-10-04-R1`） | `{外机型号/额定制冷量, 内机逐台型号与容量, 主卧已选机位中心, /P-SS 实际外廓, 冷负荷计算书, 外机尺寸与平台散热核算, 供电制式, 合并供电配电图, 风口加长是否已含}` | **已成交 36,000 元（2026-10-04 定标，DEC-2026-10-04-R1）**：领航者Ⅳ MJV-200W-E01-LHIV 20kW 14,124 + 安装 1,400×6=8,400；6 台双出风内机全带泵，房间映射由业主确认：客厅 71T2、餐厅 42T2、主卧 56T2（机位中心 x=3.70）、父母房/儿童房/东南书房各 28T2，合计 25.3kW；20kW 外机连接率 1.265（约 1.27）。合同供电 220V 已确认；外机供电已按 GB 55038 7.4.4 单独成路、建为拓扑第 20 路 hvac_power_outdoor_a2（DEC-2026-10-04-R2，正式配电图仍待厂家） | contract_decided（房间映射及主卧中心由业主确认）/ vendor_verification_pending（尺寸、负荷、平台、配电及风口等）/ construction_not_frozen | 合同映射和主卧机位不再是待确认项。仍待核：①厂家正式逐台配置及 /P-SS 外廓（/PX-TS 参数表不是已购 /P-SS 尺寸依据；不得将其中 900mm 机身长度直接用于本机位净空确认；餐区 42T2 外廓也待厂家图）；②外机实测尺寸及 1.6×1.00m 西平台散热（百叶有效面积、进排风净距、检修和热短路）；③厂家室内机合并供电与外机正式配电图（外机供电已建为拓扑第 20 路 hvac_power_outdoor_a2，专用插座/硬接、漏保和线径以正式图为准）；④分房间冷负荷计算书；⑤梁底、吊顶空间、风口/复合风管及增项报价、冷凝水坡度须厂家深化并经交房实测。36,000 元不含税、复合风管和风口加长（加长 100 元/米另计）。2026-10-06 业主已提供并归档三代 LHⅢ 200W 参数图（两张完全重复，只存一份）和美的安装收费海报，见 `docs/design-iterations/hvac-resix-20261003/evidence/evidence-notes.md` §六；两图内容已核，不再向业主重复索取。参数图不是合同四代 LHIV 的外形/最大电流证明，海报不是本合同增项承诺；后续由厂家/签约门店分别给合同机型资料及书面计价。此前“餐区 56T2”“客厅两台”及其相关风口偏移方案是历史版本，不作为现行成交房间映射或施工定位依据。 |

## 追加登记（2026-10-04 A 组整改：把静默缺失变成显式待办）

> 本节 12 条（#40–#52）全部是**本轮才发现的结构性缺口**（#40–#48 为 2026-10-04/05 补登，#49–#52 为 2026-10-06 DEC-2026-10-06-R1 给排水缺项兜底补登）：此前方言/数据里带病运行，门禁抓不到。
> 逐条写清「卡在谁那」，未裁定前**一律不改数据**。

| # | 数据项 | 填入文件 | 格式 | 当前值 | 精度 | 影响 |
|---|--------|----------|------|--------|------|------|
| 40 | 套内 + 赠送 vs 预测建面的**加法口径** | config/house.yaml `project` / `notes` | `{净口径, 毛口径, 赠送计入规则}` | 三个真实存在的口径：**94.76㎡（合同净）** / **123.21㎡（94.76 + 12.90 + 13.95 + 1.60，模型 bbox 毛口径 + 赠送）** / **119.38㎡（预测建面）**。94.76 + 28.45 = 123.21 ≠ 119.38，等式不闭合 | pending | 预算基数、地面/柜体延米、得房率叙述。两个加数（入户花园 11.06→12.90、西设备平台 2.48→1.60）已按 `model-geometry.yaml` bbox 修正；**剩余的不是算错，是三套口径从未对齐**。需合同分户图裁定「净/毛/赠送计入」三者关系后再回写 |
| 41 | MEP 吊顶内分层标高 vs 降板底面 | config/mep-hvac-coordination.yaml `layers` / `routes` | `{layer.height, route.via[].y, from_height}` | 分层标高（强电 2.45 / 弱电 2.50 / 冷媒 2.55 / 冷凝水 2.35 / 送风 2.68 / 回风 2.72）**整层低于 0.30m 降板的完成面 2.50m**（0.15m 降板/铝扣板为 2.65m）；降板底面权威 = `config/ceiling.yaml` 的 `height`（= 2.80 − thickness，与 `shared/render/CeilingZoneBuilder.ts` 的 topY 同口径）。强电/弱电/冷凝水若真按 2.45/2.35 敷设，会落在降板完成面**下方**即室内可见面；走向需整体升入降板空腔 2.50–3.00m，或调整降板厚度/范围。已由契约 `c.mep_layer_below_drop_bottom` 强制登记，冲突数不得无解释地增减。**分解链条（按 `config/facts.yaml` 契约 `c.mep_layer_below_drop_bottom` 的登记口径，与 `git log -p config/facts.yaml` 的 144→149→154→153 一致）**：① **144→149**（2026-10-05 给排水 v1 新增 5 条排水路线，每条在所属厨卫铝扣板吊顶范围内新增 1 处，未改任何分层标高）；② **149→154**（2026-10-05 DEC-2026-10-05-R11 客餐厅冷凝水改线：`condensate-living`/`condensate-dining` 原竖管在客餐厅平顶无吊顶区，业主裁定改走吊顶网络——北缘边吊→走廊→客卫开放洗漱区，合计 +5 全部为分区内 hit；改线新增段本身已全部收进吊顶空腔、不再外露）；③ **154→153**（2026-10-05 DEC-2026-10-05-R19 厨房铝扣板收回真实南墙 z=2.40、餐区改由 `ceiling_dining_north_band` + `ceiling_dining_west_band` 两条服务带承担后，`refrigerant-trunk` 原在厨房铝扣板（完成面 2.65）内的线段改在西侧服务带（完成面 2.50）空腔内，其 2.55 标高由低于完成面变为高于完成面，该 hit 合法消失）。系统性裁定（升入降板空腔 or 调整降板）仍开放。**2026-10-06 DEC-2026-10-06-R1 更新**：本轮给排水缺项兜底新增 7 条 floor-branch 给排水路线（燃气热水器进水/主卫热水/客卫热水/回水管/洗碗机进水/进水总阀/主卫沉箱二次排水），每条在所经厨卫/套间吊顶 footprint 内新增 1 处「点位低于吊顶完成面」hit——给排水走地 0.02–0.45m 本就低于完成面（与既有给排水 floor-branch 路线同源、非 #41 分层标高问题），实算 153→160（涉及 69 条路线 / 14 个吊顶分区）；本轮按契约 `c.mep_layer_below_drop_bottom` 的 `repair_channel` 附 DEC-2026-10-06-R1 全引 + 4 文件同步（ceiling.yaml / guidance §0 / 本表 #41 / facts.yaml `registered_conflicts`）记此正当修正，`decision_ref` 仍维持 `pending:`（分层标高裁定见 DEC-2026-10-06-R3 ① 未裁）。**正式修正出口已建立（`repair_channel`）**：契约 `c.mep_layer_below_drop_bottom` 的 `repair_channel` 字段把「要改该怎么改」显式化——修正必须附**设计侧 DEC 全引**（裁定落地前为 `pending:docs/pending-site-data.md #41 裁定后替换为设计侧修正 DEC 全引` 占位，引擎按同纪律在 INFO 里露面），并**同步四个文件**：`config/ceiling.yaml`（改几何/降板）→ `docs/mep-construction-guidance.md §0`（登记 prose）→ `docs/pending-site-data.md #41`（本台账）→ `config/facts.yaml` 的 `registered_conflicts`。引擎校验通道自身齐全（decision_ref 空/既非 DEC 全引又非 pending 占位、sync_files 空或文件不存在 → `repair_channel_invalid` error），并在基线漂移报错时把该出口写进 issue 正文；**error 语义不变**：`registered_conflicts ≠ 实算` 仍是 error，通道只回答「要改的话必须怎么改」，不提供任何免检。 | pending | 见上述；逐条 accept/reject 裁决见治理台账 `docs/design-iterations/mep-lint-governance-20261006/review-manifest.json`（ceiling_clearance_unverified 153 条 = pending_adjudication，卡在 #41 裁定） |
| 42 | `sock_child_ac` 声明墙段与坐标不符 | config/electrical.yaml `sock_child_ac` | `{wall, wall_side, x, z}` | 声明 `wall: w_gbath_west`（该墙段实际跨度 z[2.20,3.55]），点位 z=4.00 → 投影超出墙段 0.45m；DEC-2026-08-01-012 原文为「西北次卧南墙 `w_nw_south` (4.0,4.30)」，而 MEP route `strong-ac-child` 已按穿 `w_nw_south` 后东行至本点位建模；几何上 (5.60,4.00) 落在 `w_gbath_west_open_vanity`（x=5.60, z[3.55,4.30]）上 | inferred | 儿童房空调电源点位归属墙段决定开槽/预埋对象；也决定 `verify-point-placement` 的 `wall_side` 与渲染面朝向。量房带图核对是东段共享墙还是南墙，二选一后回写 `wall` + `wall_side`。**升级路径**（2026-10-04 A4-b 已把 `verify-point-placement` 的提前 `continue` 改成 fail-loud）：本点位现在除「投影超出墙段 0.45m」外还会被追加检查 `wall_side` 合法性与渲染面朝向，`verify:data-consistency` 的 warning 数由 6 → 7 → **8**（2026-10-06 实跑 8 条点位专项 warning：switch_parent_door、switch_child、ac_panel_child×2、sock_child_ac×2、sock_balcony_waterheater、night_gbath_door）；一旦回写 `wall`/`wall_side` 后几何仍不符，或侧别/朝向判定为 error，`verify:all` 立即 non-zero——不再可能靠 continue 静默过关。**卡在谁那**：卡在**空调厂家深化图**——儿童房 28T2 /P-SS 的机身尺寸与接管方向决定本插座最终落位与预埋对象（现坐标为设计预演值），截止节点 = **厂家图到手日**（与 #39 ⑤ 项「梁底、吊顶空间、风口/复合风管」深化图同一批次）；量房只提供墙段归属的事实输入（东段共享墙 `w_gbath_west_open_vanity` vs 南墙 `w_nw_south`，二选一），最终 `wall` + `wall_side` 须在厂家图到手后一次回写 |
| 43 | LEB 局部等电位端子箱 | config/plumbing.yaml（`type: leb`，**当前未建模**） | `{x, z, height, 联结金属构件清单}` | 未建模、位置未知。GB 55038-2025 第 7.4.7 条要求设局部等电位联结的场所（本项目主卫/客卫）应做 LEB；`shared/types.ts` 的 `PlumbingPointType` 已增 `leb` 枚举值（`shared/project-render-facts-schema.ts` 同源补齐，schema 不再挡路），但**不得在位置未知时造点位** | pending | 卫浴金属构件（花洒/龙头/毛巾架/排水口/采暖管）等电位联结的施工圈法；端子箱位置还影响卫浴柜开门净空与贴砖面。**卡在谁那**：卡在**业主拍板端子箱位置**（两卫各一处，须给柜体/开门净空留位）+ **量房确认给排水金属件清单**（哪些金属件要进联结圈、联结截面多大）；**防水/贴砖前必须预埋**——端子箱与联结干线属隐蔽工程，一旦防水施工完成就无法补埋，故本项必须在防水/贴砖节点前闭环，否则按 GB 55038-2025 7.4.7 判不合格 |
| 44 | 给排水 11 处点位无 MEP 走线引用 | config/plumbing.yaml + config/mep-hvac-coordination.yaml | `{route 或显式 deferred 标记}` | 27 个点位中 8 处既不是任何 route 的 `to`/`via`，note 里也没有显式 deferred 声明（`drain_mbath_toilet` 是既有正确先例）。已逐条补显式标记，并由契约 `c.plumbing_point_route_or_marked` 强制 | pending（逐点） | 水电交底时这 8 处「没人认领」。2026-10-05 给排水 v1：5 处排水点位（`drain_mbath_vanity`/`drain_gbath_vanity`/`drain_mbath_toilet`/`drain_kitchen_sink`/`drain_kitchen_dishwasher`）+ `faucet_kitchen_sink` 已画 v1 路线并移除 deferred 标记；2026-10-06 DEC-2026-10-06-R1：`drain_balcony_floor` 因洗衣机排水改向专用墙排（见 drain-balcony）而不再被路由引用，补 deferred 标记（地面泄水单列、两路不共用），remaining 8 处为 `shower_mbath`/`shower_gbath`（R1 已以 requirement 路线表达热水需求但热源/入户 #8#26 未定，点位仍无实体走线）、`faucet_kitchen_purifier`（#8 + RO SKU 未选型）、`faucet_garden`/`drain_garden`（#48 设计待决）、`gas_meter_kitchen`/`duct_kitchen_exhaust`（非管路锚点，燃气/烟管路由另案）、`drain_balcony_floor`（洗衣机改向后仅作地面泄水，等 #51 阳台立管确认后另画） |
| 45 | 进线相数 / 需用系数 / 总开额定电流 / 进线截面 | config/electrical-topology.yaml `pending_parameters` | `{相数, 需用系数, 总开额定电流 A, 进线截面 mm²}` | 仓内唯一进线口径为「≥10mm² 铜芯」（GB 55038 7.4.3-3），而全部回路的 capacity 合计 27.9kW——10mm² 铜芯单相约 11kW，**二者无法自洽**；需用系数、总开额定电流均无记录 | pending | 进线开关/线径选型直接决定强弱电箱规格（#30）与电改预算（#28）；卡在**供电局**（报装容量/相数）与设计侧（需用系数取值） |
| 46 | 外机供电线径升级判据 | config/electrical.yaml `sock_vrf_outdoor_a2` / config/electrical-topology.yaml | `{厂家铭牌输入功率, 实测 EER, 线径 mm²}` | proposed 口径 C32A + 4.0mm²(φ20)。输入功率估 ≈6kW（按 EER≈3.5 估）→ 27.3A，对 4.0mm²（约 27–32A）余量 <10%；若实测 EER≈3.0 则 30.3A 已触上限，需升 6mm² | pending | 外机供电为第 20 路独立回路（DEC-2026-10-04-R2），线径返工涉及平台侧出墙方式与防水；卡在**厂家**（MJV-200W-E01-LHIV 铭牌输入功率/额定电流）与正式配电图 |
| 47 | 次卧标签数与房间映射裁决 | config/layout/model-geometry.yaml `rooms:` / DEC-2026-10-05-R1 逐房映射 | `{逐房标签, 房间数, 标注面积/周长}` | 合同附图与 CAD 的"次卧"标签数互相不一致：`cad/design/01_floor_plan/floor_plan_design_2026-07-05.dxf` 与 `Drawing2.dxf` 各出现 **3 个**"次卧"标注（两间同为 8.39㎡ 但周长 11.81/11.85m 不同，另一间 8.35㎡），合同转录写"次卧×5"，而空间模型只有**三间**次级卧室（study / bedroom_nw / bedroom_se）。本轮空调逐房映射按模型三间落地（study=28T2、bedroom_nw=28T2、bedroom_se=28T2），但标签数冲突未裁决 | pending | 直接决定 28T2×3 是否真的对应三间、CAD 标注面积能否用于房间口径对账（与 #12 房间净尺寸联动）；卡在**量房**（逐房核对标签与周长）+ 合同附图重读 |
| 48 | **入户花园 `faucet_garden` + `drain_garden` 去留**（设计待决，**不是量房待决**） | config/plumbing.yaml `faucet_garden` / `drain_garden` | `{保留｜删除, 前置条件}` | 两点位按「入户花园为开发商已完成区」处理：已加 `status: inferred` / `construction_status: pending` / `not_for_construction: true`，note 写明「能否开孔/接管需量房+物业确认；**若不能，删除该点位**」。业主 2026-10-05 已接受「不能开孔/接管就删除两点位」这个选项；`drain_garden` 按业主决定不画 MEP 路线，`c.plumbing_point_route_or_marked` 的 deferred 标记保留 | pending | 浇花水龙头/花园地漏是否成立；删除则 `fact.plumbing_points_count` 27→25、`docs/mep-construction-guidance.md §0` 规模表、`config/electrical-topology.yaml` 口径注释与本列表数同步回退，`water-garden-requirement` / `drain-garden-requirement` 两条 design_requirement 路线一并评审。**卡在业主 + 物业**（开发商完成面能否开孔/接管），量房只提供事实输入 |
| 49 | **全宅进水总阀 / 减压阀 / 前置过滤器安装位** | config/mep-hvac-coordination.yaml `water-entry-valve-requirement` + config/plumbing.yaml | `{x, z, height, DN}` | DEC-2026-10-06-R1 已在配置层以 design_requirement 路线 `water-entry-valve-requirement` 表达需求（DN20 全宅进水总阀 + 可调式减压阀出口 0.25MPa + 反冲洗前置过滤器位带排污/旁通），锚在既有已登记点位 faucet_kitchen_sink (9.50,0.30) 与入户候选 (7.0,0.45) 之间正交穿 w_vrv_east；**安装位无已登记坐标（给水入户点 #8 未定）**，故只表达需求不画定位 | pending | 进水总阀/减压/前置是全屋水质与水压第一道关口，水电做完即永久错过；**卡在 #8 入户点实测 + 检修箱净空**（与 #43 联动），入户点定后回写安装位并把 requirement 升 plan_supported 实体路线 |
| 50 | **主卫沉箱最低点 / 二次排水口位** | config/mep-hvac-coordination.yaml `drain-mbath-secondary-requirement` | `{x, z}` | DEC-2026-10-06-R1 已以 design_requirement 路线 `drain-mbath-secondary-requirement` 表达（DN50 二次排水 + 向二次口找 1% 坡 + 轻质回填 + 回填前通球与 24h 闭水，GB 50242 / 通用图集口径），锚在 drain_mbath_floor (2.0,1.15)；**沉箱最低点/二次排水口位无已登记坐标** | pending | 同层排水沉箱二次排水（防渗水积于防水层下致防水失效）须在回填前定位；**卡在沉箱下沉:300 分界线（#6/#19）+ 回填/铺贴前现场定最低点**，通球与 24h 闭水须在回填隐蔽前完成 |
| 51 | **阳台排水立管位（洗衣机专用墙排接入点）** | config/mep-hvac-coordination.yaml `drain-balcony`（terminus）+ config/plumbing.yaml `drain_balcony_washer` | `{x, z}` | DEC-2026-10-06-R1 已把 `drain-balcony` 终点由 drain_balcony_floor（地漏）改为洗衣机专用墙排（≥50mm 水封、独立三通）→ 向 (6.5,1.5,0.586) 接入阳台排水立管方向（两路不共用、防反水，修正原「通地漏」与「不走地漏」note 的矛盾）；**阳台排水立管位无已登记坐标** | pending | 洗衣机排水须专用墙排接入立管、不通地面泄水地漏（否则共路反水）；**卡在量房确认阳台排水立管实测位**后接入并把 `drain-balcony` 终点 from 显式坐标升为实体立管点位 |
| 52 | **RO 净水器浓水排放接点** | config/plumbing.yaml `faucet_kitchen_purifier` note | `{接管方式: 水槽排水三通｜专用排污点, 防虹吸/水气分离做法}` | DEC-2026-10-06-R1 已在 note 注明「浓水接水槽排水三通或专用排污点，不得直插密封下水」，接管方式随 RO 净水器 SKU 冻结后定 | pending | RO 浓水不得直插密封下水（气堵/虹吸/反渗），接管位与做法随 #44 RO SKU；**卡在 RO 净水器 SKU 冻结 + 量房核水槽排水三通可用性** |

## 量房工具清单

- [ ] 激光测距仪（±1mm）
- [ ] 5m 卷尺（备用）
- [ ] 手机（拍照+水平仪 APP）
- [ ] 记号笔+美纹纸（标记点位）
- [ ] 打印本清单（现场勾选）

## 拍照要求

- [ ] 每个房间四面墙正面照
- [ ] 天花板（露梁）
- [ ] 强电箱/弱电箱打开拍
- [ ] 排水立管/给水口/燃气表特写
- [ ] 幕墙竖梃全貌
- [ ] 空调外机位全貌+百叶
- [ ] 入户门正面+侧面
