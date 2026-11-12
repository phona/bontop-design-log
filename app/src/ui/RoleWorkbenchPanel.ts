// 自装审批「角色工作台」面板（2026-11-11 issue #202 S3，设计 §7 / §2.1(c) / §16.4 / §17.4；
// 2026-11-12 S3.2 收尾：冲突改读服务端报告——面板侧分类删除、截断入口、形状守卫）。
//
// 数据只有一个来源：`GET /api/schedule/state` 的同一个快照——
//  - `snapshot.packages[]`：包名/sequence/owner_roles/checks（待办检查的来源）；
//  - `snapshot.coordination`（可选键，Record<SCH id, ScheduleCoordinationView>）：
//    待确认协调的来源（稀疏：没有 coordination 块的 SCH 不出现，不造空对象）；
//  - `snapshot.coordination_conflicts`（可选键，S3.2 起；类型 = CoordinationConflictReport，
//    与 shared/schedule-state.ts 的键声明同源）：现场冲突/潜在重叠的**唯一来源**——服务端
//    load 期用 `shared/schedule-projection.ts` 的 `detectCoordinationConflicts` 算好
//    （单一来源，设计 §20 登记的「两处实现」张力在此收口）；
//  - `snapshot.next_actions[]`：只把 unblocks 数作为行内注释带在待办行上（只解释不计算）。
// **`snapshot.schedule` 自 S3.2 起不再被本面板消费**（潜在窗口重叠由服务端报告给出，
// 面板不再自己算窗口、不再有「缺排程投影」静默降级路径）。
// 本面板只从 `shared/schedule-projection.ts` import **类型**（CoordinationConflictReport /
// CoordinationOverlap——契约形状的单一来源，不重定义），不 import 它的任何函数、不做排程或
// 冲突计算（设计 D4：投影唯一实现在服务端，浏览器只渲染快照）；不另读 control.yaml；
// 不拉其他端点；不调 onHighlight、不做 scope 展开（D5：点行只写
// selection.set({packageId, checkId})，定位的唯一使用者仍是 ScheduleDetailPanel）。
//
// 渲染口径（任务书 §1.1 + §1.4）：
//  - 按角色分组（角色集合 = 各包 owner_roles ∪ coordination 的 required_roles ∪ owner_role
//    ∪ 报告里出现的角色，按 `<`/`>` 字典序排——localeCompare 环境相关，禁用）；
//  - 每组三节顺序固定：待办检查 → 待确认协调 → 现场冲突；
//  - 待办检查只列未完成（audit_status 为 passed/waived 算已完成，其余含 undefined 算待办），
//    状态文字**原样**显示 audit_status 或「未登记」——不把派生值翻译成看起来像声明值的词；
//  - 待确认协调只列 status ∈ {unassigned, pending_invite, invited} 且角色相关的条目
//    （相关 = required_roles 之一或 owner_role——组织者要看自己要约的条目，口径不变）；
//    actor.name 为 null 显「待指定」，严禁造人名；
//  - 现场冲突**只读 `snapshot.coordination_conflicts`，面板不做任何分类**：占用口径只认
//    required_roles、cancelled/non-onsite 排除、confirmed 同日与未确认窗口重叠的分级，全部
//    是服务端 detectCoordinationConflicts 的口径，面板不复制、不重算。簇徽标 = 级别文字
//    （「确定冲突」/「潜在重叠（尚未确认预约）」）+ 服务端 reason 原文；簇内每个 SCH 仍可点
//    （selection = {packageId: 该 SCH 的包, checkId: SCH id}）。缺失语义三分：键缺失/形状不符
//    →「冲突无法检测（…）」；键在但两数组为空 →「无冲突、无潜在窗口重叠」；有簇 → 逐簇徽标；
//  - 形状守卫（S3.2 low 收口）：遍历 `coordination` 时 entry 为 null/数组/非对象 → 跳过并计数，
//    面板级文案「N 条协调项形状非法，已跳过（快照版本不符）」；报告里的簇形状不符同理。
//    原先 windowOf 那一类「静默移出判定」的路径随面板侧分类一起删除；
//  - 颜色旁必须始终有文字（状态点/mode chip/冲突徽标一律「色块 + 中文」），颜色只来自下面的
//    固定映射表，禁止把 payload 字符串当颜色用；
//  - 每节行数上限 MAX_VISIBLE_ROWS 保留：折叠态前 8 行 +「等 N 条」，超出时给**可操作入口**
//    （「查看全部 N 条」按钮 → 该节全量 +「收起」；真按钮、文字自带、窄屏同样可用，不依赖
//    title）。展开态住实例字段 expandedSections（key = `${role}|${section}`），re-render
//    （含点选、选中态订阅回调）后保持；只是本地 UI 状态，不写服务端、不进任何配置；
//  - 空态有明确文字（无快照 / 取数失败 / 无角色 / 无待办），不渲染空骨架；
//    coordination 缺失或为空时**不置空整面板**——待办检查只依赖 packages，照常渲染，
//    协调节出节级空文案；
//  - ≤700px（NARROW_MAX_PX，与 style.css 的 @media 断点同源）单列退化：工作台本就是列表，
//    窄屏只放宽布局约束，不建第二套布局；
//  - 只读快照：渲染前后不改写 snapshot.coordination / snapshot.coordination_conflicts 任何
//    数组/对象（不 sort/splice/赋值；排序只做副本）。测试钉住逐字节不变。
import type {
  NextActionItem,
  ScheduleCheckView,
  ScheduleCoordinationView,
  SchedulePackageView,
  ScheduleSnapshot,
} from '@shared/schedule-state';
// 只 import 类型：契约形状的单一来源是 shared/schedule-projection.ts；面板不自算冲突（D4）。
import type { CoordinationConflictReport, CoordinationOverlap } from '@shared/schedule-projection';
import type { ScheduleSelectionStore } from '../state/schedule-selection.js';
import { setupCollapsiblePanel } from './CollapsiblePanel.js';
import { escapeHtml } from './escape-html.js';
import { NARROW_MAX_PX } from './input-capability.js';

// ─── 固定映射表（颜色只能来自这里；文字与颜色必须同时出现）────────────────────

/** 待办检查的完成态：passed/waived 之后的 audit_status 一律原样显示（含 undefined→未登记）。 */
const AUDIT_DONE_STATUSES = new Set(['passed', 'waived']);
/** audit_status 取色（未知 token 回退中性色；文字始终原样，颜色只是旁证）。 */
const AUDIT_STATUS_COLOR: Record<string, string> = {
  passed: '#5cb85c',
  waived: '#9b8bd0',
  failed: '#d9534f',
  stale: '#e9c46a',
  pending: '#6fa8dc',
  not_applicable: '#9b8bd0',
};

/** coordination mode 三类：固定色 + 中文标签成对出现。 */
const MODE_LABEL: Record<string, string> = {onsite: '到场', remote: '远程', notify: '通知'};
const MODE_COLOR: Record<string, string> = {onsite: '#6fa8dc', remote: '#5cb85c', notify: '#9b8bd0'};

/** coordination status 词汇（与 ScheduleDetailPanel 同口径的五值 + 未分配）。 */
const COORD_STATUS_LABEL: Record<string, string> = {
  unassigned: '未分配',
  pending_invite: '待邀请',
  invited: '已邀请',
  confirmed: '已确认',
  cancelled: '已取消',
};
const COORD_STATUS_COLOR: Record<string, string> = {
  unassigned: '#8a93a3',
  pending_invite: '#e9c46a',
  invited: '#6fa8dc',
  confirmed: '#5cb85c',
  cancelled: '#d9534f',
};

/** 待确认协调的入场三态（§1.1）；confirmed/cancelled/未知值不进这一节。 */
const PENDING_COORD_STATUSES = new Set(['unassigned', 'pending_invite', 'invited']);

/** 两级冲突徽标文字（服务端报告只给级别与 reason，文字由面板按级别配固定中文）。 */
const CONFLICT_BADGE = '确定冲突';
const POTENTIAL_BADGE = '潜在重叠（尚未确认预约）';
const CONFLICT_COLOR = '#d9534f';
const POTENTIAL_COLOR = '#e9c46a';
const NEUTRAL_COLOR = '#8a93a3';

/** 冲突报告三态文案（键缺失 = 不知道；空数组 = 无冲突；有簇 = 徽标）。 */
const CONFLICTS_UNKNOWN_NOTE = '冲突无法检测（快照未带 coordination_conflicts，服务端可能仍是旧版）';
/** 键在但值不是契约形状：与「缺失」同归「无法检测」——绝不把坏形状读成「无冲突」。 */
const CONFLICTS_MALFORMED_NOTE = '冲突无法检测（coordination_conflicts 形状不符：需 {conflicts, potential} 两个数组，服务端可能仍是旧版）';
const CONFLICTS_EMPTY_NOTE = '无冲突、无潜在窗口重叠';
/** 形状守卫计数文案（S3.2 low 收口）：跳过多少、为什么，面板级显形，不静默。 */
const shapeSkipCoordinationNote = (count: number): string => `${count} 条协调项形状非法，已跳过（快照版本不符）`;
const shapeSkipClusterNote = (count: number): string => `${count} 簇冲突报告形状非法，已跳过（快照版本不符）`;

/** 试点数据固定水印（§5 风险表：试点 9 条不是全部名单）。 */
const PILOT_NOTICE = '试点数据：仅登记了 coordination 的 SCH 出现，未登记不代表无协调';

/** 每节行数上限（照 GanttPanel MAX_VISIBLE_REASONS 先例）。 */
const MAX_VISIBLE_ROWS = 8;
const ACTIVE_BORDER = '#6fa8dc';

// ─── 纯函数 ────────────────────────────────────────────────────────────────

/** 字典序比较（任务书 §1.1：禁用 localeCompare，环境相关）。 */
function compareRaw(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function labelOf(map: Record<string, string>, value: string | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}

/** 取色只经固定映射表：payload 字符串永远不当颜色用，未知值回退中性色。 */
function colorOf(map: Record<string, string>, value: string | undefined): string {
  if (!value) return NEUTRAL_COLOR;
  return map[value] ?? NEUTRAL_COLOR;
}

/** 色块（旁边调用处一律跟中文文字）。 */
function dot(color: string): string {
  return `<span class="rw-dot" style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${color};border:1px solid rgba(255,255,255,.25);"></span>`;
}

function isDoneCheck(check: ScheduleCheckView): boolean {
  return check.audit_status !== undefined && AUDIT_DONE_STATUSES.has(check.audit_status);
}

/** 角色与一条 coordination 的相关性：必填角色之一或责任角色（§1.1 待确认列表口径）。 */
function belongsToRole(entry: ScheduleCoordinationView, role: string): boolean {
  return (Array.isArray(entry.required_roles) ? entry.required_roles : []).includes(role)
    || entry.owner_role === role;
}

/** 合法角色名（空串/非串不进角色集合：不给快照噪声造出「undefined 角色组」）。 */
function isRoleName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * coordination 条目形状守卫（S3.2 low 收口）：null / 数组 / 非对象一律非法——这类 entry
 * 读 `required_roles` 之类字段会抛，旧代码只在个别分支兜底（静默）。现在统一跳过并计数。
 */
function isCoordinationEntry(value: unknown): value is ScheduleCoordinationView {
  return asRecord(value) !== null;
}

/** 报告簇形状守卫（契约：{role: string; sch_ids: string[]; reason: string}）。 */
function isOverlapShape(value: unknown): value is CoordinationOverlap {
  const record = asRecord(value);
  return !!record
    && isRoleName(record.role)
    && Array.isArray(record.sch_ids)
    && typeof record.reason === 'string';
}

/**
 * 冲突报告三态判定（键与形状：`ScheduleSnapshot.coordination_conflicts`
 * = shared/schedule-projection.ts 的 CoordinationConflictReport，类型直接复用）：
 * 键缺失 →「不知道」（旧快照/旧服务端）；键在且两数组为空 →「无冲突、无潜在窗口重叠」；
 * 有簇 → 逐簇徽标。声明类型虽然只允许报告形状，快照毕竟是网络数据，运行时仍做形状守卫：
 * 坏形状归「无法检测」，**绝不**读成「无冲突」（fail-closed）。
 */
function readConflictReport(snapshot: ScheduleSnapshot): ConflictReportRead {
  const raw: unknown = snapshot.coordination_conflicts;
  if (raw === undefined) return {kind: 'missing'};
  const record = asRecord(raw);
  if (!record || !Array.isArray(record.conflicts) || !Array.isArray(record.potential)) return {kind: 'malformed'};
  return {
    kind: 'present',
    report: {
      conflicts: record.conflicts as CoordinationOverlap[],
      potential: record.potential as CoordinationOverlap[],
    },
  };
}

/** HTTP 失败文案：状态码 + 服务端 error + 前三条 issues（渲染处统一转义）。 */
function describeHttpError(payload: unknown, status: number, endpoint?: string): string {
  const record = asRecord(payload);
  const error = typeof record?.error === 'string' ? record.error : '';
  const issues = Array.isArray(record?.issues) ? record.issues.map((issue) => String(issue)) : [];
  const parts = [`HTTP ${status}${endpoint ? `（${endpoint}）` : ''}`];
  if (error) parts.push(error);
  if (issues.length) {
    parts.push(`问题：${issues.slice(0, 3).join('；')}${issues.length > 3 ? ` 等 ${issues.length} 条` : ''}`);
  }
  return parts.join('：');
}

// ─── 视图模型（纯数据；构建过程只读快照）────────────────────────────────────

interface CheckTodoRow {
  pkg: SchedulePackageView;
  check: ScheduleCheckView;
  /** 同包 next_actions 的 unblocks 注释（只解释不计算）。 */
  notes: string[];
}

interface CoordinationRow {
  schId: string;
  entry: ScheduleCoordinationView;
  packageName: string;
}

/** 服务端报告里的一簇（面板只配级别文字与颜色，reason 与簇规模原样透传）。 */
interface ConflictCluster {
  level: 'conflict' | 'potential';
  badge: string;
  reason: string;
  /** 报告点名的 SCH 条数（徽标口径 = 服务端说的簇规模，不因成员编号非法/解析失败而缩水）。 */
  size: number;
  /** sch_ids 里非字符串/空串的成员条数（报告形状坏；计入 size，渲染时明说，不静默丢）。 */
  invalidMembers: number;
  /** sch_ids 在 coordination 索引里解析到的成员（解析不到的渲染不出行，见 renderCluster）。 */
  members: CoordinationRow[];
}

interface RoleGroup {
  role: string;
  checks: CheckTodoRow[];
  coordinations: CoordinationRow[];
  clusters: ConflictCluster[];
  /** coordination 键缺失/为空：协调节出节级空文案，待办检查照常（不置空整面板）。 */
  coordinationMissing: boolean;
}

/** 冲突报告读取结果（三分缺失语义；见 readConflictReport）。 */
type ConflictReportRead =
  | {kind: 'missing'}
  | {kind: 'malformed'}
  | {kind: 'present'; report: CoordinationConflictReport};

/**
 * 一节的渲染体：html 是已按折叠/展开口径切好的渲染块（检查/协调节一行一块，
 * 冲突节一簇一块），totalRows 是该节总行数（截断文案与按钮口径都按它）。
 */
interface SectionBody {
  html: string[];
  totalRows: number;
}

interface SectionSpec {
  role: string;
  section: string;
  title: string;
  body: SectionBody;
  /** 完整列表（进 title 属性；展开入口只是补充，不清掉 title 这条既有通道）。 */
  fullText: string;
  emptyText: string;
}

interface BuildResult {
  groups: RoleGroup[];
  conflictRead: ConflictReportRead;
  /** 形状非法被跳过的 coordination 条目数（面板级显形）。 */
  skippedCoordinationEntries: number;
  /** 形状非法被跳过的报告簇数（面板级显形）。 */
  skippedConflictClusters: number;
}

export class RoleWorkbenchPanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private unsubscribe: (() => void) | null = null;
  private payload: ScheduleSnapshot | null = null;
  private errorMessage: string | null = null;
  private layoutKey = 'wide';
  private resizeObserver: ResizeObserver | null = null;
  /**
   * 展开的节（key = `${role}|${section}`）：截断入口（Codex 二审 major）的状态。
   * 只住实例——本地 UI 状态，不写服务端、不进任何配置；re-render（点选、选中态订阅回调、
   * 容器 resize）后保持，因为 render 每次都从这里读。
   */
  private expandedSections = new Set<string>();
  /**
   * 取数世代（照 GanttPanel 单 epoch 纪律，本面板无 what-if 故只此一条）：
   * 每次 refresh 发起即换代，只有最新一代的响应允许写 payload/渲染，在途旧响应一律丢弃。
   */
  private dataEpoch = 0;

  constructor(private readonly selection: ScheduleSelectionStore) {}

  show(): void {
    if (!this.el) this.build();
    this.el!.style.display = 'block';
    this.visible = true;
    // 与 GanttPanel 同形：show() 时恢复 active 行；订阅先去重再挂。
    this.subscribe();
    void this.refresh();
  }

  hide(): void {
    if (this.el) this.el.style.display = 'none';
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** 订阅共享选中态：外部（详情面板/深链）改选中时同步 active 行。 */
  subscribe(): () => void {
    this.unsubscribe?.();
    this.unsubscribe = this.selection.subscribe(() => this.render());
    return () => {
      this.unsubscribe?.();
      this.unsubscribe = null;
    };
  }

  /** 重新拉取快照并渲染。失败清空旧快照：错误条下不得留过期分组冒充当前状态。 */
  async refresh(): Promise<void> {
    const epoch = ++this.dataEpoch;
    try {
      const response = await fetch('/api/schedule/state');
      if (epoch !== this.dataEpoch) return;
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        throw new Error(describeHttpError(payload, response.status, '/api/schedule/state'));
      }
      const payload: unknown = await response.json();
      if (epoch !== this.dataEpoch) return;
      this.payload = payload as ScheduleSnapshot;
      this.errorMessage = null;
    } catch (err) {
      if (epoch !== this.dataEpoch) return;
      this.payload = null;
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      // 只有当前世代负责渲染：被更新世代顶掉的在途刷新，不许把旧快照写回来。
      if (epoch === this.dataEpoch) this.render();
    }
  }

  // ─── 分组构建（纯函数式；不碰快照任何数组/对象）─────────────────────────

  private buildGroups(): BuildResult {
    const snapshot = this.payload;
    if (!snapshot) {
      return {
        groups: [],
        conflictRead: {kind: 'missing'},
        skippedCoordinationEntries: 0,
        skippedConflictClusters: 0,
      };
    }
    // coordination 缺失或为空：**不把整面板置空**——待办检查只依赖 packages，降级时仍要可用；
    // 协调节出节级空文案（§1.1：不渲染空列表 = 不出无解释的空节，不是删掉有用的分组）。
    const coordination = snapshot.coordination ?? {};
    const coordinationMissing = !snapshot.coordination || Object.keys(coordination).length === 0;

    const packages = Array.isArray(snapshot.packages) ? snapshot.packages : [];
    const packageName = new Map(packages.map((pkg) => [pkg.id, pkg.name ?? pkg.id] as const));
    // next_actions 按包聚合（只读；unblocks 只作行内注释，不进任何计算）。
    const actionsByPackage = new Map<string, NextActionItem[]>();
    for (const action of Array.isArray(snapshot.next_actions) ? snapshot.next_actions : []) {
      if (!action.package_id) continue;
      const bucket = actionsByPackage.get(action.package_id) ?? [];
      bucket.push(action);
      actionsByPackage.set(action.package_id, bucket);
    }

    // ─── coordination 形状守卫（S3.2 low 收口）─────────────────────────────
    // entry 为 null/数组/非对象 → 跳过 + 计数（面板级显形）。下游一律只认这份索引，
    // 不再有「读到半个条目后静默 continue」的路径。
    const coordById = new Map<string, ScheduleCoordinationView>();
    let skippedCoordinationEntries = 0;
    for (const [schId, raw] of Object.entries(coordination)) {
      if (!isCoordinationEntry(raw)) {
        skippedCoordinationEntries += 1;
        continue;
      }
      coordById.set(schId, raw);
    }
    const coordEntries = [...coordById.entries()].sort(([left], [right]) => compareRaw(left, right));

    // 角色集合 = packages.owner_roles ∪ coordination 的 required_roles ∪ owner_role ∪ 报告角色。
    // 排序只做副本（Set 迭代序不稳定）。
    const roles = new Set<string>();
    for (const pkg of packages) {
      for (const role of Array.isArray(pkg.owner_roles) ? pkg.owner_roles : []) roles.add(role);
    }
    for (const [, entry] of coordEntries) {
      for (const role of Array.isArray(entry.required_roles) ? entry.required_roles : []) roles.add(role);
      if (isRoleName(entry.owner_role)) roles.add(entry.owner_role);
    }

    const rowOf = (schId: string, entry: ScheduleCoordinationView): CoordinationRow =>
      ({schId, entry, packageName: packageName.get(entry.package_id) ?? entry.package_id});

    // ─── 现场冲突：只读服务端报告（面板不做任何分类）───────────────────────
    const read = readConflictReport(snapshot);
    const clustersByRole = new Map<string, ConflictCluster[]>();
    let skippedConflictClusters = 0;
    if (read.kind === 'present') {
      const collect = (level: 'conflict' | 'potential', overlaps: CoordinationOverlap[]): void => {
        for (const overlap of overlaps) {
          if (!isOverlapShape(overlap)) {
            skippedConflictClusters += 1;
            continue;
          }
          // sch_ids 逐个在 coordination 索引里解析（单次遍历，只读）：解析不到 = 快照自相矛盾，
          // 该 SCH 渲染不出可点行，但簇徽标（按报告规模）与 reason 照出，差额在 renderCluster
          // 里明说——不静默缩水、也不假装没有这条协调。
          const named = overlap.sch_ids.filter((schId) => isRoleName(schId));
          // 非法成员（非字符串/空串）与「解析不到」分开计数：前者是报告形状坏、后者是快照自相矛盾，
          // 两种差额都要显形（Codex 二审 minor：只过滤不计数 = 静默丢）。
          const invalidMembers = overlap.sch_ids.length - named.length;
          clustersByRole.set(overlap.role, [
            ...(clustersByRole.get(overlap.role) ?? []),
            {
              level,
              badge: level === 'conflict' ? CONFLICT_BADGE : POTENTIAL_BADGE,
              reason: overlap.reason,
              size: overlap.sch_ids.length,
              invalidMembers,
              members: named
                .map((schId) => {
                  const entry = coordById.get(schId);
                  return entry ? rowOf(schId, entry) : null;
                })
                .filter((row): row is CoordinationRow => row !== null),
            },
          ]);
          // 报告角色也进角色集合：只出现在报告里的角色不得被静默丢掉（不影响 required_roles 口径）。
          roles.add(overlap.role);
        }
      };
      collect('conflict', read.report.conflicts);
      collect('potential', read.report.potential);
    }

    const groups = [...roles].sort(compareRaw).map((role): RoleGroup => {
      // ① 待办检查：该角色 ∈ owner_roles 的包的未完成检查（passed/waived 已完成）。
      const checks: CheckTodoRow[] = [];
      for (const pkg of packages) {
        if (!(Array.isArray(pkg.owner_roles) ? pkg.owner_roles : []).includes(role)) continue;
        for (const check of Array.isArray(pkg.checks) ? pkg.checks : []) {
          if (isDoneCheck(check)) continue;
          const notes = (actionsByPackage.get(pkg.id) ?? []).map((action) => `解锁 ${action.unblocks} 个下游`);
          checks.push({pkg, check, notes});
        }
      }

      // ② 待确认协调：三态入场 + 角色相关（required_roles ∪ owner_role，口径不变）。
      const coordinations: CoordinationRow[] = [];
      for (const [schId, entry] of coordEntries) {
        if (!PENDING_COORD_STATUSES.has(entry.status)) continue;
        if (!belongsToRole(entry, role)) continue;
        coordinations.push(rowOf(schId, entry));
      }

      // ③ 现场冲突：报告按 role 归位（面板侧的占用/判定逻辑已整体删除）。
      const clusters = clustersByRole.get(role) ?? [];

      return {role, checks, coordinations, clusters, coordinationMissing};
    });
    return {
      groups,
      conflictRead: read,
      skippedCoordinationEntries,
      skippedConflictClusters,
    };
  }

  // ─── 渲染 ────────────────────────────────────────────────────────────────

  private render(): void {
    const body = this.el?.querySelector('#role-workbench-body') as HTMLElement | null;
    if (!body) return;

    const error = this.errorMessage
      ? `<div id="rw-error" style="margin-bottom:8px;padding:6px 8px;border:1px solid rgba(217,83,79,.55);border-radius:6px;background:rgba(217,83,79,.12);color:#f0a9a5;font-size:12px;">取数失败：${escapeHtml(this.errorMessage)}　接口不通或控制源校验不过；本面板不渲染来自坏快照的数据，修好后重试。</div>`
      : '';
    // 试点水印固定在场（§5 风险表：9 条不是全部名单，未登记的 SCH 不出现）。
    const pilot = `<div id="rw-pilot" style="margin-bottom:8px;padding:4px 8px;border:1px solid rgba(233,196,106,.4);border-radius:6px;background:rgba(233,196,106,.07);color:#f4dfa8;font-size:11px;">${escapeHtml(PILOT_NOTICE)}</div>`;

    const built = this.buildGroups();
    const shapeNotes = this.renderShapeNotes(built);
    let content: string;
    if (!this.payload) {
      content = this.emptyBox('未取得角色工作台数据（/api/schedule/state 尚未返回或取数失败）：本面板不渲染来自坏快照的分组。');
    } else if (built.groups.length === 0) {
      content = this.emptyBox('快照里汇总不出任何角色（packages 的 owner_roles、coordination 的 required_roles/owner_role 与冲突报告的角色均为空）：本面板不渲染空分组。');
    } else {
      content = this.renderGroups(built);
    }

    body.innerHTML = `${error}${pilot}${shapeNotes}${content}`;
    this.bind(body);
    this.layoutKey = this.layoutKeyOf();
  }

  /** 形状守卫显形（S3.2 low 收口）：跳过多少条、为什么，一句话说清，不静默。 */
  private renderShapeNotes(built: BuildResult): string {
    const parts: string[] = [];
    if (built.skippedCoordinationEntries > 0) parts.push(shapeSkipCoordinationNote(built.skippedCoordinationEntries));
    if (built.skippedConflictClusters > 0) parts.push(shapeSkipClusterNote(built.skippedConflictClusters));
    if (!parts.length) return '';
    return `<div id="rw-shape-note" style="margin-bottom:8px;padding:4px 8px;border:1px solid rgba(233,196,106,.4);border-radius:6px;background:rgba(233,196,106,.07);color:#f4dfa8;font-size:11px;">${escapeHtml(parts.join('；'))}</div>`;
  }

  private emptyBox(text: string): string {
    return `<div id="rw-empty" style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">${escapeHtml(text)}</div>`;
  }

  private renderGroups(built: BuildResult): string {
    const narrow = this.isNarrowContainer();
    const groups = built.groups;
    const totalChecks = groups.reduce((sum, group) => sum + group.checks.length, 0);
    const totalCoord = groups.reduce((sum, group) => sum + group.coordinations.length, 0);
    const conflictClusters = groups.reduce((sum, group) => sum + group.clusters.filter((cluster) => cluster.level === 'conflict').length, 0);
    const potentialClusters = groups.reduce((sum, group) => sum + group.clusters.filter((cluster) => cluster.level === 'potential').length, 0);

    const head = `<div id="rw-head" style="margin-bottom:8px;color:#9aa4b2;font-size:11px;line-height:1.7;">
      共 ${groups.length} 个角色｜待办检查 ${totalChecks} 项｜待确认协调 ${totalCoord} 项｜冲突 ${conflictClusters} 簇／潜在 ${potentialClusters} 簇
      <br>数据只读自 <code>/api/schedule/state</code>（packages / coordination / coordination_conflicts / next_actions 四个键；冲突分级由服务端 <code>detectCoordinationConflicts</code> 单算，本面板不自算）；点行只写共享选中态，不做 3D 高亮、不改任何配置——写路径一律走 PR。
    </div>`;
    const narrowNote = narrow
      ? `<div style="margin-bottom:6px;color:#7d8698;font-size:10px;">窄屏（≤${NARROW_MAX_PX}px）：单列列表（工作台本就是列表，只放宽布局约束）。</div>`
      : '';
    const roles = groups.map((group) => this.renderRoleGroup(group, narrow, built.conflictRead)).join('');
    return `<div id="rw-groups" data-rw-narrow="${narrow}">${head}${narrowNote}${roles}</div>`;
  }

  private renderRoleGroup(group: RoleGroup, narrow: boolean, read: ConflictReportRead): string {
    return `<div class="rw-role" data-role="${escapeHtml(group.role)}" style="margin-bottom:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(255,255,255,.03);">
      <div class="rw-role-head" style="margin-bottom:6px;font-size:13px;"><strong>角色：${escapeHtml(group.role)}</strong></div>
      ${this.renderCheckSection(group, narrow)}
      ${this.renderCoordSection(group, narrow)}
      ${this.renderConflictSection(group, narrow, read)}
    </div>`;
  }

  // ─── 三节 ────────────────────────────────────────────────────────────────

  private renderCheckSection(group: RoleGroup, narrow: boolean): string {
    const rows = group.checks.map((row) => this.renderCheckRow(row, narrow));
    const fullText = group.checks.map((row) => this.checkRowText(row)).join('\n');
    const html = this.visibleRowChunks(group.role, 'checks', rows);
    return this.sectionShell({
      role: group.role,
      section: 'checks',
      title: `待办检查（${group.checks.length}）`,
      body: {html, totalRows: rows.length},
      fullText,
      emptyText: group.checks.length === 0 ? '没有待办（该角色名下没有未完成检查）' : '',
    });
  }

  private renderCoordSection(group: RoleGroup, narrow: boolean): string {
    const rows = group.coordinations.map((row) => this.renderCoordRow(row, narrow));
    const fullText = group.coordinations.map((row) => this.coordRowText(row)).join('\n');
    const html = this.visibleRowChunks(group.role, 'coordination', rows);
    // coordination 键缺失/为空：节级空文案（待办检查不受影响，见 buildGroups）。
    const empty = group.coordinationMissing
      ? '没有协调数据（coordination 键缺失/为空）：本节列不出条目；试点只登记确有协调动作的 SCH'
      : group.coordinations.length === 0 ? '没有待确认协调（该角色名下没有待邀请/待确认条目）' : '';
    return this.sectionShell({
      role: group.role,
      section: 'coordination',
      title: `待确认协调（${group.coordinations.length}）`,
      body: {html, totalRows: rows.length},
      fullText,
      emptyText: empty,
    });
  }

  /**
   * 现场冲突节：只读报告（read）给出的簇，面板不自算。
   * 空态三分：键缺失/形状不符 →「冲突无法检测（…）」；键在且无簇 →「无冲突、无潜在窗口重叠」
   * （coordination 缺失不再改判冲突节——那时报告说了算）。
   */
  private renderConflictSection(group: RoleGroup, narrow: boolean, read: ConflictReportRead): string {
    const totalRows = group.clusters.reduce((sum, cluster) => sum + cluster.members.length, 0);
    const budget = this.isExpanded(group.role, 'conflicts') ? Number.POSITIVE_INFINITY : MAX_VISIBLE_ROWS;
    const chunks = this.clusterChunks(group.clusters, narrow, budget);
    const fullText = group.clusters.map((cluster) => `${cluster.badge}｜${cluster.reason}`).join('\n');
    const emptyText = read.kind === 'missing'
      ? CONFLICTS_UNKNOWN_NOTE
      : read.kind === 'malformed' ? CONFLICTS_MALFORMED_NOTE : CONFLICTS_EMPTY_NOTE;
    return this.sectionShell({
      role: group.role,
      section: 'conflicts',
      title: '现场冲突',
      body: {html: chunks, totalRows},
      fullText,
      emptyText,
    });
  }

  /**
   * 节外壳：标题 + 行块 + 完整列表进 title + 空态文字 + 截断入口。
   * 截断口径统一按 `body.totalRows`：> MAX_VISIBLE_ROWS 时折叠态出「等 N 条」与
   * 「查看全部 N 条」按钮（真按钮，文字自带、窄屏同样可用，不依赖 title），展开态出「收起」。
   * 折叠态是否真的隐藏了行由调用方按同一预算切块决定（visibleRowChunks / clusterChunks）。
   */
  private sectionShell(spec: SectionSpec): string {
    const expanded = this.isExpanded(spec.role, spec.section);
    const truncated = spec.body.totalRows > MAX_VISIBLE_ROWS;
    const more = truncated && !expanded
      ? `<div class="rw-more" style="color:#9aa4b2;font-size:11px;">等 ${spec.body.totalRows} 条</div>`
      : '';
    const toggle = truncated
      ? `<button type="button" class="rw-more-toggle" data-rw-toggle="${escapeHtml(`${spec.role}|${spec.section}`)}" data-expanded="${expanded}" aria-expanded="${expanded}" style="margin-top:2px;padding:2px 8px;border-radius:6px;border:1px solid rgba(111,168,220,.5);background:rgba(111,168,220,.12);color:#cfe1f5;font-size:11px;cursor:pointer;">${expanded ? '收起' : `查看全部 ${spec.body.totalRows} 条`}</button>`
      : '';
    const rows = spec.body.html.length
      ? spec.body.html.join('')
      : `<div class="rw-section-empty" style="color:#9aa4b2;font-size:11px;">${escapeHtml(spec.emptyText)}</div>`;
    return `<div class="rw-section" data-section="${spec.section}" title="${escapeHtml(spec.fullText)}" style="margin-bottom:8px;">
      <div class="rw-section-title" style="margin-bottom:3px;color:#c9cfe0;font-size:11px;font-weight:600;">${escapeHtml(spec.title)}</div>
      ${rows}${more}${toggle}
    </div>`;
  }

  // ─── 截断入口（Codex 二审 major）─────────────────────────────────────────

  private isExpanded(role: string, section: string): boolean {
    return this.expandedSections.has(`${role}|${section}`);
  }

  private toggleSection(key: string): void {
    if (this.expandedSections.has(key)) this.expandedSections.delete(key);
    else this.expandedSections.add(key);
  }

  /** 折叠态切前 MAX_VISIBLE_ROWS 行；展开态全量。 */
  private visibleRowChunks(role: string, section: string, rows: string[]): string[] {
    return this.isExpanded(role, section) ? rows : rows.slice(0, MAX_VISIBLE_ROWS);
  }

  /**
   * 冲突节按 SCH 行预算切块（折叠 = MAX_VISIBLE_ROWS 行；展开 = budget 无穷）。
   * 预算用尽后的簇整块不渲染（只出「等 N 条」与按钮，不出一排没有行的空徽标）；
   * 报告中真的点名了、却在 coordination 索引里解析不到的簇仍出徽标（见 renderCluster）。
   */
  private clusterChunks(clusters: ConflictCluster[], narrow: boolean, budget: number): string[] {
    const chunks: string[] = [];
    let shown = 0;
    for (const cluster of clusters) {
      const visible = shown < budget ? cluster.members.slice(0, budget - shown) : [];
      shown += visible.length;
      if (visible.length === 0 && cluster.members.length > 0) continue;
      chunks.push(this.renderCluster(cluster, visible, narrow));
    }
    return chunks;
  }

  private renderCluster(cluster: ConflictCluster, visible: CoordinationRow[], narrow: boolean): string {
    const color = cluster.level === 'conflict' ? CONFLICT_COLOR : POTENTIAL_COLOR;
    // 两类差额都显形（徽标按报告规模，不静默缩水）：① 成员编号非法（报告形状坏）
    // ② 编号合法但本快照 coordination 里没有条目（快照自相矛盾）。
    const unresolved = Math.max(0, cluster.size - cluster.invalidMembers - cluster.members.length);
    const notes: string[] = [];
    if (cluster.invalidMembers > 0) {
      notes.push(`该簇点名的 ${cluster.size} 条 SCH 里有 ${cluster.invalidMembers} 条成员编号非法，已跳过（快照版本不符）`);
    }
    if (unresolved > 0) {
      notes.push(`另有 ${unresolved} 条在本快照 coordination 里没有条目（快照版本不符）`);
    }
    const note = notes.length > 0
      ? `<div class="rw-cluster-note" style="color:#9aa4b2;font-size:10px;">${notes.join('；')}</div>`
      : '';
    const members = visible.map((member) => this.renderConflictRow(member, cluster, narrow)).join('');
    return `<div class="rw-cluster" data-level="${cluster.level}" style="margin-bottom:6px;">
      <div class="rw-badge" data-level="${cluster.level}" style="margin-bottom:3px;font-size:11px;font-weight:600;">${dot(color)}<span class="rw-badge-label">${escapeHtml(cluster.badge)}（${cluster.size} 条）</span> <span class="rw-badge-reason">${escapeHtml(cluster.reason)}</span></div>
      ${note}${members}
    </div>`;
  }

  // ─── 行 ──────────────────────────────────────────────────────────────────

  private isActive(packageId: string, checkId: string | null): boolean {
    const current = this.selection.get();
    return current.packageId === packageId && current.checkId === checkId;
  }

  private rowShell(className: string, dataset: string, hover: string, active: boolean, narrow: boolean, inner: string): string {
    return `<div class="rw-row ${className}" ${dataset} data-active="${active}" title="${escapeHtml(hover)}"
      style="display:${narrow ? 'block' : 'flex'};gap:8px;align-items:${narrow ? 'stretch' : 'center'};padding:5px 8px;margin-bottom:4px;border-radius:6px;border:1px solid ${active ? ACTIVE_BORDER : 'rgba(255,255,255,.12)'};background:${active ? 'rgba(111,168,220,.14)' : 'rgba(255,255,255,.02)'};font-size:12px;cursor:pointer;overflow-wrap:break-word;">${inner}</div>`;
  }

  private checkRowText(row: CheckTodoRow): string {
    const status = row.check.audit_status ?? '未登记';
    return `${row.pkg.id} ${row.pkg.name ?? row.pkg.id}｜${row.check.id} ${row.check.item}｜登记状态 ${status}${row.notes.length ? `｜${row.notes.join('；')}` : ''}`;
  }

  private renderCheckRow(row: CheckTodoRow, narrow: boolean): string {
    const status = row.check.audit_status ?? '未登记';
    const notes = row.notes.length
      ? `<span class="rw-unblocks" style="margin-left:6px;color:#f4dfa8;font-size:11px;">${escapeHtml(row.notes.join('；'))}</span>`
      : '';
    const hover = [
      `${row.pkg.id} ${row.pkg.name ?? row.pkg.id}`,
      `检查 ${row.check.id}：${row.check.item}`,
      `登记状态：${status}${row.check.audit_status ? '' : '（没有审计记录）'}`,
      `包状态：${row.pkg.effective_status ?? '—'}`,
      ...(row.notes.length ? [`next_actions：${row.notes.join('；')}（只解释不计算）`] : []),
    ].join('\n');
    const main = `<div class="rw-row-main" style="flex:1 1 auto;min-width:0;">
        <strong>${escapeHtml(row.pkg.id)}</strong>
        <span style="margin-left:6px;">${escapeHtml(row.pkg.name ?? row.pkg.id)}</span>
        <span style="margin-left:6px;color:#d8d8e4;">${escapeHtml(row.check.item)}</span>${notes}
        <div style="color:#9aa4b2;font-size:10px;line-height:1.4;">${escapeHtml(row.check.id)}｜${row.check.source === 'acceptance' ? '引用验收' : '包内检查'}</div>
      </div>`;
    const meta = `<div class="rw-row-meta" style="flex:0 0 auto;${narrow ? 'margin-top:2px;' : ''}color:#c9cfe0;font-size:11px;white-space:nowrap;">${dot(colorOf(AUDIT_STATUS_COLOR, row.check.audit_status))}${escapeHtml(status)}</div>`;
    return this.rowShell(
      'rw-check-row',
      `data-pkg-id="${escapeHtml(row.pkg.id)}" data-check-id="${escapeHtml(row.check.id)}"`,
      hover,
      this.isActive(row.pkg.id, row.check.id),
      narrow,
      `${main}${meta}`,
    );
  }

  private coordRowText(row: CoordinationRow): string {
    return `${row.schId} ${row.packageName}｜${labelOf(MODE_LABEL, row.entry.mode)}｜${labelOf(COORD_STATUS_LABEL, row.entry.status)}｜提前 ${row.entry.lead_time_workdays} 个工作日｜${this.actorText(row.entry)}｜升级路径：${row.entry.escalation || '—'}`;
  }

  /** actor 文字：name 为 null →「待指定」（严禁造人名）；org 有声明才带出。 */
  private actorText(entry: ScheduleCoordinationView): string {
    const name = entry.actor?.name ?? null;
    if (!name) {
      const org = entry.actor?.org ?? null;
      return org ? `参与人：待指定（单位：${org}）` : '参与人：待指定';
    }
    const org = entry.actor?.org ?? null;
    return org ? `参与人：${name}（${org}）` : `参与人：${name}`;
  }

  private renderCoordRow(row: CoordinationRow, narrow: boolean): string {
    const entry = row.entry;
    const mode = entry.mode;
    const chip = `<span class="rw-mode-chip" data-mode="${escapeHtml(mode)}" style="display:inline-block;padding:0 6px;margin-right:6px;border-radius:8px;border:1px solid rgba(255,255,255,.22);font-size:11px;">${dot(colorOf(MODE_COLOR, mode))}${escapeHtml(labelOf(MODE_LABEL, mode))}</span>`;
    const statusLabel = labelOf(COORD_STATUS_LABEL, entry.status);
    const metaText = `${statusLabel}｜提前 ${entry.lead_time_workdays} 个工作日｜${this.actorText(entry)}`;
    const hover = [
      `${row.schId} ${row.packageName}`,
      `方式：${labelOf(MODE_LABEL, mode)}（${mode}）`,
      `状态：${statusLabel}（${entry.status}）`,
      `提前量：${entry.lead_time_workdays} 个工作日`,
      this.actorText(entry),
      `升级路径：${entry.escalation || '—'}`,
    ].join('\n');
    const main = `<div class="rw-row-main" style="flex:1 1 auto;min-width:0;">
        ${chip}<strong>${escapeHtml(row.schId)}</strong>
        <span style="margin-left:6px;color:#9aa4b2;">${escapeHtml(row.packageName)}</span>
      </div>`;
    const meta = `<div class="rw-row-meta" style="flex:0 0 auto;${narrow ? 'margin-top:2px;' : ''}color:#c9cfe0;font-size:11px;">
        <span style="white-space:nowrap;">${dot(colorOf(COORD_STATUS_COLOR, entry.status))}${escapeHtml(metaText)}</span>
        <div style="color:#9aa4b2;font-size:10px;line-height:1.5;">升级路径：${escapeHtml(entry.escalation || '—')}</div>
      </div>`;
    return this.rowShell(
      'rw-coord-row',
      `data-pkg-id="${escapeHtml(entry.package_id)}" data-sch-id="${escapeHtml(row.schId)}"`,
      hover,
      this.isActive(entry.package_id, row.schId),
      narrow,
      `${main}${meta}`,
    );
  }

  private renderConflictRow(row: CoordinationRow, cluster: ConflictCluster, narrow: boolean): string {
    const entry = row.entry;
    const mode = entry.mode;
    const statusLabel = labelOf(COORD_STATUS_LABEL, entry.status);
    // 冲突簇带确认登记日（证据日期，原样）；潜在簇的窗口信息在服务端 reason 原文里，
    // 面板不再自算窗口（windowOf 与整条面板侧分类一起删除）。
    const extra = cluster.level === 'conflict' ? `确认登记日 ${entry.confirmed_at ?? '—'}` : '';
    const hover = [
      `${cluster.badge}｜${row.schId} ${row.packageName}`,
      `方式：${labelOf(MODE_LABEL, mode)}（${mode}）`,
      `状态：${statusLabel}（${entry.status}）`,
      ...(extra ? [extra] : []),
      `判定依据（服务端原文）：${cluster.reason}`,
      `提前量：${entry.lead_time_workdays} 个工作日`,
      this.actorText(entry),
    ].join('\n');
    const main = `<div class="rw-row-main" style="flex:1 1 auto;min-width:0;">
        <span class="rw-mode-chip" data-mode="${escapeHtml(mode)}" style="display:inline-block;padding:0 6px;margin-right:6px;border-radius:8px;border:1px solid rgba(255,255,255,.22);font-size:11px;">${dot(colorOf(MODE_COLOR, mode))}${escapeHtml(labelOf(MODE_LABEL, mode))}</span>
        <strong>${escapeHtml(row.schId)}</strong>
        <span style="margin-left:6px;color:#9aa4b2;">${escapeHtml(row.packageName)}</span>
      </div>`;
    const meta = `<div class="rw-row-meta" style="flex:0 0 auto;${narrow ? 'margin-top:2px;' : ''}color:#c9cfe0;font-size:11px;white-space:nowrap;">${dot(colorOf(COORD_STATUS_COLOR, entry.status))}${escapeHtml(statusLabel)}${extra ? `｜${escapeHtml(extra)}` : ''}</div>`;
    return this.rowShell(
      'rw-conflict-row',
      `data-pkg-id="${escapeHtml(entry.package_id)}" data-sch-id="${escapeHtml(row.schId)}"`,
      hover,
      this.isActive(entry.package_id, row.schId),
      narrow,
      `${main}${meta}`,
    );
  }

  // ─── 事件 ────────────────────────────────────────────────────────────────

  private bind(body: HTMLElement): void {
    for (const row of Array.from(body.querySelectorAll('.rw-row[data-pkg-id]'))) {
      row.addEventListener('click', () => {
        const element = row as HTMLElement;
        const packageId = element.dataset.pkgId ?? '';
        if (!packageId) return;
        // D5：只写共享选中态。检查行 checkId = check.id；协调/冲突行 checkId = SCH id
        // （coordination 的键）。不调 onHighlight、不展开 scope。
        const checkId = element.dataset.checkId ?? element.dataset.schId ?? null;
        this.selection.set({packageId, checkId});
        this.render();
      });
    }
    // 截断入口（Codex 二审 major）：展开/收起只改本地展开态再重渲——不写选中、不碰快照。
    for (const toggle of Array.from(body.querySelectorAll('button[data-rw-toggle]'))) {
      toggle.addEventListener('click', (event) => {
        // 按钮不在行内；stopPropagation 只是保险，防止将来把入口塞进可点行里。
        event.stopPropagation();
        const key = (toggle as HTMLElement).dataset.rwToggle ?? '';
        if (!key) return;
        this.toggleSection(key);
        this.render();
      });
    }
  }

  // ─── 容器宽度（≤700px 退化）─────────────────────────────────────────────

  /** 面板内容区实测宽（jsdom 不做布局，clientWidth 恒 0 → 按宽容器）。 */
  private availableWidth(): number {
    const body = this.el?.querySelector('#role-workbench-body') as HTMLElement | null;
    return body?.clientWidth ?? 0;
  }

  private isNarrowContainer(): boolean {
    const available = this.availableWidth();
    return available > 0 && available <= NARROW_MAX_PX;
  }

  private layoutKeyOf(): string {
    if (!this.isNarrowContainer()) return 'wide';
    return `narrow:${this.availableWidth()}`;
  }

  /** 容器尺寸变化（旋转 / 分屏 / 窗口缩放）：布局键变了才重渲，不逐像素重画。 */
  private onContainerResize(): void {
    if (this.layoutKeyOf() === this.layoutKey) return;
    if (this.visible && this.payload) this.render();
  }

  // ─── 骨架 ────────────────────────────────────────────────────────────────

  private build(): void {
    const el = document.createElement('div');
    el.id = 'role-workbench-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none;
    `;
    el.innerHTML = `
      <div class="dynamic-panel-heading">
        <strong>角色工作台</strong>
        <button id="role-workbench-panel-toggle" class="panel-collapse-toggle" type="button" aria-controls="role-workbench-panel-content" aria-expanded="true" aria-label="角色工作台面板折叠" title="折叠">−</button>
      </div>
      <div id="role-workbench-panel-content">
        <div id="role-workbench-body"></div>
      </div>
    `;
    // 路由级独立页：挂到审批页容器（测试只提供挂载点，照 GanttPanel）。
    const stack = document.getElementById('approval-page-panels');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#role-workbench-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#role-workbench-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);
    const body = el.querySelector('#role-workbench-body') as HTMLElement | null;
    if (body && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.onContainerResize());
      observer.observe(body);
      this.resizeObserver = observer;
    }
    this.el = el;
  }
}
