import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { load as parseYaml } from 'js-yaml';
import {
  assertAttributionClaims,
  assertMepOutOfScopeDispositions,
  assertNoDuplicateCountedClaims,
  assertPendingClassifications,
  assertVerifiedTierBasis,
  buildCostSummary,
  computeActiveMepQuote,
  extractGovernedTotalAmounts,
  findDecisionSection,
  DUAL_ATTRIBUTIONS,
  OUT_OF_SCOPE_DISPOSITIONS,
  PENDING_COUNTED_STATUS_LABELS,
  mepOutOfScopeFootnote,
  renderCostSummary,
  type AttributionKind,
  type CostSummaryData,
  type PendingCountedStatus,
  type PendingEntry,
} from '../../scripts/schedule/cost-summary.js';
import {
  compareMepQuotes,
  loadMepQuotes,
  mepQuoteFallback,
} from '../../server/mep-quotes.js';

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

  it('范围纪律：烟灶（油烟机）属家电包，不入定价行、只进范围外登记', () => {
    // 复核 P2：油烟机在控制源归家电包（PKG-160），本表口径排除家电——不得混入硬装合计
    assert.equal(rowById(data, 'cost-range-hood'), undefined, '烟灶行必须已移出定价行');
    assert.ok(!data.rows.some((row) => row.name.includes('烟灶')), '定价行不得出现烟灶');
    const hoodFigure = data.excluded.find((figure) => figure.label.includes('range_hood'));
    assert.ok(hoodFigure, 'range_hood 科目数字必须登记在防双算/范围外登记里');
    assert.match(hoodFigure.reason, /家电包/, '登记理由必须写明属家电包、范围外');
    assert.ok(hoodFigure.amountCny > 0, '登记金额照实呈现（候选价），只是不计入合计');
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
    // contracted 卡只有在原卡凭据可核（卡存在、承包商与报价日期非空、证据为
    // written_quote）时才放行——注入合成卡文件
    const contractedQuotes = { quotes: [{ id: 'some_card', status: 'contracted', contractor: '测试施工方', quoted_at: '2026-10-01', evidence: { kind: 'written_quote', status: '书面报价单' } }] };
    assert.doesNotThrow(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'some_card', cardStatus: 'contracted' }, control, contractedQuotes),
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

  it('层级守卫凭据核验：contract_ref 须解析到 DEC 原文且金额一致，报价卡须回原卡核对凭据字段', () => {
    const contractBasis = { type: 'contract', packageId: 'PKG-030', quoteRoundId: 'QR-2026-10-03-24' } as const;
    // 伪造 contract_ref 指向不存在的 DEC：字段自报齐全也必须被凭据核验拦下
    const badRef = structuredClone(control) as AnyRecord;
    const badRefQr = (badRef.hard_finish_quote_rounds.records as AnyRecord[])
      .find((record) => record.id === 'QR-2026-10-03-24') as AnyRecord;
    badRefQr.contract_ref = 'DEC-2099-01-01-R99';
    assert.throws(() => assertVerifiedTierBasis('cost-hvac', contractBasis, badRef), /解析不到/, 'contract_ref 解析不到 DEC 原文必须抛错');
    // 金额篡改：control 内两处自报同步改掉，仍须与 DEC 原文（36,000）对不上而抛错
    const badAmount = structuredClone(control) as AnyRecord;
    pkgOf(badAmount, 'PKG-030').budget.contracted_cny = 35000;
    const badAmountQr = (badAmount.hard_finish_quote_rounds.records as AnyRecord[])
      .find((record) => record.id === 'QR-2026-10-03-24') as AnyRecord;
    badAmountQr.locked_cny = 35000;
    assert.throws(() => assertVerifiedTierBasis('cost-hvac', contractBasis, badAmount), /金额对不上/, '合同额与 DEC 原文不符必须抛错');
    // 报价卡凭据：status 是 contracted 但原卡不存在——光信 status 不许过
    assert.throws(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'ghost_card', cardStatus: 'contracted' }, control),
      /找不到卡 ghost_card/,
      'contracted 状态但原卡不存在必须抛错',
    );
    // 原卡在但承包商名为空 / 报价日期为空：凭据不全必须抛错
    assert.throws(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'some_card', cardStatus: 'contracted' }, control,
        { quotes: [{ id: 'some_card', status: 'contracted', contractor: '  ', quoted_at: '2026-10-01' }] }),
      /缺承包商名/,
    );
    assert.throws(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'some_card', cardStatus: 'contracted' }, control,
        { quotes: [{ id: 'some_card', status: 'contracted', contractor: '测试施工方', quoted_at: null }] }),
      /缺报价日期/,
    );
    // 状态漂移：登记捕获 contracted、原卡实为 candidate，必须抛错
    assert.throws(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'some_card', cardStatus: 'contracted' }, control,
        { quotes: [{ id: 'some_card', status: 'candidate', contractor: '测试施工方', quoted_at: '2026-10-01' }] }),
      /凭据漂移/,
    );
  });

  it('合同凭据金额全词精确命中：子串金额（6,000 / 3,600）同步篡改必须抛错', () => {
    // 复审 P1：DEC 原文写的是 36,000——「6,000」是它的子串、「3,600」是其数字
    // 前缀变形。早先的 includes() 子串查法会把同步误改成 6,000 的合同额误判为
    // 「原文载明」而放进已核实层；全词精确命中（提取金额 token 后逐一全等）
    // 必须拦下这两种误改。控制源与轮次两处自报须同步改，字段一致性才骗得过
    // 前置断言、走到凭据核验这一关——本用例正是按这个攻击面构造的。
    const contractBasis = { type: 'contract', packageId: 'PKG-030', quoteRoundId: 'QR-2026-10-03-24' } as const;
    for (const forged of [6000, 3600]) {
      const doctored = structuredClone(control) as AnyRecord;
      pkgOf(doctored, 'PKG-030').budget.contracted_cny = forged;
      const qr = (doctored.hard_finish_quote_rounds.records as AnyRecord[])
        .find((record) => record.id === 'QR-2026-10-03-24') as AnyRecord;
      qr.locked_cny = forged;
      assert.throws(
        () => assertVerifiedTierBasis('cost-hvac', contractBasis, doctored),
        /金额对不上/,
        `合同额被同步误改为 ${forged}（36,000 的子串/变形）必须被全词精确命中拦下`,
      );
    }
    // 原值 36,000 在 DEC 原文中是全词 token，必须继续通过（不许把真凭据也拦了）
    assert.doesNotThrow(() => assertVerifiedTierBasis('cost-hvac', contractBasis, control));
  });

  it('合同凭据金额关键词辖域：分项金额与标题杂数字（6 / 10 / 200 / 2,131 / 14,124 / 8,400 / 35,000）同步篡改必须抛错', () => {
    // 复审 P1 再续：全词命中 + 总价语境「行」仍不够——标题行除 36,000 外还
    // 捎着编号/型号/台数（2026、10、200 主机、6 台、R1 的 1），正文总价论述
    // 行还捎着设备价（2,131 / 2,050 / 2,493）与百分比（35），整行提取时它们
    // 都是候选集成员、改成谁都放行。候选金额只许来自被总价关键词**直接辖
    // 制**的位置：关键词在前（定标成交：36,000 元），或金额在前且总价词在
    // 同小句近邻（36,000 为整包含价…总价）。实测现行 DEC 的辖域候选集恰
    // 为 {36,000}，下列每个杂数字/分项数都不在辖域内。
    const contractBasis = { type: 'contract', packageId: 'PKG-030', quoteRoundId: 'QR-2026-10-03-24' } as const;
    // 6 / 10 / 200 = 标题行杂数字（台数 / 月份 / 主机型号）；2,131 = 总价论述
    // 行里的设备价；14,124 / 8,400 = 分项金额；35,000 = 章节内不存在的近似数
    for (const forged of [6, 10, 200, 2131, 14124, 8400, 35000]) {
      const doctored = structuredClone(control) as AnyRecord;
      pkgOf(doctored, 'PKG-030').budget.contracted_cny = forged;
      const qr = (doctored.hard_finish_quote_rounds.records as AnyRecord[])
        .find((record) => record.id === 'QR-2026-10-03-24') as AnyRecord;
      qr.locked_cny = forged;
      assert.throws(
        () => assertVerifiedTierBasis('cost-hvac', contractBasis, doctored),
        /金额对不上/,
        `合同额被同步误改为 ${forged}（不在总价关键词辖域内）必须被辖域校验拦下`,
      );
    }
    // 原值 36,000 被总价关键词直接辖制（标题行定标成交 + 正文整包含价双重命中），必须继续通过
    assert.doesNotThrow(() => assertVerifiedTierBasis('cost-hvac', contractBasis, control));
  });

  it('合同凭据金额辖域否定屏蔽：身份否定句不产生候选，真命中逐字不误伤', () => {
    // 复审 P1 四轮：形态 (b)（金额在前、同小句近邻总价词）无屏蔽时会把
    // 「14,124 元不是总价；总价待定」里的分项金额误认成总价候选——金额与
    // 「总价」之间只隔一个「不是」也算命中。屏蔽只认否定词紧贴关键词构
    // 成的身份否定（不是 / 并非 / 不属于 + 总价 / 整包含价）。提取函数是守
    // 卫唯一的文本相关步骤，合成章节在这一层逐字喂入即等价于守卫判定。
    // 对抗合成章节：分项价被身份否定、且无其他总价陈述 → 不得产生候选
    assert.deepEqual([...extractGovernedTotalAmounts('外机价 14,124 元不是总价；总价待定，后续另行确认。')], [], '「…不是总价」式身份否定不得产生总价候选');
    assert.deepEqual([...extractGovernedTotalAmounts('设备价 14,124 元，并非总价，安装另计。')], [], '「并非总价」同样是身份否定');
    assert.deepEqual([...extractGovernedTotalAmounts('该 8,400 元不属于总价范畴，系单项安装费。')], [], '「不属于总价」同样是身份否定');
    // 对真值的否定陈述同样不得产生候选（哪怕金额恰是 36,000）
    assert.deepEqual([...extractGovernedTotalAmounts('本轮口述价 36,000 元不是总价，仅为设备款。')], [], '对真值的否定陈述不得产生候选');
    // 不误伤一：现行 DEC 形态 (b) 真命中逐字复刻——「36,000 为整包含价，
    // 换内机不改变总价」中「不改变总价」的否定作用于动词「改变」而非总
    // 价身份，命中靠先行出现的「整包含价」成立，屏蔽不得误伤
    assert.deepEqual(
      [...extractGovernedTotalAmounts('36,000 为整包含价，换内机不改变总价，不存在金钱动机。')],
      ['36,000'],
      '真命中（整包含价 + 不改变总价）不得被否定屏蔽误伤',
    );
    // 不误伤二：真实 DEC 章节的辖域候选集在加屏蔽后仍恰为 {36,000}
    const section = findDecisionSection('DEC-2026-10-04-R1');
    assert.ok(section, 'DEC-2026-10-04-R1 章节必须解析得到');
    assert.deepEqual([...extractGovernedTotalAmounts(section.text)], ['36,000'], '真实 DEC 辖域候选集必须恰为 {36,000}');
    // 守卫层延续：点名负例 14,124 在加屏蔽后仍须抛错（全套负例见辖域测试）
    const contractBasis = { type: 'contract', packageId: 'PKG-030', quoteRoundId: 'QR-2026-10-03-24' } as const;
    const doctored = structuredClone(control) as AnyRecord;
    pkgOf(doctored, 'PKG-030').budget.contracted_cny = 14124;
    const qr = (doctored.hard_finish_quote_rounds.records as AnyRecord[])
      .find((record) => record.id === 'QR-2026-10-03-24') as AnyRecord;
    qr.locked_cny = 14124;
    assert.throws(() => assertVerifiedTierBasis('cost-hvac', contractBasis, doctored), /金额对不上/, '分项金额 14,124 在加否定屏蔽后仍必须被守卫拦下');
  });

  it('报价卡凭据边界：证据须 written_quote 且费率不得含公开参考价来源', () => {
    // 复审凭据边界（两轮）：第一层正向强制证据等级——已核实层只认一级证据
    // written_quote（书面报价单，与 shared/quote-cards.ts 的证据分级及
    // comparable 门禁同口径）；缺证据、photo（照片判读）、owner_reported
    // （业主转述）一律抛错。第二层费率来源：evidence 合格也拦不住费率行取自
    // 公开参考价（scope_note 带 public_reference 标记，现行基线卡的形态）。
    const cardWith = (evidence: unknown, rates: unknown = { labor_by_area: { per_unit: 40, unit: '元/㎡', scope_note: '施工方书面报价，清包人工' } }) => ({
      quotes: [{
        id: 'ev_card', status: 'contracted', contractor: '测试施工方', quoted_at: '2026-10-01',
        ...(evidence === undefined ? {} : { evidence }),
        rates,
      }],
    });
    // 无 evidence → 抛错（现行 MEP 卡正是这形态：补登书面证据前不得支撑已核实）
    assert.throws(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'ev_card', cardStatus: 'contracted' }, control, cardWith(undefined)),
      /evidence\.kind=缺失.*written_quote/,
      '无结构化证据的 contracted 卡必须抛错',
    );
    // photo / owner_reported 均非一级证据 → 抛错点名实际 kind
    for (const kind of ['photo', 'owner_reported'] as const) {
      assert.throws(
        () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'ev_card', cardStatus: 'contracted' }, control, cardWith({ kind, status: 'x' })),
        new RegExp(`evidence\\.kind=${kind}.*written_quote`),
        `evidence.kind=${kind} 的卡必须抛错`,
      );
    }
    // 非枚举的公开参考类 kind 同样不是 written_quote → 抛错（旧用例口径保留）
    assert.throws(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'ev_card', cardStatus: 'contracted' }, control, cardWith({ kind: 'public_reference', status: 'x' })),
      /evidence\.kind=public_reference/,
      'evidence.kind 为公开参考类的卡必须抛错',
    );
    // 第二层：written_quote 合格，但费率行含公开参考价 → 仍抛错并点名行键
    assert.throws(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'ev_card', cardStatus: 'contracted' }, control,
        cardWith({ kind: 'written_quote', status: '书面报价单' }, {
          water_cold_20: { per_unit: 16.9, unit: '元/m', scope_note: '家装绿页面价｜public_reference｜https://example.com/sku' },
          labor_by_area: { per_unit: 40, unit: '元/㎡', scope_note: '业主指定人工口径' },
        })),
      /费率行 water_cold_20.*public_reference/,
      'written_quote 卡费率行含公开参考价必须抛错并点名行键',
    );
    // 对照：written_quote + 费率全部来自施工方报价 → 放行（不误伤真凭据）
    const cleanQuotes = {
      quotes: [{
        id: 'clean_card', status: 'contracted', contractor: '测试施工方', quoted_at: '2026-10-01',
        evidence: { kind: 'written_quote', status: '书面报价单' },
        rates: {
          water_cold_20: { per_unit: 18.5, unit: '元/m', scope_note: '施工方书面报价单第 3 项，含辅材' },
          labor_by_area: { per_unit: 40, unit: '元/㎡', scope_note: '施工方书面报价，清包人工' },
        },
      }],
    };
    assert.doesNotThrow(
      () => assertVerifiedTierBasis('cost-mep', { type: 'quote-card', cardId: 'clean_card', cardStatus: 'contracted' }, control, cleanQuotes),
      'written_quote 且费率均为施工方报价来源的 contracted 卡必须通过',
    );
  });

  it('水电 out_of_scope 行显形：未登记处置抛错点名，登记后通过且注脚可见', () => {
    // 复审 P2：compareMepQuotes 把卡上 out_of_scope 的行排除在总额之外、也
    // 不进 pendingRows——水电行若只核总额与待报价行，这类行会被静默少算。
    // 合成注入：克隆真实报价文件，给生效卡加一条 out_of_scope 行（行键
    // gas_alarm_kit），经真实 compareMepQuotes 产出对比结果再喂守卫。
    const { takeoff, areaSqm } = computeActiveMepQuote();
    const labor = parseYaml(readFileSync('config/mep-labor.yaml', 'utf8')) as Parameters<typeof mepQuoteFallback>[0];
    const doctoredFile = structuredClone(loadMepQuotes()) as unknown as AnyRecord;
    const activeCard = (doctoredFile.quotes as AnyRecord[]).find((quote) => quote.id === doctoredFile.active) as AnyRecord;
    activeCard.out_of_scope = ['gas_alarm_kit'];
    const doctoredComparison = compareMepQuotes(
      doctoredFile as unknown as Parameters<typeof compareMepQuotes>[0],
      takeoff,
      areaSqm,
      mepQuoteFallback(labor),
    ).find((entry) => entry.active);
    assert.ok(doctoredComparison, '合成卡必须有生效对比');
    assert.deepEqual(doctoredComparison.outOfScopeRows, ['gas_alarm_kit'], 'out_of_scope 行必须出现在对比结果的 outOfScopeRows 中');
    assert.ok(!doctoredComparison.pendingRows.includes('gas_alarm_kit'), 'out_of_scope 行不在待报价行里（这正是静默少算的入口）');
    // 未登记处置 → 抛错并点名行键与登记表
    assert.throws(
      () => assertMepOutOfScopeDispositions(doctoredComparison.outOfScopeRows),
      /gas_alarm_kit.*OUT_OF_SCOPE_DISPOSITIONS/,
      '未登记处置的 out_of_scope 行必须抛错并点名行键与登记表',
    );
    // 登记后 → 通过；注脚带行数与行键（水电行推导据此显形）
    assert.doesNotThrow(
      () => assertMepOutOfScopeDispositions(doctoredComparison.outOfScopeRows, { gas_alarm_kit: '测试处置：由其他报价覆盖' }),
      '登记处置后必须通过',
    );
    const footnote = mepOutOfScopeFootnote(['gas_alarm_kit'], { gas_alarm_kit: '测试处置：由其他报价覆盖' });
    assert.ok(footnote.includes('1 行') && footnote.includes('gas_alarm_kit'), '注脚必须显形行数与行键');
    // 复审四轮：处置理由必须进生成表——只写「已登记处置」、理由留在生成
    // 器源码里，读者在成本表表面仍看不到这些钱的去向
    assert.ok(footnote.includes('测试处置：由其他报价覆盖'), '注脚必须逐行渲染登记表中的处置全文');
    // 现行真实数据：生效卡无 out_of_scope 行、登记表为空、真实推导不带注脚
    const { comparison } = computeActiveMepQuote();
    assert.deepEqual(comparison.outOfScopeRows, [], '现行生效卡不得有 out_of_scope 行（有则先登记处置）');
    assert.deepEqual(OUT_OF_SCOPE_DISPOSITIONS, {}, '现行登记表应为空（有行被排除时才逐行登记）');
    assert.equal(mepOutOfScopeFootnote([]), '', '无被排除行时注脚为空串');
    assert.ok(!rowById(data, 'cost-mep')!.derivation.includes('不在本家报价范围'), '现行水电行推导不得出现 out_of_scope 注脚');
  });

  it('覆盖检查：全部未决条目已登记归属，三类计数对上未决总数', () => {
    const { coverage } = data;
    assert.equal(coverage.scannedComponentCount, 106);
    assert.equal(coverage.scannedQuoteRoundCount, 27);
    assert.ok(coverage.unresolvedItemCount > 0, '必须真的扫到未决条目');
    // 集合语义：双归属条目在两个分类各计一次，三类之和 = 未决总数 + 双归属数
    assert.equal(
      coverage.countedItemCount + coverage.pendingItemCount + coverage.excludedItemCount - coverage.dualAttributedItemCount,
      coverage.unresolvedItemCount,
      '计入定价行 + 未定价与待核 + 不计价登记 − 双归属 必须恰好覆盖全部未决条目',
    );
    assert.deepEqual(coverage.dualAttributedItemIds, ['COST-030-02', 'COST-030-07', 'COST-040-15'], '双归属条目必须恰为已声明的三条');
    const pendingCovers = new Set(data.pendingChecks.flatMap((entry) => entry.coversItems));
    const unpricedCovers = new Set(data.unpriced.flatMap((row) => row.coversItems ?? []));
    const countedCovers = new Set(data.rows.flatMap((row) => row.coversItems ?? []));
    // 复核 P2 点名：COST-030-02（合同外增量）与 COST-030-07（线控器书面确认）必须双归属——签约行计入 + 待核各一份
    assert.ok(countedCovers.has('COST-030-02') && pendingCovers.has('COST-030-02'), 'COST-030-02 必须双归属（计入签约行 + 待核合同外增量）');
    assert.ok(countedCovers.has('COST-030-07') && pendingCovers.has('COST-030-07'), 'COST-030-07 必须双归属（计入签约行 + 待核书面确认），不许只登记已计入而夸大 closure');
    // 复审续点名：COST-040-15 的界面未决必须在成本表表面可见——计入水电行 + 待核界面划分各一份
    assert.ok(countedCovers.has('COST-040-15') && pendingCovers.has('COST-040-15'), 'COST-040-15 必须双归属（计入水电行 + 待核界面划分），不许只藏在水电行 coversItems 里');
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

  it('双归属校验：未声明的重复登记抛错并点名，声明双归属正常通过且计数正确', () => {
    const claimsOf = (entries: Array<[string, AttributionKind[]]>) =>
      new Map<string, Set<AttributionKind>>(entries.map(([id, kinds]) => [id, new Set(kinds)]));
    const unresolved = new Set(['COST-030-02', 'COST-030-07', 'COST-040-15', 'COST-099-01']);
    // 未声明的多重归属：抛错并点名 id，不许静默取首个分类
    assert.throws(
      () => assertAttributionClaims(claimsOf([['COST-099-01', ['counted', 'pending']]]), DUAL_ATTRIBUTIONS, unresolved),
      /COST-099-01.*多重归属/,
    );
    // 已声明的三条双归属：正常通过并如实返回
    assert.deepEqual(
      assertAttributionClaims(
        claimsOf([
          ['COST-030-02', ['counted', 'pending']],
          ['COST-030-07', ['counted', 'pending']],
          ['COST-040-15', ['counted', 'pending']],
          ['COST-099-01', ['pending']],
        ]),
        DUAL_ATTRIBUTIONS,
        unresolved,
      ),
      ['COST-030-02', 'COST-030-07', 'COST-040-15'],
    );
    // 声明腐烂：声明在册但条目已不是多重归属，必须抛错
    assert.throws(
      () => assertAttributionClaims(claimsOf([['COST-030-02', ['counted']]]), DUAL_ATTRIBUTIONS, unresolved),
      /COST-030-02.*已腐烂/,
    );
  });

  it('双归属上限：三重归属即使已声明也必须抛错（恰两个分类封顶）', () => {
    const claimsOf = (entries: Array<[string, AttributionKind[]]>) =>
      new Map<string, Set<AttributionKind>>(entries.map(([id, kinds]) => [id, new Set(kinds)]));
    const unresolved = new Set(['COST-030-02', 'COST-030-07', 'COST-040-15']);
    // COST-030-02 已在 DUAL_ATTRIBUTIONS 声明，但 counted+pending+excluded 三路仍不许
    assert.throws(
      () => assertAttributionClaims(claimsOf([['COST-030-02', ['counted', 'pending', 'excluded']]]), DUAL_ATTRIBUTIONS, unresolved),
      /COST-030-02.*三重归属/,
      '三重归属必须抛错并点名，双归属上限为恰两个分类',
    );
  });

  it('重复计入校验：同一条目被两条不同定价行计入必须抛错并点名条目与两条行', () => {
    assert.throws(
      () => assertNoDuplicateCountedClaims(new Map<string, string[]>([
        ['COST-099-01', ['cost-a（行甲）', 'cost-b（行乙）']],
      ])),
      /COST-099-01.*重复计入（cost-a（行甲）、cost-b（行乙））/,
      '重复计入必须抛错，点名条目与两条行',
    );
    // 同一行内重复登记同一条目不算重复计入；不同条目分属不同行正常通过
    assert.doesNotThrow(() => assertNoDuplicateCountedClaims(new Map<string, string[]>([
      ['COST-099-01', ['cost-a（行甲）', 'cost-a（行甲）']],
      ['COST-099-02', ['cost-b（行乙）']],
    ])));
    // 真实数据：模块顶层 buildCostSummary 已在 assertCoverage 内跑过本校验并通过
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

  it('待核计入状态分类：必填 fail-closed，全量 16 条逐条钉死，渲染计数由期望表推导', () => {
    // 复审 P2：待核清单里混着「钱已在合计里、只待事项核对关闭」的条目（封槽
    // 界面、线控器确认、防水去重），总述若笼统称「待核取得价格后会增加总
    // 额」，读者会把已计入的钱再加一遍。每条待核必须有 countedStatus 分类，
    // 缺失即抛错。
    const bare = [{ id: 'pending-x', name: 'x', packageIds: [], statusLabel: 'x', note: 'x', coversItems: [] }] as unknown as PendingEntry[];
    assert.throws(() => assertPendingClassifications(bare), /pending-x.*缺计入状态分类/, '缺分类的待核条目必须被校验拦下');
    const illegal = [{ ...bare[0], countedStatus: 'maybe' }] as unknown as PendingEntry[];
    assert.throws(() => assertPendingClassifications(illegal), /缺计入状态分类/, '非法分类值必须被拦下');
    assert.doesNotThrow(() => assertPendingClassifications(data.pendingChecks));
    // 全量钉死（复审 P2 续）：16 条待核的 id → 计入状态以字面期望表写全，
    // 逐条断言与登记一致；任何一条被误改分类（哪怕三类总数恰好不变、动态计
    // 数仍自洽）都会令本测试变红。改判须有事实依据并同步改本表。
    const EXPECTED_COUNTED_STATUS: Record<string, PendingCountedStatus> = {
      'pending-sill-tile-labor': 'uncounted', // COST-060-05 小砖条人工：注脚明示未计入泥瓦行
      'pending-lighting-install-labor': 'uncertain', // COST-120-02：是否含于水电合同未定
      'pending-panel-install-labor': 'uncertain', // COST-125-03：是否含于水电合同未定
      'pending-waterproof-dedup': 'counted', // 防水人工 ¥366 已在防水人工行，只待去重核对
      'pending-gas-piping': 'uncounted', // COST-040-09 燃气费：不在水电卡范围内、未计入
      'pending-mep-paint-interface': 'counted', // COST-040-15 封槽料金额已在水电卡辅材包干内
      'pending-hvac-excluded-extras': 'uncounted', // COST-030-02 待核面是合同外增量，不在 ¥36,000 内
      'pending-hvac-risk-extras': 'uncounted', // COST-030-06 可能增项：现未计入任何行
      'pending-hvac-controller-confirmation': 'counted', // COST-030-07 金额已按业主口述含于空调合同
      'pending-masonry-leveling': 'uncounted', // COST-060-03 找平：未计入泥瓦行构成
      'pending-masonry-logistics': 'uncounted', // COST-060-06 搬运退补：未计入泥瓦行构成
      'pending-south-balcony-tiling': 'uncounted', // COST-060-07 铺贴范围：现状按未含处理
      'pending-ceiling-keel': 'uncounted', // COST-070-01 龙骨：未单独计入吊顶行构成
      'pending-flood-test-liability': 'uncounted', // COST-050-03 闭水责任：闭水人工未单独计价
      'pending-demolition-haulage-dedup': 'counted', // 清运 ¥1,059 已在拆改行实付锚内，只待核重
      'pending-fixed-cabinetry': 'uncounted', // QR-2026-10-03-26 固定柜体：未计入任何行
    };
    assert.equal(data.pendingChecks.length, 16, '待核条目恰为 16 条（与期望表同量）');
    const byId = new Map(data.pendingChecks.map((entry) => [entry.id, entry.countedStatus]));
    assert.deepEqual(
      [...byId.keys()].sort(),
      Object.keys(EXPECTED_COUNTED_STATUS).sort(),
      '待核条目 id 集合必须与期望表恰好一致（多一条、少一条都算漂移）',
    );
    for (const [id, expected] of Object.entries(EXPECTED_COUNTED_STATUS)) {
      assert.equal(byId.get(id), expected, `${id} 的计入状态必须为 ${expected}（全量钉死）`);
    }
    // 三类计数改由期望表推导，再与登记数据对照——不许只对生成数据自洽自证
    const expectedCount = (status: PendingCountedStatus) =>
      Object.values(EXPECTED_COUNTED_STATUS).filter((value) => value === status).length;
    const countedN = data.pendingChecks.filter((entry) => entry.countedStatus === 'counted').length;
    const uncountedN = data.pendingChecks.filter((entry) => entry.countedStatus === 'uncounted').length;
    const uncertainN = data.pendingChecks.filter((entry) => entry.countedStatus === 'uncertain').length;
    assert.equal(countedN, expectedCount('counted'), '已计入条数必须与期望表一致（4）');
    assert.equal(uncountedN, expectedCount('uncounted'), '未计入条数必须与期望表一致（10）');
    assert.equal(uncertainN, expectedCount('uncertain'), '待确认条数必须与期望表一致（2）');
    // 渲染：总述三类条数由登记生成、与期望值一致；每条待核行带自己的分类标签
    const markdown = renderCostSummary(data, '# 测试表头\n\n');
    assert.ok(markdown.includes(`待核未计入 ${uncountedN} 项`), '总述必须带未计入条数（生成值）');
    assert.ok(markdown.includes(`待核 ${countedN} 项`), '总述必须带已计入条数（生成值）');
    assert.ok(markdown.includes(`待核 ${uncertainN} 项`), '总述必须带待确认条数（生成值）');
    assert.ok(!markdown.includes('未定价与待核项目尚未计入合计：它们取得价格后会增加总额'), '旧总述（把已计入条目也说成未计入）不得再现');
    // 去绝对化（复审 P2 续）：「已计入」只表示不得作为新费用再加，不表示结案
    // 时金额不动——总述必须写明结案按核对结果修正已计金额（可增可减）
    assert.ok(markdown.includes('事项关闭时以核对结果对已计金额做修正'), '总述必须写明已计入事项结案时修正已计金额');
    assert.ok(markdown.includes('已计金额可增可减'), '总述必须写明已计金额可增可减');
    assert.ok(!markdown.includes('关闭只了结事项、不动金额'), '旧绝对化表述（只关事项、金额不动）不得再现');
    for (const entry of data.pendingChecks) {
      const line = markdown.split('\n').find((text) => text.startsWith(`| ${entry.name} |`));
      assert.ok(line?.includes(PENDING_COUNTED_STATUS_LABELS[entry.countedStatus]), `${entry.name} 的清单行必须明示计入状态标签`);
    }
  });

  it('渲染纪律：小计标注含未定价说明，未定价行不显示金额', () => {
    const markdown = renderCostSummary(data, '# 测试表头\n\n');
    // 口径表述纪律（复审续）：暂估金额可调减、可退押金不是最终成本——不许再作「必然高于」方向断言
    assert.ok(!markdown.includes('必然高于已知合计'), '不得断言真实总成本必然高于已知合计');
    assert.ok(markdown.includes('不必然高于、也不必然低于已知合计'), '口径句必须如实表述：总额方向以正式报价与结算为准');
    // 未计入口径限定（复审 P2 续）：未计入含或然项（空调可能增项，触发才
    // 发生）、待业主裁定项（固定柜体是否纳入一期）与范围未定项（南阳台铺
    // 贴范围可能缩小）——取得报价 ≠ 必然发生，总述必须带三重限定，旧的无
    // 条件表述不得再现
    assert.ok(markdown.includes('确认纳入一期、实际发生、且未被其他定价行包含'), '未计入口径必须带三重限定（确认纳入一期/实际发生/未被其他定价行包含）');
    assert.ok(!markdown.includes('取得价格后会增加总额'), '旧无条件表述（取得价格后会增加总额）不得再现');
    assert.ok(!markdown.includes('定价后才增加'), '旧无条件表述（定价后才增加）不得再现');
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
