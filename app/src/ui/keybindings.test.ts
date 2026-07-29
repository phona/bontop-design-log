import { describe, it, expect } from 'vitest';
import { KEY_BINDINGS, findBinding } from './keybindings.js';

describe('keybindings', () => {
  it('has expected number of bindings', () => {
    expect(KEY_BINDINGS.length).toBe(14);
  });

  it('finds binding by code', () => {
    const b = findBinding('KeyV');
    expect(b?.key).toBe('V');
    expect(b?.description).toBe('切换视角模式');
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
