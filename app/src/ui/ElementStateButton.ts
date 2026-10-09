// 构件状态高亮开关（DEC-2026-10-09-E01）。
// 与 CeilingZoneButton / WallTileButton / PaintButton 完全平级且互不引用：业主要求
// 「一键看清每个构件确认了吗」是独立开关，不跟吊顶分区/机电总览/贴砖检视态共用渲染机制。
// 比吊顶多一个 'unavailable'：服务端 /api/element-state 拿不到数据时按钮显示不可用（不弹错误刷屏）。
export type ElementStateButtonState = 'loading' | 'ready' | 'unavailable';

export class ElementStateButton {
  private el: HTMLButtonElement;
  private getState: () => ElementStateButtonState;
  private getActive: () => boolean;
  private onToggle: () => void;

  constructor(opts: {
    onToggle: () => void;
    getState: () => ElementStateButtonState;
    getActive: () => boolean;
  }) {
    this.onToggle = opts.onToggle;
    this.getState = opts.getState;
    this.getActive = opts.getActive;
    const el = document.getElementById('element-state-btn') as HTMLButtonElement | null;
    if (!el) {
      throw new Error('ElementStateButton: #element-state-btn element not found in DOM');
    }
    this.el = el;
    this.el.addEventListener('click', () => this.onToggle());
    this.sync();
  }

  sync(): void {
    const state = this.getState();
    const active = state === 'ready' && this.getActive();
    this.el.disabled = state !== 'ready';
    this.el.textContent = state === 'loading'
      ? '工程状态：加载中'
      : state === 'unavailable'
        ? '工程状态：不可用'
        : active
          ? '工程状态 · 显示中'
          : '工程状态';
    this.el.classList.toggle('active', active);
  }
}
