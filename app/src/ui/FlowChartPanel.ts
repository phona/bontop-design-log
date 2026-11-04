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
//  - 3D 反查高亮把传入的全部包都标出来，不许静默只标首个；多包命中时选中态
//    **不预设首个包**（#67）：留空 + 提示由业主点节点选，或保留仍命中的上次选择。
import type { ScheduleSnapshot, SchedulePackageView } from '@shared/schedule-state';
import { isPointSourceAllSelector } from '@shared/package-scope';
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

// ─── 包视图的共用取值（卡片 / 选中条 / 高度估算同一处，禁三处各写一份）────────

/** 未关闭阻塞（已关闭的不进卡片、不进选中条）。 */
function openBlockersOf(pkg: SchedulePackageView): SchedulePackageView['blockers'] {
  return pkg.blockers.filter((blocker) => !blocker.closed);
}

/** 单条阻塞原因的卡片文案（item + 解除条件；缺 item 落 id）。 */
function blockerLineTextOf(blocker: SchedulePackageView['blockers'][number]): string {
  return `阻塞：${blocker.item ?? blocker.id}（解除：${blocker.clears_when ?? '—'}）`;
}

/**
 * 「还有 N 条」折叠提示文案。卡片渲染与高度估算共用同一份（禁两份各写——
 * 两边文案漂移等于估算又对不上渲染）。该长句在 ~184px 卡宽内必然换行（见
 * estimateNodeCardHeight 里按 textLinesOf 算行数）。
 */
function moreBlockersLineTextOf(hiddenCount: number): string {
  return `还有 ${hiddenCount} 条阻塞原因（点此节点，完整列表见下方选中条与详情）`;
}

/**
 * 检查汇总行文案。未通过与未验收分列（2026-11-03 修设计稿 P2-12）：
 * audit_status !== 'passed' 会把还没执行的 pending 也算成未通过——业主看到
 * 「未通过 3/7」以为三项不合格，实际可能只是还没验。not_applicable（豁免）
 * 两栏都不计。
 */
function checkLineTextOf(pkg: SchedulePackageView): string {
  const total = pkg.checks.length;
  const failedCount = pkg.checks.filter((check) => check.audit_status === 'failed').length;
  const pendingCount = pkg.checks.filter((check) => !check.audit_status || check.audit_status === 'pending').length;
  return `未通过 ${failedCount}/${total}｜未验收 ${pendingCount}｜${pkg.gate_label} ${pkg.payment_gate} ${labelOf(GATE_LABEL, pkg.gate_status)}`;
}

/**
 * 按字符估算文本在卡片里占几行。CJK/全角/通用标点（≥U+2010）按 1 em、ASCII
 * 按 0.65 em——估算只许偏高：偏高 = 行间多留白，偏低 = 卡片压住下一行。改卡片
 * 字号/内边距时必须同步这里。
 *
 * 0.65 的由来（issue #78 真浏览器实测，'Segoe UI', system-ui, sans-serif）：
 * ASCII 实测 0.627–0.633 em/字符——`stale_or_unverified`（18 字符）11px 下实测
 * 125.41px = 0.633 em，`blocked_by_precondition`（22 字符）151.81px = 0.627 em。
 * 旧值 0.6 **低于实测**，长 ASCII 串（派生状态 token 等）会被少算一行；旧注释
 * 「实际约 0.5em，刻意高估」与实测不符，已按实测更正。CJK 实测恰为 1 em
 * （（派生）4 字符 = 44px、未通过需整改 6 字符 = 66px，11px 字号）。
 *
 * @param width 可用文本宽度（px）。默认 CARD_TEXT_WIDTH；状态行要先扣掉色点
 *   占宽（见 estimateNodeCardHeight 的 STATUS_DOT_PX）。
 */
function textLinesOf(text: string, fontSize: number, width: number = CARD_TEXT_WIDTH): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    em += code >= 0x2010 ? 1 : 0.65;
  }
  return Math.max(1, Math.ceil((em * fontSize) / width));
}

/**
 * 节点卡片高度估算（px）。镜像 renderNodeCard 实际渲染的结构：id 行 + 包名 +
 * 状态行（按实际文案与「卡宽 − 色点占宽」算换行行数）+ 检查汇总行 + 最多
 * MAX_VISIBLE_BLOCKERS 条阻塞（每条最多 BLOCKER_MAX_LINES 行）+ 「还有 N 条」
 * 行（按实际文案与卡宽算换行行数）+「← 3D 选中」行。
 *
 * 为什么估算而不实测：jsdom 不做布局（offsetHeight 恒 0），而行坐标、画布高度
 * 和边端点都要求确定性数值；估算同时是测试可断言的唯一口径。实测背景（#68）：
 * 真实快照里阻塞最多的节点是 PKG-000（5 条未关闭阻塞，PKG-030/040 各 4 条），
 * 旧固定 max-height:100px + overflow:hidden 会把它们整段静默截掉。
 *
 * 「还有 N 条」长句在 182px 卡宽内必然换行（两行起）：只按固定一行加会把
 * 多阻塞节点的卡片高度算低，行坐标、画布高度与边端点整套跟着偏低，相邻行
 * 的卡片会互相压住——故这里按 textLinesOf(实际文案, 10px) 算行数（与渲染
 * 共用 moreBlockersLineTextOf，禁两份各写）。
 *
 * 估算与实测的偏差上界（issue #78 真浏览器实测：Chromium + 本项目字体
 * 'Segoe UI', system-ui；全部 24 个工序节点、三种场景——实时快照 / 3D 反查
 * 高亮 5 包（walltile_kitchen_ent_west → PKG-050/060/065/130/135）/ fetch 层
 * 注入派生状态（PKG-120=stale_or_unverified、PKG-130=blocked_by_precondition，
 * 因实时快照 25/25 包均 not_started、无派生态可量）+ 高亮与派生叠加）：
 *  - estimateNodeCardHeight − 实测卡高 = **+8.3 … +27.3px**，恒偏高（方向安全：
 *    偏高只多留白，偏低才压行）。最大偏差来自检查汇总行的长 ASCII gate id：
 *    PKG-040 的 GATE-040-HIDDEN-WORK 实测 2 行、估算 3 行，多算一行换不压行；
 *  - 行分配（行内最高估算）− 行内最高实测卡 = **+8.3 … +27.3px**；相邻行同列
 *    卡片最小间隙 **+16.3px**（修复前派生状态场景为 **−0.2px 压行**）；末行卡底
 *    距画布内边 **24.3–24.8px**，不出界；
 *  - 边端点与卡片实测中心的漂移 **≤ 13.6px**（= (估算−实测)/2，端点仍落在卡片
 *    高度范围内，不脱节）。
 * 改卡片字号/内边距/字体后这些数字会变，必须重量（跑法见 issue #78：真浏览器
 * getBoundingClientRect，jsdom 无布局、量不到）。
 */
export function estimateNodeCardHeight(pkg: SchedulePackageView, highlighted = false): number {
  let px = CARD_CHROME_PX;
  px += TITLE_LINE_PX; // id 行（white-space:nowrap）
  px += textLinesOf(pkg.name, 12) * TITLE_LINE_PX + 2;
  // 状态行按实际文案参与换行估算（#78 真浏览器实测）：旧实现固定算一行，但派生
  // 状态 token 实测换两行——`stale_or_unverified（派生）` 单行实测宽 169.41px，
  // 而色点后可用宽只有 CARD_TEXT_WIDTH−STATUS_DOT_PX = 182−15 = 167px，实测
  // 状态行高 33px（2×16.5）而非 16.5px；PKG-120 因此实测卡底 794.2px 压过下一
  // 行顶 794px（jsdom 无布局、量不到，单测层无解）。色点是 inline-block，文案
  // 可用宽必须先扣掉它再算行数。
  px += textLinesOf(statusLabelOf(pkg.effective_status), 11, CARD_TEXT_WIDTH - STATUS_DOT_PX) * BODY_LINE_PX + 3;
  px += textLinesOf(checkLineTextOf(pkg), 11) * BODY_LINE_PX;
  const openBlockers = openBlockersOf(pkg);
  if (openBlockers.length) px += 2; // 阻塞容器 margin-top
  for (const blocker of openBlockers.slice(0, MAX_VISIBLE_BLOCKERS)) {
    px += Math.min(BLOCKER_MAX_LINES, textLinesOf(blockerLineTextOf(blocker), 11)) * BODY_LINE_PX;
  }
  if (openBlockers.length > MAX_VISIBLE_BLOCKERS) {
    // 折叠提示按实际文案算换行行数（10px 字号、行高 1.5 = SMALL_LINE_PX）
    const hiddenCount = openBlockers.length - MAX_VISIBLE_BLOCKERS;
    px += textLinesOf(moreBlockersLineTextOf(hiddenCount), 10) * SMALL_LINE_PX + 2;
  }
  if (highlighted) px += SMALL_LINE_PX + 2;
  return px;
}

// ─── 几何能力（按 links 判定，不拉 /api/project）──────────────────────────────

type GeometryCapability = 'scene' | 'point' | 'project';

/** 点位级选择器（已可高亮：点位默认合批渲染，HouseScene.highlightPoints 逐实例着色，未合批单件 emissive 兜底）。 */
const POINT_SELECTOR_KEYS = new Set(['ids', 'layers', 'trade', 'plan_ids']);

/** 场景级选择器（resolvePackageScope 能展开成房间/对象 id 集合的键）。 */
const SCENE_SELECTOR_KEYS = new Set(['room_ids', 'types', 'collections']);

const CAPABILITY_BADGE: Record<GeometryCapability, {label: string; title: string}> = {
  project: {
    label: '全项目范围',
    title: '该包没有具体 3D 范围（无 link / select all / mapping_status: project_scope / 未建模）：不占 3D 反查，点节点不会调 3D 高亮',
  },
  point: {
    label: '点位级（可高亮）',
    title: '该包只有 ids/layers/trade/plan_ids 类点位选择器（含 electrical/plumbing 的 select.all）：点位为合批渲染，已支持逐实例高亮（BatchedMesh.setColorAt；未合批的单件点位走 emissive 兜底）',
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

/**
 * 2026-11-04 issue #65：`select.all` 按来源分流，与 shared/package-scope 的
 * resolvePackageScope / isPointSourceAllSelector **同一口径**（徽标说「全项目范围」而 3D
 * 又能高亮，或反过来，都来自两处各写一套判断）。electrical/plumbing 的 all = 该分类全部
 * 点位（PKG-040 水电改造的本意），算点位级、可高亮；其他来源的 all = 全项目范围。
 * `all` 永远不展开成具体房间/对象，故场景级恒 false。
 */
function isSceneSelector(scope: {source: string; select: Record<string, unknown>}): boolean {
  const select = scope.select ?? {};
  if (select.all === true) return false;
  return Object.keys(select).some((key) => SCENE_SELECTOR_KEYS.has(key) && select[key] !== undefined);
}

function isPointSelector(scope: {source: string; select: Record<string, unknown>}): boolean {
  const select = scope.select ?? {};
  if (select.all === true) return isPointSourceAllSelector(scope);
  return isPointOnlySelector(select);
}

function capabilityOf(packageId: string, links: ModelPackageLink[]): GeometryCapability {
  const packageLinks = links.filter((link) => link.budget_ref?.id === packageId);
  // 无 link（或 not_modelled 的无选择器 link）→ 没有具体 3D 范围，同「全项目范围」
  if (packageLinks.length === 0) return 'project';
  // 链接自己声明 project_scope（PKG-142 整屋放行等）→ 全项目范围，不按选择器猜
  if (packageLinks.some((link) => link.mapping_status === 'project_scope')) return 'project';
  const declared = packageLinks.flatMap((link) => link.scope ?? [])
    .filter((scope) => Object.keys(scope.select ?? {}).some((key) => (scope.select as Record<string, unknown>)[key] !== undefined));
  if (declared.length === 0) return 'project';
  // 房间/墙/叠加层区域级 → 有 3D 范围；否则看点位级（含点位来源的 all）；都不占 → 全项目范围
  if (declared.some(isSceneSelector)) return 'scene';
  return declared.some(isPointSelector) ? 'point' : 'project';
}

// ─── 画布几何（layer→列、row→行；节点宽 200、最小高 84）───────────────────

const NODE_WIDTH = 200;
/** 卡片最小高度（自适应高度的下限；实际高度由内容决定，见 estimateNodeCardHeight）。 */
const NODE_HEIGHT = 84;
const COLUMN_PITCH = 240;
/** 行间距（行高不再固定——#68：固定 ROW_PITCH 配 max-height 会把阻塞文案静默截断）。 */
const ROW_GAP = 8;
const CANVAS_PAD = 16;
/**
 * 窄容器阈值（px，容器实测可用宽）：≤ 它 → 单列堆叠（2026-11-04 issue #83）。
 * 与 style.css 的移动端几何断点（`@media (max-width: 700px)` / `body.mobile-chrome`）
 * 取同一道 700；>700px 一律走上面的常量布局，一行不变。（容器宽 = 视口宽 −
 * `#approval-page-panels` 内边距 12px×2，故视口 ≤724px 即进单列堆叠。）
 *
 * 为什么必须退化：常量布局的画布宽 = 32 + (层数−1)×240 + 200，12 层依赖图就是
 * 2872px；390px 手机上 `#approval-page-panels` 只剩约 334px 给画布，第 2 列起
 * 被裁。画布自身 `overflow:auto` 技术上确实能横向滚（真浏览器实测：viewport
 * 390×667 下 canvas clientWidth 332 / scrollWidth 2888，scrollLeft 拉到底后最右
 * 节点可入屏），但等于让业主在 334px 的嵌套滚动盒里平移 8 屏多去找下一列，触摸
 * 端没有任何可见提示（issue #83 报「无法滚过去」）。故窄容器按容器实测宽重算：
 * **卡宽保持 200 不变**（estimateNodeCardHeight 的换行/行高口径全部建立在 200px
 * 卡宽上，动它等于推翻 #78 的实测边界），只把 layer→列退化成按 (layer, row) 的
 * 纵向序列，画布宽吃容器宽，节点全部落在容器内、不再需要横向平移。
 */
const NARROW_CANVAS_BREAKPOINT = 700;
/** 单列堆叠时卡片左边的导轨留白（px）：连线走这条竖轨，不穿过中间卡片。 */
const SINGLE_COLUMN_GUTTER = 24;
/** 单列堆叠连线拐角半径（px）：目标就在源正下方时按间距自动收窄，拐弯不越过卡间隙。 */
const EDGE_CORNER_PX = 10;
/** 画布边框宽（px；窄容器算画布宽时要扣掉，内层才正好吃满内容盒、不触发横向滚动条）。 */
const CANVAS_BORDER_PX = 1;

/** 单个节点的画布坐标（宽容器 = layer→列 × row→行；窄容器 = 单列堆叠）。 */
interface NodeBox {
  x: number;
  top: number;
  /** 卡片估算高度（边端点挂它算，行高变量后不能写死 NODE_HEIGHT/2）。 */
  height: number;
}

/** 卡片内可用文本宽度（px；估算行数用）。issue #78 实测：卡片 width:200、
 * padding 8px×2、border 1px×2、box-sizing:border-box → getComputedStyle 内容宽
 * **182px**。旧值 184 = 只减了 padding 没减 border，每行少算 2px，边界宽度的
 * 文本会少估一行（少估 = 卡片压住下一行，铁律不允许的方向）。 */
const CARD_TEXT_WIDTH = NODE_WIDTH - 18;
/** 行高估算（px）：12px×1.35≈16.2、11px×1.5≈16.5、10px×1.5=15，一律向上取整防低估。 */
const TITLE_LINE_PX = 17;
const BODY_LINE_PX = 17;
const SMALL_LINE_PX = 15;
/** padding 12 + border 2 + 各分段 margin 余量。 */
const CARD_CHROME_PX = 20;
/** 状态行色点占宽（renderStatusDot：width 9 + border 1px×2 + margin-right 4）。 */
const STATUS_DOT_PX = 15;
/** 卡片里最多展开几条阻塞原因，其余折成「还有 N 条」（#68）。 */
const MAX_VISIBLE_BLOCKERS = 2;
/** 单条阻塞原因在卡片里最多占几行（多了 ellipsis 截断，全文进 title 悬浮提示）。 */
const BLOCKER_MAX_LINES = 2;

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
  /** 当前渲染是否窄容器单列堆叠（renderEdge 据此选连线走线）。 */
  private narrowLayout = false;
  /** 上一次渲染用的布局键（ResizeObserver 只在它变化时重渲，见 layoutKeyOf）。 */
  private layoutKey = 'wide';
  private resizeObserver: ResizeObserver | null = null;
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
    // 自适应行高（#68）：每行高度 = 该行全部节点卡片估算高度的最大值（下限
    // NODE_HEIGHT）。旧实现用固定 ROW_PITCH=104 配 max-height:100px + overflow
    // :hidden，阻塞原因一多整段静默消失；改成「卡片 auto 高度 + 行按内容撑高」
    // 后既不截断也不重叠（行距恒 ≥ 本行最高卡片）。高亮态多一行「← 3D 选中」，
    // 估算时也要算进去，否则反查高亮瞬间相邻行会被压住。
    const cardHeights = new Map(
      snapshot.packages.map((pkg) => [pkg.id, estimateNodeCardHeight(pkg, this.highlighted.has(pkg.id))]),
    );
    // 画布宽吃容器宽（#83）：容器实测宽 ≤ NARROW_CANVAS_BREAKPOINT → 单列堆叠，
    // 否则原常量布局一行不变。clientWidth 恒 0 的环境（jsdom 不做布局）按宽容器。
    const narrow = this.isNarrowContainer();
    this.narrowLayout = narrow;
    const boxes = new Map<string, NodeBox>();
    let canvasWidth: number;
    let canvasHeight: number;
    if (narrow) {
      // 单列堆叠：按 (layer, row) 顺序纵向排列（依赖顺序 = 阅读顺序），卡片左边
      // 让出 SINGLE_COLUMN_GUTTER 给连线导轨。画布宽 = 容器内容盒实测宽（扣掉
      // 画布自身边框），但不低于「内边距×2 + 导轨 + 卡宽」——比这更窄的容器只能
      // 靠画布自身的 overflow:auto 横滚兜底（仍可达，见测试）。
      canvasWidth = Math.max(
        this.availableWidth() - CANVAS_BORDER_PX * 2,
        CANVAS_PAD * 2 + SINGLE_COLUMN_GUTTER + NODE_WIDTH,
      );
      let cursor = CANVAS_PAD;
      for (const node of mainNodes.slice().sort((left, right) => left.layer - right.layer || left.row - right.row)) {
        const height = Math.max(NODE_HEIGHT, cardHeights.get(node.id) ?? NODE_HEIGHT);
        boxes.set(node.id, {x: CANVAS_PAD + SINGLE_COLUMN_GUTTER, top: cursor, height});
        cursor += height + ROW_GAP;
      }
      canvasHeight = cursor - ROW_GAP + CANVAS_PAD;
    } else {
      canvasWidth = CANVAS_PAD * 2 + Math.max(0, layout.layerCount - 1) * COLUMN_PITCH + NODE_WIDTH;
      const rowTops: number[] = [];
      let cursor = CANVAS_PAD;
      for (let row = 0; row < maxRows; row += 1) {
        rowTops.push(cursor);
        const rowHeight = Math.max(
          NODE_HEIGHT,
          ...mainNodes.filter((node) => node.row === row).map((node) => cardHeights.get(node.id) ?? NODE_HEIGHT),
        );
        cursor += rowHeight + ROW_GAP;
      }
      canvasHeight = cursor - ROW_GAP + CANVAS_PAD;
      for (const node of mainNodes) {
        boxes.set(node.id, {
          x: CANVAS_PAD + node.layer * COLUMN_PITCH,
          top: rowTops[node.row] ?? CANVAS_PAD,
          height: cardHeights.get(node.id) ?? NODE_HEIGHT,
        });
      }
    }
    this.layoutKey = narrow ? `narrow:${canvasWidth}` : 'wide';

    const head = `<div style="margin-bottom:8px;color:#9aa4b2;font-size:11px;line-height:1.7;">
      共 ${snapshot.packages.length} 个工作包（${mainNodes.length} 个工序包 + ${sideNodes.length} 个侧车道）｜依赖分层 ${layout.layerCount} 层｜最多一层 ${Math.max(0, ...layout.layerSizes)} 个节点。
      数据只读自 <code>/api/schedule/state</code> 与 <code>/api/model-package-links</code>；点节点只写选中态与 3D 高亮，改配置一律走 PR。
    </div>${this.renderLegend()}`;

    if (mainNodes.length === 0) {
      return `${head}<div style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">
        当前快照没有工序包（schedule/phase-1/control.yaml 的 work_packages 为空），流程图无内容可画。
      </div>${sideNodes.length ? this.renderSideLane(sideNodes, packageById) : ''}${this.renderReverseHint(layout)}${this.renderSelectionBar(snapshot)}`;
    }

    const edges = layout.edges.map((edge) => this.renderEdge(edge, boxes)).join('');
    const nodes = mainNodes
      .map((node) => this.renderNodeCard(packageById.get(node.id), node, boxes.get(node.id) ?? null))
      .join('');

    return `${head}
      <div id="flow-chart-canvas"${narrow ? ' data-flow-mobile="true"' : ''} style="position:relative;overflow:auto;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:rgba(255,255,255,.02);">
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

  private renderEdge(edge: {from: string; to: string}, boxes: Map<string, NodeBox>): string {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    // 侧车道节点不进 boxes（不参与依赖分层），这里天然被过滤掉
    if (!from || !to) return '';
    let d: string;
    if (this.narrowLayout) {
      // 单列堆叠的连线：源卡片底中 → 左导轨 → 目标卡片顶中。导轨 x 严格小于卡片
      // 左缘，竖段不穿过中间卡片；拐角半径按源/目标间距收窄，紧邻时整条线落在
      // 8px 卡间隙里。多条边共用同一条导轨会重合（箭头方向仍表明指向），完整
      // 依赖关系见下方选中条与详情面板。
      const railX = CANVAS_PAD + 8;
      const x1 = from.x + NODE_WIDTH / 2;
      const x2 = to.x + NODE_WIDTH / 2;
      const y1 = from.top + from.height;
      const y2 = to.top;
      const r = Math.min(EDGE_CORNER_PX, Math.max(0, (y2 - y1) / 2));
      d = `M ${x1} ${y1} C ${x1} ${y1 + r}, ${railX} ${y1}, ${railX} ${y1 + r} L ${railX} ${y2 - r} C ${railX} ${y2}, ${x2} ${y2 - r}, ${x2} ${y2}`;
    } else {
      // 边端点挂在节点自身估算高度的中点（行高变量后不能再写死 NODE_HEIGHT/2）
      const y1 = from.top + from.height / 2;
      const y2 = to.top + to.height / 2;
      const x1 = from.x + NODE_WIDTH;
      const x2 = to.x;
      const dx = Math.max(24, (x2 - x1) / 2);
      d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    }
    return `<path class="flow-edge" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}" d="${d}" fill="none" stroke="${NEUTRAL_COLOR}" stroke-width="1.5" marker-end="url(#${this.uid}-arrow)"></path>`;
  }

  private renderNodeCard(pkg: SchedulePackageView | undefined, node: FlowLayoutNode | null, box: NodeBox | null): string {
    if (!pkg) return '';
    const capability = capabilityOf(pkg.id, this.links);
    const badge = CAPABILITY_BADGE[capability];
    const active = this.selection.get().packageId === pkg.id;
    const highlighted = this.highlighted.has(pkg.id);
    // 未通过与未验收分列口径见 checkLineTextOf（P2-12）。
    const openBlockers = openBlockersOf(pkg);
    const borderColor = active ? ACTIVE_BORDER : highlighted ? HIGHLIGHT_BORDER : 'rgba(255,255,255,.16)';
    const emphasis = active
      ? `box-shadow:0 0 0 2px ${ACTIVE_BORDER};`
      : highlighted ? `box-shadow:0 0 0 2px ${HIGHLIGHT_BORDER};` : '';
    const geometry = box
      ? `position:absolute;left:${box.x}px;top:${box.top}px;`
      : 'position:relative;flex:0 0 auto;';
    const title = [
      `${pkg.id} ${pkg.name}`,
      `状态：${statusLabelOf(pkg.effective_status)}`,
      checkLineTextOf(pkg),
      ...openBlockers.map((blocker) => `阻塞：${blocker.item ?? blocker.id}（解除：${blocker.clears_when ?? '—'}）`),
      badge.title,
    ].join('\n');

    // 阻塞原因折叠（#68）：最多展开 MAX_VISIBLE_BLOCKERS 条，每条最多
    // BLOCKER_MAX_LINES 行（超出 ellipsis 截断，全文在 title 悬浮提示里），
    // 其余折成「还有 N 条」——点节点即选中，完整列表进下方选中条与详情页。
    // 实测依据：真实快照阻塞最多的 PKG-000 有 5 条未关闭阻塞（PKG-030/040 各 4
    // 条），旧固定 100px 卡片装不下，整段被 overflow:hidden 静默吞掉。
    // 折叠行文案与高度估算共用 moreBlockersLineTextOf：该长句在卡内会换行，
    // estimateNodeCardHeight 必须按同一文案算行数，否则多阻塞卡片被算低、压住
    // 下一行（codex major）。
    const shownBlockers = openBlockers.slice(0, MAX_VISIBLE_BLOCKERS);
    const hiddenBlockerCount = openBlockers.length - shownBlockers.length;
    const blockers = shownBlockers.length
      ? `<div style="margin-top:2px;color:#f4dfa8;font-size:11px;line-height:1.5;">${shownBlockers
          .map((blocker) => `<div style="display:-webkit-box;-webkit-line-clamp:${BLOCKER_MAX_LINES};-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;">阻塞：${escapeHtml(blocker.item ?? blocker.id)}<span style="color:#9aa4b2;">（解除：${escapeHtml(blocker.clears_when ?? '—')}）</span></div>`)
          .join('')}</div>`
      : '';
    const moreBlockers = hiddenBlockerCount > 0
      ? `<div style="margin-top:2px;color:#f4dfa8;font-size:10px;line-height:1.5;">${moreBlockersLineTextOf(hiddenBlockerCount)}</div>`
      : '';

    return `<div class="flow-node" data-pkg-id="${escapeHtml(pkg.id)}" data-layer="${node ? node.layer : -1}" data-row="${node ? node.row : 0}" data-side-lane="${node ? node.sideLane : true}" data-active="${active}" data-highlight="${highlighted}" data-capability="${capability}" title="${escapeHtml(title)}"
      style="${geometry}width:${NODE_WIDTH}px;min-height:${NODE_HEIGHT}px;box-sizing:border-box;padding:6px 8px;border-radius:8px;border:1px solid ${borderColor};background:#232342;color:#e0e0e0;font-size:12px;cursor:pointer;overflow-wrap:break-word;z-index:1;${emphasis}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <strong style="font-size:12px;white-space:nowrap;">${escapeHtml(pkg.id)}</strong>
        <span style="padding:1px 5px;border-radius:4px;background:rgba(255,255,255,.08);color:#aeb8c8;font-size:10px;white-space:nowrap;" title="${escapeHtml(badge.title)}">${escapeHtml(badge.label)}</span>
      </div>
      <div style="margin-top:2px;font-size:12px;line-height:1.35;" title="${escapeHtml(pkg.name)}">${escapeHtml(pkg.name)}</div>
      <div style="margin-top:3px;font-size:11px;line-height:1.5;">${this.renderStatusDot(pkg.effective_status)}${escapeHtml(statusLabelOf(pkg.effective_status))}</div>
      <div style="font-size:11px;color:#9aa4b2;line-height:1.5;">${escapeHtml(checkLineTextOf(pkg))}</div>
      ${blockers}
      ${moreBlockers}
      ${highlighted ? `<div style="margin-top:2px;color:${HIGHLIGHT_BORDER};font-size:10px;">← 3D 选中</div>` : ''}
    </div>`;
  }

  /** PKG-900 等侧车道：图表下方单独一条横带，不占工序、不参与依赖分层。 */
  private renderSideLane(sideNodes: FlowLayoutNode[], packageById: Map<string, SchedulePackageView>): string {
    const cards = sideNodes.map((node) => this.renderNodeCard(packageById.get(node.id), null, null)).join('');
    return `<div id="flow-side-lane" style="margin-top:10px;padding:8px 10px;border:1px dashed rgba(155,139,208,.45);border-radius:6px;background:rgba(155,139,208,.08);">
      <div style="margin-bottom:6px;color:#c3b8ea;font-size:11px;">预备金·侧车道（不占工序、不参与依赖分层）</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;">${cards}</div>
    </div>`;
  }

  /** 3D 反查命中多个包时，选中条上方给明确提示（不许静默只标首个）。 */
  private renderReverseHint(layout: FlowLayout): string {
    const marked = layout.nodes.filter((node) => this.highlighted.has(node.id));
    if (marked.length <= 1) return '';
    return `<div id="flow-reverse-hint" style="margin-top:8px;padding:6px 8px;border:1px solid rgba(233,196,106,.45);border-radius:6px;background:rgba(233,196,106,.1);color:#f4dfa8;font-size:12px;">
      该 3D 对象同属 ${marked.length} 个包，已全部标出（${escapeHtml(marked.map((node) => node.id).join('、'))}）。
      请点选其中一个节点查看——未预设首个包，选中条即显示该包摘要（#67）。
    </div>`;
  }

  private renderSelectionBar(snapshot: ScheduleSnapshot): string {
    const packageId = this.selection.get().packageId;
    if (!packageId) {
      // 多包反查后的空选中态要给明确指引（#67）：告诉业主点哪个、点完看什么，
      // 不能只留一句通用的「还没有选中」让业主以为界面坏了。
      const reverseHint = this.highlighted.size > 1
        ? `<div style="margin-top:4px;color:#f4dfa8;">3D 反查命中 ${this.highlighted.size} 个包（节点已全部标出）：请点选其中一个节点查看详情——未预设首个包。</div>`
        : '';
      return `<div id="flow-selection-bar" style="margin-top:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(255,255,255,.04);color:#9aa4b2;font-size:12px;">
        还没有选中工作包——点流程图里的节点，或打开带 <code>#pkg=PKG-xxx</code> 的链接。${reverseHint}
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
    // 同节点口径：未通过与未验收分列（P2-12，见 checkLineTextOf）。下一个待办优先指
    // failed（更紧急），没有 failed 才指未验收的 pending；not_applicable 不算待办。
    const failedChecks = pkg.checks.filter((check) => check.audit_status === 'failed');
    const pendingChecks = pkg.checks.filter((check) => !check.audit_status || check.audit_status === 'pending');
    const nextCheck = failedChecks[0] ?? pendingChecks[0];
    // 选中条给完整列表（不折叠）——卡片里折掉的「还有 N 条」在这里全量展开。
    const openBlockers = openBlockersOf(pkg);

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
      <div style="color:#9aa4b2;">${escapeHtml(pkg.gate_label)} ${escapeHtml(pkg.payment_gate)}：${escapeHtml(labelOf(GATE_LABEL, pkg.gate_status))}｜未通过检查 ${failedChecks.length}/${total}｜未验收 ${pendingChecks.length}｜依赖：${escapeHtml(pkg.dependencies.join('、') || '无')}</div>
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
        // 2026-11-03 路由级：节点点击只选中+重渲。旧版（右坞同屏）会顺带触发
        // onHighlight 让旁边 3D 亮——审批页是全屏的，onHighlight 现=跳 3D，
        // 节点点击跳走会把用户踢出审批页、选中还被清（codex 审查实证）。
        // 跳 3D 只走显式「在 3D 中高亮」按钮。
        this.selection.set({packageId, checkId: null});
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

  // ─── 容器宽度（#83：画布宽吃容器宽）────────────────────────────────────

  /**
   * 画布可用宽度（px）= 面板内容区实测宽（`#flow-chart-body` 的 clientWidth：
   * 它是骨架里唯一跨重渲染存活的容器，且块级宽度只由父级决定、不被画布内容撑大）。
   * jsdom 不做布局（clientWidth 恒 0）→ 0 = 未实测，按宽容器走常量布局，
   * 既有测试与桌面行为都不变。
   */
  private availableWidth(): number {
    const body = this.el?.querySelector('#flow-chart-body') as HTMLElement | null;
    return body?.clientWidth ?? 0;
  }

  /** 窄容器（单列堆叠）判定：未实测（clientWidth 0）不算窄。 */
  private isNarrowContainer(): boolean {
    const available = this.availableWidth();
    return available > 0 && available <= NARROW_CANVAS_BREAKPOINT;
  }

  /**
   * 布局键：宽容器恒 `'wide'`（常量布局与容器宽无关）；窄容器 = 画布宽（吃容器
   * 宽，宽度变了要重算）。ResizeObserver 只在这个键变化时重渲——移动端地址栏
   * 收展只改高度、不改键，不会把重渲打进滚动流程。
   */
  private layoutKeyOf(): string {
    if (!this.isNarrowContainer()) return 'wide';
    return `narrow:${Math.max(
      this.availableWidth() - CANVAS_BORDER_PX * 2,
      CANVAS_PAD * 2 + SINGLE_COLUMN_GUTTER + NODE_WIDTH,
    )}`;
  }

  /** 容器尺寸变化（旋转 / 分屏 / 窗口缩放）：布局键变了才重算几何并重渲。 */
  private onContainerResize(): void {
    if (this.layoutKeyOf() === this.layoutKey) return;
    if (this.visible && this.payload) this.render();
  }

  // ─── 骨架 ────────────────────────────────────────────────────────────────

  private build(): void {
    const el = document.createElement('div');
    el.id = 'flow-chart-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none;
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
    // 2026-11-03 路由级独立页：挂到审批页容器（不再挤预演工作台右坞——那正是
    // 「对象信息点开没东西」的挤压源）。测试只提供挂载点，见各测试 installDom。
    const stack = document.getElementById('approval-page-panels');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#flow-chart-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#flow-chart-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);
    // 容器宽度变化时按需重算布局（#83）：手机旋转 / 分屏 / 窗口缩放后画布要跟着
    // 容器宽走。去重见 layoutKeyOf（只在布局键变化时重渲，不是每个像素都重画）。
    const body = el.querySelector('#flow-chart-body') as HTMLElement | null;
    if (body && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onContainerResize());
      this.resizeObserver.observe(body);
    }
    this.el = el;
  }
}
