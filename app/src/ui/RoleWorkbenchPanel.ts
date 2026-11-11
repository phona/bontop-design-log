// 自装审批「角色工作台」面板（2026-11-11 issue #202 S3，设计 §7 / §2.1(c) / §16.4 / §17.4）。
//
// 数据只有一个来源：`GET /api/schedule/state` 的同一个快照——
//  - `snapshot.packages[]`：包名/sequence/owner_roles/checks（待办检查的来源）；
//  - `snapshot.coordination`（可选键，Record<SCH id, ScheduleCoordinationView>）：
//    待确认协调与现场冲突的来源（稀疏：没有 coordination 块的 SCH 不出现，不造空对象）；
//  - `snapshot.next_actions[]`：只把 unblocks 数作为行内注释带在待办行上（只解释不计算）；
//  - `snapshot.schedule`（可选键）：仅用于潜在窗口（packages[pkg].forecast 的
//    [start_ord, end_ord_max] 闭区间）。
// 本面板**不 import** `shared/schedule-projection.ts`（投影唯一实现在服务端，浏览器只渲染
// 快照，设计 D4）；不另读 control.yaml；不拉其他端点；不调 onHighlight、不做 scope 展开
// （D5：点行只写 selection.set({packageId, checkId})，定位的唯一使用者仍是 ScheduleDetailPanel）。
//
// 渲染口径（任务书 §1.1 + §1.4）：
//  - 按角色分组（角色集合 = 各包 owner_roles ∪ 各 coordination 的 required_roles ∪ owner_role，
//    按 `<`/`>` 字典序排——localeCompare 环境相关，禁用）；
//  - 每组三节顺序固定：待办检查 → 待确认协调 → 现场冲突；
//  - 待办检查只列未完成（audit_status 为 passed/waived 算已完成，其余含 undefined 算待办），
//    状态文字**原样**显示 audit_status 或「未登记」——不把派生值翻译成看起来像声明值的词；
//  - 待确认协调只列 status ∈ {unassigned, pending_invite, invited} 且角色相关的条目；
//    actor.name 为 null 显「待指定」，严禁造人名；
//  - 现场冲突两级口径（§1.4）：cancelled 排除；mode !== 'onsite' 排除；冲突 = 同角色 ≥2 条
//    onsite 且都已确认且 confirmed_at 同日；潜在 = 同角色 ≥2 条 onsite 且都未确认且 forecast
//    窗口闭区间重叠；confirmed + 未确认混合两者都不出；snapshot.schedule 缺失时不出潜在
//    徽标，只出文字「缺排程投影，潜在窗口无法判断」；
//  - 颜色旁必须始终有文字（状态点/mode chip/冲突徽标一律「色块 + 中文」），颜色只来自下面的
//    固定映射表，禁止把 payload 字符串当颜色用；
//  - 每节行数上限 MAX_VISIBLE_ROWS，超出「等 N 条」，完整列表进 title 属性；
//  - 空态有明确文字（无快照 / 取数失败 / 无角色 / 无待办），不渲染空骨架；
//    coordination 缺失或为空时**不置空整面板**——待办检查只依赖 packages，照常渲染，
//    协调两节出节级空文案；
//  - ≤700px（NARROW_MAX_PX，与 style.css 的 @media 断点同源）单列退化：工作台本就是列表，
//    窄屏只放宽布局约束，不建第二套布局；
//  - 只读快照：渲染前后不改写 snapshot.coordination / snapshot.schedule 任何数组/对象
//    （不 sort/splice/赋值；排序只做副本）。测试钉住逐字节不变。
import type {
  NextActionItem,
  ScheduleCheckView,
  ScheduleCoordinationView,
  SchedulePackageView,
  ScheduleProjectionView,
  ScheduleSnapshot,
} from '@shared/schedule-state';
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

/** 两级冲突徽标文字（§1.4：必须写清是哪一级）。 */
const CONFLICT_BADGE = '冲突：同日双现场';
const POTENTIAL_BADGE = '潜在：窗口重叠（未确认）';
const CONFLICT_COLOR = '#d9534f';
const POTENTIAL_COLOR = '#e9c46a';
const NEUTRAL_COLOR = '#8a93a3';

const SCHEDULE_MISSING_NOTE = '缺排程投影，潜在窗口无法判断';
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

/** 已确认 = 声明 confirmed 且带 confirmed_at（缺一视为未确认，fail-closed）。 */
function isConfirmed(entry: ScheduleCoordinationView): boolean {
  return entry.status === 'confirmed' && !!entry.confirmed_at;
}

/** confirmed_at 同日：取日期前缀（ISO 日期/日期时间同口径）。 */
function dayOf(confirmedAt: string): string {
  return confirmedAt.slice(0, 10);
}

/** 角色与一条 coordination 的相关性：必填角色之一或责任角色（§1.1/§1.4 同一 membership）。 */
function belongsToRole(entry: ScheduleCoordinationView, role: string): boolean {
  return (Array.isArray(entry.required_roles) ? entry.required_roles : []).includes(role)
    || entry.owner_role === role;
}

/** 潜在窗口（只读 snapshot.schedule；包不在投影里 = 窗口未知，回 null 不进重叠判定）。 */
function windowOf(schedule: ScheduleProjectionView, packageId: string): {start: number; end: number} | null {
  const forecast = schedule.packages?.[packageId]?.forecast;
  if (!forecast || typeof forecast.start_ord !== 'number' || typeof forecast.end_ord_max !== 'number') return null;
  return {start: forecast.start_ord, end: forecast.end_ord_max};
}

/** 闭区间相交（§1.4：潜在 = 窗口重叠）。 */
function windowsOverlap(left: {start: number; end: number}, right: {start: number; end: number}): boolean {
  return left.start <= right.end && right.start <= left.end;
}

interface WindowedEntry {
  schId: string;
  entry: ScheduleCoordinationView;
  window: {start: number; end: number};
}

/**
 * 重叠连通分量（§1.4 的一般化）：两两闭区间相交即并簇；规模 ≥2 的分量出潜在徽标。
 * 链式重叠（A-B、B-C 而 A-C 不相交）会并成一簇——fail-loud：宁可多标潜在，不漏标。
 */
function overlapComponents(items: WindowedEntry[]): WindowedEntry[][] {
  const parent = items.map((_item, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]!]!;
      cursor = parent[cursor]!;
    }
    return cursor;
  };
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      if (windowsOverlap(items[left]!.window, items[right]!.window)) parent[find(left)] = find(right);
    }
  }
  const clusters = new Map<number, WindowedEntry[]>();
  items.forEach((item, index) => {
    const root = find(index);
    const bucket = clusters.get(root) ?? [];
    bucket.push(item);
    clusters.set(root, bucket);
  });
  return [...clusters.values()];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
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

interface ConflictCluster {
  level: 'conflict' | 'potential';
  badge: string;
  detail: string;
  members: CoordinationRow[];
}

interface RoleGroup {
  role: string;
  checks: CheckTodoRow[];
  coordinations: CoordinationRow[];
  clusters: ConflictCluster[];
  /** 有 ≥2 条未确认 onsite 但快照缺 schedule：潜在窗口无法判断。 */
  scheduleMissingNote: boolean;
  /** coordination 键缺失/为空：协调两节出节级空文案，待办检查照常（不置空整面板）。 */
  coordinationMissing: boolean;
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

  private buildGroups(): {groups: RoleGroup[]; coordinationMissing: boolean} {
    const snapshot = this.payload;
    if (!snapshot) return {groups: [], coordinationMissing: false};
    // coordination 缺失或为空：**不把整面板置空**——待办检查只依赖 packages，降级时仍要可用；
    // 协调两节出节级空文案（§1.1：不渲染空列表 = 不出无解释的空节，不是删掉有用的分组）。
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

    // 角色集合 = owner_roles ∪ required_roles ∪ owner_role；排序只做副本（Set 迭代序不稳定）。
    const roles = new Set<string>();
    for (const pkg of packages) {
      for (const role of Array.isArray(pkg.owner_roles) ? pkg.owner_roles : []) roles.add(role);
    }
    const coordEntries: Array<[string, ScheduleCoordinationView]> = [];
    for (const [schId, entry] of Object.entries(coordination)) {
      coordEntries.push([schId, entry]);
      for (const role of Array.isArray(entry.required_roles) ? entry.required_roles : []) roles.add(role);
      roles.add(entry.owner_role);
    }
    coordEntries.sort(([left], [right]) => compareRaw(left, right));

    const schedule = snapshot.schedule;
    const rowOf = (schId: string, entry: ScheduleCoordinationView): CoordinationRow =>
      ({schId, entry, packageName: packageName.get(entry.package_id) ?? entry.package_id});

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

      // ② 待确认协调：三态入场 + 角色相关。
      const coordinations: CoordinationRow[] = [];
      for (const [schId, entry] of coordEntries) {
        if (!PENDING_COORD_STATUSES.has(entry.status)) continue;
        if (!belongsToRole(entry, role)) continue;
        coordinations.push(rowOf(schId, entry));
      }

      // ③ 现场冲突（§1.4 两级口径）：先排除 cancelled 与非 onsite，再分冲突/潜在。
      const onsite = coordEntries.filter(([, entry]) =>
        entry.mode === 'onsite' && entry.status !== 'cancelled' && belongsToRole(entry, role));
      const clusters: ConflictCluster[] = [];

      // 冲突：同角色 ≥2 条 onsite 且都已确认且 confirmed_at 同日（按日分组，规模 ≥2 出簇）。
      const confirmedByDay = new Map<string, CoordinationRow[]>();
      for (const [schId, entry] of onsite) {
        if (!isConfirmed(entry) || !entry.confirmed_at) continue;
        const day = dayOf(entry.confirmed_at);
        const bucket = confirmedByDay.get(day) ?? [];
        bucket.push(rowOf(schId, entry));
        confirmedByDay.set(day, bucket);
      }
      for (const [day, members] of [...confirmedByDay.entries()].sort(([left], [right]) => compareRaw(left, right))) {
        if (members.length < 2) continue;
        clusters.push({level: 'conflict', badge: CONFLICT_BADGE, detail: `${members.length} 条｜同日 ${day}`, members});
      }

      // 潜在：同角色 ≥2 条 onsite 且都未确认且 forecast 窗口重叠（confirmed 不进潜在）。
      const unconfirmed = onsite.filter(([, entry]) => !isConfirmed(entry));
      const scheduleMissingNote = !schedule && unconfirmed.length >= 2;
      if (schedule && unconfirmed.length >= 2) {
        const windowed: WindowedEntry[] = [];
        for (const [schId, entry] of unconfirmed) {
          const window = windowOf(schedule, entry.package_id);
          if (window) windowed.push({schId, entry, window});
        }
        for (const component of overlapComponents(windowed)) {
          if (component.length < 2) continue;
          const members = component.map((item) => rowOf(item.schId, item.entry));
          const start = Math.min(...component.map((item) => item.window.start));
          const end = Math.max(...component.map((item) => item.window.end));
          clusters.push({level: 'potential', badge: POTENTIAL_BADGE, detail: `${members.length} 条｜第 ${start}–第 ${end} 工作日`, members});
        }
      }

      return {role, checks, coordinations, clusters, scheduleMissingNote, coordinationMissing};
    });
    return {groups, coordinationMissing};
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
    let content: string;
    if (!this.payload) {
      content = this.emptyBox('未取得角色工作台数据（/api/schedule/state 尚未返回或取数失败）：本面板不渲染来自坏快照的分组。');
    } else if (built.groups.length === 0) {
      content = this.emptyBox('快照里汇总不出任何角色（packages 的 owner_roles 与 coordination 的 required_roles/owner_role 均为空）：本面板不渲染空分组。');
    } else {
      content = this.renderGroups(built.groups);
    }

    body.innerHTML = `${error}${pilot}${content}`;
    this.bind(body);
    this.layoutKey = this.layoutKeyOf();
  }

  private emptyBox(text: string): string {
    return `<div id="rw-empty" style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">${escapeHtml(text)}</div>`;
  }

  private renderGroups(groups: RoleGroup[]): string {
    const narrow = this.isNarrowContainer();
    const totalChecks = groups.reduce((sum, group) => sum + group.checks.length, 0);
    const totalCoord = groups.reduce((sum, group) => sum + group.coordinations.length, 0);
    const conflictClusters = groups.reduce((sum, group) => sum + group.clusters.filter((cluster) => cluster.level === 'conflict').length, 0);
    const potentialClusters = groups.reduce((sum, group) => sum + group.clusters.filter((cluster) => cluster.level === 'potential').length, 0);

    const head = `<div id="rw-head" style="margin-bottom:8px;color:#9aa4b2;font-size:11px;line-height:1.7;">
      共 ${groups.length} 个角色｜待办检查 ${totalChecks} 项｜待确认协调 ${totalCoord} 项｜冲突 ${conflictClusters} 簇／潜在 ${potentialClusters} 簇
      <br>数据只读自 <code>/api/schedule/state</code>（packages / coordination / next_actions / schedule 四个键）；点行只写共享选中态，不做 3D 高亮、不改任何配置——写路径一律走 PR。
    </div>`;
    const narrowNote = narrow
      ? `<div style="margin-bottom:6px;color:#7d8698;font-size:10px;">窄屏（≤${NARROW_MAX_PX}px）：单列列表（工作台本就是列表，只放宽布局约束）。</div>`
      : '';
    const roles = groups.map((group) => this.renderRoleGroup(group, narrow)).join('');
    return `<div id="rw-groups" data-rw-narrow="${narrow}">${head}${narrowNote}${roles}</div>`;
  }

  private renderRoleGroup(group: RoleGroup, narrow: boolean): string {
    return `<div class="rw-role" data-role="${escapeHtml(group.role)}" style="margin-bottom:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(255,255,255,.03);">
      <div class="rw-role-head" style="margin-bottom:6px;font-size:13px;"><strong>角色：${escapeHtml(group.role)}</strong></div>
      ${this.renderCheckSection(group, narrow)}
      ${this.renderCoordSection(group, narrow)}
      ${this.renderConflictSection(group, narrow)}
    </div>`;
  }

  // ─── 三节 ────────────────────────────────────────────────────────────────

  private renderCheckSection(group: RoleGroup, narrow: boolean): string {
    const rows = group.checks.map((row) => this.renderCheckRow(row, narrow));
    const fullText = group.checks.map((row) => this.checkRowText(row)).join('\n');
    return this.sectionShell('checks', `待办检查（${group.checks.length}）`, rows, fullText,
      group.checks.length === 0 ? '没有待办（该角色名下没有未完成检查）' : '');
  }

  private renderCoordSection(group: RoleGroup, narrow: boolean): string {
    const rows = group.coordinations.map((row) => this.renderCoordRow(row, narrow));
    const fullText = group.coordinations.map((row) => this.coordRowText(row)).join('\n');
    // coordination 键缺失/为空：节级空文案（待办检查不受影响，见 buildGroups）。
    const empty = group.coordinationMissing
      ? '没有协调数据（coordination 键缺失/为空）：本节列不出条目；试点只登记确有协调动作的 SCH'
      : group.coordinations.length === 0 ? '没有待确认协调（该角色名下没有待邀请/待确认条目）' : '';
    return this.sectionShell('coordination', `待确认协调（${group.coordinations.length}）`, rows, fullText, empty);
  }

  private renderConflictSection(group: RoleGroup, narrow: boolean): string {
    // 行数上限按 SCH 行计：簇头只在有可见成员时渲染，被截断的簇整体进 title 全量。
    const fullText: string[] = [];
    let total = 0;
    let shown = 0;
    const clusterHtml: string[] = [];
    for (const cluster of group.clusters) {
      total += cluster.members.length;
      const visible = shown < MAX_VISIBLE_ROWS ? cluster.members.slice(0, MAX_VISIBLE_ROWS - shown) : [];
      shown += visible.length;
      for (const member of cluster.members) fullText.push(`${cluster.badge}｜${this.coordRowText(member)}`);
      if (visible.length === 0) continue;
      const badgeColor = cluster.level === 'conflict' ? CONFLICT_COLOR : POTENTIAL_COLOR;
      const members = visible.map((member) => this.renderConflictRow(member, cluster, narrow)).join('');
      clusterHtml.push(`<div class="rw-cluster" data-level="${cluster.level}" style="margin-bottom:6px;">
        <div class="rw-badge" data-level="${cluster.level}" style="margin-bottom:3px;font-size:11px;font-weight:600;">${dot(badgeColor)}${escapeHtml(cluster.badge)}（${escapeHtml(cluster.detail)}）</div>
        ${members}
      </div>`);
    }
    // 缺排程投影：潜在窗口无法判断（§1.4）——只有当该角色真有 ≥2 条未确认 onsite 时才出。
    const scheduleNote = group.scheduleMissingNote
      ? `<div class="rw-schedule-note" style="margin-bottom:4px;color:#f4dfa8;font-size:11px;">${escapeHtml(SCHEDULE_MISSING_NOTE)}</div>`
      : '';
    const empty = group.coordinationMissing
      ? '没有协调数据（coordination 键缺失/为空）：现场冲突无法判断'
      : group.clusters.length === 0 ? '没有现场冲突（该角色名下没有同日双现场或窗口重叠）' : '';
    // 截断提示按 SCH 行数计（簇内已在上面切好）；moreText 覆盖 sectionShell 的按行数组口径。
    const moreText = total > shown ? `<div class="rw-more" style="color:#9aa4b2;font-size:11px;">等 ${total} 条</div>` : '';
    // extra（缺排程投影提示）渲染在节标题之前：它解释的是「为什么没有潜在徽标」。
    return this.sectionShell('conflicts', '现场冲突', clusterHtml, fullText.join('\n'), empty, scheduleNote, moreText);
  }

  /**
   * 节外壳：extra + 标题 + 行列表 + 完整列表进 title + 空态文字。
   * moreText：冲突节按 SCH 行数自算截断提示（行数组里装的是簇，不是行）；其余两节传 undefined，
   * 由行数组长度算（超过 MAX_VISIBLE_ROWS 出「等 N 条」）。
   */
  private sectionShell(
    section: string,
    title: string,
    rows: string[],
    fullText: string,
    emptyText: string,
    extra = '',
    moreText?: string,
  ): string {
    const shown = rows.slice(0, MAX_VISIBLE_ROWS);
    const more = moreText
      ?? (rows.length > shown.length ? `<div class="rw-more" style="color:#9aa4b2;font-size:11px;">等 ${rows.length} 条</div>` : '');
    const body = shown.length ? shown.join('') : `<div class="rw-section-empty" style="color:#9aa4b2;font-size:11px;">${escapeHtml(emptyText)}</div>`;
    return `<div class="rw-section" data-section="${section}" title="${escapeHtml(fullText)}" style="margin-bottom:8px;">
      ${extra}<div class="rw-section-title" style="margin-bottom:3px;color:#c9cfe0;font-size:11px;font-weight:600;">${escapeHtml(title)}</div>
      ${body}${more}
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
    // 冲突簇带确认登记日（证据日期，原样）；潜在簇带 forecast 窗口（第 N–第 M 工作日）。
    let extra: string;
    if (cluster.level === 'conflict') {
      extra = `确认登记日 ${entry.confirmed_at ?? '—'}`;
    } else {
      const window = this.payload?.schedule ? windowOf(this.payload.schedule, entry.package_id) : null;
      extra = window ? `窗口 第 ${window.start}–第 ${window.end} 工作日` : '窗口未知';
    }
    const hover = [
      `${cluster.badge}｜${row.schId} ${row.packageName}`,
      `方式：${labelOf(MODE_LABEL, mode)}（${mode}）`,
      `状态：${statusLabel}（${entry.status}）`,
      extra,
      `提前量：${entry.lead_time_workdays} 个工作日`,
      this.actorText(entry),
    ].join('\n');
    const main = `<div class="rw-row-main" style="flex:1 1 auto;min-width:0;">
        <span class="rw-mode-chip" data-mode="${escapeHtml(mode)}" style="display:inline-block;padding:0 6px;margin-right:6px;border-radius:8px;border:1px solid rgba(255,255,255,.22);font-size:11px;">${dot(colorOf(MODE_COLOR, mode))}${escapeHtml(labelOf(MODE_LABEL, mode))}</span>
        <strong>${escapeHtml(row.schId)}</strong>
        <span style="margin-left:6px;color:#9aa4b2;">${escapeHtml(row.packageName)}</span>
      </div>`;
    const meta = `<div class="rw-row-meta" style="flex:0 0 auto;${narrow ? 'margin-top:2px;' : ''}color:#c9cfe0;font-size:11px;white-space:nowrap;">${dot(colorOf(COORD_STATUS_COLOR, entry.status))}${escapeHtml(statusLabel)}｜${escapeHtml(extra)}</div>`;
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
