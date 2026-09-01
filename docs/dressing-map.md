# 装扮映射表（Twinmotion 云渲染用）

生成：2026-09-01，数据源：materials.yaml / house.yaml furnishings / electrical.yaml / overlay.yaml / environment.yaml / data/current-scheme.json

用法：glb 导入 Twinmotion 后按本表替换材质/家具/灯光；reimport 同名 glb 时材质覆盖按节点名保留。

## 1. 房间/地面材料 → Twinmotion 材质替换建议

| 主题 | 当前选择 | 名称 | 品牌/型号 | 规格 | Twinmotion 替换建议 |
|---|---|---|---|---|---|
| floor | floor_pbr_tile_612 | 600x1200木纹砖·步步高错缝（DEC-040 全屋定案，程序化 wood_plank 渲染） | 马可波罗 / 快环同档 / 600×1200 浅暖橡木木纹砖（柔光/天鹅绒釉，型号待门店确认） | 600x1200mm | 底色 #d8bd93，木纹·直铺，条板 600x1200mm，光泽 soft |
| floor | floor_tile_antislip_400 | 中性灰哑光防滑砖（主卫/阳台） | 马可波罗 / 快环同档 / 400x400 中性灰哑光防滑砖（防滑等级 R10+，型号待门店确认） | 400x400mm | 底色 #90949a |
| floor | floor_tile_deco_small | 复古小花砖（客卫点缀） | 快环建材市场花砖档口 / 200x200 复古釉面小花砖（花色到店选样） | 200x200mm | 底色 #b58a6f |
| wall | wall_tile_01 | 厨卫白色釉面砖 | 东鹏 / 300x600 白色釉面砖 | 300x600mm | 底色 #f5f5f5 |
| paint | latex_paint_01 | 金装净味五合一 | 多乐士 / 18L 大桶（具体型号如 A750/A8188，到店确认） | 18L | 底色 #f7f5ef |
| cabinet | cabinet_board_01 | 多层实木板柜体 + PET 肤感柜门 | 本地全屋定制工厂 / 兔宝宝 / 千年舟 / ENF/E0 级多层实木 18mm | 18mm | 底色 #f2ede2，光泽 soft |
| countertop | quartz_stone_01 | 石英石台面 | 本地石材厂 / 赛凯隆 / 中迅 / 20mm 厚单色/小颗粒 | 20mm | 底色 #e8e6e0，光泽 glossy |
| interior_door | interior_door_01 | 实木复合免漆门 | 本地大厂 / 大自然 / 美心 / 2100x900mm，门套 260mm 内 | 2100x900mm | 按实物选材替换 |
| bathroom_door | bathroom_door_01 | 钛镁铝合金极窄平开门 | 本地门窗厂 / 佛山型材 / 2100x800mm，极窄 35/40 系列，长虹/磨砂玻璃 | 2100x800mm | 按实物选材替换 |
| entry_door | entry_door_01 | 甲级防盗门 | 盼盼 / 王力 / 步阳（门店比价） / 2100x960mm，甲级，C 级锁芯 | 2100x960mm | 按实物选材替换 |
| curtain | curtain_01 | 雪尼尔遮光帘 + 幻影纱 + 铝百叶 | 本地窗帘市场 / 绍兴工厂直发 / 雪尼尔遮光布 + 幻影纱，2.0 倍褶皱 | 按米 | 底色 #e8e0d0 |
| sanitary | sanitary_toilet_01 | 虹吸式马桶 | 九牧 / 箭牌 / 普通虹吸马桶（主卫可预留智能盖插座） | 305/400 坑距 | 按实物选材替换 |
| lighting | lighting_01 | 全屋吸顶灯套餐 | 欧普 / 雷士 / 佛山照明 / 客厅大灯 + 餐厅灯 + 3 卧室 + 2 卫浴平板灯 + 阳台灯 | 套餐 | 按实物选材替换 |
| switch_socket | switch_socket_01 | 正泰 T5/NEW7M 无边框大板 | 正泰 / 五孔/单开/空调插座/USB 等，约 50 位 | 86 型 | 按实物选材替换 |
| hardware | hardware_01 | 门锁/合页/地漏/角阀/晾衣架/毛巾架套装 | 固特 / 卡贝 / 九牧五金 / 磁吸静音锁 + 不锈钢地漏 + 全铜角阀 + 晾衣架 | 全屋 | 按实物选材替换 |
| hvac | A2 | ⚠ materials.yaml 未找到 | | | |
| water_heater | gas_water_heater_01 | 16L 恒温强排燃气热水器 | 万家乐 / 万和 / 16L，二级能效，水气双调 | 16L | 按实物选材替换 |
| range_hood | range_hood_01 | 侧吸式大吸力油烟机 | 美的 / 华帝 / 侧吸，≥22m³/min，静压 ≥400Pa | 900mm | 按实物选材替换 |
| smart_home | smart_home_01 | 智能预留 B 级套装 | 米家 / Aqara / 易来 / 智能开关零线 + 网关 + 电动窗帘电源 + 人体传感器位 | 全屋 | 按实物选材替换 |
| bed | bed_180_01 | 1.8m 实木床 | 本地家具厂 / 源氏木语 / 1.8×2.0m 橡木/白蜡木 | 1800×2000mm | 按实物选材替换 |
| mattress | mattress_180_01 | 1.8m 独立袋装弹簧床垫 | 喜临门 / 雅兰 / 20-25cm 独立袋装弹簧 + 乳胶 | 1800×2000mm | 按实物选材替换 |
| wardrobe | wardrobe_240_01 | 2.4m 定制衣柜 | 本地全屋定制工厂 / 2.4×0.6×2.7m，平开门 | 2400×600×2700mm | 按实物选材替换 |
| sofa | sofa_3seat_01 | 直排现代中古沙发（深棕/黑棕仿皮，低矮简洁轮廓） | 林氏家居 / 源氏木语 / 本地家具厂（按中古款筛选） / 2.8m 直排三人位，细金属腿或矮木腿，无拉扣无弧形背 | 2800×900×750mm（坐高≤420mm） | 按实物选材替换 |
| dining_table | dining_table_01 | 1.4m 深胡桃色餐桌（木质视觉，造型简洁） | 本地家具厂 / 林氏家居 / 1.4×0.8m 深胡桃贴皮/板式台面 + 黑色金属或深木腿 | 1400×800×750mm | 按实物选材替换 |
| dining_chair | dining_chair_01 | 细腿软包餐椅（深棕仿皮） | 林氏家居 / 本地家具厂 / 细金属腿 + 低背软包，无拉扣 | 标准 | 按实物选材替换 |
| tv_stand | tv_stand_01 | 西墙电视背景柜墙（定制，DEC-029） | 本地全屋定制工厂 / 北段通顶 1.35m + TV 区低柜 2.1m，浅 PET 门 + 深胡桃开放格/背板 | 约 5 投影㎡（0.35-0.4m 深） | 底色 #8a6f52 |
| desk | desk_01 | 1.2m 书桌 | 本地家具厂 / 林氏家居 / 1.2×0.6×0.75m 板式/实木 | 1200×600×750mm | 底色 #b08d5e |
| chair | chair_01 | 人体工学椅 | 西昊 / 永艺 / 网布升降转椅 | 标准 | 底色 #3a3a3a |
| bookshelf | bookshelf_01 | 0.8m 书架 | 本地家具厂 / 林氏家居 / 0.8×0.3×1.8m 开放式 | 800×300×1800mm | 底色 #9c7b52 |
| shoe_cabinet | shoe_cabinet_01 | 玄关收纳组合（花园换鞋站+门内半高定制柜） | 成品鞋柜 / 本地全屋定制工厂（待选型） / 1.1m 可移动鞋柜+自立洞洞板；2.0×0.35×1.5m 双面半高定制柜 | 花园站为成品可移动；门内柜为落地定制半高柜，柜顶保留视线 | 底色 #c4a882 |
| coffee_table | coffee_table_01 | 圆形/椭圆黑色茶几（轻巧造型） | 本地家具厂 / 林氏家居 / φ0.7-0.8m 圆形，黑色/深木色，细腿 | φ700-800×420mm | 底色 #2f2822 |
| gas_stove | gas_stove_01 | 5.0kW 嵌入式燃气灶 | 美的 / 华帝 / 双灶嵌入式，5.0kW | 760×450mm | 按实物选材替换 |
| dishwasher | dishwasher_01 | 嵌入式洗碗机 | 美的 / 海尔 / 8-13 套嵌入式 | 标准 | 按实物选材替换 |
| water_purifier | water_purifier_01 | RO 反渗透净水器 | 小米 / 美的 / 400-600G 厨下式 | 标准 | 按实物选材替换 |
| washer | washer_01 | 10kg 滚筒洗衣机 | 小天鹅 / 海尔 / 10kg 滚筒变频 | 标准 | 按实物选材替换 |
| dryer | dryer_01 | 9kg 热泵烘干机 | 小天鹅 / 海尔 / 9kg 热泵式 | 标准 | 按实物选材替换 |
| shower_enclosure | shower_enclosure_01 | 淋浴房玻璃隔断 | 本地卫浴 / 莱博顿 / 304不锈钢边框 + 钢化玻璃 | 标准 | 按实物选材替换 |

## 2. 家具体块清单 → 库家具替换参照

glb 中家具节点名为 `furniture:{room}:{type}:{index}`，体块尺寸即下表 width×depth（米）。

| 房间 | 类型 | 数量 | 宽×深 (m) | 摆位 (x, z) / 朝向 |
|---|---|---|---|---|
| master_bedroom | bed_180 | 1 | 1.8×2 | (3.2, 7.875) / 270° |
| master_bedroom | wardrobe_240_split | 1 | 2.4×0.8 | (3, 5.95) / 0° |
| master_bedroom | mb_washbasin_cabinet | 1 | 1.1×0.5 | (0.55, 3.16) / 0° |
| master_bedroom | master_dressing_table | 1 | 0.85×0.4 | (4, 9.245) / 90° |
| master_bedroom | dressing_stool | 1 | 0.42×0.4 | (3.75, 9.245) / 90° |
| master_bedroom | plant_fiddle | 1 | 0.5×0.5 | (1.1, 9.4) / 270° |
| master_bedroom | faucet | 1 | — | count-only（不在 glb，按实物补摆） |
| master_bedroom | mb_vanity_base_cabinet | 1 | — | count-only（不在 glb，按实物补摆） |
| master_bedroom | mb_vanity_lower_board | 1 | — | count-only（不在 glb，按实物补摆） |
| master_bedroom | mb_vanity_main_board | 1 | — | count-only（不在 glb，按实物补摆） |
| master_bedroom | mb_vanity_pvc_box | 1 | — | count-only（不在 glb，按实物补摆） |
| master_bedroom | mattress_180 | 1 | — | count-only（不在 glb，按实物补摆） |
| master_bedroom | curtain_set | 1 | — | count-only（不在 glb，按实物补摆） |
| master_bedroom | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| bedroom_nw | bed_150 | 1 | 1.5×2 | (4.6, 2.3) / 270° |
| bedroom_nw | wardrobe_180 | 1 | 1.8×0.6 | (3.5, 4) / 0° |
| bedroom_nw | desk | 1 | 1.2×0.6 | (2.825, 3) / 90° |
| bedroom_nw | chair | 1 | 0.5×0.5 | (3.35, 3) / 270° |
| bedroom_nw | shelf | 1 | 0.8×0.4 | (3, 1.3) / 0° |
| bedroom_nw | mattress_150 | 1 | — | count-only（不在 glb，按实物补摆） |
| bedroom_nw | curtain_set | 1 | — | count-only（不在 glb，按实物补摆） |
| bedroom_nw | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| bedroom_se | desk | 1 | 1.2×0.6 | (13.7, 8.05) / 90° |
| bedroom_se | chair | 1 | 0.5×0.5 | (14.4, 8.05) / 270° |
| bedroom_se | low_room_cabinet | 1 | 0.4×1.2 | (16.15, 8.05) / 0° |
| bedroom_se | rubber_training_mat | 1 | 1.8×1.6 | (15.2, 6.6) / 0° |
| bedroom_se | squat_rack | 1 | 1.515×0.95 | (15.2, 6.65) / 0° |
| bedroom_se | bench_adjustable | 1 | 1.24×0.55 | (15.2, 6.65) / 90° |
| bedroom_se | barbell_olympic | 1 | 2.2×0.08 | (15.2, 6.65) / 0° |
| bedroom_se | weight_plate_set | 1 | — | count-only（不在 glb，按实物补摆） |
| bedroom_se | curtain_set | 1 | — | count-only（不在 glb，按实物补摆） |
| bedroom_se | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| study | bed_150 | 1 | 1.5×2 | (5.2, 7.75) / 90° |
| study | wardrobe_180 | 1 | 1.8×0.6 | (5.1, 5.85) / 180° |
| study | desk | 1 | 1.2×0.6 | (4.5, 9.2) / 90° |
| study | chair | 1 | 0.5×0.5 | (5.1, 9.2) / 270° |
| study | mattress_150 | 1 | — | count-only（不在 glb，按实物补摆） |
| study | curtain_set | 1 | — | count-only（不在 glb，按实物补摆） |
| study | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| living_dining | wall_cabinet_tall | 1 | 1.35×0.35 | (7.375, 6.225) / 270° |
| living_dining | tv_wall_low | 1 | 2.1×0.4 | (7.4, 8) / 270° |
| living_dining | tv_65 | 1 | 1.45×0.25 | (7.42, 8) / 270° |
| living_dining | floor_lamp | 1 | 0.32×0.32 | (11, 9.35) / 0° |
| living_dining | plant_fiddle | 1 | 0.5×0.5 | (7.65, 9.35) / 270° |
| living_dining | sofa_3seat | 1 | 2.8×0.9 | (11, 7.7) / 270° |
| living_dining | coffee_table | 1 | 0.7×0.7 | (9.7, 7.7) / 0° |
| living_dining | entry_half_height_cabinet | 1 | 2×0.35 | (11.5, 3.9) / 90° |
| living_dining | dining_table | 1 | 1.4×0.8 | (7.9, 3.45) / 0° |
| living_dining | dining_chair | 4 | 0.45×0.45 | (7.55, 2.75) / 0°；(8.25, 2.75) / 0°；(7.55, 4.15) / 180°；(8.25, 4.15) / 180° |
| living_dining | curtain_set | 2 | — | count-only（不在 glb，按实物补摆） |
| living_dining | ceiling_light | 2 | — | count-only（不在 glb，按实物补摆） |
| kitchen | kitchen_cabinet_run | 3 | （体块无尺寸记录） | (7.86, 0.32) / 0°；(9.94, 0.32) / 0°；(10.48, 1) / 90° |
| kitchen | kitchen_countertop_bridge | 1 | 0.6×0.6 | (8.8, 0.32) / 0° |
| kitchen | dishwasher | 1 | 0.6×0.6 | (8.8, 0.3) / 0° |
| kitchen | fridge | 1 | 0.7×0.7 | (10.45, 2.05) / 90° |
| kitchen | gas_stove | 1 | 0.75×0.6 | (10.5, 1.18) / 90° |
| kitchen | range_hood | 1 | 0.9×0.5 | (10.5, 1.18) / 90° |
| kitchen | sink | 1 | 0.8×0.6 | (9.5, 0.3) / 0° |
| kitchen | water_heater | 1 | 0.36×0.16 | (7.3, 1) / 270° |
| kitchen | cabinet_base | 5 | — | count-only（不在 glb，按实物补摆） |
| kitchen | cabinet_wall | 2 | — | count-only（不在 glb，按实物补摆） |
| kitchen | countertop_quartz | 5 | — | count-only（不在 glb，按实物补摆） |
| kitchen | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| master_bath | toilet | 1 | 0.4×0.6 | (2.3, 1.5) / 270° |
| master_bath | towel_set | 1 | 0.04×0.28 | (0.24, 2.23) / 0° |
| master_bath | exhaust_fan | 1 | 0.3×0.3 | (1, 2.7) |
| master_bath | shower_set | 1 | — | count-only（不在 glb，按实物补摆） |
| master_bath | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| guest_bath | vanity | 1 | 0.7×0.4 | (6.9, 3.925) / 270° |
| guest_bath | toilet | 1 | 0.4×0.6 | (6.75, 3.05) / 270° |
| guest_bath | exhaust_fan | 1 | 0.3×0.3 | (6.35, 2.45) |
| guest_bath | faucet | 1 | — | count-only（不在 glb，按实物补摆） |
| guest_bath | shower_set | 1 | — | count-only（不在 glb，按实物补摆） |
| guest_bath | towel_set | 1 | — | count-only（不在 glb，按实物补摆） |
| guest_bath | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| balcony | washer | 1 | 0.6×0.6 | (5.95, 1.5) / 90° |
| balcony | dryer | 1 | 0.6×0.6 | (5.95, 1.5) / 90° |
| balcony | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| entry_garden | garden_entry_station | 1 | 1.1×0.38 | (15.02, 1.35) / 270° |
| entry_garden | shoe_cabinet | 1 | — | count-only（不在 glb，按实物补摆） |
| entry_garden | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |

## 3. 灯光点位（15 个）→ 灯具与光源摆放单

| id | 房间 | 类型 | 位置 (x, z) | 高度 (m) | 色温 (K) | 回路 | 备注 |
|---|---|---|---|---|---|---|---|
| light_dining_pendant | living_dining | 吊灯 | (7.9, 3.45) | 2.8 | 3000 | dining | 餐桌吊灯天花出线（DEC-013，DEC-021 随餐桌，DEC-034 餐桌靠客卫东墙后随移至桌心），单独回路，开关在餐桌旁墙上h1.3，距桌面75cm |
| living_track_main | living_dining | 明装轨道灯 | (10.8, 7.15) | 2.8 | 3000 | living_base | 一条黑色明装约2.8m短轨、4灯头，客厅基础光回路；无新增吊顶/电视背景墙 |
| light_tv_strip | living_dining | 灯带 | (7.2, 7.7) | 2 | 3000 | tv_ambient | 电视墙灯带（沿西墙 z5.8-8.2，电源 sock_living_tv_led 已有，DEC-013） |
| light_master_dome | master_bedroom | 吸顶灯 | (2.6, 7.6) | 2.8 | 3000 | — | 主卧吸顶灯 |
| light_master_wall_l | master_bedroom | 壁灯 | (4.2, 7.2) | 1.6 | 3000 | — | 主卧床头壁灯左（东墙随床头，黄铜壁灯方向；灯光升级待决策项） |
| light_master_wall_r | master_bedroom | 壁灯 | (4.2, 8.55) | 1.6 | 3000 | — | 主卧床头壁灯右（东墙随床头） |
| light_parent_dome | study | 吸顶灯 | (5.7, 7.675) | 2.8 | 3000 | — | 父母房吸顶灯 |
| light_child_dome | bedroom_nw | 吸顶灯 | (4.1, 2.7) | 2.8 | 3000 | — | 西北次卧吸顶灯 |
| light_study_dome | bedroom_se | 吸顶灯 | (14.9, 7.125) | 2.8 | 3000 | — | 书房吸顶灯（2026-08-27 房间南缘凹进至 z=8.70 后居中） |
| light_corridor_1 | living_dining | 筒灯 | (7.9, 5) | 2.8 | 3000 | entry_base | 走廊口筒灯嵌入既有 ceiling_living 边吊，不新增吊顶；坐标由原 (7.9,5.75) 调整至既有边吊合法范围 (7.9,5.0)，避开电视高柜 x≤7.55，并仍靠近原走廊口 |
| light_entry_down | entry_garden | 筒灯 | (13, 1.45) | 2.8 | 3000 | entry_base | 玄关筒灯 |
| light_entry_foyer | living_dining | 筒灯 | (12.4, 3.35) | 2.5 | 3000 | entry_base | 室内玄关门厅（门厅吊顶跨 entry_garden/living_dining 过渡带），不是入户花园；利用既有门厅吊顶，不新增吊顶/背景墙；位于红框中心附近，避让玄关半高柜与入户门开启区 |
| light_kitchen_panel | kitchen | 吸顶灯 | (9, 1.2) | 2.8 | 4000 | — | 厨房平板灯（4000K 工作区例外） |
| light_mbath_panel | master_bath | 吸顶灯 | (1.3, 1.98) | 2.8 | 4000 | — | 主卫平板灯（4000K；2026-08-25 隔墙北移 z=2.86 后移至卫内中心 z=1.98） |
| light_gbath_panel | guest_bath | 吸顶灯 | (6.35, 2.78) | 2.8 | 4000 | — | 客卫平板灯（4000K；2026-08-29 按南马桶/北淋浴分区调整至内卫中部，待量房确认） |

### 后续深化预留（当前未实施点位）
厨房台面/柜底灯、主卫/客卫镜前灯、父母房床头灯、书房桌面灯均为后续深化预留/现场确认项，不属于当前已实施灯光点位。主卧南床头梳妆台的镜前灯为家具插接式部件，复用 `sock_master_bed_r`，不新增墙内灯位。

## 4. 玻璃幕/飘窗清单 → 玻璃材质（Low-E 微反）

| id | 类型 | 参数 | 备注 |
|---|---|---|---|
| west_curtain | 玻璃幕墙 | 高 2.8m | Low-E 微反玻璃 |
| kitchen_north_curtain | 玻璃幕墙 | 高 2.8m | Low-E 微反玻璃 |
| north_recess_curtain | 玻璃幕墙 | 高 2.8m | Low-E 微反玻璃 |
| living_south_curtain | 玻璃幕墙 | 高 2.8m | Low-E 微反玻璃 |
| south_east_curtain | 玻璃幕墙 | 高 2.8m | Low-E 微反玻璃 |
| master_bedroom_west_bay | 飘窗 | 深 1.1m / 台高 2.07m | 主卧西墙飘窗（z=5.55~8.80 直墙段） |
| master_bedroom_south_bay | 飘窗 | 深 1.1m / 台高 2.07m | 主卧南墙环幕飘窗（南缘 z=10.90） |
| study_south_bay | 飘窗 | 深 1.1m / 台高 2.07m | 父母房南墙飘窗（南缘 z=10.90，与主卧齐平） |
| bedroom_se_south_bay | 飘窗 | 深 1.1m / 台高 2.07m | 书房南向凸窗（南缘 z=11.05） |
| bedroom_nw_west_bay | 飘窗 | 深 1.1m / 台高 2.07m | 西北次卧西墙飘窗 |
| corridor_west_bay | 飘窗 | 深 1.1m / 台高 2.07m | 走廊西墙飘窗 |
| master_bath_west_bay | 飘窗 | 深 1.1m / 台高 2.07m | 主卫西北角飘窗 |
| bedroom_nw_north_bay | 飘窗 | 深 1.1m / 台高 2.07m | 西北次卧北墙飘窗（z=1.10 凹进段） |
| kitchen_north_bay | 飘窗 | 深 1.1m / 台高 2.12m | 厨房北墙飘窗（z=0 北缘） |

## 5. 太阳定位参数

- 地点：南宁 22.82°N, 108.37°E（UTC+8）
- 建议工况 A：8 月 17:30 西晒（检验玻璃幕/西墙眩光与掠射光）
- 建议工况 B：20:00 夜景（检验全屋 3000K 暖光氛围，厨卫 4000K）

## 6. Twinmotion 云端操作指引

### 地面（含人字拼 A/B）
- glb 内嵌贴图仅打底（程序化生成，质感非最终）；Library > **Materials > Wood** 搜 `herringbone` 可得带多版面+倒角的真人字拼，拖到地面节点即替换
- 直铺选浅胡桃色（#c49a6c 方向）柔光木地板款；替换后对比人字拼/直铺，作为 DEC-011 门店终审前的云端证据

### 玻璃幕（5 段 curtain_run + 9 处飘窗）
- Library > **Materials > Glass** 拖至 `west_curtain` 等节点；Properties 里 reflectance 微升、tint 微绿 ≈ Low-E 微反质感
- 框料：导出为整片玻璃面，开发商幕墙的竖梃/横梁分格需手动补（Twinmotion 无自动分格），分格尺寸按现场照片
- **外景必须配**：Library > **HDRI environments** 选城市/天空款，否则玻璃无反射内容显假（"镜子+灰片"观感的根因）

### 回传审阅
- 底部 **Media > Image** 创建 4K 静帧（建议两工况各一张：17:30 西晒 / 20:00 夜景）→ Export 导出 PNG
- PNG 传回本地 `docs/renders/`（git 留档定妆历史），把文件路径发给 AI 逐张审阅并给调整建议
- 备选：Publish to **Twinmotion Cloud** 生成链接发给 AI（省事但不留档）
