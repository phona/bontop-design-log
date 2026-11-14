/**
 * Issue #98 二阶段 Stage 2 永久回归测试：沙发南移 0.20m 实验（§10.5 A1–A3、A7b）。
 *
 * 真实配置 + 内存改动：只改 `ld.sofa_3seat` 的 anchor offset dz 一处（+0.20m），
 * 其余 YAML 不动；起点从当前配置读取，不钉 R6 待裁定值；实验后不写盘。
 * 断言全部是相对量（位移差），不钉绝对坐标——日后家具再移动不改本测试。
 * MEP 路由端到端（A4/A5）留待 Stage 3，本测试不覆盖路由。
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

test('Stage 2：沙发南移 0.20m 只改一处声明，依赖自动跟随，固定对象不动', () => {
  const { furnishings, walls, wallSegments } = loadRealConfig();
  const before = resolveAll(furnishings, walls, wallSegments);
  assert.deepEqual(before.diagnostics, [], '基线家具解算须无诊断');
  assert.deepEqual(before.pointDiagnostics, [], '基线点位解算须无诊断');

  // 结构断言：5 个迁移对象确为 anchor 关系（关系形式本身是迁移的成果）。
  const sofaDecl = furnishings.living_dining.find((i) => i.id === 'ld.sofa_3seat')!;
  assert.equal(sofaDecl.anchor?.source, 'furniture');
  assert.equal(sofaDecl.anchor?.id, 'ld.tv_65');
  assert.equal(sofaDecl.x, undefined, '沙发不得再带绝对 x');
  assert.equal(sofaDecl.z, undefined, '沙发不得再带绝对 z');
  for (const id of ['ld.coffee_table', 'ld.floor_lamp']) {
    const item = furnishings.living_dining.find((i) => i.id === id)!;
    assert.equal(item.anchor?.source, 'furniture');
    assert.equal(item.anchor?.id, 'ld.sofa_3seat');
    assert.equal(item.x, undefined, `${id} 不得再带绝对 x`);
    assert.equal(item.z, undefined, `${id} 不得再带绝对 z`);
  }
  for (const pt of loadElectricalConfig().filter((p) => p.id === 'sock_living_sofa_l' || p.id === 'sock_living_sofa_r')) {
    assert.equal((pt as any).anchor?.source, 'furniture');
    assert.equal((pt as any).anchor?.id, 'ld.sofa_3seat');
    assert.equal((pt as any).absolute, undefined, `${pt.id} 不得再带 absolute 标志`);
    assert.equal((pt as any).x, undefined, `${pt.id} 不得再带绝对 x`);
    assert.equal((pt as any).z, undefined, `${pt.id} 不得再带绝对 z`);
  }

  // A1：只改一处声明——沙发 anchor offset dz +0.20m（起点从当前配置读取，不钉 R6 待裁定值）。
  const moved = JSON.parse(JSON.stringify(furnishings)) as FurnishingsYaml;
  const movedSofa = moved.living_dining.find((i) => i.id === 'ld.sofa_3seat')!;
  const originalZ = movedSofa.anchor?.offset?.z;
  assert.ok(typeof originalZ === 'number', '实验前置：沙发须有 anchor offset dz');
  movedSofa.anchor!.offset!.z = originalZ + MOVE;
  const changed = leafDiffPaths(furnishings, moved);
  const sofaIndex = furnishings.living_dining.findIndex((i) => i.id === 'ld.sofa_3seat');
  assert.deepEqual(changed, [`living_dining.${sofaIndex}.anchor.offset.z`], '实验只能改动一处声明');

  const after = resolveAll(moved, walls, wallSegments);
  assert.deepEqual(after.diagnostics, [], '移动后家具解算须无诊断');
  assert.deepEqual(after.pointDiagnostics, [], '移动后点位解算须无诊断');

  const pos = (m: Map<string, { x: number; z: number }>, id: string) => {
    const p = m.get(id);
    assert.ok(p, `缺失 ${id} 的解算位置`);
    return p!;
  };
  const fBefore = new Map([...before.placements.entries()].map(([id, p]) => [id, { x: p.x, z: p.z }]));
  const fAfter = new Map([...after.placements.entries()].map(([id, p]) => [id, { x: p.x, z: p.z }]));

  // A2：依赖自动传播——沙发、茶几、落地灯、两地插 z +0.20，x 不动。
  for (const id of ['ld.sofa_3seat', 'ld.coffee_table', 'ld.floor_lamp']) {
    const b = pos(fBefore, id);
    const a = pos(fAfter, id);
    assert.ok(Math.abs(a.x - b.x) <= TOL, `${id} x 不得移动`);
    assert.ok(Math.abs((a.z - b.z) - MOVE) <= TOL, `${id} z 须南移 0.20m`);
  }
  for (const id of ['sock_living_sofa_l', 'sock_living_sofa_r']) {
    const b = pos(before.points, id);
    const a = pos(after.points, id);
    assert.ok(Math.abs(a.x - b.x) <= TOL, `${id} x 不得移动`);
    assert.ok(Math.abs((a.z - b.z) - MOVE) <= TOL, `${id} z 须南移 0.20m`);
  }

  // A3：固定对象不误动——电视、电视柜、餐桌、入户柜、植物、强电箱、吸顶灯、餐桌地插。
  for (const id of ['ld.tv_65', 'ld.tv_wall_low', 'ld.wall_cabinet_tall', 'ld.dining_table', 'ld.entry_half_height_cabinet', 'ld.plant_fiddle']) {
    const b = pos(fBefore, id);
    const a = pos(fAfter, id);
    assert.ok(Math.abs(a.x - b.x) <= TOL && Math.abs(a.z - b.z) <= TOL, `${id} 不得移动`);
  }
  for (const id of ['panel_strong_entry_left', 'light_living_dome', 'sock_living_table']) {
    const b = pos(before.points, id);
    const a = pos(after.points, id);
    assert.ok(Math.abs(a.x - b.x) <= TOL && Math.abs(a.z - b.z) <= TOL, `${id} 不得移动`);
  }
});
