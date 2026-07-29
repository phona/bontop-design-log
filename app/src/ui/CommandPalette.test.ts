import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandPalette } from './CommandPalette.js';

describe('CommandPalette', () => {
  let palette: CommandPalette;

  beforeEach(() => {
    palette = new CommandPalette();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts hidden', () => {
    expect(palette.isVisible()).toBe(false);
  });

  it('becomes visible on show()', () => {
    palette.show();
    expect(palette.isVisible()).toBe(true);
  });

  it('becomes hidden on hide()', () => {
    palette.show();
    palette.hide();
    expect(palette.isVisible()).toBe(false);
  });

  it('toggles visibility', () => {
    palette.toggle();
    expect(palette.isVisible()).toBe(true);
    palette.toggle();
    expect(palette.isVisible()).toBe(false);
  });

  it('renders key binding entries', () => {
    palette.show();
    const el = document.getElementById('command-palette');
    expect(el).toBeTruthy();
    expect(el!.innerHTML).toContain('快捷键');
    expect(el!.innerHTML).toContain('切换视角模式');
    expect(el!.innerHTML).toContain('V');
  });
});
