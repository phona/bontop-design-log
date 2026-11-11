// what-if 端点回归（issue #202 S2；docs/schedule-coordination-design.md §6.2 / §15.3）。
//
// 守什么（对应任务书 §4 测试清单 9–13）：
//   9  无参 = 基线：响应去掉 scenario 后与 /api/schedule/state 的 schedule 键逐值相同，
//      scenario 为 null（模块口径：没给 scenario 就没有演算结论，不造空 affected）；
//      每个包的 forecast 与 baseline 逐值相同（§16.3：无 scenario 时两者同源）。
//   10 delay PKG-040:3 只影响拓扑下游：affected 恰为 PKG-040 的全部下游（并行分支
//      PKG-030 及其上游不在内），delta 全为本次演算的 3 个工作日；未受影响包的
//      forecast 与 /schedule/state 的当前预测逐值相同。
//   11 未知包 / 非正整数 / 坏语法 / 重复同名参数 → 400 带原因；合法多项列表照常 200。
//   12 state.errors 非空 → 503，与 /schedule/state 同一 load 期通道（§14/B4 不回归）。
//   13 what-if 不改写 check_window：检查记录是证据不是工期（§16.3）——带真实检查记录的
//      沙箱里，delay 前后 check_window 逐值不变，点名包自身的 forecast 照常位移。
//
// 手法：多数用例直接打真实 config（anchor_date: null，delay 仍按 ord 演算）；需要非空
// check_window / 非空 errors 的两条用 symlink 农场沙箱 + process.chdir（路由内
// loadScheduleState('.') 读 cwd），沙箱形态沿用 tests/server/schedule-loader-contract.test.ts。
// 沙箱只在单个用例内生效，finally 恢复 cwd——node:test 同一文件的顶层用例串行执行。

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { createApiRouter, isWhatIfRequestProjectionError } from '../../server/routes.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import { loadModelPackageLinks } from '../../server/model-package-links.js';
import { loadScheduleState } from '../../shared/schedule-state.js';
import { MAX_SCENARIO_DELAY_WORKDAYS, ProjectionError } from '../../shared/schedule-projection.js';

type AnyRecord = Record<string, any>;

const repoRoot = process.cwd();

function replaceOnce(text: string, from: string, to: string): string {
  const first = text.indexOf(from);
  assert.notEqual(first, -1, `篡改锚点不存在：${from}`);
  assert.equal(text.indexOf(from, first + 1), -1, `篡改锚点不唯一：${from}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

/**
 * symlink 农场：除 schedule/ 与 contracts/ 为真实副本（可篡改面）外，其余顶层条目
 * symlink 回真仓。与 tests/server/schedule-loader-contract.test.ts 同构。
 */
function makeSandbox(): string {
  const sandbox = mkdtempSync(join(tmpdir(), 'schedule-what-if-'));
  for (const entry of readdirSync(repoRoot)) {
    if (entry === '.git' || entry === 'node_modules' || entry === 'schedule' || entry === 'contracts') continue;
    symlinkSync(join(repoRoot, entry), join(sandbox, entry));
  }
  symlinkSync(join(repoRoot, 'node_modules'), join(sandbox, 'node_modules'));
  cpSync(join(repoRoot, 'schedule'), join(sandbox, 'schedule'), {recursive: true});
  cpSync(join(repoRoot, 'contracts'), join(sandbox, 'contracts'), {recursive: true});
  return sandbox;
}

/** 在指定 cwd 下跑请求（路由内 loadScheduleState('.') 以 cwd 为根），无论成败都恢复。 */
async function withCwd(dir: string, run: () => Promise<void>): Promise<void> {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    await run();
  } finally {
    process.chdir(previous);
  }
}

describe('GET /api/schedule/what-if（设计 §6.2）', () => {
  let app: express.Express;
  let dataDir = '';

  before(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'schedule-what-if-app-'));
    const catalog = ProjectCatalog.load(repoRoot);
    const state = DesignState.load(catalog, dataDir);
    const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    const calc = new BudgetCalculator(catalog, engine.getConfig());
    app = express();
    app.use(express.json());
    app.use('/api', createApiRouter({
      catalog,
      state,
      getRuleEngine: () => engine,
      getBudgetCalculator: () => calc,
      archiveStore: new ArchivedSchemesStore(dataDir),
      getConfigRegistry: () => new ConfigRegistry(),
      getOverlay: () => undefined,
    }));
  });

  after(() => {
    if (dataDir) rmSync(dataDir, {recursive: true, force: true});
  });

  it('附. loader 把装配好的投影入参挂到 ScheduleState（路由不另装配的前提）', () => {
    // 设计 §6.2 的接线决定：what-if 只复用 loader 的入参。这条钉住字段本身——
    // 主车道过滤 / calendar / constraints / check_windows 若在路由侧再装配一套，这里先红。
    const state = loadScheduleState(repoRoot, {modelPackageLinks: loadModelPackageLinks()});
    assert.deepEqual(state.errors, []);
    const input = state.scheduleProjectionInput;
    assert.ok(input, '投影成功时投影入参必须非空');
    assert.ok(state.scheduleProjection, '投影本身必须非空');
    assert.equal(
      input.packages.some((pkg) => pkg.id === 'PKG-900'),
      false,
      '主车道过滤只有 loader 一份：sequence ≥ 900 的 PKG-900 不得进投影入参',
    );
    assert.equal(input.calendar.anchor_date, null, '真实 config 的锚点未定');
    assert.deepEqual(
      input.constraints?.['PKG-005']?.map((constraint) => constraint.id),
      ['CON-005-PROPERTY-HOURS', 'CON-005-DEPOSIT-PAID'],
      'constraints 映射只有 loader 一份',
    );
    assert.equal('check_windows' in input, false, '没有检查记录时不造空 check_windows 键');
  });

  it('9. 无参 = 基线：响应 = 快照的 schedule 键 + scenario: null', async () => {
    const stateRes = await request(app).get('/api/schedule/state').expect(200);
    const res = await request(app).get('/api/schedule/what-if').expect(200);
    assert.equal(res.body.scenario, null, '没有 delay 就没有 scenario（模块口径，不造 {overrides: [], affected: []}）');
    const {scenario: _scenario, ...schedule} = res.body;
    assert.deepEqual(schedule, stateRes.body.schedule, '无参 what-if 必须与 /schedule/state 的 schedule 键逐值相同');
    for (const [pkgId, pkg] of Object.entries(schedule.packages as Record<string, {baseline: unknown; forecast: unknown}>)) {
      assert.deepEqual(pkg.forecast, pkg.baseline, `${pkgId}: 无 scenario 时 forecast 必须与 baseline 相同（§16.3）`);
    }
    assert.equal(schedule.anchor_date, null, '真实 config 的锚点未定');
    assert.ok(schedule.ordinals.length > 0, '计划序数必须仍在');
    assert.ok(schedule.ordinals.every((entry: {date: string | null}) => entry.date === null), '锚点未定：ordinals 不造年月日（§18）');

    // 空值等同无参：?delay= 不产生 overrides，不 400。
    const empty = await request(app).get('/api/schedule/what-if?delay=').expect(200);
    assert.equal(empty.body.scenario, null);
    assert.deepEqual(empty.body.packages, stateRes.body.schedule.packages);
  });

  it('10. delay PKG-040:3 只影响拓扑下游；并行分支 PKG-030 不动；affected 列真实受影响包', async () => {
    const stateRes = await request(app).get('/api/schedule/state').expect(200);
    const res = await request(app).get('/api/schedule/what-if?delay=PKG-040:3').expect(200);
    assert.deepEqual(res.body.scenario.overrides, [{pkg: 'PKG-040', workdays: 3}]);

    const affected = res.body.scenario.affected as Array<{pkg: string; delta: number}>;
    // 由 control.yaml 拓扑推出：PKG-040 的全部下游（并行分支 PKG-030 不是 PKG-040 的下游）。
    // 漏报（仅保守末端变化的包被丢）与误报（把并行分支算进来）都会让这条红。
    assert.deepEqual(
      affected.map((entry) => entry.pkg).sort(),
      [
        'PKG-050', 'PKG-060', 'PKG-065', 'PKG-070', 'PKG-080', 'PKG-090',
        'PKG-100', 'PKG-110', 'PKG-120', 'PKG-125', 'PKG-130', 'PKG-135',
        'PKG-140', 'PKG-142', 'PKG-145', 'PKG-150', 'PKG-160', 'PKG-170',
      ],
      'affected 必须是 PKG-040 的全部拓扑下游（§15.3 全窗对照，漏报/误报都红）',
    );
    assert.ok(affected.every((entry) => entry.delta === 3), '本次演算的窗口位移全为 3 个工作日');

    // 上游与并行分支：forecast 与当前预测逐值相同。
    for (const pkgId of ['PKG-000', 'PKG-005', 'PKG-010', 'PKG-020', 'PKG-030']) {
      assert.deepEqual(
        res.body.packages[pkgId].forecast,
        stateRes.body.schedule.packages[pkgId].forecast,
        `${pkgId}: 不是 PKG-040 的下游，forecast 不得被 delay 改写`,
      );
    }

    // 点名包自身：起点不动，min/max 两个末端各 +3（delay 同时加在声明工期区间两端）。
    const pkg040 = res.body.packages['PKG-040'];
    assert.equal(pkg040.forecast.start_ord, pkg040.baseline.start_ord);
    assert.equal(pkg040.forecast.end_ord_min - pkg040.baseline.end_ord_min, 3);
    assert.equal(pkg040.forecast.end_ord_max - pkg040.baseline.end_ord_max, 3);
  });

  it('11. 未知包 / 非正整数 / 坏语法 / 重复参数 → 400 带原因；合法多项列表照常演算', async () => {
    const cases: Array<{query: string; reason: RegExp}> = [
      {query: 'delay=PKG-999:3', reason: /unknown_scenario_package/},
      {query: 'delay=PKG-040:0', reason: /正整数/},
      {query: 'delay=PKG-040:-3', reason: /正整数/},
      {query: 'delay=PKG-040:1.5', reason: /语法非法/},
      {query: 'delay=PKG-040', reason: /语法非法/},
      {query: 'delay=PKG-040:abc', reason: /语法非法/},
      {query: 'delay=PKG-040:3,', reason: /语法非法/},
      {query: `delay=PKG-040:${MAX_SCENARIO_DELAY_WORKDAYS + 1}`, reason: /超过上限/},
      {query: 'delay=PKG-040:3,PKG-040:2', reason: /重复/},
      {query: 'delay=PKG-040:3&delay=PKG-030:2', reason: /single query value/},
    ];
    for (const {query, reason} of cases) {
      const res = await request(app).get(`/api/schedule/what-if?${query}`).expect(400);
      assert.match(res.body.error, reason, `${query} 必须 400 且带原因`);
    }

    // 未知包由 projectSchedule 判（包集合只有投影入参一份），400 原因里带包 id。
    const unknown = await request(app).get('/api/schedule/what-if?delay=PKG-999:3').expect(400);
    assert.match(unknown.body.error, /PKG-999/);

    const ok = await request(app).get('/api/schedule/what-if?delay=PKG-040:3,PKG-030:2').expect(200);
    assert.deepEqual(ok.body.scenario.overrides, [
      {pkg: 'PKG-040', workdays: 3},
      {pkg: 'PKG-030', workdays: 2},
    ]);
  });

  it('11b. delay 上限边界：3650 个工作日可演算，3651 立即 400（防 ordinals 无界展开）', async () => {
    // 无锚点时 projectSchedule 会为 minOrd..maxOrd 逐项造 ordinals：1e9 的 delay 能通过
    // Number.isSafeInteger，却会让无 token 的 GET 展开十亿项。上限在解析层先拦。
    const atLimit = await request(app)
      .get(`/api/schedule/what-if?delay=PKG-040:${MAX_SCENARIO_DELAY_WORKDAYS}`)
      .expect(200);
    assert.deepEqual(atLimit.body.scenario.overrides, [{pkg: 'PKG-040', workdays: MAX_SCENARIO_DELAY_WORKDAYS}]);
    assert.ok(Array.isArray(atLimit.body.ordinals));
    // 上界响应仍受控：序数展开只到本次演算的 maxOrd（起点 + 工期 + 上限），不是十亿级。
    assert.ok(atLimit.body.ordinals.length < 10_000, `ordinals 数量失控：${atLimit.body.ordinals.length}`);

    const over = await request(app)
      .get(`/api/schedule/what-if?delay=PKG-040:${MAX_SCENARIO_DELAY_WORKDAYS + 1}`)
      .expect(400);
    assert.match(over.body.error, /超过上限/);
    assert.equal(over.body.ordinals, undefined, '400 时不得夹带任何演算结果');
  });

  it('11c. ProjectionError 分类：请求类回 400，内部不变量错误不得伪装成客户端错误', () => {
    for (const code of ['unknown_scenario_package', 'invalid_delay', 'invalid_ordinal', 'work_calendar_exhausted']) {
      assert.equal(
        isWhatIfRequestProjectionError(new ProjectionError(code, code)),
        true,
        `${code} 属于本次请求的 delay 问题，应回 400`,
      );
    }
    for (const code of ['internal_order_error', 'invalid_calendar', 'work_calendar_empty', 'calendar_date_conflict']) {
      assert.equal(
        isWhatIfRequestProjectionError(new ProjectionError(code, code)),
        false,
        `${code} 不是请求类错误，必须走 503 而不是伪装成 400`,
      );
    }
    assert.equal(isWhatIfRequestProjectionError(new Error('boom')), false);
  });

  it('附. 响应形状 = 面板消费的 ScheduleProjectionView + scenario（键级契约）', async () => {
    // 面板端 what-if fixture 已按 shared/schedule-state.ts 的 ScheduleProjectionView 类型声明；
    // 这里钉住服务端实际序列化的键，防止两端各测各的、形状漂移仍全绿。
    const res = await request(app).get('/api/schedule/what-if?delay=PKG-040:3').expect(200);
    assert.ok(Array.isArray(res.body.ordinals), 'ordinals 必须是数组（面板 isProjectionLike 的第一个条件）');
    assert.ok(res.body.anchor_date === null || typeof res.body.anchor_date === 'string', 'anchor_date 必须可空');
    assert.ok(res.body.packages && typeof res.body.packages === 'object', 'packages 必须是对象');
    const pkg = res.body.packages['PKG-040'];
    assert.ok(pkg, 'PKG-040 必须在 packages 里');
    for (const key of ['duration_workdays', 'baseline', 'forecast', 'check_window', 'blocking_reasons', 'constraints']) {
      assert.ok(key in pkg, `包投影缺键 ${key}`);
    }
    for (const lane of ['baseline', 'forecast']) {
      assert.deepEqual(Object.keys(pkg[lane]).sort(), ['end_ord_max', 'end_ord_min', 'start_ord']);
    }
    assert.deepEqual(Object.keys(res.body.scenario).sort(), ['affected', 'overrides']);
    for (const entry of res.body.scenario.affected) {
      assert.deepEqual(Object.keys(entry).sort(), ['delta', 'pkg']);
    }
  });

  it('附. what-if 只读：路由表里没有写入口（演算不是写，GET 不经过写 token 守卫）', async () => {
    // 与 api.test.ts 的 /schedule/state 只读断言同款：express 无匹配即 404。
    // 将来若有人给演算加写入口（把 scenario 落成配置），这条会红——落配置走 AI 会话/PR。
    await request(app).post('/api/schedule/what-if').send({delay: 'PKG-040:3'}).expect(404);
    await request(app).put('/api/schedule/what-if').send({}).expect(404);
  });

  it('13. what-if 不改写 check_window：检查记录是证据不是工期（§16.3）', async () => {
    const sandbox = makeSandbox();
    try {
      // 用真实 loader 算出的双指纹构造 PKG-005 的 passed 记录（沙箱与真仓同配置）。
      const real = loadScheduleState(repoRoot, {modelPackageLinks: loadModelPackageLinks()});
      const pkg = real.control.work_packages.find((item: AnyRecord) => item.id === 'PKG-005');
      const records = [['SCH-005-01', '2026-01-07'], ['SCH-005-02', '2026-01-09']].map(([checkId, checkedAt], index) => ({
        id: `AUD-005-${String(index + 1).padStart(2, '0')}`,
        package_id: 'PKG-005',
        check_id: checkId,
        status: 'passed',
        checked_at: checkedAt,
        checked_by: '业主',
        evidence: [`evidence-${index + 1}.jpg`],
        check_spec_sha256: real.checkSpecHash(pkg, checkId),
        project_data_sha256: real.packageProjectFingerprint(pkg),
      }));
      const controlPath = join(sandbox, 'schedule/phase-1/control.yaml');
      let text = readFileSync(controlPath, 'utf8');
      text = replaceOnce(text, 'anchor_date: null', 'anchor_date: "2026-01-05"');
      text = replaceOnce(text, 'anchor_status: site_pending', 'anchor_status: resolved');
      text = replaceOnce(text, '  records: []', `  records: ${JSON.stringify(records)}`);
      writeFileSync(controlPath, text);

      await withCwd(sandbox, async () => {
        const baseline = await request(app).get('/api/schedule/state').expect(200);
        const expectedWindow = {first_date: '2026-01-07', last_date: '2026-01-09', first_ord: 3, last_ord: 5};
        assert.deepEqual(
          baseline.body.schedule.packages['PKG-005'].check_window,
          expectedWindow,
          '沙箱前提：PKG-005 的检查记录窗口已由两条 passed 记录形成',
        );

        const res = await request(app).get('/api/schedule/what-if?delay=PKG-040:3').expect(200);
        assert.deepEqual(
          res.body.packages['PKG-005'].check_window,
          expectedWindow,
          'delay 不得改写检查记录窗口（证据不是工期）',
        );
        assert.deepEqual(
          res.body.packages['PKG-005'].check_window,
          baseline.body.schedule.packages['PKG-005'].check_window,
          'what-if 前后 check_window 必须逐值相同',
        );
        // PKG-005 是 PKG-040 的上游：自身 forecast 不动；点名包 PKG-040 照常位移。
        assert.deepEqual(res.body.packages['PKG-005'].forecast, res.body.packages['PKG-005'].baseline);
        assert.notDeepEqual(res.body.packages['PKG-040'].forecast, res.body.packages['PKG-040'].baseline);
      });
    } finally {
      rmSync(sandbox, {recursive: true, force: true});
    }
  });

  it('12. state.errors 非空 → 503（与 /schedule/state 同一 load 期通道，§14/B4）', async () => {
    const sandbox = makeSandbox();
    try {
      const controlPath = join(sandbox, 'schedule/phase-1/control.yaml');
      writeFileSync(
        controlPath,
        replaceOnce(readFileSync(controlPath, 'utf8'), '  workdays: [1, 2, 3, 4, 5, 6]', '  workdays: []'),
      );

      await withCwd(sandbox, async () => {
        const stateRes = await request(app).get('/api/schedule/state').expect(503);
        assert.ok(
          stateRes.body.issues.some((issue: string) => issue.includes('work_calendar_empty')),
          `坏配置必须显形 work_calendar_empty，实际 issues：${JSON.stringify(stateRes.body.issues)}`,
        );

        const res = await request(app).get('/api/schedule/what-if?delay=PKG-040:3').expect(503);
        assert.equal(res.body.error, `schedule control invalid: ${res.body.issues.length} issue(s)`, '与 /schedule/state 同一 503 形状');
        assert.ok(
          res.body.issues.some((issue: string) => issue.includes('schedule projection: projection_failed — [work_calendar_empty]')),
          '投影错误必须在 load 期进入 issues（B4 成果不回归）',
        );
        assert.equal(res.body.packages, undefined, '503 时不得夹带任何演算结果');
        assert.equal(res.body.scenario, undefined);

        // 无参同样走 503：配置无效时不返回「基线」冒充可用排程。
        await request(app).get('/api/schedule/what-if').expect(503);

        // 投影失败时入参与投影一起为 null（不把半装配的入参留给 what-if 路由）。
        const broken = loadScheduleState('.', {modelPackageLinks: loadModelPackageLinks()});
        assert.equal(broken.scheduleProjection, null);
        assert.equal(broken.scheduleProjectionInput, null);
      });
    } finally {
      rmSync(sandbox, {recursive: true, force: true});
    }
  });
});
