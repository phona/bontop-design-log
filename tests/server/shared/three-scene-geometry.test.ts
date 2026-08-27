import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createLineMesh,
  createPolygonGeometry,
  setSceneObjectMetadata,
  splitSegmentByOpenings,
} from '../../../shared/three-scene-geometry.js';

test('shared geometry metadata preserves the export contract', () => {
  const object = new THREE.Object3D();
  object.userData.existing = true;
  setSceneObjectMetadata(object, 'wall', 'wall:1');
  assert.deepEqual(object.userData, { existing: true, type: 'wall', objectId: 'wall:1', exportName: 'wall:1' });
  assert.equal(object.name, 'wall:1');
});

test('shared polygon and line helpers use the house coordinate convention', () => {
  const polygon = createPolygonGeometry([{ x: 1, z: 2 }, { x: 4, z: 2 }, { x: 4, z: 5 }]);
  assert.equal(polygon.type, 'ShapeGeometry');
  const line = createLineMesh({ x: 0, z: 0 }, { x: 3, z: 4 }, 2, 0.12, new THREE.MeshBasicMaterial());
  assert.ok(line);
  assert.deepEqual(line.position.toArray(), [1.5, 1, 2]);
  line.geometry.computeBoundingBox();
  assert.ok(line.geometry.boundingBox);
  assert.equal(line.geometry.boundingBox.max.x - line.geometry.boundingBox.min.x, 5);
  assert.ok(Math.abs(line.rotation.y - Math.atan2(4, 3)) < 1e-12);
});

test('shared opening splitter handles overlaps and ignores invalid openings', () => {
  const result = splitSegmentByOpenings(
    { x1: 0, z1: 0, x2: 10, z2: 0 },
    [
      { x: 4, z: 0, width: 2, height: 2 },
      { x: 5, z: 0, width: 4, height: 2 },
      { x: 8, z: 0, width: 0, height: 2 },
      { x: 9, z: 0, width: 1, height: 0 },
    ],
  );
  assert.deepEqual(result, [
    { x1: 0, z1: 0, x2: 3, z2: 0 },
    { x1: 7, z1: 0, x2: 10, z2: 0 },
  ]);
});

test('shared opening splitter clips openings to segment bounds', () => {
  assert.deepEqual(
    splitSegmentByOpenings({ x1: 0, z1: 0, x2: 4, z2: 0 }, [{ x: 0, z: 0, width: 2, height: 2 }]),
    [{ x1: 1, z1: 0, x2: 4, z2: 0 }],
  );
});
