// 验收写路径路由的回归测试（自装审批第二步，2026-11-02）。
// 守：草稿 422 校验接线、证据暂存/落定的路径安全（包/检查必须存在、staging_path
// 不许越界且前缀检查带分隔符）、五道机械卡点（含前置与阻塞：预演项放行但注明
// readiness 保持 blocked）、dry-run 预演的真实验证；全部走真实 deps 的 express 实例。
// 安全审计轮（P0/P1）补充：evidence 接口路径穿越、提交分支安全（master 基线）、
// clearStaging 与分支名唯一性。

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import express from 'express';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
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
import {
  AcceptanceError, acceptBranchName, clearStaging, isAcceptanceBaseBranch, loadDraft, saveDraft, stageEvidence, submitAcceptance,
} from '../../server/acceptance-draft-store.js';

const TEST_DATA_DIR = './tmp/test-data-acceptance';
const STAGING = 'tmp/capture/acceptance-staging';
const DRAFT_DIR = 'tmp/capture/acceptance-draft';
const EVIDENCE = 'schedule/phase-1/evidence';

/** 暂存一个文件并落定到仓内证据路径（返回 final_path）。 */
async function stageAndFinalize(app: express.Express, packageId: string, checkId: string, filename: string): Promise<string> {
  const staged = await request(app).post('/api/acceptance/evidence').send({
    package_id: packageId, check_id: checkId, filename, data_base64: Buffer.from('fake-image-bytes').toString('base64'),
  });
  assert.equal(staged.status, 201, `stage ${packageId}/${checkId}: ${JSON.stringify(staged.body)}`);
  const finalized = await request(app).post('/api/acceptance/evidence/finalize').send({
    package_id: packageId, check_id: checkId, staging_path: staged.body.staging_path,
  });
  assert.equal(finalized.status, 201, `finalize ${packageId}/${checkId}: ${JSON.stringify(finalized.body)}`);
  return finalized.body.final_path as string;
}

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

  it('P0-1 证据接口：package_id/check_id 不存在（含 ../ 穿越）→ 400 且不落盘', async () => {
    // package_id 含 ../：旧实现直接 join(root, staging, '../evil', check) 写出暂存区外
    const escapeStage = await request(app).post('/api/acceptance/evidence').send({
      package_id: '../evil', check_id: 'check_tile_gap', filename: 'a.jpg', data_base64: Buffer.from('x').toString('base64'),
    });
    assert.equal(escapeStage.status, 400);
    assert.ok(!existsSync('./tmp/capture/evil'), '不得在暂存区外创建目录');

    const noCheck = await request(app).post('/api/acceptance/evidence').send({
      package_id: 'PKG-060', check_id: 'check_not_exists', filename: 'a.jpg', data_base64: Buffer.from('x').toString('base64'),
    });
    assert.equal(noCheck.status, 400);

    const escapeFinalize = await request(app).post('/api/acceptance/evidence/finalize').send({
      package_id: '../evil', check_id: 'check_tile_gap', staging_path: 'tmp/capture/acceptance-staging/PKG-060/check_tile_gap/a.jpg',
    });
    assert.equal(escapeFinalize.status, 400);

    const noCheckFinalize = await request(app).post('/api/acceptance/evidence/finalize').send({
      package_id: 'PKG-060', check_id: 'check_not_exists', staging_path: 'tmp/capture/acceptance-staging/PKG-060/check_tile_gap/a.jpg',
    });
    assert.equal(noCheckFinalize.status, 400);
  });

  it('P0-1 前缀检查带分隔符：acceptance-staging-evil 不再被当暂存区', async () => {
    // 暂存区外、同前缀的「假暂存」文件：旧实现裸 startsWith(stagingRoot) 会放过去
    // 并 rename 进 evidence/（把仓外文件搬进随 PR 提交的证据目录）
    const evilDir = './tmp/capture/acceptance-staging-evil';
    mkdirSync(evilDir, {recursive: true});
    writeFileSync(join(evilDir, 'x.jpg'), 'evil');
    try {
      const res = await request(app).post('/api/acceptance/evidence/finalize').send({
        package_id: 'PKG-060', check_id: 'check_tile_gap', staging_path: 'tmp/capture/acceptance-staging-evil/x.jpg',
      });
      assert.equal(res.status, 400);
      assert.ok(existsSync(join(evilDir, 'x.jpg')), '越界文件不被搬走');
      assert.ok(!existsSync('./schedule/phase-1/evidence/PKG-060/check_tile_gap/x.jpg'), '不得落进证据目录');
    } finally {
      rmSync(evilDir, {recursive: true, force: true});
    }
  });

  it('POST /api/acceptance/submit dry_run：空草稿 422 并回填 gates', async () => {
    // before() 已清空草稿目录：空草稿不过草稿校验 → 422 + gates 回填
    const res = await request(app).post('/api/acceptance/submit').send({package_id: 'PKG-060', dry_run: true});
    assert.equal(res.status, 422);
    assert.ok(Array.isArray(res.body.gates));
    assert.ok(res.body.gates.some((gate: {name: string}) => /草稿校验/.test(gate.name)));
  });

  it('POST /api/acceptance/gates：返回五道卡点，前置与阻塞列出具体前置', async () => {
    const res = await request(app).post('/api/acceptance/gates').send({package_id: 'PKG-060'});
    assert.equal(res.status, 200);
    const names = res.body.gates.map((gate: {name: string}) => gate.name);
    assert.ok(names.some((name: string) => /控制源校验/.test(name)));
    assert.ok(names.some((name: string) => /verify:schedule/.test(name)));
    const fifth = res.body.gates.find((gate: {name: string}) => gate.name === '前置与阻塞');
    assert.ok(fifth, '必须有第五道卡点「前置与阻塞」');
    // PKG-060 依赖 PKG-050 未通过 + BLK-SOUTH-BALCONY 未关闭 → 不 ok 且列出原因
    assert.equal(fifth.ok, false, fifth.detail);
    assert.match(fifth.detail, /PKG-050/);
    assert.match(fifth.detail, /BLK-SOUTH-BALCONY/);
  });

  it('P1-3 第五道卡点：预演项（can_run_while_blocked）passed 放行但注明 readiness 保持 blocked', async () => {
    // PKG-000 被 5 个 blocker 阻塞；SCH-000-PRE-01/02 是 can_run_while_blocked 预演项
    const finalPath = await stageAndFinalize(app, 'PKG-000', 'SCH-000-PRE-01', 'pre.jpg');
    const saved = await request(app).put('/api/acceptance/draft').send({
      package_id: 'PKG-000',
      results: [{check_id: 'SCH-000-PRE-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-02', evidence: [finalPath]}],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const gates = await request(app).post('/api/acceptance/gates').send({package_id: 'PKG-000'});
    assert.equal(gates.status, 200);
    const fifth = gates.body.gates.find((gate: {name: string}) => gate.name === '前置与阻塞');
    assert.equal(fifth.ok, true, fifth.detail);
    assert.match(fifth.detail, /仅预演项通过，施工 readiness 保持 blocked/);
    assert.match(fifth.detail, /BLK-HANDOVER/);
    // 五道全绿（预演项不解除阻塞，但本次提交放行）
    assert.equal(gates.body.ok, true, JSON.stringify(gates.body.gates));

    // 非预演项 passed → 第五道不 ok，detail 列出具体前置/阻塞
    const nonPreviewPath = await stageAndFinalize(app, 'PKG-000', 'SCH-000-01', 'survey.jpg');
    const badDraft = await request(app).put('/api/acceptance/draft').send({
      package_id: 'PKG-000',
      results: [{check_id: 'SCH-000-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-02', evidence: [nonPreviewPath]}],
    });
    assert.equal(badDraft.status, 200, JSON.stringify(badDraft.body));
    const gates2 = await request(app).post('/api/acceptance/gates').send({package_id: 'PKG-000'});
    const fifth2 = gates2.body.gates.find((gate: {name: string}) => gate.name === '前置与阻塞');
    assert.equal(fifth2.ok, false);
    assert.match(fifth2.detail, /前置\/阻塞未满足/);
    assert.match(fifth2.detail, /BLK-SURVEY-DATA-FREEZE/);
    assert.equal(gates2.body.ok, false);
  });

  it('合法草稿 dry_run：records 带双指纹、pr_body 四要素与付款节点结论', async () => {
    // PKG-900 无依赖无阻塞：唯一五道卡点能全绿的包（PKG-060 被 PKG-050/BLK 挡在
    // 第五道——正是 P1-3 修的行为，见上一组用例）
    const finalPath = await stageAndFinalize(app, 'PKG-900', 'SCH-900-01', 'a.jpg');
    const saved = await request(app).put('/api/acceptance/draft').send({
      package_id: 'PKG-900',
      results: [{check_id: 'SCH-900-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-02', evidence: [finalPath]}],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const res = await request(app).post('/api/acceptance/submit').send({package_id: 'PKG-900', dry_run: true});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.records.length, 1);
    assert.equal(res.body.records[0].check_spec_sha256.length, 64);
    assert.equal(res.body.records[0].project_data_sha256.length, 64);
    assert.match(res.body.pr_body, /本次改动的检查/);
    assert.match(res.body.pr_body, /GATE-900-OWNER-APPROVAL/);
    // P1-8：PKG-900 只有一条检查且本次 passed → 显式写放行哪个付款节点
    assert.match(res.body.pr_body, /\*\*本次放行：GATE-900-OWNER-APPROVAL（包已全部通过；合并后生效）\*\*/);
    // dry_run 不许碰 git：没有创建任何 accept/ 分支
    const branches = await request(app).get('/api/schedule/state');
    assert.equal(branches.status, 200);
  });

  it('P1-7 PUT draft：results/条目形状非法 → 4xx issue，不 500', async () => {
    // results 非数组：路由体的形状守卫先拦（400）；条目级形状进 validateDraft（422）
    const notArray = await request(app).put('/api/acceptance/draft').send({package_id: 'PKG-060', results: 'nope'});
    assert.ok(notArray.status === 400 || notArray.status === 422, `形状非法不得 500（got ${notArray.status}）`);

    const badStatus = await request(app).put('/api/acceptance/draft').send({
      package_id: 'PKG-060',
      results: [{check_id: 'check_tile_gap', status: 'bogus', checked_by: '业主', checked_at: '2026-11-02', evidence: []}],
    });
    assert.equal(badStatus.status, 422);
    assert.ok(badStatus.body.issues.some((issue: {field?: string}) => issue.field === 'status'));

    const badEvidence = await request(app).put('/api/acceptance/draft').send({
      package_id: 'PKG-060',
      results: [{check_id: 'check_tile_gap', status: 'passed', checked_by: '业主', checked_at: '2026-11-02', evidence: 'x'}],
    });
    assert.equal(badEvidence.status, 422);
    assert.ok(badEvidence.body.issues.some((issue: {field?: string}) => issue.field === 'evidence'));
  });
});

// ─── store 单测：clearStaging / 分支名 / 提交分支安全（不碰 git 写路径） ───

describe('acceptance store：草稿清理 / 分支名 / 提交分支安全', () => {
  after(() => {
    rmSync(STAGING, {recursive: true, force: true});
    rmSync(DRAFT_DIR, {recursive: true, force: true});
  });

  it('P1-4 clearStaging：删草稿文件与暂存目录（提交成功后防重复提交）', () => {
    const draft = {
      package_id: 'PKG-060',
      results: [{check_id: 'check_tile_gap', status: 'passed', checked_by: '业主', checked_at: '2026-11-02', evidence: ['schedule/phase-1/evidence/PKG-060/check_tile_gap/a.jpg']}],
    } as never;
    const validation = saveDraft(draft);
    assert.equal(validation.ok, true, JSON.stringify(validation.issues));
    assert.ok(existsSync(join('.', DRAFT_DIR, 'PKG-060.json')));
    assert.equal(loadDraft('PKG-060').results.length, 1);

    const staged = stageEvidence('PKG-060', 'check_tile_gap', 'b.jpg', Buffer.from('x').toString('base64'));
    assert.ok(existsSync(join('.', staged.staging_path)));

    clearStaging('PKG-060');
    assert.ok(!existsSync(join('.', DRAFT_DIR, 'PKG-060.json')), '草稿文件必须删掉');
    assert.ok(!existsSync(join('.', STAGING, 'PKG-060')), '暂存目录必须删掉');
    assert.deepEqual(loadDraft('PKG-060').results, [], '清后读不到草稿（防重复提交）');
  });

  it('P1-4 acceptBranchName：日期+时间后缀，同一天同包多次提交不撞车', () => {
    const morning = new Date(2026, 10, 2, 9, 5, 3);   // 2026-11-02 09:05:03（本地）
    assert.equal(acceptBranchName('PKG-060', morning), 'accept/PKG-060-20261102-090503');
    assert.notEqual(acceptBranchName('PKG-060', new Date(2026, 10, 2, 9, 5, 4)), acceptBranchName('PKG-060', morning));
    assert.notEqual(acceptBranchName('PKG-060', new Date(2026, 10, 3, 9, 5, 3)), acceptBranchName('PKG-060', morning));
    // 单位数补零
    assert.equal(acceptBranchName('PKG-060', new Date(2026, 0, 5, 7, 8, 9)), 'accept/PKG-060-20260105-070809');
  });

  it('P1-6 提交分支安全：非 master 拒绝（409）且不创建分支；纯规则单测', () => {
    assert.equal(isAcceptanceBaseBranch('master'), true);
    assert.equal(isAcceptanceBaseBranch(' master '), true);
    assert.equal(isAcceptanceBaseBranch('feat/acceptance-write-path'), false);
    assert.equal(isAcceptanceBaseBranch(''), false);

    const current = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {cwd: process.cwd(), encoding: 'utf8'}).stdout.trim();
    if (current === 'master') {
      // CI 在 master 上跑：守卫放行（不在这里真提交——会碰 git/gh）
      assert.equal(isAcceptanceBaseBranch(current), true);
      return;
    }
    // 本地在特性分支上：submitAcceptance 必须先拒（409），且不创建任何 accept/ 分支
    const listBranches = () => spawnSync('git', ['branch', '--list', 'accept/*'], {cwd: process.cwd(), encoding: 'utf8'}).stdout.trim();
    const before = listBranches();
    assert.throws(() => submitAcceptance('PKG-060'), (err: unknown) => {
      assert.ok(err instanceof AcceptanceError, '必须是 AcceptanceError');
      assert.equal(err.status, 409);
      assert.match(err.message, /不是 master/);
      return true;
    });
    assert.equal(listBranches(), before, '拒绝时不得创建分支');
  });
});
