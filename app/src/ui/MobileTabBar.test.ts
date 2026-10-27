import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MobileTabBar } from './MobileTabBar.js';

function setup() {
  document.body.innerHTML = '<nav id="mobile-tabbar" hidden></nav>';
  const root = document.getElementById('mobile-tabbar')!;
  const opened: string[] = [];
  let paletteCalls = 0;
  const openSurfaces = new Set<string>();
  let alerts = 0;
  const bar = new MobileTabBar({
    root,
    onSurface: (id) => opened.push(id),
    onPalette: () => { paletteCalls += 1; },
    isSurfaceOpen: (id) => openSurfaces.has(id),
    getAlertsCount: () => alerts,
  });
  return {
    bar, root, opened,
    paletteCalls: () => paletteCalls,
    setOpen: (id: string, open: boolean) => { open ? openSurfaces.add(id) : openSurfaces.delete(id); },
    setAlerts: (n: number) => { alerts = n; },
  };
}

function tab(root: HTMLElement, id: string): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(`[data-surface="${id}"]`)!;
}

describe('MobileTabBar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('渲染 5 个入口 + 命令面板按钮', () => {
    const { root } = setup();
    const ids = Array.from(root.querySelectorAll<HTMLButtonElement>('.mobile-tab')).map((b) => b.dataset.surface);
    expect(ids).toEqual(['view', 'scheme', 'layers', 'env', 'overview', 'palette']);
    expect(tab(root, 'layers').textContent).toContain('图层');
  });

  it('点击入口回调 onSurface，点击 ? 回调 onPalette', () => {
    const { root, opened, paletteCalls } = setup();
    tab(root, 'scheme').click();
    tab(root, 'overview').click();
    tab(root, 'palette').click();
    expect(opened).toEqual(['scheme', 'overview']);
    expect(paletteCalls()).toBe(1);
  });

  it('setVisible 控制 hidden', () => {
    const { bar, root } = setup();
    bar.setVisible(false);
    expect(root.hidden).toBe(true);
    bar.setVisible(true);
    expect(root.hidden).toBe(false);
  });

  it('sync 同步激活态；告警 >0 时图层入口挂徽章', () => {
    const ctx = setup();
    ctx.setOpen('layers', true);
    ctx.setAlerts(3);
    ctx.bar.sync();
    expect(tab(ctx.root, 'layers').classList.contains('on')).toBe(true);
    expect(tab(ctx.root, 'scheme').classList.contains('on')).toBe(false);
    const badge = tab(ctx.root, 'layers').querySelector<HTMLElement>('.mobile-tab-badge')!;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('3');

    ctx.setOpen('layers', false);
    ctx.setAlerts(0);
    ctx.bar.sync();
    expect(tab(ctx.root, 'layers').classList.contains('on')).toBe(false);
    expect(badge.hidden).toBe(true);
  });
});
