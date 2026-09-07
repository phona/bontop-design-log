# 浏览器证据采集记录 — master-flexible-frontstage-20260903

> candidate A 重规划后不生成新证据。以下历史采集均不适用于当前源版本；不得复用或宣称通过。

采集时间：2026-09-03 15:40–16:05（+08:00）
采集方式：agent-browser 专属 session `bontop-mff-9e234de3`，严格串行 open → wait networkidle → `window.__APP__.isReady()` 轮询 → 运行时场景查询 → snapshot → screenshot → 校验 → close。
浏览器视口：1600×1000；所有视角均为 orbit 模式非 overview 自定义机位。

## 全局状态

- URL：`http://localhost:5173/?v=mff20260903`（query 用于破除 JS bundle 缓存）
- title：`和萃 701 - 3D 装修设计`
- `isReady()`：true（reload 后第 4 次轮询命中，每次约 2s）
- `#warnings`：空；无 config-error-banner；`offline-indicator` 隐藏（见「异常与处理」）
- accessibility snapshot：仅 UI 控件（方案/俯视/日照/湿度/机电总览/MEP 协调/HVAC/电气回路），canvas 无 a11y 内容，符合预期；各视角 snapshot 存档为同目录 `*.snapshot.txt`
- 窗帘呈现态：`{"default":"open","roomOverrides":{}}`，运行时所有 curtain 节点 `visible=false`（open 态不渲染任何帘片，见 `shared/curtain-projection.ts:30`）；截图中的深蓝竖面是玻璃幕墙（curtain_run）本体的 tinted 材质，不是帘。

## 运行时场景查询（证据采集同一会话内执行）

目标对象全部存在且可见（世界坐标，米）：

- `furniture:master_bedroom:bed_180:0` AABB x[2.20,4.20] z[6.55,8.35] y[0,0.80] — 与 house.yaml 声明一致
- `furniture:master_bedroom:master_freestanding_wardrobe_075:1` AABB x[3.564,4.20] z[5.64,6.39] y[0,2.25] — 西缘 3.564 含门板，非通顶 2.25m
- `furniture:master_bedroom:master_dressing_table:3` AABB x[1.40,1.85] z[5.595,6.505] y[0,1.31]（含桌上镜/件，桌体 0.75m）
- `furniture:master_bedroom:dressing_stool:4` AABB x[1.43,1.83] z[5.84,6.26] y[0,0.45] — 完整收入桌 footprint
- `electrical:sock_master_projector` AABB x[1.50,1.62] z[5.72,5.84] y[0.04,0.06] — 0.12×0.12m 地插，位于桌 footprint 内北侧（四腿开放桌下服务区，R4-1 口径）
- DEC-045 四件（同 wall=w_mbath_east、wall_side=west、along z 中心 3.35，后缘贴 x=2.60，同轴不变）：
  - `mb_vanity_base_cabinet:5` x[2.17,2.60] z[2.60,4.10] y[0,0.62]
  - `mb_vanity_lower_board:6` x[2.28,2.60] z[2.60,4.10] y[0.965,1.035]
  - `mb_vanity_main_board:7` x[2.28,2.60] z[2.60,4.10] y[1.515,1.585]
  - `mb_vanity_pvc_box:8` x[2.07,2.60] z[2.65,4.67] y[2.559,2.80]（含 route-cover 向北再向西共 6 个 part：pvc-service/cove-light/condensate×4，材质 #f7f5ef）
- 书房：`study_seasonal_wardrobe_wall:2` x[15.772,16.35] z[5.90,7.60] y[0,2.40]；`bench_adjustable:3` x[14.68,15.92] z[7.675,8.225]；`adjustable_dumbbell_pair:4` x[15.925,16.375] z[7.625,8.175] y[0,0.21]；`rollable_training_mat:5` x[15.947,16.203] z[5.647,5.903] y[0,1.50]（立放）；`desk:0`/`chair:1` 原位 (13.70,8.05)/(14.40,8.05)

删除项运行时确认为 0 实例：`master_wardrobe_tall_240`、`plant_fiddle`（主卧）、`squat_rack`、`barbell_olympic`、`weight_plate_set`、`rubber_training_mat`、`low_room_cabinet`（书房）。

## 视角明细

### view-a-master-entry — 主卧入口看衣柜与床头 ✅ 有效

- 文件：`view-a-master-entry_20260903.png`（217,186 B）
- 相机：orbit，pos (2.35,1.75,4.50) → target (4.05,0.80,6.20)，寝区西北角斜看东南
- 画面：d_mb 开启门扇（左缘）、入口成品柜西脸双开门带执手（中）、床东北角+床头（右）、东墙门侧插座；柜北缘与门扇扫掠南界 z=5.55 的阴影缝关系可读
- 目标对象运行时确认：wardrobe:1、bed_180:0、d_mb（门扇 @(3.75,4.65) 开启态）
- 备注：首次机位 (3.55,1.55,4.85) 与第二次 (2.95,1.70,4.90) 被开启门扇正面遮挡，已废弃重拍

### view-b-east-wall — 主卧西侧看东墙 ✅ 有效

- 文件：`view-b-east-wall_20260903.png`（105,189 B）
- 相机：orbit，pos (0.55,1.60,6.20) → target (3.95,1.00,6.30)
- 画面：东墙全景——入口柜（非通顶，柜顶以上墙面留白清晰）、床南移后的床头+床侧插座±0.65、开启的 d_mb 门扇与门口、前景梳妆桌面；旧 2.4m 横置高柜原位无残留（运行时确认 0 实例）
- 目标对象运行时确认：wardrobe:1、bed_180:0、master_dressing_table:3

### view-c-south-curtain — 主卧南侧看北 ✅ 有效

- 文件：`view-c-south-curtain_20260903.png`（310,294 B）
- 相机：orbit，pos (2.40,2.00,9.55) → target (2.60,0.40,7.30)，南帘盒北侧高位俯视
- 画面：床南缘与南侧 z=8.70 帘盒内缘之间的地面净距带（前景）、房间中央大面开敞、梳妆桌凳（左上）、DEC-045 条带与门口（远景）
- 目标对象运行时确认：bed_180:0（床南缘 z=8.35，至帘盒内缘 8.70 净 0.35m）

### view-d-west-dressing-floor-socket — 西侧梳妆桌近景 ✅ 有效

- 文件：`view-d-west-dressing-floor-socket_20260903.png`（368,718 B）
- 相机：orbit，pos (2.45,0.65,5.72) → target (1.56,0.05,5.78)，桌东侧低位平视桌底
- 画面：四腿开放桌腿间可见 0.12m 地插圆盖（画面中央地面）、凳（白座面）完整收入桌下、西玻璃幕墙（深蓝，open 态无帘片）
- 目标对象运行时确认：master_dressing_table:3、dressing_stool:4、electrical:sock_master_projector（世界 AABB 见上）
- 备注：地插仅 0.12×0.12m 且在桌板下，常态机位（2.60,1.30,5.35）与 (2.35,1.05,5.40) 两拍被桌腿遮挡不可读，降为贴地机位后清晰

### view-e-dec045-strip — DEC-045 正面 ✅ 有效（附补充视角）

- 文件：`view-e-dec045-strip_20260903.png`（117,728 B）；补充：`view-e-dec045-pvc-box_20260903.png`（46,934 B）
- 相机（主）：orbit，pos (0.10,1.57,3.35) → target (2.55,1.45,3.35)，条带内正面平视（请求 y=1.45，OrbitControls maxPolarAngle≈87° 钳制到 1.57）
- 画面（主）：落地底柜 + 下板(0.965–1.035) + 主板(1.515–1.585) 三件同轴（z 中心 3.35、后缘齐 x=2.60）清晰可读，右侧带 d_mb 门框与入口柜作位置参照
- 相机（补充）：pos (0.15,2.30,3.40) → target (2.55,2.15,3.35)，抬高后 PVC 包管+灯槽（y 2.559–2.80，含向北 route-cover）在深灰色吊顶区背景前可读
- 目标对象运行时确认：四件 AABB 全部与配置一致（见上）
- 备注：PVC 盒材质 #f7f5ef 与墙面/吊顶近色，条带内平视机位被吊顶底缘透视遮挡、隔西玻璃机位 (x=-1.60) 受玻璃雾化不可读，均废弃；两机位组合覆盖四件

### view-f-study-storage-training — 书房门口看收纳态 ✅ 有效

- 文件：`view-f-study-storage-training_20260903.png`（178,686 B）
- 相机：orbit，pos (13.70,1.60,5.90) → target (15.90,0.90,7.20)，d_bese 门口看东南
- 画面：东墙季节后台柜（非通顶 2.40m，柜门朝西带门缝，柜顶至吊顶灰缝可读）、卷垫立放柜北端（左）、训练凳横放凸窗带（柜右）、哑铃+底座靠柜南缘地面（中下）、书桌右缘原位；南玻璃栏板（深蓝）为背景
- 目标对象运行时确认：study_seasonal_wardrobe_wall:2、bench_adjustable:3、adjustable_dumbbell_pair:4、rollable_training_mat:5、desk:0/chair:1；重型器械四件与 low_room_cabinet 0 实例

## 异常与处理

- **后端 :4000 采集中途掉线**：Sep02 启动的 `tsx --watch server/index.ts` 其子进程已死（端口无监听），今日 14:43 的另一临时实例在采集开始前退出；页面 initially 显示「后端连接断开」。按项目方式自起 `npx tsx server/index.ts`（:4000，PID 链 59953→59954→59966→59977），reload 页面后 isReady=true、offline 指示消失、`/api/scheme/current` 200。采集结束后已关闭该自起实例。
- 有效性判定：六张 PNG 均经 ReadMediaFile 逐张目检（非空、非 loading、非 overview、无错误 banner、目标对象在画面内）；PNG 尺寸 1600×1000、46–369 KB。

---

# R1 修订补拍（2026-09-04）

R1 源版本变更：master_dressing_table 西移贴窗 @(0.425,6.05)（AABB x[0.20,0.65] z[5.60,6.50]，桌背离西玻璃 0.20m）；dressing_stool 随桌 @(0.42,6.05)；sock_master_projector 迁至 @(0.42,5.78)；南侧窗带新增 master_hot_season_low_dresser @(1.00,9.31) rotation 180（六抽矮柜 0.85m 高，正面朝北）。床、入口柜、DEC-045、书房未动。

**旧证据作废说明**：`view-c-south-curtain_20260903.png` 与 `view-d-west-dressing-floor-socket_20260903.png`（含同名 snapshot）对应 R1 前布局（桌凳 @(1.625,6.05)、旧地插 @(1.56,5.78)、无南侧矮柜），自 R1 起失效，仅作历史留档不删除；A/B/E/F 五张 20260903 证据涉及的床/入口柜/DEC-045/书房均未受 R1 影响，继续有效。

- 采集时间：2026-09-04 10:50–11:00（+08:00），session 复用 `bontop-mff-9e234de3`（close 后重开同名）
- URL：`http://localhost:5173/?v=mff20260904r1`；title 同上；`isReady()`=true；`#warnings` 空、无 banner
- **采集前异常**：页面 initially 报 `配置文件加载失败：config/materials.yaml — expected a document, but the input is empty`。磁盘文件完整（61 KB），系 chokidar watcher 在 10:37 文件保存中间态读到了空内容并缓存失败；`touch config/materials.yaml`（仅 mtime，不改内容）触发 watcher 重载后 `/api/config-status` 全 ok，reload 页面后 banner 消失再开拍
- 后端 :4000 为他人 10:12 启动的 `tsx --watch` 实例（10:35 子进程），本轮非我启动，结束后未动

## R1 运行时查询（采集同会话）

- `furniture:master_bedroom:master_dressing_table:3` AABB x[0.20,0.65] z[5.595,6.505] y[0,1.31]（含桌上镜件）— 与 R1 一致
- `furniture:master_bedroom:dressing_stool:4` AABB x[0.22,0.62] z[5.84,6.26] — 完整收入桌 footprint
- `electrical:sock_master_projector` AABB x[0.36,0.48] z[5.72,5.84] y[0.04,0.06] — 中心 (0.42,5.78) 新位
- `furniture:master_bedroom:master_hot_season_low_dresser:5` AABB x[0.30,1.70] z[9.056,9.55] y[0,0.85]（z 9.056 含抽面）
- 未动项复核：bed_180 x[2.20,4.20] z[6.55,8.35]、入口柜 x[3.564,4.20] z[5.64,6.39] 不变
- 矮柜北缘 z=9.056 至床南缘 z=8.35 净距约 0.71m；床南缘至南帘盒内缘 z=8.70 净 0.35m 不变

## view-c-south-curtain（R1 重拍）✅ 有效

- 文件：`view-c-south-curtain_20260904.png`（422,608 B）；snapshot 同名 .txt
- 相机：orbit，pos (2.55,1.95,9.55) → target (1.05,0.55,7.70)，南侧高位看西北
- 画面：床（右）、床南缘至南侧占用带的地面净距带（中下）、贴西玻璃的梳妆桌+凳收纳（中）、新南侧矮柜东北角入镜（左下）、北侧条带/DEC-045 远景
- 备注：矮柜正面（北脸）在此机位为掠射角，正面近景由 view-g 承担；首拍 pos (2.75,1.95,9.60)→(1.55,0.55,7.55) 矮柜仅边角入镜，已调整重拍

## view-d-west-dressing-floor-socket（R1 重拍）✅ 有效

- 文件：`view-d-west-dressing-floor-socket_20260904.png`（335,704 B）；snapshot 同名 .txt
- 相机：orbit，pos (1.45,0.65,5.70) → target (0.42,0.05,5.78)，桌东侧低位平视桌底
- 画面：新位地插圆盖（画面中央桌腿间地面）、凳（白座面）收入桌下、桌背与西玻璃幕墙 0.20m 间隙关系（深蓝玻璃为背景）
- 目标对象运行时确认：master_dressing_table:3、dressing_stool:4、sock_master_projector（AABB 见上）

## view-g-south-dresser（R1 新增）✅ 有效

- 文件：`view-g-south-dresser_20260904.png`（251,712 B）；snapshot 同名 .txt
- 相机：orbit，pos (2.20,1.50,7.70) → target (0.85,0.40,9.30)，矮柜东北侧看正面
- 画面：六抽（2×3）带拉手正面、细腿落地、南玻璃幕墙/窗帘盒背景（open 态无帘片）；床南缘关系见 view-c 与 AABB（柜北缘 z=9.056 距床南缘 8.35 约 0.71m）
- 备注：更近正面首拍 pos (1.60,1.35,7.95)→(0.95,0.42,9.25) 已被本张覆盖（同文件名，未保留）；床南缘与柜正面几何上无法同框近景（床在机位后方），以 view-c 全景 + AABB 数据佐证
- 目标对象运行时确认：master_hot_season_low_dresser:5（AABB 见上）

---

# R2 修订补拍（2026-09-04，东墙构成修正）

R2 源版本变更：入口衣柜改名收窄为 master_freestanding_wardrobe_062 @(3.90,6.06)（AABB x[3.60,4.20] z[5.75,6.37]，高 2.25m，620mm 宽；门侧缝 0.20m、柜床缝 0.18m）；床不动；东墙点位改枕头区成组：sock_master_bed_l z=7.00、sock_master_bed_r_head z=7.90、switch_master_bed_l z=7.00、壁灯 light_master_wall_l/r z=7.00/7.90 h=1.35。梳妆桌/矮柜/书房/DEC-045 未动，view-d/view-g 的 20260904 证据继续有效。

**旧证据作废说明**：`view-a-master-entry_20260903.png`、`view-b-east-wall_20260903.png` 对应旧 075 衣柜与旧点位，自 R2 起失效，保留作历史留档。`view-c-south-curtain_20260904.png`（R1 版）被 R2 重拍同名覆盖、未保留（过程失误：R2 首拍直接写了同名文件，发现后已将 R2 版改名为 `view-c-south-curtain_r2_20260904.png`；R1 版内容不可恢复，仅存在于描述记录中——其画面构成与 R2 首拍相同，差异仅为背景衣柜为 075 旧款）。

- 采集时间：2026-09-04 11:15–11:30（+08:00），session 复用 `bontop-mff-9e234de3`
- URL：`http://localhost:5173/?v=mff20260904r2`；title 同上；`isReady()`=true；`#warnings` 空、无 banner
- **采集前异常（watcher 假数据复发）**：首次运行时查询发现 switch_master_bed_l/sock_master_bed_r_head/light_master_wall_l/r 渲染在 z=6.65/8.10/6.80/8.10、h=1.60（R2 前旧值），而磁盘 electrical.yaml 已是 R2 值——服务端 chokidar watcher 漏了 R2 保存事件（/api/config-status 仍全 ok，仅内容陈旧）。`touch config/electrical.yaml`（仅 mtime）触发重载，`/api/project` 复核五点全部为 R2 值后 reload 页面再拍
- 后端 :4000 为他人 10:12 启动的 tsx --watch 实例，本轮非我启动，结束后未动

## R2 运行时查询（采集同会话）

- `furniture:master_bedroom:master_freestanding_wardrobe_062:1` AABB x[3.564,4.20] z[5.75,6.37] y[0,2.25]（西缘 3.564 含门板）✓；旧名 master_freestanding_wardrobe_075 运行时 0 实例 ✓
- bed_180 x[2.20,4.20] z[6.55,8.35] 不变 ✓
- 点位根节点世界坐标（reload 后复核）：sock_master_bed_l (4.125,0.70,7.00)、sock_master_bed_r_head (4.125,0.70,7.90)、switch_master_bed_l (4.125,0.70,7.00)、light_master_wall_l (4.20,1.35,7.00)、light_master_wall_r (4.20,1.35,7.90)，全部 visible ✓
- 几何关系：衣柜北缘 z=5.75 距门扇扫掠南界 z=5.55 为 0.20m；柜南缘 z=6.37 距床北缘 z=6.55 为 0.18m；点位以床中心 z=7.45 ±0.45 对称成组

## view-a-master-entry（R2 重拍）✅ 有效

- 文件：`view-a-master-entry_20260904.png`（220,736 B）；snapshot 同名 .txt
- 相机：orbit，pos (2.35,1.75,4.50) → target (4.05,0.80,6.20)，同 20260903 有效机位
- 画面：d_mb 开启门扇（左）、新窄柜西脸双开门（中，620mm 明显窄于 075 版）、门侧 0.20m 缝隙白墙可读、床东北角+床头（右）
- 目标对象运行时确认：wardrobe_062:1、bed_180:0

## view-b-east-wall（R2 重拍）✅ 有效

- 文件：`view-b-east-wall_20260904.png`（211,053 B）；snapshot 同名 .txt
- 相机：orbit，pos (0.55,1.60,6.10) → target (3.95,1.05,6.95)，寝区西侧看东墙（较 20260903 机位略南移，纳入枕头区成组）
- 画面：门洞与新窄柜（不贴门洞、0.20m 门侧缝可读）、非通顶柜顶留白、床头两插座（z=7.00/7.90 对称）位于床头板、两壁灯（h=1.35）分别在插座正上方、门口开关 w_strip_east 墙垛、条带远景
- 目标对象运行时确认：wardrobe_062:1、bed_180:0、五点位（见上）

## view-c-south-curtain（R2 重拍）✅ 有效

- 文件：`view-c-south-curtain_r2_20260904.png`（287,454 B）；snapshot 同名 .txt
- 相机：orbit，pos (2.55,2.05,9.60) → target (2.75,0.55,6.80)，南侧高位正望北
- 画面：床居中（床头两插座可读）、新窄柜在床北缘后方背景（门扇旁白色窄柜）、贴窗桌凳（左）、床南缘净距带（前景）；东墙壁灯两个光点在东墙可读
- 备注：R1 机位 (2.55,1.95,9.55)→(1.05,0.55,7.70) 看西北，衣柜不入画，不满足 R2「背景衣柜源版本一致」要求，已改为正望北机位重拍
- 目标对象运行时确认：bed_180:0、wardrobe_062:1、master_dressing_table:3

---

# R2.1 修订补拍（2026-09-04，switch_master_bed_l 与插座同点修复）

R2.1 源版本变更：switch_master_bed_l 自 z=7.00 北移至 z=6.88（R2 时与 sock_master_bed_l 同点重叠）。其余点位、家具未动。

**旧证据处理**：R2 版 view-b 改名保留为 `view-b-east-wall_r2_20260904.png`（含同名 .snapshot.txt），本段新拍覆盖 `view-b-east-wall_20260904.png`。

- 采集时间：2026-09-04 12:05–12:15（+08:00），session 复用 `bontop-mff-9e234de3`
- URL：`http://localhost:5173/?v=mff20260904r21`；`isReady()`=true；无 banner
- 采集前 `touch config/electrical.yaml` 触发 watcher 重载，`/api/project` 复核：switch z=6.88、sock_l z=7.00、r_head z=7.90、壁灯 h=1.35，全部为 R2.1 值

## R2.1 运行时查询（采集同会话）

- 点位根节点：sock_master_bed_l (4.125,0.70,7.00)、sock_master_bed_r_head (4.125,0.70,7.90)、switch_master_bed_l **(4.125,0.70,6.88)** —— 与插座 z 向分离 0.12m ✓ 重叠修复生效
- 网格 AABB 复核：switch_master_bed_l 面板 x[4.115,4.135] y[0.66,0.74] z[6.84,6.92]（中心 z=6.88 ✓）；sock_master_bed_l 面板组 x[4.082,4.148] y[0.635,0.765] z[6.91,7.09]（中心 z=7.00 ✓）；两面板 z 向净距 0.06m（6.92 vs 6.91 边界相接不穿插）✓
- **壁灯渲染高度不一致（须业主/主案知悉）**：electrical.yaml 声明 h=1.35，运行时点位根节点与拓扑 member-marker 均在 y=1.35；但**渲染的壁灯灯具网格 AABB 为 y[1.48,1.71]**（l/r 同），即灯具锚点 y≈1.60。根因：渲染高度由 `config/render/overrides.yaml` 的 `light_master_wall_l/r anchorY: 1.6` 驱动（理由注明"已审计 Blender 基线：床头壁灯以施工安装高度作为最终渲染锚点"），经 `/api/render-facts/projection` → `shared/project-render-facts-projection.ts` → `LightingFixtureBuilder.addWallLamp` 生效，与 electrical.yaml 的 `height` 字段无关。业主截图观感"壁灯偏高"即此 anchorY=1.60 所致；若需渲染降到 1.35 须改 overrides（本迭代未改，非我权限范围）
- **开关面板不可见（渲染器差距，记录）**：switch 仅渲染为一个 2cm 厚素盒（`switch_2way:part:0`，无面板/按键细节件），正面 x=4.115，比插座面板正面 x=4.09 退后 25mm，嵌于床头板内 → 任何西向机位均不可见。插座+开关"并排"在 3D 画面中只能读到插座，开关位置以 AABB 数据佐证（z 中心 6.88 与插座 7.00 分离）。后续若要求开关可见，需在渲染侧为 switch 点位补面板件并按插座同口径外凸

## view-b-east-wall（R2.1 重拍）✅ 有效

- 文件：`view-b-east-wall_20260904.png`（232,172 B）；snapshot 同名 .txt（同会话重取，与最终机位一致）
- 相机：orbit，pos (1.30,1.45,5.85) → target (4.05,0.80,6.92)，较 R2 机位北移/推近，避开衣柜东南角对左枕位的遮挡
- 画面：门洞与新窄柜（左）、床头两插座（z=7.00/7.90，白色面板可读）、两壁灯金色灯头（y≈1.60，位于插座上方偏高处，与 anchorY 发现一致）、床南侧墙垛开关组（右）；开关面板因上述嵌入原因不可见
- 首拍沿用 R2 机位 pos (0.55,1.60,6.10)→(3.95,1.05,6.95)，左枕位被衣柜东南角遮挡（开关投影点落在衣柜边缘），已弃用重拍；MEP·协调面板曾打开验证拓扑连线（member-marker 均在正确点位），终拍前已关闭
- 目标对象运行时确认：bed_180:0、wardrobe_062:1、五点位（见上）

---

# R2.2 修订补拍（2026-09-04，壁灯渲染高度根因修复）

R2.2 源版本变更：`config/render/overrides.yaml` 的 `light_master_wall_l/r anchorY` 自 1.6 改为 1.35（即 R2.1 段记录的"渲染高度由 overrides 驱动而非 electrical.yaml"根因修复）；render facts 已重新生成、verify:all 通过。其余点位、家具未动。

**旧证据处理**：R2.1 版 view-b 改名保留为 `view-b-east-wall_r21_20260904.png`（含同名 .snapshot.txt），本段新拍覆盖 `view-b-east-wall_20260904.png`。

- 采集时间：2026-09-04 12:20–12:26（+08:00），session 复用 `bontop-mff-9e234de3`
- URL：`http://localhost:5173/?v=mff20260904r22`；`isReady()`=true；`#warnings` 空、无 banner（`#offline-indicator` display:none）
- 采集前 `touch config/render/overrides.yaml` 触发 watcher 重载，`/api/render-facts/projection` 复核 light_master_wall_l/r position.y 均为 1.35 后开拍
- 本次 session 新开浏览器视口默认 1280×577，首拍尺寸不符已弃用，`set viewport 1600 1000` 后重拍（教训：session 重开后须先核对视口尺寸）

## R2.2 运行时查询（采集同会话）

- **壁灯灯具网格新 AABB**（左右各 2 个 mesh：底座 + 灯罩）：
  - `electrical:light_master_wall_l`：底座 x[4.14,4.26] y[1.40,1.46] z[6.97,7.03]；灯罩 x[4.13,4.27] y[1.23,1.37] z[6.93,7.07] → 整体 y[1.23,1.46]，锚点 y≈1.35 ✓
  - `electrical:light_master_wall_r`：底座 x[4.14,4.26] y[1.40,1.46] z[7.87,7.93]；灯罩 x[4.13,4.27] y[1.23,1.37] z[7.83,7.97] → 整体 y[1.23,1.46]，锚点 y≈1.35 ✓
  - 对比 R2.1 实测 y[1.48,1.71]（anchorY=1.6 驱动），整体下降 0.25m，与 anchorY 1.6→1.35 的差值精确一致；与 electrical.yaml h=1.35 现已自洽
- 其余点位不变：switch_master_bed_l 网格中心 z=6.88、sock_master_bed_l z=7.00、r_head z=7.90（沿用 R2.1 数据，本轮未改动）

## view-b-east-wall（R2.2 重拍）✅ 有效

- 文件：`view-b-east-wall_20260904.png`（231,761 B）；snapshot 同名 .txt
- 相机：orbit，pos (1.30,1.45,5.85) → target (4.05,0.80,6.92)，沿用 R2.1 最终机位（避衣柜东南角遮挡左枕位）
- 画面：门洞与新窄柜（左）、床头两插座（z=7.00/7.90）、**两壁灯已降至插座上方近床头高度（y≈1.35，观感与 R2.1 版明显不同——此前悬于墙面高处）**、床南侧墙垛开关组（右）；无 banner、无拓扑叠加
- 目标对象运行时确认：五点位 + 壁灯网格（见上）

---

# R2.3 修订补拍（2026-09-04，床头点位脱出床头板）

R2.3 源版本变更：业主发现床头插座/开关嵌入床头板（点位 h=0.70 vs 渲染床头板顶 0.8m），sock_master_bed_l、sock_master_bed_r_head、switch_master_bed_l 高度 0.70→0.95（高出床头板顶 0.15m）；z 不变（7.00/7.90/6.88）。sock_master_bed_r @(9.15) 保持 0.70 不动。verify:all 与 test:server 517/517 已绿。

**旧证据处理**：R2.2 版 view-b 改名保留为 `view-b-east-wall_r22_20260904.png`（含同名 .snapshot.txt），本段新拍覆盖 `view-b-east-wall_20260904.png`。

- 采集时间：2026-09-04 12:35–12:42（+08:00），session 复用 `bontop-mff-9e234de3`
- URL：`http://localhost:5173/?v=mff20260904r23`；`isReady()`=true；`#warnings` 空、无 banner（`#offline-indicator` display:none）；视口已核对 1600×1000
- 采集前 `touch config/electrical.yaml` 触发 watcher 重载，`/api/project` 复核：三床头点位 height=0.95、sock_master_bed_r height=0.70、z 全部不变

## R2.3 运行时查询（采集同会话）

- 点位根节点：sock_master_bed_l **(4.125,0.95,7.00)**、switch_master_bed_l **(4.125,0.95,6.88)**、sock_master_bed_r_head **(4.125,0.95,7.90)** ✓ z 不变
- 面板网格 AABB（下缘均 > 0.8 床头板顶 ✓）：
  - sock_master_bed_l 面板组 y[0.889,1.011] z[6.914,7.086]（faceplate 正面 x=4.09）
  - switch_master_bed_l 面板 y[0.91,0.99] z[6.84,6.92]
  - sock_master_bed_r_head 面板组 y[0.889,1.011] z[7.814,7.986]
- 与床 AABB y[0,0.8] 不相交（面板下缘最低 0.889 > 0.8）✓
- **开关面板首次在画面中可读**：脱离床头板后，switch 素盒（深灰）与 sock 白色面板并排于床头板顶上方墙面，左枕组"开关在北、插座在南、间距 0.12m"关系画面直读——R2.1 记录的"开关嵌入床头板不可见"问题随本次高度修订自然消解（开关仍为无细节素盒，仅可见性改善，渲染器无面板细节件的差距记录仍保留）

## view-b-east-wall（R2.3 重拍）✅ 有效

- 文件：`view-b-east-wall_20260904.png`（232,096 B）；snapshot 同名 .txt
- 相机：orbit，pos (1.30,1.45,5.85) → target (4.05,0.80,6.92)，沿用 R2.1/R2.2 机位
- 画面：门洞与新窄柜（左）、**左枕组开关（深灰，z=6.88）与插座（白，z=7.00）并排于床头板顶上方墙面**、右枕插座（z=7.90）同高可读、两壁灯 y≈1.35 在插座上方、床南侧墙垛开关组（右）；无 banner
- 目标对象运行时确认：三床头点位（见上）

---

# R5 证据记录（2026-09-05，已因用户指出几何错误作废）

> **retrospective/rebaseline：** 用户指出原 R5 床 `z=7.10` 相对 R3 `z=7.60` 实际北移，不符合“床南移”；同时指出横向隔断柜原 helper 将开启门扇向西扫掠，侵入西侧梳妆区/入口通道。原 R5 screenshots/source version 均 invalid，不能继续作为当前有效证据。本次仅更新事实与验证口径，不伪造新的截图或 runtime evidence；待修正后重新采集。

- 原采集方式：全局 `agent-browser` 命令，专属 session `bontop-r5-20260905`；严格串行 open → wait `--load networkidle` → `window.__APP__.isReady()` ready poll → runtime 查询 → snapshot → screenshot → validate → close。
- 原 URL：`http://localhost:5173/?v=r5-20260905b`；原 `app_ready=true`；warnings 为空；无 config-error banner；这些均不改变几何语义错误。
- 六张 PNG 与六份 snapshot 绑定的是错误 R5 source version，现全部 invalid；不能继续作为当前有效证据，也不能用本次修正后的静态数据冒充新的 runtime evidence。修正后待重新采集；本轮未采集四门真实开启态。

## R5 六视角

- `view-r5-a-entry_20260905`：PNG `evidence/view-r5-a-entry_20260905.png`；snapshot `evidence/view-r5-a-entry_20260905.snapshot.txt`；最终入口机位 orbit，pos `(0.6,1.5,4.6)` → target `(2.0,0.9,5.5)`；非 overview，PNG 已目检非空。
- `view-r5-b-east-wall_20260905`：PNG `evidence/view-r5-b-east-wall_20260905.png`；snapshot `evidence/view-r5-b-east-wall_20260905.snapshot.txt`；非 overview 机位，截图已目检非空。
- `view-r5-c-south-curtain_20260905`：PNG `evidence/view-r5-c-south-curtain_20260905.png`；snapshot `evidence/view-r5-c-south-curtain_20260905.snapshot.txt`；非 overview 机位，截图已目检非空。
- `view-r5-d-west-dressing_20260905`：PNG `evidence/view-r5-d-west-dressing_20260905.png`；snapshot `evidence/view-r5-d-west-dressing_20260905.snapshot.txt`；非 overview 机位，截图已目检非空。
- `view-r5-e-dec045_20260905`：PNG `evidence/view-r5-e-dec045_20260905.png`；snapshot `evidence/view-r5-e-dec045_20260905.snapshot.txt`；非 overview 机位，截图已目检非空。
- `view-r5-f-hvac-overall_20260905`：PNG `evidence/view-r5-f-hvac-overall_20260905.png`；snapshot `evidence/view-r5-f-hvac-overall_20260905.snapshot.txt`；非 overview 机位，截图已目检非空。

## R5 runtime AABB

- 以上旧视角证据属于错误 source version，全部 invalid；本轮不生成浏览器证据。
- 本轮静态目标：bed center @(3.20,7.10)，runtime z[6.17,8.03]；north cabinet center z=5.96，runtime z[5.785,6.135]；south cabinet center z=8.24，runtime z[8.065,8.415]。
- 双普通床头柜优先，但以 runtime 不重叠硬约束优先：北柜 maxZ=6.135=bed.minZ−0.035，南柜 minZ=8.065=bed.maxZ+0.035；未放宽阈值。
- 南柜 runtime maxZ=8.415，距南帘盒北缘 z=8.70 仅 0.285m；若 0.30m 帘盒硬下限适用于床头柜，则专项应保持 BLOCKED，南帘真实堆叠/帘体关系仍 site_pending。
- connection storage：x[0.7,1.4]，z[4.35,4.75]
- table：x[0.2,0.65]，z[5.595,6.505]
- PVC：x[2.07,2.6]，z[2.65,4.67]
- bedside electrical point semantics：北插座 z=6.03 服务北柜；南插座/双控 z=8.18 服务南柜；壁灯保持现有方案值，不因本轮柜体移动改动。

## R5 审查结论

- aesthetic review：`BLOCKED`。旧六视角截图因 source version 错误全部 invalid；不得继续引用。
- functional review：`BLOCKED`。四门真实开启态/人体站位、HVAC 检修与冷凝水维护、东墙结构与防倾倒、南帘开启/堆叠态、真实产品外廓与施工净空尚未完成；静态检查另已保留南床头柜重叠与南帘净距不足失败。
- delivery：`blocked` / `delivery_ready=false`。无新的有效证据；site_pending 与静态几何阻塞均保留。
- 旧 R1/R2/R3 evidence 仍 `invalid` / `superseded_by_source_change`，不得复用为 R5 证据。

---

# R5 clean final evidence（2026-09-05）

本轮 clean final evidence 与 candidate A 当前数值基线绑定，六个 `view-r5-final-*` PNG/snapshot 均登记为 valid。每张均已目检：无 config/materials.yaml banner、非空、非 overview；对应运行时 session 为全局 `agent-browser` 的 `bontop-r5-final-20260905b`，URL 为 `http://localhost:5173/?v=r5-final-20260905b`，`app_ready=true`，warnings 为空。

此前截图顶部出现的 `config/materials.yaml` banner 是 watcher 瞬时空读：watcher 在源文件保存中间态读取到空内容并缓存了错误。源文件实际大小为 64915 bytes；触发 mtime reload 后 `/api/config-status` 返回 ok，reload 页面后 banner 消失。因此，带 banner 的截图全部判定为 invalid；仅 clean final 截图可作为本轮有效证据。

## R5 clean final 六视角

- `view-r5-final-a-entry_20260905`：PNG `evidence/view-r5-final-a-entry_20260905.png`；snapshot `evidence/view-r5-final-a-entry_20260905.snapshot.txt`；valid，目检无 banner、非空、非 overview。
- `view-r5-final-b-east-wall_20260905`：PNG `evidence/view-r5-final-b-east-wall_20260905.png`；snapshot `evidence/view-r5-final-b-east-wall_20260905.snapshot.txt`；valid，目检无 banner、非空、非 overview。
- `view-r5-final-c-south-curtain_20260905`：PNG `evidence/view-r5-final-c-south-curtain_20260905.png`；snapshot `evidence/view-r5-final-c-south-curtain_20260905.snapshot.txt`；valid，目检无 banner、非空、非 overview。
- `view-r5-final-d-west-dressing_20260905`：PNG `evidence/view-r5-final-d-west-dressing_20260905.png`；snapshot `evidence/view-r5-final-d-west-dressing_20260905.snapshot.txt`；valid，目检无 banner、非空、非 overview。
- `view-r5-final-e-dec045_20260905`：PNG `evidence/view-r5-final-e-dec045_20260905.png`；snapshot `evidence/view-r5-final-e-dec045_20260905.snapshot.txt`；valid，目检无 banner、非空、非 overview。
- `view-r5-final-f-hvac-overall_20260905`：PNG `evidence/view-r5-final-f-hvac-overall_20260905.png`；snapshot `evidence/view-r5-final-f-hvac-overall_20260905.snapshot.txt`；valid，目检无 banner、非空、非 overview。

运行时 AABB（同一 clean final source/session）：bed x[2.2,4.2] z[6.17,8.03]；partition wardrobe x[1.394,3.006] z[4.904,5.57]；north cabinet x[3.82,4.2] z[5.785,6.135]；south cabinet 采用 320mm 候选外廓修正，x[3.82,4.2] z[8.08,8.40]；connection storage x[0.7,1.4] z[4.35,4.75]。

证据有效不关闭功能/施工阻塞：真实四门人体站位、HVAC/结构与真实产品外廓继续 `site_pending`；functional review 保持 `BLOCKED`，aesthetic review 也保持 `BLOCKED`，delivery_ready 保持 `false`。

## Front/back semantic correction（2026-09-05）

`master_partition_wardrobe_1600` 已修正横向隔断柜 front/back 语义：背板改为 local z=-0.311（北侧），四扇 `partition-door-*` 改为 local z=+0.311（南侧），门缝/拉手/铰链分别改为约 +0.323/+0.337/+0.327（南面）；关闭态南脸、开启向 +z。柜体、宽度、高度、四扇门数量、house.yaml 中心 @(2.20,5.25)、逻辑 z[4.95,5.55] 均不变。

该 source change 使此前 R5 clean-final 截图与 snapshots 失去同版本有效性：旧截图全部标记 invalid，不生成浏览器证据；后续须在修正后的同一 source version 重新采集并验证。静态专项已明确断言背板北侧、门部件南侧。

## R5 纠偏复盘（2026-09-05，source version r5-correction-20260905）

- 固定基线：bed_180 @(3.20,7.10) r270，runtime x[2.20,4.20] y[0,0.80] z[6.17,8.03]；横柜中心 @(2.20,5.25)，真实完整 mesh 目标 x[1.40,3.00] z[4.95,5.55] y[0,2.15]；地插 @(0.42,5.78)。
- 横柜 recipe 已改为完整 mesh 严格收口；carcass/back panel/4 doors/seams/handles/hinges 均在 envelope 内。背板为北侧 local z=-0.291，门组件由独立 Group/pivot root 表达，默认 closed，stable objectId、hingeSide、materialRole、openLimitDeg=95；真实门状态 helper 可逐门、组合、四门切换，开启方向 +z。柜面到床约 0.65m，门开后正后方约0.25m，不视为宽裕站位。
- 两床头柜统一同规格 350 recipe/type（north/south 仅稳定实例类型），FURNITURE_DIMS 均 0.38×0.35；中心 north z=5.975、south z=8.225，目标 AABB north x[3.82,4.20] z[5.80,6.15]、south x[3.82,4.20] z[8.05,8.40]。南侧 320mm 特例已删除。
- 硬冲突保留：统一350mm北柜 maxZ=6.15，仅距床 minZ=6.17 0.02m，小于原35mm硬净距；南柜 minZ=8.05，仅距床 maxZ=8.03 0.02m，小于目标50mm。南柜至南帘盒北缘 z=8.70 为0.30m，已触硬下限。验证必须保留 error/block，不缩柜、不放宽阈值。
- 电气已统一：sock_master_bed_l z=5.975 h=.75；sock_master_bed_r_head z=8.177 h=.75；switch_master_bed_l z=8.273 h=.75；wall_side west/w_mb_east；switch_master_door 不动；壁灯 z=6.65/7.55 h=1.35，关于床中心7.10对称，render anchorY=1.35。南侧两块86面板要求独立AABB/edge clearance；当前静态源值已分离，真实床头板遮挡仍需runtime/现场复核。
- DEC-045/L连接段：已核对既有四件 runtime/PVC事实：base x[2.17,2.60] z[2.60,4.10] y[0,.62]；lower/main boards x[2.28,2.60] z[2.60,4.10] y[.965,1.035]/[1.515,1.585]；PVC x[2.07,2.60] z[2.65,4.67] y[2.559,2.80]，含 condensate route-cover。当前没有回风/滤网/冷凝水/空调电源维护包络的完整测量事实，未新增桥接，connection storage HVAC/maintenance 结论保持 site_pending/blocked，DEC-045主体与HVAC责任不动。
- 旧R3床心/电气/南柜320语义仅可历史追溯，当前基线不得引用；旧截图全部 invalid，本轮证据需同版本重采。
- aesthetic reviewer：{"verdict":"BLOCKED","blocking_issues":["同规格350柜与床/南帘硬边界冲突未收口","真实产品材质外廓与同版本8视角证据未完成"],"non_blocking_notes":[],"evidence_refs":["r5-correction-20260905"],"requested_changes":[],"assumptions":["site_pending"]}
- functional reviewer：{"verdict":"BLOCKED","blocking_issues":["北/南床头柜硬净距不足","四门真实人体站位未完成","南帘真实堆叠未完成","HVAC/冷凝水/回风检修包络未知","东墙结构与防倾倒未确认"],"non_blocking_notes":[],"evidence_refs":["r5-correction-20260905"],"requested_changes":[],"assumptions":["site_pending"]}
- delivery：blocked，delivery_ready=false；不能宣布delivery_ready。

---

# R5 correction evidence record（2026-09-05，r5-correction-20260905）

- session：全局 `agent-browser`，独占 session `bontop-r5-correction-20260905b`。
- URL：`http://localhost:5173/?v=r5-correction-20260905b`；`app_ready=true`；warnings empty；banner empty。
- 同版本有效文件：`r5-correction-closed.png/snapshot`、`door1.png/snapshot`、`door2.png/snapshot`、`door3.png/snapshot`、`door4.png/snapshot`、`adjacent.png/snapshot`、`all-open.png/snapshot`、`east-wall.png/snapshot`、`hvac-overall.png/snapshot`、`south-curtain.png/snapshot`。逐门浏览器截图部分视角不清，登记为 partial，不将视觉不清描述为完整功能证明。
- 稳定对象查询：四个 door roots 的 objectId prefix 为 `furniture:master_bedroom:master_partition_wardrobe_1600:1`；`doorIndex` 为 0..3；`hinge` left/right；state `closed`；`openLimitDeg` 95。运行时状态旋转修正已由 tests 通过。
- 关键运行时参数：bed x[2.2,4.2] y[0,0.8] z[6.17,8.03]；partition closed target x[1.4,3.0] y[0,2.15] z[4.95,5.55]；all-open local x[-0.8,0.8] z[-0.3,0.641] → world x[1.4,3.0] z[4.95,5.891]；north/south bedside runtime x[3.82,4.2] z[5.80,6.15]/[8.05,8.40]；south curtain nominal 0.30m，exact product/curtain site_pending。
- 南侧电气：z=8.177/8.273，h=.75；壁灯 z=6.65/7.55，h=1.35；地插 `(0.42,5.78)`；L 形维护 gap 仍 site_pending。
- HVAC：`hvac-overall` 仅为整体视角；HVAC 检修、冷凝水与回风滤网维护包络未证明，不能虚构 HVAC 检修态。
- 审查与交付：aesthetic_review `BLOCKED`；functional_review `BLOCKED`。真实四门人体操作、相邻/全开与床/柜/门/梳妆冲突须独立审查；东墙结构/防倾倒/真实外廓 site_pending；delivery blocked，`delivery_ready=false`。
- 旧 R5 说明：front/back semantic correction 前的全部 R5 PNG/snapshot，以及所有旧 R1/R2/R3 screenshots，均为 `invalid` / `superseded_by_source_change`，不得复用或冒充本版本证据。
