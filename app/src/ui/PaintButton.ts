// 涂漆检视态开关（墙顶面涂装 PKG-080）。
// 与 HvacCoordinationButton / MepCoordinationButton / ElectricalTopologyButton / WallTileButton
// 完全平级且互不引用：每个检视态都是独立开关、独立渲染机制、独立层标签。
export type PaintButtonState = 'loading' | 'ready';

export class PaintButton {
  private el: HTMLButtonElement;
  private getState: () => PaintButtonState;
  private getActive: () => boolean;
  private onToggle: () => void;

  constructor(opts: {
    onToggle: () => void;
    getState: () => PaintButtonState;
    getActive: () => boolean;
  }) {
    this.onToggle = opts.onToggle;
    this.getState = opts.getState;
    this.getActive = opts.getActive;
    const el = document.getElementById('paint-btn') as HTMLButtonElement | null;
    if (!el) throw new Error('PaintButton: #paint-btn element not found in DOM');
    this.el = el;
    this.el.addEventListener('click', () => this.onToggle());
    this.sync();
  }

  sync(): void {
    const state = this.getState();
    const active = state === 'ready' && this.getActive();
    this.el.disabled = state !== 'ready';
    this.el.textContent = state === 'loading'
      ? '涂漆区：加载中'
      : active ? '涂漆区 · 显示中' : '涂漆区';
    this.el.classList.toggle('active', active);
  }
}
