import { describe, it, expect, vi } from 'vitest';
import { ElementStateButton } from './ElementStateButton.js';

// 与 CeilingZoneButton.test.ts 同型：构件状态高亮开关（DEC-2026-10-09-E01）。
describe('ElementStateButton', () => {
  function setup() {
    document.body.innerHTML = '<button id="element-state-btn"></button>';
    const onToggle = vi.fn();
    let state: 'loading' | 'ready' | 'unavailable' = 'loading';
    let active = false;
    const button = new ElementStateButton({
      onToggle,
      getState: () => state,
      getActive: () => active,
    });
    return {
      button,
      onToggle,
      el: () => document.getElementById('element-state-btn') as HTMLButtonElement,
      setState: (value: 'loading' | 'ready' | 'unavailable') => { state = value; button.sync(); },
      setActive: (value: boolean) => { active = value; button.sync(); },
    };
  }

  it('throws when the button element is missing', () => {
    document.body.innerHTML = '';
    expect(() => new ElementStateButton({ onToggle: () => {}, getState: () => 'ready', getActive: () => false })).toThrow();
  });

  it('is disabled while loading and unavailable; reflects active once ready', () => {
    const harness = setup();
    expect(harness.el().disabled).toBe(true);
    expect(harness.el().textContent).toBe('工程状态：加载中');
    harness.setState('unavailable');
    expect(harness.el().disabled).toBe(true);
    expect(harness.el().textContent).toBe('工程状态：不可用');
    harness.setState('ready');
    expect(harness.el().disabled).toBe(false);
    expect(harness.el().textContent).toBe('工程状态');
    expect(harness.el().classList.contains('active')).toBe(false);
    harness.setActive(true);
    expect(harness.el().textContent).toBe('工程状态 · 显示中');
    expect(harness.el().classList.contains('active')).toBe(true);
  });

  it('clicking toggles through the injected callback', () => {
    const harness = setup();
    harness.setState('ready');
    harness.el().click();
    expect(harness.onToggle).toHaveBeenCalledTimes(1);
    harness.el().click();
    expect(harness.onToggle).toHaveBeenCalledTimes(2);
  });
});
