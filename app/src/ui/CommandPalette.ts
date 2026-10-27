import type { Command, CommandRegistry } from './CommandRegistry.js';
import { escapeHtml } from './escape-html.js';

/**
 * 可执行命令面板：从 CommandRegistry 渲染，支持子串过滤（对中文标签比模糊匹配更好用）、方向键选择、回车执行。
 * 快捷键 `?`（shift + /）开合；Esc 关闭由 App 的全局键盘链统一收口。
 */
export class CommandPalette {
  private container: HTMLDivElement;
  private input: HTMLInputElement;
  private listEl: HTMLDivElement;
  private registry: CommandRegistry | null = null;
  private visible = false;
  private selected = 0;
  private filtered: Command[] = [];

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'command-palette';
    this.container.style.cssText = `
      display: none; position: fixed; inset: 0; z-index: 250;
      background: rgba(0,0,0,0.55); justify-content: center; align-items: flex-start;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    this.container.addEventListener('click', (e: MouseEvent) => {
      if (e.target === this.container) this.hide();
    });

    const box = document.createElement('div');
    box.style.cssText = `
      background: #1a1a24; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
      overflow: hidden; box-shadow: 0 12px 48px rgba(0,0,0,0.6);
      width: min(520px, calc(100% - 32px)); margin-top: 12vh;
    `;

    this.input = document.createElement('input');
    this.input.placeholder = '输入命令…（如 贴砖 / 总览 / 导出）';
    this.input.style.cssText = `
      width: 100%; border: 0; border-bottom: 1px solid rgba(255,255,255,0.12);
      background: transparent; color: #eee; padding: 14px 16px; font-size: 15px; outline: none;
    `;
    this.input.addEventListener('input', () => {
      this.selected = 0;
      this.renderList();
    });
    this.input.addEventListener('keydown', (e: KeyboardEvent) => this.onInputKeyDown(e));

    this.listEl = document.createElement('div');
    this.listEl.style.cssText = 'max-height: 300px; overflow-y: auto;';

    box.appendChild(this.input);
    box.appendChild(this.listEl);
    this.container.appendChild(box);
    document.body.appendChild(this.container);
  }

  setRegistry(registry: CommandRegistry): void {
    this.registry = registry;
  }

  show(): void {
    this.visible = true;
    this.container.style.display = 'flex';
    this.input.value = '';
    this.selected = 0;
    this.renderList();
    this.input.focus?.();
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  private onInputKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selected = Math.min(this.selected + 1, this.filtered.length - 1);
      this.renderList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selected = Math.max(this.selected - 1, 0);
      this.renderList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const command = this.filtered[this.selected];
      if (command) this.execute(command);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
    }
  }

  private execute(command: Command): void {
    this.hide();
    if (this.registry && !this.registry.execute(command.id)) {
      // 执行被 available() 拦下时给一句反馈；toast 由 App 统一管理，这里只发事件
      window.dispatchEvent(new CustomEvent('command-unavailable', {
        detail: { id: command.id, label: command.label, reason: command.unavailableReason },
      }));
    }
  }

  private matches(command: Command, query: string): boolean {
    if (!query) return true;
    const haystack = [command.label, command.id, command.category, command.engineeringNote ?? ''].join(' ').toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  private renderList(): void {
    const query = this.input.value.trim();
    this.filtered = this.registry
      ? this.registry.list().filter((command) => this.matches(command, query))
      : [];
    if (this.selected >= this.filtered.length) this.selected = Math.max(0, this.filtered.length - 1);

    if (this.filtered.length === 0) {
      this.listEl.innerHTML = '<div style="padding:16px;color:#888;font-size:13px;">没有匹配的命令</div>';
      return;
    }

    let html = '';
    let lastCategory: string | null = null;
    this.filtered.forEach((command, index) => {
      if (command.category !== lastCategory) {
        lastCategory = command.category;
        html += `<div style="padding:8px 16px 2px;font-size:11px;color:#777;user-select:none;">${escapeHtml(command.category)}</div>`;
      }
      const available = this.registry ? this.registry.isAvailable(command) : true;
      const active = command.getActive?.() === true;
      const shortcut = this.registry?.shortcutOf(command);
      const keyHint = shortcut
        ? `<span style="margin-left:auto;font-size:11px;color:#888;font-family:monospace;">${escapeHtml(shortcut.key)}</span>`
        : '<span style="margin-left:auto"></span>';
      const title = command.engineeringNote ? ` title="${escapeHtml(command.engineeringNote)}"` : '';
      const state = active ? '<span style="color:#93c5fd;">✓</span> ' : '';
      const dim = available ? '' : 'opacity:0.45;';
      html += `<button type="button" data-cmd-index="${index}" style="
        display:flex;align-items:center;gap:8px;width:100%;text-align:left;
        padding:9px 16px;border:0;background:${index === this.selected ? 'rgba(59,130,246,0.3)' : 'transparent'};
        color:#eee;font-size:13px;cursor:pointer;${dim}"${title}>${state}${escapeHtml(command.label)}${keyHint}</button>`;
    });
    this.listEl.innerHTML = html;

    this.listEl.querySelectorAll<HTMLButtonElement>('button[data-cmd-index]').forEach((btn) => {
      const index = Number(btn.getAttribute('data-cmd-index'));
      btn.addEventListener('click', () => {
        const command = this.filtered[index];
        if (command) this.execute(command);
      });
    });
  }
}
