// 构件级工程状态端点（GET /api/element-state）的契约测试。
//
// 守的不变量：
//   ① 与 `npm run state:project` 同一份派生：163 个构件（2026-10-12 R1 删两盏壁灯 + R2 删两卫平板灯与墙控 164→158；DEC-2026-10-13-R5 删电视墙灯带 158→157；DEC-2026-10-17-R20 水电点位批 105 电气 + 33 给排水 → 163）、undeclared=2 / pending=32；
//   ② app 侧契约逐字段完整（status 只在枚举内、必填字段不许缺）；
//   ③ conflicts 路径缓存：连续两次同一 cachedAt，refresh=1 换新时间戳；
//   ④ fail-closed：输入异常 → 503，绝不返回空 states 假装没有状态。
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import { createApiRouter } from '../../server/routes.js';
import { getElementState, type ElementStatePayload } from '../../server/element-state-service.js';
const TEST_DATA_DIR = './tmp/test-data-element-state-api';

const ELEMENT_STATUSES = new Set(['measured', 'confirmed', 'inferred', 'pending', 'conflicted', 'undeclared']);
const STATE_KEYS = ['conflicts', 'decision', 'id', 'kind', 'label', 'openQuestion', 'room', 'status', 'statusSource'];
const OPEN_QUESTION_KEYS = ['blockedBy', 'ref', 'summary'];

function createApp(
  dep?: (options: { withConflicts?: boolean; refresh?: boolean }) => ElementStatePayload | undefined,
): express.Express {
  const catalog = ProjectCatalog.load('.');
  const state = new DesignState(catalog, TEST_DATA_DIR);
  const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createApiRouter({
      catalog,
      state,
      getRuleEngine: () => engine,
      getBudgetCalculator: () => new BudgetCalculator(catalog, engine.getConfig()),
      archiveStore: new ArchivedSchemesStore(TEST_DATA_DIR),
      getConfigRegistry: () => new ConfigRegistry(),
      getOverlay: () => undefined,
      getElementState: dep,
    })
  );
  return app;
}

describe('element state API', () => {
  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  after(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('GET /api/element-state returns the full projection without running verifiers', async () => {
    const res = await request(createApp(getElementState)).get('/api/element-state').expect(200);
    assert.equal(res.body.version, 1);
    assert.equal(res.body.withConflicts, false);
    assert.equal(res.body.cachedAt, null, '不带 conflicts 时不缓存，cachedAt 必须是 null');
    assert.equal(res.body.states.length, 163);
    assert.equal(res.body.summary.total, 163); // DEC-2026-10-12-R1 删主卧两盏壁灯元素（164→162）；R2 删两卫平板灯与墙控（162→158）；DEC-2026-10-13-R5 删电视墙灯带（158→157）；DEC-2026-10-17-R20 水电点位批：电气 100→105、给排水 32→33（157→163）
    // 与 tests/server/element-state.test.ts 的真实台账快照同口径：两个吊顶分区仍未挂 DEC；
    // 厨房烟机插座因本轮移到试案位置，显式 position_status: pending。
    assert.equal(res.body.summary.undeclared, 2);
    assert.equal(res.body.summary.pending, 32); // 含 #61 台盆镜柜、#64 冰箱新电源待定，以及试位中的 sock_kitchen_hood；DEC-2026-10-17-R20 +4：sock_fridge_living / sock_kitchen_east_counter / sock_weakbox（新增点位未画路由待复核）与 sock_gbath_towel（换墙迁移复核）落 pending（28→32）
    assert.equal(res.body.summary.byStatus.undeclared, 2);
    assert.ok(res.body.summary.byKind.electrical === 105 && res.body.summary.byKind.plumbing === 33); // 电气点位 107→105（R1）→101（R2 删两卫平板灯与墙控）→100（DEC-2026-10-13-R5 删电视墙灯带）；DEC-2026-10-17-R20 100→105、给排水 32→33
  });

  it('GET /api/element-state?conflicts=1 attaches verifier conclusions and a cache timestamp', async () => {
    const res = await request(createApp(getElementState)).get('/api/element-state?conflicts=1').expect(200);
    assert.equal(res.body.withConflicts, true);
    assert.equal(typeof res.body.cachedAt, 'string');
    assert.ok(res.body.cachedAt.length > 0, '带 conflicts 时必须带 cachedAt，让人知道是不是旧数据');
    assert.ok(!Number.isNaN(Date.parse(res.body.cachedAt)), 'cachedAt 必须是 ISO 时间串');
    assert.equal(res.body.summary.total, 163, '接上 verifier issue 后构件总数不变（DEC-2026-10-12-R1/R2 删壁灯与两卫平板灯后 164→158；DEC-2026-10-13-R5 删电视墙灯带后 158→157；DEC-2026-10-17-R20 水电点位批后 163）');
    // 冲突集合不能凭空消失：verify-spatial / penetration / electrical-lint 当前有 issue
    assert.ok(res.body.states.some((state: { conflicts: string[] }) => state.conflicts.length > 0));
  });

  it('serves the app-side contract for every state', async () => {
    const res = await request(createApp(getElementState)).get('/api/element-state').expect(200);
    assert.deepEqual(Object.keys(res.body).sort(), ['cachedAt', 'states', 'summary', 'version', 'warnings', 'withConflicts']);
    for (const key of ['total', 'byStatus', 'byKind', 'undeclared', 'conflicted', 'pending']) {
      assert.ok(key in res.body.summary, `summary.${key} 必须存在`);
    }
    for (const state of res.body.states) {
      for (const key of STATE_KEYS) {
        if (key === 'room' || key === 'decision' || key === 'openQuestion') continue;
        assert.ok(key in state, `state ${state.id} 缺字段 ${key}`);
      }
      assert.equal(typeof state.id, 'string');
      assert.equal(typeof state.kind, 'string');
      assert.equal(typeof state.label, 'string');
      assert.equal(typeof state.statusSource, 'string');
      assert.ok(Array.isArray(state.conflicts));
      assert.ok(ELEMENT_STATUSES.has(state.status), `未知 status: ${state.status}`);
      if (state.room !== undefined) assert.equal(typeof state.room, 'string');
      if (state.decision !== undefined) assert.equal(typeof state.decision, 'string');
      if (state.openQuestion !== undefined) {
        assert.deepEqual(Object.keys(state.openQuestion).sort(), OPEN_QUESTION_KEYS);
        assert.equal(typeof state.openQuestion.ref, 'string');
        assert.equal(typeof state.openQuestion.summary, 'string');
        assert.equal(typeof state.openQuestion.blockedBy, 'string');
      }
    }
    for (const warning of res.body.warnings) {
      assert.equal(typeof warning.code, 'string');
      assert.equal(typeof warning.entity, 'string');
      assert.equal(typeof warning.message, 'string');
    }
  });

  it('binds sock_child_ac to pending-site-data #42 and the vendor drawing', async () => {
    const res = await request(createApp(getElementState)).get('/api/element-state').expect(200);
    const sock = res.body.states.find((state: { id: string }) => state.id === 'electrical:sock_child_ac');
    assert.ok(sock, 'electrical:sock_child_ac 必须被采集到');
    assert.equal(sock.status, 'pending');
    assert.equal(sock.openQuestion.ref, '42');
    assert.ok(sock.openQuestion.blockedBy.includes('空调厂家深化图'), `卡在谁必须点名空调厂家深化图，实际：${sock.openQuestion.blockedBy}`);
    // config 自己就声明了 pending，config_status 规则优先于台账——statusSource 指向 config，
    // 但「卡在谁」仍然挂在 openQuestion 上（与 shared/element-state.ts 的解耦设计一致）。
    assert.equal(sock.statusSource, 'config:pending');
  });

  it('caches the conflicts projection and honours refresh=1', async () => {
    const app = createApp(getElementState);
    // 缓存是模块级的：本条第一次调用可能冷算（前面用例已填过就是热命中），
    // 无论冷热，紧接着的第二次都必须命中同一缓存——三个 verifier 不能每次请求都跑。
    const first = await request(app).get('/api/element-state?conflicts=1').expect(200);
    const second = await request(app).get('/api/element-state?conflicts=1').expect(200);
    assert.equal(second.body.cachedAt, first.body.cachedAt, '第二次必须命中缓存——三个 verifier 不能每次请求都跑');
    assert.deepEqual(second.body.states, first.body.states);

    const refreshed = await request(app).get('/api/element-state?conflicts=1&refresh=1').expect(200);
    assert.notEqual(refreshed.body.cachedAt, first.body.cachedAt, 'refresh=1 必须重算并刷新时间戳');
    assert.equal(refreshed.body.summary.total, first.body.summary.total);
  });

  it('fails closed with 503 instead of serving empty states', async () => {
    // 输入读不到/解析失败时服务抛错；路由必须转 503，且 body 里不许出现空 states 兜底。
    const broken = createApp(() => {
      throw new Error('docs/pending-site-data.md is unreadable');
    });
    const res = await request(broken).get('/api/element-state').expect(503);
    assert.match(res.body.error, /unreadable/);
    assert.equal(res.body.states, undefined, '503 响应里不许夹带 states——空状态比报错更危险');

    const conflictedBroken = createApp(() => {
      throw new Error('verify-spatial produced unparseable output');
    });
    const conflictRes = await request(conflictedBroken).get('/api/element-state?conflicts=1').expect(503);
    assert.match(conflictRes.body.error, /unparseable|verify-spatial/);
    assert.equal(conflictRes.body.states, undefined);

    // 依赖没注入（可选依赖）→ 503 兜底，不是 500、更不是空数据。
    const missing = await request(createApp()).get('/api/element-state').expect(503);
    assert.equal(missing.body.error, 'element state is not ready');

    // 成功路径永远带满 163 条（DEC-2026-10-12-R1/R2 前为 164，DEC-2026-10-13-R5 后为 157，DEC-2026-10-17-R20 后为 163）：契约里没有「空 states」这种合法响应。
    const ok = await request(createApp(getElementState)).get('/api/element-state').expect(200);
    assert.equal(ok.body.states.length, ok.body.summary.total);
    assert.equal(ok.body.states.length, 163);
  });

  it('rejects unrecognised flag values instead of silently reading them as false', async () => {
    await request(createApp(getElementState)).get('/api/element-state?conflicts=yes').expect(400);
    await request(createApp(getElementState)).get('/api/element-state?refresh=maybe').expect(400);
    // 0/false 是合法的「关」。
    const off = await request(createApp(getElementState)).get('/api/element-state?conflicts=0&refresh=false').expect(200);
    assert.equal(off.body.withConflicts, false);
    assert.equal(off.body.cachedAt, null);
  });
});
