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

describe('resolveLayout edge cases', () => {
  it('resolveWall with unknown vertex id throws', () => {
    const yaml = makeRectRoom();
    yaml.walls.push({ id: 'w_bad', from: 'v1', to: 'v_unknown', height: 3.0 });
    assert.throws(() => resolveLayout(yaml), /unknown vertex/);
  });

  it('room with fewer than 3 vertices throws', () => {
    const yaml = makeRectRoom();
    yaml.rooms[0].boundary = ['v1', 'v2'];
    assert.throws(() => resolveLayout(yaml), /< 3 vertices/);
  });

  it('platform open edges are derived', () => {
    const yaml: VertexLayoutYaml = {
      version: '2.0', unit: 'm', scale: 0.001, origin: { x: 0, z: 0 },
      vertices: [
        { id: 'v1', x: 0, z: 0 },
        { id: 'v2', x: 3, z: 0 },
        { id: 'v3', x: 3, z: 2 },
        { id: 'v4', x: 0, z: 2 },
      ],
      rooms: [
        { id: 'room', name: 'Room', boundary: ['v1', 'v2', 'v3', 'v4'], height: 3.0 },
      ],
      walls: [
        { id: 'w1', from: 'v1', to: 'v2', height: 3.0 },
        { id: 'w2', from: 'v2', to: 'v3', height: 3.0 },
        { id: 'w3', from: 'v3', to: 'v4', height: 3.0 },
        { id: 'w4', from: 'v4', to: 'v1', height: 3.0 },
      ],
      platform: { id: 'plat', name: 'Platform', boundary: ['v1', 'v2', 'v3', 'v4'], height: 0.3 },
    };
    // All walls present → no open edges for platform (walls are shared)
    const result = resolveLayout(yaml);
    const platEdges = result.openEdges.filter(e => e.room === 'plat');
    assert.equal(platEdges.length, 0);
  });
});

describe('regression: change south wall z → auto-propagate', () => {
  it('moving v_step_t.z propagates to living_dining depth + wall endpoints', () => {
    const base: VertexLayoutYaml = {
      version: '2.0', unit: 'm', scale: 0.001, origin: { x: 0, z: 0 },
      vertices: [
        { id: 'v_kit_w', x: 7.20, z: 0 },
        { id: 'v_kit_s', x: 7.20, z: 4.30 },
        { id: 'v_liv_se', x: 13.40, z: 4.30 },
        { id: 'v_be_se_s', x: 13.40, z: 9.95 },
        { id: 'v_step_t', x: 7.20, z: 9.95 },
      ],
      rooms: [
        { id: 'living_dining', name: '客餐厅', boundary: ['v_kit_s', 'v_liv_se', 'v_be_se_s', 'v_step_t'], height: 3.0 },
      ],
      walls: [
        { id: 'w_liv_south', from: 'v_step_t', to: 'v_be_se_s', height: 3.0 },
        { id: 'w_liv_west', from: 'v_kit_s', to: 'v_step_t', height: 3.0 },
        { id: 'w_liv_north', from: 'v_kit_s', to: 'v_liv_se', height: 3.0 },
        { id: 'w_liv_east', from: 'v_liv_se', to: 'v_be_se_s', height: 3.0 },
      ],
    };

    // Before: z=9.95
    const before = resolveLayout(base);
    assert.ok(Math.abs(before.rooms[0].depth - 5.65) < 1e-10); // 9.95 - 4.30
    assert.equal(before.walls[0].z1, 9.95); // w_liv_south from v_step_t

    // After: move v_step_t.z to 10.25 (south wall pushed 0.3m south)
    const after = resolveLayout({
      ...base,
      vertices: base.vertices.map(v => v.id === 'v_step_t' ? { ...v, z: 10.25 } : v),
    });
    assert.ok(Math.abs(after.rooms[0].depth - 5.95) < 1e-10); // 10.25 - 4.30
    assert.equal(after.walls[0].z1, 10.25); // wall endpoint auto-updated
    assert.equal(after.walls[1].z2, 10.25); // w_liv_west endpoint also auto-updated (shared vertex)
  });
});
