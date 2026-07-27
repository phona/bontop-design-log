import { describe, it, expect } from 'vitest';
import { findRoomAt, pickRoomIdFromHits, resolveSpawnRoom } from './spawn-utils.js';

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

describe('pickRoomIdFromHits', () => {
  it('returns roomId of first floor hit', () => {
    const hits = [{ roomId: 'kitchen', type: 'floor' }];
    expect(pickRoomIdFromHits(hits)).toBe('kitchen');
  });

  it('accepts floor_region type', () => {
    const hits = [{ roomId: 'corridor', type: 'floor_region' }];
    expect(pickRoomIdFromHits(hits)).toBe('corridor');
  });

  it('skips wall hits and returns the floor behind it', () => {
    const hits = [
      { roomId: 'kitchen', type: 'wall' },
      { roomId: 'living_dining', type: 'floor' },
    ];
    expect(pickRoomIdFromHits(hits)).toBe('living_dining');
  });

  it('skips furniture / electrical / unknown types', () => {
    const hits = [
      { roomId: 'living_dining', type: 'furniture' },
      { roomId: 'living_dining', type: 'electrical' },
      { roomId: 'living_dining', type: 'floor' },
    ];
    expect(pickRoomIdFromHits(hits)).toBe('living_dining');
  });

  it('excludes elevator_shaft even if typed floor', () => {
    const hits = [
      { roomId: 'elevator_shaft', type: 'floor' },
      { roomId: 'kitchen', type: 'floor' },
    ];
    expect(pickRoomIdFromHits(hits)).toBe('kitchen');
  });

  it('returns null when no qualifying hit', () => {
    expect(pickRoomIdFromHits([{ roomId: 'kitchen', type: 'wall' }])).toBeNull();
    expect(pickRoomIdFromHits([])).toBeNull();
    expect(pickRoomIdFromHits([{}])).toBeNull();
  });
});

describe('resolveSpawnRoom', () => {
  const fallback = rooms.find((r) => r.id === 'living_dining')!;

  it('prefers pointer room over target room', () => {
    const r = resolveSpawnRoom('master_bedroom', { x: 9.0, z: 2.15 }, rooms, fallback);
    expect(r!.id).toBe('master_bedroom');
  });

  it('falls back to target room when pointer room misses', () => {
    const r = resolveSpawnRoom(null, { x: 9.0, z: 2.15 }, rooms, fallback);
    expect(r!.id).toBe('kitchen');
  });

  it('falls back to default when both pointer and target miss', () => {
    const r = resolveSpawnRoom(null, { x: 50, z: 50 }, rooms, fallback);
    expect(r!.id).toBe('living_dining');
  });

  it('ignores pointerRoomId that is not in rooms list', () => {
    const r = resolveSpawnRoom('ghost_room', { x: 9.0, z: 2.15 }, rooms, fallback);
    expect(r!.id).toBe('kitchen');
  });

  it('returns null fallback when nothing matches and no fallback', () => {
    const r = resolveSpawnRoom(null, { x: 50, z: 50 }, rooms, null);
    expect(r).toBeNull();
  });
});
