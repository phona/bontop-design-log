import { describe, it, expect } from 'vitest';
import { CommandRegistry, type Command } from './CommandRegistry.js';

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: 'test.cmd',
    label: '测试命令',
    category: '工具',
    run: () => {},
    ...overrides,
  };
}

describe('CommandRegistry', () => {
  it('register + get + list 保持注册顺序', () => {
    const registry = new CommandRegistry();
    registry.registerAll([
      makeCommand({ id: 'a.first', label: '甲' }),
      makeCommand({ id: 'b.second', label: '乙' }),
    ]);
    expect(registry.get('a.first')?.label).toBe('甲');
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.list().map((c) => c.id)).toEqual(['a.first', 'b.second']);
  });

  it('重复 register 同 id 后者覆盖前者', () => {
    const registry = new CommandRegistry();
    registry.register(makeCommand({ id: 'dup', label: '旧' }));
    registry.register(makeCommand({ id: 'dup', label: '新' }));
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('dup')?.label).toBe('新');
  });

  it('execute 调用 run 并返回 true；未知 id 返回 false', () => {
    const registry = new CommandRegistry();
    let calls = 0;
    registry.register(makeCommand({ id: 'run.me', run: () => { calls += 1; } }));
    expect(registry.execute('run.me')).toBe(true);
    expect(calls).toBe(1);
    expect(registry.execute('nope')).toBe(false);
    expect(calls).toBe(1);
  });

  it('available() 为 false 时 execute 被拦下且不调用 run', () => {
    const registry = new CommandRegistry();
    let calls = 0;
    registry.register(makeCommand({
      id: 'blocked',
      available: () => false,
      unavailableReason: '数据未就绪',
      run: () => { calls += 1; },
    }));
    expect(registry.isAvailable(registry.get('blocked')!)).toBe(false);
    expect(registry.execute('blocked')).toBe(false);
    expect(calls).toBe(0);
  });

  it('grouped 按固定类别顺序分组、组内保持注册顺序、跳过空组', () => {
    const registry = new CommandRegistry();
    registry.registerAll([
      makeCommand({ id: 'tool.one', category: '工具' }),
      makeCommand({ id: 'view.one', category: '视角' }),
      makeCommand({ id: 'tool.two', category: '工具' }),
    ]);
    const groups = registry.grouped();
    expect(groups.map((g) => g.category)).toEqual(['视角', '工具']);
    expect(groups[1].commands.map((c) => c.id)).toEqual(['tool.one', 'tool.two']);
  });

  it('shortcutOf 从 keybindings.ts 反查展示键位，查不到返回 undefined', () => {
    const registry = new CommandRegistry();
    registry.registerAll([
      makeCommand({ id: 'with.v', shortcut: { code: 'KeyV' } }),
      makeCommand({ id: 'with.question', shortcut: { code: 'Slash', shiftKey: true } }),
      makeCommand({ id: 'with.unknown', shortcut: { code: 'F13' } }),
      makeCommand({ id: 'without' }),
    ]);
    expect(registry.shortcutOf(registry.get('with.v')!)?.key).toBe('V');
    expect(registry.shortcutOf(registry.get('with.question')!)?.key).toBe('?');
    expect(registry.shortcutOf(registry.get('with.unknown')!)).toBeUndefined();
    expect(registry.shortcutOf(registry.get('without')!)).toBeUndefined();
  });
});
