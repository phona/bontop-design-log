// 验收写路径路由的回归测试（自装审批第二步，2026-11-02）。
// 守：草稿 422 校验接线、证据暂存/落定的路径安全（staging_path 不许越界）、
// 机械卡点与 dry-run 预演的真实验证；全部走真实 deps 的 express 实例。

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { createApiRouter } from '../../server/routes.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import { parseOverlay } from '../../server/overlay-merge.js';
import { PresentationStateStore } from '../../server/presentation-state.js';

const TEST_DATA_DIR = './tmp/test-data-acceptance';
const STAGING = 'tmp/capture/acceptance-staging';
const DRAFT_DIR = 'tmp/capture/acceptance-draft';
const EVIDENCE = 'schedule/phase-1/evidence';

describe('验收写路径 API', () => {
  let app: express.Express;

  before(() => {
    rmSync(TEST_DATA_DIR, {recursive: true, force: true});
    // 草稿是 tmp/ 持久化的，跨运行会残留——先清再测，否则上一轮的合法草稿
    // 会让「空草稿 422」用例读到已存结果而放行
    rmSync(DRAFT_DIR, {recursive: true, force: true});
    mkdirSync(TEST_DATA_DIR, {recursive: true});
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const engine = new RuleEngine({version: '1.0', risks: [], constraints: []});
    const calc = new BudgetCalculator(catalog, engine.getConfig());
    const archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);
    const overlay = parseOverlay('version: 1\nelements: []\n');
    app = express();
    app.use(express.json({limit: '25mb'}));
    app.use('/api', createApiRouter({
      catalog,
      state,
      getRuleEngine: () => engine,
      getBudgetCalculator: () => calc,
      archiveStore,
      presentationState: new PresentationStateStore(TEST_DATA_DIR, () => overlay),
      getConfigRegistry: () => new ConfigRegistry(),
      getOverlay: () => overlay,
    }));
  });

  after(() => {
    rmSync(TEST_DATA_DIR, {recursive: true, force: true});
    rmSync(STAGING, {recursive: true, force: true});
    rmSync(DRAFT_DIR, {recursive: true, force: true});
    rmSync(EVIDENCE, {recursive: true, force: true});
  });

  it('PUT /api/acceptance/draft：合法草稿 200，门禁阻塞的 passed 422', async () => {
    const ok = await request(app).put('/api/acceptance/draft').send({
      package_id: 'PKG-060',
      results: [{check_id: 'check_tile_gap', status: 'passed', checked_by: '业主', checked_at: '2026-11-02', evidence: []}],
    });
    // 无证据的 passed 必须被拦（服务端一票否决）
    assert.equal(ok.status, 422);
    assert.equal(ok.body.ok, false);
    assert.ok(ok.body.issues.some((issue: {message: string}) => /passed 必须附最终证据/.test(issue.message)));

    const gated = await request(app).put('/api/acceptance/draft').send({
      package_id: 'PKG-060',
      results: [{check_id: 'check_tile_hollow', status: 'passed', checked_by: '业主', checked_at: '2026-11-02', evidence: ['schedule/phase-1/evidence/PKG-060/check_tile_hollow/a.jpg']}],
    });
    assert.equal(gated.status, 422);
    assert.ok(gated.body.issues.some((issue: {field?: string}) => issue.field === 'open_gates'), 'D11 阻塞的检查不得 passed');
  });

  it('证据暂存→落定：文件名安全、staging_path 越界被拒、final_path 落仓内', async () => {
    const staged = await request(app).post('/api/acceptance/evidence').send({
      package_id: 'PKG-060', check_id: 'check_tile_gap', filename: 'a.jpg', data_base64: Buffer.from('fake-image-bytes').toString('base64'),
    });
    assert.equal(staged.status, 201);
    assert.equal(staged.body.sha256.length, 64);
    assert.ok(existsSync(join('.', staged.body.staging_path)));

    const badName = await request(app).post('/api/acceptance/evidence').send({
      package_id: 'PKG-060', check_id: 'check_tile_gap', filename: '../escape.jpg', data_base64: Buffer.from('x').toString('base64'),
    });
    assert.equal(badName.status, 400, '文件名含路径穿越必须拒');

    const finalized = await request(app).post('/api/acceptance/evidence/finalize').send({
      package_id: 'PKG-060', check_id: 'check_tile_gap', staging_path: staged.body.staging_path,
    });
    assert.equal(finalized.status, 201);
    assert.equal(finalized.body.final_path, 'schedule/phase-1/evidence/PKG-060/check_tile_gap/a.jpg');
    assert.ok(existsSync(join('.', finalized.body.final_path)), '最终证据必须落进仓内路径');

    const escape = await request(app).post('/api/acceptance/evidence/finalize').send({
      package_id: 'PKG-060', check_id: 'check_tile_gap', staging_path: 'config/house.yaml',
    });
    assert.equal(escape.status, 400, 'staging_path 越界必须拒');
  });

  it('POST /api/acceptance/submit dry_run：空草稿 422 并回填 gates', async () => {
    // before() 已清空草稿目录：空草稿不过草稿校验 → 422 + gates 回填
    const res = await request(app).post('/api/acceptance/submit').send({package_id: 'PKG-060', dry_run: true});
    assert.equal(res.status, 422);
    assert.ok(Array.isArray(res.body.gates));
    assert.ok(res.body.gates.some((gate: {name: string}) => /草稿校验/.test(gate.name)));
  });

  it('POST /api/acceptance/gates：返回四道卡点', async () => {
    const res = await request(app).post('/api/acceptance/gates').send({package_id: 'PKG-060'});
    assert.equal(res.status, 200);
    const names = res.body.gates.map((gate: {name: string}) => gate.name);
    assert.ok(names.some((name: string) => /控制源校验/.test(name)));
    assert.ok(names.some((name: string) => /verify:schedule/.test(name)));
  });

  it('合法草稿 dry_run：records 带双指纹、pr_body 四要素', async () => {
    // 先落一份合法草稿（check_tile_gap 无门禁，证据已在上一条落定）
    const saved = await request(app).put('/api/acceptance/draft').send({
      package_id: 'PKG-060',
      results: [{check_id: 'check_tile_gap', status: 'passed', checked_by: '业主', checked_at: '2026-11-02', evidence: ['schedule/phase-1/evidence/PKG-060/check_tile_gap/a.jpg']}],
    });
    assert.equal(saved.status, 200);
    const res = await request(app).post('/api/acceptance/submit').send({package_id: 'PKG-060', dry_run: true});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.records.length, 1);
    assert.equal(res.body.records[0].check_spec_sha256.length, 64);
    assert.equal(res.body.records[0].project_data_sha256.length, 64);
    assert.match(res.body.pr_body, /本次改动的检查/);
    assert.match(res.body.pr_body, /GATE-060-COMPLETE/);
    // dry_run 不许碰 git：没有创建任何 accept/ 分支
    const branches = await request(app).get('/api/schedule/state');
    assert.equal(branches.status, 200);
  });
});
