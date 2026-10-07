// 吊顶分区高亮开关（DEC-2026-10-08-C01）。
// 与 HvacCoordinationButton / MepCoordinationButton / WallTileButton 完全平级且互不引用：
// 业主要求「一键高亮吊顶分区」是独立开关，不跟机电总览/贴砖检视态共用渲染机制。
export type CeilingZoneButtonState = 'loading' | 'ready';

export class CeilingZoneButton {
  private el: HTMLButtonElement;
  private getState: () => CeilingZoneButtonState;
  private getActive: () => boolean;
  private onToggle: () => void;

  constructor(opts: {
    onToggle: () => void;
    getState: () => CeilingZoneButtonState;
    getActive: () => boolean;
  }) {
    this.onToggle = opts.onToggle;
    this.getState = opts.getState;
    this.getActive = opts.getActive;
    const el = document.getElementById('ceiling-zone-btn') as HTMLButtonElement | null;
    if (!el) {
      throw new Error('CeilingZoneButton: #ceiling-zone-btn element not found in DOM');
    }
    this.el = el;
    this.el.addEventListener('click', () => this.onToggle());
    this.sync();
  }

  sync(): void {
    const state = this.getState();
    const active = state === 'ready' && this.getActive();
    this.el.disabled = state !== 'ready';
    this.el.textContent = state === 'loading' ? '吊顶分区：加载中' : active ? '吊顶分区 · 显示中' : '吊顶分区';
    this.el.classList.toggle('active', active);
  }
}
