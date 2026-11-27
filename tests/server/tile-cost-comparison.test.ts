import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'js-yaml';
import { resolveLayout } from '../../server/layout-resolver.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { loadMasonryTakeoff } from '../../server/budget-calculator.js';
import {
  buildTileCostComparison,
  loadMasonryRateCard,
  loadTileComparisonConfig,
} from '../../server/tile-cost-comparison.js';
import type { CurrentScheme, VertexLayoutYaml } from '../../shared/types.js';

const projectLayout = resolveLayout(
  load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml,
);
const projectCatalog = ProjectCatalog.load('.');
const projectTakeoff = loadMasonryTakeoff(projectCatalog);
const projectScheme = JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;

describe('tile cost comparison', () => {
  it('models both long wood-look options from resolved dry-room geometry and keeps wet rooms out', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, projectTakeoff, projectScheme);

    assert.deepEqual(result.area.dryRoomIds, [
      'living_dining', 'kitchen', 'master_bedroom', 'study', 'bedroom_nw', 'bedroom_se',
    ]);
    assert.equal(result.area.rooms.length, 6);
    assert.equal(result.area.netDryAreaSqm, 122.435); // R01 重算：客餐厅 +1.725、东南房 +2.19，干区净面积 112.272→116.187；2026-11-16 D1 主卧圆角 −0.2146 → 115.973；2026-11-16 D4 走廊地面 3.75㎡ 计入干区基数 → 119.723；2026-11-27 量房回填：房间干区 115.973→117.761（客餐厅 +0.39、厨房 +0.57、东南房 −2.05、主卧/书房/西北次卧 +2.89）、走廊 extra 3.75→4.67455 → 122.435
    assert.ok(!result.area.dryRoomIds.some(id => /bath|balcony|toilet/i.test(id)));

    const kt = result.candidates.find(candidate => candidate.id === 'kt_200x1200')!;
    assert.equal(kt.materialId, 'floor_tile_kt_200x1200_01');
    assert.equal(kt.materialValidation.status, 'passed');
    assert.equal(kt.materialValidation.materialSpec, '200x1200mm');
    assert.equal(kt.materialValidation.materialPriceYuan, 29);
    assert.equal(kt.materialValidation.coveragePerUnitSqm, 0.24);
    assert.equal(kt.modeled.requiredPieces, 551);
    assert.equal(kt.quoted.pieces, 516);
    assert.equal(kt.quoteVsModel.quotedPieceDelta, -35); // R01 重算后模型需片数 523，报价 516 反而少模型 7 片，门店复核补片；2026-11-16 D1 主卧圆角 −0.2146，模型需片数 522，报价少模型 6 片；2026-11-16 D4 走廊地面 3.75㎡ 计入干区基数，模型需片数 539，报价少模型 23 片；2026-11-27 量房回填干区基数 119.723→122.435，模型需片数 551，报价少模型 35 片
    assert.equal(kt.quoted.coverageSqm, 123.84);
    assert.equal(kt.quoted.materialTotalYuan, 14964);
    assert.equal(kt.quoted.reportedFullMaterialTotalYuan, 21108);

    const jinyi = result.candidates.find(candidate => candidate.id === 'jinyi_approx_900x150')!;
    assert.equal(jinyi.materialId, 'floor_tile_jyt_900x150_01');
    assert.equal(jinyi.materialValidation.status, 'passed');
    assert.equal(jinyi.materialValidation.materialSpec, '约900x150mm');
    assert.equal(jinyi.materialValidation.materialPriceYuan, 17.8);
    assert.equal(jinyi.materialValidation.coveragePerUnitSqm, 0.135);
    assert.equal(jinyi.dimensionsStatus, 'nominal_approximate_quoted');
    assert.equal(jinyi.modeled.requiredPieces, 980);
    assert.equal(jinyi.quoted.pieces, 970);
    assert.equal(jinyi.quoteVsModel.quotedPieceDelta, -10); // R01 重算：970−930；2026-11-16 D1 主卧圆角 −0.2146，模型需片数 930→928，报价多模型 42 片；2026-11-16 D4 走廊地面 3.75㎡ 计入干区基数，模型需片数 958，报价多模型 12 片；2026-11-27 量房回填干区基数 119.723→122.435，模型需片数 980，报价少模型 10 片
    assert.equal(jinyi.quoted.coverageSqm, 130.95);
    assert.equal(jinyi.quoted.materialTotalYuan, 17266);
    assert.equal(jinyi.quoted.reportedFullMaterialTotalYuan, 23926);
  });

  it('does not turn unknown carton sizes or installation costs into hidden zeroes', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, projectTakeoff, projectScheme);
    for (const candidate of result.candidates) {
      assert.equal(candidate.modeled.cartonSize, null);
      assert.equal(candidate.modeled.cartonRoundingApplied, false);
      assert.equal(candidate.modeled.requiredPieces, candidate.modeled.piecesBeforeCartonRounding);
    }
    assert.equal(result.feeStatus.installation.status, 'unknown');
    assert.equal('amountYuan' in result.feeStatus.installation, false);
  });

  it('applies carton rounding when carton quantity is known', () => {
    const config = loadTileComparisonConfig();
    config.candidates[0].carton_size = 10;
    const result = buildTileCostComparison(projectLayout, config, projectCatalog, projectTakeoff, projectScheme);
    const kt = result.candidates[0];
    assert.equal(kt.modeled.piecesBeforeCartonRounding, 551);
    assert.equal(kt.modeled.requiredPieces, 560); // R01 重算后 523 片，整箱 10 片进位至 530；2026-11-16 D1 后 522 片，仍进位至 530；2026-11-16 D4 后 539 片，进位至 540；2026-11-27 量房回填后 551 片，进位至 560
    assert.equal(kt.modeled.cartonRoundingApplied, true);
  });

  it('counts dry floor outside rooms in the dry base instead of pricing rooms only（量价算法审计 D4）', () => {
    // 房间外干区地面（live：走廊 main_corridor_floor 4.67455㎡）必须进干区基数：
    // 预算 dryFloorSqm 计入它，旧口径只加干区房间，少算 4.67455㎡（材料 −¥580、
    // 人工 −¥350.59）。合成验证：干区 extras 改量时基数等量跟随，extras 归零时
    // 基数回到纯房间值 117.761。
    // Codex blocking②（PR #255 复审）：floorRegionExtraSqm 是干湿混合量——
    // 房间外湿区（follow 指向湿区房）不得进干区基数。合成验证：只加湿区 extra
    // 时干区基数不动；只加干区 extra 时基数等量跟随。
    const base = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, projectTakeoff, projectScheme);
    assert.equal(base.area.netDryAreaSqm, 122.435);
    const plusTwoDry = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, { ...projectTakeoff, floorRegionExtraSqm: projectTakeoff.floorRegionExtraSqm + 2, floorRegionExtraDrySqm: projectTakeoff.floorRegionExtraDrySqm + 2 }, projectScheme);
    assert.equal(plusTwoDry.area.netDryAreaSqm, 124.435);
    const plusTwoWet = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, { ...projectTakeoff, floorRegionExtraSqm: projectTakeoff.floorRegionExtraSqm + 2, floorRegionExtraWetSqm: projectTakeoff.floorRegionExtraWetSqm + 2 }, projectScheme);
    assert.equal(plusTwoWet.area.netDryAreaSqm, 122.435);
    const zeroExtra = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, { ...projectTakeoff, floorRegionExtraSqm: 0, floorRegionExtraDrySqm: 0, floorRegionExtraWetSqm: 0 }, projectScheme);
    assert.equal(zeroExtra.area.netDryAreaSqm, 117.761);
  });

  it('reconciles the dry base with the budget dry floor: dry base + internal regions == masonry dryFloorSqm（量价算法审计 D4）', () => {
    // 干区基数（房间 + 房间外）+ 房间内转移区 == 预算 dryFloorSqm。两边是同一
    // masonry takeoff 的不同切面：预算在 loadMasonryTakeoff 内加总，本对比在
    // buildTileCostComparison 内加总；任一边漏一项都会在这里红。
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, projectTakeoff, projectScheme);
    const reconciled = result.area.netDryAreaSqm + result.currentInternalFloorRegions.netAreaSqm;
    assert.ok(
      Math.abs(reconciled - projectTakeoff.dryFloorSqm) <= 0.001,
      `干区基数 ${result.area.netDryAreaSqm} + 内部转移区 ${result.currentInternalFloorRegions.netAreaSqm} = ${reconciled}，须等于预算 dryFloorSqm ${projectTakeoff.dryFloorSqm}`,
    );
  });

  it('refuses a masonry takeoff without floorRegionExtraSqm instead of treating it as zero（量价算法审计 D4）', () => {
    assert.throws(
      () => buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, { ...projectTakeoff, floorRegionExtraSqm: undefined } as unknown as typeof projectTakeoff, projectScheme),
      /floorRegionExtraSqm/,
    );
  });

  it('refuses a masonry takeoff whose dry/wet extra split does not add up to the total（Codex blocking②）', () => {
    assert.throws(
      () => buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, { ...projectTakeoff, floorRegionExtraDrySqm: projectTakeoff.floorRegionExtraDrySqm + 2 }, projectScheme),
      /floorRegionExtraDrySqm \+ floorRegionExtraWetSqm must equal floorRegionExtraSqm/,
    );
  });

  it('rejects missing room IDs instead of silently omitting area', () => {
    const config = loadTileComparisonConfig();
    config.dry_room_ids.push('missing_room');
    assert.throws(() => buildTileCostComparison(projectLayout, config, projectCatalog, projectTakeoff, projectScheme), /Dry floor room not found/);
  });

  it('preserves secondary material totals outside the modeled floor comparison', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, projectTakeoff, projectScheme);
    assert.deepEqual(result.otherQuotedMaterialTotals.map(item => item.reportedFullMaterialTotalYuan), [21108, 23926]);
    assert.equal(result.otherQuotedMaterialTotals[1].alternativeReportedFullMaterialTotalYuan, 27130);
    assert.match(result.otherQuotedMaterialTotals[0].note, /outside the modeled dry-room main-floor scope/);
  });

  it('models the selected wet-zone baseline from resolved rooms and catalog pricing separately', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, projectTakeoff, projectScheme);
    assert.deepEqual(result.wetBaseline.items.map(item => [item.roomId, item.materialId]), [
      ['master_bath', 'floor_tile_antislip_400'],
      ['balcony', 'floor_tile_antislip_400'],
      ['guest_bath', 'floor_tile_deco_small'],
    ]);
    assert.deepEqual(result.wetBaseline.items.map(item => item.netAreaSqm), [8.787, 2.733, 4.127]); // 2026-11-27 量房：主卫北扩 4.361→8.787、阳台 1.92→2.733、客卫 2.235→4.127
    assert.deepEqual(result.wetBaseline.items.map(item => item.modeledQuantity), [60, 19, 4.54]);
    assert.deepEqual(result.wetBaseline.items.map(item => item.materialCostYuan), [720, 228, 908]);
    assert.equal(result.wetBaseline.netAreaSqm, 15.647);
    assert.equal(result.wetBaseline.materialCostYuan, 1856);
    assert.deepEqual(result.currentInternalFloorRegions.items.map(item => [item.regionId, item.materialId, item.netAreaSqm, item.modeledQuantity, item.materialCostYuan]), [
      ['guest_bath_open_vanity_floor', 'floor_tile_kt_200x1200_01', 0.724, 4, 116],
    ]);
    assert.equal(result.currentInternalFloorRegions.netAreaSqm, 0.724);
    assert.deepEqual(result.scenarioTotals.map(item => item.totalProvisionalFloorMaterialsYuan), [17951, 19416]); // R01 重算：干区 +3.915㎡；2026-11-16 D1：干区材料 −28.01、湿区材料 −17.38；2026-11-16 D4：走廊地面 3.75㎡ 计入干区基数，干区材料 +493（KT 15631−15138）、+534（锦艺 17052.4−16518.4）；2026-11-27 量房回填：干区材料 +348/+391.6、湿区材料 +848、内部转移区材料 −58
  });

  it('totals the KT floor scheme with only the unchanged balcony baseline, not superseded bathroom baseline', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, projectTakeoff, projectScheme);
    assert.equal(result.ktNewSchemeFloorMaterials.dryMainFloorMaterialYuan, 15979); // R01 重算：干区 +3.915㎡；2026-11-16 D1 主卧圆角 −0.2146，15167→15138；2026-11-16 D4 走廊地面 3.75㎡ 计入干区基数，15138→15631（539 片 × ¥29）；2026-11-27 量房回填，15631→15979（551 片 × ¥29）
    assert.equal(result.ktNewSchemeFloorMaterials.ktBathroomFloorMaterialYuan, 1120); // 2026-11-27 量房：主卫 14 片 → 27 片、客卫 7 片 → 13 片，40 片 × ¥28
    assert.equal(result.ktNewSchemeFloorMaterials.unchangedBalconyBaselineMaterialYuan, 228);
    assert.equal(result.ktNewSchemeFloorMaterials.currentInternalFloorRegionsMaterialYuan, 116);
    assert.deepEqual(result.ktNewSchemeFloorMaterials.currentBaselineRoomIdsIncluded, ['balcony']);
    assert.deepEqual(result.ktNewSchemeFloorMaterials.currentBaselineFloorRegionIdsIncluded, ['guest_bath_open_vanity_floor']);
    assert.equal(result.ktNewSchemeFloorMaterials.supersededBathroomBaselineIncluded, false);
    assert.equal(result.ktNewSchemeFloorMaterials.totalProvisionalFloorMaterialsYuan, 17443); // R01 重算：15167+588+156+174；2026-11-16 D1：干区材料 −29 → 16056；2026-11-16 D4：干区材料 +493 → 16549；2026-11-27 量房回填：干区 +348、卫浴 +532、阳台 +72、内部 −58 → 17443
    // The current bathroom baseline now contains the master bath + 4.127㎡ guest inner bath;
    // the 0.724㎡ open vanity region is listed separately and is not hidden in the small-flower area.
    assert.equal(result.wetBaseline.materialCostYuan, 1856);
  });

  it('exposes the mason rate card and separate net-area labor scenarios without adding labor to budget pools', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, projectTakeoff, projectScheme);
    const labor = result.masonryLaborEstimate;
    assert.equal(result.masonryRateCard.source, 'docs/design-iterations/tile-plank-comparison-20261006/evidence/mason-labor-rate-card.jpg');
    assert.equal(result.masonryRateCard.floor_rates_yuan_per_sqm.find(rate => rate.specification.includes('木纹砖'))?.price, 75);
    assert.equal(result.masonryRateCard.wall_rates_yuan_per_sqm.find(rate => rate.specification === '600x1200')?.price, 65);
    assert.equal(result.masonryRateCard.conditional_addons.find(addon => addon.id === 'floor_protection_film')?.price, 5);

    assert.equal(labor.mainDryFloor.netAreaSqm, 122.435);
    assert.equal(labor.mainDryFloor.rateYuanPerSqm, 75);
    assert.equal(labor.mainDryFloor.laborSubtotalYuan, 9182.63);
    assert.equal(labor.mainDryFloor.fishbonePremiumYuanPerSqm, 50);
    assert.equal(labor.mainDryFloor.fishboneEquivalentRateYuanPerSqm, 125);
    assert.equal(labor.ktBathroomFloors.netAreaSqm, 12.914);
    assert.equal(labor.ktBathroomFloors.areaRateYuanPerSqm, 45);
    assert.equal(labor.ktBathroomFloors.areaRateSubtotalYuan, 581.13);
    assert.equal(labor.ktBathroomFloors.roomCount, 2);
    assert.equal(labor.ktBathroomFloors.flatOnlyInterpretationYuan, 600);
    assert.equal(labor.ktBathroomFloors.additiveIfConfirmedInterpretationYuan, 1181.13);
    assert.deepEqual(labor.ktBathroomFloors.interpretations.map(option => option.dryPlusBathroomLaborYuan), [9782.63, 10363.76]);
    assert.equal(labor.currentInternalFloorRegions.netAreaSqm, 0.724);
    assert.equal(labor.currentInternalFloorRegions.rateYuanPerSqm, 75);
    assert.equal(labor.currentInternalFloorRegions.subtotalYuan, 54.3);
    assert.equal(labor.ktBathroomFloors.selectedInterpretation, null);
    assert.equal(labor.includedInOwnerLaborBudgetPool, false);
    assert.match(labor.scopeStatus, /not an all-inclusive/);
  });

  it('瓦工费率卡唯一源在 config/masonry-labor.yaml，tile-comparison.yaml 不得内联', () => {
    // 2026-10-13 搬迁：masonry_rate_card 从 tile-comparison.yaml 提到 config/masonry-labor.yaml。
    // 理由是同一件事原来两处定价——该卡只喂 /api/tiles/comparison，而
    // server/budget-calculator.ts 的 computeLabor 另读 config/budget/base.json 的
    // categories.masonry.labor（45 元/㎡），互不对账。
    // 本测试锁住搬迁结果：tile-comparison.yaml 不得回退内联卡。
    const comparison = load(readFileSync('config/tile-comparison.yaml', 'utf8')) as Record<string, unknown>;
    assert.ok(!('masonry_rate_card' in comparison), 'config/tile-comparison.yaml 不得再内联 masonry_rate_card——已搬迁至 config/masonry-labor.yaml');
    assert.equal(comparison.masonry_rate_card_ref, 'config/masonry-labor.yaml', 'tile-comparison.yaml 应留下指向新文件的引用');

    // 新文件必须是 active 卡可解析、且值与原卡逐字段相同（搬迁不改数）。
    const card = loadMasonryRateCard();
    assert.equal(card.source, 'docs/design-iterations/tile-plank-comparison-20261006/evidence/mason-labor-rate-card.jpg');
    assert.match(card.quote_status, /preliminary_labor_rate_card/);
    assert.equal(card.floor_rates_yuan_per_sqm.length, 6);
    assert.equal(card.wall_rates_yuan_per_sqm.length, 6);
    assert.equal(card.extras.length, 13);
    assert.equal(card.conditional_addons.length, 4);
    assert.equal(card.bathroom_floor_charge_interpretations.selection_status, 'unresolved');
  });

  it('compares dry-floor tile material plus ordinary labor on the same explicit scope', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, projectTakeoff, projectScheme);
    assert.deepEqual(
      result.dryFloorMaterialAndOrdinaryLaborByCandidate.map(item => [item.candidateId, item.sameScopeSubtotalYuan]),
      [['kt_200x1200', 25161.63], ['jinyi_approx_900x150', 26626.63]], // R01 重算：干区 +3.915㎡；2026-11-16 D1：干区材料 −28.01、人工 −16.05；2026-11-16 D4：走廊地面 3.75㎡ 计入干区基数，材料 +493/+534、人工 +281.25；2026-11-27 量房回填：材料 +348/+391.6、人工 +203.40
    );
    for (const item of result.dryFloorMaterialAndOrdinaryLaborByCandidate) {
      assert.equal(item.netAreaSqm, 122.435);
      assert.equal(item.ordinaryLaborSubtotalYuan, 9182.63);
      assert.equal(item.excludesBathroom, true);
      assert.equal(item.excludesWalls, true);
      assert.equal(item.excludesBalcony, true);
      assert.equal(item.excludesOtherExtras, true);
      assert.equal(item.includedInOwnerLaborBudgetPool, false);
      assert.match(item.scopeNote, /without tile purchase loss/);
    }
  });

  it('rejects quote candidates whose mapped catalog price no longer matches', () => {
    const config = loadTileComparisonConfig();
    config.candidates[0].unit_price_yuan = 30;
    assert.throws(
      () => buildTileCostComparison(projectLayout, config, projectCatalog, projectTakeoff, projectScheme),
      /Mapped material price does not match quote unit price/,
    );
  });

  it('keeps full store quote schedules, line extensions, scopes, and unresolved JYT bathroom mappings explicit', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog, projectTakeoff, projectScheme);
    const kt = result.storeQuotes[0];
    assert.equal(kt.additionalLines.length, 7);
    assert.equal(kt.additionalLines[1].roomId, 'kitchen');
    assert.equal(kt.additionalLines[1].surface, 'wall');
    assert.equal(kt.additionalLines[1].materialId, 'wall_tile_kt_600x1200_01');
    assert.equal(kt.additionalLines[2].materialId, 'floor_tile_kt_600x600_01');
    assert.equal(kt.additionalLines[3].materialId, 'wall_tile_kt_600x1200_01');
    assert.equal(kt.additionalLines[4].roomId, null);
    assert.equal(kt.additionalLines[4].materialId, 'wall_tile_kt_600x1200_01');
    assert.equal(kt.additionalLines[1].nominalCoverageSqm, 7.2);
    assert.equal(kt.summary.additionalQuotedSubtotalYuan, 6144);
    assert.equal(kt.summary.reportedFullMaterialTotalYuan, 21108);
    assert.equal(kt.summary.reportedFullVsQuotedLinesDeltaYuan, 0);

    const jyt = result.storeQuotes[1];
    assert.equal(jyt.additionalLines.length, 5);
    assert.equal(jyt.additionalLines[0].roomId, 'kitchen');
    assert.equal(jyt.additionalLines[0].surface, 'wall');
    assert.equal(jyt.additionalLines[0].estimatedAreaSqm, 10);
    assert.equal(jyt.additionalLines[0].nominalCoverageSqm, null);
    assert.equal(jyt.additionalLines[1].nominalCoverageSqm, 7.2);
    assert.equal(jyt.additionalLines[2].dimensionsStatus, 'unreadable');
    assert.equal(jyt.additionalLines[2].nominalCoverageSqm, null);
    assert.equal(jyt.additionalLines[2].roomId, null);
    assert.equal(jyt.additionalLines[2].surface, null);
    assert.equal(jyt.additionalLines[2].hypothesizedGroup, 'possible_bathroom_wall_quote');
    assert.equal(jyt.additionalLines[2].hypothesisConfidence, 'low');
    assert.equal(jyt.additionalLines[4].roomId, null);
    assert.equal(jyt.additionalLines[4].hypothesizedGroup, 'possible_bathroom_wall_quote');
    assert.equal(jyt.summary.additionalQuotedSubtotalYuan, 7400);
    assert.equal(jyt.summary.additionalExtendedAtQuotedUnitPricesYuan, 7400.4);
    assert.equal(jyt.summary.mainPlusAdditionalQuotedLineTotalYuan, 24666);
    assert.equal(jyt.additionalLines[0].visibleDiscountStatus, 'no_discount_visible');
    assert.equal(jyt.additionalLines[0].visibleDiscountedUnitPriceYuan, null);
    assert.equal(jyt.additionalLines[1].visibleDiscountedUnitPriceYuan, 10.6);
    assert.equal(jyt.additionalLines[2].visibleDiscountedUnitPriceYuan, 32);
    assert.equal(jyt.additionalLines[3].roomId, null);
    assert.equal(jyt.additionalLines[3].surface, null);
    assert.equal(jyt.additionalLines[3].nominalCoverageSqm, 7.68);
    assert.equal(jyt.additionalLines[3].hypothesizedGroup, 'possible_both_baths_floor');
    assert.equal(jyt.additionalLines[3].hypothesisConfidence, 'low_to_medium');
    assert.deepEqual(jyt.additionalLines[3].hypothesizedRoomIds, ['master_bath', 'guest_bath']);
    assert.equal(jyt.additionalLines[3].hypothesizedSurface, 'floor');
    assert.match(jyt.additionalLines[3].hypothesisRationale!, /7\.68.*7\.726/);
    assert.equal(jyt.summary.visibleDiscountedLinesSubtotalYuan, 5306.8);
    assert.equal(jyt.summary.subtotalUsingVisibleDiscountsAndQuotedPriceForUnshownLinesYuan, 6746.8);
    assert.equal(jyt.summary.mainPlusVisiblePricingBasisYuan, 24012.8);
    assert.equal(jyt.summary.userDerivedAdditionalDiscountedSubtotalYuan, 6660);
    assert.equal(jyt.summary.userDerivedAdditionalDiscountStatus, 'user_derived_90_percent_assumption_not_confirmed_on_uploaded_photo');
    assert.equal(jyt.summary.mainPlusUserDerivedAdditionalYuan, 23926);
    assert.equal(jyt.summary.visiblePricingBasisVsUserDerivedDeltaYuan, 86.8);
    assert.equal(jyt.summary.reportedFullMaterialTotalYuan, 23926);
    assert.match(jyt.summary.reportedFullMaterialTotalStatus!, /user_derived/);
    assert.equal(jyt.quoteStatus, 'photo_shows_main_floor_discounted_unit_price_and_bathroom_line_discounts; full_material_total_user_derived_not_photo_confirmed');
    assert.equal(jyt.summary.alternativeReportedFullMaterialTotalYuan, 27130);
  });
});
