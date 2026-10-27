/**
 * 视图状态持久化（localStorage，版本化 key）。
 *
 * 控制面重构：画布优先 + 刷新恢复。只持久化“用户上次怎么看的”，
 * 不持久化瞬态（哪个浮层开着——那些默认就是收起的）。
 * 检视层组合的存档/恢复沿用 LayersPanel 的 layers-last-combo（同目录），
 * 这里只管理工作台开合与活跃页。
 */

const STORAGE_KEY = 'bontop-view-state/v1';

export interface PersistedViewState {
  workbenchOpen: boolean;
  workbenchPage: 'object' | 'material' | 'lighting' | null;
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
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // 持久化失败不影响功能
  }
}
