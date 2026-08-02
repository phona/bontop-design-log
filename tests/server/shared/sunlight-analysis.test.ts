import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSunlight } from '../../../shared/sunlight-analysis.js';
import type { WindowAperture, RoomCenter } from '../../../shared/glazing.js';

const NANNING = { location: { latitude: 22.82, longitude: 108.37, timezone: 8 }, obstructionDeg: 0 };
const rooms: RoomCenter[] = [{ id: 'room', x: 0, z: 0 }];

function aperture(azimuthDeg: number): WindowAperture {
  return { id: 'win', roomId: 'room', azimuthDeg, midpoint: { x: 0, z: 0 } };
}

describe('analyzeSunlight', () => {
  it('南向窗冬至全天直射 ≈ 10.6h', () => {
    const [r] = analyzeSunlight([aperture(180)], rooms, { month: 12, day: 22 }, NANNING);
    assert.ok(Math.abs(r.directHours - 10.6) < 0.5, `hours ${r.directHours}`);
    assert.equal(r.westSunWarning, false);
  });

  it('北向窗冬至 0h', () => {
    const [r] = analyzeSunlight([aperture(0)], rooms, { month: 12, day: 22 }, NANNING);
    assert.equal(r.directHours, 0);
  });

  it('西向窗冬至下午直射 ≈ 5.3h 且触发西晒警告', () => {
    const [r] = analyzeSunlight([aperture(270)], rooms, { month: 12, day: 22 }, NANNING);
    assert.ok(Math.abs(r.directHours - 5.3) < 0.6, `hours ${r.directHours}`);
    assert.equal(r.westSunWarning, true);
  });

  it('遮挡角 90° → 0h', () => {
    const [r] = analyzeSunlight([aperture(180)], rooms, { month: 12, day: 22 }, { ...NANNING, obstructionDeg: 90 });
    assert.equal(r.directHours, 0);
  });

  it('同房间双窗时段求并集', () => {
    const aps: WindowAperture[] = [
      { id: 'w1', roomId: 'room', azimuthDeg: 135, midpoint: { x: 0, z: 0 } },
      { id: 'w2', roomId: 'room', azimuthDeg: 225, midpoint: { x: 0, z: 0 } },
    ];
    const [r] = analyzeSunlight(aps, rooms, { month: 12, day: 22 }, NANNING);
    const [single] = analyzeSunlight([aperture(135)], rooms, { month: 12, day: 22 }, NANNING);
    assert.ok(r.directHours > single.directHours);
    for (const [start, end] of r.intervals) {
      assert.ok(end > start);
    }
  });

  it('无窗房间 directHours=0', () => {
    const twoRooms: RoomCenter[] = [{ id: 'room', x: 0, z: 0 }, { id: 'dark', x: 5, z: 5 }];
    const result = analyzeSunlight([aperture(180)], twoRooms, { month: 12, day: 22 }, NANNING);
    const dark = result.find((r) => r.roomId === 'dark');
    assert.ok(dark);
    assert.equal(dark!.directHours, 0);
  });

  it('roomId 为 null 的采光面被忽略', () => {
    const orphan: WindowAperture = { id: 'o', roomId: null, azimuthDeg: 180, midpoint: { x: 0, z: 0 } };
    const [r] = analyzeSunlight([orphan], rooms, { month: 12, day: 22 }, NANNING);
    assert.equal(r.directHours, 0);
  });
});
