import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PointerIntent } from './pointer-intent.js';

describe('PointerIntent', () => {
  it('位移与时长都在阈值内 → tap', () => {
    const intent = new PointerIntent({ slopPx: 10, timeoutMs: 400 });
    intent.begin(100, 100);
    expect(intent.end(105, 103)).toBe('tap');
  });

  it('位移超阈值 → drag', () => {
    const intent = new PointerIntent({ slopPx: 10 });
    intent.begin(100, 100);
    expect(intent.end(140, 100)).toBe('drag');
  });

  it('无进行中手势时 end 返回 null', () => {
    const intent = new PointerIntent();
    expect(intent.end(0, 0)).toBeNull();
  });

  it('begin 后 end 消费掉手势（不会二次判定）', () => {
    const intent = new PointerIntent();
    intent.begin(0, 0);
    expect(intent.end(1, 1)).toBe('tap');
    expect(intent.end(1, 1)).toBeNull();
  });

  it('cancel 后不判定', () => {
    const intent = new PointerIntent();
    intent.begin(0, 0);
    intent.cancel();
    expect(intent.end(1, 1)).toBeNull();
  });

  it('hasDragged 反映实时位移阈值', () => {
    const intent = new PointerIntent({ slopPx: 10 });
    intent.begin(0, 0);
    expect(intent.hasDragged(5, 5)).toBe(false);
    expect(intent.hasDragged(30, 0)).toBe(true);
  });
});
