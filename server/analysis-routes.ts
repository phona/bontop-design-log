import { Router } from 'express';
import type { ProjectCatalog } from './project-catalog.js';
import type { OverlayConfig } from './overlay-merge.js';
import type { EnvironmentConfig } from '../shared/environment-schema.js';
import { computeSunlightAnalysis } from './analysis-service.js';

export interface AnalysisDeps {
  catalog: ProjectCatalog;
  getEnvironment: () => EnvironmentConfig | undefined;
  getOverlay: () => OverlayConfig | undefined;
}

function parseDateParam(value: string | undefined): { month: number; day: number } | null {
  const raw = value ?? '12-22';
  const m = /^(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

export function createAnalysisRouter(deps: AnalysisDeps): Router {
  const router = Router();

  router.get('/sunlight', (req, res) => {
    const env = deps.getEnvironment();
    if (!env) {
      res.status(503).json({ error: 'config/environment.yaml not loaded' });
      return;
    }
    const date = parseDateParam(req.query.date as string | undefined);
    if (!date) {
      res.status(400).json({ error: 'date must be MM-DD' });
      return;
    }
    res.json(computeSunlightAnalysis(deps.catalog, deps.getOverlay(), env, date));
  });

  return router;
}
