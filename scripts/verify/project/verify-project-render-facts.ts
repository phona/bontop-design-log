import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { parseElectricalPoints, parseCeilingZones, parseProjectHvacFacts, parseProjectRenderFactsProjection } from '../../../shared/project-render-facts-schema.js';
import { buildProjectRenderFactsFromFiles } from '../../project/project-render-facts-projection.js';
import { buildHvacBuilderSources, buildHvacEntityDescriptors, expectedHvacExportIds } from '../../../shared/render/HvacBuilder.js';
import { pointMountHostIndex, pointWallIndexFromElements } from '../../../shared/point-placement.js';
import { resolveLayout } from '../../../server/layout-resolver.js';

const projection = buildProjectRenderFactsFromFiles();
const generated = parseProjectRenderFactsProjection(
  JSON.parse(readFileSync('data/project-render-facts.json', 'utf8')),
);

if (JSON.stringify(generated) !== JSON.stringify(projection)) {
  throw new Error('data/project-render-facts.json is stale; run npm run generate:project-render-facts');
}

// ── 暖通实体计数契约（issue #98 第五阶段 S1，设计文档 §4.5-S1 指标 9/10 的 CI 可见落点）──
// 背景：HvacBuilder 的静默 continue 与导出期望集自产都只有浏览器路径消费
// （HouseScene.ts:912-914 / App.ts:479-483），两个既有测试都是函数级、不跑真实 config 装配——
// 「回到静默 continue」时 test:server 与 test:app 依旧全绿。这里把真实 config 的实体计数钉住：
//   全量源（ceiling+electrical+outdoor+pointWalls+mountHosts）= 47
//   去 pointWalls（sock_child_ac 沿墙点位解不出）           = 46
//   空源（13 个 ref anchor 全部落空）                       = 34
// 外加：全量源下 placementDiagnostics 必须为空；expectedHvacExportIds（期望集）与描述符逐 id 一致。
const hvac = parseProjectHvacFacts(readFileSync('config/hvac.yaml', 'utf8'));
const plan = hvac.plans[0];
const electrical = parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf8'));
const ceiling = parseCeilingZones(readFileSync('config/model/envelope/ceiling.yaml', 'utf8'));
const walls = pointWallIndexFromElements(
  resolveLayout(parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as Parameters<typeof resolveLayout>[0]).walls,
);
const house = parseYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings?: Record<string, Array<Record<string, unknown>>> };
const mountHosts = pointMountHostIndex(Object.values(house.furnishings ?? {}).flat() as never);
const base = { hvac, electrical, ceiling, outdoor: [plan.outdoor] };
const fullSources = buildHvacBuilderSources({ ...base, pointWalls: walls, mountHosts });
const noWallSources = buildHvacBuilderSources(base);
const emptySources = buildHvacBuilderSources({});

const fullDiagnostics: string[] = [];
const fullEntities = buildHvacEntityDescriptors(plan.id, plan.diagram, fullSources, fullDiagnostics);
const noWallEntities = buildHvacEntityDescriptors(plan.id, plan.diagram, noWallSources);
const emptyEntities = buildHvacEntityDescriptors(plan.id, plan.diagram, emptySources);
const expectedIds = expectedHvacExportIds(plan.id, plan.diagram, fullSources);

if (fullEntities.length !== 47) {
  throw new Error(`hvac entity contract: full sources must yield 47 entities, got ${fullEntities.length}（改解析/声明前先看本契约与 docs 迁移设计 §4.5-S1 指标 9）`);
}
if (fullDiagnostics.length > 0) {
  throw new Error(`hvac entity contract: full sources must resolve every anchor（placementDiagnostics 为空），实际 ${fullDiagnostics.length} 条：${fullDiagnostics.join('; ')}`);
}
if (noWallEntities.length !== 46) {
  throw new Error(`hvac entity contract: sources without pointWalls must yield 46 entities (sock_child_ac 沿墙点位解不出)，got ${noWallEntities.length}`);
}
if (emptyEntities.length !== 34) {
  throw new Error(`hvac entity contract: empty sources must yield 34 entities (13 个 ref anchor 落空)，got ${emptyEntities.length}`);
}
const fullIds = fullEntities.map((entity) => entity.objectId).sort();
const sortedExpected = [...expectedIds].sort();
if (sortedExpected.length !== fullIds.length || sortedExpected.some((id, index) => id !== fullIds[index])) {
  throw new Error('hvac entity contract: expectedHvacExportIds(full sources) 必须与 buildHvacEntityDescriptors 的 47 个 id 一致');
}

console.log(`ProjectRenderFacts verified: electrical=${projection.lightingFixtures.length} lighting fixtures, plumbing=${projection.plumbing.length}, ceiling=${projection.ceiling.length}`);
console.log(`HVAC entity contract: full=${fullEntities.length} / noPointWalls=${noWallEntities.length} / empty=${emptyEntities.length}, diagnostics=${fullDiagnostics.length}, expectedIds=${expectedIds.length}`);
