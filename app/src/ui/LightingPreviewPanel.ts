import { setupCollapsiblePanel } from './CollapsiblePanel.js';

export interface LightingPreviewRoom {
  id: string;
  label?: string;
  enabled: boolean;
}

export interface LightingPreviewState {
  mode: 'auto' | 'manual';
  manualOn: boolean;
  temperatureK: number | null;
  brightness: number;
  rooms: LightingPreviewRoom[];
}

export interface LightingPreviewCallbacks {
  onModeChange: (mode: 'auto' | 'manual') => void;
  onManualOnChange: (on: boolean) => void;
  onTemperatureChange: (temperatureK: number | null) => void;
  onBrightnessChange: (multiplier: number) => void;
  onRoomChange: (roomId: string, enabled: boolean) => void;
  onReset: () => void;
}

/** Temporary UI only. The host owns the lighting system and supplies callbacks. */
export class LightingPreviewPanel {
  private host: HTMLElement;
  private callbacks: LightingPreviewCallbacks;
  private state: LightingPreviewState;
  private root: HTMLElement;

  constructor(host: HTMLElement, callbacks: LightingPreviewCallbacks, initial: LightingPreviewState) {
    this.host = host;
    this.callbacks = callbacks;
    this.state = initial;
    this.root = document.createElement('section');
    this.root.className = 'dynamic-panel lighting-preview-panel';
    this.root.innerHTML = `
      <div class="panel-heading">
        <strong>灯光预演</strong>
        <button class="panel-collapse-toggle" type="button" aria-label="灯光预演面板折叠"></button>
      </div>
      <div class="lighting-preview-content" id="lighting-preview-content">
        <label class="lighting-preview-row">控制方式
          <select data-control="mode">
            <option value="auto">日照自动</option>
            <option value="manual">夜景手动</option>
          </select>
        </label>
        <label class="lighting-preview-row"><input data-control="manual-on" type="checkbox"> 手动总开关</label>
        <label class="lighting-preview-row">色温
          <select data-control="temperature">
            <option value="config">按灯具配置</option>
            <option value="2700">2700 K</option>
            <option value="3000">3000 K</option>
            <option value="3500">3500 K</option>
            <option value="4000">4000 K</option>
          </select>
        </label>
        <label class="lighting-preview-row">亮度 <output data-control="brightness-label"></output>
          <input data-control="brightness" type="range" min="0" max="150" step="5">
        </label>
        <div class="lighting-preview-rooms" data-control="rooms"></div>
        <button data-control="reset" type="button">恢复配置基线</button>
      </div>`;
    this.host.appendChild(this.root);
    const toggle = this.root.querySelector('.panel-collapse-toggle') as HTMLButtonElement;
    const content = this.root.querySelector('.lighting-preview-content') as HTMLElement;
    content.id = `lighting-preview-content-${Math.random().toString(36).slice(2)}`;
    setupCollapsiblePanel(toggle, content, false);

    this.root.querySelector<HTMLSelectElement>('[data-control="mode"]')!.onchange = (event) => {
      const mode = (event.currentTarget as HTMLSelectElement).value as 'auto' | 'manual';
      this.callbacks.onModeChange(mode);
      this.state.mode = mode;
      this.syncControls();
    };
    this.root.querySelector<HTMLInputElement>('[data-control="manual-on"]')!.onchange = (event) =>
      this.callbacks.onManualOnChange((event.currentTarget as HTMLInputElement).checked);
    this.root.querySelector<HTMLSelectElement>('[data-control="temperature"]')!.onchange = (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      this.callbacks.onTemperatureChange(value === 'config' ? null : Number(value));
      this.state.temperatureK = value === 'config' ? null : Number(value);
    };
    this.root.querySelector<HTMLInputElement>('[data-control="brightness"]')!.oninput = (event) => {
      const multiplier = Number((event.currentTarget as HTMLInputElement).value) / 100;
      this.callbacks.onBrightnessChange(multiplier);
      this.state.brightness = multiplier;
      this.syncBrightnessLabel();
    };
    this.root.querySelector<HTMLButtonElement>('[data-control="reset"]')!.onclick = () => {
      this.callbacks.onReset();
      this.state = { mode: 'auto', manualOn: false, temperatureK: null, brightness: 1, rooms: this.state.rooms.map((room) => ({ ...room, enabled: true })) };
      this.renderRooms();
      this.syncControls();
    };
    this.renderRooms();
    this.syncControls();
  }

  update(state: LightingPreviewState): void {
    this.state = { ...state, rooms: state.rooms.map((room) => ({ ...room })) };
    this.renderRooms();
    this.syncControls();
  }

  destroy(): void {
    this.root.remove();
  }

  private renderRooms(): void {
    const container = this.root.querySelector<HTMLElement>('[data-control="rooms"]')!;
    container.replaceChildren();
    const title = document.createElement('div');
    title.textContent = '分房间灯光';
    title.className = 'lighting-preview-section-title';
    container.appendChild(title);
    for (const room of this.state.rooms) {
      const label = document.createElement('label');
      label.className = 'lighting-preview-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = room.enabled;
      checkbox.onchange = () => this.callbacks.onRoomChange(room.id, checkbox.checked);
      label.append(checkbox, document.createTextNode(` ${room.label ?? room.id}`));
      container.appendChild(label);
    }
  }

  private syncControls(): void {
    this.root.querySelector<HTMLSelectElement>('[data-control="mode"]')!.value = this.state.mode;
    this.root.querySelector<HTMLInputElement>('[data-control="manual-on"]')!.checked = this.state.manualOn;
    this.root.querySelector<HTMLInputElement>('[data-control="manual-on"]')!.disabled = this.state.mode !== 'manual';
    this.root.querySelector<HTMLSelectElement>('[data-control="temperature"]')!.value = this.state.temperatureK === null ? 'config' : String(this.state.temperatureK);
    this.root.querySelector<HTMLInputElement>('[data-control="brightness"]')!.value = String(Math.round(this.state.brightness * 100));
    this.syncBrightnessLabel();
  }

  private syncBrightnessLabel(): void {
    this.root.querySelector<HTMLOutputElement>('[data-control="brightness-label"]')!.value = `${Math.round(this.state.brightness * 100)}%`;
  }
}
