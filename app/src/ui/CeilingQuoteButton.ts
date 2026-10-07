// 吊顶报价面板开关（DEC-2026-10-08-C03）。
// 与 SunlightButton / HumidityButton 同型：纯粹的显隐开关，不带状态机
// （报价数据在面板里自己拉，按钮只负责开合）。
export class CeilingQuoteButton {
  private el: HTMLButtonElement;
  private getActive: () => boolean;
  private onToggle: () => void;

  constructor(opts: { onToggle: () => void; getActive: () => boolean }) {
    this.onToggle = opts.onToggle;
    this.getActive = opts.getActive;
    const el = document.getElementById('ceiling-quote-btn') as HTMLButtonElement | null;
    if (!el) {
      throw new Error('CeilingQuoteButton: #ceiling-quote-btn element not found in DOM');
    }
    this.el = el;
    this.el.addEventListener('click', () => this.onToggle());
    this.sync();
  }

  sync(): void {
    this.el.classList.toggle('active', this.getActive());
  }
}
