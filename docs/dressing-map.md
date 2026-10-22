# 装扮映射表（材质/家具/灯光的外观替换映射）

生成：2026-10-22，数据源：materials.yaml / house.yaml furnishings / electrical.yaml / overlay.yaml / environment.yaml / data/current-scheme.json

数据规模：house.yaml furnishings 共 89 件（与 `fact.furnishings_count` 对账）。

用法：渲染时按本表替换材质/家具/灯光外观；节点名即映射键。渲染线现状（2026-10-22 批 2 审阅修复）：Twinmotion/Blender 线已退场（其验收文档已删除，历史见 git），现行定妆走 Web 渲染线（app/ Three.js）；本表只保留与渲染器无关的映射数据与外观意图，§6 为现行回传流程。

## 1. 房间/地面材料 → 渲染材质替换建议

| 主题 | 当前选择 | 名称 | 品牌/型号 | 规格 | 渲染替换建议 |
|---|---|---|---|---|---|
| floor | floor_tile_kt_200x1200_01 | KT 200×1200木纹长条砖（当前选型基准 2026-10-12） | KT / 200×1200mm 木纹砖（具体系列、型号、色号待门店确认） | 200x1200mm | 底色 #d8bd93，木纹·直铺，条板 200x1200mm，光泽 soft |
| floor | floor_tile_antislip_400 | 中性灰哑光防滑砖（主卫/阳台） | 马可波罗 / 快环同档 / 400x400 中性灰哑光防滑砖（防滑等级 R10+，型号待门店确认） | 400x400mm | 底色 #90949a |
| floor | floor_tile_deco_small | 复古小花砖（客卫点缀） | 快环建材市场花砖档口 / 200x200 复古釉面小花砖（花色到店选样） | 200x200mm | 底色 #b58a6f |
| wall | wall_tile_01 | 白色釉面墙砖/窗台砖候选 | 东鹏 / 300x600 白色釉面砖 | 300x600mm | 底色 #f5f5f5 |
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
| bed | bed_180_01 | 1.8m 实木床 | 本地家具厂 / 源氏木语 / 1.8×2.0m 中浅胡桃木细框架 + 暖米灰软包床头 | 1800×2000mm | 按实物选材替换 |
| mattress | mattress_180_01 | 1.8m 独立袋装弹簧床垫 | 喜临门 / 雅兰 / 20-25cm 独立袋装弹簧 + 乳胶 | 1800×2000mm | 按实物选材替换 |
| wardrobe | wardrobe_240_01 | 2.4m 定制衣柜 | 本地全屋定制工厂 / 2.4×0.6×2.7m，平开门 | 2400×600×2700mm | 按实物选材替换 |
| wardrobe | wardrobe_180_01 | 1.8m 定制衣柜 | 本地全屋定制工厂 / 1.8×0.6×2.7m，平开门 | 1800×600×2700mm | 底色 #d8cbb2 |
| wardrobe | wardrobe_north_950_custom_01 | 主卧北墙950定制模块化衣柜（R8 active） | 本地全屋定制工厂 / 待核样 / 950×580×2800mm，三扇窄平开门+顶部固定木饰面门头，真正通顶；冷凝水管槽隐藏于顶部 | 950×580×2800mm | 底色 medium_light_walnut_warm_smoked_oak |
| wardrobe | study_seasonal_wardrobe_170_01 | 1.7m 模块化季节后台柜（书房） | 本地全屋定制工厂 / 宜家 modular 系列 / 1.70×0.55×2.40m 模块化组合柜，换季收纳 | 1700×550×2400mm | 按实物选材替换 |
| dresser | light_midcentury_dresser_01 | 轻中古六抽矮柜（主卧南侧窗带） | 林氏家居 / 源氏木语 / 本地家具厂（按中古款筛选） / 1.40×0.48×0.85m 六抽屉细腿矮柜，中古木色（与梳妆桌同族） | 1400×480×850mm | 按实物选材替换 |
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
| robot_vacuum | robot_vacuum_narwal_j6_01 | 云鲸 J6 上下水版 | 云鲸 / J6 上下水版 | 基站约410×433.5×198mm | 按实物选材替换 |

## 2. 家具体块清单 → 库家具替换参照

glb 中家具节点名为 `furniture:{room}:{type}:{index}`，体块尺寸即下表 width×depth（米）。

| 房间 | 类型 | 数量 | 宽×深 (m) | 摆位 (x, z) / 朝向 |
|---|---|---|---|---|
| master_bedroom | bed_180 | 1 | 1.8×2 | (3.2, 7.4) / 270° |
| master_bedroom | master_north_wall_wardrobe_950 | 1 | 0.95×0.58 | (2.45, 4.59) / 0° |
| master_bedroom | master_wardrobe_top_pelmet | 1 | 0.95×0.58 | (2.45, 4.59) / 0° |
| master_bedroom | master_bedside_cabinet_350_north | 1 | 0.38×0.35 | (4.01, 6.245) / 0° |
| master_bedroom | master_bedside_cabinet_350_south | 1 | 0.38×0.35 | (4.01, 8.555) / 0° |
| master_bedroom | mb_washbasin_cabinet | 1 | 1.05×0.5 | (0.575, 3.16) / 0° |
| master_bedroom | master_dressing_table | 1 | 0.9×0.45 | (0.425, 6.05) / 90° |
| master_bedroom | dressing_stool | 1 | 0.42×0.4 | (0.42, 6.05) / 90° |
| master_bedroom | master_hot_season_low_dresser | 1 | 1.4×0.48 | (1.05, 9.2) / 180° |
| master_bedroom | condensate_pipe_ac_outlet | 1 | 0.4×0.46 | (3.7, 5.1) / 0° |
| master_bedroom | mb_vanity_pvc_wardrobe_entry | 1 | 1.175×0.03 | (4.1, 4.62) / 0° |
| master_bedroom | mb_vanity_pvc_service_chase | 1 | 0.925×0.06 | (2.925, 4.62) / 0° |
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
| bedroom_nw | desk | 1 | 1.2×0.6 | (2.9, 2.1) / 90° |
| bedroom_nw | chair | 1 | 0.5×0.5 | (3.35, 3) / 270° |
| bedroom_nw | shelf | 1 | 0.8×0.4 | (3, 1.3) / 0° |
| bedroom_nw | mattress_150 | 1 | — | count-only（不在 glb，按实物补摆） |
| bedroom_nw | curtain_set | 1 | — | count-only（不在 glb，按实物补摆） |
| bedroom_nw | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| bedroom_se | wardrobe_180 | 1 | 1.8×0.6 | (15.25, 5.85) / 180° |
| bedroom_se | bed_150 | 1 | 1.5×2 | (15.35, 7.6) / 270° |
| bedroom_se | mattress_150 | 1 | — | count-only（不在 glb，按实物补摆） |
| bedroom_se | curtain_set | 1 | — | count-only（不在 glb，按实物补摆） |
| bedroom_se | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| study | desk | 1 | 1.2×0.6 | (4.5, 9.2) / 90° |
| study | chair | 1 | 0.5×0.5 | (5.1, 9.2) / 270° |
| study | study_seasonal_wardrobe_wall | 1 | 1.7×0.55 | (5.15, 5.825) / 0° |
| study | curtain_set | 1 | — | count-only（不在 glb，按实物补摆） |
| study | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| living_dining | wall_cabinet_tall | 1 | 1.35×0.35 | (7.375, 6.225) / 270° |
| living_dining | tv_wall_low | 1 | 2.1×0.4 | (7.48, 8) / 270° |
| living_dining | tv_65 | 1 | 1.45×0.25 | (7.42, 8) / 270° |
| living_dining | floor_lamp | 1 | 0.32×0.32 | (11, 9.35) / 0° |
| living_dining | plant_fiddle | 1 | 0.5×0.5 | (7.93, 9.18) / 270° |
| living_dining | sofa_3seat | 1 | 2.8×0.9 | (11, 7.7) / 270° |
| living_dining | coffee_table | 1 | 0.7×0.7 | (9.7, 7.7) / 0° |
| living_dining | entry_half_height_cabinet | 1 | 2×0.35 | (11.5, 4) / 90° |
| living_dining | dining_table | 1 | 1.4×0.8 | (9.8, 3.45) / 90° |
| living_dining | dining_chair | 4 | 0.45×0.45 | (9.125, 3) / 90°；(10.475, 3) / 270°；(9.125, 3.9) / 90°；(10.475, 3.9) / 270° |
| living_dining | fridge | 1 | 0.833×0.6 | (7.5025, 2.9865) / 270° |
| living_dining | waterbar_low_cabinet_800_preview | 1 | 0.8×0.42 | (7.43, 3.87) / 90° |
| living_dining | mijia_instant_dispenser_s1_preview | 1 | 0.106×0.312 | (7.47, 3.64) / 90° |
| living_dining | coffee_machine_em450 | 1 | 0.22×0.285 | (7.37, 4) / 90° |
| living_dining | curtain_set | 2 | — | count-only（不在 glb，按实物补摆） |
| living_dining | ceiling_light | 2 | — | count-only（不在 glb，按实物补摆） |
| kitchen | kitchen_cabinet_run | 3 | （体块无尺寸记录） | (7.86, 0.32) / 0°；(9.94, 0.32) / 0°；(10.48, 1.275) / 90° |
| kitchen | kitchen_countertop_bridge | 1 | 0.6×0.6 | (8.8, 0.32) / 0° |
| kitchen | dishwasher | 1 | 0.6×0.6 | (8.8, 0.3) / 0° |
| kitchen | gas_stove | 1 | 0.75×0.6 | (10.5, 1.5) / 90° |
| kitchen | range_hood | 1 | 0.9×0.5 | (10.5, 1.5) / 90° |
| kitchen | sink | 1 | 0.8×0.6 | (9.5, 0.3) / 0° |
| kitchen | water_heater | 1 | 0.36×0.16 | (7.3, 1) / 270° |
| kitchen | mijia_ro_purifier_1400g_under_sink_preview | 1 | 0.163×0.445 | (10.05, 0.32) / 0° |
| kitchen | cabinet_base | 5 | — | count-only（不在 glb，按实物补摆） |
| kitchen | cabinet_wall | 2 | — | count-only（不在 glb，按实物补摆） |
| kitchen | countertop_quartz | 5 | — | count-only（不在 glb，按实物补摆） |
| kitchen | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| master_bath | toilet | 1 | 0.4×0.6 | (2.275, 1.5) / 270° |
| master_bath | towel_set | 1 | 0.04×0.28 | (0.24, 2.23) / 0° |
| master_bath | exhaust_fan | 1 | 0.3×0.3 | (1, 2.7) |
| master_bath | shower_set | 1 | — | count-only（不在 glb，按实物补摆） |
| guest_bath | vanity | 1 | 0.7×0.5 | (6.79, 3.925) / 270° |
| guest_bath | toilet | 1 | 0.4×0.6 | (6.75, 3.05) / 270° |
| guest_bath | exhaust_fan | 1 | 0.3×0.3 | (6.35, 2.45) |
| guest_bath | robot_dock_gbath | 1 | 0.41×0.4335 | (6.823, 3.925) / 270° |
| guest_bath | faucet | 1 | — | count-only（不在 glb，按实物补摆） |
| guest_bath | shower_set | 1 | — | count-only（不在 glb，按实物补摆） |
| guest_bath | mirror_cabinet_gbath | 1 | — | count-only（不在 glb，按实物补摆） |
| guest_bath | heated_towel_rack | 1 | — | count-only（不在 glb，按实物补摆） |
| balcony | washer | 1 | 0.6×0.6 | (5.95, 1.5) / 90° |
| balcony | dryer | 1 | 0.6×0.6 | (5.95, 1.5) / 90° |
| balcony | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |
| entry_garden | garden_entry_station | 1 | 1.1×0.38 | (15.02, 1.35) / 270° |
| entry_garden | shoe_cabinet | 1 | — | count-only（不在 glb，按实物补摆） |
| entry_garden | ceiling_light | 1 | — | count-only（不在 glb，按实物补摆） |

## 3. 灯光点位（11 个）→ 灯具与光源摆放单

| id | 房间 | 类型 | 位置 (x, z) | 高度 (m) | 色温 (K) | 回路 | 备注 |
|---|---|---|---|---|---|---|---|
| light_balcony_dome | balcony | 吸顶灯 | (6.6, 1.15) | 2.8 | 4000 | — | 生活阳台感应吸顶灯（DEC-2026-10-17-R20 补齐：阳台此前无任何灯具/开关，furnishings 预算行无对应点位）：光控+人体感应双模、带常亮档，无墙面开关——东墙门洞 d_kit_balc 占 z[1.20,2.00]，剩余墙垛 0.30/0.10m 容不下 86 底盒；点位避晾衣架主机 (6.40,1.60) 吊顶占用；归 lighting_bedrooms_bath。height=2.8 判定依据：config/ceiling.yaml 与 config/layout/overlay.yaml 均未声明 balcony 吊顶分区（2026-10-17 复核），按原顶完成面落点。若后续阳台做铝扣板吊顶，height 随完成面同步下调 |
| light_dining_pendant | living_dining | 天花灯 | (9.25, 3.65) | 2.8 | 3000 | dining | 餐厅灯天花出线（DEC-2026-08-02-013、DEC-021、DEC-034 为历史随餐桌灯位）。DEC-2026-10-16-R12 曾将灯位修正至桌心 (9.80,3.45) 并将 type 改为 ceiling_light；DEC-2026-10-17-R8 按业主奶油云团灯参考图替换造型；DEC-2026-10-17-R9 按业主选择移至餐厅平顶范围几何中心 (9.25,3.65)，餐桌保持 (9.80,3.45)。主体尺寸取用户参数图，木球/吊线为主图比例视觉估值；电气安装高度仍为2.80m。点位 id、dining 单独回路、墙控 switch_dining（餐桌旁走廊墙 h1.3，DEC-2026-09-08-R1）和拓扑成员关系不变。灯到餐桌中心的水平偏移约0.585m；桌面照度目标150 lx/3000K/Ra≥90（100 lx为备选）须按实际 SKU 的3000K档光通量与配光核验，不能由商品标称3200lm或5–10㎡推定，见 schedule/procurement.md。 |
| light_living_dome | living_dining | 吸顶灯 | (10.8, 7.15) | 2.8 | 3000 | living_base | 客厅基础光吸顶灯（DEC-2026-10-13-R1 推翻 DEC-2026-08-26-043 的明装轨道灯：原顶条件下明装轨道①无吊顶可藏 1.95m 走线，只能明装线槽外露；②4 个可调灯头是点状配光，实测口径 U₀≈0，客厅一般活动 100 lx 要求 U₀≥0.7，原理上不满足；③轨道+加固板+可调头是三重可调冗余，业主从未要求过重点照明。改为贴原顶 2.80 安装的宽配光吸顶灯，光通量按 7,100–8,500 lm 选型）。出线沿用 strong-light-living 既有路由，出 ceiling_living 边吊后明装线槽沿原顶板面敷设至灯位（见 config/mep-hvac-coordination.yaml）。状态依据：归入 topology 回路 lighting_living_base（confirmed），客厅基础光吸顶灯为设计声明→inferred；位置为设计值未实测 |
| light_master_dome | master_bedroom | 吸顶灯 | (1.7, 6) | 2.8 | 3000 | — | 主卧吸顶灯（DEC-2026-10-13-R3 移位：原 (2.60,7.60) 落在 bed_180 平面投影内（床 AABB x[2.30,4.10]×z[6.47,8.33]），既正压床头眩光，又把房间最远的条带洗漱区甩到 3.91m/入射角 57°、照度仅灯正下方 1/6。移位至 (1.70,6.00)：房间开敞中部、避床/衣柜/梳妆桌/窗帘盒，到条带台盆 3.05m、到通顶衣柜 1.60m、到梳妆桌 1.28m；牺牲的是床面环境光，但 DEC-2026-10-12-R1 已把两盏床头壁灯改为小米床头灯插电，床头阅读/起夜本就不再依赖吸顶灯——三个功能缺口各有专属光源，吸顶灯只管一般照明，居中才是正确分工）。状态依据：归入 topology 回路 lighting_bedrooms_bath（proposed），主卧吸顶灯为设计声明→inferred；位置为设计值未实测 |
| light_parent_dome | study | 吸顶灯 | (5.7, 7.675) | 2.8 | 3000 | — | 书房吸顶灯（2026-10-05 功能互换，id/位置不变）；状态依据：归入 topology 回路 lighting_bedrooms_bath（proposed），书房吸顶灯为设计声明→inferred；2026-10-05 功能互换位置不变，为设计值未实测 |
| light_child_dome | bedroom_nw | 吸顶灯 | (4.1, 2.7) | 2.8 | 3000 | — | 西北次卧吸顶灯；状态依据：归入 topology 回路 lighting_bedrooms_bath（DEC-2026-10-03-R1，proposed），每室一吸顶灯为设计声明→inferred；位置为房间设计值未实测 |
| light_study_dome | bedroom_se | 吸顶灯 | (14.9, 7.125) | 2.8 | 3000 | — | 客房吸顶灯（2026-08-27 房间南缘凹进至 z=8.70 后居中；2026-10-05 功能互换，id/位置不变）；状态依据：归入 topology 回路 lighting_bedrooms_bath（proposed），客房吸顶灯为设计声明→inferred；位置随房间南缘凹进取居中，为设计值未实测 |
| light_corridor_1 | main_corridor | 筒灯 | (5.7, 4.9) | 2.5 | 3000 | entry_base | 历史旧位：坐标由原(7.9,5.75)调整至既有ceiling_living范围(7.9,5.0)，避开电视高柜x≤7.55并靠近走廊口；原点嵌入既有边吊、不新增吊顶；这些旧位理由和坐标由DEC-2026-10-15-C02覆盖。当前点：因距餐厅下出风槽投影边约75mm，迁至主走廊中段(5.70,4.90)，嵌入ceiling_main_corridor吊底y=2.50；归入lighting_entry_base的回路与开关控制拓扑保持，线路同步协调。开孔、上方风管/梁/冷媒/冷凝水/桥架与龙骨净距待现场复核；坐标是设计候选值，未实测。状态依据：lighting_entry_base回路confirmed，当前灯位为业主明确确认的预演位置。 |
| light_entry_down | entry_garden | 筒灯 | (13, 1.45) | 2.8 | 3000 | entry_base | 玄关筒灯；状态依据：归入 topology 回路 lighting_entry_base（confirmed），玄关筒灯为设计声明→inferred；位置为设计值未实测 |
| light_entry_foyer | living_dining | 筒灯 | (12.4, 3.35) | 2.5 | 3000 | entry_base | 室内玄关门厅（门厅吊顶跨 entry_garden/living_dining 过渡带），不是入户花园；利用既有门厅吊顶，不新增吊顶/背景墙；位于红框中心附近，避让玄关半高柜与入户门开启区；状态依据：归入 topology 回路 lighting_entry_base（confirmed），门厅筒灯利用既有吊顶为设计声明→inferred；取红框中心避让半高柜与入户门，位置为设计值未实测 |
| light_kitchen_panel | kitchen | 吸顶灯 | (9, 1.2) | 2.65 | 4000 | — | 厨房平板灯（4000K 工作区例外）；height=2.65 对齐 ceiling_kitchen 铝扣板吊顶完成面（DEC-2026-10-17-R12：安装完成面即吊顶底，原 2.8 与吊顶分区声明矛盾）；状态依据：归入 topology 回路 lighting_bedrooms_bath（DEC-2026-10-03-R1，proposed），厨卫 4000K 平板灯为设计声明→inferred；位置为设计值未实测 |

### 后续深化预留（当前未实施点位）
厨房台面/柜底灯、主卫/客卫镜前灯、父母房床头灯、书房桌面灯均为后续深化预留/现场确认项，不属于当前已实施灯光点位。主卧南床头梳妆台的镜前灯为家具插接式部件，复用 `sock_master_bed_r`，不新增墙内灯位。

**已取消、不再纳入装扮**：电视墙灯带（DEC-2026-10-13-R5，业主裁定「不搞了」）。点位与整条照明回路已从 config 删除，**不要**在渲染里摆这条灯带。取电插座 `sock_living_tv_led` 保留在电视墙，后期想要氛围光走插电式灯带挂该插座即可，零预埋零开槽。

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
| study_south_bay | 飘窗 | 深 1.1m / 台高 2.07m | 书房南墙飘窗（南缘 z=10.90，与主卧齐平） |
| bedroom_se_south_bay | 飘窗 | 深 1.1m / 台高 2.07m | 客房南向凸窗（南缘 z=11.05） |
| master_bath_west_lower_bay | 飘窗 | 深 1.1m / 台高 2.07m | 主卫西墙南段飘窗（2026-10-09 由 bedroom_nw_west_bay 改名，DEC-2026-10-09-P10：原名「西北次卧西墙」与几何不符——outline x[0,1.1]×z[2.10,2.86] 整块在 master_bath 矩形内，bedroom_nw 西界是 x=2.6。只改 id 不动几何/面积/room） |
| master_bedroom_west_mid_bay | 飘窗 | 深 1.1m / 台高 2.07m | 主卧西墙中段飘窗（2026-10-09 由 corridor_west_bay 改名，DEC-2026-10-09-P10：原名「走廊西墙」与几何不符——outline x[0,1.1]×z[2.86,5.55] 整块在 master_bedroom 矩形内，且模型里根本没有 corridor 这个 room，走廊本体在 x[4.2,7.2]×z[4.3,6.45]，离这扇窗 4 米。只改 id 不动几何/面积/room） |
| master_bath_west_bay | 飘窗 | 深 1.1m / 台高 2.07m | 主卫西北角飘窗 |
| bedroom_nw_north_bay | 飘窗 | 深 1.1m / 台高 2.07m | 西北次卧北墙飘窗（z=1.10 凹进段） |
| kitchen_north_bay | 飘窗 | 深 1.1m / 台高 2.12m | 厨房北墙飘窗（z=0 北缘） |
| living_south_waterproof_ledge | 飘窗 | 深 0.15m / 台高 0m | 客厅落地幕墙根部防水台（150 高 × 150 出檐常规口径，量级待量房核实）；竖面与水平台面由 sill_region 挂贴砖 |
| mbath_west_lower_waterproof_ledge | 飘窗 | 深 0.15m / 台高 0m | 主卫西墙淋浴段（z[2.10,2.86] 直段）根部防水台，D4=L 同款 150×150 |
| mbath_north_waterproof_ledge | 飘窗 | 深 0.15m / 台高 0m | 主卫北墙（x[0,2.60]，西段在淋浴湿区内）根部防水台，D4=L 同款 |
| master_bedroom_west_upper_waterproof_ledge | 飘窗 | 深 0.15m / 台高 0m | 主卧西墙上段落地幕墙根部低反坎；150×150mm估算，front+top贴砖，量房后复核（DEC-2026-10-16-TILE-01） |
| master_bedroom_west_mid_waterproof_ledge | 飘窗 | 深 0.15m / 台高 0m | 主卧西墙中段落地幕墙根部低反坎；150×150mm估算，front+top贴砖，量房后复核（DEC-2026-10-16-TILE-01） |
| master_bedroom_south_waterproof_ledge | 飘窗 | 深 0.15m / 台高 0m | 主卧南墙落地幕墙根部低反坎；150×150mm估算，front+top贴砖，量房后复核（DEC-2026-10-16-TILE-01） |
| study_south_waterproof_ledge | 飘窗 | 深 0.15m / 台高 0m | 书房南墙落地幕墙根部低反坎；150×150mm估算，front+top贴砖，量房后复核（DEC-2026-10-16-TILE-01） |
| bedroom_nw_north_waterproof_ledge | 飘窗 | 深 0.15m / 台高 0m | 西北次卧北墙落地幕墙根部低反坎；150×150mm估算，front+top贴砖，量房后复核（DEC-2026-10-16-TILE-01） |
| bedroom_se_south_waterproof_ledge | 飘窗 | 深 0.15m / 台高 0m | 东南客房南墙落地幕墙根部低反坎；150×150mm估算，front+top贴砖，量房后复核（DEC-2026-10-16-TILE-01） |

## 5. 太阳定位参数

- 地点：南宁 22.82°N, 108.37°E（UTC+8）
- 建议工况 A：8 月 17:30 西晒（检验玻璃幕/西墙眩光与掠射光）
- 建议工况 B：20:00 夜景（检验全屋 3000K 暖光氛围，厨卫 4000K）

## 6. 渲染与回传指引（现行）

### 地面（含人字拼 A/B）
- glb 内嵌贴图仅打底（程序化生成，质感非最终）；人字拼须用带多版面+倒角的真人字拼材质，不得以直纹贴图冒充，拖到地面节点比对版面
- 直铺选浅胡桃色（#c49a6c 方向）柔光木地板款；替换后对比人字拼/直铺，作为 DEC-011 门店终审前的证据

### 玻璃幕（5 段 curtain_run + 9 处飘窗）
- 玻璃节点（`west_curtain` 等）质感目标：反射率微升、微绿着色 ≈ Low-E 微反
- 框料：导出为整片玻璃面，开发商幕墙的竖梃/横梁分格需手动补，分格尺寸按现场照片
- **外景必须配**：城市/天空环境，否则玻璃无反射内容显假（"镜子+灰片"观感的根因）

### 回传审阅
- 静帧建议两工况各一张：17:30 西晒 / 20:00 夜景（见 §5 太阳定位参数），4K 导出 PNG
- PNG 先放本地 `tmp/capture/`（过程图不进 git，批 0 铁律）；定稿每视角 ≤1 张随对应 design-iterations 轮次的 evidence 留档，再把文件路径发给 AI 逐张审阅并给调整建议
- 已退场的 Twinmotion Cloud 发布链路不再使用
