import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { load } from 'js-yaml';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { parseOverlay, mergeSceneElements } from '../../server/overlay-merge.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { computePaintScope, type PaintWallInput } from '../../shared/paint-scope.js';

/**
 * 弧墙（圆角）上的贴砖/涂漆面必须贴在墙上（DEC-2026-10-09-P14 的 wall_region / paint_region 部分）。
 *
 * 背景：三个 overlay 分支（wall_region / paint_region / sill_region）原来共用同一套公式——
 * `span = hypot(end-start)`、`mid = (start+end)/2`，即把「起终点弦」当整块面。直墙上弦就是墙，
 * 成立；**弧墙上弦不是墙**，整块网格会飘在空中。sill_region 已在 DEC-2026-10-09-P14 修掉，
 * 这里守住另外两个分支。
 *
 * 真实反例：圆角墙 w_bath_north（r=1.0 圆角弧 + z=1.10 直线，17 段、沿墙总长 3.170m）上一条
 * 全跨度声明，弦中点被算成 (1.30,1.60)，离真实墙面 0.50m。修法：沿折线把 [from,to] 裁成一段段
 * 直线，逐段出网（每段用自己的中点与旋转角/法线），直墙仍保持单块不拆。
 */

const MG: any = load(readFileSync('config/layout/model-geometry.yaml', 'utf8'));
const layout = resolveLayout(MG);
const walls: any[] = layout.walls;

/** 全部墙段（折线段优先，否则单段）——独立于被测代码，用于算「离墙多远」。 */
function wallSegments(): Array<{ id: string; x1: number; z1: number; x2: number; z2: number }> {
  const out: Array<{ id: string; x1: number; z1: number; x2: number; z2: number }> = [];
  for (const wall of walls) {
    const segments = wall.segments?.length ? wall.segments : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
    for (const segment of segments) out.push({ id: wall.id, x1: segment.x1, z1: segment.z1, x2: segment.x2, z2: segment.z2 });
  }
  return out;
}
const SEGMENTS = wallSegments();

/** 点到全部墙段的最近距离（弧墙由多段折线近似，最近距离即到折线的距离）。 */
function distanceToWalls(point: { x: number; z: number }): number {
  let best = Number.POSITIVE_INFINITY;
  for (const segment of SEGMENTS) {
    const dx = segment.x2 - segment.x1, dz = segment.z2 - segment.z1;
    const lengthSq = dx * dx + dz * dz;
    let t = lengthSq > 0 ? ((point.x - segment.x1) * dx + (point.z - segment.z1) * dz) / lengthSq : 0;
    t = Math.min(1, Math.max(0, t));
    best = Math.min(best, Math.hypot(point.x - (segment.x1 + dx * t), point.z - (segment.z1 + dz * t)));
  }
  return best;
}

function regionMeshes(root: THREE.Object3D, type: 'wall_region' | 'paint_region'): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((object: any) => { if (object.userData?.type === type) out.push(object as THREE.Mesh); });
  return out;
}

/** 网格世界包围盒中心离最近墙段的距离——悬空 bug 的直接度量。 */
function offWallDistance(mesh: THREE.Mesh): number {
  mesh.updateWorldMatrix(true, false);
  const centre = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  return distanceToWalls({ x: centre.x, z: centre.z });
}

function meshArea(mesh: THREE.Mesh): number {
  const parameters = (mesh.geometry as any).parameters;
  return parameters.width * parameters.height;
}

const curved = walls.find((wall) => wall.id === 'w_bath_north');
const CURVED_TOTAL = curved.segments.reduce(
  (sum: number, segment: any) => sum + Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1), 0,
);
const straight = walls.find((wall) => wall.id === 'w_mbath_south');

test('w_bath_north really is an arc wall (the fixture this regression guards)', () => {
  assert.ok(curved?.segments?.length > 1, 'w_bath_north 必须带多段折线（圆角弧）');
  assert.ok(Math.abs(CURVED_TOTAL - 3.170) < 5e-3, `沿墙总长应为 3.170m，实际 ${CURVED_TOTAL.toFixed(3)}`);
  // 起终点弦长明显短于沿墙长度：这正是「弦不是墙」的量化证据
  const chord = Math.hypot(curved.x2 - curved.x1, curved.z2 - curved.z1);
  assert.ok(chord < CURVED_TOTAL - 0.3, `弦长 ${chord.toFixed(3)} 必须明显短于沿墙长 ${CURVED_TOTAL.toFixed(3)}`);
  assert.ok(straight && (straight.segments?.length ?? 0) <= 1, '对照组 w_mbath_south 必须是直墙');
});

test('wall_region on the arc wall is split along the polyline and every piece hugs the wall', () => {
  const scene: any = buildScene({
    walls: [curved],
    rooms: layout.rooms,
    elements: [
      { id: 'probe_full', type: 'wall_region', wall: 'w_bath_north', room: 'master_bath', along: [0, CURVED_TOTAL], height: 2.65, zone: 'visible' },
      { id: 'probe_partial', type: 'wall_region', wall: 'w_bath_north', room: 'master_bath', along: [0.5, 2.0], height: 0.3 },
    ],
    furnishings: {},
  } as any);
  assert.deepEqual(scene.report.unsupported, [], '弧墙上的声明必须能落地');
  const meshes = regionMeshes(scene.exportRoot, 'wall_region');
  // 全跨度声明跨越全部 17 段折线 → 17 块；部分声明 0.5~2.0 跨越圆角第 6~16 段 + 直线段 → 12 块
  assert.equal(meshes.length, 29, `应逐段出网，实际 ${meshes.length} 块`);
  for (const mesh of meshes) {
    assert.ok(offWallDistance(mesh) <= 0.12, `${mesh.userData.objectId} 离墙 ${offWallDistance(mesh).toFixed(3)}m（悬空）`);
  }
  // 拆块不许多算/少算面积：每块宽 × 高 求和 == 声明沿墙长 × 砖带高
  const full = meshes.filter((mesh) => String(mesh.userData.regionId ?? mesh.userData.objectId).startsWith('probe_full'));
  const partial = meshes.filter((mesh) => String(mesh.userData.regionId ?? mesh.userData.objectId).startsWith('probe_partial'));
  assert.ok(Math.abs(full.reduce((sum, mesh) => sum + meshArea(mesh), 0) - CURVED_TOTAL * 2.65) < 1e-6, '全跨度面积必须守恒');
  assert.ok(Math.abs(partial.reduce((sum, mesh) => sum + meshArea(mesh), 0) - 1.5 * 0.3) < 1e-6, '部分区间面积必须守恒');
  // objectId 唯一（多块必须加 :sN 后缀）
  const ids = meshes.map((mesh) => String(mesh.userData.objectId));
  assert.equal(new Set(ids).size, ids.length, 'objectId 必须唯一');
  assert.ok(ids.some((value) => value === 'probe_full:s0'), '多块时必须带 :sN 后缀');
});

test('wall_region on a straight wall stays a single mesh with the bare declaration id', () => {
  const scene: any = buildScene({
    walls: [straight],
    rooms: layout.rooms,
    elements: [
      { id: 'probe_straight', type: 'wall_region', wall: 'w_mbath_south', room: 'master_bath', along: [0, 1.15], height: 2.65 },
    ],
    furnishings: {},
  } as any);
  assert.deepEqual(scene.report.unsupported, []);
  const meshes = regionMeshes(scene.exportRoot, 'wall_region');
  assert.equal(meshes.length, 1, '直线墙不许拆');
  assert.equal(meshes[0].userData.objectId, 'probe_straight', '单块时保持原 id，别无谓加后缀');
  assert.ok(offWallDistance(meshes[0]) <= 0.12);
});

test('paint_region on the arc wall is split per rect along the polyline and every piece hugs the wall', () => {
  // computePaintScope 把 wallLength round 到 3 位小数，声明区间必须落在其内
  const span = Math.min(CURVED_TOTAL, 3.169);
  const scene: any = buildScene({
    walls: [curved],
    rooms: layout.rooms,
    elements: [
      { id: 'probe_paint', type: 'paint_region', wall: 'w_bath_north', room: 'master_bath', along: [0, span], height: 2.8 },
    ],
    furnishings: {},
  } as any);
  assert.deepEqual(scene.report.unsupported, [], '弧墙上的涂漆声明必须能落地');
  const meshes = regionMeshes(scene.exportRoot, 'paint_region');
  assert.ok(meshes.length > 1, `弧墙上必须逐段出网，实际 ${meshes.length} 块`);
  for (const mesh of meshes) {
    assert.ok(offWallDistance(mesh) <= 0.12, `${mesh.userData.objectId} 离墙 ${offWallDistance(mesh).toFixed(3)}m（悬空）`);
  }
  // 面积不变：拆块前后净面积都必须等于 computePaintScope 的口径（面积只由声明算）
  const wallInput: PaintWallInput = {
    id: curved.id, x1: curved.x1, z1: curved.z1, x2: curved.x2, z2: curved.z2,
    ...(curved.segments ? { segments: curved.segments } : {}),
    ...(curved.height !== undefined ? { height: curved.height } : {}),
  };
  const expected = computePaintScope([wallInput], [{ id: 'probe_paint', wall: 'w_bath_north', room: 'master_bath', along: [0, span], bottom: 0, height: 2.8 }], []);
  const net = meshes.reduce((sum: number, mesh: any) => sum + meshArea(mesh), 0);
  assert.ok(Math.abs(net - expected.netAreaSqm) < 1e-3, `网格面积合计 ${net.toFixed(6)} 应等于声明净面积 ${expected.netAreaSqm}`);
  const ids = meshes.map((mesh) => String(mesh.userData.objectId));
  assert.equal(new Set(ids).size, ids.length, 'objectId 必须唯一');
  for (const mesh of meshes) assert.equal(mesh.userData.regionId, 'probe_paint', 'regionId 仍须指向声明本身');
});

test('every wall_region / paint_region mesh in the production scene hugs a real wall', () => {
  const merged = mergeSceneElements(walls as any, parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')));
  const scene: any = buildScene({
    walls,
    rooms: layout.rooms,
    elements: merged.filter((element: any) => ['wall_region', 'paint_region', 'sill_region', 'bay_sill', 'wall'].includes(element.type)),
    furnishings: {},
  } as any);
  assert.deepEqual(scene.report.unsupported, [], '生产声明必须全部落地');
  const meshes = [...regionMeshes(scene.exportRoot, 'wall_region'), ...regionMeshes(scene.exportRoot, 'paint_region')];
  assert.ok(meshes.length > 0, '生产场景应产出贴砖/涂漆网格');
  const floating = meshes.filter((mesh) => offWallDistance(mesh) > 0.12);
  assert.deepEqual(floating.map((mesh) => `${mesh.userData.objectId}@${offWallDistance(mesh).toFixed(3)}m`), [], '不得有悬空网格');
});
