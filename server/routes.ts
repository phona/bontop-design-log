import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { ProjectCatalog } from './project-catalog.js';
import type { DesignState } from './design-state.js';
import type { RuleEngine } from './rule-engine.js';
import type { BudgetCalculator } from './budget-calculator.js';
import { loadMasonryTakeoff } from './budget-calculator.js';
import type { ArchivedSchemesStore } from './archived-schemes.js';
import type { ConfigRegistry } from './config-loader.js';
import { loadElectricalConfig, loadElectricalTopologyConfig, loadPlumbingConfig, loadCeilingConfig, loadMepCoordinationConfig } from './config-loader.js';
import { endpointSourcesFromFacts, validateMepCoordination } from '../shared/mep-hvac-coordination-schema.js';
import { buildPlacementIndexes } from '../shared/placement-indexes.js';
import { collectPlacementHostClosureViolations, PLACEMENT_CLOSURE_GUIDANCE, PROJECTION_CONSTRUCTION_GUIDANCE } from './placement-closure.js';
import type { PlacementClosureApiDiagnostics } from '../shared/api-project.js';
import { lintElectricalTopology } from '../shared/electrical-lint.js';
import { lintMepCoordination, type MepLintLayoutContext } from '../shared/mep-hvac-lint.js';
import { deriveMepPenetrationAt } from '../shared/condensate-chain.js';
import { parseProjectHvacFacts } from '../shared/project-render-facts-schema.js';
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
import { buildScheduleSnapshot, loadScheduleState } from '../shared/schedule-state.js';
import {
  AcceptanceError, acceptBranchName, assertPackageCheckExists, finalizeEvidence, loadDraft, runPreSubmitGates, saveDraft, stageEvidence, submitAcceptance,
} from './acceptance-draft-store.js';
import { projectAuditRecords, renderPrBody } from '../shared/acceptance-draft.js';
import {
  loadCeilingQuotes,
  setActiveCeilingQuote,
  resolveActiveCeilingRates,
  compareCeilingQuotes,
  ceilingQuoteQuantities,
  baseJsonCeilingRates,
  type CeilingQuoteRateKey,
} from './ceiling-quotes.js';
import {
  loadCeilingMaterialCost,
  computeCeilingMaterialCost,
} from './ceiling-material-cost.js';
import type { ElementStatePayload } from './element-state-service.js';

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
  /** 主卫冷凝链穿墙锚点（issue #98 PR-10；第五阶段 S3 改派生）：MEP condensate-master
   * @w_mbath_south。S3 起该 at 已删（可派生 45 条之一），锚点由路线几何派生——与
   * lint/takeoff 同一算法（deriveMepPenetrationPoint）、同一端点解算源；派生失败 → 无锚，
   * 下游链条显形（fail-closed）。 */
  const condensateMasterPenetration = (): { x: number; z: number } | undefined => deriveMepPenetrationAt(
    loadMepCoordinationConfig().routes.find((route) => route.id === 'condensate-master'),
    'w_mbath_south',
    {
      sources: endpointSourcesFromFacts({
        electrical: loadElectricalConfig(),
        plumbing: loadPlumbingConfig(),
        ceiling: loadCeilingConfig(),
        hvac: parseProjectHvacFacts(readFileSync('config/hvac.yaml', 'utf8')),
      }),
      walls: deps.catalog.getWalls(),
    },
  ).point;

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
      const comparison = buildTileCostComparison(
        layout,
        config,
        deps.catalog,
        loadMasonryTakeoff(deps.catalog),
        deps.state.getCurrentScheme(),
      );
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
      // 点位定位索引（issue #98 S1/S2）走 shared/placement-indexes.ts 单一产地（疗法②）：
      // 墙取 catalog 墙几何，宿主取 catalog 的**全量** furnishings（不按阶段过滤）。
      // 浏览器 MEP 路线与 DXF/3D 共用同一解算、同一张宿主表。
      const placementIndexes = buildPlacementIndexes({
        geometry: { walls: deps.catalog.getWalls() },
        furnishings: deps.catalog.getFurnishings(),
      });
      const sources = endpointSourcesFromFacts(facts, placementIndexes.pointWalls, placementIndexes.mountHosts);
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

  // 自装交互审批第一步：schedule 只读快照——进度图/门禁图/next-action 三视图的
  // 唯一数据源（与 npm run verify:schedule 同一个 loader、同一份判定）。
  // 只读、无 POST：验收状态 / audit_log / 门禁拍板的写路径一律走 PR（铁律），
  // 浏览器不持有写仓库的令牌。控制源本身校验不过时 503 并列出问题——UI 不得
  // 渲染一份来自坏配置的快照（与「机械卡点不过不让提交」同向）。
  router.get('/schedule/state', (_req, res) => {
    try {
      const state = loadScheduleState('.', {modelPackageLinks: loadModelPackageLinks()});
      if (state.errors.length) {
        res.status(503).json({error: `schedule control invalid: ${state.errors.length} issue(s)`, issues: state.errors});
        return;
      }
      res.json(buildScheduleSnapshot(state));
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── 自装审批第二步：验收 PR 草稿（写路径的唯一入口） ───
  // 浏览器永不直接写仓库：草稿在 tmp/，证据落定后随「分支+commit+PR」进 master，
  // 合并由业主亲手点。机械卡点与 verify:schedule 同一判定（server/acceptance-draft-store.ts）。
  router.get('/acceptance/draft', (req, res) => {
    try {
      const packageId = String(req.query.package_id ?? '');
      if (!packageId) { res.status(400).json({error: 'package_id is required'}); return; }
      res.json(loadDraft(packageId));
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : String(err)});
    }
  });

  router.put('/acceptance/draft', (req, res) => {
    try {
      if (!isRecord(req.body) || typeof req.body.package_id !== 'string' || !Array.isArray(req.body.results)) {
        res.status(400).json({error: 'request body must be {package_id, results}'});
        return;
      }
      const validation = saveDraft({package_id: req.body.package_id, results: req.body.results});
      res.status(validation.ok ? 200 : 422).json(validation);
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : String(err)});
    }
  });

  router.post('/acceptance/evidence', (req, res) => {
    try {
      const {package_id, check_id, filename, data_base64} = req.body ?? {};
      if (typeof package_id !== 'string' || typeof check_id !== 'string' || typeof filename !== 'string' || typeof data_base64 !== 'string') {
        res.status(400).json({error: 'request body must be {package_id, check_id, filename, data_base64}'});
        return;
      }
      // 包/检查必须真实存在（P0-1）：package_id/check_id 直接拼进暂存目录路径，
      // 含 `../` 即越界写暂存区外。store 内部还会再校验一次（纵深防御）。
      assertPackageCheckExists(package_id, check_id);
      res.status(201).json(stageEvidence(package_id, check_id, filename, data_base64));
    } catch (err) {
      if (err instanceof AcceptanceError) { res.status(400).json({error: err.message}); return; }
      res.status(500).json({error: err instanceof Error ? err.message : String(err)});
    }
  });

  router.post('/acceptance/evidence/finalize', (req, res) => {
    try {
      const {package_id, check_id, staging_path} = req.body ?? {};
      if (typeof package_id !== 'string' || typeof check_id !== 'string' || typeof staging_path !== 'string') {
        res.status(400).json({error: 'request body must be {package_id, check_id, staging_path}'});
        return;
      }
      // 同 evidence：先校验包/检查存在，再进 store（内部同样再校验）
      assertPackageCheckExists(package_id, check_id);
      res.status(201).json(finalizeEvidence(package_id, check_id, staging_path));
    } catch (err) {
      if (err instanceof AcceptanceError) { res.status(400).json({error: err.message}); return; }
      res.status(500).json({error: err instanceof Error ? err.message : String(err)});
    }
  });

  router.post('/acceptance/gates', (req, res) => {
    try {
      const packageId = String(req.body?.package_id ?? '');
      if (!packageId) { res.status(400).json({error: 'package_id is required'}); return; }
      res.json(runPreSubmitGates(packageId));
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : String(err)});
    }
  });

  router.post('/acceptance/submit', (req, res) => {
    try {
      const packageId = String(req.body?.package_id ?? '');
      const dryRun = req.body?.dry_run === true;
      if (!packageId) { res.status(400).json({error: 'package_id is required'}); return; }
      if (dryRun) {
        // 预演：只跑卡点并算出将写入的记录与 PR 正文，不碰 git
        const gates = runPreSubmitGates(packageId);
        if (!gates.ok) { res.status(422).json({error: '机械卡点未通过', gates: gates.gates}); return; }
        const state = loadScheduleState('.', {modelPackageLinks: loadModelPackageLinks()});
        const snapshot = buildScheduleSnapshot(state);
        const pkg = snapshot.packages.find((item) => item.id === packageId)!;
        // checkSpecHash/packageProjectFingerprint 要 control.yaml 原始包对象——
        // 传 snapshot 投影视图会算出与校验器不同的指纹，提交即 stale（冒烟实测）
        const rawPkg = (state.control.work_packages ?? []).find((item: {id: string}) => item.id === packageId)!;
        const draft = loadDraft(packageId);
        const existingCounts = new Map<string, number>();
        for (const record of state.control.audit_log?.records ?? []) {
          const key = `${record.package_id}:${record.check_id}`;
          existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
        }
        const records = projectAuditRecords(draft, snapshot, {
          checkSpecSha256: (checkId) => state.checkSpecHash(rawPkg, checkId),
          projectDataSha256: state.packageProjectFingerprint(rawPkg),
        }, existingCounts);
        res.json({dry_run: true, records, pr_body: renderPrBody(draft, pkg, acceptBranchName(packageId, new Date()))});
        return;
      }
      res.status(201).json(submitAcceptance(packageId));
    } catch (err) {
      if (err instanceof AcceptanceError) {
        res.status(err.status ?? (err.message.includes('已中止并回滚') ? 409 : 422)).json({error: err.message, detail: err.detail});
        return;
      }
      res.status(500).json({error: err instanceof Error ? err.message : String(err)});
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
    // 本次下发的点位清单（与 house.electrical / house.plumbing 同一来源，先取出来供闭合性断言用）。
    const electricalPoints = deps.getProjectRenderFacts?.()?.electrical ?? loadElectricalConfig();
    const plumbingPoints = deps.getProjectRenderFacts?.()?.plumbing ?? loadPlumbingConfig();
    // 定位宿主表（issue #98 疗法①）：**全量** furnishings，不按阶段过滤——一期排除某个柜
    // 不影响它当定位宿主，排除的是「画不画」，不是「在不在」。
    // 断言消费的正是下发给前端的那份产物（疗法② + PR #122 深审 medium 修复）：furnishingsAll
    // 只取一次，闭合性检查与 house.furnishingsAll 字段共用**同一个值**——不存在「服务端
    // 内部宿主表」与「下发宿主表」两张表，宿主表漂移时断言与响应必然同时变。
    const furnishingsAll = projectCatalog.getFurnishings();
    const { mountHosts } = buildPlacementIndexes({
      geometry: { walls: projectCatalog.getWalls() },
      furnishings: furnishingsAll,
    });
    // 交付闭合性检查（PR #122 §一.1）：任何被交付点位声明的物理宿主必须存在于定位宿主表。
    // **宽容读取**（issue #98，PR #122 深审 high 修复）：/api/project 是页面预览入口，不是
    // 正式交付——闭合性失败不再 503 掐死页面，而是收集诊断随 200 响应下发（哪些点位缺哪个
    // 宿主、可能原因、统一处理方向），页面显形问题并继续预览其余部分（下方
    // placementClosureDiagnostics 字段）。
    // **严格输出不受影响**：DXF 导出（npm run export:dxf 与页面「导出 DXF」，经
    // shared/dxf/project-dxf.ts 的 errors 通道）与模型验证脚本（verify-rules / verify-spatial
    // 的 placement error）遇到同样的断引用必须失败——不许为了修页面把严格输出一起放松。
    const placementClosureViolations = collectPlacementHostClosureViolations(electricalPoints, plumbingPoints, mountHosts);
    // render-facts 投影构造隔离（issue #98「宽容读取、局部降级、统一诊断、严格输出」；
    // PR #122 深审 Codex blocking）。
    // 病根：投影是「数据源一次给全」的**优化**，不是正确性前提。它的构造链
    // `buildProjectRenderFactsProjection` → `buildRenderLightingFixtures` 遇点位宿主断引用
    // 会 fail-closed 抛错；原实现把调用**内联在响应对象字面量里**，一抛就是整个处理器抛 →
    // /api/project 500 → 同一响应里的 placementClosureDiagnostics 一个字都发不出去，
    // 页面既看不到问题也预览不了其余交付内容。
    // 现在：隔离成一次调用 + try/catch。失败 → 本次不下发投影，错误并入**同一条诊断通道**
    // （下方 placementClosureDiagnostics），响应仍 200，页面继续预览（只是少 HVAC 源）。
    // **严格输出零改动**：同一断引用在 DXF 导出（npm run export:dxf，实测 exit 1）与模型
    // 验证脚本里仍必须失败——投影不可得 ≠ 放行，问题不会藏。
    // 另修同源缺陷：原实现 `deps.getProjectRenderFactsProjection?.()` 在条件与取值里**各调
    // 一次**，一个请求重建两遍投影；第二遍若抛错同样 500。这里只调一次，取到的就是下发的。
    let renderFactsProjection: ProjectRenderFactsProjection | undefined;
    let projectionFailure: string | undefined;
    try {
      renderFactsProjection = deps.getProjectRenderFactsProjection?.();
    } catch (err) {
      projectionFailure = err instanceof Error ? err.message : String(err);
      console.error('[api/project] render-facts 投影构造失败：已降级为诊断（页面继续预览，正式 DXF/验证仍会失败）：', err);
    }
    // 统一诊断通道：点位闭合违例与投影构造失败共用 placementClosureDiagnostics 一个键、
    // 一份 count、一组处理方向；**键缺省** = 本次响应两项都正常（页面据此区分正常/降级）。
    const diagnosticMessages = [
      ...(projectionFailure !== undefined ? [`render-facts 投影构造失败：${projectionFailure}`] : []),
      ...placementClosureViolations.map((v) => v.message),
    ];
    const renderDiagnostics: PlacementClosureApiDiagnostics | undefined = diagnosticMessages.length > 0
      ? {
          count: diagnosticMessages.length,
          violations: diagnosticMessages,
          guidance: [
            ...(projectionFailure !== undefined ? [PROJECTION_CONSTRUCTION_GUIDANCE] : []),
            ...(placementClosureViolations.length > 0 ? [PLACEMENT_CLOSURE_GUIDANCE] : []),
          ].join(''),
          ...(projectionFailure !== undefined
            ? { projectionError: { stage: 'render-facts-projection' as const, message: projectionFailure } }
            : {}),
        }
      : undefined;
    res.json({
      phase,
      phaseMeta: { ...phaseScopes[phase], budget: loadPhaseBudgetMeta(phaseScopes[phase]) },
      modelPackageLinks: phase === 'full'
        ? modelLinks.links
        : modelLinks.links.filter((link) => link.phase_id === phase),
      house: {
        rooms: projectCatalog.getRooms(),
        platform: projectCatalog.getPlatform(),
        // 阶段可见家具（几何渲染用）。**定位宿主不用它**——见 furnishingsAll。
        furnishings: projectCatalog.getFurnishingsForPhase(phase),
        // 2026-11-09 结构修复（Codex 第 9 轮 blocking + 前 3 轮同主题补丁的根因）：
        // 定位宿主数据**不按阶段过滤**。一期范围排除 wall_cabinet_tall，但电气清单仍含
        // 挂载到 ld.wall_cabinet_tall 的 night_corridor（x/z 已删）——若宿主也按阶段过滤，
        // mountHosts 缺该宿主 → 解算失败 → 标注回落原点、回路显示缺成员。
        // **阶段可见性与定位宿主是两个关注点**，前者过滤，后者必须全量。
        // 闭合性检查消费的就是这份（上方 furnishingsAll 变量，同一值非两次调用）：
        // 断言消费的正是下发给前端的那份产物，不存在第二张宿主表。
        furnishingsAll,
        electrical: electricalPoints,
        // 给排水点位全量清单（2026-11-04 issue #65）：点位来源 select.all（PKG-040 的
        // plumbing {all: true}）要在前端展开成「该分类全部点位」，清单必须在 /api/project
        // 里——sceneElements 不含点位，前端没有第二条路拿到 plumbing 全量。与 electrical 同源
        // （config/plumbing.yaml，经 getProjectRenderFacts 投影时同口径）。
        plumbing: plumbingPoints,
        ceilingZones: deps.getProjectRenderFacts?.()?.ceiling ?? loadCeilingConfig(),
        sceneElements: filterCurtainElements(sceneElements, phase, phaseScopes),
        layoutSource: projectCatalog.getLayoutSource(),
        // 主卫冷凝链的 MEP 侧锚点（2026-11-07 issue #98 PR-10）：三件遮蔽家具的摆位改锚点
        // 派生（house.yaml anchor 声明），穿墙段从 MEP condensate-master 穿墙点解出。
        // /api/mep-coordination 也返回同一份路线，但页面在建场之后才拉它；建场要用的这个
        // 点随 /api/project 先到，避免链条家具因拉取顺序从场景里消失（同源：MEP 配置）。
        condensatePenetration: condensateMasterPenetration(),
      },
      // render-facts 投影随项目数据一次下发：HouseScene.buildFromCatalog 要靠它构造 HVAC 源
      // （SceneBuilder 解 indoor_master 锚点 → 三件冷凝链家具）。原 /api/project 不返回它、
      // 全仓无赋值，导致四个建场入口各补一次 fetch——补丁打了三轮仍有漏（布局切换）。
      // 数据源一次给全，入口自然不会再漏。
      // 层级（2026-11-09 修 PR #122 §2.5-①）：ProjectData 把 renderFactsProjection 声明在
      // **顶层**（app/src/render/HouseScene.ts:157，与 house 平级，748/750/761/789/792 全部读
      // projectData.renderFactsProjection），此前却下发在 house 内 → 顶层恒 undefined →
      // HVAC 源空 → 三件冷凝链家具静默缺失，而 house.renderFactsProjection 全仓无读取者。
      // 声明在哪就从哪下发：与 topics / materialPreview / budgetCategories 平级。
      // 构造已隔离（上方 try/catch）：抛错时本键不下发、错误进 placementClosureDiagnostics，
      // 整个响应仍 200。此处只放**已成功构造的那一份**（同一值，不二次调用）。
      ...(renderFactsProjection ? { renderFactsProjection } : {}),
      // 宽容读取诊断（issue #98，PR #122 深审修复）：点位闭合性失败与投影构造失败同走这一条
      // 通道，随 **200** 响应下发（不再 500/503），页面显形「哪个点位缺哪个宿主 / 投影为何
      // 构造失败、可能原因」并继续预览其余部分；键缺省 = 本次响应无降级。
      // 处理方向与断言同一条（统一诊断）：修配置，而非放宽断言或降级解算。
      ...(renderDiagnostics ? { placementClosureDiagnostics: renderDiagnostics } : {}),
      topics: projectCatalog.getTopics().map((t) => ({
        id: t.id, name: t.name, perRoom: t.perRoom, optionCount: t.options.length,
      })),
      materialPreview: {
        materials: projectCatalog.getAllMaterials()
          .filter((item) => item.topic_id === 'floor' || item.topic_id === 'paint')
          .map((item) => ({ id: item.id, topic_id: item.topic_id, appearance: item.appearance })),
        atlases: projectCatalog.getMaterialPreviewAssets(),
      },
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
        const comparison = buildTileCostComparison(
          layout,
          loadTileComparisonConfig(),
          deps.catalog,
          loadMasonryTakeoff(deps.catalog),
          scheme,
        );
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
