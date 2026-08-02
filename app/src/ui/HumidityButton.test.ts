import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HumidityButton } from './HumidityButton.js';

describe('HumidityButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="humidity-btn"></button>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('点击触发 onToggle', () => {
    let toggled = false;
    const btn = new HumidityButton({ onToggle: () => { toggled = true; }, getActive: () => false });
    (document.getElementById('humidity-btn') as HTMLButtonElement).click();
    expect(toggled).toBe(true);
    btn.sync();
  });

  it('active 状态加高亮 class', () => {
    const btn = new HumidityButton({ onToggle: () => {}, getActive: () => true });
    btn.sync();
    expect((document.getElementById('humidity-btn') as HTMLButtonElement).classList.contains('active')).toBe(true);
  });

  it('缺少 DOM 元素抛错', () => {
    document.body.innerHTML = '';
    expect(() => new HumidityButton({ onToggle: () => {}, getActive: () => false })).toThrow();
  });
});
