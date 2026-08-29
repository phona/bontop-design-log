import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SunlightPanel } from './SunlightPanel.js';

describe('SunlightPanel', () => {
  let panel: SunlightPanel;

  beforeEach(() => {
    panel = new SunlightPanel();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts hidden', () => {
    expect(panel.isVisible()).toBe(false);
  });

  it('show 创建面板且含滑杆', () => {
    panel.show();
    expect(panel.isVisible()).toBe(true);
    expect(document.getElementById('sunlight-panel')).toBeTruthy();
    expect(document.getElementById('sunlight-date')).toBeTruthy();
    expect(document.getElementById('sunlight-hour')).toBeTruthy();
    expect(document.querySelector('#sunlight-panel')?.parentElement).toBe(document.getElementById('right-panel-stack') ?? document.body);
  });

  it('hide 移除显示', () => {
    panel.show();
    panel.hide();
    expect(panel.isVisible()).toBe(false);
  });

  it('日期滑杆触发 onDateChange', () => {
    let got: [number, number] | null = null;
    panel.onDateChange((m, d) => { got = [m, d]; });
    panel.show();
    const slider = document.getElementById('sunlight-date') as HTMLInputElement;
    slider.value = '0';
    slider.dispatchEvent(new Event('input'));
    expect(got).toEqual([1, 1]);
  });

  it('时刻滑杆触发 onHourChange（96 档 ÷ 4）', () => {
    let got: number | null = null;
    panel.onHourChange((h) => { got = h; });
    panel.show();
    const slider = document.getElementById('sunlight-hour') as HTMLInputElement;
    slider.value = '51';
    slider.dispatchEvent(new Event('input'));
    expect(got).toBe(12.75);
  });

  it('冬至预设触发 onDateChange(12, 22)', () => {
    let got: [number, number] | null = null;
    panel.onDateChange((m, d) => { got = [m, d]; });
    panel.show();
    const btn = document.querySelector('button[data-season="winter"]') as HTMLButtonElement;
    btn.click();
    expect(got).toEqual([12, 22]);
  });

  it('播放与热力图按钮触发回调', () => {
    let played = false;
    let heatmap = false;
    panel.onPlayToggle(() => { played = true; });
    panel.onHeatmapToggle(() => { heatmap = true; });
    panel.show();
    (document.getElementById('sunlight-play') as HTMLButtonElement).click();
    (document.getElementById('sunlight-heatmap') as HTMLButtonElement).click();
    expect(played).toBe(true);
    expect(heatmap).toBe(true);
  });

  it('setSolarReadout 更新读数文本', () => {
    panel.show();
    panel.setSolarReadout(43.7, 180);
    const el = document.getElementById('sunlight-readout')!;
    expect(el.textContent).toContain('43.7');
    expect(el.textContent).toContain('180');
  });

  it('setHuinanHint 控制提示条显隐', () => {
    panel.show();
    panel.setHuinanHint(true);
    expect((document.getElementById('sunlight-huinan-hint') as HTMLElement).style.display).not.toBe('none');
    panel.setHuinanHint(false);
    expect((document.getElementById('sunlight-huinan-hint') as HTMLElement).style.display).toBe('none');
  });
});
