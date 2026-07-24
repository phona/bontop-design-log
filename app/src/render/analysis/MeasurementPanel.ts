export class MeasurementPanel {
  private el: HTMLDivElement;
  private valueEl: HTMLSpanElement;
  private detailEl: HTMLDivElement;
  private onClear: () => void = () => {};
  private onSave: () => void = () => {};

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'measurement-panel';
    this.el.innerHTML = `
      <div class="measurement-header">📏 <span class="measurement-value">---</span></div>
      <div class="measurement-detail">点击场景添加测量点</div>
      <div class="measurement-actions">
        <button class="measurement-btn measurement-btn-clear">清除</button>
        <button class="measurement-btn measurement-btn-save">保存到日志</button>
      </div>
    `;
    this.el.style.display = 'none';
    container.appendChild(this.el);

    this.valueEl = this.el.querySelector('.measurement-value') as HTMLSpanElement;
    this.detailEl = this.el.querySelector('.measurement-detail') as HTMLDivElement;

    this.el.querySelector('.measurement-btn-clear')!.addEventListener('click', () => this.onClear());
    this.el.querySelector('.measurement-btn-save')!.addEventListener('click', () => this.onSave());
  }

  show(): void {
    this.el.style.display = 'block';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  setOnClear(cb: () => void): void {
    this.onClear = cb;
  }

  setOnSave(cb: () => void): void {
    this.onSave = cb;
  }

  showMeasurement(distance: number, dx: number, dz: number, pointCount: number): void {
    this.valueEl.textContent = `${distance.toFixed(2)}m`;
    this.detailEl.textContent = `E-W: ${dx.toFixed(2)}m · N-S: ${dz.toFixed(2)}m`;
  }

  showPrompt(): void {
    this.valueEl.textContent = '---';
    this.detailEl.textContent = '点击场景添加测量点';
  }
}
