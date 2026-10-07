import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LayersPanel, LAYER_KEYS, type LayerDescriptor, type LayerKey } from './LayersPanel.js';

function installDom(): void {
  document.body.innerHTML = `
    <button id="layers-toggle-btn" aria-expanded="false">图层</button>
    <div id="layers-panel" hidden>
      <button id="layers-last-combo-btn">上次组合</button>
      <button id="layers-clear-btn">全关</button>
    </div>
    <span id="layers-active-count" hidden></span>
  `;
}

function makeLayers(state: Partial<Record<LayerKey, { ready: boolean; active: boolean }>>): LayerDescriptor[] {
  return LAYER_KEYS.map((key) => ({
    key,
    isReady: () => state[key]?.ready ?? false,
    isActive: () => state[key]?.active ?? false,
  }));
}

describe('LayersPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    installDom();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('计数徽章只统计就绪且开启的层', () => {
    new LayersPanel({
      layers: makeLayers({
        mep_overview: { ready: true, active: true },
        hvac: { ready: true, active: true },
        wall_tile: { ready: false, active: true },
      }),
      onClearAll: () => {},
      onApplyCombo: () => {},
    });
    const count = document.getElementById('layers-active-count')!;
    expect(count.textContent).toBe('2');
    expect(count.hidden).toBe(false);
  });

  it('无开启层时隐藏计数', () => {
    new LayersPanel({ layers: makeLayers({}), onClearAll: () => {}, onApplyCombo: () => {} });
    const count = document.getElementById('layers-active-count')!;
    expect(count.hidden).toBe(true);
  });

  it('sync(true) 把当前就绪且开启的组合写入 localStorage', () => {
    const panel = new LayersPanel({
      layers: makeLayers({
        wall_tile: { ready: true, active: true },
        paint: { ready: true, active: true },
        ceiling_zone: { ready: true, active: false },
      }),
      onClearAll: () => {},
      onApplyCombo: () => {},
    });
    panel.sync(true);
    expect(JSON.parse(localStorage.getItem('layers-last-combo')!)).toEqual(['wall_tile', 'paint']);
  });

  it('存档存在时「上次组合」可用并带回合法 key，空存档时禁用', () => {
    let applied: LayerKey[] | null = null;
    const panel = new LayersPanel({ layers: makeLayers({}), onClearAll: () => {}, onApplyCombo: (keys) => { applied = keys; } });
    const comboBtn = document.getElementById('layers-last-combo-btn') as HTMLButtonElement;
    expect(comboBtn.disabled).toBe(true);
    localStorage.setItem('layers-last-combo', JSON.stringify(['hvac', 'bogus_key']));
    panel.sync();
    expect(comboBtn.disabled).toBe(false);
    comboBtn.click();
    expect(applied).toEqual(['hvac']);
  });

  it('「全关」按钮触发 onClearAll', () => {
    let cleared = false;
    new LayersPanel({ layers: makeLayers({}), onClearAll: () => { cleared = true; }, onApplyCombo: () => {} });
    (document.getElementById('layers-clear-btn') as HTMLButtonElement).click();
    expect(cleared).toBe(true);
  });

  it('toggle/close 委托弹出面板', () => {
    const panel = new LayersPanel({ layers: makeLayers({}), onClearAll: () => {}, onApplyCombo: () => {} });
    expect(panel.isOpen()).toBe(false);
    panel.close();
    expect(panel.isOpen()).toBe(false);
  });

  it('缺少 DOM 元素抛错', () => {
    document.body.innerHTML = '';
    expect(() => new LayersPanel({ layers: [], onClearAll: () => {}, onApplyCombo: () => {} })).toThrow();
  });
});
