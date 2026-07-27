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

  describe('curtain_run collision segments', () => {
    it('blocks movement through multi-segment curtain wall', () => {
      const curtainWalls: WallSegment[] = [
        { id: 'cr:col:0', x1: 7.2, z1: 9.8, x2: 13.4, z2: 9.8 },
        { id: 'cr:col:1', x1: 13.4, z1: 9.8, x2: 16.4, z2: 9.8 },
      ];
      const cd = new CollisionDetector(curtainWalls);
      const result = cd.tryMove({ x: 10, y: 1.7, z: 9.4 }, { x: 10, y: 1.7, z: 9.9 });
      expect(result.z).toBeCloseTo(9.4);
    });

    it('each curtain segment produces an AABB', () => {
      const curtainWalls: WallSegment[] = [
        { id: 'c:0', x1: 0, z1: 5, x2: 3, z2: 5 },
        { id: 'c:1', x1: 3, z1: 5, x2: 3, z2: 8 },
      ];
      const cd = new CollisionDetector(curtainWalls);
      expect(cd.getWalls().length).toBe(2);
    });

    it('allows movement parallel to curtain wall', () => {
      const curtainWalls: WallSegment[] = [
        { id: 'c:0', x1: 7.2, z1: 9.8, x2: 16.4, z2: 9.8 },
      ];
      const cd = new CollisionDetector(curtainWalls);
      const result = cd.tryMove({ x: 8, y: 1.7, z: 9.4 }, { x: 12, y: 1.7, z: 9.4 });
      expect(result.x).toBeCloseTo(12);
      expect(result.z).toBeCloseTo(9.4);
    });
  });

  describe('narrow door passability', () => {
    it('lets a centered capsule walk straight through a 0.7m door', () => {
      const wallWithNarrowDoor: WallSegment[] = [
        { id: 'south', x1: -2, z1: 2, x2: 2, z2: 2, openings: [
          { id: 'd_narrow', type: 'door', x: 0, z: 2, width: 0.7, height: 2.1 },
        ]},
      ];
      const cd = new CollisionDetector(wallWithNarrowDoor);
      let pos = { x: 0, y: 1.7, z: 1.6 };
      for (let i = 0; i < 30; i++) {
        pos = cd.tryMove(pos, { x: 0, y: 1.7, z: pos.z + 0.032 });
      }
      expect(pos.z).toBeGreaterThan(2.2);
    });

    it('does not erode the door gap with longitudinal wall expansion', () => {
      const wallWithNarrowDoor: WallSegment[] = [
        { id: 'south', x1: -2, z1: 2, x2: 2, z2: 2, openings: [
          { id: 'd_narrow', type: 'door', x: 0, z: 2, width: 0.7, height: 2.1 },
        ]},
      ];
      const cd = new CollisionDetector(wallWithNarrowDoor);
      const aabbs = cd.getWalls();
      const leftMaxX = Math.max(...aabbs.filter(a => a.maxX < 0).map(a => a.maxX));
      const rightMinX = Math.min(...aabbs.filter(a => a.minX > 0).map(a => a.minX));
      expect(rightMinX - leftMaxX).toBeGreaterThanOrEqual(0.7 - 0.001);
    });
  });
});
