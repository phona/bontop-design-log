import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { createApiRouter } from '../../server/routes.js';

const TEST_DATA_DIR = './tmp/test-data-api';

describe('REST API', () => {
  let app: express.Express;

  before(() => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(catalog, state));
  });

  after(() => {
  });

  it('GET /api/project returns topics', async () => {
    const res = await request(app).get('/api/project').expect(200);
    assert.ok(Array.isArray(res.body.topics));
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

  it('POST /api/visual-commands creates a command', async () => {
    const res = await request(app)
      .post('/api/visual-commands')
      .send({ type: 'set_camera_target', payload: { targetId: 'room:master_bedroom' } })
      .expect(201);
    assert.equal(res.body.type, 'set_camera_target');
  });
});
