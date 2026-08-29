import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import * as sharedSceneBuilder from '../../shared/render/SceneBuilder.js';
import { exportSceneToGlbData } from '../../shared/render/export-gltf.js';
import { buildCliHouseScene } from '../../scripts/cli-glb-builder.js';
import { installNodeFileReader } from '../../scripts/node-gltf-runtime.js';
import { assertOutputPathAvailable, parseArgs as parseExportArgs } from '../../scripts/export-glb.js';
import { inspectGlb } from '../../scripts/inspect-glb.js';

test('CLI render sources depend on shared modules, not app render modules', () => {
  const builderSource = readFileSync('scripts/cli-glb-builder.ts', 'utf8');
  const exporterSource = readFileSync('scripts/export-glb.ts', 'utf8');
  assert.match(builderSource, /from ['\"]\.\.\/shared\/render\/SceneBuilder\.js['\"]/);
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

interface CeilingEntry {
  id: string;
  room: string;
  type: string;
  thickness?: number;
  area?: [number, number, number, number];
}

function readCeilingEntries(): CeilingEntry[] {
  return parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as CeilingEntry[];
}

test('CLI builder creates core geometry with export metadata', () => {
  const { scene, report } = buildCliHouseScene();
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
  assert.deepEqual(furniture.position.toArray(), [3.2, 0, 7.875]);

  for (const [room, index, x, z] of [['master_bath', 1, 0.24, 2.23], ['guest_bath', 2, 7.08, 3.00] ] as const) {
    const towelSet = scene.getObjectByName(`furniture:${room}:towel_set:${index}`);
    assert.ok(towelSet, `missing ${room} towel_set`);
    assert.deepEqual(towelSet.position.toArray(), [x, 0, z]);
  }
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
  assert.equal(report.plumbing, 18);
  assert.equal(index.plumbing.size, 18);
  assert.ok(Math.abs(showers[0].position.x - 0.5) < 1e-6);
  assert.ok(Math.abs(showers[0].position.y) < 1e-6);
  assert.ok(Math.abs(showers[0].position.z - 2.785) < 1e-6, `master shower z=${showers[0].position.z}`);
  assert.ok(Math.abs(showers[1].position.x - 5.675) < 1e-6, `guest shower x=${showers[1].position.x}`);
  assert.ok(Math.abs(showers[1].position.y) < 1e-6);
  assert.ok(Math.abs(showers[1].position.z - 3) < 1e-6);
  assert.ok(exportRoot.getObjectByName('furniture:master_bath:toilet:0'));
  assert.equal(exportRoot.getObjectByName('furniture:master_bath:shower_set:1'), undefined, 'shower_set has no FixtureFactory recipe; shower geometry comes from plumbing points');
});

test('CLI facts projection exports lighting fixture geometry and no-facts CLI does not', async () => {
  const withoutFacts = buildCliHouseScene();
  assert.equal(withoutFacts.report.lightingFixtures, 0);
  assert.equal(withoutFacts.exportRoot.getObjectByName('LIGHTING_FIXTURES'), undefined);
  const withFacts = buildCliHouseScene(undefined, undefined, undefined, undefined, 'scripts/blender/project-render-facts.json');
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
  const facts = JSON.parse(readFileSync('scripts/blender/project-render-facts.json', 'utf8'));
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
  const { exportRoot, report, index } = buildCliHouseScene(undefined, undefined, undefined, undefined, 'scripts/blender/project-render-facts.json');
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
});

test('CLI exports every solid ceiling.yaml zone with the Web metadata contract', () => {
  const entries = readCeilingEntries();
  const solidEntries = entries.filter((entry) =>
    ['drop', 'integrated', 'aluminum_buckle'].includes(entry.type)
    && entry.area !== undefined
    && entry.thickness !== undefined
    && entry.thickness > 0,
  );
  const { scene, report } = buildCliHouseScene();
  const solids = collectObjects(scene).filter((object) => object.userData.type === 'ceiling_zone_solid');
  assert.equal(report.ceilingZones, solidEntries.length);
  assert.equal(solids.length, solidEntries.length * 5);
  for (const entry of solidEntries) {
    const objectId = `ceiling:${entry.id}`;
    const matching = solids.filter((object) => object.userData.objectId === objectId);
    assert.equal(matching.length, 5, `expected slab and four skirts for ${objectId}`);
    for (const object of matching) {
      assert.equal(object.userData.roomId, entry.room);
      assert.match(object.userData.exportName, new RegExp(`^${objectId}:`));
      assert.equal(object.name, object.userData.exportName);
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
  assert.ok(Math.abs(guestScreen.min.x - 6.2875) < 1e-5, `guest screen min.x=${guestScreen.min.x}`);
  assert.ok(Math.abs(guestScreen.max.x - 6.3125) < 1e-5, `guest screen max.x=${guestScreen.max.x}`);
  assert.ok(Math.abs(guestScreen.min.z - 2.6) < 1e-5, `guest screen min.z=${guestScreen.min.z}`);
  assert.ok(Math.abs(guestScreen.max.z - 3.4) < 1e-5, `guest screen max.z=${guestScreen.max.z}`);
  assert.ok(Math.abs(guestScreen.max.y - guestScreen.min.y - 1.95) < 1e-5);
  const guestScreenObject = exportRoot.getObjectByName('shower_screen_gbath:0');
  assert.equal(guestScreenObject?.userData.type, 'shower_screen');
  assert.equal(guestScreenObject?.userData.objectId, 'shower_screen_gbath:0');
  assert.equal(guestScreenObject?.parent, exportRoot);

  const furniture = exportRoot.getObjectByName('furniture:master_bedroom:wardrobe_240_split:1');
  assert.ok(furniture);
  assert.equal(exportRoot.getObjectByName('platform_boundary'), undefined, 'CLI export scene must exclude platform geometry');
  const furnitureBox = new THREE.Box3().setFromObject(furniture);
  assert.ok(Math.abs(furnitureBox.min.x - 1.8) < 1e-5);
  assert.ok(Math.abs(furnitureBox.max.x - 4.2) < 1e-5);
  assert.ok(Math.abs(furnitureBox.min.z - 5.55) < 1e-5);
  assert.ok(Math.abs(furnitureBox.max.z - 6.35) < 1e-5);

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
    'furniture:guest_bath:toilet:0',
    'furniture:master_bedroom:vanity_dresser:2',
    'furniture:master_bath:towel_set:1',
    'furniture:guest_bath:vanity:1',
    'furniture:guest_bath:towel_set:2',
    'shower_screen_mbath:0',
    'shower_screen_gbath:0',
    'furniture:kitchen:kitchen_cabinet_run:0',
    'furniture:kitchen:kitchen_countertop_bridge:1',
    'furniture:kitchen:kitchen_cabinet_run:2',
    'furniture:kitchen:kitchen_cabinet_run:4',
  ]) assert.ok(summary.nodeIds.includes(nodeId), `missing GLB node ${nodeId}`);
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
