<!-- schedule-input-snapshot:{"config/acceptance.yaml":"2073ae223d39584f438e2be0fe231b0719b456b863e0c379c216681089b90e9f","config/ceiling.yaml":"9235822b1161c4cf6ab10d966b9267bb96ef3830252b4eb81d56cd88a6be27eb","config/electrical-topology.yaml":"901e950952da0eeee5234c860bdddc6a67ff984360f0d36645eac2676cf22c51","config/electrical.yaml":"de3a159e4370875ab060b797c17e73d0807ecb06fe77f8203dae8d9c5826e3c9","config/house.yaml":"8339729d1ac0f00960930eefdb00d58dcf4c6cac417fea55ad8473f89fbadf44","config/hvac.yaml":"408556c1420a2bf0f8a58ce94244c7aa6c61608072b1a2228ca2420f2c5d692c","config/layout/model-geometry.yaml":"c06d12c5d5dfa46d446535f2ed046ecebe354ff2acde1492145f2a591ce385c9","config/layout/overlay.yaml":"d9271c4ea1824d8bf57be73c089fab5c321c007a93cff7f781a604e90c904f44","config/mep-hvac-coordination.yaml":"7dc1c3326f7c1af266a7da0c9b99e994696b74c3452aeb367eafcfc7656e73c9","config/model-package-links.yaml":"6f351ff5231cc650de48e5ef89c8f2fa13650b81312badd9ed6c525373e04f7e","config/plumbing.yaml":"27711aa1198f7121ce494efe052fbe8d2efae94ca0900a9094324e65f382685c","docs/pending-site-data.md":"08caa0c978fa546571c1cf14554082de1444006d1b825835ff5d8f841aa7937c","schedule/phase-1/control.yaml":"3e22e4c85f7e21eb6549b8f7df382e6d8991b6e68cc22569d95bb6beba4e7d6c","schedule/phase-scope.yaml":"4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4","schedule/roadmap.yaml":"0a954474b7fd676d98db498973c560aa45fddb2c67fd7364b453e6d4dff9dc45"} -->
# 一期施工、预算与验收统一审计清单

> 自动生成：请勿直接编辑。维护源：`schedule/phase-1/control.yaml`  
> 项目数据指纹：`sha256:8ce4f6ab196d322542dd58b6da51e5338999f196dc4c9cbfebc19f4d2cd597e2`（15 个输入文件；验证时会检查本页是否过期）
> 控制源声明更新日期：2026-10-20  
> 当前阶段：pre_handover；总体状态：planning

## 当前推进位置

- **当前工作包**：PKG-000｜设计、量房与开工准备（执行：`not_started`；就绪：`blocked`）。
- **本包要做什么**：交房前可先做有据可查的初版设计预演和现场资料准备；交房后再量房、回填配置、冻结专业图纸、同范围报价并签约。预演检查通过不代表具备施工放线或采购条件。
- **开工前先关闭**：
  - `BLK-HANDOVER` 尚未交房，无法完成现场量房及房屋查验；解除条件：交房查验完成并归档现场记录
  - `BLK-STRUCTURE` 墙体结构、梁底及允许打孔或穿墙条件未确认；解除条件：结构资料与现场复核结果完成会签
  - `BLK-HVAC-DEEPENING` 中央空调管线、冷凝水、风口和检修口尚未完成厂家深化及三方会审；解除条件：空调、设计和施工三方签认深化图
  - `BLK-GAS-DOOR` 燃气厨房门的现场验收要求未确认；解除条件：燃气单位或物业书面确认厨房分隔要求
  - `BLK-SURVEY-DATA-FREEZE` 影响水电与中央空调施工的现场数据尚未全部实测、显式豁免或登记为阻塞；当前清单和数据状态见 docs/pending-site-data.md；解除条件：影响水电与中央空调的条目逐项转为实测值或显式豁免，并回填 config 与 docs/pending-site-data.md
- **当前可推进的预交房检查点**：SCH-000-PRE-01｜建立交房前初版设计基线（仅预演，不作施工图）（pre_handover_design）；按下表方法检查，通过标准是：初版基线写清目标、优先级、采用的事实及来源、未决现场变量、备选路径、什么实测结果会反转当前方案；明确标注“不可施工/不可放线/不可下单”。
- **施工状态保持 blocked**：此项只推进初版设计或现场准备；通过它不会解除量房、专业会审、放线、采购或施工阻塞。
- **参与责任角色**：业主、设计师、施工方、空调商。
- **通过后进入**：PKG-005｜物业装修手续与物业收费；仍须满足其依赖、阻塞项与开工门槛。

### 工作包进度导航

| 顺序 | 工作包 | 执行状态 | 开工条件 | 未通过检查数 | 付款/放行门槛 |
|---:|---|---|---|---:|---|
| 0 | [PKG-000｜设计、量房与开工准备](#pkg-000) | not_started | blocked | 6 | pending |
| 5 | [PKG-005｜物业装修手续与物业收费](#pkg-005) | not_started | blocked | 2 | pending |
| 10 | [PKG-010｜施工现场保护与施工位置标记](#pkg-010) | not_started | blocked | 2 | pending |
| 20 | [PKG-020｜拆改、墙体新建与清运](#pkg-020) | not_started | blocked | 3 | pending |
| 30 | [PKG-030｜中央空调第一次安装](#pkg-030) | not_started | blocked | 9 | pending |
| 40 | [PKG-040｜水电改造](#pkg-040) | not_started | blocked | 21 | pending |
| 50 | [PKG-050｜防水及闭水](#pkg-050) | not_started | blocked | 8 | pending |
| 60 | [PKG-060｜泥瓦与铺贴](#pkg-060) | not_started | blocked | 6 | pending |
| 65 | [PKG-065｜卫生间美缝（先行）](#pkg-065) | not_started | blocked | 5 | pending |
| 70 | [PKG-070｜吊顶龙骨、隐蔽复验与封板](#pkg-070) | not_started | blocked | 4 | pending |
| 80 | [PKG-080｜墙顶面基层与涂装](#pkg-080) | not_started | blocked | 4 | pending |
| 90 | [PKG-090｜室内门及厨房门](#pkg-090) | not_started | blocked | 3 | pending |
| 100 | [PKG-100｜两个卫生间的洁具与五金](#pkg-100) | not_started | blocked | 3 | pending |
| 110 | [PKG-110｜橱柜及台面](#pkg-110) | not_started | blocked | 4 | pending |
| 120 | [PKG-120｜一期基础灯具安装与照明测试](#pkg-120) | not_started | blocked | 3 | pending |
| 125 | [PKG-125｜开关插座面板与一期基础智能设备](#pkg-125) | not_started | blocked | 5 | pending |
| 130 | [PKG-130｜瓷砖美缝（其余区域）](#pkg-130) | not_started | blocked | 3 | pending |
| 135 | [PKG-135｜踢脚线、明确收边项目与竣工深度清洁](#pkg-135) | not_started | blocked | 2 | pending |
| 140 | [PKG-140｜中央空调第二次安装与调试](#pkg-140) | not_started | blocked | 5 | pending |
| 142 | [PKG-142｜基础硬装后的临时入住放行](#pkg-142) | not_started | blocked | 3 | pending |
| 145 | [PKG-145｜一期窗帘、纱帘与手动轨道](#pkg-145) | not_started | blocked | 2 | pending |
| 150 | [PKG-150｜一期家具与定制收纳](#pkg-150) | not_started | blocked | 3 | pending |
| 160 | [PKG-160｜必需家电安装与接口测试](#pkg-160) | not_started | blocked | 1 | pending |
| 170 | [PKG-170｜竣工联合验收、整改与资料移交](#pkg-170) | not_started | blocked | 4 | pending |

## 使用规则与数据联动

- 按“当前推进位置”找到工作包；被阻塞时先关闭列出的阻塞项，不跳过前置门槛。
- 若检查项标注“可在 blocked 中推进，仅预演不放施工”，可继续做可逆设计和资料准备；该项通过不会解除施工 readiness。
- 每项通过后记录检查人、时间、证据、`check_spec_sha256` 和 `project_data_sha256`；整改复验追加新记录并用 `supersedes` 指向旧记录。
- 关联的项目配置变化后，旧 PASS 自动显示 stale、对应验收/放行/付款门槛回到 pending；重新验收后追加新记录。
- 手写纸本只是现场记录；回填到 `control.yaml.audit_log.records` 后运行 `npm run schedule:render` 更新视图。

## 项目总控

- [ ] 一期已分配金额为 ¥210,000，未分配 ¥0，总上限 ¥210,000。
- [ ] 基础硬装与中央空调合计 ¥162,000，均属于一期固定工程。
- [ ] 已量化但尚未分配的预算缺口为 ¥36,385；未取得业主批准前保持待处理。
- [ ] 89个待报价/待算量费用项已经逐项取得金额，并与父工作包控制额完成对账。
- [ ] 所有现场未知项保持 blocked/site_pending，未以推测替代确认。

## 家电型号、公开报价与适配核对

- [ ] 每台一期家电都取得含安装、辅材、送货、拆旧、发票和质保边界的书面报价；公开参考价不得直接当作合同价。
- [ ] 冰箱完成面净开口、深度、净高、开门余量和散热缝已复测后，才允许下单。
- [ ] 燃气热水器的安装墙面、燃气表、排烟、冷凝水、给排水、专用电路和物业要求均有现场记录；类别确认不等于安装条件确认。
- [ ] 热水器类别已确认为燃气热水器；主选候选为KL7PRO（静音王），预算备选为JSQ30-HWF Pro，但现场条件确认前不得把候选型号当成最终下单型号。
- [ ] 热水器下单前完成：安装墙面、燃气表与气源、排烟路径、冷凝水排放、冷热水接口、专用电路、物业和燃气单位审批、含辅材安装报价。
| 勾选 | 费用ID | 类别 | 品牌/型号 | 关键规格 | 公开参考价 | 当前状态 | 来源 |
|---|---|---|---|---|---:|---|---|
| [ ] | COST-160-01 | 冰箱 | 美的 BCD-501WSPM(Q) | 501升，一级能效，风冷变频；官方页面尺寸长600×宽833×高1910毫米 | ¥2,599 | public_reference_page_unavailable_width_833mm_vs_slot_700mm | [品牌页面](https://www.midea.cn/1/1000000000400692992139.html) |
| [ ] | COST-160-01 | 冰箱 | 海尔 BCD-500WGHTDC4LMU1 | 500升，风冷变频，官方宣传为594毫米超薄机身；完整宽深高和开门余量仍需向门店索取 | ¥5,299 | dimension_verification_required | [品牌页面](https://www.haier.com/newmarketing/story/20260114_285100.shtml) |
| [ ] | COST-160-02 | 洗衣机 | 海尔 EG100MATE29S | 10千克，一级能效，超薄变频；595×850×602毫米 | ¥1,599 | pending_balcony_measurement | [品牌页面](https://www.haier.com/laundry/20240726_248196.shtml) |
| [ ] | COST-160-02 | 洗衣机 | 海尔 EG100HMATE29S | 10千克洗烘一体，一级能效，595×850×602毫米；烘干功能与二期烘干边界仍需确认 | ¥1,999 | phase_boundary_check_required | [品牌页面](https://www.haier.com/laundry/20240726_248192.shtml) |
| [ ] | COST-160-03 | 燃气灶 | 美的 JZT-Q523L-M | 官方商城标称5.0/5.2千瓦台嵌两用；最终天然气版本、开孔尺寸和烟灶联动须按订单规格复核 | ¥1,099 | public_reference_page_unavailable_gas_type_and_cutout_verification_required | [品牌页面](https://www.midea.cn/14/1000000000400693541206.html) |
| [ ] | COST-160-03 | 燃气灶 | 美的 JZT-Q217B-M | 4.8千瓦天然气嵌入式；低于本项目约5.0千瓦目标，仅作预算下探备选 | ¥699 | target_power_exception_requires_owner_approval | [品牌页面](https://www.midea.cn/detail/index?itemid=1000000000400693352810) |
| [ ] | COST-160-04 | 吸油烟机 | 美的 CXW-280-J25S PRO | 侧吸，约22/23立方米每分钟，500帕最大静压，安装宽度约895毫米 | ¥1,599 | public_reference_page_unavailable_kitchen_hood_route_and_900mm_opening_check_required | [品牌页面](https://m.midea.cn/detail/index?itemid=1000000000400693641015) |
| [ ] | COST-160-04 | 吸油烟机 | 美的 CXW-280-CC22 | 侧吸，22立方米每分钟，540帕最大静压 | ¥2,499 | public_reference_page_unavailable_kitchen_hood_route_and_900mm_opening_check_required | [品牌页面](https://www.midea.cn/18/1000000000400693804631.html) |
| [ ] | COST-160-05 | 燃气热水器 | 美的 JSQ30-HWF Pro | 天然气12T、16升，变频恒温，强制排气和安全防冻；官方参数标注适用一厨一卫，产品尺寸约530×335×163毫米，未含现场燃气、烟管和额外辅材安装核价 | ¥929 | user_category_confirmed_site_and_route_pending | [品牌页面](https://www.midea.cn/64/10000000004006931264823.html) |
| [ ] | COST-160-05 | 燃气热水器 | 美的 JSQ30-MK6 | 天然气12T、16升，增压水伺服，变频恒温；官方参数标注适用一厨二卫，产品尺寸约530×335×176毫米 | ¥1,399 | user_category_confirmed_site_and_route_pending | [品牌页面](https://www.midea.cn/64/1000000000400693406861.html) |
| [ ] | COST-160-05 | 燃气热水器 | 海尔 KL7PRO（静音王） | 天然气12T、16升，水伺服恒温+增压+静音；京东活动页观察区间约 2,444–2,612（业主侧检索转述，下单前须一手复核南宁到手价与安装边界）；业主价格线：≤2,500 直接买 / 2,500–2,800 正常 / >3,000 换 JM6S/JM6C | ¥2,600 | owner_selected_site_pending_price_recheck | [品牌页面](https://pro.m.jd.com/mall/active/3ZbAE5pGUJmYNgfwdtDfspEfdLqR/index.html) |
| [ ] | COST-160-08 | 微蒸烤一体机 | 美的 GC5（TR850E-TSBC00） | 55L 嵌入式，微波+蒸+烤+空气炸四合一；变频微波、双孔直喷蒸汽、上下管+热风；额定功率 3200W；机身 595×565×454mm（嵌位须 600 宽高柜段并预留散热缝，电气 16A 专用回路） | ¥4,199 | owner_selected_niche_circuit_and_competitive_quote_pending | [品牌页面](https://www.midea.cn/22/1000000000400742548405.html) |

- [ ] 按目标规格筛选的家电候选公开参考价下限 ¥10,825 已与一期家电预算 ¥16,000 对账，安装和辅材缺口未被隐藏。


## 硬装询价轮次核对

- [ ] 轮次价格已按价格类型分列，quoted_sheet 之外的 owner_budget_pool / cap / candidate 未被当作合同承诺价。
- [ ] 轮次目标超过父包计划额的工作包已取得资金来源或业主书面批准；未批准前不得动用硬装预备金。
- [ ] 轮次记录与 COST 组件一一对应；瓦工与防水辅材、浴霸凉霸归属、通用五金等重复计费项已去重。
- [ ] 轮次记录进入锁定时已补 locked_cny、contract_ref 与 evidence_path，历史轮次只追加不覆盖。

| 勾选 | 轮次记录 | 项目 | 归属工作包 | 轮次目标 | 轮次当前价 | 价格类型 | 状态 |
|---|---|---|---|---:|---:|---|---|
| [ ] | QR-2026-10-03-01 | 拆改、砌墙、修补 | PKG-020 | ¥3,000 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-02 | 水电改造（强弱电+给排水+墙排） | PKG-040 | ¥12,000 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-03 | 两卫/阳台防水+闭水 | PKG-050 | ¥3,000 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-04 | 全屋瓷砖主材（诺贝尔方向） | PKG-060 | ¥20,000 | ¥20,000 | cap | pending_store_quote |
| [ ] | QR-2026-10-03-05 | 瓦工人工/复杂铺贴/增项预算池 | PKG-060 | ¥18,500 | ¥18,500 | owner_budget_pool | budget_pool_confirmed_quote_pending |
| [ ] | QR-2026-10-03-06 | 水泥砂/瓷砖胶/背胶等辅材 | PKG-060 | ¥4,000 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-07 | 瓷砖美缝 | PKG-130 | ¥4,500 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-08 | 厨卫铝扣板+收边+2浴霸+凉霸+灯 | PKG-070 | ¥9,100 | ¥9,537 | quoted_sheet | quoted_pending_optimization |
| [ ] | QR-2026-10-03-09 | 石膏板吊顶+空调边吊+窗帘盒 | PKG-070 | ¥13,500 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-10 | 墙顶面基层+腻子+底漆+面漆 | PKG-080 | ¥11,000 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-11 | 卫生间门×2（极窄框+长虹/油砂） | PKG-090 | ¥2,800 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-12 | 室内木门×4 | PKG-090 | ¥6,000 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-13 | 踢脚线/门口/零星收口 | PKG-135 | ¥2,000 | 待报价/待算量 | candidate | pending_decision |
| [ ] | QR-2026-10-03-14 | 九牧智能马桶 ZQ6650 ×2 | PKG-100 | ¥5,598 | ¥5,598 | cap | owner_selected_pending_verification |
| [ ] | QR-2026-10-03-15 | 恒温花洒×2 | PKG-100 | ¥2,600 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-16 | 浴室柜台盆/镜柜×2 | PKG-100 | ¥6,000 | ¥6,000 | candidate | pending_quote |
| [ ] | QR-2026-10-03-17 | 浴室柜龙头+下水器+角阀软管 | PKG-100 | ¥1,200 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-18 | 主客卫固定淋浴玻璃屏×2 | PKG-100 | ¥1,800 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-19 | 地漏/角阀/毛巾架等通用五金 | PKG-100 | ¥1,500 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-20 | 橱柜+PET柜门+20mm浅色石英石 | PKG-110 | ¥12,000 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-21 | 水槽+厨房龙头 | PKG-110 | ¥1,500 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-22 | 开关插座 | PKG-125 | ¥2,500 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-23 | 基础灯具 | PKG-120 | ¥3,000 | 待报价/待算量 | candidate | pending_quote |
| [ ] | QR-2026-10-03-24 | 美的领航者四代 一拖六 200外机 | PKG-030 | ¥36,000 | ¥36,000 | candidate | locked |
| [ ] | QR-2026-10-03-25 | 成品保护/垃圾清运/零星孔洞修补 | PKG-010 | ¥2,500 | 待报价/待算量 | candidate | pending_breakdown |
| [ ] | QR-2026-10-03-26 | 衣柜/玄关柜/其他固定柜体（扩展硬装） | PKG-150 | ¥18,000 | 待报价/待算量 | candidate | pending_decision |
| [ ] | QR-2026-10-05-01 | 奥普 S2-Air 浴霸×2（业主自选，京东自营） | PKG-100 | ¥1,500 | ¥1,362 | candidate | pending_decision |

<a id="pkg-000"></a>
## PKG-000｜设计、量房与开工准备

- 通俗说明：交房前可先做有据可查的初版设计预演和现场资料准备；交房后再量房、回填配置、冻结专业图纸、同范围报价并签约。预演检查通过不代表具备施工放线或采购条件。
- 预算：¥8,000；合同：—；已付：¥0；预测：—
- 依赖：无；就绪：`blocked`；执行：`not_started`
- 责任角色：业主、设计师、施工方、空调商；付款门槛：`GATE-000-COMPLETE`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-HANDOVER、BLK-STRUCTURE、BLK-HVAC-DEEPENING、BLK-GAS-DOOR、BLK-SURVEY-DATA-FREEZE

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/model-geometry.yaml](../../config/layout/model-geometry.yaml) | all=true | project_scope |
| [docs/pending-site-data.md](../../docs/pending-site-data.md) | 现场待测数据；按各项影响、状态和触发条件闭环 | site ledger |

当前项目数据指纹：`sha256:f0ac4e680bd9703f1a9f8e319d4703a9140cb5e5edfbe2aa70e2a0f3394851e6`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-000-01 | 交房查验与现场量房 | 检查交付问题并测量房间、梁柱、门窗和设备位置 | 服务范围待报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-000-02 | 全套施工图设计 | 平面、拆改、地面、吊顶、灯位、水电、给排水、立面和节点图 | 图纸目录待确认 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-000-03 | 空调橱柜柜体等专业协调 | 核对专业厂家图纸并关闭相互冲突 | 服务次数待确认 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-000-04 | 报价比较合同审核和现场交底 | 统一报价范围、检查合同并参加开工交底 | 服务次数待确认 | 待报价/待算量 | quote_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | SCH-000-PRE-01 | major/pre_handover_design/可在 blocked 中推进，仅预演不放施工 | 建立交房前初版设计基线（仅预演，不作施工图） | 只使用当前权威配置、已有DEC和可追溯证据；逐项标记 confirmed、inferred、site_pending 或 user_decision。可并行比较平面、家具、吊顶/HVAC、照明和机电方案；尺寸依赖梁位、立管或现场净空的部分保留选项，不猜坐标或最终接口。 | 初版基线写清目标、优先级、采用的事实及来源、未决现场变量、备选路径、什么实测结果会反转当前方案；明确标注“不可施工/不可放线/不可下单”。 | preliminary_design_baseline、fact_and_decision_register、reversal_conditions | `ce3bcb3dbae145bcc64287a578dbc5d4672d24f974424077f4d30b243385581d` | pending |
| [ ] | SCH-000-PRE-02 | major/pre_handover_site_prep/可在 blocked 中推进，仅预演不放施工 | 整理交房量房路线和现场资料责任表 | 按 docs/pending-site-data.md 的编号把任务分为量房当日实测、深化冻结前关闭、下单前核验、供应商资料待补和业主决策；每项标出负责人、输入工具/资料、照片/记录方式、影响工作包与触发点。 | 影响下一步水电、空调、结构和柜体接口的项目能按房间和现场路线执行；不能当日解决的项目有 owner、触发条件和保持 blocked 的工作包；本检查通过不关闭任何 site_pending blocker。 | survey_route、survey_record_template、site_data_owner_trigger_register | `5b71437c8b2b41eaace0dc0048072eb4b981fbba0b7cfe2999ec8083590c1d40` | pending |
| [ ] | SCH-000-01 | critical/handover_survey/阻塞解除后 | 交房查验和现场量房完成 | 按 docs/pending-site-data.md 逐房走查并按顺序记录：①交房缺陷和现场保护边界；②房间净长宽、对角线、墙厚、门窗及开启方向；③梁柱、梁底、结构墙和可打孔边界；④强弱电箱、给排水、燃气表、排烟道、沉箱和外机平台；⑤家具家电接口、吊顶净空和检修条件。每条记录对应稳定编号、实测值/单位、测量人、日期、照片编号与精度；邻户或模型推断值不得写成实测。 | 形成逐房测量记录和可定位照片索引；交房缺陷有责任方与处理状态；未能实测的项目保留原状态并登记负责人和触发条件。 | handover_defect_record、measurement_record、site_photo_index | `7fae8be7737043ff3274055178d1df9042fb4b20a467b4c859168ed40d01b788` | pending |
| [ ] | SCH-000-04 | critical/data_backfill/阻塞解除后 | 量房结果回填到项目权威配置并完成一致性复核 | 先更新几何、结构、家具和机电权威配置，再同步 house.yaml 镜像字段与 pending-site-data.md 状态；运行适用的 layout、MEP、家具、facts 与 schedule 检查。任何影响吊顶、空调或水电放位的数据未解决时，维持对应 blocker。 | 实测事实有来源和照片索引，模型推断没有被误标为 measured；影响当前施工的数据已实测或显式豁免；其他待决项有 owner、触发条件和下一步。 | updated_authority_config_refs、verification_report、updated_site_data_ledger、open_issue_register | `570f8062cd9b797af8d4da53ea5e87489e204a306840f12ed00f31955ab0f92f` | pending |
| [ ] | SCH-000-02 | critical/design_freeze/阻塞解除后 | 施工图与专业深化完成会审 | 业主、设计、施工、水电、空调和橱柜方逐版核对拆改、吊顶标高、灯位、回路、给排水、冷凝水、风口/检修口、柜体和家电接口；记录设计图编号、版本、日期及逐项冲突责任人。 | 施工图和专业深化图有一致的冻结版本；影响近期工序的冲突已关闭；剩余 site_pending 项有负责人、触发节点和停工边界。 | signed_drawing_set、coordination_record、closed_conflict_register | `67505a3c8a8e9213d957c8320109fcdaacddfed1fb0df5eddb211bf7472e83d2` | pending |
| [ ] | SCH-000-03 | critical/payment/阻塞解除后 | 报价和合同口径完整 | 比较至少三份同口径报价并核对数量、单价、辅材、安装、损耗、增项和付款节点 | 一期承诺额不超过总控且预备金未打包给施工方 | quote_comparison、signed_contract、owner_budget_approval_if_overrun | `eb1f696d2d69d97991bca1e4f0200e730367008759000c733642c9c275c31cdc` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-000-COMPLETE` 已由责任人确认。

<a id="pkg-005"></a>
## PKG-005｜物业装修手续与物业收费

- 通俗说明：向物业提交装修申请，确认施工时间、人员进出、公区使用、垃圾清运和禁止施工事项；所有收费按物业票据记录，可退押金与实际消费分开记账。
- 预算：¥3,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-000；就绪：`blocked`；执行：`not_started`
- 责任角色：业主、物业；付款门槛：`GATE-005-PROPERTY-APPROVED`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-HANDOVER

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/model-geometry.yaml](../../config/layout/model-geometry.yaml) | all=true | project_scope |
| [docs/pending-site-data.md](../../docs/pending-site-data.md) | 现场待测数据；按各项影响、状态和触发条件闭环 | site ledger |

当前项目数据指纹：`sha256:f0ac4e680bd9703f1a9f8e319d4703a9140cb5e5edfbe2aa70e2a0f3394851e6`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-005-01 | 物业实际收取且不退还的费用 | 装修管理、垃圾清运、人员证件等费用按物业正式通知逐项登记 | 以物业收费通知和票据为准 | 待报价/待算量 | notice_pending |
| [ ] | — | COST-005-02 | 可退装修押金的临时现金占用 | 押金不是最终装修成本，但开工时可能需要先支付，必须另记退款条件和日期 | 以物业收费通知为准 | 待报价/待算量 | notice_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | SCH-005-01 | critical/before_start/阻塞解除后 | 物业允许装修施工 | 提交物业要求的装修申请、施工图、施工单位和人员资料，核对允许施工时间及禁止事项 | 已取得物业允许进场施工的书面或系统记录 | property_approval | `bd3fee798fdb6edc55f6dbdb56ebb47f3100c17291a335d06e9009f075b79fa0` | pending |
| [ ] | SCH-005-02 | major/payment/阻塞解除后 | 物业收费和可退押金分开登记 | 逐张核对装修管理费、垃圾清运费、出入证费用和装修押金票据 | 每笔费用有票据；可退押金单独标记退款条件和预计退款时间 | fee_receipts、refundable_deposit_register | `8494eaa722109481ab0ff00f900ca54b689bc755ffa789e1ac95acbf2de589db` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-005-PROPERTY-APPROVED` 已由责任人确认。

<a id="pkg-010"></a>
## PKG-010｜施工现场保护与施工位置标记

- 通俗说明：施工方进场后先保护电梯、公区、入户门、窗户和已有成品，再把图纸上的墙体、门洞、柜体、水电、空调和吊顶位置标到现场；各方核对无误后才开始拆改。该项暂列0元，优先要求包含在施工合同中。
- 预算：¥0；合同：—；已付：¥0；预测：—
- 依赖：PKG-005；就绪：`blocked`；执行：`not_started`
- 责任角色：施工方、设计师、业主；付款门槛：`GATE-010-SITE-READY`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-HANDOVER

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/model-geometry.yaml](../../config/layout/model-geometry.yaml) | all=true | project_scope |
| [docs/pending-site-data.md](../../docs/pending-site-data.md) | 现场待测数据；按各项影响、状态和触发条件闭环 | site ledger |

当前项目数据指纹：`sha256:f0ac4e680bd9703f1a9f8e319d4703a9140cb5e5edfbe2aa70e2a0f3394851e6`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | SCH-010-01 | critical/before_start/阻塞解除后 | 公区、入户门、窗户和已有成品完成保护 | 逐处检查保护膜、保护板和护角是否连续、牢固，搬运通道和易碰位置是否覆盖 | 施工及搬运可能接触的位置均已保护，无明显裸露、松脱或影响消防通行的情况 | site_protection_photos | `0114185ffc0c21049ed4040de446a54fafc18ca78f48d35b128c6777b6dd738d` | pending |
| [ ] | SCH-010-02 | major/before_start/阻塞解除后 | 图纸上的施工位置已经标到现场并共同核对 | 逐房核对新墙、门洞、柜体、水电点位、空调内机、送回风口、检修口和吊顶边界的现场标记 | 关键位置和尺寸与确认图纸一致，业主、设计师和施工方完成现场交底签认 | setting_out_photos、signed_site_brief | `817c46e5a0db3162cfa87aa75f1239d394911897a541446786f7994bbe01152a` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-010-SITE-READY` 已由责任人确认。

<a id="pkg-020"></a>
## PKG-020｜拆改、墙体新建与清运

- 通俗说明：按确认图纸拆除允许拆除的墙体或构件，新建隔墙和门洞，并把施工垃圾运走；任何墙体性质未确认时都不能先拆再说。参考同户型半包实付（拆砌人工6,000元+物业垃圾清运1,059元），本包由5,000元上调至7,000元，差额2,000元经业主批准从未分配额度划拨。
- 预算：¥7,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-010；就绪：`blocked`；执行：`not_started`
- 责任角色：施工方、设计师、业主；付款门槛：`GATE-020-COMPLETE`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-STRUCTURE

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/model-geometry.yaml](../../config/layout/model-geometry.yaml) | collections=walls,openings | mapped |

当前项目数据指纹：`sha256:2095dbf63023bb0105b213e9d5caeab391f1f168f1c71d870949765671761551`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-020-01 | 拆除施工人工 | 只拆除图纸允许拆除的墙体或构件 | 按拆改图工程量报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-020-02 | 新建墙体和门洞处理 | 包含砌墙材料人工和需要的门洞顶部加固构件 | 按长度面积和门洞数量报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-020-03 | 室内装袋搬运和建渣外运 | 从室内装袋搬至物业指定点并按规定清运 | 按车次或合同包干报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-020-04 | 物业垃圾清运费核重 | 如果物业3000元收费中已含垃圾费，本项不得重复支付 | 以物业票据和施工合同核对 | 待报价/待算量 | duplication_check_required |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_demo_wall | critical/引用 | 拆除范围核对 | 对照拆墙图，用卷尺量拆除边界。<br>重点检查：是否多拆了不该拆的墙，尤其是承重墙。<br> | 拆除范围与图纸一致，误差 < 5cm | 照片或检测记录 | `763edf6b6a2e87901d26308a5049e8fee67da6462470434f15ddd36095821955` | pending |
| [ ] | check_demo_structure | critical/引用 | 梁柱状况检查 | 拆完后检查裸露的梁、柱、楼板是否有裂缝或损伤 | 无结构性裂缝，钢筋无锈蚀 | 照片或检测记录 | `5d9420ac7365b8aeabbcf344d6400ecd47624dbdd010f6cb152dfef672ab23bb` | pending |
| [ ] | SCH-020-01 | major/completion/阻塞解除后 | 新建墙体、门洞和现场清运完成 | 对照拆改图检查墙体位置、垂直平整、门洞尺寸、过梁及建渣清运 | 尺寸满足确认图纸且现场无遗留建渣 | measurement_record、completion_photos | `46ef2c677484d54c4d9d6794425a9cf7b6361b47f2713204c3b90ca2aa5cddf0` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-020-COMPLETE` 已由责任人确认。

<a id="pkg-030"></a>
## PKG-030｜中央空调第一次安装

- 通俗说明：在吊顶封闭前安装空调室内机、铜管、保温层、冷凝水排水管、风管和控制线，并完成压力保持、排水和检修空间检查。
- 预算：¥36,000；合同：¥36,000；已付：¥0；预测：—
- 依赖：PKG-020；就绪：`blocked`；执行：`not_started`
- 责任角色：空调商、设计师、施工方、业主；付款门槛：`GATE-030-FIRST-FIX`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-STRUCTURE、BLK-HVAC-DEEPENING、BLK-MEP-INTERFACE-FREEZE、BLK-SURVEY-DATA-FREEZE

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/hvac.yaml](../../config/hvac.yaml) | plan_ids=A2 | partial |
| [config/mep-hvac-coordination.yaml](../../config/mep-hvac-coordination.yaml) | layers=refrigerant,condensate,supply_air,return_air | partial |
| [config/electrical.yaml](../../config/electrical.yaml) | ids=sock_living_ac,sock_dining_ac,sock_master_ac,sock_parent_ac,sock_child_ac,sock_study_ac,sock_vrf_outdoor_a2,ac_panel_living,ac_panel_dining,ac_panel_master,ac_panel_parent,ac_panel_child,ac_panel_study | partial |
| [docs/pending-site-data.md](../../docs/pending-site-data.md) | 现场待测数据；按各项影响、状态和触发条件闭环 | site ledger |

当前项目数据指纹：`sha256:4514606237baf700e796ef2a2214c822296e105697eba9c2af036fbf53154b26`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-030-01 | 室外机和六台室内机 | 逐台写明品牌型号制冷量和保修 | 室外机1台加室内机6台 | 待报价/待算量 | contract_scope_pending |
| [ ] | — | COST-030-02 | 铜管保温冷凝水管和风管 | 写明基础包含长度和超长部分单价。‖ DEC-2026-10-04-R1/R2 核清：合同附件确认 **风口加长 100 元/米、复合风管、税均不含于 36,000**；冷媒管免费额度按同小区口径主铜管 ≤10m / 支管 ≤7m，本户实测主铜管 ≈9.8m 在内、仅书房支管 7.70m 超 0.7m（可忽略）。风管长度取决于餐区出风口是否西移避人——该措施已降为条件性（加长费 ≤1~2 百元才做），故本项金额须按最终风口布置图核定 | 按现场深化图实测与最终风口布置图 | 待报价/待算量 | site_measurement_pending |
| [ ] | — | COST-030-03 | 支架打孔风口和控制器 | 写明数量材质规格以及是否含安装 | 按深化图统计 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-030-04 | 第一次安装人工 | 吊顶封闭前安装内机和全部隐藏管线并完成测试 | 1次 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-030-05 | 第二次安装和系统调试 | 安装风口控制器并完成抽真空开机和整体调试，不是免费项目 | 1次 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-030-06 | 运输高空或超长管等可能增加费用 | 必须在合同中写明触发条件和单价 | 待现场确认 | 待报价/待算量 | risk_pending |
| [ ] | — | COST-030-07 | 六台空调线控器本体（型号/芯数/对码责任） | 业主 2026-10-12 口述「中央空调包含线控器」→路径 A（含在 36,000 内、增量 ¥0），路径 B 门店单买 ¥1,350–2,700 / C 业主自购 ¥900–1,800 退为后备。口述只闭「谁付钱」，四项仍开：① 型号必须 KJRF-90RT/MW（双出风专用彩屏）——90F1 是三代款、90E4 是二代玲珑/GC 款、KJR-90W/BK 是电商专供风管机款，错配驱动不了 /P-SS 双出风摆风与泵相关功能；② 数量 6 只（电商套装规律「线控器数=内机数」，但本户是经销商合同非电商一价全包含套装，不能直接套用）；③ 安装对码责任与是否另收费；④ 控制线芯数（同族 2/4/5 芯三种）——封槽后不可逆的唯一一项，config 已按「86 底盒+信号线管」预留但未定芯数。闭环句：「¥36,000 含 KJRF-90RT/MW ×6，控制线 × 芯，安装对码不再收费」，须合同附件或微信文字。3D 面板正式关闭（RFQ 第 53 行已把 /P-SS 与 3D 面板列为互斥可选项且已选 /P-SS，尺寸分级证据自相矛盾，客厅 71/餐厅 42 无明确型号）；第三方 86 盒面板/VRF 网关排除（无美的官方协议开放证据，结构性丢双出风与水泵控制、责任拆三方） | 6 只；型号与芯数待门店书面确认 | 待报价/待算量 | vendor_written_confirmation_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_hvac_weld | critical/引用 | 铜管焊接质量 | 检查焊接处有无氧化、砂眼 | 充氮焊接，无氧化皮 | 照片或检测记录 | `6c1e6b6aa5eabe057b44e85c28bbc09e29db5e8aabd76ce26e71c1dcacfe2277` | pending |
| [ ] | check_hvac_drain | critical/引用 | 冷凝水排水 | 内机注水测试 | 排水通畅无积水 | 照片或检测记录 | `3258623ad3ecaecbf3988b8794ba85b23dd5363847658ae1165b1917a4efb07f` | pending |
| [ ] | check_hvac_level | major/引用 | 内机水平度 | 水平尺测量四角 | 误差 < 2mm | 照片或检测记录 | `8fdc80c6e67b14ebfb7468201a42a603d510d6a0a3011ce2e8fca3c42d95a3b0` | pending |
| [ ] | check_hvac_outdoor | major/引用 | 外机散热 | 测量外机位通风尺寸 | 百叶通风面积 ≥ 80% | 照片或检测记录 | `49e9f3b5bddac93fcf6020e24c89f8714473cf5af0db3d91f960a530469d9709` | pending |
| [ ] | check_hvac_exhaust_outlet | major/引用 | 两卫浴霸排风管出外墙 φ100 防火止回阀，禁接公共烟道与排水立管 | 1. 两卫浴霸换气模块排风管各自由最短路径出外墙，外墙孔处装 φ100 防火止回阀（带逆止叶片）。<br>2. 排风管严禁接入公共烟道与排水立管：接排水立管会返臭串气，接公共烟道会倒灌并与油烟互相串味。<br>3. 外墙开孔须留物业/外立面审批记录（孔位、孔径、恢复与配色方案），未取得审批不得开孔。<br>4. 管路过墙处套管、坡度向外；软管与阀体连接处抱箍锁紧，不得折扁，不得在内墙折 90° 死弯。<br> | 两处 φ100 防火止回阀安装到位；无接入公共烟道与排水立管；外墙开孔有审批记录 | 排风管路径照片（吊顶内段 + 出墙段）、外墙防火止回阀安装照片（含外立面）、物业/外立面审批记录扫描件 | `cd510ab80acbf811a9a15e6b995a64fbd1635dcd9e15db5ad38fdc30c66b4242` | pending |
| [ ] | check_elec_ac_service_access | major/引用 | 六台内机供电硬接线或下引带盖 86 盒（回风检修格栅旁）+ 检修断电位 | 1. 六台内机供电改为硬接线，或从接线位下引至吊顶完成面以下 0.3–0.5m，装带盖 86 盒。<br>2. 86 盒紧邻回风检修格栅，不得在吊顶空腔内盲插，不得被出风口、灯带或柜体遮挡。<br>3. 每台内机就近设检修断电位（与 86 盒同区或与线控面板同侧），断电后能从格栅处伸手触及。<br>4. 吊顶封板前逐台拍照，记录盒位与回风格栅的相对位置；逐台回路编号写入配电箱回路标签。<br> | 六台内机无吊顶空腔内盲插；86 盒在完成面下 0.3–0.5m 且带盖；每台有可及的检修断电位 | 每台内机供电 86 盒与回风格栅相对位置照片（逐台六张）、检修断电位照片、配电箱回路标签与点位对照照片 | `1b3c806b353e2d0548b86d5b90d98b5f68007460184234a3306858fed3fcc898` | pending |
| [ ] | SCH-030-01 | critical/before_covering/阻塞解除后 | 冷媒管保压和记录完整 | 按设备厂家书面工艺进行保压并记录压力、开始时间、结束时间和环境条件 | 厂家工艺要求满足且无可见泄漏；记录经空调商和业主确认 | pressure_test_record、gauge_photos | `a05452fb31702622bdf763f05a690b470e40cf637801315654600b5ab578dcfd` | pending |
| [ ] | SCH-030-02 | critical/before_covering/阻塞解除后 | 冷凝水排放测试完成 | 逐台内机注水，观察坡向、接头、排放点和末端出水 | 排水连续通畅、无倒坡、无积水、无渗漏 | drainage_test_video、concealed_work_photos | `308de0ab54274f926d8354c6431ee763f1149a14f0f68b1bd034cb2f6ac78b0f` | pending |
| [ ] | SCH-030-03 | critical/before_covering/阻塞解除后 | 风口、回风路径和检修空间确认 | 现场核对吊顶完成面、风口尺寸、回风路径、检修口及与灯具柜体的关系 | 所有内机可检修，风口与灯具柜门无冲突，相关方签认 | coordination_record、dimensioned_photos | `6aa4c834bbb9c025fba30d0b1626bd5d966386807f01b5d92a4ae6fa8c314ce7` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-030-FIRST-FIX` 已由责任人确认。

<a id="pkg-040"></a>
## PKG-040｜水电改造

- 通俗说明：根据家具和设备位置铺设电线、网线、给水管、排水管和热水回水管，设置插座、开关及专用电路；封墙封地前必须测试并拍照定位。
- 预算：¥15,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-020；就绪：`blocked`；执行：`not_started`
- 责任角色：水电施工、设计师、空调商、业主；付款门槛：`GATE-040-HIDDEN-WORK`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-HVAC-DEEPENING、BLK-MEP-INTERFACE-FREEZE、BLK-CABINET-FREEZE-FOR-MEP、BLK-SURVEY-DATA-FREEZE

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/electrical.yaml](../../config/electrical.yaml) | all=true | partial |
| [config/plumbing.yaml](../../config/plumbing.yaml) | all=true | partial |
| [config/electrical-topology.yaml](../../config/electrical-topology.yaml) | all=true | partial |
| [config/mep-hvac-coordination.yaml](../../config/mep-hvac-coordination.yaml) | layers=strong_power,weak_power,water_supply,drainage | partial |
| [docs/pending-site-data.md](../../docs/pending-site-data.md) | 现场待测数据；按各项影响、状态和触发条件闭环 | site ledger |

当前项目数据指纹：`sha256:89b3920bf571ad6c5eb2f093517d2fa08229203854080d93d14b14b4eb305d36`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-040-01 | 给水管改造 | 冷水和热水管材接头阀门以及安装人工 | 按管长和接口数量报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-040-02 | 排水管改造 | 厨房卫生间和设备排水管及防臭连接 | 按管长管径和排水点报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-040-03 | 热水回水管预埋 | 只包含循环管路预埋，不默认包含热水器或循环设备 | 按管长和接口报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-040-04 | 普通照明和插座线路 | 电线线管底盒和安装人工，不含最终灯具及开关插座面板 | 按回路点位和线长报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-040-05 | 大功率设备专用线路 | 中央空调厨房设备热水器等独立线路 | 按设备功率和回路数量报价 | 待报价/待算量 | equipment_parameters_pending |
| [ ] | — | COST-040-06 | 网络和电视信号线路 | 网线信息面板弱电箱整理和必要测试 | 按信息点和线长报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-040-07 | 智能开关零线窗帘电源和传感器预留 | 只做线路和安装位置预留，不含二期窗帘电机和复杂智能设备 | 按确认点位报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-040-08 | 开槽封槽打孔及测试人工 | 明确是否已含在各线路单价内，避免重复收费 | 按合同说明 | 待报价/待算量 | duplication_check_required |
| [ ] | — | COST-040-09 | 燃气管道改造或移位费 | 燃气管道改动按规定须由燃气公司或其授权单位施工，单独报价单独结算，不得并入水电人工 | 以燃气公司书面报价为准（参考同类实付约570元） | 待报价/待算量 | quote_pending |
| [ ] | — | COST-040-10 | 强电箱更换或上移（双排） | 现状390mm箱体单排约20位、扣2P进线开关与浪涌后约16位可用，20路确定装不下：必须双排或换箱，且双排箱底边不低于1.60米、单排不低于1.80米（GB 55038 7.4.3-2）。本项是本包最容易在结算时才冒出来的增项 | 模数由 npm run takeoff:mep 派生（当前28模数=20回路+2P进线+SPD再留20%余量）；箱体单双排以量房开箱复测为准（pending-site-data 第30） | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-040-11 | 局部等电位端子箱与联结线 | 两卫各设LEB端子箱；联结干线BV-6mm²黄绿线、逐件联结BVR-2.5~4mm²沿墙脚暗敷，联结点去漆压接；须联结给水管角阀与软管金属段、金属地漏篦子与排水口、花洒金属杆与软管、龙头、毛巾架、浴霸金属外壳、金属镜柜。防水层施工前完成、不可补埋 | 2套，数量由 config/mep-takeoff.yaml declared_devices 声明（依据 config/acceptance.yaml check_elec_leb 与 check_elec_leb_bonding_list）；端子箱位置见 pending-site-data 第43 | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-040-12 | 燃气报警器与电磁切断阀 | 厨房设可燃气体报警并与电磁切断阀联动；型号、安装位与燃气公司验收要求须先确认 | 1套，型号与位见 pending-site-data 第32，数量由 declared_devices 声明（依据 config/acceptance.yaml check_elec_gas_alarm） | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-040-13 | 入户阀件三件套 | 入户总阀DN20全径通径、可调减压阀设定0.25兆帕并锁紧调节螺母、反冲洗前置过滤器位带专用排污口与旁通三通；即使本期不装前置机，三通与排污管也必须埋到位以保证后期可在线拆洗不断全屋水。前置过滤器本体属设备不在本项 | 1套，数量由 declared_devices 声明（依据 config/acceptance.yaml check_plumb_prefilter_and_prv） | 待报价/待算量 | quote_pending |
| [ ] | — | COST-040-14 | PPR热水管保温套管 | 热水管与回水管保温；冷凝水管保温归中央空调合同（COST-030-02），本项不重复计取 | 米数由 takeoff 给水冷热水桶派生（当前mixed/20与hot桶合计约23.7米，含1.08损耗） | 待报价/待算量 | quote_pending |
| [ ] | — | COST-040-15 | 封槽料与阴阳角网格布 | 开槽回填水泥或石膏、阴阳角PVC角条与接缝网格布；属水电开槽后的收口，与PKG-080基层修补的边界须书面划清，防止两边都说含 | 按开槽米数包干（开槽长度由施工方按放线图报，业主以隐蔽照片核） | 待报价/待算量 | interface_pending |
| [ ] | — | COST-040-16 | 穿墙套管与防火封堵 | 新建隔墙砌筑时预埋线管与套管（不后剔）、穿越外墙与结构墙的套管、穿墙孔防火封堵泥；new_partition 预埋属本项目铁律 | 穿墙孔个数由 takeoff 派生（当前35孔）；新建隔墙预埋按拆改图（PKG-020）界面划分 | 待报价/待算量 | interface_pending |
| [ ] | — | COST-040-17 | 浴霸排风管与外墙防火止回阀 | 两卫浴霸排风管出外墙、φ100防火止回阀与套管、外立面开孔（需物业核定）；验收项check_hvac_exhaust_outlet目前只挂在PKG-030，施工与材料由本项承接 | 2套，数量由 declared_devices 声明（依据 config/acceptance.yaml check_hvac_exhaust_outlet） | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-040-18 | 辅材与耗材包干 | 接线端子、管卡、胀塞、PVC胶水、绝缘胶带、生料带、黄腊管、穿线钢丝；须明确施工方含还是业主另购，禁止与各主材项重复计取 | 包干；若施工方口径为辅材另计，须在报价单逐项列并同类项合并 | 待报价/待算量 | duplication_check_required |
| [ ] | — | COST-040-19 | 二级浪涌保护器 | 强电箱内二级SPD；20路加2P进线开关加浪涌对390mm箱体需双排，SPD与换箱决策联动。2026-10-12 分层复核：¥120/只 对正泰口径偏上但在合理上限（NXU-Ⅱ 20kA/275V 2P 京东比价最低 ¥78.68、NXU-ⅡG-40kA 到手 ¥74.91 → ¥75–120），对施耐德口径严重偏低（R9L01050 划线 ¥508.53/到手 ¥346 → ¥346–509），须分层写。另：该行未含 SPD 前级过电流保护器（GB 18802.1/GB 50057 要求），若单设 2P 32A 则 +1 只/+2 模数；正泰 NXU-Ⅱ 2P = 18mm = 1 模数，已验证 mep-takeoff.yaml 的 spd_modules: 1 假设成立 | 1只；若开发商原有箱体已带SPD则本项核减，须拍照存证 | 待报价/待算量 | site_measurement_pending |
| [ ] | — | COST-040-20 | 家用断路器与漏电保护器（20 回路） | 此前无成本行（COST-040-10 只覆盖箱体）。按 config/electrical-topology.yaml 20 条回路实算：4 路照明 1P C16 + 16 路 1P+N 漏保（C16×5/C20×10/C32×1，C32 为中央空调外机 20kW proposed）+ 1×2P 63A 进线 + 1×SPD。正泰中档 ¥700–1,000（NXBLE-40 1P+N ¥29.42–47.13、NXB-63 1P C16 ¥8.5–18.9、NB3-63 2P 63A ¥34.9–46.61、NXU-Ⅱ SPD ¥74.91–78.68）；施耐德/ABB 上位 ¥1,800–3,000（iC65N 1P ¥21.91–38.99、Acti9 iDPNa Vigi+ 1P+N ¥74.27–129、R9L01050 SPD ¥346–508.53）；差 ¥1,100–2,000 须业主裁定档位。三条合同硬边界：① 必须写明「1P+N 一体式漏保（18mm）」而非「空开+漏保附件拼配」——28 模数只在前者成立，拼配则 4+16×2+2+1 = 38 位，双排也未必够；② 必须写清「含/不含空开」（config/mep-labor.yaml 已警告市面「元/米」报价多含配件/空开，与自购材料不可相加），最稳为混合——师傅供 1P 微断、漏保业主自购（差价最大、假货风险最高，要求逐只防伪码首次查询通过）；③ 甲方自购器件时乙方不得以配件费/空开费/总闸费/箱内器件费等任何名目重复计取。规格反转：进线 27.9kW 与 ≥10mm² 单相约 11kW 无法自洽，若三相进户则总开/SPD 极数/双排结论全部重算（pending-site-data #45）；空调外机若铭牌最大输入接近三代 8.56kW/39A，则 C32A+4.0mm² 不合格需升 C40/C50+6mm² | 22 只（20 回路 + 2P 进线 + SPD 前级如单设另计） | 待报价/待算量 | quantity_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_plumb_pressure | critical/引用 | 水管打压试验 | 1. 堵住所有出水口，接打压泵<br>2. 加压至 0.8MPa<br>3. 保压 30 分钟，观察压力表<br> | 0.8MPa 保压 30min，压降 ≤ 0.05MPa，接头无渗漏 | 照片或检测记录 | `70d928fb667c3bf68bfdcdeb2da20e393882336b065ff4df41fb9a0ede5ef3df` | pending |
| [ ] | check_plumb_drain | critical/引用 | 排水坡度与存水弯 | 检查排水管坡度、地漏/下水存水弯 | 排水坡度 ≥ 1%，地漏/下水有存水弯防臭 | 照片或检测记录 | `2432cd3bfddb3163a3e83739e8d1a04504cb9364b7120d37150a446dd4ecae8e` | pending |
| [ ] | check_elec_continuity | critical/引用 | 通断测试 | 用测电笔逐个插座测试 | 全部通电，零火线正确 | 照片或检测记录 | `825edfc3788627e32b49427540bb9607a2959a13319bade3ce3b096014e93663` | pending |
| [ ] | check_elec_switch | major/引用 | 开关功能 | 逐个开关测试 | 双控/单控功能正常 | 照片或检测记录 | `985ef2e6ce38dadb99a7cbc1e6a3502aef8d2ca7e2bc5ab433e5e76f23fd9f1f` | pending |
| [ ] | check_elec_pe_polarity | critical/引用 | PE 接地连续性与相/零/地极性 | 1. 用验电插座或万用表逐个点位核对 L/N/PE 极性（左零右火上地）。<br>2. 抽查 PE 干线连续性：配电箱 PE 汇流排 → 各插座 PE 端子，应导通。<br>3. 重点抽测五处：电视墙高位、厨房台面两个取电区、主卫/客卫智能马桶位、阳台洗烘位。<br> | 极性全部正确；PE 连续性导通，无断零、无 PE 借用 | 照片或检测记录 | `b2b25c725934969bbf6504383363cc633150298d065e908d0f14878dbadceeb4` | pending |
| [ ] | check_elec_insulation | critical/引用 | 绝缘电阻测试 | 1. 断电，拆下灯具/电器负载，兆欧表 500V 档逐回路测 L-L、L-PE、N-PE。<br>2. 记录每条回路的读数并贴回路编号。<br>3. 发现读数偏低的回路分段排查接头与破损点。<br> | 各回路绝缘电阻 ≥ 0.5MΩ（潮湿区域不应明显低于此值），记录留档 | 照片或检测记录 | `3a4987c5a95c531dfd65962b6c69e6e40b6f5d93d4f0aee457d61d3369c5a71d` | pending |
| [ ] | check_elec_rcd_30ma | critical/引用 | 30mA 漏电保护动作测试 | 1. 用剩余电流动作测试仪（或漏电保护测试仪）逐回路测试，不只看箱内"试验按钮"。<br>2. 记录 IΔn（额定动作电流）与实际动作值/时间。<br>3. 逐回路按"该回路任一插座动作、其余回路不受影响"验证选择性与分区。<br> | 每个电源插座回路动作电流 ≤ 30mA，动作可靠、能正确复位 | 照片或检测记录 | `ec23b8df41d37e7950d151967d3115a6b40419ea347ca7d51506b2e062143856` | pending |
| [ ] | check_elec_leb | critical/引用 | 卫生间局部等电位联结 | 1. 检查两卫是否设局部等电位端子箱（LEB）。<br>2. 抽查联结：花洒、龙头、毛巾架、洗衣机金属外壳、给排水金属件与 LEB 端子用 6mm² 黄绿线联通。<br>3. 测导通电阻并拍照。<br> | 端子箱存在；抽查点全部导通；标识清晰 | 照片或检测记录 | `da242cb0bada7859166fbc773882383fe74ae2128aec419e30574ba39b340f37` | pending |
| [ ] | check_elec_strong_weak_separation | major/引用 | 强弱电分管、间距与管内填充率 | 1. 检查强电与弱电（网线/电视线）是否分管敷设，交叉是否成直角。<br>2. 检查管内导线总截面不超过管内截面 40%（同回路导线同管）。<br>3. 抽查电视墙高位到电视柜的独立穿线管是否单独一管。<br> | 强弱电分管；平行间距按交底口径执行；填充率 ≤40% | 照片或检测记录 | `2e1f58a7b3f6ff044503abef134f45eeefba4b5415e979b44f07c2f4d1f36b35` | pending |
| [ ] | check_elec_panel_labeling | major/引用 | 配电箱标识、进线开关与安装高度 | 1. 开箱核对箱内每条断路器与回路标签一一对应，贴回路图（须含中央空调外机专用回路）。<br>2. 确认有能同时断开相线和中性线、具隔离功能的进线开关，以及短路/过负荷保护。<br>3. 复量箱体安装高度与单/双排布置。<br>4. 核对进线铜芯截面。<br> | 标签与图纸一致；有进线开关与保护；单排布置底边 ≥1.80m、双排 ≥1.60m；进线 ≥10mm² 铜芯（本户 20 路，含中央空调外机专用回路） | 照片或检测记录 | `25cde211c6430459fa6001284f8b6a46c3474bb53afe662abf77fe15098d4f53` | pending |
| [ ] | check_elec_circuit_separation | major/引用 | 分路合规核对（GB 55038 7.4.4） | 按配电箱回路标签逐条核对五类回路是否分别设置：照明 / 空调电源插座 / 电热水器等 2kW 及以上<br>用电设备 / 厨房内电源插座 / 其他功能用房电源插座。本户 20 路重点核对：中央空调外机专用回路<br>（hvac_power_outdoor_a2）是否单独成路、洗碗机/冰洗/卫浴是否各自独立、厨房与客餐厅/卧室是否<br>未跨类混接、以及每条回路标签是否与 config/electrical-topology.yaml 一致。<br> | 五类回路分别设置、无跨类混接；回路标签与 config/electrical-topology.yaml（20 路）一致 | 照片或检测记录 | `147447c2cfc393520c54c70694d89291cdbf586b75797e0daa6b4be75aea1e13` | pending |
| [ ] | check_elec_gas_alarm | major/引用 | 燃气报警器位置与联动切断 | 1. 复量探测器安装高度与水平位置。<br>2. 联动测试：触发报警，确认紧急切断阀动作。<br>3. 与燃气公司验收记录比对。<br> | 天然气近顶安装（顶棚或距顶棚 ≤0.3m）；距灶具与排风口 >0.5m；不在灶具正上方；联动切断可靠 | 照片或检测记录 | `464c8ead9f70cd0eef4072b3796f23b56e71ed747371a4092f90220c615738c7` | pending |
| [ ] | check_plumb_prefilter_and_prv | major/引用 | 入户总阀 DN20 + 可调减压阀 0.25MPa + 反冲洗前置过滤器位（带排污与旁通三通） | 1. 给水入户点之后按「总阀 → 减压阀 → 前置过滤器位」顺序安装；总阀通径 DN20 全径，不得缩径。<br>2. 减压阀设定 0.25MPa 后锁紧调节螺母，拍照记录表盘读数。<br>3. 前置过滤器位带专用排污口与旁通三通：即使本期不装机，三通与排污管也必须埋到位，保证后期可在线拆洗、不必断全屋水。<br>4. 卷尺复量阀件间距与柜内/管井检修净空，确认拆芯、换滤芯不必拆相邻设备。<br> | DN20 全径总阀；减压阀可调并设定 0.25MPa；前置位有排污与旁通三通，具备在线拆洗条件 | 入户阀件安装位全景照片（阀件顺序可辨）、减压阀设定值表盘照片、前置位旁通三通与排污口特写照片 | `8d38873d50b73bde517fb1d565d820037589889f0d3f2aca7345e739b2857377` | pending |
| [ ] | check_plumb_softener_reserved | major/引用 | 软水机柜格预留：≥400×500mm + 排污管 + 旁通三通（不装机也埋三通） | 1. 在前置过滤器位邻侧留一个 ≥400×500mm（宽×深）的软水机柜格，柜内预埋进出水三通并带旁通三通。<br>2. 柜内同时预埋一根排污管，接下水或专用排水点，不得用盆接。<br>3. 按"本期不装机也埋到位"验收：后期加装软水机不得破柜、破墙、破台面。<br>4. 卷尺复量柜格净空，须扣掉柜门开度、踢脚线、后背板与相邻阀件占用后的净尺寸。<br> | 柜格净空 ≥400×500mm；旁通三通与排污管预埋到位；后期加装不破坏柜体与墙地面 | 柜格净空测量照片（卷尺入镜，含净尺寸读数）、三通与排污管预埋特写照片 | `d570371a32ffda084ea5dd37a208b81503f039a79ec16ad233f8ebb1159050c4` | pending |
| [ ] | check_plumb_valve_per_point | major/引用 | 每个用水点一只全铜角阀（含洗衣机快接、洗碗机/净水器三通）+ 硬接编织管 | 1. 按用水点清单逐个核对：每个冷/热出水点配一只全铜角阀，一处不许缺。<br>2. 洗衣机位用专用快接角阀；洗碗机、净水器进水用三通角阀；智能马桶位角阀与同柱插座按既定分层口径错开。<br>3. 角阀到龙头/设备一律硬接编织管（螺纹加橡胶垫压紧）；严禁普通软管直接插接进水口。<br>4. 手扳每处接头检查螺纹扣数，查看编织管端口金属丝未被剪断、管身无折扁。<br> | 用水点角阀一只不少且为全铜；洗衣机/洗碗机/净水器用对应专用角阀；连接为硬接编织管，无软管直插 | 按房间编号的每个用水点角阀特写照片、编织管接头特写照片（可见压紧螺纹） | `fd8f82c137ce4a3e44deb092b5c02426d9451d6362101079deba321b361f4b30` | pending |
| [ ] | check_elec_zero_line_all_switches | major/引用 | 全盒零线：每个开关底盒 3 根 1.5mm²（L/N/灯控） | 1. 封槽前逐个开关底盒开盖核线：全屋每一个开关底盒内穿 3 根 1.5mm²（L / N / 灯控），缺零线的底盒当场补穿，不得封墙后再说。<br>2. 筒灯、灯带、浴霸线控面板同样留零线（线控面板从 N 取电，不借用灯具线）。<br>3. 万用表复测：盒内 N 与同回路 N 导通，L-N 间不短路，并核对线色与线径。<br>4. 按 DEC-2026-10-06-R2 登记的开关/面板点位清单逐点勾选，漏一处即不合格。<br> | 全部开关底盒与灯控面板含零线；零线导通、无借用、无短路 | 逐个底盒开盖照片（可见 3 根线）、万用表导通/不短路读数照片、开关与面板点位清单逐点勾选记录（水电交底单） | `93e9f213e71bf7ee473b9fbf646c0861d2deabbf322a1e3b4c8989315207f168` | pending |
| [ ] | check_elec_leb_bonding_list | critical/引用 | 两卫 LEB 端子箱 + BV-6mm² 黄绿联结干线 + 待联结金属构件清单（防水层施工前完成） | 1. 两卫各设局部等电位端子箱（LEB），位置避开柜门开启区与贴砖完成面，位置口径见 docs/pending-site-data.md #43。<br>2. 联结干线用 BV-6mm² 黄绿线；逐件联结用 BVR-2.5~4mm² 沿墙脚暗敷，联结点去漆压接。<br>3. 按清单逐件核：给水管角阀与软管金属段、金属地漏篦子与排水口、花洒金属杆与软管、龙头、毛巾架、浴霸金属外壳、金属镜柜。<br>4. 入户给水管/燃气管若为金属材质，须与接地装置联结（GB 55038-2025 7.4.7）。<br>5. 全部联结与导通测试在防水层施工前完成并拍照；封墙、贴砖后不得补埋。<br> | 端子箱存在；清单内金属构件全部联结；导通合格；防水层施工前完成并有工序交接照片 | LEB 端子箱位置照片（两卫各一张）、联结干线沿墙脚敷设照片、清单内每一类金属构件的联结点特写、导通测试读数记录、防水施工前后工序交接照片 | `055d5de7526a9c26c5d0a772acab69fb222122a5557b73ba91b7d6a3d4ae0baf` | pending |
| [ ] | SCH-030-04 | critical/before_covering/阻塞解除后 | 空调与水电联合交底记录归档 | 空调商提供内机与接管清单（机身尺寸、供电取电方式、检修口、冷凝水接点），与水电点位表和吊顶分层标高逐项核对并四方签认 | 签认记录覆盖全部六台内机与外机，供电回路、控制线、冷凝水接入点与分层标高无冲突 | coordination_record、circuit_schedule、signed_interface_sheet | `a34333e3b11a8c6291b511310a8428c0fb6a038c05f8ea0b5401dc7f06a69d40` | pending |
| [ ] | SCH-040-01 | critical/before_covering/阻塞解除后 | 点位和回路与家具、家电及空调匹配 | 按空间逐点核对位置、用途、回路、线径、控制关系和设备功率资料 | 不存在无用途点位、缺失点位或与固定设施冲突的点位 | point_schedule、circuit_schedule、marked_site_photos | `88203d8328733420114fd06a0f4d3a233c5be8d762d06e36a1d691c0eaad0731` | pending |
| [ ] | SCH-040-02 | critical/before_covering/阻塞解除后 | 隐蔽管线影像归档 | 每面墙和地面拍摄全景、局部及带尺寸定位照片 | 照片可定位每条管线且文件路径已登记 | concealed_work_photos | `067af71b59eae46bc5c0eb9cf34e5b21e89696f22fba749555042a653f4eab6b` | pending |
| [ ] | SCH-040-03 | critical/before_covering/阻塞解除后 | 水电与空调、橱柜接口冻结完成 | 核对 BLK-MEP-INTERFACE-FREEZE 与 BLK-CABINET-FREEZE-FOR-MEP 的解除证据：联合交底签认记录、橱柜深化图与点位表双向核对结论 | 两项阻断均有书面解除证据，微蒸烤预留点位、分层标高、穿墙孔位高度与冷凝水接点已落实到交底单 | signed_interface_sheet、cabinet_drawing_reference、briefing_sheet | `066dc4e1983d314e0c6a388dd3187314201a68c14d6124515d4925d5f9218f92` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-040-HIDDEN-WORK` 已由责任人确认。

<a id="pkg-050"></a>
## PKG-050｜防水及闭水

- 通俗说明：在卫生间、厨房和北阳台等需要防水的位置处理基层、涂刷防水材料并蓄水检查，确认本层和楼下都不渗漏后才能覆盖。
- 预算：¥5,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-040；就绪：`blocked`；执行：`not_started`
- 责任角色：防水施工、施工方、业主；付款门槛：`GATE-050-FLOOD-TEST`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/model-geometry.yaml](../../config/layout/model-geometry.yaml) | room_ids=master_bath,guest_bath,kitchen,balcony | partial |
| [config/plumbing.yaml](../../config/plumbing.yaml) | room_ids=master_bath,guest_bath,kitchen,balcony | partial |
| [config/layout/overlay.yaml](../../config/layout/overlay.yaml) | room_ids=master_bath,guest_bath,kitchen,balcony; types=floor_region,wall_region | partial |

当前项目数据指纹：`sha256:7e0f5c9a8455ca11ce8e1730ed1cf1e05c3c9a1e4e9726f6b8655d9a0e830853`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-050-01 | 两个卫生间防水 | 地面墙面管根门槛和墙地交界处理 | 待量房后按面积高度和涂刷遍数报价 | 待报价/待算量 | site_measurement_pending |
| [ ] | — | COST-050-02 | 厨房和北阳台防水 | 按确认范围处理地面墙脚和设备接口 | 待量房和范围确认 | 待报价/待算量 | site_measurement_pending |
| [ ] | — | COST-050-03 | 闭水试验及问题重做责任 | 写清测试时长、楼下检查和不合格后的返工责任 | 包含在防水合同中 | 待报价/待算量 | contract_scope_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_wp_coats | critical/引用 | 涂刷遍数检查 | 墙面防水：淋浴区刷到不低于 2.00m、且不低于喷淋口高度，地面满刷。<br>每一遍干透后再刷下一遍，至少 2 遍。<br> | 涂刷均匀，无漏刷、无堆积；淋浴区墙面防水高度 ≥2.00m 且不低于喷淋口高度 | 照片或检测记录 | `031815a29ab6e2e2693b57b5cc0526a38f750f26dcde5127e2bd95e7ae5916ec` | pending |
| [ ] | check_wp_flood | critical/引用 | 闭水试验 | 1. 堵住所有地漏，放水 3~5cm 深<br>2. 标记水位线<br>3. 等待 48 小时<br>4. 去楼下邻居家看天花板有无渗水<br> | 48h 后水位无明显下降，楼下无渗水 | 照片或检测记录 | `6859d13f44e3e4df1965bcd43d1618ee0ebb825df6c017964f6fe44041472136` | pending |
| [ ] | check_plumb_master_bath_secondary_drain | critical/引用 | 主卫沉箱二次排水 DN50（最低处）+ 1% 找坡 + 轻质回填 + 回填前通球 | 1. 同层排水沉箱内最低处设 DN50 二次排水口，与马桶排污口、地漏支管各自独立，不得并入地漏或马桶排污。<br>2. 沉箱底向二次排水口找坡 1%：泼水试验水应全部流向二次排水口，不得积在角落。<br>3. 回填前做通球试验（球能顺利通过支管进入立管）。<br>4. 回填只用轻质材料（陶粒/泡沫混凝土等），严禁建筑垃圾、砖渣回填。<br>5. 坡度/通球/回填材料三类工序证据齐了、且沉箱蓄水试验（下条）通过后才能回填；回填后本项不得补做。<br> | 二次排水口在沉箱最低处；坡度 ≥1%；通球顺畅；轻质回填、无建渣 | 泼水找坡照片（含二次排水口位置）、通球过程照片、回填材料照片（可见轻质材料） | `00f15fadb845add61fd764c3871e4e926a95b075b41cedf4c2dab7b7fcfd64b5` | pending |
| [ ] | check_plumb_master_bath_box_flood | critical/引用 | 主卫沉箱蓄水试验（回填前 24h） | 1. 蓄水前先封堵沉箱内全部排水口——含二次排水口、地漏支管口与马桶排污预留口，逐口查封堵严密；二次排水口不封堵，蓄水会经二次排水支管流失，试验无效。<br>2. 向沉箱注水做 24h 蓄水试验，标记起始水位线。<br>3. 24h 后查水位无明显下降，并到楼下看对应天花无渗漏、无湿痕。<br>4. 试后放水，拆除全部封堵、恢复二次排水口，向二次排水口注水复核其畅通（顺畅流入、无返溢）；封堵未拆净或复核不畅通，不得回填。<br>5. 不合格先查漏整改，复验重新计时；记录追加，不覆盖前次结果。<br>本条与上一条的通球/找坡（排水通畅性）分开记录、分开留证，不得互相替代。<br> | 蓄水 24h 水位无明显下降；楼下天花无渗漏、无湿痕；试后封堵全拆、二次排水口恢复畅通 | 封堵口全景/逐口照片（二次排水口、地漏支管口、马桶排污预留口全部封堵口可见）、起始水位线照片、24h 水位线照片、楼下天花无渗漏照片、试后拆堵恢复与二次排水畅通复核照片 | `44101b6f012c1565fd09d4ca53b9ef9245d049030b641b4e062741152186f10a` | pending |
| [ ] | check_plumb_guest_bath_secondary_drain | critical/引用 | 客卫沉箱二次排水 DN50（最低处）+ 1% 找坡 + 轻质回填 + 回填前通球 | 1. 同层排水沉箱内最低处设 DN50 二次排水口，与马桶排污口、地漏支管各自独立，不得并入地漏或马桶排污。<br>2. 沉箱底向二次排水口找坡 1%：泼水试验水应全部流向二次排水口，不得积在角落。<br>3. 回填前做通球试验（球能顺利通过支管进入立管）。<br>4. 回填只用轻质材料（陶粒/泡沫混凝土等），严禁建筑垃圾、砖渣回填。<br>5. 坡度/通球/回填材料三类工序证据齐了、且沉箱蓄水试验（下条）通过后才能回填；回填后本项不得补做。<br> | 二次排水口在沉箱最低处；坡度 ≥1%；通球顺畅；轻质回填、无建渣 | 泼水找坡照片（含二次排水口位置）、通球过程照片、回填材料照片（可见轻质材料） | `ffb4c1a21dbfbd6539fe464f33238526b101606b31cd1b33c8d5a25b66768305` | pending |
| [ ] | check_plumb_guest_bath_box_flood | critical/引用 | 客卫沉箱蓄水试验（回填前 24h） | 1. 蓄水前先封堵沉箱内全部排水口——含二次排水口、地漏支管口与马桶排污预留口，逐口查封堵严密；二次排水口不封堵，蓄水会经二次排水支管流失，试验无效。<br>2. 向沉箱注水做 24h 蓄水试验，标记起始水位线。<br>3. 24h 后查水位无明显下降，并到楼下看对应天花无渗漏、无湿痕。<br>4. 试后放水，拆除全部封堵、恢复二次排水口，向二次排水口注水复核其畅通（顺畅流入、无返溢）；封堵未拆净或复核不畅通，不得回填。<br>5. 不合格先查漏整改，复验重新计时；记录追加，不覆盖前次结果。<br>本条与上一条的通球/找坡（排水通畅性）分开记录、分开留证，不得互相替代。<br> | 蓄水 24h 水位无明显下降；楼下天花无渗漏、无湿痕；试后封堵全拆、二次排水口恢复畅通 | 封堵口全景/逐口照片（二次排水口、地漏支管口、马桶排污预留口全部封堵口可见）、起始水位线照片、24h 水位线照片、楼下天花无渗漏照片、试后拆堵恢复与二次排水畅通复核照片 | `f9b7b0c86a64aad5ee4734ef15395cce1ae8dda890ab28a7fecfd0a24e278a6a` | pending |
| [ ] | check_plumb_external_vanity_waterproof | critical/引用 | 两处外移位（主卧条带 + 客卫开放洗漱区）防水连体 + 柜内防漏水托盘 + 基站柜格溢水报警 | 1. 两处外移位台盆后墙面防水刷到不低于 1.20m 高，其余墙面 0.3–0.5m（含柜体背板与台面以下墙体）；地面做防水挡水坎，与卫内防水连成整体，不得在两套防水之间留施工缝。<br>2. 柜内设不锈钢或 PP 防漏水托盘，托盘带导流嘴，把意外溢水导向可见处或排水点，不是让水泡柜底板。<br>3. 客卫开放洗漱区下方扫地机基站柜格设溢水报警，探头放在柜底最低处。<br>4. 防水施工前先拍挡水坎与泛水收头；柜体与基站安装后复核托盘就位、报警器可触发。<br> | 两处外移区台盆后墙面防水 ≥1.20m、其余墙面 0.3–0.5m；挡水坎与卫内防水连续无断点；托盘带导流嘴且就位；基站柜格溢水报警可触发 | 防水施工前的挡水坎与泛水收头照片（两处各一套）、柜内防漏水托盘就位照片（导流嘴可辨）、基站柜格溢水报警探头位置与触发测试照片 | `d82e6ea8c1dee07af8847cf332827f9310d32455a691ee237f6a6d7b46885b62` | pending |
| [ ] | SCH-050-01 | critical/before_covering/阻塞解除后 | 防水范围和节点有施工前后记录 | 核对两卫、厨房、北阳台及门槛、管根、墙地交界加强处理 | 范围与确认图纸及产品工艺一致，照片可追溯 | waterproof_before_photos、waterproof_after_photos | `7c819edec4c5667f6f014d5de47b65f0c18c0bbbd42ac47940f5b90bfeab7b38` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-050-FLOOD-TEST` 已由责任人确认。

<a id="pkg-060"></a>
## PKG-060｜泥瓦与铺贴

- 通俗说明：修正墙地面高低差，铺贴地砖、全屋已声明墙砖与窗边防水台砖，处理门槛、地漏坡度、砖缝及边角；重点检查空响、平整和排水积水。
- 预算：¥30,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-050；就绪：`blocked`；执行：`not_started`
- 责任角色：泥瓦施工、设计师、业主；付款门槛：`GATE-060-COMPLETE`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-SOUTH-BALCONY

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/model-geometry.yaml](../../config/layout/model-geometry.yaml) | collections=rooms | mapped |
| [config/layout/overlay.yaml](../../config/layout/overlay.yaml) | types=floor_region,wall_region,sill_region | mapped |

当前项目数据指纹：`sha256:5cf50a9211d89acfa0c859cbde85d77a0a0bc0bb571384737d16ac32fdaa0b0d`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-060-01 | 地砖和墙砖主材 | 按房间记录品牌型号规格数量损耗和补货规则；2026-10-03 轮次登记诺贝尔方向封顶20,000元（cap，非成交价），待门店确认型号、同批、损耗、配送与退补。2026-10-07（DEC-2026-10-07-R05）口径澄清：本项名称虽含「墙砖」，但 20,000 cap 的金额来源反推基准是 70–80 元/㎡ × 约121㎡ ≈ 8,500–9,700，当时约121㎡的反推基准为房间干区111.864㎡ + 湿区7.726㎡ = 119.59㎡，不含主走廊；这是2026-10-07的历史地面口径，早于本次客卫内部材质分区。当前地面总量为干区121.0624㎡ + 湿区6.811㎡ = 127.8734㎡，含主走廊额外区3.75㎡；客卫开放洗漱区1.125㎡由湿区转入干区，总量不变；2026-10-23 DEC-2026-10-23-R04 几何改判（东南房玻璃线 9.88、客卫东墙 7.20）后干区 +3.54㎡（东南房）、湿区 +0.21㎡（客卫），总量由 123.34 增至 127.09；2026-10-25 DEC-2026-10-25-R01 厨房东南角墙线改判（交付态，z 框架误用尺寸链比例尺）后客餐厅 −3.1316㎡（44.58→41.4484），总量由 127.09 降至 123.9584，湿区不变；同日 R01 本体重算（z 框架修正为平面本体比例尺）：客餐厅 41.4484→43.1734（+1.725）、东南房 12.99→15.18（+2.19），干区 +3.915，总量由 123.9584 增至 127.8734，湿区不变（入户花园/井道非铺贴房间，不计入地面量）。该cap**不含任何墙面**；厨卫墙砖主材另立 COST-060-08，不得与本项混同或双计 | 业主封顶20,000元（地面主材），型号与排版图待量房后计算 | ¥20,000 | cap_pending_store_quote |
| [ ] | — | COST-060-02 | 水泥砂浆瓷砖胶等辅料 | 写明使用区域品牌用量和是否另计上楼搬运；2026-10-03 轮次约4,000元候选价，先确认瓦工报价是否已含辅材再去重 | 2026-10-03 轮次约4,000元，按铺贴面积报价 | ¥4,000 | quote_pending |
| [ ] | — | COST-060-03 | 墙地面找平 | 修正基层高低差，超厚找平的触发条件和单价另列 | 待现场测量平整度 | 待报价/待算量 | site_measurement_pending |
| [ ] | — | COST-060-04 | 常规铺贴人工 | 区分地砖墙砖和不同砖规格；同楼盘实付单价锚点：地砖65元/㎡、卫生间墙砖65元/㎡、阳台墙砖80元/㎡、厨房大砖混贴90元/㎡；2026-10-03 轮次按业主瓦工预算池18,500元计入（含复杂铺贴与增项），不得再另加复杂砖人工 | 业主预算池18,500元（2026-10-03），按实际铺贴面积报价 | ¥18,500 | budget_pool_confirmed_quote_pending |
| [ ] | — | COST-060-05 | 切割倒角开孔和特殊铺贴人工 | 门槛管孔墙角和复杂排版可能产生的加工费用；同楼盘实付单价锚点：海棠角20元/米、底盒开孔20元/个、反边60元/米、拉毛150元/间、卫生间阳台地砖包干300元/间、下沉地台200元/个。2026-10-07（DEC-2026-10-07-R05）按瓦工费率表补登 7 项既往未登记的 extras 锚点：嵌入式瓷地脚线／窗边台贴小砖条20元/米（本项目有落地窗低反坎需贴砖，飘窗台面贴砖100元/米可能实际发生）、壁龛单层250/双层400元/个、卫生间贴砖灌砂浆包管单管200/双管300元/条、便盆安装150元/个、瓷砖背面双组分背胶墙砖5元/㎡（地砖10元/㎡）、清理瓷砖背面脱模剂10元/㎡、墙面双组分背胶拉毛150元/间（单组分100元/间）。反边已含海棠角，背胶与拉毛、包管/壁龛不同档不得重复相加；辅材由谁供应仍未知。2026-10-07 R11（业主 D4=L 型终裁）：防水台 = 落地窗根部矮台（150 高 × 150 出檐常规口径，量级待量房），竖面与水平台面都要贴。主材已入 COST-060-08（sill_region 两段 1.86㎡）；本科目只挂**特殊工艺人工**——窗边台贴小砖条 20 元/米：低反坎总长度约29.8403m（客厅6.20m+主卫resolved弧墙3.9302m+本轮19.7102m），名义约¥597，本轮增量约¥394；厨房高位飘窗3.60m单独计，不套低反坎¥20/m费率（若瓦工按常规墙地砖人工一并报价则去重，不得双计）；宽飘窗台面贴砖 100 元/米另案核价；本轮150mm低反坎top已按面积计入COST-060-08，不重复套用；验收挂 check_sill_tile，PKG-060 need 暂不含此项 | 按数量或长度报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-060-08 | 全屋墙砖与窗边反坎主材 | 全屋已声明墙砖与窗边防水台贴砖主材，覆盖厨房、两卫、生活阳台、客厅、主卧、书房、西北次卧及东南客房；**不在 COST-060-01 的 20,000 cap 内**（该 cap 反推基准仅覆盖地面面积约 121 平方米）。历史上曾按可见正砖/遮蔽杂砖分档（详DEC-2026-10-07-R05及DEC-2026-10-08-C18）；C18已废止杂砖，当前全量声明按wall_tile_01正砖估算。常规铺贴人工计入COST-060-04池，特殊窗边工艺列COST-060-05并须与常规人工去重；辅材、防水按施工方书面范围核验。**历史审计参考（R11/C18前的墙段复核、候选对比与遮蔽面明细；当前数量/价格以本行quantity_basis和quantity_declared为准）**：**可贴实体墙长（js-yaml 解析 41 段墙 + 8 条 suppress 实算，非正则）**：厨房 4.80m（东墙 w_ent_west 2.40m 与入户门厅共墙 + 西 w_vrv_east 1.00m + w_balc_east 1.20m + w_kit_west 残段 0.20m）；主卫 4.36m（东墙 w_mbath_east 1.76m + 南墙 w_mbath_south 2.60m——北墙 suppress_north_recess、西墙 suppress_west_wall 均为玻璃幕墙，不可贴）；客卫 5.70m（w_balc_south 1.50m + w_gbath_east 系 2.10m + w_gbath_west_open_vanity 0.75m + w_gbath_west 1.35m——南侧 z=4.30 不封横墙）；生活阳台（R11）2.70m（w_balc_west 1.20m 洗衣机背墙 + w_balc_south 阳台侧 1.50m，0.30m 湿区口径；门洞墙 w_balc_east 阳台侧 1.20m 既定不贴）。厨房北墙 w_kit_north 3.60m 已 suppress_kitchen_north 改玻璃幕墙不可贴、z=2.40 的 3.60m 是四联动推拉门开口而非墙，v2 曾误按厨房可贴 8.40m 记账已作废。客餐厅仅 w_ent_west 在 x=10.80 z[2.40,2.90] 的 0.50m 可贴，餐厅按 E2 落地——贴满厨房可贴墙、透过推拉门形成连续砖面，不新增构造。R11（DEC-2026-10-07-R11）补灶台挡水条：东墙 w_ent_west 沿 along[1.27,2.17]（烟机宽 0.90m）自台面 0.90 贴至 1.40（range_hood 底缘 1.35），与下方 0.90m 杂砖带同墙堆叠、竖向不重叠；wall_region 补 room 字段，共墙两侧各贴各的脸，按 (wall, room) 去重。R11 同日 D4=L 型终裁（防水台 = 落地窗根部矮台，竖面 + 水平台面都贴）：构件为 overlay 新增 bay_sill living_south_waterproof_ledge（w_liv_south，150 高 × 150 出檐，业界常规口径、量级待量房），贴砖由新元素类型 sill_region 两段声明（front 竖面 6.20m×0.15m + top 台面 6.20m×0.15m = 1.86㎡），复用 wall-tile 层标签与开关。正砖候选：wall_tile_01 每平方米 66.7 元（300x600 东鹏白釉面）、wall_tile_02 122.2 元、wall_tile_03 100.0 元、wall_tile_kt_600x1200_01 94.4 元，均 status candidate，均无南宁成交价。杂砖单价全库无记录（仅两条人工规则：tile-comparison.yaml:164 与 procurement.md:246），未编数，遮蔽面暂计 0 并显形。遮蔽面精确值 3.87 平方米（厨房 3.42 = 东墙 2.16 + w_balc_east 1.08 + 残段 0.18，客卫 0.45 = 两处悬浮柜后 0.75m×0.30m）。贴砖高度三档（wall_tile_01，主材+人工+辅材，不减门洞）：A 防水高度（厨房 0.9m / 湿区淋浴 1.8m 其余 0.3m，与 budget-pitfalls.yaml 防水口径对齐）2,070–2,300 / B 全通高满铺（union 墙长 17.56m×2.65m = 46.53 平方米）6,284–6,982 / C 按 KT 报量 （38.88 平方米）5,250–5,833。KT 报价单 66 片 4,488 判分房错配：主卫 14.40 平方米超上限 11.55 平方米 25%、客卫 17.28 平方米超 15.11 平方米 14%，厨房反而少报 5.52 平方米——总量接近满铺但分房不可能成立，须回店按房重出，本条不采用其分房数。金意陶「厨房墙砖约 10 平方米」行判不可用。门口按单/双包边决定是否减洞（窗口面积不减），待量房；北墙玻璃幕与砖面收口待定；客厅落地幕墙根部防水台条带（D4）为水平面、不在本 3D 贴砖层，挂 COST-060-05 extras | DEC-2026-10-16-TILE-01现行量（2026-10-23 DEC-2026-10-23-R04 更新）：wall_region 21.5505㎡ + sill_region 15.4681㎡ = 37.0186㎡（墙段18、窗台面20；R04 客卫北墙砖段随东墙线拉直 +0.265㎡、阳台南墙砖段 +0.03㎡、东墙淋浴砖段拆二段面积不变、段数 17→18）；其中本轮新增6段低反坎19.7102m，front+top面积5.91305㎡。统一采用wall_tile_01候选价¥12/片、覆盖0.18㎡、损耗1.05，约¥70/㎡；材料估算37.0186×70≈¥2,591，非门店成交价。旧R11 15.33㎡/¥800等历史口径见DEC-2026-10-07-R11和C18，已由当前overlay实算替代。 | ¥800 | owner_decision_pending |
| [ ] | — | COST-060-06 | 搬运上楼和材料退补 | 明确电梯搬运上楼费及剩余材料处理 | 按合同说明 | 待报价/待算量 | contract_scope_pending |
| [ ] | — | COST-060-07 | 南阳台铺贴范围 | 南阳台方案未冻结，本项目前不得计入已确定工程量 | 待业主确认 | 待报价/待算量 | alignment_required |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_tile_hollow | critical/引用 | 空鼓检查 | 用空鼓锤轻敲每块砖的四角+中心 | 单片空鼓率 < 15%，整面墙 < 5% | 照片或检测记录 | `0c0eac5fd5393df448a87a30dece4c4e498d2d093c847b231e017cd489ac6ef8` | pending |
| [ ] | check_tile_gap | major/引用 | 缝隙均匀 | 用塞尺测量相邻砖缝 | 2mm ± 0.5mm | 照片或检测记录 | `d3291b0d68794f436b61195ca629097ec75c355b0285d4d878817af661c866f4` | pending |
| [ ] | check_tile_flatness | major/引用 | 平整度 | 2m靠尺贴墙面，测量最大空隙 | < 2mm | 照片或检测记录 | `c6188a747c969c74291b0d5bafee3fbdb41c0c5ecedee46f696e0ea03fc4f155` | pending |
| [ ] | check_tile_slope | critical/引用 | 坡度检查 | 倒水测试是否流向地漏 | 不积水 | 照片或检测记录 | `a75a4b24204068c267741eb3174f6084556987e5dde044d73fc9c0974c57907e` | pending |
| [ ] | check_sill_tile | major/引用 | 窗台/防水台面砖检查 | 逐个落地窗核对防水台 L 型两段——客厅、主卫、主卧、书房、西北次卧、东南客房的矮台竖面与水平台面是否都贴砖/窗台石、是否出檐收口、打胶是否连续；倒水试验窗框下沿不渗漏 | 声明范围内的防水台竖面与水平台面全段贴砖或窗台石；出檐/打胶收口连续，窗框下沿倒水不渗。当前卧室/书房估算150×150mm，量房后复核 | 客厅/主卫/主卧/书房/西北次卧/东南客房落地窗根部防水台竖面与台面铺贴照片、窗框下沿倒水试验照片 | `262b0111b0546665ef6fe377bacc02edb8ce2a9d324b878496cb3768a24d52a3` | pending |
| [ ] | SCH-060-01 | major/before_start/阻塞解除后 | 排版、起铺点和收口方案确认 | 按房间核对铺贴方向、通缝关系、窄条位置、门槛和墙地收口 | 形成确认版排版图或现场放样记录 | tile_layout、signed_mockup_photos | `ba1ec3ec0c6ca3db10319d9e7c85a184f91fcf7cea623bc0724239e21ce4f57e` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-060-COMPLETE` 已由责任人确认。

<a id="pkg-065"></a>
## PKG-065｜卫生间美缝（先行）

- 通俗说明：两卫及客卫开放洗漱区的瓷砖美缝，先行于其余区域（DEC-2026-10-22-R03 自 PKG-130 拆出）：清理并填充主卫、客卫确认范围内的墙地砖缝，砖缝干燥确认后施工；完成后做饰面层闭水，通过后放行洁具安装（PKG-100）。其余区域美缝见 PKG-130。
- 预算：¥500；合同：—；已付：¥0；预测：—
- 依赖：PKG-060；就绪：`blocked`；执行：`not_started`
- 责任角色：美缝施工、业主；付款门槛：`GATE-065-COMPLETE`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/overlay.yaml](../../config/layout/overlay.yaml) | room_ids=master_bath,guest_bath; types=floor_region,wall_region,sill_region | mapped |

当前项目数据指纹：`sha256:cd0335661010ff64b0f4757e26b72323c6eb5811fc0de4c7bbc38f30c02d9049`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-065-01 | 美缝材料（卫生间） | 写明品牌、系列、颜色、使用区域和材料数量（湿区用料与干区分开登记） | 全屋美缝定额 4,500 按砖缝长度估算占比拆分（湿区约 56m / 全屋约 750m，DEC-2026-10-22-R03），待铺砖完成后按实测缝长复核 | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-065-02 | 清缝填缝和清理人工（卫生间） | 包含施工前清缝、填充、压缝和完工清理 | 明确按面积、长度或包干计价 | 待报价/待算量 | quote_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_tile_grout_dry | major/引用 | 美缝前砖缝干燥确认 | 1. 贴砖完成且粘结层养护期满（按所用粘结材料说明，不早于铺贴后 7 天）后方可确认。<br>2. 逐区查砖缝：缝内干燥、无明水、无返潮发暗；卫生间坡度倒水试验后至少晾置 48h 再复查。<br>3. 确认后至美缝完成期间，卫生间不得淋水、不得用水冲洗地面；其他区域同此口径。<br> | 缝内干燥无明水，粘结层养护期满，有确认日期记录 | 砖缝干燥近照（两卫各一套）、铺贴完成日期与确认日期记录 | `e11d5d907d210685b909725a93ec12b4036fc9b97ad688120e25253071932767` | pending |
| [ ] | check_wp_finish_flood | critical/引用 | 饰面层闭水试验（美缝后、洁具安装前，两卫分别记录） | 1. 美缝完成且养护满后、洁具安装前进行；主卫、客卫分别堵地漏蓄水并分别记录，不得合并成一条。<br>2. 蓄水 3–5cm，标记水位线，等待 48 小时。<br>3. 查水位无明显下降，去楼下看对应天花无渗水、无湿痕。<br>4. 发现渗漏先定位整改（砖缝、地漏周边、管根优先），整改后重新蓄水 48h 复验，记录追加不覆盖。<br> | 48h 后水位无明显下降，楼下无渗水 | 蓄水起始水位线照片（两卫各一套）、48h 水位线照片（两卫各一套）、楼下天花无渗漏照片（两卫各一套） | `aea0bd13401a00408480713e6b5635f8c55ad4fe0438c7bb6c708af82de5001a` | pending |
| [ ] | SCH-065-01 | major/before_start/阻塞解除后 | 美缝前砖缝干燥确认（卫生间，DEC-2026-10-22-R02/R03） | 按 config/acceptance.yaml 的 check_tile_grout_dry 确认两卫范围：粘结层养护期满、缝内干燥无明水，倒水试验后晾置满 48h 复查 | 两卫砖缝干燥确认记录齐全，确认日期不早于铺贴完成 7 天 | dimensioned_photos、defect_list | `b215ecd1635fc01832bf636b8a33e8c3674da01ef0a679b273bb76ef73216bb7` | pending |
| [ ] | SCH-065-02 | major/completion/阻塞解除后 | 卫生间美缝范围、颜色和成品质量逐段检查 | 按两卫沿每条砖缝检查漏做、断缝、气泡、凹陷、色差和瓷砖污染 | 两卫确认范围内无漏项，填充连续饱满，颜色符合样板，瓷砖表面清洁 | signed_sample_photos、room_completion_photos、defect_list | `24bc194bc931b19157be34a5165e3c0dcddf156e873e91de5cf6bac0c45fa777` | pending |
| [ ] | SCH-065-03 | critical/completion/阻塞解除后 | 饰面层闭水试验（DEC-2026-10-22-R02，洁具安装前置门禁；原 SCH-130-03 随拆包迁入） | 按 config/acceptance.yaml 的 check_wp_finish_flood 执行：美缝养护满后两卫分别蓄水 3–5cm、48h，查水位与楼下天花；不合格整改后重新计时复验 | 两卫饰面闭水 48h 水位无明显下降、楼下无渗漏，记录齐全 | dimensioned_photos、completion_photos | `2815a73d878ced391bf2822c8141cef9c52a9888fe04d75a2c60df7c762a5e6f` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-065-COMPLETE` 已由责任人确认。

<a id="pkg-070"></a>
## PKG-070｜吊顶龙骨、隐蔽复验与封板

- 通俗说明：先搭建吊顶内部支撑骨架，再联合检查吊顶里面的空调和水电；确认压力、排水、开口和检修条件全部合格后，才用石膏板或吊顶板封闭。
- 预算：¥6,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-030、PKG-040、PKG-050；就绪：`blocked`；执行：`not_started`
- 责任角色：吊顶施工、空调商、水电施工、设计师、业主；付款门槛：`GATE-070-CEILING-CLOSED`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-HVAC-DEEPENING

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/ceiling.yaml](../../config/ceiling.yaml) | all=true | mapped |

当前项目数据指纹：`sha256:bddd273fa49fb1984aed60d397768da83a19f7c7cfe18f468271aa6b7fc55481`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-070-01 | 轻钢龙骨和固定材料 | 吊顶内部金属支撑骨架、吊杆和连接件 | 按吊顶展开面积和造型统计；数量拟由 2026-10-08-C01 吊顶算量子系统派生（npm run takeoff:ceiling / GET /api/ceiling/takeoff，读 config/ceiling.yaml 逐分区声明），不手抄数字；截至 2026-10-07 尚未发生 | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-070-02 | 石膏板吊顶面层 | 写明板材类型、层数、防潮要求、接缝材料和安装人工 | 按展开面积报价；数量拟由吊顶算量子系统按 trade=gypsum_board 派生（窗帘盒人工拟于 2026-10-08-C02 拆成延长米单列，rate 待报价，数量显形在预算快照 pendingLabor）；截至 2026-10-07 尚未发生 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-070-03 | 厨房卫生间集成吊顶 | 铝制扣板、边条、安装及设备开孔，不含取暖换气设备（DEC-2026-10-05-R3：浴霸划出自购定入 COST-100-06，凉霸不做）；2026-10-03 捆绑手写报价单 9,537 元（含收边、2浴霸、凉霸、灯）保留为设备拆分证据，2026-10-12 原件已归档、分项已可读，裸价重报仍待取得 | 剩余范围已由原件分项直接读出 = 4,540 元（板面 16.37㎡×198=3,241 + 灯 12块×90=1,080 + 未辨识项 219；9,537 − 凉霸 999 − 浴霸 2×1,999），非成交价；面积/板块数按 trade=aluminum_buckle 由算量子系统派生（厨房+两卫，300×300 分格） | ¥4,500 | quoted_pending_optimization |
| [ ] | — | COST-070-04 | 风口检修口灯孔和窗帘盒边缘处理 | 按确认图纸逐个计数，明确开孔和加固是否另收费 | 待空调灯具和窗帘图确认；窗帘盒本体人工拟按 2026-10-08-C02 延长米口径（17.85m，rate 待报价），本条只含边缘收口与开孔；截至 2026-10-07 尚未发生 | 待报价/待算量 | interface_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_carp_keel | critical/引用 | 吊顶龙骨间距 | 测量主龙骨间距，检查吊杆是否牢固 | 龙骨间距 ≤ 400mm，吊杆无松动 | 照片或检测记录 | `e4c2c6a281d8c050c0064271a79aa81484132e01c249ca4f2a79c199145537c4` | pending |
| [ ] | check_carp_board | major/引用 | 石膏板拼接 | 检查板间是否留缝、转角是否整板 | 板间留 V 型缝，转角用整板（7字角），背板 ≥ 9mm | 照片或检测记录 | `05b8fcf167282210d43b905b472f9f527ba1708cec38d92f35c22cda38daa25f` | pending |
| [ ] | SCH-070-01 | critical/before_covering/阻塞解除后 | 吊顶封板联合验收 | 复查空调保压、冷凝水、风口、回风、检修口、上部水电和全部隐蔽影像 | PKG-030与PKG-040关键验收全部通过并完成相关方签字 | signed_ceiling_close_permit、concealed_work_photos | `5fd4284960f87b888357d18810c6518f5e5a487d2d33e62f3408d7f3b1380462` | pending |
| [ ] | SCH-070-02 | critical/completion/阻塞解除后 | 吊顶完成面和设备开口复核 | 测量标高、平整度、板缝处理、检修口和风口开孔尺寸 | 与确认图纸及厂家尺寸一致，设备可安装和检修 | measurement_record、completion_photos | `c1d6327e2e679c7ce1d158c52d5a00314bd72b2523e37d23b771f3bf0919e65c` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-070-CEILING-CLOSED` 已由责任人确认。

<a id="pkg-080"></a>
## PKG-080｜墙顶面基层与涂装

- 通俗说明：修补墙顶面、批刮腻子、打磨并涂刷底漆和面漆；正式大面积施工前先做真实墙面颜色样板，完工后检查裂缝、色差和表面缺陷。
- 预算：¥11,500；合同：—；已付：¥0；预测：—
- 依赖：PKG-060、PKG-070；就绪：`blocked`；执行：`not_started`
- 责任角色：涂装施工、设计师、业主；付款门槛：`GATE-080-COMPLETE`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/overlay.yaml](../../config/layout/overlay.yaml) | types=paint_region | mapped |

当前项目数据指纹：`sha256:cd0335661010ff64b0f4757e26b72323c6eb5811fc0de4c7bbc38f30c02d9049`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-080-01 | 墙顶面修补和基层处理 | 处理裂缝、孔洞、松散层和新旧墙交界，特殊问题须单列 | 待交房查验和现场测量 | 待报价/待算量 | site_measurement_pending |
| [ ] | — | COST-080-02 | 找平和批刮腻子 | 写明材料品牌、施工遍数、厚度以及阴阳角处理 | 按实际施工面积报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-080-03 | 打磨底漆和面漆 | 写明漆品牌系列、色号、底漆与面漆遍数以及人工 | 按实际施工面积报价 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-080-04 | 颜色样板和成品保护 | 大面积涂刷前制作样板，施工时保护门窗、柜体和地面 | 按合同范围 | 待报价/待算量 | contract_scope_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_paint_surface | major/引用 | 漆膜质量检查 | 用侧光（手机手电筒贴墙斜照）检查墙面。<br>看是否有：刷痕、流挂、起泡、颗粒、色差。<br> | 侧光 45° 下无明显瑕疵，颜色均匀 | 照片或检测记录 | `e8c0b910722860a71fb4f1c64da9db79db496dd3d94a6e017f9cd3238bb34834` | pending |
| [ ] | check_paint_env | warning/引用 | 施工环境记录 | 刷漆时记录室内温湿度。<br>低于 5°C 或湿度 > 85% 不宜施工。<br> | 施工期间温度 ≥ 5°C，湿度 ≤ 85% | 照片或检测记录 | `1a5c26805b04035ff5ee7cc67435313d4847dee8a943ddd0e24952c52360003d` | pending |
| [ ] | check_paint_reserve | info/引用 | 留罐记录 | 留半罐调好的漆，用保鲜膜封口盖紧，标注色号和涂刷位置 | 每个颜色留 0.5L 以上，标注色号+房间 | 照片或检测记录 | `847845828317aa6a02d565be8359cef749c6d8367e7fbe35bbf0ae17aac66d3e` | pending |
| [ ] | SCH-080-01 | major/before_start/阻塞解除后 | 颜色和现场样板确认 | 在实际墙面制作样板并在日间、夜间照明条件下观察 | 色号、光泽和使用房间经业主确认 | signed_sample_photos | `4ce82397365a378a8fbf8e015d057438cde2704f9f02f5859441d59865759e90` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-080-COMPLETE` 已由责任人确认。

<a id="pkg-090"></a>
## PKG-090｜室内门及厨房门

- 通俗说明：在墙面和地面厚度确定后重新测量门洞，生产并安装卧室门、卫生间门及厨房玻璃门；厨房门还要满足燃气单位确认的分隔要求。
- 预算：¥9,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-060、PKG-080；就绪：`blocked`；执行：`not_started`
- 责任角色：门供应商、施工方、业主；付款门槛：`GATE-090-COMPLETE`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-GAS-DOOR

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/model-geometry.yaml](../../config/layout/model-geometry.yaml) | collections=openings | partial |
| [config/layout/overlay.yaml](../../config/layout/overlay.yaml) | types=sliding_door_run | partial |

当前项目数据指纹：`sha256:5cf50a9211d89acfa0c859cbde85d77a0a0bc0bb571384737d16ac32fdaa0b0d`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-090-01 | 卧室和书房室内门 | 门扇门套门锁合页门吸运输安装和密封收边均需写明 | 4樘 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-090-02 | 卫生间门 | 写明防潮材质玻璃门锁门套安装和密封处理 | 2樘 | 待报价/待算量 | quote_pending |
| [ ] | — | COST-090-03 | 厨房多扇联动玻璃推拉门 | 推动一扇门时相邻门扇可随动；写明门扇数量、轨道、玻璃、型材、五金、安装收边和燃气验收适用条件 | 1组 | 待报价/待算量 | gas_requirement_pending |
| [ ] | — | COST-090-04 | 门洞修正和额外基层 | 只有复尺发现确需处理时才发生，须先报价确认 | 待复尺 | 待报价/待算量 | site_measurement_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_dw_swing | major/引用 | 门开关与门框 | 逐个门开关测试，检查门框灌浆 | 开关顺畅无异响，门框灌浆密实，合页螺丝全打 | 照片或检测记录 | `bc2913fb6b8a53d47c0f82d8ec4f297df9a70a5ee8c341d7cef39336c3cc2772` | pending |
| [ ] | check_dw_seal | major/引用 | 密封胶检查 | 检查门套/窗框密封胶打设 | 密封胶均匀连续无断点，门吸避开踢脚线 | 照片或检测记录 | `d64b8cad7378b9e021619f5eeac4cdc041ce61a95609db86c808a8c50d8a76d3` | pending |
| [ ] | SCH-090-01 | critical/before_order/阻塞解除后 | 门洞复尺及厨房燃气分隔条件确认 | 逐樘记录完成面洞口尺寸，并核对燃气单位或物业的书面要求 | 复尺单签认且厨房门方案满足确认要求 | door_measurement_sheet、gas_requirement_record | `5b852121b71b9f4a31d921a3f08d5e5d41570681a6027166de46e71b783b0b3e` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-090-COMPLETE` 已由责任人确认。

<a id="pkg-100"></a>
## PKG-100｜两个卫生间的洁具与五金

- 通俗说明：安装马桶、浴室柜、台盆、龙头、花洒、地漏和相关五金，逐件试水、排水并检查接头是否渗漏、安装是否牢固。饰面层闭水通过（PKG-065 卫生间美缝先行包放行，DEC-2026-10-22-R02/R03）后方可安装。
- 预算：¥8,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-060、PKG-080、PKG-040、PKG-065；就绪：`blocked`；执行：`not_started`
- 责任角色：洁具供应商、水电施工、业主；付款门槛：`GATE-100-COMPLETE`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-MASTER-VANITY-SKU

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/house.yaml](../../config/house.yaml) | room_ids=master_bath,guest_bath,master_bedroom; types=toilet,shower_set,vanity,faucet,mb_washbasin_cabinet,mirror_cabinet_gbath,exhaust_fan | partial |
| [config/plumbing.yaml](../../config/plumbing.yaml) | room_ids=master_bath,guest_bath,master_bedroom | partial |
| [config/layout/overlay.yaml](../../config/layout/overlay.yaml) | types=shower_screen | partial |

当前项目数据指纹：`sha256:a58b8f1be145d3b8dee98d3246a45a6a1e72cef7aae96509e0984fe1fc21f77b`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-100-01 | 马桶 | 分别记录主卫生间和客卫生间的型号坑距角阀软管安装及旧孔处理；2026-10-03 轮次登记九牧智能马桶ZQ6650两台封顶5,598元（cap），须核305/400坑距、低水压、送装与质保，并按shopping-research补取证后与九牧11383-2-1/31KB-1、箭牌AE1182U同口径比较；2026-10-05 业主侧出现具体型号方向 ZQ6650-SA-CJM305（2,799/台，后缀含坑距 305 承诺）——两卫坑距 305/400 未核（pending-site-data #31）前不得定死 | 2台，业主封顶5,598元（2026-10-03） | ¥5,598 | owner_selected_pending_verification |
| [ ] | — | COST-100-02 | 浴室柜台盆和镜柜 | 分卫生间记录柜体材质尺寸龙头下水安装和墙体固定条件；2026-10-07（DEC-2026-10-07-R02）业主先入账 1,500 元/主卫，柜型/台盆形式/龙头形式均未定（BLK-MASTER-VANITY-SKU），客卫 2,000 元 定制/非标不变（悬浮+云鲸J6基站仓，约500mm仓宽为假设值，须与J6实机外廓/柜下净空同图会审）。三条路径及 MEP 后果：A 买柜体+岩板台面、台上盆与壁挂龙头按 DEC-2026-10-03-R1 单配 → faucet_mbath_vanity 盆心 x=0.575、drain_mbath_vanity 墙排中心、water-master-bath 穿 w_mbath_south 点 x=0.575 全不动、给排水参数与柜体 SKU 解耦（推荐，约1,800~2,400）；B 厂家一体盆成品柜 1,500 全包 → 台上盆意图放弃、上述三点随柜体重定、water-master-bath 退回 pending 重画；C 维持 R12 设计 3,000。**主卫 1,500 只是预算入账，不等于成品一体盆方案**。注意与 mb_vanity_base_cabinet（1.38m 定制底柜+悬浮板+PVC管井族，归 wardrobe、二期 P2-100）是两套东西，不得混同或双计 | 2套：主卫1,500（预算先入账，选型未定）+ 客卫2,000（J6非标定制），2026-10-07 目标3,500元 | ¥3,500 | candidate_pending_quote |
| [ ] | — | COST-100-03 | 花洒 | 分卫生间记录混水阀花洒组件安装辅材和水压适配；2026-10-07（DEC-2026-10-07-R02）由 R12 的千元级恒温档2,000下调至1,300：两套均普通明装、阀体与阀芯不降级；显式放弃花洒侧二级恒温，恒温改由海尔 KL7PRO 水伺服（DEC-2026-10-05-R5）在热水器侧承担一级；阀体/阀芯保持墙里件定位，不得按耗材采购；京造/九牧/恒洁同档待选型 | 2套，2026-10-07 目标1,300元 | ¥1,300 | candidate |
| [ ] | — | COST-100-04 | 地漏角阀软管及卫生间小五金 | 按点位逐件列数量品牌型号和安装费用；2026-10-03 轮次的龙头下水角阀约1,200元与通用五金约1,500元同归本项，不得叠加；2026-10-05（DEC-2026-10-05-R12）龙头下水角阀按业主侧拆分口径1,100元（500~600/套×2） | 待点位表确认，2026-10-03 轮次合计约2,700元、2026-10-05 下调至2,600元 | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-100-05 | 淋浴区玻璃隔断 | 2026-10-07（DEC-2026-10-07-R02）归属定案归 PKG-100，ownership_pending 关闭：8mm 钢化+3C 固定玻璃约900/台×2=1,800（主客卫各一处，与 DEC-2026-09-07-054 客卫整面固定玻璃无门一致；不做昂贵推拉淋浴房，复杂轨道与门铰属可砍溢价）。家电池 PKG-160 need 16,496 已超计划额496，不接这笔。config/materials.yaml 的 shower_enclosure_01 notes 已同步为 PKG-100 / COST-100-05，家电池不计；本条为记账权威 | 2处（主卫/客卫各1处） | ¥1,800 | ownership_resolved |
| [ ] | — | COST-100-06 | 卫生间取暖换气设备 | 业主定标自购（DEC-2026-10-05-R3）：奥普 S2-Air 浴霸×2（风暖 2750W+换气 49W+照明 24W 三合一，集成吊顶式、线控面板），京东自营国补价 680.97/台（2026-10-05 页面观察，非成交价），两台 ≈1,362、目标 1,500 含配件余量；换气模块承担原独立排气；收房仍核对开发商场既有设备，若已提供则反转删项 | 2台；下单窗口在量房与扣板开孔方案冻结后 | ¥1,500 | candidate |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_dw_drain | critical/引用 | 下水通畅 | 各下水口冲水/倒水测试 | 下水通畅无堵塞、无返水 | 照片或检测记录 | `49fda3961fe65012330f746265d25200f2aea1f6b42fe565d189c26a6d967ec1` | pending |
| [ ] | check_plumb_drain | critical/引用 | 排水坡度与存水弯 | 检查排水管坡度、地漏/下水存水弯 | 排水坡度 ≥ 1%，地漏/下水有存水弯防臭 | 照片或检测记录 | `84f01e9aead866ba631893f9e6820d880e3f888e8f8898f4807a54ae695e79e8` | pending |
| [ ] | SCH-100-01 | critical/completion/阻塞解除后 | 洁具逐件通水、排水和渗漏检查 | 对马桶、台盆、龙头、花洒和地漏逐件连续试水并检查连接处 | 功能正常、排水通畅、无渗漏、无明显松动 | fixture_test_video、completion_photos | `f7c78d0bd040e6c8f1f6d6f85f94abcc733acae23260e8330d5e52306946ed72` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-100-COMPLETE` 已由责任人确认。

<a id="pkg-110"></a>
## PKG-110｜橱柜及台面

- 通俗说明：墙地面完成后重新测量厨房，确认烟机、灶具、水槽和预留电器尺寸，再生产安装地柜、吊柜、台面和五金，并检查开合、接缝和维护空间。
- 预算：¥11,500；合同：—；已付：¥0；预测：—
- 依赖：PKG-060、PKG-080；就绪：`blocked`；执行：`not_started`
- 责任角色：橱柜供应商、设计师、业主；付款门槛：`GATE-110-COMPLETE`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/house.yaml](../../config/house.yaml) | room_ids=kitchen; types=kitchen_cabinet_run,kitchen_countertop_bridge,cabinet_base,cabinet_wall,countertop_quartz,sink | mapped |

当前项目数据指纹：`sha256:d1dc29cb6c4190f399a776b8b4491b87686750b60bcc0cb3713ede454271920d`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-110-01 | 落地橱柜 | 写明柜体门板层板抽屉和基础五金，不能只报一个模糊的每米价格 | 碰撞修正后的3D候选按现 house.yaml 实体段量取：北墙2.96m + 东墙1.95m = 4.91m；实际模块拆分/量房待深化。初始2.05m东墙候选与开态长虹门叠扇重叠，详 DEC-2026-10-14-R01 | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-110-02 | 墙上吊柜 | 写明长度高度深度柜体门板层板和安装方式 | 待深化图统计 | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-110-03 | 厨房操作台面 | 写明材质厚度挡水边开孔接缝运输和安装 | 碰撞修正后的3D候选台面长度 parity；书面橱柜报价和最终深化图待提供 | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-110-04 | 抽屉拉篮铰链轨道和其他五金 | 逐件写明品牌型号数量，不接受统一写成五金升级 | 待业主确认配置 | 待报价/待算量 | selection_pending |
| [ ] | — | COST-110-05 | 烟机灶具水槽及预留电器的柜体处理 | 明确开孔加固封边和安装由谁负责，设备本身不在橱柜费中重复计取 | 按设备清单 | 待报价/待算量 | interface_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_carp_cabinet | major/引用 | 柜门开关与缝隙 | 逐个柜门开关测试，测门缝均匀度 | 开关顺畅无异响，门缝均匀 ≤ 2mm，五金阻尼正常 | 照片或检测记录 | `7d72ce6096e0a21aa9de6b9dadc0c4bc65f80ee1d6a81950ebdeee99ff5c6550` | pending |
| [ ] | check_elec_micro_oven_reserved | major/引用 | 微蒸烤预留点位 sock_kitchen_oven 落位必须在柜外/开放格可徒手插拔处 | 1. 预留点位随橱柜 600 宽高柜段冻结落位：点位落在柜外壁或开放格内，禁止藏在机器背后（机身贴背板时，背装插座等于永久封死）。<br>2. 按微蒸烤嵌入口径（深向 595 级）做插拔演练：站在柜门前能捏住插头并完成插拔，不必移机、不必拆层板。<br>3. 预留回路与底盒位置在水电交底单上与橱柜冻结排版图叠合核对；设备到货安装后再复核一次插拔可及性。<br> | 预留点位在柜外或开放格；不拆柜、不移机可徒手插拔；与橱柜冻结排版图一致 | 预留点位与橱柜排版图叠合照片、徒手插拔演练照片（封槽前模拟 + 设备到货后复核） | `822869226ae6d79defd8b18996ea3a11d880be74150548753e398829e8907afa` | pending |
| [ ] | SCH-110-01 | critical/before_order/阻塞解除后 | 完成面复尺和电器接口冻结 | 核对柜体、台面、烟机、灶具、水槽及预留电器的尺寸和水电接口 | 复尺图及设备尺寸表经业主确认后下单 | cabinet_measurement_sheet、approved_shop_drawing | `41a5e9baba3c623924071e5a5bb6d3764204a78962927b8d783ceb3a32676ae1` | pending |
| [ ] | SCH-110-02 | major/completion/阻塞解除后 | 台面、柜体、五金及收口验收 | 检查水平、门缝、开合、固定、台面接缝、防水收口及设备安装空间 | 使用功能正常、无明显缺陷且预留设备可安装维护 | completion_photos、defect_list | `dc6c7f16cb1c5e91a3fa23860ca07650c880036eeac90fce6a93c8c6e14580d9` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-110-COMPLETE` 已由责任人确认。

<a id="pkg-120"></a>
## PKG-120｜一期基础灯具安装与照明测试

- 通俗说明：采购并安装一期保证正常照明所需的灯具，逐盏核对安装位置、色温、亮度、开关控制和检修条件；装饰性灯具可留到后续阶段。
- 预算：¥3,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-080；就绪：`blocked`；执行：`not_started`
- 责任角色：电工、灯具供应商、业主；付款门槛：`GATE-120-COMPLETE`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/electrical.yaml](../../config/electrical.yaml) | types=ceiling_light,dome,downlight,night_light | mapped |

当前项目数据指纹：`sha256:3cb9f6e2079b256509828cd19bc1855f219f6cc0c9fdbd68e4a6918b98b259a4`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-120-01 | 各房间基础照明灯具 | 逐盏记录房间、位置、品牌型号、功率、色温、显色参数和单价；参考同类实付：全屋筒射灯轨道灯约3,684元、装饰灯约900元、安装人工600元，若做全屋筒射灯本包3,000元偏紧，报价时复核 | 待灯具点位表确认 | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-120-02 | 灯具安装和调试人工 | 明确是否包含开孔、组装、安装和故障排查，避免与水电人工重复 | 按灯具数量和类型报价 | 待报价/待算量 | duplication_check_required |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_elec_continuity | critical/引用 | 通断测试 | 用测电笔逐个插座测试 | 全部通电，零火线正确 | 照片或检测记录 | `8b3a2824e5aede9d8b0ebef02a2ec101953b41edf01bc38972b1707c5fb0c16a` | pending |
| [ ] | check_elec_switch | major/引用 | 开关功能 | 逐个开关测试 | 双控/单控功能正常 | 照片或检测记录 | `e98b29ea4e8613800edc9cabf800e610ccdeb22e03fee3e1691f77d3c96375b4` | pending |
| [ ] | SCH-120-01 | major/completion/阻塞解除后 | 基础灯具逐盏通电和控制测试 | 按灯具点位表逐盏测试点亮、色温、亮度、开关和双处控制关系 | 一期照明点位全部可正常使用，控制关系正确，无闪烁、异响或明显色差 | lighting_schedule、commissioning_record | `6de0c737069b291510023e2745496070a2521fb4c93f08d1c8c7355be2e7f2fd` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-120-COMPLETE` 已由责任人确认。

<a id="pkg-125"></a>
## PKG-125｜开关插座面板与一期基础智能设备

- 通俗说明：安装墙面最终使用的开关和插座面板，配置一期确需使用的智能开关或网关，逐点测试供电、控制和网络连接；窗帘电机等二期设备只保留接口，不在本项采购。
- 预算：¥2,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-080；就绪：`blocked`；执行：`not_started`
- 责任角色：电工、智能设备供应商、业主；付款门槛：`GATE-125-COMPLETE`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/electrical.yaml](../../config/electrical.yaml) | types=socket,switch,switch_2way,network,floor_socket | mapped |
| [config/electrical-topology.yaml](../../config/electrical-topology.yaml) | all=true | mapped |

当前项目数据指纹：`sha256:03c218b56541ceec0b0394e54ec1ce014bd2be96d99ff35b4a73d297a1d51c2f`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-125-01 | 普通开关和插座面板 | 逐点记录功能类型、品牌系列、数量和单价；电线、线管及底盒已在水电项目中计取。2026-10-12 数量口径已按 config 实算（替代「待最终点位表」）：灯控 17 只 = 10 一开双控 + 1 一开多控（中途开关，主卧三控专用，独立 SKU，一开双控替代不了）+ 6 一开单控；插座 56 只（socket 51 + floor_socket 5）+ 6 个六类网口面板。首选正泰 X1M 免喷涂超薄大板（一开双控菱花白 ¥8.58 页面价）/ 替补 6C 无边面板（¥9.46，500,000 评价）/ 全灰升级 NEW6C 幻银灰（¥12.23）；皓呈/公牛 G12 星空灰/罗格朗逸景因 2.4–6.5 倍溢价且违反「不上高价装饰面板」口径淘汰。X1M/6C 是电商专供系列，正泰居家官网无规格页，一开双控灰色可得性、面板外框实际宽高、完整型号表必须向卖家补证（门垛仅 0.15m，双联 172mm 已确认放不下） | 17 只灯控 + 56 只插座 + 6 个网口面板 | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-125-02 | 一期智能开关或网关 | 只采购入住即需使用的基础设备，逐件说明用途和兼容平台。2026-10-12 实算：11 个控制组 → 11 个一开智能开关 + 6 个无线开关 = 17 个物理控制点（每个控制组只能一只接灯控线，同一回路两只并接会互相灌流，其余从动位转无线）。候选性价比序：京东京造超薄智能开关零火版双开 ¥49.90/三开 ¥62.89 < 德力西 290 零火单开 ¥57.45（好价已过期）/290 单零火兼容二开 ¥90.50 < 小米智能开关 2（官方 ¥79/89/109、京东页面价 ¥87.70/98.80/121.10，单零火自适应无需拨码）。米家中枢网关 ¥399 是否必需证据不足（买家评价「不需要网关」与「连接小米音箱蓝牙网关」两种说法并存；小米另有「需搭配网关」版 ¥76.60 与「单火零火通用」版 ¥87.70 两个 SKU）；小米智能开关 2 的通信协议（蓝牙 Mesh 2.0 还是 Wi-Fi）、是否支持「开关转无线」、最小负载 W 数均未验证——单筒灯回路（light_corridor_1/light_entry_down 可能仅 5–7W）达标性待核 | 11 智能 + 6 无线 + 网关 0–1 | 待报价/待算量 | selection_pending |
| [ ] | — | COST-125-03 | 面板安装标识和调试人工 | 逐点安装测试并给配电箱回路贴明用途，核对是否包含在水电合同中 | 按点位数量和合同边界 | 待报价/待算量 | duplication_check_required |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_elec_continuity | critical/引用 | 通断测试 | 用测电笔逐个插座测试 | 全部通电，零火线正确 | 照片或检测记录 | `46a4a7986d456605775f21067418bacd0c3f311d5f0478797eefcaa7b2ec8e81` | pending |
| [ ] | check_elec_switch | major/引用 | 开关功能 | 逐个开关测试 | 双控/单控功能正常 | 照片或检测记录 | `be361c5cc8ec56413e76488c85c0900a139b9b1a4cc7b844a2a574a47d041b2f` | pending |
| [ ] | check_elec_splash_socket | major/引用 | 卫生间/厨房插座防溅与安全型插座 | 逐点检查两卫与厨房台面插座是否防溅盒、面板是否为安全型（带保护门）插座，目视 + 拍照 | 两卫与厨房操作面插座全部带防溅盒；全屋插座采用安全型插座 | 照片或检测记录 | `5b4af6ec17a451727d07e57d8da9c1d4b9a57682d42774280e5ac7006b728636` | pending |
| [ ] | check_elec_point_reachability | major/引用 | 点位可及性抽检（防设备/柜体封死） | 模拟日常：插拔智能马桶、冰箱、油烟机、洗衣机、烘干机插座，确认不必挪动机器或拆柜体即可操作 | 上述点位全部可徒手插拔，或已有明确检修口/检修位 | 照片或检测记录 | `8bca7d95df330ef97f9c48ae92bbdbb017d553ce7a345c169a836331f5197871` | pending |
| [ ] | SCH-125-01 | critical/completion/阻塞解除后 | 开关、插座和基础智能设备逐点测试 | 按最终点位表逐个核对通电、接线极性、控制关系、网络连接和配电箱回路标签 | 点位表逐项通过，标签可理解，故障项已整改并复验 | point_schedule、commissioning_record、panel_label_photos | `3bd8fd46c807891c1657ef103f9c0349904960595d778d3e6b203b5a77f690e3` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-125-COMPLETE` 已由责任人确认。

<a id="pkg-130"></a>
## PKG-130｜瓷砖美缝（其余区域）

- 通俗说明：清理并填充其余区域（不含两卫及客卫开放洗漱区，该范围先行施工见 PKG-065，DEC-2026-10-22-R03）确认范围内的瓷砖缝，施工前确认材料、颜色、计价长度或面积，完成后逐段检查饱满、平整、颜色一致和污染情况。
- 预算：¥4,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-060、PKG-080；就绪：`blocked`；执行：`not_started`
- 责任角色：美缝施工、业主；付款门槛：`GATE-130-COMPLETE`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/overlay.yaml](../../config/layout/overlay.yaml) | types=floor_region,wall_region,sill_region | mapped |

当前项目数据指纹：`sha256:cd0335661010ff64b0f4757e26b72323c6eb5811fc0de4c7bbc38f30c02d9049`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-130-01 | 美缝材料 | 写明品牌、系列、颜色、使用区域和材料数量 | 待铺砖完成后按砖缝长度或面积复核 | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-130-02 | 清缝填缝和清理人工 | 包含施工前清缝、填充、压缝和完工清理 | 明确按面积、长度或包干计价 | 待报价/待算量 | quote_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_tile_grout_dry | major/引用 | 美缝前砖缝干燥确认 | 1. 贴砖完成且粘结层养护期满（按所用粘结材料说明，不早于铺贴后 7 天）后方可确认。<br>2. 逐区查砖缝：缝内干燥、无明水、无返潮发暗；卫生间坡度倒水试验后至少晾置 48h 再复查。<br>3. 确认后至美缝完成期间，卫生间不得淋水、不得用水冲洗地面；其他区域同此口径。<br> | 缝内干燥无明水，粘结层养护期满，有确认日期记录 | 砖缝干燥近照（两卫各一套）、铺贴完成日期与确认日期记录 | `197034ab87666e33882c6324fd4deec81f4beae734d0b1be580733de939840e3` | pending |
| [ ] | SCH-130-01 | major/completion/阻塞解除后 | 美缝范围、颜色和成品质量逐段检查 | 按房间沿每条砖缝检查漏做、断缝、气泡、凹陷、色差和瓷砖污染 | 确认范围内无漏项，填充连续饱满，颜色符合样板，瓷砖表面清洁 | signed_sample_photos、room_completion_photos、defect_list | `4eca8f00ef0c5cb207f4a032edb412422445604891b506300404a7be6436b338` | pending |
| [ ] | SCH-130-02 | major/before_start/阻塞解除后 | 美缝前砖缝干燥确认（DEC-2026-10-22-R02） | 按 config/acceptance.yaml 的 check_tile_grout_dry 逐区确认本包范围：粘结层养护期满、缝内干燥无明水 | 本包范围砖缝干燥确认记录齐全，确认日期不早于铺贴完成 7 天 | dimensioned_photos、defect_list | `28aedad3b8b9ce3384693c122d683c58b6b359ab72700004b47e73386bdf6a90` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-130-COMPLETE` 已由责任人确认。

<a id="pkg-135"></a>
## PKG-135｜踢脚线、明确收边项目与竣工深度清洁

- 通俗说明：安装踢脚线，按已经列明的位置处理门套、柜体、台面、洁具和墙地面交界，修复清单中记录的表面缺陷，最后逐房进行深度清洁；不得用“零星收口”作为未列项目的收费口袋。
- 预算：¥5,500；合同：—；已付：¥0；预测：—
- 依赖：PKG-090、PKG-100、PKG-110、PKG-120、PKG-125、PKG-130；就绪：`blocked`；执行：`not_started`
- 责任角色：施工方、踢脚线供应商、保洁、业主；付款门槛：`GATE-135-COMPLETE`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/model-geometry.yaml](../../config/layout/model-geometry.yaml) | collections=rooms,walls,openings | partial |
| [config/layout/overlay.yaml](../../config/layout/overlay.yaml) | types=floor_region,wall_region,paint_region,sill_region | partial |

当前项目数据指纹：`sha256:5cf50a9211d89acfa0c859cbde85d77a0a0bc0bb571384737d16ac32fdaa0b0d`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-135-01 | 踢脚线材料和安装 | 写明材质、高度、颜色、长度、转角配件、固定方式和安装人工 | 待完成面按实际长度复核 | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-135-02 | 已列明交界位置的收边处理 | 按门套、柜体、台面、洁具、风口和墙地交界逐处列数量、材料和责任方 | 待形成收边位置清单 | 待报价/待算量 | scope_schedule_pending |
| [ ] | — | COST-135-03 | 验收缺陷修复 | 只处理缺陷清单中的具体问题；原合同施工质量问题由责任方免费整改 | 按缺陷责任判定 | 待报价/待算量 | responsibility_pending |
| [ ] | — | COST-135-04 | 竣工深度清洁 | 逐房清洁地墙顶、门柜、玻璃、洁具和设备表面并清走施工垃圾 | 按建筑面积和服务范围报价 | 待报价/待算量 | quote_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | SCH-135-01 | major/completion/阻塞解除后 | 踢脚线与清单所列收边逐项检查 | 按位置清单逐段检查固定、拼缝、转角、交界密封、污染和高低差 | 每个清单位置均有结果，无漏项、松动、明显缝隙或影响使用的问题 | finish_location_schedule、completion_photos、defect_list | `d7c1d64da803b6871c173975fdef868751ec84256566a456a5a4ab7e8f8bd549` | pending |
| [ ] | SCH-135-02 | major/completion/阻塞解除后 | 深度清洁及成品完好检查 | 逐房检查地墙顶、门柜、玻璃、洁具和设备表面，并核对施工垃圾清运 | 无施工垃圾和明显污染，成品损伤已登记、定责并整改 | room_completion_photos、defect_list | `d8e9ef7ad6ab1f9c04ddf4a96dab55cc274ba6b5bb5a3f44a8dcb82ab0343c7d` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-135-COMPLETE` 已由责任人确认。

<a id="pkg-140"></a>
## PKG-140｜中央空调第二次安装与调试

- 通俗说明：墙面和吊顶完成后安装空调出风口、回风口及控制器，对整套系统抽真空、开机运行，检查制冷、排水、噪声和控制功能。
- 预算：¥0；合同：—；已付：¥0；预测：—
- 依赖：PKG-080、PKG-120、PKG-125；就绪：`blocked`；执行：`not_started`
- 责任角色：空调商、业主；付款门槛：`GATE-140-COMMISSIONED`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/hvac.yaml](../../config/hvac.yaml) | plan_ids=A2 | partial |
| [config/mep-hvac-coordination.yaml](../../config/mep-hvac-coordination.yaml) | layers=refrigerant,condensate,supply_air,return_air | partial |
| [config/electrical.yaml](../../config/electrical.yaml) | ids=sock_living_ac,sock_dining_ac,sock_master_ac,sock_parent_ac,sock_child_ac,sock_study_ac,sock_vrf_outdoor_a2,ac_panel_living,ac_panel_dining,ac_panel_master,ac_panel_parent,ac_panel_child,ac_panel_study | partial |

当前项目数据指纹：`sha256:5f9a6027d0d11a2904956038495bd6e9be67e1b4293d03f93182aa69264b755c`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_hvac_vacuum | critical/引用 | 抽真空时间 | 看真空泵运行记录 | ≥ 15min，保持 -756mmHg | 照片或检测记录 | `19f04cc8f5054a38d505b33c783afe3eeb67466cbfbe9d3c755814e561b341de` | pending |
| [ ] | check_hvac_vent | major/引用 | 风口尺寸 | 测量风口开孔 vs 内机接口 | 对齐无缝隙 | 照片或检测记录 | `b44188c971bae8c220945eabc6f1181e6e91b1adc029f75fbe73d6bfc30bc585` | pending |
| [ ] | check_hvac_cooling | critical/引用 | 制冷测试 | 开机 30min 测出风口温度 | 出风口 6-12°C（与环境温差） | 照片或检测记录 | `20c4e84c60bb6925079da15df45c5cf91e65d53ad15068dbc8094800595ee90d` | pending |
| [ ] | check_hvac_outdoor | major/引用 | 外机散热 | 测量外机位通风尺寸 | 百叶通风面积 ≥ 80% | 照片或检测记录 | `0957096758c26d5a0a9666f96b71df11d02bd728b28c1f16f225ee38f755987b` | pending |
| [ ] | SCH-140-01 | critical/completion/阻塞解除后 | 全系统运行、排水、噪声和控制测试 | 逐台及联合运行，测试控制器、模式切换、送回风、冷凝水和异常噪声 | 所有内机可控且运行、排水正常，问题完成整改复验 | commissioning_record、operation_video | `abd4a10647d5a6d6a54b9502e789f8bbd3b2c31471ea8ab78adfe60349fa748e` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-140-COMMISSIONED` 已由责任人确认。

<a id="pkg-142"></a>
## PKG-142｜基础硬装后的临时入住放行

- 通俗说明：在墙地顶、固定机电与洁具施工完成并验收后，单独判断是否具备临时入住条件。本关不要求一期家具、完整窗帘或全部家电先入场；业主签认的最低生活功能可以由已验收设备、现有物品或明确的临时替代满足。通过只表示可按已签认的临住清单暂住，不代表一期竣工验收、最终结算完成，也不代表剩余施工可在有人居住时无条件继续。
- 预算：¥0；合同：—；已付：¥0；预测：—
- 依赖：PKG-135、PKG-140；就绪：`blocked`；执行：`not_started`
- 责任角色：业主、施工方、水电施工、空调商；临时入住放行门槛：`GATE-142-OCCUPANCY-RELEASE`
- 当前临时入住放行门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/model-geometry.yaml](../../config/layout/model-geometry.yaml) | all=true | project_scope |
| [config/layout/overlay.yaml](../../config/layout/overlay.yaml) | all=true | project_scope |
| [config/house.yaml](../../config/house.yaml) | all=true | project_scope |
| [config/electrical.yaml](../../config/electrical.yaml) | all=true | project_scope |
| [config/plumbing.yaml](../../config/plumbing.yaml) | all=true | project_scope |
| [config/electrical-topology.yaml](../../config/electrical-topology.yaml) | all=true | project_scope |
| [config/mep-hvac-coordination.yaml](../../config/mep-hvac-coordination.yaml) | all=true | project_scope |
| [config/hvac.yaml](../../config/hvac.yaml) | all=true | project_scope |
| [config/ceiling.yaml](../../config/ceiling.yaml) | all=true | project_scope |
| [docs/pending-site-data.md](../../docs/pending-site-data.md) | 现场待测数据；按各项影响、状态和触发条件闭环 | site ledger |

当前项目数据指纹：`sha256:8ab9b287762448f33f3a26e33ab4d3ae54e632e5571f1e89de9ecdd2867c7849`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | SCH-142-01 | critical/release/阻塞解除后 | 最低生活功能与机电安全核验 | 业主先签认最低生活功能清单，再逐项现场试用：照明与常用插座、供水和排水、厕所、洗浴与热水、通风和季节性温控；烹饪、食物储存、洗衣、睡眠与隐私按业主实际需要列入。每项记明正式设备或临时替代、测试人、结果和证据。由对应专业人员提供电气、燃气、给排水、空调等调试/安全记录；重点查裸露带电部位、漏水返水、燃气设备未验收启用、洁具或构件松动，以及影响逃生和检修的堆放。 | 清单中每一项都已通过现场测试，或有业主签认的安全临时替代/明确不需要；不存在未关闭的 critical 缺陷、未验收即投入使用的燃气/电气设备、漏水返水或裸露带电部位；专业系统记录齐全。 | temporary_occupancy_function_matrix、professional_commissioning_records、critical_defect_register、room_walkthrough_photos | `03d6eee40313d4312d370a856fc0a12b7ebfd8e8a7e42a43fd41c7f82614f8aa` | pending |
| [ ] | SCH-142-02 | critical/release/阻塞解除后 | 临入住前室内环境检测 | 与施工合同及检测机构确认本项目适用的现行标准、检测污染物、采样点位和采样条件；委托有资格的检测单位检测并归档原始报告。不得以“没有异味”替代检测结果，也不得把现有清单中的固定采样时长或单一限值未经核验直接套用到所有检测方法。 | 检测报告满足本项目合同和适用标准要求，检测范围与当前已完成的装修材料相符；报告缺失或未通过时，不放行入住。 | indoor_air_test_report、applicable_standard_and_sampling_conditions | `41bb1e71ec01acfaa2addf8dc97ec9cbac91c037e088689468a3f9f140c5c51d` | pending |
| [ ] | SCH-142-03 | major/release/阻塞解除后 | 未完工程与有人居住期间施工安排签认 | 逐项列出剩余窗帘、家具、家电和其他工程，标注是否产生钻孔切割粉尘、胶黏剂/涂料气味、噪声、动火或占用通道；优先安排入住前完成。确需入住后施工时，写明封闭隔离、清洁、停工时段和住户临时离场安排，并确认不会阻断消防/逃生、卫生间或检修通道。 | 所有未完项目有负责人、日期和施工影响记录；所有有粉尘、挥发物、动火或通道风险的作业已有入住前完成或临时撤离/隔离方案，业主已签认临时入住清单和已知妥协。 | deferred_work_register、occupied_work_risk_plan、owner_temporary_occupancy_signoff | `5cb4946e20aa0e1a7ddc20860edd221d285a157533adb281aacd19b92daed311` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 临时入住放行门槛 `GATE-142-OCCUPANCY-RELEASE` 已由责任人确认。

<a id="pkg-145"></a>
## PKG-145｜一期窗帘、纱帘与手动轨道

- 通俗说明：墙面和窗帘盒完成后逐窗复尺，为需要遮光或隐私的房间安装一期窗帘、纱帘和手动轨道；电动窗帘电机属于二期，水电阶段只预留电源和位置。按当前控制源，一期只做主卧、书房、西北次卧三个房间，客厅和客房窗帘后移二期。
- 预算：¥5,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-080、PKG-120；就绪：`blocked`；执行：`not_started`
- 责任角色：窗帘供应商、设计师、业主；付款门槛：`GATE-145-COMPLETE`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-CURTAIN-SCOPE

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/overlay.yaml](../../config/layout/overlay.yaml) | types=curtain | partial |
| [config/ceiling.yaml](../../config/ceiling.yaml) | trade=curtain_box | partial |
| [config/electrical.yaml](../../config/electrical.yaml) | ids=sock_living_curtain,sock_master_curtain,sock_parent_curtain,sock_study_curtain | partial |

当前项目数据指纹：`sha256:03c058e28d14acb32840616bea6c4479fee5b6b7e89f63bf65111115f086168b`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-145-01 | 各房间布帘和纱帘 | 逐窗写明是否需要布帘、纱帘、遮光等级、面料型号、褶皱倍数、尺寸和单价 | 待逐窗复尺和需求确认 | 待报价/待算量 | scope_pending |
| [ ] | — | COST-145-02 | 手动轨道及安装 | 逐窗写明直轨或转角轨、长度、承重、配件、安装和保修 | 待窗帘盒完成后复尺 | 待报价/待算量 | site_measurement_pending |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | SCH-145-01 | critical/before_order/阻塞解除后 | 逐窗复尺和一期窗帘配置确认 | 核对窗口完成面尺寸、窗帘盒、轨道长度、开启方向、遮光隐私需求和空调风口关系 | 每个一期窗口都有签认的尺寸、面料、轨道和报价记录 | curtain_measurement_sheet、approved_curtain_schedule | `967edf1e8502405583a76a24b9bf4563153aa3da9fd4614ff6b45f44e1468f32` | pending |
| [ ] | SCH-145-02 | major/completion/阻塞解除后 | 窗帘开合、遮挡和安装牢固检查 | 逐窗往返开合，检查轨道固定、布帘垂顺、遮光覆盖、拖地和与家具风口碰撞 | 开合顺畅、固定牢靠、覆盖满足确认需求且无明显碰撞 | completion_photos、operation_video | `8087b69dcd5aa3316ed913d35f23c179f09b34917d7fdec4b7d8f0833489d1b2` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-145-COMPLETE` 已由责任人确认。

<a id="pkg-150"></a>
## PKG-150｜一期家具与定制收纳

- 通俗说明：按完成后的现场尺寸安装一期冻结家具：主卧床、床垫、两床头柜、过渡斗柜和待选成品衣架，客房床、床垫和成品衣柜（2026-10-05 DEC-2026-10-05-R9 功能互换：原父母房家具随功能迁至东南房客房，衣柜北墙边吊下 ≤2.40m 推拉门款），客餐厅沙发、餐桌椅和玄关收纳组合；检查牢固程度、柜门开合、通行宽度以及与插座和空调检修位置的关系。主卧通顶定制衣柜、主卧梳妆桌凳、书房储物柜体（含由客房平移的 1.70m 季节后台柜）与起夜路径照明、西北次卧家具、客厅低柜/电视/咖啡桌/地灯/绿植和其他大收纳均后移二期；书房柜体与起夜照明在一期水电交底前只留置管/留盒/留零线等预留条件，灯具与柜体本体归二期。
- 预算：¥19,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-135、PKG-140；就绪：`blocked`；执行：`not_started`
- 责任角色：家具供应商、定制供应商、设计师、业主；付款门槛：`GATE-150-COMPLETE`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/house.yaml](../../config/house.yaml) | all=true | partial |

当前项目数据指纹：`sha256:d1dc29cb6c4190f399a776b8b4491b87686750b60bcc0cb3713ede454271920d`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | — | COST-150-01 | 主卧通顶定制衣柜（后移二期） | 藏空调冷凝水管槽，成品柜无法替代，维持定制但推至二期；逐柜记录位置、宽高深、材质、内部格局、五金、运输安装和墙体固定条件。2026-10-07（DEC-2026-10-07-R02）边界补注：本项现名仅对应 master_wardrobe_tall_240（2.4m 通顶隔断柜），而空调冷凝水管墙行段（管心 x=2.50、z=3.10..4.30，经 mb_vanity_pvc_service_chase 穿 w_mbath_south 入主卫吊顶）实际由主卫条带柜组收纳——mb_vanity_base_cabinet（1.38m×0.565m×0.62m，AABB x[1.975,2.54]，design-rules 归 wardrobe，在 w_mbath_east 西侧完成面退让15mm）+ mb_vanity_lower_board + mb_vanity_main_board（均与底柜同包络）+ mb_vanity_pvc_box/wardrobe_entry/service_chase 三件 + condensate_pipe_ac_outlet。条带柜组是否含在本项及 P2-100 的 3000-5000 内，此前无任何 DEC 或台账说明，二期启动前必须写清；按项目单价反算该组约1500-2300（柜体800/㎡投影+石英石400/延米+PVC井），为推断非报价。一期过渡态：条带为1.05m洗手柜可用、无底柜收纳、冷凝水管裸露于主卧墙面，属已知可接受过渡，不得按缺陷整改。与 mb_washbasin_cabinet（1.05m，design-rules 归 vanity，预算在 COST-100-02）是两套东西，不得混同或双计 | 二期启动前深化（含条带柜组边界待写清） | ¥0 | deferred_to_phase_2 |
| [ ] | — | COST-150-02 | 一期床架 | 分房间记录尺寸、材质、结构、送货安装和保修；仅保留主卧与客房，书房和西北次卧床具后移二期 | 2张（主卧+客房） | 待报价/待算量 | quantity_pending |
| [ ] | — | COST-150-03 | 一期床垫 | 与床架分开报价，分房间记录尺寸、软硬度、材料和试睡退换条件；仅保留主卧与客房 | 2张（主卧+客房） | 待报价/待算量 | selection_pending |
| [ ] | — | COST-150-04 | 书房与西北次卧家具（后移二期） | 书桌、书椅、书架/置物架、床具及柜体均不列入一期采购；西北次卧仅保留一期窗帘 | 二期范围 | ¥0 | deferred_to_phase_2 |
| [ ] | — | COST-150-05 | 客厅沙发 | 写明尺寸、材质、座深、送货通道和与插座窗帘的关系；一期保留 | 1组候选 | 待报价/待算量 | selection_pending |
| [ ] | — | COST-150-06 | 餐桌和餐椅 | 写明桌面尺寸、椅子数量、材质和使用通道；一期保留 | 1组候选 | 待报价/待算量 | selection_pending |
| [ ] | — | COST-150-07 | 玄关收纳组合 | 入户鞋柜与玄关随手收纳组合一期保留；逐件记录尺寸、换鞋功能、五金安装及配电弱电接口避让 | 1组候选 | 待报价/待算量 | design_pending |
| [ ] | — | COST-150-08 | 客房成品衣柜 | 一期保留成品衣柜；记录尺寸、防倾倒固定和与插座、窗帘关系，不通顶、顶部留空为已知妥协 | 1组候选 | 待报价/待算量 | selection_pending |
| [ ] | — | COST-150-09 | 主卧两床头柜 | 一期保留两只床头柜；按床头插座、双控和通道复尺选型，记录尺寸、防倾倒和安装方式 | 2只 | 待报价/待算量 | selection_pending |
| [ ] | — | COST-150-10 | 主卧过渡斗柜 | 一期保留成品斗柜作为定制衣柜后移期间的过渡收纳；记录尺寸、开门方向、通道和防倾倒条件 | 1只 | 待报价/待算量 | selection_pending |
| [ ] | — | COST-150-11 | 主卧过渡衣架 | 待选宜家或其他可复用成品；尺寸未定，不进入 config/house.yaml 建模，采购前现场复尺并核对冷凝水检修关系 | 1件候选 | 待报价/待算量 | selection_pending |
| [ ] | — | COST-150-12 | 客厅低柜、电视、咖啡桌、地灯和绿植（后移二期） | 客厅低柜与电视系统、咖啡桌、地灯、绿植均不列入一期采购；客厅大收纳柜、展示柜和复杂灯光按既有二期范围执行 | 二期范围 | ¥0 | deferred_to_phase_2 |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_carp_cabinet | major/引用 | 柜门开关与缝隙 | 逐个柜门开关测试，测门缝均匀度 | 开关顺畅无异响，门缝均匀 ≤ 2mm，五金阻尼正常 | 照片或检测记录 | `d67729cf188a3d42f8cffdee28fdb2cee63fad95024d7d89134967811145f350` | pending |
| [ ] | SCH-150-01 | critical/before_order/阻塞解除后 | 柜体复尺及与机电、门、窗帘、空调关系确认 | 逐柜核对完成面尺寸、插座开关、风口检修口、门扇和通道 | 深化图经业主确认；主卧定制衣柜、书房和西北次卧家具、客厅低柜及影音小件均后移二期，一期只按已冻结的床具、床头柜、斗柜、待选衣架、客房成品衣柜和客餐厅家具执行 | approved_shop_drawing、measurement_sheet | `99733f2e667904d304d179cd74648eb7aae47c244ce2447ccc8d1ffa494ad74c` | pending |
| [ ] | SCH-150-02 | major/completion/阻塞解除后 | 家具安装、稳定性和通行检查 | 逐件检查牢固、水平、开合、边角、床垫匹配和主要通道 | 使用安全顺畅，无碰撞和影响检修的问题 | completion_photos、defect_list | `5460d6cc2a00232b7491bcf68242efc7dc93e6e1650329051d878b685be39337` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-150-COMPLETE` 已由责任人确认。

<a id="pkg-160"></a>
## PKG-160｜必需家电安装与接口测试

- 通俗说明：安装一期实际需要使用的家电，逐台核对电源、给水、排水、散热和维护空间并试运行；二期设备不在本项重复计费。
- 预算：¥16,000；合同：—；已付：¥0；预测：—
- 依赖：PKG-110、PKG-120、PKG-125、PKG-135；就绪：`blocked`；执行：`not_started`
- 责任角色：家电供应商、水电施工、业主；付款门槛：`GATE-160-COMPLETE`
- 当前付款门槛状态：`pending`
- 阻塞项：BLK-PHASE1-APPLIANCES、BLK-WATER-HEATER-SITE、BLK-FRIDGE-FIT

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/house.yaml](../../config/house.yaml) | types=fridge,washer,gas_stove,range_hood,water_heater,dishwasher,robot_dock_gbath | partial |
| [config/electrical.yaml](../../config/electrical.yaml) | ids=sock_fridge_living,sock_kitchen_hood,sock_kitchen_gas,sock_kitchen_oven,sock_balcony_washer,sock_balcony_dryer,sock_balcony_waterheater,sock_gbath_robot | partial |
| [config/plumbing.yaml](../../config/plumbing.yaml) | ids=faucet_balcony_washer,drain_balcony_washer,faucet_gbath_vanity,drain_gbath_vanity | partial |

当前项目数据指纹：`sha256:76b36660813d94e7888028c35357080a7f098522a881fdb36e88fc40454d726c`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


### 预算拆分核对

采购优先级规则：

- **P0｜入住必需**：冰箱、洗衣机以及实际没有现成设备时的热水器，优先保证基本生活功能
- **P0确认｜防尘与自动清洁**：云鲸J6上下水版按业主确认的3,000元纳入一期，使用客卫台盆下已规划的电源、进水和墙排接口
- **P0接口｜做饭和施工接口必需**：燃气灶和吸油烟机先确认型号和接口，再冻结橱柜开孔、燃气和电路
- **P1｜业主定标生活电器**：微蒸烤一体机按业主 2026-10-05 定标（DEC-2026-10-05-R4）以 4,000 元纳入一期，嵌位与专用回路随橱柜方案冻结
- **P2｜二期延后**：洗碗机、干衣机和净水设备继续留在二期，不从一期额度挤占

| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |
|---|---|---|---|---|---|---:|---|
| [ ] | P0｜入住必需 | COST-160-01 | 冰箱 | 记录型号、尺寸、开门、散热、插座、送货和安装条件；设计模型冰箱位暂约700毫米宽×700毫米深，当前501升候选有宽约833毫米者，必须复测净开口后再定可购买型号；没有可用旧冰箱时列为一期必买 | 1台候选，待复尺和确认是否一期采购 | 待报价/待算量 | fit_pending |
| [ ] | P0｜入住必需 | COST-160-02 | 洗衣机 | 记录型号、尺寸、进水、排水、插座、防水和阳台通风位置；没有可用旧洗衣机时列为一期必买 | 1台候选，待阳台复尺和确认是否一期采购 | 待报价/待算量 | fit_pending |
| [ ] | P0接口｜做饭和橱柜接口必需 | COST-160-03 | 燃气灶 | 记录型号、开孔尺寸、燃气接口、电源和安装验收责任；必须在橱柜台面开孔前冻结 | 1台候选，待燃气条件确认 | 待报价/待算量 | interface_pending |
| [ ] | P0接口｜做饭和橱柜接口必需 | COST-160-04 | 吸油烟机 | 记录型号、尺寸、烟管、止回阀、插座与橱柜安装边界；必须在吊柜和烟管施工前冻结 | 1台候选，待确认 | 待报价/待算量 | interface_pending |
| [ ] | P0条件｜无现成设备时入住必需 | COST-160-05 | 燃气热水器（一期类别已确认） | 业主已确认一期按燃气热水器推进；设计模型暂记厨房西侧靠生活阳台玻璃幕墙的实体墙（墙体编号w_vrv_east，插座协调点sock_balcony_waterheater），这只是设计协调点，不是现场安装确认；仍需核对开发商或现有设备是否可用、天然气条件、实际安装墙面、容量、尺寸、排烟、冷凝水、给排水、专用电路和物业要求，现场条件未闭合前不得下单；2026-10-05（DEC-2026-10-05-R5）业主换选型号方向为海尔 KL7PRO（16L 水伺服增压静音，预算 2,600，价格线 ≤2,500 直接买 / >3,000 转 JM6S/JM6C），MK6/HWF Pro 转价值/下探备选，BLK-WATER-HEATER-SITE 未解除前不下单 | 1台候选，类别与型号方向已定、现场待核 | ¥2,600 | selection_confirmed_site_pending |
| [ ] | P0确认｜防尘与自动清洁 | COST-160-06 | 云鲸J6上下水版扫地机器人 | 按既有客卫悬空台盆柜下主位安装，使用sock_gbath_robot电源、台盆进水三通和墙排方案；业主确认设备预算3,000元，采购前复核实机版本、柜下净空、穿墙排水和检修条件 | 1台，型号与预算已确认、现场接口待核 | ¥3,000 | budget_confirmed_site_pending |
| [ ] | P2｜明确留到二期 | COST-160-07 | 二期家电排除项 | 洗碗机、干衣机和净水设备不从一期16,000元家电额度重复扣款，除非业主书面调整阶段 | 排除清单 | ¥0 | excluded_to_phase_2 |
| [ ] | P1｜业主定标生活电器 | COST-160-08 | 嵌入式微蒸烤一体机 | 业主定标方向（DEC-2026-10-05-R4）：美的 GC5（TR850E-TSBC00，55L，微/蒸/烤/空气炸四合一，变频微波+双孔直喷+上下管热风，额定 3200W，机身 595×565×454mm）；官方现价 4,199（2026-10-05 页面观察，非成交价），目标 ≤3,800、封顶 4,200；同档竞品比价未做；电气需 16A/2.5mm² 专用回路（GB 55038 7.4.4），嵌位（600 宽高柜段）与点位随橱柜方案冻结后落，台面/高柜开孔前必须定型号 | 1台，业主定标方向、嵌位待设计 | ¥4,000 | candidate |

- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。
- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。

| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | SCH-160-01 | critical/completion/阻塞解除后 | 必需家电逐台安装和接口试运行 | 按设备说明检查电源、给排水、散热、水平和试运行状态 | 设备运行正常，无漏水、异常发热、跳闸或维护空间不足 | commissioning_record、serial_number_photos | `82eb4ba325678088bf0c065cddf2e6e8be46117c6c569470fd5e6edb389ce719` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-160-COMPLETE` 已由责任人确认。

<a id="pkg-170"></a>
## PKG-170｜竣工联合验收、整改与资料移交

- 通俗说明：汇总各工种未通过项目并逐条整改复查，核对最终费用，完成清洁、空气质量检测以及图纸、照片、发票、保修和设备资料移交。
- 预算：¥0；合同：—；已付：¥0；预测：—
- 依赖：PKG-135、PKG-140、PKG-145、PKG-150、PKG-160；就绪：`blocked`；执行：`not_started`
- 责任角色：业主、设计师、施工方、各供应商；付款门槛：`GATE-170-FINAL`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/model-geometry.yaml](../../config/layout/model-geometry.yaml) | all=true | project_scope |

当前项目数据指纹：`sha256:2095dbf63023bb0105b213e9d5caeab391f1f168f1c71d870949765671761551`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | check_occ_formaldehyde | critical/引用 | 甲醛检测 | 建议找 CMA 资质机构上门检测。<br>检测前封闭门窗 12 小时（关闭新风）。<br>每个房间设一个检测点（中央位置，离地 1m）。<br> | 甲醛 < 0.08mg/m³（国标 GB/T 18883） | 照片或检测记录 | `167e5b84e2f90d4601c16825ce299505a1d93642a3ba9442cdfbd5c1cc827c17` | pending |
| [ ] | SCH-170-01 | critical/completion/阻塞解除后 | 所有失败项完成整改和复验 | 汇总各施工包缺陷清单，逐项核对整改证据和复验记录 | 无未关闭的critical或major问题 | closed_defect_register、reinspection_records | `77078b08e8c2675119c7492a70527e30a9ffb85757d8c32d29d8ac32df6e960a` | pending |
| [ ] | SCH-170-02 | critical/payment/阻塞解除后 | 竣工资料和保修资料完整移交 | 核对竣工图、隐蔽照片、设备清单、合同发票、保修卡、说明书和联系人 | 移交目录逐项签收，资料路径可访问 | signed_handover_index | `f171864897c59f2ce2f202c4171663e1f79952ac43a0f038affbacd68c402686` | pending |
| [ ] | SCH-170-03 | critical/payment/阻塞解除后 | 最终结算不超过批准额度 | 汇总合同、变更、已付、待付和退款，核对各预算池及总上限 | 最终预测不超过¥210,000，或已有业主书面追加批准 | final_account_statement、owner_approval_if_overrun | `59136dc47128624960a7418abe5f849790c483674796b4803cb7ead01841b97b` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-170-FINAL` 已由责任人确认。

<a id="pkg-900"></a>
## PKG-900｜硬装预备金

- 通俗说明：由业主保留、用于量房误差或确实无法预见事项的备用额度，不是施工方可以默认使用的费用；每次动用都要有原因、报价和书面批准。
- 预算：¥5,000；合同：—；已付：¥0；预测：—
- 依赖：无；就绪：`blocked`；执行：`not_started`
- 责任角色：业主；付款门槛：`GATE-900-OWNER-APPROVAL`
- 当前付款门槛状态：`pending`

### 关联项目数据

| 数据文件 | 本工作包引用范围 | 映射状态 |
|---|---|---|
| [config/layout/model-geometry.yaml](../../config/layout/model-geometry.yaml) | all=true | project_scope |

当前项目数据指纹：`sha256:2095dbf63023bb0105b213e9d5caeab391f1f168f1c71d870949765671761551`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。


| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |
|---|---|---|---|---|---|---|---|---|
| [ ] | SCH-900-01 | critical/payment/阻塞解除后 | 预备金动用经过业主逐笔批准 | 记录原因、关联施工包、报价、批准金额和剩余额度 | 不存在无批准支出，且同一费用未在基础合同中重复计取 | variation_order、owner_approval | `0ce0dc923d994b1a01a4b3aa8ea0937f75e0f90e488407cf3c1d7ab60d40a1d8` | pending |

- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。
- [ ] 必需证据路径已登记且文件可打开。
- [ ] 付款门槛 `GATE-900-OWNER-APPROVAL` 已由责任人确认。

## 装修术语通俗解释

| 专业说法 | 通俗解释 |
|---|---|
| 工作包 | 为了方便报价、排工期和验收，把整个装修拆成的一项独立工作。例如水电改造就是一个工作包，有自己的预算、前置条件和验收结果。 |
| 预算池 | 把性质相近的费用放在一起控制的金额范围。例如基础硬装预算池包含拆改、水电、防水、铺砖、吊顶等费用。 |
| 阻塞项 | 当前尚未解决、会导致某项工作不能开始或不能完成的事情，例如未交房、墙体性质不明或厂家图纸未确认。 |
| 付款门槛 | 付款前必须完成的检查条件。对应验收和证据未通过时，即使施工方提出申请也不应支付该节点款。 |
| 拆改 | 拆除允许拆除的墙体或构件，并按图新建墙体、调整门洞或空间边界。承重墙、梁柱和楼板不能凭经验拆除。 |
| 水电改造 | 根据最终家具和设备位置重新布置电线、网线、给水管和排水管，并安装对应的开关、插座和接口。 |
| 强电与弱电 | 强电是照明、插座和空调等供电线路；弱电是网络、电视和其他低电压信号线路。两类线路需按施工要求分开布置，减少干扰并保证安全。 |
| 专用电路 | 只给某台或某类大功率设备供电的独立线路，例如中央空调、厨房设备或热水器，通常在配电箱中有独立开关。 |
| 热水回水管 | 为缩短等待热水时间而增加的循环管路，需要在水电阶段预先铺设，并与热水器方案配套。 |
| 物业装修报批 | 开工前向小区物业提交装修资料、人员信息和施工内容，取得允许进场施工的手续。 |
| 进场保护 | 用保护膜、保护板或护角覆盖电梯、公区、入户门、窗户和已有地面，防止搬运及施工造成磕碰、划伤和污染。 |
| 放线 | 按设计图把新墙、门洞、柜体、插座、空调风口和吊顶边界等位置，用墨线、胶带或记号笔标到现场，供各工种共同复核后施工。 |
| 深化图 | 厂家或专业施工方根据现场尺寸，把设计意图细化成可以生产和安装的尺寸图、节点图及接口图。 |
| 图纸会审 | 业主、设计师、施工方和设备厂家把各自图纸放在一起核对，提前找出尺寸、管线、柜门、灯具和设备之间的冲突。 |
| 隐蔽工程 | 完工后会被墙面、地面或吊顶遮住，无法直接检查的管线、防水、龙骨和设备安装内容。 |
| 保压试验 | 给水管或空调冷媒管加到规定压力并保持一段时间，通过压力变化判断是否可能漏水或漏冷媒。 |
| 闭水试验 | 封住排水口并在防水区域蓄水，在规定时间后检查本层和楼下是否渗漏。 |
| 复尺 | 在墙地砖、墙面或吊顶等完成面确定后再次测量真实尺寸，定制门柜必须按复尺结果生产。 |
| 完成面 | 地砖、墙漆、吊顶、木饰面等全部施工完成后最终看得到、摸得到的表面位置。 |
| 找平 | 用水泥砂浆、石膏或其他材料修正墙地面的高低差，为后续铺砖、刷漆或安装提供平整基层。 |
| 收口 | 两种材料或两个构件交接处的边缘处理，例如柜体贴墙、门套接地面、台面接墙和风口接吊顶。 |
| 空鼓 | 瓷砖或抹灰层没有和基层充分粘牢，敲击时会发出空响，严重时可能松动或脱落。 |
| 冷凝水 | 空调运行时产生的水，必须通过有坡度的排水管顺利排走，不能倒流、积水或渗漏。 |
| 送风口与回风口 | 送风口把处理后的空气吹入房间；回风口把房间空气吸回空调内机。两者位置不当会影响效果，也必须留出清洁和检修条件。 |
| 检修口 | 吊顶或柜体上可打开的检查入口，用于日后维修空调、水电接头、阀门或驱动设备。 |
| 冷媒管 | 连接中央空调室内机和室外机、输送制冷介质的铜管，焊接、保温和压力测试会直接影响空调可靠性。 |
| 抽真空 | 空调连接完成后，用真空泵排出冷媒管内的空气和水分，再按设备要求进入调试；记录应由空调安装方提供。 |
| 泥瓦施工 | 主要包括墙地面找平、砌墙、铺地砖、贴墙砖、处理门槛和排水坡度等使用水泥砂浆的工作。 |
| 排版与起铺点 | 排版是提前规划每块砖如何排列；起铺点是第一块砖开始铺的位置。两者会决定门口、墙边是否出现难看的窄砖条。 |
| 通缝 | 不同区域或相邻墙地面的砖缝保持连续对齐，使整体更整齐；是否通缝应在铺砖前确认。 |
| 龙骨 | 吊顶内部用于承重和固定面板的金属或木质骨架，封板以后看不到，因此必须在隐蔽验收时检查。 |
| 腻子、底漆和面漆 | 腻子用于修平墙面；底漆用于封闭基层并提高附着力；面漆是最终看到的颜色和表面层。 |
| 地柜与吊柜 | 地柜是落地安装、支撑厨房台面的柜体；吊柜是固定在墙面较高位置的储物柜。 |
| 五金 | 柜门铰链、抽屉轨道、拉手、门锁、角阀、挂件等金属或功能配件的统称，需在报价中写明品牌、型号和数量。 |
| 美缝 | 在瓷砖缝内填入专用材料，使砖缝更易清洁并减少发黑；颜色、材料类型和计价方式应在施工前确认。 |
| 踢脚线 | 安装在墙面最下方与地面交界处的长条材料，用于保护墙脚并遮盖交接缝。 |
| 开关插座面板 | 墙面最终看得到并直接操作的开关、插座外壳和内部功能模块，不等同于水电阶段埋在墙里的底盒、电线和线管。 |
| 窗帘盒 | 吊顶或墙顶处用于隐藏窗帘轨道的凹槽，需要在吊顶施工前确认尺寸；窗帘布和轨道通常在墙面完成后复尺安装。 |
| 辅材 | 配合主要材料施工、完工后通常不显眼的材料，例如水泥砂浆、瓷砖胶、线管、接头、螺钉和密封材料；报价仍应写明种类、品牌、用量和价格，不能只写“辅材一项”。 |
| 包干报价 | 在事先写清的施工范围内按一个总价结算。范围之外是否加价、按什么单价加价必须在合同中说明，否则“包干”不能证明没有增项。 |
| 集成吊顶 | 厨房或卫生间常用的模块化吊顶，通常由金属扣板、边条和内部骨架组成，照明和取暖换气设备会安装在对应模块或开孔中。 |
| 阴阳角 | 墙面转角的两种形态：向房间内凹的是阴角，向外凸的是阳角。施工时需要保证线条顺直，并保护外凸边角不易磕坏。 |
| 色温和显色参数 | 色温描述灯光偏暖黄还是偏冷白；显色参数描述灯光还原物体真实颜色的能力。灯具不能只看瓦数，还应统一或按房间明确这两项。 |
| 接线极性 | 检查插座的火线、零线和保护接地线是否接到正确位置，避免错误接线带来触电或设备故障风险。 |
| 窗帘褶皱倍数 | 窗帘布展开宽度与轨道宽度的比例，会影响褶皱丰满程度、用布量和价格，必须与面料和窗宽一起写进报价。 |
| 马桶坑距 | 墙面完成位置到马桶排污口中心的水平距离，它决定可选马桶型号；购买前必须按完成面复核。 |
| 止回阀 | 安装在厨房排烟通道接口处、用于减少公共烟道气味和油烟倒灌的部件，需要与烟管和烟道接口匹配并密封。 |
| 角阀、软管和混水阀 | 角阀用于单独关闭某个洁具的供水；软管连接固定水口和洁具；混水阀把冷热水混合到所需温度。三者都要明确品牌、数量和安装责任。 |
