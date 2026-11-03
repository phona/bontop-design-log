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

/**
 * 用户动过的草稿字段（2026-11-03 codex 十七审 blocking）。合并回填时**动过的
 * 字段（含清空成空串）本地胜出，没动过的字段服务端逐字采用**——包级 dirty 只
 * 说明「这个包有未保存编辑」，不说明「这一行每个字段都被编辑过」：首载前只改
 * 备注时本地记录其余字段还是默认空值，整条胜出会把服务端已存的 status/验收人/
 * 证据全部抹掉，collectResults 再跳过 status=null 的行，整份覆盖 PUT 把它永久
 * 删掉（十七审复现路径）。没有这张表就分不清「用户清空了」与「用户还没填」。
 */
type DraftField = 'status' | 'checked_by' | 'checked_at' | 'note' | 'supersedes' | 'evidence';

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
  /** 用户动过的字段：合并回填的裁定依据（见 DraftField）。 */
  touched: Set<DraftField>;
}

type SaveStatus =
  | {kind: 'idle'}
  | {kind: 'saving'}
  | {kind: 'saved'; at: string}
  | {kind: 'error'; message: string};

/** 一个包的草稿保存态（跨包响应互不可见的数据基础）。 */
interface SaveRecord {
  status: SaveStatus;
  /** 有未保存编辑（保存失败也保持）。applyDraft 据此裁定本地/服务端谁胜出。 */
  dirty: boolean;
  /** 包级 422 issues（check_id='*'）；行级挂在 CheckDraftState.issues。 */
  issues: DraftIssue[];
}

/**
 * 一个包的保存/提交运行态（2026-11-03 codex 七审后结构性根治，十六审补全写路径门）。
 * 根治前保存定时器与卡点/预演/提交四件套全是**面板级单槽**——包 A 的响应晚于
 * 切包就写进包 B 的显示（五审跨包污染、六审清空门禁的同类）。现按包各一份，
 * 跨包响应在数据结构上无处可漏；配合 saveByPkg/saveSeqByPkg（保存态）与
 * draftSeq（草稿加载），异步写路径全部按包隔离或版本作废。
 * 面板级单槽只剩 draftPackageId/draftLoading/draftError/draftSeq——它由
 * draftSeq+draftPackageId 双重校验守旧响应（loadDraft 内 return），是既有
 * 安全范式；且它只影响「加载中」显示，不落任何包的数据。
 */
interface PackageEditState {
  saveTimer: ReturnType<typeof setTimeout> | null;
  saveTarget: string | null;
  /**
   * 草稿版本号：本地编辑/保存成功/服务端草稿回填都 +1。卡点与预演请求发出时
   * 记下当时版本，响应回头对不上即作废——**同包**的旧响应不许覆盖新草稿的
   * 结论（按包隔离只解决跨包，这条解决同包；codex 八审 blocking：A 的预演
   * 在途→草稿变化作废旧预演→旧响应晚到又把旧预演填回，提交按钮对着旧预览
   * 重新可用，而真实提交读的是新草稿）。PUT 在途期间版本变过（编辑或合并
   * 落账），成功回头也不算数——不清 dirty，由后续保存重发（十六审）。
   */
  draftVersion: number;
  /** 上次回填的服务端草稿内容（序列化）：重载时内容没变不作废结论，变了才作废
   *  （codex 九审 blocking：只 bump 版本拦不住「已落账的旧结论」——另一标签页
   *  改过服务端草稿后切回来，新草稿加载了但旧预演和提交按钮还亮着）。 */
  lastServerDraft: string | null;
  /**
   * 服务端推进序号（2026-11-03 codex 十六审根治）：**只有保存成功落账才 +1**。
   * GET 请求发出时记下当时序号，回头对不上=这份响应早于一次已落账的保存，
   * 看到的是旧服务端内容，必须整份作废（codex 十五审 blocking：旧 GET 回填
   * 会把刚保存的结果删掉）。序号没变=响应就是当前服务端真相，**哪怕加载期间
   * 用户编辑过**——编辑 bump 的是 draftVersion 不是 serverSeq，此时丢弃整份
   * GET 会让客户端从没见过服务端已有条目，下次全量 PUT 把它们永久删掉
   * （codex 十六审 blocking）。分不清「编辑过」与「保存成功过」正是十五审
   * 守卫误杀十六审场景的根因，两个序号各管一件事。
   */
  serverSeq: number;
  /**
   * 本包读取序号（codex 十九审 blocking 1）：每次 loadDraft(packageId) +1，
   * 响应回头对不上 = 同包有更新的读取在途（含切走后又发起的那种），这份不碰
   * 任何状态、由新读取落账。旧实现用「当前选中是不是本包」判定新旧：连续发起
   * P 的 GET1/GET2 再切 Q，GET1 先返回也会合并并放行完整态，PUT 用 GET1 的
   * 旧视图覆盖服务端、删掉只有 GET2 才带回的新条目。读取新旧只能由本包的读取
   * 序号决定，与选中态无关（选中态只决定渲不渲染）。
   */
  loadSeq: number;
  /**
   * 完整视图门（codex 十六审 blocking）：该包 draftResults 是否**已知包含
   * 服务端全部条目**。加载在途/加载失败/从未加载过 = false——此时客户端可能
   * 没见过服务端已有结果（首开包时GET未落账），而 PUT 是整份覆盖，发出去就会
   * 把没见过的条目永久删掉。GET 落账（合并回填，或被已落账保存作废）时置 true。
   * 保存在此门下搁置（saveDeferred）而非丢弃，加载落账后自动重发。
   */
  draftComplete: boolean;
  /** 同包是否有 PUT 在途。两个 body 竞态落账时先发后到的那份会删掉新条目，
   *  因此在途期间同包新保存一律搁置到它落账（十六审根治）。 */
  putInFlight: boolean;
  /** 保存被完整视图门/在途 PUT 搁置过一次：加载落账或 PUT 落账后要重发。 */
  saveDeferred: boolean;
  gates: {ok: boolean; gates: GateView[]} | null;
  gatesLoading: boolean;
  gatesError: string | null;
  dryRun: {records: AuditRecordProjection[]; pr_body: string} | null;
  dryRunLoading: boolean;
  dryRunError: string | null;
  submitArmed: boolean;
  submitting: boolean;
  submitResult: {branch: string; commit: string; pr_url: string} | null;
  submitError: {error: string; detail?: unknown} | null;
}

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
  private saveByPkg = new Map<string, SaveRecord>();
  /** 每包的保存请求版本号：响应回头时若不是该包最新一轮，结果作废（同包新旧排序）。 */
  private saveSeqByPkg = new Map<string, number>();

  private saveRecordFor(packageId: string): SaveRecord {
    let record = this.saveByPkg.get(packageId);
    if (!record) {
      record = {status: {kind: 'idle'}, dirty: false, issues: []};
      this.saveByPkg.set(packageId, record);
    }
    return record;
  }
  /**
   * 每包的保存/提交运行态：字段释义见 PackageEditState。跨包响应在数据结构上
   * 无处可漏；配合 saveByPkg/saveSeqByPkg（保存态）与 draftSeq（草稿加载），
   * 异步写路径全部按包隔离或版本作废。
   */
  private pkgRuns = new Map<string, PackageEditState>();

  private runFor(packageId: string): PackageEditState {
    let run = this.pkgRuns.get(packageId);
    if (!run) {
      run = {
        saveTimer: null, saveTarget: null, draftVersion: 0, lastServerDraft: null,
        serverSeq: 0, loadSeq: 0, draftComplete: false, putInFlight: false, saveDeferred: false,
        gates: null, gatesLoading: false, gatesError: null,
        dryRun: null, dryRunLoading: false, dryRunError: null,
        submitArmed: false, submitting: false, submitResult: null, submitError: null,
      };
      this.pkgRuns.set(packageId, run);
    }
    return run;
  }

  /** 该包草稿变了：作废在途/已有的卡点与预演结论，并 bump 版本号守迟到响应。 */
  private invalidateRunForDraftChange(packageId: string): void {
    const run = this.runFor(packageId);
    run.draftVersion += 1;
    this.resetSubmitState(packageId);
  }

  /** 卡点/预演/提交渲染键（当前选中包）；运行态按包各一份，不再随换包作废。 */
  private actionPackageId: string | null = null;

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
    // 离开某包即解除它的两步确认态——**必须在下面所有早退之前**：退出审批页会
    // 清空选中走 !packageId 早退，若把解除放在早退后面就够不着（codex 十审
    // major：A 武装→返回 3D→重选 A，确认态还在，下一次点击直接开 PR）。
    if (this.actionPackageId !== null && this.actionPackageId !== packageId) {
      this.runFor(this.actionPackageId).submitArmed = false;
    }
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

    // 运行态按包各一份（pkgRuns）：换包不 reset——切回某包能看到它上次的卡点/
    // 预演/提交结果与保存成败；旧结论放行新包的风险由「草稿变化即 reset 该包
    // 运行态」把守（onDraftChanged / saveDraft 成功分支），比换包一刀切更准。
    // 两步确认态（submitArmed）的解除已在上面早退前统一处理（离开即解除）。
    this.actionPackageId = pkg.id;

    body.innerHTML = `${error}${this.renderHeader(pkg)}${this.renderBlockers(pkg)}${this.renderBudget(pkg)}${this.renderChecks(pkg)}${this.renderProjectScope(pkg)}${this.renderAcceptanceActions(pkg)}${this.renderFoot(pkg)}`;
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
      // 保存在此期间被完整视图门搁置（codex 十六审）：不回填就不放行整份覆盖的
      // PUT——宁可让「已保存」晚到，不冒删掉没见过条目的险。编辑不丢（内存 +
      // dirty），重开本包 / refresh 重载成功后自动继续存。
      return `<span style="${base}color:#f0a9a5;">草稿读取失败：${escapeHtml(this.draftError)}（快照照常显示；保存已暂停，重开本包重载成功后自动继续）</span>`;
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

  private renderAcceptanceActions(pkg: SchedulePackageView): string {
    const run = this.runFor(pkg.id);
    const gatesGreen = run.gates?.ok === true;
    const gatesTotal = run.gates?.gates.length ?? 0;
    const gatesPassed = run.gates?.gates.filter((gate) => gate.ok).length ?? 0;
    const dryReady = run.dryRun !== null && !run.dryRunLoading;
    // 提交成功后按钮永久禁用：服务端已清草稿+暂存，再点只会拿到空草稿 422（P1-4）
    // 草稿重载未确认（在途/读取失败）时禁止提交（codex 十四审 blocking）：服务端
    // submitAcceptance 会重读服务端草稿——业主本地预演的可能与将写入的内容不
    // 一致（切包回来重载未完成、或 GET 失败时旧预演还挂着）。draftPackageId 对得上
    // 才认（单槽加载器，别包的在途不该堵本包的按钮）。
    const draftPending = (this.draftLoading || this.draftError !== null) && this.draftPackageId === pkg.id;
    const submitDisabled = !dryReady || run.submitting || run.submitResult !== null || draftPending;
    const submitLabel = run.submitting ? '提交中…'
      : run.submitResult ? '已开 PR（草稿已清，勿重复提交）'
      : run.submitArmed ? '再点一次：确认开 PR' : '确认提交（开 PR）';
    const submitStyle = run.submitArmed
      ? 'cursor:pointer;padding:4px 10px;border-radius:6px;font-size:12px;border:1px solid #d9534f;background:#5a2321;color:#ffd9d6;'
      : 'cursor:pointer;padding:4px 10px;border-radius:6px;font-size:12px;border:1px solid rgba(255,255,255,.18);background:#2a2a3e;color:#c9cede;';
    const buttonStyle = 'cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #6fa8dc;background:#2f4a63;color:#e8f2ff;font-size:12px;';
    const disabledStyle = 'padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:#2a2a3e;color:#8a93a3;font-size:12px;cursor:not-allowed;';
    return `<div id="acceptance-actions" style="margin-bottom:10px;padding:8px 10px;border:1px solid rgba(111,168,220,.35);border-radius:6px;background:rgba(111,168,220,.06);">
      <div style="font-size:13px;font-weight:600;margin-bottom:2px;">验收操作</div>
      <div style="color:#9aa4b2;font-size:11px;margin-bottom:6px;">草稿只存 tmp/；进仓库的唯一路径是分支 + commit + PR，合并由业主亲手点（铁律）。</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <button type="button" id="acceptance-run-gates"${run.gatesLoading ? ' disabled' : ''} style="${run.gatesLoading ? disabledStyle : buttonStyle}">${run.gatesLoading ? '卡点执行中…' : '跑机械卡点'}</button>
        <button type="button" id="acceptance-dry-run"${gatesGreen && !run.dryRunLoading ? '' : ' disabled'} title="${gatesGreen ? '只算将写入的记录与 PR 正文，不碰 git' : '先跑机械卡点且五道全绿'}" style="${gatesGreen && !run.dryRunLoading ? buttonStyle : disabledStyle}">${run.dryRunLoading ? '预演生成中…' : '生成 PR 预演'}</button>
        <button type="button" id="acceptance-submit"${submitDisabled ? ' disabled' : ''} title="${run.submitResult ? '已开 PR 且草稿已清，勿重复提交' : dryReady ? '两步确认：第一次只进确认态，第二次才真正开 PR' : '先生成 PR 预演'}" style="${submitDisabled ? disabledStyle : submitStyle}">${escapeHtml(submitLabel)}</button>
        ${run.gates ? `<span style="font-size:11px;color:${run.gates.ok ? '#5cb85c' : '#d9534f'};">卡点 ${gatesPassed}/${gatesTotal}</span>` : ''}
      </div>
      ${this.renderGatesArea(pkg)}
      ${this.renderDryRunArea(pkg)}
      ${this.renderSubmitArea(pkg)}
    </div>`;
  }

  private renderGatesArea(pkg: SchedulePackageView): string {
    const run = this.runFor(pkg.id);
    if (run.gatesError) {
      return `<div style="margin-top:6px;color:#f0a9a5;font-size:11px;">卡点执行失败：${escapeHtml(run.gatesError)}</div>`;
    }
    if (!run.gates) {
      return run.gatesLoading
        ? `<div style="margin-top:6px;color:#9aa4b2;font-size:11px;">卡点执行中…（含 verify:schedule，可能数十秒）</div>`
        : `<div style="margin-top:6px;color:#9aa4b2;font-size:11px;">还没跑过机械卡点：五道卡点（控制源校验 / 草稿校验 / 证据在位 / 前置与阻塞 / verify:schedule）全绿后才能生成 PR 预演。</div>`;
    }
    const rows = run.gates.gates.map((gate) => {
      const mark = gate.ok ? '✓' : '✗';
      const color = gate.ok ? '#5cb85c' : '#d9534f';
      // ✗ 的 detail 完整显示（失败逐条原因就在这）；✓ 的 detail 收起为小字
      const detailStyle = gate.ok ? 'color:#9aa4b2;font-size:10px;' : 'color:#f0a9a5;font-size:11px;white-space:pre-wrap;';
      return `<div style="margin-top:3px;font-size:11px;"><span style="color:${color};">${mark}</span> <strong>${escapeHtml(gate.name)}</strong><div style="margin-left:14px;${detailStyle}">${escapeHtml(gate.detail) || '—'}</div></div>`;
    }).join('');
    return `<div style="margin-top:6px;">${rows}</div>`;
  }

  private renderDryRunArea(pkg: SchedulePackageView): string {
    const run = this.runFor(pkg.id);
    if (run.dryRunLoading) {
      return `<div style="margin-top:6px;color:#9aa4b2;font-size:11px;">预演生成中…（跑卡点并投影将写入的 audit 记录，不碰 git）</div>`;
    }
    if (run.dryRunError) {
      return `<div style="margin-top:6px;color:#f0a9a5;font-size:11px;">预演被挡下：${escapeHtml(run.dryRunError)}（卡点明细已回填到上面）</div>`;
    }
    if (!run.dryRun) return '';
    const rows = run.dryRun.records.map((record) => `<tr>
      <td><code>${escapeHtml(record.id)}</code></td>
      <td>${escapeHtml(record.check_id)}</td>
      <td>${escapeHtml(record.status)}</td>
      <td title="${escapeHtml(record.check_spec_sha256)}">${escapeHtml(shortHash(record.check_spec_sha256))}</td>
      <td title="${escapeHtml(record.project_data_sha256)}">${escapeHtml(shortHash(record.project_data_sha256))}</td>
      <td>${escapeHtml(record.supersedes ?? '—')}</td>
    </tr>`).join('');
    return `<div style="margin-top:6px;">
      <div style="font-size:11px;font-weight:600;">PR 预演：将写入 ${run.dryRun.records.length} 条 audit 记录（未碰 git）</div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr><th style="text-align:left;">记录 id</th><th style="text-align:left;">检查</th><th style="text-align:left;">状态</th><th style="text-align:left;">check_spec 指纹</th><th style="text-align:left;">项目数据指纹</th><th style="text-align:left;">supersedes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div style="font-size:11px;font-weight:600;margin-top:4px;">PR 正文预览</div>
      <pre style="margin:2px 0 0;padding:6px 8px;border:1px solid rgba(255,255,255,.14);border-radius:5px;background:rgba(0,0,0,.25);white-space:pre-wrap;word-break:break-all;font-size:11px;max-height:220px;overflow:auto;">${escapeHtml(run.dryRun.pr_body)}</pre>
    </div>`;
  }

  private renderSubmitArea(pkg: SchedulePackageView): string {
    const run = this.runFor(pkg.id);
    if (run.submitting) {
      return `<div style="margin-top:6px;color:#9aa4b2;font-size:11px;">提交中…（建分支 → 写 audit_log → 重渲 → 复跑卡点 → commit → push → 开 PR；任一步失败自动回滚）</div>`;
    }
    if (run.submitError) {
      const detail = this.renderDetail(run.submitError.detail);
      return `<div style="margin-top:6px;color:#f0a9a5;font-size:11px;">提交失败：${escapeHtml(run.submitError.error)}${detail ? `<div style="white-space:pre-wrap;">${detail}</div>` : ''}</div>`;
    }
    if (run.submitResult) {
      const url = run.submitResult.pr_url;
      // 只把 http(s) 渲染成链接；其它（javascript: 等）纯文本 <code>，不当 a 渲染
      const link = /^https?:\/\//i.test(url)
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:#6fa8dc;">${escapeHtml(url)}</a>`
        : `<code>${escapeHtml(url)}</code>`;
      return `<div style="margin-top:6px;font-size:11px;line-height:1.8;">
        <div><span style="color:#5cb85c;">✓</span> 已开 PR：${link}；草稿已清，勿重复提交</div>
        <div style="color:#9aa4b2;">分支 <code>${escapeHtml(run.submitResult.branch)}</code>｜commit <code>${escapeHtml(run.submitResult.commit)}</code></div>
        <div style="color:#e9c46a;">tmp/ 里的草稿与暂存区已随提交清掉：再点提交只会拿到空草稿；如需再提交，先刷新面板重新收集验收结果。</div>
        <div style="color:#9aa4b2;">合并由业主在 GitHub 上亲手点；刷新面板查看最新验收状态。</div>
      </div>`;
    }
    if (run.submitArmed) {
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
    this.bindAcceptanceActions(body, pkg);
  }

  private bindCheckOps(body: HTMLElement, pkg: SchedulePackageView): void {
    for (const button of Array.from(body.querySelectorAll<HTMLButtonElement>('[data-status-btn]'))) {
      const checkId = button.dataset.statusBtn ?? '';
      const status = button.dataset.status as DraftCheckResult['status'] | undefined;
      if (!checkId || !status) continue;
      button.addEventListener('click', () => {
        const state = this.draftOf(checkId);
        state.status = status;
        state.touched.add('status'); // 合并回填的裁定依据：动过的字段本地胜出
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
          const state = this.draftOf(checkId);
          state[key] = input.value;
          state.touched.add(key); // 含「清空」：空串也是用户意图，合并时 local 胜出
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
        state.touched.add('evidence'); // 删证据也是意图：合并时不吃服务端旧列表
        this.onDraftChanged(pkg.id);
        this.updateSaveUi(pkg);
      });
    }
  }

  private bindAcceptanceActions(scope: HTMLElement, pkg: SchedulePackageView): void {
    const packageId = pkg.id;
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
      const run = this.runFor(packageId);
      if (!run.dryRun || run.submitting) return;
      // 草稿重载未确认不提交（与渲染态同一守卫，双保险——codex 十四审 blocking）
      if ((this.draftLoading || this.draftError !== null) && this.draftPackageId === packageId) return;
      // 两步确认：第一次只进确认态（按钮变红），第二次才 POST
      if (!run.submitArmed) {
        run.submitArmed = true;
        this.updateAcceptanceBar(packageId);
        return;
      }
      run.submitArmed = false;
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
    const run = this.runFor(packageId);
    // 完整视图门落下（codex 十六审 blocking）：加载在途期间不保证见过服务端全部
    // 条目，而 PUT 是整份覆盖——此时发保存会把没见过的条目永久删掉。保存改走
    // 搁置（saveDeferred），加载落账后由 maybeResumeSave 重发，不丢编辑。
    run.draftComplete = false;
    // 请求发出时的服务端序号：加载在途期间有保存成功落账（序号 +1），这份 GET
    // 看到的就是旧服务端内容——**不能拿它当「服务端删除」的依据**（codex 十五审
    // blocking：旧 GET 回填会把刚保存的结果删掉，下次全量 PUT 永久抹掉）。
    // 序号没变只说明「没有保存落账」，**不**管加载期间用户编辑过没有——编辑过
    // 也必须合并回填：丢弃整份 GET 会让客户端从没见过服务端已有条目，下次全量
    // PUT 把它们永久删掉（codex 十六审 blocking）。十五审守卫误用 draftVersion
    // （编辑/保存/合并都 bump）分不清这两种变化，正是误杀这里的根因；serverSeq
    // 只有保存落账才 bump，两个序号各管一件事。
    const serverSeqAtRequest = run.serverSeq;
    // 本包读取序号：回头对不上 = 同包有更新的读取在途（codex 十九审 blocking 1）。
    // 与面板级 draftSeq/draftPackageId 分工明确：那对管「加载中」显示槽归谁，
    // 这个管「这份响应对本包是不是最新真相」——选中换走不影响前者判定后者。
    const loadSeqAtRequest = (run.loadSeq += 1);
    // 被更新请求取代只置标志、**不提前 return**——finally 清 loading、尾部重绘与
    // maybeResumeSave 都要执行（提前 return 会跳过收尾：十审十一审在运行态上犯过
    // 同一类错误，十五审的 staleRead 也是为这个，这里不重犯）。
    let superseded = false;
    try {
      const response = await fetch(`/api/acceptance/draft?package_id=${encodeURIComponent(packageId)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as AcceptanceDraft;
      if (run.loadSeq !== loadSeqAtRequest) {
        // 同包有更新的读取在途（切走后又发起的那种也算）：它落账，这份不碰状态。
        // 旧实现在这里按「当前选中是谁」放行：GET1/GET2 交错时 GET1 先返回也会
        // 合并并置 draftComplete，PUT 用 GET1 的旧视图覆盖、删掉 GET2 才能带回
        // 的新条目（codex 十九审 blocking 1，内存复现）。
        superseded = true;
      } else {
        // 是否早于一次已落账的保存（旧服务端内容，必须作废——十五审）
        const staleBySave = run.serverSeq !== serverSeqAtRequest;
        if (staleBySave) {
          // 保存已在读取在途期间落账：那份 PUT 的整份内容即服务端真相，旧 GET 作废
          // （不回填——干净态逐字采用会把刚保存的结果回退成旧值）。
          run.draftComplete = true;
        } else {
          // 当前服务端真相：走合并回填（规则见 applyDraft）。**选中已换走也照常
          // 合并**——没有更新的同包读取在途，这份就是该包最新真相；丢弃它会漏掉
          // 别处/别标签页新增的结果，恢复完整态后 PUT 把旧缓存整份覆盖上去、永久
          // 删掉它们（codex 十八审 blocking 2）。只是不渲染（选中守卫挡掉）。
          this.applyDraft(packageId, data.results ?? []);
          if (this.draftPackageId === packageId) this.draftError = null;
          run.draftComplete = true;
          // 合并落账时若有 PUT 在途：它的 body 缺这次新见的服务端条目，落账后必须
          // 重发，否则在途 PUT 会把它们删掉（十六审复现路径的收尾）。
          if (run.putInFlight) run.saveDeferred = true;
        }
      }
    } catch (err) {
      if (run.loadSeq !== loadSeqAtRequest) {
        superseded = true; // 更新的读取在途：错误也归它报
      } else if (this.draftPackageId === packageId) {
        // 加载失败：视图仍不完整，保存继续搁置（draftError 有显式提示；重开本包 /
        // refresh 会重发加载）。不回填、不置 draftComplete——PUT 会删没见过的条目。
        this.draftError = err instanceof Error ? err.message : String(err);
      } else {
        // 失败且选中已换走：不设 draftError（那是别包加载的显示槽），视图同样
        // 保持不完整——保存继续搁置，重开本包重载落账后恢复。
        superseded = true;
      }
    } finally {
      // finally 清 loading，尾部重绘消掉「加载中」
      if (seq === this.draftSeq && this.draftPackageId === packageId) this.draftLoading = false;
    }
    if (this.selection.get().packageId === packageId) this.render();
    this.maybeResumeSave(packageId);
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
    // dirty=true = 该包有未保存编辑（保存失败也保持 dirty）。此时合并规则是
    // **字段级**的（2026-11-03 codex 十七审 blocking）：用户动过的字段（含
    // 「删空」这个意图）本地胜出，没动过的字段服务端逐字采用。旧实现是本地
    // 整条胜出——首载前只改备注时，本地记录其余字段还是默认空值（status=null），
    // 服务端已存的 status/验收人/证据被全部跳过；随后 collectResults 跳过
    // status=null 的行，整份覆盖 PUT 把该结果永久删掉（十七审内存复现）。
    // 「用户清空了某字段」与「用户还没填某字段」靠 touched 集区分，没有第二套
    // 猜默认值的逻辑（猜了就必然在某一侧静默丢数据）。
    const localWins = this.saveRecordFor(packageId).dirty;
    // 本包检查 id 全集（来自快照 payload，不是服务端草稿的子集）——用来区分
    // 「别包缓存条目」与「本包条目」：前者永留，后者按 dirty/服务端裁定。
    const myCheckIds = new Set(
      (this.payload?.packages.find((item) => item.id === packageId)?.checks ?? []).map((check) => check.id),
    );
    for (const [checkId, local] of this.draftResults) {
      const fromServer = byCheck.get(checkId);
      if (fromServer) {
        if (localWins) {
          // 字段级裁定（codex 十七审 blocking）：touched 的字段本地胜出（含清空），
          // 没动过的字段服务端逐字采用——首载前只改备注也不会丢掉服务端已存的
          // status/验收人/证据。staged/uploading 是本地上传中的瞬态、不是服务端
          // 数据，保留 local。
          next.set(checkId, {
            status: local.touched.has('status') ? local.status : fromServer.status,
            checked_by: local.touched.has('checked_by') ? local.checked_by : (fromServer.checked_by ?? ''),
            checked_at: local.touched.has('checked_at') ? local.checked_at : (fromServer.checked_at || todayText()),
            note: local.touched.has('note') ? local.note : (fromServer.note ?? ''),
            supersedes: local.touched.has('supersedes') ? local.supersedes : (fromServer.supersedes ?? ''),
            evidence: local.touched.has('evidence') ? [...local.evidence] : [...(fromServer.evidence ?? [])],
            staged: local.staged,
            stagedError: null,
            uploading: false,
            issues: [],
            touched: new Set(local.touched), // 未落账的编辑意图接着带
          });
          continue;
        }
        // 干净态（dirty=false）：**服务端字段逐字采用，含空值**。旧实现有字段级
        // 回落（服务端 note 为空就用本地旧值）——那是 dirty 规则出现前的旧机制，
        // 现在既有害又冗余：别处清空 note/evidence 后切包回来，旧值会复活并被
        // 下次编辑 PUT 回去（codex 十三审 blocking）。未保存编辑的保护由上面
        // localWins 分支负责，这里不需要第二套。
        // staged/uploading 是本地上传中的瞬态、不是服务端数据，保留 local。
        next.set(checkId, {
          status: fromServer.status,
          checked_by: fromServer.checked_by ?? '',
          checked_at: fromServer.checked_at || todayText(),
          note: fromServer.note ?? '',
          supersedes: fromServer.supersedes ?? '',
          evidence: [...(fromServer.evidence ?? [])],
          staged: local.staged,
          stagedError: null,
          uploading: false,
          issues: [],
          touched: new Set(local.touched), // 干净态无未存编辑，touched 实际为空
        });
      } else if (!myCheckIds.has(checkId)) {
        // 别包的缓存条目：原样保留（切包不崩别包的未保存编辑）
        next.set(checkId, {...local, issues: []});
      } else if (local.touched.size > 0) {
        // 本包、服务端没返回、**这一行有未落账编辑**：本地胜出（用户新建的结果，
        // 或失败周期里改过的行——本地是用户当前真相，含删空）。
        next.set(checkId, {...local, issues: []});
      }
      // 本包、服务端没返回、这一行也没动过（touched 为空）= 服务端删了这条结果
      // ——**丢弃**。两条旧实现都错在这里：十二审前是无条件保留（干净态也复活）；
      // 七审后改用包级 localWins（别行的编辑会把本行已删结果复活，下次 PUT 写回、
      // 静默撤销服务端删除——codex 十九审 blocking 2）。裁定单位必须是**条目自己
      // 的编辑意图**：这一行自上次服务端确认后没动过，服务端删了就是删了。
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
        touched: new Set(), // 服务端原样采纳的条目：没有任何本地编辑意图
      });
    }
    this.draftResults = next;
    // 服务端草稿回填：内容真变了才作废已落账的卡点/预演/确认态（codex 九审
    // blocking——另一标签页改过草稿后切回来，旧结论必须让位）；内容没变（无变化
    // 重载/刷新）只 bump 版本拦在途响应，不误伤业主刚跑出的结论。
    const run = this.runFor(packageId);
    const incoming = JSON.stringify(results);
    if (run.lastServerDraft !== null && run.lastServerDraft !== incoming) {
      this.invalidateRunForDraftChange(packageId);
    } else {
      run.draftVersion += 1;
    }
    run.lastServerDraft = incoming;
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
      touched: new Set(),
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
    // 本地编辑 = 草稿变化：在途/已有的卡点与预演结论作废（版本号 +1 守迟到响应）。
    // 这个版本号同时是在途 PUT 的成功门（draftVersion 对不上即旧 body 成功不算
    // 数，十六审）——编辑与合并落账都 bump 它，一套机制覆盖两种变化。
    this.invalidateRunForDraftChange(packageId);
    this.scheduleSave(packageId);
  }

  /**
   * 输入事件改本地状态 + debounce。定时器**按包持有**（2026-11-03 codex 根治）：
   * 旧实现是面板级单槽，切到别的包编辑会 clearTimeout 掉这个包待存的编辑——
   * 保存被静默推迟到下次触碰该包。现在各包定时器互不干扰；回调也不再查选中
   * （按包落账，saveDraft 内部有 seq 守卫），退出清选中同样不妨碍保存。
   */
  private scheduleSave(packageId: string): void {
    const run = this.runFor(packageId);
    if (run.saveTimer !== null) clearTimeout(run.saveTimer);
    run.saveTarget = packageId;
    run.saveTimer = setTimeout(() => {
      run.saveTimer = null;
      const target = run.saveTarget;
      run.saveTarget = null;
      if (target) void this.saveDraft(target);
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
    // 按包 flush：退出审批页前把**所有包**待存的编辑都落盘（切包留下待存定时器
    // 不再被遗忘——根治前单槽定时器会被后一个包的编辑清掉）
    for (const run of this.pkgRuns.values()) {
      if (run.saveTimer === null) continue;
      clearTimeout(run.saveTimer);
      run.saveTimer = null;
      const target = run.saveTarget;
      run.saveTarget = null;
      if (target) void this.saveDraft(target);
    }
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

  /**
   * 搁置的保存重发（codex 十六审）：完整视图门/在途 PUT 放行后，把当时搁置的
   * 保存意图重新排上 debounce——内容在 saveDraft 入口现取，合并新见的服务端
   * 条目自然进下一份 body。条件不满足就继续搁置：不丢（dirty 与 saveDeferred
   * 都在），下一个加载落账/PUT 落账事件会再来问一次。
   */
  private maybeResumeSave(packageId: string): void {
    const run = this.runFor(packageId);
    if (!run.saveDeferred || !run.draftComplete || run.putInFlight) return;
    run.saveDeferred = false;
    this.scheduleSave(packageId);
  }

  private async saveDraft(packageId: string): Promise<void> {
    const record = this.saveRecordFor(packageId);
    const run = this.runFor(packageId);
    // 写路径两道门（2026-11-03 codex 十六审 blocking 根治，十八审判定顺序）。
    // 都是**搁置不丢弃**：保存意图留在 dirty + saveDeferred 里，门开后
    // maybeResumeSave 自动重发，业主看到的只是「已保存」晚几百毫秒。
    // 门必须**先于**空结果判定（codex 十八审 blocking 1）：加载期间服务端
    // status 还没合并进来，collectResults 暂时为空是**瞬态**——按「空 results」
    // 早退会把保存意图丢掉（GET 合并后 status 出现，但定时器已消费、无人重发，
    // 刷新即丢编辑）。
    // ① 完整视图门：草稿未完整载入（加载在途/失败/从未加载）时，客户端可能
    //    没见过服务端全部条目，而 PUT 是整份覆盖——发出去就把没见过的条目
    //    （首开包时 GET 还没落账的那些）永久删掉。宁可搁置，不放行错删。
    // ② 同包串行：已有 PUT 在途时再发一份，两份 body 竞态落账，先发后到的
    //    那份会把新条目删掉；等它落账后用最新内容重发。
    if (!run.draftComplete || run.putInFlight) {
      run.saveDeferred = true;
      return;
    }
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
    // 视图版本（替代原 editVersion，codex 十六审）：PUT 在途期间本地编辑过、
    // 或加载落账合并进新见的服务端条目（draftVersion 两种变化都 bump），这份
    // 响应对应的就是旧 body——**成功也不算数**：不清 dirty，后续保存重发。
    // 旧实现只查 editVersion（仅编辑 bump），合并落账不 bump 它：在途 PUT 落账
    // 后 dirty 被清，UI 显示「已保存」而服务端并没有合并新见的那条，下次别的
    // 编辑才把它 PUT 上去——中间任何刷新都丢它。
    const draftVersionAtStart = run.draftVersion;
    record.status = {kind: 'saving'};
    this.updateSaveUiFor(packageId);
    run.putInFlight = true;
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
      if (seq !== this.saveSeqByPkg.get(packageId)) return; // 被更新请求取代：它落账时重发
      if (response.ok && data.ok) {
        // 服务端已推进到这份 body：此后早于它的 GET 响应都是旧内容（loadDraft
        // 里十五审守卫的依据）。在途变过的旧 body 也推了服务端——序号照记，
        // 漏掉的条目由重发补（serverSeq 只表达「保存落账过」，不表达内容新旧）。
        run.serverSeq += 1;
        if (run.draftVersion === draftVersionAtStart) {
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
            if (state) {
              state.issues = [];
              // 编辑周期闭环：服务端已确认这份内容，touched 清零——此后它只表示
              // 「自这次确认以来动过的字段」，合并回填时没动过的字段让位给服务端
              // （含别处/别标签页改过的新值），动过的（含清空）本地胜出。
              state.touched.clear();
            }
          }
          // 草稿变了：该包旧卡点/预演/提交结论全部作废（版本号 +1 令在途响应落账时作废）
          this.invalidateRunForDraftChange(packageId);
        }
        // 视图在途变过（编辑或合并）：dirty 留着——编辑等自己的定时器、合并落账
        // 时已置 saveDeferred，都由尾部 maybeResumeSave / 定时器重发。
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
    } finally {
      // 在途标志在所有出口都必须落（finally 包住）：漏清会把同包后续保存
      // 永久搁置在串行门后（十六审根治的新不变量）。
      run.putInFlight = false;
    }
    this.updateSaveUiFor(packageId);
    this.maybeResumeSave(packageId);
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
      if (finalPath && !state.evidence.includes(finalPath)) {
        state.evidence.push(finalPath);
        state.touched.add('evidence'); // 新证据是本地意图：合并时 local 列表胜出
      }
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
  /** 作废某包的卡点/预演/提交结论（草稿变了不许拿旧结论放行新草稿）。 */
  private resetSubmitState(packageId: string): void {
    const run = this.runFor(packageId);
    run.gates = null;
    run.gatesError = null;
    run.gatesLoading = false;
    run.dryRun = null;
    run.dryRunError = null;
    run.dryRunLoading = false;
    run.submitArmed = false;
    run.submitting = false;
    run.submitResult = null;
    run.submitError = null;
  }

  /**
   * 确保该包草稿已落账到服务端（2026-11-03 codex 审查同家族根治）：卡点/预演/
   * 提交都只发 {package_id}，服务端**重读 tmp/ 草稿**算结论——自动保存有 300ms
   * debounce，业主「改完就点」时服务端读到的还是旧草稿，预演出来的 records/pr_body
   * 与界面上的当前草稿不符（八审的版本守卫只防「结论算旧了」，防不了「服务端还没
   * 存上」）。存不上的（保存失败/完整视图门还关着）返回 false，调用方中止并留痕
   * ——宁可动作没发出去，不拿着对不上的草稿开 PR。
   */
  private async ensureDraftPersisted(packageId: string): Promise<boolean> {
    const run = this.runFor(packageId);
    for (let pass = 0; pass < 3; pass += 1) {
      // 待发的 debounce 立即执行（与退出 flush 同款）
      if (run.saveTimer !== null) {
        clearTimeout(run.saveTimer);
        run.saveTimer = null;
        const target = run.saveTarget;
        run.saveTarget = null;
        if (target) await this.saveDraft(target);
        continue;
      }
      // 在途 PUT 等它落账（saveDraft 的 finally 才清 putInFlight）
      if (run.putInFlight) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      // 没有待发也没有在途却还 dirty = 上次保存失败：原地重试一次（仍失败则如实上报）
      if (this.saveRecordFor(packageId).dirty) {
        await this.saveDraft(packageId);
        continue;
      }
      break;
    }
    return !run.putInFlight && run.saveTimer === null && !this.saveRecordFor(packageId).dirty && run.draftComplete;
  }

  private async runGates(packageId: string): Promise<void> {
    const run = this.runFor(packageId);
    run.gatesLoading = true;
    run.gatesError = null;
    this.updateAcceptanceBar(packageId);
    // 草稿先落账再跑卡点：服务端读 tmp/ 草稿算结论，没存上就跑等于对旧草稿下结论
    if (!(await this.ensureDraftPersisted(packageId))) {
      run.gatesLoading = false;
      run.gatesError = '草稿还没保存成功（见上方保存状态）：机械卡点读的是服务端 tmp/ 草稿，存上后再跑';
      this.updateAcceptanceBar(packageId);
      return;
    }
    const versionAtStart = run.draftVersion;
    run.gatesLoading = true;
    run.gatesError = null;
    this.updateAcceptanceBar(packageId);
    let stale = false;
    try {
      const response = await fetch('/api/acceptance/gates', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({package_id: packageId}),
      });
      const data = (await response.json().catch(() => ({}))) as {ok?: boolean; gates?: GateView[]; error?: string};
      // 按包落账：响应晚于切包也只写该包的运行态（根治前这里写面板级共享字段，
      // A 的卡点结果会显示在 B 的面板里——codex 五/六审同类型）。
      // 同包旧响应作废：请求发出后草稿又变过（版本号对不上，含「内容没变的重载」
      // 也 bump 版本）——结论基于旧草稿算的，提交读的却是新草稿（codex 八审）。
      // 作废只置 stale 不写结论；**重绘统一在 finally 之后**——在 try 里重绘会早于
      // finally 清 loading，画面仍显示「执行中」，return 又跳过尾部重绘，按钮卡死
      // （codex 十一审 major：十审修法的顺序错在这里）。
      if (run.draftVersion !== versionAtStart) {
        stale = true;
      } else if (!response.ok) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      } else {
        run.gates = {ok: Boolean(data.ok), gates: Array.isArray(data.gates) ? data.gates : []};
        if (!run.gates.ok) {
          run.dryRun = null;
          run.dryRunError = null;
          run.submitArmed = false;
        }
      }
    } catch (err) {
      if (run.draftVersion !== versionAtStart) stale = true;
      else run.gatesError = err instanceof Error ? err.message : String(err);
    } finally {
      run.gatesLoading = false;
    }
    void stale;
    this.updateAcceptanceBar(packageId);
  }

  private async runDryRun(packageId: string): Promise<void> {
    const run = this.runFor(packageId);
    // 预演要求卡点全绿（按钮可用性由 renderAcceptanceActions 把关，这里双保险）
    if (run.gates?.ok !== true) return;
    run.dryRunLoading = true;
    run.dryRunError = null;
    this.updateAcceptanceBar(packageId);
    // 草稿先落账再预演：服务端重读 tmp/ 草稿生成 records/pr_body，没存上就预演
    // 等于对旧草稿开预览（业主看到的内容与将提交的不一致）
    if (!(await this.ensureDraftPersisted(packageId))) {
      run.dryRunLoading = false;
      run.dryRunError = '草稿还没保存成功（见上方保存状态）：PR 预演读的是服务端 tmp/ 草稿，存上后再跑';
      this.updateAcceptanceBar(packageId);
      return;
    }
    const versionAtStart = run.draftVersion;
    run.dryRunLoading = true;
    run.dryRunError = null;
    this.updateAcceptanceBar(packageId);
    // 同 runGates：旧响应只置 stale，重绘统一在 finally 之后（codex 十一审 major）
    let stale = false;
    try {
      const response = await fetch('/api/acceptance/submit', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({package_id: packageId, dry_run: true}),
      });
      const data = (await response.json().catch(() => ({}))) as {
        dry_run?: boolean; records?: AuditRecordProjection[]; pr_body?: string; error?: string; gates?: GateView[];
      };
      // 按包落账（根治前写面板级共享字段，A 的预演结果会显示在 B 面板里）；
      // 同包旧响应作废（版本号校验，理由同 runGates——codex 八审 blocking）
      if (run.draftVersion !== versionAtStart) {
        stale = true;
      } else if (response.status === 422 && Array.isArray(data.gates)) {
        // 卡点不过：把返回的 gates 回填卡点区，不留在「预演失败」的迷雾里
        run.gates = {ok: false, gates: data.gates};
        run.dryRun = null;
        run.submitArmed = false;
        run.dryRunError = data.error ?? '机械卡点未通过';
      } else if (!response.ok) {
        run.dryRunError = data.error ?? `HTTP ${response.status}`;
      } else {
        run.dryRun = {records: data.records ?? [], pr_body: String(data.pr_body ?? '')};
        run.dryRunError = null;
        run.submitArmed = false;
        run.submitResult = null;
        run.submitError = null;
      }
    } catch (err) {
      if (run.draftVersion !== versionAtStart) stale = true;
      else run.dryRunError = err instanceof Error ? err.message : String(err);
    } finally {
      run.dryRunLoading = false;
    }
    void stale;
    this.updateAcceptanceBar(packageId);
  }

  private async submit(packageId: string): Promise<void> {
    const run = this.runFor(packageId);
    // submitting 先置位（双点守卫在 ensure 之前就生效），落账失败再复位
    run.submitting = true;
    run.submitError = null;
    run.submitResult = null;
    this.updateAcceptanceBar(packageId);
    // 草稿先落账再开 PR：submit 让服务端重读 tmp/ 草稿写入 commit，没存上就提交
    // 等于把旧草稿开成 PR（预演对不上、业主以为存了的编辑不在 PR 里）
    if (!(await this.ensureDraftPersisted(packageId))) {
      run.submitting = false;
      run.submitError = {error: '草稿还没保存成功（见上方保存状态）：提交读的是服务端 tmp/ 草稿，存上后再提交'};
      this.updateAcceptanceBar(packageId);
      return;
    }
    run.submitError = null;
    run.submitResult = null;
    this.updateAcceptanceBar(packageId);
    try {
      const response = await fetch('/api/acceptance/submit', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({package_id: packageId}),
      });
      const data = (await response.json().catch(() => ({}))) as {
        branch?: string; commit?: string; pr_url?: string; error?: string; detail?: unknown;
      };
      // 按包落账：提交是重动作，结果只归属发起包（根治前写面板级共享字段）
      if (!response.ok) {
        run.submitError = {error: data.error ?? `HTTP ${response.status}`, detail: data.detail};
      } else {
        run.submitResult = {
          branch: String(data.branch ?? ''),
          commit: String(data.commit ?? ''),
          pr_url: String(data.pr_url ?? ''),
        };
      }
    } catch (err) {
      run.submitError = {error: err instanceof Error ? err.message : String(err)};
    } finally {
      run.submitting = false;
    }
    this.updateAcceptanceBar(packageId);
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
    this.updateAcceptanceBar(pkg.id);
  }

  private updateSaveUiFor(packageId: string): void {
    if (this.selection.get().packageId !== packageId) return;
    const pkg = this.payload?.packages.find((item) => item.id === packageId);
    if (pkg) this.updateSaveUi(pkg);
  }

  /** 重渲染验收操作条（按包：只渲染当前选中包的运行态；顺带重绑事件）。 */
  private updateAcceptanceBar(packageId: string): void {
    if (this.selection.get().packageId !== packageId) return; // 响应晚于切包：不重绘别人的条
    const pkg = this.payload?.packages.find((item) => item.id === packageId);
    if (!pkg) return;
    const body = this.bodyEl();
    const host = body?.querySelector('#acceptance-actions') as HTMLElement | null;
    if (!host) return;
    host.innerHTML = this.renderAcceptanceActions(pkg);
    this.bindAcceptanceActions(host, pkg);
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
