import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHvacBuilderSources, buildHvacEntityDescriptors } from './HvacBuilder.js';
import { buildHvacGeometry } from './HvacGeometryBuilder.js';
import type { HvacDiagram, ProjectRenderFactsProjection } from '../types.js';
import * as THREE from 'three';

const diagram: HvacDiagram = {
  anchors: [
    { id: 'outdoor', status: 'confirmed', system: 'refrigerant', ref: { source: 'outdoor', id: 'outdoor_a2' } },
    { id: 'indoor', status: 'confirmed', system: 'refrigerant', ref: { source: 'ceiling', id: 'ac_living' } },
    { id: 'inferred', status: 'inferred', system: 'refrigerant', position: { x: 0, y: 0, z: 0 }, reason: '待确认' },
  ],
  terminals: [{ id: 'supply_living', status: 'inferred', system: 'supply_air', position: { x: 2, y: 2.5, z: 3 } }],
  routes: [],
  reference_constraints: [],
};

test('shared HVAC builder emits stable export entity descriptors', () => {
  const entities = buildHvacEntityDescriptors('A2', diagram, {
    ceiling: [{ id: 'ac_living', room: 'living', type: 'ac_indoor', x: 10, z: 7, height: 2.85 }],
    outdoor: [{ id: 'outdoor_a2', platform: 'west', x: 1, z: 2, direction: 'south', width: 0.9, depth: 0.335, height: 0.7, model: '6HP' }],
  });
  assert.deepEqual(entities.map((entity) => entity.objectId), [
    'hvac:A2:anchor:outdoor',
    'hvac:A2:anchor:indoor',
    'hvac:A2:anchor:inferred',
    'hvac:A2:terminal:supply_living',
  ]);
  assert.deepEqual(entities[1].position, { x: 10, y: 2.85, z: 7 });
  assert.deepEqual(entities[2].position, { x: 0, y: 0, z: 0 });
  assert.equal(entities[2].status, 'inferred');
});

test('shared HVAC geometry preserves Web dimensions, metadata, root, and unique IDs', () => {
  const projection = { version: '2.0', lightingFixtures: [], plumbing: [], ceiling: [{ id: 'ac_living', room: 'living', type: 'ac_indoor', x: 10, z: 7, height: 2.85 }], hvac: { status: 'implemented', planId: 'A2', diagram }, materials: { floor: { default: null, roomOverrides: {} } }, presentation: { curtains: {} } } as unknown as ProjectRenderFactsProjection;
  const root = new THREE.Group();
  const result = buildHvacGeometry(root, projection, {
    ceiling: [{ id: 'ac_living', room: 'living', type: 'ac_indoor', x: 10, z: 7, height: 2.85 }],
    outdoor: [{ id: 'outdoor_a2', platform: 'west', x: 1, z: 2, direction: 'south', width: 0.9, depth: 0.335, height: 0.7, model: '6HP' }],
  });
  assert.equal(root.getObjectByName('HVAC_CONFIRMED_ENTITIES')?.parent, root);
  assert.equal(result.index.equipment.size, 3);
  assert.equal(result.index.terminals.size, 1);
  assert.equal(result.index.all.size, 4);
  const inferred = result.index.equipment.get('hvac:A2:anchor:inferred')!;
  assert.deepEqual(inferred.position.toArray(), [0, 0, 0]);
  assert.equal(inferred.userData.status, 'inferred');
  const indoor = result.index.equipment.get('hvac:A2:anchor:indoor')! as THREE.Mesh;
  assert.deepEqual(indoor.position.toArray(), [10, 2.85, 7]);
  assert.deepEqual((indoor.geometry as THREE.BoxGeometry).parameters, { width: 0.8, height: 0.12, depth: 0.5, widthSegments: 1, heightSegments: 1, depthSegments: 1 });
  assert.equal(indoor.userData.hvacKind, 'indoor');
  const terminal = result.index.terminals.get('hvac:A2:terminal:supply_living')!;
  assert.equal(terminal.userData.mount_face, 'bottom');
  const ids: string[] = [];
  root.traverse((object) => { if (object.userData.objectId) ids.push(object.userData.objectId); });
  assert.equal(new Set(ids).size, ids.length);
});

test('shared HVAC sources derive ceiling anchors from declared areas and deduplicate records', () => {
  const sources = buildHvacBuilderSources({
    projection: { ceiling: [{ id: 'ac_living', room: 'living', type: 'ac_indoor', area: [8, 4, 12, 6] }], hvac: { status: 'implemented', planId: 'A2', diagram } } as unknown as ProjectRenderFactsProjection,
    ceiling: [{ id: 'ac_living', room: 'wrong', type: 'ac_indoor', x: 99, z: 99 }],
    electrical: [],
    outdoor: [],
  });
  assert.deepEqual(sources.ceiling, [{ id: 'ac_living', room: 'living', type: 'ac_indoor', area: [8, 4, 12, 6], x: 10, z: 5 }]);
});

test('shared HVAC geometry emits no export entities without implemented projection', () => {
  const root = new THREE.Group();
  const result = buildHvacGeometry(root, undefined);
  assert.equal(result.index.all.size, 0);
  assert.equal(root.children.length, 0);
});
