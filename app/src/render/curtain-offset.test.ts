import { describe, it, expect } from 'vitest';
import { offsetCurtainPointsInterior } from './curtain-offset.js';
import { offsetCurtainPointsInterior as sharedOffsetCurtainPointsInterior } from '@shared/render/CurtainGeometry';

describe('offsetCurtainPointsInterior', () => {
  it('is the shared geometry compatibility entry', () => {
    expect(offsetCurtainPointsInterior).toBe(sharedOffsetCurtainPointsInterior);
  });

  it('preserves shared offset behavior', () => {
    const pts = [{ x: 7.2, z: 9.8 }, { x: 13.4, z: 9.8 }];
    const out = offsetCurtainPointsInterior(pts, [{ x: 10.3, z: 7.0 }], 0.12);
    for (const p of out) {
      expect(p.z).toBeCloseTo(9.68, 5);
      expect(p.x).toBeCloseTo(pts[out.indexOf(p)].x, 5);
    }
  });

  it('handles reversed walls and preserves arc metadata', () => {
    const reversed = offsetCurtainPointsInterior([{ x: 13.4, z: 9.8 }, { x: 7.2, z: 9.8 }], [{ x: 10.3, z: 11.0 }], 0.12);
    expect(reversed[0].z).toBeCloseTo(9.92, 5);
    const withArc = offsetCurtainPointsInterior([{ x: 0, z: 0, radius: 1, cx: 0.5, cz: -0.5 }, { x: 1, z: 0 }], [{ x: 0.5, z: 1 }]);
    expect(withArc[0]).toMatchObject({ radius: 1, cx: 0.5, cz: -0.38 });
    expect(offsetCurtainPointsInterior([{ x: 0, z: 0 }], [{ x: 0, z: 1 }])).toHaveLength(1);
    expect(offsetCurtainPointsInterior(withArc, [], 0.12)).toBe(withArc);
  });
});
