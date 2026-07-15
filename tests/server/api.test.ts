import { describe, it, before, after } from 'node:test';
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
import { parseOverlay } from '../../server/overlay-merge.js';

const TEST_DATA_DIR = './tmp/test-data-api';

describe('REST API', () => {
  let app: express.Express;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    const calc = new BudgetCalculator(catalog, engine.getConfig());
    const archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);

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
        getOverlay: () => undefined,
      })
    );
  });

  after(() => {
  });

  it('GET /api/project returns rooms and platform separately', async () => {
    const res = await request(app).get('/api/project').expect(200);
    assert.ok(Array.isArray(res.body.topics));
    assert.ok(Array.isArray(res.body.house.rooms));
    assert.ok(res.body.house.rooms.some((r: { id: string }) => r.id === 'master_bedroom'));
    assert.ok(!res.body.house.rooms.some((r: { id: string }) => r.id === 'elevator'));
    // Platform may be absent when the DXF has no unlabeled-area extraction yet.
    if (res.body.house.platform) {
      assert.equal(res.body.house.platform?.id, 'elevator');
      assert.equal(res.body.house.platform?.name, '电梯井');
    }
    assert.ok(Array.isArray(res.body.house.sceneElements));
  });

  it('PATCH /api/scheme/current changes selection', async () => {
    const res = await request(app)
      .patch('/api/scheme/current')
      .send({ selections: [{ topic: 'hvac', optionId: 'A1' }], source: 'user' })
      .expect(200);
    assert.equal(res.body.scheme.selections.hvac.default, 'A1');
  });

  it('POST /api/decisions records a decision', async () => {
    const res = await request(app)
      .post('/api/decisions')
      .send({ topic: 'hvac', optionId: 'A1', reason: 'test' })
      .expect(201);
    assert.equal(res.body.topic, 'hvac');
  });

  it('GET /api/project returns sceneElements merged from walls and overlay', async () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    const calc = new BudgetCalculator(catalog, engine.getConfig());
    const archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);
    const overlay = parseOverlay(`version: 1
elements:
  - id: "curtain:1"
    type: curtain_run
    points:
      - {x: 0, z: 0}
      - {x: 5, z: 0}
`);
    const localApp = express();
    localApp.use(express.json());
    localApp.use(
      '/api',
      createApiRouter({
        catalog,
        state,
        getRuleEngine: () => engine,
        getBudgetCalculator: () => calc,
        archiveStore,
        getConfigRegistry: () => new ConfigRegistry(),
        getOverlay: () => overlay,
      })
    );
    const res = await request(localApp).get('/api/project').expect(200);
    const els = res.body.house.sceneElements;
    assert.ok(Array.isArray(els));
    assert.ok(els.every((e: { type: string }) => typeof e.type === 'string'));
    assert.ok(els.some((e: { id: string }) => e.id === 'curtain:1'));
    assert.equal(res.body.house.walls, undefined);
  });

  it('POST /api/visual-commands creates a command', async () => {
    const res = await request(app)
      .post('/api/visual-commands')
      .send({ type: 'set_camera_target', payload: { targetId: 'room:master_bedroom' } })
      .expect(201);
    assert.equal(res.body.type, 'set_camera_target');
  });
});
