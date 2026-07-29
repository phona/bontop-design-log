import { FURNITURE_DIMS } from '@shared/types';

export class FurniturePanel {
  private container: HTMLDivElement;
  private visible = false;
  private onSelectCb: ((type: string) => void) | null = null;

  private furnitureTypes = [
    { type: 'bed_180' as const, label: '1.8m床', icon: '🛏️' },
    { type: 'bed_150' as const, label: '1.5m床', icon: '🛏️' },
    { type: 'sofa_3seat' as const, label: '三人沙发', icon: '🛋️' },
    { type: 'dining_table' as const, label: '餐桌', icon: '🍽️' },
    { type: 'dining_chair' as const, label: '餐椅', icon: '🪑' },
    { type: 'tv_stand' as const, label: '电视柜', icon: '📺' },
    { type: 'wardrobe_240' as const, label: '衣柜(2.4m)', icon: '🗄️' },
    { type: 'wardrobe_180' as const, label: '衣柜(1.8m)', icon: '🗄️' },
    { type: 'desk' as const, label: '书桌', icon: '📚' },
    { type: 'bookshelf' as const, label: '书架', icon: '📖' },
    { type: 'chair' as const, label: '椅子', icon: '🪑' },
  ];

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'furniture-panel';
    this.container.style.cssText = `
      display: none; position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      z-index: 900; background: #1a1a2e; border-radius: 12px; padding: 16px;
      max-width: 600px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    `;
    document.body.appendChild(this.container);
    this.render();
  }

  private render(): void {
    let html = `<div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center;">`;
    for (const ft of this.furnitureTypes) {
      const dims = FURNITURE_DIMS[ft.type];
      const dimLabel = dims ? `${dims.width}m × ${dims.depth}m` : '';
      html += `<button data-type="${ft.type}" style="
        background:#2a2a3e; border:1px solid #3a3a5e; border-radius:8px;
        padding:8px 14px; color:#e0e0e0; cursor:pointer; font-size:14px;
        display:flex; flex-direction:column; align-items:center; gap:4px;
        min-width:80px;
      ">
        <span style="font-size:20px;">${ft.icon}</span>
        <span>${ft.label}</span>
        <span style="font-size:10px; color:#888;">${dimLabel}</span>
      </button>`;
    }
    html += `</div>`;
    html += `<div style="text-align:center; margin-top:8px; font-size:12px; color:#666;">点击放置 | 按 B 或 Esc 关闭</div>`;
    this.container.innerHTML = html;

    this.container.querySelectorAll('button[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = (btn as HTMLElement).dataset.type!;
        this.onSelectCb?.(type);
      });
    });
  }

  onSelect(cb: (type: string) => void): void { this.onSelectCb = cb; }

  show(): void { this.visible = true; this.container.style.display = 'block'; }
  hide(): void { this.visible = false; this.container.style.display = 'none'; }
  toggle(): void { this.visible ? this.hide() : this.show(); }
  isVisible(): boolean { return this.visible; }
}
