// 自装审批「进度图 / 门禁图」面板（自装交互审批第一步，2026-11-02，设计稿 §4/§5/§9）。
//
// 数据只有一个来源：`GET /api/schedule/state`（只读，config 投影，与
// `npm run verify:schedule` 同一个 loader、同一份判定）。面板不自己算任何
// 状态——effective_status / effective_readiness / gate_status 全部由服务端
// 派生后下发，浏览器只负责呈现与选中态。
//
// 两个模式（进度图 / 门禁图）在同一面板内切换、**不合成一张图**：进度图回答
// 「包链走到哪、每包的验收与付款门槛卡在谁」，门禁图回答「还有哪些门禁没拍板、
// CI 判红口径是什么」。二者问题不同，合成一张只会两边都读不动。
//
// 交互：
//  - 顶部模式按钮切换（data-mode="progress" / "gates"，active 态可反查）；
//  - 进度图行可点（data-pkg-id）→ 写共享选中态 + 通知外部高亮 3D；
//  - 铁律：颜色之外必须有文字——状态/就绪/门槛一律同时给文字标签与色块。
import type { ScheduleSnapshot } from '@shared/schedule-state';
import type { ScheduleSelectionStore } from '../state/schedule-selection.js';
import { setupCollapsiblePanel } from './CollapsiblePanel.js';
import { escapeHtml } from './escape-html.js';

type PanelMode = 'progress' | 'gates';

export interface SchedulePanelOptions {
  /** 点某包时通知外部（App 接 HouseScene 高亮）。缺省时仅写选中态。 */
  onHighlight?: (packageId: string) => void;
}

/** 包状态词汇（control.yaml status_values + 派生值），文字标签是主、色块是辅。 */
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

const READINESS_LABEL: Record<string, string> = {
  ready: '就绪',
  blocked: '未就绪',
};

const GATE_LABEL: Record<string, string> = {
  passed: '已过',
  failed: '未过',
  pending: '待验',
};

const GATE_COLOR: Record<string, string> = {
  passed: '#5cb85c',
  failed: '#d9534f',
  pending: '#e9c46a',
};

const MODE_LABEL: Record<PanelMode, string> = {
  progress: '进度图',
  gates: '门禁图',
};

const NEUTRAL_COLOR = '#8a93a3';

function labelOf(map: Record<string, string>, value: string | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}

function colorOf(map: Record<string, string>, value: string | undefined): string {
  if (!value) return NEUTRAL_COLOR;
  return map[value] ?? NEUTRAL_COLOR;
}

export class SchedulePanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private payload: ScheduleSnapshot | null = null;
  private errorMessage: string | null = null;
  private mode: PanelMode = 'progress';

  constructor(
    private readonly selection: ScheduleSelectionStore,
    private readonly options: SchedulePanelOptions = {},
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

  /** 重新拉取快照并渲染（每次打开、外部状态变化后都调）。 */
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
    const body = this.el?.querySelector('#schedule-panel-body') as HTMLElement | null;
    if (!body) return;

    const error = this.errorMessage
      ? `<div style="margin-bottom:8px;padding:6px 8px;border:1px solid rgba(217,83,79,.55);border-radius:6px;background:rgba(217,83,79,.12);color:#f0a9a5;font-size:12px;">取数失败：${escapeHtml(this.errorMessage)}　控制源校验不过或接口不通；修好 control.yaml / 起服务后重试。</div>`
      : '';

    if (!this.payload) {
      body.innerHTML = `${error}<div style="color:#9aa4b2;font-size:12px;">未取得进度数据。</div>`;
      this.syncModeButtons();
      return;
    }

    const snapshot = this.payload;
    const content = this.mode === 'progress'
      ? this.renderProgress(snapshot)
      : this.renderGates(snapshot);
    body.innerHTML = `${error}${content}`;
    this.syncModeButtons();
    this.bind(body);
  }

  /** 进度图：包链表格（sequence 升序，含 PKG-900 侧车道）。 */
  private renderProgress(snapshot: ScheduleSnapshot): string {
    const packages = [...(snapshot.packages ?? [])].sort((left, right) => left.sequence - right.sequence);
    const head = `<div style="margin-bottom:8px;color:#9aa4b2;font-size:11px;">
      共 ${packages.length} 个工作包（含预备金侧车道）｜当前门禁：${escapeHtml(snapshot.phase.current_gate)}｜阶段状态：${escapeHtml(snapshot.phase.status)}
      ${snapshot.stale_audits.length ? `<br><span style="color:#e9c46a;">过期验收记录 ${snapshot.stale_audits.length} 条（数据或标准已变，须复验）</span>` : ''}
    </div>`;

    if (packages.length === 0) {
      return `${head}<div style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">
        当前快照没有工作包（schedule/phase-1/control.yaml 的 work_packages 为空），进度图无内容可画。
      </div>`;
    }

    const selectedId = this.selection.get().packageId;
    const rows = packages.map((pkg) => {
      const active = selectedId === pkg.id;
      const closedBlockers = pkg.blockers.filter((blocker) => blocker.closed).length;
      const statusColor = colorOf(STATUS_COLOR, pkg.effective_status);
      const gateColor = colorOf(GATE_COLOR, pkg.gate_status);
      const sideLane = pkg.sequence >= 900
        ? ' <span style="padding:1px 5px;border-radius:4px;background:rgba(155,139,208,.2);color:#c3b8ea;font-size:10px;">预备金·侧车道</span>'
        : '';
      const blocked = pkg.blockers.length > closedBlockers
        ? ` <span style="color:#e9c46a;">未关闭 ${pkg.blockers.length - closedBlockers}</span>`
        : '';
      return `<tr data-pkg-id="${escapeHtml(pkg.id)}" data-active="${active}" title="点这行：选中 ${escapeHtml(pkg.id)} 并在 3D 中高亮"
        style="cursor:pointer;${active ? 'background:rgba(111,168,220,.18);' : ''}">
        <td style="white-space:nowrap;">${pkg.sequence}</td>
        <td style="white-space:nowrap;" title="${escapeHtml(pkg.id)}">${escapeHtml(pkg.id)}</td>
        <td>${escapeHtml(pkg.name)}${sideLane}</td>
        <td style="white-space:nowrap;"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${statusColor};border:1px solid rgba(255,255,255,.25);"></span>${escapeHtml(labelOf(STATUS_LABEL, pkg.effective_status))}</td>
        <td style="white-space:nowrap;">${escapeHtml(labelOf(READINESS_LABEL, pkg.effective_readiness))}</td>
        <td style="white-space:nowrap;"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${gateColor};border:1px solid rgba(255,255,255,.25);"></span>${escapeHtml(labelOf(GATE_LABEL, pkg.gate_status))}</td>
        <td style="white-space:nowrap;">${closedBlockers}/${pkg.blockers.length}${blocked}</td>
        <td title="${escapeHtml(pkg.payment_gate)}">${escapeHtml(pkg.payment_gate)}</td>
      </tr>`;
    }).join('');

    return `${head}
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr>
          <th style="text-align:left;">序</th><th style="text-align:left;">包</th><th style="text-align:left;">名称</th>
          <th style="text-align:left;">状态</th><th style="text-align:left;">就绪</th><th style="text-align:left;">门槛</th>
          <th style="text-align:left;">阻塞</th><th style="text-align:left;">付款门槛</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      <div style="margin-top:8px;color:#9aa4b2;font-size:11px;">
        状态/就绪/门槛均由服务端从 control.yaml 派生（effective_* 已把依赖、阻塞项与验收门槛折算进去）；
        点行只写选中态与 3D 高亮，不改任何配置。写路径一律走 PR（铁律）。
      </div>`;
  }

  /** 门禁图：① 未拍板决策门禁；② CI 四任务判红口径（静态文案，不读快照）。 */
  private renderGates(snapshot: ScheduleSnapshot): string {
    const openGates = snapshot.decision_gates?.open ?? [];
    const decided = snapshot.decision_gates?.decided_count ?? 0;
    const gateCards = openGates.map((gate) => {
      const blocks = gate.blocks ?? [];
      return `<div style="margin-bottom:8px;padding:8px 10px;border:1px solid rgba(233,196,106,.45);border-radius:6px;background:rgba(233,196,106,.08);">
        <div style="font-size:12px;"><strong>${escapeHtml(gate.id)}</strong>｜${escapeHtml(gate.topic)}
          <span style="margin-left:6px;padding:1px 5px;border-radius:4px;background:rgba(233,196,106,.25);color:#f4dfa8;font-size:10px;">open·待拍板</span>
        </div>
        ${gate.question ? `<div style="margin-top:4px;color:#d8d8e4;font-size:12px;">问题：${escapeHtml(gate.question)}</div>` : ''}
        <div style="margin-top:4px;color:#9aa4b2;font-size:11px;">
          范围：${escapeHtml(gate.scope)}｜阻塞检查 ${blocks.length} 项${blocks.length ? `：${escapeHtml(blocks.join('、'))}` : ''}
        </div>
      </div>`;
    }).join('');

    const openSection = openGates.length === 0
      ? `<div style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">当前没有 open 状态的决策门禁（已拍板 ${decided} 条）。</div>`
      : `<div style="margin-bottom:6px;color:#9aa4b2;font-size:11px;">open 门禁 ${openGates.length} 条置顶；已拍板 ${decided} 条（${escapeHtml(String(decided))} 条 decided，记录在 config/decision-gates.yaml）。</div>${gateCards}`;

    const ciTasks = [
      {cmd: 'npm run ci:typecheck', label: '类型检查（root 与 app 双树）'},
      {cmd: 'npm run ci:test-server', label: '服务端测试'},
      {cmd: 'npm run ci:test-app', label: '前端测试'},
      {cmd: 'npm run ci:verify-all', label: '全量 verify（几何/数据/预算/一致性）'},
    ].map((task) => `<div style="display:flex;gap:6px;font-size:12px;line-height:1.7;">
        <code style="color:#9ecbff;">${escapeHtml(task.cmd)}</code><span style="color:#9aa4b2;">${escapeHtml(task.label)}</span>
      </div>`).join('');

    return `<div style="margin-bottom:10px;color:#9aa4b2;font-size:11px;">门禁图回答两件事：还有哪些决策没拍板、CI 按什么口径判红。</div>
      <div style="font-size:13px;font-weight:600;margin-bottom:6px;">① 决策门禁（等业主拍板）</div>
      ${openSection}
      <div style="font-size:13px;font-weight:600;margin:12px 0 6px;">② CI 四任务口径</div>
      <div style="padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(255,255,255,.04);">
        ${ciTasks}
        <div style="margin-top:6px;color:#d8d8e4;font-size:12px;">
          本地入口 <code>npm run ci:*</code> 与 GitHub Actions 用同一入口（<code>ci/check.mjs</code>）、同一解析口径。
        </div>
        <div style="margin-top:4px;color:#d8d8e4;font-size:12px;">
          判红口径只有一个：<strong>只判 <code>ci/baseline/</code> 之外的新失败</strong>；基线内失败照常完整打印在日志里，红不禁止合并（合并仍由业主决定）。
        </div>
        <div style="margin-top:4px;color:#9aa4b2;font-size:11px;">
          CI 实时状态以 Actions 或本地入口为准，不在本快照内——本卡片只是口径说明，不是实时绿灯。
        </div>
      </div>
      ${snapshot.package_gate_issues.length
        ? `<div style="margin-top:10px;color:#e9c46a;font-size:11px;">包级门禁问题 ${snapshot.package_gate_issues.length} 条：${escapeHtml(snapshot.package_gate_issues.slice(0, 5).join('；'))}${snapshot.package_gate_issues.length > 5 ? ' 等' : ''}</div>`
        : ''}`;
  }

  // ─── 事件 ────────────────────────────────────────────────────────────────

  private bind(body: HTMLElement): void {
    // 模式按钮在骨架里（不随 body 重渲染），事件在 build() 绑一次；这里只绑行。
    for (const row of Array.from(body.querySelectorAll('tr[data-pkg-id]'))) {
      row.addEventListener('click', () => {
        const packageId = String((row as HTMLElement).dataset.pkgId ?? '');
        if (!packageId) return;
        this.selection.set({packageId, checkId: null});
        this.options.onHighlight?.(packageId);
        this.render();
      });
    }
  }

  private syncModeButtons(): void {
    if (!this.el) return;
    for (const button of Array.from(this.el.querySelectorAll('button[data-mode]'))) {
      const node = button as HTMLElement;
      const mode = node.dataset.mode;
      const active = mode === this.mode;
      node.dataset.active = String(active);
      node.setAttribute('aria-pressed', String(active));
      node.style.cssText = active
        ? 'cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #6fa8dc;background:#2f4a63;color:#e8f2ff;font-size:12px;'
        : 'cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:#2a2a3e;color:#ccd;font-size:12px;';
    }
  }

  // ─── 骨架 ────────────────────────────────────────────────────────────────

  private build(): void {
    const el = document.createElement('div');
    el.id = 'schedule-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none; max-width: 520px;
    `;
    const modes = (Object.keys(MODE_LABEL) as PanelMode[])
      .map((mode) => `<button type="button" data-mode="${mode}" data-active="false" aria-pressed="false">${MODE_LABEL[mode]}</button>`)
      .join('');
    el.innerHTML = `
      <div class="dynamic-panel-heading">
        <strong>自装进度</strong>
        <button id="schedule-panel-toggle" class="panel-collapse-toggle" type="button" aria-controls="schedule-panel-content" aria-expanded="true" aria-label="自装进度面板折叠" title="折叠">−</button>
      </div>
      <div id="schedule-panel-content">
        <div style="display:flex;gap:6px;margin-bottom:8px;">${modes}</div>
        <div id="schedule-panel-body"></div>
      </div>
    `;
    // 2026-11-03 路由级独立页：挂到审批页容器（不再挤预演工作台右坞——那正是
    // 「对象信息点开没东西」的挤压源）。测试只提供挂载点，见各测试 installDom。
    const stack = document.getElementById('approval-page-panels');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#schedule-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#schedule-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);
    for (const button of Array.from(el.querySelectorAll('button[data-mode]'))) {
      button.addEventListener('click', () => {
        const mode = String((button as HTMLElement).dataset.mode ?? 'progress');
        if (mode !== 'progress' && mode !== 'gates') return;
        if (this.mode === mode) return;
        this.mode = mode;
        this.render();
      });
    }
    this.el = el;
    this.syncModeButtons();
  }
}
