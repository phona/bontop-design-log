import { describe, it, expect } from 'vitest';
import { CollisionDetector } from './CollisionDetector.js';
import type { WallSegment } from '@shared/types';

const simpleWalls: WallSegment[] = [
  { id: 'north', x1: -2, z1: -2, x2: 2, z2: -2 },
  { id: 'south', x1: 2, z1: 2, x2: -2, z2: 2 },
  { id: 'east', x1: 2, z1: -2, x2: 2, z2: 2 },
  { id: 'west', x1: -2, z1: 2, x2: -2, z2: -2 },
];

describe('CollisionDetector', () => {
  it('allows movement in open space', () => {
    const cd = new CollisionDetector(simpleWalls);
    const result = cd.tryMove({ x: 0, y: 1.6, z: 0 }, { x: 0.5, y: 1.6, z: 0.5 });
    expect(result.x).toBeCloseTo(0.5);
    expect(result.z).toBeCloseTo(0.5);
  });

  it('blocks movement through north wall', () => {
    const cd = new CollisionDetector(simpleWalls);
    const from = { x: 0, y: 1.6, z: -1.6 };
    const desired = { x: 0, y: 1.6, z: -2.0 };
    const result = cd.tryMove(from, desired);
    expect(result.z).toBeCloseTo(-1.6);
  });

  it('slides along wall on X axis when Z is blocked', () => {
    const cd = new CollisionDetector(simpleWalls);
    const from = { x: 1.0, y: 1.6, z: -1.6 };
    const desired = { x: 1.3, y: 1.6, z: -2.0 };
    const result = cd.tryMove(from, desired);
    expect(result.x).toBeCloseTo(1.3);
    expect(result.z).toBeCloseTo(-1.6);
  });

  it('preserves Y coordinate', () => {
    const cd = new CollisionDetector(simpleWalls);
    const result = cd.tryMove({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 2.0, z: 0 });
    expect(result.y).toBeCloseTo(2.0);
  });

  it('returns from position when fully blocked', () => {
    const cd = new CollisionDetector(simpleWalls);
    const from = { x: 0, y: 1.6, z: -1.6 };
    const desired = { x: 0, y: 1.6, z: -2.0 };
    const result = cd.tryMove(from, desired);
    expect(result.x).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(-1.6);
  });

  it('exposes wall AABBs', () => {
    const cd = new CollisionDetector(simpleWalls);
    expect(cd.getWalls().length).toBe(4);
  });

  it('creates gap in wall for door opening', () => {
    const wallWithDoor: WallSegment[] = [
      { id: 'north', x1: -2, z1: -2, x2: 2, z2: -2, openings: [
        { id: 'd1', type: 'door', x: 0, z: -2, width: 1.0, height: 2.1 },
      ]},
    ];
    const cd = new CollisionDetector(wallWithDoor);
    expect(cd.getWalls().length).toBe(2);
    const result = cd.tryMove({ x: 0, y: 1.6, z: -1.6 }, { x: 0, y: 1.6, z: -2.0 });
    expect(result.z).toBeCloseTo(-2.0);
  });

  it('no collision when no walls', () => {
    const cd = new CollisionDetector([]);
    const result = cd.tryMove({ x: 0, y: 1.6, z: 0 }, { x: 100, y: 1.6, z: 100 });
    expect(result.x).toBeCloseTo(100);
    expect(result.z).toBeCloseTo(100);
  });
});
