import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInfrastructure } from '../../../shared/render/InfrastructureBuilder.js';

test('shared infrastructure builder preserves metadata and projects wall-side fixtures', () => {
  const result = buildInfrastructure({
    electrical: [
      { id: 'switch-west', room: 'room', type: 'switch', x: 2, z: 0.5, height: 1.2, wall: 'wall', wallSide: 'west' },
      { id: 'panel', room: 'room', type: 'strong_panel', x: 2, z: 1, wall: 'wall', wallSide: 'west', mount_height: 1.5, body_height: 0.4, width: 0.4, depth: 0.2, status: 'measured', position_status: 'inferred' },
    ],
    plumbing: [{ id: 'drain', room: 'room', type: 'drain', x: 1, z: 1, height: 0.1 }],
    wallSegments: new Map([['wall', [{ x1: 2, z1: -1, x2: 2, z2: 3 }]]]),
  });

  assert.equal(result.objects.length, 3);
  assert.ok(result.electrical[0].position.x < 2);
  assert.equal(result.electrical[0].userData.objectId, 'electrical:switch-west');
  assert.equal(result.electrical[0].userData.fixtureType, 'switch');
  assert.equal(result.electrical[0].userData.wallSide, 'west');
  assert.deepEqual(result.electrical[1].userData.dimensions, { width: 0.4, depth: 0.2, height: 0.4 });
  assert.equal(result.electrical[1].userData.developer_reserved, true);
  assert.equal(result.plumbing[0].userData.objectId, 'plumbing:drain');
});

test('shared infrastructure builder keeps authored coordinates when wall projection is unavailable', () => {
  const [fixture] = buildInfrastructure({
    electrical: [{ id: 'socket', room: 'room', type: 'socket', x: 1, z: 2, height: 0.4, wall: 'missing' }],
    plumbing: [],
  }).electrical;
  assert.deepEqual(fixture.position.toArray(), [1, 0.4, 2]);
  assert.equal(fixture.rotation.y, 0);
});
