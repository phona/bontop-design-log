import { describe, expect, it } from 'vitest';
import { gatheredCurtainSegments, sampleCurtainTrack } from './curtain-track.js';
import * as sharedCurtainGeometry from '@shared/render/CurtainGeometry';

describe('curtain track geometry', () => {
  it('uses shared track functions through the compatibility entry', () => {
    expect(sampleCurtainTrack).toBe(sharedCurtainGeometry.sampleCurtainTrack);
    expect(gatheredCurtainSegments).toBe(sharedCurtainGeometry.gatheredCurtainSegments);
  });

  it('samples rounded tracks with cumulative arc length', () => {
    const track = sampleCurtainTrack([{ x: 0, z: 0 }, { x: 2, z: 0, radius: 0.5 }, { x: 2, z: 2 }]);
    expect(track.length).toBeGreaterThan(4);
    expect(track.at(-1)?.distance).toBeGreaterThan(3);
    for (let i = 1; i < track.length; i++) expect(track[i].distance).toBeGreaterThan(track[i - 1].distance);
  });

  it('gathers only at both endpoints and leaves the middle exposed', () => {
    const [left, right] = gatheredCurtainSegments([{ x: 0, z: 0 }, { x: 10, z: 0 }]);
    expect(left[0].x).toBeCloseTo(0);
    expect(left.at(-1)?.x).toBeLessThan(1);
    expect(right[0].x).toBeGreaterThan(9);
    expect(right.at(-1)?.x).toBeCloseTo(10);
  });
});
