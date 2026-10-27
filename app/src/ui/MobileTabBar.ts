/**
 * 移动端底部 tab bar：5 个常驻入口（视角/方案/图层/环境/总览）+ 命令面板按钮。
 * 与桌面顶栏同一套 surface id，点击走 SurfaceManager.toggle——两端共用交互模型。
 * 仅在移动形态（触摸主输入或窄视口）显示，由 input-capability 判定。
 */
export interface MobileTabBarOptions {
  root: HTMLElement;
  /** 点击入口：toggle 对应 surface（'view' 打开视角面板） */
  onSurface: (id: string) => void;
  /** 命令面板按钮 */
  onPalette: () => void;
  /** 当前打开的 surface id（高亮用） */
  isSurfaceOpen: (id: string) => boolean;
  /** 告警计数：>0 时在图层入口挂徽章 */
  getAlertsCount: () => number;
}

const TABS: Array<{ id: string; label: string }> = [
  { id: 'view', label: '视角' },
  { id: 'scheme', label: '方案' },
  { id: 'layers', label: '图层' },
  { id: 'env', label: '环境' },
  { id: 'overview', label: '总览' },
];

export class MobileTabBar {
  private readonly opts: MobileTabBarOptions;
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(opts: MobileTabBarOptions) {
    this.opts = opts;
    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mobile-tab';
      btn.dataset.surface = tab.id;
      btn.innerHTML = `<span class="mobile-tab-label">${tab.label}</span><span class="mobile-tab-badge" hidden></span>`;
      btn.addEventListener('click', () => this.opts.onSurface(tab.id));
      opts.root.appendChild(btn);
      this.buttons.set(tab.id, btn);
    }
    const paletteBtn = document.createElement('button');
    paletteBtn.type = 'button';
    paletteBtn.className = 'mobile-tab mobile-tab-palette';
    paletteBtn.dataset.surface = 'palette';
    paletteBtn.textContent = '?';
    paletteBtn.title = '命令面板';
    paletteBtn.addEventListener('click', () => this.opts.onPalette());
    opts.root.appendChild(paletteBtn);
    this.buttons.set('palette', paletteBtn);
    this.sync();
  }

  setVisible(visible: boolean): void {
    this.opts.root.hidden = !visible;
  }

  /** 刷新激活态与告警徽章。 */
  sync(): void {
    for (const [id, btn] of this.buttons) {
      if (id === 'palette') continue;
      btn.classList.toggle('on', this.opts.isSurfaceOpen(id));
    }
    const layersBtn = this.buttons.get('layers')!;
    const badge = layersBtn.querySelector<HTMLElement>('.mobile-tab-badge')!;
    const count = this.opts.getAlertsCount();
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }
}
