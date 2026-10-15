export type PreviewWorkbenchPage = 'object' | 'material' | 'lighting';

const PAGE_LABELS: Record<PreviewWorkbenchPage, string> = {
  object: '对象',
  material: '材质',
  lighting: '灯光',
};

/** Single right dock for contextual object information and temporary visual previews. */
export class PreviewWorkbench {
  private root: HTMLElement;
  private buttons = new Map<PreviewWorkbenchPage, HTMLButtonElement>();
  private pages = new Map<PreviewWorkbenchPage, HTMLElement>();
  private activePage: PreviewWorkbenchPage = 'material';
  private open = true;
  private firstPerson = false;
  private wasOpenBeforeFirstPerson = true;

  constructor(root: HTMLElement) {
    this.root = root;
    for (const page of Object.keys(PAGE_LABELS) as PreviewWorkbenchPage[]) {
      const button = root.querySelector<HTMLButtonElement>(`[data-workbench-tab="${page}"]`);
      const content = root.querySelector<HTMLElement>(`[data-workbench-page="${page}"]`);
      if (!button || !content) throw new Error(`PreviewWorkbench: missing ${page} tab/page`);
      button.textContent = PAGE_LABELS[page];
      button.onclick = () => this.activate(page);
      this.buttons.set(page, button);
      this.pages.set(page, content);
    }
    root.querySelector<HTMLButtonElement>('[data-workbench-close]')!.onclick = () => this.setOpen(false);
    document.getElementById('workbench-reopen')!.addEventListener('click', () => this.setOpen(true));
    this.activate('material', false);
    this.setOpen(true, false);
  }

  activate(page: PreviewWorkbenchPage, reveal = true): void {
    if (reveal) this.setOpen(true);
    this.activePage = page;
    for (const [key, button] of this.buttons) {
      const active = key === page;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const [key, content] of this.pages) content.hidden = key !== page;
  }

  setOpen(open: boolean, resize = true): void {
    this.open = open;
    document.body.classList.toggle('workbench-open', open);
    document.body.classList.toggle('workbench-closed', !open);
    this.root.setAttribute('aria-hidden', String(!open));
    if (resize) this.requestResize();
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

  getActivePage(): PreviewWorkbenchPage {
    return this.activePage;
  }

  focusSunlight(): void {
    this.activate('lighting');
    const section = document.getElementById('lighting-sunlight-section') as HTMLDetailsElement | null;
    if (!section) return;
    section.open = true;
    requestAnimationFrame(() => section.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  private requestResize(): void {
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
}
