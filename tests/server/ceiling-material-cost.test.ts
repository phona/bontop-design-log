import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { loadCeilingConfig } from '../../server/config-loader.js';
import { computeCeilingTakeoff } from '../../shared/ceiling-takeoff.js';
import {
  parseCeilingMaterialCost,
  loadCeilingMaterialCost,
  computeCeilingMaterialCost,
} from '../../server/ceiling-material-cost.js';

/**
 * 吊顶主材参考成本区间（C09 建立、C10 改证据台账、C11 加龙骨用量折算）。守八条：
 *  ① 只记区间、每条价格都要有 observations[] 台账（没台账的数不入库）；
 *  ② 张价按**各观察自己的规格**折算（家装 1200×2400 ≠ 工程 3000×1200）；
 *  ③ 面积口径只有一份（takeoff 的 gypsumBoardM2），本模块不另立公式；
 *  ④ 材料额度 = 包工包料 − 纯人工，两个单价可覆盖；
 *  ⑤ 证据分级 verified > comparable > owner_reported；off_spec 与「在售无价」只登记不折算；
 *  ⑥ 型材按米计价必须有 usage_assumptions 才许折算，边龙骨用量由 takeoff 周长实算不手抄；
 *  ⑦ 结论只出三态 + 余量 + 告警，不出「贵/便宜」的市场判断；
 *  ⑧ 业主口径与可核实口径必须并列（敏感性），不许只报一个数。
 */

const catalog = ProjectCatalog.load('.');
const takeoff = computeCeilingTakeoff(loadCeilingConfig(), catalog.getRooms().map((room) => ({ id: room.id, height: room.height })));

test('张价按各观察自己的规格折算：verified 优先，取整到元', () => {
  const result = computeCeilingMaterialCost(loadCeilingMaterialCost(), takeoff);
  const osb = result.items.find((item) => item.id === 'osb_9mm_qiannianzhou_enf')!;
  // 80～85 元/张 ÷ 2.9768㎡ → 26.9～28.6 → 27～29 元/㎡
  assert.equal(osb.perSqm!.min, 27);
  assert.equal(osb.perSqm!.max, 29);
  assert.equal(osb.basisUsed, 'verified');
  assert.ok(osb.derivation!.includes('2.9768'));
  assert.ok(osb.derivation!.includes('verified'));
  // C7 的 off_spec 观察带 3.6㎡（3000×1200），不许掺进来
  const gypsum = result.items.find((item) => item.id === 'gypsum_board_c7_knauf')!;
  assert.equal(gypsum.perSqm!.min, 26); // 75 ÷ 2.88 = 26.04 → 26
  assert.equal(gypsum.perSqm!.max, 30); // 85 ÷ 2.88 = 29.51 → 30
  assert.equal(gypsum.basisUsed, 'comparable', 'C7 无本案型号成交价，只能用同级旁证');
  assert.equal(gypsum.offSpecEvidence.length, 2, '3000×1200 的 47.70 / 53.30 只登记不折算');
  assert.equal(gypsum.offSpecEvidence[0].sheet_size_m2, 3.6);
});

test('龙骨按「米价 × 用量」逐构件折算，用量可复核', () => {
  const config = loadCeilingMaterialCost();
  const result = computeCeilingMaterialCost(config, takeoff);
  const frame = result.items.find((item) => item.id === 'lanzhen50_frame')!;
  assert.equal(frame.basis, 'per_metre_derived');
  assert.equal(frame.derivedComponents.length, 3);
  // 参考实现（PR #253 round 3）：期望值在测试内从间距规则 + takeoff + 证据米价重算。
  // 取整与实现同口径（roundMoney/round2）；米价从 cost yaml 的 comparable 观察读出，不手写。
  const roundMoney = (value: number): number => Math.round(value + Number.EPSILON);
  const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
  const frameConfig = config.items.find((item) => item.id === 'lanzhen50_frame')!;
  const rateOf = (component: string): number => {
    const observation = frameConfig.observations.find(
      (obs) => obs.grade === 'comparable' && obs.component === component && obs.rate !== undefined,
    );
    assert.ok(observation, `missing comparable rate observation for ${component}`);
    return observation!.rate!;
  };
  // 间距规则（GB/T 11981 + 施工技术要点）：米数 = 1/间距，区间两端取 1/最大间距与 1/最小间距。
  const metresFromSpacing = (minMm: number, maxMm: number): [number, number] =>
    [round2(1 / (maxMm / 1000)), round2(1 / (minMm / 1000))];
  const assertComponent = (component: string, metres: [number, number], usageStatus: string): [number, number] => {
    const derived = frame.derivedComponents.find((c) => c.component === component)!;
    assert.ok(derived, `missing derived component ${component}`);
    const rate = rateOf(component);
    const expectedPerSqm: [number, number] = [roundMoney(metres[0] * rate), roundMoney(metres[1] * rate)];
    assert.equal(derived.rateYuanPerMetre, rate, `${component} 米价须取 cost yaml 的 comparable 观察价`);
    assert.deepEqual(derived.metresPerSqm, metres, `${component} 用量须由间距规则/takeoff 导出`);
    assert.deepEqual(derived.perSqm, expectedPerSqm, `${component} 每平米价须为米价 × 用量（取整到元）`);
    assert.equal(derived.usageStatus, usageStatus);
    return expectedPerSqm;
  };
  const mainPerSqm = assertComponent('主龙骨', metresFromSpacing(800, 1200), 'unconfirmed');
  const subPerSqm = assertComponent('副龙骨', metresFromSpacing(300, 400), 'unconfirmed');
  // 边龙骨由 takeoff 周长实算（全部分区周长 ÷ 石膏板净面积），不手抄——yaml 的
  // source_note 旧值（72.335m/25.406㎡ → 2.85）与测试旧注（70.675m/24.2666㎡）均已过期，
  // 以现行 takeoff 对象重算为准。
  const areaSqm = takeoff.gypsumBoardM2;
  const perimeter = takeoff.byClass[config.area_basis].perimeterM;
  const edgeMetres = round2(perimeter / areaSqm);
  const edgePerSqm = assertComponent('边龙骨', [edgeMetres, edgeMetres], 'model_derived_upper_bound');
  // 项合计 = 各构件每平米价之和（取整到元）。
  assert.equal(frame.perSqm!.min, roundMoney(mainPerSqm[0] + subPerSqm[0] + edgePerSqm[0]));
  assert.equal(frame.perSqm!.max, roundMoney(mainPerSqm[1] + subPerSqm[1] + edgePerSqm[1]));
  assert.ok(frame.derivation!.includes(`${rateOf('主龙骨')}元/米`));
  assert.ok(frame.derivation!.includes(`${edgeMetres}米每平米`));
  assert.equal(frame.basisUsed, 'comparable', '米价是可耐福普通/卡式系列，蓝臻本身无公开价');
});

test('分区碎是本案的结构性成本：边龙骨上界是经验值的 7.7 倍', () => {
  const result = computeCeilingMaterialCost(loadCeilingMaterialCost(), takeoff);
  const frame = result.items.find((item) => item.id === 'lanzhen50_frame')!;
  const edge = frame.derivedComponents.find((c) => c.component === '边龙骨')!;
  assert.ok(edge.metresPerSqm[0] / 0.4 > 7, '全分区周长口径远高于大平顶单区经验值');
  assert.ok(result.warnings.some((note) => note.includes('全部分区周长上界')));
});

test('材料合计区间与金额区间 = 各项相加 × takeoff 面积', () => {
  const result = computeCeilingMaterialCost(loadCeilingMaterialCost(), takeoff);
  // R01 重算：龙骨项下限 36→35、上限 45→44，合计下限 98→97、上限 120→119
  assert.equal(result.materialPerSqm.min, 97);
  assert.equal(result.materialPerSqm.max, 119);
  assert.equal(result.areaSqm, takeoff.gypsumBoardM2);
  const sumMin = Math.round(result.items.reduce((sum, item) => sum + (item.totalRange?.min ?? 0), 0) * 100) / 100;
  assert.equal(result.materialTotal.min, sumMin);
});

test('材料额度按施工方分形态口径算：112.8 元/㎡，判定 within_range（C12 修正 C11；R01 重算后基数 24.267㎡）', () => {
  const result = computeCeilingMaterialCost(loadCeilingMaterialCost(), takeoff);
  assert.equal(result.contractor.basis, 'forms');
  // 边吊 21.375m×160 + 平顶 6.311㎡×155 = 4,398.21；纯人工 21.375×60 + 6.311×60 = 1,661.16（R01 重算门厅区 1.0584→2.561）
  const breakdown = result.contractor.formBreakdown!;
  assert.equal(breakdown.length, 2);
  assert.equal(breakdown[0].form, 'edge_drop');
  assert.equal(breakdown[0].quantity, 21.37);
  assert.equal(breakdown[0].turnkeyYuan, 3420);
  assert.equal(breakdown[0].materialYuan, 2137.5);
  assert.equal(breakdown[1].form, 'flat');
  assert.equal(breakdown[1].turnkeyYuan, 978.2); // R01 重算：6.311×155
  // 4,398.20 − 1,661.16 = 2,737.04 → ÷ 24.2666 = 112.8 元/㎡；面积基数与边吊长度随几何口径变，单价不变
  assert.equal(result.contractor.allowancePerSqm, 112.8);
  // 98～120 → 113.97 落在参考区间内
  assert.equal(result.verdict, 'within_range');
  assert.equal(result.slackVsMaxYuanPerSqm, -6.2);
});

test('C11 的「低于下限」是旧口径的假象：全按 155 元/㎡ 算额度只有 95', () => {
  const config = loadCeilingMaterialCost();
  const flatOnly = { ...config, contractor_rates: { flat_only_per_sqm: { turnkey: 155, labor_only: 60 } } };
  const result = computeCeilingMaterialCost(flatOnly, takeoff);
  assert.equal(result.contractor.basis, 'flat_only');
  assert.equal(result.contractor.allowancePerSqm, 95);
  assert.equal(result.verdict, 'below_range', '旧口径把边吊按平米算，低估额度 27.71 元每平米');
});

test('三态判定随单价变化，证明结论对单价敏感', () => {
  const config = loadCeilingMaterialCost();
  const clamp = (turnkeyEdge: number, turnkeyFlat: number) => ({
    ...config,
    contractor_rates: { forms: [
      { form: 'edge_drop' as const, unit: '元/m', turnkey_per_unit: turnkeyEdge, labor_only_per_unit: 60 },
      { form: 'flat' as const, unit: '元/㎡', turnkey_per_unit: turnkeyFlat, labor_only_per_unit: 60 },
    ] },
  });
  assert.equal(computeCeilingMaterialCost(clamp(140, 135), takeoff).verdict, 'below_range');
  assert.equal(computeCeilingMaterialCost(clamp(150, 145), takeoff).verdict, 'within_range');
  assert.equal(computeCeilingMaterialCost(clamp(170, 165), takeoff).verdict, 'above_range');
});

test('证据分级显形：verified / comparable / owner_reported 各自点名', () => {
  const result = computeCeilingMaterialCost(loadCeilingMaterialCost(), takeoff);
  assert.deepEqual(result.evidenceMix.verified, ['千年舟 9mm 欧松板（OSB）']);
  assert.deepEqual(result.evidenceMix.comparable, ['可耐福 C7 石膏板', '可耐福蓝臻 50 轻钢龙骨（主/副/边）']);
  assert.deepEqual(result.evidenceMix.owner_reported, ['吊杆、吊件、膨胀、自攻螺丝等配套辅材', '切割与边角损耗']);
  assert.ok(result.warnings.some((note) => note.includes('C7') && note.includes('同级旁证')));
  assert.ok(result.warnings.some((note) => note.includes('辅材') && note.includes('owner_reported')));
  assert.ok(result.warnings.some((note) => note.includes('未经施工图确认')));
});

test('敏感性：业主口径与可核实口径并列，差多少就是未核实数据值多少', () => {
  const result = computeCeilingMaterialCost(loadCeilingMaterialCost(), takeoff);
  assert.deepEqual(result.ownerOnlyPerSqm, { min: 70, max: 115 });
  assert.deepEqual(result.ownerOnlyCoverage.missing, []);
  // 分形态口径下额度 112.16 落在业主口径区间内；
  // 未核实数据的影响改由 ownerOnly(70～115) 与 materialPerSqm(98～120) 的差体现
  assert.ok(result.warnings.some((note) => note.includes('两个口径') || note.includes('业主转述')));
});

test('「在售无价 / 仅确认存在」的证据不参与计算但必须显形', () => {
  const result = computeCeilingMaterialCost(loadCeilingMaterialCost(), takeoff);
  const osb = result.items.find((item) => item.id === 'osb_9mm_qiannianzhou_enf')!;
  assert.equal(osb.existenceOnlyEvidence.length, 1, '阻燃 9mm 京东 SKU 在售、价格隐藏');
  const gypsum = result.items.find((item) => item.id === 'gypsum_board_c7_knauf')!;
  assert.equal(gypsum.existenceOnlyEvidence.length, 1, 'C7 产品确认存在、无成交价');
  // 上人型主龙骨 20.81 元/米只登记不折算
  const frame = result.items.find((item) => item.id === 'lanzhen50_frame')!;
  assert.ok(frame.offSpecEvidence.some((obs) => obs.rate === 20.81));
});

test('规格未确认必须告警（C7 的家装/工程规格会影响折算）', () => {
  const result = computeCeilingMaterialCost(loadCeilingMaterialCost(), takeoff);
  assert.ok(result.warnings.some((note) => note.includes('规格本身未确认')));
});

test('缺用量口径的米价不许折算：per_metre_unconverted 只登记', () => {
  const config = loadCeilingMaterialCost();
  const stripped = {
    ...config,
    usage_assumptions: [],
    items: config.items.map((item) => (item.id === 'lanzhen50_frame' ? { ...item, basis: 'per_metre_unconverted' as const } : item)),
  };
  const result = computeCeilingMaterialCost(stripped, takeoff);
  const frame = result.items.find((item) => item.id === 'lanzhen50_frame')!;
  assert.equal(frame.basis, 'per_metre_unconverted');
  assert.equal(frame.derivedComponents.length, 0, '没有用量口径就不许折算');
  assert.deepEqual(
    frame.unconvertedEvidence.filter((obs) => obs.rate !== undefined).map((obs) => obs.rate).sort((a, b) => (a as number) - (b as number)),
    [4.1, 6.34, 8.5],
  );
  assert.ok(frame.existenceOnlyEvidence.some((obs) => obs.caliber.includes('包装规格')));
  assert.ok(result.warnings.some((note) => note.includes('每平米用量') && note.includes('未声明')));
});

test('结构与口径错误 fail closed：不猜、不补默认值', () => {
  const good = readFileSync('config/ceiling-material-cost.yaml', 'utf8');
  // 既给 rate 又给 min/max
  assert.throws(() => parseCeilingMaterialCost(good.replace('        rate: 80\n', '        rate: 80\n        min: 70\n')), /必须且只能给一种/);
  // 区间 min > max
  assert.throws(() => parseCeilingMaterialCost(good.replace('min: 18\n        max: 28', 'min: 30\n        max: 28')), /min 不能大于 max/);
  // 区间写 0（"待定"占位）
  assert.throws(() => parseCeilingMaterialCost(good.replace('min: 4\n        max: 8', 'min: 0\n        max: 8')), /必须是正数/);
  // 观察级 sheet_size_m2 写错
  assert.throws(() => parseCeilingMaterialCost(good.replace('sheet_size_m2: 3.6', 'sheet_size_m2: missing')), /sheet_size_m2/);
  // 没给 source/caliber 的「价格」不许入库
  assert.throws(() => parseCeilingMaterialCost(good.replace('        caliber: 在售索引价，标题明确「千年舟无醛级 9mm…欧松板 OSB」，厚度 9mm 明确，未见起订量标注\n', '')), /caliber 必填/);
  // 未知 grade
  assert.throws(() => parseCeilingMaterialCost(good.replace('grade: verified', 'grade: heard_from_neighbor')), /grade 必须是/);
  // 未知 basis
  assert.throws(() => parseCeilingMaterialCost(good.replace('basis: per_sheet', 'basis: per_bag')), /basis 必须是/);
  // per_sheet 缺条目级规格
  assert.throws(() => parseCeilingMaterialCost(good.replace('sheet_size_m2: 2.9768', '')), /sheet_size_m2 必须填/);
  // 空台账
  assert.throws(() => parseCeilingMaterialCost(good.replace(/    observations:\n(?:      .*\n)+/m, '    observations: []\n')), /observations 必须是非空数组/);
  // 重复 id
  assert.throws(() => parseCeilingMaterialCost(good.replace('id: gypsum_board_c7_knauf', 'id: osb_9mm_qiannianzhou_enf')), /id 重复/);
  // area_basis 拼错
  assert.throws(() => parseCeilingMaterialCost(good.replace('area_basis: gypsum_board', 'area_basis: gypsum')), /area_basis/);
  // per_metre_derived 必须有 usage_assumptions
  assert.throws(() => parseCeilingMaterialCost(good.replace(/usage_assumptions:\n(?:  .*\n|    .*\n)+/, '')), /必须给 usage_assumptions/);
  // takeoff_perimeter 不许手抄用量
  assert.throws(() => parseCeilingMaterialCost(good.replace('    source: takeoff_perimeter', '    source: takeoff_perimeter\n    metres_per_sqm: 1.2')), /不许手抄/);
  // 手抄用量必须给
  assert.throws(() => parseCeilingMaterialCost(good.replace('    metres_per_sqm: 1.0', '')), /metres_per_sqm 必须是正数/);
  // 构件米价找不到用量口径
  assert.throws(() => {
    const clone = JSON.parse(JSON.stringify(loadCeilingMaterialCost()));
    clone.usage_assumptions = clone.usage_assumptions.filter((u: { id: string }) => u.id !== 'perimeter_from_takeoff');
    computeCeilingMaterialCost(clone, takeoff);
  }, /没有它的用量口径/);
  // flat_only 口径里包工包料不大于纯人工（parse 阶段就拦）
  assert.throws(
    () => parseCeilingMaterialCost(readFileSync('config/ceiling-material-cost.yaml', 'utf8').replace('    turnkey: 155\n    labor_only: 60', '    turnkey: 150\n    labor_only: 160')),
    /包工包料必须大于纯人工/,
  );
  // forms 里包工包料不大于纯人工
  assert.throws(
    () => parseCeilingMaterialCost(readFileSync('config/ceiling-material-cost.yaml', 'utf8').replace('      turnkey_per_unit: 155', '      turnkey_per_unit: 55')),
    /包工包料必须大于纯人工/,
  );
});

test('面积为 0 的工艺类别不许对账（显形而不是空表）', () => {
  const config = loadCeilingMaterialCost();
  assert.throws(
    () => computeCeilingMaterialCost({ ...config, area_basis: 'drying_rack' }, { ...takeoff, dryingRackM2: 0 }),
    /无法对账/,
  );
});
