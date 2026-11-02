// 自装审批「包详情」面板（自装交互审批第一步，2026-11-02，设计稿 §6/§8）。
//
// 职责：把共享选中态（ScheduleSelectionStore）里的那个包摊开讲清楚——头部状态、
// 阻塞项、预算行、逐项检查表，再加一段「这个包在 3D 里覆盖什么」。
//
// 两个数据来源，都是只读：
//  1. `GET /api/schedule/state`——包的结构化投影（与 verify:schedule 同一 loader）；
//  2. `GET /api/project?phase=full`——房间与场景对象，供 resolvePackageScope
//     （shared/package-scope.ts，值导入、浏览器安全）把 modelPackageLinks 的选择器
//     展开成「房间 N 个 / 对象 M 个」。**面板不自己算 3D 范围**：选择器语义只有
//     shared 那一份实现，浏览器里出现第二套必然漂移。
//
// 铁律落实：
//  - 点检查行只写选中态（selection.set({checkId})），不产生任何配置写入；
//  - 「在 3D 中高亮」按钮依赖外部接线（options.onHighlight）；没接线时按钮禁用
//    并写明原因，不留一个点了没反应的按钮；
//  - 3D 段取数失败只让该段显示「3D 作用域暂不可用」，不拖垮其余渲染；
//  - 所有插值 escapeHtml，指纹只显示前 12 位（完整值在 config 与服务端）。
import type { ScheduleSnapshot, SchedulePackageView, ScheduleCheckView } from '@shared/schedule-state';
import type { ScheduleSelectionStore } from '../state/schedule-selection.js';
import { setupCollapsiblePanel } from './CollapsiblePanel.js';
import { escapeHtml } from './escape-html.js';
import { resolvePackageScope } from '@shared/package-scope';
import type { PackageScopeLink, ProjectScopeInput } from '@shared/package-scope';

export interface ScheduleDetailPanelOptions {
  /** 点「在 3D 中高亮」时通知外部（App 接 HouseScene）。缺省时按钮禁用并注明。 */
  onHighlight?: (packageId: string) => void;
}

interface ModelPackageLink extends PackageScopeLink {
  budget_ref?: {id?: string};
}

/** /api/project?phase=full 里本面板用到的部分（其余字段不取）。 */
interface ProjectPayload {
  house: {
    rooms: Array<{id: string}>;
    sceneElements: Array<{id?: string; type?: string}>;
  };
  modelPackageLinks: ModelPackageLink[];
}

type ProjectState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'ready'; payload: ProjectPayload}
  | {status: 'error'; message: string};

const STATUS_LABEL: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  blocked: '阻塞',
  ready_for_inspection: '待验收',
  failed: '未通过',
  passed: '已通过',
  waived: '已豁免',
  stale_or_unverified: '待复验',
  blocked_by_precondition: '前置未满足',
};

const STATUS_COLOR: Record<string, string> = {
  not_started: '#8a93a3',
  in_progress: '#6fa8dc',
  blocked: '#d9534f',
  ready_for_inspection: '#e9c46a',
  failed: '#d9534f',
  passed: '#5cb85c',
  waived: '#9b8bd0',
  stale_or_unverified: '#e9c46a',
  blocked_by_precondition: '#d98c3f',
};

const READINESS_LABEL: Record<string, string> = {ready: '就绪', blocked: '未就绪'};
const GATE_LABEL: Record<string, string> = {passed: '已过', failed: '未过', pending: '待验'};
const GATE_COLOR: Record<string, string> = {passed: '#5cb85c', failed: '#d9534f', pending: '#e9c46a'};
const AUDIT_LABEL: Record<string, string> = {
  passed: '已通过',
  failed: '未通过',
  pending: '未执行',
  not_applicable: '不适用',
  stale: '已过期',
};

const NEUTRAL = '#8a93a3';

function labelOf(map: Record<string, string>, value: string | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}

function colorOf(map: Record<string, string>, value: string | undefined): string {
  if (!value) return NEUTRAL;
  return map[value] ?? NEUTRAL;
}

const money = (value: number | null | undefined): string =>
  value == null ? '—' : `¥${value.toLocaleString('zh-CN')}`;

const shortHash = (value: string | undefined): string =>
  value && value.length > 12 ? value.slice(0, 12) : (value ?? '—');

const listOrNone = (values: string[] | undefined): string =>
  values && values.length > 0 ? values.join('、') : '无';

export class ScheduleDetailPanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private unsubscribe: (() => void) | null = null;
  private payload: ScheduleSnapshot | null = null;
  private errorMessage: string | null = null;
  private projectState: ProjectState = {status: 'idle'};

  constructor(
    private readonly selection: ScheduleSelectionStore,
    private readonly options: ScheduleDetailPanelOptions = {},
  ) {}

  show(): void {
    if (!this.el) this.build();
    this.el!.style.display = 'block';
    this.visible = true;
    void this.refresh();
  }

  hide(): void {
    if (this.el) this.el.style.display = 'none';
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * 订阅共享选中态：选中包/检查变化时重渲染（事实仍来自缓存的快照，不重新取数）。
   * 返回退订函数；重复订阅前先退订，避免同一个面板挂两个监听。
   */
  subscribe(): () => void {
    this.unsubscribe?.();
    this.unsubscribe = this.selection.subscribe(() => this.render());
    return () => {
      this.unsubscribe?.();
      this.unsubscribe = null;
    };
  }

  /** 重新拉取快照并渲染（首次打开、外部状态变化后调）。 */
  async refresh(): Promise<void> {
    try {
      const response = await fetch('/api/schedule/state');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.payload = (await response.json()) as ScheduleSnapshot;
      this.errorMessage = null;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
    this.render();
  }

  // ─── 渲染 ────────────────────────────────────────────────────────────────

  private render(): void {
    const body = this.el?.querySelector('#schedule-detail-body') as HTMLElement | null;
    if (!body) return;

    const error = this.errorMessage
      ? `<div style="margin-bottom:8px;padding:6px 8px;border:1px solid rgba(217,83,79,.55);border-radius:6px;background:rgba(217,83,79,.12);color:#f0a9a5;font-size:12px;">取数失败：${escapeHtml(this.errorMessage)}　控制源校验不过或接口不通；修好 control.yaml / 起服务后重试。</div>`
      : '';

    if (!this.payload) {
      body.innerHTML = `${error}<div style="color:#9aa4b2;font-size:12px;">未取得包详情数据。</div>`;
      return;
    }

    const packageId = this.selection.get().packageId;
    if (!packageId) {
      body.innerHTML = `${error}<div style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">
        还没有选中工作包——在「自装进度」面板点某一行，或打开带 <code>#pkg=PKG-xxx</code> 的链接。
      </div>`;
      return;
    }

    const pkg = this.payload.packages.find((item) => item.id === packageId);
    if (!pkg) {
      body.innerHTML = `${error}<div style="padding:10px;border:1px solid rgba(233,196,106,.45);border-radius:6px;background:rgba(233,196,106,.08);color:#f4dfa8;font-size:12px;">
        包不在当前快照：${escapeHtml(packageId)}　（control.yaml 里已删除/改名，或快照是旧的——刷新后重试）
      </div>`;
      return;
    }

    body.innerHTML = `${error}${this.renderHeader(pkg)}${this.renderBlockers(pkg)}${this.renderBudget(pkg)}${this.renderChecks(pkg)}${this.renderProjectScope(pkg)}${this.renderFoot(pkg)}`;
    this.bind(body, pkg);
    this.ensureProjectScope(pkg.id);
  }

  private renderHeader(pkg: SchedulePackageView): string {
    const statusColor = colorOf(STATUS_COLOR, pkg.effective_status);
    const gateColor = colorOf(GATE_COLOR, pkg.gate_status);
    return `<div style="margin-bottom:10px;">
      <div style="font-size:14px;"><strong>${escapeHtml(pkg.name)}</strong> <span style="color:#9aa4b2;">${escapeHtml(pkg.id)}</span></div>
      <div style="margin-top:4px;font-size:12px;line-height:1.8;">
        <span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${statusColor};border:1px solid rgba(255,255,255,.25);"></span>状态：${escapeHtml(labelOf(STATUS_LABEL, pkg.effective_status))}
        （声明 ${escapeHtml(pkg.status)}）｜就绪：${escapeHtml(labelOf(READINESS_LABEL, pkg.effective_readiness))}（声明 ${escapeHtml(pkg.readiness)}）
      </div>
      <div style="font-size:12px;line-height:1.8;">
        <span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${gateColor};border:1px solid rgba(255,255,255,.25);"></span>${escapeHtml(pkg.gate_label)}：${escapeHtml(pkg.payment_gate)}｜门槛：${escapeHtml(labelOf(GATE_LABEL, pkg.gate_status))}
      </div>
      <div style="margin-top:2px;color:#9aa4b2;font-size:11px;line-height:1.7;">
        依赖：${escapeHtml(listOrNone(pkg.dependencies))}｜责任角色：${escapeHtml(listOrNone(pkg.owner_roles))}
      </div>
      <div style="margin-top:2px;color:#9aa4b2;font-size:11px;">${escapeHtml(pkg.description)}</div>
    </div>`;
  }

  private renderBlockers(pkg: SchedulePackageView): string {
    if (pkg.blockers.length === 0) {
      return `<div style="margin-bottom:10px;font-size:12px;"><strong>阻塞项</strong>：无</div>`;
    }
    const rows = pkg.blockers.map((blocker) => {
      const color = blocker.closed ? '#5cb85c' : '#d9534f';
      return `<div style="margin-bottom:4px;padding:6px 8px;border:1px solid rgba(255,255,255,.12);border-left:3px solid ${color};border-radius:4px;background:rgba(255,255,255,.03);font-size:12px;">
        <span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${color};border:1px solid rgba(255,255,255,.25);"></span>
        <strong>${escapeHtml(blocker.id)}</strong> ${blocker.closed ? '已关闭' : '未关闭'}
        ｜${escapeHtml(blocker.item ?? '（未命名阻塞项）')}｜状态：${escapeHtml(blocker.status ?? '—')}
        <div style="color:#9aa4b2;font-size:11px;">解除条件：${escapeHtml(blocker.clears_when ?? '—')}</div>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:10px;"><div style="font-size:13px;font-weight:600;margin-bottom:6px;">阻塞项 ${pkg.blockers.length}</div>${rows}</div>`;
  }

  private renderBudget(pkg: SchedulePackageView): string {
    const budget = pkg.budget;
    const unpriced = budget.unpriced_count > 0
      ? ` <span style="color:#e9c46a;">未报价 ${budget.unpriced_count}/${budget.component_count}（「待报价/待算量」不是 0 元）</span>`
      : '';
    return `<div style="margin-bottom:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(255,255,255,.04);font-size:12px;line-height:1.8;">
      <div style="font-weight:600;margin-bottom:2px;">预算</div>
      <div>批准 ${money(budget.planned_cny)}｜已成交 ${money(budget.contracted_cny)}｜已付 ${money(budget.paid_cny)}｜预测 ${money(budget.forecast_cny)}</div>
      <div style="color:#9aa4b2;">费用项 ${budget.component_count} 个${unpriced}</div>
      <div style="color:#9aa4b2;">资金状态：${escapeHtml(budget.funding_status ?? '—')}｜分配状态：${escapeHtml(budget.allocation_status ?? '—')}${budget.estimated_need_cny != null ? `｜估算需求 ${money(budget.estimated_need_cny)}` : ''}</div>
    </div>`;
  }

  private renderChecks(pkg: SchedulePackageView): string {
    const selectedCheckId = this.selection.get().checkId;
    const rows = pkg.checks.map((check) => this.renderCheckRow(check, selectedCheckId)).join('');
    const empty = pkg.checks.length === 0
      ? `<div style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">该包没有检查项（control.yaml 校验要求至少一条验收）。</div>`
      : '';
    return `<div style="margin-bottom:10px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px;">检查项 ${pkg.checks.length}（点行选中该检查）</div>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr>
          <th style="text-align:left;">检查项</th><th style="text-align:left;">级别</th><th style="text-align:left;">时机</th>
          <th style="text-align:left;">方法</th><th style="text-align:left;">通过标准</th><th style="text-align:left;">必需证据</th>
          <th style="text-align:left;">审计</th><th style="text-align:left;">指纹</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      ${empty}
    </div>`;
  }

  private renderCheckRow(check: ScheduleCheckView, selectedCheckId: string | null): string {
    const active = selectedCheckId === check.id;
    const stale = (check.stale_reasons ?? []).length > 0;
    const openGates = check.open_gates ?? [];
    const auditNotes: string[] = [];
    if (stale) auditNotes.push(`<span style="color:#e9c46a;">过期：${escapeHtml((check.stale_reasons ?? []).join('；'))}</span>`);
    if (openGates.length) auditNotes.push(`<span style="color:#e9c46a;">等门禁：${escapeHtml(openGates.join('、'))}</span>`);
    if (check.can_run_while_blocked) auditNotes.push('<span style="color:#6fa8dc;">阻塞期可先做</span>');
    const audit = `<div>${escapeHtml(labelOf(AUDIT_LABEL, check.audit_status))}</div>${auditNotes.map((note) => `<div style="font-size:10px;">${note}</div>`).join('')}`;
    return `<tr data-check-id="${escapeHtml(check.id)}" data-active="${active}" title="点这行：选中检查 ${escapeHtml(check.id)}"
      style="cursor:pointer;${active ? 'background:rgba(111,168,220,.18);' : ''}">
      <td title="${escapeHtml(check.item)}">${escapeHtml(check.item)}<div style="color:#9aa4b2;font-size:10px;">${escapeHtml(check.id)}｜${check.source === 'acceptance' ? '引用验收' : '包内检查'}</div></td>
      <td>${escapeHtml(check.severity ?? '—')}</td>
      <td>${escapeHtml(check.checkpoint ?? '—')}</td>
      <td title="${escapeHtml(check.method ?? '')}">${escapeHtml(check.method ?? '—')}</td>
      <td title="${escapeHtml(check.pass_condition ?? '')}">${escapeHtml(check.pass_condition ?? '—')}</td>
      <td>${check.evidence_required.map((evidence) => `<div>${escapeHtml(evidence)}</div>`).join('') || '—'}</td>
      <td>${audit}</td>
      <td title="${escapeHtml(check.check_spec_sha256)}">${escapeHtml(shortHash(check.check_spec_sha256))}</td>
    </tr>`;
  }

  /** 3D 作用域段：用 shared/package-scope 展开该包的 link，不自己写第二套选择器语义。 */
  private renderProjectScope(pkg: SchedulePackageView): string {
    const highlightButton = this.options.onHighlight
      ? `<button type="button" id="schedule-detail-highlight" style="cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #6fa8dc;background:#2f4a63;color:#e8f2ff;font-size:12px;">在 3D 中高亮</button>`
      : `<button type="button" id="schedule-detail-highlight" disabled title="未提供 onHighlight 回调（App 未接线 3D 高亮）" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:#2a2a3e;color:#8a93a3;font-size:12px;">在 3D 中高亮</button>
         <span style="color:#9aa4b2;font-size:11px;">未接线：本面板没有拿到 3D 高亮回调，按钮禁用</span>`;

    let detail = '';
    if (this.projectState.status === 'loading') {
      detail = `<div style="color:#9aa4b2;font-size:12px;">正在展开 3D 作用域…</div>`;
    } else if (this.projectState.status === 'error') {
      detail = `<div style="color:#f0a9a5;font-size:12px;">3D 作用域暂不可用：${escapeHtml(this.projectState.message)}（不影响上面的包详情）</div>`;
    } else if (this.projectState.status === 'ready') {
      detail = this.renderScopeResolution(pkg, this.projectState.payload);
    }

    return `<div style="margin-bottom:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(255,255,255,.04);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-size:13px;font-weight:600;">3D 作用域</span>${highlightButton}
      </div>
      ${detail}
    </div>`;
  }

  private renderScopeResolution(pkg: SchedulePackageView, payload: ProjectPayload): string {
    const links = (payload.modelPackageLinks ?? []).filter((link) => link.budget_ref?.id === pkg.id);
    if (links.length === 0) {
      return `<div style="color:#9aa4b2;font-size:12px;">该包在 modelPackageLinks 里没有关联（3D 中没有可高亮范围；全项目范围的包也不占反查）。</div>`;
    }
    const project: ProjectScopeInput = payload;
    const roomIds = new Set<string>();
    const objectIds = new Set<string>();
    const pointIds = new Set<string>();
    const unresolved: string[] = [];
    let projectScope = false;
    for (const link of links) {
      const resolution = resolvePackageScope(link, project);
      for (const id of resolution.roomIds) roomIds.add(id);
      for (const id of resolution.objectIds) objectIds.add(id);
      for (const id of resolution.pointIds) pointIds.add(id);
      unresolved.push(...resolution.unresolved);
      projectScope = projectScope || resolution.projectScope;
    }
    // 计数与高亮承诺必须同口径（2026-11-02 评审 P1）：点位是合批渲染，本步高亮
    // 命中不了，单列一段并注明第三步，不混进「对象」充数。
    return `<div style="font-size:12px;line-height:1.8;">
      <div>房间 ${roomIds.size} 个｜对象 ${objectIds.size} 个｜点位 ${pointIds.size} 个${projectScope ? '｜<span style="color:#9b8bd0;">全项目范围</span>' : ''}</div>
      <div style="color:#9aa4b2;font-size:11px;">房间：${escapeHtml([...roomIds].join('、') || '无')}</div>
      <div style="color:#9aa4b2;font-size:11px;">对象：${escapeHtml([...objectIds].join('、') || '无')}</div>
      <div style="color:#9aa4b2;font-size:11px;">点位：${escapeHtml([...pointIds].join('、') || '无')}${pointIds.size ? '（电气/给排水点位为合批渲染，本步只反查不高亮；点位级高亮在第三步）' : ''}</div>
      <div style="color:#9aa4b2;font-size:11px;">未展开选择器：${unresolved.length ? escapeHtml([...new Set(unresolved)].join('；')) : '无（本步可高亮房间/墙/叠加层区域级）'}</div>
    </div>`;
  }

  private renderFoot(pkg: SchedulePackageView): string {
    return `<div style="color:#9aa4b2;font-size:11px;line-height:1.7;">
      项目数据指纹：<code>${escapeHtml(shortHash(pkg.project_fingerprint))}</code>（前 12 位；完整值在服务端）｜
      快照指纹：<code>${escapeHtml(shortHash(this.payload?.data_fingerprint))}</code>。
      本面板只读：改验收状态、拍板门禁一律走 PR（铁律）。
    </div>`;
  }

  // ─── 事件 ────────────────────────────────────────────────────────────────

  private bind(body: HTMLElement, pkg: SchedulePackageView): void {
    for (const row of Array.from(body.querySelectorAll('tr[data-check-id]'))) {
      row.addEventListener('click', () => {
        const checkId = String((row as HTMLElement).dataset.checkId ?? '');
        if (!checkId) return;
        this.selection.set({checkId});
      });
    }
    body.querySelector('#schedule-detail-highlight')?.addEventListener('click', () => {
      this.options.onHighlight?.(pkg.id);
    });
  }

  /** 3D 作用域按需拉一次（idle → loading → ready/error）；不重复拉。 */
  private ensureProjectScope(packageId: string): void {
    if (this.projectState.status !== 'idle') return;
    void this.loadProjectScope(packageId);
  }

  private async loadProjectScope(packageId: string): Promise<void> {
    this.projectState = {status: 'loading'};
    this.render();
    try {
      const response = await fetch('/api/project?phase=full');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ProjectPayload;
      this.projectState = {status: 'ready', payload};
    } catch (err) {
      this.projectState = {status: 'error', message: err instanceof Error ? err.message : String(err)};
    }
    // 拉取期间选中可能已变：只在新状态仍对当前包有意义时重渲染
    if (this.selection.get().packageId === packageId) this.render();
  }

  private build(): void {
    const el = document.createElement('div');
    el.id = 'schedule-detail-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none; max-width: 560px;
    `;
    el.innerHTML = `
      <div class="dynamic-panel-heading">
        <strong>包详情</strong>
        <button id="schedule-detail-panel-toggle" class="panel-collapse-toggle" type="button" aria-controls="schedule-detail-panel-content" aria-expanded="true" aria-label="包详情面板折叠" title="折叠">−</button>
      </div>
      <div id="schedule-detail-panel-content">
        <div id="schedule-detail-body"></div>
      </div>
    `;
    const stack = document.getElementById('right-panel-stack');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#schedule-detail-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#schedule-detail-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);
    this.el = el;
  }
}
