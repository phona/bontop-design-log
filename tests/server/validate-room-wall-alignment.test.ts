import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  checkEdgeAlignment,
  mergeCollinearWalls,
  mergeIntervals,
  validateRoomWallAlignment,
  wallBounds,
} from '../../scripts/validate-room-wall-alignment.js';

describe('validate-room-wall-alignment', () => {
  describe('wallBounds', () => {
    it('computes min/max x/z from a list of walls', () => {
      const walls = [
        { x1: 0, z1: 0, x2: 5, z2: 0 },
        { x1: 5, z1: 0, x2: 5, z2: 4 },
      ];
      const bounds = wallBounds(walls);
      assert.strictEqual(bounds.minX, 0);
      assert.strictEqual(bounds.maxX, 5);
      assert.strictEqual(bounds.minZ, 0);
      assert.strictEqual(bounds.maxZ, 4);
    });

    it('handles negative coordinates', () => {
      const walls = [{ x1: -2, z1: -3, x2: 1, z2: 0 }];
      const bounds = wallBounds(walls);
      assert.strictEqual(bounds.minX, -2);
      assert.strictEqual(bounds.maxX, 1);
      assert.strictEqual(bounds.minZ, -3);
      assert.strictEqual(bounds.maxZ, 0);
    });
  });

  describe('mergeIntervals', () => {
    it('merges overlapping intervals', () => {
      const intervals = [
        { min: 0, max: 2 },
        { min: 1.5, max: 4 },
        { min: 5, max: 7 },
      ];
      const merged = mergeIntervals(intervals);
      assert.deepStrictEqual(merged, [
        { min: 0, max: 4 },
        { min: 5, max: 7 },
      ]);
    });

    it('merges adjacent intervals within tolerance', () => {
      const intervals = [
        { min: 0, max: 1 },
        { min: 1.04, max: 3 },
      ];
      const merged = mergeIntervals(intervals);
      assert.deepStrictEqual(merged, [{ min: 0, max: 3 }]);
    });

    it('keeps separated intervals apart', () => {
      const intervals = [
        { min: 0, max: 1 },
        { min: 2, max: 3 },
      ];
      const merged = mergeIntervals(intervals);
      assert.deepStrictEqual(merged, [
        { min: 0, max: 1 },
        { min: 2, max: 3 },
      ]);
    });

    it('returns empty array for empty input', () => {
      const merged = mergeIntervals([]);
      assert.deepStrictEqual(merged, []);
    });
  });

  describe('mergeCollinearWalls', () => {
    it('merges collinear horizontal wall segments', () => {
      const walls = [
        { x1: 0, z1: 0, x2: 2, z2: 0 },
        { x1: 2, z1: 0, x2: 5, z2: 0 },
      ];
      const merged = mergeCollinearWalls(walls);
      assert.strictEqual(merged.length, 1);
      assert.deepStrictEqual(merged[0], { x1: 0, z1: 0, x2: 5, z2: 0 });
    });

    it('merges collinear vertical wall segments', () => {
      const walls = [
        { x1: 3, z1: 0, x2: 3, z2: 2 },
        { x1: 3, z1: 2, x2: 3, z2: 5 },
      ];
      const merged = mergeCollinearWalls(walls);
      assert.strictEqual(merged.length, 1);
      assert.deepStrictEqual(merged[0], { x1: 3, z1: 0, x2: 3, z2: 5 });
    });

    it('keeps perpendicular walls separate', () => {
      const walls = [
        { x1: 0, z1: 0, x2: 5, z2: 0 },
        { x1: 2, z1: 0, x2: 2, z2: 4 },
      ];
      const merged = mergeCollinearWalls(walls);
      assert.strictEqual(merged.length, 2);
    });
  });

  describe('validateRoomWallAlignment', () => {
    it('does not flag a room inside the wall bounds as outside', () => {
      const walls = [
        { x1: 0, z1: 0, x2: 6, z2: 0 },
        { x1: 6, z1: 0, x2: 6, z2: 6 },
        { x1: 6, z1: 6, x2: 0, z2: 6 },
        { x1: 0, z1: 6, x2: 0, z2: 0 },
      ];
      const rooms = [{ id: 'inner', x: 3, z: 3, width: 2, depth: 2 }];
      const result = validateRoomWallAlignment(rooms, walls);
      assert(!result.messages.some(m => m.includes('OUTSIDE WALLS')));
    });

    it('flags a room outside the wall bounds', () => {
      const walls = [
        { x1: 0, z1: 0, x2: 6, z2: 0 },
        { x1: 6, z1: 0, x2: 6, z2: 6 },
        { x1: 6, z1: 6, x2: 0, z2: 6 },
        { x1: 0, z1: 6, x2: 0, z2: 0 },
      ];
      const rooms = [{ id: 'outer', x: 8, z: 3, width: 2, depth: 2 }];
      const result = validateRoomWallAlignment(rooms, walls);
      assert.strictEqual(result.ok, false);
      assert(result.messages.some(m => m.includes('OUTSIDE WALLS')));
    });

    it('passes when a room edge aligns with a wall segment', () => {
      const walls = [
        { x1: 0, z1: 0, x2: 6, z2: 0 },
        { x1: 6, z1: 0, x2: 6, z2: 6 },
        { x1: 6, z1: 6, x2: 0, z2: 6 },
        { x1: 0, z1: 6, x2: 0, z2: 0 },
      ];
      const rooms = [{ id: 'aligned', x: 3, z: 3, width: 6, depth: 6 }];
      const result = validateRoomWallAlignment(rooms, walls);
      assert.strictEqual(result.ok, true);
      assert(result.messages.some(m => m.includes('Wall bounding box')));
      assert(result.messages.some(m => m.includes('All rooms are inside')));
    });

    it('flags a room edge that does not align with a wall segment', () => {
      const walls = [
        { x1: 0, z1: 0, x2: 6, z2: 0 },
        { x1: 6, z1: 0, x2: 6, z2: 6 },
        { x1: 6, z1: 6, x2: 0, z2: 6 },
        { x1: 0, z1: 6, x2: 0, z2: 0 },
      ];
      const rooms = [{ id: 'shifted', x: 3.2, z: 3, width: 4, depth: 4 }];
      const result = validateRoomWallAlignment(rooms, walls);
      assert.strictEqual(result.ok, false);
      assert(result.messages.some(m => m.includes('MISALIGNED')));
    });
  });

  describe('checkEdgeAlignment', () => {
    it('returns ok when edge aligns with a wall segment', () => {
      const edge = { roomId: 'r1', side: 'south' as const, pos: 0, min: 0, max: 4 };
      const walls = [{ x1: 0, z1: 0, x2: 4, z2: 0 }];
      const result = checkEdgeAlignment(edge, walls);
      assert.strictEqual(result.ok, true);
    });

    it('returns not ok when edge does not align', () => {
      const edge = { roomId: 'r1', side: 'south' as const, pos: 0.5, min: 0, max: 4 };
      const walls = [{ x1: 0, z1: 0, x2: 4, z2: 0 }];
      const result = checkEdgeAlignment(edge, walls);
      assert.strictEqual(result.ok, false);
    });
  });
});
