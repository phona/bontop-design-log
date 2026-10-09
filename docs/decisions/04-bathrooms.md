# 决策日志 · 卫浴

> 本文件是 `docs/decision_log.md` 2026-10-09 主题拆分（DEC-2026-10-09-S01）的产物：
> 收录范围 = 主卫隔墙北移与台盆外置、客卫南墙/台盆柜/扫地机基站/门铰链、洁具选型与饰面终裁。条目为原文件的连续切片，正文未改写；文件内按时间正序。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-08-21-036` 主卫布局纠正：台盆外置贴东墙（业主原意）
- `DEC-2026-08-21-037` 主卫终版：隔墙累计北移0.9 + 卫门推拉 + 东墙1.25m柜带
- `DEC-2026-08-21-038` 主卫终版纠正：台盆柜带改隔墙外侧（东墙路线证伪）
- `DEC-2026-08-21-039` 主卫终终版：照样板间恢复6.5㎡、内部左右分离、条带改存储区
- `DEC-2026-08-25-043` 主卫台盆外移至套间条带（干湿分离，第一版）
- `DEC-2026-08-29-048` 客卫南墙北移、外置洗漱及南北串联布局
- `DEC-2026-08-29-049` 客卫马桶按真实模型 AABB 南移并避让外门扫掠
- `DEC-2026-09-07-054` 客卫改整面固定玻璃 + 西端开敞入口（取消铰接玻璃门）
- `DEC-2026-09-07-R11` 主卫东墙底柜收深并贴西完成面
- `DEC-2026-09-09-R1` 扫地机器人基站预留（客卫台盆下主位 + 客厅备用；阳台方案否决回滚）
- `DEC-2026-09-09-R2` 客卫镜柜登记（台盆上方储物主层，替换台盆内置平镜）
- `DEC-2026-09-09-R3` 客卫门铰链改西侧 + 电热毛巾架迁马桶上方
- `DEC-2026-09-09-R4` 客卫门洞东移 0.10m（修 R3 引入的门叶穿模）
- `DEC-2026-09-09-R5` 客卫台盆柜改悬空 + 扫地机基站模型泊入
- `DEC-2026-09-09-R6` 客卫台盆下水定案墙排 + 基站按云鲸 J6 实尺寸收紧
- `DEC-2026-09-09-R7` 客卫台盆柜加深至 0.50m（全藏台下基站）
- `DEC-2026-10-05-R3` 浴霸设备锚点定案与卫浴回路拆分
- `DEC-2026-10-05-R12` 卫浴洁具目标下调归档（花洒/客卫浴室柜）
- `DEC-2026-10-07-R02` 卫浴 PKG-100 第二次收口：主卫柜先入账 1,500 + 花洒降档 + 玻璃屏归属定案 + 条带定制柜划归二期

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-08-21-036 主卫布局纠正：台盆外置贴东墙（业主原意）

- **日期**：2026-08-21
- **决策事项**：纠正 DEC-035 第③项。业主原意=隔墙北移 0.5 做干湿分离、台盆**外置**贴东墙干区；DEC-035 误实现为台盆入湿区
- **选定方案**：隔墙 z=4.3→3.8；湿区 2.6×2.7 只留马桶+淋浴（淋浴 z=2.6）；台盆 (3.95,4.25) rot270 贴 w_strip_east 门洞以南 0.8 墙段，面朝西，镜挂东墙；给水/插座改挂 w_strip_east；灯开关回隔墙内侧 (2.40,3.75)；走廊深 1.75（薄柜可入走廊南墙）
- **决策依据**：干湿分离保留（DEC-019 初衷）+ 进门顺手洗手；东墙台盆位需墙北移 0.5 才腾出（门洞占东墙北段），DEC-035 的 0.3 上限仅适用于台盆入内变体
- **预算影响**：同 DEC-035（拆改/防水待决算）
- **关联文件**：model-geometry.yaml、house.yaml、plumbing.yaml、electrical.yaml
- **决策人**：业主

### DEC-2026-08-21-037 主卫终版：隔墙累计北移0.9 + 卫门推拉 + 东墙1.25m柜带

- **日期**：2026-08-21
- **决策事项**：在 DEC-036 基础上再腾挪，参照开发商创想图（survey/photos/9a8d1ce…jpg 主卫双台盆+浴缸高配样板的台盆沿墙柜带意向）
- **选定方案**：隔墙 z=3.8→3.4（累计北移0.9）；d_mbath 改 sliding_door（消除门摆，湿区2.6×2.3容马桶+淋浴）；台盆 (3.95,4.25) + 南侧侧柜0.4m（shelf 覆盖尺寸）共1.2m柜带贴东墙，镜柜挂东墙；灯开关 (2.40,3.35)；走廊深2.15
- **决策依据**：业主"再腾挪+打柜子"诉求；东墙墙段 [3.4,4.65]=1.25m 为门洞以南极限；推拉门是再北移的唯一解锁项
- **代码联动**：CollisionDetector 门洞间隙过滤纳入 sliding_door（第一人称可进主卫）；project-catalog 测试门过滤同步
- **预算影响**：推拉门入 doors_windows 池（待决算核价）
- **关联文件**：model-geometry.yaml、house.yaml、electrical.yaml、app/src/scene/CollisionDetector.ts、tests/server/project-catalog.test.ts
- **决策人**：业主

### DEC-2026-08-21-038 主卫终版纠正：台盆柜带改隔墙外侧（东墙路线证伪）

- **日期**：2026-08-21
- **决策事项**：纠正 DEC-037 的东墙柜带——东墙门洞以南实际仅0.35m（儿童房南墙 z=4.3 卡死台阶区，1.25m 墙段不存在）；DEC-037 摆位使台盆跨墙伸入儿童房，3D 穿帮
- **选定方案**：d_mbath 推拉门西移（洞[0.1,0.9]）；隔墙外侧腾出1.7m连续墙段（x0.9–2.6）：台盆0.8居中(1.70,3.65)+左右侧柜0.4/0.5，镜柜挂隔墙，面朝北（走廊）；给水/插座穿隔墙(1.70,3.45)；灯开关湿区内(1.10,3.35)；台阶区（1.6×0.9）留儿童房作弹性空地
- **决策依据**：几何硬约束（儿童房不可缩）；隔墙外侧柜带为唯一≥1.5m柜带；与创想图"沿墙台盆柜"意向一致
- **教训**：连续改墙未重核东墙实际墙段长度，两次摆位基于不存在的墙段；今后动墙后先输出墙段清单再摆家具
- **关联文件**：model-geometry.yaml、house.yaml、plumbing.yaml、electrical.yaml
- **决策人**：业主

### DEC-2026-08-21-039 主卫终终版：照样板间恢复6.5㎡、内部左右分离、条带改存储区

- **日期**：2026-08-21
- **决策事项**：业主核实样板间（开发商创想图）后定案，推翻 DEC-035~038 的隔墙北移系列
- **选定方案**：
  - 隔墙回 z=4.3，主卫恢复 6.5㎡ 全尺寸；不要浴缸
  - 内部左右分离：西端湿区 x[0,1.2]（淋浴，花洒挂南墙朝北——西/北为玻璃不可挂，玻璃隔断 x=1.2），东侧干区（台盆0.8贴东墙 z[2.4,3.2]+镜柜，马桶东墙原位）
  - d_mbath 推拉门南墙 [1.3,2.1]，进门即干区
  - 条带 z[4.3,5.55] = 主卧存储区：隔墙外侧1.7m存储柜带（原 bath_side_cabinet 两件转存储用），过道0.75
- **决策依据**：样板间实证；6.5㎡ 左右分离比 2.3m 深上下分离更从容；存储区补齐主卧收纳
- **预算影响**：淋浴玻璃隔断入 sanitary/淋浴房项；拆改费归零（隔墙不动原位置）
- **关联文件**：model-geometry.yaml、house.yaml、plumbing.yaml、electrical.yaml
- **决策人**：业主

### DEC-2026-08-25-043 主卫台盆外移至套间条带（干湿分离，第一版）

- **日期**：2026-08-25
- **决策事项**：主卫台盆外移至套间条带做干湿分离；主卫南隔墙再北移 0.4m（z 3.26→2.86），主卫 2.60×1.76≈4.58㎡；条带设洗漱+梳妆一体区
- **选定方案**：
  - 隔墙 w_mbath_south 北移至 z=2.86（v_mb_sw/v_mbath_se 同步）；d_mbath 洞位不变（[1.15,1.95]，墙平行移动沿墙 offset 不变），门扇扫掠 z∈[2.06,2.86] 与马桶 z=1.5 不冲突
  - 卫内只留马桶+淋浴（湿区 x[0,1.2] 玻璃隔断南端收至 z=2.26，留 0.6m 入口；花洒随墙 z=2.76，地漏随移至 z=2.20）
  - 台盆为新 fixture 类型 `vanity_dresser`（洗漱+梳妆一体台 1.0×0.5：左半台上盆+镜柜、右半梳妆位+平板镜，台面通长）@(0.575,3.16) rot0 贴新隔墙南脸、门洞西侧；bath_entry_shelf 已移除，收纳并入一体台台下柜+镜柜
  - 水电：faucet_mbath_vanity/新增 drain_mbath_vanity（墙排 h0.35）对齐盆心 (0.325,2.96)，sock_mbath_vanity (0.65,2.96)，墙排穿墙回主卫沉箱接原立管；switch_mbath 随墙 (1.10,2.91)；light_mbath_panel 移卫内中心 (1.3,1.98)
- **决策依据**：邻居 YS01 原始结构图（survey/neighbor_ys01_original_structure_2025-06.png）推算尺寸；干湿分离为 DEC-019 以来一贯方向
- **状态**：方向已定、全部尺寸待交房量房确认（需量：下沉 300 分界线、立管/坑距、条带净深、墙体承重属性）
- **最终形态（2026-08-25 业主确认收口）**：条带西段整段为洗漱梳妆区——vanity_dresser 一体台满墙 1.10×0.5（x∈[0,1.10]，东留 0.05 收边缝；台盆 0.5 居西、梳妆位尽量宽）+ 东侧半墙（wall_run h1.05，需碰撞）上部长虹玻璃屏风（shower_screen sill1.05→2.10）@x=1.11，与 d_mbath 门洞[1.15,1.95]及卫内扫掠不冲突；vanity_tall_cabinet 已取消（业主要台面宽裕，储物扩展将来用次卧那面墙）、bath_entry_shelf 已移除；plant_fiddle 挪至次卧西墙（x=2.6 主卫东墙南延段）旁条带一侧 (2.30,3.55)（⚠️业主口径 x≈2.85~2.95 在墙东侧次卧内，与书桌/衣柜冲突，取墙西侧），避开 d_mb 扫掠
- **预算影响**：隔墙拆建+防水重做入拆改/防水池（待决算）；洁具数量不变
- **关联文件**：config/layout/model-geometry.yaml、config/layout/overlay.yaml、config/house.yaml、config/plumbing.yaml、config/electrical.yaml、config/mep-hvac-coordination.yaml、app/src/render/FixtureFactory.ts（vanity_dresser 配方；bath_entry_shelf/vanity_tall_cabinet 配方均已删除）、shared/types.ts（FURNITURE_DIMS）、config/design-rules.yaml（furnishingTypeToTopic）、server/budget-calculator.ts、app/src/scene/collision-utils.ts（wall_run 纳入碰撞）、scripts/verify/collision/verify-collision-coverage.ts
- **决策人**：业主（方向）；尺寸全部待量房终核
- **补充（2026-08-26）**：
  - 新增梳妆椅 `chair @(0.80,3.66) rot180`（收进时背贴台面、对镜朝北；椅后通道至衣柜北脸余 1.6m+，不挡动线）；verify:furniture 通过
  - 上下水距离实测口径（业主问"此处上下水多远"存档）：排水=墙排点 (0.26,2.96) 穿隔墙即进主卫沉箱，沉箱内接淋浴地漏支管 (0.60,2.20)，约 0.8m；给水=沿隔墙暗埋约 2.3m 接原台盆/马桶给水源点（x=2.60 东墙）；排水近、给水沿墙走管为常规做法，无硬障碍
  - 业主评审 v3 图后"先这样吧"定稿；拥挤感处理项登记：若量房后仍觉局促，可将一体台 1.1m 缩 0.9m 或绿植南移留空
  - **否决方案存档：一体台放次卧那面墙（z=4.30 次卧南墙段，x∈[2.6,4.2] 免门洞 1.6m）为何不取**：
    1. 防水：该处为普通楼面（下沉:50），不在沉箱范围，须专门做一块防水（地面约 1.5×1m + 次卧隔墙上翻 ≥1.2m + 闭水试验），等于在远离原防水体系处新增湿点，渗漏则泡次卧；现位置背靠主卫沉箱，防水/排水都是最小改动（行业惯例"外移台盆贴原卫生间外墙"即为此）
    2. 排水：须多走 ≥1.4m 才能进主卫沉箱，坡度/检修/渗漏风险均劣于现位（现位穿墙 0.8m 内接支管）
    3. 净距：台面深 0.5m 后面板至 z≈4.8，距衣柜北脸（z≈5.55）仅约 0.75m < 0.8m 通道底线，梳妆坐下更局促
    4. 噪音：水管走次卧隔墙，冲水声贴次卧墙体
    另：垂直贴西侧亦不可行——西侧为玻璃幕墙，按铁律不能挂镜柜/台盆

---

### DEC-2026-08-29-048 客卫南墙北移、外置洗漱及南北串联布局

- **日期**：2026-08-29
- **决策事项**：替代此前“东墙内置洗漱台”的开放式方案；客卫南墙北移，洗漱区移至南墙外/走廊侧，内卫按南马桶、北淋浴串联布置。
- **选定方案**：`w_gbath_south` 及其内卫两端 `v_nw_s`/`v_gbath_se` 位于 `z=3.55`，保留南侧外门 `d_gbath` 宽 0.7m、内开、端部合页并随墙移动；客卫内边界为 `x=5.60..7.10,z=2.20..3.55`，内卫深度约 1.35m。东西墙分别由 `w_gbath_west`/`w_gbath_east` 延伸段 `w_gbath_west_open_vanity`/`w_gbath_east_open_vanity` 沿原南北走向延伸至 `z=4.30`，东侧开放墙段长度 `4.30-3.55=0.75m`，延伸段不计入 guest_bath boundary。南侧 `z=3.55..4.30` 保持朝走廊开放，不新增第四面横墙。洗漱台中心暂定 `(6.90,3.90)`、尺寸 `0.8×0.4`、`rotation=270`，背靠东墙、正面朝西；旋转后 AABB 为 `x[6.70,7.10]、z[3.50,4.30]`，南端不越过 `z=4.30`。马桶靠东墙中心 `(6.80,2.65)`、`rotation=270` 坐东朝西；按 `FURNITURE_DIMS` 旋转后 AABB 为 `x[6.50,7.10]、z[2.45,2.85]`，贴近隔断南侧并避开外门扫掠；淋浴花洒挂东墙 `(7.10,2.45)`、`wall_side=west` 坐东朝西，地漏 `(6.30,2.45)`；横向 `shower_screen_gbath` 位于 `z=2.80`、`x=7.10..6.30`，西侧 `x=5.60..6.30` 留约 0.70m 西侧开放入口，禁止东侧入口。当前 schema 只有 `shower_screen` 缺口表达，没有真正平开玻璃门扇；如需门扇需新增专用支持，不能将现有缺口称作玻璃门。
- **决策依据**：不新增实体内墙或内部门；仅恢复客卫东西侧南北向墙体至开放洗漱区南端，南侧不封横墙。当前模型删除历史窗洞占位，按完整实体东墙处理；南墙实体性、外置洗漱台落位和墙体条件仍需现场核实。外置洗漱采用落地/靠墙方案，南侧靠东墙，背面朝东、正面朝西；中心向东避让外门扫掠。校验规则要求 placed furnishing 不越过房间边界，故 `house.yaml` 保留与开放洗漱区一致的声明式设计意图。
- **预算影响**：取消此前东墙内置洗漱的挂墙镜柜表达；保留洗漱台、给排水和插座需求，新增/调整穿南墙及南墙外收口费用待深化确认。
- **现场待确认**：南墙实体材质与可挂载性、外置台盆落位及给排水穿墙方式；东墙实体墙材质与挂载条件；南侧外门开启净空；原立管与马桶坑距；淋浴防水高度、玻璃屏入口、地漏坡度及排风路径。
- **关联文件**：`config/layout/model-geometry.yaml`、`config/layout/overlay.yaml`、`config/house.yaml`、`config/plumbing.yaml`、`config/electrical.yaml`
- **决策人**：业主

---

### DEC-2026-08-29-049 客卫马桶按真实模型 AABB 南移并避让外门扫掠

- **日期**：2026-08-29
- **决策事项**：修正 DEC-048 中仍沿用的客卫马桶旧中心 `(6.80,2.65)`；该位置按 FixtureFactory 真实局部 union 经 270° 旋转后 AABB 为 `x[6.525,7.075]、z[2.45,2.85]`，北缘越过玻璃隔断 `z=2.80` 进入淋浴区约 0.05m。
- **选定方案**：马桶中心调整为 `(6.75,3.05)`、`rotation=270`，真实模型 AABB 为 `x[6.525,7.075]、z[2.85,3.25]`；北缘距玻璃隔断 0.05m，东缘距东墙 0.025m。东墙实体段保持挂载，马桶坐东朝西；同步给水与智能插座至东墙 `x=7.10,z=3.05`，地漏调整至 `(6.45,3.05)`。南墙外门 `d_gbath` 仍内开，洞口西移为 `x[5.60,6.30]`（resolver offset=0.35），不移动西侧玻璃入口，不新增实体隔墙。
- **决策依据**：以 FixtureFactory 实际 union/AABB 为准，不采用旧注释或仅按名义尺寸判断；verify-furniture 对门扇扫掠和房间边界均通过。
- **关联文件**：`config/house.yaml`、`config/layout/model-geometry.yaml`、`config/plumbing.yaml`、`config/electrical.yaml`、`docs/dressing-map.md`
- **决策人**：业主

---

### DEC-2026-09-07-054 客卫改整面固定玻璃 + 西端开敞入口（取消铰接玻璃门）

- **日期**：2026-09-07
- **决策事项**：客卫淋浴/马桶横向分隔（z=2.80）由"0.80m 固定玻璃 + 0.70m 铰接玻璃门"改为**整面固定玻璃、无门**，西端 x[5.60,6.30] 保持 0.70m 开敞入口；不追求淋浴区与马桶区完全隔离。
- **可选方案**：①保留铰门；②改移门；③整面固定玻璃+开敞入口；④屏体南移加大淋浴净深后加门。
- **选定方案**：③。
- **决策依据**：业主提出降成本与降低水垢维护（门铰链/密封条为水垢重灾区）；淋浴净深 0.60m 内 0.70m 铰门最多开启约 59°，本就难以全开，无门后进出反而顺畅；浴帘级封闭对使用体验提升有限。
- **预算影响**：淋浴房五金（铰链/拉杆/密封条）减少，约省 300-800 元，计入 appliances 池淋浴房科目口径，不单独调科目。
- **关联文件**：`config/layout/overlay.yaml`（删 gbath_west_glass_door）、`config/house.yaml`（客卫 notes/furniture_concept）、`app/src/render/HouseScene.ts`（审计图改画开敞入口虚线）、`tests/server/overlay-merge.test.ts`、`app/src/render/HouseScene.test.ts`
- **决策人**：业主

### DEC-2026-09-07-R11 主卫东墙底柜收深并贴西完成面

- **日期**：2026-09-07
- **起因**：真实场景复核发现 `mb_vanity_base_cabinet` 深度仍为 0.625m，SceneBuilder 未套用墙体完成面偏移，导致柜体及踢脚、门缝子构件东缘进入 `w_mbath_east` 墙中心 x=2.60；该墙结构为 inferred shear，不允许嵌墙。
- **选定方案**：保持 `wall=w_mbath_east`、`wall_side=west`、`rotation=270`、`along=3.45` 和沿墙长度 1.70m；总深收至 0.565m，与上下悬浮板统一。墙锚点统一采用 0.06m 完成面偏移，运行时中心 x=2.2575，底柜与全部子part AABB 为 x[1.975,2.54]、z[2.60,4.30]、y[0,0.62]。FixtureFactory 柜体、踢脚和门缝局部 +z 面同步按新半深度贴合。
- **材料/采购**：`cabinet_board_01` 记录主卫底柜 1.70×0.565×0.62m，现场复尺后下单；未改变既有板材/PET 门材质或价格待定状态。
- **验证**：新增真实 `buildScene` 递归子part AABB 断言，验证底柜与每个子构件不越过西完成面、不进入墙体/主卫侧；浏览器从主卫侧和主卧侧各取正常态证据。完整验证命令按本轮回填。
- **现场待确认**：东墙完成面、门套/门洞实际收口和定制柜复尺；墙体结构与防倾倒节点继续 site_pending。
- **关联文件**：`config/house.yaml`、`config/materials.yaml`、`config/procurement.yaml`、`shared/types.ts`、`shared/render/FixtureFactory.ts`、`shared/render/SceneBuilder.ts`、`scripts/verify/placement/verify-furniture-placement.ts`、`tests/server/master-bedroom-dressing.test.ts`、`tests/server/shared/scene-builder.test.ts`、`docs/design-iterations/master-bedroom-r7-20260906/`、`docs/design-iterations/master-condensate-l-route-20260907/`、`data/project-render-facts.json`
- **决策人**：业主（复验问题）；施工尺寸待现场复尺

### DEC-2026-09-09-R1 扫地机器人基站预留（客卫台盆下主位 + 客厅备用；阳台方案否决回滚）

- **日期**：2026-09-09
- **起因**：业主评估全屋用电时确认扫地机器人（防尘策略主力设备）无用电/上下水规划；要求点位合理、使用方便、美观。
- **方案演进**：① 初答"双预留"（生活阳台自动上下水 + 客厅电视柜底格手动版）并已短暂落盘；② 业主补充硬约束"厨房-阳台门不能常开"——阳台路线机器人被困，否决；③ 重审全屋有水且无门阻隔的位置，定案客卫洗漱台下。
- **选定方案**：主位客卫洗漱台下方（sock_gbath_robot，(7.05,4.10) h0.3 东墙低位常插带防溅盒；进水由 faucet_gbath_vanity 三通、排水接台盆下水；台盆柜改悬空/无底开放格（净高≥0.5m、进深≥0.5m）藏基站，家具深化落实；洗漱区南缘开放无门，机器人自由进出）；客厅电视柜底格电位保留备用（sock_living_robot，手动换水版美观位）；阳台预留（sock_balcony_robot+三通/地漏注记）全部撤销，配置无残留。
- **回路**：sock_gbath_robot 并入 ordinary_power_service，sock_living_robot 并入 ordinary_power_living；回路数/容量断言不变（普通电源 37 成员）。
- **验证**：verify:all 0 error；test:server 540 pass；test:app 448 pass；typecheck 干净；运行时坐标复核与台盆区改后截图取证。
- **现场待确认**：客卫台盆下水路由（既有口径）、基站机型尺寸、台盆柜悬空改造节点；量房终核。
- **关联文件**：config/electrical.yaml、config/plumbing.yaml、config/electrical-topology.yaml、config/house.yaml、docs/design-iterations/robot-dock-reservation-20260909/
- **决策人**：业主（方案对齐后拍板）

### DEC-2026-09-09-R2 客卫镜柜登记（台盆上方储物主层，替换台盆内置平镜）

- **日期**：2026-09-09
- **起因**：扫地机基站藏客卫台盆下需台盆柜改悬空/无底，损失落地柜少量收纳；业主问"台盆上方储物能否充分利用"，确认镜柜方案（"先一"：只做镜柜，顶柜/层板暂不做）并担心小空间压抑——体量块 A/B 取证后确认镜柜不压抑（门面即镜面）。
- **选定方案**：新增 mirror_cabinet_gbath（0.70宽×0.90高×0.14深，y[1.10,2.00]，挂 w_gbath_east_open_vanity 西完成面，沿墙居中台盆轴 3.925）；vanity 配方移除内置平镜避免双镜；镜柜下沿与台盆双联插座（h1.0）留 0.057m 错层。
- **发现既有口径**：materials.yaml/procurement.yaml 早有"浴室柜组合（含镜柜）"两套报价，本次是把镜柜补进 3D 模型对齐；注意报价 spec 写 80cm 而模型台盆宽 0.70m——规格漂移登记为柜体深化 follow-up。
- **验证**：verify:all 0 error（镜柜×台盆堆叠豁免按 range_hood/kitchen_cabinet_run 同口径入 STACKED_PAIRS；镜柜条目置于 guest_bath placed 末尾保持既有 GLB 节点序号）；test:server 540 pass；test:app 448 pass；typecheck 干净；截图取证 tmp/screenshots/electrical-audit/guest_bath_mirror_cabinet_after_r2.png。
- **关联文件**：shared/render/FixtureFactory.ts、shared/types.ts、config/house.yaml、scripts/verify/placement/verify-furniture-placement.ts、app/src/render/FixtureFactory.test.ts、docs/design-iterations/robot-dock-reservation-20260909/
- **决策人**：业主

### DEC-2026-09-09-R3 客卫门铰链改西侧 + 电热毛巾架迁马桶上方

- **日期**：2026-09-09
- **起因**：业主发现客卫门（d_gbath，内开铰链东缘 x=6.30）两个真实冲突：① 开门 90° 门叶立于 x=6.30 挡死马桶动线（叶尖距淋浴玻璃隔断仅 0.05m，不关门进不到马桶）；② 门叶扫掠半径 0.70m 覆盖西墙毛巾架（架最近点距铰链 0.62m），开约 30° 即撞。
- **选定方案（业主拍板 A）**：铰链改西缘（hinge: end→start），内开不变——开门后门叶贴西墙 z[2.85,3.55]，马桶动线（距扫掠区最近 0.97m）、淋浴隔断、门口全部让开；电热毛巾架及插座 sock_gbath_towel 迁马桶上方东墙 (7.10,3.05) h=1.2（与 sock_gbath_toilet h0.3 同柱错层；带防溅盒）。否决项：外开（占洗漱区/盖 switch_gbath）、推拉门（成本与隔音，业主未选）。
- **验证**：verify:all 0 error；test:server 540 pass；test:app 448 pass；typecheck 干净；运行时确认门叶 @(5.600,1.050,3.200) rotY=90° 贴西墙、sock_gbath_towel @(7.025,1.200,3.050) 马桶上方东墙。
- **现场待确认**：毛巾架实体尺寸与安装净空（马桶上方）、门套角部收口（铰链在西缘角柱），量房终核。
- **关联文件**：config/layout/model-geometry.yaml、config/electrical.yaml、config/house.yaml、docs/design-iterations/guest-bath-door-hinge-20260909/
- **决策人**：业主

### DEC-2026-09-09-R4 客卫门洞东移 0.10m（修 R3 引入的门叶穿模）

- **日期**：2026-09-09
- **起因**：R3 铰链改西缘后，门洞西缘顶着墙角（x=5.60 即西墙），渲染器"90° 开门贴墙"简化模型把门叶中心落在西墙中线上——门叶 x[5.58,5.62] 完全嵌入墙体（x[5.54,5.66]），视觉上消失（业主发现并报告"门不见了"）。
- **选定方案（业主拍板）**：门洞整体东移 0.10m 至 x[5.70,6.40]（offset 0.35→0.45），铰链留西缘 x=5.70——门叶 @(5.70,3.20) 贴西墙内侧可见（AABB x[5.68,5.72] 脱出墙体），并获得 0.10m 门垛便于门套角部收口；马桶侧扫掠净距仍有 0.125m。否决项：改渲染器感知角部墙体（动 SceneBuilder 共享代码+补测试，为唯一角部铰链门不划算）。
- **影响面**：门洞与淋浴隔断 0.7m 开敞入口错开 0.10m（两者均 ≥0.7m 宽，通行不受影响）；无其他点位/家具引用该门洞位置。
- **验证**：verify:all 0 error；test:server 540 pass；test:app 448 pass；typecheck 干净；运行时 AABB 复核门叶脱出墙体；截图 tmp/screenshots/electrical-audit/guest_bath_door_visible_after_r4.png。
- **关联文件**：config/layout/model-geometry.yaml、docs/design-iterations/guest-bath-door-hinge-20260909/
- **决策人**：业主

### DEC-2026-09-09-R5 客卫台盆柜改悬空 + 扫地机基站模型泊入

- **日期**：2026-09-09
- **起因**：业主希望在 3D 模型里直观看到客卫台盆下藏扫地机基站的形态（R1 已定点位与上下水，台盆柜悬空改造本是家具深化 follow-up）。
- **选定方案**：vanity 配方由落地柜改悬空抽屉柜（柜体 y[0.55,0.79]，底缘以下留空）；新增 robot_dock_gbath 模型（0.45×0.45 底座 + 0.42 高背塔贴东墙 + 0.34 直径机器人圆盘泊于西侧泊口），落位 (6.815,3.925) rotation=270；基站电源 sock_gbath_robot 按设计藏背塔后常插；台盆柜台面/盆/尺寸不变。
- **验证**：verify:all 0 error（vanity↔robot_dock、mirror_cabinet↔robot_dock 两对竖向叠放按既有口径入 STACKED_PAIRS 豁免；GLB 节点序号 vanity:0/toilet:1/exhaust_fan:2 保持，基站 :4 追加）；test:server 540 pass；test:app 448 pass；typecheck 干净；运行时复核 furniture:guest_bath:robot_dock_gbath:4 @(6.815,0,3.925)；截图 guest_bath_vanity_dock_after_r5.png / guest_bath_dock_closeup_after_r5.png。
- **现场待确认**：悬空柜挂墙节点（该墙为延伸实体墙，挂载按现场复核口径）、基站机型最终尺寸。
- **关联文件**：shared/render/FixtureFactory.ts、shared/types.ts、config/house.yaml、scripts/verify/placement/verify-furniture-placement.ts、docs/design-iterations/robot-dock-reservation-20260909/
- **决策人**：业主

### DEC-2026-09-09-R6 客卫台盆下水定案墙排 + 基站按云鲸 J6 实尺寸收紧

- **日期**：2026-09-09
- **起因**：① 业主问"悬浮台下水怎么办"——悬浮柜+台下基站不允许地面走管；② 业主选定云鲸 J6 上下水版（0.41宽×0.4335深×0.198高，无水箱塔），原按 0.45×0.45×0.5 的预留过宽。
- **选定方案**：下水走墙排——下水器柜内转 90° 穿 w_gbath_south 回内卫沉箱/排水系统（地面零管道，与主卫台盆既有口径一致），新增 drain_gbath_vanity 穿墙点（(6.90,3.55) h=0.3，避 d_gbath 门洞 x[5.70,6.40]）；基站模型按 J6 实尺寸重做（低矮底座+背沿+机器人圆盘），悬空柜底缘由 0.55 降至 0.30（抽屉柜加深至 0.49m，收纳回升）；过程中修复圆柱体配方 size[0] 为半径的误用（机器人一度渲成 0.68m 宽穿墙）。
- **验证**：verify:all 0 error；test:server 540 pass（cli-glb  plumbing 计数 18→19）；test:app 448 pass；typecheck 干净；截图 guest_bath_dock_j6_after_r6.png。
- **现场待确认**：沉箱/立管位置与穿墙套管、坡度（水电交底）；J6 实机到货复核柜格净空。
- **关联文件**：config/plumbing.yaml、shared/render/FixtureFactory.ts、shared/types.ts、config/house.yaml、scripts/verify/placement/verify-furniture-placement.ts、tests/server/cli-glb-export.test.ts、docs/design-iterations/robot-dock-reservation-20260909/
- **决策人**：业主（机型选定）；施工尺寸待量房与水电交底

### DEC-2026-09-09-R7 客卫台盆柜加深至 0.50m（全藏台下基站）

- **日期**：2026-09-09
- **起因**：业主问"深度足够隐藏吗"——0.40m 柜深下 J6 基站托盘前缘探出柜面约 0.09m、机器人约 0.11m（微露）；业主权衡后拍板加深全藏。
- **代价确认（已与业主对齐）**：0.50m 即成品浴室柜标准进深，金钱成本≈0；洗漱区站立净深 1.10→0.94m（单人客卫够用）；镜柜距离 +0.1m（轻微）；悬空柜挂墙力矩增大，挂墙节点需钢架/加强螺栓（并入该墙挂载现场复核项）。
- **选定方案**：vanity 柜深 0.40→0.50，背贴东墙完成面（x=7.04），中心 x=6.90→6.79，正面朝西不变；柜前沿 x=6.54，基站托盘/机器人全没入柜下（机器人前缘内收柜沿 0.05m）；龙头墙挂不变。
- **验证**：verify:all 0 error（vanity 背缘不再进入墙体 slab，比原 0.40 深贴中心线口径更干净）；test:server 540 pass；test:app 448 pass；typecheck 干净；截图 guest_bath_vanity_deep50_after_r7.png。
- **现场待确认**：悬空柜挂墙节点（钢架/螺栓）+ 该延伸墙实体性量房复核。
- **关联文件**：config/house.yaml、shared/render/FixtureFactory.ts、shared/types.ts、docs/design-iterations/robot-dock-reservation-20260909/
- **决策人**：业主

### DEC-2026-10-05-R3 浴霸设备锚点定案与卫浴回路拆分

- **日期**：2026-10-05。
- **设备定标**：凉霸不做；浴霸业主定标自购**奥普 S2-Air ×2**（风暖 2750W + 换气 49W + 照明 24W 三合一，集成吊顶式、线控面板；京东自营 SKU 100205465310，国补备案型号，补贴到手 680.97/台，2026-10-05 页面观察、非成交价），两台 ≈1,362、目标 1,500（含配件余量），定入 `schedule/phase-1/control.yaml` 的 `COST-100-06`（ownership_pending → candidate）。下单窗口在量房与扣板开孔方案冻结后。
- **归属与账目**：浴霸/凉霸从 PKG-070 捆绑报价 9,537（QR-2026-10-03-08）划出，登记 QR-2026-10-05-01（supersedes）；PKG-070 estimated_need 23,037 → 18,000（铝扣板裸价目标 4,500 为反推值，商家重报待取得）；COST-070-03 planned 9,537 → 4,500；PKG-070 对父包口径缺口由 ≈6,000 收窄到 ≈1,000。
- **电气拆分**：`config/electrical-topology.yaml` 的 `dedicated_bath_heaters`（两卫共路 C20A）拆为 `dedicated_bath_heater_mbath` / `dedicated_bath_heater_gbath` 每卫一路 C20A+漏保（两台风暖同开 ≈5.6kW 不可共路，GB 55038 7.4.4）；容量口径 ≈2.5kW → ≈2.8/2.9kW；回路总数 20 → 21（`fact.circuit_count` 派生随之），`config/acceptance.yaml` 箱体/分路/漏保条款同步 21 路口径，390mm 箱体双排结论不变（pending-site-data #30 继续跟踪）。
- **点位合并**：`config/electrical.yaml` 原独立排气点位 `sock_mbath_exhaust`/`sock_gbath_exhaust` 并入浴霸点位 `sock_mbath_batheheater`（1.30,2.70，原位保留）/`sock_gbath_batheheater`（6.30,2.95，自原排气位南移避开淋浴区正上方）；点位总数 98 不变（`fact.electrical_points_count` 口径不变）；线控面板与两卫照明开关同墙并排预埋，面板点位随设备定案补登。`config/mep-hvac-coordination.yaml` 两条卫浴电源路由的终点/分支描述随改。
- **反转条件**：收房发现开发商场已预留取暖换气设备；S2-Air 面罩开孔尺寸与所选扣板系统不匹配；国补额度失效。
- **未做**：同档竞品比价未跑（采纳为首选前须按 shopping-research 流程补）；洗碗机等家电品类归属见 `schedule/procurement.md` §07 与 phase-scope 排除项。

### DEC-2026-10-05-R12 卫浴洁具目标下调归档（花洒/客卫浴室柜）

- **日期**：2026-10-05。
- **下调**：花洒 2,600 → 2,000（千元级恒温档，京造/九牧/恒洁同档待选型，供水侧与水伺服热水器兼容）；浴室柜 6,000 → 5,000（主卫 3,000 保留设计——注意主卫为通长镜面非镜柜；客卫 2,000 定制/非标，含云鲸 J6 基站仓深化，约 500mm 仓宽为假设值须实机会审）。PKG-100 need 18,698 → 16,998（超父包 8,998），全局 pending gap 相应 −1,700；业主侧"1.8 万封顶含尾巴"为讨论口径，未定标为 cap。
- **登记不改状态**：马桶业主侧出现具体型号方向 ZQ6650-SA-CJM305（2,799/台，后缀含坑距 305 承诺）——两卫坑距 305/400 待核（pending-site-data #31）未解前不得定死，与九牧 11383-2-1/31KB-1、箭牌 AE1182U 的同口径比价未跑；玻璃屏 8mm 钢化+3C、约 900/台 口径入描述，ownership_pending 不变。
- **过时口径修正（外部拆分 vs 现行台账）**：外部卫浴拆分沿用捆绑单时代浴霸 3,998 与 J6 3,200——现行权威为 R3 浴霸 S2-Air×2 目标 1,500、J6 子预算 3,000；"两卫完整可用"口径 ≈21,500 而非 24,200（洁具 17,000 + 浴霸 1,500 + J6 3,000）。

### DEC-2026-10-07-R02 卫浴 PKG-100 第二次收口：主卫柜先入账 1,500 + 花洒降档 + 玻璃屏归属定案 + 条带定制柜划归二期

- **日期**：2026-10-07。触发：业主以"墙里贵、墙外耗材化"原则复审 PKG-100，要求压缩并收口；本轮经同口径比对（`COST-100-01`~`06` 逐项对 R12 台账）后定案。
- **裁定①（主卫浴室柜）**：DEC-2026-10-05-R12 的"主卫 3,000（约1.05m 哑白柜体+浅灰台面+圆上盆+通长镜面）"下调至 **¥1,500，业主先入账、柜型/台盆形式/龙头形式均未定**。客卫 ¥2,000（悬浮+云鲸 J6 基站仓，非标定制）**不动**。`COST-100-02` 由 5,000 → **3,500**。
  - **口径澄清（本轮新查明）**：主卫"浴室柜"在建模侧是两套彼此独立的东西——①`mb_washbasin_cabinet`（1.05m×0.50m，AABB x[0.05,1.10]，`design-rules` 归 `vanity`，自带浅灰台面+圆上盆，**挂墙可用、不依赖底柜支撑**）= R12 那 3,000 的本体；②`mb_vanity_base_cabinet`（1.38m×0.565m×0.62m，AABB x[1.975,2.54]，`design-rules` 归 **`wardrobe`**）+ 两块同包络悬浮板 `mb_vanity_lower_board`/`main_board` + 三个 PVC 管井件 `mb_vanity_pvc_box`/`pvc_wardrobe_entry`/`pvc_service_chase` + `condensate_pipe_ac_outlet` = **定制柜/HVAC 协调账，从来不在 R12 的 3,000 里，也不在任何预算科目里**。前者归 `COST-100-02`，后者归二期，二者不得混淆。
  - **未定的三条路径与 MEP 后果**（业主选择"之后再说"，本条只冻结预算、不冻结柜型）：**A** 买柜体+岩板台面，台上盆与壁挂龙头仍按 DEC-2026-10-03-R1 单配 → `faucet_mbath_vanity` 盆心 x=0.575、`drain_mbath_vanity` 墙排中心、`water-master-bath` 穿 `w_mbath_south` 点 x=0.575 **全部不动**，给排水参数与柜体 SKU 解耦；**B** 厂家一体盆成品柜 ¥1,500 全包 → 台上盆设计意图放弃，上述三点随柜体重定、`water-master-bath`（`plan_supported`，DEC-2026-10-06-R1 刚正交化至 x=0.575，且同时供台盆龙头与 `toilet_mbath`）**退回 pending 重画**；**C** 维持 R12 原设计 ¥3,000。**推荐 A**：省 600~1,300 且不动 MEP。
  - **新增阻塞** `BLK-MASTER-VANITY-SKU`：柜体 SKU 未冻结前，主卫给排水不能按"已定案"施工；该 SKU 是水电交底前置（design 冻结前置，不是安装前置）。
- **裁定②（花洒）**：R12 的"千元级恒温档 ¥2,000"下调至 **¥1,300，两套均普通明装、阀体与阀芯不降级**。同时显式登记：**放弃花洒侧二级恒温**，恒温改由海尔 KL7PRO 水伺服（DEC-2026-10-05-R5）在热水器侧承担一级。此举同时作废 R12 dedup 中"供水侧与水伺服热水器兼容"的恒温档前提。阀体/阀芯保持"墙里件"定位，不得按耗材采购。
- **裁定③（玻璃屏）**：`COST-100-05` 固定淋浴玻璃屏 ×2 ¥1,800 **定案归 PKG-100**，`ownership_pending` 关闭。家电池（PKG-160 need 16,496 已超计划额 496）不接这笔。**登记口径冲突**：`config/materials.yaml` 的 `shower_enclosure_01` notes 仍写"归 appliances 池避免与 sanitary 三件套计数混淆"，与本条冲突，`materials.yaml` 侧待同步（遗留，不阻断记账）。
- **裁定④（条带定制柜组）**：`mb_vanity_base_cabinet` + 两块同包络悬浮板 + 三个 PVC 管井件 + `condensate_pipe_ac_outlet` **整组划归二期**，对应 `P2-100` / `COST-150-01`，一期 `planned_cny` 保持 0。业主"定制柜放到二期、不急着落地"即该组现行状态，**本条不新增一期预算**。
  - **边界含糊待补**：`P2-100`/`COST-150-01` 现名"主卧通顶定制衣柜"（对应 `master_wardrobe_tall_240` 2.4m 隔断柜），而冷凝水管实际墙行段（管心 x=2.50、z=3.10..4.30，穿 `w_mbath_south`）由 `mb_vanity_base_cabinet` 条带柜组收纳。条带柜组是否含在 P2-100 的 3,000–5,000 内，此前无任何 DEC 或台账说明，**二期启动前必须写清**；按项目单价反算该组约 1,500–2,300（柜体 ¥800/㎡ 投影 + 石英石 ¥400/延米 + PVC 井），为推断非报价。
  - **一期过渡态**：条带将处于"1.05m 洗手柜 + 台上盆可用 / 无底柜收纳 / **冷凝水管裸露于主卧墙面至二期**"状态，属已知可接受过渡，不得按缺陷整改。
- **未动**：`COST-100-01` 马桶维持 ZQ6650 cap ¥5,598，状态保持 `owner_selected_pending_verification`（坑距 pending-site-data #31/#36 未解、与九牧 11383-2-1/31KB-1、箭牌 AE1182U 同口径比价未跑，**不得写成 locked**）；`COST-100-04` 五金维持 ¥2,600；`COST-100-06` 浴霸 R3 定案 ¥1,500 不变（仍不计入 need 口径）。
- **金额**：`estimated_need_cny` 16,998 → **14,798**（5,598 + 3,500 + 1,300 + 1,100 + 1,800 + 1,500），超父包计划额 8,000 **6,798**（原 8,998）。含浴霸全口径 16,298。**本轮净降 2,200，其中 1,500 来自主卫柜、700 来自花洒。**
- **遗留**：① 主卫柜 SKU（路径 A/B/C）未定，`BLK-MASTER-VANITY-SKU` 未清；② 五金提质（地漏/角阀本体由 30–60 / 15–25 提至全铜级，约 +400）**本轮未采纳**，维持 2,600，砸墙级风险由业主接受；③ `materials.yaml shower_enclosure_01` 的 appliances 归属与裁定③冲突待同步；④ P2-100 条带柜组边界待补；⑤ 两卫马桶同柱给水/插座撞线（(`2.60,1.50)` / (`7.10,3.05)`，同柱同高程）仍阻塞 SKU 冻结。
- **验证**：`verify:schedule` Exit 0（3 phases / 23 packages / 91 components / ¥210,000 allocated / known pending gap 由 35,994 降至 **33,794**，净 −2,200）→ `schedule:render` 再生 `budget.md`/`schedule.md`/`checklist.md` → `verify:all` Exit 0 以外唯一 FAIL 为 `verify:facts` 的 `dangling_reference`（瓷砖比价并行工作在 `docs/design-iterations/tile-plank-comparison-20261006/evidence/jyt-guest-bath-hypothesis.png` 引用 `JSQy` 而 `control.yaml` 仅有 `JSQ30-HWF`/`JSQ30-MK6`，与本条无关，已由 DEC-2026-10-07-R01 登记同一模式；`control.yaml` 现存热水器型号未因本条被删改）→ `test:server` 647 tests / 646 pass / 1 fail（失败项为 `mep-guidance-baseline` 的 `factsRun.status === 0` 断言，根因同上，非本条引入）→ `typecheck` Exit 0。本轮自查：首次 `verify:facts` 曾报 2 条 `unregistered_fact_occurrence`（`COST-100-02` 描述内 `¥1,500`/`¥2,000` 字面量），已按项目约定去掉 `¥` 前缀后归零（15→13 warnings）。
- **关联文件**：`schedule/phase-1/control.yaml`（PKG-100、`COST-100-01`~`05`、`COST-150-01`、`BLK-MASTER-VANITY-SKU`）、`schedule/phase-2/control.yaml`（`P2-100` 边界补注）、`docs/decisions/04-bathrooms.md`（本条）。
- **决策人**：业主。

