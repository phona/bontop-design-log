// 构件级工程状态端点（GET /api/element-state）的契约测试。
//
// 守的不变量：
//   ① 与 `npm run state:project` 同一份派生：162 个构件（2026-10-12 R1 删两盏壁灯 + R2 删两卫平板灯与墙控 164→158；DEC-2026-10-13-R5 删电视墙灯带 158→157；DEC-2026-10-17-R20 水电点位批 105 电气 + 33 给排水 → 163；DEC-2026-10-27-R01 删床头开关 → 162）、undeclared=2 / pending=32；
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
import { projectElementStates } from '../../server/element-state-service.js';
import { readFileSync } from 'node:fs';
import { BLOCKER_KINDS, BLOCKER_OWNERS } from '../../shared/element-blockers.js';
const TEST_DATA_DIR = './tmp/test-data-element-state-api';

const ELEMENT_STATUSES = new Set(['measured', 'confirmed', 'inferred', 'pending', 'conflicted', 'undeclared']);
const STATE_KEYS = ['blocker', 'conflicts', 'decision', 'id', 'kind', 'label', 'room', 'status', 'statusSource'];
const BLOCKER_KEYS = ['kind', 'owner', 'rationale', 'reverses_if', 'trigger'];
const BLOCKER_KIND_SET = new Set<string>(BLOCKER_KINDS);
const BLOCKER_OWNER_SET = new Set<string>(BLOCKER_OWNERS);

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
    assert.equal(res.body.states.length, 162);
    assert.equal(res.body.summary.total, 162); // DEC-2026-10-12-R1 删主卧两盏壁灯元素（164→162）；R2 删两卫平板灯与墙控（162→158）；DEC-2026-10-13-R5 删电视墙灯带（158→157）；DEC-2026-10-17-R20 水电点位批：电气 100→105、给排水 32→33（157→163）
    // 与 tests/server/element-state.test.ts 的真实台账快照同口径：两个吊顶分区仍未挂 DEC；
    // 厨房烟机插座因本轮移到试案位置，显式 position_status: pending。
    assert.equal(res.body.summary.undeclared, 2);
    assert.equal(res.body.summary.pending, 37); // 2026-11-08 issue #98 S1-B +2：sock_kitchen_dishwasher（note 明文「⚠️坐标待量房」）与 net_ap_corridor（note 明文「二者待网络方案定标后冻结」）由 DEC 引用 confirmed 降为 position_status: pending 显形——诚实降级，不是丢失；与 tests/server/element-state.test.ts 同口径（decision 通道归零、confirmed 73→6）。前史：DEC-2026-11-05-R5 新增 #75 水压实测绑 faucet_gbath_vanity（33→34）；2026-11-06 issue #98 PR-4 三点位显式申报：faucet_gbath_vanity 由 ledger 规则改走 config_status 规则（status: inferred，#75 仍作 openQuestion 挂带）pending 34→33；sock_gbath_robot 与 drain_gbath_vanity 原凭 note 内 DEC 引用落 confirmed，现显式 status: inferred（设计推断占位 / 精度三件套同口径），confirmed 77→75、inferred 49→52；含 #61 台盆镜柜、#64 冰箱新电源待定，以及试位中的 sock_kitchen_hood；DEC-2026-10-17-R20 +4：sock_fridge_living / sock_kitchen_east_counter / sock_weakbox（新增点位未画路由待复核）与 sock_gbath_towel（换墙迁移复核）落 pending（28→32）；DEC-2026-10-23-R03 +1：#74 改写显名 drain_gbath_floor（客卫二次排水锚点，与主卫 drain_mbath_floor 绑 #50 同口径）落 pending（32→33）；2026-11-06 issue #98 PR-6 +2：sock_gbath_vanity / sock_gbath_vanity_2 宿主核实=墙挂（不挂柜）并按口径 A 迁到西完成面 x 7.14，同步精度三件套 status: inferred + position_status: pending（x 依渲染基准先行、7.14/7.20 结构真值待 pending #76 量房），confirmed 75→73、pending 33→35
    assert.equal(res.body.summary.byStatus.undeclared, 2);
    assert.ok(res.body.summary.byKind.electrical === 104 && res.body.summary.byKind.plumbing === 33); // DEC-2026-10-27-R01 删 switch_parent_bed，电气 105→104； // 电气点位 107→105（R1）→101（R2 删两卫平板灯与墙控）→100（DEC-2026-10-13-R5 删电视墙灯带）；DEC-2026-10-17-R20 100→105、给排水 32→33
  });

  it('GET /api/element-state?conflicts=1 attaches verifier conclusions and a cache timestamp', async () => {
    const res = await request(createApp(getElementState)).get('/api/element-state?conflicts=1').expect(200);
    assert.equal(res.body.withConflicts, true);
    assert.equal(typeof res.body.cachedAt, 'string');
    assert.ok(res.body.cachedAt.length > 0, '带 conflicts 时必须带 cachedAt，让人知道是不是旧数据');
    assert.ok(!Number.isNaN(Date.parse(res.body.cachedAt)), 'cachedAt 必须是 ISO 时间串');
    assert.equal(res.body.summary.total, 162, '接上 verifier issue 后构件总数不变（DEC-2026-10-12-R1/R2 删壁灯与两卫平板灯后 164→158；DEC-2026-10-13-R5 删电视墙灯带后 158→157；DEC-2026-10-17-R20 水电点位批后 163）');
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
        if (key === 'room' || key === 'decision' || key === 'blocker') continue;
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
      // 2026-11-08 issue #98 S2-A：API 不再输出 openQuestion（台账通道已退场）——
      // 「卡在谁、何时解锁、何时反转」由对象自己的 blocker 承载。
      assert.equal(state.openQuestion, undefined, 'openQuestion 已随台账退役，API 不得再输出它');
      if (state.blocker !== undefined) {
        assert.deepEqual(Object.keys(state.blocker).sort(), BLOCKER_KEYS);
        assert.ok(BLOCKER_KIND_SET.has(state.blocker.kind), `未知 blocker.kind: ${state.blocker.kind}`);
        assert.ok(Array.isArray(state.blocker.owner) && state.blocker.owner.length > 0);
        for (const owner of state.blocker.owner) assert.ok(BLOCKER_OWNER_SET.has(owner), `未知 blocker.owner: ${owner}`);
        for (const field of ['trigger', 'reverses_if', 'rationale']) assert.equal(typeof state.blocker[field], 'string');
      }
    }
    for (const warning of res.body.warnings) {
      assert.equal(typeof warning.code, 'string');
      assert.equal(typeof warning.entity, 'string');
      assert.equal(typeof warning.message, 'string');
    }
  });

  it('binds sock_child_ac to its own blocker (no ledger, no pending-site-data ref)', async () => {
    const res = await request(createApp(getElementState)).get('/api/element-state').expect(200);
    const sock = res.body.states.find((state: { id: string }) => state.id === 'electrical:sock_child_ac');
    assert.ok(sock, 'electrical:sock_child_ac 必须被采集到');
    assert.equal(sock.status, 'pending');
    assert.equal(sock.statusSource, 'config:pending');
    // 「卡在谁」来自对象自己的 blocker，不来自台账 #N（2026-11-08 issue #98 S2-A）。
    assert.ok(sock.blocker, '必须带 blocker');
    assert.equal(sock.blocker.kind, 'pending_vendor_drawing');
    assert.deepEqual(sock.blocker.owner, ['厂家']);
    assert.match(sock.blocker.trigger, /28T2.*厂家深化图到手/);
    assert.match(sock.blocker.reverses_if, /接线盒在西\/北侧/);
    assert.equal(sock.openQuestion, undefined, 'API 不得再输出台账派生的 openQuestion');
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

    // 成功路径永远带满 163 条（DEC-2026-10-12-R1/R2 前为 164，DEC-2026-10-13-R5 后为 157，DEC-2026-10-17-R20 后为 163；DEC-2026-10-27-R01 删床头开关后为 162）：契约里没有「空 states」这种合法响应。
    const ok = await request(createApp(getElementState)).get('/api/element-state').expect(200);
    assert.equal(ok.body.states.length, ok.body.summary.total);
    assert.equal(ok.body.states.length, 162);
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

// ── state-model 词汇表的读者键名（issue #98 S1-B 评审 BLOCKING-1）─────────────
// config/state-model.yaml 声明蛇形 status_vocabulary；CLI（state-projection.ts）与
// 服务端（本文件 import 的 element-state-service.ts）必须同口径读它。
// 失效形态：只有一个读者改了，另一个静默走 DEFAULT_STATE_MODEL——CLI 与 API 分叉，
// 且默认值与 YAML 逐键相同，今天恰好掩盖，没有任何门禁会红。
describe('state-model 词汇表读者键名', () => {
  const YAML_KEY = 'status_vocabulary';
  const CAMEL_KEY = 'statusVocabulary';

  it('蛇形键被读、驼峰键不被读', () => {
    // 基线：不传 modelConfig，走真实 YAML。
    const base = projectElementStates([]);
    const basePending = base.states.filter((s) => s.status === 'pending').length;
    assert.ok(basePending > 0, '基线应有 pending 构件，否则本测试无判别力');

    // 传蛇形键：把 inferred 一律映射成 pending，pending 数应大幅上升。
    const snake = projectElementStates([], { [YAML_KEY]: { inferred: 'pending' as const } });
    const snakePending = snake.states.filter((s) => s.status === 'pending').length;
    assert.ok(snakePending > basePending, `蛇形 status_vocabulary 必须被读取（${basePending} → ${snakePending}）`);

    // 传驼峰键：同样的映射必须无效（证明读者不是驼峰）。
    const camel = projectElementStates([], { [CAMEL_KEY]: { inferred: 'pending' as const } } as never);
    const camelPending = camel.states.filter((s) => s.status === 'pending').length;
    assert.equal(camelPending, basePending, `驼峰 statusVocabulary 不得被读取（${basePending} → ${camelPending}）`);
  });

  it('YAML 里只存在蛇形键', () => {
    const yaml = readFileSync('config/state-model.yaml', 'utf8');
    assert.match(yaml, new RegExp(`^${YAML_KEY}:`, 'm'), 'config/state-model.yaml 必须声明蛇形 status_vocabulary');
    assert.doesNotMatch(yaml, new RegExp(`^\\s*${CAMEL_KEY}:`, 'm'), '不许出现驼峰 statusVocabulary 键');
  });
});

// ── app 侧契约与真实 payload 绑定（S2-A 第 4 轮 blocking B1）─────────────────
// 失效形态：服务端改了 ElementState 形状，app 侧 ElementStateLike 不跟着改，
// 而 app 测试全部自造 fixture → 21/21 假绿，产品已坏。openQuestion → blocker
// 这次迁移就踩中了（web 3D 的「卡在谁」全 blank，没有任何测试红）。
// 这条锚把两侧字段集钉成相等，任一侧加/删/改字段都会红。
describe('app 侧 ElementStateLike 契约与真实 payload 绑定', () => {
  const APP_CONTRACT = 'app/src/render/analysis/element-state-colors.ts';
  const SERVER_TYPE = 'shared/element-state.ts';

  function fieldsOf(source: string, iface: string): string[] {
    const start = source.indexOf(`interface ${iface} {`);
    assert.ok(start >= 0, `找不到 interface ${iface}`);
    const body = source.slice(start, source.indexOf('\n}', start));
    return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]).sort();
  }

  it('两侧字段集相等（app 不许留服务端已删的字段，也不许缺服务端已加的）', () => {
    const app = readFileSync(APP_CONTRACT, 'utf8');
    const server = readFileSync(SERVER_TYPE, 'utf8');
    const appFields = fieldsOf(app, 'ElementStateLike');
    const serverFields = fieldsOf(server, 'ElementState');
    assert.deepEqual(appFields, serverFields,
      `app ElementStateLike 与 server ElementState 字段集不一致：\n  app:   ${appFields.join(', ')}\n  server: ${serverFields.join(', ')}`);
    assert.ok(appFields.includes('blocker'), 'app 契约必须消费 blocker（卡在谁的新载体）');
    assert.ok(!appFields.includes('openQuestion'), 'app 契约不得再留 openQuestion（已随台账/DEC 通道退役）');
  });

  it('真实 payload 上：pending 构件必带 blocker，且不再有 openQuestion 键', () => {
    const payload = getElementState({ withConflicts: false });
    const pending = payload.states.filter((s) => s.status === 'pending' || s.status === 'undeclared');
    assert.ok(pending.length > 0, '应有 pending/undeclared 构件');
    for (const state of pending) {
      assert.ok(state.blocker, `${state.id} 必须带 blocker`);
      assert.ok(!('openQuestion' in state), `${state.id} 不得再有 openQuestion 键`);
    }
  });
});
