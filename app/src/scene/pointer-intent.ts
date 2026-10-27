/**
 * 点按 / 拖拽判别：触屏与鼠标共用的手势判定。
 *
 * 背景：画布 pointerdown 立刻 raycast 拾取的旧行为，在触摸端意味着每次想旋转
 * 相机都会先弹出对象信息。现在 pointerdown 只记录，pointerup 时位移 ≤ slopPx
 * 判为 tap（拾取 + 面板清场）；超过即拖拽（转向/环轨）。
 *
 * 2026-10-27 修订：判定只由位移决定，不设时长门槛。原因：CDP 实测发现某些
 * 环境下 pointerup 可比 pointerdown 晚 400ms+ 到达（headless 合成输入即如此），
 * 真实用户的慢触（按住看清再松手）同理——带时长门槛会把它们误判成 drag，
 * 面板收不回去。按住不动始终是 tap，与按钮 click 语义一致。
 */
export type PointerGesture = 'tap' | 'drag';

const DEFAULT_SLOP_PX = 10;

export class PointerIntent {
  private down: { x: number; y: number } | null = null;
  private readonly slopPx: number;

  constructor(opts: { slopPx?: number } = {}) {
    this.slopPx = opts.slopPx ?? DEFAULT_SLOP_PX;
  }

  begin(x: number, y: number): void {
    this.down = { x, y };
  }

  /** 结束手势并判定；没有进行中的手势返回 null。 */
  end(x: number, y: number): PointerGesture | null {
    const start = this.down;
    this.down = null;
    if (!start) return null;
    return Math.hypot(x - start.x, y - start.y) > this.slopPx ? 'drag' : 'tap';
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
