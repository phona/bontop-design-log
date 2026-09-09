import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { FURNITURE_DIMS, isCurtainSoftEnvelopePreview, MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE, type RenderLightingFixture } from '../../shared/types.js';
import { buildFixture, setNorthWallWardrobe950DoorConfiguration, type NorthWallWardrobe950DoorConfiguration, setNorthWallWardrobe950DoorState } from '../../shared/render/FixtureFactory.js';
import { buildInfrastructure } from '../../shared/render/InfrastructureBuilder.js';
import { buildLightingFixtures } from '../../shared/render/LightingFixtureBuilder.js';
import * as THREE from 'three';

type Furnishing = { type: string; x?: number; z?: number; rotation?: number };
type ElectricalPoint = {
  id: string;
  type?: string;
  x?: number;
  z?: number;
  height?: number;
  wall?: string;
  wall_side?: string;
  note?: string;
  appearance?: {
    style: string;
    module: string;
    faceplate_width: number;
    faceplate_height: number;
    projection: number;
    panel_group?: { id: string; role: string; center_spacing: number; union_width: number };
  };
};
type PlumbingPoint = { id: string; x?: number; z?: number };
type RuntimeAabb = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

const house = load(readFileSync('config/house.yaml', 'utf8')) as { furnishings: Record<string, Furnishing[]> };
const electrical = load(readFileSync('config/electrical.yaml', 'utf8')) as ElectricalPoint[];
const plumbing = load(readFileSync('config/plumbing.yaml', 'utf8')) as PlumbingPoint[];
const master = house.furnishings.master_bedroom;

const GAP_EPS = 1e-9;
const RUNTIME_EPS = 1e-6;

test('R6 curtain soft envelope stays separate from hard floor collision', () => {
  assert.equal(isCurtainSoftEnvelopePreview(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE), true);
  assert.deepEqual(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.topBox, { z: [8.7, 8.95], ceilingOnly: true, confidence: 'confirmed', status: 'confirmed' });
  assert.deepEqual(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.closedDrop, {
    wallZ: 9.8,
    interiorOffset: 0.12,
    thickness: 0.12,
    z: [9.56, 9.68],
    confidence: 'inferred',
    status: 'site_pending',
    conflictLevel: 'warning',
    acceptance: 'BLOCKED',
  });
  assert.equal(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.openStack.end, null);
  assert.equal(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.openStack.status, 'site_pending');
  assert.equal(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.floorHardExclusion, null);
  assert.deepEqual(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.checkedObjects, ['master_bedside_cabinet_350_south', 'master_hot_season_low_dresser']);
  assert.ok(MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.retainedObjects.includes('master_hot_season_low_dresser'));
});

function fixtureSize(type: string): THREE.Vector3 {
  const fixture = buildFixture(type);
  assert.ok(fixture, `missing fixture ${type}`);
  fixture!.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(fixture!).getSize(new THREE.Vector3());
}

function placed(type: string, room: Furnishing[] = master): Furnishing {
  const item = room.find((candidate) => candidate.type === type && candidate.x !== undefined && candidate.z !== undefined);
  assert.ok(item, `missing placed ${type}`);
  return item;
}

function point(id: string): ElectricalPoint {
  const found = electrical.find((candidate) => candidate.id === id);
  assert.ok(found, `missing electrical point ${id}`);
  return found;
}

// 世界 AABB：奇数 quarter-turn 旋转交换 width/depth（与 verify-furniture-placement 同口径）
function worldAabb(item: Furnishing): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const dims = FURNITURE_DIMS[item.type];
  assert.ok(dims, `no FURNITURE_DIMS for ${item.type}`);
  const quarterTurn = Math.round((item.rotation ?? 0) / 90) % 2 !== 0;
  const width = quarterTurn ? dims.depth : dims.width;
  const depth = quarterTurn ? dims.width : dims.depth;
  return { minX: item.x! - width / 2, maxX: item.x! + width / 2, minZ: item.z! - depth / 2, maxZ: item.z! + depth / 2 };
}

function runtimeAabb(object: THREE.Object3D): RuntimeAabb {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  return { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z };
}

function runtimeFurnitureAabb(type: string): RuntimeAabb {
  const item = placed(type);
  const fixture = buildFixture(type);
  assert.ok(fixture, `missing runtime furniture fixture ${type}`);
  fixture!.position.set(item.x!, 0, item.z!);
  fixture!.rotation.y = THREE.MathUtils.degToRad(item.rotation ?? 0);
  return runtimeAabb(fixture!);
}

function runtimeElectricalAabb(id: string): RuntimeAabb {
  const source = point(id);
  if (source.type === 'wall_lamp') {
    const built = buildLightingFixtures([{
      id: source.id,
      room: 'master_bedroom',
      type: 'wall_lamp',
      position: { x: source.x!, y: source.height!, z: source.z! },
      temperatureK: 3000,
      enabled: true,
      wallId: source.wall,
      wallSide: source.wall_side as RenderLightingFixture['wallSide'],
    }]);
    const fixture = built.fixtures.get(`electrical:${id}`);
    assert.ok(fixture, `missing runtime lighting fixture ${id}`);
    return runtimeAabb(fixture!);
  }
  const normalized = { ...source, wallSide: source.wall_side };
  const built = buildInfrastructure({
    electrical: [normalized as any],
    plumbing: [],
    wallSegments: new Map([['w_mb_east', [{ x1: 4.20, z1: 5.55, x2: 4.20, z2: 9.80 }]]]),
  });
  const fixture = built.electrical[0];
  assert.ok(fixture, `missing runtime electrical fixture ${id}`);
  return runtimeAabb(fixture!);
}

function aabbIntersects(a: RuntimeAabb, b: RuntimeAabb): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

test('950 left shift clears d_mb while preserving the north-wall room envelope', () => {
  const currentMaxX = 3.55;
  const targetMaxX = 3.25;
  const wardrobeWidth = 0.95;
  const shift = currentMaxX - targetMaxX;
  const candidateMinX = targetMaxX - wardrobeWidth;
  assert.ok(Math.abs(shift - 0.30) < GAP_EPS);
  assert.equal(candidateMinX, 2.30);
  assert.equal(candidateMinX + wardrobeWidth, targetMaxX);
  assert.ok(targetMaxX <= 3.30, 'candidate must clear d_mb sweep west edge');
});

test('R9 master-bedroom furniture set places the 950 three-door wardrobe and removes R5/R6 objects', () => {
  assert.deepEqual(placed('bed_180'), { type: 'bed_180', x: 3.20, z: 7.40, rotation: 270 });
  assert.deepEqual(placed('master_north_wall_wardrobe_950'), { type: 'master_north_wall_wardrobe_950', x: 2.45, z: 4.59, rotation: 0 });
  assert.deepEqual(placed('master_wardrobe_top_pelmet'), { type: 'master_wardrobe_top_pelmet', x: 2.45, z: 4.59, rotation: 0 });
  assert.deepEqual(placed('master_bedside_cabinet_350_north'), { type: 'master_bedside_cabinet_350_north', x: 4.01, z: 6.245, rotation: 0 });
  assert.deepEqual(placed('master_bedside_cabinet_350_south'), { type: 'master_bedside_cabinet_350_south', x: 4.01, z: 8.555, rotation: 0 });
  assert.deepEqual(FURNITURE_DIMS.master_north_wall_wardrobe_950, { width: 0.95, depth: 0.58 });
  assert.deepEqual(FURNITURE_DIMS.master_bedside_cabinet_350_north, { width: 0.38, depth: 0.35 });
  assert.deepEqual(FURNITURE_DIMS.master_bedside_cabinet_350_south, { width: 0.38, depth: 0.35 });
  assert.ok(fixtureSize('master_bedside_cabinet_350_north').y >= 0.495 && fixtureSize('master_bedside_cabinet_350_north').y <= 0.505);
  assert.ok(fixtureSize('master_bedside_cabinet_350_south').y >= 0.495 && fixtureSize('master_bedside_cabinet_350_south').y <= 0.505);
  assert.deepEqual(FURNITURE_DIMS.bed_180, { width: 1.8, depth: 2.0 });
  for (const type of ['socket', 'switch', 'switch_2way']) {
    const fixture = buildFixture(type);
    assert.ok(fixture);
    fixture!.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(fixture!).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x - 0.086) < 1e-6 && Math.abs(size.y - 0.086) < 1e-6, `${type} must be 86x86mm`);
    assert.ok(fixture!.children.some((child) => child.userData.materialRole === 'faceplate'));
    assert.ok(type === 'socket' ? fixture!.children.some((child) => child.userData.materialRole === 'usb_c') : fixture!.children.some((child) => child.userData.materialRole === 'rocker'));
  }
  for (const removed of ['master_partition_wardrobe_1600', 'master_dressing_connection_storage', 'master_freestanding_wardrobe_062', 'master_bedside_cabinet_north', 'master_bedside_tray_south', 'master_north_wall_wardrobe_600', 'master_north_wall_wardrobe_650']) {
    assert.equal(master.some((item) => item.type === removed && item.x !== undefined), false, `${removed} must be removed from R7 placed set`);
  }
  const wardrobe = placed('master_north_wall_wardrobe_950');
  const box = worldAabb(wardrobe);
  assert.ok(Math.abs(box.minX - 1.975) < GAP_EPS && Math.abs(box.maxX - 2.925) < GAP_EPS);
  assert.ok(Math.abs(box.minZ - 4.30) < GAP_EPS && Math.abs(box.maxZ - 4.88) < GAP_EPS);
  for (const type of ['mb_vanity_lower_board_bridge', 'mb_vanity_main_board_bridge']) {
    assert.equal(master.some((item) => item.type === type), false, `${type} must be removed from active placed set`);
    assert.equal((FURNITURE_DIMS as Record<string, unknown>)[type], undefined, `${type} fixture dimensions must be removed`);
  }
  for (const type of ['mb_vanity_lower_board', 'mb_vanity_main_board']) {
    const board = master.find((item) => item.type === type);
    assert.deepEqual(board, { type, wall: 'w_mbath_east', wall_side: 'west', rotation: 270, along: 3.61, width: 1.38, depth: 0.565, wall_clearance: 0.015 });
  }
  assert.deepEqual(placed('master_wardrobe_top_pelmet'), { type: 'master_wardrobe_top_pelmet', x: 2.45, z: 4.59, rotation: 0 });
  assert.deepEqual(FURNITURE_DIMS.master_wardrobe_top_pelmet, { width: 0.95, depth: 0.58 });
  const baseCabinet = buildFixture('mb_vanity_base_cabinet');
  assert.ok(baseCabinet);
  baseCabinet!.position.set(2.2575, 0, 3.61);
  baseCabinet!.rotation.y = THREE.MathUtils.degToRad(270);
  baseCabinet!.updateMatrixWorld(true);
  const baseBox = new THREE.Box3().setFromObject(baseCabinet!);
  assert.ok(Math.abs(baseBox.min.x - 1.975) < 1e-6 && Math.abs(baseBox.max.x - 2.54) < 1e-6);
  assert.ok(Math.abs(baseBox.min.z - 2.92) < 1e-6 && Math.abs(baseBox.max.z - 4.30) < 1e-6);
  assert.equal(buildFixture('mb_vanity_continuous_closure_cabinet'), null);
});

test('R9 vanity boards anchor to the wall west finish without bridge geometry', () => {
  for (const [type, yBand] of [['mb_vanity_lower_board', [0.965, 1.035]], ['mb_vanity_main_board', [1.515, 1.585]]] as const) {
    const board = buildFixture(type);
    assert.ok(board, `missing fixture ${type}`);
    board!.position.set(2.2575, 0, 3.61);
    board!.rotation.y = THREE.MathUtils.degToRad(270);
    board!.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(board!);
    assert.ok(Math.abs(box.min.z - 2.92) < 1e-6 && Math.abs(box.max.z - 4.30) < 1e-6, `${type} z[${box.min.z},${box.max.z}]`);
    assert.ok(Math.abs(box.min.x - 1.975) < 1e-6 && Math.abs(box.max.x - 2.54) < 1e-6, `${type} AABB must be x[1.975,2.54]`);
    assert.ok(box.min.y >= yBand[0] - 1e-6 && box.max.y <= yBand[1] + 1e-6, `${type} y band ${box.min.y}..${box.max.y}`);
    const endFinish = board!.children.find((child) => child.userData.part === 'wardrobe-side-board-end');
    assert.equal(endFinish, undefined, `${type} must remain a plain floating board without a wardrobe-colored end panel`);
  }
});

test('R9 wardrobe top pelmet closes the left-shifted 950 wardrobe-to-head-box seam', () => {
  const pelmet = buildFixture('master_wardrobe_top_pelmet');
  assert.ok(pelmet, 'missing master_wardrobe_top_pelmet fixture');
  pelmet!.position.set(2.45, 0, 4.59);
  pelmet!.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pelmet!);
  // 包络与当前950衣柜同 footprint，顶部只保留通顶柜的薄收口
  assert.ok(Math.abs(box.min.x - 1.975) < 1e-6 && Math.abs(box.max.x - 2.925) < 1e-6, `pelmet x[${box.min.x},${box.max.x}]`);
  assert.ok(Math.abs(box.min.z - 4.30) < 1e-6 && Math.abs(box.max.z - 4.88) < 1e-6, `pelmet z[${box.min.z},${box.max.z}]`);
  assert.ok(Math.abs(box.min.y - 2.79) < 1e-6 && Math.abs(box.max.y - 2.80) < 1e-6, `pelmet y[${box.min.y},${box.max.y}]`);
  // 与柜门同木色、现有 top_filler/end_panel 角色
  const parts: THREE.Object3D[] = [];
  pelmet!.traverse((object) => { if (object.userData.materialRole) parts.push(object); });
  assert.ok(parts.some((part) => part.userData.materialRole === 'top_filler'));
  assert.ok(parts.some((part) => part.userData.materialRole === 'end_panel'));
  // 东竖向填板：贴当前柜体东缘、厚 ≤15mm，不进入主卫门洞
  const filler = parts.find((part) => part.userData.part === 'pelmet-east-filler');
  assert.ok(filler, 'missing pelmet-east-filler');
  const fillerBox = new THREE.Box3().setFromObject(filler!);
  assert.ok(fillerBox.max.x - fillerBox.min.x <= 0.015 + 1e-9, `east filler thickness ${fillerBox.max.x - fillerBox.min.x}`);
  assert.ok(Math.abs(fillerBox.max.x - 2.925) < 1e-6, `east filler maxX=${fillerBox.max.x}`);
  assert.ok(Math.abs(fillerBox.min.z - 4.55) < 1e-6 && Math.abs(fillerBox.max.z - 4.88) < 1e-6, `east filler z[${fillerBox.min.z},${fillerBox.max.z}]`);
  // 不侵 d_mb 开启门扇带 x[3.30,4.20] z[4.63,4.67]
  assert.ok(box.max.x <= 2.925 + 1e-9, 'pelmet must remain within the current 950 wardrobe east edge');
  // 不压回风格栅底面包络：return_master x[3.45,3.95] z[5.075,5.325]
  assert.ok(box.max.x <= 3.45 - 1e-9, 'pelmet must stay west of the return grille bottom envelope x[3.45,3.95]');
  // 与当前衣柜包络关系：x/z 与衣柜一致，柜体顶面到室内净高
  const wardrobe = worldAabb(placed('master_north_wall_wardrobe_950'));
  assert.ok(Math.abs(box.min.x - wardrobe.minX) < 1e-6 && Math.abs(box.max.x - wardrobe.maxX) < 1e-6);
  assert.ok(Math.abs(box.min.z - wardrobe.minZ) < 1e-6 && Math.abs(box.max.z - wardrobe.maxZ) < 1e-6);
});

test('dressing table and stool use the 2026-09-04 R1 window-adjacent candidate transforms', () => {
  const table = placed('master_dressing_table');
  const stool = placed('dressing_stool');
  assert.deepEqual(table, { type: 'master_dressing_table', x: 0.425, z: 6.05, rotation: 90 });
  assert.deepEqual(stool, { type: 'dressing_stool', x: 0.42, z: 6.05, rotation: 90 });
  assert.deepEqual(FURNITURE_DIMS.master_dressing_table, { width: 0.90, depth: 0.45 });
  assert.deepEqual(FURNITURE_DIMS.dressing_stool, { width: 0.42, depth: 0.40 });
  // rotation=90 后桌 footprint：x[0.20,0.65] z[5.60,6.50]，桌背与西玻璃 x=0 留约 0.20m 通风/冷凝缝
  const tableBox = worldAabb(table);
  assert.ok(Math.abs(tableBox.minX - 0.20) < GAP_EPS && Math.abs(tableBox.maxX - 0.65) < GAP_EPS);
  assert.ok(Math.abs(tableBox.minZ - 5.60) < GAP_EPS && Math.abs(tableBox.maxZ - 6.50) < GAP_EPS);
  // 凳收纳态 AABB 完整含于桌 footprint
  const stoolBox = worldAabb(stool);
  assert.ok(stoolBox.minX >= tableBox.minX - GAP_EPS && stoolBox.maxX <= tableBox.maxX + GAP_EPS);
  assert.ok(stoolBox.minZ >= tableBox.minZ - GAP_EPS && stoolBox.maxZ <= tableBox.maxZ + GAP_EPS);
  assert.equal(master.some((item) => item.type === 'vanity_dresser'), false);
});

test('washbasin-only cabinet preserves envelope and plumbing center without a dressing chair', () => {
  // 2026-09-02 初版（迭代 mb-washbasin-curtain-20260901，假定玻璃通高，待量房终核）：
  // 柜体东移 5cm 收宽 1.05，盆/龙头居中至 x=0.575
  assert.deepEqual(placed('mb_washbasin_cabinet'), { type: 'mb_washbasin_cabinet', x: 0.575, z: 3.16, rotation: 0 });
  assert.deepEqual(FURNITURE_DIMS.mb_washbasin_cabinet, { width: 1.05, depth: 0.50 });
  const faucet = plumbing.find((candidate) => candidate.id === 'faucet_mbath_vanity');
  assert.ok(faucet);
  assert.equal(faucet.x, 0.575);
  assert.equal(faucet.z, 2.96);
});

test('R9 bed and bedside AABBs remain explicit', () => {
  const bedBox = worldAabb(placed('bed_180'));
  assert.ok(Math.abs(bedBox.minX - 2.20) < GAP_EPS && Math.abs(bedBox.maxX - 4.20) < GAP_EPS);
  assert.ok(Math.abs(bedBox.minZ - 6.50) < GAP_EPS && Math.abs(bedBox.maxZ - 8.30) < GAP_EPS);
  const wardrobeBox = worldAabb(placed('master_north_wall_wardrobe_950'));
  assert.ok(Math.abs(wardrobeBox.minX - 1.975) < GAP_EPS && Math.abs(wardrobeBox.maxX - 2.925) < GAP_EPS);
  assert.ok(Math.abs(wardrobeBox.minZ - 4.30) < GAP_EPS && Math.abs(wardrobeBox.maxZ - 4.88) < GAP_EPS);
  const north = worldAabb(placed('master_bedside_cabinet_350_north'));
  const south = worldAabb(placed('master_bedside_cabinet_350_south'));
  assert.ok(Math.abs(north.minX - 3.82) < GAP_EPS && Math.abs(north.maxX - 4.20) < GAP_EPS);
  assert.ok(Math.abs(north.minZ - 6.07) < GAP_EPS && Math.abs(north.maxZ - 6.42) < GAP_EPS);
  assert.ok(Math.abs(south.minX - 3.82) < GAP_EPS && Math.abs(south.maxX - 4.20) < GAP_EPS);
  assert.ok(Math.abs(south.minZ - 8.38) < GAP_EPS && Math.abs(south.maxZ - 8.73) < GAP_EPS);
});

test('floor socket sock_master_projector sits in the under-table service zone', () => {
  const socket = point('sock_master_projector');
  assert.equal(socket.type, 'floor_socket');
  assert.equal(socket.x, 0.42);
  assert.equal(socket.z, 5.78);
  assert.equal(socket.height, 0.02);
  const tableBox = worldAabb(placed('master_dressing_table'));
  const stoolBox = worldAabb(placed('dressing_stool'));
  // 落在四腿开放式桌 footprint 内（桌下北侧两腿之间的服务域）
  assert.ok(socket.x! >= tableBox.minX - GAP_EPS && socket.x! <= tableBox.maxX + GAP_EPS);
  assert.ok(socket.z! >= tableBox.minZ - GAP_EPS && socket.z! <= tableBox.maxZ + GAP_EPS);
  // 避开桌腿落点 ≥0.10m（腿长边内缩 0.06m、深边内缩 0.065m，rotation=90 换轴）
  const table = placed('master_dressing_table');
  const legDx = FURNITURE_DIMS.master_dressing_table.depth / 2 - 0.065;
  const legDz = FURNITURE_DIMS.master_dressing_table.width / 2 - 0.06;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const dist = Math.hypot(socket.x! - (table.x! + sx * legDx), socket.z! - (table.z! + sz * legDz));
      assert.ok(dist >= 0.10 - GAP_EPS, `socket-to-leg distance ${dist.toFixed(3)}m`);
    }
  }
  // 不在凳收纳包络内、不入西窗帘线/盒带 x[1.10,1.35]、不在床侧主通道（x∉[1.35,2.20] 且 z < 床北缘 6.55）
  assert.ok(!(socket.x! > stoolBox.minX && socket.x! < stoolBox.maxX && socket.z! > stoolBox.minZ && socket.z! < stoolBox.maxZ), 'socket inside stool stored envelope');
  assert.ok(socket.x! < 1.10);
  assert.ok(!(socket.x! >= 1.35 && socket.x! <= 2.20), 'socket inside bedside main aisle');
  assert.ok(socket.z! < 6.55);
});

test('sock_master_bed_r is the southeast general-purpose backup socket', () => {
  const socket = point('sock_master_bed_r');
  // 坐标/高度/挂面不变，解除梳妆专用语义
  assert.equal(socket.x, 4.20);
  assert.equal(socket.z, 9.15);
  assert.equal(socket.height, 0.7);
  assert.equal(socket.wall, 'w_mb_east');
  assert.equal(socket.wall_side, 'west');
  assert.match(socket.note ?? '', /通用备用/);
  assert.match(socket.note ?? '', /解除/);
  // 可达：位于床南缘以南，不被床实体封死
  const bedBox = worldAabb(placed('bed_180'));
  assert.ok(socket.z! > bedBox.maxZ, `socket z=${socket.z} must stay south of bed south edge ${bedBox.maxZ}`);
});

test('方案A 床头电气按床头柜轴线布置并避开真实床体包络', () => {
  const left = point('sock_master_bed_l');
  const right = point('sock_master_bed_r_head');
  const switchL = point('switch_master_bed_l');
  const switchN = point('switch_master_bed_north');
  const lampL = point('light_master_wall_l');
  const lampR = point('light_master_wall_r');
  for (const p of [left, right, switchL, switchN, lampL, lampR]) {
    assert.equal(p.wall, 'w_mb_east', `${p.id} must stay on w_mb_east`);
    assert.equal(p.wall_side, 'west', `${p.id} must keep wall_side west`);
    assert.equal(p.x, 4.20);
  }
  assert.equal(left.z, 6.202);
  assert.equal(switchN.z, 6.288);
  assert.equal(right.z, 8.512);
  assert.equal(switchL.z, 8.598);
  assert.equal(lampL.z, 6.245);
  assert.equal(lampR.z, 8.555);
  assert.equal(lampL.x, 4.2);
  assert.equal(lampR.x, 4.2);
  assert.equal(lampL.height, 1.35);
  assert.equal(lampR.height, 1.35);
  assert.equal(lampL.wall, 'w_mb_east');
  assert.equal(lampR.wall, 'w_mb_east');
  assert.equal(lampL.wall_side, 'west');
  assert.equal(lampR.wall_side, 'west');
  // 两侧统一 380×350×500 候选柜分别服务北/南床头点位；两侧均为 172×86 暖白哑光一体双联框（北侧 DEC-2026-09-08-R1 补齐）。
  assert.equal(left.height, 0.75);
  assert.equal(right.height, 0.75);
  assert.equal(switchL.height, 0.75);
  assert.equal(switchN.height, 0.75);
  assert.deepEqual(left.appearance, {
    style: 'warm_white_matte_modular', module: 'five_hole_replaceable_usb_c',
    faceplate_width: 0.086, faceplate_height: 0.086, projection: 0.008,
    panel_group: { id: 'master_bed_north_double', role: 'north', center_spacing: 0.086, union_width: 0.172 },
  });
  assert.equal(right.appearance?.module, 'five_hole_replaceable_usb_c');
  assert.equal(switchL.appearance?.module, 'two_way_rocker');
  assert.equal(switchN.appearance?.module, 'two_way_rocker');
  assert.deepEqual(right.appearance?.panel_group, { id: 'master_bed_south_double', role: 'north', center_spacing: 0.086, union_width: 0.172 });
  assert.deepEqual(switchL.appearance?.panel_group, { id: 'master_bed_south_double', role: 'south', center_spacing: 0.086, union_width: 0.172 });
  assert.deepEqual(switchN.appearance?.panel_group, { id: 'master_bed_north_double', role: 'south', center_spacing: 0.086, union_width: 0.172 });

  const bed = runtimeFurnitureAabb('bed_180');
  const northCabinet = runtimeFurnitureAabb('master_bedside_cabinet_350_north');
  const southCabinet = runtimeFurnitureAabb('master_bedside_cabinet_350_south');
  const leftBox = runtimeElectricalAabb(left.id);
  const rightBox = runtimeElectricalAabb(right.id);
  const switchBox = runtimeElectricalAabb(switchL.id);
  const switchNBox = runtimeElectricalAabb(switchN.id);
  const lampLBox = runtimeElectricalAabb(lampL.id);
  const lampRBox = runtimeElectricalAabb(lampR.id);

  // 点位与对应床头柜中心轴对齐；两侧双联框两模块中心距86mm，边缘无缝相接。
  assert.ok(Math.abs((left.z! + switchN.z!) / 2 - (northCabinet.minZ + northCabinet.maxZ) / 2) < RUNTIME_EPS);
  assert.ok(Math.abs(lampL.z! - (northCabinet.minZ + northCabinet.maxZ) / 2) < RUNTIME_EPS);
  assert.ok(Math.abs((right.z! + switchL.z!) / 2 - (southCabinet.minZ + southCabinet.maxZ) / 2) < RUNTIME_EPS);
  assert.ok(Math.abs(lampR.z! - (southCabinet.minZ + southCabinet.maxZ) / 2) < RUNTIME_EPS);
  assert.ok(Math.abs(switchL.z! - right.z! - 0.086) < RUNTIME_EPS);
  assert.ok(Math.abs(switchN.z! - left.z! - 0.086) < RUNTIME_EPS);
  assert.ok(Math.abs(rightBox.maxZ - switchBox.minZ) < RUNTIME_EPS);
  assert.ok(Math.abs(switchBox.maxZ - rightBox.minZ - 0.172) < RUNTIME_EPS);
  assert.ok(Math.abs(leftBox.maxZ - switchNBox.minZ) < RUNTIME_EPS);
  assert.ok(Math.abs(switchNBox.maxZ - leftBox.minZ - 0.172) < RUNTIME_EPS);

  // 使用真实 runtime mesh，而非 FURNITURE_DIMS 推导：床 rail 包络 z[6.47,8.33]。
  assert.ok(bed.minZ - leftBox.maxZ >= 0.225 - RUNTIME_EPS, `north socket-to-bed gap ${bed.minZ - leftBox.maxZ}`);
  assert.ok(bed.minZ - switchNBox.maxZ >= 0.139 - RUNTIME_EPS, `north switch-to-bed gap ${bed.minZ - switchNBox.maxZ}`);
  assert.ok(bed.minZ - lampLBox.maxZ >= 0.185 - RUNTIME_EPS, `north lamp-to-bed gap ${bed.minZ - lampLBox.maxZ}`);
  assert.ok(rightBox.minZ - bed.maxZ >= 0.139 - RUNTIME_EPS, `south socket-to-bed gap ${rightBox.minZ - bed.maxZ}`);
  assert.ok(switchBox.minZ - bed.maxZ >= 0.225 - RUNTIME_EPS, `south switch-to-bed gap ${switchBox.minZ - bed.maxZ}`);
  assert.ok(lampRBox.minZ - bed.maxZ >= 0.185 - RUNTIME_EPS, `south lamp-to-bed gap ${lampRBox.minZ - bed.maxZ}`);
  // w_mb_east centerline x=4.20, default 120mm wall west finish face x=4.14.
  // The complete lamp mesh must remain on the master-bedroom (-x) side.
  assert.ok(lampLBox.maxX <= 4.14 + RUNTIME_EPS, `north lamp crosses west finish face: maxX=${lampLBox.maxX}`);
  assert.ok(lampRBox.maxX <= 4.14 + RUNTIME_EPS, `south lamp crosses west finish face: maxX=${lampRBox.maxX}`);
  assert.ok(lampLBox.minX < 4.14 - RUNTIME_EPS && lampRBox.minX < 4.14 - RUNTIME_EPS, 'wall lamps must project into the master bedroom');
  assert.ok(4.14 - lampLBox.minX <= 0.190 + RUNTIME_EPS, `north lamp exceeds locked projection: ${4.14 - lampLBox.minX}`);
  assert.ok(4.14 - lampRBox.minX <= 0.190 + RUNTIME_EPS, `south lamp exceeds locked projection: ${4.14 - lampRBox.minX}`);
  for (const [id, box] of [[left.id, leftBox], [right.id, rightBox], [switchL.id, switchBox], [switchN.id, switchNBox], [lampL.id, lampLBox], [lampR.id, lampRBox]] as const) {
    assert.equal(aabbIntersects(box, bed), false, `${id} must not intersect the real bed mesh AABB`);
  }

  // 86面板/壁灯共轴布置在床头柜上方，采用立面净距：柜顶0.505m，86面板底约0.707m。
  assert.ok(leftBox.minY - northCabinet.maxY >= 0.202 - RUNTIME_EPS, `north cabinet-to-socket elevation gap ${leftBox.minY - northCabinet.maxY}`);
  assert.ok(switchNBox.minY - northCabinet.maxY >= 0.202 - RUNTIME_EPS, `north cabinet-to-switch elevation gap ${switchNBox.minY - northCabinet.maxY}`);
  assert.ok(lampLBox.minY - northCabinet.maxY >= 0.805 - RUNTIME_EPS, `north cabinet-to-lamp elevation gap ${lampLBox.minY - northCabinet.maxY}`);
  assert.ok(rightBox.minY - southCabinet.maxY >= 0.202 - RUNTIME_EPS, `south cabinet-to-socket elevation gap ${rightBox.minY - southCabinet.maxY}`);
  assert.ok(switchBox.minY - southCabinet.maxY >= 0.202 - RUNTIME_EPS, `south cabinet-to-switch elevation gap ${switchBox.minY - southCabinet.maxY}`);
  assert.ok(lampRBox.minY - southCabinet.maxY >= 0.805 - RUNTIME_EPS, `south cabinet-to-lamp elevation gap ${lampRBox.minY - southCabinet.maxY}`);
});

test('removed master-bedroom items stay removed; living room plant survives', () => {
  assert.equal(master.some((item) => item.type === 'master_wardrobe_tall_240'), false, 'master_wardrobe_tall_240 must not appear in master_bedroom furnishings');
  assert.equal(master.some((item) => item.type === 'plant_fiddle'), false, '主卧 plant_fiddle 已删除');
  const living = house.furnishings.living_dining;
  assert.deepEqual(placed('plant_fiddle', living), { type: 'plant_fiddle', x: 7.93, z: 9.18, rotation: 270 });
});

test('R8 north wardrobe 950 door configurations use real mesh pivots without door interpenetration', () => {
  const configurations: NorthWallWardrobe950DoorConfiguration[] = [
    'closed', 'left_open', 'middle_open', 'right_open', 'left_middle_open', 'left_right_open', 'middle_right_open', 'all_open',
  ];
  for (const configuration of configurations) {
    const fixture = buildFixture('master_north_wall_wardrobe_950');
    assert.ok(fixture);
    setNorthWallWardrobe950DoorConfiguration(fixture!, configuration);
    fixture!.updateMatrixWorld(true);
    const roots = fixture!.children.filter((child) => child.userData.materialRole === 'door_root');
    assert.equal(roots.length, 3);
    const boxes = roots.map((root) => new THREE.Box3().setFromObject(root));
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        assert.ok(!(boxes[a].min.x < boxes[b].max.x && boxes[a].max.x > boxes[b].min.x && boxes[a].min.z < boxes[b].max.z && boxes[a].max.z > boxes[b].min.z), `${configuration} door leaves ${a + 1}/${b + 1} intersect`);
      }
    }
    assert.ok(roots.every((root) => Math.abs(THREE.MathUtils.radToDeg(root.rotation.y)) <= 95));
  }
});

test('south-window-band low dresser uses the 2026-09-06 east-shifted transform and stays clear of constraints', () => {
  const dresser = placed('master_hot_season_low_dresser');
  assert.deepEqual(dresser, { type: 'master_hot_season_low_dresser', x: 1.05, z: 9.20, rotation: 180 });
  assert.deepEqual(FURNITURE_DIMS.master_hot_season_low_dresser, { width: 1.40, depth: 0.48 });
  // rotation=180 为偶数 quarter-turn：AABB x[0.35,1.75]，北移后 z 约[8.96,9.44]，正面（局部 +z）转朝北对房间
  const box = worldAabb(dresser);
  assert.ok(Math.abs(box.minX - 0.35) < GAP_EPS && Math.abs(box.maxX - 1.75) < GAP_EPS);
  assert.ok(Math.abs(box.minZ - 8.96) < GAP_EPS && Math.abs(box.maxZ - 9.44) < GAP_EPS);
  // z ⊆ 南侧窗带 [8.95,9.70]（柜高 0.85 < sill 2.07 由 recipe 保证）
  assert.ok(box.minZ >= 8.95 - GAP_EPS && box.maxZ <= 9.70 + GAP_EPS);
  // 与床 AABB 不重叠
  const bedBox = worldAabb(placed('bed_180'));
  assert.ok(box.maxZ <= bedBox.minZ + GAP_EPS || box.minZ >= bedBox.maxZ - GAP_EPS || box.maxX <= bedBox.minX + GAP_EPS || box.minX >= bedBox.maxX - GAP_EPS, 'dresser overlaps bed footprint');
  // 不侵东侧 sock_master_bed_r / sock_master_curtain 点位 0.5m 内（box-to-point 距离）
  for (const id of ['sock_master_bed_r', 'sock_master_curtain']) {
    const socket = point(id);
    const dx = Math.max(box.minX - socket.x!, socket.x! - box.maxX, 0);
    const dz = Math.max(box.minZ - socket.z!, socket.z! - box.maxZ, 0);
    const dist = Math.hypot(dx, dz);
    assert.ok(dist >= 0.5 - GAP_EPS, `dresser-to-${id} distance ${dist.toFixed(3)}m`);
  }
});

test('R8 HVAC head box envelope: ceiling/hvac/electrical stay data-driven and 950-adapted', () => {
  type CeilingEntry = { id: string; room?: string; type: string; x?: number; z?: number; height?: number; thickness?: number; area?: [number, number, number, number]; power_point?: string };
  const ceiling = load(readFileSync('config/ceiling.yaml', 'utf8')) as CeilingEntry[];
  const hvac = load(readFileSync('config/hvac.yaml', 'utf8')) as { plans: Array<{ diagram: { terminals: Array<{ id: string; system: string; position: { x: number; y: number; z: number }; mount_face: string; length?: number }> } }> };
  const box = ceiling.find((entry) => entry.id === 'ceiling_master_ac');
  assert.ok(box, 'missing ceiling_master_ac');
  assert.equal(box!.type, 'drop');
  assert.deepEqual(box!.area, [2.925, 4.55, 4.20, 5.60], 'head box extends to the independent wardrobe east edge');
  assert.equal((box as CeilingEntry & { corner_radius?: number }).corner_radius, 0.10, 'head box uses the approved R100 plan corner');
  assert.equal(box!.thickness, 0.30);
  const bottom = 2.80 - box!.thickness!;
  assert.ok(bottom >= 2.45 - GAP_EPS && bottom <= 2.50 + GAP_EPS, `head box bottom ${bottom} outside 2.45–2.50m`);
  const [minX, minZ, maxX, maxZ] = box!.area!;
  const indoor = ceiling.find((entry) => entry.id === 'ac_master');
  assert.ok(indoor && indoor.type === 'ac_indoor');
  assert.ok(indoor!.x! >= minX && indoor!.x! <= maxX && indoor!.z! >= minZ && indoor!.z! <= maxZ, 'indoor unit must sit inside the head box');
  assert.equal(indoor!.power_point, 'sock_master_ac');
  const acSocket = point('sock_master_ac');
  assert.ok(acSocket.x! >= minX && acSocket.x! <= maxX && acSocket.z! >= minZ && acSocket.z! <= maxZ, 'sock_master_ac must sit inside the head box');
  const terminals = hvac.plans[0].diagram.terminals;
  const supply = terminals.find((terminal) => terminal.id === 'supply_master');
  const ret = terminals.find((terminal) => terminal.id === 'return_master');
  assert.ok(supply && ret);
  const eastWallBedroomFinishX = 4.14;
  const doorOpeningTopY = 2.10;
  // 2026-09-07：送回风中心轴统一到 x=3.70，东端分别留 0.14m/0.19m 至东墙卧室侧完成面。
  assert.ok(Math.abs(supply!.position.x - 3.70) < GAP_EPS, `supply center x=${supply!.position.x}`);
  assert.ok(Math.abs(ret!.position.x - 3.70) < GAP_EPS, `return center x=${ret!.position.x}`);
  const supplyEastX = supply!.position.x + supply!.length! / 2;
  const returnEastX = ret!.position.x + ret!.length! / 2;
  assert.ok(Math.abs(supplyEastX - 4.00) < GAP_EPS, `supply east x=${supplyEastX}`);
  assert.ok(Math.abs(returnEastX - 3.95) < GAP_EPS, `return east x=${returnEastX}`);
  assert.ok(Math.abs(eastWallBedroomFinishX - supplyEastX - 0.14) < GAP_EPS, `supply wall clearance ${eastWallBedroomFinishX - supplyEastX}`);
  assert.ok(Math.abs(eastWallBedroomFinishX - returnEastX - 0.19) < GAP_EPS, `return wall clearance ${eastWallBedroomFinishX - returnEastX}`);
  // 两个端点都处于 ceiling_master_ac 与门洞上方的服务高度，回风仍可从盒底检修。
  assert.ok(supply!.position.y > doorOpeningTopY + GAP_EPS, `supply must clear door top y=${supply!.position.y}`);
  assert.ok(ret!.position.y > doorOpeningTopY + GAP_EPS, `return must clear door top y=${ret!.position.y}`);
  assert.ok(supply!.position.z >= minZ - GAP_EPS && supply!.position.z <= maxZ + GAP_EPS, 'supply must remain over the head-box service footprint');
  assert.ok(ret!.position.z >= minZ - GAP_EPS && ret!.position.z <= maxZ + GAP_EPS, 'return must remain over the head-box service footprint');
  // 侧送：窄线形送风嵌门头盒南立面
  assert.equal(supply!.system, 'supply_air');
  assert.equal(supply!.mount_face, 'south');
  assert.equal(supply!.length, 0.6);
  assert.ok(Math.abs(supply!.position.z - maxZ) <= 0.02 + GAP_EPS, 'supply grille must sit on the head box south face');
  assert.ok(supply!.position.x - supply!.length! / 2 >= minX - GAP_EPS && supply!.position.x + supply!.length! / 2 <= maxX + GAP_EPS, 'supply span must stay inside the head box');
  assert.ok(supply!.position.y >= bottom && supply!.position.y <= 2.80, 'supply grille y must be inside the head box face band');
  // 下回：底部回风兼检修（回检一体），平面包络完整落在门头盒内
  assert.equal(ret!.system, 'return_air');
  assert.equal(ret!.mount_face, 'bottom');
  assert.equal(ret!.length, 0.5);
  assert.ok(Math.abs(ret!.position.y - (bottom - 0.01)) <= 0.02 + GAP_EPS, 'return grille must sit on the head box bottom');
  assert.ok(ret!.position.x - ret!.length! / 2 >= minX - GAP_EPS && ret!.position.x + ret!.length! / 2 <= maxX + GAP_EPS, 'return span must stay inside the head box');
  assert.ok(ret!.position.z - 0.125 >= minZ - GAP_EPS && ret!.position.z + 0.125 <= maxZ + GAP_EPS, 'return footprint must stay inside the head box');
  // 衣柜完成面与门头盒底（2.50m）齐平；HVAC盒仍保持独立责任，不互相侵占
  const wardrobe = placed('master_north_wall_wardrobe_950');
  const wardrobeBox = worldAabb(wardrobe);
  assert.ok(supply!.position.x - supply!.length! / 2 >= wardrobeBox.maxX - GAP_EPS, 'supply must stay clear of wardrobe');
  assert.ok(ret!.position.x - ret!.length! / 2 >= wardrobeBox.maxX - GAP_EPS, 'return must stay clear of wardrobe');
  assert.ok(supplyEastX <= eastWallBedroomFinishX - 0.14 + GAP_EPS, 'supply must stay clear of the bedroom east wall finish');
  assert.ok(returnEastX <= eastWallBedroomFinishX - 0.19 + GAP_EPS, 'return must stay clear of the bedroom east wall finish');
  assert.ok(Math.abs(wardrobeBox.maxZ - 4.88) < GAP_EPS && Math.abs(box!.area![2] - 4.20) < GAP_EPS);
  assert.ok(bottom <= 2.50 + GAP_EPS, 'head box bottom must remain at the independent HVAC datum');
  assert.ok(FURNITURE_DIMS.master_north_wall_wardrobe_950.width === 0.95, 'wardrobe plan width remains declared independently of the head box');
  assert.ok(maxX >= wardrobeBox.maxX, 'head box should visually continue over the wardrobe east end');
  // 2026-09-07：白色门头盒延伸至衣柜东缘；两者由独立材质和阴影缝表达。
  assert.ok(Math.abs(minX - wardrobeBox.maxX) <= GAP_EPS, `head box west edge ${minX} must meet wardrobe east edge ${wardrobeBox.maxX}`);
});
