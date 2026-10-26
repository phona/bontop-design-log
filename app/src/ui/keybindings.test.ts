import { describe, it, expect } from 'vitest';
import { KEY_BINDINGS, findBinding } from './keybindings.js';

describe('keybindings', () => {
  it('finds binding by code', () => {
    const b = findBinding('KeyV');
    expect(b?.key).toBe('V');
    expect(b?.description).toBe('切换视角模式');
  });

  it('covers every mode/view shortcut the App keydown handler dispatches', () => {
    // 展示表与处理器漂移曾漏掉 KeyT（俯视）；这里钉死处理器实际分发的全部 code。
    const dispatched = ['KeyV', 'KeyM', 'KeyT', 'KeyW', 'KeyP', 'KeyL', 'KeyC', 'KeyG', 'KeyB', 'KeyE', 'Delete', 'Tab', 'Slash',
      'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'BracketLeft', 'BracketRight'];
    for (const code of dispatched) {
      expect(KEY_BINDINGS.some((b) => b.code === code), `missing binding for ${code}`).toBe(true);
    }
  });

  it('has unique dispatchable code+shift pairs', () => {
    const seen = new Set<string>();
    for (const b of KEY_BINDINGS) {
      if (!b.code) continue; // W/A/S/D 移动行为展示行，不参与分发
      const key = `${b.code}|${b.shiftKey ?? false}`;
      expect(seen.has(key), `duplicate binding for ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('finds shift-? binding', () => {
    const b = findBinding('Slash', true);
    expect(b?.key).toBe('?');
  });

  it('returns undefined for unknown code', () => {
    expect(findBinding('KeyZ')).toBeUndefined();
  });

  it('does not match ? without shift', () => {
    expect(findBinding('Slash')).toBeUndefined();
  });

  it('every binding has a non-empty code', () => {
    for (const b of KEY_BINDINGS) {
      if (b.key === 'W / A / S / D') continue;
      expect(b.code).toBeTruthy();
    }
  });
});
