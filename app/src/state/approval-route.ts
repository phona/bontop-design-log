/**
 * 审批视图的路由（2026-11-03，独立页面化）。
 *
 * 背景：审批视图原寄生在预演工作台 #right-panel-stack 里，靠
 * previewWorkbench.setOpen(true) 强行拉开工台才能可见（App.ts 旧 :1170），
 * 挤出「对象信息点开没东西」等一串耦合病。本模块把「在不在审批页、在哪个子页、
 * 选中哪个包/检查项」收拢成**一个 hash 路由**，地址栏即状态：
 *
 *   #approval=next_action|schedule|detail|flow|gantt&pkg=PKG-xxx&check=yyy
 *
 * 语义：
 * - 有 approval 参数 → 审批页开着，落在该子页；
 * - 无 approval 但有 pkg → 深链口径，落 detail（2026-11-02 起的可分享链接不变）；
 * - 两者都无 → 3D 页（审批页关着）。
 *
 * 历史条目纪律：进入/离开审批页用 pushState（浏览器返回键 = 退出审批页），
 * 子页切换与选中变化用 replaceState（不污染历史）。replaceState/pushState 都
 * 不触发 hashchange——程序内导航由调用方直接应用 UI，hashchange 监听只服务
 * 返回键/前进键/手改地址栏。
 *
 * 纯函数 + 一个模块级当前路由镜像（供「选中写 hash 时保持子页」用）。
 * 不碰 DOM、不 import 其它模块——单测不需要任何环境。
 */

export type ApprovalSubPage = 'next_action' | 'schedule' | 'detail' | 'flow' | 'gantt';

export interface ApprovalRoute {
  /** null = 3D 页（审批页未开） */
  subPage: ApprovalSubPage | null;
  packageId: string | null;
  checkId: string | null;
}

// gantt = 动态甘特（2026-11-11 issue #202 S2，设计 §7）。roles / calendar 属 S3，
// 实现落地前不在此声明——坏 hash 照既有口径回落 3D 页，不假装子页存在。
const SUB_PAGES: readonly string[] = ['next_action', 'schedule', 'detail', 'flow', 'gantt'];

/** 解析地址栏 hash。容错：坏 hash 不抛，回落 3D 页。 */
export function parseApprovalRoute(hash: string): ApprovalRoute {
  try {
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const packageId = params.get('pkg');
    const checkId = params.get('check');
    const raw = params.get('approval');
    const subPage = raw !== null && SUB_PAGES.includes(raw) ? (raw as ApprovalSubPage) : null;
    // 无 approval 参数但有 pkg：深链（#pkg=PKG-060）落 detail——保持 2026-11-02 行为
    return {subPage: subPage ?? (packageId ? 'detail' : null), packageId, checkId};
  } catch {
    return {subPage: null, packageId: null, checkId: null};
  }
}

/** 序列化回 hash 串（不含空参数）。 */
export function serializeApprovalRoute(route: ApprovalRoute): string {
  const params = new URLSearchParams();
  if (route.subPage) params.set('approval', route.subPage);
  if (route.packageId) params.set('pkg', route.packageId);
  if (route.checkId) params.set('check', route.checkId);
  const query = params.toString();
  return query ? `#${query}` : '#';
}

/**
 * 选中变化的派生规则：**只改 pkg/check，保持当前子页不变**。
 * 子页只能由显式导航（命令/按钮/3D 反查）切换——否则在流程图里点节点会把
 * 人弹到详情页，在 3D 页选中的写入也不会凭空打开审批页。
 */
export function withSelection(route: ApprovalRoute, patch: {packageId?: string | null; checkId?: string | null}): ApprovalRoute {
  return {
    subPage: route.subPage,
    packageId: patch.packageId !== undefined ? patch.packageId : route.packageId,
    checkId: patch.checkId !== undefined ? patch.checkId : route.checkId,
  };
}

// ─── 当前路由镜像（模块级） ────────────────────────────────────────────────

let currentRoute: ApprovalRoute = {subPage: null, packageId: null, checkId: null};
/** 「返回 3D」能否 pop：只有本 UI push 进去的审批页条目能 pop（深链首 entry 不行） */
let exitCanPop = false;

export function getApprovalRoute(): ApprovalRoute {
  return currentRoute;
}

/**
 * 只更新镜像（hash 已是该状态时用，如 hashchange 之后）。
 * 不动 exitCanPop——程序内导航的 push 资格由 navigateApproval 自己管。
 */
export function setApprovalRoute(route: ApprovalRoute): void {
  currentRoute = route;
}

/**
 * 作废「返回 3D」的 pop 资格。**hashchange 时必须调用**：程序内导航
 * （push/replaceState）不触发 hashchange，所以任何 hashchange 都是用户驱动
 * 的（返回键/前进键/手改地址栏）——当前历史条目不再是「我们 push 的、下面
 * 垫着 3D 页」的那张票。不作的后果：手改 hash 到另一个审批态后点「返回 3D」，
 * back() 退到的是手改前那页（可能还是审批页），用户退不出去（codex 审查实证）。
 */
export function invalidateExitPop(): void {
  exitCanPop = false;
}

function canWriteHistory(): boolean {
  return typeof history !== 'undefined' && typeof location !== 'undefined';
}

/**
 * 导航到指定路由并写 hash。mode='push' 产生历史条目（进/出审批页），
 * 'replace' 不产生（子页/选中变化）。镜像随之更新。
 */
export function navigateApproval(route: ApprovalRoute, mode: 'push' | 'replace' = 'replace'): void {
  currentRoute = route;
  // 进审批页的 push 条目才能被「返回 3D」pop 掉；replace 不进历史
  if (mode === 'push') exitCanPop = route.subPage !== null;
  if (!canWriteHistory()) return;
  const next = serializeApprovalRoute(route);
  // jsdom/旧浏览器对裸 # 的 location.hash 一律返回 ''——与序列化结果对齐后再比较
  if (location.hash !== next && !(next === '#' && location.hash === '')) {
    if (mode === 'push') history.pushState(null, '', next);
    else history.replaceState(null, '', next);
  }
}

/**
 * 退出审批页回 3D。优先 history.back()（把「进入」时 push 的条目 pop 掉，
 * 返回键语义自然）；深链直达（首 entry 就是审批页、没得可 pop）时退化为
 * replaceState 到 3D 路由——绝不能 back 出站。
 * @returns true = 已 pop（hashchange 会驱动 UI 应用，调用方不必再应用）；
 *          false = replace 兜底（调用方需自行应用 UI）。
 */
export function exitApproval(): boolean {
  if (exitCanPop && canWriteHistory()) {
    exitCanPop = false;
    history.back(); // hashchange 驱动 UI 应用，这里不直接动镜像
    return true;
  }
  navigateApproval({subPage: null, packageId: null, checkId: null}, 'replace');
  return false;
}

/** 选中写 hash 的入口（schedule-selection 委托）：保持子页，replace。 */
export function writeSelectionRoute(patch: {packageId?: string | null; checkId?: string | null}): void {
  navigateApproval(withSelection(getApprovalRoute(), patch), 'replace');
}
