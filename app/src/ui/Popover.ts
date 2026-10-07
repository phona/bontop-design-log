// 顶栏弹出面板的通用开合器（图层抽屉 / 环境 / 告警 / 设置共用）。
// 面板是"粘性"的：点场景或其它 UI 不收起，只有再次点开关按钮、按 Esc
// （由 App 统一收口）、或打开同组另一个面板（互斥替换）才会关闭。
const groups = new Map<string, Set<Popover>>();

export class Popover {
  private btn: HTMLElement;
  private panel: HTMLElement;
  private open = false;
  private group: string | undefined;

  constructor(toggleBtnId: string, panelId: string, opts?: { group?: string }) {
    const btn = document.getElementById(toggleBtnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) {
      throw new Error(`Popover: #${toggleBtnId} / #${panelId} not found in DOM`);
    }
    this.btn = btn;
    this.panel = panel;
    this.group = opts?.group;
    if (this.group) {
      const set = groups.get(this.group) ?? new Set<Popover>();
      set.add(this);
      groups.set(this.group, set);
    }
    btn.addEventListener('click', () => this.toggle());
    this.sync();
  }

  toggle(): void {
    this.open ? this.close() : this.openPanel();
  }

  openPanel(): void {
    if (this.group) {
      const siblings = groups.get(this.group);
      if (siblings) {
        for (const popover of siblings) {
          if (popover !== this) popover.close();
        }
      }
    }
    this.open = true;
    this.sync();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.sync();
  }

  isOpen(): boolean {
    return this.open;
  }

  private sync(): void {
    this.panel.hidden = !this.open;
    this.btn.setAttribute('aria-expanded', String(this.open));
  }
}
