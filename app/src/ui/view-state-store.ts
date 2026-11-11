/**
 * 视图状态持久化（localStorage，版本化 key）。
 *
 * 控制面重构：画布优先 + 刷新恢复。只持久化“用户上次怎么看的”，
 * 不持久化瞬态（哪个浮层开着——那些默认就是收起的）。
 * 检视层组合的存档/恢复沿用 LayersPanel 的 layers-last-combo（同目录），
 * 这里只管理工作台开合与活跃页。
 */

const STORAGE_KEY = 'bontop-view-state/v1';

/** 审批视图的页面（自装交互审批第一步，2026-11-02）：null = 审批视图未打开。flow = 依赖流程图（2026-11-02 流程图任务）。gantt = 动态甘特（2026-11-11 issue #202 S2，设计 §7）。roles / calendar = 角色工作台 / 协调日历（2026-11-11 issue #202 S3，设计 §7）。 */
export type ApprovalViewPage = 'next_action' | 'schedule' | 'detail' | 'flow' | 'gantt' | 'roles' | 'calendar';

export interface PersistedViewState {
  workbenchOpen: boolean;
  workbenchPage: 'object' | 'material' | 'lighting' | null;
  /** 上次停留在哪个审批页；首次访问（无存档）默认 next_action（设计稿决策）。 */
  approvalView: ApprovalViewPage | null;
}

export function readViewState(): Partial<PersistedViewState> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const obj = parsed as Record<string, unknown>;
    const state: Partial<PersistedViewState> = {};
    if (typeof obj.workbenchOpen === 'boolean') state.workbenchOpen = obj.workbenchOpen;
    if (obj.workbenchPage === 'object' || obj.workbenchPage === 'material' || obj.workbenchPage === 'lighting') {
      state.workbenchPage = obj.workbenchPage;
    }
    if (obj.approvalView === 'next_action' || obj.approvalView === 'schedule' || obj.approvalView === 'detail' || obj.approvalView === 'flow' || obj.approvalView === 'gantt' || obj.approvalView === 'roles' || obj.approvalView === 'calendar') {
      state.approvalView = obj.approvalView;
    }
    return state;
  } catch {
    return {};
  }
}

export function writeViewState(patch: Partial<PersistedViewState>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const current = readViewState();
    const merged: PersistedViewState = {
      workbenchOpen: patch.workbenchOpen ?? current.workbenchOpen ?? false,
      workbenchPage: patch.workbenchPage !== undefined ? patch.workbenchPage : current.workbenchPage ?? null,
      approvalView: patch.approvalView !== undefined ? patch.approvalView : current.approvalView ?? null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // 持久化失败不影响功能
  }
}
