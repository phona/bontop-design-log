# 角色协调与动态施工排程设计（issue #202 切片 A）

> **地位**：本文是 issue #202 切片 A 的设计记录，属 `docs/README.md` 权威层级第 5 级
> （历史说明/操作指引），**不是事实源**。所有权威值以 `schedule/phase-1/control.yaml`、
> `config/*.yaml` 与 `shared/` 单一实现为准；本文与它们冲突时改本文。
>
> 建立日：2026-11-10。对应 issue：[#202](https://github.com/phona/bontop-design-log/issues/202)（P1，OPEN）。
> 前手评估：本设计吸收了对该 Issue 的三条修正——① 切片 B 不新增第三条定位路径（绕开 #191 未完成项）；
> ② SCH 级角色归属缺口（49 个 SCH 仅 2 个带 `owner_roles`）在本文给出落点；③ 协调状态 ≠ 验收通过
> 落成机器断言，不靠人记得。

---

## 0. 结论摘要（先给决策，后给论证）

| # | 决策 | 一句话理由 |
|---|---|---|
| D1 | **排程/协调事实全部住 `schedule/phase-1/control.yaml`**（PKG/SCH 扩容 + 顶层 `work_calendar`），不建第二个配置文件 | 加载/校验/派生已在 `shared/schedule-state.ts` 单一实现；新文件 = 新读者 = 新漂移面 |
| D2 | **不存“实际开工日”新字段：检查记录窗口（`check_window`）从 `audit_log` 段 `records` 的 `checked_at` 派生，只作证据层；施工起止从未记录，保持未知，不拿检查日期冒充** | 执行记录的权威形态已存在（`required` 含 `checked_at`，control.yaml:1809-1812）；该窗口**不进入 forecast**（§16 剪断消费链）；再存一份"实际开工日"就是同一事实两处 |
| D3 | **时间调整的"提案通道"就是 PR，MVP 不建提案存储** | Issue 原则 5 原文即"事实写入与批准沿用 PR/现有审查流"；提案存储是范围外发明 |
| D4 | **排程数学住新模块 `schedule-projection`（`shared/` 下，纯函数、无 fs/DOM），由 `buildScheduleSnapshot` 调用；UI 只渲染不算** | 沿用 `shared/flow-layout.ts` 先例（纯函数、浏览器安全、面板只做像素映射）；"前端不单独实现项目状态判定"铁律 |
| D5 | **三个新面板（甘特/角色工作台/协调日历）只写 `ScheduleSelectionStore`，定位与 3D 展开仍走 `ScheduleDetailPanel` 今天唯一的 `resolvePackageScope` 路径** | 不新增 selector；#191 落地时全消费方一起迁，本设计零改 |

---

## 1. 现状盘点与缺口矩阵

盘点口径：事实住在哪、谁在读、缺什么。行序按"离落地远近"。

| 事实 | 现居何处（file:line） | 现有消费者 | 缺口 |
|---|---|---|---|
| 工期区间 `duration_workdays {min,max}` | control.yaml，25/25 PKG 齐全 | **无**（`shared/schedule-state.ts`、4 个面板、`GET /api/schedule/state` 均不透出） | 快照不透出 → 任何排程无从谈起 |
| 依赖 DAG `dependencies` | control.yaml，23/25 PKG 有（PKG-000 为根、PKG-900 侧车道无依赖属正确） | `shared/flow-layout.ts`（分层）、`packagePrerequisiteIssues`（schedule-state.ts:718-735） | 分层只到"层号"，没有时间轴；跨包环仅在 flow-layout 有路径防环（flow-layout.ts:56），loader 无 `dependency_cycle` 错误码 |
| 角色 `owner_roles` | control.yaml，25/25 PKG 有；**SCH 级仅 2/49**（SCH-000-PRE-01/02） | 快照 `owner_roles[]` 透出、FlowChart 徽标 | 角色工作台若按 SCH 组织，47 个 SCH 无角色归属 |
| 检查点/验收 `checks` + `acceptance_refs` | control.yaml + `config/acceptance.yaml`（67 项，按 `rooms` 引用对象，无 pkg 字段，绑定在 control 侧） | `packageChecks`（schedule-state.ts:627-635）、ScheduleDetailPanel 验收表 | 无"活动类型"之外的协调语义（谁到场、提前量、方式） |
| 执行记录/实际日期 | `audit_log` 的 `records`（control.yaml:1807，`records: []` 空，schema 要求 `checked_at`） | `auditStatusFor`、`computeStaleAudits` | 空表是正常未施工态；缺的是把 `checked_at` 读成时间线 |
| 阻塞 | PKG `blockers` + `global_blockers`（14 条，BLK-HANDOVER 在 603） | 快照 blockers、`blockerIsClosed` | 阻塞只有"开/关"，没有"阻塞多久、影响谁" |
| 外部约束 | 散在 blocker `clears_when` 与 SCH-005-01 正文（"核对允许施工时间及禁止事项"） | 人读 | 无结构化约束 → 排程无法消费物业时段/到货 |
| 工作日日历 | **不存在** | — | 纯新增；无消费者冲突 |
| 状态/门禁判定 | `shared/schedule-state.ts` 派生（`effectiveReadiness`/`effectivePackageStatus`/`computeGateStatus`，gate-status.ts:27-39） | 全部面板 + `verify:schedule` | 不缺；**新功能禁止旁路它** |
| 下一步 | `computeNextActions`（schedule-state.ts:849-915，4 kind，按下游解锁数排序） | NextActionPanel | 不缺；角色工作台按其分组 |
| 选中态 | `ScheduleSelectionStore {packageId, checkId}`（schedule-selection.ts:18-21）+ hash 路由 `#approval=next_action\|schedule\|detail\|flow&pkg=&check=`（approval-route.ts:25-59） | 4 面板 + App 路由 | 不缺；新面板直接挂 |
| 3D/scope 定位 | `resolvePackageScope`（shared/package-scope.ts，MODEL-PKG-100 按 room_ids+types 选） | ScheduleDetailPanel | #191 要退役的选择器；本设计**不新增使用者** |

**盘点结论**：Issue 说的"缺闭环"成立且比描述的更具体——工期声明了两年没有一个消费方；
SCH 级角色归属是 2/49 的稀疏态；执行记录的 schema 早就为时间线准备好了（`checked_at` 在
`required` 里）只是没人把它当日历读。

---

## 2. 事实归属设计（D1/D2/D3 的展开）

### 2.1 扩容 `schedule/phase-1/control.yaml`

新增/变更全部遵循文件内既有约定：枚举在 `control:` 段声明（如 `check_status_values`），
记录 schema 在数据段旁声明（`audit_log.record_schema` 先例）。

#### (a) 顶层 `work_calendar`（纯新增）

```yaml
work_calendar:
  schema_note: 工作日历是业主声明的计划假设，不是法规；法定节假日与物业禁止时段以 rest_dates 与 PKG 约束为准
  workdays: [1, 2, 3, 4, 5, 6]        # 周一~周六（家装常见口径，业主可改）
  rest_dates: []                       # 具体休息日 YYYY-MM-DD（节假日/调休）
  extra_workdates: []                  # 补班日
  anchor_date: null                    # 排程零点（计划开工日）。交房未定 → null → 只出相对工作日
  anchor_status: site_pending          # 取值同 blocker_status_values；BLK-HANDOVER 关闭后才允许填日期
```

- `anchor_date: null` 是**合法声明值**（对应"尚未交房"），不是缺字段——与预算三层铁律
  "`0` 是合法声明值"同源。
- 填 `anchor_date` 的写入条件是 `anchor_status: resolved`，由 loader 校验（新错误码
  `anchor_date_without_resolved_status`）。

#### (b) PKG 级 `constraints`（外部固定约束，纯新增）

只收**排程消费得到**的外部约束；收不进排程的继续留在 blocker 散文里。

```yaml
  - id: PKG-005
    constraints:
      - {id: CON-005-PROPERTY-HOURS, type: time_window, detail: "物业允许施工时段（周末/节假日禁噪）", source: 物业装修许可, status: site_pending, date: null}
      - {id: CON-005-DEPOSIT-PAID, type: not_before, detail: "装修押金缴纳后才能进场", source: 物业收费通知, status: site_pending, date: null}
```

- `type` 枚举：`not_before` / `not_after` / `time_window`。
- `date: null` + `status: site_pending` = 约束存在但时刻未定（PKG-005 的物业通知本就
  `notice_pending`）。排程对 `site_pending` 约束只登记不生效，并在甘特上标"待定"。

#### (c) SCH 级 `coordination`（协调事实，纯新增，稀疏落地）

**这是"角色 ≠ 参与要求 ≠ 权利"的落点。** 只给确有协调动作的 SCH 挂（试点：PKG-000 的
SCH-000-02 会审、PKG-070 的 SCH-070-01 联合验收，约 6-10 条），**不backfill 47 条**。

```yaml
      - id: SCH-070-01
        coordination:
          required_roles: [业主, 施工方, 设计师, 空调商]   # 必须参与方（attendee，非责任方）
          mode: onsite                                # onsite | remote | notify
          lead_time_workdays: 3                       # 预约提前量（工作日）
          owner_role: 设计师                           # 协调组织者（谁去约人）
          status: pending_invite                      # unassigned|pending_invite|invited|confirmed|cancelled
          actor: {name: null, org: null}              # 绑定允许 pending；null = 待指定
          confirmed_at: null
          escalation: "提前量过半仍未确认 → 升级到业主并顺延预测窗口"   # 失效态：没人确认时怎么办
```

**权利隔离（Issue 原则 2 的机器化）**：`coordination` 只描述"何时、谁到场、什么方式"。
审批/放行权继续只认 `gate-status.ts` 与 `owner_roles`。**协调状态不得成为任何门禁输入**——
用 facts 契约禁止（见 §4）。

**与 `owner_roles` 的分工**：`owner_roles` = 责任归属（已有，PKG 级 25/25、SCH 级 2/49 不动）；
`coordination.required_roles` = 到场要求（新增，仅挂在有协调动作的 SCH 上）。两者是不同的
事实，允许并存；**禁止从 `required_roles` 反推责任，也禁止从 `owner_roles` 反推"必须到场"**
（Issue 切片 C 联合验收场景的原文要求）。

#### (d)  loader 新校验（shared/schedule-state.ts，错误级）

| 错误码 | 触发 |
|---|---|
| `dependency_cycle` | 依赖图有环（flow-layout 的路径防环是渲染侧兜底，loader 必须显形） |
| `anchor_date_without_resolved_status` | `anchor_date` 非 null 但 `anchor_status != resolved` |
| `constraint_type_invalid` / `constraint_status_invalid` | 枚举越界 |
| `coordination_mode_invalid` / `coordination_status_invalid` | 枚举越界 |
| `coordination_pending_without_escalation` | `status` ∈ {pending_invite, invited} 但 `escalation` 为空（决策铁律第 1 条：新部件必须回答"没人响应时怎么办"） |
| `coordination_confirmed_without_actor` | `status: confirmed` 但 `actor.name` 为 null |
| `coordination_roles_duplicate` | `required_roles` 含重复角色（同一预约不会与自身成冲突；重复声明是错误，不静默去重——Codex 二审 blocking，2026-11-12 加） |

### 2.2 检查记录窗口：派生，不存储（D2；F2 正名；§16 起与预测解耦）

> **推翻了什么**（总账在 §16.6 与 §17.6，这里同步正文，不静默删）：
> 1. 原文标题「实际日期：派生，不存储」及公式「PKG 实际窗口 = [min, max](`audit_log` 的 `records` 中该包 passed 记录的 `checked_at`)」已随 PR #216 二审 F2 推翻（§15.9）。检查通过日期不是施工起止事实。D2 的「派生，不存储」保留，被正名的是这个派生事实的语义。
> 2. F2 落地后本节约仍写：「模块入参 `actual_windows` 字段名冻结；投影把该窗口当作『门禁 passed 的完成证据』钉死 forecast」。§16 业主裁定 A **删掉钉死**：门禁证据可以独立交付，不能因此确定施工预测起止。「不是施工实际起止」保留。检查日期不再覆盖 forecast、不再顺延后继。模块入参同步改名为 `check_windows`，不留 `actual_windows` 别名。
> 3. §17 推翻「无锚点即抛」，以及上一版公式「窗口 = `[first_ord, last_ord]`、投影总是把日期映射成 ord 并扩展 ordinals 地平线」。无锚点时没有可映射的序数：日期仍是事实，序数待定（null），不抛错、不进 forecast、不扩展地平线。锚点就绪后的映射与地平线扩展保留。删掉的是「只有序数、没有日期」的快照形状，不是检查窗口本身。

```
PKG 检查记录窗口 = {first_date, last_date, first_ord, last_ord}
  first_date / last_date = 该包全部 passed 检查的 checked_at 最早 / 最晚（YYYY-MM-DD，原样保留）
  first_ord / last_ord   = 锚点就绪时，上述日期经 work_calendar 映射的首末工作日（可为 0 或负值）
                           锚点为 null 时为 null（待定）。null 不是 0，也不是 1970 名义纪元序数
```

- **语义**：首末 passed 检查日期的**证据窗口**，回答「门禁 passed 的完成证据登记在哪些检查日」；**不是施工实际起止**。检查通过时间与施工起止无关（拆墙/结构检查在拆完后才做；全部检查同日登记时，多日施工会被压成一天），**实际开工时间从未记录，保持未知**。在引入显式的开工事实之前，没有「计划 vs 施工实际」这一层；检查窗口不是那个事实。
- **交付键**：快照 `schedule.packages[pkg].check_window: {first_date, last_date, first_ord, last_ord} | null`，其中两个序数的类型是 `number | null`（F2 起键名是 `check_window`，旧键 `actual` 已退场；§17 起形状带上日期与可空序数）。模块入参仍是 `ProjectionInput.check_windows: {start_date, end_date}`——loader 入参照旧传日期。模块返回日期 + 可空序数，loader 在快照边界把四者一并映射，不把 null 序数兜成 0。锚点就绪时序数参与 ordinals 地平线扩展；锚点为 null 时序数保持 null，不扩展地平线。**两种情况下都不参与 baseline / forecast**。
- **无锚点**（§17）：`anchor_date: null` 且门禁 passed → 窗口仍交付。日期是检查登记日，序数是 null。与「没有这份窗口」相比，baseline / forecast / ordinals 的日期不变（无 scenario 时 forecast 仍等于 baseline；ordinals 在无锚点时本就是全 null，该保证在模块输出边界完成，§18）。接口不因此 503。
- 未 passed → `check_window: null`（现在全 25 包皆此态，诚实）；部分通过（1/N）不生成——单条检查通过不等于整包完工。
- 复验 supersedes 旧记录后取最新 passed 的 `checked_at`（`auditStatusFor` 已有 stale 降级，直接复用）。
- **停工/复工**：不新增事件类型。停工 = 期间无新 passed 记录 + blocker 保持未关闭；恢复 = 新记录出现。窗口是检查登记日的首末包络，不声称期间连续施工；若未来需要显式停工原因，进 blocker 的 `trigger`/`rationale`，不建事件流。

### 2.3 提案：PR 即通道（D3）

MVP 没有任何"排程建议"存储。人看到的任何调整（拖甘特条、改工期）在前端只生成一段
**可复制的 YAML diff 文本**（"落配置请通过 AI 会话"的同一口径，页面只读铁律），
由 AI 会话落 control.yaml 并走 PR。浏览器侧零写路径——连草稿都不存。

---

## 3. 时间模型：四条时间线（Issue 原则 4 的落地）

> **推翻了什么**：上一版「当前预测」行是「基线重算，但把已有检查记录窗口的包钉死在该窗口，未完工包继承基线」，数据来源写成「基线 + `records` 的 `checked_at`」。§16 业主裁定 A 推翻这一行——钉死的输入是检查日，不是施工起止。预测改为与基线同源，差异只来自 scenario，以及未来才会写入的显式实际开工事实。检查记录从预测的输入改成与预测平行的证据层。删掉的是「检查日期 → forecast 起止」这条消费，不是检查窗口本身（总账 §16.6）。

| 线 | 定义 | 数据来源 | 存储 |
|---|---|---|---|
| 计划基线 | 声明依赖 + 声明工期区间 + resolved 的 `not_before`，两次前向传播（min 口径 = 乐观，max 口径 = 保守） | `dependencies` + `duration_workdays` + resolved `constraints` | 不存，每次重算 |
| 当前预测 | 与基线同一套前向传播。无 scenario 时与基线逐值相同；有 scenario 时差异只来自 `scenario.delay`（只改点名包工期、只重算拓扑下游）。检查记录不参与。未来若写入显式的实际开工事实，差异才来自那个事实；现在没有这一层 | 与基线同源，外加 scenario | 不存，每次重算 |
| 检查记录 | 独立证据层：该包全部 passed 检查的 `checked_at` 首末窗口（门禁完成证据，**不是施工起止**；不覆盖 forecast、不顺延后继；快照键 `check_window`） | `audit_log` | 已存于 audit；窗口派生不另存 |
| 外部固定约束 | `not_before/not_after/time_window`，`site_pending` 只登记不生效。resolved 的 `not_before` 同时抬高基线与预测（它是计划的一部分，不是检查日期） | PKG `constraints` | 已存（新增） |

**相对工作日序数（ord）**：基线与预测的计算输出以"自排程零点起第 N 个工作日"表示（1-based）。
`anchor_date: null` 时 UI 只显示"第 N 工作日"及上下界；`resolved` 后同一计算自动带出
`YYYY-MM-DD`。**未知保持未知，不造年月日。** 快照 `ordinals` 的 `date` 列同理：`anchor_date: null`
时每项 `date: null`（序号仍由前向传播连续给出），锚点就绪后才是真实日期。这个 null 在生产处
（模块输出边界，§18）就完成，装配层不再二次清空。检查记录窗口的日期可以落在锚点之前，
对应 ord 为 0 或负值（§14/B3）；那是证据坐标，不改变基线/预测从 ord 1 起算。

**无锚点时的检查窗口**（§17，推翻「无锚点即抛」）：`anchor_date: null` 时窗口的
`first_date` / `last_date` 仍是真实检查日，`first_ord` / `last_ord` 为 null。null 是
「序数待定」，不是 0，也不是按 1970 名义纪元算出来的序数——0 只在锚点就绪、且检查日
落在锚点前一个工作日时出现（上一段）。这份窗口不进入 baseline / forecast，也不把
ordinals 的 `date` 从全 null 改成检查日。锚点就绪后，同一窗口才映射出序数。

---

## 4. 排程算法（`schedule-projection` 模块，D4）

纯函数模块，与 `shared/flow-layout.ts` 同宗：无 fs、无 DOM、node/vitest 直接测；
被 `shared/schedule-state.ts` 的 `buildScheduleSnapshot` 调用，**UI 不 import 它做计算**
（UI 只消费快照里的结果）。

```ts
// 实现名：ProjectionInput（shared/schedule-projection.ts）。本节的 ScheduleInput 是设计举例名。
export interface ScheduleInput {
  packages: Array<{ id, sequence, dependencies, duration_workdays: {min,max},
                   constraints?, readiness, status, gate_status }>;
  check_windows: Record<string, {start_date: string, end_date: string}>; // loader 从 audit_log 派生；只作证据，不进 forecast（§16 删掉原 auditWindows 钉死）
  calendar: { workdays: number[], rest_dates: string[], extra_workdates: string[] };
  anchor_date: string | null;
  scenario?: { delay: Array<{ pkg: string, workdays: number }> };      // what-if，见 §6
}
export function projectSchedule(input: ScheduleInput): ScheduleProjection;
```

**算法（最小，刻意不做资源最优化）**：

1. **DAG 校验**：未知依赖、自依赖、跨包环 → 抛错（对应 §2.1(d) 错误码）。
2. **工作历展开**：从零点（或 `anchor_date`）逐日推进，按 `workdays`/`rest_dates`/`extra_workdates`
   生成 ord→date 映射表。约束 `time_window` 仅在有 anchor 且约束 `resolved` 时参与（MVP 只登记）。
3. **前向传播 ×2**：拓扑序（复用 flow-layout 的 depth 语义，`sequence>=900` 侧车道不参与）；
   `start = max(dep.end) + 1`；`end = start + duration − 1`；min/max 两遍出区间。
   `not_before` 约束 resolved 时抬 start。
4. **基线 vs 预测**：两者同一套前向传播（声明工期 / 依赖 / resolved 的 `not_before`）。无 scenario 时逐值相同；有 scenario 时只把 delay 加在点名包的工期上，后继只因此重算。§16 推翻了上一句「把 `auditWindows` 中已有实际窗口的包钉死在实际值，其后包从实际末端继续」——后继从检查日末端继续会把检查日传播成施工延期。检查记录窗口不进入这一步。
5. **延期传播（what-if）**：`scenario.delay` 从指定包起把 duration 加 N，**只重算拓扑下游**
   （并行分支的序数不变——这正是"不简单平移所有下游"的算法含义）；输出
   `affected: [{pkg, delta}]`（对照「无 scenario 的当前预测」，delta 取完整窗口三处位移的最大值，§15.3）。
6. **冲突检测（角色工作台用）**：分两级——未确认预约（无 `confirmed_at`）的条目只有潜在窗口
   （所属包预测区间），潜在窗口重叠只记提示；`status: confirmed` 且同日的同角色 `onsite` 条目
   才算冲突（同一天两处现场）。`notify`/`remote` 不产生冲突。（§16.4 两级口径；原“预测窗口
   重叠即冲突”已推翻，见 §16.6）

**复杂度**：O(V+E)，无求解器、无迭代——25 个包一次前向传播是微秒级。刻意不引
TaskJuggler 的约束求解（见 §8）。

---

## 5. 状态机边界：三条事实互不推导

```
readiness/gate（工程就绪）  ← control.yaml + gate-status.ts        【已有，不改】
acceptance（验收通过）      ← acceptance.yaml + audit_log          【已有，不改】
coordination（协调确认）    ← SCH coordination 块                 【新增，只描述排程】
```

**机器断言两条**（Issue 关闭标准 4"协调确认不等于验收通过"的可执行化）：

1. **facts 单一来源契约**（`config/facts.yaml`，照 `c.floor_height_3m_forbidden` 的 `expect: 0` 先例，facts.yaml:1753-1762）：
   ```yaml
   - id: c.coordination_not_gate_input
     kind: single_source
     scope: [shared/, server/, scripts/]
     patterns:
       - 'gateStatus\s*\([^)]*\)[^\n]*coordination'
       - 'effectiveReadiness[^\n]*coordination'
       - 'coordination[^\n]*(passed|auditStatus)'
   ```
   含义：门禁/就绪代码出现 `coordination` 字样即红。**协调状态连"被读"都不允许。**
2. **verify 规则**（并入 `verify:schedule`，即 `control.ts --check`，零新增 npm script）：
   `coordination.status: confirmed` 不得改变任何包的 `gate_status`/`effective_readiness`——
   实现即"投影时 coordination 字段根本不进这两个函数的输入"（结构上不可能，比断言更强；
   契约 1 是防回归的保险丝）。

**新部件的失效态**（决策铁律第 1 条，随 §2.1(c) 的 `escalation` 与 loader 校验落地）：
无人确认 → escalation 升级链；日历假设失效（物业禁周末）→ `rest_dates`/constraints 修正后
重算，基线不变只出新预测；交期滑脱 → 供应商协调项 `cancelled` + blocker 保持未关闭。

---

## 6. 投影与 API（只增不删）

### 6.1 `GET /api/schedule/state` 增量（shared/schedule-state.ts `buildScheduleSnapshot`）

`ScheduleSnapshot` 纯增量加两个键，**既有字段一个不动**（`tests/server/api.test.ts:287-308`
钉的 25 包/PKG-900/fingerprint 断言不受影响）：

```ts
schedule: {
  anchor_date: string | null,
  calendar: { workdays: number[], rest_dates: string[], extra_workdates: string[] },
  ordinals: Array<{ ord: number, date: string | null }>,   // anchor 未定则 date 全 null（模块输出边界保证，§18；装配层不作第二次清空）
  packages: Record<string, {
    duration_workdays: { min: number, max: number },
    baseline:  { start_ord: number, end_ord_min: number, end_ord_max: number },
    forecast:  { start_ord: number, end_ord_min: number, end_ord_max: number },
    check_window: { first_date: string, last_date: string, first_ord: number | null, last_ord: number | null } | null,   // 证据窗口。无锚点时日期保留、序数 null（§17）；不参与 forecast（§16）
    blocking_reasons: string[],          // 未关闭 blocker / 未满足依赖（只解释，不参与计算）
    constraints: Array<{ id, type, status, detail }>,
  }>,
}
coordination: Record<string, {          // key = SCH id
  required_roles: string[], mode: 'onsite'|'remote'|'notify', lead_time_workdays: number,
  owner_role: string, status: string, actor: {name: string|null, org: string|null},
  escalation: string,
}>
```

- `schedule` 与 `coordination` 分开两个键：前者每包都有，后者稀疏——混在一个结构里会让
  "没有协调数据的 43 个 SCH"变成 43 个空对象。
- `schedule.ordinals[].date` 的「无锚点即 null」由模块输出边界（§18）单点保证：
  `buildScheduleProjectionView` 原样透传模块返回值，不按 `anchor_date` 做二次清空
  （装配层清空已随 §18.6 删除）。锚点就绪时为真实日期，锚点前的检查日给出 ord ≤ 0 照常。
- 503 行为不变（`state.errors.length` → 503）；新 loader 错误码走同一通道。

### 6.2 `GET /api/schedule/what-if?delay=PKG-040:3,PKG-030:2`（新，只读）

- GET 不触发写 token 守卫（守卫只拦 POST/PUT/PATCH/DELETE）——what-if 是计算不是写。
- 语法 `pkg:workdays` 逗号列表；未知包 / 非正整数 / 同一包重复出现 / 单个包超过
  `MAX_SCENARIO_DELAY_WORKDAYS`（3650 工作日）→ 400 带原因；无参 → 等同基线，
  响应 `scenario: null`（没有 scenario 就没有演算结论，不造空 overrides/affected）。
  上限是防 DoS 的边界：delay 会变成 ordinals 地平线，无上限时可让无 token 的 GET 展开十亿项/天。
- 响应 = §6.1 的 `schedule` 键**平铺**再加 `scenario: { overrides, affected: [{pkg, delta}] }`
  （affected 的口径见 §15.3；模块形状 `shared/schedule-projection.ts` 的 `ScheduleProjection['scenario']`）。
- 试点场景"水电或空调延迟 3 个工作日"（Issue 切片 C）正好一个参数。

---

## 7. UI 设计（三个新面板 + 一个升级，全部只读）

沿用审批页既有形态：plain-TS class（`show/hide/isVisible/refresh`）、`<div class="dynamic-panel">`、
挂 `#approval-page-panels`、inline style + `escapeHtml`、≤700px 走 `input-capability.ts` 单列。
**新面板不 import 排程投影模块**——只渲染快照。

| 视图 | 形态 | 面板 | 数据 | 交互 |
|---|---|---|---|---|
| 项目看板 | **升级** `SchedulePanel`（progress 模式加一列"预测窗口"） | 已有 334 行 | `schedule.packages` | 行点击写 selection（现状不变） |
| 动态甘特 | **新** `GanttPanel` | 新 ~700 行（S2 实现） | `schedule.*` | 条点击 → selection；what-if 控件（delay 输入 → GET what-if → 重渲）；min/max 画**区间条**不是单值条；无 anchor 时 x 轴标"第 N 工作日"；演算视图的来源行写 `/api/schedule/what-if`，基线才写 `/api/schedule/state` |
| 角色工作台 | **新** `RoleWorkbenchPanel` | 新 898 行 + 840 行测试（S3 实现；S3.2 收尾后实测 `wc -l`，原 762/663） | `owner_roles` + `coordination` + `coordination_conflicts` + `next_actions`（S3.2 起——冲突/潜在窗口的唯一来源改为服务端报告；原「潜在窗口另只读 `schedule.packages`」随面板侧分类删除，§22）。现场冲突两级口径：同角色 onsite 都已确认且 `confirmed_at` 同日 = 冲突；未确认且 forecast 窗口重叠 = 潜在（§16.4） | 按角色分组：待办检查 / 待确认协调 / 现场冲突；点项 → selection |
| 协调日历 | **新** `CoordinationCalendarPanel` | 新 612 行 + 578 行测试（S3 实现） | `coordination` + `schedule.packages` | 按工作日列 onsite/remote/notify 三类 chip；chip 位置 = 所属包 forecast 潜在窗口（不钉确认日列）；`site_pending` 约束标"待定"；点 chip → selection |

**关键复用（D5）**：三个新面板的点击一律 `selection.set({packageId, checkId})`，
**不自己做 3D 高亮、不自己做 scope 展开**——`ScheduleDetailPanel` 是定位与
`resolvePackageScope` 的唯一使用者（现状如此）。#191 退役 MODEL-PKG-100 选择器时，
只迁这一处，本设计的三个面板零改动。

**路由**：`#approval=` 枚举加 `gantt|roles|calendar`。S2 已落地 `gantt`、S3 已落地
`roles`/`calendar`（`approval-route.ts` 的 `SUB_PAGES`、`App.ts` 的
`showApprovalView` / 命令注册、`view-state-store.ts` 的持久化白名单三处同步，
`index.html` tab 文案「甘特」「角色」「日历」）。坏 hash 仍照既有口径回落 3D 页。
深链、push/replace、退出语义由现有路由机制免费获得。

**移动端**：甘特在 ≤700px 退化为"包列表 + 序数条"（包信息单列堆叠，区间条按 ordinals
上下界做相对定位，**不建日期轴/刻度**；参照 FlowChartPanel issue #83 的单列降级先例）；
无锚点时轴与条几何都不出现年月日，检查记录窗口的 checked_at 证据日期另行保留（§17）。
工作台窄屏单列放宽布局约束（本就是列表）；日历窄屏退化为单列文字行（chip 改文字行，
不画工作日列网格）。

**零新依赖**：不引 Frappe Gantt/任何图表库（判据见 §8）。

---

## 8. 外部项目调研结论（Issue 要求的"复用/参考/不采用"）

| 项目 | 结论 | 理由 |
|---|---|---|
| OpenProject | **参考设计** | Work Package 统一甘特/看板/团队规划的思路与本仓 PKG/SCH 同构；但它是 Rails 全栈平台，移植任何部分都违反"最低维护成本" |
| ProjeQtOr | **只参考模型思想** | Assignment/Resource/Meeting 对"角色-参与-会审"的表达有参考价值；**AGPL，不复制任何实现**；其"Planning Element"正是我们要避免的第二套任务层 |
| TaskJuggler | **不采用** | 约束求解器/DSL 与本项目 25 个包、一次前向传播的需求严重不对称；引入常驻求解器违反 Issue 原则 6 |
| Frappe Gantt | **评估后不采用（手写）** | 本仓前端零框架、零图表依赖（deps 仅 express/js-yaml/zod/three/chokidar/pinyin-pro/opencode-sdk），甘特需求是"只读 + 区间条 + 相对轴"的很小子集；引一个 UI 运行时依赖 + 其 CSS/交互模型，维护面大于 450 行自面板。FlowChartPanel（880 行，绝对定位 + SVG）已证明这个路子在本仓成立 |

净结论：**借鉴对象模型（OpenProject 的 WP 统一视图），不借鉴任何实现；算法自研（25 节点的
前向传播），不引入求解器。**

---

## 9. 落地切片（PR 序列，每片独立可验）

> 工作树：`/home/tao/projects/bontop-wt/ep-202-scheduling`（分支 `arch/202-scheduling`，基 `origin/master`）。
> 每片退出条件含对应门禁；control.yaml 有改动的片必须跑 `npm run schedule:render`
> （渲染视图带输入指纹，改了 control 不重渲 → `verify:schedule` 红，这是既有机制不是新规）。

| PR | 内容 | 主要文件 | 退出条件 |
|---|---|---|---|
| **S0** | 本文 + docs/README.md 登记 + issue #202 评论挂链接 | `docs/schedule-coordination-design.md` | `verify:document-references` 过；业主评审通过 |
| **S1 投影层** | `schedule-projection`（DAG 校验 + 工作历 + 双前向 + 派生实际窗口 + what-if）；`buildScheduleSnapshot` 加 `schedule`/`coordination` 两键；loader 新错误码；control.yaml 加 `work_calendar` + PKG-005 constraints + 6-10 条试点 coordination | `schedule-projection`(新)、`shared/schedule-state.ts`、`schedule/phase-1/control.yaml`、`config/facts.yaml`(契约) | `npm run typecheck && test:server && schedule:render && verify:all`；api.test.ts 既有断言不改为通过；新投影单测全绿 |
| **S2 甘特** | `GanttPanel` + 路由/tab + what-if 控件 + 移动端降级 | `GanttPanel`(新，`app/src/ui/`)、`app/src/state/approval-route.ts`、`app/src/App.ts`、`app/style.css` | `npm run test:app && typecheck && build:app`；FlowChartPanel 既有 21 测不回退 |
| **S3 工作台+日历** | `RoleWorkbenchPanel` + `CoordinationCalendarPanel` + 路由 `roles`/`calendar` 补全 + 试点 coordination 4 → 9 条（SCH-010-02/030-04/040-03/080-01/090-01，见 §20） | 两个新面板（`app/src/ui/`）、`approval-route.ts`、`App.ts`、`view-state-store.ts`、`index.html`、`schedule/phase-1/control.yaml` | 同上（`schedule:render` 必跑）；冲突检测两级用例（同日 confirmed 双现场 = 冲突、未确认窗口重叠 = 潜在）绿 |
| **S4 收尾对账** | Issue 关闭标准 5 条逐条对账写入本文 §10；切片 C 回归清单执行记录 | 本文 | 业主确认关闭 #202 |

**为什么 S1 先于一切 UI**：快照是四个视图的共同上游，先锁增量形状再画界面，
避免面板围着会变的 JSON 改两轮（`ScheduleDetailPanel` 2254 行的教训）。

---

## 10. 测试计划

**node 侧（tests/server/ 或 shared 单测）**：
- DAG：环检测报 `dependency_cycle`；未知依赖；自依赖。
- 工作历：`workdays`/`rest_dates`/`extra_workdates` 展开正确；跨周末 ord 连续。
- 双前向：min/max 区间；并行分支（PKG-030/040 同层）互不推高；汇合（PKG-070 等 030+040+050）取最大。
- 无 anchor：输出 ordinals `date: null`，UI 契约"不造年月日"有测试钉。
- 检查记录窗口派生：空 audit / 部分通过 / waived → `check_window: null`；gate passed 且锚点就绪 → `check_window` = 首末 passed 检查 `checked_at` 的日期 + 映射序数；同日多条记录时 first = last；supersedes 后取最新。锚点未定 → 日期保留、序数为 null、errors 不含 `invalid_check_window`、forecast 仍等于 baseline（§17；非法日期串才是 `invalid_check_window`）。
- what-if：delay PKG-040:3 → 只影响拓扑下游；并行分支序数不变；`affected` 列出真实受影响包。
- 检查记录窗口不被 what-if 改写（它是证据，不是工期）。forecast 不再因 `gate passed` 被窗口钉死：delay 照常改点名包与拓扑下游。原句「已完成包不可因排程回退：`status: passed` 包在 what-if 中 forecast 不被改写」靠窗口钉死实现，§16 推翻（见 §16.6）。
- 协调契约：`coordination` 字段不出现在 gate/readiness 输入（结构断言 + facts 契约回归）。

**app 侧（vitest）**：
- 甘特：区间条渲染 min/max；无 anchor 显示"第 N 工作日"；点击写 selection 且不调 onHighlight；
  空/503 态；转义。（S2 已落地）
- 工作台：按角色分组；`notify` 不产冲突；同角色 onsite 冲突分两级——都已确认且同日 → 冲突徽标，
  未确认且 forecast 窗口重叠 → 潜在徽标（§16.4，S3 已落地，20 测）。
- 日历：三类 chip；`site_pending` 标"待定"；chip 位置 = 所属包 forecast 潜在窗口；
  confirmed 的登记日作证据文字展示、无锚点不钉列（S3 已落地，16 测）。
- 移动端：≤700px 甘特退化列表（照 FlowChartPanel issue #83 块写，S2 已落地）；
  工作台单列放宽、日历 chip 改文字行（S3 已落地）。

**契约/既有**：`tests/server/api.test.ts` 快照字段断言（增量为加法，不改旧值）；
`control-contract-validation.test.ts` 错误文案钉（新错误码是新增不是改文案）；
`verify:facts` coverage（`schedule/` 不在 coverage 宇宙内——`verify-facts.ts:165-171` 只收
`config/`+`data/`——但 T1 扫描含 `schedule/`（facts.yaml:138），新增数字均为工作日计数，
不匹配 `¥/kW/㎡/×` 任一 pattern，无新 warning）。

---

## 11. 与 #98 / #191 的关系：兼容，不阻塞，不新增债

- 本设计**不新增**任务/门禁/预算/验收的第二个源，不新增文件选择器。四类数据的所有权
  完全不动，只在 Execution/Schedule 域内扩容既有权威文件。
- #191 落地（PKG `targets`、acceptance 对象引用）后，本设计的投影各加一行透传，
  三个面板因只消费 selection store 而零改动。
- 因此**切片 B 不需要等 #191**——这是对该 Issue 原依赖表述的修正：依赖从"#191 完成后才开始"
  改为"任何时候开始都不给 #191 添堵"。

---

## 12. 风险与反转条件

| 风险 | 触发条件 | 反转/收敛动作 |
|---|---|---|
| 甘特长期只有相对工作日，现场觉得"看图说话" | 交房持续不定（BLK-HANDOVER 不关） | 接受：这正是"未知保持未知"的设计目标；关闭标准明说此态可接受。anchor 一填即出日期 |
| `coordination` 数据没人维护，变成新的 stale 事实 | 试点 6-10 条超过两个月无 confirmed 记录 | 收缩为只读展示 + `escalation` 未触发的告警；不删数据（事实留痕） |
| `duration_workdays` 是业主声明不是实测 | 任何包实际窗口偏离基线 >30% | 更新 control.yaml 声明值走 PR；基线自动重算，历史基线不存所以无"基线漂移"问题 |
| 工作日历假设与物业实际冲突 | SCH-005-01 通过拿回允许时段 | 修正 `work_calendar`/PKG-005 constraints（resolved），预测重算 |
| what-if 被当成"改好了的工期" | 有人拿 scenario 结果当承诺 | UI 上 scenario 区固定水印"演算视图，非计划；落配置走 AI 会话/PR" |
| 面板膨胀成第四套状态 | 有人在新面板里判 readiness | 契约 `c.coordination_not_gate_input` + 评审纪律：新面板只 render 快照 |

---

## 13. Issue #202 关闭标准对账（交付标准 5 条）

1. **可评审的设计记录**（对象关系/事实归属/状态机边界/排程规则 + 四外部项目取舍）→ 本文 §1/§2/§5/§8。✅
2. **最小真实工作流跑通**（看下一步→角色行动→协调确认→执行/验收留证→状态更新→排期重算），覆盖 PKG-000 与 PKG-070 → **§21 对账：六腿各有单一实现与门禁、只读证据齐；真实实例（协调确认、验收留证）待交房后，见 §21.3**。⏳ 待业主裁定关闭口径
3. **同一 PKG/SCH 四视图状态一致，无第二权威源** → 四视图共吃一个快照；门禁/就绪仍单实现于 `shared/schedule-state.ts`。✅（结构保证，§21.1 复核）
4. **基线/预测可区分，未知保持未知，协调≠验收，审批走现有授权** → §3 四线分离 + §5 两条机器断言 + D3 只读写路径。✅（§21.1 给了只读实测数字）
5. **测试可重复，既有校验不回退，不加假进度/假日期/自动放行** → §10；每片 PR 退出条件含 `verify:all` + `test:app`。✅ **§21.2 清单**（S1–S3.1 门禁判定行 + 切片 C 测试覆盖逐条）

---

## 14. Codex 审查回应（PR #216）

> **审查事件**：Codex 对提交 `43b4487` 的 `REQUEST_CHANGES`（2026-11-11）：blocking 5 · major 1 · minor 1 · nit 0。
> **修复端纪律**（`.github/prompts/codex-fix.md`）：每条 blocking 先定「主题（模块/状态机 + 失败类）」与
> 「决定（修复 / 结构性重做 / 升级）」，写在这里再动代码；同一主题不打补丁；major/minor 只列标题、不随本次提交。
> **本节只记录决策与被推翻的旧口径，不改写 §1–§13 正文。** 下文 `file:line` 均指被审提交
> `43b4487` 的行号（修复后行号会漂移，以函数名/原文为准）。

### 14.1 处置总表

| 编号 | 主题（模块/状态机 + 失败类） | 决定 | 推翻本文什么（章节 + 原文口径） |
|---|---|---|---|
| **B1** | 验收指纹链：`checkSpecHash`（`shared/schedule-state.ts:780-796`，对整个 `check` 求哈希）＋ coordination 注入点；失败类 = **静默失效**（仅改预约 status/actor/confirmed_at → 指纹变 → 已 passed 记录变 stale → `gate_status` 从 passed 退回 pending，并影响下游就绪） | **结构性重做**：协调事实移出被哈希的 `check` 对象；指纹输入改为**字段白名单**；补「新增未知键不改变指纹」的测试 | **§5 第 2 条机器断言**原文：「实现即『投影时 coordination 字段根本不进这两个函数的输入』（结构上不可能，比断言更强；契约 1 是防回归的保险丝）」——该结构保证只覆盖 gate/readiness 的**直接入参**，没管住「check → `checkSpecHash` → audit stale → gate_status」这条**间接**路径 |
| **B2** | 实际窗口派生：`deriveActualWindowsFromAudits`（`shared/schedule-state.ts:1406-1431`）＋投影钉死（`schedule-projection.ts:384-388`）；失败类 = **正确性**（假完工：任一条检查 passed 即把整个包钉成已完成，预测缩水、后继提前） | **结构性重做**：实际窗口的输入口径从「任一条 passed 检查的 `checked_at` 区间」改为「**完工事实**」；loader 只把完工事实交给投影，部分执行记录不生成实际窗口 | **§2.2** 原文：「PKG 实际窗口 = [min, max](`audit_log` 的 `records` 中该包 passed 记录的 `checked_at`)」及其「未 passed → 无实际窗口」的二分——它把「某条检查通过」与「工作包完工」当成同一件事，单条通过不等于完工 |
| **B3** | 工作日历 ord 地平线：`schedule-projection` 的 ord↔date 映射 ＋ loader 两遍调用按 ordinals 反查 `checked_at`（`shared/schedule-state.ts:1487-1496`）；失败类 = **静默删证据**（地平线外的真实验收日期被跳过，实际延期不传播） | **结构性重做**：`actual_windows` 输入改为真实日期（`{start_date,end_date}`，YYYY-MM-DD），由模块经日历映射；ordinals 按实际日期**双向扩展**，锚点前给负 ord；休息日按「之后第一个工作日」映射 | **§2.2/§6.1 的隐含假设**——§2.2 的 `checked_at` 反查与 §6.1 的 `ordinals: Array<{ord,date}>` 都假定「ordinals 只需覆盖基线所需日期、查不到就跳过」；**§3** 原文「全部计算输出以『自排程零点起第 N 个工作日』表示（1-based）」也隐含 ord 从 1 起，未定义锚点前的序数 |
| **B4** | `GET /api/schedule/state` 的 503 状态机：装配期投影（`buildScheduleProjectionView`，`shared/schedule-state.ts:1461-1505`）× route 时序（`server/routes.ts:412-419` 先查 `state.errors` 再调 `buildScheduleSnapshot`）；失败类 = **静默降级**（投影失败后追加 errors，但 503 判定已经过去，最终 200 返回空排程） | **结构性重做**：投影/日历校验全部提前到 load 阶段、并入 `state.errors` 同一通道；route 的 503 判定之前不得再产生新错误；`buildScheduleSnapshot` 内不得把投影失败包装成「正常空骨架」 | **§6.1** 原文「503 行为不变（`state.errors.length` → 503）；新 loader 错误码走同一通道」——原实现把投影放在 route 检查 errors **之后**，新错误赶不上这次 503 判定，「行为不变」只对 load 阶段错误成立 |
| **B5** | not_before 约束映射：`schedule-projection.ts:505-513` 对 resolved 约束无条件 `ordForDate`；失败类 = **正确性**（锚点 null 时把 2026 真实日期算成 1970 名义纪元第 14613 工作日，loader 虽隐藏日期却仍交付错误序数） | **修复**（锚点守卫）：`anchor_date === null` 时**不调用** `ordForDate`、跳过该约束抬升；由 loader 报 `constraint_resolved_without_anchor` | **§4 前向传播条**（对应审查意见所称「§4 第 5 条」；原文该句在算法第 3 条）原文「`not_before` 约束 resolved 时抬 start」的**无条件映射**——resolved 只说明约束生效，不说明存在可映射的时间坐标 |

### 14.2 B1：协调事实不得进入验收指纹

**事实链**（Codex 原文与代码一致）：`control.yaml:852-860` 的 `coordination` 块写在 `SCH-000-01` 的 check 内 →
`checkSpecHash` 对 `{packageSpec, check}` 整体 `JSON.stringify` → 只改 `status`/`actor`/`confirmed_at` 也会换指纹 →
`staleAuditReason` 把已 passed 记录降级成 stale（`shared/schedule-state.ts:797-806`）→ `auditStatusFor` 返回 stale →
`gate_status` 退回 pending。§5 的两条断言（facts 正则 + 「结构上不可能」）都没覆盖这条链：正则只扫
`gateStatus(...coordination` 这类直接文本，结构保证只约束「函数入参」。

**新保证**：① 协调事实不再住在 `check` 对象内，改为与 check 平级的独立块（loader 侧落）；②
`checkSpecHash` 只序列化显式**白名单**字段（验收标准字段 + `packageSpec`），新增键默认不进指纹；③
测试断言「给 check/coordination 加未知键后指纹不变、已有验收记录不 stale」。协调状态仍然连「被门禁读」都
不允许——§5 的 facts 契约保留为防回归保险丝。

**落地补充（loader 层，2026-11-11）**：白名单同时覆盖控制源 check 与引用型验收项（`acceptance.yaml` 经
`packageChecks` 摊平的字段并集），因为反向失效不分来源——新增 acceptance 字段而没人决定归属，同样会让
验收标准变化静默不进指纹。进哈希：`id/item/severity/checkpoint/method/pass_condition/evidence_required/
can_run_while_blocked/does_not_release_construction/owner_roles/rooms/when/standard_ref`（`standard`→
`pass_condition`、`evidence`→`evidence_required` 归一）；显式排除：`coordination`（协调事实）、
`knowledge`（背景说明，无机器强制）、`objects`（`from_packages` 是挂接登记，一致性由 `c.acceptance_objects`
对账）、`phase`/`phase_name`（阶段元数据）。测试遍历两个视图的**全部**键，未分类的键当场失败。

**package 侧白名单（2026-11-11 复审收口）**：`packageSpec` 同样不能整体入哈希。进哈希的包级字段只有
`id`（哈希作用域）；`name`/`description`/`sequence`/`dependencies`/`owner_roles`/`blockers`（含阻塞项
文案）等包级键全部显式排除——改名字、改描述、调顺序、改依赖或责任角色、换阻塞项文案都不改变「这项检查
怎么算通过」，不得让已 passed 记录变 stale。`targets` 由 `c.package_targets` 对账且
`model-package-links.yaml` 本身在项目数据指纹里，不需重复进验收指纹。测试对 control.yaml 的**全部包级
键**做同样的反向围栏，新增包级键未显式归类即失败。

### 14.3 B2：实际窗口只接受完工事实

**原口径的问题**：`deriveActualWindowsFromAudits` 取「该包所有 passed 检查的 `checked_at` 的 [min,max]」，
一条开工前检查（如 `SCH-000-PRE-01`）、隐蔽工程检查或任何一条验收通过，都会让整个包被钉成已完成。
Codex 探针：十天工期的包第一天一条通过记录 → 预测缩成一天、后继从第十一天提前到第二天。投影侧
（`schedule-projection.ts:384-388`）把 `actual_windows` 当事实钉死，本身没有错——错在 loader 把
「部分执行记录」冒充「完工事实」。

**新口径**：**实际窗口 = 完工事实**。loader 负责区分「部分执行记录」与「工作包完工」，只有后者进入
`actual_windows`；检查级别的执行时间线继续留在 `audit_log`，不再被投影消费。投影侧契约不变（给出即钉死），
因此 loader 侧的完工判定必须可解释、可测试。§2.2 的「复验 supersedes 取最新 passed」保留，但同样只在
完工事实上生效。

### 14.4 B3：ordinals 地平线按实际日期双向扩展

**原口径的问题**：loader 先用第一遍投影的 `ordinals` 建 `date → ord` 表，再拿 `checked_at` 精确反查；
`ordinals` 只展开到基线末端，锚点外的真实日期查不到 → 静默 `continue`。以锚点 2026-01-05、总计划
两工作日为例，2026-01-07 的通过记录被丢弃，预测仍保留原计划；休息日的检查记录同样丢失。

**新口径（模块 API 契约变更）**：

- `ProjectionInput.actual_windows: Record<pkg, {start_date: string, end_date: string}>`（YYYY-MM-DD），
  **不再接受 ord**；模块用同一张工作日历把它映射成 ord（loader 不再需要两遍调用）。
- **ord 定义**：ord 1 = 锚点当天或之后第一个工作日；锚点之前的工作日依次为 **0、-1、-2…**。
- **日期映射规则**：落在非工作日的日期取「当天或之后第一个工作日」——约束与 actual 窗口**同一条**规则
  （模块内 `ordForDate` 的既有 docstring 口径）；休息日/补班日按 `rest_dates` / `extra_workdates` 判定。
- **地平线**：`ordinals` 覆盖 `[minOrd, maxOrd]`，向后到最早的实际日期（可为负 ord），向前到
  基线/预测/实际的最晚末端。任何真实日期都不因「地平线外」被丢弃；非法日期报 `invalid_date` 而非跳过。
- **锚点为 null 的边界**：没有锚点就没有真实日期坐标系，模块不做名义纪元映射——actual 窗口直接判
  `invalid_actual_window`（与 B5 同一原则：不把 1970 序数交付给消费者）。
- **该边界的 loader 报错口径（loader 层落地，2026-11-11）**：loader 按 `projection_failed — [code]`
  原样透传 `invalid_actual_window`，不降级成无 code 的泛化 `projection_failed`；该 code 与
  `actual_window_unresolved`（gate passed 但没有任何可用 `checked_at`）一并登记在
  `shared/schedule-state.ts` 头注，并由 `tests/server/schedule-loader-contract.test.ts` 钉住。
- **部分 checked_at 非法的口径（2026-11-11 复审补）**：`checked_at` 必须是非空且真实存在的
  YYYY-MM-DD（loader 的记录级校验）。gate passed 的包只要有一条 passed 记录的 `checked_at` 非法，
  就不派生实际窗口并报 `actual_window_invalid_checked_at`——不许跳过非法记录、用其余合法日期拼出
  偏短窗口（实际完工日期可能正是被跳过的那条，预测会低估延期）。

### 14.5 B4：503 判定必须晚于全部投影校验

**原口径的问题**：`server/routes.ts:412-419` 先查 `state.errors.length` 再调 `buildScheduleSnapshot`；
投影在装配期才失败、失败后只往 `state.errors` 追加，响应已是 200，且响应体不包含新错误。空 `workdays`
且无补班日、`rest_dates` 与 `extra_workdates` 重叠这两类都能通过 load 校验却在装配期触发此路径；
`verify:schedule` 又不构建快照 → 无效配置全绿通行，API 把它包装成正常空排程。

**新口径**：投影所依赖的全部校验（DAG、工作日历可展开性、实际窗口日期合法性、约束日期合法性）在
**load 阶段**完成并进 `state.errors`；route 的 503 判定在「不会再产生新错误」之后执行。
`buildScheduleProjectionView` 不得再把投影失败降级成空骨架——要么 load 已拦截（503），要么成功。
§6.1 的「503 行为不变」保留其对 load 阶段错误的部分，删去「装配期投影错误走同一通道」的假保证。

### 14.6 B5：锚点守卫（本次模块层修复）

**原口径的问题**：`schedule-projection.ts:505-513` 对 resolved 的 not_before 无条件调用 `ordForDate`。
锚点 null 时日历用 1970-01-01 名义纪元展开，2026-01-05 被算成第 14613 工作日；loader 虽把 `ordinals.date`
置 null，却把错误序数交付给快照消费者。

**新口径**：resolved 的 not_before 带 `date` 时，若 `calendar.anchor_date` 为 null，**不调用**
`ordForDate`、不抬升该约束；loader 侧报 `constraint_resolved_without_anchor`（loader 层已落地，见 §14.8）。
锚点就绪后同一约束照常抬升。名义纪元只用于「无真实日期输入的 ord↔date 占位」，**不得**用于映射任何真实日期。

### 14.7 本次未改（标题照录）

本次 Codex 审查中以下两项**未改**，按 `.github/prompts/codex-fix.md` 的严重级别门留在审查评论里，
不随 blocking 修复提交：

- **major**「延期影响清单漏掉仅保守日期变化的下游包」——M1：`affected` 只比较 `forecast.start_ord −
  baseline.start_ord`（min 口径），仅 `end_ord_max` 变化的下游包 delta 为 0 被漏掉。
- **minor**「零工期里程碑实际仍占用一个工作日」——m1：零工期包 `end = start`，后继 `start = end + 1`，
  与头注「不占 ord，也不推后任何后继包」相反（当前 PKG-900 被调用方过滤，真实主排程暂不受影响）。

### 14.8 本次落点与后续

- **本次模块层修复**：B5（锚点守卫）与 B3（`actual_windows` 改为日期输入、负 ord、地平线双向扩展）落在
  `shared/schedule-projection.ts` ＋ `tests/server/schedule-projection.test.ts`；本节为决策记录。
- **loader 层落地（同 PR 后续提交，2026-11-11）**：B1/B2/B3 接线/B4 全部落在 `shared/schedule-state.ts`
  ＋ 新增 `tests/server/schedule-loader-contract.test.ts`。**`server/routes.ts` 未改**——原口径「B1/B2/B4
  落在 loader 与 route 层」中的 route 部分没有需要：投影前移后投影错误已进 load 期 `state.errors`，
  既有 `GET /api/schedule/state` 的 503 判定（`state.errors.length` 先于 `buildScheduleSnapshot`）自动覆盖，
  不需要也不应新增第二个错误通道。B1 改指纹算法使生成物 `schedule/phase-1/checklist.md` 的「检查标准指纹」
  列随之变化，已用 `npm run schedule:render` 重生成（diff 仅该列哈希值，无内容行变化）。
- 本文 §1–§13 正文暂不改写；B1/B2/B4 的 loader 实现落地时应同步修正被推翻的句子（§2.2、§5、§6.1），
  改写时按「文档改写必须 diff 出删了什么」附改动说明。

---

## 15. Codex 二审回应（PR #216，第 2 轮）

> **审查事件**：Codex 对提交 `4a568b9` 的 `REQUEST_CHANGES`（2026-11-11 03:27 UTC）：
> blocking 2 · major 1 · minor 2 · nit 0。审查正文见 PR #216 最新 review；本节的 finding
> 编号沿用本轮修复任务书：**F1**（反向日期映射）、**F2**（loader 实际窗口语义）、**M1**
> （延期影响清单）、**m1**（零工期里程碑）、**空调商**（封板联合验收名单）。
> **修复端纪律**（`.github/prompts/codex-fix.md`）：每条先定「主题（模块/状态机 + 失败类）」
> 与「决定」，写在这里再动代码；同一主题不打补丁。**本轮 major/minor 是业主对话点名「全修」**，
> 不是自动跟审——本条同时写进修复说明。
> **§15.1–15.8 只记录决策与被推翻的旧口径，不改写 §1–§13 与 §14 正文；§15.9 起为落地记录，F2 正名按 §15.9 的删改清单改写被推翻的正文（§2.2 / §3 / §6.1 / §10）。**

### 15.1 处置总表

| 编号 | 主题（模块/状态机 + 失败类） | 决定 | 推翻本文什么（章节 + 原文口径） |
|---|---|---|---|
| **F1**（blocking） | `schedule-projection.ts` 的日期→ord 映射；失败类 = **正确性**（顺序相关状态：查询顺序改变结果，合法实际日期被静默改写） | **修复（结构性）**：日期→ord 改为无状态查询——ord 只由日历决定，按日期 memo 缓存；删除共享反向游标在查询路径上的推进。任何调用顺序、任何查询次数同结果 | **§14.4** 的「新口径」只规定了日期映射方向（休息日向后取）与 ordinals 双向地平线，**没有要求查询顺序无关**；实现里 `ordForDate` 越过目标日期时保留已递减的 `backwardCursorDay` 且不缓存该日（`4a568b9` 的 `schedule-projection.ts:293-296`）。**§14.6** 只处理锚点守卫，未覆盖此路径 |
| **M1**（major） | `scenario.affected` 计算；失败类 = **漏报 + 误报**（漏：仅保守末端变化的包；误：把既有实际窗口造成的位移算成本次演算） | **修复**（业主点名）：对照基准改为「未应用 scenario 的当前预测」（`forecast-no-scenario`，含实际窗口、不含 delay）；比较完整窗口（`start_ord` / `end_ord_min` / `end_ord_max` 任一变化即受影响）；`delta` 只计本次 scenario 造成的最大窗口位移 | **§14.7** 明确把 M1 列为「本次未改」（major「延期影响清单漏掉仅保守日期变化的下游包」）；**§4 第 5 条** 原文「输出 `affected: [{pkg, baseline, forecast, delta}]` 与原基线对照」——以声明基线为对照，必然混入既有实际偏移，也只看得到乐观起点 |
| **m1**（minor） | 零工期包的窗口边界（前向传播后继起点）；失败类 = **正确性**（零工期里程碑实际占用一个工作日，与模块头注承诺相反） | **修复**（业主点名）：零工期包不占工作日——后继从该包的 `start_ord` 起算（`start = max(dep.end)+1` 对零工期依赖特判为 `dep.end`）。模块头注「不占 ord，也不推后任何后继包」由承诺变为事实 | **§14.7** 明确把 m1 列为「本次未改」（minor「零工期里程碑实际仍占用一个工作日」）；**§4 第 3 条** 原文「`start = max(dep.end) + 1`」是无条件公式，没有零工期例外；模块头注（`4a568b9` 的 `schedule-projection.ts:38-39`）早已声称「不占 ord」，实现与声明相反 |
| **F2**（blocking） | loader 实际窗口派生（`shared/schedule-state.ts` 的 `deriveActualWindowsFromAudits`）；失败类 = **语义过度声称**（把检查通过日期冒充实际施工起止事实） | **正名重构**（业主点名全修；**由下一棒落地，本轮只登记**）：停止把「最早/最晚 passed 检查的 `checked_at`」以「实际开工/完工」语义交付；保留未知的实际开工时间，或把该窗口正名为检查记录窗口，投影侧 `actual` 字段的命名与消费口径同步评估 | **§14.3** 的「新口径：实际窗口 = 完工事实」声称 loader 已能区分「部分执行记录」与「工作包完工」、只有后者进入 `actual_windows`；二审指出 `4a568b9` 的 `schedule-state.ts:1119-1120` 仍把最早 passed `checked_at` 直接写成 `start_date`。该保证是过度声称，`actual_windows` 目前不是施工起止事实 |
| **空调商**（minor） | 排程配置数据（`schedule/phase-1/control.yaml` 的 SCH 协调名单）；失败类 = **漏报**（封板联合验收缺空调商，角色工作台会漏协调要求） | **补数据**（业主裁定补上；**由下一棒落 control.yaml，本轮只登记**）：`4a568b9` 的 `control.yaml:1321` 封板联合验收 `required_roles` 补入空调商，与设计文档同一示例一致 | **§2.1(c)** 的协调事实以 control.yaml 名单为完整声明；§14 的 loader 层修复未涉及名单完整性，本轮确认「名单可后补、当前快照可交付」的隐含口径不成立 |

### 15.2 F1：日期→ord 改为无状态查询

**原口径的问题**（与 Codex 探针一致）：`ordForDate` 走反向扫描时直接推进共享的
`backwardCursorDay`；越过目标日期（`backwardCursorDay < targetDay`）即返回，却既不缓存刚
越过的那个工作日，也不回退游标。复现：锚点 2026-01-05、周一至周五工作，先映射
2026-01-01、再映射 2025-12-31，两者都得到 ord −1，且 2025-12-31 从 ordinals 消失；
交换顺序才得到 −2 / −1。合法实际日期因此被静默改写，后继预测随之偏移。

**新口径**：

- `ordForDate` 的结果只由「工作日历 + 目标日期」决定，**不依赖此前查询过哪些日期、查询几次**。
- 反向段改为「把 `backwardDays` 单调展开到目标日期之下，再二分取最后一个 ≥ targetDay 的
  工作日」；`backwardDays` 只由 `ensureBackward(count)` 顺序追加，查询路径不再直接推进游标。
- 正向段同样改为「展开到目标日期、二分取第一个 ≥ targetDay 的 ord」，并对目标日期做
  `Map<天序号, ord>` memo。
- 断言：① 同一批实际窗口按两种插入顺序（01-01 先 / 12-31 先）投影结果 `deepEqual`；
  ② `not_before` 约束与实际窗口混查结果一致；③ 休息日反向查询取之后第一个工作日；
  ④ 一批锚点前日期的 ord 连续、无跳号、无重复，且 ordinals 含 2025-12-31。

### 15.3 M1：affected 以「无 scenario 的当前预测」为对照，比较完整窗口

**原口径的问题**：`scenario.affected` 只比较 `forecast.start_ord − baseline.start_ord`。
以 Codex 探针为例：A 工期 1–10、B 工期 5、C 依赖 A 与 B，A 延期 3 天后 C 的保守完工日从
11 变 14，但乐观起点仍由 B 决定（不变）→ 旧算法 `delta = 0` 直接把 C 从清单里丢掉。
另一半是误报：`baseline` 不含实际窗口，已有实际延期会被记成「本次演算影响」，即使
`scenario.delay` 为 0 也会输出受影响清单。

**新口径**：

- 新增 `forecast-no-scenario`：实际窗口照常钉死、**不加** scenario delay，其余与 forecast 同。
- `affected` 条件：拓扑下游包在 `start_ord` / `end_ord_min` / `end_ord_max` 三者中**任一**变化。
- `delta` = 该包三处位移的最大值（`max(start 差, end_min 差, end_max 差)`）——只承载本次
  scenario 的贡献；仅保守末端变化时 delta 即该末端的位移，不再为 0 被误读。
- 断言：① Codex 探针（A 1–10 ∥ B 5 → C）delay +3 后 C 进 affected 且 delta 3；
  ② 存在实际延期、`scenario.delay` 为 0 时 affected 为空，既有实际位移仍留在 forecast 里。

### 15.4 m1：零工期包不推后继

**原口径的问题**：零工期包 `end = start`，但后继无条件 `start = dep.end + 1`，把里程碑
当成占用一个工作日；根节点零工期 → 后继从第 2 日起算，与模块头注「不占 ord，也不推后
任何后继包」相反。

**新口径**：前向传播按本遍口径的声明工期判定「零工期包」；依赖贡献对零工期包取
`dep.end`（= `dep.start`），对非零工期包仍取 `dep.end + 1`。实际窗口钉死的包不参与零工期
特判（实际窗口是事实，仍按末端顺延）。既有 PKG-900 `{0,0}` 用例改为带后继断言：
PKG-900 与后继 PKG-000 的基线起点都是 ord 1，不是 2。

### 15.5 F2：loader 实际窗口语义正名（下一棒落地）

二审 blocking「验收日期不能直接充当实际开工日期」：`deriveActualWindowsFromAudits` 把
该包全部 passed 记录中最晚的 `checked_at` 作 `end_date`、最早的作 `start_date`。检查通过
时间不是施工起止事实（拆墙/结构检查在拆完后才做；所有检查同一天登记时多日施工会被钉成
一天）。**决定：正名重构**——停止以「实际施工起止」语义交付该窗口；保留未知的实际开工
时间，或把它明确为检查记录窗口，并同步评估投影 `actual` 字段的命名/消费。**本轮模块层
不改**，由下一棒在 loader 层落地；落地前该字段不得被描述为实际施工起止。

### 15.6 空调商：封板联合验收名单补数据（下一棒落地）

二审 minor：`control.yaml:1321` 封板联合验收的 `required_roles` 只有业主、施工方、设计师，
但该检查要复查空调保压、冷凝水、风口和检修口，设计文档同一示例含空调商。业主裁定补上。
**决定：补数据**（`control.yaml` 由下一棒修改，本轮只登记）；在补上之前，当前快照的
协调名单不得被当作完整名单消费。

### 15.7 轮次预算

- **F1**（日期映射模块）：本轮为该主题**第 1 次**自动回应，按结构性修复处理（不是计数器补丁）。
- **F2**（实际窗口语义）：属「实际窗口」主题**第 2 轮**（第 1 轮见 §14.3 的 B2）。本轮按业主
  指示做正名重构；若第 3 轮仍咬该主题，按 `.github/prompts/codex-fix.md` 停止自动修复并升级给人。
- **M1 / m1 / 空调商**：本轮按业主「全修」指示一并处理（M1/m1 在本轮模块层落地，空调商下一棒）。

### 15.8 本次落点

- **本次模块层修复**：F1、M1、m1 落在 `shared/schedule-projection.ts` ＋
  `tests/server/schedule-projection.test.ts`；本节为决策记录。
- **不改**：`shared/schedule-state.ts`（loader）、`schedule/phase-1/control.yaml`——F2 与空调商
  由下一棒落地。
- §1–§13 与 §14 正文不改写；§14.3 的「实际窗口 = 完工事实」、§14.7 的「本次未改」两条
  按 15.5 / 15.3 / 15.4 的新口径执行。

### 15.9 F2 落地：检查记录窗口正名（loader 层，2026-11-11）

**落地内容**：

- `shared/schedule-state.ts` 的 `deriveActualWindowsFromAudits` → `deriveCheckWindowsFromAudits`，返回 `{first_date, last_date}` 的检查记录窗口；loader 边界再映射成模块冻结入参 `actual_windows: {start_date, end_date}`。函数注释写明「首末 passed 检查日期的证据窗口，不是施工实际起止；实际开工时间从未记录，保持未知」。
- 快照 `SchedulePackageProjectionView` 的 `actual: {start_ord, end_ord}` → `check_window: {first_ord, last_ord} | null`（模块 `ProjectedPackage.actual` 字段名本轮冻结，模块文件不动；交付侧在 `buildScheduleProjectionView` 换名换字段）。
- loader 诊断错误码 `actual_window_unresolved` / `actual_window_invalid_checked_at` → `check_window_unresolved` / `check_window_invalid_checked_at`，文案同步去掉「完工事实 / 实际窗口」的过度声称。§14.4 里出现的那两个旧 loader code 名是历史记录（当轮尚未正名），现役名称以本条与 `shared/schedule-state.ts` 头注为准。模块 code `invalid_actual_window` 保持不变（模块层冻结），语义按「检查记录窗口没有真实日期坐标」解释。
- **投影消费不变**：有窗口的包 forecast 仍钉死在该窗口；钉的是「门禁 passed 的完成证据」，不是「施工实际起止」。§2.2 公式按此重写。
- 测试：`tests/server/schedule-loader-contract.test.ts` 的窗口断言改读快照 `check_window`；新增一条语义钉死断言——PKG-005 声明工期 min 3 工作日、两条检查同日登记时 `check_window.first_ord === last_ord === 3`，且快照视图不含 `actual` 键；waived / 部分通过 → `check_window: null` 由既有用例与新增用例共同钉住。

**推翻关系 / 删改清单**（AGENTS「文档改写必须 diff 出删了什么」）：

- §2.2 标题「实际日期：派生，不存储（D2）」与公式「PKG 实际窗口 = [min, max](…passed 记录的 checked_at)」删除，改为「检查记录窗口」口径；理由：检查通过时间 ≠ 施工起止（拆墙检查在拆完后才做；同日登记把多日施工压成一天）。
- §14.3 标题与正文「新口径：实际窗口 = 完工事实」不再按「施工完工」解读；「完工」仅指「门禁全部检查 passed」，交付物是检查记录窗口。
- §6.1 快照契约 `actual:` 字段改为 `check_window:`；§3 四线表的「实际」行改为「检查记录」行；§10 测试计划 bullet 同步。删除的只是旧字段名/旧语义，窗口数据本身与钉死行为不变。
- 本条推翻 §15.8 末条「§1–§13 正文不改写」在 §2.2 / §3 / §6.1 / §10 四处的作用范围——F2 正名必须让这些正文与新字段名一致，否则文档继续声称 `actual`。
- **轮次预算**：F2 属「实际窗口」主题第 2 轮（§15.7）。本轮已按业主指示做正名重构（不是补丁）；若下一轮 Codex 仍咬该主题，按 `.github/prompts/codex-fix.md` 升级给人，不再自动修复。

### 15.10 空调商：封板联合验收名单落地（2026-11-11）

- `schedule/phase-1/control.yaml` 的 `SCH-070-01 coordination.required_roles` 由 `[业主, 施工方, 设计师]` 补为 `[业主, 施工方, 设计师, 空调商]`。
- **理由**：该检查的 `method` 全文是空调隐蔽工程复查（保压、冷凝水、风口、回风、检修口、上部水电和全部隐蔽影像），空调商不到场无法完成；设计 §2.1(c) 的同一示例本就含空调商；两条独立复审均提出该缺口。业主裁定补上。
- **隔离边界不变**：`coordination` 只是到场要求，不是门禁/就绪输入——它不在 `checkSpecHash` 白名单（§14.2），不参与 `gateStatus` / `effectiveReadiness`，快照走独立 `coordination` 键（§6.1）。本次只加一个角色字符串，不改变任何包的门禁/就绪判定。
- 派生视图已用 `npm run schedule:render` 重生成（指纹新鲜性由 `verify:schedule` 检查）。

---

## 16. 实际窗口主题根治（业主裁定 A，第 3 轮）

> **审查事件**：Codex 对提交 `9f474efb` 的 `REQUEST_CHANGES`（2026-11-11T04:47:27Z）：blocking 1 · major 1 · minor 1 · nit 0。
> **本轮不是自动跟审。** 代理已在第 3 轮按 `.github/prompts/codex-fix.md` 停止自动修复并升级（PR #216 评论，2026-11-11T04:49:20Z，<https://github.com/phona/bontop-design-log/pull/216#issuecomment-6787327352>）。业主在对话里裁定原话「走 A」，并点名同时修本轮 major / minor。本节先于代码改动写入。
> **本节只追加，不改写 §1–§15。** 下文「推翻」是登记被推翻的旧句，那些句子仍留在原节，以本节为准。

### 16.1 打地鼠界定：三条 finding 是同一条链

链（三轮都没换过）：

```
audit_log.checked_at
  → deriveCheckWindows（loader）
  → projectSchedule(check_windows / 旧名 actual_windows)
  → forecast 被检查日期覆盖
  → 快照 schedule.packages[].forecast 原样交付
```

根因不是某一环的字段名或派生门槛，而是**用检查时间冒充施工时间**：检查通过日被当成施工起止，写进预测。每一轮只换了链上的一个环节，消费端的冒充还在。

| 轮 | finding（审查） | 这一轮修的环节 | 没动的根因 |
|---|---|---|---|
| 一审 B2（2026-11-11T00:49:59Z，审 `43b4487`） | 「任一检查通过即把整个工作包钉成已完成」 | **loader 派生门槛**：改为 gate passed 才生成窗口（§14.3）。投影侧「给出即钉死」被明确保留 | forecast 仍把窗口当施工起止消费。当时钉死在 `schedule-projection.ts` 的前向传播（审查点名当时的 :384–388） |
| 二审 F2（2026-11-11T03:27:44Z，审 `4a568b9`） | 「验收日期不能直接充当实际开工日期」 | **交付侧正名**：快照键 `actual` → `check_window`，loader 函数与错误码文案去掉「完工事实」（§15.9）。模块文件按当时纪律冻结 | 正名没有剪消费链。loader 仍把 `first_date/last_date` 填进模块入参 `actual_windows`；`forwardPass` 仍用该窗口覆盖 forecast。§15.9 写明「投影消费不变：有窗口的包 forecast 仍钉死」 |
| 三审（2026-11-11T04:47:27Z，审 `9f474efb`） | 「检查记录窗口仍被当作施工预测起止消费」 | **本轮之前没有改代码**，只留了升级评论 | 同一条链的最后一环仍在：修复前 `shared/schedule-projection.ts:509-513` 用窗口覆盖整个 forecast，快照（`schedule-state.ts:1710`）原样交付该预测 |

三审另外两条不是这条链，见 §16.4。它们在升级评论里被标明「留着备业主点名」，本轮是业主点名后才修，不是自动跟审把 major/minor 塞进 blocking 提交。

**本会话复现（修复前，工作树 `ep-202-scheduling`，`node --import tsx` 直接调 `projectSchedule` / `detectCoordinationConflicts`）**：

- 声明 `min: 3, max: 7` 的包，检查窗口起止都是 `2026-01-05`：forecast 被压成 `{start_ord:1, end_ord_min:1, end_ord_max:1}`，baseline 仍是 `{1, 3, 7}`，后继从第 2 日开始。与三审 blocking 的探针同构。
- `workdays: []`、`extra_workdates: ['2026-01-05','2026-03-05']`、锚点 `2026-01-05`、工期 2：抛 `work_calendar_exhausted`，「已扫描 29 天只得到 1 个工作日」。
- 同日历、锚点改到 `2026-03-05`、检查日期 `2026-01-05`：反向展开同样抛 `work_calendar_exhausted`，「锚点前已扫描 22 天只得到 0 个工作日，无法达到序数 0」。
- `PKG-000` 工期 15–25、两条 onsite 同角色且无预约日期：返回一条冲突，reason 含「SCH-000-01 第 1–25 工作日、SCH-000-02 第 1–25 工作日」。与三审 minor 的「第 1–25 工作日」同文。

### 16.2 业主裁定与升级评论

升级评论存在，选项是评论里写的三选一，不是本轮新发明：

- **A.** 完全解耦：forecast 只由声明工期 / 依赖 / resolved 约束决定，check_window 作为证据叠加层独立交付，不做任何钉死。
- **B.** 只钉完成端：forecast 的结束钉在最后一条 passed 检查日，起点保持计划值。
- **C.** 接受该风险合并：消费链维持现状。

业主裁定原话：「走 A」。本轮按 A 改模块，不按 B 做「只钉末端」的又一次局部补丁，也不按 C 把风险登记成口径。

### 16.3 根治定义（A 的可执行口径）

剪的是消费，不是再加一道「窗口合法才钉」的门。

1. **检查记录窗口只作证据层独立交付。** 它仍然是输入（`check_windows: {start_date, end_date}`），仍然经工作日历映射成 ord，仍然作为 `ProjectedPackage.check_window` 返回，仍然参与 `ordinals` 地平线扩展（锚点前负 ord、超出计划末端的检查日都留在 ordinals 里——这是 B3 的成果，保留）。
2. **forecast 纯由计划与 scenario 演算决定。** 与 baseline 同一套前向传播：声明工期、依赖、resolved 的 `not_before`。无 scenario 时 forecast 与 baseline 相同。有 scenario 时差异只来自 `scenario.delay`，且 delay 只改点名包的工期并只重算拓扑下游。
3. **检查日期绝不参与 forecast 计算。** 不覆盖该包的起止，不顺延后继，不让 delay 被窗口吞掉。实际开工时间仍然从未记录，保持未知；在引入显式的开工事实之前，没有「计划 vs 施工实际」这一层。检查窗口不是那个事实。

命名在模块内一次收干净，避免第四种叫法：`actual` / `actual_windows` → `check_window` / `check_windows`；`ProjectionActualWindow` → `ProjectionCheckWindow`；`ProjectionActualDates` → `ProjectionCheckDates`。错误码 `invalid_actual_window` / `unknown_actual_window_package` 同步改为 `invalid_check_window` / `unknown_check_window_package`。日期字段仍是 `{start_date, end_date}`，ord 字段仍是 `{start_ord, end_ord}`——快照侧的 `first_ord` / `last_ord` 换名留在 loader 边界，模块不另造一套。不加旧名别名。

### 16.4 major / minor（业主点名，不是自动跟审）

升级评论把这两条标成「按严重级别门不自动修」。本轮修它们，只因为业主在同一条指示里点了名。

| 级别 | 主题 | 决定 |
|---|---|---|
| **major** | 扫描上限拒绝合法稀疏工作日历。`scanLimitFor` 按「工作日数 × 7」估算扫描天数；`workdays` 为空、`extra_workdates` 相隔约两个月时，第二个已声明的工作日在上限之外，误报 `work_calendar_exhausted`，loader 会把整个 `/api/schedule/state` 打成 503 | **修**：扫描上限从日历自身声明的日期推导（最远声明日与锚点的距离 + 缓冲），并与原 7× 保险丝取较大值。声明过的工作日必须找得到；声明日不够凑工期时仍然报 `work_calendar_exhausted`。正向 `ensure` 与反向 `ensureBackward` 都改。不在模型边界禁止稀疏日历 |
| **minor** | `detectCoordinationConflicts` 把每个 SCH 的占用设成所属包的完整预测区间。同包两个 `onsite` 同角色、都还没有预约日期，必然报「同一天两处现场」 | **修**：两级。没有 confirmed 日期的条目只有潜在窗口（包的预测区间），两个潜在窗口重叠只记 `potential`（提示，不是冲突）。`status === 'confirmed'` 且带 `confirmed_at` 的条目才有真实占用，占用是 `confirmed_at` 当天，不是包区间；两个真实占用同角色 onsite 同一天才记 `conflicts`。返回值改为 `{conflicts, potential}`。该函数目前只有测试调用，无活消费方 |

### 16.5 轮次预算

- 本主题（检查日期冒充施工时间，链见 §16.1）的 Codex `REQUEST_CHANGES` 已有 **3** 轮。第 3 轮代理已升级，没有再打补丁。
- **本轮代码改动是业主指示修复**（原话「走 A」），不是第 4 次自动跟审，也不占用「再自动回应一次」的配额。
- 若 Codex **第 4 轮仍咬该主题**（症状换行、字段换名、再要求把检查日期钉回 forecast 的任何一截，都算），再次升级给人，**不再自动改**。
- major / minor 是另一主题。本轮因业主点名而修；它们自己的轮次不并进「实际窗口」这 3 轮。

### 16.6 本轮落点，以及被推翻、但 §1–§15 尚未改写的旧句

**本轮改的文件**：`shared/schedule-projection.ts`、`tests/server/schedule-projection.test.ts`、本节。**不改** `shared/schedule-state.ts`（loader 由下一棒接线）。

模块改名后，loader 在下一棒改完之前对不齐，这是预期的断点，不是兼容层：

- 入参 `actual_windows` → `check_windows`；类型 `ProjectionActualDates` → `ProjectionCheckDates`。
- 输出 `ProjectedPackage.actual` → `check_window`（内层仍是 `start_ord` / `end_ord`；快照的 `first_ord` / `last_ord` 仍由 loader 换）。
- 错误码 `invalid_actual_window` → `invalid_check_window`（`tests/server/schedule-loader-contract.test.ts` 钉的 `[invalid_actual_window]` 会红，直到下一棒改钉）。
- loader 头注与 `deriveCheckWindowsFromAudits` 注释里「投影据此钉死 forecast」「模块入参名本轮冻结」在本轮之后是假的，下一棒删，不要再按那两句接线。

**被推翻的旧句**（留在原节，执行以本节为准；下一轮改写正文时按「文档改写必须 diff 出删了什么」处理，不要静默留着）：

| 位置 | 被推翻的原文口径 | 为何可推翻 |
|---|---|---|
| §3「当前预测」行 | 「基线重算，但把已有检查记录窗口的包钉死在该窗口，未完工包继承基线」 | 钉死的输入是检查日，不是施工起止。A 规定 forecast 与 baseline 同源，差异只来自 scenario |
| §4 算法第 4 条 | 「预测把 `auditWindows` 中已有实际窗口的包钉死在实际值，其后包从实际末端继续」 | 同上。后继从实际末端继续会把检查日传播成施工延期 |
| §2.2 | 「投影把该窗口当作『门禁 passed 的完成证据』钉死 forecast」 | 「门禁证据」可以独立交付，不能因此确定施工预测起止。§2.2 的「不是施工实际起止」保留，被删的是后半句的钉死 |
| §10 | 「已完成包不可因排程回退：`status: passed` 包在 what-if 中 forecast 不被改写」 | 该保证靠窗口钉死实现。窗口不再进 forecast 之后，delay 照常改点名包与拓扑下游；检查窗口本身不被 delay 改写（它是证据，不是工期） |
| §14.3 | 「投影侧契约不变（给出即钉死）」 | 这是一审留下的半截。二审正名、三审指出消费链都在打这一句。A 明确推翻它 |
| §15.3 | 对照基准「含实际窗口、不含 delay」的 `forecast-no-scenario` | 窗口不再制造 forecast 位移，对照基准就是 baseline。保留的是：比较完整窗口、delta 取三处位移的最大值、只列拓扑下游 |
| §15.4 | 「实际窗口钉死的包不参与零工期特判（仍按末端顺延）」 | 不再有钉死。零工期只看声明工期 |
| §15.9 | 「投影消费不变：有窗口的包 forecast 仍钉死在该窗口」；「模块入参名 `actual_windows` 本轮冻结」；「模块 code `invalid_actual_window` 保持不变」 | 冻结是为了把正名和剪链拆开。A 要求本轮把模块命名和消费一起收掉，冻结到此为止 |
| §0 结论表 D2 | 「实际起止不存新字段，派生自 `audit_log` … `checked_at`」 | 派生出的窗口是检查记录证据，不是施工起止；施工起止从未记录，保持未知。窗口不进 forecast（§16.1 链已剪断） |
| §4 算法第 6 条 | 「若预测窗口重叠 → 冲突（同一天两处现场）」 | 冲突分两级：未确认预约只有潜在窗口（提示级），同日 confirmed 的同角色 onsite 才算冲突（§16.4） |

删掉的不是检查窗口数据，是「检查日期 → forecast 起止」这条消费。窗口、ordinals 双向地平线、锚点守卫、日期查询顺序无关都还在。

**loader 接线（本节写完后的下一棒，已落地）**：`shared/schedule-state.ts` 已按上面四条改名接线——入参 `check_windows`、类型 `ProjectionCheckDates`、快照由 `projected.check_window` 映射成 `{first_ord, last_ord}`（快照键名自 S1 起就是 `check_window`，未改）。头注与 `deriveCheckWindowsFromAudits` 里「投影据此钉死 forecast」「模块入参名本轮冻结」已删；「不是施工实际起止」保留。`tests/server/schedule-loader-contract.test.ts` 两处旧钉一并改掉，否则接线后必红：`[invalid_actual_window]` → `[invalid_check_window]`；PKG-005 全部 passed 时把 forecast 钉成检查日 `{start_ord:3, end_ord_min:5, end_ord_max:5}` 的断言，改为无 scenario 时 forecast 等于 baseline（PKG-000 工期 15–25 之后，PKG-005 为 `{16, 18, 32}`）。§2.2 / §3 / §4 第 4 条 / §6.1 快照注释 / §10 对应句已按上表改写。§14 / §15 的当轮原文留作历史，不回改。

---

## 17. 无锚点检查窗口的过度防御（第 4 轮，业主裁定 A）

> **审查事件**：同一条链（检查日期 ↔ 锚点/预测）的第 4 轮 Codex `REQUEST_CHANGES`。前三轮记账是 §14 / §15 / §16。
> **本轮不是自动跟审。** `.github/prompts/codex-fix.md` 规定第 4 轮起该主题只由人处理。本轮改代码，是因为业主在对话里裁定「A」并指示修复——与 §16 同一条例外（业主点名），不把这次记成第 4 次自动跟审，也不占用「再自动回应一次」的配额。
> **本节先于代码改动写入。只追加，不改写 §1–§16。** 下文「推翻」是登记被推翻的旧句，那些句子仍留在原节，以本节为准。
> **引入点核对**（写本节时在工作树 `ep-202-scheduling` 跑的，不是记忆）：`git diff 43b44873 4a568b9e -- shared/schedule-projection.ts` 里，无锚点抛错与 B5 的 not_before 跳过是同一次新增；`git diff 4a568b9e 9f474efb` 在该抛错上为空；`git log -S "无法把检查记录窗口"` 只命中 `eed4dc5e`（三审把「实际窗口」改名为「检查记录窗口」，抛错行为没变）。

### 17.1 轮次总账：检查日期被反复贴标签

对象四轮没换过。换过的是贴在它身上的标签，而且是两条边轮流贴：

```
audit_log.checked_at
  → 检查记录窗口（曾用名 actual_windows）
  → 预测边：被当成施工起止，写进 forecast
  → 锚点边：无锚点时被当成「必须能映射成序数，否则整份投影非法」
```

| 轮 | 审查与修复提交 | 这一轮贴的标签 | 修了什么 | 没动的根因 |
|---|---|---|---|---|
| 一审（§14，审 `43b4487`，修复 `4a568b9e`） | B2 假完工；B3 地平线外的日期被跳过；B5 约束日期被算进 1970 名义纪元 | **完成条件**，外加第一次把锚点边写成抛错 | B2：派生门槛收到 gate passed。B3：窗口改真实日期、负 ord、地平线双向扩展。B5：`anchor_date === null` 时 resolved not_before **不调用** `ordForDate`、不抬升 | forecast 仍消费窗口。同一提交把 B5 扩进窗口：锚点 null 且 `actual_windows` 非空 → 抛 `invalid_actual_window`。§14.4 称之为「与 B5 同一原则」 |
| 二审（§15，审 `4a568b9`，修复 `9f474efb`） | F2「验收日期不能直接充当实际开工日期」 | **命名** | 交付侧 `actual` → `check_window`，文案去掉「完工事实」。模块按当时纪律冻结，抛错原句未改（diff 为空） | 消费链还在。「无锚点即抛」还在 |
| 三审（§16，审 `9f474efb`，业主裁定 A，修复 `eed4dc5e`） | 「检查记录窗口仍被当作施工预测起止消费」 | **消费链** | forecast 改为与 baseline 同源；模块入参改名 `check_windows`；错误码改名 `invalid_check_window` | 锚点边上的抛错只换了名字。本轮改代码之前，`shared/schedule-projection.ts:633-642` 仍是：锚点 null 且 `check_windows` 非空 → `invalid_check_window`（「无法把检查记录窗口的真实日期映射成排程序数」）。loader 把该抛错计入 `state.errors`，`GET /api/schedule/state` 503 |
| 四审（本轮，业主裁定 A） | 无锚点 + 真实检查日期 → 抛错 → 503。这是三审留下的那半边 | **锚点守卫过度防御** | 删抛错，补完无锚点半边模型（§17.3）。不是再加一道「窗口合法才映射」的门 | 见 §17.5。五审再咬这条链就升级，不再自动改 |

根因不是某一轮的字段名。检查日期在两条边上被当成计划输入：预测边要它决定起止，锚点边要它要么变成序数、要么让整份投影失败。三审剪了预测边，锚点边的「不能映射 = 非法」还在。那一句不是 Codex 一审 B5 的要求。§14.6 的 B5 只说 resolved not_before 在锚点 null 时不调用 `ordForDate`、不抬升。把它写成「检查窗口无锚点即抛」，是一审修复自己加的。

### 17.2 自我教训

B5 守卫本只防「1970 名义纪元造序数」：没有锚点时，不要把 2026 的真实日期算成名义纪元上的第 N 个工作日再交给消费者。正确的半边是「不算这个序数」。

任务书把后续的扩大称作「二审被过度扩展成无锚点即抛」。对照 diff，扩大发生在回应一审的同一次提交里（和真正的 B5 跳过写在一起，注释原文「设计 §14/B5 同一原则」）；二审没有再扩，也没有拆；三审剪消费链时只改了错误码的名字。记在哪一轮名下不改变教训：**拒绝造假序数，被实现成了拒绝交付证据。** 证据日期映射不了，就标待定，不要抛。

### 17.3 本轮根治（业主裁定 A 的可执行口径）

无锚点时，检查窗口是证据，不是计划坐标：

1. **日期保留为事实。** `start_date` / `end_date` 原样返回，不改写成映射后的工作日，也不丢。
2. **序数标待定。** `start_ord` / `end_ord` 为 `null`。不调用 `ordForDate`，不碰 1970 名义纪元。
3. **不抛错。** `invalid_check_window` 不再因「无锚点」触发。
4. **不参与任何计划计算。** 不进 baseline，不进 forecast，不扩展 `ordinals` 地平线，因此也不改变 scenario。与「没有这份检查窗口」的投影相比，baseline / forecast / ordinals 逐字节相同。

锚点就绪时照常映射：序数、锚点前的 0 与负 ord、休息日向后取、地平线双向扩展，都是 §14/B3 的成果，不回归。

类型以现有 `ProjectionCheckWindow` 扩展，不删 `start_ord` / `end_ord`：

```ts
{ start_date: string, end_date: string, start_ord: number | null, end_ord: number | null }
```

`invalid_check_window` 只留给真正的坏数据：日期串非法（格式不对或日期不存在）、起止颠倒。未知包仍是 `unknown_check_window_package`，不并进前一个码。

**not_before 的 B5 守卫不动。** 锚点 null 时约束仍然跳过抬升，不改成「序数 null 的约束」。约束是计划输入，没有坐标就还不生效；检查窗口是证据，没有坐标也要留下来。两套半边不要再并成一句「与 B5 同一原则」。

### 17.4 minor：cancelled 在分组前退出（业主点名，不是自动跟审）

`detectCoordinationConflicts` 在把条目放进潜在窗口或已确认占用之前，排除 `status === 'cancelled'`。已取消的预约不进 `conflicts`，也不进 `potential`。取消即解除占用。

- cancelled + pending、同角色 onsite：两边都空。单条 pending 不成重叠；cancelled 不算另一条潜在窗口。
- cancelled + cancelled：空。
- pending + pending：`potential` 照 §16 的分级照实，本轮不改这一档。

### 17.5 轮次预算

- 本主题（检查日期 ↔ 锚点/预测，链见 §16.1 与 §17.1）的 Codex `REQUEST_CHANGES`，本轮是 **第 4 轮**。
- 本轮代码是业主指示修复（裁定「A」：无锚点半边模型），不是第 4 次自动跟审。
- 若 Codex **五审仍咬该链**——症状换行、再要求无锚点就抛、再把检查日期钉回 forecast，或钉回 ordinals 地平线——升级给人，**不再自动改**。

### 17.6 本轮落点，以及被推翻、但前文尚未改写的旧句

**本轮改的文件**：`shared/schedule-projection.ts`、`tests/server/schedule-projection.test.ts`、本节。**不改** `shared/schedule-state.ts`（loader 由下一棒接线）。

模块不再抛之后，loader 还按旧契约等这个错误，这是预期断点，不是兼容层：

- `shared/schedule-state.ts:46-48` 写着锚点未定且有检查窗口时模块抛 `invalid_check_window`，错误串带 `[invalid_check_window]`。
- `tests/server/schedule-loader-contract.test.ts` 的「B4/B3：锚点未定 + 检查记录窗口」断言该串出现，且 `scheduleProjection === null`。模块改为成功返回后，这条会红。
- 快照装配（`shared/schedule-state.ts:1711-1715`）把 `start_ord` / `end_ord` 填进 `{first_ord, last_ord}`，类型是 `number`。序数改为 `number | null` 之后，这里对不齐，下一棒决定 null 序数在快照里怎么交付。本轮不留「无锚点仍抛」来维持旧类型。

**被推翻的旧句**（留在原节，执行以本节为准）：

| 位置 | 被推翻的原文口径 | 为何可推翻 |
|---|---|---|
| §14.4「锚点为 null 的边界」 | 「actual 窗口直接判 `invalid_actual_window`（与 B5 同一原则：不把 1970 序数交付给消费者）」 | B5 只禁止把 1970 序数交出去。不造序数的办法是序数标 null，不是把证据判非法。三审已把码改名为 `invalid_check_window`，行为没改；本轮改行为 |
| 模块头注（修复前 `shared/schedule-projection.ts:40-43`） | 「带真实日期的 check_windows 直接判 `invalid_check_window`」 | 同上。头注随本轮代码改写；§14.4 的当轮原文留作历史 |
| loader 头注 `shared/schedule-state.ts:46-48` | 锚点未定 + 检查窗口 → `[invalid_check_window]` → 503 | 模块不再抛。下一棒删这句并改快照，不要再按它接线 |
| §2.2 公式与交付键 | 检查记录窗口 = `[first_ord, last_ord]`，快照只有序数；投影总是把日期映射成 ord 并扩展 ordinals 地平线 | 无锚点时没有可映射的序数。窗口改为带 `first_date` / `last_date` 与可空序数：日期原样保留，序数为 null（待定）。null 不是 0，也不是 1970 名义纪元序数。锚点就绪后的映射与地平线扩展保留。不进 forecast |
| §6.1 快照类型行 | `check_window: { first_ord: number, last_ord: number }` 或 null | 同上。删掉的是「序数必有、没有日期」的形状，不是 `check_window` 这个键 |
| loader 测试「锚点未定 + 检查记录窗口」 | 断言 `projection_failed — [invalid_check_window]` 且 `scheduleProjection === null` | **被推翻的旧口径是「无锚点即抛」。** 该场景改为 errors 为空、快照带日期且序数 null。`invalid_check_window` 改钉非法日期串（格式不对或日期不存在），不再钉缺锚点 |

删掉的是「无锚点 = 检查窗口非法」。检查窗口本身、B3 的序数映射、B5 对约束的跳过、§16 剪掉的 forecast 消费，都还在。

### 17.7 loader 接线（本棒，2026-11-11）

§17.6 写下时 loader 还按旧契约等 `invalid_check_window`，那是预期断点。本棒把断点接上。上一节表格的后三行就是这次要推翻的旧口径；**§2.2 / §3 / §6.1 / §10 已按那些行改写，不再是「尚未改写」。** §14 / §15 / §16 与 §17.1–§17.6 的当轮原文留作历史，不回改。

**本棒改的文件**：`shared/schedule-state.ts`、`tests/server/schedule-loader-contract.test.ts`、本节所改的 §2.2 / §3 / §6.1 / §10 / §17.6 表。不改 `shared/schedule-projection.ts`，不改 `schedule/phase-1/control.yaml`。

**快照**：`check_window` 从模块返回值映射 `{first_date, last_date, first_ord, last_ord}`。入参仍是 `check_windows: {start_date, end_date}`。`first_ord` / `last_ord` 原样透传——null 保持 null，不写成 0，也不写成名义纪元序数。

**`invalid_check_window` 的钉法**：触发条件从「无锚点」改成非法日期串（模块：格式不对或日期不存在；起止颠倒仍是同一个码）。loader **不把**审计记录里的非法 `checked_at` 送进 `check_windows`。送进去会让 `projectSchedule` 抛错、整份投影变 null，单包坏日期打掉全部包的排程——这是 B3 已经否决的（`check_window_invalid_checked_at` / `check_window_unresolved` 在送进模块之前拦住，投影继续，route 仍因 `state.errors` 非空而 503）。因此 `projection_failed — [invalid_check_window]` 不会从「审计里有一条坏日期」这条路上出现。码本身由 loader 契约测试直接把非法日期串交给模块来钉，锚点有没有都抛。loader 对 `ProjectionError.code` 的原样透传仍由 B4 的 `work_calendar_empty` / `calendar_date_conflict` 钉住。

**删了什么**（正文改写，按「必须 diff 出删了什么」）：

| 位置 | 删掉的句子 | 理由 |
|---|---|---|
| §2.2 公式 | `PKG 检查记录窗口 = [first_ord, last_ord]（…经 work_calendar 映射后的首末工作日）` | 无锚点时映射不出序数。日期才是始终在的事实。锚点就绪时的映射留在新公式的序数行 |
| §2.2 交付键 | 快照只有 `{first_ord, last_ord}`；「投影把它映射成 ord，作为证据字段返回，并参与 ordinals 地平线扩展」写成无条件 | 地平线扩展只在锚点就绪时发生。无锚点时序数 null、不扩展地平线。键名 `check_window` 未改 |
| §6.1 类型行 | `check_window: { first_ord: number, last_ord: number }` 或 null | 与快照实现不一致就会让本文和代码各说各的。改成带日期、序数可空 |
| §10 一条测试计划 | gate passed 只写「= 映射的 ord」，没有无锚点形态 | 补上「锚点未定 → 日期保留、序数 null、不因此报 invalid_check_window」。原来的空 audit / 部分通过 / waived / 同日 / supersedes 都还在 |
| §3 | 无删句。上一版只说了锚点前的 0 / 负 ord，没说锚点缺失时序数待定 | 加了一段，不改「未知保持未知，不造年月日」 |

coordination 仍不进入门禁 / 就绪。本棒没有把 `coordination` 读进 `gateStatus` 或 `effectiveReadiness`。

---

## 18. 无锚点投影虚构日期（第 5 轮，业主点名 major）

> **审查事件**：Codex 对提交 `1ab10a9c58a2454f190f604ebb51d6426e6a1ff5` 的 review（2026-11-11T10:17:55Z，`PRR_kwDOTV2tGM8AAAABXR1stQ`）：blocking 0 · major 1 · minor 0 · nit 0，事件是 `COMMENT`。
> **本轮不是自动跟审。** 没有 blocking，本来不触发自动修复；改代码是因为业主在对话里点名修这条 major（`.github/prompts/codex-fix.md`：「业主在对话里点名要修的 `major` / `minor` / `nit`，按业主的要求做。那不是自动跟审」）。
> **本节只追加，不改写 §1–§17。** 决策记录与代码改动同一次落地（工作树里先有模块改动，本节随后补齐记账，不假装「先写决策再动代码」）。
> **major 原文（要点照录）**：「**无锚点的共享投影仍返回虚构年月日** `shared/schedule-projection.ts`」——第 801–804 行无条件调用 `cursor.dateOf(ord)`，`anchor_date` 为 null 时投影仍返回 1970-01-01 等名义日期；目前只有 `schedule-state` 的快照装配层把日期清空。共享模块返回类型又未携带锚点状态，后续消费者（what-if 等）无法仅凭返回值区分真实日期与占位日期，容易把它当计划日期交付。**处方**：在投影输出边界统一返回 `date: null`，并调整目前断言 1970 日期的测试。

### 18.1 轮次总账：同一条链的五轮

对象五轮没换过：**无锚点时的日期坐标**。换过的是补在同一条链五处边上的补丁（约束边 §14 → 命名边 §15 → 预测边 §16 → 抛错边 §17 → 输出边 §18）。

```
约束边（§14/B5）→ 抛错边（§17）→ 输出边（§18）
证据边（§16 剪预测消费、§17 保留日期标 null 序数）在这条链之外，本轮不碰
```

| 轮 | 审查与修复提交 | 这一轮补的边 | 修了什么 | 没动的根因 |
|---|---|---|---|---|
| 一审（§14，审 `43b4487`，修复 `4a568b9e`） | B5 约束日期被算进 1970 名义纪元 | 约束边 | `anchor_date === null` 时 resolved 的 `not_before` 不调用 `ordForDate`、不抬升；loader 报 `constraint_resolved_without_anchor` | 名义纪元设备留在模块里，注释只写「不得映射真实日期」；同一提交还把 B5 扩成「无锚点 + 检查窗口 → 抛 `invalid_actual_window`」 |
| 二审（§15，审 `4a568b9`，修复 `9f474efb`） | F2「验收日期不能直接充当实际开工日期」 | 命名边 | 交付侧 `actual` → `check_window`，文案去掉「完工事实」；模块按当时纪律冻结 | 消费链与名义纪元都在。冻结使「无锚点即抛」原样留下 |
| 三审（§16，审 `9f474efb`，业主裁定 A，修复 `eed4dc5e`） | 「检查记录窗口仍被当作施工预测起止消费」 | 预测边 | forecast 改为与 baseline 同源；检查窗口只作证据层；错误码改名 `invalid_check_window` | 锚点边的抛错只换了名字，行为没改 |
| 四审（§17，审 `eed4dc5e`，业主裁定 A，修复 `1ab10a9c`） | 「合法检查记录不应强制要求已确定开工锚点」 | 抛错边 | 删掉无锚点抛错；检查窗口日期保留、序数 null（§17.3） | `ordinals` 的 date 仍由 `cursor.dateOf` 在名义纪元上算出，「置 null 由 loader 负责」——§17.6 的反推表没有列这一句 |
| **五审（本节，审 `1ab10a9c`，业主点名 major）** | 「无锚点的共享投影仍返回虚构年月日」 | **输出边** | `ordinals` 在模块边界统一 `date: null`；名义纪元设备整体退役；测例从钉 1970 改为钉 null | 无锚点时的计划语义（序数仍是坐标）保留；loader 侧清空成为冗余的第二道（下一棒可删） |

五轮补的是同一个缺口的不同边：模块内部需要一个「无锚点时 ord↔date 映射仍然存在」的占位设备，而它造出来的值是可以越过模块边界被读到的返回值。§17 把「拒绝交付证据」改回「交付证据、序数待定」，只要占位设备还在生产端，同一族失真就会在第五条消费路径上再出现一次——五审点名的正是这个生产端。

### 18.2 关键区分：两条边上的日期不是一回事

| | `ordinals[].date`（本节改） | `check_window.start_date` / `end_date`（§17 成果，不碰） |
|---|---|---|
| 它是什么 | 排程轴产物：`ord ↔ date` 映射表的日期列 | `audit_log.checked_at` 事实：检查登记日，原样保留 |
| 无锚点时 | **未知**：没有锚点就没有日期轴，每项 `date: null` | **保留真实日期**（§17.3 第 1 条）；序数 `null` |
| 锚点就绪时 | 真实日期（`ord ≤ 0` 为锚点前工作日，§14/B3） | 同一张日历映射出 `start_ord` / `end_ord` |
| 数据来源 | `createCalendarCursor` 的 `dateOf` | 模块入参（loader 从审计派生） |
| 交付位置 | 快照 `schedule.ordinals` | 快照 `schedule.packages[].check_window` |

一句话：**排程轴上的日期无锚点即未知，检查登记日无锚点也还是事实。** §17 保住的是后者，本节删掉的是前者的编造值。两条边不要并成一句「无锚点就置 null」——这句话对前者是修复，对后者是删证据。

### 18.3 本轮修复口径（模块输出边界，唯一一处）

1. **名义纪元设备整体退役。** `NOMINAL_EPOCH` 常量与 `calendar.anchor_date ?? NOMINAL_EPOCH` 一并删除（`shared/schedule-projection.ts`）。模块里没有任何其他消费者需要它，也没有「内部确定性」用途要保留它——确定性由 `ordinals` 的**序号**保证：`minOrd..maxOrd` 连续、前向传播是纯函数、同输入必得同输出。日期无锚点即未知。
2. **`ordinals` 在输出边界统一 null。** 无锚点时装配 `{ord, date: null}`（序号仍由前向传播决定，不调用 `dateOf`）；锚点就绪时照常 `cursor.ensure(maxOrd)` 后逐项 `cursor.dateOf(ord)` 出真实日期（现有行为不回归）。类型 `Array<{ord: number, date: string | null}>` 本来就是可空的，未改——改的是值，不是形状。
3. **结构校验与日期映射分开。** `createCalendarCursor` 的结构校验在无锚点时照常先跑完，顺序不变：非法星期 `invalid_calendar`、同日双声明 `calendar_date_conflict`、空历 `work_calendar_empty`、`rest_dates` / `extra_workdates` 的 `invalid_date`。校验之后，无锚点的游标没有纪元可展，`dateOf` / `ordForDate` 改为 fail-closed 抛 `internal_order_error`（沿用模块既有的内部不变量错误码，不新增对外错误面）。这是保险丝，不是可达路径：`projectSchedule` 的三处调用（检查窗口映射、约束抬升、`ordinals` 装配）都已按 `anchorReady` 分流，无锚点时一次都不调用。将来新增第四条调用而忘了锚点判断，会当场失败，而不是把编造日期交出去。
4. **不碰的两件事。** ① 检查窗口：日期保留、序数 null、不抛错、不进 baseline/forecast、不扩展 `ordinals` 地平线——§17.3 四条一字不动。② `not_before` 的 B5 守卫：无锚点仍跳过抬升，不改成「序数 null 的约束」（§17.3 末段：约束是计划输入，没有坐标就还不生效）。
5. **测试口径。** 断言 1970 名义纪元日期的用例改钉 `date: null`，保留序号连续与「同输入必得同输出」的确定性断言；新增对照用例「锚点就绪 → 同一工期给出真实日期」。检查窗口的用例（日期保留、序数 null、地平线不扩）原样保留。

**只改三个文件**：`shared/schedule-projection.ts`、`tests/server/schedule-projection.test.ts`、本节。**不改** `shared/schedule-state.ts`（loader 由下一棒接线；接线已落地，见 §18.6）。

### 18.4 被推翻、但前文尚未改写的旧句（§16.6 式表格加行）

| 位置 | 被推翻的原文口径 | 为何可推翻 |
|---|---|---|
| 模块常量（修复前 `shared/schedule-projection.ts:68-75`） | 「无锚点时的名义纪元（1970-01-01，周四）。只用于『没有锚点时的 ord→date 占位表』，让 ordinals 的形状保持确定性」 | 「确定性」是序号的性质，不是日期的性质：`ord` 连续、前向传播纯函数已经保证同输入同输出。占位日期一旦越过模块边界就是看着像真的年月日，而返回值不带锚点状态，消费者无法区分 |
| 模块头注（修复前 `:72-73`） | 「UI 不得把名义纪元的日期显示给用户……`ordinals` 的 date 置 null 由 loader 负责」 | 「由 loader 负责」把边界纪律寄存在单一消费方身上：第二条消费路径（what-if 等）要第二次记得清空。清空必须发生在生产处，即本模块输出边界 |
| 模块头注（修复前 `:200-201`） | 「从纪元（anchor_date，缺省名义纪元）起逐日推进，只数工作日，ord 从 1 连续编号」 | 无锚点时没有「纪元」可起。无锚点不再生成 ord→date 映射表（结构校验照做）；映射表只在锚点就绪时存在 |
| 模块内注释（修复前 `:799-804`） | 「anchor_date 为空时也照样算出 date（名义纪元占位），置 null 由 loader 负责」 | 同第二行。这行正是五审 major 点名的代码位置 |
| 模块头注（修复前 `:46`）与 §14.6 末句 | 「名义纪元不得用来映射任何约束日期」／「名义纪元只用于『无真实日期输入的 ord↔date 占位』，**不得**用于映射任何真实日期」 | 这两句把「无锚点占位」当作合法设备，只限制它不碰真实日期。§18 退役整个设备：不给排程轴造替身日期。这不是放宽 B5——B5 的约束边行为一字未动（§18.3 第 4 条） |
| §4 算法第 2 条 | 「工作历展开：从零点（或 `anchor_date`）逐日推进，按 `workdays`/`rest_dates`/`extra_workdates` 生成 ord→date 映射表」 | 无锚点时那个「零点」就是名义纪元。无锚点不再展开日期轴，只校验日历结构；映射表只在锚点就绪时生成（§18.3 第 2、3 条） |
| loader `shared/schedule-state.ts:1750-1754` | 「无锚点时 UI 契约『未知保持未知，不造年月日』：date 全 null，ord 照常」＋ `declared.anchor_date === null ? null : entry.date` | 模块输出边界已经保证同一件事，这一层清空成为冗余的第二道。当前结果不变（两处同时清空，值相同），但不要再按「模块会给出纪元日期」接线；下一棒可删。**本轮不动 loader** |
| 模块无锚点分支（修复前经名义纪元展开日历，`cursor.ensure` 调用点） | 无锚点时也会沿名义纪元展开日历：`workdays: []` + 两个相隔两月的 `extra_workdates` + 工期 3 → 抛 `work_calendar_exhausted`（loader 记 errors → API 503） | 不再造日期轴后，无锚点连 ord 都不展开（ordinals 为 `[{n,null}…]`），这条保险丝**推迟**到锚点就绪后生效而非丢失——锚点就绪时同一输入照旧抛（§16 major 修复保留）。删除的失败路径须记账：修复前探针（before-root，`git show 1ab10a9c` 落地）实测抛「已扫描 20525 天只得到 2 个工作日，无法达到序数 3」；修复后同输入返回 `[[1,null],[2,null],[3,null]]`。属于「不再造排程轴」的正确后果，不是静默放宽 |

删掉的是「无锚点的 ord↔date 替身」。保留的：`ordinals` 的序号与确定性、锚点就绪时的真实日期、B3 的双向地平线（锚点前的 0 / 负 ord）、检查窗口的证据语义与 §17.3 四条、B5 的约束跳过。

### 18.5 轮次预算

- Codex 五审的事件是 `COMMENT`（blocking 0），按 `.github/prompts/codex-fix.md` 本不触发自动修复；本轮是业主点名修 major。§17.5 那句「若 Codex 五审仍咬该链就升级给人，不再自动改」针对的是**自动跟审路径**，本轮没有走那条路径。
- 同一主题（无锚点 ↔ 日期坐标，链见 §16.1 / §17.1 / §18.1）若六审仍咬——症状换行、再让模块输出纪元日期、或反向要求无锚点就抛/丢证据——仍按 §17.5 升级给人，不再自动改。

### 18.6 loader 装配层清空退场（本棒接线，2026-11-11）

§18.4 表末行「loader 侧清空成为冗余的第二道（下一棒可删）」在本棒执行。

**本棒改的文件**：`shared/schedule-state.ts`、本节所改的 §2.2 / §3 / §6.1。不改 `shared/schedule-projection.ts`（上一棒已完成），不改 `schedule/phase-1/control.yaml`，不改测试。

**删了什么**（按「必须 diff 出删了什么」）：

| 位置 | 删掉的代码 / 句子 | 理由 |
|---|---|---|
| loader `shared/schedule-state.ts`（§18.4 记为 :1750-1754） | `ordinals: projection.ordinals.map((entry) => ({ord: entry.ord, date: declared.anchor_date === null ? null : entry.date}))` | 模块输出边界已保证无锚点时 `date: null`（§18.3 第 2 条），这一层清空是冗余的第二道，且会让读者以为「模块会给出纪元日期、由 loader 兜住」。改为 `ordinals: projection.ordinals` 原样透传并改写注释 |
| §2.2「无锚点」条、§3 序数段、§6.1 类型注释 | 按 `anchor_date` 清空发生在装配层的口径（§6.1 只写「anchor 未定则 date 全 null」，未点名保证在哪一层） | 同步为「保证在模块输出边界（§18），装配层不清空」；无锚点 = date null 的结论不变 |

**没动的**：§18.3 四条（检查窗口日期保留、B5 跳过抬升、结构校验、fail-closed 游标）一字未动；`check_window` 在快照边界的四键映射未动；`ord` 序号、锚点就绪时的真实日期、§14/B3 的双向地平线未动。

**快照行为不变**：无锚点时模块已给 `date: null`，删掉清空后 `schedule.ordinals` 输出逐字节相同；锚点就绪时两条路径都透传真实日期。这是删冗余，不是行为变更——既有断言（`api.test.ts` / `control-contract-validation.test.ts` 快照断言、`schedule-loader-contract.test.ts` 的 §17 用例）应天然通过；若红说明行为变了，先停下查。

**消费者核对**（全仓 grep，本棒）：

- `shared/schedule-projection.ts` 的生产进口只有 `shared/schedule-state.ts` 一处（load 期投影 + 快照装配）。
- `app/src` 的 `GanttPanel` 是 `schedule.ordinals` 的第一个消费者（2026-11-11 issue #202 S2），
  只读渲染、不改写数组（单测钉住渲染与点击前后逐字节不变）；what-if 路由已落地
  （`server/routes.ts` 的 `GET /schedule/what-if`，设计 §6.2），复用 loader 装配好的
  `scheduleProjectionInput` 重跑 `projectSchedule`，不碰 ordinals 的二次清空。
  `server/` 只有 `routes.ts` 的 `/schedule/state` 直出 `buildScheduleSnapshot` 结果，不触碰 ordinals。
- 其余引用都在测试里（`schedule-projection.test.ts` 直接 import 模块断言；`schedule-loader-contract.test.ts` 经 loader 快照断言 `date: null`），不依赖 loader 清空。
- 结论：删除后没有任何消费者会拿到「原本被 loader 清成 null、现在变成非 null」的值。

### 18.7 五审复审的 low 工作项登记（2026-11-11 补记）

五审针对性复审共 4 条 low。第 2 条（被删错误面未记账）已补入 §18.4 表，其余三条此前的唯一记录是 workflow 运行报告——按「无 owner 的技术意见等于没写」的纪律，登记于此。全部为 low，无 blocking。

| # | 位置 | 问题与证据（复审员探针） | 严重度 | 处置与触发条件 |
|---|---|---|---|---|
| L1 | `shared/schedule-projection.ts` 无锚点游标存根内 `ensure()`（对照 `dateOf` :275-277 / `ordForDate` :278-280 抛 `internal_order_error`） | 三个游标方法口径不对称：`ensure` 是静默 no-op。今天不可达（唯一 `cursor.ensure` 调用点在 anchorReady 分支内，复审员逐点枚举 722/723、750、824、827 全部有守卫），但将来新增第四条调用点若只写 `cursor.ensure(n)`（以为「保证展开」）会得到静默成功而非当场失败，§18.3 第 3 条「忘了锚点判断会当场失败」对 ensure 这一条不成立 | low | **S2 已收（2026-11-11）**：存根 `ensure` 改为与另两个方法一致抛 `internal_order_error`，模块单测直接钉住三方法 fail-closed；`CalendarCursor` / `createCalendarCursor` 加 `@internal` 标注（测试专用导出，生产调用点仍只有 projectSchedule 一处）。owner：S2 实施者；触发：S2 任务书开工 |
| L2 | `shared/schedule-state.ts` 快照 `ordinals` 透传（删掉二次 `.map` 的后果，探针 `ordinals_same_object_reference` 修复前 false → 修复后 true） | 快照数组与 `state.scheduleProjection.ordinals` 是同一对象，消费者若原地改快照会改到 loader 保留态。S2 起 `app/src/ui/GanttPanel.ts` 是第一个 ordinals 消费者，但它只读渲染（单测钉住渲染+点击前后逐字节不变），`server/`/`scripts/` 仍不直接改写；`baseline`/`forecast` 等键本来就走引用透传，属既有风格 | low | **记录即可，S2 已复核无动作**：甘特面板只读快照不改写；若未来任何消费方要 mutate 快照 ordinals，先在快照侧 copy。owner：S2 实施者复核；触发：S2 出现第一个 ordinals 消费方 |
| L3 | `tests/server/schedule-loader-contract.test.ts`（loader 删掉的那行冗余无测试可区分） | 旧 masking 与新透传在无锚点时同值，loader 单测对「删没删」不敏感——「这是死代码」只由复审员探针的逐字节对比支撑，不是测试支撑。端到端行为仍被一条断言钉住（anchor null 时 `ord3.date===null`），模块改错时会红；反向变异实验：把模块测试换成 1ab10a9c 版本得 53 pass / 4 fail，证明模块侧咬得住，loader 侧造不出红 | low | **不修，覆盖说明**：该删除的正确性由「快照输出前后逐字节一致」的探针 + 端到端断言共同保证，无需为一行死代码造专属测试。owner：无需（记录在案） |

### 18.8 轮次预算后的状态（六审收口）

- Codex 六审（审查提交 `1497bac1`，事件 `COMMENT`）：**blocking 0 · major 0 · minor 0 · nit 0，「没有发现项」**。一审至六审在同一条链上提出的全部 finding 处理完毕。
- PR #216 于 2026-11-11 合并入 master（`e54abc56`），master CI 六项门禁全绿。
- 本设计文档的角色至此从「施工中的验证台账」转为「切片 A 的定稿设计 + 审查全账」；S2 及以后的轮次记账在新切片续写（§19 起），本节不改写。

---

## 19. S2 甘特切片落地（2026-11-11）

- **交付**（工作树 `ep-202-gantt`，分支 `arch/202-gantt`；实施四路 + 集成 + 独立评审跑 `magpie/auto/deepseek-v4.1-flash`，主会话仲裁）：`GanttPanel`（705 行——区间条 min/max、无锚点只标「第 N 工作日」、点条只写 selection 不碰 3D/scope（D5）、what-if 控件带「演算视图，非计划」水印、≤700px 退化为 ordinals 相对条不建日期轴）+ 路由 tab `gantt`（`SUB_PAGES` / `showApprovalView` / 命令面板 / view-state 白名单四处同步，`roles`/`calendar` 留 S3 不进枚举）+ `GET /api/schedule/what-if`（复用 loader 装配好的 `scheduleProjectionInput` 重跑 `projectSchedule`，无第二套装配；`MAX_SCENARIO_DELAY_WORKDAYS` = 3650 防排程轴无界展开；只有请求类 ProjectionError 回 400，内部不变量错误走 503）。
- **§18.7 L1 已收**：无锚点游标存根 `ensure` 改为与 `dateOf` / `ordForDate` 同为 fail-closed（`internal_order_error`），模块单测钉住三方法；`CalendarCursor` / `createCalendarCursor` 为测试专用导出（`@internal`，生产调用点仍只有 `projectSchedule` 一处）。
- **§18.7 L2 已复核无动作**：`GanttPanel` 是 `schedule.ordinals` 的第一个消费方，只读渲染，单测钉住渲染 + 点击前后逐字节不变；未来消费方要 mutate 时先在快照侧 copy。
- **本文档同步**（只改口径、不删证据；被替换的旧句：§4 第 5 条 affected 的 `{pkg, baseline, forecast, delta}` 形状、§6.2 的「未知包/非正整数 → 400」与 scenario 恒为对象、§7 的 App.ts 三处行号与 `gantt|roles|calendar` 一次枚举、§7 移动端「序数条」未定义形态、§18.6「app/src 零命中 ordinals」、§18.7 L1/L2 两行的待办状态）——逐条换成当前实现口径，无候选、证据或淘汰理由被删。
- **门禁**（工作树实测判定行）：ci:typecheck 0/0 通过；ci:test-app 892 测 3 失败全在 `ci/baseline/`（HouseScene 存量）；ci:verify-all 22/23，verify-mep 存量在基线内；build:app 通过。
- **已知未收**（独立评审 15 条：2 条 medium 已在本片修掉——delay 上限与演算视图来源行；余 13 条 low 登记在 PR 描述待业主裁）：测试缺口（真实路由响应 → 面板渲染的集成测试、无锚点 + 检查记录时的日期展示口径）、`scheduleProjectionInput` 必填 vs 可选、窄屏图例与内容一致性、重复 delay 包在模块层的求和语义等。
- **S3 前提**：切片 B/C 的角色工作台与协调日历按 §7 现文接线；`#approval=` 枚举到 S3 才补 `roles|calendar`。

---

## 20. S3 角色工作台与协调日历（2026-11-11）

- **交付**（工作树 `ep-202-roles-calendar`，分支 `arch/202-roles-calendar`，基 `origin/master` `d239acb8`；两路并行实施 + 集成门禁 + 主会话仲裁）：`RoleWorkbenchPanel`（762 行 + 663 行测试，20 测——按角色分组三节、待办检查只列未完成、冲突两级徽标、点项只写 selection、三态空文案、转义、窄屏单列、只读快照逐字节钉）+ `CoordinationCalendarPanel`（612 行 + 578 行测试，16 测——三类 mode chip、chip 按 forecast 潜在窗口定位、无锚点无日期字符串、`site_pending` 标「待定」、confirmed 登记日证据文字、cancelled 不画 chip、窄屏文字行、只读钉）+ 路由 `roles`/`calendar` 补全（`SUB_PAGES` / `showApprovalView` / 命令面板 / view-state 白名单 / `index.html` tab 五处同步，七个审批面板）+ control.yaml coordination 试点 4 → 9 条。
- **冲突两级口径的落点（本片关键决定）**：§4 第 6 条的 `detectCoordinationConflicts` 至今无活消费方；面板铁律禁止 import 排程投影模块、S3 范围不含 loader 改动，因此面板按 §16.4/§17.4 同一两级口径做**展示分类**（数据全部来自快照键）：冲突 = 同角色 onsite 都已确认且 `confirmed_at` 同日；潜在 = 同角色 onsite 未确认且 forecast 窗口闭区间重叠（连通分量）；`cancelled` 与 non-onsite 分组前排除；confirmed + 未确认混合两者都不出。**已知张力（留业主裁）**：模块函数与面板分类是同一口径的两处实现；若要求单一来源，后续切片应由 loader 调用模块函数、把报告加进快照，面板改纯渲染。→ 已由 §22 收口（loader 单一来源、面板改纯渲染，2026-11-12）。
- **coordination 缺失/为空的降级口径**：不置空整面板——待办检查只依赖 `packages` 照常渲染，协调两节出节级空文案（子代理初版按整面板空态实现，集成时按「不渲染空列表 ≠ 删掉有用的分组」修正）。
- **试点数据 4 → 9 条**（S1 已有 SCH-000-01 / SCH-000-02 / SCH-005-01 / SCH-070-01 四条；本片新增五条，仍只挂主车道包，「确有协调动作」标准，不 backfill 49 条）：

  | SCH | mode | required_roles | 依据（检查正文） |
  |---|---|---|---|
  | SCH-010-02 | onsite | 业主、设计师、施工方 | pass_condition「业主、设计师和施工方完成现场交底签认」 |
  | SCH-030-04 | onsite | 业主、设计师、空调商、水电施工 | method「逐项核对并四方签认」 |
  | SCH-040-03 | onsite | 业主、设计师、空调商、橱柜供应商 | method「联合交底签认记录、橱柜深化图与点位表双向核对结论」 |
  | SCH-080-01 | remote | 业主、设计师 | method 的现场观察由设计师/涂装施工完成，pass_condition「经业主确认」不必到场 |
  | SCH-090-01 | notify | 业主、物业、燃气单位 | method「核对燃气单位或物业的书面要求」——外部方以书面要求参与 |

  九条全 `pending_invite` / `actor` null / `confirmed_at` null（尚未交房、无人可确认是诚实态，不造确认人）。真实数据冲突报告（模块层实测）：`conflicts` 0；潜在 4 簇——业主 7 条、设计师 6 条、施工方 3 条、空调商 3 条。SCH-070-01 因 PKG-040 窗口（26–55）桥接进入潜在簇（4 条数据时它接不上 PKG-005 的 16–32，`schedule-projection.test.ts` 里「SCH-070-01 不进任何潜在簇」「空调商不进潜在」两条旧断言随数据扩充反转）；SCH-080-01（remote）/SCH-090-01（notify）分组前退出，不进任何簇。
- **测试**：工作台 20 测 + 日历 16 测（清单见上）；`approval-route.test.ts` 补 `roles`/`calendar` 解析与序列化往返；`view-state-store.test.ts` 白名单反转（S2 的「roles 不放行」断言改放行 + nonsense 仍忽略）；`schedule-projection.test.ts` 真实试点数据用例同步到 9 条（每个窗口/簇经主会话独立复算核对）。
- **门禁**（工作树实测判定行，六项全部 exit 0）：`ci:typecheck` 实际失败 0 条、基线 0 条——无基线外新失败，对照通过；`ci:test-server` 实际失败 0 条、基线 0 条——无基线外新失败，对照通过；`ci:test-app` 实际失败 3 条、基线 3 条（存量为 `ci/baseline/` 的 HouseScene）——无基线外新失败，对照通过；`ci:verify-all` 实际失败 1 条、基线 1 条（存量 verify-mep）——无基线外新失败，对照通过；`npm run schedule:render` exit 0（stdout 仅既有两条边界自动反向提示：「Room kitchen boundary was CW, auto-reversed to CCW」「Room entry_garden boundary was CW, auto-reversed to CCW」）；`build:app` exit 0（仅 Rollup 提示：`manualChunks` 分块建议与 `chunkSizeWarningLimit`）。`schedule:render` 重生成 7 个渲染文件（schedule/checklist.md、phase-1/{budget,checklist,cost,schedule}.md、phase-2/checklist.md、phase-3/checklist.md）diff **仅指纹行**（control.yaml 输入哈希 + 项目数据指纹），无内容行变化；连带 `docs:generate-current-values` 重生成（`docs/CURRENT-VALUES.md` 仅指纹一行——control.yaml 进其输入指纹，不跑则 `verify-current-values` 报基线外新失败）。
- **已知未收**：① 模块 `detectCoordinationConflicts` 无活消费方，面板侧展示分类与之并存（见上，留业主裁）；② 日历「确认占用日」标记只在锚点就绪时画（无锚点不钉列是 §17/§18 口径）；③ 两个面板行数超设计估值（762/612 vs ~400——`RoleWorkbenchPanel` 含 Codex 一审 blocking 修复后的行数；注释密度照 `GanttPanel` 776 行先例，未为压行数删口径注释）；④ 工作台每节 8 条上限 + `title` 全量，无分页；⑤ 无「真实路由响应 → 面板渲染」集成测试（S2 同款缺口）。（**2026-11-12 状态更新**：① 与 ④ 已由 §22 收口——① 改 loader 单一来源、面板纯渲染；④ 每节「查看全部 N 条」展开入口；②③ 仍开；⑤ 已收（2026-11-12：`tests/server/schedule-panel-integration.test.ts`——真实路由响应喂进真实面板，见 §23）。口径修正的落点是本节 + §22：`audit_log.record_schema` 的 required 是验收记录字段（`checked_at`/`check_spec_sha256` 等），不作为修正记录落点。）
- **Codex 审查**（PR #220）：一审 `b8f4d394` **blocking 1**——现场占用把 `owner_role`（协调组织者）误算为必须到场，与模块 `detectCoordinationConflicts` 的 `required_roles` 口径漂移 → 修（`6e0fd010`：占用口径改 `participatesIn` 只认 `required_roles`，待确认列表保留「required_roles ∪ owner_role」，新增钉死用例 20 测）。二审 `6e0fd010` **blocking 0 · major 1 · minor 2**（事件 COMMENTED，按修复端纪律不自动修，登记待业主裁）：major「工作台截断后没有访问剩余条目的入口」（每节前 8 行 + `title` 全量，无展开/分页/跳转；多个角色检查数已超 8，触屏端无法可靠读 title）；minor「`tickOrds` 末端刻度间距检查用了倒数第二个索引」（1–26 时末端 25/26 相距 44px < 72px 最小间距，末端标签可重叠）；minor「ordinals 未命中 `confirmed_at` 时误标『不在工作日历内』」（ordinals 是有限投影范围不是完整工作日历，应按「未知保持未知」改为「日期不在当前投影范围，无法定位」）。
- **S4 前提**：切片 B/C 的联合验收试点可引用本片两个面板；Issue 关闭标准第 2 条（最小真实工作流跑通）仍待 S4 对账。

---

## 21. S4 收尾对账（2026-11-12）

> **证据口径**：本节数字全部来自**只读运行**——`loadScheduleState` + `buildScheduleSnapshot`
> 读真实 `control.yaml`，以及 `projectSchedule` 的只读演算（脚本落在 `tmp/`，过程物不进 git）；
> 测试条目是仓库内既有用例。**未写入任何施工/协调/验收事实**：`audit_log.records` 为空、
> 9 条协调全 `pending_invite`、`anchor_date: null` 都是「尚未交房」的诚实态。

### 21.1 关闭标准逐条对账

| # | 标准 | 判定 | 证据（只读实测 / 结构） |
|---|---|---|---|
| 1 | 可评审的设计记录（对象关系/事实归属/状态机边界/排程规则 + 四外部项目取舍） | ✅ | §1 缺口矩阵、§2 事实归属、§5 状态机边界、§8 四项目「复用/参考/不采用」 |
| 2 | 最小真实工作流跑通，覆盖 PKG-000 与 PKG-070 | ⏳ 结构就绪，实跑待交房 | 六腿逐条见 §21.2 第 1/3/4 条与 §21.3 |
| 3 | 同一 PKG/SCH 四视图状态一致，无第二权威源 | ✅ | 看板/甘特/工作台/日历/详情共吃 `GET /api/schedule/state` 一个快照；门禁与就绪仍单实现于 `shared/schedule-state.ts`；新增两键是纯增量（`schedule` / `coordination`），旧字段一个不动（api.test.ts:287） |
| 4 | 基线/预测可区分、未知保持未知、协调≠验收、审批走既有授权 | ✅ | `anchor_date: null` → 130 个 ordinals 全 `date: null`；`check_window` 非 null 0/24；协调 `actor.name` 非空 0/9；`PKG-040 +3` 演算：`baseline` 逐包不变、`check_window` 逐包不变（§21.2 第 4 条）；协调不进 `gateStatus`/`effectiveReadiness`（facts 契约 `c.coordination_not_gate_input`，`verify:all` 覆盖） |
| 5 | 测试可重复、既有校验不回退、无假进度/假日期/自动放行 | ✅ | 各片门禁判定行（§19/§20 与本轮 §21.2 第 7 条）；新增只读断言（`api.test.ts:303` POST 一律 404） |

### 21.2 切片 C 回归清单对账（Issue 原文 7 项）

| # | 要求 | 现状 | 证据 |
|---|---|---|---|
| 1 | 交房前 PKG-000：`SCH-000-PRE-01/02` 在工程 blocked 时仍可推进；不生成虚假交房日期 | ✅ | `SCH-000-PRE-01/02`：`can_run_while_blocked: true`、审计未登记、无 open gate；`PKG-000` `effective_readiness: blocked`、5 个未关闭阻塞；`anchor_date: null`（无年月日可用） |
| 2 | 并行施工：PKG-020 完成后 PKG-030/040 并行；PKG-070 须同时满足 030/040/050 | ✅ | 依赖实测：`PKG-030 dep=[PKG-020]`、`PKG-040 dep=[PKG-020]`（两者 `start_ord` 均 26 → 并行）；`PKG-050 dep=[PKG-040]`；`PKG-070 dep=[PKG-030,PKG-040,PKG-050]`（`start_ord` 37 → 汇合） |
| 3 | 联合验收协调：多角色参与、协调方、预约状态、缺席冲突、真实门禁；参与方式不得从 `owner_roles` 推定 | ✅ | `SCH-070-01`：`mode: onsite`、`required_roles = [业主,施工方,设计师,空调商]`、`owner_role: 业主`、`pending_invite`、`actor: null`——到场要求全部来自声明；缺席冲突两级口径见 `schedule-projection.test.ts` 的真实试点用例（潜在 4 簇：业主 7 / 设计师 6 / 施工方 3 / 空调商 3；`conflicts` 0）；施工门禁仍是 `GATE-070-CEILING-CLOSED` + 前置包验收，不被协调状态影响 |
| 4 | 延期传播：水电或空调延迟 3 个工作日按依赖与并行关系影响预测，不平移全部下游，保留基线 | ✅ | 只读演算 `PKG-040 +3`：`affected` 18 包（`PKG-050…PKG-170`），**并行支 `PKG-030` 不受影响**；forecast 仅点名包与下游变化；`baseline` 与 `check_window` 逐包不变。测试：`schedule-what-if.test.ts:179-181`（点名包起点不变、终点 +3）、`:135`（无 scenario 时 forecast 与 baseline 逐值相同） |
| 5 | 无日期/无演员/无报价：未知按未知展示；资源未绑定不阻碍抽象角色排程；不污染预算与施工事实 | ✅ | `anchor_date: null` → 130/130 ordinals `date: null`；协调 `actor.name` 非空 0/9（全部「待指定」）；未报价组件 89 个 → 进 `next_actions` 的 `quote_pending`（数量显形、金额不编）；`next_actions` 共 41 条 = `external_blocker` 14 / `quote_pending` 20 / `decision_gate` 7（**无 `ready_package`**——尚未交房，没有就绪包），含 `BLK-HANDOVER`（unblocks 1071）等 |
| 6 | 单测/集成：依赖环、缺失引用、休息日、时间窗冲突、已完成包不回退、审批验收不被 UI 绕过、派生可重算 | ✅（一处口径已按业主裁定更新） | 依赖环/自依赖/未知依赖：`schedule-projection.test.ts:71/76/88`；工作日历（`rest_dates` 优先、补班占 ord）：`:125`；约束（`not_before` 抬升、`site_pending`/`not_after`/`time_window` 只登记）：`:500`；协调冲突两级与 cancelled/notify 退出：`:872+` 与真实试点用例；loader 契约（协调不进验收指纹）：`schedule-loader-contract.test.ts:76`；只读：`api.test.ts:303-306`；派生可重算（指纹）：`schedule-state.test.ts:54/63`。**「已完成包不可因排程回退」一句已被 §16 业主裁定推翻**：检查记录窗口不再钉 forecast（钉死的是检查日、不是施工起止），现行口径 = 无 scenario 时 forecast 与 baseline 同源、delay 照常影响点名包与下游 |
| 7 | 对比引入前后重复代码/事实字段/维护工作量；仅有冗余不改善则缩范围 | ✅ | 四个 PR：`#216` 4553+/161−（16 文件，含 S0 设计）、`#218` 2303+/44−（15）、`#220` 2893+/57−（22）、`#221` 107+/7−（2，已合入 `cf4ffea5`）。**新增事实面只有 D1 裁定的三处**（`work_calendar` / PKG `constraints` / SCH `coordination`，全部住既有 `control.yaml`）+ 快照纯增量两键；排程数学单实现于 `shared/schedule-projection.ts`；复用既有 loader/门禁/选中态/面板形态/验收草稿流——没有第二套状态机、任务源或预算源 |

### 21.3 未验证：待真实事实的两腿（关闭口径请业主裁）

- **协调确认实跑**：9 条协调全部 `pending_invite`、`actor: null`。通道已在位：`coordination` 块写回 `control.yaml` 走「AI 会话 + PR」（D3，页面无写路径），loader 校验 `coordination_confirmed_without_actor`（确认必须落到可追溯的人）。要让第一条变成 `confirmed`，需要一个真实的约人结果——只有业主/现场能提供。
- **现场执行/验收留证实跑**：`audit_log.records` 为空（未施工，是诚实态）。通道已在位且有测试：验收草稿流（页面 PUT 草稿 → `tmp/capture/acceptance-staging/` 暂存 → 提交时**开分支**，在分支内先做 `audit_log` 文本手术追加 → 重渲视图 → **带上新记录复跑 `verify:schedule`** → 显式路径 `git add` + commit + push + 开 PR → 业主合并），`acceptance-draft.test.ts` / `acceptance-staging-sweep.test.ts` 覆盖。「提交前跑两遍」= 当前树必须干净通过、带上新记录必须再次通过，两遍都在 commit 之前（`server/acceptance-draft-store.ts` 的 `submitAcceptance`）。
- **因此标准 2 的诚实状态是**：六腿（看下一步 → 角色行动/到场 → 协调确认 → 执行/验收留证 → 状态更新 → 排期重算）各有单一实现、门禁与只读证据；**真实实例为 0**，因为交房与施工都还没开始。请业主裁定：以「结构性就绪 + 只读证据齐」关闭 #202，或保留 #202 到交房后完成一次真实协调确认与一次真实验收留证再关。

### 21.4 S3 登记未收项的现状（2026-11-12）

- **已收**：Codex 二审 minor ×2（`tickOrds` 末端刻度索引、`confirmed_at` 未命中措辞）与独立评审 verified medium ×1（日历轴/条幅 9px 错位）→ PR #221（已合入 `cf4ffea5`；含该 PR 自引入回归的收口：两列跨度不得删唯一首刻度）。
- **仍开**：Codex 二审 major 1（工作台每节 8 条截断后无展开/分页入口）；独立评审 low 2（工作台 `coordination` 形状兜底、`windowOf` 缺包时静默移出重叠判定）。 → 已收（§22）。
- **待业主裁的结构问题**：面板侧冲突分类与模块 `detectCoordinationConflicts` 是同一口径的两处实现（模块至今无生产消费方）——是否改由 loader 单一来源、面板纯渲染（§20 已登记）。 → 已裁定并收口（§22）。

---

## 22. S3.2 收尾闭环（2026-11-12）

> **本节只追加，不改写 §1–§21。** 工作树 `/home/tao/projects/bontop-wt/ep-202-s3-2-closeout`
> （分支 `fix/202-s3-2-closeout`，基 `origin/master` `4d5b595c`）。本片收口 §21.4 两条未收项与
> §20 登记的「已知张力（留业主裁）」：冲突分级从「两处实现」收成 loader 单一来源、面板改纯渲染，
> 并补上 Codex 二审 major 的截断入口与独立评审 low 的形状守卫。

### 22.1 单一来源接线：loader 调 `detectCoordinationConflicts`，快照透出 `coordination_conflicts`

- **算法不动**：冲突分级唯一实现仍是 `shared/schedule-projection.ts` 的
  `detectCoordinationConflicts`（§4 第 6 条 / §16.4 / §17.4 的两级口径），本片不重写、不改语义。
- **loader 摊平 + 接线**（`shared/schedule-state.ts`）：
  - `coordinationScheduleItems(control)`：主车道（`sequence < 900`）`checks[].coordination` 摊平成
    `CoordinationScheduleItem[]`——**每条 coordination 的每个 `required_roles` 角色产出一条**；
    `owner_role`（协调组织者「谁去约人」）**不进占用**；侧车道 PKG-900 不进（投影里没有它的包，
    硬塞会被模块判 `unknown_coordination_package`）。
  - load 期调用 `detectCoordinationConflicts(items, scheduleProjection)`，结果挂
    `ScheduleState.coordinationConflicts`；检测失败 **fail-closed**：`coordination conflicts: <code> — <message>`
    进 `errors`（不降级成空报告——空报告是「无冲突」这个结论，失败是「不知道」），route 见 errors 即 503。
  - `buildScheduleSnapshot` 纯增量搬运：快照新键 `coordination_conflicts`（形状 =
    `CoordinationConflictReport`，类型从模块复用、不另定义）。**键三分语义**：键缺失 = 不知道
    （旧快照/旧服务端）；`{conflicts: [], potential: []}` = 无冲突也无潜在重叠；有簇 = 逐簇徽标。
    冲突不是门禁输入，不进 `gateStatus` / `effectiveReadiness`，不新增任何写通道（§5 口径不变）。
- **面板删掉第二套分类改纯渲染**（`app/src/ui/RoleWorkbenchPanel.ts`）：S3 的面板侧展示分类
  （`isConfirmed` / `dayOf` / `participatesIn` / `windowOf` / `windowsOverlap` / `overlapComponents`
  及 `WindowedEntry`、`scheduleMissingNote`）连同 `snapshot.schedule` 消费一起删除；现场冲突节只读
  `coordination_conflicts`，徽标 = 级别固定中文（「确定冲突」/「潜在重叠（尚未确认预约）」）+
  服务端 `reason` 原文，簇内每个 SCH 仍可点（selection = {该 SCH 的包, SCH id}）。面板只从模块
  import **类型**（`CoordinationConflictReport` / `CoordinationOverlap`），不 import 任何函数、
  不自算冲突（D4）。
- **机器对账**：新增 `tests/server/schedule-coordination-conflicts.test.ts`（283 行）：真实
  `control.yaml` 下快照 `coordination_conflicts` 存在、`conflicts` 0、`potential` 4 簇（业主 7 /
  设计师 6 / 施工方 3 / 空调商 3）与 `tests/server/schedule-projection.test.ts` 的模块用例逐条同值
  （SCH-080-01 remote / SCH-090-01 notify 不进簇）；构造用例钉 `owner_role` 排除、无 coordination 时
  键为 `{conflicts: [], potential: []}`（不是 undefined）、真有冲突时键里带得出 `conflicts`。

### 22.2 面板两条收尾

- **截断入口（Codex 二审 major 的答复）**：每节行数上限 `MAX_VISIBLE_ROWS`（8）保留、折叠态出
  「等 N 条」；超出时给**可操作入口**——真按钮「查看全部 N 条」→ 该节全量 +「收起」。按钮文字自带、
  窄屏同样可用，不依赖 `title`（`title` 全量通道保留）。展开态住实例字段 `expandedSections`
  （key = `${role}|${section}`），re-render（点选、选中态订阅回调、容器尺寸变化重渲）后保持——
  只是本地 UI 状态，不写服务端、不进任何配置。
- **coordination 形状守卫（独立评审 low 的答复）**：遍历 `coordination` 时 entry 为 null/数组/非对象
  → 跳过并计数，面板级文案「N 条协调项形状非法，已跳过（快照版本不符）」；报告簇形状不符同理
  （「N 簇冲突报告形状非法，已跳过」）。报告点名而 `coordination` 索引里解析不到的 SCH：徽标（按
  报告规模）与 `reason` 照出、差额在说明行明说——不静默缩水；`windowOf` 一类「缺包即静默移出
  判定」的路径随面板侧分类一起删除。

### 22.3 三条历史未收项逐条判账

| 登记处 | 原口径 | 判定 |
|---|---|---|
| §20 Codex 审查段（二审 major 1）／§21.4「仍开」 | 工作台每节 8 条截断后无展开/分页入口（触屏端无法可靠读 `title`） | **已收**：§22.2 截断入口 |
| §21.4「仍开」（独立评审 low 2） | 工作台 `coordination` 形状兜底；`windowOf` 缺包时静默移出重叠判定 | **已收**：形状守卫显形计数（§22.2）；`windowOf` 及其所属面板侧分类已随单一来源整体删除（§22.1），该静默路径不再存在 |
| §20「已知张力（留业主裁）」／§21.4「待业主裁的结构问题」 | 面板侧冲突分类与模块 `detectCoordinationConflicts` 同一口径两处实现（模块无生产消费方） | **已收**：§22.1 loader 单一来源、面板纯渲染；对账由 `schedule-coordination-conflicts.test.ts` 承担 |

### 22.5 Codex 二审 blocking 与 minor 的收口（2026-11-12，同一 PR）

- **blocking（角色摊平去重，正确性/接线回归）**：`coordinationScheduleItems` 原先按 `required_roles`
  的每个元素直接产出占用项，而校验不拒绝重复角色——`['业主','业主']` 且 confirmed 时会产出
  `sch_ids: ['SCH-X','SCH-X']` 的「确定冲突」（未确认时误报潜在重叠）。S3 的旧面板用 `includes`
  判角色、每条 SCH 只计一次，故这是接线后的回归。两层收口：① 摊平层保序去重（即使校验被绕过也不自冲突）；
  ② 校验层 fail-loud 新错误码 `coordination_roles_duplicate`（见 §2.1(d) 表）。
- **minor 2（三审：有簇被跳过后仍显示「无冲突」）**：报告 `{conflicts:[null], potential:[]}` 时页面同时出
  「1 簇冲突报告形状非法，已跳过」与「无冲突、无潜在窗口重叠」，两句矛盾。收口为一个判定点：
  `conflictShapeSkipped > 0` 时空态改判「冲突报告不完整：N 簇形状非法已跳过（快照版本不符），
  无法判断是否还有冲突」——不完整就不下「无冲突」结论。
- **minor（报告成员编号非法被静默过滤）**：面板把 `sch_ids` 里非字符串/空串成员过滤掉却只按合法成员算徽标。
  现在非法成员计入徽标规模（报告口径不缩水），说明行拆分两类差额：「N 条成员编号非法，已跳过」与
  「另有 N 条在本快照 coordination 里没有条目」——两种差额都显形，`windowOf` 静默路径已随单一来源删除。

### 22.4 门禁判定行（工作树实测，原文）

```
typecheck（exit 0）：[ci] typecheck: 实际失败 0 条，基线 0 条。 / [ci] typecheck: 无基线外新失败，对照通过。
test-server（exit 0）：[ci] test-server: 实际失败 0 条，基线 0 条。 / [ci] test-server: 无基线外新失败，对照通过。
test-app（exit 0）：[ci] test-app: 实际失败 3 条，基线 3 条。 / [ci] test-app: 无基线外新失败，对照通过。
verify-all（exit 0）：[ci] verify-all: 实际失败 1 条，基线 1 条。 / [ci] verify-all: 无基线外新失败，对照通过。
build:app（exit 0）：- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks / - Adjust chunk size warning limit for this warning via build.chunkSizeWarningLimit.
```

### 22.5 三问回答（删了什么 / 推翻了什么 / 何时静默失效）

- **删了什么**：面板侧整套冲突分类与 `scheduleMissingNote`（「缺排程投影，潜在窗口无法判断」
  文案）、面板对 `snapshot.schedule` 的消费；§7 角色工作台行行数由 S3 估值改 S3.2 实测（898/840，
  原 762/663）并补数据列 `coordination_conflicts`。删除的是第二套口径与其静默路径，不是任何
  冲突/协调数据——数据全在快照（`coordination` / `coordination_conflicts`）里。
- **推翻了什么**：§20「已知张力（留业主裁）」的「面板侧展示分类与之并存」状态——本片按该段
  预先写好的方向（loader 调模块函数、报告进快照、面板纯渲染）收口；§21.4 两条未收项判「已收」；
  面板「缺排程投影时出文字、不出潜在徽标」的降级口径被「键缺失 = 冲突无法检测（不冒充无冲突）」
  取代（原文字面保留在 §20 / §21.4，执行以本节为准）。§16.4 / §17.4 的两级口径本身不变，只是
  执行位置从面板搬到模块（模块口径一字未动）。
- **新增部分在什么条件下会静默失效**：
  1. **键缺失被读成「无冲突」**：缺失语义是「不知道」（旧快照/旧服务端）。本面板用三分语义挡住
     这一处；未来新消费方若直接 `?? {conflicts: [], potential: []}`，就把「不知道」读成「无冲突」。
     触发：新增消费方不查键存在性。
  2. **单一来源再次漂移**：机器对账目前只在测试里（loader 报告与模块用例逐条同值），没有 facts
     契约拦「面板/新消费方自算分级」。触发：新 UI 需求要求面板自己排序/过滤并顺手重算分级——
     届时须先把该需求搬进报告形状。
  3. **摊平侧少条目**：`coordinationScheduleItems` 跳过空/非字符串角色与畸形块，依赖 loader 校验
     `coordination_roles_invalid` / `coordination_invalid` 显形兜底；新增一种畸形形态而校验没跟上
     时会静默少算占用。触发：`coordination` 块结构扩展而摊平与校验其一先落地。
  4. **展开态是实例内存**：`expandedSections` 跨 re-render 保持，但页面重载即丢——本地 UI 状态，
     不带任何持久语义；若未来写进 URL/存储须另登记口径。

- **本文档同步**：§20 段末与 §21.4 两条 bullet 只追加指向（原文保留）；§7 角色工作台行改实测
  行数并补 `coordination_conflicts`（原 762/663 保留在括注里）。

---

## 23. S4 §21.4 ⑤ 收口：真实路由响应 → 面板渲染集成测试（2026-11-12）

- **缺口**：服务端（`api.test.ts` / `schedule-*.test.ts`）与面板（app 的 vitest 夹具）各自全绿，
  形状漂移时没有一条测试会红——服务端删/改 `coordination_conflicts` 之类的键，面板测试照绿
  （夹具自给自足）。S2 起登记为「缺真实路由响应 → 面板渲染的集成测试」，本片补上。
- **做法**（`tests/server/schedule-panel-integration.test.ts`）：① 用 `createApiRouter` + supertest
  走**真实 express 路由**拿 `GET /api/schedule/state` 的真 HTTP 响应；② 装 jsdom DOM，把响应体
  喂给**真实面板**（`RoleWorkbenchPanel` / `CoordinationCalendarPanel`，动态 import app 源码），
  断言真实数据被渲染（全部 9 条协调的 SCH id 与所属包名、潜在簇徽标且同角色不得同时显示「无冲突」、
  无锚点时日历不出现年月日、渲染前后快照逐字节不变）；③ 漂移守卫：面板消费的五个顶层键缺一即红，
  失败信息点名缺失的键。
- **配套**：root `tsconfig.json` 加 `baseUrl` + `paths`（`@shared/*` → `shared/*.ts`）——测试 import
  会把 app 面板拉进 root 类型检查，别名与 `app/tsconfig.json` 同源；两棵树 typecheck 均 0 错。
  新增 devDependency `@types/jsdom`（与既有 `@types/express`/`@types/supertest` 同惯例；jsdom
  本来就在 devDeps，此前无类型声明）。
- **Codex 一审 major 两处的收口**：① 只读基准改取在面板拿到 payload **之前**（渲染期间的原地
  改写才可能被抓到）；② 逐条断言改为按 `.rw-coord-row[data-sch-id]` / `.cal-chip[data-sch-id]`
  定位具体行/chip（并在行内核对所属包名与 `data-pkg-id`），不再拿整段文本的包名出现当证据；
  另钉死试点条数 9（从响应体自身推导会出现「条目整体消失 → 循环里没有它 → 假绿」）。
  ③ （二审 minor）fetch 替身记录并断言请求地址：两个面板都只许打 `/api/schedule/state`——
  端点写错时这条接线测试必须红（否则它对「请求打到哪里」毫无约束）。
- **变异验证**：① 删掉快照的 `coordination_conflicts` 装配 → 精确报「响应缺
  coordination_conflicts——面板读的就是这个键」；② 快照漏掉一条试点协调（SCH-070-01）→
  报「试点 coordination 应为 9 条」；恢复 → 绿。
- **门禁**（工作树实测判定行）：`ci:typecheck` 0/0；`ci:test-server` 0/0（含新测试）；
  `ci:test-app` 3 失败（HouseScene 存量，基线内）/ 944 通过；`ci:verify-all` 1 失败（verify-mep 存量，
  基线内）；`build:app` 通过。
- **何时静默失效**：① 断言含「真实数据目前无同日已确认占用（conflicts 0）」，数据变化时该断言会红
  并把更新点写在消息里；② 面板若改为非 DOM 渲染（画布），本测试失效；③ `@shared` 别名在两份
  tsconfig 各写一次，新增别名需两处同步。

## 附：本设计回答的 Issue 原文第一问（切片 A 首个待答项）

> "先判断现有 `SCH` 能否承载施工活动、会审、验收和协同预约。"

**答：能承载前三者，不能承载第四者，缺的是三个字段而不是新对象。**
- 施工活动/验收：`checkpoint` 词汇已覆盖（`design_freeze`/`before_start`/`before_covering`/`release`/`completion`…49 个 SCH 全有），`checks` + `acceptance_refs` 机制成熟。
- 会审：语义已在（SCH-000-02 的 method 就是多角色会审流程），只需给它挂 `coordination`。
- 协同预约：缺 `mode`/`lead_time_workdays`/`status` 三字段——所以最小增量是**给 SCH 加一个
  coordination 块**，不是新对象类型。这正是 Issue 原则 1"仅在确有无法映射时提出最小增量"的答案。
