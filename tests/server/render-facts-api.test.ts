import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { load as parseYaml } from 'js-yaml';
import { resolveLayout } from '../../server/layout-resolver.js';
import { parseOverlay } from '../../server/overlay-merge.js';
import { endpointSourcesFromFacts, MepCoordinationSchema, parseMepCoordination } from '../../shared/mep-hvac-coordination-schema.js';
import { lintMepCoordination, type MepLintLayoutContext } from '../../shared/mep-hvac-lint.js';
import type { VertexLayoutYaml } from '../../shared/types.js';
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
  getMepLintContext?: () => MepLintLayoutContext,
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
    getMepLintContext,
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

  it('injects layout and facts context into MEP lint consistently with shared CLI inputs', async () => {
    const mepConfig = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
    const testFacts: ProjectRenderFacts = {
      electrical: parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as ProjectRenderFacts['electrical'],
      plumbing: parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as ProjectRenderFacts['plumbing'],
      ceiling: parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as ProjectRenderFacts['ceiling'],
      hvac: parseYaml(readFileSync('config/hvac.yaml', 'utf8')) as ProjectRenderFacts['hvac'],
    };
    const overlay = parseOverlay('version: 1\nsuppress: []\nelements: []');
    const layout = resolveLayout(parseYaml(`version: '2.0'\nvertices:\n  - { id: a, x: 10, z: 0 }\n  - { id: b, x: 10, z: 10 }\nrooms: []\nwalls:\n  - { id: wall_test, from: a, to: b, kind: entity }` ) as VertexLayoutYaml);
    const context: MepLintLayoutContext = { layout, ceiling: testFacts.ceiling, suppressedWallIds: overlay.suppress.flatMap((item) => item.wall ? [item.wall] : item.walls ?? []), referenceConstraints: testFacts.hvac.plans[0].diagram.reference_constraints };
    const direct = lintMepCoordination(mepConfig, endpointSourcesFromFacts(testFacts), context);
    const app = createApp(() => testFacts, undefined, () => context);
    const response = await request(app).get('/api/mep-coordination').expect(200);
    assert.deepEqual(response.body.lint.counts, direct.counts);
    assert.ok(response.body.lint.warnings.some((item: { code: string }) => item.code === 'penetration_missing'));
    assert.ok(response.body.lint.warnings.some((item: { code: string }) => item.code === 'reference_constraint_uncertain'));
    assert.equal(response.body.lint.errors.length, direct.errors.length);
    assert.equal(response.body.lint.warnings.length, direct.warnings.length);
  });

  it('returns 503 until the aggregate loader has a valid snapshot', async () => {
    const app = createApp(() => undefined);
    const response = await request(app).get('/api/render-facts').expect(503);
    assert.equal(response.body.error, 'render facts are not ready');
    const projectionResponse = await request(app).get('/api/render-facts/projection').expect(503);
    assert.equal(projectionResponse.body.error, 'render facts projection is not ready');
  });

  it('returns 503 for MEP coordination until render facts are ready', async () => {
    const app = createApp(() => undefined);
    const response = await request(app).get('/api/mep-coordination').expect(503);
    assert.deepEqual(response.body, { error: 'render facts are not ready' });
  });

  it('keeps annotation endpoints as array responses without a facts getter', async () => {
    const app = createApp();
    const response = await request(app).get('/api/annotations/electrical').expect(200);
    assert.equal(Array.isArray(response.body), true);
  });

  it('returns electrical topology with lint independently of MEP route data', async () => {
    const app = createApp(() => facts);
    const response = await request(app).get('/api/electrical-topology').expect(200);
    assert.equal(response.body.circuits.length, 23);
    assert.equal(response.body.controls.length, 3);
    assert.equal(response.body.panels[0].id, 'panel_strong');
    assert.equal(response.body.panels[0].source_point_id, 'panel_strong_entry_left');
    assert.equal(response.body.lint.counts.errors, 59);
    assert.equal(response.body.lint.counts.warnings, 41);
    assert.equal(response.body.lint.counts.coveredPoints, 51);
    assert.equal(response.body.circuits.filter((circuit: { purpose: string }) => circuit.purpose === 'ordinary_power').length, 3);
    assert.equal(response.body.lint.warnings.some((item: { code: string }) => item.code === 'control_target_missing'), true);
    assert.equal(response.body.lint.warnings.some((item: { code: string }) => item.code === 'electrical_parameters_pending'), true);
  });
});
