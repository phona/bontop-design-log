/**
 * 页面首建 HVAC 装配源契约（PR #122 Codex blocking，审查提交 ad457b39）。
 *
 * 由来：HouseScene.buildFromCatalog 首建时手上只有 `/api/project` 的 `renderFactsProjection`
 * （没有 `/api/render-facts` 的 hvac facts）。它按 `buildHvacBuilderSources` 的真实签名
 * 传 projection + electrical + pointWalls/mountHosts——而投影当时**不带外机**，于是
 * confirmed 锚点 `outdoor_a2`（ref outdoor `vrf_outdoor_a2`）解不出：
 *   46/47 实体 + 1 条 `hvac anchor outdoor_a2: ref outdoor 宿主 "vrf_outdoor_a2" 不在来源里（断引用）`。
 * 之后 refreshInfrastructure 用完整来源重建、外机回到场景，但旧诊断残留 → 导出守卫误拒。
 *
 * 本文件用**真实 config**（不是手捏 fixture）钉首建源：
 *   ① 只给投影 + electrical + 两份索引 → 47 个可渲染实体、0 条诊断（外机在场）；
 *   ② 投影自带 `hvac.outdoor`（schema 必填），所以「只有投影」的调用方自带外机；
 *   ③ 三路外机来路的优先级：显式 outdoor > hvac facts > 投影。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { buildProjectRenderFactsFromFiles } from '../../scripts/project/project-render-facts-projection.js';
import {
  parseElectricalPoints,
  parseProjectHvacFacts,
  parseProjectRenderFactsProjection,
  parseCeilingZones,
} from '../../shared/project-render-facts-schema.js';
import { pointMountHostIndex, pointWallIndexFromElements } from '../../shared/point-placement.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { buildHvacBuilderSources, buildHvacEntityDescriptors } from '../../shared/render/HvacBuilder.js';
import type { VertexLayoutYaml } from '../../shared/types.js';

const projection = buildProjectRenderFactsFromFiles('.');
const electrical = parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf8'));
const hvac = parseProjectHvacFacts(readFileSync('config/hvac.yaml', 'utf8'));
const plan = hvac.plans[0];
const ceiling = parseCeilingZones(readFileSync('config/model/envelope/ceiling.yaml', 'utf8'));
const pointWalls = pointWallIndexFromElements(
  resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml).walls,
);
const house = parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: Record<string, Array<Record<string, unknown>>> };
const mountHosts = pointMountHostIndex(Object.values(house.furnishings ?? {}).flat() as never);

/** HouseScene.buildFromCatalog（app/src/render/HouseScene.ts）首建那一份源的同一构造。 */
function firstBuildSources() {
  return buildHvacBuilderSources({ projection, electrical, pointWalls, mountHosts });
}

function describeEntities() {
  const sources = firstBuildSources();
  const diagnostics: string[] = [];
  const entities = buildHvacEntityDescriptors('A2', projection.hvac.status === 'implemented' ? projection.hvac.diagram : (undefined as never), sources, diagnostics);
  return { sources, entities, diagnostics };
}

test('首建源（投影 + electrical + 宿主索引）解析出全部 47 个实体，外机在列、零诊断', () => {
  const { sources, entities, diagnostics } = describeEntities();
  assert.equal(projection.hvac.status, 'implemented', '本契约要求 config 的 hvac 方案 A2 处于 implemented');
  assert.ok((sources.outdoor?.length ?? 0) > 0, '首建源没有外机：投影必须自带 hvac.outdoor（否则 outdoor_a2 解不出）');
  assert.deepEqual(diagnostics, [], `首建源不得产生定位诊断，实际：\n${diagnostics.join('\n')}`);
  assert.equal(entities.length, 47, `首建源应解析出 47 个可渲染实体，实际 ${entities.length}`);
  assert.ok(
    entities.some((entity) => entity.objectId === 'hvac:A2:anchor:outdoor_a2'),
    '首建源缺 confirmed 外机锚点 outdoor_a2（外机不画 + 诊断 + 导出守卫拒绝）',
  );
  // 外机坐标来自投影自带的那份 facts（不是建场时另取的 facts）：与 config 声明一致。
  const outdoorEntity = entities.find((entity) => entity.objectId === 'hvac:A2:anchor:outdoor_a2')!;
  assert.ok(Math.abs(outdoorEntity.position.x - plan.outdoor.x) < 1e-9);
  assert.ok(Math.abs(outdoorEntity.position.z - plan.outdoor.z) < 1e-9);
});

test('implemented 投影必须带外机（schema 必填）：签入的 data/project-render-facts.json 同口径', () => {
  assert.ok(projection.hvac.status === 'implemented' && projection.hvac.outdoor.length > 0,
    'buildProjectRenderFactsFromFiles 产出的 implemented 投影缺 outdoor');
  const committed = parseProjectRenderFactsProjection(JSON.parse(readFileSync('data/project-render-facts.json', 'utf8')));
  assert.ok(committed.hvac.status === 'implemented');
  assert.deepEqual(committed.hvac.outdoor, projection.hvac.outdoor,
    'data/project-render-facts.json 的外机与 config 投影不一致；改 schema/投影后请跑 npm run generate:project-render-facts');
  // 不自洽的投影（implemented 无 outdoor）在边界处即被拒，而不是等到建场才显形。
  const inconsistent = JSON.parse(JSON.stringify(projection)) as { hvac: Record<string, unknown> };
  delete inconsistent.hvac.outdoor;
  assert.throws(() => parseProjectRenderFactsProjection(inconsistent), /outdoor/u,
    'implemented 投影缺 outdoor 必须在解析层被拒（fail-closed）');
});

test('外机三路来路的优先级：显式 outdoor > hvac facts > 投影', () => {
  const explicit = { id: 'vrf_outdoor_a2', platform: 'west_platform', x: 99, z: 99, direction: 'south' as const, width: 1, depth: 1, height: 1, model: 'explicit' };
  const fromExplicit = buildHvacBuilderSources({ projection, electrical, outdoor: [explicit] });
  assert.equal(fromExplicit.outdoor?.[0]?.x, 99, '显式 outdoor 必须覆盖投影自带值');

  const factsWithShiftedUnit = { ...hvac, plans: hvac.plans.map((item) => ({ ...item, outdoor: { ...item.outdoor, x: 88 } })) };
  const fromFacts = buildHvacBuilderSources({ projection, electrical, hvac: factsWithShiftedUnit });
  assert.equal(fromFacts.outdoor?.[0]?.x, 88, 'hvac facts 必须优先于投影自带值（调用方显式给了更新的来源）');

  const fromProjection = buildHvacBuilderSources({ projection, electrical });
  assert.equal(fromProjection.outdoor?.[0]?.x, plan.outdoor.x, '只给投影时必须回退到投影自带的 hvac.outdoor');
  assert.deepEqual(fromProjection.ceiling, buildHvacBuilderSources({ projection, electrical, ceiling }).ceiling);
});
