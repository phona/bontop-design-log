import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { FURNITURE_DIMS } from '../../shared/types.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingsYaml, VertexLayoutYaml } from '../../shared/types.js';

// 2026-10-05 父母房↔书房功能互换 v0（迭代 parent-room-study-swap-20261005，候选未冻结）：
// bedroom_se 书房→客房（wardrobe_180 北墙边吊下 + bed_150 床头靠东外墙）；
// study 父母房→书房（书桌椅原位 + study_seasonal_wardrobe_wall 由客房东墙平移至北墙边吊下）；
// 2026-10-26 DEC-2026-10-26-R02（墙垛建模 + 衣柜南延）：书桌椅东移至 (6.90,7.80)/(6.30,7.80)，本文件坐标同步；“原位”指互换当时位置，现已作废。
// 2026-11-27 量房回填：w_st_east 起点 (7.15,5.55)→(7.15,5.455)，along 2.25 不变 → 书桌椅 (6.85,7.705)/(6.25,7.705)（x 亦随东墙 7.20→7.15 西移 0.05）。
// 轻训练/重型器械整体删除（recipe/dims 在 shared/* 保留，预算与采购条目已移除）。
// 本文件取代原 study-seasonal-storage.test.ts（书房后台柜 + 轻训练三件套收纳态专项，已随功能互换作废）。

type Furnishing = {
  type: string; id?: string; x?: number; z?: number; rotation?: number;
  width?: number; depth?: number; cabinetHeight?: number;
  // 摆位声明字段（定位形式）：resolveRoom() 剥离，deepEqual 不钉定位形式。
  wall?: string; wall_side?: string; along?: number; wall_clearance?: number;
  anchor?: unknown; mount?: unknown;
  support?: unknown; room?: string; room_dx?: number; room_dz?: number;
};
type Aabb = { minX: number; maxX: number; minZ: number; maxZ: number };

const house = load(readFileSync('config/house.yaml', 'utf8')) as { furnishings: Record<string, Furnishing[]> };

// 全屋家具一次解算（#98 Tier 1）：关系化家具的坐标取 buildPlacementIndexes 的解算结果
// （与 3D/DXF/verify 同源）；绝对家具的解算值与声明一致。resolveRoom() 把解算坐标覆盖
// 进声明、剥离摆位声明字段，几何测试只断言几何身份、不因迁移改表达形式而逐条改期望值。
// 房间相对摆位（2026-11-16 DDD 模型约束）：房间包络随解算上下文传入。
const STUDY_LAYOUT = resolveLayout(load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml);
const STUDY_FURNITURE_HOSTS = buildPlacementIndexes({
  geometry: { walls: STUDY_LAYOUT.walls },
  furnishings: house.furnishings as unknown as FurnishingsYaml,
  anchors: { rooms: new Map(STUDY_LAYOUT.rooms.map((room) => [room.id, room])) },
}).mountHosts;

function resolveRoom(items: Furnishing[]): Furnishing[] {
  const round9 = (value: number): number => Math.round(value * 1e9) / 1e9;
  return items.map((item) => {
    if (item.id === undefined) return item;
    const host = STUDY_FURNITURE_HOSTS?.get(item.id);
    assert.ok(host !== undefined && Number.isFinite(host.x) && Number.isFinite(host.z),
      `${item.id}: 家具摆位解算失败（无宿主或坐标非有限数）`);
    const { wall: _wall, wall_side: _wallSide, along: _along, wall_clearance: _clearance, anchor: _anchor, mount: _mount, support: _support, room: _room, room_dx: _roomDx, room_dz: _roomDz, ...geometry } = item;
    return { ...geometry, x: round9(host.x as number), z: round9(host.z as number) };
  });
}

const guest = resolveRoom(house.furnishings.bedroom_se); // 客房（原书房）
const study = resolveRoom(house.furnishings.study);      // 书房（原父母房）

const GAP_EPS = 1e-9;

// d_bese 西门洞扇扫掠域 / d_study 北门洞扇扫掠域（权威口径）
const BESE_DOOR_SWEEP: Aabb = { minX: 13.40, maxX: 14.30, minZ: 5.65, maxZ: 6.55 };
const STUDY_DOOR_SWEEP: Aabb = { minX: 6.15, maxX: 7.05, minZ: 5.55, maxZ: 6.45 };
// 客房几何边界：北墙边吊段 z[5.55,6.15]（底 2.50m）、凸窗内缘 z=7.60、南玻璃/房间南界 z=8.70
const GUEST_NORTH_DROP: Aabb = { minX: 13.40, maxX: 16.40, minZ: 5.55, maxZ: 6.15 };
const GUEST_SOUTH_GLASS_Z = 8.70;
const BAY_INNER_Z = 7.60;
// 书房北墙边吊段 z[5.55,6.45]（底 2.50m）
const STUDY_NORTH_DROP: Aabb = { minX: 4.20, maxX: 7.20, minZ: 5.55, maxZ: 6.45 };

// placed() 取 resolveRoom() 已解算的条目（Tier 1）：全屋一次解算已把墙锚/anchor
// 家具的坐标解出并 round9 归一（解算器浮点噪声 ~1e-15m），直接读原始 hosts 会丢
// 归一（study.chair 会得 6.300000000000001 而非 6.3）。Tier 2 的直接读 hosts
// 写法针对旧版 placed() 的 x/z 过滤器，与 Tier 1 的 resolveRoom 同一缺口、
// 已被其覆盖，故不采用。
function placed(room: Furnishing[], type: string): Furnishing {
  const item = room.find((candidate) => candidate.type === type);
  assert.ok(item, `missing placed ${type}`);
  return item;
}

// 世界 AABB：奇数 quarter-turn 旋转交换 width/depth（与 verify-furniture-placement 同口径；
// 行内 width/depth 覆盖 catalog——R02 南延段以行内 2.21×0.55 覆盖 catalog 1.70×0.55）
function worldAabb(item: Furnishing): Aabb {
  const dims = item.width !== undefined && item.depth !== undefined
    ? { width: item.width, depth: item.depth }
    : FURNITURE_DIMS[item.type];
  assert.ok(dims, `no FURNITURE_DIMS for ${item.type}`);
  const quarterTurn = Math.round((item.rotation ?? 0) / 90) % 2 !== 0;
  const width = quarterTurn ? dims.depth : dims.width;
  const depth = quarterTurn ? dims.width : dims.depth;
  return { minX: item.x! - width / 2, maxX: item.x! + width / 2, minZ: item.z! - depth / 2, maxZ: item.z! + depth / 2 };
}

// 贴边相接（shared edge）不算重叠
function overlaps(a: Aabb, b: Aabb): boolean {
  return a.minX < b.maxX - GAP_EPS && a.maxX > b.minX + GAP_EPS && a.minZ < b.maxZ - GAP_EPS && a.maxZ > b.minZ + GAP_EPS;
}

test('guest room wardrobe sits in the north-wall drop and clears the d_bese door sweep', () => {
  const wardrobe = placed(guest, 'wardrobe_180');
  // 2026-11-27：床南移贴南墙（x 15.35→15.33，随东墙内面西移 0.02），衣柜锚床 offset z −1.75→−1.87（不跟移，柜顶须抵北墙边吊），x 15.25→15.23。
  assert.deepEqual(wardrobe, { type: 'wardrobe_180', id: 'bese.wardrobe_180', x: 15.23, z: 5.85, rotation: 180 });
  const box = worldAabb(wardrobe); // x[14.33,16.13] z[5.55,6.15]
  assert.ok(Math.abs(box.minX - 14.33) < GAP_EPS && Math.abs(box.maxX - 16.13) < GAP_EPS);
  assert.ok(Math.abs(box.minZ - 5.55) < GAP_EPS && Math.abs(box.maxZ - 6.15) < GAP_EPS);
  assert.equal(overlaps(box, BESE_DOOR_SWEEP), false, 'wardrobe enters the d_bese door sweep');
  assert.equal(overlaps(box, GUEST_NORTH_DROP), true, 'wardrobe must stay inside the north-wall drop segment');
  assert.ok(box.maxX < 16.40, 'east edge must keep a finish allowance off x=16.40');
});

test('guest room bed keeps its headboard on the east exterior wall and clears the door sweep and south glass', () => {
  const bed = placed(guest, 'bed_150');
  // 2026-11-27 业主授权按最佳实践调：床南缘贴死南墙内面 z=8.47（原 0.12m 离墙死角消除），床 (15.35,7.60)→(15.33,7.72)。
  assert.deepEqual(bed, { type: 'bed_150', id: 'bese.bed_150', x: 15.33, z: 7.72, rotation: 270 });
  const box = worldAabb(bed); // rotation=270：床头在局部 -z → 世界 +x；AABB x[14.33,16.33] z[6.97,8.47]
  assert.ok(Math.abs(box.minX - 14.33) < GAP_EPS && Math.abs(box.maxX - 16.33) < GAP_EPS);
  assert.ok(Math.abs(box.minZ - 6.97) < GAP_EPS && Math.abs(box.maxZ - 8.47) < GAP_EPS);
  assert.equal(overlaps(box, BESE_DOOR_SWEEP), false, 'bed enters the d_bese door sweep');
  assert.ok(box.maxZ <= GUEST_SOUTH_GLASS_Z - 0.20 + GAP_EPS, 'bed must keep ≥0.20m off the south glass z=8.70');
  // 床尾半进凸窗带：bay_sill 只占 2.07m 以上高度，床高 <2.07m 不冲突；柜体则不得越过 z=7.60
  assert.ok(box.maxZ > BAY_INNER_Z, 'bed foot is expected to enter the bay band (floor usable, overhang starts at 2.07m)');
  // 床头与衣柜不重叠，且柜前通道 ≥0.65m 惯例
  const wardrobeBox = worldAabb(placed(guest, 'wardrobe_180'));
  assert.equal(overlaps(box, wardrobeBox), false, 'bed overlaps the wardrobe');
  const channel = box.minZ - wardrobeBox.maxZ;
  assert.ok(channel >= 0.65 - GAP_EPS, `wardrobe front channel ${channel.toFixed(3)}m < 0.65m`);
});

test('guest room keeps only sleeping furniture (no desk, chair, seasonal cabinet or training equipment)', () => {
  for (const removed of ['desk', 'chair', 'study_seasonal_wardrobe_wall', 'bench_adjustable', 'adjustable_dumbbell_pair', 'rollable_training_mat', 'squat_rack', 'barbell_olympic', 'weight_plate_set', 'rubber_training_mat', 'low_room_cabinet']) {
    assert.equal(guest.some((item) => item.type === removed), false, `${removed} must not appear in bedroom_se furnishings`);
  }
  for (const kept of ['wardrobe_180', 'bed_150', 'mattress_150', 'curtain_set', 'ceiling_light']) {
    assert.equal(guest.some((item) => item.type === kept), true, `${kept} must remain in bedroom_se furnishings`);
  }
});

test('study keeps its desk and chair in place and takes over the seasonal backstage cabinet', () => {
  // R02（2026-10-26）：书桌椅东移（墙垛 x[4.20,4.63]×z[8.31,8.71] 建模后原桌位撞垛；插座/网口随移东墙）；旧坐标 (4.50,9.20)/(5.10,9.20) 作废。
  // 2026-11-27 量房回填：w_st_east 起点北移 0.095（5.55→5.455），along 2.25 不变 → 书桌椅 (6.85,7.705)/(6.25,7.705)。
  assert.deepEqual(placed(study, 'desk'), { type: 'desk', id: 'study.desk', x: 6.85, z: 7.705, rotation: 90 });
  assert.deepEqual(placed(study, 'chair'), { type: 'chair', id: 'study.chair', x: 6.25, z: 7.705, rotation: 90 });
  const cabinet = placed(study, 'study_seasonal_wardrobe_wall');
  // 北段柜：w_st_north 南移 0.095（5.55→5.455），along 0.90 不变 → (5.10,5.825)→(5.06,5.73)；西缘贴西墙线 x=4.16，北缘贴北墙线 z=5.455，仍齐平顶墙。
  assert.deepEqual(cabinet, { type: 'study_seasonal_wardrobe_wall', id: 'study.seasonal_wardrobe_wall', x: 5.06, z: 5.73, rotation: 0, width: 1.80, depth: 0.55 });
  const box = worldAabb(cabinet); // x[4.16,5.96] z[5.455,6.005]（2026-10-27 齐平：北段西延顶墙）
  assert.ok(Math.abs(box.minX - 4.16) < GAP_EPS && Math.abs(box.maxX - 5.96) < GAP_EPS);
  assert.ok(Math.abs(box.minZ - 5.455) < GAP_EPS && Math.abs(box.maxZ - 6.005) < GAP_EPS);
  assert.equal(overlaps(box, STUDY_DOOR_SWEEP), false, 'cabinet enters the d_study door sweep');
  assert.equal(overlaps(box, STUDY_NORTH_DROP), true, 'cabinet must stay inside the north-wall drop segment');
  // R02（2026-10-26）南延段：北段向南延至墙垛北脸 z=8.31（垛露出）；placed() 取首个同类型（北段），南延段按坐标另取。
  // R02（2026-10-27）通顶：腿沿 z=6.45（边吊南缘）拆为 stub + 高腿两件（同 x=4.475，按 z 区分）。
  const legs = study.filter((item) => item.type === 'study_seasonal_wardrobe_wall' && item.x === 4.435);
  assert.equal(legs.length, 2, '通顶腿应为 stub + 高腿两件');
  const stub = legs.find((item) => item.z === 6.194);
  const tall = legs.find((item) => item.z === 7.245);
  // 2026-11-27 量房回填：w_mb_east 起点 (4.20,5.55)→(4.16,5.455)，两腿 x 4.475→4.435；
  // step_north 沿位未重基（0.739 不变）→ 中心 6.289→6.194，南端 6.45→6.355（注记仍称 6.289/6.45，见报告待裁定）；
  // step_south 沿位已重基（1.83→1.79，宽 1.86→1.78、柜高 2.8→2.909）→ 中心 7.245，z[6.355,8.135] 仍贴墙垛北脸 8.135。
  assert.deepEqual(stub, { type: 'study_seasonal_wardrobe_wall', id: 'study.seasonal_wardrobe_step_north', x: 4.435, z: 6.194, rotation: 90, width: 0.322, depth: 0.55 });
  assert.deepEqual(tall, { type: 'study_seasonal_wardrobe_wall', id: 'study.seasonal_wardrobe_step_south', x: 4.435, z: 7.245, rotation: 90, width: 1.78, depth: 0.55, cabinetHeight: 2.909 });
  const stubBox = worldAabb(stub!); // x[4.16,4.71] z[6.033,6.355]（北端贴北段门面 6.033，南端贴高腿北端 6.355）
  assert.ok(Math.abs(stubBox.minX - 4.16) < GAP_EPS && Math.abs(stubBox.maxX - 4.71) < GAP_EPS);
  assert.ok(Math.abs(stubBox.minZ - 6.033) < GAP_EPS && Math.abs(stubBox.maxZ - 6.355) < GAP_EPS);
  const tallBox = worldAabb(tall!); // x[4.16,4.71] z[6.355,8.135]（北端贴 stub 南端，南端贴墙垛北脸）
  assert.ok(Math.abs(tallBox.minX - 4.16) < GAP_EPS && Math.abs(tallBox.maxX - 4.71) < GAP_EPS);
  assert.ok(Math.abs(tallBox.minZ - 6.355) < GAP_EPS && Math.abs(tallBox.maxZ - 8.135) < GAP_EPS);
  // 卧室家具随功能迁出
  for (const removed of ['bed_150', 'mattress_150', 'wardrobe_180']) {
    assert.equal(study.some((item) => item.type === removed), false, `${removed} must not remain in study furnishings`);
  }
});

test('training equipment recipes and dims are retained but nothing is placed or priced', () => {
  // recipe/dims 保留供历史方案兼容，仅 placed/count-only 实例退出
  for (const type of ['bench_adjustable', 'adjustable_dumbbell_pair', 'rollable_training_mat', 'squat_rack', 'barbell_olympic', 'weight_plate_set', 'rubber_training_mat']) {
    assert.ok(FURNITURE_DIMS[type], `FURNITURE_DIMS.${type} must be retained`);
    for (const [roomId, items] of Object.entries(house.furnishings)) {
      assert.equal(items.some((item) => item.type === type), false, `${type} found placed in ${roomId}`);
    }
  }
  const materials = load(readFileSync('config/materials.yaml', 'utf8')) as { materials: Array<{ id: string }> };
  assert.equal(materials.materials.some((m) => m.id === 'home_fitness_light_set_01'), false, 'home_fitness_light_set_01 must be removed from materials.yaml');
  const rules = load(readFileSync('config/design-rules.yaml', 'utf8')) as { furnishing_type_to_topic?: Record<string, string> };
  assert.equal(rules.furnishing_type_to_topic?.['home_fitness_light_set'], undefined, 'home_fitness mapping must be removed from design-rules');
});

test('no movable_adjustable_bench synonym type exists anywhere', () => {
  // 复用 bench_adjustable，不新增同义类型
  assert.equal('movable_adjustable_bench' in FURNITURE_DIMS, false);
  for (const [roomId, items] of Object.entries(house.furnishings)) {
    assert.equal(items.some((item) => item.type === 'movable_adjustable_bench'), false, `movable_adjustable_bench found in ${roomId}`);
  }
});
