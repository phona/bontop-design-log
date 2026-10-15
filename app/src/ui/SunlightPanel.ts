const SEASONS: Array<{ key: string; label: string; month: number; day: number }> = [
  { key: 'winter', label: '冬至', month: 12, day: 22 },
  { key: 'summer', label: '夏至', month: 6, day: 22 },
  { key: 'spring', label: '春分', month: 3, day: 20 },
  { key: 'autumn', label: '秋分', month: 9, day: 23 },
];

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function dayIndexToDate(index: number): { month: number; day: number } {
  let rest = index;
  for (let m = 0; m < 12; m++) {
    if (rest < MONTH_DAYS[m]) return { month: m + 1, day: rest + 1 };
    rest -= MONTH_DAYS[m];
  }
  return { month: 12, day: 31 };
}

function dateToIndex(month: number, day: number): number {
  let index = Math.max(0, day - 1);
  for (let m = 0; m < month - 1; m++) index += MONTH_DAYS[m] ?? 0;
  return index;
}

export class SunlightPanel {
  private el: HTMLDivElement | null = null;
  private host: HTMLElement | null = null;
  private onActivate?: () => void;
  private visible = false;
  private selectedDate = { month: 12, day: 22 };
  private selectedHour = 12;
  private dateCb?: (month: number, day: number) => void;
  private hourCb?: (hour: number) => void;
  private playCb?: () => void;
  private heatmapCb?: () => void;

  mount(host: HTMLElement, onActivate?: () => void): void {
    this.host = host;
    this.onActivate = onActivate;
    if (!this.el) this.build();
    if (this.el) this.el.style.display = 'block';
  }

  show(): void {
    if (!this.el) this.build();
    this.el!.style.display = 'block';
    this.visible = true;
    this.onActivate?.();
  }

  hide(): void {
    // Controls remain available in the workbench when solar simulation is off.
    this.visible = false;
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  onDateChange(cb: (month: number, day: number) => void): void {
    this.dateCb = cb;
  }

  onHourChange(cb: (hour: number) => void): void {
    this.hourCb = cb;
  }

  onPlayToggle(cb: () => void): void {
    this.playCb = cb;
  }

  onHeatmapToggle(cb: () => void): void {
    this.heatmapCb = cb;
  }

  setSolarReadout(altitudeDeg: number, azimuthDeg: number): void {
    const el = document.getElementById('sunlight-readout');
    if (el) el.textContent = `高度角 ${altitudeDeg.toFixed(1)}° · 方位角 ${azimuthDeg.toFixed(0)}°`;
  }

  setHourDisplay(hour: number): void {
    this.selectedHour = ((hour % 24) + 24) % 24;
    const slider = document.getElementById('sunlight-hour') as HTMLInputElement | null;
    if (slider) slider.value = String(Math.round(this.selectedHour * 4));
    const label = document.getElementById('sunlight-hour-label');
    if (label) label.textContent = formatHour(this.selectedHour);
  }

  setDateDisplay(month: number, day: number): void {
    this.selectedDate = { month, day };
    let index = day - 1;
    for (let m = 0; m < month - 1; m++) index += MONTH_DAYS[m] ?? 0;
    const slider = document.getElementById('sunlight-date') as HTMLInputElement | null;
    if (slider) slider.value = String(index);
    const label = document.getElementById('sunlight-date-label');
    if (label) label.textContent = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  setPlaying(playing: boolean): void {
    const btn = document.getElementById('sunlight-play');
    if (btn) btn.textContent = playing ? '⏸ 暂停' : '▶ 播放';
  }

  setHuinanHint(visible: boolean): void {
    const el = document.getElementById('sunlight-huinan-hint');
    if (el) el.style.display = visible ? 'block' : 'none';
  }

  private build(): void {
    const el = document.createElement('div');
    el.id = 'sunlight-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: transparent; color: #e0e0e0; border-radius: 0; padding: 8px 0 0;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: none; display: none;
    `;

    el.innerHTML = `
      <div class="dynamic-panel-heading"><strong>日照模拟</strong></div>
      <div>
      <div id="sunlight-huinan-hint" style="display:none; background:#5b3a1a; color:#ffd591; border-radius:6px; padding:6px 8px; margin-bottom:10px; font-size:12px;">当前处于回南天窗口</div>
      <label style="display:block; margin-bottom:4px;">日期 <span id="sunlight-date-label">${String(this.selectedDate.month).padStart(2, '0')}-${String(this.selectedDate.day).padStart(2, '0')}</span></label>
      <input id="sunlight-date" type="range" min="0" max="364" value="${dateToIndex(this.selectedDate.month, this.selectedDate.day)}" style="width:100%;" />
      <div style="display:flex; gap:6px; margin:8px 0;">
        ${SEASONS.map((s) => `<button data-season="${s.key}" style="flex:1; background:#2a2a3e; color:#ccd; border:1px solid #3a3a5e; border-radius:6px; padding:4px 0; cursor:pointer;">${s.label}</button>`).join('')}
      </div>
      <label style="display:block; margin-bottom:4px;">时刻 <span id="sunlight-hour-label">${formatHour(this.selectedHour)}</span></label>
      <input id="sunlight-hour" type="range" min="0" max="96" value="${Math.round(this.selectedHour * 4)}" style="width:100%;" />
      <div style="display:flex; gap:6px; margin-top:10px;">
        <button id="sunlight-play" style="flex:1; background:#2a2a3e; color:#ccd; border:1px solid #3a3a5e; border-radius:6px; padding:6px 0; cursor:pointer;">▶ 播放</button>
        <button id="sunlight-heatmap" style="flex:1; background:#2a2a3e; color:#ccd; border:1px solid #3a3a5e; border-radius:6px; padding:6px 0; cursor:pointer;">日照热力图</button>
      </div>
      <div id="sunlight-readout" style="margin-top:10px; color:#8888aa; font-size:12px;">高度角 --° · 方位角 --°</div>
      </div>
    `;

    (this.host ?? document.getElementById('sunlight-preview-host') ?? document.body).appendChild(el);
    this.el = el;

    const dateSlider = el.querySelector('#sunlight-date') as HTMLInputElement;
    dateSlider.addEventListener('input', () => {
      const { month, day } = dayIndexToDate(Number(dateSlider.value));
      this.selectedDate = { month, day };
      const label = el.querySelector('#sunlight-date-label');
      if (label) label.textContent = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      this.dateCb?.(month, day);
    });

    const hourSlider = el.querySelector('#sunlight-hour') as HTMLInputElement;
    hourSlider.addEventListener('input', () => {
      const hour = Number(hourSlider.value) / 4;
      this.selectedHour = hour;
      const label = el.querySelector('#sunlight-hour-label');
      if (label) label.textContent = formatHour(hour);
      this.hourCb?.(hour);
    });

    for (const s of SEASONS) {
      const btn = el.querySelector(`button[data-season="${s.key}"]`) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        let index = 0;
        for (let m = 0; m < s.month - 1; m++) index += MONTH_DAYS[m];
        index += s.day - 1;
        this.selectedDate = { month: s.month, day: s.day };
        dateSlider.value = String(index);
        const label = el.querySelector('#sunlight-date-label');
        if (label) label.textContent = `${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`;
        this.dateCb?.(s.month, s.day);
      });
    }

    (el.querySelector('#sunlight-play') as HTMLButtonElement).addEventListener('click', () => this.playCb?.());
    (el.querySelector('#sunlight-heatmap') as HTMLButtonElement).addEventListener('click', () => this.heatmapCb?.());
  }
}

function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
