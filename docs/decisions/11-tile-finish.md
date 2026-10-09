# 决策日志 · 贴砖 · 饰面

> 本文件是 `docs/decision_log.md` 2026-10-09 主题拆分（DEC-2026-10-09-S01）的产物：
> 收录范围 = 墙砖收口与复算更正、贴砖检视态、贴砖范围终裁、「带+漆」饰面终裁、杂砖概念废止。条目为原文件的连续切片，正文未改写；文件内按时间正序。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-06-TILE-01` 干区窄长木纹砖双方案预演
- `DEC-2026-10-07-C14` 客卫饰面终裁："带+漆"——干区乳胶漆 + 台盆防溅带 + 淋浴砖到顶（推翻通高砖建议基线）
- `DEC-2026-10-07-C15` 厨房贴砖按 E2 贴满落地：三面可贴墙 0.90m 建议基线升至吊顶完成面 2.65
- `DEC-2026-10-07-C16` 主卫饰面终裁：与客卫 C14 同口径"带+漆"——淋浴南墙砖到顶 2.65，其余 0.30m 带 + 乳胶漆
- `DEC-2026-10-07-C17` 全宅幕墙玻璃均为落地窗（业主实地断言）：主卫湿区补 3 座防水台贴砖，干区存在不贴
- `DEC-2026-10-07-R05` PKG-060 墙砖收口：墙砖主材补科目 + 面积不减走杂砖 + 更正链
- `DEC-2026-10-07-R06` 墙砖收口复算更正（改判 R05）：改用 js-yaml 解析后查出 5 处错 + KT 报价分房错配
- `DEC-2026-10-07-R08` 贴砖检视态子系统落地：wall_region 元素类型 + 三层独立开关 + 预算同源
- `DEC-2026-10-07-R09` 贴砖系统独立审计面：状态摘要 + 逐段明细 + 开启播报
- `DEC-2026-10-07-R10` 贴砖/HVAC 相互隔离的行为级证明（补 R08/R09 的实证）
- `DEC-2026-10-07-R11` 贴砖范围业主质询终裁：杂砖带保留 + 灶台挡水条 + 生活阳台 + room 脸语义
- `DEC-2026-10-08-C18` 废止杂砖概念：D2「遮蔽面走杂砖」条款撤销，全屋贴砖统一正砖
- `DEC-2026-10-08-C19` 下架「墙砖方案」贴图预览：贴砖的唯一视觉口径为贴砖检视态

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-10-06-TILE-01 干区窄长木纹砖双方案预演

- **业主决定**：地面方向改为窄长木纹砖，KT 200×1200 与金意陶约 900×150 两款都做效果和成本比较，暂不选定具体产品；本轮按直铺错缝、相同中性浅暖木纹占位外观比较砖幅与缝线。原 600×1200 木纹砖保留为上轮设计基线，不再视作窄长砖采购定标。
- **比较边界**：先比较几何解析的六个干区；业主随后确认主卫、客卫与厨房墙砖也要作为两店新设计方案一起比较。生活阳台在两店清单中未明确列项，仍作现行基线并记录报价缺项。入户花园不计新铺。两款门店花色、釉面、版面数和实际 SKU 均未核验，渲染不可代替门店样板。
- **成本口径**：六个干区净铺 111.864㎡；沿用材料预算 8% 计划损耗。KT 同面积预估 504 片、主砖 ¥14,616；金意陶按约数 900×150 暂估 895 片、主砖 ¥15,931。分别保留门店原报 516 片／¥14,964 与 970 片／¥17,266，不把报价片数写回几何。人工、辅材、加工、配送、税费和美缝单列，未知不作零元。
- **产物与下一关口**：两款独立材料候选、只读成本比较与同机位示意图见 `config/materials.yaml`、`config/tile-comparison.yaml`、`schedule/procurement.md` 和 `docs/design-iterations/tile-plank-comparison-20261006/evidence/`。两张原始手写报价照已归档；KT 主客卫/厨墙按报价中可读规格作占位比较。业主允许对金意陶原图作**标不确定性的推演**：③的48片约400×400砖名义面积7.68㎡，接近两卫现行净地面合计7.726㎡，可用作两卫地面效果假设；②④可能是卫浴墙面但规格和房间归属不明，①用途不明。推演不得写回原报价事实字段或作为定标依据。店家提供实际 SKU、样板、箱规、逐房净面积及全安装报价后，业主再决定最终默认材料；本轮不改 `data/current-scheme.json`。

### DEC-2026-10-07-C14 客卫饰面终裁："带+漆"——干区乳胶漆 + 台盆防溅带 + 淋浴砖到顶（推翻通高砖建议基线）

- **日期**：2026-10-07。触发：业主对照外部建议逐条核实后裁定"采纳修正版"。
- **背景**：客卫开放洗漱区（南侧 z[3.55,4.30]，与内卫湿区以玻璃隔断分隔）的饰面此前悬空——房间级 Finish 意图（`house.yaml wall_finish: tile`）与分段预算口径（D1=A：淋浴 1.8m/其余 0.3m）两套口径打架，"防水带以上是什么"从未被任何 D 项覆盖；渲染端 TileTopic 按 tile 房间整墙刷砖，造成"通高砖"的预览假象。外部建议的"干区漆面 + 台盆后防溅板"框架与本项目控制源核实结果一致，业主采纳修正版。
- **决策**（四件套）：① `house.yaml` 客卫 `wall_finish: 'tile'→'paint'`；② `overlay.yaml` 客卫淋浴两段（`walltile_gbath_north_shower` / `walltile_gbath_east_shower`）height 1.80→**2.65**（砖到铝扣板吊顶完成面，含未来北墙窗洞收口；窗洞扣减量房后按实计）；③ 台盆后新增防溅带 `walltile_gbath_east_vanity_splash`（`w_gbath_east_open_vanity` along[0,0.75] bottom 0.77→height 1.10，visible 正砖，与镜柜下沿 1.10 齐平——台上盆+壁挂龙头（底座 0.84）溅水面口径，修正外部建议"300-600mm"的通用值）；④ 漆面声明补客卫 4 段（由 `tmp/gen-paint-regions.ts` 产出 5 段、人工剔除北墙整面淋浴砖 1 段；`w_gbath_east` 掐掉淋浴区间 [0,0.55]）。
- **前提与硬线**：暗卫漆面风险以北墙外窗（业主已实地确认非承重，量房后开洞报备）为解除前提；淋浴区砖到顶是唯一不让步项——1.8m 线以上漆面会被蒸汽常年冲刷。马桶区/开放洗漱区 0.30m 砖带 + 上部耐水腻子/封闭底漆/防潮乳胶漆（做法进施工交底，`paint_region` 只管面积口径）。
- **已知口径误差（记录在案，不静默）**：0.30m 砖带与 0.77→1.10 防溅带在漆面声明高度内部分重叠约 1.34㎡（漆按桶采购内吸收，声明与独立复算两侧同按整面计、对账相消）；3D 墙面为房间/面级材质，表达不了半墙砖带——防溅带只进预算与贴砖检视态，正常视图不显示；内隔墙 `w_gbath_south` 两脸（约 5.5㎡ 含门洞）待 paint-scope 支持同房间内隔墙双脸后增补。
- **数字变化**：墙砖 16→**17 段**、客卫砖 4.785→**6.775㎡**（总贴砖 15.333→**17.323㎡**）；漆面 22→**26 段**、毛面 155.652→**165.872㎡**、净面 142.422→**152.642㎡**、顶面 103.224→**106.374㎡**（客卫 footprint 含开放洗漱带 3.15㎡）、净计费 245.646→**259.016㎡**；涂装科目 actual 7447.02→**7852.10**；2 遍+扣洞情景 10781.15→**11115.40**（vs 计划 11500 转为 -384.60）；多乐士整包报价 13510.53→**14245.88**。相关测试基线（wall-tile / paint-scope / paint-comparison-api）同轮更新。
- **同轮顺带**：`walltile_gbath_west_open_vanity` zone covered→visible（可见面正砖）纠错——原 covered 系 R08 建档时自东墙柜后段误复制，该墙正对洗漱位无遮蔽。
- **关联文件**：`config/house.yaml`、`config/layout/overlay.yaml`、`tmp/gen-paint-regions.ts`、`tests/server/wall-tile-inspection.test.ts`、`tests/server/paint-scope.test.ts`、`tests/server/paint-comparison-api.test.ts`、`docs/decisions/11-tile-finish.md`（本条）。
- **决策人**：业主。

### DEC-2026-10-07-C15 厨房贴砖按 E2 贴满落地：三面可贴墙 0.90m 建议基线升至吊顶完成面 2.65

- **日期**：2026-10-07。触发：业主看贴砖统计后质询「厨房西面不应该通铺瓷砖吗」——与 R05/R11 已裁的 E2 相印证，属决策已定、声明未跟上。
- **背景**：E2（`decision_log` 1806，R05 裁定、R11 复核未变）：餐厅无实体墙可贴，**把厨房三面可贴墙（≈3.60m）贴满，透过推拉门形成连续砖面**。但 R08 建的 `wall_region` 声明按 D1=A 防水口径停在 0.90m 建议基线（overlay 注明「高度与 zone 均为 D1/D7 裁定前的建议基线」），E2 一直未落到声明层——客卫饰面终裁（C14）暴露了同一类「房间级意图 vs 分段声明」打架，厨房是它的镜像案例。
- **决策**：三段升至 2.65（厨房铝扣板吊顶完成面，与两卫同口径）：东墙 `w_ent_west` 2.40m（covered，柜墙暂整段记杂砖）、西墙实墙段 `w_vrv_east` 1.00m（**visible 正砖**，无橱柜）、西墙南端残段 `w_kit_west` 0.20m（covered，冰箱位背墙）。`w_balc_east` 1.20m **不贴满**（阳台门洞 0.80m 占大半，不在 E2 三面范围内），维持 0.90m 杂砖带（辅助台面防溅口径）。E2 的「入户门厅 0.50m 过渡段收口」暂不落（「可」字选项；落它需删 `paint_living_dining_w_ent_west` 漆面段 1.4㎡，与门厅收口终裁一起做）。
- **已知口径误差（D7 待收口）**：东墙整段记杂砖是把「吊柜以上可见带」保守算进了遮蔽面——吊柜包络未定（D7），落定后应拆出 2.2→2.65 可见正砖带；残段同（冰箱高柜顶上是否可见）。
- **数字变化**：厨房贴砖 4.77→**11.07㎡**（正砖 1.35→3.10 / 杂砖 3.42→7.97）；全屋贴砖 17.323→**23.623㎡**。高度分档：2.65m×5（客卫淋浴 2 + 厨房 E2 3）、0.90m 只剩阳台门段 1 段。声明仍 17 段 / 19 网格。
- **关联文件**：`config/layout/overlay.yaml`、`tests/server/wall-tile-inspection.test.ts`、`tmp/tile-report.ts`、`docs/decisions/11-tile-finish.md`（本条）。
- **决策人**：业主（质询确认）；E2 原裁 2026-10-07 R05。

### DEC-2026-10-07-C16 主卫饰面终裁：与客卫 C14 同口径"带+漆"——淋浴南墙砖到顶 2.65，其余 0.30m 带 + 乳胶漆

- **日期**：2026-10-07。触发：业主问「卫生间都通铺了吗」并裁定「主卫跟客卫一样的」。
- **背景**：主卫是全屋最后一个"渲染假象 vs 账面错位"的房间——`house.yaml wall_finish: tile` 让渲染整墙刷砖，声明/预算却停在 D1=A 建议基线（3.11㎡ 防水带，淋浴南墙仅 1.80m 未到顶）。C14 修复客卫时已指出主卫是同构案例。
- **决策**：① `house.yaml` 主卫 `wall_finish: 'tile'→'paint'`；② 淋浴南墙 `walltile_mbath_south_shower` height 1.80→**2.65**（砖到顶硬线；西/北墙玻璃幕墙不贴，砖面止于玻璃碰接）；③ 漆面补主卫 2 段（`w_mbath_east` [0,1.76] 全段 + `w_mbath_south` 掐掉淋浴到顶跨后 [1.20,2.60]，门洞 d_mbath [1.15,1.95] 跨内部分拆洞实扣）。主卫有玻璃幕墙采光，"带+漆"前提天然成立，无台盆防溅带需求（台盆已外移主卧条带）。
- **数字变化**：贴砖 23.623→**24.643㎡**（淋浴段 1.20×0.85=+1.02）；高度分档 2.65m×**6**（两卫淋浴 3 + 厨房 E2 3）、1.80m 档消失；漆面 26→**28 段**（7 房）、毛面 174.720㎡、门洞占位 13.23→**14.805**（主卫门跨内 1.575）、净面 159.915㎡、顶面 106.374→**110.95**（主卫 footprint 4.576）、净计费 259.016→**270.865㎡**；涂装科目 actual 7852.10→**8212.10**；2 遍+扣洞 11411.63（vs 计划 -88.37，几近持平）；毛口径情景桶数 5+3→**6+3**；多乐士整包 14897.58。相关测试基线（wall-tile / paint-scope / paint-comparison-api）同轮更新。
- **待量房项**：主卫西墙/北墙玻璃根 sill 未定（邻户图与 R11 逐窗核对双空白），已登记量房清单 **#54**——齐地幕墙则按 D4=L 补 `bay_sill`+`sill_region`，高窗台系则根下实体墙须补淋浴湿区贴砖声明，两分支都要动主卫西墙。
- **关联文件**：`config/house.yaml`、`config/layout/overlay.yaml`、`tests/server/wall-tile-inspection.test.ts`、`tests/server/paint-scope.test.ts`、`tests/server/paint-comparison-api.test.ts`、`tmp/mbath-numbers.ts`、`docs/decisions/11-tile-finish.md`（本条）。
- **决策人**：业主。

### DEC-2026-10-07-C17 全宅幕墙玻璃均为落地窗（业主实地断言）：主卫湿区补 3 座防水台贴砖，干区存在不贴

- **日期**：2026-10-07。触发：业主三次申明「落地窗都有防水台」并在出示逐窗 sill 推断表后最终裁定「是落地窗，都是落地窗」。
- **裁决**：业主实地依据（样板间/选房观察）优先于邻户图的 LH 推断读法——「sill≈2.07 系」（#20，推断值、本待量房）被业主断言推翻；邻户图 LH/LW 改判疑为**开启扇/上光带尺寸**而非玻璃边（760mm 高的窗带在幕墙上不合常理，读法存疑但不删除历史记录）。幕墙玻璃均按**齐地落地窗**处理，玻璃根防水台按业主规则全宅存在。
- **落地范围（湿区优先）**：主卫按 D4=L 同款新增 2 座 bay_sill——西墙淋浴直段（w_west_lower 0.76m）+ 北墙（w_bath_north 2.60m），150 高 × 150 出檐常规口径；sill_region 4 段（front+top）共 3.36m × 0.30 = **1.008㎡ 正砖**。西墙北段 w_west_ap（1.00m，端点 v_bath_nw 带圆角）合并器不产弧段线，不入声明、留现场收口（量房 #54）。干区（主卧/书房/客房/儿童房/厨房）防水台**存在但不建模不贴砖**——干区无防水驱动，贴砖属美学选项待业主日后逐间决定；厨房北幕墙根在地柜后不可见。
- **顺带修复（App 链路静默丢防水台的存量 bug）**：`SceneBuilder` sill_region 分支原需在墙表查 bay_sill 引用的墙，而 App 的墙表不含被 suppress 的玻璃幕墙——**客厅防水台自 R11 起在浏览器里从未渲染过**（测试未抓到：测试自己喂了完整墙表）。改为优先直用 bay_sill 自带 wallRefs 坐标、仅裸引用回退墙表，浏览器 23 网格实建验证。
- **数字变化**：贴砖声明 sill_region 2→**6 段**、全屋 24.643→**25.651㎡**（主卫 4.13→**5.14**）；高度档 0.15m×6；网格 21（浏览器侧 17→23 含此前缺失的客厅防水台）。COST-060-08 planned 800→**871**；PKG-060 need 43,300→**43,371**、缺口 13,300→13,371；全局 known pending gap 34,594→**34,665**（control.yaml/budget.md/procurement.md 三处同步）。
- **登记翻转**：#20（全屋飘窗 sill）改判 owner_asserted——儿童房衣柜降高/主卧斗柜 h<2.07 等由高窗台推断派生的约束**随之作废**，相关家具 v0 候选（床尾凸窗带可站人性）需重新评审；#54 分支收敛为①（齐地），量房终核反坎实存与尺寸，若量出高窗台系则回滚声明改补西墙墙砖。
- **关联文件**：`config/layout/overlay.yaml`、`schedule/phase-1/control.yaml`、`schedule/phase-1/budget.md`、`schedule/procurement.md`、`docs/pending-site-data.md`（#20/#54）、`tests/server/wall-tile-inspection.test.ts`、`tmp/tile-report.ts`、`docs/decisions/11-tile-finish.md`（本条）。
- **决策人**：业主（实地断言）；量房 #20/#54 终核保留。

### DEC-2026-10-07-R05 PKG-060 墙砖收口：墙砖主材补科目 + 面积不减走杂砖 + 更正链

- **日期**：2026-10-07。触发：业主要求把厨房/餐厅墙面纳入瓷砖计算，并要求核算橱柜区域（"那些地方会去贴杂砖，开销不高"）。经 `model-geometry.yaml` 26 段墙逐一核查与两次业主质询后定案。
- **更正链（v2→v4，逐条记账）**：
  ① v2 称「厨房可贴墙长 8.40m（周长 12.00 − 北墙玻璃 3.60）」**作废**——误把 room boundary 的边当墙。厨房 **z=2.40 那 3.60m 不是墙**，是厨房→餐厅的四联动推拉门开口（`kitchen_dining_sliding_door`，吊轨至铝扣板下沿、无地轨）；x=7.20 的 z[1.0,2.2] 1.20m 亦无墙声明（`d_kit_balc` 门洞所在）。
  ② v2 称「KT 报价单口径不一致（厨房 0.86m vs 两卫 2.4m）」**作废**——反推分母用了错的 8.40m。用真实可贴 ≈3.60m 反推，KT 三室平均高度为 **2.06 / 2.35 / 2.40m，全部近通高，内部自洽**。
  ③ v2 称「餐厅可贴厨房南墙朝餐厅面 3.60m」**作废**——该面不存在。
  ④ v3 把橱柜遮蔽从面积里**扣掉**的建模**作废**——业主指出遮蔽面仍贴砖、走杂砖；改为**面积不减、材料分两档**。
- **厨房逐边核查（模型事实）**：可贴实体墙仅 **≈3.60m**——东墙 `w_ent_west` 2.40m（与入户门厅共墙）+ 西墙 `w_vrv_east` 1.00m + `w_kit_west` 残段 0.20m。北墙 `w_kit_north` 3.60m 已 `suppress_kitchen_north` 改玻璃幕墙，不可贴。
- **「餐厅要贴瓷砖」在当前模型无实体墙可贴**：客餐厅周长 27.20m 逐段判定——南墙 `w_liv_south` 6.20m 为 `suppress_liv_south` 落地玻璃幕；西墙 x=7.20 z[2.40,4.30] 无实体墙（DEC-2026-10-07-R01 已注明为 bulkhead 敞空阳角）；唯一可贴的是 `w_ent_west` 在 x=10.80 z[2.40,2.90] 的 **0.50m** 入户门厅过渡段。**裁定采用 E2：不新增构造，把厨房三面可贴墙（≈3.60m）贴满，透过推拉门形成连续砖面**；0.50m 过渡段可作收口一并贴上。E3（新造半墙）/ E4（恢复厨房南墙实体墙）均需另立设计迭代并推翻 DEC-2026-08-02-013 的三联动推拉门方案，不在本条范围。
- **面积不减 + 材料两档**：`COST-060-08` 按不减任何遮蔽计量；可见面用正砖，遮蔽面（橱柜后/柜内）走杂砖。**并明确"开销不高"只对主材成立**——人工、防水、辅材三项按全面积照付：人工依 `tile-comparison.yaml`「厨房大砖搭配杂砖铺贴时以大砖单价为准」；辅材依费率表砖背双组分背胶墙砖 ¥5/㎡、清理砖背脱模剂 ¥10/㎡；防水依 `budget-pitfalls.yaml` 按面积与涂刷遍数验收。遮蔽面区间 **5–7㎡**（厨房 3.8–5.4 + 客卫悬浮柜/J6 基站仓后 1.0–1.8 + 主卫≈0），精确值待 D7 收口。
- **新查出两项**：
  - **项目从未记录杂砖材料单价**——全库「杂砖」仅两条且**均为人工规则**（`tile-comparison.yaml:164`、`procurement.md:246`），`materials.yaml` 无杂砖/尾货条目。本条**不编杂砖单价**，遮蔽面单列并标 `待门店核价`。
  - **厨房橱柜布局 DEC 已过时且自相矛盾**——`procurement.md` §05 同一段既写"北墙水槽与切配"，又写"北墙玻璃幕墙不得作为挂载墙"；而 `suppress_kitchen_north` 已删除北墙实体。DEC-2026-08-02-013/014 时代的「L 型地柜 5.0m = 北墙 3.6 + 东墙 2.2」随北墙改幕墙作废。**遮蔽面究竟在哪几面墙取决于此，故列 D7 待收口。**
- **金意陶厨房墙砖行判不可用**：`厨房墙砖约40片 @¥36 = ¥1,440`，`dimensions_status: unspecified`、`estimated_area_sqm: 10`；10㎡ ÷ 3.60m = **2.86m，已超厨房净高（铝扣板完成面 2.65m）**，不可能同时成立。KT 66 片 ¥4,488 为近通高口径且内部自洽，保留为 B 档主材参照（只含主材，不含人工辅材）。
- **金额**：PKG-060 `estimated_need_cny` 42,500 → **43,100**。拆分口径见下（**本处与计划书 §8「43,800–44,000」不同，是有意为之**：计划书把墙砖人工与辅材一并计入 need，但 `COST-060-04`（瓦工预算池 18,500）的名义锚点已含「卫生间墙砖 65 / 阳台墙砖 80 / 厨房大砖混贴 90 元/㎡」，`COST-060-05` 亦为增项池，二者再计即双计；故 need 只加**主材**，人工与辅材改为在 note 中显形作为 `pending #34` 的输入）。
- **D1–D7 按计划书建议值入账（均待业主在量房与门店核价后确认）**：D1=A 防水高度（淋浴区 1.8m / 其他 0.3m，与 `budget-pitfalls.yaml` 防水口径对齐）；D2=不减面积+杂砖；D3=E2；D5=`wall_tile_01` ¥66.7/㎡；D6=量房后定（暂不减门洞）；D4=砖面止于玻璃碰接；D7=列入本条待收口。
- **COST-060-08 计值（建议基线，非承诺）**：可见面 ≈8.2㎡ × ¥66.7/㎡ × 1.05 ≈ ¥574 → 取整 **¥600**（`status: owner_decision_pending`）；遮蔽面 ≈3.2㎡ 杂砖单价待核，暂计 0 并显形。三档对照（`wall_tile_01`，主材+人工+辅材，不减门洞）：A ¥1,288–1,459 / B ¥4,757–5,341 / C ¥5,547–6,221。**A 与 B 差约 4 倍，这是本案唯一真正值钱的决定，项目此前从未裁定过贴砖高度。**
- **未动**：`COST-060-01` 的 20,000 cap、`COST-060-04` 的 18,500 预算池、`COST-060-02` 的 4,000 辅料均维持原值；地面选型与 PKG-060 缺口资金来源仍未决。PKG-060 `blockers: [BLK-SOUTH-BALCONY]` 不变；厨房橱柜布局收口挂在既有 `BLK-CABINET-FREEZE-FOR-MEP`（其 `clears_when` 已要求橱柜深化图与水电点位表双向核对）。
- **遗留**：① 贴砖高度 D1 待业主终裁；② 杂砖单价待门店核价；③ 遮蔽面 5–7㎡ 待厨房橱柜布局收口；④ 门口单/双包边待量房；⑤ 厨房防水是否已在 PKG-050 目标 3,000 内待核；⑥ B/C 口径下墙砖人工 ¥1,945–2,919 将实质占用 18,500 瓦工池，且地面若改木纹砖（人工 55→75 元/㎡）另吃掉约 ¥2,400 余量，两事均随 `pending #34` 一并向施工方确认。
- **执行口径对照（与计划书的有意分歧，已说明）**：计划书 §8 估 need 抬至 43,800–44,000（把墙砖人工与辅材一并计入）；本条只计 43,100（仅主材）。理由：`COST-060-04` 瓦工预算池 18,500 的名义锚点已含「卫生间墙砖 65 / 阳台墙砖 80 / 厨房大砖混贴 90 元/㎡」，`COST-060-05` 亦为增项池，再计即双计；人工与辅材改为在 `estimated_need_note` 中显形，作为 `pending-site-data #34` 的输入，不虚增 need。
- **D1–D7 状态**：均按计划书建议值入账，**全部待业主终裁**（D1 贴砖高度 / D2 不减+杂砖 / D3 E2 / D4 玻璃幕收口 / D5 wall_tile_01 / D6 量房后定 / D7 橱柜布局收口）。`COST-060-08` 状态为 `owner_decision_pending`，不是锁定价。
- **编号说明**：本条原拟编 R03，执行时发现并行工作已占用 DEC-2026-10-07-R03（客餐厅出风口线语言），故改号 R05；R04 为并行工作对 R01 的改判。
- **验证**：`verify:schedule` Exit 0（3 phases / 23 packages / **92 cost components**（新增 COST-060-08）/ 88 checks / ¥210,000 allocated / known pending gap 33,794 → **34,394**，净 +600）→ `schedule:render` 再生 budget.md/schedule.md/checklist.md → `verify:all` Exit 0（Spatial 0 error、点位专项 0 error、MEP lint 0 error / 79 warning、Electrical lint 0 error / 53 warning、ProjectRenderFacts verified、Lighting config verified）→ `verify:facts` OK（14 warnings，**全部为存量**：tile-comparison.yaml 的 11 条来自并行瓷砖工作、dressing-map DEC-011 引用歧义、house.yaml DEC-045 主题不符）→ `test:server` 649/649/0 fail → `typecheck` Exit 0。**本轮自查**：首次 `verify:facts` 因 `COST-060-08` 与 `estimated_need_note` 中的 `¥` 前缀金额（1,288/4,488/4,757/5,547）与小数面积（119.59/8.2/3.2/5.4/1.8 ㎡）触发 8 条 `unregistered_fact_occurrence`，已按项目约定（control.yaml 描述不写 `¥` 前缀、面积值改「平方米」）清零；`docs/decision_log.md` 与三份渲染产物本就登记在 `facts.yaml` 的 `exempt_occurrences` 中，不受影响。
- **关联文件**：`schedule/phase-1/control.yaml`（PKG-060、`COST-060-01/05/08`）、`docs/decisions/11-tile-finish.md`（本条）、`schedule/procurement.md` §09。
- **决策人**：业主。

### DEC-2026-10-07-R06 墙砖收口复算更正（改判 R05）：改用 js-yaml 解析后查出 5 处错 + KT 报价分房错配

- **日期**：2026-10-07。触发：业主问「3D 模型里我验收不出来贴砖，怎么知道你没算错？否则预算会算不对」。为此建立**独立只读复算脚本** `tmp/verify-wall-tile.ts`（在 `.gitignore` 的 `tmp/` 下，不入库），用**项目自带的 `js-yaml`** 解析 `model-geometry.yaml` / `overlay.yaml` / `materials.yaml` / `tile-comparison.yaml`，从四个权威源重算可贴墙长、KT 反推高度、墙砖单价折合、三档金额与 PKG-060/缺口，并与 R05 记录值逐条对账。**跑法：`npx tsx tmp/verify-wall-tile.ts`，退出码 0 = 全部一致。**
- **查出 R05 的 5 处错误（全部改判）**：
  ① 厨房可贴实体墙 3.60m → **4.80m**。漏计 `w_balc_east`（x=7.20, z[1.0,2.2], 1.20m）覆盖的那段——R05 断言「x=7.20 的 z[1.0,2.2] 无墙声明」是错的，`d_kit_balc` 门洞与该墙并存。
  ② 主卫可贴实体墙 6.12m → **4.36m**。漏计 `suppress_west_wall`——该 suppress 条目一次压制 `w_west_ap` / `w_west_lower` / `w_west_mid` / `w_west_upper` 四段，**主卫西墙（x=0, z[1.10,2.86], 1.76m）同为玻璃幕墙**，不可贴。
  ③ 客卫可贴实体墙 7.20m → **5.70m**。R05 用了原始周长，未扣南侧 z=4.30 的 1.50m 无墙开放边（`model-geometry` 已注明「南侧不封横墙」）。
  ④ R05 称「KT 报价单内部自洽」**作废**（见下）。
  ⑤ 三档金额全部重算（面积基准已变）。
- **根因（重要，不是偶然错）**：R05 及此前若干轮的可贴墙长来自**正则解析** `model-geometry.yaml`，而该文件的墙声明有**单行 flow 与多行 block 两种格式**，我的正则只匹配单行，漏掉了 `w_balc_east`、`w_mbath_south`、`w_west_ap`、`w_west_lower`、`w_bath_north` 等多行声明段（26 段 vs js-yaml 解析出的 **41 段**）；顶点正则也漏了带 `radius` 字段的 `v_bath_nw`。**这不是算错，是解析漏项**。改用项目自带 YAML 解析器后系统性消除，且脚本可被业主随时复跑。
- **KT 报价单分房错配（新发现，需回店重出）**：用真实可贴墙长反推——

  | 房间 | 可贴 | KT 报量 | 满铺上限 | 反推均高 | 判定 |
  |---|---|---:|---:|---:|---|
  | 厨房 | 4.80m | 7.20㎡ | 12.72㎡ | 1.50m | 上限内，但**少报** 5.52㎡ |
  | 主卫 | 4.36m | 14.40㎡ | 11.55㎡ | 3.30m | **超上限 2.85㎡（25%）**，片数不可能成立 |
  | 客卫 | 5.70m | 17.28㎡ | 15.11㎡ | 3.03m | **超上限 2.18㎡（14%）**，片数不可能成立 |
  | 主卫+客卫 | 10.06m | 31.68㎡ | 26.66㎡ | — | **合计超 5.02㎡（19%）** |

  三室合计：可贴 **14.86m**、全通高满铺 **39.38㎡**，KT 报 **38.88㎡**——**总量接近满铺、合理，但分房错配**（两卫报超、厨房报少）。KT 的口径因此判为「近全通高毛量，未扣玻璃幕墙 / 门洞 / 橱柜遮蔽」，且分房数字需门店按房重出。R05「KT 三室高度 2.06/2.35/2.40m 内部自洽」的结论随 ①② 作废。
- **更正后三档（`wall_tile_01`，不减门洞，损耗 5%，含人工 50–65 元/㎡ 与辅材 15 元/㎡）**：
  **A 防水高度**（厨房 0.9m / 湿区淋浴 1.8m 与其余 0.3m）面积 **12.21㎡** → 主材 855 / 人工 611–794 / 辅材 183 / **合计 ¥1,649–1,832**；
  **B 全通高满铺**（可贴 14.86m × 2.65m）面积 **39.38㎡** → **合计 ¥5,318–5,908**；
  **C 按 KT 报量**面积 38.88㎡ → **合计 ¥5,250–5,833**（但其分房超上限，不可直接采用）。
  A 与 B 仍差约 3.2 倍，**贴砖高度（D1）仍是本案唯一未裁大项**。
- **台账更正**：`COST-060-08` planned_cny 600 → **450**（A 档总面积 12.21㎡，其中遮蔽面约 5.8㎡ 走杂砖、单价待核暂计 0，可见面约 6.41㎡ × ¥66.7/㎡ × 1.05 ≈ ¥448 取整）；PKG-060 `estimated_need_cny` 43,100 → **42,950**；缺口 13,100 → **12,950**；全局 known pending gap 34,394 → **34,244**。`estimated_need_note` 与 `COST-060-08` 描述中的可贴墙长、三档金额同步改写。
- **未变**：D1–D7 仍按建议值入账、全部待业主终裁；厨房无南墙（z=2.40 是推拉门开口）、餐厅无实体墙可贴、E2（贴满厨房可贴墙靠视觉连续）、面积不减走杂砖、「开销不高」只对主材成立、项目无杂砖单价记录、厨房橱柜布局 DEC 过时——七项 R05 结论均经复算确认仍成立。
- **复算脚本自身的三处修正（留档）**：初版顶点正则漏 `v_bath_nw`（带 `radius` 字段）→ 已放宽；墙端点正则漏多行声明 → 改用 js-yaml；重叠算法误用 x/z 重叠相加（导致厨房东墙匹配到 x=15.25 的 `w_ent_east`）→ 改为共线判定 + 区间重叠 + 多墙接力求和。**脚本也要被验，已在产出结论前修完并用 `chk` 断言固化。**
- **遗留**：① D1 贴砖高度待业主终裁（A/B 差 ¥3,700–4,100）；② KT 分房报量需回店按房重出；③ 杂砖单价待门店核价；④ 遮蔽面 5–7㎡ 待厨房橱柜布局收口；⑤ 门口单/双包边待量房；⑥ 厨房防水是否在 PKG-050 目标内待核。
- **关联文件**：`tmp/verify-wall-tile.ts`（复算脚本，不入库）、`schedule/phase-1/control.yaml`（PKG-060、`COST-060-08`）。
- **决策人**：业主。

### DEC-2026-10-07-R08 贴砖检视态子系统落地：wall_region 元素类型 + 三层独立开关 + 预算同源

- **日期**：2026-10-07。触发：业主要求「贴砖区域做个开关，点击后用颜色透视出来」，并两次澄清「只是用 HVAC 举例，**贴砖面积展示应该是独立的**」「是 3D 开关，**希望独立展示，而不是跟 HVAC 共用一套开关、共用渲染机制**」。
- **选定实现**：方案甲——新增 `wall_region` 元素类型（`floor_region` 的垂直版），**不扩展** `wall_run`（后者语义是「有碰撞的真实半墙」，如 `vanity_screen_halfwall`；混入显示壳会让「是不是真墙」变含糊，正是 R05/R06 翻车的同类问题）。
- **「独立」的四层落地（结构性隔离，非约定）**：
  ① **层标签互斥**——检视层标签为 `'wall-tile'`；`setPipeChaseInspectionVisible` 的首行即 `if (object.userData?.inspectionLayer !== 'pipe-chase') return`，天然跳过本层，反之亦然。
  ② **重建不互毁**——HVAC 重建只清 `name === 'HVAC_CONFIRMED_ENTITIES'` 的子树；`wall_region` 网格由 `addOverlayElement(exportRoot, …)` 建在 overlay 树下，HVAC 怎么重刷都不影响。
  ③ **可见性函数独立**——新增 `setWallTileInspectionVisible(visible)`，只遍历 `'wall-tile'`；**不挂进 `setHvacCoordinationVisible`，也不调用 HVAC 路径**（v1 曾拟挂在 HVAC 开关上，按业主澄清已否弃）。
  ④ **渲染策略独立**——刻意不复用 pipe-chase 那段材质策略、**不抽共享 helper**（§6 选 A）：pipe-chase 的关闭分支把材质硬编码回默认值，会丢掉本层初始态；本层改为「建网格时把初始态写进 `userData.inspectionInitial` 快照，关闭时按快照恢复」，可逆。
- **视觉与交互**：inspection-only 叠加层——**正常视图完全不可见**；开关打开时显示为半透明双面垂直四边形（visible 正砖区蓝 `#3f7fbf` / covered 遮蔽区橙 `#d98c2b`，初始 opacity 0.38、检视态 0.55、renderOrder 100），并 **`depthTest = false` 做真透视**（同时顺带避开与墙体的共面 z-fighting，故无需侧向偏移）。关闭时按快照恢复初始态。
- **单源化（本条核心）**：贴砖范围从「从几何推导」改为 **`overlay.yaml` 的 `wall_region` 声明**，3D 检视态与 `COST-060-08` 预算读**同一份数据**。声明：3 室 **13 段、14.86m、12.213 ㎡**（厨房 4.80m / 主卫 4.36m / 客卫 5.70m），D1 按 A 档（厨房 0.90m / 湿区淋浴 1.80m / 其余 0.30m），按 `zone` 拆可见面 8.343 ㎡ 与遮蔽面 3.87 ㎡。
- **两层校验（`tmp/verify-wall-tile.ts`，不入库，业主可随时 `npx tsx tmp/verify-wall-tile.ts` 复跑，退出码 0 = 一致）**：
  - **L1 声明层**：读 overlay 的 `wall_region` → 面积 → 喂 `COST-060-08`。
  - **L2 交叉层**：从 `model-geometry.yaml` 独立复算，逐条断言——引用的墙存在、**未被 suppress**（主卫北墙 `suppress_north_recess`、西墙 `suppress_west_wall` 均为玻璃幕墙，故主卫仅 4.36m）、`along` 不越界、**同墙不重叠声明（防双计）**、`height` ≤ 净高 2.65m；并把「声明总长」与「独立推导可贴总长」对上。
  - 实测 18 条断言全 OK。**它当场抓出一处台账滞后**：声明算得 580 而台账仍是 450，已随之更正——这正是单源校验的价值。
- **台账随动**：`COST-060-08` planned_cny **450 → 580**（可见面 8.343 ㎡ × 66.7 元/㎡ × 1.05 ≈ 584 取整；遮蔽面 3.87 ㎡ 走杂砖、单价全库无记录暂计 0 并显形）；PKG-060 `estimated_need_cny` 42,950 → **43,080**；缺口 12,950 → **13,080**；全局 known pending gap 34,244 → **34,374**。
- **未触及（既定隔离）**：`config/tile-comparison.yaml`、`docs/design-iterations/tile-plank-comparison-20261006/`、`config/materials.yaml` 及瓷砖并行工作其余文件一律未碰；`setPipeChaseInspectionVisible` 本体一行未加。
- **这不是施工依据**：检视态是显示层。墙砖范围仍以量房后橱柜排版图与门店按房报价为准；`height` 与 `zone` 均为 D1/D7 裁定前的建议基线，业主终裁只改数值并重跑脚本。
- **关联文件**：`shared/types.ts`、`shared/render/SceneBuilder.ts`、`shared/render/layout-bounds.ts`、`server/overlay-merge.ts`、`scripts/verify/collision/verify-collision-coverage.ts`、`config/layout/overlay.yaml`、`schedule/phase-1/control.yaml`、`tmp/verify-wall-tile.ts`、`tmp/probe-walltile.ts`。
- **决策人**：业主。

### DEC-2026-10-07-R09 贴砖系统独立审计面：状态摘要 + 逐段明细 + 开启播报

- **日期**：2026-10-07。触发：业主要求「类似 HVAC 的效果，我需要能**独立审计**瓷砖系统」。
- **先对齐 HVAC 为何可审计**：不是那一个开关，是四层审计面——① 视觉开关 `setHvacCoordinationVisible`；② 状态摘要 `getHvacExportStatus()`（`required/ready/expected/included/missing/terminalCount`）；③ 深查 `inspectMasterBedroomCondensate()`（逐段 `aabb` + `joins` + `checks`）；④ CLI `verify:mep` / `hvac-export-check`。缺任何一层，就只剩"能看不能查"。
- **瓷砖现已补齐平行四层**：
  - ① 视觉开关：`setWallTileInspectionVisible`（R08 已建，独立于 HVAC）。
  - ② 状态摘要：`getWallTileInspectionStatus()` → `required/ready/expected/included/missing` + `byRoom`（各房墙长与面积）+ `byHeightTier`（按高度分档的段数/墙长/面积）+ `totalAreaSqm/visibleAreaSqm/coveredAreaSqm`。
  - ③ 逐段明细：`inspectWallTileRegions()` → 每段 `id/wall/room/along/bottom/height/lengthM/areaSqm/zone`，并内建 `checks`：`missingWallRefs`、`suppressedWallRefs`、`duplicateOverlaps`（同墙重叠=双计）、`overCeiling`（超净高 2.65m）。
  - ④ CLI：`tmp/verify-wall-tile.ts` 的 L1 声明层 + L2 几何交叉层（18 条断言，退出码 0 = 一致）。
- **浏览器侧与 CLI 侧的边界（写明，不含糊）**：浏览器侧无 suppress 数据源，而**被 suppress 的墙（玻璃幕墙/已删除）本就不生成 wall mesh**，故一并落入 `missingWallRefs`——审计仍会 `ready=false` 告警，只是标签较粗。「墙不存在」与「墙已 suppress」的细分以 CLI L2 为准（CLI 直接读 `overlay.suppress`）。
- **开启即播报（回应"高度看不出来"）**：开关打开时 `App.setWallTileInspectionVisible` 调 `getWallTileInspectionStatus()` 并用既有 `showToast` 播报一行摘要——各房墙长、按高度分档的段数、总面积与可见/遮蔽拆分。理由：**0.30m 与 1.80m 在第一人称广角下都像"墙根一条带子"，3D 里"看得出"不等于"量得出"**，图与数必须同时给出，避免拿眼睛当尺子。
- **当前声明快照（A 档，D1 未终裁）**：厨房 4.80m@0.90m（4 段）/ 主卫 4.36m（淋浴 1.80m×1 段 + 非淋浴 0.30m×2 段）/ 客卫 5.70m（淋浴 1.80m×2 段 + 非淋浴 0.30m×4 段）；合计 **14.86m / 12.213㎡**，可见面 8.343㎡ / 遮蔽面 3.870㎡，`COST-060-08 = 580`。
- **独立性保持**：`getWallTileInspectionStatus` / `inspectWallTileRegions` / 播报三段均**零 HVAC 引用**（测试以源码级断言看守：函数体内不得出现 `Hvac|hvac`）。
- **验证**：`test:server` 660/660/0 fail（新增 3 条审计面测试，累计 11 条）→ `typecheck` Exit 0 → `verify:all` Exit 0 → `test:app` 482/482 → `tmp/verify-wall-tile.ts` 18 条断言全 OK。
- **关联文件**：`app/src/render/HouseScene.ts`、`app/src/App.ts`、`tests/server/wall-tile-inspection.test.ts`。
- **决策人**：业主。

### DEC-2026-10-07-R10 贴砖/HVAC 相互隔离的行为级证明（补 R08/R09 的实证）

- **日期**：2026-10-07。触发：业主要求「我需要它独立，**代码、还有开关都不会影响 HVAC**」——这是要证据，不是要承诺。
- **R08/R09 只做到源码级断言**（函数体内不得出现 `Hvac|hvac`），那只能证明"没写耦合"，不能证明"运行时不互相影响"。本条补行为级证明与调用图对账。
- **调用图对账（穷举全部调用点）**：
  - `setHvacCoordinationVisible` 的调用方只有：`HouseScene` 自身 3 处（含 `setMepOverviewVisible` 的开/关分支）、`App` 的按钮 `onToggle`、`App` 的就绪降级、以及挂到 `window` 的调试 API。**无一处触达 `setWallTileInspectionVisible`。**
  - `setWallTileInspectionVisible` 的调用方只有：`App` 的贴砖按钮 `onToggle`、`App.setWallTileState` 的就绪降级。**无一处触达 HVAC。**
  - `setPipeChaseInspectionVisible` 只被 `setHvacCoordinationVisible` 调用；其首行 `!== 'pipe-chase'` 直接跳过 `'wall-tile'`。
  - `setMepCoordinationVisible` 只调 `mepRenderer.setVisible()`——**不动全局材质**，碰不到贴砖层；`setMepOverviewVisible` 的开关分支也只操作 `ceilingMeshes` / `infrastructureMeshes` 两个具名数组与 HVAC 状态快照恢复。
- **行为级测试（`app/src/scene/HouseScene.test.ts` 新增 3 条，`test:app` 50/50 通过）**：
  ① **切贴砖开关 → HVAC/管井侧逐字段快照比对不变**：构造含 wall-tile + pipe-chase + HVAC 实体的 `exportRoot`，把 HVAC 置为可见，记录 `{hvacVisible, pipeRenderOrder, pipeOpacity, pipeDepthTest, pipeVisible}` 快照；`setWallTileInspectionVisible(true/false)` 前后 `toEqual(before)`。同时反向验证贴砖层自身确实亮/灭、且关闭时按 `inspectionInitial` 快照恢复（opacity 0.38 / depthTest true / renderOrder 0）而非硬编码默认值。
  ② **切 HVAC 开关 → 贴砖层状态不变**：先把贴砖层打开并快照，再 `setHvacCoordinationVisible(true/false)`，断言贴砖层四字段 `toEqual(tileOpen)`；同时断言管井层照 HVAC 语义正常变化（renderOrder 0→100→0），**证明 HVTL 路径本身是活的、不是被我掐断**——隔离不是靠"关掉对方功能"实现的。
  ③ **审计面自身**：`getWallTileInspectionStatus()` 的 `byRoom` / `byHeightTier` / `total/visible/covered` 面积与手动复算一致；引用场景中不存在的墙 → `ready=false` 且列入 `missing`；再造一段与既有区间重叠的声明 → `inspectWallTileRegions().checks.duplicateOverlaps` 非空（防双计真的会响）。
- **同时确认的既有失败模式**（承接 R06）：被 suppress 的墙不生成 wall mesh，故 `inspectWallTileRegions` 的 `missingWallRefs` 会覆盖它，`ready` 仍为 false——浏览器侧审计不会漏，只是标签较粗；细分仍以 CLI `tmp/verify-wall-tile.ts` 的 L2 为准。
- **验证**：`test:app` 56 files / **485** tests 全过（新增 3 条行为级 + 1 条审计面，`HouseScene.test.ts` 单文件 50/50）→ `test:server` 660/660/0 → `typecheck` Exit 0 → `verify:all` Exit 0 → `tmp/verify-wall-tile.ts` 18 条断言全 OK。
- **关联文件**：`app/src/scene/HouseScene.test.ts`。
- **决策人**：业主。

### DEC-2026-10-07-R11 贴砖范围业主质询终裁：杂砖带保留 + 灶台挡水条 + 生活阳台 + room 脸语义

- **日期**：2026-10-07。触发：业主看贴砖检视态截图质询三条——①「厨房这个位置怎么需要贴瓷砖？」（图3 = 东墙烟机/高柜后）；②「这个位置怎么没有安排贴瓷砖？」（图2 = 厨房-阳台门/地漏区）；③「落地窗一圈的防水台少了贴瓷砖」。先出 `docs/design-iterations/tile-scope-owner-review-20261007.md` 分析报告，再逐条裁定。
- **裁定**：**D1=A**（冰箱高柜后 0.90m 杂砖带维持贴砖走杂砖，与 R05 业主指示一致）；**D2=补贴**（灶台挡水条补上）；**D3=B**（生活阳台按 0.30m 湿区最低口径贴两段墙）；**D4**（防水台初判「落地窗根部下方小条带、水平面不进 3D 贴砖层、挂交底/验收/extras、材料待终裁」——**同日被 D4=L 型终裁覆盖，见本节附则**）；**D5=补**（`wall_region` 补 `room` 字段）。
- **范围变化（overlay.yaml wall_region 13 → 16 段）**：
  - 新增 `walltile_kitchen_ent_hood_wall`：东墙 `w_ent_west` 沿 along[1.27,2.17]（烟机宽 0.90m，z[0.73,1.63]）自台面 0.90 贴至 **1.40**（模型 `range_hood` 底缘 y=1.35，取整包住机身边）——R05 的 0.90m 带止于台面完成面 0.89m，**台面以上到烟机底约 0.5㎡ 的油溅区本是裸墙缺口**，本条补正砖可见面。
  - 新增 `walltile_balc_west_washer`（`w_balc_west` 1.20m 全墙，洗衣机/烘干机背墙，给水/墙排/插座均在此面）与 `walltile_balc_south`（`w_balc_south` 沿 along[0,1.50] **阳台侧**），均 0.30m。**门洞墙 `w_balc_east` 阳台侧 1.20m 既定不贴**（厨房侧杂砖带已覆盖门垛，D3=B 不收）。
  - D4 防水台（客厅落地幕墙 `w_liv_south` 根部 6.20m 条带贴砖/窗台石）：水平面不在 `wall_region` 表达域，挂 `COST-060-05` extras 双锚点（小砖条 20 元/米 ≈124 / 飘窗台面贴砖 100 元/米 ≈620）+ `config/acceptance.yaml` 新增 `check_sill_tile` + PKG-060 `acceptance_refs` + budget-pitfalls 验收条；材料（墙砖/窗台石）与是否含各飘窗台面待业主终裁，**PKG-060 need 暂不含此项**。
- **D5 脸语义（`room` 字段，对齐 `paint_region`）**：共墙两侧各贴各的脸——`w_balc_south` 客卫淋浴 1.80m 与阳台 0.30m 同墙并存；预算与审计按 `(wall, room)` 分组去重，不再按 id 前缀猜房间。渲染**不加侧向偏移**（仍走墙中心线 + 检视态 `depthTest=false` 真透视，从两侧都看得见砖面带），`room` 只进账面/审计。`SceneBuilder` 校验 room 存在并把 `roomId/bottom` 写入 userData；`HouseScene.inspectWallTileRegions` 的 room 映射改 `userData.roomId`（旧声明无则退前缀）。
- **判重规则改二维**：同墙同脸上 along 与**竖向**同时重叠才算双计——东墙 0.90m 杂砖带与 0.90→1.40 挡水条共用 along 区间、竖直接边，不判重；`tmp/verify-wall-tile.ts` L2 与 `HouseScene` 审计同改（along 起点相同按 bottom 排序，防"上段 vs 下段"误判）。`height` 口径明确为**顶标高**（非带高），`bottom` 缺省 0，同一墙可上下堆叠。
- **L2 新增断言**：① `room` 在已知房间表；② 声明 along 区间必须落在**该墙属于此房间的那一段**（`faceSpanOf`——共墙贴错脸现形）；③ 厨卫三间仍「声明 union == 独立推导」，**阳台改「声明 union ⊆ 推导」并显式登记 1.20m 缺口**（`tileableOf(阳台)=3.90` vs 声明 2.70）；④ 总长口径改 **union**（同一墙堆叠只算一次墙长）。
- **台账随动**：union 墙长 14.86 → **17.56m**；A 档面积 12.213 → **13.473㎡**（可见面 8.343 → **9.603㎡**，遮蔽面 3.87㎡ 不变）；`COST-060-08` planned_cny 580 → **670**；PKG-060 `estimated_need_cny` 43,080 → **43,170**、缺口 → **13,170**；全局 known pending gap 34,374 → **34,464**。A 档区间 1,649–1,832 → **1,819–2,021**；B 全通高满铺改按 union 17.56m×2.65m=46.53㎡ → **6,284–6,982**。`budget.md`/`checklist.md` 由 `verify:schedule` 重新生成。
- **验证**：`npx tsx tmp/verify-wall-tile.ts` 退出码 0（L2 逐条 + 台账全 OK）→ `test:server` 708/708/0 → `typecheck` Exit 0 → `verify:all` Exit 0 → `verify:schedule` valid（¥34,464）。`test:app` 519/520——**唯一失败 `paint status reports net area...` 属并行涂漆 WIP（DEC-2026-10-08-C05/C06 未提交改动），与本条无关**，已向业主显形。
- **关联文件**：`config/layout/overlay.yaml`、`shared/types.ts`、`server/overlay-merge.ts`、`shared/render/SceneBuilder.ts`、`app/src/render/HouseScene.ts`、`tmp/verify-wall-tile.ts`、`tests/server/wall-tile-inspection.test.ts`、`app/src/scene/HouseScene.test.ts`、`schedule/phase-1/control.yaml`、`config/acceptance.yaml`、`config/budget-pitfalls.yaml`、`docs/design-iterations/tile-scope-owner-review-20261007.md`。
- **决策人**：业主。

#### R11 附则（同日续，D4=L 型终裁）：防水台落地

- **触发**：业主指出 D4 的防水台理解错了造型——不是窗框下的水平小条，而是**落地窗根部矮台的 L 型截面：竖面 + 水平台面都要贴，做出檐收口**；尺寸「开发商已做、按业界标准估」；范围「涉及落地窗的地方都会有」。
- **范围逐窗核对（model-geometry + overlay 实算）**：全宅只有 `w_liv_south`（客厅 6.20m）是真·齐地玻璃且贴近人活动面——卧室/书房/客卫各玻璃根部都在 2.07m 高飘窗台之后（台面挡住，根部不可见）、厨房北幕墙根在地柜后（不可见）、入户花园为开发商完成区、南阳台 BLK 冻结。故本轮只挂客厅一处，其余不贴但理由全部显形。
- **尺寸口径（推断，量级待量房）**：150 高 × 150 出檐。依据：业界常规落地窗窗台留 100–200mm（防外力撞击玻璃、窗台内侧做防水收口），取中值且与 300×600 墙砖整砖模数合。
- **构件**：overlay 新增 `bay_sill living_south_waterproof_ledge`（`wall: w_liv_south`，sill 0 / height 0.15 / depth 0.15）——本模型此前按「玻璃齐地」建，缺此构件，本条补上。bay_sill 按既有惯例属非碰撞类。
- **新元素类型 `sill_region`**（贴砖层扩展到水平/窗台面）：`element`（引用 bay_sill）+ `face: front|top` + 可选 `along` + `zone/room`。front = 玻璃线处竖面；top = 墙线向房间侧伸 depth 的水平台面（靠 room 中心定法线，故 top 必须声明 room）。两段复用 `wall-tile` 层标签与同一个贴砖开关，与 `wall_region` 平级互不引用；`verify-collision-coverage` 登记为非碰撞。
- **面积与台账**：L 型两段 6.20m×(0.15+0.15)=**1.86㎡**（front 0.93 + top 0.93）进可见面→ 可见面 9.603→**11.463㎡**，A 档面积 13.473→**15.333㎡**；`COST-060-08` planned_cny 670→**800**；PKG-060 need 43,170→**43,300**、缺口 **13,300**；全局 pending gap 34,464→**34,594**。A 档区间 1,819–2,021→**2,070–2,300**。人工（窗边台贴小砖条 20 元/米 ≈124）仍挂 COST-060-05 extras 不入 need。
- **测试补强**：`sceneWithWallTile` 改走 `mergeSceneElements`+`resolveLayout`（与 App 同路径——直接喂原始 YAML 的 bay_sill 没有 points 会炸，此前临摹路径一直没走到 bay_sill）；`unsupported` 断言从 `(scene as any).unsupported ?? []`（恒真）修正为 `scene.report.unsupported`——这个恒真断言正是本轮第一版 sill 网格没建出来却没被抓到的原因。app 侧补 L 型两段竖直接边不判重用例。
- **验证**：`tmp/verify-wall-tile.ts` 退出码 0（新增防水台面积/构件断言）｜`test:server` 708/708｜`test:app` 520/520（`/tmp` tmpfs 写满导致 7 个套件加载失败，`TMPDIR` 迁出后全绿，环境问题非代码）｜`typecheck` 0｜`verify:all` 0｜`verify:schedule` valid ¥34,594。

### DEC-2026-10-08-C18 废止杂砖概念：D2「遮蔽面走杂砖」条款撤销，全屋贴砖统一正砖

- **日期**：2026-10-08。触发：业主质询厨房贴砖口径后裁定「只有橱柜的地方是杂砖，或者干脆删掉杂砖这个概念」——采纳后者（彻底废止）。
- **理由**：①杂砖概念源自 D2（2026-10-07：面积不减 + 遮蔽面走杂砖省主材），但**全库从未有杂砖单价记录**（R05 起遮蔽面在预算中计 0 并显形），省钱实际为 0；②C15 曾把厨房东墙整段保守记杂砖，吊柜以上可见面被标杂砖，照单采购会真的难看，而正确拆分又被 D7 橱柜包络卡住——一个省钱为 0 还要持续占审计心力的概念没有保留价值。
- **决策**：overlay 原 4 段 zone=covered（厨房东墙 6.36 + 阳台门段 1.08 + 残段 0.53 + 客卫柜后 0.23 = 8.20㎡）全部改回 visible；`zone` 字段保留 schema 兼容（缺省 visible），杂砖不再出现在任何声明、预算与采购口径中。D2 的「面积不减任何遮蔽」原则不变，撤销的只是「走杂砖」这一档。
- **数字变化**：全屋贴砖 25.651㎡ 全部按 wall_tile_01 正砖计价（66.7 × 1.05）；COST-060-08 planned 871 → **1,796**；PKG-060 need 43,371 → **44,296**、缺口 13,371 → 14,296；全局 known pending gap 34,665 → **35,590**（control.yaml/budget.md/procurement.md 三处同步）。D7 橱柜收口的**贴砖口径负担解除**（剩余只剩橱柜布局本身）。
- **关联文件**：`config/layout/overlay.yaml`、`schedule/phase-1/control.yaml`、`schedule/phase-1/budget.md`、`schedule/procurement.md`、`tests/server/wall-tile-inspection.test.ts`、`docs/decisions/11-tile-finish.md`（本条）。
- **决策人**：业主。

### DEC-2026-10-08-C19 下架「墙砖方案」贴图预览：贴砖的唯一视觉口径为贴砖检视态

- **日期**：2026-10-08。触发：业主看到厨房整墙程序化砖纹后裁定「干掉吧。没必要」。
- **背景**：`WallTopic`（墙砖方案）按房间 `wall_finish: tile` 把整墙刷成程序化陶瓷砖贴图（canvas 画 300×600 砖+缝，非逐块几何）。它与贴砖声明是两套口径——阳台门段预览整墙砖、声明只有 0.90m 防溅带，曾让儿童房/主卫接连出现「预览假象」质询；C14/C16 已把两卫饰面改「带+漆」，预览的误导性大于参考价值。
- **决策**：TopicRegistry 摘除 WallTopic（主题栏不再出现「墙砖方案」，剩 8 主题），删除 `WallTopic.ts` 与 designData `wallOptions`、StateManager `wall` 默认选中；墙砖候选 SKU（wall_tile_01/02/03）与 COST-060-08 台账保留——**采购口径不受影响**，只是不再有贴图预览。贴砖的唯一视觉口径 = 贴砖检视态（声明层）。
- **运行时取证注记**：本应用为按需渲染（requestRender 驱动），脚本移动相机后必须手动触发渲染再截屏；且页面初始加载若代理瞬断会静默回退离线快照（OfflineIndicator 未必可见），取证前须先 `fetch('/api/project')` 确认数据版本再摆位。
- **关联文件**：`app/src/topics/TopicRegistry.ts`（摘除注册）、`app/src/topics/WallTopic.ts`（删除）、`app/src/data/designData.ts`、`app/src/state/StateManager.ts`、`app/src/topics/TopicRegistry.test.ts`、`docs/decisions/11-tile-finish.md`（本条）。
- **决策人**：业主。

