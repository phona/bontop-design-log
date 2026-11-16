/**
 * Issue #98 二阶段 Stage 3 真实配置回归：两条沙发 MEP 路由关系化（§10.5 A4/A5）。
 *
 * 真实 YAML + 内存改动；期望值全部从当前配置推导（解算端点、from_height），不写死 R6
 * 偏移与历史绝对坐标；唯一例外是竖井轴坐标：R-S3 裁定值 (10.74, 2.98, 0.02) 作为独立
 * 期望钉在 C1（钉裁定非历史；量房后合法改轴随新裁定更新）。实验后不写盘。
 * 覆盖：C1 关系化拓扑不变式、C2 沙发 +0.20m 端到端跟随、C4 反例 fail-closed、
 * C3 算量自洽（takeoff 各输出由同一份解算结果独立重算）。
 * lint / 3D / DXF / verify 由全套件 + verify:all + 导出脚本覆盖（见 PR 描述）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  endpointSourcesFromFacts,
  isMepViaCoordinate,
  parseMepCoordination,
  resolveMepRoutes,
  validateMepCoordination,
  type MepCoordination,
} from '../../shared/mep-hvac-coordination-schema.js';
import { computeMepTakeoff, unionPlanLength, type MepTakeoffRules, type TakeoffCircuit } from '../../shared/mep-takeoff.js';
import { buildProjectDxf } from '../../shared/dxf/project-dxf.js';
import { pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveFurniturePlacements } from '../../shared/furniture-placement.js';
import { resolvePointPlacementInWalls } from '../../shared/point-placement.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingsYaml, VertexLayoutYaml } from '../../shared/types.js';

const TOL = 0.005;
const MOVE = 0.20;
const ROUTE_L = 'strong-power-living-sofa-l';
const ROUTE_R = 'strong-power-living-sofa-r';
/**
 * R-S3 裁定（2026-11-14，Option 0）：共享竖井 shaft_entry 的裁定坐标。
 * 钉的是裁定（设计决策），不是历史坐标——量房后合法改轴须随新裁定同步更新本常量；
 * 除竖井轴坐标外，其余期望仍从当前配置推导。
 */
const RULED_SHAFT = { id: 'shaft_entry', x: 10.74, z: 2.98, y: 0.02 };

function loadAll() {
  const house = parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: FurnishingsYaml };
  const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as any[];
  const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as any[];
  const ceiling = parseYaml(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as any[];
  const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as any;
  const topology = parseYaml(readFileSync('config/electrical-topology.yaml', 'utf8')) as {
    circuits: TakeoffCircuit[];
    controls?: Array<{ switch_point_ids?: string[]; target_point_ids?: string[] }>;
  };
  const rules = parseYaml(readFileSync('config/mep-takeoff.yaml', 'utf8')) as MepTakeoffRules;
  const coordination = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
  const layout = resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml);
  const pointWalls = pointWallIndexFromElements(layout.walls);
  return { furnishings: house.furnishings ?? {}, electrical, plumbing, ceiling, hvac, topology, rules, coordination, layout, pointWalls };
}

/** 全链路解算：家具 → 点位 → MEP 路由 → 算量（同一份输入，同一份解算结果）。 */
function resolveChain(all: ReturnType<typeof loadAll>, furnishings: FurnishingsYaml) {
  const wallSegments = new Map<string, any[]>();
  for (const wall of all.layout.walls as any[]) {
    const list = wallSegments.get(wall.id ?? '') ?? [];
    list.push(wall);
    wallSegments.set(wall.id ?? '', list);
  }
  const items = Object.values(furnishings).flat();
  const { placements, diagnostics } = resolveFurniturePlacements(items, wallSegments as any);
  const { mountHosts } = buildPlacementIndexes({ geometry: { walls: all.layout.walls }, furnishings });
  const sources = endpointSourcesFromFacts(
    { electrical: all.electrical, plumbing: all.plumbing, ceiling: all.ceiling, hvac: all.hvac } as any,
    all.pointWalls,
    mountHosts,
  );
  const points = new Map<string, { x: number; z: number }>();
  const pointDiagnostics: string[] = [];
  for (const pt of all.electrical as any[]) {
    const r = resolvePointPlacementInWalls(pt, all.pointWalls, mountHosts);
    if (r.placement) points.set(pt.id, { x: r.placement.x, z: r.placement.z });
    else pointDiagnostics.push(`${pt.id}: ${r.diagnostic}`);
  }
  const report = resolveMepRoutes(all.coordination, sources);
  const takeoff = computeMepTakeoff({
    electrical: all.electrical as any,
    plumbing: all.plumbing as any,
    circuits: all.topology.circuits,
    controls: all.topology.controls ?? [],
    routes: all.coordination.routes,
    resolution: report,
    rules: all.rules,
  });
  return { placements, diagnostics, points, pointDiagnostics, sources, report, takeoff };
}

function planLength(points: ReadonlyArray<{ x: number; z: number }>): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0);
}
function length3d(points: ReadonlyArray<{ x: number; y?: number; z: number }>): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, (p.y ?? 0) - (points[i].y ?? 0), p.z - points[i].z), 0);
}
/** 连续重复点去重（旧绝对 via 末点与 to 端点重复，容差内算同一点）。 */
function dedup(points: ReadonlyArray<{ x: number; y?: number; z: number }>): Array<{ x: number; y?: number; z: number }> {
  const out: Array<{ x: number; y?: number; z: number }> = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(p.x - last.x) <= TOL && Math.abs(p.z - last.z) <= TOL && Math.abs((p.y ?? 0) - (last.y ?? 0)) <= TOL) continue;
    out.push({ ...p });
  }
  return out;
}
function assertPointClose(a: { x: number; y?: number; z: number }, b: { x: number; y?: number; z: number }, what: string): void {
  assert.ok(Math.abs(a.x - b.x) <= TOL && Math.abs(a.z - b.z) <= TOL && Math.abs((a.y ?? 0) - (b.y ?? 0)) <= TOL,
    `${what} 偏差超 ${TOL}m：(${a.x},${a.z},${a.y}) vs (${b.x},${b.z},${b.y})`);
}
function assertOrthogonal(points: ReadonlyArray<{ x: number; z: number }>, what: string): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    assert.ok(Math.abs(a.x - b.x) <= TOL || Math.abs(a.z - b.z) <= TOL, `${what} 第 ${i} 段不是正交段`);
  }
}
/** 无往返折返：同一线段（任一方向）不得出现两次（1mm 舍入去浮点尾巴）。 */
function assertNoRetrace(points: ReadonlyArray<{ x: number; y?: number; z: number }>, what: string): void {
  const key = (a: { x: number; y?: number; z: number }, b: { x: number; y?: number; z: number }): string =>
    `${a.x.toFixed(3)},${a.z.toFixed(3)},${(a.y ?? 0).toFixed(3)}|${b.x.toFixed(3)},${b.z.toFixed(3)},${(b.y ?? 0).toFixed(3)}`;
  const seen = new Set<string>();
  for (let i = 1; i < points.length; i++) {
    const k = key(points[i - 1], points[i]);
    const rev = key(points[i], points[i - 1]);
    assert.ok(!seen.has(k) && !seen.has(rev), `${what} 第 ${i} 段与前面重合（往返折返）`);
    seen.add(k);
  }
}
function leafDiffPaths(a: unknown, b: unknown, prefix = ''): string[] {
  if (a === b) return [];
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return [prefix || '(root)'];
  const out: string[] = [];
  for (const key of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) {
    out.push(...leafDiffPaths((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key));
  }
  return out;
}
function routeOf(report: ReturnType<typeof resolveMepRoutes>, id: string) {
  const r = report.routes.find((item) => item.route.id === id);
  assert.ok(r, `缺失路由 ${id}`);
  return r!;
}

test('C1：两路由关系化——共享竖井只声明一次，解算折线满足裁定拓扑不变式', () => {
  const all = loadAll();
  const { report, takeoff } = resolveChain(all, all.furnishings);
  assert.deepEqual(report.diagnostics, [], '全量路由解算须无诊断');
  assert.doesNotThrow(() => validateMepCoordination(all.coordination, resolveChain(all, all.furnishings).sources), '迁移后 coordination 须通过 schema 校验');

  // 共享基准只声明一次，两路由共同引用；三步顺序即裁定拓扑。
  assert.equal(all.coordination.shafts.length, 1, 'shafts 表须只有一口竖井声明');
  const shaft = all.coordination.shafts[0];
  assert.equal(shaft.id, 'shaft_entry');
  // 裁定值独立断言：竖井声明须等于 R-S3 裁定坐标。C1 的逐点等价若全从当前声明推导，
  // shaft.x 误改会双侧同移而测不出（Codex major）——本断言是独立的第二道防线。
  assert.equal(shaft.x, RULED_SHAFT.x, '竖井 x 须为 R-S3 裁定值 10.74');
  assert.equal(shaft.z, RULED_SHAFT.z, '竖井 z 须为 R-S3 裁定值 2.98');
  assert.equal(shaft.y, RULED_SHAFT.y, '竖井 y 须为 R-S3 裁定值 0.02');
  for (const id of [ROUTE_L, ROUTE_R]) {
    const route = all.coordination.routes.find((r) => r.id === id)!;
    assert.deepEqual(route.via.map((s: any) => s.kind), ['from_face_jog', 'from_drop', 'shaft_run'], `${id} via 须为裁定三步`);
    assert.ok(route.via.every((s: any) => s.shaft === 'shaft_entry'), `${id} 各步须引用同一竖井`);
    assert.ok(route.via.every((s: any) => s.y === undefined), `${id} 各步不得重复声明高度（横移取 from_height，其余取竖井高度）`);
    // 工程状态原样保留。
    assert.equal(route.status, 'inferred');
    assert.equal(route.source_status, 'proposed');
    assert.equal(route.construction_status, 'pending');
    assert.equal(route.method, 'floor_branch_candidate');
    assert.equal(route.diameter, 0.02);
    assert.equal(route.from, 'panel_strong_entry_left');
  }
  // 本批新增：餐桌路由已随强电干线切片关系化（竖井三步，与 sofa 两路由同轴）。
  const table = all.coordination.routes.find((r) => r.id === 'strong-power-living-table')!;
  assert.deepEqual(table.via.map((s: any) => s.kind), ['from_face_jog', 'from_drop', 'shaft_run'], '餐桌路由 via 须为竖井三步');
  assert.ok(table.via.every((s: any) => s.shaft === 'shaft_entry'), '餐桌路由各步须引用同一竖井');
  // 红线路由 strong-ded-bathheaters-mbath 已随 MEP gap-1 批关系化（2026-11-16）：
  // 穿柜冲突改由顶封 25mm 线槽解决（infer，用户裁定），路由几何不变、改道裁定作废。
  // 此处钉死迁移后的关系步序列，防止回退到绝对 via。
  const mbath = all.coordination.routes.find((r) => r.id === 'strong-ded-bathheaters-mbath')!;
  assert.deepEqual(
    mbath.via.map((s: any) => s.kind),
    ['axis_jog', 'axis_run', 'axis_run', 'vertical_to', 'axis_run', 'axis_run'],
    'mbath 路由 via 须为 gap-1 迁移后的关系步',
  );
  assert.ok(!mbath.via.some(isMepViaCoordinate), 'mbath 路由须不再含绝对坐标步');

  for (const id of [ROUTE_L, ROUTE_R]) {
    const r = routeOf(report, id);
    assert.deepEqual(r.unresolved, [], `${id} 须解出`);
    assert.deepEqual(r.diagnostics, [], `${id} 须无诊断`);
    const from = r.from!;
    const to = r.to!;
    const fromHeight = r.route.from_height!;
    const toHeight = r.route.to_height!;
    // 拓扑不变式（R-S3 裁定拓扑：箱底横移→竖降→南行→横接，共 5 点；逐点等价证明
    // 已随 PR #232 合入归档，不住测试套件）。竖井轴值取 shafts 表声明（表值本身
    // 由上方 R-S3 裁定断言钉住，本处只验拓扑跟随声明）。
    assert.equal(r.points.length, 5, `${id} 折线须为 5 点（裁定拓扑，无旧 stub）`);
    assertPointClose(r.points[0], { ...from, y: fromHeight }, `${id} 起点须为 from + from_height`);
    assertPointClose(r.points[r.points.length - 1], { ...to, y: toHeight }, `${id} 终点须为 to + to_height`);
    // 旧 stub 不复存在：折线内无连续重复点。
    assert.equal(dedup(r.points).length, r.points.length, `${id} 不得含连续重复点`);
    assertOrthogonal(r.points, id);
    assertNoRetrace(r.points, id);
    // 恰一段改 y（竖降）：落在竖井轴 x、from 的 z 上，落差为 from_height→竖井 y。
    const yChanging = r.points.slice(1)
      .map((p, i) => ({ i: i + 1, dy: (p.y ?? 0) - (r.points[i].y ?? 0) }))
      .filter((s) => Math.abs(s.dy) > TOL);
    assert.equal(yChanging.length, 1, `${id} 须恰一段改 y（竖降）`);
    const dropIdx = yChanging[0].i;
    assert.ok(Math.abs(r.points[dropIdx].x - shaft.x) <= TOL, `${id} 竖降段须落在竖井轴 x 上`);
    assert.ok(Math.abs(r.points[dropIdx].z - from.z) <= TOL, `${id} 竖降段须在 from 的 z 上`);
    assert.ok(Math.abs(yChanging[0].dy - (shaft.y - fromHeight)) <= TOL, `${id} 竖降落差须为 from_height→竖井 y`);
    // 恰一段改 z（南行）：沿竖井轴 x 走。
    const zChanging = r.points.slice(1)
      .map((p, i) => ({ i: i + 1, dz: p.z - r.points[i].z }))
      .filter((s) => Math.abs(s.dz) > TOL);
    assert.equal(zChanging.length, 1, `${id} 须恰一段改 z（南行）`);
    const southIdx = zChanging[0].i;
    assert.ok(
      Math.abs(r.points[southIdx - 1].x - shaft.x) <= TOL && Math.abs(r.points[southIdx].x - shaft.x) <= TOL,
      `${id} 南行段须沿竖井轴 x`,
    );
    // 长度由声明推导，不钉死数值：平面 = 面管横移 + 南行 + 末 jog；三维 = 平面 + 竖降。
    // 横移/南行/末 jog 的竖井轴端取裁定常量（与长度推导同口径，独立于声明）。
    const planExpected = Math.abs(RULED_SHAFT.x - from.x) + Math.abs(to.z - from.z) + Math.abs(to.x - RULED_SHAFT.x);
    assert.ok(Math.abs(planLength(r.points) - planExpected) <= TOL, `${id} 平面长度须等于推导值`);
    assert.ok(Math.abs(length3d(r.points) - (planExpected + (fromHeight - RULED_SHAFT.y))) <= TOL, `${id} 三维长度须等于推导值`);
  }
  // 算量：两路由须进量、无 unresolved（材料算量另见 C3 等价测试）。
  for (const id of [ROUTE_L, ROUTE_R]) {
    assert.ok(!takeoff.unresolved.some((u) => u.id === id), `算量 unresolved 不得含 ${id}`);
  }
});

test('C2：沙发 +0.20m——只改一处声明，家具/地插/两路由全跟随，恢复后几何复原', () => {
  const all = loadAll();
  const before = resolveChain(all, all.furnishings);
  assert.deepEqual(before.diagnostics, [], '基线家具解算须无诊断');
  assert.deepEqual(before.pointDiagnostics, [], '基线点位解算须无诊断');

  const moved = JSON.parse(JSON.stringify(all.furnishings)) as FurnishingsYaml;
  const movedSofa = moved.living_dining.find((i) => i.id === 'ld.sofa_3seat')!;
  const originalZ = movedSofa.anchor?.offset?.z;
  assert.ok(typeof originalZ === 'number', '实验前置：沙发须有 anchor offset dz');
  movedSofa.anchor!.offset!.z = originalZ + MOVE;
  const changed = leafDiffPaths(all.furnishings, moved);
  const sofaIndex = all.furnishings.living_dining.findIndex((i) => i.id === 'ld.sofa_3seat');
  assert.deepEqual(changed, [`living_dining.${sofaIndex}.anchor.offset.z`], '实验只能改动一处声明');

  const after = resolveChain(all, moved);
  assert.deepEqual(after.diagnostics, [], '移动后家具解算须无诊断');
  assert.deepEqual(after.pointDiagnostics, [], '移动后点位解算须无诊断');
  const pos = (m: Map<string, { x: number; z: number }>, id: string) => {
    const p = m.get(id);
    assert.ok(p, `缺失 ${id} 的解算位置`);
    return p!;
  };
  const fBefore = new Map([...before.placements.entries()].map(([id, p]) => [id, { x: p.x, z: p.z }]));
  const fAfter = new Map([...after.placements.entries()].map(([id, p]) => [id, { x: p.x, z: p.z }]));

  // 家具与地插跟随。
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
  // 固定对象不动：电视、强电箱。
  for (const id of ['ld.tv_65']) {
    const b = pos(fBefore, id);
    const a = pos(fAfter, id);
    assert.ok(Math.abs(a.x - b.x) <= TOL && Math.abs(a.z - b.z) <= TOL, `${id} 不得移动`);
  }
  for (const id of ['panel_strong_entry_left']) {
    const b = pos(before.points, id);
    const a = pos(after.points, id);
    assert.ok(Math.abs(a.x - b.x) <= TOL && Math.abs(a.z - b.z) <= TOL, `${id} 不得移动`);
  }

  // 两路由末端与南行段终点跟随；横移/竖降拐点不动；总长各 +0.20m；不产生旧 stub（点数仍为 5）。
  for (const id of [ROUTE_L, ROUTE_R]) {
    const rb = routeOf(before.report, id);
    const ra = routeOf(after.report, id);
    assert.deepEqual(ra.unresolved, [], `${id} 移动后须解出`);
    assert.equal(ra.points.length, 5, `${id} 移动后折线仍为 5 点（无旧 stub）`);
    assert.equal(ra.points.length, rb.points.length, `${id} 移动前后点数须一致`);
    assert.deepEqual(ra.viaPoints.slice(0, 2), rb.viaPoints.slice(0, 2), `${id} 横移/竖降拐点不得移动`);
    assert.ok(Math.abs((ra.viaPoints[2].z - rb.viaPoints[2].z) - MOVE) <= TOL, `${id} 南行段终点须南移 0.20m`);
    assert.ok(Math.abs((ra.to!.z - rb.to!.z) - MOVE) <= TOL, `${id} 末端须南移 0.20m`);
    assert.ok(Math.abs(ra.from!.x - rb.from!.x) <= TOL && Math.abs(ra.from!.z - rb.from!.z) <= TOL, `${id} from 不得移动`);
    assert.ok(Math.abs((planLength(ra.points) - planLength(rb.points)) - MOVE) <= TOL, `${id} 平面长度须 +0.20m`);
    assert.ok(Math.abs((length3d(ra.points) - length3d(rb.points)) - MOVE) <= TOL, `${id} 三维长度须 +0.20m`);
    assertOrthogonal(ra.points, `${id} 移动后`);
  }

  // 恢复：用原始配置重解，几何与诊断完全复原。
  const restored = resolveChain(all, all.furnishings);
  for (const id of [ROUTE_L, ROUTE_R]) {
    assert.deepEqual(restored.report.routes.find((r) => r.route.id === id)!.points, before.report.routes.find((r) => r.route.id === id)!.points, `${id} 恢复后折线须与实验前完全一致`);
    assert.deepEqual(restored.report.routes.find((r) => r.route.id === id)!.diagnostics, [], `${id} 恢复后须无诊断`);
  }
});

test('C3：算量自洽——takeoff 各输出由同一份解算结果独立重算', () => {
  const all = loadAll();
  const { report, takeoff } = resolveChain(all, all.furnishings);

  // 1. 确定性：同一份输入重算，结果逐项一致。
  const again = computeMepTakeoff({
    electrical: all.electrical as any,
    plumbing: all.plumbing as any,
    circuits: all.topology.circuits,
    controls: all.topology.controls ?? [],
    routes: all.coordination.routes,
    resolution: report,
    rules: all.rules,
  });
  assert.deepEqual(again, takeoff, '同一份输入重算 takeoff 须逐项一致');

  // 2. 各总量由解算结果独立重算（与 takeoff 同口径的过滤：covered 层、已解出、
  //    physical、端点未延期；下引仅当 rules.include_terminal_drop 开启）。
  const covered = new Set(all.rules.covered_layers);
  const elecById = new Map(all.electrical.map((p: any) => [p.id, p]));
  const pointHeights = new Map<string, number>();
  for (const p of [...all.electrical, ...all.plumbing]) {
    if (p.height !== undefined) pointHeights.set(p.id, p.height);
  }
  // 只有 position_status/status 都为 pending 的点位才延期（与 takeoff 同口径）。
  const isDeferred = (p: any): boolean => p !== undefined && p.position_status === 'pending' && p.status === 'pending';
  const counted = (route: any): { drawn: number; drop: number; points: Array<{ x: number; z: number; y?: number }> } | null => {
    if (!covered.has(route.layer)) return null;
    const res = report.routes.find((item) => item.route.id === route.id);
    if (!res || res.unresolved.length > 0 || !res.metadata.physicalRoute) return null;
    if ([route.from, route.to].some((e: any) => typeof e === 'string' && isDeferred(elecById.get(e)))) return null;
    const drawn = length3d(res.points);
    let drop = 0;
    if (all.rules.include_terminal_drop && typeof route.to === 'string' && pointHeights.has(route.to)) {
      const lastY = res.points[res.points.length - 1]?.y;
      const h = pointHeights.get(route.to)!;
      if (lastY !== undefined && lastY > h) drop = lastY - h;
    }
    return { drawn, drop, points: res.points };
  };
  let strongSum = 0;
  let dropSum = 0;
  const drawnPaths: Array<Array<{ x: number; z: number }>> = [];
  const strongPaths: Array<Array<{ x: number; z: number }>> = [];
  let livingSum = 0;
  for (const route of all.coordination.routes) {
    const c = counted(route);
    if (!c) continue;
    if (route.layer === 'strong_power') {
      strongSum += c.drawn + c.drop;
      strongPaths.push(c.points.map((p) => ({ x: p.x, z: p.z })));
    }
    dropSum += c.drop;
    drawnPaths.push(c.points.map((p) => ({ x: p.x, z: p.z })));
    if (typeof route.to === 'string' && elecById.get(route.to)?.room === 'living_dining') livingSum += c.drawn;
  }
  const close = (a: number, b: number, what: string): void => {
    assert.ok(Math.abs(a - b) <= 1e-6, `${what}：takeoff ${a} vs 独立重算 ${b}`);
  };
  close(takeoff.conduit.strongPowerM, strongSum, '强电管长须等于各条已画线强电路由（三维长 + 终端下引）之和');
  close(takeoff.conduit.terminalDropM, dropSum, '终端下引总量须等于各条路由下引之和');
  close(takeoff.conduit.drawnRouteUnionM, unionPlanLength(drawnPaths), '画线并集总长须等于已画线路由平面路径的网格并集');
  close(takeoff.conduit.strongPowerUnionAllM, unionPlanLength(strongPaths), '强电画线并集须等于强电路由平面路径的网格并集');
  close(takeoff.coverage.byRoom.living_dining?.drawnRouteM ?? 0, livingSum, '客餐厅画线长须等于终点在客餐厅的路由三维长之和');

  // 3. 报价门与 blocker 清单同源：可报价当且仅当 blocker 为空；error 级不得存在。
  assert.equal(takeoff.feasibleForQuote, takeoff.blockers.length === 0, '可报价标志须与 blocker 清单同源');
  assert.ok(takeoff.blockers.every((b) => b.kind !== 'error'), `error 级 blocker 不得存在：${JSON.stringify(takeoff.blockers.filter((b) => b.kind === 'error'))}`);
  assert.ok(takeoff.unresolved.every((u) => u.kind !== 'error'), `error 级 unresolved 不得存在：${JSON.stringify(takeoff.unresolved.filter((u) => u.kind === 'error'))}`);
});

test('C4：反例——断引用/不一致一律 fail-closed，不出局部几何', () => {
  const all = loadAll();
  const base = resolveChain(all, all.furnishings);
  assert.deepEqual(base.report.diagnostics, [], '基线须无诊断');

  // (1) 共享轴缺失。
  const noShaftCoord = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  noShaftCoord.shafts = [];
  const noShaft = resolveMepRoutes(noShaftCoord, base.sources);
  // 受牵连的路由即引用同一竖井的路由，从配置推导、不钉死条数（后续批迁移更多路由
  // 上同一竖井时本断言仍成立；当前为 sofa-l/r + living-table + weakbox 共 4 条）。
  const shaftUsers = all.coordination.routes.filter((r) =>
    r.via.some((s: any) => !isMepViaCoordinate(s) && s.shaft === 'shaft_entry'),
  );
  for (const id of shaftUsers.map((r) => r.id)) {
    const r = routeOf(noShaft, id);
    assert.deepEqual(r.unresolved, ['via'], `${id} 竖井缺失须 via 未解`);
    assert.deepEqual(r.points, [], `${id} 竖井缺失不得出局部几何`);
    assert.match(r.diagnostics[0], /引用未知竖井 "shaft_entry"/, `${id} 诊断须点名竖井`);
  }
  // 其余路由不受影响（仍全解出）；受牵连的须恰好是引用该竖井的路由。
  assert.equal(noShaft.routes.filter((r) => r.unresolved.length === 0).length, noShaft.routes.length - shaftUsers.length, '其余路由不得被牵连');
  assert.deepEqual(noShaft.routes.filter((r) => r.unresolved.length > 0).map((r) => r.route.id).sort(), shaftUsers.map((r) => r.id).sort(), '受牵连的须恰好是引用该竖井的路由');

  // (2) 共享轴 z 与落点不一致（2.96 vs 2.98）。
  const staleCoord = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  staleCoord.shafts[0].z = 2.96;
  const stale = resolveMepRoutes(staleCoord, base.sources);
  for (const id of [ROUTE_L, ROUTE_R]) {
    const r = routeOf(stale, id);
    assert.deepEqual(r.unresolved, ['via'], `${id} 竖井 z 不一致须 via 未解`);
    assert.deepEqual(r.points, [], `${id} 竖井 z 不一致不得出局部几何`);
    assert.match(r.diagnostics[0], /差 0\.020m，超过 0\.005m/, `${id} 诊断须写明差值`);
  }

  // (3) 地插端点断引用。
  const brokenToCoord = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  brokenToCoord.routes.find((r) => r.id === ROUTE_L)!.to = 'sock_living_sofa_l_missing';
  const brokenTo = resolveMepRoutes(brokenToCoord, base.sources);
  const brokenRoute = routeOf(brokenTo, ROUTE_L);
  assert.ok(brokenRoute.unresolved.includes('to'), '断引用端点须报 to 未解');
  assert.ok(brokenRoute.unresolved.includes('via'), '断引用端点须连带 via 未解（shaft_run 无终点）');
  assert.deepEqual(brokenRoute.points, [], '断引用端点不得出局部几何');
  assert.deepEqual(routeOf(brokenTo, ROUTE_R).unresolved, [], '另一路由不得被牵连');

  // (4) 新关系步缺上下文：from 端点断引用，横移步无起点。
  const brokenFromCoord = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  brokenFromCoord.routes.find((r) => r.id === ROUTE_L)!.from = 'panel_strong_entry_left_missing';
  const brokenFrom = resolveMepRoutes(brokenFromCoord, base.sources);
  const brokenFromRoute = routeOf(brokenFrom, ROUTE_L);
  assert.ok(brokenFromRoute.unresolved.includes('from'), 'from 断引用须报 from 未解');
  assert.ok(brokenFromRoute.unresolved.includes('via'), 'from 断引用须连带 via 未解');
  assert.deepEqual(brokenFromRoute.points, [], 'from 断引用不得出局部几何');

  // (5a) 算量：求解失败的路由进 unresolved(error)，可报价标志随之变假。
  const brokenTakeoff = computeMepTakeoff({
    electrical: all.electrical as any,
    plumbing: all.plumbing as any,
    circuits: all.topology.circuits,
    controls: all.topology.controls ?? [],
    routes: noShaftCoord.routes,
    resolution: noShaft,
    rules: all.rules,
  });
  for (const id of shaftUsers.map((r) => r.id)) {
    const entry = brokenTakeoff.unresolved.find((u) => u.id === id);
    assert.ok(entry, `算量 unresolved 须含 ${id}`);
    assert.equal(entry!.kind, 'error', `${id} 须为 error 级（不可报价）`);
  }
  assert.equal(brokenTakeoff.feasibleForQuote, false, '求解失败时 feasibleForQuote 须为 false');
  const healthyIds = new Set(base.takeoff.unresolved.map((u) => u.id));
  const newIds = brokenTakeoff.unresolved.map((u) => u.id).filter((id) => !healthyIds.has(id));
  assert.deepEqual(newIds.sort(), shaftUsers.map((r) => r.id).sort(), '新增 unresolved 须恰为引用该竖井的路由（无牵连）');

  // (5b) DXF：同一求解失败进装配 errors，该路由折线不进图。
  const dxfSources = {
    electrical: [
      { id: 'panel_strong_entry_left', room: 'living_dining', type: 'strong_panel', absolute: true, x: 10.8, z: 2.98, height: 1.65 },
      { id: 'sock_living_sofa_l', room: 'living_dining', type: 'floor_socket', absolute: true, x: 11.0, z: 6.05, height: 0.02 },
    ],
    plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [],
  } as any;
  const dxfLayers = Object.fromEntries(['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air'].map((id) => [id, { label: id, color: '#fff', height: 2.55 }]));
  const dxfCoord = {
    version: 'test', status: 'test', layers: dxfLayers, junctions: [],
    routes: [{
      id: ROUTE_L, layer: 'strong_power', status: 'inferred', source_status: 'proposed', construction_status: 'pending',
      method: 'floor_branch_candidate', diameter: 0.02, from_height: 1.65, to_height: 0.02,
      from: 'panel_strong_entry_left', to: 'sock_living_sofa_l',
      via: [
        { kind: 'from_face_jog', shaft: 'shaft_entry' },
        { kind: 'from_drop', shaft: 'shaft_entry' },
        { kind: 'shaft_run', shaft: 'shaft_entry' },
      ],
    }],
    shafts: [],
  } as unknown as MepCoordination;
  const brokenDxf = buildProjectDxf({ house: { furnishings: {}, sceneElements: [] }, mep: { coordination: dxfCoord, sources: dxfSources } });
  assert.ok(brokenDxf.errors.some((e) => e.includes(ROUTE_L)), 'DXF errors 须点名失败路由');
  // 竖井轴 x 的毫米坐标由 R-S3 裁定值派生（10.74 × 1000），不钉手写字面量。
  const shaftXmm = String(Math.round(RULED_SHAFT.x * 1000));
  assert.ok(!brokenDxf.dxf.includes(shaftXmm), 'DXF 不得出失败路由的折线（竖井轴 x 的毫米坐标不得出现）');
  // 健康对照：竖井在表时同一通道出图、errors 为空、折线在图内。
  const healthyCoord = JSON.parse(JSON.stringify(dxfCoord)) as MepCoordination;
  healthyCoord.shafts = [{ ...RULED_SHAFT }];
  const healthyDxf = buildProjectDxf({ house: { furnishings: {}, sceneElements: [] }, mep: { coordination: healthyCoord, sources: dxfSources } });
  assert.deepEqual(healthyDxf.errors, [], '健康竖井时 DXF 须无 errors');
  assert.ok(healthyDxf.dxf.includes(shaftXmm), '健康竖井时 DXF 须含竖井轴折线');
});
