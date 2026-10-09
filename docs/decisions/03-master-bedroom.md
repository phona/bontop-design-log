# 决策日志 · 主卧

> 本文件是 `docs/decision_log.md` 2026-10-09 主题拆分（DEC-2026-10-09-S01）的产物：
> 收录范围 = 北墙通顶衣柜与条带柜组、床头柜与梳妆台/洗手柜、窗帘分段、门头盒与空调檐口、前台/后台迭代。条目为原文件的连续切片，正文未改写；文件内按时间正序。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-08-26-045` 主卧空调檐口定案 + 条带东北角通顶储物柜（冷凝水柜内走管）
- `DEC-2026-09-01-050` 主卧南床头独立干式梳妆台 + 外置纯洗手柜
- `DEC-2026-09-02-001` 主卧候选方案落地（未落地施工）
- `DEC-2026-09-02-051` 主卧洗手柜角部窗帘分段 + 柜体东移收宽 + 盆居中（初版，待量房终核）
- `DEC-2026-09-02-051-补` 百叶段南延至 z=4.00
- `DEC-2026-09-02-051-补2` 分界立柱建模 + 布帘起点 4.00→4.06 消重合
- `DEC-2026-09-02-051-补3` 磨砂隐私层 + 无构件收口，取消独立黑柱
- `DEC-2026-09-02-052` 主卧候选方案视觉反馈修正（未落地施工）（同日另一条 DEC-2026-09-02-053 原与本条同号 052，已改号）
- `DEC-2026-09-02-052-补` 条带柜组回滚：恢复两块悬浮板，撤销薄高柜
- `DEC-2026-09-02-053` 主卧床北移 0.25m + 条带薄高柜替换两块悬浮板（迭代 mb-bedshift-stripcabinet-20260902）（原编号 052，因与同日另一决策重号已改号；同日另一条见 DEC-2026-09-02-052）
- `DEC-2026-09-03-053` 主卧家具化前台 + 书房季节后台（迭代 master-flexible-frontstage-20260903，五件协议文档建立，未冻结）
- `DEC-2026-09-04-R1` 梳妆桌贴西窗 + 南侧轻中古矮柜（迭代 master-flexible-frontstage-20260903 R1 修订，未冻结）
- `DEC-2026-09-04-R2` 东墙构成修正（衣柜降 620mm 级 + 点位枕头区成组，迭代 master-flexible-frontstage-20260903，未冻结）
- `DEC-2026-09-04-R2.1/R2.2` 点位重叠修复与壁灯渲染锚点根因修复
- `DEC-2026-09-04-R2.3` 床头点位抬升出床头板
- `DEC-2026-09-05-002` 候选 A 双普通床头柜 runtime 净距修正（未落地施工）
- `DEC-2026-09-05-003` R5纠偏：统一350mm床头柜与横柜真实门状态
- `DEC-2026-09-05-R6.2` 主卧北墙衣柜与窗帘软包络契约修正（候选预演，blocked）
- `DEC-2026-09-06-R7.1` 衣柜-悬浮板 L 形转角与门头盒一体收口修正
- `DEC-2026-09-06-R7` 主卧北墙通顶定制衣柜（650 收窄版）+ 空调门头盒一体预演
- `DEC-2026-09-07-R10` 主卧门头盒送回风轴线微调

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-08-26-045 主卧空调檐口定案 + 条带东北角通顶储物柜（冷凝水柜内走管）

- **日期**：2026-08-26
- **决策事项**：主卧风管机位置与送回风形式定案（历经西飘窗窄条→东墙大板→门头盒→骑矮柜盒→贴主卫转角盒→通长檐口共 7 版 3D 评审）；条带绿植凹位改通顶储物柜；冷凝水路由改柜内走管
- **选定方案**：
  - **空调檐口**：`ceiling_master_ac` x[0.05,4.20]×z[4.30,4.95] 通长顶带（东起东墙、西抵西幕墙框架收口，幕墙不承重只挂楼板），底 2.5m；内机 (2.15,4.6)；南立面 0.9m 线形送风朝南越矮柜顶（span x[1.7,2.6]），底面 1.0m 线形回风**回检一体**（铰接格栅兼检修，全屋仅客厅保留独立检修口）；冷媒/电源由走廊穿孔 (4.2,4.6) 直线进东段
  - **隔断柜 v2**：西段被褥矮柜降 1.1m 且收窄 0.8m（x[1.8,2.6]），挂衣高柜西延至 1.6m（x[2.6,4.2]）保持 2.7m 通顶；睡眠区入口维持西端 0.7m 通道（x<1.1 为飘窗不可站，无西延余地）
  - **储物柜**：`utility_cabinet_tall` (2.26,3.60)，0.55 深×1.3 长×2.7 高通顶，嵌主卫东墙×儿童房南墙转角朝西开门；绿植挪至主卧西南角地面并西移至 (1.10,9.40)，朝向床区
  - **冷凝水**：檐口底落出→穿柜顶北端进柜→柜内管井角贴背板下行→穿 x=2.6 墙（孔位留柜内）→主卫吊顶上方至候选点 (2.0,2.5)
- **⚠️ 施工注意（落地前必看，防漏项）**：
  1. 冷凝水管**全程包保温棉**（柜内走冷水管不包会结露滴水，柜体受潮发霉难以察觉）；
  2. 柜内做 **0.1×0.1 管井角**（背板+侧板夹角藏管，前面层板照做，储物不损失）；
  3. 穿墙孔必须留在**柜体覆盖范围内**（开柜即修，全程明管无暗埋）；
  4. 檐口内机侧留电源（sock_master_ac @(2.80,4.60) 吊顶内）；
  5. 主卫吊顶范围已修正收回 z=2.86（旧值 3.26 越界），施工按墙实量
- **决策依据**：业主 3D 评审 7 轮（飘窗旁窄条/东墙大板/贴卫生间门口盒观感均否决；参考酒店客房门头盒实景照片选定檐口形式）；柜内走管为业主提议，优于墙槽暗埋（好修）与东绕走廊（坡度长）
- **预算影响**：檐口吊顶 ~2.7㎡ + 储物柜 1 组（~0.72㎡ 展开），增量约 1~1.5k；衣柜分格变化预算不变
- **关联文件**：`config/ceiling.yaml`、`config/hvac.yaml`、`config/electrical.yaml`、`config/house.yaml`、`app/src/render/FixtureFactory.ts`
- **决策人**：业主

---

### DEC-2026-09-01-050 主卧南床头独立干式梳妆台 + 外置纯洗手柜

- **日期**：2026-09-01
- **决策事项**：在不移动主卧床与北侧衣柜、不改墙内电气的前提下，补齐南床头梳妆功能，并将主卫外原洗漱梳妆一体台收敛为纯洗手柜。
- **选定方案**：
  - `bed_180 @(3.20,7.875) rotation=270` 与 `wardrobe_240_split @(3.00,5.95)` 坐标和朝向冻结不动。
  - 南床头新增 `master_dressing_table @(4.00,9.245) rotation=90`，成品外轮廓 `0.85×0.40×0.75m`；长边沿世界 z、东缘贴 w_mb_east、面朝西，世界 AABB `x[3.80,4.20] z[8.82,9.67]`。靠床端兼床头置物，配一层薄抽屉、桌面支撑镜和插接式镜前灯，不假定东墙可挂重镜。
  - 新增 `dressing_stool @(3.75,9.245) rotation=90`，`0.42×0.40×0.45m`，收纳态进入台下；不复用通用 `0.5×0.5 chair`。
  - 复用 `sock_master_bed_r @(4.20,9.25,h0.70)`，桌—插座中心距约 `0.20m`，不改墙内电气；定制桌须为插座保留可见、可拔插检修口。南床头壁灯保留。
  - 原 `vanity_dresser @(0.55,3.16)` 替换为 `mb_washbasin_cabinet`：保持 `1.10×0.50m` 外轮廓、盆心 `(0.26,2.96)`、龙头、墙排及东侧屏风关系；删除梳妆膝位和椅子，东侧改封闭上下抽屉收纳。
- **渲染主线**：共享 `FixtureFactory`/GLB/Web 已增加三类新 recipe 与稳定 parts/materialRole；旧 Blender 主线已由同期外部工作区改动整体冷归档到 `scripts/archive/blender-pipeline/`，本决策遵守新根规则，不复活或编辑归档管线。归档前南侧自动床头柜问题由活动共享场景不生成该候选自然消除；正式验证以 GLB/Web 对象树为准。
- **窗帘边界**：南帘是可压缩软装，不把 curtain box 当硬碰撞墙；当前 schema 无低风险字段可准确声明电机端和单侧堆叠，故不伪造“闭帘完全无影响”。桌南缘距南窗帘轨线约 0.13m，真实褶皱厚度与向西收拢方式须由窗帘深化图确认。
- **预算语义**：纯洗手柜与干式梳妆台分别映射 vanity topic，专用凳映射 chair；洁具数量仍由纯洗手柜+faucet 计数，不沿用 `vanity_dresser` 语义。
- **现场待确认**：东墙完成面/暗管探测；南帘电机端、堆叠厚度和闭帘扫掠；插座面板与桌后检修净空；墙排/存水弯与东侧抽屉避让；台盆实际开孔与屏风收边。
- **关联文件**：`config/house.yaml`、`config/electrical.yaml`、`config/plumbing.yaml`、`config/design-rules.yaml`、`shared/types.ts`、`shared/render/FixtureFactory.ts`、`scripts/verify/placement/verify-furniture-placement.ts`、`server/budget-calculator.ts`、`docs/dressing-map.md`、`docs/design-iterations/master-bedroom-20260901/`
- **决策人**：业主

---

### DEC-2026-09-02-001 主卧候选方案落地（未落地施工）

- **日期**：2026-09-02
- **决策事项**：取消矮柜，衣柜南移，床北移，衣柜与梳妆台形成衣帽间，并允许同步移动相关电气点位
- **选定方案**：床 `bed_180` 中心 `(3.20,6.50)`、rotation `270°`（项目当前朝向定义为不旋转）；高柜 `master_wardrobe_tall_160` 中心 `(3.40,8.35)`、rotation `0°`；梳妆台 `(3.65,9.15)`、rotation `270°`；凳 `(3.40,9.15)`、rotation `270°`
- **决策依据**：床体 AABB `[2.20,4.20]×[5.60,7.40]`，视觉靠东墙；高柜实体柜体 AABB `[2.60,4.20]×[8.05,8.65]`，南缘严格小于南飘窗起始 `z=8.70`；床尾至柜体北侧/柜门操作侧净距 `8.05−7.40=0.65m`，达到0.6m目标；梳妆台低家具位于南飘窗下方，南帘/窗扇仍待确认
- **电气**：床头插座/开关/壁灯同步至 rotation=270 床头区；梳妆台复用东墙南侧插座 `(4.20,9.15)`，保留 `wall_side: west`
- **未解决 site_pending**：南飘窗窗帘堆叠、窗扇开启及现场完成面仍需确认；方案状态为候选/未落地，不代表施工完成
- **关联文件**：`config/house.yaml`、`config/electrical.yaml`、`shared/types.ts`、`shared/render/FixtureFactory.ts`、`shared/render/SceneBuilder.ts`、主卧迭代四份文档、测试
- **决策人**：业主确认目标，坐标为基于权威几何与包围盒的实现候选

---

### DEC-2026-09-02-051 主卧洗手柜角部窗帘分段 + 柜体东移收宽 + 盆居中（初版，待量房终核）

- **日期**：2026-09-02
- **决策事项**：解决 `mb_washbasin_cabinet` 西缘贴西玻璃幕墙与 `curtain_master_west` 织物帘（纱+遮光、通高）同角的溅水/发霉/西晒冲突；并响应美观诉求将盆居中。
- **可选方案**：
  1. 方案 A：盆区幕墙格改百叶独立成框、布帘分段（选定）
  2. 方案 B：保留通长布帘，仅贴膜+挡水沿补强（缓解非解决，否决）
  3. 方案 C：洗手柜迁出幕墙角（需重走给排水且门洞以东仅 0.65m 放不下 1.10m 柜，否决）
  4. 柜体留 15cm 帘缝变体（布帘堆叠仍扫柜边且盆缩小，否决）
  5. 内置百叶中空玻璃（开发商幕墙不可更换，否决）
- **选定方案（初版，假定"玻璃通高"情形）**：
  - `curtain_master_west` 拆为三段：`curtain_master_west`（walls=[w_west_upper]，布帘）；`curtain_master_strip_fabric`（points z[3.45,5.55]，布帘）；`curtain_mb_washbasin_blinds`（points z[2.86,3.45]，铝百叶，`offset: 0.03` 贴框位，room 归 master_bath 与湿区百叶同组——projection/presentation 禁止同房间混 kind）。分段点 z=3.45 为假定竖梃位，待量房后在 model-geometry 切分 w_west_mid 并改回墙引用。
  - `mb_washbasin_cabinet` 东移 5cm 且收宽 1.10→1.05（`@(0.575,3.16)`，世界 x[0.05,1.10]）：西让百叶升降缝、东留门套缝；盆/龙头/墙排居中至 x=0.575（`faucet_mbath_vanity`、`drain_mbath_vanity` 随移）。
  - 新增声明式字段：curtain 元素 `offset`（overlay schema + SceneBuilder 消费，默认 0.12 布帘位）。
  - 分界线施工节点：竖梃优先借用，错位时 3~4cm 黑色金属通顶立柱兜底（顶固定于窗帘盒底、底角码落地、中部连柜侧），**幕墙零附着**（不打孔/不粘胶/不贴膜）。
- **决策依据**：溅水/发霉/冷凝为长期硬伤；对称居中同时让人与水点远离幕墙 ~0.3m；W_west_mid 全长 2.69m 中门洞占 x[1.15,1.95]，1.10m 柜唯一整段为 x[0,1.15]，居中诉求以"盆对柜体居中"实现而非柜体对墙居中。
- **预算影响**：主卧布帘用量略减（盆区格 ~0.6m 宽改百叶）；新增百叶 1 格与可能的分界立柱，费用小幅增减互抵；docs/curtain-design.md 预算超支结论不变。
- **现场待确认（解锁终核的四项复尺）**：幕墙竖梃分格位置；窗带标高（sill≈2.07/带高 0.76 是否属实，决定百叶做顶部带还是通高、柜体是否需东移）；原立管位置与下沉:300 分界线（决定盆心能否居中于 0.575）；墙排与东侧抽屉避让。
- **关联文件**：`config/layout/overlay.yaml`、`config/house.yaml`、`config/plumbing.yaml`、`shared/types.ts`、`shared/render/FixtureFactory.ts`、`shared/render/SceneBuilder.ts`、`server/overlay-merge.ts`、`tests/server/curtain-config.test.ts`、`tests/server/master-bedroom-dressing.test.ts`、`tests/server/shared/scene-builder.test.ts`、`docs/curtain-design.md`、`docs/design-iterations/mb-washbasin-curtain-20260901/`
- **决策人**：业主

---

### DEC-2026-09-02-051-补 百叶段南延至 z=4.00

- **日期**：2026-09-02（同日业主追加）
- **决策事项**：盆区百叶段南缘从 z=3.45 南延至 z=4.00，覆盖台面南缘（3.41）以外约 0.6m 的站位溅水区；布帘起点同步南移。分段点仍为假定值，量房按竖梃归位。
- **关联文件**：`config/layout/overlay.yaml`、`docs/curtain-design.md`、`docs/design-iterations/mb-washbasin-curtain-20260901/`
- **决策人**：业主

---

### DEC-2026-09-02-051-补2 分界立柱建模 + 布帘起点 4.00→4.06 消重合

- **日期**：2026-09-02（同日业主发现分界处重合）
- **决策事项**：运行时 AABB 复核发现布帘收拢堆叠（blackout gathered，x[0,0.12]）与百叶（x[-0.01,0.03]）在 z=4.00 分界处相交。布帘起点南移至 z=4.06，z[4.00,4.06] 由新建模的分界立柱 `curtain_divider_post`（黑钛 0.04×0.06×2.70m @(0.055,4.03)，furnishingTypeToTopic 归 hardware）占据，堆叠带 z[4.06,4.24] 与百叶不再相交。立柱置于 house.yaml 主卧列表末尾，不打乱既有 GLB 节点序号。量房若竖梃在位则删除立柱条目。
- **关联文件**：`config/layout/overlay.yaml`、`config/house.yaml`、`shared/types.ts`、`shared/render/FixtureFactory.ts`、`config/design-rules.yaml`、`docs/design-iterations/mb-washbasin-curtain-20260901/`
- **决策人**：业主

---

### DEC-2026-09-02-051-补3 磨砂隐私层 + 无构件收口，取消独立黑柱

- **日期**：2026-09-02
- **决策事项**：为洗手区增加固定隐私保障，同时降低分界施工复杂度与视觉突兀风险。
- **选定方案**：盆区+站位段保留百叶 z[2.86,4.00]，增加浅色半透 `frosted_privacy` 视觉层；布帘自 z=4.06 起挂，z[4.00,4.06] 保留约 6cm 无构件收口空隙。优先借用实际幕墙竖梃；无合适竖梃时由百叶边框、轨道端头和空隙完成分界，不新增独立黑柱。
- **隐私逻辑**：磨砂层提供固定“透光不透人”底层，百叶负责可调节遮阳与加强隐私，织物帘不进入台盆/站位区。
- **幕墙原则**：磨砂层仅为室内可逆膜的模型视觉表达，不等于已批准施工；不在玻璃上打孔或粘结构件，最终按玻璃类型与现场条件确认。
- **关联文件**：`config/layout/overlay.yaml`、`config/house.yaml`、`shared/types.ts`、`shared/render/SceneBuilder.ts`、`app/src/render/BrowserSceneMaterials.ts`、`server/overlay-merge.ts`、`scripts/verify/collision/verify-collision-coverage.ts`、`docs/curtain-design.md`、`docs/design-iterations/mb-washbasin-curtain-20260901/`
- **决策人**：业主

---

### DEC-2026-09-02-052 主卧候选方案视觉反馈修正（未落地施工）（同日另一条 DEC-2026-09-02-053 原与本条同号 052，已改号）

- **日期**：2026-09-02
- **用户截图反馈证据**：高柜未贴上飘窗、柜体宽度不足且浪费空间、床贴到主卧门；本轮截图作为问题证据，不以像素反推坐标。
- **权威复核**：主卧南上飘窗室内带为 x[0,4.2]、z[8.70,9.80]；`w_mb_east` 为连续实体墙；`d_mb` 位于 `w_strip_east`，门洞/门扇扫掠必须按 resolver/runtime 查询；目标对象必须记录稳定 objectId 与实际 AABB。
- **修正版候选**：`master_wardrobe_tall_240 @(3.00,8.40), rotation=0`，2.4×0.6×2.7m，AABB x[1.80,4.20]、z[8.10,8.70]，东端贴 `w_mb_east`，南缘贴飘窗北缘且不进入飘窗带；柜门朝北。`bed_180 @(3.20,6.85), rotation=270`，AABB x[2.20,4.20]、z[5.95,7.75]；保持床靠东墙，不旋转。
- **净距结论**：床北缘至当前 `d_mb` 门洞/扫掠目标约 `0.70m`；床南缘至高柜北侧柜门约 `8.10-7.75=0.35m`，属于功能风险/待验证，不能声称0.60m完全通过；若验证器判重叠，优先评估床 x 向西移0.05m，当前保持东缘贴东墙。
- **电气**：rotation=270 的床头为北侧；东墙 `sock_master_bed_l @(4.20,6.20,h0.70)` 与新增独立 `sock_master_bed_r_head @(4.20,7.50,h0.70)` 按床头北缘两端对称内缩分居床头左右两侧，均避开 `switch_master_door @(4.20,5.70)`；南侧 `sock_master_bed_r @(4.20,9.15)` 仅服务梳妆台，不复用。东墙 `w_mb_east` 为实体墙，`wall_side: west`。
- **门向**：`d_mb` 保持 inward，仅 `hinge: end → start`，门洞位置不变，表示相反开向；现场门扇尺寸与实际扫掠仍需复核。
- **状态**：新对齐/候选实施状态；方案未落地施工。`data/project-render-facts.json` 若因电气投影变化，仅作为派生文件重新生成。
- **关联文件**：`config/house.yaml`、`config/electrical.yaml`、`config/verify-rules.yaml`、`shared/types.ts`、`shared/render/FixtureFactory.ts`、`shared/render/SceneBuilder.ts`、相关 tests、`docs/dressing-map.md`、`docs/design-iterations/master-bedroom-20260901/`。
- **决策人**：业主

---

### DEC-2026-09-02-052-补 条带柜组回滚：恢复两块悬浮板，撤销薄高柜

- **日期**：2026-09-02（同日业主回滚决定）
- **决策事项**：主卫门口条带柜组恢复成两块悬浮板（`mb_vanity_lower_board`/`mb_vanity_main_board`，along=3.35 四件同轴口径），撤销 `mb_vanity_tall_cabinet` 薄高柜方案；吊柜式中间态曾讨论但未采纳。只回滚柜组——床北移（052 主体：`bed_180` z=6.60、五个随床点位、`switch_master_door` @w_strip_east z=4.45）全部保留。
- **开放问题**：脏衣/洗护囤货的封闭收纳需求重新登记，后续单独迭代解决（见迭代文档 decision-brief `open-laundry-storage`）。
- **关联文件**：`config/house.yaml`、`shared/types.ts`、`shared/render/FixtureFactory.ts`、`config/design-rules.yaml`、`scripts/verify/placement/verify-furniture-placement.ts`、`tests/server/shared/scene-builder.test.ts`、`docs/dressing-map.md`、`docs/design-iterations/mb-bedshift-stripcabinet-20260902/`
- **决策人**：业主

---

### DEC-2026-09-02-053 主卧床北移 0.25m + 条带薄高柜替换两块悬浮板（迭代 mb-bedshift-stripcabinet-20260902）（原编号 052，因与同日另一决策重号已改号；同日另一条见 DEC-2026-09-02-052）

- **日期**：2026-09-02
- **决策事项**：解除床南缘至隔断高柜 0.35m 的功能风险；为洗漱区补封闭囤货收纳。
- **选定方案**：
  - `bed_180` 北移 0.25m 至 `(3.20,6.60), rotation=270`，AABB x[2.20,4.20]、z[5.70,7.50]；床北缘至 `d_mb` 门扇扫掠约 0.50m，床南缘至高柜柜门操作侧恢复 0.60m（原 0.35m 功能风险解除）。
  - 床头随床五个电气点位 z 向 -0.25 平移（x/wall/height 不变）：`sock_master_bed_l` z=5.95、`sock_master_bed_r_head` z=7.25（以床头北缘 z=5.70 为基准两端 0.25m 内缩对称）、`switch_master_bed_l` z=5.75、`light_master_wall_l` z=5.95、`light_master_wall_r` z=7.05。梳妆台南插座 `sock_master_bed_r`（z=9.15）不动。
  - `switch_master_door` 让出 `w_mb_east` 床头墙，改挂 `w_strip_east` 实体墙垛、面向寝区（west，x=4.20、h=1.3 不变）。resolver 解算 `d_mb` 门洞实为 z[4.65,5.55] 占满墙段南端，唯一实体墙垛为北段 z[4.30,4.65]，取 z=4.45（距洞口北缘 0.20m）——纠正原拟"南侧 z=5.35"的错误前提。
  - 隔断高柜 `master_wardrobe_tall_240` 维持 2.4×0.6×2.7 通顶不动（柜体隔断分区需通顶，不降高）。
  - 条带删除两块悬浮板（`mb_vanity_lower_board`/`mb_vanity_main_board` 类型彻底删除），新增 `mb_vanity_tall_cabinet`：1.24m×0.42m，y 0.65..2.40 坐在底柜台面上方，z[2.86,4.10] 从主卫隔墙完成面起算（底柜 z 起点 2.60 北收至 2.86 以避 `d_mbath` 门扇扫掠）；两扇 0.62m 平开门朝西、北端合页、浅色按压无把手；内部活动层板兼冷凝水管检修，管井角做法待深化；顶部 0.18m 封板接 `mb_vanity_pvc_box`（y 2.58 起）。
- **存量瑕疵登记**：底柜 `mb_vanity_base_cabinet` 北端 0.26m 探入主卫体积为既有瑕疵，本轮不动，量房复核。
- **决策依据**：床边拿衣优先（柜门朝床、推拉门）；洗漱区无囤货收纳；0.60m 操作净距为柜门可开启下限。
- **关联文件**：`config/house.yaml`、`config/electrical.yaml`、`config/design-rules.yaml`、`shared/types.ts`、`shared/render/FixtureFactory.ts`、`scripts/verify/placement/verify-furniture-placement.ts`、`tests/server/master-bedroom-dressing.test.ts`、`tests/server/cli-glb-export.test.ts`、`tests/server/shared/scene-builder.test.ts`、`docs/dressing-map.md`、`data/project-render-facts.json`、`docs/design-iterations/mb-bedshift-stripcabinet-20260902/`
- **决策人**：业主

---

### DEC-2026-09-03-053 主卧家具化前台 + 书房季节后台（迭代 master-flexible-frontstage-20260903，五件协议文档建立，未冻结）

- **日期**：2026-09-03
- **决策事项**：四轮审查后的终审版方案进入第一轮预览实施；本轮只建立五件协议文档（fact-table / decision-brief / design-datum / object-manifest / review-manifest），不改任何 config/code。
- **架构决策**：
  - 主卧家具化前台：移除 placed `master_wardrobe_tall_240`（通用 recipe 保留）；入口东墙放 0.75m 级成品窄衣柜（候选 740–750W×580–600D×2150–2300H，首轮占位 750×600×2250，北缘 z≈5.63–5.65 避 d_mb 门扫掠 z≤5.55，柜门朝西，不通顶不连吊顶）；床南移至中心约 (3.20,7.45)（AABB x[2.20,4.20] z[6.55,8.35]，候选未冻结）；梳妆桌迁西侧北段（候选 850–900W×430–460D，首轮 900×450×750，四腿开放式）；删除主卧 placed `plant_fiddle`；DEC-045 四件套不动，PVC 盒 HVAC 责任不并入家具。
  - 唯一地插：优先迁至开放式桌下后侧服务域（修正"桌 AABB 整体禁入"的过严判据）；可行域为空则 fallback——取消西侧地插、镜/灯改充电式、吹风机用东南备用墙插临时线（需用户确认）；不新增第二只地插。
  - 床头电气：现有两插座/双控/两壁灯不机械平移，按最终床架真实外廓 ±0.65m 对称口径重新定位；第一轮不冻结固定壁灯；`sock_master_bed_r` 解除梳妆专用语义，改为主卧东南通用备用插座。
  - 书房季节后台：东墙（w_east_upper, shear inferred）模块化后台柜 x[15.80,16.35] z[5.90,7.60]、深默认 0.55m、高 2.35–2.40m；删除重型器械四件（squat_rack/barbell_olympic/weight_plate_set/rubber_training_mat，均无预算映射，只记空间释放不伪造节省）；轻训练复用 `bench_adjustable` + 新增可见 `adjustable_dumbbell_pair`/`rollable_training_mat`（不新增同义类型）；换季推车 count-only。
  - 预算链路：wardrobe topic 逐房间 roomOverrides 计价链路已代码核实（server/budget-calculator.ts:130-152）；顺手纠偏 `wardrobe_180_01` topic_id 错挂 miscellaneous；`wardrobe_240_01` 核价红旗仍未决；新增 `home_fitness` topic + `home_fitness_light_set` count-only 单套计价（口径待 alignment）。
  - `config/ceiling.yaml` 书房天花注释陈旧（引用不存在的 2.6m 通顶柜），实施时必须更新注释而非只在文档备注。
- **待 alignment 项（brief 保持 frozen: false）**：①热季必须挂衣净杆长及 740–750mm 双层短挂容量余量；②home_fitness 单套计价口径。冻结门槛另含：地插可行域预演（为空则选定 fallback）、wardrobe roomOverride 多单价测试通过。
- **现场待确认（site_pending，不阻塞第一轮模型、阻塞施工冻结）**：门套/执手突出量；南帘下垂/堆叠/开启扇；西帘堆叠端与清洁；东墙结构钢筋探测；DEC-045 底柜北端 0.26m 越界；sock_master_projector 是否已施工；书房东墙结构；成品柜/床架真实型号外廓。
- **关联文件**：`docs/design-iterations/master-flexible-frontstage-20260903/`（五件文档）、`docs/decision_log.md`；实施期文件范围见迭代 decision-brief allowed_scope
- **决策人**：业主（方向经四轮审查确认；两项 alignment 待收尾后冻结 brief）

### DEC-2026-09-04-R1 梳妆桌贴西窗 + 南侧轻中古矮柜（迭代 master-flexible-frontstage-20260903 R1 修订，未冻结）

- **日期**：2026-09-04
- **起因**：业主第一人称证据指出梳妆桌置于西窗帘线东侧读作"扔在中间"，且西侧窗侧带（x[0,1.35]、2.07m 以下可用）空置。核实成立：w_west_upper 通高玻璃幕、上飘窗带 y[2.07,2.83] 内挑至 x=1.10，地面全宽可用。
- **决策事项**：
  - 梳妆桌/凳贴西窗：`master_dressing_table` @(0.425,6.05) rotation 90（桌背与玻璃留 0.20m 通风/冷凝缝，正面朝东，使用者面向玻璃自然光梳妆）；`dressing_stool` @(0.42,6.05) 收纳态含于桌下；床西通道 x[0.65,2.20] 整体释放。
  - 地插随迁：`sock_master_projector` @(0.42,5.78)（桌 footprint 北侧腿间；距桌腿 0.196m、凳包络 0.06m、帘线 0.68m、门扫掠 0.23m），仍候选未冻结。
  - 新增南侧窗带轻中古矮柜 `master_hot_season_low_dresser` @(1.00,9.31) rotation 180（1400×480×850mm 六抽、细腿、木色与梳妆桌同族；正面朝北；h<2.07m 不挡窗带）：职责为热季折叠衣物+衣柜 overflow，内衣/睡衣/脏衣/洗护仍归 DEC-045；南帘堆叠端 site_pending。
  - 预算：新开 `dresser` topic 独立计价（避免与主卧 wardrobe roomOverride 的 750 成品柜同价混计），材料/采购/scheme/预算测试同步。
- **验证**：九条验证命令全绿（test:server 517/517、test:app 434/434、typecheck、build:app）；verify:furniture 地插判据由"x≤1.35 全域禁入"收窄为帘线带 x[1.10,1.35]（桌贴窗的必然结果）；受影响视角（view-c/view-d + 新增 view-g 南窗带矮柜）证据补拍回填 review-manifest。
- **关联文件**：`docs/design-iterations/master-flexible-frontstage-20260903/`（fact-table/design-datum 已回填 R1 终值）
- **决策人**：业主（看图拍板）；两项 09-03 alignment（挂衣容量、home_fitness 计价口径）仍未收尾，brief 继续 frozen: false

### DEC-2026-09-04-R2 东墙构成修正（衣柜降 620mm 级 + 点位枕头区成组，迭代 master-flexible-frontstage-20260903，未冻结）

- **日期**：2026-09-04
- **起因**：业主审查 R1 证据后判定东墙"柜子太贴门口、床没有居中关系、插座/床头灯/开关没服务好床头，功能与美学均不达标"（R1 证据 view-a/b 20260903）。
- **结构约束（核算结论）**：东墙可用段 z[5.55,8.70]=3.15m；750mm 衣柜 + 床 1.80m + 三条硬下限缝（门侧 0.15/柜床 0.15/床帘 0.30）合计顶死 3.15m，750mm 下无成立解。
- **决策事项**：
  - 衣柜降为 620mm 级窄柜并改名 `master_freestanding_wardrobe_062`（全仓引用同步）：placed z[5.75,6.37] x[3.60,4.20]，门侧缝 0.09→0.20m、柜床缝 0.16→0.18m；床 @(3.20,7.45) 不动、床帘缝 0.35m 不变。
  - 床头点位改枕头区成组（±0.45m 对床心 7.45，两枕中心口径）：sock_master_bed_l z=7.00、sock_master_bed_r_head z=7.90、switch_master_bed_l z=7.00；壁灯 light_master_wall_l/r z=7.00/7.90、h 1.60→1.35（落床头阅读高度）。±0.65m 对称口径作废。
  - 预算：option 改 `wardrobe_062_finished_01`（1300 元/个，候选待核价），current-scheme override 同步。
- **容量风险（显性登记，挂 align-hot-season-hanging）**：620mm 双层短挂对两人热季挂衣偏紧；若 alignment 判定容量不足，回退 740–750mm + 三缝压硬下限（门侧 0.15/柜床 0.15/床帘 0.30）。
- **验证**：九条命令全绿（test:server 517/517、test:app 434/434）；余量链专项断言更新（0.20/0.18/0.35）；证据 view-a/b/c 补拍有效（runtime AABB 与配置一致，旧名运行时 0 实例）。
- **过程记录**：服务端 chokidar watcher 两轮各漏一次 config 保存事件（materials/electrical 渲染陈旧但 /api/config-status 仍 ok）；证据采集前须以 /api/project 实际内容复核，touch 触发重载可恢复。此 watcher 可靠性问题登记为观察项，另行处理。
- **关联文件**：`docs/design-iterations/master-flexible-frontstage-20260903/`（五件文档已回填 R2 终值）
- **决策人**：业主（问题判定与修正方向）；容量回退路径待 align-hot-season-hanging 裁决

### DEC-2026-09-04-R2.1/R2.2 点位重叠修复与壁灯渲染锚点根因修复

- **R2.1**：业主截图复核发现 switch_master_bed_l 与 sock_master_bed_l 同点重叠（R2 spec 失误，同落 z=7.00 h=0.70）。修复：开关北移 0.12m 至 z=6.88（并排不叠面），测试新增"面板不重叠"断言防回归。
- **R2.2**：壁灯"没降下去"根因——渲染锚点由 config/render/overrides.yaml anchorY=1.6 驱动（旧 Blender 基线口径），与 electrical.yaml height 无关；已将两壁灯 anchorY 改 1.35 与电气口径对齐，render facts 重新生成、verify:all 通过。教训：凡电气点位高度调整，必须同步检查 render/overrides.yaml 是否有同名 anchorY 覆盖。
- **渲染器观察项**：开关点位仅渲染为 2cm 素盒且正面比插座面板退后 25mm（嵌入床头板内不可见），如需可见面板需渲染侧补件；登记为 non-blocking 观察项。

### DEC-2026-09-04-R2.3 床头点位抬升出床头板

- **起因**：业主复审发现床头插座/开关嵌入床头板（点位 h=0.70 vs 当前渲染床头板顶 0.8m），读作"插座跟床重叠"。
- **修复**：sock_master_bed_l / sock_master_bed_r_head / switch_master_bed_l 高度 0.70→0.95（高出床头板顶 0.15m），z 不变（7.00/7.90/6.88）；南侧备用插座 sock_master_bed_r 保持 0.70。规则入注释：床头点位高度 = 真实床头板顶 + 0.15m，施工前按床架真实外廓终核。
- **测试**：cli-glb-export 电气契约改逐点 [z,y] 断言；master-bedroom-dressing 新增"床头组 h=0.95"断言。test:server 517/517、verify:all 全绿。

### DEC-2026-09-05-002 候选 A 双普通床头柜 runtime 净距修正（未落地施工）

- **日期**：2026-09-05
- **决策事项**：在保留“双普通床头柜”优先级的前提下，修正 bed_180 @(3.20,7.10) 的 runtime 净距。
- **选定方案**：北柜中心 z=5.96，runtime z[5.785,6.135]；南柜中心 z=8.24，runtime z[8.065,8.415]。床 runtime z[6.17,8.03]，两侧均满足 0.035m 硬净距；原北柜目标 z[5.85,6.20] 让位于不重叠约束。
- **电气**：北插座 z=6.03 保留并服务北柜；南插座/双控 z=8.18 保留并服务南柜；壁灯沿用既有方案值，不作无依据调整。
- **未解决 site_pending/阻塞**：南柜 maxZ=8.415 至南帘盒北缘 z=8.70 仅 0.285m；若 0.30m 帘盒硬下限适用则保持 BLOCKED。南帘真实堆叠、产品外廓、东墙结构/防倾倒、四门开启与 HVAC/冷凝水检修仍待确认。
- **关联文件**：`config/house.yaml`、`config/electrical.yaml`、`scripts/verify/placement/verify-furniture-placement.ts`、专项测试、`docs/design-iterations/master-flexible-frontstage-20260903/`。
- **决策人**：业主给定优先级与床坐标；本轮按 runtime 事实执行最小修正。

---


### DEC-2026-09-05-003 R5纠偏：统一350mm床头柜与横柜真实门状态

- **日期**：2026-09-05
- **决策事项**：执行用户给定R5纠偏基线，固定床/横柜坐标，统一两侧床头柜recipe与电气，并把不可同时满足的净距保留为明确阻塞。
- **选定方案**：床 `bed_180 @(3.20,7.10), rotation=270`；横柜 `@(2.20,5.25)`，完整mesh目标 x[1.40,3.00]、z[4.95,5.55]、y[0,2.15]；两床头柜统一 `master_bedside_cabinet_350`，中心 north z=5.975、south z=8.225，规格0.38×0.35；床头电气按 z≈5.975/8.177/8.273 与壁灯6.65/7.55 h1.35更新。
- **硬约束处理**：统一350mm使北柜距床约0.02m、南柜距床约0.02m，均未达到原目标硬净距；南柜至南帘盒为0.30m硬下限。保持 error/block，不缩柜、不放宽阈值。
- **门状态**：横柜四门改为独立Group/pivot、stable objectId/hingeSide/materialRole、默认closed、openLimitDeg=95，向+z开启；柜面到床约650mm、门开后正后方约250mm，不视为宽裕站位。
- **DEC-045/HVAC**：仅登记既有AABB/PVC route-cover事实；无完整维护包络事实，不新增桥接，不修改DEC-045主体/HVAC设备或风口，维护结论保持site_pending/blocked。
- **关联文件**：`config/house.yaml`、`config/electrical.yaml`、`shared/types.ts`、`shared/render/FixtureFactory.ts`、R5专项测试与五件协议文档。
- **决策人**：用户给定基线；本轮按真实runtime mesh和硬约束保留阻塞。

---

### DEC-2026-09-05-R6.2 主卧北墙衣柜与窗帘软包络契约修正（候选预演，blocked）

- **日期**：2026-09-05
- **决策事项**：执行主卧 R6 定向纠偏第二阶段，仅更新主卧相关协议、预算、窗帘契约与生成物。
- **统一基线**：active `wardrobe_north_600_finished_01`，北墙衣柜 `600W×580D×2050H`，双门 pivot，材质候选为中浅胡桃/暖烟熏橡木、四腿、古铜拉手，price `0` 明确 pending；床头柜候选 `380×350×500mm`、runtime 高 `495–505mm` 两柜同款；南侧插座 `z=7.802`、双控 `z=7.898`；DEC-045 两个 `180mm bridge` 独立可拆，不单独计价。
- **真实网格验收**：同一 `SceneBuilder` placement 场景以 `THREE.Box3` 核验两 bridge 与衣柜完整 mesh 的 world 净缝均为 `15mm`（允许区间 `10–20mm`），且不碰已知 PVC mesh；衣柜 `closed/left_open/right_open/both_open` 四状态真实门叶 world rotation 分别为 `0/0`、`-95/0`、`0/+95`、`-95/+95`，对 d_mb 开启门扇、两 bridge、床、两床头柜、梳妆桌/凳与已建模主卧 HVAC 均无 AABB 相交。人体站位不据此宣称 PASS。
- **窗帘契约**：顶部盒体 `z[8.70,8.95]` 仅吊顶构件；依据现有布帘 runtime 默认 interior offset `0.12m`，闭帘候选软包络厚 `0.12m`、`z[9.56,9.68]`，`confidence=inferred/status=site_pending`；软冲突只报 `warning/BLOCKED`。开帘堆叠仅记录实际端部，未知时为空并标 `site_pending`；不把 `curtain_box` 地面投影或通宽 `500mm` 当硬禁区。南窗六抽保持原位、可见、可移。
- **阻塞状态**：HVAC检修/结构/窗帘轨道与堆叠/真实产品外廓/衣柜门前人体站位继续 `site_pending`；`review-manifest` 区分 `alignment_frozen=true`、`construction_frozen=false`、`delivery_frozen=false`，并保持 `delivery_ready=false`、证据 `blocked`，审美/功能评审不得虚构 PASS。
- **关联文件**：`config/materials.yaml`、`config/design-rules.yaml`、`config/procurement.yaml`、`data/current-scheme.json`、`shared/types.ts`、`scripts/verify/placement/verify-furniture-placement.ts`、`tests/server/master-bedroom-dressing.test.ts`、`tests/server/shared/scene-builder.test.ts`、`docs/design-iterations/master-bedroom-r6-20260905/`。
- **决策人**：用户给定 R6 第二阶段执行要求。

---

### DEC-2026-09-06-R7.1 衣柜-悬浮板 L 形转角与门头盒一体收口修正

- **日期**：2026-09-06
- **起因**：业主验收 R7 截图后指出：衣柜与 DEC-045 悬浮板没有形成真正的 L 形（bridge 只是 180mm 端头小板），门头盒与衣柜的吊顶衔接也没做（盒体素白占位、与衣柜之间有 x 向缺口和顶缝，白盒+木柜两段式）。
- **决策事项**：
  - **L 形转角层板**：`mb_vanity_lower_board_bridge` / `mb_vanity_main_board_bridge` 由 180mm 端头小板改为沿衣柜西面的整段层板——along 4.195→4.4825，world z[4.10,4.865]（延至衣柜前脸 4.88 留 15mm）、x[2.28,2.585]（东缘与衣柜西面 x=2.60 留 15mm 阴影缝，SceneBuilder/verify 同口径新增 15mm shadow gap 放置规则），与对应悬浮板同高同厚同木色。悬浮板+bridge 沿 DEC-045 墙面贯通到衣柜前脸，衣柜本体构成 L 的另一腿。底柜/主板/下板/PVC 不动。
  - **门叶避让实测**：衣柜左门全开（-95°）门叶 world mesh 实测 x[2.5849,2.6309] z[4.8702,5.1706]，与层板 maxZ 4.865 z 向错开约 5mm，AABB 不相交——层板 maxX 维持 2.585（目标缝 15mm），无需退到 2.575（x 向净距约 0 但 z 向不重叠；取舍记录于此）。
  - **门头盒一体衔接**：`ceiling_master_ac` area [3.45,4.55,4.20,5.60]→[3.25,4.55,4.20,5.60]，西缘与衣柜东缘 x=3.25 对齐；ac_master(3.80,5.10)/supply(3.80,2.62,5.585)/return(3.95,2.49,5.20)/sock_master_ac(4.05,4.60) 全部仍落盒内。
  - **顶封板收口**：新增独立家具 `master_wardrobe_top_pelmet`（与衣柜同 footprint 摆放，不承担 HVAC 责任）：顶封板 y[2.45,2.50]×x[2.60,3.25]×z[4.30,4.88] 与门头盒底面一条线；东竖向填板 x[3.235,3.25]×z[4.55,4.88]×y[2.45,2.50]（厚 15mm）衔接门头盒西立面，东缘不越过 x=3.30 门扇带、不压回风格栅底面包络 x≥3.70。与柜门同色 #a98258，materialRole top_filler/end_panel；并入 wardrobe_north_650_custom_01 不单独计价。
  - 950→650 收窄决策见前条 DEC-2026-09-06-R7（避 d_mb 门扇）；本条只解决一体衔接读感。不改 model-geometry/overlay/d_mb 门洞；bridge 越过 w_mbath_east 墙末端 z=4.30 沿衣柜西面南行，verify 锚点范围对 bridge 类型放行（上限取衣柜前脸 4.88）。
- **验证**：新增测试——bridge/衣柜西面 mesh 净缝 10–20mm（目标 15mm）、bridge 与左门全开门叶 mesh 不相交、bridge 不碰 PVC、pelmet 包络/门扇带/回风格栅专项、门头盒西缘对齐断言；九条验证命令结果回填 `docs/design-iterations/master-bedroom-r7-20260906/review-manifest.json`（source_version 升 r7-master-bedroom-20260906-650-r71）。浏览器证据不采集（另行安排）；既有 R7 截图证据标记 stale。
- **决策人**：业主（验收截图后指明修正构造）

### DEC-2026-09-06-R7 主卧北墙通顶定制衣柜（650 收窄版）+ 空调门头盒一体预演

- **日期**：2026-09-06
- **决策事项**：废弃 R5 入口横柜与 R6 600mm 成品小柜为当前基线；北墙 z=4.30 设置定制模块化一体木饰面衣柜；空调通长檐口改为与衣柜一体的门头盒；首版 950mm 三门实施后由验证发现与 d_mb 开启门扇干涉，收窄为 650mm 双门版。
- **背景状态**：当前尚未交房，硬装/水电/吊顶/HVAC 均未施工（见 AGENTS.md 当前施工状态），重排吊顶与 HVAC 不作为拆改成本否决项。
- **首版问题**：950W×580D 三门版东缘 x=3.55，与 d_mb 开启门扇薄板带 x[3.30,4.20]×z[4.63,4.67] 干涉约 250mm（x[3.30,3.55]×z[4.63,4.67]），verify 显式 warning 暴露。
- **选定方案（收窄版 active）**：`master_north_wall_wardrobe_650 @(2.925,4.59) r=0`，650W×580D×2450H，AABB x[2.60,3.25] z[4.30,4.88]，背贴 z=4.30 实体北墙；两扇约 300mm 窄平开门朝南（铰链 left/right、真实 pivot ±95°、4 态真实 mesh）；东缘退避门扇带 x≥3.30（留 50mm 净距，verify 由 warning 改 error 门槛 maxX≤3.25）；一体木饰面，不通到石膏板原顶。
- **门头盒**：`ceiling_master_ac` 通长檐口 → 门头盒 area x[3.45,4.20]×z[4.55,5.60]、底 2.50m；内机 `ac_master`→(3.80,5.10)；送风 `supply_master`→南立面侧送 (3.80,2.62,5.585) length 0.6；回风 `return_master`→底装回检一体 (3.95,2.49,5.20) length 0.5；电源 `sock_master_ac`→(4.05,4.60) 盒内。冷凝水 x[2.0,3.45] 段失去通长檐口遮盖，局部包管/管窿候选 pending。
- **DEC-045 衔接**：底柜/主板/下板/PVC 不延不动；两 bridge 独立可拆，along 4.195，与衣柜背板维持 15mm 净缝（10–20mm 允许），形成可读 L 形衔接，不承担结构/HVAC。
- **保留项**：床 (3.20,7.40) r270、两只 380×350×500 床头柜、南窗六抽矮柜 (1.00,9.31) r180、西窗梳妆桌/凳、地插 (0.42,5.78)、洗手柜、床头电气（南插 z=7.802/双控 z=7.898 真实 86 面板 10mm 净缝；壁灯 z=6.95/7.85 h1.35）全部原位。南帘闭帘软包络 z[9.56,9.68] inferred/site_pending，堆叠端 unknown，不设地面硬禁区。
- **材料/预算**：active override `wardrobe_north_650_custom_01`（650×580×2450，两扇窄平开门，一体木饰面，price 0 + price_source=pending，不以 0 伪装完成）；950 首版 `wardrobe_north_950_custom_01` 与 R6 600 成品柜仅历史保留。
- **验证**：四态门碰撞矩阵（含 d_mb 开启门扇、两 bridge、床、两床头柜、梳妆桌凳、indoor/supply/return 已建模 HVAC）真实 mesh 无交；门头盒包络专项（ceiling/hvac/electrical 一致性）；bridge 15mm 全 mesh 净缝；闭帘软包络专项；预算映射专项。verify:all / test:server / typecheck / test:app / build:app 全绿。
- **未施工冻结**：衣柜防倾倒节点、HVAC 设备型号/风量/滤网检修空间、冷凝水局部包管、南帘堆叠、门套/执手、衣柜价格均 site_pending；`delivery_ready=false`，候选预演不构成施工下单尺寸。
- **未来若要恢复 950mm 宽**：只能另行评估改门向/门洞，单独立项。
- **关联文件**：`config/house.yaml`、`config/ceiling.yaml`、`config/hvac.yaml`、`config/electrical.yaml`、`config/mep-hvac-coordination.yaml`、`config/materials.yaml`、`config/procurement.yaml`、`config/design-rules.yaml`、`data/current-scheme.json`、`shared/types.ts`、`shared/render/FixtureFactory.ts`、`scripts/verify/placement/verify-furniture-placement.ts`、`tests/server/master-bedroom-dressing.test.ts`、`tests/server/shared/scene-builder.test.ts`、`tests/server/cli-glb-export.test.ts`、`tests/server/budget-calculator.test.ts`、`docs/design-iterations/master-bedroom-r7-20260906/`。
- **决策人**：业主（方向确认 + 收窄避让为验证驱动的实现修正）。

---

### DEC-2026-09-07-R10 主卧门头盒送回风轴线微调

- **日期**：2026-09-07
- **决策事项**：响应用户复核，将 `supply_master` 与 `return_master` 的中心轴统一由 `x=3.875` 微调至 `x=3.70`，保持风口朝向、长度、标高和检修语义不变。
- **选定方案**：`supply_master` 继续采用南立面侧送，`length=0.6`，位置 `(3.70,2.62,5.585)`，东端 `x=4.00`；`return_master` 继续采用底装下回并兼回检一体，`length=0.5`，位置 `(3.70,2.49,5.20)`，东端 `x=3.95`。按主卧东墙卧室侧完成面约 `x=4.14`，两者分别保留约 `0.14m/0.19m` 净距；端点仍完整位于 `ceiling_master_ac` 门头盒和门洞上方服务范围内，避开衣柜与墙体。
- **检修语义**：回风格栅继续兼作检修口，不新增独立检修面板；门头盒、衣柜主体、冷凝水路线与其它房间风口不变。
- **验证**：`master-bedroom-dressing.test.ts` 新增中心轴、东端净距、门洞上方高度、门头盒服务范围、衣柜避让及回风底装检修断言；`data/project-render-facts.json` 已重新生成。
- **现场待确认**：东墙实际完成面、风口厂家外框与风管截面、回风滤网抽拉空间和门头盒内净高，均在施工深化时确认。
- **关联文件**：`config/hvac.yaml`、`config/ceiling.yaml`、`config/mep-hvac-coordination.yaml`、`tests/server/master-bedroom-dressing.test.ts`、`data/project-render-facts.json`、`docs/design-iterations/master-condensate-l-route-20260907/`
- **决策人**：业主（方向确认）；施工尺寸待 HVAC 厂家深化

