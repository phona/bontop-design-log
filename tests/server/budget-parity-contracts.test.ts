// tests/server/budget-parity-contracts.test.ts
//
// 2026-10-14「预算计算架构根治」三道强制对账的单测。
//
// 为什么单独建文件而不是并进 tests/server/facts-lint.test.ts：本文件守的是**预算口径**不变量
// （量对账 / 价单一源），与 facts-lint 引擎的通用契约族是两层；并进去会让「改一个预算数」
// 和「改引擎」在同一个文件里互相掩盖。合成用例全走内存 workspace，真实用例读仓库根。
//
// 三道契约各自要证明的事：
//   ① quantity_parity  同一个物理量在 N 处必须相等；不等 → parity_mismatch，取不到 → parity_unresolvable
//   ② single_source    同一张费率表只许一份；复制第二份 → single_source_violation 并列出全部位置
//   ③（verifier 侧）死引用检查由 scripts/verify/model/verify-model-package-links.ts 承担，
//      其「能抓到什么」的实证见 tests/server/model-package-links.test.ts 与文末负例。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { load as parseYaml } from 'js-yaml';
import { lintFacts, type FactsRegistry, type FactsWorkspace } from '../../shared/facts-lint.js';

function workspaceOf(files: Record<string, string>, datasets: FactsWorkspace['datasets'] = {}): FactsWorkspace {
  return {
    read(rel: string): string | null { return Object.prototype.hasOwnProperty.call(files, rel) ? files[rel] : null; },
    load(rel: string): unknown | null {
      const text = this.read(rel);
      if (text === null) return null;
      try { return rel.endsWith('.json') ? JSON.parse(text) : parseYaml(text); } catch { return null; }
    },
    grep(rel: string, re: RegExp): RegExpExecArray[] {
      const text = this.read(rel);
      if (text === null) return [];
      const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      global.lastIndex = 0;
      const out: RegExpExecArray[] = [];
      let m: RegExpExecArray | null;
      while ((m = global.exec(text)) !== null) {
        out.push(m);
        if (m[0].length === 0) global.lastIndex += 1;
      }
      return out;
    },
    datasets,
  };
}

const emptyRegistry: FactsRegistry = { scan: { include: ['docs/'], scalars: [] }, facts: [], contracts: [], coverage: [] };

const PARITY_CONTRACT: FactsRegistry['contracts'] = [{
  id: 'c.x_parity',
  kind: 'quantity_parity',
  unit: '㎡',
  tolerance: 0.005,
  compare: [
    { label: '实算', value: 'dataset:budget.masonry.totalTileSqm' },
    { label: '登记', value: 'yaml:schedule/phase-1/control.yaml#COST-060-08.quantity_declared.total_tile_sqm' },
  ],
}];

// ─── quantity_parity ─────────────────────────────────────────────────────────

test('quantity_parity：两侧一致时通过，并留下「几处一致」的 INFO', () => {
  const ws = workspaceOf({
    'schedule/phase-1/control.yaml': 'work_packages:\n  - budget:\n      components:\n        - id: COST-060-08\n          quantity_declared: { total_tile_sqm: 36.7236 }\n',
  }, {
    'budget.masonry': { totalTileSqm: 36.72359934704321 },
  });
  const result = lintFacts({ ...emptyRegistry, contracts: PARITY_CONTRACT }, ws);
  assert.equal(result.errors.length, 0);
  assert.match(result.notes?.join('\n') ?? '', /c\.x_parity：2 处一致 = 36\.72359934704321/);
});

test('quantity_parity：登记侧漂移即 error，且 message 同时列出两侧的值', () => {
  const ws = workspaceOf({
    'schedule/phase-1/control.yaml': 'work_packages:\n  - budget:\n      components:\n        - id: COST-060-08\n          quantity_declared: { total_tile_sqm: 15.33 }\n',
  }, {
    'budget.masonry': { totalTileSqm: 36.72359934704321 },
  });
  const result = lintFacts({ ...emptyRegistry, contracts: PARITY_CONTRACT }, ws);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'parity_mismatch');
  // 必须两边都印出来：只印「不一致」没法判断该改哪边。
  assert.match(result.errors[0].message, /实算 = 36\.72359934704321/);
  assert.match(result.errors[0].message, /登记 = 15\.33/);
});

test('quantity_parity：任一侧取不到有限数值即 error，不许静默跳过', () => {
  const missingDataset = workspaceOf({
    'schedule/phase-1/control.yaml': 'work_packages:\n  - budget:\n      components:\n        - id: COST-060-08\n          quantity_declared: { total_tile_sqm: 36.7236 }\n',
  }, {});
  const missingDatasetResult = lintFacts({ ...emptyRegistry, contracts: PARITY_CONTRACT }, missingDataset);
  assert.equal(missingDatasetResult.errors.length, 1);
  assert.equal(missingDatasetResult.errors[0].code, 'parity_unresolvable');

  // yaml 侧：条目 id 不存在、文件不可读、点分路径指空——三种都必须是 error。
  const noComponent = workspaceOf({
    'schedule/phase-1/control.yaml': 'work_packages: []\n',
  }, { 'budget.masonry': { totalTileSqm: 36.7236 } });
  assert.equal(lintFacts({ ...emptyRegistry, contracts: PARITY_CONTRACT }, noComponent).errors[0].code, 'parity_unresolvable');

  const badPath = workspaceOf({
    'schedule/phase-1/control.yaml': 'work_packages:\n  - budget:\n      components:\n        - id: COST-060-08\n          quantity_declared: { total_tile_sqm: 36.7236 }\n',
  }, { 'budget.masonry': {} });
  assert.equal(lintFacts({ ...emptyRegistry, contracts: PARITY_CONTRACT }, badPath).errors[0].code, 'parity_unresolvable');
});

test('quantity_parity：dataset 点分扁平键与逐段下钻两种写法都认', () => {
  const contract: FactsRegistry['contracts'] = [{
    id: 'c.nested_parity',
    kind: 'quantity_parity',
    compare: [
      { label: '扁平键', value: 'dataset:budget.masonry.totalTileSqm' },
      { label: '嵌套键', value: 'dataset:budget.masonry.wallTileSqm' },
    ],
  }];
  const ws = workspaceOf({}, {
    'budget.masonry': { totalTileSqm: 36.7236, wallTileSqm: 36.7236 },
    budget: { masonry: { totalTileSqm: 36.7236 } },
  });
  assert.equal(lintFacts({ ...emptyRegistry, contracts: contract }, ws).errors.length, 0);
});

test('quantity_parity：少于两侧 = 契约本身没写对，报 error 而不是静默通过', () => {
  const contract: FactsRegistry['contracts'] = [{
    id: 'c.one_sided',
    kind: 'quantity_parity',
    compare: [{ label: '只有一侧', value: 'dataset:budget.masonry.totalTileSqm' }],
  }];
  const ws = workspaceOf({}, { 'budget.masonry': { totalTileSqm: 36.7236 } });
  const result = lintFacts({ ...emptyRegistry, contracts: contract }, ws);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'parity_unresolvable');
});

test('quantity_parity：yaml: 侧省略 #<id> 即报错（歧义写法不许静默取错值）', () => {
  const contract: FactsRegistry['contracts'] = [{
    id: 'c.ambiguous_yaml',
    kind: 'quantity_parity',
    compare: [
      { label: '实算', value: 'dataset:budget.masonry.totalTileSqm' },
      { label: '歧义写法', value: 'yaml:config/tile-comparison.yaml.dry_room_ids' },
    ],
  }];
  const ws = workspaceOf({
    'config/tile-comparison.yaml': 'dry_room_ids: [kitchen]\n',
  }, { 'budget.masonry': { totalTileSqm: 36.7236 } });
  const result = lintFacts({ ...emptyRegistry, contracts: contract }, ws);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'parity_unresolvable');
  assert.match(result.errors[0].message, /必须写成 yaml:<路径>#<id>\.<点分路径>/);
});

// ─── single_source ───────────────────────────────────────────────────────────

const SINGLE_SOURCE_CONTRACT: FactsRegistry['contracts'] = [{
  id: 'c.rate_single_source',
  kind: 'single_source',
  scope: ['server/', 'shared/'],
  exclude: ['tests/'],
  patterns: ['gypsum_flat_sqm:\\s*\\{\\s*per_unit:\\s*null'],
}];

test('single_source：只许一份，复制第二份即 error 并列出全部位置', () => {
  const ws = workspaceOf({
    'server/ceiling-quotes.ts': 'export const fallback = {\n  gypsum_flat_sqm: { per_unit: null, unit: \'元/㎡\' },\n};\n',
    'server/mcp-server.ts': 'const copy = {\n  gypsum_flat_sqm: { per_unit: null, unit: \'元/㎡\' },\n};\n',
  }, { 'contract.files': ['server/ceiling-quotes.ts', 'server/mcp-server.ts'] });
  const result = lintFacts({ ...emptyRegistry, contracts: SINGLE_SOURCE_CONTRACT }, ws);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'single_source_violation');
  assert.match(result.errors[0].message, /命中 2 次，期望 1 次/);
  // 两个位置都要报：只报其中一个没法判断该删哪边。
  assert.match(result.errors[0].message, /server\/ceiling-quotes\.ts:2/);
  assert.match(result.errors[0].message, /server\/mcp-server\.ts:2/);
});

test('single_source：exclude 的目录不算违规（测试夹具不是第二份实现）', () => {
  const ws = workspaceOf({
    'server/ceiling-quotes.ts': 'export const fallback = {\n  gypsum_flat_sqm: { per_unit: null, unit: \'元/㎡\' },\n};\n',
    'tests/server/ceiling-quotes.test.ts': 'const fixture = {\n  gypsum_flat_sqm: { per_unit: null, unit: \'元/㎡\' },\n};\n',
  }, { 'contract.files': ['server/ceiling-quotes.ts', 'tests/server/ceiling-quotes.test.ts'] });
  assert.equal(lintFacts({ ...emptyRegistry, contracts: SINGLE_SOURCE_CONTRACT }, ws).errors.length, 0);
});

test('single_source：零命中同样报错——表被删干净不是「通过」', () => {
  const ws = workspaceOf({ 'server/ceiling-quotes.ts': 'export const fallback = {};\n' }, {
    'contract.files': ['server/ceiling-quotes.ts'],
  });
  const result = lintFacts({ ...emptyRegistry, contracts: SINGLE_SOURCE_CONTRACT }, ws);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'single_source_violation');
  assert.match(result.errors[0].message, /命中 0 次/);
});

// ─── 真实仓：五条契约必须都在，且当前全绿 ───────────────────────────────────

test('真实仓：五条对账契约已登记，且 verify-facts 全绿', () => {
  const registry = parseYaml(readFileSync('config/facts.yaml', 'utf8')) as FactsRegistry;
  const ids = (registry.contracts ?? []).map((contract) => contract.id);
  for (const id of [
    'c.masonry_tile_area_parity',
    'c.floor_quantity_parity',
    'c.cabinet_length_parity',
    'c.cabinet_area_parity',
    'c.ceiling_rate_fallback_single_source',
  ]) {
    assert.ok(ids.includes(id), `config/facts.yaml 必须登记 ${id}`);
  }
});

test('真实仓：墙砖面积三处一致（36.7236㎡），橱柜/地面两处口径各自闭合', () => {
  // 直接跑入口脚本：契约 + 机器源 + 登记侧三方一起验，任何一侧坏都红。
  const run = spawnSync('npx', ['tsx', 'scripts/verify/facts/verify-facts.ts'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `verify-facts 必须退出 0。stderr: ${run.stderr}\nstdout: ${run.stdout}`);
  assert.match(run.stdout, /c\.masonry_tile_area_parity：3 处一致 = 36\.72359934708642/);
  assert.match(run.stdout, /c\.floor_quantity_parity：3 处一致 = 123\.34/);
  assert.match(run.stdout, /c\.cabinet_length_parity：3 处一致 = 5\.51/);
  assert.match(run.stdout, /c\.cabinet_area_parity：3 处一致 = 4\.2226/);
});

test('真实仓负例：control.yaml 登记值改坏，verify-facts 必须报 parity_mismatch', () => {
  // 用内存 workspace 复刻真实 registry，只把 COST-060-08 的登记值改坏——
  // 证明这条契约真的能抓到「登记侧停在旧轮次」这类漂移（R11 陈账 15.33 就是实例）。
  const registry = parseYaml(readFileSync('config/facts.yaml', 'utf8')) as FactsRegistry;
  const control = parseYaml(readFileSync('schedule/phase-1/control.yaml', 'utf8')) as any;
  const component = (control.work_packages ?? [])
    .flatMap((pkg: any) => pkg.budget?.components ?? [])
    .find((item: any) => item.id === 'COST-060-08');
  assert.ok(component?.quantity_declared, 'COST-060-08 必须带结构化 quantity_declared');
  component.quantity_declared.total_tile_sqm = 15.33;

  const ws: FactsWorkspace = {
    read: (rel) => { try { return readFileSync(rel, 'utf8'); } catch { return null; } },
    load: (rel) => {
      if (rel === 'schedule/phase-1/control.yaml') return control;
      try { return parseYaml(readFileSync(rel, 'utf8')); } catch { return null; }
    },
    grep: () => [],
    datasets: {
      'budget.masonry': { totalTileSqm: 36.72359934704321 },
      'budget.line_items': { floor: 123.34, wall: 36.72359934704321, cabinet: 3.7496, countertop: 4.96 },
      'budget.cabinet': { countertopLengthM: 4.96, projectedAreaSqm: 3.7496 },
    },
  };
  const result = lintFacts(registry, ws);
  const mismatch = result.errors.find((issue) => issue.code === 'parity_mismatch' && issue.message.includes('c.masonry_tile_area_parity'));
  assert.ok(mismatch, '登记值改坏必须被 c.masonry_tile_area_parity 抓到');
  assert.match(mismatch!.message, /36\.72359934704321/);
  assert.match(mismatch!.message, /15\.33/);
});
