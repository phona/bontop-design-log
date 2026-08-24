import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HvacCoordinationButton } from './HvacCoordinationButton.js';

describe('HvacCoordinationButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="hvac-coordination-btn"></button>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('禁用时显示加载或未实现状态', () => {
    let state: 'loading' | 'unimplemented' | 'ready' = 'loading';
    const btn = new HvacCoordinationButton({ onToggle: () => {}, getState: () => state, getActive: () => false });
    const el = document.getElementById('hvac-coordination-btn') as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    expect(el.textContent).toBe('加载中');

    state = 'unimplemented';
    btn.sync();
    expect(el.disabled).toBe(true);
    expect(el.textContent).toBe('未实现');
  });

  it('ready 时点击触发切换，并反映路线 active 状态', () => {
    let toggled = false;
    let active = false;
    const btn = new HvacCoordinationButton({
      onToggle: () => { toggled = true; },
      getState: () => 'ready',
      getActive: () => active,
    });
    const el = document.getElementById('hvac-coordination-btn') as HTMLButtonElement;
    expect(el.disabled).toBe(false);
    expect(el.textContent).toBe('HVAC');
    el.click();
    expect(toggled).toBe(true);

    active = true;
    btn.sync();
    expect(el.textContent).toBe('HVAC · 路线');
    expect(el.classList.contains('active')).toBe(true);
  });

  it('缺少 DOM 元素抛错', () => {
    document.body.innerHTML = '';
    expect(() => new HvacCoordinationButton({ onToggle: () => {}, getState: () => 'ready', getActive: () => false })).toThrow();
  });
});
