import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VirtualJoystick } from './VirtualJoystick.js';

/** jsdom 没有 PointerEvent 构造；用 MouseEvent 承载 pointer 事件字段。 */
function firePointer(el: HTMLElement, type: string, init: { clientX: number; clientY: number; pointerId?: number }): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX, clientY: init.clientY });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  el.dispatchEvent(event);
}

/** getBoundingClientRect 在 jsdom 恒为 0；给 base 打桩。 */
function stubRect(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }): void {
  el.getBoundingClientRect = () => ({
    left: rect.left, top: rect.top, width: rect.width, height: rect.height,
    right: rect.left + rect.width, bottom: rect.top + rect.height,
    x: rect.left, y: rect.top, toJSON: () => ({}),
  }) as DOMRect;
}

describe('VirtualJoystick', () => {
  let parent: HTMLElement;
  let joystick: VirtualJoystick;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    parent = document.getElementById('app')!;
    joystick = new VirtualJoystick(parent);
    stubRect(parent.querySelector<HTMLElement>('#virtual-joystick')!, { left: 0, top: 700, width: 120, height: 120 });
  });

  afterEach(() => {
    joystick.dispose();
    document.body.innerHTML = '';
  });

  function base(): HTMLElement {
    return parent.querySelector<HTMLElement>('#virtual-joystick')!;
  }

  it('挂到父容器且默认隐藏', () => {
    expect(base()).toBeTruthy();
    expect(base().style.display).toBe('none');
  });

  it('setVisible 切换显隐', () => {
    joystick.setVisible(true);
    expect(base().style.display).toBe('block');
    joystick.setVisible(false);
    expect(base().style.display).toBe('none');
  });

  it('拖动输出归一化向量：上推为 forward（y 负）', () => {
    const seen: Array<{ x: number; y: number }> = [];
    joystick.onChange = (x, y) => seen.push({ x, y });
    joystick.setVisible(true);
    firePointer(base(), 'pointerdown', { clientX: 60, clientY: 760 });
    firePointer(base(), 'pointermove', { clientX: 60, clientY: 720 }); // 上推 40px（max=40）
    const last = seen[seen.length - 1];
    expect(last.y).toBeCloseTo(-1, 1);
    expect(joystick.isPressed('forward')).toBe(true);
    expect(joystick.isPressed('backward')).toBe(false);
  });

  it('右下推产生 right + backward', () => {
    joystick.setVisible(true);
    firePointer(base(), 'pointerdown', { clientX: 60, clientY: 760 });
    firePointer(base(), 'pointermove', { clientX: 100, clientY: 800 });
    expect(joystick.isPressed('right')).toBe(true);
    expect(joystick.isPressed('backward')).toBe(true);
    expect(joystick.isPressed('forward')).toBe(false);
  });

  it('松手回零并回调 (0,0)', () => {
    const seen: Array<{ x: number; y: number }> = [];
    joystick.onChange = (x, y) => seen.push({ x, y });
    joystick.setVisible(true);
    firePointer(base(), 'pointerdown', { clientX: 60, clientY: 760 });
    firePointer(base(), 'pointermove', { clientX: 60, clientY: 720 });
    firePointer(base(), 'pointerup', { clientX: 60, clientY: 720 });
    const last = seen[seen.length - 1];
    expect(last).toEqual({ x: 0, y: 0 });
    expect(joystick.getVector()).toEqual({ x: 0, y: 0 });
  });

  it('死区内不产生任何方向', () => {
    joystick.setVisible(true);
    firePointer(base(), 'pointerdown', { clientX: 60, clientY: 760 });
    firePointer(base(), 'pointermove', { clientX: 64, clientY: 762 }); // 微动
    expect(joystick.isPressed('forward')).toBe(false);
    expect(joystick.isPressed('right')).toBe(false);
  });

  it('隐藏时进行中的手势被重置', () => {
    joystick.setVisible(true);
    firePointer(base(), 'pointerdown', { clientX: 60, clientY: 760 });
    firePointer(base(), 'pointermove', { clientX: 60, clientY: 720 });
    joystick.setVisible(false);
    expect(joystick.getVector()).toEqual({ x: 0, y: 0 });
  });
});
