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
| D2 | **实际起止不存新字段，派生自 `audit_log` 段 `records` 数组的 `checked_at`** | 执行记录的权威形态已存在（`required` 含 `checked_at`，control.yaml:1809-1812）；再存一份"实际开工日"就是同一事实两处 |
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

### 2.2 检查记录窗口：派生，不存储（D2；F2 正名，2026-11-11）

> 原文「实际日期：派生，不存储」及公式「PKG 实际窗口 = [min, max](`audit_log` 的 `records` 中该包 passed 记录的 `checked_at`)」已随 PR #216 二审 F2 推翻（见 §15.9）：检查通过日期不是施工起止事实。D2 的「派生，不存储」结论保留，被正名的是这个派生事实的语义。

```
PKG 检查记录窗口 = [first_ord, last_ord]（该包全部 passed 检查的 checked_at，经 work_calendar 映射后的首末工作日）
```

- **语义**：首末 passed 检查日期的**证据窗口**，回答「门禁 passed 的完成证据登记在哪些检查日」；**不是施工实际起止**。检查通过时间与施工起止无关（拆墙/结构检查在拆完后才做；全部检查同日登记时，多日施工会被压成一天），**实际开工时间从未记录，保持未知**。
- **交付键**：快照 `schedule.packages[pkg].check_window: {first_ord, last_ord} | null`（F2 起；旧键 `actual` 退场）。模块入参 `ProjectionInput.actual_windows` 的字段名本轮冻结（模块文件不动），loader 在边界处把检查记录日期映射成 `{start_date,end_date}`；投影把该窗口当作「门禁 passed 的完成证据」钉死 forecast，不是「施工实际起止」。
- 未 passed → `check_window: null`（现在全 25 包皆此态，诚实）；部分通过（1/N）不生成——单条检查通过不等于整包完工。
- 复验 supersedes 旧记录后取最新 passed 的 `checked_at`（`auditStatusFor` 已有 stale 降级，shared/schedule-state.ts:958 起，直接复用）。
- **停工/复工**：不新增事件类型。停工 = 期间无新 passed 记录 + blocker 保持未关闭；恢复 = 新记录出现。窗口是检查登记日的首末包络，不声称期间连续施工；若未来需要显式停工原因，进 blocker 的 `trigger`/`rationale`，不建事件流。

### 2.3 提案：PR 即通道（D3）

MVP 没有任何"排程建议"存储。人看到的任何调整（拖甘特条、改工期）在前端只生成一段
**可复制的 YAML diff 文本**（"落配置请通过 AI 会话"的同一口径，页面只读铁律），
由 AI 会话落 control.yaml 并走 PR。浏览器侧零写路径——连草稿都不存。

---

## 3. 时间模型：四条时间线（Issue 原则 4 的落地）

| 线 | 定义 | 数据来源 | 存储 |
|---|---|---|---|
| 计划基线 | 声明依赖 + 声明工期区间，两次前向传播（min 口径 = 乐观，max 口径 = 保守） | `dependencies` + `duration_workdays` | 不存，每次重算 |
| 当前预测 | 基线重算，但把**已有检查记录窗口**的包钉死在该窗口，未完工包继承基线 | 基线 + `records` 的 `checked_at` | 不存 |
| 检查记录 | 该包全部 passed 检查的 `checked_at` 首末窗口（门禁完成证据，不是施工起止；快照键 `check_window`） | `audit_log` | 已存 |
| 外部固定约束 | `not_before/not_after/time_window`，`site_pending` 只登记不生效 | PKG `constraints` | 已存（新增） |

**相对工作日序数（ord）**：全部计算输出以"自排程零点起第 N 个工作日"表示（1-based）。
`anchor_date: null` 时 UI 只显示"第 N 工作日"及上下界；`resolved` 后同一计算自动带出
`YYYY-MM-DD`。**未知保持未知，不造年月日。**

---

## 4. 排程算法（`schedule-projection` 模块，D4）

纯函数模块，与 `shared/flow-layout.ts` 同宗：无 fs、无 DOM、node/vitest 直接测；
被 `shared/schedule-state.ts` 的 `buildScheduleSnapshot` 调用，**UI 不 import 它做计算**
（UI 只消费快照里的结果）。

```ts
export interface ScheduleInput {
  packages: Array<{ id, sequence, dependencies, duration_workdays: {min,max},
                   constraints?, readiness, status, gate_status }>;
  auditWindows: Record<string, {start_ord: number, end_ord: number}>;  // 由 loader 从 audit_log 派生
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
4. **基线 vs 预测**：预测把 `auditWindows` 中已有实际窗口的包钉死在实际值，其后包从实际末端继续。
5. **延期传播（what-if）**：`scenario.delay` 从指定包起把 duration 加 N，**只重算拓扑下游**
   （并行分支的序数不变——这正是"不简单平移所有下游"的算法含义）；输出
   `affected: [{pkg, baseline, forecast, delta}]` 与原基线对照。
6. **冲突检测（角色工作台用）**：同一 `required_role` 的 `mode: onsite` 项，若预测窗口重叠
   → 冲突（同一天两处现场）。`notify` 不产生冲突。

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
  ordinals: Array<{ ord: number, date: string | null }>,   // anchor 未定则 date 全 null
  packages: Record<string, {
    duration_workdays: { min: number, max: number },
    baseline:  { start_ord: number, end_ord_min: number, end_ord_max: number },
    forecast:  { start_ord: number, end_ord_min: number, end_ord_max: number },
    check_window: { first_ord: number, last_ord: number } | null,   // F2：检查记录窗口，不是施工起止
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
- 503 行为不变（`state.errors.length` → 503）；新 loader 错误码走同一通道。

### 6.2 `GET /api/schedule/what-if?delay=PKG-040:3,PKG-030:2`（新，只读）

- GET 不触发写 token 守卫（守卫只拦 POST/PUT/PATCH/DELETE）——what-if 是计算不是写。
- 语法 `pkg:workdays` 逗号列表；未知包/非正整数 → 400 带原因；无参 → 等同基线。
- 响应 = §6.1 的 `schedule` 再加 `scenario: { overrides, affected: [{pkg, delta, baseline, forecast}] }`。
- 试点场景"水电或空调延迟 3 个工作日"（Issue 切片 C）正好一个参数。

---

## 7. UI 设计（三个新面板 + 一个升级，全部只读）

沿用审批页既有形态：plain-TS class（`show/hide/isVisible/refresh`）、`<div class="dynamic-panel">`、
挂 `#approval-page-panels`、inline style + `escapeHtml`、≤700px 走 `input-capability.ts` 单列。
**新面板不 import 排程投影模块**——只渲染快照。

| 视图 | 形态 | 面板 | 数据 | 交互 |
|---|---|---|---|---|
| 项目看板 | **升级** `SchedulePanel`（progress 模式加一列"预测窗口"） | 已有 334 行 | `schedule.packages` | 行点击写 selection（现状不变） |
| 动态甘特 | **新** `GanttPanel` | 新 ~450 行 | `schedule.*` | 条点击 → selection；what-if 控件（delay 输入 → GET what-if → 重渲）；min/max 画**区间条**不是单值条；无 anchor 时 x 轴标"第 N 工作日" |
| 角色工作台 | **新** `RoleWorkbenchPanel` | 新 ~400 行 | `owner_roles` + `coordination` + `next_actions` | 按角色分组：待办检查 / 待确认协调 / 现场冲突；点项 → selection |
| 协调日历 | **新** `CoordinationCalendarPanel` | 新 ~400 行 | `coordination` + `schedule.packages` | 按工作日列 onsite/remote/notify 三类 chip；`site_pending` 约束标"待定" |

**关键复用（D5）**：三个新面板的点击一律 `selection.set({packageId, checkId})`，
**不自己做 3D 高亮、不自己做 scope 展开**——`ScheduleDetailPanel` 是定位与
`resolvePackageScope` 的唯一使用者（现状如此）。#191 退役 MODEL-PKG-100 选择器时，
只迁这一处，本设计的三个面板零改动。

**路由**：`#approval=` 枚举加 `gantt|roles|calendar`（approval-route.ts:25-59 + App.ts:1150/1162/1251
三处登记），tab 文案"甘特/角色/日历"。深链、push/replace、退出语义由现有路由机制免费获得。

**移动端**：甘特在 ≤700px 退化为"包列表 + 序数条"（不硬画时间轴，参照 FlowChartPanel
issue #83 的单列降级先例）；工作台与日历本就是列表/纵列形态，天然适配。

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
| **S3 工作台+日历** | 两个新面板 + 试点数据补全（SCH-000-02/SCH-070-01 coordination） | 两个新面板 + control.yaml | 同上；冲突检测用例（同角色双现场）绿 |
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
- 检查记录窗口派生：空 audit / 部分通过 / waived → `check_window: null`；gate passed → `check_window` = 首末 passed 检查 `checked_at` 映射的 ord；同日多条记录时 first = last；supersedes 后取最新。
- what-if：delay PKG-040:3 → 只影响拓扑下游；并行分支序数不变；`affected` 列出真实受影响包。
- 已完成包不可因排程回退：`status: passed` 包在 what-if 中 forecast 不被改写。
- 协调契约：`coordination` 字段不出现在 gate/readiness 输入（结构断言 + facts 契约回归）。

**app 侧（vitest）**：
- 甘特：区间条渲染 min/max；无 anchor 显示"第 N 工作日"；点击写 selection 且不调 onHighlight；
  空/503 态；转义。
- 工作台：按角色分组；`notify` 不产冲突；同角色 onsite 窗口重叠 → 冲突徽标。
- 日历：三类 chip；`site_pending` 标"待定"。
- 移动端：≤700px 甘特退化列表（照 FlowChartPanel issue #83 块写）。

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
2. **最小真实工作流跑通**（看下一步→角色行动→协调确认→执行/验收留证→状态更新→排期重算），覆盖 PKG-000 与 PKG-070 → S3 后由切片 C 试点脚本验证；协调确认走"复制 YAML diff → AI 会话 → PR"通道，执行/验收留证走既有 audit 写路径。⏳ S4 对账
3. **同一 PKG/SCH 四视图状态一致，无第二权威源** → 四视图共吃一个快照；门禁/就绪仍单实现于 `shared/schedule-state.ts`。✅（结构保证）
4. **基线/预测可区分，未知保持未知，协调≠验收，审批走现有授权** → §3 四线分离 + §5 两条机器断言 + D3 只读写路径。✅
5. **测试可重复，既有校验不回退，不加假进度/假日期/自动放行** → §10；每片 PR 退出条件含 `verify:all` + `test:app`。⏳ 随 S1-S3

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

## 附：本设计回答的 Issue 原文第一问（切片 A 首个待答项）

> "先判断现有 `SCH` 能否承载施工活动、会审、验收和协同预约。"

**答：能承载前三者，不能承载第四者，缺的是三个字段而不是新对象。**
- 施工活动/验收：`checkpoint` 词汇已覆盖（`design_freeze`/`before_start`/`before_covering`/`release`/`completion`…49 个 SCH 全有），`checks` + `acceptance_refs` 机制成熟。
- 会审：语义已在（SCH-000-02 的 method 就是多角色会审流程），只需给它挂 `coordination`。
- 协同预约：缺 `mode`/`lead_time_workdays`/`status` 三字段——所以最小增量是**给 SCH 加一个
  coordination 块**，不是新对象类型。这正是 Issue 原则 1"仅在确有无法映射时提出最小增量"的答案。
