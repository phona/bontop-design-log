import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { FURNITURE_DIMS } from '../../shared/types.js';

// 2026-10-05 父母房↔书房功能互换 v0（迭代 parent-room-study-swap-20261005，候选未冻结）：
// bedroom_se 书房→客房（wardrobe_180 北墙边吊下 + bed_150 床头靠东外墙）；
// study 父母房→书房（书桌椅原位 + study_seasonal_wardrobe_wall 由客房东墙平移至北墙边吊下）；
// 轻训练/重型器械整体删除（recipe/dims 在 shared/* 保留，预算与采购条目已移除）。
// 本文件取代原 study-seasonal-storage.test.ts（书房后台柜 + 轻训练三件套收纳态专项，已随功能互换作废）。

type Furnishing = { type: string; x?: number; z?: number; rotation?: number };
type Aabb = { minX: number; maxX: number; minZ: number; maxZ: number };

const house = load(readFileSync('config/house.yaml', 'utf8')) as { furnishings: Record<string, Furnishing[]> };
const guest = house.furnishings.bedroom_se; // 客房（原书房）
const study = house.furnishings.study;      // 书房（原父母房）

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

function placed(room: Furnishing[], type: string): Furnishing {
  const item = room.find((candidate) => candidate.type === type && candidate.x !== undefined && candidate.z !== undefined);
  assert.ok(item, `missing placed ${type}`);
  return item;
}

// 世界 AABB：奇数 quarter-turn 旋转交换 width/depth（与 verify-furniture-placement 同口径）
function worldAabb(item: Furnishing): Aabb {
  const dims = FURNITURE_DIMS[item.type];
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
  assert.deepEqual(wardrobe, { type: 'wardrobe_180', x: 15.25, z: 5.85, rotation: 180 });
  const box = worldAabb(wardrobe); // x[14.35,16.15] z[5.55,6.15]
  assert.ok(Math.abs(box.minX - 14.35) < GAP_EPS && Math.abs(box.maxX - 16.15) < GAP_EPS);
  assert.ok(Math.abs(box.minZ - 5.55) < GAP_EPS && Math.abs(box.maxZ - 6.15) < GAP_EPS);
  assert.equal(overlaps(box, BESE_DOOR_SWEEP), false, 'wardrobe enters the d_bese door sweep');
  assert.equal(overlaps(box, GUEST_NORTH_DROP), true, 'wardrobe must stay inside the north-wall drop segment');
  assert.ok(box.maxX < 16.40, 'east edge must keep a finish allowance off x=16.40');
});

test('guest room bed keeps its headboard on the east exterior wall and clears the door sweep and south glass', () => {
  const bed = placed(guest, 'bed_150');
  assert.deepEqual(bed, { type: 'bed_150', x: 15.35, z: 7.60, rotation: 270 });
  const box = worldAabb(bed); // rotation=270：床头在局部 -z → 世界 +x；AABB x[14.35,16.35] z[6.85,8.35]
  assert.ok(Math.abs(box.minX - 14.35) < GAP_EPS && Math.abs(box.maxX - 16.35) < GAP_EPS);
  assert.ok(Math.abs(box.minZ - 6.85) < GAP_EPS && Math.abs(box.maxZ - 8.35) < GAP_EPS);
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
  assert.deepEqual(placed(study, 'desk'), { type: 'desk', x: 4.50, z: 9.20, rotation: 90 });
  assert.deepEqual(placed(study, 'chair'), { type: 'chair', x: 5.10, z: 9.20, rotation: 270 });
  const cabinet = placed(study, 'study_seasonal_wardrobe_wall');
  assert.deepEqual(cabinet, { type: 'study_seasonal_wardrobe_wall', x: 5.15, z: 5.825, rotation: 0 });
  const box = worldAabb(cabinet); // x[4.30,6.00] z[5.55,6.10]
  assert.ok(Math.abs(box.minX - 4.30) < GAP_EPS && Math.abs(box.maxX - 6.00) < GAP_EPS);
  assert.ok(Math.abs(box.minZ - 5.55) < GAP_EPS && Math.abs(box.maxZ - 6.10) < GAP_EPS);
  assert.equal(overlaps(box, STUDY_DOOR_SWEEP), false, 'cabinet enters the d_study door sweep');
  assert.equal(overlaps(box, STUDY_NORTH_DROP), true, 'cabinet must stay inside the north-wall drop segment');
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
