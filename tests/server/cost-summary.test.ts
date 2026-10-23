import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { load as parseYaml } from 'js-yaml';
import {
  buildCostSummary,
  computeActiveMepQuote,
  renderCostSummary,
  type CostSummaryData,
} from '../../scripts/schedule/cost-summary.js';

/**
 * 成本总表（schedule/phase-1/cost.md）的口径防线。业主 2026-10-23 裁定：
 * 只列实际成本、planned_cny 不得垫数、硬装含中央空调、未定价不按 0 计入合计。
 * 这里钉死的是**机制**而不是某个金额：金额随数据变，机制不许退化。
 */

type AnyRecord = Record<string, any>;

const control = parseYaml(readFileSync('schedule/phase-1/control.yaml', 'utf8')) as AnyRecord;
const data: CostSummaryData = buildCostSummary(control);

const pkgOf = (root: AnyRecord, id: string): AnyRecord =>
  (root.work_packages as AnyRecord[]).find((pkg) => pkg.id === id) as AnyRecord;
const rowById = (summary: CostSummaryData, id: string) =>
  summary.rows.find((row) => row.id === id);

describe('成本总表 cost-summary', () => {
  it('已知小计恰为各定价行之和，每行金额为正整数', () => {
    const sum = data.rows.reduce((acc, row) => acc + (row.amountCny ?? 0), 0);
    assert.equal(data.knownSubtotalCny, sum);
    assert.ok(data.rows.length > 0);
    for (const row of data.rows) {
      assert.ok(typeof row.amountCny === 'number' && Number.isInteger(row.amountCny) && row.amountCny > 0,
        `${row.id} 金额必须是正整数，实际 ${row.amountCny}`);
      assert.ok(row.grade.length > 0 && row.derivation.length > 0, `${row.id} 必须有成色与推导`);
    }
  });

  it('未定价恰为五项、金额全为 null 且不计入合计', () => {
    assert.deepEqual(
      data.unpriced.map((row) => row.packageIds[0]).sort(),
      ['PKG-005', 'PKG-050', 'PKG-090', 'PKG-125', 'PKG-135'],
    );
    for (const row of data.unpriced) assert.equal(row.amountCny, null, `${row.id} 未定价行金额必须为 null`);
    const pricedPackages = new Set(data.rows.flatMap((row) => row.packageIds));
    for (const row of data.unpriced) {
      // 防水（PKG-050）是唯一例外：人工已定价、材料未定价，同一包两边各出现一次且必须成对
      if (row.packageIds[0] === 'PKG-050') continue;
      assert.ok(!pricedPackages.has(row.packageIds[0]), `${row.packageIds[0]} 同时出现在定价行与未定价清单`);
    }
    assert.ok(pricedPackages.has('PKG-050'), '防水人工应在定价行内');
  });

  it('防垫数回归：篡改全部 planned_cny 后，每行金额逐分不变', () => {
    const doctored = structuredClone(control) as AnyRecord;
    for (const pkg of doctored.work_packages as AnyRecord[]) {
      if (pkg.budget && typeof pkg.budget.planned_cny === 'number') pkg.budget.planned_cny = 999_999;
      for (const component of pkg.budget?.components ?? []) {
        if (typeof component.planned_cny === 'number') component.planned_cny = 888_888;
      }
    }
    for (const pool of doctored.budget_pools as AnyRecord[]) pool.planned_cny = 777_777;
    const rebuilt = buildCostSummary(doctored);
    assert.deepEqual(
      rebuilt.rows.map((row) => [row.id, row.amountCny]),
      data.rows.map((row) => [row.id, row.amountCny]),
    );
    assert.equal(rebuilt.knownSubtotalCny, data.knownSubtotalCny);
  });

  it('每行金额与声明来源逐项一致', () => {
    assert.equal(rowById(data, 'cost-hvac')?.amountCny, pkgOf(control, 'PKG-030').budget.contracted_cny);
    assert.equal(rowById(data, 'cost-masonry')?.amountCny, pkgOf(control, 'PKG-060').budget.estimated_need_cny);
    assert.equal(rowById(data, 'cost-ceiling')?.amountCny, pkgOf(control, 'PKG-070').budget.estimated_need_cny);
    assert.equal(rowById(data, 'cost-sanitary')?.amountCny, pkgOf(control, 'PKG-100').budget.estimated_need_cny);
    assert.equal(rowById(data, 'cost-cabinet')?.amountCny, pkgOf(control, 'PKG-110').budget.estimated_need_cny);
    const groutQr = (control.hard_finish_quote_rounds.records as AnyRecord[])
      .find((record) => record.id === 'QR-2026-10-03-07') as AnyRecord;
    assert.equal(rowById(data, 'cost-grout')?.amountCny, groutQr.owner_target_cny);
    const { comparison } = computeActiveMepQuote();
    assert.equal(rowById(data, 'cost-mep')?.amountCny, Math.round(comparison.total as number));
  });

  it('中央空调在硬装板块内，不单列为非硬装', () => {
    const hvacRow = rowById(data, 'cost-hvac');
    assert.ok(hvacRow, '必须有空调行');
    assert.deepEqual(hvacRow.packageIds, ['PKG-030', 'PKG-140']);
    const markdown = renderCostSummary(data, '# 测试表头\n\n');
    const sectionIndex = markdown.indexOf('## 硬装成本（含中央空调）');
    const hvacIndex = markdown.indexOf('| 中央空调 |');
    assert.ok(sectionIndex >= 0 && hvacIndex > sectionIndex, '空调行必须位于硬装板块标题之下');
    assert.ok(!markdown.includes('非硬装'), '不得出现把空调划到硬装之外的板块');
  });

  it('渲染纪律：小计标注含未定价说明，未定价行不显示金额', () => {
    const markdown = renderCostSummary(data, '# 测试表头\n\n');
    assert.ok(markdown.includes('已知小计（不含未定价）'));
    assert.ok(markdown.includes(`¥${data.knownSubtotalCny.toLocaleString('zh-CN')}`));
    for (const row of data.unpriced) {
      const line = markdown.split('\n').find((text) => text.startsWith(`| ${row.name} |`));
      assert.ok(line, `未定价清单必须含 ${row.name}`);
      assert.equal(line.split('|')[3]?.trim(), '未定价', `${row.name} 的成本列必须是「未定价」而不是金额`);
    }
  });
});
