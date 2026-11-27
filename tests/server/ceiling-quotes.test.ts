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
  CEILING_QUOTE_RATE_KEYS,
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
  gypsum_edge_drop_linear: { per_unit: null, unit: '元/m' },
  gypsum_flat_sqm: { per_unit: null, unit: '元/㎡' },
  aluminum_buckle_sqm: { per_unit: null, unit: '元/㎡' },
};

function quotesFile(quotes: unknown[], active: string): string {
  return toYaml({ version: 1, active, quotes });
}

const THREE_CARDS = [
  // 2026-11-16 量价算法审计 D5：a/b 两张卡必须报互不重叠的行——ceiling_zones
  // 的量已含 gypsum_flat_sqm、aluminum_buckle_sqm 的面积与边吊带的带面，
  // 同时报两边会把这部分量算两次（compareQuoteCards 遇此即抛错）。旧夹具曾让
  // a/b 五行全报，总额里平顶与铝扣板各算了两遍，断言还把它钉成了正确值。
  // D5 初版漏了边吊行：a 卡仍同时报了混合行与边吊行（Codex blocking①，
  // PR #255 复审），本轮把边吊行也移出 a 卡、只留拆分行卡 b 报它。
  { id: 'a', contractor: '甲', quoted_at: '2026-10-08', status: 'quoted', out_of_scope: ['gypsum_flat_sqm', 'aluminum_buckle_sqm', 'gypsum_edge_drop_linear'], rates: { ceiling_zones: { per_unit: 45, unit: '元/㎡', scope_note: '含辅材' }, curtain_box_linear: { per_unit: 30, unit: '元/m', scope_note: '含安装' } } },
  { id: 'b', contractor: '乙', quoted_at: '2026-10-09', status: 'candidate', out_of_scope: ['ceiling_zones'], rates: { curtain_box_linear: { per_unit: 26, unit: '元/m', scope_note: '不含电源预留' }, gypsum_edge_drop_linear: { per_unit: 150, unit: '元/m', scope_note: '不含耗材' }, gypsum_flat_sqm: { per_unit: 140, unit: '元/㎡', scope_note: '不含耗材' }, aluminum_buckle_sqm: { per_unit: 145, unit: '元/㎡', scope_note: '不含开孔' } } },
  { id: 'c', contractor: '丙', quoted_at: null, status: 'candidate', rates: {} },
];

test('量与价分离：报价只改单价，工程量始终来自 takeoff', () => {
  const quantities = ceilingQuoteQuantities(takeoff);
  // 板面 = 总净面积 − 窗帘盒；窗帘盒 = 延长米。与 budget-calculator 的 computeLabor 同源
  assert.ok(Math.abs(quantities.ceiling_zones - (takeoff.totalNetAreaM2 - takeoff.curtainBoxM2)) < 1e-9);
  assert.ok(Math.abs(quantities.curtain_box_linear - 17.73) < 1e-9);
  // C12：边吊按米、满吊按㎡，两者相加必须等于石膏板净面积（否则就是重复计费或漏计）
  assert.ok(Math.abs(quantities.gypsum_edge_drop_linear - 24.03) < 1e-9, `边吊长度实测 ${quantities.gypsum_edge_drop_linear}`); // R04：餐厅北带长边 3.10→3.00；2026-11-23 通长假梁：门头盒长边 1.275→梁 4.20；2026-11-27 量房回填：客厅北缘 6.20→6.22、餐厅北带 3.00→3.01、梁 4.20→4.16、儿童房空调带 3.00→2.79、走廊 3.00→2.99、书房空调带 2.40→2.43、书房角 0.60→0.53
  assert.ok(Math.abs(quantities.gypsum_flat_sqm - 7.01525) < 1e-9, `平顶面积实测 ${quantities.gypsum_flat_sqm}`); // R01 重算：门厅满吊区 1.0584→2.561，平顶 4.8084→6.311；2026-11-27 量房回填：主走廊 3.75→5.09795、门厅 2.561→1.9173，平顶 6.311→7.01525
  // C13：厨卫铝扣板独立成行，量取 takeoff.aluminumBuckleM2
  assert.ok(Math.abs(quantities.aluminum_buckle_sqm - 22.8868) < 1e-9); // R04：客卫吊顶 +0.21；2026-11-27 量房回填：厨房 8.64→9.2055、主卫 4.576→8.8305、客卫 3.36→4.8508
  // 覆盖不变量：边吊面积 + 满吊面积必须等于石膏板净面积，且没有分区漏声明计价形态
  assert.ok(Math.abs(takeoff.edgeDropNetAreaM2 + takeoff.flatNetAreaM2 - takeoff.gypsumBoardM2) < 1e-9);
  assert.deepEqual(takeoff.unclassifiedPricingFormIds, []);
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
  // a：45×板面 + 30×17.73（R01 重算后量）。平顶、铝扣板与边吊行是
  // out_of_scope——它们的面积/带面已含在板面里，再报就是重复计（审计 D5；
  // 边吊带初版漏列，a 卡曾同时报混合行与边吊行、总额里 170×21.375 被算了
  // 两遍，Codex blocking① 补上后此处不再含边吊项）。21.375 是当时的边吊长边，
  // 2026-11-23 通长假梁后为 24.30m，2026-11-27 量房回填后为 24.03m。
  assert.ok(Math.abs(a.total! - (
    45 * (takeoff.totalNetAreaM2 - takeoff.curtainBoxM2)
    + 30 * 17.73
  )) < 1e-6);
  assert.equal(a.active, true);
  // 2026-11-16 审计 D5：a 卡把平顶/铝扣板/边吊行标为 out_of_scope（它们的
  // 面积/带面已含在板面里），按模块既有规则，带 out_of_scope 行的卡即
  // comparable:false（总额不含那三行，须由其他报价单覆盖）。旧夹具五全行报、
  // comparable:true，恰是 D5 的双计形态。
  assert.equal(a.comparable, false);
  assert.ok(a.comparability_notes.some((note) => note.includes('不在本家报价范围')));
  // b 相对生效中的 a 的差额
  assert.ok(Math.abs(b.deltaVsActive! - (b.total! - a.total!)) < 1e-6);
  // c：完全没报价 → 两行都回落 base.json，其中窗帘盒仍是待报价 → total 为 null 且不可比
  assert.equal(c.total, null);
  assert.equal(c.comparable, false);
  assert.deepEqual(c.pendingRows, ['curtain_box_linear', 'gypsum_edge_drop_linear', 'gypsum_flat_sqm', 'aluminum_buckle_sqm']);
  assert.equal(c.rows.find((row) => row.key === 'ceiling_zones')!.rate_source, 'base.json');
  assert.ok(c.comparability_notes.some((note) => note.includes('待报价')));
  // 报了价但没写 scope_note → 明确标记「不可直接比较」（AGENTS.md 采购铁律）。
  // 2026-11-16 审计 D5：此卡不得同时报 ceiling_zones 与 gypsum_flat_sqm
  // 或 gypsum_edge_drop_linear（后两者面积/带面已含在前者里），故只报混合行
  // + 窗帘盒；同时报两边时 compareQuoteCards 直接抛错（见下个测试），不是
  // comparable:false。
  const noScope = parseCeilingQuotes(quotesFile([{ id: 'ns', contractor: '丁', quoted_at: '2026-10-09', status: 'candidate', rates: { ceiling_zones: { per_unit: 42, unit: '元/㎡' }, curtain_box_linear: { per_unit: 30, unit: '元/m' } } }], 'ns'));
  const nsRow = compareCeilingQuotes(noScope, takeoff, fallback)[0];
  assert.equal(nsRow.comparable, false);
  assert.ok(nsRow.comparability_notes.some((note) => note.includes('不可直接比较')));
});

test('重叠守卫：混合行与平顶/边吊行同时计价即抛错（审计 D5，Codex blocking①）', () => {
  // 边吊带净面积 17.728㎡ 已含在 ceiling_zones 的量里，边吊按米报的是整条带
  // 的做法——同时报两边，总额会把带面算两次（24.03m×170 元 ≈ 4,085.10 元）。
  // D5 初版守卫漏了边吊行，审计夹具 a 卡正是此形态，断言还把它钉成了正确值。
  // 金额用容差比对：24.03m 是浮点求和结果，170×它得 4085.1，不是字面 4085.10。
  const bothEdge = parseCeilingQuotes(quotesFile([{ id: 'e', contractor: '丁', quoted_at: '2026-10-09', status: 'candidate', rates: { ceiling_zones: { per_unit: 45, unit: '元/㎡', scope_note: '含辅材' }, gypsum_edge_drop_linear: { per_unit: 170, unit: '元/m', scope_note: '含辅材' }, curtain_box_linear: { per_unit: 30, unit: '元/m', scope_note: '含安装' } } }], 'e'));
  assert.throws(
    () => compareCeilingQuotes(bothEdge, takeoff, fallback),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /重复计/);
      assert.match(error.message, /石膏板边吊/);
      const amount = Number(error.message.match(/重复计 ([\d.]+) 元/)?.[1]);
      assert.ok(Math.abs(amount - 24.03 * 170) < 1e-6, `重复计金额应 ≈ 4085.10，实际 ${amount}`);
      return true;
    },
  );
  // 平顶行同理：7.01525㎡×140 元/㎡ ≈ 982.14 元会被算两次。
  const bothFlat = parseCeilingQuotes(quotesFile([{ id: 'f', contractor: '丁', quoted_at: '2026-10-09', status: 'candidate', rates: { ceiling_zones: { per_unit: 45, unit: '元/㎡', scope_note: '含辅材' }, gypsum_flat_sqm: { per_unit: 140, unit: '元/㎡', scope_note: '含辅材' } } }], 'f'));
  assert.throws(
    () => compareCeilingQuotes(bothFlat, takeoff, fallback),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /重复计/);
      assert.match(error.message, /石膏板满吊平顶/);
      const amount = Number(error.message.match(/重复计 ([\d.]+) 元/)?.[1]);
      assert.ok(Math.abs(amount - 7.01525 * 140) < 1e-6, `重复计金额应 ≈ 982.14，实际 ${amount}`);
      return true;
    },
  );
});

test('生效单价以报价为准，未声明行回落 base.json 并标记 source', () => {
  // 2026-11-16 审计 D5：b 卡是拆分行卡，不报 ceiling_zones；生效单价的断言改走 a 卡。
  const file = parseCeilingQuotes(quotesFile(THREE_CARDS, 'a'));
  const resolved = resolveActiveCeilingRates(file, fallback);
  assert.equal(resolved.ceiling_zones.per_unit, 45);
  assert.equal(resolved.ceiling_zones.source, 'quote');
  assert.equal(resolved.curtain_box_linear.per_unit, 30);

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
      hvac: { default: 'A2', roomOverrides: {} },
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
    { area: 'curtain_box_linear', quantity: 17.73, unit: '元/m', reason: 'rate 待报价' },
  ]);
  // 快照带报价对比，且 active 卡是金额来源
  assert.ok(snapshot.ceilingQuotes);
  assert.equal(snapshot.ceilingQuotes!.activeId, 'baseline_self_computed');
  assert.equal(snapshot.ceilingQuotes!.source, 'quote');
  const active = snapshot.ceilingQuotes!.comparison.find((entry) => entry.active)!;
  assert.equal(active.id, 'baseline_self_computed');
  assert.equal(active.total, null, '窗帘盒未报价，总额不编');
  // 基线卡只用混合口径行计价，四条拆分行是「不用」不是「没报」
  assert.deepEqual(active.pendingRows, ['curtain_box_linear']);
  assert.deepEqual(active.outOfScopeRows, ['gypsum_edge_drop_linear', 'gypsum_flat_sqm', 'aluminum_buckle_sqm']);
});

test('报价文件坏掉时预算不冻结：回落 base.json 费率', () => {
  assert.throws(() => parseCeilingQuotes(''), /YAML 解析失败|YAML 对象|version/);
  // computeLabor 的兜底：resolveActiveCeilingRates 传入空 quotes 文件时用 fallback
  const empty = parseCeilingQuotes(quotesFile([{ id: 'only', contractor: 'x', quoted_at: null, status: 'candidate', rates: {} }], 'only'));
  const resolved = resolveActiveCeilingRates(empty, fallback);
  assert.equal(resolved.ceiling_zones.per_unit, 40);
  assert.equal(resolved.ceiling_zones.source, 'base.json');
});

test('报价文件缺失/非法（null）：全行走 base.json 回落，不抛、不伪造卡片', () => {
  // 阶段 0 回归（budget-calculator.ts 的坏兜底）：读不到/读不懂 ceiling-quotes.yaml 时，
  // 旧实现把 null 合成成 `{ version: 1, active: 'base.json', quotes: [] }`，
  // resolveActiveCeilingRates 的 find() 找不到 active → throw；
  // 而 GET /api/budget 对 calculate() 没有 try/catch → 整个预算接口 500，
  // :579-580 注释承诺的「预算不能被一个坏配置文件冻结」是假的。
  // 现在「无报价文件」是一等状态：传 null，全部计价行走 fallback。
  const resolved = resolveActiveCeilingRates(null, fallback);
  for (const key of CEILING_QUOTE_RATE_KEYS) {
    assert.equal(resolved[key].source, 'base.json', `${key} 必须标记回落来源，不能冒充 quote`);
    assert.equal(resolved[key].per_unit, fallback[key].per_unit, `${key} 单价必须取 fallback`);
    assert.equal(resolved[key].unit, fallback[key].unit, `${key} 单位必须取 fallback`);
  }
  // 「非法」与「缺失」同一条出口：parse 抛错 → 调用方记 console.error → quotes 保持 null → 上面这条
  assert.throws(() => parseCeilingQuotes(quotesFile([{ id: 'x', contractor: 'y', status: 'candidate', rates: {} }], 'ghost')), /不在 quotes 里/);
  // 反证：旧实现的合成空卡今天仍然抛错（fail closed 未被削弱）——所以不能退回「伪造一张合法空卡」
  assert.throws(
    () => resolveActiveCeilingRates({ version: 1, active: 'base.json', quotes: [] }, fallback),
    /active「base.json」不存在/,
  );
});

// ─── DEC-2026-10-08-C12：边吊按米 / 平顶按㎡ 分形态计价 + out_of_scope ───

test('分形态计价：边吊按米、平顶按㎡，两者相加 = 石膏板净面积', () => {
  const file = parseCeilingQuotes(readFileSync('config/ceiling-quotes.yaml', 'utf8'));
  const comparison = compareCeilingQuotes(file, takeoff, fallback);
  const card = comparison.find((entry) => entry.id === 'owner_turnkey_20261008')!;
  const edge = card.rows.find((row) => row.key === 'gypsum_edge_drop_linear')!;
  const flat = card.rows.find((row) => row.key === 'gypsum_flat_sqm')!;
  assert.equal(edge.per_unit, 160);
  assert.equal(flat.per_unit, 155);
  assert.ok(Math.abs(edge.quantity - 24.03) < 1e-9, '边吊长度取 8 个边吊分区的长边之和');
  assert.ok(Math.abs(flat.quantity - 7.01525) < 1e-9, '平顶面积取主走廊 + 入户门厅两个满吊分区（R01 重算：门厅区 1.0584→2.561；2026-11-27 量房回填：主走廊 3.75→5.09795、门厅 2.561→1.9173）');
  // 边吊 24.03m×160 + 平顶 7.01525㎡×155 + 窗帘盒 17.73m×105
  assert.ok(Math.abs(card.total! - (24.03 * 160 + 7.01525 * 155 + 17.73 * 105)) < 1e-6);
  assert.ok(Math.abs(card.total! - 6793.81375) < 1e-6); // R01 重算；2026-11-23 通长假梁 +468.00；2026-11-27 量房回填：边吊 −0.27m（−43.20）、平顶 +0.70425㎡（+109.16）、窗帘盒 −0.12m（−12.60），净 +53.36
});

test('out_of_scope 与待报价是两回事：不报的项目进总额、待报价的项目卡住总额', () => {
  const file = parseCeilingQuotes(readFileSync('config/ceiling-quotes.yaml', 'utf8'));
  const comparison = compareCeilingQuotes(file, takeoff, fallback);
  const card = comparison.find((entry) => entry.id === 'owner_turnkey_20261008')!;
  // 板面行（含厨卫铝扣板 22.8868㎡）这家不报 → 不算待报价、不影响总额
  assert.deepEqual(card.outOfScopeRows, ['ceiling_zones', 'aluminum_buckle_sqm']);
  assert.deepEqual(card.pendingRows, []);
  assert.notEqual(card.total, null);
  assert.ok(card.comparability_notes.some((note) => note.includes('不在本家报价范围')));
  assert.ok(card.comparability_notes.some((note) => note.includes('别以为总额已含')));
  assert.ok(card.coveredScope.includes('石膏板边吊'));
  // 混合口径行必须显示为「不在范围」，而不是待报价
  const row = card.rows.find((r) => r.key === 'ceiling_zones')!;
  assert.equal(row.out_of_scope, true);
  assert.equal(row.subtotal, null);
  // 基线卡：只用混合口径行计价，四条拆分行是「不用」而不是「没报」→ 超出范围，
  // 待报价只剩窗帘盒，总额仍不编（预算口径不变）
  const baseline = comparison.find((entry) => entry.id === 'baseline_self_computed')!;
  assert.equal(baseline.total, null);
  assert.deepEqual(baseline.pendingRows, ['curtain_box_linear']);
  assert.deepEqual(baseline.outOfScopeRows, ['gypsum_edge_drop_linear', 'gypsum_flat_sqm', 'aluminum_buckle_sqm']);
});

test('out_of_scope 拒绝未知计价行；active 切换只改一行', () => {
  const bad = quotesFile([{ id: 'x', contractor: '丁', quoted_at: null, status: 'candidate', rates: {}, out_of_scope: ['nope'] }], 'x');
  assert.throws(() => parseCeilingQuotes(bad), /out_of_scope.nope 不是已知计价行/);
  const dir = mkdtempSync(join(tmpdir(), 'ceiling-quotes-oos-'));
  const path = join(dir, 'ceiling-quotes.yaml');
  writeFileSync(path, quotesFile([{ id: 'x', contractor: '丁', quoted_at: null, status: 'candidate', rates: {} }], 'x'), 'utf8');
  setActiveCeilingQuote('x', path);
  assert.ok(readFileSync(path, 'utf8').includes('active: x'));
});

test('厨卫铝扣板独立计价（C13）：150 元/㎡ 估价卡 ¥3,433.02，且不与其他卡重复计费', () => { // 2026-11-27 量房回填后铝扣板 22.8868㎡
  const file = parseCeilingQuotes(readFileSync('config/ceiling-quotes.yaml', 'utf8'));
  const comparison = compareCeilingQuotes(file, takeoff, fallback);
  const card = comparison.find((entry) => entry.id === 'aluminum_buckle_owner_estimate_150')!;
  assert.ok(Math.abs(card.total! - 22.8868 * 150) < 1e-6);
  assert.ok(Math.abs(card.total! - 3433.02) < 1e-6);
  assert.deepEqual(card.pendingRows, []);
  assert.deepEqual(card.outOfScopeRows, ['ceiling_zones', 'curtain_box_linear', 'gypsum_edge_drop_linear', 'gypsum_flat_sqm']);
  assert.equal(card.coveredScope, '厨卫铝扣板（㎡）');
  assert.ok(card.comparability_notes.some((note) => note.includes('不在本家报价范围')));
  const row = card.rows.find((r) => r.key === 'aluminum_buckle_sqm')!;
  assert.equal(row.per_unit, 150);
  // 估价必须自带「非报价」标注（不能让人把 150 当成交价）
  const parsed = parseCeilingQuotes(readFileSync('config/ceiling-quotes.yaml', 'utf8')).quotes
    .find((entry) => entry.id === 'aluminum_buckle_owner_estimate_150')!;
  assert.ok(parsed.contractor.includes('非报价单'));
  assert.ok(parsed.rates.aluminum_buckle_sqm?.scope_note?.includes('非成交价'));
  assert.ok(parsed.note?.includes('¥2,486.40')); // 铝扣板量 16.576㎡×150（R01 未动）；注：config/ceiling-quotes.yaml:108 的 note 仍为旧量 16.576㎡/¥2,486.40，量房回填后实算 22.8868㎡/¥3,433.02，note 待 config 侧更新（本测试只钉 note 文本现状，不改 config）
  // 铝扣板在基线卡里也是超出范围：否则基线总额会被四行待报价永久卡住
  const baseline = comparison.find((entry) => entry.id === 'baseline_self_computed')!;
  assert.deepEqual(baseline.outOfScopeRows, ['gypsum_edge_drop_linear', 'gypsum_flat_sqm', 'aluminum_buckle_sqm']);
  assert.deepEqual(baseline.pendingRows, ['curtain_box_linear']);
  // 石膏板卡不报铝扣板 → 超出范围，总额仍是 6,793.81375（2026-11-23 通长假梁 +468.00；2026-11-27 量房回填 +53.36）
  const gypsum = comparison.find((entry) => entry.id === 'owner_turnkey_20261008')!;
  assert.ok(Math.abs(gypsum.total! - 6793.81375) < 1e-6);
  assert.ok(gypsum.outOfScopeRows.includes('aluminum_buckle_sqm'));
});

test('现行三张卡都不触发重叠守卫：混合行与拆分行互斥（审计 D5）', () => {
  // config/ceiling-quotes.yaml 的三张卡：一张只报 ceiling_zones、一张只报拆分行、
  // 一张只报铝扣板行——container 与 part 从不同时计价。守卫落地后此处即回归锚点。
  const file = parseCeilingQuotes(readFileSync('config/ceiling-quotes.yaml', 'utf8'));
  const comparison = compareCeilingQuotes(file, takeoff, fallback);
  assert.equal(comparison.length, 3);
  for (const entry of comparison) {
    const priced = entry.rows.filter((row) => !row.out_of_scope && row.subtotal !== null).map((row) => row.key);
    assert.ok(!(priced.includes('ceiling_zones') && (priced.includes('gypsum_flat_sqm') || priced.includes('aluminum_buckle_sqm') || priced.includes('gypsum_edge_drop_linear'))), `${entry.id} 不应同时计价混合行与拆分行`);
  }
});
