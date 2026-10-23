# 项目铁律（AI 会话必读）

## 当前施工状态

- **当前状态：尚未交房，硬装、水电、吊顶和空调均未施工。**
- 设计预演允许比较需要拆改天花或迁改 HVAC/冷凝水的方案；评估时不得以“已施工、拆改成本高”作为否决理由。
- 历史记录中的“已施工/拆改成本”判断仅作为历史背景，不自动作为当前方案约束。
- 若后续状态变化（交房、量房、墙体/机电/窗帘施工、入住），由业主更新本节；更新前的状态是设计讨论和验证的唯一当前口径。

## CAD / 3D 渲染架构

> Blender 主线已暂停并冷归档到 `scripts/archive/blender-pipeline/`；本文件中的 Blender-specific 约束仅在明确恢复冷归档时适用。几何、坐标、电气、家具、碰撞与数据一致性铁律始终有效。
>
> `config/layout/model-geometry.yaml` 是户型几何的唯一权威源；`config/layout/overlay.yaml` 出一切意图。代码只读、只执行，禁止推断。
>
> **视觉反馈类迭代**（业主看图说话 → 改模型 → 再看）开工前读 `docs/visual-change-playbook.md`，并跑 `npm run gate:visual` 确认客户端渲染的就是当前 config（config watch 曾因单文件监听挂 inode、原子替换写后静默断线而不可靠，2026-10-24 已改目录级监听修复；gate 对 schema 拒绝类 STALE 仍是保险丝）。
>
> `parse_cad.py` 仅用于从 CAD 初始化或参考导出，默认不覆盖 `model-geometry.yaml`。需要新行为 → 新增 element type + 声明式配置。
>
> **检视态叠加层（inspection-only）现役清单**：`wall_region`（贴砖，层标签 `wall-tile`）、`paint_region`（涂漆，层标签 `wall-paint`）、`floor_region`/吊顶分区、`pipe-chase`（管井）、HVAC 协调态、MEP 总览、电气回路归属。它们必须**平级且互不引用**：每个 `set*InspectionVisible` 只遍历自己的层标签、按 `userData.inspectionInitial` 快照可逆恢复，禁止互相调用、禁止抽共享材质 helper（pipe-chase 的关闭分支硬编码默认值，会丢掉其他层的初始态）。`paint_region` 额外要求平面朝声明的 `room` 侧外偏移，否则同墙的贴砖面与另一侧涂漆面共面 z-fighting。

## 坐标系约定

- 采用 Three.js 默认右手坐标系：Y 轴向上（高度）。
- 水平面：`x` 为东西向，`z` 为南北向。
- 方向约定：
  - `+x` = 东，`-x` = 西
  - `+z` = 南，`-z` = 北
- 俯视图约定：北朝上（`-z` 方向），南朝下（`+z` 方向）。
- `model-geometry.yaml` 使用 DXF 原值（局部坐标），允许 `z < 0`（如入户花园向北凸出）。
- `overlay.yaml` 必须与 `model-geometry.yaml` 使用同一坐标系，不得保留独立偏移。
- 全局坐标与局部坐标换算：
  - `DXF_mm = (local_m + origin) / scale`
  - `local_m = DXF_mm * scale - origin`

## 坐标系补充约定

- `model-geometry.yaml` 的 `rooms` 使用**中心坐标**：
  - `x` 和 `z` 是房间中心点。
  - `width` 和 `depth` 是房间总尺寸。
  - 西边缘 = `x - width / 2`，东边缘 = `x + width / 2`。
  - 北边缘 = `z - depth / 2`，南边缘 = `z + depth / 2`。
- `model-geometry.yaml` 的 `walls` 使用**角点坐标**：
  - `x1, z1` 和 `x2, z2` 是墙体线段的两个端点。
- 修改房间时，先确定对应的墙体边界，再计算中心点：
  - `x = (west_edge + east_edge) / 2`
  - `z = (north_edge + south_edge) / 2`
- 任何几何修改后，必须运行：
  ```bash
  npm run verify:all
  npm run test:server
  npm run typecheck
  ```
- 修改 `config/house.yaml` 的 `furnishings`（家具摆位）后，必须运行：
  ```bash
  npm run verify:furniture
  ```
  furnishings 条目带 `x/z/rotation` 的为 placed 实例（3D 渲染 + ProjectCatalog/API 暴露位置）；无 `x/z` 的为 count-only（只喂预算/库存）。坐标使用 model-geometry 同一局部坐标系（米），预算 counts 由列表 derive（`ProjectCatalog.getFurnishingCounts`），禁止双写。
- `model-geometry.yaml` 采用 v2.0 vertex 格式：rooms 使用中心坐标 (x, z, width, depth)，walls 使用角点坐标 (x1, z1, x2, z2)。几何修改须同时更新拓扑一致性。使用 `scripts/verify/layout/verify-topology.ts` 替代旧的 `validate-room-wall-alignment.ts`。`scripts/archive/` 保留旧脚本供参考。
- `house.yaml` rooms 的 width/length/area 是 `model-geometry.yaml` 的**镜像字段**（预算算量走 layout-resolver，不读这些字段）；gift_areas 的 expected_centroid 同理。几何修改后 `verify-data-consistency`（已含在 verify:all）会列出漂移项，须同步镜像字段。量房修正只改 model-geometry.yaml，再按脚本输出同步。

## 计划阶段采购预研铁律

本项目尚未交房不等于不能做商品决策。采购研究必须先于采购推荐；量房、接口和本地报价用于验证或反转推荐，**不得**成为把具体候选退化为泛称、只给施工原则或停止竞品研究的理由。

- 涉及商品、品牌、型号、供应商或价格比较时，必须使用 `shopping-research`：先写项目需求 brief，再真实探索、搜索和详情核验候选，并按信息增益继续扩展至收敛或明确阻塞。禁止以配置文件、历史模型、搜索摘要或常识直接伪造“专业买手推荐”。
- 每个一期采购组的交付必须区分三层：
  1. **项目硬约束**：来自当前控制源的预算、数量、接口、阶段与现场前提；
  2. **研究支持的首选/备选**：具体品牌/系列/型号或 SKU、候选链接、已观察的规格与价格口径、为何胜出/淘汰；
  3. **现场反转条件**：哪些复尺、燃气、水电、结构、安装或报价事实会改选。
- “SKU 未选”“展示价不可比”“尚未交房”只能降低推荐强度，并要求写明下一步核验；不能删除具体首选、竞品、取舍或把未证实的推断写成事实。
- 采购推荐必须比较同口径的版本、数量、地区与全安装成本。设备裸价、券价、国补、运费、安装、辅材、增项、税费、交期和保修责任必须分列；不同口径必须明确“不可直接比较”。不得把默认 SKU、起价、套餐价、MOQ 或营销文案当成成交结论。
- 质量、耐用、售后和“官方/授权”只有在本次可追溯证据支持时才能写为事实；没有 reviews 能力时必须标为未验证。允许基于结构/规格做推断，但必须标注为推断和理由。
- `schedule/procurement.md` 是唯一的业主采购入口，不得拆出多份面向业主的矩阵、状态表或排障日志。每个采购组内应以可扫读小标题保留简洁证据摘要（平台/链接、观察时间、状态、规格、价格类型/口径），而非删除证据后只剩泛称。浏览器/CDP 排障只保留为该采购组的一句阻塞说明或在会话中处理。
- 任何声称“可支持购买决策”的采购文件，至少要能回答：买什么具体候选、为何优于关键竞品、预计总成本及其未知边界、品质/性能/维护/视觉取舍、什么事实会反转推荐，以及下一步由谁核验。做不到时只能称为范围/询价计划，不能称为商品采购决策。
- 在重写、压缩或美化采购文档前，先检查是否保留以上三层和竞品原因；禁止为了减少文件、避免表格或增强可读性而丢失已研究的具体候选、证据口径或淘汰理由。

## 决策与调研工作流铁律

> 2026-10-11 增补。由来：六台内机全带泵这一配置从 `DEC-2026-10-03-R6` 到 `DEC-2026-10-04-R1` 从未被论证——R6 只判了主卧一间，R1 以"升级项 / 可省 3D 面板费"覆盖其余五间，无任何一节说明那五间的重力路线为何不成立；同期 `docs/hvac/hvac-pitfall-audit-20261011.md` v4.2 删掉三条已研究证据（容量退化对比、17dB 噪音依据、主卧玻璃负荷核算），而 `test:app` / `typecheck` / `gate:visual` 全绿。以下六条堵这两类失效。

1. **"我们选了 X"必须同时生成一组"X 不工作时"的问题。** 配置/选型落笔时，对每个新引入的部件问：待机、停机、故障三种态下它在做什么、留下什么、谁清理、多久一次、要不要拆顶。答案进 `docs/pending-site-data.md` 或该轮 `open_questions`，禁止留空。（例：六台带泵 → 每台残余水量、接水盘可否不拆吊顶清洗、能否旁通当重力用、有无防滞水设计、残水与回风路径距离。）

2. **禁止在决策记录里写"供后续复盘"。** 发现要么带 owner 与触发条件进 DEC 或 `schedule/phase-*/control.yaml` 的 `audit_log`，要么不写。没有 owner 的技术意见等于没写——`DEC-2026-10-04-R1` 的"我的技术意见"已指出直吹、除湿、同开总量三个问题和"装修期内换机只补差价"这个窗口，无 owner 无日期，七天无人接。

3. **新决策进来先查它推翻了什么。** 改动一项既有结论前，先列出被它推翻的旧结论并逐条说明为何可推翻。禁止以商务理由（"升级项""可省 X 费用"）覆盖未经重新论证的工程结论。

4. **量不到的数标"待实测"，推得出的结论照讲。** "尚未交房"降低的是精度，不是禁止结论。当阻塞项是测量类未知（梁底、立管位、平台净空）时，结构性判断（重力路线有无可能、某部件是否必需）仍必须给出并附证据链。不得因整体未核实就把整个话题 hedge 成"待确认"。

5. **任何文档改写必须 diff 出删了什么。** 本条是「计划阶段采购预研铁律」末条的推广——原仅覆盖采购文档，现推广到全部 `docs/` 与 `config/`。重写、压缩或美化前先比对新旧差异；被删除的具体候选、证据口径、数值依据或淘汰理由必须在改动说明里逐条列出并给理由。禁止以减少文件、避免表格或增强可读性为由静默删除。

6. **review 的 verdict 必须有"实质内容"这一格。** `config_status` / `geometry_status` / `consistency_status` / 渲染与美学 PASS 均不覆盖"这次改动丢了什么"。任何 review 结论必须显式回答三问：删了什么、推翻了什么、新增部分在什么条件下会静默失效。

7. **写 YAML 时值内含 `#` 必须加引号。** `#` 在 YAML 里是注释起始符，写在未加引号的标量后面会把这行剩余内容整段吞成注释——文件仍然合法、解析器不报错、门禁全绿，但数据已经少了一半。已实测：`docs/design-iterations/mb-bedshift-stripcabinet-20260902/object-manifest.yaml` 的 `material: 浅色柜体 #c9c1b5、门板 #e7e0d6、按压无把手` 解析出来只有 `浅色柜体`，三个色值与做法全丢；`status: revoked # 2026-09-02 业主回滚（…）` 则是有意注释。**同一形态两种意图，任何 YAML 解析器和 schema 都区分不了**（js-yaml 5.2.1 六种模式实测全部丢弃 `#` 后内容），所以只能在写入端防：凡值内含 `#`（十六进制色值 `#c9c1b5`、编号 `#41` 等）一律加引号；`status:` 等枚举字段后面跟 `# 说明` 属既有约定，是有意注释，不受此限。

## 电气/家具修改铁律

- 移动任何电气点位或家具前，必须确认目标墙面是**实体墙**（不在 `overlay.yaml` 的 `suppress` 列表中）。
- 玻璃幕墙（`curtain_run` / 被 suppress 的墙）**不能挂载**：电视、插座、挂件、柜体。
- 家具布局与电气点位必须**交叉验证**：插座位置 ≈ 电器实际位置（偏差 > 1.5m 需报警）。
- 修改前先问："这面墙是什么材质？能打孔/挂重物吗？"
- 修改电气/家具后，必须运行：
  ```bash
  npm run verify:all
  ```
- 挂墙点位（electrical/plumbing）坐标压在墙线上时必须显式声明 `wall_side`，否则渲染默认取墙段左侧，可能渲到房间背面。`verify-data-consistency` 的点位专项会以 error 拦截"渲染面与所属房间异侧"（检查逻辑在 `scripts/verify/placement/verify-point-placement.ts`，与 `HouseScene.projectInfrastructurePoint` 同口径）。
- `model-geometry.yaml` 的 wall 条目可带 `structure`（`shear`/`fill`/`curtain`/`new_partition`）+ `structure_status`（`confirmed`/`inferred`），由 `resolveWall` 透传给 lint。`verify:mep` 据此检查非法凿墙/穿梁：穿剪力墙报 `shear_wall_penetration`（双 confirmed 升 error）；`hvac.yaml` 的 `reference_constraints` 转 `confirmed` 且带 `reference_beam_bottom_y` 后，高于梁底的走线报 `beam_collision` error；穿越实体墙必须逐墙声明 `penetration` 且穿点与实际交点偏差 ≤0.25m。墙体结构分类依据与施工口径见 `docs/mep-construction-guidance.md`。

## 碰撞/相机修改铁律

- 新增任何 `SceneElement` 类型时，必须评估是否需要碰撞：
  - 需要碰撞：`wall`, `curtain_run`
  - 不需要碰撞：`floor_region`, `bay_sill`, `railing_run`, `glass_infill`, `shower_screen`
- 碰撞数据提取逻辑在 `app/src/scene/collision-utils.ts`（`extractCollisionWalls`）。
- 修改 `FirstPersonController` 旋转逻辑后，必须跑 `npm run test:app`。
- 修改 `CollisionDetector`、`extractCollisionWalls` 或 `CameraAnimator` 后，必须跑：
  ```bash
  npm run test:app
  npm run verify:all
  ```
- 第一人称 pitch 限制 ±80°，旋转带平滑阻尼。禁止移除 clamp 或改为无平滑直接赋值。
- `CameraAnimator.interrupt()` 必须停在当前位置，禁止跳到动画终点。

## 预算计算三层架构（2026-10-14 建立）

> 由来：2026-10-13 两个扫描代理共报 55+ 项「拍脑袋数据」，其中 11 项直接算错钱。逐条 patch 是错的——它们是 3 个根因的产物：① 同一个量有多处算法、互不对账；② 取不到值时静默发明（`?? default`）；③ 估算和事实没有门控。
>
> **最该记住的一条**：masonry 池曾同时背着方向相反的两个 ±¥3,000 大错（墙砖 +3,113 / 瓦工 −3,356），**净差只 ¥129**。所以「总额看起来合理」被当成了口径正确的证据——这正是全绿还错那么多的机制。

**三层，每层单一实现：**

- **L1 量** —— 每一类量在 `shared/` 只有一个 `*_takeoff.ts`：`masonry-takeoff.ts`（墙砖/地面/防水台）、`ceiling-takeoff.ts`、`mep-takeoff.ts`、`paint-scope.ts`。**禁止在 `server/` 写第二套算法。** 已废除的拍系数：`wetWallArea = (宽+深)×2×高×0.7`（算出 65.699㎡，权威是声明实算 30.8105㎡）、`linearKitchen = 深×0.8`（算出 1.92，house.yaml 柜体段实计 4.36m）。
- **L2 价** —— 每个 trade 一张 `shared/quote-cards.ts` 报价卡（`masonry-labor.yaml` / `ceiling-quotes.yaml` / `mep-quotes.yaml`）。`per_unit: null` = 待报价：**数量显形、金额不编**。`comparable: false` 由机制自动判定（缺 `scope_note` / 有待报价行 / 空卡 / `evidence.kind !== 'written_quote'`），不靠人记得。
- **L3 额** —— `planned_cny`（批准额）与算出值分离。`estimated_need_cny` **不是组件和**（是业主询价轮次目标），改成派生会静默关掉 PKG-110 的 ¥2,000 缺口。

**口径（2026-10-14 阶段 5 起）**：`actual` 只计**已取证**材料款 + 人工，不再含 `candidateActual`。`autoActual = verifiedActual + candidateActual`（材料全额）保持不变，这个不变量由测试对全部科目逐条断言。`totalActual` 因此从 157,870 降到 65,174——**不是预算变少，是把 39 条未取证候选价从「已花的钱」挪回「假设」**。

**铁律：**
- 改任何量之前，先确认它是否已有 `shared/*-takeoff.ts`；有就读它，**不许新写公式**。
- `option.price_per_unit` / `coverage_per_unit` / `loss_rate` 缺失一律 throw（`pricingOf()`），不许 `?? 0` / `?? 1` / `?? 1.0`——那会让面积型材料按"片数×单价"计价，量级错 100 倍。
- `0` 是合法声明值（开发商已装 / 尚未定价），「缺字段」与「声明为 0」是两件事，不许混为一谈。
- 「不写 `openings` 键 = 墙上没有洞」是 `model-geometry.yaml` 的既有约定，`PaintWallInput.openings` 已提为类型必填；全仓只保留两处适配器显式落地它。
- 新增 config 文件必须在 `config/facts.yaml` 的 coverage 矩阵登记，并在 `readers` 里点名真实读者——否则 `declared_reader_does_not_read`（error）。

**三道对账契约（防复发，`config/facts.yaml`）**：`c.*_parity`（量在 overlay 实算 / control.yaml `quantity_declared` / 预算 lineItems 三处必须相等）、`c.*_single_source`（费率表全仓只出现一次）、`verify-model-package-links`（死引用——`/api/project` 500 那次，`assertSelector` 早在代码里，只是没人在 verify 时调它）。

**改预算链后必须跑**：
```bash
npm run typecheck
npm run test:server
npm run test:app
npm run verify:all
```

## 渲染性能铁律

- 玻璃材质默认禁用 `transmission`（会触发 three.js 全场景二次渲染，draw call 翻倍），走 `transparent + opacity` 快路径；高保真仅在导出/取证时经工具栏「玻璃质感」开关临时开启。新增玻璃类材质必须走 `BrowserSceneMaterials.registerGlass` 注册，禁止直接写死 `transmission > 0`。
- 静态 unit 经 `SceneBatcher` 跨 unit 合批为 `BatchedMesh`：电气点位（`electrical:*`）、装饰层 plumbing marker、HVAC 实体（`HVAC_CONFIRMED_ENTITIES`）、铰链门。**家具不合批**（碰撞分析需逐 unit 改 emissive）；滑动门、窗帘、灯具等有动态行为的不合批。新增需要动态改材质/显隐/开合的零件不得加入合批 scope，或在 mesh 上标 `userData.noBatch`。
- 合批后拾取走 `batchId → batchUserData` 桥接（`targetFromIntersects`）；unit 级显隐用 `batcher.setUnitVisible` 桥接；统一换色用 `batcher.updateScopeMaterials` 桥接（见 `setDoorMaterial`）；`hvac-export-check` 已识别批次元数据，统计实体时不要绕过它直接遍历场景。
- GLB 导出前后必须 `restoreStaticBatches` / `reapplyStaticBatches`（GLTFExporter 不认 BatchedMesh），且 restore 必须先于 `getHvacExportStatus`。
- 修改 `SceneBatcher`、`SceneMeshMerger` 或玻璃材质链路后，必须跑：
  ```bash
  npm run test:app
  npm run typecheck
  ```

## CI 基线纪律（2026-10-23 增补）

> 由来：PR 评审每轮结尾都是「CI 状态未返回、测试结果未独立重跑」——评审者只能信提交人贴的数字。本仓有存量红，直接「全绿才过」只会让 CI 永远红、没人看，故采用基线对照（`ci/check.mjs`，本地与 Actions 同一入口）。

- **判红条件只有一个**：出现 `ci/baseline/` 之外的新失败。基线内失败照常完整呈现在日志里，红不禁止合并（未设分支保护），合并仍由业主决定。
- **修掉存量红必须在同一个 PR 里删掉对应基线行**；删行是评审可见的战果，不许留着基线装作还在失败。
- **禁止往基线里塞新失败来放行**：基线只许删、不许增；确需新增（既有失败改名、套件拆分等）必须在 PR 描述里逐条说明并经业主评审，不得静默扩基线。
- 本地复现 CI 结论用 `npm run ci:typecheck` / `ci:test-server` / `ci:test-app` / `ci:verify-all`，与 Actions 同一解析口径。

## 证据分级与退场铁律（2026-10-22 增补）

> 由来：`docs/design-iterations` 65 轮攒下约 88MB 截图，95% 是可由 config 重演的过程图；2026-10-22 全仓复扫确认关账后的 evidence 图只有 19/385 还被仓外文件引用，AI 必读清单也从不含 evidence。过程证据只有当轮价值，永久进 git 是把日志当资产。以下四条堵「只生不死」，与「文档改写必须 diff 出删了什么」并行不悖：删除走登记通道即合法，静默删除仍禁止。

- **过程物不进 git**：中间版截图（v1/v2/before 等过程版本）、`*.snapshot.txt`、`*.runtime.json` 等运行转储一律写入 `tmp/capture/` 或当轮删除；抓图/绘图脚本默认输出 `tmp/capture/`，禁止再把任何一轮的 evidence 目录硬编码为默认输出（终稿入仓走关账挑选，不走脚本直写）。
- **进仓的只有终稿与外部原件**：一轮关账时每个视角至多留 1 张终稿图，置于该轮 evidence 的 final 子目录；外部原件（合同、报价、厂家资料、业主提供图，不可再生）正常进仓，并在该轮 brief 登记来源。
- **关账即瘦身**：review_state 转为 delivery_ready、superseded 或移入 archive 时，收尾动作必须包含把本轮 evidence 压缩到终稿集；删了什么逐条写进 commit message。
- **一题一文档，退场不建归档目录**：新认知写入既有主题文档，禁止新开散稿；文档退场 = 直接删除 + 在索引留一行墓碑（名称 + 关账结论 + 删除 commit），git 历史即归档，不另建 legacy/archive 目录。新轮次的结构化文件只写单个 round.yaml 一件套（brief/datum/fact_table/objects/review/index 段），不得另加 work-record、evidence-notes 等附属散件；INDEX.yaml 由 `npm run docs:generate-index` 从各轮 round.yaml 的 index 段生成，禁止手改。豁免两轮保留原文件：hvac-resix 的 fact-table/design-datum（facts error 级读者）、mep-lint-governance 的 review-manifest.json（治理基线读者），其余段仍并入 round.yaml 并在 index.exempt_files 注明。
