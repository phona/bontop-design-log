import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SunlightButton } from './SunlightButton.js';

describe('SunlightButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="sunlight-btn"></button>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('点击触发 onToggle', () => {
    let toggled = false;
    const btn = new SunlightButton({ onToggle: () => { toggled = true; }, getActive: () => false });
    (document.getElementById('sunlight-btn') as HTMLButtonElement).click();
    expect(toggled).toBe(true);
    btn.sync();
  });

  it('active 状态加高亮 class', () => {
    const btn = new SunlightButton({ onToggle: () => {}, getActive: () => true });
    btn.sync();
    expect((document.getElementById('sunlight-btn') as HTMLButtonElement).classList.contains('active')).toBe(true);
  });

  it('缺少 DOM 元素抛错', () => {
    document.body.innerHTML = '';
    expect(() => new SunlightButton({ onToggle: () => {}, getActive: () => false })).toThrow();
  });
});
