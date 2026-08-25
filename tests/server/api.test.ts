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
import { PresentationStateStore } from '../../server/presentation-state.js';

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
    const overlay = parseOverlay(`
version: 1
elements:
  - { id: living, type: curtain, points: [{x: 0, z: 0}, {x: 2, z: 0}], room: living_dining, kind: sheer_blackout }
  - { id: bath, type: curtain, points: [{x: 0, z: 1}, {x: 2, z: 1}], room: master_bath, kind: blinds }
`);
    const presentationState = new PresentationStateStore(TEST_DATA_DIR, () => overlay);

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
        presentationState,
        getConfigRegistry: () => new ConfigRegistry(),
        getOverlay: () => overlay,
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
    // Platform is now the VRV equipment platform (VRV设备平台) for 701.
    if (res.body.house.platform) {
      assert.equal(res.body.house.platform?.id, 'west_platform');
      assert.equal(res.body.house.platform?.name, 'VRV设备平台');
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

  it('GET/PATCH presentation state persists room and whole-house curtain states', async () => {
    const initial = await request(app).get('/api/presentation-state').expect(200);
    assert.equal(initial.body.default, 'open');

    const room = await request(app)
      .patch('/api/presentation-state/curtains')
      .send({ roomId: 'master_bath', state: 'blackout', expectedUpdatedAt: initial.body.updatedAt })
      .expect(200);
    assert.equal(room.body.state.roomOverrides.master_bath, 'privacy');

    const all = await request(app)
      .patch('/api/presentation-state/curtains')
      .send({ state: 'blackout', expectedUpdatedAt: room.body.state.updatedAt })
      .expect(200);
    assert.equal(all.body.state.default, 'blackout');
    assert.deepEqual(all.body.state.roomOverrides, {});
  });

  it('rejects invalid curtain room/state and reports conflicts', async () => {
    await request(app).patch('/api/presentation-state/curtains').send({ roomId: 'kitchen', state: 'open' }).expect(400);
    await request(app).patch('/api/presentation-state/curtains').send({ state: 'invalid' }).expect(400);
    await request(app).patch('/api/presentation-state/curtains').send({ state: 'open', expectedUpdatedAt: 'stale' }).expect(409);
  });

  it('POST set_curtain_state persists before appending the command', async () => {
    const res = await request(app)
      .post('/api/visual-commands')
      .send({ type: 'set_curtain_state', payload: { roomId: 'living_dining', state: 'privacy' } })
      .expect(201);
    assert.equal(res.body.type, 'set_curtain_state');
    assert.equal(res.body.presentationState.roomOverrides.living_dining, 'privacy');
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
