# 量房待填清单

> 量表共 55 条（2026-10-09 防穿模 linter 新增 #55 主卫 PVC 服务井包络口径：预留区还是实体管；2026-10-08 DEC-2026-10-08-C01 吊顶算量子系统新增 #53 主卧两条窗帘盒平面重叠 0.025㎡；2026-10-05 给排水 v1 落地：#6/#7/#9/#10/#16/#17/#18/#19 改为「已入模型（inferred）」并新增 #48 入户花园去留**设计待决**；2026-10-06 DEC-2026-10-06-R1 给排水缺项兜底新增 #49 进水总阀/减压/前位、#50 主卫沉箱二次排水口位、#51 阳台排水立管位、#52 RO 浓水排放接点；2026-10-07 DEC-2026-10-07-C17 业主断言「都是落地窗」后新增 #54 主卫西墙/北墙玻璃根齐地幕墙反坎待核，与 `fact.pending_site_data_count` 对账：新增/关闭条目必须同步此数）。
>
> **计数口径（自证防线）**：本表是 **54 个编号（#1–#54）+ #3a 一条子项 = 55 行表格记录**。`fact.pending_site_data_count` 的权威值是「编号数 54」（即文件开头那一处，由 `expect_matches: 1` 单列锁定），与表格物理行数 55 不相等是设计使然——#3a 是 #3「室内净高」的 A2 HVAC 邻户梁参考约束子项，不另占编号。二者不是漏数也不是多写；新增/关闭条目必须同步的是**编号数**，不是行数（`tests/server/mep-guidance-baseline.test.ts` 按此口径断言，防止把「53 = 54」当漂移、也防止拿自证式计数蒙混）。

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
| 8 | 给水入户点 | plumbing.yaml `type: water_supply` | `{x, z, diameter}` | **已入模型（inferred）**：DEC-2026-10-08-W01 按最佳practice推断落库、DEC-2026-10-07-F03 修正落位 (7.35,0.45)——平台侧接入候选折点 (7.00,0.45)（穿 w_vrv_east 自 VRV 设备平台侧进厨房西北角，取自三条既有 requirement 路线的同源候选，非新造）由 water-kitchen-requirement 折线+穿墙声明表达，点位本体为穿墙后户内阀位锚点（总阀→减压→前置，pending #49 联动），点位 `water_entry` 带 status: inferred / construction_status: pending / not_for_construction: true / uncertainty_m 0.3；5 处给水中 4 处已改绑点位 id，`faucet_garden` 仍随 #48 去留保持 requirement。**量房日第一项仍须闭环**：实测后回写坐标并升 measured，否则不能作为施工依据 | — | 水管走向；**5 处给水（shower_mbath/shower_gbath/faucet_kitchen_sink/faucet_kitchen_purifier/faucet_garden）的路线以本项为前提**。**量房日第一项，必须闭环**（拍全屋给水立管/水表/分水器 → 定 x/z/管径 → 回写 config/plumbing.yaml 并画 water_entry），否则 5 处给水继续无主、#44 的 7 处无主点位也无法收敛 |
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
| 20 | 全屋飘窗实际sill高度 | overlay.yaml bay_sill | 更新 sill 值 | **2026-10-07 业主断言「都是落地窗」（C17）推翻 LH→sill≈2.07 系读法**——邻户图 LH/LW 疑为开启扇/上光带尺寸而非玻璃边；幕墙玻璃均按齐地处理（主卫湿区已按此建模防水台，干区存在不贴砖）。sill 实际值仍以量房终核；若量出确有高窗台系，回滚 bay_sill 声明并恢复上飘窗读法 | owner_asserted→待量房终核 | ~~飘窗利用/儿童房衣柜降高~~（随落地改判作废）/窗帘盒/家具靠窗约束（主卧斗柜 h<2.07 不挡窗带注释作废） |
| 21 | 厨房实际南界/餐厅带划分 | model-geometry.yaml 顶点 v_kit_s2/v_ent_kit2 | 更新 z | 推断 z=2.40（与 model-geometry.yaml v_kit_s2.z=2.40 现行口径一致；创想图读法 2.90 已废） | inferred | DEC-014 厨房面积/餐桌方案前提 |
| 22 | 冰箱实际位置 | electrical.yaml sock_kitchen_fridge | `{x, z}` | 推断东墙南端 (10.80,2.05)（自 DEC-021 起漂移，本轮回纠） | inferred | 插座/高柜设计；与玄关强弱电箱位置无关 |
| 23 | 厨房净面积复核 | house.yaml rooms.kitchen | 更新 width/length/area | 3.6×2.4=8.64（开发商标注 6.09 为净口径） | inferred | 预算/柜体延米 |
| 24 | 全屋门洞实际位置+开启方向 | model-geometry.yaml openings / electrical.yaml | 各门洞坐标 | resolver 口径（offset=锚点到洞口中心距），重点 d_ent/d_gbath/d_mbath | inferred | 开关/插座避门摆（已按此口径避让）、主卫洗手台距门边 5cm、柜体间隙 |
| 25 | 主卧东墙窗洞是否存在（w_mb_win） | model-geometry.yaml openings | z∈[7.1,9.5] w=2.4 sill=0.9 | inferred（house.yaml/决策日志均无记录，疑 CAD 残留） | 主卧床头位、床头壁灯（h=1.6 落入窗洞）、东墙电气点位 |
| 26 | 燃气热水器位置+排烟/燃气路由（DEC-2026-10-08-W02 已落管道锚点 water_heater (7.30,1.00,h1.20 参考) 并绑定 6 条给排水路线，机身尺寸/接口高度仍待核） | electrical.yaml / plumbing.yaml | 暂定阳台 sock_balcony_waterheater | undecided（house.yaml：厨房或入户花园待定） | CO 安全（生活阳台为封闭玻璃幕）、物业外立面审批、燃气表路由 |
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
| 41 | MEP 吊顶内分层标高 vs 降板底面 | config/mep-hvac-coordination.yaml `layers` / `routes` | `{layer.height, route.via[].y, from_height, penetration.height}` | **已裁定（2026-10-06 DEC-2026-10-06-R5）：分层标高升入降板空腔、保走廊净高 2.50m**（废止「降板加厚到 0.35–0.40m」方案②）。改为**分区口径**：**A 区**（走廊满吊/门厅满吊/客厅北缘边吊/餐厅两条服务带/各房边吊，完成面 2.50）强电 **2.55** / 弱电 **2.60** / 冷凝水 **2.65** / 冷媒 **2.60**、上限 **≤2.75**；**B 区**（厨房铝扣板/主卫铝扣板/客卫铝扣板，完成面 2.65，空腔仅 150mm）进入该区的管路段 **2.70–2.76**；送风 2.68 / 回风 2.72 原位不变。**梁硬约束**：5 条参考梁约束带内 ≤ 参考梁底−0.05m（南窗带 2.68 / 厨房北窗带 2.60 / 厨房局部梁头 2.51 / 主卫梁头 2.36 / 走廊服务带 2.60）；不能同时满足「高于完成面」与「低于梁底」时优先改平面绕开（保持正交、不新增穿墙、不改吊顶范围、不新增路线）。**配套口径修正（DEC 明文授权）**：`ceiling_clearance_unverified` 与契约 `c.mep_layer_below_drop_bottom` 的比较范围收窄为**吊顶承载层**，走地给排水（water_supply 0.18 / drainage 0.10）退出比较（授权全引见 `shared/mep-hvac-lint.ts` 的 `CEILING_CARRIED_LAYERS` 注释与 `config/facts.yaml` 契约 `check_scope`）。**登记数 160 → 24**（承载层 160→24、走地给排水口径豁免 −20；`shared/mep-hvac-lint.ts` 与 `shared/facts-lint.ts` 双引擎已同口径收窄，实算一致）；`config/ceiling.yaml`（降板厚度/范围）本轮未动；路线条数仍 87 条。**残留 N=24 处待量房核梁/核设备定位**（全部显式登记，无静默项）：① 竖直下引至设备点位的末点 8 处（to_height 0.02–1.60m：strong-ac-outdoor 1.6、strong-power-garden 1.3、strong-ded-bathheaters-gbath 1.2、strong-ded-fridge/dishwasher/strong-power-kitchen/strong-power-gbath 0.3、strong-power-parent 窗帘电源 0.7）——点位坐标在 config/electrical.yaml，本轮禁改，竖直下引段本身合法；② 贴完成面的设备开口 6 处（回风格栅 2.49，config/ceiling.yaml 回风口坐标即 2.49）；③ weak-gateway 弱电箱下引末点 1 处（0.3m）；④ **绕不开梁带的 2 条候选路线共 6 处**：condensate-living / condensate-dining 末端立管接点 (6.70,3.70) 固定，客卫吊顶区除北缘开放边外四面有墙（w_gbath_west / w_gbath_south / w_gbath_east / w_gbath_east_open_vanity / w_gbath_west_open_vanity），自客厅方向入区必经走廊服务带 ref_corridor_service_band（x[6.9,7.5] z[3.6,8.0] 参考梁底 2.65），重力管不得上弯，无法同时满足「梁带内 ≤2.60」与「客卫段 ≥2.70」；平面绕行须新增穿墙（本轮禁止），按 DEC「确实绕不开的保留原标高」保留原值。**量房日实测该带梁底：若实测无梁或梁底高于 2.80m，即可按 A/B 口径抬升**；⑤ condensate-master / condensate-child 立管竖直下引末点 2 处（0.1m）。**绕梁改道 3 处**：strong-light-kitchen 与 strong-ded-dishwasher 由 x=9.0 竖段改沿餐厅北服务带边缘西折至 x=8.6 正交下行（绕开厨房局部梁头 x[9.0,9.4] z[1.5,2.1] 参考梁底 2.56）；strong-power-mbath-service 的 x=1.5 竖段压至 2.35（绕不开、但该段无吊顶，按主卫梁头 2.41−0.05=2.36 取值）。**待量房**：走廊服务带/厨房局部梁头/主卫梁头三条参考梁逐段实测梁底（§2.5 口径，±150mm），回填后 beam_collision 规则才具备硬判定基础。 | 已裁定 + 残留 24 处 | 逐条 accept/reject 裁决见治理台账 `docs/design-iterations/mep-lint-governance-20261006/review-manifest.json`（ceiling_clearance_unverified 24 条 = pending_adjudication：①③⑤ 待量房核设备定位/梁底、② 待厂家风口图、④ 待量房实测走廊服务带梁底）；分层标高口径见 `docs/mep-construction-guidance.md` §3.3.1 |
| 42 | `sock_child_ac` 声明墙段与坐标不符 | config/electrical.yaml `sock_child_ac` | `{wall, wall_side, x, z}` | 声明 `wall: w_gbath_west`（该墙段实际跨度 z[2.20,3.55]），点位 z=4.00 → 投影超出墙段 0.45m；DEC-2026-08-01-012 原文为「西北次卧南墙 `w_nw_south` (4.0,4.30)」，而 MEP route `strong-ac-child` 已按穿 `w_nw_south` 后东行至本点位建模；几何上 (5.60,4.00) 落在 `w_gbath_west_open_vanity`（x=5.60, z[3.55,4.30]）上 | inferred | 儿童房空调电源点位归属墙段决定开槽/预埋对象；也决定 `verify-point-placement` 的 `wall_side` 与渲染面朝向。量房带图核对是东段共享墙还是南墙，二选一后回写 `wall` + `wall_side`。**升级路径**（2026-10-04 A4-b 已把 `verify-point-placement` 的提前 `continue` 改成 fail-loud）：本点位现在除「投影超出墙段 0.45m」外还会被追加检查 `wall_side` 合法性与渲染面朝向，`verify:data-consistency` 的 warning 数在 2026-10-06 实跑为 **8**（当时包含 night_gbath_door）；DEC-2026-10-07-R12 删除该点位后，当前点位专项为 7 项（1 error + 6 warnings）：switch_parent_door、switch_child、ac_panel_child×2、sock_child_ac×2（其中一条 error）、sock_balcony_waterheater，以本轮核验结果为准；一旦回写 `wall`/`wall_side` 后几何仍不符，或侧别/朝向判定为 error，`verify:all` 立即 non-zero——不再可能靠 continue 静默过关。**卡在谁那**：卡在**空调厂家深化图**——儿童房 28T2 /P-SS 的机身尺寸与接管方向决定本插座最终落位与预埋对象（现坐标为设计预演值），截止节点 = **厂家图到手日**（与 #39 ⑤ 项「梁底、吊顶空间、风口/复合风管」深化图同一批次）；量房只提供墙段归属的事实输入（东段共享墙 `w_gbath_west_open_vanity` vs 南墙 `w_nw_south`，二选一），最终 `wall` + `wall_side` 须在厂家图到手后一次回写 |
| 43 | LEB 局部等电位端子箱 | config/plumbing.yaml（`type: leb`，**当前未建模**） | `{x, z, height, 联结金属构件清单}` | 未建模、位置未知。GB 55038-2025 第 7.4.7 条要求设局部等电位联结的场所（本项目主卫/客卫）应做 LEB；`shared/types.ts` 的 `PlumbingPointType` 已增 `leb` 枚举值（`shared/project-render-facts-schema.ts` 同源补齐，schema 不再挡路），但**不得在位置未知时造点位** | pending | 卫浴金属构件（花洒/龙头/毛巾架/排水口/采暖管）等电位联结的施工圈法；端子箱位置还影响卫浴柜开门净空与贴砖面。**卡在谁那**：卡在**业主拍板端子箱位置**（两卫各一处，须给柜体/开门净空留位）+ **量房确认给排水金属件清单**（哪些金属件要进联结圈、联结截面多大）；**防水/贴砖前必须预埋**——端子箱与联结干线属隐蔽工程，一旦防水施工完成就无法补埋，故本项必须在防水/贴砖节点前闭环，否则按 GB 55038-2025 7.4.7 判不合格 |
| 44 | 给排水 11 处点位无 MEP 走线引用 | config/plumbing.yaml + config/mep-hvac-coordination.yaml | `{route 或显式 deferred 标记}` | 30 个点位中 8 处既不是任何 route 的 `to`/`via`，note 里也没有显式 deferred 声明（`drain_mbath_toilet` 是既有正确先例）。已逐条补显式标记，并由契约 `c.plumbing_point_route_or_marked` 强制 | pending（逐点） | 水电交底时这 8 处「没人认领」。2026-10-05 给排水 v1：5 处排水点位（`drain_mbath_vanity`/`drain_gbath_vanity`/`drain_mbath_toilet`/`drain_kitchen_sink`/`drain_kitchen_dishwasher`）+ `faucet_kitchen_sink` 已画 v1 路线并移除 deferred 标记；2026-10-06 DEC-2026-10-06-R1：`drain_balcony_floor` 因洗衣机排水改向专用墙排（见 drain-balcony）而不再被路由引用，补 deferred 标记（地面泄水单列、两路不共用），remaining 8 处为 `shower_mbath`/`shower_gbath`（R1 已以 requirement 路线表达热水需求但热源/入户 #8#26 未定，点位仍无实体走线）、`faucet_kitchen_purifier`（#8 + RO SKU 未选型）、`faucet_garden`/`drain_garden`（#48 设计待决）、`gas_meter_kitchen`/`duct_kitchen_exhaust`（非管路锚点，燃气/烟管路由另案）、`drain_balcony_floor`（洗衣机改向后仅作地面泄水，等 #51 阳台立管确认后另画）。2026-10-04 A7 首捕时为 27 个点位、其中 8 处无引用；此后 v1 / DEC-2026-10-06-R1 / DEC-2026-10-08-W01 逐条收敛，「未标记点数必须为 0」现由契约 `c.plumbing_point_route_or_marked` 实算强制 |
| 45 | 进线相数 / 需用系数 / 总开额定电流 / 进线截面 | config/electrical-topology.yaml `pending_parameters` | `{相数, 需用系数, 总开额定电流 A, 进线截面 mm²}` | 仓内唯一进线口径为「≥10mm² 铜芯」（GB 55038 7.4.3-3），而全部回路的 capacity 合计 27.9kW——10mm² 铜芯单相约 11kW，**二者无法自洽**；需用系数、总开额定电流均无记录 | pending | 进线开关/线径选型直接决定强弱电箱规格（#30）与电改预算（#28）；卡在**供电局**（报装容量/相数）与设计侧（需用系数取值） |
| 46 | 外机供电线径升级判据 | config/electrical.yaml `sock_vrf_outdoor_a2` / config/electrical-topology.yaml | `{厂家铭牌输入功率, 实测 EER, 线径 mm²}` | proposed 口径 C32A + 4.0mm²(φ20)。输入功率估 ≈6kW（按 EER≈3.5 估）→ 27.3A，对 4.0mm²（约 27–32A）余量 <10%；若实测 EER≈3.0 则 30.3A 已触上限，需升 6mm² | pending | 外机供电为第 20 路独立回路（DEC-2026-10-04-R2），线径返工涉及平台侧出墙方式与防水；卡在**厂家**（MJV-200W-E01-LHIV 铭牌输入功率/额定电流）与正式配电图 |
| 47 | 次卧标签数与房间映射裁决 | config/layout/model-geometry.yaml `rooms:` / DEC-2026-10-05-R1 逐房映射 | `{逐房标签, 房间数, 标注面积/周长}` | 合同附图与 CAD 的"次卧"标签数互相不一致：`cad/design/01_floor_plan/floor_plan_design_2026-07-05.dxf` 与 `Drawing2.dxf` 各出现 **3 个**"次卧"标注（两间同为 8.39㎡ 但周长 11.81/11.85m 不同，另一间 8.35㎡），合同转录写"次卧×5"，而空间模型只有**三间**次级卧室（study / bedroom_nw / bedroom_se）。本轮空调逐房映射按模型三间落地（study=28T2、bedroom_nw=28T2、bedroom_se=28T2），但标签数冲突未裁决 | pending | 直接决定 28T2×3 是否真的对应三间、CAD 标注面积能否用于房间口径对账（与 #12 房间净尺寸联动）；卡在**量房**（逐房核对标签与周长）+ 合同附图重读 |
| 48 | **入户花园 `faucet_garden` + `drain_garden` 去留**（设计待决，**不是量房待决**） | config/plumbing.yaml `faucet_garden` / `drain_garden` | `{保留｜删除, 前置条件}` | 两点位按「入户花园为开发商已完成区」处理：已加 `status: inferred` / `construction_status: pending` / `not_for_construction: true`，note 写明「能否开孔/接管需量房+物业确认；**若不能，删除该点位**」。业主 2026-10-05 已接受「不能开孔/接管就删除两点位」这个选项；`drain_garden` 按业主决定不画 MEP 路线，`c.plumbing_point_route_or_marked` 的 deferred 标记保留 | pending | 浇花水龙头/花园地漏是否成立；删除则 `fact.plumbing_points_count` 27→25、`docs/mep-construction-guidance.md §0` 规模表、`config/electrical-topology.yaml` 口径注释与本列表数同步回退，`water-garden-requirement` / `drain-garden-requirement` 两条 design_requirement 路线一并评审。**卡在业主 + 物业**（开发商完成面能否开孔/接管），量房只提供事实输入 |
| 49 | **全宅进水总阀 / 减压阀 / 前置过滤器安装位** | config/mep-hvac-coordination.yaml `water-entry-valve-requirement` + config/plumbing.yaml | `{x, z, height, DN}` | DEC-2026-10-06-R1 已在配置层以 design_requirement 路线 `water-entry-valve-requirement` 表达需求（DN20 全宅进水总阀 + 可调式减压阀出口 0.25MPa + 反冲洗前置过滤器位带排污/旁通），锚在既有已登记点位 faucet_kitchen_sink (9.50,0.30) 与入户候选 (7.0,0.45) 之间正交穿 w_vrv_east；**安装位无已登记坐标（给水入户点 #8 未定）**，故只表达需求不画定位 | pending | 进水总阀/减压/前置是全屋水质与水压第一道关口，水电做完即永久错过；**卡在 #8 入户点实测 + 检修箱净空**（与 #43 联动），入户点定后回写安装位并把 requirement 升 plan_supported 实体路线 |
| 50 | **主卫沉箱最低点 / 二次排水口位** | config/mep-hvac-coordination.yaml `drain-mbath-secondary-requirement` | `{x, z}` | 状态更新（DEC-2026-10-08-W01）：起点已由内联坐标改绑既有推断点位 `drain_mbath_floor` (2.00,1.15)，路线本体仍为 design_requirement、不计量；二次排水口最终位仍待量房定最低点 | DEC-2026-10-06-R1 已以 design_requirement 路线 `drain-mbath-secondary-requirement` 表达（DN50 二次排水 + 向二次口找 1% 坡 + 轻质回填 + 回填前通球与 24h 闭水，GB 50242 / 通用图集口径），锚在 drain_mbath_floor (2.0,1.15)；**沉箱最低点/二次排水口位无已登记坐标** | pending | 同层排水沉箱二次排水（防渗水积于防水层下致防水失效）须在回填前定位；**卡在沉箱下沉:300 分界线（#6/#19）+ 回填/铺贴前现场定最低点**，通球与 24h 闭水须在回填隐蔽前完成 |
| 51 | **阳台排水立管位（洗衣机专用墙排接入点）** | config/mep-hvac-coordination.yaml `drain-balcony`（terminus）+ config/plumbing.yaml `drain_balcony_washer` + `drain_riser_balcony`（DEC-2026-10-08-W01 新建推断点位） | `{x, z}` | DEC-2026-10-06-R1 已把 `drain-balcony` 终点由 drain_balcony_floor（地漏）改为洗衣机专用墙排（≥50mm 水封、独立三通）→ 向 (6.5,1.5,0.586) 接入阳台排水立管方向（两路不共用、防反水，修正原「通地漏」与「不走地漏」note 的矛盾）；**阳台排水立管位无已登记坐标** | pending | 洗衣机排水须专用墙排接入立管、不通地面泄水地漏（否则共路反水）；**卡在量房确认阳台排水立管实测位**后接入并把 `drain-balcony` 终点 from 显式坐标升为实体立管点位 |
| 52 | **RO 净水器浓水排放接点** | config/plumbing.yaml `faucet_kitchen_purifier` note | `{接管方式: 水槽排水三通｜专用排污点, 防虹吸/水气分离做法}` | DEC-2026-10-06-R1 已在 note 注明「浓水接水槽排水三通或专用排污点，不得直插密封下水」，接管方式随 RO 净水器 SKU 冻结后定 | pending | RO 浓水不得直插密封下水（气堵/虹吸/反渗），接管位与做法随 #44 RO SKU；**卡在 RO 净水器 SKU 冻结 + 量房核水槽排水三通可用性** |

| 53 | **主卧两条窗帘盒平面重叠 0.025㎡**（设计待决，**不是量房待决**） | config/ceiling.yaml `curtain_box_master_south` / `curtain_box_master_west` | `{西盒 z 上界: 8.70｜8.80（维持现状，转角交汇）}` | DEC-2026-10-08-C01 新建的吊顶算量子系统（`shared/ceiling-takeoff.ts`）在重叠自检中发现：南窗帘盒 z[8.70,8.95] 与西窗帘盒 x[1.10,1.35]×z[5.55,8.80] 在 x[1.10,1.35]×z[8.70,8.80] 上重叠 0.25×0.10m。本轮**只显形不改几何**（合计净面积 45.130㎡ 含这部分重复计费，`takeoff.overlapAreaM2` 单独计量 0.025㎡） | pending | 决定西窗帘盒上界收到 z=8.70（净面积 −0.025㎡）还是按「转角两盒有意交汇」维持；同时确认转交处是否需要封板收口。**卡在业主/设计**（吊顶分区边界属设计裁定），量房只提供墙面完成面事实 |
| 54 | **主卫西墙/北墙玻璃根：齐地幕墙（有防水反坎）还是上飘窗高窗台** | overlay.yaml `bay_sill`+`sill_region`（齐地分支）或 `wall_region`（高窗台分支） | `{西墙/北墙玻璃根 sill 标高, 反坎有无及尺寸}` | **邻户图与 R11 附则逐窗核对双空白**：邻户实测表左翼凹进线 z≈1.10 只有 x≈3.8（西北次卧段）sill≈2.08 一行，主卫北墙段 x[0,2.60] 无标注行；西墙 x=0 只有主卧段 z≈7.4 窗宽 0.97 一行，主卫段 z[1.10,2.86] 无标注。全宅其余玻璃已证为高窗台系（卧室系≈2.07/厨房≈2.12/客厅上光带≈2.57，#20 同源），唯主卫两段无证据 | pending | **2026-10-07 业主断言齐地（C17），分支①已按 D4=L 落地**：overlay 新增 2 座 bay_sill（w_west_lower/w_bath_north，150×150）+ 4 段 sill_region（1.008㎡ 正砖），COST-060-08 800→871；w_west_ap 圆角段 1.00m 合并器不产弧段线、不入声明留现场收口。量房终核两项：反坎实存与尺寸（150×150 为业界常规口径）；若量出为高窗台系则删除上述声明并改补西墙 `wall_region`（分支②）。与 #43 LEB、#19 立管同在主卫湿区，量房一次核完 |
| 55 | **主卫 PVC 服务井包络口径：预留区还是实体管** | config/anti-penetration.yaml `mep_parts.participation` | `{policy: excluded｜solid, 每个 mb_vanity_* / condensate_* 类型逐条}` | **2026-10-09 防穿模 linter 实测显形**：4 个 placed 机电件中 `mb_vanity_pvc_service_chase` 的包络为 0.94×2.59×2.15m（x[1.99,2.93] y[0.10,2.69] z[2.49,4.63]），按设计穿越 4 段墙（w_mbath_east×2 / w_mbath_south / w_nw_south，各 0.12m 全墙厚）并与 6 件家具重叠（master_north_wall_wardrobe_950 0.332m、mb_vanity_base_cabinet 0.520m、mb_vanity_lower_board 0.070m、mb_vanity_main_board 0.070m、bedroom_nw/wardrobe_180 0.325m、bedroom_nw/desk 0.213m）；另外 3 个机电件（pvc_box / pvc_wardrobe_entry / condensate_pipe_ac_outlet）零重叠 | pending | 口径未裁定前**不当作缺陷、也不为了绿灯改坐标**：config/anti-penetration.yaml 已把 4 个类型显式申报为 `excluded`（与 spatial-validation.yaml 原注释「不作为家具互撞对象，穿墙由 MEP 专项校验负责」一致），未申报类型会 fail-closed 报 `pen.mep_participation_undeclared`。待裁定：①该包络是「预留区」（维持 excluded）还是「实体管」（改 solid，则上述 10 处立即成为待修穿模）；②若为预留区，是否需要按管径拆成真实管段并绑定 relationships；③`condensate_pipe_ac_outlet` 位于 y≈2.64m 吊顶高度，已确认不参与堵门判定（洞口规则按通行净高 2.0m 过滤）。**卡在业主/水电厂家**（管井做法属施工裁定），量房只提供梁位/完成面事实 |

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
