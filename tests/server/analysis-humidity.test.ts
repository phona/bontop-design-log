import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { createAnalysisRouter } from '../../server/analysis-routes.js';
import { parseOverlay } from '../../server/overlay-merge.js';
import { parseEnvironment } from '../../shared/environment-schema.js';

describe('GET /api/analysis/humidity', () => {
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

  it('回南天日期：huinanActive=true，master_bath 评分 30（medium）', async () => {
    const res = await request(app).get('/api/analysis/humidity?date=03-15');
    assert.equal(res.status, 200);
    assert.equal(res.body.confidence, 'estimated');
    assert.equal(res.body.huinanActive, true);
    const mbath = res.body.rooms.find((r: { id: string }) => r.id === 'master_bath');
    assert.equal(mbath.score, 30);
    assert.equal(mbath.tier, 'medium');
    assert.equal(mbath.declared, true);
    assert.ok(Array.isArray(mbath.factors));
  });

  it('entry_garden 回南天内得冷表面 +20（15-5+20=30），窗口外为 10', async () => {
    const inWin = await request(app).get('/api/analysis/humidity?date=03-15');
    const outWin = await request(app).get('/api/analysis/humidity?date=12-22');
    const eg = (body: { rooms: Array<{ id: string; score: number }> }) =>
      body.rooms.find((r) => r.id === 'entry_garden')!.score;
    assert.equal(eg(inWin.body), 30);
    assert.equal(eg(outWin.body), 10);
    assert.equal(outWin.body.huinanActive, false);
  });

  it('未声明房间 declared=false（master_bedroom 默认 10 分）', async () => {
    const res = await request(app).get('/api/analysis/humidity?date=12-22');
    const mb = res.body.rooms.find((r: { id: string }) => r.id === 'master_bedroom');
    assert.equal(mb.declared, false);
    assert.equal(mb.score, 10);
  });

  it('表面：entry_garden_slab 窗口内 45 / 窗口外 10（slab +15 仅回南天窗口内生效）', async () => {
    const inWin = await request(app).get('/api/analysis/humidity?date=03-15');
    const outWin = await request(app).get('/api/analysis/humidity?date=12-22');
    const slab = (body: { surfaces: Array<{ id: string; score: number }> }) =>
      body.surfaces.find((s) => s.id === 'entry_garden_slab')!.score;
    assert.equal(slab(inWin.body), 45);
    assert.equal(slab(outWin.body), 10);
  });

  it('缺省日期返回当前日期形状合法', async () => {
    const res = await request(app).get('/api/analysis/humidity');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.rooms));
    assert.ok(res.body.rooms.length > 0);
  });

  it('非法 date → 400', async () => {
    const res = await request(app).get('/api/analysis/humidity?date=13-40');
    assert.equal(res.status, 400);
  });

  it('environment 未加载 → 503', async () => {
    const catalog = ProjectCatalog.load('.');
    const bare = express();
    bare.use(
      '/api/analysis',
      createAnalysisRouter({ catalog, getEnvironment: () => undefined, getOverlay: () => overlay })
    );
    const res = await request(bare).get('/api/analysis/humidity?date=03-15');
    assert.equal(res.status, 503);
  });
});
