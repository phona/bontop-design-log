import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PaintButton } from './PaintButton.js';

describe('PaintButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="paint-btn"></button>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('禁用时显示加载状态', () => {
    let state: 'loading' | 'ready' = 'loading';
    const btn = new PaintButton({ onToggle: () => {}, getState: () => state, getActive: () => false });
    const el = document.getElementById('paint-btn') as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    expect(el.textContent).toBe('涂漆区：加载中');

    state = 'ready';
    btn.sync();
    expect(el.disabled).toBe(false);
    expect(el.textContent).toBe('涂漆区');
  });

  it('ready 时点击触发切换，并反映 active 状态', () => {
    let toggled = false;
    let active = false;
    const btn = new PaintButton({
      onToggle: () => { toggled = true; },
      getState: () => 'ready',
      getActive: () => active,
    });
    const el = document.getElementById('paint-btn') as HTMLButtonElement;
    expect(el.disabled).toBe(false);
    expect(el.textContent).toBe('涂漆区');
    el.click();
    expect(toggled).toBe(true);

    active = true;
    btn.sync();
    expect(el.textContent).toBe('涂漆区 · 显示中');
    expect(el.classList.contains('active')).toBe(true);

    active = false;
    btn.sync();
    expect(el.textContent).toBe('涂漆区');
    expect(el.classList.contains('active')).toBe(false);
  });

  it('loading 状态下 active 也保持禁用', () => {
    const btn = new PaintButton({ onToggle: () => {}, getState: () => 'loading', getActive: () => true });
    const el = document.getElementById('paint-btn') as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    expect(el.classList.contains('active')).toBe(false);
    expect(el.textContent).toBe('涂漆区：加载中');
  });

  it('缺少 DOM 元素抛错', () => {
    document.body.innerHTML = '';
    expect(() => new PaintButton({ onToggle: () => {}, getState: () => 'ready', getActive: () => false })).toThrow();
  });
});
