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
  floorRotationDeg: number;
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
  private footer: HTMLElement;
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
    actionsHost?: HTMLElement,
  ) {
    this.options = options;
    this.atlases = atlases;
    this.callbacks = callbacks;
    this.state = { ...initial };
    this.root = document.createElement('section');
    this.root.className = 'dynamic-panel material-preview-panel';
    this.root.innerHTML = `
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
        <label class="preview-control">地砖铺向
          <output data-control="floor-rotation-label"></output>
          <input data-control="floor-rotation" type="range" min="0" max="90" step="5" />
        </label>
        <p class="preview-note">仅临时预演角度：0° 长边东西向；90° 长边转到世界 Z 轴、垂直南窗。中间角度用于比较斜向引导，不写入正式方案。</p>
        <label class="preview-control">墙漆色号/名称
          <input data-control="paint-label" type="text" placeholder="例如：斯托白 45YY 83/062" />
        </label>
        <label class="preview-control preview-color-row">墙面预览色
          <input data-control="paint-color" type="color" />
          <code data-control="paint-hex"></code>
        </label>
        <p class="preview-note">墙色预演只改变可涂漆墙面，不改天花和正式方案。色号是备注；HEX 是屏幕预览值，需色样校准后才能代表实物。</p>
        <p class="preview-note">恢复会还原正式材料与灯光；当前日照日期和时刻会保留，方便同光照比较。</p>
      </div>`;
    host.appendChild(this.root);

    this.footer = document.createElement('div');
    this.footer.className = 'material-preview-footer';
    this.footer.innerHTML = `
        <div class="preview-preset-row">
          <button type="button" data-save="A">保存 A</button>
          <button type="button" data-load="A">查看 A</button>
          <button type="button" data-save="B">保存 B</button>
          <button type="button" data-load="B">查看 B</button>
        </div>
        <button class="preview-reset" type="button" data-control="reset">恢复正式材料与灯光</button>
      </div>`;
    (actionsHost ?? host).appendChild(this.footer);

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
    this.root.querySelector<HTMLInputElement>('[data-control="floor-rotation"]')!.oninput = (event) => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      this.state.floorRotationDeg = Number.isFinite(value) ? Math.min(90, Math.max(0, value)) : 0;
      this.syncFloorRotationReadout();
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
    this.footer.querySelector<HTMLButtonElement>('[data-control="reset"]')!.onclick = () => this.callbacks.onReset();
    for (const slot of ['A', 'B'] as const) {
      this.footer.querySelector<HTMLButtonElement>(`[data-save="${slot}"]`)!.onclick = () => this.callbacks.onSavePreset(slot);
      this.footer.querySelector<HTMLButtonElement>(`[data-load="${slot}"]`)!.onclick = () => this.callbacks.onRecallPreset(slot);
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
    this.footer.remove();
  }

  private emit(): void {
    this.callbacks.onStateChange({ ...this.state });
  }

  private syncControls(): void {
    const normalizedRotation = Number.isFinite(this.state.floorRotationDeg)
      ? Math.min(90, Math.max(0, this.state.floorRotationDeg))
      : 0;
    this.state.floorRotationDeg = normalizedRotation;
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
    this.root.querySelector<HTMLInputElement>('[data-control="floor-rotation"]')!.value = String(normalizedRotation);
    this.root.querySelector<HTMLInputElement>('[data-control="paint-label"]')!.value = this.state.paintLabel;
    this.root.querySelector<HTMLInputElement>('[data-control="paint-color"]')!.value = this.state.paintColor;
    for (const slot of ['A', 'B'] as const) {
      this.footer.querySelector<HTMLButtonElement>(`[data-load="${slot}"]`)!.disabled = !this.availableSlots[slot];
    }
    this.syncMatteReadout();
    this.syncFloorRotationReadout();
    this.syncPaintReadout();
  }

  private syncMatteReadout(): void {
    this.root.querySelector<HTMLOutputElement>('[data-control="matte-label"]')!.textContent = `${this.state.floorMattePercent}%`;
  }

  private syncFloorRotationReadout(): void {
    const value = Math.min(90, Math.max(0, Number.isFinite(this.state.floorRotationDeg) ? this.state.floorRotationDeg : 0));
    this.root.querySelector<HTMLOutputElement>('[data-control="floor-rotation-label"]')!.textContent = `${Math.round(value)}°`;
  }

  private syncPaintReadout(): void {
    this.root.querySelector<HTMLElement>('[data-control="paint-hex"]')!.textContent = this.state.paintColor.toUpperCase();
  }
}
