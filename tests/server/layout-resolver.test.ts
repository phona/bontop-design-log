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

describe('resolveLayout arc expansion', () => {
  it('expands radius vertex into 16 arc segments on the wall whose from has radius', () => {
    const yaml: VertexLayoutYaml = {
      version: '2.0', unit: 'm', scale: 0.001, origin: { x: 0, z: 0 },
      vertices: [
        { id: 'v_nw', x: 0, z: 0 },
        { id: 'v_sw', x: 0, z: 5, radius: 1.0 },
        { id: 'v_se', x: 5, z: 5 },
        { id: 'v_ne', x: 5, z: 0 },
      ],
      rooms: [
        { id: 'room', name: 'Room', boundary: ['v_nw', 'v_ne', 'v_se', 'v_sw'], height: 3.0 },
      ],
      walls: [
        { id: 'w_north', from: 'v_nw', to: 'v_ne', height: 3.0 },
        { id: 'w_east', from: 'v_ne', to: 'v_se', height: 3.0 },
        { id: 'w_south', from: 'v_se', to: 'v_sw', height: 3.0 },
        { id: 'w_west', from: 'v_sw', to: 'v_nw', height: 3.0 },
      ],
    };
    const result = resolveLayout(yaml);

    // w_west has from=v_sw (radius) → should have arc segments
    const w_west = result.walls.find(w => w.id === 'w_west')!;
    assert.ok(w_west.segments, 'west wall should have segments');
    // 16 arc + 1 straight = 17 segments (arc owned by the wall whose from is the radius vertex)
    assert.ok(w_west.segments!.length >= 16, `expected >=16 segments, got ${w_west.segments!.length}`);

    // w_south has to=v_sw (radius) → trimmed to tangent, no arc
    const w_south = result.walls.find(w => w.id === 'w_south')!;
    assert.ok(w_south.segments, 'south wall should have segments');
    assert.equal(w_south.segments!.length, 1, 'south wall should have 1 trimmed segment');
  });
});

describe('resolveLayout openings', () => {
  it('resolves door position from anchor + offset', () => {
    const yaml: VertexLayoutYaml = {
      version: '2.0', unit: 'm', scale: 0.001, origin: { x: 0, z: 0 },
      vertices: [
        { id: 'v1', x: 0, z: 0 },
        { id: 'v2', x: 5, z: 0 },
        { id: 'v3', x: 5, z: 3 },
        { id: 'v4', x: 0, z: 3 },
      ],
      rooms: [
        { id: 'room', name: 'Room', boundary: ['v1', 'v2', 'v3', 'v4'], height: 3.0 },
      ],
      walls: [
        { id: 'w_east', from: 'v2', to: 'v3', height: 3.0, openings: [
          { id: 'd1', type: 'door', wall: 'w_east', anchor: 'v2', offset: 0.9, width: 0.9, height: 2.1, room: 'room' },
        ]},
        { id: 'w_north', from: 'v1', to: 'v2', height: 3.0 },
        { id: 'w_south', from: 'v3', to: 'v4', height: 3.0 },
        { id: 'w_west', from: 'v4', to: 'v1', height: 3.0 },
      ],
    };
    const result = resolveLayout(yaml);
    const wall = result.walls.find(w => w.id === 'w_east')!;
    assert.ok(wall.openings, 'wall should have openings');
    const door = wall.openings![0];
    // v2 is at (5, 0), wall goes to v3 at (5, 3). Offset 0.9 from v2.
    assert.equal(door.x, 5);
    assert.equal(door.z, 0.9);
  });

  it('throws when opening offset exceeds wall length', () => {
    const yaml: VertexLayoutYaml = {
      version: '2.0', unit: 'm', scale: 0.001, origin: { x: 0, z: 0 },
      vertices: [
        { id: 'v1', x: 0, z: 0 },
        { id: 'v2', x: 1, z: 0 },
        { id: 'v3', x: 1, z: 1 },
        { id: 'v4', x: 0, z: 1 },
      ],
      rooms: [{ id: 'r', name: 'R', boundary: ['v1','v2','v3','v4'], height: 3 }],
      walls: [
        { id: 'w', from: 'v1', to: 'v2', height: 3.0, openings: [
          { id: 'd', type: 'door', wall: 'w', anchor: 'v1', offset: 0.9, width: 0.9, height: 2.1 },
        ]},
        { id: 'w2', from: 'v2', to: 'v3', height: 3.0 },
        { id: 'w3', from: 'v3', to: 'v4', height: 3.0 },
        { id: 'w4', from: 'v4', to: 'v1', height: 3.0 },
      ],
    };
    // Wall length = 1, offset 0.9 + width/2 0.45 = 1.35 > 1
    assert.throws(() => resolveLayout(yaml), /exceeds wall/);
  });
});
