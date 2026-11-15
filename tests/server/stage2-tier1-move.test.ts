/**
 * Issue #98 二阶段 Tier 1 永久回归测试：家具 Tier 1（21 件）0.20m 移动实验。
 *
 * 真实配置 + 内存改动：每组只改一处声明（墙锚 along 或家具锚点宿主的 along），
 * 其余 YAML 不动；起点从当前配置读取，不钉绝对坐标；实验后不写盘。
 * 断言全部是相对量（位移差），不钉绝对坐标——日后家具再移动不改本测试。
 * 结构断言只钉关系形式（wall/anchor + 无绝对 x/z），不钉 along/offset 数值。
 *
 * 分组（每组一个 0.20m 移动）：
 *  厨房北段：cabinet_run_north_east 沿墙 −0.20 → sink / ro_purifier 跟随；
 *  厨房东段：cabinet_run_east 沿墙 −0.20（南移 0.20）→ gas_stove / range_hood 跟随；
 *  厨房桥段：countertop_bridge 沿墙 +0.20 → dishwasher 跟随；
 *  书房桌椅：study.desk 沿墙 +0.20 → study.chair 跟随；
 *  书房北柜：seasonal_wardrobe_wall 沿墙 +0.20 → 两西墙腿不跟随（独立墙锚）；
 *  阳台：balcony.washer 沿墙 +0.20 → balcony.dryer 跟随（叠放）；
 *  主卫洗手柜：mb.washbasin_cabinet 沿墙 +0.20 → mbath.towel_set 不跟随（独立墙锚）；
 *  主卧梳妆：mb.dressing_table 沿墙 +0.20 → mb.dressing_stool 跟随；
 *  西北卧搁板：bnw.shelf 沿墙 +0.20 → 无跟随；
 *  主卫毛巾：mbath.towel_set 沿墙 +0.20 → 无跟随。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { loadElectricalConfig } from '../../server/config-loader.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveFurniturePlacements } from '../../shared/furniture-placement.js';
import { resolvePointPlacementInWalls } from '../../shared/point-placement.js';
import type { FurnishingsYaml, FurnishingItem } from '../../shared/types.js';

const TOL = 0.005;
const MOVE = 0.20;

function loadRealConfig() {
  const house = loadYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: FurnishingsYaml };
  const furnishings = house.furnishings ?? {};
  const catalog = ProjectCatalog.load('.');
  const walls = catalog.getWalls();
  const wallSegments = new Map<string, any[]>();
  for (const wall of walls) {
    const key = wall.id ?? '';
    const list = wallSegments.get(key) ?? [];
    list.push(wall);
    wallSegments.set(key, list);
  }
  return { furnishings, walls, wallSegments };
}

function resolveAll(furnishings: FurnishingsYaml, walls: ReturnType<ProjectCatalog['getWalls']>, wallSegments: Map<string, any[]>) {
  const items = Object.values(furnishings).flat();
  const { placements, diagnostics } = resolveFurniturePlacements(items, wallSegments as any);
  const { pointWalls, mountHosts } = buildPlacementIndexes({ geometry: { walls }, furnishings });
  const points = new Map<string, { x: number; z: number }>();
  const pointDiagnostics: string[] = [];
  for (const pt of loadElectricalConfig()) {
    const r = resolvePointPlacementInWalls(pt, pointWalls, mountHosts);
    if (r.placement) points.set(pt.id, { x: r.placement.x, z: r.placement.z });
    else pointDiagnostics.push(`${pt.id}: ${r.diagnostic}`);
  }
  return { placements, diagnostics, points, pointDiagnostics };
}

function leafDiffPaths(a: unknown, b: unknown, prefix = ''): string[] {
  if (a === b) return [];
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return [prefix || '(root)'];
  const out: string[] = [];
  for (const key of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) {
    out.push(...leafDiffPaths(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      prefix ? `${prefix}.${key}` : key,
    ));
  }
  return out;
}

function findItem(furnishings: FurnishingsYaml, room: string, id: string): FurnishingItem {
  const item = furnishings[room]?.find((i) => i.id === id);
  assert.ok(item, `缺失 ${id}`);
  return item!;
}

function pos(m: Map<string, { x: number; z: number }>, id: string) {
  const p = m.get(id);
  assert.ok(p, `缺失 ${id} 的解算位置`);
  return p!;
}

function assertMoved(
  before: Map<string, { x: number; z: number }>,
  after: Map<string, { x: number; z: number }>,
  id: string, dx: number, dz: number,
) {
  const b = pos(before, id);
  const a = pos(after, id);
  assert.ok(Math.abs((a.x - b.x) - dx) <= TOL, `${id} x 位移应为 ${dx}（实为 ${(a.x - b.x).toFixed(4)}）`);
  assert.ok(Math.abs((a.z - b.z) - dz) <= TOL, `${id} z 位移应为 ${dz}（实为 ${(a.z - b.z).toFixed(4)}）`);
}

function assertFixed(
  before: Map<string, { x: number; z: number }>,
  after: Map<string, { x: number; z: number }>,
  id: string,
) {
  const b = pos(before, id);
  const a = pos(after, id);
  assert.ok(Math.abs(a.x - b.x) <= TOL && Math.abs(a.z - b.z) <= TOL, `${id} 不得移动`);
}

/** 单声明移动实验：改 movedItem 的 along（墙锚）或宿主的 along，断言跟随/固定。 */
function moveExperiment(
  room: string,
  movedId: string,
  alongDelta: number,
  followers: Array<{ id: string; dx: number; dz: number }>,
  fixed: string[],
  movedDelta: { dx: number; dz: number },
) {
  const { furnishings, walls, wallSegments } = loadRealConfig();
  const before = resolveAll(furnishings, walls, wallSegments);
  assert.deepEqual(before.diagnostics, [], '基线家具解算须无诊断');
  assert.deepEqual(before.pointDiagnostics, [], '基线点位解算须无诊断');

  const moved = JSON.parse(JSON.stringify(furnishings)) as FurnishingsYaml;
  const movedItem = findItem(moved, room, movedId);
  assert.ok(typeof movedItem.along === 'number', `实验前置：${movedId} 须为墙锚（along）`);
  const originalAlong = movedItem.along as number;
  movedItem.along = originalAlong + alongDelta;
  const changed = leafDiffPaths(furnishings, moved);
  const index = furnishings[room].findIndex((i) => i.id === movedId);
  assert.deepEqual(changed, [`${room}.${index}.along`], '实验只能改动一处声明');

  const after = resolveAll(moved, walls, wallSegments);
  assert.deepEqual(after.diagnostics, [], '移动后家具解算须无诊断');
  assert.deepEqual(after.pointDiagnostics, [], '移动后点位解算须无诊断');

  const fBefore = new Map([...before.placements.entries()].map(([id, p]) => [id, { x: p.x, z: p.z }]));
  const fAfter = new Map([...after.placements.entries()].map(([id, p]) => [id, { x: p.x, z: p.z }]));
  assertMoved(fBefore, fAfter, movedId, movedDelta.dx, movedDelta.dz);
  for (const f of followers) assertMoved(fBefore, fAfter, f.id, f.dx, f.dz);
  for (const id of fixed) assertFixed(fBefore, fAfter, id);
}

test('Tier 1 结构：21 件确为墙锚/家具锚点关系，不带绝对 x/z', () => {
  const { furnishings } = loadRealConfig();
  const wallItems: Array<{ room: string; id: string; wall: string; wall_side: string }> = [
    { room: 'kitchen', id: 'kitchen.cabinet_run_north_west', wall: 'w_kit_north', wall_side: 'south' },
    { room: 'kitchen', id: 'kitchen.countertop_bridge', wall: 'w_kit_north', wall_side: 'south' },
    { room: 'kitchen', id: 'kitchen.cabinet_run_north_east', wall: 'w_kit_north', wall_side: 'south' },
    { room: 'kitchen', id: 'kitchen.cabinet_run_east', wall: 'w_ent_west', wall_side: 'west' },
    { room: 'study', id: 'study.desk', wall: 'w_st_east', wall_side: 'west' },
    { room: 'study', id: 'study.seasonal_wardrobe_wall', wall: 'w_st_north', wall_side: 'south' },
    { room: 'study', id: 'study.seasonal_wardrobe_step_north', wall: 'w_mb_east', wall_side: 'east' },
    { room: 'study', id: 'study.seasonal_wardrobe_step_south', wall: 'w_mb_east', wall_side: 'east' },
    { room: 'balcony', id: 'balcony.washer', wall: 'w_balc_west', wall_side: 'east' },
    { room: 'master_bedroom', id: 'mb.washbasin_cabinet', wall: 'w_mbath_south', wall_side: 'south' },
    { room: 'master_bath', id: 'mbath.towel_set', wall: 'w_west_lower', wall_side: 'east' },
    { room: 'master_bedroom', id: 'mb.dressing_table', wall: 'w_west_upper', wall_side: 'east' },
    { room: 'bedroom_nw', id: 'bnw.shelf', wall: 'w_nw_north', wall_side: 'south' },
  ];
  for (const w of wallItems) {
    const item = findItem(furnishings, w.room, w.id);
    assert.equal(item.wall, w.wall, `${w.id} 宿主墙`);
    assert.equal(item.wall_side, w.wall_side, `${w.id} 墙侧`);
    assert.ok(typeof item.along === 'number', `${w.id} 须有 along`);
    assert.equal(item.x, undefined, `${w.id} 不得再带绝对 x`);
    assert.equal(item.z, undefined, `${w.id} 不得再带绝对 z`);
    assert.equal(item.anchor, undefined, `${w.id} 不得同时带 anchor`);
    assert.equal(item.mount, undefined, `${w.id} 不得同时带 mount`);
  }
  const anchorItems: Array<{ room: string; id: string; host: string }> = [
    { room: 'kitchen', id: 'kitchen.dishwasher', host: 'kitchen.countertop_bridge' },
    { room: 'kitchen', id: 'kitchen.gas_stove', host: 'kitchen.cabinet_run_east' },
    { room: 'kitchen', id: 'kitchen.range_hood', host: 'kitchen.gas_stove' },
    { room: 'kitchen', id: 'kitchen.sink', host: 'kitchen.cabinet_run_north_east' },
    { room: 'kitchen', id: 'kitchen.ro_purifier', host: 'kitchen.cabinet_run_north_east' },
    { room: 'study', id: 'study.chair', host: 'study.desk' },
    { room: 'balcony', id: 'balcony.dryer', host: 'balcony.washer' },
    { room: 'master_bedroom', id: 'mb.dressing_stool', host: 'mb.dressing_table' },
  ];
  for (const a of anchorItems) {
    const item = findItem(furnishings, a.room, a.id);
    assert.equal(item.anchor?.source, 'furniture', `${a.id} 须为家具锚点`);
    assert.equal(item.anchor?.id, a.host, `${a.id} 宿主`);
    assert.equal(item.x, undefined, `${a.id} 不得再带绝对 x`);
    assert.equal(item.z, undefined, `${a.id} 不得再带绝对 z`);
  }
});

test('Tier 1 厨房北段：北柜东段沿墙 −0.20m，水槽与净水器跟随，其余厨房件不动', () => {
  moveExperiment('kitchen', 'kitchen.cabinet_run_north_east', -MOVE,
    [
      { id: 'kitchen.sink', dx: -MOVE, dz: 0 },
      { id: 'kitchen.ro_purifier', dx: -MOVE, dz: 0 },
    ],
    [
      'kitchen.cabinet_run_north_west', 'kitchen.countertop_bridge', 'kitchen.dishwasher',
      'kitchen.cabinet_run_east', 'kitchen.gas_stove', 'kitchen.range_hood',
    ],
    { dx: -MOVE, dz: 0 });
});

test('Tier 1 厨房东段：东柜沿墙 −0.20m（南移），灶与烟机跟随，北段不动', () => {
  // w_ent_west 自 (10.80,3.00) 向北：along −0.20 ⇒ 中心 z +0.20（南移）。
  moveExperiment('kitchen', 'kitchen.cabinet_run_east', -MOVE,
    [
      { id: 'kitchen.gas_stove', dx: 0, dz: MOVE },
      { id: 'kitchen.range_hood', dx: 0, dz: MOVE },
    ],
    [
      'kitchen.cabinet_run_north_west', 'kitchen.countertop_bridge', 'kitchen.cabinet_run_north_east',
      'kitchen.dishwasher', 'kitchen.sink', 'kitchen.ro_purifier',
    ],
    { dx: 0, dz: MOVE });
});

test('Tier 1 厨房桥段：台面桥沿墙 +0.20m，洗碗机跟随，两北柜不动', () => {
  moveExperiment('kitchen', 'kitchen.countertop_bridge', MOVE,
    [{ id: 'kitchen.dishwasher', dx: MOVE, dz: 0 }],
    [
      'kitchen.cabinet_run_north_west', 'kitchen.cabinet_run_north_east',
      'kitchen.cabinet_run_east', 'kitchen.gas_stove', 'kitchen.range_hood',
      'kitchen.sink', 'kitchen.ro_purifier',
    ],
    { dx: MOVE, dz: 0 });
});

test('Tier 1 书房桌椅：书桌沿墙 +0.20m，椅跟随，季节柜三件不动', () => {
  moveExperiment('study', 'study.desk', MOVE,
    [{ id: 'study.chair', dx: 0, dz: MOVE }],
    [
      'study.seasonal_wardrobe_wall', 'study.seasonal_wardrobe_step_north',
      'study.seasonal_wardrobe_step_south',
    ],
    { dx: 0, dz: MOVE });
});

test('Tier 1 书房北柜：北墙柜沿墙 +0.20m，两西墙腿不跟随（独立墙锚）', () => {
  moveExperiment('study', 'study.seasonal_wardrobe_wall', MOVE,
    [],
    [
      'study.seasonal_wardrobe_step_north', 'study.seasonal_wardrobe_step_south',
      'study.desk', 'study.chair',
    ],
    { dx: MOVE, dz: 0 });
});

test('Tier 1 阳台：洗衣机沿墙 +0.20m，烘干机跟随（叠放）', () => {
  moveExperiment('balcony', 'balcony.washer', MOVE,
    [{ id: 'balcony.dryer', dx: 0, dz: MOVE }],
    ['kitchen.cabinet_run_north_west', 'kitchen.cabinet_run_east'],
    { dx: 0, dz: MOVE });
});

test('Tier 1 主卫洗手柜：洗手柜沿墙 +0.20m，毛巾组不跟随（独立墙锚）', () => {
  moveExperiment('master_bedroom', 'mb.washbasin_cabinet', MOVE,
    [],
    ['mbath.towel_set', 'mb.dressing_table', 'mb.dressing_stool', 'mb.bed_180'],
    { dx: MOVE, dz: 0 });
});

test('Tier 1 主卧梳妆：梳妆台沿墙 +0.20m，凳跟随', () => {
  moveExperiment('master_bedroom', 'mb.dressing_table', MOVE,
    [{ id: 'mb.dressing_stool', dx: 0, dz: MOVE }],
    ['mb.washbasin_cabinet', 'mbath.towel_set', 'mb.bed_180'],
    { dx: 0, dz: MOVE });
});

test('Tier 1 西北卧搁板：搁板沿墙 +0.20m，无跟随，床与衣柜不动', () => {
  moveExperiment('bedroom_nw', 'bnw.shelf', MOVE,
    [],
    ['bnw.bed_150', 'bnw.wardrobe_180'],
    { dx: MOVE, dz: 0 });
});

test('Tier 1 主卫毛巾：毛巾组沿墙 +0.20m，无跟随，马桶与洗手柜不动', () => {
  moveExperiment('master_bath', 'mbath.towel_set', MOVE,
    [],
    ['mbath.toilet', 'mb.washbasin_cabinet', 'mb.dressing_table'],
    { dx: 0, dz: MOVE });
});
