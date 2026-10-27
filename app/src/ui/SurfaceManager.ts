/**
 * 面板生命周期总管：一次只开一个、点画布/Esc 一键清场、可钉住。
 *
 * 取代两类旧行为：① Popover 的“粘性”默认（点场景不收起，只有 Esc/再点开关才收）；
 * ② App 里硬编码的 Esc 链。管理器只编排开合，不拥有任何面板 DOM——
 * 各面板的 open/close/isOpen 由既有组件提供，element id 与 body class 契约不变。
 *
 * 语义：
 * - 同 slot 互斥（左抽屉/右 dock/浮层/面板四类）；modal 打开时收起其它全部。
 * - 单击画布（pointerdown 目标不在任何已注册表面及其开关内）→ 收起全部 transient
 *   且未钉住的表面。
 * - Esc → 收起全部表面（含钉住）；非表面动作（退出放置/拖拽模式）由 App 接力。
 * - 钉住豁免画布清场，但不豁免 Esc。
 */
export type SurfaceSlot = 'left-drawer' | 'right-dock' | 'popover' | 'panel' | 'modal';

export interface Surface {
  id: string;
  slot: SurfaceSlot;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  /** 默认 true。false 的表面不参与画布清场（预留：常驻 HUD 不注册为 surface）。 */
  transient?: boolean;
  pinAllowed?: boolean;
  /** 表面根元素：判断点击是否落在表面内 */
  el?: HTMLElement | null;
  /** 开关按钮：点上它不清场（交给按钮自己的 toggle 逻辑） */
  toggleEl?: HTMLElement | null;
}

export class SurfaceManager {
  private readonly surfaces = new Map<string, Surface>();
  private readonly pinned = new Set<string>();

  register(surface: Surface): void {
    this.surfaces.set(surface.id, surface);
  }

  registerAll(surfaces: Surface[]): void {
    for (const surface of surfaces) this.register(surface);
  }

  get(id: string): Surface | undefined {
    return this.surfaces.get(id);
  }

  list(): Surface[] {
    return Array.from(this.surfaces.values());
  }

  isPinned(id: string): boolean {
    return this.pinned.has(id);
  }

  isOpen(id: string): boolean {
    return this.surfaces.get(id)?.isOpen() ?? false;
  }

  setPinned(id: string, pinned: boolean): void {
    if (pinned) this.pinned.add(id);
    else this.pinned.delete(id);
  }

  /** 打开表面：同 slot 互斥；modal 打开时先清场其它全部。 */
  open(id: string): void {
    const surface = this.surfaces.get(id);
    if (!surface) return;
    for (const other of this.surfaces.values()) {
      if (other.id === id) continue;
      const sameSlot = other.slot === surface.slot;
      const modalWins = surface.slot === 'modal';
      if (sameSlot || modalWins) {
        if (other.isOpen()) other.close();
      }
    }
    surface.open();
  }

  close(id: string): void {
    this.surfaces.get(id)?.close();
  }

  toggle(id: string): void {
    const surface = this.surfaces.get(id);
    if (!surface) return;
    if (surface.isOpen()) surface.close();
    else this.open(id);
  }

  /** 画布单击：收起全部 transient 且未钉住的表面。返回是否有表面被收起。 */
  dismissTransient(target: EventTarget | null): boolean {
    let closed = false;
    for (const surface of this.surfaces.values()) {
      if (!surface.isOpen()) continue;
      if (surface.transient === false) continue;
      if (this.pinned.has(surface.id)) continue;
      if (target && this.ownsTarget(surface, target)) continue;
      surface.close();
      closed = true;
    }
    return closed;
  }

  /** Esc：收起全部表面（含钉住）。返回是否有表面被收起。 */
  dismissAll(): boolean {
    let closed = false;
    for (const surface of this.surfaces.values()) {
      if (surface.isOpen()) {
        surface.close();
        closed = true;
      }
    }
    return closed;
  }

  /** 点击是否落在某表面内部或其开关上（不清场的判据）。 */
  private ownsTarget(surface: Surface, target: EventTarget): boolean {
    const node = target as Node | null;
    if (!node || typeof node.contains !== 'function') return false;
    if (surface.el && node === surface.el) return true;
    if (surface.el && surface.el.contains(node)) return true;
    if (surface.toggleEl && (node === surface.toggleEl || surface.toggleEl.contains(node))) return true;
    return false;
  }
}
