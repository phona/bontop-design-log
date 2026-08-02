import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { createAnalysisRouter } from '../../server/analysis-routes.js';
import { parseOverlay } from '../../server/overlay-merge.js';
import { parseEnvironment } from '../../shared/environment-schema.js';

describe('GET /api/analysis/sunlight', () => {
  let app: express.Express;
  const env = parseEnvironment(readFileSync('config/environment.yaml', 'utf8'));
  const overlay = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));

  before(() => {
    const catalog = ProjectCatalog.load('.');
    app = express();
    app.use(
      '/api/analysis',
      createAnalysisRouter({ catalog, getEnvironment: () => env, getOverlay: () => overlay })
    );
  });

  it('默认冬至返回各房间日照数据与置信度', async () => {
    const res = await request(app).get('/api/analysis/sunlight');
    assert.equal(res.status, 200);
    assert.equal(res.body.date, '12-22');
    assert.equal(res.body.confidence, 'estimated');
    const living = res.body.rooms.find((r: { id: string }) => r.id === 'living_dining');
    assert.ok(living, 'living_dining present');
    assert.ok(living.directHours > 0, `living_dining hours ${living.directHours}`);
    assert.ok(Array.isArray(living.windows));
  });

  it('date 参数生效', async () => {
    const res = await request(app).get('/api/analysis/sunlight?date=06-22');
    assert.equal(res.status, 200);
    assert.equal(res.body.date, '06-22');
  });

  it('非法 date → 400', async () => {
    const res = await request(app).get('/api/analysis/sunlight?date=13-40');
    assert.equal(res.status, 400);
  });

  it('environment 未加载 → 503', async () => {
    const catalog = ProjectCatalog.load('.');
    const bare = express();
    bare.use(
      '/api/analysis',
      createAnalysisRouter({ catalog, getEnvironment: () => undefined, getOverlay: () => overlay })
    );
    const res = await request(bare).get('/api/analysis/sunlight');
    assert.equal(res.status, 503);
  });
});
