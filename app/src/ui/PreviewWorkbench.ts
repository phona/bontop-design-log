export type PreviewWorkbenchPage = 'object' | 'material' | 'lighting';

/** Single right dock for contextual object information and temporary visual previews. */
export class PreviewWorkbench {
  private root: HTMLElement;
  private headers = new Map<PreviewWorkbenchPage, HTMLButtonElement>();
  private panels = new Map<PreviewWorkbenchPage, HTMLElement>();
  private activePage: PreviewWorkbenchPage | null = 'material';
  /** 开合/切页变化回调（App 用于持久化） */
  onChange: ((state: { open: boolean; page: PreviewWorkbenchPage | null }) => void) | null = null;
  // 画布优先：工作台默认收起，由 activate()/focusSunlight()/「预演」按钮按需呼出
  private open = false;
  private firstPerson = false;
  private wasOpenBeforeFirstPerson = false;

  constructor(root: HTMLElement) {
    this.root = root;
    for (const page of ['object', 'material', 'lighting'] as const) {
      const header = root.querySelector<HTMLButtonElement>(`[data-workbench-toggle="${page}"]`);
      const panel = root.querySelector<HTMLElement>(`[data-workbench-content="${page}"]`);
      if (!header || !panel) throw new Error(`PreviewWorkbench: missing ${page} accordion item`);
      header.onclick = () => this.toggle(page);
      this.headers.set(page, header);
      this.panels.set(page, panel);
    }
    root.querySelector<HTMLButtonElement>('[data-workbench-close]')!.onclick = () => this.setOpen(false);
    document.getElementById('workbench-reopen')!.addEventListener('click', () => this.setOpen(true));
    this.syncActivePage();
    this.setOpen(false);
  }

  activate(page: PreviewWorkbenchPage, reveal = true): void {
    if (reveal) this.setOpen(true);
    this.activePage = page;
    this.syncActivePage();
    this.scrollContentToTop();
    this.emitChange();
  }

  private toggle(page: PreviewWorkbenchPage): void {
    this.activePage = this.activePage === page ? null : page;
    this.syncActivePage();
    this.scrollContentToTop();
    this.emitChange();
  }

  private syncActivePage(): void {
    for (const page of ['object', 'material', 'lighting'] as const) {
      const active = this.activePage === page;
      const header = this.headers.get(page)!;
      header.classList.toggle('active', active);
      header.setAttribute('aria-expanded', String(active));
      this.panels.get(page)!.hidden = !active;
    }
    const actions = document.getElementById('material-preview-actions');
    if (actions) actions.hidden = this.activePage !== 'material';
  }

  private scrollContentToTop(): void {
    const scroll = this.root.querySelector<HTMLElement>('#workbench-scroll');
    if (scroll) scroll.scrollTop = 0;
  }

  // 开合不再触发画布 resize：工作台是 fixed 悬浮层，画布尺寸不随开合变化；
  // 派发 resize 会让 renderer 重设尺寸并清屏，与画布 CSS 尺寸逐帧变化叠加导致闪烁。
  setOpen(open: boolean): void {
    this.open = open;
    document.body.classList.toggle('workbench-open', open);
    document.body.classList.toggle('workbench-closed', !open);
    this.root.setAttribute('aria-hidden', String(!open));
    this.emitChange();
  }

  private emitChange(): void {
    this.onChange?.({ open: this.open, page: this.activePage });
  }

  setFirstPerson(active: boolean): void {
    if (active === this.firstPerson) return;
    this.firstPerson = active;
    if (active) {
      this.wasOpenBeforeFirstPerson = this.open;
      this.setOpen(false);
      return;
    }
    this.setOpen(this.wasOpenBeforeFirstPerson);
  }

  isOpen(): boolean {
    return this.open;
  }

  focusSunlight(): void {
    this.activate('lighting');
    const section = document.getElementById('lighting-sunlight-section') as HTMLDetailsElement | null;
    if (!section) return;
    section.open = true;
    requestAnimationFrame(() => {
      const scroll = this.root.querySelector<HTMLElement>('#workbench-scroll');
      const summary = section.querySelector<HTMLElement>('summary');
      if (!scroll || !summary) return;
      const summaryTop = summary.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      scroll.scrollTop = Math.min(maxScroll, Math.max(0, summaryTop - 8));
    });
  }
}
