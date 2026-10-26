import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandPalette } from './CommandPalette.js';
import { CommandRegistry, type Command } from './CommandRegistry.js';

function setup() {
  const registry = new CommandRegistry();
  const runs: string[] = [];
  registry.registerAll([
    {
      id: 'view.topdown', label: '俯视', category: '视角',
      shortcut: { code: 'KeyT' }, run: () => runs.push('topdown'),
    },
    {
      id: 'layer.wall_tile', label: '贴砖', category: '检视',
      shortcut: { code: 'Digit5' }, run: () => runs.push('tile'), getActive: () => true,
    },
    {
      id: 'layer.paint', label: '涂漆', category: '检视',
      available: () => false, unavailableReason: '数据未就绪', run: () => runs.push('paint'),
    },
  ]);
  const palette = new CommandPalette();
  palette.setRegistry(registry);
  return { palette, runs, registry };
}

function inputOf(): HTMLInputElement {
  return document.querySelector('#command-palette input') as HTMLInputElement;
}

describe('CommandPalette', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts hidden and toggles visibility', () => {
    const { palette } = setup();
    expect(palette.isVisible()).toBe(false);
    palette.toggle();
    expect(palette.isVisible()).toBe(true);
    palette.toggle();
    expect(palette.isVisible()).toBe(false);
  });

  it('renders registry commands grouped by category with shortcut hints', () => {
    const { palette } = setup();
    palette.show();
    const html = document.getElementById('command-palette')!.innerHTML;
    expect(html).toContain('视角');
    expect(html).toContain('检视');
    expect(html).toContain('俯视');
    expect(html).toContain('贴砖');
    expect(html).toContain('T'); // KeyT 的展示键位
  });

  it('filters commands by query', () => {
    const { palette } = setup();
    palette.show();
    const input = inputOf();
    input.value = '贴砖';
    input.dispatchEvent(new Event('input'));
    const html = document.getElementById('command-palette')!.innerHTML;
    expect(html).toContain('贴砖');
    expect(html).not.toContain('俯视');
  });

  it('executes the selected command on Enter', () => {
    const { palette, runs } = setup();
    palette.show();
    const input = inputOf();
    input.value = '俯视';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(runs).toEqual(['topdown']);
    expect(palette.isVisible()).toBe(false);
  });

  it('blocks unavailable commands and emits command-unavailable', () => {
    const { palette, runs } = setup();
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('command-unavailable', listener);
    palette.show();
    const input = inputOf();
    input.value = '涂漆';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    window.removeEventListener('command-unavailable', listener);
    expect(runs).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].detail.label).toBe('涂漆');
    expect(events[0].detail.reason).toBe('数据未就绪');
  });

  it('arrow keys move the selection without executing', () => {
    const { palette, runs } = setup();
    palette.show();
    const input = inputOf();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // 默认选中第 0 条（视角-俯视）；↓ 后应为第 1 条（检视-贴砖）
    expect(runs).toEqual(['tile']);
  });

  it('Escape inside the input closes the palette', () => {
    const { palette } = setup();
    palette.show();
    const input = inputOf();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(palette.isVisible()).toBe(false);
  });
});
