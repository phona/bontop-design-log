# 决策日志 · 工程状态投影

> 本文件收录「构件级工程状态」派生与查询相关决策。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-09-E01` 构件级工程状态投影：每个构件一条「确认了吗 / 卡在谁 / 和谁冲突」

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-10-09-E01 构件级工程状态投影：每个构件一条「确认了吗 / 卡在谁 / 和谁冲突」

- **日期**：2026-10-09。触发：业主要求「3D 反映装修目标与状态、人与 agent 围绕同一套工程数据协作」，并明确**不需要 MCP**（agent 直接读配置 / 跑 CLI / curl 既有 API 效果相同，已核实 `POST /api/visual-commands` 覆盖高亮与相机）。
- **问题（状态在三个孤岛）**：点位置信度在 `config/*.yaml` 的 `status`/`position_status` 字段、55 条未决问题在 `docs/pending-site-data.md` 的 markdown 表格、裁定依据在 179 条 DEC——**三者各自完备，互不连通，且都不在 3D 里**。后果：`sock_child_ac` 声明墙段错误时，`InfrastructureBuilder.projectPoint()` 把点位静默钳到错误墙段端部，3D 渲染差 0.45m 却**看着完全正常**（贴在墙上、朝向正确、高度正确）——模型只回答「东西在哪」，不回答「这东西确认了吗」。
- **可选方案**：
  - ① 新建状态数据库 + 持久化（否决：成为第二份真相，必然漂移）；
  - ② 给每个构件手填状态（否决：164 个构件，且大部分要业主/现场输入）；
  - ③ **纯派生 + 单一出口**（选定）。
- **选定方案**：
  - **`shared/element-state.ts`（纯函数、零 I/O）**：输入 = 构件清单 + 待决台账 + verifier issues + 状态模型；输出 = 每构件一条 `ElementState { id, kind, label, room, status, statusSource, openQuestion?, decision?, conflicts[] }`。`id` 与 3D `userData.objectId` 同源（`electrical:sock_child_ac`），W3/W4 的 3D 叠加层可直接绑定。
  - **`shared/pending-ledger.ts`**：把 markdown 台账解析成结构化视图。**表格仍是唯一人工编辑处**，解析器只读——与 `config/facts.yaml` 的 mirror 机制同思路，不产生第二份真相。
  - **`config/state-model.yaml`**：优先级与状态词映射**可评审**。代码只提供谓词；配置申报了代码没有的规则、或代码实现了配置没申报的规则 → 告警（覆盖矩阵不许说谎）。删掉 `fallback` 也告警，且不静默给状态。
  - **派生优先级**：`conflict`（error 级 issue）> `config_status`（字段原值，likely→inferred）> `ledger`（台账 #N + 卡在谁）> `decision`（DEC 引用）> `fallback`（**`undeclared`**）。派生不出来的状态是 `undeclared`——一种要显形的状态，不是「默认已确认」。
  - **`openQuestion` 与 status 解耦**：即使 status 由 config 字段决定，也带上台账的「卡在谁」——那才是可行动的部分。config 声称已核实而台账仍开着 → `state.config_vs_ledger_conflict` 告警。
  - **出口**：`npm run state:project [-- --json]`。**不建 MCP、不建 HTTP 端点、不建数据库、不做状态持久化**（视图状态若要持久化，复用 `PresentationStateStore` 的 CAS 模式）。
- **决策依据**：当前实测 164 个构件 = confirmed 74 / undeclared 12 / pending 29 / inferred 49，无 dangling 引用、无告警。缺口从 41% 压到 7%，且剩下的 12 个是有解释的残留（吊顶分区无 status 字段）。
- **预算影响**：无。
- **关联文件**：`shared/element-state.ts`（新增）、`shared/pending-ledger.ts`（新增）、`shared/element-sources.ts`（新增）、`config/state-model.yaml`（新增）、`scripts/project/state-projection.ts`（新增）、`tests/server/element-state.test.ts`（新增，16 项）、`package.json`（`state:project`）、`docs/decisions/README.md`、`config/facts.yaml`、本文件。
- **决策人**：业主（确认不需要 MCP）+ AI 执行。
- **验证**：`npm run state:project` 输出 164 构件 / confirmed 73 / undeclared 68 / pending 21 / inferred 2，`--json` 含每构件的 statusSource 与 openQuestion；`sock_child_ac` 端到端可答「pending，卡在空调厂家深化图（#42）」；台账 dangling 为 0（类型引用 `ac_indoor`/`type: strong_panel` 与元素 id 已区分，无误报）；`tests/server/element-state.test.ts` 16/16；`npm run test:server` 全绿；`typecheck` 干净。
- **申报缺口补录（2026-10-09 同日，subagent 分头过一遍 + 我复核）**：undeclared **68 → 12**。
  - **6 个 hvac 内机**：权威状态本来就在 `config/hvac.yaml` 的 anchor 里（`ref.source: ceiling` 指回 `ac_*`，带 status + reason，schema 还有 `reasonForUnconfirmed` 强制非 confirmed 必须带 reason）——是采集器没去读。改为接入，多 anchor 引用同一 ceiling id 时**取最保守状态**并在 statusSource 列出全部 anchor id。
  - **46 个电气点位**：逐条补 `status`/`position_status`，依据分三类——43 个是 topology 回路 `member_point_ids` 成员（装什么/几路已定，机器可读）、3 个与同位插座坐标完全相同（net_child/net_parent/net_study）、1 个由台账 #26 判 pending。**未用 measured**（无非实测声明）、**未用 likely**。我抽查了 10 处依据（含 4 处回路成员 + 2 处同位坐标），全部属实。
  - **2 个给排水点**：采集器缺陷——plumbing 分支只读 `position_status` 不读 `status`，导致已有 `status: inferred` 的 `duct_kitchen_exhaust`/`gas_meter_kitchen` 被误判 undeclared。已修。
  - **2 个花洒**：note 已写明「本轮不画 MEP route，待量房 + SKU（pending #44）」，且 `docs/decisions/12-plumbing.md:33` 登记过这两点——故 `status: inferred`，pending 的是给水管路而非点位位置。
  - **诚实残留 12 个吊顶分区**：`CeilingZoneSchema` 是 `.strict()` 且**没有 status 字段**，加不进去；且它们是「几何声明」不是「待决决策」，硬加字段等于造假。这 12 个的 note 也都没有可引用的 DEC。保留 undeclared 作为「该补 DEC 引用」的行动项，不是缺陷。
- **后续议题**：① **W3/W4 未做**——3D 状态叠加层与问题标记层（消费同一 `ElementState`）；② `undeclared` 68 个的补录优先序（电气点位占大头，可 kind 批量确认）；③ 台账解析器目前只认 electrical/plumbing/ceiling 三类构件承载文件，house.yaml 的 furnishings 尚未纳入（需要 `furniture:room:type:index` 的稳定 id 映射）；④ `state:project` 的 issue 来源只取 3 个与构件绑定相关的 verifier，全量门禁结论看 `verify:all -- --json`。
