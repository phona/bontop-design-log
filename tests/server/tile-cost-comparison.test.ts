import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'js-yaml';
import { resolveLayout } from '../../server/layout-resolver.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import {
  buildTileCostComparison,
  loadTileComparisonConfig,
} from '../../server/tile-cost-comparison.js';
import type { VertexLayoutYaml } from '../../shared/types.js';

const projectLayout = resolveLayout(
  load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml,
);
const projectCatalog = ProjectCatalog.load('.');

describe('tile cost comparison', () => {
  it('models both long wood-look options from resolved dry-room geometry and keeps wet rooms out', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog);

    assert.deepEqual(result.area.dryRoomIds, [
      'living_dining', 'kitchen', 'master_bedroom', 'study', 'bedroom_nw', 'bedroom_se',
    ]);
    assert.equal(result.area.rooms.length, 6);
    assert.equal(result.area.netDryAreaSqm, 111.864);
    assert.ok(!result.area.dryRoomIds.some(id => /bath|balcony|toilet/i.test(id)));

    const kt = result.candidates.find(candidate => candidate.id === 'kt_200x1200')!;
    assert.equal(kt.materialId, 'floor_tile_kt_200x1200_01');
    assert.equal(kt.materialValidation.status, 'passed');
    assert.equal(kt.materialValidation.materialSpec, '200x1200mm');
    assert.equal(kt.materialValidation.materialPriceYuan, 29);
    assert.equal(kt.materialValidation.coveragePerUnitSqm, 0.24);
    assert.equal(kt.modeled.requiredPieces, 504);
    assert.equal(kt.quoted.pieces, 516);
    assert.equal(kt.quoteVsModel.quotedPieceDelta, 12);
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
    assert.equal(jinyi.modeled.requiredPieces, 895);
    assert.equal(jinyi.quoted.pieces, 970);
    assert.equal(jinyi.quoteVsModel.quotedPieceDelta, 75);
    assert.equal(jinyi.quoted.coverageSqm, 130.95);
    assert.equal(jinyi.quoted.materialTotalYuan, 17266);
    assert.equal(jinyi.quoted.reportedFullMaterialTotalYuan, 23926);
  });

  it('does not turn unknown carton sizes or installation costs into hidden zeroes', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog);
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
    const result = buildTileCostComparison(projectLayout, config, projectCatalog);
    const kt = result.candidates[0];
    assert.equal(kt.modeled.piecesBeforeCartonRounding, 504);
    assert.equal(kt.modeled.requiredPieces, 510);
    assert.equal(kt.modeled.cartonRoundingApplied, true);
  });

  it('rejects missing room IDs instead of silently omitting area', () => {
    const config = loadTileComparisonConfig();
    config.dry_room_ids.push('missing_room');
    assert.throws(() => buildTileCostComparison(projectLayout, config, projectCatalog), /Dry floor room not found/);
  });

  it('preserves secondary material totals outside the modeled floor comparison', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog);
    assert.deepEqual(result.otherQuotedMaterialTotals.map(item => item.reportedFullMaterialTotalYuan), [21108, 23926]);
    assert.equal(result.otherQuotedMaterialTotals[1].alternativeReportedFullMaterialTotalYuan, 27130);
    assert.match(result.otherQuotedMaterialTotals[0].note, /outside the modeled dry-room main-floor scope/);
  });

  it('models the selected wet-zone baseline from resolved rooms and catalog pricing separately', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog);
    assert.deepEqual(result.wetBaseline.items.map(item => [item.roomId, item.materialId]), [
      ['master_bath', 'floor_tile_antislip_400'],
      ['balcony', 'floor_tile_antislip_400'],
      ['guest_bath', 'floor_tile_deco_small'],
    ]);
    assert.deepEqual(result.wetBaseline.items.map(item => item.netAreaSqm), [4.576, 1.92, 3.15]);
    assert.deepEqual(result.wetBaseline.items.map(item => item.modeledQuantity), [31, 13, 3.47]);
    assert.deepEqual(result.wetBaseline.items.map(item => item.materialCostYuan), [372, 156, 694]);
    assert.equal(result.wetBaseline.netAreaSqm, 9.646);
    assert.equal(result.wetBaseline.materialCostYuan, 1222);
    assert.deepEqual(result.scenarioTotals.map(item => item.totalProvisionalFloorMaterialsYuan), [15838, 17153]);
  });

  it('totals the KT floor scheme with only the unchanged balcony baseline, not superseded bathroom baseline', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog);
    assert.equal(result.ktNewSchemeFloorMaterials.dryMainFloorMaterialYuan, 14616);
    assert.equal(result.ktNewSchemeFloorMaterials.ktBathroomFloorMaterialYuan, 672);
    assert.equal(result.ktNewSchemeFloorMaterials.unchangedBalconyBaselineMaterialYuan, 156);
    assert.deepEqual(result.ktNewSchemeFloorMaterials.currentBaselineRoomIdsIncluded, ['balcony']);
    assert.equal(result.ktNewSchemeFloorMaterials.supersededBathroomBaselineIncluded, false);
    assert.equal(result.ktNewSchemeFloorMaterials.totalProvisionalFloorMaterialsYuan, 15444);
    // The separate current baseline still contains both bathrooms + balcony (¥1,222), and is not added in full.
    assert.equal(result.wetBaseline.materialCostYuan, 1222);
  });

  it('exposes the mason rate card and separate net-area labor scenarios without adding labor to budget pools', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog);
    const labor = result.masonryLaborEstimate;
    assert.equal(result.masonryRateCard.source, 'docs/design-iterations/tile-plank-comparison-20261006/evidence/mason-labor-rate-card.jpg');
    assert.equal(result.masonryRateCard.floor_rates_yuan_per_sqm.find(rate => rate.specification.includes('木纹砖'))?.price, 75);
    assert.equal(result.masonryRateCard.wall_rates_yuan_per_sqm.find(rate => rate.specification === '600x1200')?.price, 65);
    assert.equal(result.masonryRateCard.conditional_addons.find(addon => addon.id === 'floor_protection_film')?.price, 5);

    assert.equal(labor.mainDryFloor.netAreaSqm, 111.864);
    assert.equal(labor.mainDryFloor.rateYuanPerSqm, 75);
    assert.equal(labor.mainDryFloor.laborSubtotalYuan, 8389.8);
    assert.equal(labor.mainDryFloor.fishbonePremiumYuanPerSqm, 50);
    assert.equal(labor.mainDryFloor.fishboneEquivalentRateYuanPerSqm, 125);
    assert.equal(labor.ktBathroomFloors.netAreaSqm, 7.726);
    assert.equal(labor.ktBathroomFloors.areaRateYuanPerSqm, 45);
    assert.equal(labor.ktBathroomFloors.areaRateSubtotalYuan, 347.67);
    assert.equal(labor.ktBathroomFloors.roomCount, 2);
    assert.equal(labor.ktBathroomFloors.flatOnlyInterpretationYuan, 600);
    assert.equal(labor.ktBathroomFloors.additiveIfConfirmedInterpretationYuan, 947.67);
    assert.deepEqual(labor.ktBathroomFloors.interpretations.map(option => option.dryPlusBathroomLaborYuan), [8989.8, 9337.47]);
    assert.equal(labor.ktBathroomFloors.selectedInterpretation, null);
    assert.equal(labor.includedInOwnerLaborBudgetPool, false);
    assert.match(labor.scopeStatus, /not an all-inclusive/);
  });

  it('rejects quote candidates whose mapped catalog price no longer matches', () => {
    const config = loadTileComparisonConfig();
    config.candidates[0].unit_price_yuan = 30;
    assert.throws(
      () => buildTileCostComparison(projectLayout, config, projectCatalog),
      /Mapped material price does not match quote unit price/,
    );
  });

  it('keeps full store quote schedules, line extensions, scopes, and unresolved JYT bathroom mappings explicit', () => {
    const result = buildTileCostComparison(projectLayout, loadTileComparisonConfig(), projectCatalog);
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
