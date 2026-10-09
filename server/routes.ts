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
  type CeilingQuoteRateKey,
} from './ceiling-quotes.js';
import {
  loadCeilingMaterialCost,
  computeCeilingMaterialCost,
} from './ceiling-material-cost.js';
import type { ElementStatePayload } from './element-state-service.js';

/**
 * base.json 的兜底吊顶费率：生效报价未声明的计价行回落到它。
 * C12 新增的两行（边吊按米 / 满吊平顶按㎡）在 base.json 里没有对应 labor 行，
 * 回落值就是 null（待报价）——不编金额，只在报价面板显形。
 */
function baseJsonCeilingRates(): Record<CeilingQuoteRateKey, { per_unit: number | null; unit: string }> {
  const raw = JSON.parse(readFileSync('config/budget/base.json', 'utf8')) as {
    categories: Record<string, { labor?: { rate: number | null; unit: string; area: string } | Array<{ rate: number | null; unit: string; area: string }> }>;
  };
  const carpentry = raw.categories.carpentry;
  const entries = carpentry?.labor ? (Array.isArray(carpentry.labor) ? carpentry.labor : [carpentry.labor]) : [];
  const byArea = new Map(entries.map((entry) => [entry.area, entry]));
  return {
    ceiling_zones: { per_unit: byArea.get('ceiling_zones')?.rate ?? null, unit: byArea.get('ceiling_zones')?.unit ?? '元/㎡' },
    curtain_box_linear: { per_unit: byArea.get('curtain_box_linear')?.rate ?? null, unit: byArea.get('curtain_box_linear')?.unit ?? '元/m' },
    gypsum_edge_drop_linear: { per_unit: null, unit: '元/m' },
    gypsum_flat_sqm: { per_unit: null, unit: '元/㎡' },
    aluminum_buckle_sqm: { per_unit: null, unit: '元/㎡' },
  };
}
import type { ResolvedLayout } from '../shared/types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** query 布尔参数：只认 1/true/0/false/空串，其余显形报错——不让 `conflicts=yes` 静默变成 false。 */
function parseFlagParam(value: unknown, name: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'string') throw new Error(`${name} must be a single flag value`);
  if (value === '' || value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  throw new Error(`${name} must be one of 1, true, 0, false`);
}

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
  /** 构件级工程状态投影（现算/缓存，输入异常时抛错由路由转 503）。 */
  getElementState?: (options: { withConflicts?: boolean; refresh?: boolean }) => ElementStatePayload | undefined;
  getMepLintContext?: () => MepLintLayoutContext;
  getResolvedLayout?: () => ResolvedLayout | undefined;
}

export function createApiRouter(deps: ApiDeps): Router {
  const { state, getRuleEngine, getBudgetCalculator, archiveStore } = deps;
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

  // ─── 构件级工程状态投影（`npm run state:project` 的 HTTP 出口）───
  // 浏览器里的 3D 读不了文件系统，把这同一份派生搬到端点上：每个构件确认到什么程度、
  // 卡在谁（pending 台账）、和谁冲突（verifier issue）。
  //   conflicts=1  附 verifier 结论（跑三个 verifier 约 3 秒，结果在服务内缓存，不每请求都跑）
  //   refresh=1    忽略缓存强制重算（与 conflicts=1 搭配）
  // 输入读不到/解析失败 → 503，绝不返回空 states 假装没有状态。
  router.get('/element-state', (req, res) => {
    let withConflicts: boolean;
    let refresh: boolean;
    try {
      withConflicts = parseFlagParam(req.query.conflicts, 'conflicts');
      refresh = parseFlagParam(req.query.refresh, 'refresh');
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    try {
      const payload = deps.getElementState?.({ withConflicts, refresh });
      if (!payload) {
        res.status(503).json({ error: 'element state is not ready' });
        return;
      }
      res.json(payload);
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/tiles/comparison', (_req, res) => {
    try {
      const layout = deps.getResolvedLayout?.();
      if (!layout) {
        res.status(503).json({ error: 'resolved current layout is not ready' });
        return;
      }
      const config = loadTileComparisonConfig();
      const comparison = buildTileCostComparison(layout, config, deps.catalog);
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
      const comparison = buildPaintCostComparison(layout, config, deps.catalog);
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
        furnishings: deps.catalog.getFurnishings(),
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
          // C12：石膏板分形态计价的量与覆盖不变量（边吊长边 + 满吊面积 ≠ 面积，别拿两种单位相加）
          gypsumNetAreaM2: takeoff.gypsumBoardM2,
          edgeDropLinearM: takeoff.edgeDropLinearM,
          edgeDropNetAreaM2: takeoff.edgeDropNetAreaM2,
          flatNetAreaM2: takeoff.flatNetAreaM2,
          unclassifiedPricingFormIds: takeoff.unclassifiedPricingFormIds,
        },
        resolved: resolveActiveCeilingRates(file, fallback),
        comparison: compareCeilingQuotes(file, takeoff, fallback),
      });
    } catch (err) {
      res.status(500).json({ error: `failed to load ceiling quotes: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // ─── 吊顶主材参考成本区间（DEC-2026-10-08-C09）───
  // GET：把 config/ceiling-material-cost.yaml 的区间与施工方「包工包料 − 纯人工」的材料额度
  // 摆到同一把尺子上，只出三态判定（不低于/区间内/不高于），不出「贵/便宜」的市场判断。
  // 只读，无 POST：区间是参考证据，不是可切换的报价。
  router.get('/ceiling/material-cost', (_req, res) => {
    try {
      const zones = deps.getProjectRenderFacts?.()?.ceiling ?? loadCeilingConfig();
      const takeoff = computeCeilingTakeoff(zones, deps.catalog.getRooms().map((room) => ({ id: room.id, height: room.height })));
      const config = loadCeilingMaterialCost();
      res.json(computeCeilingMaterialCost(config, takeoff));
    } catch (err) {
      res.status(500).json({ error: `failed to compute ceiling material cost: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  router.post('/ceiling/quotes/active', (req, res) => {
    if (!isRecord(req.body)) {
      res.status(400).json({ error: 'request body must be an object' });
      return;
    }
    const id = req.body.id;
    if (typeof id !== 'string' || id.trim() === '') {
      res.status(400).json({ error: 'body.id must be a non-empty string' });
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
    const rawLayoutName = req.query.layout;
    if (rawLayoutName !== undefined && (typeof rawLayoutName !== 'string' || rawLayoutName.trim() === '')) {
      res.status(400).json({ error: 'layout must be a single layout name' });
      return;
    }
    const layoutName = rawLayoutName as string | undefined;
    let phase;
    try {
      phase = parsePhaseId(req.query.phase);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    let projectCatalog: ProjectCatalog;
    try {
      projectCatalog = layoutName
        ? ProjectCatalog.load('.', layoutName)
        : deps.catalog;
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
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
    if (!isRecord(req.body)) {
      res.status(400).json({ error: 'request body must be an object' });
      return;
    }
    const { roomId, state: curtainState, expectedUpdatedAt } = req.body;
    if (roomId !== undefined && typeof roomId !== 'string') {
      res.status(400).json({ error: 'roomId must be a string' });
      return;
    }
    if ((typeof roomId === 'string' && roomId.trim() === '') || (typeof expectedUpdatedAt !== 'undefined' && (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt.trim() === ''))) {
      res.status(400).json({ error: 'roomId must be non-empty and expectedUpdatedAt must be a string' });
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
    if (!isRecord(req.body)) {
      res.status(400).json({ error: 'request body must be an object' });
      return;
    }
    const { selections, reason, source, expectedUpdatedAt } = req.body;
    if (!Array.isArray(selections)) {
      res.status(400).json({ error: 'selections must be an array' });
      return;
    }
    if (reason !== undefined && typeof reason !== 'string') {
      res.status(400).json({ error: 'reason must be a string' });
      return;
    }
    if (source !== undefined && typeof source !== 'string') {
      res.status(400).json({ error: 'source must be a string' });
      return;
    }
    if (expectedUpdatedAt !== undefined && (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt.trim() === '')) {
      res.status(400).json({ error: 'expectedUpdatedAt must be a string' });
      return;
    }
    for (const [index, patch] of selections.entries()) {
      if (!isRecord(patch)) {
        res.status(400).json({ error: `selections[${index}] must be an object` });
        return;
      }
      if (typeof patch.topic !== 'string' || patch.topic.trim() === '') {
        res.status(400).json({ error: `selections[${index}].topic must be a non-empty string` });
        return;
      }
      if (patch.optionId !== null && typeof patch.optionId !== 'string') {
        res.status(400).json({ error: `selections[${index}].optionId must be a string or null` });
        return;
      }
      if (patch.roomId !== undefined && patch.roomId !== null && typeof patch.roomId !== 'string') {
        res.status(400).json({ error: `selections[${index}].roomId must be a string or null` });
        return;
      }
      if (patch.reason !== undefined && typeof patch.reason !== 'string') {
        res.status(400).json({ error: `selections[${index}].reason must be a string` });
        return;
      }
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
    if (!isRecord(req.body)) {
      res.status(400).json({ error: 'request body must be an object' });
      return;
    }
    for (const field of ['topic', 'reason', 'source'] as const) {
      if (req.body[field] !== undefined && typeof req.body[field] !== 'string') {
        res.status(400).json({ error: `${field} must be a string` });
        return;
      }
    }
    for (const field of ['roomId', 'optionId'] as const) {
      if (req.body[field] !== undefined && req.body[field] !== null && typeof req.body[field] !== 'string') {
        res.status(400).json({ error: `${field} must be a string or null` });
        return;
      }
    }
    try {
      const entry = state.recordDecision(req.body ?? {});
      res.status(201).json(entry);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/topics', (_req, res) => {
    res.json(
      deps.catalog.getTopics().map((t) => ({
        id: t.id,
        name: t.name,
        perRoom: t.perRoom,
        options: t.options.map((o) => ({ id: o.id, name: o.name, price_per_unit: o.price_per_unit })),
      }))
    );
  });

  router.get('/topics/:id/options', (req, res) => {
    const topic = deps.catalog.getTopic(req.params.id);
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
    const option = deps.catalog.getOption(req.params.id, req.params.optionId);
    if (!option) {
      res.status(404).json({ error: 'option not found' });
      return;
    }
    res.json(option);
  });

  router.post('/view-context', (req, res) => {
    if (!isRecord(req.body) || typeof req.body.objectId !== 'string' || req.body.objectId.trim() === '') {
      res.status(400).json({ error: 'objectId must be a non-empty string' });
      return;
    }
    res.json(state.setViewContext(req.body.objectId));
  });

  router.get('/view-context', (_req, res) => {
    res.json(state.getViewContext());
  });

  router.get('/visual-commands', (_req, res) => {
    res.json(state.getVisualCommands());
  });

  router.post('/visual-commands', (req, res) => {
    if (!isRecord(req.body)) {
      res.status(400).json({ error: 'request body must be an object' });
      return;
    }
    const { type, payload } = req.body;
    if (type !== 'set_camera_target' && type !== 'highlight_object' && type !== 'set_curtain_state') {
      res.status(400).json({ error: 'invalid visual command type' });
      return;
    }
    if (type === 'set_curtain_state') {
      if (!deps.presentationState) {
        res.status(503).json({ error: 'presentation state is not configured' });
        return;
      }
      if (!isRecord(payload)) {
        res.status(400).json({ error: 'payload must be an object for set_curtain_state' });
        return;
      }
      if (payload.roomId !== undefined && (typeof payload.roomId !== 'string' || payload.roomId.trim() === '')) {
        res.status(400).json({ error: 'payload.roomId must be a string' });
        return;
      }
      if (typeof payload.state !== 'string') {
        res.status(400).json({ error: 'payload.state must be a string' });
        return;
      }
      const curtainPayload = payload as { roomId?: string; state: CurtainState };
      try {
        const result = deps.presentationState.setCurtainState({ roomId: curtainPayload?.roomId, state: curtainPayload?.state as CurtainState });
        const cmd = state.appendVisualCommand(type, { roomId: curtainPayload?.roomId, state: curtainPayload?.state });
        res.status(201).json({ ...cmd, presentationState: result.state });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (!isRecord(payload)) {
      res.status(400).json({ error: 'payload must be an object' });
      return;
    }
    const targetField = type === 'set_camera_target' ? 'targetId' : 'objectId';
    if (typeof payload[targetField] !== 'string' || payload[targetField].trim() === '') {
      res.status(400).json({ error: `payload.${targetField} must be a non-empty string` });
      return;
    }
    const cmd = state.appendVisualCommand(type, payload);
    res.status(201).json(cmd);
  });

  router.post('/visual-commands/ack', (req, res) => {
    if (!isRecord(req.body)) {
      res.status(400).json({ error: 'request body must be an object' });
      return;
    }
    const { ids } = req.body;
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
        const comparison = buildTileCostComparison(layout, loadTileComparisonConfig(), deps.catalog);
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
        const paintComparison = buildPaintCostComparison(layout, paintConfig, deps.catalog);
        paintBudgetPreview = {
          status: 'comparison_overlay_only' as const,
          includedInTotalActual: false as const,
          includedInCategoryTotals: false as const,
          scopeNote: 'Declared wall paint plus explicit ceiling regions and declared exposed bay faces. Aluminium-buckle ceiling projections are excluded. Wet-area bay finish is shown as pending and excluded from ordinary paint prices until system and site conditions are quoted.',
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
    const result = engine.evaluate(scheme, deps.catalog);
    res.json(result);
  });

  router.get('/design-check', (_req, res) => {
    const scheme = state.getCurrentScheme();
    const engine = getRuleEngine();
    const result = engine.evaluate(scheme, deps.catalog);
    res.json(result);
  });

  router.get('/schemes', (_req, res) => {
    res.json(archiveStore.list());
  });

  router.post('/schemes', (req, res) => {
    if (!isRecord(req.body)) {
      res.status(400).json({ error: 'request body must be an object' });
      return;
    }
    const { name, reason } = req.body;
    if (typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'name must be a non-empty string' });
      return;
    }
    if (reason !== undefined && typeof reason !== 'string') {
      res.status(400).json({ error: 'reason must be a string' });
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
    const archiveId = req.query.other;
    if (typeof archiveId !== 'string' || archiveId.trim() === '') {
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
    const currentRisks = getRuleEngine().evaluate(current, deps.catalog);
    const compareBudget = getBudgetCalculator().calculate({ ...archived, updatedAt: archived.createdAt } as CurrentScheme);
    const compareRisks = getRuleEngine().evaluate({ ...archived, updatedAt: archived.createdAt } as CurrentScheme, deps.catalog);

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
      const curOpt = curOptId ? deps.catalog.getOption(topic, curOptId) : null;
      const cmpOpt = cmpOptId ? deps.catalog.getOption(topic, cmpOptId) : null;
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
