// 顶栏弹出面板的通用开合器（图层抽屉 / 环境 / 告警 / 设置共用）。
// 本组件只做开合同步（hidden + aria-expanded）与同组互斥，是纯开合组件：
// 画布单击清场、钉住豁免、Esc 一键清场由 SurfaceManager 统一编排
// （2026-10-26 控制面重构废除了旧的“粘性”默认——点场景不收起）。
const groups = new Map<string, Set<Popover>>();

export class Popover {
  private btn: HTMLElement;
  private panel: HTMLElement;
  private open = false;
  private group: string | undefined;

  constructor(toggleBtnId: string, panelId: string, opts?: { group?: string; onToggle?: () => void }) {
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
    // onToggle 提供时，开关按钮走外部编排（SurfaceManager），互斥与清场统一收口
    btn.addEventListener('click', () => (opts?.onToggle ? opts.onToggle() : this.toggle()));
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
