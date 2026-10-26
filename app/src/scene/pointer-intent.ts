/**
 * 点按 / 拖拽判别：触屏与鼠标共用的手势判定。
 *
 * 背景：画布 pointerdown 立刻 raycast 拾取的旧行为，在触摸端意味着每次想旋转
 * 相机都会先弹出对象信息。现在 pointerdown 只记录，pointerup 时位移 ≤ slopPx
 * 且时长 ≤ timeoutMs 才判 tap（拾取 + 面板清场）；超过即拖拽（转向/环轨）。
 */
export type PointerGesture = 'tap' | 'drag';

const DEFAULT_SLOP_PX = 10;
const DEFAULT_TIMEOUT_MS = 400;

export class PointerIntent {
  private down: { x: number; y: number; t: number } | null = null;
  private readonly slopPx: number;
  private readonly timeoutMs: number;

  constructor(opts: { slopPx?: number; timeoutMs?: number } = {}) {
    this.slopPx = opts.slopPx ?? DEFAULT_SLOP_PX;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  begin(x: number, y: number): void {
    this.down = { x, y, t: Date.now() };
  }

  /** 结束手势并判定；没有进行中的手势返回 null。 */
  end(x: number, y: number): PointerGesture | null {
    const start = this.down;
    this.down = null;
    if (!start) return null;
    const dist = Math.hypot(x - start.x, y - start.y);
    if (dist > this.slopPx) return 'drag';
    if (Date.now() - start.t > this.timeoutMs) return 'drag';
    return 'tap';
  }

  /** 进行中手势已移动超过阈值（供拖拽实时消费） */
  hasDragged(x: number, y: number): boolean {
    if (!this.down) return false;
    return Math.hypot(x - this.down.x, y - this.down.y) > this.slopPx;
  }

  cancel(): void {
    this.down = null;
  }
}
