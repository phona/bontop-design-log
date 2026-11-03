// 自装审批「工序流程图」面板（feat/approval-flow-chart，2026-11-02）。
//
// 数据来源只有两个只读接口（不另读 control.yaml、不拉 /api/project）：
//  1. `GET /api/schedule/state`——包结构、状态、付款门槛、阻塞、检查（与
//     `npm run verify:schedule` 同一个 loader、同一份判定，浏览器不自己算状态）；
//  2. `GET /api/model-package-links`——包到 3D 范围的映射，只用来判「几何能力
//     徽标」，不展开具体房间/对象（展开是 ScheduleDetailPanel 的事）。
//
// 布局不自己发明：`computeFlowLayout`（shared/flow-layout.ts，值导入、浏览器
// 安全）吃包列表吐 layer/row/sideLane 与边；本面板只把 layer→列、row→行映射成
// 绝对定位像素，边画成 SVG bezier。明确不做：图形编辑器、拖拽、自动布局引擎。
//
// 铁律落实：
//  - 颜色旁必须始终有文字：状态色点旁一律有中文状态文字，未通过数 / 门槛 / 阻塞
//    原因全部文字化，禁止把颜色当唯一证据；
//  - 有阻塞必须写原因文字（item + 解除条件），不能只变色；无阻塞不显示该行；
//  - 所有动态字符串过 escapeHtml；颜色只来自下面的固定映射表，禁止把 payload
//    字符串当颜色用；
//  - 点节点只写共享选中态 + 通知外部高亮 3D，不产生任何配置写入（写路径走 PR）；
//  - 3D 反查高亮把传入的全部包都标出来，不许静默只标首个。
import type { ScheduleSnapshot, SchedulePackageView } from '@shared/schedule-state';
import type { ScheduleSelectionStore } from '../state/schedule-selection.js';
import { computeFlowLayout, type FlowLayout, type FlowLayoutNode } from '@shared/flow-layout';
import { setupCollapsiblePanel } from './CollapsiblePanel.js';
import { escapeHtml } from './escape-html.js';

export interface FlowChartPanelOptions {
  /** 点节点（有 3D 范围的包）/「在 3D 中高亮」时通知外部（App 接 HouseScene）。 */
  onHighlight?: (packageId: string) => void;
  /** 「完整详情」按钮：打开 ScheduleDetailPanel。缺省时按钮禁用并注明「未接线」。 */
  onOpenDetail?: (packageId: string) => void;
}

/** /api/model-package-links 里本面板用到的部分（只取 links，不取 authorities）。 */
interface ModelPackageLink {
  id: string;
  phase_id: string;
  budget_ref: {source: string; id: string};
  mapping_status: string;
  scope?: Array<{source: string; select: Record<string, unknown>}>;
  note?: string;
}

interface ModelPackageLinksPayload {
  links?: ModelPackageLink[];
}

// ─── 固定映射表（颜色只能来自这里；文字与颜色必须同时出现）────────────────────

/** 包状态词汇（control.yaml status_values 七值）。 */
const STATUS_LABEL: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  ready_for_inspection: '待验收',
  passed: '已通过',
  failed: '未通过需整改',
  blocked: '阻塞',
  waived: '豁免',
};

/** 服务端派生状态：原样显示 token 并注明是派生值（斜纹色点 + 文字注明）。 */
const DERIVED_STATUSES = new Set(['stale_or_unverified', 'blocked_by_precondition']);

const STATUS_COLOR: Record<string, string> = {
  not_started: '#8a93a3', // 灰
  in_progress: '#6fa8dc', // 蓝
  ready_for_inspection: '#e9c46a', // 黄
  passed: '#5cb85c', // 绿
  failed: '#d9534f', // 红
  blocked: '#d98c3f', // 橙
  waived: '#9b8bd0', // 紫
  stale_or_unverified: '#e9c46a',
  blocked_by_precondition: '#d98c3f',
};

const READINESS_LABEL: Record<string, string> = {ready: '就绪', blocked: '未就绪'};
const GATE_LABEL: Record<string, string> = {passed: '已过', failed: '未过', pending: '待验'};
const GATE_COLOR: Record<string, string> = {passed: '#5cb85c', failed: '#d9534f', pending: '#e9c46a'};

const NEUTRAL_COLOR = '#8a93a3';
const ACTIVE_BORDER = '#6fa8dc';
const HIGHLIGHT_BORDER = '#e9c46a';

function labelOf(map: Record<string, string>, value: string | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}

function colorOf(map: Record<string, string>, value: string | undefined): string {
  if (!value) return NEUTRAL_COLOR;
  return map[value] ?? NEUTRAL_COLOR;
}

function statusLabelOf(value: string): string {
  const base = STATUS_LABEL[value];
  if (base) return base;
  // 派生值原样显示 token 并注明（铁律：不把派生值翻译成看起来像声明值的词）
  return DERIVED_STATUSES.has(value) ? `${value}（派生）` : value;
}

// ─── 几何能力（按 links 判定，不拉 /api/project）──────────────────────────────

type GeometryCapability = 'scene' | 'point' | 'project';

/** 点位级选择器（已可高亮：点位默认合批渲染，HouseScene.highlightPoints 逐实例着色，未合批单件 emissive 兜底）。 */
const POINT_SELECTOR_KEYS = new Set(['ids', 'layers', 'trade', 'plan_ids']);

const CAPABILITY_BADGE: Record<GeometryCapability, {label: string; title: string}> = {
  project: {
    label: '全项目范围',
    title: '该包没有具体 3D 范围选择器（无 link / select all / 未建模）：不占 3D 反查，点节点不会调 3D 高亮',
  },
  point: {
    label: '点位级（可高亮）',
    title: '该包只有 ids/layers/trade/plan_ids 类点位选择器：点位为合批渲染，已支持逐实例高亮（BatchedMesh.setColorAt；未合批的单件点位走 emissive 兜底）',
  },
  scene: {
    label: '有 3D 范围',
    title: '该包有房间/墙/叠加层区域级选择器：点节点会通知外部在 3D 中高亮',
  },
};

function isPointOnlySelector(select: Record<string, unknown>): boolean {
  const keys = Object.keys(select).filter((key) => select[key] !== undefined);
  return keys.length > 0 && keys.every((key) => POINT_SELECTOR_KEYS.has(key));
}

function capabilityOf(packageId: string, links: ModelPackageLink[]): GeometryCapability {
  const packageLinks = links.filter((link) => link.budget_ref?.id === packageId);
  // 无 link（或 not_modelled 的无选择器 link）→ 没有具体 3D 范围，同「全项目范围」
  if (packageLinks.length === 0) return 'project';
  const scopes = packageLinks.flatMap((link) => link.scope ?? []);
  if (scopes.some((scope) => (scope.select ?? {}).all === true)) return 'project';
  const declared = scopes.filter((scope) => Object.keys(scope.select ?? {}).some((key) => (scope.select as Record<string, unknown>)[key] !== undefined));
  if (declared.length === 0) return 'project';
  // 只有点位级选择器 → 点位级；混合或含房间/墙/区域级 → 有 3D 范围
  return declared.every((scope) => isPointOnlySelector(scope.select ?? {})) ? 'point' : 'scene';
}

// ─── 画布几何（layer→列、row→行；节点约 200×84）─────────────────────────────

const NODE_WIDTH = 200;
const NODE_HEIGHT = 84;
const COLUMN_PITCH = 240;
const ROW_PITCH = 104;
const CANVAS_PAD = 16;

let panelSeq = 0;

export class FlowChartPanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private unsubscribe: (() => void) | null = null;
  private payload: ScheduleSnapshot | null = null;
  private links: ModelPackageLink[] = [];
  private layout: FlowLayout | null = null;
  private errorMessage: string | null = null;
  /** 3D 反查高亮（点对象 → 归属包）：可能同时属多个包，全部标出。 */
  private highlighted = new Set<string>();
  private readonly uid = `flow-chart-${(panelSeq += 1)}`;

  constructor(
    private readonly selection: ScheduleSelectionStore,
    private readonly options: FlowChartPanelOptions = {},
  ) {}

  show(): void {
    if (!this.el) this.build();
    this.el!.style.display = 'block';
    this.visible = true;
    // show() 时按 store 当前值恢复 active 节点与选中条（#pkg=… 深链直达）；
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

  /**
   * 订阅共享选中态：外部（3D 反查、其他面板）改选中时同步节点 active 与选中条。
   * 重复订阅先退订；返回退订函数。
   */
  subscribe(): () => void {
    this.unsubscribe?.();
    this.unsubscribe = this.selection.subscribe(() => this.render());
    return () => {
      this.unsubscribe?.();
      this.unsubscribe = null;
    };
  }

  /** 重新拉取两个接口并渲染。任一失败 → 错误态（HTTP 状态 + 提示）。 */
  async refresh(): Promise<void> {
    try {
      const [stateResponse, linksResponse] = await Promise.all([
        fetch('/api/schedule/state'),
        fetch('/api/model-package-links'),
      ]);
      if (!stateResponse.ok) throw new Error(`HTTP ${stateResponse.status}（/api/schedule/state）`);
      if (!linksResponse.ok) throw new Error(`HTTP ${linksResponse.status}（/api/model-package-links）`);
      const snapshot = (await stateResponse.json()) as ScheduleSnapshot;
      const linksPayload = (await linksResponse.json()) as ModelPackageLinksPayload;
      this.payload = snapshot;
      this.links = linksPayload.links ?? [];
      this.errorMessage = null;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
    this.render();
  }

  /**
   * 3D 反查：把传入的全部包节点标记为「3D 选中」（多个就多个都标，不许静默
   * 只标首个）。快照里没有的 id 也留在集合里（刷新后进来仍显示），提示条只数
   * 真正画出来的节点。
   */
  highlightPackages(packageIds: string[]): void {
    this.highlighted = new Set(packageIds);
    this.render();
  }

  // ─── 渲染 ────────────────────────────────────────────────────────────────

  private render(): void {
    const body = this.el?.querySelector('#flow-chart-body') as HTMLElement | null;
    if (!body) return;

    // 重渲染会整体换 innerHTML：留住画布滚动位置（点节点/选中变化不该把图弹回左上）
    const previous = body.querySelector('#flow-chart-canvas') as HTMLElement | null;
    const scrollLeft = previous?.scrollLeft ?? 0;
    const scrollTop = previous?.scrollTop ?? 0;

    const error = this.errorMessage
      ? `<div style="margin-bottom:8px;padding:6px 8px;border:1px solid rgba(217,83,79,.55);border-radius:6px;background:rgba(217,83,79,.12);color:#f0a9a5;font-size:12px;">取数失败：${escapeHtml(this.errorMessage)}　接口不通或控制源校验不过；起服务 / 修好 config 后重试。</div>`
      : '';

    body.innerHTML = this.payload
      ? `${error}${this.renderChart(this.payload)}`
      : `${error}<div style="color:#9aa4b2;font-size:12px;">未取得流程图数据。</div>`;

    const canvas = body.querySelector('#flow-chart-canvas') as HTMLElement | null;
    if (canvas) {
      canvas.scrollLeft = scrollLeft;
      canvas.scrollTop = scrollTop;
    }
    this.bind(body);
  }

  private renderChart(snapshot: ScheduleSnapshot): string {
    this.layout = computeFlowLayout(snapshot.packages);
    const layout = this.layout;
    const packageById = new Map(snapshot.packages.map((pkg) => [pkg.id, pkg]));

    const mainNodes = layout.nodes.filter((node) => !node.sideLane);
    const sideNodes = layout.nodes.filter((node) => node.sideLane);
    const maxRows = Math.max(1, ...layout.layerSizes);
    const canvasWidth = CANVAS_PAD * 2 + Math.max(0, layout.layerCount - 1) * COLUMN_PITCH + NODE_WIDTH;
    const canvasHeight = CANVAS_PAD * 2 + (maxRows - 1) * ROW_PITCH + NODE_HEIGHT;

    const head = `<div style="margin-bottom:8px;color:#9aa4b2;font-size:11px;line-height:1.7;">
      共 ${snapshot.packages.length} 个工作包（${mainNodes.length} 个工序包 + ${sideNodes.length} 个侧车道）｜依赖分层 ${layout.layerCount} 层｜最多一层 ${Math.max(0, ...layout.layerSizes)} 个节点。
      数据只读自 <code>/api/schedule/state</code> 与 <code>/api/model-package-links</code>；点节点只写选中态与 3D 高亮，改配置一律走 PR。
    </div>${this.renderLegend()}`;

    if (mainNodes.length === 0) {
      return `${head}<div style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">
        当前快照没有工序包（schedule/phase-1/control.yaml 的 work_packages 为空），流程图无内容可画。
      </div>${sideNodes.length ? this.renderSideLane(sideNodes, packageById) : ''}${this.renderReverseHint(layout)}${this.renderSelectionBar(snapshot)}`;
    }

    const edges = layout.edges.map((edge) => this.renderEdge(edge, layout)).join('');
    const nodes = mainNodes
      .map((node) => this.renderNodeCard(packageById.get(node.id), node))
      .join('');

    return `${head}
      <div id="flow-chart-canvas" style="position:relative;overflow:auto;max-height:460px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:rgba(255,255,255,.02);">
        <div style="position:relative;width:${canvasWidth}px;height:${canvasHeight}px;">
          <svg width="${canvasWidth}" height="${canvasHeight}" style="position:absolute;left:0;top:0;z-index:0;pointer-events:none;" aria-hidden="true">
            <defs>
              <marker id="${this.uid}-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill="${NEUTRAL_COLOR}"></path>
              </marker>
            </defs>
            ${edges}
          </svg>
          ${nodes}
        </div>
      </div>
      ${sideNodes.length ? this.renderSideLane(sideNodes, packageById) : ''}
      ${this.renderReverseHint(layout)}
      ${this.renderSelectionBar(snapshot)}`;
  }

  /** 状态图例：颜色与文字成对出现（铁律：颜色不能单独作证据）。 */
  private renderLegend(): string {
    const entries = Object.entries(STATUS_LABEL).map(([value, label]) =>
      `<span style="display:inline-flex;align-items:center;margin-right:8px;">${this.renderStatusDot(value)}${escapeHtml(label)}</span>`).join('');
    return `<div style="display:flex;flex-wrap:wrap;margin-bottom:8px;font-size:11px;color:#9aa4b2;">${entries}
      <span style="color:#7d8698;">斜纹点 = 服务端派生状态（stale_or_unverified / blocked_by_precondition，原样显示 token）</span>
    </div>`;
  }

  private renderStatusDot(value: string): string {
    const derived = DERIVED_STATUSES.has(value);
    return `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;background:${colorOf(STATUS_COLOR, value)};border:1px solid rgba(255,255,255,.25);${derived ? 'background-image:repeating-linear-gradient(45deg,rgba(0,0,0,.45) 0 2px,transparent 2px 5px);' : ''}"></span>`;
  }

  private renderEdge(edge: {from: string; to: string}, layout: FlowLayout): string {
    const from = layout.nodes.find((node) => node.id === edge.from);
    const to = layout.nodes.find((node) => node.id === edge.to);
    if (!from || !to || from.sideLane || to.sideLane) return '';
    const x1 = CANVAS_PAD + from.layer * COLUMN_PITCH + NODE_WIDTH;
    const y1 = CANVAS_PAD + from.row * ROW_PITCH + NODE_HEIGHT / 2;
    const x2 = CANVAS_PAD + to.layer * COLUMN_PITCH;
    const y2 = CANVAS_PAD + to.row * ROW_PITCH + NODE_HEIGHT / 2;
    const dx = Math.max(24, (x2 - x1) / 2);
    return `<path class="flow-edge" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}" d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="${NEUTRAL_COLOR}" stroke-width="1.5" marker-end="url(#${this.uid}-arrow)"></path>`;
  }

  private renderNodeCard(pkg: SchedulePackageView | undefined, node: FlowLayoutNode | null): string {
    if (!pkg) return '';
    const capability = capabilityOf(pkg.id, this.links);
    const badge = CAPABILITY_BADGE[capability];
    const active = this.selection.get().packageId === pkg.id;
    const highlighted = this.highlighted.has(pkg.id);
    const total = pkg.checks.length;
    const failed = pkg.checks.filter((check) => check.audit_status !== 'passed').length;
    const openBlockers = pkg.blockers.filter((blocker) => !blocker.closed);
    const borderColor = active ? ACTIVE_BORDER : highlighted ? HIGHLIGHT_BORDER : 'rgba(255,255,255,.16)';
    const emphasis = active
      ? `box-shadow:0 0 0 2px ${ACTIVE_BORDER};`
      : highlighted ? `box-shadow:0 0 0 2px ${HIGHLIGHT_BORDER};` : '';
    const geometry = node
      ? `position:absolute;left:${CANVAS_PAD + node.layer * COLUMN_PITCH}px;top:${CANVAS_PAD + node.row * ROW_PITCH}px;`
      : 'position:relative;flex:0 0 auto;';
    const title = [
      `${pkg.id} ${pkg.name}`,
      `状态：${statusLabelOf(pkg.effective_status)}`,
      `未通过检查 ${failed}/${total}`,
      `${pkg.gate_label} ${pkg.payment_gate}：${labelOf(GATE_LABEL, pkg.gate_status)}`,
      ...openBlockers.map((blocker) => `阻塞：${blocker.item ?? blocker.id}（解除：${blocker.clears_when ?? '—'}）`),
      badge.title,
    ].join('\n');

    const blockers = openBlockers.length
      ? `<div style="margin-top:2px;color:#f4dfa8;font-size:11px;line-height:1.4;">${openBlockers
          .map((blocker) => `阻塞：${escapeHtml(blocker.item ?? blocker.id)}<span style="color:#9aa4b2;">（解除：${escapeHtml(blocker.clears_when ?? '—')}）</span>`)
          .join('<br>')}</div>`
      : '';

    return `<div class="flow-node" data-pkg-id="${escapeHtml(pkg.id)}" data-layer="${node ? node.layer : -1}" data-row="${node ? node.row : 0}" data-side-lane="${node ? node.sideLane : true}" data-active="${active}" data-highlight="${highlighted}" data-capability="${capability}" title="${escapeHtml(title)}"
      style="${geometry}width:${NODE_WIDTH}px;min-height:${NODE_HEIGHT}px;max-height:100px;box-sizing:border-box;padding:6px 8px;border-radius:8px;border:1px solid ${borderColor};background:#232342;color:#e0e0e0;font-size:12px;cursor:pointer;overflow:hidden;z-index:1;${emphasis}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <strong style="font-size:12px;white-space:nowrap;">${escapeHtml(pkg.id)}</strong>
        <span style="padding:1px 5px;border-radius:4px;background:rgba(255,255,255,.08);color:#aeb8c8;font-size:10px;white-space:nowrap;" title="${escapeHtml(badge.title)}">${escapeHtml(badge.label)}</span>
      </div>
      <div style="margin-top:2px;font-size:12px;line-height:1.35;overflow:hidden;" title="${escapeHtml(pkg.name)}">${escapeHtml(pkg.name)}</div>
      <div style="margin-top:3px;font-size:11px;line-height:1.5;">${this.renderStatusDot(pkg.effective_status)}${escapeHtml(statusLabelOf(pkg.effective_status))}</div>
      <div style="font-size:11px;color:#9aa4b2;line-height:1.5;">未通过 ${failed}/${total}｜${escapeHtml(pkg.gate_label)} ${escapeHtml(pkg.payment_gate)} ${escapeHtml(labelOf(GATE_LABEL, pkg.gate_status))}</div>
      ${blockers}
      ${highlighted ? `<div style="margin-top:2px;color:${HIGHLIGHT_BORDER};font-size:10px;">← 3D 选中</div>` : ''}
    </div>`;
  }

  /** PKG-900 等侧车道：图表下方单独一条横带，不占工序、不参与依赖分层。 */
  private renderSideLane(sideNodes: FlowLayoutNode[], packageById: Map<string, SchedulePackageView>): string {
    const cards = sideNodes.map((node) => this.renderNodeCard(packageById.get(node.id), null)).join('');
    return `<div id="flow-side-lane" style="margin-top:10px;padding:8px 10px;border:1px dashed rgba(155,139,208,.45);border-radius:6px;background:rgba(155,139,208,.08);">
      <div style="margin-bottom:6px;color:#c3b8ea;font-size:11px;">预备金·侧车道（不占工序、不参与依赖分层）</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">${cards}</div>
    </div>`;
  }

  /** 3D 反查命中多个包时，选中条上方给明确提示（不许静默只标首个）。 */
  private renderReverseHint(layout: FlowLayout): string {
    const marked = layout.nodes.filter((node) => this.highlighted.has(node.id));
    if (marked.length <= 1) return '';
    return `<div id="flow-reverse-hint" style="margin-top:8px;padding:6px 8px;border:1px solid rgba(233,196,106,.45);border-radius:6px;background:rgba(233,196,106,.1);color:#f4dfa8;font-size:12px;">
      该 3D 对象同属 ${marked.length} 个包，已全部标出（${escapeHtml(marked.map((node) => node.id).join('、'))}）。
    </div>`;
  }

  private renderSelectionBar(snapshot: ScheduleSnapshot): string {
    const packageId = this.selection.get().packageId;
    if (!packageId) {
      return `<div id="flow-selection-bar" style="margin-top:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(255,255,255,.04);color:#9aa4b2;font-size:12px;">
        还没有选中工作包——点流程图里的节点，或打开带 <code>#pkg=PKG-xxx</code> 的链接。
      </div>`;
    }
    const pkg = snapshot.packages.find((item) => item.id === packageId);
    if (!pkg) {
      return `<div id="flow-selection-bar" style="margin-top:10px;padding:8px 10px;border:1px solid rgba(233,196,106,.45);border-radius:6px;background:rgba(233,196,106,.08);color:#f4dfa8;font-size:12px;">
        包不在当前快照：${escapeHtml(packageId)}（control.yaml 里已删除/改名，或快照是旧的——刷新后重试）
      </div>`;
    }

    const capability = capabilityOf(pkg.id, this.links);
    const total = pkg.checks.length;
    const failed = pkg.checks.filter((check) => check.audit_status !== 'passed');
    const openBlockers = pkg.blockers.filter((blocker) => !blocker.closed);
    const nextCheck = failed[0];

    const blockers = openBlockers.length
      ? `<div style="margin-top:2px;color:#f4dfa8;font-size:12px;line-height:1.6;">未关闭阻塞：${openBlockers
          .map((blocker) => `${escapeHtml(blocker.item ?? blocker.id)}<span style="color:#9aa4b2;">（解除：${escapeHtml(blocker.clears_when ?? '—')}）</span>`)
          .join('；')}</div>`
      : '';

    const nextTodo = nextCheck
      ? `<div style="margin-top:2px;font-size:12px;line-height:1.6;">下一个待办：${escapeHtml(nextCheck.item ?? nextCheck.id)}<span style="color:#9aa4b2;">（通过标准：${escapeHtml(nextCheck.pass_condition ?? '—')}）</span></div>`
      : `<div style="margin-top:2px;color:#5cb85c;font-size:12px;">检查项全部通过。</div>`;

    const detailButton = this.options.onOpenDetail
      ? `<button type="button" id="flow-open-detail" style="cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #6fa8dc;background:#2f4a63;color:#e8f2ff;font-size:12px;">完整详情</button>`
      : `<button type="button" id="flow-open-detail" disabled title="未提供 onOpenDetail 回调（App 未接线包详情面板）" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:#2a2a3e;color:#8a93a3;font-size:12px;">完整详情</button>
         <span style="color:#9aa4b2;font-size:11px;">未接线</span>`;

    let highlightButton: string;
    if (!this.options.onHighlight) {
      highlightButton = `<button type="button" id="flow-highlight" disabled title="未提供 onHighlight 回调（App 未接线 3D 高亮）" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:#2a2a3e;color:#8a93a3;font-size:12px;">在 3D 中高亮</button>
         <span style="color:#9aa4b2;font-size:11px;">未接线：本面板没有拿到 3D 高亮回调</span>`;
    } else if (capability === 'project') {
      // 仅全项目范围禁用：点位级已可高亮（合批实例 setColorAt 逐实例 + 未合批单件 emissive 兜底）
      highlightButton = `<button type="button" id="flow-highlight" disabled title="${escapeHtml(CAPABILITY_BADGE.project.title)}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:#2a2a3e;color:#8a93a3;font-size:12px;">在 3D 中高亮</button>
         <span style="color:#9aa4b2;font-size:11px;">${escapeHtml(CAPABILITY_BADGE.project.label)}：没有具体 3D 范围，点节点不会调 3D 高亮</span>`;
    } else {
      // 按钮 title 按能力取各自口径：点位级包的按钮说明逐实例着色，不再借 scene 通用文案
      highlightButton = `<button type="button" id="flow-highlight" title="${escapeHtml(CAPABILITY_BADGE[capability].title)}" style="cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #6fa8dc;background:#2f4a63;color:#e8f2ff;font-size:12px;">在 3D 中高亮</button>`;
    }

    return `<div id="flow-selection-bar" style="margin-top:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(255,255,255,.04);font-size:12px;line-height:1.7;">
      <div style="font-size:13px;"><strong>${escapeHtml(pkg.id)}</strong>｜${escapeHtml(pkg.name)}
        <span style="margin-left:6px;">${this.renderStatusDot(pkg.effective_status)}${escapeHtml(statusLabelOf(pkg.effective_status))}</span>
        <span style="margin-left:6px;color:#9aa4b2;">就绪：${escapeHtml(labelOf(READINESS_LABEL, pkg.effective_readiness))}</span>
      </div>
      <div style="color:#9aa4b2;">${escapeHtml(pkg.gate_label)} ${escapeHtml(pkg.payment_gate)}：${escapeHtml(labelOf(GATE_LABEL, pkg.gate_status))}｜未通过检查 ${failed.length}/${total}｜依赖：${escapeHtml(pkg.dependencies.join('、') || '无')}</div>
      ${blockers}
      ${nextTodo}
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">${detailButton}${highlightButton}</div>
    </div>`;
  }

  // ─── 事件 ────────────────────────────────────────────────────────────────

  private bind(body: HTMLElement): void {
    for (const node of Array.from(body.querySelectorAll('.flow-node[data-pkg-id]'))) {
      node.addEventListener('click', () => {
        const packageId = String((node as HTMLElement).dataset.pkgId ?? '');
        if (!packageId) return;
        this.selection.set({packageId, checkId: null});
        // 有 3D 范围（房间/墙/叠加层区域级）或点位级都通知外部高亮；仅全项目范围不高亮
        if (capabilityOf(packageId, this.links) !== 'project') this.options.onHighlight?.(packageId);
        this.render();
      });
    }
    body.querySelector('#flow-open-detail')?.addEventListener('click', () => {
      const packageId = this.selection.get().packageId;
      if (packageId) this.options.onOpenDetail?.(packageId);
    });
    body.querySelector('#flow-highlight')?.addEventListener('click', () => {
      const packageId = this.selection.get().packageId;
      if (packageId) this.options.onHighlight?.(packageId);
    });
  }

  // ─── 骨架 ────────────────────────────────────────────────────────────────

  private build(): void {
    const el = document.createElement('div');
    el.id = 'flow-chart-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none; max-width: 720px;
    `;
    el.innerHTML = `
      <div class="dynamic-panel-heading">
        <strong>工序流程图</strong>
        <button id="flow-chart-panel-toggle" class="panel-collapse-toggle" type="button" aria-controls="flow-chart-panel-content" aria-expanded="true" aria-label="工序流程图面板折叠" title="折叠">−</button>
      </div>
      <div id="flow-chart-panel-content">
        <div id="flow-chart-body"></div>
      </div>
    `;
    const stack = document.getElementById('right-panel-stack');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#flow-chart-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#flow-chart-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);
    this.el = el;
  }
}
