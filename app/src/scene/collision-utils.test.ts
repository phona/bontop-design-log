import { describe, it, expect } from 'vitest';
import { extractCollisionWalls } from './collision-utils.js';

describe('extractCollisionWalls', () => {
  it('extracts type=wall elements', () => {
    const elements = [
      { type: 'wall', id: 'w1', x1: 0, z1: 0, x2: 5, z2: 0 },
    ];
    const walls = extractCollisionWalls(elements);
    expect(walls.length).toBe(1);
    expect(walls[0].id).toBe('w1');
    expect(walls[0].x1).toBe(0);
    expect(walls[0].x2).toBe(5);
  });

  it('includes curtain_run points as collision segments', () => {
    const elements = [
      { type: 'wall', id: 'w1', x1: 0, z1: 0, x2: 5, z2: 0 },
      {
        type: 'curtain_run', id: 'cr1', points: [
          { x: 7.2, z: 9.8 }, { x: 13.4, z: 9.8 }, { x: 16.4, z: 9.8 },
        ],
      },
    ];
    const walls = extractCollisionWalls(elements);
    expect(walls.length).toBe(3);
    expect(walls[1].id).toBe('cr1:col:0');
    expect(walls[1].x1).toBeCloseTo(7.2);
    expect(walls[1].x2).toBeCloseTo(13.4);
    expect(walls[2].id).toBe('cr1:col:1');
    expect(walls[2].x1).toBeCloseTo(13.4);
    expect(walls[2].x2).toBeCloseTo(16.4);
  });

  it('ignores non-collidable element types', () => {
    const elements = [
      { type: 'floor_region', id: 'f1', points: [{ x: 0, z: 0 }] },
      { type: 'railing_run', id: 'r1', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },
      { type: 'bay_sill', id: 'bs1', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },
      { type: 'glass_infill', id: 'gi1', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },
      { type: 'shower_screen', id: 'ss1', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },
    ];
    const walls = extractCollisionWalls(elements);
    expect(walls.length).toBe(0);
  });

  it('returns empty for undefined input', () => {
    expect(extractCollisionWalls(undefined)).toEqual([]);
  });

  it('skips curtain_run with fewer than 2 points', () => {
    const elements = [
      { type: 'curtain_run', id: 'cr1', points: [{ x: 0, z: 0 }] },
    ];
    expect(extractCollisionWalls(elements).length).toBe(0);
  });

  it('preserves wall openings for door gap splitting', () => {
    const elements = [
      {
        type: 'wall', id: 'w1', x1: 0, z1: 0, x2: 5, z2: 0,
        openings: [{ id: 'd1', type: 'door', x: 2.5, z: 0, width: 1.0, height: 2.1 }],
      },
    ];
    const walls = extractCollisionWalls(elements);
    expect(walls[0].openings).toHaveLength(1);
    expect(walls[0].openings![0].id).toBe('d1');
  });
});

describe('extractCollisionWalls sliding_door_run (DEC-022)', () => {
  it('collides only when closed', () => {
    const closed = extractCollisionWalls([
      { type: 'sliding_door_run', id: 'sd1', open: false, points: [{ x: 7.2, z: 2.4 }, { x: 10.8, z: 2.4 }] },
    ] as any);
    expect(closed.length).toBe(1);
    expect(closed[0].id).toBe('sd1:col:0');
    expect(closed[0].x1).toBeCloseTo(7.2);
    expect(closed[0].x2).toBeCloseTo(10.8);
  });

  it('no collision when open (default state)', () => {
    const open = extractCollisionWalls([
      { type: 'sliding_door_run', id: 'sd1', open: true, points: [{ x: 7.2, z: 2.4 }, { x: 10.8, z: 2.4 }] },
      { type: 'sliding_door_run', id: 'sd2', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },
    ] as any);
    expect(open.length).toBe(0);
  });
});
