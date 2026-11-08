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
// 外加两条「告警化本身」的断言（独立验伪轮 2026-11-08 补：原契约只在全量源断言 diagnostics
// 为空，而全量源无失败、新旧写法 diagnostics 都恒空——把 resolveAnchor 回退成
// `Vec3|undefined` + `if (!position) continue` 的旧写法时计数契约照过，告警化形同空转）：
//   ① 不变量：可渲染实体数 == 落场景数 + 诊断数（每个 anchor 要么解出、要么记一条诊断；
//      旧写法下失败即静默丢弃，不变量被打破 → 红）。
//   ② 失败场景的诊断内容：noWall 必须恰 1 条且点名 sock_child_ac；empty 必须恰 13 条且
//      逐条对应 13 个 ref anchor。
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

// 可渲染实体数（与 buildHvacEntityDescriptors 的过滤条件同口径：confirmed 或带 position 的
// anchor + 非冷凝候选 terminal）。它不依赖 sources，因此能当「不许静默丢件」的标尺。
const renderableTotal = plan.diagram.anchors.filter((anchor) => anchor.status === 'confirmed' || anchor.position !== undefined).length
  + plan.diagram.terminals.filter((terminal) => terminal.kind !== 'condensate_drain_candidate').length;

const fullDiagnostics: string[] = [];
const fullEntities = buildHvacEntityDescriptors(plan.id, plan.diagram, fullSources, fullDiagnostics);
const noWallDiagnostics: string[] = [];
const noWallEntities = buildHvacEntityDescriptors(plan.id, plan.diagram, noWallSources, noWallDiagnostics);
const emptyDiagnostics: string[] = [];
const emptyEntities = buildHvacEntityDescriptors(plan.id, plan.diagram, emptySources, emptyDiagnostics);
const expectedIds = expectedHvacExportIds(plan.id, plan.diagram);

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
// 期望集与「按 diagram 声明独立推导的 id 集合」一致（铁律④：不许拿 expectedHvacExportIds 与
// buildHvacEntityDescriptors 同参互比——两者一个过解算器一个不过，且期望集曾把解算结果当期望，
// 源缺件时期望集同步缩水、ready 恒真）。expectedHvacExportIds 现为**声明态枚举**（只读
// diagram、不解算位置，shared/render/HvacBuilder.ts:145-165），本块用一份**独立重写**的枚举
// 与它对账：盯的是「过滤条件 + id 方案」两处实现是否漂移——改过滤（如把冷凝候选算进出入口）、
// 改命名（如丢 planId）、或换掉组成而保持总数 47，都会在这里红；这些是上面的计数钉抓不到的
// 「偷梁换柱」形态（变异实测：objectId 丢 planId → 红；枚举过滤去掉冷凝候选排除 → 红）。
const declaredExportIds = [
  ...plan.diagram.anchors
    .filter((anchor) => anchor.status === 'confirmed' || anchor.position !== undefined)
    .map((anchor) => `hvac:${plan.id}:anchor:${anchor.id}`),
  ...plan.diagram.terminals
    .filter((terminal) => terminal.kind !== 'condensate_drain_candidate')
    .map((terminal) => `hvac:${plan.id}:terminal:${terminal.id}`),
].sort();
const sortedExpected = [...expectedIds].sort();
if (sortedExpected.length !== declaredExportIds.length || sortedExpected.some((id, index) => id !== declaredExportIds[index])) {
  throw new Error(`hvac entity contract: expectedHvacExportIds(声明态枚举) 必须与独立推导的 ${declaredExportIds.length} 个 id 逐项一致（过滤条件或 objectId 命名被改了？），差集：${sortedExpected.filter((id) => !declaredExportIds.includes(id)).concat(declaredExportIds.filter((id) => !sortedExpected.includes(id))).join(',')}`);
}

// ① 不变量：可渲染实体数 == 落场景数 + 诊断数。旧写法（解析失败静默 continue）下
//    noWall=46+0、empty=34+0，都小于 47 → 这里红。这是「告警化」本身的断言，
//    与实体计数的绝对值无关：任何让 anchor 失败却不记诊断的改动都会被抓。
for (const [name, entities, diagnostics] of [['full', fullEntities, fullDiagnostics], ['noPointWalls', noWallEntities, noWallDiagnostics], ['empty', emptyEntities, emptyDiagnostics]] as const) {
  if (entities.length + diagnostics.length !== renderableTotal) {
    throw new Error(`hvac entity contract: ${name} sources must account for every renderable entity (entities ${entities.length} + diagnostics ${diagnostics.length} ≠ ${renderableTotal})——解析失败的 anchor 必须记诊断，禁止静默 continue`);
  }
}
// ② 失败场景的诊断内容：noWall 恰 1 条且点名 sock_child_ac；empty 恰 13 条且逐条对应 ref anchor。
if (noWallDiagnostics.length !== 1 || !noWallDiagnostics[0].includes('power_child') || !noWallDiagnostics[0].includes('sock_child_ac')) {
  throw new Error(`hvac entity contract: noPointWalls sources must record exactly one diagnostic naming power_child/sock_child_ac, got ${JSON.stringify(noWallDiagnostics)}`);
}
const emptyDiagAnchors = emptyDiagnostics.map((line) => /^hvac anchor ([^:]+):/.exec(line)?.[1]).sort();
const expectedRefAnchors = plan.diagram.anchors.filter((anchor) => anchor.ref !== undefined).map((anchor) => anchor.id).sort();
if (emptyDiagnostics.length !== 13 || emptyDiagAnchors.join(',') !== expectedRefAnchors.join(',')) {
  throw new Error(`hvac entity contract: empty sources must record one diagnostic per ref anchor (${expectedRefAnchors.join(',')}), got ${emptyDiagnostics.length}: ${emptyDiagAnchors.join(',')}`);
}

// ③ 解算结果（全量源）同样必须与声明集合逐 id 一致：全量源下一切正常时应全解出，
//    少一个就是解析层静默丢件（与①不变量互补：①盯「失败有没有记诊断」，这里盯「该解出的有没有解出」）。
const resolvedIds = fullEntities.map((entity) => entity.objectId).sort();
if (resolvedIds.length !== declaredExportIds.length || resolvedIds.some((id, index) => id !== declaredExportIds[index])) {
  throw new Error(`hvac entity contract: full sources must resolve every declared renderable entity（解出 ${resolvedIds.length} ≠ 声明 ${declaredExportIds.length}），差集：${resolvedIds.filter((id) => !declaredExportIds.includes(id)).concat(declaredExportIds.filter((id) => !resolvedIds.includes(id))).join(',')}`);
}

console.log(`ProjectRenderFacts verified: electrical=${projection.lightingFixtures.length} lighting fixtures, plumbing=${projection.plumbing.length}, ceiling=${projection.ceiling.length}`);
console.log(`HVAC entity contract: full=${fullEntities.length} / noPointWalls=${noWallEntities.length} / empty=${emptyEntities.length}, diagnostics full/noWalls/empty=${fullDiagnostics.length}/${noWallDiagnostics.length}/${emptyDiagnostics.length}, renderable=${renderableTotal}, expectedIds=${expectedIds.length}`);
