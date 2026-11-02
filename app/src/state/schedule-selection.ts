/**
 * 审批视图的共享选中态（自装交互审批第一步，2026-11-02）。
 *
 * 设计稿 §3：进度图 / 门禁图 / next-action / 详情四个面板共用同一个选中 ID；
 * 选中状态可进链接地址（#pkg=PKG-040&check=SCH-040-01），方便直接发某个包或
 * 某个检查的链接。仓库现状没有全局 selection store（3D 选中走 HouseScene solo、
 * 方案选中走 SchemePanel 私有 map、URL 状态完全没用），这里是净新增能力，
 * 不替换既有通道——3D 反查（点对象→包）由 App 接线时写进这个 store。
 *
 * 只存「业主正在看哪个包/哪项检查」，不存任何事实；事实唯一来源是
 * /api/schedule/state（config 投影）。localStorage 那套视图持久化沿用
 * view-state-store.ts，本模块只管选中与地址栏。
 */

export interface ScheduleSelection {
  packageId: string | null;
  checkId: string | null;
}

type SelectionListener = (selection: ScheduleSelection) => void;

/** 解析地址栏 hash（`#pkg=PKG-040&check=SCH-040-01`）。容错：坏 hash 不抛。 */
export function readSelectionFromHash(hash: string): ScheduleSelection {
  try {
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    return {
      packageId: params.get('pkg'),
      checkId: params.get('check'),
    };
  } catch {
    return {packageId: null, checkId: null};
  }
}

/** 把选中写进地址栏（replaceState，不产生历史条目、不触发跳转）。 */
export function writeSelectionToHash(selection: ScheduleSelection): void {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  const params = new URLSearchParams();
  if (selection.packageId) params.set('pkg', selection.packageId);
  if (selection.checkId) params.set('check', selection.checkId);
  const query = params.toString();
  const next = query ? `#${query}` : '#';
  if (location.hash !== next) history.replaceState(null, '', next);
}

export class ScheduleSelectionStore {
  private readonly listeners = new Set<SelectionListener>();
  private current: ScheduleSelection = {packageId: null, checkId: null};

  get(): ScheduleSelection {
    return this.current;
  }

  /** 局部更新并通知订阅者；地址栏同步写（同一处，不漏面板）。 */
  set(patch: Partial<ScheduleSelection>): void {
    const next: ScheduleSelection = {
      packageId: patch.packageId !== undefined ? patch.packageId : this.current.packageId,
      checkId: patch.checkId !== undefined ? patch.checkId : this.current.checkId,
    };
    if (next.packageId === this.current.packageId && next.checkId === this.current.checkId) return;
    this.current = next;
    writeSelectionToHash(next);
    for (const listener of this.listeners) listener(next);
  }

  subscribe(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 启动时从地址栏恢复（直接打开某包的链接时用）。 */
  restoreFromHash(): void {
    const fromHash = typeof location === 'undefined' ? {packageId: null, checkId: null} : readSelectionFromHash(location.hash);
    if (!fromHash.packageId && !fromHash.checkId) return;
    this.current = fromHash;
    for (const listener of this.listeners) listener(fromHash);
  }
}
