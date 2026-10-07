/**
 * 水电子系统 · 算量 CLI（可归档、可追溯）。
 *
 * 用法：
 *   npm run takeoff:mep              # 全量算量表 + 覆盖度 + 显形项
 *   npm run takeoff:mep -- --json    # 机器可读（与 server 成本层同口径）
 *
 * 为什么先有 CLI：PKG-040 的九个 COST 全是泛称，业主问「15,000 够不够」时没有任何可复算的
 * 中间量。本 CLI 把声明（点位/回路/路由/管径冷热字段）派生为量，输出可直接贴进
 * decision_log 与 control.yaml 的 quantity_basis。
 *
 * 铁律：本脚本只读；量全部来自 shared/mep-takeoff.ts 派生，脚本内不写任何米数/金额。
 */
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { ProjectCatalog } from '../../server/project-catalog.js';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
  validateMepCoordination,
} from '../../shared/mep-hvac-coordination-schema.js';
import { computeMepTakeoff, type MepTakeoffRules, type TakeoffCircuit, type TakeoffControl } from '../../shared/mep-takeoff.js';
import { compareMepQuotes, loadMepQuotes, mepQuoteFallback } from '../../server/mep-quotes.js';
import type { ElectricalPoint, PlumbingPoint } from '../../shared/types.js';

const asJson = process.argv.includes('--json');

const rules = parseYaml(readFileSync('config/mep-takeoff.yaml', 'utf8')) as MepTakeoffRules;
const electrical = parseYaml(readFileSync(rules.sources.electrical_points, 'utf8')) as ElectricalPoint[];
const plumbing = parseYaml(readFileSync(rules.sources.plumbing_points, 'utf8')) as PlumbingPoint[];
const ceiling = parseYaml(readFileSync(rules.sources.ceiling, 'utf8')) as unknown[];
const hvac = parseYaml(readFileSync(rules.sources.hvac, 'utf8')) as { plans: unknown[] };
const coordination = parseMepCoordination(readFileSync(rules.sources.routes, 'utf8'));
const topology = parseYaml(readFileSync(rules.sources.circuits, 'utf8')) as { circuits: TakeoffCircuit[]; controls?: TakeoffControl[] };
const quotes = loadMepQuotes();
const labor = parseYaml(readFileSync('config/mep-labor.yaml', 'utf8')) as Parameters<typeof mepQuoteFallback>[0];
const control = parseYaml(readFileSync('schedule/phase-1/control.yaml', 'utf8')) as { work_packages: Array<{ id: string; budget: { planned_cny: number | null; estimated_need_cny?: number | null; components?: Array<{ id: string; planned_cny: number | null }> } }> };
const pkg040 = control.work_packages.find((pkg) => pkg.id === 'PKG-040');
const rooms = ProjectCatalog.load('.').getRooms();

const sources = endpointSourcesFromFacts({
  electrical,
  plumbing,
  ceiling: ceiling as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['ceiling'],
  hvac: hvac as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['hvac'],
});
validateMepCoordination(coordination, sources);
const resolution = resolveMepRoutes(coordination, sources);

const takeoff = computeMepTakeoff({
  electrical,
  plumbing,
  circuits: topology.circuits ?? [],
  controls: topology.controls ?? [],
  routes: coordination.routes,
  resolution,
  rules,
});

const AREA_SQM = 94.76;
const comparisons = compareMepQuotes(quotes, takeoff, AREA_SQM, mepQuoteFallback(labor));
const cost = comparisons.find((entry) => entry.active) ?? comparisons[0];

if (asJson) {
  console.log(JSON.stringify({ takeoff, cost }, null, 2));
} else {
  const n = (value: number, digits = 1): string => value.toFixed(digits).padStart(9);
  console.log(`水电子系统算量（状态 ${takeoff.status}；房间基线 ${rooms.length} 间）\n`);
  console.log('—— 管长（**只含画了 physical route 的部分**；未路由点位不进量，见下方「未路由点位」）——');
  console.log(`  强电 ${n(takeoff.conduit.strongPowerM)}m   弱电 ${n(takeoff.conduit.weakPowerM)}m   给水 ${n(takeoff.conduit.waterSupplyM)}m   排水 ${n(takeoff.conduit.drainageM)}m`);
  console.log(`  强电计价（同回路 union） ${n(takeoff.conduit.strongPowerTotalM)}m ＝ 逻辑 Σ各条 ${n(takeoff.conduit.strongPowerLogicalM)}m 去重后；跨回路去重下限 ${n(takeoff.conduit.strongPowerUnionAllM)}m`);
  console.log(`  管长合计 ${n(takeoff.conduit.totalM)}m｜未归属主干 ${n(takeoff.trunkConduitM)}m（线径未裁定前不进数）`);

  console.log('\n—— 导线（按回路线径分桶，含 ' + takeoff.wire.lossApplied + ' 损耗）——');
  for (const bucket of takeoff.wire.bySize) {
    console.log(`  ${bucket.wireSize.padEnd(5)}mm²  管 ${n(bucket.conduitM)}m × ${bucket.cores} 芯 = ${n(bucket.wireM, 0)}m   （${bucket.circuits.length} 个回路）`);
  }
  console.log(`  双控附加控制线 ${n(takeoff.wire.dualControlExtraM, 0)}m   合计 ${n(takeoff.wire.totalWireM, 0)}m`);
  console.log(`  Cat6 网线 ${n(takeoff.cable.cat6M, 0)}m（额外芯数 ${JSON.stringify(takeoff.cable.extraCoresApplied)}）`);

  console.log('\n—— 管材（含 ' + takeoff.pipe.lossApplied + ' 损耗）——');
  for (const bucket of takeoff.pipe.water) console.log(`  给水 ${bucket.key.padEnd(12)} ${n(bucket.meters)}m`);
  for (const bucket of takeoff.pipe.drainage) console.log(`  排水 ${bucket.key.padEnd(12)} ${n(bucket.meters)}m`);

  console.log('\n—— 设备 ——');
  console.log(`  底盒 ${takeoff.devices.boxes} 个 · 配电箱 ${takeoff.devices.panelModules} 模数 · 断路器 ${takeoff.devices.breakers.total}（漏保 ${takeoff.devices.breakers.withRcd} / 微断 ${takeoff.devices.breakers.mcbOnly}）· 穿墙孔 ${takeoff.devices.penetrations} 个`);
  for (const [key, item] of Object.entries(takeoff.devices.declared)) console.log(`  ${key}: ${item.count}（${item.basis}）`);

  console.log('\n—— 覆盖度（点位有没有被 physical route 画到）——');
  for (const [type, entry] of Object.entries(takeoff.coverage.byType)) {
    console.log(`  ${type.padEnd(16)} ${entry.total} 个：已画 ${entry.routed} / 未画 ${entry.unrouted}${entry.unrouted > 0 ? '（未画=无路由，不进采购量）' : ''}`);
  }
  console.log(`\n  **未路由点位 ${takeoff.coverage.unroutedPoints.length} 个——不进入任何采购量**：`);
  for (const p of takeoff.coverage.unroutedPoints.slice(0, 30)) console.log(`    - ${p.id}（${p.room}/${p.type}${p.circuit ? '/' + p.circuit : ''}）`);
  if (takeoff.coverage.unroutedPoints.length > 30) console.log(`    …其余 ${takeoff.coverage.unroutedPoints.length - 30} 个见 --json`);

  console.log('\n—— 显形项 ——');
  console.log(`  只声明要求未画线的路由 ${takeoff.requirementRoutes.length} 条：${takeoff.requirementRoutes.map((item) => item.id).join(', ') || '无'}`);
  console.log(`  排除层/设施：${takeoff.excluded.map((item) => item.layer ?? item.id).join(', ') || '无'}`);
  console.log(`  已知待激活/归属未定 ${takeoff.deferred.length} 条：${takeoff.deferred.map((item) => item.id).join(', ') || '无'}`);
  if (takeoff.feasibleForQuote) {
    console.log('  报价门槛：通过（unresolved / requirement / deferred 均为 0）');
  } else {
    console.log(`  报价门槛：阻塞（blockers ${takeoff.blockers.length} · unresolved ${takeoff.unresolved.length} · requirement ${takeoff.requirementRoutes.length} · deferred ${takeoff.deferred.length}，comparable:false）`);
    if (takeoff.unresolved.length > 0) {
      console.log(`  unresolved：${takeoff.unresolved.length} 条`);
      for (const item of takeoff.unresolved.slice(0, 20)) console.log(`    - [${item.kind ?? 'error'}:${item.id}] ${item.reason}`);
      if (takeoff.unresolved.length > 20) console.log(`    …其余 ${takeoff.unresolved.length - 20} 条见 --json`);
    }
    for (const item of takeoff.requirementRoutes) console.log(`    - [requirement:${item.id}] 已声明但未画 physical route`);
    for (const item of takeoff.deferred) console.log(`    - [deferred:${item.id}] ${item.reason}`);
  }

  console.log('\n—— 成本（量 × 生效卡片单价；未取得报价即 null、总额不编）——');
  console.log(`  生效卡片：${cost.id}｜${cost.contractor}｜${cost.status}${cost.comparable ? '' : '｜⚠️ 不可直接比较'}`);
  for (const row of cost.rows) {
    const price = row.per_unit === null ? '待报价' : row.per_unit.toFixed(2);
    const total = row.subtotal === null ? '—' : row.subtotal.toFixed(0);
    const src = row.rate_source === 'quote' ? '' : `（回落 ${row.rate_source}）`;
    console.log(`  ${row.key.padEnd(24)} ${String(row.quantity).padStart(8)} ${row.unit.padEnd(6)} × ${String(price).padStart(8)} = ${String(total).padStart(9)} ${row.out_of_scope ? '不报' : ''}${src}`);
  }
  console.log(`  总额（本卡覆盖范围）：${cost.total === null ? 'null（有待报价行）' : `¥${cost.total.toFixed(0)}`}`);
  if (cost.comparability_notes.length > 0) {
    console.log('  可比性提示：');
    for (const note of cost.comparability_notes) console.log(`    - ${note}`);
  }
  console.log('\n—— 全部方案并排（量不变，只换单价）——');
  for (const entry of comparisons) {
    const delta = entry.deltaVsActive === null ? '' : `（较生效 ${entry.deltaVsActive > 0 ? '+' : ''}${entry.deltaVsActive.toFixed(0)}）`;
    console.log(`  ${entry.active ? '▶' : ' '} ${entry.id.padEnd(28)} ${entry.total === null ? 'null' : `¥${entry.total.toFixed(0).padStart(6)}`} ${delta}${entry.comparable ? '' : '  ⚠️不可比'}`);
  }
  console.log(`\n  对照 PKG-040 planned ¥${pkg040?.budget.planned_cny ?? '?'}：缺口 ${cost.total === null ? 'null' : `¥${(cost.total - (pkg040?.budget.planned_cny ?? 0)).toFixed(0)}`}`);
  console.log(`  不可预见费与 gap 对照属预算层口径（config/mep-labor.yaml 的 contingency_ratio），报价卡只到「本卡覆盖范围合计」`);
  for (const item of takeoff.unresolved) console.log(`    - [${item.kind ?? 'error'}:${item.id}] ${item.reason}`);
  for (const item of takeoff.requirementRoutes) console.log(`    - [requirement:${item.id}] 已声明但未画 physical route`);
  for (const item of takeoff.deferred) console.log(`    - [deferred:${item.id}] ${item.reason}`);
  console.log('  报价阻塞项（未清零或书面接受前不得据本表下单）：');
  for (const item of takeoff.unresolved) console.log(`    - [${item.kind ?? 'error'}:${item.id}] ${item.reason}`);
  for (const item of takeoff.requirementRoutes) console.log(`    - [requirement:${item.id}] 已声明但未画 physical route`);
  for (const item of takeoff.deferred) console.log(`    - [deferred:${item.id}] ${item.reason}`);
}
