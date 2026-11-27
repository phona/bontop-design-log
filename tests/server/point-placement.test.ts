/**
 * 点位定位单一解算（issue #98 第四阶段 S1/S2/S3，设计文档 §4.3/§4.4/§4.8）。
 *
 * S1/S2 迁移期本文件把「x/z 暂留为断言字段」固化成门禁（解析结果与声明值差 >0.005m 即
 * fail），79 个沿墙点位 + 2 个柜面挂载点位逐点全绿；**S3（2026-11-07）已删这 81 个点位
 * 的 x/z 声明与断言字段本身**——along/face_offset/mount 是唯一解算输入，解析结果不再有
 * 第二份坐标可比对。删除的具体内容（决策铁律第 5 条逐条列）：
 *   - `keeps the migrated along/face_offset in agreement with the declared x/z`（沿墙/挂载
 *     点位 ↔ 声明 x/z 的逐点断言，含 ASSERT_TOLERANCE 与 checked=79 / mounted=2 计数）——
 *     其防的「写错 along 手滑漂移」改由 verify-point-placement（投影/洞口/越界 error）、
 *     verify-rules（bounds/proximity 用解析后坐标）与 mep/电气 lint 的端点校验承接；
 *   - `keeps MEP endpoints on the resolver basis` 里对声明 x/z 的逐点比对（MEP 端点漂移断言）。
 *
 * 保留并继续锁死的：along 起算口径、face_offset 基准、越界 fail-closed、四来源互斥、
 * 绝对点位取声明值、3D/DXF 薄板惯例同源、mount 宿主脸解算。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { resolveLayout } from '../../server/layout-resolver.js';
import { parseElectricalPoints, parseElectricalTopology, parsePlumbingPoints, PlumbingPointSchema } from '../../shared/project-render-facts-schema.js';
import {
  pointPlacementIndex,
  pointWallIndexFromElements,
  resolvePointPlacement,
  resolvePointPlacementInWalls,
  THIN_PLATE_FACE_OFFSET,
  type PointMountHost,
  type PointPlacementInput,
  type PointWall,
  type PointWallSegment,
} from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { WALL_THICKNESS } from '../../shared/furniture-placement.js';
import type { PlacementItem } from '../../shared/furniture-placement.js';
import type { ElectricalPoint, PlumbingPoint, VertexLayoutYaml } from '../../shared/types.js';

const layout = resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf-8')) as VertexLayoutYaml);
const electrical = parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf-8'));
const plumbing = parsePlumbingPoints(readFileSync('config/plumbing.yaml', 'utf-8'));
const pointWalls = pointWallIndexFromElements(layout.walls);
// mount 宿主索引（issue #98 S2）：与生产入口（DXF/MEP/lighting-fixtures/server loader）同一构造。
// 二阶段 S1 起须走 buildPlacementIndexes 统一解算：anchor 家具无手写 x/z，直读 x/z 的
// pointMountHostIndex 会把它静默排除，锚定点位随即断引用。
const house = parseYaml(readFileSync('config/house.yaml', 'utf-8')) as { furnishings?: Record<string, PlacementItem[]> };
const { mountHosts } = buildPlacementIndexes({
  geometry: { walls: layout.walls },
  furnishings: house.furnishings ?? {},
});
// 电气拓扑（issue #98 S3）：回路图/归属层的输入——成员、面板源点位、控制开关三类点位。
const topology = parseElectricalTopology(readFileSync('config/electrical-topology.yaml', 'utf-8'), electrical);

describe('point placement resolver (issue #98 S1/S2/S3)', () => {
  it('resolves along from the wall start vertex along the polyline (same origin as furniture placement)', () => {
    const wall: PointWall = { segments: [{ x1: 2, z1: -1, x2: 2, z2: 3 }], line_datum: 'centerline' };
    const walls = new Map<string, PointWall>([['wall', wall]]);
    // 起算点 = 墙段起点顶点 (2,-1)：along=1.5 → (2, 0.5)
    const { placement } = resolvePointPlacementInWalls({ id: 'p', wall: 'wall', wall_side: 'west', along: 1.5 }, walls);
    assert.ok(placement && placement.kind === 'wall');
    assert.equal(placement.datum.x, 2);
    assert.equal(placement.datum.z, 0.5);
    // 完成面 = 中心线 ± WALL_THICKNESS/2（口径 A = 0.06），朝西
    assert.ok(Math.abs(placement.x - (2 - 0.06)) < 1e-12);
    assert.equal(placement.z, 0.5);
  });

  it('offsets the resolved point by face_offset away from the finished face', () => {
    const walls = new Map<string, PointWall>([['wall', { segments: [{ x1: 0, z1: 0, x2: 10, z2: 0 }], line_datum: 'centerline' }]]);
    const { placement } = resolvePointPlacementInWalls({ id: 'p', wall: 'wall', wall_side: 'south', along: 5, face_offset: 0.04 }, walls);
    assert.ok(placement && placement.kind === 'wall');
    // 南脸 = +z：完成面 0.06（口径 A WALL_THICKNESS/2；S2 起不再叠加漆面渲染缝 0.008）+ face_offset 0.04
    // ——这正是「东脸 0.10m 惯用偏移」组的显式意图值（0.06 完成面 + 0.04 惯用）。
    assert.ok(Math.abs(placement.z - 0.1) < 1e-12, `expected 0.1, got ${placement.z}`);
  });

  it('returns a diagnostic instead of clamping when along overruns the wall span', () => {
    // sock_weakbox 242mm 事故的机制根源就是「投影超段就悄悄钳到端点」；现在必须 fail-closed。
    const walls = new Map<string, PointWall>([['w', { segments: [{ x1: 10.8, z1: 0, x2: 10.8, z2: 3 }], line_datum: 'centerline' }]]);
    const { placement, diagnostic } = resolvePointPlacementInWalls({ id: 'sock_weakbox', wall: 'w', wall_side: 'west', along: 3.23 }, walls);
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /along=3\.230 越出墙段/);
    assert.match(diagnostic ?? '', /拒绝钳位/);
  });

  it('rejects a wall point without along (x/z is an assertion field, not a placement source)', () => {
    const walls = new Map<string, PointWall>([['w', { segments: [{ x1: 0, z1: 0, x2: 10, z2: 0 }], line_datum: 'centerline' }]]);
    const { placement, diagnostic } = resolvePointPlacementInWalls({ id: 'p', wall: 'w', wall_side: 'south', x: 5, z: 0 }, walls);
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /wall \+ along 齐备/);
  });

  it('requires an explicit line_datum for the finished-face offset (no silent default)', () => {
    const walls = new Map<string, PointWall>([['w', { segments: [{ x1: 0, z1: 0, x2: 10, z2: 0 }] }]]);
    const { placement, diagnostic } = resolvePointPlacementInWalls({ id: 'p', wall: 'w', wall_side: 'south', along: 5 }, walls);
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /未声明 line_datum/);
  });

  it('keeps the four placement sources mutually exclusive', () => {
    const walls = new Map<string, PointWall>([['w', { segments: [{ x1: 0, z1: 0, x2: 10, z2: 0 }], line_datum: 'centerline' }]]);
    assert.match(resolvePointPlacementInWalls({ id: 'p', wall: 'w', wall_side: 'south', along: 5, absolute: true }, walls).diagnostic ?? '', /定位来源必须唯一/);
    assert.match(resolvePointPlacementInWalls({ id: 'p', wall: 'w', wall_side: 'south', along: 5, mount: { furniture_id: 'f', face: 'east', along: 0.5 } }, walls).diagnostic ?? '', /mount 与/);
    assert.match(resolvePointPlacementInWalls({ id: 'p', anchor: { source: 'hvac', id: 'a' }, x: 1, z: 1 }, walls).diagnostic ?? '', /anchor 定位解析未实现/);
    assert.match(resolvePointPlacementInWalls({ id: 'p', absolute: true, x: 1 }, walls).diagnostic ?? '', /绝对定位.*x 与 z 齐备/);
  });

  it('resolves absolute points from their declared coordinates', () => {
    const { placement } = resolvePointPlacement({ id: 'p', absolute: true, x: 10.8, z: 7.15 }, undefined);
    assert.deepEqual(placement, { kind: 'absolute', x: 10.8, z: 7.15 });
  });

  it('exposes the thin-plate convention shared by 3D rendering and DXF export', () => {
    // 业主 2026-11-07 裁定「DXF 迁就 3D 投影」：datum + 0.075 是投影真值。
    assert.ok(Math.abs(THIN_PLATE_FACE_OFFSET - 0.075) < 1e-12);
  });
});

describe('along_host derived position (PR #260 fix round 2, Codex major)', () => {
  // 横墙 (0,0)→(10,0)，北脸 = -z：宿主 along 5 → datum (5, 0)，落位 (5, -0.06)。
  const walls = new Map<string, PointWall>([['w', { segments: [{ x1: 0, z1: 0, x2: 10, z2: 0 }], line_datum: 'centerline' }]]);
  const host: PointPlacementInput = { id: 'shower', wall: 'w', wall_side: 'north', along: 5 };
  const inlet: PointPlacementInput = { id: 'inlet', along_host: { id: 'shower', offset: -0.15 }, wall_side: 'north' };
  const siblings = new Map<string, PointPlacementInput>([['shower', host], ['inlet', inlet]]);

  it('derives along from the host plus offset (same wall, same side)', () => {
    const { placement, diagnostic } = resolvePointPlacementInWalls(inlet, walls, undefined, siblings);
    assert.equal(diagnostic, undefined);
    assert.ok(placement && placement.kind === 'wall');
    assert.equal(placement.wallId, 'w');
    assert.equal(placement.wallSide, 'north');
    assert.ok(Math.abs(placement.along - 4.85) < 1e-12, `expected along 4.85, got ${placement.along}`);
    assert.equal(placement.datum.x, 4.85);
    assert.equal(placement.datum.z, 0);
    assert.ok(Math.abs(placement.x - 4.85) < 1e-12);
    assert.ok(Math.abs(placement.z - (-0.06)) < 1e-12);
  });

  it('follows the host when only the host moves (no hand-moved inlet)', () => {
    const movedHost: PointPlacementInput = { ...host, along: 5.2 };
    const moved = new Map<string, PointPlacementInput>([['shower', movedHost], ['inlet', inlet]]);
    const { placement } = resolvePointPlacementInWalls(inlet, walls, undefined, moved);
    assert.ok(placement && placement.kind === 'wall');
    assert.ok(Math.abs(placement.along - 5.05) < 1e-12, `expected along 5.05, got ${placement.along}`);
  });

  it('chains: an inlet of an inlet follows through the chain', () => {
    const second: PointPlacementInput = { id: 'inlet2', along_host: { id: 'inlet', offset: 0.1 }, wall_side: 'north' };
    const chained = new Map<string, PointPlacementInput>([['shower', host], ['inlet', inlet], ['inlet2', second]]);
    const { placement } = resolvePointPlacementInWalls(second, walls, undefined, chained);
    assert.ok(placement && placement.kind === 'wall');
    assert.ok(Math.abs(placement.along - 4.95) < 1e-12, `expected along 4.95, got ${placement.along}`);
  });

  it('fails closed on a host cycle instead of recursing', () => {
    const a: PointPlacementInput = { id: 'a', along_host: { id: 'b', offset: 0.1 }, wall_side: 'north' };
    const b: PointPlacementInput = { id: 'b', along_host: { id: 'a', offset: 0.1 }, wall_side: 'north' };
    const cyclic = new Map<string, PointPlacementInput>([['a', a], ['b', b]]);
    const { placement, diagnostic } = resolvePointPlacementInWalls(a, walls, undefined, cyclic);
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /成环/);
  });

  it('fails closed when the host is not in the index (dangling reference)', () => {
    const { placement, diagnostic } = resolvePointPlacementInWalls(inlet, walls, undefined, new Map([['inlet', inlet]]));
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /不在点位索引/);
  });

  it('fails closed when the caller provides no point index (no silent literal fallback)', () => {
    const { placement, diagnostic } = resolvePointPlacementInWalls(inlet, walls);
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /点位索引/);
  });

  it('fails closed when the declared side disagrees with the host side', () => {
    const wrongSide: PointPlacementInput = { ...inlet, wall_side: 'south' };
    const { placement, diagnostic } = resolvePointPlacementInWalls(wrongSide, walls, undefined, siblings);
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /不一致/);
  });

  it('keeps along_host mutually exclusive with the other sources', () => {
    const { diagnostic } = resolvePointPlacementInWalls({ ...inlet, wall: 'w', along: 4.85 }, walls, undefined, siblings);
    assert.match(diagnostic ?? '', /不得同时声明/);
  });

  it('refuses to resolve along_host through the single-point entry (needs the wall index)', () => {
    const { placement, diagnostic } = resolvePointPlacement(inlet, new Map([['w', [{ x1: 0, z1: 0, x2: 10, z2: 0 }]]]));
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /须走 resolvePointPlacementInWalls/);
  });

  it('schema: along_host plus wall/along is not a single source, and it bans x/z', () => {
    // 不用 parsePlumbingPoints 的产出当底（它带 wallSide 投影字段，strict schema 会先报
    // unrecognized_keys）；用最小字面量直测 refine。
    const base = { id: 'shower_mbath_cold_inlet', room: 'master_bath', type: 'shower_inlet' as const, along_host: { id: 'shower_mbath', offset: -0.15 }, wall_side: 'north' as const };
    assert.doesNotThrow(() => PlumbingPointSchema.parse(base));
    assert.throws(() => PlumbingPointSchema.parse({ ...base, wall: 'w_mbath_south', along: 0.35 }), /定位来源必须唯一/);
    assert.throws(() => PlumbingPointSchema.parse({ ...base, x: 0.35, z: 2.76 }), /禁止同时声明 x\/z/);
    // 缺 offset 时内层 z.object 先报 invalid_type（path along_host.offset），refine 的
    // 「沿位派生要求 id + offset 齐备」只兜非对象/非数字等走不到内层的形态。
    assert.throws(() => PlumbingPointSchema.parse({ ...base, along_host: { id: 'shower_mbath' } }), /"along_host",\s*"offset"/);
  });

  it('pointPlacementIndex keeps the first entry on duplicate ids (same rule as MEP endpoints)', () => {
    const index = pointPlacementIndex([host, { ...host, along: 9 }, inlet]);
    assert.equal((index.get('shower') as { along?: number }).along, 5);
  });
});

describe('point mount resolution (issue #98 S2 real mount)', () => {
  // 合成宿主：rot90 → AABB x[4.825,5.175]、z[4.0,6.0]；east 脸平面 x=5.175，脸轴 z 自南端 4.0 向北累计。
  const hostHosts = (): Map<string, PointMountHost> => new Map([
    ['ld.host', { id: 'ld.host', x: 5, z: 5, rotation: 90, width: 2.0, depth: 0.35 }],
    ['ld.count_only', { id: 'ld.count_only' }],
  ]);

  it('resolves a mount point on the host face plane plus face_offset', () => {
    const { placement, diagnostic } = resolvePointPlacementInWalls(
      { id: 'p', mount: { furniture_id: 'ld.host', face: 'east', along: 0.9, face_offset: 0.005 } },
      undefined,
      hostHosts(),
    );
    assert.equal(diagnostic, undefined, diagnostic ?? '');
    assert.ok(placement && placement.kind === 'mount');
    // 脸平面 x = 5.175 + face_offset 0.005 = 5.18；along 0.9 自脸南端 z=4.0 → z=4.9
    assert.ok(Math.abs(placement.x - 5.18) < 1e-12, `x = ${placement.x}`);
    assert.ok(Math.abs(placement.z - 4.9) < 1e-12, `z = ${placement.z}`);
    assert.deepEqual(placement.normal, { x: 1, z: 0 });
    assert.equal(placement.surfaceGap, 0.003);
  });

  it('rejects mount along beyond the host face span (no clamping)', () => {
    const { placement, diagnostic } = resolvePointPlacementInWalls(
      { id: 'p', mount: { furniture_id: 'ld.host', face: 'east', along: 2.5 } },
      undefined,
      hostHosts(),
    );
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /越出宿主/);
    assert.match(diagnostic ?? '', /拒绝钳位/);
  });

  it('rejects a mount whose host is missing or count-only (no plane geometry to hang on)', () => {
    const ghost = resolvePointPlacementInWalls({ id: 'p', mount: { furniture_id: 'ld.ghost', face: 'east', along: 0.5 } }, undefined, hostHosts());
    assert.match(ghost.diagnostic ?? '', /不在家具宿主索引或未放置/);
    const countOnly = resolvePointPlacementInWalls({ id: 'p', mount: { furniture_id: 'ld.count_only', face: 'east', along: 0.5 } }, undefined, hostHosts());
    assert.match(countOnly.diagnostic ?? '', /不在家具宿主索引或未放置/);
  });

  it('requires mountHosts from the caller (throws, no silent fallback to declared x/z)', () => {
    // 2026-11-09 issue #98 疗法①：缺宿主索引从「返回诊断」改成**当场抛**。诊断返回值会被
    // 多个消费方降级（回落声明 x/z / 回落原点 / 跳过该模型）——x/z 声明已在 S3 删光，
    // 降级路径只剩静默错位。口径与 shared/lighting-fixtures.ts「缺失即抛」对齐。
    assert.throws(
      () => resolvePointPlacementInWalls(
        { id: 'p', mount: { furniture_id: 'ld.host', face: 'east', along: 0.9 } },
        undefined,
      ),
      /mount 定位要求调用方提供家具宿主索引/,
    );
  });

  it('rejects mount without along and a wall_side inconsistent with mount.face', () => {
    const noAlong = resolvePointPlacementInWalls({ id: 'p', mount: { furniture_id: 'ld.host', face: 'east' } }, undefined, hostHosts());
    assert.match(noAlong.diagnostic ?? '', /mount 定位要求 along/);
    const sideClash = resolvePointPlacementInWalls({ id: 'p', wall_side: 'west', mount: { furniture_id: 'ld.host', face: 'east', along: 0.9 } }, undefined, hostHosts());
    assert.match(sideClash.diagnostic ?? '', /不一致/);
  });
});

describe('point placement consumers share one resolution (3D / DXF / MEP)', () => {
  it('computes every DXF/3D marker position from the resolver datum + thin-plate offset', () => {
    // 三方同源的构造性证明：对全部沿墙点位，DXF 圈心（= 3D mesh 位置）= datum + 0.075·法线，
    // 与 InfrastructureBuilder.placeModel / project-dxf.resolvedPointPosition 用同一个解析器输出。
    let checked = 0;
    // along_host 点位同样沿墙（经宿主派生）：过滤与解算都要把它算进来，否则 DXF/3D
    // 漏画它还全绿。siblings 由同批点位建（3D/DXF/MEP 同口径）。
    const siblings = pointPlacementIndex([...electrical, ...plumbing]);
    for (const point of [...electrical, ...plumbing] as Array<ElectricalPoint | PlumbingPoint>) {
      if (!point.wall && !point.along_host) continue;
      const { placement } = resolvePointPlacementInWalls(point, pointWalls, mountHosts, siblings);
      assert.ok(placement && placement.kind === 'wall', `${point.id}: 解算失败`);
      const rendered = {
        x: placement.datum.x + placement.normal.x * THIN_PLATE_FACE_OFFSET,
        z: placement.datum.z + placement.normal.z * THIN_PLATE_FACE_OFFSET,
      };
      // 渲染位置必须离开墙身（不再画在 120mm 墙体中心线上）
      const wall = pointWalls.get(placement.wallId)!;
      const segment: PointWallSegment = wall.segments[0];
      const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
      assert.ok(length > 0);
      const distanceToLine = Math.abs((rendered.x - segment.x1) * (segment.z2 - segment.z1) - (rendered.z - segment.z1) * (segment.x2 - segment.x1)) / length;
      assert.ok(distanceToLine > 0.07, `${point.id}: 渲染位置应离开墙身（距墙线 ${distanceToLine.toFixed(3)}m）`);
      checked++;
    }
    assert.equal(checked, 80); // 78 沿墙 + 2 新增冷水进口点位（2026-11-17 量价算法审计跟进 blocking 2）；2026-11-27 撤客卫电热毛巾架删 sock_gbath_towel，沿墙点位 79→78
  });

  it('resolves every point the electrical topology view needs (S3 regression: B1 class)', () => {
    // 浏览器「电路归属」叠加层（ElectricalTopologyRenderer）画三类点位：回路成员、面板源点位、
    // controls 的开关。S3 删 x/z 后该层曾因直读声明坐标静默跳掉 45/74 个成员与 2 块面板
    // （review B1）。根因是消费方忘传宿主索引——这里把不变量钉在数据层：生产索引下这三类
    // 点位必须全部解算成功，任何一个失败即红（而不是让某个叠加层静默少画）。
    const needed = new Set<string>([
      ...topology.circuits.flatMap((circuit) => circuit.member_point_ids),
      ...topology.panels.map((panel) => panel.source_point_id),
      ...topology.controls.flatMap((control) => control.switch_point_ids),
    ]);
    const byId = new Map(electrical.map((point) => [point.id, point]));
    let checked = 0;
    for (const id of [...needed].sort()) {
      const point = byId.get(id);
      assert.ok(point, `拓扑引用 ${id} 但 config/electrical.yaml 没有该点位`);
      const { placement, diagnostic } = resolvePointPlacementInWalls(point, pointWalls, mountHosts);
      assert.equal(diagnostic, undefined, `${id}: ${diagnostic ?? ''}`);
      assert.ok(placement, `${id}: 解算失败`);
      checked++;
    }
    // 74 成员 + 2 面板源 + 14 开关（去重后）
    assert.equal(checked, needed.size);
    assert.ok(needed.size >= 74, `拓扑视图依赖的点位数异常偏小（${needed.size}）——疑似拓扑配置被改坏`);
  });

  it('keeps MEP endpoints on the resolver basis (wall: finished face; mount: host face)', () => {
    // MEP 路线端点：沿墙点位 = 解算器完成面基点（管线接在底盒上，不在面盘上，取 datum +
    // WALL_THICKNESS/2 + face_offset 而不是 3D/DXF 的 datum + 0.075 薄板位置）；mount 挂载
    // 点位 = 宿主脸解果。S3 起这些点位不再声明 x/z，端点坐标按构造只有解算器一个来源。
    let checked = 0;
    const siblings = pointPlacementIndex([...electrical, ...plumbing]);
    for (const point of [...electrical, ...plumbing]) {
      if (!point.wall && !point.mount && !point.along_host) continue;
      const { placement, diagnostic } = resolvePointPlacementInWalls(point, pointWalls, mountHosts, siblings);
      assert.equal(diagnostic, undefined, `${point.id}: ${diagnostic ?? ''}`);
      assert.ok(placement && (placement.kind === 'wall' || placement.kind === 'mount'), `${point.id}: 解算失败`);
      // 完成面基点必须离开墙中心线恰好一个「半墙厚 + face_offset」——端点既不在墙身里，
      // 也不悄悄落在面盘偏移（0.075）上。
      const expectedOffset = placement.kind === 'wall' ? WALL_THICKNESS / 2 + (point.face_offset ?? 0) : undefined;
      if (placement.kind === 'wall') {
        assert.ok(Math.abs(placement.offsetFromCenterline - expectedOffset!) < 1e-12, `${point.id}: 完成面基点偏移量错误`);
      }
      checked++;
    }
    // 78 沿墙 + 2 沿墙派生（两卫淋浴冷水进口，along_host）+ 2 挂载（night_living_mid / night_corridor 都是 MEP 路线端点）；2026-11-27 撤客卫电热毛巾架删 sock_gbath_towel，沿墙点位 79→78
    assert.equal(checked, 82);
  });
});
