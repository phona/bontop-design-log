# 决策日志 · 电气

> 本文件是 `docs/decision_log.md` 2026-10-09 主题拆分（DEC-2026-10-09-S01）的产物：
> 收录范围 = 回路拓扑、实体走线、全屋点位审计、电气兜底轮、飞线治理、算量与报价卡口径。条目为原文件的连续切片，正文未改写；文件内按时间正序。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-08-05-017` 全屋插座-洁具/家具交叉验证修正
- `DEC-2026-08-06-019` 厨卫洁具渲染补全 + 死代码清理
- `DEC-2026-08-12-023` 3D 效果模型升级包（PBR 地面 + 收纳三层摆位 + 室内灯光系统）
- `DEC-2026-08-26-011` 玄关门厅筒灯与最小灯光回路语义
- `DEC-2026-08-26-012` 保留走廊口筒灯并纳入既有客厅边吊
- `DEC-2026-08-26-043` 客厅无主灯整改收敛
- `DEC-2026-09-07-056` 电气回路拓扑补全：全部插座/灯具归回路 + 开关绑定受控灯具 + 回路参数
- `DEC-2026-09-07-057` 强电实体走线补全：普通插座/照明/专用回路全部上走线图（40→65 条）
- `DEC-2026-09-08-R1` 全屋电气点位审计与升级（插座/灯控/空调线控）
- `DEC-2026-09-08-R2` 父母房门口开关移至门垛中心
- `DEC-2026-10-03-R1` 水电施工冻结前收口：25 路→19 路、补漏保、燃气报警器合规位、验收扩 9 项
- `DEC-2026-10-03-R7` 水电收口的验证记录与跨迭代阻塞
- `DEC-2026-10-04-R2` 三路审计收口：外机供电入账第 20 路、燃气位重算、验收接门禁、悬空编号回补
- `DEC-2026-10-05-R13` B5-A：书房电脑专用回路改道（ordinary_power_study 随功能互换归位）
- `DEC-2026-10-06-R2` 电气兜底轮：微蒸烤预留接口 + 全盒零线 + 防溅盒 + 窗帘电源入盒
- `DEC-2026-10-07-F01` 飞线改线批：unsupported_span 首扫 33 条清至 8 条显式保留
- `DEC-2026-10-07-F02` unsupported_span 依托模型补全：首末段设备接线段（原顶暗敷带）
- `DEC-2026-10-07-M02` 水电算量修正口径 + 报价卡迁移到通用卡片模型（不再重复造轮子）
- `DEC-2026-10-07-M03` 删掉 allowance 臆测数据：没有路由的点位不进采购量
- `DEC-2026-10-07-M04` 声明式补客餐厅电源回路路由 + 纯竖直段纳入物理路由口径
- `DEC-2026-10-07-M05` 并行声明式补路由：书房/客房/儿童房 + 四卧两卫 + 走廊入户（三条回路 23 条）

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-08-05-017 全屋插座-洁具/家具交叉验证修正

- **决策**（16 个点位，不动几何/家具）：
  - 父母房：床头插座×2+双控开关 东墙→西墙 w_mb_east (4.20, 6.60/8.90/6.40)，随床头
  - 儿童房：床头插座 西墙(被衣柜挡)→东墙 (5.60,3.30) h=1.2
  - 主卧：床头右插座 z=8.5(床体内)→9.25；删除 sock_master_bay（并入 bed_r）
  - 客厅：沙发两侧墙插(偏1.95m)→沙发两臂旁地插 (11.0,5.35/8.65)
  - 主卫：洗手台插座随外移台→w_mbath_south (0.45,4.30)；灯开关移出门洞→(2.0,4.30)；补排风插座 (1.30,2.70) h=2.5
  - 客卫：洗手台插座 z=3.0→3.80；灯开关→门西 (6.15,4.30)；补排风插座 (6.35,3.25) h=2.5
  - plumbing：faucet_mbath_vanity 墙引用 w_strip_east→w_mbath_south
- **决策依据**：AGENTS.md 铁律——插座≈电器/洁具实际位置（偏差>1.5m 报警）；玻璃幕不挂载；开关不入门洞/门摆
- **预算影响**：删 1 墙插、加 2 排风+2 地插，点位净 +3，水电预算余量内（待决算核）
- **关联文件**：`config/electrical.yaml`、`config/plumbing.yaml`
- **决策人**：业主

---

### DEC-2026-08-06-019 厨卫洁具渲染补全 + 死代码清理

- **决策**：
  - FixtureFactory 补 fridge/gas_stove/range_hood/sink/vanity/exhaust_fan 配方（此前厨房四件 placed 不渲染；渲染路径为 FixtureFactory，非 FurnitureFactory）
  - 主卫洗手台 placed (1.75,4.70)（门洞实为 x∈[0.1,0.9]，台置门东墙段，verify 门摆校验定稿），插座随台 1.75、灯开关 2.40，faucet_mbath_vanity x→1.75；客卫洗手台 placed (5.80,3.50) 深 0.4 避门摆；两卫排风扇 placed 于吊顶 (1.30,2.70)/(6.35,3.25)
  - 删除零引用死文件 app/src/render/FurnitureFactory.ts（DEC-018 误向其加模型，实际渲染走 FixtureFactory）
- **决策依据**：3D 可视性闭环；马桶/花洒/龙头本由 plumbing 坐标渲染，洗手台/排风补齐同路径
- **预算影响**：无（counts 不变）
- **关联文件**：`app/src/render/FixtureFactory.ts`、`config/house.yaml`、`config/plumbing.yaml`、`shared/types.ts`
- **决策人**：业主

---

### DEC-2026-08-12-023 3D 效果模型升级包（PBR 地面 + 收纳三层摆位 + 室内灯光系统）

- **日期**：2026-08-12
- **决策事项**：法式复古方案评审衍生的一系列升级——地面人字拼决策支持、收纳体系落地、灯光可视化
- **背景**：业主评审两份外部装修建议（奶油法式复古通用版 + 20 万预算版），逐条对照底座后产生本升级包；业主补充实证：现住房一间儿童房退化成仓库（被褥/书籍/杂物），低频大件收纳为真实需求
- **选定方案**：
  - **PBR 地面渲染**（spec 2026-08-12-pbr-floor-rendering-design.md）：新 appearance type `wood_plank`（直铺/人字拼、plank_mm 物理尺寸、逐板 seeded 明度/粗糙度抖动、roughnessMap、米制 UV 标定、anisotropy=8）；floor_tile_01/bedroom_tile_01 升级为 800×800 直铺 wood_plank；新增 floor_tile_herringbone_01 候选（150×900 人字拼，价格待门店）
  - **收纳三层**（spec 2026-08-12-storage-system-design.md）：主卧 wardrobe_240 → `wardrobe_240_split`（西段 1.2m 加深 0.8m 被褥/行李箱，单类型双体块保持 count=1 预算口径）；NW 次卧西北角 `shelf` 置物架（低摩擦开架，书/杂物）；床箱床选型指令入 materials.yaml（主卧+父母房液压床箱款，父母房限低箱）；NW 次卧定位"儿童房（前孩时代=储物+客房，弹性恢复）"
  - **室内灯光系统**（spec 2026-08-12-interior-lighting-design.md）：electrical.yaml 扩展 16 个灯光点位（pendant/dome/wall_lamp/downlight/led_strip，全屋 3000K、厨卫 4000K，点位即水电交底单）；InteriorLightingSystem 渲染光源+灯具示意网格，日落/低高度角自动开灯，L 键手动开关；投影光源 ≤2
  - **榻榻米正式否决**：回南天密闭贴地箱体养霉 + 掀盖高摩擦收纳 + 焊死房间弹性，三条独立成立
- **决策依据**：法式骨架三件套中门窗物理不存在（幕墙），人字拼待 3D A/B + 门店版面数双重验证；收纳按"低摩擦"原则分层；灯光点位与水电交底同源
- **预算影响**：收纳 +3.2~5.5k（furniture_soft 池内）；灯光方案点位落地待"灯光升级"待决策项拍板（lighting 2800→6500，+3~4k）；人字拼 +6~10k 待决
- **关联文件**：三份 spec（docs/superpowers/specs/2026-08-12-*.md）、`app/src/render/TextureFactory.ts`、`TextureManager.ts`、`InteriorLightingSystem.ts`、`seeded-rng.ts`、`FixtureFactory.ts`、`shared/types.ts`、`config/electrical.yaml`、`config/materials.yaml`、`config/house.yaml`、`config/design-rules.yaml`、`config/verify-rules.yaml`
- **决策人**：业主

---

### DEC-2026-08-26-011 玄关门厅筒灯与最小灯光回路语义

- **日期**：2026-08-26
- **决策事项**：补齐室内玄关门厅筒灯，并为已确认灯具建立最小回路字段。
- **选定方案**：新增 `light_entry_foyer`，归属 `living_dining`，落位 `(12.4, 3.35)`，`height=2.5`、`temp=3000`、`circuit=entry_base`；位于门厅吊顶与 `living_dining` 过渡带中心附近，使用既有 `ceiling_entry_foyer` 吊顶，不改吊顶或电视背景墙。
- **决策依据**：坐标位于既有门厅吊顶 `[10.80,2.90,13.40,4.30]` 内，靠近过渡带中心并避让玄关半高柜及入户门开启区；不移动既有 `light_entry_down`（仍归属 `entry_garden`）。回路仅表达最小控制分组：客厅基础光、餐厅灯、电视氛围灯、入口/走廊基础光。
- **预算影响**：无阴影预算及复杂场景变化；新增一个已确认灯具点位。
- **关联文件**：`config/electrical.yaml`、`config/render/overrides.yaml`、`shared/project-render-facts-projection.ts`、`docs/dressing-map.md`
- **渲染表现确认**：`light_entry_foyer` 增加 `recessed: true`，按既有玄关吊顶内嵌安装表现；主体进入吊顶厚度，饰圈贴完成面、发光面略低，不改吊顶及其他灯具。
- **后续预留**：厨房台面/柜底灯、主卫/客卫镜前灯、父母房床头灯、书房桌面灯仅作后续深化/现场确认项，不作为当前实施点位。
- **决策人**：业主

---

### DEC-2026-08-26-012 保留走廊口筒灯并纳入既有客厅边吊

- **日期**：2026-08-26
- **决策事项**：保留 `light_corridor_1`，调整为既有吊顶内嵌筒灯。
- **选定方案**：保留 `light_corridor_1`，归属 `living_dining`，坐标由 `(7.9,5.75)` 调整为 `(7.9,5.0)`，增加 `recessed: true`，渲染锚点 `anchorY=2.5`，回路保持 `entry_base`。
- **决策依据**：`(7.9,5.0)` 位于既有 `ceiling_living` `[7.20,4.30,13.40,5.20]` 合法范围内，避开电视高柜 `x≤7.55`，且仍靠近原走廊口；主体进入既有边吊，饰圈齐平完成面、发光面略低，不新增客厅灯、不改电视背景墙或吊顶结构。
- **预算影响**：无新增灯具或吊顶工程，仅调整既有点位的归属表现。
- **关联文件**：`config/electrical.yaml`、`config/render/overrides.yaml`、`docs/dressing-map.md`、`docs/superpowers/specs/2026-08-12-interior-lighting-design.md`
- **决策人**：业主

---

### DEC-2026-08-26-043 客厅无主灯整改收敛

- **日期**：2026-08-26
- **决策事项**：客厅主灯由遗留 pendant 点位收敛为无主灯基础照明
- **可选方案**：保留主吊灯；新增复杂吊顶；采用黑色明装轨道灯
- **选定方案**：采用 `living_track_main`，一条黑色明装轨道、5 个可调灯头，作为客厅基础光回路
- **决策依据**：依据 DEC-027 及本次业主确认；轨道沿 x 方向固定布置，覆盖客厅、茶几和通行区，避免直射电视
- **预算影响**：仅替换客厅主灯具表达，不新增电视背景墙，不增加吊顶复杂度；餐桌吊灯、电视墙灯带、走廊/玄关及其他房间灯保留
- **关联文件**：`config/electrical.yaml`、`config/render/overrides.yaml`、`shared/project-render-facts-projection.ts`、`app/src/render/InteriorLightingSystem.ts`、`scripts/blender/dress_scene.py`
- **决策人**：业主

---

### DEC-2026-09-07-056 电气回路拓扑补全：全部插座/灯具归回路 + 开关绑定受控灯具 + 回路参数

- **日期**：2026-09-07
- **起因**：巡检发现 `verify:electrical` 存在 64 条 warning：厨房插座群/烟机/净水器/燃气热水器/入户花园插座/网关/电视灯带等未归入任何回路；两处双控无受控灯具；全部回路缺容量/线径/断路器参数；另修复 sock_living_water 挂墙基准错误（原挂 w_liv_east @z=9.0 投影超墙段 3.45m，且该处为东南室外凹口无墙，改挂 w_be_west 客厅侧 z=8.40）。
- **决策事项**：
  - 新增 `ordinary_power_kitchen`（台面/净水/烟机/热水器控制器，4mm² C20A 漏保）、`ordinary_power_garden`（2.5mm² C16A 漏保）；网关/灯带并入客厅回路、书房备用插座并入卧室回路。
  - 全部 24 个回路补 capacity/wire_size/breaker（proposed 值，依据 mep-construction-guidance §3.1：照明 1.5mm²、插座 2.5mm²、厨房 4mm²）。
  - 新增 8 条 controls：走廊/书房/儿童房/厨房/主卫/客卫/花园单控绑定 + 客厅与父母房双控绑定受控灯具（proposed，待交底确认）。
  - 口径声明：开关经 controls 绑定、网络点位归弱电箱，均不计入强电回路成员（Phase 1 口径），写入 pending_parameters。
- **预算影响**：无直接变化；厨房 4mm² 与漏保配置在 water_electric 12000 口径内（回路数增加约 2 路，交底时与施工方核价）。
- **关联文件**：`config/electrical-topology.yaml`（整体补全）、`config/electrical.yaml`（sock_living_water 修正）
- **决策人**：业主（委托巡检整改）

### DEC-2026-09-07-057 强电实体走线补全：普通插座/照明/专用回路全部上走线图（40→65 条）

- **日期**：2026-09-07
- **起因**：业主指出回路拓扑虽已补全（DEC-2026-09-07-056），但卧室等房间插座在走线层仍无实体路径——mep-hvac-coordination 此前仅覆盖主干 + 5 路空调电源（6 条 strong_power），普通/照明/专用回路只有拓扑归属没有回环线路。
- **决策事项**：新增 25 条 strong_power 路线（照明 11、专用负载 5、普通电源 9），总走线 40→65 条：
  - 走带体系沿用既有约定：主干自 bend_corridor 枢纽分发；卧室系干线穿墙后贴 w_mb_east 西脸 / w_be_west 东脸 2.40m 墙行，厨卫系走铝扣板上方 2.60m，客厅/餐厅出边吊后走平吊板上方 2.70m；
  - 每间卧室一条"干线+沿线分发"走线（如主卧：穿孔→条带→w_mb_east 墙行依次覆盖床头双插/床尾插/壁灯/窗帘盒/投影地插），回路与拓扑 1:1 对应，跨区回路按物理段拆分（主卫/客卫卫浴电源各一条）；
  - 穿墙声明 8 处 17 孔（全部与既有穿孔带同区、平行孔分散）：w_strip_east(4.2,4.6)、w_st_north(5.5,5.55)、w_nw_south(4.35,4.3)、w_be_west(13.4,5.9 门头)、w_gbath_south(6.7,3.55 门头)、w_mbath_south(2.0,2.86 新建墙预埋)、w_ent_south_w(11.3,2.9 门头)、w_balc_east(7.2,1.6)；
  - 修正一处范围误读：生活阳台实为 z[1.0,2.2]，z[0,1.0] 为 w_vrv_north 圆弧室外飘窗区（禁穿），洗烘回路改穿 w_balc_east 进阳台；
  - review-manifest 登记 round 2；mep-construction-guidance 计数与基线同步。
- **验证**：verify:mep 0 error / 22 warning（15 条既有已接受 + 7 条 shear_wall_penetration，新增 4 条同属 w_strip_east 穿越工艺提醒）；verify:all / test:server / typecheck 全量回归通过。
- **预算影响**：无直接科目变化；回路穿墙孔位与平行孔数量在水电交底时与施工方核价（water_electric 科）。
- **关联文件**：`config/mep-hvac-coordination.yaml`、`docs/design-iterations/mep-routing-20260901/review-manifest.json`、`docs/mep-construction-guidance.md`
- **决策人**：业主（委托巡检整改）

### DEC-2026-09-08-R1 全屋电气点位审计与升级（插座/灯控/空调线控）

- **日期**：2026-09-08
- **起因**：业主全屋电气审计请求（主卧插座/床头灯控与空调控制、入户灯控、大厅空调控制、客卫洗漱台插座"看不到/少了"系列问题）；先审计对齐、后按授权实施。
- **审计结论（业主 4 项观察核实）**：① 主卧插座数量充足（7 位），南床头有双控开关、北床头无，全屋 5 房无任何空调控制器点位（最大结构性缺口）；② 入户灯控存在但被门内半高柜（x[11.31,11.70]×h1.50）完全遮挡且在门扇扫掠背面；③ 大厅同①；④ 客卫洗漱台仅 1 位且压墙角端点。另发现：儿童房开关被通顶衣柜掩埋（x=4.35∈柜 x[2.60,4.40]）、走廊开关挂错墙段（渲染钳位偏移 0.55m）、餐桌吊灯"幽灵开关"（注释有点位无）、14 处缺 wall_side。
- **业主决策**：Q1 全屋 5 房预留空调线控器底盒+信号线管（品牌中立，与定标解耦）；Q2 入户开关移门洞东墙垛；Q3 无争议修正包全授权；Q4 增补全选（北床头双控/儿童房床头双控/客卫插座+1/餐桌吊灯墙控+灯带控制声明）。
- **实施**：修正 switch_living_entrance（→13.10 东墙垛）、switch_child（→门垛 4.475，type 改 switch_2way）、switch_corridor（改挂 w_gbath_east_open_vanity 归位 4.10）、sock_gbath_vanity（离角 3.882/h1.0 镜面下）+10 处 wall_side；新增 ac_panel_living/master/parent/child/study（新类型 ac_controller 及渲染/标注/schema 钩子）、switch_master_bed_north（北床头双联，sock_master_bed_l 随移 6.202 围绕柜轴 6.245 居中）、switch_child_bed、switch_dining、sock_gbath_vanity_2；topology：control_master_bed_door 升 switch_multiway 三控、control_child_light 升双控、新增 control_dining、pending_parameters 补线控器与灯带控制口径。
- **取证修正（证据驱动，冻结范围内）**：ac_panel_child 由东墙 (5.60,4.10) 改南墙门东垛 (5.525,4.30)（原位在 d_bnw 门扇 90° 开启面后方）；ac_panel_parent 由门口 x=5.88 改床头东墙 (4.20,6.314,h=0.7)（原位落入北墙通顶衣柜 x[4.20,6.00] 背后）。
- **验证**：verify:all 0 error（点位专项 warning 14→5，均有 note 登记）；test:server/test:app/typecheck 全绿；17 个新/移点位浏览器运行时 AABB 与 datum 一致；同机位 A/B 截图 16 张（tmp/screenshots/electrical-audit/）；独立美学/功能双评审两轮 PASS。
- **现场待确认**：线控器信号线规格/供电随品牌定标厂商深化；剪力墙（inferred shear）开盒可行性；门垛贴装与门套收口；客卫龙头高度与防溅盒配合；全部量房终核。
- **后续议题（本轮未动）**：switch_parent_door 西半板面被衣柜侧板部分遮挡（建议移门垛中心 6.075）；switch_garden 夜归动线；主卫电热毛巾架电源；sock_child_ac 投影偏移随厂家深化；文档漂移（house.yaml 父母房注释/mep 网线/sock_living_water 注释）。
- **关联文件**：config/electrical.yaml、config/electrical-topology.yaml、config/plumbing.yaml、config/house.yaml、shared/types.ts、shared/project-render-facts-schema.ts、shared/electrical-lint.ts、shared/render/FixtureFactory.ts、shared/render/InfrastructureBuilder.ts、app/src/render/HouseScene.ts、app/src/render/annotations/{AnnotationRenderer,ProblemDetector}.ts、tests/server/{master-bedroom-dressing,cli-glb-export,electrical-lint,render-facts-api}.test.ts、docs/design-iterations/electrical-upgrade-20260908/
- **决策人**：业主（Q1–Q4 拍板）；施工尺寸待量房与厂家深化

### DEC-2026-09-08-R2 父母房门口开关移至门垛中心

- **日期**：2026-09-08
- **起因**：R1 取证发现 switch_parent_door（x=6.00）面板西半被北墙通顶衣柜（x[4.20,6.00]）东侧板遮挡约 0.043m；业主拍板"顺手一起改了"。
- **实施**：x 6.00→6.075（门垛 [6.00,6.15] 中心），面板跨度 [6.032,6.118] 完全脱离衣柜；距 d_study 门洞边缘 0.075m 贴门套安装，点位专项 warning 登记于 note。
- **验证**：verify:consistency 0 error；test:server 540 pass。
- **关联文件**：config/electrical.yaml、docs/design-iterations/electrical-upgrade-20260908/review-manifest.json
- **决策人**：业主

### DEC-2026-10-03-R1 水电施工冻结前收口：25 路→19 路、补漏保、燃气报警器合规位、验收扩 9 项

- **交叉引用**：同一轮的验证记录与跨迭代阻塞见 **DEC-2026-10-03-R7**（原与本条同名 DEC-2026-10-03-R1，为避免撞号已改号为 R7）。
- **日期**：2026-10-03
- **起因**：业主就一份外部水电 review 征询意见。复核后确认 8 项成立（马桶水+电撞点、厨房台面取电未形成两区、电视壁挂却只有低位柜内电源、网关位有电无网口、洗烘检修位、燃气报警器高度与距离双不合规、冰箱+空调 5 路无漏保、回路拆得过碎），并补充 6 项（主卫无马桶排污点、强电箱安装高度与单/双排合规、两个智能马桶位缺防溅盒、25 路对 390mm 箱容量、全屋无等电位点位、验收只有 2 项）。
- **选定方案**：
  1. 点位新增 4 个：`sock_living_tv_high`(7.20,7.70)h=1.70（电视/音响背后高位 + φ25 独立穿线管）、`sock_kitchen_counter_east`(10.80,1.70)h=0.30（灶台段第二取电区）、`net_gateway`(7.20,5.70)（Cat6×2：WAN 上联 + LAN 回弱电箱）、`net_ap_corridor`(8.60,5.80)h=2.5（吊顶 AP 预留）。
  2. 点位移动 1 个：`sock_kitchen_gas` (10.80,1.60)h=2.0 → (10.80,0.55)h=2.35，满足 CJJ/T 146-2011（天然气近顶安装、距灶具及排风口 >0.5m）。
  3. 5 个点位标 `position_status: pending` 但不动坐标（马桶×2、洗烘×2、灶台段取电）——SKU 冻结前不拍坐标，并把约束写进 note。
  4. 水路补齐 `drain_mbath_toilet`(2.60,1.50)h=0.02；主卫坐便器形式/坑距未定，壁挂则给水+电+排污全进假墙。
  5. 拓扑 25 路 → 19 路（照明 11→5、空调 5→2、普通 5→7、专用 4→5），所有含 type: socket 的回路补 `+漏保`（GB 55038-2025 7.4.3-1）；洗烘按 7.4.4 拆两条；合并依据 7.4.4 为"类型级分别设置"，不要求每房每灯独立。
  6. 验收 `electrical_check` 从 2 项扩到 11 项（新增 PE/极性、绝缘电阻、30mA RCD 动作、局部等电位、防溅盒、强弱分管、配电箱与进线开关/高度、点位可及性、燃气报警器）；其中 4 项 `critical` 直接进入付款门槛（`control.ts` gateStatus 只认 critical）。
- **决策依据**：GB 55038-2025 7.4.3-1/2/3、7.4.4、7.4.5、7.4.7；CJJ/T 146-2011；GB 50303 / GB 50327（绝缘、填充率、暗敷禁接头）；几何用 model-geometry 直算（厨房东墙有效区间 z[0,2.40]，z≥2.40 为通长推拉门无墙；生活阳台 1.60×1.20m）。
- **验证**：19 路全量覆盖 66 个 powerable 点位（脚本核对无遗漏、无跨回路重复、无网络点误入回路）；每一条含 socket 的回路 breaker 均含漏保；polygon 校验新点位全部落在所属房间内。
- **现场待确认**：① 强电箱单/双排、回路数、进线截面与箱体规格（390mm 箱单排撑死 ~20 位，19 路须双排；单排时箱底边须 ≥1.80m，现 1.65m 仅双排合规）；② 马桶 SKU/坑距/落地-壁挂；③ 燃气气源与燃气公司报警器 + 切断阀方案；④ 空调厂商配电图（能否集中供电、是否必须无漏保硬接线）；⑤ 橱柜台面取电形式；⑥ 洗烘/冰箱 SKU 尺寸与检修带。
- **关联文件**：`config/electrical.yaml`、`config/plumbing.yaml`、`config/electrical-topology.yaml`、`config/mep-hvac-coordination.yaml`、`config/acceptance.yaml`、`docs/pending-site-data.md`、`docs/mep-construction-guidance.md`、`docs/design-iterations/mep-power-water-freeze-20261003/`、`tests/server/electrical-lint.test.ts`、`tests/server/render-facts-api.test.ts`、`tests/server/cli-glb-export.test.ts`
- **决策人**：业主（review 与计划审批）；点位终坐标待量房、水电交底与 SKU 定标

### DEC-2026-10-03-R7 水电收口的验证记录与跨迭代阻塞

- **交叉引用**：本条即同一轮水电收口的验证记录；同一轮的第一条（水电施工冻结前收口：25 路→19 路、补漏保、燃气报警器合规位、验收扩 9 项）见 **DEC-2026-10-03-R1**；本条原编号 R1 与其重号，故改号为 R7。
- **日期**：2026-10-03
- **验证结果**：`npm run verify:all` exit 0（11 步全过：点位专项 0 error/6 warning、data-consistency 0 error/6 warning、spatial 0 error/10 warning、rules 0 error/4 warning、furniture 2 warning）；`verify:electrical` 0 error / 45 warning（基线 22，增量全部为 net_gateway/net_ap 的弱电未覆盖告警与 11 条 pending_parameters）；`verify:mep` 0 error / 22 warning（与基线持平）；`verify:schedule` exit 0（66 checks）；`typecheck` 干净；`test:server` 545 pass，2 fail。
- **2 个 fail 归属**：`tests/server/api.test.ts:74` 与 `tests/server/budget-api.test.ts:78` 仍断言 `phase_1 ceiling = 203000`，而 schedule/budget 迭代已把一期执行上限调整为 206,000（见 `schedule/phase-1/control.yaml`）。属该迭代待同步的旧断言，本迭代不改预算数字。
- **代修**：`schedule/phase-1/control.yaml:62` 存在未加引号的 `funding_status: owner_review_pending_20261003`，导致整份 schedule YAML 无法解析（连带 `verify:schedule` 与 2 个 server 测试失败）。已改为全角冒号，纯语法修复、无内容变更。
- **关联文件**：`docs/design-iterations/mep-power-water-freeze-20261003/review-manifest.json`
- **决策人**：业主（范围）；budget/schedule 数字归 schedule/budget 迭代

### DEC-2026-10-04-R2 三路审计收口：外机供电入账第 20 路、燃气位重算、验收接门禁、悬空编号回补

- **日期**：2026-10-04
- **动因**：同日对结构/机电/验收三条线做一致性审计收口；本编号此前已被 3 个 config 文件 5 处引用但决策日志无条目，**本条即回补该悬空编号**，作为三路审计（工单 A/B/C）的统一收口记录。
- **① 4 BLOCKER + 12 MAJOR 处理摘要**：
  - **机读状态改成交**：electrical/hvac 中对应点位与回路的 inferred 占位按 DEC-2026-10-04-R1 成交事实回写；
  - **house.yaml 现行口径**：暖通 system 段以现行成交口径为准（美的领航者Ⅳ MJV-200W-E01-LHIV 20kW 一拖六，整包含价 ¥36,000）；
  - **采购型号标注**：内机 6 台全为双出风 MJV-…/P-SS（全带冷凝提升泵），判读 71+42+56+28×3=25.3kW，**房间映射与逐台型号以合同附图为准**；
  - **燃气象限重算并北移至 (10.80,0.20)**：sock_kitchen_gas 按机体最近缘（非点到点）重算，距油烟机北缘/灶具北缘均 >0.5m、近顶安装 ≤0.3m，满足 CJJ/T 146-2011，最终仍以燃气公司报警器+切断阀方案终核；
  - **第 6 台内机补强电走线与线控器点位**：新增 sock_dining_ac（hvac_power_living 第二成员）与 ac_panel_dining（线控器，补齐 R2 第六房）；
  - **wire_size 1.5→2.5mm²**：hvac_power_living / hvac_power_bedrooms 按 docs/mep-construction-guidance.md §3.1「插座 ≥2.5mm²」口径修正（原 1.5mm² 与本项目自订自规矛盾）；
  - **DEC 撞号改 R7**：同日出现多个 R2 撞号，本审计系列定点为 R2，另一撞号分支改判 R7。
- **② 外机供电四层补齐 + 第 20 路 + 单排箱出局**：
  - 四个数据层全补齐——`config/electrical.yaml` 点位 `sock_vrf_outdoor_a2`、`config/electrical-topology.yaml` 回路 `hvac_power_outdoor_a2`、`config/mep-hvac-coordination.yaml` 走线 `strong-ac-outdoor`、`config/hvac.yaml` outdoor/load_design 电力参数；
  - 按 GB 55038-2025 7.4.4（2kW 及以上用电设备回路应分别设置），20kW 外机单独成路 → **回路总数 19→20**（此前四层全空白，是 R1「19 路」遗漏的最大单体负载）；
  - 390mm 箱体按 **20 路 + 2P 进线开关 + 浪涌**重算：单排约 16 位可用**确定装不下 → 单排箱出局，必须双排或换箱**；且单排布置时箱底边须 ≥1.80m，现 `panel_strong_entry_left` mount_height 1.65m **仅双排合规**。
- **③ 验收口径扩展**：`acceptance_refs` 接入 7+2 项，可审计检查 **66→75**；配电箱标识检查补「含中央空调外机专用回路」。
- **④ 待核四项统一清单（全仓一致，见 config/hvac.yaml load_design.basis 与 docs/pending-site-data #39）**：① 合同房间映射与逐台容量表；② 外机实测尺寸与西平台散热核算；③ 厂家多台内机合并供电**与外机**正式配电图；④ 风口加长是否已含 + 分房间冷负荷计算书是否到手。
- **⑤ 状态**：contract_decided（选型与商务）/ vendor_verification_pending（上述四项）/ construction_not_frozen（量房与水电交底前任何机位、电源、冷凝水、穿墙不冻结）。
- **附注一（主卧轴线，只登记不改坐标）**：机身中心 x=3.80 / 风口轴 x=3.70 / 门头盒中心 x≈3.5625 三值不一致；900mm 机身按现中心 3.80 越盒东界 x=4.20 约 5cm、并越主卧东墙完成面 ≈x=4.14 约 11cm，属 site_pending；交底前须实测外廓（合同判读 42T2 SS 或设计 45T2）后把机身中心统一到 ≈3.65–3.70 并对齐风口轴，此前不冻结任何机位。
- **附注二（AP 点位）**：net_ap_corridor 自 (8.60,5.80)（落在所有已声明吊顶之外，原「藏吊顶空腔」不成立）移入 ceiling_living 北缘边吊空腔 (8.60,4.75)，备选走廊吊顶位待网络方案定标。
- **关联文件**：`config/electrical.yaml`、`config/electrical-topology.yaml`、`config/mep-hvac-coordination.yaml`、`config/hvac.yaml`、`config/acceptance.yaml`、`config/ceiling.yaml`、`docs/mep-construction-guidance.md`、`docs/pending-site-data.md` #39、`config/house.yaml`（现行口径）
- **决策人**：业主（审计口径）；施工尺寸与外廓待量房与厂家资料终核

### DEC-2026-10-05-R13 B5-A：书房电脑专用回路改道（ordinary_power_study 随功能互换归位）

- **日期**：2026-10-05。迭代 `parent-room-study-swap-20261005`；前置为 R9 审查发现的 P0/B5 口径债（专用回路物理管线通向客房、电脑已在书房）。
- **决策（业主拍板）**：选 **A 改道**，弃 B 修订口径。理由：DEC-2026-10-03-R1 的意图是"电脑负载不与他路混"，不是"某房间该有专用路"；电脑现在在书房，回路跟着电脑走。改道在**未施工**状态下仅配置层 declaration，成本 0；水电交底后即不可改（等于开槽返工）。
- **电气拓扑**：`ordinary_power_study` 成员由 `[sock_study_desk, sock_study_curtain, sock_study_extra]` 改为 `[sock_parent_desk]`（书房书桌位 (4.20,9.00) count 2 = 电脑+显示器），breaker/wire/capacity 口径不变；`ordinary_power_parent_child` 成员加入客房三席位（`sock_study_desk`/`sock_study_extra`/`sock_study_curtain`），capacity ≈0.8kW → ≈1.2kW（方案值，交底按实际设备终核）。
- **走线**：`config/mep-hvac-coordination.yaml` 的 `strong-power-study` 由"走廊东行→过 d_bese 门头→客房北边吊"改为"走廊 z=4.6 轴线西行至 x=5.5 → 正交穿 w_st_north（与 strong-ac-parent / strong-light-parent / strong-power-parent **同一穿孔带**，穿点位于门洞 d_study 以西实体段）→ 书房北缘边吊内西折至 x=4.3 → 贴 w_mb_east 东侧南下 → 下引至 sock_parent_desk"。id 不改，penetration 声明随改。
- **对账影响（必须登记）**：改道使契约 `c.mep_layer_below_drop_bottom` 的实算冲突 **+1**（本路线 4 处分区内 hit，其中走廊/边吊段 2.45m 低于 2.50m 完成面，与同穿孔带三条既有路线同一类别）。该基数由并发工作线的客餐厅冷凝水改线从 149→153 先行登记，本决议后再由机器实算 154；`docs/mep-construction-guidance.md` 与 `config/facts.yaml` 的登记数 154 与实算一致（`verify:facts` 绿）。归口裁定项仍是 `docs/pending-site-data.md #41`（分层标高升入降板空腔或调整降板），本决议不替代该裁定。
- **保留未动**：客房床头电位高度缺陷（P0-2：`sock_study_extra` h=0.3 不可当床头电位）与床头双侧点位/双控仍属批次 B，待量房墙体数据后申报；`sock_parent_bed_l` 孤儿位语义待量房定。
- **验证**：`verify:mep` Exit 0 / `verify:electrical` 0 error / `verify:facts` OK / `test:server` 608/609（唯一红为并发未提交项的 mep 基数断言，已由对端同步至 154）/ `typecheck` / `test:app` 470/470。

### DEC-2026-10-06-R2 电气兜底轮：微蒸烤预留接口 + 全盒零线 + 防溅盒 + 窗帘电源入盒

- **日期**：2026-10-06。
- **决策事项**：
  1. **微蒸烤只做预留接口、不落设备锚点**（业主明示"不一定一二期落地"）： Kitchen 高柜内预留 16A 专用回路 1 路 + 底盒位，`position_status: pending` 随橱柜冻结落位，不写 `config/house.yaml` furnishings 锚点、不进 `materials.yaml`、不进预算成交项；回路 capacity 按 3.2kW 预留（GB 55038 7.4.4 类级），断路器按 C16A。
  2. **全屋开关底盒统一预埋零线**（`neutral: true`，17 个 switch/switch_2way 点位）：单火智能开关在 LED/起夜灯负载下"鬼火微亮"近乎必然，预埋零线成本≈0、后补=重做一次电。`config/house.yaml` smart_home 的"智能开关零线"承诺由此逐点兑现。
  3. **两处浴霸插座补防溅盒声明**（`sock_mbath_batcheheater` / `sock_gbath_batcheheater`）：GB 55038-2025 7.4.5 强制项，此前 note 漏声明，已由 `bath_socket_splash_box_undeclared` 抓出。
  4. **三处电动窗帘电源移入窗帘盒**（`sock_master_curtain` / `sock_parent_curtain` / `sock_study_curtain`）：原坐标偏离各自窗帘盒 0.55m、落在南飘窗窗洞包络内且无吊顶/无 route 登记；改为贴窗帘盒中线（z 8.82 / 8.82 / 7.72、h 2.65），并补 3 条强电 route + 穿点声明。
- **影响**：回路数 21→22 的口径以"预留接口"登记（未激活时不占箱位，激活时+1）。
- **验证**：`verify:all` / `test:server` / `typecheck` 见执行记录。
- **未动**：空调内机供电分组（等厂家正式配电图，见 R3）；配电箱单/双排与迁位（见 R3）。

### DEC-2026-10-07-F01 飞线改线批：unsupported_span 首扫 33 条清至 8 条显式保留

- **触发**：`unsupported_span` 飞线依托检查（本轮新增 lint 规则，见 F02）在真实配置首扫 33 条——其中 `strong-power-living` 干线出边吊后 4.16m 横穿客厅中部原顶区，与 `weak-ap` reason「客厅中部保持原顶 2.80m 无吊顶」的声明直接矛盾；`weak-gateway`/`weak-ap` 门厅段 z=4.2 轴线落在门厅吊顶（z[2.9,4.3]）与客厅边吊（z[4.3,5.2]）之间的无吊顶死区；另有 M05 批量补的卧室照明/插座分支出吊后 0.9–1.9m 无依托横移。
- **决策**（依托类目内可清的全部清零，模型包络缺口显式保留）：
  - **改线 17 条**：`strong-power-living` 干线改沿 w_be_west 东脸（x=13.4 贴墙）南下至 z=9.65 入 curtain_box_living/drying_rack_living 吊顶带西行（方案 A，业主批准），`strong-power-living-east-wall` 冗余竖直下引路由撤并（sock_living_water 取电由 strong-power-living-curtain 上行段覆盖，下引量由 takeoff terminalDrop 派生——路由总数 138→137）；`weak-gateway`/`weak-ap` 门厅段改走 ceiling_living 轴线 z=4.6（weak-ap 删 (8.6,5.8) 旧残留节点，点位实际已在边吊内 4.75）；`strong-light-entry-foyer` 分叉点改到干线穿墙后的门厅吊顶内 (11.30,3.00,2.55)，删除与 strong-light-entry-base 重复的花园段与独立穿孔；`strong-light-entry-base` 花园段改贴 w_ent_south_w 内脸（z=2.88）；`strong-ded-washer-dryer` 穿点 z=1.6→2.15（过门洞 d_kit_balc 南侧实体段，净距恰 0.15m），阳台内贴 w_balc_south/w_balc_west；`strong-ded-bathheaters-gbath` 斜降段正交化（先吊顶内东行至 sock 上方再贴 w_gbath_east 下引）；`strong-power-child` 地插改垫层分支（边吊内分叉下引进垫层，sofa_l 先例）；`childbed` 改沿边吊东行后贴 w_gbath_west 系墙南下；卧室/客厅 12 条末段 y 统一 2.7（原顶暗敷带，见 F02）。
  - **保留 8 条**（每条 reason 带 F01 归因，全部为模型表达缺口而非设计放行）：condensate-living/dining（R5 梁带残留，量房实测梁底后复判）、condensate-master（通顶衣柜顶隐藏，家具不入机判依托）、strong-power-mbath-service / strong-ded-bathheaters-mbath / strong-light-mbath-panel（主卧条带内西行，条带南墙未入模型）、strong-light-entry-switch-garden（开发商花园完成面无吊顶模型，明敷待物业）、refrigerant-trunk（VRV 平台设备连接段，室外无依托几何）。
- **验证**：verify:mep 0 error / 139 warning（unsupported_span 8）；`mep-hvac-lint.test.ts` 26/26；治理 §6 分桶表与 review-manifest 同步（unsupported_span 33→8）。
- **关联文件**：`config/mep-hvac-coordination.yaml`、`shared/mep-hvac-lint.ts`（F02 类目）、`tests/server/mep-hvac-lint.test.ts`、`docs/mep-construction-guidance.md` §0/§6、`docs/design-iterations/mep-lint-governance-20261006/review-manifest.json`、`docs/decisions/06-electrical.md`（本条）。
- **决策人**：业主（方案 A 干线走向经业主批准）。

### DEC-2026-10-07-F02 unsupported_span 依托模型补全：首末段设备接线段（原顶暗敷带）

- **触发**：依托检查首轮口径（吊顶空腔/贴墙/穿墙/纯竖直/垫层五类）把原顶 2.80 区的灯具/地插/外机接线段全部刷成飞线——但吸顶灯接线盒、灯轨槽、外机连接管走**楼板底抹灰层暗敷**是标准工艺且有结构依托，属于依托模型漏了第四类真实依托「结构楼板底」，不是设计错误。
- **决策**：补第六类依托——**首末段设备接线段**：段为折线首段（from 为点位 id）或末段（末段若为 ≤0.3m 到位步则取倒数第二段；to 为点位 id），平面长 ≤2.0m，段两端 y 均值 ∈ [2.66,2.85]（原顶 2.80 − 灰层/管径 ≈2.68，容差到 2.66；上限防飞到楼板上方）。三重硬约束防滥用：只认首/末一跨、≤2m、y 带窄；中段横移、超长、y 出带照报 unsupported_span。
- **与消音的边界**：本类目有物理依据（楼板底暗敷为标准工艺）、有 DEC 登记本条、有可证伪的硬约束；不符合三约束的段不豁免——本轮改线后仍保留 8 条 unsupported_span（见 F01）即为证明。
- **验证**：`mep-hvac-lint.test.ts` fixture 用例 6 断言（末段豁免/首段豁免/中段不豁/y 出带不豁/超长不豁/内联端点不豁）。
- **关联文件**：`shared/mep-hvac-lint.ts`（SUPPORT_FIXTURE_TAIL_MAX / SUPPORT_SOFFIT_BAND_*）、`tests/server/mep-hvac-lint.test.ts`、`docs/decisions/06-electrical.md`（本条）。
- **决策人**：业主。

### DEC-2026-10-07-M02 水电算量修正口径 + 报价卡迁移到通用卡片模型（不再重复造轮子）

- **日期**：2026-10-07。触发：业主贴出第三方评审，指出 takeoff 把逻辑线路长度当成实际施工管线长度（Σ shortestPath 式重复计量），并要求先修算法再谈删点位。
- **① 计价口径修正（`shared/mep-takeoff.ts`）**：强电管改为 **`Σ_回路 union(该回路画线路由) + 未画点位 allowance`**。逻辑口径（Σ各条长度）降级为诊断字段 `conduit.strongPowerLogicalM`，**不得用于采购计价**。导线同步改为「该回路 union 长度 × 芯数 × 损耗」——同一回路内多端点星形回线的共享段只铺一次管、只穿一次线。
- **修正效果（可复算）**：强电管 **532.8m → 470.2m**（同回路 union 178.3 + allowance 292）；跨回路去重下限 102.0m 仅作理论下限参考；导线 **1,632m → 1,534m**。剩余大头是 allowance 292m（5m/点经验上限），已加 `allowance_cluster_discount` 旋钮（默认 1.0 保守），量房实测后收紧。
- **② 空调线控器移出强电管材**：6 个 `ac_controller` 共 24m 不再计入 `strongPowerTotalM`（控制/通讯线按厂家接线图，归属空调商还是水电未声明，进 `deferred`）。此前它既进管材又被打上"归属待声明"，自相矛盾。
- **③ 报价层不再重复造轮子**：删除自建的 `shared/mep-cost.ts`；把 `server/ceiling-quotes.ts` 的通用机制抽到 **`shared/quote-cards.ts`**（卡片模型 + `active` 一行切换 + 留 .bak + 待报价显形 + `out_of_scope` + `comparable:false` 门禁 + 并排对比 + `deltaVsActive`），吊顶改为薄封装（行为不变，10/10 测试通过），新增 `server/mep-quotes.ts` 复用同一机制。MEP 计价行共 32 个 key（材料 27 + 人工 5），一张卡 = 一个可执行方案。
- **④ 五张方案卡并排（量不变，只换单价）**：`owner_baseline_40` **¥18,069**（生效，伟星家装绿+远东+中财H415+正泰+业主指定人工 40 元/㎡）｜weixing_engineering_grey ¥17,035（−1,034）｜liansu ¥16,796（−1,273）｜schneider_upgrade ¥20,127（+2,057）。对照 PKG-040 planned ¥15,000 缺口 **+¥3,069**（较修正前 ¥20,414 的口径已下降 ¥2,345，且不再含 10% 不可预见——那属预算层）。
- **尚未完工（下一步）**：`GET /api/mep/quotes` + `POST /api/mep/quotes/active` + MCP `get_mep_quotes`/`set_mep_quote` 的接线（吊顶已有同款）；`shared/mep-hvac-lint.ts` 增加「同回路路径重复/并排」规则，让 `verify:mep` 持续报而不是一次性脚本。
- **关联文件**：`shared/quote-cards.ts`（新，通用）、`shared/mep-takeoff.ts`（计价口径 + union + cluster 折扣）、`server/ceiling-quotes.ts`（改薄封装）、`server/mep-quotes.ts`（新）、`config/mep-quotes.yaml`（改卡片模型，5 卡 32 行）、`config/mep-takeoff.yaml`（口径说明 + cluster 旋钮）、`config/facts.yaml`（coverage 更新 + circuit_count 镜像改 `回路?`）。
- **决策人**：业主。

### DEC-2026-10-07-M03 删掉 allowance 臆测数据：没有路由的点位不进采购量

- **日期**：2026-10-07。触发：业主发现"强电管 470.2m 里 292m 不是模型算出来的"，质问"之前不是强调要通过模型里的数据做计算吗"，裁定"删掉臆测数据，以模型里的为准"。
- **问题根因**：`config/mep-takeoff.yaml` 的 `allowance_unrouted_points`（socket 5m / switch 4m / night_light 3m…）是一张**手写经验表**。111 个点位里 72 个没有 physical route，几何上算不出长度，于是按"每点几米"查表凑数——**只有"哪些点没路由"来自模型，"每点几米"来自行业经验**。它被加进 `strongPowerTotalM` 后和真实几何量混成一个数报出，构成"用标注过的猜测冒充计算"。
- **处置**：① 删除 `allowance_unrouted_points` 与 `allowance_cluster_discount`（配置与代码同步删，不留旋钮）；② 未路由点位改为只进 `coverage.unroutedPoints` 清单（id/房间/类型/所属回路），**不进任何采购量**；③ 新增门禁 C8（allowance 复活即 fail）与 C9（清单计数必须与 byType 一致）。
- **数字变化（可复算）**：强电管 470.2m → **178.3m**（全部为已画线路由的同回路 union）；导线 1,534m → **561m**；给水 84.5m → 58.6m；排水 29.0m → 18.2m；**未路由点位 77 个显形**。材料总额 ¥18,069 → **¥13,808**（对照 PKG-040 planned ¥15,000 转为 −¥1,192）。
- **这不是"设计变便宜了"**：77 个点位（客餐厅插座、双控开关、起夜灯、空调线控器…）现在**没有路径所以没有量**。总额下降的原因是账面不再包含臆测，**不是因为工程变少**。要把量补回来，只能补路由（量房或按模型坐标生成候选路由），不能再给经验值。
- **仍待办**：为未路由点位生成确定性候选路径（点坐标 → 所属回路已有路由最近点 → 正交路径，标 `route_kind: candidate`），使每个点位都有可审计折线；完成前采购量一律视为**不完整**而非完整。
- **关联文件**：`shared/mep-takeoff.ts`、`config/mep-takeoff.yaml`、`scripts/verify/mep/verify-mep-takeoff.ts`（C8/C9）、`tests/server/mep-takeoff.test.ts`。
- **决策人**：业主。

### DEC-2026-10-07-M04 声明式补客餐厅电源回路路由 + 纯竖直段纳入物理路由口径

- **日期**：2026-10-07。触发：业主要求"声明式一条条规划电路"，从点最多的 `ordinary_power_living` 开始。
- **路由声明（`config/mep-hvac-coordination.yaml` 92→102 条）**：为客客厅 10 个未路由点位各声明一条路由——电视墙四孔（下行+φ25 高位独立管+灯带电源）、西墙网关/扫地机、东墙窗帘盒带取水点/电动窗帘预留、三个地插（客厅×2+餐厅×1，由最近吊顶缘下行进垫层）。每条写清 from/via/to、标高、几何依据与待量房项；地插路由的 from 用吊顶缘内联坐标并在 reason 注明 junction 与垫层做法待设计裁定。
- **口径修正（`shared/mep-hvac-coordination-schema.ts` 与 `shared/mep-hvac-lint.ts` 同步）**：`isMepPhysicalRoute` 与 lint 的 `coincidentEndpoints` 原判据是"首末平面点重合即非物理路由"，导致**同墙不同安装高度的竖直段**（电视墙 0.30/1.70/2.00m）无法声明为真实管段。改为：纯竖直段只有在**显式声明 `route_kind: physical` 且确有高度差**时才算物理路由——判定权交回声明者，不由算法猜；零长度仍不算。两个引擎同口径，消除"算量算得出、lint 报非物理"的撕裂。
- **量化效果**：`ordinary_power_living` 管长 11.6m → **25.4m**、导线 36.4m → **79.9m**；强电管计价 178.3m → **192.1m**；未路由点位 77 → **67**。
- **连带登记**：ceiling_clearance_unverified 25 → **32**、`c.mep_layer_below_drop_bottom` 登记基数 24 → **31**。新增 7 条全部属于既有残留同类（"竖直下引至设备点位的末点"），随本次路由声明一起登记，非数据消音。
- **关联文件**：`config/mep-hvac-coordination.yaml`、`shared/mep-hvac-coordination-schema.ts`、`shared/mep-hvac-lint.ts`、`docs/mep-construction-guidance.md`（92→102、24→31）、`config/facts.yaml`、`docs/design-iterations/mep-lint-governance-20261006/review-manifest.json`、`tests/server/mep-takeoff.test.ts`。
- **决策人**：业主。

### DEC-2026-10-07-M05 并行声明式补路由：书房/客房/儿童房 + 四卧两卫 + 走廊入户（三条回路 23 条）

- **日期**：2026-10-07。触发：M04 之后，业主要求把 batch2/3/6 并行落地。
- **执行方式**：三个 subagent 并行起草（各写 `tmp/routes-batchN.yaml`，禁止改 config 防写冲突），主会话合并后统一过全门禁。批次互不重叠（不同房间、不同回路），无合并冲突。
- **路由声明（`config/mep-hvac-coordination.yaml` 102→133 条）**：
  - **batch2 `ordinary_power_parent_child` 8 条**：书房/客房/儿童房插座。借既有空调/照明同孔带穿 `w_be_west` 门头、`w_st_north`、`w_nw_south` 进各房，扇形扇出到北/西/东三墙；**一律不穿透剪力墙**（`w_mb_east`/`w_east_upper`/`w_be_north` 全部只贴板面明敷+竖直接线，reason 声明暗盒锚固 site_pending）。
  - **batch3 `lighting_bedrooms_bath` 16 条**：主卧三控拆成 3 条等标高连续管（中途开关选北床头，改序只动跳线不改管）；起夜灯与开关同位不同高用纯竖直段（1.30m 接开关、继续沉 0.95m 接 0.35m 起夜灯，共享一根管下引）。`switch_kitchen` 因房间属厨房**故意留白**归厨房批；客卫 NP-6/7/8 因并发 R12 删点而取消路由、草案留档。
  - **batch6 `lighting_entry_base` 7 条**：走廊/入户筒灯与起夜灯，全部从 `strong-light-entry-base`/`strong-light-corridor` 终点分支；NP-4a/NP-3 同墙带串链共享 2.25m 竖直下引；两个落地立柱候选各自下引（不在客厅地面做 3.40m 外露拉线，多花约 2.55m 管并显式登记，不暗省）。
- **效果**：点位闭环 **67/134 (50%) → 98/134 (73%)**；未路由 64 → **33**；强电管计价 192.1m → **253.4m**；导线 561m → **815m**；`ordinary_power_parent_child` 与 `lighting_entry_base` **回路清零**。
- **连带登记**：路由数 133、ceiling_clearance_unverified 32→56、`c.mep_layer_below_drop_bottom` 31→55、lint 90→125、must_fix 桶 17→23（shear_wall_parallel_route 8→14）；全部新增 ceiling hit 均为"路由下行至声明设备点位的竖直末段"，属 §0 已登记①类残留同源，非消音。
- **门禁**：verify:facts / verify:mep-takeoff / verify:schedule / verify:mep(0 error) / typecheck(0) 全绿；`test:server` 731/742，余 11 个失败均为并发会话 `config/hvac.yaml` 的 `outdoor_a2` anchor 与 VRF 外机 id 重复所致（hvac.yaml 自 11ef1ff 未变，属既有问题）。
- **剩余 33 个未路由点位**：厨房 5（依赖橱柜深化）、主卫/客卫/阳台 10（依赖台盆 SKU / 归属裁定）、给排水 6（依赖 #8 入户点、#44 净水器）、空调线控器 6（依赖归属）、客厅双控 2、其余专用回路 4。
- **决策人**：业主。


