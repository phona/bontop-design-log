export interface HoverTarget {
  objectId: string;
  name: string;
  type: string;
  room?: string;
  curtainId?: string;
  curtainKind?: 'sheer_blackout' | 'blinds';
  layer?: 'sheer' | 'blackout' | 'blinds';
}

export class HoverTooltip {
  private el: HTMLDivElement;
  private current: HoverTarget | null = null;

  constructor(elementId = 'hover-tooltip') {
    this.el = document.getElementById(elementId) as HTMLDivElement;
  }

  update(target: HoverTarget | null) {
    if (target?.objectId === this.current?.objectId) return;
    this.current = target;
    if (!target) {
      this.el.style.display = 'none';
      this.el.textContent = '';
      return;
    }
    this.el.style.display = 'block';
    this.el.textContent = target.name;
  }

  clear() {
    this.update(null);
  }

  getCurrent(): HoverTarget | null {
    return this.current;
  }
}
