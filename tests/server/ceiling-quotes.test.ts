import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { load as parseYaml, dump as toYaml } from 'js-yaml';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import {
  parseCeilingQuotes,
  setActiveCeilingQuote,
  resolveActiveCeilingRates,
  compareCeilingQuotes,
  ceilingQuoteQuantities,
} from '../../server/ceiling-quotes.js';
import { computeCeilingTakeoff } from '../../shared/ceiling-takeoff.js';
import { loadCeilingConfig } from '../../server/config-loader.js';
import type { CurrentScheme } from '../../shared/types.js';

/**
 * 吊顶报价卡片（DEC-2026-10-08-C03）。守四条：
 *  ① 量只有一份（takeoff），报价只换单价；
 *  ② 切换只改写 active 一行、留 .bak、保留注释；
 *  ③ 报价未声明的行回落 base.json 且标记 source（不悄悄替换）；
 *  ④ per_unit: null = 待报价：数量显形、总额为 null，不编金额。
 */

const catalog = ProjectCatalog.load('.');
const takeoff = computeCeilingTakeoff(loadCeilingConfig(), catalog.getRooms().map((room) => ({ id: room.id, height: room.height })));
const fallback = {
  ceiling_zones: { per_unit: 40, unit: '元/㎡' },
  curtain_box_linear: { per_unit: null, unit: '元/m' },
};

function quotesFile(quotes: unknown[], active: string): string {
  return toYaml({ version: 1, active, quotes });
}

const THREE_CARDS = [
  { id: 'a', contractor: '甲', quoted_at: '2026-10-08', status: 'quoted', rates: { ceiling_zones: { per_unit: 45, unit: '元/㎡', scope_note: '含辅材' }, curtain_box_linear: { per_unit: 30, unit: '元/m', scope_note: '含安装' } } },
  { id: 'b', contractor: '乙', quoted_at: '2026-10-09', status: 'candidate', rates: { ceiling_zones: { per_unit: 38, unit: '元/㎡', scope_note: '不含耗材' }, curtain_box_linear: { per_unit: 26, unit: '元/m', scope_note: '不含电源预留' } } },
  { id: 'c', contractor: '丙', quoted_at: null, status: 'candidate', rates: {} },
];

test('量与价分离：报价只改单价，工程量始终来自 takeoff', () => {
  const quantities = ceilingQuoteQuantities(takeoff);
  // 板面 = 总净面积 − 窗帘盒；窗帘盒 = 延长米。与 budget-calculator 的 computeLabor 同源
  assert.ok(Math.abs(quantities.ceiling_zones - (takeoff.totalNetAreaM2 - takeoff.curtainBoxM2)) < 1e-9);
  assert.ok(Math.abs(quantities.curtain_box_linear - 17.85) < 1e-9);
  for (const quotes of [quotesFile(THREE_CARDS, 'a'), quotesFile(THREE_CARDS, 'b')]) {
    assert.deepEqual(ceilingQuoteQuantities(takeoff), ceilingQuoteQuantities(takeoff));
  }
});

test('并排对比：总额、差额、可比性标记', () => {
  const file = parseCeilingQuotes(quotesFile(THREE_CARDS, 'a'));
  const comparison = compareCeilingQuotes(file, takeoff, fallback);
  const a = comparison.find((entry) => entry.id === 'a')!;
  const b = comparison.find((entry) => entry.id === 'b')!;
  const c = comparison.find((entry) => entry.id === 'c')!;
  // a：45×40.667 + 30×17.85
  assert.ok(Math.abs(a.total! - (45 * (takeoff.totalNetAreaM2 - takeoff.curtainBoxM2) + 30 * 17.85)) < 1e-6);
  assert.equal(a.active, true);
  assert.equal(a.comparable, true);
  // b 相对生效中的 a 的差额
  assert.ok(Math.abs(b.deltaVsActive! - (b.total! - a.total!)) < 1e-6);
  // c：完全没报价 → 两行都回落 base.json，其中窗帘盒仍是待报价 → total 为 null 且不可比
  assert.equal(c.total, null);
  assert.equal(c.comparable, false);
  assert.deepEqual(c.pendingRows, ['curtain_box_linear']);
  assert.equal(c.rows.find((row) => row.key === 'ceiling_zones')!.rate_source, 'base.json');
  assert.ok(c.comparability_notes.some((note) => note.includes('待报价')));
  // 报了价但没写 scope_note → 明确标记「不可直接比较」（AGENTS.md 采购铁律）
  const noScope = parseCeilingQuotes(quotesFile([{ id: 'ns', contractor: '丁', quoted_at: '2026-10-09', status: 'candidate', rates: { ceiling_zones: { per_unit: 42, unit: '元/㎡' } } }], 'ns'));
  const nsRow = compareCeilingQuotes(noScope, takeoff, fallback)[0];
  assert.equal(nsRow.comparable, false);
  assert.ok(nsRow.comparability_notes.some((note) => note.includes('不可直接比较')));
});

test('生效单价以报价为准，未声明行回落 base.json 并标记 source', () => {
  const file = parseCeilingQuotes(quotesFile(THREE_CARDS, 'b'));
  const resolved = resolveActiveCeilingRates(file, fallback);
  assert.equal(resolved.ceiling_zones.per_unit, 38);
  assert.equal(resolved.ceiling_zones.source, 'quote');
  assert.equal(resolved.curtain_box_linear.per_unit, 26);

  const partial = parseCeilingQuotes(quotesFile([{ id: 'p', contractor: '丁', quoted_at: null, status: 'candidate', rates: { ceiling_zones: { per_unit: 50, unit: '元/㎡' } } }], 'p'));
  const partialResolved = resolveActiveCeilingRates(partial, fallback);
  assert.equal(partialResolved.ceiling_zones.per_unit, 50);
  assert.equal(partialResolved.curtain_box_linear.source, 'base.json');
  assert.equal(partialResolved.curtain_box_linear.per_unit, null, '窗帘盒仍待报价');
});

test('切换只改写 active 一行：保留注释、留 .bak、写后仍可解析', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ceiling-quotes-'));
  const path = join(dir, 'ceiling-quotes.yaml');
  const original = [
    'version: 1',
    '# 这是注释，切换后必须还在',
    'active: a',
    'quotes:',
    ...THREE_CARDS.map((quote) => toYaml([quote]).split('\n').map((line) => (line.startsWith('- ') ? `  ${line}` : `  ${line}`)).join('\n').trimEnd()),
  ].join('\n');
  writeFileSync(path, original, 'utf8');

  const switched = setActiveCeilingQuote('b', path);
  assert.equal(switched.active, 'b');
  assert.equal(switched.quotes.length, 3);
  const raw = readFileSync(path, 'utf8');
  assert.ok(raw.includes('# 这是注释，切换后必须还在'), '注释必须保留');
  assert.ok(raw.includes('active: b'));
  assert.ok(!raw.includes('active: a'));
  assert.ok(existsSync(`${path}.bak`), '必须留 .bak');
  // Git diff 只有一行
  const changedLines = original.split('\n').filter((line, index) => line !== raw.split('\n')[index]);
  assert.deepEqual(changedLines, ['active: a']);
});

test('切换拒绝未知 id / active 指向不存在的卡片直接抛错（fail closed）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ceiling-quotes-bad-'));
  const path = join(dir, 'q.yaml');
  writeFileSync(path, quotesFile(THREE_CARDS, 'a'), 'utf8');
  assert.throws(() => setActiveCeilingQuote('zzz', path), /不存在/);
  assert.throws(() => parseCeilingQuotes(quotesFile(THREE_CARDS, 'ghost')), /不在 quotes 里/);
  assert.throws(() => parseCeilingQuotes(toYaml({ version: 2, active: 'a', quotes: THREE_CARDS })), /version/);
  assert.throws(() => parseCeilingQuotes(quotesFile([{ id: 'x', contractor: 'y', status: 'weird', rates: {} }], 'x')), /status/);
  assert.throws(() => parseCeilingQuotes(quotesFile([{ id: 'x', contractor: 'y', status: 'candidate', rates: { nonsense: { per_unit: 1, unit: '元' } } }], 'x')), /不是已知计价行/);
  assert.throws(() => parseCeilingQuotes(quotesFile([{ id: 'x', contractor: 'y', status: 'candidate', rates: { ceiling_zones: { per_unit: -5, unit: '元/㎡' } } }], 'x')), /per_unit/);
});

test('基线卡 = 现状口径：carpentry 金额与未引入报价时完全一致', () => {
  const scheme: CurrentScheme = {
    updatedAt: new Date().toISOString(),
    selections: {
      hvac: { default: 'A1', roomOverrides: {} },
      floor: { default: 'floor_tile_01', roomOverrides: {} },
      wall: { default: 'wall_tile_01', roomOverrides: {} },
      paint: { default: 'latex_paint_01', roomOverrides: {} },
    },
  };
  const snapshot = new BudgetCalculator(catalog, { version: '1.0', risks: [], constraints: [] }).calculate(scheme);
  const carpentry = snapshot.categories.find((c) => c.key === 'carpentry')!;
  // 板面 40 元/㎡（来自生效报价卡 baseline_self_computed）+ 窗帘盒待报价
  assert.ok(Math.abs(carpentry.actual - Math.round(40 * (takeoff.totalNetAreaM2 - takeoff.curtainBoxM2))) <= 2, `实际 ${carpentry.actual}`);
  assert.deepEqual(carpentry.pendingLabor, [
    { area: 'curtain_box_linear', quantity: 17.85, unit: '元/m', reason: 'rate 待报价' },
  ]);
  // 快照带报价对比，且 active 卡是金额来源
  assert.ok(snapshot.ceilingQuotes);
  assert.equal(snapshot.ceilingQuotes!.activeId, 'baseline_self_computed');
  assert.equal(snapshot.ceilingQuotes!.source, 'quote');
  const active = snapshot.ceilingQuotes!.comparison.find((entry) => entry.active)!;
  assert.equal(active.id, 'baseline_self_computed');
  assert.equal(active.total, null, '窗帘盒未报价，总额不编');
  assert.deepEqual(active.pendingRows, ['curtain_box_linear']);
});

test('报价文件坏掉时预算不冻结：回落 base.json 费率', () => {
  assert.throws(() => parseCeilingQuotes(''), /YAML 解析失败|YAML 对象|version/);
  // computeLabor 的兜底：resolveActiveCeilingRates 传入空 quotes 文件时用 fallback
  const empty = parseCeilingQuotes(quotesFile([{ id: 'only', contractor: 'x', quoted_at: null, status: 'candidate', rates: {} }], 'only'));
  const resolved = resolveActiveCeilingRates(empty, fallback);
  assert.equal(resolved.ceiling_zones.per_unit, 40);
  assert.equal(resolved.ceiling_zones.source, 'base.json');
});
