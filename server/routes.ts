import { Router, type Request, type Response } from 'express';
import { ProjectCatalog } from './project-catalog.js';
import type { DesignState } from './design-state.js';
import type { RuleEngine } from './rule-engine.js';
import type { BudgetCalculator } from './budget-calculator.js';
import type { ArchivedSchemesStore } from './archived-schemes.js';
import type { ConfigRegistry } from './config-loader.js';
import { mergeSceneElements } from './overlay-merge.js';
import type { OverlayConfig } from './overlay-merge.js';
import type { CurrentScheme } from '../shared/types.js';

export interface ApiDeps {
  catalog: ProjectCatalog;
  state: DesignState;
  getRuleEngine: () => RuleEngine;
  getBudgetCalculator: () => BudgetCalculator;
  archiveStore: ArchivedSchemesStore;
  getConfigRegistry: () => ConfigRegistry;
  getOverlay: () => OverlayConfig | undefined;
}

export function createApiRouter(deps: ApiDeps): Router {
  const { catalog, state, getRuleEngine, getBudgetCalculator, archiveStore } = deps;
  const router = Router();

  router.get('/config-status', (_req, res) => {
    res.json({ configs: deps.getConfigRegistry().getStatuses() });
  });

  router.get('/layouts', (_req, res) => {
    res.json({ layouts: ProjectCatalog.getLayouts('.') });
  });

  router.get('/project', (req, res) => {
    const layoutName = req.query.layout as string | undefined;
    const projectCatalog = layoutName
      ? ProjectCatalog.load('.', layoutName)
      : deps.catalog;
    res.json({
      house: {
        rooms: projectCatalog.getRooms(),
        platform: projectCatalog.getPlatform(),
        furnishings: projectCatalog.getFurnishings(),
        electrical: projectCatalog.getElectricalMarkers(),
        sceneElements: mergeSceneElements(projectCatalog.getWalls(), deps.getOverlay()),
        layoutSource: projectCatalog.getLayoutSource(),
      },
      topics: projectCatalog.getTopics().map((t) => ({
        id: t.id, name: t.name, perRoom: t.perRoom, optionCount: t.options.length,
      })),
      budgetCategories: projectCatalog.getBudgetCategories(),
    });
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
    if (type !== 'set_camera_target' && type !== 'highlight_object') {
      res.status(400).json({ error: 'invalid visual command type' });
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
    const scheme = state.getCurrentScheme();
    const calc = getBudgetCalculator();
    const snapshot = calc.calculate(scheme);
    res.json(snapshot);
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
        priceDelta: (cmpOpt?.price_per_unit ?? 0) - (curOpt?.price_per_unit ?? 0),
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
