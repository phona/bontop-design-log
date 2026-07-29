import { KEY_BINDINGS, type KeyBinding } from './keybindings.js';

export class CommandPalette {
  private container: HTMLDivElement;
  private visible = false;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'command-palette';
    this.container.style.cssText = `
      display: none; position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,0.4); justify-content: center; align-items: center;
      font-family: 'Segoe UI', system-ui, sans-serif;
    `;
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) this.hide();
    });
    document.body.appendChild(this.container);
    this.render();
  }

  private render(): void {
    const groups = new Map<string, KeyBinding[]>();
    for (const b of KEY_BINDINGS) {
      const list = groups.get(b.category) ?? [];
      list.push(b);
      groups.set(b.category, list);
    }

    let html = `<div style="background:#1a1a2e; border-radius:12px; padding:24px 32px; max-width:520px; width:90%; max-height:80vh; overflow-y:auto; color:#e0e0e0; box-shadow:0 8px 32px rgba(0,0,0,0.5);">
      <h2 style="margin:0 0 16px; font-size:18px; color:#fff;">快捷键</h2>`;

    for (const [cat, bindings] of groups) {
      html += `<h3 style="margin:12px 0 6px; font-size:13px; color:#8888aa; text-transform:uppercase;">${cat}</h3>`;
      for (const b of bindings) {
        const modeTag = b.mode && b.mode !== 'all' ? `<span style="font-size:11px; color:#666; margin-left:8px;">${b.mode}</span>` : '';
        html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid #2a2a3e;">
          <span style="font-size:14px;">${b.description}</span>
          <span><kbd style="background:#2a2a3e; border:1px solid #3a3a5e; border-radius:4px; padding:2px 8px; font-size:13px; font-family:monospace; color:#aad;">${b.key}</kbd>${modeTag}</span>
        </div>`;
      }
    }

    html += `<div style="margin-top:12px; text-align:center; font-size:12px; color:#666;">按 ? 或 Esc 关闭</div></div>`;
    this.container.innerHTML = html;
  }

  show(): void { this.visible = true; this.container.style.display = 'flex'; }
  hide(): void { this.visible = false; this.container.style.display = 'none'; }
  toggle(): void { this.visible ? this.hide() : this.show(); }
  isVisible(): boolean { return this.visible; }
}
