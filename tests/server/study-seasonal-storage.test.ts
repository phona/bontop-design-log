import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { FURNITURE_DIMS } from '../../shared/types.js';

// 2026-09-03 书房季节后台（迭代 master-flexible-frontstage-20260903，候选未冻结）：
// 东墙 1.70m 非通顶季节后台柜 + 轻训练三件套收纳态；重型器械与东墙低柜退出。

type Furnishing = { type: string; x?: number; z?: number; rotation?: number };
type Aabb = { minX: number; maxX: number; minZ: number; maxZ: number };

const house = load(readFileSync('config/house.yaml', 'utf8')) as { furnishings: Record<string, Furnishing[]> };
const study = house.furnishings.bedroom_se;

const GAP_EPS = 1e-9;

// d_bese 北门扇扫掠域与轻训练三件套使用态 AABB（权威口径）
const BESE_DOOR_SWEEP: Aabb = { minX: 13.40, maxX: 14.30, minZ: 5.65, maxZ: 6.55 };
const TRAINING_USE: Aabb = { minX: 14.30, maxX: 15.80, minZ: 5.65, maxZ: 7.45 };

function placed(type: string): Furnishing {
  const item = study.find((candidate) => candidate.type === type && candidate.x !== undefined && candidate.z !== undefined);
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

test('seasonal backstage wardrobe uses the candidate transform and boundary envelope', () => {
  const wardrobe = placed('study_seasonal_wardrobe_wall');
  assert.deepEqual(wardrobe, { type: 'study_seasonal_wardrobe_wall', x: 16.075, z: 6.75, rotation: 270 });
  assert.deepEqual(FURNITURE_DIMS.study_seasonal_wardrobe_wall, { width: 1.70, depth: 0.55 });
  const box = worldAabb(wardrobe); // x[15.80,16.35] z[5.90,7.60]
  assert.ok(Math.abs(box.minX - 15.80) < GAP_EPS && Math.abs(box.maxX - 16.35) < GAP_EPS);
  assert.ok(Math.abs(box.minZ - 5.90) < GAP_EPS && Math.abs(box.maxZ - 7.60) < GAP_EPS);
  // 边界：北缘不侵入东北角吊段、南缘不越过凸窗内缘、东缘留完成面余量不贴死 x=16.40
  assert.ok(box.minZ >= 5.90 - GAP_EPS);
  assert.ok(box.maxZ <= 7.60 + GAP_EPS);
  assert.ok(box.maxX <= 16.35 + GAP_EPS);
  assert.ok(box.maxX < 16.40, 'east edge must keep the ~0.05m finish allowance off x=16.40');
});

test('backstage wardrobe stays clear of desk, chair and the d_bese door sweep', () => {
  const wardrobeBox = worldAabb(placed('study_seasonal_wardrobe_wall'));
  assert.equal(overlaps(wardrobeBox, worldAabb(placed('desk'))), false, 'wardrobe overlaps desk');
  assert.equal(overlaps(wardrobeBox, worldAabb(placed('chair'))), false, 'wardrobe overlaps chair');
  assert.equal(overlaps(wardrobeBox, BESE_DOOR_SWEEP), false, 'wardrobe enters the d_bese door sweep');
});

test('desk and chair stay at their original positions', () => {
  assert.deepEqual(placed('desk'), { type: 'desk', x: 13.70, z: 8.05, rotation: 90 });
  assert.deepEqual(placed('chair'), { type: 'chair', x: 14.40, z: 8.05, rotation: 270 });
});

test('heavy gym equipment and the low room cabinet are removed from bedroom_se', () => {
  for (const removed of ['squat_rack', 'barbell_olympic', 'weight_plate_set', 'rubber_training_mat', 'low_room_cabinet']) {
    assert.equal(study.some((item) => item.type === removed), false, `${removed} must not appear in bedroom_se furnishings (recipe/dims 保留)`);
  }
  // recipe/dims 保留供历史方案兼容，仅 placed/count-only 实例退出
  assert.ok(FURNITURE_DIMS.squat_rack);
  assert.ok(FURNITURE_DIMS.low_room_cabinet);
});

test('light training trio uses the stored-state transforms without mutual overlap', () => {
  const bench = placed('bench_adjustable');
  const dumbbell = placed('adjustable_dumbbell_pair');
  const mat = placed('rollable_training_mat');
  assert.deepEqual(bench, { type: 'bench_adjustable', x: 15.30, z: 7.95, rotation: 0 });
  assert.deepEqual(dumbbell, { type: 'adjustable_dumbbell_pair', x: 16.15, z: 7.90, rotation: 90 });
  assert.deepEqual(mat, { type: 'rollable_training_mat', x: 16.075, z: 5.775, rotation: 0 });
  assert.deepEqual(FURNITURE_DIMS.bench_adjustable, { width: 1.24, depth: 0.55 });
  assert.deepEqual(FURNITURE_DIMS.adjustable_dumbbell_pair, { width: 0.55, depth: 0.45 });
  assert.deepEqual(FURNITURE_DIMS.rollable_training_mat, { width: 0.25, depth: 0.25 });
  // 收纳态 AABB：凳 x[14.68,15.92] z[7.675,8.225]；哑铃 x[15.925,16.375] z[7.625,8.175]；卷垫 x[15.95,16.20] z[5.65,5.90]
  const benchBox = worldAabb(bench);
  const dumbbellBox = worldAabb(dumbbell);
  const matBox = worldAabb(mat);
  assert.ok(Math.abs(benchBox.minX - 14.68) < GAP_EPS && Math.abs(benchBox.maxZ - 8.225) < GAP_EPS);
  assert.ok(Math.abs(dumbbellBox.minX - 15.925) < GAP_EPS && Math.abs(dumbbellBox.minZ - 7.625) < GAP_EPS);
  assert.ok(Math.abs(matBox.minZ - 5.65) < GAP_EPS && Math.abs(matBox.maxZ - 5.90) < GAP_EPS);
  assert.equal(overlaps(benchBox, dumbbellBox), false, 'bench overlaps dumbbell pair');
  assert.equal(overlaps(benchBox, matBox), false, 'bench overlaps rolled mat');
  assert.equal(overlaps(dumbbellBox, matBox), false, 'dumbbell pair overlaps rolled mat');
  // 收纳态同样不侵后台柜、书桌椅与门扫掠
  const wardrobeBox = worldAabb(placed('study_seasonal_wardrobe_wall'));
  const deskBox = worldAabb(placed('desk'));
  const chairBox = worldAabb(placed('chair'));
  for (const [name, box] of [['bench_adjustable', benchBox], ['adjustable_dumbbell_pair', dumbbellBox], ['rollable_training_mat', matBox]] as const) {
    assert.equal(overlaps(box, wardrobeBox), false, `${name} overlaps backstage wardrobe`);
    assert.equal(overlaps(box, deskBox), false, `${name} overlaps desk`);
    assert.equal(overlaps(box, chairBox), false, `${name} overlaps chair`);
    assert.equal(overlaps(box, BESE_DOOR_SWEEP), false, `${name} enters the d_bese door sweep`);
  }
});

test('training use-state AABB stays clear of desk, chair, wardrobe and the door sweep', () => {
  // 使用态 AABB x[14.30,15.80]×z[5.65,7.45]：西贴门扫掠东缘、东贴后台柜西缘，均只允许贴边相接
  for (const [name, box] of [
    ['desk', worldAabb(placed('desk'))],
    ['chair', worldAabb(placed('chair'))],
    ['study_seasonal_wardrobe_wall', worldAabb(placed('study_seasonal_wardrobe_wall'))],
  ] as const) {
    assert.equal(overlaps(TRAINING_USE, box), false, `training use-state conflicts with ${name}`);
  }
  assert.equal(overlaps(TRAINING_USE, BESE_DOOR_SWEEP), false, 'training use-state enters the d_bese door sweep');
});

test('no movable_adjustable_bench synonym type exists anywhere', () => {
  // 复用 bench_adjustable，不新增同义类型
  assert.equal('movable_adjustable_bench' in FURNITURE_DIMS, false);
  for (const [roomId, items] of Object.entries(house.furnishings)) {
    assert.equal(items.some((item) => item.type === 'movable_adjustable_bench'), false, `movable_adjustable_bench found in ${roomId}`);
  }
});
