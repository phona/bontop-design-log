import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { mkdirSync, rmSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { createApiRouter } from '../../server/routes.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import type { DesignRulesConfig } from '../../shared/types.js';

const TEST_DATA_DIR = './tmp/test-data-budget-api';

const rulesConfig: DesignRulesConfig = {
  version: '1.0',
  budget: {
    topicCategories: { floor: 'masonry', wall: 'masonry', paint: 'painting', hvac: 'hvac' },
    lineItems: [
      { topic: 'floor', quantityField: 'floorArea' },
      { topic: 'wall', quantityField: 'wetWallArea' },
      { topic: 'paint', quantityField: 'paintWallArea' },
      { topic: 'hvac' },
    ],
  },
  risks: [
    {
      id: 'platform_width',
      severity: 'warning',
      message: '{{hvac.name}} 外机摆放紧张',
      when: { topic: 'hvac', options: ['B1', 'B2', 'E1'] },
    },
  ],
  constraints: [],
};

describe('Budget + Risks + Schemes API', () => {
  let app: express.Express;
  let archiveStore: ArchivedSchemesStore;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const engine = new RuleEngine(rulesConfig);
    const calc = new BudgetCalculator(catalog, rulesConfig);
    archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);

    app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter({
        catalog,
        state,
        getRuleEngine: () => engine,
        getBudgetCalculator: () => calc,
        archiveStore,
        getConfigRegistry: () => new ConfigRegistry(),
      })
    );
  });

  it('GET /api/budget returns budget snapshot', async () => {
    const res = await request(app).get('/api/budget').expect(200);
    assert.ok(res.body.totalBudget > 0);
    assert.ok(Array.isArray(res.body.categories));
    assert.ok(Array.isArray(res.body.lineItems));
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
