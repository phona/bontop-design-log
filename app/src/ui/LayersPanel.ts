import { Popover } from './Popover.js';

// 图层抽屉：把各检视层按钮收进一个可叠加多选的面板。
// 铁律：这里只做表现层编排（计数徽章、全关、上次组合）；每个图层 ready/active
// 状态来自 App 里平级且互不引用的 set*Visible 回调，本组件绝不越过它们碰场景。
export type LayerKey =
  | 'mep_overview'
  | 'mep_coordination'
  | 'hvac'
  | 'electrical_topology'
  | 'wall_tile'
  | 'paint'
  | 'ceiling_zone';

/** 抽屉行序，也是轨道模式数字键 1-7 的映射序。 */
export const LAYER_KEYS: LayerKey[] = [
  'mep_overview',
  'mep_coordination',
  'hvac',
  'electrical_topology',
  'wall_tile',
  'paint',
  'ceiling_zone',
];

export interface LayerDescriptor {
  key: LayerKey;
  isReady: () => boolean;
  isActive: () => boolean;
}

const COMBO_STORAGE_KEY = 'layers-last-combo';

function readSavedCombo(): LayerKey[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(COMBO_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is LayerKey => typeof k === 'string' && LAYER_KEYS.includes(k as LayerKey));
  } catch {
    return [];
  }
}

function writeSavedCombo(keys: LayerKey[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // 持久化失败不影响功能
  }
}

export class LayersPanel {
  private popover: Popover;
  private countEl: HTMLElement | null;
  private comboBtn: HTMLButtonElement | null;
  private layers: LayerDescriptor[];
  private onClearAll: () => void;
  private onApplyCombo: (keys: LayerKey[]) => void;

  constructor(opts: {
    layers: LayerDescriptor[];
    onClearAll: () => void;
    onApplyCombo: (keys: LayerKey[]) => void;
    group?: string;
  }) {
    this.layers = opts.layers;
    this.onClearAll = opts.onClearAll;
    this.onApplyCombo = opts.onApplyCombo;
    this.popover = new Popover('layers-toggle-btn', 'layers-panel', { group: opts.group });
    this.countEl = document.getElementById('layers-active-count');
    this.comboBtn = document.getElementById('layers-last-combo-btn') as HTMLButtonElement | null;
    document.getElementById('layers-clear-btn')?.addEventListener('click', () => {
      this.onClearAll();
      this.sync();
    });
    this.comboBtn?.addEventListener('click', () => {
      const combo = readSavedCombo();
      if (combo.length === 0) return;
      this.onApplyCombo(combo);
      this.sync();
    });
    this.sync();
  }

  isOpen(): boolean {
    return this.popover.isOpen();
  }

  close(): void {
    this.popover.close();
  }

  /** persist=true 时把当前可见组合写入 localStorage，供「上次组合」恢复。 */
  sync(persist = false): void {
    const active = this.layers.filter((l) => l.isReady() && l.isActive()).map((l) => l.key);
    if (this.countEl) {
      this.countEl.textContent = String(active.length);
      this.countEl.hidden = active.length === 0;
    }
    if (this.comboBtn) this.comboBtn.disabled = readSavedCombo().length === 0;
    if (persist) writeSavedCombo(active);
  }
}
