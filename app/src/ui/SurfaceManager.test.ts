import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceManager, type Surface } from './SurfaceManager.js';

type TestSurface = Surface & { opens: number; closes: number; isOpen: () => boolean; openFlag: boolean };

function makeSurface(id: string, overrides: Partial<Surface> = {}): TestSurface {
  const surface: TestSurface = {
    id,
    slot: 'popover',
    opens: 0,
    closes: 0,
    openFlag: false,
    open() { this.opens += 1; this.openFlag = true; },
    close() { this.closes += 1; this.openFlag = false; },
    isOpen() { return this.openFlag; },
    ...overrides,
  } as TestSurface;
  return surface;
}

/** 自包含 mock 节点：contains 只认自己 */
function mockNode(): EventTarget {
  const node = { contains: (n: unknown) => n === node };
  return node as unknown as EventTarget;
}

describe('SurfaceManager', () => {
  let manager: SurfaceManager;

  beforeEach(() => {
    manager = new SurfaceManager();
  });

  it('open/close/toggle 驱动面板自身实现', () => {
    const s = makeSurface('a');
    manager.register(s);
    manager.toggle('a');
    expect(s.isOpen()).toBe(true);
    expect(s.opens).toBe(1);
    manager.toggle('a');
    expect(s.isOpen()).toBe(false);
    expect(s.closes).toBe(1);
  });

  it('同 slot 互斥：开 b 关 a', () => {
    const a = makeSurface('a', { slot: 'popover' });
    const b = makeSurface('b', { slot: 'popover' });
    manager.registerAll([a, b]);
    manager.open('a');
    manager.open('b');
    expect(a.isOpen()).toBe(false);
    expect(b.isOpen()).toBe(true);
  });

  it('不同 slot 可同时打开', () => {
    const a = makeSurface('a', { slot: 'popover' });
    const b = makeSurface('b', { slot: 'left-drawer' });
    manager.registerAll([a, b]);
    manager.open('a');
    manager.open('b');
    expect(a.isOpen()).toBe(true);
    expect(b.isOpen()).toBe(true);
  });

  it('modal 打开时收起其它全部 slot', () => {
    const drawer = makeSurface('drawer', { slot: 'left-drawer' });
    const dock = makeSurface('dock', { slot: 'right-dock' });
    const modal = makeSurface('modal', { slot: 'modal' });
    manager.registerAll([drawer, dock, modal]);
    manager.open('drawer');
    manager.open('dock');
    manager.open('modal');
    expect(drawer.isOpen()).toBe(false);
    expect(dock.isOpen()).toBe(false);
    expect(modal.isOpen()).toBe(true);
  });

  it('画布清场收起 transient 未钉住表面；钉住的豁免', () => {
    const pop = makeSurface('pop', { slot: 'popover' });
    const drawer = makeSurface('drawer', { slot: 'left-drawer', pinAllowed: true });
    manager.registerAll([pop, drawer]);
    manager.open('pop');
    manager.open('drawer');
    manager.setPinned('drawer', true);
    expect(manager.dismissTransient(null)).toBe(true);
    expect(pop.isOpen()).toBe(false);
    expect(drawer.isOpen()).toBe(true);
  });

  it('画布清场放过 transient=false 的表面', () => {
    const hud = makeSurface('hud', { transient: false });
    manager.register(hud);
    manager.open('hud');
    expect(manager.dismissTransient(null)).toBe(false);
    expect(hud.isOpen()).toBe(true);
  });

  it('Esc 清场连钉住的也收', () => {
    const a = makeSurface('a', { pinAllowed: true });
    manager.register(a);
    manager.open('a');
    manager.setPinned('a', true);
    expect(manager.dismissAll()).toBe(true);
    expect(a.isOpen()).toBe(false);
  });

  it('点击落在表面内部或开关上时不清场', () => {
    const inside = mockNode();
    const toggle = mockNode();
    const canvas = mockNode();
    const el = { contains: (n: unknown) => n === inside } as unknown as HTMLElement;
    const toggleEl = { contains: (n: unknown) => n === toggle } as unknown as HTMLElement;
    const a = makeSurface('a', { el, toggleEl });
    manager.register(a);
    manager.open('a');
    expect(manager.dismissTransient(inside)).toBe(false);
    expect(manager.dismissTransient(toggle)).toBe(false);
    expect(a.isOpen()).toBe(true);
    expect(manager.dismissTransient(canvas)).toBe(true);
    expect(a.isOpen()).toBe(false);
  });

  it('未注册的 id 操作不抛', () => {
    expect(() => {
      manager.open('nope');
      manager.close('nope');
      manager.toggle('nope');
      manager.dismissAll();
      manager.dismissTransient(null);
    }).not.toThrow();
  });
});
