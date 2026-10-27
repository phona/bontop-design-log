import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NARROW_MAX_PX, isMobileChrome, readCapabilities, subscribeCapabilities } from './input-capability.js';

/** 按查询串安装 matchMedia mock；change 可手动触发。 */
function installMatchMedia(matches: (query: string) => boolean) {
  const listeners = new Map<string, Set<() => void>>();
  const matchMedia = vi.fn((query: string) => ({
    matches: matches(query),
    media: query,
    addEventListener: (_: string, cb: () => void) => {
      const set = listeners.get(query) ?? new Set();
      set.add(cb);
      listeners.set(query, set);
    },
    removeEventListener: (_: string, cb: () => void) => {
      listeners.get(query)?.delete(cb);
    },
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    fire: (query: string) => { listeners.get(query)?.forEach((cb) => cb()); },
  };
}

describe('input-capability', () => {
  beforeEach(() => {
    installMatchMedia(() => false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('桌面：无触摸、宽视口 → 非移动形态', () => {
    const caps = readCapabilities();
    expect(caps).toEqual({ touchPrimary: false, narrowViewport: false });
    expect(isMobileChrome(caps)).toBe(false);
  });

  it('触摸主输入（pointer: coarse）→ 移动形态', () => {
    installMatchMedia((q) => q === '(pointer: coarse)');
    const caps = readCapabilities();
    expect(caps.touchPrimary).toBe(true);
    expect(isMobileChrome(caps)).toBe(true);
  });

  it('窄视口（≤700px，与 CSS 断点一致）→ 移动形态', () => {
    installMatchMedia((q) => q === `(max-width: ${NARROW_MAX_PX}px)`);
    const caps = readCapabilities();
    expect(caps.narrowViewport).toBe(true);
    expect(isMobileChrome(caps)).toBe(true);
  });

  it('matchMedia 不可用时不抛，按桌面处理', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('matchMedia', undefined);
    expect(readCapabilities()).toEqual({ touchPrimary: false, narrowViewport: false });
  });

  it('subscribeCapabilities：matchMedia change 与 resize 都触发回调，退订后不再触发', () => {
    const mock = installMatchMedia(() => false);
    const seen: number[] = [];
    const unsubscribe = subscribeCapabilities(() => seen.push(1));
    mock.fire('(pointer: coarse)');
    expect(seen).toHaveLength(1);
    window.dispatchEvent(new Event('resize'));
    expect(seen).toHaveLength(2);
    unsubscribe();
    mock.fire('(pointer: coarse)');
    window.dispatchEvent(new Event('resize'));
    expect(seen).toHaveLength(2);
  });
});
