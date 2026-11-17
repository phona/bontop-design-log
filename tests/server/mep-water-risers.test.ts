/**
 * 给水 v1 干管淋浴末端立管（D4）——量价算法审计跟进。
 *
 * 四条 v1 干管（热水器→主卫热水、入户→主卫冷水、热水器→客卫热水、
 * 入户→客卫冷水）此前在 y=0.18 平面走完，淋浴花洒在高 1.00m，
 * 中间缺 0.82m 纯竖直立管一段（4 × 0.82 = 3.28m），是真实要买的管。
 * 本测试钉住：每条干管解算折线末段须为同 (x,z) 的纯竖直段，
 * y 由 0.18 升至 1.00（立管 0.82m）。
 *
 * 排除（不属于本测试、不在本 PR 计入）：
 * - 热水器端立管（2 × 1.02m）：器具自带尾段口径，不另计；
 * - 回水环路末端（0.65 + 0.85m）：回水在热水立管/热水器尾段处三通接入，
 *   不另立一根管；
 * - 需求路由（requirement）的花洒端上升：与干管立管是同一根物理立管，
 *   另作跟进发现报告，不在本 PR 修。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load as parseYaml } from 'js-yaml';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
} from '../../shared/mep-hvac-coordination-schema.js';
import { pointWallIndexFromElements } from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingsYaml, VertexLayoutYaml } from '../../shared/types.js';

const RISER_ROUTES = [
  'water-v1-heater-to-mbath-hot',
  'water-v1-entry-to-mbath-cold',
  'water-v1-heater-to-gbath-hot',
  'water-v1-entry-to-gbath-cold',
] as const;

const TOL = 1e-6;

function loadResolution() {
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
  return resolveMepRoutes(coordination, sources);
}

for (const routeId of RISER_ROUTES) {
  test(`D4 立管：${routeId} 末段为 0.82m 纯竖直段（y 0.18 → 1.00）`, () => {
    const resolution = loadResolution();
    const item = resolution.routes.find((r) => r.route.id === routeId);
    assert.ok(item, `路由 ${routeId} 应可解算`);
    assert.equal(item.unresolved.length, 0, `路由 ${routeId} 应无悬空端点`);
    const points = item.points ?? [];
    assert.ok(points.length >= 2, `路由 ${routeId} 应有折线`);
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    assert.ok(Math.abs(last.x - prev.x) <= TOL && Math.abs(last.z - prev.z) <= TOL, `${routeId} 末段须为同 (x,z) 的纯竖直段`);
    assert.ok(prev.y !== undefined && last.y !== undefined, `${routeId} 立管两端须有标高 y`);
    assert.ok(Math.abs(prev.y - 0.18) <= TOL, `${routeId} 立管起点须在 y=0.18，实际 ${prev.y}`);
    assert.ok(Math.abs(last.y - 1.0) <= TOL, `${routeId} 立管终点须在花洒高 y=1.00，实际 ${last.y}`);
    assert.ok(Math.abs(last.y - prev.y - 0.82) <= TOL, `${routeId} 立管长须为 0.82m`);
  });
}
