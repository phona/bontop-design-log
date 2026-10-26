import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Popover } from './Popover.js';

describe('Popover', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="pop-btn" aria-expanded="false">开关</button>
      <div id="pop-panel" hidden>面板</div>
      <button id="pop-btn2" aria-expanded="false">开关2</button>
      <div id="pop-panel2" hidden>面板2</div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('面板显隐与 aria-expanded 同步', () => {
    const popover = new Popover('pop-btn', 'pop-panel');
    const panel = document.getElementById('pop-panel')!;
    const btn = document.getElementById('pop-btn')!;
    expect(panel.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    popover.openPanel();
    expect(panel.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    popover.close();
    expect(panel.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggle 在开/关间切换', () => {
    const popover = new Popover('pop-btn', 'pop-panel');
    popover.toggle();
    expect(popover.isOpen()).toBe(true);
    popover.toggle();
    expect(popover.isOpen()).toBe(false);
  });

  it('Popover 自身不监听外部点击；即收语义由 SurfaceManager.dismissTransient 负责', () => {
    // 2026-10-26 控制面重构：旧的“粘性”默认（点场景不收起）已废除。
    // Popover 退化为纯开合组件，画布单击清场/钉住豁免统一由 SurfaceManager 编排，
    // 见 SurfaceManager.test.ts 的同源断言。
    const popover = new Popover('pop-btn', 'pop-panel');
    popover.openPanel();
    document.body.click();
    expect(popover.isOpen()).toBe(true);
  });

  it('点击面板内部不收起，点击开关按钮本身走 toggle', () => {
    const popover = new Popover('pop-btn', 'pop-panel');
    popover.openPanel();
    document.getElementById('pop-panel')!.click();
    expect(popover.isOpen()).toBe(true);
    document.getElementById('pop-btn')!.click();
    expect(popover.isOpen()).toBe(false);
  });

  it('同组面板互斥：打开一个收起另一个', () => {
    const a = new Popover('pop-btn', 'pop-panel', { group: 'toolbar' });
    const b = new Popover('pop-btn2', 'pop-panel2', { group: 'toolbar' });
    a.openPanel();
    expect(a.isOpen()).toBe(true);
    b.openPanel();
    expect(b.isOpen()).toBe(true);
    expect(a.isOpen()).toBe(false);
  });

  it('未分组或不同组的面板互不影响', () => {
    const a = new Popover('pop-btn', 'pop-panel', { group: 'a' });
    const b = new Popover('pop-btn2', 'pop-panel2');
    a.openPanel();
    b.openPanel();
    expect(a.isOpen()).toBe(true);
    expect(b.isOpen()).toBe(true);
  });

  it('重复 close 是幂等的', () => {
    const popover = new Popover('pop-btn', 'pop-panel');
    popover.openPanel();
    popover.close();
    popover.close();
    expect(popover.isOpen()).toBe(false);
  });

  it('缺少 DOM 元素抛错', () => {
    document.body.innerHTML = '';
    expect(() => new Popover('pop-btn', 'pop-panel')).toThrow();
  });
});
