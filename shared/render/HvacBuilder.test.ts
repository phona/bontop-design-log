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

test('DEC-2026-10-07-R03 linear_slot: no frame/status rectangle, decorative segments render closed and status-free', () => {
  const threeLineDiagram: HvacDiagram = {
    anchors: [],
    terminals: [
      { id: 'supply_living_bottom', status: 'inferred', system: 'supply_air', position: { x: 10.3, y: 2.5, z: 4.85 }, mount_face: 'bottom', length: 0.9, finish: 'matte_black', render_style: 'linear_slot', reason: '三层线功能段' },
      { id: 'LD-deco-supply-mid', kind: 'decorative_louver', status: 'pending', confirmed: false, render_interior: true, render_coordination: false, system: 'decorative', position: { x: 9.15, y: 2.5, z: 4.85 }, mount_face: 'bottom', length: 1.4, grille_height: 0.15, finish: 'matte_black', render_style: 'linear_slot', reason: '封闭装饰段' },
      { id: 'LD-deco-return-mid', kind: 'decorative_louver', status: 'pending', confirmed: false, render_interior: true, render_coordination: false, system: 'decorative', position: { x: 10.225, y: 2.49, z: 4.45 }, mount_face: 'bottom', length: 3.75, grille_height: 0.25, finish: 'matte_black', render_style: 'linear_slot', reason: '封闭装饰段' },
    ],
    routes: [],
    reference_constraints: [],
  };
  const projection = { version: '2.0', hvac: { status: 'implemented', planId: 'A2', diagram: threeLineDiagram } } as unknown as ProjectRenderFactsProjection;
  const root = new THREE.Group();
  const result = buildHvacGeometry(root, projection);
  assert.equal(result.index.terminals.size, 3);
  const functional = result.index.terminals.get('hvac:A2:terminal:supply_living_bottom')!;
  const decorative = result.index.terminals.get('hvac:A2:terminal:LD-deco-supply-mid')!;
  const returnDeco = result.index.terminals.get('hvac:A2:terminal:LD-deco-return-mid')!;
  // 功能段保留一条槽内贴边状态发丝线；装饰段无任何 Line 子件（无状态框）。
  const functionalLines = functional.children.filter((child) => (child as THREE.LineSegments).isLineSegments);
  const decorativeLines = decorative.children.filter((child) => (child as THREE.LineSegments).isLineSegments);
  assert.equal(functionalLines.length, 1, 'functional linear slot keeps exactly one status hairline');
  assert.equal(decorativeLines.length, 0, 'decorative louver renders without status line');
  assert.equal(functional.userData.render_style, 'linear_slot');
  assert.equal(decorative.userData.decorative, true);
  assert.equal(functional.userData.decorative, false);
  // linear_slot 用满长连续叶片：无 frameOutline 收口框（panel 语言才有 4 根外框条）。
  const functionalBoxes = functional.children.filter((child) => child instanceof THREE.Mesh).length;
  assert.ok(functionalBoxes >= 6, `linear slot keeps back + slats + end caps (${functionalBoxes} meshes)`);
  // grille_height 覆盖：回风排装饰段面板更高（0.25 vs 送风排 0.15）。
  const supplyBox = new THREE.Box3().setFromObject(decorative);
  const returnBox = new THREE.Box3().setFromObject(returnDeco);
  assert.ok(Math.abs((returnBox.max.z - returnBox.min.z) - 0.25) < 0.06, `return-row height ${returnBox.max.z - returnBox.min.z}`);
  assert.ok(Math.abs((supplyBox.max.z - supplyBox.min.z) - 0.15) < 0.06, `supply-row height ${supplyBox.max.z - supplyBox.min.z}`);
});
