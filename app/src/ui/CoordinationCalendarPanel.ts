// 自装审批「协调日历」面板（2026-11-11 issue #202 S3，设计 §7 / §2.1(c) / §16.4 / §17.4 / §18）。
//
// 数据只有一个来源：`GET /api/schedule/state` 的快照——`snapshot.coordination`（SCH 协调视图，
// shared/schedule-state.ts 的 ScheduleCoordinationView）+ `snapshot.schedule`（排程投影视图：
// ordinals / packages[pkg].forecast / packages[pkg].constraints）；包名与排序用**同一个**响应的
// `snapshot.packages`（不是第二数据源）。两个 schedule/coordination 键**按可缺失处理**（旧快照 /
// 503 之前的装配）。本面板**不 import** `shared/schedule-projection.ts`——投影的唯一实现在服务端，
// 浏览器只渲染快照（设计 D4）；也不另读 control.yaml、不拉其他端点、不拉 /api/model-package-links
// （本面板无 3D 高亮）。
//
// 渲染口径（任务书 §1.2）：
//  - 工作日列网格：一列 = 一个 ord，列宽 DAY_COLUMN_PX；外层 overflow-x:auto，内层内容宽度
//    = max(ord 跨度 × DAY_COLUMN_PX, 100%)。ord 地平线优先取 schedule.ordinals 的 min..max，
//    缺失时从各条目所属包 forecast 窗口推导，两者都没有 → 空态文字（不画没有坐标系的条幅）；
//  - anchor_date 为 null：列头只标「第 N 工作日」，面板不得出现任何日期字符串（模块输出边界
//    已保证 ordinals[].date 全 null，§18；面板不自行造年月日）；
//  - chip：每个 coordination 条目一条，水平位置/宽度 = 所属包 forecast 窗口
//    [start_ord, end_ord_max]（未确认条目的**潜在窗口**，§16.4）；chip 上文字 = SCH id + mode +
//    status；mode 三类（onsite/remote/notify）各有固定色 + 中文图例，颜色旁始终有文字；
//  - confirmed 条目：chip 带确认态；confirmed_at 是「确认登记日」证据文字，原样展示。无锚点时
//    没有日期坐标系，chip 仍钉潜在窗口、**不钉 ord 列**（§17/§18），另起一行文字说明；有锚点时
//    才按 ordinals 的 date→ord 纯查表补一个「确认占用日」标记（不做工作日数学，不引投影模块）；
//  - site_pending 约束：条目所属包 constraints 里 status === 'site_pending' 的在该行内标注
//    「待定」（照 GanttPanel CONSTRAINT_STATUS_LABEL 先例，其余 token 原样显示）；
//  - 轴线与行内容区**同源内缩**（CONTENT_INSET_X_PX = 行边框 + 行内边距，renderAxis 用 margin）：
//    刻度原点与 chip/网格原点必须重合，否则条幅整体错位（独立评审 medium，2026-11-12 修）；
//  - 列头刻度抽稀后补末列时要与**最后一个已排刻度**比最小间距（Codex 二审 minor，2026-11-12 修）；
//  - cancelled 条目不画 chip，只在面板说明里注明「已取消 N 条（解除占用）」（取消即解除占用，§17.4）；
//  - 点 chip/行 → selection.set({packageId: entry.package_id, checkId: SCH id})，**不做 3D 高亮、
//    不做 scope 展开**（D5：定位与 resolvePackageScope 的唯一使用者仍是 ScheduleDetailPanel；
//    #191 退役选择器时本面板零改动）。本面板没有 onHighlight 钩子，也不提供任何高亮入口；
//  - 空态 / 取数失败有明确文字，不渲染空骨架冒充正常；
//  - ≤700px（NARROW_MAX_PX，与 style.css 的 @media 断点同源）退化为单列列表（chip 改文字行，
//    不画工作日列网格）（FlowChartPanel issue #83 单列降级先例）；
//  - 只读快照：渲染前后不改写 snapshot.coordination / snapshot.schedule 任何数组/对象
//    （不 sort/splice/赋值；展示排序只做 Object.entries 出来的新数组）。测试钉住逐字节不变。
import type {
  ScheduleCoordinationView,
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

// ─── 固定映射表（颜色只能来自这里；文字与颜色必须同时出现）────────────────────

/** 工作日列宽（px）：一列 = 一个 ord（任务书 §1.2 建议值 44px）。 */
const DAY_COLUMN_PX = 44;
/** 宽屏列头最多标 12 个刻度（另受 MIN_TICK_SPACING_PX 约束；抽稀，首末必标）。 */
const MAX_AXIS_TICKS = 12;
/** 刻度标签最小间距（px）：「第 NN 工作日」约 60px 宽，小于它标签会互相压盖。 */
const MIN_TICK_SPACING_PX = 72;
/** 约束随条目展示的条数上限，超出显示「等 N 条」，完整列表进 title（照 GanttPanel 先例）。 */
const MAX_VISIBLE_CONSTRAINTS = 3;
/**
 * 行内容区（`.cal-track`，chip/网格/确认标记的定位基准）相对行外框的水平内缩（px）。
 * = 行边框 + 行内边距。**轴刻度必须吃同一个内缩**（`renderAxis` 用 margin），否则刻度原点
 * 与 chip/网格原点相差 1+8=9px，条幅与列线整体错位（独立评审 medium，2026-11-12 修）。
 * 三处（行样式 / 轴样式 / 本常量）由测试 `轴线与行内容区同源内缩` 钉住。
 */
const ROW_BORDER_PX = 1;
const ROW_PADDING_X_PX = 8;
const CONTENT_INSET_X_PX = ROW_BORDER_PX + ROW_PADDING_X_PX;

/** mode 三类固定色 + 中文标签（颜色不是唯一证据，图例与 chip 上都带文字）。 */
const MODE_LABEL: Record<ScheduleCoordinationView['mode'], string> = {
  onsite: '现场',
  remote: '远程',
  notify: '知会',
};
const MODE_COLOR: Record<ScheduleCoordinationView['mode'], string> = {
  onsite: '#6fa8dc',
  remote: '#5cb85c',
  notify: '#9b8bd0',
};
const NEUTRAL_COLOR = '#8a93a3';

/** 协调状态词汇（control.yaml coordination status 五值；未知 token 原样显示，不翻译成声明值）。 */
const STATUS_LABEL: Record<string, string> = {
  unassigned: '未分派',
  pending_invite: '待邀请',
  invited: '已邀请',
  confirmed: '已确认',
  cancelled: '已取消',
};

/** 约束状态词汇（设计 §2.1(b)/§7：site_pending 标「待定」；其余 token 原样显示）。 */
const CONSTRAINT_STATUS_LABEL: Record<string, string> = {site_pending: '待定'};

const ACTIVE_BORDER = '#6fa8dc';
/** 试点数据固定水印（任务书 §5：防止把已登记的 9 条当成完整协调名单）。 */
const PILOT_NOTE = '试点数据：仅登记了 coordination 的 SCH 出现';

// ─── 纯函数：词汇 / 几何 / 刻度 / HTTP 失败文案 ──────────────────────────────

function labelOf(map: Record<string, string>, value: string | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}

function statusLabelOf(value: string | undefined): string {
  if (!value) return '—';
  return STATUS_LABEL[value] ?? value;
}

function modeLabelOf(value: string | undefined): string {
  if (!value) return '—';
  return MODE_LABEL[value as ScheduleCoordinationView['mode']] ?? value;
}

function modeColorOf(value: string | undefined): string {
  if (!value) return NEUTRAL_COLOR;
  return MODE_COLOR[value as ScheduleCoordinationView['mode']] ?? NEUTRAL_COLOR;
}

function modeSwatch(value: string | undefined): string {
  return `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${modeColorOf(value)};border:1px solid rgba(255,255,255,.25);"></span>`;
}

function constraintTextOf(constraint: ScheduleConstraintView): string {
  const status = labelOf(CONSTRAINT_STATUS_LABEL, constraint.status);
  const detail = constraint.detail ? `：${constraint.detail}` : '';
  const date = constraint.date ? `｜日期 ${constraint.date}` : '';
  return `约束 ${constraint.id}（${constraint.type}｜${status}）${detail}${date}`;
}

/** 潜在窗口文字口径：起点 ord 到上界 ord（min/max 口径之外的纯展示文字）。 */
function windowTextOf(window: ScheduleWindowView): string {
  const start = Math.min(window.start_ord, window.end_ord_min, window.end_ord_max);
  const end = Math.max(window.start_ord, window.end_ord_min, window.end_ord_max);
  return `第 ${start} – 第 ${end} 工作日`;
}

interface CalendarBounds {minOrd: number; maxOrd: number}

/**
 * ord 地平线：优先取 schedule.ordinals 的 min..max，缺失时从各条目 forecast 窗口推导，
 * 两者都没有 → null（调用方出空态文字）。条目窗口越出 ordinals 范围时一并扩进地平线——
 * 越界不钳位（钳位会把潜在窗口画到错误的列上，比留空更糟）。
 */
function boundsOf(view: ScheduleProjectionView, entries: CalendarEntry[]): CalendarBounds | null {
  let minOrd = Number.POSITIVE_INFINITY;
  let maxOrd = Number.NEGATIVE_INFINITY;
  for (const entry of Array.isArray(view.ordinals) ? view.ordinals : []) {
    if (typeof entry?.ord !== 'number') continue;
    minOrd = Math.min(minOrd, entry.ord);
    maxOrd = Math.max(maxOrd, entry.ord);
  }
  for (const entry of entries) {
    const window = entry.projection?.forecast;
    if (!window) continue;
    minOrd = Math.min(minOrd, window.start_ord, window.end_ord_min, window.end_ord_max);
    maxOrd = Math.max(maxOrd, window.start_ord, window.end_ord_min, window.end_ord_max);
  }
  if (!Number.isFinite(minOrd) || !Number.isFinite(maxOrd)) return null;
  return {minOrd, maxOrd};
}

/**
 * 列头刻度序号：首末必标，中间按步长抽稀（步长同时受 MAX_AXIS_TICKS 与
 * MIN_TICK_SPACING_PX 约束）。补末列时与**最后一个已排刻度**（`ticks[length-1]`，
 * 不是倒数第二个——Codex 二审 minor，2026-11-12 修）比间距：过近就删该刻度再补末列，
 * 否则末端两个标签会以 44px 相邻（< 72px 最小间距）互相压盖。span 极小时
 * （如 1–4，抽稀后只剩首末）末列与首列仍可能相邻，纯装饰、不影响 chip 定位。
 */
function tickOrds(bounds: CalendarBounds): number[] {
  const span = Math.max(1, bounds.maxOrd - bounds.minOrd + 1);
  const minStepOrds = Math.max(1, Math.ceil(MIN_TICK_SPACING_PX / DAY_COLUMN_PX));
  const step = Math.max(1, Math.ceil(span / MAX_AXIS_TICKS), minStepOrds);
  const ticks: number[] = [];
  for (let ord = bounds.minOrd; ord <= bounds.maxOrd; ord += step) ticks.push(ord);
  if (ticks[ticks.length - 1] !== bounds.maxOrd) {
    if (bounds.maxOrd - ticks[ticks.length - 1] < minStepOrds) ticks.pop();
    ticks.push(bounds.maxOrd);
  }
  return ticks;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
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

/** 空态骨架：明确文字，不渲染空网格冒充正常。文案是静态串（可含 <code>），无用户数据。 */
function emptyState(text: string): string {
  return `<div id="coordination-calendar-empty" style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">${text}</div>`;
}

/** 展示用条目（快照数据的只读投影：不持有任何可回写 snapshot 的引用链）。 */
interface CalendarEntry {
  schId: string;
  view: ScheduleCoordinationView;
  packageId: string;
  packageName: string;
  /** null = 包不在快照 packages（排序沉底、文案注明）。 */
  packageSequence: number | null;
  /** null = 所属包没有排程投影（不画条幅，只列文字）。 */
  projection: SchedulePackageProjectionView | null;
  cancelled: boolean;
}

interface CoordinationGroups {active: CalendarEntry[]; cancelled: CalendarEntry[]}

export class CoordinationCalendarPanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private unsubscribe: (() => void) | null = null;
  private payload: ScheduleSnapshot | null = null;
  private errorMessage: string | null = null;
  private layoutKey = 'wide';
  private resizeObserver: ResizeObserver | null = null;
  /**
   * 取数世代：每次 refresh 发起即 +1，响应只有 epoch 仍最新才允许写。
   * 在途的旧刷新不得覆盖新结果（本面板只有取数一条异步路径，单计数器足够）。
   */
  private dataEpoch = 0;

  constructor(private readonly selection: ScheduleSelectionStore) {}

  show(): void {
    if (!this.el) this.build();
    this.el!.style.display = 'block';
    this.visible = true;
    // 与 GanttPanel 同形：show() 时按 store 当前值恢复 active 行；订阅先去重再挂。
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

  /** 重新拉取快照并渲染。失败不保留上一次快照——错误条下继续画旧条幅会把过期协调状态当当前状态。 */
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

  // ─── 渲染 ────────────────────────────────────────────────────────────────

  private render(): void {
    const body = this.el?.querySelector('#coordination-calendar-body') as HTMLElement | null;
    if (!body) return;

    const error = this.errorMessage
      ? `<div id="coordination-calendar-error" style="margin-bottom:8px;padding:6px 8px;border:1px solid rgba(217,83,79,.55);border-radius:6px;background:rgba(217,83,79,.12);color:#f0a9a5;font-size:12px;">取数失败：${escapeHtml(this.errorMessage)}　接口不通或控制源校验不过；本面板不渲染来自坏快照的数据，修好后重试。</div>`
      : '';

    const snapshot = this.payload;
    let content: string;
    if (!snapshot) {
      content = emptyState('未取得协调快照（<code>/api/schedule/state</code> 尚未返回）。');
    } else if (!snapshot.schedule) {
      // schedule 是可选键（旧快照/503 前的装配）：没有工作日坐标系就不画条幅，不出空骨架。
      content = emptyState('缺排程投影（<code>schedule</code> 键缺失）：无法定位工作日列。可能是服务端仍是旧版，或这份快照来自 503 之前的装配——刷新或升级服务端后重试。');
    } else {
      const grouped = this.entriesOf(snapshot);
      if (grouped.active.length + grouped.cancelled.length === 0) {
        content = emptyState('没有协调数据（<code>coordination</code> 键缺失/为空）：没有可登记的 SCH 协调条目，本面板不渲染空网格。');
      } else {
        content = this.renderCalendar(snapshot, grouped);
      }
    }

    // 试点水印固定在场（任何状态都在：防止把已登记条目当成完整协调名单，任务书 §5）。
    const pilot = `<div id="coordination-calendar-pilot" style="margin-top:8px;color:#7d8698;font-size:10px;">${escapeHtml(PILOT_NOTE)}</div>`;
    body.innerHTML = `${error}${content}${pilot}`;
    this.bind(body);
    this.layoutKey = this.layoutKeyOf();
  }

  // ─── 条目装配（只读） ────────────────────────────────────────────────────

  private entriesOf(snapshot: ScheduleSnapshot): CoordinationGroups {
    const coordination = snapshot.coordination ?? {};
    const active: CalendarEntry[] = [];
    const cancelled: CalendarEntry[] = [];
    for (const [schId, view] of Object.entries(coordination)) {
      if (!view || typeof view !== 'object') continue;
      const entry = this.entryOf(snapshot, schId, view);
      (entry.cancelled ? cancelled : active).push(entry);
    }
    // 展示排序只做 Object.entries 出来的新数组：不改写 snapshot.coordination 的键序/值。
    const compare = (left: CalendarEntry, right: CalendarEntry): number => {
      const leftSeq = left.packageSequence ?? Number.MAX_SAFE_INTEGER;
      const rightSeq = right.packageSequence ?? Number.MAX_SAFE_INTEGER;
      if (leftSeq !== rightSeq) return leftSeq - rightSeq;
      // localeCompare 环境相关，按任务书口径用 </> 比较
      return left.schId < right.schId ? -1 : left.schId > right.schId ? 1 : 0;
    };
    active.sort(compare);
    cancelled.sort(compare);
    return {active, cancelled};
  }

  private entryOf(snapshot: ScheduleSnapshot, schId: string, view: ScheduleCoordinationView): CalendarEntry {
    const packageView = snapshot.packages.find((pkg) => pkg.id === view.package_id);
    const projection = snapshot.schedule?.packages?.[view.package_id] ?? null;
    return {
      schId,
      view,
      packageId: view.package_id,
      packageName: packageView?.name ?? view.package_id,
      packageSequence: packageView?.sequence ?? null,
      projection,
      cancelled: view.status === 'cancelled',
    };
  }

  // ─── 日历 ────────────────────────────────────────────────────────────────

  private renderCalendar(snapshot: ScheduleSnapshot, grouped: CoordinationGroups): string {
    const view = snapshot.schedule as ScheduleProjectionView;
    const bounds = boundsOf(view, grouped.active);
    if (!bounds) {
      return emptyState('无法定位工作日列：<code>ordinals</code> 与各条目所属包 forecast 窗口都取不到序数，本面板不画没有坐标系的条幅。');
    }

    const head = this.renderHead(view, grouped);
    const legend = this.renderLegend();

    if (this.isNarrowContainer()) {
      // 窄容器（issue #83 先例）：单列列表，chip 改文字行，不画工作日列网格。
      const rows = grouped.active.map((entry) => this.renderTextRow(entry, view)).join('');
      return `<div id="coordination-calendar-chart" data-mobile="true">${head}${legend}
        <div style="margin-bottom:6px;color:#7d8698;font-size:10px;">窄屏（≤${NARROW_MAX_PX}px）：单列列表（chip 改文字行，不画工作日列网格）。</div>
        ${rows || '<div style="color:#9aa4b2;font-size:12px;">没有可画条幅的条目（可能全部已取消）。</div>'}
      </div>`;
    }

    const span = Math.max(1, bounds.maxOrd - bounds.minOrd + 1);
    const gridWidth = span * DAY_COLUMN_PX;
    const rows = grouped.active.map((entry) => this.renderRow(entry, bounds, view)).join('');
    return `<div id="coordination-calendar-chart" data-mobile="false">${head}${legend}
      <div style="overflow-x:auto;">
        <div style="min-width:max(${gridWidth}px,100%);">
          ${this.renderAxis(bounds, view)}
          ${rows || '<div style="color:#9aa4b2;font-size:12px;">没有可画条幅的条目（可能全部已取消）。</div>'}
        </div>
      </div>
    </div>`;
  }

  private renderHead(view: ScheduleProjectionView, grouped: CoordinationGroups): string {
    const total = grouped.active.length + grouped.cancelled.length;
    const cancelledPart = grouped.cancelled.length
      ? `；已取消 ${grouped.cancelled.length} 条（解除占用）：${grouped.cancelled.map((entry) => escapeHtml(entry.schId)).join('、')} 不画条幅`
      : '';
    return `<div id="coordination-calendar-head" style="margin-bottom:8px;color:#9aa4b2;font-size:11px;line-height:1.7;">
      登记 ${total} 条（画条幅 ${grouped.active.length} 条${cancelledPart}）
      <br>${escapeHtml(this.anchorTextOf(view))}
      <br>数据只读自 <code>/api/schedule/state</code>（<code>coordination</code> + <code>schedule</code> + <code>packages</code> 键）；点条幅只写共享选中态（<code>packageId</code> + <code>checkId</code> = SCH id），不做 3D 高亮、不改任何配置——写路径一律走 PR。
    </div>`;
  }

  private anchorTextOf(view: ScheduleProjectionView): string {
    return view.anchor_date
      ? `锚点：已定（${view.anchor_date}）｜横轴：真实日期`
      : '锚点：未定｜横轴：第 N 工作日（不显示日期）';
  }

  /** 图例：三类 mode 的颜色与中文标签成对出现（颜色不是唯一证据）。 */
  private renderLegend(): string {
    const modes: Array<ScheduleCoordinationView['mode']> = ['onsite', 'remote', 'notify'];
    return `<div id="coordination-calendar-legend" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px;color:#9aa4b2;font-size:11px;">
      ${modes.map((mode) => `<span>${modeSwatch(mode)}${MODE_LABEL[mode]}（${mode}）</span>`).join('')}
      <span>颜色旁一律有中文文字；已取消条目不画条幅</span>
    </div>`;
  }

  private renderAxis(bounds: CalendarBounds, view: ScheduleProjectionView): string {
    // 日期只在锚点就绪时出现；锚点未定时模块输出 ordinals[].date 全 null（§18），
    // 这里也就不建日期表——面板不自行造年月日。
    const dateByOrd = new Map<number, string>();
    if (view.anchor_date) {
      for (const entry of Array.isArray(view.ordinals) ? view.ordinals : []) {
        if (typeof entry?.date === 'string') dateByOrd.set(entry.ord, entry.date);
      }
    }
    const ticks = tickOrds(bounds).map((ord) => {
      const left = `${(ord - bounds.minOrd) * DAY_COLUMN_PX}px`;
      const date = dateByOrd.get(ord);
      return `<div class="cal-tick" data-ord="${ord}" style="position:absolute;left:${left};font-size:10px;color:#9aa4b2;white-space:nowrap;">第 ${ord} 工作日${date ? `<span style="color:#7d8698;">（${escapeHtml(date)}）</span>` : ''}</div>`;
    }).join('');
    // margin 吃与行内容区相同的内缩（CONTENT_INSET_X_PX）：刻度原点与 chip/网格原点重合，
    // 条幅不再整体右移 1+8px（独立评审 medium，2026-11-12 修）。
    return `<div id="coordination-calendar-axis" style="position:relative;height:16px;margin:0 ${CONTENT_INSET_X_PX}px;border-bottom:1px solid rgba(255,255,255,.14);">${ticks}</div>`;
  }

  private renderRow(entry: CalendarEntry, bounds: CalendarBounds, view: ScheduleProjectionView): string {
    const selection = this.selection.get();
    const active = selection.packageId === entry.packageId && selection.checkId === entry.schId;
    const forecast = entry.projection?.forecast ?? null;
    const windowText = forecast ? windowTextOf(forecast) : '未知（所属包无排程投影）';

    const track = forecast
      ? `<div class="cal-track" style="position:relative;height:26px;background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.07) 0 1px,transparent 1px ${DAY_COLUMN_PX}px);background-position:0 0;">
          ${this.renderChip(entry, forecast, bounds)}
          ${this.renderConfirmMark(entry, view, bounds)}
        </div>`
      : `<div class="cal-track cal-track-empty" style="position:relative;height:26px;color:#7d8698;font-size:10px;line-height:26px;">所属包无排程投影：不画条幅（只列文字）</div>`;

    const detail = `<div class="cal-detail" style="margin-top:4px;color:#9aa4b2;font-size:11px;line-height:1.6;">${this.detailHtmlOf(entry, view, windowText)}</div>`;

    return `<div class="cal-row" data-sch-id="${escapeHtml(entry.schId)}" data-mode="${escapeHtml(entry.view.mode)}" data-status="${escapeHtml(entry.view.status)}" data-active="${active}" title="${escapeHtml(this.hoverTextOf(entry, view, windowText))}"
      style="padding:6px ${ROW_PADDING_X_PX}px;margin-bottom:6px;border-radius:6px;border:${ROW_BORDER_PX}px solid ${active ? ACTIVE_BORDER : 'rgba(255,255,255,.14)'};background:${active ? 'rgba(111,168,220,.14)' : 'rgba(255,255,255,.03)'};cursor:pointer;font-size:12px;overflow-wrap:break-word;${active ? `box-shadow:0 0 0 2px ${ACTIVE_BORDER};` : ''}">
      ${track}${detail}
    </div>`;
  }

  /**
   * chip：水平位置/宽度 = 所属包 forecast 窗口 [start_ord, end_ord_max]（潜在窗口，§16.4）。
   * 窗口边界取 min/max 兜底倒置/越界声明，但**不钳位到地平线**（钳位会把窗口画错列）。
   */
  private renderChip(entry: CalendarEntry, forecast: ScheduleWindowView, bounds: CalendarBounds): string {
    const startOrd = Math.min(forecast.start_ord, forecast.end_ord_min, forecast.end_ord_max);
    const endOrd = Math.max(forecast.start_ord, forecast.end_ord_min, forecast.end_ord_max);
    const left = (startOrd - bounds.minOrd) * DAY_COLUMN_PX;
    const width = Math.max(1, endOrd - startOrd + 1) * DAY_COLUMN_PX;
    const confirmed = entry.view.status === 'confirmed';
    const mode = entry.view.mode;
    const status = entry.view.status;
    return `<div class="cal-chip" data-sch-id="${escapeHtml(entry.schId)}" data-start-ord="${startOrd}" data-end-ord="${endOrd}" data-mode="${escapeHtml(mode)}" data-status="${escapeHtml(status)}" data-confirmed="${confirmed}"
      title="${escapeHtml(`潜在窗口：${windowTextOf(forecast)}｜${entry.schId} ${modeLabelOf(mode)} ${statusLabelOf(status)}`)}"
      style="position:absolute;left:${left}px;width:${width}px;top:0;height:24px;box-sizing:border-box;display:flex;align-items:center;gap:4px;padding:0 6px;border-radius:4px;background:${modeColorOf(mode)};border:1px solid ${confirmed ? '#f4dfa8' : 'rgba(255,255,255,.35)'};${confirmed ? 'box-shadow:0 0 0 1px rgba(244,223,168,.5);' : ''}color:#101018;font-size:11px;overflow:hidden;white-space:nowrap;">
      <strong>${escapeHtml(entry.schId)}</strong><span>${escapeHtml(modeLabelOf(mode))}</span><span>${escapeHtml(statusLabelOf(status))}</span>
    </div>`;
  }

  /**
   * 「确认占用日」标记：只有锚点就绪时才画——ordinals 有真实日期，date→ord 是纯查表，
   * 不做工作日数学、不引投影模块。无锚点 = 没有日期坐标系，返回空：chip 仍钉潜在窗口，
   * 不拿 confirmed_at 反推任何列（§17/§18）。
   */
  private renderConfirmMark(entry: CalendarEntry, view: ScheduleProjectionView, bounds: CalendarBounds): string {
    const confirmedAt = entry.view.confirmed_at;
    if (entry.view.status !== 'confirmed' || !confirmedAt || !view.anchor_date) return '';
    const ordinal = (Array.isArray(view.ordinals) ? view.ordinals : []).find((item) => item?.date === confirmedAt);
    if (!ordinal) return '';
    const left = (ordinal.ord - bounds.minOrd) * DAY_COLUMN_PX;
    return `<div class="cal-confirm-mark" data-ord="${ordinal.ord}" title="确认占用日：第 ${ordinal.ord} 工作日（真实占用，§16.4；chip 仍画在潜在窗口）" style="position:absolute;left:${left}px;top:0;bottom:0;width:0;border-left:2px dashed #f4dfa8;"></div>`;
  }

  /** 窄屏单列：chip 改文字行（SCH id + mode + status + 潜在窗口文字），不画列网格。 */
  private renderTextRow(entry: CalendarEntry, view: ScheduleProjectionView): string {
    const selection = this.selection.get();
    const active = selection.packageId === entry.packageId && selection.checkId === entry.schId;
    const forecast = entry.projection?.forecast ?? null;
    const windowText = forecast ? `潜在窗口：${windowTextOf(forecast)}` : '潜在窗口：未知（所属包无排程投影）';
    const summary = `${entry.schId}｜${modeLabelOf(entry.view.mode)}｜${statusLabelOf(entry.view.status)}｜${windowText}`;
    return `<div class="cal-row cal-row-text" data-sch-id="${escapeHtml(entry.schId)}" data-mode="${escapeHtml(entry.view.mode)}" data-status="${escapeHtml(entry.view.status)}" data-active="${active}" title="${escapeHtml(this.hoverTextOf(entry, view, windowText))}"
      style="padding:6px ${ROW_PADDING_X_PX}px;margin-bottom:6px;border-radius:6px;border:${ROW_BORDER_PX}px solid ${active ? ACTIVE_BORDER : 'rgba(255,255,255,.14)'};background:${active ? 'rgba(111,168,220,.14)' : 'rgba(255,255,255,.03)'};cursor:pointer;font-size:12px;overflow-wrap:break-word;${active ? `box-shadow:0 0 0 2px ${ACTIVE_BORDER};` : ''}">
      <div style="color:#e0e0e0;">${escapeHtml(summary)}</div>
      <div class="cal-detail" style="margin-top:4px;color:#9aa4b2;font-size:11px;line-height:1.6;">${this.detailHtmlOf(entry, view, windowText)}</div>
    </div>`;
  }

  /** 行内明细（纯文本行，渲染处统一 escapeHtml）：窗口 / 包 / 方式状态 / 角色 / 约束 / 确认证据。 */
  private detailLinesOf(entry: CalendarEntry, view: ScheduleProjectionView, windowText: string): string[] {
    const coordination = entry.view;
    const lines: string[] = [];
    lines.push(`潜在窗口：${windowText}`);
    lines.push(`${entry.packageId} ${entry.packageName}${entry.packageSequence === null ? '｜包不在快照 packages（排序沉底）' : `｜第 ${entry.packageSequence} 序列`}`);
    lines.push(`方式：${modeLabelOf(coordination.mode)}（${coordination.mode}）｜状态：${statusLabelOf(coordination.status)}｜提前量 ${coordination.lead_time_workdays} 个工作日｜负责人角色：${coordination.owner_role}`);
    lines.push(`需到角色：${coordination.required_roles.length ? coordination.required_roles.join('、') : '—'}`);
    lines.push(`执行人：${coordination.actor?.name ?? '待指定'}${coordination.actor?.org ? `（${coordination.actor.org}）` : ''}`);
    const constraints = entry.projection?.constraints ?? [];
    const shown = constraints.slice(0, MAX_VISIBLE_CONSTRAINTS);
    for (const constraint of shown) lines.push(constraintTextOf(constraint));
    if (constraints.length > shown.length) lines.push(`等 ${constraints.length} 条约束`);
    const confirmNote = this.confirmNoteOf(entry, view);
    if (confirmNote) lines.push(confirmNote);
    return lines;
  }

  /**
   * 确认登记日证据文字（任务书 §1.2 / §17）：confirmed_at 原样展示。无锚点时注明
   * 「不钉列」——没有日期坐标系，chip 仍在潜在窗口；有锚点才补查表得到的 ord。
   * 查不到时的措辞只声明「不在当前投影范围」（Codex 二审 minor，2026-11-12 修）：
   * ordinals 是排程投影的有限范围，不是完整工作日历——查表未命中推不出「非工作日」。
   */
  private confirmNoteOf(entry: CalendarEntry, view: ScheduleProjectionView): string {
    const confirmedAt = entry.view.confirmed_at;
    if (entry.view.status !== 'confirmed' || !confirmedAt) return '';
    if (!view.anchor_date) {
      return `确认登记日 ${confirmedAt}（无锚点，不钉列：没有日期坐标系，条幅仍画在潜在窗口）`;
    }
    const ordinal = (Array.isArray(view.ordinals) ? view.ordinals : []).find((item) => item?.date === confirmedAt);
    return ordinal
      ? `确认登记日 ${confirmedAt}（第 ${ordinal.ord} 工作日）`
      : `确认登记日 ${confirmedAt}（日期不在当前投影范围，无法定位）`;
  }

  private detailHtmlOf(entry: CalendarEntry, view: ScheduleProjectionView, windowText: string): string {
    return this.detailLinesOf(entry, view, windowText).map(escapeHtml).join('<br>');
  }

  private hoverTextOf(entry: CalendarEntry, view: ScheduleProjectionView, windowText: string): string {
    const lines = this.detailLinesOf(entry, view, windowText);
    if (entry.view.escalation) lines.push(`升级口径：${entry.view.escalation}`);
    return lines.join('\n');
  }

  // ─── 事件 ────────────────────────────────────────────────────────────────

  private bind(body: HTMLElement): void {
    for (const row of Array.from(body.querySelectorAll('.cal-row[data-sch-id]'))) {
      row.addEventListener('click', () => {
        const schId = String((row as HTMLElement).dataset.schId ?? '');
        // 只从当前快照取条目（不缓存渲染期状态）：payload 已被刷新换掉时旧行不可点写。
        const view = this.payload?.coordination?.[schId];
        if (!view) return;
        // D5：只写共享选中态。不调 onHighlight、不展开 scope——定位的唯一使用者仍是
        // ScheduleDetailPanel（#191 退役选择器时本面板零改动）。
        this.selection.set({packageId: view.package_id, checkId: schId});
        this.render();
      });
    }
  }

  // ─── 容器宽度（≤700px 退化，issue #83 先例）─────────────────────────────

  /** 面板内容区实测宽（jsdom 不做布局，clientWidth 恒 0 → 按宽容器）。 */
  private availableWidth(): number {
    const body = this.el?.querySelector('#coordination-calendar-body') as HTMLElement | null;
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
    el.id = 'coordination-calendar-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none;
    `;
    el.innerHTML = `
      <div class="dynamic-panel-heading">
        <strong>协调日历</strong>
        <button id="coordination-calendar-panel-toggle" class="panel-collapse-toggle" type="button" aria-controls="coordination-calendar-panel-content" aria-expanded="true" aria-label="协调日历面板折叠" title="折叠">−</button>
      </div>
      <div id="coordination-calendar-panel-content">
        <div id="coordination-calendar-body"></div>
      </div>
    `;
    // 路由级独立页：挂到审批页容器（测试只提供挂载点，见测试 installDom）。
    const stack = document.getElementById('approval-page-panels');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#coordination-calendar-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#coordination-calendar-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);
    const body = el.querySelector('#coordination-calendar-body') as HTMLElement | null;
    if (body && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.onContainerResize());
      observer.observe(body);
      this.resizeObserver = observer;
    }
    this.el = el;
  }
}
