import { describe, it, expect } from 'vitest';
import { CollisionDetector } from './CollisionDetector.js';
import type { RoomLayout } from '@shared/types';

const simpleRooms: RoomLayout[] = [
  { id: 'room_a', name: 'A', x: 0, z: 0, width: 4, depth: 4, height: 3, type: 'public' },
];

describe('CollisionDetector', () => {
  it('allows movement in open space', () => {
    const cd = new CollisionDetector(simpleRooms);
    const result = cd.tryMove({ x: 0, y: 1.6, z: 0 }, { x: 0.5, y: 1.6, z: 0.5 });
    expect(result.x).toBeCloseTo(0.5);
    expect(result.z).toBeCloseTo(0.5);
  });

  it('blocks movement through north wall', () => {
    const cd = new CollisionDetector(simpleRooms);
    const from = { x: 0, y: 1.6, z: -1.6 };
    const desired = { x: 0, y: 1.6, z: -2.0 };
    const result = cd.tryMove(from, desired);
    expect(result.z).toBeCloseTo(-1.6);
  });

  it('slides along wall on X axis when Z is blocked', () => {
    const cd = new CollisionDetector(simpleRooms);
    const from = { x: 1.0, y: 1.6, z: -1.6 };
    const desired = { x: 1.3, y: 1.6, z: -2.0 };
    const result = cd.tryMove(from, desired);
    expect(result.x).toBeCloseTo(1.3);
    expect(result.z).toBeCloseTo(-1.6);
  });

  it('preserves Y coordinate', () => {
    const cd = new CollisionDetector(simpleRooms);
    const result = cd.tryMove({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 2.0, z: 0 });
    expect(result.y).toBeCloseTo(2.0);
  });

  it('returns from position when fully blocked', () => {
    const cd = new CollisionDetector(simpleRooms);
    const from = { x: 0, y: 1.6, z: -1.6 };
    const desired = { x: 0, y: 1.6, z: -2.0 };
    const result = cd.tryMove(from, desired);
    expect(result.x).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(-1.6);
  });

  it('exposes wall AABBs', () => {
    const cd = new CollisionDetector(simpleRooms);
    expect(cd.getWalls().length).toBe(4);
  });
});
