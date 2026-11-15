/**
 * Issue #98 MEP batch 2（强电干线切片）：10 条强电干线路由关系化。
 *
 * 真实 YAML + 内存改动；实验后不写盘。OLD_VIA 为 merge-base（origin/master
 * 211831e8，PR #233 已合）上 10 条路由的旧绝对 via 逐字转录（本文件即等价证明
 * 的旧几何基准——转录错误会使 C1 失败，而非静默通过；转录来源见 git show
 * origin/master:config/mep-hvac-coordination.yaml）。新几何与旧几何比较前先
 * dedup + stripCollinear（共线冗余点删除只改点列、不改折线段），容差 0.005m。
 * 覆盖：C1 迁移前后逐点等价、C2a–d 传动（改一处声明）、C3 算量等价、
 * C4 反例 fail-closed（机制 + 真实配置）。
 * lint / 3D / DXF / verify 由全套件 + verify:all + 导出脚本覆盖（见 PR 描述）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  MepCoordinationSchema,
  endpointSourcesFromFacts,
  isMepViaCoordinate,
  parseMepCoordination,
  resolveMepRoutes,
  resolveMepViaSteps,
  validateMepCoordination,
  type MepCoordination,
  type MepEndpointSources,
  type MepRoute,
} from '../../shared/mep-hvac-coordination-schema.js';
import { lintMepCoordination } from '../../shared/mep-hvac-lint.js';
import { computeMepTakeoff, type MepTakeoffRules, type TakeoffCircuit } from '../../shared/mep-takeoff.js';
import { buildProjectDxf } from '../../shared/dxf/project-dxf.js';
import { pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveFurniturePlacements } from '../../shared/furniture-placement.js';
import { resolvePointPlacementInWalls } from '../../shared/point-placement.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingsYaml, VertexLayoutYaml } from '../../shared/types.js';

const TOL = 0.005;
const SLICE_IDS = [
  'strong-main',
  'strong-ac-living',
  'strong-ac-dining',
  'strong-ac-master',
  'strong-ac-parent',
  'strong-ac-child',
  'strong-ac-study',
  'strong-ac-outdoor',
  'strong-power-weakbox',
  'strong-power-living-table',
] as const;
type SliceId = (typeof SLICE_IDS)[number];
/** 引用走廊轴的 8 条路由（table / weakbox 走竖井拓扑，不引用 axes 表）。 */
const AXIS_IDS = [
  'strong-main',
  'strong-ac-living',
  'strong-ac-dining',
  'strong-ac-master',
  'strong-ac-parent',
  'strong-ac-child',
  'strong-ac-study',
  'strong-ac-outdoor',
] as const;
/** 走廊轴裁定值（本文件头注 + ceiling_living 边吊内轴线，独立期望——axes 表值误改
 *  时 C1 即失败；C2a 再证改值全跟随）。 */
const CORRIDOR_AXIS = { id: 'corridor_axis', axis: 'z' as const, value: 4.6 };

/**
 * 旧绝对 via（origin/master 逐字转录，y 如旧几何；from/to 端点与 from_height/
 * to_height 从当前配置推导，不钉历史坐标——端点若被改动，C1 即按新端点比对，
 * 不会把旧端点当正确值）。
 */
const OLD_VIA: Record<SliceId, Array<{ x: number; z: number; y: number }>> = {
  'strong-main': [
    { x: 10.8, z: 2.98, y: 2.55 },
    { x: 10.8, z: 4.6, y: 2.55 },
    { x: 7.35, z: 4.6, y: 2.55 },
    { x: 7.2, z: 4.6, y: 2.55 },
  ],
  'strong-ac-living': [
    { x: 7.2, z: 4.6, y: 2.55 },
    { x: 10.0, z: 4.6, y: 2.55 },
  ],
  'strong-ac-dining': [
    { x: 7.2, z: 4.6, y: 2.55 },
    { x: 8.0, z: 4.6, y: 2.55 },
  ],
  'strong-ac-master': [
    { x: 7.2, z: 4.6, y: 2.55 },
    { x: 4.6, z: 4.6, y: 2.55 },
    { x: 4.05, z: 4.6, y: 2.55 },
  ],
  'strong-ac-parent': [
    { x: 7.2, z: 4.6, y: 2.55 },
    { x: 5.5, z: 4.6, y: 2.55 },
    { x: 5.5, z: 5.45, y: 2.55 },
    { x: 5.5, z: 6.2, y: 2.55 },
  ],
  'strong-ac-child': [
    { x: 7.2, z: 4.6, y: 2.55 },
    { x: 4.35, z: 4.6, y: 2.55 },
    { x: 4.35, z: 4.35, y: 2.55 },
    { x: 4.35, z: 4.0, y: 2.55 },
  ],
  'strong-ac-study': [
    { x: 7.2, z: 4.6, y: 2.55 },
    { x: 12.71, z: 4.6, y: 2.55 },
    { x: 12.71, z: 5.55, y: 2.55 },
    { x: 13.4, z: 5.55, y: 2.55 },
    { x: 13.4, z: 5.9, y: 2.55 },
    { x: 13.6, z: 5.9, y: 2.55 },
    { x: 14.8, z: 5.9, y: 2.55 },
  ],
  'strong-ac-outdoor': [
    { x: 10.8, z: 2.98, y: 2.55 },
    { x: 10.8, z: 4.6, y: 2.55 },
    { x: 7.45, z: 4.6, y: 2.55 },
    { x: 7.45, z: 3.0, y: 2.55 },
    { x: 7.45, z: 3.0, y: 2.7 },
    { x: 7.45, z: 0.5, y: 2.7 },
    { x: 7.2, z: 0.5, y: 2.7 },
  ],
  'strong-power-weakbox': [
    { x: 10.74, z: 2.98, y: 1.65 },
    { x: 10.74, z: 2.98, y: 0.45 },
    { x: 10.8, z: 2.98, y: 0.45 },
    { x: 10.8, z: 3.23, y: 0.45 },
  ],
  'strong-power-living-table': [
    { x: 10.74, z: 2.98, y: 1.65 },
    { x: 10.74, z: 2.98, y: 0.02 },
    { x: 10.74, z: 3.45, y: 0.02 },
    { x: 9.8, z: 3.45, y: 0.02 },
  ],
};

const EXPECTED_KINDS: Record<SliceId, string[]> = {
  'strong-main': ['axis_jog', 'axis_run'],
  'strong-ac-living': ['axis_jog', 'axis_run'],
  'strong-ac-dining': ['axis_jog', 'axis_run'],
  'strong-ac-master': ['axis_jog', 'axis_run'],
  'strong-ac-parent': ['axis_jog', 'axis_run', 'axis_run'],
  'strong-ac-child': ['axis_jog', 'axis_run', 'axis_run'],
  'strong-ac-study': ['axis_jog', 'axis_run', 'axis_run', 'axis_run', 'axis_run', 'axis_run'],
  'strong-ac-outdoor': ['axis_jog', 'axis_run', 'axis_run', 'level', 'axis_run', 'axis_run'],
  'strong-power-weakbox': ['from_face_jog', 'level', 'axis_run', 'axis_run'],
  'strong-power-living-table': ['from_face_jog', 'from_drop', 'shaft_run'],
};

/** 红线路由 strong-ded-bathheaters-mbath 的旧绝对 via（本批不动，C1 钉住不动）。 */
const MBATH_VIA = [
  { x: 7.2, z: 4.6, y: 2.55 },
  { x: 4.1, z: 4.6, y: 2.55 },
  { x: 2.0, z: 4.6, y: 2.55 },
  { x: 2.0, z: 2.86, y: 2.7 },
  { x: 2.0, z: 2.7, y: 2.7 },
  { x: 1.3, z: 2.7, y: 2.7 },
];

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
function resolveChain(all: ReturnType<typeof loadAll>, furnishings: FurnishingsYaml, coordination?: MepCoordination) {
  const coord = coordination ?? all.coordination;
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
  const report = resolveMepRoutes(coord, sources);
  const takeoff = computeMepTakeoff({
    electrical: all.electrical as any,
    plumbing: all.plumbing as any,
    circuits: all.topology.circuits,
    controls: all.topology.controls ?? [],
    routes: coord.routes,
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
/**
 * 共线中间点剥离：中点与前后两点共线（叉积 ≈ 0）且严格位于两点之间时删中点——
 * 删除共线冗余点只改点列，不改折线段。重复剥离直至无共线点。
 */
function stripCollinear(points: ReadonlyArray<{ x: number; y?: number; z: number }>): Array<{ x: number; y?: number; z: number }> {
  let cur = points.map((p) => ({ ...p }));
  for (;;) {
    let removed = false;
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1];
      const b = cur[i];
      const c = cur[i + 1];
      const dx1 = b.x - a.x;
      const dz1 = b.z - a.z;
      const dy1 = (b.y ?? 0) - (a.y ?? 0);
      const dx2 = c.x - b.x;
      const dz2 = c.z - b.z;
      const dy2 = (c.y ?? 0) - (b.y ?? 0);
      const cross = Math.hypot(dy1 * dz2 - dz1 * dy2, dz1 * dx2 - dx1 * dz2, dx1 * dy2 - dy1 * dx2);
      const between =
        Math.min(a.x, c.x) - TOL <= b.x && b.x <= Math.max(a.x, c.x) + TOL &&
        Math.min(a.z, c.z) - TOL <= b.z && b.z <= Math.max(a.z, c.z) + TOL &&
        Math.min(a.y ?? 0, c.y ?? 0) - TOL <= (b.y ?? 0) && (b.y ?? 0) <= Math.max(a.y ?? 0, c.y ?? 0) + TOL;
      if (cross <= TOL && between) {
        cur.splice(i, 1);
        removed = true;
        break;
      }
    }
    if (!removed) return cur;
  }
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
/** 收集两棵 plain 对象的叶路径差异（证明只改了一处声明）。 */
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
function slicePoints(report: ReturnType<typeof resolveMepRoutes>, id: string) {
  return routeOf(report, id).points;
}

test('C1：10 条路由关系化——axes/shafts 各只声明一次，解算折线与旧绝对几何逐点等价', () => {
  const all = loadAll();
  const { report, takeoff } = resolveChain(all, all.furnishings);
  assert.deepEqual(report.diagnostics, [], '全量路由解算须无诊断');
  assert.doesNotThrow(() => validateMepCoordination(all.coordination, resolveChain(all, all.furnishings).sources), '迁移后 coordination 须通过 schema 校验');

  // 共享基准只声明一次，各路由共同引用。
  assert.equal(all.coordination.axes.length, 1, 'axes 表须只有一条轴线声明');
  assert.deepEqual(
    { id: all.coordination.axes[0].id, axis: all.coordination.axes[0].axis, value: all.coordination.axes[0].value },
    CORRIDOR_AXIS,
    '走廊轴须为裁定值 corridor_axis z=4.6（独立期望，表值误改即失败）',
  );
  assert.equal(all.coordination.shafts.length, 1, 'shafts 表须只有一口竖井声明');
  assert.equal(all.coordination.shafts[0].id, 'shaft_entry');

  // 切片计数：strong_power 69 条，关系型 12 条（本批 10 + sofa-l/r），剩余绝对 57 条。
  const strong = all.coordination.routes.filter((r) => r.layer === 'strong_power');
  assert.equal(strong.length, 69, 'strong_power 须为 69 条');
  const relational = strong.filter((r) => r.via.some((s: any) => typeof s === 'object' && 'kind' in s));
  assert.equal(relational.length, 12, '关系型须为 12 条（本批 10 + sofa-l/r）');
  assert.equal(strong.length - relational.length, 57, '剩余绝对须为 57 条（后续切片）');

  for (const id of SLICE_IDS) {
    const route = all.coordination.routes.find((r) => r.id === id)!;
    assert.deepEqual(route.via.map((s: any) => s.kind), EXPECTED_KINDS[id], `${id} via 步型须为预期序列`);
    // 非 level 步不得声明 y（高度取标高游标）；level 的 y 是本步竖向目标。
    for (const step of route.via as any[]) {
      if (step.kind === 'level') assert.ok(Number.isFinite(step.y), `${id} level 须声明有限数 y`);
      else assert.equal(step.y, undefined, `${id} ${step.kind} 不得声明 y`);
    }
    assert.equal(route.construction_status, 'pending', `${id} 施工状态须留 pending`);
    assert.equal(route.status, 'inferred', `${id} 状态须为 inferred`);
    assert.equal(route.source_status, 'proposed', `${id} 来源状态须为 proposed`);
    assert.ok((route.reason ?? '').includes('2026-11-15 #98 MEP batch 2'), `${id} reason 须记 batch 2 迁移说明`);
  }
  // outdoor / weakbox 的 level 目标值。
  const outdoor = all.coordination.routes.find((r) => r.id === 'strong-ac-outdoor')!;
  assert.equal((outdoor.via as any[])[3].y, 2.7, 'outdoor 升位须为 2.70（不得改标高）');
  const weakbox = all.coordination.routes.find((r) => r.id === 'strong-power-weakbox')!;
  assert.equal((weakbox.via as any[])[1].y, 0.45, 'weakbox 下引须为 0.45');
  // sofa 两路由原样不动。
  for (const id of ['strong-power-living-sofa-l', 'strong-power-living-sofa-r']) {
    const route = all.coordination.routes.find((r) => r.id === id)!;
    assert.deepEqual(route.via.map((s: any) => s.kind), ['from_face_jog', 'from_drop', 'shaft_run'], `${id} 须仍为三步`);
  }
  // 红线路由原样不动：绝对 via 逐字等于 master。
  const mbath = all.coordination.routes.find((r) => r.id === 'strong-ded-bathheaters-mbath')!;
  assert.deepEqual(mbath.via, MBATH_VIA, 'mbath 须仍为旧绝对 via（本批不碰）');

  // 逐路由逐点等价：新折线 vs 旧绝对几何（dedup + stripCollinear 后逐点比对 + 长度相等）。
  for (const id of SLICE_IDS) {
    const r = routeOf(report, id);
    assert.deepEqual(r.unresolved, [], `${id} 须解出`);
    assert.deepEqual(r.diagnostics, [], `${id} 须无诊断`);
    const from = r.from!;
    const to = r.to!;
    const fromHeight = r.route.from_height!;
    const toHeight = r.route.to_height;
    const expectedOld = [
      { ...from, y: fromHeight },
      ...OLD_VIA[id].map((p) => ({ ...p })),
      { ...to, y: toHeight ?? to.y },
    ];
    const expected = stripCollinear(dedup(expectedOld));
    const actual = stripCollinear(dedup(r.points));
    assert.equal(actual.length, expected.length, `${id} 折线点数须与旧几何去重/去共线后一致`);
    actual.forEach((p, i) => assertPointClose(p, expected[i], `${id} 第 ${i} 点`));
    assert.equal(dedup(r.points).length, r.points.length, `${id} 不得含连续重复点`);
    assertOrthogonal(r.points, id);
    assert.ok(Math.abs(planLength(r.points) - planLength(expected)) <= TOL, `${id} 平面长度须与旧几何相等`);
    assert.ok(Math.abs(length3d(r.points) - length3d(expected)) <= TOL, `${id} 三维长度须与旧几何相等`);
    assert.ok(!takeoff.unresolved.some((u) => u.id === id), `算量 unresolved 不得含 ${id}`);
  }
});

test('C2a：走廊轴值 4.6→4.7——只改一处声明，8 条轴路由跟随，table/weakbox/sofa 不动', () => {
  const all = loadAll();
  const before = resolveChain(all, all.furnishings);
  const moved = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  moved.axes[0].value = 4.7;
  assert.deepEqual(leafDiffPaths(all.coordination, moved), ['axes.0.value'], '实验只能改动一处声明');
  const after = resolveChain(all, all.furnishings, moved);
  for (const id of AXIS_IDS) {
    const rb = routeOf(before.report, id);
    const ra = routeOf(after.report, id);
    assert.deepEqual(ra.unresolved, [], `${id} 改轴后须仍解出`);
    // 端点不动（from/to 跟随端点声明，不跟随轴线）；轴上中间点 z 须由 4.6 变 4.7，x 与 y 不变。
    assert.deepEqual([ra.points[0], ra.points[ra.points.length - 1]], [rb.points[0], rb.points[rb.points.length - 1]], `${id} 端点不得移动`);
    rb.points.slice(1, -1).forEach((p, i) => {
      const q = ra.points[i + 1];
      assert.ok(Math.abs(q.x - p.x) <= TOL && Math.abs((q.y ?? 0) - (p.y ?? 0)) <= TOL, `${id} 第 ${i + 1} 点 x/y 不得移动`);
      if (Math.abs(p.z - 4.6) <= TOL) assert.ok(Math.abs(q.z - 4.7) <= TOL, `${id} 第 ${i + 1} 点 z 须跟随到 4.7`);
      else assert.ok(Math.abs(q.z - p.z) <= TOL, `${id} 第 ${i + 1} 点 z 不得移动`);
    });
  }
  // 不引用轴线的路由逐字节相同。
  for (const id of ['strong-power-weakbox', 'strong-power-living-table', 'strong-power-living-sofa-l', 'strong-power-living-sofa-r']) {
    assert.deepEqual(slicePoints(after.report, id), slicePoints(before.report, id), `${id} 不得移动`);
  }
});

test('C2b：客厅空调插座 x +0.30m——living 跟随，dining 不动', () => {
  const all = loadAll();
  const before = resolveChain(all, all.furnishings);
  const movedElectrical = JSON.parse(JSON.stringify(all.electrical)) as any[];
  const sock = movedElectrical.find((p) => p.id === 'sock_living_ac')!;
  // sock_living_ac 为绝对点位（absolute: true，x/z 直声明）：沿 x 改 0.30m 即改 x。
  assert.ok(sock.absolute === true && typeof sock.x === 'number', '实验前置：sock_living_ac 须为绝对点位');
  sock.x = sock.x + 0.30;
  const changed = leafDiffPaths(all.electrical, movedElectrical);
  assert.equal(changed.length, 1, '实验只能改动一处声明');
  assert.ok(changed[0].endsWith('.x'), `改动须为 x 字段，实为 ${changed[0]}`);
  const movedAll = { ...all, electrical: movedElectrical };
  const after = resolveChain(movedAll, all.furnishings);
  const rb = routeOf(before.report, 'strong-ac-living');
  const ra = routeOf(after.report, 'strong-ac-living');
  assert.deepEqual(ra.unresolved, [], 'living 改端点后须仍解出');
  const beforeTo = rb.points[rb.points.length - 1];
  const afterTo = ra.points[ra.points.length - 1];
  assert.ok(Math.abs((afterTo.x - beforeTo.x) - 0.30) <= TOL, 'living 末点 x 须东移 0.30m');
  assert.ok(Math.abs(afterTo.z - beforeTo.z) <= TOL, 'living 末点 z 不得移动');
  // 轴上拐点跟随：axis_run 落点 x 亦 +0.30。
  assert.ok(Math.abs((ra.points[2].x - rb.points[2].x) - 0.30) <= TOL, 'living axis_run 落点 x 须东移 0.30m');
  assert.deepEqual(slicePoints(after.report, 'strong-ac-dining'), slicePoints(before.report, 'strong-ac-dining'), 'dining 不得移动');
});

test('C2c：parent 分支 x 5.5→5.6——只改一处声明，parent 南行腿跟随，child 不动', () => {
  const all = loadAll();
  const before = resolveChain(all, all.furnishings);
  const moved = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  const idx = moved.routes.findIndex((r) => r.id === 'strong-ac-parent');
  (moved.routes[idx].via as any[])[1].to = 5.6;
  assert.deepEqual(leafDiffPaths(all.coordination, moved), [`routes.${idx}.via.1.to`], '实验只能改动一处声明');
  const after = resolveChain(all, all.furnishings, moved);
  const rb = routeOf(before.report, 'strong-ac-parent');
  const ra = routeOf(after.report, 'strong-ac-parent');
  assert.deepEqual(ra.unresolved, [], 'parent 改分支后须仍解出');
  // 南行腿两点 x 须由 5.5 变 5.6，其余点不动。
  rb.points.forEach((p, i) => {
    const q = ra.points[i];
    if (Math.abs(p.x - 5.5) <= TOL) assert.ok(Math.abs(q.x - 5.6) <= TOL, `parent 第 ${i} 点 x 须跟随到 5.6`);
    else assert.ok(Math.abs(q.x - p.x) <= TOL && Math.abs(q.z - p.z) <= TOL, `parent 第 ${i} 点不得移动`);
  });
  assert.deepEqual(slicePoints(after.report, 'strong-ac-child'), slicePoints(before.report, 'strong-ac-child'), 'child 不得移动');
});

test('C2d：outdoor 升位 y 2.7→2.75——只改一处声明，2.70 腿跟随，2.55 腿不动', () => {
  const all = loadAll();
  const before = resolveChain(all, all.furnishings);
  const moved = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  const idx = moved.routes.findIndex((r) => r.id === 'strong-ac-outdoor');
  (moved.routes[idx].via as any[])[3].y = 2.75;
  assert.deepEqual(leafDiffPaths(all.coordination, moved), [`routes.${idx}.via.3.y`], '实验只能改动一处声明');
  const after = resolveChain(all, all.furnishings, moved);
  const rb = routeOf(before.report, 'strong-ac-outdoor');
  const ra = routeOf(after.report, 'strong-ac-outdoor');
  assert.deepEqual(ra.unresolved, [], 'outdoor 改升位后须仍解出');
  // 升位点及之后 2.70 腿的点 y 须变 2.75；升位之前的 2.55 腿不动；末点 y 取 to_height 1.6，不跟随。
  rb.points.forEach((p, i) => {
    const q = ra.points[i];
    assert.ok(Math.abs(q.x - p.x) <= TOL && Math.abs(q.z - p.z) <= TOL, `outdoor 第 ${i} 点平面不得移动`);
    if (i >= 4 && i <= 6) assert.ok(Math.abs((q.y ?? 0) - 2.75) <= TOL, `outdoor 第 ${i} 点 y 须跟随到 2.75`);
    else assert.ok(Math.abs((q.y ?? 0) - (p.y ?? 0)) <= TOL, `outdoor 第 ${i} 点 y 不得移动`);
  });
});

test('C3：算量等价——旧绝对 via 与新关系 via 的 takeoff 关键输出一致', () => {
  const all = loadAll();
  const migrated = resolveChain(all, all.furnishings);
  // 旧几何由 OLD_VIA 转录还原（与 C1 同基准）：把 10 条路由 via 换回绝对坐标，其余一字不动。
  const oldCoord = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  for (const id of SLICE_IDS) {
    const route = oldCoord.routes.find((x) => x.id === id)!;
    route.via = OLD_VIA[id].map((p) => ({ ...p })) as any;
  }
  const oldReport = resolveMepRoutes(oldCoord, migrated.sources);
  assert.deepEqual(oldReport.diagnostics, [], '旧绝对几何须解出（对照组）');
  const oldTakeoff = computeMepTakeoff({
    electrical: all.electrical as any,
    plumbing: all.plumbing as any,
    circuits: all.topology.circuits,
    controls: all.topology.controls ?? [],
    routes: oldCoord.routes,
    resolution: oldReport,
    rules: all.rules,
  });
  assert.equal(oldTakeoff.conduit.strongPowerM, migrated.takeoff.conduit.strongPowerM, '强电层总长须与旧几何一致');
  assert.equal(oldTakeoff.conduit.drawnRouteUnionM, migrated.takeoff.conduit.drawnRouteUnionM, '画线并集总长须与旧几何一致');
  assert.equal(oldTakeoff.coverage.byRoom.living_dining?.drawnRouteM, migrated.takeoff.coverage.byRoom.living_dining?.drawnRouteM, '客餐厅画线长须与旧几何一致');
  assert.deepEqual(oldTakeoff.unresolved, migrated.takeoff.unresolved, '算量 unresolved 清单须与旧几何一致');
  assert.equal(oldTakeoff.feasibleForQuote, migrated.takeoff.feasibleForQuote, '可报价标志须与旧几何一致');
});

/** 合成反例用的最小 coordination（与 mep-slope-run.test.ts 同口径）。 */
const axisLayers = Object.fromEntries(
  ['strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant', 'condensate', 'supply_air', 'return_air']
    .map((id) => [id, { label: id, color: '#fff', height: 2.5 }]),
) as MepCoordination['layers'];
const emptySources: MepEndpointSources = { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] };
const AXIS_TABLE = [{ id: 'corridor_axis', axis: 'z' as const, value: 4.6 }];
function axisRoute(id: string, via: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, layer: 'strong_power', status: 'inferred', source_status: 'proposed',
    construction_status: 'pending', method: 'conduit',
    diameter: 0.025,
    from_height: 2.55,
    from: { x: 10.8, z: 2.98 }, to: { x: 7.2, z: 4.3 }, via,
    ...extra,
  };
}
function axisConfig(routes: Array<Record<string, unknown>>, axes: unknown = AXIS_TABLE): MepCoordination {
  return MepCoordinationSchema.parse({ version: '1', status: 'preliminary', layers: axisLayers, routes, junctions: [], shafts: [], axes });
}
const AXIS_VIA = [
  { kind: 'axis_jog', axis: 'corridor_axis' },
  { kind: 'axis_run', axis: 'corridor_axis', to: 'to' },
];
const OUTDOOR_VIA = [
  { kind: 'axis_jog', axis: 'corridor_axis' },
  { kind: 'axis_run', axis: 'corridor_axis', to: 7.45 },
  { kind: 'axis_run', axis: 'z', to: 3.0 },
  { kind: 'level', y: 2.7 },
  { kind: 'axis_run', axis: 'z', to: 'to' },
  { kind: 'axis_run', axis: 'x', to: 'to' },
];

test('C4a：合成反例——断引用/越权字段/零行程/离轴/缺 y 一律 fail-closed（红/绿）', () => {
  const from = { x: 10.8, z: 2.98, y: 2.55 };
  const to = { x: 7.2, z: 4.3, y: 2.55 };
  const failClosed = (route: MepRoute, pattern: RegExp, axes: MepCoordination['axes'] = AXIS_TABLE) => {
    const red = resolveMepViaSteps(route, from, to, [], axes);
    assert.deepEqual(red.points, [], `${route.id} 反例不得出半条几何`);
    assert.match(red.diagnostic ?? '', pattern, `${route.id} 诊断须点名原因`);
  };
  // 断引用：未知轴线（schema 不查存在性，validate 与求解器入口双重拦）。
  const unknown = axisConfig([axisRoute('syn-unknown', AXIS_VIA)], [{ id: 'other_axis', axis: 'z', value: 4.6 }]);
  failClosed(unknown.routes[0], /引用未知轴线 "corridor_axis"/, unknown.axes);
  assert.throws(() => validateMepCoordination(unknown, emptySources), /引用未知轴线 "corridor_axis"/);
  const green = resolveMepRoutes(axisConfig([axisRoute('syn-ok', AXIS_VIA)]), emptySources);
  assert.equal(green.unresolved, 0, '对照组须解出');
  // 越权字段：axis_jog 声明 y / shaft（schema 拒绝 + 求解器入口拒绝）。
  assert.throws(() => axisConfig([axisRoute('syn-y', [{ kind: 'axis_jog', axis: 'corridor_axis', y: 2.55 }, AXIS_VIA[1]])]), /axis_jog 不得声明 y/);
  failClosed(axisRoute('syn-y', [{ kind: 'axis_jog', axis: 'corridor_axis', y: 2.55 }, AXIS_VIA[1]]) as MepRoute, /不得声明 y/);
  assert.throws(() => axisConfig([axisRoute('syn-shaft', [{ kind: 'axis_jog', axis: 'corridor_axis', shaft: 'shaft_entry' }, AXIS_VIA[1]])]), /axis_jog 不引用竖井/);
  failClosed(axisRoute('syn-shaft', [{ kind: 'axis_jog', axis: 'corridor_axis', shaft: 'shaft_entry' }, AXIS_VIA[1]]) as MepRoute, /不得声明 shaft/);
  // 离轴 axis_run（缺 axis_jog）：不静默沿错误线位跑。
  failClosed(axisRoute('syn-offaxis', [AXIS_VIA[1]]) as MepRoute, /不在轴线 "corridor_axis" 上/);
  // 零行程：axis_jog 已在轴上；axis_run 目标即当前点；axis_run 目标即当前点。
  const onAxis = resolveMepViaSteps(axisRoute('syn-zero-entry', AXIS_VIA) as MepRoute, { x: 10.8, z: 4.6, y: 2.55 }, to, [], AXIS_TABLE);
  assert.deepEqual(onAxis.points, []);
  assert.match(onAxis.diagnostic ?? '', /axis_jog 零行程/);
  failClosed(axisRoute('syn-zero-run', [{ kind: 'axis_jog', axis: 'corridor_axis' }, { kind: 'axis_run', axis: 'corridor_axis', to: 10.8 }]) as MepRoute, /axis_run 零行程/);
  failClosed(axisRoute('syn-zero-runto', [{ kind: 'axis_jog', axis: 'corridor_axis' }, { kind: 'axis_run', axis: 'corridor_axis', to: 7.2 }, { kind: 'axis_run', axis: 'z', to: 4.6 }]) as MepRoute, /axis_run 零行程/);
  // 缺 to 的 axis_run（schema 拒绝 + 求解器入口拒绝）。
  assert.throws(() => axisConfig([axisRoute('syn-noto', [AXIS_VIA[0], { kind: 'axis_run', axis: 'corridor_axis' }])]), /axis_run 必须声明 to/);
  failClosed(axisRoute('syn-noto', [AXIS_VIA[0], { kind: 'axis_run', axis: 'corridor_axis' }]) as MepRoute, /缺少 to/);
  // axis_run 缺 axis / 缺 to / 带 shaft（schema 拒绝）；axis_jog 的 axis 不得为方向
  // （统一协议后 axis 单字段重载：方向与轴线 id 不能同存一字段，旧“axis_run 带 axis_id”
  // 越权情形已无写法，本行改为 axis_jog 取方向的拒绝用例）。
  assert.throws(() => axisConfig([axisRoute('syn-noaxis', [{ kind: 'axis_run', to: 5.5 }])]), /axis_run 必须声明 axis/);
  assert.throws(() => axisConfig([axisRoute('syn-noto2', [{ kind: 'axis_run', axis: 'z' }])]), /axis_run 必须声明 to/);
  assert.throws(() => axisConfig([axisRoute('syn-rshaft', [{ kind: 'axis_run', axis: 'z', to: 5.5, shaft: 'shaft_entry' }])]), /axis_run 不引用竖井/);
  assert.throws(() => axisConfig([axisRoute('syn-jogdir', [{ kind: 'axis_jog', axis: 'z' }, AXIS_VIA[1]])]), /axis_jog 的 axis 须为轴线 id/);
  // 非轴线步声明轴线 id（schema 拒绝 + 求解器入口拒绝）：axis 为全步型共用可选字段，
  // 竖井步带 axis 会静默忽略——Codex major；竖井步以 shaft_run 为代表（四种共用
  // 同一 schema 分支与同一入口检查点）；slope_run 的 axis 须为方向，带轴线 id 同样拒绝。
  assert.throws(() => axisConfig([axisRoute('syn-shaftrun-axisid', [{ kind: 'shaft_run', shaft: 'shaft_entry', axis: 'corridor_axis' }])]), /shaft_run 不引用轴线表/);
  failClosed(axisRoute('syn-shaftrun-axisid', [{ kind: 'shaft_run', shaft: 'shaft_entry', axis: 'corridor_axis' }]) as MepRoute, /不引用轴线表/);
  assert.throws(() => axisConfig([axisRoute('syn-sloperun-axisid', [{ kind: 'slope_run', axis: 'corridor_axis', to: 5.0 }], { slope: 0.01 })]), /slope_run 的 axis 须为方向/);
  failClosed(axisRoute('syn-sloperun-axisid', [{ kind: 'slope_run', axis: 'corridor_axis', to: 5.0 }], { slope: 0.01 }) as MepRoute, /的 axis 须为方向/);
  // level 缺 y / 带 shaft / 零行程 / 非有限数 y（schema 拒绝 + 求解器入口拒绝）。
  assert.throws(() => axisConfig([axisRoute('syn-noy', [{ kind: 'level' }])]), /level 必须声明 y/);
  failClosed(axisRoute('syn-noy', [{ kind: 'level' }]) as MepRoute, /必须声明有限数 y/);
  assert.throws(() => axisConfig([axisRoute('syn-vshaft', [{ kind: 'level', y: 2.7, shaft: 'shaft_entry' }])]), /level 不引用竖井/);
  failClosed(axisRoute('syn-vzero', [{ kind: 'level', y: 2.55 }]) as MepRoute, /level 零行程/);
  failClosed(axisRoute('syn-vnan', [{ kind: 'level', y: Number.NaN }]) as MepRoute, /必须声明有限数 y/);
  // 缺 from_height：axis_jog 无起算标高。
  const noHeight = axisRoute('syn-noheight', AXIS_VIA, { from_height: undefined }) as MepRoute;
  delete (noHeight as Record<string, unknown>).from_height;
  const redHeight = resolveMepViaSteps(noHeight, { x: 10.8, z: 2.98 }, to, [], AXIS_TABLE);
  assert.deepEqual(redHeight.points, []);
  assert.match(redHeight.diagnostic ?? '', /缺少有效起算标高/);
  // 补回即恢复（红/绿）。
  const fixed = resolveMepRoutes(axisConfig([axisRoute('syn-ok2', AXIS_VIA)]), emptySources);
  assert.equal(fixed.unresolved, 0, '补回后须解出');
});

test('C4b：真实配置反例——axes 表缺失时 8 条轴路由 unresolved、其余 133 条照常解出', () => {
  const all = loadAll();
  const before = resolveChain(all, all.furnishings);
  assert.deepEqual(before.report.diagnostics, [], '基线须无诊断');
  const broken = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  broken.axes = [];
  const after = resolveChain(all, all.furnishings, broken);
  const unresolvedIds = after.report.routes.filter((r) => r.unresolved.length > 0).map((r) => r.route.id).sort();
  assert.deepEqual(unresolvedIds, [...AXIS_IDS].sort(), '恰好 8 条轴路由 unresolved');
  for (const id of AXIS_IDS) {
    const r = routeOf(after.report, id);
    assert.deepEqual(r.unresolved, ['via'], `${id} unresolved 须为 via`);
    assert.deepEqual(r.points, [], `${id} 不得出半条几何`);
    assert.ok(r.diagnostics.some((d) => d.includes('corridor_axis')), `${id} 诊断须点名 corridor_axis`);
  }
  assert.equal(after.report.resolved, before.report.total - 8, '其余路由须照常解出');
  // lint：8 条各报一条 endpoint_unresolved error。
  const lint = lintMepCoordination(broken, before.sources);
  const endpointErrors = lint.errors.filter((e) => e.code === 'endpoint_unresolved');
  assert.equal(endpointErrors.length, 8, 'lint 须报 8 条 endpoint_unresolved');
  assert.deepEqual(endpointErrors.map((e) => e.routeId).sort(), [...AXIS_IDS].sort());
  assert.ok(endpointErrors.every((e) => e.message.includes('corridor_axis')), 'lint 诊断须点名 corridor_axis');
  // takeoff：broken 的新 unresolved 恰好为 8 条（kind error）。
  const brokenUnresolved = after.takeoff.unresolved.filter((u) => u.kind === 'error').map((u) => u.id).sort();
  const healthyUnresolved = before.takeoff.unresolved.filter((u) => u.kind === 'error').map((u) => u.id).sort();
  assert.deepEqual(brokenUnresolved.filter((id) => !healthyUnresolved.includes(id)), [...AXIS_IDS].sort(), 'takeoff 新增 error unresolved 恰好为 8 条轴路由');
  // DXF：errors 点名 broken 路由且不含其几何；健康 DXF 无 errors 且含切片路由。
  // labels:'ascii'（utf8 模式写 route.label 中文名，id 只作 fallback；ascii 模式显式用 id）。
  const dxfInput = (coord: MepCoordination) => ({
    house: { rooms: [], furnishings: {}, electrical: [], ceilingZones: [], sceneElements: [] },
    mep: { coordination: coord, sources: before.sources },
    labels: 'ascii' as const,
  });
  const brokenDxf = buildProjectDxf(dxfInput(broken) as any);
  assert.equal(brokenDxf.errors.length, 8, 'DXF 须报 8 条路由错误');
  for (const id of AXIS_IDS) {
    assert.ok(brokenDxf.errors.some((e) => e.includes(id)), `DXF 错误须点名 ${id}`);
    assert.ok(!brokenDxf.dxf.includes(id), `DXF 不得含 broken 路由 ${id} 的几何`);
  }
  const healthyDxf = buildProjectDxf(dxfInput(all.coordination) as any);
  assert.deepEqual(healthyDxf.errors, [], '健康 DXF 须无 errors');
  for (const id of SLICE_IDS) assert.ok(healthyDxf.dxf.includes(id), `健康 DXF 须含 ${id}`);
});

test('C4c：真实配置反例——outdoor level 删 y 时整条 unresolved，schema 即拒绝', () => {
  const all = loadAll();
  const broken = JSON.parse(JSON.stringify(all.coordination)) as MepCoordination;
  const idx = broken.routes.findIndex((r) => r.id === 'strong-ac-outdoor');
  delete ((broken.routes[idx].via as any[])[3] as Record<string, unknown>).y;
  assert.throws(() => MepCoordinationSchema.parse(JSON.parse(JSON.stringify(broken))), /level 必须声明 y/);
  // 绕过 schema 直接解算：同样 fail-closed。
  const before = resolveChain(all, all.furnishings);
  const after = resolveChain(all, all.furnishings, broken as MepCoordination);
  const r = routeOf(after.report, 'strong-ac-outdoor');
  assert.deepEqual(r.unresolved, ['via']);
  assert.deepEqual(r.points, []);
  assert.ok(r.diagnostics.some((d) => d.includes('level') && d.includes('y')), '诊断须点名 level 缺 y');
  assert.deepEqual(slicePoints(after.report, 'strong-ac-living'), slicePoints(before.report, 'strong-ac-living'), 'living 不得受影响');
});
