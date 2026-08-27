import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { buildScene } from '../../../shared/render/SceneBuilder.js';
import type { SceneElement } from '../../../shared/types.js';
import { readFileSync as readTextFile } from 'node:fs';
import { load } from 'js-yaml';
import { resolveLayout } from '../../../server/layout-resolver.js';
import { parseOverlay, mergeSceneElements } from '../../../server/overlay-merge.js';

test('shared SceneBuilder uses meter UVs and stable floor metadata for rooms and floor regions', () => {
  const rooms = [
    { id: 'master_bedroom', name: '主卧', x: 2, z: 2, width: 4, depth: 4, height: 2.8, type: 'private' as const, boundary_count: 4 },
    { id: 'bedroom_nw', name: '西北卧', x: 7, z: 2, width: 4, depth: 4, height: 2.8, type: 'private' as const, boundary_count: 4 },
    { id: 'bedroom_se', name: '东南卧', x: 12, z: 2, width: 4, depth: 4, height: 2.8, type: 'private' as const, boundary_count: 4 },
    { id: 'study', name: '书房', x: 2, z: 8, width: 4, depth: 3, height: 2.8, type: 'private' as const, boundary_count: 4 },
  ];
  const result = buildScene({
    rooms,
    walls: [],
    elements: [
      { type: 'floor_region', id: 'corridor_floor', points: [{ x: 0, z: 5 }, { x: 4, z: 5 }, { x: 4, z: 6 }, { x: 0, z: 6 }] },
      { type: 'floor_region', id: 'main_corridor_floor', points: [{ x: 4, z: 5 }, { x: 8, z: 5 }, { x: 8, z: 6 }, { x: 4, z: 6 }], follow: 'master_bedroom' },
      { type: 'floor_region', id: 'entry_garden_floor', points: [{ x: 10, z: 0 }, { x: 14, z: 0 }, { x: 14, z: 2 }, { x: 10, z: 2 }] },
    ],
  });
  const floors = result.index.floorMeshes;
  assert.deepEqual(floors.filter((mesh) => mesh.userData.type === 'floor').map((mesh) => mesh.userData.roomId), rooms.map((room) => room.id));
  for (const mesh of floors.filter((candidate) => candidate.userData.type === 'floor')) {
    const uv = mesh.geometry.getAttribute('uv');
    let maxU = -Infinity; let maxV = -Infinity;
    for (let i = 0; i < uv.count; i++) { maxU = Math.max(maxU, uv.getX(i)); maxV = Math.max(maxV, uv.getY(i)); }
    const room = rooms.find((candidate) => candidate.id === mesh.userData.roomId)!;
    assert.ok(Math.abs(maxU - room.width) < 1e-6);
    assert.ok(Math.abs(maxV - room.depth) < 1e-6);
  }
  assert.deepEqual(floors.filter((mesh) => mesh.userData.type === 'floor_region').map((mesh) => mesh.userData.objectId), ['corridor_floor', 'main_corridor_floor', 'entry_garden_floor']);
  assert.equal(floors.find((mesh) => mesh.userData.objectId === 'main_corridor_floor')?.userData.follow, 'master_bedroom');
});

test('shared SceneBuilder restores HEAD room-local rounded contours for floor and ceiling', () => {
  const result = buildScene({
    rooms: [{
      id: 'rounded_room', name: 'Rounded room', x: 2, z: 5, width: 4, depth: 10, height: 2.8,
      type: 'private', boundary_count: 4,
      // Input points and arc centers are absolute layout coordinates.
      points: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 10 },
        { x: 0, z: 9.8, radius: 0.2, cx: 0.2, cz: 9.6 },
      ],
    }],
    walls: [],
    elements: [],
  });
  const floor = result.index.floorMeshes.find((mesh) => mesh.userData.objectId === 'floor:rounded_room')!;
  const ceiling = result.index.ceilingMeshes.find((mesh) => mesh.userData.objectId === 'ceiling:rounded_room')!;
  floor.updateMatrixWorld(true);
  ceiling.updateMatrixWorld(true);
  const floorWorldBbox = new THREE.Box3().setFromObject(floor);
  const ceilingWorldBbox = new THREE.Box3().setFromObject(ceiling);
  assert.ok(Math.abs(floorWorldBbox.min.x - 0) < 1e-6 && Math.abs(floorWorldBbox.max.x - 4) < 1e-6);
  assert.ok(Math.abs(floorWorldBbox.min.z - 0) < 1e-6 && Math.abs(floorWorldBbox.max.z - 10) < 1e-6);
  assert.equal(ceilingWorldBbox.min.x, floorWorldBbox.min.x, 'ceiling must share floor world x bounds');
  assert.equal(ceilingWorldBbox.max.x, floorWorldBbox.max.x, 'ceiling must share floor world x bounds');
  assert.equal(ceilingWorldBbox.min.z, floorWorldBbox.min.z, 'ceiling must share floor world z bounds');
  assert.equal(ceilingWorldBbox.max.z, floorWorldBbox.max.z, 'ceiling must share floor world z bounds');
  assert.ok(Math.abs(floorWorldBbox.min.y - 0.005) < 1e-6);
  assert.ok(Math.abs(ceilingWorldBbox.min.y - (2.8 - 0.005)) < 1e-6);

  const floorPosition = floor.geometry.getAttribute('position') as THREE.BufferAttribute;
  const localBbox = new THREE.Box3().setFromBufferAttribute(floorPosition);
  assert.ok(Math.abs(localBbox.min.x + 2) < 1e-6 && Math.abs(localBbox.max.x - 2) < 1e-6);
  assert.ok(Math.abs(localBbox.min.y + 5) < 1e-6 && Math.abs(localBbox.max.y - 5) < 1e-6);
  for (let i = 0; i < floorPosition.count; i++) {
    assert.ok(!(Math.abs(floorPosition.getX(i) + 2) < 1e-6 && Math.abs(floorPosition.getY(i) + 4.8) < 1e-6), 'rounded corner must replace the sharp vertex');
  }
  assert.ok(floor.geometry.index && floor.geometry.index.count > 0, 'rounded contour must be triangulated');
  const triangleArea = (geometry: THREE.BufferGeometry): number => {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = geometry.index!;
    let area = 0;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i); const b = index.getX(i + 1); const c = index.getX(i + 2);
      area += Math.abs((position.getX(b) - position.getX(a)) * (position.getY(c) - position.getY(a)) - (position.getY(b) - position.getY(a)) * (position.getX(c) - position.getX(a))) / 2;
    }
    return area;
  };
  assert.ok(Math.abs(triangleArea(floor.geometry) - 39.5906) < 1e-3, 'rounded area must match the shared contour');
  assert.ok(Math.abs(triangleArea(floor.geometry) - triangleArea(ceiling.geometry)) < 1e-9, 'floor and ceiling areas must match');
  assert.notEqual(floor.geometry.constructor.name, 'PlaneGeometry', 'rounded floor must not be a rectangle plane');
  assert.notEqual(ceiling.geometry.constructor.name, 'PlaneGeometry', 'rounded ceiling must not be a rectangle plane');
  assert.notEqual(floor.geometry, ceiling.geometry, 'floor and ceiling may use separate geometry instances');
  const floorUv = floor.geometry.getAttribute('uv');
  for (let i = 0; i < floorUv.count; i++) {
    assert.ok(Number.isFinite(floorUv.getX(i)) && Number.isFinite(floorUv.getY(i)));
  }
});

test('shared SceneBuilder builds rooms, split walls, overlays, ceiling zones, and furniture', () => {
  const elements: SceneElement[] = [
    { type: 'wall', id: 'wall:test', x1: 0, z1: 0, x2: 4, z2: 0, openings: [{ id: 'door', type: 'door', x: 2, z: 0, width: 1, height: 2 }] },
    { type: 'floor_region', id: 'floor:overlay', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }] },
    { type: 'wall_run', id: 'run', points: [{ x: 0, z: 1 }, { x: 2, z: 1 }], height: 2.4 },
    { type: 'glass_infill', id: 'bad-glass', wall: 'missing', width: 1, height: 2, sill: 0.9 },
  ];
  const result = buildScene({
    rooms: [{ id: 'room', name: 'Room', x: 2, z: 2, width: 4, depth: 4, height: 2.8, type: 'public', boundary_count: 4 }],
    walls: [{ id: 'wall:test', x1: 0, z1: 0, x2: 4, z2: 0, height: 2.8 }],
    elements,
    ceilingZones: [{ id: 'drop', room: 'room', type: 'drop', thickness: 0.12, area: [0.5, 0.5, 2.5, 2.5] }],
    furnishings: { room: [{ type: 'bed_150', x: 2, z: 2, rotation: 90 }, { type: 'not-a-fixture', x: 1, z: 1 }] },
  });

  assert.equal(result.scene.getObjectByName('HOUSE_EXPORT'), result.exportRoot);
  assert.equal(result.scene.getObjectByName('HOUSE_VIEW_ONLY'), result.viewOnlyRoot);
  assert.equal(result.index.rooms.room.id, 'room');
  assert.equal(result.index.floorMeshes[0], result.exportRoot.getObjectByName('floor:room'));
  assert.equal(result.index.furnitureMeshes[0], result.exportRoot.getObjectByName('furniture:room:bed_150:0'));
  assert.equal(result.report.rooms, 1);
  assert.equal(result.report.ceilings, 1);
  assert.equal(result.report.walls, 2);
  assert.equal(result.report.ceilingZones, 1);
  assert.equal(result.report.furniture, 1);
  assert.deepEqual(result.report.skippedFurniture, ['room:not-a-fixture']);
  assert.ok(result.report.unsupported.some((entry) => entry.includes('bad-glass')));
  assert.equal(result.index.curtains.size, 0);
  assert.equal(result.index.curtainRuns.size, 0);
  assert.equal(result.index.lintels.get('wall:test')?.length, 1);
  assert.ok(result.index.doorMeshes.some((object) => object.userData.objectId === 'door'));
  for (const object of result.index.doorMeshes) assert.equal(object.parent, result.exportRoot);
  for (const object of result.index.lintels.get('wall:test') ?? []) assert.equal(object.parent, result.exportRoot);

  const wallObjects: THREE.Object3D[] = [];
  result.exportRoot.traverse((object) => { if (object.userData.type === 'wall') wallObjects.push(object); });
  assert.deepEqual(wallObjects.map((object) => object.userData.objectId), ['wall:test:0', 'wall:test:1']);
  const furniture = result.exportRoot.getObjectByName('furniture:room:bed_150:0');
  assert.ok(furniture);
  assert.deepEqual(furniture.position.toArray(), [2, 0, 2]);
  assert.equal(furniture.userData.exportName, 'furniture:room:bed_150:0');

  const ceilingSolids: THREE.Object3D[] = [];
  result.exportRoot.traverse((object) => { if (object.userData.type === 'ceiling_zone_solid') ceilingSolids.push(object); });
  assert.equal(ceilingSolids.length, 5);
  assert.equal(ceilingSolids[0].userData.roomId, 'room');
});

test('shared SceneBuilder preserves legacy opening geometry and wall export metadata', () => {
  const result = buildScene({
    rooms: [{ id: 'tall', name: 'Tall', x: 0, z: 0, width: 8, depth: 4, height: 3.2, type: 'public', boundary_count: 4 }],
    walls: [
      { id: 'wall:doors', x1: 0, z1: 0, x2: 8, z2: 0, height: 3.2, rooms: ['tall', 'hall'], openings: [
        { id: 'swing', type: 'door', x: 2, z: 0, width: 1, height: 2, swing: 'inward', hinge: 'start' },
        { id: 'd_elev', type: 'door', x: 5, z: 0, width: 2, height: 2.2 },
        { id: 'slide', type: 'sliding_door', x: 7, z: 0, width: 1, height: 2 },
      ] },
    ],
    elements: [{ type: 'wall', id: 'wall:doors', x1: 0, z1: 0, x2: 8, z2: 0, rooms: ['tall', 'hall'], openings: [
      { id: 'swing', type: 'door', x: 2, z: 0, width: 1, height: 2, swing: 'inward', hinge: 'start' },
      { id: 'd_elev', type: 'door', x: 5, z: 0, width: 2, height: 2.2 },
      { id: 'slide', type: 'sliding_door', x: 7, z: 0, width: 1, height: 2 },
    ] }],
    ceilingZones: [{ id: 'tall-drop', room: 'tall', type: 'drop', thickness: 0.2, area: [0, 0, 2, 2] }],
  });

  const byId = (id: string) => result.exportRoot.getObjectByName(id)!;
  const swing = byId('swing') as THREE.Mesh;
  assert.ok(Math.abs(swing.position.x - 1.5) < 1e-9);
  assert.ok(Math.abs(swing.position.z + 0.5) < 1e-9);
  assert.equal(swing.rotation.y, Math.PI / 2);
  assert.equal(byId('swing:frame:left').userData.wallType, 'interior');
  assert.equal(byId('slide').userData.objectId, 'slide');

  const elevatorIds = ['d_elev:panel:left', 'd_elev:panel:right', 'd_elev:seam', 'd_elev:frame:left', 'd_elev:frame:right', 'd_elev:frame:top'];
  for (const id of elevatorIds) {
    const object = byId(id) as THREE.Mesh;
    assert.equal(object.userData.objectId, id);
    assert.equal(object.userData.wallType, 'interior');
  }
  assert.equal((byId('d_elev:panel:left') as THREE.Mesh).geometry.getAttribute('position').count, 24);
  assert.equal((byId('d_elev:seam') as THREE.Mesh).geometry.getAttribute('position').count, 24);

  const walls: THREE.Object3D[] = [];
  result.exportRoot.traverse((object) => { if (object.userData.type === 'wall') walls.push(object); });
  assert.deepEqual(walls.map((object) => object.userData.objectId), ['wall:doors:0', 'wall:doors:1', 'wall:doors:2', 'wall:doors:3']);
  for (const wall of walls) {
    assert.equal(wall.userData.wallType, 'interior');
    assert.equal(wall.userData.exportName, `${wall.userData.objectId}:room=tall|hall`);
    assert.equal(wall.name, `${wall.userData.objectId}:room=tall|hall`);
  }

  const slab = result.exportRoot.getObjectByName('ceiling:tall-drop:slab:0');
  assert.ok(slab);
  assert.equal((slab as THREE.Mesh).position.y, 3.2 - 0.2 + 0.002);
});

test('shared SceneBuilder registers interactive curtains separately from curtain runs', () => {
  const elements: SceneElement[] = [
    { type: 'curtain', id: 'curtain:test', room: 'room', kind: 'sheer_blackout', points: [{ x: 0, z: 0 }, { x: 4, z: 0, radius: 1 }, { x: 4, z: 4 }], height: 2.8 },
    { type: 'curtain_run', id: 'run:test', points: [{ x: 0, z: 0 }, { x: 4, z: 0, radius: 1 }, { x: 4, z: 4 }], height: 2.8 },
  ];
  const result = buildScene({ rooms: [], walls: [], elements });
  assert.equal(result.index.curtains.size, 1);
  assert.deepEqual([...result.index.curtainRuns.keys()], ['run:test']);
  const ids: string[] = [];
  result.exportRoot.traverse((object) => {
    if (object.userData.type === 'curtain') ids.push(String(object.userData.objectId));
  });
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('curtain:test:sheer:deployed'));
  assert.ok(ids.includes('curtain:test:blackout:gathered:left'));
});

test('shared SceneBuilder owns platform geometry and browser catalog delegates to it', () => {
  const result = buildScene({
    rooms: [],
    platform: { id: 'platform', name: 'Platform', x: 5, z: 0, width: 2, depth: 1.5, height: 0.3 },
    walls: [],
    elements: [],
  });
  const exportPlatforms: THREE.Object3D[] = [];
  result.exportRoot.traverse((object) => { if (object.userData.type === 'platform') exportPlatforms.push(object); });
  const viewOnlyPlatforms: THREE.Object3D[] = [];
  result.viewOnlyRoot.traverse((object) => { if (object.userData.type === 'platform') viewOnlyPlatforms.push(object); });
  assert.equal(exportPlatforms.length, 0);
  assert.equal(viewOnlyPlatforms.length, 1);
  assert.equal(viewOnlyPlatforms[0].userData.objectId, 'platform_boundary');
  assert.equal(result.index.rooms.platform.name, 'Platform');
  assert.equal(result.index.floorMeshes.filter((mesh) => mesh.userData.objectId === 'platform_boundary').length, 0);

  const houseScene = readFileSync('app/src/render/HouseScene.ts', 'utf8');
  assert.match(houseScene, /buildScene\(/);
  assert.doesNotMatch(houseScene, /decorations\.createPlatform/);
});

test('shared SceneBuilder uses rounded platform contours with stable view-only metadata', () => {
  const height = 0.3;
  const result = buildScene({
    rooms: [],
    platform: {
      id: 'rounded_platform', name: 'Rounded Platform', x: 2, z: 1, width: 4, depth: 3, height,
      points: [
        { x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3, radius: 0.5, cx: 0.5, cz: 2.5 },
      ],
    },
    walls: [],
    elements: [],
  });
  const platform = result.viewOnlyRoot.getObjectByName('platform_boundary') as THREE.Mesh;
  assert.ok(platform);
  assert.equal(platform.parent, result.viewOnlyRoot);
  assert.equal(platform.userData.type, 'platform');
  assert.equal(platform.userData.roomId, 'rounded_platform');
  assert.ok(platform.geometry instanceof THREE.ExtrudeGeometry);
  platform.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(platform);
  assert.ok(Math.abs(bbox.min.y) < 1e-6);
  assert.ok(Math.abs(bbox.max.y - height) < 1e-6);
  assert.ok(bbox.min.x >= -1e-6 && bbox.max.x <= 4 + 1e-6);
  assert.ok(bbox.min.z >= -1e-6 && bbox.max.z <= 3 + 1e-6);
  const position = platform.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    assert.ok(!(Math.abs(position.getX(i)) < 1e-6 && Math.abs(position.getY(i) + 3) < 1e-6), 'rounded platform must replace the sharp corner');
  }
  assert.equal(result.exportRoot.getObjectByName('platform_boundary'), undefined);
});

test('shared SceneBuilder keeps export and view-only roots stable for the browser contract', () => {
  const result = buildScene({
    rooms: [{ id: 'room', name: 'Room', x: 0, z: 0, width: 4, depth: 3, height: 2.8, type: 'public', boundary_count: 4 }],
    walls: [],
    elements: [{ type: 'floor_region', id: 'region', room: 'room', points: [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }] }],
    platform: { id: 'platform', name: 'Platform', x: 3, z: 0, width: 1, depth: 1, height: 0.15 },
  });
  assert.equal(result.scene.children.map((child) => child.name).join(','), 'HOUSE_EXPORT,HOUSE_VIEW_ONLY');
  assert.equal(result.exportRoot.getObjectByName('floor:room')?.parent, result.exportRoot);
  assert.equal(result.viewOnlyRoot.getObjectByName('platform_boundary')?.parent, result.viewOnlyRoot);
  assert.equal(result.exportRoot.getObjectByName('platform_boundary'), undefined);
  assert.equal(result.viewOnlyRoot.getObjectByName('region'), undefined);
});

test('shared SceneBuilder restores HEAD default material colors and shaft semantics', () => {
  const result = buildScene({
    rooms: [
      { id: 'room', name: 'Room', x: 0, z: 0, width: 2, depth: 2, height: 2.8, type: 'public', boundary_count: 4 },
      { id: 'elevator_shaft', name: 'Shaft', x: 4, z: 0, width: 2, depth: 2, height: 2.8, type: 'service', boundary_count: 4 },
    ],
    walls: [{ id: 'wall:normal', x1: -1, z1: -1, x2: 1, z2: -1 }, { id: 'wall:elev', x1: 3, z1: -1, x2: 5, z2: -1 }],
    elements: [
      { type: 'wall', id: 'wall:normal', x1: -1, z1: -1, x2: 1, z2: -1 },
      { type: 'wall', id: 'wall:elev', x1: 3, z1: -1, x2: 5, z2: -1 },
    ],
  });
  const roomFloor = result.exportRoot.getObjectByName('floor:room') as THREE.Mesh;
  const ceiling = result.exportRoot.getObjectByName('ceiling:room') as THREE.Mesh;
  // 电梯井不属于套内：不生成地面/天花（HEAD 语义，俯视留空）
  assert.equal(result.exportRoot.getObjectByName('floor:elevator_shaft'), undefined);
  assert.equal(result.exportRoot.getObjectByName('ceiling:elevator_shaft'), undefined);
  assert.equal((roomFloor.material as THREE.MeshStandardMaterial).color.getHexString(), 'e8e0d5');
  assert.equal((ceiling.material as THREE.MeshStandardMaterial).color.getHexString(), 'f5f5f5');
  assert.equal(((result.exportRoot.getObjectByName('wall:normal') as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString(), 'f7f5ef');
  assert.equal(((result.exportRoot.getObjectByName('wall:elev') as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString(), '555555');
});

test('floor regions are coplanar with room floors and rounded railings use a continuous ribbon', () => {
  const result = buildScene({
    rooms: [{ id: 'room', name: 'Room', x: 0, z: 0, width: 4, depth: 4, height: 2.8, type: 'public', boundary_count: 4 }],
    walls: [],
    elements: [{
      type: 'railing_run',
      id: 'vrv_nw_railing',
      points: [
        { x: 0, z: 1 },
        { x: 0, z: 0, radius: 1, cx: 1, cz: 1 },
        { x: 2, z: 0 },
      ],
      height: 1,
    }, {
      type: 'floor_region',
      id: 'region',
      points: [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }],
    }],
  });
  const roomFloor = result.exportRoot.getObjectByName('floor:room') as THREE.Mesh;
  const region = result.exportRoot.getObjectByName('region') as THREE.Mesh;
  assert.equal(roomFloor.position.y, region.position.y);
  roomFloor.updateMatrixWorld(true);
  region.updateMatrixWorld(true);
  const roomBox = new THREE.Box3().setFromObject(roomFloor);
  const regionBox = new THREE.Box3().setFromObject(region);
  assert.ok(Math.abs(roomBox.min.y - regionBox.min.y) < 1e-9);
  assert.ok(Math.abs(roomBox.max.y - regionBox.max.y) < 1e-9);
  assert.equal((roomFloor.material as THREE.MeshStandardMaterial).polygonOffset, false);
  const regionMaterial = region.material as THREE.MeshStandardMaterial;
  assert.equal(regionMaterial.polygonOffset, true);
  assert.equal(regionMaterial.polygonOffsetFactor, -1);
  assert.equal(regionMaterial.polygonOffsetUnits, -1);

  const railing = result.exportRoot.getObjectByName('vrv_nw_railing') as THREE.Mesh;
  assert.ok(railing.geometry instanceof THREE.ExtrudeGeometry);
  railing.updateMatrixWorld(true);
  const railingBox = new THREE.Box3().setFromObject(railing);
  assert.ok(Math.abs(railingBox.max.y - 1) < 1e-9);
  const positions = railing.geometry.getAttribute('position');
  assert.ok(positions.count > 100, 'rounded railing should be sampled as a continuous ribbon');
  assert.ok(railingBox.min.x > -0.04 && railingBox.max.x < 2.04, `unexpected railing x bounds: ${railingBox.min.x}..${railingBox.max.x}`);
});

test('real overlay/model geometry keeps VRV arc and west platform rounded and view-only', () => {
  const model = load(readTextFile('config/layout/model-geometry.yaml', 'utf8')) as Parameters<typeof resolveLayout>[0];
  const layout = resolveLayout(model);
  const overlay = parseOverlay(readTextFile('config/layout/overlay.yaml', 'utf8'));
  const elements = mergeSceneElements(layout.walls, overlay);
  const railing = elements.find((element) => element.id === 'vrv_nw_railing');
  assert.equal(railing?.type, 'railing_run');
  assert.deepEqual(railing?.points.find((point) => point.radius === 1), { x: 5.6, z: 0, radius: 1, cx: 6.6, cz: 1 });
  const result = buildScene({ rooms: layout.rooms, platform: layout.platform, walls: layout.walls, elements });
  const railingMesh = result.exportRoot.getObjectByName('vrv_nw_railing') as THREE.Mesh;
  assert.ok(railingMesh.geometry instanceof THREE.ExtrudeGeometry);
  railingMesh.updateMatrixWorld(true);
  const railingBox = new THREE.Box3().setFromObject(railingMesh);
  assert.ok(railingBox.min.x >= 5.56 && railingBox.max.x <= 7.21);
  assert.ok(railingBox.min.z >= -0.04 && railingBox.max.z <= 1.11);
  const railingPositions = railingMesh.geometry.getAttribute('position');
  assert.ok(railingPositions.count > 100);
  const platformMesh = result.viewOnlyRoot.getObjectByName('platform_boundary') as THREE.Mesh;
  assert.ok(platformMesh);
  assert.equal(result.exportRoot.getObjectByName('platform_boundary'), undefined);
  platformMesh.updateMatrixWorld(true);
  const platformBox = new THREE.Box3().setFromObject(platformMesh);
  assert.ok(platformBox.min.x >= 5.59 && platformBox.max.x <= 7.21);
  assert.ok(platformBox.min.z >= -0.01 && platformBox.max.z <= 1.01);
  assert.ok(platformMesh.geometry instanceof THREE.ExtrudeGeometry);
});

test('shared render builders do not depend on browser globals', () => {
  for (const file of ['SceneBuilder.ts', 'InfrastructureBuilder.ts', 'layout-bounds.ts', 'CeilingZoneBuilder.ts']) {
    const source = readFileSync(`shared/render/${file}`, 'utf8');
    assert.doesNotMatch(source, /\b(window|document|HTMLCanvasElement|fetch)\b/);
  }
});
