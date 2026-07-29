export class PlacementPanel {
  private container: HTMLDivElement;
  private visible = false;
  private onSelectCb: ((category: string, type: string) => void) | null = null;

  private categories = [
    { category: 'electrical', label: '电气点位', items: [
      { type: 'socket', label: '五孔插座', icon: '🔌' },
      { type: 'switch', label: '开关', icon: '🔘' },
      { type: 'network', label: '网口', icon: '🌐' },
      { type: 'floor_socket', label: '地插', icon: '📍' },
    ]},
    { category: 'plumbing', label: '给排水', items: [
      { type: 'faucet', label: '水龙头', icon: '💧' },
      { type: 'toilet', label: '马桶', icon: '🚽' },
      { type: 'shower', label: '花洒', icon: '🚿' },
      { type: 'drain', label: '地漏', icon: '🕳' },
    ]},
  ];

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'placement-panel';
    this.container.style.cssText = `
      display: none; position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      z-index: 900; background: #1a1a2e; border-radius: 12px; padding: 16px;
      max-width: 640px; width: 92%; box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    `;
    document.body.appendChild(this.container);
    this.render();
  }

  private render(): void {
    let html = '';
    for (const cat of this.categories) {
      html += `<div style="margin-bottom:10px;">`;
      html += `<div style="color:#888; font-size:12px; margin-bottom:6px; padding-left:4px;">${cat.label}</div>`;
      html += `<div style="display:flex; flex-wrap:wrap; gap:6px;">`;
      for (const item of cat.items) {
        html += `<button data-category="${cat.category}" data-type="${item.type}" style="
          background:#2a2a3e; border:1px solid #3a3a5e; border-radius:8px;
          padding:8px 12px; color:#e0e0e0; cursor:pointer; font-size:13px;
          display:flex; flex-direction:column; align-items:center; gap:2px;
          min-width:68px;
        ">
          <span style="font-size:18px;">${item.icon}</span>
          <span>${item.label}</span>
        </button>`;
      }
      html += `</div></div>`;
    }
    html += `<div style="text-align:center; margin-top:4px; font-size:12px; color:#666;">点击放置 | 按 E 或 Esc 关闭</div>`;
    this.container.innerHTML = html;

    this.container.querySelectorAll('button[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const category = (btn as HTMLElement).dataset.category!;
        const type = (btn as HTMLElement).dataset.type!;
        this.onSelectCb?.(category, type);
      });
    });
  }

  onSelect(cb: (category: string, type: string) => void): void { this.onSelectCb = cb; }

  show(): void { this.visible = true; this.container.style.display = 'block'; }
  hide(): void { this.visible = false; this.container.style.display = 'none'; }
  toggle(): void { this.visible ? this.hide() : this.show(); }
  isVisible(): boolean { return this.visible; }
}
