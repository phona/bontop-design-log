import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { ProjectCatalog } from './project-catalog.js';
import type { DesignState } from './design-state.js';
import type { RuleEngine } from './rule-engine.js';
import type { BudgetCalculator } from './budget-calculator.js';
import type { ArchivedSchemesStore } from './archived-schemes.js';
import type { ConfigRegistry } from './config-loader.js';
import { loadElectricalConfig, loadElectricalTopologyConfig, loadPlumbingConfig, loadCeilingConfig, loadMepCoordinationConfig } from './config-loader.js';
import { endpointSourcesFromFacts, validateMepCoordination } from '../shared/mep-hvac-coordination-schema.js';
import { lintElectricalTopology } from '../shared/electrical-lint.js';
import { lintMepCoordination, type MepLintLayoutContext } from '../shared/mep-hvac-lint.js';
import { mergeSceneElements } from './overlay-merge.js';
import type { OverlayConfig } from './overlay-merge.js';
import type { CurrentScheme, CurtainState, ProjectRenderFacts, ProjectRenderFactsProjection } from '../shared/types.js';
import type { EnvironmentConfig } from '../shared/environment-schema.js';
import type { PresentationStateStore } from './presentation-state.js';
import { filterCurtainElements, loadPhaseBudgetMeta, loadPhaseScopes, parsePhaseId } from './phase-scope.js';
import { buildTileCostComparison, loadTileComparisonConfig } from './tile-cost-comparison.js';
import { buildPaintCostComparison, loadPaintComparisonConfig } from './paint-cost-comparison.js';
import { computeCeilingTakeoff } from '../shared/ceiling-takeoff.js';
import { loadModelPackageLinks } from './model-package-links.js';
import {
  loadCeilingQuotes,
  setActiveCeilingQuote,
  resolveActiveCeilingRates,
  compareCeilingQuotes,
  ceilingQuoteQuantities,
} from './ceiling-quotes.js';

/** base.json 的兜底吊顶费率：生效报价未声明的计价行回落到它。 */
function baseJsonCeilingRates(): Record<'ceiling_zones' | 'curtain_box_linear', { per_unit: number | null; unit: string }> {
  const raw = JSON.parse(readFileSync('config/budget/base.json', 'utf8')) as {
    categories: Record<string, { labor?: { rate: number | null; unit: string; area: string } | Array<{ rate: number | null; unit: string; area: string }> }>;
  };
  const carpentry = raw.categories.carpentry;
  const entries = carpentry?.labor ? (Array.isArray(carpentry.labor) ? carpentry.labor : [carpentry.labor]) : [];
  const byArea = new Map(entries.map((entry) => [entry.area, entry]));
  return {
    ceiling_zones: { per_unit: byArea.get('ceiling_zones')?.rate ?? null, unit: byArea.get('ceiling_zones')?.unit ?? '元/㎡' },
    curtain_box_linear: { per_unit: byArea.get('curtain_box_linear')?.rate ?? null, unit: byArea.get('curtain_box_linear')?.unit ?? '元/m' },
  };
}
import type { ResolvedLayout } from '../shared/types.js';

export interface ApiDeps {
  catalog: ProjectCatalog;
  state: DesignState;
  getRuleEngine: () => RuleEngine;
  getBudgetCalculator: () => BudgetCalculator;
  archiveStore: ArchivedSchemesStore;
  getConfigRegistry: () => ConfigRegistry;
  getOverlay: () => OverlayConfig | undefined;
  presentationState?: PresentationStateStore;
  getEnvironment?: () => EnvironmentConfig | undefined;
  getProjectRenderFacts?: () => ProjectRenderFacts | undefined;
  getProjectRenderFactsProjection?: () => ProjectRenderFactsProjection | undefined;
  getMepLintContext?: () => MepLintLayoutContext;
  getResolvedLayout?: () => ResolvedLayout | undefined;
}

export function createApiRouter(deps: ApiDeps): Router {
  const { catalog, state, getRuleEngine, getBudgetCalculator, archiveStore } = deps;
  const router = Router();
  const phaseScopes = loadPhaseScopes();

  router.get('/config-status', (_req, res) => {
    res.json({ configs: deps.getConfigRegistry().getStatuses() });
  });

  router.get('/render-facts', (_req, res) => {
    const facts = deps.getProjectRenderFacts?.();
    if (!facts) {
      res.status(503).json({ error: 'render facts are not ready' });
      return;
    }
    res.json(facts);
  });

  router.get('/render-facts/projection', (_req, res) => {
    const projection = deps.getProjectRenderFactsProjection?.();
    if (!projection) {
      res.status(503).json({ error: 'render facts projection is not ready' });
      return;
    }
    res.json(projection);
  });

  router.get('/tiles/comparison', (_req, res) => {
    try {
      const layout = deps.getResolvedLayout?.();
      if (!layout) {
        res.status(503).json({ error: 'resolved current layout is not ready' });
        return;
      }
      const config = loadTileComparisonConfig();
      const comparison = buildTileCostComparison(layout, config, catalog);
      res.json({
        ...comparison,
        interpretation: {
          rawQuotedAmountsPreserved: true,
          userDerivedTotalsStatus: 'assumption_only_not_store_confirmed',
          jinyiBathroomLines: 'raw room and surface mappings remain unresolved; optional area-based hypotheses are low/medium confidence and are not promoted to confirmed quote data',
          fullDesignAndRenderingStatus: 'illustrative_comparison_only_not_final_selection',
        },
        quoteScopeDetails: config.candidates.map(candidate => ({
          candidateId: candidate.id,
          scope: candidate.quote_scope,
          additionalLines: candidate.additional_quote_lines,
          additionalOriginalTotalYuan: candidate.additional_quote_original_total_yuan,
          userDerivedAdditionalDiscountedTotalYuan: candidate.user_derived_additional_quote_discounted_total_yuan,
          userDerivedDiscountStatus: candidate.user_derived_discount_status,
          reportedFullMaterialTotalYuan: candidate.reported_full_material_total_yuan,
          alternativeReportedFullMaterialTotalYuan: candidate.alternative_reported_full_material_total_yuan,
        })),
      });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 涂漆成本核算（墙顶面涂装 PKG-080）。与 /tiles/comparison 平级：只读，无 POST/PUT。
  // 面积来源是 overlay.yaml 的 paint_region 声明（3D 涂漆检视态高亮的同一批声明），
  // 算不出就 503，绝不静默凑一个数。
  router.get('/paint/comparison', (_req, res) => {
    try {
      const layout = deps.getResolvedLayout?.();
      if (!layout) {
        res.status(503).json({ error: 'resolved current layout is not ready' });
        return;
      }
      const config = loadPaintComparisonConfig();
      const comparison = buildPaintCostComparison(layout, config, catalog);
      res.json({
        ...comparison,
        interpretation: {
          rawAreasPreserved: true,
          selectedScenarioId: null,
          scenariosStatus: '口径未拍板前并列展示，不选单一情景',
          scopeStatus: 'illustrative_comparison_only_not_final_quote',
          disclaimer: '不含基层修补、找平批刮腻子、颜色样板与成品保护（COST-080-01/02/04）；顶面未在 3D 涂漆检视态中显示',
        },
      });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/mep-coordination', (_req, res) => {
    try {
      const facts = deps.getProjectRenderFacts?.();
      if (!facts) {
        res.status(503).json({ error: 'render facts are not ready' });
        return;
      }
      const config = loadMepCoordinationConfig();
      const sources = endpointSourcesFromFacts(facts);
      validateMepCoordination(config, sources);
      res.json({ ...config, lint: lintMepCoordination(config, sources, deps.getMepLintContext?.()) });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/electrical-topology', (_req, res) => {
    try {
      const facts = deps.getProjectRenderFacts?.();
      const points = facts?.electrical ?? loadElectricalConfig();
      const topology = loadElectricalTopologyConfig();
      const lint = lintElectricalTopology(topology, points, {
        ...(deps.getMepLintContext?.()?.layout ? { layout: deps.getMepLintContext?.()?.layout } : {}),
        suppressedWallIds: (() => {
          const ids = deps.getMepLintContext?.()?.suppressedWallIds;
          return ids ? [...ids] : undefined;
        })(),
      });
      res.json({ ...topology, lint });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/annotations/electrical', (_req, res) => {
    const facts = deps.getProjectRenderFacts?.();
    if (facts) {
      res.json(facts.electrical);
      return;
    }
    try {
      res.json(loadElectricalConfig());
    } catch (err) {
      res.status(500).json({ error: 'failed to load electrical config' });
    }
  });

  router.get('/annotations/plumbing', (_req, res) => {
    const facts = deps.getProjectRenderFacts?.();
    if (facts) {
      res.json(facts.plumbing);
      return;
    }
    try {
      res.json(loadPlumbingConfig());
    } catch (err) {
      res.status(500).json({ error: 'failed to load plumbing config' });
    }
  });

  router.get('/annotations/ceiling', (_req, res) => {
    const facts = deps.getProjectRenderFacts?.();
    if (facts) {
      res.json(facts.ceiling);
      return;
    }
    try {
      res.json(loadCeilingConfig());
    } catch (err) {
      res.status(500).json({ error: 'failed to load ceiling config' });
    }
  });

  router.get('/ceiling/takeoff', (_req, res) => {
    try {
      const zones = deps.getProjectRenderFacts?.()?.ceiling ?? loadCeilingConfig();
      res.json(computeCeilingTakeoff(zones, deps.catalog.getRooms().map((room) => ({ id: room.id, height: room.height }))));
    } catch (err) {
      res.status(500).json({ error: 'failed to compute ceiling takeoff' });
    }
  });

  // ─── 吊顶报价卡片（DEC-2026-10-08-C03）───
  // GET：量取 takeoff、价取 ceiling-quotes.yaml，并排对比全部候选；
  // POST /active：切换生效卡片，只改写 active 一行（留 .bak、走 Git）。
  router.get('/ceiling/quotes', (_req, res) => {
    try {
      const zones = deps.getProjectRenderFacts?.()?.ceiling ?? loadCeilingConfig();
      const takeoff = computeCeilingTakeoff(zones, deps.catalog.getRooms().map((room) => ({ id: room.id, height: room.height })));
      const file = loadCeilingQuotes();
      const fallback = baseJsonCeilingRates();
      res.json({
        activeId: file.active,
        quantities: ceilingQuoteQuantities(takeoff),
        takeoff: {
          totalNetAreaM2: takeoff.totalNetAreaM2,
          curtainBoxM2: takeoff.curtainBoxM2,
          curtainBoxLinearM: takeoff.curtainBoxLinearM,
          overlaps: takeoff.overlaps,
        },
        resolved: resolveActiveCeilingRates(file, fallback),
        comparison: compareCeilingQuotes(file, takeoff, fallback),
      });
    } catch (err) {
      res.status(500).json({ error: `failed to load ceiling quotes: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  router.post('/ceiling/quotes/active', (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    if (!id) {
      res.status(400).json({ error: 'body.id is required' });
      return;
    }
    try {
      const file = setActiveCeilingQuote(id);
      const zones = deps.getProjectRenderFacts?.()?.ceiling ?? loadCeilingConfig();
      const takeoff = computeCeilingTakeoff(zones, deps.catalog.getRooms().map((room) => ({ id: room.id, height: room.height })));
      const fallback = baseJsonCeilingRates();
      res.json({
        switched: true,
        activeId: file.active,
        resolved: resolveActiveCeilingRates(file, fallback),
        comparison: compareCeilingQuotes(file, takeoff, fallback),
        note: '已改写 config/ceiling-quotes.yaml 的 active 一行（原文件留 .bak）；按 README「没有口头变更」，该改动需进 Git。',
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/layouts', (_req, res) => {
    res.json({ layouts: ProjectCatalog.getLayouts('.') });
  });

  router.get('/model-package-links', (_req, res) => {
    try {
      res.json(loadModelPackageLinks());
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/project', (req, res) => {
    const layoutName = req.query.layout as string | undefined;
    let phase;
    try {
      phase = parsePhaseId(req.query.phase);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const projectCatalog = layoutName
      ? ProjectCatalog.load('.', layoutName)
      : deps.catalog;
    const overlay = deps.getOverlay();
    const sceneElements = mergeSceneElements(projectCatalog.getWalls(), overlay);
    const modelLinks = loadModelPackageLinks();
    res.json({
      phase,
      phaseMeta: { ...phaseScopes[phase], budget: loadPhaseBudgetMeta(phaseScopes[phase]) },
      modelPackageLinks: phase === 'full'
        ? modelLinks.links
        : modelLinks.links.filter((link) => link.phase_id === phase),
      house: {
        rooms: projectCatalog.getRooms(),
        platform: projectCatalog.getPlatform(),
        furnishings: projectCatalog.getFurnishingsForPhase(phase),
        electrical: deps.getProjectRenderFacts?.()?.electrical ?? loadElectricalConfig(),
        ceilingZones: deps.getProjectRenderFacts?.()?.ceiling ?? loadCeilingConfig(),
        sceneElements: filterCurtainElements(sceneElements, phase, phaseScopes),
        layoutSource: projectCatalog.getLayoutSource(),
      },
      topics: projectCatalog.getTopics().map((t) => ({
        id: t.id, name: t.name, perRoom: t.perRoom, optionCount: t.options.length,
      })),
      budgetCategories: projectCatalog.getBudgetCategories(),
      environment: deps.getEnvironment?.() ?? null,
    });
  });

  router.get('/presentation-state', (_req, res) => {
    if (!deps.presentationState) {
      res.status(503).json({ error: 'presentation state is not configured' });
      return;
    }
    res.json(deps.presentationState.get());
  });

  router.patch('/presentation-state/curtains', (req, res) => {
    if (!deps.presentationState) {
      res.status(503).json({ error: 'presentation state is not configured' });
      return;
    }
    const { roomId, state: curtainState, expectedUpdatedAt } = req.body ?? {};
    if (roomId !== undefined && typeof roomId !== 'string') {
      res.status(400).json({ error: 'roomId must be a string' });
      return;
    }
    if (typeof curtainState !== 'string') {
      res.status(400).json({ error: 'state is required' });
      return;
    }
    try {
      const result = deps.presentationState.setCurtainState({
        roomId,
        state: curtainState as CurtainState,
        expectedUpdatedAt,
      });
      if (result.conflict) {
        res.status(409).json({ error: 'conflict', serverUpdatedAt: result.state.updatedAt, state: result.state });
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/scheme/current', (_req, res) => {
    res.json(state.getCurrentScheme());
  });

  router.patch('/scheme/current', (req, res) => {
    const { selections, reason, source, expectedUpdatedAt } = req.body ?? {};
    if (!Array.isArray(selections)) {
      res.status(400).json({ error: 'selections must be an array' });
      return;
    }
    try {
      const result = state.applySelections(selections, reason, source, expectedUpdatedAt);
      if (result.conflict) {
        res.status(409).json({ error: 'conflict', serverUpdatedAt: state.getCurrentScheme().updatedAt });
        return;
      }
      res.json({ updated: result.updated, entries: result.entries, scheme: state.getCurrentScheme() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/decisions', (_req, res) => {
    res.json(state.getDecisionLog());
  });

  router.post('/decisions', (req, res) => {
    try {
      const entry = state.recordDecision(req.body ?? {});
      res.status(201).json(entry);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/topics', (_req, res) => {
    res.json(
      catalog.getTopics().map((t) => ({
        id: t.id,
        name: t.name,
        perRoom: t.perRoom,
        options: t.options.map((o) => ({ id: o.id, name: o.name, price_per_unit: o.price_per_unit })),
      }))
    );
  });

  router.get('/topics/:id/options', (req, res) => {
    const topic = catalog.getTopic(req.params.id);
    if (!topic) {
      res.status(404).json({ error: 'topic not found' });
      return;
    }
    res.json(
      topic.options.map((o) => ({
        id: o.id,
        name: o.name,
        description: o.description,
        price_per_unit: o.price_per_unit,
        coverage_per_unit: o.coverage_per_unit,
        loss_rate: o.loss_rate,
      }))
    );
  });

  router.get('/topics/:id/options/:optionId', (req, res) => {
    const option = catalog.getOption(req.params.id, req.params.optionId);
    if (!option) {
      res.status(404).json({ error: 'option not found' });
      return;
    }
    res.json(option);
  });

  router.post('/view-context', (req, res) => {
    const { objectId } = req.body ?? {};
    if (typeof objectId !== 'string') {
      res.status(400).json({ error: 'objectId is required' });
      return;
    }
    res.json(state.setViewContext(objectId));
  });

  router.get('/view-context', (_req, res) => {
    res.json(state.getViewContext());
  });

  router.get('/visual-commands', (_req, res) => {
    res.json(state.getVisualCommands());
  });

  router.post('/visual-commands', (req, res) => {
    const { type, payload } = req.body ?? {};
    if (type !== 'set_camera_target' && type !== 'highlight_object' && type !== 'set_curtain_state') {
      res.status(400).json({ error: 'invalid visual command type' });
      return;
    }
    if (type === 'set_curtain_state') {
      if (!deps.presentationState) {
        res.status(503).json({ error: 'presentation state is not configured' });
        return;
      }
      const curtainPayload = payload as { roomId?: string; state?: CurtainState } | undefined;
      try {
        const result = deps.presentationState.setCurtainState({ roomId: curtainPayload?.roomId, state: curtainPayload?.state as CurtainState });
        const cmd = state.appendVisualCommand(type, { roomId: curtainPayload?.roomId, state: curtainPayload?.state });
        res.status(201).json({ ...cmd, presentationState: result.state });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    const cmd = state.appendVisualCommand(type, payload);
    res.status(201).json(cmd);
  });

  router.post('/visual-commands/ack', (req, res) => {
    const { ids } = req.body ?? {};
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      res.status(400).json({ error: 'ids must be an array of strings' });
      return;
    }
    state.ackVisualCommands(ids);
    res.json({ acked: ids.length });
  });

  router.get('/budget', (_req, res) => {
    let phase;
    try {
      phase = parsePhaseId(_req.query.phase);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const scheme = state.getCurrentScheme();
    const calc = getBudgetCalculator();
    const snapshot = calc.calculate(scheme, phase);
    const phaseBudget = loadPhaseBudgetMeta(phaseScopes[phase]);
    let tileBudgetPreview;
    try {
      const layout = deps.getResolvedLayout?.();
      if (layout) {
        const comparison = buildTileCostComparison(layout, loadTileComparisonConfig(), catalog);
        const displayNames = new Map(comparison.candidates.map(candidate => [candidate.id, candidate.productDescription]));
        tileBudgetPreview = {
          status: 'comparison_overlay_only' as const,
          includedInTotalActual: false as const,
          includedInCategoryTotals: false as const,
          scopeNote: 'Dry floor only; excludes bathroom, walls, balcony, and extras. Labor uses net laid area and is not included in the owner labor budget pool.',
          dryFloorMaterialAndOrdinaryLaborByCandidate: comparison.dryFloorMaterialAndOrdinaryLaborByCandidate.map(candidate => ({
            ...candidate,
            displayName: displayNames.get(candidate.candidateId) ?? candidate.candidateId,
          })),
        };
      }
    } catch {
      // The budget snapshot remains available when current layout or tile comparison inputs are unavailable.
    }
    let paintBudgetPreview;
    try {
      const layout = deps.getResolvedLayout?.();
      if (layout) {
        const paintConfig = loadPaintComparisonConfig();
        const paintComparison = buildPaintCostComparison(layout, paintConfig, catalog);
        paintBudgetPreview = {
          status: 'comparison_overlay_only' as const,
          includedInTotalActual: false as const,
          includedInCategoryTotals: false as const,
          scopeNote: 'Declared paint regions (walls) plus room footprint ceilings; openings not deducted by default. Material covers primer + topcoats, labor covers brushing only. Excludes base repair, skim coat, color sample and protection (COST-080-01/02/04).',
          ...paintComparison,
        };
      }
    } catch {
      // 同理：paint 对比输入不可用时，预算快照本身必须仍然可用。
    }
    res.json({
      ...snapshot,
      ...(tileBudgetPreview ? { tileBudgetPreview } : {}),
      ...(paintBudgetPreview ? { paintBudgetPreview } : {}),
      phase,
      ...(phaseBudget.ceilingCny !== undefined ? { phaseCeiling: phaseBudget.ceilingCny } : {}),
      ...(phaseBudget.allocatedCny !== undefined ? { phaseAllocated: phaseBudget.allocatedCny } : {}),
      ...(phaseBudget.unallocatedCny !== undefined ? { phaseUnallocated: phaseBudget.unallocatedCny } : {}),
      phaseMeta: { ...phaseScopes[phase], budget: phaseBudget },
    });
  });

  router.get('/risks', (_req, res) => {
    const scheme = state.getCurrentScheme();
    const engine = getRuleEngine();
    const result = engine.evaluate(scheme, catalog);
    res.json(result);
  });

  router.get('/design-check', (_req, res) => {
    const scheme = state.getCurrentScheme();
    const engine = getRuleEngine();
    const result = engine.evaluate(scheme, catalog);
    res.json(result);
  });

  router.get('/schemes', (_req, res) => {
    res.json(archiveStore.list());
  });

  router.post('/schemes', (req, res) => {
    const { name, reason } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const scheme = state.getCurrentScheme();
    const result = archiveStore.create(scheme, name, reason);
    if (result.error === 'name_conflict') {
      res.status(409).json({ error: 'archive name already exists' });
      return;
    }
    res.status(201).json(result.scheme);
  });

  router.get('/schemes/:id', (req, res) => {
    const archived = archiveStore.get(req.params.id);
    if (!archived) {
      res.status(404).json({ error: 'archived scheme not found' });
      return;
    }
    res.json(archived);
  });

  router.get('/schemes/:id/diff', (req, res) => {
    const current = state.getCurrentScheme();
    const diff = archiveStore.diff(req.params.id, current);
    if (!diff) {
      res.status(404).json({ error: 'archived scheme not found' });
      return;
    }
    res.json(diff);
  });

  router.get('/schemes/compare', (req, res) => {
    const archiveId = req.query.other as string;
    if (!archiveId) {
      res.status(400).json({ error: 'query param "other" (archiveId) required' });
      return;
    }
    const archived = archiveStore.get(archiveId);
    if (!archived) {
      res.status(404).json({ error: 'archived scheme not found' });
      return;
    }
    state.setCompareArchive(archiveId, { ...archived, updatedAt: archived.createdAt } as CurrentScheme);
    const current = state.getCurrentScheme();
    const currentBudget = getBudgetCalculator().calculate(current);
    const currentRisks = getRuleEngine().evaluate(current, catalog);
    const compareBudget = getBudgetCalculator().calculate({ ...archived, updatedAt: archived.createdAt } as CurrentScheme);
    const compareRisks = getRuleEngine().evaluate({ ...archived, updatedAt: archived.createdAt } as CurrentScheme, catalog);

    const allTopics = new Set([
      ...Object.keys(current.selections),
      ...Object.keys(archived.selections),
    ]);

    const topicCost = (snapshot: typeof currentBudget, topic: string): number =>
      snapshot.lineItems
        .filter((li) => li.topic === topic)
        .reduce((sum, li) => sum + li.cost, 0);

    const selectionDiffs: Array<{
      topic: string;
      current: string | null;
      compare: string | null;
      priceDelta: number;
    }> = [];

    for (const topic of allTopics) {
      const curOptId = current.selections[topic]?.default ?? null;
      const cmpOptId = archived.selections[topic]?.default ?? null;
      if (curOptId === cmpOptId) continue;
      const curOpt = curOptId ? catalog.getOption(topic, curOptId) : null;
      const cmpOpt = cmpOptId ? catalog.getOption(topic, cmpOptId) : null;
      selectionDiffs.push({
        topic,
        current: curOpt?.name ?? curOptId,
        compare: cmpOpt?.name ?? cmpOptId,
        priceDelta: topicCost(compareBudget, topic) - topicCost(currentBudget, topic),
      });
    }

    const currentRiskIds = new Set(currentRisks.risks.map((r) => r.id));
    const compareRiskIds = new Set(compareRisks.risks.map((r) => r.id));

    res.json({
      current: { scheme: current, budget: currentBudget, risks: currentRisks },
      compare: { scheme: archived, budget: compareBudget, risks: compareRisks },
      diff: {
        budget: compareBudget.totalActual - currentBudget.totalActual,
        selections: selectionDiffs,
        risks: {
          added: compareRisks.risks.filter((r) => !currentRiskIds.has(r.id)).map((r) => ({ id: r.id, severity: r.severity })),
          removed: currentRisks.risks.filter((r) => !compareRiskIds.has(r.id)).map((r) => ({ id: r.id, severity: r.severity })),
        },
      },
    });
  });

  router.post('/schemes/:id/restore', (req, res) => {
    const archived = archiveStore.get(req.params.id);
    if (!archived) {
      res.status(404).json({ error: 'archived scheme not found' });
      return;
    }

    const current = state.getCurrentScheme();
    const patches: Array<{ topic: string; optionId: string | null; roomId?: string | null; reason?: string }> = [];

    const allTopics = new Set([
      ...Object.keys(archived.selections),
      ...Object.keys(current.selections),
    ]);

    for (const topic of allTopics) {
      const archSel = archived.selections[topic] ?? { default: null, roomOverrides: {} };
      const curSel = current.selections[topic] ?? { default: null, roomOverrides: {} };

      if (archSel.default !== curSel.default) {
        patches.push({
          topic,
          optionId: archSel.default,
          reason: `restored from archive ${archived.id}`,
        });
      }

      const allRooms = new Set([
        ...Object.keys(archSel.roomOverrides),
        ...Object.keys(curSel.roomOverrides),
      ]);

      for (const roomId of allRooms) {
        const archOverride = archSel.roomOverrides[roomId] ?? null;
        const curOverride = curSel.roomOverrides[roomId] ?? null;
        if (archOverride !== curOverride) {
          patches.push({
            topic,
            optionId: archOverride,
            roomId,
            reason: `restored from archive ${archived.id}`,
          });
        }
      }
    }

    if (patches.length > 0) {
      const result = state.applySelections(patches, `restored from ${archived.id}`, 'restore');
      const log = state.getDecisionLog();
      for (const entry of result.entries) {
        entry.archiveId = archived.id;
      }
      state.persist();
    }

    res.json({
      restored: true,
      archiveId: archived.id,
      scheme: state.getCurrentScheme(),
    });
  });

  router.post('/schemes/compare/clear', (_req, res) => {
    state.clearCompare();
    res.json({ cleared: true });
  });

  router.delete('/schemes/:id', (req, res) => {
    const deleted = archiveStore.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'archived scheme not found' });
      return;
    }
    res.json({ deleted: true });
  });

  return router;
}
