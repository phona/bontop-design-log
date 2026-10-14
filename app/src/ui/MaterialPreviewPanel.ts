import { setupCollapsiblePanel } from './CollapsiblePanel.js';

export type PreviewFloorMode = 'procedural' | 'manufacturer_atlas';
export type PreviewSlot = 'A' | 'B';

export interface MaterialPreviewOption {
  id: string;
  label: string;
  supportsManufacturerAtlas: boolean;
}

export interface MaterialPreviewAtlasOption {
  id: string;
  label: string;
  note: string;
}

export interface MaterialPreviewPanelState {
  floorId: string;
  floorMode: PreviewFloorMode;
  atlasId: string | null;
  floorMattePercent: number;
  paintColor: string;
  paintLabel: string;
}

export interface MaterialPreviewPanelCallbacks {
  onStateChange: (state: MaterialPreviewPanelState) => void;
  onReset: () => void;
  onSavePreset: (slot: PreviewSlot) => void;
  onRecallPreset: (slot: PreviewSlot) => void;
}

/** Temporary material controls. All persistence and scene application stays with App. */
export class MaterialPreviewPanel {
  private root: HTMLElement;
  private callbacks: MaterialPreviewPanelCallbacks;
  private options: MaterialPreviewOption[];
  private atlases: MaterialPreviewAtlasOption[];
  private state: MaterialPreviewPanelState;
  private availableSlots: Record<PreviewSlot, boolean> = { A: false, B: false };

  constructor(
    host: HTMLElement,
    options: MaterialPreviewOption[],
    atlases: MaterialPreviewAtlasOption[],
    callbacks: MaterialPreviewPanelCallbacks,
    initial: MaterialPreviewPanelState,
  ) {
    this.options = options;
    this.atlases = atlases;
    this.callbacks = callbacks;
    this.state = { ...initial };
    this.root = document.createElement('section');
    this.root.className = 'dynamic-panel material-preview-panel';
    this.root.innerHTML = `
      <div class="dynamic-panel-heading">
        <strong>材质预演</strong>
        <button class="panel-collapse-toggle" type="button" aria-label="材质预演面板折叠" title="折叠">−</button>
      </div>
      <div class="material-preview-content">
        <p class="preview-note">临时预览，不写入正式方案。厂家拼版图用于看纹理变化，不代表已确认具体 SKU。</p>
        <label class="preview-control">地砖方案
          <select data-control="floor"></select>
        </label>
        <label class="preview-control">木纹表现
          <select data-control="floor-mode">
            <option value="procedural">程序化纹理</option>
            <option value="manufacturer_atlas">厂家面图库</option>
          </select>
        </label>
        <label class="preview-control">面图库
          <select data-control="atlas"></select>
        </label>
        <div class="preview-note" data-control="atlas-note"></div>
        <label class="preview-control">地面哑光度（越高越不反光）
          <output data-control="matte-label"></output>
          <input data-control="matte" type="range" min="30" max="100" step="5" />
        </label>
        <p class="preview-note">厂家拼版图不包含真实表面光泽数据；此项只调预演中的反光程度。</p>
        <label class="preview-control">墙漆色号/名称
          <input data-control="paint-label" type="text" placeholder="例如：斯托白 45YY 83/062" />
        </label>
        <label class="preview-control preview-color-row">墙面预览色
          <input data-control="paint-color" type="color" />
          <code data-control="paint-hex"></code>
        </label>
        <p class="preview-note">墙色预演只改变可涂漆墙面，不改天花和正式方案。色号是备注；HEX 是屏幕预览值，需色样校准后才能代表实物。</p>
        <div class="preview-preset-row">
          <button type="button" data-save="A">保存 A</button>
          <button type="button" data-load="A">查看 A</button>
          <button type="button" data-save="B">保存 B</button>
          <button type="button" data-load="B">查看 B</button>
        </div>
        <button class="preview-reset" type="button" data-control="reset">恢复正式材料与灯光</button>
        <p class="preview-note">重置保留当前日照日期和时刻，方便在相同光照下比较材质。</p>
      </div>`;
    host.appendChild(this.root);

    const toggle = this.root.querySelector('.panel-collapse-toggle') as HTMLButtonElement;
    const content = this.root.querySelector('.material-preview-content') as HTMLElement;
    content.id = `material-preview-content-${Math.random().toString(36).slice(2)}`;
    setupCollapsiblePanel(toggle, content, false);

    this.root.querySelector<HTMLSelectElement>('[data-control="floor"]')!.onchange = (event) => {
      this.state.floorId = (event.currentTarget as HTMLSelectElement).value;
      this.syncControls();
      this.emit();
    };
    this.root.querySelector<HTMLSelectElement>('[data-control="floor-mode"]')!.onchange = (event) => {
      this.state.floorMode = (event.currentTarget as HTMLSelectElement).value as PreviewFloorMode;
      this.syncControls();
      this.emit();
    };
    this.root.querySelector<HTMLSelectElement>('[data-control="atlas"]')!.onchange = (event) => {
      this.state.atlasId = (event.currentTarget as HTMLSelectElement).value || null;
      this.syncControls();
      this.emit();
    };
    this.root.querySelector<HTMLInputElement>('[data-control="matte"]')!.oninput = (event) => {
      this.state.floorMattePercent = Number((event.currentTarget as HTMLInputElement).value);
      this.syncMatteReadout();
      this.emit();
    };
    this.root.querySelector<HTMLInputElement>('[data-control="paint-label"]')!.oninput = (event) => {
      this.state.paintLabel = (event.currentTarget as HTMLInputElement).value;
      this.emit();
    };
    this.root.querySelector<HTMLInputElement>('[data-control="paint-color"]')!.oninput = (event) => {
      this.state.paintColor = (event.currentTarget as HTMLInputElement).value;
      this.syncPaintReadout();
      this.emit();
    };
    this.root.querySelector<HTMLButtonElement>('[data-control="reset"]')!.onclick = () => this.callbacks.onReset();
    for (const slot of ['A', 'B'] as const) {
      this.root.querySelector<HTMLButtonElement>(`[data-save="${slot}"]`)!.onclick = () => this.callbacks.onSavePreset(slot);
      this.root.querySelector<HTMLButtonElement>(`[data-load="${slot}"]`)!.onclick = () => this.callbacks.onRecallPreset(slot);
    }
    this.syncControls();
  }

  update(
    state: MaterialPreviewPanelState,
    availableSlots: Record<PreviewSlot, boolean> = this.availableSlots,
  ): void {
    this.state = { ...state };
    this.availableSlots = { ...availableSlots };
    this.syncControls();
  }

  destroy(): void {
    this.root.remove();
  }

  private emit(): void {
    this.callbacks.onStateChange({ ...this.state });
  }

  private syncControls(): void {
    const floor = this.root.querySelector<HTMLSelectElement>('[data-control="floor"]')!;
    floor.replaceChildren();
    for (const option of this.options) {
      const element = document.createElement('option');
      element.value = option.id;
      element.textContent = option.label;
      floor.appendChild(element);
    }
    floor.value = this.state.floorId;

    const currentFloor = this.options.find((option) => option.id === this.state.floorId);
    const mode = this.root.querySelector<HTMLSelectElement>('[data-control="floor-mode"]')!;
    const atlasMode = mode.querySelector<HTMLOptionElement>('option[value="manufacturer_atlas"]')!;
    atlasMode.disabled = !currentFloor?.supportsManufacturerAtlas || this.atlases.length === 0;
    if (atlasMode.disabled && this.state.floorMode === 'manufacturer_atlas') this.state.floorMode = 'procedural';
    mode.value = this.state.floorMode;

    const atlas = this.root.querySelector<HTMLSelectElement>('[data-control="atlas"]')!;
    atlas.replaceChildren();
    for (const item of this.atlases) {
      const element = document.createElement('option');
      element.value = item.id;
      element.textContent = item.label;
      atlas.appendChild(element);
    }
    atlas.value = this.state.atlasId ?? this.atlases[0]?.id ?? '';
    atlas.disabled = this.state.floorMode !== 'manufacturer_atlas' || this.atlases.length === 0;
    this.root.querySelector<HTMLElement>('[data-control="atlas-note"]')!.textContent = this.atlases.find((item) => item.id === atlas.value)?.note ?? '';

    this.root.querySelector<HTMLInputElement>('[data-control="matte"]')!.value = String(this.state.floorMattePercent);
    this.root.querySelector<HTMLInputElement>('[data-control="paint-label"]')!.value = this.state.paintLabel;
    this.root.querySelector<HTMLInputElement>('[data-control="paint-color"]')!.value = this.state.paintColor;
    for (const slot of ['A', 'B'] as const) {
      this.root.querySelector<HTMLButtonElement>(`[data-load="${slot}"]`)!.disabled = !this.availableSlots[slot];
    }
    this.syncMatteReadout();
    this.syncPaintReadout();
  }

  private syncMatteReadout(): void {
    this.root.querySelector<HTMLOutputElement>('[data-control="matte-label"]')!.textContent = `${this.state.floorMattePercent}%`;
  }

  private syncPaintReadout(): void {
    this.root.querySelector<HTMLElement>('[data-control="paint-hex"]')!.textContent = this.state.paintColor.toUpperCase();
  }
}
