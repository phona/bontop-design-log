/**
 * /api/project 冷凝锚点读取异常隔离（issue #98，PR #122 Codex major 修复）。
 *
 * 病根：`server/routes.ts` 把 `condensateMasterPenetration()` **内联在响应对象字面量里**。
 * 该函数每次重读并解析 MEP 协调 / 电气 / 给排水 / 吊顶 / HVAC 配置；任一配置暂时不可解析
 * （如 `config/mep-hvac-coordination.yaml` 正在被编辑/写坏）就整段抛错 → 整个处理器抛 →
 * GET /api/project **500** → 同一响应里的 placementClosureDiagnostics 与全部房间/点位清单
 * 一个字都发不出去，初载与阶段切换均被阻断。
 *
 * 口径（issue #98 原文）：「宽容读取、局部降级、统一诊断、严格输出：页面可显示问题并
 * 继续预览；正式 CAD/施工交付与相关模型验证必须因适用范围内的真实错误失败。」
 * 本文件三段各守一侧：
 *   - 页面入口（/api/project）：锚点读取抛错 → **200**，`house.condensatePenetration` 不下发，
 *     错误并入 `placementClosureDiagnostics` 这条**既有**诊断通道（不另起第三套），
 *     机器可读形态为 `condensatePenetrationError`；其余房间/点位/主题照常下发。
 *   - 统一通道：锚点读取失败与投影构造失败同时发生时仍只有**一个**诊断键，count 合并。
 *   - 正式路径：同一份不可解析 MEP 协调配置下 `npm run export:dxf` 仍必须非零退出
 *     （在临时 workspace 里改坏副本，仓库 config/ 不动）。
 *
 * 除本单元测试外，PR 正文另有真实服务端取证：运行期把 config/mep-hvac-coordination.yaml
 * 改坏 → 修前 /api/project HTTP 500、诊断缺失；修后 HTTP 200 + 诊断；同一形态下
 * `npm run export:dxf` 修前修后均 exit 1。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { createApiRouter } from '../../server/routes.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import { parseOverlay } from '../../server/overlay-merge.js';
import type { PlacementClosureApiDiagnostics } from '../../shared/api-project.js';

const ROOT = resolve(import.meta.dirname, '../..');
const TEST_DATA_DIR = './tmp/test-data-api-condensate-anchor-isolate';

/** 真实的读取失败形态：MEP 协调配置暂时不可解析（js-yaml 抛出的原始文案）。 */
const READ_FAILURE = 'config/mep-hvac-coordination.yaml 暂时不可解析：unexpected end of the stream within a flow collection';

interface BuildAppOptions {
  /** 注入抛错的锚点读取产地：模拟「配置暂时不可解析」（同 server/index.ts 的产地形状）。 */
  anchorReader?: () => { x: number; z: number } | undefined;
  /** 注入抛错的投影产地：只为验证两类降级共用同一条诊断通道。 */
  projectionFactory?: () => never;
}

/** 起一个带真实 config 的 /api 应用（同 tests/server/api-placement-closure.test.ts 的装配）。 */
function buildApp(options: BuildAppOptions = {}): express.Express {
  const catalog = ProjectCatalog.load('.');
  const state = DesignState.load(catalog, TEST_DATA_DIR);
  const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
  const calc = new BudgetCalculator(catalog, engine.getConfig());
  const archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);
  const overlay = parseOverlay(`
version: 1
elements:
  - { id: living, type: curtain, points: [{x: 0, z: 0}, {x: 2, z: 0}], room: living_dining, kind: sheer_blackout }
`);
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter({
    catalog,
    state,
    getRuleEngine: () => engine,
    getBudgetCalculator: () => calc,
    archiveStore,
    getConfigRegistry: () => new ConfigRegistry(),
    getOverlay: () => overlay,
    ...(options.anchorReader ? { getCondensateMasterPenetration: options.anchorReader } : {}),
    ...(options.projectionFactory ? { getProjectRenderFactsProjection: options.projectionFactory } : {}),
  }));
  return app;
}

describe('/api/project 冷凝锚点读取异常隔离（issue #98 宽容读取：抛错 → 200 + 统一诊断）', () => {
  let brokenApp: express.Express;
  let healthyApp: express.Express;
  let bothBrokenApp: express.Express;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    brokenApp = buildApp({ anchorReader: () => { throw new Error(READ_FAILURE); } });
    healthyApp = buildApp();
    bothBrokenApp = buildApp({
      anchorReader: () => { throw new Error(READ_FAILURE); },
      projectionFactory: () => { throw new Error('render-facts 投影构造失败（测试注入）'); },
    });
  });

  after(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('锚点读取抛错时 /api/project 仍 200，锚点键不下发，错误并入 placementClosureDiagnostics（病根回归守护）', async () => {
    const res = await request(brokenApp).get('/api/project');
    assert.equal(
      res.status,
      200,
      `锚点读取抛错不得把整个响应打掉（修前即 500，诊断发不出去）：实际 ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`,
    );

    const diagnostics = res.body.placementClosureDiagnostics as PlacementClosureApiDiagnostics | undefined;
    assert.ok(diagnostics, '响应缺 placementClosureDiagnostics：页面无从显形「锚点为何不可得」');
    assert.equal(diagnostics.count, diagnostics.violations.length, 'count 必须等于 violations.length（统一计数）');
    assert.ok(
      diagnostics.violations.some((message) => /冷凝锚点读取失败/.test(message)),
      '诊断必须点名冷凝锚点读取失败',
    );
    assert.ok(
      diagnostics.violations.some((message) => /mep-hvac-coordination\.yaml/.test(message)),
      '诊断必须点名不可解析的具体配置（含原始错误文案）',
    );
    // 机器可读形态：消费方不必解析人读文案就知道「本次没有锚点」。
    assert.equal(diagnostics.condensatePenetrationError?.stage, 'condensate-penetration');
    assert.match(diagnostics.condensatePenetrationError?.message ?? '', /mep-hvac-coordination\.yaml/);
    // 统一处理方向：锚点是优化不是正确性前提，正式交付仍会失败，问题不会藏。
    assert.match(diagnostics.guidance, /不是正确性前提/, 'guidance 必须说清锚点只是优化');
    assert.match(diagnostics.guidance, /正式 DXF 导出与模型验证/, 'guidance 必须说明严格输出未放松');
    assert.match(diagnostics.guidance, /问题不会藏/, 'guidance 必须说明问题不会因页面降级而隐藏');

    // 失败隔离到锚点一个字段：其余交付内容照常下发，页面继续预览。
    assert.ok(!('condensatePenetration' in res.body.house), '锚点读取失败时不得下发锚点键（含 null/undefined 语义之外的半成品）');
    assert.ok(Array.isArray(res.body.house.rooms) && res.body.house.rooms.length > 0, '其余交付内容（房间）被拖垮了');
    assert.ok(Array.isArray(res.body.house.electrical) && res.body.house.electrical.length > 0, '其余交付内容（电气点位）被拖垮了');
    assert.ok(Array.isArray(res.body.house.plumbing) && res.body.house.plumbing.length > 0, '其余交付内容（给排水点位）被拖垮了');
    assert.ok(Array.isArray(res.body.topics) && res.body.topics.length > 0, '其余交付内容（主题）被拖垮了');
  });

  it('锚点读取成功时行为不变：下发锚点，且不带任何诊断键', async () => {
    const res = await request(healthyApp).get('/api/project').expect(200);
    assert.deepEqual(res.body.house.condensatePenetration, { x: 2.3, z: 2.86 }, '默认产地（真实 config）必须照常解出锚点');
    assert.equal(res.body.placementClosureDiagnostics, undefined, '无降级时不得下发诊断键（页面据此区分正常/降级）');
  });

  it('锚点读取失败与投影构造失败同走一条通道：一个键、合并 count、各自的机器可读形态', async () => {
    const res = await request(bothBrokenApp).get('/api/project');
    assert.equal(res.status, 200, `两类数据源同时失败不得打掉响应：实际 ${res.status}`);
    const diagnostics = res.body.placementClosureDiagnostics as PlacementClosureApiDiagnostics | undefined;
    assert.ok(diagnostics, '两类数据源同时失败时缺诊断键');
    // 一个通道：同一个 placementClosureDiagnostics 键（不是第三套响应字段），count 合并。
    assert.equal(res.body.placementClosureDiagnostics, diagnostics);
    assert.equal(diagnostics.count, diagnostics.violations.length);
    assert.equal(diagnostics.count, 2, `投影 + 锚点应各一条诊断，实际 ${diagnostics.count}`);
    assert.equal(diagnostics.projectionError?.stage, 'render-facts-projection');
    assert.equal(diagnostics.condensatePenetrationError?.stage, 'condensate-penetration');
    assert.ok(!('renderFactsProjection' in res.body), '投影构造失败时不得下发投影键');
    assert.ok(!('condensatePenetration' in res.body.house), '锚点读取失败时不得下发锚点键');
  });
});

describe('严格输出未放松（同一份不可解析 MEP 协调配置：export:dxf 仍必须失败）', () => {
  it('npm run export:dxf 在损坏的 mep-hvac-coordination.yaml 下非零退出', () => {
    // 校验器/导出脚本读 cwd 下的 config/，故复制 config 到临时 workspace 再改坏副本，
    // 仓库内 config/ 一个字节都不动。脚本本体（及其对 shared/ 的相对 import）仍用仓库内那一份。
    const workspace = mkdtempSync(join(tmpdir(), 'condensate-anchor-isolate-'));
    try {
      cpSync(join(ROOT, 'config'), join(workspace, 'config'), { recursive: true });
      writeFileSync(
        join(workspace, 'config', 'mep-hvac-coordination.yaml'),
        'routes: [ { id: condensate-master\n',
        'utf8',
      );

      const result = spawnSync(
        process.execPath,
        [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), join(ROOT, 'scripts/render/dxf/export-dxf.ts')],
        { cwd: workspace, encoding: 'utf8' },
      );
      assert.notEqual(
        result.status,
        0,
        `锚点读取被页面入口隔离后，export:dxf 不得跟着放行（严格输出）\n${result.stdout}\n${result.stderr}`,
      );
      assert.match(
        `${result.stdout}${result.stderr}`,
        /mep-hvac-coordination|yaml|YAML|flow collection/i,
        '失败信息必须来自 MEP 协调配置解析（不是无关错误）',
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
