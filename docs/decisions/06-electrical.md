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
- `DEC-2026-10-23-R01` 回路计价基数补计竖直段：平面 union 保留、竖直下引/立管计入（修正 DEC-2026-10-07-M02 计价口径）

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


> DEC-2026-08-26-043 已移入同目录分册 `06-electrical-archive.md`（文档精简批 5 分卷，原文未改写）。
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
  4. 水路补齐 `drain_mbath_toilet`(2.60,1.50)h=0.02（2026-10-26 坐标修正为 footprint/base 中心 (2.275,1.50)：原 (2.60,1.50) 是 2026-09-08 家具马桶西移 25mm 后的东缘/共墙 w_mbath_east 中心线、被误记为马桶中心，本条为当轮决策登记、原值保留并注修正）；主卫坐便器形式/坑距未定，壁挂则给水+电+排污全进假墙。
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



### DEC-2026-10-12-R1 删主卧两盏明装床头壁灯，改小米床头灯插电

- **日期**：2026-10-12。触发：业主在看一期灯具选型时决定「不想在主卧做嵌入式床头灯，删掉，简化这块的部署，一个小米床头灯就搞定了」。
- **被本条推翻的旧结论（铁律 3：逐条列明为何可推翻）**：
  1. **DEC-2026-09-08-R1 / 方案A 的「主卧南北床头各一盏壁灯」**——原为 `light_master_wall_l` (z=6.245) / `light_master_wall_r` (z=8.555)，挂 `w_mb_east`、h=1.35m、与南北床头柜轴线对齐、哑黑隐藏转轴可调短筒、自带底部按键、墙面突出 ≤190mm。**可推翻的理由**：该方案自带三项 site_pending（挂装 SKU、东墙结构与固定节点、南帘真实关系），本就是未冻结候选；业主以「简化部署」为由撤销，不涉及任何已施工或已采购承诺（项目尚未交房、硬装未施工）。
  2. **「阅读壁灯使用灯具自带按键」的控制口径**（`config/electrical.yaml` `switch_master_bed_l` note 原文）——随壁灯删除一并作废，床头阅读与起夜改由床头灯自身承担。
  3. **`control_master_bed_door` 的「床头壁灯不走多控」例外**——壁灯不存在后该例外自动消失，三控只针对 `light_master_dome` 一只灯具，控制关系比原先更简单。
  4. **`lighting_bedrooms_bath` 回路的负荷口径**——11 点位 / ≤0.9kW 降为 9 点位 / ≤0.75kW（移除两盏壁灯的估算负载）。
- **未被推翻、继续有效的**：主卧吸顶灯三控（门口/南床头/北床头）不变；床头双联框（开关+插座）不变；起夜路径标准对床头段「触摸/按键优先于感应」的要求不变，且现在由床头灯的机身按键天然满足。
- **数据改动**：`config/electrical.yaml` 删 2 个点位（**107 → 105**，`fact.electrical_points_count` 同步）；`config/electrical-topology.yaml` 同步 member_point_ids / capacity / 表头计数 / control note；`config/render/overrides.yaml` 删 2 条 anchorY override；`config/spatial-validation.yaml` 的 `lighting_host_overrides` 清空（config 内已无 `wall_lamp` 类型点位，框架保留供将来新增）；`config/house.yaml` #25 的影响范围收窄。
- **新增依赖（不是删完就完了）**：小米床头灯为**插电式**，取电位为既有 `sock_master_bed_l`（北，z≈6.202 h=0.7）与 `sock_master_bed_r_head`（南，z=8.512 h=0.7）——两插座均在 `ordinary_power_*` 回路且带漏保，**不新增电气工作量**，这是本次简化成立的前提。若最终只买一只，放哪侧、另一侧如何补，待灯具选型后由业主定。
- **现场反转条件**：① 若床头灯需智能控制且依赖米家 App/蓝牙 Mesh，则违反起夜标准「禁止把起夜照明作为智能场景的唯一承载」——**必须选带机身物理按键的型号**；② 若业主改回壁灯，须重新声明挂装 SKU、东墙固定节点与南帘关系三项 site_pending；③ 若床头灯功率或插头规格与现有床头插座不兼容，则需改插座类型（属电气返工）。
- **决策人**：业主。

### DEC-2026-10-12-R2 两卫照明改用浴霸三合一自带，删平板灯与对应墙控

- **日期**：2026-10-12。触发：选一期灯具时发现两卫既有平板灯与奥普 S2-Air 浴霸（风暖 2750W + 换气 49W + **照明 24W** 三合一）功能重叠，业主要求「用浴霸三合一就行，不另外加装」。
- **被本条推翻/删除的旧结论（铁律 3：逐条列明为何可推翻）**：
  1. **两卫各一盏独立平板灯 + 对应墙控开关**（`light_mbath_panel` / `light_gbath_panel` + `switch_mbath` / `switch_gbath`，`docs/dressing-map.md` 162/163 行有登记，4000K、2026-08-25/08-29 先后定位）。**可推翻的理由**：浴霸三合一已含 24W 照明，S2-Air 已于 DEC-2026-10-05-R3 定标自购（`COST-100-06`），两套光源在同一 3.15–4.58㎡ 空间内属重复投资；业主以「不搞复杂的东西」为由撤销，不涉及已施工或已采购承诺。
  2. **`DEC-2026-10-07-R12` 中「进客卫后用现有 `light_gbath_panel` 主灯和 `switch_gbath` 手动照明」这一兜底指定**——该灯既已删除，此兜底失效。**这是本条最重要的连带后果**：R12 当初删客卫 NP-6/7/8 三个起夜灯时，指定的替代方案就是这个平板灯；现在两层都没了。
  3. **`control_mbath_light` / `control_gbath_light` 两条控制绑定**与 `lighting_bedrooms_bath` 回路中的两卫成员。
- **起夜覆盖的后果（业主已明确接受）**：两卫段起夜兜底退化为 ① 浴霸自带照明（线控面板为物理按键，满足 `docs/standards/night-path-lighting.md` §6「保底层不依赖网络/网关/App」）；② 业主原话「后面需要就用插座直接外挂夜灯，不搞这种复杂的东西」。**外挂方案有现实取电位**：`sock_mbath_toilet`（主卫，h=0.3）与 `sock_gbath_toilet`（客卫，h=0.3）均为马桶位低插座，另有 `sock_gbath_vanity`（h=1.0，洗手台前）——正好覆盖标准要求的两个停留位。**代价**：可插拔夜灯多为 PIR 而非存在感应，人在马桶前静止不动仍可能超时熄灭（标准 §4.3 未满足）；且属入住后按需补，不纳入一期预埋。
- **数据改动**：`config/electrical.yaml` 删 4 个点位（**101 个**：−2 灯 −2 开关）；`config/electrical-topology.yaml` 删 2 条 control（**11→9**）、`lighting_bedrooms_bath` member 9→7、capacity ≤0.9kW→≤0.75kW→**≤0.6kW**、表头计数 105→101；`config/mep-hvac-coordination.yaml` 删 4 条卫浴照明路由（`strong-light-gbath` / `strong-light-mbath-panel` / `strong-light-mbath-switch` / `strong-light-gbath-switch`，**131 条**）；`config/render/overrides.yaml` 删 2 条 anchorY override；`docs/dressing-map.md` 两行改删除态；`docs/design-iterations/parent-room-study-swap-20261005/night-path-lighting-instance.md` 记录 R12 被部分推翻。
- **现场反转条件**：① 若 S2-Air 面板的照明**不能独立于风暖开启**，则起夜开灯会顺带开风暖——下单前须核面板说明，不成立则至少一卫需保留独立光源；② 若量房发现浴霸线控面板无法在入门后便捷取得（R12 原文已挂此待确认项），则起夜兜底失效，需重新评估；③ 若业主改回独立平板灯，须恢复 4 个点位 + 2 条 control + 4 条路由，并按 300×300 模块重新选 SKU。
- **决策人**：业主。

---

### DEC-2026-10-13 批次说明：客厅主灯改吸顶灯 / 主卫镜柜面光口径与电位核查 / 主卧吸顶灯移位 / 客厅中部定原顶

> ⚠️ **R2 含自我更正**：R2 初版误判"主卫镜位零电位"并新增了一个点位，随后发现 config 早有同名点位，已撤销。最终 config 电气点位**无增无删（维持 101）**。更正全过程见 R2 的「自我更正」段——按铁律 6 保留误判与更正两份记录，不静默改掉。

> 触发链：业主先问「客厅轨道灯落地复杂度、效果不好是否好拆」（结论：容易装也容易拆，可接受）→ 再问「晚上采光够吗」「光轨道灯就够亮了」→ 收到一份外部建议「极简主灯 + 必要的功能补光」→ 追问「所以没必要搞那么复杂，直接一个吸顶灯就完事」→ 批准。随后评估卧室照度时发现 DEC-2026-10-12-R1 删壁灯的后遗症，一并处理。
>
> **本轮四条的共同前提**：项目尚未交房，硬装/水电/吊顶/空调均未施工（AGENTS.md「当前施工状态」）。以下所有"拆除/改型"成本论证均不成立，只按光学与电气原理判。

### DEC-2026-10-13-R1 客厅基础光由明装轨道灯改为贴原顶吸顶灯

- **日期**：2026-10-13。
- **被本条推翻的旧结论（铁律 3）**：
  1. **`DEC-2026-08-26-043`「客厅采用 `living_track_main`，一条黑色明装轨道、5 个可调灯头，作为客厅基础光回路」**。**可推翻的理由**（三条，逐条可复算）：
     - **配光原理不满足标准**：4 个可调灯头是点状光源，目标全部聚集在 x[9.75,12.05]×z[7.40,8.40] 约 5㎡ 的范围内（`config/render/lighting.yaml` heads 的 target），其余客厅面积无直射光。GB/T 50034 对客厅一般活动要求 **100 lx 且均匀度 U₀=Emin/Eavg ≥ 0.7**，点状聚集配光的结构性结果是 U₀≈0——**这是原理性不满足，不是"调一调角度"能解决的**。原 DEC 只校核了总光通量（10,000 lm vs 需求 7,125–8,525 lm，够），没有校核均匀度。
     - **原顶条件下走线无法暗藏**：灯位 (10.80,7.15) 距 `ceiling_living` 边吊南缘 1.95m。原 `strong-light-living` 路由的 reason 写「出边吊后**平吊板上方**敷设」，其前提"客厅中部存在平吊板"在 `ceiling_living` 的 note 里是「原顶/石膏板平吊」二选一的悬空表述，同期 `weak-ap` 路由却写「保持原顶」——控制源自相矛盾。R4 定案原顶后，这 1.95m 只能明装线槽外露。
     - **三重可调冗余，业主从未要求重点照明**：轨道 + 加固板 + 4 个可调灯头，全是为"重点照明"服务的复杂度；业主历次表述（"简化这块的部署""不搞这种复杂的东西"）方向一致，且本案的茶几/沙发重点照明已由 `light_tv_strip` 与餐桌吊灯分担。
  2. **`docs/dressing-map.md` §3 的「明装轨道灯」行**与 §12 欧普灵显轨道灯竞品研究（R6 处置）。
  3. **`control_living_entrance_corridor` 的受控对象**（`living_track_main` → `light_living_dome`，id 随类型一并更换；三控/双控绑定关系本身不变）。
- **数据改动**：`config/electrical.yaml` `living_track_main` → **`light_living_dome`**（`type: track_light` → `dome`，删 `heads: 4`，位置 (10.80,7.15)/h=2.8/3000K/回路 `living_base` 全部不变——**出线点位原地复用**，不新增路由起点）；`config/electrical-topology.yaml` `member_point_ids` 与 `target_point_ids` 同步换 id；`config/mep-hvac-coordination.yaml` `strong-light-living` 的 `to` 换 id、标高 y 2.7→2.78（贴原顶板底）、reason 重写；`config/render/lighting.yaml` detailed fixtures **清空为 `[]`**（dome 无 detailed 配置，渲染走 projection 的 `case 'dome'`）；`config/render/overrides.yaml` 条目换 id 且 `anchorY_offset` 0 → **−0.25**（明装导轨贴完成面 → 吸顶灯罩下缘低于完成面 25cm，与 `light_master_dome` 同口径）。
- **选型口径（未冻结，待 `shopping-research`）**：光通量 **7,100–8,500 lm**（客餐厅 44.58㎡、客厅一般活动 100 lx、UF×MF 取 0.48 的复算区间；**不取 6,250 lm**——那是按 75 lx 卧室标准算的，用错标准会暗一档）、**Ra ≥ 90**、**3000K**、宽漫射面光源（不用点阵/环状偏配）、贴顶安装。智能/调光不作为硬指标（该灯由既有双控墙控，加智能会多一条控制路径）。
- **未解决、显式登记（铁律 1："我们选了 X"必须同时生成"X 不工作时"的问题）**：
  - **X 不工作时**：吸顶灯一体化驱动，坏了通常要整灯拆下（贴顶无检修口）。**要不要拆吊顶？** 原顶条件下答案是不用——站桌上即可更换，这是原顶相对平吊的一个真实优势。谁清理/多久一次：灯罩积灰，业主自行，年均一次。
  - **1.95m 明装线槽的视觉代价**：原顶条件下这 1.95m 无法暗藏，线槽是该项的固有代价而非可优化项。**是否接受线槽外露，或改为局部 10cm 宽假梁**——这是一个尚未问过业主的视觉取舍，见 pending-site-data #62。
  - **板面明敷段是否遇梁**：量房复核 (10.80, z[5.20,7.15]) 区间梁位与梁底标高，见 #62。
- **决策人**：业主。

### DEC-2026-10-13-R2 主卫镜柜面光选型口径 + 镜位电位核查（含自我更正：并非"零电位"）

- **日期**：2026-10-13。触发：DEC-2026-10-12-R2 把两卫平板灯删给浴霸三合一后，业主要求"从镜子上做打光"（镜柜面光），并追问面光会不会很吃洗手台尺寸。
- **问题**：客卫有 `sock_gbath_vanity` / `sock_gbath_vanity_2`（均 h=1.0）+ `sock_gbath_towel`（h=1.2）；主卫有 `sock_mbath_toilet`（h=0.3）、`sock_mbath_batheheater`（h=2.5），以及**一条初看会被漏掉的台下双联** `sock_mbath_vanity`（见下自我更正）。
- **被本条推翻的旧结论**：本条**没有推翻任何既有工程结论**；它推翻的是本会话中途产生的一个错误判断（"主卫镜位零电位"），详见自我更正段。R2 删平板灯时假定"浴霸照明 + 镜柜自带"可覆盖，**R2 未论证镜柜的取电位从哪来**——这个论证缺口由本条补上，补完的结论是"电位本来就有"。
- **⚠️ 自我更正（铁律 6：本次改动丢了什么/推翻了什么）**：本条最初写成"主卫镜位**零电位**"并据此新增 `sock_mbath_vanity`（点位 101→102）。**这个前提是错的**——`config/electrical.yaml` 第 552 行早已存在同名点位：`sock_mbath_vanity`，`room: master_bedroom`、`wall: w_mbath_south`、`wall_side: south`、**(0.78, 2.96)**、**h=0.95**、**count 2**、`status: inferred`、`position_status: pending`，note 原文「洗漱+梳妆一体台**镜下双联插座**（2026-08-30 回归梳妆位，服务吹风机/护理电器，避开台盆中心与门洞；带防溅盒，待量房确认）」。误判来源：此前按 `room: master_bath` 过滤主卫插座，而该点位的 room 是 `master_bedroom`（台盆 2026-08-25 外移到套间条带后归主卧），被房间过滤漏掉。**该新增已撤销，点位维持 101。**
- **更正后的真实缺口（比原判窄得多）**：
  1. **主卫镜位电位不是"没有"，而是"有一个双联但未激活"**——`sock_mbath_vanity` 是 count 2 的台下双联，`status: inferred` + `position_status: pending`，量房确认后才进回路。它服务的对象由 plumbing 锚点确认：`faucet_mbath_vanity` 盆心 **x=0.575**、`drain_mbath_vanity` 墙排中心，正对 `mb_washbasin_cabinet`（世界 x[0.05,1.10]、z≈3.16），也与主卧房间 note「洗漱+梳妆一体台**贴新隔墙南脸**」一致。
  2. **东侧 `mb_vanity_base_cabinet`（1.38m、`w_mbath_east` 西脸、轴心 z=3.61）没有任何电位**。该柜是否也是台盆/梳妆用途、是否需要独立电位，是未决问题，见 pending-site-data #61——**不预先加点位**（位置未定，加点位就是编坐标）。
  3. **DEC-2026-10-12-R2 删两卫平板灯的镜柜供电前提，其实已经具备**——原判说"这是 R2 遗留的真缺口"，不成立。
- **仍然有效的结论（不因更正而改变）**：镜柜要带面光就必需电位；主卫已有台下双联可覆盖镜柜灯/电动牙刷/吹风机；客卫有 `sock_gbath_vanity` + `sock_gbath_vanity_2`（均 h=1.0）。**没有新增电气工作量。**
- **数据改动（更正后）**：`config/electrical.yaml` **无增无删**（101 个点位不变，`fact.electrical_points_count` 与 `config/electrical-topology.yaml` 表头同步回 101）。
- **镜柜选型四形态口径（取代原先"面光/背光"两分法）**：

  | 形态 | 光学结论 | 本项目口径 |
  |---|---|---|
  | 顶部前向（面板上方向前+向下） | 有效，但眼窝/鼻下仍留阴影 | **底线**。客卫镜柜仅 0.70m 宽，只做得到这个 |
  | 镜面两侧 | 最能消眉骨/鼻/下巴阴影，需发光面宽 | **加分项，主卫优先**。主卫柜宽 1.38m，灯带可拉至 ±0.5m 以上、方位角 ~55°；客卫 0.70m 只有 ±0.6m 间距、方位角 ±40°，须选宽漫射条而非窄竖条 |
  | 背光/轮廓光 | 只照亮墙与柜，照不亮脸 | **明确排除** |
  | 柜底台面灯带 | 只照亮台面 | **明确排除** |

  硬指标：**面光 + Ra ≥ 80（化妆取 90 更好）+ 3000–4000K + 宽漫射发光面 + 灯条/驱动可更换**（坏了好修，不用换柜子）。
- **明确不采纳的建议**："普通镜柜 + 独立可更换壁挂灯"作为默认路线。独立镜前灯 = 墙上打孔 + 单独电位 + 单独控制 + 一个会松会掉要维护的东西，与业主一贯的「减少固定装修与电气耦合」冲突。独立壁挂灯只在镜柜选不到合格面光时作 fallback。
- **现场反转条件**：① 若量房确认 `sock_mbath_vanity`（0.78,2.96）与 `faucet_mbath_vanity` 盆心 x=0.575 / `drain_mbath_vanity` 墙排中心不共墙或撞位，则该双联须移位并重新声明 `wall_side`（`w_mbath_south` 已登记南脸，注意该墙 2026-08-25 北移至 z=2.86）；② 若镜柜不带电（纯机械镜柜），则该双联仍须保留（吹风机/电动牙刷），但面光需另走独立镜前灯，届时按 fallback 重开——**独立镜前灯意味着新打孔 + 新控制，与「减少电气耦合」冲突，须业主明示接受**；③ 若量房发现东侧 `mb_vanity_base_cabinet`（1.38m）确实是台盆/梳妆主位而西侧柜降级，则该柜无电位成为新缺口，须补点并声明 `wall: w_mbath_east` / `wall_side: west`——**该墙已登记 `structure: shear, structure_status: inferred`，凿槽埋盒须按 `docs/mep-construction-guidance.md` 逐墙声明，不得默认可凿**；④ 若业主改回独立平板灯，须恢复 4 个点位 + 2 条 control + 4 条路由（DEC-2026-10-12-R2 原文条件继续有效）。
- **决策人**：业主。

### DEC-2026-10-13-R3 主卧吸顶灯移位 (2.60,7.60) → (1.70,6.00)

- **日期**：2026-10-13。触发：业主要求"不考虑加灯，评估卧室灯够用吗"。
- **评估结论（四间卧室，均按 GB/T 50034：卧室一般活动 75 lx、阅读/书写 300 lx）**：

  | 房间 | 面积 | 灯位 vs 房间几何中心 | 一般照明 | 任务照明 |
  |---|---|---|---|---|
  | 儿童房 bedroom_nw | 9.60㎡ | (4.10,2.70) = **正中心** | 够（需求 ~1,500 lm） | 要台灯 |
  | 父母房 study | 12.75㎡ | (5.70,7.675) = **正中心** | 够（需求 ~1,992 lm） | 要台灯 |
  | 客房 bedroom_se | 9.45㎡ | (14.90,7.125) = **正中心** | 够（需求 ~1,477 lm） | 无需求 |
  | **主卧 master_bedroom** | **26.84㎡** | (2.60,7.60)，质心 (1.99,6.57) → **偏 1.4m 朝床头** | **边缘不足** | 两头都不够 |

- **主卧的三个具体缺陷（可复算）**：
  1. **原址正压床体**：`bed_180` AABB x[2.30,4.10]×z[6.47,8.33]，原灯位 x=2.60/z=7.60 落在床平面投影内——既对仰卧视线构成眩光，又把房间甩偏。
  2. **条带洗漱区被甩到 3.91m / 入射角 57°**：按 cos³θ 衰减，该处照度约为灯正下方的 **1/6**。主卫台盆已外移到条带（z>2.86 归主卧），**且主卫镜位上方按 R4 定案是原顶、无顶光**（`ceiling_master_bath` 只到 z=2.86，`ceiling_master_ac` 只覆盖 z≥4.55）——所以镜柜面光在主卫不是可选项，是必需项。
  3. **26.84㎡ 是儿童房的 2.8 倍**，房间 4.20×6.94m，一盏灯要覆盖 6.94m 进深；按 lumen 法全屋 75 lx 需装 **4,194 lm**，偏芯 + 长条形实际要 5,000+ 且均匀度仍无解。
- **被本条推翻的旧结论（铁律 3）**：**DEC-2026-10-12-R1 的隐含前提**——R1 以"简化部署、一个小米床头灯就搞定"删掉两盏床头壁灯，把主卧从 3 个光源降到 1 个，**当时没有核算照度后果**。R1 本身（删壁灯）不被推翻，被推翻的是"删完之后主卧照明仍然够"这个未明说却实际成立的假设。**为何可推翻**：R1 的论证只覆盖了床头这一个点位（"小米床头灯插电位于 `sock_master_bed_l`/`_r_head`，不新增电气工作量"），从未论证过房间级一般照明；而删灯后房间级光源恰好只剩一盏偏芯的吸顶灯。
- **移位理由**：(1.70,6.00) 位于房间开敞中部，避 `bed_180`、`master_north_wall_wardrobe_950`（AABB x[1.975,2.925]×z[4.30,4.88]）、`master_dressing_table`（x[0.20,0.65]×z[5.60,6.50]）、`master_hot_season_low_dresser` 与 `curtain_box_master_west`（x[1.10,1.35]）。到条带台盆 **3.05m**（原 4.88m 按 washbasin 计 / 3.91m 按 vanity_base_cabinet 计）、到通顶衣柜 **1.60m**、到梳妆桌 **1.28m**。
- **分工论证（为什么牺牲床面环境光是可接受的）**：床头阅读 = 小米床头灯（R1 已定）；条带洗漱 = 镜柜面光（R2 已定）；起夜 = 业主既定的"插座外挂夜灯"路线。**三个功能缺口各有专属光源，吸顶灯只管一般照明——居中才是正确分工**，原址把吸顶灯当床头灯用才是错配。
- **数据改动**：`config/electrical.yaml` `light_master_dome` x 2.6→1.70、z 7.6→6.00；`config/electrical-topology.yaml` `control_master_bed_door` note 补记。**三控绑定、回路成员、开关点位全部不变。**
- **不加灯的总判定**：**可行**。四个功能缺口全部能靠既有插座 + 可插拔设备补上，不需要新增任何顶灯点位；唯一值得动的就是把主卧这盏 dome 挪回中部。
- **显式登记的遗留缺口（owner=业主，触发条件=一期灯具与插座定位冻结前；已并入 pending-site-data #59，本条不再单独挂账）**：**主卧没有起夜路径点位**——NP-1~NP-5 只覆盖客房、客厅、走廊，主卧床边与主卫镜位均无。DEC-2026-10-13-R3 把主卧吸顶灯移到房间中部后，半夜起来洗脸连借光都没有（原灯位至少在床附近）。按业主既定路线用插座外挂夜灯补，可借用 sock_master_bed_l / _r / _r_head 与 sock_mbath_vanity，但**是否满足 `docs/standards/night-path-lighting.md` §4.3 停留位存在感应要求未论证**（可插拔夜灯多为 PIR，人在镜前/马桶前静止会超时熄灭）。不新增预埋点位（业主已明确不搞复杂东西），但主卧段必须在水电交底时明确「不预埋、入住后外挂」这个决定本身。
- **决策人**：业主。

### DEC-2026-10-13-R4 客厅中部吊顶定案为原顶 2.80m，不做石膏板平吊

- **日期**：2026-10-13。触发：R1 要改走线，必须先终结 `ceiling_living` note 里「客厅中部保持**原顶/石膏板平吊** 2.80m」这个二选一的悬空表述。
- **控制源自相矛盾的实况（改写前 diff，铁律 5）**：`config/ceiling.yaml` `ceiling_living` note 写「原顶/石膏板平吊」（二选一，未裁）；`config/mep-hvac-coordination.yaml` `strong-light-living` reason 写「出边吊后**平吊板上方**敷设」（以存在平吊板为前提）；`weak-ap` 路由写「**保持原顶**」。**三个说法互相打架，且没有任何一个带 DEC 编号。**
- **定案与理由**：**原顶 2.80m**。① 业主一贯方向是减少固定装修（石膏板平吊是全屋最大单项增项，且把层高压到 2.70）；② 平吊的唯一技术收益是"能暗藏走线"，而 R1 改吸顶灯后走线只有 1.95m 一段，用明装线槽的成本远低于整片平吊；③ 原顶使吸顶灯可站桌更换、无需检修口（R1 已登记为该方案的真实优势）；④ `weak-ap` 已按原顶声明，定原顶使两条路由口径统一。
- **被本条推翻的旧结论**：`strong-light-living` reason 中「平吊板上方敷设」的**前提**（不是结论——结论"从边吊引到灯位"不变，变的是敷设方式与标高）。定案前该 reason 描述的是一个 config 里从未声明过的构件。
- **数据改动**：`config/ceiling.yaml` `ceiling_living` note 的「原顶/石膏板平吊」改为「原顶 2.80m」+ R4 定案号与三条理由；`config/mep-hvac-coordination.yaml` `strong-light-living` 标高 y 2.7→**2.78**（贴原顶板底）、reason 重写明敷。
- **代价（不美化）**：客厅中部 1.95m 明装线槽外露，是原顶方案的固有代价。**是否接受、或改局部 10cm 假梁**，是一个尚未问过业主的视觉取舍，登记为 pending-site-data #62。
- **决策人**：业主。

### DEC-2026-10-13-R5 电视墙灯带不搞，删点位与整条照明回路（取电插座保留供后期加装）

- **日期**：2026-10-13。触发：灯具系统收口时业主裁定「电视墙带不搞了，那句话，反正有插座，能后期加装」。
- **被本条推翻的旧结论（铁律 3）**：
  1. **`DEC-2026-08-02-013` 的电视墙灯带**（`light_tv_strip`，`living_dining`、(7.20,7.70)、h=2.0、3000K、led_strip、沿西墙 z5.8–8.2 出光朝下、电源取 `sock_living_tv_led`）。**可推翻的理由**：它是氛围光而非功能光——`config/render/lighting.yaml` 从未给它 detailed 配置，`config/electrical.yaml` 的 note 自认「控制方式为灯带驱动遥控/APP，无墙控点位」。业主从未要求过电视背景墙氛围光，且删它不影响任何一处的照度指标（§12 选型口径表里它那一行本来就是「氛围光，无照度指标」）。
  2. **整条 `lighting_tv_ambient` 照明回路**（`member_point_ids: [light_tv_strip]`——该灯带是它唯一成员，删灯带即删回路）。**回路数 21 → 20**。
  3. **`pending_parameters` 里「电视墙灯带控制方式为驱动遥控/APP，如需墙控另开迭代」这条待决项**——灯带已不装，控制方式不再有待决项，改为作废说明。
- **为什么可以删而不用留 pending**：`position_status: pending` 的语义是「预留接口、位置待量房后激活」，而本条是**业主主动决定不做**，不是量不到。留着会让 takeoff 把一个不存在的灯具算进工程量、让 render 渲染一个不存在的构件、让 element census 多一个假构件。按 DEC-2026-10-12-R1/R2 的同一先例删除。
- **后期加装的路径（业主原话「反正有插座」的兑现方式）**：`sock_living_tv_led` **保留不动**——它是 `ordinary_power_living` 回路的台面/设备插座，本来就不是灯带专用。后期要加走插电式灯带挂该插座即可，**零预埋、零开槽、不改回路**。这与业主「减少固定装修与电气耦合」的一贯方向一致，也是本条敢于整个删掉的底气。
- **箱体结论不变（复算）**：删回路前 21 路 vs 390mm 单排箱「约 20 位、扣 2P 进线开关 + 浪涌后约 16 位可用」→ 装不下，必须双排。删后 **20 路 vs 同一 16 位可用仍装不下**，双排结论不变；`mount_height 1.65m` 仅双排合规的结论同样不变。断路器成本行由 21 路改为 20 路（照明 1P C16 由 5 路降为 4 路）。
- **数据改动**：`config/electrical.yaml` 删 1 个点位（**101 → 100**），`led_strip` 成为 config 内第三个被清空的 type；`config/electrical-topology.yaml` 删 `lighting_tv_ambient` 回路（**21 → 20**）、表头点位计数 101→100、两处箱体结论同步；`config/mep-hvac-coordination.yaml` 删 `strong-light-tv` 路由（**131 → 130**）；`config/render/overrides.yaml` 删 1 条 override；`config/model-package-links.yaml` 三处 selector 移除 `led_strip`；`docs/mep-construction-guidance.md` §0 规模表与 §7.4.3-1 行同步；`schedule/procurement.md` §12 选型口径表删灯带行、§02 断路器成本行改 20 路；`data/project-render-facts.json` 与 `docs/dressing-map.md` 重新生成。
- **同一失效模式第三次复发（重要）**：删点位类型不同步 `config/model-package-links.yaml` 的 `select.types` → `assertSelector` 抛错 → `/api/project` 500。先后踩过 `wall_lamp`（2026-10-12-R1）、`track_light`（2026-10-13-R1）、本次 `led_strip`。**前两次都只靠 test:server 报 500 才发现，说明「删类型后 grep 本文件」这个人工步骤不可靠**——已新增 `tests/server/model-package-links.test.ts` 断言：selector 里出现的每个 type 必须真实存在于 `config/electrical.yaml`，从机制上堵住，不再依赖人记得 grep。
- **现场反转条件**：① 若业主改回要电视墙氛围光，走插电式灯带挂 `sock_living_tv_led`，**不需要恢复任何预埋**；② 若改回要暗装灯带，则须重新声明点位 + 回路 + 路由，并按 led_strip 类型同步 model-package-links；③ 若量房发现 `sock_living_tv_led` 实际不可用（被柜体/家电占位），则后期加装路径失效，须重开。
- **决策人**：业主。

### DEC-2026-10-13-R6 客厅中部 1.95m 走线接受明装线槽外露，不做局部假梁

- **日期**：2026-10-13。触发：R1/R4 定案原顶后，业主过目「1.95m 明装线槽」的几何与代价说明，裁定「那没有问题」。
- **被本条推翻的旧结论**：无。本条是 R4 遗留的一个开放分支的收口——R4 定原顶时明确登记了「是否接受线槽外露、或改局部 10cm 宽假梁」是尚未问过业主的视觉取舍（pending-site-data #62），本条回答它。
- **定案与理由**：**接受外露，不做假梁**。① 假梁要重新声明一段 ceiling zone 并重算吊顶 takeoff，且假梁本身成为一个新的可见构件——**用一个可见物换另一个可见物，不解决问题**；② 线槽沿一条直线走、不拐弯，断面 ≤20×10mm、与顶面同色，视觉干扰小于一条 10cm 宽 1.95m 长的假梁；③ 假梁会把客厅净高再压一次（虽然只在灯位附近）。
- **铁律 1：接受外露必须同时回答「X 不工作时」的问题**：
  - **顶面不平**：原顶板底若平整度差，线槽会跟着变形或出现缝隙。→ 量房必拍 (10.80, z[5.20,7.15]) 区间板底，见 #62。
  - **遇梁**：原顶意味着无法预告板内梁位；1.95m 中段遇梁时线槽须绕行或加弯头，视觉长度增加。→ 量房必给梁位与梁底标高，见 #62。
  - **谁清理 / 多久一次**：线槽为平面，积灰量可忽略；业主自行，年均一次，站桌即可。
  - **要拆吊顶吗**：不要。原顶条件下站桌可更换灯具，这是相对平吊的真实优势。
- **现场反转条件**：① 若量房发现该区间**梁底低于 2.78m**，板面明敷段须绕梁或改标高，明敷长度增加——超过约 2.6m 时重新评估是否改假梁；② 若**板底平整度超差**（肉眼可见波浪），线槽方案不成立，转假梁；③ 若业主改回全屋石膏板平吊，则 R4 与本条同时作废，走线改暗敷。
- **数据改动**：`docs/pending-site-data.md` #62 由「卡业主视觉取舍 + 量房」收窄为「视觉取舍已定（外露），只剩量房提供梁位/板底平整度与线槽选型」；`schedule/procurement.md` §12 现场反转条件第①条同步标注已裁定。
- **决策人**：业主。


> DEC-2026-10-16-R1 已移入同目录分册 `06-electrical-archive.md`（文档精简批 5 分卷，原文未改写）。
### DEC-2026-10-16-R2 客厅主灯由浅吸顶改为悬垂雕塑形

- **日期**：2026-10-16。触发：业主看过R1同机位结果后指出“怎么还是吸顶灯呢？”，并确认改为有明显下垂体量的雕塑灯。
- **设计方向（业主确认）**：平面尺度约1m、继续固定在客厅起居区现有锚点；总下垂允许250–350mm；乳白宽漫射面保留；暖铜弧改为有前后纵深的立体外挑结构，不由餐桌位置决定。
- **本轮模型提案值**：按区间中点先预演总下垂300mm；采用约Ø900×70mm乳白盘、三根细吊杆、单条约20mm管径的偏心暖铜3D拱弧。弧线从漫射盘边缘升高并向南(+z)外挑约0.38m；按共享几何实算平面轮廓约0.90×0.94m，落在约1m声明包络内。中途审美复核建议再增强远景轮廓，故在初版0.34m基础上增加40mm前探；功能复核显示R2初版实际水平轮廓略小，故盘径/弧跨从0.88/0.84m微调到0.90/0.88m，仍位于批准包络内。吊杆、弧线、盘径与颜色仍是概念模型参数，具体SKU和安装构造未定。
- **被本条推翻/替代的R1结论（逐条说明）**：
  1. `DEC-2026-10-16-R1` 确认的 **1000×1000×120mm浅吸顶外形**及“低矮贴顶、不做大幅下垂”的当前造型口径。可推翻理由：R1实景预演仍呈现为贴顶圆盘，业主明确指出它仍像普通吸顶灯，未实现要求的客厅视觉重心；业主现在同意改到250–350mm下垂区间。
  2. R1的Ø920mm盘、60mm下沉、35mm弧垂等内部参数，仅作为历史模型参数保留；由本条新的悬垂几何取代，不删旧版截图或审查结论。
- **明确保留**：`light_living_dome` ID/锚点 `(10.80,7.15,h=2.80)`、3000K、`living_base`回路、双控、`strong-light-living` MEP终点、客厅边吊与HVAC配置、餐桌与餐桌吊灯配置均不变。PointLight与安装锚点留在y=2.80；300mm只表达灯具外观和漫射盘下沉，避免把展示用灯光位置误写为电气或光度事实。
- **光学边界**：乳白盘继续承担宽面漫射主光；3000K、Ra≥90、客厅一般活动约100lx/U₀≥0.7、餐桌约150lx沿用。不得按弧线造型或渲染强度宣称照度达标。现有7,100–8,500lm与公式约9,287.5lm冲突仍需在SKU决策前统一。
- **现场反转条件**：① 若固定沙发视角下弧线遮挡电视上缘或造成压迫，先缩小弧高/外挑量，不移动灯位；② 若送风射流直冲灯体造成摆动、风噪或积灰，核风口方向/射程后调整弧体迎风面积；③ 若现场梁位、顶板承重、安装底盘或最低点净高无法满足，暂停SKU冻结并复核下垂值；④ 若候选的3000K实际光通量/配光不能满足宽面均匀主光，重新选灯体，不以餐桌吊灯或灯槽暗中补足。
- **“X不工作时”与维护**：吊杆连接、弧架紧固件、漫射盘、LED板和驱动器的拆换路径、清洁方式及保修责任都待供应商说明书/安装图确认。责任人：业主+灯具供应商+电工；触发：SKU冻结与安装图确认前。重量、承重点和梁位由量房与施工方复核；不以当前3D rods构造冒充实物结构。
- **本次文档差异**：`style-guide.md §十一`与`procurement.md §12`的现行描述从R1浅吸顶改为R2悬垂雕塑方向；R1原尺寸和审查结论留在本DEC及`docs/design-iterations/living-sculptural-main-light-20261016/`作为历史基线。没有删除采购候选、价格口径、光度冲突、轨道灯淘汰证据或旧截图。
- **决策人**：业主（方向与下垂范围）；模型内部比例由设计迭代提交同机位预演确认。

### DEC-2026-10-16-R3 客厅主灯改为侧架垂吊灯体，修正R2仍像吸顶灯

- **日期**：2026-10-16。触发：业主在R2最新仰视截图再次指出“看起来还是像吸顶灯”，并要求继续构建灯具模型。按室内设计迭代协议进入重复审美失败复盘；保留R2原截图、runtime、审查和决策，不覆盖。
- **复盘结论**：R2虽有300mm总下垂，但实际灯体仍是Ø900×70mm薄平盘；三根细吊杆接在盘顶，仰视时被乳白盘体遮挡；暖铜弧位于盘上方，读成盘上的提手/装饰。这是灯体轮廓与连接关系问题，不是灯位或餐桌关系问题。
- **R3模型预演**：在业主此前批准的约1m平面尺度和250–350mm最大下垂范围内，取总下垂350mm；灯体改为上口Ø900mm、下口Ø720mm、深200mm的乳白钟形宽面漫射体，最低点y=2.45m；三根暖铜吊杆从顶盘落到灯体侧壳（下缘以上60mm），单条暖铜弧从侧下缘连接并沿南(+z)方向绕到灯体外侧。弧段在仰视轮廓中超出灯体并可见。声明外包络仍为1.0×1.0×0.35m，按配置实算平面可见轮廓约0.90×0.925m。所有尺寸都是造型模型参数，不是已选SKU或施工尺寸。
- **被本条推翻/替代的R2结论（逐条说明）**：① R2的0.90×0.07m薄盘体与“弧在盘面上方、吊杆接盘顶”的当前在役造型；可推翻理由是业主最新同机位图仍识别成吸顶灯。② R2以300mm下垂中点作为当前方案；不超出业主已批准的250–350mm范围，但改取上限并加深灯体，以让垂向体量在视图中可辨。R2历史参数和图像保留，不作为当前模型形态。
- **明确保留**：客厅主灯点`light_living_dome` (10.80,7.15,h=2.80)、`living_base`回路、双控、`strong-light-living`终点、客厅吊顶/HVAC、餐桌和餐吊均不变；灯不由餐桌定位。宽面漫射、3000K、Ra≥90、客厅约100lx/U0≥0.7、餐桌约150lx照明目标保留，光通量口径冲突继续待SKU决策前核算。
- **现场/性能反转条件**：① 固定沙发视角若出现电视遮挡或压迫感，先重开灯体体量/弧架外挑，不移动电气点位；② 梁位、顶板承重、送风射流或最低净高若不支持350mm下垂，按实测复核，不能偷偷超过350mm；③ 真实候选在3000K/Ra≥90下的流明和配光若无法满足均匀度目标，重新选灯体，渲染亮度不能代替光度计算。
- **“X不工作时”与维护**：吊杆侧壳连接、铜弧脚、漫射灯体、LED板和驱动器的拆换、清洁与保修方式未有厂家图纸；负责人=业主+灯具供应商+电工；触发=SKU冻结/安装图确认前。当前3D侧壳连接仅表达可见结构，不证明承重。
- **实质内容/删除审计**：R3把R2在役薄盘外观替换为收口钟形灯体、外露侧架和侧壳吊杆的垂吊关系；R1/R2历史决定、图像、候选、价格口径、流明冲突和轨道灯淘汰证据都保留。没有删除电气、家具、HVAC或采购数据。
- **静默失效条件**：① 若真实灯具仍是薄盘并把弧架做在盘上方，仰视会再次像吸顶灯；② 若吊杆/侧架没有厂家对应连接结构，模型看似垂吊但实物安装关系不成立；③ 若灯体侧深、弧脚或外挑超过声明包络，当前净距/碰撞判断失效；④ 真实光度、风口扰动、承重和检修不会由当前渲染自动证明。
- **决策人**：业主授权继续模型迭代；R3具体比例为设计预演提案，须以新同机位图复核。


> DEC-2026-10-16-R4 已移入同目录分册 `06-electrical-archive.md`（文档精简批 5 分卷，原文未改写）。
### DEC-2026-10-16-R5 客厅主灯改10头球泡半吸顶造型

- **日期**：2026-10-16。触发：业主提供参考图（商品页：10头 / 1000\*450mm / G9\*10 / 适用18-25㎡），要求“客厅的主灯建模帮我调整成这样”，并在三项对齐问题中确认：按图建模、光度缺口登记待SKU核验；配色按图（黑灯盘+镀铬臂+乳白球泡）；包络按商品规格（直径1000mm+总下垂450mm）。
- **R5预演提案**：锚点仍为`light_living_dome` (10.80,7.15) 贴原顶2.80m；镀铬吸顶盘Ø120mm贴顶，短吊杆+黑色球形关节，黑色两叠圆盘灯体（上盘Ø240×25mm、下盘Ø170×40mm、间距15mm、底部小 finial）；10根镀铬弯臂分双层、相邻臂角相差36°——上层5根起于上盘檐向外上挑（球泡中心半径0.38m、球心高于臂根约0.02m），下层5根起于下盘檐向外下垂（球泡中心半径0.42m、球心低于臂根约0.18m）；臂端镀铬灯头座+乳白球泡Ø140mm，共10头G9。外包络Ø1.0m、总下垂0.45m，最低球泡底约y=2.35m。浏览器与GLB/export共用`shared/render/MultiGlobeChandelierGeometry.ts`声明式几何；`config/render/lighting.yaml` 换为 `multi_globe_semi_flush_chandelier` 配置。所有尺寸均为审图模型参数，不是SKU、承重或施工尺寸。
- **R5b几何修正（2026-10-16独立复核后）**：首版预演经独立审美/功能双复核，功能指标全部通过，但审美复核指出「上层5根上挑」读不出——首版上层球心仅高于上盘中心22.5mm，立面呈「平环+下垂环」；功能复核另指出记录未同步。修正内容：吊杆60→**120mm**，灯盘随之下移；黑色两叠圆盘灯体上盘Ø240×25mm/下盘Ø170×40mm 改为**上盘Ø270×30mm/下盘Ø190×45mm**（总厚80→90mm，提高中距离可读性）；下层球泡中心半径0.42→**0.43m**，使下层环标称外径=1.00m（球心0.43+球泡半径0.07）；臂弓0.05→0.07m。修正后上层球心y=2.67m、高于上盘中心约75mm，立面读成双环冠。**外包络Ø1.0m×总下垂450mm、最低球泡底2.35m、锚点与全部接口不变**；实测AABB x向0.958m、z向0.950m，内切于声明包络。首版参数（吊杆60mm、Ø240/Ø170、上层+22.5mm、下层半径0.42m）由本条目取代，R5b同版六视图证据见迭代目录 evidence/r5/。机制级验证（typecheck / test:server / test:app / verify:all 17-17 / gate:visual）在 R5b 配置上重跑通过。
- **被本条推翻/替代的结论（铁律3）**：① **DEC-2026-10-16-R4 的深钟形侧架垂吊造型**（上口Ø780/下口Ø520×深280、三根暖铜外置吊杆、单条偏心暖铜弧、暖铜配色）。可推翻的理由：业主以新参考图主动变更造型语言，R4无未解决的同类缺陷（R4独立双评审PASS），推翻来自审美方向变更而非技术失败；R4模型、截图、评审与DEC保留为历史，不删除。② **R4的350mm最大总下垂上限**：本轮按商品标称取450mm，最低点由2.45m降到约2.35m，仍高于2.1m净高要求；业主在alignment中明确确认该超出。③ **`docs/style-guide.md` §十“新主灯保持单件、乳白漫射和克制的铜色结构，不做多头点光组合”**：该条款写于单件深钟形路线占优时，与10头点光球泡组合直接冲突，本轮显式改判（见 style-guide 同步改动）。
- **光度冲突（不阻塞本轮，显式登记）**：项目现口径为客厅主灯7,100–8,500lm（客餐厅44.58㎡×100lx÷(UF0.6×MF0.8)，复算约9,287.5lm）；10只G9按同类商品估计仅约2,800–4,000lm，商品自标也只适用18–25㎡。按业主裁定：**先定造型，缺口登记为待SKU核验，补光层另算**。不得用10球泡数量、渲染亮度或商品面积标注反推照度达标。
- **明确保留**：主灯锚点`light_living_dome` (10.80,7.15,h=2.80)、`living_base`回路、双控、`strong-light-living`终点（明装线槽沿原顶板面敷设不变）、客厅吊顶/HVAC、餐桌与餐吊配置不变；灯不由餐桌定位。
- **现场/性能反转条件**：① 若同版仰视/客厅视角读不出10球泡半吸顶关系，停止数值微调并重开造型语言；② 若量房梁位、顶板承重、风口或坐姿视线不支持Ø1.0m×0.45m包络（含最低点2.35m），先按现场净距重画灯体，不能移动电气点位；③ 若SKU在3000K/Ra≥90下总流明/配光不能满足起居区照度与U₀≥0.7，优先补光层或换更高输出型号，并复算餐桌灯贡献；④ 若厂家没有对应的吸顶盘/臂座/球泡座构造或换泡路径，模型不构成可安装证据。
- **“X不工作时”与维护**：10个G9灯位的换泡路径（是否需拆臂/拆球罩）、吸顶盘与臂座连接、驱动器与接线舱位置、球泡积灰清洁方式均无厂家资料；owner=业主+灯具供应商+电工；trigger=SKU冻结/安装图确认前。承重点、灯重（数量级6–10kg，待核）与梁位待量房。
- **实质内容/删除审计**：R5替换的是R4的灯体造型（深钟形→黑盘+双臂球泡）、配色语言（暖铜→黑+镀铬）、总下垂（350→450mm）与几何构造器（SculpturalDomeGeometry在役调用→MultiGlobeChandelierGeometry）；**没有删除**R1–R4截图、DEC、评审、灯具候选、价格口径、轨道灯淘汰证据、流明冲突记录或电气/HVAC信息。style-guide §十“不做多头点光组合”条款被显式改判而非静默删除。`shared/render/SculpturalDomeGeometry.ts` 与其类型/schema保留作通用能力（同 track_light/wall_lamp 处理），当前无在役调用。
- **静默失效条件**：① 若球泡/臂/灯盘连接只在渲染层成立而厂家无对应结构，模型不构成可安装证据；② 若真实球泡透光率低或驱动输出不足，渲染亮度不代表光度；③ 若浏览器与GLB不再共用同一构造器，审图与导出会静默分叉；④ 若量房发现梁位/承重/风口冲突而包络未重画，净距判断失效。
- **决策人**：业主（造型方向、配色、包络三项经alignment确认）；R5内部尺寸分解（灯盘Ø、球泡Ø、臂角、层高）为设计提案，待同机位审美/功能复核，不视为业主批准商品或施工尺寸。

### DEC-2026-10-16-R6 客厅主灯按产品参数图修正几何（取代 R5b 内部分解）

- **日期**：2026-10-16。触发：业主审阅 R5b 六视图后反馈「感觉不太一样吧？」，并提供商品**产品参数图**（`/home/tao/.shellboard/uploads/s_LZ63XlvICjQ/image-2.png`，10头版带标注：吸顶盘Φ120mm/H25mm、球泡Φ130mm、整高450mm、Φ1000mm）。此前建模依据是商品场景/产品照（image.png），其透视与标注不一致；参数图带制造商标注，权威级高于场景照。
- **R6 提案（逐条取代 R5b 内部分解）**：球泡Ø**140→130mm**；吸顶盘高 20→**25mm**（Φ120不变）；灯盘由「厚双盘」Ø270×30/Ø190×45+finial Ø24（总90mm）改为参数图的**台阶单盘**：上盘Ø**200×28**、下盘Ø**155×22**、盘隙5mm、finial Ø**18**（总约50mm）；上层球心由「高于上盘中心75mm的双环冠」改为**贴顶紧凑冠**——球心 y=2.63m（与球关节同高，仅高于上盘中心约39mm），参数图上层5臂为近环；下层球心半径 0.43→**0.434m**（环标称外径=2×(0.434+0.065)=0.998m≈Φ1000mm）；臂弓 0.07→**0.06m**；吊杆120mm、关节球Ø50mm不变。
- **明确未变项**：外包络Ø1.0m×总下垂450mm（最低球泡底实测2.351m）、锚点`light_living_dome` (10.80,7.15) 贴原顶2.80m、10头5+5双层@36°、全部电气/回路/双控/`strong-light-living`/吊顶/HVAC/家具接口；`config/electrical.yaml` 等 frozen forbidden 文件未动。
- **被本条推翻的结论（铁律3）**：**R5b 的「75mm双环冠」内部分解**（球泡Ø140、上盘Ø270×30/下盘Ø190×45、上层球心2.67m）。可推翻的理由：R5b 的 75mm 上挑量来自 R5 首版审美复核意见，依据是商品场景照的目视判读；业主提供的参数图带制造商标注尺寸，其「上层近环+贴顶紧凑冠」与该意见直接矛盾，**产品规格优先于此前的审美推断**。R5b 的 Ø270/Ø190 灯盘同样依据场景照目测、无标注支撑，随本条撤出。
- **实际代价（不美化）**：① 层间间隙由110mm降至**84mm**（灯盘总厚90→50mm）；② 关节球与上盘顶由约4mm间隙变为**恰好相切**（球底2.605=盘顶2.605）；③ 上层球泡底（2.565）比上盘底面（2.577）低12mm（径向相距215mm，不相交）；④ 两处 1mm 级紧约束——下层环标称外径0.998m对声明包络半径余1mm、最低点下拉0.449m对 totalThickness 0.45m 余1mm；球泡Ø若回140将直接触发 schema「globe exceeds the fixture envelope」，**当前合法但无回退余量**；⑤ 实测 AABB x向0.956m、z向0.944m（5重对称环无径向对置点，内切于标称Φ1000mm），与商品同源，非缺陷。
- **现场/性能反转条件**：① 若业主以更多角度参考图指出上层环俯仰/3D方位不符，按新参考重画（参数图为2D正立面，臂的3D方位与上层环精确俯仰不可测量，属设计提案）；② 若量房梁位/承重不支持450mm总下垂或Ø1.0m包络，按现场净距重画，不动电气点位；③ 光度缺口与补光层维持 site_pending，R6 不改变选型口径。
- **“X不工作时”与维护**：10个G9换泡路径、吸顶盘/臂座连接、灯重与梁位仍待厂家安装图与量房；owner=业主+灯具供应商+电工；trigger=SKU冻结/安装图确认前。
- **实质内容/删除审计**：R6 只取代 R5b 的内部分解数值与「75mm双环冠」结论；**未删除**R5/R5b 截图、runtime、评审、候选、价格口径、流明冲突、R1–R4 历史证据或任何电气/HVAC 记录。R5b 记录以「被 R6 取代」形态保留，不静默删除。
- **静默失效条件**：① 若后续又把球泡Ø改回140而不动包络，schema 会拦住——但若同时改大包络，超出业主确认的Φ1000mm 将无门禁；② 层间间隙与球-盘竖向相切关系当前无 schema 约束（schema 只校验球心互穿/径向内缘/包络/总下垂），后续调整破坏这两项不会自动报警；③ 参数图是 2D 正立面，臂的 3D 方位与上层环俯仰仍属设计提案，若厂家实物为其他排布，模型不构成安装证据。
- **决策人**：业主（提供参数图并要求按此修正）；R6 的臂3D方位、上层环俯仰与臂弓为设计提案，待业主接受。

### DEC-2026-10-16-R7 客厅主灯上层环改贴 hub 紧内环（纯视觉微调）

- **日期**：2026-10-16。触发：业主审 R6 后反馈「怎么建模出来还是像八爪鱼？」。诊断：R6 上层5球泡环半径 0.38m 与下层 0.434m 接近等宽，双宽平环从任意角度都读成 10 根臂摊平放射；而参数图实测上层球泡距中心约 ±162mm（贴 hub 紧内环），宽环只有下层一个——R6 只修了尺寸与灯盘结构，没修径向排布。
- **R7 修正（一处声明值）**：上层 `globeRadius` 0.38→**0.22m**（其余不变：上层球心 y=2.63m 与球关节同高、臂根上盘檐 r=0.10m、下层 r=0.434m/球心 2.416m、球泡Ø130、整高449mm、锚点与全部接口）。修正后侧视/仰视读成「贴顶紧冠 + 下层垂环」的喷泉形，不再是对称双宽环。
- **代价与约束复核**：上层球泡内缘 0.22-0.065=0.155m vs 上盘半径 0.10m（隙 55mm）；相邻上层球泡弦距 2×0.22×sin36°=0.258m > 球径 0.13m；跨层最小球心距约 0.358m；实测 AABB 变为 x向0.956m、**z向0.916m**（上层不再贡献 +z 极值），仍内切于 Ø1.0m 包络；最低点 2.351m、北缘净距不变。
- **现场/性能反转条件**：① 若业主以更多角度参考图指出上层环俯仰/3D方位不符，按新参考重画（参数图为2D正立面，臂的3D方位与上层环精确俯仰不可测量，属设计提案）；② 若量房梁位/承重不支持450mm总下垂或Ø1.0m包络，按现场净距重画，不动电气点位；③ 光度缺口与补光层维持 site_pending，R7 不改变选型口径。
- **“X不工作时”与维护**：10个G9换泡路径、吸顶盘/臂座连接、灯重与梁位仍待厂家安装图与量房；owner=业主+灯具供应商+电工；trigger=SKU冻结/安装图确认前。
- **实质内容/删除审计**：R7 只取代 R6 的一个内部分解数值（上层环半径）；**未删除**R5/R5b/R6 截图、runtime、评审、候选、价格口径、流明冲突、R1–R4 历史证据或任何电气/HVAC 记录。
- **静默失效条件**：① 若后续又把上层环调宽（>0.30m）而不核对参数图，双宽环的「八爪鱼」读法会复发；② 上层球泡内缘与上盘檐间隙（55mm）无 schema 约束，若球泡再加大或上盘再加大有相切风险，需人工复算；③ 参数图是 2D 正立面，上层环半径是「贴 hub 紧内环」读法的设计取值，若厂家实物为其他排布，模型不构成安装证据。
- **决策人**：业主（视觉反馈驱动）；0.22m 为设计取值，待业主接受。

### DEC-2026-10-16-R8 客厅主灯夜预演开灯修复（业主反馈「这个主灯不会发光吗」）

- **日期**：2026-10-16。触发：业主截图显示夜预演下 10 个球泡是 flat 白、无光晕无天花反射。诊断（复现坐实）：`App.ts` `setupLightingPreviewPanel` 的 `onModeChange` 以 `setPreviewMode(mode)` 进入手动夜预演，而 `setPreviewMode(mode, manualOn = this.on)` 的默认值取当前 `this.on`——白天 auto 状态下 `autoOn=false` 导致 `this.on=false`，于是 `setInteriorOnlyNightPreview(true)` 把场景变暗的同时**全屋灯具保持全灭**，球泡 emissive 被 `applyVisibility` 压在 `FIXTURE_EMISSIVE_OFF`(0.05)，PointLight 亦不可见。复现截图与业主截图一致（全黑 silhouettes）；carried-preview 路径本就正确传 `state.manualOn`，只有交互切模式这一条路漏传。
- **修复（app/src/App.ts，一处调用）**：`setPreviewMode(mode, mode === 'manual')`——进入手动夜预演显式开灯（该模式的目的就是看室内照明）；退回 auto 时第二参数被忽略、仍由 syncSolar 的 autoOn 驱动。回归测试落在 `app/src/render/InteriorLightingSystem.test.ts`（锁定「dark auto → manual(true) 全灯亮 → auto 复灭」语义；App.test.ts 在本环境既有 DOM 加载失败，故测试放在系统层）。
- **发光链路说明**：球泡 emissive 走统一 CCT 管线（`applyAppearance` 把 `emissive` 覆写为 3000K 适配色、强度 `FIXTURE_EMISSIVE_ON`=0.21），实际照明由 PointLight 完成——预览亮度是人为校准值，**不得**用于反推照度（光度缺口仍 site_pending）。
- **被本条推翻的结论**：无（修复回归，不改造型/选型口径）。
- **静默失效条件**：若未来又有新入口切 manual 模式而漏传 manualOn，同一失效会复现；系统层测试只锁定 `setPreviewMode` 语义，App.ts 调用点无自动化测试（环境受限），改动该文件时需人工核对全部调用点（当前两处：onModeChange 已修、applyLightingPreviewState 本就正确）。
- **决策人**：业主（问题反馈）；修复为机制回归。

### DEC-2026-10-16-R9 客厅主灯每球泡独立光源

- **日期**：2026-10-16。触发：业主问「现在是每个球泡独立发光了吗？」——此前 10 个球泡只是 emissive 网格，实际照明只有锚点一个 PointLight(intensity 8, distance 7, decay 1.5)，预览照度分布不代表 10 头真实配光（R5 功能复核已登记该局限）。
- **R9 修正（app 机制）**：`shared/render/MultiGlobeChandelierGeometry.ts` 导出 `getMultiGlobeGlobeCenters(fixture, config)`，视觉与光源共用同一份球心坐标（杜绝两套算法漂移）；`InteriorLightingSystem` dome 分支对 multi_globe 配置按球心建 **10 个 PointLight**（单头 1.2，经 `LIGHTING_ENERGY_VISUAL_SCALE` 0.6 后 0.72/头，distance 3.5、decay 1.5——10 个 7m 程灯会整屋重叠过曝，故收程让每球照亮各自邻域）。`lights/baseEnergies/baseColors` 数组机制已支持（track_light 先例）。回归测试：10 灯位置与几何球心逐一致（半径 0.22/0.434、高度 2.63/2.416）、强度 0.72；普通 dome 保持原单灯近似不回退。
- **明确保留**：锚点、回路、双控、MEP、吊顶、外包络、总下垂、头数、配色全部不变；GLB/export 走 `LightingFixtureBuilder`（不含光源），导出链不受影响。
- **代价**：场景 PointLight 总数 +9（该灯具 1→10）；每头 0.72 的拆分是预览校准值，**不证明**光度达标，光度缺口维持 site_pending。
- **静默失效条件**：若日后改球心算法只改一边（视觉或光源），灯位与球泡会静默错位——两者共用 `getMultiGlobeGlobeCenters` 是当前唯一防线，重构时不得拆开。
- **决策人**：业主（功能要求）；单头能量/程长是预览校准设计值。

### DEC-2026-10-16-R10 客厅主灯下层环加倾斜对齐参考图（取代 R7 平环读法）

- **日期**：2026-10-16。触发：业主反馈「灯具造型上跟图片还是不一样。对齐一下造型」。诊断（参考图前视测量，同一标尺）：参数图与商品照都显示**最宽球泡在灯盘高度（≈250mm）、内圈球泡才下垂到≈400mm**——R7 的下层环是平环（5 球全压在球心 2.416m），读不出这个「近低远高」的有机簇；上层环半径 0.22m 亦略宽于参考图实测（±162~225mm）。
- **R10 修正（schema/builder 机制级）**：armTiers 新增 `tiltDeg`（绕东西轴倾斜，正值向南近侧下垂、北侧抬高）；下层 `globeRadius` 0.434m 维持、球心基准 -0.384→**-0.31m**、`tiltDeg: 12`（前视近侧两球下垂至≈383mm、侧球抬至≈282mm、最低球泡底 2.352m≈450mm 总高）；上层 `globeRadius` 0.22→**0.20m**、`tiltDeg: 0`。`getMultiGlobeGlobeCenters`、schema 位置计算与逐球校验同步应用倾斜（按各臂实际方位算球心 offset，平环基准值不再够用）。
- **实测**：AABB x向0.956m、z向**0.898m**（倾斜后 +z 极值由下层前球定）、y[2.352,2.800]；前视/仰视读成贴顶紧冠+近低下垂的有机簇，与参考图结构一致。
- **代价**：schema 增加一个自由度（tiltDeg）；倾斜后每球高度不同，「globe exceeds the total fixture drop」必须按臂方位算（已改）；若 tilt 再加大，最低球将先撞 450mm 总高门（schema 会拦）。
- **被本条推翻的结论**：**R7/R6 的「下层平环」读法**（5 球同高）。可推翻的理由：参考图（商品照+参数图）前视测量显示宽球在高位、内球才下垂，平环在任意角度都读成对称花环；倾斜环是同一 5 臂布置的高度重分布，不改变半径/头数/包络。
- **静默失效条件**：① 若后人把 tiltDeg 改大而不看总高门，schema 拦的是「最低球超 450mm」，但「侧球是否还在灯盘高度」无门禁，需对照参考图人工核；② 参考图是 2D 前视，倾斜角 12° 是「近低远高」读法的拟合值，非厂家标注；③ 臂 3D 方位仍是设计提案。
- **决策人**：业主（造型对齐要求）；tiltDeg 12° 与上层 0.20m 为设计拟合值，待业主接受。

### DEC-2026-10-16-R11 客厅主灯改等曲度等长10臂模板（取代 R7~R10 双臂异几何）

- **日期**：2026-10-16。触发：业主反馈「造型应该是每个都是一样的曲度弧线长度，而不是像八爪鱼」。诊断：R7~R10 的上层 5 臂（臂根上盘檐 r0.10m→球泡 r0.20~0.22m，短臂微挑）与下层 5 臂（臂根下盘檐 r0.0775m→球泡 r0.434m，长臂下垂+tilt12°）是**两套不同的臂几何**——长短、曲直、起止高度都不同，任意角度都读出参差触手；此前 R7/R10 只改了半径与倾斜，没解决「臂本身不一样」这个根因。
- **R11 修正（config 级，单臂模板用 10 次）**：两层共用同一条臂模板——同 `globeRadius` **0.434m**、同臂根（下盘檐 r**0.0775m**、y**2.517m**）、同 `armBow` 0.06m、`tiltDeg` 均归零；仅 `globeCenterOffsetY` 对称 ±0.10m（上层 -0.183→球心 2.617m，下层 -0.383→球心 2.417m）。10 臂按 36° 均布、上下交替（az 0/72/144/216/288 上挑，36/108/180/252/324 下垂），弧长与曲度完全一致。为给臂根让位，吊杆 0.12→**0.165m**、灯盘随之下移（上盘中心 -0.254、下盘中心 -0.284）。
- **实测**：AABB x向0.956m、z向**0.998m**（两层同半径后 ±z 极值分别由上层 az0 球与下层 az180 球定，标称 Ø1000mm 在 z 向兑现）、y[2.352,2.800]；最低球泡底 2.352m≈450mm 总高。runtime 10 个球泡灯全部落在 r=0.434m 的统一环上（5 盏 y=2.617、5 盏 y=2.417），臂的弧长曲度由构造器同一bezier参数生成。
- **被本条推翻的结论（铁律3）**：**R7 的「上层贴 hub 紧内环」与 R10 的「下层 tiltDeg 12 倾斜环」**。可推翻的理由：两者是「双层异几何」的补丁式修正，业主明确指出臂应等曲度等长；等长模板用「球心对称 ±0.10m + 上下交替」同时满足等长约束与参考图的双层观感，不需要异半径/倾斜。R7/R10 的 config 值与 DEC 保留为历史，不删除。
- **代价**：① 上层球泡由贴 hub 紧内环（r0.20m）改为统一环 r0.434m——「紧冠」读法让位给「等臂对称冠」；② 吊杆加长 45mm，灯盘整体下移，视觉重心略降；③ tiltDeg 字段仍在 schema（置零保留能力），未被 R11 使用。
- **现场/性能反转条件**：① 若业主参照更多角度参考图后要求上层环更贴近 hub（减小上层 globeRadius），必须同步减小下层 globeRadius 保持等长，或接受臂长差异；② 若量房梁位/承重不支持 450mm 总下垂，按现场净距重画，不动电气点位；③ 光度缺口与补光层维持 site_pending，R11 不改变选型口径。
- **“X不工作时”与维护**：10个G9换泡路径、吸顶盘/臂座连接、灯重与梁位仍待厂家安装图与量房；owner=业主+灯具供应商+电工；trigger=SKU冻结/安装图确认前。
- **实质内容/删除审计**：R11 取代 R7/R10 的臂几何取值（上层 r、下层 tilt、吊杆长、灯盘标高）；**未删除**R5–R10 截图、runtime、评审、候选、价格口径、流明冲突、R1–R4 历史证据、R8 开灯修复或 R9 每球泡光源机制。
- **静默失效条件**：① 若后人只改一层的 globeRadius/臂根/臂弓而不同步另一层，「等长臂」会静默退化成八爪鱼；② 等长约束无 schema 门禁（schema 只校验净距/包络/互穿），改 config 时需人工保持两层臂参数一致；③ 10 臂 3D 方位与 bezier 控制点是设计提案，若厂家实物臂形/排布不同，模型不构成安装证据。
- **决策人**：业主（造型反馈驱动）；单臂模板参数（臂根位置、±0.10m 球心、臂弓 0.06m）为设计提案，待业主接受。


> DEC-2026-10-16-R12 已移入同目录分册 `06-electrical-archive.md`（文档精简批 5 分卷，原文未改写）。
### DEC-2026-10-17-R1 客厅主灯试换为8头古铜木色弧臂灯（仅视觉预演）

- **日期**：2026-10-17。触发：业主看过当前10头球泡灯夜景后反馈“有点丑”，提供8头复古吊灯参数图并要求试换看效果；随后明确选择总高445mm（只装100mm长杆），以及“8根单头弧臂，分两层错高”。
- **本轮输入**：厂家图标注8头、外径Ø880mm、玻璃球罩150×140mm、吸顶盘Ø130×35mm；短杆50mm、长杆100mm，对应总高395/445/495mm。业主选择445mm中档。参考图可见木棕吸顶盘、古铜棕金属臂、乳白球罩；材质/颜色为图像观察，不是书面工艺规格。
- **本轮模型方案**：`light_living_dome` 暂从R11的10头、Ø1.0m×总高0.45m、Ø130球泡、黑盘/镀铬臂，切换为8头、Ø0.88m×总高0.445m、150×140mm椭球球罩、Ø130×35mm木色吸顶盘+100mm杆、古铜色中心件与弧臂。用户选择的8根单头弧臂分两层各4头；45°层间错位和0.365m球心半径是设计拟合值，来自外包络自洽，不是厂家角度标注。
- **被本条暂时取代的旧结论**：R11“10头等曲度等长弧臂”由业主明确认为当前视觉造型不满意而退出活动预览；本条只替换活动的灯具外观模型，不推翻R5–R11中关于电气锚点、回路、双控、机电路线、光度目标和现场待核事实。R11源文件与当时业主截图已逐文件留在 `docs/design-iterations/living-main-light-archive-20261017/`，历史决定/证据未删除。
- **实际代价与未决边界**：模型灯头数减少2个、外径缩小120mm、总高减少5mm；木色/古铜材质目前为程序化色块，不含商品级木纹/金属表面纹理。参考图没有功率、色温、灯头规格、光通量、配光、重量、安装孔距或灯体连接图；因此本次不把亮度、承重、采购与施工结论从R11平移到新候选。
- **“X不工作时”与维护边界**：待机/关灯时球罩仍作为静态外观存在；每个灯头的实际灯泡/光源接口、单灯失效后的替换方式、驱动器是否独立、球罩拆装清洁方式及清洁频次均未知。责任人：业主+灯具供应商；触发：候选SKU冻结/下单前；供应商需给书面规格与维护说明，未确认前不得推断8个灯罩都可独立换泡。
- **现场/施工反转条件**：当前沿用 `light_living_dome` (10.80,7.15,h=2.80)、`living_base`、双控、`strong-light-living` 路由、吊顶和HVAC，不移动点位。若完整商品尺寸/安装图与445mm总高定义不同，若梁位/底盒/承重/风口/检修净距不容纳Ø880mm×445mm包络，或SKU配光数据不能满足既有照明目标，则重开候选或另案补光；不得通过移动电气点位掩盖冲突。
- **实质内容/删除审计**：活动渲染配置由10头、Ø1000mm、450mm总下垂、球泡Ø130mm、吸顶盘Ø120×25mm、吊杆165mm、R11统一半径0.434m与黑/镀铬配色改为8头、Ø880mm、445mm、球泡150×140mm、吸顶盘Ø130×35mm、吊杆100mm和木/古铜/乳白色调。R5–R11活动配置注释保留为历史，另有完整字节快照和截图；没有删除旧候选、旧几何数值、旧光度缺口、旧维修待核项或R8/R9发光机制记录。
- **静默失效条件**：① 若8头实际是4根双头支臂而非8根单头臂，单张正视图可能导致支臂结构误读；此轮采用的是业主确认的8根单头结构，但具体3D方位仍是拟合值；② 445mm按天花锚点到最低球罩点解释，若厂商“总高”基准不同，模型低点会漂移；③ schema能检查声明包络和球罩互穿，但不能证明图面取色、商品弧线、灯具承重、配光或安装孔距与实物一致。
- **R1模型内审修正**：首版schema把finial最低点按球心计算，漏减了一次球半径；构造器实际把finial球心放在下盘底面以下一个半径，所以旧中心偏移 `-0.3875m` 会令实际最低点到 y=2.335m（下垂465mm），比用户选定总高多20mm。将下盘中心上移至 `-0.367m`、disc gap改为 `0.1195m` 后，尾饰最低点 y=2.3555m，低层球罩最低点 y=2.355m；schema现在按球体真实最低面校验。首轮R1截图/runtime保留作历史但已失效，R2必须重采。
- **决策人**：业主确定候选图、445mm和8根单头弧臂结构；弧线半径、两层错位角和材质色值为预演提案，待同版截图目检。

### DEC-2026-10-17-R3 客厅8头灯按业主反馈修正连接造型（仅视觉预演）

- **日期**：2026-10-17。触发：业主查看R2仰视画面后指出“造型不太对”。独立检查定位到明确的几何表达错误：R2把灯座沿球心径向横放，弧臂终点落在球罩侧面；两层臂根还都落在同一高度的上盘。
- **本轮修正**：竖直阶纹灯座放到球罩顶部，弧臂接灯座底部；上层臂连接上盘，下层臂连接下杯，两层用同向上扬弧线；下杯、中心连接杆、尾饰改为浅碗/车削轮廓，吸顶盘做轻微收边。总高仍为445mm，Ø880mm外包络、8头、原电气锚点/回路/控制/MEP均不变。
- **明确保留**：业主已确认的8根单头弧臂、两层错高与100mm长杆不变；R2使用的4+4、45°错位、同半径0.365m仅属3D预演假设，因为厂图只给正视图。R2截图/runtime与双评审记录保留为历史；其“审美PASS”不覆盖业主本次反馈，R3另行复核。
- **实质内容/删除审计**：活动几何移除横置侧插式灯座、侧面入球的弧臂端点、同高双层臂根和平盘+细直杆的占位中心形态；替换为顶部竖直灯座、分层 hub 连接、浅碗与车削中心装饰。未删除R2截图/运行时、8头和层级裁定、445mm/Ø880mm参数、R2复核及旧10头归档。
- **静默失效条件**：① 如果商品实物实际为侧插灯座或中心件并非碗/车削柱，R3外观拟合会偏离；② 如果供应商俯视/侧视图显示非45°环绕或半径不等，当前规则放射排布会静默失真；③ 竖直灯座、灯臂支撑点与中心饰件均依据商品正视照片观察，不等于厂家结构或受力图。
- **后续反转触发与责任人**：业主或供应商提供该SKU的侧视/俯视、结构图后，由设计者更新方位和连接造型，再由业主目检；SKU冻结前供应商/电工仍需核对实物灯头、灯罩拆装、重量、固定、接线与配光。当前仅供看造型，不作选型或施工批准。
- **验证/证据**：R3 URL `http://localhost:5173/?v=20261017-antique8-r3`；同版runtime、context/closeup/underside/topdown/elevation截图见 `docs/design-iterations/living-antique-eight-globe-light-20261017/evidence/`。R3审美与功能独立复核均PASS。
- **复核结论/非阻塞边界**：R3审美与功能独立复核均PASS。`hubAttachment`目前由schema校验，渲染仍读显式`armStartRadius/armStartOffsetY`；当前值对应上盘/下杯，未来改动必须同步这两组声明。本轮未归档独立GLB及逐件AABB，浏览器与GLB共用几何构造器且目标导出用例通过，足以支持本轮仅看造型。
- **决策人**：灯位、8头、双层与总高由业主确认；连接造型和商品图不可见的3D方位由设计者提出为可逆预演。

### DEC-2026-10-17-R4 客厅南臂地插改为强电箱侧落地垫层支路，并补查竖向飞线

- **日期**：2026-10-17。触发：业主问 `mep:route:strong-power-living-sofa-r` 为何悬空，随后确认吊顶垂降不合适、优先试强电箱侧走地。当前工地仍未交房、硬装和水电未施工。
- **本轮决定**：仅替换 `sock_living_sofa_r` 的候选支路：从 `panel_strong_entry_left` 客厅侧出线，箱底 `y=1.65m`，偏入客厅至 `x=13.34`（按模型默认 0.12m 墙厚取 `w_foyer_east` 客厅侧面）后用保护管沿墙落地；实际墙厚与箱体出线面仍待量房复核，不在剪力墙凿槽。再在垫层内沿客厅侧 `x=13.34` 南行至 `z=9.35`，向西接 `(11.00,9.35)`。`d_bese` 门洞范围的水平段由垫层承载，不依赖 `w_be_west` 门垛或墙体固定，也不穿门洞墙体。route 显式声明 `to_height: 0.02`，不依赖默认层高。正交展开约 **9.78m**（0.06+1.63+5.75+2.34），保持 `ordinary_power_living` 同一回路和插座点位，不新增断路器；全程不跨客厅南侧玻璃幕墙。
- **被本条推翻的旧结论（逐条说明）**：
  1. `DEC-2026-10-07-M04` 为 `sofa_r` 采用“最近吊顶缘下引进垫层”的候选走法。其旧配置从 `(11.00,9.65,2.70)` 垂直落到 `(11.00,9.65,0.02)`，再接地插；实际没有墙、管井或其他竖向构件支撑，落点邻近的南墙是落地玻璃幕墙。**可推翻理由**：业主确认该吊顶垂降不合适，且本轮运行时检查证实渲染段穿过开放客厅。
  2. `DEC-2026-10-07-F01` “sofa_l/r 吊顶缘分支不变”中关于 `sofa_r` 的部分。**只重开 `sofa_r` 分支**；F01 批准的 `strong-power-living` 主干沿东侧墙链进入南侧窗帘盒带仍保留，`sofa_l` 和餐厅地插也未由本条改道。
  3. `shared/mep-hvac-lint.ts` 将纯竖直段跳过、仅按平面长度采样其余段，`mep-hvac-lint.test.ts` 断言无墙支撑的长竖直下引合法的旧规则。**可推翻理由**：开放空间里的长竖降和陡斜短平面段可被绘出、现场却无依托；支持检查现按 3D 长度采样，只有吊顶空腔、实体墙或垫层能提供依托。`floor_branch_candidate` 原先只是方法文本，没有 linter 特殊语义；本轮再明确 floor_branch(_candidate) 退出吊顶完成面比较，地面支路依托仍由 `unsupported_span` 检查。另修正 `MepCoordinationRenderer` 字符串端点默认高度与共享解析器不一致的问题：端点未写 route 高度时，改用解析后的点位高度。
- **实质内容 / 坐标差异审计**：删除旧 `from=(11.00,9.65,y=2.70)` 与旧 `via=(11.00,9.65,y=0.02)`，新增配电箱端点及 `(13.34,3.60,y=1.65) → (13.34,3.60,y=0.02) → (13.34,9.35,y=0.02)` 折点；`to` 保持 `sock_living_sofa_r`，点位坐标、所属回路和主干位置未删除。`x=13.34` 是当前 0.12m 模型墙厚下的客厅侧表面候选，实际墙厚须量房校正。旧 reason 写 `z=9.55/h=2.65`、向北 `0.20m`，与旧坐标 `z=9.65` 及终点 `z=9.35` 已不符；新 reason 按新候选几何重写。另一个旧渲染落差来自 `to_height` 缺省：渲染器曾把 socket 字符串端点绘到强电层默认 `y=2.55`，尽管 linter/takeoff 解析到该点位高度 `y=0.02`；本轮显式写 `to_height: 0.02` 并统一两边解析。
- **成本和未决边界**：旧/新 sofa-r 3D 折线长约 **2.98m → 9.78m**（+6.80m）。按 `shared/mep-takeoff.ts` 对同回路 union 复算，`ordinary_power_living` 的 `conduitM` 由 **24.65m → 31.85m**（+7.20m）；2.5mm² 三芯 `wireM` 由 **77.65m → 100.33m**（+22.68m）。takeoff 的回路 union 是基于平面路径的派生量，合并现有同回路平面路径；它与单条路线的 3D 长度不是同一口径，现场确认高度/墙厚后需重算，不能用 9.78m 直接替代。复算明细见 iteration evidence `takeoff-ordinary-power-living.json`。强电箱实际出线方向、箱底是否有向客厅侧出管空间、墙面保护管完成面收口、`d_bese` 门槛净距、垫层厚度和既有暗埋水电均待现场核实，未核实前不得放线或称为施工路线。
- **现场反转条件（owner + trigger）**：业主/电工在量房与水电交底前核对箱体西侧出线、墙面保护管位置、门槛和垫层空间；若不能从箱体客厅侧安全落地，或地面垫层与门槛净距不足，则回到“同回路可施工支路”重新选线，不恢复无依托的吊顶自由垂降。
- **静默失效条件**：① `panel_strong_entry_left` 的坐标仍是 inferred；移动箱位却不更新本 route 的 via 会断开箱体到地面的连接；② 依托检查的墙距阈值为 0.25m、地面支持带为 `y≤0.35m`，墙面偏移或完成面标高改动可能改变 linter 结论；③ 0.30m 以下的短开放区间仍低于 `unsupported_span` 最小连续长度，不代表现场必然有支撑；④ 若以后删掉 `to_height` 的显式声明，渲染器会按点位高度回退，但应同时复核 renderer/linter/takeoff 三者的端点口径。
- **净空规则与事实引擎同步**：旧 MEP 支持检查漏查纯竖降，旧事实引擎只查 route points，且两者 clearance 统计差 2 处/1 路线。R4 规定吊顶承载层 `floor_branch(_candidate)` 路线至少有一个点进入 `y≤0.35m` 垫层带，才退出完成面比较；高位误标由 `floor_branch_missing_floor_band` 显形，所有空间起降仍由 3D `unsupported_span` 检查。facts 现在与 MEP 共用 rounded footprint 和 segment 相交算法，补计此前漏掉的 `strong-power-master × curtain_box_master_south` 段内穿越。两个引擎当前均为 **51 处 / 42 条路线 / 14 个分区**，契约登记 52→51；净减少来自地面支路误报，不是删除路线或调低飞线检查。
- **维护 / 失败态**：待机或停机时，保护管与电线留在垫层内，不需清理。故障时先断路器隔离，再从地插与箱端检查通断；若地面封闭后管路损坏或无法抽换，按局部开地面检修或重画备用支路处理，业主 + 电工负责。垫层封闭后不可见，水电验收时须留走线照片和坐标记录；底盒和导管通路在浇筑/找平前核验可穿线、端点接入和连续性。箱底无法出线时，由业主 + 电工在量房/电气交底前重选支路。
- **验证和历史保留**：原有 `sofa_r` 配置、M04/F01 原文和本轮改前运行时/截图作为历史证据保留；新路线继续是 `inferred / proposed / construction_status: pending`。本条不改墙体类型、南玻璃幕墙、沙发/家具、地插坐标、回路拓扑或强电箱位置。
- **决策人**：业主确认“强电箱侧落地走垫层”为优先候选；坐标落线按现有模型轴线示意，具体箱体出线和垫层做法待现场核实。

### DEC-2026-10-17-R5 客厅8头灯球罩统一高度，仅保留水平错位

- **日期**：2026-10-17。触发：业主确认“8个球罩同高，只在水平方向错开”。这次澄清覆盖首轮对“分两层错高”的垂直解释；R3已通过的两层灯罩造型仅保留为历史版本。
- **本轮决定**：8个球罩中心统一为 `y=2.425m`（相对2.80m锚点 `-0.375m`），两组各4头只在平面内按0°/45°错开，球心半径0.365m。最低球罩边仍为 `y=2.355m`，尾饰最低为 `y=2.3555m`，故445mm总高与Ø880mm声明包络不变。球泡灯座仍竖直位于球罩顶部。
- **明确保留**：8根单头弧臂、木/古铜/乳白候选、445mm（100mm长杆）、现有 `light_living_dome` 点位/回路/控制/MEP均不变；臂根仍分别接上盘和下杯，因此臂根的结构标高不同，但灯头球罩必须同高。水平45°两组是正视图不足以确认的平面预演假设。
- **被本条推翻的旧结论**：R1对“分两层错高”的首次解释以及R3把第一组球心放在 `y=2.605m`、第二组在 `y=2.425m` 的球罩布置。**可推翻理由**：业主最新明确指定所有灯罩同高。R3的共享几何与审美/功能评审仍保留历史，R4按平面分组同高重建；R3评审不覆盖R4球罩布置。
- **实质内容/删除审计**：活动配置移除4个较高球罩（球心偏移 `-0.195m`）并将其降低180mm至 `-0.375m`；不删除R3的上下臂根位置、竖直顶灯座、中心饰件、R3运行时/截图/审查、用户445mm选择或旧10头灯归档。R4截图与runtime为当前同版证据。
- **静默失效条件**：① 若用户所称“同高”实际指球罩外壳底平面之外的其他基准，应重新确认，但当前按球心同高且球罩尺寸相同，外壳上下边也自然同高；② 45°水平布置和同半径仍缺厂商俯视/侧视验证；③ 上/下中心臂根虽可不同高，若以后重排臂根或灯头尺寸，必须复核弧臂端点仍接到同一高度的灯座底部。
- **验证/证据**：R4 URL `http://localhost:5173/?v=20261017-antique8-r4`；runtime核对8个灯球心Y全为2.425m、8个灯座/弧臂/PointLights均存在；`verify:all` 17/17、类型检查、灯具17项单测和GLB 13项导出测试通过；R4改后 `gate:visual CLEAR`。
- **R4独立复核结果**：审美与功能均PASS。少数正视机位的球罩投影重叠源自45°水平错位；三维弧臂中心线最小净距约82mm（管径14mm），没有实体穿插。等待业主确认这个视角遮挡是否可接受。
- **决策人**：业主确认球罩同高与水平错位；R4平面角度、臂根连接与弧线仍为可逆视觉预演，不作厂商结构事实。

### DEC-2026-10-17-R6 客厅8头灯臂根共面并同向上拱

- **日期**：2026-10-17。触发：业主补充“所有灯珠应该是从同一个台面往上曲”。R4仅统一了灯罩高度，仍把弧臂根部拆在上盘和下杯、分别配置下垂与上扬；这不符合业主最新的共面起弧要求。
- **本轮决定**：8根弧臂统一从上盘边缘起弧，根部半径0.07m、高度 `y=2.585m`；统一使用 `rise` 和0.10m控制点拱高，曲线先高于根平面再向下接至同高顶部灯座。runtime在曲线 `t=0.25` 处测得 `y=2.601m`，高于根平面16mm。8个球罩仍统一中心 `y=2.425m`，两个水平组仍按0°/45°错位。
- **明确保留**：8头、每臂单头、同高球罩、Ø880mm、445mm总高、100mm长杆及原灯位/回路/控制/MEP不变；下杯/车削尾饰继续作为中心装饰件，但不再承接灯臂。水平3D方位仍由正视图拟合，不宣称为厂商实测。
- **被本条推翻的旧结论**：R4“上层臂接上盘、下层臂接下杯、上组droop/下组rise”的双根平面造型。**可推翻理由**：业主明确指定所有灯珠从同一台面向上曲；R4功能/审美PASS只适用于R4，完整保留历史而不覆盖R5。
- **实质内容/删除审计**：删除R4下组的下杯根坐标 `r=0.058m/y=-0.3595m` 和该组独立rise配置；8根根坐标统一为 `r=0.07m/y=-0.215m`、统一rise。未删除下杯实体、同高灯罩裁定、R4截图/runtime/复核、R3造型修正、R2/R1证据或10头灯归档。
- **schema语义改动**：`sweep` 现在表示相对“根点到灯座底端弦线”的弧线鼓起方向；曲线端点本身可高于或低于臂根。此前schema把rise/droop错误地绑定为端点必须高/低于根点，会拒绝“先向上拱、再下降至同高球罩”的有效曲线，本轮移除此端点关系校验。
- **静默失效条件**：① `armBow=0`时rise不再产生可见向上拱，若改参数须复核曲线采样点；② 顶部灯座位置/球罩高度变更后须复核弧臂终点和灯座底面重合；③ `hubAttachment`由schema检查，但渲染根点仍取显式radius/offset，改盘体字段需同步两者；④ 45°平面错位、0.365m半径及前后遮挡仍是图像推断。
- **验证/证据**：R5 URL `http://localhost:5173/?v=20261017-antique8-r5`；typecheck、灯具17项单测、GLB 13项测试通过；R5前后`gate:visual CLEAR`。R5完整`verify:all`为16/17，唯一失败是灯具之外既有Mep清单登记52处与机器实算51处漂移（`docs/mep-construction-guidance.md` / `config/mep-hvac-coordination.yaml`）；本轮未改动这些MEP源。R5同版截图和runtime见迭代证据。
- **R5复核结论**：独立审美/功能复核均PASS；弧臂三维中心线最小间距约53.6mm，管径14mm，未发现实体穿插。立面投影因水平错位仍有局部重叠，需业主确认观感。
- **决策人**：业主确认共面起弧与向上拱；根半径/控制点高度由设计者按图拟合，保留为可逆视觉预演。

### DEC-2026-10-17-R7 客厅8头灯共面弧臂根改接下杯

- **日期**：2026-10-17。触发：业主指出R5仍从上盘台面起弧，并澄清“是从下面那个台子往上曲的，而不是上面那个台子”。R6将共同起弧台面改为中心下杯。
- **本轮决定**：8根弧臂均从下杯台面 `y=2.4405m` 起弧，根半径0.058m，统一`rise`及0.10m曲率控制值，向上拱后下降接到球罩顶部灯座；8个球心继续同高 `y=2.425m`，水平0°/45°两组、半径0.365m不变。臂端 `y=2.499m`，进入灯座底部约4mm。
- **明确保留**：445mm总高、Ø880mm外包络、100mm吊杆、8头/8根单头臂、灯位与电气回路/控制/MEP均不变；上盘保留为吊杆/装饰组件，下杯承接全部弧臂。
- **被本条推翻的旧结论**：R5让8根臂共接上盘 `y=2.585m/r=0.07m`。**可推翻理由**：业主指明“下面那个台子”是弧臂起弧面；R5对“同一台面”的理解错误，相关截图与独立评审保留历史但不覆盖R6。
- **实质内容/删除审计**：活动根点由上盘 `(r=0.07m, y=2.585m)` 全部改为下杯 `(r=0.058m, y=2.4405m)`；保留R5球罩同高、水平错位、统一上拱与灯座连接，不删除上盘、下杯、R5/先前证据或旧款灯归档。
- **静默失效条件**：① 若下杯直径、灯座高度或灯臂粗细改变，`armStartRadius=0.058m`和0.10m弧高须复核连接/净距；② schema中的`hubAttachment`检查配置，但渲染根点仍读取显式radius/offset，改动须同步；③ 45°水平布置和0.365m半径仍是正视图不足时的预演假设。
- **验证/证据**：R6 URL `http://localhost:5173/?v=20261017-antique8-r6`；runtime确认8臂根Y全为2.4405m、8球心Y全为2.425m。`verify:all` 17/17、类型检查、灯具17项单测和GLB 13项测试通过；R6前后`gate:visual CLEAR`，R6独立审美/功能复核均PASS。
- **决策人**：业主确定下杯作为共同起弧台面；弧臂半径和弧高为视觉拟合参数，非商品承重或结构规格。

### DEC-2026-10-17-R8 餐厅灯替换为中古风奶油云团灯比例预演

- **日期/来源**：2026-10-17。业主先提供简顿商品编号 `10227415633446` 的主图和参数图，后补充参数图并明确「按主图比例预演」。
- **用户提供的参数**：云罩 Φ500×H110mm、底盘 Φ500×26mm、五金+PE；另一张图标称 40W/3200lm/5–10㎡/多色温。以上来自业主上传图片，本轮没有独立复核商品页、选中 SKU、价格、评价、真实 3000K 档流明或配送安装口径。
- **本轮决定**：餐桌灯视觉外观改为木色圆底盘 + 乳白 PE 云朵泡罩 + 三颗不同垂长木球；主体尺寸取参数图，吊球直径约60mm、吊线约230/280/400mm，总下垂约486mm按主图相对Φ500mm主体的画面比例作可修改预演。该486mm不代表商品总高、吊线长度、施工尺寸或承重能力。
- **明确保留**：`light_dining_pendant` 点位 `(9.80,3.45)` / 安装高度2.80m / `ceiling_light` / 3000K / `dining` 单独回路 / `switch_dining` 墙控及拓扑 / `strong-light-dining` 路由 / 餐桌 / 吊顶 / 客厅主灯全部不变。
- **被本条推翻的旧结论**：`DEC-2026-10-16-R12` 当前活动外观为镀铬底盘+短杆+浅穹顶乳白罩、总下垂约284mm，并以“与客厅主灯同家族镀铬/乳白”作为外观要求。**可推翻理由**：业主提供新的具体商品造型参考，随后明确要求按该主图比例预演；这是业主选择的新外观方向。R12 的灯位修正、照度代价、路由及 SKU open question 不被推翻。
- **实质内容/删除审计**：活动 `config/render/lighting.yaml` 中移除 R12 的 `chrome_opal` 半吸顶专属参数（Φ120×18吸顶盘、140mm短杆、Φ520/470×120浅穹顶、细镀铬收边、284mm包络），替换为Φ500×26木色底盘、Φ500×110 PE 云罩和三木球声明。没有删除 `SemiFlushDomeGeometry`、相关类型/schema、R12决议、旧截图/runtime、雷士 JZSJ12474-10 历史候选或任何光度证据；这些均保留为历史/通用能力，不再是餐厅活动造型。
- **几何共享**：新增 `shared/render/CloudOrbCeilingLightGeometry.ts`，浏览器 `InteriorLightingSystem` 和 GLB/export `LightingFixtureBuilder` 调用同一构造器；材质使用漫射+受限自发光，不开 `transmission`。保留单个电气 `PointLight`，渲染亮度不作为流明/照度证据。
- **需要避免的静默失效**：① 商品真实总高或吊球分布若与486mm代理差异，模型不会自动代表 SKU，必须按厂家总装图改参数；② 实际 3000K 输出/配光若不足，桌面150 lx不成立，100 lx也须实测或按 SKU 重算；③ 底盘重量/固定和三球防坠、驱动更换、PE罩拆洗未在图片证明，供应商在下单前给安装/维修资料，电工安装前核底盒与固定；④ 50cm主体的木盘与云罩若非同径安装结构，需按实物图修正。
- **现场/采购反转条件**：若精确 SKU 的总高/重量/固定方式与模型空间条件冲突，或 3000K 档配光不能达到桌面照度目标，重开候选/外形和照度口径；不通过移动灯位或改变回路掩盖接口。
- **下一步责任**：业主+供应商在 SKU 下单前确认具体型号、3000K档流明/配光、总高/重量、底盘固定、LED/驱动更换与PE罩清洗说明；交房后由电工在安装前复核底盒和顶面承载条件。问题登记于 `docs/pending-site-data.md #65`。
- **验证/证据**：`gate:visual` 前后 CLEAR；`verify:lighting-config`、`verify:all`、`typecheck` 通过；云灯 server 聚焦测试 1/1、`InteriorLightingSystem` 聚焦测试 18/18 通过。浏览器同版四视图证据及运行时包络 x[9.55,10.05]、y[2.314,2.800]、z[3.20,3.70]m 见 `docs/design-iterations/dining-cloud-light-20261017/evidence/`。全量 server/app 测试各有既有环境/其他模块失败，详见该迭代 work-record；不覆盖本灯具的聚焦测试。审美复核 PASS；功能复核首轮 BLOCKED 后已按要求补全带 owner/trigger 的维护待核项，正在复核。本 DEC 只确认外观方向，不作为采购或施工定案。
- **决策人**：业主确认主图比例预演；未标的吊线、木球与总高参数由设计侧估值并明确保留为推断。

### DEC-2026-10-17-R9 餐厅云团灯移至餐厅平顶范围中心

- **日期/触发**：2026-10-17。R8 灯具造型已经由业主按主图比例确认；随后业主补充“放到餐厅的几何中心，不用在餐桌的几何中心上方”，并选择现有餐厅平顶范围中心 **(9.25,3.65)**。该范围按 x[7.70,10.80]、z[3.00,4.30] 取中心；它是餐厅平顶视觉区域，不是 `model-geometry.yaml` 中的独立房间 polygon。
- **本轮决定**：将 `light_dining_pendant` 电气坐标从 **(9.80,3.45)** 移至 **(9.25,3.65)**，即选定平顶范围的几何中心；餐桌保持中心 **(9.80,3.45)**。灯心相对桌心偏移 (-0.55,+0.20)m，水平距离约 **0.585m**。点位 ID、`ceiling_light`、安装高度2.80m、3000K、`dining` 单独回路、`switch_dining` 控制目标与电气拓扑保持。
- **几何关系**：主体外径500mm，R9 平面包络预期 x[9.00,9.50]、z[3.40,3.90]，完全落在业主选定平顶区域内；y 包络保持 [2.314,2.800]m。此为模型静态检查，桌面高度尚未实测，不能据此判断人体或施工净距。
- **被本条局部推翻的旧结论**：R8 将灯具点位与日常餐桌中心绑定，并认为新灯继续位于桌心上方。**可推翻理由**：业主最新明确要求以餐厅平顶范围中心为灯心，而不再要求与桌心同心。R8 的主图外形、Ø500×136mm 主体、20枚预演云泡、三根吊线/木球和486mm比例下垂估值、商品/SKU/光度/安装待核全部保留；桌椅、吊顶和客厅灯均不改。
- **实质内容 / 删除审计**：移除活动电气点位旧 x/z=(9.80,3.45)，新增(9.25,3.65)；`strong-light-dining` 末端 via 从 x=9.80 改为 x=9.25，并将终端敷设显式正交化：由 `bend_corridor` 经 ceiling_living/西服务带/北服务带进入，z=3.00 后抬至原顶板底 y=2.70，再向南明装线槽0.65m到灯位。旧 R12/R8 位置和场景证据仍留在历史记录，不删除候选、光度证据或淘汰理由。电气拓扑只更新控制说明；`lighting_dining` 成员和 `control_dining` target ID 不变。
- **照明影响**：灯心离桌心0.585m；R12 关于桌心正上方“贴顶与下垂灯照度约1/4”的高度简化估计不适用于R9偏心布置，保留历史但不再作为本位置结论。采购前仍需按固定 SKU 的3000K配光核验桌面150 lx目标（100 lx备选）；不得以3200lm标称值或模型自发光代替实测/配光计算。
- **布线和现场条件**：路线保持 `strong-light-dining` / `lighting_dining`，总点位及墙控关系不变；原顶板底明装线槽z=3.00→3.65约0.65m，仍是 proposed/pending。业主+电工在水电交底、封顶前复核梁位、板底平整度、线槽收口及 2.80m 吊点盒位置；若支撑/外观不成立，先调整路由敷设方案，不能把该段默认为吊顶暗管。
- **静默失效条件**：①若餐厅平顶范围边界改变，灯心仍按旧边界计算，须同步重算；②若只移动电气点位而不更新 `strong-light-dining` 的 via，末段会形成斜跨或失去支撑；③若 SKU 实际总高、重量、固定、防坠或维护与预演不同，几何模型不代表实物；④偏心后的桌面照度不可沿用 R12 旧桌心估计。
- **证据与验证状态**：R8四视图仅作旧位置历史证据；R9同版 `context/closeup/elevation/topdown` runtime、snapshot和PNG已采集，目标对象ready=true、错误横幅为空、AABB为x[9.00,9.50]/y[2.314,2.800]/z[3.40,3.90]m。`gate:visual` CLEAR（electrical 92dae5d27ff3）、`verify:lighting-config`、`typecheck`通过；两次 `verify:all` 均为16/17，唯一失败是共享 `verify:mep` 聚合（前次222错误/173警告，最终224错误/171警告），两次均无 `strong-light-dining` 诊断；`verify:facts`与`verify:electrical`通过。R9功能复核PASS；审美首轮FAIL：0.585m灯桌偏移使灯具读为餐厅空间中心氛围灯，与“餐桌重点灯”语义存在冲突。用户随后接受空间中心氛围灯定位，DEC-2026-10-17-R10后同版R9四视图复审PASS。SKU光度/维修/安装及线槽现场条件仍按#65和路由pending，不作为采购或施工定案。
- **决策人**：位置由业主明确选择；route 的正交via与0.65m顶板底线槽由设计侧按新终点同步，施工敷设仍待量房/电工核实。

### DEC-2026-10-17-R10 餐厅灯明确为平顶中心氛围灯

- **日期/触发**：2026-10-17。R9审美复核指出灯心离桌心约0.585m、灯体与桌面平面投影只重叠约0.10m、三球落在桌外；按“餐桌重点灯”关系无法审美通过。业主回复“可以，提交你的改动吧”，确认接受已选平顶中心位置作为空间中心氛围灯。
- **本轮决定**：保留R9灯心 **(9.25,3.65)**、餐桌中心 **(9.80,3.45)** 及全部现有灯具/电气/布线配置；不要求灯与餐桌同轴。该灯作为餐厅空间氛围灯，不承诺单独满足桌面150 lx。餐桌150 lx目标（100 lx备选）仍作为全场照明组合指标，采购前按最终灯具组合与实际SKU配光核验。
- **明确保留**：R9已完成的木色底盘、乳白PE云泡、三木球外形和486mm主图比例估值不改；灯点ID、2.80m安装面、3000K、`dining`回路、`switch_dining`、`strong-light-dining`路线、餐桌位置不改。R9坐标决策未被R10推翻，本条只明确其功能语义和照度责任边界。
- **被本条解决的待决项**：R9 `off-center-fixture-role` 从“待业主确认”关闭为“保持中心、空间中心氛围灯”。没有修改灯位去追求桌心重叠，也没有新增灯具或灯位；如需实际桌面重点灯照度，按整体灯光方案和SKU配光另核。
- **实质内容 / 删除审计**：活动几何、点位坐标、route、回路、控制关系均未删除或改动。更新的是对象功能描述、采购行和#65待核口径：删除“默认由该灯单独承担桌面150 lx”的含义；R9旧审美FAIL和四视图证据保留作复核历史，R8/R12桌心估算继续标为历史，不删除商品候选或光度证据。
- **静默失效条件**：①若采购文件仍把该灯描述成唯一桌面重点灯，可能在偏心位置无法满足150 lx；须按最终照明组合核验；②若之后重新要求桌面重点照明，R9的空间氛围灯定位不再满足该优先级，需要重新选点并复审；③真实SKU配光、色温档、重量、固定、防坠和维护未知，仍按 #65 核验。
- **验证与审查**：R9功能复核PASS；DEC-2026-10-17-R10后同版R9四视图按空间中心氛围灯目标复审PASS，首轮FAIL保留为历史并注明其桌面重点灯语义前提。`gate:visual` CLEAR、typecheck和照明配置校验通过；`verify:all` 16/17，唯一失败是全局 `verify:mep`（两次汇总分别222/173和224/171，均无 `strong-light-dining` 诊断），当前不据此声称MEP全屋通过。本条不作为商品采购、照度达标或施工定案。
- **决策人**：业主确认空间中心氛围灯语义；整体桌面照度由设计/供应商在SKU确定和灯光组合核验时负责验证。

### DEC-2026-10-17-R12 吸顶灯渲染锚点统一贴安装完成面：5 盏遗留 Blender 基线 offset 归零

- **日期/来源**：2026-10-17。工作区新增的 `verify-spatial` 检查 `lighting_ceiling_mount_detached`（吸顶类灯具可见实体顶部须在宿主吊顶完成面容差内）抓出 5 盏灯：`light_master_dome`/`light_parent_dome`/`light_child_dome`/`light_kitchen_panel`（各 `anchorY_offset: -0.25`）与 `light_study_dome`（`-0.5`），渲染实体悬在宿主完成面下方 0.10–0.50m。
- **问题定位**：5 条 offset 的 basis 均为「已审计 Blender 基线：普通吸顶灯使用最终渲染高度 2.55m」（书房为「避免嵌入顶面压到 2.30m」）。这是 Blender 时代的表达手法——当时灯具锚点下移以表现灯罩下缘；而 `DEC-2026-10-16-R2`（客厅主灯）与 `DEC-2026-10-17-R8/R9`（餐厅灯）已确立现行口径：**渲染锚点 = 施工安装完成面，视觉下垂由共享几何表达**。Blender 主线已冷归档（`scripts/archive/blender-pipeline/`），基线失去权威来源。
- **本轮决定**：①`config/render/overrides.yaml` 中 5 条 `anchorY_offset` 归零，basis 改写为引用本条 + 宿主面口径（4 卧室 dome 点位均落在原顶 2.80m 平顶区，不在任何吊顶分区 footprint 内；厨房平板灯宿主为 `ceiling_kitchen` 铝扣板完成面 2.65m）；②`config/electrical.yaml` 仅 `light_kitchen_panel` 的 `height` 由 2.8 改为 2.65（安装完成面本就应是铝扣板底，原 2.8 与吊顶分区声明矛盾），其余 4 盏 `height: 2.8` 不动；③普通 dome 分支（`LightingFixtureBuilder.addDome` 默认半球，翻转后包围盒顶恰在锚点）归零后顶部即贴宿主面，几何零改动；④`data/project-render-facts.json` 按 `generate:project-render-facts` 重生成。
- **被本条推翻的旧结论**：逐条列出——master/parent/child/kitchen 四条「已审计 Blender 基线：…最终渲染高度 2.55m」、study 一条「书房吸顶灯嵌入顶面…最终渲染锚点为 2.30m」。可推翻理由： Blender 基线所服务的渲染主线已冷归档，且同文件内 `light_living_dome`、`light_dining_pendant` 已按新口径迁移并通过验证，证明「锚点贴面 + 几何表达垂坠」在当前管线成立；书房「避免穿出吊顶完成面」的风险对象不存在（点位 (14.9,7.125) 不在任何吊顶 footprint 内，属原顶平顶区，不存在可穿出的完成面）。`DEC-2026-10-16-R2`/`R8/R9` 本身不被推翻，本条是其口径向剩余 5 盏灯的补全。
- **实质内容 / 删除审计**：删除的旧表述为上述 5 条 basis/reason 全文（含「表现灯罩厚度与出光半球」「已审计 Blender 基线」措辞），逐条替换为引用本条的新 basis/reason；`electrical.yaml` kitchen 点位 note 同步改写。没有删除任何灯具点位、回路归属（`lighting_bedrooms_bath` 成员不变）、控制拓扑（三控绑定不变）、MEP 路线（`to_height` 为声明值，`endpoint_elevation_mismatch` 只查 switch 类，不涉及灯具）或历史证据。
- **「X 不工作时」**：吸顶灯故障检修时，渲染锚点与施工安装面一致意味着检修口径（拆罩、换驱动、底盒接线）直接对应模型高度，无需先心算渲染偏移；kitchen 平板灯安装面 2.65m 与铝扣板检修口同面。残存未知：4 间卧室「原顶平顶区」的判断来自模型吊顶分区推演，未经现场核对。
- **静默失效条件**：①`addDome` 默认分支几何若再改动（不再是「包围盒顶=锚点」），本检查与渲染会再次脱钩——由本轮新增的回归测试钉住；②`ceiling_kitchen` 完成面若再调整，kitchen 点位 `height: 2.65` 必须同步；③若未来某盏灯需要真实垂坠造型（如云朵灯），应走 `config/render/lighting.yaml` 样式声明，禁止回退到 `anchorY_offset` 下移手法。
- **下一步责任**：量房时核对 4 间卧室灯位确在原顶平顶区（owner=业主/量房方，触发=量房日）；若实测存在局部吊顶，按实测完成面重设 `height` 并复跑本检查。
- **验证**：`gate:visual` 前后 CLEAR；`generate:project-render-facts` → `verify:lighting-config` → `typecheck` → `test:server` → `verify:all`（预期 verify-spatial 5 error → 0）；5 灯派生锚点与 bbox 钉子测试见 `tests/server/lighting-anchor-migration.test.ts`。
- **决策人**：设计侧按已确立口径补全迁移；灯具选型/造型另案，本条不改任何灯的外观样式。

### DEC-2026-10-17-R20 水电点位深度 review 落地：西侧供电补齐、撞位/孤儿位清理、阳台照明与东墙保底取电

- **日期/来源**：2026-10-17 业主委托「全屋水电点位是否合理是否够用」深度 review；review 报告 5 项 P0 + 4 项建议经业主逐项拍板（保留 sock_living_water 改语义 / 阳台感应灯 / vanity 北移方案 A / 补夜灯中位 / 删 sock_parent_bed_l）后整包落地，2026-10-18 验收。配置内引用号统一 `DEC-2026-10-17-R20`。
- **本轮决定**（七组）：
  1. **新增 7 点位**：`sock_fridge_living` (7.20,3.30,h0.5，position_status pending 随冰箱厂家净空，#67)、`sock_waterbar` (7.20,3.90,h1.10,count3，水吧 S1+EM450+1 预留)、`sock_kitchen_east_counter` (10.80,0.65,h1.15,count2 带开关，东墙台面以上保底取电，#68)、`sock_weakbox` (13.40,3.15,h0.4，弱电箱电源/服务位，#72)、`net_master_ap` (2.80,6.00,h2.8，主卧吊顶 PoE AP 预留)、`light_balcony_dome` (6.60,1.15,h2.8，光控+人体感应吸顶灯无开关——东墙门洞 d_kit_balc 占 z[1.20,2.00] 后无完整墙垛容 86 底盒；balcony 无吊顶分区声明，贴原顶 2.80，#70/#71)、`night_living_mid` (11.68,4.80,h0.30，吸附 entry_half_height_cabinet 东脸北端，起夜链 6m 断链补点)。x=7.20 两点系墙线 7.10 东脸 0.10m 惯用偏移（同 ac_panel_dining 越墙 warning 口径）。
  2. **删除 2 点位**：`sock_kitchen_fridge`（superseded 死点退役；回路 `dedicated_kitchen_fridge` 成员重绑 sock_fridge_living，**id 保留历史名**）、`sock_parent_bed_l`（书房床头锚点随 2026-10-05 功能互换消失）。
  3. **撞位修正**：`switch_corridor` z4.10→4.22（与 `ac_panel_dining` 原同坐标同高重叠——两设备落同一底盒位置；三板行 3.98/4.10/4.22，距段南端 0.08m 贴角 warning 登记）；客卫 vanity 双联 z3.882/3.968→4.06/4.146（与 faucet_gbath_vanity (3.90) 横向拉开至 0.16/0.246m ≥0.15 自有口径）；`sock_kitchen_purifier`→(10.05,0.30,h0.4)（原与净水支路水柱同柱同高 0m 且未登记，迁后 0.55m）。
  4. **迁移重锚**：`sock_kitchen_dishwasher` x9.00→9.30（原点落洗碗机舱位 x[8.50,9.10] 机身投影内，违反「可徒手插拔、禁止藏机器背后」口径）；`switch_parent_bed`→(4.20,8.80,h1.3)、`ac_panel_parent`→(4.20,9.15,h1.3)（原「床头 h0.7」锚点随功能互换消失，双控第二站落书桌区上方）。
  5. **语义重写**：`sock_living_water`→回南天除湿机/吸尘器 utility 位（原饮水机服务对象迁水吧；南宁回南天为本项目已登记需求，东墙整条 run 仅此一个低位墙插，地插不适合除湿机常插）；`sock_parent_bed_r`→书桌下设备位。
  6. **毛巾架 C 方案 + 配套建模**：`sock_gbath_towel` (7.10,3.05,h1.2)→(5.60,3.925,h1.2) 挂 `w_gbath_west_open_vanity` 东脸——**推翻 DEC-2026-09-09-R3「东墙马桶上方」落位**，理由：①业主卫生观感否决「马桶上方挂毛巾」；②原位距淋浴区边界仅 0.25m 处 IEC 60364-7-701 2 区临界口径，迁后距马桶 AABB 1.1m、距玻璃屏 1.7m，口径整体消失。furnishings count-only `towel_set` 替换为 placed `heated_towel_rack`（新类型：FURNITURE_DIMS 0.55×0.10、梯式 y[1.05,1.80]、FixtureFactory recipe+单测、spatial-validation built_in_casework profile；rotation 90 朝向由 gate:visual 目验）。render overrides 补 `light_balcony_dome`/`night_living_mid` 两条（沿用 R12 锚点贴完成面口径）。
  7. **回路与路线联动**：ordinary_power_living +sock_waterbar/sock_weakbox（容量注记 ≈2.6kW）、ordinary_power_kitchen +sock_kitchen_east_counter、lighting_bedrooms_bath +light_balcony_dome、lighting_entry_base +night_living_mid、ordinary_power_parent_child −sock_parent_bed_l（回路数保持 20）；MEP 路线删 2 条旧位线（`strong-ded-fridge`、`strong-power-parent-child-parentbed-l`），4 条路线 via/to_height 跟随迁移（strong-light-bedrooms-parent-bed / strong-ded-bathheaters-gbath / strong-light-entry-switch-corridor / strong-ded-dishwasher）并在 reason 追加跟随声明；路线计数 130→128，`registered_conflicts` 51→50（删除路线带走 1 处降板登记冲突）。**新增 7 点的 MEP 走线未画**，属走线专项（与 verify:mep must-fix 存量清理同期，交底前必须闭合，见 pending_parameters）。
- **被本条推翻的旧结论**（逐条）：①「厨房插座数量达标（6–8 个）」——台面插座全在柜内 h0.3、取电形式押橱柜深化，不成立，故补东墙台面以上保底位；②「sock_living_water 服务饮水机」——饮水机概念 2026-10-16 已迁水吧；③「书房西墙中段 h0.7 是床头控制位」——床已迁客房；④「superseded 点位可留任回路成员与交底图」——sock_kitchen_fridge 退役；⑤ DEC-2026-09-09-R3「毛巾架马桶上方东墙」落位——理由见第 6 组；⑥「verify 全绿=点位合理」——本批 P0 全部位于 lint 盲区（无同坐标互斥、无灯具-房间覆盖、无 superseded-回路联动检查），为此 verify:electrical 新增三条检查：`point_coordinate_collision`（同坐标强电互斥，<0.05m/高差<0.15m，network 豁免）/ `furnishing_light_without_point`（ceiling_light 预算行必须有对应灯具点位）/ `circuit_member_dangling_or_superseded`（悬空成员 error、superseded error、blocked warning）。
- **实质内容 / 删除审计**：删除点位 2 个（sock_kitchen_fridge 的 superseded 历史、sock_parent_bed_l 的床头语义由 git 历史与本条保留要点）；count-only `towel_set` 行（普通毛巾杆预算占位，全仓无消费者）；两卫 `ceiling_light` 预算行 ×2（DEC-2026-10-12-R2 已裁两卫照明走浴霸三合一，属重复计数）；两条旧位路线。未删除任何候选商品、证据口径或竞品记录。
- **「X 不工作时」**：冰箱回路跳闸→仅冰箱失电（独立回路）；sock_waterbar 未激活→水吧电器无电（插线板过渡、不入交底）；阳台感应灯故障→厨房灯借光+晾衣区无照明（登记为已知取舍）；night_living_mid 感应失效→NP-5 与 light_corridor_1 兜底；光猫/交换机定案不在弱电箱→sock_weakbox 降级通用服务位；新 7 点无走线期间→点位均为预演值，交底前走线专项必须闭合。
- **静默失效条件**：①橱柜深化把东墙北段划给高柜/烟管→sock_kitchen_east_counter 失效需另找墙面；②冰箱厂家要求硬接线→sock_fridge_living type 与回路口径重定义；③毛巾架 SKU 宽>0.65m→退南墙东段 B 位（x[6.30,7.10]），SKU 接线端子直连→sock_gbath_towel 口径改预留接线盒；④阳台后做铝扣板→light_balcony_dome height 与 override 随完成面下调；⑤感应灯选型无常供电源型→回退普通灯+远端开关重走墙垛论证；⑥vanity 双联北移后若镜柜/龙头发水点变化→横向 ≥0.15m 需复算。
- **下一步责任**：走线专项（owner=设计侧，触发=交底前排期，覆盖新 7 点 + must-fix 存量）；#67–#72 量房/定标触发项（owner=业主/量房方/橱柜方/运营商，各自触发条件见台账行）。
- **验证**：`verify:furniture` OK、`verify:collision` OK、`verify:electrical` 0 error（新三检查上线，唯一命中为 sock_balcony_washer blocked warning 属预期口径）、`verify:consistency` 0 error/6 warning（新增 switch_corridor 贴角 warning 系登记口径）、`verify:rules` OK、`verify:spatial` 0 error、`gate:visual` CLEAR（重启 dev server 后四项哈希全对齐——旧 server config watch 失效静默，再证 playbook 先跑门禁的必要性）、`verify:mep` must_fix **166**（本批起点基线 224：其中 −58 为并行会话 R13–R19 走线清理与本批删线的合计效果，本批未新增 must-fix 类目）、`typecheck` 通过；`test:server`/`test:app` 基线既有环境性失败（jsdom ResizeObserver、three setRGB、TextureManager）与本批无关，本批相关的 pin/fixture 已同步（routes 128、census total 163/pending 30、mep-takeoff 计数）。
- **决策人**：业主拍板 5 项取舍（见日期/来源）；设计侧执行、验收与本文登记。

### DEC-2026-10-23-R01 回路计价基数补计竖直段：平面 union 保留、竖直下引/立管计入

- **日期**：2026-10-23。触发：预算计算链三路审计（2026-10-22）L1 发现——`shared/mep-takeoff.ts` 的回路计价基数 `circuitUnion` 只由 `unionPlanLength` 的 {x,z} 平面点算出，竖直段整体归零。
- **推翻/修正的旧结论**：`DEC-2026-10-07-M02` ①的计价口径「强电管 = Σ_回路 union(该回路画线路由)、导线 = union × 芯数 × 损耗」中 **union 的实现口径部分**。M02 的裁定本身（同回路平面去重、逻辑口径 Σ各条长度不得用于计价）**不推翻**；被修正的是实现把「平面并集」当成了「回路全长」：竖直下引与立管在平面投影是一个点，union 对它们不是去重、是删除。M04 已把纯竖直段纳入物理路由口径（声明层），但计价层未跟上，两层口径撕裂至今。
- **实测证据**：现行强电 70 条路由的竖直行程约 89m（两路独立探针互证 89/93m）；计价基数 256.55m 全部为平面量，导线总量 829.8m 建在其上，系统性低估约三分之一。模块内按 3D 长度算出的 `circuitConduit` 中间量只写不读、诊断口径的下引修正从未进计价，属于「诊断知道、计价没跟」。
- **新口径**：回路计价基数 = **平面 union + 竖直段**（`pricedCircuitLength`）。竖直段每回路独占、不跨回路去重；同一回路内多条路由共享同一根立管（同 x,z 纯竖直边）按 y 区间合并只计一次；带平面分量的斜边其 |Δy| 逐边计入。诊断字段保持原义：`strongPowerUnionPerCircuitM` / `strongPowerUnionAllM` / `drawnRouteUnionM` 仍为纯平面 union；`strongPowerTotalM`（报价卡 conduit_20 的取量）与 byCircuit 明细改按计价基数，与分桶一致。
- **数字变化（可复算）**：回路计价管长 256.55m → **342.72m**（竖直 +86.17m，同 x,z 区间合并后）；分桶线管 1.5mm² 82.9→106.94m、2.5mm² 150.2→206.42m、4.0mm² 23.5→29.36m；导线总量 829.8m → **1101.21m**（+32.7%）。按现行基线卡价折算约 +¥1,300——金额不大，但采购量短缺约 300m 导线的施工风险才是本条要堵的。
- **评审后修订（2026-10-23，PR #11 独立评审，编号不变）**：①**计价口径包含终端下引**——`include_terminal_drop` 开启时，路由终点标高 → 点位安装高度的下引段此前只进 drawn/layer 诊断长度，回路计价基数看不到（评审实测强电原始 0.95m、10 条路由/6 个回路）；现以终端点 (x,z) 处的纯竖直 stub 路径并入 `circuitPaths`，与路由竖直边一并走 y 区间合并，净计入 +0.75m。②**纯竖直路径平面分量为 0**——`pricedCircuitLength` 送平面 union 前剔除整条同 (x,z) 的退化路径：union 的 5cm 网格曾给退化路径栅格化出一个 cell（单测探针 2.30 vs 真值 2.25）；`unionPlanLength` 本体与诊断口径不改。本配置下退化路径的 cell 与同回路平面段端点 cell 重合，生产净影响为 0（评审「约 34 个位置累计 +1.70m」为无重合假设下的上界）。③**缺失标高 fail-closed**——`pricedCircuitLength` 入口校验全部点的 y，缺失/非有限数即抛错，删去竖直计算中的 `?? 0` 兜底（此前直接调用导出函数时缺 y 会静默出数）；「静默失效条件」中「新路径装配须同步保证标高来源」的防线由本函数自守。修订后数字：计价管长 342.72m → **343.47m**，导线总量 1101.21m → **1103.57m**（分桶线管 1.5mm² 107.09m、2.5mm² 207.02m、4.0mm² 29.36m）。
- **静默失效条件**：新路由的 via/端点缺 y（标高）时竖直分量静默为 0——生产路径由 `mepRoutePoints` 的 from/to_height 与 routeLength 的 fail-closed 保证 y 在位；若将来新增不经 routeLength 的路径装配，必须同步保证标高来源。
- **验证**：`pricedCircuitLength` 新增 6 个单测（纯竖直计入、混合路径、平面重叠仍去重、共享立管只计一次、异位下引各计、斜边 |Δy|、总量口径断言）；mep-takeoff / mep-quotes / budget-calculator / budget-api 测试全绿；`verify:facts` OK（104 warnings 与基线一致）；`verify:schedule` 通过。
- **关联文件**：`shared/mep-takeoff.ts`（pricedCircuitLength + 电路计价改基数）、`config/mep-takeoff.yaml`（计价口径注释同步）、`tests/server/mep-takeoff.test.ts`。
- **决策人**：业主（2026-10-23 指示修 bug）；设计侧执行与登记。
