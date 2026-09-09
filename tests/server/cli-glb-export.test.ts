import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import * as sharedSceneBuilder from '../../shared/render/SceneBuilder.js';
import { exportSceneToGlbData } from '../../shared/render/export-gltf.js';
import { buildCliHouseScene } from '../../scripts/render/glb/cli-glb-builder.js';
import { installNodeFileReader } from '../../scripts/render/glb/node-gltf-runtime.js';
import { assertOutputPathAvailable, parseArgs as parseExportArgs } from '../../scripts/render/glb/export-glb.js';
import { inspectGlb } from '../../scripts/render/glb/inspect-glb.js';

test('CLI render sources depend on shared modules, not app render modules', () => {
  const builderSource = readFileSync('scripts/render/glb/cli-glb-builder.ts', 'utf8');
  const exporterSource = readFileSync('scripts/render/glb/export-glb.ts', 'utf8');
  assert.match(builderSource, /from ['\"]\.\.\/\.\.\/\.\.\/shared\/render\/SceneBuilder\.js['\"]/);
  assert.match(builderSource, /buildScene\(/);
  assert.doesNotMatch(builderSource, /from ['\"]\.\.\/app\/src\/render\//);
  assert.doesNotMatch(exporterSource, /app\/src/);
  assert.doesNotMatch(builderSource, /new THREE\./);
  assert.equal(typeof sharedSceneBuilder.buildScene, 'function');
});

test('CLI builder returns shared export and view-only roots', () => {
  const result = buildCliHouseScene();
  assert.equal(result.scene.children.length, 2);
  assert.equal(result.scene.children[0], result.exportRoot);
  assert.equal(result.scene.children[1], result.viewOnlyRoot);
  assert.equal(result.exportRoot.name, 'HOUSE_EXPORT');
  assert.equal(result.viewOnlyRoot.name, 'HOUSE_VIEW_ONLY');
  assert.equal(result.exportRoot.getObjectByName('platform_boundary'), undefined);
  assert.ok(result.viewOnlyRoot.getObjectByName('platform_boundary'));
});

function collectTypes(scene: THREE.Scene): Set<string> {
  const types = new Set<string>();
  scene.traverse((object) => {
    if (typeof object.userData.type === 'string') types.add(object.userData.type);
  });
  return types;
}

function collectObjects(scene: THREE.Scene): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (typeof object.userData.type === 'string') objects.push(object);
  });
  return objects;
}

// 按房间+类型前缀匹配场景对象，避免与 furniture 列表序号耦合（序号随房间条目增删漂移）。
function findByType(root: THREE.Object3D, room: string, type: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse((object) => {
    if (!found && String(object.userData.objectId).startsWith(`furniture:${room}:${type}:`)) found = object;
  });
  return found;
}

interface CeilingEntry {
  id: string;
  room: string;
  type: string;
  thickness?: number;
  area?: [number, number, number, number];
  corner_radius?: number;
  inspection_layer?: string;
  inspection_opacity?: number;
}

function readCeilingEntries(): CeilingEntry[] {
  return parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as CeilingEntry[];
}

test('CLI builder creates core geometry with export metadata', () => {
  const { scene, exportRoot, report } = buildCliHouseScene();
  const types = collectTypes(scene);
  assert.ok(types.has('floor'));
  assert.ok(types.has('wall'));
  assert.ok(types.has('ceiling'));
  assert.ok(types.has('furniture'));
  for (const type of ['floor_region', 'curtain_run', 'shower_screen', 'railing_run', 'wall_run']) {
    assert.ok(types.has(type), `expected real overlay geometry for ${type}`);
  }
  const objects = collectObjects(scene);
  assert.equal(objects.some((object) => object.userData.type === 'wall' && object.userData.objectId === 'w_liv_south'), false);
  assert.ok(objects.some((object) => object.userData.type === 'wall' && String(object.userData.objectId).startsWith('w_ent_south_w:')));
  assert.ok(objects.some((object) => object.userData.type === 'wall' && String(object.userData.objectId).startsWith('w_mb_east')));
  assert.equal(objects.some((object) => object.userData.type === 'wall' && String(object.userData.objectId).startsWith('w_mb_win')), false);
  const splitWall = objects.find((object) => String(object.userData.objectId).startsWith('w_ent_south_w:0'));
  assert.ok(splitWall);
  assert.equal(splitWall.userData.exportName, 'w_ent_south_w:0');
  assert.equal(splitWall.name, splitWall.userData.exportName);
  // 电梯井不生成地面/天花（HEAD 语义）：11 个房间但只有 10 个 floor/ceiling
  assert.equal(report.rooms, 10);
  assert.equal(report.ceilings, 10);
  assert.ok(report.ceilingZones > 0);
  assert.ok(report.walls > 0);
  assert.ok(report.furniture > 0);

  const floor = scene.getObjectByName('floor:master_bedroom');
  assert.ok(floor);
  assert.equal(floor.userData.type, 'floor');
  assert.equal(floor.userData.objectId, 'floor:master_bedroom');
  assert.equal(floor.userData.exportName, 'floor:master_bedroom');

  const furniture = scene.getObjectByName('furniture:master_bedroom:bed_180:0');
  assert.ok(furniture);
  assert.equal(furniture.userData.type, 'furniture');
  assert.equal(furniture.userData.objectId, 'furniture:master_bedroom:bed_180:0');
  assert.deepEqual(furniture.position.toArray(), [3.2, 0, 7.4]);
  for (const type of ['master_north_wall_wardrobe_950', 'master_bedside_cabinet_350_north', 'master_bedside_cabinet_350_south']) {
    const object = findByType(exportRoot, 'master_bedroom', type);
    assert.ok(object, `missing R8 ${type}`);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    assert.ok(box.max.y > box.min.y && box.max.y > 0, `${type} must have real mesh height`);
    const parts: THREE.Object3D[] = [];
    object.traverse((child) => { if (child.userData.part) parts.push(child); });
    assert.ok(parts.every((child) => child.userData.part && child.userData.materialRole), `${type} parts need metadata`);
  }
  for (const removed of ['master_partition_wardrobe_1600', 'master_dressing_connection_storage', 'master_freestanding_wardrobe_062', 'master_bedside_cabinet_north', 'master_bedside_tray_south', 'master_north_wall_wardrobe_600', 'master_north_wall_wardrobe_650']) {
    assert.equal(findByType(exportRoot, 'master_bedroom', removed), undefined, `${removed} must not export in R8`);
  }
  const bedBox = new THREE.Box3().setFromObject(furniture);
  assert.deepEqual(bedBox.min.toArray().map((value) => Number(value.toFixed(2))), [2.2, 0, 6.47]);
  assert.deepEqual(bedBox.max.toArray().map((value) => Number(value.toFixed(2))), [4.2, 0.8, 8.33]);
  const northCabinet = findByType(exportRoot, 'master_bedroom', 'master_bedside_cabinet_350_north');
  const southCabinet = findByType(exportRoot, 'master_bedroom', 'master_bedside_cabinet_350_south');
  assert.ok(northCabinet && southCabinet);
  northCabinet.updateMatrixWorld(true);
  southCabinet.updateMatrixWorld(true);
  const northBox = new THREE.Box3().setFromObject(northCabinet);
  const southBox = new THREE.Box3().setFromObject(southCabinet);
  assert.deepEqual(northBox.min.toArray().map((value) => Number(value.toFixed(3))), [3.82, 0, 6.07]);
  assert.deepEqual(northBox.max.toArray().map((value) => Number(value.toFixed(3))), [4.2, 0.505, 6.42]);
  assert.deepEqual(southBox.min.toArray().map((value) => Number(value.toFixed(3))), [3.82, 0, 8.38]);
  assert.deepEqual(southBox.max.toArray().map((value) => Number(value.toFixed(3))), [4.2, 0.505, 8.73]);

  const masterTowelSet = scene.getObjectByName('furniture:master_bath:towel_set:1');
  assert.ok(masterTowelSet, 'missing master_bath towel_set');
  assert.deepEqual(masterTowelSet.position.toArray(), [0.24, 0, 2.23]);
});

test('CLI exports authoritative electrical socket geometry from electrical.yaml', () => {
  const { exportRoot, report, index } = buildCliHouseScene();
  // 方案 A：北/南主床头插座随两侧350床头柜服务轴线重排；备用插座保持0.70。
  const expected = new Map([
    ['sock_master_bed_l', [6.202, 0.75]],
    ['sock_master_bed_r_head', [8.512, 0.75]],
    ['sock_master_bed_r', [9.15, 0.7]],
  ]);
  for (const [id, [z, y]] of expected) {
    const object = index.electrical.get(`electrical:${id}`);
    assert.ok(object, `missing electrical fixture ${id}`);
    assert.equal(object.userData.objectId, `electrical:${id}`);
    assert.equal(object.parent, exportRoot);
    assert.equal(object.position.x, 4.125);
    assert.equal(object.position.y, y);
    assert.equal(object.position.z, z);
  }
  assert.ok(report.electrical >= expected.size);
  // 2026-09-04 R1：西侧地插随贴窗梳妆桌落位 @(0.42,5.78)，floor_socket 无墙投影、直读 x/z（y 为 InfrastructureBuilder 的地插固定抬高 0.05）
  const floorSocket = index.electrical.get('electrical:sock_master_projector');
  assert.ok(floorSocket, 'missing electrical fixture sock_master_projector');
  assert.equal(floorSocket.position.x, 0.42);
  assert.equal(floorSocket.position.z, 5.78);
  assert.equal(floorSocket.position.y, 0.05);
  // DEC-2026-09-08-R1：空调线控器新类型随电气 fixtures 导出（w_mb_east 西面投影 x=4.125）
  const acPanel = index.electrical.get('electrical:ac_panel_master');
  assert.ok(acPanel, 'missing electrical fixture ac_panel_master');
  assert.equal(acPanel.userData.fixtureType, 'ac_controller');
  assert.equal(acPanel.position.x, 4.125);
  assert.equal(acPanel.position.y, 0.75);
  assert.equal(acPanel.position.z, 8.684);
});

test('CLI builds shower plumbing fixtures from plumbing.yaml without replacing shower_set furnishings', () => {
  const { exportRoot, report, index } = buildCliHouseScene();
  const showers = ['shower_mbath', 'shower_gbath'].map((id) => {
    const object = index.plumbing.get(`plumbing:${id}`);
    assert.ok(object, `missing plumbing fixture ${id}`);
    assert.equal(object.userData.type, 'plumbing');
    assert.equal(object.userData.objectId, `plumbing:${id}`);
    assert.equal(object.userData.fixtureType, 'shower');
    assert.equal(object.parent, exportRoot);
    return object;
  });
  assert.equal(report.plumbing, 19);
  assert.equal(index.plumbing.size, 19);
  assert.ok(Math.abs(showers[0].position.x - 0.5) < 1e-6);
  assert.ok(Math.abs(showers[0].position.y) < 1e-6);
  assert.ok(Math.abs(showers[0].position.z - 2.785) < 1e-6, `master shower z=${showers[0].position.z}`);
  assert.ok(Math.abs(showers[1].position.x - 7.025) < 1e-6, `guest shower x=${showers[1].position.x}`);
  assert.ok(Math.abs(showers[1].position.y) < 1e-6);
  assert.ok(Math.abs(showers[1].position.z - 2.45) < 1e-6);
  assert.equal(showers[1].userData.wallSide, 'west');
  const guestToilet = exportRoot.getObjectByName('furniture:guest_bath:toilet:1');
  assert.ok(guestToilet, 'missing guest_bath toilet');
  assert.deepEqual(guestToilet.position.toArray(), [6.75, 0, 3.05]);
  guestToilet.updateMatrixWorld(true);
  const guestToiletAabb = new THREE.Box3().setFromObject(guestToilet);
  assert.deepEqual(guestToiletAabb.min.toArray().map((value) => Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(3))), [6.525, 0, 2.85]);
  assert.deepEqual(guestToiletAabb.max.toArray().map((value) => Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(3))), [7.075, 0.6, 3.25]);
  assert.ok(Math.abs(guestToilet.rotation.y - (270 * Math.PI / 180)) < 1e-6);
  assert.equal(exportRoot.getObjectByName('furniture:master_bath:toilet:0')?.userData.type, 'furniture');
  assert.equal(exportRoot.getObjectByName('furniture:master_bath:shower_set:1'), undefined, 'shower_set has no FixtureFactory recipe; shower geometry comes from plumbing points');
});

test('CLI facts projection exports lighting fixture geometry and no-facts CLI does not', async () => {
  const withoutFacts = buildCliHouseScene();
  assert.equal(withoutFacts.report.lightingFixtures, 0);
  assert.equal(withoutFacts.exportRoot.getObjectByName('LIGHTING_FIXTURES'), undefined);
  const withFacts = buildCliHouseScene(undefined, undefined, undefined, undefined, 'data/project-render-facts.json');
  const fixtures = [...withFacts.index.lightingFixtures.values()];
  assert.equal(fixtures.length, 15);
  assert.equal(withFacts.report.lightingFixtures, fixtures.length);
  assert.deepEqual(new Set(fixtures.map((fixture) => fixture.userData.fixtureType)), new Set(['pendant', 'track_light', 'led_strip', 'dome', 'wall_lamp', 'downlight']));
  for (const fixture of fixtures) {
    assert.equal(fixture.userData.type, 'lighting_fixture');
    assert.match(String(fixture.userData.objectId), /^electrical:/);
    assert.ok(fixture.userData.roomId);
  }
  const track = fixtures.find((fixture) => fixture.userData.fixtureType === 'track_light')!;
  assert.equal(track.children.filter((object) => String(object.userData.part).endsWith(':lens')).length, 4);
  installNodeFileReader();
  const data = await exportSceneToGlbData(withFacts.exportRoot);
  const directory = mkdtempSync(join(tmpdir(), 'lighting-glb-'));
  const glbPath = join(directory, 'lighting.glb');
  writeFileSync(glbPath, data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  const summary = inspectGlb(glbPath);
  assert.ok(summary.nodeIds.includes('electrical:light_dining_pendant'));
  assert.ok(summary.nodeIds.some((id) => id.includes('electrical:living_track_main:part=track')));
});

test('CLI track fixture heads are configuration-driven', () => {
  const facts = JSON.parse(readFileSync('data/project-render-facts.json', 'utf8'));
  facts.lightingFixtures = facts.lightingFixtures.map((fixture: { type: string; heads?: number }) => fixture.type === 'track_light' ? { ...fixture, heads: 3 } : fixture);
  const directory = mkdtempSync(join(tmpdir(), 'lighting-facts-'));
  const factsPath = join(directory, 'facts.json');
  writeFileSync(factsPath, JSON.stringify(facts));
  const result = buildCliHouseScene(undefined, undefined, undefined, undefined, factsPath);
  const track = [...result.index.lightingFixtures.values()].find((fixture) => fixture.userData.fixtureType === 'track_light');
  assert.ok(track);
  assert.equal(track.children.filter((object) => String(object.userData.part).endsWith(':lens')).length, 3);
});

test('CLI with real render facts exports every renderable A2 HVAC anchor and terminal exactly once', () => {
  const { exportRoot, report, index } = buildCliHouseScene(undefined, undefined, undefined, undefined, 'data/project-render-facts.json');
  const ids = [...index.hvac.all.keys()];
  assert.equal(report.hvacStatus, 'implemented');
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(report.hvacEquipment, 16);
  assert.equal(report.hvacTerminals, 10);
  for (const id of [
    'outdoor_a2', 'indoor_living', 'indoor_master', 'indoor_study', 'indoor_parent', 'indoor_child',
    'power_living', 'power_master', 'power_study', 'power_parent', 'power_child',
    'bend_corridor', 'branch_master', 'branch_study', 'branch_parent', 'branch_child',
  ]) assert.ok(exportRoot.getObjectByName(`hvac:A2:anchor:${id}`), `missing HVAC anchor ${id}`);
  for (const id of ['supply_living', 'return_living', 'supply_master', 'return_master', 'supply_study', 'return_study', 'supply_parent', 'return_parent', 'supply_child', 'return_child']) {
    assert.ok(exportRoot.getObjectByName(`hvac:A2:terminal:${id}`), `missing HVAC terminal ${id}`);
  }
  const supply = index.hvac.terminals.get('hvac:A2:terminal:supply_master');
  const ret = index.hvac.terminals.get('hvac:A2:terminal:return_master');
  assert.ok(supply && ret, 'master-bedroom air terminals must be indexed');
  assert.ok(Math.abs(supply!.position.x - 3.70) < 1e-9, `supply center x=${supply!.position.x}`);
  assert.ok(Math.abs(ret!.position.x - 3.70) < 1e-9, `return center x=${ret!.position.x}`);
  supply!.updateMatrixWorld(true);
  ret!.updateMatrixWorld(true);
  const supplyBox = new THREE.Box3().setFromObject(supply!);
  const returnBox = new THREE.Box3().setFromObject(ret!);
  // 逻辑风口东端按 declared length 计算；边框/状态线的 5mm 外扩仍须留在东墙完成面 x=4.14 以内。
  assert.ok(Math.abs(supply!.position.x + 0.6 / 2 - 4.00) < 1e-9, `supply nominal east x=${supply!.position.x + 0.6 / 2}`);
  assert.ok(Math.abs(ret!.position.x + 0.5 / 2 - 3.95) < 1e-9, `return nominal east x=${ret!.position.x + 0.5 / 2}`);
  assert.ok(supplyBox.max.x < 4.14, `supply rendered east edge x=${supplyBox.max.x}`);
  assert.ok(returnBox.max.x < 4.14, `return rendered east edge x=${returnBox.max.x}`);
});

test('CLI exports every solid ceiling.yaml zone with the Web metadata contract', () => {
  const entries = readCeilingEntries();
  const solidEntries = entries.filter((entry) =>
    ['drop', 'integrated', 'aluminum_buckle'].includes(entry.type)
    && entry.area !== undefined
    && entry.thickness !== undefined
    && entry.thickness > 0,
  );
  const { scene, report, index } = buildCliHouseScene();
  const solids = collectObjects(scene).filter((object) => object.userData.type === 'ceiling_zone_solid');
  assert.equal(report.ceilingZones, solidEntries.length);
  const expectedSolidCount = solidEntries.reduce((count, entry) => count + (entry.corner_radius && entry.corner_radius > 0 ? 2 : 5), 0);
  assert.equal(solids.length, expectedSolidCount);
  for (const entry of solidEntries) {
    const objectId = `ceiling:${entry.id}`;
    const matching = solids.filter((object) => object.userData.objectId === objectId);
    const expectedParts = entry.corner_radius && entry.corner_radius > 0 ? 2 : 5;
    assert.equal(matching.length, expectedParts, `expected ${expectedParts} rounded slab/edge solids for ${objectId}`);
    for (const object of matching) {
      assert.equal(object.userData.roomId, entry.room);
      if (entry.inspection_layer) assert.equal(object.userData.ceiling.inspection_layer, entry.inspection_layer);
      if (entry.inspection_opacity !== undefined) assert.equal(object.userData.ceiling.inspection_opacity, entry.inspection_opacity);
      assert.match(object.userData.exportName, new RegExp(`^${objectId}:`));
      assert.equal(object.name, object.userData.exportName);
    }
    if (entry.id === 'ceiling_master_ac') {
      const underside = matching.find((object) => object.userData.part === 'slab') as THREE.Mesh | undefined;
      assert.ok(underside, 'rounded master AC must export its underside plate');
      assert.equal(underside!.userData.ceilingPersistent, true);
      const undersideBox = new THREE.Box3().setFromObject(underside!);
      assert.ok(Math.abs(undersideBox.min.y - 2.502) < 1e-6, `master AC underside must sit at the drop bottom: ${undersideBox.min.y}`);
      assert.ok(Math.abs(undersideBox.max.y - 2.502) < 1e-6, `master AC underside must be a bottom plate, not a ceiling-height slab: ${undersideBox.max.y}`);
      assert.equal(index.ceilingMeshes.includes(underside!), false, 'persistent master AC underside must remain visible when ordinary ceiling meshes are hidden');
    }
    const group = scene.getObjectByName(objectId);
    assert.ok(group);
    assert.equal(group.userData.type, 'ceiling_zone');
    assert.equal(group.userData.objectId, objectId);
  }
  assert.equal(solids.some((object) => object.userData.objectId === 'ceiling:ac_living'), false);
  assert.equal(solids.some((object) => object.userData.objectId === 'ceiling:ac_master'), false);
});

test('CLI overlay and furniture world bboxes preserve the house z contract', () => {
  const { exportRoot } = buildCliHouseScene();
  exportRoot.updateMatrixWorld(true);

  const bbox = (objectId: string): THREE.Box3 => {
    const object = exportRoot.getObjectByName(objectId);
    assert.ok(object, `expected object ${objectId}`);
    return new THREE.Box3().setFromObject(object);
  };
  const assertZRange = (objectId: string, min: number, max: number): void => {
    const box = bbox(objectId);
    assert.ok(Math.abs(box.min.z - min) < 1e-5, `${objectId} min.z=${box.min.z}`);
    assert.ok(Math.abs(box.max.z - max) < 1e-5, `${objectId} max.z=${box.max.z}`);
  };

  assertZRange('corridor_floor', 5.55, 7.8);
  assertZRange('main_corridor_floor', 4.3, 5.55);
  assertZRange('entry_foyer_floor', 2.9, 4.3);
  assertZRange('entry_garden_floor', 0, 2.9);

  for (const id of ['entry_garden_north_railing', 'vrv_nw_railing']) {
    const railing = exportRoot.getObjectByName(id);
    assert.ok(railing, `missing railing ${id}`);
    assert.equal(railing.userData.type, 'railing_run');
    assert.equal(railing.userData.geometrySource, 'shared_railing');
    const parts: THREE.Object3D[] = [];
    railing.traverse((object) => { if (object.userData.part) parts.push(object); });
    assert.ok(parts.some((part) => part.userData.part === 'handrail'));
    assert.ok(parts.filter((part) => String(part.userData.part).startsWith('bar:')).length >= 2);
    const railingBox = new THREE.Box3().setFromObject(railing);
    assert.ok(Math.abs(railingBox.max.y - 1) < 0.02, `${id} max.y=${railingBox.max.y}`);
    assert.ok(railingBox.max.x > railingBox.min.x || railingBox.max.z > railingBox.min.z);
  }

  const bayBbox = (objectId: string): THREE.Box3 => {
    const box = bbox(objectId);
    assert.ok(Math.abs((box.max.y - box.min.y) - (objectId === 'kitchen_north_bay' ? 0.71 : 0.76)) < 1e-5);
    return box;
  };
  const masterBay = bayBbox('master_bedroom_south_bay');
  // 环幕飘窗随 v_sw 圆角转弯：西端起自西墙弧切点 x=0，不断角
  assert.ok(Math.abs(masterBay.min.x - 0) < 1e-5);
  assert.ok(Math.abs(masterBay.max.x - 4.2) < 1e-5);
  // 上飘窗收敛到户型内部：南墙飘窗占室内条带 z 8.7..9.8，不凸出南立面
  assert.ok(Math.abs(masterBay.min.z - 8.7) < 1e-5);
  assert.ok(Math.abs(masterBay.max.z - 9.8) < 1e-5);
  const kitchenBay = bayBbox('kitchen_north_bay');
  // 厨房北飘窗外缘平齐北立面 z=0，占室内 z 0..1.1
  assert.ok(Math.abs(kitchenBay.min.z) < 1e-5);
  assert.ok(Math.abs(kitchenBay.max.z - 1.1) < 1e-5);

  const guestScreen = bbox('shower_screen_gbath:0');
  assert.ok(Math.abs(guestScreen.min.x - 6.3) < 1e-5, `guest screen min.x=${guestScreen.min.x}`);
  assert.ok(Math.abs(guestScreen.max.x - 7.1) < 1e-5, `guest screen max.x=${guestScreen.max.x}`);
  assert.ok(Math.abs(guestScreen.min.z - 2.7875) < 1e-5, `guest screen min.z=${guestScreen.min.z}`);
  assert.ok(Math.abs(guestScreen.max.z - 2.8125) < 1e-5, `guest screen max.z=${guestScreen.max.z}`);
  assert.ok(Math.abs(guestScreen.max.y - guestScreen.min.y - 1.95) < 1e-5);
  const guestScreenObject = exportRoot.getObjectByName('shower_screen_gbath:0');
  assert.equal(guestScreenObject?.userData.type, 'shower_screen');
  assert.equal(guestScreenObject?.userData.objectId, 'shower_screen_gbath:0');
  assert.equal(guestScreenObject?.parent, exportRoot);

  // 2026-09-03：横置高柜 master_wardrobe_tall_240 退出；按房间+类型前缀查询，不与列表序号耦合
  assert.equal(findByType(exportRoot, 'master_bedroom', 'master_wardrobe_tall_240'), undefined);
  assert.equal(findByType(exportRoot, 'master_bedroom', 'master_wardrobe_tall_160'), undefined);
  assert.equal(findByType(exportRoot, 'master_bedroom', 'wardrobe_240_split'), undefined);
  assert.equal(exportRoot.getObjectByName('platform_boundary'), undefined, 'CLI export scene must exclude platform geometry');

  const near = (actual: number, expected: number, tolerance = 1e-5) => Math.abs(actual - expected) < tolerance;

  // R9 北墙950衣柜保留当前配置位置 @(2.45,4.59) r0，西缘与悬浮板西缘对齐。
  const northWardrobe = findByType(exportRoot, 'master_bedroom', 'master_north_wall_wardrobe_950');
  assert.ok(northWardrobe, 'missing master_north_wall_wardrobe_950 export');
  assert.deepEqual(northWardrobe.position.toArray(), [2.45, 0, 4.59]);
  const northWardrobeBox = new THREE.Box3().setFromObject(northWardrobe);
  assert.ok(near(northWardrobeBox.min.x, 1.975, 0.01));
  assert.ok(near(northWardrobeBox.max.x, 2.925, 0.01));
  assert.ok(near(northWardrobeBox.min.z, 4.30, 1e-5));
  assert.ok(near(northWardrobeBox.max.z, 4.88, 0.01));
  for (const type of ['master_bedside_cabinet_350_north', 'master_bedside_cabinet_350_south']) {
    const object = findByType(exportRoot, 'master_bedroom', type);
    assert.ok(object, `missing ${type} export`);
    assert.ok(new THREE.Box3().setFromObject(object).max.y > 0, `${type} must have real mesh height`);
  }

  // 2026-09-04 R1 贴窗梳妆桌 @(0.425,6.05) r90：权威 AABB x[0.20,0.65] z[5.60,6.50]；桌腿圆柱渲染半径使 z 向外扩 ≤0.01m
  const dressingTable = findByType(exportRoot, 'master_bedroom', 'master_dressing_table');
  assert.ok(dressingTable, 'missing master_dressing_table export');
  assert.deepEqual(dressingTable.position.toArray(), [0.425, 0, 6.05]);
  const tableBox = new THREE.Box3().setFromObject(dressingTable);
  assert.ok(near(tableBox.min.x, 0.20), `table min.x=${tableBox.min.x}`);
  assert.ok(near(tableBox.max.x, 0.65), `table max.x=${tableBox.max.x}`);
  assert.ok(near(tableBox.min.z, 5.60, 0.01), `table min.z=${tableBox.min.z}`);
  assert.ok(near(tableBox.max.z, 6.50, 0.01), `table max.z=${tableBox.max.z}`);

  // 2026-09-08 南侧窗带矮柜北移避开西南圆弧玻璃幕墙 @(1.05,9.20) r180
  const lowDresser = findByType(exportRoot, 'master_bedroom', 'master_hot_season_low_dresser');
  assert.ok(lowDresser, 'missing master_hot_season_low_dresser export');
  assert.deepEqual(lowDresser.position.toArray(), [1.05, 0, 9.20]);
  const lowDresserBox = new THREE.Box3().setFromObject(lowDresser);
  assert.ok(near(lowDresserBox.min.x, 0.35), `dresser min.x=${lowDresserBox.min.x}`);
  assert.ok(near(lowDresserBox.max.x, 1.75), `dresser max.x=${lowDresserBox.max.x}`);
  assert.ok(near(lowDresserBox.max.z, 9.44), `dresser max.z=${lowDresserBox.max.z}`);
  assert.ok(lowDresserBox.min.z <= 8.96 + 1e-5 && lowDresserBox.min.z >= 8.96 - 0.02, `dresser min.z=${lowDresserBox.min.z} (drawer/handle protrusion north of the body edge)`);
  assert.ok(lowDresserBox.max.y < 2.07, `dresser height ${lowDresserBox.max.y} must stay below the 2.07m sill`);

  // 书房季节后台柜 @(16.075,6.75) r270：权威 AABB x[15.80,16.35] z[5.90,7.60]；门板/门缝向西侧突出 ≤0.05m
  const seasonalWardrobe = findByType(exportRoot, 'bedroom_se', 'study_seasonal_wardrobe_wall');
  assert.ok(seasonalWardrobe, 'missing study_seasonal_wardrobe_wall export');
  assert.deepEqual(seasonalWardrobe.position.toArray(), [16.075, 0, 6.75]);
  const seasonalBox = new THREE.Box3().setFromObject(seasonalWardrobe);
  assert.ok(near(seasonalBox.min.z, 5.90), `seasonal min.z=${seasonalBox.min.z}`);
  assert.ok(near(seasonalBox.max.z, 7.60), `seasonal max.z=${seasonalBox.max.z}`);
  assert.ok(near(seasonalBox.max.x, 16.35), `seasonal max.x=${seasonalBox.max.x}`);
  assert.ok(seasonalBox.min.x <= 15.80 + 1e-5 && seasonalBox.min.x >= 15.80 - 0.05, `seasonal min.x=${seasonalBox.min.x} (door protrusion west of the 15.80 body edge)`);

  const sceneBox = new THREE.Box3().setFromObject(exportRoot);
  assert.ok(sceneBox.min.z > -3, `unexpected overlay/furniture z min=${sceneBox.min.z}`);
});

test('shared export data produces an inspectable GLB', async () => {
  installNodeFileReader();
  const { exportRoot } = buildCliHouseScene();
  const data = await exportSceneToGlbData(exportRoot);
  const dir = mkdtempSync(join(tmpdir(), 'cli-glb-test-'));
  const path = join(dir, 'house.glb');
  writeFileSync(path, data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  const summary = inspectGlb(path);
  assert.ok(summary.nodesTotal > 0);
  assert.equal(summary.unnamedNodeIndexes.length, 0);
  assert.equal(summary.duplicateNodeIds.length, 0);
  assert.ok(summary.prefixCounts.floor > 0);
  assert.ok(summary.prefixCounts.ceiling > 0);
  assert.ok(summary.prefixCounts.furniture > 0);
  assert.ok(summary.prefixCounts.plumbing > 0);
  for (const nodeId of [
    'plumbing:shower_mbath',
    'plumbing:shower_gbath',
    'plumbing:faucet_mbath_vanity',
    'plumbing:faucet_gbath_vanity',
    'plumbing:drain_mbath_shower',
    'plumbing:drain_mbath_floor',
    'plumbing:drain_gbath_shower',
    'plumbing:drain_gbath_floor',
    'furniture:master_bath:toilet:0',
    'furniture:guest_bath:toilet:1',
    'furniture:master_bath:towel_set:1',
    'shower_screen_mbath:0',
    'shower_screen_gbath:0',
    'furniture:kitchen:kitchen_cabinet_run:0',
    'furniture:kitchen:kitchen_countertop_bridge:1',
    'furniture:kitchen:kitchen_cabinet_run:2',
    'furniture:kitchen:kitchen_cabinet_run:4',
  ]) assert.ok(summary.nodeIds.includes(nodeId), `missing GLB node ${nodeId}`);
  // 2026-09-03：主卧/书房家具按 房间+类型 前缀匹配导出节点，不与 furniture 列表序号耦合
  for (const [room, type] of [
    ['master_bedroom', 'bed_180'],
    ['master_bedroom', 'master_north_wall_wardrobe_950'],
    ['master_bedroom', 'master_bedside_cabinet_350_north'],
    ['master_bedroom', 'master_bedside_cabinet_350_south'],
    ['master_bedroom', 'mb_washbasin_cabinet'],
    ['master_bedroom', 'master_dressing_table'],
    ['master_bedroom', 'dressing_stool'],
    ['master_bedroom', 'master_hot_season_low_dresser'],
    ['bedroom_se', 'study_seasonal_wardrobe_wall'],
    ['bedroom_se', 'bench_adjustable'],
    ['bedroom_se', 'adjustable_dumbbell_pair'],
    ['bedroom_se', 'rollable_training_mat'],
    ['bedroom_se', 'desk'],
    ['bedroom_se', 'chair'],
  ] as const) {
    assert.ok(summary.nodeIds.some((id) => id.startsWith(`furniture:${room}:${type}:`)), `missing GLB node furniture:${room}:${type}:*`);
  }
  for (const removed of ['master_wardrobe_tall_240', 'squat_rack', 'barbell_olympic', 'weight_plate_set', 'rubber_training_mat', 'low_room_cabinet']) {
    assert.equal(summary.nodeIds.some((id) => id.startsWith(`furniture:master_bedroom:${removed}:`) || id.startsWith(`furniture:bedroom_se:${removed}:`)), false, `removed furniture ${removed} must not export`);
  }
  assert.ok(summary.fixtureRoles?.some((entry) => entry.nodeName.startsWith('furniture:kitchen:') && entry.part.startsWith('basin-') && entry.role === 'ceramic'), 'kitchen sink ceramic role missing');
  assert.ok(summary.fixtureRoles?.some((entry) => entry.nodeName.startsWith('furniture:kitchen:') && entry.role === 'fixture_metal'), 'kitchen gas stove fixture_metal base role missing');
  assert.ok(summary.fixtureRoles?.some((entry) => entry.nodeName.includes(':role=cooktop_surface') && entry.role === 'cooktop_surface'), 'kitchen gas stove cooktop_surface role missing');
  assert.ok(summary.fixtureRoles?.some((entry) => entry.nodeName.startsWith('furniture:kitchen:gas_stove:') && entry.part.startsWith('b-') && entry.role === 'cooktop_burner'), 'kitchen gas stove burner role missing');
  assert.ok(summary.fixtureRoles?.some((entry) => entry.nodeName.startsWith('furniture:kitchen:gas_stove:') && entry.part.startsWith('knob-') && entry.role === 'hardware'), 'kitchen gas stove knob hardware role missing');
  assert.ok(summary.fixtureRoles?.some((entry) => entry.nodeName.startsWith('furniture:kitchen:dishwasher:') && entry.part.includes('p-') && entry.role === 'fixture_metal'), 'kitchen dishwasher front fixture_metal role missing');
  assert.equal(summary.duplicateFixtureRoleTags?.length ?? 0, 0, 'GLB must not duplicate fixture role tags');
  assert.equal(summary.duplicateNodeIds.length, 0, 'bath GLB must not duplicate exported object ids');
  assert.ok(summary.worldBbox);
});

test('CLI parses reproducible overlay and ceiling inputs', () => {
  assert.deepEqual(parseExportArgs(['--output', 'tmp/out.glb', '--overlay', 'overlay.yaml', '--ceiling', 'ceiling.yaml', '--render-facts', 'facts.json']), {
    output: 'tmp/out.glb', overlay: 'overlay.yaml', ceiling: 'ceiling.yaml', renderFacts: 'facts.json',
  });
});

test('CLI output protection rejects an existing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-glb-output-'));
  const path = join(dir, 'existing.glb');
  writeFileSync(path, 'sentinel');
  assert.throws(() => assertOutputPathAvailable(path), /Refusing to overwrite existing output file/);
});
