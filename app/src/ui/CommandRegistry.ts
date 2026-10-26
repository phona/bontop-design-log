import { findBinding, type KeyBinding } from './keybindings.js';

/**
 * 命令分类。category 同时驱动命令面板的分组与顶栏/tab bar 的入口归并，
 * 新增类别必须同步 keybindings.ts 的 KeyBinding['category'] 联合类型。
 */
export type CommandCategory = '视角' | '方案' | '检视' | '环境' | '工具' | '设置' | '工程';

export interface CommandShortcut {
  /** keybindings.ts 里的 KeyboardEvent.code */
  code: string;
  shiftKey?: boolean;
}

export interface Command {
  /** 稳定 id：命令面板、tab bar、未来快捷键分发都按它寻址 */
  id: string;
  /** 业主语言主标签（按钮与命令面板显示） */
  label: string;
  /** 工程全称/口径说明，进 title tooltip */
  engineeringNote?: string;
  category: CommandCategory;
  /** 仅用于展示；分发仍走 App 的 keydown 处理器，不在这里 */
  shortcut?: CommandShortcut;
  /** 当前是否可执行（检视层未就绪、编辑类仅桌面等） */
  available?: () => boolean;
  /** 不可用原因，命令面板置灰显示 */
  unavailableReason?: string;
  run: () => void;
  /** 开关类命令的当前激活态，命令面板显示 ✓ */
  getActive?: () => boolean;
}

/**
 * 唯一命令源：顶栏（桌面）、tab bar（移动端）、命令面板、快捷键提示四处
 * 全部从注册表渲染。注册即接线——run 委托 App 既有方法，不重写业务逻辑。
 */
export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(command: Command): void {
    this.commands.set(command.id, command);
  }

  registerAll(commands: Command[]): void {
    for (const command of commands) this.register(command);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  /** 保持注册顺序 */
  list(): Command[] {
    return Array.from(this.commands.values());
  }

  /** 按 category 分组且组内保持注册顺序；空组不输出 */
  grouped(): Array<{ category: CommandCategory; commands: Command[] }> {
    const order: CommandCategory[] = ['视角', '方案', '检视', '环境', '工具', '设置', '工程'];
    const groups = new Map<CommandCategory, Command[]>();
    for (const command of this.commands.values()) {
      const list = groups.get(command.category) ?? [];
      list.push(command);
      groups.set(command.category, list);
    }
    return order
      .filter((category) => (groups.get(category)?.length ?? 0) > 0)
      .map((category) => ({ category, commands: groups.get(category)! }));
  }

  isAvailable(command: Command): boolean {
    return command.available ? command.available() : true;
  }

  /** 执行命令；不存在或当前不可用返回 false（不抛） */
  execute(id: string): boolean {
    const command = this.commands.get(id);
    if (!command || !this.isAvailable(command)) return false;
    command.run();
    return true;
  }

  /**
   * 展示用快捷键：从 keybindings.ts 反查，避免注册表与键位表两处漂移。
   * 查不到（如 W/A/S/D 移动行 code 为空）返回 undefined，命令面板不显示快捷键。
   */
  shortcutOf(command: Command): KeyBinding | undefined {
    if (!command.shortcut) return undefined;
    return findBinding(command.shortcut.code, command.shortcut.shiftKey ?? false);
  }
}
