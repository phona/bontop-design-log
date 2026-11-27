/**
 * Issue #98 二阶段 Tier 2 永久回归测试：13 件家具关系化后的传动实验。
 *
 * 迁移范围（config/house.yaml）：
 * - 电视轴 3 件 anchor ld.tv_65：ld.wall_cabinet_tall、ld.tv_wall_low、ld.plant_fiddle
 * - 床头柜 2 件 anchor mb.bed_180：mb.bedside_cabinet_north/south
 * - 西北卧 3 件：bnw.wardrobe_180 墙锚 w_nw_south、bnw.desk 墙锚 w_mbath_east、
 *   bnw.chair anchor bnw.desk
 * - 东南卧 1 件 anchor bese.bed_150：bese.wardrobe_180
 * - 冰箱+水吧簇 4 件：ld.fridge 墙锚 w_gbath_east、ld.waterbar_cabinet anchor ld.fridge、
 *   ld.dispenser_s1 / ld.coffee_machine anchor ld.waterbar_cabinet
 * - ld.entry_half_height_cabinet 保持绝对（Tier 2 核实：邻墙均不满足墙锚沿墙域/贴墙缝隙，
 *   无合适家具宿主，不编造跟随关系——见 PR 描述）。
 *
 * 真实配置 + 内存改动：每实验只改一处声明（+0.20m），其余 YAML 不动；起点从当前配置
 * 读取，不钉历史坐标；实验后不写盘，复解原始配置即还原。断言全部是相对量（位移差）
 * 或声明形式，不钉绝对坐标——日后家具再移动不改本测试。
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
import type { FurnishingsYaml } from '../../shared/types.js';

const TOL = 0.005;
const MOVE = 0.20;

function loadRealConfig() {
  const house = loadYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: FurnishingsYaml };
  const furnishings = house.furnishings ?? {};
  const catalog = ProjectCatalog.load('.');
  const walls = catalog.getWalls();
  // 房间相对摆位（2026-11-16 DDD 模型约束）：房间包络随解算上下文传入；不传时 7 件
  // 房间相对家具诊断失败（不回落绝对坐标）。
  const rooms = new Map(catalog.getRooms().map((room) => [room.id, room]));
  const wallSegments = new Map<string, any[]>();
  for (const wall of walls) {
    const key = wall.id ?? '';
    const list = wallSegments.get(key) ?? [];
    list.push(wall);
    wallSegments.set(key, list);
  }
  return { furnishings, walls, wallSegments, rooms };
}

function resolveAll(furnishings: FurnishingsYaml, walls: ReturnType<ProjectCatalog['getWalls']>, wallSegments: Map<string, any[]>, rooms: ReadonlyMap<string, { x: number; z: number; width: number; depth: number }>) {
  const items = Object.values(furnishings).flat();
  const { placements, diagnostics } = resolveFurniturePlacements(items, wallSegments as any, { rooms });
  const { pointWalls, mountHosts } = buildPlacementIndexes({ geometry: { walls }, furnishings, anchors: { rooms } });
  const points = new Map<string, { x: number; z: number }>();
  const pointDiagnostics: string[] = [];
  for (const pt of loadElectricalConfig()) {
    const r = resolvePointPlacementInWalls(pt, pointWalls, mountHosts);
    if (r.placement) points.set(pt.id, { x: r.placement.x, z: r.placement.z });
    else pointDiagnostics.push(`${pt.id}: ${r.diagnostic}`);
  }
  return { placements, diagnostics, points, pointDiagnostics };
}

/** 收集两棵 plain 对象的叶路径差异（用于证明只改了一处声明）。 */
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

type Resolved = ReturnType<typeof resolveAll>;
const pos = (m: Map<string, { x: number; z: number }>, id: string) => {
  const p = m.get(id);
  assert.ok(p, `缺失 ${id} 的解算位置`);
  return p!;
};
const furnitureMap = (r: Resolved) => new Map([...r.placements.entries()].map(([id, p]) => [id, { x: p.x, z: p.z }]));

function assertMovedBy(before: Map<string, { x: number; z: number }>, after: Map<string, { x: number; z: number }>, id: string, dx: number, dz: number) {
  const b = pos(before, id);
  const a = pos(after, id);
  assert.ok(Math.abs((a.x - b.x) - dx) <= TOL, `${id} x 须移动 ${dx}m（实际 ${(a.x - b.x).toFixed(4)}）`);
  assert.ok(Math.abs((a.z - b.z) - dz) <= TOL, `${id} z 须移动 ${dz}m（实际 ${(a.z - b.z).toFixed(4)}）`);
}
function assertFixed(before: Map<string, { x: number; z: number }>, after: Map<string, { x: number; z: number }>, id: string) {
  const b = pos(before, id);
  const a = pos(after, id);
  assert.ok(Math.abs(a.x - b.x) <= TOL && Math.abs(a.z - b.z) <= TOL, `${id} 不得移动（实际 Δ=(${(a.x - b.x).toFixed(4)},${(a.z - b.z).toFixed(4)})）`);
}

/** 不在 Tier 2 迁移组内的抽查对象：任何 Tier 2 实验都不得误动它们。 */
const UNTOUCHED_FURNITURE = [
  'ld.dining_table', 'ld.entry_half_height_cabinet', 'mb.bed_180',
  'bnw.bed_150', 'bese.bed_150', 'ld.tv_65',
];
const UNTOUCHED_POINTS = ['night_living_mid', 'sock_living_table'];

function singleDeclarationMove(
  furnishings: FurnishingsYaml,
  room: string,
  id: string,
  mutate: (item: any) => string,
): { moved: FurnishingsYaml; changedPath: string } {
  const moved = JSON.parse(JSON.stringify(furnishings)) as FurnishingsYaml;
  const item = (moved as any)[room].find((i: any) => i.id === id);
  assert.ok(item, `缺失 ${id} 的声明`);
  const leaf = mutate(item);
  const index = (furnishings as any)[room].findIndex((i: any) => i.id === id);
  const changed = leafDiffPaths(furnishings, moved);
  assert.deepEqual(changed, [`${room}.${index}.${leaf}`], '实验只能改动一处声明');
  return { moved, changedPath: changed[0] };
}

test('Tier 2 结构：13 件为关系声明，入户柜保持绝对', () => {
  const { furnishings } = loadRealConfig();
  const find = (room: string, id: string) => {
    const item = (furnishings as any)[room].find((i: any) => i.id === id);
    assert.ok(item, `缺失 ${id} 的声明`);
    return item;
  };
  const assertNoAbsolute = (item: any, id: string) => {
    assert.equal(item.x, undefined, `${id} 不得再带绝对 x`);
    assert.equal(item.z, undefined, `${id} 不得再带绝对 z`);
  };
  for (const id of ['ld.wall_cabinet_tall', 'ld.tv_wall_low', 'ld.plant_fiddle']) {
    const item = find('living_dining', id);
    assert.equal(item.anchor?.source, 'furniture', `${id} 须 anchor 家具`);
    assert.equal(item.anchor?.id, 'ld.tv_65', `${id} 须锚 ld.tv_65`);
    assertNoAbsolute(item, id);
  }
  for (const id of ['mb.bedside_cabinet_north', 'mb.bedside_cabinet_south']) {
    const item = find('master_bedroom', id);
    assert.equal(item.anchor?.source, 'furniture');
    assert.equal(item.anchor?.id, 'mb.bed_180');
    assertNoAbsolute(item, id);
  }
  const wardrobeNw = find('bedroom_nw', 'bnw.wardrobe_180');
  assert.equal(wardrobeNw.wall, 'w_nw_south');
  assert.equal(wardrobeNw.wall_side, 'north');
  assert.ok(typeof wardrobeNw.along === 'number' && typeof wardrobeNw.wall_clearance === 'number');
  assertNoAbsolute(wardrobeNw, 'bnw.wardrobe_180');
  const desk = find('bedroom_nw', 'bnw.desk');
  assert.equal(desk.wall, 'w_mbath_east');
  assert.equal(desk.wall_side, 'east');
  assert.ok(typeof desk.along === 'number' && typeof desk.wall_clearance === 'number');
  assert.equal(desk.width, 1.2, '书桌行内宽须保留');
  assert.equal(desk.depth, 0.45, '书桌行内深须保留');
  assertNoAbsolute(desk, 'bnw.desk');
  const chair = find('bedroom_nw', 'bnw.chair');
  assert.equal(chair.anchor?.source, 'furniture');
  assert.equal(chair.anchor?.id, 'bnw.desk');
  assertNoAbsolute(chair, 'bnw.chair');
  const wardrobeSe = find('bedroom_se', 'bese.wardrobe_180');
  assert.equal(wardrobeSe.anchor?.source, 'furniture');
  assert.equal(wardrobeSe.anchor?.id, 'bese.bed_150');
  assertNoAbsolute(wardrobeSe, 'bese.wardrobe_180');
  const fridge = find('living_dining', 'ld.fridge');
  assert.equal(fridge.wall, 'w_gbath_east');
  assert.equal(fridge.wall_side, 'east');
  assert.ok(typeof fridge.along === 'number' && typeof fridge.wall_clearance === 'number');
  assertNoAbsolute(fridge, 'ld.fridge');
  const waterbar = find('living_dining', 'ld.waterbar_cabinet');
  assert.equal(waterbar.anchor?.source, 'furniture');
  assert.equal(waterbar.anchor?.id, 'ld.fridge');
  assertNoAbsolute(waterbar, 'ld.waterbar_cabinet');
  for (const id of ['ld.dispenser_s1', 'ld.coffee_machine']) {
    const item = find('living_dining', id);
    assert.equal(item.anchor?.source, 'furniture');
    assert.equal(item.anchor?.id, 'ld.waterbar_cabinet');
    assertNoAbsolute(item, id);
  }
  // 入户柜保持绝对：有 x/z、无任何关系声明（核实结论，见 PR 描述）。
  const entry = find('living_dining', 'ld.entry_half_height_cabinet');
  assert.ok(typeof entry.x === 'number' && typeof entry.z === 'number', '入户柜须保持绝对 x/z');
  assert.equal(entry.anchor, undefined);
  assert.equal(entry.wall, undefined);
  assert.equal(entry.mount, undefined);
});

test('Tier 2 传动 G1：电视东移 0.20m，电视轴三件 + 沙发链 + 夜灯跟随', () => {
  const { furnishings, walls, wallSegments, rooms } = loadRealConfig();
  const before = resolveAll(furnishings, walls, wallSegments, rooms);
  assert.deepEqual(before.diagnostics, [], '基线家具解算须无诊断');
  assert.deepEqual(before.pointDiagnostics, [], '基线点位解算须无诊断');
  const fBefore = furnitureMap(before);
  const { moved } = singleDeclarationMove(furnishings, 'living_dining', 'ld.tv_65', (item) => {
    assert.ok(typeof item.x === 'number', '实验前置：电视须为绝对基准');
    item.x += MOVE;
    return 'x';
  });
  const after = resolveAll(moved, walls, wallSegments, rooms);
  assert.deepEqual(after.diagnostics, [], '移动后家具解算须无诊断');
  assert.deepEqual(after.pointDiagnostics, [], '移动后点位解算须无诊断');
  const fAfter = furnitureMap(after);
  for (const id of ['ld.wall_cabinet_tall', 'ld.tv_wall_low', 'ld.plant_fiddle', 'ld.sofa_3seat', 'ld.coffee_table', 'ld.floor_lamp']) {
    assertMovedBy(fBefore, fAfter, id, MOVE, 0);
  }
  assertMovedBy(before.points, after.points, 'night_corridor', MOVE, 0);
  for (const id of ['sock_living_sofa_l', 'sock_living_sofa_r']) {
    assertMovedBy(before.points, after.points, id, MOVE, 0);
  }
  for (const id of ['mb.bedside_cabinet_north', 'mb.bedside_cabinet_south', 'bnw.wardrobe_180', 'bnw.desk', 'bnw.chair', 'bese.wardrobe_180', 'ld.fridge', 'ld.waterbar_cabinet', 'ld.dispenser_s1', 'ld.coffee_machine', ...UNTOUCHED_FURNITURE]) {
    if (id === 'ld.tv_65') continue;
    assertFixed(fBefore, fAfter, id);
  }
  for (const id of UNTOUCHED_POINTS) assertFixed(before.points, after.points, id);
  // 还原：复解原始配置与实验前逐点一致。
  const restored = resolveAll(furnishings, walls, wallSegments, rooms);
  const fRestored = furnitureMap(restored);
  for (const [id, p] of fBefore) {
    const r = pos(fRestored, id);
    assert.ok(Math.abs(r.x - p.x) <= TOL && Math.abs(r.z - p.z) <= TOL, `${id} 还原后须回到实验前位置`);
  }
});

test('Tier 2 传动 G3：床南移 0.20m，两床头柜跟随', () => {
  const { furnishings, walls, wallSegments, rooms } = loadRealConfig();
  const before = resolveAll(furnishings, walls, wallSegments, rooms);
  assert.deepEqual(before.diagnostics, [], '基线家具解算须无诊断');
  const fBefore = furnitureMap(before);
  const { moved } = singleDeclarationMove(furnishings, 'master_bedroom', 'mb.bed_180', (item) => {
    assert.ok(typeof item.z === 'number', '实验前置：床须为绝对基准');
    item.z += MOVE;
    return 'z';
  });
  const after = resolveAll(moved, walls, wallSegments, rooms);
  assert.deepEqual(after.diagnostics, [], '移动后家具解算须无诊断');
  const fAfter = furnitureMap(after);
  for (const id of ['mb.bedside_cabinet_north', 'mb.bedside_cabinet_south']) {
    assertMovedBy(fBefore, fAfter, id, 0, MOVE);
  }
  for (const id of ['ld.wall_cabinet_tall', 'ld.tv_wall_low', 'ld.plant_fiddle', 'ld.sofa_3seat', 'bnw.wardrobe_180', 'bnw.desk', 'bnw.chair', 'bese.wardrobe_180', 'ld.fridge', 'ld.waterbar_cabinet', 'ld.dispenser_s1', 'ld.coffee_machine', ...UNTOUCHED_FURNITURE]) {
    if (id === 'mb.bed_180') continue;
    assertFixed(fBefore, fAfter, id);
  }
  const restored = resolveAll(furnishings, walls, wallSegments, rooms);
  const fRestored = furnitureMap(restored);
  for (const [id, p] of fBefore) {
    const r = pos(fRestored, id);
    assert.ok(Math.abs(r.x - p.x) <= TOL && Math.abs(r.z - p.z) <= TOL, `${id} 还原后须回到实验前位置`);
  }
});

test('Tier 2 传动 G4a：西北衣柜沿墙东移 0.20m，桌椅不动', () => {
  const { furnishings, walls, wallSegments, rooms } = loadRealConfig();
  const before = resolveAll(furnishings, walls, wallSegments, rooms);
  assert.deepEqual(before.diagnostics, [], '基线家具解算须无诊断');
  const fBefore = furnitureMap(before);
  const { moved } = singleDeclarationMove(furnishings, 'bedroom_nw', 'bnw.wardrobe_180', (item) => {
    assert.ok(typeof item.along === 'number', '实验前置：衣柜须为墙锚');
    item.along += MOVE;
    return 'along';
  });
  const after = resolveAll(moved, walls, wallSegments, rooms);
  assert.deepEqual(after.diagnostics, [], '移动后家具解算须无诊断');
  const fAfter = furnitureMap(after);
  assertMovedBy(fBefore, fAfter, 'bnw.wardrobe_180', MOVE, 0);
  for (const id of ['bnw.desk', 'bnw.chair', 'bnw.bed_150', 'ld.wall_cabinet_tall', 'ld.tv_wall_low', 'ld.plant_fiddle', 'mb.bedside_cabinet_north', 'bese.wardrobe_180', 'ld.fridge', 'ld.waterbar_cabinet']) {
    assertFixed(fBefore, fAfter, id);
  }
  const restored = resolveAll(furnishings, walls, wallSegments, rooms);
  const fRestored = furnitureMap(restored);
  for (const [id, p] of fBefore) {
    const r = pos(fRestored, id);
    assert.ok(Math.abs(r.x - p.x) <= TOL && Math.abs(r.z - p.z) <= TOL, `${id} 还原后须回到实验前位置`);
  }
});

test('Tier 2 传动 G4b：西北书桌沿墙南移 0.20m，椅跟随、衣柜不动', () => {
  const { furnishings, walls, wallSegments, rooms } = loadRealConfig();
  const before = resolveAll(furnishings, walls, wallSegments, rooms);
  assert.deepEqual(before.diagnostics, [], '基线家具解算须无诊断');
  const fBefore = furnitureMap(before);
  const { moved } = singleDeclarationMove(furnishings, 'bedroom_nw', 'bnw.desk', (item) => {
    assert.ok(typeof item.along === 'number', '实验前置：书桌须为墙锚');
    item.along += MOVE;
    return 'along';
  });
  const after = resolveAll(moved, walls, wallSegments, rooms);
  assert.deepEqual(after.diagnostics, [], '移动后家具解算须无诊断');
  const fAfter = furnitureMap(after);
  assertMovedBy(fBefore, fAfter, 'bnw.desk', 0, MOVE);
  assertMovedBy(fBefore, fAfter, 'bnw.chair', 0, MOVE);
  for (const id of ['bnw.wardrobe_180', 'bnw.bed_150', 'ld.wall_cabinet_tall', 'ld.tv_wall_low', 'ld.plant_fiddle', 'mb.bedside_cabinet_north', 'bese.wardrobe_180', 'ld.fridge', 'ld.waterbar_cabinet']) {
    assertFixed(fBefore, fAfter, id);
  }
  const restored = resolveAll(furnishings, walls, wallSegments, rooms);
  const fRestored = furnitureMap(restored);
  for (const [id, p] of fBefore) {
    const r = pos(fRestored, id);
    assert.ok(Math.abs(r.x - p.x) <= TOL && Math.abs(r.z - p.z) <= TOL, `${id} 还原后须回到实验前位置`);
  }
});

test('Tier 2 传动 G5：东南床东移 0.20m，衣柜跟随', () => {
  const { furnishings, walls, wallSegments, rooms } = loadRealConfig();
  const before = resolveAll(furnishings, walls, wallSegments, rooms);
  assert.deepEqual(before.diagnostics, [], '基线家具解算须无诊断');
  const fBefore = furnitureMap(before);
  const { moved } = singleDeclarationMove(furnishings, 'bedroom_se', 'bese.bed_150', (item) => {
    assert.ok(typeof item.x === 'number', '实验前置：床须为绝对基准');
    item.x += MOVE;
    return 'x';
  });
  const after = resolveAll(moved, walls, wallSegments, rooms);
  assert.deepEqual(after.diagnostics, [], '移动后家具解算须无诊断');
  const fAfter = furnitureMap(after);
  assertMovedBy(fBefore, fAfter, 'bese.wardrobe_180', MOVE, 0);
  for (const id of ['ld.wall_cabinet_tall', 'ld.tv_wall_low', 'ld.plant_fiddle', 'mb.bedside_cabinet_north', 'bnw.wardrobe_180', 'bnw.desk', 'bnw.chair', 'ld.fridge', 'ld.waterbar_cabinet', 'ld.dispenser_s1', 'ld.coffee_machine', ...UNTOUCHED_FURNITURE]) {
    if (id === 'bese.bed_150') continue;
    assertFixed(fBefore, fAfter, id);
  }
  const restored = resolveAll(furnishings, walls, wallSegments, rooms);
  const fRestored = furnitureMap(restored);
  for (const [id, p] of fBefore) {
    const r = pos(fRestored, id);
    assert.ok(Math.abs(r.x - p.x) <= TOL && Math.abs(r.z - p.z) <= TOL, `${id} 还原后须回到实验前位置`);
  }
});

test('Tier 2 传动 G6a：冰箱离墙东移 0.20m，水吧簇四件跟随；沿墙南移 0.30m 越出短墙域必 fail-closed', () => {
  const { furnishings, walls, wallSegments, rooms } = loadRealConfig();
  const before = resolveAll(furnishings, walls, wallSegments, rooms);
  assert.deepEqual(before.diagnostics, [], '基线家具解算须无诊断');
  const fBefore = furnitureMap(before);
  // 沿墙方向 0.20m 不可行：w_gbath_east 全长仅 1.24m（2026-11-27 量房回填：1.15→1.24），
  // 冰箱沿墙域 [0.4165, 0.8235]，现 along 0.5865 南移 0.20m 得 0.7865 仍在域内、北移 0.20m
  // 得 0.3865 越出北端——南向反例须加大到 +0.30m（0.8865 > 0.8235）才越出南端。
  // 这是设计本身的几何约束，不是实验取巧。故传动实验改走 wall_clearance +0.20m（东移），
  // 仍为单声明 0.20m 移动；沿墙越界另立反例断言 fail-closed（反例取 +0.30m）。
  const { moved } = singleDeclarationMove(furnishings, 'living_dining', 'ld.fridge', (item) => {
    assert.ok(typeof item.wall_clearance === 'number', '实验前置：冰箱须为墙锚');
    item.wall_clearance += MOVE;
    return 'wall_clearance';
  });
  const after = resolveAll(moved, walls, wallSegments, rooms);
  assert.deepEqual(after.diagnostics, [], '移动后家具解算须无诊断');
  const fAfter = furnitureMap(after);
  for (const id of ['ld.fridge', 'ld.waterbar_cabinet', 'ld.dispenser_s1', 'ld.coffee_machine']) {
    assertMovedBy(fBefore, fAfter, id, MOVE, 0);
  }
  for (const id of ['ld.wall_cabinet_tall', 'ld.tv_wall_low', 'ld.plant_fiddle', 'ld.sofa_3seat', 'mb.bedside_cabinet_north', 'bnw.wardrobe_180', 'bnw.desk', 'bnw.chair', 'bese.wardrobe_180', ...UNTOUCHED_FURNITURE]) {
    assertFixed(fBefore, fAfter, id);
  }
  const restored = resolveAll(furnishings, walls, wallSegments, rooms);
  const fRestored = furnitureMap(restored);
  for (const [id, p] of fBefore) {
    const r = pos(fRestored, id);
    assert.ok(Math.abs(r.x - p.x) <= TOL && Math.abs(r.z - p.z) <= TOL, `${id} 还原后须回到实验前位置`);
  }

  // 反例：沿墙南移 0.30m 越出 w_gbath_east 南端（0.5865+0.30=0.8865 > 域南端 0.8235；
  // +0.20m 得 0.7865 仍在域内，量房回填后墙长 1.15→1.24m、域 [0.4165,0.7335]→[0.4165,0.8235]），
  // 解算须显式诊断、整簇不得出局部坐标。
  const { moved: movedAlong } = singleDeclarationMove(furnishings, 'living_dining', 'ld.fridge', (item) => {
    item.along += 0.30;
    return 'along';
  });
  const rejected = resolveAll(movedAlong, walls, wallSegments, rooms);
  const fridgeDiag = rejected.diagnostics.find((d) => d.id === 'ld.fridge');
  assert.ok(fridgeDiag && fridgeDiag.diagnostic.includes('outside wall span'), `冰箱沿墙越界须报 outside wall span，实际：${JSON.stringify(rejected.diagnostics)}`);
  for (const id of ['ld.fridge', 'ld.waterbar_cabinet', 'ld.dispenser_s1', 'ld.coffee_machine']) {
    assert.ok(!rejected.placements.has(id), `${id} 越界后不得产出位置（fail-closed）`);
  }
  assert.ok(rejected.placements.has('ld.tv_65'), '越界须是局部的：无关家具仍须解出');
});

test('Tier 2 传动 G6b：水吧柜相对冰箱南移 0.20m，柜面两件跟随、冰箱不动', () => {
  const { furnishings, walls, wallSegments, rooms } = loadRealConfig();
  const before = resolveAll(furnishings, walls, wallSegments, rooms);
  assert.deepEqual(before.diagnostics, [], '基线家具解算须无诊断');
  const fBefore = furnitureMap(before);
  const { moved } = singleDeclarationMove(furnishings, 'living_dining', 'ld.waterbar_cabinet', (item) => {
    assert.ok(typeof item.anchor?.offset?.z === 'number', '实验前置：水吧柜须 anchor 冰箱');
    item.anchor.offset.z += MOVE;
    return 'anchor.offset.z';
  });
  const after = resolveAll(moved, walls, wallSegments, rooms);
  assert.deepEqual(after.diagnostics, [], '移动后家具解算须无诊断');
  const fAfter = furnitureMap(after);
  for (const id of ['ld.waterbar_cabinet', 'ld.dispenser_s1', 'ld.coffee_machine']) {
    assertMovedBy(fBefore, fAfter, id, 0, MOVE);
  }
  for (const id of ['ld.fridge', 'ld.wall_cabinet_tall', 'ld.tv_wall_low', 'ld.plant_fiddle', 'ld.sofa_3seat', 'mb.bedside_cabinet_north', 'bnw.wardrobe_180', 'bnw.desk', 'bnw.chair', 'bese.wardrobe_180', ...UNTOUCHED_FURNITURE]) {
    assertFixed(fBefore, fAfter, id);
  }
  const restored = resolveAll(furnishings, walls, wallSegments, rooms);
  const fRestored = furnitureMap(restored);
  for (const [id, p] of fBefore) {
    const r = pos(fRestored, id);
    assert.ok(Math.abs(r.x - p.x) <= TOL && Math.abs(r.z - p.z) <= TOL, `${id} 还原后须回到实验前位置`);
  }
});
