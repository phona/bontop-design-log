import { describe, it, expect } from 'vitest';
import { mulberry32 } from './seeded-rng';

describe('seeded-rng (mulberry32)', () => {
  it('同 seed 序列逐值一致', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('异 seed 序列不同', () => {
    const a = mulberry32(42);
    const b = mulberry32(7);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('输出落在 [0,1)', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
