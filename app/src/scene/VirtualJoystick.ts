/**
 * 虚拟摇杆（移动端第一人称）：左下触控区，pointer 事件输出归一化向量。
 * 仅 FP 模式 + 触摸主输入时显示；输出映射进 FirstPersonController 的
 * MovementKeys（死区外为按下），桌面 WASD 路径不受影响。
 */
export class VirtualJoystick {
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private active = false;
  private pointerId: number | null = null;
  private vector = { x: 0, y: 0 };
  /** 死区：向量分量绝对值 ≤ 此值不产生移动 */
  private readonly deadZone = 0.22;

  onChange: ((x: number, y: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.base = document.createElement('div');
    this.base.id = 'virtual-joystick';
    this.base.style.cssText = `
      position: absolute; left: 18px; bottom: 84px; width: 120px; height: 120px;
      border-radius: 50%; border: 1px solid rgba(255,255,255,0.18);
      background: rgba(16,18,25,0.6); touch-action: none; z-index: 155;
      display: none; user-select: none; -webkit-user-select: none;
    `;
    this.knob = document.createElement('div');
    this.knob.style.cssText = `
      position: absolute; left: 50%; top: 50%; width: 48px; height: 48px;
      border-radius: 50%; background: rgba(96,165,250,0.5);
      border: 1px solid rgba(59,130,246,0.7); transform: translate(-50%,-50%);
    `;
    this.base.appendChild(this.knob);
    parent.appendChild(this.base);

    this.base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.active = true;
      this.pointerId = e.pointerId;
      this.base.setPointerCapture(e.pointerId);
      this.applyFromEvent(e);
    });
    this.base.addEventListener('pointermove', (e) => {
      if (!this.active || e.pointerId !== this.pointerId) return;
      this.applyFromEvent(e);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.active = false;
      this.pointerId = null;
      this.vector = { x: 0, y: 0 };
      this.knob.style.transform = 'translate(-50%,-50%)';
      this.onChange?.(0, 0);
    };
    this.base.addEventListener('pointerup', release);
    this.base.addEventListener('pointercancel', release);
  }

  private applyFromEvent(e: PointerEvent): void {
    const rect = this.base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = rect.width / 2 - 20;
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.vector = { x: dx / max, y: dy / max };
    this.onChange?.(this.vector.x, this.vector.y);
  }

  /** 当前是否产生某一方向移动（死区外） */
  isPressed(direction: 'forward' | 'backward' | 'left' | 'right'): boolean {
    const { x, y } = this.vector;
    switch (direction) {
      case 'forward': return y <= -this.deadZone;
      case 'backward': return y >= this.deadZone;
      case 'left': return x <= -this.deadZone;
      case 'right': return x >= this.deadZone;
    }
  }

  getVector(): { x: number; y: number } {
    return this.vector;
  }

  setVisible(visible: boolean): void {
    this.base.style.display = visible ? 'block' : 'none';
    if (!visible && this.active) {
      this.active = false;
      this.pointerId = null;
      this.vector = { x: 0, y: 0 };
      this.onChange?.(0, 0);
    }
  }

  dispose(): void {
    this.base.remove();
  }
}
