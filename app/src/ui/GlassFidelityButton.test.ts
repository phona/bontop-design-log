import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GlassFidelityButton } from './GlassFidelityButton.js';

describe('GlassFidelityButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="glass-fidelity-btn"></button>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('点击触发 onToggle', () => {
    let toggled = false;
    const btn = new GlassFidelityButton({ onToggle: () => { toggled = true; }, getActive: () => false });
    (document.getElementById('glass-fidelity-btn') as HTMLButtonElement).click();
    expect(toggled).toBe(true);
    btn.sync();
  });

  it('active 状态加高亮 class', () => {
    const btn = new GlassFidelityButton({ onToggle: () => {}, getActive: () => true });
    btn.sync();
    expect((document.getElementById('glass-fidelity-btn') as HTMLButtonElement).classList.contains('active')).toBe(true);
  });

  it('缺少 DOM 元素抛错', () => {
    document.body.innerHTML = '';
    expect(() => new GlassFidelityButton({ onToggle: () => {}, getActive: () => false })).toThrow();
  });
});
