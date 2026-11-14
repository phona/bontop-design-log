import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildInfrastructure } from '../../../shared/render/InfrastructureBuilder.js';
import type { PointWall } from '../../../shared/point-placement.js';

test('shared infrastructure builder preserves metadata and projects wall-side fixtures', () => {
  const result = buildInfrastructure({
    electrical: [
      // along 自墙段起点 (2,-1) 沿墙累计：z=0.5 → along=1.5、z=1 → along=2（issue #98 S1 起唯一定位来源）
      { id: 'switch-west', room: 'room', type: 'switch', x: 2, z: 0.5, along: 1.5, height: 1.2, wall: 'wall', wallSide: 'west' },
      { id: 'panel', room: 'room', type: 'strong_panel', x: 2, z: 1, along: 2, wall: 'wall', wallSide: 'west', mount_height: 1.5, body_height: 0.4, width: 0.4, depth: 0.2, status: 'measured', position_status: 'inferred' },
    ],
    plumbing: [{ id: 'drain', room: 'room', type: 'drain', x: 1, z: 1, height: 0.1, absolute: true }],
    pointWalls: new Map<string, PointWall>([['wall', { segments: [{ x1: 2, z1: -1, x2: 2, z2: 3 }], line_datum: 'centerline' }]]),
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

test('shared infrastructure builder keeps authored coordinates for absolute points', () => {
  const [fixture] = buildInfrastructure({
    electrical: [{ id: 'socket', room: 'room', type: 'socket', x: 1, z: 2, height: 0.4, absolute: true }],
    plumbing: [],
  }).electrical;
  assert.deepEqual(fixture.position.toArray(), [1, 0.4, 2]);
  assert.equal(fixture.rotation.y, 0);
});

// issue #98 S1：墙引用解不出来（宿主墙缺失/缺 along）不再静默按声明坐标落位——
// 那是 sock_weakbox 242mm 偏差的机制根源。点位不出场景，诊断显形。
test('shared infrastructure builder fails closed on unresolvable wall points', () => {
  const built = buildInfrastructure({
    electrical: [
      { id: 'dangling', room: 'room', type: 'socket', x: 1, z: 2, height: 0.4, wall: 'missing' },
      { id: 'no-along', room: 'room', type: 'socket', x: 2, z: 1, height: 0.4, wall: 'wall', wallSide: 'west' },
      { id: 'beyond', room: 'room', type: 'socket', x: 2, z: 1, along: 9, height: 0.4, wall: 'wall', wallSide: 'west' },
    ],
    plumbing: [],
    pointWalls: new Map<string, PointWall>([['wall', { segments: [{ x1: 2, z1: -1, x2: 2, z2: 3 }], line_datum: 'centerline' }]]),
  });
  assert.equal(built.electrical.length, 0);
  assert.equal(built.placementDiagnostics.length, 3);
  // 缺 along 先于宿主墙查找报出（along 是唯一定位来源，缺它连墙都不用查）
  assert.match(built.placementDiagnostics[0], /dangling.*wall \+ along 齐备/);
  assert.match(built.placementDiagnostics[1], /no-along.*wall \+ along 齐备/);
  assert.match(built.placementDiagnostics[2], /beyond.*越出墙段/);
  // 宿主墙断引用单独一条：有 along 但墙不在索引里
  const dangling = buildInfrastructure({
    electrical: [{ id: 'dangling-wall', room: 'room', type: 'socket', x: 1, z: 2, along: 1, height: 0.4, wall: 'missing', wallSide: 'west' }],
    plumbing: [],
    pointWalls: new Map<string, PointWall>([['wall', { segments: [{ x1: 2, z1: -1, x2: 2, z2: 3 }], line_datum: 'centerline' }]]),
  });
  assert.equal(dangling.electrical.length, 0);
  assert.match(dangling.placementDiagnostics[0], /dangling-wall.*宿主墙 "missing" 不在墙段索引里/);
});

test('shared plumbing shower uses the declared height as the finished-floor-to-head anchor', () => {
  const [fixture] = buildInfrastructure({
    electrical: [],
    plumbing: [{ id: 'shower', room: 'bath', type: 'shower', x: 1, z: 2, height: 1.0 }],
  }).plumbing;
  fixture.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(fixture);
  assert.ok(Math.abs(bbox.min.y) < 1e-9);
  assert.ok(Math.abs(bbox.max.y - 1.0) < 0.02);
  assert.equal(fixture.userData.placementHeight, 1.0);
  assert.equal(fixture.userData.heightMeaning, 'finished_floor_to_shower_head');
});

// issue #98 二阶段 S1（Codex 一审 blocking）：anchor / mount 点位须有家具宿主索引才能
// 建场——SceneBuilder 与 HouseScene.placeInfrastructureFixtures 此前只传 pointWalls，
// 合法 anchor 声明会让整个 buildScene 抛错。接线补齐后 anchor 插座落到宿主中心 + offset。
test('shared infrastructure builder places anchor and mount points once mountHosts are wired', () => {
  const mountHosts = new Map([
    ['test.sofa', { id: 'test.sofa', x: 11.0, z: 7.7, rotation: 0, width: 2.2, depth: 1.0 }],
    ['test.vanity', { id: 'test.vanity', x: 5, z: 5, rotation: 0, width: 0.9, depth: 0.5 }],
  ]);
  const built = buildInfrastructure({
    electrical: [
      { id: 'sock-sofa', room: 'room', type: 'socket', height: 0.4, anchor: { source: 'furniture', id: 'test.sofa', offset: { x: 0.5, z: 0 } } },
      { id: 'sock-vanity', room: 'room', type: 'socket', height: 0.4, mount: { furniture_id: 'test.vanity', face: 'north', along: 0.25, surface_gap: 0.003 } },
    ],
    plumbing: [],
    pointWalls: new Map(),
    mountHosts,
  });
  assert.deepEqual(built.placementDiagnostics, []);
  assert.equal(built.electrical.length, 2);
  // anchor 点位：宿主中心 (11.0, 7.7) + offset (0.5, 0)，绝对落位不读声明 x/z。
  assert.deepEqual(built.electrical[0].position.toArray(), [11.5, 0.4, 7.7]);
  // mount 点位同链路可用（北脸 along 0.25，自 minX=4.55 向东 → x=4.8）。
  assert.ok(Math.abs(built.electrical[1].position.x - 4.8) < 1e-9);
});

test('shared infrastructure builder fails closed when anchor points have no mountHosts', () => {
  // 缺索引是调用方接线缺陷（与 mount 同一口径）：当场抛，不许带着空索引继续解算。
  assert.throws(
    () => buildInfrastructure({
      electrical: [
        { id: 'sock-sofa', room: 'room', type: 'socket', height: 0.4, anchor: { source: 'furniture', id: 'test.sofa', offset: { x: 0.5, z: 0 } } },
      ],
      plumbing: [],
      pointWalls: new Map(),
    }),
    /anchor 定位要求调用方提供家具宿主索引/,
  );
});
