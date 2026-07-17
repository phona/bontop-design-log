import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { VertexLayoutYaml } from '../../shared/types.js';

function makeRectRoom(): VertexLayoutYaml {
  return {
    version: '2.0',
    unit: 'm',
    scale: 0.001,
    origin: { x: 0, z: 0 },
    vertices: [
      { id: 'v1', x: 0, z: 0 },
      { id: 'v2', x: 4, z: 0 },
      { id: 'v3', x: 4, z: 3 },
      { id: 'v4', x: 0, z: 3 },
    ],
    rooms: [
      { id: 'test_room', name: 'Test', boundary: ['v1', 'v2', 'v3', 'v4'], height: 3.0, type: 'private' },
    ],
    walls: [
      { id: 'w_north', from: 'v1', to: 'v2', height: 3.0 },
      { id: 'w_east', from: 'v2', to: 'v3', height: 3.0 },
      { id: 'w_south', from: 'v3', to: 'v4', height: 3.0 },
      { id: 'w_west', from: 'v4', to: 'v1', height: 3.0 },
    ],
  };
}

describe('resolveLayout', () => {
  it('derives x/z/width/depth for rectangular room (no points)', () => {
    const result = resolveLayout(makeRectRoom());
    const room = result.rooms[0];
    assert.equal(room.x, 2);
    assert.equal(room.z, 1.5);
    assert.equal(room.width, 4);
    assert.equal(room.depth, 3);
    assert.equal(room.points, undefined);
  });

  it('derives points for non-rectangular room', () => {
    const yaml = makeRectRoom();
    yaml.vertices.push({ id: 'v5', x: 2, z: 0 });
    yaml.rooms[0].boundary = ['v1', 'v5', 'v2', 'v3', 'v4'];
    const result = resolveLayout(yaml);
    assert.ok(result.rooms[0].points, 'non-rect room should have points');
    assert.equal(result.rooms[0].points!.length, 5);
  });

  it('resolves wall endpoints from vertex ids', () => {
    const result = resolveLayout(makeRectRoom());
    const w = result.walls[0];
    assert.equal(w.id, 'w_north');
    assert.equal(w.x1, 0);
    assert.equal(w.z1, 0);
    assert.equal(w.x2, 4);
    assert.equal(w.z2, 0);
  });

  it('auto-derives open edges', () => {
    const yaml = makeRectRoom();
    // Remove north wall → open edge
    yaml.walls = yaml.walls.filter(w => w.id !== 'w_north');
    const result = resolveLayout(yaml);
    assert.ok(result.openEdges.some(e => e.room === 'test_room' && e.from === 'v1' && e.to === 'v2'));
  });

  it('throws on duplicate vertex id', () => {
    const yaml = makeRectRoom();
    yaml.vertices.push({ id: 'v1', x: 99, z: 99 });
    assert.throws(() => resolveLayout(yaml), /Duplicate vertex id: v1/);
  });

  it('throws on unknown vertex in room boundary', () => {
    const yaml = makeRectRoom();
    yaml.rooms[0].boundary = ['v1', 'v999', 'v3', 'v4'];
    assert.throws(() => resolveLayout(yaml), /Unknown vertex: v999/);
  });

  it('throws on self-intersecting boundary', () => {
    const yaml = makeRectRoom();
    // Bowtie: v1→v3→v2→v4
    yaml.rooms[0].boundary = ['v1', 'v3', 'v2', 'v4'];
    assert.throws(() => resolveLayout(yaml), /Self-intersecting/);
  });

  it('auto-reverses CW boundary to CCW', () => {
    const yaml = makeRectRoom();
    yaml.rooms[0].boundary = ['v1', 'v4', 'v3', 'v2']; // CW order
    const result = resolveLayout(yaml);
    // Should not throw, area should be positive
    assert.ok(result.rooms[0].area! > 0);
  });
});
