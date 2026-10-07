import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { Request, Response } from 'express';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { createApiRouter } from '../../server/routes.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { DesignRulesConfig, ResolvedLayout, VertexLayoutYaml } from '../../shared/types.js';

const TEST_DATA_DIR = './tmp/test-data-budget-api';

const rulesConfig: DesignRulesConfig = {
  version: '1.0',
  budget: {
    topicCategories: { floor: 'masonry', wall: 'masonry', paint: 'painting', hvac: 'hvac', robot_vacuum: 'appliances' },
    furnishingTypeToTopic: { robot_dock_gbath: 'robot_vacuum' },
    lineItems: [
      { topic: 'floor', quantityField: 'floorArea' },
      { topic: 'wall', quantityField: 'wetWallArea' },
      { topic: 'paint', quantityField: 'paintWallArea' },
      { topic: 'hvac' },
      { topic: 'robot_vacuum', calcMode: 'count' },
    ],
  },
  risks: [
    {
      id: 'platform_width',
      severity: 'medium',
      message: '{{hvac.name}} 外机摆放紧张',
      when: { topic: 'hvac', options: ['B1', 'B2', 'E1'] },
    },
  ],
  constraints: [],
};

describe('Budget + Risks + Schemes API', () => {
  let app: express.Express;
  let archiveStore: ArchivedSchemesStore;
  let catalog: ProjectCatalog;
  let state: DesignState;
  let calc: BudgetCalculator;
  let resolvedLayout: ResolvedLayout | undefined;
  let apiRouter: ReturnType<typeof createApiRouter>;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    catalog = ProjectCatalog.load('.');
    const geometry = load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml;
    resolvedLayout = resolveLayout(geometry);
    state = DesignState.load(catalog, TEST_DATA_DIR);
    const engine = new RuleEngine(rulesConfig);
    calc = new BudgetCalculator(catalog, rulesConfig);
    archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);

    app = express();
    app.use(express.json());
    apiRouter = createApiRouter({
        catalog,
        state,
        getRuleEngine: () => engine,
        getBudgetCalculator: () => calc,
        archiveStore,
        getConfigRegistry: () => new ConfigRegistry(),
        getOverlay: () => undefined,
        getResolvedLayout: () => resolvedLayout,
      });
    app.use('/api', apiRouter);
  });

  function invokeBudgetRoute(): { statusCode: number; body: Record<string, any> } {
    const stack = (apiRouter as unknown as {
      stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: Request, res: Response) => void }> } }>;
    }).stack;
    const route = stack.map(layer => layer.route).find(item => item?.path === '/budget');
    assert.ok(route, 'GET /budget route should be registered');
    let statusCode = 200;
    let body: Record<string, any> = {};
    const response = {
      status(code: number) { statusCode = code; return this; },
      json(value: Record<string, any>) { body = value; return this; },
    } as unknown as Response;
    route.stack[0].handle({ query: {} } as Request, response);
    return { statusCode, body };
  }

  it('GET /api/budget returns the tile budget preview as an overlay only', () => {
    const { statusCode, body } = invokeBudgetRoute();
    assert.equal(statusCode, 200);
    assert.ok(body.totalBudget > 0);
    assert.ok(Array.isArray(body.categories));
    assert.ok(Array.isArray(body.lineItems));
    assert.equal(body.tileBudgetPreview.status, 'comparison_overlay_only');
    assert.equal(body.tileBudgetPreview.includedInTotalActual, false);
    assert.equal(body.tileBudgetPreview.includedInCategoryTotals, false);
    assert.match(body.tileBudgetPreview.scopeNote, /excludes bathroom, walls, balcony, and extras/);
    assert.deepEqual(
      body.tileBudgetPreview.dryFloorMaterialAndOrdinaryLaborByCandidate.map((row: { candidateId: string; sameScopeSubtotalYuan: number }) => [row.candidateId, row.sameScopeSubtotalYuan]),
      [['kt_200x1200', 23005.8], ['jinyi_approx_900x150', 24320.8]],
    );
    assert.equal(body.totalActual, calc.calculate(state.getCurrentScheme()).totalActual);
    assert.deepEqual(body.categories.map((item: { key: string; actual: number }) => [item.key, item.actual]),
      calc.calculate(state.getCurrentScheme()).categories.map(item => [item.key, item.actual]));
  });

  it('GET /api/budget omits tile comparison overlay if resolved layout is unavailable', () => {
    const prior = resolvedLayout;
    try {
      resolvedLayout = undefined;
      const { statusCode, body } = invokeBudgetRoute();
      assert.equal(statusCode, 200);
      assert.equal('tileBudgetPreview' in body, false);
    } finally {
      resolvedLayout = prior;
    }
  });

  it('GET /api/budget phase=phase_1 returns phase metadata and filtered calculation', async () => {
    const res = await request(app).get('/api/budget?phase=phase_1_basic_occupancy').expect(200);
    assert.equal(res.body.phase, 'phase_1_basic_occupancy');
    assert.equal(res.body.phaseCeiling, 210000);
    assert.equal(res.body.phaseAllocated, 210000);
    assert.equal(res.body.phaseUnallocated, 0);
    assert.equal(res.body.phaseMeta.budget.ceilingCny, 210000);
    assert.equal(res.body.phaseMeta.budget.allocatedCny, 210000);
    assert.equal(res.body.phaseMeta.budget.unallocatedCny, 0);
    assert.equal(res.body.phaseMeta.budget.authority, 'schedule/phase-1/control.yaml');
    // 现行口径来自 control.yaml（DEC-2026-10-05-R4 抬池后 210,000）；作废的 190,000 / 208,000 只作 historicalBaseline 留档露出
    assert.equal(res.body.totalBudget, 210000);
    assert.equal(res.body.projectCeiling, 210000);
    assert.equal(res.body.historicalBaseline.projectCeilingCny, 190000);
    assert.equal(res.body.historicalBaseline.totalBudgetCny, 208000);
    assert.equal(res.body.historicalBaseline.status, 'historical_reference_only');
    const robot = res.body.lineItems.find((item: { topic: string }) => item.topic === 'robot_vacuum');
    assert.equal(robot?.optionId, 'robot_vacuum_narwal_j6_01');
    assert.equal(robot?.quantity, 1);
    assert.equal(robot?.cost, 3000);
  });

  it('GET /api/budget default keeps full-project baseline semantics', async () => {
    const res = await request(app).get('/api/budget').expect(200);
    assert.equal(res.body.phase, 'full');
    assert.equal(res.body.phaseCeiling, undefined);
    assert.equal(res.body.phaseAllocated, undefined);
    assert.equal(res.body.phaseUnallocated, undefined);
    assert.equal(res.body.totalBudget, 210000);
  });

  it('GET /api/risks returns risks', async () => {
    const res = await request(app).get('/api/risks').expect(200);
    assert.ok(Array.isArray(res.body.risks));
    assert.ok(Array.isArray(res.body.constraintViolations));
  });

  it('POST /api/schemes creates archive', async () => {
    const res = await request(app)
      .post('/api/schemes')
      .send({ name: '测试归档', reason: '测试' })
      .expect(201);
    assert.ok(res.body.id.startsWith('archived_'));
    assert.equal(res.body.name, '测试归档');
  });

  it('POST /api/schemes rejects duplicate name', async () => {
    await request(app)
      .post('/api/schemes')
      .send({ name: '重复方案' })
      .expect(201);
    await request(app)
      .post('/api/schemes')
      .send({ name: '重复方案' })
      .expect(409);
  });

  it('GET /api/schemes lists archives', async () => {
    const res = await request(app).get('/api/schemes').expect(200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);
  });

  it('GET /api/schemes/:id returns archive detail', async () => {
    const listRes = await request(app).get('/api/schemes').expect(200);
    const id = listRes.body[0].id;
    const res = await request(app).get(`/api/schemes/${id}`).expect(200);
    assert.equal(res.body.id, id);
    assert.ok(res.body.selections);
  });

  it('GET /api/schemes/:id/diff returns diff', async () => {
    const listRes = await request(app).get('/api/schemes').expect(200);
    const id = listRes.body[0].id;
    const res = await request(app).get(`/api/schemes/${id}/diff`).expect(200);
    assert.ok(Array.isArray(res.body));
  });

  it('POST /api/schemes/:id/restore restores scheme', async () => {
    await request(app)
      .patch('/api/scheme/current')
      .send({ selections: [{ topic: 'hvac', optionId: 'A1' }] })
      .expect(200);

    const listRes = await request(app).get('/api/schemes').expect(200);
    const id = listRes.body[0].id;
    const res = await request(app).post(`/api/schemes/${id}/restore`).expect(200);
    assert.equal(res.body.restored, true);
  });

  it('DELETE /api/schemes/:id deletes archive', async () => {
    const createRes = await request(app)
      .post('/api/schemes')
      .send({ name: '待删除' })
      .expect(201);
    const id = createRes.body.id;
    await request(app).delete(`/api/schemes/${id}`).expect(200);
    await request(app).get(`/api/schemes/${id}`).expect(404);
  });
});
