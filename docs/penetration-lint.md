# 防穿模 linter（penetration）

入口是 `npm run verify:penetration`，并已纳入 `npm run verify:all`。本 CLI 只回答一个问题：**有没有两块实体占了同一块空间**。声明完整性、墙线拓扑、运行时权威性、灯具宿主由 `npm run verify:spatial` 负责（见 [`docs/spatial-validation.md`](./spatial-validation.md)），两者不重复判同一件事，`tests/server/penetration-boundary.test.ts` 一票否定越界。

## 权威输入与单一真相源

几何坐标一律来自 `buildScene()` 的 runtime mesh：`shared/penetration/scene.ts` 的 `loadSceneInputs()` / `buildRuntimeScene()` / `collectPenetrationObjects()` 是唯一实现，`verify:spatial` 与 `verify:penetration` 都经过这里取场景——因此两边不可能各自收集到不同的物体。容差只读 `config/spatial-validation.yaml` 的 `tolerance_profiles`；规则、严重级与豁免只读 `config/anti-penetration.yaml`。**这两个配置文件都不复制任何坐标或容差**，出现第二套数字即视为缺陷。

## 规则分层

规则实现是纯函数（`shared/penetration/rules.ts` 的 pair 检查、`clearance.ts` 的净距、`openings.ts` 的洞口），登记表在 `config/anti-penetration.yaml`：

| 规则 id | code | 判据 |
|---|---|---|
| `pen.furniture.wall` | `furniture_wall_collision` | 家具进入墙体实体。先对 runtime 墙 mesh 的有限分段/真实厚度调 `segmentSolidOverlapDepth`，因此只进入一侧墙厚、尚未越过中心线也 fail-closed |
| `pen.furniture.wall_clearance` | `furniture_clearance_insufficient` / `furniture_endpoint_clearance_insufficient` / `furniture_host_unknown` / `furniture_host_runtime_missing` | 定制家具对宿主墙完成面的退让净距与端部收口；`site_trim` 现场裁切语义随 `evidence` 带出 |
| `pen.furniture.glass` | `furniture_glass_collision` / `furniture_glass_clearance_insufficient` | 家具穿越或贴近玻璃/窗帘/栏杆路径；净距按 `curtain_wall` profile |
| `pen.furniture.ceiling` | `furniture_ceiling_collision` | 家具进入吊顶实体/降板 |
| `pen.furniture.furniture` | `furniture_furniture_collision` / `furniture_furniture_contact_tolerance` | 家具互撞；≤ `collision_margin` 的接触由规则内部降级为 warning |
| `pen.glass.glass` | `glass_runtime_collision` | 玻璃/栏杆 runtime mesh 无共同端点闭包即互撞；栏杆 handrail/bar 是内部构造件，不作为独立 pane |
| `pen.furniture.opening_blocked` | `pen.furniture.opening_blocked` | 家具 footprint 压住门洞清宽（door/cased_opening/sliding_door；窗洞不挡通行） |

**severity 是下限，不是开关**：规则按几何量自判的级别若更严则保持（配置盖不住 error），若更松则被抬到下限——配置只许加严，不许放宽。因此同时产出 error 与 warning 两种 code 的规则（`pen.furniture.glass`、`pen.furniture.furniture`），下限必须写 `warning`；写成 `error` 会把「净距不足」这类本应只显形的问题抬成阻断级。`enabled: false` 不静默消失，而是降为 info 并在 message 标注。

**豁免带保质期**：`config/anti-penetration.yaml` 的 `waivers[]` 必须写 `reason` / `owner` / `expires`，按「规则 + 实体对」匹配（顺序无关），必须绑定稳定 runtime id，禁止按家具类型全局放行。到期自动复活为 error 并带上豁免编号，不存在永久静默。

**登记表与实现互为镜像**：申报了没实现（`pen.rule_unimplemented`）、实现了没申报（`pen.rule_undeclared`）、重复 id、非法 severity、未知 code、豁免缺字段或引用未知规则，全部 fail-closed。新增规则必须同时落实现与配置申报，只改一边会红。

## 机电协调构件的参与策略

`config/spatial-validation.yaml` 的 `mep_coordination_types` 历史上被整体排除在「家具互撞」之外（管线/检井构件必须有尺寸，穿墙由 MEP 专项校验负责）。这个排除现在是**显式申报**的：`config/anti-penetration.yaml` 的 `mep_parts.participation` 逐类型声明 `excluded`（不作为实体参与互撞）或 `solid`（按实体参与墙穿透），未申报的 placed 类型 → `pen.mep_participation_undeclared` fail-closed。

2026-10-09 实测：`mb_vanity_pvc_service_chase` 的包络是 0.94×2.59×2.15m 的**预留区**（穿越 4 段墙、与 6 件家具重叠），不是实体管。该口径未裁定，已登记为 [`docs/pending-site-data.md`](./pending-site-data.md) #55 显形债务——未裁定前不当作缺陷，也不为了绿灯改坐标。

## CLI 契约

`--json` 不含时间戳、issue 按 `code/entity/message` 稳定排序；`--out <path>` 写入同一份结构化报告，缺路径 exit 2；`errors > 0` → exit 1。每条 issue 固定 `level` / `code` / `entity` / `source` / `message` / `evidence`。权威配置读不动或 runtime 场景建不起来时 fail-closed（`scene_inputs_unreadable` / `scene_build_failed`），绝不因为拿不到几何就假装没有穿模。

`--shadow` 附加「规则判定 vs OBB 判定」对照与 `relationships` 白名单审计，进 `report.shadow`，**不计入 errors/warnings、不影响退出码**。`--today YYYY-MM-DD` 注入豁免到期判定日（默认取运行日），保证测试可复现。

因为到期判定日可注入，**waiver 到期那天零代码改动就会由绿转红**：到期豁免不静默失效，原问题按原规则 code 复活，message 带上「（豁免 `<id>` 已于 `<date>` 到期，自动复活）」、`evidence` 带上 `expired_waiver` / `waiver_expires`（穿透层没有独立的 `pen.waiver_expired` code，复活项沿用原规则 code，只靠这两处标注可追溯）。这是到期复活机制的设计意图，不是 CI 故障——CI 上看到「昨天还绿今天红了」，先按这两个信号查豁免到期，别去动几何。

## OBB 窄相位：已实现，未接管判定

`shared/penetration/obb.ts` 由 runtime mesh 的 `matrixWorld` + `geometry.boundingBox` 推导 OBB，15 轴 SAT 求穿透深度与最小平移向量（MTV）。OBB 恒包含于 AABB，因此 OBB 判相交 ⇒ AABB 必判相交：**只能消假阳，不可能放过真阳**。

适用范围按 2026-10-09 实测收窄，只对照家具↔家具：

- 家具↔墙：SceneBuilder 的家具/墙共用**墙中心线** datum，家具包络按中心线 authoring，与墙 slab 固有 ≤ 半墙厚（实测一律 0.06m）的 representation contact；规则用 `segmentCrossingDepth` / `segmentSolidOverlapDepth` 判「是否真穿越」。OBB 直接和墙 slab 比等于换一套口径重判。要用 OBB 判墙穿透，必须先把墙退化成中心线平面做 OBB-vs-plane 测试。
- 家具↔玻璃：规则走 concrete overlay path 的穿越判定，不是 AABB 相交。
- 家具↔家具：规则判据就是 AABB 重叠深度，这一档才是 OBB 真正的用武之地（旋转家具的 AABB 保守 → 假阳）。

当前 house 的 shadow 结论：候选对 0（没有未经豁免的家具 AABB 相交对，OBB 今天无可细化）；`relationships` 豁免审计 11/11 全部经 OBB 确认真的相交、0 条假白名单。

**切 authoritative 的前置条件**（两条都满足才发 DEC 切换）：① shadow 差异清单经人工逐条过目；② 家具↔墙的中心线口径问题先解决（墙退化为中心线平面）。未满足前不得切换。

## 当前结论与测试

2026-10-09：0 error / 8 warning，全部是 `furniture_glass_clearance_insufficient`（阳台洗烘vs北凹口幕墙、厨房柜体vs VRV 栏杆/入花园栏杆、厨房桥台面vs北窗帘、主卫台盆柜vs西幕墙两段、书房桌vs西幕墙）。这些是既有净距不足，属显形债务，不是本轮回归。

测试：`tests/server/penetration.test.ts`（pair 规则、净距、洞口、真实 house、此前零覆盖的四个 code）、`tests/server/penetration-registry.test.ts`（登记表/severity 下限/豁免/机电策略/兄弟 mesh 不变式）、`tests/server/penetration-obb.test.ts`（OBB 推导、SAT 深度与 MTV、旋转假阳标准构型、shadow 审计）、`tests/server/penetration-boundary.test.ts`（越界一票否定）。

## 已知限制

- **活动包络未覆盖**：门扇开启弧、推拉门开启态、冰箱/洗碗机/洗衣机门、抽屉/拉篮、椅子拉出、衣柜平开门 vs 床——这些是「用起来才穿模」，当前只验默认静态状态，不会被本 CLI 假装覆盖。
- **机电预留区口径未裁定**：见上文与 `docs/pending-site-data.md` #55。
- **OBB 未接管判定**：见上文前置条件。
- 真实产品外廓、窗帘软包络、设备安装/检修余量、厂家深化与量房误差仍需现场/厂家数据更新；本轮不扩展 3D UI 面板。
