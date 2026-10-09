# 决策日志 · 照明 · 起夜灯

> 本文件是 `docs/decision_log.md` 2026-10-09 主题拆分（DEC-2026-10-09-S01）的产物：
> 收录范围 = 灯光回路语义、起夜路径照明、夜灯形态的新增与删除。条目为原文件的连续切片，正文未改写；文件内按时间正序。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-05-R15` 起夜路径照明 + 客房床头组落地（B-2，全部 candidate_not_frozen）
- `DEC-2026-10-05-R17` 客房不做嵌入式床头灯与阅读灯
- `DEC-2026-10-07-R12` 删除客卫内置起夜灯，后续按需使用可插拔感应夜灯
- `DEC-2026-10-07-R13` 夜灯模型改为贴墙灯体 + 低位落地引导柱
- `DEC-2026-10-07-R14` NP-5 吸附到最近柜体端板，取消通道落地柱
- `DEC-2026-10-07-R15` 删除客厅中段 NP-4b 起夜灯
- `DEC-2026-10-07-R16` 移除夜灯通用落地柱形态

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-10-05-R15 起夜路径照明 + 客房床头组落地（B-2，全部 candidate_not_frozen）

- **日期**：2026-10-05。依据 `docs/design-iterations/parent-room-study-swap-20261005/electrical-recommendation-20261005.md`（业主勾选"都做"）。
- **R4 新增 `night_light` 点位类型**：电气枚举（schema + types + 3 处 LIGHT_TYPES）新增 `night_light`；`LightingFixtureBuilder` 增加低位灯渲染件（0.12×0.05×0.08 灯体 + 下向光斑，贴墙时按 wall_side 内推 0.06m，落地立柱原位）；不复用 `ceiling_light`/`downlight`，避免把 0.3m 灯拿去和 2.5m 吊顶比净空。
- **R1 起夜灯并入既有照明回路（不开新回路）**：9 个 night_light——客房内 2（`night_guest_bed_side`/`night_guest_head`）与客卫 3（`night_gbath_door`/`night_gbath_vanity`/`night_gbath_inner`）并入 `lighting_bedrooms_bath`（≤0.8→≤0.9kW）；门外/客厅 3（`night_guest_door`/`night_living_north`/`night_living_mid`）与走廊口 1（`night_corridor`）并入 `lighting_entry_base`（≤0.3→≤0.4kW）。**回路总数仍按 22 收口（+微蒸烤），不起夜 23**。修订标准 v1 的"独立成路"硬规则为"优先并入既有照明回路；仅当明确要求故障隔离时才独立成路"。
- **R2 客房床头组**：`sock_guest_bed_l/r` @(16.40, 7.30/7.90) h=0.7（挂 `w_east_upper` 卧室侧）、`switch_guest_bed` @(16.40,7.60) h=1.3，并入 `ordinary_power_parent_child`（≈1.2→≈1.3kW）；`control_study_light` 由单控扩为"门+床头"双控。**坐标系纠正**：v0 排布的床床头在**东外墙**（bed_150 r270），不是北墙——建议稿初版把床头电位写在 `w_be_north` (14.60/15.60, 5.55) 是错的，实施时按实际床头位改到东墙；`sock_study_extra`（h=0.3，北墙低位）明确降级为备用，不作床头电位。
- **R3 书房三个床头遗物保留改语义**：`sock_parent_bed_l`（离桌 2.6m 改"西墙备用/未来第二工位"）、`switch_parent_bed`（改"西墙双控备用联"）、`ac_panel_parent`（改"书房墙面线控器"，门垛仅 0.15m 容一板，位移待量房）。未删点位、未动 `fact.electrical_points_count` 对账以外的东西。
- **点位与账目**：电气点位 98 → 110；照明回路成员 15 → 24、普通插座成员 39 → 41、coveredPoints 68 → 79；`config/electrical-topology.yaml` 与 `docs/mep-construction-guidance.md` 第 0 节规模表同步 110。
- **site_pending（未假装已定）**：`w_east_upper`/`w_be_north` 均为剪力墙 inferred，床头插座/双控/小夜灯的开孔与挂装条件待量房探测；`night_living_mid`（客厅中段约 4m 开敞区）取电方式未定（地插/家具灯带/就近插座），若不做则 NP-3 与 NP-5 暗区超出标准 §4-1 的 3m 上限；走廊条带 x[4.20,7.20] z[4.30,5.55] 在 model-geometry 无 room 归属，`night_corridor` 只能落在客厅侧走廊口。
- **验证**：`verify:all` / `test:server` 609/609 / `typecheck` / `test:app` 470/470 全绿；`verify:spatial` 0 error（night_light 高度区间由空间校验的外观检查覆盖，runtime 盒体在房间竖向包络内）。
- **下一步**：批次 C 剩余（起夜灯选型与采购归二期）、批次 D 浏览器证据、B-2 中床头电位最终坐标待量房后从候选转为确认。

### DEC-2026-10-05-R17 客房不做嵌入式床头灯与阅读灯

- **日期**：2026-10-05。关闭 R15 遗留的唯一照明开放项。
- **决策（业主）**：客房（bedroom_se，供父母/客人）**不做嵌入式/壁装床头灯，也不做阅读灯**。
- **影响（简化）**：
  1. 东墙 `w_east_upper`（剪力墙 inferred）上**不再有任何灯具挂装需求**——但 `sock_guest_bed_l/r` 两个插座和 `switch_guest_bed` 的底盒仍要进这面墙，剪力墙探测照做；
  2. 客房照明收敛为：吸顶灯 `light_study_dome` + 起夜低位灯 `night_guest_bed_side`（床沿）+ `night_guest_head`（床头小夜灯，触摸+感应，**非阅读灯、非嵌入**）；
  3. `night_guest_head` 若业主后续也认为属于"床头灯"要撤，最低成本替代是**插电款小夜灯插在 `sock_guest_bed_r` 上**（零挂装、零墙面穿孔、零回路改动）——本决议不撤 NP-2；
  4. 书房书桌台灯同理走插电款（`sock_parent_desk` count 2，电脑专用回路），不加任何墙面灯具。
- **不改配置**：本决议只关闭开放项、更新台账；`config/electrical.yaml` 无改动。

### DEC-2026-10-07-R12 删除客卫内置起夜灯，后续按需使用可插拔感应夜灯

- **日期**：2026-10-07。触发：业主认为马桶/洗漱区低位灯会增加防水与安装复杂度，并确认客卫内可以直接打开现有卫生间主灯。
- **裁定**：删除客卫三个内置 `night_light` 点位：NP-6 `night_gbath_door`、NP-7 `night_gbath_vanity`、NP-8 `night_gbath_inner`。夜间入卫后使用现有 `light_gbath_panel`，由 `switch_gbath` 手动控制；若入住后发现需要自动低位引导，再按需添置可插拔感应夜灯，不纳入本期预埋和回路方案。
- **配置影响**：`config/electrical.yaml` 点位数 111 → 108；`lighting_bedrooms_bath` 成员 14 → 11（9 个日常灯 + 2 个客房起夜灯），照明回路成员总数 24 → 21；删除三个对应的 `config/render/overrides.yaml` 渲染覆盖。客卫普通照明回路与 `control_gbath_light` 保留。
- **实例文档**：更新 `night-path-lighting-instance.md` 的有效点位、控制和入口手动开灯说明；2026-10-05 的 `electrical-recommendation-20261005.md` 保留原建议作为历史记录，并标记本条为后续裁定。
- **边界**：本裁定只删除客卫内置夜灯，不代表卫生间照明防水/湿区设计已验收；现有客卫平板灯方案不变。若后续使用插电感应夜灯，按实际安装位置和产品要求核对防溅/湿区条件。
- **验证**：`data/project-render-facts.json` 已由投影生成器重生成（21 灯具）。`npm run verify:all` 在沙箱内被 tsx IPC 管道 `listen EPERM /tmp/tsx-1000/*.pipe` 阻断；将 verifier 编译到 `/tmp` 后分别运行，layout/topology、家具、rules、collision、spatial、MEP、电气、render-facts、lighting-config、facts、MEP takeoff、schedule 共 13 项通过。`verify-data-consistency` 仍报既有 `sock_child_ac` 墙段越界错误（tracked `docs/pending-site-data.md #42`，与本条无关）。本轮未运行测试。
- **决策人**：业主。


### DEC-2026-10-07-R13 夜灯模型改为贴墙灯体 + 低位落地引导柱

- **日期**：2026-10-07。业主要求改进夜灯模型，避免浏览器把低位灯显示为扁片或普通吸顶灯。
- **实现**：新增共享 `NightLightGeometry`，浏览器与 GLB/export 共用同一模型。贴墙灯显示竖向外壳、感应窗、下沿扩散片与遮光檐；灯体中心按墙半厚度 0.06m + 灯体半深 + 3mm 余量推出完成面。无墙点显示约 0.30m 总高的底座灯柱、环绕扩散段与感应带。浏览器 `InteriorLightingSystem` 增加独立 `night_light` 分支，使用低亮度、短距离向地照明，不再落到 dome fallback，也不再用实体扁平光斑。
- **NP-5 口径**：`night_corridor` 暂保留落地柱。`w_st_east` 客厅侧被电视墙柜体占用，`w_st_north` 右端邻书房门洞；电气点位仍没有 `wall`/`wall_side`。已修正 `config/render/overrides.yaml` 中误写 `w_st_north` 墙装的理由，统一为开敞点落地灯候选。取电和实际安全净空仍待现场深化。
- **边界**：本条改进的是静态模型与光束表现。传感窗/传感带是外观标记，浏览器尚未实现人体接近触发、延时熄灭或夜间照度阈值；落地灯柱也尚未接入第一人称碰撞检测，因此不能用本条证明真实感应行为或通行安全。另：业主已明确 NP-2 用插电式床头小夜灯、不做嵌入/壁装；现 `night_guest_head` 电气源仍有 wall/wall_side 锚点，实际插座供电与配件建模未在本条更改中收口。
- **验证**：`npm run typecheck` 通过；`verify:lighting-config` 与 `verify:project-render-facts` 编译后检查通过（21 lighting fixtures）；浏览器 `http://localhost:5175/` 就绪，wall/floor night-light 对象均存在，保存近景见 `tmp/screenshots/night-lights/night_wall_closeup_after_v4.png` 与 `night_corridor_isolated_after_v2.png`。未运行测试套件。
- **独立审阅**：夜灯几何审美审阅 `PASS`；功能审阅 `BLOCKED`（感应触发与落地灯碰撞仍未实现）。
- **决策人**：业主。

### DEC-2026-10-07-R14 NP-5 吸附到最近柜体端板，取消通道落地柱

- **日期**：2026-10-07。触发：业主指出 NP-5 落地柱立在通行线上，要求吸附到最近墙面或柜体。
- **事实核查**：`w_st_east` 客厅侧被通顶柜/电视低柜占用；`w_st_north` 右端邻 `d_study` 门洞且实体门垛仅 0.15m。最近可用支撑是 `wall_cabinet_tall` 北端板，柜体 footprint x[7.20,7.55] z[5.55,6.90]。
- **裁定/表达**：NP-5 从 `(7.60,5.30)` 改为柜体北端板 `(7.45,5.55)`、y=0.30m，朝北照向走廊；在 `electrical.yaml` 声明 `mount_anchor.kind: furniture_face`、稳定实例 `furniture:living_dining:wall_cabinet_tall:0`、`face: north`、`surface_gap: 0.003`。不再把落地柱用于 NP-5，也不根据备注自动猜宿主。
- **回路/数量**：点位仍为 `night_corridor`，原 `entry_base` 回路与 108 个点位总数不变。同步更新 `strong-light-entry-night-corridor` 到 `(7.45,5.55)` 柜面锚点；该支路延伸至柜端板，MEP 算量强电管总长 539.8m → 540.2m（+0.4m）。柜端板固定方式、柜内暗藏供电/检修路径仍需柜体与水电深化核实。
- **覆盖余量**：NP-4b `(11.00,5.60)` 到新 NP-5 `(7.45,5.55)` 约 3.55m，仍略超夜路径标准 3m 候选上限；须实走后另行调整，不在本条猜测新点位。
- **验证**：`npm run typecheck` 通过；render facts 已投影到柜面 `mountAnchor`；`verify:spatial` 0 error（含宿主存在、柜面范围/端边余量/3mm gap 检查），ProjectRenderFacts 与 lighting-config 检查通过。`verify:mep` 0 errors / 125 warnings；`verify:mep-takeoff` 通过，路由端点 133/133、回路/覆盖度检查通过。提权运行的 `npm run verify:all` 执行到 data consistency 后被既有 `sock_child_ac` 墙段越界错误（#42）拦停；其余前置拓扑/布局/家具/rules/collision/spatial 检查通过。并行工作区同时存在 DEC-2026-10-07-M05（MEP 路由 102→133）；R14 仅调整 `strong-light-entry-night-corridor` 终点，不改动 M05 其它路由。浏览器确认 `mountKind=furniture_face`、宿主 `wall_cabinet_tall:0`，SpotLight runtime 朝北；柜端板近景见 `tmp/screenshots/night-lights/night_corridor_cabinet_face_after_v2.png`。NP-4b 落地灯柱碰撞与实际人体感应行为仍未实现；本轮未运行测试套件。
- **决策人**：业主。
### DEC-2026-10-07-R15 删除客厅中段 NP-4b 起夜灯

- **业主决定**：删除 `electrical:night_living_mid`（NP-4b）及其 `strong-light-entry-night-living-mid` MEP 路由。夜灯尽量利用柜体隐藏；NP-5 已吸附到 `wall_cabinet_tall` 北端板，优先在柜体侧隐藏供电。当前不新增柜体灯带或替代点位，避免为没有明确宿主与位置的方案增加复杂度。
- **现状**：建模夜灯点位由 6 个减为 5 个（NP-2 规划为插电小夜灯，其电气接口另行收口）；电气点位由 108 减为 107；MEP 路由由 133 减为 132。NP-4a `(13.40,5.10)` 到 NP-5 `(7.45,5.55)` 直线距离约 5.97m，超过夜路径标准 §4-1 的 3m 暗区候选上限。该覆盖缺口保持开放；需现场走路径、核照度后再决定是否有合适柜体可承载补光。日常顶灯不计为低位自动感应覆盖。
- **验证**：`npm run typecheck` 通过；`verify:mep` 0 errors / 125 warnings；`verify:electrical` 0 errors / 53 warnings；ProjectRenderFacts（20 fixtures）、lighting-config、facts 对账通过；MEP takeoff 通过，132/132 路由端点解析，534.0m conduit，97 routed + 33 unrouted。`npm run verify:all` 前置拓扑/布局/家具/rules/collision/spatial 通过，随后被既有无关 `sock_child_ac` 墙段越界错误 #42 拦停。未运行测试套件。

### DEC-2026-10-07-R16 移除夜灯通用落地柱形态

- **业主决定**：夜灯不再提供落地灯柱形态；所有 `night_light` 必须声明实体墙 `wallSide` 或柜体 `furniture_face` 锚点。NP-4b 已删除，不能通过无锚点夜灯回退生成落地模型。
- **实现**：从共享浏览器/GLB 几何中移除底座、柱身、环绕扩散罩和感应带；无墙面或柜面锚点时明确报错。保留贴墙灯体与柜体贴装两种形态。
- **验证**：`npm run typecheck` 通过；`verify:project-render-facts` 确认当前 20 个灯具投影有效；未运行测试套件。


