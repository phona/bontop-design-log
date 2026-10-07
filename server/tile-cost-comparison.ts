import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { ResolvedLayout } from '../shared/types.js';
import type { ProjectCatalog } from './project-catalog.js';

export interface TileQuoteLine {
  label: string;
  piece_count: number;
  unit_price_yuan: number;
  quoted_total_yuan: number;
  dimensions_status?: string;
  dimensions_mm?: { length: number; width: number };
  estimated_area_sqm?: number;
  estimated_area_status?: string;
  room_id?: string;
  room_mapping_status?: string;
  surface?: string;
  surface_mapping_status?: string;
  material_id?: string;
  visible_discounted_unit_price_yuan?: number;
  visible_discount_status?: string;
  hypothesized_group?: string;
  hypothesis_confidence?: string;
  hypothesis_rationale?: string;
  hypothesized_room_ids?: string[];
  hypothesized_surface?: string;
  // This is deliberately not modeled until the project supplies net wall areas.
}

export interface TileQuoteCandidate {
  id: string;
  material_id: string;
  supplier: string;
  product_description: string;
  dimensions_mm: { length: number; width: number };
  dimensions_status: string;
  unit_price_yuan: number;
  quoted_piece_count: number;
  quoted_material_total_yuan: number;
  reported_full_material_total_yuan: number;
  alternative_reported_full_material_total_yuan?: number;
  quote_scope: string;
  quote_observed_at: string;
  quote_source: string;
  quote_status: string;
  carton_size: number | null;
  carton_size_status: string;
  additional_quote_lines: TileQuoteLine[];
  user_derived_additional_quote_discounted_total_yuan?: number;
  user_derived_discount_status?: string;
  user_derived_discount_rate?: number;
  additional_quote_original_total_yuan?: number;
  reported_full_material_total_status?: string;
  alternative_reported_full_material_total_status?: string;
}

export interface TileWetBaselineItem {
  room_id: string;
  material_id: string;
  description: string;
}

export interface KTBathFloorModelConfig {
  material_id: string;
  room_ids: string[];
  note: string;
}

export interface MasonryRateCard {
  source: string;
  observed_at: string;
  quote_status: string;
  currency: string;
  floor_rates_yuan_per_sqm: Array<{ specification: string; price: number }>;
  wall_rates_yuan_per_sqm: Array<{ specification: string; price: number }>;
  conditional_addons: Array<{ id: string; label: string; price: number; unit: string; status: string; scope_status?: string }>;
  extras: Array<{ label: string; price: number; unit: string; note?: string }>;
  notes: string[];
  bathroom_floor_charge_interpretations: {
    source_text: string;
    selection_status: string;
    options: Array<{ id: string; mode: 'flat_replaces_area_rate' | 'additive_only_if_mason_confirms'; note: string }>;
  };
}

export interface StoreQuoteBreakdown {
  candidateId: string;
  supplier: string;
  quoteStatus: string;
  mainFloor: {
    description: string;
    specificationStatus: string;
    dimensionsMm: { length: number; width: number };
    pieces: number;
    nominalCoverageSqm: number;
    unitPriceYuan: number;
    quotedTotalYuan: number;
  };
  additionalLines: Array<{
    label: string;
    pieces: number;
    unitPriceYuan: number;
    quotedTotalYuan: number;
    extendedAtQuotedUnitPriceYuan: number;
    visibleDiscountedUnitPriceYuan: number | null;
    visibleDiscountedExtendedYuan: number | null;
    visibleDiscountStatus: string;
    hypothesizedGroup: string | null;
    hypothesisConfidence: string | null;
    hypothesisRationale: string | null;
    hypothesizedRoomIds: string[];
    hypothesizedSurface: string | null;
    dimensionsMm: { length: number; width: number } | null;
    dimensionsStatus: string;
    roomId: string | null;
    roomMappingStatus: string;
    surface: string | null;
    surfaceMappingStatus: string;
    materialId: string | null;
    materialMappingStatus: 'passed' | 'unspecified';
    nominalCoverageSqm: number | null;
    estimatedAreaSqm: number | null;
    estimatedAreaStatus: string | null;
    modeledOrderStatus: string;
  }>;
  summary: {
    mainFloorQuotedTotalYuan: number;
    additionalQuotedSubtotalYuan: number;
    additionalExtendedAtQuotedUnitPricesYuan: number;
    mainPlusAdditionalQuotedLineTotalYuan: number;
    visibleDiscountedLinesSubtotalYuan: number | null;
    subtotalUsingVisibleDiscountsAndQuotedPriceForUnshownLinesYuan: number | null;
    mainPlusVisiblePricingBasisYuan: number | null;
    userDerivedAdditionalDiscountedSubtotalYuan: number | null;
    userDerivedAdditionalDiscountStatus: string | null;
    userDerivedDiscountRate: number | null;
    mainPlusUserDerivedAdditionalYuan: number | null;
    visiblePricingBasisVsUserDerivedDeltaYuan: number | null;
    reportedFullMaterialTotalYuan: number;
    reportedFullMaterialTotalStatus: string | null;
    reportedFullVsQuotedLinesDeltaYuan: number;
    alternativeReportedFullMaterialTotalYuan: number | null;
    alternativeReportedFullMaterialTotalStatus: string | null;
  };
}

export interface TileComparisonConfig {
  version: number;
  area_source: string;
  area_basis: string;
  dry_room_ids: string[];
  planning: {
    loss_multiplier: number;
    loss_multiplier_status: string;
    carton_size: number | null;
    carton_size_status: string;
  };
  fees: Record<string, { status: 'unknown' | 'quoted' | 'included'; amount_yuan?: number }>;
  candidates: TileQuoteCandidate[];
  wet_baseline: { source: string; items: TileWetBaselineItem[] };
  kt_bath_floor_model: KTBathFloorModelConfig;
  masonry_rate_card: MasonryRateCard;
}

export interface TileCandidateComparison {
  id: string;
  materialId: string;
  materialValidation: { status: 'passed'; materialSpec: string; materialPriceYuan: number; coveragePerUnitSqm: number; lossMultiplier: number };
  supplier: string;
  productDescription: string;
  dimensionsMm: { length: number; width: number };
  dimensionsStatus: string;
  areaPerPieceSqm: number;
  unitPriceYuan: number;
  quoted: {
    pieces: number;
    coverageSqm: number;
    materialTotalYuan: number;
    reportedFullMaterialTotalYuan: number;
    scope: string;
    status: string;
    provenance: { source: string; observedAt: string };
  };
  modeled: {
    lossMultiplier: number;
    lossMultiplierStatus: string;
    piecesBeforeCartonRounding: number;
    cartonSize: number | null;
    cartonRoundingApplied: boolean;
    requiredPieces: number;
    coverageSqm: number;
    materialCostYuan: number;
  };
  quoteVsModel: {
    quotedPieceDelta: number;
    quotedMaterialCostDeltaYuan: number;
    quotedCoverageDeltaSqm: number;
  };
}

export interface WetBaselineItemResult {
  roomId: string;
  roomName: string;
  materialId: string;
  description: string;
  materialSpec: string;
  unit: string;
  netAreaSqm: number;
  unitPriceYuan: number;
  coveragePerUnitSqm: number;
  lossMultiplier: number;
  modeledQuantity: number;
  modeledCoverageSqm: number;
  materialCostYuan: number;
  cartonSize: null;
  cartonStatus: 'unknown';
}

export interface TileCostComparison {
  area: {
    source: string;
    basis: string;
    dryRoomIds: string[];
    rooms: Array<{ id: string; name: string; areaSqm: number }>;
    netDryAreaSqm: number;
  };
  feeStatus: Record<string, { status: string; amountYuan?: number }>;
  candidates: TileCandidateComparison[];
  wetBaseline: {
    source: string;
    items: WetBaselineItemResult[];
    netAreaSqm: number;
    materialCostYuan: number;
  };
  scenarioTotals: Array<{
    candidateId: string;
    dryMainFloorMaterialYuan: number;
    wetBaselineMaterialYuan: number;
    totalProvisionalFloorMaterialsYuan: number;
    scopeStatus: 'dry_main_floor_plus_current_wet_baseline_not_full_store_scheme_total';
    fullStoreSchemeComparable: false;
  }>;
  ktBathFloorModel: {
    note: string;
    materialId: string;
    materialSpec: string;
    unitPriceYuan: number;
    coveragePerUnitSqm: number;
    lossMultiplier: number;
    rooms: Array<{
      roomId: string;
      roomName: string;
      netAreaSqm: number;
      modeledPieces: number;
      modeledMaterialCostYuan: number;
      quotedPieces: number;
      quotedMaterialTotalYuan: number;
      quoteVsModelPieceDelta: number;
      quoteVsModelCostDeltaYuan: number;
    }>;
    modeledTotalPieces: number;
    modeledMaterialCostYuan: number;
    quotedTotalPieces: number;
    quotedMaterialTotalYuan: number;
  };
  ktNewSchemeFloorMaterials: {
    dryMainFloorMaterialYuan: number;
    ktBathroomFloorMaterialYuan: number;
    unchangedBalconyBaselineMaterialYuan: number;
    totalProvisionalFloorMaterialsYuan: number;
    currentBaselineRoomIdsIncluded: string[];
    supersededBathroomBaselineIncluded: false;
    includesWallTileQuotes: false;
  };
  masonryRateCard: MasonryRateCard;
  dryFloorMaterialAndOrdinaryLaborByCandidate: Array<{
    candidateId: string;
    netAreaSqm: number;
    modeledDryFloorMaterialYuan: number;
    ordinaryLaborRateYuanPerSqm: number;
    ordinaryLaborSubtotalYuan: number;
    sameScopeSubtotalYuan: number;
    scopeNote: string;
    excludesBathroom: true;
    excludesWalls: true;
    excludesBalcony: true;
    excludesOtherExtras: true;
    includedInOwnerLaborBudgetPool: false;
  }>;
  masonryLaborEstimate: {
    basis: string;
    scopeStatus: string;
    mainDryFloor: {
      netAreaSqm: number;
      roomIds: string[];
      pavingType: 'ordinary';
      rateYuanPerSqm: number;
      laborSubtotalYuan: number;
      fishbonePremiumYuanPerSqm: number;
      fishboneEquivalentRateYuanPerSqm: number;
    };
    ktBathroomFloors: {
      netAreaSqm: number;
      roomIds: string[];
      areaRateYuanPerSqm: number;
      areaRateSubtotalYuan: number;
      flatRoomRateYuanPerRoom: number;
      roomCount: number;
      flatOnlyInterpretationYuan: number;
      additiveIfConfirmedInterpretationYuan: number;
      interpretations: Array<{
        id: string;
        mode: 'flat_replaces_area_rate' | 'additive_only_if_mason_confirms';
        bathroomLaborYuan: number;
        dryPlusBathroomLaborYuan: number;
        note: string;
      }>;
      selectedInterpretation: null;
    };
    fullEstimateStatus: 'labor_rate_estimate_only_excludes_material_and_unpriced_extras';
    includedInOwnerLaborBudgetPool: false;
  };
  storeQuotes: StoreQuoteBreakdown[];
  otherQuotedMaterialTotals: Array<{
    candidateId: string;
    reportedFullMaterialTotalYuan: number;
    alternativeReportedFullMaterialTotalYuan?: number;
    note: string;
  }>;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1_000) / 1_000;

function requiredPositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`);
}

export function loadTileComparisonConfig(path = 'config/tile-comparison.yaml'): TileComparisonConfig {
  return load(readFileSync(path, 'utf8')) as TileComparisonConfig;
}

export function buildTileCostComparison(
  layout: ResolvedLayout,
  config: TileComparisonConfig,
  catalog: ProjectCatalog,
): TileCostComparison {
  if (!config.dry_room_ids.length) throw new Error('dry_room_ids must include at least one room');
  if (!Number.isFinite(config.planning.loss_multiplier) || config.planning.loss_multiplier < 1) {
    throw new Error('planning.loss_multiplier must be a finite number >= 1');
  }
  const roomById = new Map(layout.rooms.map(room => [room.id, room]));
  const rooms = config.dry_room_ids.map(id => {
    const room = roomById.get(id);
    if (!room) throw new Error(`Dry floor room not found in resolved layout: ${id}`);
    const areaSqm = room.area ?? room.width * room.depth;
    requiredPositiveNumber(areaSqm, `Resolved area for ${id}`);
    return { id: room.id, name: room.name, areaSqm };
  });
  const netDryAreaSqm = round3(rooms.reduce((sum, room) => sum + room.areaSqm, 0));

  const candidates = config.candidates.map((candidate): TileCandidateComparison => {
    requiredPositiveNumber(candidate.dimensions_mm.length, `${candidate.id} tile length`);
    requiredPositiveNumber(candidate.dimensions_mm.width, `${candidate.id} tile width`);
    requiredPositiveNumber(candidate.unit_price_yuan, `${candidate.id} unit price`);
    requiredPositiveNumber(candidate.quoted_piece_count, `${candidate.id} quoted pieces`);
    const areaPerPieceSqm = candidate.dimensions_mm.length * candidate.dimensions_mm.width / 1_000_000;
    const mappedOption = catalog.getOption('floor', candidate.material_id);
    if (!mappedOption) throw new Error(`Mapped floor material not found: ${candidate.material_id}`);
    const mappedMaterial = mappedOption.data as { spec?: string };
    const materialDimensions = (mappedMaterial.spec ?? '').match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const dimensionsMatch = materialDimensions.length >= 2
      && ((materialDimensions[0] === candidate.dimensions_mm.length && materialDimensions[1] === candidate.dimensions_mm.width)
        || (materialDimensions[1] === candidate.dimensions_mm.length && materialDimensions[0] === candidate.dimensions_mm.width));
    if (!dimensionsMatch) throw new Error(`Mapped material spec does not match quote dimensions: ${candidate.material_id}`);
    if (mappedOption.price_per_unit !== candidate.unit_price_yuan) {
      throw new Error(`Mapped material price does not match quote unit price: ${candidate.material_id}`);
    }
    if (Math.abs(mappedOption.coverage_per_unit - areaPerPieceSqm) > 0.000001) {
      throw new Error(`Mapped material coverage does not match quote dimensions: ${candidate.material_id}`);
    }
    if (mappedOption.loss_rate !== config.planning.loss_multiplier) {
      throw new Error(`Mapped material loss multiplier does not match planning multiplier: ${candidate.material_id}`);
    }
    const piecesBeforeCartonRounding = Math.ceil(netDryAreaSqm * config.planning.loss_multiplier / areaPerPieceSqm);
    const cartonSize = candidate.carton_size ?? config.planning.carton_size;
    if (cartonSize !== null) requiredPositiveNumber(cartonSize, `${candidate.id} carton size`);
    const requiredPieces = cartonSize === null
      ? piecesBeforeCartonRounding
      : Math.ceil(piecesBeforeCartonRounding / cartonSize) * cartonSize;
    const modeledCost = round2(requiredPieces * candidate.unit_price_yuan);
    const quoteCoverage = round2(candidate.quoted_piece_count * areaPerPieceSqm);
    const modeledCoverage = round2(requiredPieces * areaPerPieceSqm);

    return {
      id: candidate.id,
      materialId: candidate.material_id,
      materialValidation: {
        status: 'passed',
        materialSpec: mappedMaterial.spec ?? '',
        materialPriceYuan: mappedOption.price_per_unit,
        coveragePerUnitSqm: mappedOption.coverage_per_unit,
        lossMultiplier: mappedOption.loss_rate,
      },
      supplier: candidate.supplier,
      productDescription: candidate.product_description,
      dimensionsMm: candidate.dimensions_mm,
      dimensionsStatus: candidate.dimensions_status,
      areaPerPieceSqm: round3(areaPerPieceSqm),
      unitPriceYuan: candidate.unit_price_yuan,
      quoted: {
        pieces: candidate.quoted_piece_count,
        coverageSqm: quoteCoverage,
        materialTotalYuan: candidate.quoted_material_total_yuan,
        reportedFullMaterialTotalYuan: candidate.reported_full_material_total_yuan,
        scope: candidate.quote_scope,
        status: candidate.quote_status,
        provenance: { source: candidate.quote_source, observedAt: candidate.quote_observed_at },
      },
      modeled: {
        lossMultiplier: config.planning.loss_multiplier,
        lossMultiplierStatus: config.planning.loss_multiplier_status,
        piecesBeforeCartonRounding,
        cartonSize,
        cartonRoundingApplied: cartonSize !== null,
        requiredPieces,
        coverageSqm: modeledCoverage,
        materialCostYuan: modeledCost,
      },
      quoteVsModel: {
        quotedPieceDelta: candidate.quoted_piece_count - requiredPieces,
        quotedMaterialCostDeltaYuan: round2(candidate.quoted_material_total_yuan - modeledCost),
        quotedCoverageDeltaSqm: round2(quoteCoverage - netDryAreaSqm),
      },
    };
  });

  const wetBaselineItems = config.wet_baseline.items.map((item): WetBaselineItemResult => {
    const room = roomById.get(item.room_id);
    if (!room) throw new Error(`Wet baseline room not found in resolved layout: ${item.room_id}`);
    const option = catalog.getOption('floor', item.material_id);
    if (!option) throw new Error(`Wet baseline floor material not found: ${item.material_id}`);
    const material = option.data as { spec?: string; unit?: string };
    const netAreaSqm = room.area ?? room.width * room.depth;
    requiredPositiveNumber(netAreaSqm, `Resolved area for ${item.room_id}`);
    requiredPositiveNumber(option.coverage_per_unit, `${item.material_id} coverage per unit`);
    const rawQuantity = netAreaSqm * option.loss_rate / option.coverage_per_unit;
    // Piece priced materials use whole units; m² priced materials round up to 0.01 m² so measurement noise cannot underbuy.
    const modeledQuantity = material.unit === '片' ? Math.ceil(rawQuantity) : Math.ceil(rawQuantity * 100 - 1e-9) / 100;
    const modeledCoverageSqm = round2(modeledQuantity * option.coverage_per_unit);
    return {
      roomId: item.room_id,
      roomName: room.name,
      materialId: item.material_id,
      description: item.description,
      materialSpec: material.spec ?? '',
      unit: material.unit ?? 'unit',
      netAreaSqm: round3(netAreaSqm),
      unitPriceYuan: option.price_per_unit,
      coveragePerUnitSqm: option.coverage_per_unit,
      lossMultiplier: option.loss_rate,
      modeledQuantity,
      modeledCoverageSqm,
      materialCostYuan: round2(modeledQuantity * option.price_per_unit),
      cartonSize: null,
      cartonStatus: 'unknown',
    };
  });
  const wetNetAreaSqm = round3(wetBaselineItems.reduce((sum, item) => sum + item.netAreaSqm, 0));
  const wetBaselineMaterialYuan = round2(wetBaselineItems.reduce((sum, item) => sum + item.materialCostYuan, 0));

  const ktBathMaterial = catalog.getOption('floor', config.kt_bath_floor_model.material_id);
  if (!ktBathMaterial) throw new Error(`KT bath floor material not found: ${config.kt_bath_floor_model.material_id}`);
  if (ktBathMaterial.loss_rate !== config.planning.loss_multiplier) {
    throw new Error(`KT bath floor loss multiplier does not match planning multiplier: ${config.kt_bath_floor_model.material_id}`);
  }
  const ktQuote = config.candidates.find(candidate => candidate.id === 'kt_200x1200');
  if (!ktQuote) throw new Error('KT wood-plank quote candidate not found');
  const ktBathFloorRooms = config.kt_bath_floor_model.room_ids.map(roomId => {
    const room = roomById.get(roomId);
    if (!room) throw new Error(`KT bathroom floor room not found in resolved layout: ${roomId}`);
    const line = ktQuote.additional_quote_lines.find(item => item.room_id === roomId && item.surface === 'floor');
    if (!line) throw new Error(`KT store quote floor line not found for bathroom: ${roomId}`);
    if (line.material_id !== config.kt_bath_floor_model.material_id) {
      throw new Error(`KT bathroom floor line material mismatch for ${roomId}`);
    }
    const netAreaSqm = room.area ?? room.width * room.depth;
    const modeledPieces = Math.ceil(netAreaSqm * ktBathMaterial.loss_rate / ktBathMaterial.coverage_per_unit);
    const modeledMaterialCostYuan = round2(modeledPieces * ktBathMaterial.price_per_unit);
    return {
      roomId,
      roomName: room.name,
      netAreaSqm: round3(netAreaSqm),
      modeledPieces,
      modeledMaterialCostYuan,
      quotedPieces: line.piece_count,
      quotedMaterialTotalYuan: line.quoted_total_yuan,
      quoteVsModelPieceDelta: line.piece_count - modeledPieces,
      quoteVsModelCostDeltaYuan: round2(line.quoted_total_yuan - modeledMaterialCostYuan),
    };
  });
  const ktBathFloorModeledPieces = ktBathFloorRooms.reduce((sum, room) => sum + room.modeledPieces, 0);
  const ktBathFloorModeledCost = round2(ktBathFloorRooms.reduce((sum, room) => sum + room.modeledMaterialCostYuan, 0));
  const ktBathFloorQuotedPieces = ktBathFloorRooms.reduce((sum, room) => sum + room.quotedPieces, 0);
  const ktBathFloorQuotedCost = round2(ktBathFloorRooms.reduce((sum, room) => sum + room.quotedMaterialTotalYuan, 0));
  const unchangedBalconyBaseline = wetBaselineItems.find(item => item.roomId === 'balcony');
  if (!unchangedBalconyBaseline) throw new Error('Current balcony floor baseline is required for KT floor scheme total');
  const ktDryMainFloorCost = candidates.find(candidate => candidate.id === ktQuote.id)!.modeled.materialCostYuan;
  const woodPlankLaborRate = config.masonry_rate_card.floor_rates_yuan_per_sqm.find(item => item.specification.includes('木纹砖'));
  const bathroomTileLaborRate = config.masonry_rate_card.floor_rates_yuan_per_sqm.find(item => item.specification === '600x600');
  const bathroomRoomCharge = config.masonry_rate_card.conditional_addons.find(item => item.id === 'bathroom_floor_room_charge');
  if (!woodPlankLaborRate || !bathroomTileLaborRate || !bathroomRoomCharge) {
    throw new Error('Masonry rate card is missing a required wood plank or bathroom floor rate');
  }
  const ktBathroomNetAreaSqm = round3(ktBathFloorRooms.reduce((sum, room) => sum + room.netAreaSqm, 0));
  const dryFloorLaborSubtotalYuan = round2(netDryAreaSqm * woodPlankLaborRate.price);
  const bathroomFloorAreaRateSubtotalYuan = round2(ktBathroomNetAreaSqm * bathroomTileLaborRate.price);
  const bathroomFlatRoomAmountYuan = round2(ktBathFloorRooms.length * bathroomRoomCharge.price);
  const bathroomLaborInterpretations = config.masonry_rate_card.bathroom_floor_charge_interpretations.options.map(option => {
    const bathroomLaborYuan = option.mode === 'flat_replaces_area_rate'
      ? bathroomFlatRoomAmountYuan
      : round2(bathroomFloorAreaRateSubtotalYuan + bathroomFlatRoomAmountYuan);
    return {
      id: option.id,
      mode: option.mode,
      bathroomLaborYuan,
      dryPlusBathroomLaborYuan: round2(dryFloorLaborSubtotalYuan + bathroomLaborYuan),
      note: option.note,
    };
  });
  const flatOnlyInterpretation = bathroomLaborInterpretations.find(option => option.mode === 'flat_replaces_area_rate');
  const additiveInterpretation = bathroomLaborInterpretations.find(option => option.mode === 'additive_only_if_mason_confirms');
  if (!flatOnlyInterpretation || !additiveInterpretation) throw new Error('Both bathroom floor labor interpretations must be configured');

  const storeQuotes = config.candidates.map((candidate): StoreQuoteBreakdown => {
    const additionalQuotedSubtotalYuan = round2(candidate.additional_quote_lines.reduce((sum, line) => sum + line.quoted_total_yuan, 0));
    const additionalExtendedAtQuotedUnitPricesYuan = round2(candidate.additional_quote_lines.reduce(
      (sum, line) => sum + line.piece_count * line.unit_price_yuan,
      0,
    ));
    const mainPlusAdditionalQuotedLineTotalYuan = round2(candidate.quoted_material_total_yuan + additionalQuotedSubtotalYuan);
    const userDerivedDiscounted = candidate.user_derived_additional_quote_discounted_total_yuan;
    const hasVisibleDiscounts = candidate.additional_quote_lines.some(line => line.visible_discounted_unit_price_yuan !== undefined);
    const visibleDiscountedLinesSubtotalYuan = hasVisibleDiscounts
      ? round2(candidate.additional_quote_lines.reduce((sum, line) => sum + line.piece_count * (line.visible_discounted_unit_price_yuan ?? 0), 0))
      : null;
    const subtotalUsingVisibleDiscountsAndQuotedPriceForUnshownLinesYuan = hasVisibleDiscounts
      ? round2(candidate.additional_quote_lines.reduce((sum, line) => sum + line.piece_count * (line.visible_discounted_unit_price_yuan ?? line.unit_price_yuan), 0))
      : null;
    return {
      candidateId: candidate.id,
      supplier: candidate.supplier,
      quoteStatus: candidate.quote_status,
      mainFloor: {
        description: candidate.product_description,
        specificationStatus: candidate.dimensions_status,
        dimensionsMm: candidate.dimensions_mm,
        pieces: candidate.quoted_piece_count,
        nominalCoverageSqm: round2(candidate.quoted_piece_count * candidate.dimensions_mm.length * candidate.dimensions_mm.width / 1_000_000),
        unitPriceYuan: candidate.unit_price_yuan,
        quotedTotalYuan: candidate.quoted_material_total_yuan,
      },
      additionalLines: candidate.additional_quote_lines.map(line => {
        const nominalCoverageSqm = line.dimensions_mm
          ? round2(line.piece_count * line.dimensions_mm.length * line.dimensions_mm.width / 1_000_000)
          : null;
        if (line.material_id) {
          const topic = line.surface === 'wall' ? 'wall' : 'floor';
          const option = catalog.getOption(topic, line.material_id);
          if (!option) throw new Error(`Mapped store quote material not found: ${line.material_id}`);
          if (option.price_per_unit !== line.unit_price_yuan) {
            throw new Error(`Mapped store quote material price mismatch: ${line.material_id}`);
          }
          if (nominalCoverageSqm !== null && Math.abs(option.coverage_per_unit - line.dimensions_mm!.length * line.dimensions_mm!.width / 1_000_000) > 0.000001) {
            throw new Error(`Mapped store quote material coverage mismatch: ${line.material_id}`);
          }
        }
        return {
          label: line.label,
          pieces: line.piece_count,
          unitPriceYuan: line.unit_price_yuan,
          quotedTotalYuan: line.quoted_total_yuan,
          extendedAtQuotedUnitPriceYuan: round2(line.piece_count * line.unit_price_yuan),
          visibleDiscountedUnitPriceYuan: line.visible_discounted_unit_price_yuan ?? null,
          visibleDiscountedExtendedYuan: line.visible_discounted_unit_price_yuan !== undefined
            ? round2(line.piece_count * line.visible_discounted_unit_price_yuan)
            : null,
          visibleDiscountStatus: line.visible_discount_status ?? 'not_provided',
          hypothesizedGroup: line.hypothesized_group ?? null,
          hypothesisConfidence: line.hypothesis_confidence ?? null,
          hypothesisRationale: line.hypothesis_rationale ?? null,
          hypothesizedRoomIds: line.hypothesized_room_ids ?? [],
          hypothesizedSurface: line.hypothesized_surface ?? null,
          dimensionsMm: line.dimensions_mm ?? null,
          dimensionsStatus: line.dimensions_status ?? 'unspecified',
          roomId: line.room_id ?? null,
          roomMappingStatus: line.room_mapping_status ?? 'unspecified',
          surface: line.surface ?? null,
          surfaceMappingStatus: line.surface_mapping_status ?? 'unspecified',
          materialId: line.material_id ?? null,
          materialMappingStatus: line.material_id ? 'passed' : 'unspecified',
          nominalCoverageSqm,
          estimatedAreaSqm: line.estimated_area_sqm ?? null,
          estimatedAreaStatus: line.estimated_area_status ?? null,
          modeledOrderStatus: line.surface === 'wall'
            ? 'not_modeled_net_wall_area_required'
            : line.material_id && candidate.id === 'kt_200x1200' && line.surface === 'floor'
              ? 'modeled_in_kt_bath_floor_alternative'
              : 'not_modeled',
        };
      }),
      summary: {
        mainFloorQuotedTotalYuan: candidate.quoted_material_total_yuan,
        additionalQuotedSubtotalYuan,
        additionalExtendedAtQuotedUnitPricesYuan,
        mainPlusAdditionalQuotedLineTotalYuan,
        visibleDiscountedLinesSubtotalYuan,
        subtotalUsingVisibleDiscountsAndQuotedPriceForUnshownLinesYuan,
        mainPlusVisiblePricingBasisYuan: subtotalUsingVisibleDiscountsAndQuotedPriceForUnshownLinesYuan !== null
          ? round2(candidate.quoted_material_total_yuan + subtotalUsingVisibleDiscountsAndQuotedPriceForUnshownLinesYuan)
          : null,
        userDerivedAdditionalDiscountedSubtotalYuan: userDerivedDiscounted ?? null,
        userDerivedAdditionalDiscountStatus: candidate.user_derived_discount_status ?? null,
        userDerivedDiscountRate: candidate.user_derived_discount_rate ?? null,
        mainPlusUserDerivedAdditionalYuan: userDerivedDiscounted !== undefined
          ? round2(candidate.quoted_material_total_yuan + userDerivedDiscounted)
          : null,
        visiblePricingBasisVsUserDerivedDeltaYuan: subtotalUsingVisibleDiscountsAndQuotedPriceForUnshownLinesYuan !== null && userDerivedDiscounted !== undefined
          ? round2(subtotalUsingVisibleDiscountsAndQuotedPriceForUnshownLinesYuan - userDerivedDiscounted)
          : null,
        reportedFullMaterialTotalYuan: candidate.reported_full_material_total_yuan,
        reportedFullMaterialTotalStatus: candidate.reported_full_material_total_status ?? null,
        reportedFullVsQuotedLinesDeltaYuan: round2(candidate.reported_full_material_total_yuan - mainPlusAdditionalQuotedLineTotalYuan),
        alternativeReportedFullMaterialTotalYuan: candidate.alternative_reported_full_material_total_yuan ?? null,
        alternativeReportedFullMaterialTotalStatus: candidate.alternative_reported_full_material_total_status ?? null,
      },
    };
  });

  return {
    area: {
      source: config.area_source,
      basis: config.area_basis,
      dryRoomIds: [...config.dry_room_ids],
      rooms,
      netDryAreaSqm,
    },
    // Unknown fees stay unknown and have no numeric amount. They are never folded into material totals.
    feeStatus: Object.fromEntries(Object.entries(config.fees).map(([key, value]) => [key, { ...value }])),
    candidates,
    wetBaseline: {
      source: config.wet_baseline.source,
      items: wetBaselineItems,
      netAreaSqm: wetNetAreaSqm,
      materialCostYuan: wetBaselineMaterialYuan,
    },
    scenarioTotals: candidates.map(candidate => ({
      candidateId: candidate.id,
      dryMainFloorMaterialYuan: candidate.modeled.materialCostYuan,
      wetBaselineMaterialYuan: wetBaselineMaterialYuan,
      totalProvisionalFloorMaterialsYuan: round2(candidate.modeled.materialCostYuan + wetBaselineMaterialYuan),
      scopeStatus: 'dry_main_floor_plus_current_wet_baseline_not_full_store_scheme_total',
      fullStoreSchemeComparable: false,
    })),
    ktBathFloorModel: {
      note: config.kt_bath_floor_model.note,
      materialId: config.kt_bath_floor_model.material_id,
      materialSpec: (ktBathMaterial.data as { spec?: string }).spec ?? '',
      unitPriceYuan: ktBathMaterial.price_per_unit,
      coveragePerUnitSqm: ktBathMaterial.coverage_per_unit,
      lossMultiplier: ktBathMaterial.loss_rate,
      rooms: ktBathFloorRooms,
      modeledTotalPieces: ktBathFloorModeledPieces,
      modeledMaterialCostYuan: ktBathFloorModeledCost,
      quotedTotalPieces: ktBathFloorQuotedPieces,
      quotedMaterialTotalYuan: ktBathFloorQuotedCost,
    },
    ktNewSchemeFloorMaterials: {
      dryMainFloorMaterialYuan: ktDryMainFloorCost,
      ktBathroomFloorMaterialYuan: ktBathFloorModeledCost,
      unchangedBalconyBaselineMaterialYuan: unchangedBalconyBaseline.materialCostYuan,
      totalProvisionalFloorMaterialsYuan: round2(ktDryMainFloorCost + ktBathFloorModeledCost + unchangedBalconyBaseline.materialCostYuan),
      currentBaselineRoomIdsIncluded: ['balcony'],
      supersededBathroomBaselineIncluded: false,
      includesWallTileQuotes: false,
    },
    masonryRateCard: config.masonry_rate_card,
    dryFloorMaterialAndOrdinaryLaborByCandidate: candidates.map(candidate => ({
      candidateId: candidate.id,
      netAreaSqm: netDryAreaSqm,
      modeledDryFloorMaterialYuan: candidate.modeled.materialCostYuan,
      ordinaryLaborRateYuanPerSqm: woodPlankLaborRate.price,
      ordinaryLaborSubtotalYuan: dryFloorLaborSubtotalYuan,
      sameScopeSubtotalYuan: round2(candidate.modeled.materialCostYuan + dryFloorLaborSubtotalYuan),
      scopeNote: 'Dry main floor only at ordinary paving rate; excludes bathroom, walls, balcony, and all extras. Labor uses net laid area without tile purchase loss and is not added to the owner labor budget pool.',
      excludesBathroom: true,
      excludesWalls: true,
      excludesBalcony: true,
      excludesOtherExtras: true,
      includedInOwnerLaborBudgetPool: false,
    })),
    masonryLaborEstimate: {
      basis: 'resolved net laid floor area; no tile purchase loss multiplier applied to labor area',
      scopeStatus: 'rate-card labor estimate only; not an all-inclusive installation quote',
      mainDryFloor: {
        netAreaSqm: netDryAreaSqm,
        roomIds: [...config.dry_room_ids],
        pavingType: 'ordinary',
        rateYuanPerSqm: woodPlankLaborRate.price,
        laborSubtotalYuan: dryFloorLaborSubtotalYuan,
        fishbonePremiumYuanPerSqm: config.masonry_rate_card.conditional_addons.find(item => item.id === 'wood_plank_fishbone_premium')?.price ?? 0,
        fishboneEquivalentRateYuanPerSqm: woodPlankLaborRate.price + (config.masonry_rate_card.conditional_addons.find(item => item.id === 'wood_plank_fishbone_premium')?.price ?? 0),
      },
      ktBathroomFloors: {
        netAreaSqm: ktBathroomNetAreaSqm,
        roomIds: ktBathFloorRooms.map(room => room.roomId),
        areaRateYuanPerSqm: bathroomTileLaborRate.price,
        areaRateSubtotalYuan: bathroomFloorAreaRateSubtotalYuan,
        flatRoomRateYuanPerRoom: bathroomRoomCharge.price,
        roomCount: ktBathFloorRooms.length,
        flatOnlyInterpretationYuan: flatOnlyInterpretation.bathroomLaborYuan,
        additiveIfConfirmedInterpretationYuan: additiveInterpretation.bathroomLaborYuan,
        interpretations: bathroomLaborInterpretations,
        selectedInterpretation: null,
      },
      fullEstimateStatus: 'labor_rate_estimate_only_excludes_material_and_unpriced_extras',
      includedInOwnerLaborBudgetPool: false,
    },
    storeQuotes,
    otherQuotedMaterialTotals: config.candidates.map(candidate => ({
      candidateId: candidate.id,
      reportedFullMaterialTotalYuan: candidate.reported_full_material_total_yuan,
      ...(candidate.alternative_reported_full_material_total_yuan !== undefined
        ? { alternativeReportedFullMaterialTotalYuan: candidate.alternative_reported_full_material_total_yuan }
        : {}),
      note: 'Includes quote lines outside the modeled dry-room main-floor scope; do not compare as like-for-like installed totals.',
    })),
  };
}
