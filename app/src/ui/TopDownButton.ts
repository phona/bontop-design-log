/**
 * TopDownButton: 右上角"俯视"按钮，绑定到 HouseScene.toggleTopDown。
 * 视觉上是个简单的小按钮，active 状态有边框高亮。
 */
export class TopDownButton {
  private el: HTMLButtonElement;
  private getActive: () => boolean;
  private onToggle: () => void;

  constructor(opts: { onToggle: () => void; getActive: () => boolean }) {
    this.onToggle = opts.onToggle;
    this.getActive = opts.getActive;
    const el = document.getElementById('topdown-btn') as HTMLButtonElement | null;
    if (!el) {
      throw new Error('TopDownButton: #topdown-btn element not found in DOM');
    }
    this.el = el;
    this.el.addEventListener('click', () => this.onToggle());
    this.sync();
  }

  sync(): void {
    const active = this.getActive();
    this.el.textContent = active ? '3D' : '俯视';
    this.el.classList.toggle('active', active);
  }
}
