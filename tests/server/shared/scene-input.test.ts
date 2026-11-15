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

test('scene input parser uses supplied anchor walls without rendering them as solid walls', () => {
  // #98 Tier 1 3D 路径：/api/walls 下发的全量墙（含 suppressed 玻璃线）经
  // HouseScene.buildFromCatalog 以 source.walls 传入；sceneElements 里没有这些墙
  //（实体盒不渲染、由 curtain 替代），但墙锚家具以它们的墙线为基准。供了 walls 就
  //以它为准，且不因为 walls 里有墙就往 elements 里补实体墙——否则玻璃幕会渲成实墙。
  const glassWall = { id: 'w_glass', x1: 0, z1: 0, x2: 5, z2: 0, height: 2.8, line_datum: 'centerline' as const };
  const solidWall = { type: 'wall' as const, id: 'w_solid', x1: 0, z1: 5, x2: 5, z2: 5 };
  const result = parseSceneInput({
    rooms: [{ id: 'room', name: 'Room', x: 2.5, z: 2.5, width: 5, depth: 5, height: 3, type: 'public' }],
    elements: [solidWall],
    walls: [glassWall, { id: 'w_solid', x1: 0, z1: 5, x2: 5, z2: 5, height: 3 }],
  });
  assert.equal(result.walls.length, 2);
  assert.ok(result.walls.some((wall) => wall.id === 'w_glass'));
  assert.equal(result.walls.find((wall) => wall.id === 'w_glass')?.line_datum, 'centerline');
  // 玻璃墙只进定位墙表，不进渲染元素。
  assert.equal(result.elements.filter((entry) => entry.type === 'wall').length, 1);
  assert.ok(!result.elements.some((entry) => entry.id === 'w_glass'));
});
