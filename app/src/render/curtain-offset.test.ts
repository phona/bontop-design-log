import { describe, it, expect } from 'vitest';
import { offsetCurtainPointsInterior } from './curtain-offset.js';

describe('offsetCurtainPointsInterior', () => {
  it('东向墙、北侧房间 → 向北（-z）偏移 12cm', () => {
    // w_liv_south：z=9.8 东西走向，客厅在北（z<9.8）
    const pts = [{ x: 7.2, z: 9.8 }, { x: 13.4, z: 9.8 }];
    const out = offsetCurtainPointsInterior(pts, [{ x: 10.3, z: 7.0 }], 0.12);
    for (const p of out) {
      expect(p.z).toBeCloseTo(9.68, 5);
      expect(p.x).toBeCloseTo(pts[out.indexOf(p)].x, 5);
    }
  });

  it('西向墙（点序反向）、南侧房间 → 向南（+z）偏移', () => {
    const pts = [{ x: 13.4, z: 9.8 }, { x: 7.2, z: 9.8 }];
    const out = offsetCurtainPointsInterior(pts, [{ x: 10.3, z: 11.0 }], 0.12);
    for (const p of out) {
      expect(p.z).toBeCloseTo(9.92, 5);
    }
  });

  it('北向竖墙、东侧房间 → 向东（+x）偏移', () => {
    // w_west_upper：x=0 南北走向（北向南），主卧在东（x>0）
    const pts = [{ x: 0, z: 5.55 }, { x: 0, z: 9.8 }];
    const out = offsetCurtainPointsInterior(pts, [{ x: 2.1, z: 7.6 }], 0.12);
    for (const p of out) {
      expect(p.x).toBeCloseTo(0.12, 5);
    }
  });

  it('保留 radius 字段，缺省 offset=0.12，边界输入原样返回', () => {
    const pts = [{ x: 0, z: 0, radius: 1.0 }, { x: 1, z: 0 }];
    const out = offsetCurtainPointsInterior(pts, [{ x: 0.5, z: 1 }]);
    expect(out[0].radius).toBe(1.0);
    expect(out[0].z).toBeCloseTo(0.12, 5);
    expect(offsetCurtainPointsInterior([{ x: 0, z: 0 }], [{ x: 0, z: 1 }])).toHaveLength(1);
    expect(offsetCurtainPointsInterior(pts, [], 0.12)).toBe(pts);
  });
});
