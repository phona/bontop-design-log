import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { load as parseYaml } from 'js-yaml';
import {
  assertVerifiedTierBasis,
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

  it('小计分层：每行恰属一层，已核实 + 暂估 = 已知合计', () => {
    for (const row of data.rows) {
      assert.ok(row.tier === 'verified' || row.tier === 'provisional', `${row.id} 必须有且仅有一个层级`);
      assert.ok((row.tierReason ?? '').length > 0, `${row.id} 必须有层级理由`);
    }
    const verified = data.rows.filter((row) => row.tier === 'verified');
    const provisional = data.rows.filter((row) => row.tier === 'provisional');
    assert.equal(verified.length + provisional.length, data.rows.length, '每行恰属一层');
    assert.equal(data.verifiedSubtotalCny, verified.reduce((sum, row) => sum + (row.amountCny ?? 0), 0));
    assert.equal(data.provisionalSubtotalCny, provisional.reduce((sum, row) => sum + (row.amountCny ?? 0), 0));
    assert.equal(data.verifiedSubtotalCny + data.provisionalSubtotalCny, data.knownSubtotalCny);
    // 已核实层只许来源状态可断言锁定的行：按现数据只有签约空调
    assert.deepEqual(verified.map((row) => row.id).sort(), ['cost-hvac']);
    // 评审 P1 点名：防水人工有未关闭去重、泥瓦构成全未锁价，两者都不许进已核实层
    assert.equal(rowById(data, 'cost-waterproof-labor')?.tier, 'provisional', '防水人工待去重确认，必须在暂估层');
    assert.equal(rowById(data, 'cost-masonry')?.tier, 'provisional', '泥瓦未锁价，必须在暂估层');
    // 复核 P1 点名：水电生效卡是业主基线（baseline）、且 COST-040-15 界面未决，必须在暂估层且理由写明两点
    const mepRow = rowById(data, 'cost-mep');
    assert.equal(mepRow?.tier, 'provisional', '水电生效卡为业主基线，必须在暂估层');
    assert.match(mepRow?.tierReason ?? '', /baseline/, '水电层级理由必须点名生效卡 baseline 状态');
    assert.match(mepRow?.tierReason ?? '', /COST-040-15/, '水电层级理由必须点名 COST-040-15 界面未决');
    assert.equal(data.verifiedSubtotalCny, pkgOf(control, 'PKG-030').budget.contracted_cny, '已核实小计按现数据恰为签约空调合同额');
    const markdown = renderCostSummary(data, '# 测试表头\n\n');
    assert.ok(markdown.includes('不得读作已核实成本'), '口径说明必须写明已知合计不是已核实成本');
  });

  it('层级守卫：已核实凭据逐行断言，伪造 baseline 卡声称已核实必须抛错', () => {
    // 报价卡凭据：只有锁定类 status 能支撑已核实层
    assert.throws(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'owner_baseline_40', cardStatus: 'baseline' }, control),
      /owner_baseline_40.*不是锁定类状态/,
      'baseline 卡声称已核实必须抛错',
    );
    assert.throws(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'some_card', cardStatus: 'candidate' }, control),
      /不是锁定类状态/,
    );
    assert.throws(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'some_card', cardStatus: 'quoted' }, control),
      /不是锁定类状态/,
      '普通书面报价（quoted）未锁定，同样不许支撑已核实层',
    );
    assert.doesNotThrow(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'some_card', cardStatus: 'contracted' }, control),
    );
    // 无凭据声称已核实必须抛错
    assert.throws(() => assertVerifiedTierBasis('cost-mep', undefined, control), /未登记来源凭据/);
    // 合同凭据：真实 control 通过；删掉 contract_ref 或 contracted_cny 必须抛错
    const contractBasis = { type: 'contract', packageId: 'PKG-030', quoteRoundId: 'QR-2026-10-03-24' } as const;
    assert.doesNotThrow(() => assertVerifiedTierBasis('cost-hvac', contractBasis, control));
    const noRef = structuredClone(control) as AnyRecord;
    const qr = (noRef.hard_finish_quote_rounds.records as AnyRecord[]).find((record) => record.id === 'QR-2026-10-03-24') as AnyRecord;
    delete qr.contract_ref;
    assert.throws(() => assertVerifiedTierBasis('cost-hvac', contractBasis, noRef), /缺 contract_ref/);
    const noContracted = structuredClone(control) as AnyRecord;
    delete pkgOf(noContracted, 'PKG-030').budget.contracted_cny;
    assert.throws(() => assertVerifiedTierBasis('cost-hvac', contractBasis, noContracted), /缺 contracted_cny/);
    // 现行数据的已核实行（签约空调）凭据必须真实在位——守卫不是摆设
    const hvacRow = rowById(data, 'cost-hvac');
    assert.equal(hvacRow?.verifiedBasis?.type, 'contract');
  });

  it('覆盖检查：全部未决条目已登记归属，三类计数对上未决总数', () => {
    const { coverage } = data;
    assert.equal(coverage.scannedComponentCount, 106);
    assert.equal(coverage.scannedQuoteRoundCount, 27);
    assert.ok(coverage.unresolvedItemCount > 0, '必须真的扫到未决条目');
    assert.equal(
      coverage.countedItemCount + coverage.pendingItemCount + coverage.excludedItemCount,
      coverage.unresolvedItemCount,
      '计入定价行 + 未定价与待核 + 不计价登记 必须恰好覆盖全部未决条目',
    );
    const pendingCovers = new Set(data.pendingChecks.flatMap((entry) => entry.coversItems));
    const unpricedCovers = new Set(data.unpriced.flatMap((row) => row.coversItems ?? []));
    // 评审 P2 点名三项 + 未关闭的防水去重轮次，必须在待核/未定价清单里
    for (const id of ['COST-060-05', 'COST-120-02', 'COST-125-03']) {
      assert.ok(pendingCovers.has(id), `${id} 必须出现在待核清单`);
    }
    assert.ok(pendingCovers.has('QR-2026-10-03-03'), '防水去重轮次必须出现在待核清单');
    assert.ok(unpricedCovers.has('COST-090-01') && unpricedCovers.has('COST-125-01'), '原未定价五项的覆盖登记必须在');
    // 待核条目不进合计：合计仍恰为定价行之和
    assert.equal(data.knownSubtotalCny, data.rows.reduce((sum, row) => sum + (row.amountCny ?? 0), 0));
    const markdown = renderCostSummary(data, '# 测试表头\n\n');
    for (const entry of data.pendingChecks) {
      const line = markdown.split('\n').find((text) => text.startsWith(`| ${entry.name} |`));
      assert.ok(line, `待核清单必须含 ${entry.name}`);
      assert.equal(line.split('|')[3]?.trim(), '待核', `${entry.name} 的成本列必须是「待核」`);
    }
  });

  it('覆盖检查 fail-closed：注入未登记的未决组件必须抛错', () => {
    const doctored = structuredClone(control) as AnyRecord;
    const pkg060 = pkgOf(doctored, 'PKG-060');
    pkg060.budget.components.push({
      id: 'COST-060-99',
      name: '合成未决组件（测试注入）',
      planned_cny: null,
      status: 'quote_pending',
    });
    assert.throws(() => buildCostSummary(doctored), /覆盖检查失败.*COST-060-99/);
    // 移除注入后恢复正常（基线 data 已在模块顶层构建成功即为证）
    pkg060.budget.components.pop();
    assert.doesNotThrow(() => buildCostSummary(doctored));
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
    assert.ok(markdown.includes('已知合计（不含未定价）'));
    assert.ok(markdown.includes('已核实小计'));
    assert.ok(markdown.includes('暂估小计'));
    assert.ok(markdown.includes(`¥${data.knownSubtotalCny.toLocaleString('zh-CN')}`));
    for (const row of data.unpriced) {
      const line = markdown.split('\n').find((text) => text.startsWith(`| ${row.name} |`));
      assert.ok(line, `未定价清单必须含 ${row.name}`);
      assert.equal(line.split('|')[3]?.trim(), '未定价', `${row.name} 的成本列必须是「未定价」而不是金额`);
    }
  });
});
