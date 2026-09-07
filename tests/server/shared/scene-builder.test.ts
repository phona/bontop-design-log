import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { buildFixture, getNorthWallWardrobe950DoorAabb, getRecipeTypes, setNorthWallWardrobe950DoorConfiguration, setNorthWallWardrobe950DoorState, setPartitionWardrobeDoorState, type NorthWallWardrobe950DoorConfiguration } from '../../../shared/render/FixtureFactory.js';
import { buildScene } from '../../../shared/render/SceneBuilder.js';
import { buildCliHouseScene } from '../../../scripts/render/glb/cli-glb-builder.js';
import { getPartitionWardrobeDoorAabbs } from '../../../shared/types.js';
import type { LightingRenderConfig, RenderLightingFixture, SceneElement } from '../../../shared/types.js';
import { readFileSync as readTextFile } from 'node:fs';
import { load } from 'js-yaml';
import { resolveLayout } from '../../../server/layout-resolver.js';
import { parseOverlay, mergeSceneElements } from '../../../server/overlay-merge.js';

test('FixtureFactory exposes R5 wardrobe, bedside cabinets, and connection storage parts with material roles', () => {
  for (const type of ['master_partition_wardrobe_1600', 'master_bedside_cabinet_350_north', 'master_bedside_cabinet_350_south', 'master_dressing_connection_storage']) {
    const fixture = buildFixture(type);
    assert.ok(fixture, type);
    fixture.updateMatrixWorld(true);
    const parts: THREE.Object3D[] = [];
    fixture.traverse((object) => { if (object.userData.part) parts.push(object); });
    assert.ok(parts.length > 0, type);
    assert.ok(parts.every((part) => part.userData.materialRole), `${type} material roles`);
    assert.ok(parts.every((part) => part.userData.part), `${type} part metadata`);
    const bounds = new THREE.Box3().setFromObject(fixture);
    assert.ok(bounds.max.y > bounds.min.y && bounds.max.x > bounds.min.x && bounds.max.z > bounds.min.z, `${type} must have real mesh AABB`);
  }
  const wardrobe = buildFixture('master_partition_wardrobe_1600');
  assert.ok(wardrobe);
  const wardrobeParts: string[] = [];
  wardrobe.traverse((object) => { if (object.userData.part) wardrobeParts.push(String(object.userData.part)); });
  assert.equal(wardrobeParts.filter((part) => /^partition-door-\d+$/.test(part)).length, 4);
  assert.equal(wardrobeParts.filter((part) => part.startsWith('partition-hinge-')).length, 4);
  const partZ = new Map<string, number>();
  wardrobe.traverse((object) => { if (object.userData.part) partZ.set(String(object.userData.part), object.position.z); });
  assert.ok((partZ.get('furniture-back-panel') ?? 0) < 0, 'back panel must stay on the north/-z side');
  const doorParts = new Set(['partition-door-', 'partition-door-seam-', 'partition-handle-', 'partition-hinge-']);
  wardrobe.updateMatrixWorld(true);
  wardrobe.traverse((object) => {
    const part = String(object.userData.part ?? '');
    if (![...doorParts].some((prefix) => part.startsWith(prefix))) return;
    const box = new THREE.Box3().setFromObject(object);
    assert.ok(box.min.z >= 0.27, `${part} world geometry must stay on the south/+z face`);
  });
  const doorRoots: THREE.Object3D[] = [];
  wardrobe.traverse((object) => { if (object.userData.materialRole === 'door_root') doorRoots.push(object); });
  assert.equal(doorRoots.length, 4);
  assert.deepEqual(doorRoots.map((root) => root.userData.state), ['closed', 'closed', 'closed', 'closed']);
  assert.deepEqual(doorRoots.map((root) => root.userData.openLimitDeg), [95, 95, 95, 95]);
});

test('R5 partition wardrobe door AABBs keep the south-face/+z opening contract', () => {
  const closed = getPartitionWardrobeDoorAabbs('closed');
  const open = getPartitionWardrobeDoorAabbs('open');
  assert.equal(closed.length, 4);
  assert.equal(open.length, 4);
  for (const [index, door] of open.entries()) {
    assert.ok(door.minZ > closed[index].maxZ, `door ${index + 1} opens toward +z`);
    assert.ok(door.minX >= closed[index].minX - 1e-9 && door.maxX <= closed[index].maxX + 1e-9, `door ${index + 1} does not expand west/east`);
  }
});

test('R5 partition wardrobe recipe remains available for legacy data', () => {
  const wardrobe = buildFixture('master_partition_wardrobe_1600');
  assert.ok(wardrobe);
  const roots: THREE.Object3D[] = [];
  wardrobe.traverse((object) => { if (object.userData.materialRole === 'door_root') roots.push(object); });
  assert.equal(roots.length, 4);
  wardrobe.updateMatrixWorld(true);
  const closedWardrobeBox = new THREE.Box3().setFromObject(wardrobe);
  const closedBoxes = roots.map((root) => new THREE.Box3().setFromObject(root));

  for (const [index, root] of roots.entries()) {
    setPartitionWardrobeDoorState(root, 'open');
    wardrobe.updateMatrixWorld(true);
    const openBox = new THREE.Box3().setFromObject(root);
    const closedBox = closedBoxes[index];
    assert.notDeepEqual(openBox.min.toArray(), closedBox.min.toArray(), `door ${index + 1} open AABB must change`);
    assert.ok(openBox.max.z > closedBox.max.z, `door ${index + 1} must open toward south/+z`);
    assert.ok(Math.abs(root.rotation.y) > THREE.MathUtils.degToRad(90), `door ${index + 1} must rotate root`);
    assert.equal(root.userData.state, 'open');
    assert.equal(root.userData.rotationDeg, index % 2 === 0 ? -95 : 95);
    setPartitionWardrobeDoorState(root, 'closed');
  }

  setPartitionWardrobeDoorState(wardrobe, 'open', 0);
  setPartitionWardrobeDoorState(wardrobe, 'open', 1);
  wardrobe.updateMatrixWorld(true);
  assert.deepEqual(roots.map((root) => root.userData.state), ['open', 'open', 'closed', 'closed']);
  const adjacentOpenBox = new THREE.Box3().setFromObject(wardrobe);
  assert.ok(adjacentOpenBox.max.z > closedWardrobeBox.max.z, 'adjacent open doors must extend south of the closed cabinet');
  assert.ok(adjacentOpenBox.min.x >= closedWardrobeBox.min.x - 1e-6 && adjacentOpenBox.max.x <= closedWardrobeBox.max.x + 1e-6, 'adjacent open doors must stay inside the closed cabinet x envelope');

  setPartitionWardrobeDoorState(wardrobe, 'open');
  wardrobe.updateMatrixWorld(true);
  assert.deepEqual(roots.map((root) => root.userData.state), ['open', 'open', 'open', 'open']);
  const allOpenBox = new THREE.Box3().setFromObject(wardrobe);
  assert.ok(allOpenBox.max.z > adjacentOpenBox.max.z - 1e-6);
  assert.ok(allOpenBox.min.x >= closedWardrobeBox.min.x - 1e-6 && allOpenBox.max.x <= closedWardrobeBox.max.x + 1e-6, 'all open doors must stay inside the closed cabinet x envelope');
});

test('R6 bedside centers remain fixed while real mesh height is 0.495–0.505m', () => {
  const house = load(readTextFile('config/house.yaml', 'utf8')) as { furnishings: { master_bedroom: Array<{ type: string; z?: number }> } };
  const master = house.furnishings.master_bedroom;
  assert.equal(master.find((item) => item.type === 'bed_180')?.z, 7.40);
  assert.equal(master.find((item) => item.type === 'master_bedside_cabinet_350_north')?.z, 6.245);
  assert.equal(master.find((item) => item.type === 'master_bedside_cabinet_350_south')?.z, 8.555);
  for (const type of ['master_bedside_cabinet_350_north', 'master_bedside_cabinet_350_south']) {
    const fixture = buildFixture(type);
    assert.ok(fixture);
    fixture.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fixture);
    assert.ok(box.max.y >= 0.495 && box.max.y <= 0.506, `${type} maxY=${box.max.y}`);
  }
  const bedMinZ = 6.47;
  const bedMaxZ = 8.33;
  const northMaxZ = 6.245 + 0.35 / 2;
  const southMinZ = 8.555 - 0.35 / 2;
  assert.ok(northMaxZ < bedMinZ, 'north 350mm cabinet must stay north of the R6 bed');
  assert.ok(southMinZ > bedMaxZ, 'south 350mm cabinet must stay south of the R6 bed');
});

test('FixtureFactory keeps R6 bedside and legacy connection-storage runtime AABBs inside declared dimensions', () => {
  for (const type of ['master_bedside_cabinet_350_north', 'master_bedside_cabinet_350_south', 'master_dressing_connection_storage']) {
    const fixture = buildFixture(type);
    assert.ok(fixture, type);
    fixture.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(fixture);
    const expected = type === 'master_dressing_connection_storage'
      ? { width: 0.70, depth: 0.40 }
      : { width: 0.38, depth: 0.35 };
    assert.ok(Math.abs(bounds.max.x - bounds.min.x - expected.width) < 1e-6, `${type} runtime width`);
    if (type === 'master_dressing_connection_storage') assert.ok(Math.abs(bounds.max.z - bounds.min.z - expected.depth) < 1e-6, `${type} runtime depth`);
    else assert.ok(bounds.max.z - bounds.min.z <= expected.depth + 0.02, `${type} runtime depth`);
    assert.ok(bounds.min.z >= -expected.depth / 2 - 1e-6, `${type} runtime minZ stays within declared envelope`);
    assert.ok(bounds.max.z <= expected.depth / 2 + 1e-6, `${type} runtime maxZ stays within declared envelope`);
  }
});

test('FixtureFactory builds the R6 north wardrobe, dressing table, stool, and washbasin-only cabinet to frozen dimensions', () => {
  const table = buildFixture('master_dressing_table');
  const stool = buildFixture('dressing_stool');
  const washbasin = buildFixture('mb_washbasin_cabinet');
  assert.ok(table);
  assert.ok(stool);
  assert.ok(washbasin);

  table.updateMatrixWorld(true);
  stool.updateMatrixWorld(true);
  washbasin.updateMatrixWorld(true);
  const tableBox = new THREE.Box3().setFromObject(table);
  const stoolBox = new THREE.Box3().setFromObject(stool);
  const washbasinBox = new THREE.Box3().setFromObject(washbasin);
  // 2026-09-03 冻结口径 900W×450D×750H：以桌面板件包络为准（桌腿圆柱渲染半径外扩整体 bbox，不作冻结口径）
  let tableTop: THREE.Object3D | undefined;
  table.traverse((object) => { if (object.userData.part === 'rounded-top') tableTop = object; });
  assert.ok(tableTop, 'missing rounded-top part');
  const tableTopBox = new THREE.Box3().setFromObject(tableTop);
  assert.ok(Math.abs((tableTopBox.max.x - tableTopBox.min.x) - 0.90) < 1e-6);
  assert.ok(Math.abs((tableTopBox.max.z - tableTopBox.min.z) - 0.45) < 1e-6);
  assert.ok(Math.abs(tableTopBox.max.y - 0.75) < 1e-6, 'tabletop stays at the frozen 0.75m height');
  assert.ok(Math.abs(tableBox.max.y - 1.31) < 1e-6, 'tabletop mirror is self-supported above the 0.75m table');
  assert.ok(Math.abs((stoolBox.max.x - stoolBox.min.x) - 0.42) < 1e-6);
  assert.ok(Math.abs((stoolBox.max.z - stoolBox.min.z) - 0.40) < 1e-6);
  assert.ok(Math.abs(stoolBox.max.y - 0.45) < 1e-6);
  assert.ok(Math.abs((washbasinBox.max.x - washbasinBox.min.x) - 1.05) < 1e-6);
  assert.ok(Math.abs((washbasinBox.max.z - washbasinBox.min.z) - 0.50) < 1e-6);

  const tableParts: string[] = [];
  table.traverse((object) => { if (object.userData.part) tableParts.push(object.userData.part); });
  assert.ok(tableParts.includes('rounded-top'));
  assert.ok(tableParts.includes('thin-drawer'));
  assert.ok(tableParts.includes('tabletop-mirror'));
  assert.ok(tableParts.includes('plug-in-light'));

  const washbasinParts: string[] = [];
  washbasin.traverse((object) => { if (object.userData.part) washbasinParts.push(object.userData.part); });
  assert.ok(washbasinParts.includes('east-storage-carcass'));
  assert.ok(washbasinParts.includes('east-drawer-upper'));
  assert.ok(washbasinParts.includes('east-drawer-lower'));
  assert.ok(!washbasinParts.some((part) => part.includes('dresser') || part.includes('knee')));
});

test('FixtureFactory builds the south-band low dresser with six drawers below the 2.07m sill', () => {
  // 2026-09-04 R1 新增：1400W×480D×850H 轻中古六抽矮柜，局部 +z 为正面
  const dresser = buildFixture('master_hot_season_low_dresser');
  assert.ok(dresser);
  dresser.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(dresser);
  // 冻结口径 1400W×480D 以台面顶板包络为准（抽屉把手五金突出不计入，与桌腿圆柱口径一致）
  let topPanel: THREE.Object3D | undefined;
  dresser.traverse((object) => { if (object.userData.part === 'top-panel') topPanel = object; });
  assert.ok(topPanel, 'missing top-panel part');
  const topBox = new THREE.Box3().setFromObject(topPanel);
  assert.ok(Math.abs((topBox.max.x - topBox.min.x) - 1.40) < 1e-6);
  assert.ok(Math.abs((topBox.max.z - topBox.min.z) - 0.48) < 1e-6);
  assert.ok(box.max.y <= 0.85 + 1e-6, 'dresser top stays at 0.85m, below the 2.07m sill');
  const parts: string[] = [];
  dresser.traverse((object) => { if (object.userData.part) parts.push(object.userData.part); });
  assert.equal(parts.filter((part) => part.startsWith('drawer-front-')).length, 6, 'six drawer fronts');
  assert.equal(parts.filter((part) => part.startsWith('leg-')).length, 4, 'four thin legs');
});

test('FixtureFactory builds the master-bedroom vanity types as independent scene objects', () => {
  const types = ['mb_vanity_base_cabinet', 'mb_vanity_lower_board', 'mb_vanity_main_board'];
  const pvcTypes = ['mb_vanity_pvc_box', 'mb_vanity_pvc_wardrobe_entry', 'mb_vanity_pvc_service_chase'];
  assert.deepEqual(types.every((type) => getRecipeTypes().includes(type)), true);
  assert.equal(getRecipeTypes().includes('mb_vanity_continuous_closure_cabinet'), false);
  for (const type of types) {
    const fixture = buildFixture(type);
    assert.ok(fixture, type);
    assert.equal(fixture.children.length > 0, true, type);
    assert.ok(fixture.children.every((child) => child.userData.part), type);
  }

  const along = 3.61;
  const result = buildScene({
    rooms: [{ id: 'master_bedroom', name: '主卧', x: 2.1, z: 5.55, width: 4.2, depth: 4.25, height: 2.8, type: 'private', boundary_count: 4 }],
    walls: [{ id: 'w_mbath_east', x1: 2.6, z1: 1.1, x2: 2.6, z2: 4.3, height: 2.8 }],
    elements: [],
    furnishings: { master_bedroom: types.map((type) => ({ type, wall: 'w_mbath_east', wall_side: 'west' as const, along, rotation: 270 })) },
  });
  const groups = result.index.furnitureMeshes.filter((group) => types.includes(String(group.userData.objectId).split(':')[2]));
  assert.equal(groups.length, types.length);
  assert.deepEqual(groups.map((group) => group.userData.objectId), types.map((type, index) => `furniture:master_bedroom:${type}:${index}`));
  assert.equal(new Set(groups.map((group) => group.userData.objectId)).size, types.length);
  assert.deepEqual(groups.map((group) => group.position.z), types.map(() => along));
  assert.deepEqual(groups.map((group) => group.position.x).map((x) => Number(x.toFixed(4))), [2.2575, 2.2575, 2.2575]);
  assert.deepEqual(groups.map((group) => ({ wallId: group.userData.wallId, wallSide: group.userData.wallSide, anchorAlong: group.userData.anchorAlong })), types.map(() => ({ wallId: 'w_mbath_east', wallSide: 'west', anchorAlong: along })));

  result.exportRoot.updateMatrixWorld(true);
  const expectedWidths = [1.38, 1.38, 1.38];
  const expectedDepths = [0.565, 0.565, 0.565];
  const expectedYBounds = [[0.00, 0.62], [0.965, 1.035], [1.515, 1.585]];
  const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} !== ${expected}`);
  const boxes = groups.map((group) => new THREE.Box3().setFromObject(group));
  for (let index = 0; index < groups.length; index++) {
    close(boxes[index].min.y, expectedYBounds[index][0]);
    close(boxes[index].max.y, expectedYBounds[index][1]);
    assert.ok(boxes[index].min.z >= 2.92 - 1e-6 && boxes[index].max.z <= 4.30 + 1e-6);
    assert.ok(Math.abs(boxes[index].max.x - 2.54) < 1e-6, `${types[index]} must terminate at the w_mbath_east west finish`);
    assert.ok(Math.abs(boxes[index].min.x - 1.975) < 1e-6, `${types[index]} must start at x=1.975`);
    assert.ok(Math.abs((boxes[index].max.x - boxes[index].min.x) - expectedDepths[index]) < 1e-6);
    assert.ok(Math.abs(boxes[index].max.z - (along + expectedWidths[index] / 2)) < 1e-6);
    assert.ok(Math.abs(boxes[index].min.z - (along - expectedWidths[index] / 2)) < 1e-6);
  }
  assert.ok(boxes[0].max.y < boxes[1].min.y);
  assert.ok(boxes[1].max.y < boxes[2].min.y);

  const baseParts: THREE.Object3D[] = [];
  groups[0].traverse((object) => { if (object.userData.part) baseParts.push(object); });
  assert.deepEqual(baseParts.map((object) => object.userData.part), ['base-cabinet', 'base-plinth', 'base-front-reveal', 'base-door-seam']);
  for (const part of baseParts) {
    const partBox = new THREE.Box3().setFromObject(part);
    assert.ok(partBox.min.x >= 1.975 - 1e-6, `${part.userData.part} must not cross west side of vanity envelope: ${partBox.min.x}`);
    assert.ok(partBox.max.x <= 2.54 + 1e-6, `${part.userData.part} must not enter w_mbath_east wall/master_bath side: ${partBox.max.x}`);
    assert.ok(partBox.min.z >= 2.92 - 1e-6, `${part.userData.part} must not cross w_mbath_south bedroom finish: ${partBox.min.z}`);
    assert.ok(partBox.max.z <= 4.30 + 1e-6, `${part.userData.part} must remain aligned with the wardrobe end: ${partBox.max.z}`);
  }

  const routeResult = buildScene({
    rooms: [{ id: 'master_bedroom', name: '主卧', x: 2.1, z: 5.55, width: 4.2, depth: 4.25, height: 2.8, type: 'private', boundary_count: 4 }],
    walls: [{ id: 'w_mbath_east', x1: 2.6, z1: 1.1, x2: 2.6, z2: 4.3, height: 2.8 }],
    elements: [],
    furnishings: {
      master_bedroom: [
        { type: 'condensate_pipe_ac_outlet', x: 3.80, z: 5.10, rotation: 0 },
        { type: 'mb_vanity_pvc_box', wall: 'w_mbath_east', wall_side: 'west', along: 3.70, rotation: 270 },
        { type: 'mb_vanity_pvc_wardrobe_entry', x: 4.10, z: 4.62, rotation: 0 },
        { type: 'mb_vanity_pvc_service_chase', x: 2.925, z: 4.62, rotation: 0 },
      ],
    },
  });
  routeResult.exportRoot.updateMatrixWorld(true);
  const routeGroups = routeResult.index.furnitureMeshes;
  assert.equal(routeGroups.length, 4);
  const routeAabbs = routeGroups.map((group) => new THREE.Box3().setFromObject(group));
  const wallRun = routeAabbs[1];
  let wallPipe: THREE.Object3D | undefined;
  routeGroups[1].traverse((object) => { if (object.userData.part === 'condensate-pipe-wall-run') wallPipe = object; });
  assert.ok(wallPipe, 'wall route pipe must be present under the visible trim fixture');
  wallPipe!.updateMatrixWorld(true);
  const wallPipeAabb = new THREE.Box3().setFromObject(wallPipe!);
  const entry = routeAabbs[2];
  const service = routeAabbs[3];
  assert.ok(wallPipeAabb.min.x > 2.48 && wallPipeAabb.max.x < 2.52, `wall route pipe must stay clear of w_mbath_east west finish: ${wallPipeAabb.min.x}..${wallPipeAabb.max.x}`);
  assert.ok(wallPipeAabb.min.z >= 3.10 - 0.02 && wallPipeAabb.max.z <= 4.30 + 0.02, 'wall route pipe must occupy the resolved w_mbath_east west-side band');
  assert.ok(wallRun.min.x >= 2.46 - 0.01 && wallRun.max.x <= 2.54 + 0.01, 'visible wall trim must stay within the west-finish band');
  assert.ok(entry.min.x <= 2.925 + 0.03 && entry.max.x >= 4.10 - 0.03, 'entry must run from the wall endpoint to the wardrobe east edge');
  assert.ok(entry.min.z >= 4.62 - 0.03 && entry.max.z <= 4.62 + 0.03, 'entry must be a straight westbound segment without a midpoint branch');
  assert.ok(service.min.x <= 2.0 + 0.03 && service.max.x >= 2.50 - 0.03, 'service chase must reach the wall-side short fold and candidate x=2.0');
  assert.ok(service.min.z <= 2.5 + 0.03 && service.max.z >= 4.62 - 0.03, 'service chase must connect the wardrobe service band to the master-bath candidate');
  assert.ok(service.min.y <= 0.1 + 0.03, 'candidate drop must reach the declared 0.1m endpoint instead of floating');
  const findPart = (root: THREE.Object3D, part: string): THREE.Object3D | undefined => {
    let found: THREE.Object3D | undefined;
    root.traverse((object) => { if (!found && object.userData.part === part) found = object; });
    return found;
  };
  const wallTrim = findPart(routeGroups[1], 'condensate-wall-trim');
  const shortFoldTrim = findPart(routeGroups[3], 'condensate-wall-trim-short-fold');
  const southWallTrim = findPart(routeGroups[3], 'condensate-wall-trim-to-south-wall');
  assert.ok(wallTrim && shortFoldTrim && southWallTrim, 'white wall trim must include the continuous south-wall closure');
  const wallTrimBox = new THREE.Box3().setFromObject(wallTrim!);
  const shortFoldTrimBox = new THREE.Box3().setFromObject(shortFoldTrim!);
  const southWallTrimBox = new THREE.Box3().setFromObject(southWallTrim!);
  assert.ok(shortFoldTrimBox.min.x <= 2.30 + 1e-6 && shortFoldTrimBox.max.x >= 2.50 - 1e-6, 'short-fold trim must cover the z=3.10 turn and meet the wall finish');
  assert.ok(Math.abs(southWallTrimBox.min.z - 2.92) < 1e-6, `south-wall trim must touch the bedroom-side finished face at z=2.92: ${southWallTrimBox.min.z}`);
  const boxGap = (a: THREE.Box3, b: THREE.Box3): number => Math.hypot(
    Math.max(a.min.x - b.max.x, b.min.x - a.max.x, 0),
    Math.max(a.min.y - b.max.y, b.min.y - a.max.y, 0),
    Math.max(a.min.z - b.max.z, b.min.z - a.max.z, 0),
  );
  assert.ok(boxGap(wallTrimBox, shortFoldTrimBox) < 1e-6, 'main wall trim and short-fold trim must meet');
  assert.ok(boxGap(shortFoldTrimBox, southWallTrimBox) < 1e-6, 'short-fold trim and south-wall trim must meet');
  assert.ok([wallTrim, shortFoldTrim, southWallTrim].every((object) => object!.userData.inspectionLayer === 'pipe-chase' && object!.userData.inspectionOpacity === 0.18), 'all closure trim must follow the declared inspection layer');
  assert.ok(routeGroups[1].userData.wallId === 'w_mbath_east' && routeGroups[1].userData.wallSide === 'west');
  assert.ok(routeAabbs.every((box) => box.max.y <= 2.80 + 1e-6));
  const routeParts: THREE.Object3D[] = [];
  routeResult.exportRoot.traverse((object) => { if (String(object.userData.part ?? '').startsWith('condensate-pipe-')) routeParts.push(object); });
  assert.equal(routeParts.length, 10, 'wall/wardrobe condensate route must have ten ordered pipe segments without an outlet rise branch');
  assert.equal(routeParts.some((object) => object.userData.part === 'condensate-pipe-ac-outlet-rise-to-wall-run'), false);
  assert.ok(routeParts.every((object) => object.userData.inspectionVisibleOnly === true && object.visible === false));
  const wardrobe = buildFixture('master_north_wall_wardrobe_950');
  assert.ok(wardrobe);
  const inspectionParts: THREE.Object3D[] = [];
  wardrobe!.traverse((object) => { if (object.userData.inspectionLayer === 'pipe-chase') inspectionParts.push(object); });
  assert.deepEqual(inspectionParts.map((object) => object.userData.part), ['north-wardrobe-950-carcass', 'north-wardrobe-950-back-panel', 'north-wardrobe-950-concealed-pipe-chase', 'north-wardrobe-950-fixed-top-panel']);
  assert.ok(inspectionParts.every((object) => object.userData.inspectionOpacity === 0.18));
});

test('FixtureFactory gives tv_65 frame and screen stable part metadata', () => {
  const fixture = buildFixture('tv_65');
  assert.ok(fixture);
  const parts: THREE.Object3D[] = [];
  fixture.traverse((object) => { if (object.userData.part) parts.push(object); });
  assert.deepEqual(parts.map((object) => ({
    part: object.userData.part,
    materialRole: object.userData.materialRole,
  })), [
    { part: 'frame', materialRole: 'tv_frame' },
    { part: 'screen', materialRole: 'tv_screen' },
  ]);
});

test('FixtureFactory assigns stable material roles to kitchen appliance surfaces', () => {
  const expectedRoles = {
    sink: ['ceramic', 'ceramic', 'ceramic', 'ceramic', 'ceramic', 'ceramic', 'ceramic', 'ceramic', 'ceramic'],
    dishwasher: ['body', 'fixture_metal'],
  } as const;

  for (const [type, roles] of Object.entries(expectedRoles)) {
    const fixture = buildFixture(type);
    assert.ok(fixture);
    const parts: THREE.Object3D[] = [];
    fixture.traverse((object) => { if (object.userData.part) parts.push(object); });
    assert.deepEqual(parts.map((object) => object.userData.materialRole), roles, type);
  }
});

test('FixtureFactory models gas_stove with readable burners, knobs, and stable bounds', () => {
  const fixture = buildFixture('gas_stove');
  assert.ok(fixture);
  const parts: THREE.Object3D[] = [];
  fixture.traverse((object) => { if (object.userData.part) parts.push(object); });
  assert.equal(parts.length, 22);
  const burners = parts.filter((part) => String(part.userData.part).startsWith('burner-'));
  const knobs = parts.filter((part) => String(part.userData.part).startsWith('knob-'));
  const edges = parts.filter((part) => String(part.userData.part).startsWith('cooktop-edge-'));
  const base = parts.find((part) => part.userData.part === 'cooktop-base');
  const surface = parts.find((part) => part.userData.part === 'cooktop-surface');
  assert.equal(burners.length, 12);
  assert.equal(edges.length, 4);
  assert.equal(knobs.length, 4);
  assert.equal(base?.userData.materialRole, 'fixture_metal', 'stove base must retain fixture_metal role');
  assert.equal(surface?.userData.materialRole, 'cooktop_surface', 'stove top must use cooktop_surface role');
  const baseMesh = base as THREE.Mesh;
  const surfaceMesh = surface as THREE.Mesh;
  assert.deepEqual((surfaceMesh.geometry as THREE.BoxGeometry).parameters, {
    width: 0.64, height: 0.004, depth: 0.34,
    widthSegments: 1, heightSegments: 1, depthSegments: 1,
  });
  assert.deepEqual(surfaceMesh.position.toArray(), [0, 0.881, 0], 'recessed surface must keep the stove center anchor');
  const baseBox = new THREE.Box3().setFromObject(baseMesh);
  const surfaceBox = new THREE.Box3().setFromObject(surfaceMesh);
  assert.ok(Math.abs(baseBox.max.y - 0.88) < 1e-6, 'cooktop support must seat at countertop height');
  assert.ok(Math.abs(surfaceBox.min.y - 0.879) < 1e-6 && Math.abs(surfaceBox.max.y - 0.883) < 1e-6, 'glass surface must sit just above the countertop');
  assert.ok(surfaceBox.max.x - surfaceBox.min.x <= 0.70 + 1e-6 && surfaceBox.max.z - surfaceBox.min.z <= 0.40 + 1e-6);
  assert.ok(edges.every((edge) => edge.userData.materialRole === 'cooktop_surface'), 'embedded edge must use cooktop_surface role');
  const edgeBoxes = edges.map((edge) => new THREE.Box3().setFromObject(edge));
  assert.ok(edgeBoxes.every((box) => Math.abs(box.max.y - 0.8795) < 1e-6 && Math.abs(box.min.y - 0.8785) < 1e-6), 'embedded edge must remain a narrow recessed interface');
  const edgeBounds = edgeBoxes.reduce((box, edgeBox) => box.union(edgeBox), new THREE.Box3());
  assert.ok(edgeBounds.min.x >= baseBox.min.x - 1e-6 && edgeBounds.max.x <= baseBox.max.x + 1e-6);
  assert.ok(edgeBounds.min.z >= baseBox.min.z - 1e-6 && edgeBounds.max.z <= baseBox.max.z + 1e-6);
  const burnerBoxes = burners.map((burner) => new THREE.Box3().setFromObject(burner));
  const burnerBounds = burnerBoxes.reduce((box, burnerBox) => box.union(burnerBox), new THREE.Box3());
  assert.ok(surfaceBox.min.x <= burnerBounds.min.x && surfaceBox.max.x >= burnerBounds.max.x, 'surface must fully cover burner x bounds');
  assert.ok(surfaceBox.min.z <= burnerBounds.min.z && surfaceBox.max.z >= burnerBounds.max.z, 'surface must fully cover burner z bounds');
  assert.ok(burnerBoxes.every((box) => box.min.y >= surfaceBox.max.y - 1e-6), 'burner rings must remain above the flush surface');
  assert.ok(burners.every((part) => part.userData.materialRole === 'cooktop_burner'), 'burners must use cooktop_burner role');
  assert.ok(knobs.every((part) => part.userData.materialRole === 'hardware'), 'knobs must use hardware role');
  assert.ok(parts.every((part) => part.name.length <= 63), 'fixture part names must fit Blender limits');

  const burnerGroups = new Map<string, THREE.Object3D[]>();
  for (const burner of burners) {
    const burnerId = String(burner.userData.part).replace(/-(?:outer-ring|inner-ring|center-cap)$/, '');
    const group = burnerGroups.get(burnerId) ?? [];
    group.push(burner);
    burnerGroups.set(burnerId, group);
  }
  assert.equal(burnerGroups.size, 4);
  for (const burnerParts of burnerGroups.values()) {
    assert.equal(burnerParts.length, 3);
    assert.deepEqual(burnerParts.map((part) => String(part.userData.part).split('-').at(-2)), ['outer', 'inner', 'center']);
    const cylinders = burnerParts.map((part) => {
      assert.equal((part as THREE.Mesh).geometry.type, 'CylinderGeometry');
      return (part as THREE.Mesh).geometry as THREE.CylinderGeometry;
    });
    assert.deepEqual(cylinders.map((geometry) => geometry.parameters.radiusTop), [0.045, 0.032, 0.018]);
    assert.deepEqual(cylinders.map((geometry) => geometry.parameters.height), [0.008, 0.014, 0.020]);
    assert.ok(burnerParts[0].position.y < burnerParts[1].position.y && burnerParts[1].position.y < burnerParts[2].position.y);
  }

  fixture.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(fixture);
  assert.ok(Math.abs(bounds.min.x + 0.33) < 1e-6 && Math.abs(bounds.max.x - 0.33) < 1e-6);
  assert.ok(Math.abs(bounds.min.z + 0.18) < 1e-6 && Math.abs(bounds.max.z - 0.185) < 1e-6);
  assert.ok(Math.abs(bounds.max.y - 0.945) < 1e-6);
  assert.ok(bounds.max.y <= 0.95, 'burner stack must stay below the reasonable cooktop height');
});

test('FixtureFactory models the sink as a raised rim, basin body, and recessed interior', () => {
  const fixture = buildFixture('sink');
  assert.ok(fixture);
  const parts: THREE.Object3D[] = [];
  fixture.traverse((object) => { if (object.userData.part) parts.push(object); });
  assert.deepEqual(parts.map((object) => object.userData.part), [
    'basin-rim-north', 'basin-rim-south', 'basin-rim-west', 'basin-rim-east',
    'basin-body-north', 'basin-body-south', 'basin-body-west', 'basin-body-east',
    'basin-interior',
  ]);
  assert.ok(parts.every((part) => part.userData.materialRole === 'ceramic'));

  fixture.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(fixture);
  assert.ok(Math.abs(bounds.min.x + 0.28) < 1e-6 && Math.abs(bounds.max.x - 0.28) < 1e-6);
  assert.ok(Math.abs(bounds.min.z + 0.21) < 1e-6 && Math.abs(bounds.max.z - 0.21) < 1e-6);
  assert.ok(Math.abs(bounds.min.y - 0.76) < 1e-6 && Math.abs(bounds.max.y - 0.92) < 1e-6);
  const rimTop = Math.max(...parts.filter((part) => String(part.userData.part).startsWith('basin-rim-')).map((part) => new THREE.Box3().setFromObject(part).max.y));
  const interiorTop = new THREE.Box3().setFromObject(parts.find((part) => part.userData.part === 'basin-interior')!).max.y;
  assert.ok(rimTop - interiorTop >= 0.12, 'basin must have a visible recessed interior');
});

test('shared SceneBuilder exports readable master-bedroom sockets as formal wall-projected objects', () => {
  const electrical = [
    { id: 'sock_master_bed_l', room: 'master_bedroom', wall: 'w_mb_east', wallSide: 'west' as const, type: 'socket' as const, x: 4.2, z: 6.2, height: 0.7 },
    { id: 'sock_master_bed_r_head', room: 'master_bedroom', wall: 'w_mb_east', wallSide: 'west' as const, type: 'socket' as const, x: 4.2, z: 7.5, height: 0.7 },
    { id: 'sock_master_bed_r', room: 'master_bedroom', wall: 'w_mb_east', wallSide: 'west' as const, type: 'socket' as const, x: 4.2, z: 9.15, height: 0.7 },
  ];
  const result = buildScene({
    rooms: [],
    walls: [{ id: 'w_mb_east', x1: 4.2, z1: 5.0, x2: 4.2, z2: 10.0, height: 2.8 }],
    elements: [],
    electrical,
  });
  assert.equal(result.report.electrical, electrical.length);
  assert.equal(result.index.electrical.size, electrical.length);
  result.exportRoot.updateMatrixWorld(true);
  const expectedZ = [6.2, 7.5, 9.15];
  for (const [index, point] of electrical.entries()) {
    const object = result.index.electrical.get(`electrical:${point.id}`);
    assert.ok(object);
    assert.equal(object.userData.objectId, `electrical:${point.id}`);
    assert.equal(object.parent, result.exportRoot);
    assert.equal(object.visible, true);
    assert.equal(object.userData.wallSide, 'west');
    assert.ok(Math.abs(object.position.x - 4.125) < 1e-9, 'socket must project 7.5cm onto the west face');
    assert.equal(object.position.y, 0.7);
    assert.ok(Math.abs(object.position.z - expectedZ[index]) < 1e-9);
    assert.ok(Math.abs(object.rotation.y + Math.PI / 2) < 1e-9, 'socket must face west');
    const bounds = new THREE.Box3().setFromObject(object);
    assert.ok(bounds.max.x - bounds.min.x > 0 && bounds.max.y - bounds.min.y > 0 && bounds.max.z - bounds.min.z > 0, 'socket placeholder must have non-zero exposed geometry');
    assert.ok(object.children.length >= 8, 'socket must expose box, faceplate, openings, and border parts without annotations');
  }
});

test('shared SceneBuilder exports configured lighting fixture geometry without lights', () => {
  const types = ['pendant', 'track_light', 'dome', 'ceiling_light', 'downlight', 'wall_lamp', 'led_strip'] as const;
  const fixtures: RenderLightingFixture[] = types.map((type, index) => ({
    id: `light-${type}-${index}`, room: 'room', type, position: { x: index, y: type === 'wall_lamp' ? 1.6 : 2.8, z: 0 }, temperatureK: 3000, enabled: true,
    ...(type === 'track_light' ? { heads: 3 } : {}), ...(type === 'downlight' ? { recessed: true } : {}),
  }));
  const result = buildScene({ rooms: [], walls: [], elements: [], lightingFixtures: fixtures });
  assert.equal(result.report.lightingFixtures, fixtures.length);
  assert.equal(result.index.lightingFixtures.size, fixtures.length);
  assert.equal(result.exportRoot.getObjectByName('LIGHTING_FIXTURES')?.parent, result.exportRoot);
  for (const fixture of fixtures) {
    const object = result.index.lightingFixtures.get(`electrical:${fixture.id}`);
    assert.ok(object);
    assert.equal(object.userData.type, 'lighting_fixture');
    assert.equal(object.userData.fixtureType, fixture.type);
    assert.equal(object.userData.roomId, fixture.room);
    assert.equal(object.parent, result.exportRoot.getObjectByName('LIGHTING_FIXTURES'));
  }
  const track = result.index.lightingFixtures.get('electrical:light-track_light-1')!;
  const heads = track.children.filter((object) => String(object.userData.part).startsWith('head:') && String(object.userData.part).endsWith(':lens'));
  assert.equal(heads.length, 3);
  let lights = 0;
  result.exportRoot.traverse((object) => { if (object instanceof THREE.Light) lights++; });
  assert.equal(lights, 0);
});

test('shared track fixture applies local z offsets and rail rotation to geometry', () => {
  const lighting: LightingRenderConfig = { fixtures: [{
    id: 'track-geometry-test', type: 'track_light', length: 2, heads: [{ offset: { x: 1, z: 0.25 }, target: { x: 0, y: -2.2, z: 1 }, purpose: 'sofa', role: '沙发重点照明' }],
    direction: { x: 0, y: -1, z: 0 }, beam: 0.7, energy: 9, rotation: { x: 0, y: Math.PI / 2, z: 0 },
  }] };
  const result = buildScene({
    rooms: [], walls: [], elements: [], options: { lighting },
    lightingFixtures: [{ id: 'track-geometry-test', room: 'room', type: 'track_light', position: { x: 10, y: 2.8, z: 20 }, temperatureK: 3000, enabled: true, heads: 1 }],
  });
  const track = result.index.lightingFixtures.get('electrical:track-geometry-test')!;
  assert.deepEqual(track.userData.headPurposes, [{ purpose: 'sofa', role: '沙发重点照明' }]);
  const lens = track.children.find((object) => object.userData.part === 'head:1:lens')!;
  assert.equal(lens.userData.purpose, 'sofa');
  assert.equal(lens.userData.role, '沙发重点照明');
  assert.ok(Math.abs(lens.position.x - 10.3085) < 0.01);
  assert.ok(Math.abs(lens.position.z - 19.0780) < 0.01);
  const head = track.children.find((object) => object.userData.part === 'head:1')!;
  track.updateMatrixWorld(true);
  const expected = new THREE.Vector3(0.75, -2.12, 1).normalize();
  const headAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
  const lensAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(lens.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(headAxis.dot(expected) > 1 - 1e-6);
  assert.ok(lensAxis.dot(expected) > 1 - 1e-6);
  const rail = track.children.find((object) => object.userData.part === 'track')!;
  assert.equal(rail.rotation.y, Math.PI / 2);
});

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

test('shared SceneBuilder keeps long furniture child names bounded and role-readable', () => {
  const result = buildScene({
    rooms: [],
    walls: [],
    elements: [],
    furnishings: {
      kitchen: [
        { type: 'sink', x: 9.5, z: 0.3 },
        { type: 'gas_stove', x: 10.5, z: 1.18 },
        { type: 'dishwasher', x: 8.8, z: 0.3 },
      ],
    },
  });
  const children: THREE.Object3D[] = [];
  result.exportRoot.traverse((object) => {
    if (object.userData.part && object.parent?.userData.type === 'furniture') children.push(object);
  });
  assert.ok(children.length > 0);
  assert.equal(new Set(children.map((child) => child.name)).size, children.length);
  assert.ok(children.every((child) => child.name.length <= 63));
  assert.ok(children.some((child) => child.name.includes(':part=') && child.name.endsWith(':role=ceramic')));
  assert.ok(children.some((child) => child.name.includes(':part=') && child.name.endsWith(':role=fixture_metal')));
  assert.ok(children.filter((child) => child.userData.materialRole && child.userData.materialRole !== 'body' && child.name.length > 63 - 1).every((child) => child.name.includes(':role=')));
  assert.ok(children.some((child) => child.userData.materialRole === 'body' && !child.name.includes(':role=body')));
  assert.ok(children.every((child) => child.name.startsWith('furniture:kitchen:')));
  assert.ok(result.exportRoot.getObjectByName('furniture:kitchen:sink:0'));
  assert.ok(result.exportRoot.getObjectByName('furniture:kitchen:gas_stove:1'));
  assert.ok(result.exportRoot.getObjectByName('furniture:kitchen:dishwasher:2'));
});

test('shared SceneBuilder places towel_set with stable metadata and local bounds', () => {
  const result = buildScene({
    rooms: [],
    walls: [],
    elements: [],
    furnishings: { master_bath: [{ type: 'towel_set', x: 0.24, z: 2.23, rotation: 0 }] },
  });
  const towelSet = result.exportRoot.getObjectByName('furniture:master_bath:towel_set:0');
  assert.ok(towelSet);
  assert.deepEqual(towelSet.position.toArray(), [0.24, 0, 2.23]);
  const parts: THREE.Object3D[] = [];
  towelSet.traverse((object) => { if (object.userData.part) parts.push(object); });
  assert.deepEqual(parts.map((object) => ({ part: object.userData.part, materialRole: object.userData.materialRole })), [
    { part: 'towel-bar', materialRole: 'hardware' },
    { part: 'towel', materialRole: 'fabric' },
  ]);
  towelSet.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(towelSet);
  assert.ok(Math.abs(box.min.x - 0.18) < 1e-6);
  assert.ok(Math.abs(box.max.x - 0.255) < 1e-6);
  assert.ok(Math.abs(box.min.z - 2.005) < 1e-6);
  assert.ok(Math.abs(box.max.z - 2.455) < 1e-6);
});

test('shared SceneBuilder deduplicates placed toilet and washer geometry against plumbing points', () => {
  const result = buildScene({
    rooms: [],
    walls: [],
    elements: [],
    furnishings: {
      master_bath: [{ type: 'toilet', x: 2.3, z: 1.5 }],
      balcony: [{ type: 'washer', x: 5.95, z: 1.5 }],
    },
    plumbing: [
      { id: 'toilet-point', room: 'master_bath', type: 'toilet', x: 2.6, z: 1.5 },
      { id: 'washer-point', room: 'balcony', type: 'washer', x: 5.6, z: 1.5, height: 0.8 },
      { id: 'faucet-point', room: 'master_bath', type: 'faucet', x: 2.6, z: 1.5, height: 0.8 },
    ],
  });
  assert.equal(result.report.furniture, 2);
  assert.equal(result.report.plumbing, 1);
  assert.deepEqual(result.report.skippedPlumbing, [
    'toilet-point:furnishing:master_bath:toilet',
    'washer-point:furnishing:balcony:washer',
  ]);
  assert.equal(result.index.plumbing.has('plumbing:toilet-point'), false);
  assert.equal(result.index.plumbing.has('plumbing:washer-point'), false);
  assert.equal(result.index.plumbing.has('plumbing:faucet-point'), true);
  assert.ok(result.exportRoot.getObjectByName('furniture:master_bath:toilet:0'));
  assert.ok(result.exportRoot.getObjectByName('furniture:balcony:washer:0'));
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

test('shared SceneBuilder opens model d_mbath inward into master_bath toward +z', () => {
  const layout = resolveLayout(load(readTextFile('config/layout/model-geometry.yaml', 'utf8')) as never);
  const wall = layout.walls.find((candidate) => candidate.id === 'w_mbath_south');
  assert.ok(wall);
  const element = {
    type: 'wall' as const,
    id: wall.id,
    x1: wall.x1,
    z1: wall.z1,
    x2: wall.x2,
    z2: wall.z2,
    height: wall.height,
    openings: wall.openings,
  };
  const result = buildScene({ rooms: layout.rooms, walls: [wall], elements: [element] });
  const panel = result.exportRoot.getObjectByName('d_mbath') as THREE.Mesh;
  assert.ok(panel);
  result.exportRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(panel);
  assert.ok(Math.abs(box.min.x - 1.93) < 1e-6, `d_mbath hinge-side x: ${box.min.x}`);
  assert.ok(Math.abs(box.max.x - 1.97) < 1e-6, `d_mbath hinge-side x: ${box.max.x}`);
  assert.ok(Math.abs(box.min.z - 2.06) < 1e-6, `d_mbath sweep start: ${box.min.z}`);
  assert.ok(Math.abs(box.max.z - 2.86) < 1e-6, `d_mbath sweep end: ${box.max.z}`);
  assert.ok(panel.position.z > 2.4, 'd_mbath panel must open toward the master_bath (+z) side');
});

test('shared SceneBuilder opens d_mb on the master_bath side of w_strip_east', () => {
  const layout = resolveLayout(load(readTextFile('config/layout/model-geometry.yaml', 'utf8')) as never);
  const wall = layout.walls.find((candidate) => candidate.id === 'w_strip_east');
  assert.ok(wall);
  const element = {
    type: 'wall' as const,
    id: wall.id,
    x1: wall.x1,
    z1: wall.z1,
    x2: wall.x2,
    z2: wall.z2,
    height: wall.height,
    openings: wall.openings,
  };
  const result = buildScene({ rooms: layout.rooms, walls: [wall], elements: [element] });
  const panel = result.exportRoot.getObjectByName('d_mb') as THREE.Mesh;
  assert.ok(panel);
  result.exportRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(panel);
  assert.ok(Math.abs(box.min.x - 3.3) < 1e-6, `d_mb sweep start: ${box.min.x}`);
  assert.ok(Math.abs(box.max.x - 4.2) < 1e-6, `d_mb wall-side edge: ${box.max.x}`);
  assert.ok(Math.abs(box.min.z - 4.63) < 1e-6, `d_mb hinge-side z: ${box.min.z}`);
  assert.ok(Math.abs(box.max.z - 4.67) < 1e-6, `d_mb hinge-side z: ${box.max.z}`);
  assert.ok(box.max.x <= wall.x1 + 1e-6, 'd_mb panel must open toward the master_bath (west) side');
});

test('shared SceneBuilder exports the R8 north wardrobe 950 with real hinged doors and declared dimensions', () => {
  const fixture = buildFixture('master_north_wall_wardrobe_950');
  assert.ok(fixture, 'missing master_north_wall_wardrobe_950 recipe');
  fixture.updateMatrixWorld(true);
  const closedBox = new THREE.Box3().setFromObject(fixture);
  assert.ok(Math.abs(closedBox.max.x - closedBox.min.x - 0.95) < 1e-6);
  assert.ok(Math.abs(closedBox.max.z - closedBox.min.z - 0.58) < 1e-6, `closed wardrobe full mesh depth=${closedBox.max.z - closedBox.min.z}`);
  assert.ok(Math.abs(closedBox.max.y - closedBox.min.y - 2.80) < 1e-6);
  assert.ok(Math.abs(closedBox.max.y - 2.80) < 1e-6, `wardrobe top must align with the 2.80m room clear height: ${closedBox.max.y}`);
  const roots: THREE.Object3D[] = [];
  fixture.traverse((object) => { if (object.userData.materialRole === 'door_root') roots.push(object); });
  assert.equal(roots.length, 3);
  assert.deepEqual(roots.map((root) => [root.userData.doorIndex, root.userData.hingeSide, root.userData.state, root.userData.openLimitDeg]), [[0, 'left', 'closed', 95], [1, 'right', 'closed', 95], [2, 'right', 'closed', 95]]);
  const closedDoorBoxes = roots.map((root) => new THREE.Box3().setFromObject(root));
  assert.ok(closedDoorBoxes.every((box) => box.max.z > 0.25), 'north wardrobe doors must face south/+z');
  setNorthWallWardrobe950DoorState(fixture, 'open', 0);
  fixture.updateMatrixWorld(true);
  assert.ok(Math.abs(roots[0].rotation.y) > THREE.MathUtils.degToRad(90));
  assert.equal(roots[0].userData.rotationDeg, -95);
  const openBox = new THREE.Box3().setFromObject(roots[0]);
  assert.notDeepEqual(openBox.min.toArray(), closedDoorBoxes[0].min.toArray());
  assert.ok(openBox.max.z > closedDoorBoxes[0].max.z, 'left north wardrobe door opens toward +z');
  assert.equal(getNorthWallWardrobe950DoorAabb(roots[0]).max.z, openBox.max.z);
  setNorthWallWardrobe950DoorState(fixture, 'closed');
});

function strictBoxIntersects(a: THREE.Box3, b: THREE.Box3, epsilon = 1e-6): boolean {
  return a.min.x < b.max.x - epsilon && a.max.x > b.min.x + epsilon
    && a.min.y < b.max.y - epsilon && a.max.y > b.min.y + epsilon
    && a.min.z < b.max.z - epsilon && a.max.z > b.min.z + epsilon;
}

function boxClearance(a: THREE.Box3, b: THREE.Box3): number {
  const dx = Math.max(a.min.x - b.max.x, b.min.x - a.max.x, 0);
  const dy = Math.max(a.min.y - b.max.y, b.min.y - a.max.y, 0);
  const dz = Math.max(a.min.z - b.max.z, b.min.z - a.max.z, 0);
  return Math.hypot(dx, dy, dz);
}

function furnitureByType(result: ReturnType<typeof buildCliHouseScene>, type: string): THREE.Group {
  const object = result.index.furnitureMeshes.find((candidate) => candidate.userData.furnishingType === type);
  assert.ok(object, `missing SceneBuilder furniture ${type}`);
  return object;
}

test('R9 SceneBuilder vanity boards anchor to the wall west finish with no west-side bridge meshes', () => {
  const result = buildCliHouseScene();
  result.exportRoot.updateMatrixWorld(true);
  for (const type of ['mb_vanity_lower_board', 'mb_vanity_main_board']) {
    const board = furnitureByType(result, type);
    const boardBox = new THREE.Box3().setFromObject(board);
    assert.ok(Math.abs(board.position.x - 2.2575) < 1e-6, `${type} center x must be 2.2575m`);
    assert.ok(Math.abs(board.position.z - 3.61) < 1e-6, `${type} center z must be 3.61m`);
    assert.ok(Math.abs(boardBox.min.x - 1.975) < 1e-6 && Math.abs(boardBox.max.x - 2.54) < 1e-6, `${type} AABB must be x[1.975,2.54]`);
    assert.ok(Math.abs(boardBox.min.z - 2.92) < 1e-6, `${type} must start at the bedroom-side finish of w_mbath_south`);
    assert.ok(Math.abs(boardBox.max.z - 4.30) < 1e-6, `${type} must terminate at wall north edge`);
    assert.equal(board.children.some((child) => child.userData.part === 'wardrobe-side-board-end'), false, `${type} must remain a plain floating board without a wardrobe-colored end panel`);
  }
  assert.equal(result.index.furnitureMeshes.some((group) => group.userData.furnishingType === 'mb_vanity_continuous_closure_cabinet'), false);
  assert.equal(result.index.furnitureMeshes.some((group) => String(group.userData.furnishingType).endsWith('_board_bridge')), false);
});

test('R11 SceneBuilder vanity base cabinet and every child part stay inside the west finish envelope', () => {
  const result = buildCliHouseScene();
  result.exportRoot.updateMatrixWorld(true);
  const base = furnitureByType(result, 'mb_vanity_base_cabinet');
  const baseBox = new THREE.Box3().setFromObject(base);
  assert.ok(Math.abs(base.position.x - 2.2575) < 1e-6, `base cabinet center x=${base.position.x}`);
  assert.ok(Math.abs(base.position.z - 3.61) < 1e-6, `base cabinet center z=${base.position.z}`);
  assert.ok(Math.abs(baseBox.min.x - 1.975) < 1e-6 && Math.abs(baseBox.max.x - 2.54) < 1e-6, `base cabinet AABB x[${baseBox.min.x},${baseBox.max.x}]`);
  assert.ok(Math.abs(baseBox.min.z - 2.92) < 1e-6 && Math.abs(baseBox.max.z - 4.30) < 1e-6, `base cabinet AABB z[${baseBox.min.z},${baseBox.max.z}]`);
  const parts: THREE.Object3D[] = [];
  base.traverse((object) => { if (object.userData.part) parts.push(object); });
  assert.deepEqual(parts.map((object) => object.userData.part), ['base-cabinet', 'base-plinth', 'base-front-reveal', 'base-door-seam']);
  for (const part of parts) {
    const box = new THREE.Box3().setFromObject(part);
    assert.ok(box.min.x >= 1.975 - 1e-6, `${part.userData.part} crosses west edge: ${box.min.x}`);
    assert.ok(box.max.x <= 2.54 + 1e-6, `${part.userData.part} enters w_mbath_east wall/master_bath side: ${box.max.x}`);
    assert.ok(box.min.z >= 2.92 - 1e-6, `${part.userData.part} enters master_bath across w_mbath_south: ${box.min.z}`);
    assert.ok(box.max.z <= 4.30 + 1e-6, `${part.userData.part} crosses wardrobe alignment: ${box.max.z}`);
  }
});

test('R7 wardrobe four-state real-mesh collision matrix clears declared room obstacles and HVAC geometry', () => {
  const result = buildCliHouseScene(undefined, undefined, undefined, undefined, 'data/project-render-facts.json');
  const wardrobe = furnitureByType(result, 'master_north_wall_wardrobe_950');
  const obstacles = new Map<string, THREE.Object3D>();
  const door = result.exportRoot.getObjectByName('d_mb');
  assert.ok(door, 'missing d_mb open door mesh');
  obstacles.set('d_mb_open_leaf', door);
  for (const type of [
    'mb_vanity_lower_board',
    'mb_vanity_main_board',
    'bed_180',
    'master_bedside_cabinet_350_north',
    'master_bedside_cabinet_350_south',
    'master_dressing_table',
    'dressing_stool',
  ]) obstacles.set(type, furnitureByType(result, type));
  for (const id of [
    'hvac:A2:anchor:indoor_master',
    'hvac:A2:terminal:supply_master',
    'hvac:A2:terminal:return_master',
  ]) {
    const object = result.index.hvac.all.get(id);
    assert.ok(object, `missing modeled HVAC obstacle ${id}`);
    obstacles.set(id, object);
  }
  const doorRoots: THREE.Object3D[] = [];
  wardrobe.traverse((object) => { if (object.userData.materialRole === 'door_root') doorRoots.push(object); });
  doorRoots.sort((a, b) => Number(a.userData.doorIndex) - Number(b.userData.doorIndex));
  assert.equal(doorRoots.length, 3);
  const expectedRotations: Record<NorthWallWardrobe950DoorConfiguration, [number, number, number]> = {
    closed: [0, 0, 0],
    left_open: [-95, 0, 0],
    middle_open: [0, 95, 0],
    right_open: [0, 0, 95],
    left_middle_open: [-95, 95, 0],
    left_right_open: [-95, 0, 95],
    middle_right_open: [0, 95, 95],
    all_open: [-95, 95, 95],
  };
  for (const configuration of Object.keys(expectedRotations) as NorthWallWardrobe950DoorConfiguration[]) {
    setNorthWallWardrobe950DoorConfiguration(wardrobe, configuration);
    result.exportRoot.updateMatrixWorld(true);
    assert.deepEqual(doorRoots.map((root) => Math.round(THREE.MathUtils.radToDeg(root.rotation.y))), expectedRotations[configuration]);
    const leaves = doorRoots.map((root) => new THREE.Box3().setFromObject(root));
    for (let a = 0; a < leaves.length; a++) {
      for (let b = a + 1; b < leaves.length; b++) {
        assert.equal(strictBoxIntersects(leaves[a], leaves[b]), false, `${configuration}: wardrobe door leaves ${a + 1}/${b + 1} intersect`);
      }
    }
    let minimumClearance = Infinity;
    for (const [name, obstacle] of obstacles) {
      const obstacleBox = new THREE.Box3().setFromObject(obstacle);
      for (const [index, leafBox] of leaves.entries()) {
        assert.equal(strictBoxIntersects(leafBox, obstacleBox), false, `${configuration}: door ${index + 1} intersects ${name}`);
        minimumClearance = Math.min(minimumClearance, boxClearance(leafBox, obstacleBox));
      }
    }
    assert.ok(Number.isFinite(minimumClearance) && minimumClearance > 0, `${configuration}: no positive modeled clearance`);
  }
});

test('shared SceneBuilder renders hinged glass door at the declared west hinge', () => {
  const result = buildScene({
    rooms: [], walls: [],
    elements: [{ type: 'hinged_glass_door', id: 'west-door', points: [{ x: 5.6, z: 2.8 }, { x: 6.3, z: 2.8 }], height: 1.95, open: true, swing: 'north', hinge: 'start' }],
  });
  const door = result.exportRoot.getObjectByName('hinged_glass_door:west-door');
  assert.ok(door);
  assert.equal(door?.userData.type, 'hinged_glass_door');
  const pane = result.exportRoot.getObjectByName('hinged_glass_door:west-door:pane') as THREE.Mesh;
  assert.ok(pane);
  result.exportRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pane);
  assert.ok(box.min.x > 5.55 && box.max.x < 5.95, `open leaf must stay on the west hinge side: ${box.min.x}..${box.max.x}`);
  assert.ok(box.max.z < 2.85, `north swing must open toward -z: ${box.max.z}`);
  assert.ok(result.index.glassMeshes.some((mesh) => mesh.userData.objectId === 'west-door'));
});

test('shared SceneBuilder splits curtain_run parts under a metadata-only parent', () => {
  const result = buildScene({
    rooms: [], walls: [], elements: [{
      type: 'curtain_run', id: 'west_curtain', points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }], height: 2.8,
      parts: [
        { id: 'west', points: [{ x: 0, z: 0 }, { x: 4, z: 0 }], wallRefs: ['w1'] },
        { id: 'south', points: [{ x: 4, z: 0 }, { x: 4, z: 4 }], wallRefs: ['w2'] },
      ],
    }],
  });
  const parent = result.exportRoot.getObjectByName('west_curtain');
  assert.ok(parent);
  assert.equal(parent?.userData.objectId, 'west_curtain');
  assert.equal((parent as THREE.Mesh).isMesh, undefined);
  assert.deepEqual(parent?.children.map((child) => child.name), ['west_curtain:part=west', 'west_curtain:part=south']);
  assert.deepEqual(parent?.children.map((child) => child.userData.exportName), ['west_curtain:part=west', 'west_curtain:part=south']);
  assert.deepEqual(parent?.children.map((child) => [child.userData.type, child.userData.objectId, child.userData.wallId, child.userData.partId]), [
    ['curtain_run', 'west_curtain', 'w1', 'west'],
    ['curtain_run', 'west_curtain', 'w2', 'south'],
  ]);
  assert.equal(result.index.curtainRuns.get('west_curtain')?.length, 2);
  assert.equal(result.index.glassMeshes.filter((mesh) => mesh.userData.objectId.startsWith('west_curtain')).length, 2);
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

test('floor regions are coplanar with room floors and railings use shared transparent parts', () => {
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

  const railing = result.exportRoot.getObjectByName('vrv_nw_railing') as THREE.Group;
  assert.equal(railing.userData.type, 'railing_run');
  assert.equal(railing.userData.objectId, 'vrv_nw_railing');
  assert.equal(railing.userData.geometrySource, 'shared_railing');
  const parts: THREE.Object3D[] = [];
  railing.traverse((object) => { if (object.userData.part) parts.push(object); });
  assert.ok(parts.some((part) => part.userData.part === 'handrail'));
  assert.ok(parts.filter((part) => String(part.userData.part).startsWith('bar:')).length >= 2);
  for (const part of parts) {
    assert.equal(part.userData.materialRole, 'railing');
    assert.equal(part.userData.type, 'railing_run');
  }
  railing.updateMatrixWorld(true);
  const railingBox = new THREE.Box3().setFromObject(railing);
  assert.ok(Math.abs(railingBox.max.y - 1) < 0.02);
  assert.ok(railingBox.min.x > -0.04 && railingBox.max.x < 2.04, `unexpected railing x bounds: ${railingBox.min.x}..${railingBox.max.x}`);
  assert.ok(parts.filter((part) => (part as THREE.Mesh).geometry).every((part) => (part as THREE.Mesh).geometry!.getAttribute('position')!.count > 0));
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
  const railingMesh = result.exportRoot.getObjectByName('vrv_nw_railing') as THREE.Group;
  assert.equal(railingMesh.userData.geometryMode, 'arc');
  const railingParts: THREE.Object3D[] = [];
  railingMesh.traverse((object) => { if (object.userData.part) railingParts.push(object); });
  assert.ok(railingParts.some((part) => part.userData.part === 'handrail'));
  assert.ok(railingParts.filter((part) => String(part.userData.part).startsWith('bar:')).length >= 2);
  railingMesh.updateMatrixWorld(true);
  const railingBox = new THREE.Box3().setFromObject(railingMesh);
  assert.ok(railingBox.min.x >= 5.56 && railingBox.max.x <= 7.21);
  assert.ok(railingBox.min.z >= -0.04 && railingBox.max.z <= 1.11);
  const platformMesh = result.viewOnlyRoot.getObjectByName('platform_boundary') as THREE.Mesh;
  assert.ok(platformMesh);
  assert.equal(result.exportRoot.getObjectByName('platform_boundary'), undefined);
  platformMesh.updateMatrixWorld(true);
  const platformBox = new THREE.Box3().setFromObject(platformMesh);
  assert.ok(platformBox.min.x >= 5.59 && platformBox.max.x <= 7.21);
  assert.ok(platformBox.min.z >= -0.01 && platformBox.max.z <= 1.01);
  assert.ok(platformMesh.geometry instanceof THREE.ExtrudeGeometry);
});

test('kitchen countertop cutouts preserve the outer slab and rotate with the furnishing run', () => {
  const cutout = { kind: 'sink', id: 'sink-test', offset: [-0.4, 0] as [number, number], size: [0.7, 0.4] as [number, number] };
  const result = buildScene({
    rooms: [],
    walls: [],
    elements: [],
    furnishings: {
      kitchen: [
        { type: 'kitchen_cabinet_run', x: 0, z: 0, rotation: 0, length: 1.68, depth: 0.6, cabinetHeight: 0.86, countertopThickness: 0.03, cutouts: [cutout] },
        { type: 'kitchen_cabinet_run', x: 10.48, z: 1, rotation: 90, length: 1.4, depth: 0.6, cabinetHeight: 0.86, countertopThickness: 0.03, cutouts: [{ kind: 'cooktop', id: 'cooktop-test', offset: [-0.18, 0.02] as [number, number], size: [0.45, 0.75] as [number, number] }] },
      ],
    },
  });
  result.exportRoot.updateMatrixWorld(true);
  const countertopPieces = result.index.countertopMeshes;
  assert.ok(countertopPieces.length > 2, 'cutouts should split both countertop slabs');
  const firstRunPieces = countertopPieces.filter((mesh) => mesh.parent?.userData.objectId === 'furniture:kitchen:kitchen_cabinet_run:0');
  const firstLocalBoxes = firstRunPieces.map((mesh) => new THREE.Box3().setFromObject(mesh));
  assert.ok(firstLocalBoxes.every((box) => box.min.x >= -0.86 - 1e-6 && box.max.x <= 0.86 + 1e-6 && box.min.z >= -0.32 - 1e-6 && box.max.z <= 0.32 + 1e-6));
  assert.ok(firstLocalBoxes.every((box) => Math.abs(box.max.y - box.min.y - 0.03) < 1e-9));
  assert.ok(Math.abs(firstLocalBoxes.reduce((area, box) => area + (box.max.x - box.min.x) * (box.max.z - box.min.z), 0) - (1.72 * 0.64 - 0.7 * 0.4)) < 1e-6);
  for (const box of firstLocalBoxes) {
    const overlapWidth = Math.min(box.max.x, -0.05) - Math.max(box.min.x, -0.75);
    const overlapDepth = Math.min(box.max.z, 0.2) - Math.max(box.min.z, -0.2);
    assert.ok(overlapWidth <= 1e-6 || overlapDepth <= 1e-6, 'countertop piece overlaps the declared cutout');
  }

  const rotatedPieces = countertopPieces.filter((mesh) => mesh.parent?.position.x === 10.48);
  rotatedPieces.forEach((mesh) => mesh.updateMatrixWorld(true));
  const rotatedBox = rotatedPieces.reduce((box, mesh) => box.union(new THREE.Box3().setFromObject(mesh)), new THREE.Box3());
  assert.ok(Math.abs(rotatedBox.min.x - (10.48 - 0.32)) < 1e-6 && Math.abs(rotatedBox.max.x - (10.48 + 0.32)) < 1e-6);
  assert.ok(Math.abs(rotatedBox.min.z - (1 - 0.72)) < 1e-6 && Math.abs(rotatedBox.max.z - (1 + 0.72)) < 1e-6);
  assert.ok(rotatedPieces.every((mesh) => mesh.userData.surface === 'countertop' && mesh.userData.materialRole === 'countertop' && typeof mesh.userData.part === 'string'));
});

test('kitchen countertop bridge is countertop-only and closes the dishwasher gap', () => {
  const result = buildScene({
    rooms: [],
    walls: [],
    elements: [],
    furnishings: {
      kitchen: [
        { type: 'kitchen_cabinet_run', x: 7.86, z: 0.32, rotation: 0, length: 1.28, depth: 0.60, cabinetHeight: 0.86, countertopThickness: 0.03 },
        { type: 'kitchen_countertop_bridge', x: 8.80, z: 0.32, rotation: 0, length: 0.60, depth: 0.60, countertopThickness: 0.03 },
        { type: 'kitchen_cabinet_run', x: 9.94, z: 0.32, rotation: 0, length: 1.68, depth: 0.60, cabinetHeight: 0.86, countertopThickness: 0.03 },
      ],
    },
  });
  result.exportRoot.updateMatrixWorld(true);
  const bridge = result.exportRoot.getObjectByName('furniture:kitchen:kitchen_countertop_bridge:1');
  assert.ok(bridge);
  assert.equal(bridge.parent, result.exportRoot);
  const bridgeMeshes: THREE.Mesh[] = [];
  bridge.traverse((object) => { if (object instanceof THREE.Mesh) bridgeMeshes.push(object); });
  assert.equal(bridgeMeshes.length, 1, 'bridge must contain only one countertop mesh');
  const mesh = bridgeMeshes[0];
  assert.equal(mesh.userData.part, 'countertop-bridge');
  assert.equal(mesh.userData.materialRole, 'countertop');
  assert.equal(mesh.userData.surface, 'countertop');
  const box = new THREE.Box3().setFromObject(bridge);
  assert.ok(Math.abs(box.min.x - 8.50) < 1e-6 && Math.abs(box.max.x - 9.10) < 1e-6);
  assert.ok(Math.abs(box.min.z - 0.02) < 1e-6 && Math.abs(box.max.z - 0.62) < 1e-6);
  assert.ok(Math.abs(box.min.y - 0.86) < 1e-6 && Math.abs(box.max.y - 0.89) < 1e-6);

  const countertopMeshes = result.index.countertopMeshes;
  assert.ok(countertopMeshes.some((candidate) => candidate.parent?.userData.objectId === 'furniture:kitchen:kitchen_cabinet_run:0' && new THREE.Box3().setFromObject(candidate).max.x >= 8.50 - 1e-6));
  assert.ok(countertopMeshes.some((candidate) => candidate.parent?.userData.objectId === 'furniture:kitchen:kitchen_cabinet_run:2' && new THREE.Box3().setFromObject(candidate).min.x <= 9.10 + 1e-6));
  assert.match(mesh.name, /^furniture:kitchen:[0-9a-f]{6}:part=countertop-bridge:role=countertop$/);
});

test('shared render builders do not depend on browser globals', () => {
  for (const file of ['SceneBuilder.ts', 'InfrastructureBuilder.ts', 'layout-bounds.ts', 'CeilingZoneBuilder.ts']) {
    const source = readFileSync(`shared/render/${file}`, 'utf8');
    assert.doesNotMatch(source, /\b(window|document|HTMLCanvasElement|fetch)\b/);
  }
});
