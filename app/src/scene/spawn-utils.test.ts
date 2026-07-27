import { describe, it, expect } from 'vitest';
import { pickSpawnRoom } from './spawn-utils.js';

const rooms = [
  { id: 'living_dining', x: 10.3, z: 7.05, width: 6.2, depth: 5.5 },
  { id: 'master_bedroom', x: 2.1, z: 7.68, width: 4.2, depth: 4.25 },
  { id: 'kitchen', x: 9.0, z: 2.15, width: 3.6, depth: 4.3 },
];

const fallback = { x: 10.3, z: 7.05 };

describe('pickSpawnRoom', () => {
  it('returns target coords when target is inside a room bbox', () => {
    const result = pickSpawnRoom({ x: 10.3, z: 7.0 }, rooms, fallback);
    expect(result.x).toBeCloseTo(10.3);
    expect(result.z).toBeCloseTo(7.0);
  });

  it('returns fallback when target is outside all rooms (orbit focus in void)', () => {
    const result = pickSpawnRoom({ x: 50, z: 50 }, rooms, fallback);
    expect(result.x).toBeCloseTo(fallback.x);
    expect(result.z).toBeCloseTo(fallback.z);
  });

  it('returns fallback when target is on a wall gap between rooms', () => {
    const result = pickSpawnRoom({ x: 6.0, z: 7.0 }, rooms, fallback);
    expect(result.x).toBeCloseTo(fallback.x);
    expect(result.z).toBeCloseTo(fallback.z);
  });

  it('returns fallback when rooms list is empty', () => {
    const result = pickSpawnRoom({ x: 10.3, z: 7.0 }, [], fallback);
    expect(result.x).toBeCloseTo(fallback.x);
    expect(result.z).toBeCloseTo(fallback.z);
  });

  it('returns origin when no match and no fallback', () => {
    const result = pickSpawnRoom({ x: 50, z: 50 }, rooms, null);
    expect(result.x).toBe(0);
    expect(result.z).toBe(0);
  });

  it('picks the room whose bbox contains the target (master bedroom)', () => {
    const result = pickSpawnRoom({ x: 2.1, z: 7.68 }, rooms, fallback);
    expect(result.x).toBeCloseTo(2.1);
    expect(result.z).toBeCloseTo(7.68);
  });
});
