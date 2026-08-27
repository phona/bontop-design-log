import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSceneInput } from '../../../shared/render/scene-input.js';
import type { CeilingZone } from '../../../shared/types.js';

test('scene input parser derives rectangle walls and does not mutate source', () => {
  const source = {
    rooms: [{ id: 'room', name: 'Room', x: 1, z: 2, width: 4, depth: 6, height: 3, type: 'public' }],
    elements: [],
    ceilingZones: [{ id: 'zone', room: 'room', type: 'drop', thickness: 0.12, area: [-1, -1, 1, 1] as [number, number, number, number] } satisfies CeilingZone],
  };
  const before = structuredClone(source);
  const result = parseSceneInput(source);
  assert.deepEqual(source, before);
  assert.equal(result.walls.length, 4);
  assert.equal(result.elements.length, 4);
  assert.deepEqual(result.walls[0], { id: 'wall:room:north', x1: -1, z1: -1, x2: 3, z2: -1, height: 3, rooms: ['room'] });
  assert.notEqual(result.ceilingZones[0], source.ceilingZones[0]);
  assert.notEqual(result.ceilingZones[0].area, source.ceilingZones[0].area);
});

test('scene input parser preserves supplied wall elements without duplicating them', () => {
  const element = { type: 'wall' as const, id: 'wall:one', x1: 0, z1: 0, x2: 2, z2: 0 };
  const result = parseSceneInput({
    rooms: [{ id: 'room', name: 'Room', x: 1, z: 1, width: 2, depth: 2, height: 3, type: 'public' }],
    elements: [element],
  });
  assert.equal(result.walls.length, 1);
  assert.equal(result.elements.filter((entry) => entry.type === 'wall').length, 1);
});

test('scene input parser preserves and clones rounded platform points', () => {
  const source = {
    rooms: [],
    platform: {
      id: 'platform', name: 'Platform', x: 2, z: 1, width: 4, depth: 3, height: 0.3,
      type: 'service',
      points: [
        { x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3, radius: 0.5, cx: 0.5, cz: 2.5 },
      ],
    },
    elements: [],
  };
  const before = structuredClone(source);
  const result = parseSceneInput(source);
  assert.deepEqual(result.platform?.points, source.platform.points);
  assert.notEqual(result.platform?.points, source.platform.points);
  assert.notEqual(result.platform?.points?.[3], source.platform.points[3]);
  assert.deepEqual(source, before);
});
