export class GlassFidelityButton {
  private el: HTMLButtonElement;
  private getActive: () => boolean;
  private onToggle: () => void;

  constructor(opts: { onToggle: () => void; getActive: () => boolean }) {
    this.onToggle = opts.onToggle;
    this.getActive = opts.getActive;
    const el = document.getElementById('glass-fidelity-btn') as HTMLButtonElement | null;
    if (!el) {
      throw new Error('GlassFidelityButton: #glass-fidelity-btn element not found in DOM');
    }
    this.el = el;
    this.el.addEventListener('click', () => this.onToggle());
    this.sync();
  }

  sync(): void {
    this.el.classList.toggle('active', this.getActive());
  }
}
