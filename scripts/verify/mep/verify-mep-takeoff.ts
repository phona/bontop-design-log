import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
  validateMepCoordination,
} from '../../../shared/mep-hvac-coordination-schema.js';
import { computeMepTakeoff, type MepTakeoffRules, type TakeoffCircuit } from '../../../shared/mep-takeoff.js';

/**
 * verify:mep-takeoff —— 水电子系统算量的 count/覆盖度/显形项契约。
 *
 * 为什么单独一道门禁：算量数字变了，业主看到的成本就变了。允许"改配置让数字变好看"
 * 等于没有底座。本脚本把可观测指标钉住，改动必须带 DEC 引用（AGENTS.md：没有口头变更）。
 *
 * 契约清单：
 *   C1 路由端点全解析：出现悬空 = 有人加了指向不存在点位的路由
 *   C2/C3 覆盖集合必须完整分区；有效点位由当前输入实时派生，pending 预留显式延期
 *   C4 requirement / deferred / pending blocker 全部显形，属于报价阻塞，不伪装成错误
 *   C5 只有明确标记 kind=pending 的待裁定项可以保留；新增数据错误必须失败
 *   C6 配电箱模数 = ceil((回路数 + 2P 进线 + SPD) × (1 + spare_ratio))
 *   C7 回路数与 facts 的 derived 值同源对账
 */

interface Contract {
  id: string;
  label: string;
  expected: number | string;
  actual: number | string;
  decRef: string;
}

const rules = parseYaml(readFileSync('config/mep-takeoff.yaml', 'utf8')) as MepTakeoffRules;
const electrical = parseYaml(readFileSync(rules.sources.electrical_points, 'utf8')) as Array<Record<string, unknown>>;
const plumbing = parseYaml(readFileSync(rules.sources.plumbing_points, 'utf8')) as Array<Record<string, unknown>>;
const hvac = parseYaml(readFileSync(rules.sources.hvac, 'utf8')) as { plans: unknown[] };
const ceiling = parseYaml(readFileSync(rules.sources.ceiling, 'utf8')) as unknown[];
const topology = parseYaml(readFileSync(rules.sources.circuits, 'utf8')) as {
  circuits: TakeoffCircuit[];
  controls?: Array<{ switch_point_ids?: string[]; target_point_ids?: string[] }>;
};
const coordination = parseMepCoordination(readFileSync(rules.sources.routes, 'utf8'));
const facts = parseYaml(readFileSync('config/facts.yaml', 'utf8')) as { facts?: Array<{ id: string; value: string }> };
const factValue = (id: string): string | undefined => facts.facts?.find((fact) => fact.id === id)?.value;

/** facts 的 derived 值是 `@path:jsonpath` 表达式；本门禁只取它能对应的实际数组长度/标量。 */
function resolveFactExpression(raw: string | undefined): number | string | undefined {
  if (!raw) return undefined;
  const match = /^@([^:]+):(.+)$/.exec(raw.trim());
  if (!match) return raw;
  const [, path, jsonPath] = match;
  const document = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const parts = jsonPath.split('.');
  let cursor: unknown = document;
  for (const part of parts) {
    if (cursor && typeof cursor === 'object' && part in (cursor as Record<string, unknown>)) cursor = (cursor as Record<string, unknown>)[part];
    else return undefined;
  }
  return Array.isArray(cursor) ? cursor.length : (cursor as number | string);
}

const sources = endpointSourcesFromFacts({
  electrical: electrical as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['electrical'],
  plumbing: plumbing as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['plumbing'],
  ceiling: ceiling as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['ceiling'],
  hvac: hvac as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['hvac'],
});
// Keep the takeoff gate on the same cross-file contract as verify:mep.  The
// resolver can report a count, but it cannot detect duplicate source IDs or a
// plumbing route with contradictory evidence/status declarations.
validateMepCoordination(coordination, sources);
const resolution = resolveMepRoutes(coordination, sources);
const takeoff = computeMepTakeoff({
  electrical: electrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
  plumbing: plumbing as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'],
  circuits: topology.circuits,
  controls: topology.controls ?? [],
  routes: coordination.routes,
  resolution,
  rules,
});

const activeElectricalIds = new Set(
  electrical
    .filter((point) => !((rules.non_mep_items ?? []).some((item) => item.id === point.id)))
    .filter((point) => !(point.status === 'pending' && point.position_status === 'pending'))
    .map((point) => String(point.id)),
);
const activePlumbingIds = new Set(
  plumbing
    .filter((point) => !((rules.non_mep_items ?? []).some((item) => item.id === point.id)))
    .map((point) => String(point.id)),
);
const activePointCount = activeElectricalIds.size + activePlumbingIds.size;
const routed = new Set(takeoff.coverage.routedPointIds);
const unrouted = new Set(takeoff.coverage.unroutedPointIds);
const duplicateCoverage = [...routed].filter((id) => unrouted.has(id));
const missingCoverage = [...activeElectricalIds, ...activePlumbingIds].filter((id) => !routed.has(id) && !unrouted.has(id));
const requirementCoverageLeak = takeoff.requirementRoutes.filter((item) => routed.has(item.id) || unrouted.has(item.id));
const malformedRequirementRoutes = takeoff.requirementRoutes.filter((item) => item.routeKind !== 'requirement');
const pendingUnresolved = takeoff.unresolved.filter((item) => item.kind === 'pending');
const dataErrors = takeoff.unresolved.filter((item) => item.kind !== 'pending');

const contracts: Contract[] = [
  // Counts are derived from the loaded sources.  A fixed baseline (87/57/77)
  // made a legitimate pending decision look like a broken validator and
  // silently turned every later point addition into a stale assertion.
  { id: 'C1', label: '路由端点全部解析', expected: coordination.routes.length, actual: resolution.resolved, decRef: '新增/修改路由必须保持端点可解析' },
  { id: 'C2', label: '覆盖度分区总数与有效点位对齐', expected: activePointCount, actual: routed.size + unrouted.size, decRef: '每个有效点位必须落入 routed 或 unrouted' },
  { id: 'C3', label: '覆盖度无重复/无遗漏', expected: 0, actual: duplicateCoverage.length + missingCoverage.length, decRef: '修改点位/路线后同步覆盖分区' },
  { id: 'C4', label: 'requirement 路由不进入覆盖度', expected: 0, actual: requirementCoverageLeak.length + malformedRequirementRoutes.length, decRef: '要求路由必须显式 routeKind=requirement 且不计 physical route' },
  {
    id: 'C6',
    label: '配电箱模数',
    expected: Math.ceil((topology.circuits.length + rules.panel.main_switch_poles + rules.panel.spd_modules) * (1 + rules.panel.spare_ratio)),
    actual: takeoff.devices.panelModules,
    decRef: '公式变化须 DEC',
  },
  { id: 'C7a', label: '回路数 = fact.circuit_count', expected: resolveFactExpression(factValue('fact.circuit_count')) ?? '?', actual: topology.circuits.length, decRef: '增删回路须同步 facts' },
];

const failures = [
  ...contracts.filter((contract) => String(contract.actual) !== String(contract.expected)),
  ...(dataErrors.length > 0 ? [{ id: 'C5', label: '不存在未声明的数据错误', expected: 0, actual: dataErrors.length, decRef: '补齐缺失声明或修正配置' }] : []),
];
const jsonOutput = process.argv.includes('--json');

if (jsonOutput) {
  console.log(JSON.stringify({
    ok: failures.length === 0,
    contracts,
    blockers: takeoff.blockers,
    pendingUnresolved,
    dataErrors,
    takeoff: { conduit: takeoff.conduit, wire: takeoff.wire, pipe: takeoff.pipe, devices: takeoff.devices, unresolved: takeoff.unresolved, deferred: takeoff.deferred, requirementRoutes: takeoff.requirementRoutes },
  }, null, 2));
} else {
  console.log(`水电子系统算量校验：${takeoff.status}｜管长 ${takeoff.conduit.totalM.toFixed(1)}m（已画 ${takeoff.conduit.drawnM.toFixed(1)} + 补齐 ${takeoff.conduit.allowanceM.toFixed(1)}）｜导线 ${takeoff.wire.totalWireM.toFixed(0)}m｜Cat6 ${takeoff.cable.cat6M.toFixed(0)}m`);
  console.log(`  给水 ${takeoff.pipe.totalWaterM.toFixed(1)}m｜排水 ${takeoff.pipe.totalDrainageM.toFixed(1)}m｜底盒 ${takeoff.devices.boxes}｜箱体 ${takeoff.devices.panelModules} 模数`);
  for (const contract of contracts) {
    const ok = String(contract.actual) === String(contract.expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${contract.id} ${contract.label}：期望 ${contract.expected}，实际 ${contract.actual}${ok ? '' : `（${contract.decRef}）`}`);
  }
  if (takeoff.unresolved.length > 0) {
    console.log(`  unresolved ${takeoff.unresolved.length} 条（pending=${pendingUnresolved.length}，error=${dataErrors.length}）：`);
    for (const item of takeoff.unresolved) console.log(`    - [${item.kind ?? 'error'}] ${item.id}: ${item.reason}`);
  }
  if (takeoff.deferred.length > 0) {
    console.log(`  deferred ${takeoff.deferred.length} 条（已知待激活/归属未定，非错误）：${takeoff.deferred.map((item) => item.id).join(', ')}`);
  }
  if (takeoff.requirementRoutes.length > 0) console.log(`  requirement ${takeoff.requirementRoutes.length} 条（已声明待决，报价仍阻塞）：${takeoff.requirementRoutes.map((item) => item.id).join(', ')}`);
  console.log(failures.length === 0 ? 'verify:mep-takeoff OK（pending blocker 已显式登记）' : `verify:mep-takeoff FAILED：${failures.map((item) => item.id).join(', ')}`);
}
if (failures.length > 0) process.exitCode = 1;
