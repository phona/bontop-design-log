// 自装审批「包详情」面板（自装交互审批第一步，2026-11-02，设计稿 §6/§8）。
//
// 职责：把共享选中态（ScheduleSelectionStore）里的那个包摊开讲清楚——头部状态、
// 阻塞项、预算行、逐项检查表（含第二步的验收操作区），再加一段「这个包在 3D 里
// 覆盖什么」。
//
// 三个数据来源：
//  1. `GET /api/schedule/state`——包的结构化投影（与 verify:schedule 同一 loader）；
//  2. `GET /api/project?phase=full`——房间与场景对象，供 resolvePackageScope
//     （shared/package-scope.ts，值导入、浏览器安全）把 modelPackageLinks 的选择器
//     展开成「房间 N 个 / 对象 M 个」。**面板不自己算 3D 范围**：选择器语义只有
//     shared 那一份实现，浏览器里出现第二套必然漂移。
//  3. `GET/PUT /api/acceptance/draft`——第二步写路径的草稿（tmp/ 持久化）。
//
// 铁律落实：
//  - 点检查行只写选中态（selection.set({checkId})），不产生任何配置写入；
//  - 「在 3D 中高亮」按钮依赖外部接线（options.onHighlight）；没接线时按钮禁用
//    并写明原因，不留一个点了没反应的按钮；
//  - 3D 段取数失败只让该段显示「3D 作用域暂不可用」，不拖垮其余渲染；
//  - 所有插值 escapeHtml，指纹只显示前 12 位（完整值在 config 与服务端）；
//  - 浏览器永不直接写仓库：草稿只 PUT 进 tmp/，进仓库的唯一路径是分支 + commit
//    + PR，合并由业主亲手点。没有任何已选状态时绝不 PUT（空 results 会覆盖
//    tmp/ 里已有草稿）；保存 422 的 issues 逐条挂回对应行，不留静默空态。
import type { ScheduleSnapshot, SchedulePackageView, ScheduleCheckView } from '@shared/schedule-state';
import type { ScheduleSelectionStore } from '../state/schedule-selection.js';
import type {
  AcceptanceDraft,
  AuditRecordProjection,
  DraftCheckResult,
  DraftIssue,
} from '@shared/acceptance-draft';
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

/** 一行检查的本地草稿态（未选状态时不进 PUT body）。 */
interface CheckDraftState {
  /** null = 还没选状态；只有选过状态的行才会进 PUT。 */
  status: DraftCheckResult['status'] | null;
  checked_by: string;
  checked_at: string;
  note: string;
  supersedes: string;
  /** 已落定的最终证据（仓内相对路径，随 PR 进 master）。 */
  evidence: string[];
  /** 刚上传还在 tmp/ 暂存区的文件（选为最终证据后才进 evidence）。 */
  staged: {staging_path: string; sha256: string; size: number} | null;
  stagedError: string | null;
  uploading: boolean;
  /** 上次保存 422 挂回本行的 issues。 */
  issues: DraftIssue[];
}

type SaveStatus =
  | {kind: 'idle'}
  | {kind: 'saving'}
  | {kind: 'saved'; at: string}
  | {kind: 'error'; message: string};

interface GateView {
  name: string;
  ok: boolean;
  detail: string;
}

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

/** 草稿状态三选（与 shared/acceptance-draft.ts 的 DraftCheckStatus 同源）。 */
const DRAFT_STATUS_ORDER: DraftCheckResult['status'][] = ['passed', 'failed', 'not_applicable'];
const DRAFT_STATUS_LABEL: Record<DraftCheckResult['status'], string> = {
  passed: 'passed（通过）',
  failed: 'failed（未通过）',
  not_applicable: 'not_applicable（不适用）',
};
const DRAFT_STATUS_COLOR: Record<DraftCheckResult['status'], string> = {
  passed: '#5cb85c',
  failed: '#d9534f',
  not_applicable: '#9b8bd0',
};

const NEUTRAL = '#8a93a3';
const CHECK_OP_COLSPAN = 8;
const SAVE_DEBOUNCE_MS = 300;

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

/** 本地日历今天（checked_at 默认值；服务端只认真实 YYYY-MM-DD）。 */
function todayText(): string {
  const now = new Date();
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export class ScheduleDetailPanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private unsubscribe: (() => void) | null = null;
  private payload: ScheduleSnapshot | null = null;
  private errorMessage: string | null = null;
  private projectState: ProjectState = {status: 'idle'};

  // ─── 第二步写路径状态（草稿 / 保存 / 卡点 / 预演 / 提交） ───
  private draftResults = new Map<string, CheckDraftState>();
  /** 已（或正在）加载草稿的包；render 时对不上就重拉，防静默空态。 */
  private draftPackageId: string | null = null;
  private draftLoading = false;
  private draftError: string | null = null;
  private draftSeq = 0;
  /**
   * 草稿保存状态**按包存**（2026-11-03 codex 五审 blocking）：原先是面板级共享
   * 三字段，包 A 的 PUT 在途时切到包 B、B 保存失败，A 的成功晚到会把 B 标成
   * 「已保存」并抹掉重试入口——B 未保存的编辑看起来已存、刷新即丢。改成每包一份
   * 记录，跨包响应互不可见。saveSeq 是请求版本号（仿上方 draftSeq 范式）：
   * 同包的旧响应也不许碰状态。
   */
  private saveByPkg = new Map<string, {status: SaveStatus; dirty: boolean; issues: DraftIssue[]}>();
  /** 每包的保存请求版本号：响应回头时若不是该包最新一轮，结果作废（同包新旧排序）。 */
  private saveSeqByPkg = new Map<string, number>();

  private saveRecordFor(packageId: string): {status: SaveStatus; dirty: boolean; issues: DraftIssue[]} {
    let record = this.saveByPkg.get(packageId);
    if (!record) {
      record = {status: {kind: 'idle'}, dirty: false, issues: []};
      this.saveByPkg.set(packageId, record);
    }
    return record;
  }
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTargetPackage: string | null = null;
  /** 卡点/预演/提交状态所属的包；换包即作废（不拿旧结论放行新包）。 */
  private actionPackageId: string | null = null;
  private gates: {ok: boolean; gates: GateView[]} | null = null;
  private gatesLoading = false;
  private gatesError: string | null = null;
  private dryRun: {records: AuditRecordProjection[]; pr_body: string} | null = null;
  private dryRunLoading = false;
  private dryRunError: string | null = null;
  private submitArmed = false;
  private submitting = false;
  private submitResult: {branch: string; commit: string; pr_url: string} | null = null;
  private submitError: {error: string; detail?: unknown} | null = null;

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
    // 快照重拉 = audit 现值可能已变（PR 合并后）：草稿一起重取，并排显示
    this.draftPackageId = null;
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

    if (this.actionPackageId !== pkg.id) {
      this.actionPackageId = pkg.id;
      this.resetSubmitState();
      // 2026-11-03 codex 五审：**不重置保存记录**。旧实现（面板级共享状态）切包要
      // 重置是因为那三个字段属于旧包；现在每包一份记录，包自己的成败状态要跨访问
      // 保留——切回去能看到上次的「保存失败+重试」（reset 掉就等于把失败抹成
      // 空态，业主以为没发生过）。在途的保存响应落地时自会更新该包记录。
    }

    body.innerHTML = `${error}${this.renderHeader(pkg)}${this.renderBlockers(pkg)}${this.renderBudget(pkg)}${this.renderChecks(pkg)}${this.renderProjectScope(pkg)}${this.renderAcceptanceActions()}${this.renderFoot(pkg)}`;
    this.bind(body, pkg);
    this.ensureProjectScope(pkg.id);
    this.ensureDraft(pkg.id);
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
    // 操作区是检查行的**兄弟行**：点操作区不会冒泡到检查行的选中逻辑
    const rows = pkg.checks
      .map((check) => `${this.renderCheckRow(check, selectedCheckId)}${this.renderCheckOpRow(check)}`)
      .join('');
    const empty = pkg.checks.length === 0
      ? `<div style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">该包没有检查项（control.yaml 校验要求至少一条验收）。</div>`
      : '';
    return `<div style="margin-bottom:10px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px;">检查项 ${pkg.checks.length}（点行选中该检查；行下操作区写验收草稿）</div>
      <div data-save-status style="margin-bottom:2px;">${this.saveStatusLine(pkg.id)}</div>
      <div data-draft-status style="margin-bottom:6px;">${this.draftStatusLine(pkg.id)}</div>
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

  // ─── 每检查项操作区（第二步写路径） ─────────────────────────────────────

  private renderCheckOpRow(check: ScheduleCheckView): string {
    const state = this.peekDraft(check.id);
    const openGates = check.open_gates ?? [];
    const blocked = openGates.length > 0;
    const blockedNote = blocked
      ? `<span style="color:#e9c46a;font-size:11px;">被 ${escapeHtml(openGates.join('、'))} 未拍板决策阻塞：拍板前 passed 禁用</span>`
      : '';
    // 复验 supersedes 联动（P1-1/P1-2）：服务端要求 supersedes 必须等于本包本检查
    // 的**当前记录 id**（快照 audit.id）。这里把当前记录 id 显形（占位符 + 同行
    // 提示），输入框不再是死路；指错会被服务端 422 挂回本行红字。
    const currentRecordId = check.audit?.id ?? '';
    const supersedesRow = check.audit_status === 'passed'
      ? `<label style="color:#9aa4b2;white-space:nowrap;">复验 supersedes（旧记录 id）
          <input type="text" data-supersedes="${escapeHtml(check.id)}" value="${escapeHtml(state.supersedes)}" placeholder="${escapeHtml(currentRecordId || 'AUD-…')}" title="${escapeHtml(currentRecordId ? `复验必须填当前记录 id：${currentRecordId}` : '复验请填旧记录 id（AUD-…）')}" style="width:130px;padding:2px 5px;border:1px solid rgba(255,255,255,.2);border-radius:4px;background:#20203a;color:#e0e0e0;font-size:11px;">
        </label>
        ${currentRecordId ? `<span style="color:#9aa4b2;font-size:11px;white-space:nowrap;">当前记录：<code>${escapeHtml(currentRecordId)}</code></span>` : ''}`
      : '';
    const inputStyle = 'width:110px;padding:2px 5px;border:1px solid rgba(255,255,255,.2);border-radius:4px;background:#20203a;color:#e0e0e0;font-size:11px;';
    const wideStyle = 'width:180px;padding:2px 5px;border:1px solid rgba(255,255,255,.2);border-radius:4px;background:#20203a;color:#e0e0e0;font-size:11px;';
    return `<tr data-check-op="${escapeHtml(check.id)}" style="background:rgba(255,255,255,.02);">
      <td colspan="${CHECK_OP_COLSPAN}" style="padding:5px 8px 9px 16px;border-bottom:1px solid rgba(255,255,255,.08);">
        <div style="font-size:11px;color:#6fa8dc;margin-bottom:3px;">验收操作（写草稿，只进 tmp/）</div>
        <div style="font-size:11px;color:#9aa4b2;margin-bottom:4px;line-height:1.7;">
          仓库现值：<strong>${escapeHtml(labelOf(AUDIT_LABEL, check.audit_status))}</strong>
          （${escapeHtml(check.audit?.checked_by ?? '—')} / ${escapeHtml(check.audit?.checked_at ?? '—')}${check.audit?.id ? ` / ${escapeHtml(check.audit.id)}` : ''}）
          ｜草稿值：<strong data-draft-value="${escapeHtml(check.id)}" style="color:${state.status ? DRAFT_STATUS_COLOR[state.status] : NEUTRAL};">${escapeHtml(state.status ? DRAFT_STATUS_LABEL[state.status] : '未选择')}</strong>
          ｜证据要求：${check.evidence_required.map((evidence) => escapeHtml(evidence)).join('、') || '—'}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:4px;">
          ${this.renderStatusButtons(check, state)}${blockedNote}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:4px;font-size:11px;color:#9aa4b2;">
          <label style="white-space:nowrap;">检查人<input type="text" data-checked-by="${escapeHtml(check.id)}" value="${escapeHtml(state.checked_by)}" placeholder="谁验的（必填）" style="${inputStyle}"></label>
          <label style="white-space:nowrap;">检查日期<input type="date" data-checked-at="${escapeHtml(check.id)}" value="${escapeHtml(state.checked_at)}" style="${inputStyle}"></label>
          <label style="white-space:nowrap;">备注<input type="text" data-note="${escapeHtml(check.id)}" value="${escapeHtml(state.note)}" placeholder="not_applicable 必填理由" style="${wideStyle}"></label>
          ${supersedesRow}
        </div>
        <div data-evidence-area="${escapeHtml(check.id)}">${this.renderEvidenceArea(check, state)}</div>
        <div data-check-issues="${escapeHtml(check.id)}">${this.renderIssues(state)}</div>
      </td>
    </tr>`;
  }

  private renderStatusButtons(check: ScheduleCheckView, state: CheckDraftState): string {
    const openGates = check.open_gates ?? [];
    return DRAFT_STATUS_ORDER.map((value) => {
      const active = state.status === value;
      const disabled = value === 'passed' && openGates.length > 0;
      const color = DRAFT_STATUS_COLOR[value];
      const title = disabled
        ? `被 ${openGates.join('、')} 未拍板决策阻塞：拍板前不得判 passed`
        : `把该检查标记为 ${value}`;
      return `<button type="button" data-status-btn="${escapeHtml(check.id)}" data-status="${value}" aria-pressed="${active}"${disabled ? ' disabled' : ''} title="${escapeHtml(title)}"
        style="cursor:${disabled ? 'not-allowed' : 'pointer'};padding:3px 9px;border-radius:5px;font-size:11px;border:1px solid ${active ? color : 'rgba(255,255,255,.18)'};background:${active ? color : '#2a2a3e'};color:${active ? '#10101c' : '#c9cede'};">${escapeHtml(DRAFT_STATUS_LABEL[value])}</button>`;
    }).join('');
  }

  private renderEvidenceArea(check: ScheduleCheckView, state: CheckDraftState): string {
    const finalizeDisabled = !state.staged || state.uploading;
    const uploading = state.uploading
      ? `<span style="font-size:11px;color:#9aa4b2;">上传中…</span>`
      : '';
    const stagedInfo = state.staged && !state.uploading
      ? `<div style="font-size:11px;color:#9aa4b2;">已暂存：<code>${escapeHtml(state.staged.staging_path)}</code>（sha256 <code>${escapeHtml(shortHash(state.staged.sha256))}</code>，${escapeHtml(state.staged.size)} 字节）——「选为最终证据」后才会进 audit 记录</div>`
      : '';
    const stagedError = state.stagedError
      ? `<div style="font-size:11px;color:#f0a9a5;">证据操作失败：${escapeHtml(state.stagedError)}</div>`
      : '';
    const list = state.evidence.length > 0
      ? `<div style="font-size:11px;line-height:2;">最终证据：${state.evidence.map((path) => `<span style="display:inline-block;margin:0 6px 2px 0;padding:0 6px;border:1px solid rgba(92,184,92,.4);border-radius:4px;background:rgba(92,184,92,.08);"><code>${escapeHtml(path)}</code><button type="button" data-evidence-remove="${escapeHtml(check.id)}" data-evidence-path="${escapeHtml(path)}" title="从草稿证据列表移除" style="margin-left:6px;cursor:pointer;padding:0 5px;border:1px solid rgba(217,83,79,.5);border-radius:4px;background:#3a2326;color:#f0a9a5;font-size:10px;">删</button></span>`).join('')}</div>`
      : `<div style="font-size:11px;color:#9aa4b2;">最终证据：无（passed 必须至少一条落定证据）</div>`;
    return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <input type="file" data-evidence-file="${escapeHtml(check.id)}" style="font-size:11px;max-width:230px;color:#9aa4b2;">
        ${uploading}
        <button type="button" data-evidence-finalize="${escapeHtml(check.id)}"${finalizeDisabled ? ' disabled' : ''} title="${finalizeDisabled ? '先选一个文件上传到暂存区' : '把暂存文件移入仓内最终路径，并加入本行草稿证据'}" style="cursor:${finalizeDisabled ? 'not-allowed' : 'pointer'};padding:3px 9px;border-radius:5px;font-size:11px;border:1px solid rgba(255,255,255,.18);background:#2a2a3e;color:#c9cede;">选为最终证据</button>
      </div>${stagedInfo}${stagedError}${list}`;
  }

  private renderIssues(state: CheckDraftState): string {
    if (state.issues.length === 0) return '';
    return state.issues.map((issue) => `<div style="color:#f0a9a5;font-size:11px;">${escapeHtml(issue.field ? `[${issue.field}] ` : '')}${escapeHtml(issue.message)}</div>`).join('');
  }

  // ─── 保存状态行（包级，防静默丢数据） ───────────────────────────────────

  private saveStatusLine(packageId: string): string {
    const base = 'font-size:11px;';
    const record = this.saveRecordFor(packageId);
    if (record.status.kind === 'saving') {
      return `<span style="${base}color:#9aa4b2;">保存中…（写 tmp/ 草稿）</span>`;
    }
    if (record.status.kind === 'saved') {
      return `<span style="${base}color:#5cb85c;">已保存 ${escapeHtml(record.status.at)}（草稿只存 tmp/；进仓库走 PR）</span>`;
    }
    if (record.status.kind === 'error') {
      const extra = record.issues.map((issue) => escapeHtml(issue.message)).join('；');
      // 2026-11-03 codex 四审：flush（退出前保存）失败后草稿还在内存（draftResults），
      // 给一个显式重试——否则业主只能靠「再改一个字段」碰运气触发 debounce。
      return `<span style="${base}color:#f0a9a5;">保存失败：${escapeHtml(record.status.message)}${extra ? `｜${extra}` : ''}</span> <button type="button" data-save-retry="${escapeHtml(packageId)}" style="cursor:pointer;margin-left:6px;padding:1px 8px;border-radius:5px;border:1px solid #6fa8dc;background:#2f4a63;color:#e8f2ff;font-size:11px;">重试保存</button>`;
    }
    const selected = this.selectedCount(packageId);
    if (selected === 0) {
      return `<span style="${base}color:#e9c46a;">没有可保存的结果：先选一个状态（没有已选状态时不会 PUT，避免空 results 覆盖 tmp/ 里已有草稿）</span>`;
    }
    if (this.saveRecordFor(packageId).dirty) {
      return `<span style="${base}color:#9aa4b2;">${selected} 条已选状态：停手 300ms 自动存 tmp/</span>`;
    }
    return `<span style="${base}color:#9aa4b2;">草稿 ${selected} 条已存 tmp/（改动后自动保存）</span>`;
  }

  private draftStatusLine(packageId: string): string {
    const base = 'font-size:11px;';
    if (this.draftLoading) {
      return `<span style="${base}color:#9aa4b2;">草稿加载中…（读 tmp/ 里该包的验收草稿）</span>`;
    }
    if (this.draftError) {
      return `<span style="${base}color:#f0a9a5;">草稿读取失败：${escapeHtml(this.draftError)}（快照照常显示；保存成功后会重建草稿）</span>`;
    }
    const count = this.selectedCount(packageId);
    if (count === 0) {
      return `<span style="${base}color:#9aa4b2;">tmp/ 里暂无该包草稿：选状态、填检查人/日期、传证据后自动保存。</span>`;
    }
    return `<span style="${base}color:#9aa4b2;">已载入 tmp/ 草稿 ${count} 条（下行「草稿值」与仓库现值并排显示）。</span>`;
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
      detail = `<div style="color:#f0a9a5;font-size:12px;">3D 作用域暂不可用：${escapeHtml(this.projectState.message)}（不影响上面的包详情） <button type="button" id="schedule-detail-scope-retry" style="cursor:pointer;margin-left:6px;padding:2px 8px;border-radius:5px;border:1px solid #6fa8dc;background:#2f4a63;color:#e8f2ff;font-size:11px;">重试</button></div>`;
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
    // 计数与高亮承诺必须同口径（2026-11-02 评审 P1）：点位已可高亮（合批实例
    // BatchedMesh.setColorAt 逐实例 + 未合批单件 emissive 兜底），单列一段注明
    // 实现口径，不混进「对象」充数。
    return `<div style="font-size:12px;line-height:1.8;">
      <div>房间 ${roomIds.size} 个｜对象 ${objectIds.size} 个｜点位 ${pointIds.size} 个${projectScope ? '｜<span style="color:#9b8bd0;">全项目范围</span>' : ''}</div>
      <div style="color:#9aa4b2;font-size:11px;">房间：${escapeHtml([...roomIds].join('、') || '无')}</div>
      <div style="color:#9aa4b2;font-size:11px;">对象：${escapeHtml([...objectIds].join('、') || '无')}</div>
      <div style="color:#9aa4b2;font-size:11px;">点位：${escapeHtml([...pointIds].join('、') || '无')}${pointIds.size ? '（电气/给排水点位为合批渲染，已支持逐实例高亮：BatchedMesh.setColorAt）' : ''}</div>
      <div style="color:#9aa4b2;font-size:11px;">未展开选择器：${unresolved.length ? escapeHtml([...new Set(unresolved)].join('；')) : '无（可高亮房间/墙/叠加层区域级/点位级）'}</div>
    </div>`;
  }

  // ─── 包级操作条（机械卡点 / PR 预演 / 两步确认提交） ─────────────────────

  private renderAcceptanceActions(): string {
    const gatesGreen = this.gates?.ok === true;
    const gatesTotal = this.gates?.gates.length ?? 0;
    const gatesPassed = this.gates?.gates.filter((gate) => gate.ok).length ?? 0;
    const dryReady = this.dryRun !== null && !this.dryRunLoading;
    // 提交成功后按钮永久禁用：服务端已清草稿+暂存，再点只会拿到空草稿 422（P1-4）
    const submitDisabled = !dryReady || this.submitting || this.submitResult !== null;
    const submitLabel = this.submitting ? '提交中…'
      : this.submitResult ? '已开 PR（草稿已清，勿重复提交）'
      : this.submitArmed ? '再点一次：确认开 PR' : '确认提交（开 PR）';
    const submitStyle = this.submitArmed
      ? 'cursor:pointer;padding:4px 10px;border-radius:6px;font-size:12px;border:1px solid #d9534f;background:#5a2321;color:#ffd9d6;'
      : 'cursor:pointer;padding:4px 10px;border-radius:6px;font-size:12px;border:1px solid rgba(255,255,255,.18);background:#2a2a3e;color:#c9cede;';
    const buttonStyle = 'cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #6fa8dc;background:#2f4a63;color:#e8f2ff;font-size:12px;';
    const disabledStyle = 'padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:#2a2a3e;color:#8a93a3;font-size:12px;cursor:not-allowed;';
    return `<div id="acceptance-actions" style="margin-bottom:10px;padding:8px 10px;border:1px solid rgba(111,168,220,.35);border-radius:6px;background:rgba(111,168,220,.06);">
      <div style="font-size:13px;font-weight:600;margin-bottom:2px;">验收操作</div>
      <div style="color:#9aa4b2;font-size:11px;margin-bottom:6px;">草稿只存 tmp/；进仓库的唯一路径是分支 + commit + PR，合并由业主亲手点（铁律）。</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <button type="button" id="acceptance-run-gates"${this.gatesLoading ? ' disabled' : ''} style="${this.gatesLoading ? disabledStyle : buttonStyle}">${this.gatesLoading ? '卡点执行中…' : '跑机械卡点'}</button>
        <button type="button" id="acceptance-dry-run"${gatesGreen && !this.dryRunLoading ? '' : ' disabled'} title="${gatesGreen ? '只算将写入的记录与 PR 正文，不碰 git' : '先跑机械卡点且五道全绿'}" style="${gatesGreen && !this.dryRunLoading ? buttonStyle : disabledStyle}">${this.dryRunLoading ? '预演生成中…' : '生成 PR 预演'}</button>
        <button type="button" id="acceptance-submit"${submitDisabled ? ' disabled' : ''} title="${this.submitResult ? '已开 PR 且草稿已清，勿重复提交' : dryReady ? '两步确认：第一次只进确认态，第二次才真正开 PR' : '先生成 PR 预演'}" style="${submitDisabled ? disabledStyle : submitStyle}">${escapeHtml(submitLabel)}</button>
        ${this.gates ? `<span style="font-size:11px;color:${this.gates.ok ? '#5cb85c' : '#d9534f'};">卡点 ${gatesPassed}/${gatesTotal}</span>` : ''}
      </div>
      ${this.renderGatesArea()}
      ${this.renderDryRunArea()}
      ${this.renderSubmitArea()}
    </div>`;
  }

  private renderGatesArea(): string {
    if (this.gatesError) {
      return `<div style="margin-top:6px;color:#f0a9a5;font-size:11px;">卡点执行失败：${escapeHtml(this.gatesError)}</div>`;
    }
    if (!this.gates) {
      return this.gatesLoading
        ? `<div style="margin-top:6px;color:#9aa4b2;font-size:11px;">卡点执行中…（含 verify:schedule，可能数十秒）</div>`
        : `<div style="margin-top:6px;color:#9aa4b2;font-size:11px;">还没跑过机械卡点：五道卡点（控制源校验 / 草稿校验 / 证据在位 / 前置与阻塞 / verify:schedule）全绿后才能生成 PR 预演。</div>`;
    }
    const rows = this.gates.gates.map((gate) => {
      const mark = gate.ok ? '✓' : '✗';
      const color = gate.ok ? '#5cb85c' : '#d9534f';
      // ✗ 的 detail 完整显示（失败逐条原因就在这）；✓ 的 detail 收起为小字
      const detailStyle = gate.ok ? 'color:#9aa4b2;font-size:10px;' : 'color:#f0a9a5;font-size:11px;white-space:pre-wrap;';
      return `<div style="margin-top:3px;font-size:11px;"><span style="color:${color};">${mark}</span> <strong>${escapeHtml(gate.name)}</strong><div style="margin-left:14px;${detailStyle}">${escapeHtml(gate.detail) || '—'}</div></div>`;
    }).join('');
    return `<div style="margin-top:6px;">${rows}</div>`;
  }

  private renderDryRunArea(): string {
    if (this.dryRunLoading) {
      return `<div style="margin-top:6px;color:#9aa4b2;font-size:11px;">预演生成中…（跑卡点并投影将写入的 audit 记录，不碰 git）</div>`;
    }
    if (this.dryRunError) {
      return `<div style="margin-top:6px;color:#f0a9a5;font-size:11px;">预演被挡下：${escapeHtml(this.dryRunError)}（卡点明细已回填到上面）</div>`;
    }
    if (!this.dryRun) return '';
    const rows = this.dryRun.records.map((record) => `<tr>
      <td><code>${escapeHtml(record.id)}</code></td>
      <td>${escapeHtml(record.check_id)}</td>
      <td>${escapeHtml(record.status)}</td>
      <td title="${escapeHtml(record.check_spec_sha256)}">${escapeHtml(shortHash(record.check_spec_sha256))}</td>
      <td title="${escapeHtml(record.project_data_sha256)}">${escapeHtml(shortHash(record.project_data_sha256))}</td>
      <td>${escapeHtml(record.supersedes ?? '—')}</td>
    </tr>`).join('');
    return `<div style="margin-top:6px;">
      <div style="font-size:11px;font-weight:600;">PR 预演：将写入 ${this.dryRun.records.length} 条 audit 记录（未碰 git）</div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr><th style="text-align:left;">记录 id</th><th style="text-align:left;">检查</th><th style="text-align:left;">状态</th><th style="text-align:left;">check_spec 指纹</th><th style="text-align:left;">项目数据指纹</th><th style="text-align:left;">supersedes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div style="font-size:11px;font-weight:600;margin-top:4px;">PR 正文预览</div>
      <pre style="margin:2px 0 0;padding:6px 8px;border:1px solid rgba(255,255,255,.14);border-radius:5px;background:rgba(0,0,0,.25);white-space:pre-wrap;word-break:break-all;font-size:11px;max-height:220px;overflow:auto;">${escapeHtml(this.dryRun.pr_body)}</pre>
    </div>`;
  }

  private renderSubmitArea(): string {
    if (this.submitting) {
      return `<div style="margin-top:6px;color:#9aa4b2;font-size:11px;">提交中…（建分支 → 写 audit_log → 重渲 → 复跑卡点 → commit → push → 开 PR；任一步失败自动回滚）</div>`;
    }
    if (this.submitError) {
      const detail = this.renderDetail(this.submitError.detail);
      return `<div style="margin-top:6px;color:#f0a9a5;font-size:11px;">提交失败：${escapeHtml(this.submitError.error)}${detail ? `<div style="white-space:pre-wrap;">${detail}</div>` : ''}</div>`;
    }
    if (this.submitResult) {
      const url = this.submitResult.pr_url;
      // 只把 http(s) 渲染成链接；其它（javascript: 等）纯文本 <code>，不当 a 渲染
      const link = /^https?:\/\//i.test(url)
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:#6fa8dc;">${escapeHtml(url)}</a>`
        : `<code>${escapeHtml(url)}</code>`;
      return `<div style="margin-top:6px;font-size:11px;line-height:1.8;">
        <div><span style="color:#5cb85c;">✓</span> 已开 PR：${link}；草稿已清，勿重复提交</div>
        <div style="color:#9aa4b2;">分支 <code>${escapeHtml(this.submitResult.branch)}</code>｜commit <code>${escapeHtml(this.submitResult.commit)}</code></div>
        <div style="color:#e9c46a;">tmp/ 里的草稿与暂存区已随提交清掉：再点提交只会拿到空草稿；如需再提交，先刷新面板重新收集验收结果。</div>
        <div style="color:#9aa4b2;">合并由业主在 GitHub 上亲手点；刷新面板查看最新验收状态。</div>
      </div>`;
    }
    if (this.submitArmed) {
      return `<div style="margin-top:6px;color:#e9c46a;font-size:11px;">确认态：再点一次「确认提交（开 PR）」才会建分支、写 audit_log、push 并开 PR；切包或改动草稿会取消确认态。</div>`;
    }
    return '';
  }

  /** 提交失败的 detail：可能是门禁数组（422）或字符串（409 回滚原因）。 */
  private renderDetail(detail: unknown): string {
    if (detail == null) return '';
    if (Array.isArray(detail)) {
      return detail.map((item) => {
        if (item && typeof item === 'object' && 'name' in item) {
          const gate = item as {name?: string; detail?: string};
          return `${escapeHtml(gate.name ?? '')}：${escapeHtml(gate.detail ?? '')}`;
        }
        return escapeHtml(String(item));
      }).join('\n');
    }
    return escapeHtml(String(detail));
  }

  private renderFoot(pkg: SchedulePackageView): string {
    return `<div style="color:#9aa4b2;font-size:11px;line-height:1.7;">
      项目数据指纹：<code>${escapeHtml(shortHash(pkg.project_fingerprint))}</code>（前 12 位；完整值在服务端）｜
      快照指纹：<code>${escapeHtml(shortHash(this.payload?.data_fingerprint))}</code>。
      草稿只存 tmp/；进仓库的唯一路径是分支 + commit + PR，合并由业主亲手点（铁律）。
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
    // 3D 作用域拉取失败的重试（2026-11-03 修设计稿 P2-6）：旧实现只显示「暂不可用」，
    // 业主遇到瞬时失败只能刷新整个页面。重走 loadProjectScope（它自带 loading 态与
    // 选中防串检查），失败可再次重试。
    body.querySelector('#schedule-detail-scope-retry')?.addEventListener('click', () => {
      void this.loadProjectScope(pkg.id);
    });
    this.bindCheckOps(body, pkg);
    this.bindAcceptanceActions(body);
  }

  private bindCheckOps(body: HTMLElement, pkg: SchedulePackageView): void {
    for (const button of Array.from(body.querySelectorAll<HTMLButtonElement>('[data-status-btn]'))) {
      const checkId = button.dataset.statusBtn ?? '';
      const status = button.dataset.status as DraftCheckResult['status'] | undefined;
      if (!checkId || !status) continue;
      button.addEventListener('click', () => {
        this.draftOf(checkId).status = status;
        this.onDraftChanged(pkg.id);
        this.updateSaveUi(pkg);
      });
    }
    const textBindings: Array<{selector: string; datasetKey: string; key: 'checked_by' | 'checked_at' | 'note' | 'supersedes'}> = [
      {selector: '[data-checked-by]', datasetKey: 'checkedBy', key: 'checked_by'},
      {selector: '[data-checked-at]', datasetKey: 'checkedAt', key: 'checked_at'},
      {selector: '[data-note]', datasetKey: 'note', key: 'note'},
      {selector: '[data-supersedes]', datasetKey: 'supersedes', key: 'supersedes'},
    ];
    for (const {selector, datasetKey, key} of textBindings) {
      for (const input of Array.from(body.querySelectorAll<HTMLInputElement>(selector))) {
        const checkId = input.dataset[datasetKey] ?? '';
        if (!checkId) continue;
        input.addEventListener('input', () => {
          this.draftOf(checkId)[key] = input.value;
          this.onDraftChanged(pkg.id);
          this.updateSaveUi(pkg);
        });
      }
    }
    for (const host of Array.from(body.querySelectorAll<HTMLElement>('[data-evidence-area]'))) {
      const checkId = host.dataset.evidenceArea ?? '';
      if (checkId) this.bindEvidenceArea(host, pkg, checkId);
    }
  }

  private bindEvidenceArea(host: HTMLElement, pkg: SchedulePackageView, checkId: string): void {
    const fileInput = host.querySelector<HTMLInputElement>('[data-evidence-file]');
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const state = this.draftOf(checkId);
      state.uploading = true;
      state.stagedError = null;
      this.updateSaveUi(pkg);
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? '');
        const comma = text.indexOf(',');
        // dataURL 取逗号后段（服务端只要 base64 本体）
        const base64 = comma >= 0 ? text.slice(comma + 1) : text;
        void this.uploadEvidence(pkg.id, checkId, file.name, base64);
      };
      reader.onerror = () => {
        state.uploading = false;
        state.stagedError = '文件读取失败';
        this.updateSaveUi(pkg);
      };
      reader.readAsDataURL(file);
    });
    host.querySelector('[data-evidence-finalize]')?.addEventListener('click', () => {
      void this.finalizeEvidence(pkg, checkId);
    });
    for (const button of Array.from(host.querySelectorAll<HTMLButtonElement>('[data-evidence-remove]'))) {
      button.addEventListener('click', () => {
        const path = button.dataset.evidencePath ?? '';
        const state = this.draftOf(checkId);
        state.evidence = state.evidence.filter((item) => item !== path);
        this.onDraftChanged(pkg.id);
        this.updateSaveUi(pkg);
      });
    }
  }

  private bindAcceptanceActions(scope: HTMLElement): void {
    const packageId = this.actionPackageId;
    if (!packageId) return;
    // 保存失败重试（2026-11-03 codex 四审）：flush 失败后草稿在内存，显式重跑一次
    scope.querySelector('[data-save-retry]')?.addEventListener('click', () => {
      this.saveRecordFor(packageId).dirty = true;
      void this.saveDraft(packageId);
    });
    scope.querySelector('#acceptance-run-gates')?.addEventListener('click', () => {
      void this.runGates(packageId);
    });
    scope.querySelector('#acceptance-dry-run')?.addEventListener('click', () => {
      void this.runDryRun(packageId);
    });
    scope.querySelector('#acceptance-submit')?.addEventListener('click', () => {
      if (!this.dryRun || this.submitting) return;
      // 两步确认：第一次只进确认态（按钮变红），第二次才 POST
      if (!this.submitArmed) {
        this.submitArmed = true;
        this.updateAcceptanceBar();
        return;
      }
      this.submitArmed = false;
      void this.submit(packageId);
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

  // ─── 草稿加载 / 保存（tmp/，唯一写路径的前半段） ─────────────────────────

  private ensureDraft(packageId: string): void {
    if (this.draftPackageId === packageId) return;
    void this.loadDraft(packageId);
  }

  private async loadDraft(packageId: string): Promise<void> {
    // 先占位再 render：否则 render → ensureDraft 会重入本方法形成环
    this.draftPackageId = packageId;
    this.draftLoading = true;
    this.draftError = null;
    this.render();
    const seq = ++this.draftSeq;
    try {
      const response = await fetch(`/api/acceptance/draft?package_id=${encodeURIComponent(packageId)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as AcceptanceDraft;
      if (seq !== this.draftSeq || this.draftPackageId !== packageId) return;
      this.applyDraft(packageId, data.results ?? []);
      this.draftError = null;
    } catch (err) {
      if (seq !== this.draftSeq || this.draftPackageId !== packageId) return;
      this.draftError = err instanceof Error ? err.message : String(err);
    } finally {
      if (seq === this.draftSeq && this.draftPackageId === packageId) this.draftLoading = false;
    }
    if (this.selection.get().packageId === packageId) this.render();
  }

  /**
   * 服务端草稿回填，**任何加载都走合并**（2026-11-03 codex 六审 blocking 后
   * 无条件化）：服务端有值的字段以服务端为准（已保存即事实），为空的字段保留
   * 本地值（刚敲的检查人/备注/证据不被重取抹掉）；其他包的条目原样保留。
   */
  private applyDraft(packageId: string, results: DraftCheckResult[]): void {
    const byCheck = new Map(results.map((result) => [result.check_id, result]));
    const next = new Map<string, CheckDraftState>();
    // 2026-11-03 codex 六审 blocking：合并分支**无条件执行**（旧实现仅
    // previousPackage === packageId 时走）。旧行为下换包会整体重建
    // draftResults——A 未保存的编辑在切到 B 时被丢；回 A 加载到服务端旧草稿，
    // 此时点「重试保存」PUT 的是旧内容，失败的编辑永久丢失（内存复现实测：
    // 两次 PUT 的备注依次为新编辑、旧备注）。无条件合并后：
    //  - 本包检查：服务端有值的字段以服务端为准（已保存即事实），为空的保留本地
    //    （未保存编辑不被抹——重试因此拿到失败时的最新草稿）；
    //  - 其他包的条目：原样带过来（换包不崩别包的未保存编辑）。
    // dirty=true = 该包有未保存编辑（保存失败也保持 dirty）。此时**本地胜出**——
    // 否则服务端旧值会在回填时把未保存的新编辑吞掉，重试存的就是旧内容
    // （codex 六审 blocking 的「重试丢失编辑」另一半）。
    const localWins = this.saveRecordFor(packageId).dirty;
    for (const [checkId, local] of this.draftResults) {
      const fromServer = byCheck.get(checkId);
      if (fromServer) {
        next.set(checkId, {
          status: localWins && local.status ? local.status : fromServer.status,
          checked_by: localWins && local.checked_by.trim() ? local.checked_by : (fromServer.checked_by?.trim() ? fromServer.checked_by : local.checked_by),
          checked_at: localWins && local.checked_at.trim() ? local.checked_at : (fromServer.checked_at?.trim() ? fromServer.checked_at : local.checked_at),
          note: localWins && local.note.trim() ? local.note : (fromServer.note?.trim() ? fromServer.note : local.note),
          supersedes: localWins && local.supersedes.trim() ? local.supersedes : (fromServer.supersedes?.trim() ? fromServer.supersedes : local.supersedes),
          evidence: (fromServer.evidence?.length ?? 0) > 0 ? [...fromServer.evidence] : local.evidence,
          staged: local.staged,
          stagedError: null,
          uploading: false,
          issues: [],
        });
      } else {
        // 服务端没有这一条（含其他包的条目）：本地选过状态/填过内容的都留着
        next.set(checkId, {...local, issues: []});
      }
    }
    for (const [checkId, result] of byCheck) {
      if (next.has(checkId)) continue;
      next.set(checkId, {
        status: result.status,
        checked_by: result.checked_by ?? '',
        checked_at: result.checked_at || todayText(),
        note: result.note ?? '',
        supersedes: result.supersedes ?? '',
        evidence: [...(result.evidence ?? [])],
        staged: null,
        stagedError: null,
        uploading: false,
        issues: [],
      });
    }
    this.draftResults = next;
  }

  private defaultDraftState(): CheckDraftState {
    return {
      status: null,
      checked_by: '',
      checked_at: todayText(),
      note: '',
      supersedes: '',
      evidence: [],
      staged: null,
      stagedError: null,
      uploading: false,
      issues: [],
    };
  }

  private draftOf(checkId: string): CheckDraftState {
    let state = this.draftResults.get(checkId);
    if (!state) {
      state = this.defaultDraftState();
      this.draftResults.set(checkId, state);
    }
    return state;
  }

  /** 只读取（渲染用）：不往 map 里塞空条目，避免「草稿计数」虚高。 */
  private peekDraft(checkId: string): CheckDraftState {
    return this.draftResults.get(checkId) ?? this.defaultDraftState();
  }

  private selectedCount(packageId: string): number {
    if (!packageId) return 0;
    const pkg = this.payload?.packages.find((item) => item.id === packageId);
    if (!pkg) return 0;
    let count = 0;
    for (const check of pkg.checks) {
      if (this.draftResults.get(check.id)?.status) count += 1;
    }
    return count;
  }

  private onDraftChanged(packageId: string): void {
    const record = this.saveRecordFor(packageId);
    record.dirty = true;
    record.status = {kind: 'idle'};
    record.issues = [];
    this.scheduleSave(packageId);
  }

  /** 输入事件改本地状态 + debounce；定时器记录目标包，选中已换包则跳过。 */
  private scheduleSave(packageId: string): void {
    this.saveTargetPackage = packageId;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const target = this.saveTargetPackage;
      this.saveTargetPackage = null;
      if (target && this.selection.get().packageId === target) void this.saveDraft(target);
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * 立即执行待保存草稿（退出审批页前由 App 调用）。2026-11-03 codex 审查 blocking：
   * debounce 定时器的回调查「当前选中仍是目标包」才保存，而退出审批页会清选中——
   * 改完备注立刻点「返回 3D」/浏览器返回，PUT 被跳过、刷新即丢编辑。flush 不依赖
   * 选中态（目标包在 saveTargetPackage 里已捕获，saveDraft 自带空 results 守卫），
   * 无待保存时是 no-op。
   */
  flushSave(): void {
    if (this.saveTimer === null) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const target = this.saveTargetPackage;
    this.saveTargetPackage = null;
    if (target) void this.saveDraft(target);
  }

  private collectResults(packageId: string): DraftCheckResult[] {
    const pkg = this.payload?.packages.find((item) => item.id === packageId);
    if (!pkg) return [];
    const results: DraftCheckResult[] = [];
    for (const check of pkg.checks) {
      const state = this.draftResults.get(check.id);
      if (!state || !state.status) continue;
      const result: DraftCheckResult = {
        check_id: check.id,
        status: state.status,
        checked_by: state.checked_by.trim(),
        checked_at: state.checked_at.trim(),
        evidence: [...state.evidence],
      };
      if (state.note.trim()) result.note = state.note.trim();
      if (state.supersedes.trim()) result.supersedes = state.supersedes.trim();
      results.push(result);
    }
    return results;
  }

  private async saveDraft(packageId: string): Promise<void> {
    const record = this.saveRecordFor(packageId);
    const results = this.collectResults(packageId);
    if (results.length === 0) {
      // 没有任何已选状态时绝不 PUT：空 results 会覆盖 tmp/ 里已有草稿
      record.status = {kind: 'idle'};
      this.updateSaveUiFor(packageId);
      return;
    }
    // 请求版本号（仿 draftSeq，按包）：响应回头时若不是该包最新一轮，结果作废。
    // 跨包污染由按包记录兜住；版本号只治同包的旧响应迟到（codex 五审 blocking）。
    const seq = (this.saveSeqByPkg.get(packageId) ?? 0) + 1;
    this.saveSeqByPkg.set(packageId, seq);
    record.status = {kind: 'saving'};
    this.updateSaveUiFor(packageId);
    try {
      const response = await fetch('/api/acceptance/draft', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({package_id: packageId, results}),
      });
      const data = (await response.json().catch(() => ({}))) as {ok?: boolean; issues?: DraftIssue[]; error?: string};
      // 2026-11-03 codex 四审 blocking：这里原来有「选中已换包就 return」的守卫，
      // 退出审批页会清选中——PUT 失败时静默 return，状态永远停在 saving、草稿只剩
      // 内存，业主以为存了。现已双重保险：① 按包记录（跨包响应互不可见，五审）；
      // ② seq 版本号（同包旧响应作废，五审）。渲染侧 updateSaveUiFor 仍有选中
      // 守卫（人走开就不渲染），但状态侧一律落账。
      if (seq !== this.saveSeqByPkg.get(packageId)) return;
      if (response.ok && data.ok) {
        record.status = {kind: 'saved', at: new Date().toLocaleTimeString('zh-CN', {hour12: false})};
        record.dirty = false;
        record.issues = [];
        // 成功分支的清理**按包隔离**（2026-11-03 codex 六审 major）：旧实现遍历全表
        // draftResults 清 issues + 无条件 resetSubmitState——A 的迟到成功会把 B 行上
        // 的错误、B 刚跑出的门禁/预演一起抹掉（内存复现：B 的 issues 变空、gates 与
        // dryRun 均变 null）。只清该包各检查的行 issues；提交态只在当前操作包就是
        // 该包时重置。
        const savedPkg = this.payload?.packages.find((item) => item.id === packageId);
        for (const check of savedPkg?.checks ?? []) {
          const state = this.draftResults.get(check.id);
          if (state) state.issues = [];
        }
        if (this.actionPackageId === packageId) {
          // 草稿变了：旧卡点/预演/提交结论全部作废，不许拿旧结论放行新草稿
          this.resetSubmitState();
        }
      } else if (response.status === 422 && Array.isArray(data.issues)) {
        this.applyIssues(packageId, data.issues); // 内部已写入该包记录的 issues
        record.status = {kind: 'error', message: `草稿校验没过（${data.issues.length} 条，见各行红字）`};
      } else {
        record.issues = [];
        record.status = {kind: 'error', message: data.error ?? `HTTP ${response.status}`};
      }
    } catch (err) {
      // 网络错同理：不管选中在不在都要留痕（seq 过期仍作废）
      if (seq !== this.saveSeqByPkg.get(packageId)) return;
      record.issues = [];
      record.status = {kind: 'error', message: err instanceof Error ? err.message : String(err)};
    }
    this.updateSaveUiFor(packageId);
  }

  /** 422 issues 按 check_id 挂回对应行；check_id 为 '*' 的进包级提示。 */
  private applyIssues(packageId: string, issues: DraftIssue[]): void {
    const byCheck = new Map<string, DraftIssue[]>();
    const packageLevel: DraftIssue[] = [];
    for (const issue of issues) {
      const key = issue.check_id || '*';
      if (key === '*') {
        packageLevel.push(issue);
        continue;
      }
      const list = byCheck.get(key) ?? [];
      list.push(issue);
      byCheck.set(key, list);
    }
    for (const state of this.draftResults.values()) state.issues = [];
    for (const [checkId, list] of byCheck) {
      const state = this.draftResults.get(checkId);
      if (state) state.issues = list;
      else this.draftResults.set(checkId, {...this.defaultDraftState(), issues: list});
    }
    this.saveRecordFor(packageId).issues = packageLevel;
  }

  // ─── 证据暂存 / 落定 ────────────────────────────────────────────────────

  private async uploadEvidence(packageId: string, checkId: string, filename: string, base64: string): Promise<void> {
    const state = this.draftOf(checkId);
    try {
      const response = await fetch('/api/acceptance/evidence', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({package_id: packageId, check_id: checkId, filename, data_base64: base64}),
      });
      const data = (await response.json().catch(() => ({}))) as {staging_path?: string; sha256?: string; size?: number; error?: string};
      if (this.selection.get().packageId !== packageId) return;
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      state.staged = {
        staging_path: String(data.staging_path ?? ''),
        sha256: String(data.sha256 ?? ''),
        size: Number(data.size ?? 0),
      };
      state.stagedError = null;
    } catch (err) {
      if (this.selection.get().packageId !== packageId) return;
      state.stagedError = err instanceof Error ? err.message : String(err);
    } finally {
      state.uploading = false;
    }
    this.updateSaveUiFor(packageId);
  }

  private async finalizeEvidence(pkg: SchedulePackageView, checkId: string): Promise<void> {
    const state = this.draftOf(checkId);
    if (!state.staged) return;
    const stagingPath = state.staged.staging_path;
    try {
      const response = await fetch('/api/acceptance/evidence/finalize', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({package_id: pkg.id, check_id: checkId, staging_path: stagingPath}),
      });
      const data = (await response.json().catch(() => ({}))) as {final_path?: string; sha256?: string; error?: string};
      if (this.selection.get().packageId !== pkg.id) return;
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      const finalPath = String(data.final_path ?? '');
      if (finalPath && !state.evidence.includes(finalPath)) state.evidence.push(finalPath);
      state.staged = null;
      state.stagedError = null;
      this.onDraftChanged(pkg.id);
    } catch (err) {
      if (this.selection.get().packageId !== pkg.id) return;
      state.stagedError = err instanceof Error ? err.message : String(err);
    }
    this.updateSaveUi(pkg);
  }

  // ─── 机械卡点 / PR 预演 / 提交 ──────────────────────────────────────────

  /** 卡点/预演/提交结论作废（换包、草稿变化时调）；不动保存状态行。 */
  private resetSubmitState(): void {
    this.gates = null;
    this.gatesError = null;
    this.gatesLoading = false;
    this.dryRun = null;
    this.dryRunError = null;
    this.dryRunLoading = false;
    this.submitArmed = false;
    this.submitting = false;
    this.submitResult = null;
    this.submitError = null;
  }

  private async runGates(packageId: string): Promise<void> {
    this.gatesLoading = true;
    this.gatesError = null;
    this.updateAcceptanceBar();
    try {
      const response = await fetch('/api/acceptance/gates', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({package_id: packageId}),
      });
      const data = (await response.json().catch(() => ({}))) as {ok?: boolean; gates?: GateView[]; error?: string};
      if (this.selection.get().packageId !== packageId) return;
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      this.gates = {ok: Boolean(data.ok), gates: Array.isArray(data.gates) ? data.gates : []};
      if (!this.gates.ok) {
        this.dryRun = null;
        this.dryRunError = null;
        this.submitArmed = false;
      }
    } catch (err) {
      if (this.selection.get().packageId !== packageId) return;
      this.gatesError = err instanceof Error ? err.message : String(err);
    } finally {
      this.gatesLoading = false;
    }
    if (this.selection.get().packageId === packageId) this.updateAcceptanceBar();
  }

  private async runDryRun(packageId: string): Promise<void> {
    // 预演要求卡点全绿（按钮可用性由 renderAcceptanceActions 把关，这里双保险）
    if (this.gates?.ok !== true) return;
    this.dryRunLoading = true;
    this.dryRunError = null;
    this.updateAcceptanceBar();
    try {
      const response = await fetch('/api/acceptance/submit', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({package_id: packageId, dry_run: true}),
      });
      const data = (await response.json().catch(() => ({}))) as {
        dry_run?: boolean; records?: AuditRecordProjection[]; pr_body?: string; error?: string; gates?: GateView[];
      };
      if (this.selection.get().packageId !== packageId) return;
      if (response.status === 422 && Array.isArray(data.gates)) {
        // 卡点不过：把返回的 gates 回填卡点区，不留在「预演失败」的迷雾里
        this.gates = {ok: false, gates: data.gates};
        this.dryRun = null;
        this.submitArmed = false;
        this.dryRunError = data.error ?? '机械卡点未通过';
      } else if (!response.ok) {
        this.dryRunError = data.error ?? `HTTP ${response.status}`;
      } else {
        this.dryRun = {records: data.records ?? [], pr_body: String(data.pr_body ?? '')};
        this.dryRunError = null;
        this.submitArmed = false;
        this.submitResult = null;
        this.submitError = null;
      }
    } catch (err) {
      if (this.selection.get().packageId !== packageId) return;
      this.dryRunError = err instanceof Error ? err.message : String(err);
    } finally {
      this.dryRunLoading = false;
    }
    if (this.selection.get().packageId === packageId) this.updateAcceptanceBar();
  }

  private async submit(packageId: string): Promise<void> {
    this.submitting = true;
    this.submitError = null;
    this.submitResult = null;
    this.updateAcceptanceBar();
    try {
      const response = await fetch('/api/acceptance/submit', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({package_id: packageId}),
      });
      const data = (await response.json().catch(() => ({}))) as {
        branch?: string; commit?: string; pr_url?: string; error?: string; detail?: unknown;
      };
      if (this.selection.get().packageId !== packageId) return;
      if (!response.ok) {
        this.submitError = {error: data.error ?? `HTTP ${response.status}`, detail: data.detail};
      } else {
        this.submitResult = {
          branch: String(data.branch ?? ''),
          commit: String(data.commit ?? ''),
          pr_url: String(data.pr_url ?? ''),
        };
      }
    } catch (err) {
      if (this.selection.get().packageId !== packageId) return;
      this.submitError = {error: err instanceof Error ? err.message : String(err)};
    } finally {
      this.submitting = false;
    }
    if (this.selection.get().packageId === packageId) this.updateAcceptanceBar();
  }

  // ─── 局部重绘（保光标：只碰状态行/红字/按钮态，不重建文本输入框） ─────────

  private bodyEl(): HTMLElement | null {
    return this.el?.querySelector('#schedule-detail-body') as HTMLElement | null;
  }

  private updateSaveUi(pkg: SchedulePackageView): void {
    const body = this.bodyEl();
    if (!body) return;
    const saveLine = body.querySelector('[data-save-status]');
    if (saveLine) {
      saveLine.innerHTML = this.saveStatusLine(pkg.id);
      // 重试按钮是 innerHTML 换出来的新 DOM——换完就地绑（2026-11-03 codex 四审）
      saveLine.querySelector('[data-save-retry]')?.addEventListener('click', () => {
        this.saveRecordFor(pkg.id).dirty = true;
        void this.saveDraft(pkg.id);
      });
    }
    const draftLine = body.querySelector('[data-draft-status]');
    if (draftLine) draftLine.innerHTML = this.draftStatusLine(pkg.id);
    for (const check of pkg.checks) {
      const state = this.peekDraft(check.id);
      for (const el of Array.from(body.querySelectorAll<HTMLElement>('[data-check-issues]'))) {
        if (el.dataset.checkIssues === check.id) el.innerHTML = this.renderIssues(state);
      }
      for (const el of Array.from(body.querySelectorAll<HTMLElement>('[data-draft-value]'))) {
        if (el.dataset.draftValue !== check.id) continue;
        el.innerHTML = escapeHtml(state.status ? DRAFT_STATUS_LABEL[state.status] : '未选择');
        el.style.color = state.status ? DRAFT_STATUS_COLOR[state.status] : NEUTRAL;
      }
      for (const button of Array.from(body.querySelectorAll<HTMLButtonElement>('[data-status-btn]'))) {
        if (button.dataset.statusBtn !== check.id) continue;
        const value = button.dataset.status as DraftCheckResult['status'] | undefined;
        const active = Boolean(value) && state.status === value;
        const color = value ? DRAFT_STATUS_COLOR[value] : NEUTRAL;
        button.setAttribute('aria-pressed', String(active));
        button.style.borderColor = active ? color : 'rgba(255,255,255,.18)';
        button.style.background = active ? color : '#2a2a3e';
        button.style.color = active ? '#10101c' : '#c9cede';
      }
      for (const host of Array.from(body.querySelectorAll<HTMLElement>('[data-evidence-area]'))) {
        if (host.dataset.evidenceArea !== check.id) continue;
        host.innerHTML = this.renderEvidenceArea(check, state);
        this.bindEvidenceArea(host, pkg, check.id);
      }
    }
    this.updateAcceptanceBar();
  }

  private updateSaveUiFor(packageId: string): void {
    if (this.selection.get().packageId !== packageId) return;
    const pkg = this.payload?.packages.find((item) => item.id === packageId);
    if (pkg) this.updateSaveUi(pkg);
  }

  private updateAcceptanceBar(): void {
    const body = this.bodyEl();
    const host = body?.querySelector('#acceptance-actions') as HTMLElement | null;
    if (!host) return;
    host.innerHTML = this.renderAcceptanceActions();
    this.bindAcceptanceActions(host);
  }

  private build(): void {
    const el = document.createElement('div');
    el.id = 'schedule-detail-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none;
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
    // 2026-11-03 路由级独立页：挂到审批页容器（不再挤预演工作台右坞——那正是
    // 「对象信息点开没东西」的挤压源）。测试只提供挂载点，见各测试 installDom。
    const stack = document.getElementById('approval-page-panels');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#schedule-detail-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#schedule-detail-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);
    this.el = el;
  }
}
