import { describe, it, expect, vi } from 'vitest';
import { CeilingZoneButton } from './CeilingZoneButton.js';

// 与 WallTileButton.test.ts 同型：吊顶分区高亮开关（DEC-2026-10-08-C01）。
describe('CeilingZoneButton', () => {
  function setup() {
    document.body.innerHTML = '<button id="ceiling-zone-btn"></button>';
    const onToggle = vi.fn();
    let state: 'loading' | 'ready' = 'loading';
    let active = false;
    const button = new CeilingZoneButton({
      onToggle,
      getState: () => state,
      getActive: () => active,
    });
    return {
      button,
      onToggle,
      el: () => document.getElementById('ceiling-zone-btn') as HTMLButtonElement,
      setReady: () => { state = 'ready'; button.sync(); },
      setActive: (value: boolean) => { active = value; button.sync(); },
    };
  }

  it('throws when the button element is missing', () => {
    document.body.innerHTML = '';
    expect(() => new CeilingZoneButton({ onToggle: () => {}, getState: () => 'ready', getActive: () => false })).toThrow();
  });

  it('is disabled while loading and reflects the active state once ready', () => {
    const harness = setup();
    expect(harness.el().disabled).toBe(true);
    expect(harness.el().textContent).toBe('吊顶分区：加载中');
    harness.setReady();
    expect(harness.el().disabled).toBe(false);
    expect(harness.el().textContent).toBe('吊顶分区');
    expect(harness.el().classList.contains('active')).toBe(false);
    harness.setActive(true);
    expect(harness.el().textContent).toBe('吊顶分区 · 显示中');
    expect(harness.el().classList.contains('active')).toBe(true);
  });

  it('clicking toggles through the injected callback', () => {
    const harness = setup();
    harness.setReady();
    harness.el().click();
    expect(harness.onToggle).toHaveBeenCalledTimes(1);
    harness.el().click();
    expect(harness.onToggle).toHaveBeenCalledTimes(2);
  });
});
