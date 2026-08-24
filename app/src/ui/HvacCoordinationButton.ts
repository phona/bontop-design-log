export type HvacCoordinationButtonState = 'loading' | 'unimplemented' | 'ready';

export class HvacCoordinationButton {
  private el: HTMLButtonElement;
  private getState: () => HvacCoordinationButtonState;
  private getActive: () => boolean;
  private onToggle: () => void;

  constructor(opts: {
    onToggle: () => void;
    getState: () => HvacCoordinationButtonState;
    getActive: () => boolean;
  }) {
    this.onToggle = opts.onToggle;
    this.getState = opts.getState;
    this.getActive = opts.getActive;
    const el = document.getElementById('hvac-coordination-btn') as HTMLButtonElement | null;
    if (!el) {
      throw new Error('HvacCoordinationButton: #hvac-coordination-btn element not found in DOM');
    }
    this.el = el;
    this.el.addEventListener('click', () => this.onToggle());
    this.sync();
  }

  sync(): void {
    const state = this.getState();
    const active = state === 'ready' && this.getActive();
    this.el.disabled = state !== 'ready';
    this.el.textContent = state === 'loading' ? '加载中' : state === 'unimplemented' ? '未实现' : active ? 'HVAC · 路线' : 'HVAC';
    this.el.classList.toggle('active', active);
  }
}
