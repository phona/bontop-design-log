// 贴砖检视态开关（DEC-2026-10-07-R08）。
// 与 HvacCoordinationButton / MepCoordinationButton / ElectricalTopologyButton 完全平级且互不引用：
// 业主明确要求贴砖展示不跟 HVAC 共用一套开关，也不共用渲染机制。
export type WallTileButtonState = 'loading' | 'ready';

export class WallTileButton {
  private el: HTMLButtonElement;
  private getState: () => WallTileButtonState;
  private getActive: () => boolean;
  private onToggle: () => void;

  constructor(opts: {
    onToggle: () => void;
    getState: () => WallTileButtonState;
    getActive: () => boolean;
  }) {
    this.onToggle = opts.onToggle;
    this.getState = opts.getState;
    this.getActive = opts.getActive;
    const el = document.getElementById('wall-tile-btn') as HTMLButtonElement | null;
    if (!el) {
      throw new Error('WallTileButton: #wall-tile-btn element not found in DOM');
    }
    this.el = el;
    this.el.addEventListener('click', () => this.onToggle());
    this.sync();
  }

  sync(): void {
    const state = this.getState();
    const active = state === 'ready' && this.getActive();
    this.el.disabled = state !== 'ready';
    this.el.textContent = state === 'loading' ? '贴砖区：加载中' : active ? '贴砖区 · 显示中' : '贴砖区';
    this.el.classList.toggle('active', active);
  }
}
