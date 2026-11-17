import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { findRouteRetraces, type MepPoint3D } from '../../shared/mep-retrace.js';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
} from '../../shared/mep-hvac-coordination-schema.js';
import { pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingsYaml, VertexLayoutYaml } from '../../shared/types.js';

const p = (x: number, y: number, z: number): MepPoint3D => ({ x, y, z });

test('相邻段折返：走 0.30m 又折回，检出 1 处、重叠 0.30m（审计 D2 形态）', () => {
  // strong-light-dining 的折点形态：(7.45, z 4.3→4.6→2.7)
  const points = [p(7.45, 2.55, 4.3), p(7.45, 2.55, 4.6), p(7.45, 2.55, 2.7)];
  const found = findRouteRetraces(points);
  assert.equal(found.length, 1);
  assert.equal(found[0].segmentA, 0);
  assert.equal(found[0].segmentB, 1);
  assert.ok(Math.abs(found[0].overlapM - 0.3) < 1e-9);
  assert.equal(found[0].direction, 'opposite');
});

test('正常转弯与直行续接不报：只交于一点，重叠为 0', () => {
  assert.deepEqual(findRouteRetraces([p(0, 0, 0), p(1, 0, 0), p(1, 0, 1)]), []);
  assert.deepEqual(findRouteRetraces([p(0, 0, 0), p(1, 0, 0), p(2, 0, 0)]), []);
  // 平行但不同线（两条走廊轴线）不报
  assert.deepEqual(findRouteRetraces([p(0, 0, 0), p(0, 0, 2), p(2, 0, 2), p(2, 0, 0)]), []);
});

test('非相邻段同向重走同样检出', () => {
  // S1 在 x=0 上走 z 0→2；绕一圈后 S5 在同一条线上走 z 0→1（同向重走 1m）
  const points = [p(0, 0, 0), p(0, 0, 2), p(2, 0, 2), p(2, 0, 0), p(0, 0, 0), p(0, 0, 1)];
  const found = findRouteRetraces(points);
  assert.equal(found.length, 1);
  assert.equal(found[0].segmentA, 0);
  assert.equal(found[0].segmentB, 4);
  assert.ok(Math.abs(found[0].overlapM - 1) < 1e-9);
  assert.equal(found[0].direction, 'same');
});

test('零长段（端点重复）跳过，不误报', () => {
  assert.deepEqual(findRouteRetraces([p(0, 0, 0), p(1, 0, 0), p(1, 0, 0), p(1, 0, 1)]), []);
});

test('垂直折返同样检出（strong-light-entry-night-corridor 形态）', () => {
  // (7.45,5.55) 处 y 2.55→2.7→0.3：上 0.15m 又折回，重叠 0.15m
  const points = [p(7.45, 2.55, 5.55), p(7.45, 2.7, 5.55), p(7.45, 0.3, 5.55)];
  const found = findRouteRetraces(points);
  assert.equal(found.length, 1);
  assert.ok(Math.abs(found[0].overlapM - 0.15) < 1e-9);
  assert.equal(found[0].direction, 'opposite');
});

/**
 * 全仓折返不变式（量价算法审计跟进）：全部已解算路由逐条过检测器，
 * 任何一条折返（出后沿同一线折回）都须失败——折返段在 routeLength 里
 * 被双计。2026-11-17 审计检出 4 处（strong-light-dining 0.30m、
 * strong-power-garden 0.30m、weak-master 0.05m、
 * strong-light-entry-night-corridor 0.15m），几何修后须归零。
 */
test('全仓折返不变式：全部已解算路由无折返', () => {
  const house = parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: FurnishingsYaml };
  const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as any[];
  const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as any[];
  const ceiling = parseYaml(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as any[];
  const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as any;
  const geometry = parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml;
  const layout = resolveLayout(geometry);
  const pointWalls = pointWallIndexFromElements(layout.walls);
  const { mountHosts } = buildPlacementIndexes({ geometry: { walls: layout.walls }, furnishings: house.furnishings ?? {} });
  const sources = endpointSourcesFromFacts({ electrical, plumbing, ceiling, hvac } as any, pointWalls, mountHosts);
  const coordination = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
  const resolution = resolveMepRoutes(coordination, sources);
  const folded: string[] = [];
  for (const item of resolution.routes) {
    const points = item.points ?? [];
    if (points.length < 2) continue;
    const found = findRouteRetraces(points as MepPoint3D[]);
    if (found.length > 0) {
      folded.push(`${item.route.id}: ${found.map((f) => `段${f.segmentA}→${f.segmentB} 重叠${f.overlapM.toFixed(2)}m`).join('；')}`);
    }
  }
  assert.deepEqual(folded, [], `折返路由须为 0 条，检出 ${folded.length} 条：${folded.join(' | ')}`);
});
