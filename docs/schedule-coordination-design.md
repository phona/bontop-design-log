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

### 2.2 实际日期：派生，不存储（D2）

```
PKG 实际窗口 = [min, max](`audit_log` 的 `records` 中该包 passed 记录的 `checked_at`)
```

- 未 passed → 无实际窗口（现在全 25 包皆此态，诚实）。
- 复验 supersedes 旧记录后取最新 passed 的 `checked_at`（`auditStatusFor` 已有 stale 降级，
  schedule-state.ts:664-672，直接复用）。
- **停工/复工**：不新增事件类型。停工 = 期间无新 passed 记录 + blocker 保持未关闭；
  恢复 = 新记录出现。甘特上"实际"段天然断开。若未来需要显式停工原因，进 blocker 的
  `trigger`/`rationale`，不建事件流。

### 2.3 提案：PR 即通道（D3）

MVP 没有任何"排程建议"存储。人看到的任何调整（拖甘特条、改工期）在前端只生成一段
**可复制的 YAML diff 文本**（"落配置请通过 AI 会话"的同一口径，页面只读铁律），
由 AI 会话落 control.yaml 并走 PR。浏览器侧零写路径——连草稿都不存。

---

## 3. 时间模型：四条时间线（Issue 原则 4 的落地）

| 线 | 定义 | 数据来源 | 存储 |
|---|---|---|---|
| 计划基线 | 声明依赖 + 声明工期区间，两次前向传播（min 口径 = 乐观，max 口径 = 保守） | `dependencies` + `duration_workdays` | 不存，每次重算 |
| 当前预测 | 基线重算，但把**已有实际窗口**的包替换为实际值，未完工包继承基线 | 基线 + `records` 的 `checked_at` | 不存 |
| 实际 | 该包 passed 记录的 `checked_at` 窗口 | `audit_log` | 已存 |
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
    actual:    { start_ord: number, end_ord: number } | null,
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
- 实际派生：空 audit → `actual: null`；passed 记录 → 窗口 = checked_at 区间；supersedes 后取最新。
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

## 附：本设计回答的 Issue 原文第一问（切片 A 首个待答项）

> "先判断现有 `SCH` 能否承载施工活动、会审、验收和协同预约。"

**答：能承载前三者，不能承载第四者，缺的是三个字段而不是新对象。**
- 施工活动/验收：`checkpoint` 词汇已覆盖（`design_freeze`/`before_start`/`before_covering`/`release`/`completion`…49 个 SCH 全有），`checks` + `acceptance_refs` 机制成熟。
- 会审：语义已在（SCH-000-02 的 method 就是多角色会审流程），只需给它挂 `coordination`。
- 协同预约：缺 `mode`/`lead_time_workdays`/`status` 三字段——所以最小增量是**给 SCH 加一个
  coordination 块**，不是新对象类型。这正是 Issue 原则 1"仅在确有无法映射时提出最小增量"的答案。
