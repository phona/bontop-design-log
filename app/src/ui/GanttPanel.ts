// 自装审批「动态甘特」面板（2026-11-11 issue #202 S2，设计 §7 / §6.2 / §18）。
//
// 数据只有一个来源：`GET /api/schedule/state` 的 `snapshot.schedule`（排程投影视图，
// shared/schedule-state.ts 的 ScheduleProjectionView）；包名/状态的展示取自**同一个**
// 响应的 `snapshot.packages`（不是第二数据源）。本面板**不 import**
// `shared/schedule-projection.ts`——投影的唯一实现在服务端，浏览器只渲染快照（设计 D4）；
// 也不另读 control.yaml、不拉 /api/project、不拉 /api/model-package-links（本面板无 3D 高亮）。
//
// 渲染口径（任务书 §1.1）：
//  - 区间条：baseline / forecast 都画 start_ord..end_ord_max 的**区间**，
//    start_ord..end_ord_min 是实心段（min 口径末端），end_ord_min..end_ord_max 是斜纹尾段
//    （min–max 差）。绝不把 {start, end} 画成单值条；
//  - anchor_date 为 null：横轴只标「第 N 工作日」，轴与条几何不显示任何日期（模块输出边界
//    已保证 ordinals[].date 全 null，§18；面板不得自行造年月日）。检查记录窗口的 checked_at
//    日期是证据，另行保留并固定注明「非施工起止」（§17）。
//  - check_window 是**检查记录窗口**（证据），不是施工起止（§16 正名）：只作文本展示，
//    不参与任何位置/范围计算，也不改写 forecast；
//  - blocking_reasons / constraints 随条展示，只解释不计算；constraint.status = site_pending
//    标「待定」；
//  - 颜色旁必须始终有文字：条/状态点/图例一律「色块 + 中文文字」，颜色只来自下面的固定
//    映射表，禁止把 payload 字符串当颜色用；
//  - 点条 → selection.set({packageId, checkId: null})，**不做 3D 高亮、不做 scope 展开**
//    （D5：定位与 resolvePackageScope 的唯一使用者仍是 ScheduleDetailPanel；#191 退役选择器
//    时本面板零改动）。本面板没有 onHighlight 钩子，也不提供任何高亮入口；
//  - what-if：delay 输入 → GET /api/schedule/what-if?delay=… → 用响应重渲；scenario 区
//    固定水印「演算视图，非计划；落配置走 AI 会话/PR」。演算只改本视图，不写任何配置；
//  - 空数据 / 503 态有明确文字，不渲染空骨架冒充正常；
//  - ≤700px（NARROW_MAX_PX，与 style.css 的 @media 断点同源）退化为「包列表 + 序数条」，
//    不硬画时间轴（FlowChartPanel issue #83 单列降级先例）。
//
// L2 复核（任务书 §1.5 / 设计 §18.7）：本面板是 snapshot.schedule.ordinals 的第一个消费方。
// 只读——渲染前后不改写该数组（不 sort / 不 splice / 不赋值）；测试钉住逐字节不变。
import type {
  ScheduleConstraintView,
  SchedulePackageProjectionView,
  SchedulePackageView,
  ScheduleProjectionView,
  ScheduleSnapshot,
  ScheduleWindowView,
} from '@shared/schedule-state';
import type { ScheduleSelectionStore } from '../state/schedule-selection.js';
import { setupCollapsiblePanel } from './CollapsiblePanel.js';
import { escapeHtml } from './escape-html.js';
import { NARROW_MAX_PX } from './input-capability.js';

/**
 * 演算响应来源标记（任务书 §5：「what-if 被当成计划」的入口）。renderChart 的来源行必须
 * 与本视图实际取数的端点一致：演算视图写 /api/schedule/what-if，基线写 /api/schedule/state。
 */
type ScheduleSource = 'state' | 'what-if';

/** /api/schedule/what-if 的 scenario 段（设计 §6.2；形状由 shared/schedule-projection.ts 定义）。 */
export interface GanttScenarioView {
  overrides: Array<{pkg: string; workdays: number}>;
  affected: Array<{pkg: string; delta: number}>;
}

/** 演算响应归一结果：排程视图 + scenario（无 scenario 键 = 基线）。 */
interface ResolvedScheduleView {
  schedule: ScheduleProjectionView;
  scenario: GanttScenarioView | null;
}

// ─── 固定映射表（颜色只能来自这里；文字与颜色必须同时出现）────────────────────

/** 包状态词汇（control.yaml status_values 七值 + 服务端派生值，与 SchedulePanel/FlowChartPanel 同口径）。 */
const STATUS_LABEL: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  blocked: '阻塞',
  ready_for_inspection: '待验收',
  failed: '未通过',
  passed: '已通过',
  waived: '已豁免',
};
const DERIVED_STATUSES = new Set(['stale_or_unverified', 'blocked_by_precondition']);
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
const NEUTRAL_COLOR = '#8a93a3';

/** 两条时间线：颜色 + 中文标签成对出现（颜色不是唯一证据）。 */
type LaneKind = 'baseline' | 'forecast';
const LANE_LABEL: Record<LaneKind, string> = {baseline: '基线', forecast: '预测'};
const LANE_STYLE: Record<LaneKind, {fill: string; tail: string}> = {
  baseline: {fill: '#5a7a99', tail: 'rgba(90,122,153,.55)'},
  forecast: {fill: '#6fa8dc', tail: 'rgba(111,168,220,.55)'},
};

/** 约束状态词汇（设计 §2.1(b)/§7：site_pending 标「待定」；其余 token 原样显示）。 */
const CONSTRAINT_STATUS_LABEL: Record<string, string> = {site_pending: '待定'};

const SCENARIO_WATERMARK = '演算视图，非计划；落配置走 AI 会话/PR';

const ACTIVE_BORDER = '#6fa8dc';
const MAX_VISIBLE_REASONS = 2;
const MAX_VISIBLE_CONSTRAINTS = 3;
/** 宽屏横轴最多标 12 个刻度（超出按步长抽稀，首末必标）。 */
const MAX_AXIS_TICKS = 12;
/** 标签列宽（px）：宽屏包信息列；横轴刻度与它同宽对齐。 */
const LABEL_COLUMN_PX = 240;

function labelOf(map: Record<string, string>, value: string | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}

function colorOf(map: Record<string, string>, value: string | undefined): string {
  if (!value) return NEUTRAL_COLOR;
  return map[value] ?? NEUTRAL_COLOR;
}

function statusLabelOf(value: string | undefined): string {
  if (!value) return '—';
  const base = STATUS_LABEL[value];
  if (base) return base;
  // 派生值原样显示 token 并注明（不把派生值翻译成看起来像声明值的词）
  return DERIVED_STATUSES.has(value) ? `${value}（派生）` : value;
}

function statusDot(value: string | undefined): string {
  return `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${colorOf(STATUS_COLOR, value)};border:1px solid rgba(255,255,255,.25);"></span>`;
}

function laneSwatch(kind: LaneKind): string {
  return `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${LANE_STYLE[kind].fill};border:1px solid rgba(255,255,255,.25);"></span>`;
}

function constraintTextOf(constraint: ScheduleConstraintView): string {
  const status = labelOf(CONSTRAINT_STATUS_LABEL, constraint.status);
  const detail = constraint.detail ? `：${constraint.detail}` : '';
  const date = constraint.date ? `｜日期 ${constraint.date}` : '';
  return `约束 ${constraint.id}（${constraint.type}｜${status}）${detail}${date}`;
}

/** 单条时间线的文字口径：起点 + 下界（min 末端）+ 上界（max 末端），颜色之外必须有文字。 */
function metricTextOf(kind: LaneKind, window: ScheduleWindowView): string {
  return `${LANE_LABEL[kind]}：起点 第 ${window.start_ord} 工作日｜下界 第 ${window.end_ord_min} 工作日｜上界 第 ${window.end_ord_max} 工作日`;
}

/**
 * 检查记录窗口的文字口径（设计 §16 正名 / §17）：日期是 checked_at 证据，序数在锚点未定
 * 时为 null（待定，不是 0）。文案固定带「非施工起止」，防止把证据读成实际开工窗口。
 */
function checkWindowTextOf(window: SchedulePackageProjectionView['check_window']): string {
  if (!window) return '检查记录窗口：无（未形成整包通过证据）（检查记录窗口，非施工起止）';
  const ords = typeof window.first_ord === 'number' && typeof window.last_ord === 'number'
    ? `第 ${window.first_ord}–第 ${window.last_ord} 工作日`
    : '序数待定（锚点未定）';
  return `检查记录窗口：${window.first_date} – ${window.last_date}｜${ords}（检查记录窗口，非施工起止）`;
}

// ─── 纯函数：区间几何 / 刻度 / what-if 响应归一 ─────────────────────────────

interface ChartBounds {minOrd: number; maxOrd: number}

function boundsOf(entries: Array<[string, SchedulePackageProjectionView]>): ChartBounds {
  let minOrd = Number.POSITIVE_INFINITY;
  let maxOrd = Number.NEGATIVE_INFINITY;
  for (const [, projection] of entries) {
    for (const window of [projection.baseline, projection.forecast]) {
      minOrd = Math.min(minOrd, window.start_ord, window.end_ord_min, window.end_ord_max);
      maxOrd = Math.max(maxOrd, window.start_ord, window.end_ord_min, window.end_ord_max);
    }
  }
  if (!Number.isFinite(minOrd) || !Number.isFinite(maxOrd)) return {minOrd: 1, maxOrd: 1};
  return {minOrd, maxOrd};
}

interface BarGeometry {left: string; width: string; coreWidth: string; tailWidth: string}

/** 区间条几何（百分比）：整条 = start..end_max，核心段 = start..end_min，尾段 = min..max 差。 */
function geometryOf(window: ScheduleWindowView, bounds: ChartBounds): BarGeometry {
  const span = Math.max(1, bounds.maxOrd - bounds.minOrd + 1);
  const start = Math.min(window.start_ord, window.end_ord_min, window.end_ord_max);
  const end = Math.max(window.start_ord, window.end_ord_min, window.end_ord_max);
  const coreEnd = Math.min(Math.max(window.end_ord_min, start), end);
  const total = Math.max(1, end - start + 1);
  const core = Math.max(1, coreEnd - start + 1);
  const pct = (value: number): string => `${((value / span) * 100).toFixed(3)}%`;
  return {
    left: pct(start - bounds.minOrd),
    width: pct(total),
    coreWidth: `${((Math.min(core, total) / total) * 100).toFixed(3)}%`,
    tailWidth: `${(((total - Math.min(core, total)) / total) * 100).toFixed(3)}%`,
  };
}

/** 横轴刻度序号：首末必标，中间按步长抽稀，最多 MAX_AXIS_TICKS 个。 */
function tickOrds(bounds: ChartBounds): number[] {
  const span = bounds.maxOrd - bounds.minOrd + 1;
  const step = Math.max(1, Math.ceil(span / MAX_AXIS_TICKS));
  const ticks: number[] = [];
  for (let ord = bounds.minOrd; ord <= bounds.maxOrd; ord += step) ticks.push(ord);
  if (ticks[ticks.length - 1] !== bounds.maxOrd) ticks.push(bounds.maxOrd);
  return ticks;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isProjectionLike(value: unknown): value is ScheduleProjectionView {
  const record = asRecord(value);
  return !!record && Array.isArray(record.ordinals) && !!asRecord(record.packages);
}

/**
 * 演算响应归一（设计 §6.2）：口径是 §6.1 的 `schedule` 键**平铺** + `scenario`；
 * 同时容忍 `{schedule: {...}, scenario}` 嵌套形态（同一端点两种装配都出现过时，面板
 * 不应静默画空）。关键字段缺一即返回 null——不渲染不完整结果。
 */
function normalizeWhatIfPayload(payload: unknown): ResolvedScheduleView | null {
  const record = asRecord(payload);
  if (!record) return null;
  const nested = asRecord(record.schedule);
  const schedule = isProjectionLike(record)
    ? record as unknown as ScheduleProjectionView
    : (nested && isProjectionLike(nested) ? nested : null);
  if (!schedule) return null;
  const scenarioRecord = asRecord(record.scenario) ?? asRecord(nested?.scenario);
  const scenario = scenarioRecord
    && Array.isArray(scenarioRecord.overrides)
    && Array.isArray(scenarioRecord.affected)
    ? scenarioRecord as unknown as GanttScenarioView
    : null;
  return {schedule, scenario};
}

/** HTTP 失败文案：状态码 + 服务端 error + 前三条 issues（全部动态串在渲染处转义）。 */
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

export class GanttPanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private unsubscribe: (() => void) | null = null;
  private payload: ScheduleSnapshot | null = null;
  private errorMessage: string | null = null;
  /** 演算结果（独立于 payload：回到基线只需丢弃它，不重新拉 /schedule/state）。 */
  private whatIfSchedule: ScheduleProjectionView | null = null;
  private whatIfScenario: GanttScenarioView | null = null;
  private whatIfError: string | null = null;
  private whatIfPending = false;
  private delayText = '';
  private layoutKey = 'wide';
  private resizeObserver: ResizeObserver | null = null;
  /** 请求代号：只应用最后一次 refresh / 演算的响应，丢弃过期的在途响应。 */
  private refreshSeq = 0;
  private whatIfSeq = 0;

  constructor(private readonly selection: ScheduleSelectionStore) {}

  show(): void {
    if (!this.el) this.build();
    this.el!.style.display = 'block';
    this.visible = true;
    // 与 FlowChartPanel 同形：show() 时按 store 当前值恢复 active 行；
    // 订阅先去重再挂，避免同一个面板挂两个监听。
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

  /** 重新拉取快照并渲染；同时丢弃上一次演算结果（打开/刷新 = 回到基线视图）。 */
  async refresh(): Promise<void> {
    const seq = ++this.refreshSeq;
    // 刷新即回到基线：在途演算响应一律作废，避免「刷新后旧演算又写回来」。
    this.whatIfSeq += 1;
    try {
      const response = await fetch('/api/schedule/state');
      if (seq !== this.refreshSeq) return;
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        throw new Error(describeHttpError(payload, response.status, '/api/schedule/state'));
      }
      const payload: unknown = await response.json();
      if (seq !== this.refreshSeq) return;
      this.payload = payload as ScheduleSnapshot;
      this.errorMessage = null;
      this.resetWhatIfState();
    } catch (err) {
      if (seq !== this.refreshSeq) return;
      // 失败不能保留上一次的快照/演算：错误条写着「本面板不渲染来自坏快照的数据」，
      // 下面却继续画旧条，会让用户把过期状态当当前状态（任务书 §5）。
      this.payload = null;
      this.resetWhatIfState();
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
    this.render();
  }

  // ─── 渲染 ────────────────────────────────────────────────────────────────

  private render(): void {
    const body = this.el?.querySelector('#gantt-body') as HTMLElement | null;
    if (!body) return;

    const error = this.errorMessage
      ? `<div id="gantt-error" style="margin-bottom:8px;padding:6px 8px;border:1px solid rgba(217,83,79,.55);border-radius:6px;background:rgba(217,83,79,.12);color:#f0a9a5;font-size:12px;">取数失败：${escapeHtml(this.errorMessage)}　接口不通或控制源校验不过；本面板不渲染来自坏快照的数据，修好后重试。</div>`
      : '';

    const snapshot = this.payload;
    let content: string;
    if (this.whatIfSchedule) {
      content = this.renderChart(this.whatIfSchedule, this.whatIfScenario, 'what-if');
    } else if (!snapshot) {
      content = `<div id="gantt-empty" style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">未取得排程数据（/api/schedule/state 尚未返回）。</div>`;
    } else if (!snapshot.schedule) {
      // schedule 是可选键（旧快照/503 前的装配）：明确说不画，不拿空骨架冒充正常排程。
      content = `<div id="gantt-empty" style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">快照没有排程投影（<code>schedule</code> 键缺失）：本面板不渲染空骨架。可能是服务端仍是旧版，或这份快照来自 503 之前的装配——刷新或升级服务端后重试。</div>`;
    } else {
      content = this.renderChart(snapshot.schedule, null, 'state');
    }

    body.innerHTML = `${error}${this.renderScenario()}${content}`;
    this.bind(body);
    this.layoutKey = this.layoutKeyOf();
  }

  /** what-if 控件区：固定水印 + delay 输入 + 演算/回到基线 + 结果说明（只解释不计算）。 */
  private renderScenario(): string {
    const active = this.whatIfScenario !== null || this.whatIfSchedule !== null;
    const note = this.scenarioNoteText();
    const noteState = this.whatIfPending ? 'pending' : this.whatIfError ? 'error' : active ? 'scenario' : 'baseline';
    return `<div id="gantt-scenario" data-active="${active}" style="margin-bottom:8px;padding:8px 10px;border:1px solid rgba(233,196,106,.4);border-radius:6px;background:rgba(233,196,106,.07);">
      <div style="color:#f4dfa8;font-size:11px;">${escapeHtml(SCENARIO_WATERMARK)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;">
        <input id="gantt-delay-input" type="text" value="${escapeHtml(this.delayText)}" placeholder="PKG-040:3（可多条，逗号分隔）" aria-label="what-if 延迟输入" style="flex:1 1 200px;min-width:0;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.22);background:#232342;color:#e0e0e0;font-size:12px;" />
        <button id="gantt-what-if" type="button"${this.whatIfPending ? ' disabled' : ''} style="cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #e9c46a;background:#4a4027;color:#f4dfa8;font-size:12px;">演算</button>
        <button id="gantt-reset" type="button"${active ? '' : ' disabled'} style="cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.22);background:#2a2a3e;color:#ccd;font-size:12px;">回到基线</button>
      </div>
      <div id="gantt-scenario-note" data-state="${noteState}" style="margin-top:6px;font-size:11px;line-height:1.6;color:${noteState === 'error' ? '#f0a9a5' : noteState === 'scenario' ? '#f4dfa8' : '#9aa4b2'};">${escapeHtml(note)}</div>
    </div>`;
  }

  /** 演算区说明文案（纯文本，调用处统一 escapeHtml）。 */
  private scenarioNoteText(): string {
    if (this.whatIfPending) return '演算中…';
    if (this.whatIfError) return `演算失败：${this.whatIfError}`;
    if (this.whatIfScenario) {
      const overrides = this.whatIfScenario.overrides
        .map((entry) => `${entry.pkg} ${entry.workdays >= 0 ? '+' : ''}${entry.workdays} 工作日`)
        .join('、') || '无';
      const affected = this.whatIfScenario.affected.length
        ? this.whatIfScenario.affected
            .map((entry) => `${entry.pkg} ${entry.delta >= 0 ? '+' : ''}${entry.delta} 工作日`)
            .join('、')
        : '无下游包受影响';
      return `演算入参：${overrides}；受影响 ${this.whatIfScenario.affected.length} 包：${affected}。演算只改本视图的 forecast 呈现，不改检查记录窗口（证据不参与计算，§16），也不写任何配置。`;
    }
    if (this.whatIfSchedule) return '演算响应未带 scenario 段（无参演算 = 基线）；本视图仍是演算结果，非计划。';
    return '当前为基线视图（未参与演算）。输入 delay 后点「演算」；无参演算 = 基线。';
  }

  // ─── 图表 ────────────────────────────────────────────────────────────────

  private renderChart(view: ScheduleProjectionView, scenario: GanttScenarioView | null, source: ScheduleSource): string {
    const entries = this.projectionEntries(view);
    if (entries.length === 0) {
      return `<div id="gantt-empty" style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">
        排程投影里没有主车道工作包（<code>packages</code> 为空）：本面板不绘制空时间轴。检查 control.yaml 的 work_packages 与投影装配后重试。
      </div>`;
    }

    const bounds = boundsOf(entries);
    const narrow = this.isNarrowContainer();
    const scenarioBanner = scenario
      ? `<div id="gantt-scenario-banner" style="margin-bottom:6px;padding:4px 8px;border-radius:6px;background:rgba(233,196,106,.15);color:#f4dfa8;font-size:11px;">当前渲染的是演算结果（${escapeHtml(SCENARIO_WATERMARK)}）。</div>`
      : '';

    const sourceLine = source === 'what-if'
      ? '数据只读自 <code>/api/schedule/what-if</code>（演算响应，不是计划）；点条只写共享选中态，不做 3D 高亮、不改任何配置——写路径一律走 PR。'
      : '数据只读自 <code>/api/schedule/state</code>（<code>schedule</code> 键）；点条只写共享选中态，不做 3D 高亮、不改任何配置——写路径一律走 PR。';
    const head = `<div id="gantt-head" style="margin-bottom:8px;color:#9aa4b2;font-size:11px;line-height:1.7;">
      共 ${entries.length} 个主车道工作包｜${escapeHtml(this.anchorTextOf(view))}
      <br>${sourceLine}
    </div>${this.renderLegend()}`;

    const rows = entries
      .map(([packageId, projection]) => this.renderRow(packageId, projection, bounds, narrow))
      .join('');

    if (narrow) {
      // 窄容器（issue #83 先例）：包列表 + 序数条，不硬画时间轴。
      return `<div id="gantt-chart" data-gantt-mobile="true">${head}${scenarioBanner}
        <div style="margin-bottom:6px;color:#7d8698;font-size:10px;">窄屏（≤${NARROW_MAX_PX}px）：包列表 + 序数条（不画时间轴）。</div>
        ${rows}
      </div>`;
    }

    return `<div id="gantt-chart">${head}${scenarioBanner}
      ${this.renderAxis(bounds, view)}
      ${rows}
    </div>`;
  }

  private anchorTextOf(view: ScheduleProjectionView): string {
    return view.anchor_date
      ? `锚点：已定（${view.anchor_date}）｜横轴：真实日期`
      : '锚点：未定｜横轴：第 N 工作日（不显示日期）';
  }

  /** 图例：颜色与文字成对（基线/预测 + 斜纹尾语义）。 */
  private renderLegend(): string {
    return `<div id="gantt-legend" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px;color:#9aa4b2;font-size:11px;">
      <span>${laneSwatch('baseline')}${LANE_LABEL.baseline}（实心 = min 口径下界，斜纹尾 = 到 max 上界）</span>
      <span>${laneSwatch('forecast')}${LANE_LABEL.forecast}（同口径；无 scenario 时与基线相同）</span>
      <span>状态点旁一律有中文状态文字</span>
    </div>`;
  }

  private renderAxis(bounds: ChartBounds, view: ScheduleProjectionView): string {
    const span = Math.max(1, bounds.maxOrd - bounds.minOrd + 1);
    // 日期只在锚点就绪时出现；锚点未定时模块输出 ordinals[].date 全 null（§18），
    // 这里也就不建日期表——面板不自行造年月日。
    const dateByOrd = new Map<number, string>();
    if (view.anchor_date) {
      for (const entry of Array.isArray(view.ordinals) ? view.ordinals : []) {
        if (typeof entry.date === 'string') dateByOrd.set(entry.ord, entry.date);
      }
    }
    const ticks = tickOrds(bounds).map((ord) => {
      const left = `${(((ord - bounds.minOrd) / span) * 100).toFixed(3)}%`;
      const date = dateByOrd.get(ord);
      return `<div class="gantt-tick" data-ord="${ord}" style="position:absolute;left:${left};transform:translateX(-50%);font-size:10px;color:#9aa4b2;white-space:nowrap;">第 ${ord} 工作日${date ? `<span style="color:#7d8698;">（${escapeHtml(date)}）</span>` : ''}</div>`;
    }).join('');
    return `<div id="gantt-axis" style="display:flex;gap:8px;margin-bottom:4px;">
      <div style="flex:0 0 ${LABEL_COLUMN_PX}px;color:#9aa4b2;font-size:10px;">包</div>
      <div style="flex:1 1 auto;min-width:0;position:relative;height:16px;">${ticks}</div>
    </div>`;
  }

  private projectionEntries(view: ScheduleProjectionView): Array<[string, SchedulePackageProjectionView]> {
    const entries = Object.entries(view.packages ?? {});
    entries.sort(([left], [right]) => {
      const leftSeq = this.snapshotPackage(left)?.sequence ?? Number.MAX_SAFE_INTEGER;
      const rightSeq = this.snapshotPackage(right)?.sequence ?? Number.MAX_SAFE_INTEGER;
      if (leftSeq !== rightSeq) return leftSeq - rightSeq;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    return entries;
  }

  private renderRow(
    packageId: string,
    projection: SchedulePackageProjectionView,
    bounds: ChartBounds,
    narrow: boolean,
  ): string {
    const packageView = this.snapshotPackage(packageId);
    const active = this.selection.get().packageId === packageId;
    const status = packageView?.effective_status;
    const name = packageView?.name ?? packageId;

    const metrics = (['baseline', 'forecast'] as const)
      .map((kind) => `<div class="gantt-metric" data-lane="${kind}" style="font-size:11px;line-height:1.5;color:#d8d8e4;">${laneSwatch(kind)}${escapeHtml(metricTextOf(kind, projection[kind]))}</div>`)
      .join('');

    const reasons = projection.blocking_reasons ?? [];
    const shownReasons = reasons.slice(0, MAX_VISIBLE_REASONS);
    const reasonsLine = shownReasons.length
      ? `<div class="gantt-reasons" title="${escapeHtml(reasons.join('\n'))}" style="margin-top:2px;color:#f4dfa8;font-size:11px;line-height:1.5;">阻塞解释：${escapeHtml(shownReasons.join('；'))}${reasons.length > shownReasons.length ? `；等 ${reasons.length} 条` : ''}</div>`
      : '';

    const constraints = projection.constraints ?? [];
    const shownConstraints = constraints.slice(0, MAX_VISIBLE_CONSTRAINTS);
    const constraintsLine = shownConstraints.length
      ? `<div class="gantt-constraints" title="${escapeHtml(constraints.map(constraintTextOf).join('\n'))}" style="margin-top:2px;color:#c9cfe0;font-size:11px;line-height:1.5;">${escapeHtml(shownConstraints.map(constraintTextOf).join('；'))}${constraints.length > shownConstraints.length ? `；等 ${constraints.length} 条` : ''}</div>`
      : '';

    const checkLine = `<div class="gantt-check-window" style="margin-top:2px;color:#9aa4b2;font-size:11px;line-height:1.5;">${escapeHtml(checkWindowTextOf(projection.check_window))}</div>`;

    const hoverText = [
      `${packageId} ${name}`,
      `状态：${statusLabelOf(status)}`,
      metricTextOf('baseline', projection.baseline),
      metricTextOf('forecast', projection.forecast),
      checkWindowTextOf(projection.check_window),
      ...constraints.map(constraintTextOf),
      ...reasons.map((reason) => `阻塞解释：${reason}`),
    ].join('\n');

    const label = `<div class="gantt-label" style="flex:0 0 ${LABEL_COLUMN_PX}px;min-width:0;">
      <div style="display:flex;justify-content:space-between;gap:6px;align-items:center;">
        <strong style="font-size:12px;white-space:nowrap;">${escapeHtml(packageId)}</strong>
        <span style="font-size:11px;">${statusDot(status)}${escapeHtml(statusLabelOf(status))}</span>
      </div>
      <div style="margin-top:1px;font-size:12px;line-height:1.35;">${escapeHtml(name)}</div>
      ${metrics}
      ${checkLine}
      ${constraintsLine}
      ${reasonsLine}
    </div>`;

    // 窄屏同样画「序数条」：百分比位置只依赖 ordinals 的上下界，不建日期轴；行改为单列
    // 堆叠后条占满整行宽度（设计 §7 的「包列表 + 序数条」，不是只剩文字）。
    const timeline = `<div class="gantt-timeline"${narrow ? ' data-gantt-mobile="true"' : ''} style="flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:3px;${narrow ? 'margin-top:4px;' : ''}">
      ${this.renderLane(packageId, 'baseline', projection.baseline, bounds)}
      ${this.renderLane(packageId, 'forecast', projection.forecast, bounds)}
    </div>`;

    return `<div class="gantt-row" data-pkg-id="${escapeHtml(packageId)}" data-active="${active}" title="${escapeHtml(hoverText)}"
      style="display:${narrow ? 'block' : 'flex'};gap:8px;padding:6px 8px;margin-bottom:6px;border-radius:6px;border:1px solid ${active ? ACTIVE_BORDER : 'rgba(255,255,255,.14)'};background:${active ? 'rgba(111,168,220,.14)' : 'rgba(255,255,255,.03)'};font-size:12px;cursor:pointer;overflow-wrap:break-word;${active ? `box-shadow:0 0 0 2px ${ACTIVE_BORDER};` : ''}">${label}${timeline}</div>`;
  }

  private renderLane(
    packageId: string,
    kind: LaneKind,
    window: ScheduleWindowView,
    bounds: ChartBounds,
  ): string {
    const geometry = geometryOf(window, bounds);
    const style = LANE_STYLE[kind];
    const tail = window.end_ord_max > window.end_ord_min
      ? `<div class="gantt-bar-tail" style="position:absolute;left:${geometry.coreWidth};top:0;bottom:0;width:${geometry.tailWidth};box-sizing:border-box;border:1px dashed ${style.fill};border-radius:0 3px 3px 0;background-image:repeating-linear-gradient(45deg,${style.tail} 0 3px,transparent 3px 6px);"></div>`
      : '';
    return `<div class="gantt-lane" data-lane="${kind}" style="position:relative;height:11px;">
      <div class="gantt-bar" data-pkg-id="${escapeHtml(packageId)}" data-lane="${kind}" data-start-ord="${window.start_ord}" data-end-min="${window.end_ord_min}" data-end-max="${window.end_ord_max}"
        title="${escapeHtml(metricTextOf(kind, window))}"
        style="position:absolute;left:${geometry.left};width:${geometry.width};top:0;height:10px;">
        <div class="gantt-bar-core" style="position:absolute;left:0;top:0;bottom:0;width:${geometry.coreWidth};background:${style.fill};border-radius:3px 0 0 3px;"></div>
        ${tail}
      </div>
    </div>`;
  }

  // ─── 事件 ────────────────────────────────────────────────────────────────

  private bind(body: HTMLElement): void {
    for (const row of Array.from(body.querySelectorAll('.gantt-row[data-pkg-id]'))) {
      row.addEventListener('click', () => {
        const packageId = String((row as HTMLElement).dataset.pkgId ?? '');
        if (!packageId) return;
        // D5：只写共享选中态。不调 onHighlight、不展开 scope——定位的唯一使用者仍是
        // ScheduleDetailPanel（#191 退役选择器时本面板零改动）。
        this.selection.set({packageId, checkId: null});
        this.render();
      });
    }

    const input = body.querySelector('#gantt-delay-input') as HTMLInputElement | null;
    const readDelay = (): string => (input ? input.value : this.delayText);
    input?.addEventListener('input', () => {
      this.delayText = readDelay();
    });
    body.querySelector('#gantt-what-if')?.addEventListener('click', () => {
      this.delayText = readDelay();
      void this.runWhatIf();
    });
    body.querySelector('#gantt-reset')?.addEventListener('click', () => {
      // 作废在途演算（后到的 pending 响应不得把演算写回来），再丢弃当前结果。
      this.whatIfSeq += 1;
      this.resetWhatIfState();
      this.render();
    });
  }

  /** delay 语法/未知包/非正方正的判定全部在服务端（单一实现）；面板只转发原文并展示 400/503 原因。 */
  private async runWhatIf(): Promise<void> {
    const seq = ++this.whatIfSeq;
    const delay = this.delayText.trim();
    this.whatIfPending = true;
    this.whatIfError = null;
    this.render();
    try {
      const query = delay ? `?${new URLSearchParams({delay}).toString()}` : '';
      const response = await fetch(`/api/schedule/what-if${query}`);
      const payload: unknown = await response.json().catch(() => null);
      // 过期响应（期间点了「回到基线」/触发了刷新/又跑了一次演算）一律丢弃，
      // 不得把旧 scenario 写回当前视图。
      if (seq !== this.whatIfSeq) return;
      if (!response.ok) {
        this.whatIfSchedule = null;
        this.whatIfScenario = null;
        this.whatIfError = describeHttpError(payload, response.status, '/api/schedule/what-if');
      } else {
        const normalized = normalizeWhatIfPayload(payload);
        if (!normalized) {
          this.whatIfSchedule = null;
          this.whatIfScenario = null;
          this.whatIfError = '演算响应缺少排程投影（anchor_date / ordinals / packages）——不渲染不完整结果';
        } else {
          this.whatIfSchedule = normalized.schedule;
          this.whatIfScenario = normalized.scenario;
        }
      }
    } catch (err) {
      if (seq !== this.whatIfSeq) return;
      this.whatIfSchedule = null;
      this.whatIfScenario = null;
      this.whatIfError = `网络或解析失败：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      if (seq === this.whatIfSeq) {
        this.whatIfPending = false;
        this.render();
      }
    }
  }

  private resetWhatIfState(): void {
    this.whatIfSchedule = null;
    this.whatIfScenario = null;
    this.whatIfError = null;
    this.whatIfPending = false;
  }

  // ─── 容器宽度（≤700px 退化，issue #83 先例）─────────────────────────────

  private snapshotPackage(packageId: string): SchedulePackageView | undefined {
    return this.payload?.packages.find((pkg) => pkg.id === packageId);
  }

  /** 面板内容区实测宽（jsdom 不做布局，clientWidth 恒 0 → 按宽容器）。 */
  private availableWidth(): number {
    const body = this.el?.querySelector('#gantt-body') as HTMLElement | null;
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
    el.id = 'gantt-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none;
    `;
    el.innerHTML = `
      <div class="dynamic-panel-heading">
        <strong>动态甘特</strong>
        <button id="gantt-panel-toggle" class="panel-collapse-toggle" type="button" aria-controls="gantt-panel-content" aria-expanded="true" aria-label="动态甘特面板折叠" title="折叠">−</button>
      </div>
      <div id="gantt-panel-content">
        <div id="gantt-body"></div>
      </div>
    `;
    // 路由级独立页：挂到审批页容器（测试只提供挂载点，见各测试 installDom）。
    const stack = document.getElementById('approval-page-panels');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#gantt-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#gantt-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);
    const body = el.querySelector('#gantt-body') as HTMLElement | null;
    if (body && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.onContainerResize());
      observer.observe(body);
      this.resizeObserver = observer;
    }
    this.el = el;
  }
}
