import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import { createApiRouter } from '../../server/routes.js';
import type { ProjectRenderFacts, ProjectRenderFactsProjection } from '../../shared/types.js';

const facts: ProjectRenderFacts = {
  electrical: [{ id: 'socket_1', room: 'living', type: 'socket', x: 1, z: 2 }],
  plumbing: [{ id: 'faucet_1', room: 'kitchen', type: 'faucet', x: 3, z: 4 }],
  ceiling: [{ id: 'ceiling_1', room: 'living', type: 'drop' }],
  hvac: { plans: [] },
};

const projection: ProjectRenderFactsProjection = {
  version: '2.0',
  lightingFixtures: [{ id: 'light_1', room: 'living', type: 'dome', position: { x: 1, y: 2.55, z: 2 }, temperatureK: 3000, enabled: true }],
  plumbing: facts.plumbing,
  ceiling: facts.ceiling,
  hvac: { status: 'unimplemented', planId: null },
  materials: { floor: { default: 'floor_1', roomOverrides: {} } },
  presentation: { curtains: { source: { default: 'open', roomOverrides: {}, updatedAt: '2026-08-25T00:00:00.000Z' }, effectiveByRoom: {}, curtains: [], snapshotSha256: '0'.repeat(64) } },
};

function createApp(
  getProjectRenderFacts?: () => ProjectRenderFacts | undefined,
  getProjectRenderFactsProjection?: () => ProjectRenderFactsProjection | undefined,
): express.Express {
  const catalog = ProjectCatalog.load('.');
  const state = new DesignState(catalog, './tmp/test-data-render-facts-api');
  const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
  const app = express();
  app.use('/api', createApiRouter({
    catalog,
    state,
    getRuleEngine: () => engine,
    getBudgetCalculator: () => new BudgetCalculator(catalog, engine.getConfig()),
    archiveStore: new ArchivedSchemesStore('./tmp/test-data-render-facts-api'),
    getConfigRegistry: () => new ConfigRegistry(),
    getOverlay: () => undefined,
    getProjectRenderFacts,
    getProjectRenderFactsProjection,
  }));
  return app;
}

describe('render facts API', () => {
  it('returns the aggregate facts and annotation slices from the injected snapshot', async () => {
    const app = createApp(() => facts);

    const all = await request(app).get('/api/render-facts').expect(200);
    assert.deepEqual(all.body, facts);
    assert.deepEqual((await request(app).get('/api/annotations/electrical').expect(200)).body, facts.electrical);
    assert.deepEqual((await request(app).get('/api/annotations/plumbing').expect(200)).body, facts.plumbing);
    assert.deepEqual((await request(app).get('/api/annotations/ceiling').expect(200)).body, facts.ceiling);
  });

  it('returns the render projection independently of construction facts', async () => {
    const app = createApp(() => facts, () => projection);
    assert.deepEqual((await request(app).get('/api/render-facts/projection').expect(200)).body, projection);
    assert.equal((await request(app).get('/api/render-facts/projection').expect(200)).body.lightingFixtures[0].position.y, 2.55);
  });

  it('returns 503 until the aggregate loader has a valid snapshot', async () => {
    const app = createApp(() => undefined);
    const response = await request(app).get('/api/render-facts').expect(503);
    assert.equal(response.body.error, 'render facts are not ready');
    const projectionResponse = await request(app).get('/api/render-facts/projection').expect(503);
    assert.equal(projectionResponse.body.error, 'render facts projection is not ready');
  });

  it('keeps annotation endpoints as array responses without a facts getter', async () => {
    const app = createApp();
    const response = await request(app).get('/api/annotations/electrical').expect(200);
    assert.equal(Array.isArray(response.body), true);
  });
});
