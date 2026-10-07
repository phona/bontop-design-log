import { describe, it, expect, vi } from 'vitest';
import { CeilingQuoteButton } from './CeilingQuoteButton.js';

// 与 SunlightButton / HumidityButton 同型：纯显隐开关（DEC-2026-10-08-C03）。
describe('CeilingQuoteButton', () => {
  function setup() {
    document.body.innerHTML = '<button id="ceiling-quote-btn"></button>';
    const onToggle = vi.fn();
    let active = false;
    const button = new CeilingQuoteButton({ onToggle, getActive: () => active });
    return { button, onToggle, el: () => document.getElementById('ceiling-quote-btn') as HTMLButtonElement, setActive: (value: boolean) => { active = value; button.sync(); } };
  }

  it('throws when the button element is missing', () => {
    document.body.innerHTML = '';
    expect(() => new CeilingQuoteButton({ onToggle: () => {}, getActive: () => false })).toThrow();
  });

  it('toggles the active class and routes clicks to the callback', () => {
    const harness = setup();
    expect(harness.el().classList.contains('active')).toBe(false);
    harness.setActive(true);
    expect(harness.el().classList.contains('active')).toBe(true);
    harness.el().click();
    harness.el().click();
    expect(harness.onToggle).toHaveBeenCalledTimes(2);
  });
});
