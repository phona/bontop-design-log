import { describe, it, expect } from 'vitest';
import { findRoomAt } from './spawn-utils.js';

const rooms = [
  { id: 'living_dining', x: 10.3, z: 7.05, width: 6.2, depth: 5.5 },
  { id: 'master_bedroom', x: 2.1, z: 7.68, width: 4.2, depth: 4.25 },
  { id: 'kitchen', x: 9.0, z: 2.15, width: 3.6, depth: 4.3 },
];

describe('findRoomAt', () => {
  it('returns the room whose bbox contains the point', () => {
    const r = findRoomAt({ x: 10.3, z: 7.0 }, rooms);
    expect(r).not.toBeNull();
    expect(r!.id).toBe('living_dining');
  });

  it('returns the exact room for master bedroom center', () => {
    const r = findRoomAt({ x: 2.1, z: 7.68 }, rooms);
    expect(r!.id).toBe('master_bedroom');
  });

  it('returns null when point is outside all rooms (void)', () => {
    expect(findRoomAt({ x: 50, z: 50 }, rooms)).toBeNull();
  });

  it('returns null when point is in a wall gap between rooms', () => {
    expect(findRoomAt({ x: 6.0, z: 7.0 }, rooms)).toBeNull();
  });

  it('returns null for empty room list', () => {
    expect(findRoomAt({ x: 10.3, z: 7.0 }, [])).toBeNull();
  });

  it('returned room exposes its center coordinates', () => {
    const r = findRoomAt({ x: 9.0, z: 2.15 }, rooms);
    expect(r!.x).toBeCloseTo(9.0);
    expect(r!.z).toBeCloseTo(2.15);
  });
});
