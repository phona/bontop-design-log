/**
 * 点位定位单一解算（issue #98 第四阶段 S1/S2，设计文档 §4.3/§4.4/§4.8）。
 *
 * 本文件是把「x/z 暂留为断言字段」固化成门禁的那一条：迁移期每个点位的解析结果与声明 x/z
 * 差 >0.005m 即 fail。它同时锁死四件事：
 *   ① 沿墙点位（79 个）的 along 反算值与 face_offset 抵偿正确——写错一个数就红；
 *   ② mount 挂载点位（S2 起夜灯 2 个）由宿主脸 + along + face_offset 解出的位置与声明 x/z
 *      一致——宿主移动才会变，手滑不会静默漂移；
 *   ③ 3D/DXF/MEP 三方共用同一解算结果（DXF 圈心 == 3D mesh 位置，按构造相等）；
 *   ④ 越界返回诊断而不是 clamp（sock_weakbox 242mm 静默偏差的机制根源）。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { resolveLayout } from '../../server/layout-resolver.js';
import { parseElectricalPoints, parsePlumbingPoints } from '../../shared/project-render-facts-schema.js';
import {
  pointMountHostIndex,
  pointWallIndexFromElements,
  resolvePointPlacement,
  resolvePointPlacementInWalls,
  THIN_PLATE_FACE_OFFSET,
  type PointMountHost,
  type PointWall,
  type PointWallSegment,
} from '../../shared/point-placement.js';
import type { PlacementItem } from '../../shared/furniture-placement.js';
import type { ElectricalPoint, PlumbingPoint, VertexLayoutYaml } from '../../shared/types.js';

/** 断言容差（米）：解析结果与声明值差超过它即 fail。 */
const ASSERT_TOLERANCE = 0.005;

const layout = resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf-8')) as VertexLayoutYaml);
const electrical = parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf-8'));
const plumbing = parsePlumbingPoints(readFileSync('config/plumbing.yaml', 'utf-8'));
const pointWalls = pointWallIndexFromElements(layout.walls);
// mount 宿主索引（issue #98 S2）：与生产入口（DXF/MEP/lighting-fixtures/server loader）同一构造。
const house = parseYaml(readFileSync('config/house.yaml', 'utf-8')) as { furnishings?: Record<string, PlacementItem[]> };
const mountHosts = pointMountHostIndex(Object.values(house.furnishings ?? {}).flat());

describe('point placement resolver (issue #98 S1/S2)', () => {
  it('keeps the migrated along/face_offset in agreement with the declared x/z', () => {
    // 断言字段：全量点位（137 个）逐一解算，沿墙/挂载点位的解析结果必须复现声明 x/z。
    let checked = 0;
    let mounted = 0;
    for (const point of [...electrical, ...plumbing]) {
      const { placement, diagnostic } = resolvePointPlacementInWalls(point, pointWalls, mountHosts);
      assert.equal(diagnostic, undefined, `${point.id}: ${diagnostic ?? ''}`);
      assert.ok(placement, `${point.id}: 解算器未返回位置`);
      if (placement.kind === 'absolute') {
        assert.equal(placement.x, point.x, `${point.id}: 绝对点位必须取声明 x/z`);
        assert.equal(placement.z, point.z, `${point.id}: 绝对点位必须取声明 z/z`);
        continue;
      }
      assert.ok(typeof point.x === 'number' && typeof point.z === 'number', `${point.id}: 沿墙/挂载点位的断言字段 x/z 缺失`);
      const distance = Math.hypot(placement.x - point.x, placement.z - point.z);
      assert.ok(
        distance <= ASSERT_TOLERANCE,
        `${point.id}: 解析结果 (${placement.x.toFixed(4)},${placement.z.toFixed(4)}) 与声明 (${point.x},${point.z}) 差 ${(distance * 1000).toFixed(2)}mm > ${ASSERT_TOLERANCE * 1000}mm`,
      );
      if (placement.kind === 'wall') checked++;
      else mounted++;
    }
    // 79 个沿墙点位（69 电 + 10 水）全部走到沿墙断言分支
    assert.equal(checked, 79);
    // S2：2 个柜面起夜灯（night_living_mid / night_corridor）升级为真挂载，解析结果同样必须复现声明 x/z
    assert.equal(mounted, 2);
  });

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

  it('requires mountHosts from the caller (no silent fallback to declared x/z)', () => {
    const { placement, diagnostic } = resolvePointPlacementInWalls(
      { id: 'p', mount: { furniture_id: 'ld.host', face: 'east', along: 0.9 } },
      undefined,
    );
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /家具宿主索引/);
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
    for (const point of [...electrical, ...plumbing] as Array<ElectricalPoint | PlumbingPoint>) {
      if (!point.wall) continue;
      const { placement } = resolvePointPlacementInWalls(point, pointWalls, mountHosts);
      assert.ok(placement && placement.kind === 'wall', `${point.id}: 解算失败`);
      const rendered = {
        x: placement.datum.x + placement.normal.x * THIN_PLATE_FACE_OFFSET,
        z: placement.datum.z + placement.normal.z * THIN_PLATE_FACE_OFFSET,
      };
      // 渲染位置必须离开墙身（不再画在 120mm 墙体中心线上）
      const wall = pointWalls.get(point.wall)!;
      const segment: PointWallSegment = wall.segments[0];
      const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
      assert.ok(length > 0);
      const distanceToLine = Math.abs((rendered.x - segment.x1) * (segment.z2 - segment.z1) - (rendered.z - segment.z1) * (segment.x2 - segment.x1)) / length;
      assert.ok(distanceToLine > 0.07, `${point.id}: 渲染位置应离开墙身（距墙线 ${distanceToLine.toFixed(3)}m）`);
      checked++;
    }
    assert.equal(checked, 79);
  });

  it('keeps MEP endpoints on the resolver basis (wall: finished face; mount: host face)', () => {
    // MEP 路线端点：沿墙点位 = 解算器完成面基点（管线接在底盒上，不在面盘上）；mount 挂载点位
    // = 宿主脸解果。断言期内两者 == 声明 x/z，故本期 MEP 路线几何零变化（167 个端点、107 条
    // 路线机械跟随，无需人工重判）。
    let checked = 0;
    for (const point of [...electrical, ...plumbing]) {
      if (!point.wall && !point.mount) continue;
      const { placement } = resolvePointPlacementInWalls(point, pointWalls, mountHosts);
      assert.ok(placement && (placement.kind === 'wall' || placement.kind === 'mount'), `${point.id}: 解算失败`);
      assert.ok(Math.abs(placement.x - point.x!) < 1e-9, `${point.id}: MEP 端点 x 漂移`);
      assert.ok(Math.abs(placement.z - point.z!) < 1e-9, `${point.id}: MEP 端点 z 漂移`);
      checked++;
    }
    // 79 沿墙 + 2 挂载（night_living_mid / night_corridor 都是 MEP 路线端点）
    assert.equal(checked, 81);
  });
});
