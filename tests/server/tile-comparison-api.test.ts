import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { load } from 'js-yaml';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { createApiRouter } from '../../server/routes.js';
import type { DesignRulesConfig, VertexLayoutYaml } from '../../shared/types.js';

const TEST_DATA_DIR = './tmp/test-data-tile-comparison-api';

describe('GET /api/tiles/comparison', () => {
  let router: ReturnType<typeof createApiRouter>;
  let state: DesignState;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const catalog = ProjectCatalog.load('.');
    const geometry = load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml;
    const resolvedLayout = resolveLayout(geometry);
    state = DesignState.load(catalog, TEST_DATA_DIR);
    const rules: DesignRulesConfig = { version: '1.0', risks: [], constraints: [] };
    const engine = new RuleEngine(rules);
    const calc = new BudgetCalculator(catalog, rules);
    router = createApiRouter({
      catalog,
      state,
      getRuleEngine: () => engine,
      getBudgetCalculator: () => calc,
      archiveStore: new ArchivedSchemesStore(TEST_DATA_DIR),
      getConfigRegistry: () => new ConfigRegistry(),
      getOverlay: () => undefined,
      getResolvedLayout: () => resolvedLayout,
    });
  });

  function callRoute(method: 'get' | 'post'): { statusCode: number; body?: unknown; exists: boolean } {
    const stack = (router as unknown as {
      stack: Array<{ route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => void }>;
      } }>;
    }).stack;
    const route = stack.map(layer => layer.route).find(item => item?.path === '/tiles/comparison');
    if (!route?.methods[method]) return { statusCode: 404, exists: false };
    let statusCode = 200;
    let body: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      json(value: unknown) { body = value; return this; },
    } as unknown as Response;
    route.stack[0].handle({} as Request, response);
    return { statusCode, body, exists: true };
  }

  it('returns a read-only same-area comparison and keeps non-main quote lines and unknown fees separate', async () => {
    const schemeBefore = JSON.stringify(state.getCurrentScheme());
    const response = callRoute('get');
    assert.equal(response.statusCode, 200);
    const body = response.body as Record<string, any>;

    assert.equal(body.area.netDryAreaSqm, 111.864);
    assert.equal(body.candidates.length, 2);
    assert.deepEqual(
      body.candidates.map((candidate: { modeled: { requiredPieces: number } }) => candidate.modeled.requiredPieces),
      [504, 895],
    );
    assert.deepEqual(
      body.candidates.map((candidate: { quoted: { pieces: number } }) => candidate.quoted.pieces),
      [516, 970],
    );
    assert.equal(body.quoteScopeDetails[0].additionalLines.length, 7);
    assert.equal(body.quoteScopeDetails[0].additionalOriginalTotalYuan, undefined);
    assert.equal(body.quoteScopeDetails[0].reportedFullMaterialTotalYuan, 21108);
    assert.equal(body.quoteScopeDetails[1].additionalOriginalTotalYuan, 7400);
    assert.equal(body.quoteScopeDetails[1].userDerivedAdditionalDiscountedTotalYuan, 6660);
    assert.equal(body.quoteScopeDetails[1].userDerivedDiscountStatus, 'user_derived_90_percent_assumption_not_confirmed_on_uploaded_photo');
    assert.equal(body.quoteScopeDetails[1].alternativeReportedFullMaterialTotalYuan, 27130);
    assert.deepEqual(body.wetBaseline.items.map((item: { materialId: string }) => item.materialId), [
      'floor_tile_antislip_400', 'floor_tile_antislip_400', 'floor_tile_deco_small',
    ]);
    assert.equal(body.wetBaseline.materialCostYuan, 1222);
    assert.equal(body.storeQuotes[0].summary.reportedFullMaterialTotalYuan, 21108);
    assert.equal(body.storeQuotes[0].additionalLines.length, 7);
    assert.equal(body.storeQuotes[0].additionalLines[1].nominalCoverageSqm, 7.2);
    assert.equal(body.storeQuotes[0].additionalLines[1].modeledOrderStatus, 'not_modeled_net_wall_area_required');
    assert.equal(body.storeQuotes[1].summary.reportedFullMaterialTotalYuan, 23926);
    assert.equal(body.storeQuotes[1].summary.visibleDiscountedLinesSubtotalYuan, 5306.8);
    assert.equal(body.storeQuotes[1].summary.subtotalUsingVisibleDiscountsAndQuotedPriceForUnshownLinesYuan, 6746.8);
    assert.equal(body.storeQuotes[1].summary.visiblePricingBasisVsUserDerivedDeltaYuan, 86.8);
    assert.equal(body.storeQuotes[1].additionalLines[0].nominalCoverageSqm, null);
    assert.equal(body.storeQuotes[1].additionalLines[2].hypothesizedGroup, 'possible_bathroom_wall_quote');
    assert.equal(body.storeQuotes[1].additionalLines[2].hypothesisConfidence, 'low');
    assert.equal(body.storeQuotes[1].additionalLines[2].dimensionsStatus, 'unreadable');
    assert.equal(body.storeQuotes[1].additionalLines[2].roomId, null);
    assert.equal(body.storeQuotes[1].additionalLines[3].nominalCoverageSqm, 7.68);
    assert.equal(body.storeQuotes[1].additionalLines[3].hypothesizedGroup, 'possible_both_baths_floor');
    assert.deepEqual(body.storeQuotes[1].additionalLines[3].hypothesizedRoomIds, ['master_bath', 'guest_bath']);
    assert.equal(body.storeQuotes[1].additionalLines[3].roomId, null);
    assert.deepEqual(
      body.scenarioTotals.map((item: { totalProvisionalFloorMaterialsYuan: number }) => item.totalProvisionalFloorMaterialsYuan),
      [15838, 17153],
    );
    assert.equal(body.scenarioTotals[1].fullStoreSchemeComparable, false);
    assert.match(body.scenarioTotals[1].scopeStatus, /not_full_store_scheme_total/);
    assert.deepEqual(
      body.ktBathFloorModel.rooms.map((room: { roomId: string; modeledPieces: number; quotedPieces: number; quoteVsModelPieceDelta: number }) => [
        room.roomId, room.modeledPieces, room.quotedPieces, room.quoteVsModelPieceDelta,
      ]),
      [['guest_bath', 10, 10, 0], ['master_bath', 14, 20, 6]],
    );
    assert.equal(body.ktBathFloorModel.modeledMaterialCostYuan, 672);
    assert.equal(body.ktBathFloorModel.quotedMaterialTotalYuan, 840);
    assert.equal(body.ktNewSchemeFloorMaterials.unchangedBalconyBaselineMaterialYuan, 156);
    assert.equal(body.ktNewSchemeFloorMaterials.totalProvisionalFloorMaterialsYuan, 15444);
    assert.deepEqual(body.ktNewSchemeFloorMaterials.currentBaselineRoomIdsIncluded, ['balcony']);
    assert.equal(body.ktNewSchemeFloorMaterials.supersededBathroomBaselineIncluded, false);
    assert.equal(body.ktNewSchemeFloorMaterials.includesWallTileQuotes, false);
    assert.equal(body.wetBaseline.materialCostYuan, 1222);
    assert.equal(body.feeStatus.installation.status, 'unknown');
    assert.equal(body.masonryRateCard.floor_rates_yuan_per_sqm.find((rate: { specification: string }) => rate.specification.includes('木纹砖'))?.price, 75);
    assert.equal(body.masonryRateCard.extras.length, 13);
    assert.equal(body.masonryLaborEstimate.mainDryFloor.laborSubtotalYuan, 8389.8);
    assert.equal(body.masonryLaborEstimate.ktBathroomFloors.flatOnlyInterpretationYuan, 600);
    assert.equal(body.masonryLaborEstimate.ktBathroomFloors.additiveIfConfirmedInterpretationYuan, 947.67);
    assert.equal(body.masonryLaborEstimate.ktBathroomFloors.selectedInterpretation, null);
    assert.equal(body.masonryLaborEstimate.includedInOwnerLaborBudgetPool, false);
    assert.equal(body.interpretation.rawQuotedAmountsPreserved, true);
    assert.equal(body.interpretation.fullDesignAndRenderingStatus, 'illustrative_comparison_only_not_final_selection');
    assert.equal('amountYuan' in body.feeStatus.installation, false);
    assert.equal(JSON.stringify(state.getCurrentScheme()), schemeBefore);
  });

  it('does not expose a write method for the comparison resource', async () => {
    assert.deepEqual(callRoute('post'), { statusCode: 404, exists: false });
  });
});
