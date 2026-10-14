import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  computeMepTakeoff,
  type MepTakeoff,
  type MepTakeoffRules,
} from '../../shared/mep-takeoff.js';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
} from '../../shared/mep-hvac-coordination-schema.js';
import { mepQuoteQuantities } from '../../server/mep-quotes.js';

/**
 * 水电计价行的「量」只来自 takeoff，且 takeoff 里没有的声明一律抛错。
 *
 * 2026-10-14 阶段 4清掉的三处硬编码：
 *   - `fitting_ppr = totalWaterM * 0.35` / `fitting_pvc = totalDrainageM * 0.27`
 *     → 系数提升为 config/mep-takeoff.yaml 的 units.fitting_per_meter，量由 takeoff 派生；
 *   - `spd: 1` / `extra_pressure_test: 1` / `aux_lump: 1`
 *     → 改为读 declared_devices，缺声明即抛错（旧写法"有费率就出钱"，没声明也不报错）；
 *   - `declared(name)?.count ?? 0`
 *     → leb_kits / entry_valve_kit / gas_alarm_kit / exhaust_duct_kit 同样改为缺声明抛错
 *       （旧写法把「config 漏登记」当成「本项目没有该器件」，金额静默归零）。
 */

const rules = parseYaml(readFileSync('config/mep-takeoff.yaml', 'utf8')) as MepTakeoffRules;
const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as Parameters<typeof endpointSourcesFromFacts>[0]['electrical'];
const plumbing = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as Parameters<typeof endpointSourcesFromFacts>[0]['plumbing'];
const hvac = parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as { plans: unknown[] };
const ceiling = parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as unknown[];
const topology = parseYaml(readFileSync('config/electrical-topology.yaml', 'utf8')) as {
  circuits: Parameters<typeof computeMepTakeoff>[0]['circuits'];
  controls?: Parameters<typeof computeMepTakeoff>[0]['controls'];
};
const coordination = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
const sources = endpointSourcesFromFacts({
  electrical,
  plumbing,
  ceiling: ceiling as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['ceiling'],
  hvac: hvac as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['hvac'],
});

const takeoff = computeMepTakeoff({
  electrical: electrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
  plumbing: plumbing as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'],
  circuits: topology.circuits,
  controls: topology.controls ?? [],
  routes: coordination.routes,
  resolution: resolveMepRoutes(coordination, sources),
  rules,
});

/** 造一个抽掉某条 declared_devices 的 takeoff 视图（量本身不变，只改声明表）。 */
const withoutDeclared = (name: string): MepTakeoff => {
  const declared = { ...takeoff.devices.declared };
  delete declared[name];
  return { ...takeoff, devices: { ...takeoff.devices, declared } };
};

test('管件数量来自声明的 fitting_per_meter，不再有硬编码系数', () => {
  const quantities = mepQuoteQuantities(takeoff, 94.76);
  const water = takeoff.pipe.water.reduce((sum, bucket) => sum + bucket.meters, 0);
  const drainage = takeoff.pipe.drainage.reduce((sum, bucket) => sum + bucket.meters, 0);
  assert.ok(Math.abs(quantities.fitting_ppr - water * rules.units.fitting_per_meter.ppr) < 1e-9);
  assert.ok(Math.abs(quantities.fitting_pvc - drainage * rules.units.fitting_per_meter.pvc) < 1e-9);
  assert.ok(quantities.fitting_ppr > 0 && quantities.fitting_pvc > 0);
});

test('declared_devices 缺登记即抛错：spd / 打压次数 / 辅材包干都不按 1 兜底', () => {
  assert.throws(() => mepQuoteQuantities(withoutDeclared('spd'), 94.76), /declared_devices\.spd/);
  assert.throws(() => mepQuoteQuantities(withoutDeclared('pressure_test'), 94.76), /declared_devices\.pressure_test/);
  assert.throws(() => mepQuoteQuantities(withoutDeclared('aux_lump'), 94.76), /declared_devices\.aux_lump/);
});

test('leb_kits 等四类器件同样缺声明抛错，不按 0 件计价', () => {
  for (const name of ['leb_kits', 'entry_valve_kit', 'gas_alarm_kit', 'exhaust_duct_kit']) {
    assert.throws(() => mepQuoteQuantities(withoutDeclared(name), 94.76), new RegExp(`declared_devices\\.${name}`),
      `${name} 漏登记时不能按 0 件计价——那是静默漏计一整项`);
  }
});

test('真实声明下端到端不变：管件/器件数量与既有口径一致（纯重构，不改数）', () => {
  const quantities = mepQuoteQuantities(takeoff, 94.76);
  assert.equal(quantities.spd, 1);
  assert.equal(quantities.extra_pressure_test, 1);
  assert.equal(quantities.aux_lump, 1);
  assert.equal(quantities.leb_kit, 2);
  assert.equal(quantities.extra_leb_install, 2);
  assert.equal(quantities.labor_by_area, 94.76);
  assert.equal(quantities.extra_penetration, takeoff.devices.penetrations);
});
